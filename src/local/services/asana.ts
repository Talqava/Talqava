// Asana: tasks and projects. Facts from Asana's developer documentation, read November 2026:
// developers.asana.com/docs/personal-access-token, /docs/pagination, /reference/getuser, getworkspaces, getprojects,
// gettasksforproject, gettasks, createtask, updatetask, createstoryfortask. Task search is left out: Asana offers it
// on paid plans only.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", data?: unknown) =>
  call<{ data: T }>(`${baseOf("asana", "https://app.asana.com/api/1.0")}${path}`, { name: "Asana", method, headers: { authorization: `Bearer ${c.values.token}` }, body: data === undefined ? undefined : { data } }).then((r) => r.data);
const FIELDS = "name,completed,due_on,assignee.name,permalink_url,modified_at";
const line = (t: any) => `[${t.gid}] ${t.completed ? "✓ " : ""}${t.name || "(no name)"}${t.due_on ? ` · due ${t.due_on}` : ""}${t.assignee?.name ? ` · ${t.assignee.name}` : ""}`;

export const asana: ServiceDef = {
  id: "asana",
  name: "Asana",
  category: "Projects and tasks",
  about: "Read and update the tasks and projects in your Asana workspace.",
  steps: ["In Asana, open the developer console at app.asana.com/0/my-apps.", "Create a personal access token and give it the description Talqava.", "Copy the token and paste it below. It acts as you, with your permissions; you can remove it there at any time."],
  docs: "https://developers.asana.com/docs/personal-access-token",
  fields: [{ key: "token", label: "Personal access token", secret: true }],
  async check(values) {
    const me = await api<{ name: string; email: string }>({ values }, "/users/me");
    return { label: me.email ? `${me.name} (${me.email})` : me.name };
  },
  actions: [
    {
      name: "list_projects",
      kind: "read",
      summary: "See workspaces and their projects",
      description: "Lists the workspaces, or the projects of one workspace. Call it without a workspace first to get the workspace numbers.",
      properties: { workspace: { type: "string", description: "A workspace's number, to list its projects. Left out, the workspaces are listed." } },
      async run(c, input) {
        if (!input.workspace) return (await api<any[]>(c, "/workspaces")).map((w) => `[${w.gid}] ${w.name}`).join("\n") || "No workspaces.";
        return (await api<any[]>(c, `/projects${query({ workspace: input.workspace, archived: false, limit: 100 })}`)).map((p) => `[${p.gid}] ${p.name}`).join("\n") || "No projects in that workspace.";
      },
    },
    {
      name: "list_tasks",
      kind: "read",
      summary: "See the tasks in a project, or the tasks assigned to you",
      description: "Lists open tasks: those of a project (give project), or those assigned to the owner in a workspace (give workspace). Set include_done to also see finished ones.",
      properties: { project: { type: "string", description: "A project's number." }, workspace: { type: "string", description: "A workspace's number, for the owner's own tasks." }, include_done: { type: "boolean" }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        if (!input.project && !input.workspace) throw new Error("Give a project, or a workspace for the owner's own tasks.");
        const common = { opt_fields: FIELDS, limit: count(input.limit, 30, 100), ...(input.include_done ? {} : { completed_since: "now" }) };
        const tasks = input.project ? await api<any[]>(c, `/projects/${encodeURIComponent(input.project)}/tasks${query(common)}`) : await api<any[]>(c, `/tasks${query({ assignee: "me", workspace: input.workspace, ...common })}`);
        return tasks.map(line).join("\n") || "No tasks.";
      },
    },
    {
      name: "get_task",
      kind: "read",
      summary: "Read one task in full",
      description: "Returns one task: its name, notes, due date, who has it and its link.",
      properties: { task: { type: "string", description: "The task's number, from list_tasks." } },
      required: ["task"],
      async run(c, input) {
        const t = await api<any>(c, `/tasks/${encodeURIComponent(input.task)}${query({ opt_fields: `${FIELDS},notes,projects.name` })}`);
        return `${line(t)}\n${t.permalink_url ?? ""}\nProjects: ${(t.projects ?? []).map((p: any) => p.name).join(", ") || "none"}\n\n${plain(t.notes, 8000) || "(no notes)"}`;
      },
    },
    {
      name: "create_task",
      kind: "write",
      summary: "Add a task",
      description: "Adds a task to a project (give project) or to a workspace (give workspace). Give a clear name; put detail in notes.",
      properties: { name: { type: "string" }, notes: { type: "string" }, project: { type: "string", description: "The project's number." }, workspace: { type: "string", description: "The workspace's number, when no project is given." }, due_on: { type: "string", description: "A date like 2026-12-01." }, assign_to_owner: { type: "boolean", description: "Assign it to the owner." } },
      required: ["name"],
      async run(c, input) {
        if (!input.project && !input.workspace) throw new Error("Give the project or the workspace to add it to.");
        const t = await api<any>(c, "/tasks", "POST", { name: String(input.name).slice(0, 300), ...(input.notes ? { notes: String(input.notes).slice(0, 20_000) } : {}), ...(input.project ? { projects: [String(input.project)] } : { workspace: String(input.workspace) }), ...(input.due_on ? { due_on: String(input.due_on) } : {}), ...(input.assign_to_owner ? { assignee: "me" } : {}) });
        return `Added the task “${t.name}” (${t.gid}). ${t.permalink_url ?? ""}`.trim();
      },
    },
    {
      name: "update_task",
      kind: "write",
      summary: "Change a task or mark it done",
      description: "Changes a task: its name, notes, due date, or whether it is done. Give only what changes.",
      properties: { task: { type: "string" }, name: { type: "string" }, notes: { type: "string", description: "The whole new notes text; it replaces the old." }, due_on: { type: "string", description: "A date like 2026-12-01." }, completed: { type: "boolean" } },
      required: ["task"],
      async run(c, input) {
        const change = { ...(input.name ? { name: String(input.name).slice(0, 300) } : {}), ...(input.notes !== undefined ? { notes: String(input.notes).slice(0, 20_000) } : {}), ...(input.due_on ? { due_on: String(input.due_on) } : {}), ...(typeof input.completed === "boolean" ? { completed: input.completed } : {}) };
        if (!Object.keys(change).length) throw new Error("Say what to change.");
        const t = await api<any>(c, `/tasks/${encodeURIComponent(input.task)}`, "PUT", change);
        return `Updated “${t.name}” (${t.gid})${t.completed ? ", now done" : ""}.`;
      },
    },
    {
      name: "add_comment",
      kind: "write",
      summary: "Comment on a task",
      description: "Adds a comment to a task, seen by everyone following it.",
      properties: { task: { type: "string" }, text: { type: "string" } },
      required: ["task", "text"],
      async run(c, input) {
        await api(c, `/tasks/${encodeURIComponent(input.task)}/stories`, "POST", { text: String(input.text).slice(0, 10_000) });
        return `Commented on task ${input.task}.`;
      },
    },
  ],
};
