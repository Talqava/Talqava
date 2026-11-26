// Telegram, through a bot the owner makes with @BotFather. Facts from Telegram's documentation
// (core.telegram.org/bots, /bots/api, /bots/features, /bots/faq), read November 2026: a request is
// https://api.telegram.org/bot<token>/METHOD with a JSON body, answered {ok, result} or {ok: false, description};
// getUpdates hands over waiting messages and forgets them once the next call asks past them, keeps them a day at
// most, and does not work while a webhook is set; a bot cannot write to a person first; in a group a bot sees only
// commands and replies to it unless its privacy mode is switched off or it is an admin; text is 4,096 characters at
// most. Because Telegram forgets a message once it is handed over, the ones received are kept here in memory only:
// agents can read what arrived since Talqava was started. Telegram has no way to list the chats a bot is in.
import { baseOf, call, count, plain, type Connection, type ServiceDef } from "../connector-kit.ts";

type Keys = Pick<Connection, "values">;
const api = <T = any>(c: Keys, method: string, body: Record<string, unknown> = {}) => call<{ ok: boolean; result: T }>(`${baseOf("telegram", "https://api.telegram.org")}/bot${c.values.token}/${method}`, { name: "Telegram", method: "POST", body }).then((r) => r.result);

interface Got {
  key: string;
  chat: string;
  where: string;
  who: string;
  at: number;
  text: string;
  message: number;
}
/** What each bot has received since Talqava started, newest first, and where to ask from next. */
const inbox = new Map<string, { next: number; got: Got[] }>();
const whoOf = (u: any) => plain([u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.title || u?.username || "someone", 80);
/** Asks Telegram for what is waiting and keeps it. Asking past a message tells Telegram it was received. */
async function pull(c: Keys): Promise<Got[]> {
  const mine = inbox.get(c.values.token) ?? { next: 0, got: [] };
  inbox.set(c.values.token, mine);
  const updates = await api<any[]>(c, "getUpdates", { ...(mine.next ? { offset: mine.next } : {}), limit: 100, timeout: 0, allowed_updates: ["message", "channel_post"] });
  for (const u of Array.isArray(updates) ? updates : []) {
    mine.next = Math.max(mine.next, Number(u.update_id) + 1);
    const m = u.message ?? u.channel_post;
    if (!m?.chat?.id || m.from?.is_bot) continue;
    const text = String(m.text ?? m.caption ?? "").slice(0, 4096);
    if (!text) continue;
    const key = `${m.chat.id}_${m.message_id}`.replace(/^-/, "m");
    if (!mine.got.some((g) => g.key === key)) mine.got.unshift({ key, chat: String(m.chat.id), where: m.chat.type === "private" ? "private chat" : plain(m.chat.title ?? m.chat.type, 80), who: whoOf(m.from ?? m.chat), at: Number(m.date) * 1000, text, message: Number(m.message_id) });
  }
  mine.got = mine.got.slice(0, 500);
  return mine.got;
}
const chatRef = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!/^-?\d{1,20}$/.test(t) && !/^@[A-Za-z][A-Za-z0-9_]{3,40}$/.test(t)) throw new Error("Give the chat's number (from recent_messages) or a channel's @name.");
  return /^@/.test(t) ? t : Number(t);
};
const line = (g: Got) => `${new Date(g.at).toISOString().slice(0, 16).replace("T", " ")} · ${g.who} · ${g.where} [chat ${g.chat}, message ${g.message}]\n${g.text.slice(0, 1500)}`;

export const telegram: ServiceDef = {
  id: "telegram",
  name: "Telegram",
  category: "Team chat",
  about: "Receive the messages people send to your Telegram bot, and answer them with your approval.",
  steps: [
    "In Telegram, open a chat with @BotFather and send /newbot. Give your bot a name and a username ending in bot.",
    "BotFather answers with the bot's token (a number, a colon, then letters). Copy it and paste it below.",
    "People write to your bot first: a bot cannot start a conversation. To use it in a group, add the bot to the group; it then sees commands and replies to it, or everything if you make it an admin or switch its privacy mode off with /setprivacy in BotFather.",
    "Use this bot only with Talqava. Telegram hands each message over once, so another program using the same bot would take them.",
  ],
  docs: "https://core.telegram.org/bots/features#botfather",
  fields: [{ key: "token", label: "Bot token", secret: true, placeholder: "123456:ABC-DEF…" }],
  async check(values) {
    const token = String(values.token ?? "").trim();
    if (!/^\d{3,20}:[\w-]{20,100}$/.test(token)) throw new Error("That does not look like a bot token. It is a number, a colon, then letters and digits, as BotFather sent it.");
    const me = await api<{ id: number; first_name?: string; username?: string }>({ values: { token } }, "getMe");
    if (!me?.id) throw Object.assign(new Error("Telegram did not say which bot this is. Check the token."), { refused: true });
    // Waiting messages can only be asked for when no web address is set to receive them instead.
    const hook = await api<{ url?: string }>({ values: { token } }, "getWebhookInfo").catch(() => ({ url: "" }));
    if (hook?.url) throw new Error("This bot already sends its messages to another program (a webhook is set). Make a separate bot for Talqava with @BotFather.");
    return { label: `${plain(me.first_name, 80) || "Your bot"}${me.username ? ` (@${plain(me.username, 40)})` : ""}`, values: { token } };
  },
  triggers: [
    {
      name: "new_message",
      summary: "Someone writes to your bot",
      list: async (c) => (await pull(c)).map((g) => g.key),
      async describe(c, id) {
        const g = (inbox.get(c.values.token)?.got ?? []).find((x) => x.key === id);
        if (!g) throw new Error("That message is no longer kept. Telegram hands a message over only once.");
        return { title: `Telegram message from ${g.who}`, text: `${line(g)}\n\nTo answer, use send_message with chat ${g.chat}.` };
      },
    },
  ],
  actions: [
    {
      name: "recent_messages",
      kind: "read",
      summary: "Read the messages your bot received",
      description: "Lists the messages people sent to the bot since Talqava was started, newest first, with each chat's number for send_message. Telegram keeps no history for bots, so earlier messages cannot be fetched.",
      properties: { chat: { type: "string", description: "Optional: only this chat's number." }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const only = input.chat ? String(chatRef(input.chat)) : "";
        const got = (await pull(c)).filter((g) => !only || g.chat === only).slice(0, count(input.limit, 20, 50));
        return got.map(line).join("\n\n") || "No messages have arrived since Talqava was started.";
      },
    },
    {
      name: "send_message",
      kind: "write",
      alwaysAsk: true,
      summary: "Send a message as your bot",
      description: "Sends a text message as the bot to a chat (by its number) or a channel (by its @name) where the bot is a member. A person must have written to the bot first. Always asks the owner first, because it reaches people outside.",
      properties: { chat: { type: "string", description: "The chat's number, from recent_messages, or a channel's @name." }, text: { type: "string", description: "Plain text, at most 4,096 characters." }, reply_to: { type: "string", description: "Optional: the number of the message being answered." } },
      required: ["chat", "text"],
      async run(c, input) {
        const text = String(input.text ?? "").replace(/\r/g, "").trim();
        if (!text) throw new Error("Write the message.");
        if (text.length > 4096) throw new Error("A Telegram message is at most 4,096 characters. Shorten it or send it in parts.");
        const reply = String(input.reply_to ?? "").trim();
        if (reply && !/^\d{1,15}$/.test(reply)) throw new Error("reply_to is a message's number.");
        const sent = await api<{ message_id: number; chat?: any }>(c, "sendMessage", { chat_id: chatRef(input.chat), text, ...(reply ? { reply_parameters: { message_id: Number(reply), allow_sending_without_reply: true } } : {}) });
        return `Sent to ${whoOf(sent?.chat) === "someone" ? `chat ${input.chat}` : whoOf(sent.chat)} (message ${sent?.message_id}).`;
      },
    },
    {
      name: "get_chat",
      kind: "read",
      summary: "See what a chat is",
      description: "Returns a chat's kind (private, group, supergroup or channel), its title and its @name, by its number or a channel's @name.",
      properties: { chat: { type: "string" } },
      required: ["chat"],
      async run(c, input) {
        const chat = await api<any>(c, "getChat", { chat_id: chatRef(input.chat) });
        return `${plain(chat.type, 20)} · ${whoOf(chat)}${chat.username ? ` · @${plain(chat.username, 40)}` : ""} [chat ${chat.id}]`;
      },
    },
  ],
};
