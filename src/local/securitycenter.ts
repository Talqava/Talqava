// The Security center: one view of which protections are on, what needs attention, and a report the owner can hand
// to an auditor. It only reads what the other parts already know; it sets nothing.
import { getConfig } from "./store.ts";
import { people } from "./people.ts";
import { describeGuardrails, guardrails } from "./guardrails.ts";
import { LEVELS, LEVEL_WORDS, WHERE_WORDS, policy } from "./sensitivity.ts";
import { verifyAudit } from "./audit.ts";
import { isLocalRef } from "./gateway.ts";
import { REVIEW_EVERY_DAYS, reviews } from "./auditfeed.ts";
import { orgs } from "./orgs.ts";

const orgHasAgents = () => {
  try {
    return orgs.active().members.length > 0;
  } catch {
    return false;
  }
};

export interface Protection {
  id: string;
  name: string;
  /** "on", "partly" or "off". */
  state: "on" | "partly" | "off";
  /** What it protects against, and where it stands, in plain words. */
  words: string;
  /** What to do, when it is not fully on. */
  next?: string;
}

export function securityOverview(): { protections: Protection[]; attention: { level: "high" | "soon"; words: string; next: string }[]; on: number; of: number } {
  const cfg = getConfig();
  const list = people.enabled() ? people.list() : [];
  const settings = people.settings();
  const g = guardrails();
  const p = policy(cfg);
  const seal = verifyAudit();
  const cloud = !isLocalRef(cfg.model) || (cfg.backups ?? []).some((b) => !isLocalRef(b));
  const withoutStep = list.filter((x) => !x.secondStep);
  const limited = LEVELS.filter((l) => p.services[l] !== "any");
  const protections: Protection[] = [
    {
      id: "people",
      name: "Each person signs in",
      state: people.enabled() ? "on" : "off",
      words: people.enabled() ? `${list.length} ${list.length === 1 ? "person has" : "people have"} their own sign-in and role. What each may do is enforced by the app.` : "Anyone who can use this computer can open Talqava and do everything. Fine for one owner on their own computer; not for a team.",
      next: people.enabled() ? undefined : "Turn on people and sign-in below.",
    },
    {
      id: "second-step",
      name: "A second step at sign-in",
      state: !people.enabled() ? "off" : settings.requireSecondStep && !withoutStep.length ? "on" : list.some((x) => x.secondStep) || settings.requireSecondStep ? "partly" : "off",
      words: !people.enabled() ? "Needs people and sign-in first." : withoutStep.length ? `${withoutStep.length} of ${list.length} ${list.length === 1 ? "person signs" : "people sign"} in with a password alone. A stolen password would be enough.` : "Everyone signs in with a password and a code from their phone.",
      next: !people.enabled() ? "Turn on people and sign-in first." : !settings.requireSecondStep ? "Tick “Require a second step for everyone” below." : withoutStep.length ? "They are asked to set it up the next time they sign in." : undefined,
    },
    {
      id: "sensitivity",
      name: "Sensitive information stays where you allow",
      state: !cloud ? "on" : limited.length >= 2 ? "on" : limited.length ? "partly" : "off",
      words: !cloud ? "Your agents run on models on this computer, so nothing is sent to an outside AI service." : limited.length ? `${limited.map((l) => LEVEL_WORDS[l].name).join(" and ")} ${limited.length === 1 ? "is" : "are"} limited in where ${limited.length === 1 ? "it" : "they"} may be sent.` : "Every level, including Restricted, may be sent to any connected AI service.",
      next: cloud && limited.length < 2 ? "Under “Sensitive information”, press “Use the recommended settings”." : undefined,
    },
    {
      id: "masking",
      name: "Personal details are masked",
      state: !cloud || cfg.privacy === "mask" ? "on" : "off",
      words: !cloud ? "Nothing leaves this computer." : cfg.privacy === "mask" ? "Email addresses, phone numbers, card numbers and the like are swapped for stand-ins before they reach an AI service." : "Personal details in your text are sent to AI services as they are.",
      next: cloud && cfg.privacy !== "mask" ? "Turn on privacy under Settings." : undefined,
    },
    {
      id: "changes",
      name: "Agents ask before they change things",
      state: g.changes === "ask" ? "on" : cfg.approvalMode === "ask" ? "partly" : "off",
      words: g.changes === "ask" ? "Every change by any agent asks a person first, whatever the agent's own setting." : cfg.approvalMode === "ask" ? "Agents ask by default, but an agent set to run without asking does not." : "Agents run changes without asking.",
      next: g.changes === "ask" ? undefined : "Under “Agent guardrails”, set changes to “Always ask a person first”.",
    },
    {
      id: "web",
      name: "Agents are held to approved websites",
      state: g.web === "never" || (g.web === "approved" && g.sites.length > 0) ? "on" : "off",
      words: g.web === "never" ? "Agents may not use the web." : g.web === "approved" ? (g.sites.length ? `Agents may open only ${g.sites.length} approved site${g.sites.length === 1 ? "" : "s"}.` : "Only approved sites are allowed and none is listed, so the web is off.") : "Agents with the web power may open any site.",
      next: g.web === "any" ? "Under “Agent guardrails”, set the web to approved sites." : undefined,
    },
    {
      id: "caps",
      name: "Spending is capped",
      state: g.maxTaskSpend !== undefined && cfg.monthlyBudget ? "on" : g.maxTaskSpend !== undefined || cfg.monthlyBudget ? "partly" : "off",
      words: `${g.maxTaskSpend !== undefined ? `No task may spend more than $${g.maxTaskSpend}.` : "No organization-wide cap on a task."} ${cfg.monthlyBudget ? `All agents together may spend $${cfg.monthlyBudget} a month.` : "No monthly limit for all agents together."}`,
      next: g.maxTaskSpend === undefined ? "Set “Most one task may spend” under “Agent guardrails”." : cfg.monthlyBudget ? undefined : "Set a monthly limit under Settings.",
    },
    {
      id: "audit",
      name: "The record of who did what is intact",
      state: seal.intact ? "on" : "off",
      words: seal.intact ? `${seal.checked.toLocaleString("en-US")} sealed entries checked just now: none changed, removed or added by hand.` : `The audit record does not match its seals. ${seal.problem?.why ?? ""}`,
      next: seal.intact ? undefined : "Open the Audit log to see where.",
    },
  ];
  const attention: { level: "high" | "soon"; words: string; next: string }[] = [];
  if (!seal.intact) attention.push({ level: "high", words: "The audit record was changed outside Talqava.", next: "Open the Audit log." });
  const admins = list.filter((x) => (x.role === "owner" || x.role === "admin") && !x.secondStep);
  if (admins.length) attention.push({ level: "high", words: `${admins.length} owner or administrator account${admins.length === 1 ? " signs" : "s sign"} in without a second step. A stolen password alone would give full control.`, next: "Set up a second step, then require it for everyone." });
  if (p.services.confidential === "approved" && !p.approved.length && cloud) attention.push({ level: "soon", words: "Confidential items may go only to approved AI services, and none is approved, so agents on outside services cannot read them.", next: "Tick the services you trust under “Sensitive information”." });
  const locked = list.filter((x) => x.locked);
  if (locked.length) attention.push({ level: "soon", words: `${locked.length} account${locked.length === 1 ? " is" : "s are"} locked after wrong passwords.`, next: "If that was not the person themselves, set a new password for them." });
  const review = reviews.due();
  if (review.overdue && (people.enabled() || orgHasAgents())) attention.push({ level: "soon", words: review.last ? `The last access review was finished on ${review.last.slice(0, 10)}; one is due every ${REVIEW_EVERY_DAYS} days.` : "No access review has been done yet.", next: "Start one under “Access reviews”." });
  return { protections, attention, on: protections.filter((x) => x.state === "on").length, of: protections.length };
}

/** A plain report of the security settings in force, for the owner's records or an auditor. Not a certificate. */
export function securityReport(now = new Date()): string {
  const o = securityOverview();
  const cfg = getConfig();
  const p = policy(cfg);
  const list = people.enabled() ? people.list() : [];
  const lines = [
    "# Talqava security settings report",
    "",
    `Made on ${now.toISOString().slice(0, 10)}. This report states the settings in force on this installation. It supports an audit; it is not a certificate or an assessment by a third party.`,
    "",
    "## Summary",
    "",
    `${o.on} of ${o.of} protections are fully on.`,
    "",
    ...o.protections.map((x) => `- **${x.name}: ${x.state === "on" ? "on" : x.state === "partly" ? "partly on" : "off"}.** ${x.words}`),
    "",
    "## People and access",
    "",
    people.enabled() ? `${list.length} accounts. By role: ${["owner", "admin", "manager", "member", "auditor"].map((r) => `${r} ${list.filter((x) => x.role === r).length}`).join(", ")}. Second step on for ${list.filter((x) => x.secondStep).length} of ${list.length}. Sessions end after ${people.settings().idleMinutes} minutes without activity. Accounts lock for 15 minutes after 5 wrong passwords. Passwords are stored only as a scrypt-stretched value.` : "People and sign-in are not turned on: the installation trusts whoever uses the computer it runs on.",
    "",
    "## Sensitive information",
    "",
    ...LEVELS.map((l) => `- ${LEVEL_WORDS[l].name}: ${WHERE_WORDS[p.services[l]]}.`),
    `- Approved AI services: ${p.approved.length ? p.approved.join(", ") : "none"}.`,
    `- Memory counts as ${LEVEL_WORDS[p.memory].name}.`,
    `- Masking of personal details before text reaches an AI service: ${cfg.privacy === "mask" ? "on" : "off"}.`,
    "",
    "## Rules for agents",
    "",
    ...describeGuardrails().map((w) => `- ${w}`),
    "",
    "## Audit record",
    "",
    ((v) => (v.intact ? `Intact when this report was made: ${v.checked} sealed entries checked, ${v.unsealed} older entries from before sealing.` : `NOT intact when this report was made: ${v.problem?.why ?? ""}`))(verifyAudit()),
    "",
    "## Needs attention",
    "",
    ...(o.attention.length ? o.attention.map((a) => `- ${a.words} ${a.next}`) : ["Nothing flagged."]),
    "",
  ];
  return lines.join("\n");
}
