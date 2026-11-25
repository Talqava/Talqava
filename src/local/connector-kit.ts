// The connector kit: the one shape every service connector of Talqava's own is written in.
//
// A service declares how to sign in (a few fields and a check that runs before anything is saved) and its actions,
// each marked "read", "write" or "destructive". Everything else is produced from that: the sign-in form, the list of
// what agents can read and change, the tools agents get, when a tool asks the owner first, and the audit entries.
// So a new service is only its own facts, and the rules cannot drift apart between services.
//
// The owner sets one rule per connection: agents only read, agents ask before each change, or agents change things
// without asking. A destructive action always asks. Keys stay on this computer and are sent only to the service.
import crypto from "node:crypto";
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { getConfig, saveConfig } from "./store.ts";
import { audit } from "./audit.ts";
import type { DirectoryCategory } from "./directory.ts";

export type ActionKind = "read" | "write" | "destructive";
export const CHANGE_RULES = ["read", "ask", "auto"] as const;
export type ChangeRule = (typeof CHANGE_RULES)[number];
export const CHANGE_WORDS: Record<ChangeRule, string> = {
  read: "Agents only read; they change nothing",
  ask: "Agents ask me before each change",
  auto: "Agents make changes without asking (deleting still asks)",
};

export interface SignInField {
  key: string;
  label: string;
  /** A key or password: shown as dots, never sent back to the screen. */
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

/** A saved connection to one account of a service. */
export interface Connection {
  id: string;
  service: string;
  /** Which account this is, as the service names it (an email, a shop, a workspace). */
  label: string;
  values: Record<string, string>;
  rule: ChangeRule;
  addedAt: string;
  /** Set when the last check found the connection no longer works: why, in plain words. */
  problem?: string;
  checkedAt?: string;
}

export interface ActionDef {
  /** Short, lower case with underscores: the tool is named <service>__<name>. */
  name: string;
  kind: ActionKind;
  /** Written for an agent: what it does, when to use it, what to prefer. */
  description: string;
  /** One short line for the owner, shown in the list of what agents can do. */
  summary: string;
  properties: Record<string, unknown>;
  required?: string[];
  run(connection: Connection, input: Record<string, any>): Promise<string>;
}

export interface ServiceDef {
  id: string;
  name: string;
  category: DirectoryCategory;
  /** One line: what agents can do with it. */
  about: string;
  /** Where the owner makes the key, as numbered steps in the service's own words. */
  steps: string[];
  /** The service's own page about making the key. */
  docs: string;
  fields: SignInField[];
  /** Checks the sign-in with the service. Returns the account's name, and any values worked out from the answer. */
  check(values: Record<string, string>): Promise<{ label: string; values?: Record<string, string> }>;
  actions: ActionDef[];
}

const registry: ServiceDef[] = [];
/** Adds services to the kit. Called once by services/index.ts; tests add stand-ins. */
export function registerServices(...defs: ServiceDef[]): void {
  for (const def of defs) {
    if (!/^[a-z][a-z0-9]*$/.test(def.id)) throw new Error(`A service id is lower-case letters and digits: ${def.id}`);
    for (const a of def.actions) if (!/^[a-z][a-z0-9_]*$/.test(a.name)) throw new Error(`An action name is lower case with underscores: ${def.id}.${a.name}`);
    const at = registry.findIndex((d) => d.id === def.id);
    if (at >= 0) registry[at] = def;
    else registry.push(def);
  }
}
export const services = (): ServiceDef[] => registry;
const serviceOf = (id: string): ServiceDef => {
  const def = registry.find((d) => d.id === id);
  if (!def) throw new Error("There is no such service.");
  return def;
};

const saved = (): Connection[] => (getConfig().connections ?? []).filter((c) => registry.some((d) => d.id === c.service)).map((c) => ({ ...c, rule: CHANGE_RULES.includes(c.rule as ChangeRule) ? (c.rule as ChangeRule) : "ask" }));
const store = (list: Connection[]) => saveConfig({ connections: [...(getConfig().connections ?? []).filter((c) => !registry.some((d) => d.id === c.service)), ...list] });

/** A connection as the app shows it: never its keys. */
export type PublicConnection = Omit<Connection, "values">;
const view = ({ values: _v, ...c }: Connection): PublicConnection => c;

/** Everything the app shows about the kit's services: what each can do, how to sign in, and what is connected. */
export function listServices() {
  const all = saved();
  return registry.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    about: d.about,
    steps: d.steps,
    docs: d.docs,
    fields: d.fields,
    actions: d.actions.map((a) => ({ name: a.name, kind: a.kind, summary: a.summary })),
    connections: all.filter((c) => c.service === d.id).map(view),
  }));
}
export const changeRules = () => CHANGE_RULES.map((id) => ({ id, words: CHANGE_WORDS[id] }));

/** Connects an account: the sign-in is checked with the service before anything is saved. */
export async function connectService(id: string, input: { values?: unknown; rule?: unknown }): Promise<PublicConnection> {
  const def = serviceOf(id);
  const given = (input.values && typeof input.values === "object" ? input.values : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const f of def.fields) {
    const v = String(given[f.key] ?? "").trim();
    if (!v) throw new Error(`Fill in: ${f.label}.`);
    if (v.length > 2000 || /[\r\n]/.test(v)) throw new Error(`${f.label} does not look right. Paste it again, on one line.`);
    values[f.key] = v;
  }
  const found = await def.check(values);
  const label = String(found.label || def.name).replace(/\s+/g, " ").trim().slice(0, 120);
  const all = saved();
  const before = all.find((c) => c.service === id && c.label.toLowerCase() === label.toLowerCase());
  const connection: Connection = {
    id: before?.id ?? crypto.randomBytes(5).toString("hex"),
    service: id,
    label,
    values: { ...values, ...(found.values ?? {}) },
    rule: CHANGE_RULES.includes(input.rule as ChangeRule) ? (input.rule as ChangeRule) : (before?.rule ?? "ask"),
    addedAt: before?.addedAt ?? new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
  store([...all.filter((c) => c.id !== connection.id), connection]);
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Connected ${def.name}`, detail: label });
  return view(connection);
}

/** Changes what agents may do through a connection. */
export function updateConnection(connectionId: string, input: { rule?: unknown }): PublicConnection {
  const all = saved();
  const c = all.find((x) => x.id === connectionId);
  if (!c) throw new Error("There is no such connection.");
  if (!CHANGE_RULES.includes(input.rule as ChangeRule)) throw new Error("Choose what agents may do.");
  c.rule = input.rule as ChangeRule;
  store(all);
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Changed what agents may do with ${serviceOf(c.service).name}`, detail: `${c.label}: ${CHANGE_WORDS[c.rule]}` });
  return view(c);
}

/** Disconnects an account. Its keys are forgotten. */
export function removeConnection(connectionId: string): { ok: true } {
  const all = saved();
  const c = all.find((x) => x.id === connectionId);
  if (!c) throw new Error("There is no such connection.");
  store(all.filter((x) => x.id !== connectionId));
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Disconnected ${serviceOf(c.service).name}`, detail: c.label });
  return { ok: true };
}

/** Checks each saved connection with its service again and records whether it still works. */
export async function checkConnections(): Promise<PublicConnection[]> {
  const all = saved();
  for (const c of all) {
    try {
      await serviceOf(c.service).check(c.values);
      delete c.problem;
    } catch (err) {
      // A service that cannot be reached right now is not a broken key: only a refusal marks the connection.
      if ((err as { refused?: boolean }).refused) c.problem = (err as Error).message;
    }
    c.checkedAt = new Date().toISOString();
  }
  store(all);
  return all.map(view);
}

const which = (service: string, account: unknown): Connection => {
  const mine = saved().filter((c) => c.service === service);
  if (!mine.length) throw new Error(`${serviceOf(service).name} is not connected. The owner connects it under Integrations.`);
  const want = String(account ?? "").trim().toLowerCase();
  const found = want ? mine.find((c) => c.id === want || c.label.toLowerCase() === want) : mine.length === 1 ? mine[0] : undefined;
  if (!found) throw new Error(`Say which account: ${mine.map((c) => c.label).join(", ")}.`);
  return found;
};

/** The tools agents get: one per action of each connected service, asking first where the owner's rule says so. */
export function serviceTools(): Tool[] {
  const all = saved();
  const tools: Tool[] = [];
  for (const def of registry) {
    const mine = all.filter((c) => c.service === def.id);
    if (!mine.length) continue;
    const several = mine.length > 1;
    for (const action of def.actions) {
      // Where every account is read-only, tools that change things are not offered at all.
      if (action.kind !== "read" && mine.every((c) => c.rule === "read")) continue;
      tools.push(
        defineTool<Record<string, any>>({
          name: `${def.id}__${action.name}`,
          description: `${def.name}: ${action.description}${action.kind === "read" ? "" : action.kind === "destructive" ? " This cannot be undone, so the owner is always asked first." : " This changes the owner's account; say what you changed in your report."}`,
          properties: { ...action.properties, ...(several ? { account: { type: "string", description: `Which account: ${mine.map((c) => c.label).join(", ")}.` } } : {}) },
          required: action.required ?? [],
          needsApproval: (input) => {
            if (action.kind === "read") return false;
            if (action.kind === "destructive") return true;
            try {
              return which(def.id, input.account).rule !== "auto";
            } catch {
              return true;
            }
          },
          async run(input) {
            const connection = which(def.id, input.account);
            if (action.kind !== "read" && connection.rule === "read") throw new Error(`On ${def.name} (${connection.label}) the owner lets agents read only. Say in your report what you would change, and leave it to them.`);
            const out = await action.run(connection, input);
            if (action.kind !== "read") audit({ actor: "system", actorName: def.name, kind: "integration", action: `An agent used ${def.name}: ${action.summary.toLowerCase()}`, detail: `${connection.label} · ${out.slice(0, 160)}` });
            return out.length > 30_000 ? `${out.slice(0, 30_000)}\n… (cut short; ask for less at a time)` : out;
          },
        }),
      );
    }
  }
  return tools;
}

/** A line for the agent's instructions naming the connected services, so it knows the tools are there. */
export function serviceNotes(): string[] {
  const all = saved();
  return registry.filter((d) => all.some((c) => c.service === d.id)).map((d) => `${d.name} is connected (${all.filter((c) => c.service === d.id).map((c) => c.label).join(", ")}): its tools start with ${d.id}__.`);
}

// ---------- a request helper every service uses, so errors read the same everywhere ----------
export interface CallOptions {
  /** The service's name, for messages. */
  name: string;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as a form, for the few services that want one. */
  form?: Record<string, string>;
}

/** One call to a service. Follows no redirects (a key must only reach its own service) and explains refusals plainly. */
export async function call<T = any>(url: string, opts: CallOptions): Promise<T> {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error(`${opts.name}'s address must start with https://.`);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.form ? new URLSearchParams(opts.form).toString() : undefined,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  }).catch(() => {
    throw new Error(`${opts.name} could not be reached. Check your connection and try again.`);
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (res.ok) return data as T;
  const said = String(data?.message ?? data?.error?.message ?? data?.detail ?? data?.error_description ?? (typeof data?.error === "string" ? data.error : "") ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`${opts.name} refused that: ${said || "the key is not accepted, or it may not do this"}.`), { refused: true });
  if (res.status === 404) throw new Error(`${opts.name} could not find that${said ? `: ${said}` : "."}`);
  if (res.status === 429) throw new Error(`${opts.name} is asking for a pause: too many requests. Try again in a minute.`);
  throw new Error(`${opts.name} answered ${res.status}${said ? `: ${said}` : "."}`);
}

/** Query text from the values that are set. */
export const query = (values: Record<string, unknown>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** A service's address, which tests point at a stand-in through TALQAVA_<ID>_API. */
export const baseOf = (id: string, real: string): string => (process.env[`TALQAVA_${id.toUpperCase()}_API`] || real).replace(/\/+$/, "");
/** A whole number within bounds, for "how many" inputs. */
export const count = (value: unknown, usual: number, most: number): number => Math.min(most, Math.max(1, Math.floor(Number(value) || usual)));
/** Text without HTML, on one line, cut to a length. */
export const plain = (value: unknown, most = 300): string => {
  let t = String(value ?? "");
  for (let before = ""; before !== t; ) (before = t), (t = t.replace(/<[^>]*>/g, " "));
  return t.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, most);
};
