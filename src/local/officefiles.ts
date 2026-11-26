// Word and Excel files, in and out. A document can be saved as a .docx and a sheet as an .xlsx, and both kinds of
// file can be brought in. These are written and read directly (they are zip files of XML), with no outside library.
// What is kept: text, headings, lists, tables, bold and italic; cell values, formulas and sheet names. What is not:
// fonts, colours, page layout, pictures, charts, merged cells and comments.
import zlib from "node:zlib";
import { unzip } from "./library.ts";
import { compute, extent, isError, parseFile, parseRef, refName, show, writeFile, emptyFile, MAX_COLS, MAX_ROWS } from "../../public/sheet-engine.js";
import type { SheetFile } from "../../public/sheet-engine.js";

// ---------- writing a zip ----------
export function zip(entries: { name: string; data: string | Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0x00210000, 10); // a fixed date, so the same content gives the same file
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const xml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const unxml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

// ---------- a document as a Word file ----------
/** The runs of one line: **bold**, *italic*, `code` and [links](…) become Word formatting; the rest is plain. */
function runs(text: string): string {
  const out: string[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  const run = (t: string, props = "") => t && out.push(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    run(text.slice(last, m.index));
    if (m[2]) run(m[2], "<w:b/>");
    else if (m[3]) run(m[3], "<w:i/>");
    else if (m[4]) run(m[4], '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
    else run(`${m[5]} (${m[6]})`);
    last = m.index + m[0].length;
  }
  run(text.slice(last));
  return out.join("");
}
const para = (text: string, style = "", indent = 0) => `<w:p>${style || indent ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${indent ? `<w:ind w:left="${indent}" w:hanging="360"/>` : ""}</w:pPr>` : ""}${runs(text)}</w:p>`;

/** A document's Markdown as a .docx file. */
export function toDocx(title: string, markdown: string): Buffer {
  const body: string[] = [para(title, "Title")];
  const lines = markdown.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      body.push(para(heading[2], `Heading${Math.min(3, heading[1].length)}`));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
      }
      i--;
      const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders></w:tblPr>${rows.map((r, n) => `<w:tr>${r.map((c) => `<w:tc><w:p>${n === 0 ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(c)}</w:t></w:r>` : runs(c)}</w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`, "<w:p/>");
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      const mark = /\d/.test(item[2]) ? item[2].replace(")", ".") : item[3] ? (/[xX]/.test(item[3]) ? "☑" : "☐") : "•";
      body.push(para(`${mark}\t${item[4]}`, "", 720 + Math.min(4, Math.floor(item[1].length / 2)) * 360));
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) continue;
    body.push(para(line.replace(/^>\s?/, "")));
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const style = (id: string, name: string, size: number, bold: boolean, before: number) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="80"/></w:pPr><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style("Title", "Title", 44, true, 0)}${style("Heading1", "heading 1", 32, true, 320)}${style("Heading2", "heading 2", 26, true, 240)}${style("Heading3", "heading 3", 24, true, 200)}</w:styles>` },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
}

/** A Word file's text as Markdown: headings, lists, tables, bold and italic. Everything else is left behind. */
export function fromDocx(buffer: Buffer): { title: string; markdown: string } {
  const doc = unzip(buffer).get("word/document.xml")?.().toString("utf8");
  if (!doc) throw new Error("That does not look like a Word file (.docx).");
  const textOf = (p: string) =>
    [...p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)]
      .map((r) => {
        const t = [...r[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? unxml(m[1]) : m[0].startsWith("<w:tab") ? " " : "\n")).join("");
        if (!t.trim()) return t;
        const bold = /<w:b(\s[^>]*)?\/>/.test(r[1]) && !/<w:b w:val="(0|false)"/.test(r[1]);
        const italic = /<w:i(\s[^>]*)?\/>/.test(r[1]) && !/<w:i w:val="(0|false)"/.test(r[1]);
        return bold ? `**${t.trim()}**${/\s$/.test(t) ? " " : ""}` : italic ? `*${t.trim()}*${/\s$/.test(t) ? " " : ""}` : t;
      })
      .join("")
      .replace(/\*\*\*\*/g, "");
  const out: string[] = [];
  let title = "";
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  for (const block of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const b = block[0];
    if (b.startsWith("<w:tbl")) {
      const rows = [...b.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => [...c[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((p) => textOf(p[0]).replace(/\*\*/g, "")).join(" ").replace(/\|/g, "/").trim()));
      if (!rows.length) continue;
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      out.push([line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
      continue;
    }
    const text = textOf(b).trim();
    if (!text) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(b)?.[1] ?? "";
    if (/^title$/i.test(style) && !title) {
      title = text.replace(/\*\*/g, "");
      continue;
    }
    const level = /^heading\s?(\d)/i.exec(style)?.[1];
    if (level) out.push(`${"#".repeat(Math.min(6, Number(level)))} ${text.replace(/\*\*/g, "")}`);
    else if (/<w:numPr>/.test(b) || /^[•◦▪·]\s/.test(text)) out.push(`- ${text.replace(/^[•◦▪·]\s*/, "")}`);
    else if (/^[☐☑]\s/.test(text)) out.push(`- [${text.startsWith("☑") ? "x" : " "}] ${text.slice(1).trim()}`);
    else out.push(text);
  }
  // Lines of one list sit together; other blocks get a blank line between them.
  const md = out.reduce((acc, line, i) => acc + (i === 0 ? "" : /^(- |\d+\. )/.test(line) && /^(- |\d+\. )/.test(out[i - 1]) ? "\n" : "\n\n") + line, "");
  return { title, markdown: `${md}\n` };
}

// ---------- a sheet as an Excel file ----------
const safeSheetName = (name: string, taken: Set<string>) => {
  let n = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${n.slice(0, 28)} ${i}`;
  taken.add(n.toLowerCase());
  return n;
};

/** A sheet file as an .xlsx: values, formulas (with their worked-out values) and sheet names. */
export function toXlsx(text: string): Buffer {
  const file = parseFile(text);
  const value = compute(file);
  const taken = new Set<string>();
  const names = file.sheets.map((s) => safeSheetName(s.name, taken));
  const sheetXml = (si: number) => {
    const sheet = file.sheets[si];
    const { rows, cols } = extent(sheet);
    const lines: string[] = [];
    for (let r = 0; r <= rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= cols; c++) {
        const ref = refName(c, r);
        const raw = sheet.cells[ref];
        if (raw == null || raw === "") continue;
        const v = value(si, c, r);
        const formula = raw.startsWith("=") && raw.length > 1 ? `<f>${xml(raw.slice(1))}</f>` : "";
        if (typeof v === "number") cells.push(`<c r="${ref}">${formula}<v>${v}</v></c>`);
        else if (typeof v === "boolean") cells.push(`<c r="${ref}" t="b">${formula}<v>${v ? 1 : 0}</v></c>`);
        else if (isError(v)) cells.push(`<c r="${ref}" t="e">${formula}<v>${xml(show(v))}</v></c>`);
        else if (formula) cells.push(`<c r="${ref}" t="str">${formula}<v>${xml(String(v))}</v></c>`);
        else cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`);
      }
      if (cells.length) lines.push(`<row r="${r + 1}">${cells.join("")}</row>`);
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join("")}</sheetData></worksheet>`;
  };
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
    ...names.map((_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(i) })),
  ]);
}

/** An Excel file as a sheet file's text: each sheet's values and formulas. Formatting, charts and merged cells are left behind. */
export function fromXlsx(buffer: Buffer): string {
  const files = unzip(buffer);
  const read = (name: string) => files.get(name)?.().toString("utf8") ?? "";
  const book = read("xl/workbook.xml");
  if (!book) throw new Error("That does not look like an Excel file (.xlsx).");
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(""));
  const rels = new Map([...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? "", /Target="([^"]+)"/.exec(m[0])?.[1] ?? ""]));
  const file: SheetFile = { sheets: [] };
  for (const s of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(/name="([^"]*)"/.exec(s[0])?.[1] ?? "Sheet");
    const target = rels.get(/r:id="([^"]+)"/.exec(s[0])?.[1] ?? "") ?? "";
    const data = read(`xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`);
    const sheet = { ...emptyFile(name).sheets[0] };
    for (const c of data.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = parseRef(/r="([A-Z]+[0-9]+)"/.exec(c[1])?.[1] ?? "");
      if (!at || at.col >= MAX_COLS || at.row >= MAX_ROWS) continue;
      const inner = c[2] ?? "";
      const type = /t="([^"]+)"/.exec(c[1])?.[1] ?? "n";
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const raw = formula ? `=${unxml(formula)}` : type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join("") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v !== undefined ? unxml(v) : "";
      if (raw !== "") sheet.cells[refName(at.col, at.row)] = raw.slice(0, 2000);
    }
    file.sheets.push(sheet);
    if (file.sheets.length >= 30) break;
  }
  if (!file.sheets.length) throw new Error("That Excel file has no sheets.");
  return writeFile(file);
}

// ---------- slides as a PowerPoint file ----------
// A deck becomes a .pptx with one "Title and Content" slide per slide, speaker notes included, on a plain white
// widescreen master. Kept: titles, bullet points with their indent, paragraphs, bold and italic, tables as lines of
// text, and notes. Not kept: pictures, charts, colours, animations and layouts.
export interface PptSlide {
  title: string;
  body: string;
  notes: string;
}
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (list: [string, string, string][]) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
/** A placeholder shape. `at` gives its place on a master or layout; a slide leaves it out and inherits it. */
const shape = (id: number, name: string, ph: string, text: string, at?: [number, number, number, number]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr>${at ? `<a:xfrm><a:off x="${at[0]}" y="${at[1]}"/><a:ext cx="${at[2]}" cy="${at[3]}"/></a:xfrm>` : ""}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody></p:sp>`;
/** The runs of one line: **bold** and *italic* become formatting, `code` and [links](…) plain words. */
function pptRuns(text: string): string {
  const out: string[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  const run = (t: string, props = "") => t && out.push(`<a:r><a:rPr lang="en-US"${props} dirty="0"/><a:t>${xml(t)}</a:t></a:r>`);
  for (let m; (m = re.exec(text)); last = re.lastIndex) {
    run(text.slice(last, m.index));
    if (m[1] !== undefined) run(m[1], ' b="1"');
    else if (m[2] !== undefined) run(m[2], ' i="1"');
    else run(m[3] ?? m[4]);
  }
  run(text.slice(last));
  return out.join("");
}
/** A slide's Markdown body as PowerPoint paragraphs: bullets keep their indent, other lines stand without a bullet. */
function pptBody(markdown: string): string {
  const paras: string[] = [];
  for (const raw of markdown.split("\n")) {
    if (!raw.trim() || /^\s*\|?\s*:?-{3,}/.test(raw)) continue;
    // A chart that lives in a sheet cannot go into the file as a chart: its place is marked in words.
    const chart = /^\s*!chart\s+\S+\s*(.*)$/.exec(raw);
    if (chart) {
      paras.push(`<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>${pptRuns(`(Chart: ${chart[1].trim() || "from a sheet"})`)}</a:p>`);
      continue;
    }
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (bullet) {
      const level = Math.min(4, Math.floor(bullet[1].replace(/\t/g, "    ").length / 2));
      paras.push(`<a:p>${level ? `<a:pPr lvl="${level}"/>` : ""}${pptRuns(bullet[2].replace(/^\[[ xX]\]\s+/, ""))}</a:p>`);
      continue;
    }
    const line = /^\s*\|.*\|\s*$/.test(raw) ? raw.trim().slice(1, -1).split("|").map((c) => c.trim()).join("   ·   ") : raw.trim().replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "");
    paras.push(`<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>${pptRuns(line)}</a:p>`);
  }
  return paras.join("") || "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>";
}
const THEME = (name: string) =>
  `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements><a:clrScheme name="Talqava"><a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="2E7D5B"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="Talqava"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Talqava"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const LEVELS = (sizes: number[], bullet: boolean) =>
  sizes.map((sz, i) => `<a:lvl${i + 1}pPr marL="${bullet ? 228600 + i * 457200 : 0}" indent="${bullet ? -228600 : 0}" algn="l">${bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : "<a:buNone/>"}<a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl${i + 1}pPr>`).join("");
const TITLE_AT: [number, number, number, number] = [838200, 365125, 10515600, 1325563];
const BODY_AT: [number, number, number, number] = [838200, 1825625, 10515600, 4351338];

/** A deck as a PowerPoint file. */
export function toPptx(title: string, slides: PptSlide[]): Buffer {
  const list = slides.length ? slides : [{ title, body: "", notes: "" }];
  const blank = '<a:p><a:endParaRPr lang="en-US"/></a:p>';
  const P = "application/vnd.openxmlformats-officedocument.presentationml";
  const entries: { name: string; data: string }[] = [
    {
      name: "[Content_Types].xml",
      data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${P}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${P}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${P}.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${P}.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${list.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${P}.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="${P}.notesSlide+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    { name: "_rels/.rels", data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Talqava</dc:creator></cp:coreProperties>` },
    {
      name: "ppt/presentation.xml",
      data: `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${list.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 4}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    { name: "ppt/_rels/presentation.xml.rels", data: rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "notesMaster", "notesMasters/notesMaster1.xml"], ["rId3", "theme", "theme/theme1.xml"], ...list.map((_, i): [string, string, string] => [`rId${i + 4}`, "slide", `slides/slide${i + 1}.xml`])]) },
    { name: "ppt/theme/theme1.xml", data: THEME("Talqava") },
    { name: "ppt/theme/theme2.xml", data: THEME("Talqava notes") },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}${shape(2, "Title Placeholder 1", 'type="title"', blank, TITLE_AT)}${shape(3, "Text Placeholder 2", 'type="body" idx="1"', blank, BODY_AT)}</p:spTree></p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:buNone/><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${LEVELS([2800, 2400, 2000, 1800, 1800], true)}</p:bodyStyle><p:otherStyle>${LEVELS([1800], false)}</p:otherStyle></p:txStyles></p:sldMaster>`,
    },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]) },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      data: `${HEAD}<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GROUP}${shape(2, "Title 1", 'type="title"', blank)}${shape(3, "Content Placeholder 2", 'idx="1"', blank)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) },
    {
      name: "ppt/notesMasters/notesMaster1.xml",
      data: `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}${shape(2, "Notes Placeholder 1", 'type="body" sz="quarter" idx="1"', blank, [685800, 4400550, 5486400, 3600450])}</p:spTree></p:cSld>${CLRMAP}<p:notesStyle>${LEVELS([1200], false)}</p:notesStyle></p:notesMaster>`,
    },
    { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: rels([["rId1", "theme", "../theme/theme2.xml"]]) },
  ];
  list.forEach((s, i) => {
    const n = i + 1;
    entries.push(
      { name: `ppt/slides/slide${n}.xml`, data: `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${shape(2, "Title 1", 'type="title"', `<a:p>${pptRuns(s.title || "Untitled slide")}</a:p>`)}${shape(3, "Content Placeholder 2", 'idx="1"', pptBody(s.body))}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>` },
      { name: `ppt/slides/_rels/slide${n}.xml.rels`, data: rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "notesSlide", `../notesSlides/notesSlide${n}.xml`]]) },
      {
        name: `ppt/notesSlides/notesSlide${n}.xml`,
        data: `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}${shape(2, "Notes Placeholder 1", 'type="body" idx="1"', s.notes.trim() ? s.notes.trim().split("\n").filter((l) => l.trim()).map((l) => `<a:p>${pptRuns(l.trim())}</a:p>`).join("") : blank)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
      },
      { name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, data: rels([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${n}.xml`]]) },
    );
  });
  return zip(entries);
}

/** The slides of a PowerPoint file: each slide's title, its text as Markdown, and its speaker notes. */
export function fromPptx(buffer: Buffer): { title: string; slides: PptSlide[] } {
  const files = unzip(buffer);
  const read = (name: string) => files.get(name)?.().toString("utf8");
  const pres = read("ppt/presentation.xml");
  const presRels = read("ppt/_rels/presentation.xml.rels");
  if (!pres || !presRels) throw new Error("That does not look like a PowerPoint file (.pptx).");
  const targets = (relsXml: string, base: string) => new Map([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/\bId="([^"]+)"/.exec(m[0])?.[1] ?? "", { type: /\bType="[^"]*\/([^"/]+)"/.exec(m[0])?.[1] ?? "", path: resolvePart(base, /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? "") }]));
  const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
  const byId = targets(presRels, "ppt");
  /** A paragraph's words, with bold and italic kept. */
  const paraText = (p: string) =>
    [...p.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>|<a:br\b[^>]*\/?>/g)]
      .map((m) => {
        if (m[1] === undefined) return " ";
        const t = unxml([...m[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join(""));
        if (!t.trim()) return t;
        const props = /<a:rPr\b[^>]*>/.exec(m[1])?.[0] ?? "";
        return /\bb="1"/.test(props) ? `**${t.trim()}**${/\s$/.test(t) ? " " : ""}` : /\bi="1"/.test(props) ? `*${t.trim()}*${/\s$/.test(t) ? " " : ""}` : t;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const paragraphs = (xmlText: string) => [...xmlText.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((m) => ({ text: paraText(m[1]), level: Number(/<a:pPr\b[^>]*\blvl="(\d)"/.exec(m[1])?.[1] ?? 0), plain: /<a:buNone\/>/.test(m[1]) })).filter((p) => p.text);
  const slides: PptSlide[] = [];
  for (const rid of order.slice(0, 500)) {
    const part = byId.get(rid)?.path;
    const sld = part && read(part);
    if (!sld) continue;
    let title = "";
    const body: string[] = [];
    // Shapes and tables in the order they stand on the slide.
    for (const m of sld.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>|<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g)) {
      const block = m[0];
      if (block.startsWith("<a:tbl")) {
        const rows = [...block.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((r) => [...r[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((c) => paragraphs(c[1]).map((p) => p.text).join(" ").replace(/\|/g, "/")));
        if (rows.length) body.push("", `| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "");
        continue;
      }
      const ph = /<p:ph\b[^>]*>/.exec(block)?.[0] ?? "";
      if (/type="(dt|ftr|sldNum)"/.test(ph)) continue;
      const paras = paragraphs(block);
      if (/type="(title|ctrTitle)"/.test(ph) && !title) title = paras.map((p) => p.text).join(" ").replace(/\*\*/g, "");
      else if (/type="subTitle"/.test(ph) || !ph) body.push(...paras.map((p) => p.text), "");
      else body.push(...paras.map((p) => (p.plain ? p.text : `${"  ".repeat(p.level)}- ${p.text}`)));
    }
    let notes = "";
    const sldRels = read(part.replace(/([^/]+)$/, "_rels/$1.rels"));
    const notesPart = sldRels && [...targets(sldRels, part.replace(/\/[^/]+$/, "")).values()].find((t) => t.type === "notesSlide")?.path;
    const notesXml = notesPart && read(notesPart);
    if (notesXml) notes = [...notesXml.matchAll(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g)].filter((s) => /<p:ph\b[^>]*type="body"/.test(s[0])).flatMap((s) => paragraphs(s[0]).map((p) => p.text)).join("\n");
    slides.push({ title: title || "Untitled slide", body: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(), notes });
  }
  if (!slides.length) throw new Error("That PowerPoint file has no slides Talqava can read.");
  const core = read("docProps/core.xml");
  return { title: unxml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(core ?? "")?.[1] ?? "").trim(), slides };
}
/** A part's path from a relationship target, which may be relative to the part that names it. */
function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const out = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
