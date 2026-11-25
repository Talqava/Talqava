// Talqava as an MCP server: lets Claude and other AI apps work with the
// person's Talqava team. Run by the other app as a program (stdio). It holds
// no data of its own: every tool calls the Talqava app running on this
// computer, so the same approvals, budgets and limits apply as in the app.
// Nothing is reachable from outside this computer.
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const DATA = path.resolve(process.env.TALQAVA_DATA_DIR || path.join(import.meta.dirname, "../../data"));

/** Where the running app listens: given outright, or read from the note the app leaves in its data folder when it starts. */
function appUrl(): string {
  if (process.env.TALQAVA_APP_URL) return process.env.TALQAVA_APP_URL.replace(/\/$/, "");
  try {
    const note = JSON.parse(fs.readFileSync(path.join(DATA, "running.json"), "utf8")) as { port?: number };
    if (note.port) return `http://127.0.0.1:${note.port}`;
  } catch {}
  throw new Error("Talqava is not running. Open the Talqava app on this computer, then try again.");
}

async function app<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${appUrl()}/api/${route}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) throw new Error("Talqava is not running. Open the Talqava app on this computer, then try again.");
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) throw new Error("Talqava asks people to sign in (a password, or people and roles under Security), so it cannot be used from another app yet.");
  if (!res.ok) throw new Error(data.error || `Talqava answered with an error (${res.status}).`);
  return data as T;
}

interface Bot {
  id: string;
  name: string;
  title: string;
  group: string;
  instructions: string;
}
interface Member {
  bot: string;
  title: string;
  department: string;
  manager: string | null;
}
interface Task {
  id: string;
  title: string;
  status: string;
  bot: { id: string; name: string };
  steps: number;
  cost: number;
  approvals: unknown[];
  parent: { by: string } | null;
  updatedAt: string;
  note: string | null;
}

async function team() {
  const [crew, orgs] = await Promise.all([app<{ bots: Bot[] }>("GET", "crew"), app<{ active: string; orgs: { id: string; name: string; mission: string; structure: string; members: Member[] }[] }>("GET", "orgs")]);
  const org = orgs.orgs.find((o) => o.id === orgs.active) ?? orgs.orgs[0];
  const byId = new Map(crew.bots.map((b) => [b.id, b]));
  const members = (org?.members ?? []).filter((m) => byId.has(m.bot));
  return { org, byId, members, crew: crew.bots };
}

const firstSentence = (text: string) => (text.split(/(?<=[.!?])\s+/)[0] ?? "").slice(0, 160);
const statusWords = (t: Task) => (t.approvals?.length ? "waiting for the owner's approval in the Talqava app" : ({ running: "working", waiting: "waiting for the owner's approval in the Talqava app", done: "finished", failed: `failed${t.note ? `: ${t.note}` : ""}`, stopped: "stopped", budget: "stopped at its budget" }[t.status] ?? t.status));

const TOOLS = [
  {
    name: "talqava_team",
    description: "List the AI agents in the person's Talqava organization: each agent's name, department, what it does and who it works for. Call this first to see who can be given work.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "talqava_assign_task",
    description: "Give a task to one of the Talqava agents. The agent works on it inside the Talqava app, where anything that changes files or sends something still waits for the owner's approval. Returns the task's id; use talqava_task to read its result later. A department head splits the task across its own team.",
    inputSchema: { type: "object", properties: { agent: { type: "string", description: "The agent's name, e.g. Head of Marketing or Bookkeeper." }, task: { type: "string", description: "The whole task, written so it can be done without any other context, and what a good result looks like." } }, required: ["agent", "task"], additionalProperties: false },
  },
  {
    name: "talqava_task",
    description: "Read how a Talqava task stands and what the agent reported: working, waiting for approval, finished or failed, with its latest report.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The task id returned by talqava_assign_task or talqava_tasks." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "talqava_tasks",
    description: "List recent Talqava tasks: what is under way, what is waiting for the owner, and what finished.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "talqava_memory",
    description: "Search or add to what the Talqava organization remembers (decisions, facts about the business, how jobs are done). Use action \"search\" with a few words, or \"add\" with one fact to remember for every agent.",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["search", "add"] }, text: { type: "string", description: "For search: a few words. For add: the fact to remember, one or two sentences." } }, required: ["action", "text"], additionalProperties: false },
  },
];

async function run(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "talqava_team") {
    const { org, byId, members, crew } = await team();
    const list = members.length ? members : crew.map((b) => ({ bot: b.id, title: b.title, department: b.group, manager: null }));
    const lines = list.map((m) => `- ${byId.get(m.bot)!.name} (${m.department}; works for ${m.manager ? byId.get(m.manager)?.name ?? "its lead" : "the owner"}): ${firstSentence(byId.get(m.bot)!.instructions)}`);
    return `${org?.name ?? "Talqava"}${org?.mission ? ` — ${org.mission}` : ""}\n${list.length} agents:\n${lines.join("\n")}`;
  }
  if (name === "talqava_assign_task") {
    const { byId, members, crew } = await team();
    const wanted = String(input.agent ?? "").trim().toLowerCase();
    const pool = members.length ? members.map((m) => byId.get(m.bot)!) : crew;
    const bot = pool.find((b) => b.id === wanted || b.name.toLowerCase() === wanted) ?? pool.find((b) => b.name.toLowerCase().includes(wanted) && wanted.length > 3);
    if (!bot) throw new Error(`There is no agent called "${input.agent}". The agents are: ${pool.map((b) => b.name).join(", ")}.`);
    const text = String(input.task ?? "").trim();
    if (text.length < 10) throw new Error("Say what the task is, with everything the agent needs to know.");
    const task = await app<Task & { needs?: { title: string; detail: string }[] }>("POST", "quests", { bot: bot.id, text });
    if (task.needs?.length) return `Not started: something the task needs is missing.\n${task.needs.map((n) => `- ${n.title}: ${n.detail}`).join("\n")}\nAsk the owner to set this up in the Talqava app, then assign it again.`;
    return `Assigned to the ${bot.name}. Task id: ${task.id}. It is working in the Talqava app; read its result with talqava_task. If it needs the owner's approval, the owner gives it in the Talqava app.`;
  }
  if (name === "talqava_task") {
    const id = String(input.id ?? "").trim();
    if (!/^[a-f0-9]{8,40}$/.test(id)) throw new Error("Give the task id returned by talqava_assign_task.");
    const task = await app<Task>("GET", `quests/${id}`);
    const conversation = await app<{ messages: { role: string; content: unknown }[] }>("GET", `conversations/${id}`).catch(() => ({ messages: [] }));
    const said = [...conversation.messages].reverse().find((m) => m.role === "assistant" && Array.isArray(m.content) && (m.content as { type: string; text?: string }[]).some((b) => b.type === "text" && b.text?.trim()));
    const report = said ? (said.content as { type: string; text?: string }[]).map((b) => (b.type === "text" ? b.text : "")).join("\n").trim() : "";
    return `${task.title}\n${task.bot.name} · ${statusWords(task)} · ${task.steps} steps · $${(task.cost ?? 0).toFixed(2)}\n\n${report ? report.slice(0, 6000) : "(No report yet.)"}`;
  }
  if (name === "talqava_tasks") {
    const tasks = (await app<Task[]>("GET", "quests")).slice(0, 25);
    return tasks.length ? tasks.map((t) => `- [${t.id}] ${t.title} · ${t.bot.name} · ${statusWords(t)}`).join("\n") : "No tasks yet.";
  }
  if (name === "talqava_memory") {
    const { org } = await team();
    if (!org) throw new Error("There is no organization yet.");
    const text = String(input.text ?? "").trim();
    if (!text) throw new Error("Give some words to search for, or the fact to remember.");
    if (input.action === "add") {
      await app("POST", `orgs/${org.id}/memory`, { text, shelf: "org" });
      return "Remembered for the whole organization.";
    }
    const entries = await app<{ id: string; text: string; shelf: string; key: string }[]>("GET", `orgs/${org.id}/memory`);
    const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const found = entries.map((e) => ({ e, score: words.filter((w) => e.text.toLowerCase().includes(w)).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
    return found.length ? found.map(({ e }) => `- (${e.shelf === "org" ? "organization" : e.shelf === "dept" ? `${e.key} department` : "an agent's notes"}) ${e.text}`).join("\n") : "Nothing saved matches that.";
  }
  throw new Error(`There is no tool called ${name}.`);
}

const server = new Server({ name: "talqava", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: "Talqava: the person's own team of AI agents, organized into departments. Use talqava_team to see who is on it, talqava_assign_task to give one of them work, and talqava_task to read the result. Work that changes files or sends anything waits for the person's approval in the Talqava app." });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return { content: [{ type: "text", text: await run(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>) }] };
  } catch (err) {
    return { content: [{ type: "text", text: (err as Error).message }], isError: true };
  }
});
await server.connect(new StdioServerTransport());
