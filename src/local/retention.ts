// Retention: how long chats and finished task records are kept before they are deleted, a legal hold that stops
// every deletion while it is on, and a search for everything held about one person (so the owner can answer a
// request to see or erase it).
import { conversations, getConfig } from "./store.ts";
import { questStore } from "./quests.ts";
import { audit } from "./audit.ts";
import { workspace } from "./workspace.ts";
import { library } from "./library.ts";
import { orgMemory } from "./orgmemory.ts";
import type { Org } from "./orgs.ts";

export const RETENTION_CHOICES = [0, 90, 180, 365, 730, 1825];
export interface Retention {
  /** Days chats and finished task records are kept. 0 keeps them until deleted by hand. */
  days: number;
  /** While on, nothing is deleted, by anyone or by this schedule. */
  legalHold: boolean;
}
export const retention = (): Retention => {
  const r = getConfig().retention ?? {};
  return { days: RETENTION_CHOICES.includes(Number(r.days)) ? Number(r.days) : 0, legalHold: r.legalHold === true };
};
export function retentionFrom(input: unknown, before: Retention = retention()): Retention {
  const r = (input ?? {}) as { days?: unknown; legalHold?: unknown };
  return { days: RETENTION_CHOICES.includes(Number(r.days)) ? Number(r.days) : before.days, legalHold: typeof r.legalHold === "boolean" ? r.legalHold : before.legalHold };
}

/**
 * Deletes chats and finished task records last touched more than the kept number of days ago. Does nothing with no
 * limit set, or under a legal hold. Work that is running, waiting on the owner, or holds changes not yet kept or
 * undone is never deleted.
 */
export function sweep(isRunning: (id: string) => boolean, now = Date.now()): { chats: number; tasks: number } {
  const r = retention();
  const done = { chats: 0, tasks: 0 };
  if (!r.days || r.legalHold) return done;
  const cutoff = new Date(now - r.days * 86_400_000).toISOString();
  const quests = new Map(questStore.list().map((q) => [q.id, q]));
  for (const c of conversations.list()) {
    if (c.updatedAt >= cutoff || c.pinned || isRunning(c.id)) continue;
    const quest = quests.get(c.id);
    if (quest) {
      if (!["done", "failed", "stopped"].includes(String(quest.status)) || (quest.copy && !quest.outcome)) continue;
      questStore.remove(c.id);
      done.tasks++;
    } else done.chats++;
    conversations.remove(c.id);
  }
  if (done.chats || done.tasks) audit({ actor: "system", actorName: "Talqava", kind: "security", action: `Deleted records older than ${r.days} days, as your retention rule says`, detail: `${done.chats} chats, ${done.tasks} finished tasks` });
  return done;
}

/** Everywhere a person's name or email appears: pages, documents, notes, sheets, library documents, memory, chats. */
export function findPerson(org: Org, query: unknown): { query: string; places: { where: string; title: string; snippet: string }[] } {
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 3) throw new Error("Type at least 3 letters of the person's name or email.");
  const needle = q.toLowerCase();
  const cut = (text: string) => {
    const at = text.toLowerCase().indexOf(needle);
    return at < 0 ? text.slice(0, 160) : `${at > 60 ? "…" : ""}${text.slice(Math.max(0, at - 60), at + needle.length + 100).replace(/\s+/g, " ")}…`;
  };
  const places: { where: string; title: string; snippet: string }[] = [];
  const kinds: Record<string, string> = { page: "Workspace page", doc: "Document", note: "Note", sheet: "Sheet" };
  for (const p of workspace.tree(org)) {
    const text = workspace.get(org, p.id).markdown;
    if (`${p.title}\n${text}`.toLowerCase().includes(needle)) places.push({ where: kinds[p.kind] ?? "Workspace page", title: p.title, snippet: cut(text) });
  }
  try {
    const seen = new Set<number>();
    for (const h of library.search(org, null, q, 50)) {
      if (seen.has(h.document) || !`${h.name} ${h.text}`.toLowerCase().includes(needle)) continue;
      seen.add(h.document);
      places.push({ where: "Library document", title: h.path, snippet: cut(h.text) });
    }
  } catch {}
  for (const m of orgMemory.list(org.id)) if (m.text.toLowerCase().includes(needle)) places.push({ where: "Memory", title: m.shelf === "org" ? "The organization's memory" : `Memory of ${m.key}`, snippet: cut(m.text) });
  for (const c of conversations.list()) {
    const conv = conversations.get(c.id);
    const text = JSON.stringify(conv?.messages ?? []);
    if (`${c.title} ${text}`.toLowerCase().includes(needle)) places.push({ where: c.source === "quest" ? "Task" : "Chat", title: c.title, snippet: `Last active ${c.updatedAt.slice(0, 10)}` });
  }
  return { query: q, places: places.slice(0, 500) };
}
