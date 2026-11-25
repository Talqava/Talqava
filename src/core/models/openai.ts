// Local model runners and other providers that offer the common
// "chat completions" format (most local runners, and many hosted services).
// The conversation stays in the app's own format; this file translates it
// on the way out and translates replies back.
import crypto from "node:crypto";
import type { ContentBlock, Message, Tool, ToolResult } from "../types.ts";
import { ModelError } from "./types.ts";
import type { Model, ModelCallbacks, ModelReply, ModelRequest, Prices, StopReason } from "./types.ts";

export interface OpenAICompatibleOptions {
  providerId: string;
  providerName: string;
  /** e.g. http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
  /** For services whose key is a short-lived token (Google Vertex AI): asked for the key before each request. */
  getKey?: () => Promise<string>;
  /** More keys for the same service: work is spread across them, and a key at its rate limit rests while the others work. */
  moreKeys?: string[];
  /** Told when a key reached its rate limit, and whether another key took over or the request waited. */
  onRateLimit?: (info: { keys: number; switched: boolean; waitedSeconds: number }) => void;
  model: string;
  prices?: Prices;
  maxTokens?: number;
  /** How many tokens the model can hold. Longer conversations are shortened to fit (default 32,000). */
  contextTokens?: number;
  /** Where summaries of long conversations are kept between calls. Kept in this process when not given. */
  summaries?: SummaryCache;
  /** Extra headers sent with every request, e.g. a service's app attribution. */
  headers?: Record<string, string>;
  /** Where the key goes. Most services want "Authorization: Bearer <key>"; Azure wants "api-key: <key>". */
  keyHeader?: "bearer" | "api-key";
  /** What the reply-length limit is called. OpenAI's newer models want max_completion_tokens; most others max_tokens. */
  tokenLimit?: "max_tokens" | "max_completion_tokens";
  /** For tests: replaces the global fetch. */
  fetch?: typeof fetch;
}

/** A summary of the older part of one long conversation: how many messages it covers, and proof they are the same ones. */
export interface ConversationSummary {
  covered: number;
  prefix: string;
  summary: string;
}
export interface SummaryCache {
  get(key: string): ConversationSummary | undefined;
  set(key: string, value: ConversationSummary): void;
}
const processSummaries = new Map<string, ConversationSummary>();
const defaultSummaries: SummaryCache = {
  get: (key) => processSummaries.get(key),
  set: (key, value) => {
    if (processSummaries.size > 200) processSummaries.delete(processSummaries.keys().next().value!);
    processSummaries.set(key, value);
  },
};

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

/** A rough token count: about 3.5 characters per token across code and prose. */
const tokensIn = (messages: ChatMessage[]) => Math.ceil(messages.reduce((n, m) => n + (m.content?.length ?? 0) + ("tool_calls" in m && m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0) / 3.5);

/**
 * Keeps a long conversation within what the model can hold, so it does not
 * lose the task. The system prompt, the task (the first message) and the
 * latest steps stay whole; older tool output is shortened first, then older
 * replies. Nothing is dropped, so every tool call keeps its result.
 */
export function fitToContext(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  if (tokensIn(messages) <= budgetTokens) return messages;
  const out = messages.map((m) => ({ ...m }));
  const keepFrom = Math.max(2, out.length - 8); // the latest steps stay whole
  const shorten = (i: number, keep: number) => {
    const m = out[i];
    if (!m.content || m.content.length <= keep + 200) return;
    m.content = `${m.content.slice(0, keep)}\n[… ${m.content.length - keep} characters shortened to fit the model's memory. Run the step again if you need them.]`;
  };
  for (const keep of [400, 120]) {
    for (let i = 2; i < keepFrom && tokensIn(out) > budgetTokens; i++) if (out[i].role === "tool") shorten(i, keep);
    for (let i = 2; i < keepFrom && tokensIn(out) > budgetTokens; i++) if (out[i].role === "assistant" || out[i].role === "user") shorten(i, keep);
  }
  out[0] = {
    role: "system",
    content: `${out[0].content}\n\nThis is a long task, so earlier steps were shortened to fit. The task itself is the first message; keep to it.`,
  };
  return out;
}

const digest = (value: unknown) => crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
const clip = (text: string, keep: number) => (text.length > keep ? `${text.slice(0, keep)} […]` : text);

/** Older messages as plain text, for the model to summarise. */
function transcript(messages: ChatMessage[], keep: number): string {
  return messages
    .map((m) => {
      if (m.role === "tool") return `Tool result: ${clip(m.content, keep)}`;
      if (m.role === "assistant") {
        const calls = (m.tool_calls ?? []).map((c) => `[used ${c.function.name}: ${clip(c.function.arguments, 200)}]`).join(" ");
        return `Assistant: ${clip(m.content ?? "", keep)} ${calls}`.trim();
      }
      return `User: ${clip(m.content, keep)}`;
    })
    .join("\n\n");
}

const SUMMARY_INSTRUCTIONS =
  "You keep the running summary of a long conversation between a user and an AI agent, so the agent can carry on after the early part is no longer in view. Write what a colleague taking over would need: what the user wants, facts and preferences the user stated, decisions made, what was done and what came of it (names, numbers, file paths, links, exact values), what failed and why, and what is still open. Keep everything that may matter later; leave out pleasantries and repetition. Plain text, at most 400 words. Do not address the user and do not add anything that was not said.";

/** The conversation with its older part replaced by a summary. The first message and everything from `covered` on stay whole. */
function withSummary(messages: ChatMessage[], covered: number, summary: string): ChatMessage[] {
  const note = `[The earlier part of this conversation was summarised to fit. Summary so far:]\n${summary}`;
  const system: ChatMessage = { role: "system", content: `${messages[0].content}\n\nThis is a long conversation: its earlier part is given as a summary. Rely on the summary for what happened before, and say so if a detail you need is not in it.` };
  const first = messages[1] as { role: "user"; content: string };
  const rest = messages.slice(covered);
  // Kept in turns (user, assistant, user…), which some models insist on.
  return rest[0]?.role === "user"
    ? [system, first, { role: "assistant", content: note }, ...rest]
    : [system, { role: "user", content: `${first.content}\n\n${note}` }, ...rest];
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

/** The key, in the header the service wants. */
// Keys at their rate limit, and until when they rest; and where each service's turn-taking is. Shared by every model
// object, since a new one is made for each run.
const resting = new Map<string, number>();
const turns = new Map<string, number>();
/** Longest a request waits for a rate limit to pass before it gives up (and a backup model, if any, takes over). */
export const MAX_WAIT_SECONDS = 20;

/** How long a service asks to wait, from its Retry-After or rate-limit reset header; 30 seconds when it doesn't say. */
export function waitFrom(headers: Headers): number {
  const after = headers.get("retry-after");
  if (after) {
    const seconds = Number(after);
    if (Number.isFinite(seconds)) return Math.max(1, seconds);
    const at = Date.parse(after);
    if (Number.isFinite(at)) return Math.max(1, (at - Date.now()) / 1000);
  }
  for (const name of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "x-ratelimit-reset"]) {
    const value = headers.get(name);
    if (!value) continue;
    // "1s", "6m0s", "250ms", or plain seconds.
    let total = 0;
    for (const [, n, unit] of value.matchAll(/([\d.]+)(ms|s|m|h)?/g)) total += Number(n) * (unit === "ms" ? 0.001 : unit === "m" ? 60 : unit === "h" ? 3600 : 1);
    if (total > 0) return Math.max(1, total);
  }
  return 30;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

function keyHeaders(apiKey: string | undefined, keyHeader: OpenAICompatibleOptions["keyHeader"]): Record<string, string> {
  if (!apiKey) return {};
  return keyHeader === "api-key" ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` };
}

/** Learned per service and model: what a service refused once is not sent again. */
const learned = new Map<string, { tokenLimit?: "max_tokens" | "max_completion_tokens"; noUsage?: boolean }>();

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
    const { baseUrl, model, providerName } = this.#options;
    // The keys take turns, request by request; a key resting after its rate limit is passed over.
    const keys = [this.#options.apiKey, ...(this.#options.moreKeys ?? [])].filter((k, i, all): k is string => Boolean(k) && all.indexOf(k) === i);
    const turn = turns.get(baseUrl) ?? 0;
    turns.set(baseUrl, turn + 1);
    const order = keys.map((_, i) => keys[(turn + i) % keys.length]);
    const restingFor = (k: string) => Math.max(0, (resting.get(`${baseUrl}|${k}`) ?? 0) - Date.now());
    let apiKey = this.#options.getKey ? await this.#options.getKey() : (order.find((k) => !restingFor(k)) ?? order[0]);
    const doFetch = this.#options.fetch ?? fetch;
    const tools = toChatTools(request.tools);
    // Room is left for the reply and the tool descriptions.
    const budget = (this.#options.contextTokens ?? 32_000) - (this.#options.maxTokens ?? 8192) - Math.ceil(JSON.stringify(tools).length / 3.5);
    const summaryUsage = { input: 0, output: 0 };
    let messages = toChatMessages(request.system, request.messages);
    if (tokensIn(messages) > budget) {
      // A conversation too long for the model: its older part becomes a summary, so nothing said early is simply cut off.
      // If the summary cannot be made, the older messages are shortened instead (fitToContext, below).
      messages = await this.#summarised(messages, budget, request.signal, summaryUsage).catch((err) => {
        if (request.signal.aborted) throw err;
        return messages;
      });
    }
    const known = learned.get(`${baseUrl}|${model}`) ?? {};
    const limitName = known.tokenLimit ?? this.#options.tokenLimit ?? "max_tokens";
    const makeBody = (limit: string, usage: boolean) => ({
      model,
      messages: fitToContext(messages, budget),
      ...(tools.length ? { tools } : {}),
      stream: true,
      ...(usage ? { stream_options: { include_usage: true } } : {}),
      [limit]: this.#options.maxTokens ?? 8192,
    });
    const send = (limit: string, usage: boolean) =>
      doFetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#options.headers, ...keyHeaders(apiKey, this.#options.keyHeader) },
        body: JSON.stringify(makeBody(limit, usage)),
        signal: request.signal,
      });

    let response: Response;
    let limit = limitName;
    let withUsage = !known.noUsage;
    try {
      response = await send(limit, withUsage);
      // Services differ in small ways. When one refuses a setting by name, the other form is tried once, and remembered.
      if (response.status === 400 || response.status === 422) {
        const detail = await response.clone().text().catch(() => "");
        const other = limit === "max_tokens" ? "max_completion_tokens" : "max_tokens";
        if (detail.includes(limit)) limit = other;
        else if (withUsage && /stream_options|include_usage/.test(detail)) withUsage = false;
        if (limit !== limitName || withUsage !== !known.noUsage) {
          response = await send(limit, withUsage);
          if (response.ok) learned.set(`${baseUrl}|${model}`, { tokenLimit: limit as "max_tokens" | "max_completion_tokens", noUsage: !withUsage });
        }
      }
      // A rate limit: that key rests, and another takes over at once; when every key is resting, the request waits for
      // the soonest one, if that is short. Nothing has been answered yet, so trying again repeats nothing.
      let waited = 0;
      for (let tries = 0; response.status === 429 && !this.#options.getKey && tries < keys.length + 1; tries++) {
        if (apiKey) resting.set(`${baseUrl}|${apiKey}`, Date.now() + waitFrom(response.headers) * 1000);
        const free = order.find((k) => !restingFor(k));
        let switched = false;
        if (free) {
          apiKey = free;
          switched = true;
        } else {
          const soonest = Math.min(...order.map(restingFor));
          if (soonest / 1000 > MAX_WAIT_SECONDS - waited) break;
          await sleep(soonest, request.signal);
          waited += soonest / 1000;
          apiKey = order.find((k) => !restingFor(k)) ?? order[0];
        }
        this.#options.onRateLimit?.({ keys: keys.length, switched, waitedSeconds: Math.round(waited) });
        response = await send(limit, withUsage);
      }
    } catch (err) {
      if (request.signal.aborted) throw err;
      throw new ModelError(`Could not reach ${providerName} at ${baseUrl}. If it is a local model runner, check that it is running.`);
    }
    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      if (response.status === 401 || response.status === 403) throw new ModelError(`${providerName} rejected the API key. Connect it again under Integrations → AI models.`, response.status);
      if (response.status === 402) throw new ModelError(`${providerName} says the account has no credit left. Add credit on the ${providerName} website, or choose another model. ${detail}`.trim(), 402);
      if (response.status === 404) throw new ModelError(`${providerName} does not know the model "${model}". ${detail}`.trim(), 404);
      if (response.status === 429) throw new ModelError(`${providerName} is busy or the account's rate limit was reached${keys.length > 1 ? ` on all ${keys.length} keys` : ""}. ${detail}`.trim(), 429);
      throw new ModelError(`${providerName} returned an error (${response.status}). ${detail}`.trim(), response.status);
    }

    let text = "";
    let finish: string | null | undefined;
    const usage: { input: number; output: number; cached: number; cost?: number } = { input: 0, output: 0, cached: 0 };
    // Tokens read from the service's cache are reported apart, since they cost much less.
    const total = () => ({
      input: usage.input - usage.cached + summaryUsage.input,
      output: usage.output + summaryUsage.output,
      ...(usage.cached ? { cacheRead: usage.cached } : {}),
      ...(usage.cost !== undefined ? { cost: usage.cost } : {}),
    });
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
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
        if (typeof cached === "number" && cached >= 0 && cached <= usage.input) usage.cached = cached;
        // OpenRouter reports what the call actually cost.
        if (typeof chunk.usage.cost === "number" && Number.isFinite(chunk.usage.cost)) usage.cost = chunk.usage.cost;
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
    return { content, stopReason: stopReason(finish, calls.length > 0), usage: total() };
  }

  /**
   * Replaces the older part of a too-long conversation with a summary written
   * by the model itself. The summary is kept, and only extended when the
   * conversation outgrows the model again, so most calls reuse it as it is.
   */
  async #summarised(messages: ChatMessage[], budget: number, signal: AbortSignal, usage: { input: number; output: number }): Promise<ChatMessage[]> {
    if (messages.length < 6 || messages[1].role !== "user") return messages;
    const cache = this.#options.summaries ?? defaultSummaries;
    const key = digest([this.ref, messages[1], messages[2]]);
    let known = cache.get(key);
    // Only trust a summary of exactly these messages (an edited or different conversation starts again).
    if (known && (known.covered > messages.length - 2 || known.prefix !== digest(messages.slice(1, known.covered)))) known = undefined;
    if (known) {
      const fitted = withSummary(messages, known.covered, known.summary);
      if (tokensIn(fitted) <= budget) return fitted;
    }

    // The latest messages stay whole, up to about half the room; everything before them is summarised.
    let covered = messages.length - 2;
    for (let size = tokensIn(messages.slice(covered)); covered > 2; covered--) {
      size += tokensIn([messages[covered - 1]]);
      if (size > budget * 0.5) break;
    }
    // The kept part must not begin with a tool result cut off from its call.
    while (covered < messages.length - 1 && messages[covered].role === "tool") covered++;
    const from = known?.covered ?? 2;
    if (covered <= from) return known ? withSummary(messages, known.covered, known.summary) : messages;

    const older = messages.slice(from, covered);
    const room = Math.max(2000, budget * 0.6 * 3.5);
    const said = [1500, 600, 200].map((keep) => transcript(older, keep)).find((text) => text.length <= room) ?? clip(transcript(older, 200), room);
    const first = clip(messages[1].content ?? "", 2000);
    const ask = `How the conversation started:\n${first}\n\n${known ? `Summary so far:\n${known.summary}\n\n` : ""}What happened next:\n${said}\n\nWrite the updated summary of everything so far.`;

    const { baseUrl, model } = this.#options;
    const apiKey = this.#options.getKey ? await this.#options.getKey() : this.#options.apiKey;
    const response = await (this.#options.fetch ?? fetch)(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.#options.headers, ...keyHeaders(apiKey, this.#options.keyHeader) },
      body: JSON.stringify({ model, stream: false, [learned.get(`${baseUrl}|${model}`)?.tokenLimit ?? this.#options.tokenLimit ?? "max_tokens"]: 1500, messages: [{ role: "system", content: SUMMARY_INSTRUCTIONS }, { role: "user", content: ask }] }),
      signal,
    });
    if (!response.ok) throw new Error(`summary failed (${response.status})`);
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    usage.input += data.usage?.prompt_tokens ?? 0;
    usage.output += data.usage?.completion_tokens ?? 0;
    // Some local models write their thinking first, inside <think> tags.
    const summary = String(data.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!summary) throw new Error("summary was empty");
    cache.set(key, { covered, prefix: digest(messages.slice(1, covered)), summary });
    return withSummary(messages, covered, summary);
  }
}
