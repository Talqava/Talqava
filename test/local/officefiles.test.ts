// Word and Excel files, written and read without an outside library.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-files-"));
const F = await import("../../src/local/officefiles.ts");
const { unzip } = await import("../../src/local/library.ts");

const DOC = `## What you asked for

A monthly service for **two clinics**, starting in *January*.

- One invoice a month
- A single contact
- [ ] Confirm the start date

## Price

| Item | Price |
| --- | --- |
| Cleaning | 400 & up |
| Supplies | "at cost" |

1. Reply to accept
2. We confirm a date
`;

test("a zip written here is read back whole, including names and text that are not plain English", () => {
  const z = F.zip([{ name: "a.txt", data: "hello" }, { name: "dir/ünï.txt", data: "çé".repeat(5000) }, { name: "empty", data: "" }]);
  const files = unzip(z);
  assert.deepEqual([...files.keys()], ["a.txt", "dir/ünï.txt", "empty"]);
  assert.equal(files.get("a.txt")!().toString(), "hello");
  assert.equal(files.get("dir/ünï.txt")!().toString(), "çé".repeat(5000));
});

test("a document goes out as a Word file and comes back with its headings, lists, table and emphasis", () => {
  const docx = F.toDocx("Harbor <Dental> proposal", DOC);
  const back = F.fromDocx(docx);
  assert.equal(back.title, "Harbor <Dental> proposal");
  assert.match(back.markdown, /^## What you asked for$/m);
  assert.match(back.markdown, /A monthly service for \*\*two clinics\*\*, starting in \*January\*\./);
  assert.match(back.markdown, /^- One invoice a month\n- A single contact\n- \[ \] Confirm the start date$/m);
  assert.match(back.markdown, /\| Item \| Price \|\n\| --- \| --- \|\n\| Cleaning \| 400 & up \|\n\| Supplies \| "at cost" \|/);
  assert.match(back.markdown, /Reply to accept/);
  assert.throws(() => F.fromDocx(F.zip([{ name: "x", data: "y" }])), /does not look like a Word file/);
  // The Mac's own converter opens it and finds the words, where it is available.
  if (process.platform === "darwin" && fs.existsSync("/usr/bin/textutil")) {
    const file = path.join(process.env.TALQAVA_DATA_DIR!, "out.docx");
    fs.writeFileSync(file, docx);
    const text = execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", file]).toString();
    assert.match(text, /Harbor <Dental> proposal/);
    assert.match(text, /two clinics/);
    assert.match(text, /Cleaning/);
  }
});

test("a sheet goes out as an Excel file and comes back with its values, formulas and sheet names", () => {
  const text = "!sheet Forecast\n!lock A1:B1\nA1\tLine\nB1\tAmount\nA2\tSales & more\nB2\t1200.5\nA3\tCosts\nB3\t400\nA4\tLeft\nB4\t=B2-B3\nA5\tOk?\nB5\t=IF(B4>0,\"yes\",\"no\")\nA6\tRate\nB6\t=Rates!A1*100\n!sheet Rates\nA1\t12%\nA2\tTRUE\n";
  const xlsx = F.toXlsx(text);
  const files = unzip(xlsx);
  assert.ok(files.has("xl/workbook.xml") && files.has("xl/worksheets/sheet1.xml") && files.has("xl/worksheets/sheet2.xml"));
  const sheet1 = files.get("xl/worksheets/sheet1.xml")!().toString();
  assert.match(sheet1, /<c r="B4"><f>B2-B3<\/f><v>800.5<\/v><\/c>/, "a formula carries its worked-out value");
  assert.match(sheet1, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">Sales &amp; more<\/t>/);
  const back = F.fromXlsx(xlsx);
  assert.match(back, /^!sheet Forecast$/m);
  assert.match(back, /^!sheet Rates$/m);
  for (const line of ["A1\tLine", "A2\tSales & more", "B2\t1200.5", "B4\t=B2-B3", 'B5\t=IF(B4>0,"yes","no")', "B6\t=Rates!A1*100", "A1\t0.12", "A2\tTRUE"]) assert.ok(back.includes(`${line}\n`), line);
  assert.throws(() => F.fromXlsx(F.zip([{ name: "x", data: "y" }])), /does not look like an Excel file/);

  // A file as Excel itself writes it: words kept in a shared list.
  const theirs = F.zip([
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/sharedStrings.xml", data: "<sst><si><t>Name</t></si><si><r><t>Jane </t></r><r><t>Okafor</t></r></si></sst>" },
    { name: "xl/worksheets/sheet1.xml", data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>42</v></c><c r="B2"><f>SUM(A2:A2)</f><v>42</v></c><c r="C2" s="3"/></row></sheetData></worksheet>' },
  ]);
  const read = F.fromXlsx(theirs);
  assert.match(read, /^!sheet Data & more$/m);
  for (const line of ["A1\tName", "B1\tJane Okafor", "A2\t42", "B2\t=SUM(A2:A2)"]) assert.ok(read.includes(`${line}\n`), line);
});
