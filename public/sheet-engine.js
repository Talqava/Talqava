// The sheet engine: what a sheet file holds, how it is written as text, and how its formulas are worked out. The same
// file runs in the app's window (so numbers update as you type) and in the app itself (so agents read the worked-out
// values). A sheet file is plain text, one line per cell, so its history, its search and an agent's suggested change
// all work exactly like a page's:
//
//   !sheet Forecast
//   !lock A1:F1
//   !fmt B2:E8 money
//   !chart bar A2:B4 Cash by month
//   A1<tab>Line
//   D8<tab>=D2+D6-SUM(D3:D5)-D7

export const MAX_COLS = 52;
export const MAX_ROWS = 1000;
export const FORMATS = ["plain", "number", "money", "percent"];
export const CHART_TYPES = ["bar", "line"];

/** "A" → 0, "Z" → 25, "AA" → 26. */
export const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
/** 0 → "A", 26 → "AA". */
export const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
/** "B3" → { col: 1, row: 2 }, or null when it is not a cell on the sheet. */
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,2})\$?([0-9]{1,4})$/.exec(String(ref).trim());
  if (!m) return null;
  const col = colIndex(m[1]);
  const row = Number(m[2]) - 1;
  return col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS ? null : { col, row };
}
export const refName = (col, row) => `${colName(col)}${row + 1}`;
/** "A1:B3" (or one cell) → its corners in order, or null. */
export function parseRange(range) {
  const [a, b = a] = String(range).trim().split(":");
  const from = parseRef(a);
  const to = parseRef(b);
  if (!from || !to) return null;
  return { c1: Math.min(from.col, to.col), r1: Math.min(from.row, to.row), c2: Math.max(from.col, to.col), r2: Math.max(from.row, to.row) };
}
export const rangeName = (r) => (r.c1 === r.c2 && r.r1 === r.r2 ? refName(r.c1, r.r1) : `${refName(r.c1, r.r1)}:${refName(r.c2, r.r2)}`);
const inRange = (r, col, row) => col >= r.c1 && col <= r.c2 && row >= r.r1 && row <= r.r2;

const cleanName = (t) => String(t ?? "").replace(/[\t\n\r!']/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/** An empty file with one sheet. */
export const emptyFile = (name = "Sheet 1") => ({ sheets: [{ name: cleanName(name) || "Sheet 1", cells: {}, locks: [], formats: [], charts: [] }] });

/** The file from its text. Lines it does not understand are left out. */
export function parseFile(text) {
  const file = { sheets: [] };
  let sheet = null;
  const open = (name) => {
    let n = cleanName(name) || `Sheet ${file.sheets.length + 1}`;
    while (file.sheets.some((s) => s.name.toLowerCase() === n.toLowerCase())) n = `${n} 2`;
    sheet = { name: n, cells: {}, locks: [], formats: [], charts: [] };
    file.sheets.push(sheet);
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("!sheet ")) {
      open(line.slice(7));
      continue;
    }
    if (!sheet) open("Sheet 1");
    if (line.startsWith("!lock ")) {
      const r = parseRange(line.slice(6));
      if (r) sheet.locks.push(r);
    } else if (line.startsWith("!fmt ")) {
      const [range, format] = line.slice(5).trim().split(/\s+/);
      const r = parseRange(range);
      if (r && FORMATS.includes(format)) sheet.formats.push({ range: r, format });
    } else if (line.startsWith("!chart ")) {
      const m = /^(\w+)\s+(\S+)\s*(.*)$/.exec(line.slice(7).trim());
      const r = m && parseRange(m[2]);
      if (r && CHART_TYPES.includes(m[1])) sheet.charts.push({ type: m[1], range: r, title: m[3].trim().slice(0, 80) });
    } else if (!line.startsWith("!")) {
      const tab = line.indexOf("\t");
      const at = parseRef(tab < 0 ? line : line.slice(0, tab));
      const raw = tab < 0 ? "" : unescape(line.slice(tab + 1));
      if (at && raw !== "") sheet.cells[refName(at.col, at.row)] = raw;
    }
  }
  if (!file.sheets.length) open("Sheet 1");
  return file;
}

const escape = (raw) => String(raw).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, " ");
const unescape = (text) => text.replace(/\\(\\|n)/g, (_, c) => (c === "n" ? "\n" : "\\"));

/** The file as text, always written the same way (sheets in order, cells by row then column), so two versions compare line by line. */
export function writeFile(file) {
  const lines = [];
  for (const s of file.sheets) {
    lines.push(`!sheet ${cleanName(s.name) || "Sheet"}`);
    for (const r of s.locks) lines.push(`!lock ${rangeName(r)}`);
    for (const f of s.formats) lines.push(`!fmt ${rangeName(f.range)} ${f.format}`);
    for (const c of s.charts) lines.push(`!chart ${c.type} ${rangeName(c.range)} ${String(c.title ?? "").replace(/\s+/g, " ").trim()}`.trimEnd());
    const cells = Object.entries(s.cells)
      .map(([ref, raw]) => ({ at: parseRef(ref), raw }))
      .filter((c) => c.at && c.raw !== "" && c.raw != null)
      .sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col);
    for (const c of cells) lines.push(`${refName(c.at.col, c.at.row)}\t${escape(c.raw)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Whether a cell is locked: agents may not change it. */
export const isLocked = (sheet, col, row) => sheet.locks.some((r) => inRange(r, col, row));
/** A cell's format: the last one set that covers it. */
export const formatOf = (sheet, col, row) => sheet.formats.findLast((f) => inRange(f.range, col, row))?.format ?? "plain";
/** The last used row and column of a sheet (0-based), or -1 when it is empty. */
export function extent(sheet) {
  let rows = -1;
  let cols = -1;
  for (const ref of Object.keys(sheet.cells)) {
    const at = parseRef(ref);
    if (!at) continue;
    rows = Math.max(rows, at.row);
    cols = Math.max(cols, at.col);
  }
  return { rows, cols };
}

// ---------- values ----------

/** An error a formula can give, shown in the cell. */
export class SheetError {
  constructor(code) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
const err = (code) => new SheetError(code);
export const isError = (v) => v instanceof SheetError;

/** What was typed, as a value: a number where it reads as one ("1,200", "$5.50", "12%"), otherwise the text. */
export function literal(raw) {
  const t = String(raw).trim();
  if (t === "") return "";
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const m = /^(-?)\s*[$€£]?\s*(-?)(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\s*(%?)$/.exec(t);
  if (m && (m[3] || m[5])) {
    const n = Number(`${m[1] || m[2] ? "-" : ""}${(m[3] ?? "0").replace(/,/g, "")}${m[5] ?? ""}`);
    if (Number.isFinite(n)) return m[6] ? n / 100 : n;
  }
  return String(raw);
}

// ---------- formulas ----------

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < src.length && (src[j] !== '"' || src[j + 1] === '"')) {
        if (src[j] === '"') j++;
        text += src[j++];
      }
      if (j >= src.length) throw err("#ERROR!");
      out.push({ t: "str", v: text });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0 || src[j + 1] !== "!") throw err("#ERROR!");
      out.push({ t: "sheet", v: src.slice(i + 1, j) });
      i = j + 2;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      if (src[i] === "!") {
        out.push({ t: "sheet", v: word[0] });
        i++;
      } else out.push({ t: "word", v: word[0] });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>(),:%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw err("#ERROR!");
  }
  return out;
}

/** A formula's text (after the "=") as a tree. Throws a SheetError when it cannot be read. */
function parseFormula(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const take = (v) => (isOp(v) ? (p++, true) : false);
  const need = (v) => {
    if (!take(v)) throw err("#ERROR!");
  };
  const binary = (next, ops) => () => {
    let left = next();
    while (peek()?.t === "op" && ops.includes(peek().v)) {
      const op = toks[p++].v;
      left = { k: "bin", op, a: left, b: next() };
    }
    return left;
  };
  const primary = () => {
    const t = toks[p++];
    if (!t) throw err("#ERROR!");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = compare();
      need(")");
      return e;
    }
    let sheet = null;
    let word = t;
    if (t.t === "sheet") {
      sheet = t.v;
      word = toks[p++];
    }
    if (word?.t !== "word") throw err("#ERROR!");
    if (!sheet && isOp("(")) {
      p++;
      const args = [];
      if (!take(")")) {
        do args.push(compare());
        while (take(","));
        need(")");
      }
      return { k: "call", name: word.v.toUpperCase(), args };
    }
    const from = parseRef(word.v);
    if (!from) {
      if (!sheet && /^(true|false)$/i.test(word.v)) return { k: "bool", v: word.v.toLowerCase() === "true" };
      throw err(sheet ? "#REF!" : "#NAME?");
    }
    if (isOp(":") && toks[p + 1]?.t === "word" && parseRef(toks[p + 1].v)) {
      const to = parseRef(toks[p + 1].v);
      p += 2;
      return { k: "range", sheet, c1: Math.min(from.col, to.col), r1: Math.min(from.row, to.row), c2: Math.max(from.col, to.col), r2: Math.max(from.row, to.row) };
    }
    return { k: "ref", sheet, col: from.col, row: from.row };
  };
  const percent = () => {
    let e = primary();
    while (take("%")) e = { k: "pct", a: e };
    return e;
  };
  const power = () => {
    const base = percent();
    return take("^") ? { k: "bin", op: "^", a: base, b: unary() } : base;
  };
  const unary = () => (take("-") ? { k: "neg", a: unary() } : take("+") ? unary() : power());
  const product = binary(unary, ["*", "/"]);
  const sum = binary(product, ["+", "-"]);
  const concat = binary(sum, ["&"]);
  const compare = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
  const tree = compare();
  if (p < toks.length) throw err("#ERROR!");
  return tree;
}

const num = (v) => {
  if (isError(v)) throw v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === "" || v == null) return 0;
  const n = literal(v);
  if (typeof n === "number") return n;
  throw err("#VALUE!");
};
const text = (v) => {
  if (isError(v)) throw v;
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v ?? "");
};
const truthy = (v) => {
  if (isError(v)) throw v;
  return typeof v === "string" ? v !== "" && v.toLowerCase() !== "false" : Boolean(v);
};
const flat = (args) => args.flatMap((a) => (Array.isArray(a) ? a.flat() : [a]));
const numbers = (args) =>
  flat(args).flatMap((v) => {
    if (isError(v)) throw v;
    return typeof v === "number" ? [v] : [];
  });
/** A condition as SUMIF and COUNTIF take it: ">100", "<>Paid", "Paid", 5. */
function matcher(cond) {
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(text(cond));
  const op = m[1] || "=";
  const want = literal(m[2]);
  return (v) => {
    const got = typeof v === "string" ? literal(v) : v;
    if (typeof want === "number") {
      if (typeof got !== "number") return op === "<>";
      return op === "=" ? got === want : op === "<>" ? got !== want : op === "<" ? got < want : op === ">" ? got > want : op === "<=" ? got <= want : got >= want;
    }
    const same = String(got ?? "").toLowerCase() === String(want).toLowerCase();
    return op === "<>" ? !same : op === "=" ? same : false;
  };
}
const round = (n, places, how) => {
  const f = 10 ** Math.trunc(places);
  const x = n * f;
  return (how === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : how === "down" ? Math.sign(x) * Math.floor(Math.abs(x) + 1e-9) : Math.sign(x) * Math.round(Math.abs(x) + 1e-9)) / f;
};

const FUNCTIONS = {
  SUM: (a) => numbers(a).reduce((s, n) => s + n, 0),
  AVERAGE: (a) => ((ns) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : fail("#DIV/0!")))(numbers(a)),
  MIN: (a) => ((ns) => (ns.length ? Math.min(...ns) : 0))(numbers(a)),
  MAX: (a) => ((ns) => (ns.length ? Math.max(...ns) : 0))(numbers(a)),
  COUNT: (a) => numbers(a).length,
  COUNTA: (a) => flat(a).filter((v) => v !== "" && v != null).length,
  ROUND: (a) => round(num(a[0]), a.length > 1 ? num(a[1]) : 0),
  ROUNDUP: (a) => round(num(a[0]), a.length > 1 ? num(a[1]) : 0, "up"),
  ROUNDDOWN: (a) => round(num(a[0]), a.length > 1 ? num(a[1]) : 0, "down"),
  ABS: (a) => Math.abs(num(a[0])),
  AND: (a) => flat(a).every(truthy),
  OR: (a) => flat(a).some(truthy),
  NOT: (a) => !truthy(a[0]),
  CONCAT: (a) => flat(a).map(text).join(""),
  LEN: (a) => text(a[0]).length,
  UPPER: (a) => text(a[0]).toUpperCase(),
  LOWER: (a) => text(a[0]).toLowerCase(),
  TODAY: () => new Date().toISOString().slice(0, 10),
  SUMIF: (a) => {
    const test = matcher(a[1]);
    const over = flat([a[0]]);
    const add = a.length > 2 ? flat([a[2]]) : over;
    return over.reduce((s, v, i) => (test(v) && typeof add[i] === "number" ? s + add[i] : s), 0);
  },
  COUNTIF: (a) => ((test) => flat([a[0]]).filter((v) => v !== "" && test(v)).length)(matcher(a[1])),
};
const fail = (code) => {
  throw err(code);
};
/** The functions formulas can use. */
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), "IF", "IFERROR"].sort();

/**
 * Works out every cell of a file. Returns `value(sheetIndex, col, row)`: a number, text, true/false, "" for an empty
 * cell, or a SheetError (#DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!, #ERROR!).
 */
export function compute(file) {
  const done = file.sheets.map(() => new Map());
  const busy = new Set();
  const trees = new Map();
  const sheetAt = (name, home) => {
    if (name == null) return home;
    const i = file.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
    if (i < 0) throw err("#REF!");
    return i;
  };
  const value = (si, col, row) => {
    const ref = refName(col, row);
    const memo = done[si];
    if (memo.has(ref)) return memo.get(ref);
    const raw = file.sheets[si].cells[ref];
    if (raw == null || raw === "") return "";
    let v;
    if (typeof raw === "string" && raw.startsWith("=") && raw.length > 1) {
      const key = `${si}!${ref}`;
      if (busy.has(key)) return err("#CYCLE!");
      busy.add(key);
      try {
        let tree = trees.get(key);
        if (!tree) trees.set(key, (tree = parseFormula(raw.slice(1))));
        v = evaluate(tree, si);
        if (Array.isArray(v)) v = v[0]?.[0] ?? "";
        if (typeof v === "number" && !Number.isFinite(v)) v = err("#DIV/0!");
      } catch (e) {
        v = isError(e) ? e : err("#ERROR!");
      }
      busy.delete(key);
    } else v = literal(raw);
    memo.set(ref, v);
    return v;
  };
  const evaluate = (n, si) => {
    switch (n.k) {
      case "num":
      case "str":
      case "bool":
        return n.v;
      case "ref": {
        const v = value(sheetAt(n.sheet, si), n.col, n.row);
        if (isError(v)) throw v;
        return v;
      }
      case "range": {
        const at = sheetAt(n.sheet, si);
        const rows = [];
        for (let r = n.r1; r <= n.r2; r++) {
          const line = [];
          for (let c = n.c1; c <= n.c2; c++) line.push(value(at, c, r));
          rows.push(line);
        }
        return rows;
      }
      case "neg":
        return -num(scalar(evaluate(n.a, si)));
      case "pct":
        return num(scalar(evaluate(n.a, si))) / 100;
      case "bin": {
        const a = scalar(evaluate(n.a, si));
        const b = scalar(evaluate(n.b, si));
        if (isError(a)) throw a;
        if (isError(b)) throw b;
        switch (n.op) {
          case "+":
            return num(a) + num(b);
          case "-":
            return num(a) - num(b);
          case "*":
            return num(a) * num(b);
          case "/":
            return num(b) === 0 ? fail("#DIV/0!") : num(a) / num(b);
          case "^":
            return num(a) ** num(b);
          case "&":
            return text(a) + text(b);
          default: {
            const both = typeof a === "number" && typeof b === "number";
            const x = both ? a : text(a).toLowerCase();
            const y = both ? b : text(b).toLowerCase();
            return n.op === "=" ? x === y : n.op === "<>" ? x !== y : n.op === "<" ? x < y : n.op === ">" ? x > y : n.op === "<=" ? x <= y : x >= y;
          }
        }
      }
      case "call": {
        if (n.name === "IF") {
          if (n.args.length < 2) throw err("#ERROR!");
          return truthy(scalar(evaluate(n.args[0], si))) ? scalar(evaluate(n.args[1], si)) : n.args[2] ? scalar(evaluate(n.args[2], si)) : false;
        }
        if (n.name === "IFERROR") {
          try {
            const v = scalar(evaluate(n.args[0], si));
            if (isError(v)) throw v;
            return v;
          } catch (e) {
            if (!isError(e)) throw e;
            return n.args[1] ? scalar(evaluate(n.args[1], si)) : "";
          }
        }
        const fn = FUNCTIONS[n.name];
        if (!fn) throw err("#NAME?");
        return fn(n.args.map((a) => evaluate(a, si)));
      }
    }
    throw err("#ERROR!");
  };
  const scalar = (v) => (Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : fail("#VALUE!")) : v);
  return value;
}

/** A worked-out value as the cell shows it. */
export function show(v, format = "plain") {
  if (isError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v !== "number") return String(v ?? "");
  if (format === "money") return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format === "percent") return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (format === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
}

/** What changed between two versions of a file, cell by cell, for reviewing a suggested change. */
export function diffFiles(before, after) {
  const out = [];
  const names = [...new Set([...before.sheets.map((s) => s.name), ...after.sheets.map((s) => s.name)])];
  for (const name of names) {
    const a = before.sheets.find((s) => s.name === name);
    const b = after.sheets.find((s) => s.name === name);
    if (!a || !b) {
      out.push({ sheet: name, ref: "", from: a ? "(the sheet)" : "", to: b ? "(a new sheet)" : "" });
      if (!b) continue;
    }
    const refs = [...new Set([...Object.keys(a?.cells ?? {}), ...Object.keys(b.cells)])];
    for (const ref of refs) {
      const from = a?.cells[ref] ?? "";
      const to = b.cells[ref] ?? "";
      if (from !== to) out.push({ sheet: name, ref, from, to });
    }
  }
  const order = (c) => ((at) => (at ? at.row * 100 + at.col : -1))(parseRef(c.ref));
  return out.sort((x, y) => names.indexOf(x.sheet) - names.indexOf(y.sheet) || order(x) - order(y));
}
