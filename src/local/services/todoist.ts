// Todoist: to-dos. Facts from Todoist's developer documentation (developer.todoist.com/api/v1 and its OpenAPI
// file) and its help page on finding the API token, read November 2026: the current API is version 1 at
// api.todoist.com/api/v1, lists answer {results, next_cursor}, a task is changed with POST, and ids are short
// strings of letters and digits. Signs in through the browser with an app made in Todoist's App Management Console
// (which has a secret), or with the personal API token. Not confirmed there: that a console app may use a localhost
// return address, and the numbers for a task's priority (two passages disagree; the task object's own wording, where
// 4 is the most urgent, is followed here).
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${baseOf("todoist", "https://api.todoist.com/api/v1")}${path}`, { name: "Todoist", method, headers: { authorization: `Bearer ${c.values.token}` }, body });
const ref = (v: unknown, what: string) => {
  const t = String(v ?? "").trim();
  if (!/^[A-Za-z0-9]{1,40}$/.test(t)) throw new Error(`Give the ${what}'s id, the letters and digits in square brackets.`);
  return t;
};
const URGENCY = ["normal", "medium", "high", "urgent"];
const urgency = (v: unknown) => {
  const at = URGENCY.indexOf(String(v));
  if (at < 0) throw new Error(`For urgency, choose one of: ${URGENCY.join(", ")}.`);
  return at + 1;
};
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);
const labels = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((l) => plain(l, 60)).filter(Boolean).slice(0, 20);
const line = (t: any) => `[${t.id}] ${t.checked ? "✓ " : ""}${plain(t.content, 200) || "(no name)"}${t.due?.date ? ` · due ${String(t.due.date).slice(0, 16).replace("T", " ")}${t.due.is_recurring ? " (repeats)" : ""}` : ""}${Number(t.priority) > 1 ? ` · ${URGENCY[Number(t.priority) - 1] ?? ""}` : ""}${t.labels?.length ? ` · ${t.labels.slice(0, 6).map((l: unknown) => plain(l, 30)).join(", ")}` : ""}`;
/** What a task is given when it is made or changed. */
function fields(input: Record<string, any>): Record<string, unknown> {
  const due = text(input.due, 100);
  return {
    ...(text(input.description, 8000) ? { description: text(input.description, 8000) } : {}),
    ...(due ? (/^\d{4}-\d{2}-\d{2}$/.test(due) ? { due_date: due } : { due_string: due }) : {}),
    ...(input.urgency ? { priority: urgency(input.urgency) } : {}),
    ...(input.labels !== undefined && labels(input.labels).length ? { labels: labels(input.labels) } : {}),
  };
}

export const todoist: ServiceDef = {
  id: "todoist",
  name: "Todoist",
  category: "Projects and tasks",
  about: "Read your Todoist to-dos, add new ones, change them, comment and tick them off.",
  steps: [
    "In Todoist, click your picture and open Settings › Integrations › Developer (app.todoist.com/app/settings/integrations).",
    "Press Copy API token and paste it below. It acts as you; you can replace it on the same page at any time.",
  ],
  docs: "https://www.todoist.com/help/articles/find-your-api-token-Jpzx9IIlB",
  fields: [{ key: "token", label: "API token", secret: true }],
  // Browser sign-in with the owner's own app. Todoist asks for the app's secret when the code is exchanged, and its
  // pages describe the PKCE proof only for another kind of app, so it is left out.
  browser: {
    authUrl: "https://app.todoist.com/oauth/authorize",
    tokenUrl: "https://api.todoist.com/oauth/access_token",
    scopes: ["data:read_write"],
    scopeSeparator: ",",
    secret: "required",
    pkce: false,
    tokenKey: "token",
    appSteps: [
      "Open Todoist's App Management Console at app.todoist.com/app/settings/integrations/app-management and create a new app. Name it Talqava.",
      "Under OAuth redirect URL add exactly: {redirect}",
      "Save. Copy the app's Client ID and Client secret and paste them below.",
      "Press the button. Todoist asks you to let Talqava read and change your to-dos.",
    ],
  },
  async check(values) {
    const me = await api<{ id: string; full_name: string; email: string }>({ values }, "/user");
    if (!me?.id) throw Object.assign(new Error("Todoist did not say who signed in. Check the token and try again."), { refused: true });
    return { label: `${plain(me.full_name, 80) || "Your account"}${me.email ? ` (${plain(me.email, 120)})` : ""}` };
  },
  triggers: [
    {
      name: "new_task",
      summary: "A new to-do is added to a project",
      param: { label: "Project id", placeholder: "from the list of projects", required: true },
      list: async (c, param) => ((await api<{ results: any[] }>(c, `/tasks${query({ project_id: ref(param, "project"), limit: 200 })}`)).results ?? []).map((t) => String(t.id)),
      async describe(c, id) {
        const t = await api<any>(c, `/tasks/${ref(id, "to-do")}`);
        return { title: `To-do: ${plain(t.content, 140)}`, text: `${line(t)}${t.description ? `\n\n${text(t.description, 3000)}` : ""}` };
      },
    },
  ],
  actions: [
    {
      name: "list_projects",
      kind: "read",
      summary: "See your projects",
      description: "Lists your Todoist projects with their ids. The Inbox is one of them.",
      properties: {},
      async run(c) {
        const r = await api<{ results: any[] }>(c, `/projects${query({ limit: 200 })}`);
        return (r.results ?? []).map((p) => `[${p.id}] ${plain(p.name, 120)}${p.inbox_project ? " (Inbox)" : ""}${p.is_archived ? " (archived)" : ""}`).join("\n") || "No projects were found.";
      },
    },
    {
      name: "list_tasks",
      kind: "read",
      summary: "See open to-dos",
      description: "Lists open to-dos. Give a project's id or a label to narrow it, or a Todoist filter in Todoist's own words, such as: today | overdue. Without any of them, every open to-do (the first 100).",
      properties: { project: { type: "string", description: "Optional: a project's id, from list_projects." }, label: { type: "string", description: "Optional: a label's name." }, filter: { type: "string", description: "Optional: a Todoist filter, such as today | overdue, or p1 & 7 days." }, limit: { type: "number", description: "How many, at most 200. Usually 100." } },
      async run(c, input) {
        const limit = count(input.limit, 100, 200);
        const filter = text(input.filter, 1000);
        const r = filter ? await api<{ results: any[] }>(c, `/tasks/filter${query({ query: filter, limit })}`) : await api<{ results: any[] }>(c, `/tasks${query({ project_id: input.project ? ref(input.project, "project") : "", label: plain(input.label, 60), limit })}`);
        return (r.results ?? []).map(line).join("\n") || "No open to-dos match.";
      },
    },
    {
      name: "get_task",
      kind: "read",
      summary: "Read one to-do",
      description: "Returns one to-do with its description.",
      properties: { task: { type: "string", description: "The to-do's id." } },
      required: ["task"],
      async run(c, input) {
        const t = await api<any>(c, `/tasks/${ref(input.task, "to-do")}`);
        return `${line(t)}\nProject ${plain(t.project_id, 40)} · added ${String(t.added_at ?? "").slice(0, 10)}\n\n${text(t.description, 6000) || "(no description)"}`;
      },
    },
    {
      name: "add_task",
      kind: "write",
      summary: "Add a to-do",
      description: "Adds a to-do. Without a project it goes to the Inbox. The due day can be a date (2026-11-30) or Todoist's own words (tomorrow at 9, every Monday).",
      properties: { name: { type: "string", description: "What is to be done." }, description: { type: "string" }, project: { type: "string", description: "Optional: a project's id." }, due: { type: "string", description: "Optional: 2026-11-30, or words such as tomorrow at 9." }, urgency: { type: "string", enum: URGENCY }, labels: { type: "string", description: "Optional: label names, separated by commas." } },
      required: ["name"],
      async run(c, input) {
        const content = plain(input.name, 500);
        if (!content) throw new Error("Say what is to be done.");
        const t = await api<any>(c, "/tasks", "POST", { content, ...(input.project ? { project_id: ref(input.project, "project") } : {}), ...fields(input) });
        return `Added ${line(t)}`;
      },
    },
    {
      name: "update_task",
      kind: "write",
      summary: "Change a to-do",
      description: "Changes a to-do's name, description, due day, urgency or labels. Only what you give is changed. It cannot move a to-do to another project.",
      properties: { task: { type: "string" }, name: { type: "string" }, description: { type: "string" }, due: { type: "string" }, urgency: { type: "string", enum: URGENCY }, labels: { type: "string" } },
      required: ["task"],
      async run(c, input) {
        const change = { ...(plain(input.name, 500) ? { content: plain(input.name, 500) } : {}), ...fields(input) };
        if (!Object.keys(change).length) throw new Error("Say what to change: the name, description, due day, urgency or labels.");
        const t = await api<any>(c, `/tasks/${ref(input.task, "to-do")}`, "POST", change);
        return `Updated ${line(t)}`;
      },
    },
    {
      name: "complete_task",
      kind: "write",
      summary: "Tick a to-do off",
      description: "Marks a to-do as done. One that repeats moves to its next day instead.",
      properties: { task: { type: "string" } },
      required: ["task"],
      async run(c, input) {
        await api(c, `/tasks/${ref(input.task, "to-do")}/close`, "POST");
        return `Ticked off to-do ${ref(input.task, "to-do")}.`;
      },
    },
    {
      name: "reopen_task",
      kind: "write",
      summary: "Open a ticked-off to-do again",
      description: "Marks a done to-do as open again.",
      properties: { task: { type: "string" } },
      required: ["task"],
      async run(c, input) {
        await api(c, `/tasks/${ref(input.task, "to-do")}/reopen`, "POST");
        return `Opened to-do ${ref(input.task, "to-do")} again.`;
      },
    },
    {
      name: "comment_on_task",
      kind: "write",
      summary: "Comment on a to-do",
      description: "Adds a comment to a to-do. On a shared project, the people it is shared with see it.",
      properties: { task: { type: "string" }, comment: { type: "string" } },
      required: ["task", "comment"],
      async run(c, input) {
        const content = text(input.comment, 15_000);
        if (!content) throw new Error("Write the comment.");
        await api(c, "/comments", "POST", { task_id: ref(input.task, "to-do"), content });
        return `Commented on to-do ${ref(input.task, "to-do")}.`;
      },
    },
    {
      name: "delete_task",
      kind: "destructive",
      summary: "Delete a to-do",
      description: "Deletes a to-do for good. Prefer complete_task; delete only what was added by mistake.",
      properties: { task: { type: "string" } },
      required: ["task"],
      async run(c, input) {
        await api(c, `/tasks/${ref(input.task, "to-do")}`, "DELETE");
        return `Deleted to-do ${ref(input.task, "to-do")}.`;
      },
    },
  ],
};
