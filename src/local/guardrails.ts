// Agent guardrails: rules for the whole installation that sit above every agent's own settings. An agent, a manager
// or a task can make things stricter than these, never looser. They are applied in one place, to every run, just
// before it starts: tools the rules forbid are taken away, web tools are held to the approved sites, changes ask a
// person when the rules say so, and spending and time are capped. Each refusal is written to the audit log.
import type { RunSpec, Tool } from "../core/index.ts";
import { getConfig } from "./store.ts";
import { audit } from "./audit.ts";
import { webRules } from "../core/tools/page.ts";
import { spentToday } from "./spend.ts";

// ---------- an agent that keeps getting stuck ----------
const stuck = new Map<string, number[]>();
/**
 * Notes that one of an agent's runs was stopped for going round in circles or failing at every step. Returns true
 * when that has now happened as often within an hour as the rule allows, so the agent should be paused.
 */
export function noteStuck(agent: string, now = Date.now(), g: Guardrails = guardrails()): boolean {
  if (g.pauseAfter === undefined) return false;
  const times = [...(stuck.get(agent) ?? []).filter((t) => now - t < 3_600_000), now];
  stuck.set(agent, times.length < g.pauseAfter ? times : []);
  return times.length >= g.pauseAfter;
}

export interface Guardrails {
  /** "agent": each agent's own setting decides whether changes ask first. "ask": every change asks a person, always. */
  changes: "agent" | "ask";
  /** Running commands on this computer: as each agent is set up, always ask first, or never. */
  commands: "allowed" | "ask" | "never";
  /** Tools of connected services (connectors): allowed (they ask before changing anything), only the approved ones, or never. */
  connectors: "allowed" | "approved" | "never";
  /** The approved connected services, by the name their tools start with ("stripe", "gmail", "wordpress"). */
  services: string[];
  /** The web: any site, only the approved sites, or never. */
  web: "any" | "approved" | "never";
  /** The approved sites, as host names ("example.com" also covers "www.example.com"). */
  sites: string[];
  /** The most one task may spend, in US dollars, whatever its agent's budget says. */
  maxTaskSpend?: number;
  /** The longest one task may run, in minutes. */
  maxMinutes?: number;
  /** The most every agent's tasks together may spend in one day, in US dollars. Reached, no run starts until tomorrow. */
  maxDaySpend?: number;
  /** Deleting in a connected service: ask a person first (as always), or never. */
  deletes: "ask" | "never";
  /** Pause an agent whose runs were stopped for being stuck this many times within an hour. Left out: never. */
  pauseAfter?: number;
  /** The Marketplace: anything may be added, or only the items an owner or administrator approved. */
  market: "any" | "approved";
  /** The approved Marketplace items: an agent's id, "team:<id>" for a team, "kit:<id>" for a template or playbook. */
  listings: string[];
  /** Per kind of step an agent asks to take: who may say yes, and whether two people must. Empty: as before. */
  approvers: Partial<Record<StepKind, StepRule>>;
}
/** The kinds of step these rules tell apart. */
export const STEP_KINDS = ["send", "delete", "change", "command"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_WORDS: Record<StepKind, string> = {
  send: "Sending something to someone outside (an email, a reply to a customer, publishing on your website, data to a web address)",
  delete: "Deleting something in a connected service",
  change: "Changing something in a connected service",
  command: "Running a command on this computer",
};
export interface StepRule {
  /** The people who may approve, by id. Empty: anyone who may approve today. */
  people: string[];
  /** Whether two different people must approve. */
  two: boolean;
}

export const NO_GUARDRAILS: Guardrails = { changes: "agent", commands: "allowed", connectors: "allowed", services: [], web: "any", sites: [], deletes: "ask", market: "any", listings: [], approvers: {} };

/** The guardrails in force. */
export const guardrails = (): Guardrails => guardrailsFrom(getConfig().guardrails ?? {});

/** A host name from what the owner typed: "https://www.Example.com/page" → "example.com". */
export function cleanSite(text: unknown): string {
  const t = String(text ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^(\*\.|www\.)/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(t) ? t : "";
}

/** Guardrails as given by the settings page, checked. Unknown values fall back to the least strict. */
export function guardrailsFrom(input: unknown, before: Guardrails = NO_GUARDRAILS): Guardrails {
  const g = (input ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], was: T): T => (allowed.includes(v as T) ? (v as T) : was);
  const amount = (v: unknown, was: number | undefined, max: number) => (v === undefined ? was : v === null || v === "" ? undefined : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Number(v), max) : was);
  const sites = g.sites === undefined ? before.sites : [...new Set((Array.isArray(g.sites) ? g.sites : String(g.sites).split(/[\s,]+/)).map(cleanSite).filter(Boolean))].slice(0, 500);
  return {
    changes: pick(g.changes, ["agent", "ask"] as const, before.changes),
    commands: pick(g.commands, ["allowed", "ask", "never"] as const, before.commands),
    connectors: pick(g.connectors, ["allowed", "approved", "never"] as const, before.connectors),
    services: g.services === undefined ? before.services : [...new Set((Array.isArray(g.services) ? g.services : []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9_.-]{0,80}$/.test(x)))].slice(0, 200),
    web: pick(g.web, ["any", "approved", "never"] as const, before.web),
    sites,
    maxTaskSpend: amount(g.maxTaskSpend, before.maxTaskSpend, 100_000),
    maxMinutes: amount(g.maxMinutes, before.maxMinutes, 24 * 60),
    maxDaySpend: amount(g.maxDaySpend, before.maxDaySpend, 1_000_000),
    deletes: pick(g.deletes, ["ask", "never"] as const, before.deletes ?? "ask"),
    market: pick(g.market, ["any", "approved"] as const, before.market ?? "any"),
    // The whole list can be given, or one item approved (approveListing) or taken off (removeListing).
    listings: [...new Set([...(g.listings === undefined ? (before.listings ?? []) : Array.isArray(g.listings) ? g.listings : []), ...(g.approveListing ? [g.approveListing] : [])].map((x) => String(x).trim().toLowerCase()).filter((x) => /^((team|kit):)?[a-z0-9][a-z0-9_-]{0,80}$/.test(x) && x !== String(g.removeListing ?? "").trim().toLowerCase()))].slice(0, 1000),
    approvers: ((given) => {
      if (given === undefined || given === null || typeof given !== "object") return before.approvers ?? {};
      const out: Guardrails["approvers"] = { ...(before.approvers ?? {}) };
      for (const kind of STEP_KINDS) {
        const r = (given as Record<string, { people?: unknown; two?: unknown } | null>)[kind];
        if (r === undefined) continue;
        const was = out[kind] ?? { people: [], two: false };
        const rule = { people: r?.people === undefined ? was.people : [...new Set((Array.isArray(r.people) ? r.people : []).map(String).filter((x) => /^[\w-]{1,60}$/.test(x)))].slice(0, 50), two: r?.two === undefined ? was.two : r.two === true };
        if (r === null || (!rule.people.length && !rule.two)) delete out[kind];
        else out[kind] = rule;
      }
      return out;
    })(g.approvers),
    pauseAfter: ((n) => (n === undefined ? undefined : Math.max(2, Math.round(n))))(amount(g.pauseAfter, before.pauseAfter, 50)),
  };
}

/** Whether an address is on an approved site. */
export function siteAllowed(address: unknown, sites: string[]): boolean {
  let host: string;
  try {
    host = new URL(String(address)).hostname.toLowerCase();
  } catch {
    return false;
  }
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

const WEB_TOOLS = new Set(["read_page", "http_request", "browser"]);
const HOSTED_WEB_TOOLS = new Set(["web_search", "web_fetch"]);
/** A connector's tools are named "<connector>__<tool>". */
const isConnectorTool = (t: Tool) => t.name.includes("__");

/** A web tool held to the approved sites: an address elsewhere is refused before anything is fetched. */
function onApprovedSites(tool: Tool, sites: string[], who: string): Tool {
  return {
    ...tool,
    run(input: any, context: any) {
      const address = input?.url;
      // The browser's later steps (read, click, type) act on the page it already opened, which was checked then.
      if (address !== undefined && address !== "" && !siteAllowed(address, sites)) {
        const host = (() => {
          try {
            return new URL(String(address)).hostname;
          } catch {
            return String(address).slice(0, 80);
          }
        })();
        audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, action: `Refused: ${who} tried to open a site that is not approved`, detail: host });
        throw new Error(`${host} is not one of the sites this organization approves, so it was not opened. Do not try another way to reach it. Carry on with the approved sites, and say in your report that this one was refused.`);
      }
      return tool.run(input, context);
    },
  } as Tool;
}

/**
 * Applies the guardrails to a run that is about to start. `who` names the agent, for the audit log. With no
 * guardrails set, the run is returned unchanged.
 */
export function guard(spec: RunSpec, who: string, g: Guardrails = guardrails()): RunSpec {
  // The organization's daily limit: once today's tasks have spent it, nothing starts until tomorrow or a higher limit.
  const leftToday = g.maxDaySpend !== undefined ? g.maxDaySpend - spentToday() : Infinity;
  if (leftToday <= 0) {
    audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, action: `Refused: ${who} did not start, because today's spending limit is reached`, detail: `$${g.maxDaySpend} a day` });
    throw new Error(`This organization's spending limit for today ($${g.maxDaySpend}) is reached, so nothing more starts today. The owner can raise it under Security › Agent guardrails, or work carries on tomorrow.`);
  }
  // Page reading follows redirects itself, so it is told the rule too and checks every hop.
  webRules.allowed = g.web === "approved" ? (host) => g.sites.some((s) => host.toLowerCase() === s || host.toLowerCase().endsWith(`.${s}`)) : null;
  let tools = spec.tools;
  let hosted = spec.hostedTools;
  const alwaysAsk = new Set(spec.alwaysAsk ?? []);
  const taken: string[] = [];

  if (g.commands === "never" && tools.some((t) => t.name === "bash")) {
    tools = tools.filter((t) => t.name !== "bash");
    taken.push("running commands");
  } else if (g.commands === "ask") {
    tools = tools.map((t) => (t.name === "bash" ? ({ ...t, needsApproval: () => true } as Tool) : t));
    alwaysAsk.add("bash");
  }
  if (g.connectors === "never" && tools.some(isConnectorTool)) {
    tools = tools.filter((t) => !isConnectorTool(t));
    taken.push("connected services");
  } else if (g.connectors === "approved") {
    // Only services on the approved list keep their tools. With none approved, connected services are off.
    const ok = (t: Tool) => g.services.includes(t.name.split("__")[0].toLowerCase());
    const off = [...new Set(tools.filter((t) => isConnectorTool(t) && !ok(t)).map((t) => t.name.split("__")[0]))];
    if (off.length) {
      tools = tools.filter((t) => !isConnectorTool(t) || ok(t));
      taken.push(`connected services that are not approved (${off.join(", ")})`);
    }
  }
  if (g.deletes === "never" && tools.some((t) => (t as { deletes?: boolean }).deletes)) {
    tools = tools.filter((t) => !(t as { deletes?: boolean }).deletes);
    taken.push("deleting things in connected services");
  }
  if (g.web === "never" || (g.web === "approved" && !g.sites.length)) {
    if (tools.some((t) => WEB_TOOLS.has(t.name)) || hosted.some((t) => HOSTED_WEB_TOOLS.has((t as { name?: string }).name ?? ""))) taken.push("the web");
    tools = tools.filter((t) => !WEB_TOOLS.has(t.name));
    hosted = hosted.filter((t) => !HOSTED_WEB_TOOLS.has((t as { name?: string }).name ?? ""));
  } else if (g.web === "approved") {
    tools = tools.map((t) => (WEB_TOOLS.has(t.name) ? onApprovedSites(t, g.sites, who) : t));
    // The AI service's own web search and page reader are told the same list, so they stay on it too.
    hosted = hosted.map((t) => (HOSTED_WEB_TOOLS.has((t as { name?: string }).name ?? "") ? ({ ...t, allowed_domains: g.sites.slice(0, 100) } as typeof t) : t));
  }
  if (g.changes === "ask") alwaysAsk.add("*");

  const cap = Math.min(g.maxTaskSpend ?? Infinity, leftToday);
  const budget = cap !== Infinity ? { ...spec.budget, spend: Math.min(spec.budget?.spend ?? Infinity, cap) } : spec.budget;
  const limits = g.maxMinutes !== undefined ? { ...spec.limits, minutes: Math.min(spec.limits?.minutes ?? Infinity, g.maxMinutes) } : spec.limits;
  const note = taken.length ? `\n\n# Rules of this organization\n\nThis organization does not let agents use: ${taken.join(", ")}. Those tools are not available to you. Do not look for another way to do the same thing; do what you can without them and say plainly in your report what you could not do.` : "";
  const sitesNote = g.web === "approved" && g.sites.length ? `\n\n# Approved sites\n\nYou may only open these sites and their pages: ${g.sites.slice(0, 60).join(", ")}${g.sites.length > 60 ? " and others" : ""}. Any other address is refused.` : "";

  return {
    ...spec,
    tools,
    hostedTools: hosted,
    system: `${spec.system}${note}${sitesNote}`,
    approvalMode: g.changes === "ask" ? "ask" : spec.approvalMode,
    ...(alwaysAsk.size ? { alwaysAsk: [...alwaysAsk] } : {}),
    ...(budget ? { budget } : {}),
    ...(limits ? { limits } : {}),
  };
}

/**
 * Whether a Marketplace item may be added. When only approved items may, and this one is not approved, the refusal
 * is written down and false is returned.
 */
export function marketAllowed(key: string, g: Guardrails = guardrails()): boolean {
  if (g.market !== "approved" || g.listings.includes(key.toLowerCase())) return true;
  audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, action: "Refused: a Marketplace item that is not approved was not added", detail: key });
  return false;
}

// ---------- who may approve a step ----------
/** The kind of step a tool call is, for the approver rules; nothing for steps those rules do not cover. */
export function stepKind(name: string, input: unknown, kitKind: (name: string) => "read" | "change" | "send" | "delete" | null): StepKind | null {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "bash") return "command";
  if (name === "http_request") return ["GET", "HEAD"].includes(String(i.method ?? "GET").toUpperCase()) ? null : "send";
  if (name === "wordpress__publish") return "send";
  if (!name.includes("__")) return null;
  const kind = kitKind(name);
  // A tool of a connector added from outside is another company's service: using it changes something there.
  return kind === "read" ? null : (kind ?? "change");
}

const firstYes = new Map<string, { person: string; name: string; at: number }>();
export type StepDecision = { go: true; decision: "allow" | "always" | "deny" } | { go: false; message: string };
/**
 * Applies the approver rule to one person's answer to a step. `go` says whether the step may now be answered; when it
 * is false the answer was noted and another person is needed. Throws when this person may not approve this kind.
 * `known` are the ids of people who still have an account (a named approver who has left is not waited for).
 */
export function decideStep(key: string, kind: StepKind | null, person: { id: string; name: string } | null, decision: "allow" | "always" | "deny", known: string[], g: Guardrails = guardrails()): StepDecision {
  const rule = kind ? g.approvers[kind] : undefined;
  // With nobody signed in (people are not set up) there is one owner, and no second person to ask.
  if (!rule || !person) return { go: true, decision };
  const named = rule.people.filter((id) => known.includes(id));
  if (named.length && !named.includes(person.id)) throw Object.assign(new Error("This organization's rules name who may approve this kind of step, and you are not one of them."), { forbidden: true });
  if (decision === "deny") {
    firstYes.delete(key);
    return { go: true, decision };
  }
  // A step with named approvers or two people is approved each time, never "always".
  if (!rule.two) return { go: true, decision: "allow" };
  for (const [k, v] of firstYes) if (Date.now() - v.at > 86_400_000) firstYes.delete(k);
  const first = firstYes.get(key);
  if (!first) {
    firstYes.set(key, { person: person.id, name: person.name, at: Date.now() });
    return { go: false, message: "Noted. This kind of step needs two people, so it waits for a second person to approve it." };
  }
  if (first.person === person.id) return { go: false, message: "You already approved this. It waits for a different person." };
  firstYes.delete(key);
  return { go: true, decision: "allow" };
}
/** Who has already said yes to a step that needs two people, for the screen. */
export const firstApprover = (key: string): string | null => firstYes.get(key)?.name ?? null;

/** The guardrails in plain words, for the Security page and reports. */
export function describeGuardrails(g: Guardrails = guardrails()): string[] {
  return [
    g.changes === "ask" ? "Every change an agent wants to make asks a person first." : "Each agent's own setting decides whether its changes ask first.",
    g.commands === "never" ? "Agents never run commands on this computer." : g.commands === "ask" ? "Agents always ask before running a command." : "Agents with that power may run commands.",
    g.connectors === "never" ? "Agents may not use connected services." : g.connectors === "approved" ? (g.services.length ? `Agents may use only ${g.services.length} approved connected service${g.services.length === 1 ? "" : "s"}: ${g.services.join(", ")}.` : "Agents may use only approved connected services, and none is approved yet.") : "Agents may use connected services; their tools ask before changing anything.",
    g.web === "never" ? "Agents may not use the web." : g.web === "approved" ? (g.sites.length ? `Agents may open only ${g.sites.length} approved site${g.sites.length === 1 ? "" : "s"}.` : "Agents may open only approved sites, and none is approved yet, so the web is off.") : "Agents with that power may open any site.",
    g.maxTaskSpend !== undefined ? `No task may spend more than $${g.maxTaskSpend}.` : "No extra cap on what a task may spend.",
    g.maxMinutes !== undefined ? `No task may run longer than ${g.maxMinutes} minutes.` : "No extra cap on how long a task may run.",
    g.maxDaySpend !== undefined ? `All tasks together may spend at most $${g.maxDaySpend} a day; after that nothing starts until the next day.` : "No limit on what all tasks together spend in a day.",
    g.deletes === "never" ? "Agents never delete anything in a connected service." : "Deleting in a connected service always asks a person first.",
    ...STEP_KINDS.filter((k) => g.approvers[k]).map((k) => `${STEP_WORDS[k].split(" (")[0]}: ${g.approvers[k]!.two ? "two people must approve" : "one person approves"}${g.approvers[k]!.people.length ? `, from ${g.approvers[k]!.people.length} named` : ""}.`),
    g.market === "approved" ? `Only approved Marketplace items may be added (${g.listings.length} approved).` : "Anything in the Marketplace may be added.",
    g.pauseAfter !== undefined ? `An agent whose work is stopped for being stuck ${g.pauseAfter} times within an hour is paused, and it is recorded.` : "Agents are not paused automatically.",
  ];
}
