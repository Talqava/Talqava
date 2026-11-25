// What an organization remembers. Three shelves: the whole organization's
// (policies, decisions, facts about the business), each department's (how
// that department does its work), and each agent's own (what it has learned
// and a short record of the work it finished). An agent sees its own shelf,
// its department's and the organization's. Only what bears on the task in
// hand is put in its prompt; the rest is one search away, so memory can grow
// large without every task paying for all of it. It is kept in each organization's own database, with the same
// full-text search as the Library.
import { mayReceive, policy } from "./sensitivity.ts";
import path from "node:path";
import { defineTool, rank } from "../core/index.ts";
import type { Tool } from "../core/index.ts";
import type { DatabaseSync } from "node:sqlite";
import { DATA, newId, readJson, writeJson } from "./store.ts";
import { openOrgDb } from "./library.ts";
import { memberOf, orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";

export type Shelf = "org" | "dept" | "agent";

export interface OrgMemoryEntry {
  id: string;
  org: string;
  shelf: Shelf;
  /** The department's name, or the agent's id. Empty for the organization's shelf. */
  key: string;
  text: string;
  /** Who saved it: an agent's name, or "You". */
  by: string;
  /** A note someone chose to save, or a line the app keeps about a finished task. */
  kind: "note" | "log";
  createdAt: string;
  updatedAt?: string;
}

/** How much organization memory goes in a prompt, in characters. */
export const ORG_MEMORY_BUDGET = 3200;
const ENTRY_LIMIT = 800;
/** Finished-task lines kept per agent; older ones are dropped. */
const LOG_LIMIT = 60;

const tidyText = (text: unknown) => String(text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, ENTRY_LIMIT);

// ----- where it is kept: each organization's own database, beside its library and workspace -----
/** The older file that held every organization's memory together. Its entries move into the databases, once. */
const legacyFile = () => path.join(DATA, "org-memory.json");

interface Row {
  id: string;
  shelf: string;
  key: string;
  text: string;
  by: string;
  kind: string;
  created_at: string;
  updated_at: string | null;
}
const toEntry = (orgId: string, r: Row): OrgMemoryEntry => ({ id: r.id, org: orgId, shelf: r.shelf as Shelf, key: r.key, text: r.text, by: r.by, kind: r.kind === "log" ? "log" : "note", createdAt: r.created_at, ...(r.updated_at ? { updatedAt: r.updated_at } : {}) });

const ready = new WeakSet<DatabaseSync>();
function db(orgId: string): DatabaseSync {
  const d = openOrgDb(orgId);
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists memory (id text primary key, shelf text not null, key text not null default '', text text not null, by text not null, kind text not null default 'note', created_at text not null, updated_at text);
    create index if not exists memory_shelf on memory(shelf, key);
    create virtual table if not exists memory_fts using fts5(text, content='memory', content_rowid='rowid', tokenize='porter unicode61');
    create trigger if not exists memory_ai after insert on memory begin insert into memory_fts(rowid, text) values (new.rowid, new.text); end;
    create trigger if not exists memory_ad after delete on memory begin insert into memory_fts(memory_fts, rowid, text) values ('delete', old.rowid, old.text); end;
    create trigger if not exists memory_au after update of text on memory begin insert into memory_fts(memory_fts, rowid, text) values ('delete', old.rowid, old.text); insert into memory_fts(rowid, text) values (new.rowid, new.text); end;
  `);
  ready.add(d);
  convert(orgId, d);
  return d;
}

/**
 * Moves an organization's entries from the older file into its database, once: every entry, in the same order, with
 * who may see it. They leave the file only after they are safely in the database.
 */
function convert(orgId: string, d: DatabaseSync) {
  const all = readJson<OrgMemoryEntry[]>(legacyFile(), []);
  const mine = all.filter((e) => e.org === orgId);
  if (!mine.length) return;
  const insert = d.prepare("insert or ignore into memory (id, shelf, key, text, by, kind, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  d.exec("begin");
  try {
    for (const e of mine) insert.run(e.id, e.shelf, e.key ?? "", e.text, e.by, e.kind ?? "note", e.createdAt, e.updatedAt ?? null);
    d.exec("commit");
  } catch (err) {
    d.exec("rollback");
    throw err;
  }
  writeJson(legacyFile(), all.filter((e) => e.org !== orgId));
}

/** Words of a search, as a full-text query: any of them, in any form. */
const ftsQuery = (query: string) => [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12).map((w) => `"${w}"`).join(" OR ");

export const orgMemory = {
  list(orgId: string): OrgMemoryEntry[] {
    return (db(orgId).prepare("select * from memory order by rowid").all() as unknown as Row[]).map((r) => toEntry(orgId, r));
  },

  /** What an agent may see: the organization's shelf, its department's and its own. */
  visibleTo(org: Org, botId: string | null): OrgMemoryEntry[] {
    // Memory as a whole has one sensitivity level, set by the owner; a run whose AI service may not receive it gets none.
    if (!mayReceive(policy().memory)) return [];
    const me = botId ? memberOf(org, botId) : null;
    return this.list(org.id).filter((e) => e.shelf === "org" || (!botId ? true : (e.shelf === "dept" && e.key === me?.department) || (e.shelf === "agent" && e.key === botId)));
  },

  /**
   * What an agent may see that matches some words, best first: the database's full-text search (as the Library's),
   * then, when that finds nothing, a looser match on word forms.
   */
  search(org: Org, botId: string | null, query: string, limit = 12): OrgMemoryEntry[] {
    const visible = this.visibleTo(org, botId);
    const match = ftsQuery(query ?? "");
    if (match) {
      try {
        const ids = new Set((db(org.id).prepare("select m.id from memory_fts f join memory m on m.rowid = f.rowid where memory_fts match ? order by bm25(memory_fts) limit 60").all(match) as unknown as { id: string }[]).map((r) => r.id));
        const byId = new Map(visible.map((e) => [e.id, e]));
        const found = [...ids].map((id) => byId.get(id)).filter((e): e is OrgMemoryEntry => Boolean(e));
        if (found.length) return found.slice(0, limit);
      } catch {
        // A query the index cannot read falls through to the looser match.
      }
    }
    return rank(query ?? "", visible, (e) => e.text).slice(0, limit).map(({ item }) => item);
  },

  add(entry: { org: string; shelf: Shelf; key?: string; text: unknown; by: string; kind?: "note" | "log" }): OrgMemoryEntry {
    const text = tidyText(entry.text);
    if (!text) throw new Error("Say what to remember.");
    const d = db(entry.org);
    const made: OrgMemoryEntry = { id: newId().slice(0, 8), org: entry.org, shelf: entry.shelf, key: entry.shelf === "org" ? "" : String(entry.key ?? ""), text, by: entry.by, kind: entry.kind ?? "note", createdAt: new Date().toISOString() };
    d.prepare("insert into memory (id, shelf, key, text, by, kind, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(made.id, made.shelf, made.key, made.text, made.by, made.kind, made.createdAt);
    // An agent's record of finished work is kept to its latest lines.
    if (made.kind === "log") d.prepare("delete from memory where kind = 'log' and key = ? and rowid not in (select rowid from memory where kind = 'log' and key = ? order by rowid desc limit ?)").run(made.key, made.key, LOG_LIMIT);
    return made;
  },

  update(orgId: string, id: string, text: unknown): OrgMemoryEntry {
    const d = db(orgId);
    const row = d.prepare("select * from memory where id = ?").get(String(id)) as unknown as Row | undefined;
    if (!row) throw new Error("There is no such entry.");
    const next = tidyText(text);
    if (!next) throw new Error("Say what to remember.");
    const at = new Date().toISOString();
    d.prepare("update memory set text = ?, updated_at = ? where id = ?").run(next, at, row.id);
    return toEntry(orgId, { ...row, text: next, updated_at: at });
  },

  remove(orgId: string, id: string) {
    const done = db(orgId).prepare("delete from memory where id = ?").run(String(id));
    if (!done.changes) throw new Error("There is no such entry.");
  },

  /** Forgets everything an organization remembered, when the organization is deleted (its database goes with it). */
  purge(orgId: string) {
    const all = readJson<OrgMemoryEntry[]>(legacyFile(), []);
    if (all.some((e) => e.org === orgId)) writeJson(legacyFile(), all.filter((e) => e.org !== orgId));
  },

  /** Keeps a line about a task an agent finished: what it was, and how its report began. */
  logTask(org: Org, botId: string, title: string, report: string) {
    if (!memberOf(org, botId)) return;
    const line = `${new Date().toISOString().slice(0, 10)} · ${title.replace(/\s+/g, " ").slice(0, 120)}${report ? ` → ${report.replace(/\s+/g, " ").slice(0, 260)}` : ""}`;
    this.add({ org: org.id, shelf: "agent", key: botId, text: line, by: "Talqava", kind: "log" });
  },
};

const shelfName = (e: OrgMemoryEntry) => (e.shelf === "org" ? "organization" : e.shelf === "dept" ? `${e.key} department` : e.kind === "log" ? "your past work" : "your notes");

/**
 * The part of the prompt that carries organization memory. Everything, when it
 * fits the budget. Otherwise notes that match the task come first, then the
 * newest, and the rest are counted so the agent knows to search.
 */
export function orgMemoryPrompt(org: Org, botId: string | null, about: string, budget = ORG_MEMORY_BUDGET): string {
  const visible = orgMemory.visibleTo(org, botId);
  if (!visible.length) return "";
  const size = (e: OrgMemoryEntry) => e.text.length + 30;
  let shown = visible;
  if (visible.reduce((n, e) => n + size(e), 0) > budget) {
    const picked = new Set<OrgMemoryEntry>();
    let used = 0;
    const take = (e: OrgMemoryEntry, limit: number) => {
      if (picked.has(e) || used + size(e) > limit) return;
      picked.add(e);
      used += size(e);
    };
    const notes = visible.filter((e) => e.kind === "note");
    for (const { item } of rank(about, visible, (e) => e.text)) take(item, budget * 0.65);
    for (const e of [...notes].reverse()) take(e, budget * 0.9);
    for (const e of [...visible].reverse()) take(e, budget);
    shown = visible.filter((e) => picked.has(e));
  }
  const hidden = visible.length - shown.length;
  return [
    "# What the organization remembers",
    "Shared memory, kept across every task and seen by your colleagues: the organization's, your department's, and your own notes and past work. Read it before you start. Save what a colleague would need later with team_memory (a decision and its reason, a fact about the business, how a job is done here), one fact per entry, and correct an entry that has gone out of date.",
    shown.map((e) => `- [${e.id}] (${shelfName(e)}) ${e.text}`).join("\n"),
    ...(hidden ? [`${hidden} more ${hidden === 1 ? "entry is" : "entries are"} saved but not listed. Search with team_memory before asking a colleague or the user for something the organization may already know.`] : []),
  ].join("\n\n");
}

/** The tool agents use to read and write organization memory. `who` says which agent is calling (null for the general chat agent). */
export function teamMemoryTool(who: (conversationId: string) => { id: string; name: string } | null): Tool {
  return defineTool<{ action: "add" | "update" | "remove" | "search"; text?: string; id?: string; shelf?: "mine" | "department" | "organization"; query?: string }>({
    name: "team_memory",
    description:
      "The organization's shared memory, kept across tasks and agents. Shelves: \"organization\" (seen by every agent: policies, decisions, facts about the business), \"department\" (seen by your department: how work is done here), \"mine\" (your own notes). Save durable facts, one per entry, in a sentence or two; update an entry when the fact changes; remove one that is wrong. Search looks through everything you may see, including entries not listed at the start.",
    properties: {
      action: { type: "string", enum: ["add", "update", "remove", "search"] },
      text: { type: "string", description: "For add and update: the fact to remember." },
      id: { type: "string", description: "For update and remove: the id of the entry." },
      shelf: { type: "string", enum: ["mine", "department", "organization"], description: "For add: where to keep it. Defaults to your department." },
      query: { type: "string", description: "For search: a few words about what you are looking for." },
    },
    required: ["action"],
    async run(input, { conversation }) {
      const org = orgs.active();
      const me = who(conversation.id);
      const member = me ? memberOf(org, me.id) : null;
      const mine = orgMemory.visibleTo(org, me?.id ?? null);
      if (input.action === "search") {
        const found = orgMemory.search(org, me?.id ?? null, input.query ?? "");
        return found.length ? found.map((item) => `- [${item.id}] (${shelfName(item)}) ${item.text}`).join("\n") : "Nothing saved matches that.";
      }
      if (input.action === "add") {
        const shelf: Shelf = !member || input.shelf === "organization" ? "org" : input.shelf === "mine" ? "agent" : "dept";
        const entry = orgMemory.add({ org: org.id, shelf, key: shelf === "dept" ? member!.department : shelf === "agent" ? me!.id : "", text: input.text, by: me?.name ?? "Talqava" });
        return `Remembered (id ${entry.id}) for ${shelf === "org" ? "the whole organization" : shelf === "dept" ? `the ${entry.key} department` : "yourself"}.`;
      }
      if (!mine.some((e) => e.id === input.id)) throw new Error("There is no such entry among those you can see.");
      if (input.action === "update") return `Updated (id ${orgMemory.update(org.id, input.id!, input.text).id}).`;
      orgMemory.remove(org.id, input.id!);
      return "Removed.";
    },
  });
}
