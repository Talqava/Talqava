// Keeping long runs cheap. Every step of a run sends the whole conversation to the model again, so a large tool
// output read early on is paid for again at every later step. Once the agent has used an output, it rarely needs
// all of it; this shortens old, large outputs in what is sent (never in what is saved, so the owner still sees
// everything) and keeps the latest ones whole.
//
// Shortening is done in batches, not one output at a time: changing an early part of the conversation means the
// model service has to read it afresh instead of from its cache, so the boundary moves only every few steps.
import type { Message, ToolResult } from "./types.ts";

export interface TrimOptions {
  /** The newest outputs that always stay whole. */
  keepRecent?: number;
  /** How many outputs the boundary moves at a time, so the service's cache is broken rarely. */
  batch?: number;
  /** Outputs shorter than this (in characters) are left alone: shortening them saves too little. */
  minChars?: number;
  /** How much of a shortened output is kept (its start and its end). */
  keepChars?: number;
}

export interface Trimmed {
  messages: Message[];
  /** How many outputs were shortened, and how many characters that left out. */
  outputs: number;
  chars: number;
}

const DEFAULTS = { keepRecent: 6, batch: 6, minChars: 2_000, keepChars: 600 };
/** An image costs roughly this many characters' worth of tokens. */
const IMAGE_CHARS = 5_000;

export const SHORTENED = (chars: number) =>
  `[Shortened to save cost: this output was ${chars.toLocaleString("en-US")} characters and was used in an earlier step. Run the step again if you need all of it.]`;

type Part = { type: string; text?: string };

function sizeOf(content: ToolResult["content"]): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return (content as Part[]).reduce((n, p) => n + (p.type === "text" ? (p.text ?? "").length : p.type === "image" ? IMAGE_CHARS : 0), 0);
}

function textOf(content: ToolResult["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[]).map((p) => (p.type === "text" ? p.text : p.type === "image" ? "[An image was here.]" : "")).filter(Boolean).join("\n");
}

function shorten(content: ToolResult["content"], keep: number): string {
  const text = textOf(content);
  const head = Math.ceil((keep * 2) / 3);
  const tail = keep - head;
  return `${text.slice(0, head)}\n…\n${SHORTENED(sizeOf(content))}\n…\n${tail > 0 ? text.slice(-tail) : ""}`;
}

/**
 * The conversation as it should be sent: old, large tool outputs shortened, everything else as it is. Returns
 * the same array when nothing changes. Errors stay whole (they are short, and say what went wrong).
 */
export function trimOldResults(messages: Message[], options: TrimOptions = {}): Trimmed {
  const { keepRecent, batch, minChars, keepChars } = { ...DEFAULTS, ...options };
  let total = 0;
  for (const m of messages) if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") total++;
  // Only outputs before this point are shortened; it moves a whole batch at a time.
  const boundary = Math.max(0, Math.floor((total - keepRecent) / batch) * batch);
  if (!boundary) return { messages, outputs: 0, chars: 0 };

  let index = 0;
  let outputs = 0;
  let chars = 0;
  const out = messages.map((m) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    let changed = false;
    const content = m.content.map((b) => {
      if (b.type !== "tool_result") return b;
      const old = index++ < boundary;
      const size = sizeOf(b.content);
      if (!old || b.is_error || size < minChars) return b;
      const short = shorten(b.content, keepChars);
      changed = true;
      outputs++;
      chars += Math.max(0, size - short.length);
      return { ...b, content: short };
    });
    return changed ? { ...m, content } : m;
  });
  return outputs ? { messages: out, outputs, chars } : { messages, outputs: 0, chars: 0 };
}
