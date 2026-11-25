// Security: signing in with a password, and text taken from office files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// A data folder of this file's own, set before anything is loaded, so nothing here reads or writes the real one.
process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-security-"));

test("tags are stripped until none can form from the pieces", async () => {
  const { stripTags } = await import("../../src/local/library.ts");
  assert.equal(stripTags("<w:t>Hello</w:t> <b>there</b>"), "Hello there");
  for (const tricky of ["<scr<x>ipt>alert(1)</scr<x>ipt>", "<<b>script>alert(1)<</b>/script>", "<scr<script>ipt>x"]) assert.doesNotMatch(stripTags(tricky), /<\/?script/i);
  assert.equal(stripTags("a < b and c > d"), "a  d");
  assert.equal(stripTags("no tags"), "no tags");
});

test("with a password set, nothing is served without signing in, and only the right password signs in", { timeout: 60_000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../../src/local/main.ts")], {
    env: { ...process.env, PORT: String(port), TALQAVA_PASSWORD: "correct horse battery", TALQAVA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "talqava-signin-")), TALQAVA_GITHUB_API: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`${base}/api/state`).then(() => true, () => false);
    }
    assert.ok(up, "the app started");
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    const login = (password: string) => fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ password }) });
    assert.equal((await login("wrong")).status, 401);
    const ok = await login("correct horse battery");
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    assert.match(cookie, /_session=[a-f0-9]{64}$/);
    assert.doesNotMatch(cookie, /correct|horse/);
    assert.equal((await fetch(`${base}/api/state`, { headers: { cookie } })).status, 200);
    // A cookie that is nearly right, or of another length, is refused.
    assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: `${cookie.split("=")[0]}=abc` } })).status, 401);
  } finally {
    child.kill();
  }
});

test("the Security center says which protections are on and makes a report that claims no certificate", async () => {
  const { securityOverview, securityReport } = await import("../../src/local/securitycenter.ts");
  const o = securityOverview();
  assert.equal(o.of, o.protections.length);
  assert.ok(o.protections.every((p) => p.name && p.words && ["on", "partly", "off"].includes(p.state)));
  assert.ok(o.protections.filter((p) => p.state !== "on").every((p) => p.next), "anything not fully on says what to do");
  const report = securityReport(new Date("2026-11-26T00:00:00Z"));
  assert.match(report, /^# Talqava security settings report/);
  assert.match(report, /Made on 2026-11-26/);
  assert.match(report, /not a certificate/);
  assert.doesNotMatch(report, /SOC 2 compliant|certified/i);
});

test("find anything: one search across files, pages, tasks, chats and agents, in the running app", { timeout: 60_000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../../src/local/main.ts")], { env: { ...process.env, PORT: String(port), TALQAVA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "talqava-find-")), TALQAVA_GITHUB_API: "http://127.0.0.1:9", TALQAVA_PASSWORD: "" }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, route: string, body?: unknown) => (await fetch(`${base}/api/${route}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), origin: base }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`${base}/api/login`).then((r) => r.ok, () => false);
    }
    assert.ok(up);
    await call("POST", "workspace/pages", { kind: "doc", title: "Harbor Dental proposal", markdown: "A monthly service for two clinics." });
    await call("POST", "workspace/pages", { kind: "note", title: "Call notes", markdown: "Harbor wants one invoice a month." });
    await call("POST", "workspace/sheets", { title: "Harbor forecast" });
    await call("POST", "workspace/pages", { title: "Unrelated page", markdown: "Nothing to see." });
    const r = await call("GET", "find?q=harbor");
    const kinds = r.results.map((x: any) => `${x.kind}:${x.title}`).sort();
    assert.deepEqual(kinds, ["doc:Harbor Dental proposal", "note:Call notes", "sheet:Harbor forecast"]);
    assert.match(r.results.find((x: any) => x.kind === "note").note, /one invoice a month/);
    assert.deepEqual((await call("GET", "find?q=h")).results, [], "one letter is too little to search");
    assert.deepEqual((await call("GET", "find?q=zzzzqqq")).results, []);
  } finally {
    child.kill();
  }
});
