// The model layer: one interface for every kind of model the engine can use.
// Conversations are kept in one format (Anthropic's message blocks); each
// adapter translates to and from its own kind of service.
import type Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, McpServer, Message, Tool } from "../types.ts";

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";

export interface ModelUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Prices in US dollars per million tokens. */
export interface Prices {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: Tool[];
  /** Tools Anthropic runs on its side. Only the Claude adapter uses them. */
  hostedTools: Anthropic.Beta.BetaToolUnion[];
  mcpServers: McpServer[];
  signal: AbortSignal;
}

export interface ModelCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onToolStart(name: string): void;
}

export interface ModelReply {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: ModelUsage;
}

export interface Model {
  /** "<provider id>/<model name>", e.g. "anthropic/claude-opus-5-5" or "local/llama3.1". */
  ref: string;
  /** Shown to people, e.g. "claude-opus-5-5 on Anthropic". */
  label: string;
  kind: "anthropic" | "openai";
  /** Known prices, or undefined when the cost of this model is unknown. Local models are free. */
  prices?: Prices;
  call(request: ModelRequest, callbacks: ModelCallbacks): Promise<ModelReply>;
}

/** A refusal from the model service itself (bad key, bad request, service down). Not retried. */
export class ModelError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelError";
    this.status = status;
  }
}
