// Integrations: the outside tools an organization's agents work with. Each
// one has a category, a status the person can read at a glance, and its own
// set-up. Git is the first: repositories on this computer that agents may
// work on, each task in its own branch and working copy, with GitHub
// (issues, pull requests) read through a stored token.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import os from "node:os";
import { DATA, getConfig, saveConfig } from "./store.ts";
import { loadCrew } from "./crew.ts";
import { questStore } from "./quests.ts";

export interface IntegrationInfo {
  id: string;
  name: string;
  category: string;
  summary: string;
  /** "connected" once it can be used, "needs-setup" when a step is missing, "unavailable" when it cannot work on this computer. */
  state: "connected" | "needs-setup" | "unavailable";
  /** One line on where it stands. */
  status: string;
}

/** The categories integrations are filed under, in the order they are shown. */
export const INTEGRATION_CATEGORIES = ["AI models", "Code and repositories", "AI apps and connectors", "Other services"];

const run = (cwd: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; out: string; err: string }> =>
  new Promise((resolve) => {
    execFile("git", ["-c", "core.quotepath=off", ...args], { cwd, maxBuffer: 5_000_000, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || err?.message || "").trim() }),
    );
  });

/** owner/name for a GitHub remote, or null for any other kind. */
const githubSlugOf = (remote: string) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote)?.[1] ?? null;

export interface RepoInfo {
  path: string;
  name: string;
  /** False when the folder has gone or is no longer a repository. */
  found: boolean;
  branch: string;
  lastCommit: { subject: string; when: string; author: string } | null;
  /** Files changed but not committed in the person's own working copy. */
  uncommitted: number;
  remote: string;
  github: string | null;
  /** Branches made by agents' tasks that are still there (kept or awaiting review). */
  taskBranches: number;
  /** Tasks working in this repository right now. */
  activeTasks: number;
}

async function repoInfo(folder: string): Promise<RepoInfo> {
  const base: RepoInfo = { path: folder, name: path.basename(folder), found: false, branch: "", lastCommit: null, uncommitted: 0, remote: "", github: null, taskBranches: 0, activeTasks: 0 };
  if (!fs.existsSync(folder) || !(await run(folder, ["rev-parse", "--show-toplevel"])).ok) return base;
  const [branch, log, status, remote, branches] = await Promise.all([
    run(folder, ["rev-parse", "--abbrev-ref", "HEAD"]),
    run(folder, ["log", "-1", "--format=%s%x1f%cI%x1f%an"]),
    run(folder, ["status", "--porcelain"]),
    run(folder, ["remote", "get-url", "origin"]),
    run(folder, ["branch", "--list", "talqava/*", "--format=%(refname:short)"]),
  ]);
  const [subject, when, author] = log.ok && log.out ? log.out.split("\x1f") : [];
  return {
    ...base,
    found: true,
    branch: branch.ok ? branch.out : "(no commits yet)",
    lastCommit: subject ? { subject, when, author } : null,
    uncommitted: status.ok && status.out ? status.out.split("\n").length : 0,
    remote: remote.ok ? remote.out.replace(/\/\/[^@/]+@/, "//") : "",
    github: remote.ok ? githubSlugOf(remote.out) : null,
    taskBranches: branches.ok && branches.out ? branches.out.split("\n").length : 0,
    activeTasks: questStore.list().filter((q) => q.project === folder && (q.status === "running" || q.status === "waiting")).length,
  };
}

/** Everything the Git integration page shows. */
export async function gitIntegration() {
  const cfg = getConfig();
  const version = await run(DATA, ["--version"]);
  const installed = version.ok;
  const [name, email] = installed ? await Promise.all([run(DATA, ["config", "--global", "user.name"]), run(DATA, ["config", "--global", "user.email"])]) : [];
  const repos = installed ? await Promise.all(cfg.projects.map(repoInfo)) : [];
  const token = cfg.secrets.GITHUB_TOKEN;
  const coders = loadCrew().bots.filter((b) => b.powers.includes("files") || b.powers.includes("shell")).map((b) => ({ id: b.id, name: b.name }));
  const info: IntegrationInfo = {
    id: "git",
    name: "Git",
    category: "Code and repositories",
    summary: "Let agents work on your code and documents in git repositories. Every task gets its own branch and working copy, and nothing reaches your branches until you keep it.",
    state: !installed ? "unavailable" : repos.some((r) => r.found) ? "connected" : "needs-setup",
    status: !installed ? "Git is not installed on this computer" : repos.length ? `${repos.filter((r) => r.found).length} repositor${repos.filter((r) => r.found).length === 1 ? "y" : "ies"} connected${token ? " · GitHub token saved" : ""}` : "No repository connected yet",
  };
  return {
    ...info,
    installed,
    version: installed ? version.out.replace(/^git version /, "") : "",
    identity: { name: name?.ok ? name.out : "", email: email?.ok ? email.out : "" },
    github: { tokenSaved: Boolean(token), host: token?.host ?? "api.github.com", clientId: githubClientId(), canSignIn: Boolean(githubClientId()) },
    repos,
    cloneFolder: path.join(DATA, "repos"),
    // Repositories this app copied itself, which it may also delete when they are disconnected.
    copies: repos.filter((r) => r.path.startsWith(path.join(DATA, "repos") + path.sep)).map((r) => r.path),
    coders,
  };
}

/** The list for the Integrations page: one line per integration. */
export async function listIntegrations(): Promise<{ categories: string[]; integrations: IntegrationInfo[] }> {
  const git = await gitIntegration();
  const { mcpIntegration } = await import("./mcpintegration.ts");
  const mcp = mcpIntegration();
  const { openrouterIntegration } = await import("./openrouter.ts");
  const openrouter = await openrouterIntegration({ withAccount: false });
  const line = (i: IntegrationInfo): IntegrationInfo => ({ id: i.id, name: i.name, category: i.category, summary: i.summary, state: i.state, status: i.status });
  const { gatewayState } = await import("./gateway.ts");
  const gateway = await gatewayState({ live: false });
  const connected = gateway.connected.filter((c) => !c.standard);
  const using = connected.find((c) => c.inUse);
  const aiModels: IntegrationInfo = {
    id: "ai-models",
    name: "AI models",
    category: "AI models",
    summary: "Connect the AI services your agents think with: Claude, OpenAI, Google Gemini, Mistral, DeepSeek, Azure, a LiteLLM gateway and more than 20 others, or free models on this computer. Pick one, paste its key, done. Choose backup models for when a service is down.",
    state: connected.length ? "connected" : "needs-setup",
    status: connected.length ? `${connected.length} connected${using ? ` · your team uses ${using.name}` : ""}` : "Connect an AI service to get started",
  };
  const cfg = getConfig();
  const keys = Object.keys(cfg.secrets);
  const apiKeys: IntegrationInfo = {
    id: "api-keys",
    name: "API keys for other services",
    category: "Other services",
    summary: "Keys for any other service your agents call, such as a weather, shipping or accounting service. Each key is only ever sent to its own address, and agents use it by name without ever seeing it.",
    state: keys.length ? "connected" : "needs-setup",
    status: keys.length ? `${keys.length} key${keys.length === 1 ? "" : "s"} saved` : "No keys saved",
  };
  const { langfuseIntegration } = await import("./langfuse.ts");
  return { categories: INTEGRATION_CATEGORIES, integrations: [aiModels, line(openrouter), line(git), line(mcp), apiKeys, line(langfuseIntegration())] };
}

/**
 * Clones a repository from a web address into the app's own repos folder and
 * returns where it landed. Only https and ssh addresses are taken, and the
 * address is passed to git as an argument, never through a shell. A private
 * repository needs this computer to be signed in to its host already: git is
 * not allowed to stop and ask for a password.
 */
export async function cloneRepository(address: unknown): Promise<string> {
  const url = String(address ?? "").trim();
  if (!/^(https:\/\/[\w.-]+\/[\w./~-]+|git@[\w.-]+:[\w./~-]+)$/.test(url) || url.includes("..")) throw new Error("Give the repository's web address, such as https://github.com/your-name/your-repository.");
  const name = (url.replace(/\.git$/, "").split(/[/:]/).pop() || "repository").replace(/[^\w.-]/g, "-").slice(0, 60);
  const home = path.join(DATA, "repos");
  fs.mkdirSync(home, { recursive: true });
  let target = path.join(home, name);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(home, `${name}-${n}`);
  // For GitHub, the saved token signs the copy in, so a private repository works. It is passed for this one command only and is not written into the copy.
  const secret = getConfig().secrets.GITHUB_TOKEN;
  const signIn = secret && /^https:\/\/github\.com\//.test(url) ? ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${secret.value}`).toString("base64")}`] : [];
  const result = await run(home, [...signIn, "clone", "--", url, target], 180_000);
  if (!result.ok) {
    fs.rmSync(target, { recursive: true, force: true });
    const why = /Authentication failed|could not read Username|Permission denied|terminal prompts disabled/i.test(result.err)
      ? "This computer is not signed in to that host, or the repository is private. Sign in to it with git on this computer first (for GitHub, the GitHub Desktop app or `gh auth login` does this), then try again."
      : /not found|does not exist/i.test(result.err)
        ? "No repository was found at that address. Check the address, and that you have access to it."
        : result.err.split("\n").pop() || "Git could not copy it.";
    throw new Error(`Could not copy the repository. ${why}`);
  }
  return target;
}

/** Checks the saved GitHub token by asking GitHub who it belongs to. */
export async function testGithub(): Promise<{ login: string }> {
  const secret = getConfig().secrets.GITHUB_TOKEN;
  if (!secret) throw new Error("No GitHub token is saved yet.");
  const base = process.env.TALQAVA_GITHUB_API || "https://api.github.com";
  const host = new URL(base).hostname;
  if (!(host === secret.host || host.endsWith(`.${secret.host}`))) throw new Error(`The saved token is for ${secret.host}, not GitHub.`);
  const res = await fetch(`${base}/user`, { headers: { accept: "application/vnd.github+json", "user-agent": "talqava-agents", authorization: `Bearer ${secret.value}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) throw new Error("GitHub could not be reached. Check the internet connection.");
  if (res.status === 401) throw new Error("GitHub did not accept the token. It may have expired or been revoked.");
  if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}).`);
  const data = (await res.json()) as { login?: string };
  return { login: String(data.login ?? "") };
}

// ---------- one-click set-up ----------

/** Runs a program that may live where the desktop app's own PATH does not look (Homebrew). */
const tool = (name: string, args: string[], timeout = 10_000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    const PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].filter(Boolean).join(path.delimiter);
    execFile(name, args, { timeout, env: { ...process.env, PATH, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout) => resolve({ ok: !err, out: String(stdout).trim() }));
  });

const SKIP = new Set(["node_modules", "Library", "Applications", "Pictures", "Music", "Movies", "Public", "vendor", "dist", "build", "target", "venv"]);

/**
 * Looks for git repositories in the places people keep them: the home folder
 * and the usual project folders, a few levels down. Only folder names are
 * read; nothing is opened or changed. Repositories already connected, and the
 * app's own working copies, are left out.
 */
export function findRepositories(limit = 40): { path: string; name: string }[] {
  const home = os.homedir();
  const connected = new Set(getConfig().projects);
  const found: string[] = [];
  let looked = 0;
  const visit = (folder: string, depth: number) => {
    if (found.length >= limit || looked++ > 6000) return;
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return; // a folder this app may not read
    }
    if (names.some((n) => n.name === ".git")) {
      if (!connected.has(folder) && !folder.startsWith(DATA)) found.push(folder);
      return; // a repository's own subfolders are not searched
    }
    if (depth <= 0) return;
    for (const n of names) if (n.isDirectory() && !n.name.startsWith(".") && !SKIP.has(n.name)) visit(path.join(folder, n.name), depth - 1);
  };
  for (const root of ["Projects", "projects", "Developer", "dev", "code", "Code", "src", "GitHub", "github", "repos", "workspace", "Sites", "Documents", "Desktop"]) visit(path.join(home, root), 3);
  visit(home, 1);
  return [...new Set(found)].map((p) => ({ path: p, name: path.basename(p) })).sort((a, b) => a.name.localeCompare(b.name));
}

const githubApi = () => process.env.TALQAVA_GITHUB_API || "https://api.github.com";
async function github<T>(route: string, token: string): Promise<T | null> {
  const res = await fetch(`${githubApi()}${route}`, { headers: { accept: "application/vnd.github+json", "user-agent": "talqava-agents", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

export interface SetupStep {
  /** done: ready. action: the person has one thing to do. skipped: optional, and not available. */
  state: "done" | "action" | "skipped";
  title: string;
  detail: string;
}

/**
 * Reports where Git stands, in plain words: git is installed, GitHub is
 * connected (the person does that through GitHub's website), and the name
 * commits are made under (set from the GitHub account if git has none). With
 * `scan`, it also looks for repositories in the usual folders on this
 * computer; it never does that unasked, and never connects one by itself.
 */
export async function autoSetupGit(scan = false) {
  const steps: SetupStep[] = [];
  const version = await run(DATA, ["--version"]);
  if (!version.ok) {
    steps.push({ state: "action", title: "Git is not installed", detail: process.platform === "darwin" ? "Press Install Git below. macOS opens its own installer window: click Install there, wait for it to finish, then run this set-up again." : "Install Git from git-scm.com, then run this set-up again." });
    return { steps, needsInstall: true, canInstall: process.platform === "darwin", local: [], login: "" };
  }
  steps.push({ state: "done", title: "Git is installed", detail: `Version ${version.out.replace(/^git version /, "")}.` });

  // GitHub is connected by the person, through GitHub's own website (see startGithubSignIn). Set-up only reports where it stands.
  const token = getConfig().secrets.GITHUB_TOKEN?.value ?? "";
  const user = token ? await github<{ login: string; name: string | null; id: number }>("/user", token) : null;
  steps.push(
    user
      ? { state: "done", title: `Connected to GitHub as ${user.login}`, detail: "Choose which account's repositories to bring in under GitHub below: your own, or a company you belong to." }
      : token
        ? { state: "action", title: "GitHub no longer accepts the saved sign-in", detail: "It may have expired or been revoked. Disconnect GitHub below and connect again." }
        : { state: "action", title: "Connect GitHub", detail: "Press Connect GitHub below. You sign in on github.com in your browser and choose what this app may see. Repositories that are only on this computer work without it." },
  );

  // The name commits are made under, if git has none.
  const [name, email] = await Promise.all([run(DATA, ["config", "--global", "user.name"]), run(DATA, ["config", "--global", "user.email"])]);
  if (name.out && email.out) steps.push({ state: "done", title: "Your name is set for commits", detail: `${name.out} <${email.out}>.` });
  else if (user) {
    const setName = name.out || user.name || user.login;
    const setEmail = email.out || `${user.id}+${user.login}@users.noreply.github.com`;
    if (!name.out) await run(DATA, ["config", "--global", "user.name", setName]);
    if (!email.out) await run(DATA, ["config", "--global", "user.email", setEmail]);
    steps.push({ state: "done", title: "Set your name for commits", detail: `Git had none, so it now uses ${setName} <${setEmail}>, from your GitHub account.` });
  } else steps.push({ state: "action", title: "Git has no name for you yet", detail: "Changes you keep are recorded under a name. Connect GitHub and run this again to set it automatically." });

  // Folders on this computer are only looked through when the person asks for that.
  const local = scan ? findRepositories() : [];
  const connected = getConfig().projects;
  steps.push(
    connected.length
      ? { state: "done", title: `${connected.length} repositor${connected.length === 1 ? "y is" : "ies are"} connected`, detail: "Add more from GitHub at any time." }
      : user
        ? { state: "action", title: "Choose your repositories", detail: "Pick the account or company under GitHub below, and tick the repositories to bring in." }
        : { state: "action", title: "No repository connected yet", detail: "Connect GitHub first, then choose which repositories to bring in." },
  );
  return { steps, needsInstall: false, canInstall: false, local, login: user?.login ?? "" };
}

/** Starts the operating system's own installer for git. On a Mac this opens Apple's window for the command line tools, which the person confirms. */
export async function installGit(): Promise<{ message: string }> {
  if (process.platform !== "darwin") throw new Error("Install Git from git-scm.com on this kind of computer.");
  await tool("xcode-select", ["--install"], 15_000);
  return { message: "macOS has opened its installer window. Click Install there and wait for it to finish (a few minutes), then press Set up Git for me again." };
}

// ---------- signing in to GitHub through the web ----------
// GitHub's device sign-in: the app shows a short code, the person types it on
// github.com in their browser and approves, and GitHub hands this app a token.
// No password is ever typed into this app. It needs the Client ID of a GitHub
// app registered for it (set once, under the GitHub section), with "device
// flow" switched on.

export const githubClientId = () => (process.env.TALQAVA_GITHUB_CLIENT_ID || getConfig().githubClientId || "").trim();
const githubWeb = () => process.env.TALQAVA_GITHUB_WEB || "https://github.com";

/** The sign-in under way: kept here, never sent to the page. */
let pending: { deviceCode: string; expires: number; interval: number } | null = null;

const form = async (url: string, fields: Record<string, string>) => {
  const res = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "talqava-agents" }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res) throw new Error("GitHub could not be reached. Check the internet connection.");
  return (await res.json().catch(() => ({}))) as Record<string, string | number | undefined>;
};

/** Starts a sign-in: returns the code to type and the page to type it on. */
export async function startGithubSignIn(): Promise<{ code: string; url: string; interval: number; expiresIn: number }> {
  const clientId = githubClientId();
  if (!clientId) throw new Error("Signing in through GitHub needs a one-time set-up first: see “One-click sign-in” in the GitHub section. Until then, connect with a token.");
  const data = await form(`${githubWeb()}/login/device/code`, { client_id: clientId, scope: "repo read:user read:org" });
  if (!data.device_code || !data.user_code) throw new Error(data.error === "device_flow_disabled" ? "The GitHub app has device sign-in switched off. Switch on “Enable Device Flow” in the app's settings on GitHub." : `GitHub did not start the sign-in${data.error_description ? `: ${data.error_description}` : ". Check the Client ID."}`);
  pending = { deviceCode: String(data.device_code), expires: Date.now() + Number(data.expires_in ?? 900) * 1000, interval: Number(data.interval ?? 5) };
  return { code: String(data.user_code), url: String(data.verification_uri ?? `${githubWeb()}/login/device`), interval: pending.interval, expiresIn: Number(data.expires_in ?? 900) };
}

/** Asks GitHub whether the person has approved yet. When they have, the token is saved and their name returned. */
export async function pollGithubSignIn(): Promise<{ done: boolean; login?: string; wait?: number }> {
  if (!pending) throw new Error("No sign-in is under way. Press Connect GitHub to start one.");
  if (Date.now() > pending.expires) {
    pending = null;
    throw new Error("The code ran out before it was approved. Press Connect GitHub to get a new one.");
  }
  const data = await form(`${githubWeb()}/login/oauth/access_token`, { client_id: githubClientId(), device_code: pending.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (data.access_token) {
    pending = null;
    saveConfig({ secrets: { ...getConfig().secrets, GITHUB_TOKEN: { value: String(data.access_token), host: "api.github.com" } } });
    const user = await github<{ login: string }>("/user", String(data.access_token));
    return { done: true, login: user?.login ?? "" };
  }
  if (data.error === "authorization_pending") return { done: false, wait: pending.interval };
  if (data.error === "slow_down") return { done: false, wait: (pending.interval += 5) };
  pending = null;
  throw new Error(data.error === "access_denied" ? "The sign-in was cancelled on GitHub." : data.error === "expired_token" ? "The code ran out before it was approved. Press Connect GitHub to get a new one." : `GitHub did not complete the sign-in${data.error_description ? `: ${data.error_description}` : "."}`);
}

/**
 * Disconnects a repository. A copy this app made itself (in its repos folder)
 * may be deleted with it; a folder the person connected is never touched.
 */
export function disconnectRepository(folder: unknown, deleteCopy = false): { deleted: boolean } {
  const target = String(folder ?? "");
  const cfg = getConfig();
  if (!cfg.projects.includes(target)) throw new Error("That repository is not connected.");
  if (questStore.list().some((q) => q.project === target && (q.status === "running" || q.status === "waiting"))) throw new Error("An agent is working in that repository right now. Stop its task first.");
  saveConfig({ projects: cfg.projects.filter((p) => p !== target) });
  const home = path.join(DATA, "repos") + path.sep;
  if (deleteCopy && target.startsWith(home) && !target.slice(home.length).includes(path.sep) && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    return { deleted: true };
  }
  return { deleted: false };
}

// ---------- choosing repositories from GitHub, by account ----------

interface GithubRepo {
  full_name: string;
  private: boolean;
  clone_url: string;
  description: string | null;
  pushed_at: string;
}

/** Follows GitHub's pages of results, up to a few hundred items. */
async function githubAll<T>(route: string, token: string, pages = 3): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 1; page <= pages; page++) {
    const chunk = await github<T[]>(`${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
    if (!chunk) return page === 1 ? null : out;
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

const savedToken = () => {
  const token = getConfig().secrets.GITHUB_TOKEN?.value;
  if (!token) throw new Error("GitHub is not connected yet. Press Connect GitHub first.");
  return token;
};

/** The accounts whose repositories can be brought in: the person's own, and each company (organization) GitHub lets this sign-in see. */
export async function githubAccounts(): Promise<{ login: string; accounts: { login: string; kind: "personal" | "company"; description: string }[] }> {
  const token = savedToken();
  const user = await github<{ login: string }>("/user", token);
  if (!user) throw new Error("GitHub did not accept the saved sign-in. Disconnect GitHub and connect again.");
  const orgs = (await githubAll<{ login: string; description: string | null }>("/user/orgs", token)) ?? [];
  return { login: user.login, accounts: [{ login: user.login, kind: "personal", description: "Your own repositories" }, ...orgs.map((o) => ({ login: o.login, kind: "company" as const, description: o.description ?? "A company you belong to" }))] };
}

/** The repositories of one account that are not connected yet, most recently changed first. */
export async function githubRepos(account: unknown) {
  const token = savedToken();
  const name = String(account ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,39}$/.test(name)) throw new Error("Choose an account first.");
  const user = await github<{ login: string }>("/user", token);
  const mine = user?.login.toLowerCase() === name.toLowerCase();
  const listed = await githubAll<GithubRepo>(mine ? "/user/repos?affiliation=owner&sort=pushed" : `/orgs/${name}/repos?sort=pushed`, token);
  if (!listed) throw new Error(`GitHub would not list the repositories of ${name}. The company may need to allow this app first: see “My company is not listed” below.`);
  const connected = new Set((await Promise.all(getConfig().projects.map(async (p) => githubSlugOf((await run(p, ["remote", "get-url", "origin"])).out)))).filter(Boolean));
  return {
    account: name,
    repos: listed.map((r) => ({ name: r.full_name, private: r.private, url: r.clone_url, description: r.description ?? "", pushedAt: r.pushed_at, connected: connected.has(r.full_name) })),
  };
}

/**
 * Removes the Git integration: every repository is disconnected and the
 * GitHub sign-in is forgotten. Folders on this computer are left exactly as
 * they are; only the copies this app made itself are deleted, and only when
 * asked. Refused while an agent is working in one of the repositories.
 */
export function removeGitIntegration(deleteCopies = false): { repositories: number; deleted: number } {
  const cfg = getConfig();
  if (questStore.list().some((q) => q.project && cfg.projects.includes(q.project) && (q.status === "running" || q.status === "waiting"))) throw new Error("An agent is working in one of the repositories right now. Stop its task first.");
  const home = path.join(DATA, "repos") + path.sep;
  let deleted = 0;
  if (deleteCopies) {
    for (const p of cfg.projects) {
      if (p.startsWith(home) && !p.slice(home.length).includes(path.sep) && fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        deleted++;
      }
    }
  }
  const secrets = { ...cfg.secrets };
  delete secrets.GITHUB_TOKEN;
  pending = null;
  saveConfig({ projects: [], secrets });
  return { repositories: cfg.projects.length, deleted };
}
