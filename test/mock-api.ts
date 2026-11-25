// A stand-in for the Anthropic API that replays scripted replies as a stream.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
export interface Reply {
  content: Block[];
  stop_reason: string;
  /** Answer with this error instead, as the API does for a request it refuses. */
  error?: { status: number; message: string };
}
export interface Recorded {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

/** Replays a script in order, or asks a function for each reply (for runs that overlap). */
export function startMockApi(script: Reply[] | ((body: any) => Reply | Promise<Reply>)): Promise<{ server: http.Server; requests: Recorded[]; url: string; route?: (body: any) => Reply | undefined }> {
  const requests: Recorded[] = [];
  // Set `route` on the returned object to answer by what was asked rather than by order; a request it does not answer falls back to the script.
  const handle: { route?: (body: any) => Reply | undefined } = {};
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw) });
    const body = requests.at(-1)!.body;
    const reply = handle.route?.(body) ?? (typeof script === "function" ? await script(body) : script.shift()) ?? { content: [{ type: "text", text: "(script ended)" }], stop_reason: "end_turn" };
    if (reply.error) {
      res.writeHead(reply.error.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: reply.error.message } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (event: { type: string; [key: string]: unknown }) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({
      type: "message_start",
      message: { id: "msg_test", type: "message", role: "assistant", model: "mock", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
    });
    reply.content.forEach((block, index) => {
      if (block.type === "text") {
        send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
        for (const piece of block.text.match(/.{1,12}/gs) ?? []) send({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
      } else {
        send({ type: "content_block_start", index, content_block: { ...block, input: {} } });
        send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
      }
      send({ type: "content_block_stop", index });
    });
    send({ type: "message_delta", delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
    send({ type: "message_stop" });
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(Object.assign(handle, { server, requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))),
  );
}

export const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
export const call = (name: string, input: unknown, id = `toolu_${Math.random().toString(36).slice(2)}`): Reply => ({
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use",
});
