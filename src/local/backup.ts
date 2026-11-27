// Backups, and whether what is stored is encrypted.
//
// A backup is one file holding the organization's data (settings, chats, tasks, pages, documents, memory, the
// library's files and the audit record), encrypted with a passphrase the owner chooses. It can be kept anywhere,
// such as a drive that syncs elsewhere, because without the passphrase it cannot be read. "Test a restore" opens
// the newest backup and checks every file in it, so the owner knows it works before they need it.
//
// What sits on this computer between backups is protected by the computer's own disk encryption (FileVault on a
// Mac, BitLocker on Windows), which this module reports on rather than replaces.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA, getConfig, saveConfig } from "./store.ts";
import { unzip } from "./library.ts";
import { zip } from "./officefiles.ts";
import { audit } from "./audit.ts";
import { RESTORED, markPending, pendingDir, pendingRestore } from "./restore-pending.ts";

const MAGIC = Buffer.from("TALQAVA-BACKUP-1\n");
/** Working copies of repositories and downloaded repositories are large and can be made again; they are left out. */
const SKIP = new Set(["worktrees", "repos", "backups", "running.json", "node_modules", ".git"]);
const MAX_FILE = 200_000_000;
const MAX_TOTAL = 1_500_000_000;
export const KEEP_BACKUPS = 7;

const folder = () => getConfig().backup?.folder || path.join(DATA, "backups");
const keyFrom = (passphrase: string, salt: Buffer) => crypto.scryptSync(passphrase, salt, 32);

function filesOf(dir: string, rel = ""): { rel: string; full: string; size: number }[] {
  const out: { rel: string; full: string; size: number }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.endsWith(".tmp")) continue;
    const full = path.join(dir, e.name);
    const at = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesOf(full, at));
    else if (e.isFile()) out.push({ rel: at, full, size: fs.statSync(full).size });
  }
  return out;
}

/** Sets the passphrase backups are encrypted with. Only a key made from it is kept, so nightly backups can run. */
export function setBackup(input: { passphrase?: unknown; folder?: unknown; nightly?: unknown }) {
  const before = getConfig().backup ?? {};
  const next = { ...before };
  if (input.passphrase !== undefined) {
    const p = String(input.passphrase);
    if (p.length < 12) throw new Error("Choose a passphrase of at least 12 characters. Write it down somewhere safe: without it a backup cannot be opened.");
    const salt = crypto.randomBytes(16);
    next.salt = salt.toString("hex");
    next.key = keyFrom(p, salt).toString("hex");
  }
  if (input.folder !== undefined) {
    const f = String(input.folder ?? "").trim();
    if (f) {
      if (!path.isAbsolute(f)) throw new Error("Give the folder's full path, such as /Users/you/Backups.");
      fs.mkdirSync(f, { recursive: true });
      fs.accessSync(f, fs.constants.W_OK);
    }
    next.folder = f || undefined;
  }
  if (typeof input.nightly === "boolean") next.nightly = input.nightly;
  saveConfig({ backup: next });
  return backupStatus();
}

/** Makes a backup now. Returns where it is, how many files it holds, and anything left out for being too large. */
export function makeBackup(now = new Date()): { file: string; files: number; bytes: number; skipped: string[] } {
  const cfg = getConfig().backup;
  if (!cfg?.key || !cfg.salt) throw new Error("Choose a passphrase for your backups first.");
  const skipped: string[] = [];
  const entries: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (const f of filesOf(DATA)) {
    if (f.size > MAX_FILE) {
      skipped.push(f.rel);
      continue;
    }
    total += f.size;
    if (total > MAX_TOTAL) throw new Error("Your data is larger than this backup can hold in one file. Back up the data folder with your computer's own backup instead.");
    try {
      entries.push({ name: f.rel, data: fs.readFileSync(f.full) });
    } catch {
      skipped.push(f.rel);
    }
  }
  entries.push({ name: "BACKUP.json", data: Buffer.from(JSON.stringify({ madeAt: now.toISOString(), files: entries.length, skipped })) });
  const plain = zip(entries);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(cfg.key, "hex"), iv);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  const dir = folder();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `talqava-${now.toISOString().replace(/[:T]/g, "-").slice(0, 16)}.tqbackup`);
  fs.writeFileSync(file, Buffer.concat([MAGIC, Buffer.from(cfg.salt, "hex"), iv, cipher.getAuthTag(), sealed]), { mode: 0o600 });
  // Older backups beyond the newest few are removed, unless a legal hold says nothing may be deleted.
  if (!getConfig().retention?.legalHold) for (const old of listBackups().slice(KEEP_BACKUPS)) fs.rmSync(old.file, { force: true });
  saveConfig({ backup: { ...getConfig().backup, lastAt: now.toISOString(), lastFiles: entries.length - 1 } });
  audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Made an encrypted backup", detail: `${entries.length - 1} files${skipped.length ? `, ${skipped.length} left out` : ""}` });
  return { file, files: entries.length - 1, bytes: sealed.length, skipped };
}

export function listBackups(): { file: string; name: string; bytes: number; at: string }[] {
  try {
    return fs
      .readdirSync(folder())
      .filter((n) => n.endsWith(".tqbackup"))
      .map((n) => ((full) => ({ file: full, name: n, bytes: fs.statSync(full).size, at: fs.statSync(full).mtime.toISOString() }))(path.join(folder(), n)))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/** Opens a backup with a passphrase and returns its files. Throws when the passphrase is wrong or the file was changed. */
export function openBackup(file: string, passphrase: string): Map<string, () => Buffer> {
  const raw = fs.readFileSync(file);
  if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("That is not a Talqava backup file.");
  let at = MAGIC.length;
  const salt = raw.subarray(at, (at += 16));
  const iv = raw.subarray(at, (at += 12));
  const tag = raw.subarray(at, (at += 16));
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(raw.subarray(at)), decipher.final()]);
  } catch {
    throw new Error("That passphrase does not open this backup, or the file was damaged.");
  }
  return unzip(plain);
}

/**
 * Opens the newest backup (or a named one) with the passphrase and checks every file can be read out of it.
 * Nothing on this computer is changed.
 */
export function testRestore(passphrase: unknown, name?: unknown, now = new Date()): { name: string; files: number; madeAt: string } {
  const all = listBackups();
  const pick = name ? all.find((b) => b.name === String(name)) : all[0];
  if (!pick) throw new Error("There is no backup yet. Make one first.");
  const files = openBackup(pick.file, String(passphrase ?? ""));
  const note = JSON.parse(files.get("BACKUP.json")?.().toString("utf8") ?? "{}") as { madeAt?: string; files?: number };
  let count = 0;
  for (const [n, read] of files) {
    if (n === "BACKUP.json") continue;
    read();
    count++;
  }
  if (!files.has("config.json") || count !== note.files) throw new Error("The backup opened, but it is not complete. Make a new one.");
  JSON.parse(files.get("config.json")!().toString("utf8"));
  saveConfig({ backup: { ...getConfig().backup, lastTestedAt: now.toISOString() } });
  audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Tested restoring a backup", detail: `${pick.name}: ${count} files read back` });
  return { name: pick.name, files: count, madeAt: note.madeAt ?? pick.at };
}

/**
 * Writes a backup's files into a new folder beside the data folder, for the owner to look at or to swap in by hand.
 * The live data is never overwritten.
 */
export function restoreTo(passphrase: unknown, name?: unknown, now = new Date()): { folder: string; files: number } {
  const all = listBackups();
  const pick = name ? all.find((b) => b.name === String(name)) : all[0];
  if (!pick) throw new Error("There is no backup yet.");
  const files = openBackup(pick.file, String(passphrase ?? ""));
  const out = path.join(path.dirname(DATA), `restored-${now.toISOString().replace(/[:T]/g, "-").slice(0, 16)}`);
  let count = 0;
  for (const [n, read] of files) {
    if (n === "BACKUP.json" || n.split("/").includes("..") || path.isAbsolute(n)) continue;
    const to = path.join(out, n);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, read(), { mode: 0o600 });
    count++;
  }
  audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Restored a backup into a new folder", detail: `${pick.name} → ${path.basename(out)}` });
  return { folder: out, files: count };
}

/**
 * Restore in place, step one: opens a backup with the passphrase and writes its files into a waiting folder beside
 * the data folder. Nothing in use is touched. The next time Talqava starts, what is there now is moved aside into a
 * folder of its own and the restored files are moved in (restore-pending.ts).
 */
export function stageRestore(passphrase: unknown, name?: unknown, now = new Date()): { name: string; files: number; madeAt: string } {
  const all = listBackups();
  const pick = name ? all.find((b) => b.name === String(name)) : all[0];
  if (!pick) throw new Error("There is no backup yet.");
  const files = openBackup(pick.file, String(passphrase ?? ""));
  const waiting = pendingDir(DATA);
  // Whatever an earlier, unfinished restore left waiting is replaced by this one.
  fs.rmSync(waiting, { recursive: true, force: true });
  let count = 0;
  for (const [n, read] of files) {
    if (n === "BACKUP.json" || n.split("/").includes("..") || path.isAbsolute(n)) continue;
    const to = path.join(waiting, n);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, read(), { mode: 0o600 });
    count++;
  }
  if (!count) throw new Error("That backup holds no files.");
  markPending({ from: pick.name, at: now.toISOString(), files: count }, DATA);
  audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Got a backup ready to restore", detail: `${pick.name}: ${count} files. It is put in place the next time Talqava starts.` });
  return { name: pick.name, files: count, madeAt: pick.at };
}

/** Calls off a restore that is waiting. Nothing in use was touched, so nothing else changes. */
export function cancelRestore(): { ok: true } {
  if (pendingRestore(DATA)) {
    fs.rmSync(pendingDir(DATA), { recursive: true, force: true });
    audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Called off a restore that was waiting" });
  }
  return { ok: true };
}

/** The last restore that was put in place, and whether what was there before is still kept. */
function lastRestore(): { at: string; from: string; kept: string; keptHere: boolean; undo: boolean } | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DATA, RESTORED), "utf8")) as { at: string; from: string; kept: string; undo?: boolean };
    return { at: r.at, from: r.from, kept: r.kept, keptHere: fs.existsSync(path.join(path.dirname(DATA), r.kept)), undo: Boolean(r.undo) };
  } catch {
    return null;
  }
}

/** Puts back what the last restore moved aside: it becomes the restore that waits for the next start. */
export function undoRestore(now = new Date()): { from: string } {
  const last = lastRestore();
  if (!last?.keptHere) throw new Error("What was there before the restore is no longer kept on this computer.");
  const waiting = pendingDir(DATA);
  fs.rmSync(waiting, { recursive: true, force: true });
  fs.renameSync(path.join(path.dirname(DATA), last.kept), waiting);
  const from = `what you had before the restore of ${new Date(last.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  markPending({ from, at: now.toISOString(), files: fs.readdirSync(waiting).length, undo: true }, DATA);
  audit({ actor: "system", actorName: "Talqava", kind: "security", action: "Got ready to put back what a restore replaced", detail: "It is put in place the next time Talqava starts." });
  return { from };
}

/** Whether the computer's own disk encryption is on, as far as can be told. */
export function diskEncryption(): { state: "on" | "off" | "unknown"; words: string } {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("/usr/bin/fdesetup", ["status"], { timeout: 5000 }).toString();
      return /FileVault is On/i.test(out) ? { state: "on", words: "FileVault is on: everything on this Mac's disk, Talqava's data included, is encrypted when the Mac is locked or off." } : { state: "off", words: "FileVault is off: someone with this Mac's disk could read Talqava's data. Turn it on in System Settings › Privacy & Security › FileVault." };
    }
  } catch {}
  return { state: "unknown", words: process.platform === "win32" ? "Talqava could not check. Make sure BitLocker (or Device Encryption) is on in Windows settings." : "Talqava could not check. Make sure this computer's disk encryption is on." };
}

export function backupStatus() {
  const b = getConfig().backup ?? {};
  const list = listBackups();
  return { ready: Boolean(b.key), folder: folder(), nightly: b.nightly !== false && Boolean(b.key), lastAt: b.lastAt ?? null, lastFiles: b.lastFiles ?? null, lastTestedAt: b.lastTestedAt ?? null, backups: list.slice(0, KEEP_BACKUPS).map(({ name, bytes, at }) => ({ name, bytes, at })), keep: KEEP_BACKUPS, disk: diskEncryption(), waiting: pendingRestore(DATA), restored: lastRestore() };
}

/** The nightly backup: once a day when a passphrase is set and nightly backups are on. Never throws. */
export function nightlyBackup(now = new Date()) {
  try {
    const b = getConfig().backup;
    if (!b?.key || b.nightly === false) return;
    if (b.lastAt && now.getTime() - new Date(b.lastAt).getTime() < 20 * 3600_000) return;
    makeBackup(now);
  } catch (err) {
    audit({ actor: "system", actorName: "Talqava", kind: "security", ok: false, action: "The nightly backup failed", detail: (err as Error).message.slice(0, 200) });
  }
}
