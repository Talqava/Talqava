// The privacy guardrail: personal details are hidden from the AI service and put back in what it answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Masker, PrivacyModel } from "../../src/core/index.ts";
import type { Message, Model, ModelRequest } from "../../src/core/index.ts";

test("emails, phone numbers, card numbers and SSNs are hidden; dates, amounts and ids are not", () => {
  const m = new Masker();
  const text =
    "Email jane.doe@acme.co or call +1 (415) 555-0134 / 020 7946 0958. Card 4242 4242 4242 4242, SSN 123-45-6789. " +
    "Invoice 2026-11-25, total $12,450.00, order 123456789012, time 10:30, not a card 1234 5678 9012 3456.";
  const masked = m.mask(text);
  for (const secret of ["jane.doe@acme.co", "+1 (415) 555-0134", "020 7946 0958", "4242 4242 4242 4242", "123-45-6789"]) assert.ok(!masked.includes(secret), secret);
  for (const kept of ["2026-11-25", "$12,450.00", "123456789012", "10:30", "1234 5678 9012 3456"]) assert.ok(masked.includes(kept), kept);
  assert.match(masked, /\[EMAIL 1\].*\[PHONE 1\].*\[PHONE 2\].*\[CARD 1\].*\[SSN 1\]/);
  // The same value always gets the same placeholder, and everything comes back.
  assert.equal(m.mask("again jane.doe@acme.co"), "again [EMAIL 1]");
  assert.equal(m.unmask(masked), text);
  assert.equal(m.hidden, 5);
});

/** A model that records what it was sent and answers with a tool call that uses a placeholder. */
function fake(): Model & { sent: ModelRequest[] } {
  const sent: ModelRequest[] = [];
  return {
    ref: "x/y",
    label: "fake",
    kind: "anthropic",
    sent,
    async call(request, callbacks) {
      sent.push(structuredClone({ ...request, signal: undefined }) as unknown as ModelRequest);
      callbacks.onText("Writing to [EMAIL 1] now.");
      return {
        content: [
          { type: "text", text: "Writing to [EMAIL 1] now.", citations: null },
          { type: "tool_use", id: "t1", name: "send_email", input: { to: "[EMAIL 1]", body: "Hi, call me on [PHONE 1]." } },
        ] as never,
        stopReason: "tool_use",
        usage: { input: 1, output: 1 },
      };
    },
  };
}

test("the service sees placeholders; the reply, its tool calls and the streamed text have the real values", async () => {
  const inner = fake();
  const model = new PrivacyModel(inner);
  const streamed: string[] = [];
  const messages: Message[] = [{ role: "user", content: "Email the client at sam@client.org and give them my number, +44 20 7946 0958." }];
  const reply = await model.call({ system: "You help.", messages, tools: [], hostedTools: [], mcpServers: [], signal: new AbortController().signal }, { onText: (t) => streamed.push(t), onThinking() {}, onToolStart() {} });
  assert.equal(inner.sent[0].messages[0].content, "Email the client at [EMAIL 1] and give them my number, [PHONE 1].");
  assert.equal(streamed.join(""), "Writing to sam@client.org now.");
  const call = reply.content[1] as unknown as { input: { to: string; body: string } };
  assert.deepEqual(call.input, { to: "sam@client.org", body: "Hi, call me on +44 20 7946 0958." });
  // The conversation passed in is never changed.
  assert.match(String(messages[0].content), /sam@client\.org/);
});

test("the model's own earlier turns go back exactly as it wrote them, so Claude's checks pass", async () => {
  const inner = fake();
  const model = new PrivacyModel(inner);
  const messages: Message[] = [
    { role: "user", content: "Write to sam@client.org." },
    // What it wrote, with the real value put back, and a number of its own that it was never given.
    { role: "assistant", content: [{ type: "thinking", thinking: "Use [EMAIL 1].", signature: "sig" }, { type: "text", text: "I'll write to sam@client.org; their office is 0800 123 4567." }, { type: "tool_use", id: "t0", name: "send_email", input: { to: "sam@client.org" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t0", content: "Sent to sam@client.org; reply from bob@other.org." }] },
  ];
  await model.call({ system: "", messages, tools: [], hostedTools: [], mcpServers: [], signal: new AbortController().signal }, { onText() {}, onThinking() {}, onToolStart() {} });
  const sent = inner.sent[0].messages;
  const turn = sent[1].content as { type: string; text?: string; thinking?: string; input?: { to: string } }[];
  assert.equal(turn[0].thinking, "Use [EMAIL 1].");
  // A value it was given goes back as the placeholder it wrote; a value of its own stays as it wrote it.
  assert.equal(turn[1].text, "I'll write to [EMAIL 1]; their office is 0800 123 4567.");
  assert.equal(turn[2].input!.to, "[EMAIL 1]");
  // A tool's result is the user's side: everything in it is hidden.
  assert.match(JSON.stringify(sent[2].content), /Sent to \[EMAIL 1\]; reply from \[EMAIL 2\]\./);
});
