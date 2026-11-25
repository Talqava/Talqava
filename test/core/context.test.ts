// Keeping long runs cheap: old, large tool outputs are sent shortened, in batches, and the saved chat keeps them whole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, defineTool, trimOldResults, SHORTENED } from "../../src/core/index.ts";
import { capOutput, OUTPUT_CAP } from "../../src/core/engine.ts";
import type { Message, Model, ModelRequest, RunSpec, ToolResult } from "../../src/core/index.ts";
import { MemoryConversations } from "../memory-stores.ts";

const big = (n: number, c = "x") => c.repeat(n);
/** A conversation of `n` steps, each a tool call and its result. */
function steps(n: number, size = 5_000): Message[] {
  const out: Message[] = [{ role: "user", content: "do the task" }];
  for (let i = 0; i < n; i++) {
    out.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read", input: { i } }] });
    out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `start${i} ${big(size)} end${i}` }] });
  }
  return out;
}
const results = (messages: Message[]) =>
  messages.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? (m.content as ToolResult[]).filter((b) => b.type === "tool_result") : []));

test("short conversations are sent exactly as they are", () => {
  const messages = steps(11);
  const trimmed = trimOldResults(messages);
  assert.equal(trimmed.messages, messages);
  assert.equal(trimmed.outputs, 0);
});

test("old, large outputs are shortened a batch at a time; the newest stay whole", () => {
  const messages = steps(12);
  const before = JSON.stringify(messages);
  const trimmed = trimOldResults(messages);
  const sent = results(trimmed.messages);
  assert.equal(trimmed.outputs, 6);
  for (const r of sent.slice(0, 6)) {
    assert.match(String(r.content), /Shortened to save cost/);
    assert.ok(String(r.content).length < 1_000);
  }
  // The start and the end of each shortened output are kept.
  assert.match(String(sent[0].content), /^start0/);
  assert.match(String(sent[0].content), /end0$/);
  for (const r of sent.slice(6)) assert.ok(String(r.content).length > 5_000);
  assert.ok(trimmed.chars > 25_000);
  // The conversation itself is not changed.
  assert.equal(JSON.stringify(messages), before);

  // The boundary stays put until a whole new batch has gone by, so the service's cache is kept between steps.
  for (let n = 12; n < 18; n++) assert.equal(trimOldResults(steps(n)).outputs, 6);
  assert.equal(trimOldResults(steps(18)).outputs, 12);
});

test("errors, small outputs and images are handled sensibly", () => {
  const messages = steps(12, 100);
  assert.equal(trimOldResults(messages).outputs, 0, "small outputs are not worth shortening");

  const withError = steps(12);
  (results(withError)[0] as { is_error?: boolean }).is_error = true;
  const sent = results(trimOldResults(withError).messages);
  assert.doesNotMatch(String(sent[0].content), /Shortened/);
  assert.match(String(sent[1].content), /Shortened/);

  const withImage = steps(12);
  results(withImage)[0].content = [{ type: "image", source: { type: "base64", media_type: "image/png", data: big(8_000, "A") } }] as ToolResult["content"];
  const image = results(trimOldResults(withImage).messages)[0];
  assert.equal(typeof image.content, "string");
  assert.match(String(image.content), /An image was here/);
  assert.ok(SHORTENED(1234).includes("1,234 characters"));
});

test("one tool output can never fill the conversation", () => {
  const capped = capOutput(big(OUTPUT_CAP * 3)) as string;
  assert.ok(capped.length < OUTPUT_CAP + 200);
  assert.match(capped, /characters left out/);
  const parts = capOutput([{ type: "text", text: big(OUTPUT_CAP * 2) }]) as { text: string }[];
  assert.ok(parts[0].text.length < OUTPUT_CAP + 200);
  assert.equal(capOutput("short"), "short");
});

/** A model that is not Claude: records what it was sent, calls the tool `calls` times, then answers. */
function fakeModel(calls: number, trimsOnServer = false): Model & { sent: ModelRequest[] } {
  const sent: ModelRequest[] = [];
  let n = 0;
  return {
    ref: "fake/model",
    label: "fake",
    kind: "openai",
    prices: { input: 2, output: 10 },
    trimsOnServer,
    sent,
    async call(request) {
      sent.push({ ...request, messages: structuredClone(request.messages) });
      n++;
      if (n <= calls) return { content: [{ type: "tool_use", id: `c${n}`, name: "read", input: { n } }] as never, stopReason: "tool_use", usage: { input: 100, output: 10 } };
      return { content: [{ type: "text", text: "done", citations: null }] as never, stopReason: "end_turn", usage: { input: 100, output: 10 } };
    },
  };
}

async function runWith(model: Model, trimOutputs?: RunSpec["trimOutputs"]) {
  const conversations = new MemoryConversations();
  const read = defineTool<{ n: number }>({ name: "read", description: "Reads.", properties: { n: { type: "number" } }, required: ["n"], run: (input) => `page ${input.n} ${big(6_000)}` });
  const engine = new Engine({
    conversations,
    resolveRun: (): RunSpec => ({ model, system: "test", tools: [read], hostedTools: [], mcpServers: [], approvalMode: "auto", budget: { steps: 40 }, trimOutputs }),
  });
  const { id } = await conversations.create();
  await (await engine.startRun(id, "read everything")).done;
  return (await conversations.get(id))!;
}

test("a long run sends old outputs shortened, keeps them whole in the chat, and counts the saving", async () => {
  const model = fakeModel(14);
  const saved = await runWith(model);
  const last = results(model.sent.at(-1)!.messages);
  assert.equal(last.length, 14);
  assert.match(String(last[0].content), /Shortened to save cost/);
  assert.doesNotMatch(String(last.at(-1)!.content), /Shortened/);
  // What is saved and shown to the owner is whole.
  for (const r of results(saved.messages)) assert.doesNotMatch(String(r.content), /Shortened/);
  assert.ok((saved.usage.saved ?? 0) > 0);
});

test("models that clear old outputs on their side, and runs that turn it off, are sent everything", async () => {
  for (const [model, trim] of [[fakeModel(14, true), undefined], [fakeModel(14), false]] as const) {
    await runWith(model, trim);
    for (const r of results(model.sent.at(-1)!.messages)) assert.doesNotMatch(String(r.content), /Shortened/);
  }
});
