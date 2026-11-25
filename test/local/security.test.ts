// Security: signing in with a password, and text taken from office files.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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
  process.env.TALQAVA_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "talqava-center-"));
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
