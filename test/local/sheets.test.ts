// Office sheets: the formula engine, and the rules for agents changing cells.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compute, diffFiles, parseFile, parseRange, parseRef, show, writeFile } from "../../public/sheet-engine.js";

let org: any;
let workspace: typeof import("../../src/local/workspace.ts").workspace;
let sheets: typeof import("../../src/local/sheets.ts").sheets;

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-sheets-"));
  const { orgs } = await import("../../src/local/orgs.ts");
  ({ workspace } = await import("../../src/local/workspace.ts"));
  ({ sheets } = await import("../../src/local/sheets.ts"));
  org = { ...orgs.active(), members: [{ bot: "bookkeeper", title: "Bookkeeper", department: "Finance", manager: null }, { bot: "sales-lead", title: "Head of Sales", department: "Sales", manager: null }], groups: [{ name: "Finance", lead: "bookkeeper" }, { name: "Sales", lead: "sales-lead" }] };
});

const sample = `!sheet Forecast
!lock A1:F1
!fmt B2:B8 money
!chart bar A2:B4 Costs by line
A1\tLine
B2\t42,300
B3\t18400
B4\t4200
B5\t$3,150
B6\t31400
B8\t=B2+B6-SUM(B3:B5)
C1\t=B8/0
C2\t=IF(B8>40000,"ok","low")
C3\t=SUMIF(B3:B5,">4000")
C4\t=C4+1
C5\t=Rates!A1*200
C6\t=ROUND(10/3,2)
C7\t=NOPE(1)
C8\t=IFERROR(C1,"n/a")
C9\t=COUNTIF(B2:B6,">10000")&" big"
C10\t=Gone!A1
C11\t=(1+2
C12\t="a"*2
C13\t=AVERAGE(B3:B5)
C14\t=AND(B3>B4,NOT(B4>B3))
D1\t=D2
D2\t=D1
!sheet Rates
A1\t12%
`;

test("the sheet engine works out formulas, and says plainly when one cannot be worked out", () => {
  const file = parseFile(sample);
  const value = compute(file);
  const at = (ref: string, sheet = 0) => ((p) => show(value(sheet, p.col, p.row)))(parseRef(ref)!);
  assert.equal(at("B8"), "47950");
  assert.equal(show(value(0, 1, 7), "money"), "47,950.00");
  assert.deepEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "D1"].map((r) => at(r)), ["#DIV/0!", "ok", "22600", "#CYCLE!", "24", "3.33", "#NAME?", "n/a", "3 big", "#REF!", "#ERROR!", "#VALUE!", "8583.333333", "TRUE", "#CYCLE!"]);
  assert.equal(at("A1", 1), "0.12");
  assert.equal(show(0.12, "percent"), "12%");
  assert.equal(at("Z99"), "");

  // The text is written the same way every time, so two versions compare line by line.
  const text = writeFile(file);
  assert.equal(writeFile(parseFile(text)), text);
  assert.match(text, /^!sheet Forecast\n!lock A1:F1\n!fmt B2:B8 money\n!chart bar A2:B4 Costs by line\nA1\tLine\nC1\t=B8\/0\nD1\t=D2\nB2\t42,300\n/);
  assert.deepEqual(parseRange("B3:A1"), { c1: 0, r1: 0, c2: 1, r2: 2 });
  assert.equal(parseRef("AZ1000")!.col, 51);
  assert.equal(parseRef("BA1"), null);
  assert.equal(parseRef("A1001"), null);
  // A value with a tab or a line break survives.
  const odd = parseFile(writeFile({ sheets: [{ name: "S", cells: { A1: "two\nlines", B1: "back\\slash" }, locks: [], formats: [], charts: [] }] }));
  assert.deepEqual(odd.sheets[0].cells, { A1: "two\nlines", B1: "back\\slash" });

  // What changed between two versions, cell by cell.
  const after = parseFile(text);
  after.sheets[0].cells.B3 = "19150";
  delete after.sheets[0].cells.B5;
  after.sheets[1].cells.A2 = "5%";
  assert.deepEqual(diffFiles(file, after), [{ sheet: "Forecast", ref: "B3", from: "18400", to: "19150" }, { sheet: "Forecast", ref: "B5", from: "$3,150", to: "" }, { sheet: "Rates", ref: "A2", from: "", to: "5%" }]);
});

test("an agent reads results and changes cells under the file's rules; locked cells are never changed", async () => {
  const page = workspace.create(org, null, { kind: "sheet", title: "Cash forecast", folder: "Finance", markdown: sample });
  assert.equal(page.kind, "sheet");
  assert.match(page.summary, /Forecast, Rates · 2\d cells filled/);
  workspace.update(org, page.id, { access: { departments: ["Finance"] } });

  // Only who may see the file may read it; a document is not a sheet.
  const read = sheets.read(org, "bookkeeper", page.id);
  assert.match(read.text, /A1: Line \[locked\]/);
  assert.match(read.text, /B8: 47,950\.00 \(=B2\+B6-SUM\(B3:B5\)\)/);
  assert.deepEqual(read.sheets, ["Forecast", "Rates"]);
  assert.equal(sheets.read(org, "bookkeeper", page.id, "rates").text, "A1: 0.12");
  assert.throws(() => sheets.read(org, "sales-lead", page.id), /no such sheet, or it is not one you may see/);
  assert.throws(() => sheets.read(org, "bookkeeper", page.id, "Nope"), /no sheet called “Nope”. Its sheets are: Forecast, Rates/);
  const doc = workspace.create(org, null, { kind: "doc", title: "A letter" });
  assert.throws(() => sheets.read(org, null, doc.id), /no such sheet/);

  // What is refused, with nothing changed.
  const set = (cells: unknown, extra = {}) => sheets.set(org, "bookkeeper", page.id, { cells, note: "why", ...extra });
  assert.throws(() => set([{ cell: "A1", value: "Item" }]), /A1 is locked/);
  assert.throws(() => set([{ cell: "B3", value: "19150" }, { cell: "F1", value: "x" }]), /F1 is locked/);
  assert.throws(() => set([{ cell: "ZZ1", value: "1" }]), /“ZZ1” is not a cell/);
  assert.throws(() => set([{ cell: "B9", value: "=B8/0" }]), /B9 would show #DIV\/0!.*nothing was changed/);
  assert.throws(() => set([{ cell: "B3", value: "18400" }]), /already hold those values/);
  assert.throws(() => set([]), /Give the cells to change/);
  assert.throws(() => sheets.set(org, null, page.id, { cells: [{ cell: "B3", value: "1" }] }), /owner edits the sheet directly/);
  assert.equal(workspace.get(org, page.id).markdown, page.markdown);

  // The file asks first: the change waits and the sheet is as it was.
  const asked = set([{ cell: "b3", value: "19150" }, { cell: "B7", value: "=B3*10%" }, { cell: "B5", value: "" }]);
  assert.deepEqual(asked, { applied: false, title: "Cash forecast", changed: 3 });
  assert.equal(workspace.get(org, page.id).markdown, page.markdown);
  const waiting = workspace.suggestions(org, page.id);
  assert.equal(waiting.length, 1);
  assert.deepEqual(diffFiles(parseFile(page.markdown), parseFile(waiting[0].markdown)).map((c) => `${c.ref}: ${c.from} → ${c.to}`), ["B3: 18400 → 19150", "B5: $3,150 → ", "B7:  → =B3*10%"]);
  workspace.decide(org, waiting[0].id, "accept");
  assert.match(sheets.read(org, "bookkeeper", page.id).text, /B7: 1,915\.00 \(=B3\*10%\)/);

  // Direct edits apply at once; a protected file always waits.
  workspace.update(org, page.id, { edit: "direct" });
  assert.equal(set([{ cell: "B4", value: "4300" }]).applied, true);
  assert.match(workspace.get(org, page.id).markdown, /\nB4\t4300\n/);
  workspace.update(org, page.id, { protected: true });
  assert.equal(set([{ cell: "B4", value: "4400" }]).applied, false);

  // The general workspace tool does not read or rewrite a sheet's text, which would get around locked cells.
  const { workspaceTool } = await import("../../src/local/workspace.ts");
  const { orgs } = await import("../../src/local/orgs.ts");
  const live = orgs.active();
  const mine = sheets.create(live, null, { title: "Live sheet" });
  const tool = workspaceTool(() => null);
  const run = async (input: any) => String(await tool.run(input, { conversation: { id: "task-1" }, signal: new AbortController().signal } as never));
  await assert.rejects(run({ action: "suggest", page: mine.id, markdown: "!sheet X\nA1\thack", note: "x" }), /That is a sheet/);
  await assert.rejects(run({ action: "read", page: mine.id }), /That is a sheet/);
});

test("a sheet comes in from a CSV file and goes out with its results; the sheet tool lists, reads, sets and creates", async () => {
  const { orgs } = await import("../../src/local/orgs.ts");
  const { sheetTool } = await import("../../src/local/sheets.ts");
  const live = orgs.active();
  const made = sheets.create(live, null, { title: "Prices", folder: "Sales", csv: 'Item,Price\n"Widget, large",12.50\nSneaky,=1+1\n' });
  const file = parseFile(made.markdown);
  assert.deepEqual(file.sheets[0].cells, { A1: "Item", B1: "Price", A2: "Widget, large", B2: "12.50", A3: "Sneaky", B3: "'=1+1" });
  assert.throws(() => sheets.create(live, null, { title: "Empty", csv: "\n\n" }), /no rows/);

  workspace.update(live, made.id, { edit: "direct", access: { everyone: true } });
  const tool = sheetTool(() => null);
  const run = async (input: any) => String(await tool.run(input, { conversation: { id: "task-2" }, signal: new AbortController().signal } as never));
  assert.match(await run({ action: "list" }), new RegExp(`\\[${made.id}\\] Prices \\(in Sales\\): Sheet 1 · 6 cells filled`));
  assert.match(await run({ action: "read", file: made.id }), /^Prices › Sheet 1\n\nA1: Item \| B1: Price\nA2: Widget, large \| B2: 12\.5\n/);
  assert.match(await run({ action: "set", file: made.id, cells: [{ cell: "B4", value: "=SUM(B2:B3)" }, { cell: "A4", value: "Total" }], note: "Added a total" }), /Changed 2 cells in “Prices”/);
  await assert.rejects(run({ action: "set", cells: [{ cell: "A1", value: "x" }] }), /Say which sheet file/);
  assert.match(await run({ action: "create", title: "Budget", folder: "Finance" }), /Started the sheet “Budget” \(file \w+\)/);
  assert.equal(workspace.office(live).files.filter((f) => f.kind === "sheet").length >= 2, true);

  const out = sheets.csv(live, made.id);
  assert.equal(out.name, "Prices.csv");
  assert.equal(out.csv, 'Item,Price\r\n"Widget, large",12.5\r\nSneaky,\'=1+1\r\nTotal,12.5\r\n');
});
