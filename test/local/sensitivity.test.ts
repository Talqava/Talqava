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
  assert.deepEqual(S.policyFrom({ services: { internal: "everywhere", restricted: "local" }, approved: ["a", "a", 5], memory: "top-secret" }), { services: { public: "any", internal: "any", confidential: "any", restricted: "local" }, approved: ["a", "5"], memory: "internal", leave: { public: true, internal: true, confidential: true, restricted: true } });
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

test("Library documents and Memory follow the same rules", async () => {
  const { library, syncLibrary } = await import("../../src/local/library.ts");
  const { orgMemory, orgMemoryPrompt } = await import("../../src/local/orgmemory.ts");
  const { orgs } = await import("../../src/local/orgs.ts");
  const live = orgs.active();
  await library.add(live, "payroll.txt", Buffer.from("Salaries: Ada 90000."));
  await library.add(live, "handbook.txt", Buffer.from("We open at nine."));
  await syncLibrary(live);
  const payroll = library.list(live).find((d) => d.name === "payroll.txt")!;
  assert.equal(payroll.level, "internal");
  assert.equal(library.setLevel(live, payroll.id, "confidential").level, "confidential");
  const cloud = [...S.levelsForRun("anthropic/claude-opus-5-5")]; // public and internal only, from the policy set above
  const names = (levels: any) => S.withLevels(levels, () => library.list(live, "@general").map((d) => d.name).sort());
  assert.deepEqual(names(cloud).includes("payroll.txt"), false);
  assert.deepEqual(names(cloud).includes("handbook.txt"), true);
  assert.equal(S.withLevels(cloud, () => library.search(live, "@general", "Salaries")).length, 0);
  assert.throws(() => S.withLevels(cloud, () => library.read(live, "@general", payroll.id)), /“payroll.txt” is marked Confidential.*Say in your report/s);
  assert.match(S.withLevels([...S.levelsForRun("local/llama3.1")], () => library.read(live, "@general", payroll.id)).text, /Ada 90000/);
  assert.match(library.read(live, null, payroll.id).text, /Ada 90000/, "the owner always reads it");
  // A changed file keeps its level.
  await library.add(live, "payroll.txt", Buffer.from("Salaries: Ada 95000."));
  await syncLibrary(live);
  assert.equal(library.list(live).find((d) => d.name === "payroll.txt")!.level, "confidential");

  // Memory as a whole has one level.
  orgMemory.add({ org: live.id, shelf: "org", text: "Our biggest customer is Acme.", by: "owner" });
  assert.match(S.withLevels(cloud, () => orgMemoryPrompt(live, null, "customer")), /Acme/);
  store.saveConfig({ sensitivity: { ...store.getConfig().sensitivity, memory: "confidential" } });
  assert.equal(S.withLevels(cloud, () => orgMemoryPrompt(live, null, "customer")), "");
  assert.equal(S.withLevels(cloud, () => orgMemory.search(live, null, "Acme")).length, 0);
  assert.match(orgMemoryPrompt(live, null, "customer"), /Acme/, "outside a run, nothing is held back");
});

test("text that looks more sensitive than its level is noticed, and keys and passwords are recognised", async () => {
  const S = await import("../../src/local/sensitivity.ts");
  assert.deepEqual(S.suggestLevel("Card 4242 4242 4242 4242 exp 12/28"), { level: "restricted", why: "it seems to hold a payment card number" });
  assert.equal(S.suggestLevel("Order number 1234 5678 9012 3456 shipped"), null, "sixteen digits that are not a card number are left alone");
  assert.equal(S.suggestLevel("Phone 555 0100, meeting at 10")?.level, undefined);
  assert.equal(S.suggestLevel("Payroll for March\nAda gross pay $4,200\nSam gross pay $3,900")?.level, "restricted");
  assert.equal(S.suggestLevel("The patient record shows a new prescription.")?.level, "restricted");
  assert.equal(S.suggestLevel("Pay to IBAN GB29 NWBK 6016 1331 9268 19 at our bank")?.level, "confidential");
  assert.equal(S.suggestLevel("Our salary policy is reviewed yearly."), null, "a word alone is not enough");
  assert.equal(S.higherLevel("Card 4242 4242 4242 4242", "restricted"), null, "nothing to suggest when the level is already as high");
  assert.equal(S.higherLevel("Card 4242 4242 4242 4242", "internal")?.level, "restricted");
  assert.deepEqual(S.findSecrets("Use sk-exampleexampleexampleexample and password: hunter2hunter2"), ["an AI service key", "a password or key"]);
  assert.deepEqual(S.findSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"), ["a private key"]);
  assert.deepEqual(S.findSecrets("The password policy asks for twelve characters."), []);
});

test("a task that has read a level that may not leave sends nothing out, for the rest of the task", () => {
  store.saveConfig({ sensitivity: { services: { public: "any", internal: "any", confidential: "any", restricted: "any" }, leave: { confidential: false, public: false } } });
  assert.equal(S.policy().leave.public, true, "Public information may always leave");
  assert.equal(S.policy().leave.confidential, false);
  assert.ok(S.describePolicy().some((w) => /has read Confidential information sends nothing out/.test(w)));
  const read = S.readOf("task-leave-1");
  const inTask = <T>(fn: () => T) => S.withLevels(null, fn, "anthropic/claude-opus-5-5", read);
  inTask(() => S.noteRead("internal"));
  assert.equal(inTask(() => S.heldBack()), null, "Internal may leave, so nothing is held");
  inTask(() => S.checkMayLeave("Mailchimp"));
  inTask(() => S.noteRead("confidential"));
  assert.equal(inTask(() => S.heldBack()), "confidential");
  assert.throws(() => inTask(() => S.checkMayLeave("Mailchimp")), /read something marked Confidential.*Nothing was sent/s);
  // Another task has read nothing; the owner, outside any task, is never held.
  assert.equal(S.withLevels(null, () => S.heldBack(), "anthropic/claude-opus-5-5", S.readOf("task-leave-2")), null);
  assert.equal(S.heldBack(), null);
  S.checkMayLeave("Mailchimp");
  // It is remembered across a restart: the file names the task and what it read.
  const kept = JSON.parse(fs.readFileSync(path.join(process.env.TALQAVA_DATA_DIR!, "read-levels.json"), "utf8"));
  assert.deepEqual(kept["task-leave-1"].sort(), ["confidential", "internal"]);
  assert.equal(kept["task-leave-2"], undefined);
  // Allowing the level again lets the same task send.
  store.saveConfig({ sensitivity: { ...S.policy(), leave: { confidential: true } } });
  inTask(() => S.checkMayLeave("Mailchimp"));
});

test("reading a page in a task is what marks the task", () => {
  store.saveConfig({ sensitivity: { services: { public: "any", internal: "any", confidential: "any", restricted: "any" }, approved: [], leave: { confidential: false } } });
  const page = workspace.create(org, null, { title: "Supplier contract", markdown: "Terms.", level: "confidential" });
  const read = S.readOf("task-leave-3");
  S.withLevels(null, () => workspace.get(org, page.id, "bookkeeper"), "anthropic/claude-opus-5-5", read);
  assert.deepEqual([...read], ["confidential"]);
  assert.throws(() => S.withLevels(null, () => S.leaving("a web address"), "anthropic/claude-opus-5-5", read), /Confidential/);
  workspace.get(org, page.id);
  assert.equal(S.heldBack(), null, "the owner reading a page marks nothing");
});
