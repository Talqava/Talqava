// Two administrators must agree: when this is on, a change to a security setting made by one administrator waits
// until a different administrator approves it. Waiting changes are kept in memory only (never written to disk, since
// they can hold a new password or a secret), and lapse after a day or when Talqava restarts.
import crypto from "node:crypto";

export interface WaitingChange {
  id: string;
  by: { id: string; name: string };
  method: string;
  /** The request's address after /api, with its query. */
  path: string;
  body: unknown;
  /** What it is, in plain words, for the administrator who decides. */
  summary: string;
  at: string;
}
const waiting = new Map<string, WaitingChange>();
const DAY = 24 * 3600 * 1000;
const fresh = () => {
  for (const [id, c] of waiting) if (Date.now() - new Date(c.at).getTime() > DAY) waiting.delete(id);
};

export const changes = {
  /** Sets a change aside to wait. Asking for the same thing twice keeps one. */
  ask(by: { id: string; name: string }, method: string, path: string, body: unknown, summary: string): WaitingChange {
    fresh();
    const same = [...waiting.values()].find((c) => c.by.id === by.id && c.method === method && c.path === path && JSON.stringify(c.body) === JSON.stringify(body));
    if (same) return same;
    if (waiting.size >= 50) throw new Error("Too many changes are waiting for approval. Approve or decline some first.");
    const change: WaitingChange = { id: crypto.randomBytes(8).toString("hex"), by, method, path, body, summary, at: new Date().toISOString() };
    waiting.set(change.id, change);
    return change;
  },
  /** The waiting changes, without what they hold. */
  list(): Omit<WaitingChange, "body">[] {
    fresh();
    return [...waiting.values()].map(({ body: _b, ...c }) => c).sort((a, b) => a.at.localeCompare(b.at));
  },
  /** Takes a change to carry it out. Only someone other than the person who asked may approve it. */
  approve(id: string, approver: { id: string }): WaitingChange {
    fresh();
    const c = waiting.get(id);
    if (!c) throw new Error("That change is no longer waiting. It may have been approved, declined, or lapsed after a day.");
    if (c.by.id === approver.id) throw new Error("A different administrator has to approve a change you asked for.");
    waiting.delete(id);
    return c;
  },
  /** Drops a waiting change. Anyone who could approve it, or the person who asked, may. */
  decline(id: string): Omit<WaitingChange, "body"> {
    const c = waiting.get(id);
    if (!c) throw new Error("That change is no longer waiting.");
    waiting.delete(id);
    const { body: _b, ...rest } = c;
    return rest;
  },
  clear(): void {
    waiting.clear();
  },
};
