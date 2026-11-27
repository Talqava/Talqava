// Talk to your assistant from Telegram. The owner makes a bot with @BotFather and pastes its token; Talqava then
// listens for messages to that bot and answers them with the assistant, as in a chat in the app. It is the owner's
// own line to their assistant, so it answers one private chat only: the one that typed the code Talqava shows.
// Anyone else who finds the bot is told it is private, and nothing they write reaches the assistant.
//
// Facts from Telegram's documentation (core.telegram.org/bots/api, /bots/faq), read November 2026: a request is
// https://api.telegram.org/bot<token>/METHOD with a JSON body, answered {ok, result} or {ok: false, description};
// getUpdates with a timeout waits for messages (long polling) and forgets each once a later call asks past it; a
// bot cannot write to a person first; a message is 4,096 characters at most. Telegram offers no sign-in page for a
// bot, so this is the one place a pasted token is used: the owner asked for it.
//
// What is said in the chat goes through Telegram's servers, as with any Telegram chat. The same rules apply as in
// the app: anything that would send, change or delete waits for the owner's yes in the Inbox, never in Telegram.
import crypto from "node:crypto";
import { audit } from "./audit.ts";
import { getConfig, saveConfig } from "./store.ts";

export interface TelegramChat {
  token: string;
  /** The bot's own name on Telegram, without the @. */
  bot: string;
  /** The one private chat that is answered, once paired, and who that is. */
  chat?: string;
  who?: string;
  /** The conversation in Talqava that the Telegram chat continues. */
  conversation?: string;
  /** Where to ask Telegram from next. */
  offset?: number;
  /** The code to type in Telegram to pair, and until when it works. */
  code?: string;
  codeUntil?: number;
}
type Saved = ReturnType<typeof getConfig> & { telegramChat?: TelegramChat };
const saved = (): TelegramChat | undefined => (getConfig() as Saved).telegramChat;
const keep = (next: TelegramChat | undefined) => saveConfig({ telegramChat: next } as Parameters<typeof saveConfig>[0]);
const base = () => (process.env.TALQAVA_TELEGRAM_API || "https://api.telegram.org").replace(/\/+$/, "");

async function tg<T = any>(token: string, method: string, body: Record<string, unknown> = {}, wait = 20_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(wait) });
  } catch {
    throw Object.assign(new Error("Telegram could not be reached. Check your internet connection."), { unreachable: true });
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !data?.ok) throw Object.assign(new Error(`Telegram answered: ${String(data?.description ?? `error ${res.status}`).slice(0, 200)}`), { refused: res.status === 401 || res.status === 404 });
  return data.result as T;
}

const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
let problem = "";

/** What the app shows: never the token. */
export function telegramStatus() {
  const t = saved();
  if (!t) return { state: "off" as const };
  const pairing = !t.chat;
  return {
    state: pairing ? ("pairing" as const) : ("on" as const),
    bot: t.bot,
    who: t.who ?? null,
    code: pairing && t.code && (t.codeUntil ?? 0) > Date.now() ? t.code : null,
    problem: problem || null,
  };
}

/** Connects a bot by its token: Telegram is asked whose it is before anything is saved, and a pairing code is made. */
export async function connectTelegram(input: unknown): Promise<ReturnType<typeof telegramStatus>> {
  const token = String(input ?? "").trim();
  if (!/^\d{5,15}:[\w-]{30,60}$/.test(token)) throw new Error("That does not look like a bot token. Copy the whole line @BotFather gave you: digits, a colon, then letters and digits.");
  const me = await tg<{ username?: string; is_bot?: boolean }>(token, "getMe").catch((err) => {
    throw (err as { refused?: boolean }).refused ? new Error("Telegram does not accept that token. Copy it again from @BotFather.") : err;
  });
  if (!me?.is_bot || !me.username) throw new Error("Telegram did not say which bot this is. Copy the token again from @BotFather.");
  problem = "";
  keep({ token, bot: String(me.username).slice(0, 64), code: newCode(), codeUntil: Date.now() + 15 * 60_000 });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: "Connected a Telegram bot to talk to the assistant", detail: `@${me.username}; waiting for the pairing code` });
  return telegramStatus();
}

/** A fresh pairing code, when the last one ran out. */
export function renewTelegramCode(): ReturnType<typeof telegramStatus> {
  const t = saved();
  if (!t) throw new Error("Connect a bot first.");
  if (t.chat) throw new Error("A chat is already connected. Disconnect it to connect another.");
  keep({ ...t, code: newCode(), codeUntil: Date.now() + 15 * 60_000 });
  return telegramStatus();
}

/** Forgets the bot's token and the chat. Nothing at Telegram is changed; the bot simply stops answering. */
export function disconnectTelegram(): { state: "off" } {
  if (saved()) audit({ actor: "owner", actorName: "You", kind: "integration", action: "Disconnected the Telegram bot" });
  keep(undefined);
  problem = "";
  return { state: "off" };
}

/** What the assistant said, and whether it is waiting for the owner's yes in the app (then `later` carries what it says afterwards). */
export interface Answer {
  conversation: string;
  reply: string;
  busy?: boolean;
  waiting?: boolean;
  later?: Promise<string>;
}
export type Ask = (conversation: string | null, text: string) => Promise<Answer>;

const HELP = "Write to me as you would in Talqava. /new starts a fresh conversation. Anything that would send, change or delete something waits for your yes in Talqava's Inbox.";
/** Splits a long answer at line breaks so each part fits in one Telegram message. */
export function parts(text: string, most = 4000): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > most) {
    const cut = Math.max(rest.lastIndexOf("\n", most), rest.lastIndexOf(" ", most));
    const at = cut > most / 2 ? cut : most;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
const told = new Map<string, number>();
/** Says something to a chat that is not the owner's, at most once an hour, so a stranger cannot make the bot chatter. */
async function tellOnce(token: string, chat: string, text: string) {
  if (Date.now() - (told.get(chat) ?? 0) < 3_600_000) return;
  told.set(chat, Date.now());
  if (told.size > 500) told.delete(told.keys().next().value as string);
  await tg(token, "sendMessage", { chat_id: chat, text }).catch(() => {});
}
const say = async (token: string, chat: string, text: string) => {
  for (const part of parts(text || "(The assistant gave no answer.)")) await tg(token, "sendMessage", { chat_id: chat, text: part });
};

/** One message from Telegram: pairs the chat, or hands the owner's words to the assistant and sends back what it says. */
export async function handleTelegram(message: any, ask: Ask): Promise<void> {
  const t = saved();
  const chat = message?.chat?.id === undefined ? "" : String(message.chat.id);
  if (!t || !chat || message?.from?.is_bot) return;
  if (message.chat.type !== "private") return tellOnce(t.token, chat, "I answer only in a private chat with my owner.");
  const text = typeof message.text === "string" ? message.text.trim().slice(0, 4096) : "";
  if (!t.chat) {
    const typed = text.replace(/^\/start\s*/i, "").trim();
    if (t.code && (t.codeUntil ?? 0) > Date.now() && typed.length === t.code.length && crypto.timingSafeEqual(Buffer.from(typed), Buffer.from(t.code))) {
      const who = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 80) || "You";
      keep({ ...t, chat, who, code: undefined, codeUntil: undefined });
      audit({ actor: "owner", actorName: "You", kind: "integration", action: "Paired a Telegram chat with the assistant", detail: who });
      return say(t.token, chat, `Connected. I am your Talqava assistant. ${HELP}`);
    }
    return tellOnce(t.token, chat, "This is a private assistant. To connect it, type the 6-digit code shown in Talqava under Connections › Telegram.");
  }
  if (chat !== t.chat) return tellOnce(t.token, chat, "This is a private assistant.");
  if (!text) return say(t.token, chat, "I can only read text for now. Type your message.");
  if (/^\/(start|help)\b/i.test(text)) return say(t.token, chat, HELP);
  if (/^\/new\b/i.test(text)) {
    keep({ ...t, conversation: undefined });
    return say(t.token, chat, "Started a fresh conversation. What do you need?");
  }
  await tg(t.token, "sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  let answer: Answer;
  try {
    answer = await ask(t.conversation ?? null, text);
  } catch (err) {
    return say(t.token, chat, `That did not work: ${String((err as Error).message).slice(0, 500)}`);
  }
  if (answer.conversation !== t.conversation) keep({ ...(saved() ?? t), conversation: answer.conversation });
  if (answer.busy) return say(t.token, chat, "I am still working on your last message. I will answer it first.");
  if (answer.reply) await say(t.token, chat, answer.reply);
  if (answer.waiting) {
    await say(t.token, chat, "This needs your yes before I go on. Open Talqava and look in the Inbox; I will carry on once you answer there.");
    void answer.later?.then((more) => (more ? say(t.token, chat, more) : undefined)).catch(() => {});
  } else if (!answer.reply) await say(t.token, chat, "");
}

let stopped = false;
let running = false;
/** Listens for messages for as long as the app runs. Does nothing while no bot is connected. */
export function startTelegram(ask: Ask): { stop: () => void } {
  stopped = false;
  if (!running) {
    running = true;
    void (async () => {
      let pause = 2000;
      while (!stopped) {
        const t = saved();
        if (!t) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        try {
          const updates = await tg<any[]>(t.token, "getUpdates", { ...(t.offset ? { offset: t.offset } : {}), timeout: 25, limit: 20, allowed_updates: ["message"] }, 40_000);
          problem = "";
          pause = 2000;
          for (const u of Array.isArray(updates) ? updates : []) {
            // The place is moved on first, so a message that fails is not handed over again and again.
            const now = saved();
            if (!now || now.token !== t.token) break;
            keep({ ...now, offset: Number(u.update_id) + 1 });
            // One message at a time is awaited only as far as the assistant's first answer, so a long task does not hold up the next.
            if (u.message) await handleTelegram(u.message, ask).catch(() => {});
          }
        } catch (err) {
          const e = err as { refused?: boolean; message: string };
          problem = e.refused ? "Telegram no longer accepts the bot's token. Disconnect and connect it again with a new token from @BotFather." : e.message;
          pause = Math.min(e.refused ? 300_000 : 60_000, pause * 2);
          await new Promise((r) => setTimeout(r, pause));
        }
      }
      running = false;
    })();
  }
  return { stop: () => (stopped = true) };
}
