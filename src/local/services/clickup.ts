// ClickUp: tasks. Facts from ClickUp's developer documentation (developer.clickup.com), read November 2026: the
// authentication page (a personal token starts with pk_ and is sent as it is; a browser sign-in's token is sent as
// Bearer and does not run out), the rate limits and common errors pages, and the reference for the authorized user,
// workspaces (called teams in version 2), spaces, folders, lists, tasks and comments. Priority 1 is urgent and 4 is
// low. Signs in through the browser with an app a workspace owner or admin makes (it has a secret), or with a
// personal token. Not confirmed there: that a localhost return address is accepted (the page only warns that
// addresses without https may stop working one day), the proof called PKCE, and the fields of an error answer.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const api = <T = any>(c: Keys, path: string, method = "GET", body?: unknown) =>
  call<T>(`${baseOf("clickup", "https://api.clickup.com/api/v2")}${path}`, { name: "ClickUp", method, headers: { authorization: String(c.values.token).startsWith("pk_") ? c.values.token : `Bearer ${c.values.token}` }, body });

const ref = (v: unknown, what: string) => {
  const t = String(v ?? "").trim().replace(/^#/, "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(t)) throw new Error(`Give the ${what}'s id, the letters and digits in square brackets.`);
  return t;
};
const URGENCY = ["urgent", "high", "normal", "low"];
const urgency = (v: unknown) => {
  const at = URGENCY.indexOf(String(v));
  if (at < 0) throw new Error(`For urgency, choose one of: ${URGENCY.join(", ")}.`);
  return at + 1;
};
const dueMs = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) throw new Error("Give the due day as a date like 2026-11-30.");
  return Date.parse(`${t}T12:00:00Z`);
};
const day = (ms: unknown) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : "");
const text = (v: unknown, most: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, most);
const line = (t: any) => `[${t.id}] ${plain(t.name, 200) || "(no name)"} · ${plain(t.status?.status, 40)}${t.priority?.priority ? ` · ${plain(t.priority.priority, 20)}` : ""}${day(t.due_date) ? ` · due ${day(t.due_date)}` : ""}${t.assignees?.length ? ` · for ${t.assignees.map((a: any) => plain(a.username, 60)).join(", ")}` : ""}${t.list?.name ? ` · in ${plain(t.list.name, 80)}` : ""}`;
/** What a task is given when it is made or changed. */
function fields(input: Record<string, any>): Record<string, unknown> {
  return {
    ...(text(input.description, 20_000) ? { markdown_content: text(input.description, 20_000) } : {}),
    ...(plain(input.status, 60) ? { status: plain(input.status, 60) } : {}),
    ...(input.urgency ? { priority: urgency(input.urgency) } : {}),
    ...(input.due ? { due_date: dueMs(input.due) } : {}),
  };
}

export const clickup: ServiceDef = {
  id: "clickup",
  name: "ClickUp",
  category: "Projects and tasks",
  about: "Read and update your ClickUp tasks: see lists, add tasks, change them and comment.",
  steps: [
    "In ClickUp, click your picture at the top right and open Settings, then Apps.",
    "Under API Token press Generate, then Copy. The token starts with pk_ and acts as you.",
    "Paste it below. You can regenerate it there at any time, which switches the old one off.",
  ],
  docs: "https://developer.clickup.com/docs/authentication",
  fields: [{ key: "token", label: "API token", secret: true, placeholder: "pk_…" }],
  // Browser sign-in with an app the workspace's owner or admin makes. ClickUp's token call needs the app's secret,
  // and its pages do not describe the PKCE proof, so it is left out.
  browser: {
    authUrl: "https://app.clickup.com/api",
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
    scopes: [],
    secret: "required",
    pkce: false,
    tokenKey: "token",
    appSteps: [
      "In ClickUp, a workspace owner or admin clicks their picture, opens Settings › Apps and presses Create new app.",
      "Name it Talqava and add this redirect URL exactly: {redirect}",
      "ClickUp shows the app's Client ID and Client Secret. Paste both below.",
      "Press the button. ClickUp asks which workspaces Talqava may use.",
    ],
  },
  async check(values) {
    const me = (await api<{ user: any }>({ values }, "/user")).user;
    if (!me?.id) throw Object.assign(new Error("ClickUp did not say who signed in. Check the token and try again."), { refused: true });
    const teams = (await api<{ teams: any[] }>({ values }, "/team")).teams ?? [];
    if (!teams.length) throw Object.assign(new Error("ClickUp signed you in, but no workspace was allowed. Sign in again and choose your workspace."), { refused: true });
    return { label: `${plain(me.username, 80) || plain(me.email, 120)} (${teams.map((t) => plain(t.name, 60)).slice(0, 3).join(", ")})`, values: { user_id: String(me.id), team_id: String(teams[0].id) } };
  },
  triggers: [
    {
      name: "new_task",
      summary: "A new task is added to a list",
      param: { label: "List id", placeholder: "from the lists", required: true },
      // Tasks made in the last week, so a long list's older tasks do not crowd out the new ones.
      list: async (c, param) => ((await api<{ tasks: any[] }>(c, `/list/${ref(param, "list")}/task${query({ order_by: "created", date_created_gt: Date.now() - 7 * 86_400_000, include_closed: true })}`)).tasks ?? []).map((t) => String(t.id)),
      async describe(c, id) {
        const t = await api<any>(c, `/task/${ref(id, "task")}`);
        return { title: `Task: ${plain(t.name, 140)}`, text: `${line(t)}${t.text_content ? `\n\n${text(t.text_content, 3000)}` : ""}` };
      },
    },
  ],
  actions: [
    {
      name: "list_lists",
      kind: "read",
      summary: "See your spaces, folders and lists",
      description: "Lists the spaces of the workspace with their folders and lists, and each list's id. Tasks live in lists; use a list's id with list_tasks and add_task.",
      properties: {},
      async run(c) {
        const spaces = ((await api<{ spaces: any[] }>(c, `/team/${ref(c.values.team_id, "workspace")}/space`)).spaces ?? []).slice(0, 12);
        const out: string[] = [];
        for (const s of spaces) {
          out.push(plain(s.name, 100));
          const loose = (await api<{ lists: any[] }>(c, `/space/${ref(s.id, "space")}/list`)).lists ?? [];
          for (const l of loose) out.push(`  [${l.id}] ${plain(l.name, 100)}`);
          const folders = (await api<{ folders: any[] }>(c, `/space/${ref(s.id, "space")}/folder`)).folders ?? [];
          for (const f of folders) {
            out.push(`  ${plain(f.name, 100)}/`);
            for (const l of f.lists ?? []) out.push(`    [${l.id}] ${plain(l.name, 100)}`);
          }
        }
        return out.join("\n") || "No spaces were found.";
      },
    },
    {
      name: "list_tasks",
      kind: "read",
      summary: "See the tasks in a list",
      description: "Lists the open tasks in one list: id, name, status, urgency, due day and who they are for. Set include_closed to see finished ones too.",
      properties: { list: { type: "string", description: "The list's id, from list_lists." }, include_closed: { type: "boolean" }, page: { type: "number", description: "Each page has up to 100 tasks; the first is 0." } },
      required: ["list"],
      async run(c, input) {
        const r = await api<{ tasks: any[]; last_page?: boolean }>(c, `/list/${ref(input.list, "list")}/task${query({ page: count(Number(input.page) + 1, 1, 1000) - 1, include_closed: input.include_closed ? true : "" })}`);
        return `${(r.tasks ?? []).map(line).join("\n") || "No tasks."}${r.last_page === false ? "\n(More on the next page.)" : ""}`;
      },
    },
    {
      name: "my_tasks",
      kind: "read",
      summary: "See the tasks assigned to you",
      description: "Lists the open tasks assigned to the signed-in person across the workspace, most recently changed first.",
      properties: { limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        const r = await api<{ tasks: any[] }>(c, `/team/${ref(c.values.team_id, "workspace")}/task?${new URLSearchParams([["assignees[]", String(c.values.user_id)], ["order_by", "updated"], ["page", "0"]])}`);
        return (r.tasks ?? []).slice(0, count(input.limit, 30, 100)).map(line).join("\n") || "Nothing is assigned to you.";
      },
    },
    {
      name: "get_task",
      kind: "read",
      summary: "Read one task and its comments",
      description: "Returns one task with its description and its latest comments.",
      properties: { task: { type: "string", description: "The task's id." } },
      required: ["task"],
      async run(c, input) {
        const id = ref(input.task, "task");
        const t = await api<any>(c, `/task/${id}`);
        const talk = (await api<{ comments: any[] }>(c, `/task/${id}/comment`)).comments ?? [];
        const said = talk.slice(0, 25).reverse().map((m) => `${day(m.date)} · ${plain(m.user?.username, 80)}\n${text(m.comment_text, 3000)}`);
        return `${line(t)}${t.url ? `\n${plain(t.url, 200)}` : ""}\n\n${text(t.text_content ?? t.description, 6000) || "(no description)"}\n\n${said.join("\n\n") || "No comments."}`;
      },
    },
    {
      name: "add_task",
      kind: "write",
      summary: "Add a task to a list",
      description: "Adds a task to a list, with an optional description (Markdown), status, urgency and due day.",
      properties: { list: { type: "string", description: "The list's id, from list_lists." }, name: { type: "string" }, description: { type: "string" }, status: { type: "string", description: "Optional: one of the list's statuses, such as to do." }, urgency: { type: "string", enum: URGENCY }, due: { type: "string", description: "Optional: a date like 2026-11-30." } },
      required: ["list", "name"],
      async run(c, input) {
        const name = plain(input.name, 500);
        if (!name) throw new Error("Give the task a name.");
        const t = await api<any>(c, `/list/${ref(input.list, "list")}/task`, "POST", { name, ...fields(input) });
        return `Added ${line(t)}`;
      },
    },
    {
      name: "update_task",
      kind: "write",
      summary: "Change a task",
      description: "Changes a task's name, description, status (for example to mark it done), urgency or due day. Only what you give is changed.",
      properties: { task: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string", description: "One of the list's statuses." }, urgency: { type: "string", enum: URGENCY }, due: { type: "string" } },
      required: ["task"],
      async run(c, input) {
        const change = { ...(plain(input.name, 500) ? { name: plain(input.name, 500) } : {}), ...fields(input) };
        if (!Object.keys(change).length) throw new Error("Say what to change: the name, description, status, urgency or due day.");
        const t = await api<any>(c, `/task/${ref(input.task, "task")}`, "PUT", change);
        return t?.id ? `Updated ${line(t)}` : `Updated task ${ref(input.task, "task")}.`;
      },
    },
    {
      name: "comment_on_task",
      kind: "write",
      summary: "Comment on a task",
      description: "Adds a comment to a task. Everyone who can see the task can read it; nobody is notified beyond the task's own followers.",
      properties: { task: { type: "string" }, comment: { type: "string" } },
      required: ["task", "comment"],
      async run(c, input) {
        const comment_text = text(input.comment, 10_000);
        if (!comment_text) throw new Error("Write the comment.");
        await api(c, `/task/${ref(input.task, "task")}/comment`, "POST", { comment_text, notify_all: false });
        return `Commented on task ${ref(input.task, "task")}.`;
      },
    },
  ],
};
