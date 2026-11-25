// The connector catalogue: a key is checked with the service before it is saved, and a refused key saves nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

let server: http.Server;
let address = "";

before(async () => {
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-catalog-"));
  // A stand-in for a service's connector: it accepts one key, and has one tool that reads and one that changes.
  server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer good-key") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_token" }));
    }
    const mcp = new McpServer({ name: "stand-in", version: "1.0.0" });
    mcp.registerTool("list_invoices", { description: "Lists invoices.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "none" }] }));
    mcp.registerTool("create_invoice", { description: "Creates an invoice.", inputSchema: { amount: z.number() } }, async () => ({ content: [{ type: "text", text: "made" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await mcp.connect(transport);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(async () => {
  const { closeConnectors } = await import("../../src/local/connectors.ts");
  await closeConnectors();
  server.closeAllConnections();
  server.close();
});

test("the catalogue says what each connector reads and changes, and lists what is not possible yet", async () => {
  const { listCatalog, CATALOG } = await import("../../src/local/connector-catalog.ts");
  const cat = listCatalog();
  assert.ok(cat.connectors.length >= 5);
  for (const c of cat.connectors) {
    assert.ok(c.reads && c.changes && c.keyHelp, `${c.name} says what it reads and changes and where its key comes from`);
    assert.match(c.url, /^https:\/\//);
    assert.match(c.docs, /^https:\/\//);
    assert.match(c.id, /^[a-z0-9-]{1,40}$/);
    assert.equal(c.connected, false);
  }
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length);
  assert.ok(cat.coming.some((x) => /Gmail/.test(x.name)) && cat.coming.every((x) => x.why));
});

test("a catalogue connector is saved only after the service accepts the key", async () => {
  const { connectCatalog, disconnectCatalog, listCatalog, connectorLabel, CATALOG } = await import("../../src/local/connector-catalog.ts");
  const { getConfig } = await import("../../src/local/store.ts");
  const stripe = CATALOG.find((c) => c.id === "stripe")!;
  const real = stripe.url;
  stripe.url = address;
  try {
    await assert.rejects(connectCatalog("stripe", ""), /Paste the key/);
    await assert.rejects(connectCatalog("nothing", "k"), /no such connector/);
    await assert.rejects(connectCatalog("stripe", "wrong-key"), /Stripe did not accept that key/);
    assert.equal(getConfig().mcpServers.length, 0, "a refused key saves nothing");

    assert.deepEqual(await connectCatalog("stripe", " good-key "), { tools: 2, readOnly: 1 });
    assert.deepEqual(getConfig().mcpServers.map((s) => [s.name, s.token]), [["stripe", "good-key"]]);
    assert.equal(listCatalog().connectors.find((c) => c.id === "stripe")!.connected, true);
    assert.equal(connectorLabel("stripe"), "Stripe");
    assert.equal(connectorLabel("my-own"), "my-own");

    // Its tools reach agents like any connector's: the one that changes something asks first.
    const { connectorTools } = await import("../../src/local/connectors.ts");
    const { tools, problems } = await connectorTools(getConfig().mcpServers);
    assert.deepEqual(problems, []);
    assert.deepEqual(tools.map((t) => [t.name, t.needsApproval!({} as never)]).sort(), [["stripe__create_invoice", true], ["stripe__list_invoices", false]]);

    await disconnectCatalog("stripe");
    assert.equal(getConfig().mcpServers.length, 0);
  } finally {
    stripe.url = real;
  }
});
