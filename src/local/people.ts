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
  /** Switched off by the company directory: the account is kept, but nobody can sign in with it. */
  off?: boolean;
  /** The company directory's own id for this person, when the directory added them. */
  directoryId?: string;
}
interface StoredSession {
  hash: string;
  person: string;
  createdAt: string;
  seenAt: string;
  device: string;
  /** When the person last proved who they are (signing in, or typing their password again). */
  confirmedAt?: string;
}
interface Store {
  people: StoredPerson[];
  sessions: StoredSession[];
  settings: { requireSecondStep: boolean; idleMinutes: number; networks?: string[]; askAgain?: boolean; twoAdmins?: boolean };
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
  /** False when the company directory switched the account off. */
  active: boolean;
  createdAt: string;
  lastSignIn: string | null;
}

export const MIN_PASSWORD = 12;
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
export const IDLE_CHOICES = [60, 480, 1440, 10080];
/** How long after proving who they are a person may make sensitive changes without being asked again. */
export const CONFIRM_MINUTES = 10;

/** A network range from what was typed: "203.0.113.0/24", or one address. IPv4 only; anything else is dropped. */
export function cleanRange(text: unknown): string {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(String(text ?? "").trim());
  if (!m || m.slice(1, 5).some((n) => Number(n) > 255) || (m[5] !== undefined && Number(m[5]) > 32)) return "";
  return `${m.slice(1, 5).map(Number).join(".")}/${m[5] ?? "32"}`;
}
const toNumber = (ip: string) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
/** Whether an address is inside one of the ranges. This computer itself always is, so the owner cannot lock themselves out. */
export function inRanges(address: string | undefined, ranges: string[]): boolean {
  const ip = String(address ?? "").replace(/^::ffff:/, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  return ranges.some((r) => {
    const [base, bits] = r.split("/");
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((toNumber(ip) & mask) >>> 0) === ((toNumber(base) & mask) >>> 0);
  });
}
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

const view = (p: StoredPerson): Person => ({ id: p.id, name: p.name, email: p.email, role: p.role, groups: p.groups, secondStep: Boolean(p.totp?.on), locked: Boolean(p.lockedUntil && p.lockedUntil > new Date().toISOString()), active: !p.off, createdAt: p.createdAt, lastSignIn: p.lastSignIn ?? null });
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
  if (area === "audit" || area === "sent") return reading && role !== "member";
  if (role === "auditor") return reading;
  if (reading) return true;
  if (ADMIN_AREAS.has(area)) return false;
  if (MANAGER_AREAS.has(area)) return role === "manager";
  return true;
}

export const people = {
  /** Set by the app when single sign-on is the only way in (see sso.ts). */
  passwordsOff: null as null | (() => boolean),

  /** True once at least one person has an account: from then on everyone signs in. */
  enabled(): boolean {
    return load().people.length > 0;
  },

  list(): Person[] {
    return load().people.map(view);
  },

  settings() {
    const s = load().settings;
    return { ...s, networks: s.networks ?? [], twoAdmins: Boolean(s.twoAdmins), admins: this.admins(), askAgain: s.askAgain !== false, idleChoices: IDLE_CHOICES, minPassword: MIN_PASSWORD, confirmMinutes: CONFIRM_MINUTES };
  },

  /** How many people can approve a security change: the owner and administrators whose accounts are on. */
  admins(): number {
    return load().people.filter((p) => (p.role === "owner" || p.role === "admin") && !p.off).length;
  },
  /** Whether a security change by one administrator must wait for another. Only in force while there are two. */
  twoAdmins(): boolean {
    return Boolean(load().settings.twoAdmins) && this.admins() >= 2;
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

  setSettings(patch: { requireSecondStep?: unknown; idleMinutes?: unknown; networks?: unknown; askAgain?: unknown; twoAdmins?: unknown }) {
    const s = load();
    if (patch.networks !== undefined) s.settings.networks = [...new Set((Array.isArray(patch.networks) ? patch.networks : String(patch.networks).split(/[\s,]+/)).map(cleanRange).filter(Boolean))].slice(0, 100);
    if (typeof patch.askAgain === "boolean") s.settings.askAgain = patch.askAgain;
    if (typeof patch.twoAdmins === "boolean") {
      if (patch.twoAdmins && this.admins() < 2) throw new Error("This needs at least two people who are owner or administrator. Add or promote someone first.");
      s.settings.twoAdmins = patch.twoAdmins;
    }
    if (typeof patch.requireSecondStep === "boolean") s.settings.requireSecondStep = patch.requireSecondStep;
    if (IDLE_CHOICES.includes(Number(patch.idleMinutes))) s.settings.idleMinutes = Number(patch.idleMinutes);
    save();
    return this.settings();
  },

  /**
   * Signs someone in. Returns a session token, or says a code from their authenticator app is needed. Wrong passwords
   * count towards a lock; the message never says whether the email exists.
   */
  signIn(input: { email?: unknown; password?: unknown; code?: unknown }, device = "", from?: string): { token: string; person: Person; setUpSecondStep: boolean } | { needsCode: true } {
    const s = load();
    if (from !== undefined && s.settings.networks?.length && !inRanges(from, s.settings.networks)) throw new Error("Signing in is only allowed from your organization's approved networks.");
    const wrong = () => new Error("That email and password do not match.");
    const p = s.people.find((x) => x.email === cleanEmail(input.email));
    // With "only single sign-on", passwords work for the owner alone: the emergency way in.
    if (this.passwordsOff?.() && p && p.role !== "owner") throw new Error("Sign in with your company account. Passwords are switched off for this organization.");
    // The same work is done for an unknown email, so timing does not give away who has an account.
    const typed = stretch(String(input.password ?? "").slice(0, 200), p?.salt ?? "0000000000000000");
    if (!p) throw wrong();
    if (p.off) throw new Error("This account has been switched off by your organization. Ask an administrator.");
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
    s.sessions.push({ hash: hashToken(token), person: p.id, createdAt: p.lastSignIn, seenAt: p.lastSignIn, device: device.slice(0, 200), confirmedAt: p.lastSignIn });
    save();
    return { token, person: view(p), setUpSecondStep: s.settings.requireSecondStep && !p.totp?.on };
  },

  /**
   * Starts a session for someone the company's identity provider vouched for. With `add`, a person signing in for the
   * first time gets an account with that role; otherwise they must have been added already. Their password, if they
   * never had one, is a random one nobody knows.
   */
  signInBySso(who: { email: string; name: string }, device = "", add: Role | null = null, from?: string): { token: string; person: Person; added: boolean } {
    const s = load();
    if (from !== undefined && s.settings.networks?.length && !inRanges(from, s.settings.networks)) throw new Error("Signing in is only allowed from your organization's approved networks.");
    let p = s.people.find((x) => x.email === cleanEmail(who.email));
    let added = false;
    if (!p) {
      if (!add || add === "owner") throw new Error("Your company account is fine, but you have not been added to Talqava yet. Ask an administrator to add you.");
      p = { id: newId(), name: cleanName(who.name) || who.email, email: cleanEmail(who.email), role: add, groups: [], salt: "", key: "", failed: 0, createdAt: new Date().toISOString() };
      setKey(p, crypto.randomBytes(32).toString("hex"));
      s.people.push(p);
      added = true;
    }
    if (p.off) throw new Error("This account has been switched off by your organization. Ask an administrator.");
    p.lastSignIn = new Date().toISOString();
    const token = crypto.randomBytes(32).toString("hex");
    s.sessions = s.sessions.filter((x) => !this.expired(x)).slice(-500);
    s.sessions.push({ hash: hashToken(token), person: p.id, createdAt: p.lastSignIn, seenAt: p.lastSignIn, device: device.slice(0, 200), confirmedAt: p.lastSignIn });
    save();
    return { token, person: view(p), added };
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
    if (!p || p.off) return null;
    if (Date.now() - new Date(session.seenAt).getTime() > 60_000) {
      session.seenAt = new Date().toISOString();
      save();
    }
    return view(p);
  },

  // ---- the company directory (see scim.ts): it adds people, changes their names, and switches them off and on ----
  /** A person as the directory knows them, by Talqava's id. */
  fromDirectory(id: string): (Person & { directoryId: string }) | null {
    const p = load().people.find((x) => x.id === id);
    return p ? { ...view(p), directoryId: p.directoryId ?? "" } : null;
  },
  /** Adds a person on the directory's word. They sign in with the company account; the password set here is random and unknown. */
  provision(input: { email: unknown; name: unknown; directoryId?: unknown; active?: boolean }, role: Role): Person {
    const s = load();
    const email = cleanEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The directory gave no email address for this person.");
    if (s.people.some((p) => p.email === email)) throw Object.assign(new Error("Someone already signs in with that email address."), { exists: true });
    const person: StoredPerson = { id: newId(), name: cleanName(input.name) || email, email, role: role === "owner" ? "member" : role, groups: [], salt: "", key: "", failed: 0, createdAt: new Date().toISOString(), directoryId: String(input.directoryId ?? "").slice(0, 200), ...(input.active === false ? { off: true } : {}) };
    setKey(person, crypto.randomBytes(32).toString("hex"));
    s.people.push(person);
    save();
    return view(person);
  },
  /** A change from the directory: a new name or email, or switched off or on. The owner is never changed this way. */
  directoryUpdate(id: string, patch: { name?: unknown; email?: unknown; active?: boolean; directoryId?: unknown }): Person {
    const s = load();
    const p = s.people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (p.role === "owner") throw Object.assign(new Error("The owner's account is not managed by the directory."), { forbidden: true });
    if (patch.name !== undefined) p.name = cleanName(patch.name) || p.name;
    if (patch.email !== undefined) {
      const email = cleanEmail(patch.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That is not an email address.");
      if (s.people.some((x) => x.id !== id && x.email === email)) throw Object.assign(new Error("Someone already signs in with that email address."), { exists: true });
      p.email = email;
    }
    if (patch.directoryId !== undefined) p.directoryId = String(patch.directoryId).slice(0, 200);
    if (patch.active !== undefined) {
      if (patch.active) delete p.off;
      else {
        p.off = true;
        // Switched off takes effect at once: every session of theirs ends.
        s.sessions = s.sessions.filter((x) => x.person !== id);
      }
    }
    save();
    return view(p);
  },
  /** Sets a person's role from the directory's groups. Never the owner's. A changed role ends their sessions. */
  directoryRole(id: string, role: Role): boolean {
    const s = load();
    const p = s.people.find((x) => x.id === id);
    if (!p || p.role === "owner" || role === "owner" || p.role === role) return false;
    p.role = role;
    s.sessions = s.sessions.filter((x) => x.person !== id);
    save();
    return true;
  },
  /** Removes a person on the directory's word, and ends their sessions. Never the owner. */
  directoryRemove(id: string): void {
    const s = load();
    const p = s.people.find((x) => x.id === id);
    if (!p) throw new Error("There is no such person.");
    if (p.role === "owner") throw Object.assign(new Error("The owner's account is not managed by the directory."), { forbidden: true });
    s.people = s.people.filter((x) => x.id !== id);
    s.sessions = s.sessions.filter((x) => x.person !== id);
    save();
  },

  /** Whether a request from this address is allowed, when approved networks are set. */
  networkAllowed(from: string | undefined): boolean {
    const ranges = load().settings.networks ?? [];
    return !ranges.length || inRanges(from, ranges);
  },

  /** Whether this session proved who it is recently enough for a sensitive change. */
  confirmedRecently(token: string | undefined): boolean {
    if (load().settings.askAgain === false) return true;
    const session = token ? load().sessions.find((x) => x.hash === hashToken(token)) : undefined;
    return Boolean(session?.confirmedAt && Date.now() - new Date(session.confirmedAt).getTime() < CONFIRM_MINUTES * 60_000);
  },

  /** The person types their password (and code, if they have a second step) again before a sensitive change. */
  confirm(token: string | undefined, password: unknown, code: unknown): { ok: true } {
    const s = load();
    const session = token ? s.sessions.find((x) => x.hash === hashToken(token)) : undefined;
    const p = session && s.people.find((x) => x.id === session.person);
    if (!session || !p) throw new Error("Sign in first.");
    if (!crypto.timingSafeEqual(Buffer.from(stretch(String(password ?? "").slice(0, 200), p.salt)), Buffer.from(p.key))) throw new Error("That is not your password.");
    if (p.totp?.on && !codeFits(p.totp.secret, code)) throw new Error("That code is not right. Type the six digits your authenticator app shows now.");
    session.confirmedAt = new Date().toISOString();
    save();
    return { ok: true };
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
