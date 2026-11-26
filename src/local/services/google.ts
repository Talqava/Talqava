// Gmail, Google Calendar and Google Drive. Each signs in through the browser with an app the owner registers in
// Google Cloud (a "Desktop app" client), so nothing depends on Talqava being registered with Google.
// Facts from Google's documentation, read November 2026: developers.google.com/identity/protocols/oauth2/native-app,
// the Gmail API reference (users.messages, users.drafts), the Calendar API v3 reference (events, freebusy) and the
// Drive API v3 reference (files.list, get, export, create) with its guides on searching and uploads.
//
// What the owner should know, said on the page: while their Google app is in "Testing", Google asks them to sign in
// again every seven days; an app set to Internal (Google Workspace) does not have that limit.
import { baseOf, call, count, plain, query, type BrowserSignIn, type Connection, type ServiceDef } from "../connector-kit.ts";

type C = Pick<Connection, "values">;
const bearer = (c: C) => ({ authorization: `Bearer ${c.values.access_token}` });
const whoAmI = async (values: Record<string, string>) => ({ label: (await call<{ email: string }>(`${baseOf("googleid", "https://openidconnect.googleapis.com")}/v1/userinfo`, { name: "Google", headers: bearer({ values }) })).email });
const signIn = (api: string, scopes: string[]): BrowserSignIn => ({
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: ["openid", "email", ...scopes.map((s) => `https://www.googleapis.com/auth/${s}`)],
  extra: { access_type: "offline", prompt: "consent" },
  secret: "required",
  appSteps: [
    "Open console.cloud.google.com and make a project: Menu › IAM & Admin › Create a Project. (One project serves Gmail, Calendar and Drive.)",
    `Open Menu › APIs & Services › Library, find the ${api}, and press Enable.`,
    "Open Menu › Google Auth platform and press Get Started. Name the app Talqava and give your email address. For Audience choose Internal if you use Google Workspace; otherwise choose External, then under Audience › Test users add your own address.",
    "Open Google Auth platform › Clients › Create Client. Choose the application type Desktop app and press Create. Copy the Client ID and Client secret below; Google shows the secret only once.",
    "With External, Google keeps your app in Testing and asks you to sign in here again every seven days. With Internal it does not.",
  ],
});
const DOCS = "https://developers.google.com/workspace/guides/create-credentials";
const id = (v: unknown, what = "number") => {
  const t = String(v ?? "");
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(t)) throw new Error(`Give the ${what} in brackets from the list.`);
  return t;
};

// ---------- Gmail ----------
const gmail_ = <T = any>(c: C, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("gmail", "https://gmail.googleapis.com")}/gmail/v1/users/me${path}`, { name: "Gmail", method, headers: bearer(c), body });
const header = (m: any, name: string) => String((m.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "");
const decode = (data: string) => Buffer.from(String(data ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
/** The words of a message: its plain-text part where there is one, otherwise its HTML part without the tags. */
function bodyText(part: any): string {
  const find = (p: any, type: string): string => (p?.mimeType === type && p.body?.data ? decode(p.body.data) : (p?.parts ?? []).map((x: any) => find(x, type)).find(Boolean) ?? "");
  const text = find(part, "text/plain");
  if (text) return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return find(part, "text/html").replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").split("\n").map((l) => plain(l, 2000)).filter(Boolean).join("\n");
}
const oneLine = (v: unknown, most: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, most);
const b64url = (t: string) => Buffer.from(t, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A header's words, encoded when they are not plain English letters, as email requires. */
const words = (t: string) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`);
const addresses = (v: unknown) => {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(",")).map((a) => oneLine(a, 200)).filter(Boolean);
  for (const a of list) if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(a)) throw new Error(`“${a}” is not an email address.`);
  return list.slice(0, 30);
};

export const gmail: ServiceDef = {
  id: "gmail",
  name: "Gmail",
  category: "Email and calendar",
  about: "Search and read your Gmail, and write drafts and replies. Sending always asks you first.",
  steps: [],
  docs: DOCS,
  fields: [],
  browser: signIn("Gmail API", ["gmail.readonly", "gmail.compose"]),
  check: whoAmI,
  triggers: [
    {
      name: "new_email",
      summary: "A new email arrives",
      param: { label: "Only emails matching (Gmail search words; leave empty for everything in the inbox)", placeholder: "from:orders@example.com" },
      list: async (c, words) => ((await gmail_<{ messages?: { id: string }[] }>(c, `/messages${query({ q: words ? `in:inbox ${words.slice(0, 400)}` : "in:inbox", maxResults: 25 })}`)).messages ?? []).map((m) => m.id),
      async describe(c, mail) {
        const text = await gmail.actions.find((a) => a.name === "read")!.run(c as Connection, { email: mail });
        return { title: `Email: ${/^Subject: (.*)$/m.exec(text)?.[1] ?? "(no subject)"}`, text: `Email number ${mail}\n${text}` };
      },
    },
  ],
  actions: [
    {
      name: "search",
      kind: "read",
      summary: "Search your email",
      description: "Finds emails, newest first, using Gmail's own search words, for example: from:sam@example.com, subject:invoice, is:unread, newer_than:7d, has:attachment, or plain words. Without words it lists the newest in the inbox.",
      properties: { words: { type: "string" }, limit: { type: "number", description: "How many, at most 25. Usually 10." } },
      async run(c, input) {
        const list = await gmail_<{ messages?: { id: string }[] }>(c, `/messages${query({ q: input.words ? String(input.words).slice(0, 500) : "in:inbox", maxResults: count(input.limit, 10, 25) })}`);
        if (!list.messages?.length) return "No emails match.";
        const full = await Promise.all(list.messages.map((m) => gmail_<any>(c, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
        return full.map((m) => `[${m.id}] ${new Date(Number(m.internalDate)).toISOString().slice(0, 16).replace("T", " ")} · ${oneLine(header(m, "From"), 80)} · ${oneLine(header(m, "Subject"), 120) || "(no subject)"}${(m.labelIds ?? []).includes("UNREAD") ? " · unread" : ""}\n    ${plain(m.snippet, 160)}`).join("\n");
      },
    },
    {
      name: "read",
      kind: "read",
      summary: "Read one email in full",
      description: "Returns one email: who sent it, to whom, when, and its text. Attachments are named but not opened.",
      properties: { email: { type: "string", description: "The email's number in brackets, from search." } },
      required: ["email"],
      async run(c, input) {
        const m = await gmail_<any>(c, `/messages/${id(input.email)}?format=full`);
        const files: string[] = [];
        const walk = (p: any) => (p?.filename && files.push(plain(p.filename, 120)), (p?.parts ?? []).forEach(walk));
        walk(m.payload);
        return `From: ${oneLine(header(m, "From"), 200)}\nTo: ${oneLine(header(m, "To"), 300)}${header(m, "Cc") ? `\nCc: ${oneLine(header(m, "Cc"), 300)}` : ""}\nDate: ${oneLine(header(m, "Date"), 60)}\nSubject: ${oneLine(header(m, "Subject"), 300)}${files.length ? `\nAttachments: ${files.join(", ")}` : ""}\n\n${bodyText(m.payload).slice(0, 25_000) || "(no text)"}`;
      },
    },
    {
      name: "write_draft",
      kind: "write",
      summary: "Write a draft or a reply (nothing is sent)",
      description: "Saves a draft in the owner's Gmail: a new email (give to and subject), or a reply (give reply_to, an email's number; the recipient and subject are taken from it). Nothing is sent. Write as the owner, plainly, and never invent facts.",
      properties: { to: { type: "array", items: { type: "string" }, description: "Email addresses, for a new email." }, subject: { type: "string" }, text: { type: "string", description: "The email's text, plain." }, reply_to: { type: "string", description: "An email's number, to reply to it." } },
      required: ["text"],
      async run(c, input) {
        let to = addresses(input.to);
        let subject = oneLine(input.subject, 250);
        const extra: string[] = [];
        let threadId: string | undefined;
        if (input.reply_to) {
          const m = await gmail_<any>(c, `/messages/${id(input.reply_to)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
          const from = header(m, "Reply-To") || header(m, "From");
          if (!to.length) to = addresses([/<([^>]+)>/.exec(from)?.[1] ?? from]);
          const was = oneLine(header(m, "Subject"), 240);
          subject = /^re:/i.test(was) ? was : `Re: ${was}`;
          const mid = oneLine(header(m, "Message-ID"), 400);
          if (mid) extra.push(`In-Reply-To: ${mid}`, `References: ${oneLine(`${header(m, "References")} ${mid}`, 1500)}`);
          threadId = m.threadId;
        }
        if (!to.length) throw new Error("Say who it is to.");
        if (!subject) throw new Error("Give a subject.");
        const raw = [`To: ${to.join(", ")}`, `Subject: ${words(subject)}`, ...extra, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(String(input.text).slice(0, 100_000), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n")].join("\r\n");
        const d = await gmail_<{ id: string }>(c, "/drafts", "POST", { message: { raw: b64url(raw), ...(threadId ? { threadId } : {}) } });
        return `Saved a draft to ${to.join(", ")}: “${subject}” (draft ${d.id}). It is in Gmail's Drafts; nothing was sent.`;
      },
    },
    {
      name: "send_draft",
      kind: "write",
      alwaysAsk: true,
      summary: "Send a draft",
      description: "Sends a draft that write_draft saved. The email goes out from the owner's address and cannot be taken back, so the owner is always asked first.",
      properties: { draft: { type: "string", description: "The draft's number, from write_draft." } },
      required: ["draft"],
      async run(c, input) {
        await gmail_(c, "/drafts/send", "POST", { id: id(input.draft) });
        return `Sent draft ${input.draft}.`;
      },
    },
  ],
};

// ---------- Google Calendar ----------
const cal = <T = any>(c: C, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("googlecalendar", "https://www.googleapis.com")}/calendar/v3${path}`, { name: "Google Calendar", method, headers: bearer(c), body });
const moment = (v: unknown, what: string) => {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new Error(`Write ${what} like 2026-12-01T09:00:00-06:00.`);
  return d.toISOString();
};
const span = (e: any) => (e.start?.date ? `${e.start.date} (all day)` : `${String(e.start?.dateTime ?? "").slice(0, 16).replace("T", " ")} to ${String(e.end?.dateTime ?? "").slice(11, 16)}`);
const eventLine = (e: any) => `[${e.id}] ${span(e)} · ${plain(e.summary, 120) || "(no title)"}${e.location ? ` · ${plain(e.location, 80)}` : ""}${(e.attendees ?? []).length ? ` · with ${e.attendees.slice(0, 6).map((a: any) => a.email).join(", ")}` : ""}`;
const eventBody = (input: Record<string, any>) => ({
  ...(input.title ? { summary: oneLine(input.title, 300) } : {}),
  ...(input.description !== undefined ? { description: String(input.description).slice(0, 8000) } : {}),
  ...(input.location !== undefined ? { location: oneLine(input.location, 300) } : {}),
  ...(input.start ? { start: { dateTime: moment(input.start, "the start") } } : {}),
  ...(input.end ? { end: { dateTime: moment(input.end, "the end") } } : {}),
  ...(input.guests ? { attendees: addresses(input.guests).map((email) => ({ email })) } : {}),
});
const TIME = "A date and time with its offset, like 2026-12-01T09:00:00-06:00.";

export const googleCalendar: ServiceDef = {
  id: "googlecalendar",
  name: "Google Calendar",
  category: "Email and calendar",
  about: "See your schedule and free time on Google Calendar, and add, move or remove events.",
  steps: [],
  docs: DOCS,
  fields: [],
  browser: signIn("Google Calendar API", ["calendar.events", "calendar.freebusy"]),
  check: whoAmI,
  actions: [
    {
      name: "list_events",
      kind: "read",
      summary: "See what is on your calendar",
      description: "Lists the events between two moments in start order, optionally only those matching words. Use it before proposing a time.",
      properties: { from: { type: "string", description: TIME }, to: { type: "string", description: TIME }, words: { type: "string" }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      required: ["from", "to"],
      async run(c, input) {
        const r = await cal<{ items: any[] }>(c, `/calendars/primary/events${query({ timeMin: moment(input.from, "the start"), timeMax: moment(input.to, "the end"), singleEvents: true, orderBy: "startTime", q: input.words, maxResults: count(input.limit, 30, 100) })}`);
        return (r.items ?? []).map(eventLine).join("\n") || "Nothing on the calendar in that time.";
      },
    },
    {
      name: "busy_times",
      kind: "read",
      summary: "See when you are busy",
      description: "Returns the busy stretches between two moments, without what the events are. The gaps are free time.",
      properties: { from: { type: "string", description: TIME }, to: { type: "string", description: TIME } },
      required: ["from", "to"],
      async run(c, input) {
        const r = await cal<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(c, "/freeBusy", "POST", { timeMin: moment(input.from, "the start"), timeMax: moment(input.to, "the end"), items: [{ id: "primary" }] });
        const busy = Object.values(r.calendars ?? {})[0]?.busy ?? [];
        return busy.map((b) => `Busy ${b.start.slice(0, 16).replace("T", " ")} to ${b.end.slice(11, 16)} UTC`).join("\n") || "Free the whole time.";
      },
    },
    {
      name: "add_event",
      kind: "write",
      summary: "Add an event",
      description: "Adds an event to the owner's calendar. Guests are added only when given, and are emailed an invitation only when invite_guests is true, so set that only when the owner wants people invited.",
      properties: { title: { type: "string" }, start: { type: "string", description: TIME }, end: { type: "string", description: TIME }, description: { type: "string" }, location: { type: "string" }, guests: { type: "array", items: { type: "string" }, description: "Email addresses." }, invite_guests: { type: "boolean" } },
      required: ["title", "start", "end"],
      async run(c, input) {
        const e = await cal<any>(c, `/calendars/primary/events${query({ sendUpdates: input.invite_guests === true ? "all" : "none" })}`, "POST", eventBody(input));
        return `Added: ${eventLine(e)}${input.guests?.length ? (input.invite_guests === true ? " Guests were emailed an invitation." : " Guests were not emailed.") : ""}`;
      },
    },
    {
      name: "change_event",
      kind: "write",
      summary: "Change or move an event",
      description: "Changes an event: its title, time, place, description or guests. Give only what changes; a new guest list replaces the old one. Guests are emailed about the change only when tell_guests is true.",
      properties: { event: { type: "string", description: "The event's number in brackets, from list_events." }, title: { type: "string" }, start: { type: "string", description: TIME }, end: { type: "string", description: TIME }, description: { type: "string" }, location: { type: "string" }, guests: { type: "array", items: { type: "string" } }, tell_guests: { type: "boolean" } },
      required: ["event"],
      async run(c, input) {
        const change = eventBody(input);
        if (!Object.keys(change).length) throw new Error("Say what to change.");
        return `Changed: ${eventLine(await cal<any>(c, `/calendars/primary/events/${id(input.event)}${query({ sendUpdates: input.tell_guests === true ? "all" : "none" })}`, "PATCH", change))}`;
      },
    },
    {
      name: "remove_event",
      kind: "destructive",
      summary: "Remove an event",
      description: "Removes an event from the calendar. Guests are told only when tell_guests is true.",
      properties: { event: { type: "string" }, tell_guests: { type: "boolean" } },
      required: ["event"],
      async run(c, input) {
        await cal(c, `/calendars/primary/events/${id(input.event)}${query({ sendUpdates: input.tell_guests === true ? "all" : "none" })}`, "DELETE");
        return `Removed event ${input.event}.`;
      },
    },
  ],
};

// ---------- Google Drive ----------
const drive = <T = any>(c: C, path: string, opts: { text?: number } = {}) => call<T>(`${baseOf("googledrive", "https://www.googleapis.com")}/drive/v3${path}`, { name: "Google Drive", headers: bearer(c), ...opts });
const quote = (t: string) => t.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const KINDS: Record<string, string> = { "application/vnd.google-apps.document": "Google Doc", "application/vnd.google-apps.spreadsheet": "Google Sheet", "application/vnd.google-apps.presentation": "Google Slides", "application/vnd.google-apps.folder": "folder", "application/pdf": "PDF" };
const EXPORT: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };

export const googleDrive: ServiceDef = {
  id: "googledrive",
  name: "Google Drive",
  category: "Files and documents",
  about: "Find and read the files in your Google Drive, including Google Docs, Sheets and Slides, and save new text files there.",
  steps: [],
  docs: DOCS,
  fields: [],
  browser: signIn("Google Drive API", ["drive.readonly", "drive.file"]),
  check: whoAmI,
  actions: [
    {
      name: "find_files",
      kind: "read",
      summary: "Find files and folders",
      description: "Finds files by words in their name, or with in_text by words inside them, most recently changed first. Give folder (a folder's number) to list what is in it.",
      properties: { words: { type: "string" }, in_text: { type: "boolean", description: "Look inside the files, not only at their names." }, folder: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const parts = ["trashed = false", ...(input.words ? [`${input.in_text ? "fullText" : "name"} contains '${quote(String(input.words).slice(0, 200))}'`] : []), ...(input.folder ? [`'${id(input.folder)}' in parents`] : [])];
        const r = await drive<{ files: any[] }>(c, `/files${query({ q: parts.join(" and "), pageSize: count(input.limit, 20, 50), orderBy: input.in_text && input.words ? undefined : "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,size)" })}`);
        return (r.files ?? []).map((f) => `[${f.id}] ${plain(f.name, 160)} · ${KINDS[f.mimeType] ?? f.mimeType} · changed ${String(f.modifiedTime ?? "").slice(0, 10)}`).join("\n") || "No files match.";
      },
    },
    {
      name: "read_file",
      kind: "read",
      summary: "Read a file's text",
      description: "Returns the text of a file: a Google Doc or Slides as plain text, a Google Sheet's first sheet as CSV, or a plain text file. Other kinds (PDFs, pictures, Office files) cannot be read here.",
      properties: { file: { type: "string", description: "The file's number in brackets, from find_files." } },
      required: ["file"],
      async run(c, input) {
        const f = await drive<{ name: string; mimeType: string; size?: string }>(c, `/files/${id(input.file)}${query({ fields: "name,mimeType,size" })}`);
        const as = EXPORT[f.mimeType];
        if (as) return `${plain(f.name, 160)}\n\n${await drive<string>(c, `/files/${id(input.file)}/export${query({ mimeType: as })}`, { text: 60_000 })}`;
        if (!/^text\/|json|xml|csv|markdown/.test(f.mimeType)) return `“${plain(f.name, 160)}” is a ${KINDS[f.mimeType] ?? f.mimeType}, which cannot be read as text here.`;
        if (Number(f.size) > 2_000_000) return `“${plain(f.name, 160)}” is too large to read here.`;
        return `${plain(f.name, 160)}\n\n${await drive<string>(c, `/files/${id(input.file)}${query({ alt: "media" })}`, { text: 60_000 })}`;
      },
    },
    {
      name: "save_text_file",
      kind: "write",
      summary: "Save a new text file",
      description: "Saves a new plain text or Markdown file in the owner's Drive, optionally in a folder. It never changes or replaces an existing file.",
      properties: { name: { type: "string", description: "The file's name, such as Notes.md." }, text: { type: "string" }, folder: { type: "string", description: "A folder's number, from find_files." } },
      required: ["name", "text"],
      async run(c, input) {
        const name = oneLine(input.name, 200) || "Untitled.txt";
        const boundary = `talqava${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        const meta = { name, mimeType: /\.md$/i.test(name) ? "text/markdown" : "text/plain", ...(input.folder ? { parents: [id(input.folder)] } : {}) };
        const data = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${meta.mimeType}; charset=UTF-8\r\n\r\n${String(input.text).slice(0, 4_000_000)}\r\n--${boundary}--`;
        const f = await call<{ id: string; name: string }>(`${baseOf("googledrive", "https://www.googleapis.com")}/upload/drive/v3/files?uploadType=multipart`, { name: "Google Drive", method: "POST", headers: bearer(c), raw: { type: `multipart/related; boundary=${boundary}`, data } });
        return `Saved “${f.name}” in Google Drive (${f.id}).`;
      },
    },
  ],
};
