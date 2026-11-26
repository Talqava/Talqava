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
  // An agent's short finding goes to the notebook kept for agents' notes, whatever folder it names.
  assert.match(await run({ action: "file", kind: "note", folder: "Elsewhere", title: "Flour price rose", markdown: "Up 8% at the mill." }), /Saved as the note “Flour price rose” .* in the notebook From agents/);
  assert.equal(workspace.office(orgs.active()).files.some((f) => f.title === "Flour price rose" && f.kind === "note" && f.folder === "From agents"), true);
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

test("a file can belong to a project, and an agent working in that project is told about it", async () => {
  const { projectFilesPrompt } = await import("../../src/local/workspace.ts");
  const doc = workspace.create(org, null, { kind: "doc", title: "Launch plan", project: "proj-1" });
  const sheet = workspace.create(org, null, { kind: "sheet", title: "Launch budget", markdown: "!sheet One\n" });
  assert.equal(doc.project, "proj-1");
  assert.equal(workspace.update(org, sheet.id, { project: "proj-1" }).project, "proj-1");
  const told = projectFilesPrompt(org, "sales-lead", "proj-1", "Spring launch");
  assert.match(told, /# This task's project: Spring launch/);
  assert.match(told, /“Launch plan” \(document, workspace tool, page /);
  assert.match(told, /“Launch budget” \(sheet, sheet tool, file /);
  assert.equal(projectFilesPrompt(org, "sales-lead", "another-project"), "");
  assert.equal(projectFilesPrompt(org, "sales-lead", null), "");
  // A file the agent may not see is not mentioned.
  workspace.update(org, doc.id, { access: { private: true } });
  assert.doesNotMatch(projectFilesPrompt(org, "sales-lead", "proj-1"), /Launch plan/);
  assert.equal(workspace.update(org, sheet.id, { project: null }).project, null);
});

test("levels for each group and agent: no access, read, comment, suggest, edit; the most specific wins", async () => {
  const { tables } = await import("../../src/local/tables.ts");
  const doc = workspace.create(org, null, { kind: "doc", title: "Contract", markdown: "Terms." });
  // Without levels, the simple settings decide: whoever may see it may suggest.
  assert.equal(workspace.level(org, doc.id, "sales-lead"), "suggest");
  assert.equal(workspace.level(org, doc.id, null), "edit");

  workspace.update(org, doc.id, { levels: { everyone: "read", departments: { Sales: "edit", Nonsense: "fly" }, agents: { bookkeeper: "comment" } } });
  assert.deepEqual(workspace.get(org, doc.id).levels, { everyone: "read", departments: { Sales: "edit" }, agents: { bookkeeper: "comment" } });
  assert.equal(workspace.level(org, doc.id, "sales-lead"), "edit", "its group's level");
  assert.equal(workspace.level(org, doc.id, "bookkeeper"), "comment", "its own level beats its group's and everyone's");
  assert.equal(workspace.level(org, doc.id, "@general"), "read", "the level for every agent");

  // Edit: applied at once. Comment: may comment, may not change. Read: may do neither.
  assert.equal(workspace.propose(org, "sales-lead", doc.id, "Terms. And more.", "added").applied, true);
  assert.throws(() => workspace.propose(org, "bookkeeper", doc.id, "Sneaky.", "x"), /You may read and comment on “Contract”, but not change it/);
  const c = workspace.comment(org, "bookkeeper", doc.id, "Clause 2 has the wrong amount.", "task-3");
  assert.deepEqual([c.authorName, c.text, c.resolved], ["Bookkeeper", "Clause 2 has the wrong amount.", false]);
  assert.throws(() => workspace.comment(org, "@general", doc.id, "hello"), /read “Contract” but not comment/);
  assert.throws(() => workspace.propose(org, "@general", doc.id, "x", "x"), /You may read “Contract”, but not change it/);
  assert.equal(workspace.get(org, doc.id).comments, 1);
  workspace.comment(org, null, doc.id, "Thanks, fixed.");
  workspace.resolveComment(org, c.id);
  assert.deepEqual(workspace.comments(org, doc.id).map((x) => x.authorName), ["You"]);
  assert.equal(workspace.comments(org, doc.id, true).length, 2);

  // No access: not there at all. Protected caps everyone at suggest.
  workspace.update(org, doc.id, { levels: { departments: { Sales: "edit" }, agents: {} } });
  assert.equal(workspace.level(org, doc.id, "bookkeeper"), "none");
  assert.throws(() => workspace.get(org, doc.id, "bookkeeper"), /no such page/);
  assert.equal(workspace.tree(org, "bookkeeper").some((p) => p.id === doc.id), false);
  workspace.update(org, doc.id, { protected: true });
  assert.equal(workspace.level(org, doc.id, "sales-lead"), "suggest");
  assert.equal(workspace.propose(org, "sales-lead", doc.id, "Terms, changed.", "x").applied, false);
  workspace.update(org, doc.id, { protected: false });

  // Tables on the page follow the same level.
  const t = tables.create(org, doc.id, { name: "Fees", columns: [{ name: "Item", type: "text" }] });
  assert.equal(tables.setRow(org, "sales-lead", t.id, { values: { Item: "Setup" } }).applied, true);
  workspace.update(org, doc.id, { levels: { departments: { Sales: "read" }, agents: {} } });
  assert.throws(() => tables.setRow(org, "sales-lead", t.id, { values: { Item: "More" } }), /may read the table “Fees” but not change it/);
  assert.equal(tables.get(org, t.id, "sales-lead").rows.length, 1);

  // A Restricted file needs the agent named, with levels as without. Private beats every level.
  workspace.update(org, doc.id, { level: "restricted", levels: { departments: { Sales: "edit" }, agents: {} } });
  assert.throws(() => workspace.get(org, doc.id, "sales-lead"), /unless you are named on it/);
  workspace.update(org, doc.id, { levels: { departments: {}, agents: { "sales-lead": "read" } } });
  assert.equal(workspace.get(org, doc.id, "sales-lead").title, "Contract");
  workspace.update(org, doc.id, { level: "internal", access: { private: true } });
  assert.equal(workspace.level(org, doc.id, "sales-lead"), "none");
  // Clearing the levels goes back to the simple settings.
  workspace.update(org, doc.id, { access: { everyone: true }, levels: null });
  assert.equal(workspace.get(org, doc.id).levels, null);
  assert.equal(workspace.level(org, doc.id, "bookkeeper"), "suggest");
});

test("a photo or file is attached to a note, kept with it, and the note is found by the words in the picture", async () => {
  const note = workspace.create(org, null, { kind: "note", title: "Lunch receipt", markdown: "Team lunch." });
  assert.deepEqual(workspace.get(org, note.id).files, []);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const photo = workspace.attach(org, note.id, "../receipt photo.PNG", png);
  assert.deepEqual([photo.name, photo.type, photo.picture, photo.size, photo.words], [".. receipt photo.PNG", "png", true, png.length, 0]);
  const pdf = workspace.attach(org, note.id, "contract.pdf", Buffer.from("%PDF-1.4"));
  assert.equal(pdf.picture, false);
  assert.throws(() => workspace.attach(org, note.id, "empty.txt", Buffer.alloc(0)), /empty/);
  assert.throws(() => workspace.attach(org, note.id, "big.bin", Buffer.alloc(15_000_001)), /15 MB/);
  assert.throws(() => workspace.attach(org, "nope", "a.txt", Buffer.from("a")), /no such page/);

  // The content comes back as it went in, and only through its own note.
  assert.deepEqual(workspace.attachment(org, note.id, photo.id).data, png);
  const other = workspace.create(org, null, { kind: "note", title: "Other" });
  assert.throws(() => workspace.attachment(org, other.id, photo.id), /no such attachment/);

  // Only pictures are read; what the model answers is kept, and "NONE" means no words.
  await assert.rejects(workspace.readAttachment(org, note.id, pdf.id, async () => "x"), /Only pictures/);
  let got: [number, string] | null = null;
  const read = await workspace.readAttachment(org, note.id, photo.id, async (picture, type) => ((got = [picture.length, type]), "Trattoria Verde\r\nTotal 84.50"));
  assert.deepEqual([read.words, got], [4, [png.length, "image/png"]]);
  assert.equal(workspace.attachmentWords(org, note.id, photo.id), "Trattoria Verde\nTotal 84.50");
  const listed = workspace.office(org).files.find((f) => f.id === note.id)!;
  assert.match(listed.attached, /receipt photo\.PNG Trattoria Verde/);
  assert.match(listed.attached, /contract\.pdf/);
  assert.equal(workspace.get(org, note.id).files.find((f) => f.id === photo.id)!.words, 4);
  assert.equal((await workspace.readAttachment(org, note.id, photo.id, async () => "NONE")).words, 0);

  // Agents are not given attachments, even on a note they may see.
  workspace.update(org, note.id, { access: { everyone: true } });
  assert.deepEqual(workspace.get(org, note.id, "sales-lead").files, []);

  // Removing one deletes it; deleting the note for good takes the rest with it.
  workspace.detach(org, note.id, pdf.id);
  assert.throws(() => workspace.detach(org, note.id, pdf.id), /no such attachment/);
  assert.equal(workspace.attachments(org, note.id).length, 1);
  workspace.archive(org, note.id);
  workspace.purge(org);
  assert.equal(workspace.attachments(org, note.id).length, 0);
});
