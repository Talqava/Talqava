// Monthly budgets for bots. What each bot's quests cost is added up per calendar
// month in a small ledger; a bot (or all bots together) that reaches its limit
// starts no new work until the limit is raised or the month turns. A warning is
// shown from 80%. Spend is estimated from list prices, as everywhere else.
import path from "node:path";
import type { Bot } from "../core/index.ts";
import { DATA, getConfig, readJson, writeJson } from "./store.ts";

interface Ledger {
  /** Dollars spent by each bot, by month ("2026-11"). */
  months: Record<string, Record<string, number>>;
  /** The cost already counted for each quest, so only what is new is added. */
  seen: Record<string, number>;
  /** Dollars spent by each group, by month: "orgId/groupId" for the group a task was charged to when it started. */
  groups?: Record<string, Record<string, number>>;
  /** Dollars spent by every agent together, by day ("2026-11-26"), for the organization's daily limit. */
  days?: Record<string, number>;
}
export const dayKey = (now = new Date()) => `${monthKey(now)}-${String(now.getDate()).padStart(2, "0")}`;
/** What every agent's tasks together have spent today. */
export const spentToday = (now = new Date()): number => read().days?.[dayKey(now)] ?? 0;

const file = () => path.join(DATA, "spend.json");
const read = (): Ledger => ({ months: {}, seen: {}, ...readJson<Partial<Ledger>>(file(), {}) });
export const monthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
export const WARN_AT = 0.8;

/** Counts a quest's cost so far towards its bot's month, and its group's. Safe to call as often as the cost changes. */
export function recordSpend(questId: string, botId: string, cost: number, now = new Date(), group?: { org: string; group: string }) {
  if (!(cost > 0)) return;
  const ledger = read();
  const delta = cost - (ledger.seen[questId] ?? 0);
  if (delta <= 0) return;
  const month = (ledger.months[monthKey(now)] ??= {});
  month[botId] = Math.round(((month[botId] ?? 0) + delta) * 1e6) / 1e6;
  if (group) {
    const groups = ((ledger.groups ??= {})[monthKey(now)] ??= {});
    const key = `${group.org}/${group.group}`;
    groups[key] = Math.round(((groups[key] ?? 0) + delta) * 1e6) / 1e6;
    ledger.groups = Object.fromEntries(Object.entries(ledger.groups).sort().slice(-12));
  }
  const days = (ledger.days ??= {});
  days[dayKey(now)] = Math.round(((days[dayKey(now)] ?? 0) + delta) * 1e6) / 1e6;
  ledger.days = Object.fromEntries(Object.entries(days).sort().slice(-60));
  ledger.seen[questId] = cost;
  // Only the latest quests need remembering, and the last year of months.
  ledger.seen = Object.fromEntries(Object.entries(ledger.seen).slice(-1000));
  ledger.months = Object.fromEntries(Object.entries(ledger.months).sort().slice(-12));
  writeJson(file(), ledger);
}

export type BudgetState = "ok" | "warned" | "stopped";
export interface BudgetLine {
  spent: number;
  /** The limit in dollars, or null for none. */
  limit: number | null;
  state: BudgetState;
}

const line = (spent: number, limit: number | undefined | null): BudgetLine => ({
  spent,
  limit: limit ?? null,
  state: limit == null ? "ok" : spent >= limit ? "stopped" : spent >= limit * WARN_AT ? "warned" : "ok",
});

/** This month's spending: all bots together, and each bot. */
export function monthlyBudgets(bots: Bot[], now = new Date()): { month: string; resets: string; total: BudgetLine; bots: Record<string, BudgetLine> } {
  const month = read().months[monthKey(now)] ?? {};
  const total = Object.values(month).reduce((sum, n) => sum + n, 0);
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    month: monthKey(now),
    resets: `${resets.getFullYear()}-${String(resets.getMonth() + 1).padStart(2, "0")}-01`,
    total: line(total, getConfig().monthlyBudget),
    bots: Object.fromEntries(bots.map((bot) => [bot.id, line(month[bot.id] ?? 0, bot.monthly)])),
  };
}

const dollars = (n: number) => "$" + n.toFixed(2);

/** Why this bot may not start work now, or null if it may. */
export function budgetBlock(bot: Bot, now = new Date()): string | null {
  const budgets = monthlyBudgets([bot], now);
  const own = budgets.bots[bot.id];
  if (own.state === "stopped") return `${bot.title || bot.name}: its own monthly budget is used up (${dollars(own.spent)} of ${dollars(own.limit!)}). Raise "Monthly budget" on this agent's page, or wait until ${budgets.resets}.`;
  if (budgets.total.state === "stopped") return `All agents together: the monthly budget for all agents is used up (${dollars(budgets.total.spent)} of ${dollars(budgets.total.limit!)}). Raise it under Settings, or wait until ${budgets.resets}.`;
  return null;
}

/** What each group of an organization has spent this month, by group id. */
export function groupSpend(orgId: string, now = new Date()): Record<string, number> {
  const month = read().groups?.[monthKey(now)] ?? {};
  return Object.fromEntries(Object.entries(month).filter(([k]) => k.startsWith(`${orgId}/`)).map(([k, v]) => [k.slice(orgId.length + 1), v]));
}

/** A group's month against its budget. */
export function groupBudget(orgId: string, group: { id: string; budget?: number | null }, now = new Date()): BudgetLine {
  return line(groupSpend(orgId, now)[group.id] ?? 0, group.budget ?? null);
}

/** Why work charged to this group may not start or go on now, or null if it may. */
export function groupBlock(orgId: string, group: { id: string; name: string; budget?: number | null } | undefined, now = new Date()): string | null {
  if (!group || group.budget == null) return null;
  const b = groupBudget(orgId, group, now);
  if (b.state !== "stopped") return null;
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `The ${group.name} group: its monthly budget is used up (${dollars(b.spent)} of ${dollars(b.limit!)}). Raise the group's monthly budget on the Organization page, or wait until ${resets.getFullYear()}-${String(resets.getMonth() + 1).padStart(2, "0")}-01.`;
}
