// Claude, through Anthropic's API on the user's key.
import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../types.ts";
import { CLAUDE_PRICES } from "./pricing.ts";
import { ModelError } from "./types.ts";
import type { Model, ModelCallbacks, ModelReply, ModelRequest, StopReason } from "./types.ts";

const MAX_TOKENS = 64_000;
// Models that can hand a declined request to another model on the server.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);

export interface AnthropicOptions {
  apiKey?: string;
  model: string;
  effort: Effort;
  /** Provider id used in the model's ref. */
  providerId?: string;
}

function params(model: string, effort: Effort, request: ModelRequest) {
  const betas = ["compact-2026-01-12"];
  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_TOKENS,
    system: request.system,
    tools: [
      ...request.tools.map((tool) => tool.definition),
      ...request.hostedTools,
      ...request.mcpServers.map((server) => ({ type: "mcp_toolset", mcp_server_name: server.name })),
    ],
    messages: request.messages,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
    cache_control: { type: "ephemeral" },
    // Long conversations are summarised on the server instead of overflowing.
    context_management: { edits: [{ type: "compact_20260112" }] },
    betas,
  };
  if (FALLBACK_MODELS.has(model)) {
    betas.push("server-side-fallback-2026-07-01");
    body.fallbacks = "default";
  }
  if (request.mcpServers.length) {
    betas.push("mcp-client-2025-11-20");
    body.mcp_servers = request.mcpServers.map((server) => ({
      type: "url",
      name: server.name,
      url: server.url,
      ...(server.token ? { authorization_token: server.token } : {}),
    }));
  }
  return body as unknown as Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
}

function stopReason(reason: string | null): StopReason {
  return reason === "end_turn" || reason === "tool_use" || reason === "max_tokens" || reason === "refusal" || reason === "pause_turn" ? reason : "other";
}

/** Plain words for Anthropic's errors. */
export function describeAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check it under Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return `The API key is not allowed to do this: ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return "Anthropic's rate limit was reached. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach Anthropic. Check the internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic returned an error (${err.status ?? "no status"}): ${err.message}`;
  return null;
}

export class AnthropicModel implements Model {
  readonly kind = "anthropic";
  readonly ref: string;
  readonly label: string;
  readonly prices;
  #client: Anthropic;
  #model: string;
  #effort: Effort;

  constructor(options: AnthropicOptions) {
    this.#client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.#model = options.model;
    this.#effort = options.effort;
    this.ref = `${options.providerId ?? "anthropic"}/${options.model}`;
    this.label = `${options.model} on Anthropic`;
    this.prices = CLAUDE_PRICES[options.model];
  }

  async call(request: ModelRequest, callbacks: ModelCallbacks): Promise<ModelReply> {
    const stream = this.#client.beta.messages.stream(params(this.#model, this.#effort, request), { signal: request.signal });
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && /tool_use$/.test(event.content_block.type)) {
        callbacks.onToolStart((event.content_block as { name: string }).name);
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") callbacks.onText(event.delta.text);
        if (event.delta.type === "thinking_delta") callbacks.onThinking(event.delta.thinking);
      }
    });
    const message = await stream.finalMessage();
    const usage = message.usage;
    return {
      content: message.content,
      stopReason: stopReason(message.stop_reason),
      usage: {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        cacheRead: usage?.cache_read_input_tokens ?? 0,
        cacheWrite: usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Errors that come from the service itself, which a retry will not fix. */
export function isServiceError(err: unknown): boolean {
  return err instanceof Anthropic.APIError || err instanceof ModelError;
}
