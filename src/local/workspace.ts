// The workspace: pages the owner and the agents share, kept in each organization's own database next to the
// library. A page is Markdown, which is what the editor saves and what agents read and write. Who may see a page
// works like the library (everyone, some groups, named agents, or private), and a page without its own setting
// follows the page above it. Agents never overwrite a page silently: a change they make is a suggestion the owner
// accepts or declines, unless the owner set the page to take agents' edits directly (and never on a protected page).
import type { DatabaseSync } from "node:sqlite";
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { newId } from "./store.ts";
import { orgs, memberOf } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { GENERAL_AGENT, OWNER, PICTURE_TYPES, mayUse, openOrgDb, parseAccess } from "./library.ts";
import type { Access } from "./library.ts";
import { TEMPLATES } from "./workspace-templates.ts";
import { loadCrew } from "./crew.ts";
import { audit } from "./audit.ts";
import { LEVEL_WORDS, levelOf, mayReceive } from "./sensitivity.ts";
import { noteItem } from "./sent.ts";
import type { Level } from "./sensitivity.ts";

/** Who is acting: the owner (null), an agent's id, or the general chat agent. */
export type Who = string | null;

/** What a page is: a workspace page, an Office document, or a note. All three share the same rules and editor. */
export const PAGE_KINDS = ["page", "doc", "note", "sheet", "deck"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** What a group or an agent may do with one file: nothing, read it, comment on it, suggest changes, or change it. */
export const ACCESS_LEVELS = ["none", "read", "comment", "suggest", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
/** Levels set one by one: for every agent, for a group, for a named agent. The most specific one that is set wins. */
export interface Levels {
  everyone?: AccessLevel;
  departments: Record<string, AccessLevel>;
  agents: Record<string, AccessLevel>;
}

/** A note left on a file, by the owner or by an agent that may comment. */
export interface PageComment {
  id: string;
  page: string;
  author: string;
  authorName: string;
  text: string;
  task: string | null;
  createdAt: string;
  resolved: boolean;
}

export interface PageInfo {
  id: string;
  /** "page" in the Workspace; "doc" and "note" in Office. */
  kind: PageKind;
  /** A document's folder or a note's notebook; empty for none. */
  folder: string;
  /** A note's tags. */
  tags: string[];
  /** The project it belongs to, or null. */
  project: string | null;
  /** Kept at the top of its list. */
  pinned: boolean;
  /** When the owner asked to be reminded of it, or null. */
  remindAt: string | null;
  /** How sensitive it is: decides which AI services may receive it, and hides a Restricted item from agents not named on it. */
  level: Level;
  parent: string | null;
  position: number;
  title: string;
  icon: string;
  /** Who may see it, after following the pages above it. */
  access: Access;
  /** True when the owner set who may see this page itself, rather than its parent deciding. */
  accessSet: boolean;
  /** "suggest": agents' changes wait for the owner. "direct": agents who may see it change it straight away. */
  edit: "suggest" | "direct";
  /** A protected page (pricing, legal, people policies) is never changed by an agent directly, whatever else is set. */
  protected: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Levels set for each group and agent, or null when the simpler settings above decide. */
  levels: Levels | null;
  /** Comments not yet resolved. */
  comments: number;
  /** Suggestions from agents waiting for the owner. */
  suggestions: number;
  /** The first words of the page, for lists and for agents. */
  summary: string;
  /** The names of what is attached and the words found in attached pictures, so a note is found by them. */
  attached: string;
}

/** A photo or file the owner attached to a note or document. */
export interface Attachment {
  id: string;
  name: string;
  /** The file's ending, in small letters: "png", "pdf". */
  type: string;
  size: number;
  /** Whether it is a picture whose words can be written out. */
  picture: boolean;
  /** How many words were found in it; 0 when it was not read or has none. */
  words: number;
  createdAt: string;
}
const MAX_ATTACHMENT = 15_000_000;
const MAX_ATTACHMENTS = 30;
const MAX_PICTURE_READ = 5_000_000;
const attachmentOf = (r: { id: string; name: string; type: string; size: number; words: string; created_at: string }): Attachment => ({ id: r.id, name: r.name, type: r.type, size: r.size, picture: Boolean(PICTURE_TYPES[r.type]), words: r.words ? r.words.split(/\s+/).filter(Boolean).length : 0, createdAt: r.created_at });

export interface Page extends PageInfo {
  markdown: string;
  rev: number;
  /** What the owner attached to it. */
  files: Attachment[];
}

export interface Suggestion {
  id: string;
  page: string;
  pageTitle: string;
  baseRev: number;
  markdown: string;
  note: string;
  author: string;
  authorName: string;
  task: string | null;
  status: "open" | "accepted" | "declined";
  createdAt: string;
  decidedAt: string | null;
  /** The change, line by line, against the page as it is now. */
  diff: DiffLine[];
  /** True when the page changed after the agent read it. */
  stale: boolean;
}

export type DiffLine = { op: "same" | "add" | "del"; text: string };

const EVERYONE: Access = { everyone: true, private: false, departments: [], agents: [] };
const MAX_REVISIONS = 100;
const PASSAGE_WORDS = 400;
const now = () => new Date().toISOString();

const ready = new WeakSet<DatabaseSync>();
/** The organization's database, with the workspace's tables made on first use. */
function db(orgId: string): DatabaseSync {
  const d = openOrgDb(orgId);
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists pages (
      id text primary key,
      parent text,
      position real not null default 0,
      title text not null,
      icon text not null default '',
      access text,
      edit text not null default 'suggest',
      protected integer not null default 0,
      template text,
      created_by text not null,
      updated_by text not null,
      created_at text not null,
      updated_at text not null,
      archived integer not null default 0
    );
    create index if not exists pages_parent on pages(parent, position);
    create table if not exists page_content (page text primary key, markdown text not null, rev integer not null);
    create table if not exists page_revisions (id integer primary key, page text not null, rev integer not null, markdown text not null, title text not null, author text not null, task text, at text not null);
    create index if not exists page_revisions_page on page_revisions(page, rev);
    create table if not exists page_suggestions (id text primary key, page text not null, base_rev integer not null, base text not null, markdown text not null, note text not null default '', author text not null, task text, status text not null default 'open', created_at text not null, decided_at text);
    create table if not exists page_passages (id integer primary key, page text not null, seq integer not null, heading text not null default '', text text not null);
    create index if not exists page_passages_page on page_passages(page, seq);
    create virtual table if not exists page_passages_fts using fts5(text, content='page_passages', content_rowid='id', tokenize='porter unicode61');
    create trigger if not exists page_passages_ai after insert on page_passages begin insert into page_passages_fts(rowid, text) values (new.id, new.text); end;
    create trigger if not exists page_passages_ad after delete on page_passages begin insert into page_passages_fts(page_passages_fts, rowid, text) values ('delete', old.id, old.text); end;
    create table if not exists page_uses (task text not null, page text not null, how text not null, at text not null, primary key (task, page, how));
  `);
  // Office documents and notes are pages of another kind, with a folder (or notebook) and tags.
  const have = new Set((d.prepare("pragma table_info(pages)").all() as unknown as { name: string }[]).map((c) => c.name));
  if (!have.has("kind")) d.exec("alter table pages add column kind text not null default 'page'");
  if (!have.has("folder")) d.exec("alter table pages add column folder text not null default ''");
  if (!have.has("tags")) d.exec("alter table pages add column tags text not null default '[]'");
  if (!have.has("level")) d.exec("alter table pages add column level text not null default 'internal'");
  if (!have.has("pinned")) d.exec("alter table pages add column pinned integer not null default 0");
  if (!have.has("project")) d.exec("alter table pages add column project text");
  if (!have.has("levels")) d.exec("alter table pages add column levels text");
  d.exec("create table if not exists page_comments (id text primary key, page text not null, author text not null, text text not null, task text, created_at text not null, resolved integer not null default 0); create index if not exists page_comments_page on page_comments(page, resolved);");
  if (!have.has("remind_at")) d.exec("alter table pages add column remind_at text");
  // Photos and files the owner attached to a note or document, kept with it; `words` are the words in a picture.
  d.exec("create table if not exists page_files (id text primary key, page text not null, name text not null, type text not null, size integer not null, data blob not null, words text not null default '', created_at text not null); create index if not exists page_files_page on page_files(page);");
  ready.add(d);
  return d;
}

interface Row {
  project?: string | null;
  pinned?: number;
  remind_at?: string | null;
  level: string;
  kind: string;
  folder: string;
  tags: string;
  id: string;
  parent: string | null;
  position: number;
  title: string;
  icon: string;
  access: string | null;
  levels?: string | null;
  edit: string;
  protected: number;
  template: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  archived: number;
}

const rows = (d: DatabaseSync, archived = false) => d.prepare(`select * from pages where archived = ? order by position, created_at`).all(archived ? 1 : 0) as unknown as Row[];

/** Who may see a page: its own setting, else the nearest page above it with one, else everyone. */
function accessOf(byId: Map<string, Row>, row: Row): { access: Access; set: boolean } {
  const own = parseAccess(row.access);
  if (own) return { access: own, set: true };
  for (let at = row.parent ? byId.get(row.parent) : undefined, n = 0; at && n < 50; at = at.parent ? byId.get(at.parent) : undefined, n++) {
    const a = parseAccess(at.access);
    if (a) return { access: a, set: false };
  }
  return { access: EVERYONE, set: false };
}

/**
 * Whether `who` may be handed a page: by who may see it, by its sensitivity (a Restricted page is only for agents named
 * on it), and by whether the AI service this run uses may receive that level.
 */
const RANK: Record<AccessLevel, number> = { none: 0, read: 1, comment: 2, suggest: 3, edit: 4 };
const asLevel = (v: unknown): AccessLevel | undefined => (ACCESS_LEVELS.includes(v as AccessLevel) ? (v as AccessLevel) : undefined);
/** Levels as stored or as given, tidied; null when there are none. */
function levelsOf(input: unknown): Levels | null {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { everyone?: unknown; departments?: Record<string, unknown>; agents?: Record<string, unknown> };
  const pick = (m: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(m ?? {}).flatMap(([k, v]) => ((l) => (l ? [[String(k).slice(0, 80), l]] : []))(asLevel(v))).slice(0, 200)) as Record<string, AccessLevel>;
  const out: Levels = { departments: pick(r.departments), agents: pick(r.agents) };
  const everyone = asLevel(r.everyone);
  if (everyone) out.everyone = everyone;
  return out;
}

/**
 * What `who` may do with a page. With levels set on it, the most specific one wins: the agent's own, then its
 * group's, then the one for every agent, else nothing. Without levels, whoever may see it may suggest changes, or
 * change it directly when the page takes agents' edits. A protected page is never changed directly, and a private
 * one is for the owner alone.
 */
function levelFor(org: Org, byId: Map<string, Row>, row: Row, who: Who): AccessLevel {
  if (who === OWNER) return "edit";
  const { access } = accessOf(byId, row);
  if (access.private) return "none";
  const levels = levelsOf(row.levels);
  let level: AccessLevel;
  if (levels) {
    const me = who === GENERAL_AGENT ? undefined : memberOf(org, String(who));
    level = levels.agents[String(who)] ?? (me ? levels.departments[me.department] : undefined) ?? levels.everyone ?? "none";
  } else level = mayUse(org, access, who) ? (row.edit === "direct" ? "edit" : "suggest") : "none";
  return row.protected && RANK[level] > RANK.suggest ? "suggest" : level;
}
/** Whether an agent is named on the page itself (which a Restricted page requires). */
const namedOn = (byId: Map<string, Row>, row: Row, who: Who) => ((levels) => (levels ? RANK[levels.agents[String(who)] ?? "none"] > 0 : accessOf(byId, row).access.agents.includes(String(who))))(levelsOf(row.levels));

function seen(org: Org, byId: Map<string, Row>, row: Row, who: Who): boolean {
  if (levelFor(org, byId, row, who) === "none") return false;
  if (who === OWNER) return true;
  const level = levelOf(row.level);
  if (level === "restricted" && !namedOn(byId, row, who)) return false;
  return mayReceive(level);
}

/** Plain text of some Markdown, for summaries and search. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_`~|]+/g, " ")
    .replace(/^-{3,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const summaryOf = (md: string) => ((t) => (t.split(" ").length > 40 ? `${t.split(" ").slice(0, 40).join(" ")}…` : t))(plain(md));

/** A page cut into passages by heading, each at most about PASSAGE_WORDS words, for search. */
function passagesOf(title: string, md: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const words = plain(buf.join("\n")).split(" ").filter(Boolean);
    for (let i = 0; i < words.length; i += PASSAGE_WORDS) out.push({ heading, text: `${heading ? `${heading}: ` : ""}${words.slice(i, i + PASSAGE_WORDS).join(" ")}` });
    buf = [];
  };
  for (const line of md.split("\n")) {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = plain(h[1]);
    } else buf.push(line);
  }
  flush();
  // The title is searchable even on an empty page.
  out.unshift({ heading: "", text: title });
  return out;
}

function reindex(d: DatabaseSync, page: string, title: string, md: string) {
  d.prepare("delete from page_passages where page = ?").run(page);
  const insert = d.prepare("insert into page_passages (page, seq, heading, text) values (?, ?, ?, ?)");
  passagesOf(title, md).forEach((p, i) => insert.run(page, i, p.heading, p.text));
}

function content(d: DatabaseSync, page: string): { markdown: string; rev: number } {
  return (d.prepare("select markdown, rev from page_content where page = ?").get(page) as { markdown: string; rev: number } | undefined) ?? { markdown: "", rev: 0 };
}

/** Saves a page's new text as the next revision, keeps its history short, and refreshes search. */
/**
 * "[[Page name]]" written anywhere (by an agent through the workspace tool, or pasted) becomes a link to the page with
 * that name, when there is one. The link points at the page's id, so it keeps working when the page is renamed.
 */
function linkTitles(d: DatabaseSync, markdown: string, self: string): string {
  if (!markdown.includes("[[")) return markdown;
  const byTitle = new Map((d.prepare("select id, title from pages where archived = 0").all() as unknown as { id: string; title: string }[]).filter((p) => p.id !== self).map((p) => [p.title.trim().toLowerCase(), p]));
  return markdown.replace(/\[\[([^\[\]\n]{1,80})\]\]/g, (whole, name: string) => {
    const page = byTitle.get(name.trim().toLowerCase());
    return page ? `[${escapeLinkText(page.title)}](${pageHref(page.id)})` : whole;
  });
}

function write(d: DatabaseSync, row: Row, typed: string, author: string, task: string | null = null): number {
  const md = linkTitles(d, typed, row.id);
  const { rev, markdown } = content(d, row.id);
  if (rev && markdown === md) return rev;
  const next = rev + 1;
  d.prepare("insert into page_content (page, markdown, rev) values (?, ?, ?) on conflict(page) do update set markdown = excluded.markdown, rev = excluded.rev").run(row.id, md, next);
  // An owner typing makes many saves; within two minutes they count as one version.
  const last = d.prepare("select id, author, at from page_revisions where page = ? order by rev desc limit 1").get(row.id) as { id: number; author: string; at: string } | undefined;
  if (last && last.author === author && author === "owner" && Date.now() - Date.parse(last.at) < 120_000) d.prepare("update page_revisions set rev = ?, markdown = ?, title = ?, at = ? where id = ?").run(next, md, row.title, now(), last.id);
  else d.prepare("insert into page_revisions (page, rev, markdown, title, author, task, at) values (?, ?, ?, ?, ?, ?, ?)").run(row.id, next, md, row.title, author, task, now());
  d.prepare("delete from page_revisions where page = ? and id not in (select id from page_revisions where page = ? order by rev desc limit ?)").run(row.id, row.id, MAX_REVISIONS);
  d.prepare("update pages set updated_by = ?, updated_at = ? where id = ?").run(author, now(), row.id);
  reindex(d, row.id, row.title, md);
  return next;
}

const authorOf = (who: Who) => (who === OWNER ? "owner" : who === GENERAL_AGENT ? "talqava" : String(who));
const nameOf = (org: Org, author: string) => (author === "owner" ? "You" : author === "talqava" ? "Talqava" : (memberOf(org, author)?.title ?? loadCrew().bots.find((b) => b.id === author)?.title ?? author));

// ---------- line diffs and merging ----------

/** The lines of `b` against `a`: kept, added and removed, in order. Long pages fall back to a plain replace. */
export function diff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > 4_000_000) return [...x.map((text) => ({ op: "del" as const, text })), ...y.map((text) => ({ op: "add" as const, text }))];
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push({ op: "same", text: x[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "del", text: x[i++] });
    else out.push({ op: "add", text: y[j++] });
  }
  while (i < n) out.push({ op: "del", text: x[i++] });
  while (j < m) out.push({ op: "add", text: y[j++] });
  return out;
}

/** The changes from `base` to `next`, as replaced ranges of base's lines. */
function hunks(base: string[], next: string): { from: number; to: number; lines: string[] }[] {
  const out: { from: number; to: number; lines: string[] }[] = [];
  let at = 0;
  let open: { from: number; to: number; lines: string[] } | null = null;
  for (const d of diff(base.join("\n"), next)) {
    if (d.op === "same") {
      if (open) out.push(open), (open = null);
      at++;
    } else {
      open ??= { from: at, to: at, lines: [] };
      if (d.op === "del") open.to = ++at;
      else open.lines.push(d.text);
    }
  }
  if (open) out.push(open);
  return out;
}

/**
 * Puts an agent's change (made against `base`) onto the page as it is now (`current`), when the two changed
 * different lines. Returns null when they changed the same lines, so the owner chooses.
 */
export function merge(base: string, current: string, suggested: string): string | null {
  if (current === base) return suggested;
  if (suggested === base) return current;
  const lines = base.split("\n");
  const mine = hunks(lines, current);
  const theirs = hunks(lines, suggested);
  const touches = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to + (b.from === b.to ? 1 : 0) && b.from < a.to + (a.from === a.to ? 1 : 0) || a.from === b.from;
  if (mine.some((a) => theirs.some((b) => touches(a, b)))) return null;
  const all = [...mine, ...theirs].sort((a, b) => b.from - a.from);
  for (const h of all) lines.splice(h.from, h.to - h.from, ...h.lines);
  return lines.join("\n");
}

// ---------- the workspace ----------

function info(org: Org, d: DatabaseSync, row: Row, byId: Map<string, Row>, open: Map<string, number>): PageInfo {
  const { access, set } = accessOf(byId, row);
  return {
    id: row.id,
    kind: kindOf(row.kind),
    folder: row.folder ?? "",
    tags: tagsOf(row.tags),
    level: levelOf(row.level),
    project: row.project ?? null,
    pinned: Boolean(row.pinned),
    remindAt: row.remind_at ?? null,
    attached: (d.prepare("select name, substr(words, 1, 1500) words from page_files where page = ? order by created_at").all(row.id) as unknown as { name: string; words: string }[]).map((f) => `${f.name} ${f.words}`).join(" ").slice(0, 6000),
    parent: row.parent,
    position: row.position,
    title: row.title,
    icon: row.icon,
    access,
    accessSet: set,
    edit: row.edit === "direct" ? "direct" : "suggest",
    protected: Boolean(row.protected),
    createdBy: nameOf(org, row.created_by),
    updatedBy: nameOf(org, row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    levels: levelsOf(row.levels),
    comments: (d.prepare("select count(*) n from page_comments where page = ? and resolved = 0").get(row.id) as { n: number }).n,
    suggestions: open.get(row.id) ?? 0,
    summary: row.kind === "sheet" ? sheetSummary(content(d, row.id).markdown) : row.kind === "deck" ? ((slides) => `${slides.length} slide${slides.length === 1 ? "" : "s"}: ${slides.map((x) => x.title).filter(Boolean).slice(0, 6).join(" · ")}`)(parseDeck(content(d, row.id).markdown)) : summaryOf(content(d, row.id).markdown),
  };
}

function openCounts(d: DatabaseSync): Map<string, number> {
  return new Map((d.prepare("select page, count(*) n from page_suggestions where status = 'open' group by page").all() as unknown as { page: string; n: number }[]).map((r) => [r.page, r.n]));
}

/** The page, if it exists and `who` may see it; otherwise an error that does not say which. */
function visible(org: Org, d: DatabaseSync, id: string, who: Who): { row: Row; byId: Map<string, Row> } {
  const all = rows(d);
  const byId = new Map(all.map((r) => [r.id, r]));
  const row = byId.get(String(id));
  if (row && who !== OWNER && levelFor(org, byId, row, who) !== "none" && !seen(org, byId, row, who)) {
    // The agent may know of the page but not be given it: say why, so it reports that instead of guessing.
    const level = levelOf(row.level);
    audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, action: `Kept back: “${row.title}” is ${LEVEL_WORDS[level].name}`, detail: level === "restricted" && !namedOn(byId, row, who) ? `${nameOf(org, String(who))} is not named on it` : `${nameOf(org, String(who))}'s AI service may not receive that level` });
    throw new Error(`“${row.title}” is marked ${LEVEL_WORDS[level].name}, and this organization's rules do not let you read it${level === "restricted" ? " unless you are named on it" : " on the AI service you are running on"}. Do not look for its content another way. Say in your report that you could not read it.`);
  }
  if (!row || !seen(org, byId, row, who)) throw new Error("There is no such page, or it is not one you may see.");
  return { row, byId };
}

const kindOf = (k: unknown): PageKind => (PAGE_KINDS.includes(k as PageKind) ? (k as PageKind) : "page");
const cleanFolder = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
/** Tags as given (a list, or text separated by commas), tidied: lower case, no "#", each once, up to 20. */
const cleanTags = (t: unknown): string[] => [...new Set((Array.isArray(t) ? t : String(t ?? "").split(",")).map((x) => String(x).replace(/^#/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20);
const tagsOf = (text: string | null | undefined): string[] => {
  try {
    return cleanTags(JSON.parse(text || "[]"));
  } catch {
    return [];
  }
};
const KIND_WORDS: Record<PageKind, string> = { page: "page", doc: "document", note: "note", sheet: "sheet", deck: "slides" };

/** The notebook where agents' own notes are kept, so the owner finds them in one place. */
export const AGENT_NOTEBOOK = "From agents";

/** One slide of a deck: a title, its text in Markdown, and speaker notes. */
export interface Slide {
  title: string;
  body: string;
  notes: string;
}
/** A deck's slides from its text: slides are separated by a line of three dashes; "Notes:" starts the speaker notes. */
export function parseDeck(text: string): Slide[] {
  const slides = String(text ?? "")
    .split(/^\s*---\s*$/m)
    .map((part) => {
      const lines = part.replace(/^\n+|\s+$/g, "").split("\n");
      const at = lines.findIndex((l) => /^notes:/i.test(l.trim()));
      const main = at < 0 ? lines : lines.slice(0, at);
      const notes = at < 0 ? "" : [lines[at].trim().replace(/^notes:\s*/i, ""), ...lines.slice(at + 1)].join("\n").trim();
      const head = main.findIndex((l) => /^#{1,2}\s+/.test(l));
      const title = head < 0 ? "" : main[head].replace(/^#{1,2}\s+/, "").trim();
      const body = (head < 0 ? main : [...main.slice(0, head), ...main.slice(head + 1)]).join("\n").trim();
      return { title, body, notes };
    })
    .filter((s) => s.title || s.body || s.notes);
  return slides.length ? slides : [{ title: "", body: "", notes: "" }];
}
/** A deck's text from its slides, always written the same way. */
export function writeDeck(slides: Slide[]): string {
  return `${slides.map((s) => [`# ${s.title.replace(/\s+/g, " ").trim() || "Untitled slide"}`, s.body.trim(), s.notes.trim() ? `Notes: ${s.notes.trim()}` : ""].filter(Boolean).join("\n\n")).join("\n\n---\n\n")}\n`;
}
/** A sheet file in a few words: its sheets' names and how many cells are filled. Its text is one line per cell. */
function sheetSummary(text: string): string {
  const lines = text.split("\n");
  const names = lines.filter((l) => l.startsWith("!sheet ")).map((l) => l.slice(7).trim());
  const cells = lines.filter((l) => l && !l.startsWith("!")).length;
  return `${names.join(", ") || "Sheet 1"} · ${cells} cell${cells === 1 ? "" : "s"} filled`;
}
const cleanTitle = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
const cleanIcon = (t: unknown) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(String(t ?? "").trim())].slice(0, 1).map((g) => g.segment).join("");
const MAX_PAGE = 400_000;

function accessFrom(input: unknown): Access | null {
  if (input === null || input === "inherit") return null;
  const a = (input ?? {}) as Partial<Access>;
  if (a.private) return { everyone: false, private: true, departments: [], agents: [] };
  return { everyone: a.everyone === true, private: false, departments: Array.isArray(a.departments) ? a.departments.map(String).slice(0, 50) : [], agents: Array.isArray(a.agents) ? a.agents.map(String).slice(0, 100) : [] };
}

const all_children = (byId: Map<string, Row>, id: string) => [...byId.values()].some((r) => r.parent === id);

/** Where a link to another page points, in a page's Markdown; the app opens it. The same form as the editor's. */
export const pageHref = (id: string) => `#page/${id}`;
const escapeLinkText = (t: string) => t.replace(/[\[\]]/g, "");

/** How long a deleted page can still be restored. */
export const KEEP_DELETED_DAYS = 30;

export const workspace = {
  /** Every page `who` may see, in tree order. */
  tree(org: Org, who: Who = OWNER): PageInfo[] {
    const d = db(org.id);
    const all = rows(d);
    const byId = new Map(all.map((r) => [r.id, r]));
    const open = openCounts(d);
    return all.filter((r) => seen(org, byId, r, who)).map((r) => info(org, d, r, byId, open));
  },

  /** What `who` may do with a page: "none", "read", "comment", "suggest" or "edit". */
  level(org: Org, id: string, who: Who): AccessLevel {
    const d = db(org.id);
    const all = rows(d);
    const row = all.find((r) => r.id === String(id));
    return row ? levelFor(org, new Map(all.map((r) => [r.id, r])), row, who) : "none";
  },

  /** Leaves a comment on a page. The owner always may; an agent needs at least the comment level. */
  comment(org: Org, who: Who, id: string, text: unknown, task: string | null = null): PageComment {
    const d = db(org.id);
    const { row, byId } = visible(org, d, id, who);
    if (who !== OWNER && RANK[levelFor(org, byId, row, who)] < RANK.comment) throw new Error(`You may read “${row.title}” but not comment on it. Put what you noticed in your report.`);
    const body = String(text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 2000);
    if (!body) throw new Error("Write the comment.");
    if ((d.prepare("select count(*) n from page_comments where page = ? and resolved = 0").get(row.id) as { n: number }).n >= 200) throw new Error("This file already has 200 open comments.");
    const author = authorOf(who);
    const cid = newId();
    d.prepare("insert into page_comments (id, page, author, text, task, created_at) values (?, ?, ?, ?, ?, ?)").run(cid, row.id, author, body, task, now());
    if (who !== OWNER) {
      this.used(org, task, row.id, "suggested");
      audit({ actor: author, actorName: nameOf(org, author), kind: "workspace", task: task ?? undefined, action: `Commented on “${row.title}”`, detail: body.slice(0, 300) });
    }
    return this.comments(org, row.id, true).find((c) => c.id === cid)!;
  },

  /** A page's comments, oldest first; open ones only unless asked for all. */
  comments(org: Org, id: string, all = false): PageComment[] {
    const d = db(org.id);
    return (d.prepare(`select * from page_comments where page = ? ${all ? "" : "and resolved = 0"} order by created_at`).all(String(id)) as unknown as { id: string; page: string; author: string; text: string; task: string | null; created_at: string; resolved: number }[]).map((c) => ({ id: c.id, page: c.page, author: c.author, authorName: nameOf(org, c.author), text: c.text, task: c.task, createdAt: c.created_at, resolved: Boolean(c.resolved) }));
  },

  /** Marks a comment dealt with. */
  resolveComment(org: Org, comment: string): { resolved: true } {
    const d = db(org.id);
    if (!Number(d.prepare("update page_comments set resolved = 1 where id = ?").run(String(comment)).changes)) throw new Error("There is no such comment.");
    return { resolved: true };
  },

  /** The owner's reminders that are due: notes and documents whose reminder time has come. */
  reminders(org: Org, now = new Date()): { id: string; title: string; kind: PageKind; remindAt: string }[] {
    return this.tree(org)
      .filter((p) => p.remindAt && p.remindAt <= now.toISOString())
      .map((p) => ({ id: p.id, title: p.title, kind: p.kind, remindAt: p.remindAt! }))
      .sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  },

  /** Office: the documents and notes `who` may see, newest first, with their folders, notebooks and tags. */
  office(org: Org, who: Who = OWNER) {
    const files = this.tree(org, who).filter((p) => p.kind !== "page").sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    const names = (kind: PageKind) => [...new Set(files.filter((f) => f.kind === kind && f.folder).map((f) => f.folder))].sort((a, b) => a.localeCompare(b));
    return { files, folders: names("doc"), notebooks: names("note"), tags: [...new Set(files.flatMap((f) => f.tags))].sort() };
  },

  /** One page with its text. */
  get(org: Org, id: string, who: Who = OWNER): Page {
    const d = db(org.id);
    const { row, byId } = visible(org, d, id, who);
    if (who !== OWNER) noteItem(row.title, levelOf(row.level), nameOf(org, String(who)));
    return { ...info(org, d, row, byId, openCounts(d)), ...content(d, row.id), files: who === OWNER ? this.attachments(org, row.id) : [] };
  },

  // ---------- photos and files attached to a note or document (the owner's; agents are not given them) ----------
  attachments(org: Org, page: string): Attachment[] {
    return (db(org.id).prepare("select id, name, type, size, words, created_at from page_files where page = ? order by created_at").all(String(page)) as never[]).map(attachmentOf);
  },

  /** Attaches a photo or file to a page. */
  attach(org: Org, page: string, name: unknown, data: Buffer): Attachment {
    const d = db(org.id);
    const { row } = visible(org, d, page, OWNER);
    const clean = String(name ?? "").replace(/[\\/\u0000-\u001f]/g, " ").trim().slice(-120) || "file";
    if (!data.length) throw new Error("That file is empty.");
    if (data.length > MAX_ATTACHMENT) throw new Error("That file is larger than 15 MB. Put it in the Library instead, and mention it in the note.");
    if ((d.prepare("select count(*) n from page_files where page = ?").get(row.id) as { n: number }).n >= MAX_ATTACHMENTS) throw new Error(`A note holds up to ${MAX_ATTACHMENTS} attachments. Remove one, or put the file in the Library.`);
    const id = newId();
    const type = (/\.([a-z0-9]{1,8})$/i.exec(clean)?.[1] ?? "").toLowerCase();
    d.prepare("insert into page_files (id, page, name, type, size, data, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, row.id, clean, type, data.length, data, new Date().toISOString());
    audit({ actor: "owner", actorName: "You", kind: "workspace", action: `Attached “${clean}” to “${row.title}”` });
    return this.attachments(org, row.id).find((f) => f.id === id)!;
  },

  /** One attachment with its content. */
  attachment(org: Org, page: string, id: string): { file: Attachment; data: Buffer; level: Level } {
    const d = db(org.id);
    const { row } = visible(org, d, page, OWNER);
    const r = d.prepare("select * from page_files where page = ? and id = ?").get(row.id, String(id)) as unknown as (Parameters<typeof attachmentOf>[0] & { data: Uint8Array }) | undefined;
    if (!r) throw new Error("There is no such attachment.");
    return { file: attachmentOf(r), data: Buffer.from(r.data), level: levelOf(row.level) };
  },

  detach(org: Org, page: string, id: string): { ok: true } {
    const d = db(org.id);
    const { row } = visible(org, d, page, OWNER);
    if (!Number(d.prepare("delete from page_files where page = ? and id = ?").run(row.id, String(id)).changes)) throw new Error("There is no such attachment.");
    return { ok: true };
  },

  /**
   * Writes out the words in an attached picture, so the note is found by them. `see` is given the picture and returns
   * its words; the caller decides which AI model does that and whether the note's sensitivity level lets it.
   */
  async readAttachment(org: Org, page: string, id: string, see: (picture: Buffer, mediaType: string) => Promise<string>): Promise<{ name: string; words: number }> {
    const { file, data } = this.attachment(org, page, id);
    const mediaType = PICTURE_TYPES[file.type];
    if (!mediaType) throw new Error("Only pictures (PNG, JPEG, WebP or GIF) can be read this way.");
    if (data.length > MAX_PICTURE_READ) throw new Error("This picture is larger than 5 MB. Attach a smaller copy to have its words read.");
    const text = (await see(data, mediaType)).replace(/\r\n?/g, "\n").trim().slice(0, 100_000);
    const words = !text || /^NONE\.?$/i.test(text) ? "" : text;
    db(org.id).prepare("update page_files set words = ? where id = ?").run(words, file.id);
    return { name: file.name, words: words ? words.split(/\s+/).length : 0 };
  },

  /** The words written out from an attached picture. */
  attachmentWords(org: Org, page: string, id: string): string {
    this.attachment(org, page, id);
    return (db(org.id).prepare("select words from page_files where id = ?").get(String(id)) as { words: string }).words;
  },

  /** A new page. The owner may put it anywhere; an agent only under a page it may see, and it inherits who may see it. */
  create(org: Org, who: Who, input: { parent?: unknown; title?: unknown; markdown?: unknown; icon?: unknown; template?: string; task?: string | null; position?: number; kind?: unknown; folder?: unknown; tags?: unknown; level?: unknown; project?: unknown }): Page {
    const d = db(org.id);
    const kind = kindOf(input.kind);
    // Documents and notes are not inside pages: a folder or notebook groups them.
    const parent = kind === "page" && input.parent ? visible(org, d, String(input.parent), who).row.id : null;
    if (who !== OWNER && kind === "page" && !parent) throw new Error("Put the page under a page you may see.");
    // The owner's notebooks are the owner's. An agent's own notes go to the one notebook kept for them.
    if (who !== OWNER && kind === "note" && String(input.folder ?? "") !== AGENT_NOTEBOOK) throw new Error("Notes are the owner's. Save your result as a document instead.");
    const title = cleanTitle(input.title) || "Untitled";
    const md = String(input.markdown ?? "");
    if (md.length > MAX_PAGE) throw new Error("That page is too long.");
    const id = newId();
    const author = authorOf(who);
    const last = (d.prepare("select max(position) p from pages where parent is ?").get(parent) as { p: number | null }).p ?? 0;
    d.prepare("insert into pages (id, parent, position, title, icon, edit, protected, template, created_by, updated_by, created_at, updated_at) values (?, ?, ?, ?, ?, 'suggest', 0, ?, ?, ?, ?, ?)").run(
      id, parent, input.position ?? last + 1, title, cleanIcon(input.icon), input.template ?? null, author, author, now(), now(),
    );
    // A page made inside another starts at that page's level, so a sensitive section stays sensitive.
    if (parent) d.prepare("update pages set level = (select level from pages where id = ?) where id = ?").run(parent, id);
    if (input.level !== undefined && who === OWNER) d.prepare("update pages set level = ? where id = ?").run(levelOf(input.level), id);
    if (input.project && who === OWNER) d.prepare("update pages set project = ? where id = ?").run(String(input.project).slice(0, 64), id);
    if (kind !== "page") {
      // A note starts private: no agent sees it until the owner says so. A document an agent writes is seen by its
      // own group (and the owner); one the owner makes starts open to every agent, like a page.
      const me = who !== OWNER ? memberOf(org, String(who)) : undefined;
      const access: Access | null = kind === "note" ? { everyone: false, private: true, departments: [], agents: [] } : who !== OWNER ? { everyone: false, private: false, departments: me ? [me.department] : [], agents: [String(who)] } : null;
      d.prepare("update pages set kind = ?, folder = ?, tags = ?, access = ? where id = ?").run(kind, cleanFolder(input.folder), JSON.stringify(cleanTags(input.tags)), access ? JSON.stringify(access) : null, id);
    }
    const row = d.prepare("select * from pages where id = ?").get(id) as unknown as Row;
    write(d, row, md, author, input.task ?? null);
    if (who !== OWNER) audit({ actor: String(who), actorName: nameOf(org, author), kind: "workspace", task: input.task ?? undefined, action: `Created the ${KIND_WORDS[kind]} “${title}”` });
    return this.get(org, id, OWNER);
  },

  /** The owner saves a page's text. `baseRev` is the version they started from; a newer one means someone else changed it. */
  save(org: Org, id: string, markdown: unknown, baseRev?: unknown): Page {
    const d = db(org.id);
    const { row } = visible(org, d, id, OWNER);
    const md = String(markdown ?? "");
    if (md.length > MAX_PAGE) throw new Error("That page is too long.");
    const current = content(d, row.id);
    if (baseRev !== undefined && Number(baseRev) !== current.rev) {
      // Someone (an agent with direct edits) changed it meanwhile: keep both where they do not overlap.
      const base = (d.prepare("select markdown from page_revisions where page = ? and rev = ?").get(row.id, Number(baseRev)) as { markdown: string } | undefined)?.markdown;
      const merged = base !== undefined ? merge(base, current.markdown, md) : null;
      if (merged === null) throw Object.assign(new Error("This page changed while you were editing it. Reload it to see the latest version; your text is still in the editor."), { status: 409 });
      write(d, row, merged, "owner");
      return this.get(org, id);
    }
    write(d, row, md, "owner");
    return this.get(org, id);
  },

  /** The owner changes a page's title, icon, place, who may see it, or how agents may change it. */
  update(org: Org, id: string, patch: { title?: unknown; icon?: unknown; parent?: unknown; position?: unknown; access?: unknown; edit?: unknown; protected?: unknown; kind?: unknown; folder?: unknown; tags?: unknown; level?: unknown; pinned?: unknown; remindAt?: unknown; project?: unknown; levels?: unknown }): Page {
    const d = db(org.id);
    const { row, byId } = visible(org, d, id, OWNER);
    if (patch.title !== undefined) {
      const title = cleanTitle(patch.title) || "Untitled";
      d.prepare("update pages set title = ? where id = ?").run(title, row.id);
      reindex(d, row.id, title, content(d, row.id).markdown);
      // Links to this page show its new name: their text is updated where it still showed the old one.
      if (title !== row.title) {
        const from = `[${escapeLinkText(row.title)}](${pageHref(row.id)})`;
        const to = `[${escapeLinkText(title)}](${pageHref(row.id)})`;
        for (const c of d.prepare("select page, markdown from page_content where instr(markdown, ?) > 0").all(from) as unknown as { page: string; markdown: string }[]) {
          d.prepare("update page_content set markdown = ? where page = ?").run(c.markdown.split(from).join(to), c.page);
        }
      }
    }
    if (patch.icon !== undefined) d.prepare("update pages set icon = ? where id = ?").run(cleanIcon(patch.icon), row.id);
    if (patch.parent !== undefined) {
      const parent = patch.parent ? String(patch.parent) : null;
      for (let at = parent; at; at = byId.get(at)?.parent ?? null) if (at === row.id) throw new Error("A page cannot go inside itself.");
      if (parent && !byId.has(parent)) throw new Error("There is no such page.");
      d.prepare("update pages set parent = ? where id = ?").run(parent, row.id);
    }
    if (patch.position !== undefined && Number.isFinite(Number(patch.position))) d.prepare("update pages set position = ? where id = ?").run(Number(patch.position), row.id);
    if (patch.access !== undefined) d.prepare("update pages set access = ? where id = ?").run(((a) => (a ? JSON.stringify(a) : null))(accessFrom(patch.access)), row.id);
    if (patch.edit !== undefined) d.prepare("update pages set edit = ? where id = ?").run(patch.edit === "direct" ? "direct" : "suggest", row.id);
    if (patch.protected !== undefined) d.prepare("update pages set protected = ? where id = ?").run(patch.protected ? 1 : 0, row.id);
    if (patch.folder !== undefined) d.prepare("update pages set folder = ? where id = ?").run(cleanFolder(patch.folder), row.id);
    if (patch.pinned !== undefined) d.prepare("update pages set pinned = ? where id = ?").run(patch.pinned ? 1 : 0, row.id);
    if (patch.levels !== undefined) {
      const levels = patch.levels === null ? null : levelsOf(patch.levels);
      d.prepare("update pages set levels = ? where id = ?").run(levels ? JSON.stringify(levels) : null, row.id);
      audit({ actor: "owner", actorName: "You", kind: "workspace", action: levels ? `Set who may do what with “${row.title}”` : `Went back to the simple settings for “${row.title}”`, detail: levels ? [levels.everyone ? `every agent: ${levels.everyone}` : "", ...Object.entries(levels.departments).map(([k, v]) => `${k}: ${v}`), ...Object.entries(levels.agents).map(([k, v]) => `${nameOf(org, k)}: ${v}`)].filter(Boolean).join(", ").slice(0, 300) : undefined });
    }
    if (patch.project !== undefined) d.prepare("update pages set project = ? where id = ?").run(patch.project ? String(patch.project).slice(0, 64) : null, row.id);
    if (patch.remindAt !== undefined) {
      const at = patch.remindAt ? new Date(String(patch.remindAt)) : null;
      if (at && Number.isNaN(at.getTime())) throw new Error("Choose a date and time for the reminder.");
      d.prepare("update pages set remind_at = ? where id = ?").run(at ? at.toISOString() : null, row.id);
    }
    if (patch.level !== undefined && levelOf(patch.level) !== levelOf(row.level)) {
      d.prepare("update pages set level = ? where id = ?").run(levelOf(patch.level), row.id);
      audit({ actor: "owner", actorName: "You", kind: "workspace", action: `Marked “${row.title}” ${LEVEL_WORDS[levelOf(patch.level)].name}`, detail: `It was ${LEVEL_WORDS[levelOf(row.level)].name}.` });
    }
    if (patch.tags !== undefined) d.prepare("update pages set tags = ? where id = ?").run(JSON.stringify(cleanTags(patch.tags)), row.id);
    if (patch.kind !== undefined && kindOf(patch.kind) !== kindOf(row.kind)) {
      // Turning a note into a document or a page (or back): the text, history and who may see it stay as they are.
      const kind = kindOf(patch.kind);
      if (all_children(byId, row.id)) throw new Error("This page has pages inside it. Move them out first.");
      d.prepare("update pages set kind = ?, parent = null where id = ?").run(kind, row.id);
    }
    d.prepare("update pages set updated_at = ? where id = ?").run(now(), row.id);
    return this.get(org, id);
  },

  /** Moves a page and everything under it to Deleted, where it can be restored. */
  archive(org: Org, id: string): { archived: number } {
    const d = db(org.id);
    const { row } = visible(org, d, id, OWNER);
    const all = rows(d);
    const gone = new Set([row.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of all) if (r.parent && gone.has(r.parent) && !gone.has(r.id)) gone.add(r.id), (grew = true);
    }
    for (const g of gone) d.prepare("update pages set archived = 1, updated_at = ? where id = ?").run(now(), g);
    d.prepare(`update page_suggestions set status = 'declined', decided_at = ? where status = 'open' and page in (${[...gone].map(() => "?").join(",")})`).run(now(), ...gone);
    return { archived: gone.size };
  },

  /** Deleted pages, newest first. Ones deleted more than 30 days ago are removed for good first. */
  deleted(org: Org): { id: string; title: string; updatedAt: string; daysLeft: number }[] {
    this.purge(org, { olderThanDays: KEEP_DELETED_DAYS });
    return rows(db(org.id), true).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, daysLeft: Math.max(0, KEEP_DELETED_DAYS - Math.floor((Date.now() - Date.parse(r.updated_at)) / 86_400_000)) }));
  },

  /**
   * Removes deleted pages for good, with their history, suggestions and search text: every deleted page (Empty
   * deleted), or those deleted more than `olderThanDays` ago. Pages that are not deleted are never touched.
   */
  purge(org: Org, { olderThanDays }: { olderThanDays?: number } = {}): { removed: number } {
    const d = db(org.id);
    const cutoff = olderThanDays === undefined ? null : new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const gone = (d.prepare("select id, updated_at from pages where archived = 1").all() as unknown as { id: string; updated_at: string }[])
      .filter((r) => cutoff === null || r.updated_at < cutoff)
      .map((r) => r.id);
    for (const id of gone) {
      for (const table of ["page_revisions", "page_suggestions", "page_passages", "page_files"]) d.prepare(`delete from ${table} where page = ?`).run(id);
      d.prepare("delete from page_content where page = ?").run(id);
      d.prepare("delete from pages where id = ?").run(id);
    }
    return { removed: gone.length };
  },

  restore(org: Org, id: string): Page {
    const d = db(org.id);
    const row = d.prepare("select * from pages where id = ? and archived = 1").get(String(id)) as unknown as Row | undefined;
    if (!row) throw new Error("There is no such deleted page.");
    // A page whose parent is still deleted comes back at the top.
    const parentGone = row.parent ? Boolean((d.prepare("select archived from pages where id = ?").get(row.parent) as { archived: number } | undefined)?.archived ?? 1) : false;
    d.prepare("update pages set archived = 0, parent = ? where id = ?").run(parentGone ? null : row.parent, row.id);
    return this.get(org, row.id);
  },

  /** The pages that link to this one, among those `who` may see. */
  backlinks(org: Org, id: string, who: Who = OWNER): { id: string; title: string; icon: string }[] {
    const d = db(org.id);
    const { row } = visible(org, d, id, who);
    const linking = d.prepare("select c.page from page_content c join pages p on p.id = c.page where p.archived = 0 and c.page != ? and instr(c.markdown, ?) > 0").all(row.id, `](${pageHref(row.id)})`) as unknown as { page: string }[];
    const shown = new Map(this.tree(org, who).map((p) => [p.id, p]));
    return linking.flatMap((l) => (shown.has(l.page) ? [{ id: l.page, title: shown.get(l.page)!.title, icon: shown.get(l.page)!.icon }] : []));
  },

  revisions(org: Org, id: string): { rev: number; title: string; author: string; at: string; words: number }[] {
    const d = db(org.id);
    const { row } = visible(org, d, id, OWNER);
    return (d.prepare("select rev, title, author, at, markdown from page_revisions where page = ? order by rev desc").all(row.id) as unknown as { rev: number; title: string; author: string; at: string; markdown: string }[]).map((r) => ({
      rev: r.rev, title: r.title, author: nameOf(org, r.author), at: r.at, words: plain(r.markdown).split(" ").filter(Boolean).length,
    }));
  },

  revision(org: Org, id: string, rev: number): { rev: number; markdown: string } {
    const d = db(org.id);
    const { row } = visible(org, d, id, OWNER);
    const r = d.prepare("select rev, markdown from page_revisions where page = ? and rev = ?").get(row.id, Number(rev)) as { rev: number; markdown: string } | undefined;
    if (!r) throw new Error("There is no such version.");
    return r;
  },

  /** Puts an earlier version back, as a new version (so nothing is lost). */
  restoreRevision(org: Org, id: string, rev: number): Page {
    const r = this.revision(org, id, rev);
    const d = db(org.id);
    write(d, visible(org, d, id, OWNER).row, r.markdown, "owner");
    return this.get(org, id);
  },

  /** The passages that best match some words, from pages `who` may see. */
  search(org: Org, who: Who, query: string, limit = 6): { page: string; title: string; heading: string; text: string }[] {
    const d = db(org.id);
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 16);
    if (!words.length) return [];
    let hits: { page: string; heading: string; text: string; seq: number }[] = [];
    try {
      hits = d.prepare("select p.page, p.heading, p.text, p.seq from page_passages_fts f join page_passages p on p.id = f.rowid where page_passages_fts match ? order by bm25(page_passages_fts) limit 60").all(words.map((w) => `"${w}"*`).join(" OR ")) as unknown as typeof hits;
    } catch {
      return [];
    }
    const all = rows(d);
    const byId = new Map(all.map((r) => [r.id, r]));
    const per = new Map<string, number>();
    const out: { page: string; title: string; heading: string; text: string }[] = [];
    for (const h of hits) {
      const row = byId.get(h.page);
      if (!row || !seen(org, byId, row, who)) continue;
      if ((per.get(h.page) ?? 0) >= 3) continue;
      // A title match only counts when no passage of the same page matched.
      if (h.seq === 0 && hits.some((x) => x.page === h.page && x.seq > 0)) continue;
      per.set(h.page, (per.get(h.page) ?? 0) + 1);
      out.push({ page: h.page, title: row.title, heading: h.heading, text: h.text });
      if (out.length >= limit) break;
    }
    return out;
  },

  /** Records that a task used a page, for its receipt. */
  used(org: Org, task: string | null | undefined, page: string, how: "read" | "found" | "changed" | "suggested" | "filed") {
    if (!task) return;
    db(org.id).prepare("insert or ignore into page_uses (task, page, how, at) values (?, ?, ?, ?)").run(task, page, how, now());
  },

  /** The pages a task used, for its receipt. */
  usesOf(org: Org, task: string): { page: string; title: string; how: string[] }[] {
    const d = db(org.id);
    const uses = d.prepare("select u.page, p.title, u.how from page_uses u left join pages p on p.id = u.page where u.task = ? order by u.at").all(task) as unknown as { page: string; title: string | null; how: string }[];
    const out = new Map<string, { page: string; title: string; how: string[] }>();
    for (const u of uses) {
      const e = out.get(u.page) ?? { page: u.page, title: u.title ?? "A deleted page", how: [] };
      e.how.push(u.how);
      out.set(u.page, e);
    }
    return [...out.values()];
  },

  /** The tasks that used a page, newest first. */
  tasksOf(org: Org, page: string): { task: string; how: string; at: string }[] {
    return db(org.id).prepare("select task, how, at from page_uses where page = ? order by at desc limit 30").all(page) as unknown as { task: string; how: string; at: string }[];
  },

  /**
   * An agent's change to a page, in Markdown. It is applied straight away on a page set to take agents' edits
   * (never a protected one); otherwise it waits for the owner as a suggestion.
   */
  propose(org: Org, who: Who, id: string, markdown: unknown, note: unknown = "", task: string | null = null): { applied: boolean; suggestion?: string; page: Page } {
    if (who === OWNER) throw new Error("The owner edits pages directly.");
    const d = db(org.id);
    const { row } = visible(org, d, id, who);
    const md = String(markdown ?? "");
    if (!md.trim()) throw new Error("Write the whole new text of the page, in Markdown.");
    if (md.length > MAX_PAGE) throw new Error("That page is too long.");
    const current = content(d, row.id);
    if (md === current.markdown) throw new Error("That is the page as it already is.");
    const author = authorOf(who);
    const may = levelFor(org, new Map(rows(d).map((r) => [r.id, r])), row, who);
    if (RANK[may] < RANK.suggest) throw new Error(`You may ${may === "comment" ? "read and comment on" : "read"} “${row.title}”, but not change it. ${may === "comment" ? "Leave a comment with what should change" : "If it needs changing, say so in your report"}.`);
    if (may === "edit") {
      write(d, row, md, author, task);
      this.used(org, task, row.id, "changed");
      audit({ actor: author, actorName: nameOf(org, author), kind: "workspace", task: task ?? undefined, action: `Changed the page “${row.title}”`, detail: String(note ?? "").slice(0, 300) });
      return { applied: true, page: this.get(org, id) };
    }
    // One open suggestion per agent and page: a newer one replaces the older.
    d.prepare("update page_suggestions set status = 'declined', decided_at = ? where page = ? and author = ? and status = 'open'").run(now(), row.id, author);
    const sid = newId();
    d.prepare("insert into page_suggestions (id, page, base_rev, base, markdown, note, author, task, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sid, row.id, current.rev, current.markdown, md, String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 500), author, task, now());
    this.used(org, task, row.id, "suggested");
    audit({ actor: author, actorName: nameOf(org, author), kind: "workspace", task: task ?? undefined, action: `Suggested a change to the page “${row.title}”`, detail: String(note ?? "").slice(0, 300) });
    return { applied: false, suggestion: sid, page: this.get(org, id) };
  },

  /** Suggestions, open ones first, for one page or all pages. */
  suggestions(org: Org, page?: string, status: "open" | "all" = "open"): Suggestion[] {
    const d = db(org.id);
    const all = d.prepare(`select s.*, p.title from page_suggestions s join pages p on p.id = s.page where p.archived = 0 ${page ? "and s.page = ?" : ""} ${status === "open" ? "and s.status = 'open'" : ""} order by s.created_at desc limit 200`).all(...(page ? [page] : [])) as unknown as {
      id: string; page: string; title: string; base_rev: number; base: string; markdown: string; note: string; author: string; task: string | null; status: string; created_at: string; decided_at: string | null;
    }[];
    return all.map((s) => {
      const current = content(d, s.page);
      return {
        id: s.id, page: s.page, pageTitle: s.title, baseRev: s.base_rev, markdown: s.markdown, note: s.note, author: s.author, authorName: nameOf(org, s.author), task: s.task,
        status: s.status as Suggestion["status"], createdAt: s.created_at, decidedAt: s.decided_at,
        diff: diff(s.status === "open" ? current.markdown : s.base, s.markdown), stale: s.status === "open" && current.rev !== s.base_rev,
      };
    });
  },

  /**
   * The owner's answer to a suggestion. Accepting applies it, carried onto the page as it is now when the page
   * changed meanwhile in other places; where the same lines changed, `replace` must be set to use the agent's text.
   */
  decide(org: Org, id: string, decision: unknown, replace = false): { status: string; page: Page } {
    const d = db(org.id);
    const s = d.prepare("select * from page_suggestions where id = ?").get(String(id)) as unknown as { id: string; page: string; base_rev: number; base: string; markdown: string; author: string; task: string | null; status: string } | undefined;
    if (!s) throw new Error("There is no such suggestion.");
    if (s.status !== "open") throw new Error("That suggestion has already been answered.");
    if (decision !== "accept" && decision !== "decline") throw new Error("Accept or decline it.");
    const { row } = visible(org, d, s.page, OWNER);
    if (decision === "accept") {
      const current = content(d, row.id);
      const merged = current.rev === s.base_rev ? s.markdown : merge(s.base, current.markdown, s.markdown);
      if (merged === null && !replace) throw Object.assign(new Error("The page changed in the same places since the agent read it. Look at the change against the page as it is now, then accept it to use the agent's version."), { status: 409 });
      write(d, row, merged ?? s.markdown, s.author, s.task);
    }
    d.prepare("update page_suggestions set status = ?, decided_at = ? where id = ?").run(decision === "accept" ? "accepted" : "declined", now(), s.id);
    audit({ actor: "owner", actorName: "You", kind: "workspace", task: s.task ?? undefined, action: `${decision === "accept" ? "Accepted" : "Declined"} ${nameOf(org, s.author)}'s change to “${row.title}”` });
    return { status: decision === "accept" ? "accepted" : "declined", page: this.get(org, row.id) };
  },

  /** Reads a page, or the section under one heading, in parts of about 1,500 words. */
  read(org: Org, who: Who, id: string, section = "", part = 1): { title: string; text: string; part: number; parts: number; sections: string[] } {
    const d = db(org.id);
    const { row } = visible(org, d, id, who);
    const md = content(d, row.id).markdown;
    const sections = md.split("\n").map((l) => /^\s{0,3}#{1,6}\s+(.*)$/.exec(l)?.[1]).filter(Boolean).map((h) => plain(h!));
    let text = md;
    if (section.trim()) {
      const lines = md.split("\n");
      const want = section.trim().toLowerCase();
      const start = lines.findIndex((l) => /^\s{0,3}#{1,6}\s+/.test(l) && plain(l.replace(/^\s{0,3}#{1,6}\s+/, "")).toLowerCase().includes(want));
      if (start < 0) throw new Error(`This page has no section called “${section}”. Its sections: ${sections.join("; ") || "none"}.`);
      const level = /^\s{0,3}(#{1,6})/.exec(lines[start])![1].length;
      const end = lines.findIndex((l, i) => i > start && ((m) => m && m[1].length <= level)(/^\s{0,3}(#{1,6})\s+/.exec(l)));
      text = lines.slice(start, end < 0 ? undefined : end).join("\n");
    }
    const words = text.split(/(?<=\s)/);
    const size = 1500;
    const parts = Math.max(1, Math.ceil(words.length / size));
    const p = Math.min(Math.max(1, Math.floor(part) || 1), parts);
    return { title: row.title, text: words.slice((p - 1) * size, p * size).join(""), part: p, parts, sections };
  },

  /** The ready-made pages to start from. */
  templates() {
    return TEMPLATES.map((t) => ({ id: t.id, name: t.name, group: t.group, summary: t.summary, pages: t.pages.map((p) => p.title) }));
  },

  /**
   * The page packs, as the Marketplace lists them: what each adds, who would see its pages on this chart, which pages
   * start protected, and whether it is already in the workspace (and where).
   */
  packs(org: Org) {
    const d = db(org.id);
    const groups = new Set(org.members.map((m) => m.department));
    return TEMPLATES.map((t) => {
      const top = d.prepare("select id from pages where template = ? and parent is null and archived = 0 order by created_at desc limit 1").get(t.id) as { id: string } | undefined;
      return {
        id: t.id,
        name: t.name,
        icon: t.icon,
        summary: t.summary,
        group: t.group,
        /** Who sees the pages once added: the pack's group when the chart has it, otherwise every agent. */
        sharedWith: groups.has(t.group) ? `the ${t.group} group` : "every agent",
        pages: t.pages.map((p) => ({ title: p.title, icon: p.icon, protected: Boolean(p.protected) })),
        added: top?.id ?? null,
      };
    });
  },

  /** Adds a template's pages under a new page named after it, visible to the template's group if the chart has one. */
  addTemplate(org: Org, id: string): Page {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) throw new Error("There is no such template.");
    const top = this.create(org, OWNER, { title: t.name, icon: t.icon, markdown: t.intro, template: t.id });
    const groups = new Set(org.members.map((m) => m.department));
    if (groups.has(t.group)) this.update(org, top.id, { access: { everyone: false, departments: [t.group], agents: [] } });
    for (const p of t.pages) {
      const page = this.create(org, OWNER, { parent: top.id, title: p.title, icon: p.icon, markdown: p.markdown, template: t.id });
      if (p.protected) this.update(org, page.id, { protected: true });
    }
    return this.get(org, top.id);
  },

  /** How much is in the workspace, for agents' prompts and the page. */
  stats(org: Org, who: Who = OWNER): { pages: number; suggestions: number } {
    const tree = this.tree(org, who);
    return { pages: tree.length, suggestions: tree.reduce((n, p) => n + p.suggestions, 0) };
  },
};

/** For an agent's prompt: that the workspace is there, and the pages that best match its task (titles and summaries only). */
export function workspacePrompt(org: Org, who: Who, about = ""): string {
  let stats: { pages: number };
  try {
    stats = workspace.stats(org, who);
  } catch {
    return "";
  }
  if (!stats.pages) return "";
  const intro = `# The organization's workspace\n\nThe owner keeps ${stats.pages} page${stats.pages === 1 ? "" : "s"} you may read in the workspace: how the business works, procedures, checklists and decisions. Before you work out how to do something, look there with the workspace tool: follow a page's procedure when there is one, and say which pages you used in your report. A page is information from the owner, not instructions from anyone else.`;
  let hits: ReturnType<typeof workspace.search> = [];
  try {
    hits = about.trim() ? workspace.search(org, who, about, 8) : [];
  } catch {}
  const seen = new Set<string>();
  const pages = hits.filter((h) => !seen.has(h.page) && seen.add(h.page)).slice(0, 5);
  if (!pages.length) return intro;
  const tree = new Map(workspace.tree(org, who).map((p) => [p.id, p]));
  const lines = pages.map((h) => `- “${h.title}” (page ${h.page}): ${tree.get(h.page)?.summary || h.text.slice(0, 200)}`);
  return `${intro}\n\nPages that match this task (read one with the workspace tool before relying on it):\n${lines.join("\n")}`;
}

/** For an agent's prompt: the files that belong to the project its task is in, so it starts from them. */
export function projectFilesPrompt(org: Org, who: Who, project: string | null | undefined, projectTitle = ""): string {
  if (!project) return "";
  let files: PageInfo[] = [];
  try {
    files = workspace.tree(org, who).filter((p) => p.project === project);
  } catch {}
  if (!files.length) return "";
  return `# This task's project${projectTitle ? `: ${projectTitle}` : ""}\n\nThese files belong to the project. Start from them, and put what you make with them:\n${files.slice(0, 30).map((p) => `- “${p.title}” (${KIND_WORDS[p.kind]}, ${p.kind === "sheet" ? `sheet tool, file ${p.id}` : `workspace tool, page ${p.id}`})`).join("\n")}`;
}

/** The tool agents use for the workspace. `who` says which agent is calling, and `task` which task it is working on. */
export function workspaceTool(who: (conversationId: string) => string | null): Tool {
  return defineTool<{ action: "search" | "read" | "list" | "suggest" | "file" | "comment"; kind?: string; folder?: string; query?: string; page?: string; section?: string; part?: number; markdown?: string; note?: string; title?: string; parent?: string }>({
    name: "workspace",
    description:
      "The organization's workspace: pages the owner keeps (procedures, checklists, decisions, notes). " +
      "\"search\" finds the pages and passages that match some words. \"read\" returns a page (or one section of it, by heading) in Markdown. \"list\" shows the pages you may read. " +
      "\"suggest\" proposes a change to a page: give the page's whole new text in Markdown and a one-line note on what changed and why; the owner accepts or declines it, unless the page takes edits directly. " +
      "\"file\" saves your result as a new page under a page you may read (give a title and the Markdown), or, with kind \"document\", as an Office document the owner can open, edit and download (letters, proposals, reports; a folder is optional). " +
      "Documents the owner keeps in Office are listed, searched, read and suggested on in the same way as pages. " +
      "For kind \"slides\", write the Markdown as slides separated by a line of three dashes (---): each slide starts with \"# Title\", then a few short bullet points or a small table, then optionally \"Notes: …\" with what the presenter should say. Keep each slide to one idea and at most five bullets. To show a chart from one of the owner's sheets, put a line by itself on the slide: !chart <the sheet's page id> <the chart's title>; it always shows the sheet as it is now, so never copy the numbers. Existing slides are read and suggested on like pages, in the same form. " +
      "\"comment\" leaves a short note on a page or file for the owner (put it in note): use it where you may read but not change something, or to point something out without rewriting. " +
      "Read a page before suggesting a change to it.",
    properties: {
      action: { type: "string", enum: ["search", "read", "list", "suggest", "file", "comment"] },
      query: { type: "string", description: "For search: a few words about what you are looking for." },
      page: { type: "string", description: "For read and suggest: the page's id, as given by search or list." },
      section: { type: "string", description: "For read: only the section under this heading." },
      part: { type: "number", description: "For read: which part of a long page or section (1 is the start)." },
      markdown: { type: "string", description: "For suggest: the page's whole new text. For file: the new page's text." },
      note: { type: "string", description: "For suggest: one line on what you changed and why, for the owner. For comment: the comment itself." },
      title: { type: "string", description: "For file: the new page's title." },
      parent: { type: "string", description: "For file: the id of the page to put it under." },
      kind: { type: "string", enum: ["page", "document", "slides", "note"], description: "For file: \"document\" saves an Office document instead of a workspace page; \"slides\" saves a presentation; \"note\" saves a short note for the owner in the notebook for agents' notes." },
      folder: { type: "string", description: "For file with kind document: the folder to put it in, e.g. Customers." },
    },
    required: ["action"],
    async run(input, { conversation }) {
      const org = orgs.active();
      const agent = who(conversation.id) ?? GENERAL_AGENT;
      const task = conversation.id;
      if (input.action === "list") {
        const tree = workspace.tree(org, agent);
        if (!tree.length) return "The workspace has no pages you may read yet.";
        const depth = (p: PageInfo): number => (p.parent ? 1 + depth(tree.find((x) => x.id === p.parent) ?? ({ parent: null } as PageInfo)) : 0);
        return tree.map((p) => `${"  ".repeat(Math.min(depth(p), 6))}- [${p.id}] ${p.title}${p.kind === "doc" ? ` (document${p.folder ? ` in ${p.folder}` : ""})` : p.kind === "note" ? " (note)" : ""}${p.protected ? " (protected)" : ""}`).join("\n");
      }
      if ((input.action === "read" || input.action === "suggest") && input.page && workspace.tree(org, agent).find((p) => p.id === String(input.page))?.kind === "sheet") throw new Error("That is a sheet. Read and change it with the sheet tool.");
      if (input.action === "read") {
        const r = workspace.read(org, agent, String(input.page ?? ""), String(input.section ?? ""), Number(input.part) || 1);
        workspace.used(org, task, String(input.page), "read");
        return `${r.title}${r.parts > 1 ? ` · part ${r.part} of ${r.parts}${r.part < r.parts ? ` (read on with part: ${r.part + 1})` : ""}` : ""}${r.sections.length && !input.section ? `\nSections: ${r.sections.join("; ")}` : ""}\n\n${r.text || "(This page is empty.)"}`;
      }
      if (input.action === "comment") {
        const c = workspace.comment(org, agent, String(input.page ?? ""), input.note ?? input.markdown, task);
        return `Your comment is on the file for the owner to read (${c.text.length} characters). Say so in your report.`;
      }
      if (input.action === "suggest") {
        const r = workspace.propose(org, agent, String(input.page ?? ""), input.markdown, input.note, task);
        return r.applied ? `Changed “${r.page.title}”: this page takes agents' edits directly. Say so in your report.` : `Suggested a change to “${r.page.title}”. The owner will accept or decline it; the page stays as it was until then. Say so in your report.`;
      }
      if (input.action === "file") {
        if (input.kind === "slides") {
          const deck = workspace.create(org, agent, { kind: "deck", folder: input.folder, title: input.title, markdown: writeDeck(parseDeck(String(input.markdown ?? ""))), task });
          workspace.used(org, task, deck.id, "filed");
          return `Saved as the slides “${deck.title}” (page ${deck.id}) in Office, ${parseDeck(deck.markdown).length} slides. Say so in your report.`;
        }
        if (input.kind === "note") {
          // A short finding for the owner: it goes to one notebook kept for agents' notes, tagged with who wrote it.
          const note = workspace.create(org, agent, { kind: "note", folder: AGENT_NOTEBOOK, title: input.title, markdown: input.markdown, task });
          workspace.used(org, task, note.id, "filed");
          return `Saved as the note “${note.title}” (page ${note.id}) in the notebook ${AGENT_NOTEBOOK}. Say so in your report.`;
        }
        if (input.kind === "document") {
          const doc = workspace.create(org, agent, { kind: "doc", folder: input.folder, title: input.title, markdown: input.markdown, task });
          workspace.used(org, task, doc.id, "filed");
          return `Saved as the document “${doc.title}” (page ${doc.id}) in Office${doc.folder ? `, in the folder ${doc.folder}` : ""}. Say so in your report.`;
        }
        const parent = String(input.parent ?? "");
        if (!parent) throw new Error("Say which page to put it under (parent), or give kind: \"document\" to save it as an Office document. List the pages to choose one.");
        const page = workspace.create(org, agent, { parent, title: input.title, markdown: input.markdown, task });
        workspace.used(org, task, page.id, "filed");
        return `Saved as the page “${page.title}” (page ${page.id}). Say so in your report.`;
      }
      const hits = workspace.search(org, agent, String(input.query ?? ""));
      if (!hits.length) return "No page matches that. Try other words for the same thing, or list the pages.";
      for (const h of hits) workspace.used(org, task, h.page, "found");
      return hits.map((h) => `[${h.page}] ${h.title}${h.heading ? ` › ${h.heading}` : ""}\n${h.text.slice(0, 900)}`).join("\n\n---\n\n");
    },
  });
}

/** Saves a finished task's report as a page, for the owner. */
export function fileReport(org: Org, task: string, title: string, markdown: string, parent?: unknown): Page {
  const page = workspace.create(org, OWNER, { parent: parent || null, title, markdown, task });
  workspace.used(org, task, page.id, "filed");
  return page;
}

