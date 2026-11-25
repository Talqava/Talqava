// Projects: one folder for a body of work. A project gathers its tasks (linked on the task), its chats and its own
// memory (a chat folder, kept apart from other projects'), its lead, the goal it serves, what "done" looks like and
// a due day. "Project" used to mean two things, a group of tasks under a goal and a folder of chats; here they
// become one: every chat folder is a project, and a project gets its chat folder the first time it needs one.
import { workspace } from "./workspace.ts";
import { conversations, spaces } from "./store.ts";
import { orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { goals, goalsDb } from "./goals.ts";
import type { Project } from "./goals.ts";
import { work } from "./work.ts";
import type { WorkItem } from "./work.ts";
import { audit } from "./audit.ts";

export type Health = "on-track" | "at-risk" | "off-track";

export interface ProjectCard extends Project {
  /** Worked out, never typed. Null when the project is not active. */
  health: Health | null;
  /** Why it is at risk or off track, in a few words. */
  healthWhy: string;
  /** Tasks that wait on the owner: to review, waiting for an answer, or blocked. */
  needsYou: number;
  chats: number;
  /** The lead and every agent with a task in it, by position title. */
  team: string[];
}

export interface ProjectPage {
  project: ProjectCard;
  tasks: WorkItem[];
  chats: { id: string; title: string; updatedAt: string; bot: string | null }[];
  files: { id: string; kind: string; title: string; updatedAt: string; updatedBy: string }[];
}

const NEEDS_OWNER = new Set(["review", "waiting", "blocked"]);
const OPEN = (t: WorkItem) => t.status !== "done" && t.status !== "cancelled";

/** Chat folders already tied to a project, in any organization. */
function linkedSpaces(): Set<string> {
  const out = new Set<string>();
  for (const o of orgs.list().orgs) {
    try {
      for (const r of goalsDb(o.id).prepare("select space from projects where space is not null").all() as unknown as { space: string }[]) out.add(r.space);
    } catch {}
  }
  return out;
}

/**
 * Makes the two meanings of "project" one. Every chat folder that is not a project yet becomes one in this
 * organization, keeping its chats and its memory. It runs whenever projects are listed and does nothing once
 * every folder has its project, so a folder made from the chat list becomes a project too.
 */
export function syncProjects(org: Org): number {
  const all = spaces.list();
  if (!all.length) return 0;
  const linked = linkedSpaces();
  const loose = all.filter((s) => !linked.has(s.id));
  for (const s of loose) goals.createProject(org, { title: s.name, space: s.id, quiet: true });
  return loose.length;
}

function health(p: Project, tasks: WorkItem[], now: number): { health: Health | null; why: string } {
  if (p.status !== "active") return { health: null, why: "" };
  const open = tasks.filter(OPEN);
  if (p.due && Date.parse(`${p.due}T23:59:59`) < now) return { health: "off-track", why: "Past its due day" };
  const aging = open.find((t) => t.attention?.kind === "aging");
  if (aging) return { health: "off-track", why: `“${aging.title}” has waited over a day` };
  const stalled = open.find((t) => t.attention);
  if (stalled) return { health: "at-risk", why: `“${stalled.title}” has stopped moving` };
  if (p.due && tasks.length) {
    const start = Date.parse(p.createdAt);
    const end = Date.parse(`${p.due}T23:59:59`);
    const used = end > start ? (now - start) / (end - start) : 1;
    const done = tasks.filter((t) => t.status === "done").length / tasks.length;
    if (used >= 0.8 && done < 0.6) return { health: "at-risk", why: "Most of its time is used with under 60% of its tasks done" };
  }
  return { health: "on-track", why: "" };
}

function card(org: Org, p: Project, items: WorkItem[], chatCount: Map<string, number>, now: number): ProjectCard {
  const tasks = items.filter((t) => t.projectId === p.id && t.status !== "cancelled");
  const h = health(p, tasks, now);
  const team = [...new Set([p.leadName, ...tasks.map((t) => t.ownerName)].filter((n): n is string => Boolean(n)))];
  return { ...p, health: h.health, healthWhy: h.why, needsYou: tasks.filter((t) => NEEDS_OWNER.has(t.status)).length, chats: p.space ? (chatCount.get(p.space) ?? 0) : 0, team };
}

function chatCounts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of conversations.list()) if (c.space && c.source === "chat") out.set(c.space, (out.get(c.space) ?? 0) + 1);
  return out;
}

export const projects = {
  /** Every project as a card, after chat folders have become projects. */
  list(org: Org, now = Date.now()): ProjectCard[] {
    syncProjects(org);
    const items = work.list(org);
    const counts = chatCounts();
    return goals.projects(org).map((p) => card(org, p, items, counts, now));
  },

  /** One project with its tasks and its chats. */
  page(org: Org, id: string, now = Date.now()): ProjectPage {
    const project = this.list(org, now).find((p) => p.id === String(id));
    if (!project) throw new Error("There is no such project.");
    const tasks = work.list(org).filter((t) => t.projectId === project.id && t.status !== "cancelled");
    const chats = project.space
      ? conversations
          .list()
          .filter((c) => c.space === project.space && c.source === "chat")
          .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, bot: c.bot ?? null }))
      : [];
    // The documents, sheets, slides, notes and pages put in this project.
    const files = workspace.tree(org).filter((f) => f.project === project.id).map((f) => ({ id: f.id, kind: f.kind, title: f.title, updatedAt: f.updatedAt, updatedBy: f.updatedBy }));
    return { project, tasks, chats, files };
  },

  /** The project's chat folder, made the first time it is needed. Its name follows the project's, kept unique. */
  space(org: Org, id: string): string {
    const p = goals.project(org, id);
    if (p.space && spaces.get(p.space)) return p.space;
    const taken = new Set(spaces.list().map((s) => s.name.toLowerCase()));
    const base = (p.title.slice(0, 36).trim() || "Project").replace(/^general$/i, "General project");
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    const made = spaces.create(name);
    goals.updateProject(org, p.id, { space: made.id });
    return made.id;
  },

  /** Changes a project. A new name is given to its chat folder too, when the folder can take it. */
  update(org: Org, id: string, patch: Parameters<typeof goals.updateProject>[2]): Project {
    const { space: _ignored, ...rest } = patch ?? {};
    const p = goals.updateProject(org, id, rest);
    if (rest.title !== undefined && p.space) {
      try {
        spaces.rename(p.space, p.title.slice(0, 40));
      } catch {}
    }
    return p;
  },

  /**
   * Removes a project. Its tasks stay, without a project. Its chats move to General and its own memory is deleted,
   * as when a chat folder is removed.
   */
  remove(org: Org, id: string) {
    const p = goals.project(org, id);
    const done = goals.removeProject(org, p.id);
    if (p.space && spaces.get(p.space)) spaces.remove(p.space);
    return done;
  },

  /** A chat folder was renamed from the chat list or Memory: its project takes the name. */
  folderRenamed(space: string, name: string) {
    for (const o of orgs.list().orgs) {
      try {
        const d = goalsDb(o.id);
        d.prepare("update projects set title = ? where space = ?").run(name, space);
      } catch {}
    }
  },

  /** A chat folder was removed from the chat list or Memory: its project goes with it; its tasks stay. */
  folderRemoved(space: string) {
    for (const o of orgs.list().orgs) {
      try {
        const d = goalsDb(o.id);
        const hit = d.prepare("select id, title from projects where space = ?").get(space) as { id: string; title: string } | undefined;
        if (!hit) continue;
        d.prepare("update work_items set project_id = null where project_id = ?").run(hit.id);
        d.prepare("delete from projects where id = ?").run(hit.id);
        audit({ actor: "owner", actorName: "You", kind: "organization", action: `Removed the project “${hit.title}”` });
      } catch {}
    }
  },
};
