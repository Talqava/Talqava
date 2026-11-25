// The Talqava window. No framework: small helpers that build DOM nodes.
// Layout: a top bar (repository, command box, spending, settings) over a body
// that each view fills: home base, a quest, a bot, chats, and the other pages.
import { renderMarkdown } from "/markdown.js";

const app = document.getElementById("app");
const state = {
  config: null,
  convs: [],
  quests: [],
  crew: null,
  view: "chat", // chat is the main screen; bots ("home") are an add-on
  convId: null,
  botId: null,
  quest: null,
  running: false,
  source: null,
  selectedBot: null,
  project: "",
  spaces: [],
  space: "", // the space chats are shown and started in; "" is General
};
const ui = {}; // live nodes of the open view

try {
  state.project = localStorage.getItem("talqava.project") || "";
  state.selectedBot = localStorage.getItem("talqava.bot");
  state.space = localStorage.getItem("talqava.space") || "";
} catch {}
const remember = (key, value) => {
  try {
    localStorage.setItem(key, value ?? "");
  } catch {}
};

// ---------- helpers ----------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  // Children may be nested lists of any depth (a list inside a conditional inside a list).
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}


// ---------- the Talqava logo ----------
// The mark: a white bar (the layer Talqava adds on top) over a green cursor (work under way), on a black tile.
// The wordmark: TALQAVA drawn as strokes as thick as the bar. Both follow the brand guide; colours are fixed.
const LOGO_WORD = "M0 4H40M20 0V56M58 56V16A12 12 0 0 1 70 4H78A12 12 0 0 1 90 16V56M58 32H90M112 0V52H148M178 4H186A12 12 0 0 1 198 16V40A12 12 0 0 1 186 52H178A12 12 0 0 1 166 40V16A12 12 0 0 1 178 4ZM188 42L202 56M220 56V16A12 12 0 0 1 232 4H240A12 12 0 0 1 252 16V56M220 32H252M274 0V28L290 48L306 28V0M328 56V16A12 12 0 0 1 340 4H348A12 12 0 0 1 360 16V56M328 32H360";
function brandLogo({ mark = 26, word = 12, cursor = true } = {}) {
  const node = h("span", { class: "logo", "aria-hidden": "true" });
  node.innerHTML =
    `<svg class="logo-mark" viewBox="0 0 64 64" width="${mark}" height="${mark}"><rect width="64" height="64" rx="16" fill="#0A0A0A"/><rect x="0.5" y="0.5" width="63" height="63" rx="15.5" fill="none" stroke="#2A2A2A"/><rect x="14" y="16" width="36" height="8" fill="#F2F2F2"/><rect x="27" y="28" width="10" height="20" fill="#00D26A"/></svg>` +
    (word ? `<svg class="logo-word" viewBox="0 0 364 56" width="${(word * 364) / 56}" height="${word}"><path d="${LOGO_WORD}" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="miter" stroke-miterlimit="2"/></svg>` : "");
  if (word && cursor) node.append(h("span", { class: "cursor" }));
  return node;
}

async function api(method, path, body) {
  if (method !== "GET" && method !== "DELETE") body ??= {}; // the server only accepts JSON writes
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "login") {
    showLogin();
    throw new Error("Sign in first.");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
  return data;
}

/** Replaces a node's children; lists are flattened and empty values skipped. */
function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return node;
}

// Runs an action and shows any failure next to where it happened.
async function attempt(fn, where) {
  try {
    return await fn();
  } catch (err) {
    const box = h("div", { class: "banner error" }, err.message);
    (where || ui.log || ui.body || app).append(box);
    setTimeout(() => box.remove(), 8000);
  }
}

/** A short message at the bottom of the window that goes away by itself. */
function toast(text) {
  document.querySelector(".toast")?.remove();
  const box = h("div", { class: "toast", role: "status" }, text);
  document.body.append(box);
  setTimeout(() => box.remove(), 6000);
}

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never");
const shortWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const money = (n) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;
const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

// ---------- sign-in ----------
function showLogin() {
  state.source?.close();
  const password = h("input", { type: "password", placeholder: "Password", autocomplete: "current-password" });
  const form = h(
    "form",
    {
      class: "login",
      onsubmit: async (e) => {
        e.preventDefault();
        await attempt(async () => {
          await api("POST", "login", { password: password.value });
          boot();
        }, form);
      },
    },
    h("div", { class: "brand", role: "img", "aria-label": "Talqava" }, brandLogo({ mark: 48, word: 18 })),
    password,
    h("button", { class: "primary" }, "Sign in"),
  );
  fill(app, form);
  password.focus();
}

// ---------- start-up and refreshing ----------
// A Claude model with no key cannot run; a local model needs none.
const needsKey = (c) => c.model.startsWith("anthropic/") && !c.hasApiKey;

async function boot() {
  try {
    state.config = await api("GET", "state");
  } catch {
    return;
  }
  document.title = "Talqava";
  if (!state.config.projects.includes(state.project)) state.project = "";
  if (needsKey(state.config)) (state.view = "integrations"), (ui.integration = "ai-models");
  await Promise.all([loadCrew(), loadQuests(), refreshList(), loadTemplates(), loadSpaces(), loadOrgs()]);
  render();
  clearInterval(boot.timer);
  // One heartbeat keeps every part of the window current.
  boot.timer = setInterval(tick, 2000);
}

async function loadCrew() {
  try {
    state.crew = await api("GET", `crew${state.project ? `?project=${encodeURIComponent(state.project)}` : ""}`);
  } catch {
    state.crew ??= { bots: [], problems: [], branch: null };
  }
  if (!state.crew.bots.some((b) => b.id === state.selectedBot)) state.selectedBot = state.crew.bots[0]?.id ?? null;
}

/** Spaces keep one client's or project's memory and chats apart; "" is General. */
async function loadSpaces() {
  try {
    state.spaces = await api("GET", "spaces");
  } catch {}
  if (!state.spaces.some((s) => s.id === state.space)) state.space = "";
}
const spaceName = (id) => state.spaces.find((s) => s.id === id)?.name || "General";
function setSpace(id) {
  state.space = id || "";
  remember("talqava.space", state.space);
}

/** Organizations: the bots in roles, with titles, departments and managers. */
async function loadOrgs() {
  try {
    state.orgs = await api("GET", "orgs");
  } catch {
    state.orgs ??= { active: "", orgs: [] };
  }
}
const activeOrg = () => state.orgs?.orgs.find((o) => o.id === state.orgs.active) ?? state.orgs?.orgs[0] ?? { id: "", name: "", mission: "", members: [] };
const roleOf = (botId) => activeOrg().members.find((m) => m.bot === botId);

async function loadTemplates() {
  try {
    state.templates = await api("GET", "quest-templates");
  } catch {
    state.templates = [];
  }
}

async function loadQuests() {
  try {
    state.quests = await api("GET", "quests");
  } catch {}
}

async function refreshList() {
  try {
    state.convs = await api("GET", "conversations");
  } catch {}
}

let ticks = 0;
async function tick() {
  if (document.hidden) return;
  ticks++;
  const before = questSignature();
  await loadQuests();
  if (ticks % 3 === 0) await Promise.all([refreshList(), loadPageSuggestions()]);
  renderSpent();
  syncInboxCount();
  if (questSignature() !== before) {
    if (state.view === "home") renderHome();
    if (state.view === "quest") refreshQuest();
    if (state.view === "inbox") renderInbox();
  }
  if (state.view === "chat" && ticks % 3 === 0) renderChatList();
  if (state.view === "tasks") refreshTasks();
}

const questSignature = () =>
  JSON.stringify(state.quests.map((q) => [q.id, q.status, q.steps, q.outcome, q.approvals.length, q.activity?.output?.length ?? 0, q.checking, q.check?.at, q.template?.tries]));

/** Kept for the pages that call it after saving settings. */
function renderSide() {
  renderTop();
}

// ---------- the window frame ----------
// One layout for every page: a navigation rail on the left, and beside it a
// top bar (search and page tools) over the page itself.
/** The brand video (soft green light over a fine grid) behind a welcome or empty screen. Returns the elements to put first in a `.hero`. */
function heroVideo() {
  const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const poster = h("img", { class: "heroposter", src: `/media/brand-loop-${theme()}.jpg`, alt: "", "aria-hidden": "true" });
  if (still) return [poster];
  const video = h("video", { class: "herovideo", src: `/media/brand-loop-${theme()}.webm`, poster: `/media/brand-loop-${theme()}.jpg`, autoplay: "", muted: "", loop: "", playsinline: "", "aria-hidden": "true", tabindex: "-1" });
  video.muted = true; // set as a property too, which is what lets it start on its own
  video.addEventListener("loadeddata", () => (poster.hidden = true));
  return [poster, video];
}
// When the theme changes, every brand video on screen switches with it.
window.addEventListener("talqava-theme", () => {
  const t = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  for (const v of document.querySelectorAll(".herovideo")) (v.src = `/media/brand-loop-${t}.webm`), (v.poster = `/media/brand-loop-${t}.jpg`), v.play?.().catch(() => {});
  for (const i of document.querySelectorAll(".heroposter")) i.src = `/media/brand-loop-${t}.jpg`;
});

function render() {
  ui.rail = h("nav", { class: "rail", "aria-label": "Main" });
  ui.top = h("header", { class: "top" });
  ui.body = h("div", { class: "body" });
  fill(app, ui.rail, h("div", { class: "main" }, ui.top, ui.body));
  renderTop();
  renderBody();
}

// Line icons for the rail, drawn on a 20 px grid.
const ICONS = {
  chat: "M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3A2.5 2.5 0 0 1 4 10.5z",
  inbox: "M3.5 11.5l2-7h9l2 7M3.5 11.5v3a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-3M3.5 11.5h4l1 2h3l1-2h4",
  team: "M10 3.5v3M10 6.5H5v3M10 6.5h5v3M3 9.5h4v3H3zM13 9.5h4v3h-4zM8 13.5h4v3H8zM10 6.5v7",
  home: "M5 7.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V9A1.5 1.5 0 0 1 5 7.5zM10 7.5V4.5M7.5 11.5v.01M12.5 11.5v.01",
  market: "M4 8l1-4h10l1 4M4 8v7.5h12V8M4 8h12M8 15.5v-4h4v4",
  memory: "M6 3.5h8A1.5 1.5 0 0 1 15.5 5v11.5L10 13.5l-5.5 3V5A1.5 1.5 0 0 1 6 3.5z",
  skills: "M4.5 5h11M4.5 10h11M4.5 15h7",
  jobs: "M10 5.5V10l3 2M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  settings: "M4 6h7M15 6h1M4 14h1M9 14h7M13 4v4M7 12v4",
  integrations: "M7.5 3.5v4M12.5 3.5v4M5.5 7.5h9v2.5a4.5 4.5 0 0 1-9 0zM10 14.5v2.5",
  audit: "M6 3.5h6l3 3v10H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5zM7.5 9h5M7.5 11.5h5M7.5 14h3",
  workspace: "M5.5 3.5h6l3 3v10h-9zM11.5 3.5v3h3M7.5 10h5M7.5 12.5h5M7.5 7.5h2",
  tasks: "M4 4.5h3v11H4zM8.5 4.5h3v7h-3zM13 4.5h3v4h-3z",
  guide: "M10 5.5C8.5 4.3 6.5 4 4 4v11c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V4c-2.5 0-4.5.3-6 1.5zM10 5.5v11",
  library: "M3.5 6A1.5 1.5 0 0 1 5 4.5h3l1.5 2H15A1.5 1.5 0 0 1 16.5 8v6A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14zM7 10.5h6M7 12.8h4",
};
const icon = (name) => {
  const node = h("span", { class: "ico", "aria-hidden": "true" });
  node.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
  return node;
};

function renderRail() {
  if (!ui.rail) return;
  const v = state.view;
  const item = (view, label, on, title) => h("button", { class: `railitem ${on ? "on" : ""}`, onclick: () => go(view), title: title || label, "aria-current": on ? "page" : null }, icon(view), h("span", { class: "grow" }, label));
  const inbox = item("inbox", "Inbox", v === "inbox", "What needs you, what is being worked on, and what got done");
  ui.inboxCount = h("span", { class: "count", hidden: true });
  inbox.append(ui.inboxCount);
  fill(
    ui.rail,
    h("button", { class: "plain brand", onclick: () => go("chat"), title: "Chat", "aria-label": "Talqava, chat" }, brandLogo()),
    h("div", { class: "railgroup" }, item("chat", "Chat", v === "chat", "Talk to your agents, or ask anything"), inbox),
    h("div", { class: "raillabel" }, "Work"),
    h(
      "div",
      { class: "railgroup" },
      item("tasks", "Tasks", v === "tasks", "Every task and goal: queued, working, needing you, to review and done"),
      item("home", "Work in progress", ["home", "quest", "bot"].includes(v), "Your agents and what each is doing right now"),
      item("jobs", "Schedules", v === "jobs", "Work that runs by itself on a schedule"),
    ),
    h("div", { class: "raillabel" }, "Team"),
    h("div", { class: "railgroup" }, item("team", "Organization", v === "team", "The org chart, departments and budgets"), item("market", "Marketplace", v === "market" || v === "marketbot", "Ready-made agents and teams for every department")),
    h("div", { class: "raillabel" }, "Knowledge"),
    h(
      "div",
      { class: "railgroup" },
      item("workspace", "Workspace", v === "workspace", "Pages your agents work from: procedures, checklists and decisions"),
      item("library", "Library", v === "library", "Documents you share with your agents"),
      item("memory", "Memory", v === "memory", "What your agents remember between tasks"),
      item("skills", "Skills", v === "skills", "Step-by-step know-how your agents can follow"),
    ),
    h("div", { class: "raillabel" }, "Oversight"),
    h("div", { class: "railgroup" }, item("audit", "Audit log", v === "audit", "Every operation, by you and by each agent")),
    h(
      "div",
      { class: "railgroup railend" },
      item("integrations", "Integrations", v === "integrations", "Connect the tools your business already uses"),
      item("settings", "Settings", v === "settings", "AI models, approvals, budgets and how Talqava looks"),
      h("button", { class: "railitem", onclick: () => showGuide(guideFor(v) ?? "getting-started"), title: "How to use Talqava, page by page" }, icon("guide"), h("span", { class: "grow" }, "User guide")),
    ),
  );
  syncInboxCount();
}

function go(view, id = null) {
  ui.wsFlush?.();
  if (view !== "workspace") (ui.wsEditor?.destroy(), (ui.wsEditor = null), (ui.wsFlush = null));
  state.view = view;
  state.convId = view === "chat" || view === "quest" ? id : null;
  state.botId = view === "bot" ? id : null;
  state.marketId = view === "marketbot" ? id : null;
  closePalette();
  renderTop();
  renderBody();
  enterPage();
}

/** Plays the page's short entrance once. It is taken off again, so later refreshes of the same page do not replay it. */
function enterPage() {
  const body = ui.body;
  if (!body) return;
  body.classList.remove("enter");
  void body.offsetWidth; // restart the animation
  body.classList.add("enter");
  clearTimeout(enterPage.timer);
  enterPage.timer = setTimeout(() => body.classList.remove("enter"), 700);
}

// The repository picker and quest spending only matter on the bot pages.
const onBotPages = () => ["home", "quest", "bot", "team"].includes(state.view);

function renderBody() {
  state.source?.close();
  state.source = null;
  ui.log = null;
  ui.body.className = "body";
  const views = { home: homeView, quest: questView, bot: botView, chat: chatView, memory: memoryView, skills: skillsView, jobs: jobsView, settings: settingsView, market: marketView, marketbot: marketBotView, inbox: inboxView, team: teamView, integrations: integrationsView, library: libraryView, audit: auditView, workspace: workspaceView, tasks: tasksView };
  (views[state.view] || homeView)();
}

function renderTop() {
  if (!ui.top) return;
  const c = state.config;
  const repo = h(
    "select",
    {
      "aria-label": "Repository",
      onchange: async (e) => {
        state.project = e.target.value;
        remember("talqava.project", state.project);
        await loadCrew();
        renderTop();
        if (state.view === "home") renderHome();
      },
    },
    h("option", { value: "" }, "no repository"),
    c.projects.map((p) => h("option", { value: p, selected: p === state.project }, basename(p))),
  );
  ui.spent = h("div", { class: "spent" });
  const bots = ["home", "quest"].includes(state.view); // the repository and quest spending belong to the bots' work pages
  renderRail();
  fill(ui.top,
    ...[
      bots
        ? h(
            "div",
            { class: "repo", title: state.project || "Tasks work in the workspace folder. Connect repositories under Integrations → Git." },
            h("span", { class: "repolabel" }, "Repository"),
            repo,
            state.project && state.crew?.branch ? [h("span", { class: "on" }, "on"), state.crew.branch] : null,
          )
        : null,
      paletteBox(),
      bots ? ui.spent : null,
      guideFor(state.view) ? h("button", { class: "small guidebtn", onclick: () => showGuide(guideFor(state.view)), title: "How to use this page, step by step" }, icon("guide"), "Guide") : null,
    ].filter(Boolean),
  );
  renderSpent();
}

function renderSpent() {
  syncInboxCount();
  if (!ui.spent) return;
  const today = new Date().toDateString();
  const spent = state.quests.filter((q) => new Date(q.createdAt).toDateString() === today).reduce((sum, q) => sum + (q.cost || 0), 0);
  fill(ui.spent, "Spent today on agents", h("b", {}, money(spent)));
}

// ---------- the command box ----------
const COMMANDS = [
  ["New chat", () => go("chat")],
  ["User guide", () => showGuide(guideFor(state.view) ?? "getting-started")],
  ["Inbox", () => go("inbox")],
  ["Bots", () => go("home")],
  ["Organization", () => go("team")],
  ["Marketplace", () => go("market")],
  ["Create an agent", () => go("bot", "new")],
  ["Memory", () => go("memory")],
  ["Skills", () => go("skills")],
  ["Schedules", () => go("jobs")],
  ["Settings", () => go("settings")],
];

function paletteBox() {
  ui.palette = h("input", { type: "text", placeholder: paletteHint(), "aria-label": "Ask something, assign an agent, or run a command", autocomplete: "off" });
  ui.paletteList = null;
  ui.paletteAt = 0;
  const box = h("div", { class: "palette" }, ui.palette, h("span", { class: "keys" }, navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"));
  ui.palette.addEventListener("input", () => openPalette(box));
  ui.palette.addEventListener("focus", () => openPalette(box));
  ui.palette.addEventListener("blur", () => setTimeout(closePalette, 150));
  ui.palette.addEventListener("keydown", (e) => {
    const items = paletteItems();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ui.paletteAt = (ui.paletteAt + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
      openPalette(box);
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[ui.paletteAt]?.run();
    } else if (e.key === "Escape") {
      ui.palette.blur();
    }
  });
  return box;
}

function paletteHint() {
  const bot = state.crew?.bots.find((b) => b.id === state.selectedBot);
  if (state.view === "home" && bot) return `Assign a task to ${bot.name}, or type @name, or a command`;
  return "Ask in a new chat, type @name to assign an agent, or run a command";
}

function paletteItems() {
  const text = ui.palette?.value.trim() ?? "";
  const bots = state.crew?.bots ?? [];
  const items = [];
  const mention = /^@([\w-]+)\s*(.*)$/s.exec(text);
  // Plain text starts a chat; bots are sent only from the bots page or with @name.
  const botFirst = state.view === "home";
  if (text && !mention) items.push({ label: "Ask in a new chat", what: text, run: () => startChatWith(text) });
  const target = mention ? bots.find((b) => b.id === mention[1].toLowerCase() || b.name.toLowerCase().startsWith(mention[1].toLowerCase())) : botFirst ? bots.find((b) => b.id === state.selectedBot) : null;
  const task = mention ? mention[2].trim() : text;
  if (task && target) items[botFirst && !mention ? "unshift" : "push"]({ label: `Assign to ${target.name}`, what: task, bot: target, run: () => sendQuest(target, task) });
  if (task && !mention && botFirst) {
    for (const bot of bots.filter((b) => b !== target).slice(0, 5)) items.push({ label: `Assign to ${bot.name} instead`, what: roleLine(bot, roleOf(bot.id)?.title), bot, run: () => sendQuest(bot, task) });
  }
  const needle = text.toLowerCase();
  const commands = [
    ...COMMANDS,
    ...(state.templates ?? []).map((t) => [`Standard task: ${t.name}`, () => (go("home"), openCoreQuest(t.id))]),
    ...bots.map((b) => [`Edit ${b.name}`, () => go("bot", b.id)]),
  ];
  for (const [label, run] of commands) if (!needle || label.toLowerCase().includes(needle)) items.push({ label, what: "", run });
  return items.slice(0, 12);
}

function openPalette(box) {
  const items = paletteItems();
  ui.paletteAt = Math.min(ui.paletteAt, Math.max(items.length - 1, 0));
  ui.paletteList?.remove();
  if (!items.length) return;
  ui.paletteList = h(
    "ul",
    { role: "listbox" },
    items.map((item, i) =>
      h(
        "li",
        { class: i === ui.paletteAt ? "on" : "", role: "option", onmousedown: (e) => (e.preventDefault(), item.run()) },
        item.bot ? keycap(item.bot, 22, "", item.bot.type) : null,
        h("span", {}, item.label),
        item.what ? h("span", { class: "what" }, item.what) : null,
      ),
    ),
  );
  box.append(ui.paletteList);
}

function closePalette() {
  ui.paletteList?.remove();
  ui.paletteList = null;
  ui.paletteAt = 0;
}

/** Opens a new chat and sends the text as its first message. */
function startChatWith(text) {
  ui.palette.value = "";
  ui.palette.blur();
  go("chat");
  ui.input.value = text;
  submit();
}

/**
 * Starts a task, first checking (for free, on this computer) that it has what it needs. When something is
 * missing, says what and how to fix it, instead of letting agents spend money finding out.
 * Resolves to the new task, or null when it was not started.
 */
async function startTask(payload) {
  const reply = await createTask({ owner: payload.bot, title: payload.title, description: payload.text, project: payload.project, anyway: payload.anyway });
  if (!reply) return null;
  // Started: the run, to follow. Waiting its turn: the task, marked as queued.
  return reply.quest ?? { id: null, queued: reply.item };
}

function needsDialog(needs, repositories) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "needs" });
    const done = (value) => (dialog.close(), dialog.remove(), resolve(value));
    const goFix = (need) => {
      done(null);
      if (need.fix === "integrations-git") return ((ui.integration = "git"), go("integrations"));
      if (need.fix === "integrations-openrouter") return ((ui.integration = "openrouter"), go("integrations"));
      if (need.fix === "integrations-ai-models") return ((ui.integration = "ai-models"), go("integrations"));
      go("settings");
    };
    const canSkip = needs.every((n) => n.canSkip);
    fill(
      dialog,
      h("div", { class: "label" }, "Before this task starts"),
      h("h2", {}, needs.length === 1 ? needs[0].title : "A few things are missing"),
      h("p", { class: "note" }, "Nothing has been spent. Agents have not started, so this costs nothing."),
      needs.map((n) =>
        h(
          "div",
          { class: "needrow" },
          needs.length > 1 ? h("b", {}, n.title) : null,
          h("p", {}, n.detail),
          n.fix === "choose-repository"
            ? h("div", { class: "row wrap" }, repositories.map((p) => h("button", { class: "primary", onclick: () => done({ project: p }) }, basename(p))))
            : h("div", { class: "row" }, h("button", { class: "primary", onclick: () => goFix(n) }, n.fix === "integrations-git" ? "Connect a repository" : n.fix === "integrations-openrouter" ? "Connect OpenRouter" : n.fix === "integrations-ai-models" ? "Open AI models" : "Open Settings")),
        ),
      ),
      h("div", { class: "row end" }, h("button", { class: "plain", onclick: () => done(null) }, "Cancel"), canSkip ? h("button", { onclick: () => done({ anyway: true }) }, "Start anyway") : null),
    );
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function sendQuest(bot, text) {
  await attempt(async () => {
    const quest = await startTask({ bot: bot.id, text, project: state.project || undefined });
    if (!quest) return;
    ui.palette.value = "";
    ui.palette.blur();
    await loadQuests();
    quest.id ? go("quest", quest.id) : openTask(quest.queued.id);
  });
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    ui.palette?.focus();
  }
});

// ---------- conversation rendering ----------
function nearBottom() {
  return ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < 120;
}

function onEvent(event) {
  const stick = nearBottom();
  switch (event.type) {
    case "sync":
      renderConversation(event.conversation, event.live);
      break;
    case "user":
      addUser(event.text);
      ui.title.textContent = event.title;
      break;
    case "delta":
      streamDelta(event);
      break;
    case "reset":
      clearStream();
      break;
    case "assistant":
      clearStream();
      addAssistant(event.content);
      break;
    case "tool_result":
      fillResult(event.result);
      break;
    case "approval":
      addApproval(event.approval);
      break;
    case "approval_done":
      document.getElementById(`approval-${event.id}`)?.remove();
      break;
    case "status":
      setRunning(event.running);
      if (event.usage) showUsage(event.usage);
      if (!event.running) clearStream();
      refreshList();
      break;
    case "resumed":
    case "notice":
      ui.log.append(h("div", { class: "banner" }, event.text));
      break;
    case "stopped": {
      // The plain notice just shown becomes the banner with a Continue button.
      const last = ui.log.lastElementChild;
      if (last?.classList.contains("banner") && last.textContent === event.text) last.remove();
      ui.log.append(stopBanner(event.text));
      break;
    }
    case "error":
      ui.log.append(h("div", { class: "banner error" }, event.text));
      break;
  }
  if (stick || event.type === "sync" || event.type === "user") ui.scroll.scrollTop = ui.scroll.scrollHeight;
}

/** Why a run stopped before finishing, kept on the chat, with a button that carries on. */
function stopBanner(text) {
  const words = String(text).replace(/\s*Say “?"?continue"?”?[^.]*\.\s*$/i, "").trim();
  return h(
    "div",
    { class: "banner stopbanner" },
    h("div", { class: "grow" }, h("b", {}, "It stopped before finishing. "), words, h("div", { class: "note small" }, "Nothing is lost. Continue to let it carry on from here, or raise the limit under Settings → Budget per run.")),
    h("button", { class: "primary small", onclick: (e) => (e.currentTarget.closest(".stopbanner")?.remove(), (ui.input.value = "continue"), submit()) }, "Continue"),
  );
}

function renderConversation(conv, live) {
  fill(ui.log, );
  ui.cards.clear();
  ui.stream = null;
  ui.working = null;
  ui.title.textContent = conv.title;
  showUsage(conv.usage);
  for (const message of conv.messages) {
    if (message.role === "assistant") addAssistant(message.content);
    else if (typeof message.content === "string") addUser(message.content);
    else for (const block of message.content) if (block.type === "tool_result") fillResult(block);
  }
  // A new chat with one bot starts by saying who it is and where it sits.
  const withBot = state.view === "chat" ? chatBotOf(conv.id) : undefined;
  if (withBot && !conv.messages.length) {
    const role = roleOf(withBot.id);
    const reports = activeOrg().members.filter((m) => m.manager === withBot.id).map((m) => (state.crew?.bots ?? []).find((b) => b.id === m.bot)?.name).filter(Boolean);
    ui.log.append(
      h(
        "div",
        { class: "empty", style: botStyle(withBot) },
        keycap(withBot, 88, "", withBot.type),
        h("h2", {}, `You're chatting with ${withBot.name}.`),
        h("p", {}, `${role ? `${role.title}, ${role.department}. ` : ""}${withBot.instructions.split(/(?<=[.!?])\s/)[0]}`),
        reports.length ? h("p", { class: "note" }, `${withBot.name} leads ${reports.join(", ")} and can hand them tasks. Their reports come back into this chat.`) : null,
      ),
    );
  }
  if (conv.lastStop && !live.running) ui.log.append(stopBanner(conv.lastStop.text));
  setRunning(live.running);
  for (const delta of live.partial) streamDelta(delta);
  for (const approval of live.approvals) addApproval(approval);
}

function showUsage(usage) {
  const total = (usage?.input || 0) + (usage?.output || 0);
  const dollars = (n) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
  const cost = usage?.cost ? ` · about ${dollars(usage.cost)}` : "";
  const cached = usage?.cached && usage.input ? ` · ${Math.round((usage.cached / usage.input) * 100)}% from cache` : "";
  const saved = usage?.saved >= 0.001 ? ` · about ${dollars(usage.saved)} saved` : "";
  ui.meta.textContent = total ? `${total.toLocaleString()} tokens${cost}${cached}${saved}` : "";
  ui.meta.title = "Read from cache: parts of the chat the AI service had already read, charged at about a tenth of the price. Shortening old steps: large outputs the agent has already used are sent shortened in later steps.";
}

function setRunning(running) {
  state.running = running;
  ui.send.textContent = running ? "Stop" : "Send";
  ui.send.classList.toggle("primary", !running);
  ui.working?.remove();
  ui.working = running ? h("div", { class: "working" }, h("span", { class: "dot" }), "Working…") : null;
  if (ui.working) ui.log.append(ui.working);
}

// New content goes above the "Working…" line so that line stays last.
function add(node) {
  if (ui.working?.isConnected) ui.working.before(node);
  else ui.log.append(node);
  return node;
}

/** How a report from a hand-off begins (REPORT_MARK in src/local/quests.ts). */
const REPORT_MARK = "[Report from ";

function addUser(text) {
  if (!text.startsWith(REPORT_MARK)) return add(h("div", { class: "msg user" }, text));
  // Reports that came back from bots a task was handed to: shown as theirs, not as something the person typed.
  const body = text.replace(/\n\n\[[^\]]*\]\s*$/, "");
  for (const part of body.split(/\n\n(?=\[Report from )/)) {
    const head = /^\[Report from ([^·\]]+) · ([\s\S]*?) · ([^·\]]*)\]\n?/.exec(part);
    const who = head?.[1].trim() ?? "An agent";
    const bot = (state.crew?.bots ?? []).find((b) => b.name === who);
    add(
      h(
        "div",
        { class: "report", style: bot ? botStyle(bot) : "" },
        h("div", { class: "rhead" }, bot ? keycap(bot, 28, "", bot.type) : null, h("b", {}, `${who} reported back`), h("span", { class: "mono small muted" }, head ? `${head[2].trim().slice(0, 70)} · ${head[3].trim()}` : "")),
        h("div", { class: "md" }, renderMarkdown(head ? part.slice(head[0].length) : part)),
      ),
    );
  }
}

function summarize(name, input = {}) {
  if (name === "bash") return input.command || "restart";
  if (name === "str_replace_based_edit_tool") return `${input.command || ""} ${input.path || ""}`;
  if (name === "http_request") return `${input.method || ""} ${input.url || ""}`;
  if (name === "web_search") return input.query || "";
  if (name === "web_fetch") return input.url || "";
  if (name === "memory") return input.text || `${input.action || ""} ${input.id || ""}`;
  if (name === "skill" || name === "schedule") return `${input.action || ""} ${input.name || ""}`;
  if (name === "conversation_search") return input.query || "";
  if (name === "assign_task") return `to ${input.to || "an agent"}: ${input.task || ""}`;
  if (name === "browser") return `${input.action || ""} ${input.url || input.target || ""}`;
  const text = JSON.stringify(input);
  return text === "{}" ? "" : text;
}

const NAMES = { bash: "Shell", str_replace_based_edit_tool: "Files", web_search: "Web search", web_fetch: "Read page", http_request: "API call", memory: "Memory", skill: "Skill", schedule: "Schedule", browser: "Browser", conversation_search: "Search chats", code_execution: "Code", assign_task: "Handed off" };

function toolCard(id, name, input, done) {
  const stateEl = h("span", { class: `state ${done ? "ok" : ""}` }, done ? "done" : "running…");
  const body = h("div", { class: "body" }, h("div", { class: "label" }, "Input"), h("pre", {}, typeof input === "string" ? input : JSON.stringify(input, null, 2)));
  const card = h("details", { class: "tool" }, h("summary", {}, h("span", { class: "name" }, NAMES[name] || name), h("span", { class: "what" }, summarize(name, input)), stateEl), body);
  ui.cards.set(id, { card, body, stateEl });
  return card;
}

/**
 * What the agent saved to memory, shown in the conversation as it happens,
 * with Edit and Undo, so nothing is remembered behind the person's back.
 */
function memoryNote(id, input = {}) {
  if (!["add", "update", "remove"].includes(input.action)) return toolCard(id, "memory", input, false);
  const label = h("span", { class: "mlabel" }, { add: "Remembering…", update: "Updating memory…", remove: "Forgetting…" }[input.action]);
  const text = h("span", { class: "mtext" }, input.text || "");
  const actions = h("span", { class: "mactions" });
  const node = h("div", { class: "memnote" }, h("span", { class: "mmark", "aria-hidden": "true" }, "◆"), h("div", { class: "grow" }, label, text), actions);
  const edit = (entryId) => {
    const box = h("textarea", { rows: 2 }, text.textContent);
    const done = () => (box.replaceWith(text), fill(actions, buttons(entryId)));
    box.value = text.textContent;
    text.replaceWith(box);
    box.focus();
    fill(
      actions,
      h("button", {
        class: "plain",
        onclick: () =>
          attempt(async () => {
            const saved = await api("PATCH", `memory/${entryId}`, { text: box.value });
            text.textContent = saved.text;
            label.textContent = "Memory edited";
            done();
          }, node),
      }, "Save"),
      h("button", { class: "plain", onclick: done }, "Cancel"),
    );
  };
  const buttons = (entryId) => [
    h("button", { class: "plain", onclick: () => edit(entryId) }, "Edit"),
    h("button", {
      class: "plain",
      title: "Remove this from memory",
      onclick: () =>
        attempt(async () => {
          await api("DELETE", `memory/${entryId}`);
          label.textContent = "Removed from memory";
          node.classList.add("gone");
          fill(actions);
        }, node),
    }, "Undo"),
  ];
  ui.cards.set(id, {
    onResult(block) {
      const out = resultText(block.content);
      if (block.is_error) {
        label.textContent = "Could not save to memory";
        node.classList.add("gone");
        node.append(h("div", { class: "note small" }, out));
        return;
      }
      const saved = /\(id ([a-z0-9]+)\) in (.+)\.$/.exec(out);
      if (input.action === "remove") label.textContent = "Removed from memory";
      else label.textContent = `${input.action === "add" ? "Remembered" : "Memory updated"}${saved ? ` · ${saved[2]}` : ""}`;
      if (saved && input.action !== "remove") fill(actions, buttons(saved[1]));
    },
  });
  return node;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content ? JSON.stringify(content, null, 2) : "";
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "image") return "[image]";
      if (part.type === "web_search_result") return `${part.title}\n${part.url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function fillResult(block) {
  const entry = ui.cards.get(block.tool_use_id);
  if (!entry) return;
  if (entry.onResult) return entry.onResult(block);
  const failed = block.is_error || /error$/.test(block.content?.type || "");
  entry.stateEl.textContent = failed ? "failed" : "done";
  entry.stateEl.className = `state ${failed ? "bad" : "ok"}`;
  const text = resultText(block.content);
  if (text) entry.body.append(h("div", { class: "label" }, "Result"), h("pre", {}, text));
}

function addAssistant(content) {
  const box = h("div", { class: "msg" });
  for (const block of content) {
    if (block.type === "text" && block.text.trim()) {
      box.append(h("div", { class: "md" }, renderMarkdown(block.text)));
    } else if (block.type === "thinking" && block.thinking?.trim()) {
      box.append(h("details", { class: "think" }, h("summary", {}, "Thinking"), h("div", { class: "body" }, block.thinking)));
    } else if (block.type === "tool_use" && block.name === "memory") {
      box.append(memoryNote(block.id, block.input));
    } else if (block.type === "tool_use" || block.type === "mcp_tool_use") {
      box.append(toolCard(block.id, block.name, block.input, false));
    } else if (block.type === "server_tool_use") {
      box.append(toolCard(block.id, block.name, block.input, true));
    } else if (/_tool_result$/.test(block.type) && block.tool_use_id) {
      fillResult(block);
    }
  }
  if (box.childNodes.length) add(box);
}

function streamDelta(delta) {
  if (!ui.stream) {
    ui.stream = { box: h("div", { class: "msg" }), text: "", thinking: "", md: null, think: null, tool: null };
    add(ui.stream.box);
  }
  const s = ui.stream;
  if (delta.kind === "thinking") {
    s.thinking += delta.text;
    if (!s.think) s.box.prepend((s.think = h("div", { class: "note" })));
    s.think.textContent = `Thinking: ${s.thinking.slice(-300)}`;
  } else if (delta.kind === "text") {
    s.text += delta.text;
    if (!s.md) s.box.append((s.md = h("div", { class: "md" })));
    if (!s.queued) {
      s.queued = true;
      requestAnimationFrame(() => {
        s.queued = false;
        fill(s.md, renderMarkdown(s.text));
      });
    }
  } else if (delta.kind === "tool") {
    s.box.append(h("div", { class: "note" }, `Preparing: ${NAMES[delta.text] || delta.text}…`));
  }
}

function clearStream() {
  ui.stream?.box.remove();
  ui.stream = null;
}

function addApproval(approval) {
  if (document.getElementById(`approval-${approval.id}`)) return;
  const decide = (decision) => attempt(() => api("POST", `conversations/${state.convId}/approvals/${approval.id}`, { decision }));
  const detail = approval.name === "bash" ? approval.input.command : JSON.stringify(approval.input, null, 2);
  add(
    h(
      "div",
      { class: "approval", id: `approval-${approval.id}` },
      h("strong", {}, `${speaker()} wants to use: ${NAMES[approval.name] || approval.name}`),
      approval.reason ? h("div", { class: "note" }, approval.reason) : null,
      h("pre", {}, detail),
      h(
        "div",
        { class: "row" },
        h("button", { class: "primary", onclick: () => decide("allow") }, "Allow once"),
        approval.reason ? null : h("button", { onclick: () => decide("always") }, `Always allow ${NAMES[approval.name] || approval.name} in this chat`),
        h("button", { class: "danger", onclick: () => decide("deny") }, "Don't allow"),
      ),
    ),
  );
}

// ---------- agents' tiles (drawn further down) and the app's accent ----------
// Initials an agent shows when its tile uses them, by the kind of work, when none are set.
const LEGENDS = { scout: "?", scribe: "Aa", maker: "</>", keeper: "zz", counter: "#", spark: "!" };
// The colours offered for the app's own accent, a per-viewer choice.
const NEON = {
  green: ["Green", "#00d26a"],
  cyan: ["Cyan", "#2ef2ff"],
  magenta: ["Magenta", "#ff3df5"],
  lime: ["Lime", "#b4ff39"],
  amber: ["Amber", "#ffb020"],
  violet: ["Violet", "#a78bff"],
  pink: ["Pink", "#ff4f9a"],
  yellow: ["Yellow", "#f5ff3b"],
  mint: ["Mint", "#3dffc0"],
};
/** Inline style that hands a bot's colour to its row or card (used as var(--bot) in style.css). */
const botStyle = (bot) => {
  const [, onDark, onLight] = tintOf(bot);
  return `--bot: ${onDark}; --bot-l: ${onLight}`;
};

// The app's own accent, a per-viewer choice kept in this browser.
// Dark neon green unless the person picks another.
const DEFAULT_ACCENT = "green";
let accent = DEFAULT_ACCENT;
try {
  accent = NEON[localStorage.getItem("talqava.accent")] ? localStorage.getItem("talqava.accent") : DEFAULT_ACCENT;
} catch {}
function applyAccent(name) {
  accent = NEON[name] ? name : DEFAULT_ACCENT;
  document.documentElement.style.setProperty("--accent", NEON[accent][1]);
  remember("talqava.accent", accent);
}
applyAccent(accent);

/** A row of neon swatches; `onpick` gets the colour's name. */
function swatches(current, onpick, label) {
  return h(
    "div",
    { class: "swatches", role: "group", "aria-label": label },
    Object.entries(NEON).map(([name, [title, hex]]) =>
      h("button", {
        type: "button",
        class: `swatch ${name === current ? "on" : ""}`,
        style: `--swatch: ${hex}`,
        title,
        "aria-label": title,
        "aria-pressed": String(name === current),
        onclick: () => onpick(name),
      }),
    ),
  );
}
const escapeXml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const legendOf = (character, type) => [...String(character?.legend || LEGENDS[type] || "?")].slice(0, 3).join("");
/** How an agent's name and role read in two lines: the name, then its title, or its department when the name is the title. */
const roleLine = (bot, title) => {
  const t = title || bot?.title || "";
  return t && t.toLowerCase() !== String(bot?.name ?? "").toLowerCase() ? t : bot?.group || t;
};

// Each agent is a tile drawn from the logo: a black rounded tile, its role as a
// white line symbol, and a cursor block in its department's colour. The cursor
// turns signal green while the agent works, amber while it waits on you, and red
// when it is stuck, as the logo's cursor shows work in progress.

/** Department colours: [name, on the black tile and in dark theme, as text in light theme]. Calm, told apart by lightness too; green, amber and red stay for status. */
const TINTS = {
  executive: ["Executive", "#E6E6E6", "#2B2B2B"],
  finance: ["Finance", "#2CC5B5", "#0E7A70"],
  sales: ["Sales", "#6AA6FF", "#1F5BC7"],
  marketing: ["Marketing", "#B39BFF", "#6446D0"],
  operations: ["Operations", "#9DB8C8", "#3E6680"],
  technology: ["Technology", "#5CD6EA", "#0B7488"],
  people: ["People", "#F2A0C2", "#A8396A"],
  legal: ["Legal", "#D6C39B", "#7A6536"],
  customers: ["Customers", "#F5B38A", "#9A4E1C"],
  research: ["Research", "#C9D46A", "#5F6A12"],
  product: ["Product", "#D69BEA", "#84389E"],
  neutral: ["Other", "#B8B8B8", "#5E625E"],
};
/** Which colour a department takes, by the words in its name. */
const TINT_WORDS = [
  [/exec|leader|chief|board|founder|management|general|strategy|oversight|audit/i, "executive"],
  [/financ|account|book|payroll|billing|tax/i, "finance"],
  [/sales|business dev|revenue|partnership/i, "sales"],
  [/market|brand|communic|content|social|pr\b|creative|design|writing/i, "marketing"],
  [/oper|supply|logistic|procure|facilit|kitchen|production|admin/i, "operations"],
  [/tech|engineer|it\b|develop|software|security|data|devops/i, "technology"],
  [/people|human|hr\b|talent|recruit/i, "people"],
  [/legal|complian|risk|contract|professional|practice/i, "legal"],
  [/nonprofit|non-profit|charit|fundrais|donor|volunteer|grant/i, "people"],
  [/customer|support|service|success|guest|client/i, "customers"],
  [/research|insight|intelligence|analy/i, "research"],
  [/product|project/i, "product"],
];
const tintOfDepartment = (department) => TINT_WORDS.find(([re]) => re.test(String(department ?? "")))?.[1] ?? "neutral";

/** The white symbols, drawn on a 24-unit grid with 1.7-unit strokes. */
const SYMBOLS = {
  flag: ["Leadership", "M6 21V4M6 4h11l-2 4 2 4H6"],
  chart: ["Numbers", "M4 20h16M7 16v-4M12 16V8M17 16V9"],
  ledger: ["Books", "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"],
  receipt: ["Invoices", "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3"],
  code: ["Code", "M8.5 8l-4 4 4 4M15.5 8l4 4-4 4M13.2 5.5l-2.4 13"],
  shield: ["Security", "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"],
  pen: ["Writing", "M15 5l4 4L8 20H4v-4zM13 7l4 4"],
  megaphone: ["Promotion", "M4 10v4h3l8 4V6l-8 4H4zM18 9.5a3.5 3.5 0 0 1 0 5M7 14l1.2 5h2.4L9.6 15"],
  envelope: ["Email", "M4 6h16v12H4zM4 7l8 6 8-6"],
  target: ["Sales", "M12 21a9 9 0 1 1 9-9M12 16a4 4 0 1 1 4-4M12 12l7-7M15 5h4v4"],
  chat: ["Customers", "M5 5h14v10H10l-4 4v-4H5zM9 10h6"],
  people: ["People", "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 5.2a3 3 0 0 1 0 5.6M17.5 14c2 .6 3 2.4 3 5"],
  scales: ["Legal", "M12 4v16M8 20h8M5 7h14M5 7l-2.6 6a2.8 2.8 0 0 0 5.2 0L5 7zM19 7l-2.6 6a2.8 2.8 0 0 0 5.2 0L19 7z"],
  search: ["Research", "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.2 15.2L20 20"],
  check: ["Quality", "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4"],
  layers: ["Product", "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"],
  calendar: ["Planning", "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"],
  flow: ["Operations", "M4 5h5v5H4zM15 14h5v5h-5zM9 7.5h3.5A2.5 2.5 0 0 1 15 10v4"],
  initials: ["Initials", ""],
};
/** A symbol from the words in the role, most specific first; then the department's. */
const SYMBOL_WORDS = [
  [/chief|general manager|ceo|founder|director|executive assistant/i, "flag"],
  [/book|ledger|reconcil/i, "ledger"],
  [/payable|receivable|billing|invoice|payroll|time and billing/i, "receipt"],
  [/security|it and/i, "shield"],
  [/quality|safety|health|qa\b|fact check|risk check|conflict/i, "check"],
  [/developer|engineer|release|devops|programm/i, "code"],
  [/email/i, "envelope"],
  [/writer|editor|content|copy|notes|design/i, "pen"],
  [/seo|advertis|social|marketing|merchandis|listing|outreach|brand|communic/i, "megaphone"],
  [/sales|account exec|prospect|lead finder|business dev|deal/i, "target"],
  [/support|customer|guest|returns|refund|intake|success|client/i, "chat"],
  [/recruit|people|human|hr\b|benefit|talent/i, "people"],
  [/legal|contract|complian|counsel/i, "scales"],
  [/research|analyst|intelligence|briefing|reporting|requirements|data/i, "search"],
  [/financ|controller|costing|cash|budget|counter/i, "chart"],
  [/product manager|product owner/i, "layers"],
  [/project|schedul|planner|production|calendar/i, "calendar"],
  [/oper|coordinat|procure|inventory|fulfil|supply|logistic/i, "flow"],
];
const symbolFor = (text) => SYMBOL_WORDS.find(([re]) => re.test(String(text ?? "")))?.[1];

/** What a tile shows for one agent: its symbol, its colour and its initials. Accepts an agent, or just its look. */
function tileOf(subject) {
  const bot = subject?.character ? subject : { character: subject ?? {} };
  const character = bot.character ?? {};
  const role = (bot.id && roleOf(bot.id)) || null;
  const title = role?.title ?? bot.title ?? bot.listing?.title ?? bot.name ?? "";
  // On the chart, the agent's department; in the marketplace, its listed category; else the kind of work it does.
  const department = role?.department ?? bot.listing?.category ?? bot.group ?? "";
  const tint = TINTS[character.tint] ? character.tint : tintOfDepartment(department || title);
  const symbol = SYMBOLS[character.symbol] ? character.symbol : symbolFor(title) ?? symbolFor(bot.name) ?? symbolFor(department) ?? "initials";
  return { tint, symbol, legend: legendOf(character, bot.type) };
}
const tintOf = (subject) => TINTS[tileOf(subject).tint];

/**
 * An agent's tile. Moods: "" (at rest), working (green cursor, blinking), waiting (amber cursor and a dashed
 * frame), done (a green tick), stuck (red cursor and a cross), asleep (dimmed). The name `keycap` is kept
 * because the whole app calls it; pass the agent itself, so its role and department pick the tile.
 */
function keycap(subject, size = 40, mood = "") {
  const t = tileOf(subject);
  const [, tileColour] = TINTS[t.tint];
  const cursor = mood === "working" ? "#00D26A" : mood === "waiting" ? "#FFB020" : mood === "stuck" ? "#FF6B6B" : tileColour;
  const small = size < 28;
  const path = SYMBOLS[t.symbol]?.[1];
  const legend = escapeXml(t.legend);
  const n = [...t.legend].length;
  const mark = path
    ? `<g class="t-symbol" transform="translate(12 8.5)" fill="none" stroke="#F2F2F2" stroke-width="${small ? 2.4 : size < 48 ? 1.9 : 1.7}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`
    : `<text class="t-symbol" x="24" y="27.5" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-weight="700" font-size="${n === 1 ? 17 : n === 2 ? 14 : 11}" fill="#F2F2F2">${legend}</text>`;
  const badge =
    mood === "done" && !small
      ? `<circle cx="41" cy="7" r="6" fill="#00D26A" stroke="var(--panel, #fff)" stroke-width="1.5"/><path class="k-tick" d="M38.4 7.2l1.8 1.8 3.4-3.6" fill="none" stroke="#04210F" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8"/>`
      : mood === "stuck" && !small
        ? `<circle cx="41" cy="7" r="6" fill="#FF6B6B" stroke="var(--panel, #fff)" stroke-width="1.5"/><path d="M38.8 4.8l4.4 4.4M43.2 4.8l-4.4 4.4" stroke="#2B0505" stroke-width="1.6" stroke-linecap="round"/>`
        : "";
  const frame = mood === "waiting" ? `<rect class="k-march" x="0.5" y="0.5" width="47" height="47" rx="12.5" fill="none" stroke="#FFB020" stroke-width="1.4" stroke-dasharray="3 2.6"/>` : "";
  const svg =
    `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 48 48">${frame}` +
    `<rect class="t-tile" x="2" y="2" width="44" height="44" rx="11" fill="#0A0A0A" stroke="#2A2A2A" stroke-width="${small ? 2 : 1}"/>${mark}` +
    `<rect class="t-cursor" x="${small ? 16 : 18}" y="${small ? 33.5 : 34.5}" width="${small ? 16 : 12}" height="${small ? 6 : 5}" rx="1" fill="${cursor}"/>${badge}</svg>`;
  const node = h("span", { class: `keychar tile ${mood ? `k-${mood}` : "k-idle"}`, style: `--bot: ${tileColour}` });
  node.innerHTML = svg;
  return node;
}

const isLive = (q) => q.status === "running" || q.status === "waiting";
// "done" (the tick) only for a result that passed its check.
const mood = (q) =>
  q?.status === "waiting" ? "waiting" : q?.status === "running" || q?.checking ? "working" : q?.status === "failed" || (q?.check && !q.check.passed) ? "stuck" : q?.check?.passed ? "done" : "";

/** How a quest stands: a glyph and a word or two, and whether it needs attention. */
function standing(q) {
  if (q.status === "waiting") return ["◌ Waiting on you", "loud"];
  if (q.status === "asking" && q.plan?.status === "proposed") return ["◌ Plan to approve", "loud"];
  if (q.status === "asking") return ["? Needs your answer", "loud"];
  if (q.status === "running") return q.template?.tries ? [`● Fixing · try ${q.template.tries} of ${q.template.maxTries}`, "loud"] : ["● Working", "loud"];
  if (q.checking) return ["◌ Checking the result", "loud"];
  if (q.check && !q.check.passed && q.status === "done") return ["✕ Check failed", "loud"];
  if (q.branch && !q.outcome && q.changedFiles === 0 && q.status === "done") return ["✓ Done · no changes", ""];
  if (q.branch && !q.outcome && q.status !== "failed") return [q.check?.passed ? "✓ Checked · ready for review" : "→ Ready for review", "loud"];
  if (q.outcome === "accepted") return ["✓ Changes kept", ""];
  if (q.outcome === "undone") return ["↶ Undone", ""];
  if (q.resumedAt && q.status === "done") return ["↺ Done after restart", ""];
  if (q.check?.passed && q.status === "done") return ["✓ Checked", ""];
  return { done: ["✓ Done", ""], stopped: ["■ Stopped", ""], budget: ["■ Hit its budget", ""], failed: ["✕ Failed", "loud"] }[q.status] || [q.status, ""];
}

function modelChip(info) {
  if (!info?.kind) return h("span", { class: "chip bad", title: info?.label || "" }, "No model");
  if (info.kind === "anthropic") return h("span", { class: "chip", title: info.label }, "Claude · key");
  return h("span", { class: "chip", title: info.label }, info.free ? "Local" : "Your key");
}

const POWER_NAMES = {
  web: "Web search and read pages",
  memory: "Memory",
  skills: "Skills",
  search: "Search past chats",
  files: "Files",
  shell: "Shell commands",
  api: "API calls with stored keys",
  schedule: "Schedules",
  browser: "Browser",
  connectors: "Connectors",
};

// ---------- home base ----------
function homeView() {
  ui.body.className = "body three";
  ui.crewCol = h("aside", { class: "side", "aria-label": "Agents" });
  ui.board = h("main", { class: "center" });
  ui.logCol = h("aside", { class: "logcol", "aria-label": "Completed work" });
  fill(ui.body, ui.crewCol, ui.board, ui.logCol);
  renderHome();
}

function renderHome() {
  if (state.view !== "home" || !ui.board) return;
  renderCrewColumn();
  renderBoard();
  renderLog();
}

/** The agents the work page is about: the members of the organization that is selected, or everyone when it has none. */
function orgBots() {
  const bots = state.crew?.bots ?? [];
  const members = new Set(activeOrg().members.map((m) => m.bot));
  const mine = bots.filter((b) => members.has(b.id));
  return mine.length ? mine : bots;
}

/** Bots by department in the selected organization, departments in name order. */
function byDepartment(bots) {
  const groups = new Map();
  for (const bot of bots) groups.set(departmentOf(bot.id), [...(groups.get(departmentOf(bot.id)) ?? []), bot]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Bots by team group, groups in name order. */
function byGroup(bots) {
  const groups = new Map();
  for (const bot of bots) groups.set(bot.group || "Other", [...(groups.get(bot.group || "Other") ?? []), bot]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderCrewColumn() {
  const all = state.crew?.bots ?? [];
  const bots = orgBots();
  const org = activeOrg();
  const orgs = state.orgs?.orgs ?? [];
  const orgPick = h("select", { class: "orgpick", "aria-label": "Organization", onchange: (e) => attempt(async () => (await api("PATCH", `orgs/${e.target.value}`, { active: true }), await loadOrgs(), (state.selectedBot = null), renderHome())) }, orgs.map((o) => h("option", { value: o.id, selected: o.id === org.id }, o.name)));
  const live = new Map(state.quests.filter(isLive).map((q) => [q.bot.id, q]));
  const fromRepo = bots.some((b) => b.source === "project");
  const member = (bot) => {
    const q = live.get(bot.id);
    const status = q ? (q.status === "waiting" ? "◌ Waiting on you" : `● Working · step ${q.steps || 1}`) : bot.month?.state === "stopped" ? "■ At its monthly budget" : "Available";
    return h(
      "button",
      {
        class: `member ${bot.id === state.selectedBot ? "on" : ""}`,
        style: botStyle(bot),
        title: bot.instructions,
        onclick: () => {
          state.selectedBot = bot.id;
          state.selectedTeam = null;
          remember("talqava.bot", bot.id);
          if (ui.palette) ui.palette.placeholder = paletteHint();
          if (q) go("quest", q.id);
          else renderHome();
        },
        ondblclick: () => go("bot", bot.id),
      },
      keycap(bot, 36, mood(q), bot.type),
      h("span", { class: "who" }, h("b", {}, bot.name), ((t) => (t && t.toLowerCase() !== bot.name.toLowerCase() ? h("span", { class: "type" }, t) : null))(roleOf(bot.id)?.title ?? bot.title), h("span", { class: `status ${q?.status === "waiting" ? "wait" : ""}` }, ((n) => (n && !q ? `${status} · ${n} done this week` : status))(state.quests.filter((x) => x.bot.id === bot.id && !isLive(x) && within(x.updatedAt, WEEK)).length))),
      // The model is only worth a mention here when the bot has none it can use.
      bot.modelInfo?.kind ? null : modelChip(bot.modelInfo),
      h("span", { class: "plain edit", role: "button", onclick: (e) => (e.stopPropagation(), go("bot", bot.id)) }, "Edit"),
    );
  };
  fill(ui.crewCol, 
    orgs.length > 1 ? h("label", { class: "sidelabel" }, "Organization", orgPick) : null,
    h("div", { class: "side-head" }, h("h2", { class: "label" }, `${orgs.length > 1 ? "" : `${org.name || "Organization"} · `}${bots.length} agent${bots.length === 1 ? "" : "s"} · ${new Set(bots.map((b) => departmentOf(b.id))).size} department${new Set(bots.map((b) => departmentOf(b.id))).size === 1 ? "" : "s"}`), h("button", { class: "plain small", onclick: () => go("team"), title: "The org chart, departments and budgets" }, "Chart →")),
    fromRepo ? h("div", { class: "note small", style: "padding: 0 8px" }, ".crew/ in this repo") : null,
    ...byDepartment(bots).flatMap(([group, members]) => [h("div", { class: "grouplabel" }, `${group} · ${members.length}`), ...members.map(member)]),
    all.length > bots.length ? h("p", { class: "note small", style: "padding: 6px 8px 0" }, `${all.length - bots.length} more agent${all.length - bots.length === 1 ? " is" : "s are"} on your team but not in this organization. `, h("button", { class: "plain link", onclick: () => go("team") }, "Add them on the chart")) : null,
    state.crew?.problems?.length ? h("div", { class: "banner error small" }, state.crew.problems.map((p) => h("div", {}, p.problem))) : null,
    h("button", { class: "hatch", onclick: () => go("market") }, "+ Add from the marketplace"),
    h("button", { class: "hatch", onclick: () => go("bot", "new") }, "+ Create an agent"),
    navFooter(),
  );
}

const cap = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

/** Pages are reached from the rail on the left, so the side columns carry no links of their own. */
function navFooter() {
  return null;
}

// Tasks worth suggesting to each department, so the box is never a blank page.
const TASK_IDEAS = {
  Sales: ["Research 10 prospects that fit our ideal customer, and say why each fits", "Draft a follow-up for a prospect who has gone quiet", "Prepare me for a sales call: what to ask and the likely objections"],
  Marketing: ["Write this month's customer newsletter from my notes", "Draft three social posts announcing our latest news", "Rewrite our homepage introduction so it is clearer"],
  Finance: ["Summarise income and costs from the file I share, against last month", "List overdue invoices and draft a reminder for each", "Build a 13-week cash forecast from my figures"],
  Operations: ["Write down how we do a recurring job as a step-by-step checklist", "Give me a weekly report of what is overdue and who it is waiting on", "Compare three suppliers on price, terms and delivery"],
  Research: ["Compare our top three competitors on price and features, with sources", "Find out what rules apply to our business in our area", "What do customers say they dislike about products like ours?"],
  "Customer Support": ["Draft replies to the customer questions I paste", "Group this week's complaints by cause and suggest fixes", "Write an onboarding plan for a new customer"],
  People: ["Write a job description and interview scorecard for a role", "Draft an onboarding checklist for a new hire", "Screen the applications I share against the scorecard"],
  Legal: ["Summarise this contract: who must do what, by when, and the risks", "List our contracts and when each renews", "Check this plan against our own policies"],
  Leadership: ["Turn this goal into a plan across departments, with owners and dates", "Report where each department stands against its targets", "List the decisions that are waiting on me"],
  Product: ["Write the problem, the evidence and success measure for an idea", "Turn this request into acceptance criteria", "Rank these ideas and say what each displaces"],
  Engineering: ["Fix a bug I describe and run the tests", "Add tests for a file", "Review this change against the plan"],
  Communications: ["Draft an announcement from my notes", "Edit this draft and keep my voice", "Turn these points into an email I can send"],
};
const WEEK = 7 * 24 * 3600 * 1000;
const within = (iso, ms) => Date.now() - new Date(iso).getTime() < ms;
const departmentOf = (botId) => roleOf(botId)?.department ?? state.crew?.bots.find((b) => b.id === botId)?.group ?? "Other";
/** How long ago something started, in a word or two. */
const elapsed = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? "just now" : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
};

/**
 * The work page: assign work, see what needs the person, follow what is under
 * way down the chain of hand-offs, and read how each department is doing.
 * Ordered by what the person should do next, not by what the software has.
 */
function renderBoard() {
  const quests = state.quests ?? [];
  const bots = orgBots();
  const active = quests.filter(isLive);
  const selectedAgent = bots.find((b) => b.id === state.selectedBot) ?? bots[0];
  const { needs } = inboxItems();
  const week = quests.filter((q) => !isLive(q) && within(q.updatedAt, WEEK));
  const succeeded = week.filter((q) => q.status === "done" && !(q.check && !q.check.passed));
  const weekAll = quests.filter((q) => within(q.updatedAt, WEEK));
  const spent = weekAll.reduce((n, q) => n + (q.cost || 0), 0);
  const stat = (label, value, note, loud) => h("div", { class: "stat" }, h("span", { class: "label" }, label), h("b", { class: loud ? "loud" : "" }, value), note ? h("span", { class: "statnote" }, note) : null);

  // ----- assign a task: to a whole team (through its manager, who splits it up) or to one agent -----
  const orgMembers = activeOrg().members.filter((m) => bots.some((b) => b.id === m.bot));
  const underOf = (id) => {
    const all = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of orgMembers) if (m.manager && all.has(m.manager) && !all.has(m.bot)) (all.add(m.bot), (grew = true));
    }
    return all.size - 1;
  };
  const teams = orgMembers
    .filter((m) => orgMembers.some((x) => x.manager === m.bot))
    .map((m) => ({ lead: m.bot, name: m.department && m.department !== "Leadership" ? `${m.department} team` : `Everyone under the ${bots.find((b) => b.id === m.bot)?.name}`, size: underOf(m.bot) + 1 }))
    .sort((a, b) => b.size - a.size);
  const team = teams.find((t) => t.lead === state.selectedTeam) ?? null;
  const selected = team ? bots.find((b) => b.id === team.lead) : selectedAgent;
  const who = h(
    "select",
    {
      "aria-label": "Assign to",
      onchange: (e) => {
        const value = e.target.value;
        if (value.startsWith("team:")) state.selectedTeam = value.slice(5);
        else (state.selectedTeam = null), (state.selectedBot = value), remember("talqava.bot", value);
        state.draftTask = what.value;
        renderHome();
      },
    },
    teams.length ? h("optgroup", { label: "Teams" }, teams.map((t) => h("option", { value: `team:${t.lead}`, selected: t.lead === team?.lead }, `${t.name} · ${t.size} agents`))) : null,
    byDepartment(bots).map(([group, members]) => h("optgroup", { label: `${group} · one agent` }, members.map((b) => h("option", { value: b.id, selected: !team && b.id === selected?.id }, b.name)))),
  );
  const what = h("textarea", { rows: 2, placeholder: team ? `What should the ${team.name} do? Say what a good result looks like.` : selected ? `What should the ${selected.name} do? Say what a good result looks like.` : "What needs doing?", "aria-label": "The task" }, state.draftTask ?? "");
  what.addEventListener("input", () => (state.draftTask = what.value));
  const assign = h("button", { class: "primary" }, team ? "Assign to the team" : "Assign task");
  // The repository the task is about, where any are connected. With one connected and none chosen, the task gets that one.
  const repos = state.config?.projects ?? [];
  const repoPick = repos.length
    ? h("label", { class: "repoline" }, "Repository", h("select", { "aria-label": "Repository for this task", onchange: (e) => ((state.project = e.target.value), remember("talqava.project", state.project), loadCrew().then(() => (renderTop(), renderHome()))) }, repos.length > 1 || state.project ? h("option", { value: "", selected: !state.project }, repos.length === 1 ? "None" : "None chosen") : null, repos.map((p) => h("option", { value: p, selected: p === state.project || (repos.length === 1 && !state.project) }, basename(p)))))
    : null;
  const send = () =>
    Promise.resolve(attempt(async () => {
      const text = what.value.trim();
      if (!selected || text.length < 3) return what.focus();
      assign.disabled = true;
      // A team's task goes to its manager, with the instruction to share it out and bring back one result.
      const forTeam = team ? `${text}\n\n[This task is for your whole team (the ${team.name}), not for you alone. Split it into parts and hand each part to the right member of your team with assign_task. When their reports come back, check them, put them together, and give one combined result. Do only the parts that nobody on your team can do.]` : text;
      const started = await startTask({ bot: selected.id, text: forTeam, title: team ? `${team.name}: ${text}` : undefined, project: state.project || undefined });
      if (!started) return;
      state.draftTask = "";
      await loadQuests();
      renderHome();
    }, ui.board)).finally(() => (assign.disabled = false));
  assign.addEventListener("click", send);
  what.addEventListener("keydown", (e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send());
  const ideas = selected ? (TASK_IDEAS[departmentOf(selected.id)] ?? TASK_IDEAS[selected.group] ?? []) : [];
  const leads = selected && activeOrg().members.some((m) => m.manager === selected.id);
  const composer = h(
    "section",
    { class: "card assignbox", style: selected ? botStyle(selected) : "" },
    h("div", { class: "assignrow" }, selected ? keycap(selected, 40, "", selected.type) : null, h("div", { class: "grow" }, h("div", { class: "row" }, h("span", { class: "label", style: "margin: 0" }, "Assign a task to"), who, team ? h("span", { class: "note small" }, `A whole team: the ${selected.name} shares the work out across ${team.size - 1} agent${team.size === 2 ? "" : "s"} and brings back one result`) : selected ? h("span", { class: "note small" }, `One agent · ${departmentOf(selected.id)}${leads ? " · can hand parts to its team" : ""}`) : null), what)),
    repoPick ? h("div", { class: "assignmeta" }, repoPick, h("span", { class: "note small" }, repos.length === 1 && !state.project ? "Your connected repository is used automatically." : state.project ? "Agents that change files work in their own copy; you review before anything is kept." : "Choose one if the task is about your code.")) : null,
    h("div", { class: "assignfoot" }, h("div", { class: "ideachips" }, ideas.map((idea) => h("button", { type: "button", class: "ideachip", title: "Use this as a starting point", onclick: () => ((what.value = idea), (state.draftTask = idea), what.focus()) }, idea))), assign),
  );

  // ----- what is under way, as chains of hand-offs -----
  const childrenOf = (id) => active.filter((q) => q.parent?.id === id);
  const roots = active.filter((q) => !q.parent || !active.some((p) => p.id === q.parent.id));
  const flow = (q, depth = 0) => {
    const approval = q.approvals?.[0];
    const pct = q.budget?.steps ? Math.min(100, Math.round(((q.steps || 0) / q.budget.steps) * 100)) : null;
    const doing = approval ? `Wants to use ${NAMES[approval.name] || approval.name}` : q.checking ? "Checking the result" : q.activity ? `${NAMES[q.activity.name] || q.activity.name}: ${summarize(q.activity.name, q.activity.input)}` : "Thinking";
    const kindWord = q.kind === "question" ? "Question" : q.kind === "decision" ? "Decision" : /^Request: /.test(q.title) ? "Request" : null;
    return [
      h(
        "button",
        { class: `flowrow ${approval ? "wait" : ""}`, style: `${botStyle(q.bot)}; --depth: ${depth}`, onclick: () => go("quest", q.id) },
        depth ? h("span", { class: "flowelbow", "aria-hidden": "true" }) : null,
        keycap(q.bot, 30, mood(q), q.bot.type),
        h("span", { class: "flowmain" }, h("b", {}, kindWord ? h("span", { class: "chip" }, kindWord) : null, q.title.replace(/^(Question|Request|Decision needed): /, "")), h("span", { class: "flowsub" }, `${q.bot.name} · ${departmentOf(q.bot.id)}${q.parent ? ` · from ${q.parent.by}` : ""} · ${doing}`), q.said ? h("span", { class: "flowsaid" }, q.said.replace(/\s+/g, " ").slice(0, 200)) : null),
        h("span", { class: "flowmeta" }, pct != null ? h("span", { class: "track", title: `Step ${q.steps || 0} of up to ${q.budget.steps}` }, h("span", { style: `width: ${pct}%; background: var(--bot)` })) : null, h("span", { title: q.chain && q.chain.tasks > 1 ? `This task alone: ${money(q.cost || 0)}. With the ${q.chain.tasks - 1} it handed on: ${money(q.chain.cost)}, of a shared budget of ${money(q.chain.budget)}.` : "" }, q.chain && q.chain.tasks > 1 ? `${elapsed(q.createdAt)} · ${money(q.chain.cost)} with ${q.chain.tasks - 1} handed on` : `${elapsed(q.createdAt)} · ${money(q.cost || 0)}`)),
      ),
      ...childrenOf(q.id).flatMap((c) => flow(c, depth + 1)),
    ];
  };

  // ----- how each department is doing this week -----
  const depts = new Map();
  const row = (name) => depts.get(name) ?? depts.set(name, { name, agents: 0, active: 0, waiting: 0, done: 0, failed: 0, spent: 0 }).get(name);
  for (const b of bots) row(departmentOf(b.id)).agents++;
  for (const q of active) (q.approvals?.length ? row(departmentOf(q.bot.id)).waiting++ : row(departmentOf(q.bot.id)).active++);
  for (const q of week) (succeeded.includes(q) ? row(departmentOf(q.bot.id)).done++ : row(departmentOf(q.bot.id)).failed++);
  for (const q of weekAll) row(departmentOf(q.bot.id)).spent += q.cost || 0;
  const rows = [...depts.values()].sort((a, b) => b.active + b.waiting + b.done + b.failed - (a.active + a.waiting + a.done + a.failed) || a.name.localeCompare(b.name));
  const busiest = Math.max(1, ...rows.map((r) => r.active + r.waiting + r.done + r.failed));
  const idle = rows.filter((r) => r.active + r.waiting + r.done + r.failed === 0).map((r) => r.name);
  const stuck = rows.filter((r) => r.waiting > 0 && r.waiting >= r.active).map((r) => r.name);
  const insight = !weekAll.length
    ? "No work yet this week. Assign a first task above: pick an agent and use one of the suggestions."
    : [stuck.length ? `${stuck.join(", ")} ${stuck.length === 1 ? "is" : "are"} waiting on you more than working: clear the approvals to unblock ${stuck.length === 1 ? "it" : "them"}.` : "", idle.length && idle.length < rows.length ? `No work this week in ${idle.slice(0, 4).join(", ")}${idle.length > 4 ? ` and ${idle.length - 4} more` : ""}.` : "", week.length - succeeded.length ? `${week.length - succeeded.length} task${week.length - succeeded.length === 1 ? "" : "s"} did not finish cleanly: open ${week.length - succeeded.length === 1 ? "it" : "them"} under Completed work.` : ""].filter(Boolean).join(" ") || "Work is flowing: nothing is blocked on you.";

  fill(ui.board, 
    h("div", { class: "board-head" }, h("div", {}, h("h1", {}, "Work in progress"), h("p", { class: "lead" }, "Assign work, clear what is waiting on you, and see how each department is doing."))),
    composer,
    h(
      "section",
      { class: "stats" },
      stat("Waiting on you", String(needs.length), needs.length ? "Approvals, reviews and failures" : "Nothing blocked", needs.length > 0),
      stat("In progress", String(active.length), active.length ? `${new Set(active.map((q) => q.bot.id)).size} agent${new Set(active.map((q) => q.bot.id)).size === 1 ? "" : "s"} working` : "No tasks under way"),
      stat("Finished this week", String(week.length), week.length ? `${Math.round((succeeded.length / week.length) * 100)}% finished cleanly` : "None yet"),
      stat("Spent this week", money(spent), weekAll.length ? `${money(spent / weekAll.length)} a task on average` : "Estimated from list prices"),
    ),
    needs.length
      ? h("section", { class: "worksec" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "Waiting on you"), h("button", { class: "plain small", onclick: () => go("inbox") }, "Open inbox →")), h("div", { class: "cards" }, needs.filter((n) => n.kind === "approval").map((n) => questCard(n.q))), h("div", { class: "needlist" }, needs.filter((n) => n.kind !== "approval").map(needRow)))
      : null,
    h(
      "section",
      { class: "worksec" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "Under way"), active.length ? h("span", { class: "note small" }, "Indented tasks were handed on by the one above") : null),
      active.length ? h("div", { class: "flow" }, roots.flatMap((q) => flow(q))) : h("div", { class: "card quiet" }, h("b", {}, "Nothing under way."), h("span", { class: "note" }, " Assign a task above. A lead will split it across its team, and each hand-off shows here beneath it.")),
    ),
    ((results) =>
      results.length
        ? h("section", { class: "worksec" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "Latest results"), h("button", { class: "plain small", onclick: () => go("inbox") }, "All updates →")), h("div", { class: "updates" }, results.map((q) => updateCard(q, { compact: true }))))
        : null)(ownTasks().filter((q) => !isLive(q)).slice(0, 3)),
    h(
      "section",
      { class: "worksec" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, `Departments this week · ${activeOrg().name || "your organization"}`), h("button", { class: "plain small", onclick: () => go("team") }, "Organization →")),
      h("p", { class: "note insight" }, insight),
      h(
        "div",
        { class: "depttable", role: "table" },
        h("div", { class: "dhead", role: "row" }, ...["Department", "Agents", "Working", "Waiting on you", "Finished", "Not clean", "Spent", "Load"].map((x) => h("span", { role: "columnheader" }, x))),
        rows.map((r) =>
          h("div", { class: "drow", role: "row" }, h("b", {}, r.name), h("span", {}, String(r.agents)), h("span", {}, String(r.active)), h("span", { class: r.waiting ? "loud" : "" }, String(r.waiting)), h("span", {}, String(r.done)), h("span", { class: r.failed ? "warn" : "" }, String(r.failed)), h("span", {}, money(r.spent)), h("span", { class: "track" }, h("span", { style: `width: ${Math.round(((r.active + r.waiting + r.done + r.failed) / busiest) * 100)}%; background: var(--accent)` }))),
        ),
      ),
    ),
    coreQuests(),
  );
}

/** One thing that needs the person, other than an approval: a review, a failed check, a failure, a budget reached. */
function needRow(n) {
  if (!n.q) {
    const words = n.kind === "chat" ? [n.c.title || "A chat", "A chat is waiting for your approval", () => go("chat", n.c.id)] : n.kind === "monthly" ? [`${n.bot.name} has reached its monthly budget`, "It starts no new work until you raise it", () => go("bot", n.bot.id)] : ["The monthly budget for all agents is used up", "No agent starts new work until you raise it", () => go("team")];
    return h("button", { class: "needrow", onclick: words[2] }, h("span", { class: "flowmain" }, h("b", {}, words[0]), h("span", { class: "flowsub" }, words[1])), h("span", { class: "pill loud" }, "Open"));
  }
  const why = { review: "Changes ready for your review", check: "Finished, but its check failed", failed: n.q.note ? `Failed: ${n.q.note}` : "Failed", budget: "Stopped at its budget: say “continue” to keep going" }[n.kind] ?? "";
  return h("button", { class: "needrow", style: botStyle(n.q.bot), onclick: () => go("quest", n.q.id) }, keycap(n.q.bot, 30, mood(n.q), n.q.bot.type), h("span", { class: "flowmain" }, h("b", {}, n.q.title), h("span", { class: "flowsub" }, `${n.q.bot.name} · ${departmentOf(n.q.bot.id)} · ${why}`)), h("span", { class: "pill loud" }, n.kind === "review" ? "Review" : "Open"));
}

/** The ready-made quests, each with the bot that goes and how its result is checked. */
function coreQuests() {
  const templates = state.templates ?? [];
  if (!templates.length) return null;
  const bots = state.crew?.bots ?? [];
  const checkWords = (c) =>
    [c.command && "runs the tests", c.changed && c.changed !== "any" && `${c.changed} changes`, c.covers && "covers everything", c.links && `${c.links}+ sources`].filter(Boolean).join(" · ");
  return h(
    "section",
    { class: "core worksec" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "Checked task templates"), h("span", { class: "note small" }, "Ready-made tasks whose result is checked automatically before it counts as done")),
    h(
      "div",
      { class: "core-grid" },
      templates.map((t) => {
        const bot = bots.find((b) => b.id === t.bot);
        return h(
          "button",
          { class: `core-card ${state.coreOpen === t.id ? "on" : ""}`, onclick: () => openCoreQuest(state.coreOpen === t.id ? null : t.id) },
          h("span", { class: "row" }, bot ? keycap(bot, 28, "", bot.type) : null, h("b", {}, t.name)),
          h("span", { class: "note small" }, t.summary),
          h("span", { class: "mono small muted" }, `${bot ? bot.name : t.bot} · check: ${checkWords(t.check) || "your review"}`),
        );
      }),
    ),
    state.coreOpen ? coreForm(templates.find((t) => t.id === state.coreOpen)) : null,
  );
}

function openCoreQuest(id) {
  state.coreOpen = id;
  renderHome();
  setTimeout(() => ui.board?.querySelector(".core-form input, .core-form button.primary")?.focus(), 0);
}

function coreForm(t) {
  if (!t) return null;
  const fields = t.inputs.map((input) => [input, h("input", { id: `core-${input.id}`, placeholder: input.placeholder || "", value: input.default || "" })]);
  const where =
    t.repository === "none"
      ? "Works without a repository."
      : state.project
        ? `On ${basename(state.project)}, in its own branch and copy.`
        : t.repository === "required"
          ? "Needs a repository: choose one in the box at the top left first."
          : "No repository chosen: give the GitHub repository below.";
  const start = h("button", { class: "primary" }, "Start");
  start.addEventListener("click", () =>
    attempt(async () => {
      start.disabled = true;
      start.textContent = "Gathering…";
      try {
        const inputs = Object.fromEntries(fields.map(([input, el]) => [input.id, el.value]));
        const quest = await api("POST", "quests", { template: t.id, inputs, project: state.project || undefined });
        state.coreOpen = null;
        await loadQuests();
        go("quest", quest.id);
      } finally {
        start.disabled = false;
        start.textContent = "Start";
      }
    }, ui.board),
  );
  return h(
    "div",
    { class: "card core-form" },
    h("b", {}, t.name),
    h("p", { class: "note" }, where),
    fields.map(([input, el]) => h("label", { class: "field", for: `core-${input.id}` }, `${input.label}${input.required ? "" : " (optional)"}`, el)),
    h("div", { class: "row" }, start, h("button", { onclick: () => openCoreQuest(null) }, "Cancel")),
  );
}

function questCard(q) {
  const decide = (approval, decision) => (e) => {
    e.stopPropagation();
    attempt(async () => {
      await api("POST", `conversations/${q.id}/approvals/${approval.id}`, { decision });
      await loadQuests();
      renderHome();
    }, ui.board);
  };
  const approval = q.approvals[0];
  const doing = q.activity ? `${NAMES[q.activity.name] || q.activity.name}: ${summarize(q.activity.name, q.activity.input)}` : "Thinking";
  const showOutput = q.activity && q.status === "running" && (q.activity.name === "bash" ? `$ ${q.activity.input?.command ?? ""}\n${q.activity.output}` : q.activity.output);
  return h(
    "article",
    { class: `qcard ${q.status}`, style: botStyle(q.bot), onclick: () => go("quest", q.id), tabindex: "0", onkeydown: (e) => e.key === "Enter" && go("quest", q.id) },
    q.status === "running" ? h("div", { class: "scanline", "aria-hidden": "true" }, h("span")) : null,
    h("div", { class: "head" }, h("b", {}, q.title), keycap(q.bot, 28, mood(q), q.bot.type)),
    approval
      ? h("div", { class: "now wait" }, `◌ ${q.bot.name} wants to use ${NAMES[approval.name] || approval.name}`)
      : h("div", { class: "now" }, `● ${q.bot.name} · step ${q.steps || 1}${q.budget?.steps ? ` of up to ${q.budget.steps}` : ""} · ${doing}`),
    approval ? h("pre", {}, approval.name === "bash" ? approval.input.command : JSON.stringify(approval.input, null, 2)) : showOutput ? h("pre", {}, showOutput.trim()) : null,
    approval?.reason || (q.readOutside && q.status === "running")
      ? h("div", { class: "caution" }, `Read outside content, so any change ${q.bot.name} wants to make now needs your approval.`)
      : null,
    approval
      ? h(
          "div",
          { class: "row" },
          h("button", { class: "primary", onclick: decide(approval, "allow") }, "Allow once"),
          approval.reason ? null : h("button", { onclick: decide(approval, "always") }, "Always, for this task"),
          h("button", { class: "danger", onclick: decide(approval, "deny") }, "Deny"),
        )
      : null,
    h(
      "div",
      { class: "foot" },
      q.branch ? h("span", { class: "mono" }, q.branch) : null,
      h("span", {}, q.model?.kind === "anthropic" ? "Claude" : q.model?.free ? "Local model · free" : q.model?.label || ""),
      q.cost >= 0.001 || q.budget?.spend ? h("span", {}, `${money(q.cost || 0)}${q.budget?.spend ? ` of ${money(q.budget.spend)}` : ""}`) : null,
    ),
  );
}

function renderLog() {
  const done = state.quests.filter((q) => !isLive(q));
  fill(ui.logCol, 
    h("h2", { class: "label" }, "Completed work"),
    done.length
      ? done.slice(0, 40).map((q) => {
          const [label, tone] = standing(q);
          const detail = q.status === "failed" && q.note ? q.note : q.resumedAt ? "picked up after a restart" : q.branch ? q.branch : "";
          return h(
            "button",
            { class: "logitem", style: botStyle(q.bot), onclick: () => go("quest", q.id) },
            h("div", { class: "head" }, h("b", {}, q.title), h("span", { class: `pill ${tone}` }, label)),
            h("div", { class: "meta" }, [q.bot.name, shortWhen(q.updatedAt), q.chain && q.chain.tasks > 1 ? `${money(q.chain.cost)} for ${q.chain.tasks} tasks` : q.cost >= 0.005 ? money(q.cost) : "", detail].filter(Boolean).join(" · ")),
          );
        })
      : h("p", { class: "note" }, "Finished tasks appear here, with what became of them."),
  );
}

// ---------- the inbox ----------
// One place for what needs the person, what is being worked on and what got
// done, across chats and bots.
const RECENT = 3 * 24 * 3600 * 1000;
function inboxItems() {
  const quests = state.quests ?? [];
  const needs = [];
  for (const q of quests) {
    const recent = Date.now() - new Date(q.updatedAt).getTime() < RECENT;
    if (q.approvals?.length) needs.push({ kind: "approval", q, approval: q.approvals[0] });
    else if (q.status === "asking" && q.plan?.status === "proposed") needs.push({ kind: "plan", q });
    else if (q.status === "asking") needs.push({ kind: "asking", q });
    else if (q.branch && !q.outcome && !isLive(q) && q.status !== "failed" && q.changedFiles !== 0) needs.push({ kind: "review", q });
    else if (q.check && !q.check.passed && q.status === "done" && recent) needs.push({ kind: "check", q });
    else if (q.status === "failed" && recent) needs.push({ kind: "failed", q });
    else if (q.status === "budget" && recent) needs.push({ kind: "budget", q });
  }
  // Finished work from the Tasks board waits for Accept or Send back; a task whose code changes are under review is listed once.
  for (const t of state.workItems ?? []) {
    if (t.status !== "review" || !t.quest) continue;
    const q = quests.find((x) => x.id === t.quest);
    if (q && !needs.some((n) => n.q === q)) needs.push({ kind: "taskreview", q, t });
  }
  for (const c of state.convs ?? []) if (c.needsApproval) needs.push({ kind: "chat", c });
  for (const bot of state.crew?.bots ?? []) if (bot.month?.state === "stopped") needs.push({ kind: "monthly", bot });
  if (state.crew?.budgets?.total.state === "stopped") needs.push({ kind: "total" });
  const working = [...quests.filter((q) => isLive(q) && !q.approvals?.length).map((q) => ({ q })), ...(state.convs ?? []).filter((c) => c.running && !c.needsApproval).map((c) => ({ c }))];
  const today = new Date().toDateString();
  const done = quests.filter((q) => !isLive(q) && new Date(q.updatedAt).toDateString() === today && !needs.some((n) => n.q === q));
  return { needs, working, done };
}

/** Tasks the person assigned themselves (not the parts handed on from them), newest first. */
const ownTasks = () => (state.quests ?? []).filter((q) => q.chain).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
/** When the person last looked at their updates; an update newer than this is unread. */
const seenUpdates = () => {
  try {
    return localStorage.getItem("talqava.updatesSeen") || "";
  } catch {
    return "";
  }
};
const unreadUpdates = () => ownTasks().filter((q) => !isLive(q) && String(q.updatedAt) > seenUpdates());

/** One update from the team, as a message: who, what happened, what they said, what it cost. */
function updateCard(q, { compact = false } = {}) {
  const live = isLive(q);
  const waiting = q.approvals?.length;
  const failed = q.status === "failed" || q.status === "budget" || (q.check && !q.check.passed);
  const headline = waiting ? "needs your approval" : live ? "is working on" : q.status === "failed" ? "could not finish" : q.status === "budget" ? "stopped at its budget" : q.status === "stopped" ? "was stopped on" : "finished";
  const parts = q.chain?.tasks > 1 ? `${q.chain.finished} of ${q.chain.tasks - 1} parts finished${q.chain.working ? `, ${q.chain.working} under way` : ""} (${(q.chain.who ?? []).join(", ")})` : "";
  const doing = live && !waiting ? (q.activity ? `${NAMES[q.activity.name] || q.activity.name}: ${summarize(q.activity.name, q.activity.input)}` : "Thinking") : "";
  const words = q.status === "failed" && q.note ? q.note : q.said;
  const unread = !live && String(q.updatedAt) > seenUpdates();
  return h(
    "article",
    { class: `update ${live ? "live" : ""} ${failed ? "bad" : ""} ${unread ? "unread" : ""}`, style: botStyle(q.bot), onclick: () => go("quest", q.id), tabindex: "0", onkeydown: (e) => e.key === "Enter" && go("quest", q.id) },
    keycap(q.bot, compact ? 30 : 40, mood(q), q.bot.type),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "uhead" }, h("b", {}, `${q.bot.name} ${headline}`), h("span", { class: "utime" }, `${shortWhen(q.updatedAt)} · ${money(q.chain?.cost ?? q.cost ?? 0)}`)),
      h("div", { class: "utitle" }, q.title),
      doing ? h("div", { class: "unow" }, h("i", { class: "dot", "aria-hidden": "true" }), doing) : null,
      parts ? h("div", { class: "uparts" }, parts) : null,
      words ? h("div", { class: `uwords ${compact ? "short" : ""}` }, compact ? words.slice(0, 220) + (words.length > 220 ? "…" : "") : words) : live ? null : h("div", { class: "uwords muted" }, "It left no report."),
      h("div", { class: "ufoot" }, h("button", { class: "plain small", onclick: (e) => (e.stopPropagation(), (state.openReceipt = q.id), go("quest", q.id)) }, "See the receipt →")),
    ),
  );
}

// ---------- the inbox: a mailbox of messages from the team ----------
// Every task the person assigned is a message thread from the agent doing it; approvals, failures and budget
// stops arrive as messages too. The person reads, saves (stars), archives and deletes them like email. Only
// those marks are stored (on this computer); the messages are built from the tasks each time.

// Agents get a person's name for the inbox, which the owner can change. The default is picked from the
// agent's id, so it stays the same every time.
const FIRST_NAMES = ["Maya", "Noah", "Ava", "Liam", "Zara", "Ethan", "Priya", "Lucas", "Sofia", "Omar", "Chloe", "Mateo", "Amara", "Daniel", "Leila", "Kenji", "Grace", "Ravi", "Nora", "Diego", "Hana", "Samuel", "Isla", "Arjun", "Elena", "Theo", "Yara", "Marcus", "Ines", "Jonah", "Mei", "Felix", "Aisha", "Leo", "Camila", "Owen", "Nadia", "Hugo", "Ruby", "Tariq", "Freya", "Kofi", "Lina", "Rafael", "June", "Idris", "Sana", "Elias"];
const LAST_NAMES = ["Brooks", "Chen", "Patel", "Rivera", "Okafor", "Novak", "Kim", "Hughes", "Silva", "Moreau", "Haddad", "Larsen", "Ito", "Mensah", "Costa", "Fischer", "Reyes", "Sato", "Walsh", "Kaur", "Bennett", "Duarte", "Lindqvist", "Nakamura", "Adeyemi", "Byrne", "Castillo", "Dubois"];
const nameHash = (text, seed) => [...text].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), seed);
const defaultAgentName = (id) => `${FIRST_NAMES[nameHash(id, 2166136261) % FIRST_NAMES.length]} ${LAST_NAMES[nameHash(id, 374761393) % LAST_NAMES.length]}`;
/** The name an agent goes by in the inbox: the one the owner gave it, or its default. */
const agentName = (bot) => (bot ? state.mail?.names?.[bot.id] || defaultAgentName(bot.id) : "Talqava");
const agentRole = (bot) => (bot ? bot.title || bot.name : "Your workspace");

/** Changes agents suggested to workspace pages, waiting for the owner. */
async function loadPageSuggestions() {
  const before = JSON.stringify((state.pageSuggestions ?? []).map((s) => s.id));
  state.pageSuggestions = await api("GET", "workspace/suggestions").catch(() => state.pageSuggestions ?? []);
  if (state.view === "inbox" && JSON.stringify(state.pageSuggestions.map((s) => s.id)) !== before) renderInbox();
}

async function loadMail() {
  loadPageSuggestions();
  try {
    [state.mail, state.workItems] = await Promise.all([api("GET", "inbox"), api("GET", "work").then((w) => w.items).catch(() => state.workItems ?? [])]);
  } catch {
    state.mail ??= { messages: {}, names: {} };
  }
}

const MONTH_START = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

/** Every message: one per task the person assigned, plus whatever else needs them. Newest activity first. */
function mailMessages() {
  const out = [];
  const own = ownTasks();
  const needs = inboxItems().needs;
  // A plan to approve, a question before starting, or finished work to review is shown as that, with its buttons, instead of as the task's ordinary message.
  const ACTION = new Set(["plan", "asking", "taskreview"]);
  const actionFor = new Set(needs.filter((n) => n.q && ACTION.has(n.kind)).map((n) => n.q));
  for (const q of own) {
    if (actionFor.has(q)) continue;
    const live = isLive(q);
    const failed = q.status === "failed" || q.status === "budget" || (q.check && !q.check.passed) || (!live && q.chain?.stopped > 0);
    const label = q.approvals?.length || q.status === "asking" ? "needs" : failed ? "failed" : live ? "working" : "done";
    const snippet = q.status === "failed" && q.note ? q.note : q.said || (live ? "Working on it now." : "Finished without a written report.");
    out.push({ id: `task:${q.id}`, kind: "task", q, bot: q.bot, subject: q.title, snippet, at: q.updatedAt, activityAt: live && !q.approvals?.length ? q.createdAt : q.updatedAt, label });
  }
  for (const n of needs) {
    if (n.q && own.includes(n.q) && !ACTION.has(n.kind)) continue;
    // A part of a task the person assigned reports inside that task's message; only a part waiting for approval (or for a review of its changes) writes on its own.
    if (n.q?.parent && n.kind !== "approval" && n.kind !== "review") continue;
    const q = n.q;
    if (n.kind === "approval") out.push({ id: `need:approval:${q.id}:${n.approval.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Approval needed: ${NAMES[n.approval.name] || n.approval.name} for “${q.title}”`, snippet: n.approval.name === "bash" ? n.approval.input.command : JSON.stringify(n.approval.input), at: q.updatedAt, activityAt: q.updatedAt, label: "needs" });
    else if (n.kind === "plan") out.push({ id: `need:plan:${q.id}:${q.plan.version}`, kind: "need", need: n, q, bot: q.bot, subject: `Plan to approve: ${q.title}`, snippet: q.plan.summary ?? "", at: q.plan.at ?? q.updatedAt, activityAt: q.updatedAt, label: "needs" });
    else if (n.kind === "asking") out.push({ id: `need:asking:${q.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Needs your answer before starting: ${q.title}`, snippet: q.note || "I need something from you before I start.", at: q.updatedAt, activityAt: q.updatedAt, label: "needs" });
    else if (n.kind === "taskreview") out.push({ id: `need:taskreview:${n.t.id}:${q.updatedAt}`, kind: "need", need: n, q, bot: q.bot, subject: `To review: #${n.t.number} ${n.t.title}`, snippet: q.said ? q.said.replace(/\s+/g, " ").slice(0, 160) : "Finished. Accept it, or send it back with a comment.", at: q.updatedAt, activityAt: q.updatedAt, label: "needs" });
    else if (n.kind === "review") out.push({ id: `need:review:${q.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Ready for your review: ${q.title}`, snippet: `${q.changedFiles ?? "Some"} file${q.changedFiles === 1 ? "" : "s"} changed on ${q.branch}.`, at: q.updatedAt, activityAt: q.updatedAt, label: "needs" });
    else if (n.kind === "check") out.push({ id: `need:check:${q.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Did not pass its check: ${q.title}`, snippet: "The result did not pass its check. Open the task to see why.", at: q.updatedAt, activityAt: q.updatedAt, label: "failed" });
    else if (n.kind === "failed") out.push({ id: `need:failed:${q.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Could not finish: ${q.title}`, snippet: q.note || "The task failed.", at: q.updatedAt, activityAt: q.updatedAt, label: "failed" });
    else if (n.kind === "budget") out.push({ id: `need:budget:${q.id}`, kind: "need", need: n, q, bot: q.bot, subject: `Stopped at its budget: ${q.title}`, snippet: "Reply “continue” to keep going.", at: q.updatedAt, activityAt: q.updatedAt, label: "failed" });
    else if (n.kind === "chat") out.push({ id: `need:chat:${n.c.id}`, kind: "need", need: n, bot: null, subject: "A chat is waiting for your approval", snippet: n.c.title, at: n.c.updatedAt ?? MONTH_START(), activityAt: n.c.updatedAt ?? MONTH_START(), label: "needs" });
    else if (n.kind === "monthly") out.push({ id: `need:monthly:${n.bot.id}:${MONTH_START().slice(0, 7)}`, kind: "need", need: n, bot: n.bot, subject: "I have reached my monthly budget", snippet: `${money(n.bot.month.spent)} of ${money(n.bot.month.limit)}. I start no new work until you raise it.`, at: MONTH_START(), activityAt: MONTH_START(), label: "needs" });
    else if (n.kind === "total") out.push({ id: `need:total:${MONTH_START().slice(0, 7)}`, kind: "need", need: n, bot: null, subject: "Your agents have reached this month's budget", snippet: "No agent starts new work until you raise it or the month turns.", at: MONTH_START(), activityAt: MONTH_START(), label: "needs" });
  }
  // A change an agent suggested to a workspace page waits in the inbox too.
  for (const sg of state.pageSuggestions ?? []) {
    const bot = state.crew?.bots.find((b) => b.id === sg.author) ?? null;
    out.push({ id: `page:${sg.id}`, kind: "pagechange", suggestion: sg, bot, subject: `Suggested change: “${sg.pageTitle}”`, snippet: sg.note || "A change to a workspace page, for you to accept or decline.", at: sg.createdAt, activityAt: sg.createdAt, label: "needs" });
  }
  // A position an agent proposed waits in the inbox for the owner's answer.
  for (const org of state.orgs?.orgs ?? [])
    for (const p of org.proposals ?? []) {
      const bot = state.crew?.bots.find((b) => b.id === p.by) ?? null;
      out.push({ id: `proposal:${p.id}`, kind: "proposal", proposal: p, org, bot, subject: `Proposal: add a ${p.title}`, snippet: p.why, at: p.createdAt, activityAt: p.createdAt, label: "needs" });
    }
  return out;
}

/** The owner's answer to a position an agent proposed. Declining asks, optionally, why: the agent is told and does not ask again. */
async function answerProposal(org, p, decision, where) {
  let answer = "";
  if (decision === "decline") {
    const why = h("input", { maxlength: 300, placeholder: "e.g. Not this quarter; the Head of Sales covers it.", "aria-label": "Why not" });
    const got = await libDialog(`Decline the ${p.title}?`, h("div", { class: "composeform" }, h("p", { class: "note" }, `The ${p.byName} won't propose it again. You can say why, so they know.`), h("label", {}, "Why not (optional)", why)), [["Decline", () => ({ answer: why.value.trim() }), true]]);
    if (!got) return;
    answer = got.answer;
  }
  return attempt(async () => {
    await api("POST", `orgs/${org.id}/proposals/${p.id}`, { decision, answer });
    await Promise.all([loadOrgs(), loadCrew()]);
  }, where);
}

const markOf = (m) => state.mail?.messages?.[m.id] ?? {};
/** Unread: never opened, or something new happened since it was opened. Before the inbox kept marks, the last visit counts. */
const isUnread = (m) => {
  const mark = markOf(m);
  const seen = mark.readAt || (state.mail && Object.keys(state.mail.messages ?? {}).length ? "" : seenUpdates());
  return !seen || String(m.activityAt) > seen;
};
const MAIL_FOLDERS = [
  ["inbox", "Inbox", (m, k) => !k.archived && !k.deletedAt],
  ["starred", "Saved", (m, k) => k.starred && !k.deletedAt],
  ["needs", "Needs you", (m, k) => (m.label === "needs" || m.label === "failed") && !k.deletedAt],
  ["working", "In progress", (m, k) => m.label === "working" && !k.deletedAt],
  ["archive", "Archive", (m, k) => k.archived && !k.deletedAt],
  ["trash", "Trash", (m, k) => k.deletedAt && !k.purged],
];
const LABEL_WORDS = { needs: "Needs you", failed: "Problem", working: "In progress", done: "Done" };

function syncInboxCount() {
  if (!ui.inboxCount) return;
  if (!state.mail && !ui.mailLoading) ui.mailLoading = loadMail().then(() => syncInboxCount());
  const n = mailMessages().filter((m) => !markOf(m).archived && !markOf(m).deletedAt && isUnread(m)).length;
  ui.inboxCount.hidden = !n;
  ui.inboxCount.textContent = String(n);
}

async function mailMark(ids, set) {
  if (!ids.length) return;
  try {
    state.mail = await api("PATCH", "inbox", { ids, ...set });
  } catch (err) {
    ui.mailNote = err.message;
  }
  renderInbox();
  syncInboxCount();
}

function inboxView() {
  ui.body.className = "body";
  ui.log = null;
  ui.mailSel ??= new Set();
  ui.mailFolder ??= "inbox";
  ui.mailBody ??= {};
  ui.mailDraft ??= {};
  ui.mailListKey = ui.mailReadKey = null;
  // The search box is made once, so typing is never interrupted when new messages arrive.
  const find = h("input", { type: "search", class: "mailfind", placeholder: "Search mail: a name, a task, any word", value: ui.mailFind ?? "", "aria-label": "Search mail" });
  find.addEventListener("input", () => ((ui.mailFind = find.value), (ui.mailOpen = null), renderInbox()));
  const sort = h("select", { class: "mailsort", "aria-label": "Sort", onchange: (e) => ((ui.mailSort = e.target.value), renderInbox()) }, [["newest", "Newest first"], ["oldest", "Oldest first"], ["unread", "Unread first"], ["sender", "Sender A to Z"]].map(([v, t]) => h("option", { value: v, selected: v === (ui.mailSort ?? "newest") }, t)));
  ui.mailSide = h("nav", { class: "mailside", "aria-label": "Mail folders" });
  ui.mailBulk = h("div", { class: "mailbulk" });
  ui.mailList = h("div", { class: "maillist", role: "list" });
  ui.mailRead = h("article", { class: "mailread" });
  ui.inbox = h("div", { class: "mail" }, ui.mailSide, h("div", { class: "mailmain" }, h("div", { class: "mailtop" }, find, sort), ui.mailBulk, h("div", { class: "mailpanes" }, ui.mailList, ui.mailRead)));
  fill(ui.body, h("main", { class: "center flush" }, ui.inbox));
  renderInbox();
  Promise.all([loadCrew(), loadMail()]).then(() => state.view === "inbox" && (renderInbox(), syncInboxCount()));
}

function renderInbox() {
  if (state.view !== "inbox" || !ui.mailList) return;
  const all = mailMessages().filter((m) => !markOf(m).purged);
  const folder = MAIL_FOLDERS.find(([id]) => id === ui.mailFolder) ?? MAIL_FOLDERS[0];
  const words = (ui.mailFind ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (m) => `${agentName(m.bot)} ${agentRole(m.bot)} ${m.subject} ${m.snippet}`.toLowerCase();
  const sorters = {
    newest: (a, b) => String(b.at).localeCompare(String(a.at)),
    oldest: (a, b) => String(a.at).localeCompare(String(b.at)),
    unread: (a, b) => Number(isUnread(b)) - Number(isUnread(a)) || String(b.at).localeCompare(String(a.at)),
    sender: (a, b) => agentName(a.bot).localeCompare(agentName(b.bot)) || String(b.at).localeCompare(String(a.at)),
  };
  // A search looks in every folder but Trash, as mail apps do.
  const shown = all.filter((m) => (words.length ? !markOf(m).deletedAt : folder[2](m, markOf(m))) && words.every((w) => haystack(m).includes(w))).sort(sorters[ui.mailSort ?? "newest"]);
  for (const id of [...ui.mailSel]) if (!shown.some((m) => m.id === id)) ui.mailSel.delete(id);
  const open = shown.find((m) => m.id === ui.mailOpen) ?? all.find((m) => m.id === ui.mailOpen) ?? null;

  // ----- the folders -----
  const compose = h("button", { class: "primary compose", onclick: () => composeMail() }, "Compose");
  fill(
    ui.mailSide,
    compose,
    MAIL_FOLDERS.map(([id, label, test]) => {
      const inIt = all.filter((m) => test(m, markOf(m)));
      const count = id === "inbox" || id === "needs" ? inIt.filter(isUnread).length : id === "trash" ? 0 : inIt.length;
      return h("button", { class: `mailfolder ${id === folder[0] && !words.length ? "on" : ""}`, "aria-current": id === folder[0] ? "page" : null, onclick: () => ((ui.mailFolder = id), (ui.mailOpen = null), ui.mailSel.clear(), (ui.mailFind = ""), document.querySelector(".mailfind") && (document.querySelector(".mailfind").value = ""), renderInbox()) }, h("span", { class: "grow" }, label), count ? h("b", {}, String(count)) : null);
    }),
    folder[0] === "trash" ? h("p", { class: "note small mailtrashnote" }, "Messages in Trash are removed after 30 days. Deleting a message never deletes the task or its work.") : null,
  );

  // ----- the bar above the list: select all, and what to do with the selection -----
  const sel = shown.filter((m) => ui.mailSel.has(m.id));
  const ids = sel.map((m) => m.id);
  const allOn = shown.length > 0 && sel.length === shown.length;
  const inTrash = folder[0] === "trash" && !words.length;
  fill(
    ui.mailBulk,
    h("input", { type: "checkbox", class: "pick", "aria-label": "Select all", checked: allOn, onchange: () => (allOn ? ui.mailSel.clear() : shown.forEach((m) => ui.mailSel.add(m.id)), renderInbox()) }),
    sel.length
      ? [
          h("span", { class: "note small" }, `${sel.length} selected`),
          inTrash
            ? [h("button", { class: "small", onclick: () => (ui.mailSel.clear(), mailMark(ids, { deleted: false })) }, "Restore"), h("button", { class: "small danger", onclick: () => confirm(`Delete ${sel.length} message${sel.length === 1 ? "" : "s"} forever?`) && (ui.mailSel.clear(), mailMark(ids, { purge: true })) }, "Delete forever")]
            : [
                folder[0] === "archive" ? h("button", { class: "small", onclick: () => (ui.mailSel.clear(), mailMark(ids, { archived: false })) }, "Move to Inbox") : h("button", { class: "small", onclick: () => (ui.mailSel.clear(), mailMark(ids, { archived: true })) }, "Archive"),
                h("button", { class: "small", onclick: () => (ui.mailSel.clear(), (ui.mailOpen = ids.includes(ui.mailOpen) ? null : ui.mailOpen), mailMark(ids, { deleted: true })) }, "Delete"),
                h("button", { class: "small", onclick: () => mailMark(ids, { read: true }) }, "Mark read"),
                h("button", { class: "small", onclick: () => mailMark(ids, { read: false }) }, "Mark unread"),
                h("button", { class: "small", onclick: () => mailMark(ids, { starred: !sel.every((m) => markOf(m).starred) }) }, sel.every((m) => markOf(m).starred) ? "Unsave" : "Save"),
              ],
        ]
      : [
          h("button", { class: "plain small", title: "Mark every message here as read", onclick: () => mailMark(shown.filter(isUnread).map((m) => m.id), { read: true }) }, "Mark all read"),
          inTrash && shown.length ? h("button", { class: "plain small danger", onclick: () => confirm("Empty Trash? These messages are removed for good. Tasks and their work are kept.") && mailMark(shown.map((m) => m.id), { purge: true }) }, "Empty Trash") : null,
        ],
    h("span", { class: "grow" }),
    h("span", { class: "note small" }, words.length ? `${shown.length} result${shown.length === 1 ? "" : "s"} in all mail` : `${shown.length} message${shown.length === 1 ? "" : "s"}`),
  );

  // ----- the list -----
  const row = (m) => {
    const mark = markOf(m);
    const unread = isUnread(m);
    const node = h(
      "div",
      { class: `mailrow ${unread ? "unread" : ""} ${ui.mailOpen === m.id ? "open" : ""} ${ui.mailSel.has(m.id) ? "sel" : ""}`, role: "listitem", tabindex: "0", style: m.bot ? botStyle(m.bot) : "", onclick: () => openMail(m), onkeydown: (e) => e.key === "Enter" && e.target === node && openMail(m) },
      h("input", { type: "checkbox", class: "pick", "aria-label": `Select ${m.subject}`, checked: ui.mailSel.has(m.id), onclick: (e) => e.stopPropagation(), onchange: (e) => (e.target.checked ? ui.mailSel.add(m.id) : ui.mailSel.delete(m.id), renderInbox()) }),
      h("button", { class: `star ${mark.starred ? "on" : ""}`, "aria-label": mark.starred ? "Unsave" : "Save", "aria-pressed": String(Boolean(mark.starred)), title: mark.starred ? "Saved" : "Save", onclick: (e) => (e.stopPropagation(), mailMark([m.id], { starred: !mark.starred })) }, mark.starred ? "★" : "☆"),
      m.bot ? keycap(m.bot, 28, "", m.bot.type) : h("span", { class: "sysavatar", "aria-hidden": "true" }, "T"),
      h("span", { class: "msender" }, agentName(m.bot)),
      h("span", { class: "msubject" }, h("b", {}, m.subject), h("span", { class: "msnippet" }, ` — ${String(m.snippet).replace(/\s+/g, " ").slice(0, 160)}`)),
      h("span", { class: `mlabel ${m.label === "done" ? "empty" : m.label}` }, m.label === "done" ? "" : LABEL_WORDS[m.label]),
      h("span", { class: "mtime" }, shortWhen(m.at)),
      h(
        "span",
        { class: "mhover" },
        inTrash
          ? h("button", { class: "plain small", onclick: (e) => (e.stopPropagation(), mailMark([m.id], { deleted: false })) }, "Restore")
          : [
              h("button", { class: "plain small", title: mark.archived ? "Move to Inbox" : "Archive", onclick: (e) => (e.stopPropagation(), mailMark([m.id], { archived: !mark.archived })) }, mark.archived ? "Inbox" : "Archive"),
              h("button", { class: "plain small", title: "Delete", onclick: (e) => (e.stopPropagation(), ui.mailOpen === m.id && (ui.mailOpen = null), mailMark([m.id], { deleted: true })) }, "Delete"),
              h("button", { class: "plain small", title: unread ? "Mark read" : "Mark unread", onclick: (e) => (e.stopPropagation(), mailMark([m.id], { read: unread })) }, unread ? "Read" : "Unread"),
            ],
      ),
    );
    return node;
  };
  const listKey = JSON.stringify([ui.mailNote, folder[0], ui.mailOpen, shown.map((m) => [m.id, m.subject, m.snippet, m.at, m.label, isUnread(m), markOf(m).starred, markOf(m).archived, markOf(m).deletedAt, ui.mailSel.has(m.id), agentName(m.bot)])]);
  const listChanged = listKey !== ui.mailListKey;
  ui.mailListKey = listKey;
  const empty = { inbox: "No messages. When you assign a task, the agent writes to you here.", starred: "Nothing saved. Press the star on a message to keep it here.", needs: "Nothing needs you right now.", working: "Nothing is in progress.", archive: "Nothing archived.", trash: "Trash is empty." };
  if (listChanged) fill(ui.mailList, ui.mailNote ? h("div", { class: "banner error" }, ui.mailNote) : null, shown.length ? shown.map(row) : h("div", { class: "mailempty" }, h("b", {}, words.length ? "No messages match that search." : empty[folder[0]])));
  ui.mailNote = null;
  ui.inbox.classList.toggle("reading", Boolean(open));

  // ----- the open message (kept as it is while a reply is being typed) -----
  if (open && ui.mailRead.contains(document.activeElement) && ui.mailRead.dataset.id === open.id) return;
  const readKey = JSON.stringify([open?.id, open?.at, open?.label, open?.snippet, open && markOf(open), open?.q?.approvals?.length, open?.q?.activity?.name, open?.q?.chain, open && agentName(open.bot), ui.mailNote]);
  if (readKey === ui.mailReadKey && ui.mailRead.dataset.id === (open?.id ?? "")) return;
  ui.mailReadKey = readKey;
  ui.mailRead.dataset.id = open?.id ?? "";
  fill(ui.mailRead, open ? readMail(open) : h("div", { class: "mailpick" }, h("b", {}, "Select a message to read it."), h("span", { class: "note small" }, `${all.filter((m) => !markOf(m).archived && !markOf(m).deletedAt && isUnread(m)).length} unread in your Inbox.`)));
}

function openMail(m) {
  ui.mailOpen = m.id;
  if (isUnread(m)) mailMark([m.id], { read: true });
  else renderInbox();
}

/** The full text of the agent's last message in a task, fetched once per change. */
async function mailFullText(q) {
  const cached = ui.mailBody[q.id];
  if (cached && cached.at === q.updatedAt) return cached.text;
  const conv = await api("GET", `conversations/${q.id}`).catch(() => null);
  let text = "";
  for (const message of [...(conv?.messages ?? [])].reverse()) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
    if (text) break;
  }
  ui.mailBody[q.id] = { at: q.updatedAt, text };
  return text;
}

function readMail(m) {
  const mark = markOf(m);
  const q = m.q;
  const back = h("button", { class: "plain small", onclick: () => ((ui.mailOpen = null), renderInbox()) }, "← Back");
  const tools = h(
    "div",
    { class: "readtools" },
    back,
    h("span", { class: "grow" }),
    mark.deletedAt
      ? h("button", { class: "small", onclick: () => mailMark([m.id], { deleted: false }) }, "Restore")
      : [
          h("button", { class: "small", onclick: () => ((ui.mailOpen = mark.archived ? m.id : null), mailMark([m.id], { archived: !mark.archived })) }, mark.archived ? "Move to Inbox" : "Archive"),
          h("button", { class: "small", onclick: () => ((ui.mailOpen = null), mailMark([m.id], { deleted: true })) }, "Delete"),
          h("button", { class: "small", onclick: () => ((ui.mailOpen = null), mailMark([m.id], { read: false })) }, "Mark unread"),
          h("button", { class: `small ${mark.starred ? "on" : ""}`, "aria-pressed": String(Boolean(mark.starred)), onclick: () => mailMark([m.id], { starred: !mark.starred }) }, mark.starred ? "★ Saved" : "☆ Save"),
        ],
  );

  // The sender, whose name can be changed right here.
  const nameBox = h("span", { class: "fromname" });
  const showName = () =>
    fill(
      nameBox,
      h("b", {}, agentName(m.bot)),
      m.bot
        ? h("button", {
            class: "plain small rename",
            title: "Give this agent another name",
            onclick: () => {
              const input = h("input", { class: "renamebox", value: agentName(m.bot), "aria-label": "Agent's name", maxlength: "40" });
              const save = async (value) => {
                try {
                  state.mail = await api("PUT", `inbox/names/${encodeURIComponent(m.bot.id)}`, { name: value });
                } catch (err) {
                  ui.mailNote = err.message;
                }
                document.activeElement?.blur();
                renderInbox();
              };
              input.addEventListener("keydown", (e) => (e.key === "Enter" ? save(input.value.trim()) : e.key === "Escape" ? showName() : null));
              fill(nameBox, input, h("button", { class: "small primary", onclick: () => save(input.value.trim()) }, "Save"), state.mail?.names?.[m.bot.id] ? h("button", { class: "plain small", title: `Back to ${defaultAgentName(m.bot.id)}`, onclick: () => save("") }, "Use default") : null);
              setTimeout(() => (input.focus(), input.select()), 0);
            },
          }, "Rename")
        : null,
    );
  showName();
  const from = h("div", { class: "readfrom", style: m.bot ? botStyle(m.bot) : "" }, m.bot ? keycap(m.bot, 44, isLive(q ?? {}) ? "working" : "", m.bot.type) : h("span", { class: "sysavatar big", "aria-hidden": "true" }, "T"), h("div", { class: "grow" }, nameBox, h("div", { class: "note small" }, `${agentRole(m.bot)}${m.bot ? ` · ${departmentOf(m.bot.id)}` : ""} · to me`)), h("span", { class: "mtime" }, new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));

  const body = h("div", { class: "readbody" });
  const act = (fn) => attempt(async () => (await fn(), await Promise.all([loadQuests(), refreshList(), loadCrew(), loadMail()]), renderInbox(), syncInboxCount()), body);
  if (m.kind === "pagechange") {
    const sg = m.suggestion;
    const decide = (decision) =>
      attempt(async () => {
        await api("POST", `workspace/suggestions/${sg.id}`, { decision });
        await loadPageSuggestions();
        ui.mailOpen = null;
        renderInbox();
        syncInboxCount();
      }, body);
    fill(
      body,
      h("p", {}, `I'd like to change the workspace page “${sg.pageTitle}”.${sg.note ? ` ${sg.note}` : ""}`),
      sg.stale ? h("p", { class: "note small" }, "The page changed after I read it. Accepting keeps your newer changes where they don't overlap with mine.") : null,
      h("div", { class: "wsdiff" }, sg.diff.map((d) => (d.op === "same" ? null : h("div", { class: `wsdiffline ${d.op}` }, h("span", { class: "wsdiffmark", "aria-hidden": "true" }, d.op === "add" ? "+" : "−"), h("span", {}, diffText(d.text)))))),
      h("p", { class: "note small" }, "Nothing changes on the page until you accept."),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => decide("accept") }, "Accept"), h("button", { onclick: () => decide("decline") }, "Decline"), h("button", { class: "plain", onclick: () => openPage(sg.page) }, "Open the page")),
    );
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }
  if (m.kind === "proposal") {
    const p = m.proposal;
    const after = () => ((ui.mailOpen = null), renderInbox(), syncInboxCount());
    fill(
      body,
      h("p", {}, `I'd like to add a ${p.title} to ${p.group}, reporting to ${p.reportsTo === p.by ? "me" : (m.org.members.find((x) => x.bot === p.reportsTo)?.title ?? "you")}.`),
      h("blockquote", { class: "proposalwhy" }, p.why),
      h("p", { class: "note small" }, "Nothing changes until you approve. You can move or remove the position afterwards, like any other."),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => answerProposal(m.org, p, "approve", body).then(after) }, "Approve"), h("button", { onclick: () => answerProposal(m.org, p, "decline", body).then(after) }, "Decline"), h("button", { class: "plain", onclick: () => go("team") }, "See the chart")),
    );
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }
  if (m.kind === "need") {
    const n = m.need;
    if (n.kind === "approval") {
      const a = n.approval;
      const decide = (decision) => act(() => api("POST", `conversations/${q.id}/approvals/${a.id}`, { decision }));
      fill(body, h("p", {}, `I want to use ${NAMES[a.name] || a.name} for “${q.title}”. Is that all right?`), h("pre", {}, a.name === "bash" ? a.input.command : JSON.stringify(a.input, null, 2)), h("div", { class: "row" }, h("button", { class: "primary", onclick: () => decide("allow") }, "Allow once"), h("button", { class: "danger", onclick: () => decide("deny") }, "Don't allow"), h("button", { class: "plain", onclick: () => go("quest", q.id) }, "Open the task")));
    } else if (n.kind === "plan") fill(body, planCard(q, () => act(async () => {})), h("button", { class: "plain small", onclick: () => go("quest", q.id) }, "Open the task"));
    else if (n.kind === "asking") {
      const answer = h("textarea", { rows: 4, placeholder: "Your answer. The task starts once you send it.", "aria-label": "Answer" });
      fill(
        body,
        h("div", { class: "md readreport" }, q.said ? renderMarkdown(q.said) : h("p", {}, q.note || "I need something from you before I start.")),
        answer,
        h("div", { class: "row" }, h("button", { class: "primary", onclick: () => answer.value.trim() && act(() => api("POST", `conversations/${q.id}/messages`, { text: answer.value.trim() })) }, "Send and start"), h("button", { class: "plain", onclick: () => go("quest", q.id) }, "Open the task")),
      );
    } else if (n.kind === "taskreview") {
      const why = h("textarea", { rows: 3, placeholder: "What should change? Sending it back wakes the agent.", "aria-label": "What should change" });
      fill(
        body,
        h("div", { class: "md readreport" }, q.said ? renderMarkdown(q.said) : h("p", {}, "Finished without a written report.")),
        why,
        h(
          "div",
          { class: "row" },
          h("button", { class: "primary", onclick: () => act(() => api("POST", `work/${n.t.id}/accept`)) }, "Accept"),
          h("button", { onclick: () => why.value.trim() && act(() => api("POST", `work/${n.t.id}/comment`, { text: why.value.trim() })) }, "Send back with this comment"),
          h("button", { class: "plain", onclick: () => go("quest", q.id) }, "Open the task"),
        ),
      );
    } else if (n.kind === "chat") fill(body, h("p", {}, `The chat “${n.c.title}” is waiting for you to approve a step.`), h("button", { class: "primary", onclick: () => go("chat", n.c.id) }, "Open the chat"));
    else if (n.kind === "monthly") fill(body, h("p", {}, `I have spent ${money(n.bot.month.spent)} of my ${money(n.bot.month.limit)} monthly budget, so I won't start new work until you raise it or the month turns.`), h("button", { class: "primary", onclick: () => go("bot", n.bot.id) }, "Raise my budget"));
    else if (n.kind === "total") fill(body, h("p", {}, "All your agents together have reached this month's budget. No agent starts new work until you raise it or the month turns."), h("button", { class: "primary", onclick: () => go("team") }, "Change the budget"));
    else fill(body, h("p", {}, m.snippet), h("button", { class: "primary", onclick: () => go("quest", q.id) }, n.kind === "review" ? "Review the changes" : "Open the task"));
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }

  // A task: what the agent wrote, what it is doing, what it cost.
  const live = isLive(q);
  const report = h("div", { class: "md readreport" }, q.said ? renderMarkdown(q.said) : null);
  mailFullText(q).then((text) => text && report.isConnected && fill(report, renderMarkdown(text)));
  const approvals = (q.approvals ?? []).map((a) =>
    h("div", { class: "readapproval" }, h("b", {}, `May I use ${NAMES[a.name] || a.name}?`), h("pre", {}, a.name === "bash" ? a.input.command : JSON.stringify(a.input, null, 2)), h("div", { class: "row" }, h("button", { class: "primary small", onclick: () => act(() => api("POST", `conversations/${q.id}/approvals/${a.id}`, { decision: "allow" })) }, "Allow once"), h("button", { class: "danger small", onclick: () => act(() => api("POST", `conversations/${q.id}/approvals/${a.id}`, { decision: "deny" })) }, "Don't allow"))),
  );
  const parts = q.chain?.tasks > 1 ? `${q.chain.finished} of ${q.chain.tasks - 1} parts done${q.chain.working ? `, ${q.chain.working} under way` : ""}${q.chain.stopped ? `, ${q.chain.stopped} stopped` : ""}` : "";
  fill(
    body,
    approvals,
    live && !q.approvals?.length ? h("div", { class: "readnow" }, h("i", { class: "dot", "aria-hidden": "true" }), q.activity ? `Working on it: ${NAMES[q.activity.name] || q.activity.name}` : "Working on it now.") : null,
    q.status === "failed" && q.note ? h("div", { class: "banner error" }, q.note) : null,
    handoverCard(q),
    !live && q.chain?.stopped ? h("div", { class: "banner" }, `${q.chain.stopped} part${q.chain.stopped === 1 ? "" : "s"} of this task stopped before finishing${q.chain.cost >= q.chain.budget ? `, because the task reached its ${money(q.chain.budget)} budget` : ""}. The receipt shows which, and what each cost. Reply “continue” to carry on, or raise the budget per task under Settings.`) : null,
    whyChain(q),
    q.said || !live ? report : null,
    !q.said && !live && q.status !== "failed" ? h("p", { class: "note" }, "I finished without writing a report.") : null,
    h("div", { class: "readfacts" }, [parts, q.chain ? `${money(q.chain.cost)} for the whole task` : q.cost ? money(q.cost) : "", LABEL_WORDS[m.label]].filter(Boolean).map((x) => h("span", {}, x)), h("span", { class: "grow" }), h("button", { class: "plain small", onclick: () => ((state.openReceipt = q.id), go("quest", q.id)) }, "See the receipt"), h("button", { class: "plain small", onclick: () => go("quest", q.id) }, "Open the task")),
  );
  // Replying continues the task: the agent reads the reply and carries on.
  const reply = h("textarea", { rows: 3, placeholder: `Reply to ${agentName(m.bot).split(" ")[0]}… (they will continue the task)`, "aria-label": "Reply" }, ui.mailDraft[q.id] ?? "");
  reply.addEventListener("input", () => (ui.mailDraft[q.id] = reply.value));
  const sendBtn = h("button", { class: "primary small" }, "Send");
  sendBtn.addEventListener("click", () => {
    const text = reply.value.trim();
    if (!text) return reply.focus();
    sendBtn.disabled = true;
    attempt(async () => {
      await api("POST", `conversations/${q.id}/messages`, { text });
      ui.mailDraft[q.id] = "";
      reply.value = "";
      ui.mailNote = null;
      await loadQuests();
      reply.blur();
      renderInbox();
    }, body).finally(() => (sendBtn.disabled = false));
  });
  reply.addEventListener("keydown", (e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && sendBtn.click());
  const replyBox = live ? h("p", { class: "note small" }, "You can reply once they have finished, or open the task to follow along.") : h("div", { class: "readreply" }, reply, h("div", { class: "row" }, sendBtn, h("span", { class: "note small" }, "Replying asks them to carry on, which uses their budget.")));
  return [tools, h("h2", { class: "readsubject" }, m.subject, m.label !== "done" ? h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label]) : null), from, body, replyBox];
}

/** A new message to an agent or a team: it becomes a task, and their replies arrive in the inbox. */
async function composeMail() {
  await loadCrew();
  const org = activeOrg();
  const bots = (state.crew?.bots ?? []).filter((b) => !org.members.length || org.members.some((m) => m.bot === b.id));
  const leads = bots.filter((b) => org.members.some((m) => m.manager === b.id));
  const to = h(
    "select",
    { "aria-label": "To" },
    leads.length ? h("optgroup", { label: "Teams (the lead shares the work out)" }, leads.map((b) => h("option", { value: `team:${b.id}` }, `${agentName(b)}'s team · ${b.title || b.name}`))) : null,
    h("optgroup", { label: "Agents" }, bots.map((b) => h("option", { value: b.id }, `${agentName(b)} · ${b.title || b.name}`))),
  );
  const subject = h("input", { placeholder: "Subject", "aria-label": "Subject" });
  const message = h("textarea", { rows: 7, placeholder: "What should they do? Say what a good result looks like.", "aria-label": "Message" });
  const form = h("div", { class: "composeform" }, h("label", {}, "To", to), subject, message, h("p", { class: "note small" }, "Sending starts the work. Their reply arrives in your Inbox, with a receipt of what it cost."));
  const chosen = await libDialog("New message", form, [["Send", () => ({ to: to.value, subject: subject.value.trim(), text: message.value.trim() }), true]]);
  if (!chosen || (!chosen.subject && !chosen.text)) return;
  const team = chosen.to.startsWith("team:");
  const bot = team ? chosen.to.slice(5) : chosen.to;
  const brief = [chosen.subject, chosen.text].filter(Boolean).join("\n\n");
  const text = team ? `${brief}\n\n[This task is for your whole team, not for you alone. Split it into parts and hand each part to the right member of your team with assign_task. When their reports come back, check them, put them together, and give one combined result. Do only the parts that nobody on your team can do.]` : brief;
  await attempt(async () => {
    const started = await startTask({ bot, text, title: chosen.subject || undefined, project: state.project || undefined });
    if (!started) return;
    ui.mailNote = null;
    await loadQuests();
    ui.mailFolder = "inbox";
    ui.mailOpen = started.id ? `task:${started.id}` : null;
    if (!started.id) ui.mailNote = `Task #${started.queued.number} is waiting its turn in the ${started.queued.ownerName}'s queue.`;
    renderInbox();
    syncInboxCount();
  }, ui.mailList);
}

// ---------- the organization ----------
// The bots in roles: an org chart with the person at the top, departments, and
// what each bot may spend this month. Work follows the chart: a bot with
// reports hands tasks to them and gets their reports back.
/** What a role answers for: its targets, what it decides itself, and what it must take to its lead. Nothing when its file says none. */
function governanceBox(bot) {
  const g = bot?.governance;
  if (!g || !(g.kpis?.length || g.decides?.length || g.escalates?.length)) return null;
  const col = (label, items) => (items?.length ? h("div", { class: "gcol" }, h("div", { class: "label" }, label), h("ul", {}, items.map((x) => h("li", {}, x)))) : null);
  return h("div", { class: "govern" }, col("Measured on", g.kpis), col("Decides itself", g.decides), col("Must escalate", g.escalates));
}

/**
 * A small picture of how each structure's chart is drawn: you at the top in
 * the accent colour, leads outlined, the rest filled. Solid lines are
 * reporting lines; dashed ones are a matrix's project lines or peer links.
 */
function structureDiagram(id) {
  const W = 22;
  const H = 12;
  const box = (x, y, kind = "") => `<rect class="sd-box ${kind}" x="${x - W / 2}" y="${y - H / 2}" width="${W}" height="${H}" rx="3.5"/>`;
  const line = (x1, y1, x2, y2, kind = "") => `<path class="sd-line ${kind}" d="M${x1} ${y1}L${x2} ${y2}"/>`;
  // A lead above a row of reports, joined by an elbow.
  const fan = (px, py, xs, cy) => {
    const mid = (py + cy) / 2;
    return line(px, py + H / 2, px, mid) + (xs.length > 1 ? line(Math.min(...xs), mid, Math.max(...xs), mid) : "") + xs.map((x) => line(x, mid, x, cy - H / 2)).join("");
  };
  let body = "";
  if (id === "hierarchical") {
    body = fan(120, 14, [70, 170], 46) + fan(70, 46, [44, 96], 78) + fan(170, 46, [144, 196], 78) + [44, 96, 144, 196].map((x) => line(x, 84, x, 98) + box(x, 104)).join("") + box(120, 14, "top") + box(70, 46, "lead") + box(170, 46, "lead") + [44, 96, 144, 196].map((x) => box(x, 78, "lead")).join("");
  } else if (id === "functional") {
    const heads = [50, 120, 190];
    body = fan(120, 14, heads, 46) + heads.map((x) => line(x, 52, x, 98) + box(x, 46, "lead") + box(x, 76) + box(x, 104)).join("") + box(120, 14, "top");
  } else if (id === "divisional") {
    const divs = [48, 120, 192];
    body = fan(120, 12, divs, 44) + divs.map((x) => `<rect class="sd-group" x="${x - 32}" y="30" width="64" height="84" rx="7"/>` + fan(x, 46, [x - 15, x + 15], 76) + line(x - 15, 82, x - 15, 96) + line(x + 15, 82, x + 15, 96) + box(x, 46, "lead") + box(x - 15, 76) + box(x + 15, 76) + box(x - 15, 102) + box(x + 15, 102)).join("") + box(120, 12, "top");
  } else if (id === "matrix") {
    const cols = [92, 146, 200];
    const rows = [64, 96];
    body = fan(146, 12, cols, 36) + cols.map((x) => line(x, 42, x, 96)).join("") + rows.map((y) => line(38, y, 200, y, "dash")).join("") + rows.map((y) => box(38, y, "lead")).join("") + cols.map((x) => box(x, 36, "lead") + rows.map((y) => box(x, y)).join("")).join("") + box(146, 12, "top");
  } else if (id === "team") {
    const pods = [48, 120, 192];
    body = fan(120, 12, pods, 44) + pods.map((x) => `<rect class="sd-group" x="${x - 32}" y="30" width="64" height="84" rx="32"/>` + line(x - 15, 76, x + 15, 76, "dash") + line(x - 15, 76, x, 100, "dash") + line(x + 15, 76, x, 100, "dash") + line(x, 52, x - 15, 70) + line(x, 52, x + 15, 70) + box(x, 46, "lead") + box(x - 15, 76) + box(x + 15, 76) + box(x, 100)).join("") + box(120, 12, "top");
  } else if (id === "flat") {
    const xs = [30, 66, 102, 138, 174, 210];
    body = fan(120, 30, xs, 82) + line(30, 82, 210, 82, "dash") + xs.map((x) => box(x, 82)).join("") + box(120, 30, "top");
  } else {
    body = line(120, 26, 120, 44) + line(70, 44, 170, 44) + line(70, 44, 70, 58) + line(170, 44, 170, 58) + box(120, 20, "top") + `<rect class="sd-box ghost" x="59" y="58" width="22" height="12" rx="3.5"/><rect class="sd-box ghost" x="159" y="58" width="22" height="12" rx="3.5"/><rect class="sd-box ghost" x="109" y="88" width="22" height="12" rx="3.5"/>` + line(120, 82, 120, 70, "dash") + `<path class="sd-plus" d="M120 60v8M116 64h8"/>`;
  }
  const wrap = h("div", {});
  wrap.innerHTML = `<svg viewBox="0 0 240 120" aria-hidden="true">${body}</svg>`;
  return wrap.firstChild;
}

/**
 * The access graph: for each agent, and the assistant, what it may read, change, hand work to and ask, drawn from
 * the rules that decide it (powers, the chart, library and workspace access, connectors, keys, approvals, budgets).
 * Anything not shown here, the agent is refused.
 */
function orgAccessPanel(org) {
  const box = h("div", { class: "accesspanel" }, h("p", { class: "note" }, "Working out what each agent can reach…"));
  const find = h("input", { type: "search", placeholder: "Find an agent", "aria-label": "Find an agent" });
  const list = (items, none) => (items.length ? items.join(", ") : none);
  const row = (label, value, tone = "") => h("div", { class: `arow ${tone}` }, h("span", { class: "alabel" }, label), h("span", { class: "grow" }, value));
  let graphs = [];
  const draw = () => {
    const q = find.value.trim().toLowerCase();
    const shown = graphs.filter((g) => !q || `${g.agent.title} ${g.agent.department ?? ""}`.toLowerCase().includes(q));
    fill(
      cards,
      shown.map((g, i) => {
        const bot = state.crew?.bots.find((b) => b.id === g.agent.id);
        const general = g.agent.id === "@general";
        const changing = g.powers.filter((p) => p.changes).length;
        return h(
          "details",
          { class: "card acard", open: graphs.length <= 4 || (i === 0 && !q) },
          h(
            "summary",
            {},
            bot ? keycap(bot, 32, "") : h("span", { class: "sysavatar", "aria-hidden": "true" }, "T"),
            h("span", { class: "grow" }, h("b", {}, g.agent.title), g.agent.department ? h("span", { class: "note small" }, ` · ${g.agent.department}`) : null),
            h("span", { class: `tag ${g.approvals === "ask" ? "ok" : "warnline"}` }, g.approvals === "ask" ? "Asks before changes" : "Runs without asking"),
          ),
          row("Can", list(g.powers.map((p) => p.words), "Only talk"), changing && g.approvals !== "ask" ? "warnline" : ""),
          row("Hands work to", list(g.tasks, "Nobody: it does its work itself")),
          g.requests.length ? row("Requests work from", list(g.requests, "")) : null,
          row("Takes decisions to", g.escalatesTo === "you" ? "You" : `The ${g.escalatesTo}`),
          row("Asks questions", g.asks ? "Anyone in the organization, up to 3 per task, never back up its own chain" : "Nobody"),
          row("Library", `${g.library.documents} document${g.library.documents === 1 ? "" : "s"}${g.library.folders.length ? ` in ${list(g.library.folders.slice(0, 6), "")}${g.library.folders.length > 6 ? ` and ${g.library.folders.length - 6} more folders` : ""}` : ""}${g.library.hidden ? ` · ${g.library.hidden} hidden from it` : ""}`),
          row("Workspace pages", `Reads ${g.workspace.read}${g.workspace.changeDirectly.length ? ` · changes directly: ${list(g.workspace.changeDirectly.slice(0, 5), "")}${g.workspace.changeDirectly.length > 5 ? "…" : ""}` : " · changes none directly, only suggests"}${g.workspace.hidden ? ` · ${g.workspace.hidden} hidden from it` : ""}`),
          g.connectors.length ? row("Connected services", list(g.connectors, "")) : null,
          g.keys.length ? row("Keys it may use", g.keys.map((k) => `${k.name} (only sent to ${k.host})`).join(", ")) : null,
          row("Limits", [g.budget.perTask != null ? `${money(g.budget.perTask)} a task` : null, g.budget.steps != null ? `${g.budget.steps} steps` : null, g.budget.monthly != null ? `${money(g.budget.monthly)} a month` : "no monthly limit", "30 minutes a run"].filter(Boolean).join(" · ")),
          general
            ? h(
                "label",
                { class: "arow pickrow" },
                h("input", {
                  type: "checkbox",
                  checked: state.config.assistantSeesGroups !== false,
                  onchange: (e) => attempt(async () => ((state.config = await api("PUT", "settings", { assistantSeesGroups: e.target.checked })), load()), box),
                }),
                h("span", {}, "The assistant may read documents and pages limited to some groups. It works for you; Private items stay hidden from it either way."),
              )
            : null,
          bot ? h("div", { class: "row" }, h("button", { class: "small", onclick: () => go("bot", bot.id) }, "Change its powers and limits")) : null,
        );
      }),
    );
  };
  const cards = h("div", { class: "acards" });
  const load = () =>
    api("GET", `orgs/${org.id}/access`)
      .then((g) => {
        graphs = g;
        fill(
          box,
          h("p", { class: "note" }, "What each agent can reach, all in one place: what it can do, who it can hand work to and ask, which documents and pages it can read or change, and its limits. Anything not listed here, the agent is refused. Change it on the agent's page, or with library and page access."),
          find,
          cards,
        );
        draw();
      })
      .catch((err) => fill(box, h("div", { class: "banner error" }, err.message)));
  find.addEventListener("input", draw);
  load();
  return box;
}

async function teamView() {
  ui.body.className = "body";
  ui.log = null;
  ui.orgx ??= { view: "groups", sel: null, undo: [], note: "" };
  const col = h("div", { class: "orgx" });
  fill(ui.body, h("main", { class: "center wide" }, col));
  await Promise.all([loadCrew(), loadOrgs()]);
  if (state.view !== "team") return;
  ui.orgxCol = col;
  if (!state.market) loadMarket().then(() => state.view === "team" && renderOrg()).catch(() => {});
  renderOrg();
}

/** Takes a copy of the chart as it is, so the change about to be made can be undone. */
const chartSnapshot = (org) => ({ orgId: org.id, members: structuredClone(org.members), groups: structuredClone(org.groups ?? []) });

/** Makes one change to the chart: remembers how it was first (for undo), saves, and redraws. */
async function orgChange(label, fn) {
  const org = activeOrg();
  const before = chartSnapshot(org);
  await attempt(async () => {
    await fn();
    ui.orgx.undo.push({ ...before, label });
    ui.orgx.undo = ui.orgx.undo.slice(-40);
    ui.orgx.note = label;
    ui.orgx.noteUndoes = true; // a note about a change offers Undo; any other note is information only
    await loadOrgs();
    renderOrg();
  }, ui.orgxCol);
}

async function orgUndo() {
  const last = ui.orgx.undo.pop();
  if (!last) return;
  await attempt(async () => {
    await api("PUT", `orgs/${last.orgId}/chart`, { members: last.members, groups: last.groups });
    ui.orgx.note = `Undone: ${last.label}`;
    await loadOrgs();
    renderOrg();
  }, ui.orgxCol);
}

// Cmd-Z (Ctrl-Z) undoes the last change on the Organization page, unless the cursor is in a text box.
document.addEventListener("keydown", (e) => {
  if (state.view !== "team" || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
  if (/^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? "")) return;
  e.preventDefault();
  orgUndo();
});

function renderOrg() {
  const col = ui.orgxCol;
  if (!col || state.view !== "team") return;
  const o = ui.orgx;
  const org = activeOrg();
  const bots = state.crew?.bots ?? [];
  const byId = new Map(bots.map((b) => [b.id, b]));
  const members = org.members.filter((m) => byId.has(m.bot));
  const groups = org.groups ?? [];
  const memberOf_ = (id) => members.find((m) => m.bot === id);
  const groupOfMember = (m) => groups.find((g) => g.name === m.department);
  const live = new Map((state.quests ?? []).filter(isLive).map((q) => [q.bot.id, q]));
  const outside = bots.filter((b) => !members.some((m) => m.bot === b.id));
  const below = (id) => {
    const out = [];
    for (let wave = members.filter((m) => m.manager === id); wave.length; wave = members.filter((m) => m.manager && wave.some((w) => w.bot === m.manager))) out.push(...wave);
    return out;
  };
  const nameOf = (id) => (id ? (memberOf_(id)?.title ?? byId.get(id)?.name ?? id) : "you");
  const set = (bot, patch, label) => orgChange(label, () => api("PUT", `orgs/${org.id}/members`, { bot, ...patch }));
  const select = (sel) => ((o.sel = o.sel && sel && o.sel.kind === sel.kind && o.sel.id === sel.id ? null : sel), renderOrg());

  // ----- drag and drop: a position onto a position (reports to it; with Option held, a dotted line), onto a group (joins it), onto You -----
  const drag = (payload) => ({
    draggable: "true",
    ondragstart: (e) => ((o.drag = payload), e.dataTransfer.setData("text/plain", payload.id ?? ""), (e.dataTransfer.effectAllowed = "move"), e.currentTarget.classList.add("dragging"), col.classList.add("dragging-on")),
    ondragend: (e) => ((o.drag = null), e.currentTarget.classList.remove("dragging"), col.classList.remove("dragging-on")),
  });
  const addDropped = async (d) => {
    // Something from the add bar becomes a position first, reporting to you.
    if (d.kind === "agent") return d.id;
    if (d.kind === "market") {
      await api("POST", `marketplace/${d.id}/add`);
      await loadCrew();
      state.market = null;
      return d.id;
    }
    if (d.kind === "team") {
      await api("POST", `marketplace/teams/${d.id}/add`);
      await loadCrew();
      state.market = null;
      return d.lead;
    }
    return d.id;
  };
  const dropOn = (target, e) => {
    const d = o.drag;
    o.drag = null;
    col.classList.remove("dragging-on");
    if (!d) return;
    const dotted = e?.altKey;
    // A ready-made team is a pack: its lead goes under the position it was dropped on (or into the group, or under you),
    // and its members come with it, in one step that Undo takes back.
    if (d.kind === "team") {
      if (target.kind === "position" && dotted) return ((o.note = "A team joins with reporting lines. Drop it without Option to put it under this position."), renderOrg());
      const where = target.kind === "position" ? { under: target.id } : target.kind === "group" ? { group: target.name } : {};
      const label = `Added the ${d.name ?? "team"} ${target.kind === "position" ? `under ${nameOf(target.id)}` : target.kind === "group" ? `into ${target.name}` : "reporting to you"}`;
      return orgChange(label, async () => (await api("POST", `orgs/${org.id}/pack`, { team: d.id, ...where }), await loadCrew(), (state.market = null)));
    }
    if (target.kind === "position") {
      if (d.kind === "position" && d.id === target.id) return;
      if (d.kind === "position" && below(d.id).some((m) => m.bot === target.id)) return ((o.note = `${nameOf(d.id)} is above ${nameOf(target.id)}, so it cannot report to it.`), renderOrg());
      return orgChange(dotted ? `${nameOf(d.id)} also works with ${nameOf(target.id)}` : `${d.kind === "position" ? nameOf(d.id) : "A new position"} now reports to ${nameOf(target.id)}, in ${memberOf_(target.id)?.department ?? "its group"}`, async () => {
        const bot = await addDropped(d);
        // Dropped on someone: it reports to them and joins their group (a dotted line changes neither).
        await api("PUT", `orgs/${org.id}/members`, dotted ? { bot, also: target.id } : { bot, manager: target.id, department: memberOf_(target.id)?.department });
      });
    }
    if (target.kind === "you") return orgChange(`${d.kind === "position" ? nameOf(d.id) : "A new position"} reports to you`, async () => api("PUT", `orgs/${org.id}/members`, { bot: await addDropped(d), manager: null }));
    if (target.kind === "group") return orgChange(`${d.kind === "position" ? nameOf(d.id) : "A new position"} joins ${target.name}`, async () => api("PUT", `orgs/${org.id}/members`, { bot: await addDropped(d), department: target.name }));
  };
  const drop = (target) => ({
    ondragover: (e) => {
      if (!o.drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.add("dropover");
    },
    ondragleave: (e) => e.currentTarget.classList.remove("dropover"),
    ondrop: (e) => (e.preventDefault(), e.stopPropagation(), e.currentTarget.classList.remove("dropover"), dropOn(target, e)),
  });

  // ----- a position, as a card -----
  const card = (m, { showGroup = false, depth = 0 } = {}) => {
    const bot = byId.get(m.bot);
    const q = live.get(m.bot);
    const g = groupOfMember(m);
    const leads = g?.lead === m.bot;
    const outsideBoss = m.manager && memberOf_(m.manager)?.department !== m.department;
    return h(
      "div",
      { class: `poscard ${o.sel?.kind === "position" && o.sel.id === m.bot ? "on" : ""} ${leads ? "lead" : ""}`, style: `${botStyle(bot)}; margin-left: ${depth * 22}px`, role: "button", tabindex: "0", title: "Click to edit. Drag onto someone to report to them; hold Option for a dotted line.", onclick: () => select({ kind: "position", id: m.bot }), onkeydown: (e) => e.key === "Enter" && select({ kind: "position", id: m.bot }), ...drag({ kind: "position", id: m.bot }), ...drop({ kind: "position", id: m.bot }) },
      keycap(bot, 30, mood(q), bot.type),
      h(
        "span",
        { class: "posmain" },
        h("b", {}, m.title, leads ? h("span", { class: "leadtag" }, "Lead") : null),
        h("span", { class: "possub" }, [bot.name !== m.title ? bot.name : null, showGroup && m.department ? m.department : null, outsideBoss || (showGroup && m.manager) ? `reports to ${nameOf(m.manager)}` : !m.manager && depth === 0 ? "reports to you" : null, m.also ? `also works with ${nameOf(m.also)}` : null].filter(Boolean).join(" · ")),
      ),
      q ? h("span", { class: "pill loud" }, q.status === "waiting" ? "Needs you" : "Working") : bot.month?.state === "stopped" ? h("span", { class: "pill loud" }, "At budget") : null,
    );
  };

  // ----- the groups view: each group a frame, its lead on top and the lines inside it -----
  const groupTree = (g) => {
    const inIt = members.filter((m) => m.department === g.name);
    const roots = inIt.filter((m) => !m.manager || !inIt.some((x) => x.bot === m.manager)).sort((a, b) => Number(b.bot === g.lead) - Number(a.bot === g.lead) || a.title.localeCompare(b.title));
    const out = [];
    const walk = (m, depth) => {
      out.push(card(m, { depth }));
      for (const r of inIt.filter((x) => x.manager === m.bot).sort((a, b) => a.title.localeCompare(b.title))) walk(r, depth + 1);
    };
    roots.forEach((m) => walk(m, 0));
    return out;
  };
  /** ok, warned (80% used) or stopped (used up: its positions start no new work this month). */
  const groupState = (g) => (g.budget == null ? "ok" : (org.groupSpend?.[g.id] ?? 0) >= g.budget ? "stopped" : (org.groupSpend?.[g.id] ?? 0) >= g.budget * 0.8 ? "warned" : "ok");
  const frame = (g) => {
    const inIt = members.filter((m) => m.department === g.name);
    const spend = org.groupSpend?.[g.id] ?? 0;
    const st = groupState(g);
    return h(
      "section",
      { class: `groupframe ${o.sel?.kind === "group" && o.sel.id === g.id ? "on" : ""} ${st}`, ...drop({ kind: "group", name: g.name }) },
      h(
        "header",
        { role: "button", tabindex: "0", title: "Click to edit the group", onclick: () => select({ kind: "group", id: g.id }), onkeydown: (e) => e.key === "Enter" && select({ kind: "group", id: g.id }) },
        h("div", { class: "grow" }, h("h2", {}, g.name), h("div", { class: "note small" }, [`${inIt.length} position${inIt.length === 1 ? "" : "s"}`, g.lead ? `led by ${nameOf(g.lead)}` : "no lead yet", g.budget != null ? `${money(spend)} of ${money(g.budget)} this month${st === "stopped" ? ", used up" : ""}` : spend >= 0.01 ? `${money(spend)} this month` : null].filter(Boolean).join(" · ")), g.goal ? h("div", { class: "groupgoal" }, g.goal) : null),
        inIt.length ? h("button", { class: "plain small", title: "Its lead shares the work out and brings back one result", onclick: (e) => (e.stopPropagation(), (state.selectedTeam = g.lead ?? inIt[0].bot), go("home")) }, "Give a task") : null,
      ),
      h("div", { class: "groupbody" }, inIt.length ? groupTree(g) : h("p", { class: "note small dropnote" }, "Drag positions here.")),
    );
  };
  const youBar = () => {
    const direct = members.filter((m) => !m.manager).length;
    return h(
      "section",
      { class: "youbar", ...drop({ kind: "you" }) },
      h("span", { class: "youmark", "aria-hidden": "true" }, "You"),
      h("div", { class: "grow" }, h("b", {}, "You, the owner"), h("div", { class: "note small" }, `${direct} position${direct === 1 ? "" : "s"} report${direct === 1 ? "s" : ""} to you directly. Drop a position here to have it report to you.`)),
    );
  };
  const groupsView = () => h("div", { class: "orgboard" }, youBar(), h("div", { class: "frames" }, groups.map(frame), h("button", { class: "groupframe newgroup", onclick: () => newGroup() }, h("span", { class: "plus", "aria-hidden": "true" }, "+"), h("b", {}, "New group"), h("span", { class: "note small" }, "A team or department, with a lead"))));

  // ----- the chart view: the whole tree, from you -----
  const chartView = () => {
    const branch = (m) => h("li", {}, card(m, { showGroup: true }), ((kids) => (kids.length ? h("ul", {}, kids.map(branch)) : null))(members.filter((x) => x.manager === m.bot).sort((a, b) => a.title.localeCompare(b.title))));
    const tops = members.filter((m) => !m.manager).sort((a, b) => a.department.localeCompare(b.department) || a.title.localeCompare(b.title));
    return h("div", { class: "treewrap" }, h("ul", { class: "tree" }, h("li", {}, h("div", { class: "poscard you", ...drop({ kind: "you" }) }, h("span", { class: "youmark", "aria-hidden": "true" }, "You"), h("span", { class: "posmain" }, h("b", {}, "You"), h("span", { class: "possub" }, "the owner"))), tops.length ? h("ul", {}, tops.map(branch)) : null)));
  };

  // ----- the list view: one row per position, every field editable in place -----
  const listView = () =>
    h(
      "div",
      { class: "poslist" },
      h("div", { class: "posrow head" }, h("span", {}, "Position"), h("span", {}, "Group"), h("span", {}, "Reports to"), h("span", {}, "Also works with"), h("span", {}, "Budget")),
      [...members]
        .sort((a, b) => a.department.localeCompare(b.department) || a.title.localeCompare(b.title))
        .map((m) => {
          const bot = byId.get(m.bot);
          const above = new Set([m.bot, ...below(m.bot).map((x) => x.bot)]);
          return h(
            "div",
            { class: "posrow" },
            h("button", { class: "plain poslink", onclick: () => select({ kind: "position", id: m.bot }) }, keycap(bot, 22, "", bot.type), h("span", {}, h("b", {}, m.title), bot.name !== m.title ? h("span", { class: "note small" }, ` · ${bot.name}`) : null)),
            h("select", { "aria-label": `${m.title}'s group`, onchange: (e) => set(m.bot, { department: e.target.value }, `${m.title} joins ${e.target.value}`) }, groups.map((g) => h("option", { value: g.name, selected: g.name === m.department }, g.name))),
            h("select", { "aria-label": `Who ${m.title} reports to`, onchange: (e) => set(m.bot, { manager: e.target.value || null }, `${m.title} reports to ${nameOf(e.target.value || null)}`) }, h("option", { value: "", selected: !m.manager }, "You"), members.filter((x) => !above.has(x.bot)).map((x) => h("option", { value: x.bot, selected: x.bot === m.manager }, x.title))),
            h("select", { "aria-label": `Who ${m.title} also works with`, onchange: (e) => set(m.bot, { also: e.target.value || null }, e.target.value ? `${m.title} also works with ${nameOf(e.target.value)}` : `${m.title} has no dotted line`) }, h("option", { value: "", selected: !m.also }, "Nobody"), members.filter((x) => x.bot !== m.bot && x.bot !== m.manager).map((x) => h("option", { value: x.bot, selected: x.bot === m.also }, x.title))),
            h("span", { class: "mono small" }, bot.month?.limit != null ? `${money(bot.month.spent ?? 0)} / ${money(bot.month.limit)}` : "no limit"),
          );
        }),
    );

  // ----- the side panel: what is selected, every field editable -----
  const positionPanel = (m) => {
    const bot = byId.get(m.bot);
    const above = new Set([m.bot, ...below(m.bot).map((x) => x.bot)]);
    const g = groupOfMember(m);
    const canHand = [...below(m.bot), ...members.filter((x) => x.also === m.bot)];
    const mine = new Set(canHand.map((x) => x.bot));
    const canRequest = members.filter((x) => x.bot !== m.bot && !mine.has(x.bot) && x.department !== m.department && groups.find((gg) => gg.name === x.department)?.lead === x.bot);
    const title = h("input", { value: m.title, maxlength: 50, "aria-label": "Title" });
    const resp = h("textarea", { rows: 3, maxlength: 400, placeholder: "What this position is responsible for, in a sentence or two. The agent is told.", "aria-label": "Responsibilities" }, m.responsibilities ?? "");
    const saveText = () => {
      const patch = {};
      if (title.value.trim() && title.value.trim() !== m.title) patch.title = title.value.trim();
      if (resp.value.trim() !== (m.responsibilities ?? "")) patch.responsibilities = resp.value.trim();
      if (Object.keys(patch).length) set(m.bot, patch, `Changed ${m.title}`);
    };
    title.addEventListener("change", saveText);
    resp.addEventListener("change", saveText);
    const marketBots = (state.market ?? []).filter((b) => !byId.has(b.id));
    const swap = h(
      "select",
      { "aria-label": "Put another agent in this position" },
      h("option", { value: "" }, "Put another agent in this position…"),
      outside.length ? h("optgroup", { label: "Your agents not on the chart" }, outside.map((b) => h("option", { value: `own:${b.id}` }, b.name))) : null,
      marketBots.length ? h("optgroup", { label: "From the marketplace" }, marketBots.map((b) => h("option", { value: `market:${b.id}` }, `${b.name} · ${b.listing.category}`))) : null,
    );
    swap.addEventListener("change", () => {
      const [kind, id] = swap.value.split(":");
      if (!id) return;
      orgChange(`${byId.get(id)?.name ?? "Another agent"} took the ${m.title} position`, async () => {
        if (kind === "market") {
          await api("POST", `marketplace/${id}/add`);
          await loadCrew();
          state.market = null;
          // Adding an agent puts it on the chart; it is taken off again so it can step into this position.
          await api("DELETE", `orgs/${org.id}/members/${id}`).catch(() => {});
        }
        await api("POST", `orgs/${org.id}/members/${m.bot}/agent`, { to: id });
        o.sel = { kind: "position", id };
      });
    });
    return [
      h("div", { class: "panelhead", style: botStyle(bot) }, keycap(bot, 44, mood(live.get(m.bot)), bot.type), h("div", { class: "grow" }, h("b", {}, m.title), h("div", { class: "note small" }, `Filled by ${bot.name}`)), h("button", { class: "plain small", "aria-label": "Close", onclick: () => select(null) }, "✕")),
      h("label", {}, "Title", title),
      h("label", {}, "Responsible for", resp),
      h("label", {}, "Group", h("select", { onchange: (e) => set(m.bot, { department: e.target.value }, `${m.title} joins ${e.target.value}`) }, groups.map((gg) => h("option", { value: gg.name, selected: gg.name === m.department }, gg.name)))),
      h("label", {}, "Reports to", h("select", { onchange: (e) => set(m.bot, { manager: e.target.value || null }, `${m.title} reports to ${nameOf(e.target.value || null)}`) }, h("option", { value: "", selected: !m.manager }, "You"), members.filter((x) => !above.has(x.bot)).map((x) => h("option", { value: x.bot, selected: x.bot === m.manager }, x.title)))),
      h("label", {}, "Also works with (dotted line)", h("select", { onchange: (e) => set(m.bot, { also: e.target.value || null }, e.target.value ? `${m.title} also works with ${nameOf(e.target.value)}` : `${m.title} has no dotted line`) }, h("option", { value: "", selected: !m.also }, "Nobody"), members.filter((x) => x.bot !== m.bot && x.bot !== m.manager).map((x) => h("option", { value: x.bot, selected: x.bot === m.also }, x.title)))),
      h("div", { class: "panelrules" }, h("div", { class: "label" }, "How work moves for this position"), h("p", {}, canHand.length ? `Can hand work to: ${canHand.map((x) => x.title).join(", ")}.` : "Hands no work out: nobody is below it."), canRequest.length ? h("p", {}, `Can request work from: ${canRequest.map((x) => x.title).join(", ")}.`) : null, h("p", {}, m.manager ? `Takes decisions up to: ${nameOf(m.manager)}.` : "Takes decisions up to: you."), g?.lead === m.bot ? h("p", {}, `Leads ${g.name}: work for the group comes here first.`) : null),
      h("div", { class: "panelline" }, h("span", { class: "grow" }, "Monthly budget"), h("b", {}, bot.month?.limit != null ? `${money(bot.month.spent ?? 0)} of ${money(bot.month.limit)}` : "No limit"), h("button", { class: "plain small", onclick: () => go("bot", bot.id) }, "Change")),
      h("div", { class: "panelline" }, h("span", { class: "grow" }, "Model"), h("b", {}, bot.model ? bot.model.split("/").pop() : "Your main model"), h("button", { class: "plain small", onclick: () => go("bot", bot.id) }, "Change")),
      swap,
      h("div", { class: "row wrap" }, h("button", { class: "primary small", onclick: () => ((state.selectedTeam = members.some((x) => x.manager === m.bot) ? m.bot : null), (state.selectedBot = m.bot), go("home")) }, "Give a task"), h("button", { class: "small", onclick: () => chatWith(bot) }, "Chat"), h("button", { class: "plain small danger", onclick: () => confirm(`Take ${m.title} off the chart?\n\nAnyone reporting to it moves up to ${nameOf(m.manager)}. ${bot.name} stays on your team and can be added back. You can undo this.`) && orgChange(`Took ${m.title} off the chart`, async () => (await api("DELETE", `orgs/${org.id}/members/${m.bot}`), (o.sel = null))) }, "Take off the chart")),
    ];
  };
  const groupPanel = (g) => {
    const inIt = members.filter((m) => m.department === g.name);
    const name = h("input", { value: g.name, maxlength: 30, "aria-label": "Group name" });
    const goal = h("textarea", { rows: 2, maxlength: 300, placeholder: "What this group is for, in a sentence. Its positions are told.", "aria-label": "Goal" }, g.goal ?? "");
    const budget = h("input", { type: "number", min: "0", step: "5", value: g.budget ?? "", placeholder: "No limit", "aria-label": "Monthly budget in dollars" });
    const patch = (body, label) => orgChange(label, () => api("PATCH", `orgs/${org.id}/groups/${g.id}`, body));
    name.addEventListener("change", () => name.value.trim() && name.value.trim() !== g.name && patch({ name: name.value.trim() }, `Renamed ${g.name} to ${name.value.trim()}`));
    goal.addEventListener("change", () => patch({ goal: goal.value.trim() }, `Changed ${g.name}'s purpose`));
    budget.addEventListener("change", () => patch({ budget: budget.value === "" ? null : Number(budget.value) }, `Changed ${g.name}'s budget`));
    const others = groups.filter((x) => x.id !== g.id);
    const moveTo = h("select", { "aria-label": "Move its positions to" }, others.map((x) => h("option", { value: x.id }, x.name)));
    return [
      h("div", { class: "panelhead" }, h("span", { class: "groupmark", "aria-hidden": "true" }, g.name.slice(0, 1).toUpperCase()), h("div", { class: "grow" }, h("b", {}, g.name), h("div", { class: "note small" }, `${inIt.length} position${inIt.length === 1 ? "" : "s"}`)), h("button", { class: "plain small", "aria-label": "Close", onclick: () => select(null) }, "✕")),
      h("label", {}, "Name", name),
      h("label", {}, "Lead", h("select", { onchange: (e) => patch({ lead: e.target.value || null }, e.target.value ? `${nameOf(e.target.value)} leads ${g.name}` : `${g.name} has no lead`) }, h("option", { value: "", selected: !g.lead }, "Nobody yet"), members.map((m) => h("option", { value: m.bot, selected: m.bot === g.lead }, `${m.title}${m.department !== g.name ? ` (moves here)` : ""}`)))),
      h("p", { class: "note small" }, g.leadChosen ? "You chose this lead." : "Picked from the chart: the position at the top of the group. Choose one to keep it."),
      h("label", {}, "Purpose", goal),
      h("label", {}, "Monthly budget, all its positions together ($)", budget),
      h("p", { class: `note small ${groupState(g) === "stopped" ? "loudnote" : ""}` }, [
        `Spent this month: ${money(org.groupSpend?.[g.id] ?? 0)}.`,
        groupState(g) === "stopped" ? " Used up: its positions start no new work until you raise it or the month turns." : groupState(g) === "warned" ? " Over 80% used." : "",
        " Work counts towards the group its agent was in when the task started.",
      ].join("")),
      h("div", { class: "row wrap" }, inIt.length ? h("button", { class: "primary small", onclick: () => ((state.selectedTeam = g.lead ?? inIt[0].bot), (state.selectedBot = g.lead ?? inIt[0].bot), go("home")) }, "Give this group a task") : null),
      h(
        "div",
        { class: "panelline danger-zone" },
        inIt.length && others.length ? [h("span", { class: "grow note small" }, "Remove the group, moving its positions to"), moveTo] : h("span", { class: "grow note small" }, inIt.length ? "A group with positions can be removed once there is another group to move them to." : "Remove this empty group."),
        h("button", { class: "plain small danger", disabled: inIt.length > 0 && !others.length, onclick: () => confirm(`Remove the group ${g.name}?${inIt.length ? ` Its ${inIt.length} position${inIt.length === 1 ? "" : "s"} move to ${others.find((x) => x.id === moveTo.value)?.name}.` : ""} You can undo this.`) && orgChange(`Removed the group ${g.name}`, async () => (await api("DELETE", `orgs/${org.id}/groups/${g.id}${inIt.length ? `?moveTo=${encodeURIComponent(moveTo.value)}` : ""}`), (o.sel = null))) }, "Remove"),
      ),
    ];
  };
  const panel = () => {
    if (o.sel?.kind === "position") {
      const m = memberOf_(o.sel.id);
      return m ? h("aside", { class: "orgpanel2" }, positionPanel(m)) : null;
    }
    if (o.sel?.kind === "group") {
      const g = groups.find((x) => x.id === o.sel.id);
      return g ? h("aside", { class: "orgpanel2" }, groupPanel(g)) : null;
    }
    return null;
  };

  // ----- the add bar: blank positions, the person's agents, the marketplace, ready-made teams, new groups -----
  const addFind = h("input", { type: "search", placeholder: "Find a role or a team", value: o.find ?? "", "aria-label": "Find a role or a team" });
  const addList = h("div", { class: "addlist" });
  const drawAdd = () => {
    const needle = addFind.value.trim().toLowerCase();
    o.find = addFind.value;
    const match = (t) => !needle || t.toLowerCase().includes(needle);
    const item = (bot, payload, sub) => h("div", { class: "additem", style: botStyle(bot), ...drag(payload), role: "button", tabindex: "0", title: "Drag onto the chart, or click to add it reporting to you", onclick: () => ((o.drag = payload), dropOn({ kind: "you" })) }, keycap(bot, 24, "", bot.type), h("span", { class: "posmain" }, h("b", {}, bot.name), h("span", { class: "possub" }, sub)));
    const teams = (state.marketTeams ?? []).filter((t) => match(`${t.name} ${t.summary}`));
    const market = (state.market ?? []).filter((b) => !byId.has(b.id) && match(`${b.name} ${b.listing.category} ${b.listing.summary}`));
    const marketById = new Map((state.market ?? []).map((b) => [b.id, b]));
    fill(
      addList,
      outside.filter((b) => match(`${b.name} ${b.group}`)).length ? [h("div", { class: "label" }, "Your agents, not on the chart"), outside.filter((b) => match(`${b.name} ${b.group}`)).map((b) => item(b, { kind: "agent", id: b.id }, b.group))] : null,
      teams.length
        ? [
            h("div", { class: "label" }, "Ready-made teams"),
            teams.map((t) => {
              const lead = marketById.get(t.bots[0]);
              return h("div", { class: "additem team", ...drag({ kind: "team", id: t.id, lead: t.bots[0], name: t.name }), role: "button", tabindex: "0", title: "Drag onto the position it should report to, or into a group, or click to add it under you", onclick: () => ((o.drag = { kind: "team", id: t.id, lead: t.bots[0], name: t.name }), dropOn({ kind: "you" })) }, lead ? keycap(lead, 24, "", lead.type) : null, h("span", { class: "posmain" }, h("b", {}, t.name), h("span", { class: "possub" }, `${t.bots.length} positions, led by ${lead?.name ?? "its lead"}`)));
            }),
          ]
        : null,
      market.length ? [h("div", { class: "label" }, needle ? "From the marketplace" : "From the marketplace (search for more)"), market.slice(0, needle ? 30 : 10).map((b) => item(b, { kind: "market", id: b.id }, b.listing.category))] : null,
      !state.market ? h("p", { class: "note small" }, "Loading the marketplace…") : null,
    );
  };
  addFind.addEventListener("input", drawAdd);
  drawAdd();

  // ----- what it costs, and what needs fixing -----
  const limits = members.map((m) => byId.get(m.bot)?.month?.limit).filter((x) => x != null);
  const unlimited = members.length - limits.length;
  const problems = [
    ...groups.filter((g) => !g.lead && members.some((m) => m.department === g.name)).map((g) => [`${g.name} has no lead, so requests from other groups have nowhere to go.`, "Choose a lead", () => select({ kind: "group", id: g.id })]),
    ...members.filter((m) => !groups.some((g) => g.name === m.department)).map((m) => [`${m.title} is not in a group.`, "Choose a group", () => select({ kind: "position", id: m.bot })]),
  ];

  // ----- suggested positions: proposals from the mission, each accepted or skipped by the owner -----
  const suggestNow = async (mission) => {
    o.suggesting = true;
    o.suggestOpen = true;
    renderOrg();
    try {
      if (mission !== undefined && mission.trim() !== (org.mission ?? "")) {
        await api("PATCH", `orgs/${org.id}`, { mission: mission.trim() });
        await loadOrgs();
      }
      o.suggest = await api("POST", `orgs/${org.id}/suggest`, { mission: mission ?? org.mission });
      o.suggestFor = org.id;
    } catch (err) {
      o.suggest = { error: err.message, positions: [] };
    }
    o.suggesting = false;
    renderOrg();
  };
  const accept = (p) => orgChange(`Added ${p.title}${p.reportsTo ? `, reporting to ${nameOf(p.reportsTo)}` : ""}`, async () => {
    await api("POST", `orgs/${org.id}/accept`, { bot: p.bot, group: p.group, reportsTo: p.reportsTo });
    await loadCrew();
    o.suggest.positions = o.suggest.positions.filter((x) => x !== p);
  });
  const skip = (p) => ((o.suggest.positions = o.suggest.positions.filter((x) => x !== p)), renderOrg());
  const suggestions = () => {
    if (!o.suggestOpen || o.suggestFor !== org.id && !o.suggesting) return null;
    const sg = o.suggest;
    const market = new Map((state.market ?? []).map((b) => [b.id, b]));
    return h(
      "section",
      { class: "suggestbox" },
      h("div", { class: "row" }, h("b", { class: "grow" }, "Suggested positions"), h("button", { class: "plain small", "aria-label": "Close suggestions", onclick: () => ((o.suggestOpen = false), renderOrg()) }, "✕")),
      o.suggesting
        ? h("p", { class: "note" }, h("i", { class: "dot", "aria-hidden": "true" }), " Reading your mission and the roles available…")
        : sg?.error
          ? h("div", { class: "banner error" }, sg.error)
          : [
              sg?.intro ? h("p", { class: "note" }, sg.intro) : null,
              sg?.positions?.length
                ? [
                    h(
                      "div",
                      { class: "suggestlist" },
                      sg.positions.map((p) => {
                        const bot = market.get(p.bot) ?? byId.get(p.bot);
                        return h(
                          "div",
                          { class: "suggestcard", style: bot ? botStyle(bot) : "" },
                          bot ? keycap(bot, 30, "", bot.type) : null,
                          h("span", { class: "posmain" }, h("b", {}, p.title), h("span", { class: "possub" }, [p.group, p.reportsTo ? `reports to ${sg.positions.find((x) => x.bot === p.reportsTo)?.title ?? nameOf(p.reportsTo)}` : "reports to you"].join(" · ")), h("span", { class: "suggestwhy" }, p.why)),
                          h("div", { class: "suggestacts" }, h("button", { class: "primary small", onclick: () => accept(p) }, "Accept"), h("button", { class: "plain small", onclick: () => skip(p) }, "Skip")),
                        );
                      }),
                    ),
                    h("div", { class: "row" }, h("span", { class: "note small grow" }, `${sg.source === "model" ? `Suggested by your model${sg.cost ? ` for ${money(sg.cost)}` : ""}` : "Matched to the words in your mission"}. Nothing is added until you accept it.`), h("button", { class: "small", onclick: () => suggestNow() }, "Suggest others")),
                  ]
                : h("p", { class: "note" }, "That's every suggestion. Add more from the left whenever you need them."),
            ],
    );
  };
  // An empty organization: only the owner. The mission comes first, then positions, one at a time, by the owner's choice.
  const startPanel = () => {
    const mission = h("input", { value: org.mission ?? "", maxlength: 300, placeholder: "e.g. We sell handmade furniture online and deliver across the UK.", "aria-label": "Mission" });
    mission.addEventListener("keydown", (e) => e.key === "Enter" && mission.value.trim() && suggestNow(mission.value));
    return h(
      "section",
      { class: "startpanel hero", ...drop({ kind: "you" }) },
      heroVideo(),
      h("div", { class: "startyou" }, h("span", { class: "youmark", "aria-hidden": "true" }, "You"), h("div", {}, h("b", {}, "Right now it's just you."), h("p", { class: "note" }, "Build your organization one position at a time. Nothing is added unless you choose it."))),
      h("div", { class: "startstep" }, h("span", { class: "wiznum" }, "1"), h("div", { class: "grow" }, h("b", {}, "What is your organization for?"), h("p", { class: "note small" }, "One sentence. Every agent is told it, and it shapes the suggestions."), h("div", { class: "row" }, mission, h("button", { class: "primary", onclick: () => (mission.value.trim() ? suggestNow(mission.value) : mission.focus()) }, "Suggest positions")))),
      h("div", { class: "startstep" }, h("span", { class: "wiznum" }, "2"), h("div", { class: "grow" }, h("b", {}, "Add positions your way"), h("ul", { class: "startways" }, h("li", {}, "Accept or skip the suggestions"), h("li", {}, "Drag a role or a ready-made team from the left onto this panel"), h("li", {}, h("span", {}, "Or "), h("button", { class: "plain link", onclick: () => orgSettings() }, "copy an example"), h("span", {}, ", then make it yours"))))),
    );
  };

  const proposals = () =>
    org.proposals?.length
      ? h(
          "section",
          { class: "suggestbox proposalbox" },
          h("b", {}, `${org.proposals.length === 1 ? "A position your agents propose" : `${org.proposals.length} positions your agents propose`}`),
          h(
            "div",
            { class: "suggestlist" },
            org.proposals.map((p) => {
              const bot = (state.market ?? []).find((b) => b.id === p.bot) ?? byId.get(p.bot);
              const box = h(
                "div",
                { class: "suggestcard", style: bot ? botStyle(bot) : "" },
                bot ? keycap(bot, 30, "", bot.type) : null,
                h("span", { class: "posmain" }, h("b", {}, p.title), h("span", { class: "possub" }, `${p.group} · reports to ${p.reportsTo ? nameOf(p.reportsTo) : "you"} · proposed by ${nameOf(p.by)}`), h("span", { class: "suggestwhy" }, p.why)),
                h("div", { class: "suggestacts" }, h("button", { class: "primary small", onclick: () => answerProposal(org, p, "approve", box).then(renderOrg) }, "Approve"), h("button", { class: "plain small", onclick: () => answerProposal(org, p, "decline", box).then(renderOrg) }, "Decline")),
              );
              return box;
            }),
          ),
        )
      : null;

  const side = panel();
  const views = [["groups", "Groups"], ["chart", "Chart"], ["list", "List"], ["access", "Access"], ["memory", "Memory"]];
  fill(
    col,
    h(
      "div",
      { class: "orghead" },
      h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, org.name), state.orgs.orgs.length > 1 ? h("select", { class: "orgpick", "aria-label": "Organization", onchange: (e) => attempt(async () => (await api("PATCH", `orgs/${e.target.value}`, { active: true }), await loadOrgs(), (o.sel = null), (o.undo = []), renderOrg()), col) }, state.orgs.orgs.map((x) => h("option", { value: x.id, selected: x.id === org.id }, x.name))) : null), h("p", { class: "lead" }, org.mission || "Add your mission under Settings: every agent is told it.")),
      h("button", { class: "small", onclick: () => orgSettings() }, "Settings"),
    ),
    h(
      "div",
      { class: "orgstrip" },
      h("span", {}, h("b", {}, String(members.length)), ` position${members.length === 1 ? "" : "s"}`),
      h("span", {}, h("b", {}, String(groups.length)), ` group${groups.length === 1 ? "" : "s"}`),
      h("span", { title: "The monthly budgets set for each agent, added up" }, limits.length ? [h("b", {}, money(limits.reduce((a, b) => a + b, 0))), " a month at most"] : "No monthly limits set", unlimited && limits.length ? h("span", { class: "note small" }, ` (+${unlimited} without a limit)`) : null),
      h("span", { class: "grow" }),
      h("div", { class: "viewswitch", role: "group", "aria-label": "View" }, views.map(([id, label]) => h("button", { class: o.view === id ? "on" : "", "aria-pressed": String(o.view === id), onclick: () => ((o.view = id), renderOrg()) }, label))),
      members.length ? h("button", { class: "small", title: "Positions that would help your mission, to accept or skip", onclick: () => (org.mission ? suggestNow() : orgSettings()) }, "Suggest positions") : null,
      h("button", { class: "small", disabled: !o.undo.length, title: o.undo.length ? `Undo: ${o.undo.at(-1).label} (Cmd-Z)` : "Nothing to undo", onclick: () => orgUndo() }, "Undo"),
      h("button", { class: "plain small", title: "Every change is recorded in the audit log", onclick: () => ((ui.audit = { kind: "organization", actor: "", since: "30", q: "" }), go("audit")) }, "History"),
    ),
    o.note ? h("div", { class: "banner" }, o.note, o.undo.length && o.noteUndoes ? h("button", { class: "plain small", onclick: () => orgUndo() }, "Undo") : null) : null,
    problems.length ? h("div", { class: "orgproblems" }, problems.map(([text, fix, fn]) => h("div", { class: "orgproblem" }, h("span", { class: "grow" }, text), h("button", { class: "small", onclick: fn }, fix)))) : null,
    o.view === "access"
      ? orgAccessPanel(org)
      : o.view === "memory"
      ? orgMemoryPanel(org, groups)
      : h(
          "div",
          { class: `orgwork ${side ? "withpanel" : ""}` },
          h("aside", { class: "addbar" }, h("div", { class: "row" }, h("b", { class: "grow" }, "Add"), h("button", { class: "small", onclick: () => newGroup() }, "+ Group")), addFind, h("p", { class: "note small" }, "Drag onto a position to report to it, onto a group to join it, or onto You."), addList),
          h("div", { class: "orgcanvas" }, proposals(), suggestions(), members.length ? (o.view === "chart" ? chartView() : o.view === "list" ? listView() : groupsView()) : startPanel()),
          side,
        ),
  );
  o.note = "";
  o.noteUndoes = false;

  // ----- dialogs -----
  async function newGroup() {
    const name = h("input", { placeholder: "e.g. Sales, Customer care, Product", maxlength: 30, "aria-label": "Group name" });
    const lead = h("select", { "aria-label": "Lead" }, h("option", { value: "" }, "Choose later"), members.map((m) => h("option", { value: m.bot }, m.title)));
    const goal = h("input", { placeholder: "What it is for (optional)", maxlength: 300, "aria-label": "Purpose" });
    const got = await libDialog("New group", h("div", { class: "composeform" }, h("label", {}, "Name", name), h("label", {}, "Lead", lead), goal, h("p", { class: "note small" }, "The lead moves into the group. Drag other positions in afterwards.")), [["Create", () => ({ name: name.value.trim(), lead: lead.value, goal: goal.value.trim() }), true]]);
    if (!got?.name) return;
    orgChange(`Made the group ${got.name}`, () => api("POST", `orgs/${org.id}/groups`, { name: got.name, lead: got.lead || undefined, goal: got.goal || undefined }));
  }
  async function orgSettings() {
    const name = h("input", { value: org.name, maxlength: 50, "aria-label": "Name" });
    const mission = h("input", { value: org.mission, maxlength: 300, placeholder: "What it is for, in a sentence", "aria-label": "Mission" });
    const philosophy = h("textarea", { rows: 3, maxlength: 1200, placeholder: "How you run it, in your own words (optional). Every agent is told.", "aria-label": "How you run it" }, org.philosophy ?? "");
    const limit = h("input", { type: "number", min: "0", value: org.approvalLimit ?? "", placeholder: "Every commitment", "aria-label": "Approval limit" });
    const structures = state.orgs.structures ?? [];
    const industries = state.orgs.industries ?? [];
    const exIndustry = h("select", { "aria-label": "Kind of business" }, industries.map((i) => h("option", { value: i.id, selected: i.id === org.industry }, i.name)));
    const exStructure = h("select", { "aria-label": "Example" }, structures.filter((s) => s.id !== "custom").map((s) => h("option", { value: s.id, selected: s.id === org.structure }, `${s.name}: ${s.summary}`)));
    const body = h(
      "div",
      { class: "composeform" },
      h("label", {}, "Name", name),
      h("label", {}, "Mission", mission),
      philosophy,
      h("label", {}, "Commitments above this many dollars need your approval", limit),
      h("div", { class: "label", style: "margin-top: 10px" }, "Copy an example"),
      h("p", { class: "note small" }, "Adds the example's positions you don't have yet, with its lines. Nothing you have is removed or moved."),
      h("div", { class: "row wrap" }, exIndustry, exStructure, h("button", { class: "small", onclick: () => (dialogDone("example"), null) }, "Copy")),
      h("div", { class: "label", style: "margin-top: 10px" }, "Save or share it"),
      h("p", { class: "note small" }, "One readable file with the chart and the agents you made or edited. No keys, tasks, memory or library files."),
      h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => dialogDone("export") }, "Export this organization"), h("button", { class: "small", onclick: () => dialogDone("import") }, "Import an organization…")),
      h("div", { class: "label", style: "margin-top: 10px" }, "Other organizations"),
      h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => dialogDone("new") }, "New organization"), h("button", { class: "small danger", onclick: () => dialogDone("clear") }, "Start over (empty chart)"), state.orgs.orgs.length > 1 ? h("button", { class: "small danger", onclick: () => dialogDone("delete") }, "Delete this organization") : null),
    );
    let dialogDone;
    const choice = await new Promise((resolve) => {
      dialogDone = (v) => (document.querySelector("dialog.libdialog")?.close(), document.querySelector("dialog.libdialog")?.remove(), resolve(v));
      libDialog(`${org.name}: settings`, body, [["Save", () => "save", true]]).then((v) => resolve(v));
    });
    if (choice === "save") {
      return orgChange("Changed the organization's settings", () => api("PATCH", `orgs/${org.id}`, { name: name.value, mission: mission.value, philosophy: philosophy.value, approvalLimit: limit.value === "" ? null : Number(limit.value) }));
    }
    if (choice === "example") {
      const s = structures.find((x) => x.id === exStructure.value);
      if (!confirm(`Copy the “${s?.name}” example for ${industries.find((i) => i.id === exIndustry.value)?.name.toLowerCase()} onto ${org.name}?\n\nPositions you don't have yet are added with the example's lines. Nothing you have is removed or moved. You can undo this.`)) return;
      return orgChange(`Copied the ${s?.name} example`, async () => (await api("POST", `orgs/${org.id}/build`, { structure: exStructure.value, industry: exIndustry.value }), await loadCrew()));
    }
    if (choice === "clear") {
      if (!confirm(`Start ${org.name} over with an empty chart?\n\nEvery agent stays on your team; chats, tasks and memory are kept. You can undo this.`)) return;
      return orgChange("Started over with an empty chart", async () => (await api("POST", `orgs/${org.id}/reset`, { mode: "empty" }), (o.sel = null), (o.suggest = null), (o.suggestOpen = false)));
    }
    if (choice === "delete") {
      if (!confirm(`Delete the organization “${org.name}”?\n\nIts chart, its memory and its library documents are deleted. The agents themselves are kept. This cannot be undone.`)) return;
      return attempt(async () => (await api("DELETE", `orgs/${org.id}`), await loadOrgs(), (o.sel = null), (o.undo = []), renderOrg()), col);
    }
    if (choice === "export") {
      return attempt(async () => {
        const file = await api("GET", `orgs/${org.id}/export`);
        const a = h("a", { href: URL.createObjectURL(new Blob([file.text], { type: "text/yaml" })), download: file.name });
        document.body.append(a);
        a.click();
        setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
        o.note = `Exported ${org.name} as “${file.name}”.`;
        renderOrg();
      }, col);
    }
    if (choice === "import") {
      const picker = h("input", { type: "file", accept: ".yaml,.yml,.txt", style: "display:none" });
      document.body.append(picker);
      picker.addEventListener("change", () => {
        const chosen = picker.files?.[0];
        picker.remove();
        if (!chosen) return;
        attempt(async () => {
          const got = await api("POST", "orgs/import", { text: await chosen.text() });
          await Promise.all([loadOrgs(), loadCrew()]);
          state.market = null;
          o.sel = null;
          o.undo = [];
          o.note = `Imported ${got.org.name}: ${got.org.members.length} position${got.org.members.length === 1 ? "" : "s"} in ${got.org.groups.length} group${got.org.groups.length === 1 ? "" : "s"}.${got.added.length ? ` Added ${got.added.length} agent${got.added.length === 1 ? "" : "s"} of its own.` : ""}${got.kept.length ? ` You already had your own ${got.kept.join(", ")}, so yours ${got.kept.length === 1 ? "was" : "were"} kept.` : ""}`;
          renderOrg();
        }, col);
      });
      picker.click();
      return;
    }
    if (choice === "new") {
      const nm = h("input", { placeholder: "Name, e.g. your company", maxlength: 50, "aria-label": "Name" });
      const ms = h("input", { placeholder: "What it is for, in a sentence (optional)", maxlength: 300, "aria-label": "Mission" });
      const got = await libDialog("New organization", h("div", { class: "composeform" }, nm, ms, h("p", { class: "note small" }, "It starts with an empty chart: add positions and groups yourself, or copy an example under Settings.")), [["Create", () => ({ name: nm.value.trim(), mission: ms.value.trim() }), true]]);
      if (!got?.name) return;
      return attempt(async () => (await api("POST", "orgs", { name: got.name, mission: got.mission, structure: "custom" }), await loadOrgs(), (o.sel = null), (o.undo = []), (o.suggest = null), (o.suggestOpen = false), renderOrg()), col);
    }
  }
}

/** What the organization remembers: the whole organization's notes, each group's, and each agent's own. */
function orgMemoryPanel(org, groups) {
  const box = h("section", { class: "orgmem" }, h("p", { class: "note" }, "Loading…"));
  const draw = async () => {
    const entries = await api("GET", `orgs/${org.id}/memory`).catch(() => []);
    const byId = new Map((state.crew?.bots ?? []).map((b) => [b.id, b]));
    const shelf = (e) => (e.shelf === "org" ? "Whole organization" : e.shelf === "dept" ? `${e.key} group` : `${byId.get(e.key)?.name ?? e.key}${e.kind === "log" ? " · past work" : " · notes"}`);
    const text = h("textarea", { rows: 2, maxlength: 800, placeholder: "Something every agent should know. For example: our fiscal year starts in April." });
    const where = h("select", { "aria-label": "Who should know this" }, h("option", { value: "org:" }, "Whole organization"), groups.map((g) => h("option", { value: `dept:${g.name}` }, `${g.name} group`)));
    const grouped = new Map();
    for (const e of entries) grouped.set(shelf(e), [...(grouped.get(shelf(e)) ?? []), e]);
    fill(
      box,
      h("p", { class: "note" }, "What the organization remembers across every task. Each agent sees the organization's notes, its group's, and its own. Only what bears on the task in hand is sent to the model."),
      h("form", { class: "card form", onsubmit: (e) => (e.preventDefault(), attempt(async () => (await api("POST", `orgs/${org.id}/memory`, { text: text.value, shelf: where.value.startsWith("dept:") ? "dept" : "org", key: where.value.slice(where.value.indexOf(":") + 1) }), draw()), box)) }, text, h("div", { class: "row" }, where, h("button", { class: "primary" }, "Remember this"))),
      entries.length
        ? [...grouped.keys()].sort((a, b) => Number(b === "Whole organization") - Number(a === "Whole organization") || a.localeCompare(b)).map((name) => h("div", { class: "memgroup" }, h("h2", { class: "label" }, `${name} · ${grouped.get(name).length}`), grouped.get(name).slice().reverse().map((e) => h("div", { class: "card memrow" }, h("div", { class: "grow mtext" }, e.text), h("span", { class: "mono small muted" }, e.kind === "log" ? "Recorded automatically" : `Saved by ${e.by}`), h("button", { class: "plain danger small", onclick: () => confirm("Forget this?") && attempt(async () => (await api("DELETE", `orgs/${org.id}/memory/${e.id}`), draw()), box) }, "Forget")))))
        : h("div", { class: "card" }, h("b", {}, "Nothing remembered yet."), h("p", { class: "note" }, "Agents save decisions and facts as they work, and each finished task is recorded here.")),
    );
  };
  draw();
  return box;
}


// ---------- the library ----------
// Documents the person shares with their agents. Files are dropped here (or
// into the folder itself); the app reads them into the organization's
// database, and agents search them as they work. Each document says who may use it.
const sizeWords = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const LIB_ICONS = {
  folder: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
  ai: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
};
const libIcon = (name, cls = "") => {
  const node = h("span", { class: `libicon ${cls}`, "aria-hidden": "true" });
  node.innerHTML = LIB_ICONS[name];
  return node;
};
const libParent = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const libBase = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const VIDEO_TYPES = new Set(["mp4", "mov", "webm"]);
const AUDIO_TYPES = new Set(["mp3", "m4a", "wav", "ogg"]);
const KIND_COLORS = { pdf: "#ff6b6b", doc: "#5aa9ff", docx: "#5aa9ff", xls: "#3ddc84", xlsx: "#3ddc84", csv: "#3ddc84", ppt: "#ffb020", pptx: "#ffb020", md: "#b8b8b8", txt: "#b8b8b8" };

/** Says in a few words who may use something: every agent, some departments, or nobody (private). */
function accessLabel(item, bots) {
  const a = item.access;
  if (a.private) return "Private";
  if (a.everyone) return "All agents";
  const names = [...a.departments, ...a.agents.map((x) => bots.get(x)?.name ?? x)];
  return names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : "No agents";
}

/** A small modal: resolves with what the person chose, or null. */
function libDialog(title, body, buttons) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "needs libdialog" });
    const done = (value) => (dialog.close(), dialog.remove(), resolve(value));
    fill(dialog, h("h2", {}, title), body, h("div", { class: "row end" }, h("button", { class: "plain", onclick: () => done(null) }, "Cancel"), buttons.map(([label, value, primary]) => h("button", { class: primary ? "primary" : "", onclick: () => done(typeof value === "function" ? value() : value) }, label))));
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Asks who may use one or more files or folders. Resolves with a body for the server, or null. */
async function askAccess(lib, bots, targets) {
  const first = targets[0].item;
  const current = targets.length === 1 ? (first.accessSet ? (first.access.private ? "private" : first.access.everyone ? "everyone" : "some") : "inherit") : "everyone";
  const choice = (value, title, text) => h("label", { class: `accesschoice ${value}` }, h("input", { type: "radio", name: "libaccess", value, checked: value === current }), h("span", {}, h("b", {}, title), h("span", { class: "note small" }, text)));
  const depts = lib.departments.map((d) => [d, h("input", { type: "checkbox", checked: first.access.departments.includes(d) && !first.access.private })]);
  const agents = lib.agents.filter((a) => bots.has(a)).map((a) => [a, h("input", { type: "checkbox", checked: first.access.agents.includes(a) })]);
  const pick = h("div", { class: "accessgrid" }, h("div", {}, h("div", { class: "label" }, "Departments"), depts.map(([d, box]) => h("label", { class: "power" }, box, d))), h("div", {}, h("div", { class: "label" }, "Individual agents"), h("div", { class: "agentpick" }, agents.map(([a, box]) => h("label", { class: "power" }, box, bots.get(a).name)))));
  const body = h(
    "div",
    { class: "accesschoices" },
    h("p", { class: "note" }, targets.length === 1 ? `For “${first.name}”${targets[0].kind === "folder" ? " and everything inside it, unless something inside has its own setting" : ""}.` : `For the ${targets.length} items you selected.`),
    choice("everyone", "All agents can use it", "Every agent may search and read it."),
    choice("some", "Only some departments or agents", "Choose who below."),
    pick,
    choice("private", "Private: locked from AI", "No agent ever sees it, finds it or reads it. Only you, in this app."),
    targets.some((t) => t.item.path.includes("/") || t.kind === "file") ? choice("inherit", "Same as its folder", "Follows the folder it is in.") : null,
  );
  for (const [, box] of [...depts, ...agents]) box.addEventListener("change", () => (body.querySelector('input[value="some"]').checked = true));
  return libDialog("Who can use this?", body, [["Save", () => ({ mode: body.querySelector('input[name="libaccess"]:checked')?.value ?? "everyone", departments: depts.filter(([, b]) => b.checked).map(([d]) => d), agents: agents.filter(([, b]) => b.checked).map(([a]) => a) }), true]]);
}

/** Asks which folder to move things to. Resolves with its path ("" for the top of the library), or null. */
function askFolder(lib, moving) {
  const blocked = (p) => moving.some((m) => m.kind === "folder" && (p === m.path || p.startsWith(`${m.path}/`)));
  let chosen = null;
  const list = h("div", { class: "folderpick", role: "listbox", "aria-label": "Folders" });
  const rows = [{ path: "", name: "Library (top)" }, ...lib.folders].filter((f) => !blocked(f.path));
  const draw = () =>
    fill(list, rows.map((f) => h("button", { class: `folderopt ${chosen === f.path ? "on" : ""}`, role: "option", "aria-selected": String(chosen === f.path), style: `padding-left: ${12 + (f.path ? f.path.split("/").length : 0) * 16}px`, onclick: () => ((chosen = f.path), draw()) }, libIcon("folder"), f.path ? libBase(f.path) : f.name)));
  draw();
  return libDialog(`Move ${moving.length === 1 ? `“${libBase(moving[0].path)}”` : `${moving.length} items`} to…`, list, [["Move here", () => chosen, true]]);
}

/** Reads a dropped folder (and its sub-folders) into files with their paths. */
async function droppedFiles(dataTransfer) {
  const entries = [...(dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, rel: file.name }));
  const out = [];
  const visit = async (entry) => {
    if (entry.isFile) return new Promise((resolve) => entry.file((file) => (out.push({ file, rel: entry.fullPath.replace(/^\//, "") }), resolve()), () => resolve()));
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const e of batch) await visit(e);
    }
  };
  for (const e of entries) await visit(e);
  return out.filter((x) => !libBase(x.rel).startsWith("."));
}

async function libraryView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "library files" });
  fill(ui.body, h("main", { class: "center wide" }, col));
  const again = () => libraryView();
  let lib;
  try {
    [lib] = await Promise.all([api("GET", "library"), loadCrew()]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "library") return;
  const bots = new Map((state.crew?.bots ?? []).map((b) => [b.id, b]));
  const act = (fn, note) => attempt(async () => (await fn(), note && (ui.libraryNote = note), again()), col);
  ui.libPath ??= "";
  if (ui.libPath && !lib.folders.some((f) => f.path === ui.libPath)) ui.libPath = "";
  ui.libSel ??= new Set();
  const cur = ui.libPath;
  const docById = new Map(lib.documents.map((d) => [d.id, d]));
  const folderByPath = new Map(lib.folders.map((f) => [f.path, f]));
  const keyOf = (kind, p) => `${kind}:${p}`;
  const selected = () => [...ui.libSel].map((k) => ({ kind: k.slice(0, k.indexOf(":")), path: k.slice(k.indexOf(":") + 1) })).filter((t) => (t.kind === "folder" ? folderByPath.has(t.path) : lib.documents.some((d) => d.path === t.path)));
  const itemOf = (t) => (t.kind === "folder" ? folderByPath.get(t.path) : lib.documents.find((d) => d.path === t.path));

  // ----- uploading: buttons, or dropping files and folders from the computer anywhere on the list -----
  const status = h("span", { class: "note small" });
  const upload = async (list, into = cur) => {
    list = list.filter((x) => x.file.size > 0);
    if (!list.length) return;
    const failed = [];
    let n = 0;
    for (const { file, rel } of list) {
      status.textContent = `Uploading ${++n} of ${list.length}: ${rel}…`;
      const res = await fetch(`/api/library/upload?name=${encodeURIComponent(rel)}&folder=${encodeURIComponent(into)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }).catch(() => null);
      if (!res?.ok) failed.push(`${rel}: ${(await res?.json().catch(() => ({})))?.error ?? "could not be added"}`);
    }
    ui.libraryNote = failed.length ? `Not added: ${failed.join(" · ")}` : `Uploaded ${list.length} file${list.length === 1 ? "" : "s"}.`;
    again();
  };
  const filePick = h("input", { type: "file", multiple: true, hidden: true });
  filePick.addEventListener("change", () => upload([...filePick.files].map((file) => ({ file, rel: file.name }))));
  const folderPick = h("input", { type: "file", multiple: true, hidden: true, webkitdirectory: "" });
  folderPick.addEventListener("change", () => upload([...folderPick.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name }))));

  // ----- moving by drag and drop: a row onto a folder, or onto a folder in the path at the top -----
  const dropTarget = (node, folderPath) => {
    node.addEventListener("dragover", (e) => {
      if (!ui.libDrag && !e.dataTransfer.types.includes("Files")) return;
      if (ui.libDrag?.some((t) => t.kind === "folder" && (folderPath === t.path || folderPath.startsWith(`${t.path}/`)))) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.add("dropover");
    });
    node.addEventListener("dragleave", () => node.classList.remove("dropover"));
    node.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove("dropover");
      if (ui.libDrag) {
        const moving = ui.libDrag;
        ui.libDrag = null;
        if (moving.every((t) => libParent(t.path) === folderPath)) return;
        ui.libSel.clear();
        return act(() => api("POST", "library/move", { items: moving, to: folderPath }), `Moved ${moving.length === 1 ? `“${libBase(moving[0].path)}”` : `${moving.length} items`} to ${folderPath ? libBase(folderPath) : "the top of the library"}.`);
      }
      upload(await droppedFiles(e.dataTransfer), folderPath);
    });
    return node;
  };
  const draggable = (node, target) => {
    node.draggable = true;
    node.addEventListener("dragstart", (e) => {
      const key = keyOf(target.kind, target.path);
      ui.libDrag = ui.libSel.has(key) ? selected() : [target];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", target.path);
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => ((ui.libDrag = null), node.classList.remove("dragging")));
    return node;
  };

  // ----- the actions -----
  const rename = (t) => ((ui.libRename = keyOf(t.kind, t.path)), again());
  const moveTo = async (targets) => {
    const to = await askFolder(lib, targets);
    if (to === null) return;
    ui.libSel.clear();
    act(() => api("POST", "library/move", { items: targets, to }), `Moved to ${to ? libBase(to) : "the top of the library"}.`);
  };
  const remove = (targets) => {
    const words = targets.length === 1 ? `“${libBase(targets[0].path)}”${targets[0].kind === "folder" ? " and everything in it" : ""}` : `these ${targets.length} items`;
    if (!confirm(`Delete ${words}?\n\nThey go to Deleted, where you can put them back for 30 days. Agents can no longer use them.`)) return;
    ui.libSel.clear();
    if (targets.some((t) => t.kind === "file" && docById.get(ui.libPreview)?.path === t.path)) ui.libPreview = null;
    act(() => api("POST", "library/delete", { items: targets }), `Deleted ${words}. Find it under Deleted to put it back.`);
  };
  const setAccess = async (targets) => {
    const withItems = targets.map((t) => ({ ...t, item: itemOf(t) })).filter((t) => t.item);
    const chosen = await askAccess(lib, bots, withItems);
    if (!chosen) return;
    act(async () => {
      for (const t of withItems) {
        if (t.kind === "folder") await api("PATCH", "library/folder", { path: t.path, ...chosen });
        else await api("PATCH", `library/${t.item.id}`, chosen);
      }
    }, chosen.mode === "private" ? "Locked as private: no agent can see it." : "Saved who can use it.");
  };

  // ----- the path at the top: Library › Finance › Contracts, each a place to drop things -----
  const crumbs = [["", "Library"], ...cur.split("/").filter(Boolean).map((_, i, all) => [all.slice(0, i + 1).join("/"), all[i]])];
  const breadcrumb = h(
    "nav",
    { class: "crumbs", "aria-label": "Folder path" },
    crumbs.map(([p, name], i) => [i ? h("span", { class: "sep", "aria-hidden": "true" }, "›") : null, dropTarget(h("button", { class: `crumb ${i === crumbs.length - 1 ? "here" : ""}`, onclick: () => ((ui.libPath = p), ui.libSel.clear(), (ui.libView = "files"), again()), "aria-current": i === crumbs.length - 1 ? "page" : null }, name), p)]),
  );

  // ----- what is shown: this folder, or everything that matches a search by name -----
  const find = (ui.libFind ?? "").trim().toLowerCase();
  const sortBy = ui.libSort ?? "name";
  const order = (a, b) => (sortBy === "size" ? (b.size ?? 0) - (a.size ?? 0) : sortBy === "modified" ? (b.modified ?? 0) - (a.modified ?? 0) : a.name.localeCompare(b.name, undefined, { numeric: true }));
  const folders = (find ? lib.folders.filter((f) => f.name.toLowerCase().includes(find)) : lib.folders.filter((f) => libParent(f.path) === cur)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const files = (find ? lib.documents.filter((d) => d.name.toLowerCase().includes(find)) : lib.documents.filter((d) => libParent(d.path) === cur)).sort(order);

  const accessChip = (item, target) =>
    h(
      "button",
      { class: `accesschip ${item.access.private ? "private" : item.access.everyone ? "all" : "some"}`, title: `${item.access.private ? "Locked from AI" : "Who can use this"}${item.accessSet ? "" : item.accessFrom !== null && item.accessFrom !== undefined ? ` · follows the folder “${item.accessFrom ? libBase(item.accessFrom) : "Library"}”` : ""}. Click to change.`, onclick: (e) => (e.stopPropagation(), setAccess([target])) },
      libIcon(item.access.private ? "lock" : "ai"),
      accessLabel(item, bots),
    );
  const checkbox = (target) => {
    const key = keyOf(target.kind, target.path);
    return h("input", { type: "checkbox", class: "pick", "aria-label": `Select ${libBase(target.path)}`, checked: ui.libSel.has(key), onclick: (e) => e.stopPropagation(), onchange: (e) => (e.target.checked ? ui.libSel.add(key) : ui.libSel.delete(key), again()) });
  };
  const nameCell = (target, label, sub) => {
    if (ui.libRename === keyOf(target.kind, target.path)) {
      const input = h("input", { class: "renamebox", value: label, "aria-label": "New name" });
      const save = () => {
        ui.libRename = null;
        const name = input.value.trim();
        if (!name || name === label) return again();
        act(() => api("POST", "library/move", { items: [target], to: libParent(target.path), name }), `Renamed to “${name}”.`);
      };
      input.addEventListener("keydown", (e) => (e.key === "Enter" ? save() : e.key === "Escape" ? ((ui.libRename = null), again()) : null));
      input.addEventListener("blur", save);
      setTimeout(() => (input.focus(), input.setSelectionRange(0, label.lastIndexOf(".") > 0 && target.kind === "file" ? label.lastIndexOf(".") : label.length)), 0);
      return h("span", { class: "fname" }, input);
    }
    return h("span", { class: "fname" }, h("b", {}, label), sub ? h("span", { class: "fsub" }, sub) : null);
  };
  const menu = (target, extra = []) =>
    h(
      "span",
      { class: "rowacts" },
      [...extra, ["Rename", () => rename(target)], ["Move", () => moveTo([target])], ["Delete", () => remove([target])]].map(([label, fn]) => h("button", { class: `plain small ${label === "Delete" ? "danger" : ""}`, onclick: (e) => (e.stopPropagation(), fn()) }, label)),
    );
  const thumb = (d) => {
    if (IMAGE_TYPES.has(d.type)) return h("img", { class: "fthumb", src: `/api/library/${d.id}/raw`, alt: "", loading: "lazy" });
    return h("span", { class: "fkind", style: `--kind: ${KIND_COLORS[d.type] ?? "#8c8c8c"}` }, (d.type || "file").slice(0, 4).toUpperCase());
  };
  const folderRow = (f) => {
    const target = { kind: "folder", path: f.path };
    const row = h(
      "div",
      { class: `frow folder ${ui.libSel.has(keyOf("folder", f.path)) ? "sel" : ""}`, role: "row", tabindex: "0", onclick: () => ((ui.libPath = f.path), (ui.libFind = ""), ui.libSel.clear(), again()), onkeydown: (e) => e.key === "Enter" && e.target === row && ((ui.libPath = f.path), again()) },
      checkbox(target),
      libIcon("folder", "ficon"),
      nameCell(target, f.name, `${f.files} file${f.files === 1 ? "" : "s"}${f.folders ? `, ${f.folders} folder${f.folders === 1 ? "" : "s"}` : ""}${find && libParent(f.path) ? ` · in ${libParent(f.path)}` : ""}`),
      accessChip(f, target),
      h("span", { class: "fsize" }, "—"),
      h("span", { class: "fdate" }, ""),
      menu(target),
    );
    return dropTarget(draggable(row, target), f.path);
  };
  const fileRow = (d) => {
    const target = { kind: "file", path: d.path };
    const row = h(
      "div",
      { class: `frow ${ui.libPreview === d.id ? "open" : ""} ${ui.libSel.has(keyOf("file", d.path)) ? "sel" : ""}`, role: "row", tabindex: "0", onclick: () => ((ui.libPreview = ui.libPreview === d.id ? null : d.id), again()), onkeydown: (e) => e.key === "Enter" && e.target === row && ((ui.libPreview = d.id), again()) },
      checkbox(target),
      thumb(d),
      nameCell(target, d.name, find && libParent(d.path) ? `in ${libParent(d.path)}` : d.readable ? null : d.problem ? "Kept, found by name only" : null),
      accessChip(d, target),
      h("span", { class: "fsize" }, sizeWords(d.size)),
      h("span", { class: "fdate" }, d.modified ? shortWhen(new Date(d.modified).toISOString()) : ""),
      menu(target, [["Open", () => attempt(() => api("POST", "library/launch", { id: d.id }), col)]]),
    );
    return draggable(row, target);
  };

  // ----- the preview of one file -----
  const previewOf = (d) => {
    const raw = `/api/library/${d.id}/raw`;
    const text = h("pre", { class: "ptext" }, "Loading…");
    const viewer = IMAGE_TYPES.has(d.type)
      ? h("img", { class: "pimage", src: raw, alt: d.name })
      : VIDEO_TYPES.has(d.type)
        ? h("video", { class: "pmedia", src: raw, controls: true })
        : AUDIO_TYPES.has(d.type)
          ? h("audio", { class: "pmedia", src: raw, controls: true })
          : d.type === "pdf"
            ? h("iframe", { class: "ppdf", src: raw, title: d.name })
            : d.readable
              ? text
              : h("div", { class: "pnone" }, h("b", {}, "No preview for this kind of file."), h("span", { class: "note small" }, "Open it on this computer to see it."));
    if (d.readable && viewer === text) api("GET", `library/${d.id}/text`).then((r) => (text.textContent = r.text + (r.to < r.parts ? "\n\n…" : ""))).catch((err) => (text.textContent = err.message));
    const target = { kind: "file", path: d.path };
    const fact = (label, value) => h("div", { class: "pfact" }, h("span", {}, label), h("b", {}, value));
    return h(
      "aside",
      { class: "preview", "aria-label": `Preview of ${d.name}` },
      h("div", { class: "phead" }, h("b", { class: "grow" }, d.name), h("button", { class: "plain small", "aria-label": "Close preview", onclick: () => ((ui.libPreview = null), again()) }, "✕")),
      h("div", { class: "pview" }, viewer),
      h("div", { class: "row wrap" }, h("button", { class: "primary small", onclick: () => attempt(() => api("POST", "library/launch", { id: d.id }), col) }, "Open"), h("button", { class: "small", onclick: () => attempt(() => api("POST", "library/open", { id: d.id }), col) }, "Show in Finder"), h("a", { class: "button small", href: raw, download: d.name }, "Download")),
      h(
        "div",
        { class: "pai" },
        h("div", { class: "label" }, "AI access"),
        h(
          "div",
          { class: "segmented", role: "group", "aria-label": "Who can use this file" },
          [["everyone", "All agents"], ["some", "Some"], ["private", "Private"]].map(([mode, label]) => {
            const on = mode === (d.access.private ? "private" : d.access.everyone ? "everyone" : "some");
            return h("button", { class: on ? "on" : "", "aria-pressed": String(on), onclick: () => (mode === "some" ? setAccess([target]) : act(() => api("PATCH", `library/${d.id}`, { mode }), mode === "private" ? "Locked as private: no agent can see it." : "Every agent can use it now.")) }, mode === "private" ? [libIcon("lock"), label] : label);
          }),
        ),
        h("p", { class: "note small" }, d.access.private ? "Locked. No agent can find, list or read this file." : `${accessLabel(d, bots)} can search and read it.${d.accessSet ? "" : d.accessFrom ? ` Follows the folder “${libBase(d.accessFrom)}”.` : " Follows its folder."}`),
        d.accessSet && d.path.includes("/") ? h("button", { class: "plain small", onclick: () => act(() => api("PATCH", `library/${d.id}`, { mode: "inherit" }), "It follows its folder again.") }, "Use its folder's setting") : null,
      ),
      h("div", { class: "pfacts" }, fact("Where", d.path.includes("/") ? libParent(d.path) : "Library"), fact("Size", sizeWords(d.size)), fact("Changed", d.modified ? new Date(d.modified).toLocaleString() : "—"), fact("Read for agents", d.readable ? `${d.passages} part${d.passages === 1 ? "" : "s"}` : "Name only"), d.problem ? h("p", { class: "note small" }, d.problem) : null),
      h("div", { class: "row wrap" }, h("button", { class: "plain small", onclick: () => rename(target) }, "Rename"), h("button", { class: "plain small", onclick: () => moveTo([target]) }, "Move"), h("button", { class: "plain small danger", onclick: () => remove([target]) }, "Delete")),
    );
  };

  // ----- Deleted: put things back, or remove them for good -----
  if (ui.libView === "deleted") {
    fill(
      col,
      h("div", { class: "row" }, h("button", { class: "plain back", onclick: () => ((ui.libView = "files"), again()) }, "← Back to the library"), h("span", { class: "grow" }), lib.deleted.length ? h("button", { class: "danger", onclick: () => confirm(`Delete all ${lib.deleted.length} items for good?\n\nThis cannot be undone.`) && act(() => api("POST", "library/purge", { all: true }), "Deleted emptied.") }, "Empty Deleted") : null),
      h("div", {}, h("h1", {}, "Deleted"), h("p", { class: "lead" }, "Files and folders you deleted stay here for 30 days, then go for good. Agents cannot use anything in here.")),
      ui.libraryNote ? h("div", { class: "banner" }, ui.libraryNote) : null,
      lib.deleted.length
        ? h("div", { class: "flist" }, lib.deleted.map((t) => h("div", { class: "frow" }, h("span", {}), t.kind === "folder" ? libIcon("folder", "ficon") : h("span", { class: "fkind" }, (t.name.split(".").pop() || "file").slice(0, 4).toUpperCase()), h("span", { class: "fname" }, h("b", {}, t.name), h("span", { class: "fsub" }, `Was in ${libParent(t.from) || "Library"} · deleted ${shortWhen(t.at)}`)), h("span", {}), h("span", { class: "fsize" }, sizeWords(t.size)), h("span", {}), h("span", { class: "rowacts show" }, h("button", { class: "small", onclick: () => act(() => api("POST", "library/restore", { id: t.id }), `Put “${t.name}” back.`) }, "Restore"), h("button", { class: "plain small danger", onclick: () => confirm(`Delete “${t.name}” for good?\n\nThis cannot be undone.`) && act(() => api("POST", "library/purge", { id: t.id }), `Deleted “${t.name}” for good.`) }, "Delete forever")))))
        : h("div", { class: "card quiet" }, h("b", {}, "Nothing deleted."), h("span", { class: "note" }, " Anything you delete from the library waits here for 30 days.")),
    );
    ui.libraryNote = null;
    return;
  }

  // ----- the page -----
  const findBox = h("input", { type: "search", class: "findbox", placeholder: "Find a file or folder by name", value: ui.libFind ?? "", "aria-label": "Find by name" });
  findBox.addEventListener("input", () => {
    ui.libFind = findBox.value;
    clearTimeout(ui.libFindTimer);
    ui.libFindTimer = setTimeout(() => (again(), setTimeout(() => document.querySelector(".findbox")?.focus(), 0)), 250);
  });
  const sortPick = h("select", { "aria-label": "Sort by", onchange: (e) => ((ui.libSort = e.target.value), again()) }, [["name", "Name"], ["modified", "Last changed"], ["size", "Size"]].map(([v, t]) => h("option", { value: v, selected: v === sortBy }, `Sort: ${t}`)));
  const newFolder = () => {
    const input = h("input", { class: "renamebox", placeholder: "Folder name", "aria-label": "New folder name" });
    const save = () => {
      const name = input.value.trim();
      ui.libNewFolder = false;
      if (!name) return again();
      act(() => api("POST", "library/folders", { parent: cur, name }), `Made the folder “${name}”.`);
    };
    input.addEventListener("keydown", (e) => (e.key === "Enter" ? save() : e.key === "Escape" ? ((ui.libNewFolder = false), again()) : null));
    input.addEventListener("blur", save);
    setTimeout(() => input.focus(), 0);
    return h("div", { class: "frow folder newfolder" }, h("span", {}), libIcon("folder", "ficon"), h("span", { class: "fname" }, input), h("span", {}), h("span", {}), h("span", {}), h("span", {}));
  };
  const sel = selected();
  const here = folderByPath.get(cur);
  const allKeys = [...folders.map((f) => keyOf("folder", f.path)), ...files.map((d) => keyOf("file", d.path))];
  const allOn = allKeys.length > 0 && allKeys.every((k) => ui.libSel.has(k));
  const list = h(
    "div",
    { class: "flist", role: "table", "aria-label": "Files" },
    h("div", { class: "frow fheadrow", role: "row" }, h("input", { type: "checkbox", class: "pick", "aria-label": "Select all", checked: allOn, onchange: () => (allOn ? allKeys.forEach((k) => ui.libSel.delete(k)) : allKeys.forEach((k) => ui.libSel.add(k)), again()) }), h("span", {}), h("span", {}, "Name"), h("span", {}, "AI access"), h("span", { class: "fsize" }, "Size"), h("span", { class: "fdate" }, "Changed"), h("span", {})),
    cur && !find ? dropTarget(h("div", { class: "frow uprow", role: "row", tabindex: "0", onclick: () => ((ui.libPath = libParent(cur)), again()) }, h("span", {}), libIcon("up", "ficon"), h("span", { class: "fname" }, h("b", {}, "Up a folder")), h("span", {}), h("span", {}), h("span", {}), h("span", {})), libParent(cur)) : null,
    ui.libNewFolder ? newFolder() : null,
    folders.map(folderRow),
    files.map(fileRow),
    !folders.length && !files.length && !ui.libNewFolder ? h("div", { class: "fempty" }, h("b", {}, find ? "Nothing matches that name." : "This folder is empty."), find ? null : h("span", { class: "note" }, "Drop files or folders here from your computer, or press Upload.")) : null,
  );
  // Dropping files from the computer anywhere on the list puts them in the folder being shown.
  const listArea = dropTarget(h("div", { class: "flistwrap" }, list), cur);
  const preview = ui.libPreview && docById.get(ui.libPreview);

  // ----- trying a search, as the person or as one agent -----
  const query = h("input", { type: "search", placeholder: "Try a question, e.g. what is our refund policy?", value: ui.libraryQuery ?? "", "aria-label": "Search inside documents" });
  const as = h("select", { "aria-label": "Search as" }, h("option", { value: "" }, "As you (everything, private too)"), lib.agents.filter((a) => bots.has(a)).map((a) => h("option", { value: a, selected: a === ui.libraryAs }, `As the ${bots.get(a).name}`)));
  const results = h("div", { class: "hits" });
  const search = async () => {
    ui.libraryQuery = query.value;
    ui.libraryAs = as.value;
    if (!query.value.trim()) return fill(results);
    try {
      const { hits } = await api("POST", "library/search", { query: query.value, as: as.value });
      fill(results, hits.length ? hits.map((x) => h("div", { class: "hit" }, h("div", { class: "label" }, `${x.path} · part ${x.part}`), h("p", {}, x.text.slice(0, 420)))) : h("p", { class: "note" }, as.value ? "Nothing this agent may use matches that." : "Nothing in the library matches that."));
    } catch (err) {
      fill(results, h("div", { class: "banner error" }, err.message));
    }
  };

  fill(
    col,
    h("div", { class: "row" }, h("div", { class: "grow" }, h("h1", {}, "Library"), h("p", { class: "lead" }, `${lib.organization}'s files, kept on this computer. Organize them in folders, and choose for each file or folder whether your agents may use it or it stays private.`))),
    h(
      "div",
      { class: "ftoolbar" },
      breadcrumb,
      h("span", { class: "grow" }),
      findBox,
      sortPick,
      h("button", { onclick: () => ((ui.libNewFolder = true), again()) }, "New folder"),
      h("button", { class: "primary", onclick: () => filePick.click() }, "Upload files"),
      h("button", { onclick: () => folderPick.click(), title: "Upload a whole folder, with the folders inside it" }, "Upload a folder"),
      filePick,
      folderPick,
    ),
    h(
      "div",
      { class: "fstatus" },
      cur && here ? [h("span", { class: "note small" }, "This folder:"), accessChip(here, { kind: "folder", path: cur })] : h("span", { class: "note small" }, `${lib.stats.documents} file${lib.stats.documents === 1 ? "" : "s"}${lib.stats.private ? ` · ${lib.stats.private} private` : ""}`),
      status,
      h("span", { class: "grow" }),
      h("button", { class: "plain small", onclick: () => attempt(() => api("POST", "library/open", { path: cur }), col) }, "Show in Finder"),
      h("button", { class: "plain small", onclick: () => ((ui.libView = "deleted"), again()) }, `Deleted${lib.deleted.length ? ` · ${lib.deleted.length}` : ""}`),
    ),
    ui.libraryNote ? h("div", { class: "banner" }, ui.libraryNote) : null,
    sel.length
      ? h("div", { class: "selbar" }, h("b", {}, `${sel.length} selected`), h("button", { class: "small", onclick: () => moveTo(sel) }, "Move"), h("button", { class: "small", onclick: () => setAccess(sel) }, "AI access"), h("button", { class: "small danger", onclick: () => remove(sel) }, "Delete"), h("button", { class: "plain small", onclick: () => (ui.libSel.clear(), again()) }, "Clear"))
      : null,
    h("div", { class: `fmain ${preview ? "withpreview" : ""}` }, listArea, preview ? previewOf(preview) : null),
    h("p", { class: "note small" }, "Drag files onto a folder, or onto a folder in the path above, to move them. Drop files or folders from your computer to upload."),
    h("details", { class: "card trysearch" }, h("summary", {}, h("b", {}, "Check what your agents will find")), h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), search()) }, query, as, h("button", {}, "Search")), results),
    h("p", { class: "note small" }, `Kept on this computer in ${lib.folder}. Private files are never sent to any AI model. For the rest, only the passages that match what an agent is working on are sent.`),
  );
  ui.libraryNote = null;
  if (ui.libraryQuery) search();
}

// ---------- the audit log: every operation, by you and by each agent ----------
const AUDIT_KINDS = [["", "Everything"], ["task", "Tasks"], ["tool", "Agent actions"], ["approval", "Approvals"], ["spend", "Spending"], ["problem", "Problems"], ["library", "Library"], ["settings", "Settings"], ["integration", "Integrations"], ["organization", "Organization"], ["workspace", "Workspace"], ["chat", "Chats"], ["inbox", "Inbox"]];
const AUDIT_SINCE = [["", "All time"], ["1", "Last 24 hours"], ["7", "Last 7 days"], ["30", "Last 30 days"]];

async function auditView() {
  ui.body.className = "body";
  ui.log = null;
  ui.audit ??= { kind: "", actor: "", since: "7", q: "" };
  const f = ui.audit;
  const col = h("div", { class: "auditpage" });
  fill(ui.body, h("main", { class: "center" }, col));
  await loadCrew().catch(() => {});
  const bots = state.crew?.bots ?? [];
  const since = f.since ? new Date(Date.now() - Number(f.since) * 24 * 3600 * 1000).toISOString() : "";
  let data;
  try {
    data = await api("GET", `audit?limit=1000&kind=${encodeURIComponent(f.kind)}&actor=${encodeURIComponent(f.actor)}&q=${encodeURIComponent(f.q)}&since=${encodeURIComponent(since)}`);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "audit") return;
  const again = () => auditView();
  const pick = (key, options, label) => h("select", { "aria-label": label, onchange: (e) => ((f[key] = e.target.value), again()) }, options.map(([v, t]) => h("option", { value: v, selected: v === f[key] }, t)));
  const who = pick("actor", [["", "Everyone"], ["owner", "You"], ["agents", "All agents"], ...bots.map((b) => [b.id, b.title || b.name])], "Who");
  const find = h("input", { type: "search", placeholder: "Search: a command, a file, a task…", value: f.q, "aria-label": "Search the audit log" });
  find.addEventListener("keydown", (e) => e.key === "Enter" && ((f.q = find.value.trim()), again()));
  const spent = data.entries.reduce((n, e) => n + (e.kind === "spend" && e.cost ? e.cost : 0), 0);
  const problems = data.entries.filter((e) => e.ok === false || e.kind === "problem").length;
  const byAgent = data.entries.filter((e) => e.actor !== "owner" && e.actor !== "system").length;

  const csv = async () => {
    // The export takes up to 5,000 operations matching the filters, more than the page shows.
    const all = await api("GET", `audit?limit=5000&kind=${encodeURIComponent(f.kind)}&actor=${encodeURIComponent(f.actor)}&q=${encodeURIComponent(f.q)}&since=${encodeURIComponent(since)}`).catch(() => data);
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Time", "Who", "Kind", "What", "Detail", "Task", "Cost", "Worked"], ...all.entries.map((e) => [e.at, e.actorName, e.kind, e.action, e.detail ?? "", e.task ?? "", e.cost ?? "", e.ok === false ? "no" : "yes"])];
    const a = h("a", { href: URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" })), download: `talqava-audit-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const botOf = (id) => bots.find((b) => b.id === id);
  const row = (e) => {
    const bot = botOf(e.actor);
    const open = h("details", { class: `auditrow ${e.ok === false || e.kind === "problem" ? "bad" : ""}` });
    fill(
      open,
      h(
        "summary",
        {},
        h("span", { class: "atime" }, new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })),
        h("span", { class: "awho", style: bot ? botStyle(bot) : "" }, bot ? keycap(bot, 20, "", bot.type) : h("span", { class: "sysavatar small", "aria-hidden": "true" }, e.actor === "owner" ? "Y" : "T"), h("span", {}, e.actorName)),
        h("span", { class: `akind ${e.kind}` }, (AUDIT_KINDS.find(([k]) => k === e.kind) ?? [e.kind, e.kind])[1]),
        h("span", { class: "awhat" }, h("b", {}, e.action), e.detail ? h("span", { class: "adetail" }, ` — ${e.detail}`) : null),
        h("span", { class: "acost" }, e.cost ? money(e.cost) : e.ok === false ? "✕" : ""),
      ),
      h(
        "div",
        { class: "auditmore" },
        e.detail ? h("pre", {}, e.detail) : null,
        h("div", { class: "row wrap" }, h("span", { class: "note small" }, `${new Date(e.at).toLocaleString()} · ${e.ok === false ? "did not work" : "worked"}${e.cost ? ` · cost ${money(e.cost)}` : ""}`), e.task && (state.quests ?? []).some((q) => q.id === e.task) ? h("button", { class: "plain small", onclick: () => go("quest", e.task) }, "Open the task") : e.task ? h("button", { class: "plain small", onclick: () => go("chat", e.task) }, "Open the chat") : null),
      ),
    );
    return open;
  };

  fill(
    col,
    h("div", { class: "row" }, h("div", { class: "grow" }, h("h1", {}, "Audit log"), h("p", { class: "lead" }, "Every operation, by you and by each agent: what was done, to what, whether it worked, and what it cost. Kept on this computer; keys and passwords are never written down.")), h("button", { onclick: csv, disabled: !data.entries.length }, "Export CSV")),
    h("div", { class: "auditfilters" }, find, who, pick("kind", AUDIT_KINDS, "Kind"), pick("since", AUDIT_SINCE, "When")),
    h("div", { class: "auditstats" }, [[String(data.total), `operation${data.total === 1 ? "" : "s"}`], [String(byAgent), "by agents"], [String(problems), "did not work"], [money(spent), "spent"]].map(([n, t]) => h("div", {}, h("b", {}, n), h("span", {}, t)))),
    data.entries.length ? h("div", { class: "auditlist" }, data.entries.map(row)) : h("div", { class: "card quiet" }, h("b", {}, "Nothing recorded for these filters."), h("span", { class: "note" }, " Everything you and your agents do from now on is recorded here.")),
    data.total > data.entries.length ? h("p", { class: "note small" }, `Showing the newest ${data.entries.length} of ${data.total}. Narrow the filters to see the rest; Export CSV includes up to 5,000.`) : null,
  );
}

// ---------- integrations ----------
// The outside tools agents work with, filed by category. Git is the first:
// repositories agents may work on, each task in a branch and copy of its own.
const INTEGRATION_MARKS = {
  git: `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"><path d="M17 14v20M17 24c8 0 14-1 14-8"/></g><g fill="var(--bg)" stroke="var(--accent)" stroke-width="2.2"><circle cx="17" cy="14" r="3.4"/><circle cx="17" cy="34" r="3.4"/><circle cx="31" cy="15" r="3.4"/></g></svg>`,
};
INTEGRATION_MARKS.mcp = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 24h8M26 24h8"/><rect x="20" y="18" width="8" height="12" rx="2.5" fill="var(--bg)"/><circle cx="12" cy="24" r="3" fill="var(--bg)"/><circle cx="36" cy="24" r="3" fill="var(--bg)"/><path d="M24 12v6M24 30v6"/></g></svg>`;
INTEGRATION_MARKS.openrouter = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.45"/><g fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 24h7c3 0 4-1.5 5.5-4.5S28 14 31 14h5"/><path d="M12 24h7c3 0 4 1.5 5.5 4.5S28 34 31 34h5"/><path d="M19 24h17"/><path d="M33 11l3 3-3 3M33 21l3 3-3 3M33 31l3 3-3 3"/></g><circle cx="12" cy="24" r="2.6" fill="var(--accent)"/></svg>`;
INTEGRATION_MARKS["ai-models"] = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="15" y="15" width="18" height="18" rx="3"/><path d="M20 15v-4M28 15v-4M20 37v-4M28 37v-4M15 20h-4M15 28h-4M37 20h-4M37 28h-4"/><path d="M21 24h6"/></g></svg>`;
INTEGRATION_MARKS["api-keys"] = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="24" r="6"/><path d="M24 24h13M32 24v5M36 24v4"/></g></svg>`;
const integrationMark = (id) => {
  const node = h("span", { class: "imark" });
  node.innerHTML = INTEGRATION_MARKS[id] ?? "";
  return node;
};
const STATE_WORDS = { connected: ["Connected", "on"], "needs-setup": ["Not set up", ""], unavailable: ["Unavailable", "bad"] };

/** What the pages under Integrations share: the settings they change, saved and then shown again. */
const connectionSaver = (col, again) => (patch) =>
  attempt(async () => {
    state.config = await api("PUT", "settings", patch);
    again();
  }, col);

/** Integrations › AI models: every AI service, backups, and a service set up by hand. */
function aiModelsPage(col, again) {
  const c = state.config;
  const save = connectionSaver(col, again);
  fill(
    col,
    h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations"),
    h("div", { class: "ihero" }, integrationMark("ai-models"), h("div", { class: "grow" }, h("h1", {}, "AI models"), h("p", { class: "lead" }, "The AI services your agents think with. Pick one, paste its key, and Talqava checks it and finds its models. Connect as many as you like: your team uses one, any agent can use another, and backups take over when a service is down."))),
  );
  aiModelsSection(col);
  const pId = h("input", { placeholder: "Short id, e.g. lmstudio" });
  const pName = h("input", { placeholder: "Name, e.g. LM Studio" });
  const pUrl = h("input", { placeholder: "Address ending in /v1, e.g. http://localhost:1234/v1" });
  const pKey = h("input", { type: "password", placeholder: "API key (blank for local runners)", autocomplete: "off" });
  const pIn = h("input", { type: "number", min: 0, step: 0.01, placeholder: "$ per million input tokens (0 if free)" });
  const pOut = h("input", { type: "number", min: 0, step: 0.01, placeholder: "$ per million output tokens (0 if free)" });
  const pContext = h("input", { type: "number", min: 2000, step: 1000, placeholder: "Context size in tokens (default 32000)" });
  const others = c.providers.filter((p) => p.kind !== "anthropic");
  const advanced = h("details", { class: "aiadvanced" }, h("summary", {}, "Advanced: set up a service by hand, with its prices and size"));
  col.append(advanced);
  advanced.append(
    h("p", { class: "note" }, "For a service that is not in the list, or to set a service's prices and how much it holds yourself. Anything that offers the common chat completions format works. Prices are optional; without them only the step budget applies."),
    ...others.map((p) =>
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "row" },
          h("div", { class: "grow" }, h("strong", {}, p.name), ` (${p.id}) ${p.baseUrl}`, h("div", { class: "note" }, `${p.hasKey ? "Key saved" : "No key"} · ${p.prices ? `$${p.prices.input} in / $${p.prices.output} out per million tokens` : "prices unknown"} · context ${(p.contextTokens ?? 32000).toLocaleString()} tokens`)),
          h("button", { class: "plain danger", onclick: () => save({ provider: { id: p.id, remove: true } }) }, "Remove"),
        ),
      ),
    ),
    h(
      "form",
      { class: "form", onsubmit: (e) => (e.preventDefault(), save({ provider: { id: pId.value.trim(), name: pName.value.trim(), baseUrl: pUrl.value.trim(), apiKey: pKey.value, prices: { input: pIn.value, output: pOut.value }, contextTokens: pContext.value } })) },
      pId,
      pName,
      pUrl,
      pKey,
      h("div", { class: "row" }, pIn, pOut),
      pContext,
      h("p", { class: "note small" }, "Set the context size to what the model really holds. Long tasks are shortened to fit it, so a small local model keeps the task in view instead of losing track."),
      h("div", {}, h("button", {}, "Add provider")),
    ),
  );

}

/** Integrations › API keys: keys for any other service agents call, each sent only to its own address. */
function apiKeysPage(col, again) {
  const c = state.config;
  const save = connectionSaver(col, again);
  fill(
    col,
    h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations"),
    h("div", { class: "ihero" }, integrationMark("api-keys"), h("div", { class: "grow" }, h("h1", {}, "API keys for other services"), h("p", { class: "lead" }, "For a service with no integration of its own, such as a weather, shipping or accounting service. Agents use a key by its name and never see it."))),
  );
  const sName = h("input", { placeholder: "NAME, e.g. WEATHER_KEY" });
  const sValue = h("input", { type: "password", placeholder: "The key or token", autocomplete: "off" });
  const sHost = h("input", { placeholder: "Host it may be sent to, e.g. api.example.com" });
  col.append(
    h("h3", {}, "API keys for other services"),
    h("p", { class: "note" }, "The agent uses these by name in API calls and never sees the values. Each key is only ever sent to its own host."),
    ...c.secrets.map((s) => h("div", { class: "card" }, h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", {}, s.name), ` → ${s.host}`), h("button", { class: "plain danger", onclick: () => save({ secret: { name: s.name, remove: true } }) }, "Remove")))),
    h("form", { class: "form", onsubmit: (e) => (e.preventDefault(), save({ secret: { name: sName.value.trim(), value: sValue.value, host: sHost.value.trim() } })) }, sName, sValue, sHost, h("div", {}, h("button", {}, "Add key"))),
  );

}

/** Under Integrations › MCP: connectors added by hand, including ones that run as a program on this computer. */
function connectorsByHand(col, again) {
  const c = state.config;
  const save = connectionSaver(col, again);
  const mName = h("input", { placeholder: "Name, e.g. notion" });
  const mUrl = h("input", { placeholder: "https://… (the connector's MCP address)" });
  const mToken = h("input", { type: "password", placeholder: "Access token (if it needs one)", autocomplete: "off" });
  const mCommand = h("input", { placeholder: "Or a program to run, e.g. npx -y @some/mcp-server", class: "mono" });
  col.append(
    h("h3", {}, "All connectors, and ones that run on this computer"),
    h("p", { class: "note" }, "Connectors give agents ready-made tools for other services. The app connects to them from this computer, so they work with every model. A connector can be on the web, or a program this computer runs. Their tools ask before changing anything unless the connector marks them read-only, and agents give them only to agents with the connectors power."),
    ...c.mcpServers.map((s) =>
      h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", {}, s.name), " ", h("code", {}, s.command || s.url)), h("button", { class: "plain danger", onclick: () => save({ mcpServer: { name: s.name, remove: true } }) }, "Remove")),
      ),
    ),
    h(
      "form",
      { class: "form", onsubmit: (e) => (e.preventDefault(), save({ mcpServer: { name: mName.value.trim(), url: mUrl.value.trim(), token: mToken.value, command: mCommand.value.trim() } })) },
      mName,
      mUrl,
      mToken,
      mCommand,
      h("div", {}, h("button", {}, "Add connector")),
    ),
  );
}

async function integrationsView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "integrations" });
  fill(ui.body, h("main", { class: "center" }, col));
  const again = () => integrationsView();
  let list, git;
  try {
    [list, git] = await Promise.all([api("GET", "integrations"), ["git", "mcp", "openrouter"].includes(ui.integration) ? api("GET", `integrations/${ui.integration}`) : null]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "integrations") return;
  const act = (fn) => attempt(async () => (await fn(), (state.config = await api("GET", "state")), renderTop(), again()), col);

  if (ui.integration === "git" && git) return fill(col, ...gitIntegrationPage(git, act, col, again));
  if (ui.integration === "ai-models") return aiModelsPage(col, again);
  if (ui.integration === "api-keys") return apiKeysPage(col, again);
  if (ui.integration === "mcp" && git) return (fill(col, ...mcpIntegrationPage(git, act, col, again)), connectorsByHand(col, again));
  if (ui.integration === "openrouter" && git) {
    if (ui.orWaiting && !git.connected) waitForSignIn();
    return fill(col, ...openrouterIntegrationPage(git, act, col, again));
  }

  const chosen = ui.integrationCategory ?? "All";
  const shown = list.integrations.filter((i) => chosen === "All" || i.category === chosen);
  fill(
    col,
    h("div", {}, h("h1", {}, "Integrations"), h("p", { class: "lead" }, "Connect the tools your business already uses, so your agents can work where the work is. Each integration says exactly what agents can and cannot do with it.")),
    h("div", { class: "pills", role: "group", "aria-label": "Categories" }, ["All", ...list.categories].map((c) => h("button", { class: `mpill ${c === chosen ? "on" : ""}`, "aria-pressed": String(c === chosen), onclick: () => ((ui.integrationCategory = c), again()) }, c))),
    ...list.categories
      .filter((c) => shown.some((i) => i.category === c))
      .map((c) =>
        h(
          "section",
          { class: "icat" },
          h("h2", {}, c),
          h(
            "div",
            { class: "igrid" },
            shown
              .filter((i) => i.category === c)
              .map((i) =>
                h(
                  "button",
                  { class: "icard", onclick: () => ((ui.integration = i.id), again()) },
                  h("div", { class: "ihead" }, integrationMark(i.id), h("div", { class: "grow" }, h("b", {}, i.name), h("div", { class: "by" }, i.status)), h("span", { class: `chip ${STATE_WORDS[i.state][1]}` }, STATE_WORDS[i.state][0])),
                  h("p", { class: "mdesc" }, i.summary),
                  h("span", { class: "ilink" }, i.state === "connected" ? "Manage →" : "Set up →"),
                ),
              ),
          ),
        ),
      ),
    h("p", { class: "note" }, "More integrations will be added here. Any service that offers a connector (an MCP server) can already be added under ", h("button", { class: "plain link", onclick: () => ((ui.integration = "mcp"), again()) }, "MCP"), "."),
  );
}

/** A typical task for one agent, for the "about $x a task" line: what agents read and write in one, roughly. */
const TYPICAL_TASK = { input: 40_000, output: 3_000 };
const taskCost = (p) => (p.input * TYPICAL_TASK.input + p.output * TYPICAL_TASK.output) / 1e6;
const perMillion = (n) => (n === 0 ? "free" : n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

/** The OpenRouter integration: one account for hundreds of models, chosen from a list that shows the cost. */
function openrouterIntegrationPage(or, act, col, again) {
  const back = h("button", { class: "plain back", onclick: () => ((ui.integration = null), (ui.orWaiting = null), again()) }, "← All integrations");
  const head = h(
    "div",
    { class: "ihero" },
    integrationMark("openrouter"),
    h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, "OpenRouter"), h("span", { class: `chip ${STATE_WORDS[or.state][1]}` }, STATE_WORDS[or.state][0])), h("p", { class: "lead" }, or.summary)),
  );

  // ---- connecting ----
  const connect = h("button", { class: "primary big" }, ui.orWaiting ? "Open openrouter.ai again" : "Connect OpenRouter");
  connect.addEventListener("click", async () => {
    connect.disabled = true;
    try {
      const { url } = await api("POST", "integrations/openrouter/start");
      window.open(url, "_blank", "noopener");
      ui.orWaiting = Date.now();
      waitForSignIn();
      again();
    } catch (err) {
      connect.disabled = false;
      alert(err.message);
    }
  });
  const keyInput = h("input", { type: "password", placeholder: "sk-or-…", autocomplete: "off", "aria-label": "OpenRouter key" });
  const keyForm = h(
    "details",
    { class: "card onthis" },
    h("summary", {}, h("b", {}, "Already have an OpenRouter key?"), h("span", { class: "note small" }, "Paste it instead")),
    h(
      "form",
      { class: "body form", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", "integrations/openrouter/key", { key: keyInput.value }))) },
      h("p", { class: "note" }, "Make one at openrouter.ai/keys, copy it, and paste it here. It is kept on this computer and only ever sent to OpenRouter."),
      keyInput,
      h("div", {}, h("button", { class: "primary" }, "Save key")),
    ),
  );

  if (!or.connected) {
    return [
      back,
      head,
      h(
        "section",
        { class: "isec" },
        h("h2", {}, "Connect in one step"),
        h(
          "div",
          { class: "card form" },
          h("div", { class: "istep num" }, h("span", { class: "istepmark", "aria-hidden": "true" }, "1"), h("div", { class: "grow" }, h("b", {}, "Press Connect OpenRouter"), h("p", { class: "note" }, "openrouter.ai opens in your web browser. Sign in, or make a free account there. You can add credit there too: you pay OpenRouter directly for what your agents use."))),
          h("div", { class: "istep num" }, h("span", { class: "istepmark", "aria-hidden": "true" }, "2"), h("div", { class: "grow" }, h("b", {}, "Press Authorize on openrouter.ai"), h("p", { class: "note" }, "That gives this app its own key. You do not copy anything. You can set a spending limit for it on that page."))),
          h("div", { class: "istep num" }, h("span", { class: "istepmark", "aria-hidden": "true" }, "3"), h("div", { class: "grow" }, h("b", {}, "Come back here"), h("p", { class: "note" }, "This page notices by itself, and you choose which model your team uses."))),
          h("div", { class: "row" }, connect, ui.orWaiting ? h("span", { class: "note" }, h("i", { class: "dot", "aria-hidden": "true" }), " Waiting for you to approve on openrouter.ai…") : null),
        ),
        keyForm,
        h("div", { class: "willgrid" },
          h("div", { class: "willbox will" }, h("div", { class: "label" }, "✓ With OpenRouter"), h("ul", {}, ...["Run your agents on models from Anthropic, OpenAI, Google, Meta, DeepSeek, Mistral, Qwen and more", "Give one agent a different model from the rest, such as a cheaper one for routine work", "See every model's price before you choose, and the real cost of each task on its receipt"].map((x) => h("li", {}, x)))),
          h("div", { class: "willbox wont" }, h("div", { class: "label" }, "✕ It never"), h("ul", {}, ...["Spends past the budgets you set in this app, or the limit you set on openrouter.ai", "Sends your key anywhere but OpenRouter", "Changes your Claude setup: Claude through your Anthropic key keeps working"].map((x) => h("li", {}, x)))),
        ),
      ),
    ];
  }

  // ---- connected: the account and choosing a model ----
  const a = or.account;
  const accountLine = !a ? "Connected." : !a.keyWorks ? "The saved key no longer works. Connect again below." : [a.usage !== undefined ? `${money(a.usage)} used so far` : null, a.limit ? `limit ${money(a.limit)}${a.remaining !== null && a.remaining !== undefined ? `, ${money(a.remaining)} left` : ""}` : "no limit set on this key", a.freeTier ? "free tier: add credit on openrouter.ai to use paid models" : null].filter(Boolean).join(" · ");
  const current = or.models.find((m) => m.id === or.using);

  ui.orSort ??= "suggested";
  const search = h("input", { type: "search", placeholder: `Search ${or.models.length} models, e.g. claude, gpt, gemini, llama, free`, "aria-label": "Search models", value: ui.orSearch ?? "" });
  const sort = h("select", { "aria-label": "Order" }, [["suggested", "Suggested first"], ["cheap", "Cheapest first"], ["name", "A to Z"], ["context", "Longest documents first"]].map(([v, t]) => h("option", { value: v, selected: v === ui.orSort }, t)));
  const rows = h("div", { class: "ormodels" });
  const suggested = new Map(or.suggested.map((s) => [s.id, s.why]));
  const row = (m) =>
    h(
      "div",
      { class: `ormodel ${m.id === or.using ? "on" : ""}` },
      h(
        "div",
        { class: "grow" },
        h("div", { class: "row tight" }, h("b", {}, m.name), m.free ? h("span", { class: "chip on" }, "Free") : null, m.id === or.using ? h("span", { class: "chip on" }, "Your team uses this") : null),
        h("div", { class: "mono small muted" }, m.id),
        suggested.has(m.id) ? h("div", { class: "note small" }, suggested.get(m.id)) : null,
      ),
      h(
        "div",
        { class: "orprice" },
        h("b", {}, m.free ? "Free" : `about ${money(taskCost(m.prices))} a task`),
        h("span", {}, m.free ? "limited daily use" : `${perMillion(m.prices.input)} in · ${perMillion(m.prices.output)} out per million tokens`),
        h("span", {}, `holds about ${Math.round((m.contextTokens * 0.75) / 1000).toLocaleString()}k words`),
      ),
      m.id === or.using ? h("button", { disabled: true }, "In use") : h("button", { onclick: () => act(() => api("POST", "integrations/openrouter/use", { model: m.id })) }, "Use for my team"),
    );
  const draw = () => {
    ui.orSearch = search.value;
    ui.orSort = sort.value;
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = or.models.filter((m) => words.every((w) => (w === "free" ? m.free : `${m.name} ${m.id}`.toLowerCase().includes(w))));
    const by = { cheap: (x, y) => taskCost(x.prices) - taskCost(y.prices), name: (x, y) => x.name.localeCompare(y.name), context: (x, y) => y.contextTokens - x.contextTokens, suggested: (x, y) => (suggested.has(y.id) - suggested.has(x.id)) || (x.id === or.using ? -1 : y.id === or.using ? 1 : 0) || x.name.localeCompare(y.name) };
    shown = shown.sort(by[sort.value] ?? by.suggested);
    fill(rows, shown.length ? [shown.slice(0, 60).map(row), shown.length > 60 ? h("p", { class: "note small" }, `Showing 60 of ${shown.length}. Search to narrow the list.`) : null] : h("p", { class: "note" }, "No model matches that search."));
  };
  search.addEventListener("input", draw);
  sort.addEventListener("change", draw);
  draw();

  return [
    back,
    head,
    h(
      "section",
      { class: "isec" },
      h("h2", {}, "Your account"),
      h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, a?.keyWorks === false ? "Not working" : "Connected"), h("div", { class: "note" }, accountLine)), h("button", { type: "button", onclick: () => window.open("https://openrouter.ai/settings/credits", "_blank", "noopener") }, "Add credit"), h("button", { type: "button", class: "plain", onclick: () => window.open("https://openrouter.ai/activity", "_blank", "noopener") }, "See activity on openrouter.ai")),
        a?.keyWorks === false ? h("div", { class: "row" }, connect) : null,
      ),
    ),
    h(
      "section",
      { class: "isec" },
      h("h2", {}, "Which model your team uses"),
      h(
        "div",
        { class: "card" },
        current
          ? h("div", {}, h("b", {}, `${current.name}`), h("p", { class: "note" }, `Every agent uses it, except agents you gave a model of their own. About ${current.free ? "nothing" : money(taskCost(current.prices))} for a typical task by one agent; the receipt of each task shows the real cost OpenRouter charged.`))
          : h("div", {}, h("b", {}, `Your team uses ${state.config?.model?.startsWith("anthropic/") ? "Claude, through your Anthropic key" : state.config?.model || "the model set under AI models"}`), h("p", { class: "note" }, "Choose a model below to run your team on OpenRouter instead. You can switch back at any time under Integrations → AI models.")),
        h("p", { class: "note small" }, "To give one agent its own model, open that agent, and under Model choose OpenRouter and the model. Cheaper models suit routine work; stronger ones suit managers and complex tasks."),
      ),
      h("div", { class: "row" }, search, sort),
      rows,
      h("p", { class: "note small" }, "“About a task” is a rough guide for one agent doing one task (about 40,000 tokens read and 3,000 written). A token is about three quarters of a word. Only models that can use tools are listed, because agents work through tools."),
    ),
    h(
      "section",
      { class: "isec" },
      h(
        "div",
        { class: "card danger-zone" },
        h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, "Remove this integration"), h("p", { class: "note" }, "Forgets the key on this computer. If your team uses an OpenRouter model, it goes back to Claude. To stop the key working everywhere, delete it at openrouter.ai/keys.")),
          h("button", { class: "danger", onclick: () => confirm("Remove OpenRouter?\n\nThe key is forgotten on this computer, and agents using an OpenRouter model go back to Claude.") && act(() => api("POST", "integrations/openrouter/remove")) }, "Remove integration"),
        ),
      ),
    ),
  ];
}

/** While the person approves on openrouter.ai, checks every few seconds whether the key has arrived. */
function waitForSignIn() {
  clearTimeout(ui.orTimer);
  const tick = async () => {
    if (!ui.orWaiting || Date.now() - ui.orWaiting > 10 * 60_000) return (ui.orWaiting = null);
    const or = await api("GET", "integrations/openrouter").catch(() => null);
    if (or?.connected) {
      ui.orWaiting = null;
      state.config = await api("GET", "state").catch(() => state.config);
      if (state.view === "integrations") integrationsView();
      return;
    }
    ui.orTimer = setTimeout(tick, 2500);
  };
  ui.orTimer = setTimeout(tick, 2500);
}

/** The MCP integration: Talqava inside Claude and other AI apps, and other services' tools for the agents. */
function mcpIntegrationPage(mcp, act, col, again) {
  const back = h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations");
  const copy = (text, btn) => navigator.clipboard?.writeText(text).then(() => ((btn.textContent = "Copied"), setTimeout(() => (btn.textContent = "Copy"), 1500))).catch(() => {});
  const copyBox = (label, text) => {
    const btn = h("button", { type: "button" }, "Copy");
    btn.addEventListener("click", () => copy(text, btn));
    return h("div", { class: "copybox" }, h("div", { class: "row" }, h("span", { class: "label grow", style: "margin: 0" }, label), btn), h("pre", {}, text));
  };
  const name = h("input", { placeholder: "A short name, e.g. notion", "aria-label": "Connector name" });
  const address = h("input", { placeholder: "Its web address, e.g. https://mcp.example.com/mcp", "aria-label": "Connector address" });
  const token = h("input", { type: "password", placeholder: "Access token (only if it needs one)", autocomplete: "off", "aria-label": "Access token" });
  return [
    back,
    h("div", { class: "ihero" }, integrationMark("mcp"), h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, "MCP"), h("span", { class: `chip ${STATE_WORDS[mcp.state][1]}` }, STATE_WORDS[mcp.state][0])), h("p", { class: "lead" }, mcp.summary))),
    h(
      "section",
      { class: "isec" },
      h("h2", {}, "Use your Talqava team from Claude"),
      h(
        "div",
        { class: "card form" },
        h("div", { class: "row" }, h("b", { class: "grow" }, "The Claude desktop app"), h("span", { class: `chip ${mcp.claude.added ? "on" : ""}` }, mcp.claude.added ? "Added" : mcp.claude.found ? "Not added" : "Not installed")),
        h("p", { class: "note" }, "Adds your Talqava team to Claude, so you can say things like “ask my Head of Marketing for a campaign plan” in a Claude chat. The work still happens here, and anything that changes files or sends something still waits for your approval here."),
        mcp.claude.added
          ? [h("div", { class: "istep done" }, h("span", { class: "istepmark", "aria-hidden": "true" }, "✓"), h("div", { class: "grow" }, h("b", {}, "Talqava is added to Claude"), h("p", { class: "note" }, "Quit Claude completely and open it again to see it. Keep this app open while you use it. Then try asking Claude: “What agents are on my Talqava team?”"))), h("div", { class: "row" }, h("button", { class: "plain danger", onclick: () => confirm("Take Talqava out of Claude?") && act(() => api("POST", "integrations/mcp/claude-desktop", { remove: true })) }, "Remove from Claude"))]
          : mcp.claude.found
            ? h("div", { class: "row" }, h("button", { class: "primary big", onclick: () => act(() => api("POST", "integrations/mcp/claude-desktop", {})) }, "Add Talqava to Claude"), h("span", { class: "note" }, "One click. Nothing else in Claude's settings is changed, and a copy of them is kept first."))
            : h("div", { class: "row" }, h("span", { class: "note" }, "The Claude desktop app was not found on this computer."), h("button", { type: "button", class: "plain link", onclick: () => window.open("https://claude.ai/download", "_blank", "noopener") }, "Get Claude, open it once, then come back")),
        h("div", { class: "label", style: "margin: 8px 0 0" }, "What Claude can do with your team"),
        h("ul", { class: "toollist" }, mcp.tools.map(([, words]) => h("li", {}, words))),
      ),
      h("details", { class: "card onthis" }, h("summary", {}, h("b", {}, "Other AI apps"), h("span", { class: "note small" }, "For people comfortable with settings files")), h("div", { class: "body" }, h("p", { class: "note" }, "Any app that supports MCP can use the same connection. Paste one of these where that app asks for it."), copyBox("Claude Code (run in a terminal)", mcp.claudeCode), copyBox("Any other app (settings snippet)", mcp.snippet))),
    ),
    h(
      "section",
      { class: "isec" },
      h("h2", {}, `Give your agents tools from other services${mcp.connectors.length ? ` · ${mcp.connectors.length}` : ""}`),
      h("p", { class: "note", style: "margin: 0" }, "A connector lets your agents use another service, such as your documents, calendar or CRM. Their tools ask you before changing anything, and what they return is treated as outside information."),
      mcp.connectors.map((c) => h("div", { class: "card" }, h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, c.name), h("div", { class: "mono small muted" }, c.where)), h("button", { class: "danger", onclick: () => confirm(`Remove the ${c.name} connector? Your agents can no longer use its tools.`) && act(() => api("PUT", "settings", { mcpServer: { name: c.name, remove: true } })) }, "Remove")))),
      h("form", { class: "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("PUT", "settings", { mcpServer: { name: name.value.trim(), url: address.value.trim(), token: token.value } }))) }, h("b", {}, "Add a connector"), h("p", { class: "note small" }, "The service gives you its MCP address, and a token if it needs one."), name, address, token, h("div", {}, h("button", { class: "primary" }, "Add connector"))),
      h("p", { class: "note small" }, "A connector that runs as a program on this computer is added below."),
    ),
  ];
}

/** The Git integration: what it does, whether it is ready, the repositories, and GitHub. */
function gitIntegrationPage(git, act, col, again) {
  const back = h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations");
  const step = (done, title, body) => h("div", { class: `istep ${done ? "done" : ""}` }, h("span", { class: "istepmark", "aria-hidden": "true" }, done ? "✓" : ""), h("div", { class: "grow" }, h("b", {}, title), body));
  const head = h("div", { class: "ihero" }, integrationMark("git"), h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, "Git and GitHub"), h("span", { class: `chip ${STATE_WORDS[git.state][1]}` }, STATE_WORDS[git.state][0])), h("p", { class: "lead" }, git.summary)));
  // Looking through folders on this computer happens only when asked.
  const searchBtn = h("button", {}, ui.gitAuto?.local ? "Search this computer again" : "Search this computer for repositories");
  searchBtn.addEventListener("click", async () => {
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching…";
    try {
      ui.gitAuto = await api("POST", "integrations/git/auto", { scan: true });
    } catch (err) {
      ui.gitAuto = { steps: [], local: [], error: err.message };
    }
    again();
  });
  const auto = ui.gitAuto;
  const connectLocal = (r) => act(async () => (await api("PUT", "settings", { project: { path: r.path } }), (ui.gitAuto = await api("POST", "integrations/git/auto", { scan: true }))));
  const copyBtn = (r) => {
    const btn = h("button", {}, "Copy here and connect");
    btn.addEventListener("click", () => ((btn.disabled = true), (btn.textContent = "Copying…"), act(async () => (await api("POST", "integrations/git/clone", { url: r.url }), (ui.gitAuto = await api("POST", "integrations/git/auto")))).finally(() => ((btn.disabled = false), (btn.textContent = "Copy here and connect")))));
    return btn;
  };
  // Repositories on GitHub that are not on this computer yet: tick the ones wanted, and they are copied here and connected.
  const remotePicker = (found) => {
    ui.gitPick ??= new Set();
    const filter = h("input", { type: "search", placeholder: "Filter your repositories", "aria-label": "Filter repositories", value: ui.gitPickFilter ?? "" });
    const rows = h("div", { class: "pickrows" });
    const go = h("button", { class: "primary" }, "Connect selected");
    const draw = () => {
      const needle = filter.value.trim().toLowerCase();
      const shown = found.remote.filter((r) => !needle || `${r.name} ${r.description}`.toLowerCase().includes(needle));
      for (const url of [...ui.gitPick]) if (!found.remote.some((r) => r.url === url && !r.connected)) ui.gitPick.delete(url);
      fill(
        rows,
        shown.length
          ? shown.map((r) => {
              if (r.connected) return h("div", { class: "pickrow" }, h("span", { class: "flowmain" }, h("b", {}, r.name), h("span", { class: "flowsub" }, r.description || "Already connected")), h("span", { class: "chip on" }, "Connected"));
              const box = h("input", { type: "checkbox", checked: ui.gitPick.has(r.url), "aria-label": `Select ${r.name}` });
              box.addEventListener("change", () => ((box.checked ? ui.gitPick.add(r.url) : ui.gitPick.delete(r.url)), count()));
              return h("label", { class: "pickrow pickable" }, box, h("span", { class: "flowmain" }, h("b", {}, r.name, r.private ? h("span", { class: "chip", style: "margin-left: 8px" }, "Private") : null), h("span", { class: "flowsub" }, `${r.description ? `${r.description} · ` : ""}last changed ${shortWhen(r.pushedAt)}`)));
            })
          : h("p", { class: "note" }, "No repository matches."),
      );
    };
    const count = () => ((go.textContent = ui.gitPick.size ? `Copy here and connect ${ui.gitPick.size} selected` : "Select repositories to connect"), (go.disabled = !ui.gitPick.size));
    filter.addEventListener("input", () => ((ui.gitPickFilter = filter.value), draw()));
    go.addEventListener("click", () => {
      const urls = [...ui.gitPick];
      go.disabled = true;
      act(async () => {
        for (const [i, url] of urls.entries()) {
          go.textContent = `Copying ${i + 1} of ${urls.length}…`;
          await api("POST", "integrations/git/clone", { url });
          ui.gitPick.delete(url);
        }
        if (ui.githubPick?.account) ui.githubPick.repos = (await api("POST", "integrations/git/github-repos", { account: ui.githubPick.account })).repos;
      }).finally(count);
    });
    draw();
    count();
    return [h("div", { class: "row", style: "margin-top: 6px" }, h("div", { class: "label grow", style: "margin: 0" }, `Repositories of ${found.login} · ${found.remote.length}`), filter), h("p", { class: "note small", style: "margin: 0" }, `Tick the ones you want. Each is copied into ${git.cloneFolder} and connected; nothing on GitHub changes.`), found.remote.length ? rows : h("p", { class: "note" }, "This account has no repositories that this sign-in can see."), found.remote.length ? h("div", {}, go) : null];
  };
  // What a search of this computer found, for the "On this computer" part of the page.
  const foundHere = auto?.local
    ? auto.local.length
      ? [
          h("div", { class: "row" }, h("div", { class: "label grow", style: "margin: 6px 0 0" }, `Found on this computer · ${auto.local.length}`), auto.local.length > 1 ? h("button", { class: "plain link", onclick: () => act(async () => { for (const r of auto.local) await api("PUT", "settings", { project: { path: r.path } }); ui.gitAuto = await api("POST", "integrations/git/auto", { scan: true }); }) }, "Connect all") : null),
          h("div", { class: "pickrows" }, auto.local.map((r) => h("div", { class: "pickrow" }, h("span", { class: "flowmain" }, h("b", {}, r.name), h("span", { class: "flowsub" }, r.path)), h("button", { class: "primary", onclick: () => connectLocal(r) }, "Connect")))),
        ]
      : h("p", { class: "note" }, auto.error ?? "No repositories were found in the usual folders. Connect one by its folder below.")
    : null;
  if (!git.installed) {
    return [
      back,
      head,
      h("section", { class: "card isetup" }, h("h2", {}, "One thing to install first"), h("div", { class: "istep action" }, h("span", { class: "istepmark", "aria-hidden": "true" }, "!"), h("div", { class: "grow" }, h("b", {}, "Git is not on this computer yet"), h("p", { class: "note" }, "Press Install Git. macOS opens its own installer window: click Install there and wait a few minutes, then come back and press Check again."))), h("div", { class: "row" }, h("button", { class: "primary", onclick: (e) => ((e.target.disabled = true), attempt(async () => alert((await api("POST", "integrations/git/install")).message), col)) }, "Install Git"), h("button", { onclick: again }, "Check again"))),
    ];
  }

  // ----- repositories -----
  const folder = h("input", { placeholder: "A folder on this computer, e.g. /Users/you/Projects/my-app", "aria-label": "Folder of a repository" });
  const url = h("input", { placeholder: "https://github.com/your-name/your-repository", "aria-label": "Web address of a repository" });
  const cloneBtn = h("button", { class: "primary" }, "Copy it here and connect");
  const repoCard = (r) =>
    h(
      "div",
      { class: `card irepo ${r.found ? "" : "gone"}` },
      h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, r.name), h("div", { class: "mono small muted" }, r.path)), r.found && state.project !== r.path ? h("button", { title: "New tasks will work on this repository", onclick: () => ((state.project = r.path), remember("talqava.project", r.path), loadCrew().then(() => (renderTop(), again()))) }, "Use for new tasks") : r.found ? h("span", { class: "chip on" }, "In use for new tasks") : null, h(
        "button",
        {
          class: "danger",
          onclick: () => {
            const copy = (git.copies ?? []).includes(r.path);
            if (!confirm(`Remove ${r.name} from Talqava?\n\nAgents stop working on it. ${copy ? "This is a copy the app made; you are asked next whether to delete it too." : "The folder and everything in it stay on your computer."}`)) return;
            const deleteCopy = copy && confirm(`Also delete the copy on this computer?\n\n${r.path}\n\nOK deletes those files (the repository on GitHub is not touched). Cancel keeps them.`);
            if (state.project === r.path) (state.project = ""), remember("talqava.project", "");
            act(async () => (await api("POST", "integrations/git/disconnect", { path: r.path, deleteCopy }), ui.gitAuto ? (ui.gitAuto = await api("POST", "integrations/git/auto")) : null));
          },
        },
        "Remove",
      )),
      r.found
        ? h(
            "div",
            { class: "ifacts" },
            h("div", {}, h("span", { class: "label" }, "Your branch"), h("span", {}, r.branch)),
            h("div", {}, h("span", { class: "label" }, "Last commit"), h("span", { title: r.lastCommit ? `${r.lastCommit.author}` : "" }, r.lastCommit ? `${r.lastCommit.subject.slice(0, 70)} · ${shortWhen(r.lastCommit.when)}` : "No commits yet")),
            h("div", {}, h("span", { class: "label" }, "Your unsaved changes"), h("span", { class: r.uncommitted ? "warn" : "" }, r.uncommitted ? `${r.uncommitted} file${r.uncommitted === 1 ? "" : "s"} not committed` : "None")),
            h("div", {}, h("span", { class: "label" }, "Hosted at"), h("span", {}, r.github ? `GitHub · ${r.github}` : r.remote || "This computer only")),
            h("div", {}, h("span", { class: "label" }, "Agent work"), h("span", {}, `${r.activeTasks} task${r.activeTasks === 1 ? "" : "s"} under way · ${r.taskBranches} task branch${r.taskBranches === 1 ? "" : "es"}`)),
          )
        : h("p", { class: "note" }, "This folder is no longer a git repository, or has been moved. Disconnect it, or put it back."),
      r.found && !r.lastCommit ? h("p", { class: "note small" }, "A repository needs at least one commit before an agent can work on it.") : null,
    );

  // ----- GitHub: sign in through the web, or with a token -----
  const openWeb = (address) => window.open(address, "_blank", "noopener");
  // Loads the accounts this sign-in can see (the person's own, and their companies) and one account's repositories.
  const loadAccount = async (account) => {
    try {
      const listed = ui.githubPick?.accounts ? ui.githubPick : await api("POST", "integrations/git/github-accounts");
      const chosen = account ?? ui.githubPick?.account ?? listed.accounts[0].login;
      ui.githubPick = { login: listed.login, accounts: listed.accounts, account: chosen, repos: null, error: null };
      again();
      ui.githubPick.repos = (await api("POST", "integrations/git/github-repos", { account: chosen })).repos;
    } catch (err) {
      ui.githubPick = { ...(ui.githubPick ?? { accounts: [] }), repos: [], error: err.message };
    }
    again();
  };
  const afterGithub = async () => {
    ui.githubSignIn = null;
    ui.githubTokenFlow = false;
    ui.githubPick = null;
    state.config = await api("GET", "state");
    await loadAccount();
  };
  const startSignIn = async (btn) => {
    btn.disabled = true;
    try {
      ui.githubSignIn = await api("POST", "integrations/git/github-start");
      navigator.clipboard?.writeText(ui.githubSignIn.code).catch(() => {});
      openWeb(ui.githubSignIn.url);
      again();
    } catch (err) {
      ui.githubSignIn = { error: err.message };
      again();
    }
  };
  // While a sign-in is under way, ask GitHub every few seconds whether it has been approved.
  const waitForApproval = (status) => {
    const started = ui.githubSignIn;
    const tick = async () => {
      if (ui.githubSignIn !== started || state.view !== "integrations" || ui.integration !== "git") return;
      try {
        const r = await api("POST", "integrations/git/github-poll");
        if (r.done) return afterGithub();
        setTimeout(tick, (r.wait ?? started.interval ?? 5) * 1000);
      } catch (err) {
        ui.githubSignIn = { error: err.message };
        again();
      }
    };
    setTimeout(tick, (started.interval ?? 5) * 1000);
    status.textContent = "Waiting for you to approve on GitHub…";
  };
  const githubSection = () => {
    const signIn = ui.githubSignIn;
    const clientId = h("input", { placeholder: "Client ID, e.g. Ov23li…", value: git.github.clientId ?? "", autocomplete: "off", "aria-label": "GitHub app Client ID" });
    const oneClick = h(
      "details",
      { class: "card setup-once", open: ui.githubOnceOpen ? "" : null },
      h("summary", {}, h("b", {}, "One-click sign-in"), h("span", { class: `chip ${git.github.canSignIn ? "on" : ""}` }, git.github.canSignIn ? "Ready" : "Set up once")),
      h(
        "div",
        { class: "body" },
        h("p", { class: "note" }, "“Connect GitHub” signs people in on github.com with a short code, with no token to copy. GitHub requires an app to be registered for that, once, by whoever publishes this product. After that it works for everyone who uses it."),
        h("ol", { class: "isteps" }, h("li", {}, "On GitHub open Settings → Developer settings → OAuth Apps → New OAuth App."), h("li", {}, "Name it Talqava. For both web addresses use your website (they are not used by this kind of sign-in)."), h("li", {}, "Tick “Enable Device Flow”, then Register application."), h("li", {}, "Copy the Client ID shown on the app's page and paste it here. No secret is needed.")),
        h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), (ui.githubOnceOpen = true), act(() => api("POST", "integrations/git/github-client", { clientId: clientId.value }))) }, clientId, h("button", { class: "primary" }, "Save Client ID"), h("button", { type: "button", class: "plain link", onclick: () => openWeb("https://github.com/settings/applications/new") }, "Open that page on GitHub")),
      ),
    );
    if (git.github.tokenSaved) {
      const pick = ui.githubPick;
      const other = h("input", { placeholder: "Company's name on GitHub, e.g. talqava", "aria-label": "Company's name on GitHub", autocomplete: "off" });
      return h(
        "section",
        { class: "isec" },
        h("h2", {}, "GitHub"),
        h(
          "div",
          { class: "card form" },
          h("div", { class: "row" }, h("b", { class: "grow" }, pick?.login ? `Connected as ${pick.login}` : "Connected to GitHub"), h("span", { class: "chip on" }, "Connected")),
          h("p", { class: "note small" }, "The sign-in is kept on this computer, is only ever sent to GitHub, and is never shown to an agent."),
          h("div", { class: "row" }, pick ? null : h("button", { class: "primary", onclick: (e) => ((e.target.disabled = true), (e.target.textContent = "Loading your accounts…"), loadAccount()) }, "Choose repositories"), testBtn, h("button", { type: "button", class: "plain danger", onclick: () => confirm("Disconnect GitHub?\n\nRepositories already connected stay connected. Agents can no longer read issues and pull requests, and you can connect a different account afterwards.") && act(async () => (await api("PUT", "settings", { secret: { name: "GITHUB_TOKEN", remove: true } }), (ui.githubPick = null))) }, "Disconnect GitHub"), tested),
          pick
            ? [
                h("div", { class: "label", style: "margin: 8px 0 0" }, "Whose repositories?"),
                h("div", { class: "pills", role: "group", "aria-label": "Account" }, pick.accounts.map((a) => h("button", { class: `mpill ${a.login === pick.account ? "on" : ""}`, "aria-pressed": String(a.login === pick.account), title: a.description, onclick: () => a.login !== pick.account && loadAccount(a.login) }, a.kind === "personal" ? `${a.login} (you)` : a.login)), pick.account && !pick.accounts.some((a) => a.login === pick.account) ? h("button", { class: "mpill on" }, pick.account) : null),
                pick.error ? h("div", { class: "banner error" }, pick.error) : pick.repos ? remotePicker({ login: pick.account, remote: pick.repos }) : h("p", { class: "note" }, "Loading repositories…"),
                h(
                  "details",
                  { class: "notlisted", open: ui.githubNotListed ? "" : null, ontoggle: (e) => (ui.githubNotListed = e.target.open) },
                  h("summary", {}, h("b", {}, "My company is not listed")),
                  h(
                    "div",
                    { class: "body" },
                    h("p", { class: "note" }, "GitHub only shows a company (an “organization”) to an app the company has allowed. Whoever connects decides this on GitHub, and a company owner may have to approve it once."),
                    h("ol", { class: "isteps" }, h("li", {}, "If you used Connect GitHub: on github.com open Settings → Applications → Authorized OAuth Apps → Talqava, and under Organization access press Grant (or Request) beside your company. ", h("button", { type: "button", class: "plain link", onclick: () => openWeb("https://github.com/settings/applications") }, "Open that page")), h("li", {}, "If you used a token and your company uses single sign-on: on the tokens page press Configure SSO beside the token and authorize it for your company. ", h("button", { type: "button", class: "plain link", onclick: () => openWeb("https://github.com/settings/tokens") }, "Open that page")), h("li", {}, "Then press Refresh here, or type the company's GitHub name below to look at it directly.")),
                    h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), other.value.trim() ? loadAccount(other.value.trim().replace(/^@|^https:\/\/github\.com\//, "").replace(/\/.*$/, "")) : other.focus()) }, other, h("button", {}, "Show its repositories"), h("button", { type: "button", class: "plain link", onclick: () => ((ui.githubPick = null), loadAccount()) }, "Refresh the list of accounts")),
                  ),
                ),
              ]
            : null,
        ),
        oneClick,
      );
    }
    const connect = h("button", { class: "primary big" }, "Connect GitHub");
    connect.addEventListener("click", () => (git.github.canSignIn ? startSignIn(connect) : ((ui.githubTokenFlow = true), again())));
    const status = h("span", { class: "note" });
    if (signIn?.code) waitForApproval(status);
    return h(
      "section",
      { class: "isec" },
      h("h2", {}, "GitHub"),
      h(
        "div",
        { class: "card form" },
        h("div", { class: "row" }, h("b", { class: "grow" }, "Connect your GitHub account"), h("span", { class: "chip" }, "Not connected")),
        h("p", { class: "note" }, "Sign in on github.com in your browser, then choose which of your repositories to bring in. Your password is never typed into this app."),
        signIn?.code
          ? h(
              "div",
              { class: "signin" },
              h("div", { class: "label" }, "Type this code on GitHub"),
              h("div", { class: "signcode", "aria-live": "polite" }, signIn.code),
              h("div", { class: "row" }, h("button", { class: "primary", onclick: () => (navigator.clipboard?.writeText(signIn.code).catch(() => {}), openWeb(signIn.url)) }, "Copy the code and open GitHub"), h("button", { class: "plain", onclick: () => ((ui.githubSignIn = null), again()) }, "Cancel")),
              h("ol", { class: "isteps" }, h("li", {}, "GitHub opens in your browser. Sign in if it asks."), h("li", {}, "Paste or type the code above and press Continue."), h("li", {}, "Press Authorize. This page carries on by itself.")),
              status,
            )
          : h("div", { class: "row" }, connect, h("button", { type: "button", class: "plain link", onclick: () => openWeb("https://github.com/signup") }, "No GitHub account? Create one free, then come back and press Connect GitHub")),
        signIn?.error ? h("div", { class: "banner error" }, signIn.error) : null,
        ui.githubTokenFlow || signIn?.error
          ? h(
              "form",
              { class: "tokenflow", onsubmit: (e) => (e.preventDefault(), token.value.trim() ? act(async () => (await api("PUT", "settings", { secret: { name: "GITHUB_TOKEN", value: token.value.trim(), host: "api.github.com" } }), await afterGithub())) : token.focus()) },
              h("div", { class: "label" }, "Connect with an access token"),
              h("ol", { class: "isteps" }, h("li", {}, h("button", { type: "button", class: "plain link", onclick: () => openWeb("https://github.com/settings/tokens/new?description=Talqava%20Agents&scopes=repo,read:org,read:user") }, "Open GitHub's token page"), " in your browser. Sign in, or create a free account, if it asks."), h("li", {}, "The name and permissions are already filled in. Scroll down and press Generate token."), h("li", {}, "Copy the token GitHub shows (it starts with ghp_) and paste it here.")),
              h("div", { class: "row" }, token, h("button", { class: "primary" }, "Connect")),
            )
          : null,
      ),
      oneClick,
    );
  };

  // ----- GitHub token field and test -----
  const token = h("input", { type: "password", autocomplete: "off", placeholder: git.github.tokenSaved ? "A token is saved. Paste a new one to replace it." : "Paste a GitHub token (starts with ghp_ or github_pat_)", "aria-label": "GitHub token" });
  const tested = h("span", { class: "note small" });
  const testBtn = h("button", { type: "button", onclick: async () => {
    tested.textContent = "Checking…";
    try {
      tested.textContent = `✓ GitHub accepted it: signed in as ${(await api("POST", "integrations/git/test-github")).login}.`;
    } catch (err) {
      tested.textContent = `✕ ${err.message}`;
    }
  } }, "Test");

  const connected = git.github.tokenSaved;
  const hasRepo = git.repos.some((r) => r.found);
  return [
    back,
    head,
    h(
      "section",
      { class: "card isetup" },
      h("h2", {}, "Three steps"),
      step(connected, "1. Connect GitHub", h("p", { class: "note" }, connected ? "Done. You are signed in." : "Sign in on github.com in your browser. Start below.")),
      step(hasRepo, "2. Choose your repositories", h("p", { class: "note" }, hasRepo ? `${git.repos.filter((r) => r.found).length} connected. Add or remove any time.` : connected ? "Pick your account or your company below, and tick the ones you want." : "After you connect, you pick which ones to bring in: your own, or your company's.")),
      step(hasRepo, "3. Give an agent a task on it", h("p", { class: "note" }, "Choose the repository at the top of Work in progress and assign a task. You review every change before it is kept.")),
    ),
    githubSection(),
    h("section", { class: "isec" }, h("h2", {}, `Connected repositories${git.repos.length ? ` · ${git.repos.length}` : ""}`), git.repos.length ? git.repos.map(repoCard) : h("p", { class: "note" }, "None yet. Connect GitHub above and choose the ones you want.")),
    h(
      "details",
      { class: "card onthis", open: ui.gitLocalOpen || auto?.local ? "" : null, ontoggle: (e) => (ui.gitLocalOpen = e.target.open) },
      h("summary", {}, h("b", {}, "Already have a repository on this computer?"), h("span", { class: "note small" }, "Optional")),
      h(
        "div",
        { class: "body" },
        h("p", { class: "note" }, "If the code is already in a folder on this computer, you can connect that folder instead of copying it from GitHub. Nothing on this computer is looked at until you press Search."),
        h("div", {}, searchBtn),
        foundHere,
        h(
          "div",
          { class: "iadd" },
        h("form", { class: "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("PUT", "settings", { project: { path: folder.value.trim() } }))) }, h("b", {}, "Connect a folder by its location"), h("p", { class: "note small" }, "Type where it is. Nothing is copied or moved."), folder, h("div", {}, h("button", { class: "primary" }, "Connect"))),
        h(
          "form",
          {
            class: "card form",
            onsubmit: (e) => {
              e.preventDefault();
              cloneBtn.disabled = true;
              cloneBtn.textContent = "Copying…";
              act(() => api("POST", "integrations/git/clone", { url: url.value.trim() })).finally?.(() => ((cloneBtn.disabled = false), (cloneBtn.textContent = "Copy it here and connect")));
            },
          },
          h("b", {}, "Copy one from a web address"),
          h("p", { class: "note small" }, `Paste its address from GitHub or another host. A copy is made in ${git.cloneFolder}. A private repository needs this computer to be signed in to that host already.`),
          url,
          h("div", {}, cloneBtn),
        ),
        ),
        h("p", { class: "note small" }, `Git ${git.version} is installed. ${git.identity.name ? `Changes you keep are recorded as ${git.identity.name}${git.identity.email ? ` <${git.identity.email}>` : ""}.` : "Git has no name for you yet; connecting GitHub sets it from your account."}`),
      ),
    ),
    h(
      "section",
      { class: "isec" },
      h("h2", {}, "What agents can and cannot do"),
      h(
        "div",
        { class: "willrow" },
        h("div", { class: "willbox will" }, h("div", { class: "label" }, "✓ With this integration"), h("ul", {}, ...["Work on a repository in a branch and working copy made for that one task", "Read the code and its history, and run the project's tests", "Show you every change, file by file, before anything is kept", "Read GitHub issues and pull requests when a token is saved"].map((x) => h("li", {}, x)))),
        h("div", { class: "willbox wont" }, h("div", { class: "label" }, "✕ Never"), h("ul", {}, ...["Touch your own branches or your unsaved changes", "Commit to your branch: keeping a task makes one commit on the task's own branch", "Push, merge or deploy: those stay with you", "See your GitHub token"].map((x) => h("li", {}, x)))),
      ),
      h("p", { class: "note" }, git.coders.length ? `Agents that can change files, and so get a branch of their own: ${git.coders.map((b) => b.name).join(", ")}. Others can read a repository but not change it.` : "No agent on your team can change files yet. Add one from the marketplace, such as a developer."),
      h("p", { class: "note" }, "To use it: connect a repository, choose it in the Repository box at the top of Work in progress, then assign a task. When the task stops, its page shows the changes with Keep the changes and Undo."),
    ),
    git.repos.length || git.github.tokenSaved
      ? h(
          "section",
          { class: "card removeint" },
          h("div", { class: "grow" }, h("b", {}, "Remove this integration"), h("p", { class: "note" }, `Disconnects ${git.repos.length ? `all ${git.repos.length} repositor${git.repos.length === 1 ? "y" : "ies"}` : "everything"} and forgets the GitHub sign-in. Folders on your computer and everything on GitHub are left as they are. You can set it up again at any time.`)),
          h(
            "button",
            {
              class: "danger",
              onclick: () => {
                if (!confirm(`Remove the Git integration?\n\n${git.repos.length} repositor${git.repos.length === 1 ? "y is" : "ies are"} disconnected and the GitHub sign-in is forgotten. Nothing on GitHub changes.`)) return;
                const deleteCopies = (git.copies ?? []).length > 0 && confirm(`Also delete the ${git.copies.length} cop${git.copies.length === 1 ? "y" : "ies"} this app made on this computer?\n\n${git.copies.join("\n")}\n\nOK deletes those files. Cancel keeps them. Folders you connected yourself are never deleted.`);
                state.project = "";
                remember("talqava.project", "");
                ui.gitAuto = null;
                ui.githubPick = null;
                ui.githubSignIn = null;
                act(() => api("POST", "integrations/git/remove", { deleteCopies }));
              },
            },
            "Remove integration",
          ),
        )
      : null,
  ];
}

// ---------- the marketplace ----------
// Free, ready-made bots, each built for one job. A bot's instructions are shown
// in full before it is added; adding saves a copy as the person's own bot.
async function loadMarket() {
  const market = await api("GET", "marketplace");
  state.market = market.bots;
  state.marketTeams = market.teams ?? [];
  return market;
}

const TRUST_WORDS = { talqava: "Made by Talqava", verified: "Verified", community: "Community" };

/** On a marketplace agent's page: whether a newer version exists, what changed, and Update / Keep mine / Undo update. */
function updateBox(bot, col) {
  const st = bot.install;
  if (!st || st.state === "available") return null;
  const act = (path, note) =>
    attempt(async () => {
      const r = await api("POST", `marketplace/${bot.id}/${path}`);
      await Promise.all([loadMarket(), loadCrew()]);
      toast(note(r));
      renderBody();
    }, col);
  const changes = (bot.listing.changes ?? []).slice(0, 5);
  if (st.state === "update" || st.state === "differs")
    return h(
      "div",
      { class: "card updatebox" },
      h("b", {}, st.state === "update" ? `Version ${bot.listing.version} is available. You have ${st.installed}.` : `Your copy is different from the marketplace version ${bot.listing.version}.`),
      changes.length ? h("ul", { class: "note small" }, changes.map((c) => h("li", {}, c))) : null,
      st.edited ? h("p", { class: "note small warnline" }, "You changed your copy. Updating replaces its instructions, powers and limits with the new version's. Its name, look, model and budget stay yours, and you can undo the update.") : h("p", { class: "note small" }, "Its name, look, model and budget stay as you set them. You can undo the update."),
      h(
        "div",
        { class: "row" },
        h("button", { class: "primary", onclick: () => (!st.edited || confirm(`Replace your changes to the ${bot.name} with version ${bot.listing.version}?\n\nYou can undo this.`)) && act("update", (r) => `The ${bot.name} is now version ${r.version}.`) }, `Update to ${bot.listing.version}`),
        h("button", { class: "plain", onclick: () => go("bot", bot.id) }, "Keep mine"),
      ),
    );
  return st.canUndo ? h("div", { class: "row" }, h("span", { class: "note small" }, `You have version ${st.installed}.`), h("button", { class: "plain small", onclick: () => act("undo-update", (r) => `The ${bot.name} is back to version ${r.version}.`) }, "Undo update")) : h("div", { class: "note small" }, `You have version ${st.installed ?? bot.listing.version}${st.edited ? ", with your own changes" : ""}.`);
}

/**
 * Before you install: what adding an agent or a team would do, in plain words, with Add and Cancel. Nothing changes
 * until the owner presses Add. Resolves true when they do.
 */
async function installPreview(kind, id) {
  const p = await api("GET", kind === "team" ? `marketplace/teams/${encodeURIComponent(id)}/preview` : `marketplace/${encodeURIComponent(id)}/preview`);
  const fresh = p.items.filter((i) => i.state === "new");
  const crew = new Map((state.market ?? []).map((b) => [b.id, b]));
  return new Promise((resolve) => {
    const done = (yes) => (dialog.close(), dialog.remove(), resolve(yes));
    const row = (i) =>
      h(
        "div",
        { class: `pvrow ${i.state}` },
        keycap(crew.get(i.id) ?? { id: i.id, title: i.title, listing: { category: i.department }, character: {} }, 36, ""),
        h(
          "div",
          { class: "grow" },
          h("div", {}, h("b", {}, i.title), h("span", { class: "note small" }, ` · ${i.department}`), i.state === "have" ? h("span", { class: "tag" }, "Already on your team: kept as it is") : null),
          h("div", { class: "note small" }, `Reports to ${i.reportsTo ? `the ${i.reportsTo}` : "you"} · up to ${i.spendPerTask != null ? money(i.spendPerTask) : "your default limit"} a task`),
          h("div", { class: "note small" }, `Can use: ${i.powers.map((x) => POWER_NAMES[x] || x).join(", ") || "only the conversation"}. ${i.asksFirst ? "Asks you before changing anything." : "Runs without asking."}`),
        ),
      );
    const dialog = h(
      "dialog",
      { class: "needs pvdialog" },
      h("h2", {}, kind === "team" ? `Add the ${p.name}?` : `Add the ${p.name} to your team?`),
      h("p", { class: "note" }, `Version ${p.version} · ${TRUST_WORDS[p.trust]} · ${p.licence} licence · free`),
      h("div", { class: "pvlist" }, p.items.map(row)),
      h(
        "p",
        { class: "pvsum" },
        fresh.length
          ? `Adds ${fresh.length} agent${fresh.length === 1 ? "" : "s"}${p.items.length > fresh.length ? `; ${p.items.length - fresh.length} you already have stay as they are` : ""}. If each new agent did one task, it would cost at most ${money(p.newSpendPerTask)}. They only work when you or another agent gives them a task.`
          : "You already have every agent in it. Adding it puts them in place on your chart; their own settings stay as they are.",
      ),
      p.wont.length ? h("div", { class: "willbox wont" }, h("div", { class: "label" }, "It will never"), h("ul", {}, p.wont.map((w) => h("li", {}, w)))) : null,
      h("div", { class: "row", style: "justify-content: flex-end" }, h("button", { class: "plain", onclick: () => done(false) }, "Cancel"), h("button", { class: "primary", onclick: () => done(true) }, fresh.length > 1 ? `Add ${fresh.length} agents` : "Add to my team")),
    );
    dialog.addEventListener("cancel", () => resolve(false));
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function addFromMarket(bot, where) {
  await attempt(async () => {
    if (!(await installPreview("agent", bot.id))) return;
    await api("POST", `marketplace/${bot.id}/add`);
    await Promise.all([loadMarket(), loadCrew(), loadOrgs()]);
    state.selectedBot = bot.id;
    remember("talqava.bot", bot.id);
    renderBody();
  }, where);
}

/** What a bot may use, and the risky things it cannot, in plain words. */
function powerWords(bot) {
  const can = bot.powers.map((p) => POWER_NAMES[p] || p);
  const risky = { web: "The web", files: "Your files", shell: "Shell commands", api: "API calls", browser: "A browser", schedule: "Schedules" };
  const cannot = Object.entries(risky).filter(([p]) => !bot.powers.includes(p)).map(([, label]) => label);
  return { can, cannot };
}

function marketCard(bot) {
  const add = bot.added
    ? h("button", { class: "madd", onclick: (e) => (e.stopPropagation(), go("bot", bot.id)) }, "Edit")
    : h("button", { class: "madd primary", onclick: (e) => (e.stopPropagation(), addFromMarket(bot, ui.body)) }, "Add");
  return h(
    "article",
    { class: "mcard", style: botStyle(bot), tabindex: "0", onclick: () => go("marketbot", bot.id), onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && go("marketbot", bot.id) },
    h("div", { class: "mhead" }, keycap(bot, 40, "", bot.type), h("div", {}, h("b", {}, bot.name), h("div", { class: "by" }, bot.listing.title.toLowerCase() === bot.name.toLowerCase() ? `by ${bot.listing.by}` : `${bot.listing.title} · by ${bot.listing.by}`))),
    h("p", { class: "mdesc" }, bot.listing.summary),
    h("div", { class: "mfoot" }, h("span", { class: "mono small muted" }, bot.install?.state === "update" ? `Update ${bot.listing.version} available` : bot.added ? "✓ On your team" : `Free · ${bot.approvals === "ask" ? "asks before changes" : "runs everything"}`), add),
  );
}

async function marketView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "market" });
  fill(ui.body, h("main", { class: "center" }, col));
  const market = await attempt(loadMarket, col);
  if (!market || state.view !== "market") return;
  const bots = market.bots;
  const categories = [...new Set(bots.map((b) => b.listing.category))].sort();
  const search = h("input", { type: "search", placeholder: "Search by agent name or what you need done", "aria-label": "Search agents", value: ui.marketSearch || "" });
  const pills = h("div", { class: "pills", role: "group", "aria-label": "Categories" });
  const results = h("div", { class: "msections" });
  const draw = () => {
    const cat = ui.marketCat || "";
    const needle = search.value.trim().toLowerCase();
    fill(
      pills,
      [["", "All"], ...categories.map((c) => [c, c]), ["+mine", "On my team"]].map(([id, label]) =>
        h("button", { class: `mpill ${cat === id ? "on" : ""}`, "aria-pressed": String(cat === id), onclick: () => ((ui.marketCat = id), draw()) }, label),
      ),
    );
    const match = (b) =>
      (!needle || `${b.name} ${b.listing.summary} ${b.listing.category} ${b.listing.will.join(" ")}`.toLowerCase().includes(needle)) &&
      (!cat || (cat === "+mine" ? b.added : b.listing.category === cat));
    const shown = bots.filter(match);
    const section = (title, list) => (list.length ? h("section", {}, h("h2", {}, title), h("div", { class: "mgrid" }, list.map(marketCard))) : null);
    const featured = !cat && !needle ? bots.filter((b) => b.listing.featured) : [];
    const byBot = new Map(bots.map((b) => [b.id, b]));
    const teams = (market.teams ?? []).filter((t) => (!cat || t.department === cat) && (!needle || `${t.name} ${t.summary}`.toLowerCase().includes(needle)) && cat !== "+mine");
    const teamCard = (t) => {
      const list = t.bots.map((id) => byBot.get(id)).filter(Boolean);
      const have = list.filter((b) => b.added).length;
      const add = h("button", { class: have === list.length ? "madd" : "madd primary", disabled: have === list.length }, have === list.length ? "✓ On your chart" : have ? `Add the other ${list.length - have}` : `Add all ${list.length}`);
      add.addEventListener("click", () =>
        attempt(async () => {
          if (!(await installPreview("team", t.id))) return;
          add.disabled = true;
          await api("POST", `marketplace/teams/${t.id}/add`);
          await Promise.all([loadCrew(), loadOrgs()]);
          go("team");
        }, ui.body),
      );
      return h(
        "article",
        { class: "mcard tcard" },
        h("div", { class: "mhead" }, h("div", {}, h("b", {}, t.name), h("div", { class: "by" }, `${list.length} agents · lead: ${list[0]?.listing.title ?? ""}`))),
        h("div", { class: "tbots" }, list.map((b) => h("button", { class: "plain", title: `${b.name}: ${b.listing.title}`, "aria-label": b.name, style: botStyle(b), onclick: () => go("marketbot", b.id) }, keycap(b, 36, "", b.type)))),
        h("p", { class: "mdesc" }, t.summary),
        h("div", { class: "mfoot" }, h("span", { class: "mono small muted" }, "Free · added with their reporting lines"), add),
      );
    };
    fill(
      results,
      featured.length
        ? h(
            "section",
            {},
            h("h2", {}, "Featured"),
            h(
              "div",
              { class: "mfeatured" },
              featured.map((b) =>
                h("button", { class: "mfeat", style: botStyle(b), onclick: () => go("marketbot", b.id) }, keycap(b, 64, "", b.type), h("b", {}, b.name), h("span", { class: "by" }, `by ${b.listing.by}`)),
              ),
            ),
          )
        : null,
      teams.length ? h("section", {}, h("h2", {}, "Teams"), h("p", { class: "note", style: "margin: -6px 0 12px" }, "A lead and the agents that report to it, added to your organization together."), h("div", { class: "mgrid wide" }, teams.map(teamCard))) : null,
      cat || needle ? section(cat === "+mine" ? "On my team" : cat || "Results", shown) : categories.map((c) => section(c, shown.filter((b) => b.listing.category === c))),
      shown.length ? null : h("p", { class: "note" }, cat === "+mine" ? "You have not added a marketplace agent yet." : "No agent matches that. Try other words, or create your own agent from the Work in progress page."),
    );
  };
  search.addEventListener("input", () => ((ui.marketSearch = search.value), draw()));
  col.append(
    h("h1", {}, "Marketplace"),
    h("p", { class: "lead" }, "Agents for every department, each built for one role. Read exactly what an agent is instructed to do before you add it to your organization."),
    market.updates ? h("div", { class: "banner" }, `${market.updates} agent${market.updates === 1 ? "" : "s"} on your team ${market.updates === 1 ? "has" : "have"} a newer version. Open ${market.updates === 1 ? "it" : "one"} to see what changed and update, or keep yours.`, " ", h("button", { class: "plain link", onclick: () => ((ui.marketCat = "+mine"), marketView()) }, "Show them")) : null,
    pills,
    search,
    ...(market.problems?.length ? [h("div", { class: "banner error small" }, market.problems.map((p) => h("div", {}, p)))] : []),
    results,
  );
  draw();
}

async function marketBotView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "market" });
  fill(ui.body, h("main", { class: "center" }, col));
  const id = state.marketId;
  const market = await attempt(loadMarket, col);
  if (!market || state.view !== "marketbot" || state.marketId !== id) return;
  const bot = market.bots.find((b) => b.id === id);
  if (!bot) return go("market");
  const { can, cannot } = powerWords(bot);
  const budget = [bot.budget?.steps && `${bot.budget.steps} steps`, bot.budget?.spend != null && money(bot.budget.spend)].filter(Boolean).join(" or ");
  const copy = h("button", {}, "Copy");
  copy.addEventListener("click", () =>
    attempt(async () => {
      await navigator.clipboard.writeText(bot.instructions);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 2000);
    }, col),
  );
  const fact = (label, value) => h("div", { class: "fact" }, h("b", {}, label), h("span", {}, value));
  const list = (title, items, cls) => (items.length ? h("div", { class: `willbox ${cls}` }, h("div", { class: "label" }, title), h("ul", {}, items.map((item) => h("li", {}, item)))) : null);
  col.append(
    h("button", { class: "plain back", onclick: () => go("market") }, "← Back to marketplace"),
    h(
      "section",
      { class: "mtop", style: botStyle(bot) },
      h(
        "div",
        { class: "grow" },
        keycap(bot, 88, "", bot.type),
        h("h1", {}, bot.name),
        h("div", { class: "by" }, `${bot.listing.title} · ${bot.listing.category} · by ${bot.listing.by}${bot.listing.reportsTo && market.bots.find((b) => b.id === bot.listing.reportsTo) ? ` · reports to the ${market.bots.find((b) => b.id === bot.listing.reportsTo).listing.title}` : ""}`),
        h("div", { class: "by" }, `Version ${bot.listing.version} · ${TRUST_WORDS[bot.listing.trust] ?? "Community"} · ${bot.listing.licence} licence`),
        updateBox(bot, col),
        h("p", { class: "lead" }, bot.listing.summary),
        h(
          "div",
          { class: "row" },
          bot.added
            ? [h("span", { class: "mpill on" }, "✓ On your team"), h("button", { class: "primary", onclick: () => chatWith(bot, col) }, `Chat with ${bot.name}`), h("button", { onclick: () => go("bot", bot.id) }, "Edit your copy"), h("button", { onclick: () => ((state.selectedBot = bot.id), remember("talqava.bot", bot.id), go("home")) }, `Assign a task to the ${bot.name}`)]
            : h("button", { class: "primary big", onclick: () => addFromMarket(bot, col) }, "Add to my team · Free"),
        ),
      ),
      h(
        "aside",
        { class: "facts", "aria-label": "At a glance" },
        fact("Price", "Free"),
        fact("Can use", can.join(", ") || "Nothing but the conversation"),
        fact("Cannot use", cannot.join(", ") || "—"),
        fact("Asks first", bot.approvals === "ask" ? "Before any change, command or API write" : "No: runs everything"),
        fact("Model", bot.model || "Your default model"),
        fact("Limit per job", budget || "Your default limits"),
      ),
    ),
    h(
      "section",
      { class: "minstr" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "Instructions"), h("span", { class: "mono small muted" }, "Shown in full · nothing hidden"), copy),
      h("div", { class: "instructions" }, bot.instructions.split(/\n+/).filter((para) => para.trim()).map((para) => h("p", {}, para.trim()))),
      h("div", { class: "willrow" }, list("✓ Will do", bot.listing.will, "will"), list("✕ Will not do", bot.listing.wont, "wont")),
      governanceBox(bot),
      h("p", { class: "note" }, bot.added ? "This agent is on your team. Your copy is yours to edit, and it never changes unless you change it." : "After you add an agent, these instructions are yours to edit. Your copy never changes unless you change it."),
    ),
  );
}

// ---------- one quest ----------
/** A plan an agent wrote before starting: waiting for the owner, being revised, or approved. */
function planCard(q, after = null) {
  const p = q?.plan;
  if (!p) return null;
  const steps = p.steps?.length ? h("ol", { class: "plansteps" }, p.steps.map((st) => h("li", {}, st.what, h("span", { class: "note small" }, ` · ${/^(you|me|myself)$/i.test(st.who) ? q.bot.name : st.who}`)))) : null;
  const estimate = p.estimate != null ? h("p", { class: "note small" }, `Its estimate to carry it out: about ${money(p.estimate)}.`) : null;
  if (p.status === "drafting") return h("div", { class: "card plancard" }, h("b", {}, "Writing its plan"), h("p", { class: "note small" }, "This is a task for a lead, so it plans first and waits for your approval before starting the work."));
  if (p.status === "changes") return h("div", { class: "card plancard" }, h("b", {}, "Revising its plan"), h("p", { class: "note small" }, `You asked: ${p.feedback}`));
  if (p.status === "approved") return h("details", { class: "card plancard" }, h("summary", {}, h("b", {}, "Approved plan"), h("span", { class: "note small" }, ` · version ${p.version}`)), h("p", {}, p.summary), steps, estimate);
  const changes = h("textarea", { rows: 2, placeholder: "What should change? For example: “Do the cafés in the north first, and keep it under $2.”", "aria-label": "Changes to the plan" });
  const decide = (decision) =>
    attempt(async () => {
      await api("POST", `quests/${q.id}/plan`, { decision, comment: changes.value });
      ui.qplanKey = null;
      if (after) after();
      else refreshQuest();
    }, ui.qnote ?? null);
  return h(
    "div",
    { class: "card plancard waiting" },
    h("div", { class: "row" }, h("b", { class: "grow" }, `Plan for your approval${p.version > 1 ? ` (version ${p.version})` : ""}`), h("span", { class: "tag" }, "Waiting on you")),
    h("p", {}, p.summary),
    steps,
    estimate,
    h("p", { class: "note small" }, "Nothing has been started or handed on yet. Approve it to let the agent carry it out, or say what should change and it will revise the plan."),
    changes,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => decide("approve") }, "Approve the plan"), h("button", { onclick: () => decide("changes") }, "Ask for changes")),
  );
}

/** What a stopped run left for whoever carries on: why, what it did and changed, and where to pick up. */
function handoverCard(q) {
  return q?.handover && !isLive(q) && q.status !== "done"
      ? h(
          "details",
          { class: "card handover", open: q.stop === "repeat" || q.stop === "failing" },
          h("summary", {}, h("b", {}, "Hand-over note"), h("span", { class: "note small" }, ` · stopped ${when(q.handover.at)}: ${q.handover.why}`)),
          q.handover.did.length ? [h("div", { class: "label" }, "What it did last"), h("ul", {}, q.handover.did.map((d) => h("li", {}, d)))] : null,
          q.handover.changed.length ? [h("div", { class: "label" }, "What it changed"), h("ul", {}, q.handover.changed.map((c) => h("li", {}, c)))] : null,
          q.handover.lastWords ? [h("div", { class: "label" }, "What it last said"), h("p", { class: "handwords" }, q.handover.lastWords)] : null,
          h("p", {}, h("b", {}, "Next: "), q.handover.next),
          h("p", { class: "note small" }, "Say “continue” below, or press Try again on the task, and it picks up from this note."),
        )
      : null;
}

const BOARD_WORDS = { finding: "Finding", decision: "Decision", question: "Question", blocker: "Blocker", handover: "Hand-over", note: "Note" };

/**
 * The shared board of the task tree this run belongs to: what the agents on it have posted, and a box for the owner
 * to post too. The box is made once, so a refresh of the list never wipes what is being typed.
 */
function taskBoard() {
  const list = h("div", { class: "boardlist" });
  const text = h("textarea", { rows: 2, placeholder: "Post a note every agent on this task will see, e.g. “Use the November export in the Finance folder.”", "aria-label": "Note for the board" });
  const kind = h("select", { "aria-label": "Kind of note" }, ["note", "decision", "question", "finding"].map((k) => h("option", { value: k }, BOARD_WORDS[k])));
  const form = h(
    "form",
    {
      class: "row boardform",
      onsubmit: (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        attempt(async () => {
          await api("POST", `quests/${state.convId}/board`, { kind: kind.value, text: text.value });
          text.value = "";
          refreshQuest();
        }, ui.qboard);
      },
    },
    kind,
    text,
    h("button", { class: "small" }, "Post"),
  );
  const box = h("details", { class: "card taskboard" }, h("summary", {}, h("b", {}, "Task board"), h("span", { class: "note small count" })), list, form);
  return {
    node: box,
    show(posts = []) {
      box.querySelector(".count").textContent = posts.length ? ` · ${posts.length} note${posts.length === 1 ? "" : "s"} from everyone on this task` : " · empty so far: agents post findings, decisions, questions and blockers here";
      if (posts.some((p) => p.kind === "blocker" || p.kind === "question") && !box.dataset.seen) (box.open = true), (box.dataset.seen = "1");
      fill(
        list,
        posts.length
          ? posts.map((p) => h("div", { class: `boardpost ${p.kind}` }, h("span", { class: "tag" }, BOARD_WORDS[p.kind] ?? p.kind), h("div", { class: "grow" }, h("div", {}, p.text), h("div", { class: "note small" }, `${p.authorName} · ${when(p.at)}`))))
          : h("p", { class: "note small" }, "Nothing yet."),
      );
    },
  };
}

function questView() {
  ui.body.className = "body questview";
  ui.qhead = h("div", { class: "subhead" });
  ui.qsteps = h("aside", { class: "side" });
  ui.qcenter = h("main", { class: "center flush" });
  ui.qright = h("aside", { class: "logcol" });
  fill(ui.body, ui.qhead, h("div", { class: "questcols" }, ui.qsteps, ui.qcenter, ui.qright));

  ui.tab = null;
  ui.tabs = h("div", { class: "tabs", role: "tablist" });
  ui.changesPanel = h("div", { class: "tabpanel pad", hidden: true });
  ui.receiptPanel = h("div", { class: "tabpanel pad", hidden: true });
  ui.convoPanel = h("div", { class: "tabpanel" }, conversationPane());
  ui.qnote = h("div", { class: "qnote" });
  ui.qplanKey = null;
  ui.qboardView = taskBoard();
  ui.qboard = h("div", { class: "qnote" }, ui.qboardView.node);
  fill(ui.qcenter, ui.tabs, ui.qnote, ui.qboard, ui.changesPanel, ui.receiptPanel, ui.convoPanel);
  ui.title = h("span");
  ui.meta = h("span", { class: "meta" });
  ui.changesFor = null;
  setRunning(false);
  connect(state.convId);
  refreshQuest(true);
}

async function refreshQuest(first = false) {
  const id = state.convId;
  let q;
  try {
    q = await api("GET", `quests/${id}`);
  } catch {
    go("home");
    return;
  }
  if (state.view !== "quest" || state.convId !== id) return;
  const changed = !state.quest || state.quest.id !== q.id || state.quest.status !== q.status || state.quest.outcome !== q.outcome;
  state.quest = q;
  // The plan card is drawn again only when the plan changes, so a refresh never wipes what the owner is typing in it.
  const planKey = q.plan ? `${q.plan.status}:${q.plan.version}:${q.handover?.at ?? ""}` : "";
  if (ui.qnote && (planKey !== ui.qplanKey || !q.plan)) (fill(ui.qnote, planCard(q), handoverCard(q)), (ui.qplanKey = planKey));
  ui.qboardView?.show(q.board);
  const [label, tone] = standing(q);
  const where = q.branch ? ["on branch ", h("code", {}, q.branch), " · your own branch is untouched"] : q.project ? [`in ${basename(q.project)}`] : ["in the workspace folder"];
  fill(ui.qhead, 
    h("button", { onclick: () => go("home") }, "Back to agents"),
    keycap(q.bot, 40, mood(q), q.bot.type),
    h(
      "div",
      { class: "titles" },
      h("h1", {}, q.title),
      h("div", { class: "sub" }, `${q.bot.name}${roleOf(q.bot.id) ? `, ${roleOf(q.bot.id).title}` : (q.bot.title && q.bot.title !== q.bot.name ? `, ${q.bot.title}` : "")} · `, ...where, q.parent ? [" · assigned by ", h("button", { class: "plain link", onclick: () => go(q.parent.isQuest ? "quest" : "chat", q.parent.id) }, q.parent.by)] : null),
    ),
    ui.meta,
    h("span", { class: `pill solid ${tone}` }, label),
    h(
      "button",
      {
        class: "plain danger",
        title: "Delete this task",
        onclick: () =>
          confirm(q.branch && !q.outcome ? "Delete this task and undo its changes?" : "Delete this task from the log?") &&
          attempt(async () => {
            await api("DELETE", `quests/${q.id}`);
            await loadQuests();
            go("home");
          }),
      },
      "Delete",
    ),
  );
  renderQuestRight(q);
  renderTabs(q, first || changed);
  const conversation = await api("GET", `conversations/${id}`).catch(() => null);
  if (conversation && state.convId === id) renderSteps(q, conversation);
}

function renderTabs(q, pickDefault) {
  // A finished code quest opens on its changes, and stays there after they are kept or undone.
  const reviewable = q.branch && !isLive(q);
  const tabs = [...(q.branch ? [["changes", "Changes"]] : []), ["conversation", "Conversation"], ["receipt", "Receipt"]];
  // Opened from a "Receipt" button, the task starts on its receipt.
  if (state.openReceipt === q.id) ((ui.tab = "receipt"), (state.openReceipt = null), (pickDefault = false));
  if (pickDefault || !tabs.some(([key]) => key === ui.tab)) ui.tab = reviewable ? "changes" : "conversation";
  const show = (key, focus = false) => {
    ui.tab = key;
    ui.changesPanel.hidden = key !== "changes";
    ui.convoPanel.hidden = key !== "conversation";
    ui.receiptPanel.hidden = key !== "receipt";
    if (key === "receipt") renderReceipt(q);
    for (const b of ui.tabs.children) b.classList.toggle("on", b.dataset.key === key);
    if (key === "changes") renderChanges(q);
    if (key === "conversation" && focus) ui.input?.focus();
  };
  fill(ui.tabs, ...tabs.map(([key, label]) => h("button", { role: "tab", "data-key": key, onclick: () => show(key, true) }, label)));
  show(ui.tab);
}

async function renderChanges(q) {
  const panel = ui.changesPanel;
  const stamp = `${q.id}:${q.status}:${q.outcome}`;
  if (ui.changesFor === stamp) return;
  ui.changesFor = stamp;
  if (q.outcome === "accepted") {
    fill(panel, h("div", { class: "decide" }, h("b", {}, "Changes kept."), h("p", { class: "note" }, `They are one commit on ${q.branch}. To bring them into your branch, run: git merge ${q.branch}`)));
    return;
  }
  if (q.outcome) {
    fill(panel, h("div", { class: "decide" }, h("b", {}, q.outcome === "undone" ? "Task undone." : "The task changed nothing."), h("p", { class: "note" }, "Its branch and working copy were removed.")));
    return;
  }
  if (isLive(q)) {
    fill(panel, h("p", { class: "note" }, "You can review the changes when the task stops. Its work so far is in the Conversation tab."));
    return;
  }
  const changes = await attempt(() => api("GET", `quests/${q.id}/changes`), panel);
  if (!changes || state.quest?.id !== q.id) return;
  const files = splitDiff(changes.diff);
  const tab = ui.tabs.querySelector('[data-key="changes"]');
  if (tab) tab.textContent = `Changes · ${changes.files.length} file${changes.files.length === 1 ? "" : "s"}`;
  fill(panel, 
    ...(changes.files.length
      ? changes.files.map((f) => {
          const body = files.get(f.path) ?? [];
          const isNew = body.some((line) => line.startsWith("new file"));
          return h(
            "section",
            { class: "filediff" },
            h("div", { class: "fhead" }, h("span", { class: "grow" }, f.path), isNew ? h("span", { class: "muted" }, "new file") : null, h("span", { class: "plus" }, `+${f.added}`), h("span", { class: "minus" }, `−${f.removed}`)),
            h(
              "pre",
              {},
              body
                .filter((line) => !/^(diff --git|index |new file|deleted file|--- |\+\+\+ )/.test(line))
                .map((line) => h("span", { class: line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : "" }, line || " ")),
            ),
          );
        })
      : [h("p", { class: "note" }, "The task changed no files.")]),
    changes.truncated ? h("p", { class: "note" }, "Some of the changes are too long to show here.") : null,
    h(
      "div",
      { class: "decide" },
      h("div", {}, h("b", {}, changes.files.length ? "Ready for your review. " : "Nothing to keep. "), h("span", { class: "muted" }, "Keeping makes one commit on the task's branch; your current branch stays as it is.")),
      h(
        "div",
        { class: "row" },
        changes.files.length ? h("button", { class: "primary", onclick: () => attempt(async () => (await api("POST", `quests/${q.id}/accept`), afterDecision()), panel) }, "Keep the changes") : null,
        changes.files.length ? h("button", { onclick: () => (renderTabs(q, false), ui.tabs.querySelector('[data-key="conversation"]').click(), (ui.input.placeholder = `Tell ${q.bot.name} what to change…`)) }, "Ask for changes") : null,
        h(
          "button",
          { class: "danger", onclick: () => confirm("Throw away everything this task changed?") && attempt(async () => (await api("POST", `quests/${q.id}/undo`), afterDecision()), panel) },
          changes.files.length ? "Undo whole task" : "Close the branch",
        ),
      ),
    ),
  );
}

async function afterDecision() {
  ui.changesFor = null;
  await loadQuests();
  await refreshQuest(true);
}

/** The diff of each file, keyed by its path. */
function splitDiff(diff) {
  const files = new Map();
  let current = null;
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) files.set(head[2], (current = []));
    if (current) current.push(line);
  }
  return files;
}

function renderSteps(q, conversation) {
  const results = new Map();
  for (const m of conversation.messages) {
    if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);
  }
  const steps = [];
  for (const m of conversation.messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_use" && b.type !== "server_tool_use") continue;
      const result = results.get(b.id);
      const mark = b.type === "server_tool_use" ? "ok" : result ? (result.is_error ? "bad" : "ok") : q.status === "waiting" ? "wait" : isLive(q) ? "now" : "bad";
      steps.push([mark, NAMES[b.name] || b.name, summarize(b.name, b.input)]);
    }
  }
  const mark = (kind) => h("span", { class: `mark ${kind === "ok" ? "" : kind}` }, kind === "ok" ? "✓" : kind === "bad" ? "✗" : "");
  const end = q.status === "waiting" ? ["wait", "Waiting for your approval"] : isLive(q) ? ["now", "Working"] : q.branch && !q.outcome ? ["wait", "Waiting for your review"] : null;
  const powers = q.bot.powers ?? [];
  const missing = ["web", "files", "shell", "api"].filter((p) => !powers.includes(p));
  fill(ui.qsteps, 
    h("h2", { class: "label" }, "Steps"),
    h(
      "ul",
      { class: "steps" },
      steps.length ? steps.map(([kind, name, what]) => h("li", {}, mark(kind), h("span", {}, `${name} `, what ? h("code", {}, what.length > 60 ? `${what.slice(0, 60)}…` : what) : null))) : h("li", { class: "muted" }, "No tools used yet."),
      end ? h("li", {}, mark(end[0]), h("span", {}, end[1])) : null,
    ),
    h("h2", { class: "label" }, "Safety"),
    h(
      "p",
      { class: "note" },
      q.branch
        ? `Works on its own branch and copy of ${basename(q.project)}, started from your last commit. Undo removes every trace.`
        : "Works in the workspace folder. Shell commands and file changes ask first unless the agent runs everything.",
    ),
    h("p", { class: "note" }, `Powers: ${powers.map((p) => (POWER_NAMES[p] || p).toLowerCase()).join(", ") || "none"}.${missing.length ? ` No ${missing.map((p) => ({ web: "web", files: "files", shell: "shell", api: "API calls" })[p]).join(", no ")}.` : ""}`),
    q.readOutside ? h("p", { class: "note" }, "It has read outside content, so every change asks first.") : null,
    q.resumedAt ? h("p", { class: "note" }, `Picked up again after the app restarted, ${when(q.resumedAt)}.`) : null,
  );
}

/** The step budget as a row of ticks, one per step (grouped when there are many). */
function stepTicks(used, total) {
  if (!total) return null;
  const per = Math.ceil(total / 60);
  const count = Math.ceil(total / per);
  const filled = Math.min(count, Math.ceil(used / per));
  return h("div", { class: "ticks", role: "img", "aria-label": `${used} of ${total} steps used` }, Array.from({ length: count }, (_, i) => h("span", { class: i < filled ? "on" : "" })));
}

/** The quest's check: each item passed or failed, with what was found. */
function checkBlock(q) {
  if (!q.template) return null;
  const handOver =
    q.check && !q.check.passed && !q.checking && !isLive(q) && !q.outcome && q.model?.kind !== "anthropic"
      ? h(
          "button",
          { class: "primary", onclick: () => attempt(async () => (await api("POST", `quests/${q.id}/escalate`, {}), await loadQuests(), refreshQuest(true)), ui.qright) },
          "Hand to Claude",
        )
      : null;
  return h(
    "section",
    { class: "panel-block" },
    h("h2", { class: "label" }, "Check"),
    q.checking
      ? h("p", { class: "mono small" }, "◌ Checking the result…")
      : q.check
        ? h(
            "ul",
            { class: "checks-list" },
            q.check.items.map((item) => h("li", {}, h("span", { class: "mark" }, item.passed ? "✓" : "✕"), h("span", {}, item.label, item.detail && !item.passed ? h("pre", {}, item.detail) : null))),
          )
        : h("p", { class: "note" }, isLive(q) ? "Runs when the agent says it is done. A failed check goes back to the agent to fix." : "Not checked."),
    q.template.tries ? h("p", { class: "note" }, `Sent back to fix ${q.template.tries} time${q.template.tries === 1 ? "" : "s"} (up to ${q.template.maxTries}).`) : null,
    q.handedTo ? h("p", { class: "note" }, `Handed to ${q.handedTo}.`) : null,
    handOver ? [h("p", { class: "note" }, "The check still fails. A stronger model can pick up where this one stopped."), handOver] : null,
  );
}

/** Why a task exists, from the top: the mission, the group's goal, the owner's task, and each hand-off down to this one. */
function whyChain(q) {
  const steps = q.why ?? [];
  if (steps.length <= 1) return null;
  return h(
    "ol",
    { class: "whychain", "aria-label": "Why this task exists" },
    steps.map((st) =>
      h(
        "li",
        { class: `why-${st.kind} ${st.id === q.id ? "here" : ""}` },
        h("span", { class: "whykind" }, st.kind === "mission" ? "Mission" : st.kind === "goal" ? `${st.who} purpose` : st.kind === "objective" ? "Goal" : st.kind === "project" ? "Project" : st.id === q.id ? (st.by ? `This task · ${st.who}` : `Your task · ${st.who}`) : st.by ? `Handed to ${st.who}` : `You asked ${st.who}`),
        st.kind === "task" && st.id !== q.id ? h("a", { href: "#", onclick: (e) => (e.preventDefault(), go("quest", st.id)) }, st.text) : h("span", {}, st.text),
      ),
    ),
  );
}

/** Saves a finished task's report as a page in the workspace, under a page the owner picks. */
async function fileAsPage(q, where) {
  const ws = await api("GET", "workspace").catch(() => ({ tree: [] }));
  const parent = h("select", { "aria-label": "Put it under" }, h("option", { value: "" }, "At the top of the workspace"), ws.tree.map((p) => h("option", { value: p.id }, p.title)));
  const title = h("input", { value: q.title, maxlength: 120, "aria-label": "Page title" });
  const got = await libDialog("Save the report as a page", h("div", { class: "composeform" }, h("label", {}, "Title", title), h("label", {}, "Put it under", parent), h("p", { class: "note small" }, "The page is linked to this task. You can edit it afterwards like any other page.")), [["Save as a page", () => ({ title: title.value.trim(), parent: parent.value }), true]]);
  if (!got) return;
  await attempt(async () => {
    const page = await api("POST", `quests/${q.id}/file`, got);
    openPage(page.id);
  }, where);
}

function renderQuestRight(q) {
  const spend = q.budget?.spend;
  const share = spend ? Math.min(1, (q.cost || 0) / spend) : q.budget?.steps ? Math.min(1, q.steps / q.budget.steps) : 0;
  const bot = state.crew?.bots.find((b) => b.id === q.bot.id);
  fill(ui.qright,
    q.why?.length > 1 ? h("section", { class: "panel-block" }, h("h2", { class: "label" }, "Why"), whyChain(q)) : null,
    !isLive(q) && q.said ? h("section", { class: "panel-block" }, h("h2", { class: "label" }, "Workspace"), h("p", { class: "note" }, "Keep this report where your agents can find it next time."), h("button", { class: "small", onclick: (e) => fileAsPage(q, e.currentTarget.parentElement) }, "Save the report as a page")) : null,
    checkBlock(q),
    h(
      "section",
      { class: "panel-block" },
      h("h2", { class: "label" }, "Budget"),
      stepTicks(q.steps, q.budget?.steps),
      h("div", { class: "mono small" }, `${money(q.cost || 0)}${spend ? ` of ${money(spend)}` : ""} · ${q.steps} of ${q.budget?.steps ?? "?"} steps`),
      h("p", { class: "note" }, `${q.bot.name} stops and asks when either runs out.`),
    ),
    h(
      "section",
      { class: "panel-block" },
      h("h2", { class: "label" }, "Model"),
      h("div", {}, q.model?.label || "Default model"),
      h("p", { class: "note" }, q.model?.kind === "anthropic" ? "Claude, on your key." : q.model?.free ? "Free, on this computer." : q.model?.kind ? "On your key with this provider." : ""),
    ),
    h(
      "section",
      { class: "panel-block" },
      h("h2", { class: "label" }, q.bot.name),
      h("div", { class: "mono small muted" }, roleLine(q.bot, roleOf(q.bot.id)?.title)),
      h("p", { class: "note" }, q.bot.source === "project" ? "From the repository's .crew/ folder." : q.bot.source === "personal" ? "Your own agent." : "A standard agent."),
      bot ? h("button", { onclick: () => go("bot", bot.id) }, `Edit ${q.bot.name}`) : null,
    ),
  );
}

// ---------- the receipt: what was done, what was not, and what each agent cost ----------
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const KINDS = { task: "Your task", handoff: "Handed on", question: "Question", decision: "Decision" };
const STATUS_WORDS = { done: "Finished", failed: "Failed", budget: "Out of budget", stopped: "Stopped", running: "Working", waiting: "Waiting" };

function receiptText(r) {
  const out = [`RECEIPT: ${r.title}`, `${new Date(r.startedAt).toLocaleString()}${r.endedAt ? ` to ${new Date(r.endedAt).toLocaleString()}` : " (still under way)"}`, `Total ${money(r.total)} of a ${money(r.budget)} budget · ${r.lines.length} parts · ${r.actions} actions · ${r.failedActions} did not work`, ...(r.saved >= 0.001 ? [`Saved about ${money(r.saved)} by shortening old outputs`] : []), "", "COST BY AGENT"];
  for (const a of r.byAgent) out.push(`  ${a.agent}: ${money(a.cost)} · ${a.tasks} part${a.tasks === 1 ? "" : "s"} · ${a.actions} actions · ${tokens(a.input)} read, ${tokens(a.output)} written`);
  out.push("", "NOT DONE");
  if (r.total > r.budget) out.push(`  The task cost ${money(r.total)}, over its ${money(r.budget)} budget.`);
  if (!r.notDone.length && !r.failedActions) out.push("  Nothing: every part finished.");
  for (const n of r.notDone) out.push(`  ${n.agent}: ${n.title.slice(0, 90)} - ${n.why}`);
  out.push("", "EVERY PART");
  for (const l of r.lines) {
    out.push(`  ${l.agent} · ${KINDS[l.kind] || l.kind}${l.from ? ` from ${l.from}` : ""} · ${STATUS_WORDS[l.status] || l.status} · ${money(l.cost)} · ${l.model}`, `    ${l.title.replace(/\s+/g, " ").slice(0, 160)}`);
    for (const a of l.actions) out.push(`    ${a.ok ? "done    " : "NOT DONE"} ${NAMES[a.name] || a.name}: ${String(summarize(a.name, a.input)).replace(/\s+/g, " ").slice(0, 140)}${a.error ? ` (${a.error.replace(/\s+/g, " ").slice(0, 140)})` : ""}`);
  }
  return out.join("\n");
}

async function renderReceipt(q) {
  const panel = ui.receiptPanel;
  if (!panel) return;
  let r;
  try {
    r = await api("GET", `quests/${q.id}/receipt`);
  } catch (err) {
    return fill(panel, h("p", { class: "note" }, `The receipt could not be loaded: ${err.message}`));
  }
  if (!r || state.convId !== q.id) return;
  const open = new Set([...panel.querySelectorAll("details[open]")].map((d) => d.dataset.id));
  const most = Math.max(...r.byAgent.map((a) => a.cost), 0.000001);
  // Not done: parts that did not finish, single actions that did not work, and going over the budget.
  const undone = [
    ...(r.total > r.budget ? [{ agent: "Budget", title: `The task cost ${money(r.total)}, over its ${money(r.budget)} budget.`, why: "" }] : []),
    ...r.notDone,
    ...r.lines.flatMap((l) => l.actions.filter((a) => !a.ok).map((a) => ({ agent: l.agent, title: `${NAMES[a.name] || a.name}: ${String(summarize(a.name, a.input))}`, why: a.error }))),
  ];
  const copy = h("button", { class: "small", onclick: () => navigator.clipboard?.writeText(receiptText(r)).then(() => ((copy.textContent = "Copied"), setTimeout(() => (copy.textContent = "Copy receipt"), 1500))) }, "Copy receipt");
  const save = h("button", { class: "small", onclick: () => {
    const a = h("a", { href: URL.createObjectURL(new Blob([receiptText(r)], { type: "text/plain" })), download: `receipt-${r.id}.txt` });
    a.click();
    URL.revokeObjectURL(a.href);
  } }, "Save as a file");
  fill(
    panel,
    h(
      "div",
      { class: "receipt" },
      h("div", { class: "rhead" }, h("div", { class: "grow" }, h("div", { class: "label" }, "Receipt"), h("h2", {}, r.title), h("div", { class: "note small" }, `${new Date(r.startedAt).toLocaleString()}${r.endedAt ? ` to ${new Date(r.endedAt).toLocaleTimeString()}` : " · still under way"}`)), copy, save),
      h(
        "div",
        { class: "rtotals" },
        h("div", {}, h("span", {}, "Total cost"), h("b", {}, money(r.total)), h("i", {}, `of a ${money(r.budget)} budget`)),
        h("div", {}, h("span", {}, "Parts"), h("b", {}, String(r.lines.length)), h("i", {}, `${r.lines.filter((l) => l.status === "done").length} finished`)),
        h("div", {}, h("span", {}, "Actions taken"), h("b", {}, String(r.actions)), h("i", { class: r.failedActions ? "bad" : "" }, r.failedActions ? `${r.failedActions} did not work` : "all worked")),
        h("div", {}, h("span", {}, "Reading and writing"), h("b", {}, tokens(r.input + r.output)), h("i", {}, `tokens: ${tokens(r.input)} read, ${tokens(r.output)} written`)),
      ),
      r.cached || r.saved >= 0.001
        ? h("p", { class: "note small" }, [r.cached && r.input ? `${Math.round((r.cached / r.input) * 100)}% of what the agents read came from the AI service's cache, at about a tenth of the price.` : "", r.saved >= 0.001 ? `Shortening large outputs the agents had already used saved about ${money(r.saved)}.` : ""].filter(Boolean).join(" "))
        : null,
      h("h3", {}, "Cost by agent"),
      h(
        "div",
        { class: "ragents" },
        r.byAgent.map((a) =>
          h(
            "div",
            { class: "ragent" },
            keycap(a, 26, "", a.type),
            h("div", { class: "grow" }, h("div", { class: "rname" }, h("b", {}, a.agent), h("span", {}, `${a.tasks} part${a.tasks === 1 ? "" : "s"} · ${a.actions} action${a.actions === 1 ? "" : "s"}${a.failed ? ` · ${a.failed} did not work` : ""} · ${tokens(a.input + a.output)} tokens`)), h("div", { class: "rbar" }, h("i", { style: `width:${Math.max(2, (a.cost / most) * 100)}%` }))),
            h("div", { class: "rcost" }, h("b", {}, money(a.cost)), h("span", {}, r.total ? `${Math.round((a.cost / r.total) * 100)}%` : "")),
          ),
        ),
      ),
      h("h3", {}, `What was not done · ${undone.length}`),
      undone.length
        ? h("div", { class: "rnot" }, undone.map((n) => h("div", { class: "rnotrow" }, h("b", {}, n.agent), h("span", { class: "grow" }, n.title.replace(/\s+/g, " ").slice(0, 110)), h("em", {}, n.why))))
        : h("p", { class: "note" }, "Nothing was left undone: every part finished and left a report."),
      h("h3", {}, "Every part, in order"),
      h("p", { class: "note small" }, "Open a part to see each action the agent took and whether it worked."),
      r.lines.map((l) =>
        h(
          "details",
          { class: `rline ${l.notDone ? "bad" : ""}`, "data-id": l.id, open: open.has(l.id) || undefined },
          h(
            "summary",
            {},
            keycap(l, 22, "", l.type),
            h("div", { class: "grow" }, h("div", { class: "rname" }, h("b", {}, l.agent), h("span", {}, `${KINDS[l.kind] || l.kind}${l.from ? ` from ${l.from}` : ""} · ${STATUS_WORDS[l.status] || l.status} · ${l.actions.length} action${l.actions.length === 1 ? "" : "s"} · ${l.model}`)), h("div", { class: "rtitle" }, l.title.replace(/\s+/g, " "))),
            h("div", { class: "rcost" }, h("b", {}, money(l.cost)), h("span", {}, `${tokens(l.input + l.output)} tokens`)),
          ),
          h(
            "div",
            { class: "rbody" },
            l.notDone ? h("div", { class: "rwhy" }, l.notDone) : null,
            l.actions.length
              ? h("ol", { class: "racts" }, l.actions.map((a) => h("li", { class: a.ok ? "" : "bad" }, h("span", { class: "rmark" }, a.ok ? "Done" : "Not done"), h("b", {}, NAMES[a.name] || a.name), h("span", { class: "grow" }, String(summarize(a.name, a.input)).replace(/\s+/g, " ").slice(0, 200)), a.error ? h("em", {}, a.error.replace(/\s+/g, " ")) : null)))
              : h("p", { class: "note small" }, "No actions: the agent only wrote its answer."),
            l.pages?.length ? h("div", { class: "rpages" }, h("span", { class: "label" }, "Workspace pages"), l.pages.map((p) => h("button", { class: "plain small", onclick: () => openPage(p.page) }, `${p.title} (${p.how.map((x) => ({ read: "read", found: "found", changed: "changed", suggested: "suggested a change", filed: "saved here" })[x] ?? x).join(", ")})`))) : null,
            l.said ? h("div", { class: "rsaid" }, h("span", { class: "label" }, "Its report"), l.said) : null,
            l.id !== q.id ? h("button", { class: "plain small", onclick: () => go("quest", l.id) }, "Open this part →") : null,
          ),
        ),
      ),
      h("p", { class: "note small" }, "Costs are estimated from each model's list price, the same way as everywhere else in the app."),
    ),
  );
}

// ---------- a bot ----------
function botView() {
  ui.body.className = "body questview";
  const isNew = state.botId === "new";
  const existing = state.crew?.bots.find((b) => b.id === state.botId);
  if (!isNew && !existing) return go("home");
  const draft = structuredClone(
    existing ?? {
      id: "",
      name: "",
      type: "scout",
      title: "",
      group: "",
      character: { legend: "", texture: "dots", color: "green" },
      instructions: "",
      model: undefined,
      powers: ["web", "memory"],
      approvals: "ask",
      budget: { steps: state.config.budget.steps, spend: state.config.budget.spend },
      source: "personal",
    },
  );
  const fileNote =
    isNew || existing.source === "personal"
      ? `${state.config.dataDir}/crew/${isNew ? "<name>" : existing.id}.yaml`
      : `Saving makes your own copy in ${state.config.dataDir}/crew/${existing.id}.yaml; the ${existing.source === "project" ? "repository's" : "starter"} file stays as it is.`;
  const save = h("button", { class: "primary" }, "Save");
  const head = h(
    "div",
    { class: "subhead" },
    h("button", { onclick: () => go("home") }, "Back to agents"),
    h("div", { class: "titles" }, h("h1", {}, isNew ? "Create an agent" : `Edit ${existing.name}`), h("div", { class: "sub mono" }, fileNote)),
    !isNew && existing.source === "personal"
      ? h(
          "button",
          {
            class: "plain danger",
            onclick: () =>
              confirm(`Remove your version of ${existing.name}? The standard agent of the same name comes back.`) &&
              attempt(async () => {
                await api("DELETE", `crew/${existing.id}`);
                await loadCrew();
                go("home");
              }, head),
          },
          "Remove my version",
        )
      : null,
    save,
  );

  // ----- portrait -----
  const portrait = h("aside", { class: "portrait" });
  // An agent with no initials yet gets them from its title or name as it is typed.
  const initialsOf = (text) => String(text).trim().split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w) && !/^(of|the|and|for)$/i.test(w)).map((w) => w[0].toUpperCase()).slice(0, 3).join("");
  let ownLegend = Boolean(draft.character.legend) && !isNew;
  if (!draft.character.legend) draft.character.legend = isNew ? "?" : legendOf(draft.character, draft.type);
  const autoLegend = () => {
    if (ownLegend) return;
    const made = initialsOf(draft.title || draft.name);
    if (made) (draft.character.legend = made), (legendInput.value = made);
  };
  const legendInput = h("input", {
    id: "legend",
    value: draft.character.legend,
    maxlength: 6,
    autocomplete: "off",
    style: "text-align: center; font-weight: 600; font-size: 16px; max-width: 120px",
    oninput: (e) => {
      const chars = [...e.target.value.replace(/\s/g, "")].slice(0, 3).join("");
      if (chars) {
        ownLegend = true;
        draft.character.legend = chars;
        drawPortrait();
      }
    },
  });
  const drawPortrait = () => {
    const auto = tileOf({ ...draft, character: { ...draft.character, symbol: undefined, tint: undefined } });
    const chosenSymbol = SYMBOLS[draft.character.symbol] ? draft.character.symbol : "auto";
    const chosenTint = TINTS[draft.character.tint] ? draft.character.tint : "auto";
    const pick = (key, value) => ((draft.character[key] = value === "auto" ? undefined : value), drawPortrait());
    fill(portrait,
      keycap(draft, 150, ""),
      h("h2", {}, draft.name || "New agent"),
      h("div", { class: "type" }, roleLine({ name: draft.name, group: draft.group }, draft.title) || "Role not set"),
      h("p", { class: "label", style: "margin-top: 22px" }, `Symbol · ${chosenSymbol === "auto" ? `Automatic (${SYMBOLS[auto.symbol][0]})` : SYMBOLS[chosenSymbol][0]}`),
      h(
        "div",
        { class: "lookrow", role: "group", "aria-label": "Symbol" },
        ["auto", ...Object.keys(SYMBOLS)].map((key) =>
          h(
            "button",
            { type: "button", class: `look ${chosenSymbol === key ? "on" : ""}`, title: key === "auto" ? "Automatic, from the role" : SYMBOLS[key][0], "aria-label": key === "auto" ? "Automatic" : SYMBOLS[key][0], "aria-pressed": String(chosenSymbol === key), onclick: () => pick("symbol", key) },
            keycap({ ...draft, character: { ...draft.character, symbol: key === "auto" ? auto.symbol : key } }, 30, ""),
          ),
        ),
      ),
      h("p", { class: "label", style: "margin-top: 14px" }, `Colour · ${chosenTint === "auto" ? `Its department's (${TINTS[auto.tint][0]})` : TINTS[chosenTint][0]}`),
      h(
        "div",
        { class: "swatches", role: "group", "aria-label": "Colour" },
        ["auto", ...Object.keys(TINTS)].map((key) =>
          h("button", {
            type: "button",
            class: `swatch ${chosenTint === key ? "on" : ""}`,
            title: key === "auto" ? "Its department's colour" : TINTS[key][0],
            "aria-label": key === "auto" ? "Its department's colour" : TINTS[key][0],
            "aria-pressed": String(chosenTint === key),
            style: `--swatch: ${TINTS[key === "auto" ? auto.tint : key][1]}${key === "auto" ? "; outline: 1px dashed var(--soft); outline-offset: 2px" : ""}`,
            onclick: () => pick("tint", key),
          }),
        ),
      ),
      h("p", { class: "note small" }, "The colour shows the agent's department. Green, amber and red are kept for what the agent is doing: working, waiting on you, or stuck."),
      h("label", { class: "label", for: "legend", style: "display: block; margin-top: 22px" }, "Initials"),
      legendInput,
      h("p", { class: "note small" }, "One to three characters, such as HS for Head of Sales. They show on the tile when it uses the Initials symbol, and in short lists."),
    );
  };
  drawPortrait();

  // ----- job -----
  const name = h("input", { value: draft.name, placeholder: "e.g. Head of Partnerships", maxlength: 40, oninput: (e) => ((draft.name = e.target.value), autoLegend(), drawPortrait()) });
  const title = h("input", { value: draft.title && draft.title !== cap(draft.type) ? draft.title : "", placeholder: "e.g. Head of Partnerships", maxlength: 50, oninput: (e) => ((draft.title = e.target.value), autoLegend(), drawPortrait()) });
  const types = ["scout", "scribe", "maker", "keeper", "counter", "spark"];
  const TYPE_WORDS = { scout: "Research and analysis", scribe: "Writing and communications", maker: "Software engineering", keeper: "Operations and oversight", counter: "Numbers and data", spark: "Strategy and planning" };
  const type = h(
    "select",
    {
      onchange: (e) => {
        draft.type = e.target.value;
        drawPortrait();
      },
    },
    [...new Set([...types, draft.type])].map((t) => h("option", { value: t, selected: t === draft.type }, TYPE_WORDS[t] ?? cap(t))),
  );
  const instructions = h("textarea", { rows: 7, placeholder: "What this role is responsible for and how it works. Plain sentences work best." }, draft.instructions);

  // ----- model -----
  const providers = state.config.providers;
  const current = draft.model;
  const useDefault = h("input", { type: "radio", name: "model", checked: !current });
  const useOwn = h("input", { type: "radio", name: "model", checked: Boolean(current) });
  const slash = current ? current.indexOf("/") : -1;
  const provider = h(
    "select",
    { onfocus: () => (useOwn.checked = true) },
    providers.map((p) => h("option", { value: p.id, selected: current ? current.slice(0, slash) === p.id : p.id !== "anthropic" }, p.name)),
  );
  const modelName = h("input", { value: current ? current.slice(slash + 1) : "", list: "bot-models", placeholder: "Model name, e.g. qwen3:8b or claude-sonnet-5-5", onfocus: () => (useOwn.checked = true) });
  const botModels = h("datalist", { id: "bot-models" });
  const listModels = () => api("GET", `providers/${encodeURIComponent(provider.value)}/models`).then((r) => fill(botModels, r.models.map((m) => h("option", { value: m })))).catch(() => {});
  provider.addEventListener("change", listModels);
  listModels();
  const checks = h("div");
  const showCheck = () => {
    const ref = useOwn.checked ? `${provider.value}/${modelName.value.trim()}` : state.config.model;
    const result = state.config.modelChecks?.[ref];
    fill(checks, 
      result
        ? h(
            "div",
            { class: "checks" },
            h("b", {}, "Model check"),
            [
              [result.instructions, "Follows instructions"],
              [result.tools, "Uses tools"],
              [result.multiStep, "Chains several steps"],
            ].map(([ok, label]) => h("div", {}, h("span", { class: ok ? "yes" : "no" }, ok ? "✓ " : "! "), label)),
            h("div", { class: "muted" }, result.recommended.includes(cap(draft.type)) ? `Suitable for ${(TYPE_WORDS[draft.type] ?? "this kind of work").toLowerCase()}.` : `Not recommended for ${(TYPE_WORDS[draft.type] ?? "this kind of work").toLowerCase()}. Suitable for: ${result.recommended.map((r) => (TYPE_WORDS[r.toLowerCase()] ?? r).toLowerCase()).join(", ")}.`),
          )
        : h("p", { class: "note" }, "This model has not been checked yet. Check it under Settings."),
    );
  };
  for (const el of [provider, modelName, useDefault, useOwn]) el.addEventListener("change", showCheck);
  showCheck();

  // ----- powers -----
  const powerBoxes = Object.keys(POWER_NAMES).map((p) => [p, h("input", { type: "checkbox", checked: draft.powers.includes(p) })]);

  // ----- limits -----
  const approvals = h(
    "select",
    {},
    h("option", { value: "ask", selected: draft.approvals !== "auto" }, "Ask before any change (default)"),
    h("option", { value: "auto", selected: draft.approvals === "auto" }, "Run everything without asking"),
  );
  const spend = h("input", { type: "number", min: 0, max: 100, step: 0.05, value: draft.budget?.spend ?? "" });
  const steps = h("input", { type: "number", min: 1, max: 500, step: 1, value: draft.budget?.steps ?? "" });

  const group = h("input", { value: draft.group || "", placeholder: "e.g. Sales", maxlength: 30, list: "team-groups", autocomplete: "off", oninput: (e) => ((draft.group = e.target.value), drawPortrait()) });
  const groupList = h("datalist", { id: "team-groups" }, [...new Set((state.crew?.bots ?? []).map((b) => b.group))].map((g) => h("option", { value: g })));
  const monthly = h("input", { type: "number", min: 0, max: 10000, step: 0.5, value: draft.monthly ?? "", placeholder: "No limit" });
  save.addEventListener("click", () =>
    attempt(async () => {
      const body = {
        group: group.value.trim(),
        ...(monthly.value !== "" ? { monthly: Number(monthly.value) } : {}),
        name: name.value.trim(),
        title: title.value.trim() || name.value.trim(),
        type: type.value,
        character: draft.character,
        instructions: instructions.value.trim(),
        model: useOwn.checked && modelName.value.trim() ? `${provider.value}/${modelName.value.trim()}` : "default",
        powers: powerBoxes.filter(([, box]) => box.checked).map(([p]) => p),
        approvals: approvals.value,
        budget: { ...(steps.value ? { steps: Number(steps.value) } : {}), ...(spend.value !== "" ? { spend: Number(spend.value) } : {}) },
      };
      const saved = await api("PUT", `crew/${isNew ? "new" : existing.id}`, body);
      await loadCrew();
      state.selectedBot = saved.id;
      remember("talqava.bot", saved.id);
      go("home");
    }, head),
  );

  fill(ui.body, 
    head,
    h(
      "div",
      { class: "editor" },
      portrait,
      h(
        "div",
        { class: "editcards" },
        h("section", { class: "card" }, h("h3", {}, "Role"), h("label", { class: "field" }, "Name", name), h("label", { class: "field" }, "Job title", title), h("label", { class: "field" }, "Department", group, groupList), h("label", { class: "field" }, "Kind of work", type), h("label", { class: "field" }, "Instructions", instructions)),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Model"),
          h("label", { class: "choice" }, useDefault, h("span", {}, h("b", {}, "Default model"), h("div", { class: "note" }, `The one chosen in Settings: ${state.config.model}`))),
          h("label", { class: "choice" }, useOwn, h("span", { class: "grow" }, h("b", {}, "A model of its own"), h("div", { class: "form" }, provider, modelName, botModels))),
          checks,
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Powers"),
          powerBoxes.map(([p, box]) => h("label", { class: "power" }, box, POWER_NAMES[p])),
          h("p", { class: "note" }, "An agent only gets the tools its powers grant. Changes ask first by default, and always after reading the web."),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Limits"),
          h("label", { class: "field" }, "Approvals", approvals),
          h("div", { class: "row" }, h("label", { class: "field grow" }, "Budget per task ($)", spend), h("label", { class: "field grow" }, "Steps per task", steps)),
          h("div", { class: "row" }, h("label", { class: "field grow" }, "Budget per month ($)", monthly)),
          h("p", { class: "note small" }, existing?.month ? `Spent this month: ${money(existing.month.spent)}. At its monthly budget an agent starts no new work until you raise it or the month turns.` : "At its monthly budget an agent starts no new work until you raise it or the month turns."),
        ),
      ),
    ),
  );
  if (isNew) name.focus();
}

// ---------- chats ----------
function conversationPane() {
  ui.log = h("div", { class: "col" });
  ui.scroll = h("div", { class: "scroll" }, ui.log);
  ui.input = h("textarea", { rows: 1, placeholder: `Message ${speaker()}…` });
  ui.send = h("button", { class: "primary" }, "Send");
  ui.cards = new Map();
  ui.stream = null;
  ui.working = null;
  ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  ui.input.addEventListener("input", () => {
    ui.input.style.height = "auto";
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 240)}px`;
  });
  ui.send.addEventListener("click", () => (state.running ? attempt(() => api("POST", `conversations/${state.convId}/stop`)) : submit()));
  state.running = false;
  return h("div", { class: "convo" }, ui.scroll, h("div", { class: "compose" }, h("div", { class: "col" }, ui.input, ui.send)));
}

function chatView() {
  ui.body.className = "body two";
  ui.chatSide = h("aside", { class: "side" });
  const withBot = chatBotOf();
  ui.title = h("h1", {}, "New chat");
  ui.meta = h("span", { class: "meta" });
  ui.remove = h("button", { class: "plain danger", title: "Delete this chat", onclick: deleteChat, hidden: !state.convId }, "Delete");
  // An open chat shows the space it belongs to, wherever it was opened from.
  const open = state.convs.find((c) => c.id === state.convId);
  if (open && (open.space || "") !== state.space) setSpace(open.space);
  ui.move = moveChatPicker();
  ui.pin = h("button", { class: "plain", hidden: true, onclick: () => pinChat({ id: state.convId }, !state.convs.find((c) => c.id === state.convId)?.pinned) }, "Pin");
  syncPin();
  const pane = conversationPane();
  fill(ui.body, ui.chatSide, h("main", { class: "center flush" }, h("div", { class: "chathead", style: withBot ? botStyle(withBot) : "" }, withBot ? keycap(withBot, 28, "", withBot.type) : null, ui.title, withBot ? h("span", { class: "small muted", title: "This chat is with one agent, in its role. It uses that agent's instructions, powers, model and limits." }, roleLine(withBot, roleOf(withBot.id)?.title)) : null, ui.meta, ui.move, withBot ? null : modelPicker(), ui.pin, ui.remove), pane));
  renderChatList();
  setRunning(false);
  if (state.convId) connect(state.convId);
  else {
    const ideas = ["Summarize the news on a topic I care about", "Help me write an email", "Explain something step by step", "Find and compare options for me"];
    ui.log.append(
      h(
        "div",
        { class: "empty hero" },
        heroVideo(),
        h("h2", {}, `Hello. I'm ${state.config.agentName}.`),
        h("p", {}, "Ask me anything. I can search the web, work with files and remember what matters to you. Pick any AI model at the top right."),
        state.space
          ? h("p", { class: "note" }, `This chat is in ${spaceName(state.space)}. I use ${spaceName(state.space)}'s memory along with your general memory, and what I learn here stays in ${spaceName(state.space)}.`)
          : null,
        h(
          "div",
          { class: "ideas" },
          ideas.map((idea) => h("button", { onclick: () => ((ui.input.value = `${idea}: `), ui.input.focus()) }, idea)),
        ),
        h("p", { class: "note small" }, "Want a task done in the background? ", h("button", { class: "plain link", onclick: () => go("home") }, "Assign an agent"), " instead."),
      ),
    );
  }
  ui.input.focus();
}

/**
 * Choose the AI model right where you chat. Lists Claude's models and every
 * model the other providers (Ollama, LM Studio and so on) say they have.
 */
function modelPicker() {
  const c = state.config;
  const pick = h("select", { class: "modelpick", "aria-label": "AI model", title: "The AI model that answers" });
  const label = (ref) => {
    const slash = ref.indexOf("/");
    const provider = c.providers.find((p) => p.id === ref.slice(0, slash));
    const name = ref.slice(slash + 1);
    if (provider?.kind === "anthropic") return `Claude · ${c.models.find((m) => m.id === name)?.label || name}`;
    return `${provider?.name || ref.slice(0, slash)} · ${name}`;
  };
  const show = (refs) => {
    const all = [...new Set([c.model, ...refs])];
    fill(
      pick,
      all.map((ref) => h("option", { value: ref, selected: ref === c.model }, label(ref))),
      h("option", { value: "" }, "Add or set up models…"),
    );
  };
  show([]);
  Promise.all(
    c.providers.map(async (p) => {
      if (p.kind === "anthropic") return c.hasApiKey ? c.models.map((m) => `${p.id}/${m.id}`) : [];
      const listed = await api("GET", `providers/${encodeURIComponent(p.id)}/models`).catch(() => ({ models: [] }));
      return listed.models.map((m) => `${p.id}/${m}`);
    }),
  ).then((lists) => pick.isConnected && show(lists.flat()));
  pick.addEventListener("change", () => {
    if (!pick.value) return (ui.integration = "ai-models"), go("integrations");
    attempt(async () => {
      state.config = await api("PUT", "settings", { model: pick.value });
    });
  });
  return pick;
}

/** Moves the open chat to another space. Hidden until the chat exists. */
function moveChatPicker() {
  const pick = h(
    "select",
    { class: "modelpick", "aria-label": "Project of this chat", title: "The project this chat belongs to. Choose another to move it.", hidden: !state.convId || !state.spaces.length },
    h("option", { value: "", selected: !state.space }, "In General"),
    state.spaces.map((sp) => h("option", { value: sp.id, selected: sp.id === state.space }, `In ${sp.name}`)),
  );
  pick.addEventListener("change", () =>
    attempt(async () => {
      await api("PATCH", `conversations/${state.convId}`, { space: pick.value || null });
      setSpace(pick.value);
      await refreshList();
      renderChatList();
    }),
  );
  return pick;
}

/** The project picker at the top of the chat list, with a button to add one. Chats and memory are shown per project. */
function spacePicker() {
  if (ui.addingSpace) {
    const name = h("input", { placeholder: "Name, e.g. a client or a piece of work", maxlength: 40, "aria-label": "Name of the new project" });
    const cancel = () => ((ui.addingSpace = false), renderChatList(true));
    const form = h(
      "form",
      {
        class: "spaceform",
        onsubmit: (e) => {
          e.preventDefault();
          attempt(async () => {
            const made = await api("POST", "spaces", { name: name.value });
            ui.addingSpace = false;
            await loadSpaces();
            setSpace(made.id);
            go("chat");
          }, form);
        },
      },
      h("span", { class: "sidelabel" }, "New project"),
      name,
      h("p", { class: "note small" }, "A project keeps its own chats and memory, apart from the rest."),
      h("div", { class: "row" }, h("button", { class: "primary" }, "Create project"), h("button", { type: "button", onclick: cancel }, "Cancel")),
    );
    setTimeout(() => name.focus(), 0);
    return form;
  }
  const pick = h(
    "select",
    { "aria-label": "Project", title: "A project keeps its own chats and memory, apart from the rest." },
    h("option", { value: "", selected: !state.space }, "General"),
    state.spaces.map((sp) => h("option", { value: sp.id, selected: sp.id === state.space }, sp.name)),
    state.spaces.length ? h("option", { value: "+manage" }, "Manage projects…") : null,
  );
  pick.addEventListener("change", () => {
    if (pick.value === "+manage") return go("memory");
    setSpace(pick.value);
    go("chat");
  });
  return h(
    "div",
    { class: "projects" },
    h("label", { class: "sidelabel" }, "Project", pick),
    h("button", { class: "newproject", onclick: () => ((ui.addingSpace = true), renderChatList(true)) }, "＋ New project"),
  );
}

/** Pins or unpins a chat. Pinned chats stay at the top of their project's list. */
async function pinChat(c, pinned) {
  await attempt(async () => {
    await api("PATCH", `conversations/${c.id}`, { pinned });
    await refreshList();
    renderChatList(true);
    if (c.id === state.convId) syncPin();
  }, ui.chatSide);
}

/** Deletes a chat from the list, whichever chat is open. */
async function deleteChatFromList(c) {
  if (!confirm(`Delete the chat “${c.title}”? This cannot be undone.`)) return;
  await attempt(async () => {
    await api("DELETE", `conversations/${c.id}`);
    await refreshList();
    if (c.id === state.convId) go("chat");
    else renderChatList(true);
  }, ui.chatSide);
}

/** The pin button in the open chat's header says what a click will do. */
function syncPin() {
  if (!ui.pin) return;
  const open = state.convs.find((c) => c.id === state.convId);
  ui.pin.hidden = !state.convId;
  ui.pin.textContent = open?.pinned ? "Unpin" : "Pin";
  ui.pin.title = open?.pinned ? "Stop keeping this chat at the top of the list" : "Keep this chat at the top of the list";
}

function renderChatList(force = false) {
  if (!ui.chatSide || state.view !== "chat") return;
  if (!force && ui.chatSide.contains(document.activeElement) && document.activeElement.matches("input, select")) return; // not while the person is choosing or typing
  const here = state.convs.filter((c) => (c.space || "") === state.space);
  const row = (c) =>
    h(
      "div",
      { class: `chatrow ${c.id === state.convId ? "on" : ""} ${c.pinned ? "pinned" : ""}` },
      h(
        "button",
        { class: `navlink ${c.id === state.convId ? "on" : ""}`, title: c.title, onclick: () => go("chat", c.id) },
        c.pinned ? h("span", { class: "pinmark", "aria-hidden": "true" }, "★") : null,
        chatBotOf(c.id) ? keycap(chatBotOf(c.id), 18, "", chatBotOf(c.id).type) : null,
        h("span", { class: "title" }, c.title),
        c.needsApproval ? h("i", { class: "dot wait", title: "Waiting for your approval" }) : c.running ? h("i", { class: "dot", title: "Working" }) : null,
      ),
      h(
        "span",
        { class: "chatactions" },
        h("button", { class: "plain", title: c.pinned ? "Unpin" : "Pin to the top", "aria-label": `${c.pinned ? "Unpin" : "Pin"} ${c.title}`, onclick: () => pinChat(c, !c.pinned) }, c.pinned ? "★" : "☆"),
        h("button", { class: "plain", title: "Delete chat", "aria-label": `Delete ${c.title}`, onclick: () => deleteChatFromList(c) }, "✕"),
      ),
    );
  const pinned = here.filter((c) => c.pinned);
  const rest = here.filter((c) => !c.pinned);
  fill(ui.chatSide, 
    spacePicker(),
    h("button", { class: "primary", onclick: () => go("chat") }, "New chat"),
    h(
      "div",
      { class: "chatlist" },
      pinned.length ? [h("div", { class: "listlabel" }, "Pinned"), ...pinned.map(row), rest.length ? h("div", { class: "listlabel" }, "Chats") : null] : null,
      rest.map(row),
      here.length ? null : h("p", { class: "note small", style: "padding: 0 8px" }, state.space ? `No chats in ${spaceName(state.space)} yet.` : "No chats yet."),
      ((tasks) =>
        tasks.length
          ? [
              h("div", { class: "listlabel" }, "Team tasks"),
              tasks.map((q) =>
                h(
                  "div",
                  { class: "chatrow" },
                  h("button", { class: "navlink", title: `${q.bot.name}: ${q.title}`, onclick: () => go("quest", q.id) }, keycap(q.bot, 18, "", q.bot.type), h("span", { class: "title" }, q.title), q.approvals?.length ? h("i", { class: "dot wait", title: "Waiting for your approval" }) : isLive(q) ? h("i", { class: "dot", title: "Working" }) : String(q.updatedAt) > seenUpdates() ? h("i", { class: "dot new", title: "New result" }) : null),
                ),
              ),
            ]
          : null)(ownTasks().slice(0, 8)),
    ),
    navFooter("chat"),
  );
}

async function submit() {
  const text = ui.input.value.trim();
  if (!text || state.running) return;
  await attempt(async () => {
    if (!state.convId) {
      const conv = await api("POST", "conversations", state.space ? { space: state.space } : {});
      state.convId = conv.id;
      if (ui.remove) ui.remove.hidden = false;
      if (ui.move) ui.move.hidden = !state.spaces.length;
      fill(ui.log, );
      connect(conv.id);
      await new Promise((resolve) => state.source.addEventListener("open", resolve, { once: true }));
    }
    await api("POST", `conversations/${state.convId}/messages`, { text });
    ui.input.value = "";
    ui.input.style.height = "auto";
    refreshList().then(() => (renderChatList(), syncPin()));
  });
}

async function deleteChat() {
  if (!confirm("Delete this chat? This cannot be undone.")) return;
  await attempt(async () => {
    await api("DELETE", `conversations/${state.convId}`);
    await refreshList();
    go("chat");
  });
}

function connect(id) {
  state.source?.close();
  state.source = new EventSource(`/api/conversations/${id}/events`);
  state.source.onmessage = (e) => {
    if (state.convId === id && ui.log) onEvent(JSON.parse(e.data));
  };
}

/** Who is talking in the open conversation: the quest's bot, or the agent. */
/** The bot a chat is with, when it is a chat with one bot in its role. */
const chatBotOf = (id = state.convId) => {
  const botId = state.convs.find((c) => c.id === id)?.bot;
  return botId ? (state.crew?.bots ?? []).find((b) => b.id === botId) : undefined;
};
const speaker = () => (state.view === "quest" ? (state.quests.find((q) => q.id === state.convId)?.bot.name ?? "the agent") : (chatBotOf()?.name ?? state.config.agentName));

/** Opens a chat with one bot, in its role. */
async function chatWith(bot, where) {
  await attempt(async () => {
    const conv = await api("POST", "conversations", { bot: bot.id, ...(state.space ? { space: state.space } : {}) });
    await refreshList();
    go("chat", conv.id);
  }, where);
}

// ---------- pages ----------
function page(title, intro, ...children) {
  ui.body.className = "body two";
  ui.log = null;
  const col = h("div", { class: "col page" }, h("h1", {}, title), h("p", { class: "lead" }, intro), ...children);
  ui.body.className = "body";
  fill(ui.body, h("main", { class: "center" }, col));
  return col;
}

// ---------- memory ----------
/** Everything remembered, one space at a time: add, edit, move and forget entries, and manage the spaces. */
async function memoryView() {
  if (ui.memSpace === undefined || !["", ...state.spaces.map((s) => s.id)].includes(ui.memSpace)) ui.memSpace = state.space;
  const at = ui.memSpace;
  const name = spaceName(at);
  const again = () => memoryView();
  const col = page(
    "Memory",
    `What ${state.config.agentName} remembers between chats. It adds to this on its own, and tells you in the chat when it does. General memory goes into every chat; a project's memory goes only into that project's chats.`,
  );
  const entries = await attempt(() => api("GET", "memory"), col);
  if (!entries || state.view !== "memory") return;
  const count = (id) => entries.filter((m) => (m.space || "") === id).length;

  // ----- which space -----
  const newName = h("input", { placeholder: "Name, e.g. a client or a piece of work", maxlength: 40, "aria-label": "Name of the new project" });
  const newForm = h(
    "form",
    {
      class: "row spaceadd",
      hidden: true,
      onsubmit: (e) => {
        e.preventDefault();
        attempt(async () => {
          const made = await api("POST", "spaces", { name: newName.value });
          await loadSpaces();
          ui.memSpace = made.id;
          again();
        }, col);
      },
    },
    newName,
    h("button", { class: "primary" }, "Add project"),
  );
  col.append(
    h(
      "div",
      { class: "spacetabs", role: "tablist", "aria-label": "Projects" },
      [{ id: "", name: "General" }, ...state.spaces].map((sp) =>
        h("button", { role: "tab", class: sp.id === at ? "on" : "", "aria-selected": String(sp.id === at), onclick: () => ((ui.memSpace = sp.id), again()) }, sp.name, h("span", { class: "count" }, String(count(sp.id)))),
      ),
      h("button", { class: "plain", onclick: () => ((newForm.hidden = !newForm.hidden), newName.focus()) }, "＋ New project"),
    ),
    newForm,
  );
  if (at) {
    const rename = h("input", { value: name, maxlength: 40, "aria-label": "Project name" });
    const renameForm = h(
      "form",
      {
        class: "row spaceadd",
        hidden: true,
        onsubmit: (e) => {
          e.preventDefault();
          attempt(async () => {
            await api("PATCH", `spaces/${at}`, { name: rename.value });
            await loadSpaces();
            again();
          }, col);
        },
      },
      rename,
      h("button", { class: "primary" }, "Save name"),
    );
    col.append(
      h(
        "div",
        { class: "row" },
        h("span", { class: "note grow" }, `Used only in chats in ${name}, together with General memory.`),
        h("button", { class: "plain", onclick: () => ((renameForm.hidden = !renameForm.hidden), rename.focus()) }, "Rename"),
        h(
          "button",
          {
            class: "plain danger",
            onclick: () =>
              confirm(`Delete the project “${name}”? Its ${count(at)} ${count(at) === 1 ? "memory is" : "memories are"} deleted for good, and its chats move to General.`) &&
              attempt(async () => {
                await api("DELETE", `spaces/${at}`);
                await Promise.all([loadSpaces(), refreshList()]);
                ui.memSpace = "";
                again();
              }, col),
          },
          "Delete project",
        ),
      ),
      renameForm,
    );
  } else {
    col.append(h("p", { class: "note" }, state.spaces.length ? "Carried into every chat, in every project." : "Carried into every chat. Add a project to keep one client's or piece of work's memory and chats apart."));
  }

  // ----- add -----
  const input = h("textarea", { rows: 2, placeholder: at ? `Something to remember about ${name}` : "Something to remember, e.g. “I write mystery novels under a pen name.”" });
  col.append(
    h(
      "form",
      {
        class: "form",
        onsubmit: (e) => {
          e.preventDefault();
          attempt(async () => {
            await api("POST", "memory", { text: input.value, space: at || undefined });
            again();
          }, col);
        },
      },
      input,
      h("div", {}, h("button", { class: "primary" }, at ? `Remember this in ${name}` : "Remember this")),
    ),
  );

  // ----- the entries -----
  const mine = entries.filter((m) => (m.space || "") === at).reverse(); // newest first
  const list = h("div");
  const filter = h("input", { type: "search", placeholder: `Find in ${name}'s memory`, "aria-label": "Find in memory", hidden: mine.length < 8 });
  const draw = () => {
    const needle = filter.value.trim().toLowerCase();
    const shown = needle ? mine.filter((m) => m.text.toLowerCase().includes(needle)) : mine;
    fill(list, shown.length ? shown.map(card) : h("p", { class: "note" }, mine.length ? "Nothing matches." : at ? `Nothing remembered in ${name} yet.` : "Nothing remembered yet."));
  };
  const card = (m) => {
    const text = h("div", { class: "grow" }, h("div", { class: "mtext" }, m.text), h("div", { class: "note" }, m.updatedAt ? `${when(m.createdAt)} · edited ${when(m.updatedAt)}` : when(m.createdAt)));
    const move = h(
      "select",
      { class: "modelpick", "aria-label": "Move to another project", title: "Move to another project", hidden: !state.spaces.length },
      h("option", { value: at, selected: true }, "Move to…"),
      [{ id: "", name: "General" }, ...state.spaces].filter((sp) => sp.id !== at).map((sp) => h("option", { value: sp.id }, sp.name)),
    );
    move.addEventListener("change", () => attempt(async () => (await api("PATCH", `memory/${m.id}`, { space: move.value || null }), again()), col));
    const row = h(
      "div",
      { class: "row" },
      text,
      h("button", { class: "plain", onclick: () => edit() }, "Edit"),
      move,
      h("button", { class: "plain danger", onclick: () => attempt(async () => (await api("DELETE", `memory/${m.id}`), again()), col) }, "Forget"),
    );
    const node = h("div", { class: "card" }, row);
    const edit = () => {
      const box = h("textarea", { rows: 3 });
      box.value = m.text;
      fill(
        node,
        h(
          "form",
          { class: "form", onsubmit: (e) => (e.preventDefault(), attempt(async () => (await api("PATCH", `memory/${m.id}`, { text: box.value }), again()), col)) },
          box,
          h("div", { class: "row" }, h("button", { class: "primary" }, "Save"), h("button", { type: "button", onclick: () => fill(node, row) }, "Cancel")),
        ),
      );
      box.focus();
    };
    return node;
  };
  filter.addEventListener("input", draw);
  col.append(filter, list);
  draw();
}

// ---------- skills ----------
async function skillsView() {
  const col = page("Skills", `Procedures ${state.config.agentName} has written down for itself after working out how to do something, so it can repeat it.`);
  const skills = await attempt(() => api("GET", "skills"), col);
  if (!skills) return;
  if (!skills.length) col.append(h("p", { class: "note" }, "No skills yet. Ask the agent to “save that as a skill” after a task you'll want again."));
  for (const s of skills) {
    col.append(
      h(
        "details",
        { class: "tool" },
        h("summary", {}, h("span", { class: "name" }, s.name), h("span", { class: "what" }, s.description)),
        h(
          "div",
          { class: "body" },
          h("pre", {}, s.content),
          h("button", { class: "danger", onclick: () => confirm(`Delete the skill “${s.name}”?`) && attempt(async () => (await api("DELETE", `skills/${encodeURIComponent(s.name)}`), skillsView()), col) }, "Delete"),
        ),
      ),
    );
  }
}

// ---------- schedules ----------
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A plain way to say when something runs: every day, weekday, week, month, every few minutes or
 * hours, or once. It writes the schedule the app understands; "Custom" takes one typed by hand.
 */
function whenPicker(initial = "0 9 * * 1-5") {
  const kind = h("select", { "aria-label": "How often" }, [
    ["daily", "Every day"],
    ["weekdays", "Every weekday (Monday to Friday)"],
    ["weekly", "Every week"],
    ["monthly", "Every month"],
    ["hours", "Every few hours"],
    ["minutes", "Every few minutes"],
    ["once", "Once"],
    ["custom", "Custom (advanced)"],
  ].map(([v, l]) => h("option", { value: v }, l)));
  const time = h("input", { type: "time", value: "09:00", "aria-label": "Time" });
  // Monday first, as a working week reads.
  const day = h("select", { "aria-label": "Day of the week" }, [1, 2, 3, 4, 5, 6, 0].map((i) => h("option", { value: i }, WEEKDAYS[i])));
  const nth = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  // Days 1 to 28, which every month has.
  const date = h("select", { "aria-label": "Day of the month" }, Array.from({ length: 28 }, (_, i) => h("option", { value: i + 1 }, nth(i + 1))));
  const count = h("input", { type: "number", min: 1, max: 59, value: 2, "aria-label": "How many", style: "width: 80px" });
  const once = h("input", { type: "datetime-local", "aria-label": "Date and time" });
  const custom = h("input", { placeholder: "e.g. every 30m, at 2027-01-15T09:00, or 0 9 * * 1-5", "aria-label": "Custom schedule", class: "mono" });
  const words = (t) => h("span", { class: "note" }, t);
  const row = h("div", { class: "row wrap whenrow" });
  const hm = () => {
    const [hh, mm] = (time.value || "09:00").split(":").map(Number);
    return [mm, hh];
  };
  const draw = () => {
    const k = kind.value;
    fill(
      row,
      kind,
      k === "weekly" ? [words("on"), day] : null,
      k === "monthly" ? [words("on the"), date] : null,
      ["daily", "weekdays", "weekly", "monthly"].includes(k) ? [words("at"), time] : null,
      k === "hours" ? [words("every"), count, words("hours")] : null,
      k === "minutes" ? [words("every"), count, words("minutes")] : null,
      k === "once" ? [words("on"), once] : null,
      k === "custom" ? custom : null,
    );
    count.max = k === "hours" ? 23 : 59;
  };
  kind.addEventListener("change", draw);
  // Opens on what the schedule already is, when it is one of these.
  const t = String(initial).trim();
  let m;
  if ((m = /^every\s+(\d+)\s*(m|h)\w*$/i.exec(t))) (kind.value = m[2].toLowerCase() === "h" ? "hours" : "minutes"), (count.value = m[1]);
  else if ((m = /^every\s+1\s*d\w*$/i.exec(t))) kind.value = "daily";
  else if ((m = /^at\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/i.exec(t))) (kind.value = "once"), (once.value = m[1]);
  else if ((m = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|1-5|[0-7])$/.exec(t)) && Number(m[3] === "*" ? 1 : m[3]) <= 28) {
    time.value = `${String(m[2]).padStart(2, "0")}:${String(m[1]).padStart(2, "0")}`;
    if (m[3] !== "*" && m[4] === "*") (kind.value = "monthly"), (date.value = m[3]);
    else if (m[3] === "*" && m[4] === "*") kind.value = "daily";
    else if (m[3] === "*" && m[4] === "1-5") kind.value = "weekdays";
    else if (m[3] === "*") (kind.value = "weekly"), (day.value = String(Number(m[4]) % 7));
    else (kind.value = "custom"), (custom.value = t);
  } else if (t) (kind.value = "custom"), (custom.value = t);
  draw();
  return {
    node: row,
    value() {
      const [mm, hh] = hm();
      const n = Math.max(1, Math.round(Number(count.value) || 1));
      switch (kind.value) {
        case "daily": return `${mm} ${hh} * * *`;
        case "weekdays": return `${mm} ${hh} * * 1-5`;
        case "weekly": return `${mm} ${hh} * * ${day.value}`;
        case "monthly": return `${mm} ${hh} ${date.value} * *`;
        case "hours": return `every ${n}h`;
        case "minutes": return `every ${n}m`;
        case "once": return once.value ? `at ${once.value}` : "";
        default: return custom.value.trim();
      }
    },
  };
}

/** Who does a schedule: the Talqava assistant, or an agent on the chart (each run is then a task in its queue). */
function whoPicker(current = "") {
  const org = activeOrg();
  return h(
    "select",
    { "aria-label": "Who does it" },
    h("option", { value: "" }, `${state.config.agentName} (the assistant), in a chat`),
    org.members.length ? h("optgroup", { label: `Agents in ${org.name}: a task in their queue` }, org.members.map((m) => h("option", { value: m.bot, selected: m.bot === current }, `${m.title} · ${m.department}`))) : null,
  );
}

/** Adds a schedule, or changes one. */
function scheduleForm(col, job = null, done) {
  const name = h("input", { placeholder: "e.g. Morning news digest", value: job?.name ?? "", maxlength: 80 });
  const when = whenPicker(job?.schedule ?? "0 9 * * 1-5");
  const who = whoPicker(job?.owner ?? "");
  const prompt = h("textarea", { rows: 4, placeholder: "What should be done each time? Write it as you would to a new colleague, e.g. “Read the news about our industry and send me the five things that matter, with links.”" }, job?.prompt ?? "");
  return h(
    "form",
    {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        const body = { name: name.value, schedule: when.value(), prompt: prompt.value, owner: who.value || null };
        attempt(async () => (await api(job ? "PATCH" : "POST", job ? `jobs/${job.id}` : "jobs", body), done()), col);
      },
    },
    h("label", {}, "Name", name),
    h("label", {}, "When", when.node),
    h("label", {}, "Who does it", who),
    h("label", {}, "Instructions", prompt),
    h("div", { class: "row" }, job ? h("button", { type: "button", class: "plain", onclick: done }, "Cancel") : null, h("button", { class: "primary" }, job ? "Save changes" : "Add schedule")),
  );
}

async function jobsView() {
  const list = h("div", { class: "joblist" });
  const col = page(
    "Schedules",
    "Work that runs by itself: a daily summary, a weekly report, a monthly check. Choose when, and who does it. You can also just ask in a chat: “every weekday at 8am, …”.",
    h("p", { class: "banner" }, "Schedules run while Talqava is open. In the Mac app, closing the window keeps Talqava running; choosing Quit stops it. A run missed while it was stopped happens once when you open Talqava again."),
    list,
    h("h3", {}, "New schedule"),
  );
  col.append(scheduleForm(col, null, () => jobsView()));
  const jobs = await attempt(() => api("GET", "jobs"), col);
  if (!jobs) return;
  if (!jobs.length) list.append(h("p", { class: "note" }, "No schedules yet. Add one below."));
  for (const j of jobs) {
    const act = (fn) => attempt(async () => (await fn(), jobsView()), col);
    const card = h("div", { class: "card jobcard" });
    const show = () =>
      fill(
        card,
        h(
          "div",
          { class: "row" },
          h(
            "div",
            { class: "grow" },
            h("strong", {}, j.name),
            h("div", { class: "note" }, `${j.plain} · ${j.enabled ? `next ${when(j.nextRunAt)}` : "paused"}${j.lastRunAt ? ` · last ran ${when(j.lastRunAt)}` : ""}`),
            h("div", { class: "note" }, j.owner ? (j.ownerName ? `Done by the ${j.ownerName}, as a task in their queue` : "Its agent is no longer on the chart, so the assistant does it. Edit it to choose another agent.") : `Done by ${state.config.agentName}, the assistant, in a chat`),
            h("div", { class: "jobprompt" }, j.prompt),
          ),
          h(
            "div",
            { class: "row wrap jobactions" },
            j.lastTaskId ? h("button", { class: "small", onclick: () => ((ui.taskOpen = j.lastTaskId), go("tasks")) }, "Last run") : j.lastConversationId ? h("button", { class: "small", onclick: () => go("chat", j.lastConversationId) }, "Last run") : null,
            h(
              "button",
              {
                class: "small",
                onclick: () =>
                  attempt(async () => {
                    const r = await api("POST", `jobs/${j.id}/run`, {});
                    if (r.taskId) (ui.taskOpen = r.taskId), go("tasks");
                    else go("chat", r.conversationId);
                  }, col),
              },
              "Run now",
            ),
            h("button", { class: "small", onclick: () => fill(card, h("h4", {}, `Change “${j.name}”`), scheduleForm(col, j, () => jobsView())) }, "Edit"),
            h("button", { class: "small", onclick: () => act(() => api("PATCH", `jobs/${j.id}`, { enabled: !j.enabled })) }, j.enabled ? "Pause" : "Resume"),
            h("button", { class: "small danger", onclick: () => confirm(`Delete the schedule “${j.name}”?\n\nPast runs are kept.`) && act(() => api("DELETE", `jobs/${j.id}`)) }, "Delete"),
          ),
        ),
      );
    show();
    list.append(card);
  }
}

// ---------- settings ----------
/**
 * AI models: every AI service Talqava can use, in one place. Pick a service, paste its key,
 * and Talqava checks it and finds the service's models. Connected services can be used by
 * the whole team or one agent, and backups take over when a service is down.
 */
function aiModelsSection(col) {
  const box = h("div", { class: "aimodels" }, h("p", { class: "note" }, "Loading the AI services…"));
  col.append(box);
  let g = null;
  const refresh = async () => {
    g = await api("GET", "gateway").catch(() => null);
    state.config = await api("GET", "state").catch(() => state.config);
    if (box.isConnected) draw();
  };
  const short = (url) => (url ? url.replace(/^https?:\/\//, "").replace(/\/v1$/, "") : "");
  const keyLink = (s) => (s.keyUrl ? h("a", { href: s.keyUrl, target: "_blank", rel: "noopener" }, s.keyUrl.replace(/^https:\/\//, "")) : null);
  const modelName = (ref) => {
    const at = ref.indexOf("/");
    const p = g?.connected.find((c) => c.id === ref.slice(0, at));
    return `${ref.slice(at + 1)}${p ? ` · ${p.name}` : ""}`;
  };

  const draw = () => {
    if (!g) return fill(box, h("p", { class: "note" }, "The list of AI services could not be loaded."));
    const live = g.connected.filter((c) => !c.standard);
    const connectedIds = new Set(live.map((c) => c.service));
    const findButton = h("button", { class: "small" }, "Find models on this computer");
    findButton.addEventListener("click", () =>
      attempt(async () => {
        findButton.disabled = true;
        findButton.textContent = "Looking…";
        const { found } = await api("POST", "gateway/find-local");
        toast(found.length ? `Connected ${found.map((f) => `${f.name} (${f.models} model${f.models === 1 ? "" : "s"})`).join(", ")}.` : "No model runner is running on this computer. Install Ollama or LM Studio, download a model, then look again.");
        await refresh();
      }, col).finally(() => ((findButton.disabled = false), (findButton.textContent = "Find models on this computer"))),
    );

    fill(
      box,
      // What is connected now.
      h(
        "div",
        { class: "aiconnected" },
        live.length
          ? live.map((c) =>
              h(
                "div",
                { class: "aiconn" },
                h(
                  "div",
                  { class: "grow" },
                  h("strong", {}, c.name),
                  c.inUse ? h("span", { class: "tag ok" }, "Your team's model") : null,
                  // A model program on this computer is checked now: it may have been closed, or have no models yet.
                  c.live
                    ? h(
                        "div",
                        { class: `note small ${c.live.running && c.live.models ? "" : "warnline"}` },
                        !c.live.running ? `Not running right now. Start ${c.name} to use it.` : c.live.models ? `Running · ${c.live.models} model${c.live.models === 1 ? "" : "s"} on this computer` : `Running, but no models downloaded yet. Download one in ${c.name}, then press Models.`,
                      )
                    : h("div", { class: "note small" }, c.address ? short(c.address) : "Connected with your key"),
                ),
                h("button", { class: "small", onclick: () => modelsDialog(c) }, "Models"),
                h("button", { class: "small plain danger", onclick: () => confirm(`Disconnect ${c.name}?\n\nIts key is forgotten on this computer.${c.inUse ? " Your team goes back to Claude." : ""}`) && attempt(async () => (await api("DELETE", `gateway/${encodeURIComponent(c.id)}`), refresh()), col) }, "Disconnect"),
              ),
            )
          : h("p", { class: "banner" }, "No AI service is connected yet. Choose one below: Anthropic (Claude) is the standard, or find free models on this computer."),
      ),
      // Backups, once there is something to choose from.
      live.length ? backupsBox(live) : null,
      // Every service, by group.
      Object.entries(g.groups).map(([group, title]) =>
        h(
          "div",
          { class: "aigroup" },
          h("div", { class: "row" }, h("h4", { class: "grow" }, title), group === "local" ? findButton : null),
          h(
            "div",
            { class: "aigrid" },
            g.services
              .filter((s) => s.group === group)
              .map((s) => {
                const on = connectedIds.has(s.id) && s.id !== "custom";
                return h(
                  "div",
                  { class: `aicard${on ? " on" : ""}` },
                  h("div", { class: "aicardhead" }, h("strong", {}, s.name), on ? h("span", { class: "tag ok" }, "Connected") : null),
                  h("p", { class: "note small" }, s.about),
                  h(
                    "div",
                    { class: "row" },
                    s.ownSetup === "openrouter"
                      ? h("button", { class: on ? "small" : "small primary", onclick: () => ((ui.integration = "openrouter"), go("integrations")) }, on ? "Manage" : "Set up")
                      : h("button", { class: on ? "small" : "small primary", onclick: () => connectDialog(s) }, on ? "Change key" : "Connect"),
                  ),
                );
              }),
          ),
        ),
      ),
    );
  };

  const backupsBox = (live) => {
    const options = [];
    const list = g.backups.slice();
    const wrap = h("div", { class: "aibackups card" });
    const save = (next) => attempt(async () => (await api("PUT", "gateway/backups", { backups: next }), refresh()), col);
    const pick = h("select", { "aria-label": "Add a backup model" }, h("option", { value: "" }, "Add a backup model…"));
    // The models of every connected service that can use tools are offered.
    Promise.all(live.map((c) => api("GET", `providers/${encodeURIComponent(c.id)}/models`).then((r) => ({ c, r })).catch(() => null))).then((rows) => {
      for (const row of rows.filter(Boolean)) {
        const ok = (row.r.details ?? []).filter((m) => m.tools !== false).slice(0, 60);
        if (!ok.length) continue;
        pick.append(h("optgroup", { label: row.c.name }, ok.map((m) => h("option", { value: `${row.c.id}/${m.id}`, disabled: list.includes(`${row.c.id}/${m.id}`) || `${row.c.id}/${m.id}` === g.model }, m.id))));
        options.push(row);
      }
    });
    pick.addEventListener("change", () => pick.value && save([...list, pick.value]));
    return fill(
      wrap,
      h("strong", {}, "Backup models"),
      h("p", { class: "note small" }, `If ${modelName(g.model)} cannot answer (its service is down, busy or out of credit), the first backup answers instead, then the next. Each switch is noted in the audit log.`),
      list.length
        ? h(
            "ol",
            { class: "aibackuplist" },
            list.map((ref, i) =>
              h(
                "li",
                {},
                h("span", { class: "grow" }, modelName(ref)),
                i > 0 ? h("button", { class: "plain small", "aria-label": "Move up", onclick: () => save([...list.slice(0, i - 1), ref, list[i - 1], ...list.slice(i + 1)]) }, "↑") : null,
                h("button", { class: "plain small danger", onclick: () => save(list.filter((r) => r !== ref)) }, "Remove"),
              ),
            ),
          )
        : h("p", { class: "note small" }, "No backups yet."),
      list.length < 4 ? pick : null,
    );
  };

  const connectDialog = (s) => {
    const key = s.needsKey || s.id === "custom" || s.id === "litellm" ? h("input", { type: "password", autocomplete: "off", placeholder: s.keyPrefix ? `${s.keyPrefix}…` : s.needsKey ? "Paste the key" : "Key, if it needs one", "aria-label": "Key" }) : null;
    const address = s.addressHint ? h("input", { placeholder: s.addressHint, "aria-label": "Address" }) : null;
    const name = s.id === "custom" ? h("input", { placeholder: "Its name, e.g. Portkey", "aria-label": "Name", maxlength: 60 }) : null;
    const status = h("p", { class: "note", role: "status" });
    const go = h("button", { class: "primary" }, "Connect");
    const close = () => (dialog.close(), dialog.remove());
    const form = h(
      "form",
      {
        class: "form",
        onsubmit: async (e) => {
          e.preventDefault();
          go.disabled = true;
          status.textContent = `Checking with ${s.name}…`;
          try {
            const r = await api("POST", `gateway/${encodeURIComponent(s.id)}/connect`, { key: key?.value, address: address?.value, name: name?.value });
            close();
            toast(r.models ? `${s.name} is connected: ${r.models} model${r.models === 1 ? "" : "s"} ready.` : `${s.name} is connected. ${r.note ?? ""}`);
            await refresh();
            const c = g?.connected.find((x) => x.id === r.provider);
            if (c) modelsDialog(c);
          } catch (err) {
            status.textContent = err.message;
            status.className = "note bad";
            go.disabled = false;
          }
        },
      },
      h("p", { class: "note" }, s.about),
      s.group === "local"
        ? h("p", { class: "note small" }, `Start ${s.name} on this computer, then press Connect. `, s.keyUrl ? ["Don't have it? Get it at ", keyLink(s), "."] : null)
        : s.keyUrl
          ? h("p", { class: "note small" }, "Get a key at ", keyLink(s), ", then paste it here. It is kept on this computer and sent only to ", s.name, ".")
          : null,
      name,
      address,
      key,
      status,
      h("div", { class: "row" }, h("button", { type: "button", class: "plain", onclick: close }, "Cancel"), go),
    );
    const dialog = h("dialog", { class: "needs aidialog" }, h("h2", {}, `Connect ${s.name}`), form);
    dialog.addEventListener("cancel", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    (name ?? address ?? key)?.focus();
  };

  const modelsDialog = async (c) => {
    const list = h("div", { class: "aimodellist" }, h("p", { class: "note" }, "Loading its models…"));
    const filter = h("input", { placeholder: "Find a model", "aria-label": "Find a model" });
    const typed = h("input", { placeholder: "Or type a model's name", "aria-label": "Model name" });
    const close = () => (dialog.close(), dialog.remove());
    const use = (id) =>
      attempt(async () => {
        state.config = await api("PUT", "settings", { model: `${c.id}/${id}` });
        close();
        toast(`Your team now uses ${id}. Agents you gave a model of their own keep theirs.`);
        await refresh();
        settingsView();
      }, col);
    const dialog = h(
      "dialog",
      { class: "needs aidialog wide" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, `${c.name}: models`), h("button", { class: "plain small", "aria-label": "Close", onclick: close }, "✕")),
      h("p", { class: "note small" }, "Models that can use tools work for agents; they are listed first. Prices are per million words-pieces (tokens) going in and out, from the service's list prices."),
      filter,
      list,
      h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), typed.value.trim() && use(typed.value.trim())) }, typed, h("button", { class: "small" }, "Use this")),
    );
    dialog.addEventListener("cancel", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    const r = await api("GET", `providers/${encodeURIComponent(c.id)}/models`).catch((err) => ({ details: [], note: err.message }));
    const money = (n) => (n === 0 ? "free" : `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`);
    const show = () => {
      const q = filter.value.trim().toLowerCase();
      const rows = (r.details ?? []).filter((m) => !q || m.id.toLowerCase().includes(q)).slice(0, 200);
      fill(
        list,
        r.note ? h("p", { class: "note" }, r.note) : null,
        rows.length
          ? rows.map((m) =>
              h(
                "div",
                { class: "aimodel" },
                h(
                  "div",
                  { class: "grow" },
                  h("code", {}, m.id),
                  h(
                    "div",
                    { class: "note small" },
                    [m.tools === true ? "Works for agents" : m.tools === false ? "Cannot use tools" : "Not known if it can use tools", m.contextTokens ? `holds ${Math.round(m.contextTokens / 1000)}k tokens` : null, m.prices ? (m.prices.input === 0 && m.prices.output === 0 ? "free" : `${money(m.prices.input)} in · ${money(m.prices.output)} out`) : null].filter(Boolean).join(" · "),
                  ),
                ),
                g.model === `${c.id}/${m.id}` ? h("span", { class: "tag ok" }, "In use") : h("button", { class: "small", onclick: () => use(m.id) }, "Use for my team"),
              ),
            )
          : r.note
            ? null
            : h("p", { class: "note" }, q ? "No model matches." : "It lists no models. Type the model's name below."),
      );
    };
    filter.addEventListener("input", show);
    show();
  };

  refresh();
}

function settingsView() {
  const c = state.config;
  const col = page("Settings", "How your agents work, what they may spend, and how Talqava looks. Connections to AI models and other services are under Integrations.");
  const save = (patch) =>
    attempt(async () => {
      state.config = await api("PUT", "settings", patch);
      document.title = state.config.agentName;
      renderSide();
      settingsView();
    }, col);
  const select = (options, value) => h("select", {}, options.map(([id, label]) => h("option", { value: id, selected: id === value }, label)));

  if (needsKey(c)) {
    col.append(h("div", { class: "banner" }, "To get started, connect an AI service: ", h("button", { class: "plain link", onclick: () => ((ui.integration = "ai-models"), go("integrations")) }, "Integrations → AI models"), ". Anthropic (Claude), OpenAI, Google Gemini and many more, or free models on this computer."));
  }

  // The accent is a per-person choice, kept in this browser, so it changes at once without saving.
  const accentLabel = h("span", {}, NEON[accent][0]);
  const accentRow = h("div");
  const drawAccent = () => fill(accentRow, swatches(accent, (name) => (applyAccent(name), (accentLabel.textContent = NEON[name][0]), drawAccent()), "Accent colour"));
  drawAccent();
  const themeRow = h("div", { class: "themepick", role: "radiogroup", "aria-label": "Appearance" });
  const drawTheme = () =>
    fill(
      themeRow,
      [["light", "Light"], ["dark", "Dark"], ["system", "Match my computer"]].map(([id, label]) => {
        const on = (window.talqavaTheme?.choice ?? "light") === id;
        return h("button", { class: on ? "on" : "", role: "radio", "aria-checked": String(on), onclick: () => (window.talqavaTheme?.set(id), drawTheme()) }, h("span", { class: `themeswatch ${id}`, "aria-hidden": "true" }), label);
      }),
    );
  drawTheme();
  col.append(
    h("h3", {}, "Look"),
    h("p", { class: "note" }, "Appearance. Light is the standard look; Match my computer switches between light and dark with it."),
    themeRow,
    h("p", { class: "note" }, "Accent colour: ", accentLabel, ". Used for buttons and highlights. Each agent is shown as a tile in its department's colour, with a symbol for its role; you can change both when you edit the agent."),
    accentRow,
  );


  const name = h("input", { value: c.agentName });
  const slash = c.model.indexOf("/");
  const provider = select(c.providers.map((p) => [p.id, p.name]), c.model.slice(0, slash));
  const modelName = h("input", { value: c.model.slice(slash + 1), placeholder: "Model name, e.g. llama3.1 or claude-opus-5-5", autocomplete: "off" });
  const claudeModels = h("datalist", { id: "claude-models" }, c.models.map((m) => h("option", { value: m.id }, m.label)));
  // Claude's names are suggested only when Anthropic is the provider.
  const providerModels = h("datalist", { id: "provider-models" });
  const modelNote = h("p", { class: "note small" });
  // Suggest the models the chosen provider actually has.
  const syncList = async () => {
    modelName.setAttribute("list", "provider-models");
    const listed = await api("GET", `providers/${encodeURIComponent(provider.value)}/models`).catch(() => ({ models: [] }));
    fill(providerModels, listed.models.map((m) => h("option", { value: m })));
    modelNote.textContent = listed.note || (listed.models.length ? `${listed.models.length} model${listed.models.length === 1 ? "" : "s"} available. Start typing to choose.` : "");
  };
  provider.addEventListener("change", syncList);
  syncList();
  const ref = () => `${provider.value}/${modelName.value.trim()}`;
  const effort = select(c.efforts.map((e) => [e, e]), c.effort);
  const savings = select([["off", "Off: every agent uses my model"], ["balanced", "On: match the model to the work"]], c.savings ?? "off");
  const checkFirst = select([["on", "Check first, and ask me if something is missing"], ["off", "Start straight away"]], c.checkFirst === false ? "off" : "on");
  const planFirst = select([["leads", "Tasks I give to a lead: plan first, for my approval"], ["all", "Every task I give: plan first, for my approval"], ["never", "Never: start straight away"]], c.planFirst ?? "leads");
  const mode = select(
    [
      ["ask", "Ask me before commands, file changes and API writes"],
      ["auto", "Run everything without asking"],
    ],
    c.approvalMode,
  );
  const steps = h("input", { type: "number", min: 1, max: 500, step: 1, value: c.budget?.steps ?? 40 });
  const spend = h("input", { type: "number", min: 0, max: 100, step: 0.01, value: c.budget?.spend ?? "", placeholder: "No limit" });

  const checkBox = h("div", {});
  const showCheck = (result) => {
    if (!result) return fill(checkBox, h("p", { class: "note" }, "Not checked yet. The check takes under a minute and costs a few cents at most on a paid model."));
    const mark = (ok, label) => h("span", { class: ok ? "state ok" : "state bad" }, `${ok ? "✓" : "✗"} ${label}  `);
    fill(checkBox, 
      h(
        "div",
        { class: "card" },
        h("div", {}, h("strong", {}, result.label), h("span", { class: "note" }, ` · checked ${when(result.checkedAt)}`)),
        h("div", {}, mark(result.instructions, "follows instructions"), mark(result.tools, "uses tools"), mark(result.multiStep, "chains steps")),
        h("div", { class: "note" }, `Good for: ${result.recommended.join(", ")}`),
        result.notes.map((note) => h("div", { class: "note" }, note)),
      ),
    );
  };
  showCheck(c.modelChecks?.[c.model]);
  const checkButton = h("button", { type: "button" }, "Check this model");
  checkButton.addEventListener("click", () =>
    attempt(async () => {
      checkButton.disabled = true;
      checkButton.textContent = "Checking…";
      try {
        showCheck(await api("POST", "model-check", { model: ref() }));
        state.config = await api("GET", "state");
      } finally {
        checkButton.disabled = false;
        checkButton.textContent = "Check this model";
      }
    }, col),
  );

  col.append(
    h("h3", {}, "Agent"),
    h(
      "form",
      {
        class: "form",
        onsubmit: (e) => (
          e.preventDefault(),
          save({ agentName: name.value, model: ref(), effort: effort.value, savings: savings.value, checkFirst: checkFirst.value === "on", planFirst: planFirst.value, approvalMode: mode.value, budget: { steps: Number(steps.value), spend: spend.value === "" ? null : Number(spend.value) } })
        ),
      },
      h("label", {}, "Name", name),
      h("label", {}, "Model comes from", provider),
      h("label", {}, "Model", modelName, claudeModels, providerModels),
      modelNote,
      h("p", { class: "note" }, "For a free local model, start a local model runner (Ollama, LM Studio, llama.cpp and others) and type the name of a model you have downloaded. Web search and connectors are Claude-only for now; other models read pages with the built-in page reader."),
      h("div", { class: "row" }, checkButton),
      checkBox,
      h("label", {}, "Effort, for Claude (higher thinks longer and costs more)", effort),
      h("label", {}, "Cost saving for your team of agents", savings),
      h("label", {}, "Before starting a task", checkFirst),
      h("label", {}, "Plans for your approval", planFirst),
      h("p", { class: "note small" }, "With plans on, the agent first looks into the task and sends you a plan: the steps, who does each, and its cost estimate. It changes nothing and hands nothing on until you approve it, or ask for changes. A lead is an agent with people reporting to it."),
      h("p", { class: "note small" }, "With this on, an agent first checks it has what your task needs (information, a repository, documents, access). If something is missing, it asks you in your Inbox instead of spending money guessing. The check costs a few cents at most and shows on the receipt."),
      h("p", { class: "note small" }, "With cost saving on, and Claude Opus or Fable as your model: managers who plan and check keep your model, team members doing their own part use Claude Sonnet 5.5 (about half the price), and quick questions between agents use Claude Haiku 5.5 (about a fortieth). An agent you gave a model of its own keeps it. Off uses your model for everything."),
      h("label", {}, "Approvals", mode),
      h("p", { class: "note" }, "With “ask”, a scheduled job that needs approval waits until you open its chat and answer. “Run everything” is only sensible when the agent runs in Docker or on a machine with nothing you'd mind losing."),
      h("label", {}, "Budget per run: steps (model calls)", steps),
      h("label", {}, "Budget per run: estimated spend in US dollars", spend),
      h("p", { class: "note" }, "A run stops before going over either limit, and you can say “continue”. Spend is estimated from list prices; your provider's bill is the real figure."),
      h("div", {}, h("button", { class: "primary" }, "Save")),
    ),
  );

  col.append(
    h("h3", {}, "Connections"),
    h("p", { class: "note" }, "AI models, repositories, connectors and keys for other services are under ", h("button", { class: "plain link", onclick: () => ((ui.integration = null), go("integrations")) }, "Integrations"), "."),
  );

  // About Talqava, its licence, privacy policy, terms and other policies.
  const legal = h("div", { class: "legallinks" });
  api("GET", "legal").then((docs) => legal.isConnected && fill(legal, docs.map((d) => h("button", { class: "small", onclick: () => showLegal(d.id) }, d.title)))).catch(() => {});
  col.append(
    h("h3", {}, "About and legal"),
    h("p", { class: "note" }, "Talqava is open-source software under the MIT licence, developed by GR Investments LLC. It runs on your computer and sends nothing to us: your data goes only to the services you connect, such as your AI model provider."),
    h("p", { class: "note small" }, "Files your agents work on are kept in ", h("code", {}, c.workspace), ". Everything else Talqava knows is in ", h("code", {}, c.dataDir), "."),
    legal,
  );
}

boot();

// ---------- the workspace: pages the owner and the agents share ----------
// A tree of pages on the left; a page on the right, edited in place and saved as you type. Agents read pages,
// file their results as pages, and suggest changes that wait here (and in the inbox) for the owner.
let editorModule = null;
const loadEditor = () => (editorModule ??= import("/vendor/editor.js"));

/** Opens the workspace, at a page or at its home. */
function openPage(id) {
  ui.ws ??= { collapsed: new Set() };
  ui.ws.open = id;
  if (state.view !== "workspace") go("workspace");
  else workspaceView();
}

async function workspaceView() {
  ui.ws ??= { collapsed: new Set() };
  ui.wsFlush?.();
  ui.wsFlush = null;
  ui.wsEditor?.destroy();
  ui.wsEditor = null;
  ui.body.className = "body two wsbody";
  ui.log = null;
  const side = h("aside", { class: "side wsside", "aria-label": "Pages" });
  const col = h("main", { class: "center wscenter" });
  fill(ui.body, side, col);
  let data;
  try {
    [data] = await Promise.all([api("GET", "workspace"), state.crew ? null : loadCrew()]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "workspace") return;
  ui.ws.data = data;
  if (ui.ws.open && !data.tree.some((p) => p.id === ui.ws.open)) ui.ws.open = null;
  renderWsTree(side);
  if (ui.ws.open) await renderWsPage(col, ui.ws.open);
  else renderWsHome(col);
}

/** A new page, under `parent` (or at the top), opened with its title ready to type. */
async function newPage(parent = null, title = "") {
  await attempt(async () => {
    const page = await api("POST", "workspace/pages", { parent, title: title || "Untitled" });
    if (parent) ui.ws.collapsed.delete(parent);
    ui.ws.focusTitle = true;
    openPage(page.id);
  });
}

function renderWsTree(side) {
  const { tree, deleted } = ui.ws.data;
  const kids = new Map();
  for (const p of tree) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)).push(p);
  const byId = new Map(tree.map((p) => [p.id, p]));
  // Moving a page: drop it on another page to put it inside, or on the top line to bring it to the top.
  const move = (id, parent) => {
    if (!id || id === parent) return;
    for (let at = parent; at; at = byId.get(at)?.parent) if (at === id) return;
    attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { parent }), workspaceView()), side);
  };
  const dropZone = (parent) => ({
    ondragover: (e) => (e.preventDefault(), e.currentTarget.classList.add("dropover")),
    ondragleave: (e) => e.currentTarget.classList.remove("dropover"),
    ondrop: (e) => (e.preventDefault(), e.currentTarget.classList.remove("dropover"), move(e.dataTransfer.getData("text/talqava-page"), parent)),
  });
  const row = (p, depth) => {
    const children = kids.get(p.id) ?? [];
    const closed = ui.ws.collapsed.has(p.id);
    return h(
      "li",
      {},
      h(
        "div",
        {
          class: `wsrow ${ui.ws.open === p.id ? "on" : ""}`,
          style: `--depth: ${depth}`,
          draggable: "true",
          ondragstart: (e) => e.dataTransfer.setData("text/talqava-page", p.id),
          ...dropZone(p.id),
        },
        children.length
          ? h("button", { class: "plain wscaret", "aria-label": closed ? `Show the pages in ${p.title}` : `Hide the pages in ${p.title}`, "aria-expanded": String(!closed), onclick: () => (closed ? ui.ws.collapsed.delete(p.id) : ui.ws.collapsed.add(p.id), renderWsTree(side)) }, closed ? "▸" : "▾")
          : h("span", { class: "wscaret" }),
        h("button", { class: "plain wslink", onclick: () => openPage(p.id), title: p.summary || p.title }, h("span", { class: "wsicon", "aria-hidden": "true" }, p.icon || "📄"), h("span", { class: "grow wstitle" }, p.title), p.suggestions ? h("span", { class: "count", title: `${p.suggestions} change${p.suggestions === 1 ? "" : "s"} suggested by agents` }, p.suggestions) : null, p.access.private ? h("span", { class: "wslock", title: "Private: no agent sees it" }, "🔒") : null),
        h("button", { class: "plain wsadd", title: `Add a page inside ${p.title}`, "aria-label": `Add a page inside ${p.title}`, onclick: () => newPage(p.id) }, "+"),
      ),
      children.length && !closed ? h("ul", { class: "wstree" }, children.map((c) => row(c, depth + 1))) : null,
    );
  };
  fill(
    side,
    h("div", { class: "wssidehead", ...dropZone(null) }, h("button", { class: `plain wshome ${ui.ws.open ? "" : "on"}`, onclick: () => openPage(null) }, h("span", { class: "wsicon", "aria-hidden": "true" }, "🏠"), "Workspace"), h("button", { class: "small", onclick: () => newPage(null), title: "A new page at the top" }, "+ Page")),
    tree.length ? h("ul", { class: "wstree" }, (kids.get(null) ?? []).map((p) => row(p, 0))) : h("p", { class: "note small" }, "No pages yet. Add one, or start from a template."),
    deleted.length ? h("details", { class: "wsdeleted" }, h("summary", { class: "note small" }, `Deleted (${deleted.length})`), deleted.map((d) => h("div", { class: "row" }, h("span", { class: "grow small" }, d.title), h("button", { class: "plain small", onclick: () => attempt(async () => (await api("POST", `workspace/pages/${d.id}/restore`), workspaceView()), side) }, "Restore")))) : null,
  );
}

function renderWsHome(col) {
  const { tree, templates, suggestions } = ui.ws.data;
  const results = h("div", { class: "wsresults" });
  const search = h("input", { type: "search", placeholder: "Search every page", "aria-label": "Search the workspace" });
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (!q) return fill(results);
      const hits = await api("GET", `workspace/search?q=${encodeURIComponent(q)}`).catch(() => []);
      fill(results, hits.length ? hits.map((x) => h("button", { class: "wshit", onclick: () => openPage(x.page) }, h("b", {}, x.title, x.heading ? h("span", { class: "note" }, ` › ${x.heading}`) : null), h("span", { class: "note small" }, x.text.slice(0, 180)))) : h("p", { class: "note" }, "No page matches that."));
    }, 200);
  });
  const recent = [...tree].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  fill(
    col,
    h(
      "div",
      { class: "page wshomepage" },
      h("h1", {}, "Workspace"),
      h("p", { class: "lead" }, "Pages your agents work from: how your business runs, procedures, checklists and decisions. Agents read them before they start, follow them, and suggest changes for you to accept."),
      search,
      results,
      suggestions.length
        ? [h("h3", {}, `Waiting for you (${suggestions.length})`), h("div", { class: "wssuggestlist" }, suggestions.map((s) => h("button", { class: "card wscard", onclick: () => openPage(s.page) }, h("b", {}, `${s.authorName} suggests a change to “${s.pageTitle}”`), h("span", { class: "note small" }, s.note || "Open the page to see it."))))]
        : null,
      recent.length ? [h("h3", {}, "Recently changed"), h("div", { class: "wsgrid" }, recent.map((p) => h("button", { class: "card wscard", onclick: () => openPage(p.id) }, h("span", { class: "wsbigicon", "aria-hidden": "true" }, p.icon || "📄"), h("b", {}, p.title), h("span", { class: "note small" }, `${p.updatedBy} · ${shortWhen(p.updatedAt)}`), p.summary ? h("span", { class: "note small wssum" }, p.summary) : null)))] : null,
      h("h3", {}, "Start from a template"),
      h("p", { class: "note" }, "Ready-made pages written for a small business. Add them, then change them to match how you work."),
      h(
        "div",
        { class: "wsgrid" },
        templates.map((t) =>
          h(
            "div",
            { class: "card wscard wstemplate" },
            h("b", {}, t.name),
            h("span", { class: "note small" }, t.summary),
            h("ul", { class: "wstplpages" }, t.pages.map((p) => h("li", {}, p))),
            h("button", { class: "small", onclick: () => attempt(async () => { const top = await api("POST", `workspace/templates/${t.id}`); openPage(top.id); }, col) }, "Add these pages"),
          ),
        ),
      ),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => newPage(null) }, "+ New page")),
    ),
  );
}

/** Plain words for who may see a page. */
function accessWords(a) {
  if (a.private) return "Private: no agent sees it";
  if (a.everyone) return "Every agent";
  const parts = [...a.departments, ...a.agents.map((id) => state.crew?.bots.find((b) => b.id === id)?.name ?? id)];
  return parts.length ? `Only ${parts.join(", ")}` : "Nobody but you";
}

async function renderWsPage(col, id) {
  let page;
  let suggestions;
  try {
    [page, suggestions] = await Promise.all([api("GET", `workspace/pages/${id}`), api("GET", `workspace/suggestions?page=${encodeURIComponent(id)}`)]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  const { createEditor, BLOCKS } = await loadEditor();
  if (state.view !== "workspace" || ui.ws.open !== id) return;
  const byId = new Map(ui.ws.data.tree.map((p) => [p.id, p]));
  const trail = [];
  for (let at = byId.get(page.parent); at; at = byId.get(at.parent)) trail.unshift(at);

  // ----- saving as you type -----
  let rev = page.rev;
  let timer = null;
  let saving = Promise.resolve();
  const status = h("span", { class: "wsstatus note small" }, "Saved");
  const conflict = h("div");
  const save = () => {
    clearTimeout(timer);
    timer = null;
    const markdown = ui.wsEditor?.markdown();
    if (markdown === undefined) return saving;
    status.textContent = "Saving…";
    saving = saving.then(async () => {
      try {
        const saved = await api("PUT", `workspace/pages/${id}`, { markdown, baseRev: rev });
        rev = saved.rev;
        status.textContent = "Saved";
      } catch (err) {
        status.textContent = "Not saved";
        fill(conflict, h("div", { class: "banner error" }, err.message, " ", h("button", { class: "small", onclick: () => workspaceView() }, "Reload")));
      }
    });
    return saving;
  };
  const changed = () => {
    status.textContent = "Editing…";
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  };
  ui.wsFlush = () => timer && save();

  // ----- the title and icon -----
  const title = h("input", { class: "wstitlebox", value: page.title === "Untitled" && ui.ws.focusTitle ? "" : page.title, placeholder: "Untitled", maxlength: 120, "aria-label": "Page title" });
  const saveTitle = () => attempt(async () => {
    const t = title.value.trim() || "Untitled";
    if (t === page.title) return;
    page.title = t;
    await api("PATCH", `workspace/pages/${id}`, { title: t });
    ui.ws.data = await api("GET", "workspace");
    renderWsTree(document.querySelector(".wsside"));
  }, col);
  title.addEventListener("change", saveTitle);
  title.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveTitle(), ui.wsEditor?.focus("start")));
  const iconBtn = h("button", { class: "plain wspageicon", title: "Change the icon", "aria-label": "Change the page's icon", onclick: () => {
    const next = prompt("Type or paste an emoji for this page (leave empty for none):", page.icon || "");
    if (next === null) return;
    attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { icon: next }), workspaceView()), col);
  } }, page.icon || "📄");

  // ----- the editor, its toolbar and the slash menu -----
  const surface = h("div", { class: "wseditor md" });
  const menu = h("div", { class: "wsslash", role: "listbox", "aria-label": "Blocks", hidden: true });
  let menuItems = [];
  let menuAt = 0;
  const drawMenu = (query, at) => {
    menuItems = BLOCKS.filter((b) => !query || b.label.toLowerCase().includes(query) || b.words.includes(query));
    if (!menuItems.length) return (menu.hidden = true);
    menuAt = Math.min(menuAt, menuItems.length - 1);
    fill(menu, menuItems.map((b, i) => h("button", { class: `wsslashitem ${i === menuAt ? "on" : ""}`, role: "option", "aria-selected": String(i === menuAt), onmousedown: (e) => (e.preventDefault(), ui.wsEditor.block(b.id)) }, h("b", {}, b.label), h("span", { class: "note small" }, b.hint))));
    const box = col.getBoundingClientRect();
    menu.style.left = `${Math.max(0, at.left - box.left)}px`;
    menu.style.top = `${at.bottom - box.top + col.scrollTop + 6}px`;
    menu.hidden = false;
  };
  // While the menu is open, the arrow keys, Enter and Escape belong to it.
  surface.addEventListener(
    "keydown",
    (e) => {
      if (menu.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        menuAt = (menuAt + (e.key === "ArrowDown" ? 1 : menuItems.length - 1)) % menuItems.length;
        [...menu.children].forEach((c, i) => (c.classList.toggle("on", i === menuAt), c.setAttribute("aria-selected", String(i === menuAt))));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        ui.wsEditor.block(menuItems[menuAt].id);
      } else if (e.key === "Escape") {
        menu.hidden = true;
      }
    },
    true,
  );
  const tool = (kind, label, name) => h("button", { class: "plain small wstool", title: name, "aria-label": name, onmousedown: (e) => e.preventDefault(), onclick: () => (kind === "link" ? ((url) => url !== null && ui.wsEditor.format("link", url.trim()))(prompt("Link to (leave empty to remove the link):", "https://")) : ui.wsEditor.format(kind)) }, label);
  const toolbar = h("div", { class: "wstoolbar" }, tool("bold", h("b", {}, "B"), "Bold"), tool("italic", h("i", {}, "I"), "Italic"), tool("strike", h("s", {}, "S"), "Strike through"), tool("code", h("code", {}, "<>"), "Code"), tool("link", "🔗", "Link"), h("span", { class: "note small wshintkey" }, "Type / for headings, lists, checklists and tables"), h("span", { class: "grow" }), status);

  // ----- agents' suggestions -----
  const suggestBox = h("div", { class: "wssuggestions" });
  const drawSuggestions = (list) =>
    fill(
      suggestBox,
      list.map((s) => {
        const lines = h("div", { class: "wsdiff" }, s.diff.map((d) => (d.op === "same" ? null : h("div", { class: `wsdiffline ${d.op}` }, h("span", { class: "wsdiffmark", "aria-hidden": "true" }, d.op === "add" ? "+" : "−"), h("span", {}, diffText(d.text))))));
        const decide = (decision) =>
          attempt(async () => {
            try {
              await api("POST", `workspace/suggestions/${s.id}`, { decision });
            } catch (err) {
              // The page changed in the same places since the agent read it: the owner chooses.
              if (err.status !== 409 || !confirm(`${err.message}\n\nUse the agent's version of the page? Your newer text stays in the page's history.`)) throw err;
              await api("POST", `workspace/suggestions/${s.id}`, { decision, replace: true });
            }
            loadPageSuggestions();
            workspaceView();
          }, suggestBox);
        return h(
          "section",
          { class: "card wssuggestion" },
          h("div", { class: "row" }, h("b", { class: "grow" }, `${s.authorName} suggests a change`), h("span", { class: "note small" }, shortWhen(s.createdAt))),
          s.note ? h("p", { class: "note" }, s.note) : null,
          s.stale ? h("p", { class: "note small" }, "This page changed after the agent read it. Accepting keeps your newer changes where they don't overlap.") : null,
          lines,
          h("div", { class: "row" }, h("button", { class: "primary small", onclick: () => decide("accept") }, "Accept"), h("button", { class: "small", onclick: () => decide("decline") }, "Decline"), s.task ? h("button", { class: "plain small", onclick: () => go("quest", s.task) }, "See the task") : null),
        );
      }),
    );
  drawSuggestions(suggestions);

  // ----- the page's settings -----
  const org = activeOrg();
  const groups = [...new Set((org.groups ?? []).map((g) => g.name).concat(org.members.map((m) => m.department)))].filter(Boolean).sort();
  const patch = (body) => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, body), workspaceView()), col);
  const mode = page.access.private ? "private" : !page.accessSet ? "inherit" : page.access.everyone ? "everyone" : "some";
  const who = h(
    "select",
    { "aria-label": "Who can see this page", onchange: (e) => (e.target.value === "some" ? fill(pick, groupBoxes()) : patch({ access: e.target.value === "inherit" ? null : e.target.value === "private" ? { private: true } : { everyone: true } })) },
    h("option", { value: "inherit", selected: mode === "inherit" }, page.parent ? `Same as “${byId.get(page.parent)?.title ?? "the page above"}”` : "Every agent (the default)"),
    h("option", { value: "everyone", selected: mode === "everyone" }, "Every agent"),
    h("option", { value: "some", selected: mode === "some" }, "Only some groups"),
    h("option", { value: "private", selected: mode === "private" }, "Private: no agent sees it"),
  );
  const pick = h("div", { class: "wsgroups" });
  const groupBoxes = () => {
    const boxes = groups.map((g) => [g, h("input", { type: "checkbox", checked: page.access.departments.includes(g) })]);
    return [h("div", { class: "wsgroupchecks" }, boxes.map(([g, box]) => h("label", { class: "power" }, box, g))), h("button", { class: "small", onclick: () => patch({ access: { everyone: false, departments: boxes.filter(([, b]) => b.checked).map(([g]) => g), agents: [] } }) }, "Save")];
  };
  if (mode === "some") fill(pick, groupBoxes());
  const edit = h(
    "select",
    { "aria-label": "How agents change this page", onchange: (e) => patch({ edit: e.target.value }) },
    h("option", { value: "suggest", selected: page.edit === "suggest" }, "They suggest; I accept or decline"),
    h("option", { value: "direct", selected: page.edit === "direct" }, "They may change it directly"),
  );
  const protect = h("input", { type: "checkbox", checked: page.protected, onchange: (e) => patch({ protected: e.target.checked }) });

  // Give this page to an agent as a task.
  const giveTo = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const giveWhat = h("textarea", { rows: 2, placeholder: "What should they do with it? e.g. Follow this procedure for this week's orders.", "aria-label": "What to do" });
  const give = () =>
    attempt(async () => {
      const what = giveWhat.value.trim() || `Follow the page “${page.title}”.`;
      const quest = await startTask({ bot: giveTo.value, text: `${what}\n\nWork from the workspace page “${page.title}” (page ${id}): read it first with the workspace tool, follow it, and say in your report how you used it.`, title: what.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);

  const tasksBox = h("div", { class: "wstasks" });
  api("GET", `workspace/pages/${id}/tasks`).then((tasks) => tasksBox.isConnected && fill(tasksBox, tasks.length ? tasks.slice(0, 8).map((t) => h("button", { class: "plain wstaskrow", onclick: () => go("quest", t.task) }, h("span", { class: "grow" }, t.title), h("span", { class: "note small" }, `${t.agent ?? ""} ${t.how === "filed" ? "filed it" : t.how === "suggested" ? "suggested" : t.how === "changed" ? "changed it" : "read it"}`))) : h("p", { class: "note small" }, "No task has used this page yet."))).catch(() => {});

  const aside = h(
    "aside",
    { class: "wspanel" },
    h("div", { class: "label" }, "Who can see it"),
    who,
    pick,
    h("p", { class: "note small" }, accessWords(page.access)),
    h("div", { class: "label" }, "When agents want to change it"),
    edit,
    h("label", { class: "power" }, protect, "Protected: agents never change it directly"),
    h("p", { class: "note small" }, "Use Protected for prices, legal and people policies."),
    org.members.length ? [h("div", { class: "label" }, "Give this page to an agent"), giveTo, giveWhat, h("button", { class: "small", onclick: give }, "Give the task")] : null,
    h("div", { class: "label" }, "Used by"),
    tasksBox,
    h("div", { class: "row wrap wspanelend" }, h("button", { class: "small", onclick: () => pageHistory(page) }, "History"), h("button", { class: "small danger", onclick: () => confirm(`Delete “${page.title}”${ui.ws.data.tree.some((p) => p.parent === id) ? " and the pages inside it" : ""}? You can restore it from Deleted.`) && attempt(async () => (await api("DELETE", `workspace/pages/${id}`), (ui.ws.open = page.parent), workspaceView()), col) }, "Delete")),
  );

  fill(
    col,
    h(
      "div",
      { class: "wspage" },
      h(
        "article",
        { class: "wsdoc" },
        trail.length ? h("nav", { class: "wstrail note small", "aria-label": "Where this page is" }, trail.map((t) => [h("button", { class: "plain link", onclick: () => openPage(t.id) }, t.title), " › "])) : null,
        h("div", { class: "wshead" }, iconBtn, title),
        h("p", { class: "note small wsmeta" }, `Edited by ${page.updatedBy} · ${when(page.updatedAt)}${page.protected ? " · Protected" : ""}`),
        conflict,
        suggestBox,
        toolbar,
        surface,
        menu,
      ),
      aside,
    ),
  );
  ui.wsEditor = createEditor(surface, { markdown: page.markdown, placeholder: "Write here, or type / for headings, lists, checklists and tables", onChange: changed, onSlash: (q, at) => drawMenu(q, at), onSlashEnd: () => ((menu.hidden = true), (menuAt = 0)) });
  if (ui.ws.focusTitle) {
    ui.ws.focusTitle = false;
    title.focus();
  }
}

/** Which guide explains each page. */
const GUIDES_BY_VIEW = { chat: "chat", inbox: "inbox", tasks: "tasks", home: "work-in-progress", quest: "work-in-progress", bot: "work-in-progress", jobs: "schedules", team: "organization", market: "marketplace", marketbot: "marketplace", workspace: "workspace", library: "library", memory: "memory", skills: "skills", audit: "audit-log", integrations: "integrations", settings: "settings" };
const guideFor = (view) => (view === "integrations" && ui.integration === "ai-models" ? "ai-models" : GUIDES_BY_VIEW[view] ?? null);

/** Shows a user guide in a reader beside the page. Links between guides open in the reader; the list of guides is on the left. */
async function showGuide(id) {
  let doc;
  let list = [];
  try {
    [doc, list] = await Promise.all([api("GET", `guide/${encodeURIComponent(id)}`), api("GET", "guide").catch(() => [])]);
  } catch (err) {
    return attempt(() => Promise.reject(err));
  }
  document.querySelector("dialog.guidedialog")?.remove();
  const body = h("div", { class: "md guidedoc" }, renderMarkdown(doc.markdown.replace(/^#\s+[^\n]*\n+/, "")));
  body.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.dataset.doc ?? a.getAttribute("href");
    if (a.dataset.doc) e.preventDefault();
    const other = href.match(/^(?:\.\/)?([a-z-]+)\.md(?:#.*)?$/);
    if (other) return showGuide(other[1]);
    // A guide that points at a policy opens it in the policy reader.
    const legal = { "TERMS.md": "terms", "PRIVACY.md": "privacy", "ACCEPTABLE_USE.md": "acceptable-use", LICENSE: "license", "SECURITY.md": "security", "THIRD_PARTY_NOTICES.md": "notices" }[href.split("/").pop().split("#")[0]];
    if (legal) return close(), showLegal(legal);
    if (/^https?:/.test(href)) a.target = "_blank";
  });
  const nav = h(
    "nav",
    { class: "guidenav", "aria-label": "All guides" },
    list.map((g) => h("button", { class: `plain${g.id === doc.id ? " on" : ""}`, "aria-current": g.id === doc.id ? "page" : null, onclick: () => showGuide(g.id) }, g.title)),
  );
  const close = () => (dialog.close(), dialog.remove());
  const dialog = h(
    "dialog",
    { class: "guidedialog" },
    h("div", { class: "row guidehead" }, h("span", { class: "guidekicker" }, "User guide"), h("h2", { class: "grow" }, doc.title), h("button", { class: "plain small", "aria-label": "Close", onclick: close }, "✕")),
    h("div", { class: "guidecols" }, nav, body),
  );
  dialog.addEventListener("cancel", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  body.scrollTop = 0;
}
window.talqavaShowGuide = showGuide;
// A link to one of Talqava's own documents never leaves the page; the reader showing it opens it.
document.addEventListener("click", (e) => e.target.closest?.("a.doclink") && e.preventDefault(), true);

/** Shows one of the app's documents (terms, privacy policy, licence, notices…) in a reader. Links between them open here. */
async function showLegal(id) {
  let doc;
  try {
    doc = await api("GET", `legal/${encodeURIComponent(id)}`);
  } catch (err) {
    return attempt(() => Promise.reject(err));
  }
  document.querySelector("dialog.legaldialog")?.remove();
  const files = { "TERMS.md": "terms", "PRIVACY.md": "privacy", "ACCEPTABLE_USE.md": "acceptable-use", LICENSE: "license", "SECURITY.md": "security", "OPEN_SOURCE_POLICY.md": "open-source", "APPROVED_LICENSES.md": "approved-licenses", "THIRD_PARTY_NOTICES.md": "notices" };
  // The document's own first heading is its title, already shown at the top.
  const body = h("div", { class: "md legaldoc" }, id === "license" ? h("pre", {}, doc.markdown) : renderMarkdown(doc.markdown.replace(/^#\s+[^\n]*\n+/, "")));
  body.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    if (a.dataset.doc) e.preventDefault();
    const name = (a.dataset.doc ?? a.getAttribute("href")).split(/[/#]/).filter(Boolean).find((p) => files[p]);
    if (name) return e.preventDefault(), showLegal(files[name]);
    if (/^https?:/.test(a.getAttribute("href"))) a.target = "_blank";
  });
  const dialog = h("dialog", { class: "needs legaldialog" }, h("div", { class: "row" }, h("h2", { class: "grow" }, doc.title), h("button", { class: "plain small", "aria-label": "Close", onclick: () => (dialog.close(), dialog.remove()) }, "✕")), body);
  dialog.addEventListener("cancel", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
// The Mac app's Help menu opens these too.
window.talqavaShowLegal = showLegal;

/** One line of a page's Markdown as plain reading text, for showing a change: "- [ ] x" becomes "☐ x". */
const diffText = (line) =>
  String(line ?? "")
    .replace(/^(\s*)[-*+] \[ \] /, "$1☐ ")
    .replace(/^(\s*)[-*+] \[[xX]\] /, "$1☑ ")
    .replace(/^(\s*)[-*+] /, "$1• ")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") || " ";

/** A page's earlier versions, to look at or put back. */
async function pageHistory(page) {
  const versions = await api("GET", `workspace/pages/${page.id}/revisions`).catch(() => []);
  const view = h("div", { class: "md wsrevview" });
  const list = h(
    "div",
    { class: "wsrevs" },
    versions.map((v, i) =>
      h(
        "div",
        { class: "row" },
        h("button", { class: "plain grow wsrevbtn", onclick: async () => fill(view, renderMarkdown((await api("GET", `workspace/pages/${page.id}/revisions/${v.rev}`)).markdown || "(empty)")) }, `${when(v.at)} · ${v.author}${i === 0 ? " · current" : ""}`),
        i === 0 ? null : h("button", { class: "small", onclick: () => confirm("Put this version back? The page as it is now stays in the history.") && attempt(async () => (await api("POST", `workspace/pages/${page.id}/revisions/${v.rev}`), document.querySelector("dialog.libdialog")?.close(), document.querySelector("dialog.libdialog")?.remove(), workspaceView())) }, "Put back"),
      ),
    ),
  );
  libDialog(`History of “${page.title}”`, h("div", { class: "wshistory" }, versions.length ? list : h("p", { class: "note" }, "No earlier versions yet."), view), []);
}

// ---------- tasks: the board ----------
// Every task of the organization, as lasting work: To do (waiting its turn in its agent's queue), Working, Needs you,
// To review and Done. Each agent works its queue one task at a time, most important first. A task opens in a panel
// with what was asked, the latest report, sub-tasks and comments; the owner accepts work or sends it back.
const TASK_COLUMNS = [
  ["todo", "To do", "Waiting their turn, or paused"],
  ["working", "Working", "Being done now"],
  ["needs", "Needs you", "Waiting for your answer, or stuck"],
  ["review", "To review", "Finished: accept it, or send it back"],
  ["done", "Done", "The last two weeks"],
];
const PRIORITY_WORDS = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const TASK_STATUS_WORDS = { todo: "To do", working: "Working", waiting: "Needs you", blocked: "Stuck", review: "To review", done: "Done", cancelled: "Cancelled", paused: "Paused" };
const columnOf = (t) => (t.status === "waiting" || t.status === "blocked" ? "needs" : t.status === "paused" ? "todo" : t.status);
const ordinal = (n) => (n === 1 ? "Next" : `${n}${n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"} in queue`);

/** The Tasks page's heading, with the Board / Goals switch. */
function tasksHead() {
  const mode = ui.tasksMode ?? "board";
  const tab = (id, label) => h("button", { class: mode === id ? "on" : "", role: "tab", "aria-selected": String(mode === id), onclick: () => ((ui.tasksMode = id), id === "goals" ? drawGoals() : drawBoard()) }, label);
  return h(
    "div",
    { class: "tasks-head" },
    h("div", { class: "grow" }, h("h1", {}, "Tasks"), h("p", { class: "lead" }, mode === "goals" ? "What the work is for: measurable goals for your organization and each group, and the projects that move them forward. Agents are told the goal their task serves." : "Every task in your organization. Each agent works through its own queue, one task at a time, most important first. Finished work comes back to you to accept or send back.")),
    h("div", { class: "segmented tasks-mode", role: "tablist", "aria-label": "View" }, tab("board", "Board"), tab("goals", "Goals")),
    mode === "goals" ? h("button", { class: "primary", onclick: () => goalDialog() }, "+ Goal") : h("button", { class: "primary", onclick: () => newTaskDialog() }, "+ New task"),
  );
}

/** Opens the board at one task. */
function openTask(id) {
  ui.taskOpen = id;
  if (state.view !== "tasks") go("tasks");
  else tasksView();
}

async function tasksView() {
  ui.body.className = "body";
  ui.log = null;
  ui.tasksCol ??= null;
  const col = h("div", { class: "tasks" });
  ui.tasksCol = col;
  const panel = h("aside", { class: "taskpanel", hidden: true, "aria-label": "Task" });
  ui.taskPanel = panel;
  fill(ui.body, h("main", { class: "center wide" }, col), panel);
  await refreshTasks(true);
}

/** Loads the tasks and draws the board; `full` also redraws an open task's panel. */
async function refreshTasks(full = false) {
  let data;
  let planned;
  try {
    [data, planned] = await Promise.all([api("GET", "work"), api("GET", "goals")]);
  } catch (err) {
    return ui.tasksCol && fill(ui.tasksCol, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "tasks" || !ui.tasksCol) return;
  const signature = JSON.stringify([data.items.map((t) => [t.id, t.status, t.detail, t.queue, t.priority, t.title, t.comments, t.owner, t.subtasks.open, t.goal, t.projectId, t.pausedAt]), planned, data.pausedAgents]);
  if (!full && signature === ui.tasksSignature) return;
  ui.tasksSignature = signature;
  ui.tasks = data.items;
  ui.pausedAgents = data.pausedAgents ?? [];
  ui.goals = planned.goals;
  ui.projects = planned.projects;
  if (ui.tasksMode === "goals") return drawGoals();
  drawBoard();
  // The open task's panel follows along, unless the owner is typing in it.
  if (ui.taskOpen && (full || !ui.taskPanel.contains(document.activeElement))) drawTaskPanel(ui.taskOpen);
  else if (!ui.taskOpen) ui.taskPanel.hidden = true;
}

function drawBoard() {
  const col = ui.tasksCol;
  const org = activeOrg();
  const crew = new Map((state.crew?.bots ?? []).map((b) => [b.id, b]));
  ui.taskFilter ??= { who: "", q: "", cancelled: false, plan: "" };
  const f = ui.taskFilter;
  const twoWeeks = Date.now() - 14 * 86400_000;
  const inPlan = (t) => !f.plan || (f.plan.startsWith("goal:") ? t.goal === f.plan.slice(5) : t.projectId === f.plan.slice(8));
  const shown = ui.tasks.filter((t) => (!f.who || t.owner === f.who) && inPlan(t) && (!f.q || `${t.number} ${t.title} ${t.ownerName}`.toLowerCase().includes(f.q.toLowerCase())) && (t.status !== "done" || Date.parse(t.updatedAt) > twoWeeks));
  const plan = h(
    "select",
    { "aria-label": "Goal or project", onchange: (e) => ((f.plan = e.target.value), drawBoard()) },
    h("option", { value: "" }, "All goals and projects"),
    (ui.goals ?? []).filter((g) => g.status === "active").map((g) => h("option", { value: `goal:${g.id}`, selected: f.plan === `goal:${g.id}` }, `Goal: ${g.title}`)),
    (ui.projects ?? []).filter((p) => p.status !== "done").map((p) => h("option", { value: `project:${p.id}`, selected: f.plan === `project:${p.id}` }, `Project: ${p.title}`)),
  );
  const search = h("input", { type: "search", value: f.q, placeholder: "Find a task", "aria-label": "Find a task" });
  search.addEventListener("input", () => ((f.q = search.value), drawBoard(), document.querySelector(".tasks input[type=search]")?.focus()));
  const who = h("select", { "aria-label": "Whose tasks", onchange: (e) => ((f.who = e.target.value), drawBoard()) }, h("option", { value: "" }, "Everyone"), org.members.map((m) => h("option", { value: m.bot, selected: f.who === m.bot }, m.title)));
  const counts = Object.fromEntries(TASK_COLUMNS.map(([key]) => [key, shown.filter((t) => columnOf(t) === key).length]));
  const card = (t) => {
    const bot = crew.get(t.owner);
    return h(
      "button",
      { class: `taskcard pri-${t.priority} ${ui.taskOpen === t.id ? "on" : ""} ${t.status === "paused" ? "paused" : ""}`, style: bot ? botStyle(bot) : "", onclick: () => ((ui.taskOpen = t.id), drawBoard(), drawTaskPanel(t.id)) },
      h("div", { class: "taskcardtop" }, h("span", { class: "tasknum" }, `#${t.number}`), t.priority !== "normal" ? h("span", { class: `taskpri ${t.priority}` }, PRIORITY_WORDS[t.priority]) : null, t.status === "todo" && t.queue ? h("span", { class: "taskqueue" }, ordinal(t.queue)) : t.status === "paused" ? h("span", { class: "taskqueue" }, "⏸ Paused") : null),
      h("b", { class: "tasktitle" }, t.title),
      t.detail ? h("span", { class: `taskdetail ${t.status === "blocked" ? "bad" : ""}` }, t.detail) : null,
      t.projectName || t.goalTitle ? h("span", { class: "taskplan", title: t.goalTitle ? `Serves the goal: ${t.goalTitle}` : "" }, t.projectName ? `◇ ${t.projectName}` : `◎ ${t.goalTitle}`) : null,
      h("div", { class: "taskmeta" }, bot ? keycap(bot, 18, t.status === "working" ? "working" : "", bot.type) : null, h("span", { class: "grow" }, t.ownerName), t.subtasks.total ? h("span", { title: "Sub-tasks still open" }, `◫ ${t.subtasks.open}/${t.subtasks.total}`) : null, t.comments ? h("span", { title: "Comments" }, `💬 ${t.comments}`) : null, t.cost >= 0.01 ? h("span", {}, money(t.cost)) : null),
    );
  };
  fill(
    col,
    tasksHead(),
    h("div", { class: "row tasks-tools" }, search, who, plan, h("label", { class: "power" }, h("input", { type: "checkbox", checked: f.cancelled, onchange: (e) => ((f.cancelled = e.target.checked), drawBoard()) }), "Show cancelled")),
    pauseBar(org, f.who),
    h(
      "div",
      { class: "taskboard" },
      TASK_COLUMNS.map(([key, label, hint]) => {
        const items = shown.filter((t) => columnOf(t) === key).sort((a, b) => (key === "todo" ? ["urgent", "high", "normal", "low"].indexOf(a.priority) - ["urgent", "high", "normal", "low"].indexOf(b.priority) || a.number - b.number : b.updatedAt.localeCompare(a.updatedAt)));
        return h("section", { class: `taskcol col-${key}` }, h("header", {}, h("b", {}, label), h("span", { class: "count" }, counts[key]), h("span", { class: "note small taskcolhint" }, hint)), items.length ? items.map(card) : h("p", { class: "note small taskempty" }, key === "todo" ? "Nothing waiting." : key === "needs" ? "Nothing needs you." : "None."));
      }),
    ),
    f.cancelled ? h("div", { class: "taskcancelled" }, h("h3", {}, "Cancelled"), ui.tasks.filter((t) => t.status === "cancelled").map(card)) : null,
  );
}

/**
 * Staying in charge: which agents are paused (with Resume), and buttons to pause the agent being looked at or all
 * work. Pausing stops work under way at a clean point; it leaves a hand-over note and carries on from it when resumed.
 */
function pauseBar(org, who) {
  const paused = ui.pausedAgents ?? [];
  const pausedIds = new Set(paused.map((a) => a.bot));
  const everyone = org.members.length > 0 && org.members.every((m) => pausedIds.has(m.bot));
  const send = (action, body) => attempt(async () => (await api("POST", `work/agents/${action}`, body), await refreshTasks(true)), ui.tasksCol);
  const whoName = who ? org.members.find((m) => m.bot === who)?.title : "";
  return h(
    "div",
    { class: "pausebar" },
    paused.length
      ? h("div", { class: "banner grow" }, everyone ? "All work is paused. Nothing new starts until you resume." : `Paused: ${paused.map((a) => `the ${a.name}`).join(", ")}. Their tasks wait until you resume them.`)
      : null,
    who && !everyone
      ? pausedIds.has(who)
        ? h("button", { class: "small primary", onclick: () => send("resume", { agents: [who] }) }, `Resume the ${whoName}`)
        : h("button", { class: "small", onclick: () => confirm(`Pause the ${whoName}?\n\nWhat it is doing stops at a clean point and leaves a hand-over note. It starts nothing new until you resume it.`) && send("pause", { agents: [who] }) }, `⏸ Pause the ${whoName}`)
      : null,
    paused.length ? h("button", { class: "small primary", onclick: () => send("resume", { all: true }) }, everyone ? "Resume all work" : "Resume all") : null,
    !everyone && org.members.length
      ? h("button", { class: "small", onclick: () => confirm("Pause all work?\n\nEvery agent stops what it is doing at a clean point and leaves a hand-over note. Nothing new starts until you resume. Chats with Talqava still work.") && send("pause", { all: true }) }, "⏸ Pause all work")
      : null,
  );
}

async function drawTaskPanel(id) {
  const panel = ui.taskPanel;
  if (!panel) return;
  let data;
  try {
    data = await api("GET", `work/${id}`);
  } catch (err) {
    ui.taskOpen = null;
    panel.hidden = true;
    return;
  }
  if (ui.taskOpen !== id) return;
  const { item: t, comments, subtasks, quest } = data;
  const org = activeOrg();
  const crew = new Map((state.crew?.bots ?? []).map((b) => [b.id, b]));
  const act = (fn) => attempt(async () => (await fn(), await refreshTasks(true)), panel);
  const patch = (body) => act(() => api("PATCH", `work/${id}`, body));
  const title = h("input", { class: "tasktitlebox", value: t.title, maxlength: 140, "aria-label": "Task title" });
  title.addEventListener("change", () => title.value.trim() && title.value.trim() !== t.title && patch({ title: title.value.trim() }));
  const priority = h("select", { "aria-label": "Priority", onchange: (e) => patch({ priority: e.target.value }) }, ["urgent", "high", "normal", "low"].map((p) => h("option", { value: p, selected: t.priority === p }, PRIORITY_WORDS[p])));
  const ownerBot = crew.get(t.owner);
  // A task not started can go to anyone; a stopped one can be given to someone else, who picks up from its hand-over note.
  const owner =
    t.status === "todo"
      ? h("select", { "aria-label": "Assigned to", onchange: (e) => patch({ owner: e.target.value }) }, org.members.map((m) => h("option", { value: m.bot, selected: m.bot === t.owner }, m.title)))
      : t.status === "blocked" || t.status === "paused"
        ? h(
            "div",
            {},
            h("span", { class: "row" }, ownerBot ? keycap(ownerBot, 20, "stuck", ownerBot.type) : null, t.ownerName),
            h(
              "select",
              {
                "aria-label": "Give it to someone else",
                onchange: (e) => e.target.value && confirm(`Give task #${t.number} to the ${org.members.find((m) => m.bot === e.target.value)?.title}?\n\nThey start a fresh run from the hand-over note it left.`) ? patch({ owner: e.target.value }) : (e.target.value = ""),
              },
              h("option", { value: "" }, "Give it to someone else…"),
              org.members.filter((m) => m.bot !== t.owner).map((m) => h("option", { value: m.bot }, m.title)),
            ),
          )
        : h("span", { class: "row" }, ownerBot ? keycap(ownerBot, 20, "", ownerBot.type) : null, t.ownerName);
  const parent = t.parent ? ui.tasks?.find((x) => x.id === t.parent) : null;
  const comment = h("textarea", { rows: 3, placeholder: t.status === "review" ? "What should change? Sending it back wakes the agent." : "Write a note for the agent…", "aria-label": "Comment" });
  const sendComment = () => comment.value.trim() && act(async () => (await api("POST", `work/${id}/comment`, { text: comment.value }), (comment.value = "")));
  comment.addEventListener("keydown", (e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && sendComment());
  const reportText = quest?.said;
  fill(
    panel,
    h("div", { class: "taskpanelhead" }, h("span", { class: "tasknum" }, `#${t.number}`), h("span", { class: `taskstatus st-${t.status}` }, TASK_STATUS_WORDS[t.status]), h("span", { class: "grow" }), h("button", { class: "plain small", "aria-label": "Close", onclick: () => ((ui.taskOpen = null), (panel.hidden = true), drawBoard()) }, "✕")),
    title,
    t.detail ? h("div", { class: `banner ${t.status === "blocked" ? "error" : ""}` }, t.detail) : null,
    h(
      "div",
      { class: "taskactions row wrap" },
      t.status === "review" ? h("button", { class: "primary small", onclick: () => act(() => api("POST", `work/${id}/accept`)) }, "Accept") : null,
      t.status === "waiting" && /plan/i.test(t.detail ?? "") && t.quest ? h("button", { class: "primary small", onclick: () => go("quest", t.quest) }, "Review its plan") : null,
      t.status === "blocked" ? h("button", { class: "primary small", onclick: () => act(() => api("POST", `work/${id}/retry`)) }, "Try again") : null,
      t.pausedAt ? h("button", { class: "primary small", onclick: () => act(() => api("POST", `work/${id}/resume`)) }, "Resume") : null,
      t.status === "paused" && !t.pausedAt ? h("button", { class: "primary small", onclick: () => act(() => api("POST", "work/agents/resume", { agents: [t.owner] })) }, `Resume the ${t.ownerName}`) : null,
      !t.pausedAt && !["done", "cancelled", "review"].includes(t.status)
        ? h("button", { class: "small", title: "Stops it at a clean point (it leaves a hand-over note) and keeps it from starting. Resume carries on.", onclick: () => act(() => api("POST", `work/${id}/pause`)) }, t.subtasks.open ? "⏸ Pause it and its sub-tasks" : "⏸ Pause")
        : null,
      t.status === "waiting" && t.quest ? h("button", { class: "primary small", onclick: () => go("quest", t.quest) }, "Answer it") : null,
      t.quest ? h("button", { class: "small", onclick: () => go("quest", t.quest) }, "Open the work") : null,
      t.status !== "done" && t.status !== "cancelled" ? h("button", { class: "small", onclick: () => newTaskDialog({ parent: t }) }, "+ Sub-task") : null,
    ),
    h(
      "dl",
      { class: "taskfacts" },
      h("dt", {}, "Assigned to"),
      h("dd", {}, owner),
      h("dt", {}, "Priority"),
      h("dd", {}, t.status === "done" || t.status === "cancelled" ? PRIORITY_WORDS[t.priority] : priority),
      t.status === "todo" && t.queue ? [h("dt", {}, "Queue"), h("dd", {}, t.queue === 1 ? "Next, when the agent is free" : `${ordinal(t.queue)} for the ${t.ownerName}`)] : null,
      parent ? [h("dt", {}, "Part of"), h("dd", {}, h("button", { class: "plain link", onclick: () => openTask(parent.id) }, `#${parent.number} ${parent.title}`))] : null,
      h("dt", {}, "Project"),
      h("dd", {}, h("select", { "aria-label": "Project", onchange: (e) => patch({ projectId: e.target.value || null }) }, h("option", { value: "" }, "None"), (ui.projects ?? []).filter((p) => p.status !== "done" || p.id === t.projectId).map((p) => h("option", { value: p.id, selected: p.id === t.projectId }, p.title)))),
      h("dt", {}, "Goal"),
      h("dd", {}, t.projectId ? h("span", { class: "note" }, t.goalTitle ? `${t.goalTitle} (through its project)` : "Its project has no goal") : h("select", { "aria-label": "Goal", onchange: (e) => patch({ goal: e.target.value || null }) }, h("option", { value: "" }, "None"), (ui.goals ?? []).filter((g) => g.status === "active" || g.id === t.goal).map((g) => h("option", { value: g.id, selected: g.id === t.goal }, g.title)))),
      h("dt", {}, "Created"),
      h("dd", {}, `${shortWhen(t.createdAt)} by ${t.createdByName}`),
      t.cost >= 0.001 ? [h("dt", {}, "Cost so far"), h("dd", {}, money(t.cost))] : null,
    ),
    t.description && t.description !== t.title ? [h("div", { class: "label" }, "What was asked"), h("div", { class: "md taskdesc" }, renderMarkdown(t.description))] : null,
    reportText ? [h("div", { class: "label" }, t.status === "working" ? "Latest from the agent" : "Its report"), h("div", { class: "md taskreport" }, renderMarkdown(reportText))] : null,
    subtasks.length
      ? [
          h("div", { class: "label" }, `Sub-tasks (${subtasks.filter((s) => s.status !== "done" && s.status !== "cancelled").length} open)`),
          h("div", { class: "tasksubs" }, subtasks.map((s) => h("button", { class: "plain tasksub", onclick: () => openTask(s.id) }, h("span", { class: `taskdot st-${s.status}`, title: TASK_STATUS_WORDS[s.status] }), h("span", { class: "grow" }, `#${s.number} ${s.title}`), h("span", { class: "note small" }, s.ownerName)))),
        ]
      : null,
    h("div", { class: "label" }, `Comments${comments.length ? ` (${comments.length})` : ""}`),
    h("div", { class: "taskcomments" }, comments.map((c) => h("div", { class: `taskcomment ${c.author === "owner" ? "mine" : ""}` }, h("div", { class: "note small" }, `${c.authorName} · ${shortWhen(c.at)}${c.author === "owner" && !c.delivered ? " · goes to the agent when its current step ends" : ""}`), h("div", {}, c.text)))),
    t.status !== "cancelled" ? [comment, h("div", { class: "row" }, h("button", { class: t.status === "review" ? "small" : "small primary", onclick: sendComment }, t.status === "review" ? "Send back with this comment" : "Comment"), h("span", { class: "note small" }, "⌘↵ to send"))] : null,
    t.status !== "done" && t.status !== "cancelled" ? h("div", { class: "taskdanger" }, h("button", { class: "plain small danger", onclick: () => confirm(`Cancel task #${t.number}${t.subtasks.open ? ` and its ${t.subtasks.open} open sub-task${t.subtasks.open === 1 ? "" : "s"}` : ""}? Work done so far is kept.`) && act(() => api("POST", `work/${id}/cancel`)) }, "Cancel task")) : null,
  );
  panel.hidden = false;
}

/** A new task: what is wanted, who does it, how important it is. Under `parent` when given. */
async function newTaskDialog({ parent = null, owner = "", text = "", goal = "", projectId = "" } = {}) {
  const org = activeOrg();
  if (!org.members.length) return go("team");
  if (!ui.goals) await api("GET", "goals").then((p) => ((ui.goals = p.goals), (ui.projects = p.projects))).catch(() => {});
  const serves = h(
    "select",
    { "aria-label": "Serves" },
    h("option", { value: "" }, parent ? "The same as its parent task" : "No goal or project"),
    (ui.projects ?? []).filter((p) => p.status === "active").map((p) => h("option", { value: `project:${p.id}`, selected: p.id === projectId }, `Project: ${p.title}`)),
    (ui.goals ?? []).filter((g) => g.status === "active").map((g) => h("option", { value: `goal:${g.id}`, selected: g.id === goal && !projectId }, `Goal: ${g.title}`)),
  );
  const title = h("input", { maxlength: 140, placeholder: "e.g. Find ten wholesale bakeries near us", "aria-label": "Task" });
  const details = h("textarea", { rows: 5, placeholder: "What should be done, what good looks like, anything they need to know (optional)", "aria-label": "Details" }, text);
  const who = h("select", { "aria-label": "Assign to" }, org.members.map((m) => h("option", { value: m.bot, selected: m.bot === (owner || parent?.owner) }, `${m.title} · ${m.department}`)));
  const priority = h("select", { "aria-label": "Priority" }, ["urgent", "high", "normal", "low"].map((p) => h("option", { value: p, selected: p === (parent?.priority ?? "normal") }, PRIORITY_WORDS[p])));
  const got = await libDialog(
    parent ? `New sub-task of #${parent.number}` : "New task",
    h("div", { class: "composeform" }, h("label", {}, "Task", title), h("label", {}, "Details", details), h("div", { class: "row" }, h("label", { class: "grow" }, "Assign to", who), h("label", {}, "Priority", priority)), (ui.goals ?? []).length || (ui.projects ?? []).length ? h("label", {}, "Serves", serves) : null, h("p", { class: "note small" }, "It goes into the agent's queue and starts when the agent is free, most important first. You'll review the result.")),
    [["Create task", () => ({ title: title.value.trim(), description: details.value.trim(), owner: who.value, priority: priority.value, ...(serves.value.startsWith("project:") ? { projectId: serves.value.slice(8) } : serves.value.startsWith("goal:") ? { goal: serves.value.slice(5) } : {}) }), true]],
  );
  if (!got || !(got.title || got.description)) return;
  await attempt(async () => {
    const reply = await createTask({ ...got, parent: parent?.id, project: state.project || undefined });
    if (reply?.item) openTask(reply.item.id);
  });
}

/** Creates a task, with the same up-front checks as before; returns { item, quest } or null when the owner backed out. */
async function createTask(payload) {
  const reply = await api("POST", "work", payload);
  if (!reply.needs) return reply;
  const choice = await needsDialog(reply.needs, reply.repositories ?? []);
  if (!choice) return null;
  if (choice.project) return createTask({ ...payload, project: choice.project });
  if (choice.anyway) return createTask({ ...payload, anyway: true });
  return null;
}

// ---------- tasks: goals and projects ----------
/** "12 of 40 customers" for a goal with a target, or "" without one. */
const goalProgress = (g) => (g.target != null ? `${g.current ?? 0} of ${g.target}${g.unit ? ` ${g.unit}` : ""}` : "");
/** "Due in 12 days", "Due today", "3 days overdue", or "". */
function dueWords(due) {
  if (!due) return "";
  const days = Math.round((Date.parse(`${due}T12:00:00`) - Date.now()) / 86400_000);
  const day = new Date(`${due}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
  return days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue (${day})` : days === 0 ? "Due today" : `Due ${day}, in ${days} day${days === 1 ? "" : "s"}`;
}

function drawGoals() {
  const col = ui.tasksCol;
  if (!col) return;
  const org = activeOrg();
  const all = ui.goals ?? [];
  const projects = ui.projects ?? [];
  ui.goalsShowAll ??= false;
  const shown = all.filter((g) => ui.goalsShowAll || g.status === "active");
  const sections = [[null, "The whole organization"], ...(org.groups ?? []).map((g) => [g.id, g.name])];
  const act = (fn) => attempt(async () => (await fn(), await refreshTasks(true)), col);
  const bar = (value, max, cls = "") => h("span", { class: `goalbar ${cls}`, role: "progressbar", "aria-valuenow": String(value), "aria-valuemax": String(max) }, h("i", { style: `width:${max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0}%` }));
  const card = (g) => {
    const mine = projects.filter((p) => p.goal === g.id);
    const now = h("input", { type: "number", value: g.current ?? "", step: "any", "aria-label": `Where “${g.title}” stands now`, class: "goalnow" });
    now.addEventListener("change", () => act(() => api("PATCH", `goals/${g.id}`, { current: now.value === "" ? null : Number(now.value) })));
    const late = g.due && g.status === "active" && Date.parse(`${g.due}T23:59:59`) < Date.now();
    return h(
      "section",
      { class: `card goalcard st-${g.status}` },
      h("div", { class: "row" }, h("span", { class: "goalmark", "aria-hidden": "true" }, g.status === "achieved" ? "✓" : "◎"), h("b", { class: "grow goaltitle" }, g.title), g.status !== "active" ? h("span", { class: "pill" }, g.status === "achieved" ? "Achieved" : "Dropped") : null, h("button", { class: "plain small", onclick: () => goalDialog(g) }, "Edit")),
      g.target != null
        ? h("div", { class: "goalnumber" }, bar(g.current ?? 0, g.target, (g.current ?? 0) >= g.target ? "full" : ""), h("div", { class: "row" }, h("span", { class: "grow" }, h("b", {}, goalProgress(g))), g.status === "active" ? h("label", { class: "note small goalupdate" }, "Now at", now) : null))
        : null,
      h("div", { class: "row note small" }, g.due ? h("span", { class: late ? "bad" : "" }, dueWords(g.due)) : null, h("span", { class: "grow" }), h("span", {}, g.tasks.total ? `${g.tasks.done} of ${g.tasks.total} task${g.tasks.total === 1 ? "" : "s"} done` : "No tasks yet")),
      g.tasks.total ? bar(g.tasks.done, g.tasks.total, "tasks") : null,
      mine.length
        ? h(
            "div",
            { class: "goalprojects" },
            mine.map((p) =>
              h(
                "div",
                { class: `goalproject st-${p.status}` },
                h("span", { class: "grow" }, h("b", {}, `◇ ${p.title}`), h("span", { class: "note small" }, [p.leadName ? `Led by ${p.leadName}` : "No lead", p.tasks.total ? `${p.tasks.done} of ${p.tasks.total} tasks done` : "No tasks yet", p.status !== "active" ? (p.status === "done" ? "Done" : "Paused") : null].filter(Boolean).join(" · "))),
                h("button", { class: "plain small", onclick: () => (((ui.taskFilter ??= { who: "", q: "", cancelled: false, plan: "" }).plan = `project:${p.id}`), (ui.tasksMode = "board"), drawBoard()) }, "Tasks"),
                h("button", { class: "plain small", onclick: () => newTaskDialog({ projectId: p.id, owner: p.lead || "" }) }, "+ Task"),
                h("button", { class: "plain small", onclick: () => projectDialog({ project: p }) }, "Edit"),
              ),
            ),
          )
        : null,
      g.status === "active"
        ? h(
            "div",
            { class: "row goalactions" },
            h("button", { class: "small", onclick: () => projectDialog({ goal: g }) }, "+ Project"),
            h("button", { class: "small", onclick: () => newTaskDialog({ goal: g.id }) }, "+ Task"),
            g.tasks.total ? h("button", { class: "plain small", onclick: () => (((ui.taskFilter ??= { who: "", q: "", cancelled: false, plan: "" }).plan = `goal:${g.id}`), (ui.tasksMode = "board"), drawBoard()) }, "See its tasks") : null,
            h("span", { class: "grow" }),
            h("button", { class: "plain small", onclick: () => act(() => api("PATCH", `goals/${g.id}`, { status: "achieved" })) }, "Mark achieved"),
          )
        : h("div", { class: "row goalactions" }, h("button", { class: "plain small", onclick: () => act(() => api("PATCH", `goals/${g.id}`, { status: "active" })) }, "Make it active again")),
    );
  };
  const loose = projects.filter((p) => !p.goal);
  fill(
    col,
    tasksHead(),
    org.mission ? h("div", { class: "card goalmission" }, h("span", { class: "label" }, "Mission"), h("div", {}, org.mission)) : h("div", { class: "banner" }, "Your organization has no mission yet. ", h("button", { class: "plain link", onclick: () => go("team") }, "Write one on the Organization page"), " so every goal and task can trace back to it."),
    all.length
      ? sections.map(([gid, name]) => {
          const here = shown.filter((g) => (g.group ?? null) === gid);
          return here.length ? h("div", { class: "goalsection" }, h("h3", {}, name), h("div", { class: "goalgrid" }, here.map(card))) : null;
        })
      : h(
          "div",
          { class: "card goalempty" },
          h("b", {}, "Set your first goal"),
          h("p", { class: "note" }, "A goal is something you can measure, with a date: “40 wholesale customers by March”, “$20,000 in December sales”, “Every order delivered on time this month”. Your agents are told the goal each task serves, and leads put what moves it forward first."),
          h("button", { class: "primary", onclick: () => goalDialog() }, "+ Goal"),
        ),
    loose.length ? h("div", { class: "goalsection" }, h("h3", {}, "Projects without a goal"), h("div", { class: "goalprojects" }, loose.map((p) => h("div", { class: "goalproject" }, h("span", { class: "grow" }, h("b", {}, `◇ ${p.title}`), h("span", { class: "note small" }, p.leadName ? `Led by ${p.leadName}` : "No lead")), h("button", { class: "plain small", onclick: () => projectDialog({ project: p }) }, "Edit"))))) : null,
    all.some((g) => g.status !== "active") ? h("label", { class: "power" }, h("input", { type: "checkbox", checked: ui.goalsShowAll, onchange: (e) => ((ui.goalsShowAll = e.target.checked), drawGoals()) }), "Show achieved and dropped goals") : null,
  );
}

/** Adds a goal, or edits one (`g`). */
async function goalDialog(g = null) {
  const org = activeOrg();
  const title = h("input", { value: g?.title ?? "", maxlength: 160, placeholder: "e.g. 40 wholesale customers", "aria-label": "Goal" });
  const target = h("input", { type: "number", step: "any", value: g?.target ?? "", placeholder: "e.g. 40", "aria-label": "Target" });
  const current = h("input", { type: "number", step: "any", value: g?.current ?? "", placeholder: "e.g. 12", "aria-label": "Now at" });
  const unit = h("input", { value: g?.unit ?? "", maxlength: 30, placeholder: "e.g. customers", "aria-label": "Counted in" });
  const due = h("input", { type: "date", value: g?.due ?? "", "aria-label": "By" });
  const group = h("select", { "aria-label": "For" }, h("option", { value: "" }, "The whole organization"), (org.groups ?? []).map((x) => h("option", { value: x.id, selected: g?.group === x.id }, x.name)));
  const extra = g ? h("div", { class: "row" }, h("button", { class: "small", type: "button", onclick: () => (dialogChoice = "drop") }, g.status === "dropped" ? "Make it active" : "Drop this goal"), h("button", { class: "small danger", type: "button", onclick: () => (dialogChoice = "remove") }, "Remove")) : null;
  let dialogChoice = null;
  const body = h("div", { class: "composeform" }, h("label", {}, "Goal", title), h("div", { class: "row" }, h("label", { class: "grow" }, "Target", target), h("label", { class: "grow" }, "Now at", current), h("label", { class: "grow" }, "Counted in", unit)), h("div", { class: "row" }, h("label", { class: "grow" }, "By", due), h("label", { class: "grow" }, "For", group)), h("p", { class: "note small" }, "Make it measurable if you can: a number to reach and a date. Agents are told the goal each task serves."), extra);
  if (extra) extra.addEventListener("click", (e) => e.target.closest("button") && body.closest("dialog")?.querySelector(".row.end button.primary")?.click());
  const got = await libDialog(g ? "Edit the goal" : "New goal", body, [[g ? "Save" : "Set the goal", () => ({ title: title.value.trim(), target: target.value === "" ? null : Number(target.value), current: current.value === "" ? null : Number(current.value), unit: unit.value.trim(), due: due.value || null, group: group.value || null }), true]]);
  if (!got) return;
  await attempt(async () => {
    if (g && dialogChoice === "remove") {
      if (!confirm(`Remove the goal “${g.title}”? Its projects and tasks stay, without it.`)) return;
      await api("DELETE", `goals/${g.id}`);
    } else if (g && dialogChoice === "drop") await api("PATCH", `goals/${g.id}`, { ...got, status: g.status === "dropped" ? "active" : "dropped" });
    else if (g) await api("PATCH", `goals/${g.id}`, got);
    else await api("POST", "goals", got);
    ui.tasksMode = "goals";
    await refreshTasks(true);
  }, ui.tasksCol);
}

/** Adds a project under a goal, or edits one. */
async function projectDialog({ project = null, goal = null } = {}) {
  const org = activeOrg();
  const title = h("input", { value: project?.title ?? "", maxlength: 160, placeholder: "e.g. Wholesale outreach in the north of town", "aria-label": "Project" });
  const about = h("textarea", { rows: 3, placeholder: "What it covers (optional)", "aria-label": "About" }, project?.description ?? "");
  const forGoal = h("select", { "aria-label": "Goal" }, h("option", { value: "" }, "No goal"), (ui.goals ?? []).filter((x) => x.status === "active" || x.id === project?.goal).map((x) => h("option", { value: x.id, selected: (project?.goal ?? goal?.id) === x.id }, x.title)));
  const lead = h("select", { "aria-label": "Lead" }, h("option", { value: "" }, "No lead"), org.members.map((m) => h("option", { value: m.bot, selected: project?.lead === m.bot }, m.title)));
  const status = project ? h("select", { "aria-label": "Status" }, ["active", "paused", "done"].map((s) => h("option", { value: s, selected: project.status === s }, { active: "Active", paused: "Paused", done: "Done" }[s]))) : null;
  const got = await libDialog(project ? "Edit the project" : "New project", h("div", { class: "composeform" }, h("label", {}, "Project", title), h("label", {}, "About", about), h("div", { class: "row" }, h("label", { class: "grow" }, "Goal", forGoal), h("label", { class: "grow" }, "Led by", lead), status ? h("label", {}, "Status", status) : null), h("p", { class: "note small" }, "Tasks in a project serve its goal. Its lead is the natural owner of its tasks.")), [[project ? "Save" : "Start the project", () => ({ title: title.value.trim(), description: about.value.trim(), goal: forGoal.value || null, lead: lead.value || null, ...(status ? { status: status.value } : {}) }), true]]);
  if (!got) return;
  await attempt(async () => {
    if (project) await api("PATCH", `projects/${project.id}`, got);
    else await api("POST", "projects", got);
    ui.tasksMode = "goals";
    await refreshTasks(true);
  }, ui.tasksCol);
}
