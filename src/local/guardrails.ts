// Agent guardrails: rules for the whole installation that sit above every agent's own settings. An agent, a manager
// or a task can make things stricter than these, never looser. They are applied in one place, to every run, just
// before it starts: tools the rules forbid are taken away, web tools are held to the approved sites, changes ask a
// person when the rules say so, and spending and time are capped. Each refusal is written to the audit log.
import type { RunSpec, Tool } from "../core/index.ts";
import { getConfig } from "./store.ts";
import { audit } from "./audit.ts";
import { webRules } from "../core/tools/page.ts";

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
}

export const NO_GUARDRAILS: Guardrails = { changes: "agent", commands: "allowed", connectors: "allowed", services: [], web: "any", sites: [] };

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

  const budget = g.maxTaskSpend !== undefined ? { ...spec.budget, spend: Math.min(spec.budget?.spend ?? Infinity, g.maxTaskSpend) } : spec.budget;
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

/** The guardrails in plain words, for the Security page and reports. */
export function describeGuardrails(g: Guardrails = guardrails()): string[] {
  return [
    g.changes === "ask" ? "Every change an agent wants to make asks a person first." : "Each agent's own setting decides whether its changes ask first.",
    g.commands === "never" ? "Agents never run commands on this computer." : g.commands === "ask" ? "Agents always ask before running a command." : "Agents with that power may run commands.",
    g.connectors === "never" ? "Agents may not use connected services." : g.connectors === "approved" ? (g.services.length ? `Agents may use only ${g.services.length} approved connected service${g.services.length === 1 ? "" : "s"}: ${g.services.join(", ")}.` : "Agents may use only approved connected services, and none is approved yet.") : "Agents may use connected services; their tools ask before changing anything.",
    g.web === "never" ? "Agents may not use the web." : g.web === "approved" ? (g.sites.length ? `Agents may open only ${g.sites.length} approved site${g.sites.length === 1 ? "" : "s"}.` : "Agents may open only approved sites, and none is approved yet, so the web is off.") : "Agents with that power may open any site.",
    g.maxTaskSpend !== undefined ? `No task may spend more than $${g.maxTaskSpend}.` : "No extra cap on what a task may spend.",
    g.maxMinutes !== undefined ? `No task may run longer than ${g.maxMinutes} minutes.` : "No extra cap on how long a task may run.",
  ];
}
