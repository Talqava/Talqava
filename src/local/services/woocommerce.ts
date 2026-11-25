// WooCommerce: the orders, products and customers of a shop on a WordPress site. Facts from WooCommerce's REST API
// documentation (woocommerce.github.io/woocommerce-rest-api-docs), read November 2026: keys are made under
// WooCommerce › Settings › Advanced › REST API; over https the consumer key and secret are sent as Basic sign-in, and
// where the web host does not pass that header on, in the address instead. Plain http is not supported here.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
/** One request. `via` remembers which way of sending the keys this site accepts. */
async function woo<T = any>(c: Keys, path: string, method = "GET", body?: unknown): Promise<T> {
  const base = `${c.values.url}/wp-json/wc/v3${path}`;
  const header = { authorization: `Basic ${Buffer.from(`${c.values.key}:${c.values.secret}`).toString("base64")}` };
  if (c.values.via === "address") return call<T>(`${base}${base.includes("?") ? "&" : "?"}${query({ consumer_key: c.values.key, consumer_secret: c.values.secret }).slice(1)}`, { name: "WooCommerce", method, body });
  return call<T>(base, { name: "WooCommerce", method, headers: header, body });
}
const money = (o: any) => `${o.total} ${o.currency ?? ""}`.trim();
const orderLine = (o: any) => `[${o.id}] #${o.number ?? o.id} · ${o.status} · ${String(o.date_created ?? "").slice(0, 10)} · ${money(o)} · ${plain(`${o.billing?.first_name ?? ""} ${o.billing?.last_name ?? ""}`, 80) || "guest"}`;
const productLine = (p: any) => `[${p.id}] ${plain(p.name, 120)} · ${p.status}${p.sku ? ` · SKU ${p.sku}` : ""} · price ${p.price || "not set"}${p.stock_quantity != null ? ` · ${p.stock_quantity} in stock` : p.stock_status ? ` · ${p.stock_status}` : ""}`;
const STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

export const woocommerce: ServiceDef = {
  id: "woocommerce",
  name: "WooCommerce",
  category: "Payments and online shop",
  about: "See the orders, products and customers of your WooCommerce shop, update products, and move orders along.",
  steps: [
    "In your WordPress admin, open WooCommerce › Settings › Advanced › REST API and press Add key.",
    "Type the description Talqava, choose a user, and choose the access: Read to let agents only look, or Read/Write to let them change things.",
    "Press Generate API key, then copy the Consumer key and Consumer secret below. WooCommerce shows them only once.",
  ],
  docs: "https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication",
  fields: [
    { key: "url", label: "Shop address", placeholder: "https://example.com" },
    { key: "key", label: "Consumer key", secret: true, placeholder: "ck_…" },
    { key: "secret", label: "Consumer secret", secret: true, placeholder: "cs_…" },
  ],
  async check(values) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(values.url) ? values.url : `https://${values.url}`);
    } catch {
      throw new Error("That shop address does not look right. Use the address your browser shows, such as https://example.com.");
    }
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !local) throw new Error("The shop's address must start with https://, so the keys travel safely.");
    const clean = `${url.origin}${url.pathname.replace(/\/(wp-admin|wp-json).*$/, "").replace(/\/+$/, "")}`;
    const attempt = { values: { ...values, url: clean } };
    let via = "header";
    try {
      await woo(attempt, "/data/currencies/current");
    } catch (err) {
      if (!(err as { refused?: boolean }).refused) throw err;
      // Some web hosts drop the sign-in header. WooCommerce then accepts the keys in the address, over https.
      try {
        await woo({ values: { ...attempt.values, via: "address" } }, "/data/currencies/current");
        via = "address";
      } catch {
        throw err;
      }
    }
    return { label: url.host + (clean.endsWith(url.host) ? "" : url.pathname.replace(/\/+$/, "")), values: { url: clean, via } };
  },
  actions: [
    {
      name: "list_orders",
      kind: "read",
      summary: "See orders, newest first",
      description: "Lists orders, newest first. Narrow by status, by words (a name, email or order number) or to those placed after a date.",
      properties: { status: { type: "string", enum: [...STATUSES, "any"] }, search: { type: "string" }, after: { type: "string", description: "A date like 2026-11-01." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const list = await woo<any[]>(c, `/orders${query({ status: input.status, search: input.search, after: input.after ? `${String(input.after).slice(0, 10)}T00:00:00` : undefined, per_page: count(input.limit, 20, 50), orderby: "date", order: "desc" })}`);
        return list.map(orderLine).join("\n") || "No orders match.";
      },
    },
    {
      name: "get_order",
      kind: "read",
      summary: "Read one order with its items and notes",
      description: "Returns one order: who bought, what, where it ships, and the notes on it.",
      properties: { id: { type: "number", description: "The order's number in brackets, from list_orders." } },
      required: ["id"],
      async run(c, input) {
        const id = Math.trunc(Number(input.id));
        const [o, notes] = await Promise.all([woo<any>(c, `/orders/${id}`), woo<any[]>(c, `/orders/${id}/notes`).catch(() => [])]);
        const ship = o.shipping ?? {};
        return [
          orderLine(o),
          `Email: ${o.billing?.email || "none"} · Phone: ${o.billing?.phone || "none"}`,
          `Ships to: ${plain([ship.address_1, ship.address_2, ship.city, ship.state, ship.postcode, ship.country].filter(Boolean).join(", "), 200) || "no address"}`,
          `Items:\n${(o.line_items ?? []).map((i: any) => `- ${i.quantity} × ${plain(i.name, 120)}${i.sku ? ` (SKU ${i.sku})` : ""} · ${i.total}`).join("\n") || "- none"}`,
          o.customer_note ? `Customer's note: ${plain(o.customer_note, 500)}` : "",
          notes.length ? `Notes:\n${notes.slice(0, 15).map((n) => `- ${String(n.date_created ?? "").slice(0, 10)} ${n.customer_note ? "(to customer) " : ""}${plain(n.note, 300)}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
      },
    },
    {
      name: "update_order_status",
      kind: "write",
      summary: "Move an order to another status",
      description: "Changes an order's status, for example to completed once it has shipped. WooCommerce may email the customer when the status changes, so do this only when it is true.",
      properties: { id: { type: "number" }, status: { type: "string", enum: STATUSES } },
      required: ["id", "status"],
      async run(c, input) {
        if (!STATUSES.includes(String(input.status))) throw new Error(`Choose one of: ${STATUSES.join(", ")}.`);
        const o = await woo<any>(c, `/orders/${Math.trunc(Number(input.id))}`, "PUT", { status: input.status });
        return `Order #${o.number ?? o.id} is now ${o.status}.`;
      },
    },
    {
      name: "add_order_note",
      kind: "write",
      summary: "Add a note to an order",
      description: "Adds a note to an order. A private note is seen only by the shop's staff. With to_customer set, the note is emailed to the customer, so write it as you would to them.",
      properties: { id: { type: "number" }, note: { type: "string" }, to_customer: { type: "boolean", description: "Email the note to the customer. Left out, it is private." } },
      required: ["id", "note"],
      async run(c, input) {
        await woo(c, `/orders/${Math.trunc(Number(input.id))}/notes`, "POST", { note: String(input.note).slice(0, 5000), customer_note: input.to_customer === true });
        return `Added a ${input.to_customer === true ? "note to the customer (emailed)" : "private note"} on order ${Math.trunc(Number(input.id))}.`;
      },
    },
    {
      name: "list_products",
      kind: "read",
      summary: "See and search products",
      description: "Lists products. Narrow by words, by SKU, or by stock (instock, outofstock, onbackorder).",
      properties: { search: { type: "string" }, sku: { type: "string" }, stock: { type: "string", enum: ["instock", "outofstock", "onbackorder"] }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const list = await woo<any[]>(c, `/products${query({ search: input.search, sku: input.sku, stock_status: input.stock, per_page: count(input.limit, 20, 50) })}`);
        return list.map(productLine).join("\n") || "No products match.";
      },
    },
    {
      name: "get_product",
      kind: "read",
      summary: "Read one product in full",
      description: "Returns one product: prices, stock, its description and its page.",
      properties: { id: { type: "number" } },
      required: ["id"],
      async run(c, input) {
        const p = await woo<any>(c, `/products/${Math.trunc(Number(input.id))}`);
        return `${productLine(p)}\nRegular price: ${p.regular_price || "not set"} · Sale price: ${p.sale_price || "none"}\n${p.permalink ?? ""}\n\n${plain(p.short_description, 1000)}\n\n${plain(p.description, 8000)}`.trim();
      },
    },
    {
      name: "update_product",
      kind: "write",
      summary: "Change a product's price, stock, text or status",
      description: "Changes a product. Give only what changes. Prices are text like 19.99 in the shop's currency; a changed price shows in the shop at once, so be sure of it.",
      properties: { id: { type: "number" }, name: { type: "string" }, regular_price: { type: "string" }, sale_price: { type: "string", description: "Empty text removes the sale." }, stock_quantity: { type: "number" }, description: { type: "string", description: "The whole new description, as plain text or simple HTML." }, status: { type: "string", enum: ["draft", "pending", "private", "publish"] } },
      required: ["id"],
      async run(c, input) {
        const price = (v: unknown) => {
          const t = String(v).trim();
          if (t && !/^\d+(\.\d{1,4})?$/.test(t)) throw new Error("Write a price like 19.99.");
          return t;
        };
        const change = {
          ...(input.name ? { name: String(input.name).slice(0, 300) } : {}),
          ...(input.regular_price !== undefined ? { regular_price: price(input.regular_price) } : {}),
          ...(input.sale_price !== undefined ? { sale_price: price(input.sale_price) } : {}),
          ...(input.stock_quantity !== undefined ? { stock_quantity: Math.trunc(Number(input.stock_quantity)), manage_stock: true } : {}),
          ...(input.description !== undefined ? { description: String(input.description).slice(0, 50_000) } : {}),
          ...(input.status ? { status: String(input.status) } : {}),
        };
        if (!Object.keys(change).length) throw new Error("Say what to change.");
        return `Updated: ${productLine(await woo<any>(c, `/products/${Math.trunc(Number(input.id))}`, "PUT", change))}`;
      },
    },
    {
      name: "find_customers",
      kind: "read",
      summary: "Look up customers",
      description: "Finds customers by words (a name) or by exact email address.",
      properties: { search: { type: "string" }, email: { type: "string" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const list = await woo<any[]>(c, `/customers${query({ search: input.search, email: input.email, per_page: count(input.limit, 20, 50) })}`);
        return list.map((u) => `[${u.id}] ${plain(`${u.first_name ?? ""} ${u.last_name ?? ""}`, 80) || u.username} · ${u.email}${u.billing?.city ? ` · ${plain(u.billing.city, 60)}` : ""}`).join("\n") || "No customers match.";
      },
    },
  ],
};
