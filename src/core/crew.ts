// Bots as files. A bot is a small YAML file: who it is, what it may do, which
// model it uses and how much it may spend. Starter bots ship with the app,
// a project shares bots in its .crew/ folder, and each person can keep their own.
import { parse } from "yaml";
import type { ApprovalMode, Budget } from "./types.ts";

/** What a bot is allowed to do. Each power grants one or more tools. */
export const POWERS = ["web", "files", "shell", "memory", "skills", "search", "api", "schedule", "browser", "connectors"] as const;
export type Power = (typeof POWERS)[number];

/** The legend printed on each starter type's key. A bot's own legend replaces it. */
export const LEGENDS: Record<string, string> = { scout: "?", scribe: "Aa", maker: "</>", keeper: "zz", counter: "#", spark: "!" };

/** The legend a bot gets when its file names none: its type's, else its name's first letter. */
export function defaultLegend(type: string, name: string): string {
  return LEGENDS[type] ?? ([...name.trim()][0] ?? "?").toUpperCase();
}

/** Textures for the base of a key: in black and white, they are what tells two keys apart. */
export const TEXTURES = ["dots", "lines", "hatch", "solid", "grid", "zigzag", "plain"] as const;
export type Texture = (typeof TEXTURES)[number];
const TYPE_TEXTURES: Record<string, Texture> = { scout: "dots", scribe: "lines", maker: "hatch", keeper: "solid", counter: "grid", spark: "zigzag" };
export const defaultTexture = (type: string): Texture => TYPE_TEXTURES[type] ?? "plain";

/** Neon colours a bot's key glows in. The window draws each one (see public/app.ts). */
export const COLORS = ["green", "cyan", "magenta", "lime", "amber", "violet", "pink", "yellow", "mint"] as const;
export type Color = (typeof COLORS)[number];
const TYPE_COLORS: Record<string, Color> = { scout: "cyan", scribe: "violet", maker: "lime", keeper: "mint", counter: "yellow", spark: "magenta" };
/** A starter type's colour; any other type gets one picked from its name, so it stays the same. */
export function defaultColor(type: string, name: string): Color {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  let sum = 0;
  for (const ch of name) sum = (sum * 31 + ch.codePointAt(0)!) >>> 0;
  return COLORS[sum % COLORS.length];
}

/**
 * What makes one bot look unlike another, beyond its legend, texture and
 * colour: the shape of its body, its eyes, and what it wears on top. A bot
 * file can choose each; otherwise they are picked from its name, so every bot
 * looks like itself and stays that way.
 */
export const SHAPES = ["key", "round", "tall", "wide", "soft"] as const;
export const EYES = ["dots", "wide", "sleepy", "visor", "specs"] as const;
export const TOPS = ["none", "antenna", "ears", "horns", "tuft", "halo"] as const;
/** The white symbol on an agent's tile; "auto" picks it from the role. Names match SYMBOLS in public/app.ts. */
export const SYMBOLS = ["auto", "flag", "chart", "ledger", "receipt", "code", "shield", "pen", "megaphone", "envelope", "target", "chat", "people", "scales", "search", "check", "layers", "calendar", "flow", "initials"] as const;
/** The colour of an agent's cursor block; "auto" takes its department's. Names match TINTS in public/app.ts. */
export const TINTS = ["auto", "executive", "finance", "sales", "marketing", "operations", "technology", "people", "legal", "customers", "research", "product", "neutral"] as const;
export type Symbol = (typeof SYMBOLS)[number];
export type Tint = (typeof TINTS)[number];
export type Shape = (typeof SHAPES)[number];
export type Eyes = (typeof EYES)[number];
export type Top = (typeof TOPS)[number];
const hashOf = (text: string) => {
  let sum = 7;
  for (const ch of text) sum = (sum * 31 + ch.codePointAt(0)!) >>> 0;
  return sum;
};
export const defaultLooks = (id: string): { shape: Shape; eyes: Eyes; top: Top } => {
  const n = hashOf(id);
  return { shape: SHAPES[n % SHAPES.length], eyes: EYES[(n >>> 4) % EYES.length], top: TOPS[(n >>> 9) % TOPS.length] };
};

/** One to three visible characters, no spaces. */
export function isLegend(text: string): boolean {
  const chars = [...text];
  return chars.length >= 1 && chars.length <= 3 && /^[^\s\p{C}]+$/u.test(text);
}

export type BotSource = "starter" | "project" | "personal";

export interface Bot {
  /** The file name without .yaml, e.g. "pip". */
  id: string;
  name: string;
  /** scout, scribe, maker, keeper, counter, spark, or a type of one's own. */
  type: string;
  /** Its job title, e.g. "Head of Sales". A file that names none gets its type, capitalised. */
  title: string;
  /** How the bot looks: a keycap with this legend printed on it and this texture on its base. */
  character: { legend: string; texture: Texture; color: Color; shape: Shape; eyes: Eyes; top: Top; symbol?: Symbol; tint?: Tint };
  instructions: string;
  /** "provider/model", or undefined to use the default model in Settings. */
  model?: string;
  powers: Power[];
  approvals: ApprovalMode;
  budget?: Budget;
  /** The most this bot may spend in a calendar month, in US dollars. None means no monthly limit of its own. */
  monthly?: number;
  /** Whether this role leads others: a head, a lead, a manager with reports. Used when a chart is drawn. */
  lead: boolean;
  /** How the role is held to account: what it is measured on, what it decides itself, and what it must take to its lead or the owner. */
  governance: { kpis: string[]; decides: string[]; escalates: string[] };
  /** The team group it is shown under, such as Research or Writing. */
  group: string;
  source: BotSource;
}

/** The group a bot is shown under when its file names none. */
const TYPE_GROUPS: Record<string, string> = { scout: "Research", scribe: "Writing", maker: "Engineering", keeper: "Operations", counter: "Finance", spark: "Strategy" };
export const defaultGroup = (type: string): string => TYPE_GROUPS[type] ?? "Other";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Reads one bot file. Throws a plain-words error naming what is wrong. */
export function parseBot(id: string, text: string, source: BotSource): Bot {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(`"${id}" is not a usable bot file name. Use lowercase letters, digits and dashes.`);
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    throw new Error(`${id}.yaml is not valid YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  if (!isRecord(data)) throw new Error(`${id}.yaml should describe a bot with a name, a type and instructions.`);
  const problem = (what: string) => new Error(`${id}.yaml: ${what}`);

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > 40) throw problem("needs a name of up to 40 characters.");
  const type = typeof data.type === "string" ? data.type.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9-]{0,29}$/.test(type)) throw problem("needs a type, such as scout or maker.");
  const titleText = typeof data.title === "string" ? data.title.replace(/\s+/g, " ").trim().slice(0, 50) : "";
  const title = titleText || `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const instructions = typeof data.instructions === "string" ? data.instructions.trim() : "";
  if (!instructions) throw problem("needs instructions: what this bot does and how.");

  const character = isRecord(data.character) ? data.character : {};
  // Bot files from before the keycaps may still name a hat; it is ignored.
  const legend = character.legend === undefined || character.legend === null ? defaultLegend(type, name) : String(character.legend);
  if (!isLegend(legend)) throw problem("legend is one to three characters printed on the key, such as ? or </>.");
  // Files from before black and white may name a colour (or a hat); both are ignored.
  const texture = (character.texture ?? defaultTexture(type)) as Texture;
  if (!TEXTURES.includes(texture)) throw problem(`texture must be one of ${TEXTURES.join(", ")}.`);
  // A colour that is not one of the neon names (such as an old hex code) falls back to the default.
  const color = COLORS.includes(character.color as Color) ? (character.color as Color) : defaultColor(type, name);
  const looks = defaultLooks(id);
  const shape = SHAPES.includes(character.shape as Shape) ? (character.shape as Shape) : looks.shape;
  const eyes = EYES.includes(character.eyes as Eyes) ? (character.eyes as Eyes) : looks.eyes;
  const top = TOPS.includes(character.top as Top) ? (character.top as Top) : looks.top;
  const symbol = SYMBOLS.includes(character.symbol as Symbol) && character.symbol !== "auto" ? (character.symbol as Symbol) : undefined;
  const tint = TINTS.includes(character.tint as Tint) && character.tint !== "auto" ? (character.tint as Tint) : undefined;

  const powers = Array.isArray(data.powers) ? data.powers : [];
  for (const power of powers) {
    if (!POWERS.includes(power)) throw problem(`unknown power "${power}". Powers are ${POWERS.join(", ")}.`);
  }

  let model: string | undefined;
  if (data.model !== undefined && data.model !== null && data.model !== "default") {
    if (typeof data.model !== "string" || !/^[a-z0-9-]+\/[\w.:@/+-]{1,120}$/.test(data.model)) {
      throw problem('model should be "default" or provider/model, e.g. local/llama3.1 or anthropic/claude-sonnet-5-5.');
    }
    model = data.model;
  }

  // "ask-before-changes" is the friendly spelling of "ask".
  const approvalsText = data.approvals ?? "ask-before-changes";
  const approvals: ApprovalMode | null =
    approvalsText === "ask" || approvalsText === "ask-before-changes" ? "ask" : approvalsText === "auto" || approvalsText === "run-everything" ? "auto" : null;
  if (!approvals) throw problem("approvals should be ask-before-changes or run-everything.");

  let budget: Budget | undefined;
  if (data.budget !== undefined && data.budget !== null) {
    if (!isRecord(data.budget)) throw problem("budget should look like { steps: 40, spend: 0.50 }.");
    const steps = data.budget.steps;
    const spend = data.budget.spend;
    if (steps !== undefined && !(Number.isInteger(steps) && (steps as number) >= 1 && (steps as number) <= 500)) throw problem("budget steps is a whole number from 1 to 500.");
    if (spend !== undefined && !(typeof spend === "number" && spend >= 0 && spend <= 100)) throw problem("budget spend is in dollars, from 0 to 100.");
    budget = { ...(steps !== undefined ? { steps: steps as number } : {}), ...(spend !== undefined ? { spend: spend as number } : {}) };
  }

  let monthly: number | undefined;
  if (data.monthly_budget !== undefined && data.monthly_budget !== null) {
    if (!(typeof data.monthly_budget === "number" && data.monthly_budget >= 0 && data.monthly_budget <= 10_000)) throw problem("monthly_budget is in dollars a month, from 0 to 10000.");
    monthly = data.monthly_budget;
  }
  const group = typeof data.group === "string" && data.group.trim() ? data.group.replace(/\s+/g, " ").trim().slice(0, 30) : defaultGroup(type);

  const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => String(v).replace(/\s+/g, " ").trim().slice(0, 140)).filter(Boolean).slice(0, 6) : []);
  const rules = isRecord(data.governance) ? data.governance : {};
  const governance = { kpis: list(rules.kpis), decides: list(rules.decides), escalates: list(rules.escalates) };
  const lead = data.lead === true;

  return { id, name, type, title, lead, governance, character: { legend, texture, color, shape, eyes, top, ...(symbol ? { symbol } : {}), ...(tint ? { tint } : {}) }, instructions, model, powers: [...new Set(powers as Power[])], approvals, budget, ...(monthly !== undefined ? { monthly } : {}), group, source };
}

/**
 * Bots a repository supplies can be edited by anyone with access to it, so they
 * never get more than the user's own settings allow: no "run everything"
 * unless the user chose it, and no bigger budget than the user's.
 */
export function limitProjectBot(bot: Bot, user: { approvalMode: ApprovalMode; budget: Budget }): Bot {
  if (bot.source !== "project") return bot;
  const cap = (mine: number | undefined, theirs: number | undefined) => (mine === undefined ? theirs : theirs === undefined ? mine : Math.min(mine, theirs));
  return {
    ...bot,
    approvals: user.approvalMode === "auto" ? bot.approvals : "ask",
    budget: { steps: cap(user.budget.steps, bot.budget?.steps), spend: cap(user.budget.spend, bot.budget?.spend) },
  };
}

/** A role's targets and decision rights, as told to the agent. Empty when its file gives none. */
function governancePrompt(bot: Bot): string[] {
  const g = bot.governance;
  if (!g.kpis.length && !g.decides.length && !g.escalates.length) return [];
  return [
    [
      "# What you answer for",
      g.kpis.length ? `You are measured on: ${g.kpis.join("; ")}.` : "",
      g.decides.length ? `You decide yourself: ${g.decides.join("; ")}. Decide, say what you decided and why, and move on.` : "",
      g.escalates.length ? `You must take to your lead (or to the owner, if you report to them) before acting: ${g.escalates.join("; ")}. Give the options and your recommendation.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ];
}

/** What the bot is told about its role, added after the shared system prompt. */
export function botPrompt(bot: Bot): string {
  return [
    "# Your role",
    `You are ${bot.name === bot.title ? `the ${bot.title}` : `${bot.name}, the ${bot.title},`} in the user's organization, and you have been given a task. ${bot.instructions}`,
    ...governancePrompt(bot),
    "You only have the tools listed for you. If the task needs something you cannot do, say so plainly and suggest which role could do it. When the task is done, end with a short report: what you did, how you checked it, and anything that needs the user.",
    "Every step costs the owner money. If you are missing something the task cannot start without (a file, a repository, access, a decision), stop at once and ask the owner for it in one short message: do not hand out side work, search around or ask colleagues in the meantime. Do the task that was asked, not a larger one. Look something up once, not three ways. Keep reports short.",
  ].join("\n\n");
}
