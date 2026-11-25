// Simple databases in the workspace: tables of records with typed columns (text, number, date, choice, person), for
// customer lists, inventories and trackers. A table sits on a workspace page and follows that page's rules: whoever
// may see the page may read the table; an agent's change to a row is applied straight away only when the page takes
// agents' edits directly (never on a protected page), and otherwise waits for the owner to accept or decline.
// Tables come in and go out as CSV.
import type { DatabaseSync } from "node:sqlite";
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { newId } from "./store.ts";
import { orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { GENERAL_AGENT, OWNER, openOrgDb } from "./library.ts";
import { workspace } from "./workspace.ts";
import type { Who } from "./workspace.ts";
import { audit } from "./audit.ts";

export const COLUMN_TYPES = ["text", "number", "date", "choice", "person"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** For a choice column: what may be chosen. */
  options?: string[];
}

export type Value = string | number | null;

export interface TableRow {
  id: string;
  /** Values by column id. */
  values: Record<string, Value>;
  updatedBy: string;
  updatedAt: string;
}

/** A change to a row that an agent asked for, waiting for the owner. */
export interface RowChange {
  id: string;
  /** The row to change, or null for a new row. */
  row: string | null;
  values: Record<string, Value>;
  note: string;
  author: string;
  authorName: string;
  task: string | null;
  createdAt: string;
}

export interface TableInfo {
  id: string;
  page: string;
  name: string;
  columns: Column[];
  rows: number;
  /** Changes from agents waiting for the owner. */
  waiting: number;
}

export interface Table extends Omit<TableInfo, "rows"> {
  rows: TableRow[];
  changes: RowChange[];
  /** Whether agents' changes apply straight away (the page's setting). */
  agentsChangeDirectly: boolean;
}

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 5000;
const MAX_TEXT = 2000;
const now = () => new Date().toISOString();

const ready = new WeakSet<DatabaseSync>();
function db(orgId: string): DatabaseSync {
  const d = openOrgDb(orgId);
  if (ready.has(d)) return d;
  d.exec(`
    create table if not exists ws_tables (id text primary key, page text not null, name text not null, columns text not null, position real not null default 0, created_at text not null);
    create index if not exists ws_tables_page on ws_tables(page, position);
    create table if not exists ws_rows (id text primary key, tbl text not null, position real not null default 0, data text not null, updated_by text not null, updated_at text not null);
    create index if not exists ws_rows_tbl on ws_rows(tbl, position);
    create table if not exists ws_row_changes (id text primary key, tbl text not null, row text, data text not null, note text not null default '', author text not null, task text, status text not null default 'open', created_at text not null, decided_at text);
    create index if not exists ws_row_changes_tbl on ws_row_changes(tbl, status);
  `);
  ready.add(d);
  return d;
}

interface TRow {
  id: string;
  page: string;
  name: string;
  columns: string;
}

const clean = (t: unknown, max = 80) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const nameOf = (org: Org, who: string) => (who === "owner" ? "You" : who === GENERAL_AGENT ? "The assistant" : org.members.find((m) => m.bot === who)?.title || who);
const authorOf = (who: Who) => (who === OWNER ? "owner" : who);

/** The people a person column can hold: you, and every position on the chart. */
export const peopleOf = (org: Org): string[] => ["You", ...new Set(org.members.map((m) => m.title || m.bot))];

/** Columns as given, checked: a name and a type each, choices for a choice column. Existing ids are kept. */
function columnsFrom(input: unknown): Column[] {
  if (!Array.isArray(input) || !input.length) throw new Error("A table needs at least one column.");
  if (input.length > MAX_COLUMNS) throw new Error(`A table can have up to ${MAX_COLUMNS} columns.`);
  const seen = new Set<string>();
  const ids = new Set<string>();
  return input.map((raw) => {
    const c = (raw ?? {}) as Partial<Column>;
    const name = clean(c.name);
    if (!name) throw new Error("Every column needs a name.");
    if (seen.has(name.toLowerCase())) throw new Error(`Two columns are called “${name}”. Give each its own name.`);
    seen.add(name.toLowerCase());
    const type = COLUMN_TYPES.includes(c.type as ColumnType) ? (c.type as ColumnType) : "text";
    let id = typeof c.id === "string" && /^[a-z0-9]{4,20}$/.test(c.id) && !ids.has(c.id) ? c.id : newId().slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "x");
    while (ids.has(id)) id = newId().slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "x");
    ids.add(id);
    const col: Column = { id, name, type };
    if (type === "choice") {
      const options = [...new Set((Array.isArray(c.options) ? c.options : String(c.options ?? "").split(",")).map((o) => clean(o, 60)).filter(Boolean))].slice(0, 50);
      if (!options.length) throw new Error(`Give the choices for “${name}”, separated by commas.`);
      col.options = options;
    }
    return col;
  });
}

/** One value, made to fit its column, or an error in plain words. Empty is always allowed. */
export function fit(org: Org, col: Column, raw: unknown): Value {
  const text = typeof raw === "number" ? String(raw) : String(raw ?? "").trim();
  if (!text) return null;
  if (col.type === "number") {
    const n = Number(text.replace(/[$€£,\s]/g, ""));
    if (!Number.isFinite(n)) throw new Error(`“${col.name}” takes a number, and “${text.slice(0, 40)}” is not one.`);
    return n;
  }
  if (col.type === "date") {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : us ? [+us[3], +us[1], +us[2]] : [0, 0, 0];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (!y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error(`“${col.name}” takes a date written like 2026-03-31, and “${text.slice(0, 40)}” is not one.`);
    return date.toISOString().slice(0, 10);
  }
  if (col.type === "choice") {
    const hit = (col.options ?? []).find((o) => o.toLowerCase() === text.toLowerCase());
    if (!hit) throw new Error(`“${col.name}” takes one of: ${(col.options ?? []).join(", ")}. “${text.slice(0, 40)}” is not one of them.`);
    return hit;
  }
  if (col.type === "person") {
    const people = peopleOf(org);
    const hit = people.find((p) => p.toLowerCase() === text.toLowerCase()) ?? (/^(me|owner|the owner)$/i.test(text) ? "You" : undefined);
    if (!hit) throw new Error(`“${col.name}” takes a person on your chart (${people.slice(0, 12).join(", ")}${people.length > 12 ? "…" : ""}). “${text.slice(0, 40)}” is not one.`);
    return hit;
  }
  return text.slice(0, MAX_TEXT);
}

/** Values as given (by column name or id), made to fit. Columns not named are left out. */
function valuesFrom(org: Org, columns: Column[], input: unknown): Record<string, Value> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Give the values as column name and value pairs.");
  const out: Record<string, Value> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const col = columns.find((c) => c.id === key) ?? columns.find((c) => c.name.toLowerCase() === key.trim().toLowerCase());
    if (!col) throw new Error(`This table has no column called “${key.slice(0, 60)}”. Its columns are: ${columns.map((c) => c.name).join(", ")}.`);
    out[col.id] = fit(org, col, raw);
  }
  return out;
}

const parse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** The table and its page, if `who` may see the page; otherwise an error that does not say which. */
function open(org: Org, id: string, who: Who) {
  const d = db(org.id);
  const t = d.prepare("select id, page, name, columns from ws_tables where id = ?").get(String(id)) as unknown as TRow | undefined;
  if (!t) throw new Error("There is no such table, or it is not one you may see.");
  let page;
  try {
    page = workspace.get(org, t.page, who);
  } catch {
    throw new Error("There is no such table, or it is not one you may see.");
  }
  return { d, t, page, columns: parse<Column[]>(t.columns, []) };
}

const rowsOf = (d: DatabaseSync, tbl: string): TableRow[] =>
  (d.prepare("select id, data, updated_by, updated_at from ws_rows where tbl = ? order by position, updated_at").all(tbl) as unknown as { id: string; data: string; updated_by: string; updated_at: string }[]).map((r) => ({ id: r.id, values: parse<Record<string, Value>>(r.data, {}), updatedBy: r.updated_by, updatedAt: r.updated_at }));

const count = (d: DatabaseSync, sql: string, ...args: string[]) => (d.prepare(sql).get(...args) as { n: number }).n;

function insertRow(d: DatabaseSync, tbl: string, values: Record<string, Value>, by: string): string {
  if (count(d, "select count(*) n from ws_rows where tbl = ?", tbl) >= MAX_ROWS) throw new Error(`A table can hold up to ${MAX_ROWS} rows.`);
  const id = newId();
  const last = (d.prepare("select max(position) p from ws_rows where tbl = ?").get(tbl) as { p: number | null }).p ?? 0;
  d.prepare("insert into ws_rows (id, tbl, position, data, updated_by, updated_at) values (?, ?, ?, ?, ?, ?)").run(id, tbl, last + 1, JSON.stringify(values), by, now());
  return id;
}

function patchRow(d: DatabaseSync, tbl: string, row: string, values: Record<string, Value>, by: string) {
  const r = d.prepare("select data from ws_rows where id = ? and tbl = ?").get(row, tbl) as { data: string } | undefined;
  if (!r) throw new Error("This table has no such row.");
  d.prepare("update ws_rows set data = ?, updated_by = ?, updated_at = ? where id = ?").run(JSON.stringify({ ...parse<Record<string, Value>>(r.data, {}), ...values }), by, now(), row);
}

/** Text as CSV fields: commas, quotes and line breaks inside a value are kept. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) (row.push(cell), out.push(row));
  return out.filter((r) => r.some((c) => c.trim()));
}

/** One CSV field. A value that a spreadsheet would run as a formula gets a leading apostrophe. */
const csvField = (v: Value) => {
  let t = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** What a column of text most likely holds, for a CSV being imported. */
function guessType(values: string[]): ColumnType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return "text";
  if (filled.every((v) => Number.isFinite(Number(v.replace(/[$€£,\s]/g, ""))) && /\d/.test(v))) return "number";
  if (filled.every((v) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v))) return "date";
  return "text";
}

export const tables = {
  /** The tables on a page, for whoever may see it. */
  onPage(org: Org, page: string, who: Who = OWNER): TableInfo[] {
    workspace.get(org, page, who);
    const d = db(org.id);
    return (d.prepare("select id, page, name, columns from ws_tables where page = ? order by position, created_at").all(page) as unknown as TRow[]).map((t) => ({
      id: t.id,
      page: t.page,
      name: t.name,
      columns: parse<Column[]>(t.columns, []),
      rows: count(d, "select count(*) n from ws_rows where tbl = ?", t.id),
      waiting: count(d, "select count(*) n from ws_row_changes where tbl = ? and status = 'open'", t.id),
    }));
  },

  /** Every table `who` may see, across the workspace. */
  all(org: Org, who: Who = OWNER): (TableInfo & { pageTitle: string })[] {
    return workspace.tree(org, who).flatMap((p) => this.onPage(org, p.id, who).map((t) => ({ ...t, pageTitle: p.title })));
  },

  /** One table with its rows and, for the owner, the changes waiting. */
  get(org: Org, id: string, who: Who = OWNER): Table {
    const { d, t, page, columns } = open(org, id, who);
    const changes = (d.prepare("select * from ws_row_changes where tbl = ? and status = 'open' order by created_at").all(t.id) as unknown as { id: string; row: string | null; data: string; note: string; author: string; task: string | null; created_at: string }[]).map((c) => ({
      id: c.id,
      row: c.row,
      values: parse<Record<string, Value>>(c.data, {}),
      note: c.note,
      author: c.author,
      authorName: nameOf(org, c.author),
      task: c.task,
      createdAt: c.created_at,
    }));
    return { id: t.id, page: t.page, name: t.name, columns, rows: rowsOf(d, t.id), changes, waiting: changes.length, agentsChangeDirectly: page.edit === "direct" && !page.protected };
  },

  /** A new table on a page. Only the owner makes tables and changes their columns. */
  create(org: Org, page: string, input: { name?: unknown; columns?: unknown }): Table {
    workspace.get(org, page, OWNER);
    const d = db(org.id);
    const name = clean(input.name) || "Table";
    const columns = columnsFrom(input.columns ?? [{ name: "Name", type: "text" }]);
    const id = newId();
    const last = (d.prepare("select max(position) p from ws_tables where page = ?").get(page) as { p: number | null }).p ?? 0;
    d.prepare("insert into ws_tables (id, page, name, columns, position, created_at) values (?, ?, ?, ?, ?, ?)").run(id, page, name, JSON.stringify(columns), last + 1, now());
    return this.get(org, id);
  },

  /** Renames a table or changes its columns. A column's values are kept when its type still fits, and emptied when not. */
  update(org: Org, id: string, patch: { name?: unknown; columns?: unknown }): Table {
    const { d, t, columns: before } = open(org, id, OWNER);
    if (patch.name !== undefined) d.prepare("update ws_tables set name = ? where id = ?").run(clean(patch.name) || t.name, t.id);
    if (patch.columns !== undefined) {
      const columns = columnsFrom(patch.columns);
      const was = new Map(before.map((c) => [c.id, c]));
      const set = d.prepare("update ws_rows set data = ? where id = ?");
      for (const r of rowsOf(d, t.id)) {
        const values: Record<string, Value> = {};
        for (const c of columns) {
          const old = r.values[c.id];
          if (old == null) continue;
          const prior = was.get(c.id);
          try {
            values[c.id] = prior && prior.type === c.type && c.type !== "choice" ? old : fit(org, c, old);
          } catch {
            values[c.id] = null;
          }
        }
        set.run(JSON.stringify(values), r.id);
      }
      d.prepare("update ws_tables set columns = ? where id = ?").run(JSON.stringify(columns), t.id);
    }
    return this.get(org, id);
  },

  /** Removes a table and its rows for good. */
  remove(org: Org, id: string): { removed: true } {
    const { d, t } = open(org, id, OWNER);
    d.prepare("delete from ws_rows where tbl = ?").run(t.id);
    d.prepare("delete from ws_row_changes where tbl = ?").run(t.id);
    d.prepare("delete from ws_tables where id = ?").run(t.id);
    audit({ actor: "owner", actorName: "You", kind: "workspace", action: `Deleted the table “${t.name}”` });
    return { removed: true };
  },

  /**
   * Adds a row (no `row`) or changes one. The owner's change is applied. An agent's is applied only when the page takes
   * agents' edits directly; otherwise it waits for the owner.
   */
  setRow(org: Org, who: Who, id: string, input: { row?: unknown; values?: unknown; note?: unknown; task?: string | null }): { applied: boolean; row?: string; change?: string; table: string } {
    const { d, t, page, columns } = open(org, id, who);
    const values = valuesFrom(org, columns, input.values ?? (who === OWNER ? {} : undefined));
    if (!Object.keys(values).length && !(who === OWNER && !input.row)) throw new Error("Give at least one value.");
    const row = input.row ? String(input.row) : null;
    if (row && !d.prepare("select 1 from ws_rows where id = ? and tbl = ?").get(row, t.id)) throw new Error("This table has no such row. Read the table to see its rows and their ids.");
    const author = authorOf(who)!;
    const may = workspace.level(org, t.page, who);
    if (who !== OWNER && (may === "read" || may === "comment")) throw new Error(`You may read the table “${t.name}” but not change it. If it needs changing, say so in your report.`);
    if (who === OWNER || may === "edit") {
      const made = row ? (patchRow(d, t.id, row, values, author), row) : insertRow(d, t.id, values, author);
      if (who !== OWNER) {
        workspace.used(org, input.task, t.page, "changed");
        audit({ actor: author, actorName: nameOf(org, author), kind: "workspace", task: input.task ?? undefined, action: `${row ? "Changed a row in" : "Added a row to"} the table “${t.name}”`, detail: clean(input.note, 300) });
      }
      return { applied: true, row: made, table: t.name };
    }
    if (count(d, "select count(*) n from ws_row_changes where tbl = ? and status = 'open'", t.id) >= 200) throw new Error("This table already has 200 changes waiting for the owner. Say so in your report rather than adding more.");
    const change = newId();
    d.prepare("insert into ws_row_changes (id, tbl, row, data, note, author, task, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(change, t.id, row, JSON.stringify(values), clean(input.note, 300), author, input.task ?? null, now());
    workspace.used(org, input.task, t.page, "suggested");
    audit({ actor: author, actorName: nameOf(org, author), kind: "workspace", task: input.task ?? undefined, action: `Asked to ${row ? "change a row in" : "add a row to"} the table “${t.name}”`, detail: clean(input.note, 300) });
    return { applied: false, change, table: t.name };
  },

  /** Deletes a row. Only the owner. */
  deleteRow(org: Org, id: string, row: string): { removed: boolean } {
    const { d, t } = open(org, id, OWNER);
    return { removed: Number(d.prepare("delete from ws_rows where id = ? and tbl = ?").run(String(row), t.id).changes) > 0 };
  },

  /** The owner's answer to a change an agent asked for. */
  decide(org: Org, id: string, change: string, decision: unknown): Table {
    const { d, t } = open(org, id, OWNER);
    const c = d.prepare("select * from ws_row_changes where id = ? and tbl = ? and status = 'open'").get(String(change), t.id) as { id: string; row: string | null; data: string; author: string } | undefined;
    if (!c) throw new Error("That change is no longer waiting.");
    const accept = decision === "accept";
    if (accept) {
      const values = parse<Record<string, Value>>(c.data, {});
      if (c.row) {
        if (d.prepare("select 1 from ws_rows where id = ?").get(c.row)) patchRow(d, t.id, c.row, values, c.author);
        else throw new Error("The row this change was for has been deleted. Decline the change.");
      } else insertRow(d, t.id, values, c.author);
    }
    d.prepare("update ws_row_changes set status = ?, decided_at = ? where id = ?").run(accept ? "accepted" : "declined", now(), c.id);
    return this.get(org, id);
  },

  /** Every change agents asked for that is still waiting, across the workspace, in words the owner can read. */
  waiting(org: Org): (RowChange & { table: string; tableName: string; page: string; pageTitle: string; words: string })[] {
    return this.all(org).filter((t) => t.waiting).flatMap((info) => {
      const t = this.get(org, info.id);
      const label = (r: TableRow | undefined) => (r ? String(t.columns.map((c) => r.values[c.id]).find((v) => v != null && v !== "") ?? "a row") : "a row");
      return t.changes.map((c) => ({
        ...c,
        table: t.id,
        tableName: t.name,
        page: t.page,
        pageTitle: info.pageTitle,
        words: `${c.row ? `Change “${label(t.rows.find((r) => r.id === c.row))}”` : "Add a row"}: ${t.columns.filter((col) => col.id in c.values).map((col) => `${col.name} = ${c.values[col.id] ?? "(empty)"}`).join(", ")}`,
      }));
    });
  },

  /** The table as CSV: a line of column names, then one line per row. */
  exportCsv(org: Org, id: string, who: Who = OWNER): { name: string; csv: string } {
    const t = this.get(org, id, who);
    const lines = [t.columns.map((c) => csvField(c.name)).join(","), ...t.rows.map((r) => t.columns.map((c) => csvField(r.values[c.id] ?? null)).join(","))];
    return { name: `${t.name.replace(/[^\w -]+/g, "").trim() || "table"}.csv`, csv: `${lines.join("\r\n")}\r\n` };
  },

  /**
   * Brings a CSV in. With `table`, its rows are added to that table (columns matched by name; a value that does not
   * fit its column stops the import and says which line). Without, a new table is made on the page, with each
   * column's type worked out from its values.
   */
  importCsv(org: Org, input: { page?: unknown; table?: unknown; name?: unknown; csv?: unknown }): { table: Table; added: number } {
    const lines = parseCsv(String(input.csv ?? ""));
    if (lines.length < 1) throw new Error("That file has no rows. A CSV starts with a line of column names.");
    const [head, ...body] = lines;
    if (body.length > MAX_ROWS) throw new Error(`That file has ${body.length} rows. A table can hold up to ${MAX_ROWS}.`);
    let table: Table;
    if (input.table) table = this.get(org, String(input.table));
    else {
      const names = head.map((n, i) => clean(n) || `Column ${i + 1}`).slice(0, MAX_COLUMNS);
      const unique = names.map((n, i) => (names.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i ? n : `${n} ${i + 1}`));
      table = this.create(org, String(input.page ?? ""), { name: input.name, columns: unique.map((n, i) => ({ name: n, type: guessType(body.map((r) => r[i] ?? "")) })) });
    }
    const map = head.map((n, i) => (input.table ? table.columns.find((c) => c.name.toLowerCase() === clean(n).toLowerCase()) : table.columns[i]));
    if (input.table && !map.some(Boolean)) throw new Error(`None of the file's columns (${head.slice(0, 8).join(", ")}) match this table's columns (${table.columns.map((c) => c.name).join(", ")}).`);
    const ready = body.map((cells, n) => {
      const values: Record<string, Value> = {};
      map.forEach((col, i) => {
        if (!col) return;
        try {
          values[col.id] = fit(org, col, cells[i] ?? "");
        } catch (err) {
          throw new Error(`Line ${n + 2}: ${(err as Error).message} Nothing was imported.`);
        }
      });
      return values;
    });
    const d = db(org.id);
    if (table.rows.length + ready.length > MAX_ROWS) throw new Error(`That would make ${table.rows.length + ready.length} rows. A table can hold up to ${MAX_ROWS}.`);
    d.exec("begin");
    try {
      for (const values of ready) insertRow(d, table.id, values, "owner");
      d.exec("commit");
    } catch (err) {
      d.exec("rollback");
      throw err;
    }
    return { table: this.get(org, table.id), added: ready.length };
  },

  /** Rows whose values contain every word of `query`, for agents. */
  find(org: Org, who: Who, id: string, query = "", limit = 50, part = 1): { table: Table; rows: TableRow[]; total: number; parts: number } {
    const table = this.get(org, id, who);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? table.rows.filter((r) => ((text) => words.every((w) => text.includes(w)))(Object.values(r.values).join(" ").toLowerCase())) : table.rows;
    const parts = Math.max(1, Math.ceil(hits.length / limit));
    const at = Math.min(Math.max(1, Math.floor(part) || 1), parts);
    return { table, rows: hits.slice((at - 1) * limit, at * limit), total: hits.length, parts };
  },
};

/** The tool agents use for tables. `who` says which agent is calling. */
export function tableTool(who: (conversationId: string) => string | null): Tool {
  return defineTool<{ action: "list" | "read" | "add" | "update"; table?: string; query?: string; part?: number; row?: string; values?: Record<string, unknown>; note?: string }>({
    name: "table",
    description:
      "Tables in the organization's workspace: customer lists, inventories and trackers, with typed columns. " +
      "\"list\" shows the tables you may read, with their columns. \"read\" returns a table's rows (give a few words in query to find matching rows). " +
      "\"add\" adds a row and \"update\" changes one: give values as column name and value pairs, and a one-line note on why. " +
      "A change is applied straight away only if the table's page takes agents' edits directly; otherwise it waits for the owner, and you say so in your report. Read a table before changing it.",
    properties: {
      action: { type: "string", enum: ["list", "read", "add", "update"] },
      table: { type: "string", description: "For read, add and update: the table's id, as given by list." },
      query: { type: "string", description: "For read: only rows that contain these words." },
      part: { type: "number", description: "For read: which part of a long table (1 is the start)." },
      row: { type: "string", description: "For update: the row's id, as given by read." },
      values: { type: "object", description: "For add and update: column name and value pairs. Dates are written like 2026-03-31." },
      note: { type: "string", description: "For add and update: one line on what you changed and why, for the owner." },
    },
    required: ["action"],
    async run(input, { conversation }) {
      const org = orgs.active();
      const agent = who(conversation.id) ?? GENERAL_AGENT;
      if (input.action === "list") {
        const all = tables.all(org, agent);
        if (!all.length) return "The workspace has no tables you may read yet.";
        return all.map((t) => `[${t.id}] ${t.name} (on the page “${t.pageTitle}”, ${t.rows} row${t.rows === 1 ? "" : "s"})\n  Columns: ${t.columns.map((c) => `${c.name} (${c.type}${c.options ? `: ${c.options.join(" | ")}` : ""})`).join(", ")}`).join("\n");
      }
      const id = String(input.table ?? "");
      if (!id) throw new Error("Say which table (its id). List the tables to choose one.");
      if (input.action === "read") {
        const r = tables.find(org, agent, id, String(input.query ?? ""), 50, Number(input.part) || 1);
        workspace.used(org, conversation.id, r.table.page, "read");
        const head = `${r.table.name}: ${r.total} row${r.total === 1 ? "" : "s"}${input.query ? ` matching “${input.query}”` : ""}${r.parts > 1 ? ` · part ${Math.min(Number(input.part) || 1, r.parts)} of ${r.parts}` : ""}\nColumns: ${r.table.columns.map((c) => `${c.name} (${c.type}${c.options ? `: ${c.options.join(" | ")}` : ""})`).join(", ")}`;
        if (!r.rows.length) return `${head}\n\n(No rows.)`;
        return `${head}\n\n${r.rows.map((row) => `[${row.id}] ${r.table.columns.map((c) => `${c.name}: ${row.values[c.id] ?? ""}`).join(" | ")}`).join("\n")}`;
      }
      const r = tables.setRow(org, agent, id, { row: input.action === "update" ? input.row || "missing" : undefined, values: input.values, note: input.note, task: conversation.id });
      const what = input.action === "update" ? "The change to the row" : "The new row";
      return r.applied ? `${what} is saved in “${r.table}”${r.row ? ` (row ${r.row})` : ""}. Say so in your report.` : `${what} in “${r.table}” waits for the owner to accept it; the table stays as it was until then. Say so in your report.`;
    },
  });
}
