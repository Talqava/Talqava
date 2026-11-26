// Square: payments, orders, customers and items of the owner's own Square account. Facts from Square's developer
// documentation (developer.squareup.com), read November 2026: the production access token from the Developer
// Console's Credentials page reaches everything in the account that owns the application and is sent as Bearer to
// https://connect.squareup.com/v2 with a Square-Version header; money is a whole number in the currency's smallest
// unit; payments are listed for the main location unless a location is named; new payments can take several seconds
// to appear. It connects with that token: Square's pages disagree on whether a browser sign-in may return to an
// address on this computer. Agents read, and can add a customer; they take no payments and give no refunds.
// Not confirmed there: whether the token ever runs out.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("square", "https://connect.squareup.com/v2")}${path}`, { name: "Square", method, headers: { authorization: `Bearer ${c.values.token}`, "square-version": "2026-11-18" }, body });

const ref = (v: unknown, what: string) => {
  const t = String(v ?? "").trim();
  if (!/^[A-Za-z0-9_-]{4,192}$/.test(t)) throw new Error(`Give the ${what}'s id, the letters and digits in square brackets.`);
  return t;
};
const since = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) throw new Error("Give since as a date like 2026-11-01.");
  return `${t}T00:00:00Z`;
};
/** An amount in words: Square counts in the currency's smallest unit (cents for dollars, whole yen for yen). */
const money = (m: any): string => {
  if (!m || m.amount == null) return "";
  const currency = /^[A-Z]{3}$/.test(String(m.currency)) ? String(m.currency) : "USD";
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {}
  return `${(Number(m.amount) / 10 ** digits).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
};
const when = (v: unknown) => String(v ?? "").slice(0, 16).replace("T", " ");
const paymentLine = (p: any) => `[${p.id}] ${when(p.created_at)} · ${money(p.total_money ?? p.amount_money)}${Number(p.tip_money?.amount) ? ` (tip ${money(p.tip_money)})` : ""} · ${String(p.status ?? "").toLowerCase()} · ${p.source_type === "CARD" && p.card_details?.card ? `${plain(p.card_details.card.card_brand, 20)} ending ${plain(p.card_details.card.last_4, 4)}` : String(p.source_type ?? "").toLowerCase().replace(/_/g, " ")}${p.note ? ` · ${plain(p.note, 100)}` : ""}`;
const customerLine = (p: any) => `[${p.id}] ${plain([p.given_name, p.family_name].filter(Boolean).join(" ") || p.company_name || "(no name)", 120)}${p.email_address ? ` · ${plain(p.email_address, 120)}` : ""}${p.phone_number ? ` · ${plain(p.phone_number, 30)}` : ""}`;
const locations = async (c: Keys) => (await api<{ locations: any[] }>(c, "/locations")).locations ?? [];

export const square: ServiceDef = {
  id: "square",
  name: "Square",
  category: "Payments and online shop",
  about: "See your Square payments, orders, customers and items, and add customers. Agents take no payments and give no refunds.",
  steps: [
    "Open developer.squareup.com/apps, sign in with your Square account and create an application named Talqava.",
    "Open the application's Credentials page and switch it to Production.",
    "Under Production Access token press Show, copy the token and paste it below. It reaches everything in your own Square account, so keep it to yourself.",
  ],
  docs: "https://developer.squareup.com/docs/build-basics/access-tokens",
  fields: [{ key: "token", label: "Production access token", secret: true }],
  // Browser sign-in with the owner's own Square application, with the proof called PKCE and no secret. Square's
  // token call takes JSON, and says when the token runs out as a moment (expires_at). Its pages disagree on whether
  // an address on this computer is accepted in production; the steps say so, and the token stays as the other way.
  browser: {
    authUrl: "https://connect.squareup.com/oauth2/authorize",
    tokenUrl: "https://connect.squareup.com/oauth2/token",
    scopes: ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "ORDERS_READ", "CUSTOMERS_READ", "CUSTOMERS_WRITE", "ITEMS_READ"],
    extra: { session: "false" },
    secret: "never",
    tokenStyle: "json",
    tokenKey: "token",
    idLabel: "Application ID",
    appSteps: [
      "Open developer.squareup.com/apps, sign in with your Square account and create an application named Talqava.",
      "Open the application's OAuth page, switch it to Production, and add this Redirect URL exactly: {redirect}",
      "If Square refuses that address (its pages disagree on whether one on your own computer is allowed), use the access token instead, below.",
      "Open the Credentials page, copy the Production Application ID, paste it below and press the button. Square asks you to allow Talqava to see payments, orders, customers and items.",
    ],
  },
  async check(values) {
    const token = String(values.token ?? values.access_token ?? "").trim();
    if (!token || /\s/.test(token) || token.length > 500) throw new Error("Paste the production access token.");
    const me = (await api<{ merchant: any }>({ values: { token } }, "/merchants/me")).merchant;
    if (!me?.id) throw Object.assign(new Error("Square did not say whose account this is. Check that you copied the Production token, not the Sandbox one."), { refused: true });
    return { label: `${plain(me.business_name, 100) || "Your Square account"}${me.currency ? ` (${plain(me.currency, 3)})` : ""}`, values: { token, main_location: String(me.main_location_id ?? "") } };
  },
  triggers: [
    {
      name: "new_payment",
      summary: "A new payment is taken",
      param: { label: "Location id (leave empty for your main location)", placeholder: "from the list of locations" },
      list: async (c, param) => ((await api<{ payments: any[] }>(c, `/payments${query({ sort_order: "DESC", limit: 25, location_id: param ? ref(param, "location") : "" })}`)).payments ?? []).map((p) => String(p.id)),
      async describe(c, id) {
        const p = (await api<{ payment: any }>(c, `/payments/${ref(id, "payment")}`)).payment ?? {};
        return { title: `Payment of ${money(p.total_money ?? p.amount_money)}`, text: paymentLine(p) };
      },
    },
  ],
  actions: [
    {
      name: "list_locations",
      kind: "read",
      summary: "See your locations",
      description: "Lists the seller's locations with each one's id, currency and time zone. Payments and orders belong to a location.",
      properties: {},
      async run(c) {
        return (await locations(c)).map((l) => `[${l.id}] ${plain(l.name, 100)} · ${String(l.status ?? "").toLowerCase()} · ${plain(l.currency, 3)} · ${plain(l.timezone, 40)}`).join("\n") || "No locations were found.";
      },
    },
    {
      name: "list_payments",
      kind: "read",
      summary: "See payments, newest first",
      description: "Lists payments, newest first: when, total, tip, status and how it was paid. For the main location unless a location's id is given. Times are in UTC. A payment taken seconds ago may not show yet.",
      properties: { location: { type: "string", description: "Optional: a location's id, from list_locations." }, since: { type: "string", description: "Optional: only payments since this day, like 2026-11-01." }, limit: { type: "number", description: "How many, at most 100. Usually 25." } },
      async run(c, input) {
        const r = await api<{ payments: any[] }>(c, `/payments${query({ sort_order: "DESC", begin_time: since(input.since), location_id: input.location ? ref(input.location, "location") : "", limit: count(input.limit, 25, 100) })}`);
        return (r.payments ?? []).map(paymentLine).join("\n") || "No payments.";
      },
    },
    {
      name: "get_payment",
      kind: "read",
      summary: "Read one payment",
      description: "Returns one payment with its order and customer ids and its receipt address.",
      properties: { payment: { type: "string" } },
      required: ["payment"],
      async run(c, input) {
        const p = (await api<{ payment: any }>(c, `/payments/${ref(input.payment, "payment")}`)).payment ?? {};
        return `${paymentLine(p)}${p.order_id ? `\nOrder ${plain(p.order_id, 60)}` : ""}${p.customer_id ? ` · customer ${plain(p.customer_id, 60)}` : ""}${p.receipt_url ? `\nReceipt: ${plain(p.receipt_url, 200)}` : ""}`;
      },
    },
    {
      name: "list_orders",
      kind: "read",
      summary: "See orders, newest first",
      description: "Lists orders, newest first, with what was bought: at one location, or at all of them (up to 10). Filter by state and by day.",
      properties: { location: { type: "string", description: "Optional: a location's id. All locations when left out." }, state: { type: "string", enum: ["open", "completed", "canceled"] }, since: { type: "string", description: "Optional: only orders made since this day, like 2026-11-01." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const location_ids = input.location ? [ref(input.location, "location")] : (await locations(c)).slice(0, 10).map((l) => String(l.id));
        if (!location_ids.length) return "No locations were found.";
        const state = input.state ? String(input.state).toUpperCase() : "";
        if (state && !["OPEN", "COMPLETED", "CANCELED"].includes(state)) throw new Error("For state, choose one of: open, completed, canceled.");
        const filter = { ...(state ? { state_filter: { states: [state] } } : {}), ...(since(input.since) ? { date_time_filter: { created_at: { start_at: since(input.since) } } } : {}) };
        const r = await api<{ orders: any[] }>(c, "/orders/search", "POST", { location_ids, limit: count(input.limit, 20, 50), query: { ...(Object.keys(filter).length ? { filter } : {}), sort: { sort_field: "CREATED_AT", sort_order: "DESC" } } });
        return (r.orders ?? []).map((o) => `[${o.id}] ${when(o.created_at)} · ${money(o.total_money)} · ${String(o.state ?? "").toLowerCase()}${o.line_items?.length ? ` · ${o.line_items.slice(0, 8).map((l: any) => `${plain(l.quantity, 8)} × ${plain(l.name, 60)}`).join(", ")}` : ""}`).join("\n") || "No orders match.";
      },
    },
    {
      name: "find_customers",
      kind: "read",
      summary: "Find customers by email or phone",
      description: "Finds customers by part of their email address or phone number, or lists customers when neither is given. Square cannot search by name.",
      properties: { email: { type: "string", description: "Part of the email address." }, phone: { type: "string", description: "Part of the phone number." }, limit: { type: "number", description: "How many, at most 100. Usually 20." } },
      async run(c, input) {
        const limit = count(input.limit, 20, 100);
        const filter = { ...(plain(input.email, 120) ? { email_address: { fuzzy: plain(input.email, 120) } } : {}), ...(plain(input.phone, 30) ? { phone_number: { fuzzy: plain(input.phone, 30) } } : {}) };
        const r = Object.keys(filter).length ? await api<{ customers: any[] }>(c, "/customers/search", "POST", { limit, query: { filter } }) : await api<{ customers: any[] }>(c, `/customers${query({ limit })}`);
        return (r.customers ?? []).map(customerLine).join("\n") || "No customers match.";
      },
    },
    {
      name: "add_customer",
      kind: "write",
      summary: "Add a customer",
      description: "Adds a customer to the seller's customer list, with a name and an email address or phone number. Look with find_customers first, so nobody is added twice.",
      properties: { first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } },
      async run(c, input) {
        const email = String(input.email ?? "").trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        const person = { ...(plain(input.first_name, 100) ? { given_name: plain(input.first_name, 100) } : {}), ...(plain(input.last_name, 100) ? { family_name: plain(input.last_name, 100) } : {}), ...(email ? { email_address: email } : {}), ...(plain(input.phone, 30) ? { phone_number: plain(input.phone, 30) } : {}) };
        if (!Object.keys(person).length) throw new Error("Give at least a name, an email address or a phone number.");
        const made = (await api<{ customer: any }>(c, "/customers", "POST", person)).customer ?? {};
        return `Added the customer ${customerLine(made)}`;
      },
    },
    {
      name: "find_items",
      kind: "read",
      summary: "Find items and their prices",
      description: "Finds items in the catalogue by words in their name or description, with each variation's price. Lists items when no words are given.",
      properties: { words: { type: "string" }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        const words = plain(input.words, 100);
        const r = await api<{ items: any[] }>(c, "/catalog/search-catalog-items", "POST", { ...(words ? { text_filter: words } : {}), limit: count(input.limit, 30, 100) });
        return (r.items ?? []).map((i) => `[${i.id}] ${plain(i.item_data?.name, 120)}${i.item_data?.variations?.length ? ` · ${i.item_data.variations.slice(0, 8).map((v: any) => `${plain(v.item_variation_data?.name, 40)} ${money(v.item_variation_data?.price_money) || "(no price)"}`).join(", ")}` : ""}`).join("\n") || "No items match.";
      },
    },
  ],
};
