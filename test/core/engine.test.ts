// The agent loop, run against in-memory storage and a stand-in for the Anthropic API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { AnthropicModel, Engine, defineTool, memoryTool, systemPrompt, fillSecrets } from "../../src/core/index.ts";
import type { ApprovalMode, Conversation, RunEvent, RunSpec, ToolResult } from "../../src/core/index.ts";
import { startMockApi, say, call } from "../mock-api.ts";
import type { Reply } from "../mock-api.ts";
import { MemoryConversations, MemoryNotes } from "../memory-stores.ts";

const script: Reply[] = [];
let mock: Awaited<ReturnType<typeof startMockApi>>;
let approvalMode: ApprovalMode = "auto";
const ran: string[] = [];

const conversations = new MemoryConversations();
const notes = new MemoryNotes();
// A tool that changes something, so "ask" mode must confirm it.
const writeTool = defineTool<{ text: string }>({
  name: "write_note",
  description: "Writes a note.",
  properties: { text: { type: "string" } },
  required: ["text"],
  needsApproval: () => true,
  run: (input) => {
    ran.push(input.text);
    return `wrote ${input.text}`;
  },
});
const readTool = defineTool({ name: "read_note", description: "Reads.", properties: {}, run: () => "nothing here" });

const engine = new Engine({
  conversations,
  resolveRun: (): RunSpec => ({
    model: new AnthropicModel({ apiKey: "test-key", model: "claude-opus-5-5", effort: "high" }),
    system: "You are a test agent.",
    tools: [writeTool, readTool, memoryTool(notes)],
    hostedTools: [{ type: "web_search_20260209", name: "web_search" }],
    mcpServers: [],
    approvalMode,
  }),
});

before(async () => {
  mock = await startMockApi(script);
  process.env.ANTHROPIC_BASE_URL = mock.url;
});
after(() => mock.server.close());

const lastResult = (conversation: Conversation) =>
  (conversation.messages.findLast((m) => Array.isArray(m.content) && m.content[0]?.type === "tool_result")!.content as ToolResult[])[0];

test("runs a tool the model asks for and feeds the result back", async () => {
  approvalMode = "auto";
  script.push(call("write_note", { text: "hello" }), say("Done."));
  const { id } = await conversations.create();
  const events: RunEvent[] = [];
  engine.subscribe(id, (e) => events.push(e));
  await (await engine.startRun(id, "make a note")).done;

  const saved = (await conversations.get(id))!;
  assert.equal(saved.title, "make a note");
  assert.deepEqual(saved.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(lastResult(saved).content, "wrote hello");
  assert.deepEqual(ran, ["hello"]);
  assert.ok(events.some((e) => e.type === "delta" && e.kind === "text"));
  assert.deepEqual(events.at(-1), { type: "status", running: false, usage: saved.usage });

  const request = mock.requests.at(-1)!;
  assert.equal(request.headers["x-api-key"], "test-key");
  assert.equal(request.body.model, "claude-opus-5-5");
  assert.equal(request.body.fallbacks, "default");
  assert.match(String(request.headers["anthropic-beta"]), /compact-2026-01-12/);
  assert.match(String(request.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  // Old tool outputs are cleared on Anthropic's side, before the conversation is summarised.
  assert.match(String(request.headers["anthropic-beta"]), /context-management-2025-06-27/);
  assert.deepEqual(request.body.context_management.edits.map((e: { type: string }) => e.type), ["clear_tool_uses_20250919", "compact_20260112"]);
  assert.deepEqual(request.body.tools.map((t: { name: string }) => t.name), ["write_note", "read_note", "memory", "web_search"]);
  // The second request carries the tool result back.
  assert.equal(request.body.messages.at(-1).content[0].type, "tool_result");
});

test("in ask mode a risky tool waits, and a refusal is reported to the model", async () => {
  approvalMode = "ask";
  ran.length = 0;
  script.push(call("write_note", { text: "nope" }), say("Understood."));
  const { id } = await conversations.create();
  engine.subscribe(id, (e) => {
    if (e.type === "approval") {
      assert.equal(engine.awaitingApproval(id), true);
      engine.resolveApproval(id, e.approval.id, "deny");
    }
  });
  await (await engine.startRun(id, "try it")).done;
  const result = lastResult((await conversations.get(id))!);
  assert.equal(result.is_error, true);
  assert.match(String(result.content), /declined/);
  assert.deepEqual(ran, []);
});

test("'always allow' is remembered for the conversation; reading never asks", async () => {
  script.push(call("write_note", { text: "one" }), call("write_note", { text: "two" }), call("read_note", {}), say("ok"));
  const { id } = await conversations.create();
  let asked = 0;
  engine.subscribe(id, (e) => {
    if (e.type === "approval") {
      asked++;
      engine.resolveApproval(id, e.approval.id, "always");
    }
  });
  await (await engine.startRun(id, "go")).done;
  assert.equal(asked, 1);
  assert.deepEqual((await conversations.get(id))!.allowed, ["write_note"]);
});

test("bad or unknown tool input is returned as an error instead of being run", async () => {
  approvalMode = "auto";
  script.push(call("memory", { action: "explode" }), call("no_such_tool", {}), say("ok"));
  const { id } = await conversations.create();
  await (await engine.startRun(id, "go")).done;
  const results = (await conversations.get(id))!.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result") as ToolResult[];
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.is_error, true);
    assert.match(String(result.content), /INVALID_JSON/);
  }
});

test("the memory tool writes to whatever store it was given", async () => {
  script.push(call("memory", { action: "add", text: "The user writes mystery novels." }), say("ok"));
  const { id } = await conversations.create();
  await (await engine.startRun(id, "remember")).done;
  assert.equal(notes.items[0].text, "The user writes mystery novels.");
});

test("stopping a run cancels the waiting tool and leaves a valid history", async () => {
  approvalMode = "ask";
  script.push(call("write_note", { text: "never" }));
  const { id } = await conversations.create();
  engine.subscribe(id, (e) => e.type === "approval" && engine.stop(id));
  await (await engine.startRun(id, "go")).done;
  const saved = (await conversations.get(id))!;
  assert.equal(saved.messages.at(-1)!.role, "user");
  assert.match(String(lastResult(saved).content), /Cancelled/);
  assert.equal(engine.isRunning(id), false);
});

test("a second message is refused while a run is in progress", async () => {
  approvalMode = "ask";
  script.push(call("write_note", { text: "wait" }), say("ok"));
  const { id } = await conversations.create();
  let approvalId = "";
  engine.subscribe(id, (e) => e.type === "approval" && (approvalId = e.approval.id));
  const first = await engine.startRun(id, "one");
  await assert.rejects(engine.startRun(id, "two"), /still working/);
  while (!approvalId) await new Promise((r) => setTimeout(r, 5));
  engine.resolveApproval(id, approvalId, "allow");
  await first.done;
});

test("a scheduled job runs in its own conversation and keeps its name", async () => {
  approvalMode = "auto";
  script.push(say("Report: nothing new."));
  const job = { id: "j1", name: "digest", prompt: "do it", schedule: "every 1h", enabled: true, createdAt: "", nextRunAt: null, lastRunAt: null, lastConversationId: null };
  const { conversation, done } = await engine.runJob(job);
  await done;
  const saved = (await conversations.get(conversation.id))!;
  assert.equal(saved.title, "⏰ digest");
  assert.equal(saved.source, "schedule");
  assert.match(String(saved.messages[0].content), /Scheduled job "digest"/);
});

test("memory and skills appear in the system prompt", () => {
  const prompt = systemPrompt({
    agentName: "Talqava",
    setting: "in a test",
    environment: ["Your working folder is /work."],
    memory: [{ id: "m1", text: "The user writes mystery novels.", createdAt: "" }],
    skills: [{ name: "weekly-report", description: "How to build the weekly report", content: "", updatedAt: "" }],
  });
  assert.match(prompt, /You are Talqava, a personal AI agent in a test/);
  assert.match(prompt, /\[m1\] The user writes mystery novels/);
  assert.match(prompt, /weekly-report: How to build/);
  assert.match(prompt, /working folder is \/work/);
});

test("secrets are only filled in for their own host", () => {
  const secrets = { KEY: { value: "s3cret", host: "api.example.com" } };
  assert.equal(fillSecrets("Bearer {{secret:KEY}}", "api.example.com", secrets), "Bearer s3cret");
  assert.equal(fillSecrets("{{secret:KEY}}", "v2.api.example.com", secrets), "s3cret");
  assert.throws(() => fillSecrets("{{secret:KEY}}", "evil.com", secrets), /only be sent to/);
  assert.throws(() => fillSecrets("{{secret:KEY}}", "evilapi.example.com.evil.com", secrets), /only be sent to/);
  assert.throws(() => fillSecrets("{{secret:NOPE}}", "api.example.com", secrets), /No secret/);
});

test("a service that refuses clearing old outputs is asked again without it", async () => {
  approvalMode = "auto";
  const model = new AnthropicModel({ apiKey: "test-key", model: "claude-opus-5-5", effort: "high" });
  script.push({ content: [], stop_reason: "end_turn", error: { status: 400, message: "context_management.edits.0: clear_tool_uses_20250919 is not supported" } }, say("Fine."), say("Again."));
  const from = mock.requests.length;
  const callbacks = { onText() {}, onThinking() {}, onToolStart() {} };
  const request = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [], hostedTools: [], mcpServers: [], signal: new AbortController().signal };
  const reply = await model.call(request, callbacks);
  assert.equal((reply.content[0] as { text: string }).text, "Fine.");
  await model.call(request, callbacks);
  const [refused, retried, later] = mock.requests.slice(from);
  assert.equal(refused.body.context_management.edits.length, 2);
  for (const r of [retried, later]) {
    assert.deepEqual(r.body.context_management.edits, [{ type: "compact_20260112" }]);
    assert.doesNotMatch(String(r.headers["anthropic-beta"]), /context-management/);
  }
});

test("a run that fails says why on the conversation, and trying again asks once more without adding to it", async () => {
  let broken = true;
  const flaky = new Engine({
    conversations,
    resolveRun: (): RunSpec => {
      if (broken) throw new Error("The AI service could not be reached.");
      return { model: new AnthropicModel({ apiKey: "test-key", model: "claude-opus-5-5", effort: "high" }), system: "You are a test agent.", tools: [], hostedTools: [], mcpServers: [], approvalMode: "auto" };
    },
  });
  const { id } = await conversations.create();
  const events: RunEvent[] = [];
  flaky.subscribe(id, (e) => events.push(e));
  await (await flaky.startRun(id, "hello")).done;
  let saved = (await conversations.get(id))!;
  assert.equal(saved.lastError?.text, "The AI service could not be reached.", "kept, so it can still be read when the chat is opened later");
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(saved.messages.length, 1);

  broken = false;
  script.push(say("Hello again."));
  const again = await flaky.resumeRun(id, new Set(), "Trying again.");
  assert.ok(again);
  await again!.done;
  saved = (await conversations.get(id))!;
  assert.equal(saved.lastError ?? null, null, "a run that works clears it");
  assert.deepEqual(saved.messages.map((m) => m.role), ["user", "assistant"], "the same request was asked once more; nothing was added");
  assert.ok(events.some((e) => e.type === "resumed" && e.text === "Trying again."));
});
