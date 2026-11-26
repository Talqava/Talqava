// Gmail, Google Calendar, Google Drive, Outlook and OneDrive: browser sign-in and their actions, against stand-ins.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-browser-"));
let K: typeof import("../../src/local/connector-kit.ts");
let server: http.Server;
let url = "";
const seen: { method: string; path: string; auth: string; type: string; body: any; raw: string; prefer: string }[] = [];
const b64url = (t: string) => Buffer.from(t).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const original = { id: "msg00001", threadId: "thr00001", internalDate: "1795000000000", labelIds: ["INBOX", "UNREAD"], snippet: "Could you send the price list?", payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Sam Lee <sam@example.com>" }, { name: "To", value: "ada@example.com" }, { name: "Subject", value: "Price list" }, { name: "Date", value: "Wed, 25 Nov 2026 10:00:00 +0000" }, { name: "Message-ID", value: "<abc@mail.example.com>" }], parts: [{ mimeType: "text/plain", body: { data: b64url("Could you send the price list?\n\nThanks, Sam") } }, { mimeType: "text/html", body: { data: b64url("<p>ignored</p>") } }, { mimeType: "application/pdf", filename: "order.pdf", body: { attachmentId: "a1" } }] } };

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const type = String(req.headers["content-type"] ?? "");
      const body = type.startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : type.startsWith("application/json") && raw ? JSON.parse(raw) : null;
      const auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, path: decodeURIComponent((u.pathname + u.search).replace(/\+/g, " ")), auth, type, body, raw, prefer: String(req.headers.prefer ?? "") });
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(v === undefined ? "" : JSON.stringify(v)));
      const p = decodeURIComponent(u.pathname);
      if (p === "/token") return body.code === "ok" || body.grant_type === "refresh_token" ? json(200, { access_token: `tok-${body.client_id}`, refresh_token: "rt", expires_in: 3600 }) : json(400, { error: "invalid_grant" });
      if (p === "/download") return (res.writeHead(200, { "content-type": "text/plain" }), res.end(auth ? "LEAKED" : "Flour: 20 kg\nYeast: 1 kg"));
      if (!auth.startsWith("Bearer tok-")) return json(401, { error: { message: "Invalid Credentials" } });
      // ---- Google ----
      if (p === "/v1/userinfo") return json(200, { email: "ada@example.com" });
      if (p === "/gmail/v1/users/me/messages") return json(200, { messages: [{ id: "msg00001", threadId: "thr00001" }] });
      if (p === "/gmail/v1/users/me/messages/msg00001") return json(200, original);
      if (p === "/gmail/v1/users/me/drafts") return json(200, { id: "draft001", message: { id: "m2" } });
      if (p === "/gmail/v1/users/me/drafts/send") return json(200, { id: "m3" });
      if (p === "/calendar/v3/calendars/primary/events" && req.method === "GET") return json(200, { items: [{ id: "evt00001", summary: "Supplier call", start: { dateTime: "2026-12-01T15:00:00Z" }, end: { dateTime: "2026-12-01T15:30:00Z" }, attendees: [{ email: "sam@example.com" }] }] });
      if (p === "/calendar/v3/calendars/primary/events" && req.method === "POST") return json(200, { id: "evt00002", ...body });
      if (p === "/calendar/v3/calendars/primary/events/evt00001" && req.method === "DELETE") return (res.writeHead(204), res.end());
      if (p === "/calendar/v3/freeBusy") return json(200, { calendars: { primary: { busy: [{ start: "2026-12-01T15:00:00Z", end: "2026-12-01T15:30:00Z" }] } } });
      if (p === "/drive/v3/files") return json(200, { files: [{ id: "file00001", name: "Recipes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-11-20T10:00:00Z" }] });
      if (p === "/drive/v3/files/file00001") return json(200, { name: "Recipes", mimeType: "application/vnd.google-apps.document" });
      if (p === "/drive/v3/files/file00001/export") return (res.writeHead(200, { "content-type": "text/plain" }), res.end("Rye: flour, water, salt."));
      if (p === "/upload/drive/v3/files") return json(200, { id: "file00002", name: "Notes.md" });
      // ---- Microsoft Graph ----
      if (p === "/v1.0/me") return json(200, { mail: "ada@contoso.example", userPrincipalName: "ada@contoso.example" });
      if (p === "/v1.0/me/messages" && req.method === "GET") return json(200, { value: [{ id: "AAMk0001=", subject: "Invoice 12", from: { emailAddress: { name: "Kim", address: "kim@example.com" } }, receivedDateTime: "2026-11-25T09:00:00Z", isRead: false, bodyPreview: "Attached is the invoice." }] });
      if (p === "/v1.0/me/messages/AAMk0001=") return json(200, { subject: "Invoice 12", from: { emailAddress: { name: "Kim", address: "kim@example.com" } }, toRecipients: [{ emailAddress: { name: "Ada", address: "ada@contoso.example" } }], receivedDateTime: "2026-11-25T09:00:00Z", body: { contentType: "text", content: "Attached is the invoice.\r\n\r\n\r\n\r\nKim" }, hasAttachments: true });
      if (p === "/v1.0/me/messages/AAMk0001=/createReply") return json(201, { id: "AAMkDraft1=", subject: "RE: Invoice 12" });
      if (p === "/v1.0/me/messages" && req.method === "POST") return json(201, { id: "AAMkDraft2=", subject: body.subject });
      if (p === "/v1.0/me/messages/AAMkDraft1=/send") return (res.writeHead(202), res.end());
      if (p === "/v1.0/me/calendarView") return json(200, { value: [{ id: "AAMkEvt1=", subject: "Stock take", start: { dateTime: "2026-12-02T10:00:00.0000000" }, end: { dateTime: "2026-12-02T11:00:00.0000000" } }] });
      if (p === "/v1.0/me/events" && req.method === "POST") return json(201, { id: "AAMkEvt2=", ...body });
      if (p.startsWith("/v1.0/me/drive/root/search")) return json(200, { value: [{ id: "01ABCDEF", name: "stock.csv", lastModifiedDateTime: "2026-11-22T08:00:00Z", file: { mimeType: "text/csv" } }] });
      if (p === "/v1.0/me/drive/items/01ABCDEF") return json(200, { id: "01ABCDEF", name: "stock.csv", size: 30, file: { mimeType: "text/csv" }, "@microsoft.graph.downloadUrl": `${url}/download` });
      if (p.startsWith("/v1.0/me/drive/root:/")) return json(201, { id: "01NEWFILE", name: "Notes.md" });
      json(404, { error: { message: "No route" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const id of ["GMAIL", "GOOGLECALENDAR", "GOOGLEDRIVE", "OUTLOOK", "ONEDRIVE"]) process.env[`TALQAVA_${id}_TOKEN_API`] = `${url}/token`;
  for (const id of ["GOOGLEID", "GMAIL", "GOOGLECALENDAR", "GOOGLEDRIVE", "MSGRAPH"]) process.env[`TALQAVA_${id}_API`] = url;
  K = await import("../../src/local/connector-kit.ts");
  await import("../../src/local/services/index.ts");
});
after(() => server.close());
const tool = (name: string) => K.serviceTools().find((t) => t.name === name)!;
const run = async (name: string, input: any = {}) => String(await tool(name).run(input, { conversation: { id: "t" }, signal: new AbortController().signal } as never));
const redirect = "http://localhost:8788/api/oauth/callback";
const signIn = async (id: string, secret?: string) => {
  const to = new URL(K.startBrowserSignIn(id, { clientId: id, clientSecret: secret }, redirect).url);
  return { to, connection: await K.finishBrowserSignIn(to.searchParams.get("state"), "ok") };
};

test("Gmail: sign in with your own Google app, search, read, draft a threaded reply, and sending always asks", async () => {
  assert.throws(() => K.startBrowserSignIn("gmail", { clientId: "gmail" }, redirect), /client secret/);
  const { to, connection } = await signIn("gmail", "shh");
  assert.equal(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(to.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose");
  assert.deepEqual([to.searchParams.get("access_type"), to.searchParams.get("prompt")], ["offline", "consent"]);
  assert.equal(seen.find((s) => s.path === "/token")!.body.client_secret, "shh");
  assert.equal(connection.label, "ada@example.com");

  assert.match(await run("gmail__search", { words: "from:sam" }), /^\[msg00001\] 2026-11-18 \d\d:\d\d · Sam Lee <sam@example\.com> · Price list · unread\n    Could you send the price list\?$/);
  assert.equal(await run("gmail__read", { email: "msg00001" }), "From: Sam Lee <sam@example.com>\nTo: ada@example.com\nDate: Wed, 25 Nov 2026 10:00:00 +0000\nSubject: Price list\nAttachments: order.pdf\n\nCould you send the price list?\n\nThanks, Sam");
  const out = await run("gmail__write_draft", { reply_to: "msg00001", text: "Hello Sam,\nattached — £4 a loaf.\n" });
  assert.match(out, /Saved a draft to sam@example\.com: “Re: Price list” \(draft draft001\)\..*nothing was sent/);
  const sent = seen.findLast((s) => s.path === "/gmail/v1/users/me/drafts")!.body.message;
  assert.equal(sent.threadId, "thr00001");
  const mime = Buffer.from(sent.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  assert.match(mime, /^To: sam@example\.com\r\nSubject: Re: Price list\r\nIn-Reply-To: <abc@mail\.example\.com>\r\nReferences: <abc@mail\.example\.com>\r\n/);
  assert.equal(Buffer.from(mime.split("\r\n\r\n")[1], "base64").toString(), "Hello Sam,\nattached — £4 a loaf.\n");
  await assert.rejects(run("gmail__write_draft", { to: ["sam@example.com\nBcc: everyone@example.com"], subject: "x", text: "y" }), /not an email address/);
  await run("gmail__write_draft", { to: ["kim@example.com"], subject: "Prix d'été\r\nBcc: x@example.com", text: "y" });
  const fresh = Buffer.from(seen.at(-1)!.body.message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  assert.match(fresh, /^To: kim@example\.com\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\nMIME-Version/, "a subject cannot smuggle in another header");

  K.updateConnection(connection.id, { rule: "auto" });
  assert.equal(tool("gmail__write_draft").needsApproval({}), false);
  assert.equal(tool("gmail__send_draft").needsApproval({}), true, "sending asks even when other changes do not");
  assert.equal(await run("gmail__send_draft", { draft: "draft001" }), "Sent draft draft001.");
  assert.ok(K.listServices().find((s) => s.id === "gmail")!.actions.some((a) => a.summary === "Send a draft (always asks you first)"));
});

test("Google Calendar: events, busy times, adding without emailing guests unless asked, and removing always asks", async () => {
  await signIn("googlecalendar", "shh");
  assert.equal(await run("googlecalendar__list_events", { from: "2026-12-01T00:00:00-06:00", to: "2026-12-02T00:00:00-06:00" }), "[evt00001] 2026-12-01 15:00 to 15:30 · Supplier call · with sam@example.com");
  assert.match(seen.at(-1)!.path, /timeMin=2026-12-01T06:00:00\.000Z&timeMax=2026-12-02T06:00:00\.000Z&singleEvents=true&orderBy=startTime/);
  assert.equal(await run("googlecalendar__busy_times", { from: "2026-12-01T00:00:00Z", to: "2026-12-02T00:00:00Z" }), "Busy 2026-12-01 15:00 to 15:30 UTC");
  assert.match(await run("googlecalendar__add_event", { title: "Tasting", start: "2026-12-03T10:00:00-06:00", end: "2026-12-03T11:00:00-06:00", guests: ["sam@example.com"] }), /Added: \[evt00002\].*Guests were not emailed\./);
  assert.match(seen.at(-1)!.path, /sendUpdates=none/);
  assert.deepEqual(seen.at(-1)!.body, { summary: "Tasting", start: { dateTime: "2026-12-03T16:00:00.000Z" }, end: { dateTime: "2026-12-03T17:00:00.000Z" }, attendees: [{ email: "sam@example.com" }] });
  await assert.rejects(run("googlecalendar__add_event", { title: "x", start: "tomorrow", end: "later" }), /Write the start like/);
  assert.equal(tool("googlecalendar__remove_event").needsApproval({}), true);
  assert.equal(await run("googlecalendar__remove_event", { event: "evt00001" }), "Removed event evt00001.");
});

test("Google Drive: find files, read a Google Doc as text, and save a new text file", async () => {
  await signIn("googledrive", "shh");
  assert.equal(await run("googledrive__find_files", { words: "Ada's recipes" }), "[file00001] Recipes · Google Doc · changed 2026-11-20");
  assert.match(seen.at(-1)!.path, /q=trashed = false and name contains 'Ada\\'s recipes'/);
  assert.equal(await run("googledrive__read_file", { file: "file00001" }), "Recipes\n\nRye: flour, water, salt.");
  assert.match(seen.at(-1)!.path, /\/export\?mimeType=text\/plain/);
  assert.equal(await run("googledrive__save_text_file", { name: "Notes.md", text: "# Notes\nBuy flour." }), "Saved “Notes.md” in Google Drive (file00002).");
  const up = seen.at(-1)!;
  assert.match(up.type, /^multipart\/related; boundary=talqava/);
  assert.match(up.raw, /\{"name":"Notes\.md","mimeType":"text\/markdown"\}[\s\S]*# Notes\nBuy flour\./);
});

test("Outlook: sign in without a secret, search, read as text, draft a reply, and sending always asks", async () => {
  const { to, connection } = await signIn("outlook");
  assert.equal(to.origin + to.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assert.equal(to.searchParams.get("scope"), "openid offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite");
  assert.equal("client_secret" in seen.findLast((s) => s.path === "/token")!.body, false, "a public client sends no secret");
  assert.equal(connection.label, "ada@contoso.example");
  assert.equal(await run("outlook__search_mail", { words: 'invoice "12"' }), "[AAMk0001=] 2026-11-25 09:00 · Kim <kim@example.com> · Invoice 12 · unread\n    Attached is the invoice.");
  assert.match(seen.at(-1)!.path, /\$search="invoice  12 "/);
  assert.equal(await run("outlook__read_mail", { email: "AAMk0001=" }), "From: Kim <kim@example.com>\nTo: Ada <ada@contoso.example>\nDate: 2026-11-25 09:00\nSubject: Invoice 12\nHas attachments (not opened here)\n\nAttached is the invoice.\n\nKim");
  assert.equal(seen.at(-1)!.prefer, 'outlook.body-content-type="text"');
  assert.match(await run("outlook__write_draft", { reply_to: "AAMk0001=", text: "Thank you, paid today." }), /Saved a reply as a draft: “RE: Invoice 12” \(draft AAMkDraft1=\)/);
  assert.match(await run("outlook__write_draft", { to: ["kim@example.com"], subject: "Order", text: "Two sacks please." }), /Saved a draft to kim@example\.com: “Order”/);
  assert.deepEqual(seen.at(-1)!.body, { subject: "Order", body: { contentType: "Text", content: "Two sacks please." }, toRecipients: [{ emailAddress: { address: "kim@example.com" } }] });
  assert.equal(tool("outlook__send_draft").needsApproval({}), true);
  assert.equal(await run("outlook__send_draft", { draft: "AAMkDraft1=" }), "Sent the draft.");
  assert.equal(await run("outlook__list_events", { from: "2026-12-02T00:00:00Z", to: "2026-12-03T00:00:00Z" }), "[AAMkEvt1=] 2026-12-02 10:00 to 11:00 UTC · Stock take");
  assert.match(await run("outlook__add_event", { title: "Delivery", start: "2026-12-04T08:00:00-06:00", end: "2026-12-04T08:30:00-06:00" }), /Added: \[AAMkEvt2=\] 2026-12-04 14:00 to 14:30 UTC · Delivery/);
  assert.equal("guests" in (tool("outlook__add_event").definition as any).input_schema.properties, false, "guests cannot be added, since Microsoft would email them at once");
});

test("OneDrive: find files, read one through its short-lived link without sending the sign-in to it, and save a new file", async () => {
  await signIn("onedrive");
  assert.equal(await run("onedrive__find_files", { words: "stock" }), "[01ABCDEF] stock.csv · text/csv · changed 2026-11-22");
  assert.equal(await run("onedrive__read_file", { file: "01ABCDEF" }), "stock.csv\n\nFlour: 20 kg\nYeast: 1 kg");
  assert.equal(seen.at(-1)!.auth, "");
  assert.equal(await run("onedrive__save_text_file", { name: "Notes.md", text: "Buy flour." }), "Saved “Notes.md” in OneDrive (01NEWFILE).");
  assert.match(seen.at(-1)!.path, /\/root:\/Notes\.md:\/content\?@microsoft\.graph\.conflictBehavior=fail/);
});
