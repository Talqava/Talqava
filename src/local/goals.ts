// Goals and projects: what the organization's work is for.
//
// A goal is measurable: a title, a number to reach and where it stands now (both optional), and a date. It belongs to
// the whole organization or to one group. A project is a body of work towards a goal, led by a position. Tasks link to
// a goal and a project (sub-tasks and hand-offs inherit both), so every piece of work can say which goal it serves,
// and a goal's progress shows both in its number and in its tasks done.
import type { DatabaseSync } from "node:sqlite";
import { newId } from "./store.ts";
import type { Org } from "./orgs.ts";
import { openOrgDb } from "./library.ts";
import { audit } from "./audit.ts";

export type GoalStatus = "active" | "achieved" | "dropped";
export type ProjectStatus = "planning" | "active" | "paused" | "done";
export const PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "paused", "done"];

export interface Goal {
  id: string;
  title: string;
  /** The group it belongs to (by id), or null for the whole organization. */
  group: string | null;
  groupName: string | null;
  /** The number to reach, where it stands now, and what is counted (customers, dollars, orders…). */
  target: number | null;
  current: number | null;
  unit: string;
  /** The date to reach it by, as YYYY-MM-DD. */
  due: string | null;
  status: GoalStatus;
  /** Tasks linked to it directly or through its projects (cancelled ones left out). */
  tasks: { total: number; done: number };
  projects: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  goal: string | null;
  goalTitle: string | null;
  /** The position that leads it. */
  lead: string | null;
  leadName: string | null;
  status: ProjectStatus;
  /** What "done" looks like, in the owner's words. */
  doneWhen: string;
  /** The day it is due, or null. */
  due: string | null;
  /** The chat folder that holds its chats and its own memory, once it has one. */
  space: string | null;
  tasks: { total: number; done: number };
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();
const ready = new WeakSet<DatabaseSync>();

/** The organization's database, with the goals' and projects' tables, and the tasks' links to them. */
export function goalsDb(orgId: string): DatabaseSync {
  const d = openOrgDb(orgId);
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists goals (
      id text primary key,
      title text not null,
      grp text,
      target real,
      current real,
      unit text not null default '',
      due text,
      status text not null default 'active',
      position real not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists projects (
      id text primary key,
      title text not null,
      description text not null default '',
      goal text,
      lead text,
      status text not null default 'active',
      created_at text not null,
      updated_at text not null
    );
  `);
  // Tasks made before goals existed get the two links (each organization's database is changed once).
  const cols = new Set((d.prepare("pragma table_info(work_items)").all() as unknown as { name: string }[]).map((c) => c.name));
  if (cols.size && !cols.has("goal")) d.exec("alter table work_items add column goal text");
  if (cols.size && !cols.has("project_id")) d.exec("alter table work_items add column project_id text");
  // Projects made before they became folders get what "done" looks like, a due day and their chat folder.
  const pcols = new Set((d.prepare("pragma table_info(projects)").all() as unknown as { name: string }[]).map((c) => c.name));
  if (!pcols.has("done_when")) d.exec("alter table projects add column done_when text not null default ''");
  if (!pcols.has("due")) d.exec("alter table projects add column due text");
  if (!pcols.has("space")) d.exec("alter table projects add column space text");
  ready.add(d);
  return d;
}

interface GoalRow { id: string; title: string; grp: string | null; target: number | null; current: number | null; unit: string; due: string | null; status: string; position: number; created_at: string; updated_at: string }
interface ProjectRow { id: string; title: string; description: string; goal: string | null; lead: string | null; status: string; done_when: string; due: string | null; space: string | null; created_at: string; updated_at: string }

const cleanTitle = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
function number(v: unknown, what: string): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error(`The ${what} is a number.`);
  return n;
}
function date(v: unknown): string | null {
  if (v === null || v === "" || v === undefined) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error("The date is a day, like 2027-03-01.");
  return s;
}

/** Task counts per goal and per project: linked directly, or for a goal also through its projects. */
function counts(d: DatabaseSync): { goals: Map<string, { total: number; done: number }>; projects: Map<string, { total: number; done: number }> } {
  const goals = new Map<string, { total: number; done: number }>();
  const projects = new Map<string, { total: number; done: number }>();
  let rows: { goal: string | null; project_id: string | null; state: string; pgoal: string | null }[] = [];
  try {
    rows = d.prepare("select w.goal, w.project_id, w.state, p.goal pgoal from work_items w left join projects p on p.id = w.project_id where w.state != 'cancelled'").all() as unknown as typeof rows;
  } catch {
    return { goals, projects };
  }
  const bump = (m: Map<string, { total: number; done: number }>, key: string | null, done: boolean) => {
    if (!key) return;
    const c = m.get(key) ?? { total: 0, done: 0 };
    c.total++;
    if (done) c.done++;
    m.set(key, c);
  };
  for (const r of rows) {
    const done = r.state === "done";
    bump(projects, r.project_id, done);
    bump(goals, r.goal ?? r.pgoal, done);
  }
  return { goals, projects };
}

const groupNameOf = (org: Org, id: string | null) => (id ? ((org.groups ?? []).find((g) => g.id === id)?.name ?? null) : null);
const titleOf = (org: Org, bot: string | null) => (bot ? (org.members.find((m) => m.bot === bot)?.title ?? null) : null);

export const goals = {
  list(org: Org): Goal[] {
    const d = goalsDb(org.id);
    const c = counts(d);
    const projectCount = new Map((d.prepare("select goal, count(*) n from projects where goal is not null group by goal").all() as unknown as { goal: string; n: number }[]).map((r) => [r.goal, r.n]));
    return (d.prepare("select * from goals order by case status when 'active' then 0 when 'achieved' then 1 else 2 end, grp is not null, position, created_at").all() as unknown as GoalRow[]).map((g) => ({
      id: g.id,
      title: g.title,
      group: g.grp,
      groupName: groupNameOf(org, g.grp),
      target: g.target,
      current: g.current,
      unit: g.unit,
      due: g.due,
      status: (["active", "achieved", "dropped"].includes(g.status) ? g.status : "active") as GoalStatus,
      tasks: c.goals.get(g.id) ?? { total: 0, done: 0 },
      projects: projectCount.get(g.id) ?? 0,
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    }));
  },

  get(org: Org, id: string): Goal {
    const g = this.list(org).find((x) => x.id === String(id));
    if (!g) throw new Error("There is no such goal.");
    return g;
  },

  create(org: Org, input: { title?: unknown; group?: unknown; target?: unknown; current?: unknown; unit?: unknown; due?: unknown }): Goal {
    const d = goalsDb(org.id);
    const title = cleanTitle(input.title);
    if (!title) throw new Error("Say what the goal is, e.g. 40 wholesale customers.");
    const group = input.group ? String(input.group) : null;
    if (group && !(org.groups ?? []).some((g) => g.id === group)) throw new Error("There is no such group.");
    const id = newId();
    d.prepare("insert into goals (id, title, grp, target, current, unit, due, status, position, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)").run(
      id, title, group, number(input.target, "target"), number(input.current, "current number"), String(input.unit ?? "").trim().slice(0, 30), date(input.due), Date.now(), now(), now(),
    );
    audit({ actor: "owner", actorName: "You", kind: "organization", action: `Set the goal “${title}”`, detail: groupNameOf(org, group) ? `For ${groupNameOf(org, group)}` : "For the whole organization" });
    return this.get(org, id);
  },

  update(org: Org, id: string, patch: { title?: unknown; group?: unknown; target?: unknown; current?: unknown; unit?: unknown; due?: unknown; status?: unknown }): Goal {
    const d = goalsDb(org.id);
    const g = d.prepare("select * from goals where id = ?").get(String(id)) as unknown as GoalRow | undefined;
    if (!g) throw new Error("There is no such goal.");
    const set = (col: string, v: unknown) => d.prepare(`update goals set ${col} = ? where id = ?`).run(v as never, g.id);
    if (patch.title !== undefined) set("title", cleanTitle(patch.title) || g.title);
    if (patch.group !== undefined) {
      const group = patch.group ? String(patch.group) : null;
      if (group && !(org.groups ?? []).some((x) => x.id === group)) throw new Error("There is no such group.");
      set("grp", group);
    }
    if (patch.target !== undefined) set("target", number(patch.target, "target"));
    if (patch.current !== undefined) set("current", number(patch.current, "current number"));
    if (patch.unit !== undefined) set("unit", String(patch.unit ?? "").trim().slice(0, 30));
    if (patch.due !== undefined) set("due", date(patch.due));
    if (patch.status !== undefined) {
      if (!["active", "achieved", "dropped"].includes(String(patch.status))) throw new Error("A goal is active, achieved or dropped.");
      set("status", String(patch.status));
    }
    set("updated_at", now());
    const after = this.get(org, g.id);
    if (patch.current !== undefined || patch.status !== undefined) audit({ actor: "owner", actorName: "You", kind: "organization", action: patch.status !== undefined ? `Marked the goal “${after.title}” ${after.status}` : `Updated the goal “${after.title}”: ${after.current ?? "–"}${after.target != null ? ` of ${after.target}` : ""} ${after.unit}`.trim() });
    return after;
  },

  /** Removes a goal; its projects and tasks stay, without it. */
  remove(org: Org, id: string) {
    const d = goalsDb(org.id);
    const g = this.get(org, id);
    d.prepare("update projects set goal = null where goal = ?").run(g.id);
    d.prepare("update work_items set goal = null where goal = ?").run(g.id);
    d.prepare("delete from goals where id = ?").run(g.id);
    audit({ actor: "owner", actorName: "You", kind: "organization", action: `Removed the goal “${g.title}”` });
    return { removed: g.id };
  },

  projects(org: Org): Project[] {
    const d = goalsDb(org.id);
    const c = counts(d);
    const titles = new Map((d.prepare("select id, title from goals").all() as unknown as { id: string; title: string }[]).map((g) => [g.id, g.title]));
    return (d.prepare("select * from projects order by case status when 'active' then 0 when 'planning' then 1 when 'paused' then 2 else 3 end, created_at").all() as unknown as ProjectRow[]).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      goal: p.goal,
      goalTitle: p.goal ? (titles.get(p.goal) ?? null) : null,
      lead: p.lead,
      leadName: titleOf(org, p.lead),
      status: (PROJECT_STATUSES.includes(p.status as ProjectStatus) ? p.status : "active") as ProjectStatus,
      doneWhen: p.done_when ?? "",
      due: p.due ?? null,
      space: p.space ?? null,
      tasks: c.projects.get(p.id) ?? { total: 0, done: 0 },
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
  },

  project(org: Org, id: string): Project {
    const p = this.projects(org).find((x) => x.id === String(id));
    if (!p) throw new Error("There is no such project.");
    return p;
  },

  createProject(org: Org, input: { title?: unknown; description?: unknown; goal?: unknown; lead?: unknown; doneWhen?: unknown; due?: unknown; status?: unknown; space?: string | null; quiet?: boolean }): Project {
    const d = goalsDb(org.id);
    const title = cleanTitle(input.title);
    if (!title) throw new Error("Give the project a name.");
    const goal = input.goal ? this.get(org, String(input.goal)).id : null;
    const lead = input.lead ? String(input.lead) : null;
    if (lead && !org.members.some((m) => m.bot === lead)) throw new Error("The lead must be a position on the chart.");
    const id = newId();
const status = input.status === "planning" ? "planning" : "active";
    d.prepare("insert into projects (id, title, description, goal, lead, status, done_when, due, space, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, title, String(input.description ?? "").trim().slice(0, 4000), goal, lead, status, String(input.doneWhen ?? "").trim().slice(0, 1000), date(input.due), input.space ?? null, now(), now());
    if (!input.quiet) audit({ actor: "owner", actorName: "You", kind: "organization", action: `Started the project “${title}”` });
    return this.project(org, id);
  },

  updateProject(org: Org, id: string, patch: { title?: unknown; description?: unknown; goal?: unknown; lead?: unknown; status?: unknown; doneWhen?: unknown; due?: unknown; space?: string | null }): Project {
    const d = goalsDb(org.id);
    const p = this.project(org, id);
    const set = (col: string, v: unknown) => d.prepare(`update projects set ${col} = ? where id = ?`).run(v as never, p.id);
    if (patch.title !== undefined) set("title", cleanTitle(patch.title) || p.title);
    if (patch.description !== undefined) set("description", String(patch.description ?? "").slice(0, 4000));
    if (patch.goal !== undefined) set("goal", patch.goal ? this.get(org, String(patch.goal)).id : null);
    if (patch.lead !== undefined) {
      const lead = patch.lead ? String(patch.lead) : null;
      if (lead && !org.members.some((m) => m.bot === lead)) throw new Error("The lead must be a position on the chart.");
      set("lead", lead);
    }
    if (patch.status !== undefined) {
      if (!PROJECT_STATUSES.includes(String(patch.status) as ProjectStatus)) throw new Error("A project is in planning, active, paused or done.");
      set("status", String(patch.status));
    }
    if (patch.doneWhen !== undefined) set("done_when", String(patch.doneWhen ?? "").trim().slice(0, 1000));
    if (patch.due !== undefined) set("due", date(patch.due));
    if (patch.space !== undefined) set("space", patch.space);
    set("updated_at", now());
    return this.project(org, p.id);
  },

  removeProject(org: Org, id: string) {
    const d = goalsDb(org.id);
    const p = this.project(org, id);
    d.prepare("update work_items set project_id = null where project_id = ?").run(p.id);
    d.prepare("delete from projects where id = ?").run(p.id);
    audit({ actor: "owner", actorName: "You", kind: "organization", action: `Removed the project “${p.title}”` });
    return { removed: p.id };
  },
};

/** A goal in a few words, with its progress: "40 wholesale customers (12 of 40, by 1 March 2027)". */
export function goalLine(g: Pick<Goal, "title" | "target" | "current" | "unit" | "due">): string {
  const parts = [g.target != null ? `${g.current ?? 0} of ${g.target}${g.unit ? ` ${g.unit}` : ""}` : null, g.due ? `by ${new Date(`${g.due}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}` : null].filter(Boolean);
  return `“${g.title}”${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * For an agent's prompt: the organization's active goals, and those of the agent's group, with progress. Leads use
 * them to decide what matters most; everyone uses them to see what their work is for.
 */
export function goalsPrompt(org: Org, botId: string | null): string {
  let list: Goal[];
  try {
    list = goals.list(org).filter((g) => g.status === "active");
  } catch {
    return "";
  }
  if (!list.length) return "";
  const mine = botId ? org.members.find((m) => m.bot === botId) : undefined;
  const myGroup = mine ? (org.groups ?? []).find((g) => g.name === mine.department)?.id : undefined;
  const shown = list.filter((g) => !g.group || g.group === myGroup);
  if (!shown.length) return "";
  return `# Goals\n\nThe owner's goals for this work, with where each stands. When you choose what to do first, or how to do it, put what moves these forward first:\n${shown.map((g) => `- ${goalLine(g)}${g.groupName ? ` · ${g.groupName}` : " · the whole organization"}`).join("\n")}`;
}
