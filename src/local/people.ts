// People: the humans who may open this app, each with their own sign-in and a role. With nobody added, the app
// behaves as it always has on one computer. Once the owner makes their account, every request must come from someone
// signed in, and what they may do follows their role. Passwords are stretched with scrypt; the second step is a code
// from an authenticator app (TOTP, RFC 6238); sessions are random tokens of which only a hash is stored.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA, newId, writeJson } from "./store.ts";

export const ROLES = ["owner", "admin", "manager", "member", "auditor"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_WORDS: Record<Role, { name: string; may: string }> = {
  owner: { name: "Owner", may: "Everything, including people, security and deleting the organization." },
  admin: { name: "Administrator", may: "Everything except removing or changing the owner." },
  manager: { name: "Manager", may: "Gives and approves work, changes the chart, budgets, routines and the Marketplace. No settings, connections or people." },
  member: { name: "Member", may: "Gives tasks, chats, approves steps, and edits pages, documents and notes. Cannot change the chart, budgets, settings or connections, or read the audit log." },
  auditor: { name: "Auditor", may: "Reads everything, including the audit log and who has access. Changes nothing." },
};

interface StoredPerson {
  id: string;
  name: string;
  email: string;
  role: Role;
  groups: string[];
  salt: string;
  key: string;
  /** The second step: an authenticator app's secret. `on` once a first code proved it was set up. */
  totp?: { secret: string; on: boolean };
  failed: number;
  lockedUntil?: string;
  createdAt: string;
  lastSignIn?: string;
}
interface StoredSession {
  hash: string;
  person: string;
  createdAt: string;
  seenAt: string;
  device: string;
}
interface Store {
  people: StoredPerson[];
  sessions: StoredSession[];
  settings: { requireSecondStep: boolean; idleMinutes: number };
}

/** A person, as the app shows them: never the password key or the second step's secret. */
export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  groups: string[];
  secondStep: boolean;
  locked: boolean;
  createdAt: string;
  lastSignIn: string | null;
}

export const MIN_PASSWORD = 12;
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
export const IDLE_CHOICES = [60, 480, 1440, 10080];
const file = () => path.join(DATA, "people.json");

let cache: Store | null = null;
let cachedFrom = "";
function load(): Store {
  if (cache && cachedFrom === file()) return cache;
  let store: Store = { people: [], sessions: [], settings: { requireSecondStep: false, idleMinutes: 480 } };
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Store>;
    store = { people: Array.isArray(raw.people) ? raw.people : [], sessions: Array.isArray(raw.sessions) ? raw.sessions : [], settings: { ...store.settings, ...(raw.settings ?? {}) } };
  } catch {}
  cache = store;
  cachedFrom = file();
  return store;
}
const save = () => writeJson(file(), load());

const view = (p: StoredPerson): Person => ({ id: p.id, name: p.name, email: p.email, role: p.role, groups: p.groups, secondStep: Boolean(p.totp?.on), locked: Boolean(p.lockedUntil && p.lockedUntil > new Date().toISOString()), createdAt: p.createdAt, lastSignIn: p.lastSignIn ?? null });
const stretch = (password: string, salt: string) => crypto.scryptSync(password, salt, 32).toString("hex");
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const cleanEmail = (e: unknown) => String(e ?? "").trim().toLowerCase().slice(0, 200);
const cleanName = (n: unknown) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

function checkPassword(password: unknown): string {
  const p = String(password ?? "");
  if (p.length < MIN_PASSWORD) throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters. A few unrelated words work well.`);
  if (p.length > 200) throw new Error("That password is too long.");
  return p;
}
function setKey(p: StoredPerson, password: string) {
  p.salt = crypto.randomBytes(16).toString("hex");
  p.key = stretch(password, p.salt);
}

// ---------- the second step (authenticator app codes) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function fromBase32(text: string): Buffer {
  let bits = "";
  for (const ch of text.replace(/[\s=-]/g, "").toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("That is not an authenticator key.");
    bits += v.toString(2).padStart(5, "0");
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}
const toBase32 = (buf: Buffer) => ([...buf].map((b) => b.toString(2).padStart(8, "0")).join("").match(/.{1,5}/g) ?? []).map((b) => B32[parseInt(b.padEnd(5, "0"), 2)]).join("");
/** The six-digit code an authenticator app shows for a secret at a time (30-second steps). */
export function codeAt(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = crypto.createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
/** Whether a typed code is right, allowing the step before and after for clocks that differ a little. */
function codeFits(secret: string, code: unknown, at = Date.now()): boolean {
  const typed = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return false;
  return [-1, 0, 1].some((step) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, at + step * 30_000)), Buffer.from(typed)));
}

// ---------- what each role may do ----------
/** Parts of the app only an owner or administrator may change. */
const ADMIN_AREAS = new Set(["settings", "integrations", "gateway", "providers", "people", "model-check"]);
/** Parts a manager may change and a member may not. */
const MANAGER_AREAS = new Set(["orgs", "marketplace", "jobs", "goals", "crew", "quest-templates"]);

/**
 * Whether a role may make a request. Reading is open to every role, except that only owners, administrators,
 * managers and auditors read the audit log and the list of people. An auditor changes nothing.
 */
export function mayDo(role: Role, method: string, area: string, sub = ""): boolean {
  if (area === "me" || area === "login" || area === "logout") return true;
  if (role === "owner" || role === "admin") return true;
  const reading = method === "GET";
  if (area === "people") return reading && (role === "auditor" || (role === "manager" && sub !== "sessions"));
  if (area === "audit") return reading && role !== "member";
  if (role === "auditor") return reading;
  if (reading) return true;
  if (ADMIN_AREAS.has(area)) return false;
  if (MANAGER_AREAS.has(area)) return role === "manager";
  return true;
}

export const people = {
  /** True once at least one person has an account: from then on everyone signs in. */
  enabled(): boolean {
    return load().people.length > 0;
  },

  list(): Person[] {
    return load().people.map(view);
  },

  settings() {
    return { ...load().settings, idleChoices: IDLE_CHOICES, minPassword: MIN_PASSWORD };
  },

  /** The first account, which is the owner's. Only possible while nobody has one. */
  start(input: { name?: unknown; email?: unknown; password?: unknown }): Person {
    if (this.enabled()) throw new Error("People are already set up. Sign in to add more.");
    return this.add({ ...input, role: "owner" }, null);
  },

  /** Adds a person. `by` is who is adding them (null only for the very first account). */
  add(input: { name?: unknown; email?: unknown; password?: unknown; role?: unknown; groups?: unknown }, by: Person | null): Person {
    const s = load();
    const name = cleanName(input.name);
    const email = cleanEmail(input.email);
    if (!name) throw new Error("Give the person's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Give the person's email address. They sign in with it.");
    if (s.people.some((p) => p.email === email)) throw new Error("Someone already signs in with that email address.");
    const role = ROLES.includes(input.role as Role) ? (input.role as Role) : "member";
    if (by && role === "owner") throw new Error("There is one owner, and that role cannot be given to someone else yet.");
    const person: StoredPerson = { id: newId(), name, email, role, groups: Array.isArray(input.groups) ? input.groups.map(String).slice(0, 50) : [], salt: "", key: "", failed: 0, createdAt: new Date().toISOString() };
    setKey(person, checkPassword(input.password));
    s.people.push(person);
    save();
    return view(person);
  },

  /** Changes a person's name, role or groups. The owner's role stays; only the owner changes the owner. */
  update(id: string, patch: { name?: unknown; role?: unknown; groups?: unknown }, by: Person): Person {
    const p = load().people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (p.role === "owner" && by.role !== "owner") throw new Error("Only the owner changes the owner's account.");
    if (patch.name !== undefined) p.name = cleanName(patch.name) || p.name;
    if (patch.groups !== undefined) p.groups = Array.isArray(patch.groups) ? patch.groups.map(String).slice(0, 50) : [];
    if (patch.role !== undefined && patch.role !== p.role) {
      if (p.role === "owner" || patch.role === "owner") throw new Error("The owner's role cannot be changed here.");
      if (!ROLES.includes(patch.role as Role)) throw new Error("There is no such role.");
      p.role = patch.role as Role;
      // A changed role takes effect at once: their sessions end and they sign in again.
      load().sessions = load().sessions.filter((x) => x.person !== p.id);
    }
    save();
    return view(p);
  },

  /** Removes a person and ends their sessions. The owner cannot be removed. */
  remove(id: string, by: Person): { removed: true } {
    const s = load();
    const p = s.people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (p.role === "owner") throw new Error("The owner cannot be removed.");
    if (p.id === by.id) throw new Error("You cannot remove yourself.");
    s.people = s.people.filter((x) => x.id !== id);
    s.sessions = s.sessions.filter((x) => x.person !== id);
    save();
    return { removed: true };
  },

  /** A new password, set by the person themselves (with their current one) or by an administrator. Ends their other sessions. */
  setPassword(id: string, password: unknown, by: Person, current?: unknown): { ok: true } {
    const s = load();
    const p = s.people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (by.id === id) {
      if (!crypto.timingSafeEqual(Buffer.from(stretch(String(current ?? ""), p.salt)), Buffer.from(p.key))) throw new Error("That is not your current password.");
    } else if (p.role === "owner") throw new Error("Only the owner changes the owner's password.");
    setKey(p, checkPassword(password));
    p.failed = 0;
    p.lockedUntil = undefined;
    s.sessions = s.sessions.filter((x) => x.person !== id);
    save();
    return { ok: true };
  },

  /** Starts setting up the second step: a key for the person's authenticator app. It is on only after `confirmSecondStep`. */
  startSecondStep(id: string): { key: string; link: string } {
    const p = load().people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    const secret = toBase32(crypto.randomBytes(20));
    p.totp = { secret, on: false };
    save();
    return { key: secret.match(/.{1,4}/g)!.join(" "), link: `otpauth://totp/Talqava:${encodeURIComponent(p.email)}?secret=${secret}&issuer=Talqava` };
  },

  confirmSecondStep(id: string, code: unknown): Person {
    const p = load().people.find((x) => x.id === id);
    if (!p?.totp) throw new Error("Start setting up the second step first.");
    if (!codeFits(p.totp.secret, code)) throw new Error("That code is not right. Type the six digits your authenticator app shows now.");
    p.totp.on = true;
    save();
    return view(p);
  },

  /** Takes someone's second step off (their own, or by an administrator for a lost phone). */
  clearSecondStep(id: string, by: Person): Person {
    const p = load().people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (p.role === "owner" && by.role !== "owner") throw new Error("Only the owner changes the owner's account.");
    p.totp = undefined;
    save();
    return view(p);
  },

  setSettings(patch: { requireSecondStep?: unknown; idleMinutes?: unknown }) {
    const s = load();
    if (typeof patch.requireSecondStep === "boolean") s.settings.requireSecondStep = patch.requireSecondStep;
    if (IDLE_CHOICES.includes(Number(patch.idleMinutes))) s.settings.idleMinutes = Number(patch.idleMinutes);
    save();
    return this.settings();
  },

  /**
   * Signs someone in. Returns a session token, or says a code from their authenticator app is needed. Wrong passwords
   * count towards a lock; the message never says whether the email exists.
   */
  signIn(input: { email?: unknown; password?: unknown; code?: unknown }, device = ""): { token: string; person: Person; setUpSecondStep: boolean } | { needsCode: true } {
    const s = load();
    const wrong = () => new Error("That email and password do not match.");
    const p = s.people.find((x) => x.email === cleanEmail(input.email));
    // The same work is done for an unknown email, so timing does not give away who has an account.
    const typed = stretch(String(input.password ?? "").slice(0, 200), p?.salt ?? "0000000000000000");
    if (!p) throw wrong();
    if (p.lockedUntil && p.lockedUntil > new Date().toISOString()) throw new Error(`Too many wrong passwords. Try again after ${new Date(p.lockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, or ask an administrator to set a new password.`);
    if (!crypto.timingSafeEqual(Buffer.from(typed), Buffer.from(p.key))) {
      p.failed++;
      if (p.failed >= MAX_FAILED) {
        p.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
        p.failed = 0;
      }
      save();
      throw wrong();
    }
    if (p.totp?.on) {
      if (input.code === undefined || input.code === "") return { needsCode: true };
      if (!codeFits(p.totp.secret, input.code)) {
        p.failed++;
        if (p.failed >= MAX_FAILED) {
          p.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
          p.failed = 0;
        }
        save();
        throw new Error("That code is not right. Type the six digits your authenticator app shows now.");
      }
    }
    p.failed = 0;
    p.lockedUntil = undefined;
    p.lastSignIn = new Date().toISOString();
    const token = crypto.randomBytes(32).toString("hex");
    s.sessions = s.sessions.filter((x) => !this.expired(x)).slice(-500);
    s.sessions.push({ hash: hashToken(token), person: p.id, createdAt: p.lastSignIn, seenAt: p.lastSignIn, device: device.slice(0, 200) });
    save();
    return { token, person: view(p), setUpSecondStep: s.settings.requireSecondStep && !p.totp?.on };
  },

  expired(session: { seenAt: string }): boolean {
    return Date.now() - new Date(session.seenAt).getTime() > load().settings.idleMinutes * 60_000;
  },

  /** Who a session token belongs to, or null. Keeps the session alive (written at most once a minute). */
  who(token: string | undefined): Person | null {
    if (!token) return null;
    const s = load();
    const session = s.sessions.find((x) => x.hash === hashToken(token));
    if (!session || this.expired(session)) return null;
    const p = s.people.find((x) => x.id === session.person);
    if (!p) return null;
    if (Date.now() - new Date(session.seenAt).getTime() > 60_000) {
      session.seenAt = new Date().toISOString();
      save();
    }
    return view(p);
  },

  /** Whether this person must set up their second step before doing anything else. */
  mustSetUpSecondStep(person: Person): boolean {
    return load().settings.requireSecondStep && !person.secondStep;
  },

  signOut(token: string | undefined) {
    if (!token) return;
    const s = load();
    s.sessions = s.sessions.filter((x) => x.hash !== hashToken(token));
    save();
  },

  /** The open sessions, for administrators: who, since when, last seen, on what. */
  sessions(): { person: string; name: string; createdAt: string; seenAt: string; device: string }[] {
    const s = load();
    return s.sessions.filter((x) => !this.expired(x)).map((x) => ({ person: x.person, name: s.people.find((p) => p.id === x.person)?.name ?? "Someone removed", createdAt: x.createdAt, seenAt: x.seenAt, device: x.device }));
  },

  /** Ends every session, optionally keeping one (the administrator's own). */
  signEveryoneOut(keepToken?: string): { ended: number } {
    const s = load();
    const keep = keepToken ? hashToken(keepToken) : "";
    const before = s.sessions.length;
    s.sessions = s.sessions.filter((x) => x.hash === keep);
    save();
    return { ended: before - s.sessions.length };
  },
};
