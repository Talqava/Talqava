// Quests: a bot sent to do one job. The runner starts them, keeps several going
// at once, writes every step to a journal on disk, and picks interrupted quests
// back up when the app starts again. Quests on code get their own branch.
import fs from "node:fs";
import path from "node:path";
import type { Bot, ContentBlock, Engine, RunEvent, RunStop } from "../core/index.ts";
import { DATA, WORKSPACE, conversations, getConfig, readJson, writeJson } from "./store.ts";
import { feedback, runChecks } from "./checks.ts";
import { budgetBlock, groupBlock, recordSpend } from "./spend.ts";
import { loadCrew } from "./crew.ts";
import { groupOf, orgs } from "./orgs.ts";
import { orgMemory } from "./orgmemory.ts";
import { audit } from "./audit.ts";
import type { CheckResult } from "./checks.ts";
import type { QuestCheck, QuestTemplate } from "./templates.ts";
import { fill, resolveInputs } from "./templates.ts";
import { gitLog, githubIssues, githubReport, githubSlug } from "./gather.ts";
import { acceptCopy, changes, prepareCopy, undoCopy } from "./git.ts";
import type { Changes, QuestCopy } from "./git.ts";

/** "asking": the agent checked the task before starting and is waiting for the owner to answer its questions. */
export type QuestStatus = "running" | "waiting" | "done" | "stopped" | "failed" | "budget" | "asking";

export interface Quest {
  /** The same id as the quest's conversation. */
  id: string;
  title: string;
  /** The bot as it was when the quest started, so a later edit to its file cannot change a quest under way. */
  bot: Bot;
  status: QuestStatus;
  /** The repository the quest works on, if any. */
  project?: string;
  copy?: QuestCopy;
  /** What became of the quest's changes. */
  outcome?: "accepted" | "undone" | "no-changes";
  steps: number;
  resumedAt?: string;
  note?: string;
  /** While it is asking before starting: abilities it lacks that the owner can switch on with one press. */
  grant?: string[];
  /** For a core quest: what it is, what it was given, and how its result is checked. */
  template?: { id: string; name: string; check: QuestCheck; inputs: Record<string, string>; mustMention: string[]; tries: number; maxTries: number };
  /** The latest check of the result, and whether one is running now. */
  check?: CheckResult;
  checking?: boolean;
  /** A model chosen for this quest after it started, e.g. when handed to Claude. */
  modelOverride?: string;
  /** How many files a finished code quest changed, so a quest with none is not shown as waiting for review. */
  changedFiles?: number;
  /** For a task handed down the org chart: the conversation (a manager's quest, or a chat) its report goes back to. */
  parent?: { id: string; by: string; delivered: boolean };
  /** A question from a colleague rather than a task: answered briefly, from what the agent knows. */
  kind?: "question" | "decision";
  /** The task the person assigned that this one descends from (its own id for that task itself). A task and everything handed on from it share one budget. */
  root?: string;
  /** How many hand-offs deep this quest is: 0 for one the person sent. */
  depth?: number;
  /** The group whose monthly budget this task is charged to: the group its agent was in when it started. */
  charge?: { org: string; group: string };
  /** Why the task exists, as it stood when it started: the organization's mission and the group's purpose. */
  purpose?: { org: string; mission?: string; group?: string; goal?: string };
  /** For big work: the plan the agent writes first, and where it stands with the owner. */
  plan?: Plan;
  /** Which exit stopped its last run, when it did not finish on its own. */
  stop?: RunStop;
  /** Written whenever a run stops before finishing, so the next run, or another agent, picks up from here. */
  handover?: Handover;
  createdAt: string;
  updatedAt: string;
}

/** A plan an agent writes before big work, for the owner to approve or send back with changes. */
export interface Plan {
  /** drafting: the agent is writing it; proposed: waiting for the owner; changes: sent back; approved: being carried out. */
  status: "drafting" | "proposed" | "changes" | "approved";
  summary?: string;
  steps?: { what: string; who: string }[];
  /** The agent's estimate of what carrying it out costs, in dollars. */
  estimate?: number | null;
  /** How many times it was submitted. */
  version: number;
  /** The owner's last request for changes. */
  feedback?: string;
  at: string;
}

/** What a stopped run leaves for whoever carries on: why it stopped, what it did, and where it got to. */
export interface Handover {
  at: string;
  why: string;
  steps: number;
  cost: number;
  /** What it did, in order, in plain words (the last few). */
  did: string[];
  /** Files and workspace pages it changed or proposed. */
  changed: string[];
  /** What it last said. */
  lastWords: string;
  /** Where to pick up. */
  next: string;
}

const ACTION_WORDS: Record<string, string> = { bash: "ran a command", str_replace_based_edit_tool: "worked on a file", web_search: "searched the web", web_fetch: "read a web page", http_request: "called a web API", memory: "used memory", skill: "used a skill", schedule: "scheduled work", browser: "used the browser", conversation_search: "searched past chats", assign_task: "handed work to a colleague", request_work: "requested work from another department", escalate: "took a decision to its lead", ask_colleague: "asked a colleague", team_memory: "used team memory", library: "searched the library", workspace: "used the workspace" };
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/** Builds the hand-over note for a run that stopped, from what it did: nothing is asked of the model, so it costs nothing and always works. */
export function handoverOf(quest: Quest, why: string): Handover {
  const conversation = conversations.get(quest.id);
  const messages = conversation?.messages ?? [];
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let lastWords = "";
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content as ContentBlock[]) {
      if (b.type === "tool_use") calls.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      if (b.type === "text" && b.text.trim()) lastWords = b.text.trim();
    }
  }
  const changed = new Set<string>();
  for (const c of calls) {
    if (c.name === "str_replace_based_edit_tool" && ["create", "str_replace", "insert"].includes(String(c.input.command)) && c.input.path) changed.add(`File ${c.input.path}`);
    if (c.name === "workspace" && c.input.action === "suggest") changed.add(`Suggested a change to page ${c.input.page}`);
    if (c.name === "workspace" && c.input.action === "file") changed.add(`New page “${c.input.title}”`);
  }
  const did: string[] = [];
  for (const c of calls.slice(-8)) {
    const words = ACTION_WORDS[c.name] ?? `used ${c.name}`;
    const about = String(c.input.command ?? c.input.query ?? c.input.path ?? c.input.url ?? c.input.to ?? c.input.action ?? "").replace(/\s+/g, " ");
    did.push(clip(about ? `${words}: ${about}` : words, 140));
  }
  const last = calls.at(-1);
  const next = lastWords
    ? `Pick up from its last message, below, and finish the task.${last ? ` Its last step was: ${did.at(-1)}.` : ""}`
    : last
      ? `It had not reported yet. Its last step was: ${did.at(-1)}. Check that step's result, then carry on.`
      : "It stopped before doing anything. Start the task from its brief.";
  return { at: new Date().toISOString(), why, steps: quest.steps, cost: conversation?.usage.cost ?? 0, did, changed: [...changed].slice(0, 20), lastWords: clip(lastWords, 1200), next };
}

/** The note as text, for a task's comments and for the brief of whoever carries on. */
export function handoverText(h: Handover, who: string): string {
  return [
    `Hand-over note from ${who}. Stopped: ${h.why}`,
    h.did.length ? `What it did last:\n${h.did.map((d) => `- ${d}`).join("\n")}` : "",
    h.changed.length ? `What it changed:\n${h.changed.map((c) => `- ${c}`).join("\n")}` : "",
    h.lastWords ? `What it last said:\n${h.lastWords}` : "",
    `Next: ${h.next}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** How a report from a hand-off starts, so the window can show it as a report rather than something the person typed. */
export const REPORT_MARK = "[Report from ";

/** The group a task is charged to, as the chart says now (so a raised budget counts at once). */
function chargedGroup(quest: Pick<Quest, "charge">) {
  if (!quest.charge) return undefined;
  const org = orgs.list().orgs.find((o) => o.id === quest.charge!.org);
  return org ? { org, group: (org.groups ?? []).find((g) => g.id === quest.charge!.group) } : undefined;
}
/** Why the group a task is charged to may not spend more, or null. */
const groupStop = (quest: Pick<Quest, "charge">) => ((c) => (c ? groupBlock(c.org.id, c.group) : null))(chargedGroup(quest));

export interface WhyStep {
  /** mission: the organization's; goal: the group's purpose; objective: a measurable goal; project; task: a task in the chain, the owner's first. */
  kind: "mission" | "goal" | "objective" | "project" | "task";
  text: string;
  /** For a goal, the group; for a task, the agent doing it and who handed it on. */
  who?: string;
  by?: string;
  id?: string;
}

/**
 * Why a task exists, from the top: the organization's mission, the goal of the group whose work it is, the task
 * the owner gave, and each hand-off down to this one. Every link is as it stood when that task started.
 */
export function whyOf(quest: Quest): WhyStep[] {
  const tasks: Quest[] = [quest];
  for (let at = quest, n = 0; at.parent && n < 12; n++) {
    const from = questStore.get(at.parent.id);
    if (!from) break;
    tasks.unshift(from);
    at = from;
  }
  const top = tasks[0];
  const purpose = top.purpose ?? quest.purpose;
  const steps: WhyStep[] = [];
  if (purpose?.mission) steps.push({ kind: "mission", text: purpose.mission });
  // The goal that matters is the group of the one the owner asked: the work is for that group's purpose.
  if (purpose?.goal) steps.push({ kind: "goal", text: purpose.goal, who: purpose.group });
  // The measurable goal and the project the owner's task serves, from the work layer.
  steps.push(...whyGoal(top.id));
  for (const t of tasks) steps.push({ kind: "task", text: t.title, who: t.bot.name, by: t.parent?.by, id: t.id });
  return steps;
}

let whyGoal: (questId: string) => WhyStep[] = () => [];
/** Set by the work layer: the goal and project a task serves, for its "why". */
export const setWhyGoal = (fn: (questId: string) => WhyStep[]) => (whyGoal = fn);

/** The why chain in words, for the agent doing the task. Empty for a task the owner gave with no mission or goal set. */
export function whyPrompt(quest: Quest): string {
  const steps = whyOf(quest);
  if (steps.length <= 1) return "";
  const lines = steps.map((s) => (s.kind === "mission" ? `- The organization's mission: ${s.text}` : s.kind === "goal" ? `- The ${s.who} group's purpose: ${s.text}` : s.kind === "objective" ? `- The goal: ${s.text}` : s.kind === "project" ? `- The project: ${s.text}` : s.id === quest.id ? `- Your task: ${s.text}` : `- ${s.by ? `Handed on to ${s.who}` : `The owner asked ${s.who}`}: ${s.text}`));
  return `Why this task exists, from the top:\n${lines.join("\n")}\nKeep the work aimed at this. If the task as written would not serve it, say so in your report rather than doing it anyway.`;
}

/** The budget a task shares with everything handed on from it: the budget per task in Settings. */
export const chainBudget = () => getConfig().budget.spend ?? 1;
/**
 * The task the person assigned that a task descends from. Tasks record it when they start; for one
 * made before that was recorded, it is found by following who handed it on.
 */
export function rootOf(quest: Quest): string {
  if (quest.root) return quest.root;
  let at = quest;
  for (let steps = 0; steps < 12 && at.parent; steps++) {
    const from = questStore.get(at.parent.id);
    if (!from) break;
    at = from;
  }
  return at.root ?? at.id;
}
/** A task and everything handed on from it. */
export const chainOf = (rootId: string) => questStore.list().filter((q) => rootOf(q) === rootId);
/** What a task and everything handed on from it have cost so far. */
export function chainCost(rootId: string): number {
  return chainOf(rootId).reduce((sum, q) => sum + (conversations.get(q.id)?.usage.cost ?? 0), 0);
}
export const chainOver = (rootId: string) => chainCost(rootId) >= chainBudget();
/** How many tasks came from one task, itself included. */
export const chainSize = (rootId: string) => chainOf(rootId).length;
/** Hand-offs may go this many levels down the chart, and a conversation may have this many open at once. */
export const MAX_DEPTH = 5;
export const MAX_OPEN_HANDOFFS = 8;

/** Quests that may run at the same time. */
export const MAX_RUNNING = 6;

const QUEST_DIR = () => path.join(DATA, "quests");
const JOURNAL_DIR = () => path.join(DATA, "journals");
export const WORKTREE_DIR = () => path.join(DATA, "worktrees");
const questFile = (id: string) => {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Bad quest id");
  return path.join(QUEST_DIR(), `${id}.json`);
};
const journalFile = (id: string) => path.join(JOURNAL_DIR(), `${id}.jsonl`);

export class QuestStore {
  get(id: string): Quest | null {
    try {
      return readJson<Quest | null>(questFile(id), null);
    } catch {
      return null;
    }
  }

  save(quest: Quest) {
    fs.mkdirSync(QUEST_DIR(), { recursive: true });
    quest.updatedAt = new Date().toISOString();
    writeJson(questFile(quest.id), quest);
  }

  list(): Quest[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(QUEST_DIR()).filter((name) => name.endsWith(".json"));
    } catch {}
    return names
      .map((name) => this.get(name.replace(/\.json$/, "")))
      .filter((q): q is Quest => Boolean(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  remove(id: string) {
    fs.rmSync(questFile(id), { force: true });
    fs.rmSync(journalFile(id), { force: true });
  }
}

/** Every step of a quest, one JSON line each, written as it happens. */
export const journal = {
  append(id: string, event: RunEvent | { type: string; [key: string]: unknown }) {
    fs.mkdirSync(JOURNAL_DIR(), { recursive: true });
    fs.appendFileSync(journalFile(id), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  },
  read(id: string): ({ at: string; type: string } & Record<string, any>)[] {
    let text = "";
    try {
      text = fs.readFileSync(journalFile(id), "utf8");
    } catch {
      return [];
    }
    // A line cut off by a crash is skipped; everything before it is kept.
    return text.split("\n").flatMap((line) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
  },
  /** Tool calls that had started, so a resumed quest does not repeat them blindly. */
  started(id: string): Set<string> {
    return new Set(this.read(id).filter((e) => e.type === "tool_start").map((e) => String(e.id)));
  },
};

export const questStore = new QuestStore();

/** The bot as its file says today (a quest keeps the bot as it was at the start), so a raised budget counts at once. */
const asItIsNow = (bot: Bot): Bot => loadCrew().bots.find((b) => b.id === bot.id) ?? bot;

export class QuestRunner {
  #engine!: Engine;
  /** Why each running quest will end, learned from its events. */
  #ending = new Map<string, QuestStatus>();
  #stopping = new Set<string>();

  attach(engine: Engine) {
    this.#engine = engine;
  }

  running(): Quest[] {
    return questStore.list().filter((q) => q.status === "running" || q.status === "waiting");
  }

  /** Set by the work layer: hand-offs still waiting in an agent's queue for a conversation, so its reports wait for them. */
  pendingHandoffs: (conversationId: string) => number = () => 0;
  /** Set by the work layer: called when a run stops, so the agent's next task can start. */
  onRunEnded: (questId: string) => void = () => {};
  /** Set by the work layer: records a run started outside the queues as a task. */
  onStartedOutsideQueue: (quest: Quest) => void = () => {};
  /** Set by the work layer: why this agent may not start work now (it is paused), or null. */
  agentPaused: (botId: string) => string | null = () => null;

  isRunning(id: string): boolean {
    return this.#engine.isRunning(id);
  }

  /** Continues a run with a message (the owner's comment, or "carry on"). */
  async resume(id: string, message: string) {
    await this.#engine.startRun(id, message, { keepTitle: true });
  }

  async start({ bot, text, project, title, template, parent, kind, item, direct, model }: { bot: Bot; text: string; project?: string; title?: string; template?: Quest["template"]; parent?: { id: string; by: string }; kind?: "question" | "decision"; item?: string; direct?: boolean; model?: string }): Promise<Quest> {
    if (this.running().length >= MAX_RUNNING) throw new Error(`${MAX_RUNNING} tasks are already under way. Wait for one to finish, or stop one.`);
    // A bot that has used its month's budget starts nothing new.
    const blocked = budgetBlock(bot);
    if (blocked) throw new Error(blocked);
    // A paused agent starts nothing until the owner resumes it.
    const paused = this.agentPaused(bot.id);
    if (paused) throw new Error(paused);
    // The task is charged to its agent's group, which stops starting work at its monthly budget.
    const org = orgs.active();
    const group = groupOf(org, bot.id);
    const charge = group ? { org: org.id, group: group.id } : undefined;
    const groupBlocked = charge ? groupStop({ charge }) : null;
    if (groupBlocked) throw new Error(groupBlocked);
    const conversation = await conversations.create({ title: (title ?? text).replace(/\s+/g, " ").slice(0, 80), source: "quest" });
    const now = new Date().toISOString();
    const quest: Quest = { id: conversation.id, title: conversation.title, bot, status: "running", steps: 0, createdAt: now, updatedAt: now, ...(template ? { template } : {}), ...(kind ? { kind } : {}) };
    quest.root = quest.id;
    // A model the owner chose for this task is used in place of the agent's own.
    if (model) quest.modelOverride = model;
    if (charge) quest.charge = charge;
    if (org.mission || group?.goal) quest.purpose = { org: org.id, ...(org.mission ? { mission: org.mission } : {}), ...(group ? { group: group.name } : {}), ...(group?.goal ? { goal: group.goal } : {}) };
    if (parent) {
      quest.parent = { ...parent, delivered: false };
      const from = questStore.get(parent.id);
      quest.depth = (from?.depth ?? 0) + 1;
      // Handed on from a task: it belongs to that task's chain. Handed on from a chat: it starts a chain of its own.
      if (from) quest.root = from.root ?? from.id;
    }
    if (project) {
      quest.project = project;
      // Only bots that can change files get a branch and working copy of their own.
      if (!kind && bot.powers.some((p) => p === "files" || p === "shell")) quest.copy = await prepareCopy(project, quest.id, WORKTREE_DIR());
    }
    questStore.save(quest);
    // Every task shows on the board: one that did not come from a queue is recorded there now.
    if (!item && !kind) this.onStartedOutsideQueue(quest);
    journal.append(quest.id, { type: "quest_start", bot: bot.id, title: quest.title, project: project ?? null, branch: quest.copy?.branch ?? null });
    audit({ actor: bot.id, actorName: bot.title || bot.name, kind: "task", action: parent ? `Started a task handed on by ${parent.by}` : kind ? `Received a ${kind}` : "Started a task", detail: quest.title, task: quest.id });
    // Big work starts with a plan for the owner to approve: a task the owner gives to a lead, or to anyone if set so.
    // A briefing the owner switched on is not big work: it starts straight away, with no plan and no questions first.
    if (!parent && !kind && !template && !direct) {
      const when = getConfig().planFirst ?? "leads";
      const { assignableBy } = await import("./orgs.ts");
      if (when === "all" || (when === "leads" && assignableBy(org, bot.id).length > 0)) {
        quest.plan = { status: "drafting", version: 0, at: now };
        questStore.save(quest);
      }
    }
    // A task the owner gave (not a hand-off or a question between agents) is checked first: does the agent have what it needs?
    if (!parent && !kind && !template && !direct && getConfig().checkFirst !== false) {
      const asked = await this.#checkFirst(quest, text, project).catch((err) => {
        audit({ actor: bot.id, actorName: bot.title || bot.name, kind: "problem", action: "Could not check the task before starting; started anyway", detail: (err as Error).message, task: quest.id, ok: false });
        return false;
      });
      if (asked) return questStore.get(quest.id)!;
    }
    try {
      await this.#engine.startRun(quest.id, text, { keepTitle: true });
    } catch (err) {
      this.#set(quest.id, { status: "failed", note: (err as Error).message });
      throw err;
    }
    return questStore.get(quest.id)!;
  }

  /**
   * The check before a task starts. Returns true when the agent asked the owner for something instead of
   * starting: the task, and the agent's questions, are then in its conversation, and the owner's reply starts it.
   */
  async #checkFirst(quest: Quest, text: string, project: string | undefined): Promise<boolean> {
    const { checkReadiness, askingMessage } = await import("./readiness.ts");
    const r = await checkReadiness(quest.bot, text, project, AbortSignal.timeout(90_000));
    const conversation = conversations.get(quest.id);
    if (conversation) {
      // What the check cost belongs to the task, so it shows on its receipt and counts towards its budget.
      conversation.usage.input += r.input;
      conversation.usage.output += r.output;
      conversation.usage.cost = (conversation.usage.cost ?? 0) + r.cost;
    }
    const who = { actor: quest.bot.id, actorName: quest.bot.title || quest.bot.name, task: quest.id, cost: r.cost };
    if (r.ready) {
      if (conversation) conversations.save(conversation, { touch: false });
      audit({ ...who, kind: "task", action: "Checked the task before starting: has what it needs", detail: r.plan || undefined });
      return false;
    }
    const message = askingMessage(r);
    if (conversation) {
      conversation.messages.push({ role: "user", content: text }, { role: "assistant", content: [{ type: "text", text: message, citations: null }] as never });
      conversations.save(conversation);
    }
    this.#set(quest.id, { status: "asking", note: [...r.missing, ...r.questions].join(" · ").slice(0, 400), ...(r.grant.length ? { grant: r.grant } : {}) });
    audit({ ...who, kind: "task", action: "Asked the owner for what the task needs before starting", detail: [...r.missing.map((m) => `Missing: ${m}`), ...r.questions.map((q) => `Question: ${q}`)].join(" | ") });
    return true;
  }

  /**
   * Starts a core quest: fills in its inputs, gathers what it needs (commits,
   * issues, builds), and remembers what its result must cover for the check.
   */
  async startTemplate({ template, bot, given, project }: { template: QuestTemplate; bot: Bot; given: Record<string, unknown>; project?: string }): Promise<Quest> {
    if (template.repository === "required" && !project) throw new Error(`${template.name} works on a repository. Choose one at the top first.`);
    const inputs = resolveInputs(template, given);
    let gathered = { text: "", mustMention: [] as string[] };
    if (template.gather === "git-log") {
      const log = await gitLog(project!, inputs.since);
      inputs.since = log.since;
      gathered = log;
    } else if (template.gather === "github-issues" || template.gather === "github-report") {
      const slug = inputs.repo || (await githubSlug(project)) || "";
      inputs.repo = slug;
      gathered = template.gather === "github-issues" ? await githubIssues(slug) : await githubReport(slug, Math.max(1, Number(inputs.days) || 7));
    }
    const text = fill(template.prompt, { ...inputs, gathered: gathered.text }).trim();
    const first = template.inputs.map((i) => inputs[i.id]).find(Boolean);
    return this.start({
      bot,
      text,
      project,
      title: first ? `${template.name}: ${first}` : template.name,
      template: { id: template.id, name: template.name, check: template.check, inputs, mustMention: gathered.mustMention, tries: 0, maxTries: 2 },
    });
  }

  /** Checks a finished core quest. A failed check goes back to the bot while it has tries left. */
  async #check(id: string) {
    const quest = questStore.get(id);
    const conversation = quest?.template ? await conversations.get(id) : null;
    if (!quest?.template || !conversation) return;
    this.#set(id, { checking: true });
    let result: CheckResult;
    try {
      result = await runChecks({
        check: quest.template.check,
        conversation,
        copy: quest.outcome ? undefined : quest.copy,
        workspace: WORKSPACE,
        inputs: quest.template.inputs,
        mustMention: quest.template.mustMention,
      });
    } catch (err) {
      result = { passed: false, items: [{ label: "Check", passed: false, detail: (err as Error).message }], at: new Date().toISOString() };
    }
    journal.append(id, { type: "check", passed: result.passed, items: result.items });
    const { tries, maxTries } = quest.template;
    if (!result.passed && tries < maxTries) {
      // Not done: tell the bot what failed and let it fix it.
      this.#set(id, { checking: false, check: result, template: { ...quest.template, tries: tries + 1 } });
      await this.#engine.startRun(id, feedback(result, maxTries - tries), { keepTitle: true }).catch((err) => this.#set(id, { note: (err as Error).message }));
      return;
    }
    this.#set(id, { checking: false, check: result });
  }

  /** Hands a quest to another model (usually Claude), continuing where it stopped, with fresh tries. */
  async escalate(id: string, model: string) {
    const quest = questStore.get(id);
    if (!quest) throw new Error("Quest not found.");
    if (quest.status === "running" || quest.status === "waiting" || quest.checking) throw new Error("The quest is still under way.");
    if (quest.outcome) throw new Error("This quest's changes were already dealt with.");
    const failed = quest.check?.items.filter((i) => !i.passed) ?? [];
    this.#set(id, { modelOverride: model, ...(quest.template ? { template: { ...quest.template, tries: 0 } } : {}) });
    journal.append(id, { type: "escalate", model });
    const message = [
      `[This quest is now handed to ${model}, a stronger model, to finish.]`,
      failed.length ? `The last check failed:\n${failed.map((i) => `- ${i.label}${i.detail ? `: ${i.detail}` : ""}`).join("\n")}` : "",
      "Read what has been done so far, then finish the quest properly.",
    ]
      .filter(Boolean)
      .join("\n\n");
    await this.#engine.startRun(id, message, { keepTitle: true });
  }

  stop(id: string) {
    this.#stopping.add(id);
    this.#engine.stop(id);
  }

  /** Called by the engine for every event: keeps the journal and the quest's status. */
  /**
   * Sends the reports of finished hand-offs back to the conversation that
   * assigned them, as one message, once all of its hand-offs have stopped and
   * it is not busy itself. The manager (or the chat's agent) then carries on.
   */
  async deliverReports(parentId: string) {
    if (this.#engine.isRunning(parentId)) return; // it gets them when its own turn ends
    const all = questStore.list();
    const children = all.filter((q) => q.parent?.id === parentId && !q.parent.delivered);
    if (!children.length || children.some((q) => q.status === "running" || q.status === "waiting")) return;
    // Hand-offs still waiting in an agent's queue are part of the same answer: the reports go together once they have run.
    if (this.pendingHandoffs(parentId) > 0) return;
    // A child that is still waiting for its own hand-offs has only said "I have asked, I am waiting": that is not
    // its report. Its report goes up when its own reports have come in and it has finished again.
    if (children.some((child) => this.pendingHandoffs(child.id) > 0 || all.some((q) => q.parent?.id === child.id && (!q.parent.delivered || q.status === "running" || q.status === "waiting")))) return;
    for (const child of children) this.#set(child.id, { parent: { ...child.parent!, delivered: true } });
    const reports = children.reverse().map((child) => {
      const said = [...(conversations.get(child.id)?.messages ?? [])].reverse().find((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "text" && b.text.trim()));
      const text = said && Array.isArray(said.content) ? said.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim() : "";
      const how = { done: "finished", stopped: "was stopped", failed: `failed${child.note ? `: ${child.note}` : ""}`, budget: "stopped at its budget" }[child.status as string] ?? child.status;
      return `${REPORT_MARK}${child.bot.name} · ${child.title} · ${child.status === "done" && child.kind === "question" ? "answered" : child.status === "done" && child.kind === "decision" ? "decided" : how}]\n${text || "(It left no report.)"}`;
    });
    const parentQuest = questStore.get(parentId);
    const next = parentQuest
      ? "Check these reports against what you asked for. Then assign follow-up work if something is missing, or put them together and give your own report."
      : "Tell the user what came back, in your own words, and say plainly if a report failed or left something out.";
    try {
      await this.#engine.startRun(parentId, `${reports.join("\n\n")}\n\n[${next}]`, { keepTitle: true });
    } catch (err) {
      for (const child of children) this.#set(child.id, { note: `Its report could not be delivered: ${(err as Error).message}` });
    }
  }

  onEvent(id: string, event: RunEvent) {
    // When any conversation stops, reports that were waiting for it can go in.
    if (event.type === "status" && !event.running) {
      setTimeout(() => this.deliverReports(id).catch(() => {}), 50);
      // The agent may be free for its next task, and the owner's comments on this one can go in.
      setTimeout(() => this.onRunEnded(id), 60);
    }
    const quest = questStore.get(id);
    if (!quest) return;
    journal.append(id, event);
    // What the quest has cost so far counts towards its bot's month. A bot that
    // reaches its monthly budget part-way is stopped; its work so far is kept.
    if (event.type === "assistant" || event.type === "status") {
      recordSpend(id, quest.bot.id, conversations.get(id)?.usage.cost ?? 0, new Date(), quest.charge);
      if (event.type === "assistant" && budgetBlock(asItIsNow(quest.bot))) {
        this.#ending.set(id, "budget");
        this.#engine.stop(id);
      }
      // A group that reaches its monthly budget part-way stops its work too; what was done is kept.
      const groupOver = event.type === "assistant" ? groupStop(quest) : null;
      if (groupOver) {
        this.#ending.set(id, "budget");
        this.#set(id, { note: groupOver });
        this.#engine.stop(id);
      }
      // A task and everything handed on from it share one budget. When it is used up, the hand-offs stop;
      // the task itself carries on within its own limit, so it can still report what was found.
      if (event.type === "assistant" && quest.parent && rootOf(quest) !== id && chainOver(rootOf(quest))) {
        this.#ending.set(id, "budget");
        this.#set(id, { note: "The task it belongs to used its whole budget of $" + chainBudget().toFixed(2) + ", counting everything handed on." });
        this.#engine.stop(id);
      }
    }
    switch (event.type) {
      case "status":
        if (event.running) {
          this.#ending.delete(id);
          this.#stopping.delete(id);
          // A task that was waiting for the owner's answers starts now; its questions are no longer a note.
          this.#set(id, quest.status === "asking" ? { status: "running", note: undefined, grant: undefined } : { status: "running" });
        } else {
          const status = this.#stopping.has(id) ? "stopped" : (this.#ending.get(id) ?? "done");
          this.#ending.delete(id);
          this.#stopping.delete(id);
          this.#set(id, status === "done" ? { status, stop: undefined } : { status });
          // A run that stopped before finishing leaves a hand-over note, so the next run, or another agent, picks up from here.
          if (status !== "done" && !quest.kind) this.#handOver(id, status).catch(() => {});
          // The organization keeps a line about each task an agent finishes, so later work can build on it.
          if (status === "done" && !quest.kind) {
            const said = [...(conversations.get(id)?.messages ?? [])].reverse().find((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "text" && b.text.trim()));
            const report = said && Array.isArray(said.content) ? said.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim() : "";
            try {
              orgMemory.logTask(orgs.active(), quest.bot.id, quest.title, report);
            } catch {}
          }
          // A task handed down the chart reports back to whoever assigned it.
          if (quest.parent && !quest.parent.delivered) setTimeout(() => this.deliverReports(quest.parent!.id).catch(() => {}), 80);
          if (quest.copy && !quest.outcome) {
            changes(quest.copy)
              .then((c) => this.#set(id, { changedFiles: c.files.length }))
              .catch(() => {});
          }
          // A core quest that finished is checked before it counts as done.
          if (status === "done" && quest.template) {
            this.#check(id).catch((err) => this.#set(id, { checking: false, note: `Could not check the result: ${(err as Error).message}` }));
          }
        }
        break;
      case "approval":
        this.#set(id, { status: "waiting" });
        break;
      case "approval_done":
        if (quest.status === "waiting") this.#set(id, { status: "running" });
        break;
      case "assistant":
        this.#set(id, { steps: quest.steps + 1 });
        break;
      case "notice":
        if (event.text.startsWith("Stopped at its budget")) this.#ending.set(id, "budget");
        break;
      case "stopped":
        // A budget stop is "budget"; time, a repeated step or steps that keep failing mean the task is stuck.
        this.#ending.set(id, ["steps", "spend", "shared"].includes(event.reason) ? "budget" : "failed");
        this.#set(id, { stop: event.reason, note: event.text });
        break;
      case "error":
        this.#ending.set(id, "failed");
        this.#set(id, { note: event.text });
        break;
      case "resumed":
        this.#set(id, { resumedAt: new Date().toISOString() });
        break;
    }
  }

  async #handOver(id: string, status: QuestStatus) {
    const quest = questStore.get(id);
    if (!quest) return;
    const why = status === "stopped" ? "you stopped it." : (quest.note ?? (status === "budget" ? "it reached its budget." : "it ran into a problem."));
    const handover = handoverOf(quest, why.replace(/^Stopped(:| at its)\s*/i, "").replace(/ Say "continue"[^.]*\./, "").trim() || why);
    this.#set(id, { handover });
    // On a task from the board, the note is also left on the task, where the owner reads it and any successor's brief includes it.
    const { work } = await import("./work.ts");
    const org = orgs.active();
    const item = work.ofQuest(org, id);
    if (item) await work.comment(org, item.id, handoverText(handover, `the ${quest.bot.name}`), quest.bot.id).catch(() => {});
    // The others on the task see it on the task's board too.
    const { board } = await import("./board.ts");
    try {
      board.post(org, rootOf(quest), quest.bot.id, "handover", `Stopped: ${handover.why} ${handover.next}`);
    } catch {}
  }

  /** The agent submitted its plan: the run ends, and the task waits for the owner's approval. */
  planSubmitted(id: string, plan: Omit<Plan, "status" | "version" | "at">) {
    const quest = questStore.get(id);
    if (!quest?.plan) throw new Error("This task does not need a plan.");
    if (quest.plan.status === "approved") throw new Error("Your plan is already approved. Carry it out.");
    const next: Plan = { ...quest.plan, ...plan, status: "proposed", version: quest.plan.version + 1, at: new Date().toISOString() };
    this.#ending.set(id, "asking");
    this.#set(id, { plan: next, note: "Plan waiting for your approval" });
    audit({ actor: quest.bot.id, actorName: quest.bot.title || quest.bot.name, kind: "task", task: id, action: `Sent a plan for approval${next.version > 1 ? ` (version ${next.version})` : ""}`, detail: next.summary });
  }

  /** The owner approves the plan, or asks for changes: either way the agent carries on. */
  async decidePlan(id: string, decision: unknown, comment: unknown) {
    const quest = questStore.get(id);
    if (!quest?.plan || quest.plan.status !== "proposed") throw new Error("There is no plan waiting for your approval on this task.");
    const said = String(comment ?? "").trim().slice(0, 4000);
    if (decision === "approve") {
      this.#set(id, { plan: { ...quest.plan, status: "approved", at: new Date().toISOString() }, note: undefined });
      audit({ actor: "owner", actorName: "You", kind: "approval", task: id, action: "Approved a plan", detail: quest.plan.summary });
      await this.resume(id, `[Your plan is approved${said ? `, with this note from the owner: ${said}` : ""}. Carry it out now, step by step, then end with a short report.]`);
    } else if (decision === "changes") {
      if (said.length < 3) throw new Error("Say what should change in the plan.");
      this.#set(id, { plan: { ...quest.plan, status: "changes", feedback: said, at: new Date().toISOString() }, note: undefined });
      audit({ actor: "owner", actorName: "You", kind: "approval", task: id, action: "Asked for changes to a plan", detail: said });
      await this.resume(id, `[The owner asks for changes to your plan: ${said}\n\nRevise the plan and submit it again with submit_plan. Do not start the work yet.]`);
    } else throw new Error("Approve the plan, or ask for changes.");
    return questStore.get(id)!;
  }

  #set(id: string, patch: Partial<Quest>) {
    const quest = questStore.get(id);
    if (quest) questStore.save({ ...quest, ...patch });
  }

  /** At start-up: picks up every quest that was under way when the app last closed. */
  async resumeAll(): Promise<string[]> {
    const resumed: string[] = [];
    for (const quest of this.running()) {
      try {
        const run = await this.#engine.resumeRun(quest.id, journal.started(quest.id));
        if (run) resumed.push(quest.id);
        else this.#set(quest.id, { status: "done" });
      } catch (err) {
        this.#set(quest.id, { status: "failed", note: `Could not resume: ${(err as Error).message}` });
      }
    }
    return resumed;
  }

  #closable(id: string): Quest & { copy: QuestCopy } {
    const quest = questStore.get(id);
    if (!quest) throw new Error("Quest not found.");
    if (!quest.copy) throw new Error("This quest did not work on a repository, so there are no changes to review.");
    if (quest.outcome) throw new Error("This quest's changes were already dealt with.");
    if (quest.status === "running" || quest.status === "waiting") throw new Error("The quest is still under way. Stop it or wait for it to finish first.");
    return quest as Quest & { copy: QuestCopy };
  }

  async changes(id: string): Promise<Changes> {
    const quest = questStore.get(id);
    if (!quest?.copy || quest.outcome) return { files: [], diff: "", truncated: false };
    return changes(quest.copy);
  }

  /** Keeps the quest's changes as a commit on its own branch. */
  async accept(id: string): Promise<{ branch: string | null }> {
    const quest = this.#closable(id);
    const branch = await acceptCopy(quest.copy, `${quest.title}\n\nTask by ${quest.bot.name === quest.bot.title ? quest.bot.name : `${quest.bot.name} (${quest.bot.title})`} in Talqava.`);
    this.#set(id, { outcome: branch ? "accepted" : "no-changes" });
    journal.append(id, { type: "quest_accept", branch });
    return { branch };
  }

  /** Throws away everything the quest changed. */
  async undo(id: string) {
    const quest = this.#closable(id);
    await undoCopy(quest.copy);
    this.#set(id, { outcome: "undone" });
    journal.append(id, { type: "quest_undo" });
  }
}

export const quests = new QuestRunner();
