// Tools for connected services are listed only once they are looked up, when there are many of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../src/core/index.ts";
import { DISCOVER_FROM, forgetFound, rank, withDiscovery } from "../../src/local/tool-discovery.ts";

const tool = (name: string, description: string, lazy = true): Tool => ({
  name,
  definition: { name, description, input_schema: { type: "object", properties: {} } } as Tool["definition"],
  portable: { description, parameters: { type: "object", properties: {} } },
  ...(lazy ? { lazy: true } : {}),
  validate: () => null,
  needsApproval: () => name.includes("create") || name.includes("send"),
  run: () => `ran ${name}`,
});
const core = [tool("bash", "Runs a command.", false), tool("memory", "Remembers things.", false)];
const SERVICES = ["asana", "hubspot", "xero", "gitlab", "zendesk", "mailchimp"];
const ACTIONS: [string, string][] = [["list", "Lists the newest items"], ["find", "Finds one by words"], ["get", "Reads one in full"], ["create", "Adds a new one"], ["update", "Changes one"]];
const many = SERVICES.flatMap((s) => ACTIONS.map(([a, d]) => tool(`${s}__${a}_${s === "xero" ? "invoice" : s === "asana" ? "task" : "item"}`, `${d} in ${s[0].toUpperCase()}${s.slice(1)}.`)));

test("a few service tools are simply listed; many are held back behind find_tools", () => {
  const few = [...core, ...many.slice(0, DISCOVER_FROM)];
  const plain = withDiscovery("c-few", few);
  assert.deepEqual([plain.tools, plain.note], [few, ""], "at the limit nothing changes");
  const run = withDiscovery("c1", [...core, ...many]);
  assert.deepEqual(run.tools.map((t) => t.name), ["bash", "memory", "find_tools"], "only the app's own tools and the finder are listed");
  assert.match(run.note, /30 are connected \(asana, gitlab, hubspot, mailchimp, xero, zendesk\) and 30 of them are not listed/);
  assert.match(run.note, /Do not guess a tool's name/);
});

test("looking tools up brings the fitting ones into reach, under their own names, for the rest of the conversation", async () => {
  const run = withDiscovery("c2", [...core, ...many]);
  const finder = run.tools.find((t) => t.name === "find_tools")!;
  assert.equal(finder.needsApproval({}), false);
  assert.match(String(finder.validate({})), /say what to look for/);
  const said = String(await finder.run({ query: "xero invoice" }, {} as never));
  assert.match(said, /^Now in reach.*\n- xero__create_invoice: Adds a new one in Xero\./s);
  const now = run.tools.map((t) => t.name);
  assert.deepEqual(now.filter((n) => n.startsWith("xero__")).sort(), ["xero__create_invoice", "xero__find_invoice", "xero__get_invoice", "xero__list_invoice", "xero__update_invoice"], "the same array the run holds now lists them");
  assert.equal(now.some((n) => n.startsWith("asana__")), false, "others stay out of the way");
  // A found tool is the very same tool: its own approval rule and its own work.
  const create = run.tools.find((t) => t.name === "xero__create_invoice")!;
  assert.equal(create, many.find((t) => t.name === "xero__create_invoice"));
  assert.equal(create.needsApproval({}), true);
  // Nothing fits: it says which services there are, and adds nothing.
  const before = run.tools.length;
  assert.match(String(await finder.run({ query: "spaceship" }, {} as never)), /Nothing fits “spaceship”\. The connected services are: asana, gitlab, hubspot, mailchimp, xero, zendesk/);
  assert.equal(run.tools.length, before);
  // The next turn of the same conversation starts with what was found; another conversation starts with nothing.
  const next = withDiscovery("c2", [...core, ...many]);
  assert.equal(next.tools.filter((t) => t.name.startsWith("xero__")).length, 5);
  assert.match(next.note, /25 of them are not listed/);
  assert.equal(withDiscovery("c3", [...core, ...many]).tools.length, 3);
  forgetFound("c2");
  assert.equal(withDiscovery("c2", [...core, ...many]).tools.length, 3);
});

test("ranking prefers a match in the name, and words that match nothing find nothing", () => {
  assert.deepEqual(rank("asana task", many).slice(0, 5).map((t) => t.name.split("__")[0]), ["asana", "asana", "asana", "asana", "asana"]);
  assert.equal(rank("create", many)[0].name.includes("create"), true);
  assert.deepEqual(rank("", many), []);
  assert.deepEqual(rank("?? !", many), []);
  assert.ok(rank("Zendesk", many).length === 5, "capital letters do not matter");
});
