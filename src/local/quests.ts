// Quests: a bot sent to do one job. The runner starts them, keeps several going
// at once, writes every step to a journal on disk, and picks interrupted quests
// back up when the app starts again. Quests on code get their own branch.
import fs from "node:fs";
import path from "node:path";
import type { Bot, Engine, RunEvent } from "../core/index.ts";
import { DATA, conversations, readJson, writeJson } from "./store.ts";
import { acceptCopy, changes, prepareCopy, undoCopy } from "./git.ts";
import type { Changes, QuestCopy } from "./git.ts";

export type QuestStatus = "running" | "waiting" | "done" | "stopped" | "failed" | "budget";

export interface Quest {
  /** The same id as the quest's conversation. */
  id: string;
  title: string;
  /** The bot as it was when the quest started, so a later edit to its file cannot change a quest under way. */
  bot: Bot;
  status: QuestStatus;
  /** The repository the quest works on, if any. */
  project?: string;
  copy?: QuestCopy;
  /** What became of the quest's changes. */
  outcome?: "accepted" | "undone" | "no-changes";
  steps: number;
  resumedAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** Quests that may run at the same time. */
export const MAX_RUNNING = 6;

const QUEST_DIR = () => path.join(DATA, "quests");
const JOURNAL_DIR = () => path.join(DATA, "journals");
export const WORKTREE_DIR = () => path.join(DATA, "worktrees");
const questFile = (id: string) => {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error("Bad quest id");
  return path.join(QUEST_DIR(), `${id}.json`);
};
const journalFile = (id: string) => path.join(JOURNAL_DIR(), `${id}.jsonl`);

export class QuestStore {
  get(id: string): Quest | null {
    try {
      return readJson<Quest | null>(questFile(id), null);
    } catch {
      return null;
    }
  }

  save(quest: Quest) {
    fs.mkdirSync(QUEST_DIR(), { recursive: true });
    quest.updatedAt = new Date().toISOString();
    writeJson(questFile(quest.id), quest);
  }

  list(): Quest[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(QUEST_DIR()).filter((name) => name.endsWith(".json"));
    } catch {}
    return names
      .map((name) => this.get(name.replace(/\.json$/, "")))
      .filter((q): q is Quest => Boolean(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  remove(id: string) {
    fs.rmSync(questFile(id), { force: true });
    fs.rmSync(journalFile(id), { force: true });
  }
}

/** Every step of a quest, one JSON line each, written as it happens. */
export const journal = {
  append(id: string, event: RunEvent | { type: string; [key: string]: unknown }) {
    fs.mkdirSync(JOURNAL_DIR(), { recursive: true });
    fs.appendFileSync(journalFile(id), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  },
  read(id: string): ({ at: string; type: string } & Record<string, any>)[] {
    let text = "";
    try {
      text = fs.readFileSync(journalFile(id), "utf8");
    } catch {
      return [];
    }
    // A line cut off by a crash is skipped; everything before it is kept.
    return text.split("\n").flatMap((line) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
  },
  /** Tool calls that had started, so a resumed quest does not repeat them blindly. */
  started(id: string): Set<string> {
    return new Set(this.read(id).filter((e) => e.type === "tool_start").map((e) => String(e.id)));
  },
};

export const questStore = new QuestStore();

export class QuestRunner {
  #engine!: Engine;
  /** Why each running quest will end, learned from its events. */
  #ending = new Map<string, QuestStatus>();
  #stopping = new Set<string>();

  attach(engine: Engine) {
    this.#engine = engine;
  }

  running(): Quest[] {
    return questStore.list().filter((q) => q.status === "running" || q.status === "waiting");
  }

  async start({ bot, text, project }: { bot: Bot; text: string; project?: string }): Promise<Quest> {
    if (this.running().length >= MAX_RUNNING) throw new Error(`${MAX_RUNNING} quests are already under way. Wait for one to finish, or stop one.`);
    const conversation = await conversations.create({ title: text.replace(/\s+/g, " ").slice(0, 80), source: "quest" });
    const now = new Date().toISOString();
    const quest: Quest = { id: conversation.id, title: conversation.title, bot, status: "running", steps: 0, createdAt: now, updatedAt: now };
    if (project) {
      quest.project = project;
      // Only bots that can change files get a branch and working copy of their own.
      if (bot.powers.some((p) => p === "files" || p === "shell")) quest.copy = await prepareCopy(project, quest.id, WORKTREE_DIR());
    }
    questStore.save(quest);
    journal.append(quest.id, { type: "quest_start", bot: bot.id, title: quest.title, project: project ?? null, branch: quest.copy?.branch ?? null });
    try {
      await this.#engine.startRun(quest.id, text, { keepTitle: true });
    } catch (err) {
      this.#set(quest.id, { status: "failed", note: (err as Error).message });
      throw err;
    }
    return questStore.get(quest.id)!;
  }

  stop(id: string) {
    this.#stopping.add(id);
    this.#engine.stop(id);
  }

  /** Called by the engine for every event: keeps the journal and the quest's status. */
  onEvent(id: string, event: RunEvent) {
    const quest = questStore.get(id);
    if (!quest) return;
    journal.append(id, event);
    switch (event.type) {
      case "status":
        if (event.running) {
          this.#ending.delete(id);
          this.#stopping.delete(id);
          this.#set(id, { status: "running" });
        } else {
          const status = this.#stopping.has(id) ? "stopped" : (this.#ending.get(id) ?? "done");
          this.#ending.delete(id);
          this.#stopping.delete(id);
          this.#set(id, { status });
        }
        break;
      case "approval":
        this.#set(id, { status: "waiting" });
        break;
      case "approval_done":
        if (quest.status === "waiting") this.#set(id, { status: "running" });
        break;
      case "assistant":
        this.#set(id, { steps: quest.steps + 1 });
        break;
      case "notice":
        if (event.text.startsWith("Stopped at its budget")) this.#ending.set(id, "budget");
        break;
      case "error":
        this.#ending.set(id, "failed");
        this.#set(id, { note: event.text });
        break;
      case "resumed":
        this.#set(id, { resumedAt: new Date().toISOString() });
        break;
    }
  }

  #set(id: string, patch: Partial<Quest>) {
    const quest = questStore.get(id);
    if (quest) questStore.save({ ...quest, ...patch });
  }

  /** At start-up: picks up every quest that was under way when the app last closed. */
  async resumeAll(): Promise<string[]> {
    const resumed: string[] = [];
    for (const quest of this.running()) {
      try {
        const run = await this.#engine.resumeRun(quest.id, journal.started(quest.id));
        if (run) resumed.push(quest.id);
        else this.#set(quest.id, { status: "done" });
      } catch (err) {
        this.#set(quest.id, { status: "failed", note: `Could not resume: ${(err as Error).message}` });
      }
    }
    return resumed;
  }

  #closable(id: string): Quest & { copy: QuestCopy } {
    const quest = questStore.get(id);
    if (!quest) throw new Error("Quest not found.");
    if (!quest.copy) throw new Error("This quest did not work on a repository, so there are no changes to review.");
    if (quest.outcome) throw new Error("This quest's changes were already dealt with.");
    if (quest.status === "running" || quest.status === "waiting") throw new Error("The quest is still under way. Stop it or wait for it to finish first.");
    return quest as Quest & { copy: QuestCopy };
  }

  async changes(id: string): Promise<Changes> {
    const quest = questStore.get(id);
    if (!quest?.copy || quest.outcome) return { files: [], diff: "", truncated: false };
    return changes(quest.copy);
  }

  /** Keeps the quest's changes as a commit on its own branch. */
  async accept(id: string): Promise<{ branch: string | null }> {
    const quest = this.#closable(id);
    const branch = await acceptCopy(quest.copy, `${quest.title}\n\nQuest by ${quest.bot.name} (${quest.bot.type}) in Talqava Agents.`);
    this.#set(id, { outcome: branch ? "accepted" : "no-changes" });
    journal.append(id, { type: "quest_accept", branch });
    return { branch };
  }

  /** Throws away everything the quest changed. */
  async undo(id: string) {
    const quest = this.#closable(id);
    await undoCopy(quest.copy);
    this.#set(id, { outcome: "undone" });
    journal.append(id, { type: "quest_undo" });
  }
}

export const quests = new QuestRunner();
