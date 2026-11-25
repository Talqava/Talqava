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
  // After one $1 call, a second would make $2, past the $1.50 budget, so the run stops before it.
  assert.equal(mock.requests.length, 1);
  assert.deepEqual(notices, ['Stopped at its budget: about $1.00 spent of $1.50; the next step would have gone over. Say "continue" to keep going.']);
  assert.equal(saved.usage.cost, 1);
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

test("a cost the service reports (as OpenRouter does) is used instead of an estimate, and counts towards the budget", async () => {
  run = { model: local({ input: 1, output: 1 }), budget: { steps: 10, spend: 0.5 } };
  script.push({ calls: [{ name: "echo", args: { word: "a" } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.3 } }, { calls: [{ name: "echo", args: { word: "b" } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.3 } }, { text: "never reached" });
  const { saved, notices } = await runOnce("echo twice");
  // $0.30 reported, not the $0.00012 the list prices would give; a second call would pass the $0.50 budget, so it is not made.
  assert.equal(Math.round(saved.usage.cost! * 100) / 100, 0.3);
  assert.ok(notices.some((n) => /Stopped at its budget/.test(n)));
  script.length = 0;
});

test("tokens the service read from its cache are counted apart, at the cheaper price", async () => {
  run = { model: local({ input: 10, output: 10, cacheRead: 1 }), budget: { steps: 10 } };
  script.push({ text: "hello", usage: { prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 800 } } });
  const { saved } = await runOnce("say hello");
  assert.equal(saved.usage.cached, 800);
  assert.equal(saved.usage.input, 1000);
  // 200 fresh tokens at $10 a million and 800 cached at $1: $0.0028, not the $0.01 of reading it all afresh.
  assert.equal(Math.round(saved.usage.cost! * 1e6), 2800);
  script.length = 0;
});

test("a model with no known prices still keeps to the budget when the service reports costs", async () => {
  run = { model: local(undefined), budget: { steps: 10, spend: 0.1 } };
  script.push({ calls: [{ name: "echo", args: { word: "a" } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.2 } }, { text: "never reached" });
  const { saved, notices } = await runOnce("echo once");
  assert.equal(saved.usage.cost, 0.2);
  assert.ok(notices.some((n) => /Stopped at its budget/.test(n)));
  script.length = 0;
});

test("a run stops before a step that would go past a budget it shares with other runs", async () => {
  // Each call costs $1; $2.50 is left of the shared budget, then less as the run spends.
  let shared = 2.5;
  const model = local({ input: 10_000, output: 0 });
  run = { model, budget: { steps: 50 } };
  const spec = run as { remaining?: () => number };
  spec.remaining = () => shared;
  mock.requests.length = 0;
  for (let i = 0; i < 5; i++) script.push({ calls: [{ name: "echo", args: { word: `w${i}` } }] });
  const { id } = await conversations.create();
  const events: RunEvent[] = [];
  engine.subscribe(id, (e) => {
    events.push(e);
    if (e.type === "assistant") shared -= 1;
  });
  await (await engine.startRun(id, "keep echoing")).done;
  // Two calls ($2), then $0.50 is left: less than the next $1 step, so it stops without overspending.
  assert.equal(mock.requests.length, 2);
  assert.ok(events.some((e) => e.type === "notice" && /have \$0\.50 left, less than the next step/.test(e.text)));
  delete spec.remaining;
  script.length = 0;
});

test("services' small differences: the key's header, the reply limit's name, and a retry when a service refuses one", async () => {
  const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, body });
    // Like OpenAI's newer models: max_tokens is refused by name.
    if ("max_tokens" in body) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hi." }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    const request = { system: "s", messages: [{ role: "user" as const, content: "hello" }], tools: [], hostedTools: [], mcpServers: [], signal: new AbortController().signal };
    const quiet = { onText() {}, onThinking() {}, onToolStart() {} };
    // Azure: the key goes in "api-key", not "Authorization".
    const azure = new OpenAICompatibleModel({ providerId: "azure", providerName: "Azure", baseUrl, apiKey: "az-key", model: "gpt-x", keyHeader: "api-key", tokenLimit: "max_completion_tokens" });
    assert.equal(((await azure.call(request, quiet)).content[0] as { text: string }).text, "Hi.");
    assert.equal(seen[0].headers["api-key"], "az-key");
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].body.max_completion_tokens, 8192);
    // A service that was not told: the refusal is read, the other name is sent, and it is remembered.
    seen.length = 0;
    const plain = new OpenAICompatibleModel({ providerId: "x", providerName: "X", baseUrl, apiKey: "k", model: "gpt-y" });
    await plain.call(request, quiet);
    assert.deepEqual(seen.map((s) => "max_tokens" in s.body), [true, false]);
    assert.equal(seen[1].headers.authorization, "Bearer k");
    seen.length = 0;
    await plain.call(request, quiet);
    assert.deepEqual(seen.map((s) => "max_completion_tokens" in s.body), [true]);
  } finally {
    server.close();
  }
});

test("backup models: a service that is down or out of credit hands over before answering; a bad request does not", async () => {
  const { FallbackModel, ModelError } = await import("../../src/core/index.ts");
  const request = { system: "s", messages: [{ role: "user" as const, content: "hello" }], tools: [], hostedTools: [{ type: "web_search_20260209", name: "web_search" } as never], mcpServers: [], signal: new AbortController().signal };
  const quiet = { onText() {}, onThinking() {}, onToolStart() {} };
  const failing = (status: number | undefined, kind: "anthropic" | "openai" = "anthropic", partly = false): Model => ({
    ref: `a/${status}`,
    label: `fails ${status}`,
    kind,
    async call(_r, callbacks) {
      if (partly) callbacks.onText("Half");
      throw new ModelError("nope", status);
    },
  });
  const seenHosted: number[] = [];
  const good: Model = {
    ref: "b/good",
    label: "good",
    kind: "openai",
    prices: { input: 1, output: 2 },
    async call(r) {
      seenHosted.push(r.hostedTools.length);
      return { content: [{ type: "text", text: "From the backup." }] as never, stopReason: "end_turn", usage: { input: 1_000_000, output: 1_000_000 } };
    },
  };
  const switches: string[] = [];
  const onSwitch = (from: Model, to: Model) => switches.push(`${from.label} → ${to.label}`);

  for (const status of [undefined, 401, 402, 429, 500, 529]) {
    const reply = await new FallbackModel([failing(status), good], onSwitch).call(request, quiet);
    assert.equal((reply.content[0] as { text: string }).text, "From the backup.");
    // Counted at the backup's prices; Claude's hosted tools are not sent to another kind of model.
    assert.equal(reply.usage.cost, 3);
  }
  assert.equal(switches.length, 6);
  assert.deepEqual([...new Set(seenHosted)], [0]);
  await assert.rejects(new FallbackModel([failing(400), good]).call(request, quiet), /nope/);
  // Once a reply has started arriving, it is not switched halfway.
  await assert.rejects(new FallbackModel([failing(500, "anthropic", true), good]).call(request, quiet), /nope/);
  await assert.rejects(new FallbackModel([failing(500), failing(503)]).call(request, quiet), /nope/);
});

test("every loop has an exit: a repeated step, steps that keep failing, and a time limit each stop the run cleanly and say why", async () => {
  const stops = async (limits: object, replies: ChatReply[]) => {
    run = { model: local({ input: 0, output: 0 }), budget: { steps: 20 }, limits } as typeof run;
    script.length = 0;
    script.push(...replies);
    const { id } = await conversations.create();
    const events: RunEvent[] = [];
    engine.subscribe(id, (e) => events.push(e));
    await (await engine.startRun(id, "go")).done;
    const saved = (await conversations.get(id))!;
    return { stopped: events.filter((e) => e.type === "stopped") as { reason: string; text: string }[], saved, ran: events.filter((e) => e.type === "tool_result").map((e) => (e as { result: { is_error?: boolean; content: unknown } }).result) };
  };

  // The same step a third time is not run: the run stops, and every requested step still has an answer.
  const same = { calls: [{ name: "echo", args: { word: "again" } }] };
  const repeat = await stops({}, [same, same, same, { text: "never reached" }]);
  assert.deepEqual(repeat.stopped.map((s) => s.reason), ["repeat"]);
  assert.match(repeat.stopped[0].text, /same step \(echo\) a third time/);
  assert.deepEqual(repeat.ran.map((r) => Boolean(r.is_error)), [false, false, true]);
  assert.match(String(repeat.ran[2].content), /already tried 2 times/);
  assert.equal(repeat.saved.messages.at(-1)!.role, "user"); // the run can be continued: the last step has its answer

  // Different steps are fine, however many.
  const varied = await stops({}, [...[0, 1, 2, 3].map((n): ChatReply => ({ calls: [{ name: "echo", args: { word: `w${n}` } }] })), { text: "Done." }]);
  assert.deepEqual(varied.stopped, []);

  // Every step failing, four times in a row, stops it.
  const failing = await stops({}, [1, 2, 3, 4, 5].map((n) => ({ calls: [{ name: "echo", args: { other: n } }] })));
  assert.deepEqual(failing.stopped.map((s) => s.reason), ["failing"]);
  assert.equal(failing.ran.length, 4);

  // Past its time limit, it stops before the next step.
  // The clock moves a second each time it is read, so the test does not depend on how fast this computer is.
  const realNow = Date.now;
  let tick = realNow();
  Date.now = () => (tick += 1000);
  const slow = await stops({ minutes: 1.5 / 60 }, [{ calls: [{ name: "echo", args: { word: "a" } }] }, { text: "late" }]).finally(() => (Date.now = realNow));
  assert.deepEqual(slow.stopped.map((s) => s.reason), ["time"]);
  assert.match(slow.stopped[0].text, /time limit/);
  assert.equal(slow.ran.length, 1); // the first step ran; the next would have been past the limit

  // The budget stops say so too.
  run = { model: local({ input: 0, output: 0 }), budget: { steps: 1 } } as typeof run;
  script.length = 0;
  script.push({ calls: [{ name: "echo", args: { word: "x" } }] }, { text: "unreached" });
  const { id } = await conversations.create();
  const events: RunEvent[] = [];
  engine.subscribe(id, (e) => events.push(e));
  await (await engine.startRun(id, "go")).done;
  assert.deepEqual(events.filter((e) => e.type === "stopped").map((e) => (e as { reason: string }).reason), ["steps"]);
});

test("near the end of its budget an agent is told to wrap up and answer, and a chat keeps why its run stopped", async () => {
  const { WRAP_UP } = await import("../../src/core/engine.ts");
  run = { model: local({ input: 0, output: 0 }), budget: { steps: 3 } } as typeof run;
  mock.requests.length = 0;
  script.length = 0;
  script.push({ calls: [{ name: "echo", args: { word: "a" } }] }, { calls: [{ name: "echo", args: { word: "b" } }] }, { calls: [{ name: "echo", args: { word: "c" } }] }, { text: "unreached" });
  const { id } = await conversations.create();
  await (await engine.startRun(id, "look into it")).done;
  // The second call (two steps left) carries the wrap-up note after the tool result; the first does not.
  const said = mock.requests.map((r) => JSON.stringify(r.body.messages));
  assert.ok(!said[0].includes("close to its budget"));
  assert.ok(said[1].includes("close to its budget"));
  assert.equal(said.filter((x) => x.includes("Stop looking things up now")).length >= 1, true);
  assert.match(WRAP_UP, /what is left to do/);
  // It stopped at its steps: the conversation says so, and a new run clears it.
  const saved = (await conversations.get(id))!;
  assert.equal(saved.lastStop?.reason, "steps");
  script.push({ text: "All done." });
  await (await engine.startRun(id, "continue")).done;
  assert.equal((await conversations.get(id))!.lastStop, null);
});

test("several keys take turns; a key at its rate limit rests while another takes over, or the request waits briefly", async () => {
  const calls = { onText() {}, onThinking() {}, onToolStart() {} };
  const request = () => ({ system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [], hostedTools: [], mcpServers: [], signal: new AbortController().signal });
  const limits: { switched: boolean; waitedSeconds: number }[] = [];
  const make = (path: string, apiKey: string, moreKeys: string[] = []) =>
    new OpenAICompatibleModel({ providerId: "x", providerName: "Test service", baseUrl: `${mock.url}/${path}/v1`, apiKey, moreKeys, model: "m", onRateLimit: (i) => limits.push(i) });
  const keyOf = (i: number) => mock.requests.at(i)!.headers.authorization;
  script.length = 0;

  // Two keys take turns, request by request.
  script.push({ text: "one" }, { text: "two" });
  const pair = make("turns", "key-a", ["key-b"]);
  await pair.call(request(), calls);
  await pair.call(request(), calls);
  assert.deepEqual([keyOf(-2), keyOf(-1)], ["Bearer key-a", "Bearer key-b"]);

  // A key at its rate limit rests; the other takes over at once, in the same request.
  script.push({ status: 429, headers: { "retry-after": "120" } }, { text: "from the other key" });
  const reply = await make("switch", "key-a", ["key-b"]).call(request(), calls);
  assert.equal((reply.content[0] as { text: string }).text, "from the other key");
  assert.deepEqual([keyOf(-2), keyOf(-1)], ["Bearer key-a", "Bearer key-b"]);
  assert.deepEqual(limits.at(-1), { keys: 2, switched: true, waitedSeconds: 0 });

  // One key, a short wait: it waits, then carries on.
  script.push({ status: 429, headers: { "retry-after": "1" } }, { text: "after waiting" });
  const started = Date.now();
  assert.equal(((await make("wait", "key-c").call(request(), calls)).content[0] as { text: string }).text, "after waiting");
  assert.ok(Date.now() - started >= 900);
  assert.equal(limits.at(-1)!.switched, false);

  // A long wait is not made: the request fails at once, so a backup model can take over.
  script.push({ status: 429, headers: { "retry-after": "600" } });
  const quick = Date.now();
  await assert.rejects(make("long", "key-d").call(request(), calls), /rate limit/);
  assert.ok(Date.now() - quick < 2000);
  script.length = 0;
});
