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
  SearchScope,
  Space,
  SummaryCache,
  ConversationSummary,
} from "../core/index.ts";
import { BRAND, MEMORY_ENTRY_LIMIT, excerpt, rank, setting } from "../core/index.ts";

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

export function initStore() {
  for (const dir of [DATA, WORKSPACE, CONV_DIR]) fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Could not read ${file}: ${(err as Error).message}`);
  }
}

export function writeJson(file: string, value: unknown, mode = 0o600) {
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
  /** More keys for the same service; work is spread across them (see OpenAICompatibleOptions.moreKeys). */
  moreKeys?: string[];
  /** Prices per million tokens, when known. Local runners are free. */
  prices?: Prices;
  /** How many tokens the model can hold; longer conversations are shortened to fit. */
  contextTokens?: number;
  /** Which service in the list of AI services this is (e.g. "openai", "gemini"), when it was connected from that list. */
  service?: string;
  /** Where the key goes, for services that do not use "Authorization: Bearer" (Azure). */
  keyHeader?: "bearer" | "api-key" | "x-portkey-api-key";
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
  /** The most all bots together may spend in a calendar month, in US dollars. None means no limit. */
  monthlyBudget?: number;
  /** Backup models, in order: used when the chosen model's service is down, busy or out of credit. */
  backups?: string[];
  /** When an agent writes a plan for the owner's approval before starting: tasks given to leads (the default), every task the owner gives, or never. */
  planFirst?: "leads" | "all" | "never";
  /** The leads' daily check-in arrives in the Inbox each day (built from the tasks, at no cost). Default on. */
  checkIn?: boolean;
  /** The latest briefing of each kind that is built from the organization's own tasks, for the Inbox. */
  digests?: Record<string, { id: string; name: string; at: string; text: string }>;
  /** What each watching briefing last saw (a page's words, whether a site was down), to tell what changed. */
  briefingState?: Record<string, { lines?: string[]; down?: boolean; toldAt?: string; checkedAt?: string }>;
  /** WordPress sites agents may write for (see wordpress.ts). Each password is an application password, sent only to its site. */
  wordpress?: { id: string; name: string; url: string; user: string; password: string; publish: string }[];
  /** Accounts connected through the connector kit (see connector-kit.ts). Each key is sent only to its own service. */
  connections?: { id: string; service: string; label: string; values: Record<string, string>; rule: string; addedAt: string; problem?: string; checkedAt?: string; agents?: string[]; off?: string[] }[];
  /** Standing instructions that start a task when something happens in a connected service (see connector-kit.ts). */
  watches?: { id: string; connection: string; trigger: string; param: string; bot: string; org: string; instructions: string; on: boolean; seen: string[]; addedAt: string; last?: { at: string; started: number; problem?: string } }[];
  /** Encrypted backups: a key made from the owner's passphrase, where they go, and when the last one was made and tested (see backup.ts). */
  backup?: { salt?: string; key?: string; folder?: string; nightly?: boolean; lastAt?: string; lastFiles?: number; lastTestedAt?: string };
  /** Single sign-on through the company's identity provider (see sso.ts). */
  /** Directory sync (see scim.ts): the hash of the token the company's identity provider signs in with. */
  scim?: { tokenHash: string; role: string; createdAt: string; lastUsedAt?: string; groups?: { id: string; name: string; externalId?: string; members: string[] }[]; groupRoles?: Record<string, string> };
  sso?: { issuer: string; clientId: string; clientSecret?: string; domains?: string[]; addPeople?: boolean; role?: string; only?: boolean };
  /** How long chats and finished task records are kept, and whether a legal hold stops every deletion (see retention.ts). */
  retention?: { days?: number; legalHold?: boolean };
  /** Where every audit entry is also sent as it is written: a monitoring system's https address, and a secret to sign with. */
  auditFeed?: { url: string; secret: string };
  /** Which AI services may receive each sensitivity level, and which services are approved (see sensitivity.ts). */
  sensitivity?: { services?: Record<string, string>; approved?: string[]; memory?: string; leave?: Record<string, boolean>; terms?: Record<string, { region?: string; trains?: string }>; regions?: string[] };
  /** Rules above every agent's own settings (see guardrails.ts). None means today's behaviour. */
  guardrails?: { changes?: string; commands?: string; connectors?: string; web?: string; sites?: string[]; maxTaskSpend?: number; maxMinutes?: number };
  /** A stuck task tries once with a stronger model (the team's model or a backup) before stopping. Default on. */
  moveUp?: boolean;
  /** "mask": email addresses, phone numbers, card numbers and SSNs are hidden from AI services (not from models on this computer). */
  privacy?: "off" | "mask";
  /** Whether the Talqava assistant may read library documents and pages limited to some groups (never Private ones). On unless the owner turns it off. */
  assistantSeesGroups?: boolean;
  /** The last model check of each model, by ref. */
  modelChecks: Record<string, CheckResult>;
  /** Repositories bots may work on, by their top folder. */
  projects: string[];
  mcpServers: McpServer[];
  secrets: Record<string, Secret>;
  /** Cost saving for an organization's agents: "balanced" gives routine work to cheaper models, "off" uses the main model for everything. */
  savings?: "balanced" | "cheapest" | "off";
  /** Whether an agent checks it has what a task needs, and asks the owner if not, before starting. On unless switched off. */
  checkFirst?: boolean;
  /** The Client ID of the GitHub app that "Connect GitHub" signs in through. Not a secret. */
  githubClientId?: string;
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
  projects: [],
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
    savings: cfg.savings ?? "off",
    checkFirst: cfg.checkFirst !== false,
    approvalMode: cfg.approvalMode,
    hasApiKey: Boolean(apiKey(cfg)),
    providers: cfg.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      prices: p.prices,
      contextTokens: p.contextTokens ?? null,
      hasKey: p.kind === "anthropic" ? Boolean(apiKey(cfg)) : Boolean(p.apiKey),
      service: p.service ?? null,
    })),
    backups: cfg.backups ?? [],
    assistantSeesGroups: cfg.assistantSeesGroups !== false,
    planFirst: cfg.planFirst ?? "leads",
    moveUp: cfg.moveUp !== false,
    guardrails: cfg.guardrails ?? {},
    checkIn: cfg.checkIn !== false,
    privacy: cfg.privacy ?? "off",
    budget: cfg.budget,
    monthlyBudget: cfg.monthlyBudget ?? null,
    modelChecks: cfg.modelChecks,
    projects: cfg.projects,
    apiKeyFromEnv: !cfg.apiKey && Boolean(process.env.ANTHROPIC_API_KEY),
    mcpServers: cfg.mcpServers.map((s) => ({ name: s.name, url: s.url, command: s.command ? [s.command, ...(s.args ?? [])].join(" ") : null, hasToken: Boolean(s.token) })),
    secrets: Object.entries(cfg.secrets).map(([name, s]) => ({ name, host: s.host })),
    models: MODELS,
    efforts: EFFORTS,
    workspace: WORKSPACE,
    dataDir: DATA,
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

  save(conversation: Conversation, { touch = true } = {}) {
    if (touch) conversation.updatedAt = new Date().toISOString();
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
      .map(({ id, title, createdAt, updatedAt, source, space, pinned, bot }) => ({ id, title, createdAt, updatedAt, source, space, pinned: Boolean(pinned), bot }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Message texts of each conversation, kept while its file is unchanged, so searching many chats stays quick. */
  #texts = new Map<string, { stamp: number; title: string; date: string; space?: string; messages: { role: string; text: string }[] }>();

  #indexed(id: string) {
    const file = convFile(id);
    const stamp = fs.statSync(file).mtimeMs;
    const cached = this.#texts.get(id);
    if (cached?.stamp === stamp) return cached;
    const conversation = this.get(id);
    if (!conversation) return null;
    const entry = {
      stamp,
      title: conversation.title,
      date: conversation.updatedAt.slice(0, 10),
      space: conversation.space,
      messages: conversation.messages.map((m) => ({ role: m.role, text: messageText(m) })).filter((m) => m.text.trim()),
    };
    this.#texts.set(id, entry);
    return entry;
  }

  /**
   * Finds the passages that best match the query's words, in any order and
   * form. A conversation in a space looks in that space and in General;
   * a General conversation looks everywhere.
   */
  search(query: string, limit = 8, scope: SearchScope = {}): SearchHit[] {
    const passages: { conversation: string; date: string; role: string; text: string }[] = [];
    for (const file of fs.readdirSync(CONV_DIR)) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (id === scope.exclude) continue;
      let entry;
      try {
        entry = this.#indexed(id);
      } catch {
        continue;
      }
      if (!entry || (scope.space && entry.space && entry.space !== scope.space)) continue;
      for (const m of entry.messages) passages.push({ conversation: entry.title, date: entry.date, role: m.role, text: m.text });
    }
    const hits: SearchHit[] = [];
    const perConversation = new Map<string, number>();
    for (const { item } of rank(query, passages, (p) => p.text)) {
      // A few passages from one conversation are enough; leave room for others.
      const key = `${item.conversation}|${item.date}`;
      if ((perConversation.get(key) ?? 0) >= 3) continue;
      perConversation.set(key, (perConversation.get(key) ?? 0) + 1);
      hits.push({ conversation: item.conversation, date: item.date, role: item.role, excerpt: excerpt(item.text, query) });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

// ---------- spaces ----------
/** Spaces keep one client's or project's memory and chats apart. General is the absence of a space. */
class FileSpaces {
  #file = () => path.join(DATA, "spaces.json");

  list(): Space[] {
    return readJson<Space[]>(this.#file(), []);
  }

  get(id?: string): Space | undefined {
    return id ? this.list().find((s) => s.id === id) : undefined;
  }

  #checked(name: unknown, except?: string): string {
    const clean = String(name ?? "").replace(/\s+/g, " ").trim();
    if (!clean || clean.length > 40) throw new Error("A project needs a name of up to 40 characters.");
    if (clean.toLowerCase() === "general") throw new Error("General is already there: it is where everything outside a project lives.");
    if (this.list().some((s) => s.id !== except && s.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a project called "${clean}".`);
    return clean;
  }

  create(name: unknown): Space {
    const space = { id: newId(), name: this.#checked(name), createdAt: new Date().toISOString() };
    writeJson(this.#file(), [...this.list(), space]);
    return space;
  }

  rename(id: string, name: unknown): Space {
    const spaces = this.list();
    const space = spaces.find((s) => s.id === id);
    if (!space) throw new Error("No such project.");
    space.name = this.#checked(name, id);
    writeJson(this.#file(), spaces);
    return space;
  }

  /** Removes a space. Its memories are deleted; its conversations move to General. */
  remove(id: string) {
    const spaces = this.list();
    if (!spaces.some((s) => s.id === id)) throw new Error("No such project.");
    writeJson(this.#file(), spaces.filter((s) => s.id !== id));
    memory.dropSpace(id);
    for (const meta of conversations.list()) {
      if (meta.space !== id) continue;
      const conversation = conversations.get(meta.id);
      if (!conversation) continue;
      delete conversation.space;
      conversations.save(conversation, { touch: false });
    }
  }
}

// ---------- memory ----------
class FileMemory implements MemoryStore {
  #file = () => path.join(DATA, "memory.json");

  list(): MemoryEntry[] {
    return readJson<MemoryEntry[]>(this.#file(), []);
  }

  #checked(text: unknown): string {
    const clean = String(text ?? "").trim();
    if (!clean) throw new Error("Nothing to remember.");
    if (clean.length > MEMORY_ENTRY_LIMIT) throw new Error(`That is too long for one memory (${MEMORY_ENTRY_LIMIT} characters at most). Save the key facts as separate short entries.`);
    return clean;
  }

  #space(space?: string | null): string | undefined {
    if (!space) return undefined;
    if (!spaces.get(space)) throw new Error("No such project.");
    return space;
  }

  /** There is no cap on how much is remembered: each conversation is shown what fits it (see selectMemory). */
  add(text: string, space?: string): MemoryEntry {
    const entries = this.list();
    const clean = this.#checked(text);
    const inSpace = this.#space(space);
    const same = entries.find((e) => e.text === clean && e.space === inSpace);
    if (same) return same;
    const entry: MemoryEntry = { id: newId(), text: clean, createdAt: new Date().toISOString(), ...(inSpace ? { space: inSpace } : {}) };
    writeJson(this.#file(), [...entries, entry]);
    return entry;
  }

  update(id: string, patch: { text?: string; space?: string | null }): MemoryEntry {
    const entries = this.list();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error(`No memory entry with id ${id}.`);
    if (patch.text !== undefined) entry.text = this.#checked(patch.text);
    if (patch.space !== undefined) {
      const inSpace = this.#space(patch.space);
      if (inSpace) entry.space = inSpace;
      else delete entry.space;
    }
    entry.updatedAt = new Date().toISOString();
    writeJson(this.#file(), entries);
    return entry;
  }

  remove(id: string) {
    const entries = this.list();
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) throw new Error(`No memory entry with id ${id}.`);
    writeJson(this.#file(), rest);
  }

  /** Deletes every entry of a space (when the space itself is removed). */
  dropSpace(space: string) {
    writeJson(this.#file(), this.list().filter((e) => e.space !== space));
  }

  spaceName(id: string) {
    return spaces.get(id)?.name;
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

/** Summaries of long conversations for local models, kept so a restart does not have to write them again. */
export const summaries: SummaryCache = {
  get: (key) => readJson<Record<string, ConversationSummary>>(path.join(DATA, "summaries.json"), {})[key],
  set(key, value) {
    const file = path.join(DATA, "summaries.json");
    const all = Object.entries({ ...readJson<Record<string, ConversationSummary>>(file, {}), [key]: value });
    // Only the latest few hundred are kept.
    writeJson(file, Object.fromEntries(all.slice(-300)));
  },
};

export const conversations = new FileConversations();
export const memory = new FileMemory();
export const spaces = new FileSpaces();
export const skills = new FileSkills();
export const jobStore = new FileJobs();
