// Simple databases in the workspace: typed columns, the page's access rules, changes that wait for the owner, CSV.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let org: any;
let tables: typeof import("../../src/local/tables.ts").tables;
let workspace: typeof import("../../src/local/workspace.ts").workspace;
let sales = "";
let finance = "";

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-tables-"));
  const { orgs } = await import("../../src/local/orgs.ts");
  ({ tables } = await import("../../src/local/tables.ts"));
  ({ workspace } = await import("../../src/local/workspace.ts"));
  org = orgs.active();
  // Two positions in two groups, so access can differ between them.
  org = { ...org, members: [{ bot: "sales-lead", title: "Head of Sales", department: "Sales", manager: null }, { bot: "bookkeeper", title: "Bookkeeper", department: "Finance", manager: null }], groups: [{ name: "Sales", lead: "sales-lead" }, { name: "Finance", lead: "bookkeeper" }] };
  sales = "sales-lead";
  finance = "bookkeeper";
});

test("a table has typed columns, and each value must fit its column", () => {
  const page = workspace.create(org, null, { title: "Customers" });
  const t = tables.create(org, page.id, { name: "Customer list", columns: [{ name: "Name", type: "text" }, { name: "Spend", type: "number" }, { name: "Since", type: "date" }, { name: "Stage", type: "choice", options: "Lead, Customer, Lost" }, { name: "Owner", type: "person" }] });
  assert.deepEqual(t.columns.map((c) => c.type), ["text", "number", "date", "choice", "person"]);
  assert.deepEqual(t.columns[3].options, ["Lead", "Customer", "Lost"]);

  const r = tables.setRow(org, null, t.id, { values: { Name: "Acme", Spend: "$1,250.50", Since: "3/31/2026", Stage: "customer", Owner: "head of sales" } });
  assert.equal(r.applied, true);
  const row = tables.get(org, t.id).rows[0];
  const by = (name: string) => row.values[t.columns.find((c) => c.name === name)!.id];
  assert.deepEqual([by("Name"), by("Spend"), by("Since"), by("Stage"), by("Owner")], ["Acme", 1250.5, "2026-03-31", "Customer", "Head of Sales"]);

  assert.throws(() => tables.setRow(org, null, t.id, { values: { Spend: "lots" } }), /takes a number/);
  assert.throws(() => tables.setRow(org, null, t.id, { values: { Since: "2026-02-31" } }), /takes a date/);
  assert.throws(() => tables.setRow(org, null, t.id, { values: { Stage: "Maybe" } }), /one of: Lead, Customer, Lost/);
  assert.throws(() => tables.setRow(org, null, t.id, { values: { Owner: "Nobody" } }), /person on your chart/);
  assert.throws(() => tables.setRow(org, null, t.id, { values: { Colour: "red" } }), /no column called “Colour”/);
  assert.throws(() => tables.create(org, page.id, { columns: [{ name: "A" }, { name: "a" }] }), /Two columns/);
  assert.throws(() => tables.create(org, page.id, { columns: [{ name: "Stage", type: "choice" }] }), /Give the choices/);

  // Changing a column's type keeps what still fits and empties what does not; a removed column's values go.
  tables.setRow(org, null, t.id, { row: row.id, values: { Name: "42" } });
  const changed = tables.update(org, t.id, { name: "Customers", columns: [{ ...t.columns[0], type: "number" }, { ...t.columns[3], options: ["Lead", "Lost"] }] });
  assert.equal(changed.name, "Customers");
  assert.deepEqual(changed.rows[0].values, { [t.columns[0].id]: 42, [t.columns[3].id]: null });
});

test("agents read and change rows under the page's rules: a change waits for the owner unless the page takes edits directly", () => {
  const page = workspace.create(org, null, { title: "Stock" });
  workspace.update(org, page.id, { access: { departments: ["Sales"] } });
  const t = tables.create(org, page.id, { name: "Stock", columns: [{ name: "Item", type: "text" }, { name: "Count", type: "number" }] });
  const first = tables.setRow(org, null, t.id, { values: { Item: "Widget", Count: 5 } }).row!;

  // Only who may see the page may see its table, and the error does not say which.
  assert.equal(tables.all(org, sales).length >= 1, true);
  assert.equal(tables.all(org, finance).some((x) => x.id === t.id), false);
  assert.throws(() => tables.get(org, t.id, finance), /no such table, or it is not one you may see/);
  assert.throws(() => tables.setRow(org, finance, t.id, { values: { Item: "Sneaky" } }), /no such table/);

  // The page asks first: the agent's changes wait, and the table is unchanged.
  const asked = tables.setRow(org, sales, t.id, { row: first, values: { Count: 3 }, note: "Two sold today", task: "task-1" });
  const added = tables.setRow(org, sales, t.id, { values: { Item: "Gadget", Count: 9 } });
  assert.equal(asked.applied, false);
  assert.equal(added.applied, false);
  assert.throws(() => tables.setRow(org, sales, t.id, { values: {} }), /at least one value/);
  let now = tables.get(org, t.id);
  assert.equal(now.rows.length, 1);
  assert.equal(now.rows[0].values[t.columns[1].id], 5);
  assert.equal(now.changes.length, 2);
  const waiting = tables.waiting(org);
  assert.equal(waiting.length, 2);
  assert.match(waiting[0].words, /Change “Widget”: Count = 3/);
  assert.equal(waiting[0].authorName, "Head of Sales");
  assert.match(waiting[1].words, /Add a row: Item = Gadget, Count = 9/);

  // The owner accepts one and declines the other.
  tables.decide(org, t.id, asked.change!, "accept");
  now = tables.decide(org, t.id, added.change!, "decline");
  assert.equal(now.rows.length, 1);
  assert.equal(now.rows[0].values[t.columns[1].id], 3);
  assert.equal(now.rows[0].updatedBy, sales);
  assert.equal(now.changes.length, 0);
  assert.throws(() => tables.decide(org, t.id, asked.change!, "accept"), /no longer waiting/);

  // A page that takes agents' edits directly applies them; a protected page never does.
  workspace.update(org, page.id, { edit: "direct" });
  assert.equal(tables.get(org, t.id).agentsChangeDirectly, true);
  assert.equal(tables.setRow(org, sales, t.id, { values: { Item: "Gadget", Count: 9 } }).applied, true);
  assert.equal(tables.get(org, t.id).rows.length, 2);
  workspace.update(org, page.id, { protected: true });
  assert.equal(tables.setRow(org, sales, t.id, { values: { Item: "Gizmo" } }).applied, false);

  // Agents find rows by words; only the owner deletes.
  assert.deepEqual(tables.find(org, sales, t.id, "gadget").rows.map((r) => r.values[t.columns[0].id]), ["Gadget"]);
  assert.equal(tables.deleteRow(org, t.id, first).removed, true);
  assert.deepEqual(tables.remove(org, t.id), { removed: true });
  assert.throws(() => tables.get(org, t.id), /no such table/);
});

test("the table tool lets an agent list, read, add and update", async () => {
  const { tableTool } = await import("../../src/local/tables.ts");
  const { orgs } = await import("../../src/local/orgs.ts");
  const live = orgs.active();
  const page = workspace.create(live, null, { title: "Tracker" });
  workspace.update(live, page.id, { edit: "direct" });
  const t = tables.create(live, page.id, { name: "Follow-ups", columns: [{ name: "Who", type: "text" }, { name: "Due", type: "date" }] });
  const tool = tableTool(() => null);
  const run = async (input: any) => tool.run(input, { conversation: { id: "task-9" }, signal: new AbortController().signal } as never);
  assert.match(String(await run({ action: "list" })), new RegExp(`\\[${t.id}\\] Follow-ups \\(on the page “Tracker”, 0 rows\\)\\n  Columns: Who \\(text\\), Due \\(date\\)`));
  assert.match(String(await run({ action: "add", table: t.id, values: { Who: "Acme", Due: "2026-12-01" }, note: "Promised a call" })), /The new row is saved in “Follow-ups”/);
  const read = String(await run({ action: "read", table: t.id, query: "acme" }));
  assert.match(read, /Follow-ups: 1 row matching “acme”/);
  const rowId = /\[([^\]]+)\] Who: Acme \| Due: 2026-12-01/.exec(read)![1];
  assert.match(String(await run({ action: "update", table: t.id, row: rowId, values: { Due: "2026-12-05" } })), /The change to the row is saved/);
  await assert.rejects(run({ action: "update", table: t.id, values: { Due: "2026-12-05" } }), /no such row/);
  await assert.rejects(run({ action: "add", table: t.id, values: { Due: "soon" } }), /takes a date/);
  assert.equal(tables.get(live, t.id).rows[0].values[t.columns[1].id], "2026-12-05");
});

test("a table comes in and goes out as CSV", () => {
  const page = workspace.create(org, null, { title: "Imports" });
  const csv = 'Name,Balance,Joined,Notes\r\n"Smith, Jane",1200,2026-01-15,"Said ""call me"""\nLee,,2/3/2026,=SUM(A1)\n\n';
  const made = tables.importCsv(org, { page: page.id, name: "Members", csv });
  assert.equal(made.added, 2);
  assert.deepEqual(made.table.columns.map((c) => [c.name, c.type]), [["Name", "text"], ["Balance", "number"], ["Joined", "date"], ["Notes", "text"]]);
  const ids = made.table.columns.map((c) => c.id);
  assert.deepEqual(ids.map((i) => made.table.rows[0].values[i]), ["Smith, Jane", 1200, "2026-01-15", 'Said "call me"']);
  assert.deepEqual(ids.map((i) => made.table.rows[1].values[i]), ["Lee", null, "2026-02-03", "=SUM(A1)"]);

  // Out again: quotes and commas survive, and a value a spreadsheet would run as a formula is made plain text.
  const out = tables.exportCsv(org, made.table.id);
  assert.equal(out.name, "Members.csv");
  assert.equal(out.csv, 'Name,Balance,Joined,Notes\r\n"Smith, Jane",1200,2026-01-15,"Said ""call me"""\r\nLee,,2026-02-03,\'=SUM(A1)\r\n');

  // Into an existing table: columns match by name, extra columns are ignored, and a bad value imports nothing.
  assert.equal(tables.importCsv(org, { table: made.table.id, csv: "balance,name,Shoe size\n7,Ng,44\n" }).added, 1);
  assert.throws(() => tables.importCsv(org, { table: made.table.id, csv: "Name,Balance\nOk,1\nBad,lots\n" }), /Line 3: “Balance” takes a number.*Nothing was imported/);
  assert.throws(() => tables.importCsv(org, { table: made.table.id, csv: "Colour\nred\n" }), /None of the file's columns/);
  assert.equal(tables.get(org, made.table.id).rows.length, 3);
});
