// A stand-in for a local model runner (the chat completions format) that replays scripted replies as a stream.
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ChatReply {
  text?: string;
  calls?: { name: string; args: unknown }[];
  finish?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** Answer with this HTTP status instead of a stream. */
  status?: number;
}

export function startMockChat(script: ChatReply[]) {
  const requests: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ headers: req.headers, body: JSON.parse(raw) });
    const reply = script.shift() ?? { text: "(script ended)" };
    if (reply.status) {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "scripted failure" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (choice: unknown, extra: Record<string, unknown> = {}) =>
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: choice ? [choice] : [], ...extra })}\n\n`);
    send({ index: 0, delta: { role: "assistant" } });
    for (const piece of reply.text?.match(/.{1,8}/gs) ?? []) send({ index: 0, delta: { content: piece } });
    (reply.calls ?? []).forEach((call, index) => {
      const args = JSON.stringify(call.args);
      const half = Math.ceil(args.length / 2);
      // Arguments arrive in pieces, as they do from real runners.
      send({ index: 0, delta: { tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name: call.name, arguments: args.slice(0, half) } }] } });
      send({ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] } });
    });
    send({ index: 0, delta: {}, finish_reason: reply.finish ?? (reply.calls?.length ? "tool_calls" : "stop") });
    send(null, { usage: reply.usage ?? { prompt_tokens: 100, completion_tokens: 20 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise<{ server: http.Server; requests: typeof requests; url: string }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` })),
  );
}
