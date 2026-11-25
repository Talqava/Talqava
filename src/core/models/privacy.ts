// The privacy guardrail: personal details (email addresses, phone numbers, card numbers, US Social Security numbers)
// are replaced with placeholders such as [EMAIL 1] before a conversation is sent to an AI service, and put back in
// what the model answers, so its reply and the steps it takes (sending an email to the right address) use the real
// values. The saved conversation always keeps the real values; only what leaves the computer is masked.
//
// Placeholders are numbered in the order values first appear, so the same value keeps the same placeholder for the
// whole conversation, and the service's cache still works between steps.
import type { ContentBlock, Message } from "../types.ts";
import type { Model, ModelCallbacks, ModelReply, ModelRequest } from "./types.ts";

type Kind = "EMAIL" | "PHONE" | "CARD" | "SSN";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A card number: 13 to 19 digits, in groups or not, that passes the Luhn check.
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
// A phone number: an optional +country code, then 9 to 15 digits with the usual separators.
const PHONE = /(?<![\w/])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,4}(?![\w/])/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Looks like a date or a time rather than a phone number: 2026-11-25, 25.11.2026, 10:30. */
const DATEISH = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/;

export class Masker {
  /** Real value → placeholder, and back. */
  #forward = new Map<string, string>();
  #back = new Map<string, string>();
  #counts: Record<Kind, number> = { EMAIL: 0, PHONE: 0, CARD: 0, SSN: 0 };

  #placeholder(kind: Kind, value: string): string {
    let p = this.#forward.get(value);
    if (!p) {
      p = `[${kind} ${++this.#counts[kind]}]`;
      this.#forward.set(value, p);
      this.#back.set(p, value);
    }
    return p;
  }

  /** How many different values were hidden. */
  get hidden(): number {
    return this.#forward.size;
  }

  mask(text: string): string {
    let out = text.replace(EMAIL, (m) => this.#placeholder("EMAIL", m));
    out = out.replace(SSN, (m) => this.#placeholder("SSN", m));
    out = out.replace(CARD, (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? this.#placeholder("CARD", m) : m;
    });
    out = out.replace(PHONE, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15 || DATEISH.test(m.trim())) return m;
      // Plain long numbers with no separators and no + are more often amounts or ids than phone numbers.
      if (!/[ .()+-]/.test(m)) return m;
      return this.#placeholder("PHONE", m);
    });
    return out;
  }

  /** Replaces only values already hidden earlier, adding none: for what the model itself wrote. */
  maskKnown(text: string): string {
    let out = text;
    for (const [value, placeholder] of this.#forward) if (out.includes(value)) out = out.split(value).join(placeholder);
    return out;
  }

  unmask(text: string): string {
    return text.replace(/\[(EMAIL|PHONE|CARD|SSN) \d+\]/g, (p) => this.#back.get(p) ?? p);
  }

  /** Masks every string inside a value (a tool's input or result), keeping its shape. */
  maskDeep<T>(value: T): T {
    return this.#walk(value, (s) => this.mask(s)) as T;
  }

  maskKnownDeep<T>(value: T): T {
    return this.#walk(value, (s) => this.maskKnown(s)) as T;
  }

  unmaskDeep<T>(value: T): T {
    return this.#walk(value, (s) => this.unmask(s)) as T;
  }

  #walk(value: unknown, fn: (s: string) => string): unknown {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map((v) => this.#walk(v, fn));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        // Images, files and Claude's signed thinking are left exactly as they are.
        out[k] = k === "data" || k === "signature" || k === "encrypted_content" ? v : this.#walk(v, fn);
      }
      return out;
    }
    return value;
  }
}

/**
 * The conversation with personal details masked. What people and tools send (the user's side) is masked in full.
 * What the model wrote is masked only where it repeats a value already hidden, which it wrote as a placeholder in the
 * first place, so its earlier turns go back exactly as it wrote them (Claude checks this). Its thinking, and the
 * results of steps the service ran itself (web search), are left exactly as they came.
 */
export function maskMessages(messages: Message[], masker: Masker): Message[] {
  const untouched = (type: string) => type === "thinking" || type === "redacted_thinking" || /_tool_result$/.test(type);
  return messages.map((m) => {
    const mine = m.role === "user";
    if (typeof m.content === "string") return { ...m, content: mine ? masker.mask(m.content) : masker.maskKnown(m.content) };
    return {
      ...m,
      content: (m.content as { type: string }[]).map((b) => (!mine && untouched(b.type) ? b : mine ? masker.maskDeep(b) : masker.maskKnownDeep(b))) as Message["content"],
    };
  });
}

/** A model behind the privacy guardrail. */
export class PrivacyModel implements Model {
  readonly ref: string;
  readonly label: string;
  readonly kind: Model["kind"];
  readonly prices: Model["prices"];
  readonly trimsOnServer?: boolean;
  #inner: Model;

  constructor(inner: Model) {
    this.#inner = inner;
    this.ref = inner.ref;
    this.label = inner.label;
    this.kind = inner.kind;
    this.prices = inner.prices;
    this.trimsOnServer = inner.trimsOnServer;
  }

  async call(request: ModelRequest, callbacks: ModelCallbacks): Promise<ModelReply> {
    // A new masker each call, filled in the conversation's order, so placeholders stay the same from step to step.
    const masker = new Masker();
    const system = masker.mask(request.system);
    const messages = maskMessages(request.messages, masker);
    // Streamed text is shown with the real values; a placeholder split across two pieces shows as typed.
    const reply = await this.#inner.call({ ...request, system, messages }, { ...callbacks, onText: (t) => callbacks.onText(masker.unmask(t)) });
    const content = reply.content.map((b) => (b.type === "thinking" || b.type === "redacted_thinking" ? b : masker.unmaskDeep(b))) as ContentBlock[];
    return { ...reply, content };
  }
}
