// Three things that make the audit record useful to a security team:
// - a feed: every entry is also sent, as it is written, to a system the company already watches (an https address);
//   that copy is outside this computer, so it cannot be quietly altered here;
// - alerts: the security events of the last days that deserve a look;
// - access reviews: on a schedule, someone confirms who and which agents still need the access they have.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, getConfig, newId, saveConfig, writeJson } from "./store.ts";
import { audit, onAudit, readAudit } from "./audit.ts";
import type { AuditEntry } from "./audit.ts";
import { people, ROLE_WORDS } from "./people.ts";
import type { Org } from "./orgs.ts";
import { accessGraph, accessGraphs } from "./access.ts";

// ---------- the feed ----------
const queue: object[] = [];
let sending = false;
const status = { sent: 0, failed: 0, lastError: "", lastSentAt: "" };

/** Where the feed goes, checked: an https address (http only for this computer), and an optional secret for signing. */
export function feedFrom(input: { url?: unknown; secret?: unknown } | null): { url: string; secret: string } | null {
  if (!input || !String(input.url ?? "").trim()) return null;
  let u: URL;
  try {
    u = new URL(String(input.url).trim());
  } catch {
    throw new Error("Give the full address the events should be sent to, starting with https://.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("The address must start with https://.");
  return { url: u.href, secret: String(input.secret ?? "").slice(0, 200) };
}

async function drain() {
  if (sending) return;
  sending = true;
  try {
    while (queue.length) {
      const feed = getConfig().auditFeed;
      if (!feed?.url) {
        queue.length = 0;
        break;
      }
      const batch = queue.splice(0, 50);
      const body = JSON.stringify({ source: "talqava", events: batch });
      try {
        const res = await fetch(feed.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(feed.secret ? { "x-talqava-signature": crypto.createHmac("sha256", feed.secret).update(body).digest("hex") } : {}) },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`The address answered ${res.status}.`);
        status.sent += batch.length;
        status.lastSentAt = new Date().toISOString();
        status.lastError = "";
      } catch (err) {
        status.failed += batch.length;
        status.lastError = (err as Error).message.slice(0, 200);
        // Kept for one more try with the next entry, up to a limit, so a short outage loses nothing.
        if (queue.length < 2000) queue.unshift(...batch);
        break;
      }
    }
  } finally {
    sending = false;
  }
}

/** Starts sending audit entries to the feed, when one is set. Call once when the app starts. */
export function startAuditFeed() {
  onAudit((entry) => {
    if (!getConfig().auditFeed?.url) return;
    queue.push(entry);
    void drain();
  });
}
export const feedStatus = () => ({ ...status, waiting: queue.length, url: getConfig().auditFeed?.url ?? "", signed: Boolean(getConfig().auditFeed?.secret) });
/** Sets or clears the feed and sends one test event, so a wrong address shows at once. */
export async function setFeed(input: { url?: unknown; secret?: unknown } | null) {
  const feed = feedFrom(input);
  saveConfig({ auditFeed: feed ?? undefined });
  if (feed) {
    audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Started sending the audit record to a monitoring system", detail: new URL(feed.url).host });
    await drain();
  }
  return feedStatus();
}

// ---------- alerts ----------
export interface Alert {
  at: string;
  level: "high" | "note";
  words: string;
  detail: string;
}
/** Security events of the last `days` that deserve a look, newest first. */
export function alerts(days = 7): Alert[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const entries = readAudit({ since, limit: 5000 }).entries.filter((e) => e.kind === "security" || e.kind === "guardrail");
  const out: Alert[] = [];
  const refused = entries.filter((e) => e.action === "A sign-in was refused");
  if (refused.length >= 5) out.push({ at: refused[0].at, level: refused.some((e) => /Too many wrong/.test(e.detail ?? "")) ? "high" : "note", words: `${refused.length} sign-ins were refused in the last ${days} days.`, detail: "Wrong passwords or codes. If these were not your own people, someone is guessing." });
  for (const e of entries) {
    if (/rules for (agents|sensitive information) were changed|Changed the sign-in rules|Took off a person's second step|Set a new password for a person|Added a person|Removed a person|Changed a person/.test(e.action)) out.push({ at: e.at, level: "note", words: `${e.actorName}: ${e.action}`, detail: (e.detail ?? "").slice(0, 200) });
  }
  const kept = entries.filter((e) => /^(Kept back|Refused)/.test(e.action));
  const byAgent = new Map<string, AuditEntry[]>();
  for (const e of kept) {
    const who = /Refused: (.+?) tried/.exec(e.action)?.[1] ?? (e.detail ?? "").split(" is not named")[0].split("'s AI service")[0];
    byAgent.set(who, [...(byAgent.get(who) ?? []), e]);
  }
  for (const [who, list] of byAgent) if (list.length >= 3) out.push({ at: list[0].at, level: "note", words: `${who || "An agent"} was refused ${list.length} times by your rules.`, detail: "It may be set a task it is not allowed to do, or its rules may be too tight." });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}

// ---------- access reviews ----------
export const REVIEW_EVERY_DAYS = 90;
export interface ReviewItem {
  id: string;
  kind: "person" | "agent";
  name: string;
  /** What they can do or reach, in a line. */
  has: string;
  decision: "keep" | "change" | null;
  note: string;
}
export interface Review {
  id: string;
  startedAt: string;
  startedBy: string;
  finishedAt: string | null;
  items: ReviewItem[];
}
const reviewFile = () => path.join(DATA, "access-reviews.json");
const loadReviews = (): Review[] => {
  try {
    return JSON.parse(fs.readFileSync(reviewFile(), "utf8")) as Review[];
  } catch {
    return [];
  }
};

/** Each agent's access, leaving out any position whose agent can no longer be found rather than failing the review. */
function graphsOf(org: Org) {
  try {
    return accessGraphs(org);
  } catch {
    return org.members.flatMap((m) => {
      try {
        return [accessGraph(org, m.bot)];
      } catch {
        return [];
      }
    });
  }
}

export const reviews = {
  list(): Review[] {
    return loadReviews().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },
  /** When the next review is due, and whether it is overdue. With none ever done, it is due now. */
  due(now = Date.now()): { last: string | null; next: string; overdue: boolean; open: string | null } {
    const all = this.list();
    const open = all.find((r) => !r.finishedAt);
    const last = all.find((r) => r.finishedAt)?.finishedAt ?? null;
    const next = last ? new Date(new Date(last).getTime() + REVIEW_EVERY_DAYS * 86_400_000).toISOString() : new Date(now).toISOString();
    return { last, next, overdue: new Date(next).getTime() <= now, open: open?.id ?? null };
  },
  /** Starts a review: a snapshot of every person and every agent with what each can do, to confirm one by one. */
  start(org: Org, by: string): Review {
    const all = loadReviews();
    const open = all.find((r) => !r.finishedAt);
    if (open) return open;
    const items: ReviewItem[] = [
      ...(people.enabled() ? people.list() : []).map((p): ReviewItem => ({ id: `person:${p.id}`, kind: "person", name: p.name, has: `${ROLE_WORDS[p.role].name}. ${ROLE_WORDS[p.role].may}${p.secondStep ? "" : " No second step at sign-in."}${p.lastSignIn ? ` Last signed in ${p.lastSignIn.slice(0, 10)}.` : " Has never signed in."}`, decision: null, note: "" })),
      ...graphsOf(org).map((g): ReviewItem => ({
        id: `agent:${g.agent.id}`,
        kind: "agent",
        name: g.agent.title,
        has: `${g.approvals === "ask" ? "Asks before changes." : "Runs changes without asking."} Can: ${g.powers.map((p) => p.words).join(", ") || "only talk"}. Library: ${g.library.documents} documents. Workspace: ${g.workspace.read} pages${g.workspace.changeDirectly.length ? `, changes ${g.workspace.changeDirectly.length} directly` : ""}.${g.connectors.length ? ` Connected services: ${g.connectors.join(", ")}.` : ""}${g.keys.length ? ` Keys: ${g.keys.map((k) => k.name).join(", ")}.` : ""}`,
        decision: null,
        note: "",
      })),
    ];
    const review: Review = { id: newId(), startedAt: new Date().toISOString(), startedBy: by, finishedAt: null, items };
    writeJson(reviewFile(), [...all, review]);
    audit({ actor: "system", actorName: by, kind: "security", action: "Started an access review", detail: `${items.filter((i) => i.kind === "person").length} people, ${items.filter((i) => i.kind === "agent").length} agents` });
    return review;
  },
  /** Records the answer for one line. */
  decide(id: string, item: string, decision: unknown, note: unknown): Review {
    const all = loadReviews();
    const review = all.find((r) => r.id === id);
    const line = review?.items.find((i) => i.id === item);
    if (!review || !line) throw new Error("There is no such line in that review.");
    if (review.finishedAt) throw new Error("That review is finished.");
    line.decision = decision === "keep" || decision === "change" ? decision : null;
    line.note = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    writeJson(reviewFile(), all);
    return review;
  },
  /** Finishes a review once every line has an answer. Changing access itself is done by the reviewer, on the usual pages. */
  finish(id: string, by: string): Review {
    const all = loadReviews();
    const review = all.find((r) => r.id === id);
    if (!review) throw new Error("There is no such review.");
    const left = review.items.filter((i) => !i.decision).length;
    if (left) throw new Error(`${left} line${left === 1 ? " still needs" : "s still need"} an answer.`);
    review.finishedAt = new Date().toISOString();
    writeJson(reviewFile(), all);
    audit({ actor: "system", actorName: by, kind: "security", action: "Finished an access review", detail: `${review.items.filter((i) => i.decision === "keep").length} kept as they are, ${review.items.filter((i) => i.decision === "change").length} to change` });
    return review;
  },
};
