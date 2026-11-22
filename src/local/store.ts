// The local edition keeps everything in plain JSON files under data/.
import "./env.ts";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./env.ts";
import type {
  ApprovalMode,
  Conversation,
  ConversationStore,
  Effort,
  Job,
  JobStore,
  McpServer,
  MemoryEntry,
  MemoryStore,
  Message,
  SearchHit,
  Secret,
  Skill,
  SkillStore,
  Budget,
  CheckResult,
  Prices,
} from "../core/index.ts";
import { BRAND, setting } from "../core/index.ts";

export { ROOT };
export const DATA = path.resolve(setting("DATA_DIR") || path.join(ROOT, "data"));
export const WORKSPACE = path.resolve(setting("WORKSPACE") || path.join(DATA, "workspace"));
const CONV_DIR = path.join(DATA, "conversations");

/** Claude models offered in the model picker; any other model name can be typed. */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2 (most capable, costs more)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
];
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];
export const MEMORY_LIMIT = 8000; // characters across all memory entries

export function initStore() {
  for (const dir of [DATA, WORKSPACE, CONV_DIR]) fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Could not read ${file}: ${(err as Error).message}`);
  }
}

function writeJson(file: string, value: unknown, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
  fs.renameSync(tmp, file);
}

export const newId = () => crypto.randomBytes(8).toString("hex");

// ---------- settings ----------
/** A place models come from: Anthropic, a local model runner, or another service. */
export interface ProviderConfig {
  id: string;
  kind: "anthropic" | "openai";
  name: string;
  /** For "openai" providers: the address that ends in /v1. */
  baseUrl?: string;
  /** For "openai" providers. Anthropic's key is Config.apiKey. */
  apiKey?: string;
  /** Prices per million tokens, when known. Local runners are free. */
  prices?: Prices;
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "anthropic", kind: "anthropic", name: "Anthropic (Claude)" },
  { id: "local", kind: "openai", name: "Local model runner", baseUrl: "http://localhost:11434/v1", prices: { input: 0, output: 0 } },
];

export interface Config {
  agentName: string;
  /** "<provider id>/<model name>", e.g. "anthropic/claude-opus-5-5" or "local/llama3.1". */
  model: string;
  effort: Effort;
  /** "ask": confirm risky actions. "auto": run everything. */
  approvalMode: ApprovalMode;
  apiKey: string;
  providers: ProviderConfig[];
  /** Limits on each run: model calls, and estimated US dollars. */
  budget: Budget;
  /** The last model check of each model, by ref. */
  modelChecks: Record<string, CheckResult>;
  mcpServers: McpServer[];
  secrets: Record<string, Secret>;
  sessionSecret: string;
}

const CONFIG_FILE = () => path.join(DATA, "config.json");
const DEFAULTS: Config = {
  agentName: BRAND.agentName,
  model: "anthropic/claude-opus-5-5",
  effort: "high",
  approvalMode: "ask",
  apiKey: "",
  providers: DEFAULT_PROVIDERS,
  budget: { steps: 40, spend: 1 },
  modelChecks: {},
  mcpServers: [],
  secrets: {},
  sessionSecret: "",
};

export function getConfig(): Config {
  const cfg = { ...DEFAULTS, ...readJson<Partial<Config>>(CONFIG_FILE(), {}) };
  // Settings from before providers existed name a Claude model on its own.
  if (!cfg.model.includes("/")) cfg.model = `anthropic/${cfg.model}`;
  if (!cfg.providers.some((p) => p.kind === "anthropic")) cfg.providers = [DEFAULT_PROVIDERS[0], ...cfg.providers];
  if (!cfg.sessionSecret) {
    cfg.sessionSecret = crypto.randomBytes(32).toString("hex");
    writeJson(CONFIG_FILE(), cfg);
  }
  return cfg;
}

export function saveConfig(patch: Partial<Config>): Config {
  const cfg = { ...getConfig(), ...patch };
  writeJson(CONFIG_FILE(), cfg);
  return cfg;
}

export const apiKey = (cfg = getConfig()) => cfg.apiKey || process.env.ANTHROPIC_API_KEY || "";

/** What the browser is allowed to see: never the key, secret values or tokens. */
export function publicConfig() {
  const cfg = getConfig();
  return {
    agentName: cfg.agentName,
    model: cfg.model,
    effort: cfg.effort,
    approvalMode: cfg.approvalMode,
    hasApiKey: Boolean(apiKey(cfg)),
    providers: cfg.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      prices: p.prices,
      hasKey: p.kind === "anthropic" ? Boolean(apiKey(cfg)) : Boolean(p.apiKey),
    })),
    budget: cfg.budget,
    modelChecks: cfg.modelChecks,
    apiKeyFromEnv: !cfg.apiKey && Boolean(process.env.ANTHROPIC_API_KEY),
    mcpServers: cfg.mcpServers.map((s) => ({ name: s.name, url: s.url, hasToken: Boolean(s.token) })),
    secrets: Object.entries(cfg.secrets).map(([name, s]) => ({ name, host: s.host })),
    models: MODELS,
    efforts: EFFORTS,
    workspace: WORKSPACE,
  };
}

// ---------- conversations ----------
const convFile = (id: string) => {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Bad conversation id");
  return path.join(CONV_DIR, `${id}.json`);
};

/** Plain text of a message, for search. */
function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).filter(Boolean).join("\n");
}

class FileConversations implements ConversationStore {
  get(id: string): Conversation | null {
    return readJson<Conversation | null>(convFile(id), null);
  }

  save(conversation: Conversation) {
    conversation.updatedAt = new Date().toISOString();
    writeJson(convFile(conversation.id), conversation);
  }

  create(extra: Partial<Conversation> = {}): Conversation {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: newId(),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      source: "chat",
      messages: [],
      allowed: [],
      usage: { input: 0, output: 0 },
      ...extra,
    };
    this.save(conversation);
    return conversation;
  }

  remove(id: string) {
    fs.rmSync(convFile(id), { force: true });
  }

  list() {
    return fs
      .readdirSync(CONV_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<Conversation | null>(path.join(CONV_DIR, f), null))
      .filter((c): c is Conversation => Boolean(c))
      .map(({ id, title, createdAt, updatedAt, source }) => ({ id, title, createdAt, updatedAt, source }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  search(query: string, limit = 8): SearchHit[] {
    const needle = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const meta of this.list()) {
      const conversation = this.get(meta.id);
      if (!conversation) continue;
      for (const message of conversation.messages) {
        const text = messageText(message);
        const at = text.toLowerCase().indexOf(needle);
        if (at === -1) continue;
        hits.push({
          conversation: conversation.title,
          date: conversation.updatedAt.slice(0, 10),
          role: message.role,
          excerpt: text.slice(Math.max(0, at - 200), at + 400),
        });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }
}

// ---------- memory ----------
class FileMemory implements MemoryStore {
  #file = () => path.join(DATA, "memory.json");

  list(): MemoryEntry[] {
    return readJson<MemoryEntry[]>(this.#file(), []);
  }

  add(text: string): MemoryEntry {
    const entries = this.list();
    text = String(text ?? "").trim();
    if (!text) throw new Error("Nothing to remember.");
    const used = entries.reduce((n, e) => n + e.text.length, 0);
    if (used + text.length > MEMORY_LIMIT) {
      throw new Error(`Memory is full (${MEMORY_LIMIT} characters). Remove or merge older entries first, then try again.`);
    }
    const entry = { id: newId(), text, createdAt: new Date().toISOString() };
    writeJson(this.#file(), [...entries, entry]);
    return entry;
  }

  remove(id: string) {
    const entries = this.list();
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) throw new Error(`No memory entry with id ${id}.`);
    writeJson(this.#file(), rest);
  }
}

// ---------- skills (procedures the agent wrote down for itself) ----------
class FileSkills implements SkillStore {
  #file = () => path.join(DATA, "skills.json");

  list(): Skill[] {
    return readJson<Skill[]>(this.#file(), []);
  }

  save(input: { name: string; description: string; content: string }): Skill {
    const name = String(input.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!name) throw new Error("A skill needs a name.");
    const skill = { name, description: String(input.description).trim(), content: String(input.content), updatedAt: new Date().toISOString() };
    writeJson(this.#file(), [...this.list().filter((s) => s.name !== name), skill]);
    return skill;
  }

  remove(name: string) {
    writeJson(this.#file(), this.list().filter((s) => s.name !== name));
  }
}

// ---------- scheduled jobs ----------
class FileJobs implements JobStore {
  #file = () => path.join(DATA, "jobs.json");

  list(): Job[] {
    return readJson<Job[]>(this.#file(), []);
  }

  saveAll(jobs: Job[]) {
    writeJson(this.#file(), jobs);
  }
}

export const conversations = new FileConversations();
export const memory = new FileMemory();
export const skills = new FileSkills();
export const jobStore = new FileJobs();
