// Trello: boards, lists and cards. Facts from Atlassian's Trello developer documentation, read November 2026:
// developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction and /authorization, and the boards, cards
// and members reference. The key and token are sent in a sign-in header, never in the address.
import { baseOf, call, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", params: Record<string, unknown> = {}) =>
  call<T>(`${baseOf("trello", "https://api.trello.com/1")}${path}${query(params)}`, { name: "Trello", method, headers: { authorization: `OAuth oauth_consumer_key="${c.values.key}", oauth_token="${c.values.token}"` } });
const card = (k: any) => `[${k.id}] ${plain(k.name, 160)}${k.due ? ` · due ${String(k.due).slice(0, 10)}${k.dueComplete ? " (done)" : ""}` : ""}${k.closed ? " · archived" : ""}`;
const id = (v: unknown) => {
  const t = String(v ?? "");
  if (!/^[A-Za-z0-9]{6,40}$/.test(t)) throw new Error("Give the number in brackets from the list.");
  return t;
};

export const trello: ServiceDef = {
  id: "trello",
  name: "Trello",
  category: "Projects and tasks",
  about: "Read your Trello boards, add and move cards, and comment on them.",
  steps: [
    "Open trello.com/apps/admin, make a new Power-Up named Talqava for your workspace, and open it.",
    "On its API Key tab press Generate a new API Key, and copy the key below.",
    "Press the Token link beside the key, press Allow, and copy the token it shows below.",
  ],
  docs: "https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/",
  // Signing in through the browser: Trello shows its own approval page and hands the token straight back, so there is
  // no token to copy. The API key is public by Trello's own description, and there is no secret.
  browser: {
    kind: "fragment",
    authUrl: "https://trello.com/1/authorize",
    tokenUrl: "",
    scopes: ["read", "write"],
    scopeSeparator: ",",
    extra: { expiration: "never" },
    secret: "never",
    idKey: "key",
    idLabel: "API key",
    tokenKey: "token",
    appSteps: [
      "Open trello.com/apps/admin, make a new Power-Up named Talqava for your workspace, and open it.",
      "On its API Key tab press Generate a new API Key.",
      "On the same tab, under Allowed origins, add {origin} and save. Trello only sends you back to addresses listed there.",
      "Copy the API key below and press the button. Trello asks you to allow Talqava; press Allow.",
    ],
  },
  fields: [
    { key: "key", label: "API key", secret: true },
    { key: "token", label: "Token", secret: true },
  ],
  async check(values) {
    if (/["\\]/.test(values.key + values.token)) throw new Error("The key or token does not look right. Copy them again.");
    const me = await api<{ fullName: string; username: string }>({ values }, "/members/me", "GET", { fields: "fullName,username" });
    return { label: `${me.fullName} (@${me.username})` };
  },
  actions: [
    {
      name: "list_boards",
      kind: "read",
      summary: "See your boards and their lists",
      description: "Lists the open boards, or the lists of one board (give board). Start here to get the numbers other tools need.",
      properties: { board: { type: "string", description: "A board's number, to see its lists." } },
      async run(c, input) {
        if (!input.board) return (await api<any[]>(c, "/members/me/boards", "GET", { filter: "open", fields: "name,url" })).map((b) => `[${b.id}] ${plain(b.name, 120)}`).join("\n") || "No boards.";
        return (await api<any[]>(c, `/boards/${id(input.board)}/lists`, "GET", { filter: "open", fields: "name" })).map((l) => `[${l.id}] ${plain(l.name, 120)}`).join("\n") || "No lists on that board.";
      },
    },
    {
      name: "list_cards",
      kind: "read",
      summary: "See the cards on a board or in a list",
      description: "Lists the open cards of a list (give list) or of a whole board (give board).",
      properties: { list: { type: "string" }, board: { type: "string" } },
      async run(c, input) {
        if (!input.list && !input.board) throw new Error("Give a list or a board.");
        const cards = await api<any[]>(c, input.list ? `/lists/${id(input.list)}/cards` : `/boards/${id(input.board)}/cards`, "GET", { fields: "name,due,dueComplete,closed,idList" });
        return cards.slice(0, 200).map(card).join("\n") || "No cards.";
      },
    },
    {
      name: "get_card",
      kind: "read",
      summary: "Read one card in full",
      description: "Returns one card: its name, description, due date and link.",
      properties: { card: { type: "string" } },
      required: ["card"],
      async run(c, input) {
        const k = await api<any>(c, `/cards/${id(input.card)}`, "GET", { fields: "name,desc,due,dueComplete,closed,idList,shortUrl" });
        return `${card(k)}\n${k.shortUrl ?? ""}\n\n${plain(k.desc, 8000) || "(no description)"}`;
      },
    },
    {
      name: "create_card",
      kind: "write",
      summary: "Add a card to a list",
      description: "Adds a card to a list. Give a clear name; put detail in the description.",
      properties: { list: { type: "string", description: "The list's number, from list_boards." }, name: { type: "string" }, description: { type: "string" }, due: { type: "string", description: "A date like 2026-12-01." } },
      required: ["list", "name"],
      async run(c, input) {
        const k = await api<any>(c, "/cards", "POST", { idList: id(input.list), name: String(input.name).slice(0, 300), desc: input.description ? String(input.description).slice(0, 10_000) : undefined, due: input.due ? String(input.due).slice(0, 25) : undefined });
        return `Added the card “${k.name}” (${k.id}). ${k.shortUrl ?? ""}`.trim();
      },
    },
    {
      name: "update_card",
      kind: "write",
      summary: "Change, move or archive a card",
      description: "Changes a card: its name, description or due date, moves it to another list, marks its due date done, or archives it (archived cards can be brought back in Trello).",
      properties: { card: { type: "string" }, name: { type: "string" }, description: { type: "string" }, due: { type: "string" }, done: { type: "boolean", description: "Mark the due date done or not done." }, move_to_list: { type: "string" }, archive: { type: "boolean" } },
      required: ["card"],
      async run(c, input) {
        const change = { name: input.name ? String(input.name).slice(0, 300) : undefined, desc: input.description !== undefined ? String(input.description).slice(0, 10_000) : undefined, due: input.due ? String(input.due).slice(0, 25) : undefined, dueComplete: typeof input.done === "boolean" ? input.done : undefined, idList: input.move_to_list ? id(input.move_to_list) : undefined, closed: typeof input.archive === "boolean" ? input.archive : undefined };
        if (Object.values(change).every((v) => v === undefined)) throw new Error("Say what to change.");
        return `Updated: ${card(await api<any>(c, `/cards/${id(input.card)}`, "PUT", change))}`;
      },
    },
    {
      name: "add_comment",
      kind: "write",
      summary: "Comment on a card",
      description: "Adds a comment to a card, seen by everyone on the board.",
      properties: { card: { type: "string" }, text: { type: "string" } },
      required: ["card", "text"],
      async run(c, input) {
        await api(c, `/cards/${id(input.card)}/actions/comments`, "POST", { text: String(input.text).slice(0, 10_000) });
        return `Commented on card ${input.card}.`;
      },
    },
  ],
};
