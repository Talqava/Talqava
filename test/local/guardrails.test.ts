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
  assert.deepEqual(G.guardrailsFrom({ changes: "whatever", commands: "never", maxTaskSpend: -5, maxMinutes: "20" }), { ...G.NO_GUARDRAILS, commands: "never", maxMinutes: 20, maxTaskSpend: undefined });
  const before = { ...G.NO_GUARDRAILS, maxTaskSpend: 4, sites: ["a.com"] };
  assert.deepEqual(G.guardrailsFrom({ maxTaskSpend: "" }, before), { ...before, maxTaskSpend: undefined, maxMinutes: undefined });
  assert.equal(G.siteAllowed("https://sub.a.com/x", ["a.com"]), true);
  assert.equal(G.siteAllowed("https://a.com.evil.io/x", ["a.com"]), false);
  assert.equal(G.describeGuardrails({ ...G.NO_GUARDRAILS, web: "approved", sites: ["a.com"], commands: "never" }).length, 6);
});
