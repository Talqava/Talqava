// Before an agent starts a task the owner gave it, it takes one short look: what the task needs, and
// what it can reach (a repository, GitHub, the library, the web, its tools, its team). If something
// essential is missing (information only the owner has, or access it does not have), it asks the owner
// instead of spending the budget finding out. One model call, with no tools, on the agent's own model.
import type { Bot } from "../core/index.ts";
import { costOf } from "../core/index.ts";
import { resolveModel } from "./models.ts";
import { getConfig } from "./store.ts";
import { orgs, memberOf } from "./orgs.ts";

export interface Readiness {
  ready: boolean;
  /** What is missing, in the agent's words. */
  missing: string[];
  /** What the agent asks the owner, one question each. */
  questions: string[];
  /** One line on how it will go about the task. */
  plan: string;
  /** Abilities it lacks and says the task needs, which the owner can switch on with one press. */
  grant: string[];
  cost: number;
  input: number;
  output: number;
}

const POWER_WORDS: Record<string, string> = {
  files: "read and change files in a working copy of a repository",
  shell: "run commands on this computer",
  web: "search the web and read web pages",
  memory: "keep notes between tasks",
  browser: "use a web browser",
  api: "call web APIs with saved keys",
  schedule: "schedule work for later",
  skills: "use saved skills",
  search: "search past conversations",
  connectors: "use the connected services' tools",
};

/**
 * Abilities an agent may ask the owner to switch on with one press. Running commands, changing files and using a
 * browser are left out on purpose: those are given deliberately, on the agent's own page.
 */
export const GRANTABLE = ["web", "connectors", "memory", "search", "schedule", "skills"];
/** An ability in plain words, for buttons and messages. */
export const powerWords = (power: string): string => POWER_WORDS[power] ?? power;

/** What this agent can reach, in plain words, for the check. */
async function accessOf(bot: Bot, project: string | undefined): Promise<string[]> {
  const cfg = getConfig();
  const lines: string[] = [];
  lines.push(`Your abilities: ${bot.powers.length ? bot.powers.map((p) => POWER_WORDS[p] ?? p).join("; ") : "writing and reasoning only (no tools that reach outside)"}.`);
  const could = GRANTABLE.filter((p) => !(bot.powers as string[]).includes(p));
  if (could.length) lines.push(`Abilities you do not have, which the owner can switch on for you with one press if the task truly needs one: ${could.map((p) => `${p} (${POWER_WORDS[p]})`).join("; ")}.`);
  lines.push(project ? `A repository is attached to this task: ${project.split(/[\\/]/).pop()}. You can read its files${bot.powers.includes("files") || bot.powers.includes("shell") ? " and change them in your own working copy" : ""}.` : cfg.projects.length ? `No repository is attached to this task (the owner has ${cfg.projects.length} connected).` : "No repository is connected.");
  lines.push(cfg.secrets.GITHUB_TOKEN ? "GitHub is connected: issues and pull requests can be read." : "GitHub is not connected.");
  try {
    const { skills } = await import("./store.ts");
    const saved = skills.list();
    if (saved.length) lines.push(`Saved procedures (skills) you can read and follow: ${saved.slice(0, 20).map((s) => `${s.name} (${s.description})`).join("; ")}.`);
  } catch {}
  const servers = cfg.mcpServers.map((s) => s.name);
  if (servers.length) lines.push(`Connected services you may use through their tools: ${servers.join(", ")}.`);
  try {
    const org = orgs.active();
    const { library } = await import("./library.ts");
    const docs = library.list(org, bot.id);
    lines.push(docs.length ? `The organization's library has ${docs.length} document${docs.length === 1 ? "" : "s"} you may read, including: ${docs.slice(0, 25).map((d) => d.name).join(", ")}.` : "The organization's library has no documents you may read.");
    const reports = org.members.filter((m) => m.manager === bot.id).map((m) => m.title || m.bot);
    if (reports.length) lines.push(`You lead a team you can hand parts of the work to: ${reports.join(", ")}.`);
    const me = memberOf(org, bot.id);
    if (me) lines.push(`You work in ${me.department}${org.name ? ` at ${org.name}` : ""}.`);
  } catch {}
  return lines;
}

function parse(text: string): Pick<Readiness, "ready" | "missing" | "questions" | "plan" | "grant"> | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as Record<string, unknown>;
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : []);
    const questions = list(data.questions);
    const missing = list(data.missing);
    // Not ready only when it says so and says what it needs; anything unclear counts as ready, so work is never blocked by a muddled answer.
    const grant = [...new Set(list(data.switch_on).map((p) => p.toLowerCase()))].filter((p) => GRANTABLE.includes(p));
    return { ready: data.ready !== false || (!questions.length && !missing.length && !grant.length), missing, questions, plan: String(data.plan ?? "").slice(0, 300), grant };
  } catch {
    return null;
  }
}

/** Asks the agent whether it has what it needs. Throws only when the model cannot be reached at all. */
export async function checkReadiness(bot: Bot, task: string, project: string | undefined, signal: AbortSignal): Promise<Readiness> {
  const cfg = getConfig();
  const model = resolveModel({ ...cfg, effort: "low" }, bot.model ? (bot.model.includes("/") ? bot.model : `anthropic/${bot.model}`) : cfg.model);
  const access = await accessOf(bot, project);
  const system = [
    `You are the ${bot.title || bot.name} in an organization run with AI agents. The owner has just given you a task. Before you start, decide whether you have what you need to do it well.`,
    "",
    "What you can reach:",
    ...access.map((l) => `- ${l}`),
    "",
    "Be ready unless something essential is truly missing: information only the owner has (a goal, a figure, a name, a choice that changes the result), or access you do not have (a repository, an account, a document). Do not ask about things you can reasonably assume, look up yourself, or decide yourself. Ask at most three short, specific questions a non-technical owner can answer.",
    "",
    "If what is missing is one of the abilities the owner can switch on, name it in switch_on by its one-word name, and do not also ask a question about it.",
    "",
    'Answer with JSON only, no other words: {"ready": true or false, "missing": ["what is missing"], "questions": ["question for the owner"], "switch_on": ["ability name"], "plan": "one line on how you will do the task"}',
  ].join("\n");
  const reply = await model.call({ system, messages: [{ role: "user", content: task }], tools: [], hostedTools: [], mcpServers: [], signal }, { onText() {}, onThinking() {}, onToolStart() {} });
  const text = reply.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const cost = reply.usage.cost ?? (model.prices ? costOf(model.prices, reply.usage) : 0);
  const parsed = parse(text) ?? { ready: true, missing: [], questions: [], plan: "", grant: [] };
  // Only abilities it really lacks are offered.
  const verdict = { ...parsed, grant: parsed.grant.filter((p) => !(bot.powers as string[]).includes(p)) };
  return { ...verdict, cost, input: reply.usage.input + (reply.usage.cacheRead ?? 0) + (reply.usage.cacheWrite ?? 0), output: reply.usage.output };
}

/** The message the agent leaves for the owner when it cannot start yet. */
export function askingMessage(r: Readiness): string {
  const lines = ["Before I start, I need a little more from you, so I don't spend your budget guessing."];
  if (r.missing.length) lines.push("", "**What I'm missing**", ...r.missing.map((m) => `- ${m}`));
  if (r.questions.length) lines.push("", "**Please answer**", ...r.questions.map((q, i) => `${i + 1}. ${q}`));
  if (r.grant.length) lines.push("", "**You can fix this with one press**", `Let me ${r.grant.map(powerWords).join(", and ")}. Press **Allow and start** on this message, or switch it on for me under Agents.`);
  lines.push("", "Reply here and I'll start straight away with your answers. If something can't be provided, say so and I'll do what I can without it.");
  return lines.join("\n");
}
