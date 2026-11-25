// Work items: the tasks of an organization, as lasting pieces of work rather than one-off runs.
//
// A task has a title, what is wanted, a priority, one owner (a position on the chart), an optional parent task, and
// comments. Each agent works through its own queue one task at a time, highest priority first: when it is free, the
// scheduler starts its next task as a run (a quest), and the task follows that run. Hand-offs between agents are
// sub-tasks that queue the same way. Work the owner gives ends in "To review", where the owner accepts it or sends it
// back with a comment; a comment wakes the agent, or waits until its current step ends.
//
// The owner stays in charge: a task (with everything under it), one agent, or all work can be paused. Pausing stops
// work under way at a clean point (its run leaves a hand-over note) and keeps queued work from starting; resuming
// carries on from that note.
import type { DatabaseSync } from "node:sqlite";
import { newId, conversations } from "./store.ts";
import { orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { openOrgDb } from "./library.ts";
import { loadCrew } from "./crew.ts";
import { audit } from "./audit.ts";
import { MAX_RUNNING, handoverText, questStore, quests, setWhyGoal } from "./quests.ts";
import { goalLine, goals, goalsDb } from "./goals.ts";
import type { Quest } from "./quests.ts";

export type Priority = "urgent" | "high" | "normal" | "low";
export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
/** What is stored: whether the task has started, and whether the owner closed it. */
type State = "todo" | "started" | "done" | "cancelled";
/** What the owner sees. */
export type Status = "todo" | "working" | "waiting" | "blocked" | "review" | "done" | "cancelled" | "paused";

export interface WorkItem {
  id: string;
  number: number;
  title: string;
  description: string;
  priority: Priority;
  /** The agent (position) that owns it. */
  owner: string;
  ownerName: string;
  parent: string | null;
  /** Who created it: "owner", an agent's id, or "chat". */
  createdBy: string;
  createdByName: string;
  /** True when the owner reviews the result; a hand-off's result goes to whoever handed it on instead. */
  review: boolean;
  status: Status;
  /** Why it is waiting or blocked, or what it is doing, in a few words. */
  detail: string;
  /** The run doing the work, once it has started. */
  quest: string | null;
  /** The goal it serves (its own, or its project's), and the project it is part of. */
  goal: string | null;
  goalTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  project: string | null;
  /** Its place in its owner's queue (1 is next), while it is waiting to start. */
  queue: number | null;
  /** When the owner paused this task (or a task above it); null when it is not paused itself. */
  pausedAt: string | null;
  subtasks: { total: number; open: number };
  comments: number;
  cost: number;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  author: string;
  authorName: string;
  text: string;
  at: string;
  delivered: boolean;
}

interface Row {
  id: string;
  number: number;
  title: string;
  description: string;
  priority: string;
  owner: string;
  parent: string | null;
  created_by: string;
  review: number;
  state: string;
  quest: string | null;
  project: string | null;
  handoff: string | null;
  held: string | null;
  goal: string | null;
  project_id: string | null;
  paused: string | null;
  created_at: string;
  updated_at: string;
}

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const now = () => new Date().toISOString();
const ready = new WeakSet<DatabaseSync>();

function db(orgId: string): DatabaseSync {
  const d = openOrgDb(orgId);
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists work_items (
      id text primary key,
      number integer not null,
      title text not null,
      description text not null default '',
      priority text not null default 'normal',
      owner text not null,
      parent text,
      created_by text not null,
      review integer not null default 1,
      state text not null default 'todo',
      quest text,
      project text,
      handoff text,
      held text,
      goal text,
      project_id text,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists work_items_owner on work_items(owner, state);
    create index if not exists work_items_quest on work_items(quest);
    create index if not exists work_items_parent on work_items(parent);
    create table if not exists work_comments (id text primary key, item text not null, author text not null, text text not null, at text not null, delivered integer not null default 0);
    create index if not exists work_comments_item on work_comments(item, at);
  `);
  // The goals' and projects' tables, and (for tasks made before them) the tasks' two links to them.
  goalsDb(orgId);
  // Pausing: when a task was paused, and which agents are paused (with the runs a pause stopped, to carry on later).
  if (!(d.prepare("select 1 from pragma_table_info('work_items') where name = 'paused'").get())) d.exec("alter table work_items add column paused text");
  d.exec("create table if not exists agent_pauses (bot text primary key, at text not null, stopped text not null default '[]')");
  ready.add(d);
  return d;
}

const all = (d: DatabaseSync) => d.prepare("select * from work_items order by number").all() as unknown as Row[];
const rowOf = (d: DatabaseSync, id: string) => d.prepare("select * from work_items where id = ?").get(String(id)) as unknown as Row | undefined;
const bots = () => new Map(loadCrew().bots.map((b) => [b.id, b]));
const nameOf = (org: Org, id: string, crew = bots()) => (id === "owner" ? "You" : id === "chat" ? "Talqava" : (org.members.find((m) => m.bot === id)?.title ?? crew.get(id)?.title ?? crew.get(id)?.name ?? id));
const cleanTitle = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

/** A run counts as keeping its agent busy while it is working or waiting for an approval mid-step. */
const busy = (q: Quest | null | undefined) => q?.status === "running" || q?.status === "waiting";

/** What the owner sees, from what is stored and how the run is going. */
function statusOf(row: Row, rows: Row[], quest: Quest | null, pausedAgent?: string): { status: Status; detail: string } {
  if (row.state === "cancelled") return { status: "cancelled", detail: "" };
  if (row.state === "done") return { status: "done", detail: "" };
  // Paused work that is not under way: it waits for the owner. A run still finishing its step shows as working.
  if ((row.paused || pausedAgent) && !busy(quest) && !(quest?.status === "done" && row.state === "started")) {
    return { status: "paused", detail: row.paused ? "Paused by you" : `Paused: the ${pausedAgent} is paused` };
  }
  if (row.state === "todo") return row.held ? { status: "blocked", detail: row.held } : { status: "todo", detail: "" };
  if (!quest) return { status: "blocked", detail: "Its run is gone." };
  if (quest.status === "running") return { status: "working", detail: "" };
  if (quest.status === "waiting") return { status: "waiting", detail: "Needs your approval for a step" };
  if (quest.status === "asking" && quest.plan?.status === "proposed") return { status: "waiting", detail: "Its plan is waiting for your approval" };
  if (quest.status === "asking") return { status: "waiting", detail: quest.note ? `Asked: ${quest.note}` : "Asked you for what it needs" };
  if (quest.status === "failed") return { status: "blocked", detail: quest.note || "It failed." };
  if (quest.status === "budget") return { status: "blocked", detail: quest.note || "It reached its budget." };
  if (quest.status === "stopped") return { status: "blocked", detail: "Stopped before it finished." };
  if (quest.check && !quest.check.passed) return { status: "blocked", detail: "Its result did not pass its check." };
  const open = rows.filter((r) => r.parent === row.id && r.state !== "done" && r.state !== "cancelled" && !(r.state === "started" && finishedRun(r)));
  if (open.length) return { status: "working", detail: `Waiting on ${open.length} sub-task${open.length === 1 ? "" : "s"}` };
  return row.review ? { status: "review", detail: "" } : { status: "done", detail: "" };
}
/** A started task whose run ended well, with nothing left open under it. */
const finishedRun = (r: Row) => ((q) => q?.status === "done" && !(q.check && !q.check.passed))(r.quest ? questStore.get(r.quest) : null);

type Links = { goals: Map<string, string>; projects: Map<string, { title: string; goal: string | null }> };
function linksOf(org: Org): Links {
  try {
    return { goals: new Map(goals.list(org).map((g) => [g.id, g.title])), projects: new Map(goals.projects(org).map((p) => [p.id, { title: p.title, goal: p.goal }])) };
  } catch {
    return { goals: new Map(), projects: new Map() };
  }
}

function toItem(org: Org, row: Row, rows: Row[], crew = bots(), counts?: Map<string, number>, links: Links = linksOf(org), paused: Set<string> = pausedAgents(org)): WorkItem {
  const project = row.project_id ? links.projects.get(row.project_id) : undefined;
  const goal = row.goal ?? project?.goal ?? null;
  const quest = row.quest ? questStore.get(row.quest) : null;
  const { status, detail } = statusOf(row, rows, quest, paused.has(row.owner) ? nameOf(org, row.owner, crew) : undefined);
  const subs = rows.filter((r) => r.parent === row.id);
  let queue: number | null = null;
  if (status === "todo") {
    const mine = rows.filter((r) => r.owner === row.owner && r.state === "todo" && !r.held && !r.paused).sort(order);
    queue = mine.findIndex((r) => r.id === row.id) + 1;
  }
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    priority: (PRIORITIES.includes(row.priority as Priority) ? row.priority : "normal") as Priority,
    owner: row.owner,
    ownerName: nameOf(org, row.owner, crew),
    parent: row.parent,
    createdBy: row.created_by,
    createdByName: nameOf(org, row.created_by, crew),
    review: Boolean(row.review),
    status,
    detail,
    quest: row.quest,
    goal,
    goalTitle: goal ? (links.goals.get(goal) ?? null) : null,
    projectId: row.project_id,
    projectName: project?.title ?? null,
    project: row.project,
    queue,
    pausedAt: row.paused,
    subtasks: { total: subs.length, open: subs.filter((r) => r.state !== "done" && r.state !== "cancelled").length },
    comments: counts?.get(row.id) ?? 0,
    cost: quest ? (conversations.get(quest.id)?.usage.cost ?? 0) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
/** The agents the owner has paused. */
function pausedAgents(org: Org): Set<string> {
  return new Set((db(org.id).prepare("select bot from agent_pauses").all() as unknown as { bot: string }[]).map((r) => r.bot));
}

/** A task and every task under it. */
function treeOf(rows: Row[], id: string): Row[] {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) if (r.parent && ids.has(r.parent) && !ids.has(r.id)) ids.add(r.id), (grew = true);
  }
  return rows.filter((r) => ids.has(r.id));
}
const open = (r: Row) => r.state !== "done" && r.state !== "cancelled";

/** Carries on a task's run that a pause stopped, from the hand-over note it left. */
async function carryOn(row: Row) {
  const quest = row.quest ? questStore.get(row.quest) : null;
  if (!quest || busy(quest) || quests.isRunning(quest.id) || quest.status !== "stopped") return false;
  const note = quest.handover ? `\n\n${handoverText(quest.handover, "your last run")}` : "";
  await quests.resume(quest.id, `[The owner paused this task and has now resumed it. Carry on from where you stopped, then end with a short report.]${note}`);
  return true;
}

const order = (a: Row, b: Row) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || a.number - b.number;

/** What the agent is told when its task starts: the task, where it fits, and what the owner has said about it. */
function briefOf(org: Org, row: Row, rows: Row[]): string {
  const parent = row.parent ? rows.find((r) => r.id === row.parent) : undefined;
  const comments = db(org.id).prepare("select author, text from work_comments where item = ? order by at").all(row.id) as unknown as { author: string; text: string }[];
  const handoff = row.handoff ? (JSON.parse(row.handoff) as { conversation: string; by: string; text?: string }) : null;
  const serves = servesLine(org, row);
  // A hand-off carries the text its sender wrote, which already says who it is from and where the report goes.
  const notes = comments.length ? `Notes on this task:\n${comments.map((c) => `- ${nameOf(org, c.author)}: ${c.text}`).join("\n")}` : "";
  if (handoff?.text) return [handoff.text, serves, notes].filter(Boolean).join("\n\n");
  return [
    row.description.trim() || row.title,
    serves,
    parent ? `[This is part of the task “${parent.title}”.]` : "",
    notes,
    `[Task #${row.number}${row.priority !== "normal" ? `, ${row.priority} priority` : ""}. End with a short report of what you did and what you found.]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** "[This task serves the goal … through the project ….]", or "" when it is linked to neither. */
function servesLine(org: Org, row: Pick<Row, "goal" | "project_id">): string {
  try {
    const project = row.project_id ? goals.project(org, row.project_id) : null;
    const goalId = row.goal ?? project?.goal ?? null;
    const goal = goalId ? goals.get(org, goalId) : null;
    if (!goal && !project) return "";
    return `[This task serves ${goal ? `the goal ${goalLine(goal)}` : "the organization"}${project ? ` through the project “${project.title}”` : ""}. Keep the work aimed at that.]`;
  } catch {
    return "";
  }
}

let scheduling: Promise<void> | null = null;
let again = false;

export const work = {
  /** A new task. It starts as soon as its owner is free, in priority order. */
  create(org: Org, input: { title?: unknown; description?: unknown; owner: string; priority?: unknown; parent?: unknown; createdBy: string; review?: boolean; project?: string | null; handoff?: { conversation: string; by: string; text: string }; goal?: unknown; projectId?: unknown }): WorkItem {
    const d = db(org.id);
    const crew = bots();
    if (!crew.has(input.owner)) throw new Error("Choose an agent for the task.");
    const title = cleanTitle(input.title) || cleanTitle(input.description).slice(0, 80);
    if (!title) throw new Error("Say what the task is.");
    const parent = input.parent ? rowOf(d, String(input.parent)) : undefined;
    if (input.parent && !parent) throw new Error("There is no such parent task.");
    const priority = PRIORITIES.includes(input.priority as Priority) ? (input.priority as Priority) : ((parent?.priority as Priority) ?? "normal");
    // A sub-task serves what its parent serves, unless it is given its own goal or project.
    const projectId = input.projectId ? goals.project(org, String(input.projectId)).id : (parent?.project_id ?? null);
    const goal = input.goal ? goals.get(org, String(input.goal)).id : input.projectId ? null : (parent?.goal ?? null);
    const number = ((d.prepare("select max(number) n from work_items").get() as { n: number | null }).n ?? 0) + 1;
    const id = newId();
    d.prepare("insert into work_items (id, number, title, description, priority, owner, parent, created_by, review, state, project, handoff, goal, project_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)").run(
      id, number, title, String(input.description ?? "").trim().slice(0, 20_000), priority, input.owner, parent?.id ?? null, input.createdBy, input.review === false ? 0 : 1, input.project ?? null, input.handoff ? JSON.stringify(input.handoff) : null, goal, projectId, now(), now(),
    );
    audit({ actor: input.createdBy === "owner" ? "owner" : input.createdBy, actorName: nameOf(org, input.createdBy, crew), kind: "task", action: `Created task #${number} for the ${nameOf(org, input.owner, crew)}`, detail: title });
    return this.get(org, id);
  },

  /** Every task of the organization, newest first. */
  list(org: Org): WorkItem[] {
    const d = db(org.id);
    const rows = all(d);
    const crew = bots();
    const counts = new Map((d.prepare("select item, count(*) n from work_comments group by item").all() as unknown as { item: string; n: number }[]).map((r) => [r.item, r.n]));
    const links = linksOf(org);
    const paused = pausedAgents(org);
    return rows.map((r) => toItem(org, r, rows, crew, counts, links, paused)).reverse();
  },

  get(org: Org, id: string): WorkItem {
    const d = db(org.id);
    const rows = all(d);
    const row = rows.find((r) => r.id === String(id));
    if (!row) throw new Error("There is no such task.");
    const counts = new Map([[row.id, (d.prepare("select count(*) n from work_comments where item = ?").get(row.id) as { n: number }).n]]);
    return toItem(org, row, rows, bots(), counts);
  },

  /** The task that a run is doing, if any. */
  ofQuest(org: Org, questId: string): WorkItem | null {
    const row = db(org.id).prepare("select id from work_items where quest = ?").get(questId) as { id: string } | undefined;
    return row ? this.get(org, row.id) : null;
  },

  comments(org: Org, id: string): Comment[] {
    const crew = bots();
    return (db(org.id).prepare("select * from work_comments where item = ? order by at").all(String(id)) as unknown as { id: string; author: string; text: string; at: string; delivered: number }[]).map((c) => ({ id: c.id, author: c.author, authorName: nameOf(org, c.author, crew), text: c.text, at: c.at, delivered: Boolean(c.delivered) }));
  },

  /** The owner changes a task: its title, what is wanted, its priority, or (before it starts) who does it. */
  update(org: Org, id: string, patch: { title?: unknown; description?: unknown; priority?: unknown; owner?: unknown; goal?: unknown; projectId?: unknown }): WorkItem {
    const d = db(org.id);
    const row = rowOf(d, id);
    if (!row) throw new Error("There is no such task.");
    if (patch.title !== undefined) d.prepare("update work_items set title = ? where id = ?").run(cleanTitle(patch.title) || row.title, row.id);
    if (patch.description !== undefined) d.prepare("update work_items set description = ? where id = ?").run(String(patch.description ?? "").slice(0, 20_000), row.id);
    if (patch.priority !== undefined) {
      if (!PRIORITIES.includes(patch.priority as Priority)) throw new Error("Choose urgent, high, normal or low.");
      d.prepare("update work_items set priority = ? where id = ?").run(String(patch.priority), row.id);
    }
    if (patch.owner !== undefined && patch.owner !== row.owner) {
      if (!bots().has(String(patch.owner))) throw new Error("There is no such agent.");
      if (row.state === "todo") d.prepare("update work_items set owner = ?, held = null, paused = null where id = ?").run(String(patch.owner), row.id);
      else this.reassign(org, row, String(patch.owner));
    }
    if (patch.goal !== undefined) d.prepare("update work_items set goal = ? where id = ?").run(patch.goal ? goals.get(org, String(patch.goal)).id : null, row.id);
    if (patch.projectId !== undefined) d.prepare("update work_items set project_id = ? where id = ?").run(patch.projectId ? goals.project(org, String(patch.projectId)).id : null, row.id);
    d.prepare("update work_items set updated_at = ? where id = ?").run(now(), row.id);
    this.kick();
    return this.get(org, id);
  },

  /**
   * Succession: a task that stopped (stuck, at its budget, failed or stopped by the owner) moves to another agent. Its
   * run is kept in its history; the new agent starts a fresh run from the brief, which includes the hand-over note the
   * last agent left on the task. A task still working, or already done, is not moved.
   */
  reassign(org: Org, row: Row, owner: string) {
    const quest = row.quest ? questStore.get(row.quest) : null;
    if (busy(quest) || (row.quest && quests.isRunning(row.quest))) throw new Error("It is working now. Stop it first, then give it to someone else.");
    if (row.state === "done" || row.state === "cancelled") throw new Error("This task is finished. Create a new task for someone else.");
    if (quest?.status === "done" && !(quest.check && !quest.check.passed)) throw new Error("This task finished and is waiting for your review. Send it back with a comment, or create a new task for someone else.");
    const d = db(org.id);
    const crew = bots();
    const from = nameOf(org, row.owner, crew);
    const to = nameOf(org, owner, crew);
    d.prepare("update work_items set owner = ?, quest = null, state = 'todo', held = null, paused = null where id = ?").run(owner, row.id);
    d.prepare("insert into work_comments (id, item, author, text, at, delivered) values (?, ?, 'owner', ?, ?, 1)").run(newId(), row.id, `Given to the ${to}, from the ${from}. Pick up from the hand-over note above, not from the start.`, now());
    audit({ actor: "owner", actorName: "You", kind: "task", action: `Gave task #${row.number} to the ${to}`, detail: `It had stopped with the ${from}: ${row.title}` });
  },

  /** Cancels a task and the sub-tasks under it that have not finished; a run under way is stopped, its work kept. */
  cancel(org: Org, id: string): WorkItem {
    const d = db(org.id);
    const rows = all(d);
    const root = rows.find((r) => r.id === String(id));
    if (!root) throw new Error("There is no such task.");
    const gone = new Set([root.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows) if (r.parent && gone.has(r.parent) && !gone.has(r.id)) gone.add(r.id), (grew = true);
    }
    for (const r of rows.filter((x) => gone.has(x.id) && x.state !== "done" && x.state !== "cancelled")) {
      if (r.quest && busy(questStore.get(r.quest))) quests.stop(r.quest);
      d.prepare("update work_items set state = 'cancelled', updated_at = ? where id = ?").run(now(), r.id);
    }
    audit({ actor: "owner", actorName: "You", kind: "task", action: `Cancelled task #${root.number}`, detail: root.title });
    this.kick();
    return this.get(org, root.id);
  },

  /** The owner accepts finished work. */
  accept(org: Org, id: string): WorkItem {
    const d = db(org.id);
    const item = this.get(org, id);
    if (item.status !== "review" && item.status !== "blocked" && item.status !== "waiting") throw new Error("Only finished work can be accepted.");
    d.prepare("update work_items set state = 'done', updated_at = ? where id = ?").run(now(), item.id);
    audit({ actor: "owner", actorName: "You", kind: "task", action: `Accepted task #${item.number}`, detail: item.title });
    return this.get(org, id);
  },

  /**
   * A comment on a task. From the owner, it is passed to the agent: straight away when its run is between steps (which
   * wakes it), when its current step ends if it is working, or in its brief if the task has not started.
   */
  async comment(org: Org, id: string, text: unknown, author = "owner"): Promise<WorkItem> {
    const d = db(org.id);
    const row = rowOf(d, id);
    if (!row) throw new Error("There is no such task.");
    const said = String(text ?? "").trim().slice(0, 8000);
    if (!said) throw new Error("Write the comment.");
    if (row.state === "cancelled") throw new Error("This task was cancelled.");
    d.prepare("insert into work_comments (id, item, author, text, at, delivered) values (?, ?, ?, ?, ?, 0)").run(newId(), row.id, author, said, now());
    // A finished or accepted task the owner comments on goes back to work.
    if (author === "owner" && row.state === "done") d.prepare("update work_items set state = 'started' where id = ?").run(row.id);
    d.prepare("update work_items set updated_at = ? where id = ?").run(now(), row.id);
    if (author === "owner") audit({ actor: "owner", actorName: "You", kind: "task", task: row.quest ?? undefined, action: `Commented on task #${row.number}`, detail: said.slice(0, 300) });
    await this.deliverComments(org, row.id);
    return this.get(org, row.id);
  },

  /** Passes the owner's undelivered comments to the task's run, if it can take them now. */
  async deliverComments(org: Org, id: string) {
    const d = db(org.id);
    const row = rowOf(d, id);
    if (!row?.quest || row.state === "todo") return; // not started: comments go into its brief
    if (row.paused || pausedAgents(org).has(row.owner)) return; // paused: they go in when it is resumed
    const quest = questStore.get(row.quest);
    if (!quest || busy(quest) || quests.isRunning(row.quest)) return; // working: delivered when its step ends
    const pending = d.prepare("select id, text from work_comments where item = ? and author = 'owner' and delivered = 0 order by at").all(row.id) as unknown as { id: string; text: string }[];
    if (!pending.length) return;
    for (const c of pending) d.prepare("update work_comments set delivered = 1 where id = ?").run(c.id);
    if (row.state === "done") d.prepare("update work_items set state = 'started' where id = ?").run(row.id);
    const message = `${pending.map((c) => c.text).join("\n\n")}\n\n[From the owner, about this task. Act on it, then end with a short report.]`;
    await quests.resume(row.quest, message);
  },

  /** Tries a blocked task again: one that could not start goes back in the queue; a stopped run carries on. */
  async retry(org: Org, id: string): Promise<WorkItem> {
    const d = db(org.id);
    const row = rowOf(d, id);
    if (!row) throw new Error("There is no such task.");
    if (row.paused) throw new Error("This task is paused. Resume it instead.");
    if (pausedAgents(org).has(row.owner)) throw new Error(`The ${nameOf(org, row.owner)} is paused. Resume the agent first, or give the task to someone else.`);
    if (row.state === "todo") d.prepare("update work_items set held = null, updated_at = ? where id = ?").run(now(), row.id);
    else if (row.quest && !busy(questStore.get(row.quest))) {
      // It carries on from its own hand-over note: why it stopped, what it did, and where it got to.
      const stopped = questStore.get(row.quest);
      const note = stopped?.handover ? `\n\n${handoverText(stopped.handover, "your last run")}` : "";
      const hint = stopped?.stop === "repeat" || stopped?.stop === "failing" ? " Last time it got stuck: try a different way rather than repeating the same step." : "";
      await quests.resume(row.quest, `[Carry on with this task from where it stopped, then end with a short report.${hint}]${note}`);
    }
    this.kick();
    return this.get(org, id);
  },

  /**
   * Pauses a task and every open task under it. Work under way stops at a clean point and leaves a hand-over note;
   * work not started stays in its queue without starting. Nothing is lost.
   */
  pause(org: Org, id: string): WorkItem {
    const d = db(org.id);
    const rows = all(d);
    const root = rows.find((r) => r.id === String(id));
    if (!root) throw new Error("There is no such task.");
    if (!open(root)) throw new Error("This task is finished, so there is nothing to pause.");
    const at = now();
    for (const r of treeOf(rows, root.id).filter((r) => open(r) && !r.paused)) {
      d.prepare("update work_items set paused = ?, updated_at = ? where id = ?").run(at, now(), r.id);
      if (r.quest && (busy(questStore.get(r.quest)) || quests.isRunning(r.quest))) quests.stop(r.quest);
    }
    audit({ actor: "owner", actorName: "You", kind: "task", action: `Paused task #${root.number}`, detail: root.title });
    return this.get(org, root.id);
  },

  /** Resumes a paused task and the tasks under it: stopped runs carry on from their hand-over notes, queued ones can start. */
  async resume(org: Org, id: string): Promise<WorkItem> {
    const d = db(org.id);
    const rows = all(d);
    const root = rows.find((r) => r.id === String(id));
    if (!root) throw new Error("There is no such task.");
    const agents = pausedAgents(org);
    for (const r of treeOf(rows, root.id).filter((r) => r.paused)) {
      d.prepare("update work_items set paused = null, updated_at = ? where id = ?").run(now(), r.id);
      if (open(r) && !agents.has(r.owner)) {
        if (await carryOn(r)) d.prepare("update work_comments set delivered = 1 where item = ? and author = 'owner'").run(r.id);
      }
    }
    audit({ actor: "owner", actorName: "You", kind: "task", action: `Resumed task #${root.number}`, detail: root.title });
    this.kick();
    return this.get(org, root.id);
  },

  /** The agents that are paused, by id, with when. */
  pausedAgents(org: Org): { bot: string; name: string; at: string }[] {
    return (db(org.id).prepare("select bot, at from agent_pauses order by at").all() as unknown as { bot: string; at: string }[]).map((r) => ({ ...r, name: nameOf(org, r.bot) }));
  },

  /** Pauses agents (one, or every agent on the chart): their work under way stops at a clean point, and nothing new starts. */
  pauseAgents(org: Org, ids: string[]): string[] {
    const d = db(org.id);
    const crew = bots();
    const done: string[] = [];
    for (const bot of ids) {
      if (!crew.has(bot)) throw new Error("There is no such agent.");
      if (d.prepare("select 1 from agent_pauses where bot = ?").get(bot)) continue;
      const stopped = quests.running().filter((q) => q.bot.id === bot).map((q) => q.id);
      d.prepare("insert into agent_pauses (bot, at, stopped) values (?, ?, ?)").run(bot, now(), JSON.stringify(stopped));
      for (const q of stopped) quests.stop(q);
      done.push(bot);
    }
    if (done.length) audit({ actor: "owner", actorName: "You", kind: "agent", action: done.length === 1 ? `Paused the ${nameOf(org, done[0], crew)}` : `Paused ${done.length} agents`, detail: done.length === 1 ? undefined : done.map((b) => nameOf(org, b, crew)).join(", ") });
    return done;
  },

  /** Resumes paused agents: the runs their pause stopped carry on, and their queues start again. */
  async resumeAgents(org: Org, ids: string[]): Promise<string[]> {
    const d = db(org.id);
    const done: string[] = [];
    for (const bot of ids) {
      const pause = d.prepare("select stopped from agent_pauses where bot = ?").get(bot) as { stopped: string } | undefined;
      if (!pause) continue;
      d.prepare("delete from agent_pauses where bot = ?").run(bot);
      done.push(bot);
      const stopped = new Set(JSON.parse(pause.stopped) as string[]);
      for (const r of all(d).filter((r) => r.quest && stopped.has(r.quest) && open(r) && !r.paused)) await carryOn(r);
    }
    if (done.length) audit({ actor: "owner", actorName: "You", kind: "agent", action: done.length === 1 ? `Resumed the ${nameOf(org, done[0])}` : `Resumed ${done.length} agents` });
    this.kick();
    return done;
  },

  /** Hand-offs waiting in a queue for this conversation: its reports are not complete until they have run. */
  pendingFor(conversationId: string): number {
    try {
      const d = db(orgs.active().id);
      return (d.prepare("select count(*) n from work_items where state = 'todo' and held is null and json_extract(handoff, '$.conversation') = ?").get(conversationId) as { n: number }).n;
    } catch {
      return 0;
    }
  },

  /** Records a run started outside the queue (a core task, a schedule, another AI app) as a task, so the board shows all work. */
  adopt(quest: Quest) {
    try {
      const org = orgs.active();
      const d = db(org.id);
      if (d.prepare("select 1 from work_items where quest = ?").get(quest.id)) return;
      const number = ((d.prepare("select max(number) n from work_items").get() as { n: number | null }).n ?? 0) + 1;
      d.prepare("insert into work_items (id, number, title, description, priority, owner, parent, created_by, review, state, quest, project, created_at, updated_at) values (?, ?, ?, '', 'normal', ?, null, 'owner', 1, 'started', ?, ?, ?, ?)").run(newId(), number, cleanTitle(quest.title) || "A task", quest.bot.id, quest.id, quest.project ?? null, quest.createdAt, now());
    } catch {}
  },

  /** Asks the scheduler to look at the queues soon. */
  kick() {
    setTimeout(() => void this.schedule(), 20);
  },

  /**
   * Starts the next task of every free agent, highest priority first, while fewer than the most runs at once are under
   * way. An agent is free when none of its runs is working or waiting for an approval mid-step.
   */
  schedule(): Promise<void> {
    if (scheduling) {
      again = true;
      return scheduling;
    }
    scheduling = (async () => {
      do {
        again = false;
        let org: Org;
        try {
          org = orgs.active();
        } catch {
          return;
        }
        const d = db(org.id);
        const rows = all(d);
        const runningQuests = quests.running();
        const busyAgents = new Set(runningQuests.map((q) => q.bot.id));
        let slots = MAX_RUNNING - runningQuests.length;
        const crew = bots();
        const paused = pausedAgents(org);
        for (const row of rows.filter((r) => r.state === "todo" && !r.held && !r.paused).sort(order)) {
          if (slots <= 0) break;
          if (busyAgents.has(row.owner) || paused.has(row.owner)) continue;
          const bot = crew.get(row.owner);
          if (!bot) {
            d.prepare("update work_items set held = ? where id = ?").run("Its agent is no longer on your team.", row.id);
            continue;
          }
          busyAgents.add(row.owner);
          slots--;
          const handoff = row.handoff ? (JSON.parse(row.handoff) as { conversation: string; by: string }) : null;
          // Taken off the queue before the run starts, so nothing starts it twice.
          d.prepare("update work_items set state = 'started', updated_at = ? where id = ?").run(now(), row.id);
          try {
            const quest = await quests.start({ bot, text: briefOf(org, row, rows), title: row.title, project: row.project ?? undefined, parent: handoff ? { id: handoff.conversation, by: handoff.by } : undefined, item: row.id });
            d.prepare("update work_items set quest = ?, updated_at = ? where id = ?").run(quest.id, now(), row.id);
            d.prepare("update work_comments set delivered = 1 where item = ? and author = 'owner'").run(row.id);
          } catch (err) {
            d.prepare("update work_items set state = 'todo', held = ?, updated_at = ? where id = ?").run((err as Error).message.slice(0, 300), now(), row.id);
          }
        }
      } while (again);
    })().finally(() => (scheduling = null));
    return scheduling;
  },

  /** Called when a run stops: its task's comments can go in, and its agent may be free for the next task. */
  runEnded(questId: string) {
    try {
      const org = orgs.active();
      const item = this.ofQuest(org, questId);
      if (item) setTimeout(() => this.deliverComments(org, item.id).catch(() => {}), 120);
    } catch {}
    this.kick();
  },
};

// The run engine asks the work layer about queued hand-offs, tells it when runs end, and lets it record runs started
// outside the queues. Wired here, so the two do not import each other.
quests.pendingHandoffs = (conversationId) => work.pendingFor(conversationId);
quests.onRunEnded = (questId) => work.runEnded(questId);
quests.onStartedOutsideQueue = (quest) => work.adopt(quest);
quests.agentPaused = (botId) => {
  try {
    const org = orgs.active();
    return pausedAgents(org).has(botId) ? `The ${nameOf(org, botId)} is paused, so it starts no new work. Resume it on the Tasks page first.` : null;
  } catch {
    return null;
  }
};
// The "why" of a task (shown on its page and told to its agent) includes the goal and project of the task the owner gave.
setWhyGoal((questId) => {
  try {
    const org = orgs.active();
    const row = db(org.id).prepare("select goal, project_id from work_items where quest = ?").get(questId) as { goal: string | null; project_id: string | null } | undefined;
    if (!row) return [];
    const project = row.project_id ? goals.project(org, row.project_id) : null;
    const goalId = row.goal ?? project?.goal ?? null;
    const goal = goalId ? goals.get(org, goalId) : null;
    return [...(goal ? [{ kind: "objective" as const, text: goalLine(goal).replace(/^“|”/g, "") }] : []), ...(project ? [{ kind: "project" as const, text: project.title }] : [])];
  } catch {
    return [];
  }
});

