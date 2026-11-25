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
