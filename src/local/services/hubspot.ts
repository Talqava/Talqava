// HubSpot: contacts, companies and deals. Facts from HubSpot's developer documentation, read November 2026:
// service keys (developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys),
// the CRM objects and search reference, and the account details endpoint. Private apps can no longer be created
// (since October 2026), so the steps describe a service key; a token from an existing private app works the same way.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const P = "/crm/objects/2026-09";
const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("hubspot", "https://api.hubapi.com")}${path}`, { name: "HubSpot", method, headers: { authorization: `Bearer ${c.values.token}` }, body });
const KINDS = { contact: "contacts", company: "companies", deal: "deals" } as const;
type Kind = keyof typeof KINDS;
const PROPS: Record<Kind, string[]> = {
  contact: ["firstname", "lastname", "email", "phone", "company", "jobtitle", "lifecyclestage"],
  company: ["name", "domain", "phone", "city", "industry"],
  deal: ["dealname", "amount", "dealstage", "pipeline", "closedate"],
};
const kindOf = (v: unknown): Kind => (v === "company" || v === "deal" ? v : "contact");
const line = (kind: Kind, r: any) => {
  const p = r.properties ?? {};
  const head = kind === "contact" ? plain(`${p.firstname ?? ""} ${p.lastname ?? ""}`, 100) || p.email || "(no name)" : kind === "company" ? p.name || p.domain || "(no name)" : p.dealname || "(no name)";
  const rest = PROPS[kind].filter((k) => !["firstname", "lastname", "name", "dealname"].includes(k) && p[k]).map((k) => `${k}: ${plain(p[k], 80)}`);
  return `[${r.id}] ${head}${rest.length ? ` · ${rest.join(" · ")}` : ""}`;
};
/** Only plain property names and short values go to HubSpot. */
const cleanProps = (given: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (given && typeof given === "object") for (const [k, v] of Object.entries(given as Record<string, unknown>)) if (/^[a-z0-9_]{1,100}$/.test(k) && v !== undefined && v !== null) out[k] = String(v).slice(0, 5000);
  return out;
};
const PROPS_HELP = "Property names as HubSpot knows them. Contacts: firstname, lastname, email, phone, company, jobtitle. Companies: name, domain, phone, city, industry. Deals: dealname, amount, dealstage, pipeline, closedate.";

export const hubspot: ServiceDef = {
  id: "hubspot",
  name: "HubSpot",
  category: "Sales and customer records",
  about: "Find and update the contacts, companies and deals in your HubSpot account.",
  steps: [
    "In HubSpot, open Development › Keys › Service keys and press Create service key. Name it Talqava.",
    "Press Add new scope and add reading and writing for contacts, companies and deals (crm.objects.contacts.read and .write, and the same for companies and deals). Leave out the writing ones to let agents only look.",
    "Press Create, then Show and Copy, and paste the key below.",
  ],
  docs: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys",
  // Browser sign-in with the owner's own HubSpot app. HubSpot's pages do not describe PKCE, so the app's secret does
  // that job, as they document. The access token lasts 30 minutes and is renewed here.
  browser: {
    authUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubspot.com/oauth/v3/token",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.companies.read", "crm.objects.companies.write", "crm.objects.deals.read", "crm.objects.deals.write"],
    secret: "required",
    pkce: false,
    tokenKey: "token",
    appSteps: [
      "In a HubSpot developer account, create an app named Talqava.",
      "In the app's Auth settings, add this redirect URL exactly: {redirect}",
      "Add the scopes for reading and writing CRM contacts, companies and deals.",
      "Copy the Client ID and Client secret below, and press the button. HubSpot asks which account to connect; you need to be a Super Admin of it.",
    ],
  },
  fields: [{ key: "token", label: "Service key", secret: true, placeholder: "pat-…", help: "A token from an existing private app also works." }],
  async check(values) {
    const d = await api<{ portalId: number; uiDomain?: string }>({ values }, "/account-info/2026-09/details");
    return { label: `Account ${d.portalId}` };
  },
  actions: [
    {
      name: "search",
      kind: "read",
      summary: "Find contacts, companies and deals",
      description: "Finds contacts, companies or deals by words (a name, an email address, a company). Without words it lists some of them.",
      properties: { kind: { type: "string", enum: ["contact", "company", "deal"], description: "What to look for. Contacts when left out." }, words: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const kind = kindOf(input.kind);
        const r = await api<{ results: any[]; total?: number }>(c, `${P}/${KINDS[kind]}/search`, "POST", { ...(input.words ? { query: String(input.words).slice(0, 200) } : {}), properties: PROPS[kind], limit: count(input.limit, 20, 50) });
        return r.results.map((x) => line(kind, x)).join("\n") || "Nothing matches.";
      },
    },
    {
      name: "get",
      kind: "read",
      summary: "Read one contact, company or deal",
      description: "Returns one record with its main details. A contact can also be fetched by email address.",
      properties: { kind: { type: "string", enum: ["contact", "company", "deal"] }, id: { type: "string", description: "The record's number, from search." }, email: { type: "string", description: "For a contact: its email address, instead of the number." } },
      async run(c, input) {
        const kind = kindOf(input.kind);
        if (!input.id && !(kind === "contact" && input.email)) throw new Error("Give the record's number, from search.");
        const which = input.id ? encodeURIComponent(String(input.id)) : encodeURIComponent(String(input.email));
        const r = await api<any>(c, `${P}/${KINDS[kind]}/${which}${query({ properties: PROPS[kind].join(","), ...(input.id ? {} : { idProperty: "email" }) })}`);
        return `${line(kind, r)}\nAdded ${String(r.createdAt ?? "").slice(0, 10)} · last changed ${String(r.updatedAt ?? "").slice(0, 10)}`;
      },
    },
    {
      name: "create",
      kind: "write",
      summary: "Add a contact, company or deal",
      description: `Adds a record. Search first so the same person or company is not added twice. ${PROPS_HELP} A contact needs an email or a name; a company a name or domain; a deal a dealname and dealstage.`,
      properties: { kind: { type: "string", enum: ["contact", "company", "deal"] }, properties: { type: "object", description: PROPS_HELP } },
      required: ["kind", "properties"],
      async run(c, input) {
        const kind = kindOf(input.kind);
        const properties = cleanProps(input.properties);
        if (!Object.keys(properties).length) throw new Error("Give the details to save.");
        return `Added the ${kind}: ${line(kind, await api<any>(c, `${P}/${KINDS[kind]}`, "POST", { properties }))}`;
      },
    },
    {
      name: "update",
      kind: "write",
      summary: "Change a contact, company or deal",
      description: `Changes details of one record. Give only what changes. ${PROPS_HELP}`,
      properties: { kind: { type: "string", enum: ["contact", "company", "deal"] }, id: { type: "string" }, properties: { type: "object", description: PROPS_HELP } },
      required: ["kind", "id", "properties"],
      async run(c, input) {
        const kind = kindOf(input.kind);
        const properties = cleanProps(input.properties);
        if (!Object.keys(properties).length) throw new Error("Say what to change.");
        return `Updated the ${kind}: ${line(kind, await api<any>(c, `${P}/${KINDS[kind]}/${encodeURIComponent(String(input.id))}`, "PATCH", { properties }))}`;
      },
    },
  ],
};
