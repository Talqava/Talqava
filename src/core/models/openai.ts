// Local model runners and other providers that offer the common
// "chat completions" format (most local runners, and many hosted services).
// The conversation stays in the app's own format; this file translates it
// on the way out and translates replies back.
import type { ContentBlock, Message, Tool, ToolResult } from "../types.ts";
import { ModelError } from "./types.ts";
import type { Model, ModelCallbacks, ModelReply, ModelRequest, Prices, StopReason } from "./types.ts";

export interface OpenAICompatibleOptions {
  providerId: string;
  providerName: string;
  /** e.g. http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  prices?: Prices;
  maxTokens?: number;
  /** For tests: replaces the global fetch. */
  fetch?: typeof fetch;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

function resultText(content: ToolResult["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "image") return "[An image was returned here, but this model cannot see images.]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** The app's conversation, in the chat completions format. Blocks only Claude understands are left out. */
export function toChatMessages(system: string, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content } as ChatMessage);
      continue;
    }
    const blocks = message.content as Array<{ type: string; [key: string]: any }>;
    if (message.role === "user") {
      const texts: string[] = [];
      for (const block of blocks) {
        if (block.type === "tool_result") out.push({ role: "tool", tool_call_id: block.tool_use_id, content: resultText(block.content) });
        else if (block.type === "text") texts.push(block.text);
      }
      if (texts.length) out.push({ role: "user", content: texts.join("\n") });
      continue;
    }
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const calls: ChatToolCall[] = blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));
    if (!text && !calls.length) continue; // only thinking or Claude's own server-side steps
    out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return out;
}

/** Our tools, described in the chat completions format. Tools with no portable description are left out. */
export function toChatTools(tools: Tool[]) {
  return tools
    .map((tool) => {
      const def = tool.definition as { description?: string; input_schema?: Record<string, unknown> };
      const description = tool.portable?.description ?? def.description;
      const parameters = tool.portable?.parameters ?? def.input_schema;
      if (!description || !parameters) return null;
      return { type: "function" as const, function: { name: tool.name, description, parameters } };
    })
    .filter((tool) => tool !== null);
}

function stopReason(reason: string | null | undefined, sawToolCalls: boolean): StopReason {
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  if (reason === "stop") return sawToolCalls ? "tool_use" : "end_turn";
  return sawToolCalls ? "tool_use" : "end_turn";
}

/** Splits a streamed response into its "data:" payloads. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const last = buffer.trim();
  if (last.startsWith("data:")) yield last.slice(5).trim();
}

export class OpenAICompatibleModel implements Model {
  readonly kind = "openai";
  readonly ref: string;
  readonly label: string;
  readonly prices?: Prices;
  #options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.#options = options;
    this.ref = `${options.providerId}/${options.model}`;
    this.label = `${options.model} on ${options.providerName}`;
    this.prices = options.prices;
  }

  async call(request: ModelRequest, callbacks: ModelCallbacks): Promise<ModelReply> {
    const { baseUrl, apiKey, model, providerName } = this.#options;
    const doFetch = this.#options.fetch ?? fetch;
    const tools = toChatTools(request.tools);
    const body = {
      model,
      messages: toChatMessages(request.system, request.messages),
      ...(tools.length ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.#options.maxTokens ?? 8192,
    };

    let response: Response;
    try {
      response = await doFetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal.aborted) throw err;
      throw new ModelError(`Could not reach ${providerName} at ${baseUrl}. If it is a local model runner, check that it is running.`);
    }
    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      if (response.status === 401 || response.status === 403) throw new ModelError(`${providerName} rejected the API key. Check it under Settings.`, response.status);
      if (response.status === 404) throw new ModelError(`${providerName} does not know the model "${model}". ${detail}`.trim(), 404);
      throw new ModelError(`${providerName} returned an error (${response.status}). ${detail}`.trim(), response.status);
    }

    let text = "";
    let finish: string | null | undefined;
    const usage = { input: 0, output: 0 };
    const calls: { id: string; name: string; args: string }[] = [];

    for await (const data of events(response.body)) {
      if (data === "[DONE]") break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new ModelError(`${providerName} returned an error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens ?? usage.input;
        usage.output = chunk.usage.completion_tokens ?? usage.output;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        callbacks.onText(delta.content);
      }
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) callbacks.onThinking(reasoning);
      for (const part of delta.tool_calls ?? []) {
        const index = typeof part.index === "number" ? part.index : calls.length;
        if (!calls[index]) {
          calls[index] = { id: part.id ?? `call_${index}_${Date.now()}`, name: "", args: "" };
        }
        if (part.id) calls[index].id = part.id;
        if (part.function?.name) {
          if (!calls[index].name) callbacks.onToolStart(part.function.name);
          calls[index].name += part.function.name;
        }
        if (part.function?.arguments) calls[index].args += part.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const content: ContentBlock[] = [];
    if (text) content.push({ type: "text", text, citations: null } as unknown as ContentBlock);
    for (const call of calls.filter(Boolean)) {
      let input: unknown;
      try {
        input = call.args.trim() ? JSON.parse(call.args) : {};
      } catch {
        // Left for the engine's input check, which reports it back to the model.
        input = { _unparsed_arguments: call.args };
      }
      content.push({ type: "tool_use", id: call.id, name: call.name, input } as unknown as ContentBlock);
    }
    return { content, stopReason: stopReason(finish, calls.length > 0), usage };
  }
}
