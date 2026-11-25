// People, roles and sign-in: passwords, the second step, lockout, sessions, and what each role may do.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type { Role } from "../../src/local/people.ts";
let P: typeof import("../../src/local/people.ts");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-people-"));

before(async () => {
  process.env.TALQAVA_DATA_DIR = dir;
  P = await import("../../src/local/people.ts");
});

test("the first account is the owner; passwords are stretched and never stored; wrong ones lock the account", () => {
  const { people } = P;
  assert.equal(people.enabled(), false);
  assert.throws(() => people.start({ name: "Ada", email: "ada@example.com", password: "short" }), /at least 12 characters/);
  assert.throws(() => people.start({ name: "Ada", email: "not-an-email", password: "correct horse battery" }), /email address/);
  const owner = people.start({ name: "Ada", email: " Ada@Example.com ", password: "correct horse battery" });
  assert.deepEqual([owner.role, owner.email, owner.secondStep], ["owner", "ada@example.com", false]);
  assert.throws(() => people.start({ name: "Eve", email: "eve@example.com", password: "another long password" }), /already set up/);
  const stored = fs.readFileSync(path.join(dir, "people.json"), "utf8");
  assert.doesNotMatch(stored, /correct horse/);
  assert.equal(fs.statSync(path.join(dir, "people.json")).mode & 0o077, 0, "only this user can read the file");

  // Signing in: the same message for a wrong password and an unknown email.
  assert.throws(() => people.signIn({ email: "ada@example.com", password: "wrong" }), /do not match/);
  assert.throws(() => people.signIn({ email: "nobody@example.com", password: "wrong" }), /do not match/);
  const ok = people.signIn({ email: "ADA@example.com", password: "correct horse battery" }, "Test browser");
  assert.ok("token" in ok && /^[a-f0-9]{64}$/.test(ok.token));
  const token = (ok as { token: string }).token;
  assert.equal(people.who(token)?.name, "Ada");
  assert.equal(people.who("0".repeat(64)), null);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "people.json"), "utf8"), new RegExp(token), "only a hash of the session is stored");

  // Five wrong passwords lock the account, even for the right password, until an administrator sets a new one.
  const bob = people.add({ name: "Bob", email: "bob@example.com", password: "bob's long password", role: "member" }, owner);
  for (let i = 0; i < P.MAX_FAILED; i++) assert.throws(() => people.signIn({ email: "bob@example.com", password: "guess" }), /do not match/);
  assert.throws(() => people.signIn({ email: "bob@example.com", password: "bob's long password" }), /Too many wrong passwords/);
  assert.equal(people.list().find((p) => p.id === bob.id)!.locked, true);
  people.setPassword(bob.id, "a brand new password", owner);
  assert.ok("token" in people.signIn({ email: "bob@example.com", password: "a brand new password" }));
});

test("the second step: a code from an authenticator app, checked against the standard", () => {
  const { people, codeAt } = P;
  // The published test value for this method (RFC 6238, SHA-1, the secret "12345678901234567890" at 59 seconds).
  assert.equal(codeAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082");
  const ada = people.list().find((p) => p.email === "ada@example.com")!;
  const setup = people.startSecondStep(ada.id);
  assert.match(setup.link, /^otpauth:\/\/totp\/Talqava:ada%40example\.com\?secret=[A-Z2-7]{32}&issuer=Talqava$/);
  const secret = setup.key.replace(/ /g, "");
  assert.throws(() => people.confirmSecondStep(ada.id, "000000"), /not right/);
  assert.equal(people.signIn({ email: "ada@example.com", password: "correct horse battery" }) && "token" in people.signIn({ email: "ada@example.com", password: "correct horse battery" }), true, "not on until confirmed");
  assert.equal(people.confirmSecondStep(ada.id, codeAt(secret)).secondStep, true);
  assert.deepEqual(people.signIn({ email: "ada@example.com", password: "correct horse battery" }), { needsCode: true });
  assert.throws(() => people.signIn({ email: "ada@example.com", password: "correct horse battery", code: "123456" }), /not right/);
  assert.ok("token" in people.signIn({ email: "ada@example.com", password: "correct horse battery", code: codeAt(secret) }));
  // A code from a minute and a half ago is too old.
  assert.throws(() => people.signIn({ email: "ada@example.com", password: "correct horse battery", code: codeAt(secret, Date.now() - 90_000) }), /not right/);

  // Requiring it for everyone: someone without it is told to set it up.
  people.setSettings({ requireSecondStep: true });
  const bob = people.signIn({ email: "bob@example.com", password: "a brand new password" });
  assert.equal("token" in bob && bob.setUpSecondStep, true);
  assert.equal(people.mustSetUpSecondStep(people.list().find((p) => p.email === "bob@example.com")!), true);
  people.setSettings({ requireSecondStep: false });
});

test("roles: who may do what, and the owner is protected", () => {
  const { people, mayDo } = P;
  const owner = people.list().find((p) => p.role === "owner")!;
  const admin = people.add({ name: "Cy", email: "cy@example.com", password: "cy has a long one", role: "admin" }, owner);
  const bob = people.list().find((p) => p.email === "bob@example.com")!;
  assert.throws(() => people.add({ name: "X", email: "bob@example.com", password: "long enough password" }, owner), /already signs in/);
  assert.throws(() => people.add({ name: "X", email: "x@example.com", password: "long enough password", role: "owner" }, owner), /one owner/);
  assert.throws(() => people.update(owner.id, { name: "Hacked" }, admin), /Only the owner/);
  assert.throws(() => people.setPassword(owner.id, "long enough password", admin), /Only the owner/);
  assert.throws(() => people.remove(owner.id, admin), /cannot be removed/);
  assert.throws(() => people.remove(admin.id, admin), /cannot remove yourself/);
  assert.throws(() => people.update(bob.id, { role: "owner" }, owner), /cannot be changed here/);
  assert.throws(() => people.setPassword(bob.id, "new long password!", bob, "not the current one"), /not your current password/);

  // A changed role ends that person's sessions, so it takes effect at once.
  const session = people.signIn({ email: "bob@example.com", password: "a brand new password" }) as { token: string };
  assert.equal(people.update(bob.id, { role: "auditor" }, admin).role, "auditor");
  assert.equal(people.who(session.token), null);

  const table: [Role, string, string, boolean][] = [
    ["owner", "PUT", "settings", true], ["admin", "POST", "people", true],
    ["manager", "PUT", "orgs", true], ["manager", "POST", "quests", true], ["manager", "PUT", "settings", false], ["manager", "POST", "integrations", false], ["manager", "POST", "gateway", false], ["manager", "POST", "people", false], ["manager", "GET", "audit", true],
    ["member", "POST", "quests", true], ["member", "PUT", "workspace", true], ["member", "PUT", "orgs", false], ["member", "POST", "marketplace", false], ["member", "PUT", "settings", false], ["member", "GET", "audit", false], ["member", "GET", "people", false], ["member", "GET", "work", true], ["member", "POST", "me", true],
    ["auditor", "GET", "audit", true], ["auditor", "GET", "people", true], ["auditor", "GET", "workspace", true], ["auditor", "POST", "quests", false], ["auditor", "DELETE", "workspace", false], ["auditor", "POST", "logout", true],
  ];
  for (const [role, method, area, want] of table) assert.equal(mayDo(role, method, area), want, `${role} ${method} ${area}`);

  // Sessions: an administrator sees them and can end them all but their own.
  const mine = people.signIn({ email: "cy@example.com", password: "cy has a long one" }) as { token: string };
  assert.ok(people.sessions().length >= 2);
  people.signEveryoneOut(mine.token);
  assert.deepEqual(people.sessions().map((s) => s.name), ["Cy"]);
  people.signOut(mine.token);
  assert.equal(people.who(mine.token), null);
});

test("in the running app: nothing without signing in, and a role's limits are enforced, not just hidden", { timeout: 90_000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../../src/local/main.ts")], { env: { ...process.env, PORT: String(port), TALQAVA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "talqava-people-app-")), TALQAVA_GITHUB_API: "http://127.0.0.1:9" }, stdio: "ignore" });
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
    // Before people are set up, this computer is trusted as before.
    assert.deepEqual((await call("GET", "login")).body, { people: false, password: false, sso: false, ssoOnly: false });
    assert.equal((await call("GET", "state")).status, 200);
    const start = await call("POST", "people/start", { name: "Ada", email: "ada@example.com", password: "correct horse battery" });
    assert.equal(start.status, 200);
    const owner = start.cookie;
    assert.match(owner, /_session=[a-f0-9]{64}$/);

    // From now on, nothing is served without a session.
    assert.equal((await call("GET", "state")).status, 401);
    assert.equal((await call("GET", "people")).status, 401);
    assert.equal((await call("POST", "people/start", { name: "Eve", email: "eve@example.com", password: "another long password" })).status, 401);
    assert.equal((await call("GET", "state", undefined, owner)).status, 200);
    assert.equal((await call("GET", "me", undefined, owner)).body.person.role, "owner");

    assert.equal((await call("POST", "people", { name: "Mel", email: "mel@example.com", password: "mel's long password", role: "member" }, owner)).status, 200);
    assert.equal((await call("POST", "people", { name: "Aud", email: "aud@example.com", password: "aud's long password", role: "auditor" }, owner)).status, 200);
    assert.equal((await call("POST", "login", { email: "mel@example.com", password: "nope" })).status, 401);
    const mel = (await call("POST", "login", { email: "mel@example.com", password: "mel's long password" })).cookie;
    const aud = (await call("POST", "login", { email: "aud@example.com", password: "aud's long password" })).cookie;

    // A member reads work but cannot change settings, see people or read the audit log.
    assert.equal((await call("GET", "work", undefined, mel)).status, 200);
    const refused = await call("PUT", "settings", { checkIn: false }, mel);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /Your role \(Member\) does not allow that/);
    assert.equal((await call("GET", "people", undefined, mel)).status, 403);
    assert.equal((await call("GET", "audit", undefined, mel)).status, 403);
    assert.equal((await call("POST", "people", { name: "Sneak", email: "s@example.com", password: "a long password here", role: "admin" }, mel)).status, 403);
    // An auditor reads everything and changes nothing.
    assert.equal((await call("GET", "audit", undefined, aud)).status, 200);
    assert.equal((await call("POST", "workspace/pages", { title: "Nope" }, aud)).status, 403);
    // The audit log names who did what, and never holds a password.
    const log = JSON.stringify((await call("GET", "audit", undefined, owner)).body);
    assert.match(log, /Added a person: Mel as member/);
    assert.match(log, /Ada \(Owner\)/);
    assert.match(log, /A sign-in was refused/);
    assert.doesNotMatch(log, /long password|correct horse/);

    // Signing out ends the session.
    assert.equal((await call("POST", "logout", {}, mel)).status, 200);
    assert.equal((await call("GET", "work", undefined, mel)).status, 401);
  } finally {
    child.kill();
  }
});

test("approved networks, and asking for the password again before sensitive changes", () => {
  const { people, inRanges, cleanRange } = P;
  assert.deepEqual(["203.0.113.0/24", "10.1.2.3", " 300.1.1.1 ", "10.0.0.0/40", "office"].map(cleanRange), ["203.0.113.0/24", "10.1.2.3/32", "", "", ""]);
  assert.equal(inRanges("203.0.113.77", ["203.0.113.0/24"]), true);
  assert.equal(inRanges("::ffff:203.0.113.77", ["203.0.113.0/24"]), true);
  assert.equal(inRanges("203.0.114.1", ["203.0.113.0/24"]), false);
  assert.equal(inRanges("10.1.2.3", ["10.1.2.3/32"]), true);
  assert.equal(inRanges("10.1.2.4", ["10.1.2.3/32"]), false);
  assert.equal(inRanges("127.0.0.1", ["203.0.113.0/24"]), true, "the computer itself is always allowed");
  assert.equal(inRanges("2001:db8::1", ["203.0.113.0/24"]), false);

  assert.deepEqual(people.setSettings({ networks: "203.0.113.0/24\nnonsense, 10.0.0.5" }).networks, ["203.0.113.0/24", "10.0.0.5/32"]);
  assert.throws(() => people.signIn({ email: "cy@example.com", password: "cy has a long one" }, "x", "198.51.100.9"), /approved networks/);
  const s = people.signIn({ email: "cy@example.com", password: "cy has a long one" }, "x", "203.0.113.9") as { token: string };
  assert.equal(people.networkAllowed("198.51.100.9"), false);
  assert.equal(people.networkAllowed("10.0.0.5"), true);
  people.setSettings({ networks: "" });
  assert.equal(people.networkAllowed("198.51.100.9"), true);

  // Just signed in counts as having proved who you are; later it must be proved again.
  assert.equal(people.confirmedRecently(s.token), true);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, "people.json"), "utf8"));
  stored.sessions.at(-1).confirmedAt = new Date(Date.now() - 11 * 60_000).toISOString();
  fs.writeFileSync(path.join(dir, "people.json"), JSON.stringify(stored));
  assert.equal(people.confirmedRecently(s.token), true, "the copy in use is not re-read from disk mid-run");
  assert.throws(() => people.confirm(s.token, "wrong", ""), /not your password/);
  assert.deepEqual(people.confirm(s.token, "cy has a long one", ""), { ok: true });
  people.setSettings({ askAgain: false });
  assert.equal(people.confirmedRecently(undefined), true);
  people.setSettings({ askAgain: true });
  assert.equal(people.confirmedRecently(undefined), false);
});
