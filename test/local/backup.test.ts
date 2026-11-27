// Encrypted backups: made with the owner's passphrase, opened only with it, and tested before they are needed.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-backup-"));
process.env.TALQAVA_DATA_DIR = path.join(dir, "data");
let B: typeof import("../../src/local/backup.ts");
let store: typeof import("../../src/local/store.ts");

before(async () => {
  store = await import("../../src/local/store.ts");
  store.initStore?.();
  store.getConfig();
  B = await import("../../src/local/backup.ts");
  const d = process.env.TALQAVA_DATA_DIR!;
  fs.mkdirSync(path.join(d, "organizations", "one"), { recursive: true });
  fs.writeFileSync(path.join(d, "organizations", "one", "notes.txt"), "Acme owes 400.");
  fs.mkdirSync(path.join(d, "worktrees", "big"), { recursive: true });
  fs.writeFileSync(path.join(d, "worktrees", "big", "copy.txt"), "a working copy that can be made again");
});

test("a backup needs a passphrase, holds the data but not what can be made again, and cannot be read without the passphrase", () => {
  assert.throws(() => B.makeBackup(), /passphrase for your backups first/);
  assert.throws(() => B.setBackup({ passphrase: "short" }), /at least 12 characters/);
  assert.throws(() => B.setBackup({ folder: "relative/path" }), /full path/);
  B.setBackup({ passphrase: "correct horse battery staple" });
  assert.doesNotMatch(fs.readFileSync(path.join(process.env.TALQAVA_DATA_DIR!, "config.json"), "utf8"), /correct horse/, "the passphrase itself is never stored");
  const made = B.makeBackup(new Date("2026-11-26T02:00:00Z"));
  assert.match(path.basename(made.file), /^talqava-2026-11-26-02-00\.tqbackup$/);
  assert.equal(fs.statSync(made.file).mode & 0o077, 0);
  const raw = fs.readFileSync(made.file);
  assert.equal(raw.includes("Acme owes 400"), false, "the file is encrypted");
  assert.throws(() => B.openBackup(made.file, "the wrong passphrase!"), /does not open this backup/);
  const files = B.openBackup(made.file, "correct horse battery staple");
  assert.equal(files.get("organizations/one/notes.txt")!().toString(), "Acme owes 400.");
  assert.ok(files.has("config.json"));
  assert.equal([...files.keys()].some((n) => n.startsWith("worktrees/") || n.startsWith("backups/")), false);

  // A changed file does not open at all.
  const damaged = Buffer.from(raw);
  damaged[damaged.length - 5] ^= 1;
  fs.writeFileSync(`${made.file}.bad`, damaged);
  assert.throws(() => B.openBackup(`${made.file}.bad`, "correct horse battery staple"), /damaged/);
  fs.rmSync(`${made.file}.bad`);
});

test("a restore can be tested without touching anything, and a real restore goes into a new folder", () => {
  assert.throws(() => B.testRestore("nope nope nope nope"), /does not open/);
  const t = B.testRestore("correct horse battery staple");
  assert.ok(t.files >= 2);
  assert.ok(B.backupStatus().lastTestedAt);
  const r = B.restoreTo("correct horse battery staple", undefined, new Date("2026-11-26T03:00:00Z"));
  assert.equal(path.basename(r.folder), "restored-2026-11-26-03-00");
  assert.equal(fs.readFileSync(path.join(r.folder, "organizations", "one", "notes.txt"), "utf8"), "Acme owes 400.");
  assert.equal(fs.readFileSync(path.join(process.env.TALQAVA_DATA_DIR!, "organizations", "one", "notes.txt"), "utf8"), "Acme owes 400.", "the live data is untouched");
});

test("only the newest few backups are kept, the nightly one runs once a day, and the status says where things stand", () => {
  for (let i = 1; i <= 9; i++) B.makeBackup(new Date(Date.UTC(2026, 11, i, 2)));
  assert.equal(B.listBackups().length, B.KEEP_BACKUPS);
  assert.match(B.listBackups()[0].name, /2026-12-09/);
  const before = B.listBackups().length;
  B.nightlyBackup(new Date(Date.UTC(2026, 11, 9, 5)));
  assert.equal(B.listBackups()[0].name.includes("2026-12-09-02"), true, "not again within the same day");
  B.nightlyBackup(new Date(Date.UTC(2026, 11, 10, 3)));
  assert.match(B.listBackups()[0].name, /2026-12-10/);
  assert.equal(B.listBackups().length, before);
  B.setBackup({ nightly: false });
  B.nightlyBackup(new Date(Date.UTC(2026, 11, 12, 3)));
  assert.match(B.listBackups()[0].name, /2026-12-10/);
  const s = B.backupStatus();
  assert.deepEqual([s.ready, s.nightly, s.keep], [true, false, B.KEEP_BACKUPS]);
  assert.ok(["on", "off", "unknown"].includes(s.disk.state) && s.disk.words);
});

test("a backup is restored in place at the next start, what was there is kept, and it can be put back", async () => {
  const R = await import("../../src/local/restore-pending.ts");
  const data = process.env.TALQAVA_DATA_DIR!;
  const notes = path.join(data, "organizations", "one", "notes.txt");
  // Since the backup, the notes changed and a file was added.
  fs.writeFileSync(notes, "Acme owes 900.");
  fs.writeFileSync(path.join(data, "organizations", "one", "new.txt"), "made after the backup");

  assert.throws(() => B.stageRestore("the wrong passphrase!"), /does not open/);
  assert.equal(B.backupStatus().waiting, null, "a wrong passphrase leaves nothing waiting");
  const staged = B.stageRestore("correct horse battery staple", undefined, new Date("2026-11-27T09:00:00Z"));
  assert.ok(staged.files >= 2);
  assert.deepEqual([B.backupStatus().waiting?.from, B.backupStatus().waiting?.files], [staged.name, staged.files]);
  assert.equal(fs.readFileSync(notes, "utf8"), "Acme owes 900.", "nothing in use changes until Talqava starts again");

  // Called off: nothing is waiting, nothing changed.
  B.cancelRestore();
  assert.equal(B.backupStatus().waiting, null);
  assert.equal(R.applyPendingRestore(data), null);
  assert.equal(fs.readFileSync(notes, "utf8"), "Acme owes 900.");

  // Made ready again, and Talqava starts.
  B.stageRestore("correct horse battery staple");
  const done = R.applyPendingRestore(data, new Date("2026-11-27T09:05:00Z"))!;
  assert.equal(path.basename(done.kept), "data-before-restore-2026-11-27-09-05-00");
  assert.equal(fs.readFileSync(notes, "utf8"), "Acme owes 400.", "the backup's files are in place");
  assert.equal(fs.existsSync(path.join(data, "organizations", "one", "new.txt")), false);
  assert.equal(fs.readFileSync(path.join(done.kept, "organizations", "one", "notes.txt"), "utf8"), "Acme owes 900.", "what was there before is kept, not deleted");
  assert.equal(fs.readFileSync(path.join(done.kept, "organizations", "one", "new.txt"), "utf8"), "made after the backup");
  assert.ok(fs.existsSync(path.join(data, "worktrees", "big", "copy.txt")), "what a backup never holds stays where it was");
  assert.ok(B.listBackups().length > 0, "and so do the backups themselves");
  assert.equal(fs.existsSync(R.pendingDir(data)), false);
  assert.equal(R.applyPendingRestore(data), null, "it is done once");
  const last = B.backupStatus().restored!;
  assert.deepEqual([last.from, last.keptHere, last.undo], [staged.name, true, false]);

  // Put back what was there before: the same way, at the next start.
  assert.match(B.undoRestore().from, /what you had before the restore of 27 Nov 2026/);
  assert.equal(B.backupStatus().waiting?.undo, true);
  R.applyPendingRestore(data, new Date("2026-11-27T09:10:00Z"));
  assert.equal(fs.readFileSync(notes, "utf8"), "Acme owes 900.");
  assert.equal(fs.readFileSync(path.join(data, "organizations", "one", "new.txt"), "utf8"), "made after the backup");
  assert.equal(B.backupStatus().restored!.undo, true);
});

test("a restore that cannot be put in place changes nothing", async () => {
  const R = await import("../../src/local/restore-pending.ts");
  const data = process.env.TALQAVA_DATA_DIR!;
  const notes = path.join(data, "organizations", "one", "notes.txt");
  const before = fs.readFileSync(notes, "utf8");
  B.stageRestore("correct horse battery staple");
  // Something in the way: a waiting entry that cannot be moved over what is there.
  const waiting = R.pendingDir(data);
  fs.mkdirSync(path.join(data, "backups", "x"), { recursive: true });
  fs.rmSync(path.join(waiting, "organizations"), { recursive: true });
  fs.symlinkSync(path.join(waiting, "nowhere", "at", "all"), path.join(waiting, "organizations"));
  fs.chmodSync(waiting, 0o500);
  try {
    assert.equal(R.applyPendingRestore(data), null);
  } finally {
    fs.chmodSync(waiting, 0o700);
  }
  assert.equal(fs.readFileSync(notes, "utf8"), before, "what was in use is back where it was");
  assert.equal(fs.existsSync(path.join(data, "organizations", "one", "new.txt")), true);
  // It can still be called off.
  B.cancelRestore();
  assert.equal(fs.existsSync(waiting), false);
});
