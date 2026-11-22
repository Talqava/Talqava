// The agent loop: ask the model, run the tools it calls, feed the results back, repeat.
// It knows nothing about where data lives, which tools exist or which model
// it talks to; the edition that creates it supplies all three.
import crypto from "node:crypto";
import { describeAnthropicError, isServiceError } from "./models/anthropic.ts";
import { costOf } from "./models/pricing.ts";
import { ModelError } from "./models/types.ts";
import type { ModelReply } from "./models/types.ts";
import type {
  Approval,
  Conversation,
  ConversationStore,
  Decision,
  Delta,
  Job,
  LiveState,
  MaybePromise,
  RunEvent,
  RunSpec,
  ToolResult,
} from "./types.ts";

type Listener = (event: RunEvent) => void;
type ToolCall = { id: string; name: string; input: unknown };

interface Run {
  running: boolean;
  abort: AbortController;
  listeners: Set<Listener>;
  partial: Delta[];
  approvals: Map<string, { info: Approval; resolve(decision: Decision): void }>;
}

export interface EngineOptions {
  conversations: ConversationStore;
  /** Builds the model, prompt, tools and budget for a run of this conversation. */
  resolveRun(conversation: Conversation): MaybePromise<RunSpec>;
  /** Model calls allowed in one run when the run has no step budget. */
  maxTurns?: number;
}

export function describeError(err: unknown): string {
  if (err instanceof ModelError) return err.message;
  return describeAnthropicError(err) ?? (err instanceof Error ? err.message : String(err));
}

const dollars = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

export class Engine {
  #runs = new Map<string, Run>();
  #conversations: ConversationStore;
  #resolveRun: EngineOptions["resolveRun"];
  #maxTurns: number;

  constructor(options: EngineOptions) {
    this.#conversations = options.conversations;
    this.#resolveRun = options.resolveRun;
    this.#maxTurns = options.maxTurns ?? 80;
  }

  // ---------- live state of each conversation ----------
  #run(id: string): Run {
    let run = this.#runs.get(id);
    if (!run) {
      run = { running: false, abort: new AbortController(), listeners: new Set(), partial: [], approvals: new Map() };
      this.#runs.set(id, run);
    }
    return run;
  }

  #emit(id: string, event: RunEvent) {
    const run = this.#run(id);
    // Keep the in-flight streamed text so a page opened mid-answer can catch up.
    if (event.type === "delta") run.partial.push(event);
    if (event.type === "assistant" || event.type === "reset") run.partial = [];
    for (const listener of run.listeners) listener(event);
  }

  subscribe(id: string, listener: Listener): () => void {
    const run = this.#run(id);
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  liveState(id: string): LiveState {
    const run = this.#run(id);
    return { running: run.running, partial: run.partial, approvals: [...run.approvals.values()].map((a) => a.info) };
  }

  isRunning(id: string): boolean {
    return this.#run(id).running;
  }

  awaitingApproval(id: string): boolean {
    return this.#run(id).approvals.size > 0;
  }

  stop(id: string) {
    this.#run(id).abort.abort();
  }

  resolveApproval(id: string, approvalId: string, decision: Decision): boolean {
    const pending = this.#run(id).approvals.get(approvalId);
    if (!pending) return false;
    pending.resolve(decision);
    return true;
  }

  // ---------- approvals ----------
  /** Asks the user (through the page) whether a tool call may run. */
  #askApproval(conversation: Conversation, run: Run, spec: RunSpec, call: ToolCall): Promise<Decision> {
    if (spec.approvalMode === "auto" || conversation.allowed.includes(call.name)) return Promise.resolve("allow");
    if (run.abort.signal.aborted) return Promise.resolve("deny");
    const info: Approval = { id: crypto.randomBytes(8).toString("hex"), toolUseId: call.id, name: call.name, input: call.input };
    return new Promise((resolve) => {
      const finish = (decision: Decision) => {
        run.approvals.delete(info.id);
        run.abort.signal.removeEventListener("abort", onAbort);
        this.#emit(conversation.id, { type: "approval_done", id: info.id, decision });
        resolve(decision);
      };
      const onAbort = () => finish("deny");
      run.abort.signal.addEventListener("abort", onAbort, { once: true });
      run.approvals.set(info.id, { info, resolve: finish });
      this.#emit(conversation.id, { type: "approval", approval: info });
    });
  }

  async #runTool(conversation: Conversation, run: Run, spec: RunSpec, call: ToolCall): Promise<ToolResult> {
    const result = (content: ToolResult["content"], isError = false): ToolResult => ({
      type: "tool_result",
      tool_use_id: call.id,
      content,
      ...(isError ? { is_error: true } : {}),
    });
    if (run.abort.signal.aborted) return result("Cancelled by the user.", true);

    const tool = spec.tools.find((t) => t.name === call.name);
    const problem = tool ? tool.validate(call.input) : `unknown tool ${call.name}`;
    if (!tool || problem) return result(JSON.stringify({ INVALID_JSON: JSON.stringify(call.input), problem }), true);

    if (tool.needsApproval(call.input)) {
      const decision = await this.#askApproval(conversation, run, spec, call);
      if (decision === "always" && !conversation.allowed.includes(call.name)) conversation.allowed.push(call.name);
      if (decision === "deny") {
        return result(
          run.abort.signal.aborted
            ? "Cancelled by the user."
            : "The user declined this action. Do not retry it another way; ask what they would like instead.",
          true,
        );
      }
    }
    try {
      return result(await tool.run(call.input, { signal: run.abort.signal, conversation }));
    } catch (err) {
      return result(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  // ---------- the loop ----------
  async #loop(conversation: Conversation, run: Run) {
    const spec = await this.#resolveRun(conversation);
    const emit = (event: RunEvent) => this.#emit(conversation.id, event);
    const steps = spec.budget?.steps ?? this.#maxTurns;
    const spendLimit = spec.budget?.spend;
    const prices = spec.model.prices;
    if (spendLimit !== undefined && !prices) {
      emit({ type: "notice", text: `The cost of ${spec.model.label} is not known, so only the step budget (${steps}) applies to this run.` });
    }
    let spent = 0;
    let badInputRetries = 0;

    for (let step = 0; ; step++) {
      if (run.abort.signal.aborted) return;
      if (step >= steps) {
        emit({ type: "notice", text: `Stopped at its budget: ${steps} steps. Say "continue" to keep going.` });
        return;
      }
      if (spendLimit !== undefined && prices && spent >= spendLimit) {
        emit({ type: "notice", text: `Stopped at its budget: about ${dollars(spent)} spent of ${dollars(spendLimit)}. Say "continue" to keep going.` });
        return;
      }

      let reply: ModelReply;
      try {
        reply = await spec.model.call(
          {
            system: spec.system,
            messages: conversation.messages,
            tools: spec.tools,
            hostedTools: spec.hostedTools,
            mcpServers: spec.mcpServers,
            signal: run.abort.signal,
          },
          {
            onText: (text) => emit({ type: "delta", kind: "text", text }),
            onThinking: (text) => emit({ type: "delta", kind: "thinking", text }),
            onToolStart: (name) => emit({ type: "delta", kind: "tool", text: name }),
          },
        );
        badInputRetries = 0;
      } catch (err) {
        if (run.abort.signal.aborted) return;
        // A tool input that could not be parsed, or a dropped connection: ask again.
        if (isServiceError(err) || badInputRetries++ >= 2) throw err;
        emit({ type: "reset" });
        continue;
      }

      conversation.usage.input += reply.usage.input + (reply.usage.cacheRead ?? 0) + (reply.usage.cacheWrite ?? 0);
      conversation.usage.output += reply.usage.output;
      if (prices) {
        const cost = costOf(prices, reply.usage);
        spent += cost;
        conversation.usage.cost = (conversation.usage.cost ?? 0) + cost;
      }
      conversation.messages.push({ role: "assistant", content: reply.content });
      await this.#conversations.save(conversation);
      emit({ type: "assistant", content: reply.content });

      if (reply.stopReason === "refusal") {
        emit({ type: "notice", text: "The model declined to continue with this request." });
        return;
      }
      // A long server-side step (web search and the like) paused; asking again resumes it.
      if (reply.stopReason === "pause_turn") continue;

      const calls = reply.content.filter((block) => block.type === "tool_use") as ToolCall[];
      if (!calls.length) {
        if (reply.stopReason === "max_tokens") {
          emit({ type: "notice", text: "The reply hit the length limit and was cut off. Ask it to continue." });
        }
        return;
      }

      const results: ToolResult[] = [];
      for (const call of calls) {
        // An input cut off at the length limit can look valid, so never run it.
        const result: ToolResult =
          reply.stopReason === "max_tokens"
            ? {
                type: "tool_result",
                tool_use_id: call.id,
                is_error: true,
                content: "This tool call was cut off at the output limit and did not run. Try again with a smaller input, split into steps.",
              }
            : await this.#runTool(conversation, run, spec, call);
        results.push(result);
        emit({ type: "tool_result", result });
      }
      conversation.messages.push({ role: "user", content: results });
      await this.#conversations.save(conversation);
    }
  }

  /**
   * Starts a run in the background. Resolves once the message is saved;
   * `done` resolves when the whole run has finished.
   */
  async startRun(id: string, text: string, { keepTitle = false } = {}): Promise<{ conversation: Conversation; done: Promise<void> }> {
    const run = this.#run(id);
    if (run.running) throw new Error("The agent is still working in this conversation.");
    run.running = true; // claimed before the first await, so two starts cannot overlap
    run.abort = new AbortController();

    let conversation: Conversation | null;
    try {
      conversation = await this.#conversations.get(id);
      if (!conversation) throw new Error("Conversation not found.");
      if (!conversation.messages.length && !keepTitle) conversation.title = text.replace(/\s+/g, " ").slice(0, 60) || "New chat";
      conversation.messages.push({ role: "user", content: text });
      await this.#conversations.save(conversation);
    } catch (err) {
      run.running = false;
      throw err;
    }

    const conv = conversation;
    this.#emit(id, { type: "user", text, title: conv.title });
    this.#emit(id, { type: "status", running: true });

    const done = this.#loop(conv, run)
      .catch((err) => {
        console.error(`Run failed in conversation ${id}:`, err);
        this.#emit(id, { type: "error", text: describeError(err) });
      })
      .then(async () => {
        await this.#conversations.save(conv);
      })
      .catch((err) => console.error(`Could not save conversation ${id}:`, err))
      .finally(() => {
        run.running = false;
        run.partial = [];
        this.#emit(id, { type: "status", running: false, usage: conv.usage });
      });
    return { conversation: conv, done };
  }

  /** A scheduled job runs in its own new conversation, with no one watching. */
  async runJob(job: Job) {
    const conversation = await this.#conversations.create({ title: `⏰ ${job.name}`, source: "schedule", jobId: job.id });
    const text = `[Scheduled job "${job.name}", started automatically at ${new Date().toString()}. No one is watching live. Do the task, then finish with a short report of what you did and anything that needs the user's attention.]\n\n${job.prompt}`;
    return this.startRun(conversation.id, text, { keepTitle: true });
  }
}
