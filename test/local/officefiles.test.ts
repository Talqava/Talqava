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

test("slides go out as a PowerPoint file and come back: titles, bullets with their indent, bold, tables as lines, and notes", () => {
  const slides = [
    { title: "Winter menu", body: "- Three new **rye** loaves\n  - Seeded\n- Prices *unchanged*\n\nOrders open Monday.", notes: "Welcome everyone.\nMention the tasting." },
    { title: "Sales & <costs>", body: "| Month | Sales |\n| --- | --- |\n| Oct | 4,200 |", notes: "" },
  ];
  const file = F.toPptx("Bakery update", slides);
  const names = [...unzip(file).keys()];
  for (const part of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide2.xml", "ppt/notesSlides/notesSlide1.xml"]) assert.ok(names.includes(part), part);
  const back = F.fromPptx(file);
  assert.equal(back.title, "Bakery update");
  assert.deepEqual(back.slides[0], { title: "Winter menu", body: "- Three new **rye** loaves\n  - Seeded\n- Prices *unchanged*\nOrders open Monday.", notes: "Welcome everyone.\nMention the tasting." });
  assert.deepEqual(back.slides[1], { title: "Sales & <costs>", body: "Month   ·   Sales\nOct   ·   4,200".replace(/ {3}/g, " "), notes: "" });
  assert.throws(() => F.fromPptx(F.zip([{ name: "word/document.xml", data: "<w:document/>" }])), /does not look like a PowerPoint file/);

  // A file as PowerPoint itself writes it: slides in the order the presentation lists them, a real table, a subtitle,
  // a slide number to ignore, and notes beside the slide picture.
  const sp = (ph: string, paras: string) => `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paras}</p:txBody></p:sp>`;
  const theirs = F.zip([
    { name: "ppt/presentation.xml", data: '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>' },
    { name: "ppt/_rels/presentation.xml.rels", data: '<Relationships><Relationship Id="rId2" Type="http://x/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://x/slide" Target="slides/slide2.xml"/></Relationships>' },
    { name: "ppt/slides/slide1.xml", data: `<p:sld>${sp('<p:ph type="ctrTitle"/>', "<a:p><a:r><a:t>Second </a:t></a:r><a:r><a:t>in file</a:t></a:r></a:p>")}${sp('<p:ph type="subTitle" idx="1"/>', "<a:p><a:r><a:t>A subtitle</a:t></a:r></a:p>")}${sp('<p:ph type="sldNum"/>', "<a:p><a:r><a:t>2</a:t></a:r></a:p>")}</p:sld>` },
    { name: "ppt/slides/slide2.xml", data: `<p:sld>${sp('<p:ph type="title"/>', "<a:p><a:r><a:t>First shown</a:t></a:r></a:p>")}${sp('<p:ph idx="1"/>', '<a:p><a:r><a:rPr b="1"/><a:t>Bold point</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Under it</a:t></a:r></a:p>')}<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame></p:sld>` },
    { name: "ppt/slides/_rels/slide2.xml.rels", data: '<Relationships><Relationship Id="rId1" Type="http://x/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>' },
    { name: "ppt/notesSlides/notesSlide7.xml", data: `<p:notes>${sp('<p:ph type="sldImg"/>', "")}${sp('<p:ph type="body" idx="1"/>', "<a:p><a:r><a:t>Say hello.</a:t></a:r></a:p>")}${sp('<p:ph type="sldNum"/>', "<a:p><a:r><a:t>1</a:t></a:r></a:p>")}</p:notes>` },
  ]);
  const read = F.fromPptx(theirs).slides;
  assert.deepEqual(read[0], { title: "First shown", body: "- **Bold point**\n  - Under it\n\n| A | B |\n| --- | --- |\n| 1 | 2 |", notes: "Say hello." });
  assert.deepEqual(read[1], { title: "Second in file", body: "A subtitle", notes: "" });
});
