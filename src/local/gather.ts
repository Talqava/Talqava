// What the app gathers before a core quest starts, so the bot works from facts
// and the check knows what the result must cover.
import { execFile } from "node:child_process";
import { getConfig } from "./store.ts";

export interface Gathered {
  /** Put into the quest's prompt. */
  text: string;
  /** Things the result must mention (commit ids, issue numbers…). */
  mustMention: string[];
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile("git", args, { cwd, maxBuffer: 5_000_000 }, (err, out) => resolve(err ? "" : out.trim())));
}

/** The commits since a tag, branch or commit; by default since the last tag, else the last 50. */
export async function gitLog(repo: string, since?: string): Promise<Gathered & { since: string }> {
  const from = since?.trim() || (await git(repo, ["describe", "--tags", "--abbrev=0"]));
  if (from && !(await git(repo, ["rev-parse", "--verify", "--quiet", `${from}^{commit}`]))) {
    throw new Error(`"${from}" is not a tag, branch or commit in this repository.`);
  }
  const range = from ? [`${from}..HEAD`] : ["-n", "50"];
  const log = await git(repo, ["log", "--no-merges", "--pretty=format:%h %s", ...range]);
  const lines = log ? log.split("\n") : [];
  return {
    since: from || "the start of the history (no tags yet)",
    text: lines.length ? `Commits:\n${lines.map((l) => `- ${l}`).join("\n")}` : "There are no new commits.",
    mustMention: lines.map((l) => l.split(" ")[0]),
  };
}

/** owner/name from the repository's GitHub remote, if it has one. */
export async function githubSlug(repo?: string): Promise<string | null> {
  if (!repo) return null;
  const url = await git(repo, ["remote", "get-url", "origin"]);
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}

const API = () => process.env.TALQAVA_GITHUB_API || "https://api.github.com";

/** A GitHub API call, with the user's GITHUB_TOKEN secret when they stored one for api.github.com. */
async function github(pathname: string): Promise<any> {
  const secret = getConfig().secrets.GITHUB_TOKEN;
  const base = new URL(API());
  const token = secret && (base.hostname === secret.host || base.hostname.endsWith(`.${secret.host}`)) ? secret.value : "";
  const res = await fetch(new URL(pathname, base), {
    headers: { accept: "application/vnd.github+json", "user-agent": "talqava-agents", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) throw new Error("GitHub could not find that repository. If it is private, add a GITHUB_TOKEN key for api.github.com under Connections → API keys.");
  if (res.status === 401 || res.status === 403) throw new Error("GitHub refused the request. Check the GITHUB_TOKEN key under Connections → API keys, or wait if the rate limit was reached.");
  if (!res.ok) throw new Error(`GitHub returned an error (${res.status}).`);
  return res.json();
}

const checkSlug = (slug: string) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error("Give the GitHub repository as owner/name, or choose a repository with a GitHub remote.");
};

export async function githubIssues(slug: string): Promise<Gathered> {
  checkSlug(slug);
  const items = (await github(`/repos/${slug}/issues?state=open&per_page=50`)) as any[];
  const issues = items.filter((i) => !i.pull_request);
  const text = issues.length
    ? `Open issues (${issues.length}${items.length === 50 ? ", the 50 most recent" : ""}):\n` +
      issues.map((i) => `- #${i.number} ${i.title} (opened ${String(i.created_at).slice(0, 10)}, ${i.comments} comments, labels: ${i.labels.map((l: any) => l.name).join(", ") || "none"})\n  ${String(i.body ?? "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
    : "There are no open issues.";
  return { text, mustMention: issues.map((i) => `#${i.number}`) };
}

export async function githubReport(slug: string, staleDays: number): Promise<Gathered> {
  checkSlug(slug);
  const [pulls, runs] = await Promise.all([github(`/repos/${slug}/pulls?state=open&per_page=50`), github(`/repos/${slug}/actions/runs?per_page=30`)]);
  const cutoff = Date.now() - staleDays * 86_400_000;
  const stale = (pulls as any[]).filter((p) => new Date(p.updated_at).getTime() < cutoff);
  // The latest run of each workflow, where it failed.
  const latest = new Map<string, any>();
  for (const run of (runs?.workflow_runs ?? []) as any[]) if (!latest.has(run.name)) latest.set(run.name, run);
  const failing = [...latest.values()].filter((r) => r.conclusion === "failure");
  const text =
    `Failing builds (latest run of each workflow):\n${failing.length ? failing.map((r) => `- ${r.name} on ${r.head_branch}: failed ${String(r.updated_at).slice(0, 10)} (run ${r.id})`).join("\n") : "- none"}\n\n` +
    `Pull requests with no activity for ${staleDays} days or more:\n${stale.length ? stale.map((p) => `- #${p.number} ${p.title} by ${p.user?.login} (last activity ${String(p.updated_at).slice(0, 10)}, review requested from: ${(p.requested_reviewers ?? []).map((r: any) => r.login).join(", ") || "nobody"})`).join("\n") : "- none"}`;
  return { text, mustMention: [...failing.map((r) => r.name), ...stale.map((p) => `#${p.number}`)] };
}
