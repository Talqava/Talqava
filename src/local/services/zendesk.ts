// Zendesk: support tickets. Facts from Zendesk's developer documentation, read November 2026: the OAuth pages
// (grant_type_tokens, oauth-pkce, refresh-token, and the help article on OAuth authentication) and the Ticketing
// reference for tickets, ticket comments, search and users. Signs in through the browser with an OAuth client the
// owner's Zendesk administrator makes (kind: Public, which uses PKCE and has no secret). Zendesk labels API tokens as
// deprecated, so there is no pasted key here.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const base = (c: Pick<Connection, "values">) => (process.env.TALQAVA_ZENDESK_API || `https://${c.values.subdomain}.zendesk.com/api/v2`).replace(/\/+$/, "");
const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${base(c)}${path}`, { name: "Zendesk", method, headers: { authorization: `Bearer ${c.values.access_token}` }, body });
const num = (v: unknown) => {
  const t = String(v ?? "").replace(/^#/, "");
  if (!/^\d{1,15}$/.test(t)) throw new Error("Give the ticket's number, from list_tickets or search_tickets.");
  return t;
};
const STATUSES = ["open", "pending", "hold", "solved"];
const PRIORITIES = ["urgent", "high", "normal", "low"];
const oneOf = (v: unknown, list: string[], what: string) => {
  if (!list.includes(String(v))) throw new Error(`For ${what}, choose one of: ${list.join(", ")}.`);
  return String(v);
};
const line = (t: any) => `[${t.id}] ${plain(t.subject || t.raw_subject || "(no subject)", 140)} · ${t.status}${t.priority ? ` · ${t.priority}` : ""} · updated ${String(t.updated_at ?? "").slice(0, 10)}`;
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);

export const zendesk: ServiceDef = {
  id: "zendesk",
  name: "Zendesk",
  category: "Customer support",
  about: "Read your Zendesk support tickets, add internal notes, reply to customers and update tickets.",
  steps: [],
  docs: "https://support.zendesk.com/hc/en-us/articles/4408845965210-Using-OAuth-authentication-with-your-application",
  fields: [],
  browser: {
    authUrl: "https://{subdomain}.zendesk.com/oauth/authorizations/new",
    tokenUrl: "https://{subdomain}.zendesk.com/oauth/tokens",
    scopes: ["read", "write"],
    secret: "optional",
    idLabel: "Identifier",
    ask: [{ key: "subdomain", label: "Your Zendesk subdomain", placeholder: "yourcompany", help: "The first part of your Zendesk address: yourcompany.zendesk.com.", pattern: "[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" }],
    appSteps: [
      "In Zendesk, an administrator opens Admin Center › Apps and integrations › APIs › OAuth clients and presses Add OAuth client.",
      "Name it Talqava. Note the Identifier Zendesk fills in; that is what you paste below.",
      "For Client kind choose Public. Under Redirect URLs add exactly: {redirect}",
      "Save. Zendesk shows a secret once; a Public client does not need it, so leave the secret empty below.",
      "Type your subdomain and the Identifier below and press the button. Zendesk asks you to allow Talqava.",
    ],
  },
  async check(values) {
    const me = (await api<{ user: { id: number | null; name: string; email: string; role: string } }>({ values }, "/users/me")).user;
    // Zendesk answers this even for someone not signed in, so a real agent or administrator is looked for.
    if (!me?.id || me.role === "end-user") throw Object.assign(new Error("Zendesk signed in someone who is not an agent or administrator there. Sign in as one."), { refused: true });
    return { label: `${me.name} (${values.subdomain}.zendesk.com)` };
  },
  triggers: [
    {
      name: "new_ticket",
      summary: "A new ticket arrives",
      list: async (c) => (await api<{ tickets: any[] }>(c, `/tickets${query({ "page[size]": 25, sort: "-id" })}`)).tickets.map((t) => String(t.id)),
      async describe(c, ticket) {
        const t = (await api<{ ticket: any }>(c, `/tickets/${num(ticket)}`)).ticket;
        return { title: `Ticket: ${plain(t.subject || "(no subject)", 140)}`, text: `Ticket ${t.id} · ${t.status}${t.priority ? ` · ${t.priority}` : ""}\n\n${text(t.description, 4000)}` };
      },
    },
  ],
  actions: [
    {
      name: "list_tickets",
      kind: "read",
      summary: "See the most recently updated tickets",
      description: "Lists tickets, most recently updated first: number, subject, status, priority and the day it was last updated.",
      properties: { limit: { type: "number", description: "How many, at most 100. Usually 25." } },
      async run(c, input) {
        const r = await api<{ tickets: any[] }>(c, `/tickets${query({ "page[size]": count(input.limit, 25, 100), sort: "-updated_at" })}`);
        return r.tickets.map(line).join("\n") || "There are no tickets.";
      },
    },
    {
      name: "search_tickets",
      kind: "read",
      summary: "Find tickets by words or status",
      description: "Finds tickets by words in them and, optionally, by status, most recently updated first.",
      properties: { words: { type: "string", description: "Words to look for. Plain words; do not add search operators." }, status: { type: "string", enum: ["new", ...STATUSES, "closed"] }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        // Colons and quotes are taken out of the words so they cannot turn into search operators of their own.
        const words = String(input.words ?? "").replace(/[:"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        const status = input.status ? ` status:${oneOf(input.status, ["new", ...STATUSES, "closed"], "status")}` : "";
        if (!words && !status) throw new Error("Give words to look for, a status, or both.");
        const r = await api<{ results: any[]; count: number }>(c, `/search${query({ query: `type:ticket${status} ${words}`.trim(), sort_by: "updated_at", sort_order: "desc" })}`);
        const shown = r.results.filter((t) => !t.result_type || t.result_type === "ticket").slice(0, count(input.limit, 20, 50));
        return shown.length ? `${shown.map(line).join("\n")}${r.count > shown.length ? `\n(${r.count} in all)` : ""}` : "No tickets match.";
      },
    },
    {
      name: "get_ticket",
      kind: "read",
      summary: "Read one ticket and its conversation",
      description: "Returns one ticket with its conversation in order: who wrote each message, whether the customer can see it, and its text.",
      properties: { ticket: { type: "string", description: "The ticket's number." } },
      required: ["ticket"],
      async run(c, input) {
        const id = num(input.ticket);
        const t = (await api<{ ticket: any }>(c, `/tickets/${id}`)).ticket;
        const r = await api<{ comments: any[]; users?: { id: number; name: string }[] }>(c, `/tickets/${id}/comments${query({ include: "users", "page[size]": 100 })}`);
        const names = new Map((r.users ?? []).map((u) => [u.id, u.name]));
        const talk = r.comments.map((m) => `${String(m.created_at ?? "").slice(0, 16).replace("T", " ")} · ${plain(names.get(m.author_id) ?? `person ${m.author_id}`, 80)} · ${m.public ? "visible to the customer" : "internal note"}\n${text(m.plain_body ?? m.body, 3000)}`);
        return `${line(t)}${t.tags?.length ? `\nTags: ${t.tags.slice(0, 20).join(", ")}` : ""}\n\n${talk.join("\n\n") || "No messages."}`;
      },
    },
    {
      name: "add_note",
      kind: "write",
      summary: "Add an internal note to a ticket",
      description: "Adds an internal note to a ticket. The customer does not see it; your colleagues in Zendesk do.",
      properties: { ticket: { type: "string" }, note: { type: "string", description: "The note, in plain text." } },
      required: ["ticket", "note"],
      async run(c, input) {
        const body = text(input.note, 8000);
        if (!body) throw new Error("Write the note.");
        const t = (await api<{ ticket: any }>(c, `/tickets/${num(input.ticket)}`, "PUT", { ticket: { comment: { body, public: false } } })).ticket;
        return `Added an internal note to ticket ${t.id} (“${plain(t.subject, 120)}”). The customer was not told.`;
      },
    },
    {
      name: "reply_to_customer",
      kind: "write",
      alwaysAsk: true,
      summary: "Reply to the customer on a ticket",
      description: "Posts a reply the customer sees; Zendesk sends it to them. Optionally sets the ticket's status at the same time. Always asks the owner first.",
      properties: { ticket: { type: "string" }, reply: { type: "string", description: "The reply, in plain text, ready to send." }, status: { type: "string", enum: STATUSES, description: "Optional: the status to set, such as pending or solved." } },
      required: ["ticket", "reply"],
      async run(c, input) {
        const body = text(input.reply, 8000);
        if (!body) throw new Error("Write the reply.");
        const t = (await api<{ ticket: any }>(c, `/tickets/${num(input.ticket)}`, "PUT", { ticket: { comment: { body, public: true }, ...(input.status ? { status: oneOf(input.status, STATUSES, "status") } : {}) } })).ticket;
        return `Replied to the customer on ticket ${t.id} (“${plain(t.subject, 120)}”). Status: ${t.status}.`;
      },
    },
    {
      name: "update_ticket",
      kind: "write",
      summary: "Change a ticket's status or priority",
      description: "Sets a ticket's status (open, pending, hold or solved), its priority, or both. It does not write to the customer.",
      properties: { ticket: { type: "string" }, status: { type: "string", enum: STATUSES }, priority: { type: "string", enum: PRIORITIES } },
      required: ["ticket"],
      async run(c, input) {
        if (!input.status && !input.priority) throw new Error("Give a status, a priority, or both.");
        const change = { ...(input.status ? { status: oneOf(input.status, STATUSES, "status") } : {}), ...(input.priority ? { priority: oneOf(input.priority, PRIORITIES, "priority") } : {}) };
        const t = (await api<{ ticket: any }>(c, `/tickets/${num(input.ticket)}`, "PUT", { ticket: change })).ticket;
        return `Updated ticket ${line(t)}`;
      },
    },
    {
      name: "create_ticket",
      kind: "write",
      summary: "Open a new ticket",
      description: "Opens a new ticket on behalf of a customer, with a subject and a first message. Give the customer's email address so Zendesk knows who it is for.",
      properties: { subject: { type: "string" }, message: { type: "string", description: "The first message, in plain text." }, customer_email: { type: "string" }, customer_name: { type: "string" }, priority: { type: "string", enum: PRIORITIES } },
      required: ["subject", "message", "customer_email"],
      async run(c, input) {
        const email = String(input.customer_email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        const subject = plain(input.subject, 200);
        const body = text(input.message, 8000);
        if (!subject || !body) throw new Error("Give a subject and a message.");
        const t = (await api<{ ticket: any }>(c, "/tickets", "POST", { ticket: { subject, comment: { body }, requester: { name: plain(input.customer_name, 120) || email, email }, ...(input.priority ? { priority: oneOf(input.priority, PRIORITIES, "priority") } : {}) } })).ticket;
        return `Opened ticket ${t.id}: “${plain(t.subject, 160)}” for ${email}.`;
      },
    },
  ],
};
