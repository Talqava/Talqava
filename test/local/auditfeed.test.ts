// The audit feed, alerts and access reviews.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-feed-"));
let F: typeof import("../../src/local/auditfeed.ts");
let A: typeof import("../../src/local/audit.ts");
const got: { body: string; signature: string }[] = [];
let fail = false;
let server: http.Server;
let url = "";

before(async () => {
  F = await import("../../src/local/auditfeed.ts");
  A = await import("../../src/local/audit.ts");
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (fail) return res.writeHead(503).end();
      got.push({ body, signature: String(req.headers["x-talqava-signature"] ?? "") });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/collect`;
  F.startAuditFeed();
});
after(() => server.close());
const settle = () => new Promise((r) => setTimeout(r, 150));

test("every audit entry is also sent to the monitoring system, signed, and a failed delivery is tried again", async () => {
  assert.throws(() => F.feedFrom({ url: "http://example.com/x" }), /https/);
  assert.throws(() => F.feedFrom({ url: "nonsense" }), /full address/);
  assert.equal(F.feedFrom({ url: "" }), null);
  await F.setFeed({ url, secret: "shared-secret" });
  await settle();
  A.audit({ actor: "owner", actorName: "You", kind: "other", action: "Did a thing", detail: "password=hunter2 token: abc" });
  await settle();
  const events = got.flatMap((g) => JSON.parse(g.body).events);
  assert.ok(events.some((e: any) => e.action === "Started sending the audit record to a monitoring system"));
  const mine = events.find((e: any) => e.action === "Did a thing");
  assert.ok(mine.seal, "the copy carries the entry's seal");
  for (const g of got) assert.equal(g.signature, crypto.createHmac("sha256", "shared-secret").update(g.body).digest("hex"));

  fail = true;
  A.audit({ actor: "owner", actorName: "You", kind: "other", action: "While the collector was down" });
  await settle();
  assert.match(F.feedStatus().lastError, /503/);
  assert.equal(F.feedStatus().waiting, 1);
  fail = false;
  A.audit({ actor: "owner", actorName: "You", kind: "other", action: "After it came back" });
  await settle();
  const later = got.flatMap((g) => JSON.parse(g.body).events).map((e: any) => e.action);
  assert.ok(later.includes("While the collector was down") && later.includes("After it came back"));
  assert.equal(F.feedStatus().waiting, 0);

  const before = got.length;
  await F.setFeed(null);
  A.audit({ actor: "owner", actorName: "You", kind: "other", action: "After stopping" });
  await settle();
  assert.equal(got.length, before, "nothing is sent once the feed is off");
});

test("alerts pick out what deserves a look", () => {
  for (let i = 0; i < 5; i++) A.audit({ actor: "system", actorName: "Talqava", kind: "security", ok: false, action: "A sign-in was refused", detail: "x@example.com: That email and password do not match." });
  A.audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", action: "The rules for agents were changed", detail: "…" });
  for (let i = 0; i < 3; i++) A.audit({ actor: "system", actorName: "Guardrails", kind: "guardrail", ok: false, action: "Refused: the Researcher tried to open a site that is not approved", detail: "evil.test" });
  const list = F.alerts();
  assert.ok(list.some((a) => /5 sign-ins were refused/.test(a.words)));
  assert.ok(list.some((a) => /The rules for agents were changed/.test(a.words)));
  assert.ok(list.some((a) => /the Researcher was refused 3 times/.test(a.words)));
});

test("an access review lists every agent, needs an answer on every line, and is due again after 90 days", async () => {
  const { orgs } = await import("../../src/local/orgs.ts");
  const org = orgs.active();
  assert.equal(F.reviews.due().overdue, true, "with none done, one is due");
  const r = F.reviews.start(org, "Ada (Owner)");
  assert.equal(F.reviews.start(org, "Ada (Owner)").id, r.id, "one open review at a time");
  assert.ok(r.items.length >= 1 && r.items.every((i) => i.has && i.decision === null));
  assert.throws(() => F.reviews.finish(r.id, "Ada"), /still need/);
  for (const i of r.items) F.reviews.decide(r.id, i.id, i === r.items[0] ? "change" : "keep", "checked");
  assert.throws(() => F.reviews.decide(r.id, "agent:nobody", "keep", ""), /no such line/);
  const done = F.reviews.finish(r.id, "Ada (Owner)");
  assert.ok(done.finishedAt);
  assert.throws(() => F.reviews.decide(r.id, r.items[0].id, "keep", ""), /finished/);
  const due = F.reviews.due();
  assert.equal(due.overdue, false);
  assert.equal(F.reviews.due(Date.now() + 91 * 86_400_000).overdue, true);
  assert.ok(A.readAudit({ kind: "security" }).entries.some((e) => /Finished an access review/.test(e.action)));
});
