// GitLab: issues and merge requests, on gitlab.com or a company's own GitLab. Facts from GitLab's documentation
// (docs.gitlab.com), read November 2026: api/oauth2 (the authorization code flow with PKCE, which the page says works
// without the application's secret), integration/oauth_provider (making a user-owned application, the scope names),
// api/rest, api/users, api/projects, api/issues, api/merge_requests and api/notes. Not confirmed there: whether a
// port on a localhost redirect address is accepted, and whether the application form shows a Confidential box.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const base = (c: Pick<Connection, "values">) => (process.env.TALQAVA_GITLAB_API || `https://${c.values.host}/api/v4`).replace(/\/+$/, "");
const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${base(c)}${path}`, { name: "GitLab", method, headers: { authorization: `Bearer ${c.values.access_token}` }, body });

/** A project in an address: its number, or its path (group/project) with the slashes encoded, as GitLab asks. */
const project = (v: unknown) => {
  const t = String(v ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (/^\d{1,15}$/.test(t)) return t;
  if (!/^\w[\w.-]*(\/\w[\w.-]*){1,10}$/.test(t) || t.length > 300) throw new Error("Give the project as its path (group/project) or its number, from list_projects.");
  return encodeURIComponent(t);
};
const num = (v: unknown, what: string) => {
  const t = String(v ?? "").replace(/^[#!]/, "");
  if (!/^\d{1,12}$/.test(t)) throw new Error(`Give the ${what}'s number.`);
  return t;
};
const oneOf = (v: unknown, list: string[], what: string) => {
  if (!list.includes(String(v))) throw new Error(`For ${what}, choose one of: ${list.join(", ")}.`);
  return String(v);
};
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);
const labels = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((l) => plain(l, 80).replace(/,/g, " "))
    .filter(Boolean)
    .slice(0, 20)
    .join(",");
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const where = (x: any) => plain(x.references?.full ?? `${x.project_id}${x.source_branch ? "!" : "#"}${x.iid}`, 200);
const issueLine = (i: any) => `${where(i)} · ${plain(i.title, 160)} · ${i.state}${i.labels?.length ? ` · ${i.labels.slice(0, 8).map((l: unknown) => plain(l, 40)).join(", ")}` : ""}${i.assignees?.length ? ` · for ${i.assignees.map((a: any) => plain(a.name, 60)).join(", ")}` : ""} · updated ${day(i.updated_at)}`;
const mrLine = (m: any) => `${where(m)} · ${plain(m.title, 160)} · ${m.state}${m.draft ? " · draft" : ""} · ${plain(m.source_branch, 80)} → ${plain(m.target_branch, 80)} · by ${plain(m.author?.name, 60)} · updated ${day(m.updated_at)}`;
const talk = (notes: any[]) =>
  notes
    .filter((n) => !n.system)
    .map((n) => `${String(n.created_at ?? "").slice(0, 16).replace("T", " ")} · ${plain(n.author?.name, 80)}\n${text(n.body, 3000)}`)
    .join("\n\n");
const SCOPES = ["assigned_to_me", "created_by_me", "all"];

export const gitlab: ServiceDef = {
  id: "gitlab",
  name: "GitLab",
  category: "Code and technical",
  about: "Read and update GitLab issues and merge requests: list, read, open, comment, close and label.",
  steps: [],
  docs: "https://docs.gitlab.com/integration/oauth_provider/",
  fields: [],
  browser: {
    authUrl: "https://{host}/oauth/authorize",
    tokenUrl: "https://{host}/oauth/token",
    scopes: ["api"],
    secret: "optional",
    idLabel: "Application ID",
    renewWithRedirect: true,
    ask: [{ key: "host", label: "Your GitLab address", placeholder: "gitlab.com", help: "gitlab.com, or your company's own GitLab address without https://.", pattern: "[a-z0-9][a-z0-9-]{0,62}(\\.[a-z0-9][a-z0-9-]{0,62}){1,6}" }],
    appSteps: [
      "In GitLab, click your picture, then Edit profile. In the left sidebar open Access › Applications and press Add new application.",
      "Name it Talqava. For Redirect URI paste exactly: {redirect}",
      "If the form shows a Confidential box, untick it: Talqava signs in without the application's secret.",
      "Under Scopes tick api (it covers reading and changing issues and merge requests). Save the application.",
      "Copy the Application ID GitLab shows. Type your GitLab address and paste the ID below, leave the secret empty, and press the button. GitLab asks you to authorize Talqava.",
    ],
  },
  async check(values) {
    const me = await api<{ id: number; name: string; username: string }>({ values }, "/user");
    if (!me?.id) throw Object.assign(new Error("GitLab did not say who signed in. Sign in again."), { refused: true });
    return { label: `${me.name} (@${me.username}, ${values.host})` };
  },
  triggers: [
    {
      name: "new_issue",
      summary: "A new issue is opened in a project",
      param: { label: "Project", placeholder: "group/project", required: true },
      list: async (c, param) => (await api<any[]>(c, `/projects/${project(param)}/issues${query({ scope: "all", order_by: "created_at", sort: "desc", per_page: 25 })}`)).map((i) => String(i.iid)),
      async describe(c, id, param) {
        const i = await api<any>(c, `/projects/${project(param)}/issues/${num(id, "issue")}`);
        return { title: `Issue: ${plain(i.title, 140)}`, text: `${issueLine(i)}\nOpened by ${plain(i.author?.name, 80)}\n${plain(i.web_url, 300)}\n\n${text(i.description, 4000)}` };
      },
    },
  ],
  actions: [
    {
      name: "list_projects",
      kind: "read",
      summary: "See the projects you are a member of",
      description: "Lists the projects the signed-in person is a member of, most recently active first: path (group/project), number and description. Use the path with the other tools.",
      properties: { search: { type: "string", description: "Optional: words in the project's name." }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        const list = await api<any[]>(c, `/projects${query({ membership: true, simple: true, order_by: "last_activity_at", sort: "desc", search: plain(input.search, 100), per_page: count(input.limit, 30, 100) })}`);
        return list.map((p) => `${plain(p.path_with_namespace, 200)} [${p.id}]${p.description ? ` · ${plain(p.description, 140)}` : ""}`).join("\n") || "No projects were found.";
      },
    },
    {
      name: "list_issues",
      kind: "read",
      summary: "See issues, in one project or across all",
      description: "Lists issues, most recently updated first. With a project, every issue in it; without one, those assigned to the signed-in person (or created by them: set whose). Filter by state, words and labels.",
      properties: {
        project: { type: "string", description: "Optional: the project's path (group/project) or number." },
        whose: { type: "string", enum: SCOPES, description: "Without a project: assigned_to_me (the usual), created_by_me, or all." },
        state: { type: "string", enum: ["opened", "closed", "all"], description: "Usually opened." },
        words: { type: "string", description: "Optional: words in the title or description." },
        labels: { type: "string", description: "Optional: labels the issue must have, separated by commas." },
        limit: { type: "number", description: "How many, at most 100. Usually 25." },
      },
      async run(c, input) {
        const q = query({ scope: input.project ? "all" : oneOf(input.whose ?? "assigned_to_me", SCOPES, "whose"), state: oneOf(input.state ?? "opened", ["opened", "closed", "all"], "state"), search: plain(input.words, 200), labels: labels(input.labels), order_by: "updated_at", sort: "desc", per_page: count(input.limit, 25, 100) });
        const list = await api<any[]>(c, `${input.project ? `/projects/${project(input.project)}` : ""}/issues${q}`);
        return list.map(issueLine).join("\n") || "No issues match.";
      },
    },
    {
      name: "get_issue",
      kind: "read",
      summary: "Read one issue and its comments",
      description: "Returns one issue: its description and its comments in order, with who wrote each.",
      properties: { project: { type: "string", description: "The project's path (group/project) or number." }, issue: { type: "string", description: "The issue's number in that project." } },
      required: ["project", "issue"],
      async run(c, input) {
        const at = `/projects/${project(input.project)}/issues/${num(input.issue, "issue")}`;
        const i = await api<any>(c, at);
        const notes = await api<any[]>(c, `${at}/notes${query({ order_by: "created_at", sort: "asc", per_page: 50 })}`);
        return `${issueLine(i)}\nOpened by ${plain(i.author?.name, 80)} on ${day(i.created_at)}\n${plain(i.web_url, 300)}\n\n${text(i.description, 6000) || "(no description)"}\n\n${talk(notes) || "No comments."}`;
      },
    },
    {
      name: "create_issue",
      kind: "write",
      summary: "Open a new issue",
      description: "Opens a new issue in a project with a title and, optionally, a description (Markdown) and labels. Everyone who can see the project can see it.",
      properties: { project: { type: "string" }, title: { type: "string" }, description: { type: "string", description: "Optional, in Markdown." }, labels: { type: "string", description: "Optional: labels, separated by commas." } },
      required: ["project", "title"],
      async run(c, input) {
        const title = plain(input.title, 250);
        if (!title) throw new Error("Give the issue a title.");
        const i = await api<any>(c, `/projects/${project(input.project)}/issues`, "POST", { title, ...(input.description ? { description: text(input.description, 20_000) } : {}), ...(labels(input.labels) ? { labels: labels(input.labels) } : {}) });
        return `Opened ${where(i)}: “${plain(i.title, 160)}”. ${plain(i.web_url, 300)}`;
      },
    },
    {
      name: "comment_on_issue",
      kind: "write",
      summary: "Add a comment to an issue",
      description: "Adds a comment to an issue. Everyone who can see the issue can read it, and people following it are notified.",
      properties: { project: { type: "string" }, issue: { type: "string" }, comment: { type: "string", description: "The comment, in Markdown." } },
      required: ["project", "issue", "comment"],
      async run(c, input) {
        const body = text(input.comment, 20_000);
        if (!body) throw new Error("Write the comment.");
        await api(c, `/projects/${project(input.project)}/issues/${num(input.issue, "issue")}/notes`, "POST", { body });
        return `Commented on issue ${num(input.issue, "issue")} in ${plain(input.project, 200)}.`;
      },
    },
    {
      name: "update_issue",
      kind: "write",
      summary: "Close, reopen, retitle or label an issue",
      description: "Changes an issue: close or reopen it, change its title, add labels or remove labels. Give at least one change.",
      properties: { project: { type: "string" }, issue: { type: "string" }, state: { type: "string", enum: ["close", "reopen"] }, title: { type: "string" }, add_labels: { type: "string", description: "Labels to add, separated by commas." }, remove_labels: { type: "string", description: "Labels to remove, separated by commas." } },
      required: ["project", "issue"],
      async run(c, input) {
        const change = { ...(input.state ? { state_event: oneOf(input.state, ["close", "reopen"], "state") } : {}), ...(plain(input.title, 250) ? { title: plain(input.title, 250) } : {}), ...(labels(input.add_labels) ? { add_labels: labels(input.add_labels) } : {}), ...(labels(input.remove_labels) ? { remove_labels: labels(input.remove_labels) } : {}) };
        if (!Object.keys(change).length) throw new Error("Say what to change: the state, the title, or labels to add or remove.");
        const i = await api<any>(c, `/projects/${project(input.project)}/issues/${num(input.issue, "issue")}`, "PUT", change);
        return `Updated ${issueLine(i)}`;
      },
    },
    {
      name: "list_merge_requests",
      kind: "read",
      summary: "See merge requests, in one project or across all",
      description: "Lists merge requests, most recently updated first. With a project, every one in it; without one, those assigned to the signed-in person (set whose for created_by_me or all).",
      properties: { project: { type: "string", description: "Optional: the project's path (group/project) or number." }, whose: { type: "string", enum: SCOPES }, state: { type: "string", enum: ["opened", "closed", "merged", "all"], description: "Usually opened." }, limit: { type: "number", description: "How many, at most 100. Usually 25." } },
      async run(c, input) {
        const q = query({ scope: input.project ? "all" : oneOf(input.whose ?? "assigned_to_me", SCOPES, "whose"), state: oneOf(input.state ?? "opened", ["opened", "closed", "merged", "all"], "state"), order_by: "updated_at", sort: "desc", per_page: count(input.limit, 25, 100) });
        const list = await api<any[]>(c, `${input.project ? `/projects/${project(input.project)}` : ""}/merge_requests${q}`);
        return list.map(mrLine).join("\n") || "No merge requests match.";
      },
    },
    {
      name: "get_merge_request",
      kind: "read",
      summary: "Read one merge request and its comments",
      description: "Returns one merge request: its description, whether it can be merged, and its comments in order. It does not return the code changes.",
      properties: { project: { type: "string" }, merge_request: { type: "string", description: "The merge request's number in that project." } },
      required: ["project", "merge_request"],
      async run(c, input) {
        const at = `/projects/${project(input.project)}/merge_requests/${num(input.merge_request, "merge request")}`;
        const m = await api<any>(c, at);
        const notes = await api<any[]>(c, `${at}/notes${query({ order_by: "created_at", sort: "asc", per_page: 50 })}`);
        return `${mrLine(m)}${m.detailed_merge_status ? `\nMerge status: ${plain(m.detailed_merge_status, 60)}` : ""}${m.reviewers?.length ? `\nReviewers: ${m.reviewers.map((r: any) => plain(r.name, 60)).join(", ")}` : ""}\n${plain(m.web_url, 300)}\n\n${text(m.description, 6000) || "(no description)"}\n\n${talk(notes) || "No comments."}`;
      },
    },
    {
      name: "comment_on_merge_request",
      kind: "write",
      summary: "Add a comment to a merge request",
      description: "Adds a comment to a merge request. Everyone who can see it can read it, and people following it are notified.",
      properties: { project: { type: "string" }, merge_request: { type: "string" }, comment: { type: "string", description: "The comment, in Markdown." } },
      required: ["project", "merge_request", "comment"],
      async run(c, input) {
        const body = text(input.comment, 20_000);
        if (!body) throw new Error("Write the comment.");
        await api(c, `/projects/${project(input.project)}/merge_requests/${num(input.merge_request, "merge request")}/notes`, "POST", { body });
        return `Commented on merge request ${num(input.merge_request, "merge request")} in ${plain(input.project, 200)}.`;
      },
    },
  ],
};
