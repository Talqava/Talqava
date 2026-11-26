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
import { noteSent } from "./sent.ts";
import type { DirectoryCategory } from "./directory.ts";
import { findSecrets, leaving } from "./sensitivity.ts";

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
  /** What the value must look like (a pattern), for a value that becomes part of an address. */
  pattern?: string;
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
  /** The agents that may use this account, by their ids. Empty or missing: every agent with the connected services power. */
  agents?: string[];
  /** Actions the owner switched off for this account, by name. */
  off?: string[];
}

/** Something that can happen in a service and start a task: a new order, a new email, a new form answer. */
export interface TriggerDef {
  name: string;
  /** For the owner: "A new order comes in". */
  summary: string;
  /** One thing the owner may have to say, such as which form. */
  param?: { label: string; placeholder?: string; required?: boolean };
  /** The newest things, as ids. Anything not seen before counts as new. */
  list(connection: Connection, param: string): Promise<string[]>;
  /** One of them in words, for the agent that will handle it. */
  describe(connection: Connection, id: string, param: string): Promise<{ title: string; text: string }>;
}

/** A standing instruction: when this happens on that account, this agent gets a task. */
export interface Watch {
  id: string;
  connection: string;
  trigger: string;
  param: string;
  /** The agent that gets the task, and the organization it belongs to. */
  bot: string;
  org: string;
  /** What the agent should do each time, in the owner's words. */
  instructions: string;
  on: boolean;
  seen: string[];
  addedAt: string;
  last?: { at: string; started: number; problem?: string };
}

export interface ActionDef {
  /** Short, lower case with underscores: the tool is named <service>__<name>. */
  name: string;
  kind: ActionKind;
  /** Written for an agent: what it does, when to use it, what to prefer. */
  description: string;
  /** One short line for the owner, shown in the list of what agents can do. */
  summary: string;
  /** For a change that reaches other people (sending an email): the owner is asked every time, whatever their rule. */
  alwaysAsk?: boolean;
  properties: Record<string, unknown>;
  required?: string[];
  run(connection: Connection, input: Record<string, any>): Promise<string>;
}

/** A service that signs in through the browser (OAuth 2.0 with a code and PKCE), with an app the owner registers. */
export interface BrowserSignIn {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra values for the address the browser is sent to, such as asking for a token that can be renewed. */
  extra?: Record<string, string>;
  /** Whether the owner's registered app comes with a secret: always, sometimes, or never. */
  secret: "required" | "optional" | "never";
  /** How to register the app with the service, as numbered steps. {redirect} stands for the address to give it. */
  appSteps: string[];
  /**
   * "code" (the usual: a one-time code is exchanged for tokens) or "fragment" (the service hands the token straight
   * back in the address, after the #, as Trello does; there is no secret and nothing to renew).
   */
  kind?: "code" | "fragment";
  /** For a service that also takes a pasted key: the name its code reads the token from, so both ways work alike. */
  tokenKey?: string;
  /** The name the app's ID is kept under, when the service's calls need it too (Trello's API key). */
  idKey?: string;
  /** What the service calls the app's ID, for the form. "Client ID" when left out. */
  idLabel?: string;
  /** What separates the permissions in the address. A space when left out. */
  scopeSeparator?: string;
  /** False for a service whose documentation does not describe PKCE: the proof is then left out of the sign-in. */
  pkce?: boolean;
  /**
   * Things asked before signing in that decide where to sign in, such as an account's own address. Each needs a
   * pattern, because {key} in authUrl and tokenUrl is replaced by it. They are kept with the connection.
   */
  ask?: SignInField[];
  /** For a service whose renewal call also wants the address the sign-in came back to (GitLab's examples send it). */
  renewWithRedirect?: boolean;
  /**
   * How the service wants the app's ID and secret when the code is exchanged: in the form (the usual), as a Basic
   * sign-in header (Pipedrive, Klaviyo), or in a JSON body (Atlassian, Square).
   */
  tokenStyle?: "form" | "basic" | "json";
  /** Fields of the token answer the service's own code needs, kept with the connection (Pipedrive's api_domain). */
  keep?: string[];
  /**
   * For a service that sends the browser back only to an https address (Slack, Calendly): an app on this computer
   * cannot receive that, so the sign-in works only through Talqava's sign-in service, with the app Talqava's maker
   * registered. Until that app exists the service is offered with a key only.
   */
  relayOnly?: boolean;
}
/** An address with each {key} replaced by the value asked for it. */
const filled = (address: string, values: Record<string, string>) => address.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(values[k] ?? ""));

/**
 * An app Talqava's maker registered with a service, so an owner signs in with one press and registers nothing.
 * Only an ID that is safe to publish belongs here (a public client that signs in with PKCE, or a public API key);
 * never a secret. None are filled in yet: each needs the maker's own account with that service. An ID can also be
 * given when starting the app, as TALQAVA_<SERVICE>_CLIENT_ID.
 */
const BUILT_IN_APPS: Record<string, string> = {};
export const builtInApp = (def: ServiceDef): string => (def.browser && def.browser.secret !== "required" ? (process.env[`TALQAVA_${def.id.toUpperCase()}_CLIENT_ID`] || BUILT_IN_APPS[def.id] || "").trim() : "");

/**
 * Talqava's sign-in service (see relay/README.md). Some services give their app a secret, which must never be in an
 * app on someone's computer. For those, the maker registers one app, the secret is kept by a small service on
 * Talqava's own website, and that service swaps the one-time code for tokens and renews them. It keeps nothing:
 * the tokens come straight back to this computer. Only the app's ID, which is safe to publish, is listed here.
 * None are filled in yet: each needs the maker's own account with that service. An ID can also be given when
 * starting the app, as TALQAVA_<SERVICE>_RELAY_CLIENT_ID.
 */
const RELAY_APPS: Record<string, string> = {};
export const relayApp = (def: ServiceDef): string => (def.browser && def.browser.kind !== "fragment" ? (process.env[`TALQAVA_${def.id.toUpperCase()}_RELAY_CLIENT_ID`] || RELAY_APPS[def.id] || "").trim() : "");
/** Where the sign-in service is. */
export const relayAddress = (): string => (process.env.TALQAVA_AUTH_RELAY || "https://auth.talqava.com").replace(/\/+$/, "");
/** One call to the sign-in service. It answers with the service's own token answer, or says what went wrong. */
async function relayCall(def: ServiceDef, what: "token" | "refresh", body: Record<string, unknown>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const t = await call<any>(`${relayAddress()}/${what}.php`, { name: `Talqava's sign-in service (for ${def.name})`, method: "POST", body: { service: def.id, ...body } });
  if (!t?.access_token) throw new Error(`${def.name} did not complete the sign-in.`);
  return t;
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
  /** Set when the service signs in through the browser instead of a pasted key. `check` then receives access_token. */
  browser?: BrowserSignIn;
  /** Checks the sign-in with the service. Returns the account's name, and any values worked out from the answer. */
  check(values: Record<string, string>): Promise<{ label: string; values?: Record<string, string> }>;
  actions: ActionDef[];
  triggers?: TriggerDef[];
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

/**
 * Services Talqava no longer offers (they connect only with a pasted key), and Langfuse likewise. Their saved keys
 * are forgotten when the app starts, so nothing secret stays behind for a service that can no longer be used or
 * disconnected from the page. Nothing at the service itself is changed.
 */
const REMOVED_SERVICES = ["shopify", "woocommerce", "freshdesk", "brevo", "telegram"];
export function forgetRemovedServices(): string[] {
  const cfg = getConfig() as ReturnType<typeof getConfig> & { langfuse?: unknown };
  const gone = (cfg.connections ?? []).filter((c) => REMOVED_SERVICES.includes(c.service));
  if (!gone.length && cfg.langfuse === undefined) return [];
  saveConfig({ connections: (cfg.connections ?? []).filter((c) => !REMOVED_SERVICES.includes(c.service)), langfuse: undefined } as Parameters<typeof saveConfig>[0]);
  const names = [...new Set([...gone.map((c) => c.service), ...(cfg.langfuse === undefined ? [] : ["langfuse"])])];
  audit({ actor: "system", actorName: "Talqava", kind: "integration", action: "Forgot the saved keys of services Talqava no longer offers", detail: names.join(", ") });
  return names;
}

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
    browser: d.browser && !(d.browser.relayOnly && !relayApp(d)) ? { secret: d.browser.kind === "fragment" ? "never" : d.browser.secret, appSteps: d.browser.appSteps, scopes: d.browser.scopes, idLabel: d.browser.idLabel ?? "Client ID", oneClick: Boolean(builtInApp(d) || relayApp(d)), viaTalqava: !builtInApp(d) && Boolean(relayApp(d)), ask: d.browser.ask ?? [] } : null,
    triggers: (d.triggers ?? []).map((t) => ({ name: t.name, summary: t.summary, param: t.param ?? null })),
    watches: watches().filter((w) => all.some((c) => c.id === w.connection && c.service === d.id)).map(({ seen: _s, ...w }) => w),
    actions: d.actions.map((a) => ({ name: a.name, kind: a.kind, summary: a.alwaysAsk ? `${a.summary} (always asks you first)` : a.summary })),
    connections: all.filter((c) => c.service === d.id).map(view),
  }));
}
/**
 * What kind of step one of the kit's tools is, by its name: reading, changing something, sending something to a
 * person outside (an email, a reply to a customer), or deleting. Nothing for a tool that is not the kit's.
 */
export function toolActionKind(name: string): "read" | "change" | "send" | "delete" | null {
  const [service, action] = name.split("__");
  const found = registry.find((d) => d.id === service)?.actions.find((a) => a.name === action);
  return !found ? null : found.kind === "read" ? "read" : found.kind === "destructive" ? "delete" : found.alwaysAsk ? "send" : "change";
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
export function updateConnection(connectionId: string, input: { rule?: unknown; agents?: unknown; off?: unknown }): PublicConnection {
  const all = saved();
  const c = all.find((x) => x.id === connectionId);
  if (!c) throw new Error("There is no such connection.");
  const def = serviceOf(c.service);
  const names = (v: unknown, most: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 100)).filter(Boolean))].slice(0, most);
  const said: string[] = [];
  if (input.rule !== undefined) {
    if (!CHANGE_RULES.includes(input.rule as ChangeRule)) throw new Error("Choose what agents may do.");
    c.rule = input.rule as ChangeRule;
    said.push(CHANGE_WORDS[c.rule]);
  }
  if (input.agents !== undefined) {
    c.agents = names(input.agents, 200);
    said.push(c.agents.length ? `only ${c.agents.length} chosen agent${c.agents.length === 1 ? "" : "s"} may use it` : "every agent with the power may use it");
  }
  if (input.off !== undefined) {
    c.off = names(input.off, 100).filter((n) => def.actions.some((a) => a.name === n));
    said.push(c.off.length ? `switched off: ${c.off.map((n) => def.actions.find((a) => a.name === n)!.summary.toLowerCase()).join("; ")}` : "every action is on");
  }
  if (!said.length) throw new Error("Choose what agents may do.");
  store(all);
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Changed what agents may do with ${def.name}`, detail: `${c.label}: ${said.join("; ")}` });
  return view(c);
}

/** Disconnects an account. Its keys are forgotten. */
export function removeConnection(connectionId: string): { ok: true } {
  const all = saved();
  const c = all.find((x) => x.id === connectionId);
  if (!c) throw new Error("There is no such connection.");
  store(all.filter((x) => x.id !== connectionId));
  saveConfig({ watches: watches().filter((w) => w.connection !== connectionId) });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Disconnected ${serviceOf(c.service).name}`, detail: c.label });
  return { ok: true };
}

/** Checks each saved connection with its service again and records whether it still works. */
export async function checkConnections(): Promise<PublicConnection[]> {
  for (const c of saved()) {
    let problem: string | undefined;
    try {
      await serviceOf(c.service).check((await fresh(c)).values);
    } catch (err) {
      // A service that cannot be reached right now is not a broken key: only a refusal marks the connection.
      if (!(err as { refused?: boolean }).refused) continue;
      problem = (err as Error).message;
    }
    mark(c.id, problem);
  }
  return saved().map(view);
}

/** Records that a connection stopped working, or works again. Read fresh each time, so nothing saved meanwhile is lost. */
function mark(connectionId: string, problem: string | undefined): void {
  const all = saved();
  const c = all.find((x) => x.id === connectionId);
  if (!c) return;
  const was = c.problem;
  if (problem) c.problem = problem;
  else delete c.problem;
  c.checkedAt = new Date().toISOString();
  store(all);
  if (problem && !was) audit({ actor: "system", actorName: serviceOf(c.service).name, kind: "integration", action: `${serviceOf(c.service).name} stopped accepting its key`, detail: `${c.label}: ${problem}` });
}

/** Connections that no longer work, for the owner's Inbox and Home: which, why, and where to fix it. */
export function connectionProblems(): { id: string; name: string; problem: string; integration: string }[] {
  return saved()
    .filter((c) => c.problem)
    .map((c) => ({ id: `connection:${c.id}`, name: `${serviceOf(c.service).name} (${c.label})`, problem: c.problem!, integration: `service:${c.service}` }));
}

/** Whether an agent may use a connection. The owner's own assistant (no agent id) always may. */
const allowed = (c: Connection, agent?: string) => !agent || !c.agents?.length || c.agents.includes(agent);
const which = (service: string, account: unknown, agent?: string): Connection => {
  const mine = saved().filter((c) => c.service === service && allowed(c, agent));
  if (!mine.length) throw new Error(`${serviceOf(service).name} is not connected. The owner connects it under Connections.`);
  const want = String(account ?? "").trim().toLowerCase();
  const found = want ? mine.find((c) => c.id === want || c.label.toLowerCase() === want) : mine.length === 1 ? mine[0] : undefined;
  if (!found) throw new Error(`Say which account: ${mine.map((c) => c.label).join(", ")}.`);
  return found;
};

/** The tools agents get: one per action of each connected service, asking first where the owner's rule says so. */
export function serviceTools(agent?: string): Tool[] {
  const all = saved().filter((c) => allowed(c, agent));
  const tools: Tool[] = [];
  for (const def of registry) {
    const mine = all.filter((c) => c.service === def.id);
    if (!mine.length) continue;
    const several = mine.length > 1;
    for (const action of def.actions) {
      // Where every account is read-only, tools that change things are not offered at all.
      if (action.kind !== "read" && mine.every((c) => c.rule === "read")) continue;
      // An action the owner switched off on every account is not offered either.
      if (mine.every((c) => c.off?.includes(action.name))) continue;
      tools.push(
        // Marked when it deletes, so the organization's "never delete" rule can take it away (see guardrails.ts).
        Object.assign(defineTool<Record<string, any>>({
          name: `${def.id}__${action.name}`,
          description: `${def.name}: ${action.description}${action.kind === "read" ? "" : action.kind === "destructive" ? " This cannot be undone, so the owner is always asked first." : " This changes the owner's account; say what you changed in your report."}`,
          properties: { ...action.properties, ...(several ? { account: { type: "string", description: `Which account: ${mine.map((c) => c.label).join(", ")}.` } } : {}) },
          required: action.required ?? [],
          needsApproval: (input) => {
            if (action.kind === "read") return false;
            if (action.kind === "destructive" || action.alwaysAsk) return true;
            try {
              return which(def.id, input.account, agent).rule !== "auto";
            } catch {
              return true;
            }
          },
          async run(input) {
            const connection = await fresh(which(def.id, input.account, agent));
            if (connection.off?.includes(action.name)) throw new Error(`On ${def.name} (${connection.label}) the owner switched this off: ${action.summary.toLowerCase()}. Say in your report what you would have done.`);
            // A key or password in what is being sent out is stopped here, before it reaches the service.
            if (action.kind !== "read") {
              leaving(`${def.name}`);
              const found = findSecrets(JSON.stringify(input));
              if (found.length) throw new Error(`That would send ${found.join(" and ")} to ${def.name}. Take it out of the text and try again; keys and passwords are never sent to a connected service.`);
            }
            if (action.kind !== "read" && connection.rule === "read") throw new Error(`On ${def.name} (${connection.label}) the owner lets agents read only. Say in your report what you would change, and leave it to them.`);
            let out: string;
            try {
              out = await action.run(connection, input);
            } catch (err) {
              // A refusal while an agent works means the key stopped being accepted: the owner is told, not only the agent.
              // A refusal may only mean the key lacks one permission, so the sign-in itself is checked before saying so.
              if ((err as { refused?: boolean }).refused) await def.check(connection.values).catch((again) => (again as { refused?: boolean }).refused && mark(connection.id, (again as Error).message));
              throw err;
            }
            if (connection.problem) mark(connection.id, undefined);
            if (action.kind !== "read") {
              audit({ actor: "system", actorName: def.name, kind: "integration", action: `An agent used ${def.name}: ${action.summary.toLowerCase()}`, detail: `${connection.label} · ${out.slice(0, 160)}` });
              noteSent({ kind: "service", to: `${def.name} (${connection.label})`, what: action.summary });
            }
            return out.length > 30_000 ? `${out.slice(0, 30_000)}\n… (cut short; ask for less at a time)` : out;
          },
        }), action.kind === "destructive" ? { deletes: true } : {}),
      );
    }
  }
  return tools;
}

/** A line for the agent's instructions naming the connected services, so it knows the tools are there. */
export function serviceNotes(agent?: string): string[] {
  const all = saved().filter((c) => allowed(c, agent));
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
  /** Sent as it is, with this content type. */
  raw?: { type: string; data: string };
  /** The answer is plain text (a file's contents), returned as a string and cut at this many characters. */
  text?: number;
}

/** One call to a service. Follows no redirects (a key must only reach its own service) and explains refusals plainly. */
export async function call<T = any>(url: string, opts: CallOptions): Promise<T> {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error(`${opts.name}'s address must start with https://.`);
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : opts.form ? { "content-type": "application/x-www-form-urlencoded" } : opts.raw ? { "content-type": opts.raw.type } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.form ? new URLSearchParams(opts.form).toString() : opts.raw?.data,
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
  if (res.ok) return (opts.text ? text.slice(0, opts.text) : data) as T;
  // Some services answer with the fields at fault as an object ({"title": ["is too long"]}): say them in words.
  const fields = data?.message && typeof data.message === "object" ? Object.entries(data.message).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ") : "";
  // Xero lists what is wrong with each record under Elements.
  const faults = Array.isArray(data?.Elements) ? data.Elements.flatMap((e: any) => (Array.isArray(e?.ValidationErrors) ? e.ValidationErrors.map((v: any) => String(v?.Message ?? "")) : [])).filter(Boolean).slice(0, 4).join("; ") : "";
  // Jira lists general reasons under errorMessages and the fields at fault under errors.
  const reasons = [...(Array.isArray(data?.errorMessages) ? data.errorMessages.map(String) : []), ...(data?.errors && typeof data.errors === "object" && !Array.isArray(data.errors) ? Object.entries(data.errors).map(([k, v]) => `${k}: ${String(v)}`) : [])].slice(0, 4).join("; ");
  // Freshdesk lists the fields at fault as [{field, message}]; ClickUp says what went wrong under err.
  const listed = Array.isArray(data?.errors) ? data.errors.map((e: any) => (e && typeof e === "object" ? `${e.field ? `${e.field}: ` : ""}${String(e.message ?? e.detail ?? e.title ?? e.code ?? "")}` : String(e))).filter(Boolean).slice(0, 4).join("; ") : "";
  const said = String(fields || faults || reasons || listed || (typeof data?.err === "string" ? data.err : "") || (data?.ok === false && typeof data?.description === "string" ? data.description : "") || (data?.message ?? data?.Message ?? data?.error?.message ?? data?.detail ?? data?.error_description ?? (typeof data?.error === "string" ? data.error : "") ?? ""))
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


// ---------- signing in through the browser ----------
// The owner registers their own app with the service and gives Talqava its ID (and secret, where it has one). The
// browser is sent to the service, the owner approves, and the service sends a one-time code back to this computer,
// which is exchanged for tokens. The tokens stay on this computer and are renewed here as they run out.
interface Pending {
  service: string;
  clientId: string;
  clientSecret: string;
  verifier: string;
  redirect: string;
  asked: Record<string, string>;
  rule?: unknown;
  at: number;
  /** True when Talqava's sign-in service holds this app's secret and does the exchange. */
  relay?: boolean;
}
const pending = new Map<string, Pending>();
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Starts a browser sign-in: returns the address to open. `redirect` is this app's own address for the answer. */
export function startBrowserSignIn(id: string, input: { clientId?: unknown; clientSecret?: unknown; rule?: unknown; values?: unknown }, redirect: string): { url: string } {
  const def = serviceOf(id);
  if (!def.browser || (def.browser.relayOnly && !relayApp(def))) throw new Error(`${def.name} connects with a key, not a browser sign-in.`);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(redirect) && !/^https:\/\//.test(redirect)) throw new Error("Open Talqava on this computer to sign in to a service.");
  // The owner's own app first; else an app of Talqava's that needs no secret; else one whose secret Talqava's sign-in service keeps.
  const own = def.browser.relayOnly ? "" : String(input.clientId ?? "").trim();
  const viaRelay = !own && !builtInApp(def) && Boolean(relayApp(def));
  const clientId = own || builtInApp(def) || relayApp(def);
  const clientSecret = viaRelay ? "" : String(input.clientSecret ?? "").trim();
  if (!clientId || clientId.length > 500 || /\s/.test(clientId)) throw new Error(`Paste your app's ${(def.browser.idLabel ?? "client ID").replace(/^Client/, "client")}.`);
  if (def.browser.secret === "required" && !clientSecret && !viaRelay) throw new Error("Paste your app's client secret.");
  // Through the sign-in service, the browser comes back by way of Talqava's website, which sends it on to this computer.
  const localPort = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\//.exec(redirect)?.[1] ?? "";
  if (viaRelay && !localPort) throw new Error("Open Talqava on this computer to sign in to a service.");
  if (viaRelay) redirect = `${relayAddress()}/callback.php`;
  const asked: Record<string, string> = {};
  for (const f of def.browser.ask ?? []) {
    const v = String((input.values as Record<string, unknown> | undefined)?.[f.key] ?? "").trim().toLowerCase();
    if (!v || !new RegExp(`^(?:${f.pattern ?? "[a-z0-9-]{1,63}"})$`).test(v)) throw new Error(`Give ${f.label[0].toLowerCase()}${f.label.slice(1)}${f.placeholder ? `, like ${f.placeholder}` : ""}.`);
    asked[f.key] = v;
  }
  const authUrl = filled(def.browser.authUrl, asked);
  for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
  if (pending.size > 50) throw new Error("Too many sign-ins were started. Wait ten minutes and try again.");
  // Through the sign-in service the state starts with this app's port, so the website knows where on this computer to send the browser back.
  const state = `${viaRelay ? `${localPort}.` : ""}${b64url(crypto.randomBytes(32))}`;
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { service: id, clientId, clientSecret: def.browser.secret === "never" ? "" : clientSecret, verifier, redirect, asked, rule: input.rule, at: Date.now(), relay: viaRelay });
  const scope = def.browser.scopes.join(def.browser.scopeSeparator ?? " ");
  if (def.browser.kind === "fragment") {
    // The token comes back in the address after the #, which only the browser sees; the page it lands on hands it over.
    const back = new URLSearchParams({ key: clientId, scope, response_type: "token", callback_method: "fragment", return_url: `${redirect}/${state}`, ...(def.browser.extra ?? {}) });
    return { url: `${authUrl}?${back}` };
  }
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope, state, ...(def.browser.pkce === false ? {} : { code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" }), ...(def.browser.extra ?? {}) });
  return { url: `${authUrl}${authUrl.includes("?") ? "&" : "?"}${q}` };
}

type TokenAnswer = { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: string } & Record<string, unknown>;
async function tokenCall(def: ServiceDef, form: Record<string, string>, asked: Record<string, string> = {}): Promise<TokenAnswer> {
  const url = baseOf(`${def.id}_token`, filled(def.browser!.tokenUrl, asked));
  const style = def.browser!.tokenStyle ?? "form";
  const { client_id, client_secret, ...rest } = form;
  const t =
    style === "basic"
      ? await call<any>(url, { name: def.name, method: "POST", form: rest, headers: { authorization: `Basic ${Buffer.from(`${client_id}:${client_secret ?? ""}`).toString("base64")}` } })
      : style === "json"
        ? await call<any>(url, { name: def.name, method: "POST", body: form })
        : await call<any>(url, { name: def.name, method: "POST", form });
  if (!t?.access_token) throw new Error(`${def.name} did not complete the sign-in.`);
  return t;
}
/** When a token runs out, in milliseconds: from how long it lasts, or from the moment the service names. Nothing when it does not say. */
const expiryOf = (t: TokenAnswer): number | null => {
  if (Number(t.expires_in) > 0) return Date.now() + Number(t.expires_in) * 1000;
  const at = typeof t.expires_at === "string" ? Date.parse(t.expires_at) : NaN;
  return Number.isFinite(at) ? at : null;
};
/** The extra fields of a token answer a service asked to keep. */
const kept = (def: ServiceDef, t: TokenAnswer): Record<string, string> => Object.fromEntries((def.browser!.keep ?? []).filter((k) => typeof t[k] === "string" && t[k]).map((k) => [k, String(t[k]).slice(0, 500)]));

/** Finishes a browser sign-in with the code the service sent back. The account is checked before it is saved. */
export async function finishBrowserSignIn(state: unknown, code: unknown, problem?: unknown): Promise<PublicConnection> {
  const p = pending.get(String(state ?? ""));
  pending.delete(String(state ?? ""));
  if (!p || Date.now() - p.at > 600_000) throw new Error("That sign-in was not started here, or it took longer than ten minutes. Start it again from Connections.");
  const def = serviceOf(p.service);
  if (problem || !code) throw new Error(problem === "access_denied" ? `You did not approve the sign-in, so ${def.name} was not connected.` : `${def.name} did not complete the sign-in${problem ? ` (${String(problem).slice(0, 80)})` : ""}.`);
  if (def.browser!.kind === "fragment") throw new Error(`${def.name} did not complete the sign-in.`);
  const t = p.relay
    ? await relayCall(def, "token", { code: String(code), ...(def.browser!.pkce === false ? {} : { code_verifier: p.verifier }), asked: p.asked })
    : await tokenCall(def, { grant_type: "authorization_code", code: String(code), redirect_uri: p.redirect, client_id: p.clientId, ...(def.browser!.pkce === false ? {} : { code_verifier: p.verifier }), ...(p.clientSecret ? { client_secret: p.clientSecret } : {}) }, p.asked);
  // A token with no stated lifetime and nothing to renew it with does not run out (the service says so by leaving both out).
  const lasting = expiryOf(t) === null && !t.refresh_token;
  const values: Record<string, string> = { ...p.asked, client_id: p.clientId, ...(p.clientSecret ? { client_secret: p.clientSecret } : {}), access_token: t.access_token, ...(p.relay ? { relay: "1" } : {}), ...(def.browser!.renewWithRedirect ? { redirect_uri: p.redirect } : {}), ...(def.browser!.tokenKey ? { [def.browser!.tokenKey]: t.access_token } : {}), ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}), ...(lasting ? {} : { expires_at: String(expiryOf(t) ?? Date.now() + 3600_000) }), ...kept(def, t) };
  return signedIn(def, p, values);
}

/** Whether a sign-in that was started is one whose token comes back after the # (so the landing page must hand it over). */
export const awaitsFragment = (state: unknown): boolean => ((p) => Boolean(p && serviceOf(p.service).browser?.kind === "fragment"))(pending.get(String(state ?? "")));

/** Finishes a sign-in whose token came back in the address (Trello). The account is checked before it is saved. */
export async function finishFragmentSignIn(state: unknown, token: unknown): Promise<PublicConnection> {
  const p = pending.get(String(state ?? ""));
  pending.delete(String(state ?? ""));
  if (!p || Date.now() - p.at > 600_000) throw new Error("That sign-in was not started here, or it took longer than ten minutes. Start it again from Connections.");
  const def = serviceOf(p.service);
  const given = String(token ?? "").trim();
  if (def.browser?.kind !== "fragment" || !given) throw new Error(`You did not approve the sign-in, so ${def.name} was not connected.`);
  if (given.length > 2000 || /[^\w.~-]/.test(given)) throw new Error(`${def.name} did not complete the sign-in.`);
  return signedIn(def, p, { [def.browser.idKey ?? "client_id"]: p.clientId, [def.browser.tokenKey ?? "access_token"]: given });
}

async function signedIn(def: ServiceDef, p: Pending, values: Record<string, string>): Promise<PublicConnection> {
  const found = await def.check(values);
  const label = String(found.label || def.name).replace(/\s+/g, " ").trim().slice(0, 120);
  const all = saved();
  const before = all.find((c) => c.service === def.id && c.label.toLowerCase() === label.toLowerCase());
  const connection: Connection = {
    id: before?.id ?? crypto.randomBytes(5).toString("hex"),
    service: def.id,
    label,
    // A service may not send the renewing token again when the same account signs in twice: the earlier one is kept.
    values: { ...(before?.values.refresh_token && !values.refresh_token ? { refresh_token: before.values.refresh_token } : {}), ...values, ...(found.values ?? {}) },
    rule: CHANGE_RULES.includes(p.rule as ChangeRule) ? (p.rule as ChangeRule) : (before?.rule ?? "ask"),
    addedAt: before?.addedAt ?? new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
  store([...all.filter((c) => c.id !== connection.id), connection]);
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Connected ${def.name}`, detail: `${label}, signed in through the browser` });
  return view(connection);
}

const renewing = new Map<string, Promise<Connection>>();
/** A connection whose access token is good for at least another minute, renewed here when it is not. */
async function fresh(c: Connection): Promise<Connection> {
  const def = serviceOf(c.service);
  if (!def.browser || !c.values.expires_at || Number(c.values.expires_at) - Date.now() > 60_000) return c;
  if (!c.values.refresh_token) throw Object.assign(new Error(`The sign-in to ${def.name} (${c.label}) has run out. The owner signs in again under Connections.`), { refused: true });
  const running = renewing.get(c.id);
  if (running) return running;
  const work = (async () => {
    let t;
    try {
      t = c.values.relay
        ? await relayCall(def, "refresh", { refresh_token: c.values.refresh_token, asked: Object.fromEntries((def.browser!.ask ?? []).map((f) => [f.key, c.values[f.key] ?? ""])) })
        : await tokenCall(def, { grant_type: "refresh_token", refresh_token: c.values.refresh_token, client_id: c.values.client_id, ...(def.browser!.renewWithRedirect && c.values.redirect_uri ? { redirect_uri: c.values.redirect_uri } : {}), ...(c.values.client_secret ? { client_secret: c.values.client_secret } : {}) }, c.values);
    } catch (err) {
      // The service no longer honours the sign-in (revoked, or too old): the owner has to sign in again.
      if ((err as Error).message.includes(" answered 400") || (err as { refused?: boolean }).refused) {
        const why = `The sign-in to ${def.name} is no longer accepted. Sign in again.`;
        mark(c.id, why);
        throw Object.assign(new Error(why), { refused: true });
      }
      throw err;
    }
    const all = saved();
    const mine = all.find((x) => x.id === c.id) ?? c;
    mine.values = { ...mine.values, access_token: t.access_token, ...(def.browser!.tokenKey ? { [def.browser!.tokenKey]: t.access_token } : {}), ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}), expires_at: String(expiryOf(t) ?? Date.now() + 3600_000), ...kept(def, t) };
    if (all.includes(mine)) store(all);
    return mine;
  })().finally(() => renewing.delete(c.id));
  renewing.set(c.id, work);
  return work;
}


// ---------- events that start tasks ----------
// A desktop app has no public address for a service to call, so Talqava looks instead: every few minutes it asks each
// watched account for its newest things and starts a task for whatever it has not seen before.
export const watches = (): Watch[] => getConfig().watches ?? [];
const triggerOf = (c: Connection, name: string): TriggerDef => {
  const t = serviceOf(c.service).triggers?.find((x) => x.name === name);
  if (!t) throw new Error("That service has no such event.");
  return t;
};

/** Starts watching. What is already there is noted first, so only things that happen from now on start a task. */
export async function addWatch(input: { connection?: unknown; trigger?: unknown; param?: unknown; bot?: unknown; org?: unknown; instructions?: unknown }): Promise<Omit<Watch, "seen">> {
  const c = saved().find((x) => x.id === String(input.connection ?? ""));
  if (!c) throw new Error("There is no such connection.");
  const trigger = triggerOf(c, String(input.trigger ?? ""));
  const param = String(input.param ?? "").trim().slice(0, 300);
  if (trigger.param?.required && !param) throw new Error(`Fill in: ${trigger.param.label}.`);
  const bot = String(input.bot ?? "").trim();
  const org = String(input.org ?? "").trim();
  if (!bot || !org) throw new Error("Choose the agent that handles it.");
  const instructions = String(input.instructions ?? "").trim().slice(0, 4000);
  if (!instructions) throw new Error("Say what the agent should do each time.");
  if (watches().length >= 50) throw new Error("There are already 50 of these. Remove one first.");
  const seen = (await trigger.list(await fresh(c), param)).slice(0, 500);
  const watch: Watch = { id: crypto.randomBytes(5).toString("hex"), connection: c.id, trigger: trigger.name, param, bot, org, instructions, on: true, seen, addedAt: new Date().toISOString() };
  saveConfig({ watches: [...watches(), watch] });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Set up a task for when something happens in ${serviceOf(c.service).name}`, detail: `${c.label}: ${trigger.summary}` });
  const { seen: _s, ...shown } = watch;
  return shown;
}
export function setWatch(id: string, input: { on?: unknown }): { ok: true } {
  const all = watches();
  const w = all.find((x) => x.id === id);
  if (!w) throw new Error("There is no such event.");
  w.on = input.on === true;
  saveConfig({ watches: all });
  return { ok: true };
}
export function removeWatch(id: string): { ok: true } {
  if (!watches().some((x) => x.id === id)) throw new Error("There is no such event.");
  saveConfig({ watches: watches().filter((x) => x.id !== id) });
  return { ok: true };
}

/** What a watch found, handed to whoever starts the task. `text` came from outside and is information, never instructions. */
export interface Happening {
  watch: Watch;
  service: string;
  account: string;
  event: string;
  title: string;
  text: string;
}
let looking = false;
/** Looks at every watched account once and hands each new thing to `start`. At most five tasks a watch each time. */
export async function pollWatches(start: (h: Happening) => void): Promise<number> {
  if (looking) return 0;
  looking = true;
  let started = 0;
  try {
    for (const w of watches().filter((x) => x.on)) {
      const c = saved().find((x) => x.id === w.connection);
      if (!c || c.problem) continue;
      const result: Watch["last"] = { at: new Date().toISOString(), started: 0 };
      let seen = w.seen;
      try {
        const def = serviceOf(c.service);
        const trigger = triggerOf(c, w.trigger);
        const live = await fresh(c);
        const ids = await trigger.list(live, w.param);
        const fresh_ = ids.filter((id) => !w.seen.includes(id));
        // Oldest first, and no more than five at once: a sudden flood is spread over the next looks.
        for (const id of fresh_.reverse().slice(0, 5)) {
          const what = await trigger.describe(live, id, w.param);
          start({ watch: w, service: def.name, account: c.label, event: trigger.summary, title: what.title.replace(/\s+/g, " ").slice(0, 140), text: what.text.slice(0, 20_000) });
          seen = [id, ...seen];
          result.started++;
          started++;
        }
        seen = seen.slice(0, 500);
      } catch (err) {
        result.problem = (err as Error).message.slice(0, 300);
      }
      saveConfig({ watches: watches().map((x) => (x.id === w.id ? { ...x, seen, last: result } : x)) });
    }
  } finally {
    looking = false;
  }
  return started;
}
