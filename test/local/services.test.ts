// HubSpot, Mailchimp, Trello, Calendly and Typeform on the connector kit, against stand-ins that answer like them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-services-"));
let K: typeof import("../../src/local/connector-kit.ts");
let server: http.Server;
const seen: { method: string; path: string; auth: string; body: any }[] = [];
const contacts = new Map<string, any>([["1", { id: "1", properties: { firstname: "Sam", lastname: "Lee", email: "sam@example.com" }, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z" }]]);
const cards = new Map<string, any>([["card0001", { id: "card0001", name: "Bake rye", due: "2026-12-01T09:00:00.000Z", dueComplete: false, closed: false, idList: "list0001", desc: "Two loaves", shortUrl: "https://trello.com/c/x" }]]);
const members = new Map<string, any>();
const shop = { tokens: 0, orders: [{ id: "gid://shopify/Order/1001", name: "#1001", createdAt: "2026-11-25T10:00:00Z", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", email: "sam@example.com", totalPriceSet: { shopMoney: { amount: "19.50", currencyCode: "USD" } } }] as any[] };

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, path: u.pathname + u.search, auth, body });
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const [, svc, ...rest] = u.pathname.split("/");
      const p = `/${rest.join("/")}`;
      if (svc === "shopify") {
        if (p === "/admin/oauth/access_token") return (shop.tokens++, body.client_secret === "shh" && body.grant_type === "client_credentials" ? json(200, { access_token: `shpat-${shop.tokens}`, expires_in: 86399 }) : json(400, { error: "invalid_client" }));
        if (!/^shpat-\d+$/.test(String(req.headers["x-shopify-access-token"] ?? ""))) return json(401, { errors: "Invalid API key or access token" });
        const q = String(body.query);
        if (q.includes("shop {")) return json(200, { data: { shop: { name: "Ada's Bakery", myshopifyDomain: "adas-bakery.myshopify.com" } } });
        if (q.includes("productUpdate")) return body.variables.product.title === "" ? json(200, { data: { productUpdate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } } }) : json(200, { data: { productUpdate: { product: { id: body.variables.product.id, title: body.variables.product.title ?? "Rye loaf", status: body.variables.product.status ?? "ACTIVE", totalInventory: 4 }, userErrors: [] } } });
        if (q.includes("orders(first: 25")) return json(200, { data: { orders: { nodes: shop.orders.map((o) => ({ id: o.id })) } } });
        if (q.includes("order(id:")) return json(200, { data: { order: { ...shop.orders.find((o) => o.id === body.variables.id), lineItems: { nodes: [{ title: "Rye loaf", quantity: 2, sku: "RYE" }] } } } });
        if (q.includes("orders(")) return json(200, { data: { orders: { nodes: shop.orders } } });
        if (q.includes("customers(")) return json(200, { errors: [{ message: "Access denied for customers field. Required access: `read_customers` access scope." }] });
      }
      if (svc === "hubspot") {
        if (auth !== "Bearer pat-good") return json(401, { message: "Authentication credentials not found." });
        if (p === "/account-info/2026-09/details") return json(200, { portalId: 4242 });
        if (p === "/crm/objects/2026-09/contacts/search") return json(200, { results: [...contacts.values()].filter((c) => !body.query || JSON.stringify(c).toLowerCase().includes(body.query.toLowerCase())) });
        if (p === "/crm/objects/2026-09/contacts" && req.method === "POST") return (contacts.set("2", { id: "2", properties: body.properties }), json(201, contacts.get("2")));
        const m = /^\/crm\/objects\/2026-09\/contacts\/(.+)$/.exec(p);
        if (m && req.method === "PATCH") return (Object.assign(contacts.get(m[1]).properties, body.properties), json(200, contacts.get(m[1])));
        if (m) return json(200, u.searchParams.get("idProperty") === "email" ? [...contacts.values()].find((c) => c.properties.email === decodeURIComponent(m[1])) : contacts.get(m[1]));
      }
      if (svc === "mailchimp") {
        if (auth !== "Bearer key-us21") return json(401, { title: "API Key Invalid", detail: "Your API key may be invalid." });
        if (p === "/") return json(200, { account_name: "Ada's Bakery" });
        if (p === "/lists") return json(200, { lists: [{ id: "aud001", name: "Newsletter", stats: { member_count: 120 } }] });
        if (p === "/search-members") return json(200, { exact_matches: { members: [...members.values()].filter((m) => m.email_address === u.searchParams.get("query")) }, full_search: { members: [] } });
        const m = /^\/lists\/aud001\/members\/([a-f0-9]{32})$/.exec(p);
        if (m && req.method === "PUT") return (members.set(m[1], { email_address: body.email_address, status: body.status_if_new, full_name: `${body.merge_fields?.FNAME ?? ""} ${body.merge_fields?.LNAME ?? ""}`.trim(), tags: (body.tags ?? []).map((name: string) => ({ name })) }), json(200, members.get(m[1])));
        if (p === "/campaigns") return json(200, { campaigns: [{ id: "c1", status: "sent", send_time: "2026-11-10T09:00:00Z", emails_sent: 118, settings: { title: "November news" } }] });
      }
      if (svc === "trello") {
        if (auth !== 'OAuth oauth_consumer_key="tkey", oauth_token="ttoken"') return (res.writeHead(401), res.end("invalid key"));
        if (p === "/members/me") return json(200, { fullName: "Ada Baker", username: "ada" });
        if (p === "/members/me/boards") return json(200, [{ id: "board001", name: "Bakery" }]);
        if (p === "/boards/board001/lists") return json(200, [{ id: "list0001", name: "To do" }, { id: "list0002", name: "Done" }]);
        if (p === "/lists/list0001/cards") return json(200, [...cards.values()].filter((c) => c.idList === "list0001"));
        if (p === "/cards" && req.method === "POST") return (cards.set("card0002", { id: "card0002", name: u.searchParams.get("name"), idList: u.searchParams.get("idList"), closed: false }), json(200, cards.get("card0002")));
        const m = /^\/cards\/(\w+)$/.exec(p);
        if (m && req.method === "PUT") {
          const c = cards.get(m[1]);
          if (u.searchParams.get("idList")) c.idList = u.searchParams.get("idList");
          if (u.searchParams.get("dueComplete")) c.dueComplete = u.searchParams.get("dueComplete") === "true";
          return json(200, c);
        }
        if (m) return json(200, cards.get(m[1]));
      }
      if (svc === "calendly") {
        if (auth !== "Bearer cal-good") return json(401, { title: "Unauthenticated", message: "The access token is invalid" });
        if (p === "/users/me") return json(200, { resource: { uri: "https://api.calendly.com/users/U1", name: "Ada", email: "ada@example.com" } });
        if (p === "/scheduled_events") return json(200, { collection: [{ uri: "https://api.calendly.com/scheduled_events/EV123456", name: "Intro call", status: "active", start_time: "2026-12-02T15:00:00.000000Z", end_time: "2026-12-02T15:30:00.000000Z", invitees_counter: { total: 1 } }] });
        if (p === "/scheduled_events/EV123456") return json(200, { resource: { name: "Intro call", status: "active", start_time: "2026-12-02T15:00:00.000000Z", end_time: "2026-12-02T15:30:00.000000Z", location: { type: "zoom", join_url: "https://zoom.example/j/1" } } });
        if (p === "/scheduled_events/EV123456/invitees") return json(200, { collection: [{ name: "Sam Lee", email: "sam@example.com", status: "active", timezone: "America/Chicago", questions_and_answers: [{ question: "What would you like to discuss?", answer: "Wholesale <b>bread</b>" }] }] });
        if (p === "/event_types") return json(200, { collection: [{ name: "Intro call", duration: 30, scheduling_url: "https://calendly.com/ada/intro" }] });
      }
      if (svc === "typeform") {
        if (auth !== "Bearer tfp_good") return json(403, { code: "AUTHENTICATION_FAILED", description: "Authentication credentials not found on the Request Headers" });
        if (p === "/forms") return json(200, { total_items: 1, items: [{ id: "frm001", title: "Catering request", last_updated_at: "2026-11-20T10:00:00Z", _links: { display: "https://ada.typeform.com/to/frm001" } }] });
        if (p === "/forms/frm001") return json(200, { title: "Catering request", fields: [{ id: "q1", title: "Your name" }, { id: "q2", title: "What do you need?" }, { id: "q3", title: "Which breads?" }] });
        if (p === "/forms/frm001/responses") return json(200, { total_items: 1, items: [{ submitted_at: "2026-11-25T14:03:00Z", answers: [{ field: { id: "q1" }, type: "text", text: "Sam" }, { field: { id: "q2" }, type: "choice", choice: { label: "Lunch for 20" } }, { field: { id: "q3" }, type: "choices", choices: { labels: ["Rye", "Sourdough"] } }] }] });
      }
      if (svc === "pipedrive") {
        if (req.headers["x-api-token"] !== "pd-token-0123456789abcdef") return json(401, { success: false, error: "Invalid API token", error_info: "Please check developers.pipedrive.com" });
        const deal = { id: 7, title: "Bread for Corner Café", value: 1200, currency: "EUR", status: "open", stage_id: 2, person_id: 31, org_id: 5, update_time: "2026-11-25T10:00:00Z" };
        if (p === "/v1/users/me") return json(200, { success: true, data: { id: 1, name: "Ada Baker", company_name: "Bakery Ltd" } });
        if (p === "/v2/deals" && req.method === "GET") return json(200, { success: true, data: [deal], additional_data: { next_cursor: null } });
        if (p === "/v2/deals" && req.method === "POST") return json(201, { success: true, data: { ...deal, ...body, id: 8 } });
        if (p === "/v2/deals/7") return json(200, { success: true, data: req.method === "PATCH" ? { ...deal, ...body } : deal });
        if (p === "/v2/deals/search") return json(200, { success: true, data: { items: [{ result_score: 1, item: { id: 7, title: deal.title, value: 1200, currency: "EUR", status: "open", stage: { id: 2, name: "Proposal" } } }] } });
        if (p === "/v2/persons/search") return json(200, { success: true, data: { items: [{ item: { id: 31, name: "Sam Customer", emails: ["sam@corner.example"], organization: { name: "Corner Café" } } }] } });
        if (p === "/v2/persons") return json(201, { success: true, data: { id: 32, name: body.name } });
        if (p === "/v2/organizations/search") return json(200, { success: true, data: { items: [{ item: { id: 5, name: "Corner Café" } }] } });
        if (p === "/v2/organizations") return json(201, { success: true, data: { id: 6, name: body.name } });
        if (p === "/v1/notes" && req.method === "GET") return json(200, { success: true, data: [{ add_time: "2026-11-24 09:00:00", content: "<p>Wants <b>weekly</b> delivery</p>" }] });
        if (p === "/v1/notes") return json(201, { success: true, data: { id: 90 } });
        if (p === "/v2/activities") return json(201, { success: true, data: { id: 70, subject: body.subject } });
        if (p === "/v2/pipelines") return json(200, { success: true, data: [{ id: 1, name: "Sales" }] });
        if (p === "/v2/stages") return json(200, { success: true, data: [{ id: 1, name: "Lead", pipeline_id: 1 }, { id: 2, name: "Proposal", pipeline_id: 1 }] });
      }
      if (svc === "todoist") {
        if (auth !== "Bearer td-good") return json(401, { error: "Invalid token", error_tag: "UNAUTHORIZED", http_code: 401 });
        const task = { id: "6XGgmFVcrG5RRjVr", content: "Order flour", description: "Two sacks", project_id: "6Jf8VQXxpwv56VQ7", labels: ["shop"], priority: 4, due: { date: "2026-11-30", is_recurring: true }, checked: false, added_at: "2026-11-25T08:00:00Z" };
        if (p === "/user") return json(200, { id: "1234567", full_name: "Ada Baker", email: "ada@example.com" });
        if (p === "/projects") return json(200, { results: [{ id: "6Jf8VQXxpwv56VQ7", name: "Inbox", inbox_project: true }, { id: "6Jf8VQXxpwv56VQ8", name: "Bakery" }], next_cursor: null });
        if (p === "/tasks" && req.method === "GET") return json(200, { results: [task], next_cursor: null });
        if (p === "/tasks/filter") return json(200, { results: [task], next_cursor: null });
        if (p === "/tasks" && req.method === "POST") return json(200, { ...task, id: "7XGgmFVcrG5RRjVr", content: body.content, priority: body.priority ?? 1, labels: body.labels ?? [], due: body.due_date ? { date: body.due_date } : body.due_string ? { date: "2026-11-27T09:00:00" } : null });
        if (p === "/tasks/6XGgmFVcrG5RRjVr") return req.method === "DELETE" ? (res.writeHead(204), res.end()) : json(200, req.method === "POST" ? { ...task, ...(body.content ? { content: body.content } : {}), priority: body.priority ?? task.priority } : task);
        if (p === "/tasks/6XGgmFVcrG5RRjVr/close" || p === "/tasks/6XGgmFVcrG5RRjVr/reopen") return (res.writeHead(204), res.end());
        if (p === "/comments") return json(200, { id: "c1", content: body.content });
        return json(404, { error: "Task not found", error_tag: "NOT_FOUND", http_code: 404 });
      }
      if (svc === "jira") {
        if (auth !== `Basic ${Buffer.from("ada@example.com:jira-good").toString("base64")}`) return json(401, { errorMessages: ["Client must be authenticated to access this resource."] });
        const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
        const issue = { key: "SHOP-12", fields: { summary: "Checkout fails", status: { name: "To Do" }, issuetype: { name: "Bug" }, priority: { name: "High" }, assignee: { displayName: "Ada Baker" }, labels: ["web"], updated: "2026-11-25T10:00:00.000+0000", reporter: { displayName: "Sam" }, description: { version: 1, type: "doc", content: [para("Card is refused."), { type: "bulletList", content: [{ type: "listItem", content: [para("Safari")] }] }] } } };
        if (p === "/myself") return json(200, { accountId: "acc-1", displayName: "Ada Baker" });
        if (p === "/project/search") return json(200, { values: [{ key: "SHOP", name: "Web shop" }], isLast: true });
        if (p === "/search/jql") return json(200, { issues: [issue], isLast: true });
        if (p === "/issue" && req.method === "POST") return body.fields.issuetype.name === "Epic" ? json(400, { errorMessages: [], errors: { issuetype: "Specify a valid issue type" } }) : json(201, { id: "10013", key: "SHOP-13" });
        if (p === "/issue/SHOP-12" && req.method === "GET") return json(200, issue);
        if (p === "/issue/SHOP-12" || p === "/issue/SHOP-12/assignee") return (res.writeHead(204), res.end());
        if (p === "/issue/SHOP-12/comment") return req.method === "POST" ? json(201, { id: "1" }) : json(200, { comments: [{ created: "2026-11-25T09:00:00.000+0000", author: { displayName: "Sam" }, body: { type: "doc", content: [para("Still happening.")] } }] });
        if (p === "/issue/SHOP-12/transitions") return req.method === "POST" ? (res.writeHead(204), res.end()) : json(200, { transitions: [{ id: "21", name: "Start work", to: { name: "In Progress" } }, { id: "31", name: "Done", to: { name: "Done" } }] });
        return json(404, { errorMessages: ["Issue does not exist or you do not have permission to see it."], errors: {} });
      }
      if (svc === "clickup") {
        if (auth !== "pk_good" && auth !== "Bearer oauth-token") return json(401, { err: "Token invalid", ECODE: "OAUTH_025" });
        const task = { id: "86c0abc", name: "Order flour", status: { status: "to do" }, priority: { id: "1", priority: "urgent" }, due_date: "1795996800000", assignees: [{ id: 9, username: "Ada" }], list: { id: "901", name: "Shop" }, url: "https://app.clickup.com/t/86c0abc", text_content: "Two sacks" };
        if (p === "/user") return json(200, { user: { id: 9, username: "Ada", email: "ada@example.com" } });
        if (p === "/team") return json(200, { teams: [{ id: "55", name: "Bakery" }] });
        if (p === "/team/55/space") return json(200, { spaces: [{ id: "7", name: "Operations" }] });
        if (p === "/space/7/list") return json(200, { lists: [{ id: "901", name: "Shop" }] });
        if (p === "/space/7/folder") return json(200, { folders: [{ id: "3", name: "Suppliers", lists: [{ id: "902", name: "Orders" }] }] });
        if (p === "/list/901/task" && req.method === "GET") return json(200, { tasks: [task], last_page: true });
        if (p === "/team/55/task") return json(200, { tasks: [task] });
        if (p === "/list/901/task") return json(200, { ...task, id: "86c0new", name: body.name, priority: body.priority ? { priority: ["urgent", "high", "normal", "low"][body.priority - 1] } : null, due_date: body.due_date ? String(body.due_date) : null });
        if (p === "/task/86c0abc" && req.method === "PUT") return json(200, { ...task, status: { status: body.status ?? "to do" } });
        if (p === "/task/86c0abc") return json(200, task);
        if (p === "/task/86c0abc/comment") return req.method === "POST" ? json(200, { id: 1 }) : json(200, { comments: [{ comment_text: "Ordered.", user: { username: "Sam" }, date: "1795478400000" }] });
      }
      if (svc === "freshdesk") {
        if (auth !== `Basic ${Buffer.from("fd-key:X").toString("base64")}`) return json(401, { code: "invalid_credentials", message: "You have to be logged in to perform this action." });
        const ticket = { id: 41, subject: "Late delivery", description_text: "Where is my bread?", status: 2, priority: 3, tags: ["delivery"], requester: { name: "Sam Customer", email: "sam@example.com" }, updated_at: "2026-11-25T10:00:00Z" };
        if (p === "/agents/me") return json(200, { id: 7, contact: { name: "Ada Baker", email: "ada@example.com" } });
        if (p === "/tickets" && req.method === "GET") return json(200, [ticket]);
        if (p === "/tickets" && req.method === "POST") return body.email === "bad@example.com" ? json(400, { description: "Validation failed", errors: [{ field: "email", message: "It should be a valid email address", code: "invalid_value" }] }) : json(201, { ...ticket, id: 42, subject: body.subject });
        if (p === "/search/tickets") return json(200, { total: 3, results: [ticket] });
        if (p === "/tickets/41" && req.method === "GET") return json(200, ticket);
        if (p === "/tickets/41") return json(200, { ...ticket, ...body });
        if (p === "/tickets/41/conversations") return json(200, [{ incoming: true, private: false, body_text: "Still waiting.", created_at: "2026-11-25T09:00:00Z" }, { incoming: false, private: true, body_text: "Driver was late.", created_at: "2026-11-25T09:30:00Z" }]);
        if (p === "/tickets/41/notes" || p === "/tickets/41/reply") return json(201, { id: 5 });
      }
      if (svc === "brevo") {
        if (req.headers["api-key"] !== "xkeysib-0123456789abcdef0123") return json(401, { code: "unauthorized", message: "Key not found" });
        const person = { id: 12, email: "sam@example.com", attributes: { FIRSTNAME: "Sam", LASTNAME: "Customer" }, emailBlacklisted: false, listIds: [3], createdAt: "2026-11-20T10:00:00.000+00:00" };
        if (p === "/account") return json(200, { email: "ada@example.com", companyName: "Bakery Ltd" });
        if (p === "/contacts/lists") return json(200, { count: 1, lists: [{ id: 3, name: "Newsletter", uniqueSubscribers: 240 }] });
        if (p === "/contacts" && req.method === "GET") return json(200, { contacts: [person], count: 1 });
        if (p === "/contacts/lists/3/contacts") return json(200, { contacts: [person], count: 1 });
        if (p === "/contacts" && req.method === "POST") return json(201, { id: 13 });
        if (p === "/contacts/sam%40example.com" || p === "/contacts/12") return req.method === "PUT" ? (res.writeHead(204), res.end()) : json(200, person);
        if (p === "/emailCampaigns") return json(200, { count: 1, campaigns: [{ id: 8, name: "November news", subject: "Stollen is back", status: "sent", sentDate: "2026-11-18T09:00:00.000Z", statistics: { globalStats: { delivered: 200, uniqueViews: 90, uniqueClicks: 20, unsubscriptions: 1, hardBounces: 2, softBounces: 1 } } }] });
        return json(404, { code: "document_not_found", message: "Contact does not exist" });
      }
      json(404, { message: "No route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of ["SHOPIFY", "HUBSPOT", "MAILCHIMP", "TRELLO", "CALENDLY", "TYPEFORM", "PIPEDRIVE", "TODOIST", "JIRA", "CLICKUP", "FRESHDESK", "BREVO"]) process.env[`TALQAVA_${id}_API`] = `${url}/${id.toLowerCase()}`;
  K = await import("../../src/local/connector-kit.ts");
  await import("../../src/local/services/index.ts");
});
after(() => server.close());
const run = async (name: string, input: any = {}) => String(await K.serviceTools().find((t) => t.name === name)!.run(input, { conversation: { id: "t" }, signal: new AbortController().signal } as never));
const asks = (name: string) => K.serviceTools().find((t) => t.name === name)!.needsApproval({});

test("HubSpot: find, read, add and change contacts with a service key", async () => {
  await assert.rejects(K.connectService("hubspot", { values: { token: "pat-bad" } }), /HubSpot refused that: Authentication credentials not found/);
  assert.equal((await K.connectService("hubspot", { values: { token: "pat-good" } })).label, "Account 4242");
  assert.equal(await run("hubspot__search", { words: "sam" }), "[1] Sam Lee · email: sam@example.com");
  assert.match(await run("hubspot__get", { email: "sam@example.com" }), /\[1\] Sam Lee[\s\S]*last changed 2026-11-20/);
  assert.equal(asks("hubspot__search"), false);
  assert.equal(asks("hubspot__create"), true);
  assert.match(await run("hubspot__create", { kind: "contact", properties: { email: "kim@example.com", firstname: "Kim", "bad key!": "x" } }), /Added the contact: \[2\] Kim · email: kim@example.com/);
  assert.deepEqual(seen.at(-1)!.body, { properties: { email: "kim@example.com", firstname: "Kim" } }, "only plain property names are sent");
  assert.match(await run("hubspot__update", { kind: "contact", id: "1", properties: { phone: "555-0100" } }), /phone: 555-0100/);
});

test("Mailchimp: audiences, looking people up, and adding someone deliberately", async () => {
  await assert.rejects(K.connectService("mailchimp", { values: { key: "nope-us21" } }), /Mailchimp refused that: Your API key may be invalid/);
  assert.equal((await K.connectService("mailchimp", { values: { key: "key-us21" } })).label, "Ada's Bakery");
  assert.equal(await run("mailchimp__list_audiences"), "[aud001] Newsletter · 120 subscribed");
  await assert.rejects(run("mailchimp__save_person", { audience: "aud001", email: "not-an-email", status_if_new: "pending" }), /does not look right/);
  await assert.rejects(run("mailchimp__save_person", { audience: "aud001", email: "Sam@Example.com", status_if_new: "maybe" }), /choose one of: subscribed, pending, unsubscribed/);
  assert.equal(await run("mailchimp__save_person", { audience: "aud001", email: "Sam@Example.com", status_if_new: "pending", first_name: "Sam", tags: ["wholesale"] }), "Saved: sam@example.com · pending · Sam · tags: wholesale");
  assert.match(seen.at(-1)!.path, /\/members\/[a-f0-9]{32}$/);
  assert.equal(await run("mailchimp__find_people", { words: "sam@example.com" }), "sam@example.com · pending · Sam · tags: wholesale");
  assert.equal(await run("mailchimp__list_campaigns"), "[c1] November news · sent · sent 2026-11-10 · 118 emails");
});

test("Trello: boards, lists and cards, with the key in a header and never in the address", async () => {
  await assert.rejects(K.connectService("trello", { values: { key: "tkey", token: "wrong" } }), /Trello refused that/);
  assert.equal((await K.connectService("trello", { values: { key: "tkey", token: "ttoken" } })).label, "Ada Baker (@ada)");
  assert.equal(await run("trello__list_boards"), "[board001] Bakery");
  assert.equal(await run("trello__list_boards", { board: "board001" }), "[list0001] To do\n[list0002] Done");
  assert.equal(await run("trello__list_cards", { list: "list0001" }), "[card0001] Bake rye · due 2026-12-01");
  assert.match(await run("trello__get_card", { card: "card0001" }), /Two loaves/);
  assert.match(await run("trello__create_card", { list: "list0001", name: "Order flour" }), /Added the card “Order flour” \(card0002\)/);
  assert.match(await run("trello__update_card", { card: "card0001", move_to_list: "list0002", done: true }), /due 2026-12-01 \(done\)/);
  assert.equal(cards.get("card0001").idList, "list0002");
  await assert.rejects(run("trello__get_card", { card: "../members/me" }), /number in brackets/);
  assert.ok(seen.every((s) => !s.path.includes("ttoken")));
});

test("Calendly: booked meetings, who booked them, and booking links (reading only)", async () => {
  await assert.rejects(K.connectService("calendly", { values: { token: "bad" } }), /Calendly refused that: The access token is invalid/);
  assert.equal((await K.connectService("calendly", { values: { token: "cal-good" } })).label, "Ada (ada@example.com)");
  assert.equal(await run("calendly__list_meetings"), "[EV123456] 2026-12-02 15:00 to 15:30 UTC · Intro call · active · 1 invitee");
  assert.match(seen.at(-1)!.path, /user=https%3A%2F%2Fapi\.calendly\.com%2Fusers%2FU1/);
  assert.equal(await run("calendly__get_meeting", { meeting: "EV123456" }), "Intro call · 2026-12-02 15:00 to 15:30 UTC · active\nWhere: https://zoom.example/j/1\n- Sam Lee <sam@example.com> · active · America/Chicago\n    What would you like to discuss?: Wholesale bread");
  assert.equal(await run("calendly__list_booking_links"), "Intro call · 30 min · https://calendly.com/ada/intro");
  assert.ok(K.listServices().find((s) => s.id === "calendly")!.actions.every((a) => a.kind === "read"));
});

test("Typeform: forms and the answers people sent, with each question's words", async () => {
  await assert.rejects(K.connectService("typeform", { values: { token: "tfp_bad" } }), /Typeform refused that/);
  assert.equal((await K.connectService("typeform", { values: { token: "tfp_good" } })).label, "1 form");
  assert.equal(await run("typeform__list_forms"), "[frm001] Catering request · changed 2026-11-20 · https://ada.typeform.com/to/frm001");
  assert.equal(await run("typeform__read_answers", { form: "frm001" }), "Catering request: 1 response in all, showing 1.\n\nSent 2026-11-25 14:03\n- Your name: Sam\n- What do you need?: Lunch for 20\n- Which breads?: Rye, Sourdough");
});

test("Shopify: an app's ID and secret become a day-long token, orders and products are read, and mistakes are explained", async () => {
  await assert.rejects(K.connectService("shopify", { values: { shop: "not a shop!", client_id: "id", client_secret: "shh" } }), /first part of its myshopify\.com address/);
  await assert.rejects(K.connectService("shopify", { values: { shop: "adas-bakery", client_id: "id", client_secret: "wrong" } }), /client ID or secret is not accepted/);
  const c = await K.connectService("shopify", { values: { shop: "https://Adas-Bakery.myshopify.com/admin", client_id: "id", client_secret: "shh" } });
  assert.equal(c.label, "Ada's Bakery (adas-bakery.myshopify.com)");
  const before = shop.tokens;
  assert.equal(await run("shopify__list_orders", { words: "financial_status:paid" }), "[1001] #1001 · 2026-11-25 · paid / unfulfilled · 19.50 USD · sam@example.com");
  assert.deepEqual(seen.at(-1)!.body.variables, { n: 20, q: "financial_status:paid" });
  assert.equal(await run("shopify__get_order", { order: "1001" }), "[1001] #1001 · 2026-11-25 · paid / unfulfilled · 19.50 USD · sam@example.com\nItems:\n- 2 × Rye loaf (SKU RYE)");
  assert.equal(shop.tokens, before, "the token is fetched once and kept, not asked for on every call");
  await assert.rejects(run("shopify__get_order", { order: "1001) { id } evil" }), /number in brackets/);
  assert.match(await run("shopify__update_product", { product: "55", title: "Dark rye", status: "DRAFT" }), /Updated: \[55\] Dark rye · draft · 4 in stock/);
  assert.deepEqual(seen.at(-1)!.body.variables.product, { id: "gid://shopify/Product/55", title: "Dark rye", status: "DRAFT" });
  await assert.rejects(run("shopify__find_customers", { words: "sam" }), /the app lacks a permission.*read_customers.*add the scope/s);
  // A new order starts a task through a watch.
  const w = await K.addWatch({ connection: c.id, trigger: "new_order", bot: "cashier", org: "o1", instructions: "Thank the customer." });
  shop.orders.unshift({ ...shop.orders[0], id: "gid://shopify/Order/1002", name: "#1002" });
  const started: any[] = [];
  assert.equal(await K.pollWatches((h) => started.push(h)), 1);
  assert.match(started[0].text, /\[1002\] #1002/);
  K.removeWatch(w.id);
});

test("Pipedrive: deals, people, organizations, notes and activities with a personal token", async () => {
  await assert.rejects(K.connectService("pipedrive", { values: { domain: "bakery", api_token: "short" } }), /does not look like a Pipedrive API token/);
  await assert.rejects(K.connectService("pipedrive", { values: { domain: "evil.example.com/x", api_token: "pd-token-0123456789abcdef" } }), /company domain/);
  await assert.rejects(K.connectService("pipedrive", { values: { domain: "bakery", api_token: "pd-token-wrong-0123456789" } }), /Pipedrive refused that: Invalid API token/);
  const c = await K.connectService("pipedrive", { values: { domain: "https://Bakery.pipedrive.com/", api_token: "pd-token-0123456789abcdef" }, rule: "auto" });
  assert.equal(c.label, "Ada Baker (Bakery Ltd)");

  assert.equal(await run("pipedrive__list_deals"), "[7] Bread for Corner Café · 1,200 EUR · open · stage 2 · updated 2026-11-25");
  assert.match(seen.at(-1)!.path, /status=open&sort_by=update_time&sort_direction=desc&limit=25/);
  assert.equal(await run("pipedrive__search_deals", { words: "bread" }), "[7] Bread for Corner Café · 1,200 EUR · open · stage Proposal");
  await assert.rejects(run("pipedrive__search_deals", { words: "b" }), /two letters/);
  assert.match(await run("pipedrive__get_deal", { deal: "7" }), /person 31 · organization 5\n\n2026-11-24 · Wants weekly delivery/);
  assert.match(await run("pipedrive__create_deal", { title: "Rolls for the school", value: 300, currency: "eur", person: 31 }), /^Added deal \[8\] Rolls for the school · 300 EUR/);
  assert.deepEqual(seen.at(-1)!.body, { title: "Rolls for the school", value: 300, currency: "EUR", person_id: 31 });
  assert.match(await run("pipedrive__update_deal", { deal: 7, status: "lost", lost_reason: "Price" }), /· lost ·/);
  assert.deepEqual([seen.at(-1)!.method, seen.at(-1)!.body], ["PATCH", { status: "lost", lost_reason: "Price" }]);
  await assert.rejects(run("pipedrive__update_deal", { deal: 7 }), /Say what to change/);
  assert.equal(await run("pipedrive__find_people", { words: "sam" }), "[31] Sam Customer · sam@corner.example · Corner Café");
  await run("pipedrive__create_person", { name: "Lee", email: "lee@example.com", organization: 5 });
  assert.deepEqual(seen.at(-1)!.body, { name: "Lee", emails: [{ value: "lee@example.com", primary: true, label: "work" }], org_id: 5 });
  assert.equal(await run("pipedrive__find_organizations", { words: "corner" }), "[5] Corner Café");
  assert.match(await run("pipedrive__create_organization", { name: "Mill & Sons" }), /\[6\] Mill & Sons/);
  assert.equal(await run("pipedrive__add_note", { note: "Call <b>back</b>\nMonday", deal: 7 }), "Added the note to deal 7.");
  assert.deepEqual(seen.at(-1)!.body, { content: "Call &lt;b&gt;back&lt;/b&gt;<br>Monday", deal_id: 7 }, "a note is plain text, never markup of its own");
  await assert.rejects(run("pipedrive__add_note", { note: "x", deal: 7, person: 31 }), /one deal, one person or one organization/);
  assert.equal(await run("pipedrive__add_activity", { subject: "Call Sam", type: "call", due_date: "2026-11-30", deal: 7 }), "Planned “Call Sam” for 2026-11-30 [70].");
  await assert.rejects(run("pipedrive__add_activity", { subject: "x", due_date: "soon" }), /date like/);
  assert.equal(await run("pipedrive__list_stages"), "Sales\n  [1] Lead\n  [2] Proposal");
  const trigger = K.services().find((s) => s.id === "pipedrive")!.triggers![0];
  const conn = { values: { domain: "bakery", api_token: "pd-token-0123456789abcdef" } } as never;
  assert.deepEqual(await trigger.list(conn, ""), ["7"]);
  assert.equal((await trigger.describe(conn, "7", "")).title, "Deal: Bread for Corner Café");
});

test("Todoist: to-dos with the personal token, or a browser sign-in with the owner's own app", async () => {
  const t = K.listServices().find((s) => s.id === "todoist")!;
  assert.ok(t.browser && t.fields.length === 1, "the browser first, the token second");
  const to = new URL(K.startBrowserSignIn("todoist", { clientId: "tapp", clientSecret: "shh" }, "http://localhost:8787/api/oauth/callback").url);
  assert.deepEqual([to.origin + to.pathname, to.searchParams.get("scope"), to.searchParams.get("code_challenge")], ["https://app.todoist.com/oauth/authorize", "data:read_write", null]);
  assert.throws(() => K.startBrowserSignIn("todoist", { clientId: "tapp" }, "http://localhost:8787/api/oauth/callback"), /client secret/);

  await assert.rejects(K.connectService("todoist", { values: { token: "bad" } }), /Todoist refused that: Invalid token/);
  assert.equal((await K.connectService("todoist", { values: { token: "td-good" }, rule: "auto" })).label, "Ada Baker (ada@example.com)");
  assert.equal(await run("todoist__list_projects"), "[6Jf8VQXxpwv56VQ7] Inbox (Inbox)\n[6Jf8VQXxpwv56VQ8] Bakery");
  assert.equal(await run("todoist__list_tasks", { project: "6Jf8VQXxpwv56VQ7" }), "[6XGgmFVcrG5RRjVr] Order flour · due 2026-11-30 (repeats) · urgent · shop");
  await run("todoist__list_tasks", { filter: "today | overdue" });
  assert.match(seen.at(-1)!.path, /^\/todoist\/tasks\/filter\?query=today\+%7C\+overdue&limit=100$/);
  await assert.rejects(run("todoist__list_tasks", { project: "../user" }), /project's id/);
  assert.match(await run("todoist__get_task", { task: "6XGgmFVcrG5RRjVr" }), /added 2026-11-25\n\nTwo sacks/);

  assert.match(await run("todoist__add_task", { name: "Call the mill", due: "2026-12-01", urgency: "urgent", labels: "shop, calls" }), /^Added \[7XGgmFVcrG5RRjVr\] Call the mill · due 2026-12-01 · urgent · shop, calls$/);
  assert.deepEqual(seen.at(-1)!.body, { content: "Call the mill", due_date: "2026-12-01", priority: 4, labels: ["shop", "calls"] });
  await run("todoist__add_task", { name: "Open up", due: "tomorrow at 9" });
  assert.deepEqual(seen.at(-1)!.body, { content: "Open up", due_string: "tomorrow at 9" }, "a due day in words is passed on as words");
  await assert.rejects(run("todoist__add_task", { name: "x", urgency: "p1" }), /choose one of: normal/);
  await run("todoist__update_task", { task: "6XGgmFVcrG5RRjVr", urgency: "normal" });
  assert.deepEqual([seen.at(-1)!.method, seen.at(-1)!.body], ["POST", { priority: 1 }]);
  await assert.rejects(run("todoist__update_task", { task: "6XGgmFVcrG5RRjVr" }), /Say what to change/);
  assert.equal(await run("todoist__complete_task", { task: "6XGgmFVcrG5RRjVr" }), "Ticked off to-do 6XGgmFVcrG5RRjVr.");
  assert.equal(await run("todoist__reopen_task", { task: "6XGgmFVcrG5RRjVr" }), "Opened to-do 6XGgmFVcrG5RRjVr again.");
  await run("todoist__comment_on_task", { task: "6XGgmFVcrG5RRjVr", comment: "Ordered." });
  assert.deepEqual(seen.at(-1)!.body, { task_id: "6XGgmFVcrG5RRjVr", content: "Ordered." });
  // Deleting asks the owner even when changes need no asking.
  assert.equal(asks("todoist__delete_task"), true);
  assert.equal(asks("todoist__complete_task"), false);
  assert.equal(K.toolActionKind("todoist__delete_task"), "delete");
});

test("Jira: issues with an email and API token; text goes in and comes out of Atlassian's document format", async () => {
  await assert.rejects(K.connectService("jira", { values: { site: "bakery", email: "not-an-email", token: "x" } }), /email you sign in/);
  await assert.rejects(K.connectService("jira", { values: { site: "evil.example.com/x", email: "ada@example.com", token: "jira-good" } }), /Jira site/);
  await assert.rejects(K.connectService("jira", { values: { site: "bakery", email: "ada@example.com", token: "wrong" } }), /Jira refused that/);
  const c = await K.connectService("jira", { values: { site: "https://Bakery.atlassian.net/jira", email: "ada@example.com", token: "jira-good" }, rule: "auto" });
  assert.equal(c.label, "Ada Baker (bakery.atlassian.net)");

  assert.equal(await run("jira__list_projects"), "SHOP · Web shop");
  const row = "SHOP-12 · Checkout fails · To Do · Bug · High · for Ada Baker · web · updated 2026-11-25";
  assert.equal(await run("jira__find_issues", { project: "shop", words: 'pay" OR project = SECRET', mine: true, open_only: true }), row);
  assert.deepEqual(seen.at(-1)!.body, { jql: 'project = "SHOP" AND text ~ "pay OR project = SECRET" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', maxResults: 25, fields: ["summary", "status", "assignee", "priority", "issuetype", "updated", "labels"] });
  await assert.rejects(run("jira__find_issues", {}), /Narrow the search/);
  await assert.rejects(run("jira__find_issues", { project: "SHOP OR 1=1" }), /project's key/);

  const one = await run("jira__get_issue", { issue: "shop-12" });
  assert.match(one, /Opened by Sam\nCan be moved to: Start work, Done\n\nCard is refused\.\nSafari\n\n2026-11-25 09:00 · Sam\nStill happening\./);
  await assert.rejects(run("jira__get_issue", { issue: "../myself" }), /issue's key/);

  assert.equal(await run("jira__create_issue", { project: "SHOP", summary: "Slow search", description: "First line\nsecond line\n\nNew paragraph", labels: "web, needs triage" }), "Opened SHOP-13: “Slow search”. https://bakery.atlassian.net/browse/SHOP-13");
  assert.deepEqual(seen.at(-1)!.body.fields, {
    project: { key: "SHOP" },
    issuetype: { name: "Task" },
    summary: "Slow search",
    description: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "second line" }] }, { type: "paragraph", content: [{ type: "text", text: "New paragraph" }] }] },
    labels: ["web", "needs-triage"],
  });
  await assert.rejects(run("jira__create_issue", { project: "SHOP", summary: "x", type: "Epic" }), /Jira answered 400: issuetype: Specify a valid issue type/);
  await run("jira__comment_on_issue", { issue: "SHOP-12", comment: "Fixed." });
  assert.deepEqual(seen.at(-1)!.body, { body: { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fixed." }] }] } });

  assert.equal(await run("jira__move_issue", { issue: "SHOP-12", to: "in progress" }), "Moved SHOP-12 to In Progress.");
  assert.deepEqual(seen.at(-1)!.body, { transition: { id: "21" } });
  await assert.rejects(run("jira__move_issue", { issue: "SHOP-12", to: "Shipped" }), /cannot be moved to “Shipped”.*Start work, Done/);
  assert.equal(await run("jira__update_issue", { issue: "SHOP-12", add_labels: "urgent", remove_labels: "web", assign_to_me: true }), "Updated SHOP-12; it is now assigned to you.");
  assert.deepEqual(seen.at(-2)!.body, { update: { labels: [{ add: "urgent" }, { remove: "web" }] } });
  assert.deepEqual([seen.at(-1)!.path, seen.at(-1)!.body], ["/jira/issue/SHOP-12/assignee", { accountId: "acc-1" }]);
  await assert.rejects(run("jira__update_issue", { issue: "SHOP-12" }), /Say what to change/);

  const trigger = K.services().find((s) => s.id === "jira")!.triggers![0];
  const conn = { values: { site: "bakery", email: "ada@example.com", token: "jira-good" } } as never;
  assert.deepEqual(await trigger.list(conn, "shop"), ["SHOP-12"]);
  assert.equal((await trigger.describe(conn, "SHOP-12", "shop")).title, "Issue SHOP-12: Checkout fails");
});

test("ClickUp: tasks with a personal token sent as it is, or a browser sign-in whose token is sent as Bearer", async () => {
  const cu = K.listServices().find((s) => s.id === "clickup")!;
  assert.ok(cu.browser && cu.fields.length === 1);
  const to = new URL(K.startBrowserSignIn("clickup", { clientId: "capp", clientSecret: "shh" }, "http://localhost:8787/api/oauth/callback").url);
  assert.deepEqual([to.origin + to.pathname, to.searchParams.get("client_id"), to.searchParams.get("code_challenge")], ["https://app.clickup.com/api", "capp", null]);

  await assert.rejects(K.connectService("clickup", { values: { token: "pk_bad" } }), /ClickUp refused that: Token invalid/);
  assert.equal((await K.connectService("clickup", { values: { token: "pk_good" }, rule: "auto" })).label, "Ada (Bakery)");
  assert.equal(seen.at(-1)!.auth, "pk_good", "a personal token is sent without Bearer");
  assert.equal(await run("clickup__list_lists"), "Operations\n  [901] Shop\n  Suppliers/\n    [902] Orders");
  const row = "[86c0abc] Order flour · to do · urgent · due 2026-11-30 · for Ada · in Shop";
  assert.equal(await run("clickup__list_tasks", { list: "901" }), row);
  assert.equal(seen.at(-1)!.path, "/clickup/list/901/task?page=0");
  assert.equal(await run("clickup__my_tasks"), row);
  assert.equal(seen.at(-1)!.path, "/clickup/team/55/task?assignees%5B%5D=9&order_by=updated&page=0");
  await assert.rejects(run("clickup__list_tasks", { list: "../user" }), /list's id/);
  assert.match(await run("clickup__get_task", { task: "86c0abc" }), /https:\/\/app\.clickup\.com\/t\/86c0abc\n\nTwo sacks\n\n2026-11-24 · Sam\nOrdered\./);
  assert.match(await run("clickup__add_task", { list: "901", name: "Call the mill", urgency: "high", due: "2026-12-01", description: "About **rye**" }), /^Added \[86c0new\] Call the mill · to do · high · due 2026-12-01/);
  assert.deepEqual(seen.at(-1)!.body, { name: "Call the mill", markdown_content: "About **rye**", priority: 2, due_date: Date.parse("2026-12-01T12:00:00Z") });
  await assert.rejects(run("clickup__add_task", { list: "901", name: "x", due: "friday" }), /date like/);
  assert.match(await run("clickup__update_task", { task: "86c0abc", status: "done" }), /· done ·/);
  await assert.rejects(run("clickup__update_task", { task: "86c0abc" }), /Say what to change/);
  await run("clickup__comment_on_task", { task: "86c0abc", comment: "Done." });
  assert.deepEqual(seen.at(-1)!.body, { comment_text: "Done.", notify_all: false });
  const trigger = K.services().find((s) => s.id === "clickup")!.triggers![0];
  assert.deepEqual(await trigger.list({ values: { token: "oauth-token" } } as never, "901"), ["86c0abc"]);
  assert.equal(seen.at(-1)!.auth, "Bearer oauth-token");
});

test("Freshdesk: tickets with the agent's key; a reply to the customer always asks first", async () => {
  await assert.rejects(K.connectService("freshdesk", { values: { domain: "evil.example.com/x", api_key: "fd-key" } }), /helpdesk domain/);
  await assert.rejects(K.connectService("freshdesk", { values: { domain: "bakery", api_key: "wrong" } }), /Freshdesk refused that: You have to be logged in/);
  assert.equal((await K.connectService("freshdesk", { values: { domain: "Bakery.freshdesk.com", api_key: "fd-key" }, rule: "auto" })).label, "Ada Baker (bakery.freshdesk.com)");
  const row = "[41] Late delivery · open · high · from Sam Customer · updated 2026-11-25";
  assert.equal(await run("freshdesk__list_tickets", { since: "2026-09-01" }), row);
  assert.match(seen.at(-1)!.path, /updated_since=2026-09-01T00%3A00%3A00Z&order_by=updated_at&order_type=desc&include=requester&per_page=30/);
  assert.equal(await run("freshdesk__find_tickets", { status: "open", priority: "high", tag: "deliv'ery" }), `${row}\n(3 in all)`);
  assert.equal(new URLSearchParams(seen.at(-1)!.path.split("?")[1]).get("query"), `"status:2 AND priority:3 AND tag:'delivery'"`);
  await assert.rejects(run("freshdesk__find_tickets", {}), /Give a status/);
  const one = await run("freshdesk__get_ticket", { ticket: "#41" });
  assert.match(one, /Customer: sam@example\.com\nTags: delivery\n\nWhere is my bread\?\n\n2026-11-25 09:00 · the customer\nStill waiting\.\n\n2026-11-25 09:30 · private note\nDriver was late\./);
  await run("freshdesk__add_note", { ticket: 41, note: "Refund <offered>\nby phone" });
  assert.deepEqual([seen.at(-1)!.path, seen.at(-1)!.body], ["/freshdesk/tickets/41/notes", { body: "Refund &lt;offered&gt;<br>by phone", private: true }]);
  assert.equal(asks("freshdesk__reply_to_customer"), true, "even when changes need no asking");
  assert.equal(asks("freshdesk__add_note"), false);
  assert.equal(K.toolActionKind("freshdesk__reply_to_customer"), "send");
  assert.match(await run("freshdesk__update_ticket", { ticket: 41, status: "resolved", priority: "low" }), /· resolved · low ·/);
  assert.deepEqual(seen.at(-1)!.body, { status: 4, priority: 1 });
  await assert.rejects(run("freshdesk__update_ticket", { ticket: 41, status: "gone" }), /choose one of: open, pending, resolved, closed/);
  assert.equal(await run("freshdesk__create_ticket", { customer_email: "Lee@Example.com", subject: "Cake order", message: "Two cakes" }), "Opened ticket 42: “Cake order” for lee@example.com.");
  assert.deepEqual(seen.at(-1)!.body, { email: "lee@example.com", subject: "Cake order", description: "Two cakes", status: 2, priority: 1 });
  await assert.rejects(run("freshdesk__create_ticket", { customer_email: "bad@example.com", subject: "x", message: "y" }), /Freshdesk answered 400: email: It should be a valid email address/);
});

test("Brevo: contacts, lists and campaign results with a key; nothing is sent from here", async () => {
  await assert.rejects(K.connectService("brevo", { values: { api_key: "short" } }), /starts with xkeysib-/);
  await assert.rejects(K.connectService("brevo", { values: { api_key: "xkeysib-wrong-0123456789abc" } }), /Brevo refused that: Key not found/);
  assert.equal((await K.connectService("brevo", { values: { api_key: "xkeysib-0123456789abcdef0123" }, rule: "auto" })).label, "Bakery Ltd (ada@example.com)");
  assert.ok(!K.services().find((s) => s.id === "brevo")!.actions.some((a) => /send|campaign_create/.test(a.name)), "no action sends email");
  assert.equal(await run("brevo__list_lists"), "[3] Newsletter · 240 people");
  const row = "sam@example.com · Sam Customer · lists 3 · added 2026-11-20";
  assert.equal(await run("brevo__list_contacts"), row);
  assert.equal(await run("brevo__list_contacts", { list: "3" }), row);
  assert.equal(await run("brevo__get_contact", { email: "Sam@Example.com" }), row);
  assert.equal(seen.at(-1)!.path, "/brevo/contacts/sam%40example.com?identifierType=email_id");
  await assert.rejects(run("brevo__get_contact", { email: "../account" }), /email address/);
  assert.equal(await run("brevo__add_contact", { email: "lee@example.com", first_name: "Lee", lists: ["3"] }), "Saved the contact lee@example.com on list 3.");
  assert.deepEqual(seen.at(-1)!.body, { email: "lee@example.com", attributes: { FIRSTNAME: "Lee" }, listIds: [3], updateEnabled: true });
  assert.equal(await run("brevo__update_contact", { email: "sam@example.com", remove_from_lists: ["3"], unsubscribed: true }), "Updated the contact sam@example.com.");
  assert.deepEqual([seen.at(-1)!.method, seen.at(-1)!.body], ["PUT", { unlinkListIds: [3], emailBlacklisted: true }]);
  await assert.rejects(run("brevo__update_contact", { email: "sam@example.com" }), /Say what to change/);
  assert.equal(await run("brevo__list_campaigns"), "[8] November news · “Stollen is back” · sent · sent 2026-11-18 · delivered 200 · opened 90 (45%) · clicked 20 (10%) · unsubscribed 1 · bounced 3");
  const trigger = K.services().find((s) => s.id === "brevo")!.triggers![0];
  const conn = { values: { api_key: "xkeysib-0123456789abcdef0123" } } as never;
  assert.deepEqual(await trigger.list(conn, ""), ["12"]);
  assert.equal((await trigger.describe(conn, "12", "")).title, "New contact: sam@example.com");
});
