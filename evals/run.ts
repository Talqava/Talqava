// The quest test suite: the core quests on fixed tasks with known good
// outcomes, run against one model. A release that scores worse than the saved
// baseline for that model does not ship.
//
//   node evals/run.ts --model local/qwen3:8b
//   node evals/run.ts --model anthropic/claude-sonnet-5-5 --save
//
// Options:
//   --model <provider/model>  the model to test (default: the one in Settings)
//   --suite office            the office tasks in evals/office instead of the core quests:
//                             each has an answer key, gets one try, and its cost is recorded
//   --runs <n>                run each task this many times (default 1)
//   --budget <dollars>        stop when the run has cost this much
//   --quests a,b              only these quests
//   --web                     also run research, which needs the internet
//   --save                    save this result as the new baseline
//   --minutes <n>             time allowed per quest (default 15)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const flag = (name: string) => args.includes(`--${name}`);
const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINES = process.env.TALQAVA_EVAL_BASELINES || path.join(ROOT, "evals", "baselines");

// ---------- fixtures: a small repository and a stand-in GitHub ----------
function fixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-eval-repo-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "eval@example.com");
  git("config", "user.name", "Eval");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  write("package.json", JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test" } }, null, 2));
  write(
    "src/slug.mjs",
    `// Turns a title into a URL slug.\nexport function slug(title) {\n  if (typeof title !== "string") throw new TypeError("title must be a string");\n  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\n}\n`,
  );
  git("add", ".");
  git("commit", "-q", "-m", "Add slug()");
  git("tag", "v1.0.0");
  write("src/words.mjs", `export const words = (text) => text.split(/\\s+/).filter(Boolean).length;\n`);
  git("add", ".");
  git("commit", "-q", "-m", "Count words in a text");
  write("README.md", "# fixture\n\nSlugs and word counts.\n");
  git("add", ".");
  git("commit", "-q", "-m", "Explain what the package does");
  return repo;
}

function fakeGitHub(): Promise<http.Server> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const routes: Record<string, unknown> = {
    "/repos/acme/fixture/issues": [
      { number: 4, title: "slug() crashes on emoji", created_at: daysAgo(9), comments: 3, labels: [], body: "slug('🙂 hi') throws." },
      { number: 7, title: "Support Cyrillic titles", created_at: daysAgo(6), comments: 1, labels: [], body: "Slugs drop all letters." },
      { number: 9, title: "How do I count characters?", created_at: daysAgo(2), comments: 0, labels: [], body: "Is there a function?" },
      { number: 11, title: "Typo in README", created_at: daysAgo(1), comments: 0, labels: [], body: "'pacakge'" },
      { number: 15, title: "Bump dependencies", created_at: daysAgo(1), comments: 0, labels: [], body: "", pull_request: {} },
    ],
    "/repos/acme/fixture/pulls": [
      { number: 15, title: "Bump dependencies", user: { login: "bot" }, updated_at: daysAgo(1), requested_reviewers: [] },
      { number: 8, title: "Add a CLI", user: { login: "sam" }, updated_at: daysAgo(12), requested_reviewers: [{ login: "lee" }] },
    ],
    "/repos/acme/fixture/actions/runs": {
      workflow_runs: [
        { id: 501, name: "tests", head_branch: "main", conclusion: "failure", updated_at: daysAgo(0) },
        { id: 500, name: "tests", head_branch: "main", conclusion: "success", updated_at: daysAgo(1) },
        { id: 499, name: "lint", head_branch: "main", conclusion: "success", updated_at: daysAgo(0) },
      ],
    },
  };
  const server = http.createServer((req, res) => {
    const route = Object.keys(routes).find((r) => req.url?.split("?")[0] === r);
    res.writeHead(route ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(route ? routes[route] : { message: "Not Found" }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---------- the tasks ----------
interface Task {
  template: string;
  bot: string;
  inputs: Record<string, string>;
  repo?: boolean;
  web?: boolean;
}
const OFFICE_DIR = path.join(ROOT, "evals", "office");
const TASKS: Task[] = [
  { template: "changelog", bot: "margo", inputs: {}, repo: true },
  { template: "add-tests", bot: "rivet", inputs: { file: "src/slug.mjs", command: "node --test" }, repo: true },
  { template: "triage", bot: "tally", inputs: { repo: "acme/fixture" } },
  { template: "morning-report", bot: "dusk", inputs: { repo: "acme/fixture", days: "7" } },
  { template: "research", bot: "pip", inputs: { question: "What are the trade-offs between SQLite and PostgreSQL for a small web app?" }, web: true },
];

async function main() {
  const github = await fakeGitHub();
  process.env.TALQAVA_GITHUB_API = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-eval-data-"));
  const settingsFrom = process.env.TALQAVA_EVAL_SETTINGS; // a config.json to copy providers and keys from

  const store = await import("../src/local/store.ts");
  store.initStore();
  if (settingsFrom && fs.existsSync(settingsFrom)) {
    const theirs = JSON.parse(fs.readFileSync(settingsFrom, "utf8"));
    store.saveConfig({ apiKey: theirs.apiKey ?? "", providers: theirs.providers ?? store.getConfig().providers });
  }
  const model = option("model") ?? store.getConfig().model;
  const repo = fixtureRepo();
  store.saveConfig({ model, projects: [repo], approvalMode: "auto", budget: { steps: 40 } });
  await import("../src/local/server.ts"); // wires the engine and the quest runner, without starting the web server
  const { quests, questStore } = await import("../src/local/quests.ts");
  const { findTemplate, loadTemplatesFrom } = await import("../src/local/templates.ts");
  const { loadCrew } = await import("../src/local/crew.ts");
  const { resolveModel } = await import("../src/local/models.ts");
  const label = resolveModel(store.getConfig(), model).label;

  const only = option("quests")?.split(",");
  const office = option("suite") === "office";
  const officeTemplates = office ? loadTemplatesFrom(OFFICE_DIR) : [];
  const all: Task[] = office ? officeTemplates.map((t) => ({ template: t.id, bot: t.bot, inputs: {} })) : TASKS;
  const runs = Math.max(1, Math.round(Number(option("runs") ?? 1)) || 1);
  const budget = Number(option("budget") ?? 0) || 0;
  const tasks = all.filter((t) => (!only || only.includes(t.template)) && (!t.web || flag("web"))).flatMap((t) => Array.from({ length: runs }, () => t));
  const minutes = Number(option("minutes") ?? 15);
  console.log(`${office ? "Office task suite" : "Quest test suite"} · ${label} · ${tasks.length / runs} ${office ? "tasks" : "quests"}${runs > 1 ? ` × ${runs} runs` : ""}\n`);

  const results = [];
  let spent = 0;
  for (const task of tasks) {
    if (budget && spent >= budget) {
      console.log(`Stopped: the run has cost $${spent.toFixed(2)}, which reaches the budget of $${budget.toFixed(2)}.`);
      break;
    }
    const template = office ? officeTemplates.find((t) => t.id === task.template)! : findTemplate(task.template);
    // The starter bot, on the model under test, allowed to work without asking (this is a sandbox).
    const starter = loadCrew(repo).bots.find((b) => b.id === task.bot)!;
    const bot = { ...starter, model, approvals: "auto" as const, budget: { steps: 40 } };
    const started = Date.now();
    let outcome: { passed: boolean; tries: number; steps: number; cost: number; detail: string };
    try {
      // An office task gets one try: a second try after a failed answer key would not be a fair measure.
      const quest = await quests.startTemplate({ template, bot, given: task.inputs, project: task.repo ? repo : undefined, maxTries: office ? 0 : 2 });
      let q = questStore.get(quest.id)!;
      while (Date.now() - started < minutes * 60_000) {
        q = questStore.get(quest.id)!;
        const finished = !q.checking && (q.status !== "running" && q.status !== "waiting") && (q.check ? q.check.passed || q.template!.tries >= q.template!.maxTries : q.status !== "done");
        if (finished) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const conversation = store.conversations.get(quest.id);
      const failed = q.check?.items.filter((i) => !i.passed).map((i) => `${i.label}${i.detail ? ` (${i.detail.split("\n")[0]})` : ""}`) ?? [];
      outcome = {
        passed: Boolean(q.check?.passed),
        tries: q.template?.tries ?? 0,
        steps: q.steps,
        cost: conversation?.usage.cost ?? 0,
        detail: q.check ? (q.check.passed ? "checked" : failed.join("; ")) : `ended ${q.status}${q.note ? `: ${q.note}` : ""}`,
      };
      // Leave the fixture repository as it was for the next task.
      if (q.copy && !q.outcome) await quests.undo(quest.id).catch(() => {});
    } catch (err) {
      outcome = { passed: false, tries: 0, steps: 0, cost: 0, detail: `could not start: ${(err as Error).message}` };
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    spent += outcome.cost;
    results.push({ quest: task.template, ...outcome, seconds });
    console.log(`${outcome.passed ? "✓" : "✕"} ${template.name.padEnd(office ? 42 : 22)} ${outcome.passed ? (outcome.tries ? `passed after ${outcome.tries} fix${outcome.tries === 1 ? "" : "es"}` : "passed first time") : outcome.detail}  · ${outcome.steps} steps · ${seconds}s${office ? ` · $${outcome.cost.toFixed(4)}` : ""}`);
  }

  // A quest passed first time scores 1; after fixes, a little less; not at all, 0.
  const score = results.reduce((n, r) => n + (r.passed ? 1 - 0.15 * r.tries : 0), 0);
  const cost = Math.round(results.reduce((n, r) => n + r.cost, 0) * 10000) / 10000;
  const result = { model, label, suite: office ? "office" : "core", runs, score: Math.round(score * 100) / 100, out_of: results.length, cost, at: new Date().toISOString(), results };
  const baselineFile = path.join(BASELINES, `${model.replace(/[^a-z0-9.-]+/gi, "_")}${office ? ".office" : ""}.json`);
  const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : null;
  console.log(`\nScore: ${result.score} of ${result.out_of}${baseline ? ` (baseline ${baseline.score} of ${baseline.out_of}, ${baseline.at.slice(0, 10)})` : " (no baseline yet)"}${office ? ` · cost $${cost.toFixed(4)}` : ""}`);
  if (process.env.TALQAVA_EVAL_JSON) fs.writeFileSync(process.env.TALQAVA_EVAL_JSON, JSON.stringify(result, null, 2));
  if (flag("save")) {
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.writeFileSync(baselineFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Saved as the baseline for ${model}.`);
  }
  github.close();
  const worse = baseline && baseline.out_of === result.out_of && result.score < baseline.score;
  if (worse) console.log("Worse than the baseline: this release should not ship.");
  process.exit(worse ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
