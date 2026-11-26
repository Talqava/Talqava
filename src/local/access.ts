// The access graph: for each agent, one map of everything it may reach, drawn from the rules that already decide it
// (its powers, the org chart, library and workspace access, connectors, keys, approvals and budgets). The rules stay
// where they are and keep refusing what is not allowed; this is the single place that shows them together, so the
// owner can see at a glance what an agent can read, change, hand work to, and ask.
import type { Org } from "./orgs.ts";
import { assignableBy, memberOf, requestableBy } from "./orgs.ts";
import { loadCrew } from "./crew.ts";
import { getConfig } from "./store.ts";
import { GENERAL_AGENT, library, mayUse } from "./library.ts";
import { workspace } from "./workspace.ts";

/** What each power lets an agent do, in plain words, and whether it touches things outside the conversation. */
const POWER_WORDS: Record<string, { words: string; changes: boolean }> = {
  web: { words: "Search the web and read pages", changes: false },
  files: { words: "Read and change files in its working folder", changes: true },
  shell: { words: "Run commands on this computer", changes: true },
  memory: { words: "Remember things between tasks", changes: false },
  skills: { words: "Follow and save skills", changes: false },
  search: { words: "Search past chats", changes: false },
  api: { words: "Call other services with your saved keys", changes: true },
  schedule: { words: "Set up schedules", changes: true },
  browser: { words: "Use a web browser", changes: true },
  connectors: { words: "Use connected services (MCP)", changes: true },
};

export interface AccessGraph {
  agent: { id: string; title: string; department: string | null };
  /** "ask": anything that changes something waits for the owner; "auto": runs without asking. */
  approvals: "ask" | "auto";
  powers: { id: string; words: string; changes: boolean }[];
  /** Agents it may hand work to (down the chart). */
  tasks: string[];
  /** Agents in other departments it may request work from. */
  requests: string[];
  /** Who it takes decisions to: its manager's title, or the owner. */
  escalatesTo: string;
  /** Whether it may ask colleagues questions (anyone in the organization). */
  asks: boolean;
  library: { folders: string[]; documents: number; hidden: number };
  workspace: { read: number; changeDirectly: string[]; suggestOnly: number; hidden: number };
  connectors: string[];
  keys: { name: string; host: string }[];
  budget: { perTask: number | null; steps: number | null; monthly: number | null };
}

/** The map for one agent, or for the Talqava assistant (GENERAL_AGENT). */
export function accessGraph(org: Org, botId: string): AccessGraph {
  const cfg = getConfig();
  const general = botId === GENERAL_AGENT;
  const bot = general ? null : loadCrew().bots.find((b) => b.id === botId);
  if (!general && !bot) throw new Error("There is no such agent.");
  const member = general ? undefined : memberOf(org, botId);
  const titleOf = (id: string) => org.members.find((m) => m.bot === id)?.title ?? id;
  const powers = general ? ["web", "files", "shell", "memory", "skills", "search", "api", "schedule", "connectors"] : bot!.powers;
  const docs = library.list(org);
  const readable = library.list(org, botId);
  const folders = library.folders(org).filter((f) => f.path && mayUse(org, f.access, botId)).map((f) => f.path);
  const pages = workspace.tree(org);
  const seen = new Set(workspace.tree(org, botId).map((p) => p.id));
  const visible = pages.filter((p) => seen.has(p.id));
  return {
    agent: { id: botId, title: general ? `${cfg.agentName}, the assistant` : (member?.title ?? bot!.title ?? bot!.name), department: member?.department ?? null },
    approvals: general ? cfg.approvalMode : bot!.approvals,
    powers: powers.map((p) => ({ id: p, ...(POWER_WORDS[p] ?? { words: p, changes: true }) })),
    tasks: general ? org.members.map((m) => m.title) : assignableBy(org, botId).map((m) => m.title),
    requests: general ? [] : requestableBy(org, botId).map((m) => m.title),
    escalatesTo: member?.manager ? titleOf(member.manager) : "you",
    asks: general ? org.members.length > 0 : org.members.length > 1,
    library: { folders, documents: readable.length, hidden: docs.length - readable.length },
    workspace: {
      read: visible.length,
      changeDirectly: visible.filter((p) => p.edit === "direct" && !p.protected).map((p) => p.title),
      suggestOnly: visible.filter((p) => p.edit !== "direct" || p.protected).length,
      hidden: pages.length - visible.length,
    },
    connectors: powers.includes("connectors") ? cfg.mcpServers.map((s) => s.name) : [],
    keys: powers.includes("api") ? Object.entries(cfg.secrets).map(([name, s]) => ({ name, host: s.host })) : [],
    budget: general ? { perTask: cfg.budget.spend ?? null, steps: cfg.budget.steps ?? null, monthly: cfg.monthlyBudget ?? null } : { perTask: bot!.budget?.spend ?? cfg.budget.spend ?? null, steps: bot!.budget?.steps ?? cfg.budget.steps ?? null, monthly: bot!.monthly ?? null },
  };
}

/** The map for every agent on the chart, and the assistant, for the overview. */
export function accessGraphs(org: Org): AccessGraph[] {
  return [accessGraph(org, GENERAL_AGENT), ...org.members.map((m) => accessGraph(org, m.bot))];
}
