// Organizations. An organization puts bots into roles: each member has a title,
// a department and a manager, which makes an org chart with the person at the
// top. Work follows the chart: a manager may hand tasks to its direct reports,
// and their reports come back up to it (see assign_task in tools.ts).
// A bot's own file says what it can do; the organization says where it sits.
import path from "node:path";
import type { Bot } from "../core/index.ts";
import { DATA, newId, readJson, writeJson } from "./store.ts";
import { loadCrew } from "./crew.ts";
import { ASSIGN_RULES, DEFAULT_INDUSTRY, DEFAULT_STRUCTURE, INDUSTRIES, REQUEST_RULES, STRUCTURES, industryOf, isAssignRule, structureOf } from "./structures.ts";
import type { AssignRule, RequestRule } from "./structures.ts";

export interface Member {
  /** The bot's id (its file name). */
  bot: string;
  /** Its job title here, e.g. "Head of Research". */
  title: string;
  department: string;
  /** The bot it reports to, or null when it reports straight to the person. */
  manager: string | null;
  /** A second lead (a project lead, the dotted line of a matrix) who may also hand it tasks. */
  also?: string | null;
  /** Seated by copying an example, rather than added by the person one at a time. Kept for history; nothing removes it for that. */
  placed?: boolean;
  /** What this position is responsible for, in the owner's words. Every agent in it is told. */
  responsibilities?: string;
}

/**
 * A group: a team or department. Positions belong to one group (by its name, in `department`); the group has a
 * lead, who receives the group's work and the requests other groups send it, and may have a goal and a budget.
 */
export interface Group {
  id: string;
  name: string;
  /** The position (an agent's id) that leads the group, or null when nobody does yet. */
  lead: string | null;
  /** True when the owner chose the lead. A lead the app picked is picked again as the group changes. */
  leadChosen?: boolean;
  goal?: string;
  /** Dollars a month the group's positions may spend together. None means no limit of its own. */
  budget?: number | null;
  /** The model its positions use ("provider/model"), unless an agent has one of its own. None means the team's model. */
  model?: string | null;
}

/** The version of the organization model: 2 is positions, groups and the lines the owner draws. */
export const ORG_MODEL = 2;

export interface Org {
  id: string;
  name: string;
  /** What the organization is for, in a sentence. Every member is told it. */
  mission: string;
  /** How the organization is run (see structures.ts). */
  structure: string;
  /** For "Your own structure": the philosophy the person wrote, and who may hand work to whom. */
  philosophy?: string;
  assign?: AssignRule;
  /** The kind of business, which decides what a chart is staffed with (see INDUSTRIES). */
  industry: string;
  /** Spending or commitments above this many dollars need the person's approval. None means every one does. */
  approvalLimit?: number | null;
  members: Member[];
  /** Teams and departments, each with a lead. Every department a member names has one. */
  groups: Group[];
  /** Which version of the model this organization is stored in (see ORG_MODEL). */
  model?: number;
  createdAt: string;
}

interface OrgFile {
  active: string;
  orgs: Org[];
}

const file = () => path.join(DATA, "orgs.json");
const clean = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const titleFor = (bot: Bot) => bot.title;

/** Whether a member heads its group: nobody in the same group is above it. */
const headsWithin = (members: Member[], m: Member) => !m.manager || members.find((x) => x.bot === m.manager)?.department !== m.department;

/**
 * Makes sure every department a member names is a group, with a lead: the member who heads it (the one with most
 * reports when several do). Existing groups keep their lead while it is still in the group.
 */
function withGroups(org: Org): Org {
  const groups = [...(org.groups ?? [])];
  // The head with most reports leads; among heads with none, a role marked as a lead in its file.
  const marked = new Set(loadCrew().bots.filter((b) => b.lead).map((b) => b.id));
  const pick = (name: string): string | null => {
    const inIt = org.members.filter((m) => m.department === name);
    const reports = (bot: string) => org.members.filter((x) => x.manager === bot).length;
    const heads = inIt.filter((m) => headsWithin(org.members, m)).sort((a, b) => reports(b.bot) - reports(a.bot) || Number(marked.has(b.bot)) - Number(marked.has(a.bot)));
    const sure = heads.length === 1 || inIt.length === 1 || reports(heads[0]?.bot ?? "") > 0 || (marked.has(heads[0]?.bot ?? "") && !marked.has(heads[1]?.bot ?? ""));
    return sure ? (heads[0]?.bot ?? null) : null;
  };
  for (const name of new Set(org.members.map((m) => m.department).filter(Boolean))) {
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) continue;
    groups.push({ id: newId(), name, lead: pick(name) });
  }
  for (const g of groups) if (!g.leadChosen) g.lead = pick(g.name);
  const here = new Set(org.members.map((m) => m.bot));
  return { ...org, groups: groups.map((g) => ({ ...g, lead: g.lead && here.has(g.lead) && org.members.find((m) => m.bot === g.lead)?.department === g.name ? g.lead : null })) };
}

function read(): OrgFile {
  const data = readJson<OrgFile | null>(file(), null);
  if (data?.orgs?.length) {
    // An organization stored before groups existed is converted once: its departments become groups, led by their heads.
    if (data.orgs.some((o) => o.model !== ORG_MODEL)) {
      data.orgs = data.orgs.map((o) => (o.model === ORG_MODEL ? o : { ...withGroups(o), model: ORG_MODEL }));
      writeJson(file(), data);
    }
    return data;
  }
  // The first organization starts with only the owner: positions are added by the owner, one at a time.
  const first: Org = {
    id: newId(),
    name: "My organization",
    mission: "",
    structure: "flat",
    industry: DEFAULT_INDUSTRY,
    members: [],
    groups: [],
    model: ORG_MODEL,
    createdAt: new Date().toISOString(),
  };
  const made = { active: first.id, orgs: [withGroups(first)] };
  writeJson(file(), made);
  return made;
}

const save = (data: OrgFile) => writeJson(file(), data);
/** A monthly budget in dollars from what the person typed; empty means none. */
function budgetOf(value: unknown): { budget?: number | null } {
  if (value === undefined) return {};
  if (value === null || value === "") return { budget: null };
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new Error("A budget is dollars a month, from 0 to 100000.");
  return { budget: amount };
}

function find(data: OrgFile, id: string): Org {
  const org = data.orgs.find((o) => o.id === id);
  if (!org) throw new Error("No such organization.");
  return org;
}

/** Titles and departments the standard agents had in earlier versions. A member still carrying one is shown with the agent's current role. */
const RETIRED_TITLES = new Set(["scout", "scribe", "maker", "keeper", "counter", "spark", "research analyst", "communications manager", "software engineer", "operations manager", "knowledge manager", "business analyst", "data analyst", "strategy advisor"]);
const RETIRED_DEPARTMENTS = new Set(["writing", "money", "ideas", "communications", "strategy", "engineering", "finance", "operations", "research"]);

/** Members whose bot still exists; a manager that is gone is replaced by the person. */
function tidy(org: Org): Org {
  const crew = new Map(loadCrew().bots.map((b) => [b.id, b]));
  const bots = new Set(crew.keys());
  const members = org.members
    .filter((m) => bots.has(m.bot))
    .map((m) => {
      const bot = crew.get(m.bot)!;
      // Only a standard agent's old default is replaced; a title the person wrote is theirs.
      if (bot.source !== "starter" || !RETIRED_TITLES.has(m.title.toLowerCase()) || m.title === bot.title) return m;
      return { ...m, title: bot.title, department: RETIRED_DEPARTMENTS.has(m.department.toLowerCase()) ? bot.group : m.department };
    });
  const here = new Set(members.map((m) => m.bot));
  return withGroups({
    ...org,
    structure: structureOf(org.structure ?? "flat").id,
    industry: industryOf(org.industry).id,
    members: members.map((m) => ({ ...m, manager: m.manager && here.has(m.manager) ? m.manager : null, also: m.also && here.has(m.also) && m.also !== m.manager ? m.also : null })),
  });
}

export const orgs = {
  list(): { active: string; orgs: Org[] } {
    const data = read();
    return { active: data.active, orgs: data.orgs.map(tidy) };
  },

  active(): Org {
    const data = read();
    return tidy(data.orgs.find((o) => o.id === data.active) ?? data.orgs[0]);
  },

  setActive(id: string) {
    const data = read();
    find(data, id);
    data.active = id;
    save(data);
  },

  create(name: unknown, mission: unknown = "", structure: unknown = DEFAULT_STRUCTURE): Org {
    const data = read();
    const named = clean(name, 50);
    if (!named) throw new Error("An organization needs a name.");
    if (data.orgs.some((o) => o.name.toLowerCase() === named.toLowerCase())) throw new Error(`There is already an organization called "${named}".`);
    const org: Org = { id: newId(), name: named, mission: clean(mission, 300), structure: structureOf(String(structure ?? "")).id, industry: DEFAULT_INDUSTRY, members: [], groups: [], model: ORG_MODEL, createdAt: new Date().toISOString() };
    data.orgs.push(org);
    data.active = org.id;
    save(data);
    return org;
  },

  update(id: string, patch: { name?: unknown; mission?: unknown; structure?: unknown; philosophy?: unknown; assign?: unknown; industry?: unknown; approvalLimit?: unknown }): Org {
    const data = read();
    const org = find(data, id);
    if (patch.name !== undefined) {
      const named = clean(patch.name, 50);
      if (!named) throw new Error("An organization needs a name.");
      if (data.orgs.some((o) => o.id !== id && o.name.toLowerCase() === named.toLowerCase())) throw new Error(`There is already an organization called "${named}".`);
      org.name = named;
    }
    if (patch.mission !== undefined) org.mission = clean(patch.mission, 300);
    if (patch.structure !== undefined) {
      if (!STRUCTURES.some((s) => s.id === patch.structure)) throw new Error("There is no such structure.");
      org.structure = String(patch.structure);
    }
    if (patch.industry !== undefined) {
      if (!INDUSTRIES.some((i) => i.id === patch.industry)) throw new Error("There is no such kind of business.");
      org.industry = String(patch.industry);
    }
    if (patch.approvalLimit !== undefined) {
      const limit = patch.approvalLimit === null || patch.approvalLimit === "" ? null : Number(patch.approvalLimit);
      if (limit !== null && !(Number.isFinite(limit) && limit >= 0 && limit <= 1_000_000)) throw new Error("The approval limit is an amount in dollars.");
      org.approvalLimit = limit;
    }
    if (patch.philosophy !== undefined) org.philosophy = String(patch.philosophy ?? "").trim().slice(0, 1200);
    if (patch.assign !== undefined) {
      if (!isAssignRule(patch.assign)) throw new Error("Choose who may hand work to whom.");
      org.assign = patch.assign;
    }
    save(data);
    return tidy(org);
  },

  remove(id: string) {
    const data = read();
    find(data, id);
    if (data.orgs.length === 1) throw new Error("This is your only organization. Create another before removing it.");
    data.orgs = data.orgs.filter((o) => o.id !== id);
    if (data.active === id) data.active = data.orgs[0].id;
    save(data);
  },

  /**
   * Puts a bot in a role, or changes its role. The manager must be a member,
   * and the chart must stay a tree: nobody may end up above its own manager.
   */
  setMember(id: string, input: { bot: unknown; title?: unknown; department?: unknown; manager?: unknown; also?: unknown; placed?: boolean; responsibilities?: unknown }): Org {
    const data = read();
    const org = find(data, id);
    const bot = loadCrew().bots.find((b) => b.id === input.bot);
    if (!bot) throw new Error("There is no such agent.");
    const existing = org.members.find((m) => m.bot === bot.id);
    const manager = input.manager === undefined ? (existing?.manager ?? null) : input.manager ? String(input.manager) : null;
    if (manager) {
      if (manager === bot.id) throw new Error("A bot cannot report to itself.");
      if (!org.members.some((m) => m.bot === manager)) throw new Error("Its manager must be a member of this organization.");
      // Walking up from the new manager must not come back to this bot.
      for (let at: string | null = manager, steps = 0; at; steps++) {
        if (at === bot.id || steps > org.members.length) throw new Error(`${bot.name} is above that agent in the chart, so it cannot report to it.`);
        at = org.members.find((m) => m.bot === at)?.manager ?? null;
      }
    }
    const also = input.also === undefined ? (existing?.also ?? null) : input.also ? String(input.also) : null;
    if (also) {
      if (also === bot.id) throw new Error("An agent cannot be its own project lead.");
      if (!org.members.some((m) => m.bot === also)) throw new Error("Its project lead must be a member of this organization.");
    }
    const member: Member = {
      bot: bot.id,
      title: clean(input.title ?? existing?.title, 50) || titleFor(bot),
      department: clean(input.department ?? existing?.department, 30) || bot.group,
      manager,
      also: also && also !== manager ? also : null,
      ...((input.placed ?? existing?.placed) ? { placed: true } : {}),
      ...((input.responsibilities ?? existing?.responsibilities) ? { responsibilities: String(input.responsibilities ?? existing?.responsibilities ?? "").replace(/\s+/g, " ").trim().slice(0, 400) } : {}),
    };
    if (!member.responsibilities) delete member.responsibilities;
    org.members = existing ? org.members.map((m) => (m.bot === bot.id ? member : m)) : [...org.members, member];
    // Moving out of a group it led leaves that group without a lead; naming a new group makes it.
    Object.assign(org, withGroups(org));
    save(data);
    return tidy(org);
  },

  /**
   * Puts the whole chart back as it was in a snapshot the page took (for undo). Checked like any change: every
   * agent must exist, every manager and dotted line must be on the chart, and the chart must stay a tree.
   */
  replaceChart(id: string, snapshot: { members?: unknown; groups?: unknown }): Org {
    const data = read();
    const org = find(data, id);
    const known = new Set(loadCrew().bots.map((b) => b.id));
    const members = (Array.isArray(snapshot.members) ? snapshot.members : []).map((m: Record<string, unknown>) => ({
      bot: String(m.bot ?? ""),
      title: clean(m.title, 50),
      department: clean(m.department, 30),
      manager: m.manager ? String(m.manager) : null,
      also: m.also ? String(m.also) : null,
      ...(m.placed ? { placed: true } : {}),
      ...(m.responsibilities ? { responsibilities: String(m.responsibilities).replace(/\s+/g, " ").trim().slice(0, 400) } : {}),
    })) as Member[];
    const ids = new Set(members.map((m) => m.bot));
    if (ids.size !== members.length) throw new Error("An agent appears twice in that chart.");
    for (const m of members) {
      if (!known.has(m.bot)) throw new Error(`There is no agent called "${m.bot}" any more.`);
      if (!m.title || !m.department) throw new Error("Every position needs a title and a group.");
      if (m.manager && !ids.has(m.manager)) throw new Error("A manager in that chart is not on it.");
      if (m.also && !ids.has(m.also)) m.also = null;
      for (let at: string | null = m.manager, steps = 0; at; steps++) {
        if (at === m.bot || steps > members.length) throw new Error("That chart has a loop in its reporting lines.");
        at = members.find((x) => x.bot === at)?.manager ?? null;
      }
    }
    const groups = (Array.isArray(snapshot.groups) ? snapshot.groups : []).map((g: Record<string, unknown>) => ({
      id: /^[a-f0-9]{16}$/.test(String(g.id ?? "")) ? String(g.id) : newId(),
      name: clean(g.name, 30),
      lead: g.lead && ids.has(String(g.lead)) ? String(g.lead) : null,
      leadChosen: g.leadChosen === true,
      ...(g.goal ? { goal: clean(g.goal, 300) } : {}),
      ...budgetOf(g.budget ?? undefined),
    })).filter((g) => g.name) as Group[];
    org.members = members;
    org.groups = groups;
    save(data);
    return tidy(org);
  },

  /** A new group (team or department), with a lead if one is given. */
  addGroup(id: string, input: { name: unknown; lead?: unknown; goal?: unknown; budget?: unknown }): Org {
    const data = read();
    const org = find(data, id);
    const name = clean(input.name, 30);
    if (!name) throw new Error("A group needs a name.");
    if (org.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a group called "${name}".`);
    const group: Group = { id: newId(), name, lead: null, leadChosen: false, ...(input.goal ? { goal: clean(input.goal, 300) } : {}), ...budgetOf(input.budget) };
    org.groups.push(group);
    save(data);
    return input.lead ? this.updateGroup(id, group.id, { lead: input.lead }) : tidy(org);
  },

  /** Renames a group (its positions follow), or changes its lead, goal or budget. The lead joins the group. */
  updateGroup(id: string, groupId: string, input: { name?: unknown; lead?: unknown; goal?: unknown; budget?: unknown; model?: unknown }): Org {
    const data = read();
    const org = find(data, id);
    const group = org.groups.find((g) => g.id === groupId);
    if (!group) throw new Error("There is no such group.");
    if (input.name !== undefined) {
      const name = clean(input.name, 30);
      if (!name) throw new Error("A group needs a name.");
      if (org.groups.some((g) => g !== group && g.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a group called "${name}".`);
      for (const m of org.members) if (m.department === group.name) m.department = name;
      group.name = name;
    }
    if (input.lead !== undefined) {
      const lead = input.lead ? String(input.lead) : null;
      const member = lead ? org.members.find((m) => m.bot === lead) : null;
      if (lead && !member) throw new Error("The lead must be a position in this organization.");
      if (member) member.department = group.name;
      group.lead = lead;
      group.leadChosen = Boolean(lead);
    }
    if (input.goal !== undefined) group.goal = clean(input.goal, 300) || undefined;
    if (input.budget !== undefined) Object.assign(group, { budget: budgetOf(input.budget).budget ?? null });
    if (input.model !== undefined) {
      const ref = String(input.model ?? "").trim();
      if (ref && !/^[\w.-]+\/[\w.:@/+-]{1,160}$/.test(ref)) throw new Error("Choose the group's model from the list.");
      group.model = ref || null;
    }
    save(data);
    return tidy(org);
  },

  /** Removes a group. Its positions move to another group, which must be named if it has any. */
  removeGroup(id: string, groupId: string, moveTo?: unknown): Org {
    const data = read();
    const org = find(data, id);
    const group = org.groups.find((g) => g.id === groupId);
    if (!group) throw new Error("There is no such group.");
    const inIt = org.members.filter((m) => m.department === group.name);
    const target = moveTo ? org.groups.find((g) => g.id === moveTo && g !== group) : null;
    if (inIt.length && !target) throw new Error(`${inIt.length} position${inIt.length === 1 ? " is" : "s are"} in ${group.name}. Choose the group to move ${inIt.length === 1 ? "it" : "them"} to.`);
    for (const m of inIt) m.department = target!.name;
    org.groups = org.groups.filter((g) => g !== group);
    save(data);
    return tidy(org);
  },

  /**
   * Puts another agent in a position: the title, responsibilities, group and every line stay where they are;
   * only who does the job changes. The agent leaving stays on the owner's team.
   */
  swapAgent(id: string, fromBot: string, toBot: unknown): Org {
    const data = read();
    const org = find(data, id);
    const to = loadCrew().bots.find((b) => b.id === toBot);
    if (!to) throw new Error("There is no such agent.");
    if (!org.members.some((m) => m.bot === fromBot)) throw new Error("That position is not in this organization.");
    if (org.members.some((m) => m.bot === to.id)) throw new Error(`${to.name} already has a position here.`);
    for (const m of org.members) {
      if (m.bot === fromBot) m.bot = to.id;
      if (m.manager === fromBot) m.manager = to.id;
      if (m.also === fromBot) m.also = to.id;
    }
    for (const g of org.groups) if (g.lead === fromBot) g.lead = to.id;
    save(data);
    return tidy(org);
  },

  /** Takes a bot off the chart. Its reports move up to its own manager. */
  removeMember(id: string, botId: string): Org {
    const data = read();
    const org = find(data, id);
    const leaving = org.members.find((m) => m.bot === botId);
    if (!leaving) throw new Error("That agent is not in this organization.");
    org.members = org.members.filter((m) => m.bot !== botId).map((m) => ({ ...m, manager: m.manager === botId ? leaving.manager : m.manager, also: m.also === botId ? null : m.also }));
    for (const g of org.groups ?? []) if (g.lead === botId) g.lead = null;
    save(data);
    return tidy(org);
  },

  /** Takes everyone off the chart, to start over. The agents stay on the person's team. */
  clear(id: string): Org {
    const data = read();
    const org = find(data, id);
    org.members = [];
    save(data);
    return tidy(org);
  },

  /** Takes a lead and everyone beneath it off the chart: a whole team at once. */
  removeTeam(id: string, botId: string): Org {
    const data = read();
    const org = find(data, id);
    if (!org.members.some((m) => m.bot === botId)) throw new Error("That agent is not in this organization.");
    const going = new Set([botId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of org.members) if (m.manager && going.has(m.manager) && !going.has(m.bot)) (going.add(m.bot), (grew = true));
    }
    org.members = org.members.filter((m) => !going.has(m.bot)).map((m) => ({ ...m, also: m.also && going.has(m.also) ? null : m.also }));
    save(data);
    return tidy(org);
  },

  /** A new bot joins the active organization, reporting to the person, unless told where it goes. */
  welcome(bot: Bot, role: { title?: string; department?: string; manager?: string | null } = {}) {
    const org = this.active();
    if (org.members.some((m) => m.bot === bot.id)) return;
    const manager = role.manager && org.members.some((m) => m.bot === role.manager) ? role.manager : null;
    this.setMember(org.id, { bot: bot.id, title: role.title, department: role.department, manager });
  },
};

export const memberOf = (org: Org, botId: string) => org.members.find((m) => m.bot === botId);
export const reportsOf = (org: Org, botId: string | null) => org.members.filter((m) => m.manager === botId);

/** One line on what a bot does, for telling others who can help with what. */
export const oneLine = (bot: Bot) => (bot.instructions.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 160);

/** Kept for the pages that show it: work now always follows the lines the owner drew. */
export const assignRule = (_org: Org): AssignRule => "reports";
export const requestRule = (_org: Org): RequestRule => "heads";

/** Everyone below a position: its reports, their reports and so on. */
function below(org: Org, botId: string): Member[] {
  const out: Member[] = [];
  const seen = new Set([botId]);
  for (let wave = org.members.filter((m) => m.manager === botId); wave.length; ) {
    out.push(...wave);
    wave.forEach((m) => seen.add(m.bot));
    wave = org.members.filter((m) => m.manager && wave.some((w) => w.bot === m.manager) && !seen.has(m.bot));
  }
  return out;
}

/** The positions an agent may hand a task to: everyone below it on the chart, and anyone on a dotted line to it. */
export function assignableBy(org: Org, botId: string): Member[] {
  const dotted = org.members.filter((m) => m.also === botId);
  return [...new Set([...below(org, botId), ...dotted])];
}

/** The group a position is in. */
export const groupOf = (org: Org, botId: string) => ((m) => (m ? (org.groups ?? []).find((g) => g.name === m.department) : undefined))(memberOf(org, botId));

/** Whether a member leads its group (or, in a group without a named lead, heads it). */
export const headsItsDepartment = (org: Org, m: Member) => {
  const group = (org.groups ?? []).find((g) => g.name === m.department);
  return group?.lead ? group.lead === m.bot : !m.manager || memberOf(org, m.manager)?.department !== m.department;
};

/**
 * The positions an agent may request work from: the leads of the other groups. They accept or decline; a request
 * is not an order. Work for a group goes to its lead, never around it.
 */
export function requestableBy(org: Org, botId: string): Member[] {
  const me = memberOf(org, botId);
  if (!me) return [];
  const mine = new Set(assignableBy(org, botId).map((m) => m.bot));
  return org.members.filter((m) => m.bot !== botId && !mine.has(m.bot) && m.department !== me.department && headsItsDepartment(org, m));
}

/** What the organization says about spending and commitments. */
export const approvalWords = (org: Org) =>
  org.approvalLimit != null && org.approvalLimit > 0
    ? `Any spending, payment, order or commitment above $${org.approvalLimit} needs the owner's approval; say so and stop. Below that, your lead may approve it within its own decision rights. Nothing is ever paid, sent or signed by an agent.`
    : "Any spending, payment, order or commitment needs the owner's approval; say so and stop. Nothing is ever paid, sent or signed by an agent.";

/** How the organization works, as told to its agents: by the lines its owner drew, and the owner's own philosophy if written. */
export function guidanceOf(org: Org): string {
  const own = (org.philosophy ?? "").trim();
  return `${own ? `The owner runs this organization by this philosophy: ${own} ` : ""}The owner drew this organization's chart, and work follows its lines: you may hand work to anyone below you, and to anyone on a dotted line to you; work for another group goes to that group's lead as a request; and decisions above you go up your line.`;
}

/** How many colleagues are named one by one before the rest are given as departments. Keeps the prompt small in a large organization. */
const NAMED_COLLEAGUES = 12;

/**
 * What a member is told about its place: its title, how the organization is
 * run, who it answers to, who it may hand work to and who else it can ask.
 * Only the colleagues near it are described; the rest are a name or a
 * department away, so a large organization does not fill every prompt.
 * Empty when the bot is not on the chart.
 */
export function rolePrompt(bot: Bot, org = orgs.active()): string {
  const me = memberOf(org, bot.id);
  if (!me) return "";
  const crew = new Map(loadCrew().bots.map((b) => [b.id, b]));
  const nameOf = (id: string) => crew.get(id)?.name ?? id;
  const named = (m: Member) => ((name) => (name.toLowerCase() === m.title.toLowerCase() ? name : `${name} (${m.title})`))(nameOf(m.bot));
  const the = (m: Member) => ((name) => (name.toLowerCase() === m.title.toLowerCase() ? `the ${name}` : `${name}, the ${m.title}`))(nameOf(m.bot));
  const boss = me.manager ? memberOf(org, me.manager) : null;
  const projectLead = me.also ? memberOf(org, me.also) : null;
  const canAssign = assignableBy(org, bot.id);
  const reports = org.members.filter((m) => m.manager === bot.id || m.also === bot.id);
  const mates = me.manager ? org.members.filter((m) => m.manager === me.manager && m.bot !== bot.id) : [];
  const group = groupOf(org, bot.id);
  const groupLead = group?.lead && group.lead !== bot.id ? memberOf(org, group.lead) : null;
  const lines = [
    "# Your place in the organization",
    `You are the ${me.title}${me.department ? ` in the ${me.department} group` : ""} of ${org.name}.${org.mission ? ` Its mission: ${org.mission}` : ""}`,
    me.responsibilities ? `What you are responsible for, in the owner's words: ${me.responsibilities}` : "",
    group ? `${group.lead === bot.id ? `You lead the ${group.name} group: work the owner gives the group, and requests from other groups, come to you to share out.` : groupLead ? `Your group's lead is ${the(groupLead)}.` : ""}${group.goal ? ` The group's purpose: ${group.goal}` : ""}` : "",
    guidanceOf(org),
    `${boss ? `You report to ${the(boss)}. Your reports go to them.` : "You report directly to the user, who owns the organization."}${projectLead ? ` Your project lead is ${the(projectLead)}, who may also give you tasks.` : ""}`,
  ];
  if (reports.length) {
    lines.push(
      `These agents report to you. Hand a task to the one it fits with the assign_task tool, instead of doing their kind of work yourself:\n${reports.map((r) => `- ${named(r)}: ${crew.get(r.bot) ? oneLine(crew.get(r.bot)!) : ""}`).join("\n")}`,
    );
  }
  if (mates.length) lines.push(`Your teammates under the same lead: ${mates.map(named).join(", ")}.`);
  const others = canAssign.filter((m) => !reports.includes(m));
  if (others.length) lines.push(`You may also hand a task to ${others.length > NAMED_COLLEAGUES ? "any other member of the organization" : others.map(named).join(", ")} with assign_task.`);
  if (canAssign.length) {
    lines.push("Give each task everything the agent needs to know: it does not see this conversation. After assigning, finish any work that does not depend on the result, then end your turn; each report arrives as a message. When all the reports are in, check them, put them together and report upward.");
  } else {
    lines.push("Nobody takes tasks from you, so you do the work yourself. If a task belongs to another group, say so in your report rather than doing it badly.");
  }
  const rest = org.members.filter((m) => m.bot !== bot.id && m !== boss && m !== projectLead && !reports.includes(m) && !mates.includes(m));
  if (rest.length) {
    const directory =
      org.members.length <= NAMED_COLLEAGUES
        ? rest.map(named).join(", ")
        : [...new Set(rest.map((m) => m.department))].sort().map((d) => `${d} (${rest.filter((m) => m.department === d).length})`).join(", ");
    lines.push(`Other colleagues you can ask: ${directory}.`);
  }
  const peers = requestableBy(org, bot.id);
  if (peers.length) lines.push(`For work that belongs to another group, use request_work: you may request it from ${peers.length > NAMED_COLLEAGUES ? "the lead of that group" : peers.map(named).join(", ")}. They accept or decline; a request is not an order.`);
  lines.push(`${boss ? `When something is not yours to decide, or two leads want different things from you, use escalate to put it to ${the(boss)} with the options and your recommendation.` : "You report to the owner: when something is not yours to decide, stop and put it to the owner in your report under “Needs your decision”, with the options and your recommendation."} When two leads want different things from you, your manager decides; above them, the owner does.`);
  lines.push(approvalWords(org));
  if (org.members.length > 1) lines.push("You can put a short question to any colleague with ask_colleague and the answer comes back as a message. Ask when a colleague knows something you need; do not ask what you could look up in the organization's memory.");
  return lines.filter(Boolean).join("\n\n");
}

/** The model a position's group uses, if the owner gave the group one. */
export function groupModelOf(org: Org, botId: string): string | undefined {
  return groupOf(org, botId)?.model ?? undefined;
}
