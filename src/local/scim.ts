// Directory sync (SCIM 2.0): a company's identity provider adds people to Talqava, keeps their names up to date, and
// switches them off the moment they are removed there. Users only; groups are not mapped. The provider signs in with
// a long random token made here and shown once; only its hash is kept.
//
// This is for a Talqava that the provider can reach over the network (one run on a server). A copy that runs only on
// one person's computer cannot be reached by a directory.
import crypto from "node:crypto";
import { getConfig, saveConfig } from "./store.ts";
import { audit } from "./audit.ts";
import { people, ROLES, type Person, type Role } from "./people.ts";

const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** What the settings page shows: whether it is on, the role new people get, and when the directory last called. */
export function scimSettings() {
  const s = getConfig().scim;
  return s ? { on: true, role: s.role as Role, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt ?? null } : { on: false, role: "member" as Role, createdAt: null, lastUsedAt: null };
}
/** Switches directory sync on (or makes a new token). The token is returned once and never shown again. */
export function enableScim(input: { role?: unknown }): { token: string } {
  const role = ROLES.includes(input.role as Role) && input.role !== "owner" ? (input.role as Role) : "member";
  const token = crypto.randomBytes(32).toString("base64url");
  saveConfig({ scim: { tokenHash: hash(token), role, createdAt: new Date().toISOString() } });
  audit({ actor: "owner", actorName: "You", kind: "security", action: "Switched on directory sync", detail: `New people get the role ${role}` });
  return { token };
}
export function disableScim(): { ok: true } {
  saveConfig({ scim: undefined });
  audit({ actor: "owner", actorName: "You", kind: "security", action: "Switched off directory sync" });
  return { ok: true };
}
/** Whether a request carries the directory's token. */
export function scimAuthorized(header: unknown): boolean {
  const s = getConfig().scim;
  // Most providers send "Bearer <token>"; one that sends the token alone in the header is accepted too.
  const given = String(header ?? "").replace(/^Bearer\s+/i, "");
  if (!s || !given) return false;
  const a = Buffer.from(hash(given.trim()));
  const b = Buffer.from(s.tokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface ScimAnswer {
  status: number;
  body?: unknown;
}
const fail = (status: number, detail: string, scimType?: string): ScimAnswer => ({ status, body: { schemas: [ERROR], status: String(status), ...(scimType ? { scimType } : {}), detail } });
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : /^true$/i.test(String(v)) ? true : /^false$/i.test(String(v)) ? false : undefined);

/** A person as SCIM describes a user. */
function resource(p: Person & { directoryId?: string }, base: string) {
  const [given, ...rest] = p.name.split(" ");
  return {
    schemas: [USER],
    id: p.id,
    ...(p.directoryId ? { externalId: p.directoryId } : {}),
    userName: p.email,
    name: { formatted: p.name, givenName: given, familyName: rest.join(" ") },
    displayName: p.name,
    emails: [{ value: p.email, type: "work", primary: true }],
    active: p.active,
    meta: { resourceType: "User", created: p.createdAt, lastModified: p.createdAt, location: `${base}/Users/${p.id}` },
  };
}
const one = (id: string, base: string) => ((p) => (p ? resource(p, base) : null))(people.fromDirectory(id));

/** The name and email a SCIM user body carries, whichever of its fields the provider filled in. */
function fields(body: any): { name?: string; email?: string; active?: boolean; directoryId?: string } {
  const name = String(body?.displayName ?? body?.name?.formatted ?? [body?.name?.givenName, body?.name?.familyName].filter(Boolean).join(" ") ?? "").trim();
  const emails: any[] = Array.isArray(body?.emails) ? body.emails : [];
  // The sign-in name is the userName when it is an email address (as providers normally send it), so that a later
  // look-up by userName finds the same person; otherwise the primary email.
  const userName = String(body?.userName ?? "").trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userName) ? userName : String(emails.find((e) => e?.primary)?.value ?? emails[0]?.value ?? userName).trim();
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(bool(body?.active) !== undefined ? { active: bool(body.active) } : {}), ...(body?.externalId !== undefined ? { directoryId: String(body.externalId) } : {}) };
}

/** One change from a PATCH request, as the fields it sets. Providers differ in letter case and in how they write it. */
function patchOf(op: any, current: Person): ReturnType<typeof fields> {
  const kind = String(op?.op ?? "").toLowerCase();
  if (!["add", "replace"].includes(kind)) return {};
  const path = String(op?.path ?? "").trim();
  if (!path) {
    // No path: the value is an object. Its keys are attribute names, or (from Microsoft) dotted paths such as "name.givenName".
    if (!op.value || typeof op.value !== "object") return {};
    let out = fields(op.value);
    for (const [k, v] of Object.entries(op.value)) if (k.includes(".") || k.includes("[")) out = { ...out, ...patchOf({ op: kind, path: k, value: v }, { ...current, name: out.name ?? current.name }) };
    return out;
  }
  const key = path.toLowerCase();
  const v = op.value;
  if (key === "active") return bool(v) === undefined ? {} : { active: bool(v) };
  if (key === "username" || /^emails(\[.*\])?(\.value)?$/.test(key)) return { email: String(Array.isArray(v) ? (v[0]?.value ?? "") : (v?.value ?? v ?? "")) };
  if (key === "displayname" || key === "name.formatted") return { name: String(v ?? "") };
  if (key === "externalid") return { directoryId: String(v ?? "") };
  const [given, ...rest] = current.name.split(" ");
  if (key === "name.givenname") return { name: `${String(v ?? "")} ${rest.join(" ")}`.trim() };
  if (key === "name.familyname") return { name: `${given} ${String(v ?? "")}`.trim() };
  if (key === "name" && v && typeof v === "object") return fields({ name: v });
  return {};
}

/**
 * Answers one directory request. `path` is what follows /scim/v2 ("Users", "Users/<id>", …); `base` is the full
 * address of /scim/v2, for the links in the answers.
 */
export function handleScim(method: string, path: string[], query: URLSearchParams, body: any, base: string): ScimAnswer {
  saveConfig({ scim: { ...getConfig().scim!, lastUsedAt: new Date().toISOString() } });
  const [kind, id] = path;
  const role = scimSettings().role;
  const said = (action: string, detail: string) => audit({ actor: "system", actorName: "The company directory", kind: "security", action, detail });
  try {
    if (kind === "ServiceProviderConfig" && method === "GET")
      return { status: 200, body: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "A token made in Talqava's Security settings." }] } };
    if (kind === "ResourceTypes" && method === "GET") return { status: 200, body: { schemas: [LIST], totalResults: 1, startIndex: 1, itemsPerPage: 1, Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER }] } };
    // Groups are not mapped: an empty list, so a provider that looks for them finds none.
    if (kind === "Groups" && method === "GET" && !id) return { status: 200, body: { schemas: [LIST], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] } };
    if (kind === "Schemas" && method === "GET") return { status: 200, body: { schemas: [LIST], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] } };
    if (kind !== "Users") return fail(404, "There is no such resource here.");

    if (!id) {
      if (method === "GET") {
        const filter = /^\s*(userName|externalId|emails(?:\[[^\]]*\])?(?:\.value)?)\s+eq\s+(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))\s*$/i.exec(query.get("filter") ?? "");
        if (query.get("filter") && !filter) return fail(400, "Only filters like userName eq \"name@example.com\" are supported.", "invalidFilter");
        const want = (filter?.[2] ?? filter?.[3])?.replace(/\\(.)/g, "$1").toLowerCase();
        const all = people.list().map((p) => people.fromDirectory(p.id)!).filter((p) => !filter || (/^externalid$/i.test(filter[1]) ? p.directoryId.toLowerCase() === want : p.email === want));
        const start = Math.max(1, Math.floor(Number(query.get("startIndex")) || 1));
        const size = Math.min(200, Math.max(0, query.get("count") === null ? 100 : Math.floor(Number(query.get("count")) || 0)));
        const page = all.slice(start - 1, start - 1 + size);
        return { status: 200, body: { schemas: [LIST], totalResults: all.length, startIndex: start, itemsPerPage: page.length, Resources: page.map((p) => resource(p, base)) } };
      }
      if (method === "POST") {
        const f = fields(body);
        if (!f.email) return fail(400, "A user needs a userName or an email address.", "invalidValue");
        const p = people.provision({ email: f.email, name: f.name ?? f.email, directoryId: f.directoryId, active: f.active }, role);
        said("Added a person", `${p.name} (${p.email}), as ${p.role}${p.active ? "" : ", switched off"}`);
        return { status: 201, body: one(p.id, base) };
      }
      return fail(405, "That is not supported here.");
    }

    const now = people.fromDirectory(id);
    if (!now) return fail(404, `There is no user ${id}.`);
    if (method === "GET") return { status: 200, body: resource(now, base) };
    if (method === "PUT" || method === "PATCH") {
      let change: ReturnType<typeof fields> = {};
      if (method === "PUT") change = fields(body);
      else for (const op of Array.isArray(body?.Operations) ? body.Operations : []) change = { ...change, ...patchOf(op, now) };
      const p = people.directoryUpdate(id, change);
      if (change.active !== undefined && change.active !== now.active) said(change.active ? "Switched a person back on" : "Switched a person off", `${p.name} (${p.email}). ${change.active ? "They can sign in again." : "Their sessions ended and they can no longer sign in."}`);
      else if (Object.keys(change).length) said("Updated a person", `${p.name} (${p.email})`);
      return { status: 200, body: one(id, base) };
    }
    if (method === "DELETE") {
      people.directoryRemove(id);
      said("Removed a person", `${now.name} (${now.email})`);
      return { status: 204 };
    }
    return fail(405, "That is not supported here.");
  } catch (err) {
    const e = err as Error & { exists?: boolean; forbidden?: boolean };
    return e.exists ? fail(409, e.message, "uniqueness") : e.forbidden ? fail(403, e.message) : fail(400, e.message, "invalidValue");
  }
}
