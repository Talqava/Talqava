// Retention: old chats are deleted on the owner's schedule, a legal hold stops it, and a person can be found everywhere.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-retention-"));
let R: typeof import("../../src/local/retention.ts");
let store: typeof import("../../src/local/store.ts");

before(async () => {
  store = await import("../../src/local/store.ts");
  store.initStore?.();
  R = await import("../../src/local/retention.ts");
});

test("old chats are deleted after the kept time, never pinned or running ones, and never under a legal hold", () => {
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  const make = (title: string, extra: Record<string, unknown> = {}) => {
    const c = store.conversations.create({ title, ...extra });
    c.updatedAt = (extra.updatedAt as string) ?? c.updatedAt;
    store.conversations.save(c, { touch: false });
    return c.id;
  };
  const stale = make("Old chat", { updatedAt: old });
  const pinned = make("Old but pinned", { updatedAt: old, pinned: true });
  const running = make("Old but running", { updatedAt: old });
  const fresh = make("New chat");
  const ids = () => store.conversations.list().map((c) => c.id);

  assert.deepEqual(R.sweep(() => false), { chats: 0, tasks: 0 }, "with no limit set, nothing is deleted");
  store.saveConfig({ retention: R.retentionFrom({ days: 90, legalHold: true }) });
  assert.deepEqual(R.sweep(() => false), { chats: 0, tasks: 0 }, "a legal hold stops it");
  assert.ok(ids().includes(stale));
  store.saveConfig({ retention: R.retentionFrom({ legalHold: false }) });
  assert.deepEqual(R.retention(), { days: 90, legalHold: false });
  assert.deepEqual(R.sweep((id) => id === running), { chats: 1, tasks: 0 });
  assert.deepEqual([stale, pinned, running, fresh].map((id) => ids().includes(id)), [false, true, true, true]);
  assert.deepEqual(R.retentionFrom({ days: 17 }).days, 90, "only the offered lengths are accepted");
});

test("everything held about one person is found, wherever it is", async () => {
  const { orgs } = await import("../../src/local/orgs.ts");
  const { workspace } = await import("../../src/local/workspace.ts");
  const { orgMemory } = await import("../../src/local/orgmemory.ts");
  const org = orgs.active();
  workspace.create(org, null, { title: "Customers", markdown: "Jane Okafor (jane@example.com) owes 400." });
  workspace.create(org, null, { kind: "note", title: "Call notes", markdown: "Spoke to jane okafor today." });
  workspace.create(org, null, { title: "Unrelated", markdown: "Nothing here." });
  orgMemory.add({ org: org.id, shelf: "org", text: "Jane Okafor prefers email.", by: "owner" });
  const c = store.conversations.create({ title: "About Jane" });
  c.messages.push({ role: "user", content: "Draft a letter to Jane Okafor." } as never);
  store.conversations.save(c);
  const r = R.findPerson(org, "  Jane   Okafor ");
  assert.equal(r.query, "Jane Okafor");
  assert.deepEqual(r.places.map((p) => p.where).sort(), ["Chat", "Memory", "Note", "Workspace page"]);
  assert.match(r.places.find((p) => p.where === "Workspace page")!.snippet, /jane@example\.com/);
  assert.equal(R.findPerson(org, "jane@example.com").places.length, 1);
  assert.throws(() => R.findPerson(org, "ja"), /at least 3 letters/);
  assert.equal(R.findPerson(org, "Nobody Atall").places.length, 0);
});
