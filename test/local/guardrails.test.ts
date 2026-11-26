// Agent guardrails: organization-wide rules applied to every run, above each agent's own settings.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let G: typeof import("../../src/local/guardrails.ts");
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, definition: { name, description: name, input_schema: { type: "object", properties: {} } }, portable: { description: name, parameters: {} }, validate: () => null, needsApproval: () => false, run: async (input: any) => `ran ${name} ${input?.url ?? ""}`.trim(), ...extra }) as any;
const spec = (over: Record<string, unknown> = {}) =>
  ({
    model: {} as any,
    system: "You are an agent.",
    tools: [tool("bash"), tool("read_page"), tool("http_request"), tool("browser"), tool("memory"), tool("stripe__create_invoice", { needsApproval: () => true })],
    hostedTools: [{ type: "web_search_20260209", name: "web_search" }, { type: "web_fetch_20260209", name: "web_fetch" }] as any,
    mcpServers: [],
    approvalMode: "auto",
    budget: { steps: 40, spend: 5 },
    limits: { minutes: 30 },
    ...over,
  }) as any;

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-guard-"));
  G = await import("../../src/local/guardrails.ts");
});

test("with no guardrails set, a run is left exactly as it was", () => {
  const s = spec();
  const g = G.guard(s, "the Bookkeeper", G.NO_GUARDRAILS);
  assert.deepEqual(g.tools.map((t: any) => t.name), s.tools.map((t: any) => t.name));
  assert.deepEqual([g.approvalMode, g.budget, g.limits, g.system, g.alwaysAsk, g.hostedTools], ["auto", s.budget, s.limits, s.system, undefined, s.hostedTools]);
});

test("forbidden tools are taken away and the agent is told; nothing an agent is set to can bring them back", () => {
  const g = G.guard(spec(), "the Bookkeeper", { ...G.NO_GUARDRAILS, commands: "never", connectors: "never", web: "never" });
  assert.deepEqual(g.tools.map((t: any) => t.name), ["memory"]);
  assert.deepEqual(g.hostedTools, []);
  assert.match(g.system, /does not let agents use: running commands, connected services, the web/);
  // Approved sites only, with none approved, is the web switched off.
  assert.deepEqual(G.guard(spec(), "x", { ...G.NO_GUARDRAILS, web: "approved", sites: [] }).tools.map((t: any) => t.name), ["bash", "memory", "stripe__create_invoice"]);
});

test("only approved sites: other addresses are refused before anything is fetched, and it is written down", async () => {
  const { readAudit } = await import("../../src/local/audit.ts");
  const g = G.guard(spec(), "the Researcher", { ...G.NO_GUARDRAILS, web: "approved", sites: ["example.com", "gov.uk"] });
  const page = g.tools.find((t: any) => t.name === "read_page")!;
  assert.equal(await page.run({ url: "https://www.example.com/prices" }, {} as never), "ran read_page https://www.example.com/prices");
  assert.equal(await g.tools.find((t: any) => t.name === "http_request")!.run({ url: "https://api.example.com/v1" }, {} as never), "ran http_request https://api.example.com/v1");
  for (const bad of ["https://evil.test/", "https://example.com.evil.test/", "https://notexample.com/", "not a url", "http://127.0.0.1:8788/api/state"]) {
    assert.throws(() => page.run({ url: bad }, {} as never), /is not one of the sites this organization approves/, bad);
  }
  // The browser's later steps act on the page already opened.
  assert.equal(await g.tools.find((t: any) => t.name === "browser")!.run({ action: "read" }, {} as never), "ran browser");
  assert.deepEqual(g.hostedTools.map((t: any) => t.allowed_domains), [["example.com", "gov.uk"], ["example.com", "gov.uk"]]);
  assert.match(g.system, /You may only open these sites and their pages: example\.com, gov\.uk/);
  const refused = readAudit({ kind: "guardrail" }).entries;
  assert.equal(refused.length, 5);
  assert.match(refused[0].action, /the Researcher tried to open a site that is not approved/);
  assert.equal(refused.at(-1)!.detail, "evil.test");
});

test("always ask: changes and commands ask a person whatever the agent's own setting, and caps only ever tighten", () => {
  const strict = G.guard(spec(), "x", { ...G.NO_GUARDRAILS, changes: "ask", commands: "ask" });
  assert.equal(strict.approvalMode, "ask");
  assert.deepEqual(strict.alwaysAsk!.sort(), ["*", "bash"]);
  assert.equal(strict.tools.find((t: any) => t.name === "bash")!.needsApproval({}), true);
  assert.equal(G.guard(spec(), "x", { ...G.NO_GUARDRAILS, commands: "ask" }).approvalMode, "auto");

  const capped = G.guard(spec(), "x", { ...G.NO_GUARDRAILS, maxTaskSpend: 2, maxMinutes: 10 });
  assert.deepEqual([capped.budget, capped.limits], [{ steps: 40, spend: 2 }, { minutes: 10 }]);
  const looser = G.guard(spec(), "x", { ...G.NO_GUARDRAILS, maxTaskSpend: 50, maxMinutes: 600 });
  assert.deepEqual([looser.budget, looser.limits], [{ steps: 40, spend: 5 }, { minutes: 30 }], "a cap above the agent's own limit changes nothing");
  assert.equal(G.guard(spec({ budget: undefined }), "x", { ...G.NO_GUARDRAILS, maxTaskSpend: 3 }).budget!.spend, 3);
});

test("what the owner types is checked: sites are tidied, unknown choices are ignored, amounts must be positive", () => {
  assert.deepEqual(G.guardrailsFrom({ web: "approved", sites: "https://www.Example.com/page, gov.uk\n*.acme.io  not_a_site  example.com" }).sites, ["example.com", "gov.uk", "acme.io"]);
  assert.deepEqual(G.guardrailsFrom({ changes: "whatever", commands: "never", maxTaskSpend: -5, maxMinutes: "20" }), { ...G.NO_GUARDRAILS, commands: "never", maxMinutes: 20, maxTaskSpend: undefined , maxDaySpend: undefined, pauseAfter: undefined });
  const before = { ...G.NO_GUARDRAILS, maxTaskSpend: 4, sites: ["a.com"] };
  assert.deepEqual(G.guardrailsFrom({ maxTaskSpend: "" }, before), { ...before, maxTaskSpend: undefined, maxMinutes: undefined, maxDaySpend: undefined, pauseAfter: undefined });
  assert.equal(G.siteAllowed("https://sub.a.com/x", ["a.com"]), true);
  assert.equal(G.siteAllowed("https://a.com.evil.io/x", ["a.com"]), false);
  assert.equal(G.describeGuardrails({ ...G.NO_GUARDRAILS, web: "approved", sites: ["a.com"], commands: "never" }).length, 9);
});

test("with an approved list, only approved connected services keep their tools", () => {
  const withTwo = () => ({ ...spec(), tools: [...spec().tools, tool("gmail__search"), tool("gmail__send_draft")] });
  const names = (g: any) => g.tools.map((t: any) => t.name).filter((n: string) => n.includes("__"));
  assert.deepEqual(names(G.guard(withTwo(), "x", { ...G.NO_GUARDRAILS, connectors: "approved", services: ["gmail"] })), ["gmail__search", "gmail__send_draft"]);
  assert.deepEqual(names(G.guard(withTwo(), "x", { ...G.NO_GUARDRAILS, connectors: "approved", services: [] })), [], "nothing approved means connected services are off");
  assert.deepEqual(names(G.guard(withTwo(), "x", { ...G.NO_GUARDRAILS, connectors: "allowed", services: ["gmail"] })), ["stripe__create_invoice", "gmail__search", "gmail__send_draft"], "the list only counts when the rule says approved");
  const cleaned = G.guardrailsFrom({ connectors: "approved", services: ["Gmail", "gmail", "bad name!", "stripe"] });
  assert.deepEqual(cleaned.services, ["gmail", "stripe"]);
  assert.match(G.describeGuardrails(cleaned).join(" "), /only 2 approved connected services: gmail, stripe/);
});

test("a daily limit for the whole organization: the rest of today caps each run, and once reached nothing starts", async () => {
  const { recordSpend, spentToday } = await import("../../src/local/spend.ts");
  const rules = { ...G.NO_GUARDRAILS, maxDaySpend: 10 };
  assert.equal(G.guard(spec(), "the Bookkeeper", rules).budget.spend, 5, "the agent's lower budget stays");
  recordSpend("task-a", "bookkeeper", 7);
  recordSpend("task-a", "bookkeeper", 7.5);
  assert.equal(spentToday(), 7.5, "a task's cost is counted once as it grows");
  assert.equal(G.guard(spec(), "the Bookkeeper", rules).budget.spend, 2.5, "only what is left of today may be spent");
  recordSpend("task-b", "sales", 3);
  assert.throws(() => G.guard(spec(), "the Bookkeeper", rules), /spending limit for today \(\$10\) is reached/);
  assert.equal(G.guard(spec(), "the Bookkeeper", { ...rules, maxDaySpend: 50 }).budget.spend, 5, "raising the limit lets work start again");
  assert.equal(G.guard(spec(), "the Bookkeeper", G.NO_GUARDRAILS).budget.spend, 5);
  assert.ok(G.describeGuardrails(rules).some((w) => /at most \$10 a day/.test(w)));
});

test("never delete: tools that delete in a connected service are taken away, and the agent is told", () => {
  const s = spec({ tools: [tool("memory"), tool("googlecalendar__delete_event", { deletes: true }), tool("googlecalendar__list_events")] });
  assert.equal(G.guard(s, "the Assistant", G.NO_GUARDRAILS).tools.length, 3);
  const g = G.guard(s, "the Assistant", { ...G.NO_GUARDRAILS, deletes: "never" });
  assert.deepEqual(g.tools.map((t: any) => t.name), ["memory", "googlecalendar__list_events"]);
  assert.match(g.system, /deleting things in connected services/);
  assert.equal(G.guardrailsFrom({ deletes: "sometimes" }).deletes, "ask");
});

test("an agent whose work gets stuck often enough within an hour is to be paused; older trouble is forgotten", () => {
  const rules = { ...G.NO_GUARDRAILS, pauseAfter: 3 };
  const t0 = 1_800_000_000_000;
  assert.equal(G.noteStuck("bookkeeper", t0, G.NO_GUARDRAILS), false, "off unless the owner sets it");
  assert.equal(G.noteStuck("bookkeeper", t0, rules), false);
  assert.equal(G.noteStuck("sales", t0, rules), false, "each agent is counted alone");
  assert.equal(G.noteStuck("bookkeeper", t0 + 60_000, rules), false);
  assert.equal(G.noteStuck("bookkeeper", t0 + 120_000, rules), true);
  assert.equal(G.noteStuck("bookkeeper", t0 + 180_000, rules), false, "the count starts again after a pause");
  assert.equal(G.noteStuck("sales", t0 + 2 * 3_600_000, rules), false);
  assert.equal(G.noteStuck("sales", t0 + 2 * 3_600_000 + 1, rules), false, "trouble from over an hour ago no longer counts");
  assert.equal(G.guardrailsFrom({ pauseAfter: 1 }).pauseAfter, 2, "once is not a pattern");
  assert.equal(G.guardrailsFrom({ pauseAfter: "" }, rules).pauseAfter, undefined);
});
