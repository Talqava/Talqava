// Directory sync: requests shaped as Microsoft Entra ID and Okta send them (per their documentation).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-scim-"));
const S = await import("../../src/local/scim.ts");
const { people } = await import("../../src/local/people.ts");
const base = "https://talqava.example.com/api/scim/v2";
const call = (method: string, where: string, body?: any) => {
  const [p, q = ""] = where.split("?");
  return S.handleScim(method, p.split("/").filter(Boolean), new URLSearchParams(q), body, base) as { status: number; body: any };
};
const owner = people.start({ name: "Ada Owner", email: "ada@example.com", password: "a long enough password" });

test("the directory signs in with a token that is shown once and kept only as a hash", () => {
  assert.equal(S.scimAuthorized("Bearer anything"), false, "off until it is switched on");
  const { token } = S.enableScim({ role: "owner" });
  assert.equal(S.scimSettings().role, "member", "the directory can never hand out the owner's role");
  assert.equal(S.scimAuthorized(`Bearer ${token}`), true);
  assert.equal(S.scimAuthorized(token), true, "a provider that sends the token alone is accepted");
  assert.equal(S.scimAuthorized("Bearer wrong"), false);
  assert.equal(S.scimAuthorized(undefined), false);
  assert.equal(fs.readFileSync(path.join(process.env.TALQAVA_DATA_DIR!, "config.json"), "utf8").includes(token), false);
  const again = S.enableScim({ role: "manager" });
  assert.equal(S.scimAuthorized(`Bearer ${token}`), false, "a new token retires the old one");
  assert.equal(S.scimAuthorized(`Bearer ${again.token}`), true);
});

test("Microsoft Entra ID: the connection test, creating, looking up, changing and switching a person off", () => {
  // The connection test looks for someone who does not exist and expects an empty list, not an error.
  const none = call("GET", 'Users?filter=userName eq "Test_User_00aa00aa-bb11-cc22-dd33-44ee44ee44ee"');
  assert.deepEqual([none.status, none.body.totalResults, none.body.Resources], [200, 0, []]);
  assert.equal(call("GET", "Users?filter=externalId eq jyoung").body.totalResults, 0, "an unquoted value is read too");
  assert.equal(call("GET", "Users?filter=title co x").status, 400);

  const made = call("POST", "Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"], externalId: "0a21f0f2", userName: "Sam.Lee@contoso.example", active: true, emails: [{ primary: true, type: "work", value: "sam.mail@contoso.example" }], meta: { resourceType: "User" }, name: { formatted: "Sam Lee", familyName: "Lee", givenName: "Sam" }, roles: [], title: null, manager: null });
  assert.equal(made.status, 201);
  const id = made.body.id;
  assert.deepEqual([made.body.userName, made.body.externalId, made.body.active, made.body.name.formatted, made.body.meta.location], ["sam.lee@contoso.example", "0a21f0f2", true, "Sam Lee", `${base}/Users/${id}`]);
  assert.equal(people.list().find((p) => p.id === id)!.role, "manager", "new people get the role set for the directory");
  assert.equal(call("POST", "Users", { userName: "sam.lee@contoso.example" }).status, 409);
  assert.equal(call("GET", 'Users?filter=userName eq "SAM.LEE@contoso.example"').body.Resources[0].id, id, "the look-up ignores letter case");
  assert.equal(call("GET", 'Users?filter=externalId eq "0a21f0f2"').body.totalResults, 1);

  // Changes arrive as PATCH, with capitalised operations and paths…
  const renamed = call("PATCH", `Users/${id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "name.familyName", value: "Leigh" }, { op: "Add", path: "nickName", value: "Sammy" }, { op: "Replace", path: 'emails[type eq "work"].value', value: "sam.leigh@contoso.example" }] });
  assert.deepEqual([renamed.status, renamed.body.displayName, renamed.body.userName], [200, "Sam Leigh", "sam.leigh@contoso.example"]);
  // …or, with Microsoft's newer behaviour, one object whose keys are dotted paths.
  assert.equal(call("PATCH", `Users/${id}`, { Operations: [{ op: "replace", value: { displayName: "Ignored for the parts below", "name.givenName": "Samuel", "name.familyName": "Leigh" } }] }).body.displayName, "Samuel Leigh");

  // Switching off: as text, as a true/false, and it takes effect at once.
  const session = people.signInBySso({ email: "sam.leigh@contoso.example", name: "x" });
  assert.ok(people.who(session.token));
  assert.equal(call("PATCH", `Users/${id}`, { Operations: [{ op: "Replace", path: "active", value: "False" }] }).body.active, false);
  assert.equal(people.who(session.token), null, "their session ended");
  assert.throws(() => people.signInBySso({ email: "sam.leigh@contoso.example", name: "x" }), /switched off by your organization/);
  assert.equal(call("GET", `Users/${id}`).body.active, false, "a switched-off person is still found");
  assert.equal(call("PATCH", `Users/${id}`, { Operations: [{ op: "replace", path: "active", value: true }] }).body.active, true);
  // A hard delete removes them.
  assert.equal(call("DELETE", `Users/${id}`).status, 204);
  assert.equal(call("GET", `Users/${id}`).status, 404);
  assert.equal(call("GET", `Users/${id}`).body.status, "404", "the status in an error is text, as the standard asks");
});

test("Okta: listing in pages, creating with its placeholder password, updating by PUT, and switching off without a path", () => {
  const first = call("GET", "Users?startIndex=1&count=2");
  assert.deepEqual([first.status, first.body.startIndex, typeof first.body.totalResults], [200, 1, "number"]);
  const made = call("POST", "Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "test.user@okta.local", name: { givenName: "Test", familyName: "User" }, emails: [{ primary: true, value: "test.user@okta.local", type: "work" }], displayName: "Test User", locale: "en-US", externalId: "00ujl29u0le5T6Aj10h7", groups: [], password: "1mz050nq", active: true });
  const id = made.body.id;
  assert.equal(made.status, 201);
  assert.throws(() => people.signIn({ email: "test.user@okta.local", password: "1mz050nq" }), /do not match/, "the placeholder password the provider sends is never a way in");
  const put = call("PUT", `Users/${id}`, { ...made.body, name: { givenName: "Tess", familyName: "User" }, displayName: "Tess User", active: false });
  assert.deepEqual([put.status, put.body.displayName, put.body.active], [200, "Tess User", false]);
  assert.equal(call("PATCH", `Users/${id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", value: { active: true } }] }).body.active, true);
  assert.equal(call("PATCH", `Users/${id}`, { Operations: [{ op: "replace", value: { active: false } }] }).body.active, false);
  assert.deepEqual([call("GET", "Groups?startIndex=1&count=100").body.totalResults, call("GET", "ServiceProviderConfig").body.patch.supported], [0, true]);
});

test("the owner's account is never changed by the directory", () => {
  assert.equal(call("PATCH", `Users/${owner.id}`, { Operations: [{ op: "replace", path: "active", value: false }] }).status, 403);
  assert.equal(call("DELETE", `Users/${owner.id}`).status, 403);
  assert.equal(people.list().find((p) => p.id === owner.id)!.active, true);
  S.disableScim();
  assert.equal(S.scimSettings().on, false);
});
