// "What was sent today": a plain record of what left this computer, written as it happens and kept for 30 days.
// Four kinds of line: a call to an AI service (which model, how much text), a workspace page or library document
// handed to an agent's AI service (its title and level, never its content), a change made through a connected service
// or website, and a web address an agent called. The content itself is never written here.
import fs from "node:fs";
import path from "node:path";
import { DATA, getConfig } from "./store.ts";
import { isLocalRef } from "./gateway.ts";
import { redact } from "./audit.ts";
import { levelOf, noteRead, runModel } from "./sensitivity.ts";

export type SentKind = "ai" | "item" | "service" | "web";
export interface SentLine {
  at: string;
  kind: SentKind;
  /** Where it went: the model's name, the connected service, the website's host. */
  to: string;
  /** The agent's job title, when known. */
  who?: string;
  /** What it was, in a few words: a page's title, the action taken. */
  what?: string;
  /** The sensitivity level of a page or document. */
  level?: string;
  /** For an AI call: tokens sent, and whether the model runs on this computer (then nothing left it). */
  tokens?: number;
  local?: boolean;
}

const KEEP_DAYS = 30;
const MAX_BYTES = 4_000_000;
const file = () => path.join(DATA, "sent.log");
/** A page handed over many times in one day to the same agent is written once. */
const once = new Set<string>();
let onceDay = "";

const dayOf = (at: string | Date) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Writes one line. Never throws: the record must not stop the work. */
export function noteSent(line: Omit<SentLine, "at">) {
  try {
    const now = new Date();
    if (line.kind === "item") {
      const today = dayOf(now);
      if (onceDay !== today) (once.clear(), (onceDay = today));
      const key = `${DATA}|${line.to}|${line.who ?? ""}|${line.what ?? ""}|${line.level ?? ""}`;
      if (once.has(key)) return;
      once.add(key);
    }
    fs.mkdirSync(DATA, { recursive: true });
    try {
      if (fs.statSync(file()).size > MAX_BYTES) fs.renameSync(file(), path.join(DATA, "sent-1.log"));
    } catch {}
    const clean = { at: now.toISOString(), ...line, to: String(redact(line.to)).slice(0, 120), what: line.what ? String(redact(line.what)).slice(0, 200) : undefined };
    fs.appendFileSync(file(), `${JSON.stringify(clean)}\n`);
  } catch (err) {
    console.error("The record of what was sent could not be written:", (err as Error).message);
  }
}

/** Notes a call to an AI model, working out from its name whether it runs on this computer. */
export function noteModelCall(model: string, who: string, tokens?: number) {
  const provider = getConfig().providers.find((p) => p.name && model.toLowerCase().includes(p.name.toLowerCase()));
  noteSent({ kind: "ai", to: model, who, tokens, local: provider ? isLocalRef(`${provider.id}/x`) : false });
}

/** Notes a page or document handed to an agent during a run: its title and level, and the model the run uses. */
export function noteItem(title: string, level: string, who: string) {
  noteRead(levelOf(level));
  const ref = runModel();
  if (!ref) return;
  const local = isLocalRef(ref);
  noteSent({ kind: "item", to: local ? "A model on this computer" : ref, what: title, level, who, local });
}

/** The host of a web address, or nothing when it is not one. */
export function hostOf(url: unknown): string | null {
  try {
    return new URL(String(url)).host || null;
  } catch {
    return null;
  }
}

function lines(): SentLine[] {
  const out: SentLine[] = [];
  const oldest = Date.now() - KEEP_DAYS * 86_400_000;
  for (const name of ["sent-1.log", "sent.log"]) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(DATA, name), "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      try {
        const l = JSON.parse(raw) as SentLine;
        if (new Date(l.at).getTime() >= oldest) out.push(l);
      } catch {}
    }
  }
  return out;
}

export interface SentDay {
  day: string;
  /** Days that have anything, newest first, for the picker. */
  days: string[];
  ai: { model: string; local: boolean; calls: number; tokens: number; agents: string[] }[];
  items: { title: string; level: string; who: string; to: string; local: boolean; at: string }[];
  services: { to: string; what: string; who?: string; at: string }[];
  web: { host: string; calls: number; agents: string[] }[];
}

/** Everything sent on one day (today when none is given), grouped for reading. */
export function sentOn(day?: string): SentDay {
  const all = lines();
  const want = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? String(day) : dayOf(new Date());
  const days = [...new Set([dayOf(new Date()), ...all.map((l) => dayOf(l.at))])].sort().reverse();
  const today = all.filter((l) => dayOf(l.at) === want);
  const ai = new Map<string, SentDay["ai"][number]>();
  const web = new Map<string, SentDay["web"][number]>();
  const items: SentDay["items"] = [];
  const services: SentDay["services"] = [];
  for (const l of today) {
    if (l.kind === "ai") {
      const row = ai.get(l.to) ?? { model: l.to, local: Boolean(l.local), calls: 0, tokens: 0, agents: [] };
      row.calls++;
      row.tokens += Number(l.tokens) || 0;
      if (l.who && !row.agents.includes(l.who)) row.agents.push(l.who);
      ai.set(l.to, row);
    } else if (l.kind === "web") {
      const row = web.get(l.to) ?? { host: l.to, calls: 0, agents: [] };
      row.calls++;
      if (l.who && !row.agents.includes(l.who)) row.agents.push(l.who);
      web.set(l.to, row);
    } else if (l.kind === "item") items.push({ title: l.what ?? "", level: l.level ?? "internal", who: l.who ?? "", to: l.to, local: Boolean(l.local), at: l.at });
    else services.push({ to: l.to, what: l.what ?? "", who: l.who, at: l.at });
  }
  return { day: want, days, ai: [...ai.values()].sort((a, b) => b.tokens - a.tokens), items: items.reverse().slice(0, 500), services: services.reverse().slice(0, 500), web: [...web.values()].sort((a, b) => b.calls - a.calls) };
}
