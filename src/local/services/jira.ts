// Jira (Atlassian's cloud): issues. Facts from Atlassian's documentation (developer.atlassian.com and
// support.atlassian.com), read November 2026: an API token made at id.atlassian.com is sent with the account's email
// as Basic sign-in to https://<site>.atlassian.net/rest/api/3; searching uses /search/jql (the older /search is
// being removed), which needs a bounded query and returns only ids unless fields are asked for; descriptions and
// comments are in Atlassian's document format. It connects with a token made without scopes: a token with scopes
// uses another address. Atlassian's browser sign-in always needs the app's secret and its pages do not say a
// localhost return address is accepted, so it is not offered. Not confirmed there: making an issue by the project's
// key and the issue type's name (the example uses their numbers), which is what is sent here.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
// Signed in through the browser, Jira is reached by way of Atlassian's own address with the site's id; with a token, at the site itself.
const base = (c: Keys) => (process.env.TALQAVA_JIRA_API || (c.values.cloud_id ? `https://api.atlassian.com/ex/jira/${c.values.cloud_id}/rest/api/3` : `https://${c.values.site}.atlassian.net/rest/api/3`)).replace(/\/+$/, "");
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) =>
  call<T>(`${base(c)}${path}`, { name: "Jira", method, headers: { authorization: c.values.access_token ? `Bearer ${c.values.access_token}` : `Basic ${Buffer.from(`${c.values.email}:${c.values.token}`).toString("base64")}` }, body });

const key = (v: unknown) => {
  const t = String(v ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,30}-\d{1,9}$/.test(t)) throw new Error("Give the issue's key, such as SHOP-12.");
  return t;
};
const projectKey = (v: unknown) => {
  const t = String(v ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(t)) throw new Error("Give the project's key, such as SHOP, from list_projects.");
  return t;
};
/** Words inside a search, quoted so they cannot become search terms of their own. */
const quoted = (v: unknown, most = 200) => `"${String(v ?? "").replace(/[\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, most)}"`;
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);
/** Plain text as Atlassian's document format: one paragraph for each block of lines. */
const doc = (t: string) => ({
  version: 1,
  type: "doc",
  content: t.split(/\n{2,}/).map((block) => ({ type: "paragraph", content: block.split("\n").flatMap((l, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(l ? [{ type: "text", text: l }] : [])]) })),
});
/** The plain text of Atlassian's document format: the words in order, a new line after each block. */
function words(node: any, most = 6000): string {
  const out: string[] = [];
  const walk = (n: any, depth: number) => {
    if (!n || depth > 30 || out.join("").length > most) return;
    if (typeof n.text === "string") out.push(n.text);
    if (n.type === "hardBreak") out.push("\n");
    for (const child of Array.isArray(n.content) ? n.content : []) walk(child, depth + 1);
    if (["paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow"].includes(n.type)) out.push("\n");
  };
  walk(node, 0);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, most);
}
const FIELDS = ["summary", "status", "assignee", "priority", "issuetype", "updated", "labels"];
const line = (i: any) => `${i.key} · ${plain(i.fields?.summary, 160)} · ${plain(i.fields?.status?.name, 40)}${i.fields?.issuetype?.name ? ` · ${plain(i.fields.issuetype.name, 30)}` : ""}${i.fields?.priority?.name ? ` · ${plain(i.fields.priority.name, 20)}` : ""}${i.fields?.assignee?.displayName ? ` · for ${plain(i.fields.assignee.displayName, 60)}` : ""}${i.fields?.labels?.length ? ` · ${i.fields.labels.slice(0, 6).map((l: unknown) => plain(l, 30)).join(", ")}` : ""} · updated ${String(i.fields?.updated ?? "").slice(0, 10)}`;
const search = (c: Keys, jql: string, limit: number) => api<{ issues: any[] }>(c, "/search/jql", "POST", { jql, maxResults: limit, fields: FIELDS });

export const jira: ServiceDef = {
  id: "jira",
  name: "Jira",
  category: "Projects and tasks",
  about: "Read and update Jira issues: find, read, open, comment, move along and assign.",
  steps: [
    "Open id.atlassian.com/manage-profile/security/api-tokens and press Create API token (the plain kind, not the one with scopes).",
    "Name it Talqava and choose when it expires: up to one year. Atlassian shows the token once; copy it.",
    "Below, give your site (the first part of yoursite.atlassian.net), the email you sign in to Atlassian with, and the token. It acts as you, with your permissions.",
  ],
  docs: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
  fields: [
    { key: "site", label: "Jira site", placeholder: "yoursite", help: "The first part of yoursite.atlassian.net.", pattern: "[a-z0-9][a-z0-9-]{0,61}[a-z0-9]" },
    { key: "email", label: "Your Atlassian email", placeholder: "you@example.com" },
    { key: "token", label: "API token", secret: true },
  ],
  // Browser sign-in with the owner's own Atlassian app. Atlassian's token call takes JSON and always needs the
  // app's secret; its pages do not describe PKCE, and do not say whether an address on this computer is accepted.
  browser: {
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"],
    extra: { audience: "api.atlassian.com", prompt: "consent" },
    secret: "required",
    pkce: false,
    tokenStyle: "json",
    appSteps: [
      "Open developer.atlassian.com/console/myapps, press Create and choose OAuth 2.0 integration. Name it Talqava.",
      "Under Permissions, press Add next to Jira API, then configure it with these scopes: read:jira-work, write:jira-work, read:jira-user.",
      "Under Authorization, press Configure next to OAuth 2.0 (3LO) and enter this Callback URL exactly: {redirect}",
      "Under Settings, copy the Client ID and Secret, paste them below and press the button. Atlassian asks which site Talqava may use.",
    ],
  },
  async check(values) {
    if (values.access_token) {
      // Which Jira site was allowed: the first one Atlassian lists for this sign-in.
      const sites = await call<any[]>(process.env.TALQAVA_JIRA_SITES_API || "https://api.atlassian.com/oauth/token/accessible-resources", { name: "Jira", headers: { authorization: `Bearer ${values.access_token}` } });
      const found = (Array.isArray(sites) ? sites : []).find((x) => /^[0-9a-f-]{8,64}$/i.test(String(x?.id)));
      if (!found) throw Object.assign(new Error("Atlassian signed you in, but no Jira site was allowed. Sign in again and choose your site."), { refused: true });
      const siteName = String(found.url ?? "").replace(/^https?:\/\//, "").replace(/\.atlassian\.net.*$/, "") || String(found.name ?? "jira");
      const who = await api<{ accountId: string; displayName?: string }>({ values: { access_token: values.access_token, cloud_id: String(found.id) } }, "/myself");
      if (!who?.accountId) throw Object.assign(new Error("Jira did not say who signed in. Sign in again."), { refused: true });
      return { label: `${plain(who.displayName, 80) || "Your account"} (${plain(siteName, 80)}.atlassian.net)`, values: { cloud_id: String(found.id), site: plain(siteName, 80), account_id: String(who.accountId) } as Record<string, string> };
    }
    const site = String(values.site ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.atlassian\.net.*$/, "");
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(site)) throw new Error("Give your Jira site: the first part of yoursite.atlassian.net.");
    const email = String(values.email ?? "").trim();
    if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email)) throw new Error("Give the email you sign in to Atlassian with.");
    const token = String(values.token ?? "").trim();
    if (!token || /\s/.test(token) || token.length > 500) throw new Error("Paste the API token.");
    const me = await api<{ accountId: string; displayName?: string }>({ values: { site, email, token } }, "/myself");
    if (!me?.accountId) throw Object.assign(new Error("Jira did not say who signed in. Check the email and the token."), { refused: true });
    return { label: `${plain(me.displayName, 80) || email} (${site}.atlassian.net)`, values: { site, email, token, account_id: String(me.accountId) } as Record<string, string> };
  },
  triggers: [
    {
      name: "new_issue",
      summary: "A new issue is opened in a project",
      param: { label: "Project key", placeholder: "SHOP", required: true },
      list: async (c, param) => ((await search(c, `project = ${quoted(projectKey(param))} ORDER BY created DESC`, 25)).issues ?? []).map((i) => String(i.key)),
      async describe(c, id) {
        const i = await api<any>(c, `/issue/${key(id)}${query({ fields: [...FIELDS, "description", "reporter"].join(",") })}`);
        return { title: `Issue ${i.key}: ${plain(i.fields?.summary, 140)}`, text: `${line(i)}${i.fields?.reporter?.displayName ? `\nOpened by ${plain(i.fields.reporter.displayName, 80)}` : ""}\n\n${words(i.fields?.description, 4000)}` };
      },
    },
  ],
  actions: [
    {
      name: "list_projects",
      kind: "read",
      summary: "See the projects",
      description: "Lists the Jira projects you can see: key and name. Use the key with the other tools.",
      properties: { words: { type: "string", description: "Optional: part of the project's name or key." } },
      async run(c, input) {
        const r = await api<{ values: any[] }>(c, `/project/search${query({ query: plain(input.words, 100), maxResults: 100 })}`);
        return (r.values ?? []).map((p) => `${plain(p.key, 40)} · ${plain(p.name, 120)}`).join("\n") || "No projects were found.";
      },
    },
    {
      name: "find_issues",
      kind: "read",
      summary: "Find issues by project, words, status or who they are for",
      description: "Finds issues, most recently updated first. Narrow by project, by words in the text, by status name, and to those assigned to the signed-in person. Give at least one of these.",
      properties: {
        project: { type: "string", description: "Optional: the project's key, such as SHOP." },
        words: { type: "string", description: "Optional: words in the issue's text." },
        status: { type: "string", description: "Optional: a status name, such as To Do, In Progress or Done." },
        mine: { type: "boolean", description: "Only issues assigned to the signed-in person." },
        open_only: { type: "boolean", description: "Leave out issues that are done." },
        limit: { type: "number", description: "How many, at most 100. Usually 25." },
      },
      async run(c, input) {
        const conditions = [
          ...(input.project ? [`project = ${quoted(projectKey(input.project))}`] : []),
          ...(text(input.words, 200) ? [`text ~ ${quoted(input.words)}`] : []),
          ...(text(input.status, 60) ? [`status = ${quoted(input.status, 60)}`] : []),
          ...(input.mine ? ["assignee = currentUser()"] : []),
          ...(input.open_only ? ["statusCategory != Done"] : []),
        ];
        if (!conditions.length) throw new Error("Narrow the search: give a project, words, a status, or ask for your own issues.");
        const r = await search(c, `${conditions.join(" AND ")} ORDER BY updated DESC`, count(input.limit, 25, 100));
        return (r.issues ?? []).map(line).join("\n") || "No issues match.";
      },
    },
    {
      name: "get_issue",
      kind: "read",
      summary: "Read one issue and its comments",
      description: "Returns one issue: its description, its latest comments, and the steps it can be moved to (for move_issue).",
      properties: { issue: { type: "string", description: "The issue's key, such as SHOP-12." } },
      required: ["issue"],
      async run(c, input) {
        const k = key(input.issue);
        const i = await api<any>(c, `/issue/${k}${query({ fields: [...FIELDS, "description", "reporter"].join(",") })}`);
        const talk = await api<{ comments: any[] }>(c, `/issue/${k}/comment${query({ maxResults: 30, orderBy: "-created" })}`);
        const moves = await api<{ transitions: any[] }>(c, `/issue/${k}/transitions`);
        const said = (talk.comments ?? []).reverse().map((m) => `${String(m.created ?? "").slice(0, 16).replace("T", " ")} · ${plain(m.author?.displayName, 80)}\n${words(m.body, 3000)}`);
        return `${line(i)}${i.fields?.reporter?.displayName ? `\nOpened by ${plain(i.fields.reporter.displayName, 80)}` : ""}\nCan be moved to: ${(moves.transitions ?? []).map((t) => plain(t.name, 40)).join(", ") || "nothing"}\n\n${words(i.fields?.description) || "(no description)"}\n\n${said.join("\n\n") || "No comments."}`;
      },
    },
    {
      name: "create_issue",
      kind: "write",
      summary: "Open a new issue",
      description: "Opens an issue in a project with a summary and, optionally, a description, a type (Task when left out) and labels.",
      properties: { project: { type: "string", description: "The project's key." }, summary: { type: "string" }, description: { type: "string", description: "Optional, in plain text." }, type: { type: "string", description: "The issue type's name: Task, Bug, Story. Task when left out." }, labels: { type: "string", description: "Optional: labels separated by commas (no spaces inside a label)." } },
      required: ["project", "summary"],
      async run(c, input) {
        const summary = plain(input.summary, 250);
        if (!summary) throw new Error("Give the issue a summary.");
        const labels = String(input.labels ?? "").split(",").map((l) => l.trim().replace(/\s+/g, "-").slice(0, 60)).filter(Boolean).slice(0, 20);
        const body = text(input.description, 20_000);
        const made = await api<{ key: string }>(c, "/issue", "POST", { fields: { project: { key: projectKey(input.project) }, issuetype: { name: plain(input.type, 40) || "Task" }, summary, ...(body ? { description: doc(body) } : {}), ...(labels.length ? { labels } : {}) } });
        return `Opened ${made.key}: “${summary}”. https://${c.values.site}.atlassian.net/browse/${made.key}`;
      },
    },
    {
      name: "comment_on_issue",
      kind: "write",
      summary: "Add a comment to an issue",
      description: "Adds a comment to an issue. Everyone who can see the issue can read it, and people watching it are notified.",
      properties: { issue: { type: "string" }, comment: { type: "string", description: "The comment, in plain text." } },
      required: ["issue", "comment"],
      async run(c, input) {
        const body = text(input.comment, 20_000);
        if (!body) throw new Error("Write the comment.");
        await api(c, `/issue/${key(input.issue)}/comment`, "POST", { body: doc(body) });
        return `Commented on ${key(input.issue)}.`;
      },
    },
    {
      name: "move_issue",
      kind: "write",
      summary: "Move an issue to another step",
      description: "Moves an issue to another step of its workflow, by the step's name as get_issue lists it (for example In Progress or Done).",
      properties: { issue: { type: "string" }, to: { type: "string", description: "The step's name, from get_issue." } },
      required: ["issue", "to"],
      async run(c, input) {
        const k = key(input.issue);
        const want = plain(input.to, 60).toLowerCase();
        const moves = (await api<{ transitions: any[] }>(c, `/issue/${k}/transitions`)).transitions ?? [];
        const move = moves.find((t) => String(t.name).toLowerCase() === want) ?? moves.find((t) => String(t.to?.name).toLowerCase() === want);
        if (!move) throw new Error(`${k} cannot be moved to “${plain(input.to, 60)}” from where it is. It can be moved to: ${moves.map((t) => plain(t.name, 40)).join(", ") || "nothing"}.`);
        await api(c, `/issue/${k}/transitions`, "POST", { transition: { id: String(move.id) } });
        return `Moved ${k} to ${plain(move.to?.name ?? move.name, 40)}.`;
      },
    },
    {
      name: "update_issue",
      kind: "write",
      summary: "Change an issue's summary or labels, or take it yourself",
      description: "Changes an issue: its summary, labels to add or remove, or assigns it to the signed-in person. Give at least one change.",
      properties: { issue: { type: "string" }, summary: { type: "string" }, add_labels: { type: "string", description: "Labels to add, separated by commas." }, remove_labels: { type: "string", description: "Labels to remove, separated by commas." }, assign_to_me: { type: "boolean" } },
      required: ["issue"],
      async run(c, input) {
        const k = key(input.issue);
        const list = (v: unknown) => String(v ?? "").split(",").map((l) => l.trim().replace(/\s+/g, "-").slice(0, 60)).filter(Boolean).slice(0, 20);
        const summary = plain(input.summary, 250);
        const labelOps = [...list(input.add_labels).map((add) => ({ add })), ...list(input.remove_labels).map((remove) => ({ remove }))];
        if (!summary && !labelOps.length && !input.assign_to_me) throw new Error("Say what to change: the summary, labels, or assign it to yourself.");
        if (summary || labelOps.length) await api(c, `/issue/${k}`, "PUT", { ...(summary ? { fields: { summary } } : {}), ...(labelOps.length ? { update: { labels: labelOps } } : {}) });
        if (input.assign_to_me) await api(c, `/issue/${k}/assignee`, "PUT", { accountId: c.values.account_id });
        return `Updated ${k}${input.assign_to_me ? "; it is now assigned to you" : ""}.`;
      },
    },
  ],
};
