// Sensitivity levels: which AI services may receive each level, and who may be handed a Restricted item.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let S: typeof import("../../src/local/sensitivity.ts");
let workspace: typeof import("../../src/local/workspace.ts").workspace;
let store: typeof import("../../src/local/store.ts");
let org: any;

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-sens-"));
  store = await import("../../src/local/store.ts");
  S = await import("../../src/local/sensitivity.ts");
  ({ workspace } = await import("../../src/local/workspace.ts"));
  const { orgs } = await import("../../src/local/orgs.ts");
  org = { ...orgs.active(), members: [{ bot: "bookkeeper", title: "Bookkeeper", department: "Finance", manager: null }, { bot: "sales-lead", title: "Head of Sales", department: "Sales", manager: null }], groups: [{ name: "Finance", lead: "bookkeeper" }, { name: "Sales", lead: "sales-lead" }] };
});

test("with nothing set, every level may go anywhere, as before", () => {
  assert.deepEqual([...S.levelsForRun("anthropic/claude-opus-5-5")].sort(), [...S.LEVELS].sort());
  assert.equal(S.mayReceive("restricted"), true, "outside a run nothing is held back");
});

test("each level goes only where the owner allows: any service, approved ones, this computer, or nowhere", () => {
  store.saveConfig({ sensitivity: { services: { public: "any", internal: "approved", confidential: "local", restricted: "none" }, approved: ["anthropic"] }, backups: [], moveUp: false });
  assert.deepEqual([...S.levelsForRun("anthropic/claude-opus-5-5")], ["public", "internal"]);
  assert.deepEqual([...S.levelsForRun("openrouter/some-model")], ["public"]);
  assert.deepEqual([...S.levelsForRun("local/llama3.1")], ["public", "internal", "confidential"]);
  // A run can fall over to its backups, so it only receives what every one of them may.
  store.saveConfig({ backups: ["openrouter/some-model"] });
  assert.deepEqual([...S.levelsForRun("local/llama3.1")], ["public"]);
  assert.deepEqual([...S.levelsForRun("anthropic/claude-opus-5-5")], ["public"]);
  store.saveConfig({ backups: [] });
  // What the owner types is checked.
  assert.deepEqual(S.policyFrom({ services: { internal: "everywhere", restricted: "local" }, approved: ["a", "a", 5] }), { services: { public: "any", internal: "any", confidential: "any", restricted: "local" }, approved: ["a", "5"] });
  assert.equal(S.describePolicy().length, 4);
});

test("in a run, the workspace hands over only the levels its AI service may receive, and says why it held one back", async () => {
  const plain = workspace.create(org, null, { title: "Opening hours", markdown: "Nine to five." });
  const customers = workspace.create(org, null, { title: "Customer list", markdown: "Acme owes 400.", level: "confidential" });
  const sheet = workspace.create(org, null, { kind: "sheet", title: "Payroll", markdown: "!sheet Pay\nA1\tSalary\n", level: "restricted" });
  assert.deepEqual([plain.level, customers.level, sheet.level], ["internal", "confidential", "restricted"]);
  // A page made inside a sensitive one starts just as sensitive.
  assert.equal(workspace.create(org, null, { title: "Acme notes", parent: customers.id }).level, "confidential");
  assert.equal(workspace.update(org, plain.id, { level: "nonsense" }).level, "internal");

  const cloud = [...S.levelsForRun("anthropic/claude-opus-5-5")]; // public and internal only
  const titles = (levels: any) => S.withLevels(levels, () => workspace.tree(org, "bookkeeper").map((p) => p.title).sort());
  assert.deepEqual(titles(cloud), ["Opening hours"]);
  assert.deepEqual(titles([...S.levelsForRun("local/llama3.1")]), ["Acme notes", "Customer list", "Opening hours"], "Restricted still needs the agent to be named");
  assert.throws(() => S.withLevels(cloud, () => workspace.get(org, customers.id, "bookkeeper")), /“Customer list” is marked Confidential.*on the AI service you are running on.*Say in your report/s);
  assert.equal(S.withLevels(cloud, () => workspace.search(org, "bookkeeper", "Acme owes")).length, 0);
  assert.ok(S.withLevels(null, () => workspace.search(org, "bookkeeper", "Acme owes")).length >= 1);
  // The owner, in the app, always sees everything.
  assert.equal(S.withLevels(cloud, () => workspace.get(org, customers.id)).title, "Customer list");

  // Restricted: only an agent named on it, and then only where that level may go (nowhere, here).
  assert.throws(() => workspace.get(org, sheet.id, "bookkeeper"), /marked Restricted.*unless you are named on it/s);
  workspace.update(org, sheet.id, { access: { departments: ["Finance"] } });
  assert.throws(() => workspace.get(org, sheet.id, "bookkeeper"), /unless you are named on it/, "being in its group is not enough");
  workspace.update(org, sheet.id, { access: { agents: ["bookkeeper"] } });
  assert.equal(workspace.get(org, sheet.id, "bookkeeper").title, "Payroll");
  assert.throws(() => workspace.get(org, sheet.id, "sales-lead"), /no such page/);
  assert.throws(() => S.withLevels([...S.levelsForRun("local/llama3.1")], () => workspace.get(org, sheet.id, "bookkeeper")), /marked Restricted/, "this owner sends Restricted to no model at all");

  // Each time something is kept back, it is written down.
  const { readAudit } = await import("../../src/local/audit.ts");
  const kept = readAudit({ kind: "guardrail" }).entries.filter((e) => /^Kept back/.test(e.action));
  assert.ok(kept.length >= 3);
  assert.match(kept.at(-1)!.action, /Kept back: “Customer list” is Confidential/);
});

test("while a run is prepared, the model chosen sets what it may receive", async () => {
  const { resolveModel } = await import("../../src/local/models.ts");
  store.saveConfig({ apiKey: "sk-ant-test-key-000000000000" });
  const { levels } = await S.preparing(async () => {
    resolveModel(store.getConfig(), "anthropic/claude-opus-5-5");
    return workspace.tree(org, "bookkeeper").map((p) => p.title);
  });
  assert.deepEqual(levels, ["public", "internal"]);
  assert.deepEqual((await S.preparing(async () => 1)).levels, null);
});
