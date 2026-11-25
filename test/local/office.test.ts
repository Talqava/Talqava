// Office: documents and notes are pages of another kind, so they share the workspace's rules.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let org: any;
let workspace: typeof import("../../src/local/workspace.ts").workspace;

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-office-"));
  const { orgs } = await import("../../src/local/orgs.ts");
  ({ workspace } = await import("../../src/local/workspace.ts"));
  org = { ...orgs.active(), members: [{ bot: "sales-lead", title: "Head of Sales", department: "Sales", manager: null }, { bot: "bookkeeper", title: "Bookkeeper", department: "Finance", manager: null }], groups: [{ name: "Sales", lead: "sales-lead" }, { name: "Finance", lead: "bookkeeper" }] };
});

test("a note starts private; a document starts open; both stay out of the Workspace's own list", () => {
  const page = workspace.create(org, null, { title: "Price list" });
  const doc = workspace.create(org, null, { kind: "doc", title: "Proposal", folder: "  Customers  ", markdown: "Hello." });
  const note = workspace.create(org, null, { kind: "note", title: "Call notes", folder: "Meetings", tags: "#Follow-up, pricing, follow-up", markdown: "They want one invoice." });
  assert.deepEqual([page.kind, doc.kind, note.kind], ["page", "doc", "note"]);
  assert.equal(doc.folder, "Customers");
  assert.deepEqual(note.tags, ["follow-up", "pricing"]);
  assert.equal(note.access.private, true);
  assert.equal(doc.access.everyone, true);

  const office = workspace.office(org);
  assert.deepEqual(office.files.map((f) => f.title).sort(), ["Call notes", "Proposal"]);
  assert.deepEqual([office.folders, office.notebooks, office.tags], [["Customers"], ["Meetings"], ["follow-up", "pricing"]]);

  // Agents: the document is found and read like a page; the private note is not there at all.
  assert.deepEqual(workspace.office(org, "sales-lead").files.map((f) => f.title), ["Proposal"]);
  assert.throws(() => workspace.get(org, note.id, "sales-lead"), /no such page, or it is not one you may see/);
  assert.equal(workspace.search(org, "sales-lead", "invoice").length, 0);
  assert.equal(workspace.search(org, null, "invoice")[0].page, note.id);

  // Sharing the note with one group lets that group, and only it, read it.
  workspace.update(org, note.id, { access: { departments: ["Sales"] } });
  assert.equal(workspace.get(org, note.id, "sales-lead").title, "Call notes");
  assert.throws(() => workspace.get(org, note.id, "bookkeeper"), /no such page/);
});

test("an agent's change to a document waits for the owner, and an agent can save its work as a document", async () => {
  const doc = workspace.create(org, null, { kind: "doc", title: "Refund letter", markdown: "Dear customer." });
  const asked = workspace.propose(org, "sales-lead", doc.id, "Dear customer,\n\nYour refund is on its way.", "Added the refund line");
  assert.equal(asked.applied, false);
  assert.equal(workspace.get(org, doc.id).markdown, "Dear customer.");
  assert.equal(workspace.office(org).files.find((f) => f.id === doc.id)!.suggestions, 1);
  workspace.decide(org, asked.suggestion!, "accept");
  assert.match(workspace.get(org, doc.id).markdown, /refund is on its way/);

  // An agent's own document: seen by the owner, the agent and its group; not by another group.
  const made = workspace.create(org, "sales-lead", { kind: "doc", folder: "Customers", title: "Harbor proposal", markdown: "Draft." });
  assert.equal(made.kind, "doc");
  assert.equal(workspace.get(org, made.id, "sales-lead").title, "Harbor proposal");
  assert.throws(() => workspace.get(org, made.id, "bookkeeper"), /no such page/);
  assert.throws(() => workspace.create(org, "sales-lead", { kind: "note", title: "Mine" }), /Notes are the owner's/);
  assert.throws(() => workspace.create(org, "sales-lead", { title: "Loose page" }), /under a page you may see/);

  // Through the tool an agent uses.
  const { workspaceTool } = await import("../../src/local/workspace.ts");
  const { orgs } = await import("../../src/local/orgs.ts");
  const tool = workspaceTool(() => null);
  const run = async (input: any) => String(await tool.run(input, { conversation: { id: "task-1" }, signal: new AbortController().signal } as never));
  assert.match(await run({ action: "file", kind: "document", folder: "Reports", title: "Weekly report", markdown: "All good." }), /Saved as the document “Weekly report” .* in Office, in the folder Reports/);
  assert.match(await run({ action: "list" }), /Weekly report \(document in Reports\)/);
  await assert.rejects(run({ action: "file", title: "No place", markdown: "x" }), /kind: "document"/);
  assert.equal(workspace.office(orgs.active()).files.some((f) => f.title === "Weekly report" && f.kind === "doc"), true);
});

test("a note can become a document or a Workspace page, keeping its text, history and who may see it", () => {
  const note = workspace.create(org, null, { kind: "note", title: "Idea", markdown: "First." });
  workspace.save(org, note.id, "First.\n\nSecond.");
  const doc = workspace.update(org, note.id, { kind: "doc", folder: "Plans", tags: ["Big"] });
  assert.deepEqual([doc.kind, doc.folder, doc.tags, doc.access.private], ["doc", "Plans", ["big"], true]);
  assert.equal(doc.markdown, "First.\n\nSecond.");
  assert.equal(workspace.revisions(org, note.id).length >= 1, true);
  const page = workspace.update(org, note.id, { kind: "page" });
  assert.equal(page.kind, "page");
  assert.equal(workspace.office(org).files.some((f) => f.id === note.id), false);

  // A page with pages inside it cannot become a document.
  const parent = workspace.create(org, null, { title: "Handbook" });
  workspace.create(org, null, { title: "Chapter", parent: parent.id });
  assert.throws(() => workspace.update(org, parent.id, { kind: "doc" }), /has pages inside it/);
  // Anything unknown is a page.
  assert.equal(workspace.create(org, null, { kind: "spreadsheet", title: "X" }).kind, "page");
});

test("templates make real files; pinning and reminders work; every sheet template calculates without errors", async () => {
  const { listOfficeTemplates, useOfficeTemplate, OFFICE_TEMPLATES } = await import("../../src/local/office-templates.ts");
  const { parseFile, compute, isError, extent } = await import("../../public/sheet-engine.js");
  const list = listOfficeTemplates();
  assert.ok(list.length >= 6 && list.every((t) => t.name && t.summary && ["doc", "sheet", "note"].includes(t.kind)));
  assert.equal(new Set(list.map((t) => t.id)).size, list.length);
  for (const t of OFFICE_TEMPLATES) {
    assert.doesNotMatch(t.text, /lorem ipsum/i);
    if (t.kind !== "sheet") continue;
    const file = parseFile(t.text);
    const value = compute(file);
    const { rows, cols } = extent(file.sheets[0]);
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) assert.equal(isError(value(0, c, r)), false, `${t.name} ${c},${r}`);
  }
  const doc = useOfficeTemplate(org, "proposal");
  assert.deepEqual([doc.kind, doc.title, doc.folder], ["doc", "Proposal", "Customers"]);
  assert.match(doc.markdown, /\[YOUR PRICE\]/);
  assert.equal(useOfficeTemplate(org, "cash-forecast").kind, "sheet");
  assert.equal(useOfficeTemplate(org, "meeting-notes").access.private, true, "a note from a template is private like any note");
  assert.throws(() => useOfficeTemplate(org, "nope"), /no such template/);

  // Pinned files come first; a reminder shows once its time has come and goes when cleared.
  const a = workspace.create(org, null, { kind: "note", title: "Pin me" });
  workspace.create(org, null, { kind: "note", title: "Newer" });
  workspace.update(org, a.id, { pinned: true });
  assert.equal(workspace.office(org).files[0].title, "Pin me");
  assert.throws(() => workspace.update(org, a.id, { remindAt: "next tuesday-ish" }), /date and time/);
  workspace.update(org, a.id, { remindAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(workspace.reminders(org).some((r) => r.id === a.id), false, "not due yet");
  assert.equal(workspace.reminders(org, new Date(Date.now() + 7200_000)).some((r) => r.id === a.id), true);
  workspace.update(org, a.id, { remindAt: null });
  assert.equal(workspace.reminders(org, new Date(Date.now() + 7200_000)).some((r) => r.id === a.id), false);
});

test("slides: a deck is slides of a title, text and notes; agents save and suggest them like pages", async () => {
  const { parseDeck, writeDeck, workspaceTool } = await import("../../src/local/workspace.ts");
  const text = "# Spring review\n\nWhat we learned\n\nNotes: Open with the headline number.\n\n---\n\n## What worked\n\n- Email\n- Referrals\n\n---\n\nNo title here, just text\n";
  const slides = parseDeck(text);
  assert.deepEqual(slides.map((s) => s.title), ["Spring review", "What worked", ""]);
  assert.equal(slides[0].notes, "Open with the headline number.");
  assert.equal(slides[1].body, "- Email\n- Referrals");
  assert.deepEqual(parseDeck(writeDeck(slides)).map((s) => [s.title || "Untitled slide", s.body, s.notes]), slides.map((s) => [s.title || "Untitled slide", s.body, s.notes]));
  assert.deepEqual(parseDeck(""), [{ title: "", body: "", notes: "" }]);
  // A table's own dashes are not a slide break.
  assert.equal(parseDeck("# T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |").length, 1);

  const deck = workspace.create(org, null, { kind: "deck", title: "Review", markdown: writeDeck(slides) });
  assert.equal(deck.kind, "deck");
  assert.match(workspace.office(org).files.find((f) => f.id === deck.id)!.summary, /^3 slides: Spring review · What worked/);
  // An agent's change to the owner's slides waits, as for a document.
  const asked = workspace.propose(org, "sales-lead", deck.id, writeDeck([...slides, { title: "Plan for summer", body: "- Try partnerships", notes: "" }]), "Added a plan slide");
  assert.equal(asked.applied, false);
  assert.equal(parseDeck(workspace.get(org, deck.id).markdown).length, 3);
  workspace.decide(org, asked.suggestion!, "accept");
  assert.equal(parseDeck(workspace.get(org, deck.id).markdown).length, 4);

  const tool = workspaceTool(() => null);
  const out = String(await tool.run({ action: "file", kind: "slides", title: "Team update", markdown: "# One\n\n- a\n\n---\n\n# Two\n\n- b" } as never, { conversation: { id: "task-7" }, signal: new AbortController().signal } as never));
  assert.match(out, /Saved as the slides “Team update” .* 2 slides/);
});
