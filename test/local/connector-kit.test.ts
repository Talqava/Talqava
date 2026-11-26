// The connector kit and the services built on it, against stand-ins that answer like the real services.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-kit-"));
let K: typeof import("../../src/local/connector-kit.ts");
let server: http.Server;
let url = "";
const seen: { method: string; path: string; auth: string; body: any }[] = [];
const state = { asanaDown: false, tasks: [{ gid: "11", name: "Order flour", completed: false, due_on: "2026-12-01" }] as any[], slackPosts: [] as any[], products: new Map<number, any>([[5, { id: 5, name: "Rye loaf", status: "publish", sku: "RYE", price: "6.50", regular_price: "6.50", sale_price: "", stock_quantity: 4 }]]), dropHeader: false };

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = raw ? JSON.parse(raw) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, path: u.pathname + u.search, auth, body });
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      // ---- Asana ----
      if (u.pathname.startsWith("/asana/")) {
        if (auth !== "Bearer good-token" || state.asanaDown) return json(401, { errors: [{ message: "Not Authorized" }] });
        const p = u.pathname.slice(6);
        if (p === "/users/me") return json(200, { data: { name: "Ada", email: "ada@example.com" } });
        if (p === "/workspaces") return json(200, { data: [{ gid: "1", name: "Bakery" }] });
        if (p === "/projects/9/tasks") return json(200, { data: state.tasks.filter((t) => !u.searchParams.get("completed_since") || !t.completed) });
        if (p === "/tasks" && req.method === "POST") return (state.tasks.push({ gid: "12", ...body.data }), json(201, { data: { gid: "12", name: body.data.name, permalink_url: "https://app.asana.com/0/9/12" } }));
        if (p === "/tasks/11" && req.method === "PUT") return (Object.assign(state.tasks[0], body.data), json(200, { data: state.tasks[0] }));
        return json(404, { errors: [{ message: "No such thing" }] });
      }
      // ---- Slack ----
      if (u.pathname.startsWith("/slack/")) {
        const m = u.pathname.slice(7);
        if (auth !== "Bearer xoxb-good") return json(200, { ok: false, error: "invalid_auth" });
        if (m === "auth.test") return json(200, { ok: true, team: "Bakery HQ", user: "talqava" });
        if (m === "conversations.list") return json(200, { ok: true, channels: [{ id: "C1", name: "general", is_member: true }, { id: "C2", name: "orders", is_private: true, is_member: false }] });
        if (m === "conversations.history") return u.searchParams.get("channel") === "C2" ? json(200, { ok: false, error: "not_in_channel" }) : json(200, { ok: true, messages: [{ ts: "1795000000.000100", user: "U1", text: "Flour is <b>low</b>" }] });
        if (m === "chat.postMessage") return (state.slackPosts.push(body), json(200, { ok: true, channel: body.channel, ts: "1795000100.000200" }));
        return json(200, { ok: false, error: "unknown_method" });
      }
      // ---- WooCommerce ----
      if (u.pathname.startsWith("/wp-json/wc/v3")) {
        const good = `Basic ${Buffer.from("ck_good:cs_good").toString("base64")}`;
        const byAddress = u.searchParams.get("consumer_key") === "ck_good" && u.searchParams.get("consumer_secret") === "cs_good";
        if (!(byAddress || (auth === good && !state.dropHeader))) return json(401, { code: "woocommerce_rest_cannot_view", message: "Sorry, you cannot list resources." });
        const p = u.pathname.slice("/wp-json/wc/v3".length);
        if (p === "/data/currencies/current") return json(200, { code: "USD" });
        if (p === "/orders") return json(200, [{ id: 70, number: "70", status: "processing", date_created: "2026-11-25T10:00:00", total: "19.50", currency: "USD", billing: { first_name: "Sam", last_name: "Lee" } }]);
        if (p === "/products/5" && req.method === "PUT") return (Object.assign(state.products.get(5), body, body.regular_price ? { price: body.regular_price } : {}), json(200, state.products.get(5)));
        if (p === "/products") return json(200, [...state.products.values()]);
        return json(404, { message: "No route" });
      }
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.TALQAVA_ASANA_API = `${url}/asana`;
  process.env.TALQAVA_SLACK_API = `${url}/slack`;
  K = await import("../../src/local/connector-kit.ts");
  await import("../../src/local/services/index.ts");
});
after(() => server.close());
const tool = (name: string) => K.serviceTools().find((t) => t.name === name);
const run = async (name: string, input: any = {}) => String(await tool(name)!.run(input, { conversation: { id: "t" }, signal: new AbortController().signal } as never));

test("a connection is checked with the service before it is saved, and its key is never shown again", async () => {
  await assert.rejects(K.connectService("nothing", {}), /no such service/);
  await assert.rejects(K.connectService("asana", { values: {} }), /Fill in: Personal access token/);
  await assert.rejects(K.connectService("asana", { values: { token: "wrong" } }), /Asana refused that/);
  assert.equal(K.serviceTools().length, 0, "nothing connected, no tools");
  const c = await K.connectService("asana", { values: { token: " good-token " } });
  assert.equal(c.label, "Ada (ada@example.com)");
  assert.equal(c.rule, "ask", "a new connection asks before each change");
  assert.equal(JSON.stringify(K.listServices()).includes("good-token"), false);
  const again = await K.connectService("asana", { values: { token: "good-token" } });
  assert.equal(again.id, c.id, "connecting the same account again replaces it");
});

test("the owner's rule decides which tools exist and when they ask", async () => {
  const id = K.listServices().find((s) => s.id === "asana")!.connections[0].id;
  assert.equal(tool("asana__list_tasks")!.needsApproval({}), false, "reading never asks");
  assert.equal(tool("asana__create_task")!.needsApproval({}), true, "a change asks");
  assert.match(await run("asana__list_tasks", { project: "9" }), /\[11\] Order flour · due 2026-12-01/);
  assert.match(await run("asana__create_task", { name: "Call the miller", project: "9" }), /Added the task “Call the miller” \(12\)/);
  assert.deepEqual(seen.at(-1)!.body, { data: { name: "Call the miller", projects: ["9"] } });

  K.updateConnection(id, { rule: "auto" });
  assert.equal(tool("asana__update_task")!.needsApproval({}), false);
  assert.match(await run("asana__update_task", { task: "11", completed: true }), /now done/);

  K.updateConnection(id, { rule: "read" });
  assert.equal(tool("asana__create_task"), undefined, "a read-only connection offers no tools that change things");
  assert.ok(tool("asana__list_tasks"));
  assert.throws(() => K.updateConnection(id, { rule: "anything" }), /Choose what agents may do/);
  assert.match(K.serviceNotes().join(" "), /Asana is connected \(Ada \(ada@example.com\)\): its tools start with asana__/);
});

test("a connection that stops working is marked, and an unreachable service is not mistaken for a bad key", async () => {
  state.asanaDown = true;
  let all = await K.checkConnections();
  assert.match(all.find((c) => c.service === "asana")!.problem ?? "", /Asana refused that/);
  assert.deepEqual(K.connectionProblems().map((p) => [p.name, p.integration]), [["Asana (Ada (ada@example.com))", "service:asana"]], "the owner is told which connection, and where to fix it");
  state.asanaDown = false;
  all = await K.checkConnections();
  assert.equal(all.find((c) => c.service === "asana")!.problem, undefined);
  assert.deepEqual(K.connectionProblems(), []);
  // A refusal while an agent is working marks the connection too, and the next call that works clears it.
  state.asanaDown = true;
  await assert.rejects(run("asana__list_tasks", { project: "9" }), /Asana refused that/);
  assert.equal(K.connectionProblems().length, 1);
  state.asanaDown = false;
  await run("asana__list_tasks", { project: "9" });
  assert.deepEqual(K.connectionProblems(), []);
  const real = process.env.TALQAVA_ASANA_API;
  process.env.TALQAVA_ASANA_API = "http://127.0.0.1:9";
  all = await K.checkConnections();
  assert.equal(all.find((c) => c.service === "asana")!.problem, undefined);
  process.env.TALQAVA_ASANA_API = real;
  K.removeConnection(all[0].id);
  assert.equal(K.serviceTools().length, 0);
});

test("Slack: the bot token is checked, refusals are explained, and posting asks first", async () => {
  await assert.rejects(K.connectService("slack", { values: { token: "xoxp-user" } }), /not a bot token/);
  await assert.rejects(K.connectService("slack", { values: { token: "xoxb-bad" } }), /bot token is not accepted/);
  const c = await K.connectService("slack", { values: { token: "xoxb-good" } });
  assert.equal(c.label, "Bakery HQ");
  assert.equal(await run("slack__list_channels"), "[C1] #general · bot is a member\n[C2] #orders (private)");
  assert.match(await run("slack__read_channel", { channel: "C1" }), /U1 · Flour is low \[1795000000\.000100\]/);
  await assert.rejects(run("slack__read_channel", { channel: "C2" }), /the bot is not in that channel.*\/invite/);
  assert.equal(tool("slack__post_message")!.needsApproval({ channel: "C1", text: "x" }), true);
  assert.match(await run("slack__post_message", { channel: "C1", text: "Flour ordered.", thread: "1795000000.000100" }), /Posted in C1/);
  assert.deepEqual(state.slackPosts[0], { channel: "C1", text: "Flour ordered.", thread_ts: "1795000000.000100" });
  K.removeConnection(c.id);
});

test("WooCommerce: connects by header, or by address when the host drops the header, and changes a product", async () => {
  await assert.rejects(K.connectService("woocommerce", { values: { url: "http://shop.example", key: "ck_good", secret: "cs_good" } }), /must start with https/);
  await assert.rejects(K.connectService("woocommerce", { values: { url, key: "ck_bad", secret: "cs_good" } }), /WooCommerce refused that: Sorry, you cannot list resources/);
  state.dropHeader = true;
  const c = await K.connectService("woocommerce", { values: { url: `${url}/wp-admin/`, key: "ck_good", secret: "cs_good" } });
  assert.match(await run("woocommerce__list_orders", { status: "processing" }), /\[70\] #70 · processing · 2026-11-25 · 19\.50 USD · Sam Lee/);
  assert.match(seen.at(-1)!.path, /consumer_key=ck_good/);
  assert.equal(seen.at(-1)!.auth, "", "where the header is dropped, the keys go in the address only");
  state.dropHeader = false;
  K.removeConnection(c.id);

  const d = await K.connectService("woocommerce", { values: { url, key: "ck_good", secret: "cs_good" }, rule: "auto" });
  assert.match(await run("woocommerce__list_products"), /\[5\] Rye loaf · publish · SKU RYE · price 6\.50 · 4 in stock/);
  assert.equal(seen.at(-1)!.path.includes("consumer_key"), false);
  await assert.rejects(run("woocommerce__update_product", { id: 5, regular_price: "cheap" }), /Write a price like 19\.99/);
  assert.match(await run("woocommerce__update_product", { id: 5, regular_price: "7.00", stock_quantity: 10 }), /price 7\.00 · 10 in stock/);
  K.removeConnection(d.id);
});
