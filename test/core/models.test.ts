// Stage 1, "any model": the chat completions adapter, budgets, the model check and the page reader.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  Engine,
  OpenAICompatibleModel,
  checkModel,
  costOf,
  defineTool,
  htmlToText,
  isPrivateAddress,
  pageTool,
  toChatMessages,
} from "../../src/core/index.ts";
import type { Budget, Conversation, Model, Prices, RunEvent, RunSpec } from "../../src/core/index.ts";
import { startMockChat } from "../mock-openai.ts";
import type { ChatReply } from "../mock-openai.ts";
import { MemoryConversations } from "../memory-stores.ts";

const script: ChatReply[] = [];
let mock: Awaited<ReturnType<typeof startMockChat>>;
const conversations = new MemoryConversations();
const context = { signal: new AbortController().signal, conversation: {} as Conversation };

const echoTool = defineTool<{ word: string }>({
  name: "echo",
  description: "Repeats a word.",
  properties: { word: { type: "string" } },
  required: ["word"],
  run: (input) => `echo: ${input.word}`,
});

let run: { model: Model; budget?: Budget } = { model: null as unknown as Model };
const engine = new Engine({
  conversations,
  resolveRun: (): RunSpec => ({ ...run, system: "You are a test agent.", tools: [echoTool], hostedTools: [], mcpServers: [], approvalMode: "auto" }),
});

const local = (prices?: Prices, baseUrl = mock.url) =>
  new OpenAICompatibleModel({ providerId: "local", providerName: "Test runner", baseUrl, apiKey: "local-key", model: "tiny-model", prices });

async function runOnce(text: string) {
  const { id } = await conversations.create();
  const events: RunEvent[] = [];
  engine.subscribe(id, (e) => events.push(e));
  await (await engine.startRun(id, text)).done;
  return { saved: (await conversations.get(id))!, events, notices: events.filter((e) => e.type === "notice" || e.type === "error").map((e) => (e as { text: string }).text) };
}

before(async () => {
  mock = await startMockChat(script);
});
after(() => mock.server.close());

test("a bot runs on a local model: tool call, result, answer", async () => {
  run = { model: local({ input: 0, output: 0 }) };
  mock.requests.length = 0;
  script.push({ calls: [{ name: "echo", args: { word: "quest" } }] }, { text: "The echo said quest." });
  const { saved, events } = await runOnce("echo quest");

  assert.deepEqual(saved.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal((saved.messages[2].content as any[])[0].content, "echo: quest");
  assert.ok(events.some((e) => e.type === "delta" && e.kind === "tool" && e.text === "echo"));
  assert.equal(saved.usage.input, 200);
  assert.equal(saved.usage.cost, 0);

  const [first, second] = mock.requests;
  assert.equal(first.headers.authorization, "Bearer local-key");
  assert.equal(first.body.model, "tiny-model");
  assert.equal(first.body.stream, true);
  assert.deepEqual(first.body.tools, [
    { type: "function", function: { name: "echo", description: "Repeats a word.", parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } } },
  ]);
  assert.equal(first.body.messages[0].role, "system");
  // The second request carries the call and its result in the chat completions format.
  const [, , assistant, tool] = second.body.messages;
  assert.equal(assistant.tool_calls[0].function.name, "echo");
  assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), { word: "quest" });
  assert.deepEqual(tool, { role: "tool", tool_call_id: "call_0", content: "echo: quest" });
});

test("the conversation is translated without Claude-only blocks", () => {
  const messages = toChatMessages("sys", [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "x" }, { type: "text", text: "hello" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "only thinking", signature: "x" }] },
    { role: "user", content: [{ type: "text", text: "and" }, { type: "text", text: "more" }] },
  ] as any);
  assert.deepEqual(messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "and\nmore" },
  ]);
});

test("a run stops at its step budget", async () => {
  run = { model: local({ input: 0, output: 0 }), budget: { steps: 2 } };
  mock.requests.length = 0;
  for (let i = 0; i < 4; i++) script.push({ calls: [{ name: "echo", args: { word: `w${i}` } }] });
  const { notices } = await runOnce("keep echoing");
  assert.equal(mock.requests.length, 2);
  assert.deepEqual(notices, ['Stopped at its budget: 2 steps. Say "continue" to keep going.']);
  script.length = 0;
});

test("a run stops at its spend budget", async () => {
  // $10,000 per million input tokens: each 100-token call costs $1.
  run = { model: local({ input: 10_000, output: 0 }), budget: { steps: 50, spend: 1.5 } };
  mock.requests.length = 0;
  for (let i = 0; i < 4; i++) script.push({ calls: [{ name: "echo", args: { word: `w${i}` } }] });
  const { saved, notices } = await runOnce("keep echoing");
  assert.equal(mock.requests.length, 2);
  assert.deepEqual(notices, ['Stopped at its budget: about $2.00 spent of $1.50. Say "continue" to keep going.']);
  assert.equal(saved.usage.cost, 2);
  script.length = 0;
});

test("with unknown prices, only the step budget applies, and the user is told", async () => {
  run = { model: local(undefined), budget: { steps: 5, spend: 0.01 } };
  script.push({ text: "hello" });
  const { saved, notices } = await runOnce("hi");
  assert.match(notices[0], /cost of tiny-model on Test runner is not known/);
  assert.equal(saved.usage.cost, undefined);
});

test("costs follow the price list, cache reads included", () => {
  assert.equal(costOf({ input: 4, output: 20 }, { input: 1_000_000, output: 100_000, cacheRead: 1_000_000 }), 4 + 2 + 0.4);
});

test("service errors are explained in plain words", async () => {
  run = { model: local({ input: 0, output: 0 }) };
  script.push({ status: 404 });
  let result = await runOnce("hi");
  assert.match(result.notices[0], /Test runner does not know the model "tiny-model"/);

  run = { model: local({ input: 0, output: 0 }, "http://127.0.0.1:9/v1") };
  result = await runOnce("hi");
  assert.match(result.notices[0], /Could not reach Test runner .* check that it is running/);
});

test("the model check passes a model that follows instructions and chains tools", async () => {
  script.push(
    { text: "READY" },
    { calls: [{ name: "add", args: { a: 17, b: 25 } }] },
    { text: "42" },
    { calls: [{ name: "lookup", args: { key: "capital of Zorbia" } }] },
    { calls: [{ name: "lookup", args: { key: "population of Quillon" } }] },
    { text: "84,312" },
  );
  const result = await checkModel(local({ input: 0, output: 0 }));
  assert.deepEqual([result.instructions, result.tools, result.multiStep], [true, true, true]);
  assert.deepEqual(result.recommended, ["Scout", "Scribe", "Maker", "Keeper", "Counter", "Spark"]);
  assert.equal(result.model, "local/tiny-model");
});

test("the model check limits a model that cannot use tools", async () => {
  script.push({ text: "Ready!" }, { text: "The answer is 42." }, { text: "I don't know." });
  const result = await checkModel(local({ input: 0, output: 0 }));
  assert.deepEqual([result.instructions, result.tools, result.multiStep], [true, false, false]);
  assert.deepEqual(result.recommended, ["Spark"]);
  assert.ok(result.notes.some((note) => /did not call the add tool/.test(note)));
});

test("the page reader keeps the readable text", () => {
  const page = htmlToText(
    "<html><head><title>Quest  log</title><style>p{}</style></head><body><script>alert(1)</script><h1>Day 1</h1><p>Found &amp; fixed&nbsp;it &#8212; done.</p><ul><li>one</li><li>two</li></ul></body></html>",
  );
  assert.equal(page.title, "Quest log");
  assert.equal(page.text, "Day 1\nFound & fixed it — done.\n\n- one\n- two");
});

test("the page reader refuses this machine and private networks", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(address), false, address);
  await assert.rejects(Promise.resolve(pageTool().run({ url: "http://localhost:8787/" }, context)), /private network/);
  await assert.rejects(Promise.resolve(pageTool().run({ url: "http://169.254.169.254/latest/meta-data" }, context)), /private network/);
  await assert.rejects(Promise.resolve(pageTool().run({ url: "file:///etc/passwd" }, context)), /Only http and https/);
});

test("the page reader follows redirects and reads the page", async () => {
  const site = http.createServer((req, res) => {
    if (req.url === "/old") {
      res.writeHead(302, { location: "/new" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>New page</title><p>Moved here.</p>");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  try {
    const port = (site.address() as AddressInfo).port;
    const text = String(await pageTool({ allowPrivate: true }).run({ url: `http://127.0.0.1:${port}/old` }, context));
    assert.equal(text, `New page\nhttp://127.0.0.1:${port}/new\n\nMoved here.`);
  } finally {
    site.close();
  }
});
