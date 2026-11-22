// Bots as files. A bot is a small YAML file: who it is, what it may do, which
// model it uses and how much it may spend. Starter bots ship with the app,
// a project shares bots in its .crew/ folder, and each person can keep their own.
import { parse } from "yaml";
import type { ApprovalMode, Budget } from "./types.ts";

/** What a bot is allowed to do. Each power grants one or more tools. */
export const POWERS = ["web", "files", "shell", "memory", "skills", "search", "api", "schedule", "browser", "connectors"] as const;
export type Power = (typeof POWERS)[number];

export const HATS = ["explorer", "beret", "hardhat", "nightcap", "visor", "flame", "none"] as const;
export type Hat = (typeof HATS)[number];

export type BotSource = "starter" | "project" | "personal";

export interface Bot {
  /** The file name without .yaml, e.g. "pip". */
  id: string;
  name: string;
  /** scout, scribe, maker, keeper, counter, spark, or a type of one's own. */
  type: string;
  character: { hat: Hat; colour: string };
  instructions: string;
  /** "provider/model", or undefined to use the default model in Settings. */
  model?: string;
  powers: Power[];
  approvals: ApprovalMode;
  budget?: Budget;
  source: BotSource;
}

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
  const instructions = typeof data.instructions === "string" ? data.instructions.trim() : "";
  if (!instructions) throw problem("needs instructions: what this bot does and how.");

  const character = isRecord(data.character) ? data.character : {};
  const hat = (character.hat ?? "none") as Hat;
  if (!HATS.includes(hat)) throw problem(`hat must be one of ${HATS.join(", ")}.`);
  const colour = typeof character.colour === "string" ? character.colour : "#5cc8ff";
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw problem("colour must look like #5cc8ff.");

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

  return { id, name, type, character: { hat, colour }, instructions, model, powers: [...new Set(powers as Power[])], approvals, budget, source };
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

/** What the bot is told about its role, added after the shared system prompt. */
export function botPrompt(bot: Bot): string {
  return [
    "# Your role",
    `You are ${bot.name}, the ${bot.type} in the user's crew of agents, sent on a quest. ${bot.instructions}`,
    "You only have the tools listed for you. If the quest needs something you cannot do, say so plainly and suggest which kind of bot could do it. When the quest is done, end with a short report: what you did, how you checked it, and anything that needs the user.",
  ].join("\n\n");
}
