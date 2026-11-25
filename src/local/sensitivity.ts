// Sensitivity levels: how sensitive each page, document, note and sheet is, and which AI services may receive each
// level. The owner sets, per level, whether its content may go to any connected AI service, only approved ones, only
// models on this computer, or none. A Restricted item is also hidden from every agent that is not named on it.
//
// How it is enforced: when a run is being prepared, the model it will use (and any backup it could fall over to) is
// noted, and from then on, through every tool the run calls, the workspace hands over only the levels that model may
// receive. Outside a run (the owner in the app) nothing is held back.
import { AsyncLocalStorage } from "node:async_hooks";
import { getConfig } from "./store.ts";
import type { Config } from "./store.ts";
import { isLocalRef } from "./gateway.ts";

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
}
export const OPEN_POLICY: Policy = { services: { public: "any", internal: "any", confidential: "any", restricted: "any" }, approved: [], memory: "internal" };
/** A sensible starting point, offered as one button. */
export const RECOMMENDED: Policy["services"] = { public: "any", internal: "any", confidential: "approved", restricted: "local" };

export const levelOf = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : "internal");

export function policyFrom(input: unknown, before: Policy = OPEN_POLICY): Policy {
  const p = (input ?? {}) as { services?: Record<string, unknown>; approved?: unknown; memory?: unknown };
  const services = { ...before.services };
  for (const level of LEVELS) if (WHERE.includes(p.services?.[level] as Where)) services[level] = p.services![level] as Where;
  return { services, approved: p.approved === undefined ? before.approved : Array.isArray(p.approved) ? [...new Set(p.approved.map(String))].slice(0, 100) : [], memory: LEVELS.includes(p.memory as Level) ? (p.memory as Level) : before.memory };
}
export const policy = (cfg: Config = getConfig()): Policy => policyFrom(cfg.sensitivity ?? {});

/** The levels one model may receive. */
function levelsFor(ref: string, p: Policy): Set<Level> {
  const local = isLocalRef(ref);
  const provider = ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : "anthropic";
  const approved = local || p.approved.includes(provider);
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
}
const current = new AsyncLocalStorage<Clearance>();

/** Runs `fn` as part of preparing a run: models chosen inside it narrow what the run may receive. Returns that too. */
export async function preparing<T>(fn: () => Promise<T>): Promise<{ result: T; levels: Level[] | null }> {
  const store: Clearance = { levels: null };
  const result = await current.run(store, fn);
  return { result, levels: store.levels ? [...store.levels] : null };
}
/** Called whenever a model is chosen while a run is being prepared. */
export function noteModel(cfg: Config, ref: string) {
  const store = current.getStore();
  if (!store) return;
  const levels = levelsForRun(ref, cfg);
  store.levels = store.levels ? new Set([...store.levels].filter((l) => levels.has(l))) : levels;
}
/** Runs `fn` (a tool of a run) with the levels that run may receive. */
export const withLevels = <T>(levels: Level[] | null, fn: () => T): T => current.run({ levels: levels ? new Set(levels) : null }, fn);

/** Whether content of this level may be handed over right now. Always true outside a run. */
export function mayReceive(level: Level): boolean {
  const store = current.getStore();
  return !store?.levels || store.levels.has(level);
}

/** The policy in plain words. */
export function describePolicy(p: Policy = policy()): string[] {
  return LEVELS.map((l) => `${LEVEL_WORDS[l].name}: ${((w) => w[0].toLowerCase() + w.slice(1))(WHERE_WORDS[p.services[l]])}.`);
}
