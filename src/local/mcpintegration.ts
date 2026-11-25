// The MCP integration, both ways round. Outward: Talqava is an MCP server
// (src/local/mcp.ts), so Claude and other AI apps can see the person's team,
// give it work and read the results. Inward: connectors, the MCP servers of
// other services whose tools the agents may use (set under Integrations → MCP).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA, ROOT, getConfig } from "./store.ts";
import type { IntegrationInfo } from "./integrations.ts";

const SERVER_NAME = "talqava";

/** How another app starts the Talqava MCP server on this computer. */
export function mcpLaunch(): { command: string; args: string[]; env: Record<string, string> } {
  // Inside the desktop app the program that runs this code is the app itself, acting as Node.
  const asNode = Boolean(process.versions.electron) || process.env.ELECTRON_RUN_AS_NODE === "1";
  return {
    command: process.execPath,
    args: [path.join(ROOT, "src", "local", "mcp.ts")],
    env: { TALQAVA_DATA_DIR: DATA, ...(asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
  };
}

const claudeDesktopFile = () =>
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");

function readClaudeDesktop(): { found: boolean; config: Record<string, unknown> } {
  const file = claudeDesktopFile();
  if (!fs.existsSync(path.dirname(file))) return { found: false, config: {} };
  try {
    return { found: true, config: fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {} };
  } catch {
    throw new Error("Claude's settings file on this computer could not be read, so nothing was changed. Open Claude, then Settings → Developer → Edit Config, and check the file.");
  }
}

/** Everything the MCP integration page shows. */
export function mcpIntegration() {
  const launch = mcpLaunch();
  const cfg = getConfig();
  let claude = { found: false, added: false };
  try {
    const read = readClaudeDesktop();
    const servers = (read.config.mcpServers ?? {}) as Record<string, unknown>;
    claude = { found: read.found, added: Boolean(servers[SERVER_NAME]) };
  } catch {
    claude = { found: true, added: false };
  }
  const info: IntegrationInfo = {
    id: "mcp",
    name: "Connectors and AI apps",
    category: "AI apps and connectors",
    summary: "Use your Talqava team from Claude and other AI apps, and give your agents tools from other services. MCP is the open standard both ways use.",
    state: claude.added || cfg.mcpServers.length ? "connected" : "needs-setup",
    status: [claude.added ? "Added to Claude" : "", cfg.mcpServers.length ? `${cfg.mcpServers.length} connector${cfg.mcpServers.length === 1 ? "" : "s"} for your agents` : ""].filter(Boolean).join(" · ") || "Not set up yet",
  };
  return {
    ...info,
    launch,
    // The same thing as text, for apps that are set up by pasting a snippet or a command.
    snippet: JSON.stringify({ mcpServers: { [SERVER_NAME]: launch } }, null, 2),
    claudeCode: `claude mcp add ${SERVER_NAME} ${Object.entries(launch.env).map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`).join(" ")} -- ${JSON.stringify(launch.command)} ${launch.args.map((a) => JSON.stringify(a)).join(" ")}`,
    claude,
    tools: [
      ["talqava_team", "See who is on your team and what each agent does"],
      ["talqava_assign_task", "Give one of your agents a task"],
      ["talqava_task", "Read how a task stands and what the agent reported"],
      ["talqava_tasks", "List recent tasks"],
      ["talqava_memory", "Search or add to what your organization remembers"],
    ],
    connectors: cfg.mcpServers.map((s) => ({ name: s.name, where: s.command ? [s.command, ...(s.args ?? [])].join(" ") : (s.url ?? "") })),
  };
}

/**
 * Adds Talqava to the Claude desktop app on this computer (or takes it out):
 * one entry in Claude's own settings file, with everything else in that file
 * left exactly as it was. A copy of the file is kept beside it first.
 */
/**
 * When Talqava is already added to the Claude desktop app but its settings point at an old copy of this app
 * (it was renamed, or moved), points them at this one. Changes nothing otherwise; keeps a copy first.
 */
export function refreshClaudeDesktop(): boolean {
  try {
    const file = claudeDesktopFile();
    const { found, config } = readClaudeDesktop();
    const servers = (config.mcpServers ?? {}) as Record<string, { command?: string; args?: string[] }>;
    const now = mcpLaunch();
    const entry = servers[SERVER_NAME];
    if (!found || !entry || (entry.command === now.command && JSON.stringify(entry.args) === JSON.stringify(now.args))) return false;
    fs.copyFileSync(file, `${file}.before-talqava`);
    fs.writeFileSync(file, `${JSON.stringify({ ...config, mcpServers: { ...servers, [SERVER_NAME]: now } }, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

export function setClaudeDesktop(add: boolean): { added: boolean; file: string } {
  const file = claudeDesktopFile();
  const { found, config } = readClaudeDesktop();
  if (!found) throw new Error("The Claude desktop app does not seem to be installed on this computer. Install it from claude.ai/download, open it once, then try again.");
  const servers = { ...((config.mcpServers ?? {}) as Record<string, unknown>) };
  if (add) servers[SERVER_NAME] = mcpLaunch();
  else delete servers[SERVER_NAME];
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-talqava`);
  fs.writeFileSync(file, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`);
  return { added: add, file };
}
