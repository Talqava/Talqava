// The audit log: a record of every operation, kept on this computer. What the
// owner does in the app (each change they make), and what each agent does
// (each tool it uses, each approval it asks for, each failure, what a run cost).
// Lines are only ever added; a file over 10 MB is kept as audit-1.log and a new
// one is started. Secrets are never written: anything that looks like a key,
// token or password is replaced before the line is saved.
//
// Each line is sealed to the one before it: its seal is worked out from the line and the previous line's seal, with a
// key kept in the data folder. Changing a line, removing one from the middle or the end, or adding one by hand breaks
// the chain, and `verifyAudit` says where. (Someone with full use of this computer and its key could seal a forged
// record again; sending the record to another system as it is written is what closes that gap.)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./store.ts";

export interface AuditEntry {
  at: string;
  /** "owner" for the person, an agent's id, "system" for the app itself. */
  actor: string;
  /** The agent's job title, or "You". */
  actorName: string;
  /** A short kind for filtering: task, tool, approval, problem, spend, settings, library, integration, organization, inbox, chat, other. */
  kind: string;
  /** What happened, in plain words. */
  action: string;
  /** More detail: the command run, the file touched, the setting changed. Never a secret. */
  detail?: string;
  /** The task or chat it belongs to. */
  task?: string;
  /** Dollars, where the operation cost money. */
  cost?: number;
  /** Whether it worked. */
  ok?: boolean;
}

const MAX_BYTES = 10_000_000;
const file = () => path.join(DATA, "audit.log");
const SECRET_KEYS = /key|token|secret|password|passwd|credential|authorization|cookie|code_verifier|^code$|^value$/i;

/** A copy of something with secrets hidden and long text shortened, fit for the log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 400 ? `${value.slice(0, 400)}…` : value.replace(/\b(sk-[a-z]{2,4}-[\w-]{8,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,})\b/gi, "[hidden]");
  if (depth > 3) return "…";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) out[k] = SECRET_KEYS.test(k) && v !== "" && v != null && typeof v !== "boolean" ? "[hidden]" : redact(v, depth + 1);
    return out;
  }
  return String(value);
}

// ---------- the seal ----------
const keyFile = () => path.join(DATA, "audit-seal.key");
const headFile = () => path.join(DATA, "audit-seal.json");
let sealKey: { from: string; key: Buffer } | null = null;
function key(): Buffer {
  if (sealKey?.from === keyFile()) return sealKey.key;
  let k: Buffer;
  try {
    k = Buffer.from(fs.readFileSync(keyFile(), "utf8").trim(), "hex");
    if (k.length !== 32) throw new Error("bad key");
  } catch {
    k = crypto.randomBytes(32);
    fs.writeFileSync(keyFile(), k.toString("hex"), { mode: 0o600 });
  }
  sealKey = { from: keyFile(), key: k };
  return k;
}
const sealOf = (previous: string, body: string) => crypto.createHmac("sha256", key()).update(previous).update("\n").update(body).digest("hex");
/** The newest sealed line's seal and how many sealed lines there are, signed so the note itself cannot be edited quietly. */
function readHead(): { seal: string; count: number } {
  try {
    const h = JSON.parse(fs.readFileSync(headFile(), "utf8")) as { seal: string; count: number; mark: string };
    if (h.mark === sealOf("head", `${h.seal}:${h.count}`)) return { seal: h.seal, count: h.count };
  } catch {}
  return { seal: "", count: 0 };
}
const writeHead = (seal: string, count: number) => fs.writeFileSync(headFile(), JSON.stringify({ seal, count, mark: sealOf("head", `${seal}:${count}`) }), { mode: 0o600 });
let head: { from: string; seal: string; count: number } | null = null;

/** Adds one line to the log. Never throws: a full disk must not stop the work being recorded. */
export function audit(entry: Omit<AuditEntry, "at"> & { at?: string }) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const body = JSON.stringify({ at: new Date().toISOString(), ...entry, detail: entry.detail ? String(redact(entry.detail)) : undefined });
    if (head?.from !== headFile()) head = { from: headFile(), ...readHead() };
    const seal = sealOf(head.seal, body);
    const line = `${body.slice(0, -1)},"seal":"${seal}"}`;
    try {
      if (fs.statSync(file()).size > MAX_BYTES) fs.renameSync(file(), path.join(DATA, "audit-1.log"));
    } catch {}
    fs.appendFileSync(file(), `${line}\n`);
    head.seal = seal;
    head.count++;
    writeHead(seal, head.count);
  } catch (err) {
    console.error("The audit log could not be written:", (err as Error).message);
  }
}

/** Entries, newest first, filtered by who, kind, words and time. */
export function readAudit({ limit = 500, actor, kind, q, since }: { limit?: number; actor?: string; kind?: string; q?: string; since?: string } = {}): { entries: AuditEntry[]; total: number } {
  const lines: string[] = [];
  for (const name of ["audit-1.log", "audit.log"]) {
    try {
      lines.push(...fs.readFileSync(path.join(DATA, name), "utf8").split("\n").filter(Boolean));
    } catch {}
  }
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out: AuditEntry[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: AuditEntry;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (since && e.at < since) continue;
    if (actor && (actor === "agents" ? e.actor === "owner" || e.actor === "system" : e.actor !== actor)) continue;
    if (kind && (kind === "problem" ? e.ok !== false && e.kind !== "problem" : e.kind !== kind)) continue;
    if (words.length) {
      const text = `${e.actorName} ${e.action} ${e.detail ?? ""} ${e.kind}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
    }
    total++;
    if (out.length < Math.min(5000, limit)) out.push(e);
  }
  return { entries: out, total };
}

/**
 * Checks the record against its seals. `intact` is false when a sealed line was changed, removed, added by hand or put
 * in another order, or when lines are missing from the end. Lines written before sealing began are counted as `unsealed`.
 */
export function verifyAudit(): { intact: boolean; checked: number; unsealed: number; problem?: { at: string; why: string } } {
  const lines: string[] = [];
  for (const name of ["audit-1.log", "audit.log"]) {
    try {
      lines.push(...fs.readFileSync(path.join(DATA, name), "utf8").split("\n").filter(Boolean));
    } catch {}
  }
  let previous: string | null = null;
  let checked = 0;
  let unsealed = 0;
  for (const line of lines) {
    const m = /^(.*),"seal":"([a-f0-9]{64})"\}$/.exec(line);
    if (!m) {
      // An unsealed line after sealed ones was put there by hand.
      if (previous !== null) return { intact: false, checked, unsealed, problem: { at: whenOf(line), why: "A line without a seal was added to the record." } };
      unsealed++;
      continue;
    }
    const body = `${m[1]}}`;
    // The oldest line still kept may follow lines that were retired with an old file, so its link back is taken as given.
    if (previous !== null && m[2] !== sealOf(previous, body)) return { intact: false, checked, unsealed, problem: { at: whenOf(line), why: "This entry, or the one before it, was changed, removed or moved." } };
    if (previous === null && checked === 0 && unsealed === 0 && lines.length && readHead().count === lines.length && m[2] !== sealOf("", body)) return { intact: false, checked, unsealed, problem: { at: whenOf(line), why: "The first entry was changed." } };
    previous = m[2];
    checked++;
  }
  const h = readHead();
  if (h.count && previous !== h.seal) return { intact: false, checked, unsealed, problem: { at: lines.length ? whenOf(lines[lines.length - 1]) : "", why: h.seal && previous === null ? "The record is missing." : "Entries are missing from the end of the record, or the last one was changed." } };
  if (!h.count && checked) return { intact: false, checked, unsealed, problem: { at: "", why: "The note of the newest seal is missing or was changed." } };
  return { intact: true, checked, unsealed };
}
const whenOf = (line: string) => /"at":"([^"]+)"/.exec(line)?.[1] ?? "";
