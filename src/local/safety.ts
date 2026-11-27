// Two floors under everything else an agent may do. Neither replaces approvals; both hold even when the owner has
// told an agent to run without asking.
//
// 1. Commands that are never run. A short list of commands whose damage cannot be undone or that reach past the
//    work at hand: wiping a disk or the home folder, switching the computer off, taking administrator rights,
//    running whatever a web address sends back, reading the computer's saved passwords. They are refused before an
//    approval is even offered, so nobody can wave one through by mistake. It reads the command line only: what a
//    script or a build started by the command goes on to do is not seen, so this is a floor, not a sandbox.
//
// 2. Saved secrets never reach the AI model. If a key, a token or a password that Talqava holds turns up in what a
//    tool returns (a settings file printed out, an error that echoes a request), it is replaced before the model or
//    the session's record sees it.
//
// Both ideas are common to agent tools; the particular lists here are Talqava's own. PicoClaw (MIT) does the same two
// things and was the prompt to add them.
import type { ToolOutput } from "../core/index.ts";
import { getConfig } from "./store.ts";

/** A command that is never run, with what it would do, in plain words. */
const NEVER: [RegExp, string][] = [
  // Deleting everything: the whole disk, the home folder, or wherever the command happens to be run.
  [/\brm\s+(?:-{1,2}[\w-]+\s+)*["']?(?:\/|~|\$HOME|\$\{HOME\}|\/(?:Users|home|System|Library|etc|var|usr|bin|sbin|opt|Applications|private)|[A-Za-z]:\\?)\/?\*?["']?(?=\s|$|[;&|])|\brm\b[^;&|]*--no-preserve-root\b/i, "delete the whole disk, your home folder or a system folder"],
  [/\brm\s+(?:-[a-z-]*\s+)*-[a-z]*r[a-z]*\s+(?:-[a-z-]*\s+)*["']?\.{1,2}\/?["']?(?:\s|$|;|&|\|)/i, "delete everything in the folder it is run from, or the folder above it"],
  [/\b(?:rd|rmdir)\s+\/s\b.*\b[A-Za-z]:\\?(?:\s|$)|\bformat\s+[A-Za-z]:|\bdel\s+\/[a-z]\s.*\b[A-Za-z]:\\\*?/i, "erase a whole drive"],
  // Disks and partitions.
  [/\bmkfs(?:\.\w+)?\b|\bfdisk\b|\bparted\b|\bdiskutil\s+(?:erase|partition|zero|secureErase|reformat)\w*|\bwipefs\b/i, "erase or re-partition a disk"],
  [/\bdd\b[^|;&]*\bof=\/dev\/|>\s*\/dev\/(?:sd|hd|nvme|disk|rdisk|mmcblk)\w*/i, "write straight over a disk"],
  // Switching the computer off, or stopping everything on it.
  [/(?:^|[;&|]\s*|\bsudo\s+)(?:shutdown|reboot|halt|poweroff)\b|\binit\s+[06]\b|\bsystemctl\s+(?:poweroff|reboot|halt)\b|\bosascript\b.*\b(?:shut down|restart)\b/i, "switch the computer off or restart it"],
  [/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:[^}]*\}\s*;\s*:/, "start copies of itself without end until the computer stops"],
  [/\bkill(?:all)?\s+(?:-(?:9|KILL|s\s+KILL)\s+)?-1\b/i, "stop every program you are running"],
  // Administrator rights: an agent has no business taking them, and cannot give the password anyway.
  [/(?:^|[;&|(]\s*|\bthen\s+|\bdo\s+)(?:sudo|doas|pkexec)\b|\bsu\s+(?:-\s*)?(?:root\b|$)/i, "take administrator rights"],
  [/\bch(?:mod|own)\s+(?:-[a-z]*R[a-z]*\s+)[^;&|]*\s["']?(?:\/|~|\$HOME)["']?(?:\s|$|;|&|\|)/i, "change who may use every file on the disk or in your home folder"],
  // Running whatever a web address sends back.
  [/\b(?:curl|wget|fetch)\b[^;&]*\|\s*(?:sudo\s+)?(?:ba|z|k|da|fi)?sh\b|\b(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b|\biex\b[^;]*\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b|\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;]*\|\s*iex\b/i, "download a program from the web and run it unseen"],
  [/\bpowershell(?:\.exe)?\b[^;]*\s-e(?:nc(?:odedcommand)?)?\s+[A-Za-z0-9+/=]{20,}/i, "run a hidden, encoded command"],
  // The computer's saved passwords and keys.
  [/\bsecurity\s+(?:find-(?:generic|internet)-password|dump-keychain|export)\b|\bcmdkey\s+\/list\b|\bsecret-tool\s+(?:lookup|search)\b/i, "read the passwords saved on this computer"],
  [/\b(?:cat|less|more|head|tail|cp|scp|base64|xxd|strings|open)\b[^;&|]*(?:\.ssh\/id_[\w-]+(?![\w-])(?!\.pub\b)|\.aws\/credentials\b|\.gnupg\/|\.netrc\b|Login Data\b|Cookies\b.*(?:Chrome|Firefox|Safari))/i, "read private keys or sign-ins kept on this computer"],
  // History that cannot be got back.
  [/\bgit\s+push\b[^;&|]*\s(?:--force(?!-with-lease)\b|-f\b)[^;&|]*\b(?:main|master|production|release)\b|\bgit\s+push\b[^;&|]*\b(?:main|master|production|release)\b[^;&|]*\s(?:--force(?!-with-lease)\b|-f\b)/i, "overwrite the main history of a repository for everyone"],
];

/** Why a command is never run, in plain words; nothing when it may go on to the usual approval. */
export function refusedCommand(command: unknown): string | null {
  const text = String(command ?? "");
  if (!text.trim()) return null;
  // Looked at as written, and again with line breaks and runs of spaces closed up, so spacing tricks change nothing.
  for (const line of new Set([text, text.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ")])) {
    for (const [pattern, would] of NEVER) if (pattern.test(line)) return `Refused: this command would ${would}. Talqava never runs it, with or without approval. If the task really needs this, stop and tell the owner what you were trying to do.`;
  }
  return null;
}

/** Keys of a saved connection that hold something secret. */
const SECRET_NAME = /token|secret|password|passwd|api[_-]?key|^key$|private|credential/i;
const HIDDEN = "[hidden: a key saved in Talqava]";

/** Every secret Talqava holds, longest first: AI service keys, stored keys, tokens of connected services, sites and bots. */
export function savedSecrets(): string[] {
  const cfg = getConfig() as ReturnType<typeof getConfig> & { telegramChat?: { token?: string }; backup?: { key?: string }; githubToken?: string };
  const found = new Set<string>();
  // Short values are left alone: replacing every "1234" in a result would mangle it, and a secret that short protects nothing.
  const add = (v: unknown) => typeof v === "string" && v.trim().length >= 12 && found.add(v.trim());
  add(cfg.apiKey);
  add(process.env.ANTHROPIC_API_KEY);
  for (const p of cfg.providers ?? []) add(p.apiKey);
  for (const s of Object.values(cfg.secrets ?? {})) add((s as { value?: string }).value);
  for (const c of cfg.connections ?? []) for (const [k, v] of Object.entries(c.values ?? {})) if (SECRET_NAME.test(k)) add(v);
  for (const m of cfg.mcpServers ?? []) add(m.token);
  for (const w of cfg.wordpress ?? []) add(w.password);
  add(cfg.telegramChat?.token);
  add(cfg.backup?.key);
  add(cfg.sessionSecret);
  return [...found].sort((a, b) => b.length - a.length);
}

/** Text with every saved secret taken out. */
export function withoutSecrets(text: string, secrets = savedSecrets()): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join(HIDDEN);
  return out;
}

/** What a tool returned, with every saved secret taken out before the model or the session's record sees it. */
export function hideSecrets(output: ToolOutput): ToolOutput {
  const secrets = savedSecrets();
  if (!secrets.length) return output;
  if (typeof output === "string") return withoutSecrets(output, secrets);
  if (!Array.isArray(output)) return output;
  return output.map((part) => (part.type === "text" ? { ...part, text: withoutSecrets(part.text, secrets) } : part)) as ToolOutput;
}
