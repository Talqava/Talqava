// Freshdesk: support tickets. Facts from Freshdesk's API reference (developers.freshdesk.com/api), read November
// 2026: the API key from the agent's profile page is sent as the name of a Basic sign-in with any password, to
// https://<domain>.freshdesk.com/api/v2; status is 2 Open, 3 Pending, 4 Resolved, 5 Closed and priority 1 Low to
// 4 Urgent; the list of tickets covers the last 30 days unless updated_since is given; a ticket's description comes
// only when asked for. The reference describes no browser sign-in for other apps, so it connects with the key.
// Not confirmed there in so many words: that a reply is emailed to the customer (its fields are described as those
// of "the outgoing ticket email"); a reply is treated here as reaching the customer and always asks the owner.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const base = (c: Keys) => (process.env.TALQAVA_FRESHDESK_API || `https://${c.values.domain}.freshdesk.com/api/v2`).replace(/\/+$/, "");
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) => call<T>(`${base(c)}${path}`, { name: "Freshdesk", method, headers: { authorization: `Basic ${Buffer.from(`${c.values.api_key}:X`).toString("base64")}` }, body });

const STATUS: Record<string, number> = { open: 2, pending: 3, resolved: 4, closed: 5 };
const PRIORITY: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };
const nameOf = (codes: Record<string, number>, n: unknown) => Object.entries(codes).find(([, v]) => v === Number(n))?.[0] ?? String(n ?? "");
const code = (codes: Record<string, number>, v: unknown, what: string) => {
  const n = codes[String(v).toLowerCase()];
  if (!n) throw new Error(`For ${what}, choose one of: ${Object.keys(codes).join(", ")}.`);
  return n;
};
const num = (v: unknown) => {
  const t = String(v ?? "").replace(/^#/, "").trim();
  if (!/^\d{1,15}$/.test(t)) throw new Error("Give the ticket's number.");
  return t;
};
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);
const html = (v: unknown, most: number) => text(v, most).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const line = (t: any) => `[${t.id}] ${plain(t.subject || "(no subject)", 140)} · ${nameOf(STATUS, t.status)} · ${nameOf(PRIORITY, t.priority)}${t.requester?.name ? ` · from ${plain(t.requester.name, 80)}` : ""} · updated ${String(t.updated_at ?? "").slice(0, 10)}`;

export const freshdesk: ServiceDef = {
  id: "freshdesk",
  name: "Freshdesk",
  category: "Customer support",
  about: "Read your Freshdesk support tickets, add private notes, reply to customers and update tickets.",
  steps: [
    "In Freshdesk, click your picture at the top right and open Profile settings.",
    "Your API key is on the right of that page, below the change password section. Copy it.",
    "Your helpdesk domain is the first part of the address you use Freshdesk at: yourcompany.freshdesk.com.",
  ],
  docs: "https://developers.freshdesk.com/api/#authentication",
  fields: [
    { key: "domain", label: "Helpdesk domain", placeholder: "yourcompany", help: "The first part of yourcompany.freshdesk.com.", pattern: "[a-z0-9][a-z0-9-]{0,61}[a-z0-9]" },
    { key: "api_key", label: "API key", secret: true },
  ],
  async check(values) {
    const domain = String(values.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.freshdesk\.com.*$/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(domain)) throw new Error("Give your helpdesk domain: the first part of yourcompany.freshdesk.com.");
    const api_key = String(values.api_key ?? "").trim();
    if (!api_key || /[\s:]/.test(api_key) || api_key.length > 200) throw new Error("Paste the API key from your Freshdesk profile page.");
    const me = await api<{ id: number; contact?: { name?: string; email?: string } }>({ values: { domain, api_key } }, "/agents/me");
    if (!me?.id) throw Object.assign(new Error("Freshdesk did not say who signed in. Check the key."), { refused: true });
    return { label: `${plain(me.contact?.name, 80) || plain(me.contact?.email, 120) || "Your account"} (${domain}.freshdesk.com)`, values: { domain, api_key } };
  },
  triggers: [
    {
      name: "new_ticket",
      summary: "A new ticket arrives",
      list: async (c) => (await api<any[]>(c, `/tickets${query({ order_by: "created_at", order_type: "desc", per_page: 25 })}`)).map((t) => String(t.id)),
      async describe(c, ticket) {
        const t = await api<any>(c, `/tickets/${num(ticket)}${query({ include: "requester" })}`);
        return { title: `Ticket: ${plain(t.subject || "(no subject)", 140)}`, text: `${line(t)}\n\n${text(t.description_text, 4000)}` };
      },
    },
  ],
  actions: [
    {
      name: "list_tickets",
      kind: "read",
      summary: "See the most recently updated tickets",
      description: "Lists tickets, most recently updated first: number, subject, status, priority and who it is from. Usually those created in the last 30 days; give since to go further back. mine_and_new shows only new tickets and your own open ones.",
      properties: { mine_and_new: { type: "boolean" }, since: { type: "string", description: "Optional: only tickets updated since this day, like 2026-09-01." }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        const since = String(input.since ?? "").trim();
        if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))) throw new Error("Give since as a date like 2026-09-01.");
        const list = await api<any[]>(c, `/tickets${query({ filter: input.mine_and_new ? "new_and_my_open" : "", updated_since: since ? `${since}T00:00:00Z` : "", order_by: "updated_at", order_type: "desc", include: "requester", per_page: count(input.limit, 30, 100) })}`);
        return list.map(line).join("\n") || "There are no tickets.";
      },
    },
    {
      name: "find_tickets",
      kind: "read",
      summary: "Find tickets by status, priority or tag",
      description: "Finds tickets by status, priority, a tag, or a mix of them (up to 30). It does not search the words inside tickets, and very recent changes can take a few minutes to show.",
      properties: { status: { type: "string", enum: Object.keys(STATUS) }, priority: { type: "string", enum: Object.keys(PRIORITY) }, tag: { type: "string" } },
      async run(c, input) {
        const tag = plain(input.tag, 60).replace(/['"\\]/g, "");
        const parts = [...(input.status ? [`status:${code(STATUS, input.status, "status")}`] : []), ...(input.priority ? [`priority:${code(PRIORITY, input.priority, "priority")}`] : []), ...(tag ? [`tag:'${tag}'`] : [])];
        if (!parts.length) throw new Error("Give a status, a priority, a tag, or a mix of them.");
        const r = await api<{ total: number; results: any[] }>(c, `/search/tickets${query({ query: `"${parts.join(" AND ")}"` })}`);
        return (r.results ?? []).length ? `${r.results.map(line).join("\n")}${r.total > r.results.length ? `\n(${r.total} in all)` : ""}` : "No tickets match.";
      },
    },
    {
      name: "get_ticket",
      kind: "read",
      summary: "Read one ticket and its conversation",
      description: "Returns one ticket with its description and its conversation in order: who wrote each message, and whether it is a private note or visible to the customer.",
      properties: { ticket: { type: "string", description: "The ticket's number." } },
      required: ["ticket"],
      async run(c, input) {
        const id = num(input.ticket);
        const t = await api<any>(c, `/tickets/${id}${query({ include: "requester" })}`);
        const talk = await api<any[]>(c, `/tickets/${id}/conversations${query({ per_page: 30 })}`);
        const said = talk.map((m) => `${String(m.created_at ?? "").slice(0, 16).replace("T", " ")} · ${m.incoming ? "the customer" : m.private ? "private note" : "reply to the customer"}\n${text(m.body_text, 3000)}`);
        return `${line(t)}${t.requester?.email ? `\nCustomer: ${plain(t.requester.email, 120)}` : ""}${t.tags?.length ? `\nTags: ${t.tags.slice(0, 20).map((x: unknown) => plain(x, 40)).join(", ")}` : ""}\n\n${text(t.description_text, 6000) || "(no description)"}\n\n${said.join("\n\n") || "No messages yet."}`;
      },
    },
    {
      name: "add_note",
      kind: "write",
      summary: "Add a private note to a ticket",
      description: "Adds a private note to a ticket. The customer does not see it; your colleagues in Freshdesk do.",
      properties: { ticket: { type: "string" }, note: { type: "string", description: "The note, in plain text." } },
      required: ["ticket", "note"],
      async run(c, input) {
        const body = html(input.note, 8000);
        if (!body) throw new Error("Write the note.");
        await api(c, `/tickets/${num(input.ticket)}/notes`, "POST", { body, private: true });
        return `Added a private note to ticket ${num(input.ticket)}. The customer was not told.`;
      },
    },
    {
      name: "reply_to_customer",
      kind: "write",
      alwaysAsk: true,
      summary: "Reply to the customer on a ticket",
      description: "Posts a reply on a ticket; Freshdesk sends it to the customer by email. Always asks the owner first.",
      properties: { ticket: { type: "string" }, reply: { type: "string", description: "The reply, in plain text, ready to send." } },
      required: ["ticket", "reply"],
      async run(c, input) {
        const body = html(input.reply, 8000);
        if (!body) throw new Error("Write the reply.");
        await api(c, `/tickets/${num(input.ticket)}/reply`, "POST", { body });
        return `Replied to the customer on ticket ${num(input.ticket)}.`;
      },
    },
    {
      name: "update_ticket",
      kind: "write",
      summary: "Change a ticket's status or priority",
      description: "Sets a ticket's status (open, pending, resolved or closed), its priority, or both. It does not write to the customer, though your Freshdesk automations may.",
      properties: { ticket: { type: "string" }, status: { type: "string", enum: Object.keys(STATUS) }, priority: { type: "string", enum: Object.keys(PRIORITY) } },
      required: ["ticket"],
      async run(c, input) {
        if (!input.status && !input.priority) throw new Error("Give a status, a priority, or both.");
        const t = await api<any>(c, `/tickets/${num(input.ticket)}`, "PUT", { ...(input.status ? { status: code(STATUS, input.status, "status") } : {}), ...(input.priority ? { priority: code(PRIORITY, input.priority, "priority") } : {}) });
        return `Updated ticket ${line(t)}`;
      },
    },
    {
      name: "create_ticket",
      kind: "write",
      summary: "Open a new ticket",
      description: "Opens a new ticket for a customer, by their email address, with a subject and a first message. Freshdesk may email the customer that it was opened, as your helpdesk is set up to.",
      properties: { customer_email: { type: "string" }, customer_name: { type: "string" }, subject: { type: "string" }, message: { type: "string", description: "The first message, in plain text." }, priority: { type: "string", enum: Object.keys(PRIORITY) } },
      required: ["customer_email", "subject", "message"],
      async run(c, input) {
        const email = String(input.customer_email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        const subject = plain(input.subject, 250);
        const description = html(input.message, 8000);
        if (!subject || !description) throw new Error("Give a subject and a message.");
        const t = await api<any>(c, "/tickets", "POST", { email, ...(plain(input.customer_name, 120) ? { name: plain(input.customer_name, 120) } : {}), subject, description, status: 2, priority: input.priority ? code(PRIORITY, input.priority, "priority") : 1 });
        return `Opened ticket ${t.id}: “${plain(t.subject ?? subject, 160)}” for ${email}.`;
      },
    },
  ],
};
