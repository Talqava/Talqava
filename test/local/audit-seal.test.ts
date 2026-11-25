// The audit record is sealed line to line: a change, a removal or an addition by hand shows.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-seal-"));
const log = path.join(dir, "audit.log");
let A: typeof import("../../src/local/audit.ts");
const lines = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const put = (ls: string[]) => fs.writeFileSync(log, `${ls.join("\n")}\n`);

before(async () => {
  process.env.TALQAVA_DATA_DIR = dir;
  A = await import("../../src/local/audit.ts");
});

test("an untouched record is intact; older unsealed lines are counted, not failed", () => {
  fs.writeFileSync(log, `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", actor: "owner", actorName: "You", kind: "other", action: "From before sealing" })}\n`);
  for (const action of ["One", "Two", "Three", "Four"]) A.audit({ actor: "owner", actorName: "You", kind: "other", action });
  assert.deepEqual(A.verifyAudit(), { intact: true, checked: 4, unsealed: 1 });
  assert.equal(A.readAudit().entries[0].action, "Four");
  assert.equal(fs.statSync(path.join(dir, "audit-seal.key")).mode & 0o077, 0);
});

test("changing, removing, reordering or adding a line breaks the seal, and so does cutting the end off", () => {
  const good = lines();
  const broken = (ls: string[], why: RegExp) => {
    put(ls);
    const v = A.verifyAudit();
    assert.equal(v.intact, false);
    assert.match(v.problem!.why, why);
    put(good);
    assert.equal(A.verifyAudit().intact, true);
  };
  broken(good.map((l, i) => (i === 2 ? l.replace('"Two"', '"Too"') : l)), /changed, removed or moved/);
  broken([good[0], good[1], good[3], good[4]], /changed, removed or moved/);
  broken([good[0], good[1], good[3], good[2], good[4]], /changed, removed or moved/);
  broken([...good.slice(0, 3), JSON.stringify({ at: "2026-02-02T00:00:00.000Z", actor: "owner", actorName: "You", kind: "other", action: "Slipped in" }), ...good.slice(3)], /without a seal was added/);
  broken(good.slice(0, 4), /missing from the end/);
  broken(good.slice(0, 1), /record is missing|missing from the end/);
  // A copied seal on a made-up line does not pass either.
  broken([...good.slice(0, 4), good[4].replace('"Four"', '"Forged"')], /changed, removed or moved/);

  // Editing the note of the newest seal is caught too.
  const head = path.join(dir, "audit-seal.json");
  const note = fs.readFileSync(head, "utf8");
  fs.writeFileSync(head, note.replace(/"count":\d+/, '"count":1'));
  assert.equal(A.verifyAudit().intact, false);
  fs.writeFileSync(head, note);
  assert.equal(A.verifyAudit().intact, true);

  // And the record carries on, still intact, after all that checking.
  A.audit({ actor: "owner", actorName: "You", kind: "other", action: "Five" });
  assert.deepEqual(A.verifyAudit(), { intact: true, checked: 5, unsealed: 1 });
});
