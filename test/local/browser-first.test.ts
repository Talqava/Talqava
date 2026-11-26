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
let xeroOrgs: any[] = [];
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
      if (u.pathname.startsWith("/gitlab/")) {
        const issue = { id: 900, iid: 12, project_id: 5, title: "Checkout <b>fails</b>", description: "Card is refused.", state: "opened", labels: ["bug"], assignees: [{ name: "Ada Baker" }], author: { name: "Sam" }, web_url: "https://gitlab.example.com/shop/site/-/issues/12", created_at: "2026-11-24T08:00:00Z", updated_at: "2026-11-25T10:00:00Z", references: { full: "shop/site#12" } };
        const mr = { id: 901, iid: 3, project_id: 5, title: "Fix checkout", description: "Retries the card.", state: "opened", draft: true, source_branch: "fix", target_branch: "main", author: { name: "Sam" }, reviewers: [{ name: "Ada Baker" }], detailed_merge_status: "draft_status", web_url: "https://gitlab.example.com/shop/site/-/merge_requests/3", updated_at: "2026-11-25T11:00:00Z", references: { full: "shop/site!3" } };
        const sent = raw.startsWith("{") ? JSON.parse(raw) : {};
        const at = u.pathname.slice("/gitlab".length);
        if (at === "/user") return json(200, { id: 7, name: "Ada Baker", username: "ada" });
        if (at === "/projects") return json(200, [{ id: 5, path_with_namespace: "shop/site", description: "The shop" }]);
        if (at === "/issues" || at === "/projects/shop%2Fsite/issues") return req.method === "POST" ? (sent.title === "x".repeat(250) ? json(400, { message: { title: ["is too long"] } }) : json(201, { ...issue, iid: 13, title: sent.title, references: { full: "shop/site#13" } })) : json(200, [issue]);
        if (at === "/projects/shop%2Fsite/issues/12") return json(200, req.method === "PUT" ? { ...issue, state: sent.state_event === "close" ? "closed" : issue.state } : issue);
        if (at === "/projects/shop%2Fsite/issues/12/notes" || at === "/projects/5/merge_requests/3/notes") return req.method === "POST" ? json(201, { id: 1, body: sent.body }) : json(200, [{ system: true, body: "added label", author: { name: "Sam" }, created_at: "2026-11-24T08:01:00Z" }, { system: false, body: "Seen on Safari too.", author: { name: "Ada Baker" }, created_at: "2026-11-24T09:00:00Z" }]);
        if (at === "/merge_requests" || at === "/projects/5/merge_requests") return json(200, [mr]);
        if (at === "/projects/5/merge_requests/3") return json(200, mr);
        return json(404, { message: "404 Not found" });
      }
      if (u.pathname.startsWith("/xero/")) {
        const tenant = String(req.headers["xero-tenant-id"] ?? "");
        const at = u.pathname.slice("/xero".length);
        const inv = { InvoiceID: "11111111-2222-3333-4444-555555555555", InvoiceNumber: "INV-0042", Type: "ACCREC", Contact: { Name: "Corner Café" }, Date: "/Date(1795478400000+0000)/", DueDateString: "2026-12-24T00:00:00", Total: 1200.5, AmountDue: 200.5, AmountPaid: 1000, TotalTax: 100, CurrencyCode: "EUR", Status: "AUTHORISED", Reference: "PO 7", LineItems: [{ Description: "Bread, weekly", Quantity: 10, UnitAmount: 110.05, LineAmount: 1100.5, AccountCode: "200" }] };
        if (at === "/connections") return json(200, xeroOrgs);
        if (tenant !== "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") return json(403, { title: "Forbidden", status: 403, detail: "AuthenticationUnsuccessful" });
        const sent = raw.startsWith("{") ? JSON.parse(raw) : {};
        if (at === "/api.xro/2.0/Invoices" && req.method === "PUT") return sent.Invoices[0].LineItems[0].AccountCode === "999" ? json(400, { ErrorNumber: 10, Type: "ValidationException", Message: "A validation exception occurred", Elements: [{ ValidationErrors: [{ Message: "Account code '999' is not a valid code for this document." }] }] }) : json(200, { Invoices: [{ ...inv, ...sent.Invoices[0], InvoiceNumber: "INV-0043", Contact: { Name: "Corner Café" }, Total: 30, AmountDue: 30, Status: "DRAFT" }] });
        if (at === "/api.xro/2.0/Invoices") return json(200, { Invoices: [inv] });
        if (at === "/api.xro/2.0/Invoices/INV-0042" || at === `/api.xro/2.0/Invoices/${inv.InvoiceID}`) return json(200, { Invoices: [inv] });
        if (at === "/api.xro/2.0/Contacts") return req.method === "PUT" ? json(200, { Contacts: [{ ...sent.Contacts[0], ContactID: "99999999-2222-3333-4444-555555555555" }] }) : json(200, { Contacts: [{ ContactID: "88888888-2222-3333-4444-555555555555", Name: "Corner Café", EmailAddress: "hello@corner.example" }] });
        if (at === "/api.xro/2.0/Accounts") return json(200, { Accounts: [{ Code: "200", Name: "Sales", Type: "REVENUE" }] });
        if (at === "/api.xro/2.0/Reports/ProfitAndLoss") return json(200, { Reports: [{ ReportName: "Profit and Loss", ReportTitles: ["Profit and Loss", "Bakery", "1 November 2026 to 30 November 2026"], Rows: [{ RowType: "Header", Cells: [{ Value: "" }, { Value: "30 Nov 26" }] }, { RowType: "Section", Title: "Income", Rows: [{ RowType: "Row", Cells: [{ Value: "Sales" }, { Value: "5000.00" }] }, { RowType: "SummaryRow", Cells: [{ Value: "Total Income" }, { Value: "5000.00" }] }] }, { RowType: "Section", Title: "", Rows: [{ RowType: "Row", Cells: [{ Value: "Net Profit" }, { Value: "1200.00" }] }] }] }] });
        if (at === "/api.xro/2.0/Reports/BalanceSheet") return json(200, { Reports: [{ ReportName: "Balance Sheet", ReportTitles: ["Balance Sheet", "Bakery"], Rows: [{ RowType: "Section", Title: "Bank", Rows: [{ RowType: "Row", Cells: [{ Value: "Current account" }, { Value: "900.00" }] }] }] }] });
        return json(404, {});
      }
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
  for (const id of ["ASANA", "HUBSPOT", "TYPEFORM", "TRELLO", "ZENDESK", "GITLAB", "XERO"]) (process.env[`TALQAVA_${id}_API`] = `${url}/${id.toLowerCase()}`), (process.env[`TALQAVA_${id}_TOKEN_API`] = `${url}/${id.toLowerCase()}/token`);
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

test("GitLab signs in at the owner's own GitLab address with PKCE and no secret, renews with the same return address, and works with issues and merge requests", async () => {
  const g = K.listServices().find((s) => s.id === "gitlab")!;
  assert.deepEqual([g.fields.length, g.browser!.ask.map((f) => f.key), g.browser!.idLabel, g.browser!.secret], [0, ["host"], "Application ID", "optional"]);
  for (const bad of ["", "gitlab", "evil.example.com/x", "a.b:8080", "exa mple.com"]) assert.throws(() => K.startBrowserSignIn("gitlab", { clientId: "app", values: { host: bad } }, redirect), /GitLab address/, `refuses “${bad}”`);
  const to = new URL(K.startBrowserSignIn("gitlab", { clientId: "app", values: { host: "GitLab.Example.com" } }, redirect).url);
  assert.equal(to.origin + to.pathname, "https://gitlab.example.com/oauth/authorize");
  assert.deepEqual([to.searchParams.get("scope"), to.searchParams.get("code_challenge_method"), to.searchParams.get("redirect_uri")], ["api", "S256", redirect]);
  const c = await K.finishBrowserSignIn(to.searchParams.get("state"), "ok");
  assert.equal(c.label, "Ada Baker (@ada, gitlab.example.com)");
  const exchange = seen.filter((s) => s.path === "/gitlab/token").at(-1)!.body!;
  assert.deepEqual([exchange.client_id, exchange.client_secret, Boolean(exchange.code_verifier)], ["app", undefined, true]);

  // The stand-in's token lasts a second: the first use renews it, sending the return address as GitLab's examples do.
  assert.match(String(await tool("gitlab__list_projects").run({}, {} as never)), /^shop\/site \[5\] · The shop$/);
  const renew = seen.filter((s) => s.path === "/gitlab/token").at(-1)!.body!;
  assert.deepEqual([renew.grant_type, renew.redirect_uri, renew.client_secret], ["refresh_token", redirect, undefined]);

  const mine = String(await tool("gitlab__list_issues").run({}, {} as never));
  assert.equal(mine, "shop/site#12 · Checkout fails · opened · bug · for Ada Baker · updated 2026-11-25");
  assert.match(seen.at(-1)!.query, /scope=assigned_to_me&state=opened/);
  await tool("gitlab__list_issues").run({ project: "shop/site", labels: "bug, urgent" }, {} as never);
  assert.equal(seen.at(-1)!.path, "/gitlab/projects/shop%2Fsite/issues");
  assert.match(seen.at(-1)!.query, /scope=all.*labels=bug%2Curgent/);
  await assert.rejects(async () => tool("gitlab__list_issues").run({ project: "../admin" }, {} as never), /group\/project/);

  const one = String(await tool("gitlab__get_issue").run({ project: "shop/site", issue: "#12" }, {} as never));
  assert.match(one, /Card is refused\./);
  assert.match(one, /Ada Baker\nSeen on Safari too\./);
  assert.doesNotMatch(one, /added label/, "GitLab's own activity lines are left out");

  assert.match(String(await tool("gitlab__create_issue").run({ project: "shop/site", title: "Slow search", labels: ["bug"] }, {} as never)), /Opened shop\/site#13: “Slow search”/);
  assert.deepEqual(seen.at(-1)!.json, { title: "Slow search", labels: "bug" });
  await assert.rejects(async () => tool("gitlab__create_issue").run({ project: "shop/site", title: "x".repeat(400) }, {} as never), /title is too long/, "a refusal that names fields is said in words");
  await tool("gitlab__comment_on_issue").run({ project: "shop/site", issue: 12, comment: " Fixed in !3. " }, {} as never);
  assert.deepEqual([seen.at(-1)!.path, seen.at(-1)!.json], ["/gitlab/projects/shop%2Fsite/issues/12/notes", { body: "Fixed in !3." }]);
  assert.match(String(await tool("gitlab__update_issue").run({ project: "shop/site", issue: 12, state: "close", add_labels: "done" }, {} as never)), /· closed ·/);
  assert.deepEqual(seen.at(-1)!.json, { state_event: "close", add_labels: "done" });
  await assert.rejects(async () => tool("gitlab__update_issue").run({ project: "shop/site", issue: 12 }, {} as never), /Say what to change/);

  assert.equal(String(await tool("gitlab__list_merge_requests").run({ project: "5" }, {} as never)), "shop/site!3 · Fix checkout · opened · draft · fix → main · by Sam · updated 2026-11-25");
  assert.match(String(await tool("gitlab__get_merge_request").run({ project: 5, merge_request: "!3" }, {} as never)), /Merge status: draft_status\nReviewers: Ada Baker/);
  await tool("gitlab__comment_on_merge_request").run({ project: 5, merge_request: 3, comment: "Looks right." }, {} as never);
  assert.equal(seen.at(-1)!.path, "/gitlab/projects/5/merge_requests/3/notes");

  // A new issue in a project can start a task.
  const trigger = K.services().find((s) => s.id === "gitlab")!.triggers![0];
  const conn = { values: { access_token: "second", host: "gitlab.example.com" } } as never;
  assert.deepEqual(await trigger.list(conn, "shop/site"), ["12"]);
  assert.match((await trigger.describe(conn, "12", "shop/site")).title, /^Issue: Checkout fails$/);
  assert.equal(K.toolActionKind("gitlab__comment_on_issue"), "change");
});

test("Xero signs in with PKCE and no secret, remembers which organisation was allowed, and reads and drafts", async () => {
  const x = K.listServices().find((s) => s.id === "xero")!;
  assert.deepEqual([x.fields.length, x.browser!.secret, x.browser!.ask.length], [0, "never", 0]);
  const start = () => new URL(K.startBrowserSignIn("xero", { clientId: "xapp", clientSecret: "ignored" }, redirect).url);
  const to = start();
  assert.equal(to.origin + to.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(to.searchParams.get("scope"), "offline_access accounting.invoices accounting.contacts accounting.settings.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  // Signed in, but no organisation was allowed: nothing is connected.
  await assert.rejects(K.finishBrowserSignIn(to.searchParams.get("state"), "ok"), /no organisation was allowed/);
  xeroOrgs = [
    { tenantId: "00000000-bbbb-cccc-dddd-eeeeeeeeeeee", tenantType: "ORGANISATION", tenantName: "Old shop", updatedDateUtc: "2025-01-01T00:00:00" },
    { tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", tenantType: "ORGANISATION", tenantName: "Bakery Ltd", updatedDateUtc: "2026-11-26T10:00:00" },
    { tenantId: "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee", tenantType: "PRACTICEMANAGER", tenantName: "Practice", updatedDateUtc: "2026-11-27T10:00:00" },
  ];
  const c = await K.finishBrowserSignIn(start().searchParams.get("state"), "ok");
  assert.equal(c.label, "Bakery Ltd", "the organisation allowed most recently");
  const exchange = seen.filter((s) => s.path === "/xero/token").at(-1)!.body!;
  assert.deepEqual([exchange.client_id, exchange.client_secret, Boolean(exchange.code_verifier)], ["xapp", undefined, true]);

  const list = String(await tool("xero__list_invoices").run({ unpaid_only: true, words: "INV" }, {} as never));
  assert.equal(list, "INV-0042 · to Corner Café · 2026-11-24 · due 2026-12-24 · 1,200.50 EUR · 200.50 unpaid · authorised [11111111-2222-3333-4444-555555555555]");
  const q = new URLSearchParams(seen.at(-1)!.query);
  assert.deepEqual([q.get("where"), q.get("Statuses"), q.get("SearchTerm"), q.get("summaryOnly")], ['Type=="ACCREC" AND AmountDue>0', "AUTHORISED", "INV", "true"]);
  await tool("xero__list_invoices").run({ kind: "bills", status: "paid" }, {} as never);
  assert.deepEqual([new URLSearchParams(seen.at(-1)!.query).get("where"), new URLSearchParams(seen.at(-1)!.query).get("Statuses")], ['Type=="ACCPAY"', "PAID"]);
  await assert.rejects(async () => tool("xero__list_invoices").run({ status: "lost" }, {} as never), /choose one of: draft/);

  const one = String(await tool("xero__get_invoice").run({ invoice: "INV-0042" }, {} as never));
  assert.match(one, /Reference: PO 7\n- Bread, weekly · 10 × 110\.05 = 1,100\.50 · account 200\nTax: 100\.00 · Total: 1,200\.50 EUR · Paid: 1,000\.00/);
  await assert.rejects(async () => tool("xero__get_invoice").run({ invoice: "../Contacts" }, {} as never), /number or id/);

  assert.equal(String(await tool("xero__find_contacts").run({ words: "corner" }, {} as never)), "Corner Café · hello@corner.example [88888888-2222-3333-4444-555555555555]");
  assert.match(String(await tool("xero__create_contact").run({ name: "Mill & Sons", email: "mill@example.com" }, {} as never)), /Added the contact Mill & Sons \[99999999-/);
  assert.deepEqual(seen.at(-1)!.json, { Contacts: [{ Name: "Mill & Sons", EmailAddress: "mill@example.com" }] });

  // An invoice is only ever drafted, for a contact found first.
  const draft = { contact_id: "88888888-2222-3333-4444-555555555555", lines: [{ description: "Rolls", quantity: 3, unit_amount: 10, account_code: "200" }], due_date: "2026-12-30", reference: "PO 9" };
  assert.match(String(await tool("xero__draft_invoice").run(draft, {} as never)), /^Drafted INV-0043 · to Corner Café .* · draft \[.*\nIt is a draft: approve and send it in Xero\.$/);
  assert.deepEqual(seen.at(-1)!.json, { Invoices: [{ Type: "ACCREC", Status: "DRAFT", Contact: { ContactID: draft.contact_id }, LineItems: [{ Description: "Rolls", Quantity: 3, UnitAmount: 10, AccountCode: "200" }], DueDate: "2026-12-30", Reference: "PO 9" }] });
  await assert.rejects(async () => tool("xero__draft_invoice").run({ ...draft, contact_id: "Corner Café" }, {} as never), /from find_contacts/);
  await assert.rejects(async () => tool("xero__draft_invoice").run({ ...draft, lines: [{ description: "x", quantity: 0, unit_amount: 1 }] }, {} as never), /quantity above zero/);
  await assert.rejects(async () => tool("xero__draft_invoice").run({ ...draft, due_date: "next week" }, {} as never), /date like/);
  await assert.rejects(async () => tool("xero__draft_invoice").run({ ...draft, lines: [{ description: "x", quantity: 1, unit_amount: 1, account_code: "999" }] }, {} as never), /Account code '999' is not a valid code/, "Xero's own reason is passed on");

  assert.equal(String(await tool("xero__list_accounts").run({ type: "revenue" }, {} as never)), "200 · Sales · revenue");
  assert.equal(new URLSearchParams(seen.at(-1)!.query).get("where"), 'Status=="ACTIVE" AND Type=="REVENUE"');
  await assert.rejects(async () => tool("xero__list_accounts").run({ type: 'X" OR 1==1' }, {} as never), /one word/);
  assert.equal(String(await tool("xero__profit_and_loss").run({ from: "2026-11-01", to: "2026-11-30" }, {} as never)), "Profit and Loss · Bakery · 1 November 2026 to 30 November 2026\n | 30 Nov 26\nIncome\n  Sales | 5000.00\n  Total Income | 5000.00\nNet Profit | 1200.00");
  await assert.rejects(async () => tool("xero__profit_and_loss").run({ from: "2026-11-01" }, {} as never), /both/);
  assert.match(String(await tool("xero__balance_sheet").run({}, {} as never)), /Bank\n  Current account \| 900\.00/);

  const trigger = K.services().find((s) => s.id === "xero")!.triggers![0];
  const conn = { values: { access_token: "second", tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" } } as never;
  assert.deepEqual(await trigger.list(conn, ""), ["11111111-2222-3333-4444-555555555555"]);
  assert.equal((await trigger.describe(conn, "11111111-2222-3333-4444-555555555555", "")).title, "Invoice INV-0042 to Corner Café");
  await assert.rejects(trigger.describe(conn, "../x", ""), /not an invoice/);
});
