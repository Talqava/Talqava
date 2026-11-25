// Checking a quest's result. A bot does not get to say it is done: the app
// looks at what it actually did. A failed check goes back to the bot to fix.
import { spawn } from "node:child_process";
import { clip, BRAND } from "../core/index.ts";
import type { Conversation } from "../core/index.ts";
import { changes } from "./git.ts";
import type { QuestCopy } from "./git.ts";
import type { QuestCheck } from "./templates.ts";
import { fill } from "./templates.ts";

export interface CheckItem {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface CheckResult {
  passed: boolean;
  items: CheckItem[];
  at: string;
}

export interface CheckContext {
  check: QuestCheck;
  conversation: Conversation;
  copy?: QuestCopy;
  /** Where a command check runs when the quest has no copy of a repository. */
  workspace: string;
  inputs: Record<string, string>;
  mustMention: string[];
  /** How long a command may run. */
  timeoutMs?: number;
}

/** Everything the bot wrote to the user in this quest. */
export function replyText(conversation: Conversation): string {
  return conversation.messages
    .filter((m) => m.role === "assistant" && Array.isArray(m.content))
    .flatMap((m) => (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text ?? ""))
    .join("\n");
}

/** Distinct sources linked in a text: the same page linked twice counts once. */
export function linkedSources(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"'`]+/g)) {
    try {
      const url = new URL(match[0].replace(/[.,;:!?]+$/, ""));
      found.add(`${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`);
    } catch {}
  }
  return [...found];
}

/** Which of the items a text leaves out. Issue numbers must match exactly (#12 is not #120). */
export function missingFrom(text: string, items: string[]): string[] {
  const lower = text.toLowerCase();
  return items.filter((item) => {
    if (/^#\d+$/.test(item)) return !new RegExp(`${item}(?!\\d)`).test(text);
    return !lower.includes(item.toLowerCase());
  });
}

/** The text with markdown emphasis removed and spaces evened out, for matching an answer key. */
function plain(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/[ \t\u00a0]+/g, " ").toLowerCase();
}

/** Whether a text contains a key entry. An entry may list accepted spellings separated by "|". Ids ending in a digit must not run on into a longer number. */
export function hasPoint(text: string, entry: string): boolean {
  const lower = plain(text);
  return entry
    .split("|")
    .map((alt) => alt.trim().toLowerCase())
    .filter(Boolean)
    .some((alt) => {
      let from = 0;
      for (;;) {
        const at = lower.indexOf(alt, from);
        if (at === -1) return false;
        const before = lower[at - 1] ?? " ";
        const after = lower[at + alt.length] ?? " ";
        // "500" is not found inside "1,500" or "5000", nor "INV-104" inside "INV-1041".
        const digitBefore = /\d/.test(before) || (/[.,]/.test(before) && /\d/.test(lower[at - 2] ?? ""));
        const runsOn = (/\d$/.test(alt) && /\d/.test(after)) || (/^\d/.test(alt) && digitBefore);
        if (!runsOn) return true;
        from = at + 1;
      }
    });
}

/** The keys of an answer key of pairs whose value is not on the same line as the key. */
export function wrongPairs(text: string, pairs: Record<string, string>): string[] {
  const lines = plain(text).split("\n");
  return Object.entries(pairs)
    .filter(([key, value]) => !lines.some((line) => hasPoint(line, key) && hasPoint(line, value)))
    .map(([key]) => key);
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  // Like the shell tool: no app keys or password in the environment.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (new RegExp(`^(ANTHROPIC_|${BRAND.envPrefix}PASSWORD)`).test(key)) delete env[key];
  // The command runs on its own, not as part of whatever test run started the app.
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd, env, detached: true });
    let output = "";
    const collect = (chunk: Buffer) => {
      if (output.length < 200_000) output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      output += `\n[stopped: ran longer than ${Math.round(timeoutMs / 1000)} seconds]`;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.on("error", (err) => (output += `\n[could not start: ${err.message}]`));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

export async function runChecks(ctx: CheckContext): Promise<CheckResult> {
  const { check } = ctx;
  const items: CheckItem[] = [];
  const reply = replyText(ctx.conversation);
  const changed = ctx.copy ? await changes(ctx.copy) : null;
  // What the bot produced: its reply plus every line it added to a file.
  const added = changed ? changed.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n") : "";

  if (check.changed) {
    const files = changed?.files.map((f) => f.path) ?? [];
    const passed = check.changed === "any" ? files.length > 0 : files.includes(check.changed);
    items.push({
      label: check.changed === "any" ? "Changed files" : `Changed ${check.changed}`,
      passed,
      detail: passed ? files.join(", ") : changed ? `Changed: ${files.join(", ") || "nothing"}.` : "The quest had no repository to change.",
    });
  }
  if (check.covers) {
    const missing = missingFrom(`${reply}\n${added}`, ctx.mustMention);
    items.push({
      label: `Covers all ${ctx.mustMention.length} gathered item${ctx.mustMention.length === 1 ? "" : "s"}`,
      passed: missing.length === 0,
      detail: missing.length ? `Missing: ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? ` and ${missing.length - 15} more` : ""}.` : undefined,
    });
  }
  if (check.links) {
    const sources = linkedSources(reply);
    items.push({
      label: `Cites at least ${check.links} sources`,
      passed: sources.length >= check.links,
      detail: `${sources.length} found${sources.length ? `: ${sources.slice(0, 6).join(", ")}` : ""}.`,
    });
  }
  // Answer keys. What is missing or wrong is counted, never named, so a second try cannot copy the key.
  if (check.mentions?.length) {
    const found = check.mentions.filter((entry) => hasPoint(`${reply}\n${added}`, entry)).length;
    items.push({
      label: `Contains all ${check.mentions.length} expected point${check.mentions.length === 1 ? "" : "s"}`,
      passed: found === check.mentions.length,
      detail: `${found} of ${check.mentions.length} found.`,
    });
  }
  if (check.pairs && Object.keys(check.pairs).length) {
    const total = Object.keys(check.pairs).length;
    const wrong = wrongPairs(`${reply}\n${added}`, check.pairs).length;
    items.push({
      label: `Gives the right answer for all ${total} item${total === 1 ? "" : "s"}`,
      passed: wrong === 0,
      detail: `${total - wrong} of ${total} right. Give each item on its own line with its answer.`,
    });
  }
  if (check.avoids?.length) {
    const included = check.avoids.filter((entry) => hasPoint(`${reply}\n${added}`, entry)).length;
    items.push({
      label: "Leaves out what does not belong",
      passed: included === 0,
      detail: included ? `${included} thing${included === 1 ? "" : "s"} in the answer should not be there. Give only what was asked for.` : undefined,
    });
  }
  // The command runs last, after the other checks have looked at the files.
  if (check.command) {
    const command = fill(check.command, ctx.inputs);
    const { code, output } = await runCommand(command, ctx.copy?.worktree ?? ctx.workspace, ctx.timeoutMs ?? 600_000);
    items.push({
      label: `\`${command}\` passes`,
      passed: code === 0,
      detail: clip(output.trim().split("\n").slice(-25).join("\n") || `exit code ${code}`, 3_000),
    });
  }
  return { passed: items.every((i) => i.passed), items, at: new Date().toISOString() };
}

/** What the bot is told when its check fails, so it fixes the work instead of stopping. */
export function feedback(result: CheckResult, triesLeft: number): string {
  const failed = result.items.filter((i) => !i.passed);
  return [
    "[The quest's check failed, so it is not done yet.]",
    ...failed.map((i) => `- ${i.label}: failed.${i.detail ? `\n${i.detail}` : ""}`),
    "",
    `Fix what failed, then finish again. Do not say the quest is done until the check passes. ${triesLeft === 1 ? "This is the last try." : `There are ${triesLeft} tries left.`} If it cannot pass, explain exactly why.`,
  ].join("\n");
}
