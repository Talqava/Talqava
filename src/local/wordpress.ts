// WordPress: connect a site so agents can write and edit its posts and pages. It uses WordPress's own REST API with
// an application password (built into WordPress since 5.6), so nothing is installed on the site. What an agent may do
// is set per site: write drafts only (the owner publishes in WordPress), ask before each publish, or publish without
// asking. The password is kept on this computer and sent only to that site.
import crypto from "node:crypto";
import type { Tool } from "../core/index.ts";
import { defineTool } from "../core/index.ts";
import { getConfig, saveConfig } from "./store.ts";
import { audit } from "./audit.ts";

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
  if (res.status === 401 || res.status === 403) throw new Error(`WordPress refused that: ${data?.message?.replace(/<[^>]*>/g, "") || "the user name or application password is not accepted, or this user may not do this"}.`);
  if (res.status === 404 && !data) throw new Error("That address does not answer as a WordPress site. Check the address, and that the site's REST API is not switched off.");
  if (!res.ok) throw new Error(`WordPress answered ${res.status}${data?.message ? `: ${data.message.replace(/<[^>]*>/g, "").slice(0, 200)}` : "."}`);
  return data as T;
}

/** Connects a site: the user name and application password are checked with the site before anything is saved. */
export async function connectSite(input: { url?: unknown; user?: unknown; password?: unknown; publish?: unknown }): Promise<PublicSite> {
  const url = cleanUrl(input.url);
  const user = String(input.user ?? "").trim().slice(0, 100);
  const password = String(input.password ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!user) throw new Error("Give your WordPress user name.");
  if (!password) throw new Error("Paste the application password WordPress made for Talqava. It is not your normal password: make one under Users › Profile › Application Passwords.");
  const me = await wp<{ name?: string; capabilities?: Record<string, boolean> }>({ url, user, password }, "GET", "users/me?context=edit");
  if (me.capabilities && !me.capabilities.edit_posts) throw new Error("That WordPress user may not write posts. Use an Author, Editor or Administrator account.");
  let name = new URL(url).host;
  try {
    const info = (await (await fetch(`${url}/wp-json/`, { signal: AbortSignal.timeout(15_000) })).json()) as { name?: string };
    if (info.name) name = plainText(String(info.name)).slice(0, 80) || name;
  } catch {}
  const all = sites();
  const existing = all.find((s) => s.url === url);
  const site: WordPressSite = { id: existing?.id ?? crypto.randomBytes(5).toString("hex"), name, url, user, password, publish: PUBLISH_RULES.includes(input.publish as PublishRule) ? (input.publish as PublishRule) : (existing?.publish ?? "drafts") };
  saveConfig({ wordpress: [...all.filter((s) => s.url !== url), site] });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Connected the WordPress site ${name}`, detail: `${new URL(url).host} as ${user}` });
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
const plainText = (html: string) => html.replace(/<(br|\/p|\/h\d|\/li|\/tr)[^>]*>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

interface WpItem {
  id: number;
  status: string;
  link: string;
  date: string;
  modified: string;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
}
const siteFor = (which: unknown): WordPressSite => {
  const all = sites();
  if (!all.length) throw new Error("No WordPress site is connected. The owner connects one under Integrations.");
  const want = String(which ?? "").trim().toLowerCase();
  const site = want ? all.find((s) => s.id === want || s.name.toLowerCase() === want || new URL(s.url).host === want) : all.length === 1 ? all[0] : undefined;
  if (!site) throw new Error(`Say which site: ${all.map((s) => `${s.name} (${s.id})`).join(", ")}.`);
  return site;
};
const kindRoute = (kind: unknown) => (kind === "page" ? "pages" : "posts");

/** The site's newest posts or pages, for the owner's page and for agents. */
export async function listContent(siteId: string, kind: "post" | "page" = "post", search = "", count = 10): Promise<{ id: number; title: string; status: string; link: string; date: string }[]> {
  const site = siteFor(siteId);
  const items = await wp<WpItem[]>(site, "GET", `${kindRoute(kind)}?context=edit&per_page=${Math.min(50, Math.max(1, count))}&status=any&orderby=modified${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  return items.map((p) => ({ id: p.id, title: plainText(p.title.raw ?? p.title.rendered) || "(no title)", status: p.status, link: p.link, date: p.modified || p.date }));
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
      const route = kindRoute(input.kind);
      if (input.action === "list") {
        const items = await listContent(site.id, input.kind === "page" ? "page" : "post", String(input.search ?? ""), 20);
        return items.length ? items.map((p) => `[${p.id}] ${p.title} · ${p.status} · ${p.date.slice(0, 10)} · ${p.link}`).join("\n") : "Nothing found.";
      }
      if (input.action === "read") {
        if (!input.id) throw new Error("Say which one (its number, from list).");
        const p = await wp<WpItem>(site, "GET", `${route}/${Number(input.id)}?context=edit`);
        return `${plainText(p.title.raw ?? p.title.rendered)}\nStatus: ${p.status} · ${p.link}\n\n${plainText(p.content.raw ?? p.content.rendered).slice(0, 30_000)}`;
      }
      const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const text = String(input.markdown ?? "").trim();
      if (input.action === "draft") {
        if (!title || !text) throw new Error("Give a title and the text.");
        const p = await wp<WpItem>(site, "POST", route, { title, content: markdownToHtml(text), status: "draft", ...(input.excerpt ? { excerpt: String(input.excerpt).slice(0, 500) } : {}) });
        audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent saved a draft on ${site.name}`, detail: `${title} (${input.kind === "page" ? "page" : "post"} ${p.id})` });
        return `Saved as a draft on ${site.name}: “${title}” (${input.kind === "page" ? "page" : "post"} ${p.id}). It is not public. ${site.publish === "drafts" ? "The owner publishes it in WordPress; say so in your report, with its title." : "Publish it with the publish tool when it is ready."}`;
      }
      if (!input.id) throw new Error("Say which one to update (its number, from list).");
      if (!title && !text) throw new Error("Give the new title, the new text, or both.");
      const before = await wp<WpItem>(site, "GET", `${route}/${Number(input.id)}?context=edit`);
      // On a site where agents only draft, something already public is not changed: the change would go live at once.
      if (before.status === "publish" && site.publish === "drafts") throw new Error(`“${plainText(before.title.rendered)}” is already public, and on this site you only write drafts. Save your version as a new draft and tell the owner what should replace what.`);
      const p = await wp<WpItem>(site, "POST", `${route}/${Number(input.id)}`, { ...(title ? { title } : {}), ...(text ? { content: markdownToHtml(text) } : {}), ...(input.excerpt ? { excerpt: String(input.excerpt).slice(0, 500) } : {}) });
      audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent changed a ${input.kind === "page" ? "page" : "post"} on ${site.name}`, detail: `${plainText(p.title.rendered)} (${p.id}), ${p.status}` });
      return `Updated “${plainText(p.title.rendered)}” on ${site.name} (${p.status === "publish" ? "it is public, so the change is live" : `status: ${p.status}`}). WordPress keeps the earlier version under Revisions. Say so in your report.`;
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
      const later = when && when.getTime() > Date.now() + 60_000;
      const p = await wp<WpItem>(site, "POST", `${kindRoute(input.kind)}/${Number(input.id)}`, later ? { status: "future", date: when!.toISOString().slice(0, 19) } : { status: "publish" });
      audit({ actor: "system", actorName: "WordPress", kind: "integration", action: `An agent ${later ? "scheduled" : "published"} a ${input.kind === "page" ? "page" : "post"} on ${site.name}`, detail: `${plainText(p.title.rendered)} · ${p.link}` });
      return `${later ? `Scheduled for ${when!.toISOString().slice(0, 16).replace("T", " ")}` : "Published"}: “${plainText(p.title.rendered)}” · ${p.link}. Say so in your report, with the link.`;
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
