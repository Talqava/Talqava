// Brevo: contacts, lists and email campaigns' results. Facts from Brevo's developer documentation
// (developers.brevo.com) and help centre, read November 2026: the key (it starts with xkeysib-) is made under
// Settings › SMTP & API › API Keys & MCP and sent in the api-key header to https://api.brevo.com/v3; a key can be
// limited to some areas; a key not used for 90 days is switched off; Brevo may start refusing calls from internet
// addresses it has not seen (Settings › Security › Authorized IPs). Brevo's browser sign-in needs an app made with
// its command-line tool, and one that needs no secret only after Brevo's review, so it connects with the key.
// Agents do not send email or campaigns from here. Not confirmed there: the answer for an unrecognised address.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("brevo", "https://api.brevo.com/v3")}${path}`, { name: "Brevo", method, headers: { "api-key": c.values.api_key }, body });

const email = (v: unknown) => {
  const t = String(v ?? "").trim().toLowerCase();
  if (!/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(t) || t.length > 250) throw new Error("That email address does not look right.");
  return t;
};
const listId = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!/^\d{1,12}$/.test(t)) throw new Error("Give the list's number, from list_lists.");
  return Number(t);
};
const names = (input: Record<string, any>) => ({ ...(plain(input.first_name, 100) ? { FIRSTNAME: plain(input.first_name, 100) } : {}), ...(plain(input.last_name, 100) ? { LASTNAME: plain(input.last_name, 100) } : {}) });
const contactLine = (p: any) => `${plain(p.email, 160) || `(no email, contact ${p.id})`}${p.attributes?.FIRSTNAME || p.attributes?.LASTNAME ? ` · ${plain(`${p.attributes?.FIRSTNAME ?? ""} ${p.attributes?.LASTNAME ?? ""}`, 120)}` : ""}${p.emailBlacklisted ? " · unsubscribed" : ""}${p.listIds?.length ? ` · lists ${p.listIds.slice(0, 10).join(", ")}` : ""} · added ${String(p.createdAt ?? "").slice(0, 10)}`;
const pct = (part: unknown, whole: unknown) => (Number(whole) > 0 ? ` (${Math.round((Number(part) / Number(whole)) * 100)}%)` : "");
const campaignLine = (m: any) => {
  const s = m.statistics?.globalStats;
  return `[${m.id}] ${plain(m.name, 120)} · “${plain(m.subject, 120)}” · ${plain(m.status, 20)}${m.sentDate ? ` · sent ${String(m.sentDate).slice(0, 10)}` : m.scheduledAt ? ` · scheduled ${String(m.scheduledAt).slice(0, 10)}` : ""}${s && Number(s.delivered) ? ` · delivered ${s.delivered} · opened ${s.uniqueViews}${pct(s.uniqueViews, s.delivered)} · clicked ${s.uniqueClicks}${pct(s.uniqueClicks, s.delivered)} · unsubscribed ${s.unsubscriptions} · bounced ${Number(s.hardBounces ?? 0) + Number(s.softBounces ?? 0)}` : ""}`;
};

export const brevo: ServiceDef = {
  id: "brevo",
  name: "Brevo",
  category: "Email marketing",
  about: "See your Brevo contacts, lists and how campaigns did, and add or update contacts. Agents do not send campaigns.",
  steps: [
    "In Brevo, open Settings › SMTP & API › API Keys & MCP and press Generate API key.",
    "Name it Talqava. For access, give Read-write on Contacts and Read on Email campaigns and Account (or choose Full).",
    "Copy the key (it starts with xkeysib-) and paste it below. Brevo shows it only once.",
    "If Brevo later refuses this computer, open Settings › Security › Authorized IPs in Brevo and authorize the address it names, or switch off blocking for API keys.",
  ],
  docs: "https://help.brevo.com/hc/en-us/articles/209467485",
  fields: [{ key: "api_key", label: "API key", secret: true, placeholder: "xkeysib-…" }],
  async check(values) {
    const api_key = String(values.api_key ?? "").trim();
    if (!/^[\w-]{20,300}$/.test(api_key)) throw new Error("That does not look like a Brevo API key. It starts with xkeysib-.");
    const me = await api<{ email?: string; companyName?: string }>({ values: { api_key } }, "/account");
    if (!me?.email) throw Object.assign(new Error("Brevo did not say whose account this is. Check that the key may read Account."), { refused: true });
    return { label: `${plain(me.companyName, 80) || "Your account"} (${plain(me.email, 120)})`, values: { api_key } };
  },
  triggers: [
    {
      name: "new_contact",
      summary: "A new contact is added",
      list: async (c) => ((await api<{ contacts: any[] }>(c, `/contacts${query({ sort: "desc", limit: 25 })}`)).contacts ?? []).map((p) => String(p.id)),
      async describe(c, id) {
        if (!/^\d{1,15}$/.test(id)) throw new Error("That is not a contact of this account.");
        const p = await api<any>(c, `/contacts/${id}${query({ identifierType: "contact_id" })}`);
        return { title: `New contact: ${plain(p.email, 120) || id}`, text: contactLine(p) };
      },
    },
  ],
  actions: [
    {
      name: "list_lists",
      kind: "read",
      summary: "See your contact lists",
      description: "Lists your contact lists with each one's number and how many people are on it.",
      properties: {},
      async run(c) {
        const r = await api<{ lists: any[] }>(c, `/contacts/lists${query({ limit: 50, sort: "desc" })}`);
        return (r.lists ?? []).map((l) => `[${l.id}] ${plain(l.name, 120)} · ${Number(l.uniqueSubscribers ?? 0)} people`).join("\n") || "There are no lists.";
      },
    },
    {
      name: "list_contacts",
      kind: "read",
      summary: "See contacts, newest first",
      description: "Lists contacts, newest first, across the account or on one list: email, name, whether they unsubscribed, and their lists.",
      properties: { list: { type: "string", description: "Optional: a list's number, from list_lists." }, limit: { type: "number", description: "How many, at most 200. Usually 30." } },
      async run(c, input) {
        const limit = count(input.limit, 30, 200);
        const r = await api<{ contacts: any[]; count?: number }>(c, input.list ? `/contacts/lists/${listId(input.list)}/contacts${query({ limit, sort: "desc" })}` : `/contacts${query({ limit, sort: "desc" })}`);
        return (r.contacts ?? []).map(contactLine).join("\n") || "No contacts.";
      },
    },
    {
      name: "get_contact",
      kind: "read",
      summary: "Look one person up by email",
      description: "Returns one contact by email address: name, lists, and whether they unsubscribed.",
      properties: { email: { type: "string" } },
      required: ["email"],
      async run(c, input) {
        const p = await api<any>(c, `/contacts/${encodeURIComponent(email(input.email))}${query({ identifierType: "email_id" })}`);
        return contactLine(p);
      },
    },
    {
      name: "add_contact",
      kind: "write",
      summary: "Add a contact, or update one that exists",
      description: "Adds a person by email address, with an optional name and lists to put them on. If they are already a contact, their details are updated. Only add people who agreed to hear from the owner; nothing is sent to them from here.",
      properties: { email: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, lists: { type: "array", items: { type: "string" }, description: "Optional: list numbers, from list_lists." } },
      required: ["email"],
      async run(c, input) {
        const listIds = (Array.isArray(input.lists) ? input.lists : []).slice(0, 20).map(listId);
        const address = email(input.email);
        await api(c, "/contacts", "POST", { email: address, ...(Object.keys(names(input)).length ? { attributes: names(input) } : {}), ...(listIds.length ? { listIds } : {}), updateEnabled: true });
        return `Saved the contact ${address}${listIds.length ? ` on list${listIds.length > 1 ? "s" : ""} ${listIds.join(", ")}` : ""}.`;
      },
    },
    {
      name: "update_contact",
      kind: "write",
      summary: "Change a contact's name, lists or subscription",
      description: "Changes a contact: their name, lists to add them to or take them off, or marks them unsubscribed from emails (or subscribed again, only at their own request).",
      properties: { email: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, add_to_lists: { type: "array", items: { type: "string" } }, remove_from_lists: { type: "array", items: { type: "string" } }, unsubscribed: { type: "boolean", description: "true: no more emails to this person. false: subscribed again." } },
      required: ["email"],
      async run(c, input) {
        const add = (Array.isArray(input.add_to_lists) ? input.add_to_lists : []).slice(0, 20).map(listId);
        const remove = (Array.isArray(input.remove_from_lists) ? input.remove_from_lists : []).slice(0, 20).map(listId);
        const change = { ...(Object.keys(names(input)).length ? { attributes: names(input) } : {}), ...(add.length ? { listIds: add } : {}), ...(remove.length ? { unlinkListIds: remove } : {}), ...(typeof input.unsubscribed === "boolean" ? { emailBlacklisted: input.unsubscribed } : {}) };
        if (!Object.keys(change).length) throw new Error("Say what to change: the name, lists, or whether they are unsubscribed.");
        const address = email(input.email);
        await api(c, `/contacts/${encodeURIComponent(address)}${query({ identifierType: "email_id" })}`, "PUT", change);
        return `Updated the contact ${address}.`;
      },
    },
    {
      name: "list_campaigns",
      kind: "read",
      summary: "See email campaigns and how they did",
      description: "Lists email campaigns, newest first, with their results: delivered, opened, clicked, unsubscribed and bounced. Results cover the last six months. Brevo allows about 100 of these requests an hour, so do not repeat it needlessly.",
      properties: { status: { type: "string", enum: ["sent", "draft", "queued", "suspended", "archive"], description: "Usually sent." }, limit: { type: "number", description: "How many, at most 50. Usually 10." } },
      async run(c, input) {
        const status = String(input.status ?? "sent");
        if (!["sent", "draft", "queued", "suspended", "archive"].includes(status)) throw new Error("For status, choose one of: sent, draft, queued, suspended, archive.");
        const r = await api<{ campaigns: any[] }>(c, `/emailCampaigns${query({ status, statistics: "globalStats", limit: count(input.limit, 10, 50), sort: "desc", excludeHtmlContent: true })}`);
        return (r.campaigns ?? []).map(campaignLine).join("\n") || "No campaigns match.";
      },
    },
  ],
};
