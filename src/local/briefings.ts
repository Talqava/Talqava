// Briefings: ready-made reports an agent sends to the owner's Inbox. A briefing is a routine that is already
// written: the owner switches it on with one press and, at most, one answer. Two kinds. One an agent researches
// with the AI model and the web (morning news); the agent's report is the briefing. The other is put together here
// from the organization's own tasks (the Monday plan, the Friday wrap-up), so it uses no AI model and costs nothing.
import type { Job } from "../core/types.ts";
import type { Org } from "./orgs.ts";
import { loadCrew } from "./crew.ts";
import { getConfig, saveConfig } from "./store.ts";
import { work, type WorkItem } from "./work.ts";

export interface BriefingDef {
  id: string;
  name: string;
  group: "The outside world" | "Your own work";
  /** One line: what the owner gets. */
  about: string;
  /** "ai": an agent researches it with the AI model. "free": built here from the organization's tasks. */
  kind: "ai" | "free";
  /** The usual time, as the routine's timing, and the same in words. */
  schedule: string;
  when: string;
  /** The one thing the owner may be asked. */
  ask?: { label: string; placeholder: string };
  /** Abilities the sending agent needs; switched on for it when the briefing is. */
  powers: string[];
  /** Departments whose people suit it, best first; anyone else when none is on the chart. */
  suits: string[];
  /** What the agent is told each time. {topic} is the owner's answer. */
  prompt?: string;
}

const NO_INVENTING = "Every item must come from a page you read today: never invent a story, a figure or a link. Change nothing and send nothing; this is a report for the owner only.";

export const BRIEFINGS: BriefingDef[] = [
  {
    id: "morning-news",
    name: "Morning news",
    group: "The outside world",
    about: "The stories that matter for your business, two lines each, with links.",
    kind: "ai",
    schedule: "0 8 * * 1-5",
    when: "Weekdays at 8:00",
    ask: { label: "What should it watch?", placeholder: "e.g. Bakeries, cafés and food prices in the UK" },
    powers: ["web"],
    suits: ["Research", "Marketing", "Leadership", "Operations"],
    prompt: `Write this morning's news briefing for the owner. Watch: {topic}.\n\nSearch the web for news from the last two days (the last week if there is little). Choose up to five stories that matter most to this organization, given its mission. For each one write: the headline in bold; two short lines on what happened and why it matters to us; and the source as a link. Put the most important first. If nothing worth the owner's time happened, say so in one line instead of filling the list.\n\n${NO_INVENTING} Your report is the briefing itself: start with the first story, with no introduction.`,
  },
  {
    id: "competitor-watch",
    name: "Competitor watch",
    group: "The outside world",
    about: "What changed at your competitors this week: prices, products, news.",
    kind: "ai",
    schedule: "0 8 * * 1",
    when: "Mondays at 8:00",
    ask: { label: "Which competitors?", placeholder: "e.g. Corner Bakery (cornerbakery.example), Daily Bread" },
    powers: ["web"],
    suits: ["Research", "Marketing", "Sales", "Leadership"],
    prompt: `Write this week's competitor briefing for the owner. The competitors: {topic}.\n\nFor each competitor, look at their website and recent news on the web. Report only what is new or changed in about the last week: prices, products or services, opening hours or locations, offers, hiring, and news about them. For each competitor write its name in bold, then up to three short points, each with the page it came from as a link. If you find nothing new for one, say "nothing new this week" for it.\n\n${NO_INVENTING} If you cannot tell whether something is new, say so. Your report is the briefing itself, with no introduction.`,
  },
  {
    id: "rules-deadlines",
    name: "Rules and deadlines",
    group: "The outside world",
    about: "Tax dates, filings and rule changes coming up for your kind of business.",
    kind: "ai",
    schedule: "0 8 * * 1",
    when: "Mondays at 8:00",
    ask: { label: "What kind of business, and where?", placeholder: "e.g. A limited company running a café in England" },
    powers: ["web"],
    suits: ["Finance", "Legal", "Operations", "Leadership"],
    prompt: `Write this week's rules and deadlines briefing for the owner. The business: {topic}.\n\nSearch official sources on the web (the tax authority, the companies registry, regulators for this kind of business). List: deadlines in the next 45 days (what is due, the date, and who it applies to), and rule changes announced or taking effect soon that would apply to this business. For each one give the official page as a link. Put the nearest date first.\n\n${NO_INVENTING} Give dates exactly as the official page states them, and say plainly that this is a reminder, not legal or tax advice, and that the owner should confirm with their accountant. Your report is the briefing itself, with no introduction.`,
  },
  {
    id: "monday-plan",
    name: "Monday plan",
    group: "Your own work",
    about: "What is under way, what is waiting on you and what is next, at the start of the week.",
    kind: "free",
    schedule: "0 8 * * 1",
    when: "Mondays at 8:00",
    powers: [],
    suits: ["Leadership", "Operations"],
  },
  {
    id: "friday-wrap",
    name: "Friday wrap-up",
    group: "Your own work",
    about: "What got done this week and what carries over to the next.",
    kind: "free",
    schedule: "0 16 * * 5",
    when: "Fridays at 4:00 pm",
    powers: [],
    suits: ["Leadership", "Operations"],
  },
];

/** Briefings that are planned and not built: each needs a connected service. Shown so nobody has to wonder. */
export const PLANNED_BRIEFINGS = ["Overdue invoices (with Xero)", "Yesterday's sales (with Square or Shopify)", "Inbox triage (with Gmail)", "Unanswered customers (with Zendesk or Freshdesk)", "Meeting prep (with Google Calendar)"];

export const briefingOf = (id: unknown): BriefingDef | undefined => BRIEFINGS.find((b) => b.id === id);

/** Who sends a briefing: someone from a department that suits it, a lead before others; else the first position. */
export function senderFor(def: BriefingDef, org: Org): { bot: string; title: string } | null {
  const crew = new Set(loadCrew().bots.map((b) => b.id));
  const members = org.members.filter((m) => crew.has(m.bot));
  const leads = new Set((org.groups ?? []).map((g) => g.lead));
  for (const dept of def.suits) {
    const inDept = members.filter((m) => m.department.toLowerCase().includes(dept.toLowerCase()));
    const pick = inDept.find((m) => leads.has(m.bot)) ?? inDept[0];
    if (pick) return { bot: pick.bot, title: pick.title };
  }
  return members[0] ? { bot: members[0].bot, title: members[0].title } : null;
}

/** What the agent is told for one run. The owner's answer is cut to a line, so it cannot carry instructions of its own. */
export function briefingPrompt(def: BriefingDef, topic: string): string {
  const said = String(topic ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "this organization's own industry and market, as its mission describes";
  return (def.prompt ?? "").replace("{topic}", said);
}

// ---------- the briefings built from the organization's own tasks ----------
export interface Digest {
  id: string;
  name: string;
  at: string;
  text: string;
}
const line = (t: WorkItem) => `- #${t.number} ${t.title} (${t.ownerName})${t.attention?.words ? `: ${t.attention.words}` : t.detail ? `: ${t.detail}` : ""}`;
const part = (title: string, items: WorkItem[], none: string, most = 12) => `**${title}**\n${items.length ? `${items.slice(0, most).map(line).join("\n")}${items.length > most ? `\n- and ${items.length - most} more` : ""}` : none}`;

/** Builds a free briefing's text from the tasks as they stand. */
export function buildDigest(def: BriefingDef, org: Org, now = new Date()): string {
  const items = work.list(org).filter((t) => t.status !== "cancelled" && !t.parent);
  const waiting = items.filter((t) => t.status === "review" || t.status === "waiting" || t.status === "blocked" || t.attention);
  const working = items.filter((t) => t.status === "working" && !waiting.includes(t));
  const next = items.filter((t) => t.status === "todo").sort((a, b) => (a.queue ?? 99) - (b.queue ?? 99));
  if (def.id === "friday-wrap") {
    // This week: since Monday morning.
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).toISOString();
    const done = items.filter((t) => t.status === "done" && t.updatedAt >= monday);
    const open = items.filter((t) => t.status !== "done");
    return [`${done.length} task${done.length === 1 ? "" : "s"} finished this week; ${open.length} carr${open.length === 1 ? "ies" : "y"} over.`, part("Finished this week", done, "Nothing was finished this week."), part("Still waiting on you", waiting, "Nothing is waiting on you."), part("Carries over to next week", open.filter((t) => !waiting.includes(t)), "Nothing carries over.")].join("\n\n");
  }
  return [`${working.length} under way, ${waiting.length} waiting on you or stuck, ${next.length} up next.`, part("Waiting on you, or stuck", waiting, "Nothing is waiting on you."), part("Under way", working, "Nothing is under way."), part("Up next", next, "Nothing is queued. Give your team something on New.", 8)].join("\n\n");
}

/** The latest free briefings, newest first, as the Inbox shows them. One of each kind is kept. */
export const digests = (): Digest[] => Object.values(getConfig().digests ?? {}).sort((a, b) => b.at.localeCompare(a.at));

/** Runs a free briefing: builds it and keeps it for the Inbox, replacing the last one of its kind. */
export function runDigest(def: BriefingDef, org: Org, now = new Date()): Digest {
  const digest: Digest = { id: def.id, name: def.name, at: now.toISOString(), text: buildDigest(def, org, now) };
  saveConfig({ digests: { ...(getConfig().digests ?? {}), [def.id]: digest } });
  return digest;
}
export function forgetDigest(id: string): void {
  const { [id]: _gone, ...rest } = getConfig().digests ?? {};
  saveConfig({ digests: rest });
}

/** The gallery: every briefing with whether it is on, who sends it and what it would switch on. */
export function listBriefings(org: Org, jobList: Job[]) {
  const crew = new Map(loadCrew().bots.map((b) => [b.id, b]));
  return BRIEFINGS.map((def) => {
    const job = jobList.find((j) => j.briefing === def.id && (!j.org || j.org === org.id)) ?? null;
    const sender = job?.owner ? { bot: job.owner, title: org.members.find((m) => m.bot === job.owner)?.title ?? "A position no longer on the chart" } : senderFor(def, org);
    const lacks = sender ? def.powers.filter((p) => !((crew.get(sender.bot)?.powers ?? []) as string[]).includes(p)) : [];
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      about: def.about,
      kind: def.kind,
      when: def.when,
      ask: def.ask ? { ...def.ask, value: job?.topic ?? "" } : null,
      sender,
      // Abilities switching it on would give the sender.
      grants: lacks,
      on: job ? { job: job.id, enabled: job.enabled, nextRunAt: job.nextRunAt, lastRunAt: job.lastRunAt, lastTaskId: job.lastTaskId ?? null } : null,
    };
  });
}
