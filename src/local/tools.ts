// Tools that only make sense on the user's own machine: a shell and direct
// file access. The hosted edition never loads this file.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  clip,
  defineTool,
  MAX_OUTPUT,
  conversationSearchTool,
  httpTool,
  memoryTool,
  scheduleTool,
  skillTool,
  selectMemory,
  systemPrompt,
  BRAND,
  botPrompt,
  limitProjectBot,
  pageTool,
  setting,
} from "../core/index.ts";
import type { Bot, Conversation, JobBook, Model, Power, RunSpec, Tool } from "../core/index.ts";
import { boardPrompt, boardTool } from "./board.ts";
import { MAX_DEPTH, MAX_OPEN_HANDOFFS, chainBudget, chainCost, chainOf, chainOver, questStore, quests, rootOf, whyPrompt } from "./quests.ts";
import { propose } from "./proposals.ts";
import { loadCrew } from "./crew.ts";
import { assignableBy, groupModelOf, memberOf, oneLine, orgs, reportsOf, requestableBy, rolePrompt } from "./orgs.ts";
import { orgMemoryPrompt, teamMemoryTool } from "./orgmemory.ts";
import { libraryPrompt, libraryTool, GENERAL_AGENT } from "./library.ts";
import { workspacePrompt, workspaceTool } from "./workspace.ts";
import { tableTool } from "./tables.ts";
import { guard } from "./guardrails.ts";
import { sheetTool } from "./sheets.ts";
import { goalsPrompt } from "./goals.ts";
import { structureOf } from "./structures.ts";
import { WORKSPACE, conversations, getConfig, memory, skills, spaces } from "./store.ts";
import { resolveModel, strongerThan } from "./models.ts";
import { isLocalRef } from "./gateway.ts";
import { connectorTools } from "./connectors.ts";
import { browserAvailable, browserTool } from "./browser.ts";

const BASH_TIMEOUT_MS = Number(setting("BASH_TIMEOUT_MS") || 120_000);

// ---------- files, confined to the workspace ----------
export function safePath(requested: string, root = WORKSPACE): string {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, String(requested));
  // Follow symlinks on the part of the path that already exists.
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = path.join(fs.realpathSync(existing), path.relative(existing, target));
  const rel = path.relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`"${requested}" is outside the workspace. Files must stay inside the workspace folder.`);
  }
  return real;
}

interface EditorInput {
  command: string;
  path: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  view_range?: [number, number];
}

function editFile(input: EditorInput, root: string): string {
  const file = safePath(input.path, root);
  switch (input.command) {
    case "view": {
      if (fs.statSync(file).isDirectory()) {
        const names = fs.readdirSync(file, { withFileTypes: true });
        return names.map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).join("\n") || "(empty folder)";
      }
      let lines = fs.readFileSync(file, "utf8").split("\n");
      let start = 1;
      if (Array.isArray(input.view_range)) {
        const [from, to] = input.view_range;
        start = Math.max(1, from);
        lines = lines.slice(start - 1, to === -1 ? undefined : to);
      }
      return clip(lines.map((line, i) => `${String(start + i).padStart(5)}  ${line}`).join("\n"));
    }
    case "create":
      if (typeof input.file_text !== "string") throw new Error("create needs file_text.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, input.file_text);
      return `Wrote ${input.path}.`;
    case "str_replace": {
      if (typeof input.old_str !== "string") throw new Error("str_replace needs old_str.");
      const text = fs.readFileSync(file, "utf8");
      const count = text.split(input.old_str).length - 1;
      if (count !== 1) throw new Error(`old_str was found ${count} times in ${input.path}; it must match exactly once.`);
      fs.writeFileSync(file, text.replace(input.old_str, () => input.new_str ?? ""));
      return `Edited ${input.path}.`;
    }
    case "insert": {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const at = Number(input.insert_line);
      if (!Number.isInteger(at) || at < 0 || at > lines.length) throw new Error("insert_line is out of range.");
      lines.splice(at, 0, String(input.insert_text ?? input.new_str ?? ""));
      fs.writeFileSync(file, lines.join("\n"));
      return `Inserted into ${input.path}.`;
    }
    default:
      throw new Error(`Unknown editor command "${input.command}".`);
  }
}

const isObject = (input: unknown): input is Record<string, unknown> =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);

/** The file tool, confined to one folder. */
export const makeEditorTool = (root: string): Tool => ({
  name: "str_replace_based_edit_tool",
  definition: { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
  portable: {
    description:
      "Views, creates and edits files in the workspace. view: show a file with line numbers, or list a folder. create: write file_text to path. str_replace: replace old_str (which must appear exactly once) with new_str. insert: insert insert_text after line insert_line (0 for the top).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["view", "create", "str_replace", "insert"] },
        path: { type: "string", description: "Path relative to the workspace." },
        file_text: { type: "string" },
        old_str: { type: "string" },
        new_str: { type: "string" },
        insert_line: { type: "number" },
        insert_text: { type: "string" },
        view_range: { type: "array", items: { type: "number" }, description: "[first line, last line]; -1 for the end." },
      },
      required: ["command", "path"],
    },
  },
  validate: (input) =>
    isObject(input) && typeof input.command === "string" && typeof input.path === "string" ? null : "missing command or path",
  needsApproval: (input: EditorInput) => input.command !== "view",
  run: (input: EditorInput) => editFile(input, root),
});
export const editorTool = makeEditorTool(WORKSPACE);

// ---------- shell ----------
interface BashInput {
  command?: string;
  restart?: boolean;
}

function runBash(input: BashInput, signal: AbortSignal, cwd: string): Promise<string> {
  if (input.restart) return Promise.resolve("Each command already starts in a fresh shell in the workspace folder.");
  // The shell does not inherit the agent's own keys or password.
  const env = { ...process.env };
  const hidden = new RegExp(`^(ANTHROPIC_|${BRAND.envPrefix}PASSWORD)`);
  for (const key of Object.keys(env)) {
    if (hidden.test(key)) delete env[key];
  }
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", input.command ?? ""], { cwd, env, detached: true });
    let output = "";
    let note = "";
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      note = `\n[stopped: ran longer than ${BASH_TIMEOUT_MS / 1000} seconds]`;
      kill();
    }, BASH_TIMEOUT_MS);
    const onAbort = () => {
      note = "\n[stopped by the user]";
      kill();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT * 4) output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => {
      // On Windows the shell comes with Git for Windows; say so instead of a bare "not found".
      note = (err as NodeJS.ErrnoException).code === "ENOENT" && process.platform === "win32" ? "\n[could not start: the bash shell was not found. Install Git for Windows from git-scm.com, then restart Talqava.]" : `\n[could not start: ${err.message}]`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(`${clip(output)}${note}\n[exit code ${code ?? "none"}]`.trim());
    });
  });
}

/** The shell, starting in one folder. */
export const makeBashTool = (root: string): Tool => ({
  name: "bash",
  definition: { type: "bash_20250124", name: "bash" },
  portable: {
    description: "Runs a bash command in the workspace folder and returns its output. Each command starts in a fresh shell.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  validate: (input) => (isObject(input) && (input.restart === true || typeof input.command === "string") ? null : "missing command"),
  needsApproval: (input: BashInput) => input.restart !== true,
  run: (input: BashInput, { signal }) => runBash(input, signal, root),
});
export const bashTool = makeBashTool(WORKSPACE);

// ---------- putting a run together ----------
/** Every tool the local edition offers. */
export async function localTools(jobs: JobBook): Promise<Tool[]> {
  const tools = [
    bashTool,
    editorTool,
    memoryTool(memory),
    conversationSearchTool(conversations),
    skillTool(skills),
    httpTool(() => getConfig().secrets),
    scheduleTool(jobs),
  ];
  if (await browserAvailable()) tools.push(browserTool);
  return tools;
}

/** The owner's saved skills, for reading only: every agent follows them, whether or not it may write new ones. */
const skillReader = defineTool<{ name: string }>({
  name: "skill",
  description: "Procedures the owner has saved for how work is done here. Read the one that covers your task before you start it, and follow it.",
  properties: { name: { type: "string", description: "The skill's name, as listed under Skills." } },
  required: ["name"],
  async run(input) {
    const skill = skills.list().find((s) => s.name === String(input.name ?? "").trim());
    if (!skill) throw new Error(`No skill named "${input.name}". The skills are: ${skills.list().map((s) => s.name).join(", ") || "none"}.`);
    return skill.content;
  },
});

/** What the person is asking about now: the latest thing they said, and the chat's title. */
function topicOf(conversation?: Conversation): string {
  const said = [...(conversation?.messages ?? [])].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  return `${typeof said?.content === "string" ? said.content.slice(0, 2000) : ""} ${conversation?.title ?? ""}`;
}

export function localPrompt(root = WORKSPACE, agentName = getConfig().agentName, extra: string[] = [], conversation?: Conversation): string {
  // General memory, plus the memory of the conversation's space; what fits this conversation is shown.
  const space = spaces.get(conversation?.space);
  const { shown, hidden } = selectMemory(memory.list(), space?.id, topicOf(conversation));
  return systemPrompt({
    agentName,
    setting: "running on the user's own machine",
    environment: [
      `Your working folder is ${root}. File paths are relative to it and files cannot leave it. Each shell command starts in a fresh shell in that folder, so chain steps that depend on each other in one command.`,
      ...extra,
    ],
    memory: shown,
    hiddenMemory: hidden,
    space: space ? { id: space.id, name: space.name } : undefined,
    skills: skills.list(),
  });
}

const HOSTED_WEB = [
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
] as RunSpec["hostedTools"];

/** Tools that bring outside content into a run. After one of them, every change asks first. */
export const CAUTION_TOOLS = ["web_search", "web_fetch", "read_page", "http_request", "browser"];

/** Only the tools a bot's powers grant, working in the quest's own folder. */
async function botTools(bot: Bot, root: string, jobs: JobBook, claude: boolean): Promise<Tool[]> {
  const has = (power: Power) => bot.powers.includes(power);
  const tools: Tool[] = [];
  if (has("files")) tools.push(makeEditorTool(root));
  if (has("shell")) tools.push(makeBashTool(root));
  if (has("memory")) tools.push(memoryTool(memory));
  if (has("skills")) tools.push(skillTool(skills));
  else if (skills.list().length) tools.push(skillReader);
  if (has("search")) tools.push(conversationSearchTool(conversations));
  if (has("api")) tools.push(httpTool(() => getConfig().secrets));
  if (has("schedule")) tools.push(scheduleTool(jobs));
  if (has("browser") && (await browserAvailable())) tools.push(browserTool);
  if (has("web") && !claude) tools.push(pageTool());
  return tools;
}

/**
 * Hands a task to another bot. A bot may assign only to its direct reports on
 * the org chart; the general chat agent, which speaks for the person, may
 * assign to any member. The task runs as a quest of its own, and its report
 * comes back to this conversation as a message.
 */
export const assignTool: Tool = defineTool<{ to: string; task: string }>({
  name: "assign_task",
  description:
    "Hand a task to another agent in the organization. It works on its own and does not see this conversation, so put everything it needs in the task: the goal, the facts, and what a good result looks like. Its report arrives here later as a message. After assigning, do not wait or guess the result: finish anything that does not depend on it, then end your turn.",
  properties: {
    to: { type: "string", description: "The name of the agent to assign to, e.g. its job title." },
    task: { type: "string", description: "The whole task, written so it can be done without any other context." },
  },
  required: ["to", "task"],
  async run(input, { conversation }) {
    const org = orgs.active();
    const crew = loadCrew().bots;
    const quest = questStore.get(conversation.id);
    const callerId = quest?.bot.id ?? conversation.bot ?? null;
    const caller = callerId ? crew.find((b) => b.id === callerId) : undefined;
    const allowed = (callerId ? assignableBy(org, callerId) : org.members).map((m) => crew.find((b) => b.id === m.bot)).filter((b): b is Bot => Boolean(b));
    if (!allowed.length) throw new Error(callerId ? "Nobody takes tasks from you, so there is no one to assign to. Do the work yourself, or say in your report who it belongs to." : "The organization has no agents yet.");
    const wanted = String(input.to ?? "").trim().toLowerCase();
    const target = findColleague(allowed, org, wanted);
    if (!target) throw new Error(`You can assign only to ${allowed.map((b) => b.name).join(", ")}.`);
    const task = String(input.task ?? "").trim();
    if (task.length < 10) throw new Error("Say what the task is, with everything the agent needs to know.");
    if ((quest?.depth ?? 0) >= MAX_DEPTH) throw new Error(`Tasks can be handed down ${MAX_DEPTH} levels at most. Do this one yourself.`);
    noRoundTrip(quest, target);
    const { work } = await import("./work.ts");
    const open = questStore.list().filter((q) => q.parent?.id === conversation.id && !q.parent.delivered).length + work.pendingFor(conversation.id);
    if (open >= MAX_OPEN_HANDOFFS) throw new Error(`${MAX_OPEN_HANDOFFS} tasks you assigned are still open. Wait for their reports before assigning more.`);
    withinChainBudget(quest);
    const by = caller?.name ?? getConfig().agentName;
    const text = `${task}\n\n[Assigned by ${by}${caller ? `, the ${memberOf(org, caller.id)?.title ?? caller.title}` : ", on the user's behalf"}. You cannot see their conversation, so work from this task alone. End with a short report of what you did and what you found: it is sent back to ${by}.]`;
    // The hand-off is a sub-task of the caller's task, in the receiver's queue: it starts when the receiver is free.
    const item = work.create(org, { title: task, description: task, owner: target.id, createdBy: callerId ?? "chat", review: false, parent: work.ofQuest(org, conversation.id)?.id ?? null, project: quest?.project ?? null, handoff: { conversation: conversation.id, by, text } });
    await work.schedule();
    const placed = work.get(org, item.id);
    const who = `${target.name} (${memberOf(org, target.id)?.title ?? target.title})`;
    if (placed.status === "blocked") throw new Error(`The task could not start: ${placed.detail}`);
    return `${placed.status === "todo" ? `Assigned to ${who} as task #${placed.number}. It is busy with other work, so this is number ${placed.queue} in its queue and starts when it is free.` : `Assigned to ${who} as task #${placed.number}; it has started.`} Its report will arrive here as a message when it is done. Do not wait for it or guess what it will say: end your turn once anything that does not depend on it is finished.`;
  },
});

/** Questions one task may put to colleagues. Asking around is the most expensive way to learn that nobody knows. */
const MAX_QUESTIONS = 3;

/** Refuses a hand-off when the task it belongs to has used the budget it shares with everything handed on from it. */
function withinChainBudget(quest: ReturnType<typeof questStore.get>) {
  const root = quest ? rootOf(quest) : null;
  if (root && chainOver(root)) throw new Error("This task and what was handed on from it have used the whole budget for one task ($" + chainBudget().toFixed(2) + "). Hand on nothing more: finish with what you have, and say plainly what is not done and what it would take.");
}

/** A colleague by its file name, its name or its title in this organization. */
function findColleague(among: Bot[], org: ReturnType<typeof orgs.active>, wanted: string): Bot | undefined {
  return among.find((b) => b.id === wanted || b.name.toLowerCase() === wanted) ?? among.find((b) => memberOf(org, b.id)?.title.toLowerCase() === wanted);
}

/** The agent a conversation belongs to: a task's agent, or the one a chat is with. None for the general chat agent. */
function agentOf(conversationId: string): Bot | undefined {
  const id = questStore.get(conversationId)?.bot.id ?? conversations.get(conversationId)?.bot ?? null;
  return id ? loadCrew().bots.find((b) => b.id === id) : undefined;
}

/**
 * Puts a question to a colleague. Any member may ask any other, whatever the
 * structure: the chart decides who hands out work, not who may talk. The
 * question runs as a short task of its own with a small budget, and the
 * answer comes back to this conversation as a message.
 */
export const askTool: Tool = defineTool<{ to: string; question: string }>({
  name: "ask_colleague",
  description:
    "Ask one colleague a question. Use it only when that colleague's own job means they hold something you need: a fact from their department, a decision they made. Each question costs money, and a task may ask at most three. Never put the same question to several colleagues, and never ask around to see who knows: a colleague knows only what is in the organization's memory and library, which you can search yourself, plus their own notes. They answer briefly and the answer arrives here as a message, so finish anything that does not depend on it and end your turn. It is for questions, not for handing over work (use assign_task for that). Leave the name out to see who you can ask.",
  properties: {
    to: { type: "string", description: "The colleague's name or job title." },
    question: { type: "string", description: "The question, with the context needed to answer it. They cannot see this conversation." },
  },
  required: ["question"],
  async run(input, { conversation }) {
    const org = orgs.active();
    const crew = loadCrew().bots;
    const quest = questStore.get(conversation.id);
    const caller = agentOf(conversation.id);
    const others = org.members.filter((m) => m.bot !== caller?.id).map((m) => crew.find((b) => b.id === m.bot)).filter((b): b is Bot => Boolean(b));
    const directory = () => others.map((b) => `- ${b.name}${memberOf(org, b.id)!.title.toLowerCase() === b.name.toLowerCase() ? "" : ` (${memberOf(org, b.id)!.title})`}, ${memberOf(org, b.id)!.department}: ${oneLine(b)}`).join("\n");
    if (!others.length) throw new Error("There is nobody else in the organization to ask.");
    const wanted = String(input.to ?? "").trim().toLowerCase();
    const target = wanted ? findColleague(others, org, wanted) : undefined;
    if (!target) return `${wanted ? "Nobody by that name. " : ""}You can ask:\n${directory()}`;
    const question = String(input.question ?? "").trim();
    if (question.length < 8) throw new Error("Say what you are asking, with the context needed to answer it.");
    if (quest?.kind) throw new Error("You are answering a question yourself. Answer from what you know, and say what you are unsure of.");
    if ((quest?.depth ?? 0) >= MAX_DEPTH) throw new Error("This task is already several hand-offs deep. Work from what you have, and say what you could not confirm.");
    noRoundTrip(quest, target);
    const open = questStore.list().filter((q) => q.parent?.id === conversation.id && !q.parent.delivered).length;
    if (open >= MAX_OPEN_HANDOFFS) throw new Error(`${MAX_OPEN_HANDOFFS} tasks and questions of yours are still open. Wait for them before asking more.`);
    const asked = questStore.list().filter((q) => q.parent?.id === conversation.id && q.kind === "question");
    if (asked.length >= MAX_QUESTIONS) throw new Error("You have already asked " + MAX_QUESTIONS + " colleagues in this task, which is the most one task may ask. Work from what you have and what the organization's memory and library hold; if something essential is still missing, say so in your report and name who the owner should ask.");
    const sameAs = (title: string) => title.replace(/^Question: /, "").slice(0, 60) === question.replace(/\s+/g, " ").slice(0, 60);
    if (asked.some((q) => sameAs(q.title))) throw new Error("You have already put this same question to a colleague. Do not poll several colleagues with one question: ask the one whose job it is, once.");
    withinChainBudget(quest);
    const by = caller?.name ?? getConfig().agentName;
    const text = `${question}\n\n[A question from ${by}${caller ? `, the ${memberOf(org, caller.id)?.title ?? caller.title}` : ", on the user's behalf"}. Answer it in a few sentences from what you know, the organization's memory and a quick look if one is needed. Do not start a piece of work or change anything. If you do not know, say so and say who might. Your answer is sent back to ${by}.]`;
    await quests.start({ bot: target, text, title: `Question: ${question}`, parent: { id: conversation.id, by }, kind: "question" });
    return `Asked ${target.name}. The answer will arrive here as a message. Do not wait for it or guess what it will say: end your turn once anything that does not depend on it is finished.`;
  },
});

/**
 * Requests work from another department or team. Unlike assign_task this is
 * not an order: the one asked accepts and does it (handing parts to its own
 * team) or declines with a reason. Who may be asked depends on the structure:
 * see requestableBy.
 */
export const requestTool: Tool = defineTool<{ to: string; request: string; why?: string }>({
  name: "request_work",
  description:
    "Request work from another department or team, when a task needs something that is not your department's job. It is a request, not an order: they accept and do it, or decline and say why. Their answer or report arrives here as a message, so finish what does not depend on it and end your turn. Use assign_task for your own reports and ask_colleague for a question.",
  properties: {
    to: { type: "string", description: "The name or job title of the lead you are asking." },
    request: { type: "string", description: "What you need, written so it can be done without any other context, and what a good result looks like." },
    why: { type: "string", description: "Why it is needed and by when, so they can weigh it against their own priorities." },
  },
  required: ["to", "request"],
  async run(input, { conversation }) {
    const org = orgs.active();
    const crew = loadCrew().bots;
    const quest = questStore.get(conversation.id);
    const caller = agentOf(conversation.id);
    if (!caller) throw new Error("You speak for the owner, so hand the work over with assign_task instead.");
    const allowed = requestableBy(org, caller.id).map((m) => crew.find((b) => b.id === m.bot)).filter((b): b is Bot => Boolean(b));
    if (!allowed.length) throw new Error("In this organization, work for another department goes through your lead. Use escalate to raise it with them.");
    const wanted = String(input.to ?? "").trim().toLowerCase();
    const target = findColleague(allowed, org, wanted);
    if (!target) throw new Error(`You can request work only from ${allowed.map((b) => b.name).join(", ")}. For anyone else, use escalate to raise it with your lead.`);
    const request = String(input.request ?? "").trim();
    if (request.length < 10) throw new Error("Say what you need, with everything they need to know.");
    if (quest?.kind) throw new Error("You are answering a question yourself. Say in your answer what work is needed and from whom.");
    if ((quest?.depth ?? 0) >= MAX_DEPTH) throw new Error("This task is already several hand-offs deep. Say in your report what is needed from the other department.");
    noRoundTrip(quest, target);
    const { work } = await import("./work.ts");
    const open = questStore.list().filter((q) => q.parent?.id === conversation.id && !q.parent.delivered).length + work.pendingFor(conversation.id);
    if (open >= MAX_OPEN_HANDOFFS) throw new Error(`${MAX_OPEN_HANDOFFS} tasks and requests of yours are still open. Wait for them before making more.`);
    withinChainBudget(quest);
    const why = String(input.why ?? "").trim();
    const text = `${request}${why ? `\n\nWhy and by when: ${why}` : ""}\n\n[A request from ${caller.name}, the ${memberOf(org, caller.id)?.title ?? caller.title} in ${memberOf(org, caller.id)?.department ?? "another department"}. This is a request from a colleague, not an order from your lead. Weigh it against your own priorities and decision rights. If you accept, do it or hand its parts to your team, and end with a short report. If you decline, say so in one line with the reason and what would change your answer. You cannot see their conversation. Your reply is sent back to ${caller.name}.]`;
    const item = work.create(org, { title: `Request: ${request}`, description: request, owner: target.id, createdBy: caller.id, review: false, parent: work.ofQuest(org, conversation.id)?.id ?? null, project: quest?.project ?? null, handoff: { conversation: conversation.id, by: caller.name, text } });
    await work.schedule();
    const placed = work.get(org, item.id);
    if (placed.status === "blocked") throw new Error(`The request could not start: ${placed.detail}`);
    return `Requested from ${target.name} as task #${placed.number}${placed.status === "todo" ? `; it is number ${placed.queue} in their queue` : ""}. Their answer or report will arrive here as a message. Do not wait for it or assume they will accept: end your turn once anything that does not depend on it is finished.`;
  },
});

/**
 * Takes a decision that is not the agent's own to its lead: a conflict
 * between two leads, something above its decision rights, a block. The lead
 * decides on a small budget, or says it must go higher.
 */
export const escalateTool: Tool = defineTool<{ issue: string; options: string; recommendation: string }>({
  name: "escalate",
  description:
    "Take a decision to your lead when it is not yours to make: two leads want different things from you, the task needs something above your decision rights, or you are blocked on another department. Give the issue, the options and your recommendation. Their decision arrives here as a message. Do not use it for things you may decide yourself.",
  properties: {
    issue: { type: "string", description: "What needs deciding and why you cannot decide it, with the facts they need." },
    options: { type: "string", description: "The options, each with what it costs or risks." },
    recommendation: { type: "string", description: "Which option you would choose and why." },
  },
  required: ["issue", "options", "recommendation"],
  async run(input, { conversation }) {
    const org = orgs.active();
    const quest = questStore.get(conversation.id);
    const caller = agentOf(conversation.id);
    const me = caller ? memberOf(org, caller.id) : null;
    const boss = me?.manager ? loadCrew().bots.find((b) => b.id === me.manager) : undefined;
    const issue = String(input.issue ?? "").trim();
    if (issue.length < 10) throw new Error("Say what needs deciding, with the facts needed to decide it.");
    if (!caller || !boss) return "You report to the owner. Stop here and put this to them at the top of your report, under the heading “Needs your decision”: the issue, the options and your recommendation.";
    if (quest?.kind) throw new Error("You are answering a question or deciding an escalation yourself. If it is not yours to decide either, say so and say who must.");
    const open = questStore.list().filter((q) => q.parent?.id === conversation.id && !q.parent.delivered).length;
    if (open >= MAX_OPEN_HANDOFFS) throw new Error(`${MAX_OPEN_HANDOFFS} tasks and requests of yours are still open. Wait for them first.`);
    const text = `${issue}\n\nOptions: ${String(input.options ?? "").trim()}\n\nTheir recommendation: ${String(input.recommendation ?? "").trim()}\n\n[Escalated to you by ${caller.name}, the ${me!.title}, who reports to you. Decide it if it is within what you decide yourself: say which option, in one line why, and anything they must do differently. If it is above your decision rights too, do not decide: say that it must go to your own lead or to the owner, and what they will need to know. Save a decision others will need to the organization's memory. Your answer is sent back to ${caller.name}.]`;
    await quests.start({ bot: boss, text, title: `Decision needed: ${issue}`, parent: { id: conversation.id, by: caller.name }, kind: "decision" });
    return `Escalated to ${boss.name}. Their decision will arrive here as a message. Carry on with anything that does not depend on it, then end your turn.`;
  },
});

/** Organization memory for whoever is running in a conversation. */
const teamMemory = teamMemoryTool((conversationId) => {
  const bot = agentOf(conversationId);
  return bot ? { id: bot.id, name: bot.name } : null;
});

/** What a member of the organization gets for working with others: hand-offs to those it leads, requests across departments, escalation to its lead, questions, and the shared memory. */
/**
 * Proposes a new position to the owner. Only a lead (of a group, or of anyone) may, since it is the one that sees
 * where work falls through. The chart does not change: the owner approves or declines in the app.
 */
export const proposeTool: Tool = defineTool<{ role: string; why: string; reportsTo?: string; group?: string }>({
  name: "propose_position",
  description:
    "Propose a new position for the organization, when your group keeps meeting work nobody on the chart can do. The owner approves or declines it in the app; nothing changes until then, so carry on with the team you have and do not wait. Use it rarely: one well-argued proposal, not several. Leave the role empty to see which roles can be proposed.",
  properties: {
    role: { type: "string", description: "The role, by its title, e.g. Bookkeeper." },
    why: { type: "string", description: "What work it would do that nobody does now, and what that costs the organization today. One or two sentences, for the owner." },
    reportsTo: { type: "string", description: "Who it would report to, by title. Leave it out to have it report to you." },
    group: { type: "string", description: "The group it would join. Leave it out for the group of whoever it reports to." },
  },
  required: ["why"],
  async run(input, { conversation }) {
    const caller = agentOf(conversation.id);
    if (!caller) throw new Error("You speak for the owner, so tell them what position you would add and why.");
    const p = propose(orgs.active().id, caller.id, input);
    return `Proposed ${p.title} in ${p.group}, reporting to ${p.reportsTo === caller.id ? "you" : p.reportsTo}. The owner decides in the app; nothing changes until then. Carry on with the team you have.`;
  },
});

function teamworkTools(org: ReturnType<typeof orgs.active>, botId: string): Tool[] {
  const leads = assignableBy(org, botId).length > 0 || (org.groups ?? []).some((g) => g.lead === botId);
  return [
    ...(assignableBy(org, botId).length ? [assignTool] : []),
    ...(requestableBy(org, botId).length ? [requestTool] : []),
    ...(memberOf(org, botId)?.manager ? [escalateTool] : []),
    ...(org.members.length > 1 ? [askTool] : []),
    teamMemory,
    libraryForAgents,
    workspaceForAgents,
    tablesForAgents,
    sheetsForAgents,
    ...(leads ? [proposeTool] : []),
  ];
}

/** The organization's library of documents, for whoever is running in a conversation. */
const libraryForAgents = libraryTool((conversationId) => agentOf(conversationId)?.id ?? GENERAL_AGENT);
/** The organization's workspace of pages, for whoever is running in a conversation. */
const workspaceForAgents = workspaceTool((conversationId) => agentOf(conversationId)?.id ?? GENERAL_AGENT);
/** The workspace's tables (customer lists, trackers), for whoever is running in a conversation. */
const tablesForAgents = tableTool((conversationId) => agentOf(conversationId)?.id ?? GENERAL_AGENT);
/** Office sheets (budgets, forecasts), for whoever is running in a conversation. */
const sheetsForAgents = sheetTool((conversationId) => agentOf(conversationId)?.id ?? GENERAL_AGENT);

/**
 * Which model an agent's run uses, and how hard it thinks. An agent with a
 * model of its own keeps it. Otherwise, with cost saving on and one of
 * Claude's larger models as the main model, the work is matched to a model
 * that fits it: a manager who plans and checks keeps the main model, a team
 * member doing its part uses the mid-size model, and a quick question or a
 * decision uses the small one. That alone cuts the cost of a team task
 * several times over. Which model the owner's money runs on is the owner's
 * choice, so cost saving is off until they switch it on under Settings; with
 * it off, everything uses the main model.
 */
export function costModel(cfg: ReturnType<typeof getConfig>, bot: Bot, work: "manager" | "member" | "question", override?: string): { ref: string; effort: ReturnType<typeof getConfig>["effort"] } {
  if (override) return { ref: override, effort: cfg.effort };
  if (bot.model) return { ref: bot.model, effort: work === "question" ? "low" : cfg.effort };
  const savings = cfg.savings ?? "off";
  if (savings === "off") return { ref: cfg.model, effort: work === "question" ? "low" : cfg.effort };
  const slash = cfg.model.indexOf("/");
  const provider = cfg.providers.find((p) => p.id === cfg.model.slice(0, slash));
  const large = provider?.kind === "anthropic" && /opus|fable/.test(cfg.model.slice(slash + 1));
  if (large) {
    // Claude's own sizes: the small one for questions, the mid-size one for a member's part (or for everything but
    // managing, with "cheapest"), the owner's model for those who plan and check.
    if (work === "question") return { ref: `${provider!.id}/claude-haiku-5-5`, effort: "low" };
    if (work === "member") return { ref: `${provider!.id}/claude-sonnet-5-5`, effort: "medium" };
    return savings === "cheapest" ? { ref: `${provider!.id}/claude-sonnet-5-5`, effort: "medium" } : { ref: cfg.model, effort: cfg.effort };
  }
  // Any other service: chosen among the models the owner set up (the team's model and its backups) that cost less
  // than the team's model, so cost saving never picks a model the owner did not choose.
  const cheaper = cheaperChoices(cfg);
  if (!cheaper.length) return { ref: cfg.model, effort: work === "question" ? "low" : cfg.effort };
  if (work === "question") return { ref: cheaper[0], effort: "low" };
  if (work === "member") return { ref: savings === "cheapest" ? cheaper[0] : cheaper[cheaper.length - 1], effort: cfg.effort };
  return savings === "cheapest" ? { ref: cheaper[cheaper.length - 1], effort: cfg.effort } : { ref: cfg.model, effort: cfg.effort };
}

/**
 * The owner's own backup models that cost less than the team's model, cheapest first. Only ones whose prices are
 * known, and never a model online in place of one on this computer (the owner chose to keep the work private).
 */
function cheaperChoices(cfg: ReturnType<typeof getConfig>): string[] {
  let main: Model;
  try {
    main = resolveModel({ ...cfg, backups: [] }, cfg.model);
  } catch {
    return [];
  }
  const local = isLocalRef(cfg.model);
  const mainPrice = main.prices ? main.prices.input + main.prices.output : undefined;
  if (mainPrice === undefined) return [];
  const priced: { ref: string; price: number }[] = [];
  for (const ref of cfg.backups ?? []) {
    if (ref === cfg.model || (local && !isLocalRef(ref))) continue;
    try {
      const p = resolveModel({ ...cfg, backups: [] }, ref).prices;
      if (p && p.input + p.output < mainPrice) priced.push({ ref, price: p.input + p.output });
    } catch {
      // A backup whose service was disconnected is skipped.
    }
  }
  return priced.sort((a, b) => a.price - b.price).map((x) => x.ref);
}

/** Tools an agent may use while it is still writing its plan: reading and looking things up, nothing that changes anything. */
const PLANNING_TOOLS = new Set(["memory", "skill", "conversation_search", "web_search", "web_fetch", "read_page", "library", "workspace", "team_memory", "board", "submit_plan"]);

const PLAN_PROMPT =
  "Before doing this task, plan it, and wait for the owner's approval. Look into what you need (read the library, the workspace, memory, the web if you may), but change nothing and hand nothing on yet. " +
  "Then call submit_plan once with: a two- or three-sentence summary of how you will do it and what the owner gets; the steps in order, each with who does it (you, or the title of someone you would hand it to); and your estimate of what carrying it out will cost in dollars. " +
  "Then end your turn. If the owner asks for changes, revise and submit again.";

/** An agent sends its plan for the owner's approval. Its run ends, and it carries on once the owner decides. */
export const submitPlanTool: Tool = defineTool<{ summary: string; steps: { what: string; who: string }[]; estimate?: number }>({
  name: "submit_plan",
  description: "Sends your plan for this task to the owner for approval, then you stop until they approve it or ask for changes. Give a short summary, the steps in order (what, and who does it), and your cost estimate in dollars.",
  properties: {
    summary: { type: "string", description: "Two or three sentences: how you will do it, and what the owner gets." },
    steps: { type: "array", items: { type: "object", properties: { what: { type: "string" }, who: { type: "string", description: "You, or the title of the colleague you would hand it to." } }, required: ["what", "who"] }, description: "The steps, in order." },
    estimate: { type: "number", description: "What carrying out the plan will cost, in US dollars." },
  },
  required: ["summary", "steps"],
  run(input, { conversation }) {
    const summary = String(input.summary ?? "").trim();
    const steps = Array.isArray(input.steps) ? input.steps.map((s) => ({ what: String(s?.what ?? "").trim().slice(0, 300), who: String(s?.who ?? "you").trim().slice(0, 80) || "you" })).filter((s) => s.what) : [];
    if (summary.length < 20) throw new Error("Write a short summary of how you will do the task and what the owner gets.");
    if (!steps.length) throw new Error("List the steps, in order, each with who does it.");
    const estimate = Number.isFinite(Number(input.estimate)) && Number(input.estimate) >= 0 ? Math.round(Number(input.estimate) * 100) / 100 : null;
    quests.planSubmitted(conversation.id, { summary: summary.slice(0, 1200), steps: steps.slice(0, 20), estimate });
    return "Your plan is with the owner. End your turn now: you will be told when it is approved, or what to change.";
  },
});

/** Every task's run stops after this long, besides its budget; a question to a colleague much sooner. */
const TASK_LIMITS = { minutes: 30 };
const QUESTION_LIMITS = { minutes: 5 };

/**
 * Work or a question sent back to an agent further up the same chain goes round in circles (A hands to B, B asks A).
 * It is refused, and the agent is told to finish its part and say in its report what it needs.
 */
function noRoundTrip(quest: ReturnType<typeof questStore.get>, target: Bot) {
  const seen = new Set<string>();
  for (let q = quest; q?.parent && !seen.has(q.id); q = questStore.get(q.parent.id)) {
    seen.add(q.id);
    const up = questStore.get(q.parent.id);
    if (up?.bot.id === target.id)
      throw new Error(`The ${target.name} is further up this same task: it handed this work on. Sending work or questions back to it would go round in circles. Finish your part from what you have, and say in your report what you need from the ${target.name}.`);
  }
}

/** A question is answered on a small budget: a few steps, and no hand-offs of its own. */
const QUESTION_BUDGET = { steps: 3, spend: 0.05 };

/** What a bot is told when the person chats with it directly, in place of the line about being sent on a quest. */
function botChatPrompt(bot: Bot): string {
  return [
    "# Your role",
    `You are ${bot.name}. ${bot.instructions}`,
    "The user is talking with you directly. Stay in your role: answer and act as this bot, with only the tools listed for you. If they ask for something outside your job, say so plainly and name who in the organization does it.",
  ].join("\n\n");
}

/** A line for the general agent about the bots it can hand work to. */
function orgOverview(): string[] {
  const org = orgs.active();
  const crew = new Map(loadCrew().bots.map((b) => [b.id, b]));
  const members = org.members.filter((m) => crew.has(m.bot));
  if (!members.length) return [];
  const lines = members.map((m) => {
    const leads = reportsOf(org, m.bot).length;
    return `  - ${crew.get(m.bot)!.name} (${m.title}, ${m.department}${leads ? `, leads ${leads}` : ""}): ${oneLine(crew.get(m.bot)!)}`;
  });
  return [
    `The user runs an organization of agents called ${org.name}${org.mission ? ` (mission: ${org.mission})` : ""}, with a chart its owner drew. When a job fits one of them better than doing it yourself, or the user asks for an agent, hand it over with assign_task; a job for a whole department or team goes to the agent that leads it, which hands the parts to its own reports. Use ask_colleague for a quick question. Their reports and answers come back here as messages. The agents:\n${lines.join("\n")}`,
  ];
}

/** Connector tools for a run, and a line for the prompt about any connector that did not answer. */
async function connectors(enabled: boolean) {
  const cfg = getConfig();
  if (!enabled || !cfg.mcpServers.length) return { tools: [] as Tool[], note: [] as string[], names: [] as string[] };
  const { tools, problems } = await connectorTools(cfg.mcpServers);
  const note = problems.length ? [`These connectors could not be reached, so their tools are missing: ${problems.join("; ")}.`] : [];
  return { tools, note, names: tools.map((t) => t.name) };
}

/** Part of a task's budget kept for the agent who leads it, so it can always write the owner its report. */
export const LEAD_RESERVE = 0.2;

/**
 * What a task, or a part handed on from it, may still spend of the budget they share. The lead may use all that
 * is left. Parts leave the lead's reserve alone, and parts working at the same time split the rest evenly, so
 * together they cannot run past the budget.
 */
export function shareLeft(questId: string): number {
  const quest = questStore.get(questId);
  if (!quest) return Infinity;
  const rootId = rootOf(quest);
  const left = chainBudget() - chainCost(rootId);
  if (rootId === questId) return left;
  const busy = chainOf(rootId).filter((q) => q.id !== rootId && (q.status === "running" || q.status === "waiting" || q.id === questId)).length;
  return (left - chainBudget() * LEAD_RESERVE) / Math.max(1, busy);
}

/** Builds what the engine needs for one run, from the settings file and, for a quest, its bot. */
export function localRunSpec(jobs: JobBook) {
  const build = unguardedRunSpec(jobs);
  // The organization's guardrails are applied to every run, in this one place, after everything else is decided.
  return async (conversation: Conversation): Promise<RunSpec> => {
    const quest = conversation.source === "quest" ? questStore.get(conversation.id) : null;
    return guard(await build(conversation), quest ? `the ${quest.bot.title || quest.bot.name}` : "the assistant");
  };
}

function unguardedRunSpec(jobs: JobBook) {
  return async (conversation: Conversation): Promise<RunSpec> => {
    const cfg = getConfig();
    const quest = conversation.source === "quest" ? questStore.get(conversation.id) : null;
    if (quest) {
      const bot = limitProjectBot(quest.bot, cfg);
      // A manager (anyone with someone to hand work to) keeps the main model; a member doing its own part gets a cheaper one.
      const manages = assignableBy(orgs.active(), bot.id).length > 0 || bot.lead;
      // A group's own model counts as the agent's own, unless the agent has one.
      const groupModel = bot.model ? undefined : groupModelOf(orgs.active(), bot.id);
      const choice = costModel(cfg, groupModel ? { ...bot, model: groupModel } : bot, quest.kind ? "question" : manages ? "manager" : "member", quest.modelOverride);
      const model = resolveModel({ ...cfg, effort: choice.effort }, choice.ref);
      const claude = model.kind === "anthropic";
      const root = quest.copy?.worktree ?? WORKSPACE;
      const linked = await connectors(bot.powers.includes("connectors"));
      const where = quest.copy
        ? [`You are working in your own copy of the repository ${quest.project}, on the branch ${quest.copy.branch}. The user reviews your changes before they keep them, so make the changes directly here; do not commit, push or switch branches.`]
        : quest.project
          ? [`This task is about the repository ${path.basename(quest.project)}. You cannot read or change its files yourself; hand the parts that need the code to a colleague who can.`]
          : cfg.projects.length
            ? [`No repository is attached to this task. The owner has connected ${cfg.projects.map((p) => path.basename(p)).join(", ")}. If the task needs the code, do not search for it and do not hand out work: stop and tell the owner to choose the repository in the Repository box on the Work in progress page and assign the task again.`]
            : ["No repository is connected. If the task needs code that you cannot see, do not hand out work: stop and tell the owner to connect the repository under Integrations, then assign the task again."];
      const org = orgs.active();
      const role = rolePrompt(bot, org);
      const onChart = Boolean(memberOf(org, bot.id));
      const remembered = onChart ? [goalsPrompt(org, bot.id), orgMemoryPrompt(org, bot.id, topicOf(conversation)), workspacePrompt(org, bot.id, topicOf(conversation)), libraryPrompt(org, bot.id, topicOf(conversation))].filter(Boolean).join("\n\n") : "";
      const question = Boolean(quest.kind);
      // Why the task exists, from the mission down: so a hand-off three levels deep still knows what it is for.
      const why = question ? "" : whyPrompt(quest);
      // Whoever may hand work to someone gets assign_task; every member can ask a colleague and use the shared memory.
      // Every agent on a task, and on the parts handed on from it, shares the task's board.
      const teamwork = !onChart ? [boardTool] : question ? [teamMemory, libraryForAgents, workspaceForAgents, tablesForAgents, sheetsForAgents, boardTool] : [...teamworkTools(org, bot.id), boardTool];
      const shared = question ? "" : boardPrompt(org, quest.id);
      if (question) {
        // Answering a colleague is a small job, so it is run as one: a short prompt with only who the agent is and
        // what the organization knows, the two look-up tools, low effort and a few steps. This is what keeps a
        // question to a cent or two instead of the cost of a full task.
        const me = memberOf(org, bot.id);
        return {
          model,
          system: [
            `You are the ${me?.title ?? bot.title} in the ${me?.department ?? bot.group} department of ${org.name}. ${oneLine(bot)}`,
            "A colleague has put a question to you, or asked you to decide something. Answer in a few sentences, from what you know and what the organization's memory and library hold. Look something up at most once or twice. Do not start any work, do not ask anyone else, and do not pad the answer. If you do not know, say so in one line and say who might.",
            // A question carries less of the organization's memory than a full task does.
            onChart ? [orgMemoryPrompt(org, bot.id, topicOf(conversation), 1200), libraryPrompt(org, bot.id, topicOf(conversation))].filter(Boolean).join("\n\n") : "",
            `Today's date is ${new Date().toDateString()}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          tools: teamwork,
          hostedTools: [],
          mcpServers: [],
          approvalMode: bot.approvals,
          budget: QUESTION_BUDGET,
          limits: QUESTION_LIMITS,
          cautionAfter: [...CAUTION_TOOLS],
          remaining: () => shareLeft(quest.id),
        };
      }
      // Big work is planned first: until the owner approves the plan, the agent can only look things up and submit it.
      const planning = Boolean(quest.plan && quest.plan.status !== "approved");
      const allTools = [...(await botTools(bot, root, jobs, claude)), ...teamwork, ...linked.tools];
      return {
        model,
        system: `${localPrompt(root, bot.name, [...where, ...linked.note], conversation)}\n\n${botPrompt(bot)}${role ? `\n\n${role}` : ""}${why ? `\n\n${why}` : ""}${remembered ? `\n\n${remembered}` : ""}${shared ? `\n\n${shared}` : ""}${planning ? `\n\n${PLAN_PROMPT}` : ""}`,
        tools: planning ? [...allTools.filter((t) => PLANNING_TOOLS.has(t.name)), submitPlanTool] : allTools,
        hostedTools: claude && bot.powers.includes("web") ? HOSTED_WEB : [],
        // Connectors are reached from this machine (see connectors.ts), so every model can use them.
        mcpServers: [],
        approvalMode: bot.approvals,
        budget: question ? QUESTION_BUDGET : { ...cfg.budget, ...bot.budget },
        limits: question ? QUESTION_LIMITS : TASK_LIMITS,
        // What a connector returns is outside content too.
        cautionAfter: [...CAUTION_TOOLS, ...linked.names],
        // The task and what is handed on from it share one budget, checked before every step.
        remaining: () => shareLeft(quest.id),
        // Stuck, it tries once with a stronger model the owner set up, before stopping.
        stronger: strongerThan(cfg, model),
      };
    }

    // A chat with one bot in its role: that bot's instructions, powers, model and limits.
    const chatBot = conversation.bot ? loadCrew().bots.find((b) => b.id === conversation.bot) : undefined;
    if (chatBot) {
      const model = resolveModel(cfg, chatBot.model ?? groupModelOf(orgs.active(), chatBot.id) ?? cfg.model);
      const claude = model.kind === "anthropic";
      const linked = await connectors(chatBot.powers.includes("connectors"));
      const org = orgs.active();
      const role = rolePrompt(chatBot, org);
      const onChart = Boolean(memberOf(org, chatBot.id));
      const remembered = onChart ? [goalsPrompt(org, chatBot.id), orgMemoryPrompt(org, chatBot.id, topicOf(conversation)), workspacePrompt(org, chatBot.id, topicOf(conversation)), libraryPrompt(org, chatBot.id, topicOf(conversation))].filter(Boolean).join("\n\n") : "";
      const teamwork = onChart ? teamworkTools(org, chatBot.id) : [];
      return {
        model,
        system: `${localPrompt(WORKSPACE, chatBot.name, linked.note, conversation)}\n\n${botChatPrompt(chatBot)}${role ? `\n\n${role}` : ""}${remembered ? `\n\n${remembered}` : ""}`,
        tools: [...(await botTools(chatBot, WORKSPACE, jobs, claude)), ...teamwork, ...linked.tools],
        hostedTools: claude && chatBot.powers.includes("web") ? HOSTED_WEB : [],
        mcpServers: [],
        approvalMode: chatBot.approvals,
        budget: { ...cfg.budget, ...chatBot.budget },
        cautionAfter: [...CAUTION_TOOLS, ...linked.names],
      };
    }

    const model = resolveModel(cfg);
    const tools = [...(await localTools(jobs)), ...(orgs.active().members.length ? [assignTool, askTool, teamMemory] : []), libraryForAgents, workspaceForAgents, tablesForAgents, sheetsForAgents];
    const claude = model.kind === "anthropic";
    const linked = await connectors(true);
    return {
      model,
      system: `${localPrompt(WORKSPACE, cfg.agentName, [...linked.note, ...orgOverview()], conversation)}${((m) => (m ? `\n\n${m}` : ""))([goalsPrompt(orgs.active(), null), orgs.active().members.length ? orgMemoryPrompt(orgs.active(), "", topicOf(conversation)) : "", workspacePrompt(orgs.active(), GENERAL_AGENT, topicOf(conversation)), libraryPrompt(orgs.active(), GENERAL_AGENT, topicOf(conversation))].filter(Boolean).join("\n\n"))}`,
      // Other models read the web with our own page reader; Claude uses Anthropic's.
      tools: [...(claude ? tools : [...tools, pageTool()]), ...linked.tools],
      hostedTools: claude ? HOSTED_WEB : [],
      mcpServers: [],
      approvalMode: cfg.approvalMode,
      budget: cfg.budget,
    };
  };
}
