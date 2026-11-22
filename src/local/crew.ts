// Finds the crew: starter bots that ship with the app, bots a project shares in
// its .crew/ folder, and the user's own bots. A later source replaces an earlier
// bot with the same file name: starter, then project, then personal.
import fs from "node:fs";
import path from "node:path";
import { parseBot } from "../core/index.ts";
import type { Bot, BotSource } from "../core/index.ts";
import { DATA, ROOT } from "./store.ts";

export const STARTER_DIR = path.join(ROOT, "crew");
export const personalDir = () => path.join(DATA, "crew");
export const projectDir = (project: string) => path.join(project, ".crew");

export interface CrewProblem {
  file: string;
  problem: string;
}

function readFolder(folder: string, source: BotSource, bots: Map<string, Bot>, problems: CrewProblem[]) {
  let names: string[];
  try {
    names = fs.readdirSync(folder).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch {
    return; // no such folder: nothing to add
  }
  for (const name of names) {
    const file = path.join(folder, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 50_000) throw new Error("not a small, ordinary file.");
      const bot = parseBot(name.replace(/\.ya?ml$/, ""), fs.readFileSync(file, "utf8"), source);
      bots.set(bot.id, bot);
    } catch (err) {
      problems.push({ file, problem: (err as Error).message });
    }
  }
}

export function loadCrew(project?: string): { bots: Bot[]; problems: CrewProblem[] } {
  const bots = new Map<string, Bot>();
  const problems: CrewProblem[] = [];
  readFolder(STARTER_DIR, "starter", bots, problems);
  if (project) readFolder(projectDir(project), "project", bots, problems);
  readFolder(personalDir(), "personal", bots, problems);
  return { bots: [...bots.values()], problems };
}

export function findBot(id: string, project?: string): Bot {
  const bot = loadCrew(project).bots.find((b) => b.id === id);
  if (!bot) throw new Error(`There is no bot called "${id}".`);
  return bot;
}
