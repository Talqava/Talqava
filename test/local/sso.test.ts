// Single sign-on, against a stand-in identity provider that signs its answers like a real one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-sso-"));
let S: typeof import("../../src/local/sso.ts");
let P: typeof import("../../src/local/people.ts");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
let provider: http.Server;
let issuer = "";
let next: Record<string, unknown> = {};
let lastTokenRequest = new URLSearchParams();
const sign = (claims: Record<string, unknown>, key = privateKey, alg = "RS256") => {
  const head = Buffer.from(JSON.stringify({ alg, kid: "k1" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
};

before(async () => {
  S = await import("../../src/local/sso.ts");
  P = await import("../../src/local/people.ts");
  provider = http.createServer((req, res) => {
    const json = (v: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
    if (req.url === "/.well-known/openid-configuration") return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` });
    if (req.url === "/keys") return json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" }] });
    if (req.url === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      return req.on("end", () => ((lastTokenRequest = new URLSearchParams(body)), json({ id_token: sign(next) })));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
});
after(() => provider.close());

const begin = async () => {
  const to = new URL(await S.startSso("http://localhost:8788/api/sso/callback"));
  return { state: to.searchParams.get("state")!, nonce: to.searchParams.get("nonce")!, to };
};
const claims = (nonce: string, more: Record<string, unknown> = {}) => ({ iss: issuer, aud: "talqava-client", exp: Math.floor(Date.now() / 1000) + 300, nonce, email: "Ada@Example.com", email_verified: true, name: "Ada Lovelace", ...more });

test("setting it up checks the provider answers, and the secret is never shown again", async () => {
  await assert.rejects(S.setSso({ issuer: "http://example.com", clientId: "x" }), /https/);
  await assert.rejects(S.setSso({ issuer: `${issuer}/nope`, clientId: "x" }), /did not answer as an identity provider/);
  await assert.rejects(S.setSso({ issuer, clientId: "" }), /client ID/);
  const saved = await S.setSso({ issuer: `${issuer}/`, clientId: "talqava-client", clientSecret: "s3cret", domains: "@Example.com, nonsense", addPeople: false, role: "owner", only: false });
  assert.deepEqual(saved, { issuer, clientId: "talqava-client", clientSecret: undefined, hasSecret: true, domains: ["example.com"], addPeople: false, role: "member", only: false });
  await S.setSso({ issuer, clientId: "talqava-client", domains: ["example.com"] });
  assert.equal(S.sso()!.clientSecret, "s3cret", "saving again without a secret keeps the one there");
});

test("a person the provider vouches for is signed in; anything off about the provider's answer is refused", async () => {
  const owner = P.people.start({ name: "Ada", email: "ada@example.com", password: "correct horse battery" });
  let s = await begin();
  assert.equal(s.to.origin + s.to.pathname, `${issuer}/authorize`);
  assert.deepEqual([s.to.searchParams.get("client_id"), s.to.searchParams.get("scope"), s.to.searchParams.get("code_challenge_method")], ["talqava-client", "openid email profile", "S256"]);
  next = claims(s.nonce);
  const who = await S.finishSso("the-code", s.state);
  assert.deepEqual(who, { email: "ada@example.com", name: "Ada Lovelace" });
  assert.equal(lastTokenRequest.get("client_secret"), "s3cret");
  assert.equal(crypto.createHash("sha256").update(lastTokenRequest.get("code_verifier")!).digest("base64url"), s.to.searchParams.get("code_challenge"));
  const signed = P.people.signInBySso(who, "Test");
  assert.equal(signed.person.id, owner.id);
  assert.equal(P.people.who(signed.token)?.email, "ada@example.com");
  await assert.rejects(S.finishSso("the-code", s.state), /Start again/, "an answer cannot be used twice");
  await assert.rejects(S.finishSso("the-code", "made-up-state"), /Start again/);

  const cfg = S.sso()!;
  const bad = async (token: string, why: RegExp) => assert.rejects(S.checkIdToken(token, cfg, "n1"), why);
  const good = { iss: issuer, aud: "talqava-client", exp: Math.floor(Date.now() / 1000) + 300, nonce: "n1", email: "ada@example.com" };
  assert.deepEqual(await S.checkIdToken(sign(good), cfg, "n1"), { email: "ada@example.com", name: "ada" });
  await bad(sign(good, other.privateKey), /signature check/);
  await bad(sign({ ...good, iss: "https://evil.example" }), /different provider/);
  await bad(sign({ ...good, aud: "another-app" }), /different app/);
  await bad(sign({ ...good, exp: Math.floor(Date.now() / 1000) - 3600 }), /out of date/);
  await bad(sign({ ...good, nonce: "someone-else" }), /does not belong to this sign-in/);
  await bad(sign({ ...good, email: "ada@elsewhere.org" }), /domains this organization allows/);
  await bad(sign({ ...good, email_verified: false }), /not confirmed your email/);
  await bad(sign({ ...good, email: undefined }), /did not say what your email/);
  await bad(sign(good, privateKey, "none"), /does not accept/);
  await bad(sign(good, privateKey, "HS256"), /does not accept/);
  await bad(`${sign(good).split(".").slice(0, 2).join(".")}.`, /signature check/);
});

test("who gets in: only people already added, unless new people are let in; and passwords can be switched off", async () => {
  assert.throws(() => P.people.signInBySso({ email: "new@example.com", name: "New Person" }, "Test", null), /not been added to Talqava yet/);
  const added = P.people.signInBySso({ email: "new@example.com", name: "New Person" }, "Test", "member");
  assert.deepEqual([added.added, added.person.role, added.person.name], [true, "member", "New Person"]);
  assert.throws(() => P.people.signIn({ email: "new@example.com", password: "" }), /do not match/, "their password is a random one nobody knows");
  assert.throws(() => P.people.signInBySso({ email: "x@example.com", name: "X" }, "Test", "owner"), /not been added/);

  P.people.add({ name: "Bob", email: "bob@example.com", password: "bob's long password", role: "member" }, P.people.list()[0]);
  P.people.passwordsOff = () => true;
  assert.throws(() => P.people.signIn({ email: "bob@example.com", password: "bob's long password" }), /Sign in with your company account/);
  assert.ok("token" in P.people.signIn({ email: "ada@example.com", password: "correct horse battery" }), "the owner's password stays as the emergency way in");
  P.people.passwordsOff = null;
  assert.ok("token" in P.people.signIn({ email: "bob@example.com", password: "bob's long password" }));

  await S.setSso(null);
  assert.equal(S.sso(), null);
  await assert.rejects(S.startSso("http://localhost/x"), /not set up/);
});
