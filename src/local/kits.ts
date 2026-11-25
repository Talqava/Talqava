// Company templates and playbooks: Marketplace listings that set up more than one thing at once.
//
// A company template gives a kind of business a running start: the positions on its chart, the page packs its agents
// follow, and the routines it runs. A playbook is one known process (a month-end close, hiring, taking on a client):
// its procedure as a page, a routine for the group that owns it, and a "Run it now" that gives the group's lead the
// work as a task. Both say exactly what they will add before anything changes, add nothing that spends money on its
// own (routines arrive paused), and can be undone in one step: the chart goes back as it was, the pages go to
// Deleted, and the routines are removed. Agents that were added to the team stay on it, off the chart.
import path from "node:path";
import type { JobBook } from "../core/index.ts";
import { DATA, readJson, writeJson } from "./store.ts";
import { orgs } from "./orgs.ts";
import type { Org } from "./orgs.ts";
import { addTeam, buildStructure, loadMarketplace, loadTeams } from "./marketplace.ts";
import { industryOf, seatsFor } from "./structures.ts";
import { workspace } from "./workspace.ts";
import { work } from "./work.ts";
import { audit } from "./audit.ts";

interface Routine {
  name: string;
  /** When it runs, as the Routines page writes it. */
  schedule: string;
  prompt: string;
  /** The group whose lead does it: the first of these the chart has. */
  groups: string[];
}

export interface Kit {
  id: string;
  kind: "company" | "playbook";
  name: string;
  icon: string;
  summary: string;
  /** For a company template: the chart it sets up, from an example for a kind of business, or from ready-made teams. */
  chart?: { structure: string; industry: string } | { teams: string[] };
  /** Page packs to add (see workspace-templates.ts). */
  packs?: string[];
  /** For a playbook: its procedure, as one page. */
  page?: { title: string; icon: string; markdown: string; protected?: boolean };
  routines?: Routine[];
  /** For a playbook: the task "Run it now" gives the lead of the owning group. */
  run?: { title: string; description: string; groups: string[] };
}

const weekly = "0 9 * * 1";
const monthStart = "0 9 1 * *";

export const KITS: Kit[] = [
  {
    id: "company-services",
    kind: "company",
    name: "Professional services firm",
    icon: "🏢",
    summary: "For consultancies, agencies, accountants and other firms that sell their time: sales, delivery, finance and people, with a price list and standard procedures.",
    chart: { structure: "functional", industry: "services" },
    packs: ["sop-library", "price-list", "people"],
    routines: [
      { name: "Weekly pipeline and client review", schedule: weekly, groups: ["Sales", "Operations"], prompt: "Review this week's pipeline and clients: new enquiries, proposals out, work under way, and anything at risk. Use the workspace's price list and procedures. Report the five things the owner should know, and what you suggest for each." },
      { name: "Month-end close", schedule: monthStart, groups: ["Finance"], prompt: "Close last month's books following the month-end procedure in the workspace if there is one: reconcile, list unpaid invoices and bills due, and summarise income, costs and cash. Report what is done, what is missing, and what needs the owner's decision." },
    ],
  },
  {
    id: "company-restaurant",
    kind: "company",
    name: "Restaurant or café",
    icon: "🍽️",
    summary: "For restaurants, cafés and other hospitality businesses: operations, guests, marketing, finance and people, with opening and closing checklists.",
    chart: { structure: "functional", industry: "hospitality" },
    packs: ["sop-library", "operations", "people"],
    routines: [
      { name: "Weekly rota, stock and supplier check", schedule: weekly, groups: ["Operations"], prompt: "Check next week's rota, stock levels and supplier orders against the procedures in the workspace. Report gaps in cover, anything running low, and orders that need the owner's approval." },
      { name: "Weekly takings and costs", schedule: "0 9 * * 2", groups: ["Finance"], prompt: "Summarise last week's takings, food and staff costs, and how they compare with the week before. Report what changed and one thing to look at." },
    ],
  },
  {
    id: "company-shop",
    kind: "company",
    name: "Online shop",
    icon: "🛒",
    summary: "For shops that sell online: marketing, customer support, operations and finance, with a price list and procedures for orders, refunds and complaints.",
    chart: { structure: "functional", industry: "commerce" },
    packs: ["sop-library", "price-list", "sales"],
    routines: [
      { name: "Daily orders, stock and customer messages", schedule: "0 8 * * 1-5", groups: ["Operations", "Customer Support"], prompt: "Check yesterday's orders, stock that is running low, and customer messages waiting for an answer, following the procedures in the workspace. Report what was handled and what needs the owner." },
      { name: "Weekly sales report", schedule: weekly, groups: ["Marketing", "Finance"], prompt: "Report last week's sales: orders, revenue, best sellers, returns, and what marketing ran. Say what changed from the week before and suggest one thing to try." },
    ],
  },
  {
    id: "company-nonprofit",
    kind: "company",
    name: "Nonprofit",
    icon: "❤️",
    summary: "For charities and community organizations: fundraising and finance teams, with handbooks for people and operations.",
    chart: { teams: ["nonprofit-team", "finance-team"] },
    packs: ["people", "operations"],
    routines: [
      { name: "Monthly donor and grant report", schedule: monthStart, groups: ["Nonprofit", "Fundraising"], prompt: "Report last month's donations and grants: what came in, from whom, applications under way and their deadlines, and donors to thank. Say what needs the owner's attention." },
      { name: "Month-end close", schedule: "0 9 2 * *", groups: ["Finance"], prompt: "Close last month's books: reconcile, list what is owed and due, and summarise income against the budget, with restricted funds shown apart. Report what is done and what needs a decision." },
    ],
  },
  {
    id: "playbook-month-end",
    kind: "playbook",
    name: "Month-end close",
    icon: "🧾",
    summary: "Close each month's books the same way: reconcile, chase what is owed, review costs, and report the numbers. Run by your Finance lead.",
    page: {
      title: "Month-end close",
      icon: "🧾",
      markdown: `## Purpose

Close each month's books the same way, so the numbers can be trusted.

## Who does what

- The **Finance lead** plans the close, hands out the parts, checks them and writes the report.
- Nothing is paid, sent or signed by an agent: payments and filings are prepared for the owner.

## Steps

1. **Reconcile** every bank and card account to its statement. List anything that does not match.
2. **Money owed to us**: list unpaid invoices by age, and chase those over 30 days (see the procedure for late invoices, if there is one).
3. **Money we owe**: list bills due in the next 30 days, for the owner to approve.
4. **Review costs** against last month and the budget. Explain anything that moved by more than 10%.
5. **Report**: income, costs, profit and cash at month end, what is still open, and what needs the owner's decision.

## Needs the owner's approval

- Any payment, write-off or change to the accounts.
`,
    },
    routines: [{ name: "Month-end close", schedule: monthStart, groups: ["Finance"], prompt: "Carry out the month-end close for last month, following the “Month-end close” page in the workspace step by step. Hand the parts to your team, check them, and end with the report that page asks for." }],
    run: { title: "Month-end close", description: "Carry out the month-end close for last month, following the “Month-end close” page in the workspace step by step. Hand the parts to your team, check them, and end with the report that page asks for.", groups: ["Finance"] },
  },
  {
    id: "playbook-hiring",
    kind: "playbook",
    name: "Hiring",
    icon: "🧑‍💼",
    summary: "Hire for a role step by step: the role description, where to advertise, screening, interviews and the offer. Run by your People lead; you decide who is hired.",
    page: {
      title: "Hiring a new person",
      icon: "🧑‍💼",
      markdown: `## Purpose

Hire fairly and the same way each time.

## Who does what

- The **People lead** runs the process and keeps the owner informed.
- The **owner** decides who is interviewed and who is hired. No agent makes or sends an offer.

## Steps

1. **Role description**: what the person will do, what they need, pay range, hours and place. The owner approves it.
2. **Advertise**: draft the advert and say where to post it. The owner posts it, or approves the posting.
3. **Screen** applications against the role description only. List each with a short reason: yes, maybe, no.
4. **Interviews**: propose questions tied to the role, and a scoring sheet. Summarise each interview from the owner's notes.
5. **Offer**: draft the offer and the replies to those not chosen, for the owner to send.
6. **First week**: prepare the first-week checklist (see the People handbook, if you have it).

## Never

- Judge a candidate on anything but what the role needs.
- Contact a candidate without the owner's approval.
`,
    },
    run: { title: "Hire for a role", description: "Start hiring for a role, following the “Hiring a new person” page in the workspace. First ask the owner which role, the pay range and the start date if they are not in the workspace; then draft the role description for the owner's approval.", groups: ["People"] },
  },
  {
    id: "playbook-client-onboarding",
    kind: "playbook",
    name: "Client onboarding",
    icon: "🤝",
    summary: "Give every new client the same good start: what they bought, the welcome, the set-up and a check-in after the first week.",
    page: {
      title: "Onboarding a new client",
      icon: "🤝",
      markdown: `## Purpose

Give every new client the same good start, so nothing promised is forgotten.

## Steps

1. **Record** who they are, what they bought, what was promised and by when.
2. **Welcome**: draft the welcome message with what happens next and who to contact, for the owner to send or approve.
3. **Set up** what they need to start: account, access, first booking or delivery.
4. **Kick-off**: propose an agenda for the first meeting and the questions to ask.
5. **Check in** after the first week: is it what they expected? Record the answer.
6. **Hand over** to whoever looks after the client from now on, with everything above in one place.

## Needs the owner's approval

- Anything sent to the client, and any change to what was agreed.
`,
    },
    run: { title: "Onboard a new client", description: "Onboard a new client, following the “Onboarding a new client” page in the workspace. First ask the owner who the client is and what they bought if it is not in the workspace; then work through the steps and report.", groups: ["Customer Support", "Sales", "Operations", "Professional Services"] },
  },
];

/** What was installed, kept so it can be undone. */
interface Installed {
  kit: string;
  org: string;
  at: string;
  before: { members: unknown; groups: unknown; structure: string; industry: string };
  pages: string[];
  jobs: string[];
}
const file = () => path.join(DATA, "kits-installed.json");
const installed = () => readJson<Installed[]>(file(), []);

const kitOf = (id: string) => {
  const kit = KITS.find((k) => k.id === id);
  if (!kit) throw new Error("The Marketplace has no such template or playbook.");
  return kit;
};

/** The lead of the first of these groups that the chart has. */
function leadOf(org: Org, groups: string[]): { bot: string; title: string; group: string } | null {
  for (const name of groups) {
    const group = (org.groups ?? []).find((g) => g.name === name);
    const member = group?.lead ? org.members.find((m) => m.bot === group.lead) : undefined;
    if (group && member) return { bot: member.bot, title: member.title, group: group.name };
  }
  return null;
}

/** The positions a kit's chart would add to this organization, by agent id. */
function seatsToAdd(org: Org, kit: Kit): string[] {
  if (!kit.chart) return [];
  const have = new Set(org.members.map((m) => m.bot));
  const wanted = "teams" in kit.chart ? kit.chart.teams.flatMap((t) => loadTeams().find((x) => x.id === t)?.bots ?? []) : seatsFor(kit.chart.structure, industryOf(kit.chart.industry)).map((s) => s.bot);
  return [...new Set(wanted)].filter((b) => !have.has(b));
}

/** Before installing: exactly what a kit would add to this organization. Nothing changes. */
export function previewKit(org: Org, id: string) {
  const kit = kitOf(id);
  const names = new Map(loadMarketplace().bots.map((m) => [m.bot.id, m.listing.title || m.bot.name]));
  const packs = workspace.packs(org);
  // Routines go to the lead of their group; for a company template, that group arrives with the chart.
  const after = kit.chart ? null : org;
  return {
    id: kit.id,
    kind: kit.kind,
    name: kit.name,
    icon: kit.icon,
    summary: kit.summary,
    positions: seatsToAdd(org, kit).map((b) => names.get(b) ?? b),
    packs: (kit.packs ?? []).map((p) => packs.find((k) => k.id === p)).filter((k): k is NonNullable<typeof k> => Boolean(k)).map((k) => ({ name: k.name, pages: k.pages.length, already: Boolean(k.added) })),
    page: kit.page ? kit.page.title : null,
    routines: (kit.routines ?? []).map((r) => ({ name: r.name, group: r.groups[0], owner: after ? (leadOf(after, r.groups)?.title ?? null) : null })),
    run: kit.run ? { title: kit.run.title, owner: leadOf(org, kit.run.groups)?.title ?? null, groups: kit.run.groups } : null,
    installed: installed().some((i) => i.kit === kit.id && i.org === org.id),
  };
}

/** Every template and playbook, with whether it is installed in this organization. */
export function listKits(org: Org) {
  const mine = new Set(installed().filter((i) => i.org === org.id).map((i) => i.kit));
  return KITS.map((k) => ({ id: k.id, kind: k.kind, name: k.name, icon: k.icon, summary: k.summary, installed: mine.has(k.id), canRun: Boolean(k.run) }));
}

/** Installs a kit: positions, page packs, its page and its routines (paused). Returns what was added. */
export async function installKit(orgId: string, id: string, jobs: JobBook) {
  const kit = kitOf(id);
  orgs.setActive(orgId);
  let org = orgs.active();
  if (installed().some((i) => i.kit === kit.id && i.org === org.id)) throw new Error(`${kit.name} is already installed. Undo it first to install it again.`);
  const record: Installed = { kit: kit.id, org: org.id, at: new Date().toISOString(), before: structuredClone({ members: org.members, groups: org.groups ?? [], structure: org.structure, industry: org.industry }), pages: [], jobs: [] };
  const positions = seatsToAdd(org, kit).length;
  if (kit.chart) {
    if ("teams" in kit.chart) for (const team of kit.chart.teams) addTeam(team);
    else buildStructure(org.id, kit.chart.structure, kit.chart.industry);
    org = orgs.active();
  }
  const packs = workspace.packs(org);
  for (const p of kit.packs ?? []) if (!packs.find((k) => k.id === p)?.added) record.pages.push(workspace.addTemplate(org, p).id);
  if (kit.page) {
    const page = workspace.create(org, null, { title: kit.page.title, icon: kit.page.icon, markdown: kit.page.markdown, template: kit.id });
    if (kit.page.protected) workspace.update(org, page.id, { protected: true });
    record.pages.push(page.id);
  }
  for (const r of kit.routines ?? []) {
    const lead = leadOf(org, r.groups);
    const job = await jobs.create({ name: r.name, prompt: r.prompt, schedule: r.schedule, owner: lead?.bot ?? null, org: org.id });
    // Paused: a routine spends money each time it runs, so the owner switches it on.
    await jobs.update(job.id, { enabled: false });
    record.jobs.push(job.id);
  }
  writeJson(file(), [...installed(), record]);
  audit({ actor: "owner", actorName: "You", kind: "organization", action: `Installed ${kit.kind === "company" ? "the company template" : "the playbook"} “${kit.name}”`, detail: `${positions} positions, ${record.pages.length} sets of pages, ${record.jobs.length} routines (paused)` });
  return { positions, pages: record.pages, routines: record.jobs.length };
}

/** Undoes an installed kit: the chart as it was, its pages to Deleted, its routines removed. */
export async function undoKit(orgId: string, id: string, jobs: JobBook) {
  const kit = kitOf(id);
  const all = installed();
  const record = all.findLast((i) => i.kit === kit.id && i.org === orgId);
  if (!record) throw new Error(`${kit.name} is not installed.`);
  orgs.setActive(orgId);
  if (kit.chart) {
    orgs.replaceChart(orgId, { members: record.before.members, groups: record.before.groups });
    orgs.update(orgId, { structure: record.before.structure, industry: record.before.industry });
  }
  const org = orgs.active();
  for (const page of record.pages) {
    try {
      workspace.archive(org, page);
    } catch {
      // Already deleted by the owner.
    }
  }
  for (const job of record.jobs) await jobs.remove(job).catch(() => {});
  writeJson(file(), all.filter((i) => i !== record));
  audit({ actor: "owner", actorName: "You", kind: "organization", action: `Undid “${kit.name}”`, detail: "The chart is as it was; its pages are in Deleted; its routines are removed." });
  return { ok: true };
}

/** A playbook's "Run it now": its task goes to the lead of the group that owns it, who plans it for approval. */
export function runPlaybook(orgId: string, id: string) {
  const kit = kitOf(id);
  if (!kit.run) throw new Error(`${kit.name} is not a playbook.`);
  orgs.setActive(orgId);
  const org = orgs.active();
  const lead = leadOf(org, kit.run.groups);
  if (!lead) throw new Error(`This playbook is run by the lead of your ${kit.run.groups[0]} group, and your chart has none yet. Add a ${kit.run.groups[0]} group with a lead on the Organization page, or install a company template.`);
  const item = work.create(org, { title: kit.run.title, description: kit.run.description, owner: lead.bot, createdBy: "owner" });
  work.kick();
  return { task: item.id, owner: lead.title };
}
