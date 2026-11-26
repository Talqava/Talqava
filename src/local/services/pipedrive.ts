// Pipedrive: deals, people, organizations, notes and activities. Facts from Pipedrive's developer documentation
// (pipedrive.readme.io and developers.pipedrive.com), read November 2026: the token is sent in the x-api-token
// header to https://{company}.pipedrive.com/api/v2; version 2 is current for deals, persons, organizations,
// activities, pipelines, stages and search, while notes and users/me are documented in version 1 only. It connects
// with the owner's personal API token: Pipedrive's browser sign-in needs an app made in a developer sandbox account,
// always needs the app's secret, and its pages do not say a localhost return address is accepted. Not confirmed
// there: the exact fields of a deal, person or search answer, so they are read without assuming all are present.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
// Signed in through the browser, Pipedrive names the address to use (api_domain) in its token answer; with a token, the company's own.
const apiDomain = (c: Keys) => (/^https:\/\/[a-z0-9][a-z0-9-]{0,61}\.pipedrive\.com$/.test(String(c.values.api_domain)) ? `${c.values.api_domain}/api` : "");
const base = (c: Keys) => (process.env.TALQAVA_PIPEDRIVE_API || apiDomain(c) || `https://${c.values.domain}.pipedrive.com/api`).replace(/\/+$/, "");
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) => call<T>(`${base(c)}${path}`, { name: "Pipedrive", method, headers: c.values.access_token ? { authorization: `Bearer ${c.values.access_token}` } : { "x-api-token": c.values.api_token }, body });

const id = (v: unknown, what: string) => {
  const t = String(v ?? "").trim();
  if (!/^\d{1,15}$/.test(t)) throw new Error(`Give the ${what}'s number.`);
  return Number(t);
};
const oneOf = (v: unknown, list: string[], what: string) => {
  if (!list.includes(String(v))) throw new Error(`For ${what}, choose one of: ${list.join(", ")}.`);
  return String(v);
};
const term = (v: unknown) => {
  const t = plain(v, 100);
  if (t.length < 2) throw new Error("Give at least two letters to look for.");
  return t;
};
const html = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const found = (r: any): any[] => (Array.isArray(r?.data?.items) ? r.data.items : Array.isArray(r?.data) ? r.data : []).map((x: any) => x?.item ?? x);
const dealLine = (d: any) => `[${d.id}] ${plain(d.title, 140)}${d.value != null ? ` · ${Number(d.value).toLocaleString("en-US")} ${plain(d.currency, 3)}`.trimEnd() : ""}${d.status ? ` · ${plain(d.status, 20)}` : ""}${d.stage_id != null ? ` · stage ${plain(d.stage?.name ?? d.stage_id, 60)}` : d.stage?.name ? ` · stage ${plain(d.stage.name, 60)}` : ""}${d.update_time ? ` · updated ${day(d.update_time)}` : ""}`;
const emailOf = (p: any) => plain((Array.isArray(p.emails) ? (p.emails.find((e: any) => e?.primary) ?? p.emails[0]) : null)?.value ?? (Array.isArray(p.emails) ? p.emails[0] : "") ?? "", 120);
const personLine = (p: any) => `[${p.id}] ${plain(p.name, 120)}${emailOf(p) ? ` · ${emailOf(p)}` : ""}${p.organization?.name ? ` · ${plain(p.organization.name, 100)}` : ""}`;

export const pipedrive: ServiceDef = {
  id: "pipedrive",
  name: "Pipedrive",
  category: "Sales and customer records",
  about: "Find and update Pipedrive deals, people and organizations, add notes and plan activities.",
  steps: [
    "In Pipedrive, click your account name at the top right and open Company settings › Personal preferences › API (app.pipedrive.com/settings/api).",
    "Copy Your personal API token. If there is no API page, an administrator has to switch API access on for you first.",
    "Your company domain is the first part of the address you use Pipedrive at: yourcompany.pipedrive.com.",
  ],
  docs: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
  fields: [
    { key: "domain", label: "Company domain", placeholder: "yourcompany", help: "The first part of yourcompany.pipedrive.com.", pattern: "[a-z0-9][a-z0-9-]{0,61}[a-z0-9]" },
    { key: "api_token", label: "Personal API token", secret: true },
  ],
  // Browser sign-in with the owner's own Pipedrive app. Making one needs a Pipedrive developer sandbox account;
  // the app's secret is always needed, sent as a Basic sign-in header; its pages do not describe PKCE, and do not
  // say whether an address on this computer is accepted. The permissions are chosen on the app itself.
  browser: {
    authUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    scopes: [],
    secret: "required",
    pkce: false,
    tokenStyle: "basic",
    keep: ["api_domain"],
    appSteps: [
      "Making a Pipedrive app needs a free developer sandbox account (developers.pipedrive.com). If you would rather not, use your personal API token instead, below.",
      "In the sandbox, open Settings › Developer Hub, press Create an app, then Create private app. Name it Talqava and set the OAuth Callback URL to exactly: {redirect}",
      "On the app's OAuth & access scopes tab, choose full access to deals, contacts and activities, and read access to search and users.",
      "Copy the Client ID and Client secret from that tab, paste them below and press the button. Pipedrive asks which company Talqava may use.",
    ],
  },
  async check(values) {
    if (values.access_token) {
      if (!apiDomain({ values }) && !process.env.TALQAVA_PIPEDRIVE_API) throw Object.assign(new Error("Pipedrive did not say which company address to use. Sign in again."), { refused: true });
      const who = (await api<{ data: any }>({ values }, "/v1/users/me")).data ?? {};
      return { label: `${plain(who.name, 80) || "Your account"} (${plain(who.company_name, 80) || "Pipedrive"})` };
    }
    const domain = String(values.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(domain)) throw new Error("Give your company domain: the first part of yourcompany.pipedrive.com.");
    const token = String(values.api_token ?? "").trim();
    if (!/^[\w-]{20,200}$/.test(token)) throw new Error("That does not look like a Pipedrive API token. Copy it again from Personal preferences › API.");
    const me = (await api<{ data: any }>({ values: { domain, api_token: token } }, "/v1/users/me")).data ?? {};
    return { label: `${plain(me.name, 80) || "Your account"} (${plain(me.company_name, 80) || `${domain}.pipedrive.com`})`, values: { domain, api_token: token } };
  },
  triggers: [
    {
      name: "new_deal",
      summary: "A new deal is added",
      list: async (c) => found(await api(c, `/v2/deals${query({ sort_by: "add_time", sort_direction: "desc", limit: 25 })}`)).map((d) => String(d.id)),
      async describe(c, deal) {
        const d = (await api<{ data: any }>(c, `/v2/deals/${id(deal, "deal")}`)).data ?? {};
        return { title: `Deal: ${plain(d.title, 140)}`, text: dealLine(d) };
      },
    },
  ],
  actions: [
    {
      name: "list_deals",
      kind: "read",
      summary: "See deals, most recently updated first",
      description: "Lists deals, most recently updated first: number, title, value, status and stage. Filter by status or by stage (stage numbers come from list_stages). Archived deals are not included.",
      properties: { status: { type: "string", enum: ["open", "won", "lost"], description: "Usually open." }, stage: { type: "string", description: "Optional: a stage's number, from list_stages." }, limit: { type: "number", description: "How many, at most 100. Usually 25." } },
      async run(c, input) {
        const r = await api(c, `/v2/deals${query({ status: oneOf(input.status ?? "open", ["open", "won", "lost"], "status"), stage_id: input.stage ? id(input.stage, "stage") : "", sort_by: "update_time", sort_direction: "desc", limit: count(input.limit, 25, 100) })}`);
        return found(r).map(dealLine).join("\n") || "No deals match.";
      },
    },
    {
      name: "search_deals",
      kind: "read",
      summary: "Find deals by words",
      description: "Finds deals by words in their title or notes.",
      properties: { words: { type: "string", description: "At least two letters." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      required: ["words"],
      async run(c, input) {
        return found(await api(c, `/v2/deals/search${query({ term: term(input.words), limit: count(input.limit, 20, 50) })}`)).map(dealLine).join("\n") || "No deals match.";
      },
    },
    {
      name: "get_deal",
      kind: "read",
      summary: "Read one deal and its notes",
      description: "Returns one deal with the person and organization it belongs to (as numbers), and its latest notes.",
      properties: { deal: { type: "string", description: "The deal's number." } },
      required: ["deal"],
      async run(c, input) {
        const n = id(input.deal, "deal");
        const d = (await api<{ data: any }>(c, `/v2/deals/${n}`)).data ?? {};
        const notes = found(await api(c, `/v1/notes${query({ deal_id: n, limit: 20, sort: "add_time DESC" })}`));
        const who = [d.person_id != null ? `person ${plain(d.person_id?.name ?? d.person_id, 80)}` : "", d.org_id != null ? `organization ${plain(d.org_id?.name ?? d.org_id, 80)}` : "", d.expected_close_date ? `expected to close ${day(d.expected_close_date)}` : ""].filter(Boolean).join(" · ");
        return `${dealLine(d)}${who ? `\n${who}` : ""}\n\n${notes.map((x) => `${day(x.add_time)} · ${plain(x.content, 1500)}`).join("\n") || "No notes."}`;
      },
    },
    {
      name: "create_deal",
      kind: "write",
      summary: "Add a deal",
      description: "Adds a deal with a title and, optionally, a value, a currency, the person and organization it is for (their numbers, from find_people and find_organizations) and a stage.",
      properties: { title: { type: "string" }, value: { type: "number" }, currency: { type: "string", description: "Three letters, such as EUR." }, person: { type: "string" }, organization: { type: "string" }, stage: { type: "string" } },
      required: ["title"],
      async run(c, input) {
        const title = plain(input.title, 250);
        if (!title) throw new Error("Give the deal a title.");
        const currency = String(input.currency ?? "").trim().toUpperCase();
        if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("A currency is three letters, such as EUR.");
        if (input.value != null && !(Number.isFinite(Number(input.value)) && Number(input.value) >= 0)) throw new Error("The value is a number, zero or more.");
        const d = (await api<{ data: any }>(c, "/v2/deals", "POST", { title, ...(input.value != null ? { value: Number(input.value) } : {}), ...(currency ? { currency } : {}), ...(input.person ? { person_id: id(input.person, "person") } : {}), ...(input.organization ? { org_id: id(input.organization, "organization") } : {}), ...(input.stage ? { stage_id: id(input.stage, "stage") } : {}) })).data ?? {};
        return `Added deal ${dealLine(d)}`;
      },
    },
    {
      name: "update_deal",
      kind: "write",
      summary: "Move a deal, or mark it won or lost",
      description: "Changes a deal: move it to another stage, set its value, or mark it won, lost or open again. A lost deal can carry a reason.",
      properties: { deal: { type: "string" }, stage: { type: "string", description: "A stage's number, from list_stages." }, status: { type: "string", enum: ["open", "won", "lost"] }, value: { type: "number" }, lost_reason: { type: "string" } },
      required: ["deal"],
      async run(c, input) {
        const change = { ...(input.stage ? { stage_id: id(input.stage, "stage") } : {}), ...(input.status ? { status: oneOf(input.status, ["open", "won", "lost"], "status") } : {}), ...(input.value != null ? { value: Number(input.value) } : {}), ...(input.status === "lost" && plain(input.lost_reason, 250) ? { lost_reason: plain(input.lost_reason, 250) } : {}) };
        if ("value" in change && !(Number.isFinite(change.value) && change.value! >= 0)) throw new Error("The value is a number, zero or more.");
        if (!Object.keys(change).length) throw new Error("Say what to change: the stage, the status or the value.");
        const d = (await api<{ data: any }>(c, `/v2/deals/${id(input.deal, "deal")}`, "PATCH", change)).data ?? {};
        return `Updated deal ${dealLine(d)}`;
      },
    },
    {
      name: "find_people",
      kind: "read",
      summary: "Find people by name, email or phone",
      description: "Finds people (contacts) by words in their name, email or phone. Returns each one's number, for the other tools.",
      properties: { words: { type: "string", description: "At least two letters." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      required: ["words"],
      async run(c, input) {
        return found(await api(c, `/v2/persons/search${query({ term: term(input.words), limit: count(input.limit, 20, 50) })}`)).map(personLine).join("\n") || "No people match.";
      },
    },
    {
      name: "create_person",
      kind: "write",
      summary: "Add a person",
      description: "Adds a person with a name and, optionally, an email, a phone number and the organization they belong to. Look with find_people first, so nobody is added twice.",
      properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, organization: { type: "string", description: "The organization's number." } },
      required: ["name"],
      async run(c, input) {
        const name = plain(input.name, 200);
        if (!name) throw new Error("Give the person's name.");
        const email = String(input.email ?? "").trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        const phone = plain(input.phone, 40);
        const p = (await api<{ data: any }>(c, "/v2/persons", "POST", { name, ...(email ? { emails: [{ value: email, primary: true, label: "work" }] } : {}), ...(phone ? { phones: [{ value: phone, primary: true, label: "work" }] } : {}), ...(input.organization ? { org_id: id(input.organization, "organization") } : {}) })).data ?? {};
        return `Added the person [${p.id}] ${plain(p.name ?? name, 120)}.`;
      },
    },
    {
      name: "find_organizations",
      kind: "read",
      summary: "Find organizations by name",
      description: "Finds organizations (companies) by words in their name. Returns each one's number.",
      properties: { words: { type: "string", description: "At least two letters." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      required: ["words"],
      async run(c, input) {
        return found(await api(c, `/v2/organizations/search${query({ term: term(input.words), limit: count(input.limit, 20, 50) })}`)).map((o) => `[${o.id}] ${plain(o.name, 140)}`).join("\n") || "No organizations match.";
      },
    },
    {
      name: "create_organization",
      kind: "write",
      summary: "Add an organization",
      description: "Adds an organization (a company) by name. Look with find_organizations first.",
      properties: { name: { type: "string" } },
      required: ["name"],
      async run(c, input) {
        const name = plain(input.name, 200);
        if (!name) throw new Error("Give the organization's name.");
        const o = (await api<{ data: any }>(c, "/v2/organizations", "POST", { name })).data ?? {};
        return `Added the organization [${o.id}] ${plain(o.name ?? name, 140)}.`;
      },
    },
    {
      name: "add_note",
      kind: "write",
      summary: "Add a note to a deal, person or organization",
      description: "Adds a note to a deal, a person or an organization (give exactly one of them). Your colleagues in Pipedrive see it; the customer does not.",
      properties: { note: { type: "string", description: "The note, in plain text." }, deal: { type: "string" }, person: { type: "string" }, organization: { type: "string" } },
      required: ["note"],
      async run(c, input) {
        const content = html(input.note, 8000);
        if (!content) throw new Error("Write the note.");
        const on = [input.deal ? { deal_id: id(input.deal, "deal") } : null, input.person ? { person_id: id(input.person, "person") } : null, input.organization ? { org_id: id(input.organization, "organization") } : null].filter(Boolean);
        if (on.length !== 1) throw new Error("Say what the note is on: one deal, one person or one organization.");
        await api(c, "/v1/notes", "POST", { content, ...on[0] });
        return `Added the note to ${Object.keys(on[0]!)[0].replace("_id", "").replace("org", "organization")} ${Object.values(on[0]!)[0]}.`;
      },
    },
    {
      name: "add_activity",
      kind: "write",
      summary: "Plan a call, meeting or task",
      description: "Adds an activity (a call, meeting, task, deadline, email or lunch) with a subject and a day, optionally linked to a deal.",
      properties: { subject: { type: "string" }, type: { type: "string", enum: ["call", "meeting", "task", "deadline", "email", "lunch"] }, due_date: { type: "string", description: "The day, like 2026-11-30." }, deal: { type: "string" } },
      required: ["subject", "due_date"],
      async run(c, input) {
        const subject = plain(input.subject, 250);
        const due = String(input.due_date ?? "").trim();
        if (!subject) throw new Error("Give the activity a subject.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) throw new Error("Give the day as a date like 2026-11-30.");
        const a = (await api<{ data: any }>(c, "/v2/activities", "POST", { subject, type: oneOf(input.type ?? "task", ["call", "meeting", "task", "deadline", "email", "lunch"], "type"), due_date: due, ...(input.deal ? { deal_id: id(input.deal, "deal") } : {}) })).data ?? {};
        return `Planned “${plain(a.subject ?? subject, 160)}” for ${due}${a.id ? ` [${a.id}]` : ""}.`;
      },
    },
    {
      name: "list_stages",
      kind: "read",
      summary: "See the pipelines and their stages",
      description: "Lists each pipeline with its stages in order, and each stage's number for list_deals, create_deal and update_deal.",
      properties: {},
      async run(c) {
        const pipelines = found(await api(c, `/v2/pipelines${query({ limit: 100 })}`));
        const stages = found(await api(c, `/v2/stages${query({ sort_by: "order_nr", limit: 500 })}`));
        return pipelines.map((p) => `${plain(p.name, 100)}\n${stages.filter((s) => s.pipeline_id === p.id).map((s) => `  [${s.id}] ${plain(s.name, 100)}`).join("\n") || "  (no stages)"}`).join("\n") || "No pipelines were found.";
      },
    },
  ],
};
