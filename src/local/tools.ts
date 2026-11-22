// Tools that only make sense on the user's own machine: a shell and direct
// file access. The hosted edition never loads this file.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  clip,
  MAX_OUTPUT,
  conversationSearchTool,
  httpTool,
  memoryTool,
  scheduleTool,
  skillTool,
  systemPrompt,
  BRAND,
  pageTool,
  setting,
} from "../core/index.ts";
import type { Conversation, JobBook, RunSpec, Tool } from "../core/index.ts";
import { WORKSPACE, conversations, getConfig, memory, skills } from "./store.ts";
import { resolveModel } from "./models.ts";
import { browserAvailable, browserTool } from "./browser.ts";

const BASH_TIMEOUT_MS = Number(setting("BASH_TIMEOUT_MS") || 120_000);

// ---------- files, confined to the workspace ----------
export function safePath(requested: string, root = WORKSPACE): string {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, String(requested));
  // Follow symlinks on the part of the path that already exists.
  let existing = target;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = path.join(fs.realpathSync(existing), path.relative(existing, target));
  const rel = path.relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`"${requested}" is outside the workspace. Files must stay inside the workspace folder.`);
  }
  return real;
}

interface EditorInput {
  command: string;
  path: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  view_range?: [number, number];
}

function editFile(input: EditorInput): string {
  const file = safePath(input.path);
  switch (input.command) {
    case "view": {
      if (fs.statSync(file).isDirectory()) {
        const names = fs.readdirSync(file, { withFileTypes: true });
        return names.map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).join("\n") || "(empty folder)";
      }
      let lines = fs.readFileSync(file, "utf8").split("\n");
      let start = 1;
      if (Array.isArray(input.view_range)) {
        const [from, to] = input.view_range;
        start = Math.max(1, from);
        lines = lines.slice(start - 1, to === -1 ? undefined : to);
      }
      return clip(lines.map((line, i) => `${String(start + i).padStart(5)}  ${line}`).join("\n"));
    }
    case "create":
      if (typeof input.file_text !== "string") throw new Error("create needs file_text.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, input.file_text);
      return `Wrote ${input.path}.`;
    case "str_replace": {
      if (typeof input.old_str !== "string") throw new Error("str_replace needs old_str.");
      const text = fs.readFileSync(file, "utf8");
      const count = text.split(input.old_str).length - 1;
      if (count !== 1) throw new Error(`old_str was found ${count} times in ${input.path}; it must match exactly once.`);
      fs.writeFileSync(file, text.replace(input.old_str, () => input.new_str ?? ""));
      return `Edited ${input.path}.`;
    }
    case "insert": {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const at = Number(input.insert_line);
      if (!Number.isInteger(at) || at < 0 || at > lines.length) throw new Error("insert_line is out of range.");
      lines.splice(at, 0, String(input.insert_text ?? input.new_str ?? ""));
      fs.writeFileSync(file, lines.join("\n"));
      return `Inserted into ${input.path}.`;
    }
    default:
      throw new Error(`Unknown editor command "${input.command}".`);
  }
}

const isObject = (input: unknown): input is Record<string, unknown> =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);

export const editorTool: Tool = {
  name: "str_replace_based_edit_tool",
  definition: { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
  portable: {
    description:
      "Views, creates and edits files in the workspace. view: show a file with line numbers, or list a folder. create: write file_text to path. str_replace: replace old_str (which must appear exactly once) with new_str. insert: insert insert_text after line insert_line (0 for the top).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["view", "create", "str_replace", "insert"] },
        path: { type: "string", description: "Path relative to the workspace." },
        file_text: { type: "string" },
        old_str: { type: "string" },
        new_str: { type: "string" },
        insert_line: { type: "number" },
        insert_text: { type: "string" },
        view_range: { type: "array", items: { type: "number" }, description: "[first line, last line]; -1 for the end." },
      },
      required: ["command", "path"],
    },
  },
  validate: (input) =>
    isObject(input) && typeof input.command === "string" && typeof input.path === "string" ? null : "missing command or path",
  needsApproval: (input: EditorInput) => input.command !== "view",
  run: (input: EditorInput) => editFile(input),
};

// ---------- shell ----------
interface BashInput {
  command?: string;
  restart?: boolean;
}

function runBash(input: BashInput, signal: AbortSignal): Promise<string> {
  if (input.restart) return Promise.resolve("Each command already starts in a fresh shell in the workspace folder.");
  // The shell does not inherit the agent's own keys or password.
  const env = { ...process.env };
  const hidden = new RegExp(`^(ANTHROPIC_|${BRAND.envPrefix}PASSWORD)`);
  for (const key of Object.keys(env)) {
    if (hidden.test(key)) delete env[key];
  }
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", input.command ?? ""], { cwd: WORKSPACE, env, detached: true });
    let output = "";
    let note = "";
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      note = `\n[stopped: ran longer than ${BASH_TIMEOUT_MS / 1000} seconds]`;
      kill();
    }, BASH_TIMEOUT_MS);
    const onAbort = () => {
      note = "\n[stopped by the user]";
      kill();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT * 4) output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => {
      note = `\n[could not start: ${err.message}]`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(`${clip(output)}${note}\n[exit code ${code ?? "none"}]`.trim());
    });
  });
}

export const bashTool: Tool = {
  name: "bash",
  definition: { type: "bash_20250124", name: "bash" },
  portable: {
    description: "Runs a bash command in the workspace folder and returns its output. Each command starts in a fresh shell.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  validate: (input) => (isObject(input) && (input.restart === true || typeof input.command === "string") ? null : "missing command"),
  needsApproval: (input: BashInput) => input.restart !== true,
  run: (input: BashInput, { signal }) => runBash(input, signal),
};

// ---------- putting a run together ----------
/** Every tool the local edition offers. */
export async function localTools(jobs: JobBook): Promise<Tool[]> {
  const tools = [
    bashTool,
    editorTool,
    memoryTool(memory),
    conversationSearchTool(conversations),
    skillTool(skills),
    httpTool(() => getConfig().secrets),
    scheduleTool(jobs),
  ];
  if (await browserAvailable()) tools.push(browserTool);
  return tools;
}

export function localPrompt(): string {
  return systemPrompt({
    agentName: getConfig().agentName,
    setting: "running on the user's own machine",
    environment: [
      `Your working folder is ${WORKSPACE}. File paths are relative to it and files cannot leave it. Each shell command starts in a fresh shell in that folder, so chain steps that depend on each other in one command.`,
    ],
    memory: memory.list(),
    skills: skills.list(),
  });
}

/** Builds what the engine needs for one run, from the settings file. */
export function localRunSpec(jobs: JobBook) {
  return async (_conversation: Conversation): Promise<RunSpec> => {
    const cfg = getConfig();
    const model = resolveModel(cfg);
    const tools = await localTools(jobs);
    const claude = model.kind === "anthropic";
    return {
      model,
      system: localPrompt(),
      // Other models read the web with our own page reader; Claude uses Anthropic's.
      tools: claude ? tools : [...tools, pageTool()],
      hostedTools: claude
        ? [
            { type: "web_search_20260209", name: "web_search" },
            { type: "web_fetch_20260209", name: "web_fetch" },
          ]
        : [],
      // Connectors are reached through Anthropic's connector service, so they are Claude-only for now.
      mcpServers: claude ? cfg.mcpServers : [],
      approvalMode: cfg.approvalMode,
      budget: cfg.budget,
    };
  };
}
