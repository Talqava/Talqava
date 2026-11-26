// The request tool follows redirects by hand: a key meant for one site never travels to another, and an
// organization's approved sites hold for every hop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { httpTool } from "../../src/core/tools/http.ts";
import { webRules } from "../../src/core/tools/page.ts";

let first: http.Server;
let other: http.Server;
let a = "";
let b = "";
const atOther: { method: string; key: string; body: string }[] = [];
const atFirst: { path: string; method: string; key: string }[] = [];

before(async () => {
  other = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => (atOther.push({ method: req.method!, key: String(req.headers["x-api-key"] ?? ""), body: raw }), res.end("the other site")));
  });
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
  b = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  first = http.createServer((req, res) => {
    atFirst.push({ path: req.url!, method: req.method!, key: String(req.headers["x-api-key"] ?? "") });
    if (req.url === "/away") return (res.writeHead(302, { location: `${b}/landing` }), res.end());
    if (req.url === "/moved") return (res.writeHead(307, { location: "/here" }), res.end());
    if (req.url === "/loop") return (res.writeHead(302, { location: "/loop" }), res.end());
    res.end("the first site");
  });
  await new Promise<void>((r) => first.listen(0, "127.0.0.1", r));
  a = `http://127.0.0.1:${(first.address() as AddressInfo).port}`;
});
after(() => (first.close(), other.close(), (webRules.allowed = null)));
const tool = httpTool(() => ({ SHOP: { value: "s3cret-value", host: "127.0.0.1" } }) as never);
const run = (input: any) => tool.run(input, { conversation: { id: "t" }, signal: new AbortController().signal } as never) as Promise<string>;

test("a redirect to another site is followed without the key, the body or the method", async () => {
  const out = await run({ method: "POST", url: `${a}/away`, headers: { "x-api-key": "{{secret:SHOP}}" }, body: "private" });
  assert.match(out, /the other site/);
  assert.equal(atFirst.at(-1)!.key, "s3cret-value", "the first site got its key");
  assert.deepEqual(atOther.at(-1), { method: "GET", key: "", body: "" });
});

test("a redirect within the same site keeps the request as it was, and a loop ends", async () => {
  assert.match(await run({ method: "GET", url: `${a}/moved`, headers: { "x-api-key": "{{secret:SHOP}}" } }), /the first site/);
  assert.deepEqual(atFirst.at(-1), { path: "/here", method: "GET", key: "s3cret-value" });
  await assert.rejects(run({ method: "GET", url: `${a}/loop` }), /Too many redirects/);
});

test("with approved sites, a redirect that leaves them is not followed", async () => {
  const before = atOther.length;
  webRules.allowed = (host) => host === "127.0.0.1" && false;
  await assert.rejects(run({ method: "GET", url: `${a}/away` }), /not one of the sites this organization approves/);
  webRules.allowed = null;
  assert.equal(atOther.length, before);
});
