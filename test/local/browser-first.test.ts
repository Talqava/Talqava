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
const seen: { path: string; auth: string; body: Record<string, string> | null }[] = [];
const redirect = "http://localhost:8787/api/oauth/callback";

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ path: u.pathname, auth, body });
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
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of ["ASANA", "HUBSPOT", "TYPEFORM", "TRELLO"]) (process.env[`TALQAVA_${id}_API`] = `${url}/${id.toLowerCase()}`), (process.env[`TALQAVA_${id}_TOKEN_API`] = `${url}/${id.toLowerCase()}/token`);
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
