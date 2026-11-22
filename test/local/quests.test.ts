// Stage 2 is done when three bots run at once, one survives an app restart
// mid-quest, and one change is undone cleanly. These tests check each.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { startMockApi, say, call } from "../mock-api.ts";
import type { Reply } from "../mock-api.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastUserText = (body: any): string => {
  const last = body.messages.at(-1);
  return typeof last.content === "string" ? last.content : "";
};

// Replies chosen by what each quest asked, so quests can run side by side.
let inFlight = 0;
let mostAtOnce = 0;
async function reply(body: any): Promise<Reply> {
  inFlight++;
  mostAtOnce = Math.max(mostAtOnce, inFlight);
  try {
    await sleep(250); // long enough for the three quests to overlap
    const asked = lastUserText(body);
    if (asked.startsWith("make hello")) return call("str_replace_based_edit_tool", { command: "create", path: "hello.txt", file_text: "hello\n" });
    if (asked === "slow quest") return call("bash", { command: "sleep 20" });
    const last = body.messages.at(-1);
    if (Array.isArray(last.content) && last.content[0]?.type === "tool_result" && /may have partly happened/.test(JSON.stringify(last.content))) return say("Recovered after the restart.");
    return say(`Done: ${asked || "the tool ran"}`);
  } finally {
    inFlight--;
  }
}

let mock: Awaited<ReturnType<typeof startMockApi>>;
let store: typeof import("../../src/local/store.ts");
let app: typeof import("../../src/local/server.ts");
let runner: typeof import("../../src/local/quests.ts");
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

before(async () => {
  mock = await startMockApi(reply);
  process.env.TALQAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-quests-"));
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "test-key";
  store = await import("../../src/local/store.ts");
  app = await import("../../src/local/server.ts");
  runner = await import("../../src/local/quests.ts");
  store.initStore();

  // A personal bot that may change files without asking, for the code quests.
  fs.mkdirSync(path.join(store.DATA, "crew"), { recursive: true });
  fs.writeFileSync(
    path.join(store.DATA, "crew", "fixer.yaml"),
    "name: Fixer\ntype: maker\ncharacter: { hat: hardhat, colour: '#ff9f45' }\ninstructions: Fix things.\npowers: [files, shell]\napprovals: run-everything\n",
  );

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  store.saveConfig({ projects: [repo] });
});
after(() => mock.server.close());

const crew = () => import("../../src/local/crew.ts").then((m) => m.loadCrew());
const waitFor = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(25);
  }
};

test("three bots run at once, each in its own quest with its own journal", async () => {
  const { bots } = await crew();
  const pick = (id: string) => bots.find((b) => b.id === id)!;
  const started = await Promise.all(
    ["pip", "margo", "ember"].map((id) => runner.quests.start({ bot: pick(id), text: `quest for ${id}` })),
  );
  assert.ok(started.every((q) => app.engine.isRunning(q.id)));
  await waitFor(() => started.every((q) => runner.questStore.get(q.id)!.status === "done"));
  assert.equal(mostAtOnce, 3);
  for (const q of started) {
    const quest = runner.questStore.get(q.id)!;
    assert.equal(quest.steps, 1);
    const kinds = runner.journal.read(q.id).map((e) => e.type);
    assert.deepEqual(kinds.slice(0, 2), ["quest_start", "user"]);
    assert.ok(kinds.includes("assistant"));
  }
  // Each quest ran as its own bot.
  const system = mock.requests.filter((r) => /quest for ember/.test(JSON.stringify(r.body.messages))).at(-1)!.body.system;
  assert.match(JSON.stringify(system), /You are Ember, the spark/);
});

test("a bot only gets the tools its powers grant", async () => {
  const pip = (await crew()).bots.find((b) => b.id === "pip")!;
  const quest = await runner.quests.start({ bot: pip, text: "quest for tools" });
  await waitFor(() => runner.questStore.get(quest.id)!.status === "done");
  const request = mock.requests.filter((r) => /quest for tools/.test(JSON.stringify(r.body.messages))).at(-1)!;
  assert.deepEqual(request.body.tools.map((t: { name: string }) => t.name), ["memory", "skill", "conversation_search", "web_search", "web_fetch"]);
});

test("a code quest works on its own branch: preview, then undo leaves no trace", async () => {
  const fixer = (await crew()).bots.find((b) => b.id === "fixer")!;
  const headBefore = git("rev-parse", "HEAD");
  const quest = await runner.quests.start({ bot: fixer, text: "make hello", project: repo });
  await waitFor(() => runner.questStore.get(quest.id)!.status === "done");
  const copy = runner.questStore.get(quest.id)!.copy!;

  // The change exists only in the quest's working copy.
  assert.ok(fs.existsSync(path.join(copy.worktree, "hello.txt")));
  assert.ok(!fs.existsSync(path.join(repo, "hello.txt")));
  assert.equal(git("status", "--porcelain"), "");

  const preview = await runner.quests.changes(quest.id);
  assert.deepEqual(preview.files, [{ path: "hello.txt", added: 1, removed: 0 }]);
  assert.match(preview.diff, /\+hello/);

  await runner.quests.undo(quest.id);
  assert.ok(!fs.existsSync(copy.worktree));
  assert.equal(git("branch", "--list", copy.branch), "");
  assert.equal(git("worktree", "list").split("\n").length, 1);
  assert.equal(git("rev-parse", "HEAD"), headBefore);
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(runner.questStore.get(quest.id)!.outcome, "undone");
  await assert.rejects(runner.quests.undo(quest.id), /already dealt with/);
});

test("accepting a code quest keeps its change as a commit on its branch, leaving main alone", async () => {
  const fixer = (await crew()).bots.find((b) => b.id === "fixer")!;
  const headBefore = git("rev-parse", "HEAD");
  const quest = await runner.quests.start({ bot: fixer, text: "make hello again", project: repo });
  await waitFor(() => runner.questStore.get(quest.id)!.status === "done");
  const { branch } = await runner.quests.accept(quest.id);
  assert.ok(branch);
  assert.equal(git("rev-parse", "HEAD"), headBefore);
  assert.equal(git("show", `${branch}:hello.txt`), "hello");
  assert.match(git("log", "-1", "--format=%s %an", branch!), /^make hello again Dev$/);
  assert.equal(git("worktree", "list").split("\n").length, 1);
});

// ---------- a real restart ----------
function startApp(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [path.join(import.meta.dirname, "../../src/local/main.ts")], { env, stdio: "ignore" });
}

test("a quest survives the app being killed mid-step, and picks up where it stopped", { timeout: 30_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "talqava-restart-"));
  fs.mkdirSync(path.join(dataDir, "crew"));
  fs.writeFileSync(path.join(dataDir, "crew", "sleeper.yaml"), "name: Sleeper\ntype: maker\ninstructions: Wait.\npowers: [shell]\napprovals: run-everything\n");
  const port = String(20_000 + Math.floor(Math.random() * 20_000));
  const env = { ...process.env, TALQAVA_DATA_DIR: dataDir, PORT: port, HOST: "127.0.0.1", ANTHROPIC_BASE_URL: mock.url, ANTHROPIC_API_KEY: "test-key" };
  const api = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`http://localhost:${port}/api/${route}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
  const up = async () => {
    for (let i = 0; i < 200; i++) {
      try {
        return await api("GET", "state");
      } catch {
        await sleep(50);
      }
    }
    throw new Error("the app did not start");
  };

  let child = startApp(env);
  try {
    await up();
    const quest = await api("POST", "quests", { bot: "sleeper", text: "slow quest" });
    assert.equal(quest.status, "running");
    // Wait until the shell command has started, then pull the plug.
    for (let i = 0; i < 200 && !(await api("GET", `quests/${quest.id}`)).journal.some((e: any) => e.type === "tool_start"); i++) await sleep(50);
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));

    child = startApp(env);
    await up();
    let after: any;
    for (let i = 0; i < 200; i++) {
      after = await api("GET", `quests/${quest.id}`);
      if (after.status === "done") break;
      await sleep(50);
    }
    assert.equal(after.status, "done");
    assert.ok(after.resumedAt);
    assert.ok(after.journal.some((e: any) => e.type === "resumed"));
    const conversation = await api("GET", `conversations/${quest.id}`);
    const result = conversation.messages[2].content[0];
    assert.equal(result.is_error, true);
    assert.match(result.content, /app closed while this was running/);
    assert.equal(conversation.messages.at(-1).content[0].text, "Recovered after the restart.");
  } finally {
    child.kill("SIGKILL");
  }
});
