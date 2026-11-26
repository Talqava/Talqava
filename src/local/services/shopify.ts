// Shopify: the orders, products and customers of one shop, through the GraphQL Admin API. Facts from Shopify's
// developer documentation, read November 2026: shopify.dev/docs/apps/build/authentication-authorization/access-tokens
// (client credentials grant), /docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard, /docs/api/usage/versioning
// and the Admin GraphQL reference for shop, orders, order, products, product, customers and productUpdate.
//
// A new shop can no longer make a permanent key in its admin. The owner makes an app in Shopify's Dev Dashboard and
// installs it on the shop; Talqava exchanges the app's ID and secret for a token that lasts a day, and renews it.
import { baseOf, call, count, plain, type Connection, type ServiceDef } from "../connector-kit.ts";

type C = Pick<Connection, "values">;
const VERSION = "2026-10";
const shopBase = (c: C) => baseOf("shopify", `https://${c.values.shop}.myshopify.com`);
const tokens = new Map<string, { token: string; until: number }>();
/** The day-long token for a shop, fetched with the app's ID and secret and kept in memory until shortly before it ends. */
async function tokenFor(c: C): Promise<string> {
  const key = `${c.values.shop}:${c.values.client_id}`;
  const had = tokens.get(key);
  if (had && had.until - Date.now() > 300_000) return had.token;
  const t = await call<{ access_token: string; expires_in?: number }>(`${shopBase(c)}/admin/oauth/access_token`, { name: "Shopify", method: "POST", form: { grant_type: "client_credentials", client_id: c.values.client_id, client_secret: c.values.client_secret } }).catch((err) => {
    if (/ answered 4\d\d/.test((err as Error).message)) throw Object.assign(new Error("Shopify refused that: the app's client ID or secret is not accepted for this shop. Check both, and that the app is installed on the shop."), { refused: true });
    throw err;
  });
  if (!t?.access_token) throw Object.assign(new Error("Shopify did not give a token for this shop. Check that the app is installed on it."), { refused: true });
  tokens.set(key, { token: t.access_token, until: Date.now() + (Number(t.expires_in) || 86_399) * 1000 });
  return t.access_token;
}
/** One GraphQL call. Shopify answers 200 even for mistakes, with an errors list; changes report userErrors. */
async function gql<T = any>(c: C, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await call<{ data?: T; errors?: { message: string }[] }>(`${shopBase(c)}/admin/api/${VERSION}/graphql.json`, { name: "Shopify", method: "POST", headers: { "x-shopify-access-token": await tokenFor(c) }, body: { query, variables } });
  if (r?.errors?.length) {
    const why = plain(r.errors.map((e) => e.message).join("; "), 300);
    if (/access denied|scope/i.test(why)) throw new Error(`Shopify refused that: the app lacks a permission (${why}). In the Dev Dashboard, add the scope to the app, release a new version, and it applies to the shop.`);
    throw new Error(`Shopify answered: ${why}.`);
  }
  return r.data as T;
}
const gid = (kind: "Order" | "Product" | "Customer", v: unknown) => {
  const n = String(v ?? "").split("/").pop() ?? "";
  if (!/^\d{1,20}$/.test(n)) throw new Error("Give the number in brackets from the list.");
  return `gid://shopify/${kind}/${n}`;
};
const num = (id: unknown) => String(id ?? "").split("/").pop();
const money = (set: any) => (set?.shopMoney ? `${set.shopMoney.amount} ${set.shopMoney.currencyCode}` : "");
const ORDER = "id name createdAt displayFinancialStatus displayFulfillmentStatus email totalPriceSet { shopMoney { amount currencyCode } }";
const orderLine = (o: any) => `[${num(o.id)}] ${o.name} · ${String(o.createdAt ?? "").slice(0, 10)} · ${String(o.displayFinancialStatus ?? "").toLowerCase()} / ${String(o.displayFulfillmentStatus ?? "").toLowerCase()} · ${money(o.totalPriceSet)}${o.email ? ` · ${o.email}` : ""}`;
const PRODUCT = "id title handle status totalInventory vendor tags updatedAt";
const productLine = (p: any) => `[${num(p.id)}] ${plain(p.title, 140)} · ${String(p.status ?? "").toLowerCase()}${p.totalInventory != null ? ` · ${p.totalInventory} in stock` : ""}${p.vendor ? ` · ${plain(p.vendor, 60)}` : ""}`;
const SEARCH = "Shopify's search words, such as a name or email, or filters like";

export const shopify: ServiceDef = {
  id: "shopify",
  name: "Shopify",
  category: "Payments and online shop",
  about: "See the orders, products and customers of your Shopify shop, and change a product's title, status or tags.",
  steps: [
    "Open Shopify's Dev Dashboard (dev.shopify.com), go to Apps, press Create app, choose Start from Dev Dashboard, and name it Talqava.",
    "On the app's Versions page, set the scopes read_orders, read_products, read_customers, and write_products if agents should change products, then press Release.",
    "On the Installs card, press Install app and choose your shop. The app and the shop must belong to the same Shopify organization.",
    "Open Settings and copy the Client ID and Client secret from the Credentials card below.",
    "The shop's name is the first part of its myshopify.com address: for example-shop.myshopify.com it is example-shop.",
  ],
  docs: "https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard",
  fields: [
    { key: "shop", label: "Shop name", placeholder: "example-shop", help: "The first part of your shop's myshopify.com address." },
    { key: "client_id", label: "Client ID", secret: true },
    { key: "client_secret", label: "Client secret", secret: true },
  ],
  async check(values) {
    const shop = values.shop.toLowerCase().replace(/^https?:\/\//, "").replace(/\.myshopify\.com.*$/, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(shop)) throw new Error("The shop's name is the first part of its myshopify.com address, such as example-shop.");
    const d = await gql<{ shop: { name: string; myshopifyDomain: string } }>({ values: { ...values, shop } }, "{ shop { name myshopifyDomain } }");
    return { label: `${d.shop.name} (${d.shop.myshopifyDomain})`, values: { shop } };
  },
  triggers: [
    {
      name: "new_order",
      summary: "A new order comes in",
      list: async (c) => (await gql<{ orders: { nodes: { id: string }[] } }>(c, "{ orders(first: 25, sortKey: CREATED_AT, reverse: true) { nodes { id } } }")).orders.nodes.map((o) => num(o.id)!),
      describe: async (c, order) => ({ title: `Order ${order}`, text: await shopify.actions.find((a) => a.name === "get_order")!.run(c as Connection, { order }) }),
    },
  ],
  actions: [
    {
      name: "list_orders",
      kind: "read",
      summary: "See orders, newest first",
      description: `Lists orders, newest first. Narrow with words: ${SEARCH} financial_status:paid, fulfillment_status:unfulfilled, email:sam@example.com or created_at:>2026-11-01. Orders older than 60 days need an extra permission on the app.`,
      properties: { words: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const d = await gql<{ orders: { nodes: any[] } }>(c, `query($n: Int!, $q: String) { orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER} } } }`, { n: count(input.limit, 20, 50), q: input.words ? String(input.words).slice(0, 300) : null });
        return d.orders.nodes.map(orderLine).join("\n") || "No orders match.";
      },
    },
    {
      name: "get_order",
      kind: "read",
      summary: "Read one order with its items",
      description: "Returns one order: its status, total, the buyer's email and what was bought.",
      properties: { order: { type: "string", description: "The order's number in brackets, from list_orders." } },
      required: ["order"],
      async run(c, input) {
        const d = await gql<{ order: any }>(c, `query($id: ID!) { order(id: $id) { ${ORDER} note lineItems(first: 30) { nodes { title quantity sku } } } }`, { id: gid("Order", input.order) });
        if (!d.order) return "There is no such order.";
        return `${orderLine(d.order)}\nItems:\n${(d.order.lineItems?.nodes ?? []).map((i: any) => `- ${i.quantity} × ${plain(i.title, 140)}${i.sku ? ` (SKU ${i.sku})` : ""}`).join("\n") || "- none"}${d.order.note ? `\nNote: ${plain(d.order.note, 500)}` : ""}`;
      },
    },
    {
      name: "list_products",
      kind: "read",
      summary: "See and search products",
      description: `Lists products. Narrow with words: ${SEARCH} status:active, vendor:Acme, tag:summer or inventory_total:<5.`,
      properties: { words: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const d = await gql<{ products: { nodes: any[] } }>(c, `query($n: Int!, $q: String) { products(first: $n, query: $q) { nodes { ${PRODUCT} } } }`, { n: count(input.limit, 20, 50), q: input.words ? String(input.words).slice(0, 300) : null });
        return d.products.nodes.map(productLine).join("\n") || "No products match.";
      },
    },
    {
      name: "get_product",
      kind: "read",
      summary: "Read one product in full",
      description: "Returns one product: its status, stock, tags and description.",
      properties: { product: { type: "string", description: "The product's number in brackets, from list_products." } },
      required: ["product"],
      async run(c, input) {
        const d = await gql<{ product: any }>(c, `query($id: ID!) { product(id: $id) { ${PRODUCT} description } }`, { id: gid("Product", input.product) });
        if (!d.product) return "There is no such product.";
        return `${productLine(d.product)}\nTags: ${(d.product.tags ?? []).join(", ") || "none"}\n\n${plain(d.product.description, 8000) || "(no description)"}`;
      },
    },
    {
      name: "update_product",
      kind: "write",
      summary: "Change a product's title, status or tags",
      description: "Changes a product's title, its status (ACTIVE shows it in the shop, DRAFT hides it, ARCHIVED retires it) or its tags. Give only what changes; a new list of tags replaces the old one. A change shows in the shop at once.",
      properties: { product: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "DRAFT", "ARCHIVED"] }, tags: { type: "array", items: { type: "string" } } },
      required: ["product"],
      async run(c, input) {
        const change = { ...(input.title ? { title: String(input.title).slice(0, 250) } : {}), ...(["ACTIVE", "DRAFT", "ARCHIVED"].includes(String(input.status)) ? { status: String(input.status) } : {}), ...(Array.isArray(input.tags) ? { tags: input.tags.map((t: unknown) => String(t).slice(0, 80)).filter(Boolean).slice(0, 50) } : {}) };
        if (!Object.keys(change).length) throw new Error("Say what to change.");
        const d = await gql<{ productUpdate: { product: any; userErrors: { message: string }[] } }>(c, `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { product { ${PRODUCT} } userErrors { field message } } }`, { product: { id: gid("Product", input.product), ...change } });
        if (d.productUpdate.userErrors?.length) throw new Error(`Shopify did not change it: ${plain(d.productUpdate.userErrors.map((e) => e.message).join("; "), 300)}.`);
        return `Updated: ${productLine(d.productUpdate.product)}`;
      },
    },
    {
      name: "find_customers",
      kind: "read",
      summary: "Look up customers",
      description: `Finds customers. Give words: ${SEARCH} email:"sam@example.com", first_name:Sam or orders_count:>3.`,
      properties: { words: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const d = await gql<{ customers: { nodes: any[] } }>(c, `query($n: Int!, $q: String) { customers(first: $n, query: $q) { nodes { id firstName lastName defaultEmailAddress { emailAddress } numberOfOrders amountSpent { amount currencyCode } } } }`, { n: count(input.limit, 20, 50), q: input.words ? String(input.words).slice(0, 300) : null });
        return d.customers.nodes.map((u) => `[${num(u.id)}] ${plain(`${u.firstName ?? ""} ${u.lastName ?? ""}`, 80) || "(no name)"}${u.defaultEmailAddress?.emailAddress ? ` · ${u.defaultEmailAddress.emailAddress}` : ""} · ${u.numberOfOrders ?? 0} orders${u.amountSpent ? ` · ${u.amountSpent.amount} ${u.amountSpent.currencyCode}` : ""}`).join("\n") || "No customers match.";
      },
    },
  ],
};
