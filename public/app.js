// The Talqava Agents window. No framework: small helpers that build DOM nodes.
// Layout: a top bar (repository, command box, spending, settings) over a body
// that each view fills: home base, a quest, a bot, chats, and the other pages.
import { renderMarkdown } from "/markdown.js";

const app = document.getElementById("app");
const state = {
  config: null,
  convs: [],
  quests: [],
  crew: null,
  view: "home",
  convId: null,
  botId: null,
  quest: null,
  running: false,
  source: null,
  selectedBot: null,
  project: "",
};
const ui = {}; // live nodes of the open view

try {
  state.project = localStorage.getItem("talqava.project") || "";
  state.selectedBot = localStorage.getItem("talqava.bot");
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
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
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
    h("div", { class: "brand" }, "Talqava Agents"),
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
  document.title = "Talqava Agents";
  if (!state.config.projects.includes(state.project)) state.project = "";
  if (needsKey(state.config)) state.view = "settings";
  await Promise.all([loadCrew(), loadQuests(), refreshList()]);
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
  if (ticks % 3 === 0) await refreshList();
  renderSpent();
  if (questSignature() !== before) {
    if (state.view === "home") renderHome();
    if (state.view === "quest") refreshQuest();
  }
  if (state.view === "chat" && ticks % 3 === 0) renderChatList();
}

const questSignature = () =>
  JSON.stringify(state.quests.map((q) => [q.id, q.status, q.steps, q.outcome, q.approvals.length, q.activity?.output?.length ?? 0]));

/** Kept for the pages that call it after saving settings. */
function renderSide() {
  renderTop();
}

// ---------- the window frame ----------
function render() {
  ui.top = h("header", { class: "top" });
  ui.body = h("div", { class: "body" });
  fill(app, ui.top, ui.body);
  renderTop();
  renderBody();
}

function go(view, id = null) {
  state.view = view;
  state.convId = view === "chat" || view === "quest" ? id : null;
  state.botId = view === "bot" ? id : null;
  closePalette();
  renderBody();
}

function renderBody() {
  state.source?.close();
  state.source = null;
  ui.log = null;
  ui.body.className = "body";
  const views = { home: homeView, quest: questView, bot: botView, chat: chatView, memory: memoryView, skills: skillsView, jobs: jobsView, settings: settingsView };
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
  fill(ui.top, 
    h("button", { class: "plain brand", onclick: () => go("home"), title: "Home base", "aria-label": "Talqava Agents, home base" }, "TALQAVA", h("span", { class: "cursor", "aria-hidden": "true" })),
    h(
      "div",
      { class: "repo", title: state.project || "Quests work in the workspace folder. Add repositories under Settings." },
      "[",
      repo,
      "]",
      state.project && state.crew?.branch ? [h("span", { class: "on" }, "on"), state.crew.branch] : null,
    ),
    paletteBox(),
    ui.spent,
    h("button", { onclick: () => go("settings") }, "Settings"),
  );
  renderSpent();
}

function renderSpent() {
  if (!ui.spent) return;
  const today = new Date().toDateString();
  const spent = state.quests.filter((q) => new Date(q.createdAt).toDateString() === today).reduce((sum, q) => sum + (q.cost || 0), 0);
  fill(ui.spent, "Spent today on quests", h("b", {}, money(spent)));
}

// ---------- the command box ----------
const COMMANDS = [
  ["Home base", () => go("home")],
  ["New chat", () => go("chat")],
  ["Hatch a bot", () => go("bot", "new")],
  ["Memory", () => go("memory")],
  ["Skills", () => go("skills")],
  ["Schedules", () => go("jobs")],
  ["Settings", () => go("settings")],
];

function paletteBox() {
  ui.palette = h("input", { type: "text", placeholder: paletteHint(), "aria-label": "Send a quest or run a command", autocomplete: "off" });
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
  return bot ? `Send ${bot.name} on a quest, or type @name, or a command` : "Send a quest or run a command";
}

function paletteItems() {
  const text = ui.palette?.value.trim() ?? "";
  const bots = state.crew?.bots ?? [];
  const items = [];
  const mention = /^@([\w-]+)\s*(.*)$/s.exec(text);
  const target = mention ? bots.find((b) => b.id === mention[1].toLowerCase() || b.name.toLowerCase().startsWith(mention[1].toLowerCase())) : bots.find((b) => b.id === state.selectedBot);
  const task = mention ? mention[2].trim() : text;
  if (task && target) items.push({ label: `Send ${target.name} on a quest`, what: task, bot: target, run: () => sendQuest(target, task) });
  if (task && !mention) {
    for (const bot of bots.filter((b) => b !== target).slice(0, 5)) items.push({ label: `Send ${bot.name} instead`, what: bot.type, bot, run: () => sendQuest(bot, task) });
  }
  const needle = text.toLowerCase();
  const commands = [...COMMANDS, ...bots.map((b) => [`Edit ${b.name}`, () => go("bot", b.id)])];
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
        item.bot ? keycap(item.bot.character, 22, "", item.bot.type) : null,
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

async function sendQuest(bot, text) {
  await attempt(async () => {
    const quest = await api("POST", "quests", { bot: bot.id, text, project: state.project || undefined });
    ui.palette.value = "";
    ui.palette.blur();
    await loadQuests();
    go("quest", quest.id);
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
    case "error":
      ui.log.append(h("div", { class: "banner error" }, event.text));
      break;
  }
  if (stick || event.type === "sync" || event.type === "user") ui.scroll.scrollTop = ui.scroll.scrollHeight;
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
  setRunning(live.running);
  for (const delta of live.partial) streamDelta(delta);
  for (const approval of live.approvals) addApproval(approval);
}

function showUsage(usage) {
  const total = (usage?.input || 0) + (usage?.output || 0);
  const cost = usage?.cost ? ` · about $${usage.cost < 0.1 ? usage.cost.toFixed(3) : usage.cost.toFixed(2)}` : "";
  ui.meta.textContent = total ? `${total.toLocaleString()} tokens${cost}` : "";
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

function addUser(text) {
  add(h("div", { class: "msg user" }, text));
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
  if (name === "browser") return `${input.action || ""} ${input.url || input.target || ""}`;
  const text = JSON.stringify(input);
  return text === "{}" ? "" : text;
}

const NAMES = { bash: "Shell", str_replace_based_edit_tool: "Files", web_search: "Web search", web_fetch: "Read page", http_request: "API call", memory: "Memory", skill: "Skill", schedule: "Schedule", browser: "Browser", conversation_search: "Search chats", code_execution: "Code" };

function toolCard(id, name, input, done) {
  const stateEl = h("span", { class: `state ${done ? "ok" : ""}` }, done ? "done" : "running…");
  const body = h("div", { class: "body" }, h("div", { class: "label" }, "Input"), h("pre", {}, typeof input === "string" ? input : JSON.stringify(input, null, 2)));
  const card = h("details", { class: "tool" }, h("summary", {}, h("span", { class: "name" }, NAMES[name] || name), h("span", { class: "what" }, summarize(name, input)), stateEl), body);
  ui.cards.set(id, { card, body, stateEl });
  return card;
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

// ---------- characters ----------
// Each agent is a keycap drawn in one white line. The legend printed on it is
// its job; the texture on its base tells it from the others. Status is carried
// by motion and a glyph, never by colour. Follows the Mono design boards.
const LEGENDS = { scout: "?", scribe: "Aa", maker: "</>", keeper: "zz", counter: "#", spark: "!" };
const TEXTURES = { dots: "Dots", lines: "Ruled lines", hatch: "Diagonal hatch", solid: "Solid", grid: "Grid", zigzag: "Zigzag", plain: "Plain" };
const TYPE_TEXTURES = { scout: "dots", scribe: "lines", maker: "hatch", keeper: "solid", counter: "grid", spark: "zigzag" };
const WHITE = "#f2f2f2";
const BLACK = "#0a0a0a";
const escapeXml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const legendOf = (character, type) => [...String(character?.legend || LEGENDS[type] || "?")].slice(0, 3).join("");
const textureOf = (character, type) => (TEXTURES[character?.texture] ? character.texture : TYPE_TEXTURES[type] || "plain");
let patternIds = 0;

/** A white-on-black texture as an SVG pattern, or null for solid and plain. */
function texturePattern(kind, id) {
  const body = {
    dots: `<circle cx="1.5" cy="1.5" r="0.75" fill="${WHITE}"/>`,
    lines: `<path d="M0 1.5h3" stroke="${WHITE}" stroke-width="0.7"/>`,
    hatch: `<path d="M-0.5 3.5l4-4M-0.5 0.5l1-1M2.5 3.5l1-1" stroke="${WHITE}" stroke-width="0.6"/>`,
    grid: `<path d="M0 0.3h3M0.3 0v3" stroke="${WHITE}" stroke-width="0.55"/>`,
    zigzag: `<path d="M0 2.2l0.75-1.4 0.75 1.4 0.75-1.4 0.75 1.4" fill="none" stroke="${WHITE}" stroke-width="0.6"/>`,
  }[kind];
  return body ? `<pattern id="${id}" width="3" height="3" patternUnits="userSpaceOnUse">${body}</pattern>` : null;
}

/** The face, set by the mood. */
function keyFace(mood) {
  const line = (d, w = 1.3) => `<path d="${d}" fill="none" stroke="${WHITE}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (mood === "working") return line("M16.8 24.5h4.4M26.8 24.5h4.4", 1.5) + line("M22 29.6h4", 1.2);
  if (mood === "waiting") return `<circle cx="19" cy="24.5" r="2.3" fill="${WHITE}"/><circle cx="29" cy="24.5" r="2.3" fill="${WHITE}"/><circle cx="24" cy="30.2" r="1.3" fill="${WHITE}"/>`;
  if (mood === "done") return line("M16.8 25.2q2.2-2.6 4.4 0M26.8 25.2q2.2-2.6 4.4 0", 1.4) + line("M21 28.8q3 3.4 6 0");
  if (mood === "stuck") return line("M17.4 23l3.2 3.2M20.6 23l-3.2 3.2M27.4 23l3.2 3.2M30.6 23l-3.2 3.2") + line("M21 30.4l1.5-1 1.5 1 1.5-1 1.5 1", 1.1);
  if (mood === "asleep") return line("M17 24.8h4M27 24.8h4") + line("M22.6 29.8h2.8", 1.1);
  return `<circle cx="19" cy="24.5" r="1.7" fill="${WHITE}"/><circle cx="29" cy="24.5" r="1.7" fill="${WHITE}"/>` + line("M21.8 29.4q2.2 2.4 4.4 0", 1.15);
}

/**
 * An agent, drawn as a keycap. Moods: "" (idle), working, waiting, done,
 * stuck, asleep; each moves in one way (see style.css), and idle is still.
 * Below 24 px only the cap and a bigger legend are drawn.
 */
function keycap(character, size = 40, mood = "", type = "") {
  const legend = legendOf(character, type);
  const text = escapeXml(legend);
  const texture = textureOf(character, type);
  const id = `tx${++patternIds}`;
  const pattern = texturePattern(texture, id);
  const baseFill = texture === "solid" ? WHITE : pattern ? `url(#${id})` : BLACK;
  let svg;
  if (size < 24) {
    const n = [...legend].length;
    const fs = n === 1 ? 14 : n === 2 ? 10.5 : 8;
    svg =
      `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24"><defs>${pattern ?? ""}</defs>` +
      `<rect x="1.5" y="2" width="21" height="20.5" rx="4.5" fill="${baseFill}" stroke="${WHITE}" stroke-width="1"/>` +
      `<rect x="3.2" y="2.4" width="17.6" height="15.6" rx="3.5" fill="${BLACK}" stroke="${WHITE}" stroke-width="1"/>` +
      `<text x="12" y="${(10.2 + fs * 0.36).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${fs}" font-weight="700" fill="${WHITE}">${text}</text></svg>`;
  } else {
    const big = size >= 64;
    const legendText = big
      ? `<text x="12" y="18.4" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="7.2" font-weight="700" fill="${WHITE}">${text}</text>`
      : `<text x="11" y="19.4" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="9.6" font-weight="800" fill="${WHITE}">${text}</text>`;
    const cursorX = (big ? 12 : 11) + (big ? 4.4 : 5.8) * [...legend].length + 0.6;
    const cursor = mood === "working" ? `<rect class="k-blink" x="${cursorX.toFixed(1)}" y="${big ? 12.4 : 12}" width="${big ? 3.2 : 3.6}" height="${big ? 6.4 : 8}" fill="${WHITE}"/>` : "";
    const extras =
      (mood === "waiting" ? `<rect class="k-march" x="2.5" y="5.5" width="43" height="38" rx="10.5" fill="none" stroke="${WHITE}" stroke-width="1.1" stroke-dasharray="3 3"/>` : "") +
      (mood === "done" ? `<circle cx="42" cy="8" r="5.2" fill="${WHITE}"/><path class="k-tick" d="M39.6 8.2l1.7 1.7 3.2-3.4" fill="none" stroke="${BLACK}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8" stroke-dashoffset="8"/>` : "") +
      (mood === "asleep" ? `<text class="k-z" x="39" y="9" font-family="ui-monospace, monospace" font-size="7" fill="#b8b8b8">z</text>` : "");
    svg =
      `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 48 48"><defs>${pattern ?? ""}</defs>` +
      `<path d="M17.5 41v5M30.5 41v5" stroke="${WHITE}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<g class="cap"><rect x="5" y="8" width="38" height="33" rx="8" fill="${baseFill}" stroke="${WHITE}" stroke-width="1.2"/>` +
      `<rect x="8.5" y="8.5" width="31" height="26" rx="6" fill="${BLACK}" stroke="${WHITE}" stroke-width="1.2"/>` +
      `${legendText}${cursor}${keyFace(mood)}</g>${extras}</svg>`;
  }
  const node = h("span", { class: `keychar ${mood ? `k-${mood}` : ""}` });
  node.innerHTML = svg;
  return node;
}

const isLive = (q) => q.status === "running" || q.status === "waiting";
const mood = (q) => (q?.status === "waiting" ? "waiting" : q?.status === "running" ? "working" : q?.status === "failed" ? "stuck" : "");

/** How a quest stands: a glyph and a word or two, and whether it needs attention. */
function standing(q) {
  if (q.status === "waiting") return ["◌ Waiting on you", "loud"];
  if (q.status === "running") return ["● Working", "loud"];
  if (q.branch && !q.outcome && q.status !== "failed") return ["→ Ready for review", "loud"];
  if (q.outcome === "accepted") return ["✓ Changes kept", ""];
  if (q.outcome === "undone") return ["↶ Undone", ""];
  if (q.resumedAt && q.status === "done") return ["↺ Done after restart", ""];
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
  ui.crewCol = h("aside", { class: "side", "aria-label": "Crew" });
  ui.board = h("main", { class: "center" });
  ui.logCol = h("aside", { class: "logcol", "aria-label": "Quest log" });
  fill(ui.body, ui.crewCol, ui.board, ui.logCol);
  renderHome();
}

function renderHome() {
  if (state.view !== "home" || !ui.board) return;
  renderCrewColumn();
  renderBoard();
  renderLog();
}

function renderCrewColumn() {
  const bots = state.crew?.bots ?? [];
  const live = new Map(state.quests.filter(isLive).map((q) => [q.bot.id, q]));
  const fromRepo = bots.some((b) => b.source === "project");
  fill(ui.crewCol, 
    h("div", { class: "side-head" }, h("h2", { class: "label" }, `Crew · ${bots.length}`), h("span", { class: "note small" }, fromRepo ? ".crew/ in this repo" : "")),
    ...bots.map((bot) => {
      const q = live.get(bot.id);
      const status = q ? (q.status === "waiting" ? "◌ waiting on you" : `● step ${q.steps || 1}`) : "idle";
      return h(
        "button",
        {
          class: `member ${bot.id === state.selectedBot ? "on" : ""}`,
          title: bot.instructions,
          onclick: () => {
            state.selectedBot = bot.id;
            remember("talqava.bot", bot.id);
            if (ui.palette) ui.palette.placeholder = paletteHint();
            if (q) go("quest", q.id);
            else renderCrewColumn();
          },
          ondblclick: () => go("bot", bot.id),
        },
        keycap(bot.character, 40, mood(q), bot.type),
        h("span", { class: "who" }, h("b", {}, bot.name), " ", h("span", { class: "type" }, bot.type), h("span", { class: `status ${q?.status === "waiting" ? "wait" : ""}` }, status)),
        modelChip(bot.modelInfo),
        h("span", { class: "plain edit", role: "button", onclick: (e) => (e.stopPropagation(), go("bot", bot.id)) }, "Edit"),
      );
    }),
    state.crew?.problems?.length ? h("div", { class: "banner error small" }, state.crew.problems.map((p) => h("div", {}, p.problem))) : null,
    h("button", { class: "hatch", onclick: () => go("bot", "new") }, "+ Hatch a bot"),
    navFooter(),
  );
}

const cap = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

function navFooter(current) {
  const links = [
    ["chat", "Chat"],
    ["memory", "Memory"],
    ["skills", "Skills"],
    ["jobs", "Schedules"],
  ];
  return h("nav", { class: "side-foot" }, links.map(([view, label]) => h("button", { class: `navlink ${current === view ? "on" : ""}`, onclick: () => go(view) }, label)));
}

function renderBoard() {
  const active = state.quests.filter(isLive);
  const working = active.filter((q) => q.status === "running").length;
  const waiting = active.length - working;
  const summary = active.length ? [working && `${working} working`, waiting && `${waiting} waiting on you`, "every step saved"].filter(Boolean).join(" · ") : "";
  const selected = state.crew?.bots.find((b) => b.id === state.selectedBot);
  fill(ui.board, 
    h("div", { class: "board-head" }, h("h1", {}, "On the job"), h("span", { class: "note" }, summary)),
    active.length
      ? h("div", { class: "cards" }, ...active.map(questCard))
      : h(
          "div",
          { class: "empty-board" },
          selected ? keycap(selected.character, 72, "", selected.type) : null,
          h("h2", {}, "Nobody is on a quest"),
          h("p", {}, selected ? `Type a quest in the box at the top and ${selected.name} will go. Start it with @name to send someone else.` : "Type a quest in the box at the top."),
          h("button", { class: "primary", onclick: () => ui.palette?.focus() }, selected ? `Send ${selected.name} on a quest` : "Send a quest"),
        ),
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
    { class: `qcard ${q.status}`, onclick: () => go("quest", q.id), tabindex: "0", onkeydown: (e) => e.key === "Enter" && go("quest", q.id) },
    q.status === "running" ? h("div", { class: "scanline", "aria-hidden": "true" }, h("span")) : null,
    h("div", { class: "head" }, h("b", {}, q.title), keycap(q.bot.character, 28, mood(q), q.bot.type)),
    approval
      ? h("div", { class: "now wait" }, `◌ ${q.bot.name.toLowerCase()} wants to use ${NAMES[approval.name] || approval.name}`)
      : h("div", { class: "now" }, `● ${q.bot.name.toLowerCase()} · step ${q.steps || 1}${q.budget?.steps ? ` of up to ${q.budget.steps}` : ""} · ${doing}`),
    approval ? h("pre", {}, approval.name === "bash" ? approval.input.command : JSON.stringify(approval.input, null, 2)) : showOutput ? h("pre", {}, showOutput.trim()) : null,
    approval?.reason || (q.readOutside && q.status === "running")
      ? h("div", { class: "caution" }, `Read outside content, so any change ${q.bot.name} wants to make now needs your approval.`)
      : null,
    approval
      ? h(
          "div",
          { class: "row" },
          h("button", { class: "primary", onclick: decide(approval, "allow") }, "Allow once"),
          approval.reason ? null : h("button", { onclick: decide(approval, "always") }, `Always for ${q.bot.name}`),
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
    h("h2", { class: "label" }, "Quest log"),
    done.length
      ? done.slice(0, 40).map((q) => {
          const [label, tone] = standing(q);
          const detail = q.status === "failed" && q.note ? q.note : q.resumedAt ? "picked up after a restart" : q.branch ? q.branch : "";
          return h(
            "button",
            { class: "logitem", onclick: () => go("quest", q.id) },
            h("div", { class: "head" }, h("b", {}, q.title), h("span", { class: `pill ${tone}` }, label)),
            h("div", { class: "meta" }, [q.bot.name, shortWhen(q.updatedAt), detail].filter(Boolean).join(" · ")),
          );
        })
      : h("p", { class: "note" }, "Finished quests appear here, with what became of them."),
  );
}

// ---------- one quest ----------
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
  ui.convoPanel = h("div", { class: "tabpanel" }, conversationPane());
  fill(ui.qcenter, ui.tabs, ui.changesPanel, ui.convoPanel);
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
  const [label, tone] = standing(q);
  const where = q.branch ? ["on branch ", h("code", {}, q.branch), " · your own branch is untouched"] : q.project ? [`in ${basename(q.project)}`] : ["in the workspace folder"];
  fill(ui.qhead, 
    h("button", { onclick: () => go("home") }, "Back to crew"),
    keycap(q.bot.character, 40, mood(q), q.bot.type),
    h("div", { class: "titles" }, h("h1", {}, q.title), h("div", { class: "sub" }, `${q.bot.name} the ${cap(q.bot.type)} · `, ...where)),
    ui.meta,
    h("span", { class: `pill solid ${tone}` }, label),
    h(
      "button",
      {
        class: "plain danger",
        title: "Delete this quest",
        onclick: () =>
          confirm(q.branch && !q.outcome ? "Delete this quest and undo its changes?" : "Delete this quest from the log?") &&
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
  const tabs = [...(q.branch ? [["changes", "Changes"]] : []), ["conversation", "Conversation"]];
  if (pickDefault || !tabs.some(([key]) => key === ui.tab)) ui.tab = reviewable ? "changes" : "conversation";
  const show = (key, focus = false) => {
    ui.tab = key;
    ui.changesPanel.hidden = key !== "changes";
    ui.convoPanel.hidden = key !== "conversation";
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
    fill(panel, h("div", { class: "decide" }, h("b", {}, q.outcome === "undone" ? "Quest undone." : "The quest changed nothing."), h("p", { class: "note" }, "Its branch and working copy were removed.")));
    return;
  }
  if (isLive(q)) {
    fill(panel, h("p", { class: "note" }, "You can review the changes when the quest stops. Its work so far is in the Conversation tab."));
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
      : [h("p", { class: "note" }, "The quest changed no files.")]),
    changes.truncated ? h("p", { class: "note" }, "Some of the changes are too long to show here.") : null,
    h(
      "div",
      { class: "decide" },
      h("div", {}, h("b", {}, changes.files.length ? "Ready for your review. " : "Nothing to keep. "), h("span", { class: "muted" }, "Keeping makes one commit on the quest's branch; your current branch stays as it is.")),
      h(
        "div",
        { class: "row" },
        changes.files.length ? h("button", { class: "primary", onclick: () => attempt(async () => (await api("POST", `quests/${q.id}/accept`), afterDecision()), panel) }, "Keep the changes") : null,
        changes.files.length ? h("button", { onclick: () => (renderTabs(q, false), ui.tabs.querySelector('[data-key="conversation"]').click(), (ui.input.placeholder = `Tell ${q.bot.name} what to change…`)) }, "Ask for changes") : null,
        h(
          "button",
          { class: "danger", onclick: () => confirm("Throw away everything this quest changed?") && attempt(async () => (await api("POST", `quests/${q.id}/undo`), afterDecision()), panel) },
          changes.files.length ? "Undo whole quest" : "Close the branch",
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
        : "Works in the workspace folder. Shell commands and file changes ask first unless the bot runs everything.",
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

function renderQuestRight(q) {
  const spend = q.budget?.spend;
  const share = spend ? Math.min(1, (q.cost || 0) / spend) : q.budget?.steps ? Math.min(1, q.steps / q.budget.steps) : 0;
  const bot = state.crew?.bots.find((b) => b.id === q.bot.id);
  fill(ui.qright, 
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
      h("div", { class: "mono small muted" }, `${q.bot.type} · [${legendOf(q.bot.character, q.bot.type)}] · ${(TEXTURES[textureOf(q.bot.character, q.bot.type)] || "").toLowerCase()} base`),
      h("p", { class: "note" }, q.bot.source === "project" ? "From the repository's .crew/ folder." : q.bot.source === "personal" ? "Your own bot." : "A starter bot."),
      bot ? h("button", { onclick: () => go("bot", bot.id) }, `Edit ${q.bot.name}`) : null,
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
      character: { legend: "?", texture: "dots" },
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
    h("button", { onclick: () => go("home") }, "Back to crew"),
    h("div", { class: "titles" }, h("h1", {}, isNew ? "Hatch a bot" : `Edit ${existing.name}`), h("div", { class: "sub mono" }, fileNote)),
    !isNew && existing.source === "personal"
      ? h(
          "button",
          {
            class: "plain danger",
            onclick: () =>
              confirm(`Remove your ${existing.name}? A starter bot of the same name comes back.`) &&
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
  draft.character.legend = legendOf(draft.character, draft.type);
  const legendInput = h("input", {
    id: "legend",
    value: draft.character.legend,
    maxlength: 6,
    autocomplete: "off",
    style: "text-align: center; font-family: var(--mono); font-size: 18px; max-width: 120px",
    oninput: (e) => {
      const chars = [...e.target.value.replace(/\s/g, "")].slice(0, 3).join("");
      if (chars) {
        draft.character.legend = chars;
        portrait.querySelector(".keychar")?.replaceWith(keycap(draft.character, 150, "", draft.type));
      }
    },
  });
  const drawPortrait = () => {
    draft.character.texture = textureOf(draft.character, draft.type);
    fill(portrait, 
      keycap(draft.character, 150, "", draft.type),
      h("h2", {}, draft.name || "New bot"),
      h("div", { class: "type" }, cap(draft.type || "bot")),
      h("label", { class: "label", for: "legend", style: "display: block; margin-top: 22px" }, "Key legend"),
      legendInput,
      h("p", { class: "note small" }, "One to three characters printed on the key, such as ? or </>."),
      h("p", { class: "label", style: "margin-top: 16px" }, "Texture on its base"),
      h(
        "div",
        { class: "textures" },
        Object.entries(TEXTURES).map(([key, name]) =>
          h(
            "button",
            {
              class: `texture ${key === draft.character.texture ? "on" : ""}`,
              "aria-pressed": String(key === draft.character.texture),
              title: name,
              onclick: () => ((draft.character.texture = key), drawPortrait()),
            },
            keycap({ legend: draft.character.legend, texture: key }, 30, "", draft.type),
            h("span", {}, name),
          ),
        ),
      ),
    );
  };
  drawPortrait();

  // ----- job -----
  const name = h("input", { value: draft.name, placeholder: "e.g. Pip", maxlength: 40, oninput: (e) => ((draft.name = e.target.value), drawPortrait()) });
  const types = ["scout", "scribe", "maker", "keeper", "counter", "spark"];
  const TYPE_WORDS = { scout: "finds things out", scribe: "writes", maker: "builds code", keeper: "remembers and checks", counter: "works with numbers", spark: "comes up with ideas" };
  const type = h(
    "select",
    {
      onchange: (e) => {
        if (draft.character.legend === LEGENDS[draft.type]) draft.character.legend = LEGENDS[e.target.value] ?? draft.character.legend;
        if (draft.character.texture === TYPE_TEXTURES[draft.type]) draft.character.texture = TYPE_TEXTURES[e.target.value] ?? draft.character.texture;
        draft.type = e.target.value;
        legendInput.value = draft.character.legend;
        drawPortrait();
      },
    },
    [...new Set([...types, draft.type])].map((t) => h("option", { value: t, selected: t === draft.type }, `${cap(t)}${TYPE_WORDS[t] ? ` · ${TYPE_WORDS[t]}` : ""}`)),
  );
  const instructions = h("textarea", { rows: 7, placeholder: "What this bot does and how. Plain sentences work best." }, draft.instructions);

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
  const modelName = h("input", { value: current ? current.slice(slash + 1) : "", placeholder: "Model name, e.g. qwen3:8b or claude-sonnet-5-5", onfocus: () => (useOwn.checked = true) });
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
            h("div", { class: "muted" }, result.recommended.includes(cap(draft.type)) ? `Good enough for a ${cap(draft.type)}.` : `Not recommended for a ${cap(draft.type)}. Good for: ${result.recommended.join(", ")}.`),
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

  save.addEventListener("click", () =>
    attempt(async () => {
      const body = {
        name: name.value.trim(),
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
        h("section", { class: "card" }, h("h3", {}, "Job"), h("label", { class: "field" }, "Name", name), h("label", { class: "field" }, "Type", type), h("label", { class: "field" }, "Instructions", instructions)),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Model"),
          h("label", { class: "choice" }, useDefault, h("span", {}, h("b", {}, "Default model"), h("div", { class: "note" }, `The one chosen in Settings: ${state.config.model}`))),
          h("label", { class: "choice" }, useOwn, h("span", { class: "grow" }, h("b", {}, "A model of its own"), h("div", { class: "form" }, provider, modelName))),
          checks,
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Powers"),
          powerBoxes.map(([p, box]) => h("label", { class: "power" }, box, POWER_NAMES[p])),
          h("p", { class: "note" }, "A bot only gets the tools its powers grant. Changes ask first by default, and always after reading the web."),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Limits"),
          h("label", { class: "field" }, "Approvals", approvals),
          h("div", { class: "row" }, h("label", { class: "field grow" }, "Budget per quest ($)", spend), h("label", { class: "field grow" }, "Steps per quest", steps)),
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
  ui.title = h("h1", {}, "New chat");
  ui.meta = h("span", { class: "meta" });
  ui.remove = h("button", { class: "plain danger", title: "Delete this chat", onclick: deleteChat, hidden: !state.convId }, "Delete");
  const pane = conversationPane();
  fill(ui.body, ui.chatSide, h("main", { class: "center flush" }, h("div", { class: "chathead" }, ui.title, ui.meta, ui.remove), pane));
  renderChatList();
  setRunning(false);
  if (state.convId) connect(state.convId);
  else {
    ui.log.append(
      h(
        "div",
        { class: "empty" },
        h("h2", {}, `Hello. I'm ${state.config.agentName}.`),
        h("p", {}, "A plain chat with every tool. For work you want to hand off, send a bot on a quest from home base instead."),
      ),
    );
  }
  ui.input.focus();
}

function renderChatList() {
  if (!ui.chatSide || state.view !== "chat") return;
  fill(ui.chatSide, 
    h("button", { class: "primary", onclick: () => go("chat") }, "New chat"),
    h(
      "div",
      { class: "chatlist" },
      state.convs.map((c) =>
        h(
          "button",
          { class: `navlink ${c.id === state.convId ? "on" : ""}`, title: c.title, onclick: () => go("chat", c.id) },
          h("span", {}, c.title),
          c.needsApproval ? h("i", { class: "dot wait", title: "Waiting for your approval" }) : c.running ? h("i", { class: "dot", title: "Working" }) : null,
        ),
      ),
    ),
    navFooter("chat"),
  );
}

async function submit() {
  const text = ui.input.value.trim();
  if (!text || state.running) return;
  await attempt(async () => {
    if (!state.convId) {
      const conv = await api("POST", "conversations");
      state.convId = conv.id;
      if (ui.remove) ui.remove.hidden = false;
      fill(ui.log, );
      connect(conv.id);
      await new Promise((resolve) => state.source.addEventListener("open", resolve, { once: true }));
    }
    await api("POST", `conversations/${state.convId}/messages`, { text });
    ui.input.value = "";
    ui.input.style.height = "auto";
    refreshList().then(renderChatList);
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
const speaker = () => (state.view === "quest" ? (state.quests.find((q) => q.id === state.convId)?.bot.name ?? "the bot") : state.config.agentName);

// ---------- pages ----------
function page(title, intro, ...children) {
  ui.body.className = "body two";
  ui.log = null;
  const views = [
    ["home", "Home base"],
    ["chat", "Chat"],
    ["memory", "Memory"],
    ["skills", "Skills"],
    ["jobs", "Schedules"],
    ["settings", "Settings"],
  ];
  const col = h("div", { class: "col page" }, h("h2", {}, title), h("p", { class: "note" }, intro), ...children);
  fill(ui.body, 
    h("aside", { class: "side" }, views.map(([view, label]) => h("button", { class: `navlink ${state.view === view ? "on" : ""}`, onclick: () => go(view) }, label))),
    h("main", { class: "center" }, col),
  );
  return col;
}

// ---------- memory ----------
async function memoryView() {
  const list = h("div");
  const input = h("textarea", { rows: 2, placeholder: "Something to remember, e.g. “I write mystery novels under a pen name.”" });
  const col = page(
    "Memory",
    `What ${state.config.agentName} carries into every conversation. It adds to this on its own; you can add or remove entries here.`,
    h(
      "form",
      {
        class: "form",
        onsubmit: async (e) => {
          e.preventDefault();
          await attempt(async () => {
            await api("POST", "memory", { text: input.value });
            memoryView();
          }, col);
        },
      },
      input,
      h("div", {}, h("button", { class: "primary" }, "Remember this")),
    ),
    list,
  );
  const entries = await attempt(() => api("GET", "memory"), col);
  if (!entries) return;
  fill(list, 
    ...(entries.length
      ? entries.map((m) =>
          h(
            "div",
            { class: "card" },
            h(
              "div",
              { class: "row" },
              h("div", { class: "grow" }, m.text, h("div", { class: "note" }, when(m.createdAt))),
              h("button", { class: "plain danger", onclick: () => attempt(async () => (await api("DELETE", `memory/${m.id}`), memoryView()), col) }, "Forget"),
            ),
          ),
        )
      : [h("p", { class: "note" }, "Nothing remembered yet.")]),
  );
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
async function jobsView() {
  const name = h("input", { placeholder: "Morning news digest" });
  const schedule = h("input", { placeholder: "0 8 * * *" });
  const prompt = h("textarea", { rows: 3, placeholder: "What should the agent do each time?" });
  const list = h("div");
  const col = page(
    "Schedules",
    `Jobs ${state.config.agentName} runs on its own. Each run appears as a new chat. You can also just ask in a chat: “every weekday at 8am, …”.`,
    list,
    h("h3", {}, "New scheduled job"),
    h(
      "form",
      {
        class: "form",
        onsubmit: async (e) => {
          e.preventDefault();
          await attempt(async () => {
            await api("POST", "jobs", { name: name.value, schedule: schedule.value, prompt: prompt.value });
            jobsView();
          }, col);
        },
      },
      h("label", {}, "Name", name),
      h("label", {}, "When: “every 30m”, “every 1d”, “at 2026-12-01T09:00”, or a cron line (“0 8 * * *” is 8:00 every day)", schedule),
      h("label", {}, "Instructions", prompt),
      h("div", {}, h("button", { class: "primary" }, "Add job")),
    ),
  );
  const jobs = await attempt(() => api("GET", "jobs"), col);
  if (!jobs) return;
  if (!jobs.length) list.append(h("p", { class: "note" }, "No scheduled jobs yet."));
  for (const j of jobs) {
    const act = (fn) => attempt(async () => (await fn(), jobsView()), col);
    list.append(
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "row" },
          h("div", { class: "grow" }, h("strong", {}, j.name), h("div", { class: "note" }, `${j.schedule} · ${j.enabled ? `next ${when(j.nextRunAt)}` : "paused"} · last ${when(j.lastRunAt)}`), h("div", {}, j.prompt)),
          h(
            "div",
            { class: "row" },
            j.lastConversationId ? h("button", { onclick: () => go("chat", j.lastConversationId) }, "Last run") : null,
            h("button", { onclick: () => attempt(async () => go("chat", (await api("POST", `jobs/${j.id}/run`, {})).conversationId), col) }, "Run now"),
            h("button", { onclick: () => act(() => api("PATCH", `jobs/${j.id}`, { enabled: !j.enabled })) }, j.enabled ? "Pause" : "Resume"),
            h("button", { class: "danger", onclick: () => confirm(`Delete “${j.name}”?`) && act(() => api("DELETE", `jobs/${j.id}`)) }, "Delete"),
          ),
        ),
      ),
    );
  }
}

// ---------- settings ----------
function settingsView() {
  const c = state.config;
  const col = page("Settings", `Files the agent works on live in ${c.workspace}`);
  const save = (patch) =>
    attempt(async () => {
      state.config = await api("PUT", "settings", patch);
      document.title = state.config.agentName;
      renderSide();
      settingsView();
    }, col);
  const select = (options, value) => h("select", {}, options.map(([id, label]) => h("option", { value: id, selected: id === value }, label)));

  if (needsKey(c)) {
    col.append(
      h("div", { class: "banner" }, "To get started, paste an Anthropic API key below (console.anthropic.com → API keys), or choose a free local model under Agent."),
    );
  }

  const key = h("input", { type: "password", placeholder: c.hasApiKey ? (c.apiKeyFromEnv ? "Set in the .env file" : "Saved. Paste a new key to replace it.") : "sk-ant-…", autocomplete: "off" });
  col.append(
    h("h3", {}, "Anthropic API key"),
    h("form", { class: "form", onsubmit: (e) => (e.preventDefault(), key.value.trim() && save({ apiKey: key.value })) }, key, h("div", {}, h("button", { class: "primary" }, "Save key"))),
  );

  const name = h("input", { value: c.agentName });
  const slash = c.model.indexOf("/");
  const provider = select(c.providers.map((p) => [p.id, p.name]), c.model.slice(0, slash));
  const modelName = h("input", { value: c.model.slice(slash + 1), placeholder: "Model name, e.g. llama3.1 or claude-opus-5-5", autocomplete: "off" });
  const claudeModels = h("datalist", { id: "claude-models" }, c.models.map((m) => h("option", { value: m.id }, m.label)));
  // Claude's names are suggested only when Anthropic is the provider.
  const syncList = () => modelName.setAttribute("list", provider.value === "anthropic" ? "claude-models" : "");
  provider.addEventListener("change", syncList);
  syncList();
  const ref = () => `${provider.value}/${modelName.value.trim()}`;
  const effort = select(c.efforts.map((e) => [e, e]), c.effort);
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
          save({ agentName: name.value, model: ref(), effort: effort.value, approvalMode: mode.value, budget: { steps: Number(steps.value), spend: spend.value === "" ? null : Number(spend.value) } })
        ),
      },
      h("label", {}, "Name", name),
      h("label", {}, "Model comes from", provider),
      h("label", {}, "Model", modelName, claudeModels),
      h("p", { class: "note" }, "For a free local model, start a local model runner (Ollama, LM Studio, llama.cpp and others) and type the name of a model you have downloaded. Web search and connectors are Claude-only for now; other models read pages with the built-in page reader."),
      h("div", { class: "row" }, checkButton),
      checkBox,
      h("label", {}, "Effort, for Claude (higher thinks longer and costs more)", effort),
      h("label", {}, "Approvals", mode),
      h("p", { class: "note" }, "With “ask”, a scheduled job that needs approval waits until you open its chat and answer. “Run everything” is only sensible when the agent runs in Docker or on a machine with nothing you'd mind losing."),
      h("label", {}, "Budget per run: steps (model calls)", steps),
      h("label", {}, "Budget per run: estimated spend in US dollars", spend),
      h("p", { class: "note" }, "A run stops before going over either limit, and you can say “continue”. Spend is estimated from list prices; your provider's bill is the real figure."),
      h("div", {}, h("button", { class: "primary" }, "Save")),
    ),
  );

  const pId = h("input", { placeholder: "Short id, e.g. lmstudio" });
  const pName = h("input", { placeholder: "Name, e.g. LM Studio" });
  const pUrl = h("input", { placeholder: "Address ending in /v1, e.g. http://localhost:1234/v1" });
  const pKey = h("input", { type: "password", placeholder: "API key (blank for local runners)", autocomplete: "off" });
  const pIn = h("input", { type: "number", min: 0, step: 0.01, placeholder: "$ per million input tokens (0 if free)" });
  const pOut = h("input", { type: "number", min: 0, step: 0.01, placeholder: "$ per million output tokens (0 if free)" });
  const others = c.providers.filter((p) => p.kind !== "anthropic");
  col.append(
    h("h3", {}, "Model providers"),
    h("p", { class: "note" }, "Anything that offers the common chat completions format: local runners, or hosted services with your own key. Prices are optional; without them only the step budget applies."),
    ...others.map((p) =>
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "row" },
          h("div", { class: "grow" }, h("strong", {}, p.name), ` (${p.id}) ${p.baseUrl}`, h("div", { class: "note" }, `${p.hasKey ? "Key saved" : "No key"} · ${p.prices ? `$${p.prices.input} in / $${p.prices.output} out per million tokens` : "prices unknown"}`)),
          h("button", { class: "plain danger", onclick: () => save({ provider: { id: p.id, remove: true } }) }, "Remove"),
        ),
      ),
    ),
    h(
      "form",
      { class: "form", onsubmit: (e) => (e.preventDefault(), save({ provider: { id: pId.value.trim(), name: pName.value.trim(), baseUrl: pUrl.value.trim(), apiKey: pKey.value, prices: { input: pIn.value, output: pOut.value } } })) },
      pId,
      pName,
      pUrl,
      pKey,
      h("div", { class: "row" }, pIn, pOut),
      h("div", {}, h("button", {}, "Add provider")),
    ),
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

  const repoPath = h("input", { placeholder: "Folder of a git repository, e.g. /home/you/code/my-app" });
  col.append(
    h("h3", {}, "Repositories"),
    h("p", { class: "note" }, "Bots can work on these. A quest that changes code gets its own branch and working copy, so your files and branches are untouched until you keep its changes. Bots in a repository's .crew/ folder join the crew when it is chosen."),
    ...c.projects.map((p) => h("div", { class: "card" }, h("div", { class: "row" }, h("div", { class: "grow" }, h("code", {}, p)), h("button", { class: "plain danger", onclick: () => save({ project: { path: p, remove: true } }) }, "Remove")))),
    h("form", { class: "form", onsubmit: (e) => (e.preventDefault(), save({ project: { path: repoPath.value.trim() } })) }, repoPath, h("div", {}, h("button", {}, "Add repository"))),
  );

  const mName = h("input", { placeholder: "Name, e.g. notion" });
  const mUrl = h("input", { placeholder: "https://… (the connector's MCP address)" });
  const mToken = h("input", { type: "password", placeholder: "Access token (if it needs one)", autocomplete: "off" });
  col.append(
    h("h3", {}, "Connectors (MCP servers)"),
    h("p", { class: "note" }, "Remote MCP servers give the agent ready-made tools for other services."),
    ...c.mcpServers.map((s) => h("div", { class: "card" }, h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", {}, s.name), ` ${s.url}`), h("button", { class: "plain danger", onclick: () => save({ mcpServer: { name: s.name, remove: true } }) }, "Remove")))),
    h("form", { class: "form", onsubmit: (e) => (e.preventDefault(), save({ mcpServer: { name: mName.value.trim(), url: mUrl.value.trim(), token: mToken.value } })) }, mName, mUrl, mToken, h("div", {}, h("button", {}, "Add connector"))),
  );
}

boot();
