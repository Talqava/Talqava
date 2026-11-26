// Slack: read channels and post messages through a bot the owner makes in their own workspace. Facts from Slack's
// developer documentation, read November 2026: docs.slack.dev/apis/web-api, /authentication/tokens,
// /app-management/quickstart-app-settings and /reference/methods auth.test, conversations.list,
// conversations.history, conversations.replies, chat.postMessage, users.list, users.lookupByEmail.
//
// Browser sign-in, from docs.slack.dev/authentication/installing-with-oauth and /reference/methods/oauth.v2.access
// (read November 2026): Slack sends the browser back only to an https address, and its sign-in for apps on a
// computer (PKCE) may not ask for a bot's permissions. So it works only through Talqava's sign-in service, once
// Talqava's maker has registered the app. Bot permissions go in "scope", separated by commas; the answer's
// access_token is the bot token; tokens do not run out unless the app turns rotation on, which Talqava's app does not.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const WHY: Record<string, string> = {
  not_in_channel: "the bot is not in that channel. In Slack, open the channel and type /invite followed by the bot's name",
  channel_not_found: "there is no such channel, or it is private and the bot has not been invited",
  users_not_found: "nobody in the workspace has that email address",
  ratelimited: "Slack is asking for a pause; try again in a minute",
};
/** One Slack method. Slack answers 200 even when it refuses, with ok:false and a short code. */
async function slack<T = any>(c: Pick<Connection, "values">, method: string, params: Record<string, unknown> = {}, post = false): Promise<T> {
  const url = `${baseOf("slack", "https://slack.com/api")}/${method}`;
  const headers = { authorization: `Bearer ${c.values.token}` };
  const r = post ? await call<any>(url, { name: "Slack", method: "POST", headers: { ...headers, "content-type": "application/json; charset=utf-8" }, body: params }) : await call<any>(`${url}${query(params)}`, { name: "Slack", headers });
  if (r?.ok) return r as T;
  const code = String(r?.error ?? "unknown");
  if (["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"].includes(code)) throw Object.assign(new Error("Slack refused that: the bot token is not accepted. Copy the Bot User OAuth Token (it starts with xoxb-) again."), { refused: true });
  if (code === "missing_scope") throw new Error(`Slack refused that: the bot lacks the permission ${r.needed ?? ""}. In your Slack app, add it under OAuth & Permissions › Bot Token Scopes, then press Reinstall to Workspace.`);
  throw new Error(`Slack answered: ${WHY[code] ?? code.replace(/_/g, " ")}.`);
}
const when = (ts: string) => new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ");

export const slackService: ServiceDef = {
  id: "slack",
  name: "Slack",
  category: "Team chat",
  about: "Read channels the bot is invited to, and post updates and replies in your Slack workspace.",
  steps: [
    "Open api.slack.com/apps, press Create New App, name it Talqava and choose your workspace.",
    "Under OAuth & Permissions › Bot Token Scopes, add: channels:read, groups:read, channels:history, groups:history, chat:write, users:read and users:read.email.",
    "Press Install to Workspace and allow it. Copy the Bot User OAuth Token (it starts with xoxb-) and paste it below.",
    "In Slack, invite the bot to each channel it should read or post in: type /invite and the bot's name.",
  ],
  docs: "https://docs.slack.dev/app-management/quickstart-app-settings",
  fields: [{ key: "token", label: "Bot User OAuth Token", secret: true, placeholder: "xoxb-…" }],
  browser: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read", "groups:read", "channels:history", "groups:history", "chat:write", "users:read", "users:read.email"],
    scopeSeparator: ",",
    secret: "required",
    pkce: false,
    tokenKey: "token",
    relayOnly: true,
    appSteps: [],
  },
  async check(values) {
    if (!values.access_token && !/^xoxb-/.test(values.token)) throw new Error("That is not a bot token. Copy the Bot User OAuth Token, which starts with xoxb-.");
    const me = await slack<{ team: string; user: string }>({ values }, "auth.test", {}, true);
    return { label: me.team };
  },
  actions: [
    {
      name: "list_channels",
      kind: "read",
      summary: "See the channels and which ones the bot is in",
      description: "Lists the workspace's channels with their numbers, and whether the bot is a member (it can only read and post where it is).",
      properties: {},
      async run(c) {
        const r = await slack<{ channels: any[] }>(c, "conversations.list", { types: "public_channel,private_channel", exclude_archived: true, limit: 200 });
        return r.channels.map((ch) => `[${ch.id}] #${ch.name}${ch.is_private ? " (private)" : ""}${ch.is_member ? " · bot is a member" : ""}`).join("\n") || "No channels.";
      },
    },
    {
      name: "read_channel",
      kind: "read",
      summary: "Read recent messages in a channel or a thread",
      description: "Returns recent messages of a channel, newest first, or of one thread (give thread). The bot must be in the channel.",
      properties: { channel: { type: "string", description: "The channel's number, from list_channels." }, thread: { type: "string", description: "A message's time stamp, to read its thread." }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      required: ["channel"],
      async run(c, input) {
        const r = input.thread ? await slack<{ messages: any[] }>(c, "conversations.replies", { channel: input.channel, ts: input.thread, limit: count(input.limit, 30, 100) }) : await slack<{ messages: any[] }>(c, "conversations.history", { channel: input.channel, limit: count(input.limit, 30, 100) });
        return r.messages.map((m) => `${when(m.ts)} · ${m.user ?? m.bot_id ?? "someone"} · ${plain(m.text, 1500)}${m.reply_count ? ` (${m.reply_count} replies; thread ${m.ts})` : ""} [${m.ts}]`).join("\n") || "No messages.";
      },
    },
    {
      name: "find_person",
      kind: "read",
      summary: "Look up people in the workspace",
      description: "Finds a person by email address, or lists the people in the workspace, with the numbers messages refer to them by.",
      properties: { email: { type: "string" } },
      async run(c, input) {
        if (input.email) {
          const u = (await slack<{ user: any }>(c, "users.lookupByEmail", { email: String(input.email) })).user;
          return `[${u.id}] ${u.real_name || u.name}${u.profile?.email ? ` · ${u.profile.email}` : ""}`;
        }
        const r = await slack<{ members: any[] }>(c, "users.list", { limit: 200 });
        return r.members.filter((u) => !u.deleted && !u.is_bot).map((u) => `[${u.id}] ${u.real_name || u.name}${u.profile?.email ? ` · ${u.profile.email}` : ""}`).join("\n") || "Nobody.";
      },
    },
    {
      name: "post_message",
      kind: "write",
      summary: "Post a message or a reply in a channel",
      description: "Posts a message in a channel as the bot, or a reply in a thread (give thread). Everyone in the channel sees it, so keep it short and useful. The bot must be in the channel.",
      properties: { channel: { type: "string", description: "The channel's number, from list_channels." }, text: { type: "string" }, thread: { type: "string", description: "A message's time stamp, to reply in its thread." } },
      required: ["channel", "text"],
      async run(c, input) {
        const r = await slack<{ ts: string; channel: string }>(c, "chat.postMessage", { channel: String(input.channel), text: String(input.text).slice(0, 12_000), ...(input.thread ? { thread_ts: String(input.thread) } : {}) }, true);
        return `Posted in ${r.channel} at ${when(r.ts)} [${r.ts}].`;
      },
    },
  ],
};
