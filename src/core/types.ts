// Shapes shared by every edition. The core depends only on these interfaces,
// never on where data is actually kept (files today, a database later).
import type Anthropic from "@anthropic-ai/sdk";
import type { Model } from "./models/types.ts";

export type MaybePromise<T> = T | Promise<T>;
export type Message = Anthropic.Beta.BetaMessageParam;
export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
export type ToolOutput = ToolResult["content"];
export type Effort = "low" | "medium" | "high" | "xhigh";
export type ApprovalMode = "ask" | "auto";
export type Decision = "allow" | "always" | "deny";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: "chat" | "schedule" | "quest";
  jobId?: string;
  messages: Message[];
  /** Tools the user chose "always allow" for in this conversation. */
  allowed: string[];
  /** Tokens used, and the estimated cost in US dollars when the model's prices are known. */
  usage: { input: number; output: number; cost?: number };
}

export interface SearchHit {
  conversation: string;
  date: string;
  role: string;
  excerpt: string;
}

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastConversationId: string | null;
}

export interface Secret {
  value: string;
  /** The only host this secret may be sent to. */
  host: string;
}

export interface McpServer {
  name: string;
  url: string;
  token?: string;
}

// ---------- storage, as the core sees it ----------
export interface ConversationStore {
  get(id: string): MaybePromise<Conversation | null>;
  save(conversation: Conversation): MaybePromise<void>;
  create(extra?: Partial<Conversation>): MaybePromise<Conversation>;
  search(query: string, limit?: number): MaybePromise<SearchHit[]>;
}

export interface MemoryStore {
  list(): MaybePromise<MemoryEntry[]>;
  add(text: string): MaybePromise<MemoryEntry>;
  remove(id: string): MaybePromise<void>;
}

export interface SkillStore {
  list(): MaybePromise<Skill[]>;
  save(skill: { name: string; description: string; content: string }): MaybePromise<Skill>;
}

export interface JobStore {
  list(): MaybePromise<Job[]>;
  saveAll(jobs: Job[]): MaybePromise<void>;
}

// ---------- tools ----------
export interface ToolContext {
  signal: AbortSignal;
  conversation: Conversation;
}

export interface Tool {
  name: string;
  /** What is sent to Claude to describe the tool. */
  definition: Anthropic.Beta.BetaToolUnion;
  /** A plain JSON-schema description, for models other than Claude. Tools without one are Claude-only. */
  portable?: { description: string; parameters: Record<string, unknown> };
  /** Returns a problem with the input, or null if it is fine. */
  validate(input: unknown): string | null;
  /** Does this call change something, so that "ask" mode should confirm it first? */
  needsApproval(input: any): boolean;
  run(input: any, context: ToolContext): MaybePromise<ToolOutput>;
}

// ---------- one run ----------
/**
 * Everything the engine needs to run one conversation turn. The edition builds
 * it: the local edition from its settings file, the hosted edition from a
 * user and a bot.
 */
export interface RunSpec {
  model: Model;
  system: string;
  /** Tools that run in this process. */
  tools: Tool[];
  /** Tools Anthropic runs (web search and the like), passed through as-is. Claude only. */
  hostedTools: Anthropic.Beta.BetaToolUnion[];
  mcpServers: McpServer[];
  approvalMode: ApprovalMode;
  budget?: Budget;
  /**
   * Tools that bring in outside content (web pages, API replies). Once one has
   * run in a conversation, every change asks first, whatever the approval mode.
   */
  cautionAfter?: string[];
}

/** Limits on one run (one quest). The run stops before going over either. */
export interface Budget {
  /** Model calls allowed. */
  steps?: number;
  /** US dollars allowed, estimated from the model's prices. */
  spend?: number;
}

export interface Approval {
  id: string;
  toolUseId: string;
  name: string;
  input: unknown;
  /** Why this asks even though approvals would normally let it run. */
  reason?: string;
}

export type Delta = { type: "delta"; kind: "text" | "thinking" | "tool"; text: string };

export type RunEvent =
  | Delta
  | { type: "user"; text: string; title: string }
  | { type: "reset" }
  | { type: "assistant"; content: ContentBlock[] }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_result"; result: ToolResult }
  | { type: "resumed"; text: string }
  | { type: "approval"; approval: Approval }
  | { type: "approval_done"; id: string; decision: Decision }
  | { type: "status"; running: boolean; usage?: Conversation["usage"] }
  | { type: "notice"; text: string }
  | { type: "error"; text: string };

export interface LiveState {
  running: boolean;
  partial: Delta[];
  approvals: Approval[];
}
