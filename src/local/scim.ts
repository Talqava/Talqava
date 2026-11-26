// Directory sync (SCIM 2.0): a company's identity provider adds people to Talqava, keeps their names up to date, and
// switches them off the moment they are removed there. The directory's groups are kept too, and the owner can say
// which role each group gives. The provider signs in with a long random token made here and shown once; only its
// hash is kept.
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
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

// ---------- groups, and the role each gives ----------
interface DirGroup {
  id: string;
  name: string;
  externalId?: string;
  members: string[];
}
/** The most a group can give: an administrator outranks a manager, a manager an auditor, an auditor a member. */
const RANK: Record<string, number> = { member: 1, auditor: 2, manager: 3, admin: 4 };
const groupsNow = (): DirGroup[] => getConfig().scim?.groups ?? [];
const rolesNow = (): Record<string, Role> => (getConfig().scim?.groupRoles ?? {}) as Record<string, Role>;
const saveGroups = (groups: DirGroup[]) => saveConfig({ scim: { ...getConfig().scim!, groups } });

/**
 * Gives each of these people the role their groups carry: the highest among their groups that have one, or the role
 * for new people when none does. Only when at least one group has a role, so that sync without mapping changes nothing.
 */
function applyRoles(ids: Iterable<string>) {
  const roles = rolesNow();
  if (!Object.keys(roles).length) return;
  const groups = groupsNow();
  const usual = scimSettings().role;
  for (const id of new Set(ids)) {
    const mine = groups.filter((g) => g.members.includes(id)).map((g) => roles[g.name.toLowerCase()]).filter(Boolean);
    const role = mine.sort((a, b) => RANK[b] - RANK[a])[0] ?? usual;
    const before = people.fromDirectory(id);
    if (before && people.directoryRole(id, role)) audit({ actor: "system", actorName: "The company directory", kind: "security", action: "Changed a person's role from their groups", detail: `${before.name} (${before.email}): ${before.role} to ${role}` });
  }
}

/** The directory's groups as the settings page shows them: name, how many people, and the role each gives. */
export function directoryGroups() {
  const roles = rolesNow();
  return groupsNow().map((g) => ({ name: g.name, people: g.members.filter((id) => people.fromDirectory(id)).length, role: roles[g.name.toLowerCase()] ?? null }));
}
/** Sets which role each group gives ({ "Finance managers": "manager" }; an empty role takes the mapping away), and applies it. */
export function setGroupRoles(input: unknown): { ok: true } {
  if (!getConfig().scim) throw new Error("Switch on directory sync first.");
  const next: Record<string, Role> = { ...rolesNow() };
  for (const [name, role] of Object.entries((input ?? {}) as Record<string, unknown>).slice(0, 200)) {
    const key = name.trim().toLowerCase().slice(0, 200);
    if (!key) continue;
    if (role === "owner") throw new Error("A group cannot give the owner's role.");
    if (ROLES.includes(role as Role)) next[key] = role as Role;
    else delete next[key];
  }
  const everyone = groupsNow().flatMap((g) => g.members);
  const had = Object.keys(rolesNow()).length > 0;
  saveConfig({ scim: { ...getConfig().scim!, groupRoles: next } });
  audit({ actor: "owner", actorName: "You", kind: "security", action: "Set which role each directory group gives", detail: Object.entries(next).map(([g, r]) => `${g}: ${r}`).join(", ").slice(0, 300) || "No group gives a role" });
  // With the last mapping gone, people in groups go back to the role for new people.
  if (Object.keys(next).length) applyRoles(everyone);
  else if (had) for (const id of new Set(everyone)) people.directoryRole(id, scimSettings().role);
  return { ok: true };
}

/** A group as SCIM describes it. */
function groupResource(g: DirGroup, base: string) {
  return {
    schemas: [GROUP],
    id: g.id,
    ...(g.externalId ? { externalId: g.externalId } : {}),
    displayName: g.name,
    members: g.members.flatMap((id) => ((p) => (p ? [{ value: id, display: p.name, $ref: `${base}/Users/${id}` }] : []))(people.fromDirectory(id))),
    meta: { resourceType: "Group", location: `${base}/Groups/${g.id}` },
  };
}
/** The ids in a SCIM members value, keeping only people there are. */
const memberIds = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map((m: any) => String(m?.value ?? m ?? "")).filter((id) => people.fromDirectory(id)))].slice(0, 5000);

function handleGroups(method: string, id: string | undefined, query: URLSearchParams, body: any, base: string): ScimAnswer {
  const groups = groupsNow().map((g) => ({ ...g, members: [...g.members] }));
  const said = (action: string, detail: string) => audit({ actor: "system", actorName: "The company directory", kind: "security", action, detail });
  if (!id) {
    if (method === "GET") {
      const filter = /^\s*displayName\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(query.get("filter") ?? "");
      if (query.get("filter") && !filter) return fail(400, 'Only filters like displayName eq "Finance" are supported.', "invalidFilter");
      const want = filter?.[1].replace(/\\(.)/g, "$1").toLowerCase();
      const all = groups.filter((g) => !filter || g.name.toLowerCase() === want);
      const start = Math.max(1, Math.floor(Number(query.get("startIndex")) || 1));
      const size = Math.min(200, Math.max(0, query.get("count") === null ? 100 : Math.floor(Number(query.get("count")) || 0)));
      const page = all.slice(start - 1, start - 1 + size);
      return { status: 200, body: { schemas: [LIST], totalResults: all.length, startIndex: start, itemsPerPage: page.length, Resources: page.map((g) => groupResource(g, base)) } };
    }
    if (method === "POST") {
      const name = String(body?.displayName ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!name) return fail(400, "A group needs a displayName.", "invalidValue");
      if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return fail(409, "There is already a group with that name.", "uniqueness");
      if (groups.length >= 500) return fail(400, "There are too many groups.", "tooMany");
      const g: DirGroup = { id: crypto.randomBytes(8).toString("hex"), name, ...(body?.externalId !== undefined ? { externalId: String(body.externalId).slice(0, 200) } : {}), members: memberIds(body?.members) };
      saveGroups([...groups, g]);
      said("Added a group", `${g.name}, ${g.members.length} ${g.members.length === 1 ? "person" : "people"}`);
      applyRoles(g.members);
      return { status: 201, body: groupResource(g, base) };
    }
    return fail(405, "That is not supported here.");
  }
  const g = groups.find((x) => x.id === id);
  if (!g) return fail(404, `There is no group ${id}.`);
  if (method === "GET") return { status: 200, body: groupResource(g, base) };
  const before = [...g.members];
  if (method === "DELETE") {
    saveGroups(groups.filter((x) => x.id !== id));
    said("Removed a group", g.name);
    applyRoles(before);
    return { status: 204 };
  }
  if (method !== "PUT" && method !== "PATCH") return fail(405, "That is not supported here.");
  const rename = (v: unknown) => {
    const name = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!name) return;
    if (groups.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error("There is already a group with that name."), { exists: true });
    g.name = name;
  };
  if (method === "PUT") {
    rename(body?.displayName);
    g.members = memberIds(body?.members);
  } else
    for (const op of Array.isArray(body?.Operations) ? body.Operations : []) {
      const kind = String(op?.op ?? "").toLowerCase();
      const path = String(op?.path ?? "").trim();
      const one = /^members\[value eq "([^"]+)"\]$/i.exec(path);
      if (kind === "remove" && one) g.members = g.members.filter((m) => m !== one[1]);
      else if (kind === "remove" && /^members$/i.test(path)) g.members = op.value === undefined ? [] : g.members.filter((m) => !memberIds(op.value).includes(m));
      else if ((kind === "add" || kind === "replace") && /^members$/i.test(path)) g.members = kind === "add" ? [...new Set([...g.members, ...memberIds(op.value)])] : memberIds(op.value);
      else if ((kind === "add" || kind === "replace") && /^displayName$/i.test(path)) rename(op.value);
      else if ((kind === "add" || kind === "replace") && !path && op.value && typeof op.value === "object") {
        if (op.value.displayName !== undefined) rename(op.value.displayName);
        if (op.value.members !== undefined) g.members = kind === "add" ? [...new Set([...g.members, ...memberIds(op.value.members)])] : memberIds(op.value.members);
      }
    }
  saveGroups(groups);
  if (before.join() !== g.members.join()) said("Changed who is in a group", `${g.name}: ${g.members.length} ${g.members.length === 1 ? "person" : "people"}`);
  applyRoles([...before, ...g.members]);
  return { status: method === "PUT" ? 200 : 200, body: groupResource(g, base) };
}

/** What the settings page shows: whether it is on, the role new people get, and when the directory last called. */
export function scimSettings() {
  const s = getConfig().scim;
  return s ? { on: true, role: s.role as Role, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt ?? null } : { on: false, role: "member" as Role, createdAt: null, lastUsedAt: null };
}
/** Switches directory sync on (or makes a new token). The token is returned once and never shown again. */
export function enableScim(input: { role?: unknown }): { token: string } {
  const role = ROLES.includes(input.role as Role) && input.role !== "owner" ? (input.role as Role) : "member";
  const token = crypto.randomBytes(32).toString("base64url");
  // A new token keeps the groups already known and the roles they give.
  const was = getConfig().scim;
  saveConfig({ scim: { tokenHash: hash(token), role, createdAt: new Date().toISOString(), ...(was?.groups ? { groups: was.groups } : {}), ...(was?.groupRoles ? { groupRoles: was.groupRoles } : {}) } });
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
    if (kind === "ResourceTypes" && method === "GET") return { status: 200, body: { schemas: [LIST], totalResults: 2, startIndex: 1, itemsPerPage: 2, Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER }, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: GROUP }] } };
    if (kind === "Groups") return handleGroups(method, id, query, body, base);
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
      // Someone who is gone is in no group any more.
      if (groupsNow().some((g) => g.members.includes(id))) saveGroups(groupsNow().map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })));
      said("Removed a person", `${now.name} (${now.email})`);
      return { status: 204 };
    }
    return fail(405, "That is not supported here.");
  } catch (err) {
    const e = err as Error & { exists?: boolean; forbidden?: boolean };
    return e.exists ? fail(409, e.message, "uniqueness") : e.forbidden ? fail(403, e.message) : fail(400, e.message, "invalidValue");
  }
}
