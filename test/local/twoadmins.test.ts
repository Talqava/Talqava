// Two administrators must agree: in the running app, a security change by one waits until a different one approves.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("a security change waits for a second administrator, who approves or declines it", { timeout: 90_000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../../src/local/main.ts")], { env: { ...process.env, PORT: String(port), TALQAVA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "talqava-two-admins-")), TALQAVA_GITHUB_API: "http://127.0.0.1:9" }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, route: string, body?: unknown, cookie = "") => {
    const res = await fetch(`${base}/api/${route}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), origin: base, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`${base}/api/login`).then((r) => r.ok, () => false);
    }
    assert.ok(up, "the app started");
    const ada = (await call("POST", "people/start", { name: "Ada", email: "ada@example.com", password: "correct horse battery" })).cookie;
    // With one administrator the rule cannot be switched on.
    assert.match((await call("PUT", "people/settings", { twoAdmins: true }, ada)).body.error, /at least two people/);
    assert.equal((await call("POST", "people", { name: "Bea", email: "bea@example.com", password: "bea's long password", role: "admin" }, ada)).status, 200);
    const bea = (await call("POST", "login", { email: "bea@example.com", password: "bea's long password" })).cookie;
    assert.equal((await call("PUT", "people/settings", { twoAdmins: true }, ada)).status, 200);

    // Ada asks to add someone: nothing happens yet.
    const asked = await call("POST", "people", { name: "Cy", email: "cy@example.com", password: "cy has a long one", role: "member" }, ada);
    assert.equal(asked.status, 202);
    assert.match(asked.body.message, /needs a second administrator/);
    assert.equal((await call("GET", "people", undefined, ada)).body.people.some((p: any) => p.email === "cy@example.com"), false);
    // The same request again keeps one waiting change; it never shows what it holds.
    await call("POST", "people", { name: "Cy", email: "cy@example.com", password: "cy has a long one", role: "member" }, ada);
    const list = (await call("GET", "security-ops/changes", undefined, bea)).body.changes;
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].by.name, list[0].summary], ["Ada", "Added a person: Cy as member"]);
    assert.equal(JSON.stringify(list).includes("cy has a long one"), false);

    // Ada cannot approve her own change; Bea can, and then it is done.
    assert.match((await call("POST", `security-ops/changes/${list[0].id}/approve`, {}, ada)).body.error, /different administrator/);
    assert.equal((await call("POST", `security-ops/changes/${list[0].id}/approve`, {}, bea)).status, 200);
    assert.equal((await call("GET", "people", undefined, ada)).body.people.some((p: any) => p.email === "cy@example.com"), true);
    assert.equal((await call("POST", "login", { email: "cy@example.com", password: "cy has a long one" })).status, 200, "the change was carried out with what Ada asked for");
    assert.equal((await call("GET", "security-ops/changes", undefined, bea)).body.changes.length, 0);
    assert.equal((await call("POST", `security-ops/changes/${list[0].id}/approve`, {}, bea)).status, 400, "an approved change cannot be approved again");

    // A declined change never happens. Switching the rule off needs both as well.
    const off = await call("PUT", "people/settings", { twoAdmins: false }, bea);
    assert.equal(off.status, 202);
    assert.equal((await call("POST", `security-ops/changes/${off.body.id}/decline`, {}, ada)).status, 200);
    assert.equal((await call("GET", "people", undefined, ada)).body.settings.twoAdmins, true);
    // A member can neither see nor approve waiting changes.
    const cy = (await call("POST", "login", { email: "cy@example.com", password: "cy has a long one" })).cookie;
    const again = await call("PUT", "people/settings", { twoAdmins: false }, bea);
    assert.equal((await call("POST", `security-ops/changes/${again.body.id}/approve`, {}, cy)).status, 403);

    const log = JSON.stringify((await call("GET", "audit", undefined, ada)).body);
    assert.match(log, /Asked for a security change that needs a second administrator/);
    assert.match(log, /Approved a security change asked for by another administrator/);
    assert.match(log, /Declined a security change/);
    assert.doesNotMatch(log, /cy has a long one/);
  } finally {
    child.kill();
  }
});
