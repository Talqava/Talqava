// Usage: what the AI models were asked to do and what it cost, added up by day, by model and by who asked.
// Each call a model answers is counted as it happens (the same figures the task's receipt shows), so the page can
// say where the money went without reading every conversation again. Costs are estimates from list prices; a model
// with no known price counts its tokens and costs nothing here. The ledger keeps 400 days and holds no words from
// any conversation: only names, counts and dollars.
import path from "node:path";
import type { StepInfo } from "../core/index.ts";
import { DATA, readJson, writeJson } from "./store.ts";
import { dayKey } from "./spend.ts";

export interface UsageLine {
  calls: number;
  /** Tokens sent, read from the service's cache, and written back. */
  input: number;
  cached: number;
  output: number;
  cost: number;
}
interface Ledger {
  /** The first day anything was counted. */
  since: string;
  days: Record<string, { models: Record<string, UsageLine>; who: Record<string, UsageLine> }>;
}
const FILE = () => path.join(DATA, "usage.json");
const empty = (): UsageLine => ({ calls: 0, input: 0, cached: 0, output: 0, cost: 0 });
const add = (to: UsageLine, from: UsageLine) => ((to.calls += from.calls), (to.input += from.input), (to.cached += from.cached), (to.output += from.output), (to.cost += from.cost), to);
const read = (): Ledger => readJson<Ledger>(FILE(), { since: "", days: {} });
const count = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);

/** Counts one answer from a model: which model, who asked (an agent's title, or the assistant), and what it used. */
export function recordUsage(step: StepInfo, who: string, now = new Date()): void {
  const ledger = read();
  const day = dayKey(now);
  if (!ledger.since) ledger.since = day;
  const today = (ledger.days[day] ??= { models: {}, who: {} });
  const line: UsageLine = { calls: 1, input: count(step.input), cached: count(step.cacheRead), output: count(step.output), cost: count(step.cost) };
  add((today.models[String(step.model || "Unknown model").slice(0, 120)] ??= empty()), line);
  add((today.who[String(who || "Assistant").slice(0, 80)] ??= empty()), line);
  const keep = Object.keys(ledger.days).sort().slice(-400);
  if (keep.length < Object.keys(ledger.days).length) ledger.days = Object.fromEntries(keep.map((k) => [k, ledger.days[k]]));
  writeJson(FILE(), ledger);
}

/** The last so-many days, oldest first, with the totals by model and by who, largest cost first. */
export function usageReport(days: unknown = 30, now = new Date()) {
  const span = [7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
  const ledger = read();
  const byDay: { day: string; cost: number; calls: number }[] = [];
  const models = new Map<string, UsageLine>();
  const who = new Map<string, UsageLine>();
  const total = empty();
  for (let i = span - 1; i >= 0; i--) {
    const day = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    const got = ledger.days[day];
    const sum = empty();
    for (const [name, line] of Object.entries(got?.models ?? {})) (add(sum, line), add(models.get(name) ?? models.set(name, empty()).get(name)!, line));
    for (const [name, line] of Object.entries(got?.who ?? {})) add(who.get(name) ?? who.set(name, empty()).get(name)!, line);
    add(total, sum);
    byDay.push({ day, cost: sum.cost, calls: sum.calls });
  }
  const ranked = (m: Map<string, UsageLine>) => [...m].map(([name, line]) => ({ name, ...line })).sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  return { days: span, since: ledger.since || null, total, byDay, models: ranked(models), who: ranked(who), unpriced: ranked(models).some((m) => m.cost === 0 && m.calls > 0) };
}
