// Projects: one folder for a body of work. Chat folders become projects, and a project gets its chat folder on demand.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let org: any;
let projects: typeof import("../../src/local/projects.ts").projects;
let goals: typeof import("../../src/local/goals.ts").goals;
let store: typeof import("../../src/local/store.ts");

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-projects-"));
  const { orgs } = await import("../../src/local/orgs.ts");
  ({ projects } = await import("../../src/local/projects.ts"));
  ({ goals } = await import("../../src/local/goals.ts"));
  store = await import("../../src/local/store.ts");
  store.initStore();
  org = orgs.active();
});

test("a chat folder becomes a project once, keeping its chats and memory", () => {
  const folder = store.spaces.create("Acme onboarding");
  store.memory.add("Acme pays on the 15th.", folder.id);
  const chat = { id: store.newId(), title: "Kick-off notes", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: "chat" as const, space: folder.id, messages: [] };
  store.conversations.save(chat as never);

  const list = projects.list(org);
  const p = list.find((x) => x.space === folder.id)!;
  assert.equal(p.title, "Acme onboarding");
  assert.equal(p.status, "active");
  assert.equal(p.chats, 1);
  assert.equal(projects.list(org).filter((x) => x.space === folder.id).length, 1, "listing again makes no second project");

  const page = projects.page(org, p.id);
  assert.deepEqual(page.chats.map((c) => c.title), ["Kick-off notes"]);
  assert.equal(store.memory.list().filter((m) => m.space === folder.id).length, 1);

  // Renaming either side renames the other.
  projects.update(org, p.id, { title: "Acme: onboarding" });
  assert.equal(store.spaces.get(folder.id)!.name, "Acme: onboarding");
  projects.folderRenamed(folder.id, "Acme");
  assert.equal(goals.project(org, p.id).title, "Acme");
});

test("a project has what done looks like, a due day and a status, and gets its chat folder when first needed", () => {
  const p = goals.createProject(org, { title: "Spring launch of the new product line for wholesale", doneWhen: "Ten shops stock it", due: "2027-03-01", status: "planning" });
  assert.deepEqual([p.status, p.doneWhen, p.due, p.space], ["planning", "Ten shops stock it", "2027-03-01", null]);
  assert.throws(() => goals.updateProject(org, p.id, { due: "soon" }), /date is a day/);
  assert.throws(() => goals.updateProject(org, p.id, { status: "someday" }), /planning, active, paused or done/);

  const space = projects.space(org, p.id);
  assert.equal(projects.space(org, p.id), space, "asked again, it is the same folder");
  assert.ok(store.spaces.get(space)!.name.length <= 40);
  assert.equal(goals.project(org, p.id).space, space);
  assert.equal(projects.list(org).filter((x) => x.space === space).length, 1);

  // Removing the project removes its folder; removing a folder removes its project.
  projects.remove(org, p.id);
  assert.equal(store.spaces.get(space), undefined);
  const other = store.spaces.create("Short lived");
  const made = projects.list(org).find((x) => x.space === other.id)!;
  store.spaces.remove(other.id);
  projects.folderRemoved(other.id);
  assert.equal(projects.list(org).some((x) => x.id === made.id), false);
});

test("health is worked out: past due is off track, a planning or done project has none", () => {
  const late = goals.createProject(org, { title: "Late one", due: "2020-01-01" });
  const calm = goals.createProject(org, { title: "Calm one", due: "2999-01-01" });
  const idea = goals.createProject(org, { title: "Idea", status: "planning", due: "2020-01-01" });
  const by = new Map(projects.list(org).map((p) => [p.id, p]));
  assert.deepEqual([by.get(late.id)!.health, by.get(late.id)!.healthWhy], ["off-track", "Past its due day"]);
  assert.equal(by.get(calm.id)!.health, "on-track");
  assert.equal(by.get(idea.id)!.health, null);
  assert.throws(() => projects.page(org, "nope"), /no such project/);
});
