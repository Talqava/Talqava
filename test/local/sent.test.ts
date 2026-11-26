// "What was sent today": the record of what left this computer, and the day's view built from it.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let sent: typeof import("../../src/local/sent.ts");
let S: typeof import("../../src/local/sensitivity.ts");
let dir: string;

before(async () => {
  dir = process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-sent-"));
  sent = await import("../../src/local/sent.ts");
  S = await import("../../src/local/sensitivity.ts");
});

test("a day with nothing sent says so, and still offers today", () => {
  const d = sent.sentOn();
  assert.deepEqual([d.ai, d.items, d.services, d.web], [[], [], [], []]);
  assert.equal(d.days.length, 1);
  assert.equal(d.days[0], d.day);
});

test("calls to an AI model are added up per model, with who used it", () => {
  sent.noteModelCall("Claude Opus 5.5", "Bookkeeper", 1200);
  sent.noteModelCall("Claude Opus 5.5", "Head of Sales", 300);
  sent.noteModelCall("Claude Opus 5.5", "Bookkeeper", 500);
  const [row] = sent.sentOn().ai;
  assert.deepEqual(row, { model: "Claude Opus 5.5", local: false, calls: 3, tokens: 2000, agents: ["Bookkeeper", "Head of Sales"] });
});

test("a page handed to an agent is listed once a day, by title and level, and only during a run", () => {
  sent.noteItem("Payroll 2026", "restricted", "Bookkeeper");
  assert.equal(sent.sentOn().items.length, 0, "outside a run nothing is being sent to a model");
  S.withLevels(null, () => (sent.noteItem("Payroll 2026", "restricted", "Bookkeeper"), sent.noteItem("Payroll 2026", "restricted", "Bookkeeper")), "anthropic/claude-opus-5-5");
  const items = sent.sentOn().items;
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0], at: "" }, { title: "Payroll 2026", level: "restricted", who: "Bookkeeper", to: "anthropic/claude-opus-5-5", local: false, at: "" });
});

test("changes in connected services and websites called are listed; the content is not kept", () => {
  sent.noteSent({ kind: "service", to: "Mailchimp (Newsletter)", what: "Add a subscriber" });
  sent.noteSent({ kind: "web", to: "api.example.com", who: "Bookkeeper" });
  sent.noteSent({ kind: "web", to: "api.example.com", who: "Bookkeeper" });
  sent.noteSent({ kind: "service", to: "Slack", what: "Posted with the key sk-ant-abcdefgh12345678" });
  const d = sent.sentOn();
  assert.deepEqual(d.web, [{ host: "api.example.com", calls: 2, agents: ["Bookkeeper"] }]);
  assert.equal(d.services.length, 2);
  assert.equal(d.services[1].to, "Mailchimp (Newsletter)");
  assert.ok(!fs.readFileSync(path.join(dir, "sent.log"), "utf8").includes("abcdefgh12345678"), "a key is never written to the record");
});

test("each day is separate, and lines older than 30 days are left out", () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000);
  fs.appendFileSync(path.join(dir, "sent.log"), `${JSON.stringify({ at: old, kind: "web", to: "old.example.com" })}\n${JSON.stringify({ at: yesterday.toISOString(), kind: "web", to: "yesterday.example.com" })}\nnot a line\n`);
  const today = sent.sentOn();
  assert.equal(today.days.length, 2);
  assert.ok(!today.web.some((w) => w.host !== "api.example.com"));
  assert.deepEqual(sent.sentOn(today.days[1]).web.map((w) => w.host), ["yesterday.example.com"]);
});

test("hostOf gives the site of an address and nothing for other text", () => {
  assert.equal(sent.hostOf("https://shop.example.com/orders?id=1"), "shop.example.com");
  assert.equal(sent.hostOf("not an address"), null);
});
