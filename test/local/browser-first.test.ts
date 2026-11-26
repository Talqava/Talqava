// Browser sign-in for services that also take a key: Asana, HubSpot and Typeform with a code, Trello with a token
// handed back in the address, and the slot for an app registered by Talqava's maker. Against stand-ins.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-browser-first-"));
let K: typeof import("../../src/local/connector-kit.ts");
let server: http.Server;
const seen: { path: string; auth: string; body: Record<string, string> | null; query: string; json: any }[] = [];
let zendeskRole = "agent";
const redirect = "http://localhost:8787/api/oauth/callback";

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ path: u.pathname, auth, body, query: u.search, json: raw.startsWith("{") ? JSON.parse(raw) : null });
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      if (u.pathname.endsWith("/token")) {
        if (body?.grant_type === "refresh_token") return json(200, { access_token: "second", refresh_token: "rt2", expires_in: 1800 });
        return body?.code === "ok" ? json(200, { access_token: "first", refresh_token: "rt1", expires_in: 1 }) : json(400, { error: "invalid_grant" });
      }
      if (u.pathname === "/trello/members/me") return auth.includes('oauth_token="ttoken"') && auth.includes('oauth_consumer_key="tkey"') ? json(200, { fullName: "Ada Baker", username: "ada" }) : json(401, { message: "invalid token" });
      if (!/^Bearer (first|second)$/.test(auth)) return json(401, { message: "no" });
      if (u.pathname === "/asana/users/me") return json(200, { data: { name: "Ada", email: "ada@example.com" } });
      if (u.pathname === "/asana/workspaces") return json(200, { data: [{ gid: "11", name: "Bakery" }] });
      if (u.pathname.startsWith("/hubspot/account-info/")) return json(200, { portalId: 4242 });
      if (u.pathname === "/typeform/forms") return json(200, { total_items: 3, items: [] });
      if (u.pathname === "/zendesk/users/me") return json(200, { user: zendeskRole === "none" ? { id: null, name: "Anonymous user", role: "end-user" } : { id: 7, name: "Ada Baker", email: "ada@example.com", role: "agent" } });
      const ticket = { id: 41, subject: "Late <b>delivery</b>", status: "open", priority: "high", updated_at: "2026-11-25T10:00:00Z", description: "Where is my bread?", tags: ["delivery"] };
      if (u.pathname === "/zendesk/tickets" && req.method === "GET") return json(200, { tickets: [ticket] });
      if (u.pathname === "/zendesk/tickets" && req.method === "POST") return json(201, { ticket: { ...ticket, id: 42, subject: JSON.parse(raw).ticket.subject } });
      if (u.pathname === "/zendesk/search") return json(200, { results: [{ ...ticket, result_type: "ticket" }, { id: 9, result_type: "user" }], count: 2 });
      if (u.pathname === "/zendesk/tickets/41" && req.method === "GET") return json(200, { ticket });
      if (u.pathname === "/zendesk/tickets/41" && req.method === "PUT") return json(200, { ticket: { ...ticket, ...JSON.parse(raw).ticket, comment: undefined } });
      if (u.pathname === "/zendesk/tickets/41/comments") return json(200, { comments: [{ author_id: 3, public: true, plain_body: "Where is my bread?", created_at: "2026-11-25T09:00:00Z" }, { author_id: 7, public: false, plain_body: "Driver was late.", created_at: "2026-11-25T09:30:00Z" }], users: [{ id: 3, name: "Sam Customer" }, { id: 7, name: "Ada Baker" }] });
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of ["ASANA", "HUBSPOT", "TYPEFORM", "TRELLO", "ZENDESK"]) (process.env[`TALQAVA_${id}_API`] = `${url}/${id.toLowerCase()}`), (process.env[`TALQAVA_${id}_TOKEN_API`] = `${url}/${id.toLowerCase()}/token`);
  K = await import("../../src/local/connector-kit.ts");
  await import("../../src/local/services/index.ts");
});
after(() => server.close());

const tool = (name: string) => K.serviceTools().find((t) => t.name === name)!;

test("every service that takes a key and can sign in through the browser offers both", () => {
  const byId = new Map(K.listServices().map((s) => [s.id, s]));
  for (const id of ["asana", "hubspot", "typeform", "trello"]) {
    const s = byId.get(id)!;
    assert.ok(s.browser && s.fields.length, `${id} offers the browser and a key`);
    assert.equal(s.browser.oneClick, false, "no app of Talqava's own is registered yet");
    assert.ok(s.browser.appSteps.some((step) => /\{redirect\}|\{origin\}/.test(step)), `${id} says which address to register`);
  }
  assert.equal(byId.get("trello")!.browser!.idLabel, "API key");
  assert.equal(byId.get("trello")!.browser!.secret, "never");
});

test("Asana signs in with a code and the PKCE proof, and its token is renewed when it runs out", async () => {
  assert.throws(() => K.startBrowserSignIn("asana", { clientId: "app1" }, redirect), /client secret/);
  const to = new URL(K.startBrowserSignIn("asana", { clientId: "app1", clientSecret: "shh" }, redirect).url);
  assert.equal(to.origin + to.pathname, "https://app.asana.com/-/oauth_authorize");
  assert.equal(to.searchParams.get("scope"), "users:read workspaces:read projects:read tasks:read tasks:write stories:write");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  const c = await K.finishBrowserSignIn(to.searchParams.get("state"), "ok");
  assert.equal(c.label, "Ada (ada@example.com)");
  const exchange = seen.find((s) => s.path === "/asana/token")!.body!;
  assert.deepEqual([exchange.grant_type, exchange.client_id, exchange.client_secret, exchange.redirect_uri, Boolean(exchange.code_verifier)], ["authorization_code", "app1", "shh", redirect, true]);
  assert.equal(seen.find((s) => s.path === "/asana/users/me")!.auth, "Bearer first");
  // The token lasted one second: the next use renews it, and the service's own code reads the new one.
  assert.match(String(await tool("asana__list_projects").run({}, {} as never)), /Bakery/);
  assert.equal(seen.at(-1)!.auth, "Bearer second");
  assert.equal(seen.filter((s) => s.path === "/asana/token").at(-1)!.body!.grant_type, "refresh_token");
});

test("HubSpot and Typeform sign in with a code and the app's secret, without the PKCE proof their pages do not describe", async () => {
  for (const [id, label] of [["hubspot", "Account 4242"], ["typeform", "3 forms"]] as const) {
    const to = new URL(K.startBrowserSignIn(id, { clientId: "app2", clientSecret: "shh" }, redirect).url);
    assert.equal(to.searchParams.get("code_challenge"), null);
    const c = await K.finishBrowserSignIn(to.searchParams.get("state"), "ok");
    assert.equal(c.label, label);
    assert.equal(seen.filter((s) => s.path === `/${id}/token`).at(-1)!.body!.code_verifier, undefined);
  }
  assert.match(new URL(K.startBrowserSignIn("hubspot", { clientId: "a", clientSecret: "b" }, redirect).url).searchParams.get("scope")!, /^oauth crm\.objects\.contacts\.read /);
  assert.match(new URL(K.startBrowserSignIn("typeform", { clientId: "a", clientSecret: "b" }, redirect).url).searchParams.get("scope")!, /offline$/);
});

test("Trello hands its token back in the address: no secret, nothing to copy but the public API key", async () => {
  const to = new URL(K.startBrowserSignIn("trello", { clientId: "tkey" }, redirect).url);
  assert.equal(to.origin + to.pathname, "https://trello.com/1/authorize");
  assert.deepEqual([to.searchParams.get("key"), to.searchParams.get("scope"), to.searchParams.get("response_type"), to.searchParams.get("callback_method"), to.searchParams.get("expiration")], ["tkey", "read,write", "token", "fragment", "never"]);
  const back = to.searchParams.get("return_url")!;
  assert.ok(back.startsWith(`${redirect}/`) && !back.includes("?"), "the way back carries no query of its own");
  const state = back.slice(redirect.length + 1);
  assert.equal(K.awaitsFragment(state), true);
  assert.equal(K.awaitsFragment("something-else"), false);
  // A code cannot finish this kind of sign-in, and pressing Deny (an empty token) connects nothing.
  await assert.rejects(K.finishFragmentSignIn(state, ""), /did not approve/);
  await assert.rejects(K.finishFragmentSignIn(state, "ttoken"), /not started here/, "a sign-in is used once");
  const again = new URL(K.startBrowserSignIn("trello", { clientId: "tkey" }, redirect).url).searchParams.get("return_url")!.slice(redirect.length + 1);
  await assert.rejects(K.finishFragmentSignIn(again, 'x" y'), /did not complete/);
  const third = new URL(K.startBrowserSignIn("trello", { clientId: "tkey" }, redirect).url).searchParams.get("return_url")!.slice(redirect.length + 1);
  assert.equal((await K.finishFragmentSignIn(third, "ttoken")).label, "Ada Baker (@ada)");
});

test("with an app registered by Talqava's maker, signing in asks for nothing; a secret is never built in", () => {
  process.env.TALQAVA_TRELLO_CLIENT_ID = "talqava-public-key";
  process.env.TALQAVA_ASANA_CLIENT_ID = "ignored-because-asana-needs-a-secret";
  try {
    const byId = new Map(K.listServices().map((s) => [s.id, s]));
    assert.equal(byId.get("trello")!.browser!.oneClick, true);
    assert.equal(byId.get("asana")!.browser!.oneClick, false);
    assert.equal(new URL(K.startBrowserSignIn("trello", {}, redirect).url).searchParams.get("key"), "talqava-public-key");
    assert.throws(() => K.startBrowserSignIn("asana", {}, redirect), /client ID/);
  } finally {
    delete process.env.TALQAVA_TRELLO_CLIENT_ID;
    delete process.env.TALQAVA_ASANA_CLIENT_ID;
  }
});

test("Zendesk signs in at the account's own address with PKCE and no secret, and works with tickets", async () => {
  const z = K.listServices().find((s) => s.id === "zendesk")!;
  assert.deepEqual([z.fields.length, z.browser!.ask.map((f) => f.key), z.browser!.idLabel], [0, ["subdomain"], "Identifier"]);
  assert.throws(() => K.startBrowserSignIn("zendesk", { clientId: "talqava" }, redirect), /Zendesk subdomain/);
  assert.throws(() => K.startBrowserSignIn("zendesk", { clientId: "talqava", values: { subdomain: "evil.example.com/x" } }, redirect), /Zendesk subdomain/, "the subdomain cannot point the sign-in somewhere else");
  zendeskRole = "none";
  const first = new URL(K.startBrowserSignIn("zendesk", { clientId: "talqava", values: { subdomain: "Bakery" } }, redirect).url);
  assert.equal(first.origin + first.pathname, "https://bakery.zendesk.com/oauth/authorizations/new");
  assert.deepEqual([first.searchParams.get("scope"), first.searchParams.get("code_challenge_method")], ["read write", "S256"]);
  await assert.rejects(K.finishBrowserSignIn(first.searchParams.get("state"), "ok"), /not an agent or administrator/);
  zendeskRole = "agent";
  const to = new URL(K.startBrowserSignIn("zendesk", { clientId: "talqava", values: { subdomain: "bakery" } }, redirect).url);
  assert.equal((await K.finishBrowserSignIn(to.searchParams.get("state"), "ok")).label, "Ada Baker (bakery.zendesk.com)");
  const exchange = seen.filter((s) => s.path === "/zendesk/token" && s.body?.grant_type === "authorization_code").at(-1)!.body!;
  assert.deepEqual([exchange.client_id, exchange.client_secret, Boolean(exchange.code_verifier)], ["talqava", undefined, true]);
  const run = (name: string, input: Record<string, unknown> = {}) => tool(`zendesk__${name}`).run(input, {} as never) as Promise<string>;
  assert.equal(await run("list_tickets"), "[41] Late delivery · open · high · updated 2026-11-25");
  assert.match(seen.at(-1)!.query, /sort=-updated_at/);
  assert.equal(await run("search_tickets", { words: 'bread status:closed "x"', status: "open" }), "[41] Late delivery · open · high · updated 2026-11-25\n(2 in all)");
  assert.equal(new URLSearchParams(seen.at(-1)!.query).get("query"), "type:ticket status:open bread status closed x", "words cannot become search operators");
  const read = await run("get_ticket", { ticket: "#41" });
  assert.match(read, /Sam Customer · visible to the customer\nWhere is my bread\?/);
  assert.match(read, /Ada Baker · internal note\nDriver was late\./);
  assert.match(await run("add_note", { ticket: 41, note: "Refund offered." }), /internal note to ticket 41/);
  assert.deepEqual(seen.at(-1)!.json, { ticket: { comment: { body: "Refund offered.", public: false } } });
  assert.match(await run("reply_to_customer", { ticket: 41, reply: "Sorry! It is on its way.", status: "pending" }), /Replied to the customer on ticket 41.*Status: pending/);
  assert.deepEqual(seen.at(-1)!.json, { ticket: { comment: { body: "Sorry! It is on its way.", public: true }, status: "pending" } });
  assert.equal(tool("zendesk__reply_to_customer").needsApproval!({} as never), true, "a reply to a customer always asks first");
  await assert.rejects(run("update_ticket", { ticket: 41, status: "closed" }), /choose one of: open, pending, hold, solved/);
  assert.match(await run("update_ticket", { ticket: 41, priority: "low" }), /low/);
  await assert.rejects(run("create_ticket", { subject: "Order", message: "Two loaves", customer_email: "nope" }), /does not look right/);
  assert.match(await run("create_ticket", { subject: "Order", message: "Two loaves", customer_email: "Sam@Example.com" }), /Opened ticket 42: “Order” for sam@example.com/);
  await assert.rejects(run("get_ticket", { ticket: "41/../users" }), /ticket's number/);
});
