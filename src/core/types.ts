// Shapes shared by every edition. The core depends only on these interfaces,
// never on where data is actually kept (files today, a database later).
import type Anthropic from "@anthropic-ai/sdk";
import type { Model } from "./models/types.ts";
import type { TrimOptions } from "./context.ts";

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
  /** The space (shown to people as a project) this conversation belongs to. None means General. */
  space?: string;
  /** Pinned chats stay at the top of the list. */
  pinned?: boolean;
  /** Put away: kept, and left out of the list of sessions unless the owner asks to see them. */
  archived?: boolean;
  /** For a chat with one bot in its role: that bot's id. None means the general agent. */
  bot?: string;
  messages: Message[];
  /** Tools the user chose "always allow" for in this conversation. */
  allowed: string[];
  /** Tokens used, and the estimated cost in US dollars when the model's prices are known. */
  usage: {
    input: number;
    output: number;
    cost?: number;
    /** Of the input tokens, how many the service read from its cache (charged at about a tenth). */
    cached?: number;
    /** Dollars saved by sending old, large tool outputs shortened (an estimate). */
    saved?: number;
  };
  /** Why its last run stopped before finishing (a budget, its time, being stuck), kept so the chat can say so later. Cleared when it runs again. */
  lastStop?: { reason: RunStop; text: string; at: string } | null;
}

/** A space keeps one client's or project's memory and chats apart from the rest. */
export interface Space {
  id: string;
  name: string;
  createdAt: string;
}

/** Which conversations a search may look in. */
export interface SearchScope {
  /** The space of the conversation asking. None means General, which may look everywhere. */
  space?: string;
  /** A conversation to leave out (the one asking). */
  exclude?: string;
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
  updatedAt?: string;
  /** The space this entry belongs to. None means General: carried into every conversation. */
  space?: string;
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
  /** The agent that does it, as a task in its queue. None: the assistant does it in a chat. */
  owner?: string | null;
  /** The organization the agent is in. */
  org?: string | null;
  /** The task the last run made, when an agent does it. */
  lastTaskId?: string | null;
  /** Set when this is a ready-made briefing: which one, and the owner's one answer for it. */
  briefing?: string;
  topic?: string;
  /** The AI model the owner chose for this routine ("service/model"). None: the agent's own, or the organization's. */
  model?: string;
}

export interface Secret {
  value: string;
  /** The only host this secret may be sent to. */
  host: string;
}

/** A connector (MCP server): a web address, or a program on this computer. */
export interface McpServer {
  name: string;
  /** For a connector on the web. Empty for a program. */
  url: string;
  token?: string;
  /** For a program on this computer: what to run, and its arguments. */
  command?: string;
  args?: string[];
}

// ---------- storage, as the core sees it ----------
export interface ConversationStore {
  get(id: string): MaybePromise<Conversation | null>;
  save(conversation: Conversation): MaybePromise<void>;
  create(extra?: Partial<Conversation>): MaybePromise<Conversation>;
  search(query: string, limit?: number, scope?: SearchScope): MaybePromise<SearchHit[]>;
}

export interface MemoryStore {
  list(): MaybePromise<MemoryEntry[]>;
  /** Saves an entry in a space, or in General when no space is given. */
  add(text: string, space?: string): MaybePromise<MemoryEntry>;
  /** Changes an entry's text, or moves it (space: null moves it to General). */
  update(id: string, patch: { text?: string; space?: string | null }): MaybePromise<MemoryEntry>;
  remove(id: string): MaybePromise<void>;
  /** The name of a space, for telling the agent and the user where something was saved. */
  spaceName?(id: string): MaybePromise<string | undefined>;
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
  /**
   * Dollars this run may still spend of a budget it shares with other runs (a task and the parts handed on
   * from it). Asked before every model call, so the run stops before a step that would likely go over.
   */
  remaining?: () => number;
  /**
   * Tools whose calls always ask a person when they would change something, whatever the approval mode and whatever
   * was allowed "always" earlier. "*" means every tool. Set by organization-wide guardrails.
   */
  alwaysAsk?: string[];
  /** The exits every run has besides its budget (see RunLimits). */
  limits?: RunLimits;
  /**
   * A stronger model to carry on with, once, when the run would stop because it is stuck (the same step again and
   * again, or every step failing), instead of stopping straight away.
   */
  stronger?: Model;
  /** Send old, large tool outputs shortened, to save cost on long runs (default on). See context.ts. */
  trimOutputs?: boolean | TrimOptions;
}

/**
 * Exits on a run's loop, besides its budget. Each stops the run cleanly (every requested step gets an answer, so the
 * run can be continued) and says why, as a "stopped" event.
 */
/** One model call of a run: which model answered, how long it took, and what it cost (when known). */
export interface StepInfo {
  model: string;
  /** True when a backup model answered instead of the one chosen. */
  backup?: boolean;
  ms: number;
  cost?: number;
  /** Tokens sent (not counting those read from the service's cache), read from its cache, and written back. */
  input?: number;
  cacheRead?: number;
  output?: number;
}

export interface RunLimits {
  /** Minutes a run may take, counted from when it started or was continued. */
  minutes?: number;
  /** How many times the very same step (the same tool with the same input) may run in one run. Default 2. */
  repeats?: number;
  /** Steps in a row in which every tool failed, before the run stops. Default 4. */
  failingSteps?: number;
}

/** Why a run stopped before finishing its work. */
export type RunStop = "steps" | "spend" | "shared" | "time" | "repeat" | "failing";

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
  | { type: "assistant"; content: ContentBlock[]; step?: StepInfo }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_result"; result: ToolResult }
  | { type: "resumed"; text: string }
  | { type: "approval"; approval: Approval }
  | { type: "approval_done"; id: string; decision: Decision }
  | { type: "status"; running: boolean; usage?: Conversation["usage"] }
  | { type: "notice"; text: string }
  /** The run stopped at one of its exits: a budget, its time, a repeated step, or tools that kept failing. */
  | { type: "stopped"; reason: RunStop; text: string }
  /** The run was stuck, and a stronger model took over instead of stopping. */
  | { type: "moved_up"; from: string; to: string; reason: RunStop }
  | { type: "error"; text: string };

export interface LiveState {
  running: boolean;
  partial: Delta[];
  approvals: Approval[];
}
