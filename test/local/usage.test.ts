// Usage: each model answer is counted by day, by model and by who asked; the page reads the totals.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-usage-"));
const U = await import("../../src/local/usage.ts");

test("answers are added up by day, by model and by who asked, and nothing said is kept", () => {
  const now = new Date(2026, 10, 27, 9);
  assert.deepEqual([U.usageReport(30, now).since, U.usageReport(30, now).total.calls], [null, 0], "nothing counted yet");
  U.recordUsage({ model: "Claude Opus 5.5", ms: 900, cost: 0.12, input: 1000, cacheRead: 4000, output: 300 }, "Bookkeeper", new Date(2026, 10, 25, 8));
  U.recordUsage({ model: "Claude Opus 5.5", ms: 900, cost: 0.08, input: 500, output: 200 }, "Assistant", now);
  U.recordUsage({ model: "llama3.1 on this computer", ms: 2000, input: 700, output: 100 }, "Assistant", now);
  const r = U.usageReport(7, now);
  assert.deepEqual([r.days, r.since, r.byDay.length, r.byDay.at(-1)!.day, r.byDay.at(-3)!.day], [7, "2026-11-25", 7, "2026-11-27", "2026-11-25"]);
  assert.deepEqual(r.byDay.map((d) => [Number(d.cost.toFixed(2)), d.calls]).slice(-3), [[0.12, 1], [0, 0], [0.08, 2]]);
  assert.deepEqual([Number(r.total.cost.toFixed(2)), r.total.calls, r.total.input, r.total.cached, r.total.output], [0.2, 3, 2200, 4000, 600]);
  assert.deepEqual(r.models.map((m) => [m.name, m.calls, Number(m.cost.toFixed(2))]), [["Claude Opus 5.5", 2, 0.2], ["llama3.1 on this computer", 1, 0]], "largest cost first");
  assert.deepEqual(r.who.map((w) => [w.name, w.calls]), [["Bookkeeper", 1], ["Assistant", 2]]);
  assert.equal(r.unpriced, true, "a model with no known price is said to count as nothing");
  // A period that does not reach back far enough leaves the older day out; an odd period falls back to 30 days.
  assert.equal(U.usageReport(7, new Date(2026, 11, 5, 9)).total.calls, 0);
  assert.equal(U.usageReport("lots", now).days, 30);
  const kept = fs.readFileSync(path.join(process.env.TALQAVA_DATA_DIR!, "usage.json"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(kept)).sort(), ["days", "since"]);
});
