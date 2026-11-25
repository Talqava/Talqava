// Office sheets: files of cells with formulas, charts and locked cells. A sheet file is a page of kind "sheet" whose
// text is one line per cell (see public/sheet-engine.js), so who may see it, its history, and an agent's change
// waiting for the owner all work as they do for a page. Agents read the worked-out values and change cells with the
// sheet tool; they can never change a locked cell.
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { GENERAL_AGENT, OWNER } from "./library.ts";
import { workspace } from "./workspace.ts";
import type { Page, Who } from "./workspace.ts";
import { parseCsv } from "./tables.ts";
import { MAX_COLS, MAX_ROWS, colName, compute, emptyFile, extent, formatOf, isError, isLocked, parseFile, parseRef, refName, show, writeFile } from "../../public/sheet-engine.js";
import type { Sheet, SheetFile } from "../../public/sheet-engine.js";

/** The sheet file `who` may see, with its page. Anything that is not a sheet is "no such sheet". */
function open(org: Org, id: string, who: Who): { page: Page; file: SheetFile } {
  let page: Page;
  try {
    page = workspace.get(org, String(id), who);
  } catch {
    throw new Error("There is no such sheet, or it is not one you may see.");
  }
  if (page.kind !== "sheet") throw new Error("There is no such sheet, or it is not one you may see.");
  return { page, file: parseFile(page.markdown) };
}

/** Which sheet of a file is meant: by name, or the first when none is named. */
function tabOf(file: SheetFile, name: unknown): { sheet: Sheet; index: number } {
  const want = String(name ?? "").trim().toLowerCase();
  const index = want ? file.sheets.findIndex((s) => s.name.toLowerCase() === want) : 0;
  if (index < 0) throw new Error(`This file has no sheet called “${String(name).slice(0, 40)}”. Its sheets are: ${file.sheets.map((s) => s.name).join(", ")}.`);
  return { sheet: file.sheets[index], index };
}

const csvField = (t: string) => (/^[=+\-@\t\r]/.test(t) && !/^-?[\d.,$%€£ ]+$/.test(t) ? `'${t}` : t).replace(/^(.*[",\n\r].*)$/s, (m) => `"${m.replace(/"/g, '""')}"`);

export const sheets = {
  /** A new sheet file. From a CSV, its first sheet holds the file's rows. */
  create(org: Org, who: Who, input: { title?: unknown; folder?: unknown; csv?: unknown; task?: string | null }): Page {
    const file = emptyFile();
    if (input.csv !== undefined) {
      const rows = parseCsv(String(input.csv));
      if (!rows.length) throw new Error("That file has no rows.");
      if (rows.length > MAX_ROWS) throw new Error(`That file has ${rows.length} rows. A sheet can hold up to ${MAX_ROWS}.`);
      if (Math.max(...rows.map((r) => r.length)) > MAX_COLS) throw new Error(`That file has more than ${MAX_COLS} columns.`);
      // A value that starts with "=" comes in as text, not as a formula: a file from elsewhere does not get to calculate.
      rows.forEach((cells, r) => cells.forEach((v, c) => v.trim() && (file.sheets[0].cells[refName(c, r)] = v.trim().startsWith("=") ? `'${v.trim()}` : v.trim())));
    }
    return workspace.create(org, who, { kind: "sheet", title: input.title, folder: input.folder, markdown: writeFile(file), task: input.task });
  },

  /** A sheet's worked-out values, row by row, for agents: each filled cell, with its formula when it has one. */
  read(org: Org, who: Who, id: string, tab?: unknown): { title: string; sheet: string; sheets: string[]; text: string } {
    const { page, file } = open(org, id, who);
    const { sheet, index } = tabOf(file, tab);
    const value = compute(file);
    const { rows, cols } = extent(sheet);
    const lines: string[] = [];
    for (let r = 0; r <= rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= cols; c++) {
        const raw = sheet.cells[refName(c, r)];
        if (raw == null) continue;
        const shown = show(value(index, c, r), formatOf(sheet, c, r));
        cells.push(`${refName(c, r)}: ${shown}${raw.startsWith("=") ? ` (${raw})` : ""}${isLocked(sheet, c, r) ? " [locked]" : ""}`);
      }
      if (cells.length) lines.push(cells.join(" | "));
    }
    return { title: page.title, sheet: sheet.name, sheets: file.sheets.map((s) => s.name), text: lines.join("\n") || "(This sheet is empty.)" };
  },

  /**
   * An agent's change to cells. Locked cells are refused. The change is applied straight away only when the file takes
   * agents' edits directly (never a protected one); otherwise it waits for the owner.
   */
  set(org: Org, who: Who, id: string, input: { sheet?: unknown; cells?: unknown; note?: unknown; task?: string | null }): { applied: boolean; title: string; changed: number } {
    if (who === OWNER) throw new Error("The owner edits the sheet directly.");
    const { page, file } = open(org, id, who);
    const { sheet } = tabOf(file, input.sheet);
    if (!Array.isArray(input.cells) || !input.cells.length) throw new Error('Give the cells to change: a list of { "cell": "B3", "value": "1200" }. A value starting with = is a formula; an empty value clears the cell.');
    if (input.cells.length > 500) throw new Error("Change up to 500 cells at a time.");
    let changed = 0;
    for (const item of input.cells as { cell?: unknown; value?: unknown }[]) {
      const at = parseRef(String(item?.cell ?? ""));
      if (!at) throw new Error(`“${String(item?.cell ?? "").slice(0, 20)}” is not a cell. Cells are named like B3, up to column ${colName(MAX_COLS - 1)} and row ${MAX_ROWS}.`);
      const ref = refName(at.col, at.row);
      if (isLocked(sheet, at.col, at.row)) throw new Error(`${ref} is locked: the owner does not let agents change it. Leave it, and say so in your report if it needs changing.`);
      const raw = item.value == null ? "" : String(item.value).trim().slice(0, 2000);
      if ((sheet.cells[ref] ?? "") === raw) continue;
      if (raw === "") delete sheet.cells[ref];
      else sheet.cells[ref] = raw;
      changed++;
    }
    if (!changed) throw new Error("Those cells already hold those values.");
    const value = compute(file);
    const broken = (input.cells as { cell?: unknown }[]).map((i) => parseRef(String(i.cell))!).filter((at) => isError(value(file.sheets.indexOf(sheet), at.col, at.row)));
    if (broken.length) throw new Error(`${refName(broken[0].col, broken[0].row)} would show ${show(value(file.sheets.indexOf(sheet), broken[0].col, broken[0].row))}. Fix the formula and try again; nothing was changed.`);
    const r = workspace.propose(org, who, page.id, writeFile(file), input.note, input.task ?? null);
    return { applied: r.applied, title: page.title, changed };
  },

  /** One sheet of a file as CSV, with worked-out values. */
  csv(org: Org, id: string, tab?: unknown, who: Who = OWNER): { name: string; csv: string } {
    const { page, file } = open(org, id, who);
    const { sheet, index } = tabOf(file, tab);
    const value = compute(file);
    const { rows, cols } = extent(sheet);
    const lines: string[] = [];
    for (let r = 0; r <= rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= cols; c++) cells.push(csvField(show(value(index, c, r))));
      lines.push(cells.join(","));
    }
    return { name: `${`${page.title} ${file.sheets.length > 1 ? sheet.name : ""}`.replace(/[^\w -]+/g, "").trim() || "sheet"}.csv`, csv: `${lines.join("\r\n")}\r\n` };
  },
};

/** The tool agents use for sheets. `who` says which agent is calling. */
export function sheetTool(who: (conversationId: string) => string | null): Tool {
  return defineTool<{ action: "list" | "read" | "set" | "create"; file?: string; sheet?: string; cells?: { cell: string; value: string }[]; note?: string; title?: string; folder?: string }>({
    name: "sheet",
    description:
      "Sheets in Office: files of cells with formulas, for budgets, forecasts and lists that calculate. " +
      "\"list\" shows the sheet files you may read. \"read\" returns one sheet's worked-out values, with each formula beside its value. " +
      "\"set\" changes cells: give a list of { cell, value }; a value starting with = is a formula (SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, SUMIF, COUNTIF and arithmetic; another sheet's cell is Name!A1), an empty value clears the cell. Give a one-line note on what you changed and why. " +
      "\"create\" starts a new sheet file. Locked cells cannot be changed. A change is applied straight away only if the file takes agents' edits directly; otherwise it waits for the owner, and you say so in your report. Read a sheet before changing it.",
    properties: {
      action: { type: "string", enum: ["list", "read", "set", "create"] },
      file: { type: "string", description: "For read and set: the sheet file's id, as given by list." },
      sheet: { type: "string", description: "For read and set: which sheet of the file, by name. Leave out for the first." },
      cells: { type: "array", items: { type: "object", properties: { cell: { type: "string" }, value: { type: "string" } }, required: ["cell", "value"] }, description: "For set: the cells to change." },
      note: { type: "string", description: "For set: one line on what you changed and why, for the owner." },
      title: { type: "string", description: "For create: the new file's title." },
      folder: { type: "string", description: "For create: the folder to put it in, e.g. Finance." },
    },
    required: ["action"],
    async run(input, { conversation }) {
      const org = orgs.active();
      const agent = who(conversation.id) ?? GENERAL_AGENT;
      const task = conversation.id;
      if (input.action === "list") {
        const files = workspace.tree(org, agent).filter((p) => p.kind === "sheet");
        return files.length ? files.map((f) => `[${f.id}] ${f.title}${f.folder ? ` (in ${f.folder})` : ""}: ${f.summary}`).join("\n") : "There are no sheets you may read yet.";
      }
      if (input.action === "create") {
        const page = sheets.create(org, agent, { title: input.title, folder: input.folder, task });
        workspace.used(org, task, page.id, "filed");
        return `Started the sheet “${page.title}” (file ${page.id}). Fill it with set, and say in your report where it is.`;
      }
      const id = String(input.file ?? "");
      if (!id) throw new Error("Say which sheet file (its id). List the sheets to choose one.");
      if (input.action === "read") {
        const r = sheets.read(org, agent, id, input.sheet);
        workspace.used(org, task, id, "read");
        return `${r.title} › ${r.sheet}${r.sheets.length > 1 ? ` (sheets in this file: ${r.sheets.join(", ")})` : ""}\n\n${r.text}`;
      }
      const r = sheets.set(org, agent, id, { sheet: input.sheet, cells: input.cells, note: input.note, task });
      return r.applied ? `Changed ${r.changed} cell${r.changed === 1 ? "" : "s"} in “${r.title}”. Say so in your report.` : `Your change to ${r.changed} cell${r.changed === 1 ? "" : "s"} in “${r.title}” waits for the owner to accept it; the sheet stays as it was until then. Say so in your report.`;
    },
  });
}
