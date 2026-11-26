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

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = raw ? JSON.parse(raw) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, path: u.pathname + u.search, auth, body });
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const [, svc, ...rest] = u.pathname.split("/");
      const p = `/${rest.join("/")}`;
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
      json(404, { message: "No route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of ["HUBSPOT", "MAILCHIMP", "TRELLO", "CALENDLY", "TYPEFORM"]) process.env[`TALQAVA_${id}_API`] = `${url}/${id.toLowerCase()}`;
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
