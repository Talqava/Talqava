// WordPress: connect a site so agents can write and edit its posts and pages. It uses WordPress's own REST API with
// an application password (built into WordPress since 5.6), so nothing is installed on the site. What an agent may do
// is set per site: write drafts only (the owner publishes in WordPress), ask before each publish, or publish without
// asking. The password is kept on this computer and sent only to that site.
import crypto from "node:crypto";
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { getConfig, saveConfig } from "./store.ts";
import { audit } from "./audit.ts";
import { stripTags } from "./library.ts";

export const PUBLISH_RULES = ["drafts", "ask", "auto"] as const;
export type PublishRule = (typeof PUBLISH_RULES)[number];
export const PUBLISH_WORDS: Record<PublishRule, string> = {
  drafts: "Agents write drafts only; I publish them in WordPress",
  ask: "Agents ask me before each publish",
  auto: "Agents publish without asking",
};

export interface WordPressSite {
  id: string;
  name: string;
  /** The site's address, without a trailing slash. */
  url: string;
  user: string;
  password: string;
  publish: PublishRule;
  /**
   * How Talqava talks to the site. "rest" is WordPress's REST API. "xmlrpc" is WordPress's older entrance, used when
   * the web host drops the sign-in header the REST API needs: there the user name and password travel inside the
   * request itself, so nothing on the host can strip them.
   */
  via?: "rest" | "xmlrpc";
}
/** A site as the app shows it: never the password. */
export type PublicSite = Omit<WordPressSite, "password">;

export const sites = (): WordPressSite[] => (getConfig().wordpress ?? []).map((s) => ({ ...s, publish: PUBLISH_RULES.includes(s.publish as PublishRule) ? (s.publish as PublishRule) : "drafts" }));
const view = ({ password: _p, ...s }: WordPressSite): PublicSite => s;
export const listSites = (): PublicSite[] => sites().map(view);

function cleanUrl(text: unknown): string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(String(text ?? "").trim()) ? String(text).trim() : `https://${String(text ?? "").trim()}`);
  } catch {
    throw new Error("Give your site's address, such as https://example.com.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("The site's address must start with https://. WordPress only accepts application passwords over a secure connection.");
  return `${u.origin}${u.pathname.replace(/\/wp-admin.*$|\/wp-json.*$/, "").replace(/\/+$/, "")}`;
}

/** One call to a site's REST API. Errors come back in plain words. */
async function wp<T>(site: Pick<WordPressSite, "url" | "user" | "password">, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${site.url}/wp-json/wp/v2/${route}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`${site.user}:${site.password}`).toString("base64")}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  }).catch((err) => {
    const why = `${(err as Error).message} ${String((err as { cause?: { message?: string } }).cause?.message ?? "")}`;
    throw new Error(/redirect/i.test(why) ? `${new URL(site.url).host} sent the request on to another address. Use the exact address your browser shows when you open your site (with or without www, and https).` : /ENOTFOUND|EAI_AGAIN/.test(why) ? `There is no website at ${new URL(site.url).host}. Check the spelling of the address.` : /timed? ?out|aborted/i.test(why) ? `${new URL(site.url).host} took too long to answer. Try again in a moment.` : `${new URL(site.url).host} could not be reached. Check the address and that the site is up.`);
  });
  const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
  // "Not logged in" although a user name and password were sent means they never reached WordPress: the web host
  // dropped them on the way. That is fixed on the site, so say how, in the owner's terms.
  if (res.status === 401 && data?.code === "rest_not_logged_in") throw Object.assign(new Error(`${new URL(site.url).host} did not receive your user name and password: the web host is dropping them before they reach WordPress. To fix it, sign in to WordPress, open Settings › Permalinks and press Save Changes without changing anything (this refreshes a settings file so sign-in details get through), then try again here. If it still fails, ask your host to "pass the Authorization header to PHP".`), { headerDropped: true });
  if (res.status === 401 || res.status === 403) throw new Error(`WordPress refused that: ${(data?.message ? stripTags(data.message) : "") || "the user name or application password is not accepted, or this user may not do this"}.`);
  if (res.status === 404 && !data) throw new Error("That address does not answer as a WordPress site. Check the address, and that the site's REST API is not switched off.");
  if (!res.ok) throw new Error(`WordPress answered ${res.status}${data?.message ? `: ${stripTags(data.message).slice(0, 200)}` : "."}`);
  return data as T;
}

/** Connects a site: the user name and application password are checked with the site before anything is saved. */
export async function connectSite(input: { url?: unknown; user?: unknown; password?: unknown; publish?: unknown }): Promise<PublicSite> {
  const url = cleanUrl(input.url);
  const user = String(input.user ?? "").trim().slice(0, 100);
  const password = String(input.password ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!user) throw new Error("Give your WordPress user name.");
  if (!password) throw new Error("Paste the application password WordPress made for Talqava. It is not your normal password: make one under Users › Profile › Application Passwords.");
  let via: "rest" | "xmlrpc" = "rest";
  let name = new URL(url).host;
  try {
    const me = await wp<{ name?: string; capabilities?: Record<string, boolean> }>({ url, user, password }, "GET", "users/me?context=edit");
    if (me.capabilities && !me.capabilities.edit_posts) throw new Error("That WordPress user may not write posts. Use an Author, Editor or Administrator account.");
  } catch (err) {
    if (!(err as { headerDropped?: boolean }).headerDropped) throw err;
    // The host drops the sign-in header. WordPress's other entrance carries the sign-in inside the request instead.
    try {
      const profile = await xmlrpc<{ roles?: string[] }>({ url, user, password }, "wp.getProfile", [0, user, password]);
      if (profile.roles?.length && profile.roles.every((r) => r === "subscriber")) throw Object.assign(new Error("That WordPress user may not write posts. Use an Author, Editor or Administrator account."), { refused: true });
      via = "xmlrpc";
    } catch (second) {
      if ((second as { refused?: boolean }).refused) throw second;
      throw new Error(`${(err as Error).message} (Talqava also tried WordPress's other entrance, and that did not work either: ${(second as Error).message})`);
    }
  }
  try {
    const info = (await (await fetch(`${url}/wp-json/`, { signal: AbortSignal.timeout(15_000) })).json()) as { name?: string };
    if (info.name) name = plainText(String(info.name)).slice(0, 80) || name;
  } catch {}
  const all = sites();
  const existing = all.find((s) => s.url === url);
  const site: WordPressSite = { id: existing?.id ?? crypto.randomBytes(5).toString("hex"), name, url, user, password, via, publish: PUBLISH_RULES.includes(input.publish as PublishRule) ? (input.publish as PublishRule) : (existing?.publish ?? "drafts") };
  saveConfig({ wordpress: [...all.filter((s) => s.url !== url), site] });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Connected the WordPress site ${name}`, detail: `${new URL(url).host} as ${user}${via === "xmlrpc" ? ", through WordPress's older entrance because the host drops the sign-in header" : ""}` });
  return view(site);
}

export function updateSite(id: string, patch: { publish?: unknown }): PublicSite {
  const all = sites();
  const site = all.find((s) => s.id === id);
  if (!site) throw new Error("There is no such site.");
  if (PUBLISH_RULES.includes(patch.publish as PublishRule)) site.publish = patch.publish as PublishRule;
  saveConfig({ wordpress: all });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Changed what agents may do on ${site.name}`, detail: PUBLISH_WORDS[site.publish] });
  return view(site);
}

export function removeSite(id: string): { ok: true } {
  const all = sites();
  const site = all.find((s) => s.id === id);
  if (!site) throw new Error("There is no such site.");
  saveConfig({ wordpress: all.filter((s) => s.id !== id) });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Disconnected the WordPress site ${site.name}` });
  return { ok: true };
}

// ---------- writing for WordPress ----------
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}
/** Markdown as the plain HTML WordPress stores: headings, paragraphs, lists, quotes, tables, code, bold, italic, links. */
export function markdownToHtml(markdown: string): string {
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fence = /^```/.test(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
      i--;
      out.push(`<table><thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const list = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      i--;
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      i--;
      out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
      continue;
    }
    const para: string[] = [line];
    for (; i + 1 < lines.length && lines[i + 1].trim() && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i + 1]); i++) para.push(lines[i + 1]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
/** Text from WordPress's HTML: tags taken out (until none is left), then entities decoded, the ampersand last. */
const plainText = (html: string) =>
  stripTags(html.replace(/<(br|\/p|\/h\d|\/li|\/tr)[^>]*>/gi, "\n"))
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ---------- WordPress's older entrance (XML-RPC): the sign-in travels inside the request ----------
const xmlEsc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
function xmlValue(v: unknown): string {
  if (typeof v === "number") return `<value><int>${Math.trunc(v)}</int></value>`;
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (v instanceof Date) return `<value><dateTime.iso8601>${v.toISOString().slice(0, 19).replace(/-/g, "")}</dateTime.iso8601></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(xmlValue).join("")}</data></array></value>`;
  if (v && typeof v === "object") return `<value><struct>${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `<member><name>${xmlEsc(k)}</name>${xmlValue(x)}</member>`).join("")}</struct></value>`;
  return `<value><string>${xmlEsc(String(v ?? ""))}</string></value>`;
}
/** Reads one XML-RPC value. Small and strict: it knows only what WordPress sends. */
function parseXmlValue(src: string, at: number): { value: unknown; end: number } {
  const open = (tag: string, from: number) => {
    const i = src.indexOf(`<${tag}`, from);
    return i < 0 ? -1 : src.indexOf(">", i) + 1;
  };
  let i = open("value", at);
  if (i <= 0) throw new Error("The site's answer could not be read.");
  while (/\s/.test(src[i])) i++;
  if (src[i] !== "<") {
    const end = src.indexOf("</value>", i);
    return { value: unxml(src.slice(i, end)), end: end + 8 };
  }
  const type = /^<([\w.]+)\s*\/?>/.exec(src.slice(i, i + 40))?.[1] ?? "";
  if (src.startsWith(`<${type}/>`, i)) return { value: type === "string" ? "" : null, end: src.indexOf("</value>", i) + 8 };
  if (type === "struct") {
    const out: Record<string, unknown> = {};
    let pos = i + 8;
    for (;;) {
      const nextMember = src.indexOf("<member>", pos);
      const close = src.indexOf("</struct>", pos);
      if (nextMember < 0 || close < nextMember) return { value: out, end: src.indexOf("</value>", close) + 8 };
      const n1 = src.indexOf("<name>", nextMember) + 6;
      const name = unxml(src.slice(n1, src.indexOf("</name>", n1)));
      const inner = parseXmlValue(src, src.indexOf("</name>", n1));
      out[name] = inner.value;
      pos = src.indexOf("</member>", inner.end) + 9;
      if (pos < inner.end || inner.end < n1) throw new Error("The site's answer could not be read.");
    }
  }
  if (type === "array") {
    const out: unknown[] = [];
    let pos = src.indexOf("<data>", i) + 6;
    for (;;) {
      const nextValue = src.indexOf("<value>", pos);
      const close = src.indexOf("</data>", pos);
      if (nextValue < 0 || close < nextValue) return { value: out, end: src.indexOf("</value>", close) + 8 };
      const inner = parseXmlValue(src, pos);
      out.push(inner.value);
      if (inner.end <= pos) throw new Error("The site's answer could not be read.");
      pos = inner.end;
    }
  }
  const start = i + type.length + 2;
  const end = src.indexOf(`</${type}>`, start);
  const text = unxml(src.slice(start, end));
  const value = type === "int" || type === "i4" || type === "double" ? Number(text) : type === "boolean" ? text === "1" : type === "dateTime.iso8601" ? text.replace(/^(\d{4})(\d{2})(\d{2})T/, "$1-$2-$3T") : text;
  return { value, end: src.indexOf("</value>", end) + 8 };
}
const unxml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** One call through WordPress's older entrance. */
async function xmlrpc<T>(site: Pick<WordPressSite, "url" | "user" | "password">, method: string, params: unknown[]): Promise<T> {
  const host = new URL(site.url).host;
  const res = await fetch(`${site.url}/xmlrpc.php`, {
    method: "POST",
    headers: { "content-type": "text/xml" },
    body: `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params.map((v) => `<param>${xmlValue(v)}</param>`).join("")}</params></methodCall>`,
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  }).catch(() => {
    throw new Error(`${host} could not be reached.`);
  });
  const text = await res.text();
  if (!res.ok || !text.includes("<methodResponse>")) throw new Error(`${host} has this entrance switched off (it answered ${res.status}). Ask your host or your security plugin to allow xmlrpc.php, or to pass the Authorization header to PHP.`);
  if (text.includes("<fault>")) {
    const fault = parseXmlValue(text, text.indexOf("<fault>")).value as { faultCode?: number; faultString?: string };
    const why = stripTags(String(fault.faultString ?? "")).slice(0, 200);
    throw Object.assign(new Error(fault.faultCode === 403 ? `WordPress refused that: ${why || "the user name or application password is not accepted"}.` : `WordPress answered: ${why || "it could not do that"}.`), { refused: fault.faultCode === 403 });
  }
  return parseXmlValue(text, text.indexOf("<params>")).value as T;
}

// ---------- one set of site calls, over either entrance ----------
interface Item {
  id: number;
  title: string;
  status: string;
  link: string;
  date: string;
  /** The content as WordPress stores it. */
  html: string;
}
interface WpItem {
  id: number;
  status: string;
  link: string;
  date: string;
  modified: string;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
}
interface XItem {
  post_id: string;
  post_title: string;
  post_status: string;
  link: string;
  post_modified: string;
  post_content: string;
}
const fromRest = (p: WpItem): Item => ({ id: p.id, title: plainText(p.title.raw ?? p.title.rendered) || "(no title)", status: p.status, link: p.link, date: p.modified || p.date, html: p.content.raw ?? p.content.rendered });
const fromXml = (p: XItem): Item => ({ id: Number(p.post_id), title: plainText(p.post_title) || "(no title)", status: p.post_status, link: p.link, date: String(p.post_modified ?? ""), html: p.post_content ?? "" });
type Change = { title?: string; html?: string; excerpt?: string; status?: string; date?: Date };

/** The site's posts and pages: list, read, make and change, whichever entrance the site is reached by. */
function siteCalls(site: WordPressSite) {
  const route = (kind: unknown) => (kind === "page" ? "pages" : "posts");
  const type = (kind: unknown) => (kind === "page" ? "page" : "post");
  if (site.via === "xmlrpc") {
    const call = <T>(method: string, ...rest: unknown[]) => xmlrpc<T>(site, method, [0, site.user, site.password, ...rest]);
    const fields = (c: Change) => ({ ...(c.title !== undefined ? { post_title: c.title } : {}), ...(c.html !== undefined ? { post_content: c.html } : {}), ...(c.excerpt ? { post_excerpt: c.excerpt } : {}), ...(c.status ? { post_status: c.status } : {}), ...(c.date ? { post_date_gmt: c.date } : {}) });
    return {
      list: async (kind: unknown, search: string, count: number) => (await call<XItem[]>("wp.getPosts", { post_type: type(kind), number: count, orderby: "post_modified", order: "DESC", ...(search ? { s: search } : {}) })).map(fromXml),
      get: async (kind: unknown, id: number) => fromXml(await call<XItem>("wp.getPost", id)),
      create: async (kind: unknown, c: Change) => fromXml(await call<XItem>("wp.getPost", Number(await call<string>("wp.newPost", { post_type: type(kind), post_status: "draft", ...fields(c) })))),
      update: async (kind: unknown, id: number, c: Change) => (await call<boolean>("wp.editPost", id, fields(c)), fromXml(await call<XItem>("wp.getPost", id))),
    };
  }
  const body = (c: Change) => ({ ...(c.title !== undefined ? { title: c.title } : {}), ...(c.html !== undefined ? { content: c.html } : {}), ...(c.excerpt ? { excerpt: c.excerpt } : {}), ...(c.status ? { status: c.status } : {}), ...(c.date ? { date_gmt: c.date.toISOString().slice(0, 19) } : {}) });
  return {
    list: async (kind: unknown, search: string, count: number) => (await wp<WpItem[]>(site, "GET", `${route(kind)}?context=edit&per_page=${count}&status=any&orderby=modified${search ? `&search=${encodeURIComponent(search)}` : ""}`)).map(fromRest),
    get: async (kind: unknown, id: number) => fromRest(await wp<WpItem>(site, "GET", `${route(kind)}/${id}?context=edit`)),
    create: async (kind: unknown, c: Change) => fromRest(await wp<WpItem>(site, "POST", route(kind), { status: "draft", ...body(c) })),
    update: async (kind: unknown, id: number, c: Change) => fromRest(await wp<WpItem>(site, "POST", `${route(kind)}/${id}`, body(c))),
  };
}

const siteFor = (which: unknown): WordPressSite => {
  const all = sites();
  if (!all.length) throw new Error("No WordPress site is connected. The owner connects one under Integrations.");
  const want = String(which ?? "").trim().toLowerCase();
  const site = want ? all.find((s) => s.id === want || s.name.toLowerCase() === want || new URL(s.url).host === want) : all.length === 1 ? all[0] : undefined;
  if (!site) throw new Error(`Say which site: ${all.map((s) => `${s.name} (${s.id})`).join(", ")}.`);
  return site;
};

/** The site's newest posts or pages, for the owner's page and for agents. */
export async function listContent(siteId: string, kind: "post" | "page" = "post", search = "", count = 10): Promise<{ id: number; title: string; status: string; link: string; date: string }[]> {
  const items = await siteCalls(siteFor(siteId)).list(kind, search, Math.min(50, Math.max(1, count)));
  return items.map(({ html: _html, ...p }) => p);
}

/** The tools agents use for WordPress. Publishing is its own tool, so the owner's rule for it can be held exactly. */
export function wordpressTools(): Tool[] {
  const all = sites();
  if (!all.length) return [];
  const which = `Which site, when more than one is connected: ${all.map((s) => `${s.name} (${s.id})`).join(", ")}.`;
  const content = defineTool<{ action: "sites" | "list" | "read" | "draft" | "update"; site?: string; kind?: "post" | "page"; id?: number; title?: string; markdown?: string; excerpt?: string; search?: string }>({
    name: "wordpress__content",
    description:
      "The owner's WordPress site: its posts and pages. \"sites\" lists the connected sites and what you may do on each. \"list\" shows recent posts or pages (give search words to find some). \"read\" returns one, as text. " +
      "\"draft\" saves a new post or page as a draft that is not public: give a title and the text in Markdown (headings, short paragraphs, lists). \"update\" changes the title or text of an existing post or page; read it first, and give the whole new text. " +
      "Drafting and updating never publish anything. Write for the site's readers, in the owner's voice, and never invent facts, prices or quotes.",
    properties: {
      action: { type: "string", enum: ["sites", "list", "read", "draft", "update"] },
      site: { type: "string", description: which },
      kind: { type: "string", enum: ["post", "page"], description: "A blog post (the default) or a page of the site." },
      id: { type: "number", description: "For read and update: the post's or page's number, as given by list." },
      title: { type: "string", description: "For draft and update: the title." },
      markdown: { type: "string", description: "For draft and update: the whole text, in Markdown." },
      excerpt: { type: "string", description: "For draft and update: one or two sentences shown in lists and search results." },
      search: { type: "string", description: "For list: words to look for." },
    },
    required: ["action"],
    // Reading asks nothing; anything that writes to the site asks first unless the agent is set to run without asking.
    needsApproval: (input) => input.action === "draft" || input.action === "update",
    async run(input) {
      if (input.action === "sites") return sites().map((s) => `${s.name} (${s.id}), ${new URL(s.url).host}: ${PUBLISH_WORDS[s.publish]}.`).join("\n");
      const site = siteFor(input.site);
      const calls = siteCalls(site);
      const what = input.kind === "page" ? "page" : "post";
      if (input.action === "list") {
        const items = await calls.list(input.kind, String(input.search ?? ""), 20);
        return items.length ? items.map((p) => `[${p.id}] ${p.title} · ${p.status} · ${p.date.slice(0, 10)} · ${p.link}`).join("\n") : "Nothing found.";
      }
      if (input.action === "read") {
        if (!input.id) throw new Error("Say which one (its number, from list).");
        const p = await calls.get(input.kind, Number(input.id));
        return `${p.title}\nStatus: ${p.status} · ${p.link}\n\n${plainText(p.html).slice(0, 30_000)}`;
      }
      const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const text = String(input.markdown ?? "").trim();
      const excerpt = input.excerpt ? String(input.excerpt).slice(0, 500) : undefined;
      if (input.action === "draft") {
        if (!title || !text) throw new Error("Give a title and the text.");
        const p = await calls.create(input.kind, { title, html: markdownToHtml(text), excerpt });
        audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent saved a draft on ${site.name}`, detail: `${title} (${what} ${p.id})` });
        return `Saved as a draft on ${site.name}: “${title}” (${what} ${p.id}). It is not public. ${site.publish === "drafts" ? "The owner publishes it in WordPress; say so in your report, with its title." : "Publish it with the publish tool when it is ready."}`;
      }
      if (!input.id) throw new Error("Say which one to update (its number, from list).");
      if (!title && !text) throw new Error("Give the new title, the new text, or both.");
      const before = await calls.get(input.kind, Number(input.id));
      // On a site where agents only draft, something already public is not changed: the change would go live at once.
      if (before.status === "publish" && site.publish === "drafts") throw new Error(`“${before.title}” is already public, and on this site you only write drafts. Save your version as a new draft and tell the owner what should replace what.`);
      const p = await calls.update(input.kind, Number(input.id), { ...(title ? { title } : {}), ...(text ? { html: markdownToHtml(text) } : {}), excerpt });
      audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent changed a ${what} on ${site.name}`, detail: `${p.title} (${p.id}), ${p.status}` });
      return `Updated “${p.title}” on ${site.name} (${p.status === "publish" ? "it is public, so the change is live" : `status: ${p.status}`}). WordPress keeps the earlier version under Revisions. Say so in your report.`;
    },
  });
  const publish = defineTool<{ site?: string; kind?: "post" | "page"; id: number; when?: string }>({
    name: "wordpress__publish",
    description: "Publishes a draft post or page on the owner's WordPress site, making it public, now or at a later time. Only where the owner allows it; on other sites it explains what to do instead.",
    properties: {
      site: { type: "string", description: which },
      kind: { type: "string", enum: ["post", "page"] },
      id: { type: "number", description: "The draft's number, as given when it was saved." },
      when: { type: "string", description: "Optional: a date and time to publish at, like 2026-12-01T09:00. Left out, it is published now." },
    },
    required: ["id"],
    needsApproval: (input) => {
      try {
        return siteFor(input.site).publish !== "auto";
      } catch {
        return true;
      }
    },
    async run(input) {
      const site = siteFor(input.site);
      if (site.publish === "drafts") throw new Error(`On ${site.name} the owner publishes drafts themselves in WordPress. Leave it as a draft and say in your report that it is ready, with its title.`);
      const when = input.when ? new Date(input.when) : null;
      if (when && Number.isNaN(when.getTime())) throw new Error("Write the time like 2026-12-01T09:00.");
      const later = Boolean(when && when.getTime() > Date.now() + 60_000);
      const p = await siteCalls(site).update(input.kind, Number(input.id), later ? { status: "future", date: when! } : { status: "publish" });
      audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent ${later ? "scheduled" : "published"} a ${input.kind === "page" ? "page" : "post"} on ${site.name}`, detail: `${p.title} · ${p.link}` });
      return `${later ? `Scheduled for ${when!.toISOString().slice(0, 16).replace("T", " ")}` : "Published"}: “${p.title}” · ${p.link}. Say so in your report, with the link.`;
    },
  });
  return [content, publish];
}

/** The words of a routine that writes a blog post each day, for one site. */
export function dailyPostPrompt(site: PublicSite, about: unknown): string {
  const topics = String(about ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  return [
    `Write today's blog post for ${site.name} (${new URL(site.url).host}).`,
    topics ? `What the blog is about, and what to write on: ${topics}` : "Choose a topic that fits what the site already publishes.",
    `First use the wordpress__content tool: list the recent posts on site ${site.id}, so you do not repeat one, and read one or two to match their voice and length. Look in the workspace for pages about the business, its prices and its rules, and follow them. Do not invent facts, numbers, quotes or customer names; if you are unsure of a fact, leave it out.`,
    "Write 600 to 900 words: a clear title, a short opening, a few headed sections, and a closing line that says what the reader can do next. Add a one or two sentence excerpt.",
    site.publish === "drafts" ? "Save it as a draft with wordpress__content. Do not try to publish it: the owner does that in WordPress. In your report give the title and say it is waiting as a draft." : `Save it as a draft with wordpress__content, then publish it with wordpress__publish${site.publish === "ask" ? " (the owner is asked to approve)" : ""}. In your report give the title and the link.`,
  ].join("\n\n");
}
