// WordPress, against a stand-in site that answers like WordPress's own REST API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-wp-"));
let W: typeof import("../../src/local/wordpress.ts");
let site: http.Server;
let url = "";
const posts = new Map<number, any>();
let nextId = 10;
const calls: { method: string; path: string; body: any }[] = [];
const GOOD = `Basic ${Buffer.from("ada:abcd efgh ijkl mnop").toString("base64")}`;

before(async () => {
  W = await import("../../src/local/wordpress.ts");
  posts.set(7, { id: 7, status: "publish", link: "https://blog.example/hello", date: "2026-11-20T10:00:00", modified: "2026-11-20T10:00:00", title: { rendered: "Hello world", raw: "Hello world" }, content: { rendered: "<p>Welcome to the blog.</p>", raw: "<p>Welcome to the blog.</p>" } });
  site = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const json = (status: number, v: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
      const u = new URL(req.url!, "http://x");
      if (u.pathname === "/wp-json/") return json(200, { name: "Ada&#8217;s Bakery" });
      if (!u.pathname.startsWith("/wp-json/wp/v2/")) return (res.writeHead(404), res.end("not found"));
      if (!req.headers.authorization || req.headers["x-drop-auth"]) return json(401, { code: "rest_not_logged_in", message: "You are not currently logged in.", data: { status: 401 } });
      if (req.headers.authorization !== GOOD) return json(401, { code: "incorrect_password", message: "The provided password is an invalid application password." });
      const route = u.pathname.slice("/wp-json/wp/v2/".length);
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method!, path: route, body });
      if (route === "users/me") return json(200, { name: "Ada", capabilities: { edit_posts: true } });
      const m = /^(posts|pages)(?:\/(\d+))?$/.exec(route);
      if (!m) return json(404, { message: "No route" });
      if (req.method === "GET" && !m[2]) return json(200, [...posts.values()].filter((p) => !u.searchParams.get("search") || p.title.raw.toLowerCase().includes(u.searchParams.get("search")!.toLowerCase())));
      if (req.method === "GET") return posts.has(Number(m[2])) ? json(200, posts.get(Number(m[2]))) : json(404, { message: "Invalid post ID." });
      const id = m[2] ? Number(m[2]) : nextId++;
      const before = posts.get(id) ?? { id, status: "draft", link: `https://blog.example/?p=${id}`, date: "2026-11-26T09:00:00", modified: "2026-11-26T09:00:00", title: { rendered: "", raw: "" }, content: { rendered: "", raw: "" } };
      const p = { ...before, ...(body.status ? { status: body.status } : {}), ...(body.title ? { title: { rendered: body.title, raw: body.title } } : {}), ...(body.content ? { content: { rendered: body.content, raw: body.content } } : {}) };
      posts.set(id, p);
      json(m[2] ? 200 : 201, p);
    });
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
after(() => site.close());
const tools = () => Object.fromEntries(W.wordpressTools().map((t) => [t.name, t]));
const run = async (name: string, input: any) => String(await tools()[name].run(input, { conversation: { id: "t" }, signal: new AbortController().signal } as never));

test("connecting checks the application password with the site first, and never shows it again", async () => {
  await assert.rejects(W.connectSite({ url: "http://example.com", user: "ada", password: "x" }), /must start with https/);
  await assert.rejects(W.connectSite({ url, user: "", password: "x" }), /user name/);
  await assert.rejects(W.connectSite({ url, user: "ada", password: "" }), /application password WordPress made/);
  await assert.rejects(W.connectSite({ url, user: "ada", password: "wrong" }), /WordPress refused that: The provided password is an invalid application password/);
  assert.deepEqual(W.listSites(), [], "a refused password saves nothing");
  const s = await W.connectSite({ url: `${url}/wp-admin/`, user: "ada", password: "abcd  efgh ijkl mnop" });
  assert.deepEqual([s.name, s.url, s.user, s.publish], ["Ada’s Bakery", url, "ada", "drafts"]);
  assert.equal("password" in s, false);
  assert.equal(W.wordpressTools().length, 2);
});

test("on a drafts-only site, an agent reads, drafts and cannot publish or change what is already public", async () => {
  assert.match(await run("wordpress__content", { action: "sites" }), /Agents write drafts only/);
  assert.match(await run("wordpress__content", { action: "list" }), /\[7\] Hello world · publish · 2026-11-20/);
  assert.match(await run("wordpress__content", { action: "read", id: 7 }), /Hello world\nStatus: publish[\s\S]*Welcome to the blog\./);
  const out = await run("wordpress__content", { action: "draft", title: "Five tips for sourdough", markdown: "## Start small\n\nUse a **little** starter.\n\n- Feed it daily\n- Keep it warm", excerpt: "Five tips." });
  assert.match(out, /Saved as a draft on .*“Five tips for sourdough” \(post 10\)\. It is not public\. The owner publishes it in WordPress/);
  const sent = calls.find((c) => c.method === "POST" && c.path === "posts")!.body;
  assert.equal(sent.status, "draft");
  assert.equal(sent.content, "<h2>Start small</h2>\n<p>Use a <strong>little</strong> starter.</p>\n<ul><li>Feed it daily</li><li>Keep it warm</li></ul>");
  await assert.rejects(run("wordpress__publish", { id: 10 }), /the owner publishes drafts themselves in WordPress/);
  await assert.rejects(run("wordpress__content", { action: "update", id: 7, markdown: "Changed." }), /already public, and on this site you only write drafts/);
  assert.match(await run("wordpress__content", { action: "update", id: 10, title: "Six tips for sourdough" }), /Updated “Six tips for sourdough”.*status: draft/);
  assert.equal(posts.get(10).status, "draft");
  // Writing to the site asks first; reading does not; publishing asks unless the owner said otherwise.
  const t = tools();
  assert.deepEqual([t.wordpress__content.needsApproval!({ action: "read" } as never), t.wordpress__content.needsApproval!({ action: "draft" } as never), t.wordpress__publish.needsApproval!({ id: 1 } as never)], [false, true, true]);
});

test("the owner's rule for publishing is held: ask each time, or publish without asking", async () => {
  const id = W.listSites()[0].id;
  assert.equal(W.updateSite(id, { publish: "ask" }).publish, "ask");
  assert.equal(tools().wordpress__publish.needsApproval!({ id: 10 } as never), true);
  assert.match(await run("wordpress__publish", { id: 10 }), /Published: “Six tips for sourdough” · https:\/\/blog\.example\/\?p=10/);
  assert.equal(posts.get(10).status, "publish");
  W.updateSite(id, { publish: "auto" });
  assert.equal(tools().wordpress__publish.needsApproval!({ id: 10 } as never), false);
  assert.match(await run("wordpress__content", { action: "draft", title: "Later", markdown: "Soon." }), /Publish it with the publish tool/);
  assert.match(await run("wordpress__publish", { id: 11, when: "2099-01-01T09:00" }), /Scheduled for 2099-01-01/);
  assert.equal(posts.get(11).status, "future");
  assert.equal(W.updateSite(id, { publish: "nonsense" }).publish, "auto");

  const prompt = W.dailyPostPrompt({ ...W.listSites()[0], publish: "drafts" }, "Baking tips for home bakers");
  assert.match(prompt, /Write today's blog post/);
  assert.match(prompt, /Baking tips for home bakers/);
  assert.match(prompt, /Do not try to publish it/);
  assert.match(W.dailyPostPrompt(W.listSites()[0], ""), /then publish it with wordpress__publish/);

  W.removeSite(id);
  assert.deepEqual(W.listSites(), []);
  assert.equal(W.wordpressTools().length, 0);
});

test("Markdown becomes the plain HTML WordPress stores, with anything that looks like a tag made harmless", () => {
  assert.equal(W.markdownToHtml("# Title\n\nA *short* line\nthat continues.\n\n1. One\n2. Two\n\n> Quoted\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Link](https://example.com) and <script>alert(1)</script>"), '<h1>Title</h1>\n<p>A <em>short</em> line that continues.</p>\n<ol><li>One</li><li>Two</li></ol>\n<blockquote><p>Quoted</p></blockquote>\n<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>\n<p><a href="https://example.com">Link</a> and &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(W.markdownToHtml("[bad](javascript:alert(1))"), "<p>[bad](javascript:alert(1))</p>");
});

test("when the host drops the sign-in details, the owner is told what to do on the site", async () => {
  // A site that never sees the Authorization header answers as if nobody signed in.
  const dropping = http.createServer((req, res) => (res.writeHead(401, { "content-type": "application/json" }), res.end(JSON.stringify({ code: "rest_not_logged_in", message: "You are not currently logged in.", data: { status: 401 } }))));
  await new Promise<void>((r) => dropping.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(W.connectSite({ url: `http://127.0.0.1:${(dropping.address() as AddressInfo).port}`, user: "ada", password: "abcd efgh ijkl mnop" }), /did not receive your user name and password.*Settings › Permalinks and press Save Changes/s);
  } finally {
    dropping.close();
  }
});

test("when the host drops the sign-in details, Talqava uses WordPress's other entrance, and agents work the same", async () => {
  // A site whose host strips the Authorization header: the REST API never sees a sign-in, XML-RPC carries it inside.
  const items = new Map<number, any>([[3, { post_id: "3", post_title: "Old news", post_status: "publish", link: "https://shop.example/old-news", post_modified: "20261120T10:00:00", post_content: "<p>Fish &amp; chips</p>" }]]);
  let next = 20;
  const seen: { method: string; fields: Record<string, string> }[] = [];
  const val = (v: any): string => (Array.isArray(v) ? `<value><array><data>\n${v.map(val).join("\n")}\n</data></array></value>` : v && typeof v === "object" ? `<value><struct>\n${Object.entries(v).map(([k, x]) => `  <member><name>${k}</name>${k === "post_modified" ? `<value><dateTime.iso8601>${x}</dateTime.iso8601></value>` : val(x)}</member>`).join("\n")}\n</struct></value>` : typeof v === "boolean" ? `<value><boolean>${v ? 1 : 0}</boolean></value>` : `<value><string>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</string></value>`);
  const answer = (v: any) => `<?xml version="1.0" encoding="UTF-8"?>\n<methodResponse>\n  <params>\n    <param>\n      ${val(v)}\n    </param>\n  </params>\n</methodResponse>`;
  const fault = (code: number, why: string) => `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>${code}</int></value></member><member><name>faultString</name><value><string>${why}</string></value></member></struct></value></fault></methodResponse>`;
  const unesc = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const older = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/wp-json/") return (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify({ name: "Corner Shop" })));
      if (req.url !== "/xmlrpc.php") return (res.writeHead(401, { "content-type": "application/json" }), res.end(JSON.stringify({ code: "rest_not_logged_in", message: "You are not currently logged in." })));
      assert.equal(req.headers.authorization, undefined, "nothing is sent in the header the host drops");
      const method = /<methodName>([\w.]+)<\/methodName>/.exec(raw)![1];
      const strings = [...raw.matchAll(/<param><value><string>(.*?)<\/string><\/value><\/param>/gs)].map((m) => unesc(m[1]));
      const ints = [...raw.matchAll(/<param><value><int>(\d+)<\/int><\/value><\/param>/g)].map((m) => Number(m[1]));
      const fields = Object.fromEntries([...raw.matchAll(/<member><name>(\w+)<\/name><value><(?:string|int|dateTime\.iso8601)>(.*?)<\/(?:string|int|dateTime\.iso8601)><\/value><\/member>/gs)].map((m) => [m[1], unesc(m[2])]));
      const send = (body: string) => (res.writeHead(200, { "content-type": "text/xml" }), res.end(body));
      if (strings[0] !== "ada" || strings[1] !== "abcd efgh ijkl mnop") return send(fault(403, "Incorrect username or password."));
      seen.push({ method, fields });
      if (method === "wp.getProfile") return send(answer({ user_id: "1", roles: ["editor"] }));
      if (method === "wp.getPosts") return send(answer([...items.values()].filter((p) => !fields.s || p.post_title.toLowerCase().includes(fields.s.toLowerCase()))));
      if (method === "wp.getPost") return items.has(ints[1]) ? send(answer(items.get(ints[1]))) : send(fault(404, "Invalid post ID."));
      if (method === "wp.newPost") {
        const id = next++;
        items.set(id, { post_id: String(id), post_title: fields.post_title, post_status: fields.post_status, link: `https://shop.example/?p=${id}`, post_modified: "20261126T09:00:00", post_content: fields.post_content });
        return send(answer(String(id)));
      }
      if (method === "wp.editPost") {
        const p = items.get(ints[1]);
        if (fields.post_title) p.post_title = fields.post_title;
        if (fields.post_content) p.post_content = fields.post_content;
        if (fields.post_status) p.post_status = fields.post_status;
        return send(answer(true));
      }
      send(fault(-32601, "server error. requested method does not exist."));
    });
  });
  await new Promise<void>((r) => older.listen(0, "127.0.0.1", r));
  const at = `http://127.0.0.1:${(older.address() as AddressInfo).port}`;
  try {
    await assert.rejects(W.connectSite({ url: at, user: "ada", password: "wrong" }), /WordPress refused that: Incorrect username or password/);
    assert.deepEqual(W.listSites(), []);
    const s = await W.connectSite({ url: at, user: "ada", password: "abcd efgh ijkl mnop", publish: "ask" });
    assert.equal(s.name, "Corner Shop");
    assert.equal(W.listSites()[0].via, "xmlrpc");

    assert.match(await run("wordpress__content", { action: "list" }), /\[3\] Old news · publish · 2026-11-20 · https:\/\/shop\.example\/old-news/);
    assert.equal(await run("wordpress__content", { action: "list", search: "nothing like it" }), "Nothing found.");
    assert.match(await run("wordpress__content", { action: "read", id: 3 }), /Old news\nStatus: publish.*\n\nFish & chips/);
    assert.match(await run("wordpress__content", { action: "draft", title: "Winter <hours> & prices", markdown: "We close at **five** in December." }), /Saved as a draft on Corner Shop: “Winter <hours> & prices” \(post 20\)\. It is not public/);
    assert.equal(items.get(20).post_status, "draft");
    assert.equal(items.get(20).post_title, "Winter <hours> & prices");
    assert.equal(items.get(20).post_content, "<p>We close at <strong>five</strong> in December.</p>");
    assert.match(await run("wordpress__content", { action: "update", id: 20, title: "Winter hours" }), /Updated “Winter hours” on Corner Shop \(status: draft\)/);
    assert.match(await run("wordpress__publish", { id: 20 }), /Published: “Winter hours”/);
    assert.equal(items.get(20).post_status, "publish");
    assert.match(await run("wordpress__publish", { id: 3, when: "2031-01-02T09:00:00Z" }), /Scheduled for 2031-01-02 09:00/);
    const last = seen.at(-2)!;
    assert.equal(last.method, "wp.editPost");
    assert.equal(last.fields.post_status, "future");
    assert.equal(last.fields.post_date_gmt, "20310102T09:00:00");
    await assert.rejects(run("wordpress__content", { action: "read", id: 99 }), /WordPress answered: Invalid post ID/);
    assert.equal((await W.listContent(s.id))[0].title, "Old news");
    W.removeSite(s.id);
  } finally {
    older.close();
  }
});
