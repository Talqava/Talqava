// Sensitivity levels: how sensitive each page, document, note and sheet is, and which AI services may receive each
// level. The owner sets, per level, whether its content may go to any connected AI service, only approved ones, only
// models on this computer, or none. A Restricted item is also hidden from every agent that is not named on it.
//
// How it is enforced: when a run is being prepared, the model it will use (and any backup it could fall over to) is
// noted, and from then on, through every tool the run calls, the workspace hands over only the levels that model may
// receive. Outside a run (the owner in the app) nothing is held back.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { DATA, getConfig } from "./store.ts";
import type { Config } from "./store.ts";
import { isLocalRef } from "./gateway.ts";
import { audit } from "./audit.ts";

export const LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_WORDS: Record<Level, { name: string; about: string }> = {
  public: { name: "Public", about: "Fine for anyone to see: website text, a published price list." },
  internal: { name: "Internal", about: "Everyday business: procedures, plans, notes. The starting level." },
  confidential: { name: "Confidential", about: "Customer records, contracts, finances." },
  restricted: { name: "Restricted", about: "Payroll, health, legal matters. Hidden from every agent you have not named on it." },
};
export const WHERE = ["any", "approved", "local", "none"] as const;
export type Where = (typeof WHERE)[number];
export const WHERE_WORDS: Record<Where, string> = {
  any: "Any connected AI service",
  approved: "Only approved AI services, and models on this computer",
  local: "Only models on this computer",
  none: "Never sent to any AI model",
};

export interface Policy {
  services: Record<Level, Where>;
  /** Ids of the connected AI services the owner approved. */
  approved: string[];
  /** The level of the organization's Memory as a whole. */
  memory: Level;
  /**
   * Per level: whether a task that has read something of that level may still send anything out through a connected
   * service, a website or a web address. False means it may not, for the rest of that task.
   */
  leave: Record<Level, boolean>;
  /**
   * What the owner found in each AI service's terms: where it processes data and whether it trains its models on
   * what it is sent. Talqava cannot check these; they are the owner's own record, and they decide whether a ticked
   * service really counts as approved.
   */
  terms: Record<string, ServiceTerms>;
  /** Where data may be processed. Empty: anywhere. Otherwise an approved service must process it in one of these. */
  regions: Region[];
}
export const REGIONS = ["us", "eu", "uk", "canada", "australia", "other"] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_WORDS: Record<Region, string> = { us: "United States", eu: "European Union", uk: "United Kingdom", canada: "Canada", australia: "Australia", other: "Somewhere else" };
export const TRAINS = ["unknown", "no", "yes"] as const;
export interface ServiceTerms {
  region?: Region;
  trains: (typeof TRAINS)[number];
}
const MAY_LEAVE: Policy["leave"] = { public: true, internal: true, confidential: true, restricted: true };
export const OPEN_POLICY: Policy = { services: { public: "any", internal: "any", confidential: "any", restricted: "any" }, approved: [], memory: "internal", leave: MAY_LEAVE, terms: {}, regions: [] };
/** A sensible starting point, offered as one button. */
export const RECOMMENDED: Policy["services"] = { public: "any", internal: "any", confidential: "approved", restricted: "local" };

export const levelOf = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : "internal");

export function policyFrom(input: unknown, before: Policy = OPEN_POLICY): Policy {
  const p = (input ?? {}) as { services?: Record<string, unknown>; approved?: unknown; memory?: unknown; leave?: Record<string, unknown>; terms?: Record<string, { region?: unknown; trains?: unknown }>; regions?: unknown };
  const terms: Policy["terms"] = { ...(before.terms ?? {}) };
  if (p.terms && typeof p.terms === "object")
    for (const [id, t] of Object.entries(p.terms).slice(0, 100)) {
      if (!/^[\w.-]{1,80}$/.test(id) || !t || typeof t !== "object") continue;
      const was = terms[id] ?? { trains: "unknown" as const };
      terms[id] = { region: t.region === undefined ? was.region : REGIONS.includes(t.region as Region) ? (t.region as Region) : undefined, trains: TRAINS.includes(t.trains as "no") ? (t.trains as "no") : was.trains };
    }
  const regions = p.regions === undefined ? (before.regions ?? []) : Array.isArray(p.regions) ? REGIONS.filter((r) => (p.regions as unknown[]).includes(r)) : [];
  const leave = { ...MAY_LEAVE, ...before.leave };
  // Public content may always leave: that is what the level means.
  for (const level of LEVELS) if (level !== "public" && typeof p.leave?.[level] === "boolean") leave[level] = p.leave[level] as boolean;
  const services = { ...before.services };
  for (const level of LEVELS) if (WHERE.includes(p.services?.[level] as Where)) services[level] = p.services![level] as Where;
  return { services, approved: p.approved === undefined ? before.approved : Array.isArray(p.approved) ? [...new Set(p.approved.map(String))].slice(0, 100) : [], memory: LEVELS.includes(p.memory as Level) ? (p.memory as Level) : before.memory, leave, terms, regions };
}
export const policy = (cfg: Config = getConfig()): Policy => policyFrom(cfg.sensitivity ?? {});

/**
 * Whether a ticked service counts as approved right now: not when the owner recorded that it trains on what it is
 * sent, and, when data may only be processed in certain places, only when its recorded place is one of them.
 */
export function approvedNow(provider: string, p: Policy): boolean {
  if (!p.approved.includes(provider)) return false;
  const t = p.terms[provider];
  if (t?.trains === "yes") return false;
  return !p.regions.length || Boolean(t?.region && p.regions.includes(t.region));
}
/** Why a ticked service does not count as approved, in a few words; nothing when it does. */
export function notApprovedWhy(provider: string, p: Policy): string | null {
  if (!p.approved.includes(provider) || approvedNow(provider, p)) return null;
  const t = p.terms[provider];
  return t?.trains === "yes" ? "it trains on what it is sent" : t?.region ? `it processes data in ${REGION_WORDS[t.region]}, which is not one of the places you allow` : "you have not said where it processes data";
}

/** The levels one model may receive. */
function levelsFor(ref: string, p: Policy): Set<Level> {
  const local = isLocalRef(ref);
  const provider = ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : "anthropic";
  const approved = local || approvedNow(provider, p);
  return new Set(LEVELS.filter((level) => ((w) => w === "any" || (w === "approved" && approved) || (w === "local" && local))(p.services[level])));
}

/**
 * The levels a run on this model may receive: what the model itself may, narrowed by every model the run could
 * switch to (its backups, and for a model that is not on this computer, the team's model it may move up to).
 */
export function levelsForRun(ref: string, cfg: Config = getConfig()): Set<Level> {
  const p = policy(cfg);
  const others = [...(cfg.backups ?? []), ...(isLocalRef(ref) || cfg.moveUp === false ? [] : [cfg.model])].filter((r) => r && r !== ref);
  let levels = levelsFor(ref, p);
  for (const other of others) levels = new Set([...levels].filter((l) => levelsFor(other, p).has(l)));
  return levels;
}

interface Clearance {
  /** Null until a model is chosen for the run. */
  levels: Set<Level> | null;
  /** The model the run uses (the first one chosen), for the record of what was sent. */
  model?: string;
  /** The levels of what this task has read so far (shared by every tool call of the task). */
  read?: Set<Level>;
}
const current = new AsyncLocalStorage<Clearance>();

/** Runs `fn` as part of preparing a run: models chosen inside it narrow what the run may receive. Returns that too. */
export async function preparing<T>(fn: () => Promise<T>): Promise<{ result: T; levels: Level[] | null; model?: string }> {
  const store: Clearance = { levels: null };
  const result = await current.run(store, fn);
  return { result, levels: store.levels ? [...store.levels] : null, model: store.model };
}
/** Called whenever a model is chosen while a run is being prepared. */
export function noteModel(cfg: Config, ref: string) {
  const store = current.getStore();
  if (!store) return;
  const levels = levelsForRun(ref, cfg);
  store.model ??= ref;
  store.levels = store.levels ? new Set([...store.levels].filter((l) => levels.has(l))) : levels;
}
/** Runs `fn` (a tool of a run) with the levels that run may receive. */
export const withLevels = <T>(levels: Level[] | null, fn: () => T, model?: string, read?: Set<Level>): T => current.run({ levels: levels ? new Set(levels) : null, model, read }, fn);

// ---------- what a task has read, and whether it may still send things out ----------
// A page's text, once read, is part of the conversation; nothing can tell afterwards which words of an email came
// from it. So the rule is about the task: after it reads a level that may not leave, it sends nothing out.
const readFile = () => path.join(DATA, "read-levels.json");
let readBy: { from: string; tasks: Map<string, Set<Level>> } | null = null;
function readTasks(): Map<string, Set<Level>> {
  if (readBy?.from === readFile()) return readBy.tasks;
  const tasks = new Map<string, Set<Level>>();
  try {
    for (const [id, levels] of Object.entries(JSON.parse(fs.readFileSync(readFile(), "utf8")) as Record<string, string[]>)) tasks.set(id, new Set(levels.filter((l): l is Level => LEVELS.includes(l as Level))));
  } catch {}
  readBy = { from: readFile(), tasks };
  return tasks;
}
/** The levels one task (or chat) has read so far; the same set is handed to each of its tool calls. */
export function readOf(task: string): Set<Level> {
  const tasks = readTasks();
  let set = tasks.get(task);
  if (!set) tasks.set(task, (set = new Set()));
  return set;
}
/** Called when a page or document of this level is handed to an agent during a task. */
export function noteRead(level: Level) {
  const read = current.getStore()?.read;
  if (!read || read.has(level)) return;
  read.add(level);
  try {
    // Only tasks that read something are kept, the newest 3,000 of them.
    const kept = [...readTasks()].filter(([, s]) => s.size).slice(-3000);
    fs.writeFileSync(readFile(), JSON.stringify(Object.fromEntries(kept.map(([id, s]) => [id, [...s]]))), { mode: 0o600 });
  } catch {}
}
/** The most sensitive level this task has read that may not leave, or nothing when it may send things out. */
export function heldBack(): Level | null {
  const read = current.getStore()?.read;
  if (!read?.size) return null;
  const leave = policy().leave;
  return [...LEVELS].reverse().find((l) => read.has(l) && !leave[l]) ?? null;
}
/** Throws, in words for the agent, when this task may no longer send anything to `where`. */
export function checkMayLeave(where: string) {
  const level = heldBack();
  if (level) throw Object.assign(new Error(`This task read something marked ${LEVEL_WORDS[level].name}, and this organization's rules do not let ${LEVEL_WORDS[level].name} information leave through ${where}. Nothing was sent. Do not try another way to send it. Put what you would have sent in your report, so the owner can send it themselves.`), { heldBack: level });
}
/** The model of the run a tool is working for; nothing outside a run. */
export const runModel = (): string | undefined => current.getStore()?.model;

/** Whether content of this level may be handed over right now. Always true outside a run. */
export function mayReceive(level: Level): boolean {
  const store = current.getStore();
  return !store?.levels || store.levels.has(level);
}

/** The policy in plain words. */
export function describePolicy(p: Policy = policy()): string[] {
  const kept = LEVELS.filter((l) => !p.leave[l]).map((l) => LEVEL_WORDS[l].name);
  const where = p.regions.length ? [`Approved AI services must process data in: ${p.regions.map((r) => REGION_WORDS[r]).join(", ")}.`] : [];
  const out = p.approved.map((id) => ((why) => (why ? `${id} is ticked but does not count as approved: ${why}.` : ""))(notApprovedWhy(id, p))).filter(Boolean);
  return [...LEVELS.map((l) => `${LEVEL_WORDS[l].name}: ${((w) => w[0].toLowerCase() + w.slice(1))(WHERE_WORDS[p.services[l]])}.`), ...(kept.length ? [`A task that has read ${kept.join(" or ")} information sends nothing out through a connected service, a website or a web address.`] : []), ...where, ...out];
}

/** The same check, with a line in the audit log when it stops something. */
export function leaving(where: string, task?: string) {
  try {
    checkMayLeave(where);
  } catch (err) {
    audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, task, action: "Kept back: a task that read sensitive information tried to send something out", detail: `To ${where}` });
    throw err;
  }
}

// ---------- noticing what text holds ----------
// Two plain checks on text, done on this computer with patterns (nothing is sent anywhere): whether it looks more
// sensitive than its level says, and whether it holds a key or password that should never be sent to a service.

const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let n = Number(digits[i]);
    if (double && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
};
const hasCard = (text: string) => [...text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)].some((m) => ((d) => d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d))(m[0].replace(/\D/g, "")));
const HEALTH = /\b(diagnos(is|ed)|prescri(bed|ption)|medical (record|history|condition)|patient (name|record|id)|blood test|health insurance (number|id)|sick note)\b/i;
const PAY = /\b(payroll|salary|salaries|wage slip|payslip|pay stub|gross pay|net pay|bonus(es)? (for|of)|tax(payer)? (id|number)|national insurance number)\b/i;
const MONEY_ROWS = /(?:[$£€]\s?\d[\d,]{3,}|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b)/g;

/**
 * A level this text probably deserves, and why, when it looks more sensitive than everyday business. Card numbers,
 * social security numbers, health details and payroll point to Restricted; bank details and contracts to Confidential.
 */
export function suggestLevel(text: string): { level: Level; why: string } | null {
  const t = String(text ?? "").slice(0, 400_000);
  if (hasCard(t)) return { level: "restricted", why: "it seems to hold a payment card number" };
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t) && /\b(ssn|social security)\b/i.test(t)) return { level: "restricted", why: "it seems to hold a social security number" };
  if (HEALTH.test(t)) return { level: "restricted", why: "it seems to hold health details" };
  if (PAY.test(t) && (t.match(MONEY_ROWS)?.length ?? 0) >= 2) return { level: "restricted", why: "it seems to hold pay or payroll figures" };
  if (/\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/.test(t) && /\b(iban|bank|account)\b/i.test(t)) return { level: "confidential", why: "it seems to hold bank account details" };
  if (/\b(routing number|sort code|account number)\b/i.test(t) && /\b\d{6,}\b/.test(t)) return { level: "confidential", why: "it seems to hold bank account details" };
  if (/\b(non-disclosure agreement|confidential(ity)? agreement|strictly confidential|this agreement is (made|entered))\b/i.test(t)) return { level: "confidential", why: "it reads like a contract or a confidential paper" };
  return null;
}
/** The suggestion only when it is higher than the level the file has now. */
export function higherLevel(text: string, now: unknown): { level: Level; why: string } | null {
  const hint = suggestLevel(text);
  return hint && LEVELS.indexOf(hint.level) > LEVELS.indexOf(levelOf(now)) ? hint : null;
}

const SECRETS: [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "a private key"],
  [/\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{24,}\b/, "an AI service key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an Amazon access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "a GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, "a Slack token"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/, "a Stripe key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google key"],
  [/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/, "a sign-in token"],
  [/\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i, "a password or key"],
];
/** What kinds of keys or passwords a text seems to hold, in plain words. Empty when it holds none. */
export function findSecrets(text: string): string[] {
  const t = String(text ?? "").slice(0, 400_000);
  return [...new Set(SECRETS.filter(([re]) => re.test(t)).map(([, what]) => what))];
}
