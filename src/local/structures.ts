// Organization structures. A structure is a way of running an organization:
// who may hand work to whom, how work is requested across departments, and the
// thinking behind it. Each organization has one; its philosophy is shown to the
// person and told to every agent, and its rules are enforced by the hand-off
// tools (see assignableBy and requestableBy in orgs.ts), so the agents behave
// the way that kind of organization does. The chart itself is always the
// person's to edit.
//
// A structure is only offered when the software makes it behave differently
// from the others. Divisions are not offered: a real division has its own
// sales, delivery and finance under a general manager, which would need the
// same role several times over.

/** Who an agent may hand a task to as its lead. */
export type AssignRule = "reports" | "team" | "anyone";
/** Who an agent may ask for work across the chart: only peers under its own lead, the head of any department, or anyone. */
export type RequestRule = "chain" | "heads" | "anyone";

export interface Structure {
  id: string;
  name: string;
  /** One line for the picker. */
  summary: string;
  /** The management philosophy, in a short paragraph for the person. */
  philosophy: string;
  bestFor: string;
  /** The kinds of business this structure is recommended for. */
  businesses: string[];
  watchOut: string;
  /** How the chart is usually drawn, in a few words. */
  shape: string;
  assign: AssignRule;
  request: RequestRule;
  /** Who settles it when two leads disagree. */
  tieBreak: string;
  /** What every agent is told about how to work in this kind of organization. */
  guidance: string;
}

export const ASSIGN_RULES: Record<AssignRule, string> = {
  reports: "A lead hands tasks to its own direct reports only.",
  team: "A lead hands tasks to its direct reports, and teammates under the same lead may hand tasks to each other.",
  anyone: "Any agent may hand a task to any other agent.",
};

export const REQUEST_RULES: Record<RequestRule, string> = {
  chain: "Work for another department goes up the chain: only leads ask each other, and only leads who share a boss.",
  heads: "Any agent may request work from the head of another department or team, who accepts or declines it.",
  anyone: "Any agent may request work from any other.",
};

export const STRUCTURES: Structure[] = [
  {
    id: "functional",
    name: "Functional departments",
    summary: "Agents grouped by specialty (marketing, finance, operations), each department with a head who reports to you.",
    philosophy:
      "Group people by what they are expert in, and let each function get very good at its craft. Department heads set standards and priorities for their specialty and answer to you directly; you coordinate between them. The most common structure for a business with one main line of work.",
    bestFor: "Small and mid-size organizations with one main line of business that want depth of expertise and low overhead.",
    businesses: ["Professional services firms", "Online and retail stores", "Restaurants and hospitality groups", "Single-product software companies", "Most businesses under 250 people"],
    watchOut: "Departments optimize for themselves, and every disagreement between two heads lands on you.",
    shape: "One head per department reporting to you, with that department's specialists beneath.",
    assign: "reports",
    request: "heads",
    tieBreak: "You settle disagreements between department heads.",
    guidance:
      "This organization is run by functional departments. Do excellent work in your own specialty and hold it to your department's standards. Department heads split work among their own specialists. When a task needs another department, do not do its work yourself: request it from that department's head with request_work, who accepts or declines. When two departments disagree, the heads take it to the owner with their options.",
  },
  {
    id: "hierarchical",
    name: "Traditional hierarchy",
    summary: "A general manager runs the departments for you. A clear chain of command, and every agent has one lead.",
    philosophy:
      "Clarity comes from a single line of authority. Each person has exactly one boss, decisions are made at the level that owns them, and work is delegated downward and reported upward. A general manager holds line authority over the department heads so that day-to-day conflicts are settled without you. Rooted in classical management (Fayol's unity of command, Weber's bureaucracy): predictable, accountable and easy to audit.",
    bestFor: "Larger or regulated organizations, and owners who want to step back from daily decisions without losing accountability.",
    businesses: ["Manufacturers", "Healthcare providers", "Banks and insurers", "Franchises and chains", "Businesses whose owner is not in the day-to-day"],
    watchOut: "Decisions queue at the top and move slowly, and departments can stop talking to each other.",
    shape: "You, then a general manager, then department heads, then leads and specialists.",
    assign: "reports",
    request: "chain",
    tieBreak: "The general manager settles disagreements between department heads; you settle what the general manager cannot.",
    guidance:
      "This organization runs as a traditional hierarchy. Follow the chain of command: take direction from your lead, hand work only to your own direct reports, and report results upward. Decide what is yours to decide and escalate the rest to your lead with a recommendation. Work for another department goes through the chain: if you lead a department, request it from a fellow head with request_work; otherwise raise it with your own lead using escalate. You may still ask any colleague a question.",
  },
  {
    id: "matrix",
    name: "Matrix",
    summary: "Two lines: each specialist reports to a functional lead and has a dotted line to a project lead, so both can hand it work.",
    philosophy:
      "Complex work needs both deep expertise and delivery focus, so people answer to two leads: a functional lead who owns standards and skills, and a project or product manager who owns priorities and deadlines. Authority is shared on purpose. It only works with a named tie-breaker, so a general manager sits above both lines.",
    bestFor: "Project-driven organizations where specialists are shared across several projects or clients at once.",
    businesses: ["Consultancies", "Marketing and creative agencies", "Engineering and construction firms", "IT services companies", "Software companies with several products"],
    watchOut: "Two leads can pull one specialist in different directions; without the tie-breaker it stalls.",
    shape: "Departments under a general manager, plus a dotted line from specialists to a project or product manager.",
    assign: "reports",
    request: "heads",
    tieBreak: "When a functional lead and a project lead disagree, the general manager decides.",
    guidance:
      "This organization is a matrix. You may have two leads: your functional lead owns how the work is done and its quality; your project lead owns what is needed and when. Take tasks from either and report each task to whoever assigned it. When their requests conflict, do not choose silently: use escalate, which puts the conflict, the options and your recommendation to your functional lead; if the two leads cannot agree, the general manager decides. Request work from another department through its head with request_work.",
  },
  {
    id: "team",
    name: "Outcome teams",
    summary: "Small teams of mixed skills, each owning one outcome from start to finish, such as winning customers or keeping them.",
    philosophy:
      "Organize around outcomes, not specialties. Each team mixes the skills one result needs (for example a writer, a prospect researcher and an account executive to win customers) and owns that result end to end. The lead sets priorities and clears obstacles rather than directing every step, and teammates hand work to each other directly. This is the thinking behind agile squads and pods.",
    bestFor: "Organizations that want speed and ownership over strict control, and whose work flows across specialties all day.",
    businesses: ["Software and product companies", "Digital studios", "E-commerce brands", "Start-ups that are scaling", "Media and content businesses"],
    watchOut: "A specialty split across teams loses its shared standards unless someone owns them, and teams can duplicate work.",
    shape: "A lead per outcome reporting to you, each with the mix of specialists that outcome needs.",
    assign: "team",
    request: "heads",
    tieBreak: "Teammates settle it with their team lead; two team leads take it to you.",
    guidance:
      "This organization works in outcome teams. Your team owns its outcome together, across specialties: talk to your teammates directly, hand a piece of work to the teammate best placed to do it with assign_task, and help when a teammate is blocked. The team lead sets priorities and removes obstacles rather than dictating each step. When you need another team, request it from that team's lead with request_work. Judge your work by the team's outcome, not by your own task.",
  },
  {
    id: "flat",
    name: "Flat",
    summary: "No managers: everyone reports to you, and you hand out the work. Agents can still ask each other questions.",
    philosophy:
      "Remove the layers and trust capable people to manage themselves. With no middle management, information reaches everyone, decisions are made by whoever is closest to the work, and people pick up what needs doing. Common in start-ups and in self-managed companies such as Valve.",
    bestFor: "Very small organizations and early stages, where speed and initiative matter most.",
    businesses: ["Solo founders", "Early-stage start-ups", "Small studios and boutiques", "Family businesses", "Teams of up to about 12"],
    watchOut: "Past a dozen or so members nobody can see who owns what, and every decision lands on you.",
    shape: "One level: every agent reports straight to you.",
    assign: "anyone",
    request: "anyone",
    tieBreak: "Peers settle it between themselves; if they cannot, you decide.",
    guidance:
      "This organization is flat: there are no managers between you and the owner. Take initiative and own your work from start to finish. Work with colleagues as peers: ask whoever knows, and hand a task directly to the colleague best suited to it. Make the decision yourself when it is within your job, and tell the owner what you decided and why. When you and a colleague disagree and cannot settle it, put both options to the owner.",
  },
  {
    id: "custom",
    name: "Your own structure",
    summary: "Draw the chart yourself and set your own rules and philosophy.",
    philosophy: "",
    bestFor: "Organizations that already work in a way of their own.",
    businesses: ["Businesses with an unusual model", "Cooperatives and partnerships", "Organizations in transition", "Anyone who has outgrown a template"],
    watchOut: "Write the philosophy down: agents follow it exactly as written.",
    shape: "Whatever you draw: drag agents onto their leads.",
    assign: "reports",
    request: "heads",
    tieBreak: "Whoever you name in your philosophy; otherwise you.",
    guidance: "",
  },
];

export const DEFAULT_STRUCTURE = "functional";
export const structureOf = (id: string | undefined): Structure => STRUCTURES.find((s) => s.id === id) ?? STRUCTURES.find((s) => s.id === DEFAULT_STRUCTURE)!;
export const isAssignRule = (value: unknown): value is AssignRule => value === "reports" || value === "team" || value === "anyone";

// ---------- kinds of business ----------
// What a chart is staffed with depends on the business, not only on the
// structure: a restaurant group needs scheduling and purchasing, not a
// development team. An industry lists its departments and, for outcome
// teams, the teams it would run. The structure decides how they are drawn.

/** A lead with the agents under it; a member may itself lead others. */
export interface Group {
  lead: string;
  /** A name for the group where the structure renames departments (an outcome team). */
  name?: string;
  members: Array<string | Group>;
}

export interface Industry {
  id: string;
  name: string;
  /** Examples of the businesses meant, for the picker. */
  examples: string;
  /** Departments, each a head and its specialists. A group with no members is a single specialist reporting to the top. */
  departments: Group[];
  /** The same people regrouped around outcomes. */
  teams: Group[];
  /** For a matrix: a project or product manager, and the specialists in other departments it leads on a dotted line. */
  projects: Array<{ lead: string; over: string[] }>;
  /** The structures that suit this kind of business best, first choice first. */
  recommended: string[];
  why: string;
}

const g = (lead: string, members: Array<string | Group> = [], name?: string): Group => ({ lead, members, ...(name ? { name } : {}) });

export const INDUSTRIES: Industry[] = [
  {
    id: "general",
    name: "General business",
    examples: "Any business: marketing, sales, operations, finance, customers and people.",
    departments: [
      g("head-of-marketing", ["content-writer", "social-drafter", "paid-ads-specialist"]),
      g("head-of-sales", ["lead-finder", "account-executive"]),
      g("head-of-operations", ["project-manager", "procurement-manager"]),
      g("head-of-finance", ["bookkeeper", "accounts-payable", "invoice-chaser"]),
      g("head-of-support", ["support-replier", "customer-success-manager"]),
      g("head-of-people", ["recruiter", "payroll-administrator"]),
      g("compliance-manager"),
    ],
    teams: [
      g("head-of-marketing", ["content-writer", "paid-ads-specialist", "lead-finder", "account-executive"], "Win customers"),
      g("head-of-operations", ["project-manager", "procurement-manager"], "Deliver the work"),
      g("head-of-support", ["support-replier", "customer-success-manager", "invoice-chaser"], "Keep customers"),
      g("head-of-finance", ["bookkeeper", "accounts-payable", "payroll-administrator", "compliance-manager"], "Run the business"),
    ],
    projects: [{ lead: "project-manager", over: ["content-writer", "account-executive", "support-replier"] }],
    recommended: ["functional", "hierarchical"],
    why: "One main line of business: departments by specialty keep it simple, and a general manager helps once you want to step back.",
  },
  {
    id: "services",
    name: "Professional services",
    examples: "Law and accounting firms, consultancies, agencies, clinics.",
    departments: [
      g("head-of-operations", ["project-manager", "scheduling-coordinator", "reviewer"]),
      g("head-of-research", ["fact-checker", "competitor-watch"]),
      g("head-of-sales", ["client-intake-coordinator", "account-executive"]),
      g("head-of-marketing", ["content-writer", "proofreader"]),
      g("head-of-finance", ["billing-specialist", "bookkeeper", "invoice-chaser"]),
      g("head-of-people", ["recruiter", "payroll-administrator"]),
      g("compliance-manager", ["conflicts-checker"]),
    ],
    teams: [
      g("head-of-operations", ["project-manager", "scheduling-coordinator", "fact-checker", "reviewer"], "Client delivery"),
      g("head-of-sales", ["client-intake-coordinator", "account-executive", "content-writer", "conflicts-checker"], "Win and take on clients"),
      g("head-of-finance", ["billing-specialist", "bookkeeper", "invoice-chaser", "payroll-administrator", "compliance-manager"], "Practice management"),
    ],
    projects: [{ lead: "project-manager", over: ["fact-checker", "content-writer", "account-executive"] }],
    recommended: ["matrix", "functional"],
    why: "Specialists are shared across client engagements, which is what a matrix is for; functional departments suit a smaller firm.",
  },
  {
    id: "software",
    name: "Software and technology",
    examples: "Software products, apps, IT services, digital studios.",
    departments: [
      g("product-manager", ["functional-analyst", "technical-writer"]),
      g("head-of-engineering", [g("lead-developer", ["frontend-developer", "backend-developer", "qa-tester"]), "release-manager"]),
      g("head-of-marketing", ["content-writer", "seo-researcher"]),
      g("head-of-sales", ["lead-finder", "account-executive"]),
      g("head-of-support", ["support-replier", "customer-success-manager"]),
      g("head-of-finance", ["bookkeeper", "monthly-numbers"]),
    ],
    teams: [
      g("product-manager", ["functional-analyst", g("lead-developer", ["frontend-developer", "backend-developer", "qa-tester"]), "release-manager", "technical-writer"], "Build the product"),
      g("head-of-marketing", ["content-writer", "seo-researcher", "lead-finder", "account-executive"], "Grow"),
      g("head-of-support", ["support-replier", "customer-success-manager"], "Keep customers"),
    ],
    projects: [{ lead: "product-manager", over: ["frontend-developer", "backend-developer", "qa-tester", "content-writer"] }],
    recommended: ["team", "matrix"],
    why: "Product work crosses specialties all day, so teams that own an outcome move fastest; a matrix suits several products at once.",
  },
  {
    id: "commerce",
    name: "Retail and e-commerce",
    examples: "Online stores, consumer brands, shops, wholesalers.",
    departments: [
      g("head-of-marketing", ["merchandiser", "listings-writer", "paid-ads-specialist", "social-drafter", "designer"]),
      g("head-of-operations", ["inventory-coordinator", "procurement-manager"]),
      g("head-of-support", ["support-replier", "returns-specialist"]),
      g("head-of-finance", ["bookkeeper", "accounts-payable", "financial-controller"]),
    ],
    teams: [
      g("head-of-marketing", ["merchandiser", "listings-writer", "paid-ads-specialist", "social-drafter", "designer"], "Bring shoppers in"),
      g("head-of-operations", ["inventory-coordinator", "procurement-manager", "accounts-payable"], "Stock and ship"),
      g("head-of-support", ["support-replier", "returns-specialist"], "Look after customers"),
      g("head-of-finance", ["bookkeeper", "financial-controller"], "Margins and cash"),
    ],
    projects: [{ lead: "project-manager", over: ["designer", "listings-writer", "inventory-coordinator"] }],
    recommended: ["functional", "team"],
    why: "Marketing, stock, service and money are distinct crafts; outcome teams suit a brand that launches products often.",
  },
  {
    id: "hospitality",
    name: "Restaurants and hospitality",
    examples: "Restaurant groups, cafes, hotels, venues, salons.",
    departments: [
      g("head-of-operations", ["scheduling-coordinator", "food-safety-coordinator", "procurement-manager", "inventory-coordinator"]),
      g("head-of-people", ["recruiter", "payroll-administrator"]),
      g("head-of-marketing", ["social-drafter", "content-writer"]),
      g("head-of-support", ["reservations-coordinator"]),
      g("head-of-finance", ["menu-analyst", "bookkeeper", "accounts-payable"]),
      g("compliance-manager"),
    ],
    teams: [
      g("head-of-operations", ["scheduling-coordinator", "food-safety-coordinator", "procurement-manager", "inventory-coordinator"], "Run the floor"),
      g("head-of-people", ["recruiter", "payroll-administrator"], "Staff the business"),
      g("head-of-marketing", ["social-drafter", "content-writer", "reservations-coordinator"], "Fill the seats"),
      g("head-of-finance", ["menu-analyst", "bookkeeper", "accounts-payable", "compliance-manager"], "Money and licences"),
    ],
    projects: [{ lead: "project-manager", over: ["scheduling-coordinator", "social-drafter"] }],
    recommended: ["hierarchical", "functional"],
    why: "Shifts, suppliers and safety need a clear chain of command and consistency across locations.",
  },
  {
    id: "manufacturing",
    name: "Manufacturing and distribution",
    examples: "Makers, assemblers, food producers, distributors.",
    departments: [
      g("head-of-operations", ["production-planner", "quality-analyst", "safety-coordinator", "procurement-manager", "inventory-coordinator"]),
      g("head-of-sales", ["account-executive", "sales-operations"]),
      g("head-of-finance", ["financial-controller", "accounts-payable", "invoice-chaser"]),
      g("head-of-people", ["recruiter", "payroll-administrator"]),
      g("compliance-manager"),
    ],
    teams: [
      g("head-of-operations", ["production-planner", "quality-analyst", "safety-coordinator"], "Plan and make"),
      g("procurement-manager", ["inventory-coordinator", "accounts-payable"], "Supply chain"),
      g("head-of-sales", ["account-executive", "sales-operations", "invoice-chaser"], "Sell and collect"),
      g("head-of-finance", ["financial-controller", "payroll-administrator", "compliance-manager"], "Back office"),
    ],
    projects: [{ lead: "project-manager", over: ["procurement-manager", "account-executive", "financial-controller"] }],
    recommended: ["hierarchical", "functional"],
    why: "Production, quality and supply reward a clear chain of command and accountability.",
  },
];

export const DEFAULT_INDUSTRY = "general";
export const industryOf = (id: string | undefined): Industry => INDUSTRIES.find((i) => i.id === id) ?? INDUSTRIES[0];

/** One place on a chart: an agent, who it reports to, its project lead (a matrix's dotted line) and, where a structure renames them, its department. */
export interface Seat {
  bot: string;
  manager: string | null;
  also?: string;
  department?: string;
}

/**
 * The chart a structure draws for a kind of business. A lead is always listed
 * before its reports. Functional: each head reports to the person. Hierarchy:
 * a general manager above the heads (and a chief of staff beside it, as staff
 * to the person). Matrix: the hierarchy's tree with project leads on dotted
 * lines. Outcome teams: the industry's teams, each under its lead. Flat: one
 * specialist from each department, all reporting to the person. "Your own"
 * brings nobody in.
 */
export function seatsFor(structure: string, industry: Industry): Seat[] {
  const out: Seat[] = [];
  const place = (group: Group, manager: string | null, department?: string) => {
    out.push({ bot: group.lead, manager, ...(department ? { department } : {}) });
    for (const m of group.members) {
      if (typeof m === "string") out.push({ bot: m, manager: group.lead, ...(department ? { department } : {}) });
      else place(m, group.lead, department);
    }
  };
  if (structure === "functional") {
    for (const d of industry.departments) place(d, null);
  } else if (structure === "hierarchical" || structure === "matrix") {
    out.push({ bot: "general-manager", manager: null });
    if (structure === "hierarchical") out.push({ bot: "chief-of-staff", manager: null });
    for (const d of industry.departments) place(d, "general-manager");
    if (structure === "matrix") {
      for (const project of industry.projects) {
        // A project lead from outside the departments joins operations, or the general manager.
        if (!out.some((s) => s.bot === project.lead)) out.push({ bot: project.lead, manager: out.some((s) => s.bot === "head-of-operations") ? "head-of-operations" : "general-manager" });
        for (const bot of project.over) {
          const seat = out.find((s) => s.bot === bot);
          if (seat && seat.manager !== project.lead && seat.bot !== project.lead) seat.also = project.lead;
        }
      }
    }
  } else if (structure === "team") {
    for (const t of industry.teams) place(t, null, t.name);
  } else if (structure === "flat") {
    // A flat organization is small: one doer from each department and no managers.
    for (const d of industry.departments) out.push({ bot: typeof d.members[0] === "string" ? d.members[0] : d.lead, manager: null });
  }
  return out;
}
