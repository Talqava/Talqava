// Putting a restored backup in place.
//
// A restore is done in two steps so the app is never running on data that is being swapped under it. First the
// backup is opened and written into a waiting folder beside the data folder (backup.ts). Then, the next time
// Talqava starts, before anything has read the data, what is there now is moved aside into a folder of its own and
// the waiting files are moved in. Nothing is deleted: what was there before stays in its folder, and can be put
// back the same way.
//
// This file reads no settings and opens no store, so it can run first.
import fs from "node:fs";
import path from "node:path";
import { setting } from "../core/brand.ts";
import { ROOT } from "./env.ts";

/** What a backup never holds (it can be made again, or it is the backups themselves) and the lock the app holds: these stay where they are. */
const STAYS = new Set(["backups", "worktrees", "repos", "node_modules", ".git", ".app-running", "running.json"]);
const MARK = "RESTORE.json";
/** Left in the data folder after a restore: what was restored, when, and where what was there before is kept. */
export const RESTORED = "restored.json";

export const dataDir = () => path.resolve(setting("DATA_DIR") || path.join(ROOT, "data"));
export const pendingDir = (data = dataDir()) => path.join(path.dirname(data), `${path.basename(data)}-restore-waiting`);

export interface PendingRestore {
  /** The backup's file name, or a few words for data being put back. */
  from: string;
  at: string;
  files: number;
  /** True when this puts back what a restore moved aside. */
  undo?: boolean;
}

/** The restore that is waiting for the next start, if there is one. */
export function pendingRestore(data = dataDir()): PendingRestore | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(pendingDir(data), MARK), "utf8")) as PendingRestore;
  } catch {
    return null;
  }
}

/** Says what is waiting, once its files are in the waiting folder. */
export function markPending(info: PendingRestore, data = dataDir()): void {
  fs.writeFileSync(path.join(pendingDir(data), MARK), JSON.stringify(info, null, 2), { mode: 0o600 });
}

/**
 * Moves what is in the data folder aside and the waiting files in. Run once at start, before the data is read.
 * If a move fails part way, everything is moved back, so the app starts on what it had.
 */
export function applyPendingRestore(data = dataDir(), now = new Date()): { from: string; kept: string } | null {
  const info = pendingRestore(data);
  if (!info) return null;
  const waiting = pendingDir(data);
  const kept = path.join(path.dirname(data), `${path.basename(data)}-before-restore-${now.toISOString().replace(/[:T]/g, "-").slice(0, 19)}`);
  const aside: string[] = [];
  const placed: string[] = [];
  try {
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(kept, { recursive: true });
    for (const name of fs.readdirSync(data)) {
      if (STAYS.has(name) || name.endsWith(".tmp")) continue;
      fs.renameSync(path.join(data, name), path.join(kept, name));
      aside.push(name);
    }
    for (const name of fs.readdirSync(waiting)) {
      if (name === MARK || STAYS.has(name)) continue;
      fs.renameSync(path.join(waiting, name), path.join(data, name));
      placed.push(name);
    }
    fs.writeFileSync(path.join(data, RESTORED), JSON.stringify({ at: now.toISOString(), from: info.from, files: info.files, kept: path.basename(kept), undo: Boolean(info.undo) }, null, 2), { mode: 0o600 });
    fs.rmSync(waiting, { recursive: true, force: true });
    return { from: info.from, kept };
  } catch (err) {
    // Back to how it was: the restored files return to the waiting folder, and what was moved aside comes back.
    for (const name of placed) {
      try {
        fs.renameSync(path.join(data, name), path.join(waiting, name));
      } catch {}
    }
    for (const name of aside) {
      try {
        fs.renameSync(path.join(kept, name), path.join(data, name));
      } catch {}
    }
    try {
      fs.rmdirSync(kept);
    } catch {}
    // The mark is taken away so the same failure is not met at every start; the files stay for a look.
    try {
      fs.renameSync(path.join(waiting, MARK), path.join(waiting, "RESTORE-failed.json"));
    } catch {}
    console.error("The restore could not be put in place, so nothing was changed:", (err as Error).message);
    return null;
  }
}
