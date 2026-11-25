// The office task suite, run against the stand-in model: eight office tasks,
// each with an answer key. A right answer passes, a wrong one fails, and a task
// gets one try, so the key is never handed back to the agent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { startMockApi, say } from "../mock-api.ts";
import type { Reply } from "../mock-api.ts";
import { hasPoint, wrongPairs } from "../../src/local/checks.ts";
import { loadTemplatesFrom } from "../../src/local/templates.ts";

const RIGHT: [string, string][] = [
  ["Read the supplier agreement", "1. 24 months\n2. 45 days\n3. 90 days' written notice\n4. **4%** a year\n5. 500 units"],
  ["Write a reply to the customer", "Dear Hannah,\nThank you for your message about order A-2291. As the lamp was delivered 44 days ago, we can offer store credit for the full amount.\nCustomer Care"],
  ["Match the payments", "INV-1043: 820.00 owed\nINV-1045: 150.00 owed\nINV-1047: 1,275.00 owed\nTotal still owed: 2,245.00"],
  ["Turn the meeting notes", "- Priya: send Hartwell a revised quote, due 12 March\n- Daniel: book the launch venue, due 15 March\n- Sofia: fix the checkout bug, due 10 March\n- Marcus: draft the Q2 hiring plan, due 20 March"],
  ["Sort each customer message", "T-01: billing\nT-02: bug\nT-03: how-to\nT-04: account\nT-05: billing\nT-06: how-to\nT-07: bug\nT-08: account\nT-09: billing\nT-10: how-to\nT-11: bug\nT-12: account"],
  ["From the sales and costs", "1. Revenue: 4,818\n2. Costs: 2,434\n3. Profit: 2,384\n4. Starter kit, 2,025"],
  ["Our ideal customer", "Ashdown Haulage\nDunmore Supplies\nGlenview Trade Goods\nInchmarlo Distribution"],
  ["Check the expense claim", "EXP-02: the hotel cost 195, over the 160 limit\nEXP-04: alcohol is never paid for\nEXP-06: a taxi needs a receipt"],
];

let wrongInvoices = false;
async function reply(body: any): Promise<Reply> {
  const task = typeof body.messages[0].content === "string" ? body.messages[0].content : "";
  // The wrong answer lists a paid invoice and gets the total wrong.
  if (wrongInvoices && task.startsWith("Match the payments")) return say("INV-1043: 820.00\nINV-1044: 395.00\nINV-1047: 1,275.00\nTotal: 2,490.00");
  const found = RIGHT.find(([start]) => task.startsWith(start));
  return say(found ? found[1] : "ok");
}

let mock: Awaited<ReturnType<typeof startMockApi>>;
before(async () => {
  mock = await startMockApi(reply);
});
after(() => mock.server.close());

function runSuite(extra: string[] = []): Promise<{ code: number; output: string; result: any }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-officeout-"));
  const json = path.join(dir, "result.json");
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../../evals/run.ts"), "--model", "anthropic/claude-opus-5-5", "--suite", "office", "--minutes", "1", ...extra], {
    env: { ...process.env, NODE_TEST_CONTEXT: "", ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: "test-key", TALQAVA_EVAL_JSON: json, TALQAVA_EVAL_BASELINES: path.join(dir, "baselines") },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code: code ?? -1, output, result: fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, "utf8")) : null })));
}

test("every office task file is valid and has an answer key", () => {
  const templates = loadTemplatesFrom(path.join(import.meta.dirname, "../../evals/office"));
  assert.equal(templates.length, 8);
  for (const t of templates) {
    const keyed = (t.check.mentions?.length ?? 0) + Object.keys(t.check.pairs ?? {}).length;
    assert.ok(keyed > 0, `${t.id} has no answer key`);
    assert.equal(t.repository, "none", `${t.id} should not need a repository`);
  }
});

test("right answers pass all eight office tasks, each on its one try", { timeout: 180_000 }, async () => {
  const { code, output, result } = await runSuite();
  assert.equal(code, 0, output);
  assert.equal(result.suite, "office");
  assert.equal(result.out_of, 8);
  assert.equal(result.score, 8, output);
  assert.ok(result.results.every((r: any) => r.passed && r.tries === 0), output);
  assert.equal(typeof result.cost, "number");
  assert.match(output, /Office task suite/);
});

test("a wrong answer fails its task and is not sent back for a second try", { timeout: 180_000 }, async () => {
  wrongInvoices = true;
  const { output, result } = await runSuite(["--quests", "invoice-match,expense-check"]);
  wrongInvoices = false;
  const invoices = result.results.find((r: any) => r.quest === "invoice-match");
  assert.equal(invoices.passed, false, output);
  assert.equal(invoices.tries, 0);
  // The failure counts what is missing; it never names the answer.
  assert.doesNotMatch(invoices.detail, /INV-1045|2,245/);
  assert.equal(result.results.find((r: any) => r.quest === "expense-check").passed, true);
  assert.equal(result.score, 1);
});

test("repeat runs multiply the tasks", { timeout: 180_000 }, async () => {
  const { result } = await runSuite(["--quests", "lead-filter", "--runs", "3"]);
  assert.equal(result.out_of, 3);
  assert.equal(result.runs, 3);
});

test("an answer key accepts different spellings and does not match inside longer numbers", () => {
  assert.ok(hasPoint("The term is **24 months**.", "24 months|two years"));
  assert.ok(hasPoint("It runs for two years.", "24 months|two years"));
  assert.ok(hasPoint("Total owed: £2,245.00", "2,245|2245"));
  assert.ok(!hasPoint("Minimum order: 1,500 units", "500"));
  assert.ok(!hasPoint("Minimum order: 5000 units", "500"));
  assert.ok(hasPoint("Minimum order: 500 units.", "500"));
  assert.ok(!hasPoint("See INV-10431 instead", "INV-1043"));
  assert.ok(hasPoint("Unpaid: INV-1043.", "INV-1043"));
});

test("an answer key of pairs wants each item on a line with its answer", () => {
  const pairs = { "T-01": "billing", "T-02": "bug", "T-10": "how-to|how to" };
  assert.deepEqual(wrongPairs("T-01: billing\nT-02: bug\nT-10: How to", pairs), []);
  assert.deepEqual(wrongPairs("| T-01 | Billing |\n| T-02 | Bug |\n| T-10 | how-to |", pairs), []);
  assert.deepEqual(wrongPairs("T-01: bug\nT-02: bug\nT-10: how-to", pairs), ["T-01"]);
  assert.deepEqual(wrongPairs("T-01: billing\nT-10: how-to", pairs), ["T-02"]);
});
