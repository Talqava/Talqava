// A branch and a separate working copy for each quest that may change code,
// so the user's own working copy and branches are never touched. Accepting
// keeps the quest's branch with one commit; undoing removes every trace.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

export interface QuestCopy {
  /** The user's repository. */
  repo: string;
  /** The quest's own working copy. */
  worktree: string;
  branch: string;
  /** The commit the quest started from. */
  base: string;
}

const MAX_DIFF = 400_000;

function git(cwd: string, args: string[], { allowFail = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "core.quotepath=off", ...args], { cwd, maxBuffer: 20_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      if (err && !allowFail) reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** The top folder of the repository at this path, or null if it is not one. */
export async function repoRoot(folder: string): Promise<string | null> {
  if (!fs.existsSync(folder)) return null;
  const top = (await git(folder, ["rev-parse", "--show-toplevel"], { allowFail: true })).trim();
  return top || null;
}

export async function currentBranch(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true })).trim() || "(no commits yet)";
}

/** Makes the quest's branch and working copy, starting from the repository's last commit. */
export async function prepareCopy(repo: string, questId: string, home: string): Promise<QuestCopy> {
  const base = (await git(repo, ["rev-parse", "HEAD"], { allowFail: true })).trim();
  if (!base) throw new Error("This repository has no commits yet. Make a first commit, then send the quest again.");
  const branch = `talqava/quest-${questId.slice(0, 8)}`;
  const worktree = path.join(home, questId);
  fs.mkdirSync(home, { recursive: true });
  await git(repo, ["worktree", "add", "-b", branch, worktree, base]);
  return { repo, worktree, branch, base };
}

export interface Changes {
  files: { path: string; added: number; removed: number }[];
  diff: string;
  truncated: boolean;
}

/** Everything the quest changed since it started, new files included. */
export async function changes(copy: QuestCopy): Promise<Changes> {
  if (!fs.existsSync(copy.worktree)) return { files: [], diff: "", truncated: false };
  // The quest's working copy has its own index, so staging there touches nothing of the user's.
  await git(copy.worktree, ["add", "-A"]);
  const numstat = await git(copy.worktree, ["diff", "--cached", "--numstat", copy.base]);
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split("\t");
      return { path: rest.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    });
  const diff = await git(copy.worktree, ["diff", "--cached", copy.base]);
  return { files, diff: diff.slice(0, MAX_DIFF), truncated: diff.length > MAX_DIFF };
}

async function removeCopy(copy: QuestCopy) {
  if (fs.existsSync(copy.worktree)) await git(copy.repo, ["worktree", "remove", "--force", copy.worktree]);
  await git(copy.repo, ["worktree", "prune"], { allowFail: true });
}

/** Keeps the changes as one commit on the quest's branch and removes the working copy. Returns null when nothing changed. */
export async function acceptCopy(copy: QuestCopy, message: string): Promise<string | null> {
  const { files } = await changes(copy);
  if (!files.length) {
    await undoCopy(copy);
    return null;
  }
  // Use the user's own name for the commit when git knows it.
  const named = (await git(copy.worktree, ["config", "user.email"], { allowFail: true })).trim();
  const identity = named ? [] : ["-c", "user.name=Talqava Agents", "-c", "user.email=talqava@localhost"];
  await git(copy.worktree, [...identity, "commit", "-q", "-m", message]);
  await removeCopy(copy);
  return copy.branch;
}

/** Removes the quest's working copy and branch, as if the quest had never changed anything. */
export async function undoCopy(copy: QuestCopy) {
  await removeCopy(copy);
  await git(copy.repo, ["branch", "-D", copy.branch], { allowFail: true });
}
