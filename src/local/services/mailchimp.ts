// Mailchimp: audiences, the people in them, and campaigns. Facts from Mailchimp's Marketing API documentation, read
// November 2026: mailchimp.com/developer/marketing/api-concepts/authentication and the reference for the root,
// lists, list members, search-members and campaigns. A key ends in its data centre (such as -us21); the address for
// that data centre is tried first and Mailchimp's general address second, and whichever answers is kept. Talqava does
// not create or send campaigns.
import crypto from "node:crypto";
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const hosts = (key: string): string[] => {
  if (process.env.TALQAVA_MAILCHIMP_API) return [process.env.TALQAVA_MAILCHIMP_API.replace(/\/+$/, "")];
  const dc = /-([a-z]{2,4}\d{1,3})$/.exec(key)?.[1];
  return [...(dc ? [`https://${dc}.api.mailchimp.com/3.0`] : []), "https://api.mailchimp.com/3.0"];
};
const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${c.values.base}${path}`, { name: "Mailchimp", method, headers: { authorization: `Bearer ${c.values.key}` }, body });
const listId = (v: unknown) => {
  const t = String(v ?? "");
  if (!/^[A-Za-z0-9]{4,20}$/.test(t)) throw new Error("Give the audience's number in brackets, from list_audiences.");
  return t;
};
const member = (m: any) => `${m.email_address} · ${m.status}${m.full_name ? ` · ${plain(m.full_name, 100)}` : ""}${(m.tags ?? []).length ? ` · tags: ${m.tags.map((t: any) => plain(t.name, 40)).join(", ")}` : ""}`;
const STATUSES = ["subscribed", "pending", "unsubscribed"];

export const mailchimp: ServiceDef = {
  id: "mailchimp",
  name: "Mailchimp",
  category: "Email marketing",
  about: "See your Mailchimp audiences and campaigns, look people up, and add or update the people on your lists.",
  steps: [
    "In Mailchimp, click your profile icon and choose Profile.",
    "Open the Extras menu, choose API keys, and press Create A Key. Name it Talqava and press Generate Key.",
    "Copy the key and paste it below. Mailchimp shows it only once, and it gives full access to your account.",
  ],
  docs: "https://mailchimp.com/developer/marketing/api-concepts/authentication/",
  fields: [{ key: "key", label: "API key", secret: true }],
  async check(values) {
    let last: unknown;
    for (const base of hosts(values.key)) {
      try {
        const root = await api<{ account_name: string }>({ values: { ...values, base } }, "/");
        return { label: root.account_name || "Mailchimp account", values: { base } };
      } catch (err) {
        last = err;
      }
    }
    throw last;
  },
  actions: [
    {
      name: "list_audiences",
      kind: "read",
      summary: "See your audiences and how many people are in each",
      description: "Lists the audiences (mailing lists) with how many people each has. Start here to get an audience's number.",
      properties: {},
      async run(c) {
        const r = await api<{ lists: any[] }>(c, `/lists${query({ count: 100, fields: "lists.id,lists.name,lists.stats.member_count" })}`);
        return r.lists.map((l) => `[${l.id}] ${plain(l.name, 120)} · ${l.stats?.member_count ?? 0} subscribed`).join("\n") || "No audiences.";
      },
    },
    {
      name: "find_people",
      kind: "read",
      summary: "Look people up, or see who is in an audience",
      description: "Finds people by email address or name (give words), or lists the people of one audience (give audience), optionally only those with one status.",
      properties: { words: { type: "string", description: "An email address or a name." }, audience: { type: "string" }, status: { type: "string", enum: [...STATUSES, "cleaned"] }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        if (input.words) {
          const r = await api<{ exact_matches?: { members: any[] }; full_search?: { members: any[] } }>(c, `/search-members${query({ query: String(input.words).slice(0, 200), list_id: input.audience ? listId(input.audience) : undefined })}`);
          const found = [...(r.exact_matches?.members ?? []), ...(r.full_search?.members ?? [])];
          return found.slice(0, count(input.limit, 30, 100)).map(member).join("\n") || "Nobody matches.";
        }
        if (!input.audience) throw new Error("Give words to look for, or an audience to list.");
        const r = await api<{ members: any[]; total_items: number }>(c, `/lists/${listId(input.audience)}/members${query({ count: count(input.limit, 30, 100), status: input.status })}`);
        return r.members.length ? `${r.total_items} in all, showing ${r.members.length}.\n${r.members.map(member).join("\n")}` : "Nobody.";
      },
    },
    {
      name: "list_campaigns",
      kind: "read",
      summary: "See your campaigns and when they were sent",
      description: "Lists campaigns with their status and how many emails each sent. Give status to see only drafts (save), scheduled (schedule) or sent ones.",
      properties: { status: { type: "string", enum: ["save", "schedule", "sending", "sent", "paused"] }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const r = await api<{ campaigns: any[] }>(c, `/campaigns${query({ count: count(input.limit, 20, 50), status: input.status })}`);
        return r.campaigns.map((k) => `[${k.id}] ${plain(k.settings?.title || k.settings?.subject_line, 140) || "(no title)"} · ${k.status}${k.send_time ? ` · sent ${String(k.send_time).slice(0, 10)}` : ""}${k.emails_sent ? ` · ${k.emails_sent} emails` : ""}`).join("\n") || "No campaigns.";
      },
    },
    {
      name: "save_person",
      kind: "write",
      summary: "Add someone to an audience, or update them",
      description:
        "Adds a person to an audience, or updates them if they are already there. Only add people who asked to hear from the owner. For someone new, status says how they start: pending sends them Mailchimp's confirmation email first (the safe choice), subscribed adds them at once, unsubscribed records them without sending. Names and tags are optional.",
      properties: { audience: { type: "string" }, email: { type: "string" }, status_if_new: { type: "string", enum: STATUSES }, first_name: { type: "string" }, last_name: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["audience", "email", "status_if_new"],
      async run(c, input) {
        const email = String(input.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        if (!STATUSES.includes(String(input.status_if_new))) throw new Error(`For someone new, choose one of: ${STATUSES.join(", ")}.`);
        const merge = { ...(input.first_name ? { FNAME: String(input.first_name).slice(0, 100) } : {}), ...(input.last_name ? { LNAME: String(input.last_name).slice(0, 100) } : {}) };
        const tags = Array.isArray(input.tags) ? input.tags.map((t: unknown) => String(t).slice(0, 60)).filter(Boolean).slice(0, 10) : [];
        const hash = crypto.createHash("md5").update(email).digest("hex");
        const m = await api<any>(c, `/lists/${listId(input.audience)}/members/${hash}`, "PUT", { email_address: email, status_if_new: input.status_if_new, ...(Object.keys(merge).length ? { merge_fields: merge } : {}), ...(tags.length ? { tags } : {}) });
        return `Saved: ${member(m)}`;
      },
    },
  ],
};
