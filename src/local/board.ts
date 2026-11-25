// The task board: one shared board for a task and everything handed on from it. The agents working on it post
// short, typed notes (a finding, a decision, a question, a blocker, a hand-over) so that siblings see each other's
// progress instead of only reporting when they finish. Every agent on the task sees the latest notes when it starts,
// can read and post while it works, and the owner sees the board on the task.
import crypto from "node:crypto";
import { defineTool } from "../core/index.ts";
import type { Tool } from "../core/index.ts";
import { openOrgDb } from "./library.ts";
import type { Org } from "./orgs.ts";
import { orgs } from "./orgs.ts";
import { questStore, rootOf } from "./quests.ts";
import { loadCrew } from "./crew.ts";

export const BOARD_KINDS = ["finding", "decision", "question", "blocker", "handover", "note"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
const KIND_WORDS: Record<BoardKind, string> = { finding: "Finding", decision: "Decision", question: "Question", blocker: "Blocker", handover: "Hand-over", note: "Note" };

export interface BoardPost {
  id: string;
  /** The task tree it belongs to: the id of the first task's run. */
  root: string;
  /** Who wrote it: an agent's id, or "owner". */
  author: string;
  authorName: string;
  kind: BoardKind;
  text: string;
  at: string;
}

/** Most posts one task tree keeps: enough for a big task, few enough to read at a glance. */
export const MAX_POSTS = 60;

function db(orgId: string) {
  const d = openOrgDb(orgId);
  d.exec("create table if not exists task_board (id text primary key, root text not null, author text not null, kind text not null, text text not null, at text not null)");
  d.exec("create index if not exists task_board_root on task_board (root, at)");
  return d;
}

function nameOf(org: Org, author: string) {
  if (author === "owner") return "You";
  const member = org.members.find((m) => m.bot === author);
  return member?.title ?? loadCrew().bots.find((b) => b.id === author)?.name ?? author;
}

export const board = {
  /** Posts one note to a task tree's board. */
  post(org: Org, root: string, author: string, kind: unknown, text: unknown): BoardPost {
    const k = BOARD_KINDS.includes(kind as BoardKind) ? (kind as BoardKind) : "note";
    const said = String(text ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 1200);
    if (said.length < 3) throw new Error("Write the note: one or two sentences.");
    const d = db(org.id);
    const count = (d.prepare("select count(*) n from task_board where root = ?").get(root) as { n: number }).n;
    if (count >= MAX_POSTS) throw new Error(`This task's board is full (${MAX_POSTS} notes). Put what matters in your report instead.`);
    const post: BoardPost = { id: crypto.randomBytes(8).toString("hex"), root, author, authorName: nameOf(org, author), kind: k, text: said, at: new Date().toISOString() };
    d.prepare("insert into task_board (id, root, author, kind, text, at) values (?, ?, ?, ?, ?, ?)").run(post.id, root, author, k, said, post.at);
    return post;
  },

  /** A task tree's notes, oldest first (the newest `limit` of them). */
  list(org: Org, root: string, limit = MAX_POSTS): BoardPost[] {
    const rows = db(org.id).prepare("select id, root, author, kind, text, at from task_board where root = ? order by at desc limit ?").all(root, limit) as unknown as Omit<BoardPost, "authorName">[];
    return rows.reverse().map((r) => ({ ...r, kind: r.kind as BoardKind, authorName: nameOf(org, r.author) }));
  },
};

/** The board as text for an agent: the newest notes, each with who wrote it and what kind it is. */
export function boardText(posts: BoardPost[]): string {
  return posts.map((p) => `- ${KIND_WORDS[p.kind]} from ${p.authorName === "You" ? "the owner" : `the ${p.authorName}`}: ${p.text.replace(/\n+/g, " ")}`).join("\n");
}

/** What an agent on a task is told about its board when its run starts, or "" when the board is empty. */
export function boardPrompt(org: Org, questId: string): string {
  const quest = questStore.get(questId);
  if (!quest) return "";
  const posts = board.list(org, rootOf(quest), 15);
  const intro =
    "This task has a shared board for everyone working on it and the parts handed on from it. Use the board tool to post a short finding, decision, question or blocker when others on the task should know it now, not only in your final report, and read the board before repeating work someone may have done.";
  return posts.length ? `${intro}\n\nThe board so far (newest last):\n${boardText(posts)}` : intro;
}

/** The board tool, for an agent working on a task. */
export const boardTool: Tool = defineTool<{ action: "read" | "post"; kind?: string; text?: string }>({
  name: "board",
  description:
    "The shared board of the task you are working on: everyone on this task and the parts handed on from it can see it, and so can the owner. " +
    '"read" shows the notes so far. "post" adds one short note (one or two sentences) of a kind: finding (something others should know), decision (what you decided and why), question (something you need answered by someone on the task), blocker (what stops you), or note. ' +
    "Post only what others on the task need now; your full results still go in your report.",
  properties: {
    action: { type: "string", enum: ["read", "post"] },
    kind: { type: "string", enum: ["finding", "decision", "question", "blocker", "note"] },
    text: { type: "string", description: "For post: the note, one or two sentences." },
  },
  required: ["action"],
  run(input, { conversation }) {
    const quest = questStore.get(conversation.id);
    if (!quest) throw new Error("The board belongs to a task; this conversation is not one.");
    const org = orgs.active();
    const root = rootOf(quest);
    if (input.action === "post") {
      const post = board.post(org, root, quest.bot.id, input.kind === "handover" ? "note" : input.kind, input.text);
      return `Posted to the task's board as a ${KIND_WORDS[post.kind].toLowerCase()}.`;
    }
    const posts = board.list(org, root);
    return posts.length ? boardText(posts) : "The board is empty so far.";
  },
});
