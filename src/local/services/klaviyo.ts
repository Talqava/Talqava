// Klaviyo: profiles (people) and lists. Facts from Klaviyo's developer documentation (developers.klaviyo.com),
// read November 2026: a private key (it starts with pk_) is made under Settings › API keys and sent as
// "Authorization: Klaviyo-API-Key <key>" with a revision header (2026-10-15 here) to https://a.klaviyo.com/api;
// answers are in the JSON:API shape; adding a profile to a list does not record consent, while subscribing does and
// follows the list's opt-in setting (a double opt-in list emails the person to confirm). Klaviyo's browser sign-in
// always needs the app's secret (sent as a Basic header, with PKCE), so the key stays as the simpler way. Campaigns are left out: the guide and the reference
// for this revision disagree on a campaign's fields, and results need a figure only a shop integration provides.
// Not confirmed there: what a duplicate answer carries besides its status.
import { baseOf, call, count, plain, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const REVISION = "2026-10-15";
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) =>
  call<T>(`${baseOf("klaviyo", "https://a.klaviyo.com/api")}${path}`, { name: "Klaviyo", method, headers: { authorization: c.values.access_token ? `Bearer ${c.values.access_token}` : `Klaviyo-API-Key ${c.values.api_key}`, revision: REVISION, accept: "application/vnd.api+json" }, ...(body === undefined ? {} : { raw: { type: "application/vnd.api+json", data: JSON.stringify(body) } }) });
/** Query text in Klaviyo's form: names with square brackets, values encoded. */
const q = (values: Record<string, string | number | undefined>) => {
  const parts = Object.entries(values).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};
const email = (v: unknown) => {
  const t = String(v ?? "").trim().toLowerCase();
  if (!/^[^\s@"'\\()]+@[^\s@"'\\()]+\.[^\s@"'\\()]+$/.test(t) || t.length > 250) throw new Error("That email address does not look right.");
  return t;
};
const ref = (v: unknown, what: string) => {
  const t = String(v ?? "").trim();
  if (!/^[A-Za-z0-9]{4,40}$/.test(t)) throw new Error(`Give the ${what}'s id, the letters and digits in square brackets.`);
  return t;
};
const names = (input: Record<string, any>) => ({ ...(plain(input.first_name, 100) ? { first_name: plain(input.first_name, 100) } : {}), ...(plain(input.last_name, 100) ? { last_name: plain(input.last_name, 100) } : {}) });
const consent = (p: any) => plain(p.attributes?.subscriptions?.email?.marketing?.consent, 30).toLowerCase().replace(/_/g, " ");
const line = (p: any) => `[${p.id}] ${plain(p.attributes?.email, 160) || "(no email)"}${p.attributes?.first_name || p.attributes?.last_name ? ` · ${plain(`${p.attributes?.first_name ?? ""} ${p.attributes?.last_name ?? ""}`, 120)}` : ""}${consent(p) ? ` · email: ${consent(p)}` : ""} · added ${String(p.attributes?.created ?? "").slice(0, 10)}`;
const findByEmail = async (c: Keys, address: string) => (await api<{ data: any[] }>(c, `/profiles${q({ filter: `equals(email,"${address}")`, "additional-fields[profile]": "subscriptions", "page[size]": 1 })}`)).data?.[0];

export const klaviyo: ServiceDef = {
  id: "klaviyo",
  name: "Klaviyo",
  category: "Email marketing",
  about: "See your Klaviyo lists and profiles, add or update people, and subscribe them to a list with your approval.",
  steps: [
    "In Klaviyo, an owner, admin or manager opens Settings › API keys and presses Create Private API Key.",
    "Name it Talqava. For access choose Custom, with Full access for Lists, Profiles and Subscriptions and Read for Accounts (or choose Full Access).",
    "Copy the key (it starts with pk_) and paste it below. Klaviyo shows it only once.",
  ],
  docs: "https://developers.klaviyo.com/en/docs/authenticate_",
  fields: [{ key: "api_key", label: "Private API key", secret: true, placeholder: "pk_…" }],
  // Browser sign-in with the owner's own Klaviyo app. Klaviyo requires the proof called PKCE and the app's secret,
  // sent as a Basic sign-in header. Its pages do not say whether an address on this computer is accepted.
  browser: {
    authUrl: "https://www.klaviyo.com/oauth/authorize",
    tokenUrl: "https://a.klaviyo.com/oauth/token",
    scopes: ["accounts:read", "lists:read", "lists:write", "profiles:read", "profiles:write", "subscriptions:write"],
    secret: "required",
    tokenStyle: "basic",
    appSteps: [
      "In Klaviyo, an owner, admin or manager opens klaviyo.com/manage-apps and presses Create app. Name it Talqava.",
      "Add this redirect URL exactly: {redirect}",
      "Give it these scopes: accounts:read, lists:read, lists:write, profiles:read, profiles:write, subscriptions:write.",
      "Copy the Client ID and Client secret, paste them below and press the button. Klaviyo asks you to allow Talqava.",
    ],
  },
  async check(values) {
    const api_key = String(values.api_key ?? "").trim();
    if (!values.access_token && !/^pk_[\w-]{10,200}$/.test(api_key)) throw new Error("That does not look like a Klaviyo private key. It starts with pk_.");
    const signedIn: Record<string, string> = values.access_token ? { access_token: values.access_token } : { api_key };
    const account = (await api<{ data: any[] }>({ values: signedIn }, "/accounts")).data?.[0];
    if (!account?.id) throw Object.assign(new Error("Klaviyo did not say whose account this is. Check that the key may read Accounts."), { refused: true });
    const info = account.attributes?.contact_information ?? {};
    return { label: `${plain(info.organization_name, 80) || "Your account"}${info.default_sender_email ? ` (${plain(info.default_sender_email, 120)})` : ""}`, values: (values.access_token ? {} : { api_key }) as Record<string, string> };
  },
  triggers: [
    {
      name: "new_profile",
      summary: "A new person is added",
      list: async (c) => ((await api<{ data: any[] }>(c, `/profiles${q({ sort: "-created", "page[size]": 25 })}`)).data ?? []).map((p) => String(p.id)),
      async describe(c, id) {
        const p = (await api<{ data: any }>(c, `/profiles/${ref(id, "profile")}${q({ "additional-fields[profile]": "subscriptions" })}`)).data ?? {};
        return { title: `New profile: ${plain(p.attributes?.email, 120) || id}`, text: line(p) };
      },
    },
  ],
  actions: [
    {
      name: "list_lists",
      kind: "read",
      summary: "See your lists",
      description: "Lists your Klaviyo lists with each one's id and whether joining it needs a confirmation email (double opt-in).",
      properties: {},
      async run(c) {
        const r = await api<{ data: any[] }>(c, `/lists${q({ "page[size]": 10 })}`);
        return (r.data ?? []).map((l) => `[${l.id}] ${plain(l.attributes?.name, 120)}${l.attributes?.opt_in_process ? ` · ${String(l.attributes.opt_in_process).replace(/_/g, " ")}` : ""}`).join("\n") || "There are no lists.";
      },
    },
    {
      name: "list_profiles",
      kind: "read",
      summary: "See people, newest first",
      description: "Lists profiles (people), newest first: id, email, name, their email consent and the day they were added.",
      properties: { limit: { type: "number", description: "How many, at most 100. Usually 20." } },
      async run(c, input) {
        const r = await api<{ data: any[] }>(c, `/profiles${q({ sort: "-created", "additional-fields[profile]": "subscriptions", "page[size]": count(input.limit, 20, 100) })}`);
        return (r.data ?? []).map(line).join("\n") || "No profiles.";
      },
    },
    {
      name: "find_profile",
      kind: "read",
      summary: "Look one person up by email",
      description: "Returns the profile with this email address: id, name and email consent.",
      properties: { email: { type: "string" } },
      required: ["email"],
      async run(c, input) {
        const p = await findByEmail(c, email(input.email));
        return p ? line(p) : "Nobody has that email address.";
      },
    },
    {
      name: "save_profile",
      kind: "write",
      summary: "Add a person, or update their name",
      description: "Adds a profile by email address with an optional name, or updates the name of the one that exists. It records no consent and sends nothing; to subscribe someone, use subscribe_to_list.",
      properties: { email: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" } },
      required: ["email"],
      async run(c, input) {
        const address = email(input.email);
        const before = await findByEmail(c, address);
        if (before) {
          if (!Object.keys(names(input)).length) return `${address} is already a profile [${before.id}]. Nothing was changed.`;
          await api(c, `/profiles/${ref(before.id, "profile")}`, "PATCH", { data: { type: "profile", id: before.id, attributes: names(input) } });
          return `Updated the profile ${address} [${before.id}].`;
        }
        const made = (await api<{ data: any }>(c, "/profiles", "POST", { data: { type: "profile", attributes: { email: address, ...names(input) } } })).data ?? {};
        return `Added the profile ${address} [${made.id}].`;
      },
    },
    {
      name: "subscribe_to_list",
      kind: "write",
      alwaysAsk: true,
      summary: "Subscribe a person to a list",
      description: "Subscribes a person to a list's emails and records their consent. Use it only for someone who asked to be subscribed. On a double opt-in list Klaviyo emails them to confirm first. Always asks the owner first.",
      properties: { email: { type: "string" }, list: { type: "string", description: "The list's id, from list_lists." } },
      required: ["email", "list"],
      async run(c, input) {
        const address = email(input.email);
        const list = ref(input.list, "list");
        await api(c, "/profile-subscription-bulk-create-jobs", "POST", { data: { type: "profile-subscription-bulk-create-job", attributes: { profiles: { data: [{ type: "profile", attributes: { email: address, subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } } }] } }, relationships: { list: { data: { type: "list", id: list } } } } });
        return `Asked Klaviyo to subscribe ${address} to list ${list}. On a double opt-in list they are subscribed once they confirm by email.`;
      },
    },
    {
      name: "remove_from_list",
      kind: "write",
      summary: "Take a person off a list",
      description: "Takes a person off a list. It does not change their consent or delete their profile.",
      properties: { email: { type: "string" }, list: { type: "string" } },
      required: ["email", "list"],
      async run(c, input) {
        const address = email(input.email);
        const p = await findByEmail(c, address);
        if (!p) return "Nobody has that email address.";
        await api(c, `/lists/${ref(input.list, "list")}/relationships/profiles`, "DELETE", { data: [{ type: "profile", id: p.id }] });
        return `Took ${address} off list ${ref(input.list, "list")}.`;
      },
    },
  ],
};
