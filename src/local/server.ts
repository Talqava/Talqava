// Web server of the local edition: serves the chat page and the small JSON API behind it.
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Engine, JobBook, BRAND, checkModel, describeError, describeSchedule, outsideContentRead, setting } from "../core/index.ts";
import type { Bot, Conversation, Decision, Job, RunEvent } from "../core/index.ts";
import {
  ROOT,
  DATA,
  WORKSPACE,
  EFFORTS,
  MODELS,
  initStore,
  getConfig,
  saveConfig,
  publicConfig,
  conversations,
  memory,
  skills,
  spaces,
  jobStore,
  readJson,
  writeJson,
} from "./store.ts";
import type { Config, ProviderConfig } from "./store.ts";
import { CAUTION_TOOLS, localRunSpec } from "./tools.ts";
import { closeConnectors } from "./connectors.ts";
import { resolveModel, splitRef } from "./models.ts";
import { botId, loadCrew, removeBot, saveBot } from "./crew.ts";
import { addMarketBot, addPack, addTeam, buildStructure, installStatus, loadMarketplace, loadTeams, onTeam, previewMarketBot, previewTeam, undoMarketUpdate, updateMarketBot } from "./marketplace.ts";
import { assignRule, requestRule, orgs } from "./orgs.ts";
import { orgMemory } from "./orgmemory.ts";
import { mcpIntegration, setClaudeDesktop } from "./mcpintegration.ts";
import { EVERYONE, ensureFolders, library, libraryFolder, removeLibrary, syncLibrary } from "./library.ts";
import { execFile } from "node:child_process";
import { needsFor } from "./preflight.ts";
import { acceptSuggestion, suggestPositions } from "./suggest.ts";
import { audit, readAudit, redact } from "./audit.ts";
import { connect, disconnect, findLocal, gatewayState, listModels, setBackups } from "./gateway.ts";
import { board } from "./board.ts";
import { finishOpenRouterSignIn, openrouterIntegration, openrouterModels, removeOpenRouter, saveOpenRouterKey, startOpenRouterSignIn, useOpenRouterModel } from "./openrouter.ts";
import { autoSetupGit, cloneRepository, disconnectRepository, gitIntegration, githubAccounts, githubRepos, installGit, listIntegrations, pollGithubSignIn, removeGitIntegration, startGithubSignIn, testGithub } from "./integrations.ts";
import { ASSIGN_RULES, INDUSTRIES, REQUEST_RULES, STRUCTURES, seatsFor } from "./structures.ts";
import { budgetBlock, groupSpend, monthlyBudgets } from "./spend.ts";
import { decide, listProposals } from "./proposals.ts";
import { exportOrg, importOrg } from "./portable.ts";
import { fileReport, workspace } from "./workspace.ts";
import { PRIORITIES, work } from "./work.ts";
import { goals } from "./goals.ts";
import { findTemplate, loadTemplates } from "./templates.ts";
import { chainBudget, chainCost, chainOf, chainSize, journal, questStore, quests, rootOf, whyOf } from "./quests.ts";
import type { Quest } from "./quests.ts";
import { currentBranch, repoRoot } from "./git.ts";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const PASSWORD = setting("PASSWORD") || "";
const SESSION_COOKIE = `${BRAND.slug}_session`;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PUBLIC = path.join(ROOT, "public");
/** The documents shown under About and legal, in order. Each lives in the repository and ships with the app. */
/** The user guides, in the order of the menu. Each page's Guide button opens its own. */
const GUIDES = [
  ["getting-started", "Getting started"],
  ["chat", "Chat"],
  ["inbox", "Inbox"],
  ["tasks", "Tasks and goals"],
  ["work-in-progress", "Work in progress"],
  ["schedules", "Schedules"],
  ["organization", "Organization"],
  ["marketplace", "Marketplace"],
  ["workspace", "Workspace"],
  ["library", "Library"],
  ["memory", "Memory"],
  ["skills", "Skills"],
  ["audit-log", "Audit log"],
  ["integrations", "Integrations"],
  ["ai-models", "AI models"],
  ["settings", "Settings and AI models"],
].map(([id, title]) => ({ id, title, file: `guide/${id}.md` }));

const LEGAL_DOCS = [
  { id: "terms", title: "Terms of Use", file: "legal/TERMS.md" },
  { id: "privacy", title: "Privacy Policy", file: "legal/PRIVACY.md" },
  { id: "acceptable-use", title: "Acceptable Use Policy", file: "legal/ACCEPTABLE_USE.md" },
  { id: "license", title: "Licence (MIT)", file: "LICENSE" },
  { id: "security", title: "Security policy", file: "SECURITY.md" },
  { id: "open-source", title: "Open-source policy", file: "legal/OPEN_SOURCE_POLICY.md" },
  { id: "approved-licenses", title: "Approved licence list", file: "legal/APPROVED_LICENSES.md" },
  { id: "notices", title: "Third-party notices", file: "THIRD_PARTY_NOTICES.md" },
];

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// The local edition wires the shared core to file storage and local tools.
export const jobs = new JobBook(jobStore);
export const engine = new Engine({
  conversations,
  resolveRun: localRunSpec(jobs),
  onEvent: (id, event) => {
    quests.onEvent(id, event);
    auditEvent(id, event);
  },
});
quests.attach(engine);

// ---------- the audit log: what the owner does and what each agent does ----------
const TOOL_WORDS: Record<string, string> = { bash: "Ran a command", str_replace_based_edit_tool: "Worked on a file", web_search: "Searched the web", web_fetch: "Read a web page", http_request: "Called a web API", memory: "Used memory", skill: "Used a skill", schedule: "Scheduled work", browser: "Used the browser", conversation_search: "Searched past chats", code_execution: "Ran code", assign_task: "Handed work to a colleague", request_work: "Requested work from another department", escalate: "Took a decision to their lead", ask_colleague: "Asked a colleague", team_memory: "Used team memory", library: "Used the library" };
const lastCost = new Map<string, number>();
/** Who is behind a conversation: the agent doing a task, or the chat assistant. */
function actorOf(id: string) {
  const quest = questStore.get(id);
  if (quest) return { actor: quest.bot.id, actorName: quest.bot.title || quest.bot.name };
  return { actor: "assistant", actorName: getConfig().agentName || "Assistant" };
}
function auditEvent(id: string, event: RunEvent) {
  const who = { ...actorOf(id), task: id };
  if (event.type === "assistant") {
    for (const block of event.content as { type: string; name?: string; input?: unknown }[]) {
      if (block.type !== "tool_use" && block.type !== "server_tool_use") continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      const detail = typeof input.command === "string" ? input.command : typeof input.path === "string" ? `${input.command ?? ""} ${input.path}`.trim() : typeof input.query === "string" ? input.query : typeof input.url === "string" ? input.url : JSON.stringify(redact(input));
      audit({ ...who, kind: "tool", action: TOOL_WORDS[block.name ?? ""] ?? `Used ${block.name}`, detail });
    }
  } else if (event.type === "tool_result") {
    const result = event.result as { is_error?: boolean; content?: unknown };
    if (result.is_error) audit({ ...who, kind: "problem", ok: false, action: "A step did not work", detail: typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? "").slice(0, 400) });
  } else if (event.type === "approval") {
    audit({ ...who, kind: "approval", action: `Asked for approval: ${TOOL_WORDS[event.approval.name] ?? event.approval.name}`, detail: JSON.stringify(redact(event.approval.input)) });
  } else if (event.type === "approval_done") {
    audit({ actor: "owner", actorName: "You", kind: "approval", task: id, action: event.decision === "deny" ? "Did not allow a step" : event.decision === "always" ? "Allowed a step, always" : "Allowed a step once" });
  } else if (event.type === "status" && !event.running) {
    const total = event.usage?.cost ?? conversations.get(id)?.usage.cost ?? 0;
    const spent = Math.max(0, total - (lastCost.get(id) ?? 0));
    lastCost.set(id, total);
    const quest = questStore.get(id);
    audit({ ...who, kind: "spend", action: quest ? `Stopped working (${quest.status === "asking" ? "waiting for you" : quest.status})` : "Finished answering", detail: `This run cost $${spent.toFixed(4)}; $${total.toFixed(4)} in all.`, cost: spent });
  } else if (event.type === "error") {
    audit({ ...who, kind: "problem", ok: false, action: "Stopped with an error", detail: event.text });
  } else if (event.type === "notice" && /budget/i.test(event.text)) {
    audit({ ...who, kind: "spend", ok: false, action: "Stopped at its budget", detail: event.text });
  }
}

/** An owner's request, described in plain words for the log. */
function describeRequest(method: string, parts: string[], body: any, url: URL): { kind: string; action: string; detail?: string; task?: string } | null {
  const [area, id, action] = parts;
  const words = (b: unknown) => JSON.stringify(redact(b ?? {})).slice(0, 400);
  if (area === "login") return { kind: "settings", action: "Signed in" };
  if (area === "quests" && !id && method === "POST") return null; // the route records it, knowing whether the task started
  if (area === "quests" && id) return { kind: "task", task: id, action: action === "stop" ? "Stopped a task" : action === "board" ? "Posted to a task's board" : action === "escalate" ? "Handed a task to Claude" : action === "accept" ? "Kept a task's changes" : action === "undo" ? "Undid a task's changes" : method === "DELETE" ? "Deleted a task" : `${method} task ${action ?? ""}`.trim() };
  if (area === "conversations") {
    if (action === "messages") return { kind: "chat", task: id, action: questStore.get(id) ? "Replied to an agent" : "Sent a chat message", detail: String(body.text ?? "").slice(0, 300) };
    if (action === "approvals") return null; // the agent's event records the decision
    if (!id && method === "POST") return { kind: "chat", action: "Started a chat" };
    return { kind: "chat", task: id, action: method === "DELETE" ? "Deleted a chat" : action === "stop" ? "Stopped a chat" : "Changed a chat" };
  }
  if (area === "settings") return { kind: "settings", action: "Changed settings", detail: Object.keys(body ?? {}).join(", ") + " · " + words(body) };
  if (area === "library") {
    const name = url.searchParams.get("name");
    const map: Record<string, string> = { upload: `Uploaded “${name ?? "a file"}”`, folders: `Made the folder “${body.name ?? ""}”`, move: body.name ? `Renamed to “${body.name}”` : "Moved files", delete: "Deleted files", restore: "Restored from Deleted", purge: "Deleted for good", open: "Showed in Finder", launch: "Opened a file", search: "Searched the library", folder: "Changed who can use a folder" };
    return { kind: "library", action: map[id] ?? (method === "PATCH" ? "Changed who can use a file" : method === "DELETE" ? "Deleted a file" : `${method} library ${id ?? ""}`.trim()), detail: name ? `into ${url.searchParams.get("folder") ?? ""}` : words(body) };
  }
  if (area === "integrations") return { kind: "integration", action: `${id ? id[0].toUpperCase() + id.slice(1) : "Integration"}: ${(action ?? method.toLowerCase()).replace(/-/g, " ")}`, detail: words(body) };
  // Goals and projects write their own entries; small edits (a title, a description) are not worth a line each.
  if (area === "goals" || area === "projects") return method === "POST" || method === "DELETE" || (area === "goals" && method === "PATCH") ? null : { kind: "organization", action: "Changed a project", detail: words(body) };
  // Tasks write their own entries when they are created, cancelled, accepted or commented on.
  if (area === "work") return method === "PATCH" ? { kind: "task", action: "Changed a task", detail: words(body) } : action === "retry" ? { kind: "task", action: "Tried a task again" } : null;
  // Saving a page as the owner types would fill the log; the page's own history keeps every version.
  if (area === "workspace") {
    if (method === "PUT" || action === "suggestions") return null;
    const what = action === "templates" ? `Added the ${id} pages` : method === "DELETE" ? "Deleted a page" : method === "POST" && parts[3] === "restore" ? "Restored a page" : method === "POST" && parts[3] === "revisions" ? "Put back an earlier version of a page" : method === "POST" ? `Made the page “${body.title || "Untitled"}”` : "Changed a page's settings";
    return { kind: "workspace", action: what, detail: words(body) };
  }
  if (area === "quests" && action === "file") return { kind: "workspace", task: id, action: "Saved a task's report as a page" };
  // These routes write their own, clearer entries.
  if (area === "orgs" && (id === "import" || action === "proposals")) return null;
  if (area === "orgs" && action === "pack") return { kind: "organization", action: `Added the ready-made team ${body.team ?? ""}${body.under ? ` under ${body.under}` : body.group ? ` into ${body.group}` : ""}` };
  if (area === "marketplace" && parts[2] === "update") return { kind: "organization", action: `Updated the ${id} agent from the marketplace` };
  if (area === "marketplace" && parts[2] === "undo-update") return { kind: "organization", action: `Undid the marketplace update of the ${id} agent` };
  if (area === "orgs" || area === "marketplace") return { kind: "organization", action: area === "marketplace" ? "Added from the marketplace" : `Changed the organization${action ? ` (${action})` : ""}`, detail: words(body) };
  if (area === "inbox") return { kind: "inbox", action: id === "names" ? `Renamed an agent to “${body.name || "its default"}”` : "Updated messages", detail: id === "names" ? parts[2] : words(body) };
  return { kind: "other", action: `${method} ${parts.join(" / ")}`, detail: words(body) };
}

/**
 * Runs a scheduled job. With an agent chosen, it becomes a task in that agent's queue, worked and
 * reviewed like any other. Without one, or if the agent has left the chart, the assistant does it in a chat.
 */
async function runJob(job: Job): Promise<{ conversationId?: string; taskId?: string }> {
  const org = job.owner ? orgs.list().orgs.find((o) => o.id === job.org) : undefined;
  if (job.owner && org && org.members.some((m) => m.bot === job.owner)) {
    const item = work.create(org, {
      title: job.name,
      description: `${job.prompt}\n\n(From the schedule “${job.name}”, ${describeSchedule(job.schedule).toLowerCase()}. Finish with a short report of what you did and anything that needs the owner's attention.)`,
      owner: job.owner,
      createdBy: "owner",
      review: true,
    });
    await jobs.update(job.id, { lastTaskId: item.id, lastConversationId: null });
    work.kick();
    return { taskId: item.id };
  }
  if (job.owner) audit({ actor: "system", actorName: "Talqava", kind: "problem", ok: false, action: `The schedule “${job.name}” ran in a chat`, detail: "Its agent is no longer on the organization chart, so the Talqava assistant did it instead. Choose another agent under Schedules." });
  const { conversation } = await engine.runJob(job);
  await jobs.update(job.id, { lastConversationId: conversation.id, lastTaskId: null });
  return { conversationId: conversation.id };
}

/** A schedule's agent: someone on the active organization's chart, or none for the assistant. */
function jobOwner(owner: unknown): string | null {
  if (!owner) return null;
  if (!orgs.active().members.some((m) => m.bot === String(owner))) throw new HttpError(400, "Choose an agent from your organization chart, or the Talqava assistant.");
  return String(owner);
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- sign-in ----------
const sha = (text: string) => crypto.createHash("sha256").update(text).digest();
const sessionToken = () => crypto.createHmac("sha256", getConfig().sessionSecret).update(`session:${PASSWORD}`).digest("hex");

function signedIn(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const cookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie || "");
  return Boolean(cookie) && crypto.timingSafeEqual(sha(cookie![1]), sha(sessionToken()));
}

// Without a password the page only answers to this machine's own address, and
// only to requests that come from the page itself. This stops other websites
// open in the same browser from reaching the agent.
function checkOrigin(req: IncomingMessage) {
  const host = (req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!PASSWORD && !LOCAL_HOSTS.has(host)) throw new HttpError(403, "Open this page as http://localhost.");
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Cross-site request refused.");
}

// ---------- helpers ----------
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": raw ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(raw ? (body as string | Buffer) : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  if (!/^application\/json/.test(req.headers["content-type"] || "")) throw new HttpError(415, "Send JSON.");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new HttpError(413, "Too large.");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

function serveStatic(res: ServerResponse, urlPath: string) {
  const file = path.join(PUBLIC, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new HttpError(404, "Not found.");
  }
  send(res, 200, fs.readFileSync(file), {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
}

function conversationOr404(id: string) {
  const conversation = /^[a-f0-9]{16}$/.test(id) ? conversations.get(id) : null;
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  return conversation;
}

async function updateSettings(body: any) {
  const cfg = getConfig();
  const patch: Partial<Config> = {};
  if (typeof body.agentName === "string" && body.agentName.trim()) patch.agentName = body.agentName.trim().slice(0, 40);
  if (typeof body.model === "string") {
    const { providerId, model } = splitRef(body.model.trim());
    if (!cfg.providers.some((p) => p.id === providerId)) throw new HttpError(400, `No model provider called "${providerId}".`);
    if (!/^[\w.:@/+-]{1,120}$/.test(model)) throw new HttpError(400, "Type the model's name, e.g. llama3.1 or claude-opus-5-5.");
    patch.model = `${providerId}/${model}`;
  }
  if (EFFORTS.includes(body.effort)) patch.effort = body.effort;
  if (body.savings === "balanced" || body.savings === "off") patch.savings = body.savings;
  if (typeof body.checkFirst === "boolean") patch.checkFirst = body.checkFirst;
  if (["ask", "auto"].includes(body.approvalMode)) patch.approvalMode = body.approvalMode;
  if (typeof body.apiKey === "string") patch.apiKey = body.apiKey.trim();

  if (body.secret) {
    const { name, value, host, remove } = body.secret;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(name || "")) throw new HttpError(400, "Secret names use letters, digits and underscores.");
    const secrets = { ...cfg.secrets };
    if (remove) delete secrets[name];
    else {
      if (!value || !/^[a-z0-9.-]+$/i.test(host || "")) {
        throw new HttpError(400, "A secret needs a value and the host it may be sent to, e.g. api.example.com.");
      }
      secrets[name] = { value: String(value), host: host.toLowerCase() };
    }
    patch.secrets = secrets;
  }

  if (body.monthlyBudget !== undefined) {
    // The most all bots together may spend in a month; empty or null removes the limit.
    if (body.monthlyBudget === null || body.monthlyBudget === "") patch.monthlyBudget = undefined;
    else {
      const amount = Number(body.monthlyBudget);
      if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new HttpError(400, "The monthly budget is in dollars, from 0 to 100000.");
      patch.monthlyBudget = amount;
    }
  }

  if (body.budget) {
    const steps = Number(body.budget.steps);
    const spend = body.budget.spend === null || body.budget.spend === "" ? undefined : Number(body.budget.spend);
    if (!Number.isInteger(steps) || steps < 1 || steps > 500) throw new HttpError(400, "The step budget is a whole number from 1 to 500.");
    if (spend !== undefined && (!Number.isFinite(spend) || spend < 0 || spend > 100)) throw new HttpError(400, "The spend budget is from $0 to $100.");
    patch.budget = { steps, ...(spend !== undefined ? { spend } : {}) };
  }

  if (body.provider) {
    const { id, name, baseUrl, apiKey, prices, remove } = body.provider;
    if (!/^[a-z0-9-]{1,30}$/.test(id || "")) throw new HttpError(400, "Provider ids use lowercase letters, digits and dashes.");
    const existing = cfg.providers.find((p) => p.id === id);
    if (existing?.kind === "anthropic") throw new HttpError(400, "The Anthropic provider cannot be changed here; set its key above.");
    let providers = cfg.providers.filter((p) => p.id !== id);
    if (remove) {
      if (splitRef(cfg.model).providerId === id) throw new HttpError(400, "Choose another model before removing the provider it uses.");
    } else {
      let url: URL;
      try {
        url = new URL(String(baseUrl || ""));
      } catch {
        throw new HttpError(400, "A provider needs an address, e.g. http://localhost:11434/v1.");
      }
      if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "A provider's address starts with http:// or https://.");
      const provider: ProviderConfig = {
        id,
        kind: "openai",
        name: String(name || id).trim().slice(0, 60),
        baseUrl: url.href.replace(/\/+$/, ""),
        // A blank key keeps the one already saved.
        apiKey: typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : existing?.apiKey,
      };
      if (body.provider.contextTokens !== undefined && body.provider.contextTokens !== "") {
        const size = Number(body.provider.contextTokens);
        if (!Number.isInteger(size) || size < 2000 || size > 2_000_000) throw new HttpError(400, "The context size is a whole number of tokens, from 2,000 up.");
        provider.contextTokens = size;
      } else if (existing?.contextTokens) provider.contextTokens = existing.contextTokens;
      if (prices && prices.input !== "" && prices.output !== "") {
        const input = Number(prices.input);
        const output = Number(prices.output);
        if (![input, output].every((n) => Number.isFinite(n) && n >= 0 && n < 1000)) throw new HttpError(400, "Prices are dollars per million tokens.");
        provider.prices = { input, output };
      }
      providers = [...providers, provider];
    }
    patch.providers = providers;
  }

  if (body.project) {
    const { path: folder, remove } = body.project;
    if (typeof folder !== "string" || !folder.trim()) throw new HttpError(400, "Give the repository's folder.");
    if (remove) patch.projects = cfg.projects.filter((p) => p !== folder);
    else {
      const top = await repoRoot(folder.trim());
      if (!top) throw new HttpError(400, `${folder} is not a git repository on this computer.`);
      patch.projects = [...new Set([...cfg.projects, top])];
    }
  }

  if (body.mcpServer) {
    const { name, url, token, remove } = body.mcpServer;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name || "")) throw new HttpError(400, "Connector names use letters, digits, dashes and underscores.");
    const servers = cfg.mcpServers.filter((s) => s.name !== name);
    if (!remove) {
      const { command } = body.mcpServer;
      if (typeof command === "string" && command.trim()) {
        // A program on this computer, e.g. "npx -y some-mcp-server". Split like a shell would, without running one.
        const parts = command.trim().match(/"[^"]*"|'[^']*'|\S+/g)!.map((p: string) => p.replace(/^["']|["']$/g, ""));
        servers.push({ name, url: "", command: parts[0], args: parts.slice(1) });
      } else {
        let address: URL;
        try {
          address = new URL(String(url || ""));
        } catch {
          throw new HttpError(400, "A connector needs an address (https://…) or a program to run.");
        }
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname);
        if (address.protocol !== "https:" && !(local && address.protocol === "http:")) {
          throw new HttpError(400, "A connector on the web needs an https:// address (http:// only for this computer).");
        }
        servers.push({ name, url: address.href, token: token ? String(token) : "" });
      }
    }
    patch.mcpServers = servers;
  }
  saveConfig(patch);
  // New connector settings take effect on the next run.
  if (body.mcpServer) await closeConnectors();
  return publicConfig();
}

// ---------- quests ----------
/** A repository the user connected under Integrations → Git, or null. */
function projectOrNull(folder: string | null): string | null {
  return folder && getConfig().projects.includes(folder) ? folder : null;
}

/** The model a bot will use, in words, or why it cannot run. */
function botModel(bot: Bot, override?: string) {
  const cfg = getConfig();
  try {
    const model = resolveModel(cfg, override ?? bot.model ?? cfg.model);
    return { ref: model.ref, label: model.label, kind: model.kind, free: model.prices?.input === 0 && model.prices?.output === 0 };
  } catch (err) {
    return { ref: bot.model ?? cfg.model, label: (err as Error).message, kind: null, free: false };
  }
}

/** What a quest is doing now: its last tool call and the tail of what came back. */
function lastActivity(conversation: Conversation | null) {
  if (!conversation) return null;
  const messages = conversation.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const use = [...message.content].reverse().find((b) => b.type === "tool_use" || b.type === "server_tool_use") as
      | { id: string; name: string; input: unknown }
      | undefined;
    if (!use) continue;
    const reply = messages[i + 1];
    const result = Array.isArray(reply?.content) ? (reply.content as { type: string; tool_use_id?: string; content?: unknown }[]).find((b) => b.tool_use_id === use.id) : undefined;
    const text = typeof result?.content === "string" ? result.content : Array.isArray(result?.content) ? (result.content as { text?: string }[]).map((p) => p.text ?? "").join("\n") : "";
    return { name: use.name, input: use.input, output: text.split("\n").slice(-6).join("\n").slice(-500) };
  }
  return null;
}

const readOutside = (conversation: Conversation | null, extra: string[] = []) =>
  Boolean(conversation && outsideContentRead(conversation.messages, [...CAUTION_TOOLS, ...extra]));

/** The latest thing an agent wrote in a task, shortened: what the person sees as its update or its report. */
function lastWords(conversation: Conversation | null): string {
  for (const message of [...(conversation?.messages ?? [])].reverse()) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    if (text) return text.length > 700 ? `${text.slice(0, 700)}…` : text;
  }
  return "";
}

/** How far the tasks handed on from one task have got. */
function chainProgress(rootId: string) {
  const parts = chainOf(rootId).filter((q) => q.id !== rootId);
  return { finished: parts.filter((q) => q.status === "done").length, working: parts.filter((q) => q.status === "running" || q.status === "waiting").length, stopped: parts.filter((q) => q.status === "failed" || q.status === "budget" || q.status === "stopped").length, who: [...new Set(parts.map((q) => q.bot.name))].slice(0, 8) };
}

/** Every action an agent took in one task, in order, and whether each one worked. */
function actionsOf(conversation: Conversation | null) {
  const actions: { name: string; input: Record<string, unknown>; ok: boolean; error: string }[] = [];
  const messages = conversation?.messages ?? [];
  const short = (value: unknown) => (typeof value === "string" ? (value.length > 240 ? `${value.slice(0, 240)}…` : value) : typeof value === "number" || typeof value === "boolean" ? value : value == null ? "" : JSON.stringify(value).slice(0, 240));
  messages.forEach((message, i) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const reply = messages[i + 1];
    const results = Array.isArray(reply?.content) ? (reply.content as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[]) : [];
    for (const block of message.content as { type: string; id?: string; name?: string; input?: unknown }[]) {
      if (block.type !== "tool_use" && block.type !== "server_tool_use") continue;
      const result = results.find((r) => r.tool_use_id === block.id);
      const text = typeof result?.content === "string" ? result.content : Array.isArray(result?.content) ? (result.content as { text?: string }[]).map((p) => p.text ?? "").join("\n") : "";
      const failed = Boolean(result?.is_error);
      actions.push({
        name: block.name ?? "",
        input: Object.fromEntries(Object.entries((block.input ?? {}) as Record<string, unknown>).map(([k, v]) => [k, short(v)])),
        // A server-side tool (web search) reports its result elsewhere; with no error recorded it counts as done.
        ok: !failed && (Boolean(result) || block.type === "server_tool_use"),
        error: failed ? text.trim().slice(0, 300) : !result && block.type === "tool_use" ? "It was never carried out." : "",
      });
    }
  });
  return actions;
}

/**
 * The receipt for a task the person assigned: every part it was split into, who did each part, each
 * action taken and whether it worked, what was left undone, and what each agent cost.
 */
function receiptOf(rootId: string) {
  const root = questStore.get(rootId);
  if (!root) return null;
  const parts = chainOf(rootId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const lines = parts.map((quest) => {
    const conversation = conversations.get(quest.id);
    const actions = actionsOf(conversation);
    const open = quest.status === "running" || quest.status === "waiting";
    const notDone =
      quest.status === "failed" ? `Failed: ${quest.note ?? "no reason was recorded"}`
      : quest.status === "budget" ? "Stopped when the budget ran out, before it was finished."
      : quest.status === "stopped" ? "Stopped before it was finished."
      : quest.check && !quest.check.passed ? "Finished, but the result did not pass its check."
      : open ? "Not finished yet."
      : !lastWords(conversation) ? "Finished without leaving a report."
      : "";
    return {
      id: quest.id,
      agent: quest.bot.name,
      agentId: quest.bot.id,
      character: quest.bot.character,
      type: quest.bot.type,
      title: quest.title,
      kind: quest.id === rootId ? "task" : (quest.kind ?? "handoff"),
      from: quest.parent?.by ?? null,
      status: quest.status,
      model: botModel(quest.bot, quest.modelOverride)?.label ?? "",
      steps: quest.steps,
      cost: conversation?.usage.cost ?? 0,
      input: conversation?.usage.input ?? 0,
      output: conversation?.usage.output ?? 0,
      startedAt: quest.createdAt,
      endedAt: open ? null : quest.updatedAt,
      actions,
      notDone,
      said: lastWords(conversation),
      pages: (() => {
        try {
          return workspace.usesOf(orgs.active(), quest.id);
        } catch {
          return [];
        }
      })(),
    };
  });
  const agents = new Map<string, { agent: string; character: unknown; type: string; tasks: number; actions: number; failed: number; cost: number; input: number; output: number }>();
  for (const line of lines) {
    const row = agents.get(line.agentId) ?? { agent: line.agent, character: line.character, type: line.type, tasks: 0, actions: 0, failed: 0, cost: 0, input: 0, output: 0 };
    row.tasks += 1;
    row.actions += line.actions.length;
    row.failed += line.actions.filter((a) => !a.ok).length;
    row.cost += line.cost;
    row.input += line.input;
    row.output += line.output;
    agents.set(line.agentId, row);
  }
  const total = lines.reduce((sum, line) => sum + line.cost, 0);
  return {
    id: rootId,
    title: root.title,
    status: root.status,
    startedAt: root.createdAt,
    endedAt: lines.some((l) => !l.endedAt) ? null : lines.map((l) => l.endedAt!).sort().at(-1),
    budget: chainBudget(),
    total,
    input: lines.reduce((sum, line) => sum + line.input, 0),
    output: lines.reduce((sum, line) => sum + line.output, 0),
    actions: lines.reduce((sum, line) => sum + line.actions.length, 0),
    failedActions: lines.reduce((sum, line) => sum + line.actions.filter((a) => !a.ok).length, 0),
    byAgent: [...agents.values()].sort((a, b) => b.cost - a.cost),
    lines,
    notDone: lines.filter((l) => l.notDone).map((l) => ({ id: l.id, agent: l.agent, title: l.title, why: l.notDone })),
  };
}

function questSummary(quest: Quest) {
  const conversation = conversations.get(quest.id);
  const { bot } = quest;
  const live = engine.liveState(quest.id);
  return {
    id: quest.id,
    title: quest.title,
    bot: { id: bot.id, name: bot.name, type: bot.type, title: bot.title, character: bot.character, source: bot.source, powers: bot.powers },
    model: botModel(bot, quest.modelOverride),
    handedTo: quest.modelOverride ?? null,
    template: quest.template ? { id: quest.template.id, name: quest.template.name, tries: quest.template.tries, maxTries: quest.template.maxTries } : null,
    check: quest.check ?? null,
    checking: Boolean(quest.checking),
    activity: lastActivity(conversation),
    readOutside: readOutside(conversation),
    approvals: live.approvals,
    status: quest.status,
    // For a task handed down the org chart: who assigned it, and from which conversation.
    parent: quest.parent ? { id: quest.parent.id, by: quest.parent.by, isQuest: Boolean(questStore.get(quest.parent.id)) } : null,
    steps: quest.steps,
    budget: { ...getConfig().budget, ...bot.budget },
    cost: conversation?.usage.cost ?? 0,
    project: quest.project ?? null,
    branch: quest.copy?.branch ?? null,
    outcome: quest.outcome ?? null,
    changedFiles: quest.changedFiles ?? null,
    note: quest.note ?? null,
    // Which exit stopped it, and what it left for whoever carries on.
    stop: quest.stop ?? null,
    handover: quest.handover ?? null,
    // What this task and everything handed on from it have cost together, and how many tasks that is.
    chain: rootOf(quest) === quest.id ? { cost: chainCost(quest.id), tasks: chainSize(quest.id), budget: chainBudget(), ...chainProgress(quest.id) } : null,
    // The agent's latest words: its report once it has finished, or what it last said while working.
    said: lastWords(conversation),
    // A question or an escalated decision rather than a task, and how many hand-offs deep it is.
    kind: quest.kind ?? null,
    depth: quest.depth ?? 0,
    // Why the task exists: the mission, the group's purpose, and each task above it.
    why: whyOf(quest),
    resumedAt: quest.resumedAt ?? null,
    createdAt: quest.createdAt,
    updatedAt: quest.updatedAt,
    live: live.approvals.length ? "waiting" : engine.isRunning(quest.id) ? "running" : null,
  };
}

/** How big a chart is: its agents, the departments (or teams) they sit in, and how many levels deep it goes below the person. */
function chartSize(seats: ReturnType<typeof seatsFor>) {
  const categories = new Map(loadMarketplace().bots.map((m) => [m.bot.id, m.listing.category]));
  const depth = (bot: string): number => ((m) => (m ? 1 + depth(m) : 1))(seats.find((x) => x.bot === bot)?.manager ?? null);
  return { agents: seats.length, departments: new Set(seats.map((x) => x.department ?? categories.get(x.bot) ?? "Other")).size, levels: seats.length ? Math.max(...seats.map((x) => depth(x.bot))) : 0 };
}

// ---------- routes ----------
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const route = `${req.method} ${parts[0] || ""}`;
  // A file dropped into the library arrives as it is, not as JSON; it is read after the sign-in check below.
  const upload = route === "POST library" && parts[1] === "upload";
  const body = upload ? {} : ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBody(req) : {};
  (req as { auditBody?: unknown }).auditBody = route === "POST login" ? {} : body;

  if (route === "POST login") {
    const ok = PASSWORD && crypto.timingSafeEqual(sha(String(body.password || "")), sha(PASSWORD));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1000)); // slows password guessing
      throw new HttpError(401, "Wrong password.");
    }
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return send(res, 200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
  }
  if (route === "GET integrations" && parts[1] === "openrouter" && parts[2] === "callback") {
    // OpenRouter sends the person's browser back here after they approve. The browser may not be signed in to
    // this app (it can be a different browser), so the one-time state from the start of the sign-in is the proof.
    let message = "OpenRouter is connected to Talqava. You can close this tab and go back to the app.";
    let ok = true;
    try {
      await finishOpenRouterSignIn(url.searchParams.get("code"), url.searchParams.get("state"));
    } catch (err) {
      ok = false;
      message = (err as Error).message;
    }
    const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenRouter ${ok ? "connected" : "not connected"}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d0c;color:#e8ece9;font:16px/1.5 -apple-system,system-ui,sans-serif"><main style="max-width:440px;padding:32px;border:1px solid #2a302c;border-radius:16px;background:#121513"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;color:${ok ? "#39ff88" : "#ff8f8f"}">${ok ? "CONNECTED" : "NOT CONNECTED"}</p><h1 style="margin:0 0 12px;font-size:22px">${ok ? "You are all set" : "The sign-in did not finish"}</h1><p style="margin:0;color:#b5bdb8">${safe}</p></main></body>`);
  }
  if (!signedIn(req)) throw new HttpError(401, "Sign in first.");

  if (route === "GET state") return send(res, 200, publicConfig());
  if (route === "PUT settings") return send(res, 200, await updateSettings(body));
  if (route === "POST model-check") {
    const cfg = getConfig();
    let model;
    try {
      model = resolveModel(cfg, typeof body.model === "string" && body.model ? body.model : cfg.model);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const result = await checkModel(model, AbortSignal.timeout(180_000)).catch((err) => {
      throw new HttpError(502, describeError(err));
    });
    saveConfig({ modelChecks: { ...getConfig().modelChecks, [model.ref]: result } });
    return send(res, 200, result);
  }

  if (parts[0] === "conversations") {
    const [, id, action, actionId] = parts;
    if (!id) {
      if (req.method === "GET") {
        // Quests are listed on the crew page, not with the chats.
        const chats = conversations.list().filter((c) => c.source !== "quest");
        return send(res, 200, chats.map((c) => ({ ...c, running: engine.isRunning(c.id), needsApproval: engine.awaitingApproval(c.id) })));
      }
      if (req.method === "POST") {
        // A chat started in a space stays in it: its memory and searches are kept to that space.
        if (body.space && !spaces.get(String(body.space))) throw new HttpError(400, "No such project.");
        // A chat with one bot in its role answers as that bot, with its powers and limits.
        const withBot = body.bot ? loadCrew().bots.find((b) => b.id === body.bot) : undefined;
        if (body.bot && !withBot) throw new HttpError(400, "There is no such agent.");
        return send(res, 200, conversations.create({ ...(body.space ? { space: String(body.space) } : {}), ...(withBot ? { bot: withBot.id, title: `Chat with ${withBot.name}` } : {}) }));
      }
    }
    const conversation = conversationOr404(id);
    if (!action && req.method === "GET") return send(res, 200, { ...conversation, live: engine.liveState(id) });
    if (!action && req.method === "PATCH") {
      // Pins or unpins a chat, and moves it to another project (or to General with space: null).
      // While the agent is working it saves the chat itself, so a change made now could be overwritten.
      if (engine.isRunning(id)) throw new HttpError(409, "Wait for the agent to finish, then try again.");
      if ("pinned" in body) {
        if (body.pinned) conversation.pinned = true;
        else delete conversation.pinned;
      }
      if ("space" in body) {
        if (body.space && !spaces.get(String(body.space))) throw new HttpError(400, "No such project.");
        if (body.space) conversation.space = String(body.space);
        else delete conversation.space;
      }
      conversations.save(conversation, { touch: false });
      return send(res, 200, { ok: true, space: conversation.space ?? null, pinned: Boolean(conversation.pinned) });
    }
    if (!action && req.method === "DELETE") {
      engine.stop(id);
      conversations.remove(id);
      return send(res, 200, { ok: true });
    }
    if (action === "messages" && req.method === "POST") {
      const text = String(body.text || "").trim();
      if (!text) throw new HttpError(400, "Type a message first.");
      if (engine.isRunning(id)) throw new HttpError(409, "The agent is still working. Stop it first.");
      if (questStore.get(id)?.outcome) throw new HttpError(409, "This quest is closed. Send a new quest instead.");
      // Carrying on with a quest is new work for its bot, so its monthly budget applies.
      const questBot = questStore.get(id)?.bot;
      const blocked = questBot ? budgetBlock(loadCrew().bots.find((b) => b.id === questBot.id) ?? questBot) : null;
      if (blocked) throw new HttpError(409, blocked);
      // Say plainly what is missing, instead of the model library's error about headers.
      if (!questStore.get(id) && getConfig().model.startsWith("anthropic/") && !publicConfig().hasApiKey) {
        throw new HttpError(400, "No AI model is set up yet. Open Integrations → AI models and connect one: Anthropic (Claude), OpenAI, Gemini and many more, or a free model on this computer.");
      }
      await engine.startRun(id, text);
      return send(res, 200, { ok: true });
    }
    if (action === "stop" && req.method === "POST") {
      if (questStore.get(id)) quests.stop(id);
      else engine.stop(id);
      return send(res, 200, { ok: true });
    }
    if (action === "approvals" && req.method === "POST") {
      if (!["allow", "always", "deny"].includes(body.decision)) throw new HttpError(400, "Bad decision.");
      if (!engine.resolveApproval(id, actionId, body.decision as Decision)) throw new HttpError(404, "That request is no longer waiting.");
      return send(res, 200, { ok: true });
    }
    if (action === "events" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      const write = (event: RunEvent | { type: "sync"; conversation: unknown; live: unknown }) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      // The snapshot and the subscription happen in the same tick, so nothing is missed between them.
      write({ type: "sync", conversation, live: engine.liveState(id) });
      const unsubscribe = engine.subscribe(id, write);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }
  }

  if (parts[0] === "providers" && parts[2] === "models" && req.method === "GET") {
    // The models a service has, so people choose from a list instead of typing names.
    const provider = getConfig().providers.find((p) => p.id === parts[1]);
    if (!provider) throw new HttpError(404, "No such provider.");
    const listed = await listModels(provider);
    return send(res, 200, { ...listed, details: listed.models, models: listed.models.map((m) => m.id) });
  }

  if (route === "GET quest-templates") {
    try {
      return send(res, 200, loadTemplates());
    } catch (err) {
      throw new HttpError(500, (err as Error).message);
    }
  }

  if (parts[0] === "marketplace") {
    // Ready-made bots to add to the team. The instructions of each are shown in full before it is added.
    if (req.method === "GET" && !parts[1]) {
      const market = loadMarketplace();
      const crew = loadCrew().bots;
      const bots = market.bots.map((entry) => {
        const install = installStatus(entry, crew.find((b) => b.id === entry.bot.id));
        return { ...entry.bot, listing: entry.listing, added: install.state !== "available", install };
      });
      return send(res, 200, { bots, teams: loadTeams(), problems: market.problems, updates: bots.filter((b) => b.install.state === "update").length });
    }
    const plainly = <T>(fn: () => T): T => {
      try {
        return fn();
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    };
    // Before you install: what adding an agent or a team would do, in plain terms. Nothing changes.
    if (req.method === "GET" && parts[1] === "teams" && parts[3] === "preview") return send(res, 200, plainly(() => previewTeam(parts[2])));
    if (req.method === "GET" && parts[2] === "preview") return send(res, 200, plainly(() => previewMarketBot(parts[1])));
    if (req.method === "POST" && parts[2] === "update") return send(res, 200, plainly(() => updateMarketBot(parts[1])));
    if (req.method === "POST" && parts[2] === "undo-update") return send(res, 200, plainly(() => undoMarketUpdate(parts[1])));
    if (req.method === "POST" && parts[1] === "teams" && parts[3] === "add") {
      try {
        return send(res, 200, { added: addTeam(parts[2]).map((b) => b.id) });
      } catch (err) {
        throw new HttpError(404, (err as Error).message);
      }
    }
    if (req.method === "POST" && parts[2] === "add") {
      try {
        const bot = addMarketBot(parts[1]);
        return send(res, 200, { ...bot, modelInfo: botModel(bot) });
      } catch (err) {
        throw new HttpError(404, (err as Error).message);
      }
    }
  }

  if (parts[0] === "crew" && req.method === "GET") {
    const project = projectOrNull(url.searchParams.get("project"));
    const crew = loadCrew(project ?? undefined);
    // Each bot comes with what it has spent this month against its monthly budget.
    const budgets = monthlyBudgets(crew.bots);
    const bots = crew.bots.map((bot) => ({ ...bot, modelInfo: botModel(bot), month: budgets.bots[bot.id] }));
    return send(res, 200, { bots, problems: crew.problems, project, branch: project ? await currentBranch(project) : null, budgets: { month: budgets.month, resets: budgets.resets, total: budgets.total } });
  }
  if (parts[0] === "crew" && req.method === "PUT") {
    // A new bot gets a file name from its name; an existing one keeps its own.
    const id = parts[1] && parts[1] !== "new" ? parts[1] : botId(String(body.name || ""));
    if ((!parts[1] || parts[1] === "new") && loadCrew().bots.some((b) => b.id === id)) {
      throw new HttpError(409, `There is already an agent called ${id}. Choose another name, or edit that agent instead.`);
    }
    try {
      const saved = saveBot(id, body);
      // A new bot takes a place in the active organization, reporting to the person.
      orgs.welcome(saved);
      return send(res, 200, saved);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  }
  if (parts[0] === "crew" && req.method === "DELETE") {
    try {
      removeBot(String(parts[1] || ""));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return send(res, 200, { ok: true });
  }

  if (parts[0] === "quests") {
    const [, id, action] = parts;
    if (!id && req.method === "GET") return send(res, 200, questStore.list().map(questSummary));
    if (!id && req.method === "POST") {
      // With no repository chosen and exactly one connected, that one is meant: a task about "our repository" should find it.
      const onlyOne = !body.project && body.project !== "" && getConfig().projects.length === 1 ? getConfig().projects[0] : null;
      const project = body.project ? projectOrNull(String(body.project)) : onlyOne;
      if (body.project && !project) throw new HttpError(400, "Connect that repository under Integrations → Git first.");
      if (body.template) {
        // A core quest: its own bot unless another was chosen.
        try {
          const template = findTemplate(String(body.template));
          const crew = loadCrew(project ?? undefined).bots;
          const bot = crew.find((b) => b.id === (body.bot || template.bot));
          if (!bot) throw new Error(`${template.name} needs the bot "${body.bot || template.bot}", which is not in the crew.`);
          const given = body.inputs && typeof body.inputs === "object" ? body.inputs : {};
          return send(res, 200, questSummary(await quests.startTemplate({ template, bot, given, project: project ?? undefined })));
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      }
      const text = String(body.text || "").trim();
      if (!text) throw new HttpError(400, "Say what the quest is.");
      const bot = loadCrew(project ?? undefined).bots.find((b) => b.id === body.bot);
      if (!bot) throw new HttpError(400, "Choose a bot from the crew.");
      // What the task cannot do without is checked first, for free. The person can still start it anyway where that makes sense.
      const needs = needsFor({ bot, text, project });
      const blocking = needs.filter((n) => !n.canSkip || body.anyway !== true);
      if (blocking.length) {
        audit({ actor: "owner", actorName: "You", kind: "task", ok: false, action: `Tried to assign a task to the ${bot.title || bot.name}; not started`, detail: blocking.map((n) => `${n.title}: ${n.detail}`).join(" | ") });
        return send(res, 200, { needs: blocking, repositories: getConfig().projects });
      }
      audit({ actor: "owner", actorName: "You", kind: "task", action: `Assigned a task to the ${bot.title || bot.name}`, detail: String(body.title || text).slice(0, 300) });
      try {
        return send(res, 200, questSummary(await quests.start({ bot, text, title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined, project: project ?? undefined })));
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    const quest = id ? questStore.get(id) : null;
    if (!quest) throw new HttpError(404, "Quest not found.");
    const attemptQuest = async <T>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
    };
    // One task: everything about it, its journal, and the shared board of the task tree it belongs to.
    if (!action && req.method === "GET") return send(res, 200, { ...questSummary(quest), journal: journal.read(id), board: board.list(orgs.active(), rootOf(quest)) });
    // The owner posts to that board: the agents on the task see it when they next read it or start.
    if (action === "board" && req.method === "POST") {
      try {
        return send(res, 200, board.post(orgs.active(), rootOf(quest), "owner", body.kind, body.text));
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    // The receipt covers the whole task: asked for from one of its parts, it is the receipt of the task that part came from.
    if (action === "receipt" && req.method === "GET") return send(res, 200, receiptOf(rootOf(quest)));
    // A finished task's report, saved as a page in the workspace.
    if (action === "file" && req.method === "POST") {
      const text = lastWords(conversations.get(quest.id));
      if (!text) throw new HttpError(400, "This task has no report to save yet.");
      try {
        return send(res, 200, fileReport(orgs.active(), quest.id, String(body.title ?? "").trim() || quest.title, text, body.parent));
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    if (action === "stop" && req.method === "POST") {
      quests.stop(id);
      return send(res, 200, { ok: true });
    }
    if (action === "escalate" && req.method === "POST") {
      const cfg = getConfig();
      // Hand it to Claude: the default model if that is Claude, else Claude's strongest.
      const model = typeof body.model === "string" && body.model ? body.model : cfg.model.startsWith("anthropic/") ? cfg.model : "anthropic/claude-opus-5-5";
      if (model.startsWith("anthropic/") && !publicConfig().hasApiKey) throw new HttpError(400, "Connect Anthropic (Claude) under Integrations → AI models to hand tasks to Claude.");
      return send(res, 200, await attemptQuest(async () => (await quests.escalate(id, model), { ok: true, model })));
    }
    if (action === "changes" && req.method === "GET") return send(res, 200, await attemptQuest(() => quests.changes(id)));
    if (action === "accept" && req.method === "POST") return send(res, 200, await attemptQuest(() => quests.accept(id)));
    if (action === "undo" && req.method === "POST") return send(res, 200, await attemptQuest(async () => (await quests.undo(id), { ok: true })));
    if (!action && req.method === "DELETE") {
      if (engine.isRunning(id)) throw new HttpError(409, "Stop the quest first.");
      if (quest.copy && !quest.outcome) await attemptQuest(() => quests.undo(id));
      conversations.remove(id);
      questStore.remove(id);
      return send(res, 200, { ok: true });
    }
  }

  // Mistakes in what was typed (a bad schedule, a full memory) come back as plain messages.
  const attempt = async <T>(fn: () => T | Promise<T>) => {
    try {
      return (await fn()) ?? { ok: true };
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError((err as { status?: number }).status ?? 400, (err as Error).message);
    }
  };

  // The gateway to AI models: every service Talqava can connect, and the ones that are.
  if (parts[0] === "gateway") {
    if (req.method === "GET" && !parts[1]) return send(res, 200, await gatewayState());
    if (req.method === "POST" && parts[1] === "find-local") return send(res, 200, await attempt(() => findLocal()));
    if (req.method === "PUT" && parts[1] === "backups") return send(res, 200, await attempt(() => setBackups(body.backups)));
    if (req.method === "POST" && parts[1] && parts[2] === "connect") return send(res, 200, await attempt(() => connect(parts[1], body)));
    if (req.method === "DELETE" && parts[1]) return send(res, 200, await attempt(() => disconnect(parts[1])));
  }


  if (route === "GET memory") return send(res, 200, memory.list());
  if (route === "POST memory") return send(res, 200, await attempt(() => memory.add(body.text, body.space ? String(body.space) : undefined)));
  if (route === "PATCH memory") {
    const patch: { text?: string; space?: string | null } = {};
    if (body.text !== undefined) patch.text = String(body.text);
    if (body.space !== undefined) patch.space = body.space ? String(body.space) : null;
    return send(res, 200, await attempt(() => memory.update(parts[1], patch)));
  }
  if (route === "DELETE memory") return send(res, 200, await attempt(() => memory.remove(parts[1])));

  // The library: documents the person shares with their agents, kept in the organization's database.
  // ---------- goals and projects: what the work is for ----------
  if (parts[0] === "goals" || parts[0] === "projects") {
    const org = orgs.active();
    const [kind, id] = parts;
    if (req.method === "GET" && !id) return send(res, 200, { goals: goals.list(org), projects: goals.projects(org) });
    if (kind === "goals") {
      if (req.method === "POST" && !id) return send(res, 200, await attempt(() => goals.create(org, body)));
      if (req.method === "PATCH" && id) return send(res, 200, await attempt(() => goals.update(org, id, body)));
      if (req.method === "DELETE" && id) return send(res, 200, await attempt(() => goals.remove(org, id)));
    } else {
      if (req.method === "POST" && !id) return send(res, 200, await attempt(() => goals.createProject(org, body)));
      if (req.method === "PATCH" && id) return send(res, 200, await attempt(() => goals.updateProject(org, id, body)));
      if (req.method === "DELETE" && id) return send(res, 200, await attempt(() => goals.removeProject(org, id)));
    }
    throw new HttpError(404, "Not found.");
  }

  // ---------- tasks as work items: the board, each agent's queue, review and comments ----------
  if (parts[0] === "work") {
    const org = orgs.active();
    const [, id, action] = parts;
    if (route === "GET work" && !id) return send(res, 200, { items: work.list(org), priorities: PRIORITIES });
    if (route === "GET work" && id && !action) {
      return send(res, 200, await attempt(() => {
        const item = work.get(org, id);
        const quest = item.quest ? questStore.get(item.quest) : null;
        return { item, comments: work.comments(org, id), subtasks: work.list(org).filter((x) => x.parent === id).reverse(), quest: quest ? questSummary(quest) : null };
      }));
    }
    if (route === "POST work" && !id) {
      // The same checks as before any task: what it cannot do without is caught first, for free.
      const onlyOne = !body.project && body.project !== "" && getConfig().projects.length === 1 ? getConfig().projects[0] : null;
      const project = body.project ? projectOrNull(String(body.project)) : onlyOne;
      if (body.project && !project) throw new HttpError(400, "Connect that repository under Integrations → Git first.");
      const bot = loadCrew(project ?? undefined).bots.find((b) => b.id === body.owner);
      if (!bot) throw new HttpError(400, "Choose an agent for the task.");
      const text = String(body.description || body.title || "").trim();
      if (!text) throw new HttpError(400, "Say what the task is.");
      const needs = needsFor({ bot, text, project });
      const blocking = needs.filter((n) => !n.canSkip || body.anyway !== true);
      if (blocking.length) return send(res, 200, { needs: blocking, repositories: getConfig().projects });
      return send(res, 200, await attempt(async () => {
        const item = work.create(org, { title: body.title, description: body.description ?? body.title, owner: bot.id, priority: body.priority, parent: body.parent, createdBy: "owner", review: true, project: project ?? null, goal: body.goal, projectId: body.projectId });
        await work.schedule();
        const now = work.get(org, item.id);
        const quest = now.quest ? questStore.get(now.quest) : null;
        return { item: now, quest: quest ? questSummary(quest) : null };
      }));
    }
    if (route === "PATCH work" && id) return send(res, 200, await attempt(() => work.update(org, id, body)));
    if (route === "POST work" && id && action === "cancel") return send(res, 200, await attempt(() => work.cancel(org, id)));
    if (route === "POST work" && id && action === "accept") return send(res, 200, await attempt(() => work.accept(org, id)));
    if (route === "POST work" && id && action === "retry") return send(res, 200, await attempt(() => work.retry(org, id)));
    if (route === "POST work" && id && action === "comment") return send(res, 200, await attempt(() => work.comment(org, id, body.text)));
    throw new HttpError(404, "Not found.");
  }

  // ---------- the user guides ----------
  if (parts[0] === "guide" && req.method === "GET") {
    const ready = GUIDES.filter((g) => fs.existsSync(path.join(ROOT, g.file)));
    if (!parts[1]) return send(res, 200, ready.map(({ id, title }) => ({ id, title })));
    const doc = ready.find((g) => g.id === parts[1]);
    if (!doc) throw new HttpError(404, "There is no such guide.");
    return send(res, 200, { id: doc.id, title: doc.title, markdown: fs.readFileSync(path.join(ROOT, doc.file), "utf8") });
  }

  // ---------- the app's licence, privacy policy, terms and other policies, for the About and legal pages ----------
  if (parts[0] === "legal" && req.method === "GET") {
    const docs = LEGAL_DOCS;
    if (!parts[1]) return send(res, 200, docs.map(({ id, title }) => ({ id, title })));
    const doc = docs.find((d) => d.id === parts[1]);
    const file = doc && path.join(ROOT, doc.file);
    if (!doc || !file || !fs.existsSync(file)) throw new HttpError(404, "There is no such document.");
    return send(res, 200, { id: doc.id, title: doc.title, markdown: fs.readFileSync(file, "utf8") });
  }

  // ---------- the workspace: pages the owner and the agents share ----------
  if (parts[0] === "workspace") {
    const org = orgs.active();
    const [, area, id, sub, extra] = parts;
    if (route === "GET workspace" && !area) return send(res, 200, { tree: workspace.tree(org), templates: workspace.templates(), deleted: workspace.deleted(org), suggestions: workspace.suggestions(org) });
    if (route === "GET workspace" && area === "search") return send(res, 200, workspace.search(org, null, url.searchParams.get("q") ?? "", 20));
    if (route === "POST workspace" && area === "templates" && id) return send(res, 200, await attempt(() => workspace.addTemplate(org, id)));
    if (area === "suggestions") {
      if (route === "GET workspace") return send(res, 200, workspace.suggestions(org, url.searchParams.get("page") ?? undefined, url.searchParams.get("all") ? "all" : "open"));
      if (route === "POST workspace" && id) return send(res, 200, await attempt(() => workspace.decide(org, id, body.decision, body.replace === true)));
    }
    if (area === "pages") {
      if (route === "POST workspace" && !id) return send(res, 200, await attempt(() => workspace.create(org, null, { parent: body.parent, title: body.title, markdown: body.markdown, icon: body.icon })));
      if (route === "GET workspace" && id && !sub) return send(res, 200, await attempt(() => workspace.get(org, id)));
      if (route === "PUT workspace" && id && !sub) return send(res, 200, await attempt(() => workspace.save(org, id, body.markdown, body.baseRev)));
      if (route === "PATCH workspace" && id && !sub) return send(res, 200, await attempt(() => workspace.update(org, id, body)));
      if (route === "DELETE workspace" && id && !sub) return send(res, 200, await attempt(() => workspace.archive(org, id)));
      if (route === "POST workspace" && id && sub === "restore") return send(res, 200, await attempt(() => workspace.restore(org, id)));
      if (route === "GET workspace" && id && sub === "revisions" && !extra) return send(res, 200, await attempt(() => workspace.revisions(org, id)));
      if (route === "GET workspace" && id && sub === "revisions" && extra) return send(res, 200, await attempt(() => workspace.revision(org, id, Number(extra))));
      if (route === "POST workspace" && id && sub === "revisions" && extra) return send(res, 200, await attempt(() => workspace.restoreRevision(org, id, Number(extra))));
      if (route === "GET workspace" && id && sub === "tasks") {
        return send(res, 200, await attempt(() => {
          workspace.get(org, id);
          return workspace.tasksOf(org, id).map((u) => ({ ...u, title: questStore.get(u.task)?.title ?? conversations.get(u.task)?.title ?? "A task", agent: questStore.get(u.task)?.bot.name ?? null }));
        }));
      }
    }
    throw new HttpError(404, "Not found.");
  }

  if (parts[0] === "library") {
    const org = orgs.active();
    if (upload) {
      return send(res, 200, await attempt(async () => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > 60_000_000) throw new Error("That file is larger than 60 MB. Put it in the library folder yourself; very large files are skipped.");
          chunks.push(chunk as Buffer);
        }
        return library.add(org, decodeURIComponent(url.searchParams.get("name") ?? "file"), Buffer.concat(chunks), url.searchParams.get("folder") ?? EVERYONE);
      }));
    }
    // Who may use a file or folder, as the page sends it: every agent, some departments and agents, private, or as its folder says.
    const accessFrom = (b: any) => (b.mode === "inherit" ? null : b.mode === "private" ? { private: true } : b.mode === "everyone" ? { everyone: true } : { everyone: false, departments: b.departments, agents: b.agents });
    const items = (list: unknown) => (Array.isArray(list) ? list : []).map((i: any) => ({ kind: i?.kind === "folder" ? ("folder" as const) : ("file" as const), path: String(i?.path ?? "") }));
    if (route === "GET library" && !parts[1]) {
      const changed = await syncLibrary(org).catch((err) => ({ error: (err as Error).message }));
      const departments = [...new Set(org.members.map((m) => m.department))].sort();
      return send(res, 200, { organization: org.name, folder: libraryFolder(org.id), departments, agents: org.members.map((m) => m.bot), documents: library.list(org), folders: library.folders(org), deleted: library.deleted(org), stats: library.stats(org), changed });
    }
    if (route === "GET library" && parts[2] === "raw") {
      // The file itself, to show in the app. Anything that could run code is sent as plain text or kept in a sandbox.
      const { doc, full } = (() => {
        try {
          return library.file(org, Number(parts[1]));
        } catch (err) {
          throw new HttpError(404, (err as Error).message);
        }
      })();
      const VIEW: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg" };
      const type = VIEW[doc.type] ?? (doc.readable ? "text/plain; charset=utf-8" : "application/octet-stream");
      res.writeHead(200, {
        "content-type": type,
        "content-length": String(fs.statSync(full).size),
        "content-disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": doc.type === "pdf" ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      });
      fs.createReadStream(full).pipe(res);
      return;
    }
    if (route === "GET library" && parts[2] === "text") return send(res, 200, await attempt(() => library.read(org, null, Number(parts[1]), 1, 60_000)));
    if (route === "POST library" && parts[1] === "search") {
      return send(res, 200, await attempt(async () => {
        await syncLibrary(org);
        const as = typeof body.as === "string" && body.as ? body.as : null;
        return { hits: library.search(org, as, String(body.query ?? ""), 8) };
      }));
    }
    if (route === "POST library" && parts[1] === "open") {
      return send(res, 200, await attempt(() => {
        // Shows a folder (or one file, selected) in the computer's own file browser.
        const root = ensureFolders(org);
        const file = body.id !== undefined ? library.file(org, Number(body.id)).full : null;
        const folder = file ? null : path.resolve(root, ...String(body.path ?? "").split("/").filter((x) => x && x !== ".."));
        if (folder && folder !== root && !folder.startsWith(root + path.sep)) throw new Error("That is not in the library.");
        const [command, args] = process.platform === "darwin" ? ["open", file ? ["-R", file] : [folder!]] : process.platform === "win32" ? ["explorer", file ? [`/select,${file}`] : [folder!]] : ["xdg-open", [file ? path.dirname(file) : folder!]];
        execFile(command, args, () => {});
        return { folder: root };
      }));
    }
    if (route === "POST library" && parts[1] === "launch") {
      // Opens a file in the app this computer uses for it (Preview, Word, Excel…).
      return send(res, 200, await attempt(() => {
        const { full } = library.file(org, Number(body.id));
        const [command, args] = process.platform === "darwin" ? ["open", [full]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", full]] : ["xdg-open", [full]];
        execFile(command, args, () => {});
        return { ok: true };
      }));
    }
    if (route === "POST library" && parts[1] === "folders") return send(res, 200, await attempt(() => library.makeFolder(org, body.parent, body.name)));
    if (route === "POST library" && parts[1] === "move") return send(res, 200, await attempt(() => library.move(org, items(body.items), body.to, body.name)));
    if (route === "POST library" && parts[1] === "delete") return send(res, 200, await attempt(async () => (await library.remove(org, items(body.items)), { ok: true })));
    if (route === "POST library" && parts[1] === "restore") return send(res, 200, await attempt(() => library.restore(org, body.id)));
    if (route === "POST library" && parts[1] === "purge") return send(res, 200, await attempt(() => library.purge(org, body.all === true ? "all" : body.id)));
    if (route === "PATCH library" && parts[1] === "folder") return send(res, 200, await attempt(() => library.setFolderAccess(org, body.path, accessFrom(body))));
    if (route === "PATCH library" && parts[1]) return send(res, 200, await attempt(() => library.setAccess(org, Number(parts[1]), body.mode ? accessFrom(body) : body.folderDecides === true ? null : { everyone: body.everyone === true, departments: body.departments, agents: body.agents })));
    if (route === "DELETE library" && parts[1]) return send(res, 200, await attempt(async () => (await library.remove(org, Number(parts[1])), { ok: true })));
  }

  if (route === "GET audit") {
    return send(res, 200, readAudit({ limit: Number(url.searchParams.get("limit")) || 500, actor: url.searchParams.get("actor") || undefined, kind: url.searchParams.get("kind") || undefined, q: url.searchParams.get("q") || undefined, since: url.searchParams.get("since") || undefined }));
  }

  // The inbox: what the person has read, saved, archived or deleted, and the names they gave their agents.
  // Messages themselves come from the tasks; only these marks are kept here.
  if (parts[0] === "inbox") {
    type Mark = { readAt?: string; starred?: boolean; archived?: boolean; deletedAt?: string; purged?: boolean };
    const file = path.join(DATA, "inbox.json");
    const box = { messages: {} as Record<string, Mark>, names: {} as Record<string, string>, ...readJson<{ messages?: Record<string, Mark>; names?: Record<string, string> }>(file, {}) };
    const save = () => writeJson(file, box);
    const ids = (list: unknown) => (Array.isArray(list) ? list : []).map(String).filter((id) => /^[a-z]+:[\w:.-]{1,120}$/.test(id)).slice(0, 500);
    if (route === "GET inbox") return send(res, 200, box);
    if (route === "PATCH inbox") {
      const now = new Date().toISOString();
      for (const id of ids(body.ids)) {
        const m = (box.messages[id] ??= {});
        if (body.read === true) m.readAt = now;
        if (body.read === false) delete m.readAt;
        if (typeof body.starred === "boolean") m.starred = body.starred || undefined;
        if (typeof body.archived === "boolean") m.archived = body.archived || undefined;
        if (body.deleted === true) m.deletedAt = now;
        if (body.deleted === false) delete m.deletedAt, delete m.purged;
        if (body.purge === true && m.deletedAt) m.purged = true;
      }
      // Deleted messages are kept 30 days, then hidden for good.
      for (const m of Object.values(box.messages) as Mark[]) if (m.deletedAt && Date.now() - new Date(m.deletedAt).getTime() > 30 * 24 * 3600 * 1000) m.purged = true;
      save();
      return send(res, 200, box);
    }
    if (route === "PUT inbox" && parts[1] === "names" && parts[2]) {
      const bot = decodeURIComponent(parts[2]);
      if (!/^[\w.-]{1,80}$/.test(bot)) throw new HttpError(400, "No such agent.");
      const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (name) box.names[bot] = name;
      else delete box.names[bot];
      save();
      return send(res, 200, box);
    }
  }

  // Integrations: the outside tools agents work with. Git is the first.
  if (parts[0] === "integrations") {
    if (route === "GET integrations" && !parts[1]) return send(res, 200, await listIntegrations());
    if (route === "GET integrations" && parts[1] === "git") return send(res, 200, await gitIntegration());
    if (route === "GET integrations" && parts[1] === "mcp") return send(res, 200, mcpIntegration());
    if (route === "GET integrations" && parts[1] === "openrouter") return send(res, 200, await openrouterIntegration());
    if (route === "POST integrations" && parts[1] === "openrouter") {
      // Sign-in starts from the address the app is open on, so OpenRouter can send the person back to it.
      if (parts[2] === "start") return send(res, 200, await attempt(async () => startOpenRouterSignIn(`${req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host}`)));
      if (parts[2] === "key") return send(res, 200, await attempt(async () => (await saveOpenRouterKey(body.key), { ok: true })));
      if (parts[2] === "use") return send(res, 200, await attempt(() => useOpenRouterModel(body.model)));
      if (parts[2] === "refresh") return send(res, 200, await attempt(async () => ({ models: (await openrouterModels(true)).length })));
      if (parts[2] === "remove") return send(res, 200, await attempt(async () => removeOpenRouter()));
    }
    if (route === "POST integrations" && parts[1] === "mcp" && parts[2] === "claude-desktop") return send(res, 200, await attempt(() => setClaudeDesktop(body.remove !== true)));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "clone") {
      return send(res, 200, await attempt(async () => {
        const folder = await cloneRepository(body.url);
        saveConfig({ projects: [...new Set([...getConfig().projects, folder])] });
        return { path: folder };
      }));
    }
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "github-start") return send(res, 200, await attempt(() => startGithubSignIn()));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "github-poll") return send(res, 200, await attempt(() => pollGithubSignIn()));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "github-client") {
      return send(res, 200, await attempt(() => {
        const id = String(body.clientId ?? "").trim();
        if (id && !/^[A-Za-z0-9._-]{10,60}$/.test(id)) throw new Error("That does not look like a GitHub Client ID. It is a short code such as Ov23li… shown on the app's page on GitHub.");
        saveConfig({ githubClientId: id });
        return { ok: true };
      }));
    }
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "github-accounts") return send(res, 200, await attempt(() => githubAccounts()));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "github-repos") return send(res, 200, await attempt(() => githubRepos(body.account)));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "remove") return send(res, 200, await attempt(() => removeGitIntegration(body.deleteCopies === true)));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "disconnect") return send(res, 200, await attempt(() => disconnectRepository(body.path, body.deleteCopy === true)));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "auto") return send(res, 200, await attempt(() => autoSetupGit(body.scan === true)));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "install") return send(res, 200, await attempt(() => installGit()));
    if (route === "POST integrations" && parts[1] === "git" && parts[2] === "test-github") return send(res, 200, await attempt(() => testGithub()));
  }

  // Organizations: bots in roles, with titles, departments and managers.
  if (parts[0] === "orgs") {
    const [, orgId, sub, memberId] = parts;
    if (route === "GET orgs" && !orgId) {
      const listed = orgs.list();
      // Each organization comes with the rule its structure sets; the structures themselves are sent once.
      return send(res, 200, { ...listed, orgs: listed.orgs.map((o) => ({ ...o, assignRule: assignRule(o), requestRule: requestRule(o), groupSpend: groupSpend(o.id), proposals: listProposals(o.id).filter((p) => p.status === "open") })),
        structures: STRUCTURES,
        assignRules: ASSIGN_RULES,
        requestRules: REQUEST_RULES,
        // For each kind of business, the agents each structure would seat, so the page can say what setting one up adds.
        industries: INDUSTRIES.map((i) => ({ id: i.id, name: i.name, examples: i.examples, recommended: i.recommended, why: i.why, seats: Object.fromEntries(STRUCTURES.map((x) => [x.id, seatsFor(x.id, i).map((seat) => seat.bot)])), sizes: Object.fromEntries(STRUCTURES.map((x) => [x.id, chartSize(seatsFor(x.id, i))])) })),
      });
    }
    // An organization as one readable file, and a file imported as a new organization.
    if (route === "POST orgs" && orgId === "import") return send(res, 200, await attempt(() => importOrg(body.text)));
    if (route === "GET orgs" && sub === "export") return send(res, 200, await attempt(() => exportOrg(orgId)));
    if (route === "POST orgs" && !orgId) return send(res, 200, await attempt(() => orgs.create(body.name, body.mission, body.structure)));
    if (route === "POST orgs" && sub === "build") return send(res, 200, await attempt(() => buildStructure(orgId, String(body.structure ?? ""), body.industry === undefined ? undefined : String(body.industry), body.exact !== false)));
    if (route === "POST orgs" && sub === "reset") {
      // Start over, at the owner's request: an empty chart, or an empty chart with the organization's example copied onto it.
      return send(res, 200, await attempt(() => {
        const org = orgs.list().orgs.find((o) => o.id === orgId);
        if (!org) throw new Error("No such organization.");
        orgs.clear(orgId);
        if (body.mode === "empty") return orgs.active();
        return buildStructure(orgId, org.structure);
      }));
    }
    // The app no longer redraws an owner's chart from a structure: lines are only ever drawn by the owner.
    if (route === "POST orgs" && sub === "arrange") throw new HttpError(410, "The chart is no longer redrawn from a structure. Drag positions to set who reports to whom.");
    if (route === "POST orgs" && sub === "suggest") return send(res, 200, await attempt(() => suggestPositions(orgId, body.mission, Number(body.limit) || 6)));
    if (route === "POST orgs" && sub === "accept") return send(res, 200, await attempt(() => acceptSuggestion(orgId, body)));
    // A ready-made team dropped where the owner put it: under a position, into a group, or under the owner.
    if (route === "POST orgs" && sub === "pack") return send(res, 200, await attempt(() => addPack(orgId, String(body.team ?? ""), { under: body.under, group: body.group })));
    // Positions the agents proposed, and the owner's answer to one.
    if (route === "GET orgs" && sub === "proposals") return send(res, 200, listProposals(orgId));
    if (route === "POST orgs" && sub === "proposals" && parts[3]) return send(res, 200, await attempt(() => decide(orgId, parts[3], body.decision, body.answer)));
    if (route === "PUT orgs" && sub === "chart") return send(res, 200, await attempt(() => orgs.replaceChart(orgId, body)));
    if (route === "POST orgs" && sub === "groups") return send(res, 200, await attempt(() => orgs.addGroup(orgId, body)));
    if (route === "PATCH orgs" && sub === "groups" && memberId) return send(res, 200, await attempt(() => orgs.updateGroup(orgId, memberId, body)));
    if (route === "DELETE orgs" && sub === "groups" && memberId) return send(res, 200, await attempt(() => orgs.removeGroup(orgId, memberId, url.searchParams.get("moveTo") ?? body.moveTo)));
    if (route === "POST orgs" && sub === "members" && memberId && parts[4] === "agent") return send(res, 200, await attempt(() => orgs.swapAgent(orgId, memberId, body.to)));
    if (route === "GET orgs" && sub === "memory") return send(res, 200, orgMemory.list(orgId));
    if (route === "POST orgs" && sub === "memory") {
      return send(res, 200, await attempt(() => {
        const shelf = body.shelf === "dept" || body.shelf === "agent" ? body.shelf : "org";
        return orgMemory.add({ org: orgId, shelf, key: String(body.key ?? ""), text: body.text, by: "You" });
      }));
    }
    if (route === "PATCH orgs" && sub === "memory" && memberId) return send(res, 200, await attempt(() => orgMemory.update(orgId, memberId, body.text)));
    if (route === "DELETE orgs" && sub === "memory" && memberId) return send(res, 200, await attempt(() => (orgMemory.remove(orgId, memberId), { ok: true })));
    if (route === "PATCH orgs" && orgId && !sub) {
      return send(res, 200, await attempt(() => {
        if (body.active) orgs.setActive(orgId);
        return orgs.update(orgId, { name: body.name, mission: body.mission, structure: body.structure, philosophy: body.philosophy, assign: body.assign, industry: body.industry, approvalLimit: body.approvalLimit });
      }));
    }
    if (route === "DELETE orgs" && orgId && !sub) return send(res, 200, await attempt(() => (orgs.remove(orgId), orgMemory.purge(orgId), removeLibrary(orgId), { ok: true })));
    if (route === "PUT orgs" && sub === "members") return send(res, 200, await attempt(() => orgs.setMember(orgId, body)));
    if (route === "DELETE orgs" && sub === "members" && memberId) return send(res, 200, await attempt(() => orgs.removeMember(orgId, memberId)));
    if (route === "DELETE orgs" && sub === "teams" && memberId) return send(res, 200, await attempt(() => orgs.removeTeam(orgId, memberId)));
  }

  if (route === "GET spaces") return send(res, 200, spaces.list());
  if (route === "POST spaces") return send(res, 200, await attempt(() => spaces.create(body.name)));
  if (route === "PATCH spaces") return send(res, 200, await attempt(() => spaces.rename(parts[1], body.name)));
  if (route === "DELETE spaces") return send(res, 200, await attempt(() => spaces.remove(parts[1])));

  if (route === "GET skills") return send(res, 200, skills.list());
  if (route === "DELETE skills") return send(res, 200, await attempt(() => skills.remove(decodeURIComponent(parts[1]))));

  if (route === "GET jobs") {
    const all = await jobs.list();
    const known = new Map(orgs.list().orgs.flatMap((o) => o.members.map((m) => [`${o.id}|${m.bot}`, { title: m.title, org: o.name }] as const)));
    return send(res, 200, all.map((j) => ({ ...j, plain: describeSchedule(j.schedule), ownerName: j.owner ? (known.get(`${j.org}|${j.owner}`)?.title ?? null) : null, ownerOrg: j.owner ? (known.get(`${j.org}|${j.owner}`)?.org ?? null) : null })));
  }
  if (route === "POST jobs" && !parts[1]) return send(res, 200, await attempt(() => jobs.create({ ...body, owner: jobOwner(body.owner), org: body.owner ? orgs.active().id : null })));
  if (route === "POST jobs" && parts[2] === "run") {
    const job = (await jobs.list()).find((j) => j.id === parts[1]);
    if (!job) throw new HttpError(404, "That schedule no longer exists.");
    const ran = await attempt(() => runJob(job));
    await jobs.update(job.id, { lastRunAt: new Date().toISOString() });
    return send(res, 200, ran);
  }
  if (route === "PATCH jobs") {
    const { enabled, ...rest } = body;
    if (Object.keys(rest).length) await attempt(() => jobs.edit(parts[1], { ...rest, ...(rest.owner !== undefined ? { owner: jobOwner(rest.owner), org: orgs.active().id } : {}) }));
    return send(res, 200, enabled === undefined ? (await jobs.list()).find((j) => j.id === parts[1]) : await attempt(() => jobs.update(parts[1], { enabled: Boolean(enabled) })));
  }
  if (route === "DELETE jobs") return send(res, 200, await attempt(() => jobs.remove(parts[1])));

  throw new HttpError(404, "Not found.");
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    checkOrigin(req);
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/api/")) {
      const parts = url.pathname.split("/").filter(Boolean).slice(1);
      const record = req.method !== "GET" && req.method !== "OPTIONS" && parts[0] !== "audit";
      try {
        await api(req, res, url);
        if (record) {
          const d = describeRequest(req.method ?? "", parts, (req as { auditBody?: unknown }).auditBody ?? {}, url);
          if (d) audit({ actor: "owner", actorName: "You", ...d, ok: res.statusCode < 400 });
        }
      } catch (err) {
        if (record) {
          const d = describeRequest(req.method ?? "", parts, (req as { auditBody?: unknown }).auditBody ?? {}, url);
          if (d && parts[0] !== "login") audit({ actor: "owner", actorName: "You", ...d, ok: false, detail: `${d.detail ? `${d.detail} · ` : ""}Refused: ${(err as Error).message}` });
        }
        throw err;
      }
      return;
    }
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    return serveStatic(res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Something went wrong on the server." : (err as Error).message });
    else res.end();
  }
}

export function start() {
  if (!LOCAL_HOSTS.has(HOST) && !PASSWORD) {
    console.error(
      `Refusing to start: HOST is ${HOST}, which other machines can reach, but ${BRAND.envPrefix}PASSWORD is not set.\n` +
        `This agent can run commands, so it must not be open to a network without a password. Set ${BRAND.envPrefix}PASSWORD in .env.`,
    );
    process.exit(1);
  }
  initStore();
  getConfig();
  const server = http.createServer(handle);
  server.listen(PORT, HOST, () => {
    // If Talqava was added to the Claude app from an older copy of this app (it was renamed), point Claude at this one.
    // Only the desktop app does this, so running from the code folder never repoints Claude.
    if (process.env.ELECTRON_RUN_AS_NODE === "1") import("./mcpintegration.ts").then((m) => m.refreshClaudeDesktop()).catch(() => {});
    audit({ actor: "system", actorName: "Talqava", kind: "other", action: "Started the app" });
    console.log(`${BRAND.name} is running at http://${LOCAL_HOSTS.has(HOST) ? "localhost" : HOST}:${PORT}`);
    console.log(`Data: ${DATA}\nWorkspace: ${WORKSPACE}`);
    // A note of where this app is listening, so the Talqava MCP server (run by Claude or another AI app) can find it.
    try {
      const address = server.address();
      fs.writeFileSync(path.join(DATA, "running.json"), JSON.stringify({ port: typeof address === "object" && address ? address.port : PORT, pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    } catch {}
  });
  jobs.start(runJob);
  // Quests that were under way when the app last closed carry on.
  quests
    .resumeAll()
    .then((ids) => ids.length && console.log(`Resumed ${ids.length} quest${ids.length === 1 ? "" : "s"} that ${ids.length === 1 ? "was" : "were"} under way.`))
    .catch((err) => console.error("Could not resume quests:", err))
    // Then each free agent starts its next task, and the queues are looked at again every few seconds.
    .finally(() => work.kick());
  setInterval(() => void work.schedule(), 5000).unref();
  return server;
}
