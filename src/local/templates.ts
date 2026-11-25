// Core quests: ready-made quests in the quests/ folder. Each names the bot that
// goes, what to ask, what the app gathers first, and how the result is checked.
// Only the app's own quest files are read, because a check can run a command.
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { ROOT } from "./store.ts";

export const TEMPLATE_DIR = path.join(ROOT, "quests");

export interface TemplateInput {
  id: string;
  label: string;
  placeholder?: string;
  default?: string;
  required?: boolean;
}

export interface QuestCheck {
  /** A file that must have changed ("any" for at least one file). */
  changed?: string;
  /** A command that must pass in the quest's working copy. */
  command?: string;
  /** "gathered": the reply must mention every item the app gathered. */
  covers?: "gathered";
  /** The reply must link at least this many different sources. */
  links?: number;
  /**
   * An answer key: points the reply must contain. Each entry may list accepted
   * spellings separated by "|" ("45 days|45-day"). What is missing is never
   * named back to the agent, so a second try cannot copy the answer.
   */
  mentions?: string[];
  /** Things the reply must leave out, such as the items that do not belong in the answer. */
  avoids?: string[];
  /** An answer key of pairs: each key must share a line with its value ("T-01": "billing"). */
  pairs?: Record<string, string>;
}

export interface QuestTemplate {
  id: string;
  name: string;
  summary: string;
  bot: string;
  repository: "required" | "optional" | "none";
  inputs: TemplateInput[];
  gather?: "git-log" | "github-issues" | "github-report";
  prompt: string;
  check: QuestCheck;
}

const GATHERERS = ["git-log", "github-issues", "github-report"];

function readTemplate(id: string, text: string, folder = "quests"): QuestTemplate {
  const data = parse(text) as Record<string, any>;
  const problem = (what: string) => new Error(`${folder}/${id}.yaml: ${what}`);
  if (!data || typeof data !== "object") throw problem("is empty.");
  for (const key of ["name", "summary", "bot", "prompt"]) if (typeof data[key] !== "string" || !data[key].trim()) throw problem(`needs ${key}.`);
  const repository = data.repository ?? "none";
  if (!["required", "optional", "none"].includes(repository)) throw problem("repository is required, optional or none.");
  if (data.gather !== undefined && !GATHERERS.includes(data.gather)) throw problem(`gather is one of ${GATHERERS.join(", ")}.`);
  const inputs: TemplateInput[] = (data.inputs ?? []).map((input: any) => {
    if (!input || typeof input.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(input.id) || typeof input.label !== "string") throw problem("each input needs an id and a label.");
    return { id: input.id, label: input.label, placeholder: input.placeholder, default: input.default === undefined ? undefined : String(input.default), required: Boolean(input.required) };
  });
  const check = (data.check ?? {}) as QuestCheck;
  for (const key of ["mentions", "avoids"] as const) {
    if (check[key] !== undefined && (!Array.isArray(check[key]) || check[key]!.some((item) => typeof item !== "string" || !item.trim()))) throw problem(`check.${key} is a list of words or phrases.`);
  }
  if (check.pairs !== undefined && (typeof check.pairs !== "object" || Array.isArray(check.pairs) || Object.values(check.pairs).some((v) => typeof v !== "string" || !v.trim()))) throw problem("check.pairs maps each item to its answer.");
  return { id, name: data.name.trim(), summary: data.summary.trim(), bot: data.bot, repository, inputs, gather: data.gather, prompt: data.prompt, check };
}

/** The templates in a folder. Only the app's own folders are passed here, because a check can run a command. */
export function loadTemplatesFrom(dir: string): QuestTemplate[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort();
  } catch {}
  return names.map((name) => readTemplate(name.replace(/\.yaml$/, ""), fs.readFileSync(path.join(dir, name), "utf8"), path.relative(ROOT, dir) || "quests"));
}

export function loadTemplates(): QuestTemplate[] {
  return loadTemplatesFrom(TEMPLATE_DIR);
}

export function findTemplate(id: string): QuestTemplate {
  const template = loadTemplates().find((t) => t.id === id);
  if (!template) throw new Error(`There is no core quest called "${id}".`);
  return template;
}

/** Fills {{name}} with the inputs (and the gathered material). Unknown names are left empty. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, name: string) => values[name] ?? "");
}

/** The inputs as given, with defaults for the blank ones, refusing any required one left blank. */
export function resolveInputs(template: QuestTemplate, given: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of template.inputs) {
    const value = String(given[input.id] ?? "").trim() || input.default || "";
    if (input.required && !value) throw new Error(`${template.name} needs: ${input.label}.`);
    values[input.id] = value.slice(0, 2000);
  }
  return values;
}
