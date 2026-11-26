// Outlook (mail and calendar) and OneDrive, through Microsoft Graph. Each signs in through the browser with an app the
// owner registers in Microsoft Entra as a "Mobile and desktop application" (a public client, so there is no secret).
// Facts from Microsoft's documentation on learn.microsoft.com, read November 2026: the authorization code flow, the
// redirect address rules (for localhost the port is ignored when matching), refresh tokens, and the Graph v1.0
// reference for messages, createReply, send, calendarView, events and driveItem search, get and upload.
import { baseOf, call, count, plain, query, type BrowserSignIn, type Connection, type ServiceDef } from "../connector-kit.ts";

type C = Pick<Connection, "values">;
const graph = <T = any>(c: C, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
  call<T>(`${baseOf("msgraph", "https://graph.microsoft.com")}/v1.0${path}`, { name: "Microsoft", method, headers: { authorization: `Bearer ${c.values.access_token}`, ...extra }, body });
const whoAmI = async (values: Record<string, string>) => {
  const me = await graph<{ mail?: string; userPrincipalName?: string; displayName?: string }>({ values }, "/me");
  return { label: me.mail || me.userPrincipalName || me.displayName || "Microsoft account" };
};
const signIn = (permissions: string[]): BrowserSignIn => ({
  authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["openid", "offline_access", "User.Read", ...permissions],
  secret: "never",
  appSteps: [
    "Open entra.microsoft.com and go to Entra ID › App registrations › New registration. Name it Talqava.",
    "Under Supported account types choose “Any Entra ID Tenant + Personal Microsoft accounts”, and press Register. Copy the Application (client) ID below.",
    "Open Manage › Authentication › Add Redirect URI, choose the Mobile and desktop applications tile, and enter this custom address (without a port number): http://localhost/api/oauth/callback",
    `Open API permissions › Add a permission › Microsoft Graph › Delegated permissions, tick ${permissions.join(", ")}, and press Add permissions.`,
  ],
});
const DOCS = "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app";
const TEXT = { Prefer: 'outlook.body-content-type="text"' };
const id = (v: unknown) => {
  const t = String(v ?? "");
  if (!/^[A-Za-z0-9_=!.-]{5,400}$/.test(t)) throw new Error("Give the number in brackets from the list.");
  return encodeURIComponent(t);
};
const oneLine = (v: unknown, most: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, most);
const people = (v: unknown) => {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(",")).map((a) => oneLine(a, 200)).filter(Boolean);
  for (const a of list) if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(a)) throw new Error(`“${a}” is not an email address.`);
  return list.slice(0, 30).map((address) => ({ emailAddress: { address } }));
};
const who = (r: any) => (r?.emailAddress ? `${plain(r.emailAddress.name, 60)} <${r.emailAddress.address}>` : "");
const mailLine = (m: any) => `[${m.id}] ${String(m.receivedDateTime ?? "").slice(0, 16).replace("T", " ")} · ${who(m.from)} · ${plain(m.subject, 120) || "(no subject)"}${m.isRead === false ? " · unread" : ""}\n    ${plain(m.bodyPreview, 160)}`;
const moment = (v: unknown, what: string) => {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new Error(`Write ${what} like 2026-12-01T09:00:00-06:00.`);
  return d.toISOString();
};
const utc = (v: unknown, what: string) => ({ dateTime: moment(v, what).slice(0, 19), timeZone: "UTC" });
const eventLine = (e: any) => `[${e.id}] ${String(e.start?.dateTime ?? "").slice(0, 16).replace("T", " ")} to ${String(e.end?.dateTime ?? "").slice(11, 16)} UTC · ${plain(e.subject, 120) || "(no title)"}${e.location?.displayName ? ` · ${plain(e.location.displayName, 80)}` : ""}${(e.attendees ?? []).length ? ` · with ${e.attendees.slice(0, 6).map((a: any) => a.emailAddress?.address).join(", ")}` : ""}`;
const TIME = "A date and time with its offset, like 2026-12-01T09:00:00-06:00.";
const MAIL_FIELDS = "id,subject,from,receivedDateTime,isRead,bodyPreview";
const EVENT_FIELDS = "id,subject,start,end,location,attendees";

export const outlook: ServiceDef = {
  id: "outlook",
  name: "Outlook (Microsoft 365)",
  category: "Email and calendar",
  about: "Search and read your Outlook email, write drafts and replies, and see and manage your calendar. Sending always asks you first.",
  steps: [],
  docs: DOCS,
  fields: [],
  browser: signIn(["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"]),
  check: whoAmI,
  triggers: [
    {
      name: "new_email",
      summary: "A new email arrives",
      list: async (c) => ((await graph<{ value: any[] }>(c, `/me/mailFolders/inbox/messages${query({ $top: 25, $select: "id" })}`)).value ?? []).map((m) => String(m.id)),
      async describe(c, mail) {
        const text = await outlook.actions.find((a) => a.name === "read_mail")!.run(c as Connection, { email: mail });
        return { title: `Email: ${/^Subject: (.*)$/m.exec(text)?.[1] ?? "(no subject)"}`, text: `Email number ${mail}\n${text}` };
      },
    },
  ],
  actions: [
    {
      name: "search_mail",
      kind: "read",
      summary: "Search your email",
      description: "Finds emails by words, which may use from:, to:, subject: or hasAttachments:true. Without words it lists the newest in the inbox, or with unread_only just the unread ones.",
      properties: { words: { type: "string" }, unread_only: { type: "boolean" }, limit: { type: "number", description: "How many, at most 25. Usually 10." } },
      async run(c, input) {
        const top = count(input.limit, 10, 25);
        const r = input.words
          ? await graph<{ value: any[] }>(c, `/me/messages${query({ $search: `"${String(input.words).replace(/["\\]/g, " ").slice(0, 300)}"`, $top: top, $select: MAIL_FIELDS })}`)
          : await graph<{ value: any[] }>(c, `/me/mailFolders/inbox/messages${query({ $top: top, $select: MAIL_FIELDS, $filter: input.unread_only ? "isRead eq false" : undefined })}`);
        return (r.value ?? []).map(mailLine).join("\n") || "No emails match.";
      },
    },
    {
      name: "read_mail",
      kind: "read",
      summary: "Read one email in full",
      description: "Returns one email: who sent it, to whom, when, and its text.",
      properties: { email: { type: "string", description: "The email's number in brackets, from search_mail." } },
      required: ["email"],
      async run(c, input) {
        const m = await graph<any>(c, `/me/messages/${id(input.email)}${query({ $select: "subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments" })}`, "GET", undefined, TEXT);
        return `From: ${who(m.from)}\nTo: ${(m.toRecipients ?? []).map(who).join(", ")}${(m.ccRecipients ?? []).length ? `\nCc: ${m.ccRecipients.map(who).join(", ")}` : ""}\nDate: ${String(m.receivedDateTime ?? "").slice(0, 16).replace("T", " ")}\nSubject: ${plain(m.subject, 300)}${m.hasAttachments ? "\nHas attachments (not opened here)" : ""}\n\n${String(m.body?.content ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 25_000) || "(no text)"}`;
      },
    },
    {
      name: "write_draft",
      kind: "write",
      summary: "Write a draft or a reply (nothing is sent)",
      description: "Saves a draft in the owner's Outlook: a new email (give to and subject), or a reply (give reply_to, an email's number). Nothing is sent. Write as the owner, plainly, and never invent facts.",
      properties: { to: { type: "array", items: { type: "string" } }, subject: { type: "string" }, text: { type: "string" }, reply_to: { type: "string" } },
      required: ["text"],
      async run(c, input) {
        const text = String(input.text).slice(0, 100_000);
        if (input.reply_to) {
          const d = await graph<any>(c, `/me/messages/${id(input.reply_to)}/createReply`, "POST", { comment: text });
          return `Saved a reply as a draft: “${plain(d.subject, 200)}” (draft ${d.id}). It is in Outlook's Drafts; nothing was sent.`;
        }
        const to = people(input.to);
        const subject = oneLine(input.subject, 250);
        if (!to.length) throw new Error("Say who it is to.");
        if (!subject) throw new Error("Give a subject.");
        const d = await graph<any>(c, "/me/messages", "POST", { subject, body: { contentType: "Text", content: text }, toRecipients: to });
        return `Saved a draft to ${to.map((p) => p.emailAddress.address).join(", ")}: “${subject}” (draft ${d.id}). It is in Outlook's Drafts; nothing was sent.`;
      },
    },
    {
      name: "send_draft",
      kind: "write",
      alwaysAsk: true,
      summary: "Send a draft",
      description: "Sends a draft that write_draft saved. The email goes out from the owner's address and cannot be taken back, so the owner is always asked first.",
      properties: { draft: { type: "string" } },
      required: ["draft"],
      async run(c, input) {
        await graph(c, `/me/messages/${id(input.draft)}/send`, "POST", undefined, { "content-length": "0" });
        return "Sent the draft.";
      },
    },
    {
      name: "list_events",
      kind: "read",
      summary: "See what is on your calendar",
      description: "Lists the events between two moments, with times in UTC. Use it before proposing a time: the gaps are free time.",
      properties: { from: { type: "string", description: TIME }, to: { type: "string", description: TIME }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      required: ["from", "to"],
      async run(c, input) {
        const r = await graph<{ value: any[] }>(c, `/me/calendarView${query({ startDateTime: moment(input.from, "the start"), endDateTime: moment(input.to, "the end"), $top: count(input.limit, 30, 100), $select: EVENT_FIELDS, $orderby: "start/dateTime" })}`);
        return (r.value ?? []).map(eventLine).join("\n") || "Nothing on the calendar in that time.";
      },
    },
    {
      name: "add_event",
      kind: "write",
      summary: "Add an event to your own calendar",
      description: "Adds an event to the owner's calendar, without guests: Microsoft emails every guest an invitation the moment they are added, so the owner adds guests themselves in Outlook.",
      properties: { title: { type: "string" }, start: { type: "string", description: TIME }, end: { type: "string", description: TIME }, description: { type: "string" }, location: { type: "string" } },
      required: ["title", "start", "end"],
      async run(c, input) {
        const e = await graph<any>(c, "/me/events", "POST", { subject: oneLine(input.title, 300), start: utc(input.start, "the start"), end: utc(input.end, "the end"), ...(input.description ? { body: { contentType: "Text", content: String(input.description).slice(0, 8000) } } : {}), ...(input.location ? { location: { displayName: oneLine(input.location, 300) } } : {}) });
        return `Added: ${eventLine(e)}`;
      },
    },
    {
      name: "change_event",
      kind: "write",
      summary: "Change or move an event",
      description: "Changes an event's title, time, place or description. Give only what changes. If the event has guests, Outlook may tell them about a changed time.",
      properties: { event: { type: "string" }, title: { type: "string" }, start: { type: "string", description: TIME }, end: { type: "string", description: TIME }, description: { type: "string" }, location: { type: "string" } },
      required: ["event"],
      async run(c, input) {
        const change = { ...(input.title ? { subject: oneLine(input.title, 300) } : {}), ...(input.start ? { start: utc(input.start, "the start") } : {}), ...(input.end ? { end: utc(input.end, "the end") } : {}), ...(input.description !== undefined ? { body: { contentType: "Text", content: String(input.description).slice(0, 8000) } } : {}), ...(input.location !== undefined ? { location: { displayName: oneLine(input.location, 300) } } : {}) };
        if (!Object.keys(change).length) throw new Error("Say what to change.");
        return `Changed: ${eventLine(await graph<any>(c, `/me/events/${id(input.event)}`, "PATCH", change))}`;
      },
    },
    {
      name: "remove_event",
      kind: "destructive",
      summary: "Remove an event",
      description: "Removes an event from the calendar. If the owner organized it and it has guests, Outlook sends them a cancellation.",
      properties: { event: { type: "string" } },
      required: ["event"],
      async run(c, input) {
        await graph(c, `/me/events/${id(input.event)}`, "DELETE");
        return "Removed the event.";
      },
    },
  ],
};

export const onedrive: ServiceDef = {
  id: "onedrive",
  name: "OneDrive",
  category: "Files and documents",
  about: "Find and read the files in your OneDrive, and save new text files there.",
  steps: [],
  docs: DOCS,
  fields: [],
  browser: signIn(["Files.ReadWrite"]),
  check: whoAmI,
  actions: [
    {
      name: "find_files",
      kind: "read",
      summary: "Find files and folders",
      description: "Finds files by words in their name or inside them, or lists a folder (give folder, a folder's number; leave both out for the top folder).",
      properties: { words: { type: "string" }, folder: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const sel = { $top: count(input.limit, 20, 50), $select: "id,name,size,lastModifiedDateTime,file,folder" };
        const r = input.words ? await graph<{ value: any[] }>(c, `/me/drive/root/search(q='${encodeURIComponent(String(input.words).replace(/'/g, "''").slice(0, 200))}')${query(sel)}`) : await graph<{ value: any[] }>(c, `${input.folder ? `/me/drive/items/${id(input.folder)}` : "/me/drive/root"}/children${query(sel)}`);
        return (r.value ?? []).map((f) => `[${f.id}] ${plain(f.name, 160)} · ${f.folder ? "folder" : (f.file?.mimeType ?? "file")} · changed ${String(f.lastModifiedDateTime ?? "").slice(0, 10)}`).join("\n") || "No files match.";
      },
    },
    {
      name: "read_file",
      kind: "read",
      summary: "Read a text file",
      description: "Returns the text of a plain text, Markdown, CSV or similar file. Office files, PDFs and pictures cannot be read here.",
      properties: { file: { type: "string" } },
      required: ["file"],
      async run(c, input) {
        const f = await graph<any>(c, `/me/drive/items/${id(input.file)}`);
        const type = String(f.file?.mimeType ?? "");
        if (f.folder) return `“${plain(f.name, 160)}” is a folder. List it with find_files.`;
        if (!/^text\/|json|xml|csv|markdown/.test(type) && !/\.(txt|md|csv|json|xml|log)$/i.test(String(f.name))) return `“${plain(f.name, 160)}” is a ${type || "file"}, which cannot be read as text here.`;
        if (Number(f.size) > 2_000_000) return `“${plain(f.name, 160)}” is too large to read here.`;
        const link = String(f["@microsoft.graph.downloadUrl"] ?? "");
        if (!link) throw new Error("OneDrive gave no way to download that file.");
        // The link is a short-lived address that needs no sign-in, so none is sent to it.
        return `${plain(f.name, 160)}\n\n${await call<string>(link, { name: "OneDrive", text: 60_000 })}`;
      },
    },
    {
      name: "save_text_file",
      kind: "write",
      summary: "Save a new text file",
      description: "Saves a new plain text or Markdown file in the top folder of the owner's OneDrive. If a file with that name exists, OneDrive refuses rather than replacing it.",
      properties: { name: { type: "string", description: "The file's name, such as Notes.md." }, text: { type: "string" } },
      required: ["name", "text"],
      async run(c, input) {
        const name = oneLine(input.name, 150).replace(/[\\/:*?"<>|#%]/g, "-") || "Untitled.txt";
        const f = await call<any>(`${baseOf("msgraph", "https://graph.microsoft.com")}/v1.0/me/drive/root:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`, { name: "OneDrive", method: "PUT", headers: { authorization: `Bearer ${c.values.access_token}` }, raw: { type: "text/plain", data: String(input.text).slice(0, 4_000_000) } });
        return `Saved “${f.name}” in OneDrive (${f.id}).`;
      },
    },
  ],
};
