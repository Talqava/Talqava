// The Talqava window. No framework: small helpers that build DOM nodes.
// Layout: a top bar (repository, command box, spending, settings) over a body
// that each view fills: home base, a quest, a bot, chats, and the other pages.
import { renderMarkdown } from "/markdown.js";

const app = document.getElementById("app");
const state: any = {
  config: null,
  convs: [],
  quests: [],
  crew: null,
  view: "chat", // The app opens on a new session; "home" is the older name of the Agents page
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
const ui: any = {}; // live nodes of the open view
/** Small pieces of state that belong to one function each: a timer, or whether it is already under way. */
const flags: any = {};

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

async function api(method, path, body?) {
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
  // A sensitive change asks for the password again; once given, the change is made.
  if (res.status === 403 && data.confirm && !flags.apiConfirming) {
    flags.apiConfirming = true;
    try {
      await askPasswordAgain();
    } finally {
      flags.apiConfirming = false;
    }
    return api(method, path, body);
  }
  // A Marketplace item that is not approved yet: an owner or administrator can approve it on the spot and carry on.
  if (res.status === 403 && data.approve && !flags.apiApproving && confirm(`${data.error}\n\nApprove it for this organization and add it now? Only owners and administrators can.`)) {
    flags.apiApproving = true;
    try {
      await api("PUT", "settings", { guardrails: { approveListing: data.approve } });
    } finally {
      flags.apiApproving = false;
    }
    return api(method, path, body);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
  // A step that needs two people: the first yes is noted, and the screen says it waits for a second person.
  if (data.waiting && data.message && /\/approvals\//.test(path)) toast(data.message);
  // Where two administrators must agree, a security change is set aside instead of made: say so, plainly.
  if (res.status === 202 && data.waiting) throw Object.assign(new Error(data.message), { waiting: true });
  return data;
}

/** Asks the signed-in person to type their password (and code, if they use one) before a sensitive change. */
function askPasswordAgain() {
  return new Promise<any>((resolve, reject) => {
    const dialog = h("dialog", { class: "aidialog" });
    const pw = h("input", { type: "password", placeholder: "Your password", autocomplete: "current-password", "aria-label": "Your password" });
    const code = h("input", { inputmode: "numeric", placeholder: "6-digit code (if you use a second step)", autocomplete: "one-time-code", maxlength: 7, "aria-label": "Code from your authenticator app" });
    const status = h("p", { class: "note", role: "status" });
    const close = (fn, value?) => (dialog.close(), dialog.remove(), fn(value));
    const form = h("form", { class: "form" }, pw, state.me?.person?.secondStep ? code : null, status, h("div", { class: "row" }, h("button", { class: "primary" }, "Continue"), h("button", { type: "button", class: "plain", onclick: () => close(reject, new Error("Cancelled: the change was not made.")) }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await fetch("/api/me/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw.value, code: code.value }) });
      if (res.ok) return close(resolve);
      status.textContent = (await res.json().catch(() => ({}))).error || "That did not work.";
      status.className = "note bad";
    });
    fill(dialog, h("h3", {}, "Type your password again"), h("p", { class: "note" }, "This change affects everyone's security, so Talqava checks it is really you. You will not be asked again for a few minutes."), form);
    dialog.addEventListener("cancel", () => close(reject, new Error("Cancelled: the change was not made.")));
    document.body.append(dialog);
    dialog.showModal();
    pw.focus();
  });
}

/** Replaces a node's children; lists are flattened and empty values skipped. */
function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return node;
}

// Runs an action and shows any failure next to where it happened.
async function attempt(fn, where?) {
  try {
    return await fn();
  } catch (err) {
    const box = h("div", { class: "banner error" }, err.message);
    (where || ui.log || ui.body || app).append(box);
    setTimeout(() => box.remove(), 8000);
  }
}

/** A short message at the bottom of the window that goes away by itself. */
/** A short note at the bottom of the window. With an action ({ label, run }), it stays longer and offers a button, such as Undo. */
function toast(text, action = null) {
  document.querySelector(".toast")?.remove();
  const box = h("div", { class: "toast", role: "status" }, text, action ? h("button", { class: "plain small toastact", onclick: () => (box.remove(), Promise.resolve(action.run()).catch((err) => toast(err.message))) }, action.label) : null);
  document.body.append(box);
  setTimeout(() => box.remove(), action ? 12_000 : 6000);
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
async function showLogin() {
  state.source?.close();
  clearInterval(flags.bootTimer);
  if (flags.loginOpen && document.querySelector("form.login")) return; // already showing; keep what is typed
  flags.loginOpen = true;
  // With people set up, each person signs in with their email; otherwise there is one password.
  const how = await fetch("/api/login").then((r) => r.json()).catch(() => ({ people: false }));
  const email = h("input", { type: "email", placeholder: "Email", autocomplete: "username", "aria-label": "Email" });
  const password = h("input", { type: "password", placeholder: "Password", autocomplete: "current-password", "aria-label": "Password" });
  const code = h("input", { inputmode: "numeric", placeholder: "6-digit code from your authenticator app", autocomplete: "one-time-code", maxlength: 7, "aria-label": "Code from your authenticator app", hidden: true });
  const form = h(
    "form",
    {
      class: "login",
      onsubmit: async (e) => {
        e.preventDefault();
        await attempt(async () => {
          const r = await api("POST", "login", how.people ? { email: email.value, password: password.value, ...(code.hidden ? {} : { code: code.value }) } : { password: password.value });
          if (r.needsCode) {
            code.hidden = false;
            code.focus();
            return;
          }
          if (r.setUpSecondStep) state.view = "security";
          boot();
        }, form);
      },
    },
    h("div", { class: "brand", role: "img", "aria-label": "Talqava" }, brandLogo({ mark: 48, word: 18 })),
    how.sso ? h("a", { class: "button primary ssobutton", href: "/api/sso/start" }, "Sign in with your company account") : null,
    how.sso ? h("p", { class: "note small" }, how.ssoOnly ? "Passwords are switched off. The owner can still sign in with theirs below." : "Or sign in with your email and password:") : null,
    how.people ? email : null,
    password,
    code,
    h("button", { class: how.sso ? "" : "primary" }, "Sign in"),
  );
  fill(app, form);
  (how.people ? email : password).focus();
}

// ---------- start-up and refreshing ----------
// A Claude model with no key cannot run; a local model needs none.
const needsKey = (c) => c.model.startsWith("anthropic/") && !c.hasApiKey;

async function boot() {
  try {
    state.config = await api("GET", "state");
    // Whether this copy of Talqava can write out speech: asked once, since it cannot change while the app runs.
    state.canSpeak = Boolean(state.config.speech);
  } catch {
    return;
  }
  document.title = "Talqava";
  state.me = await api("GET", "me").catch(() => null);
  if (state.me?.mustSetUpSecondStep) state.view = "security";
  if (!state.config.projects.includes(state.project)) state.project = "";
  await Promise.all([loadCrew(), loadQuests(), refreshList(), loadTemplates(), loadSpaces(), loadOrgs()]);
  // A first run (no AI model, or nobody on the team yet) opens as a short set-up chat, until it is finished or skipped.
  if (!state.me?.mustSetUpSecondStep && state.view === "start" && setupWanted()) state.view = "setup";
  render();
  clearInterval(flags.bootTimer);
  // One heartbeat keeps every part of the window current.
  flags.bootTimer = setInterval(tick, 2000);
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
  // Chats and tasks together, for the one list of sessions.
  try {
    state.sessions = await api("GET", "sessions");
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
  for (const v of document.querySelectorAll<HTMLVideoElement>(".herovideo")) (v.src = `/media/brand-loop-${t}.webm`), (v.poster = `/media/brand-loop-${t}.jpg`), v.play?.().catch(() => {});
  for (const i of document.querySelectorAll<HTMLImageElement>(".heroposter")) i.src = `/media/brand-loop-${t}.jpg`;
});

function render() {
  ui.rail = h("nav", { class: "rail", "aria-label": "Main" });
  ui.top = h("header", { class: "top" });
  ui.tabs = h("nav", { class: "areatabs", "aria-label": "Parts of this area", hidden: true });
  ui.body = h("div", { class: "body" });
  fill(app, ui.rail, h("div", { class: "main" }, ui.top, ui.tabs, ui.body));
  renderTop();
  renderAreaTabs();
  renderBody();
}

/** Areas of the app that have several parts: the menu shows the area once, and its parts are tabs across the top. */
const AREAS = {
  // Automations has its own place on the rail, so it is not a tab of Tasks.
  tasks: { name: "Tasks", views: [["tasks", "Tasks"], ["projects", "Projects"]], also: { project: "projects" } },
  // Team is who does the work and what they know. What they know is one tab, Knowledge, with two parts: what is
  // remembered (Memory) and how things are done (Skills).
  team: { name: "Team", views: [["home", "Agents"], ["team", "Organization"], ["memory", "Knowledge"], ["market", "Marketplace"]], also: { quest: "home", bot: "home", marketbot: "market", skills: "memory" } },
  files: { name: "Files", views: [["office", "All files"], ["docs", "Documents"], ["sheets", "Sheets"], ["slides", "Slides"], ["notes", "Notes"], ["workspace", "Workspace"], ["library", "Library"]] },
  more: { name: "Account", views: [["integrations", "Connections"], ["security", "Security"], ["audit", "Activity log"], ["usage", "Usage"], ["settings", "Settings"]] },
};
/**
 * Parts of Talqava that are set aside: built, but shown only when the owner switches them on under Settings › Labs.
 * Nothing is deleted when one is off; what was made with it is kept.
 */
const LABS = [
  ["office", "Sheets and Slides", "Spreadsheets that calculate and presentation decks, under Files."],
  ["org", "Organization designer", "Example structures to copy, how you run the organization, and each position's goals and decisions."],
  ["company", "Company features", "People with their own sign-in and roles, single sign-on, and rules for sensitive information, under Security."],
  ["templates", "Company templates and playbooks", "Whole-company starting points and ready-made processes, in the Marketplace."],
  ["git", "Git repositories", "Let agents work on code in repositories on this computer, under Connections."],
];
const lab = (id) => (state.config?.labs ?? []).includes(id);
/** Pages that belong to a set-aside part. */
const LAB_VIEWS = { sheets: "office", slides: "office" };
const viewShown = (view) => !LAB_VIEWS[view] || lab(LAB_VIEWS[view]);
/**
 * Pages that are part of one place and have no tab of their own: documents, notes, workspace pages and the library
 * are all reached from Files, which lists them together. Their own pages still open, with Files marked as where you are.
 */
const FOLDED = { docs: "office", notes: "office", workspace: "office", library: "office", sheets: "office", slides: "office" };

/** The tab a page belongs under: itself, or the page it was opened from (a task under Agents, a project under Projects). */
const tabOf = (area, view) => AREAS[area].also?.[view] ?? view;
const areaOf = (view) => (view === "quest" && ui.questFrom === "sessions" ? null : Object.keys(AREAS).find((a) => AREAS[a].views.some(([v]) => v === view) || AREAS[a].also?.[view]) ?? null);
/** The part of an area last open, so the menu returns there. */
const lastIn = (area) => {
  try {
    const v = localStorage.getItem(`talqava.area.${area}`);
    return AREAS[area].views.some(([x]) => x === v) && viewShown(v) && !FOLDED[v] ? v : AREAS[area].views[0][0];
  } catch {
    return AREAS[area].views[0][0];
  }
};
function renderAreaTabs() {
  if (!ui.tabs) return;
  const area = areaOf(state.view);
  ui.tabs.hidden = !area;
  if (!area) return fill(ui.tabs);
  const at = tabOf(area, state.view);
  try {
    localStorage.setItem(`talqava.area.${area}`, at);
  } catch {}
  // A place with one page has no tabs to choose between, so the bar is left out.
  if (AREAS[area].views.filter(([v]) => !FOLDED[v]).length < 2) return (ui.tabs.hidden = true), fill(ui.tabs);
  ui.tabs.setAttribute("aria-label", `Parts of ${AREAS[area].name}`);
  fill(ui.tabs, AREAS[area].views.some(([, label]) => label === AREAS[area].name) ? null : h("span", { class: "areaname" }, AREAS[area].name), AREAS[area].views.filter(([v]) => !FOLDED[v]).map(([v, label]) => h("button", { class: `areatab ${(FOLDED[at] ?? at) === v ? "on" : ""}`, "aria-current": (FOLDED[at] ?? at) === v ? "page" : null, onclick: () => go(v) }, label)));
}

// Line icons for the rail, drawn on a 20 px grid.
// The app's icons, drawn as lines. An entry that starts with "<" is from Lucide (lucide.dev), on its 24-unit grid:
// Copyright (c) Lucide Icons and Contributors, ISC licence; see THIRD_PARTY_NOTICES.md. The rest are Talqava's own,
// on a 20-unit grid.
const ICONS = {
  new: "M10 4.5v11M4.5 10h11",
  search: "M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM13 13l3.5 3.5",
  usage: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  chat: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  home: "M5 7.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V9A1.5 1.5 0 0 1 5 7.5zM10 7.5V4.5M7.5 11.5v.01M12.5 11.5v.01",
  market: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
  memory: '<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4"/><path d="M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294"/><path d="M17.996 5.125a4 4 0 012.526 5.77"/><path d="M18 18a4 4 0 002-7.465"/><path d="M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517"/><path d="M6 18a4 4 0 01-2-7.465"/><path d="M6.004 5.125a4 4 0 00-2.526 5.77"/>',
  skills: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
  jobs: '<path d="M16 2v3"/><path d="M17 15.5v1.7l1 .625"/><path d="M21 8.936V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h3.935"/><path d="M3 9h9.873"/><path d="M8 2v3"/><circle cx="17" cy="17" r="5"/>',
  settings: '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  integrations: '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
  security: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  audit: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  workspace: "M5.5 3.5h6l3 3v10h-9zM11.5 3.5v3h3M7.5 10h5M7.5 12.5h5M7.5 7.5h2",
  tasks: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  docs: "M6 3.5h5.5l3 3V15A1.5 1.5 0 0 1 13 16.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5zM11.5 3.5v3h3M7 9.5h6M7 12h6M7 14.5h3.5",
  notes: "M5 4.5h10v7.5l-3.5 3.5H5zM15 12h-3.5v3.5M7.5 7.5h5M7.5 10h3",
  sheets: "M4.5 4.5h11v11h-11zM4.5 8h11M4.5 11.5h11M8.5 4.5v11M12 8v7.5",
  office: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  start: "M3.5 9.5L10 4l6.5 5.5M5.5 8.5v7h9v-7M8.5 15.5v-4h3v4",
  slides: "M3.5 5h13v8.5h-13zM10 13.5v3M7 16.5h6M7 8.5h6",
  projects: "M3 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h6.5A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z",
  guide: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
  library: "M3.5 6A1.5 1.5 0 0 1 5 4.5h3l1.5 2H15A1.5 1.5 0 0 1 16.5 8v6A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14zM7 10.5h6M7 12.8h4",
};
const icon = (name) => {
  const node = h("span", { class: "ico", "aria-hidden": "true" });
  const art = ICONS[name] ?? "";
  // Both grids come out with lines of the same weight at this size.
  node.innerHTML = art.startsWith("<")
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${art}</svg>`
    : `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${art}"/></svg>`;
  return node;
};

function renderRail() {
  if (!ui.rail) return;
  const v = state.view;
  const area = areaOf(v);
  // A narrow rail of icons. Each says what it is when pointed at; the account and everything about the app sit at its foot.
  const item = (view, label, on, glyph = view, cls = "", run = () => go(view)) => h("button", { class: `railitem ${cls} ${on ? "on" : ""}`, onclick: run, "aria-label": label, "data-tip": label, "aria-current": on ? "page" : null }, icon(glyph));
  const inbox = item("inbox", "Inbox", v === "inbox");
  ui.inboxCount = h("span", { class: "count", hidden: true });
  inbox.append(ui.inboxCount);
  // What is in motion right now is counted on the Inbox; the list itself is on the home page.
  ui.recent = h("div", { hidden: true });
  const me = state.me?.person?.name || "";
  const initials = (me || activeOrg().name || "You").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "Y";
  const account = h("button", { class: "acctbutton", "aria-label": "Account, connections and settings", "aria-haspopup": "menu", "aria-expanded": "false", "data-tip": "Account and settings", onclick: (e) => accountMenu(e.currentTarget) }, initials);
  fill(
    ui.rail,
    h("button", { class: "plain brand", onclick: () => go("start"), title: "Home", "aria-label": "Talqava, home" }, brandLogo({ mark: 30, word: 0 })),
    h(
      "div",
      { class: "railgroup" },
      item("chat", "New session", (v === "chat" && !state.convId) || v === "setup", "new", "railnew", () => go("chat")),
      item("chat", "Sessions", (v === "chat" && Boolean(state.convId)) || (v === "quest" && ui.questFrom === "sessions"), "chat", "", () => go("chat", state.convId ?? (state.sessions ?? []).find((x) => x.kind === "chat" && !x.archived)?.id ?? null)),
      item(lastIn("tasks") === "jobs" ? "tasks" : lastIn("tasks"), "Tasks and projects", area === "tasks" && v !== "jobs", "tasks"),
      item("jobs", "Automations", v === "jobs", "jobs"),
      item(lastIn("team"), "Team", area === "team", "team"),
      item(lastIn("files"), "Files", area === "files", "office"),
    ),
    h(
      "div",
      { class: "railgroup railend" },
      inbox,
      account,
    ),
  );
  syncInboxCount();
}

/** The account menu at the foot of the rail: connections, security, the activity log, settings, the look, and help. */
function accountMenu(anchor) {
  const open: any = document.querySelector(".acctmenu");
  if (open) return open.close();
  const me = state.me?.person;
  const org = activeOrg();
  const menu = h("div", { class: "acctmenu", role: "menu", "aria-label": "Account" });
  const away = (e) => !menu.contains(e.target) && e.target !== anchor && menu.close();
  const key = (e) => e.key === "Escape" && (menu.close(), anchor.focus());
  menu.close = () => (menu.remove(), anchor.setAttribute("aria-expanded", "false"), document.removeEventListener("pointerdown", away, true), document.removeEventListener("keydown", key, true));
  const row = (glyph, label, run) => h("button", { class: "acctrow", role: "menuitem", onclick: () => (menu.close(), run()) }, icon(glyph), h("span", { class: "grow" }, label));
  const look = h("div", { class: "acctlook", role: "radiogroup", "aria-label": "Appearance" });
  const drawLook = () =>
    fill(
      look,
      [["dark", "Dark"], ["light", "Light"], ["system", "Match my computer"]].map(([id, label]) => {
        const on = (window.talqavaTheme?.choice ?? "dark") === id;
        return h("button", { class: on ? "on" : "", role: "radio", "aria-checked": String(on), onclick: () => (window.talqavaTheme?.set(id), drawLook()) }, label);
      }),
    );
  drawLook();
  const initials = anchor.textContent;
  fill(
    menu,
    h("div", { class: "accthead" }, h("span", { class: "acctavatar", "aria-hidden": "true" }, initials), h("div", { class: "who" }, h("b", {}, me?.name || org.name || "You"), h("span", {}, me ? `${state.me.role.name}${org.name ? ` · ${org.name}` : ""}` : "On this computer"))),
    h("div", { class: "acctsep" }),
    row("integrations", "Connections", () => go("integrations")),
    row("security", "Security", () => go("security")),
    row("audit", "Activity log", () => go("audit")),
    row("usage", "Usage", () => go("usage")),
    row("settings", "Settings", () => go("settings")),
    h("div", { class: "acctsep" }),
    h("div", { class: "acctlabel" }, "Look"),
    look,
    h("div", { class: "acctsep" }),
    // Help opens the guide for the page you are on; the welcome can be seen again from here.
    row("guide", guideFor(state.view) ? "Help with this page" : "Help", () => showGuide(guideFor(state.view) ?? "getting-started")),
    row("new", "Show the welcome again", () => showWelcome()),
    me ? row("security", "Sign out", () => attempt(async () => (await api("POST", "logout"), (state.me = null), showLogin()))) : null,
  );
  document.body.append(menu);
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", key, true);
  menu.querySelector(".acctrow")?.focus();
}

/** Under the menu: the few things in motion right now, so the owner can step back into them. */
function renderRecent() {
  if (!ui.recent) return;
  let live: any[] = [];
  try {
    live = mailMessages().filter((m) => m.label === "needs" || m.label === "failed" || m.label === "working").slice(0, 5);
  } catch {}
  fill(
    ui.recent,
    live.length ? h("div", { class: "raillabel" }, "Right now") : null,
    live.map((m) => h("button", { class: `railitem recentitem ${m.label}`, title: `${LABEL_WORDS[m.label]}: ${m.subject}`, onclick: () => ((ui.mailOpen = m.id), go("inbox")) }, h("span", { class: "recentdot", "aria-hidden": "true" }), h("span", { class: "grow" }, m.subject))),
  );
}

function go(view, id = null) {
  ui.wsFlush?.();
  // There is one place to ask: a new session. What used to be a separate home page leads there.
  if (view === "start") (view = "chat"), (id = null);
  // A task opened from the list of sessions stays part of Sessions; opened from anywhere else, it belongs to Team.
  if (view !== "quest") ui.questFrom = null;
  if (!["workspace", "docs", "notes", "sheets", "slides"].includes(view)) (ui.wsEditor?.destroy(), (ui.wsEditor = null), (ui.wsFlush = null));
  state.view = view;
  state.convId = view === "chat" || view === "quest" ? id : null;
  state.botId = view === "bot" ? id : null;
  state.marketId = view === "marketbot" ? id : null;
  if (view === "project") state.projectId = id;
  closePalette();
  document.body.classList.remove("menuopen"); // on a narrow window the menu slides away once a page is chosen
  renderTop();
  renderAreaTabs();
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
  clearTimeout(flags.enterTimer);
  flags.enterTimer = setTimeout(() => body.classList.remove("enter"), 700);
}

// The repository picker and quest spending only matter on the bot pages.
const onBotPages = () => ["home", "quest", "bot", "team"].includes(state.view);

function renderBody() {
  state.source?.close();
  state.source = null;
  ui.log = null;
  ui.body.className = "body";
  const views = { usage: usageView, setup: setupView, home: homeView, quest: questView, bot: botView, chat: chatView, memory: memoryView, skills: skillsView, jobs: jobsView, settings: settingsView, market: marketView, marketbot: marketBotView, inbox: inboxView, team: teamView, integrations: integrationsView, library: libraryView, audit: auditView, workspace: workspaceView, tasks: tasksView, projects: projectsView, project: projectView, security: securityView, office: officeView, slides: slidesView, docs: docsView, notes: notesView, sheets: sheetsView };
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
  const repos = bots && (lab("git") || c.projects.length > 0); // the repository picker is part of Git, which is set aside unless in use
  renderRail();
  fill(ui.top,
    h("button", { class: "menubtn", "aria-label": "Menu", "aria-expanded": String(document.body.classList.contains("menuopen")), onclick: () => document.body.classList.toggle("menuopen") }, h("span", { "aria-hidden": "true" }, "☰")),
    ...[
      repos
        ? h(
            "div",
            { class: "repo", title: state.project || "Tasks work in the workspace folder. Connect repositories under Connections → Git." },
            h("span", { class: "repolabel" }, "Repository"),
            repo,
            state.project && state.crew?.branch ? [h("span", { class: "on" }, "on"), state.crew.branch] : null,
          )
        : null,
      paletteBox(),
      bots ? ui.spent : null,
    ].filter(Boolean),
  );
  renderSpent();
}

function renderSpent() {
  syncInboxCount();
  if (!ui.spent) return;
  const today = new Date().toDateString();
  const spent = state.quests.filter((q) => new Date(q.createdAt).toDateString() === today).reduce((sum, q) => sum + (q.cost || 0), 0);
  // Nothing spent, nothing said.
  if (spent < 0.005) return fill(ui.spent);
  fill(ui.spent, "Spent today on agents", h("b", {}, money(spent)));
}

// ---------- the command box ----------
const COMMANDS: [string, () => void][] = [
  ["Home", () => go("start")],
  ["New session", () => go("chat")],
  ["Inbox", () => go("inbox")],
  ["Tasks", () => go("tasks")],
  ["Projects", () => go("projects")],
  ["Automations", () => go("jobs")],
  ["Usage", () => go("usage")],
  ["Agents", () => go("home")],
  ["Create an agent", () => go("bot", "new")],
  ["Organization", () => go("team")],
  ["Marketplace", () => go("market")],
  ["Office", () => go("office")],
  ["Documents", () => go("docs")],
  ["Sheets", () => go("sheets")],
  ["Slides", () => go("slides")],
  ["Notes", () => go("notes")],
  ["Workspace (pages)", () => go("workspace")],
  ["Library (files)", () => go("library")],
  ["Memory", () => go("memory")],
  ["Skills", () => go("skills")],
  ["Security: people and sign-in", () => ((ui.securityTab = "people"), go("security"))],
  ["Security: sensitive information", () => ((ui.securityTab = "info"), go("security"))],
  ["Security: rules for agents (guardrails)", () => ((ui.securityTab = "agents"), go("security"))],
  ["Security: alerts, reviews and retention", () => ((ui.securityTab = "watching"), go("security"))],
  ["Security: backups", () => ((ui.securityTab = "backups"), go("security"))],
  ["Activity log", () => go("audit")],
  ["Connections: AI models", () => ((ui.integration = "ai-models"), go("integrations"))],
  ["Connections: connectors", () => ((ui.integration = "mcp"), go("integrations"))],
  ["Settings", () => go("settings")],
  ["User guide", () => showGuide(guideFor(state.view) ?? "getting-started")],
];

/** What "find anything" turned up for the words in the box, fetched a moment after typing stops. */
const FOUND_WORDS = { page: "Page", doc: "Document", sheet: "Sheet", deck: "Slides", note: "Note", library: "Library", task: "Task", chat: "Chat", agent: "Agent" };
function openFound(r) {
  if (["page", "doc", "sheet", "deck", "note"].includes(r.kind)) return openPage(r.id);
  if (r.kind === "task") return openTask(r.id);
  if (r.kind === "chat") return go("chat", r.id);
  if (r.kind === "agent") return go("bot", r.id);
  return go("library");
}
function findSoon(box) {
  clearTimeout(flags.findTimer);
  const text = ui.palette?.value.trim() ?? "";
  if (text.length < 2 || text.startsWith("@")) return (ui.found = null);
  if (ui.found?.query === text) return;
  flags.findTimer = setTimeout(async () => {
    const r = await api("GET", `find?q=${encodeURIComponent(text)}`).catch(() => null);
    if (!r || (ui.palette?.value.trim() ?? "") !== text) return;
    ui.found = r;
    if (document.activeElement === ui.palette) openPalette(box);
  }, 220);
}

function paletteBox() {
  ui.palette = h("input", { type: "text", placeholder: paletteHint(), "aria-label": "Find anything, ask something, or give an agent a task", autocomplete: "off" });
  ui.paletteList = null;
  ui.paletteAt = 0;
  const box = h("div", { class: "palette" }, ui.palette, h("span", { class: "keys" }, navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"));
  ui.palette.addEventListener("input", () => (findSoon(box), openPalette(box)));
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
  return "Find anything, ask in a new chat, or type @name to give an agent a task";
}

function paletteItems() {
  const text = ui.palette?.value.trim() ?? "";
  const bots = state.crew?.bots ?? [];
  const items: any[] = [];
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
    ...COMMANDS.filter(([name]) => lab("office") || !["Sheets", "Slides"].includes(name)),
    ...(state.templates ?? []).map((t) => [`Standard task: ${t.name}`, () => (go("home"), openCoreQuest(t.id))]),
    ...bots.map((b) => [`Edit ${b.name}`, () => go("bot", b.id)]),
  ];
  // What was found for these words, across files, pages, the library, tasks, chats and agents.
  if (ui.found?.query === text) for (const r of ui.found.results) items.push({ label: r.title, what: `${FOUND_WORDS[r.kind] ?? ""}${r.note ? ` · ${r.note}` : ""}`, run: () => openFound(r) });
  for (const [label, run] of commands) if (!needle || label.toLowerCase().includes(needle)) items.push({ label, what: needle ? "Go to" : "", run });
  return items.slice(0, needle ? 24 : 12);
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
  return new Promise<any>((resolve) => {
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
      ui.log.append(errorBanner(event.text));
      break;
  }
  if (stick || event.type === "sync" || event.type === "user") ui.scroll.scrollTop = ui.scroll.scrollHeight;
}

/** An answer that failed, kept on the chat in plain words, with a button that asks again. Nothing is added to the chat. */
function errorBanner(text) {
  const again = state.view === "chat" && state.convId;
  return h(
    "div",
    { class: "banner error failbanner", role: "alert" },
    h("div", { class: "grow" }, h("b", {}, "That did not work. "), String(text), h("div", { class: "note small" }, again ? "Nothing is lost. Try again asks the same thing once more." : "Nothing is lost. Try the task again from its page.")),
    again ? h("button", { class: "primary small", onclick: (e) => attempt(async () => (e.currentTarget.closest(".failbanner")?.remove(), await api("POST", `conversations/${state.convId}/retry`)), ui.log) }, "Try again") : null,
  );
}

/** Why a run stopped before finishing, kept on the chat, with a button that carries on. */
function stopBanner(text) {
  const words = String(text).replace(/\s*Say “?"?continue"?”?[^.]*\.\s*$/i, "").trim();
  return h(
    "div",
    { class: "banner stopbanner" },
    h("div", { class: "grow" }, h("b", {}, "It stopped before finishing. "), words, h("div", { class: "note small" }, "Nothing is lost. Continue to let it carry on from here, or raise the limit under Settings → Budgets.")),
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
  if (conv.lastError && !live.running) ui.log.append(errorBanner(conv.lastError.text));
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

function summarize(name, input: any = {}) {
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

const NAMES = { bash: "Command", str_replace_based_edit_tool: "Files", web_search: "Web search", web_fetch: "Read page", http_request: "Web service", memory: "Memory", skill: "Skill", schedule: "Schedule", browser: "Browser", conversation_search: "Search chats", code_execution: "Calculation", assign_task: "Handed off" };

/**
 * One step of the work, said so that anyone understands it: what was done, never the command or the address in full.
 * The exact command stays one click away, inside the step, for whoever wants it.
 */
function plainStep(name, input: any = {}) {
  const file = (path) => String(path ?? "").split("/").filter(Boolean).pop() || "a file";
  const site = (url) => {
    try {
      return new URL(String(url)).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const quote = (text, n = 70) => ((t) => (t ? `“${t.length > n ? `${t.slice(0, n)}…` : t}”` : ""))(String(text ?? "").replace(/\s+/g, " ").trim());
  if (name === "bash") return input.command ? "Ran a command on this computer" : "Restarted its command line";
  if (name === "str_replace_based_edit_tool") return input.command === "view" ? `Read ${file(input.path)}` : input.command === "create" ? `Wrote ${file(input.path)}` : `Changed ${file(input.path)}`;
  if (name === "web_search") return `Searched the web for ${quote(input.query) || "something"}`;
  if (name === "web_fetch") return `Read a page on ${site(input.url) || "the web"}`;
  if (name === "http_request") return /^(GET|HEAD)$/i.test(String(input.method ?? "GET")) ? `Read from ${site(input.url) || "a web service"}` : `Sent data to ${site(input.url) || "a web service"}`;
  if (name === "browser") return site(input.url) ? `Opened ${site(input.url)} in the browser` : "Used the browser";
  if (name === "conversation_search") return `Looked through past chats for ${quote(input.query) || "something"}`;
  if (name === "assign_task") return `Gave a task to ${input.to || "someone on the team"}`;
  if (name === "memory") return "Looked at what it remembers";
  if (name === "skill") return input.action === "save" || input.action === "create" ? `Saved a skill ${quote(input.name, 40)}`.trim() : `Read a skill ${quote(input.name, 40)}`.trim();
  if (name === "schedule") return "Looked at or changed an automation";
  if (name === "code_execution") return "Worked something out";
  if (name === "find_tools") return "Looked for the right tool";
  // A connected service's step is named "<service>__<what it does>".
  const [service, action] = String(name).split("__");
  if (action) return `${service.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}: ${action.replace(/_/g, " ")}`;
  return `Used ${NAMES[name] || String(name).replace(/_/g, " ")}`;
}

function toolCard(id, name, input, done) {
  const stateEl = h("span", { class: `state ${done ? "ok" : ""}` }, done ? "done" : "working…");
  const body = h("div", { class: "body" }, h("div", { class: "label" }, "The exact step"), h("pre", {}, typeof input === "string" ? input : JSON.stringify(input, null, 2)));
  const card = h("details", { class: "tool", "data-words": plainStep(name, input) }, h("summary", {}, h("span", { class: "what plain" }, plainStep(name, input)), stateEl), body);
  ui.cards.set(id, { card, body, stateEl });
  return card;
}

/**
 * The steps of one piece of work are kept together under a single line ("7 steps · Read prices.pdf"), closed to
 * begin with, so a conversation reads as what was said and what came of it. Opening it shows each step in plain
 * words; opening a step shows exactly what was run.
 */
function addStep(node, words?) {
  const last = ui.working?.isConnected ? ui.working.previousElementSibling : ui.log.lastElementChild;
  let box: any = last?.classList?.contains("worklog") ? last : null;
  if (!box) {
    box = h("details", { class: "worklog" }, h("summary", {}, h("span", { class: "worksum" }), h("span", { class: "workshow" })));
    box.steps = 0;
    add(box);
  }
  box.append(node);
  if (words) {
    box.steps += 1;
    box.last = words;
  }
  box.querySelector(".worksum").textContent = box.steps ? `${box.steps} step${box.steps === 1 ? "" : "s"} · ${box.last}` : "Thought it through";
  return node;
}

/**
 * What the agent saved to memory, shown in the conversation as it happens,
 * with Edit and Undo, so nothing is remembered behind the person's back.
 */
function memoryNote(id, input: any = {}) {
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
  const steps: any[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text.trim()) {
      box.append(h("div", { class: "md" }, renderMarkdown(block.text)));
    } else if (block.type === "thinking" && block.thinking?.trim()) {
      steps.push([h("details", { class: "think" }, h("summary", {}, "Thought about it"), h("div", { class: "body" }, block.thinking)), ""]);
    } else if (block.type === "tool_use" && block.name === "memory") {
      const note = memoryNote(block.id, block.input);
      // What it saves to memory is said in the conversation itself; only a look at memory is a step.
      if (note.classList.contains("tool")) steps.push([note, plainStep(block.name, block.input)]);
      else box.append(note);
    } else if (block.type === "tool_use" || block.type === "mcp_tool_use") {
      steps.push([toolCard(block.id, block.name, block.input, false), plainStep(block.name, block.input)]);
    } else if (block.type === "server_tool_use") {
      steps.push([toolCard(block.id, block.name, block.input, true), plainStep(block.name, block.input)]);
    } else if (/_tool_result$/.test(block.type) && block.tool_use_id) {
      fillResult(block);
    }
  }
  if (box.childNodes.length) add(box);
  // The steps go under one line, after what was said.
  for (const [node, words] of steps) addStep(node, words);
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
    s.think.textContent = "Thinking it through…";
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
    s.box.append(h("div", { class: "note" }, "Getting the next step ready…"));
  }
}

function clearStream() {
  ui.stream?.box.remove();
  ui.stream = null;
}

/** A step an agent asks about, in plain words: the question to put to the owner, and one line on what exactly. */
function stepWords(approval) {
  const name = approval.name;
  const input = approval.input ?? {};
  const cut = (v, n = 160) => ((t) => (t.length > n ? `${t.slice(0, n)}…` : t))(String(v ?? "").replace(/\s+/g, " ").trim());
  if (name === "bash") return { ask: "Run a command on this computer?", what: cut(input.command) };
  if (name === "str_replace_based_edit_tool") return { ask: input.command === "view" ? "Read a file?" : "Change a file?", what: cut(input.path) };
  if (name === "http_request") {
    let host = "";
    try {
      host = new URL(String(input.url)).hostname;
    } catch {}
    return { ask: /^(GET|HEAD)$/i.test(String(input.method ?? "GET")) ? `Read from ${host || "a web address"}?` : `Send data to ${host || "a web address"}?`, what: cut(`${input.method || "GET"} ${input.url || ""}`) };
  }
  if (name === "browser") return { ask: "Use the browser?", what: cut(`${input.action || ""} ${input.url || input.target || ""}`) };
  if (name === "assign_task") return { ask: "Hand part of the work to someone else?", what: cut(`to ${input.to || "an agent"}: ${input.task || ""}`) };
  // A connected service's step is named "<service>__<what it does>".
  const [service, action] = name.split("__");
  const said = Object.entries(input)
    .filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${cut(v, 70)}`)
    .join(" · ");
  if (action) return { ask: `${service[0].toUpperCase()}${service.slice(1)}: ${action.replace(/_/g, " ")}?`, what: said };
  return { ask: `Use ${NAMES[name] || name}?`, what: summarize(name, input) ? cut(summarize(name, input)) : said };
}

/**
 * The card an agent's question is shown as, wherever it appears: who asks, the question in plain words, one line on
 * what exactly, the full details folded away, and one clear button. Nothing happens until the owner presses it.
 */
function approvalAsk(approval, { who, bot = null, decide, always = "", extra = null, id = "" }) {
  const words = stepWords(approval);
  const full = approval.name === "bash" ? String(approval.input?.command ?? "") : JSON.stringify(approval.input ?? {}, null, 2);
  return h(
    "section",
    { class: "askcard", ...(id ? { id } : {}), role: "group", "aria-label": `${who} asks: ${words.ask}` },
    h("div", { class: "askcardhead" }, bot ? keycap(bot, 24, "", bot.type) : null, h("div", { class: "grow" }, h("b", {}, words.ask), h("span", { class: "note small" }, `${who} is asking before doing this.`))),
    words.what ? h("p", { class: "askcardwhat" }, words.what) : null,
    approval.reason ? h("p", { class: "note small" }, approval.reason) : null,
    h("details", { class: "askcardmore" }, h("summary", {}, "Show the details"), h("pre", {}, full)),
    h(
      "div",
      { class: "askcardfoot" },
      h("span", { class: "note small grow" }, "Nothing happens until you say so."),
      extra,
      h("button", { class: "plain", onclick: () => decide("deny") }, "Don't allow"),
      h("button", { class: "primary", onclick: () => decide("allow") }, "Allow"),
    ),
    always && !approval.reason ? h("button", { class: "plain link small askcardalways", onclick: () => decide("always") }, always) : null,
  );
}

function addApproval(approval) {
  if (document.getElementById(`approval-${approval.id}`)) return;
  const decide = (decision) => attempt(() => api("POST", `conversations/${state.convId}/approvals/${approval.id}`, { decision }));
  add(approvalAsk(approval, { who: speaker(), bot: chatBotOf(), decide, always: `Always allow ${NAMES[approval.name] || approval.name.replace(/__/g, ": ").replace(/_/g, " ")} in this chat`, id: `approval-${approval.id}` }));
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
const TINT_WORDS: [RegExp, string][] = [
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
const SYMBOL_WORDS: [RegExp, string][] = [
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
function keycap(subject, size = 40, mood = "", _extra3?) {
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
  const members = new Set<any>(activeOrg().members.map((m) => m.bot));
  const mine = bots.filter((b) => members.has(b.id));
  return mine.length ? mine : bots;
}

/** Bots by department in the selected organization, departments in name order. */
function byDepartment(bots) {
  const groups = new Map<any, any>();
  for (const bot of bots) groups.set(departmentOf(bot.id), [...(groups.get(departmentOf(bot.id)) ?? []), bot]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Bots by team group, groups in name order. */
function byGroup(bots) {
  const groups = new Map<any, any>();
  for (const bot of bots) groups.set(bot.group || "Other", [...(groups.get(bot.group || "Other") ?? []), bot]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderCrewColumn() {
  const all = state.crew?.bots ?? [];
  const bots = orgBots();
  const org = activeOrg();
  const orgs = state.orgs?.orgs ?? [];
  const orgPick = h("select", { class: "orgpick", "aria-label": "Organization", onchange: (e) => attempt(async () => (await api("PATCH", `orgs/${e.target.value}`, { active: true }), await loadOrgs(), (state.selectedBot = null), renderHome())) }, orgs.map((o) => h("option", { value: o.id, selected: o.id === org.id }, o.name)));
  const live = new Map<any, any>(state.quests.filter(isLive).map((q) => [q.bot.id, q]));
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
    h("div", { class: "side-head" }, h("h2", { class: "label" }, `${orgs.length > 1 ? "" : `${org.name || "Organization"} · `}${bots.length} agent${bots.length === 1 ? "" : "s"} · ${new Set<any>(bots.map((b) => departmentOf(b.id))).size} department${new Set<any>(bots.map((b) => departmentOf(b.id))).size === 1 ? "" : "s"}`), h("button", { class: "plain small", onclick: () => go("team"), title: "The org chart, departments and budgets" }, "Chart →")),
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
function navFooter(_extra0?) {
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
  const stat = (label, value, note, loud?) => h("div", { class: "stat" }, h("span", { class: "label" }, label), h("b", { class: loud ? "loud" : "" }, value), note ? h("span", { class: "statnote" }, note) : null);

  // ----- assign a task: to a whole team (through its manager, who splits it up) or to one agent -----
  const orgMembers = activeOrg().members.filter((m) => bots.some((b) => b.id === m.bot));
  const underOf = (id) => {
    const all = new Set<any>([id]);
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
    const doing = approval ? `Wants to use ${NAMES[approval.name] || approval.name}` : q.checking ? "Checking the result" : q.activity ? plainStep(q.activity.name, q.activity.input) : "Thinking";
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
  const depts = new Map<any, any>();
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

  // Before any work has been given, the page is who is on the team and the box to give them something: no rows of zeros.
  const quietBoard = !needs.length && !active.length && !weekAll.length;
  fill(ui.board, 
    h("div", { class: "board-head" }, h("div", {}, h("h1", {}, "Agents"), h("p", { class: "lead" }, "Assign work, clear what is waiting on you, and see how each department is doing."))),
    composer,
    quietBoard ? null : h(
      "section",
      { class: "stats" },
      stat("Waiting on you", String(needs.length), needs.length ? "Approvals, reviews and failures" : "Nothing blocked", needs.length > 0),
      stat("In progress", String(active.length), active.length ? `${new Set<any>(active.map((q) => q.bot.id)).size} agent${new Set<any>(active.map((q) => q.bot.id)).size === 1 ? "" : "s"} working` : "No tasks under way"),
      stat("Finished this week", String(week.length), week.length ? `${Math.round((succeeded.length / week.length) * 100)}% finished cleanly` : "None yet"),
      stat("Spent this week", money(spent), weekAll.length ? `${money(spent / weekAll.length)} a task on average` : "Estimated from list prices"),
    ),
    needs.length
      ? h("section", { class: "worksec" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "Waiting on you"), h("button", { class: "plain small", onclick: () => go("inbox") }, "Open inbox →")), h("div", { class: "cards" }, needs.filter((n) => n.kind === "approval").map((n) => questCard(n.q))), h("div", { class: "needlist" }, needs.filter((n) => n.kind !== "approval").map(needRow)))
      : null,
    quietBoard ? null : h(
      "section",
      { class: "worksec" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "Under way"), active.length ? h("span", { class: "note small" }, "Indented tasks were handed on by the one above") : null),
      active.length ? h("div", { class: "flow" }, roots.flatMap((q) => flow(q))) : h("div", { class: "card quiet" }, h("b", {}, "Nothing under way."), h("span", { class: "note" }, " Assign a task above. A lead will split it across its team, and each hand-off shows here beneath it.")),
    ),
    ((results) =>
      results.length
        ? h("section", { class: "worksec" }, h("div", { class: "row" }, h("h2", { class: "grow" }, "Latest results"), h("button", { class: "plain small", onclick: () => go("inbox") }, "All updates →")), h("div", { class: "updates" }, results.map((q) => updateCard(q, { compact: true }))))
        : null)(ownTasks().filter((q) => !isLive(q)).slice(0, 3)),
    quietBoard ? null : h(
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
    const words = n.kind === "auto" ? [`${n.j.name}: its last run ${n.j.last.outcome === "skipped" ? "was left out" : "did not work"}`, n.j.last.words, () => ((ui.autoTab = "runs"), go("jobs"))] : n.kind === "chat" ? [n.c.title || "A chat", "A chat is waiting for your approval", () => go("chat", n.c.id)] : n.kind === "monthly" ? [`${n.bot.title || n.bot.name}: its own monthly budget is used up`, "It starts no new work until you raise it on its page", () => go("bot", n.bot.id)] : ["All agents: the monthly budget for all agents is used up", "No agent starts new work until you raise it in Settings", () => go("settings")];
    return h("button", { class: "needrow", onclick: words[2] }, h("span", { class: "flowmain" }, h("b", {}, words[0]), h("span", { class: "flowsub" }, words[1])), h("span", { class: "pill loud" }, "Open"));
  }
  const why = { review: "Changes ready for your review", check: "Finished, but its check failed", failed: n.q.note ? `Failed: ${n.q.note}` : "Failed", budget: "Stopped at its budget: say “continue” to keep going" }[n.kind] ?? "";
  return h("button", { class: "needrow", style: botStyle(n.q.bot), onclick: () => go("quest", n.q.id) }, keycap(n.q.bot, 30, mood(n.q), n.q.bot.type), h("span", { class: "flowmain" }, h("b", {}, n.q.title), h("span", { class: "flowsub" }, `${n.q.bot.name} · ${departmentOf(n.q.bot.id)} · ${why}`)), h("span", { class: "pill loud" }, n.kind === "review" ? "Review" : "Open"));
}

/** The ready-made quests, each with the bot that goes and how its result is checked. */
function coreQuests() {
  // Ready-made tasks that work on code are offered only where code is worked on: with Git switched on, or a repository connected.
  const code = lab("git") || (state.config?.projects ?? []).length > 0;
  const templates = (state.templates ?? []).filter((t) => code || (t.repository ?? "none") === "none");
  if (!templates.length) return null;
  const bots = state.crew?.bots ?? [];
  const checkWords = (c) =>
    [c.command && "runs the tests", c.changed && c.changed !== "any" && `${c.changed} changes`, c.covers && "covers everything", c.links && `${c.links}+ sources`].filter(Boolean).join(" · ");
  return h(
    "section",
    { class: "core worksec" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "Ready-made tasks"), h("span", { class: "note small" }, "Each result is checked before it counts as done")),
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
  const doing = q.activity ? plainStep(q.activity.name, q.activity.input) : "Thinking";
  const showOutput = q.activity && q.status === "running" && (q.activity.name === "bash" ? `$ ${q.activity.input?.command ?? ""}\n${q.activity.output}` : q.activity.output);
  return h(
    "article",
    { class: `qcard ${q.status}`, style: botStyle(q.bot), onclick: () => go("quest", q.id), tabindex: "0", onkeydown: (e) => e.key === "Enter" && go("quest", q.id) },
    q.status === "running" ? h("div", { class: "scanline", "aria-hidden": "true" }, h("span")) : null,
    h("div", { class: "head" }, h("b", {}, q.title), keycap(q.bot, 28, mood(q), q.bot.type)),
    approval
      ? h("div", { class: "now wait" }, `◌ ${q.bot.name} asks: ${stepWords(approval).ask}`)
      : h("div", { class: "now" }, `● ${q.bot.name} · step ${q.steps || 1}${q.budget?.steps ? ` of up to ${q.budget.steps}` : ""} · ${doing}`),
    approval ? h("pre", {}, approval.name === "bash" ? approval.input.command : JSON.stringify(approval.input, null, 2)) : showOutput ? h("pre", {}, showOutput.trim()) : null,
    approval?.reason || (q.readOutside && q.status === "running")
      ? h("div", { class: "caution" }, `Read outside content, so any change ${q.bot.name} wants to make now needs your approval.`)
      : null,
    approval
      ? h(
          "div",
          { class: "row" },
          h("button", { class: "primary", onclick: decide(approval, "allow") }, "Allow"),
          h("button", { onclick: decide(approval, "deny") }, "Don't allow"),
          approval.reason ? null : h("button", { class: "plain link small", onclick: decide(approval, "always") }, "Always, for this task"),
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
  // The column of finished work appears with the first finished task.
  ui.logCol.hidden = !done.length;
  ui.body.classList.toggle("nolog", !done.length);
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
  const needs: any[] = [];
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
  for (const p of state.serviceProblems ?? []) needs.push({ kind: "service", p });
  // An automation whose last run did not work, or was left out: said once for that run, so nothing fails in silence.
  for (const j of state.autoJobs ?? []) if (j.enabled && j.last && (j.last.outcome === "failed" || j.last.outcome === "skipped")) needs.push({ kind: "auto", j });
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
  const doing = live && !waiting ? (q.activity ? plainStep(q.activity.name, q.activity.input) : "Thinking") : "";
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

// In the inbox an agent goes by its job title, as everywhere else in the app. The owner can give it a person's name
// instead (Rename); the suggested names are picked from the agent's id, so a suggestion stays the same every time.
const FIRST_NAMES = ["Maya", "Noah", "Ava", "Liam", "Zara", "Ethan", "Priya", "Lucas", "Sofia", "Omar", "Chloe", "Mateo", "Amara", "Daniel", "Leila", "Kenji", "Grace", "Ravi", "Nora", "Diego", "Hana", "Samuel", "Isla", "Arjun", "Elena", "Theo", "Yara", "Marcus", "Ines", "Jonah", "Mei", "Felix", "Aisha", "Leo", "Camila", "Owen", "Nadia", "Hugo", "Ruby", "Tariq", "Freya", "Kofi", "Lina", "Rafael", "June", "Idris", "Sana", "Elias"];
const LAST_NAMES = ["Brooks", "Chen", "Patel", "Rivera", "Okafor", "Novak", "Kim", "Hughes", "Silva", "Moreau", "Haddad", "Larsen", "Ito", "Mensah", "Costa", "Fischer", "Reyes", "Sato", "Walsh", "Kaur", "Bennett", "Duarte", "Lindqvist", "Nakamura", "Adeyemi", "Byrne", "Castillo", "Dubois"];
const nameHash = (text, seed) => [...text].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), seed);
const defaultAgentName = (id) => `${FIRST_NAMES[nameHash(id, 2166136261) % FIRST_NAMES.length]} ${LAST_NAMES[nameHash(id, 374761393) % LAST_NAMES.length]}`;
/** The name an agent goes by in the inbox: the one the owner gave it, or its job title, as everywhere else. */
const agentRole = (bot) => (bot ? activeOrg()?.members?.find((m) => m.bot === bot.id)?.title || bot.title || bot.name : "Your workspace");
const agentName = (bot) => (bot ? state.mail?.names?.[bot.id] || agentRole(bot) : "Talqava");
/** "Name, Title" when the owner named the agent; just the title otherwise. */
const agentWho = (bot) => (bot && state.mail?.names?.[bot.id] ? `${agentName(bot)} · ${agentRole(bot)}` : agentName(bot));

/** Changes agents suggested to workspace pages, waiting for the owner. */
async function loadPageSuggestions() {
  const before = JSON.stringify((state.pageSuggestions ?? []).map((s) => s.id));
  const rowsBefore = JSON.stringify((state.rowChanges ?? []).map((c) => c.id));
  const remindersBefore = JSON.stringify((state.reminders ?? []).map((r) => r.id));
  [state.pageSuggestions, state.rowChanges, state.reminders] = await Promise.all([api("GET", "workspace/suggestions").catch(() => state.pageSuggestions ?? []), api("GET", "workspace/tables/waiting").catch(() => state.rowChanges ?? []), api("GET", "workspace/reminders").catch(() => state.reminders ?? [])]);
  if (state.view === "inbox" && (JSON.stringify(state.reminders.map((r) => r.id)) !== remindersBefore || JSON.stringify(state.pageSuggestions.map((s) => s.id)) !== before || JSON.stringify(state.rowChanges.map((c) => c.id)) !== rowsBefore)) renderInbox();
}

async function loadMail() {
  loadPageSuggestions();
  try {
    [state.mail, state.workItems, state.serviceProblems, state.checkIn, state.briefings] = await Promise.all([api("GET", "inbox"), api("GET", "work").then((w) => w.items).catch(() => state.workItems ?? []), api("GET", "gateway/problems").catch(() => state.serviceProblems ?? []), api("GET", "work/checkin").catch(() => state.checkIn ?? null), api("GET", "jobs/briefings").catch(() => state.briefings ?? null)]);
    state.autoJobs = await api("GET", "jobs").catch(() => state.autoJobs ?? []);
  } catch {
    state.mail ??= { messages: {}, names: {} };
  }
}

const MONTH_START = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

/** Every message: one per task the person assigned, plus whatever else needs them. Newest activity first. */
function mailMessages() {
  const out: any[] = [];
  const own = ownTasks();
  const needs = inboxItems().needs;
  // A plan to approve, a question before starting, or finished work to review is shown as that, with its buttons, instead of as the task's ordinary message.
  const ACTION = new Set<any>(["plan", "asking", "taskreview"]);
  const actionFor = new Set<any>(needs.filter((n) => n.q && ACTION.has(n.kind)).map((n) => n.q));
  for (const q of own) {
    if (actionFor.has(q)) continue;
    // A watching briefing that found nothing new answers with two words, and the owner is not disturbed.
    if (!isLive(q) && /^\W*NOTHING NEW\W*$/i.test(String(q.said ?? ""))) continue;
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
    else if (n.kind === "auto") out.push({ id: `need:auto:${n.j.id}:${n.j.last.at}`, kind: "need", need: n, bot: null, subject: n.j.last.outcome === "skipped" ? `${n.j.name} was left out this time` : `${n.j.name} did not work`, snippet: n.j.last.words, at: n.j.last.at, activityAt: n.j.last.at, label: "failed" });
    else if (n.kind === "service") out.push({ id: `need:service:${n.p.id}:${n.p.problem.slice(0, 40)}`, kind: "need", need: n, bot: null, subject: `${n.p.name} is not working`, snippet: n.p.problem, at: new Date().toISOString(), activityAt: new Date().toISOString(), label: "needs" });
    else if (n.kind === "total") out.push({ id: `need:total:${MONTH_START().slice(0, 7)}`, kind: "need", need: n, bot: null, subject: "Your agents have reached this month's budget", snippet: "No agent starts new work until you raise it or the month turns.", at: MONTH_START(), activityAt: MONTH_START(), label: "needs" });
  }
  // The leads' daily check-in: one message a day, built from the tasks.
  if (state.checkIn?.groups?.length) {
    const day = new Date();
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8).toISOString();
    const g = state.checkIn.groups;
    const n = (k) => g.reduce((sum, x) => sum + x[k].length, 0);
    out.push({ id: `checkin:${at.slice(0, 10)}`, kind: "checkin", bot: null, subject: "Daily check-in from your leads", snippet: `${n("moved")} moved, ${n("stuck")} stuck or waiting, ${n("next")} up next, across ${g.length} group${g.length === 1 ? "" : "s"}.`, at, activityAt: at, label: n("stuck") ? "needs" : "done" });
  }
  // A briefing built from your own tasks (the Monday plan, the Friday wrap-up): the latest of each kind.
  for (const d of state.briefings?.digests ?? []) {
    const def = (state.briefings.briefings ?? []).find((b) => b.id === d.id);
    const bot = state.crew?.bots.find((b) => b.id === def?.sender?.bot) ?? null;
    out.push({ id: `digest:${d.id}:${d.at.slice(0, 10)}`, kind: "digest", digest: d, briefing: def ?? null, bot, subject: `${d.name} · ${new Date(d.at).toLocaleDateString(undefined, { weekday: "long" })}`, snippet: d.text.split("\n")[0], at: d.at, activityAt: d.at, label: "done" });
  }
  // A change an agent suggested to a workspace page waits in the inbox too.
  for (const sg of state.pageSuggestions ?? []) {
    const bot = state.crew?.bots.find((b) => b.id === sg.author) ?? null;
    out.push({ id: `page:${sg.id}`, kind: "pagechange", suggestion: sg, bot, subject: `Suggested change: “${sg.pageTitle}”`, snippet: sg.note || "A change to a workspace page, for you to accept or decline.", at: sg.createdAt, activityAt: sg.createdAt, label: "needs" });
  }
  // A reminder you set on a note or document, once its time has come.
  for (const r of state.reminders ?? []) out.push({ id: `remind:${r.id}:${r.remindAt}`, kind: "reminder", reminder: r, bot: null, subject: `Reminder: “${r.title}”`, snippet: "You asked to be reminded of this.", at: r.remindAt, activityAt: r.remindAt, label: "needs" });
  // So does a change an agent asked for in a workspace table.
  for (const ch of state.rowChanges ?? []) {
    const bot = state.crew?.bots.find((b) => b.id === ch.author) ?? null;
    out.push({ id: `row:${ch.id}`, kind: "rowchange", change: ch, bot, subject: `Table change: “${ch.tableName}”`, snippet: ch.words, at: ch.createdAt, activityAt: ch.createdAt, label: "needs" });
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
  const n = mailMessages().filter((m) => waitsOnYou(m) && !markOf(m).archived && !markOf(m).deletedAt).length;
  ui.inboxCount.hidden = !n;
  ui.inboxCount.textContent = String(n);
  renderRecent();
  renderOverview();
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

/** The briefing a message came from, if any: one built from the tasks, or the task a briefing's last run made. */
function briefingFor(m) {
  if (m.kind === "digest") return m.briefing;
  if (m.kind !== "task" || !m.q) return null;
  return (state.briefings?.briefings ?? []).find((b) => b.on?.lastTaskId && (state.workItems ?? []).some((w) => w.id === b.on.lastTaskId && w.quest === m.q.id)) ?? null;
}

/** The Inbox's three lists. A message is in exactly one: it waits on the owner, it is news, or it is put away. */
const waitsOnYou = (m) => m.label === "needs" || m.label === "failed";
const INBOX_TABS: [string, string, (m: any, mark: any) => boolean][] = [
  ["waiting", "Waiting on you", (m, k) => waitsOnYou(m) && !k.archived && !k.deletedAt],
  ["updates", "Updates", (m, k) => !waitsOnYou(m) && !k.archived && !k.deletedAt],
  ["done", "Archive", (m, k) => k.archived && !k.deletedAt],
];
/** What kind of decision a waiting message is, in a few words. */
function waitingKind(m) {
  const need = { approval: "Needs your yes", plan: "Plan to approve", asking: "A question before starting", taskreview: "Finished work to review", review: "Changes to review", check: "Did not pass its check", failed: "Could not finish", budget: "Stopped at its budget", chat: "A chat is waiting", monthly: "Monthly budget reached", total: "Monthly budget reached", service: "A service is not working" };
  const own = { pagechange: "Suggested change", rowchange: "Table change", proposal: "Proposed position", reminder: "Reminder" };
  return m.kind === "need" ? (need[m.need.kind] ?? "Needs you") : (own[m.kind] ?? (m.label === "failed" ? "Needs a look" : "Needs you"));
}

function inboxView() {
  ui.body.className = "body";
  ui.log = null;
  ui.mailTab ??= "waiting";
  ui.mailBody ??= {};
  ui.mailDraft ??= {};
  ui.mailListKey = ui.mailReadKey = null;
  // The search box is made once, so typing is never interrupted when new messages arrive.
  const find = h("input", { type: "search", class: "inboxfind", placeholder: "Search…", value: ui.mailFind ?? "", "aria-label": "Search the Inbox" });
  find.addEventListener("input", () => ((ui.mailFind = find.value), (ui.mailOpen = null), renderInbox()));
  ui.mailTabs = h("div", { class: "inboxtabs", role: "tablist", "aria-label": "Inbox" });
  ui.mailList = h("div", { class: "inboxlist" });
  ui.mailRead = h("article", { class: "inboxread mailread" });
  ui.inbox = h("div", { class: "inbox2" }, h("div", { class: "inboxhead" }, h("h1", {}, "Inbox"), h("div", { class: "inboxbar" }, ui.mailTabs, find)), h("div", { class: "inboxpanes" }, ui.mailList, ui.mailRead));
  fill(ui.body, h("main", { class: "center" }, ui.inbox));
  // Opened from elsewhere on one message: show the list it is in.
  ui.mailJump = Boolean(ui.mailOpen);
  renderInbox();
  Promise.all([loadCrew(), loadMail()]).then(() => state.view === "inbox" && (renderInbox(), syncInboxCount()));
}

function renderInbox() {
  if (state.view !== "inbox" || !ui.mailList) return;
  const all = mailMessages().filter((m) => !markOf(m).purged && !markOf(m).deletedAt);
  const words = (ui.mailFind ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (m) => `${agentName(m.bot)} ${agentRole(m.bot)} ${m.subject} ${m.snippet}`.toLowerCase();
  const inTab = (id) => all.filter((m) => INBOX_TABS.find(([x]) => x === id)[2](m, markOf(m)));
  if (ui.mailJump && ui.mailOpen) {
    const target = all.find((m) => m.id === ui.mailOpen);
    if (target) ui.mailTab = INBOX_TABS.find(([, , test]) => test(target, markOf(target)))?.[0] ?? ui.mailTab;
  }
  const tab = INBOX_TABS.some(([id]) => id === ui.mailTab) ? ui.mailTab : "waiting";
  const newest = (x, y) => String(y.at).localeCompare(String(x.at));
  const shown = (words.length ? all.filter((m) => words.every((w) => haystack(m).includes(w))) : inTab(tab)).sort(newest);
  const who = (m) => (m.bot ? agentName(m.bot) : "Talqava");
  const refresh = async () => (await Promise.all([loadQuests(), refreshList(), loadCrew(), loadMail()]), renderInbox(), syncInboxCount());

  // ----- the three tabs -----
  const waiting = inTab("waiting").length;
  const unread = inTab("updates").filter(isUnread).length;
  fill(
    ui.mailTabs,
    INBOX_TABS.map(([id, label]) =>
      h(
        "button",
        { class: `inboxtab ${id === tab && !words.length ? "on" : ""}`, role: "tab", "aria-selected": String(id === tab && !words.length), onclick: () => ((ui.mailTab = id), (ui.mailOpen = null), (ui.mailJump = false), (ui.mailFind = ""), ui.inbox.querySelector(".inboxfind") && (ui.inbox.querySelector(".inboxfind").value = ""), renderInbox()) },
        label,
        id === "waiting" && waiting ? h("span", { class: "inboxcount" }, String(waiting)) : id === "updates" && unread ? h("span", { class: "inboxcount quiet", title: "Not read yet" }, String(unread)) : null,
      ),
    ),
  );

  // Typing an answer is never interrupted by a refresh.
  const typing = ui.inbox.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && !document.activeElement.classList.contains("inboxfind");
  const cardsMode = tab === "waiting" && !words.length;
  ui.inbox.classList.toggle("deciding", cardsMode);

  if (cardsMode) {
    // ----- waiting on you: every decision is a card, answered in place -----
    const key = JSON.stringify([ui.mailNote, shown.map((m) => [m.id, m.subject, m.snippet, m.at, m.label, m.q?.approvals?.length, m.q?.plan?.version, agentName(m.bot)])]);
    if (key === ui.mailListKey || (typing && ui.mailListKey)) return;
    ui.mailListKey = key;
    ui.mailReadKey = null;
    const card = (m) => {
      const node = h("section", { class: `inboxcard ${ui.mailOpen === m.id ? "open" : ""}`, id: `inbox-${m.id.replace(/[^\w-]/g, "_")}`, style: m.bot ? botStyle(m.bot) : "" });
      const act = (fn) => attempt(async () => (await fn(), await refresh()), node);
      const put = () => mailMark([m.id], { archived: true, read: true });
      const approvalOf = m.kind === "need" && m.need.kind === "approval" ? m.need.approval : null;
      // Deleting a step that waits for a yes answers "Don't allow" first, so the agent is not left waiting on a card nobody can see.
      const remove = () =>
        attempt(async () => {
          if (approvalOf) await api("POST", `conversations/${m.q.id}/approvals/${approvalOf.id}`, { decision: "deny" }).catch(() => {});
          await mailMark([m.id], { deleted: true });
          toast(approvalOf ? "Deleted, and the step was not allowed. The task is kept." : m.q ? "Deleted. The task is kept, and still shows under Tasks." : "Deleted from the Inbox.", { label: "Undo", run: () => mailMark([m.id], { deleted: false }) });
          if (approvalOf) await refresh();
        }, node);
      const meta = [who(m), m.q && m.kind === "need" ? `for “${m.q.title}”` : ""].filter(Boolean).join(" · ");
      let title = m.subject.replace(/^(Approval needed|Plan to approve|Needs your answer before starting|To review|Ready for your review|Did not pass its check|Could not finish|Stopped at its budget|Suggested change|Table change|Proposal|Reminder): /, "");
      let body;
      let reply = null;
      if (m.kind === "need" && m.need.kind === "approval") {
        const ap = m.need.approval;
        title = stepWords(ap).ask;
        body = approvalAsk(ap, { who: who(m), decide: (decision) => act(() => api("POST", `conversations/${m.q.id}/approvals/${ap.id}`, { decision })), extra: h("button", { class: "plain link small", onclick: () => go("quest", m.q.id) }, "Open the task") });
        body.querySelector(".askcardhead")?.remove();
      } else {
        const parts = readMail(m);
        body = parts[3];
        reply = parts[4] ?? null;
      }
      fill(
        node,
        h("div", { class: "inboxcardtop" }, m.bot ? keycap(m.bot, 28, "", m.bot.type) : h("span", { class: "sysavatar", "aria-hidden": "true" }, "T"), h("div", { class: "grow" }, h("span", { class: `inboxkind ${m.label}` }, waitingKind(m)), h("b", {}, title), h("span", { class: "note small" }, meta)), h("span", { class: "note small inboxwhen" }, shortWhen(m.at))),
        h("div", { class: "inboxcardbody" }, body, reply),
        h(
          "div",
          { class: "inboxcardfoot" },
          h("span", { class: "grow" }),
          // A problem with nothing left to decide can be archived.
          m.label === "failed" || m.kind === "task" ? h("button", { class: "plain link small", title: "Move it to Archive. The task and its work are kept.", onclick: put }, "Archive") : null,
          h("button", { class: "plain link small", title: approvalOf ? "Answers Don't allow, then removes this card. The task is kept." : m.q ? "Removes this card from the Inbox. The task is kept, and still shows under Tasks." : "Removes this card from the Inbox.", onclick: remove }, "Delete"),
        ),
      );
      return node;
    };
    const working = all.filter((m) => m.label === "working").sort(newest).slice(0, 5);
    fill(
      ui.mailList,
      ui.mailNote ? h("div", { class: "banner error" }, ui.mailNote) : null,
      shown.length
        ? shown.map(card)
        : [
            h("div", { class: "inboxcalm" }, h("span", { class: "inboxcalmmark", "aria-hidden": "true" }, "✓"), h("b", {}, "Nothing is waiting on you."), h("span", { class: "note" }, working.length ? `Your team is working on ${working.length === 1 ? "1 thing" : `${working.length} things`}. A number appears on Inbox when one needs your yes.` : "When an agent needs your yes, it shows here.")),
            working.length ? h("div", { class: "inboxrows calmrows" }, working.map((m) => h("button", { class: "plain inboxrow", onclick: () => ((ui.mailTab = "updates"), (ui.mailOpen = m.id), renderInbox()) }, m.bot ? keycap(m.bot, 22, "working", m.bot.type) : null, h("span", { class: "grow" }, h("b", {}, m.subject), h("span", { class: "note small" }, `${who(m)} · working`))))) : null,
          ],
    );
    ui.mailNote = null;
    fill(ui.mailRead);
    if (ui.mailJump && ui.mailOpen) ui.mailList.querySelector(".inboxcard.open")?.scrollIntoView({ block: "nearest" });
    ui.mailJump = false;
    return;
  }

  // ----- updates, done and search: a list on the left, the message on the right -----
  ui.mailJump = false;
  const wide = window.matchMedia("(min-width: 900px)").matches;
  // Nothing opens by itself: a message is read when the owner clicks it.
  const open = shown.find((m) => m.id === ui.mailOpen) ?? null;
  const row = (m) =>
    h(
      "button",
      { class: `plain inboxrow ${isUnread(m) ? "unread" : ""} ${open?.id === m.id ? "open" : ""}`, style: m.bot ? botStyle(m.bot) : "", onclick: () => openMail(m) },
      m.bot ? keycap(m.bot, 22, m.label === "working" ? "working" : "", m.bot.type) : h("span", { class: "sysavatar", "aria-hidden": "true" }, "T"),
      h("span", { class: "grow" }, h("b", {}, m.subject), h("span", { class: "note small" }, [who(m), waitsOnYou(m) ? "waiting on you" : m.label === "working" ? "working" : "", shortWhen(m.at)].filter(Boolean).join(" · "))),
    );
  const listKey = JSON.stringify([ui.mailNote, tab, words, open?.id, shown.map((m) => [m.id, m.subject, m.at, m.label, isUnread(m), agentName(m.bot)])]);
  if (listKey !== ui.mailListKey) {
    ui.mailListKey = listKey;
    const empty = words.length ? "Nothing matches that search." : tab === "updates" ? "No updates yet. When your team finishes or reports on work, it shows here." : "Nothing is archived yet. Press Archive on an update to move it here.";
    fill(ui.mailList, ui.mailNote ? h("div", { class: "banner error" }, ui.mailNote) : null, words.length ? h("p", { class: "note small" }, `${shown.length} result${shown.length === 1 ? "" : "s"} across the Inbox`) : null, shown.length ? h("div", { class: "inboxrows" }, shown.map(row)) : h("div", { class: "inboxcalm" }, h("span", { class: "note" }, empty)));
  }
  ui.mailNote = null;
  ui.inbox.classList.toggle("reading", Boolean(open && ui.mailOpen));

  // The open message is kept as it is while a reply is being typed.
  if (open && typing && ui.mailRead.dataset.id === open.id) return;
  const readKey = JSON.stringify([open?.id, open?.at, open?.label, open?.snippet, open && markOf(open), open?.q?.approvals?.length, open?.q?.activity?.name, open?.q?.chain, open && agentName(open.bot)]);
  if (readKey === ui.mailReadKey && ui.mailRead.dataset.id === (open?.id ?? "")) return;
  ui.mailReadKey = readKey;
  ui.mailRead.dataset.id = open?.id ?? "";
  if (!open) return fill(ui.mailRead, shown.length && wide ? h("div", { class: "inboxpick" }, h("b", {}, "Click a message to read it."), h("span", { class: "note small" }, ((n) => (n ? `${n} not read yet.` : "You have read them all."))(shown.filter(isUnread).length))) : null);
  const parts = readMail(open);
  const put = markOf(open).archived;
  const brief = briefingFor(open);
  fill(
    ui.mailRead,
    h(
      "div",
      { class: "inboxreadtools" },
      h("button", { class: "plain small inboxback", onclick: () => ((ui.mailOpen = null), renderInbox()) }, "← Back"),
      brief ? h("span", { class: "briefmark", title: `${brief.name}: ${brief.when}` }, "Briefing") : null,
      brief?.on?.enabled ? h("button", { class: "plain link small", title: "Stop sending it until you switch it back on, under Tasks › Automations", onclick: () => attempt(async () => (await api("PATCH", `jobs/${brief.on.job}`, { enabled: false }), toast(`${brief.name} is paused. Switch it back on under Tasks › Automations.`), await loadMail(), renderInbox())) }, "Pause") : null,
      brief?.on ? h("button", { class: "plain link small", title: "Change its answer or when it arrives", onclick: () => briefingEdit(brief).then(async (ok) => ok && (await loadMail(), renderInbox())) }, "Edit") : null,
      h("span", { class: "grow" }),
      h("button", { class: "plain link small", title: "Show it as not read yet", onclick: () => ((ui.mailOpen = null), (ui.mailReadKey = null), mailMark([open.id], { read: false })) }, "Mark unread"),
      h("button", {
        class: "small",
        title: "Delete this message. The task and its work are kept.",
        onclick: () => {
          const id = open.id;
          ui.mailOpen = null;
          mailMark([id], { deleted: true }).then(() => toast("Deleted. The task and its work are kept.", { label: "Undo", run: () => mailMark([id], { deleted: false }) }));
        },
      }, "Delete"),
      put
        ? h("button", { class: "small", title: "Move it back to Updates", onclick: () => mailMark([open.id], { archived: false }) }, "Move back")
        : h("button", { class: "small primary", title: "Move it to Archive. The task and its work are kept.", onclick: () => ((ui.mailOpen = null), mailMark([open.id], { archived: true, read: true })) }, "Archive"),
    ),
    parts.slice(1),
  );
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
              const input = h("input", { class: "renamebox", value: state.mail?.names?.[m.bot.id] ?? "", placeholder: `A name, e.g. ${defaultAgentName(m.bot.id)}`, "aria-label": "Agent's name", maxlength: "40" });
              const save = async (value) => {
                try {
                  state.mail = await api("PUT", `inbox/names/${encodeURIComponent(m.bot.id)}`, { name: value });
                } catch (err) {
                  ui.mailNote = err.message;
                }
                (document.activeElement as HTMLElement | null)?.blur();
                renderInbox();
              };
              input.addEventListener("keydown", (e) => (e.key === "Enter" ? save(input.value.trim()) : e.key === "Escape" ? showName() : null));
              fill(nameBox, input, h("button", { class: "small primary", onclick: () => save(input.value.trim()) }, "Save"), state.mail?.names?.[m.bot.id] ? h("button", { class: "plain small", title: `Back to its job title, ${agentRole(m.bot)}`, onclick: () => save("") }, "Use job title") : null);
              setTimeout(() => (input.focus(), input.select()), 0);
            },
          }, "Rename")
        : null,
    );
  showName();
  const from = h("div", { class: "readfrom", style: m.bot ? botStyle(m.bot) : "" }, m.bot ? keycap(m.bot, 44, isLive(q ?? {}) ? "working" : "", m.bot.type) : h("span", { class: "sysavatar big", "aria-hidden": "true" }, "T"), h("div", { class: "grow" }, nameBox, h("div", { class: "note small" }, `${m.bot && state.mail?.names?.[m.bot.id] ? `${agentRole(m.bot)} · ` : ""}${m.bot ? `${departmentOf(m.bot.id)} · ` : ""}to me`)), h("span", { class: "mtime" }, new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));

  const body = h("div", { class: "readbody" });
  // `done`: a line to say once it worked (it was being passed and never shown).
  const act = (fn, done?) => attempt(async () => (await fn(), await Promise.all([loadQuests(), refreshList(), loadCrew(), loadMail()]), renderInbox(), syncInboxCount(), done && toast(done)), body);
  if (m.kind === "reminder") {
    const r = m.reminder;
    const clear = (open) =>
      attempt(async () => {
        await api("PATCH", `workspace/pages/${r.id}`, { remindAt: null });
        await loadPageSuggestions();
        ui.mailOpen = null;
        syncInboxCount();
        open ? openPage(r.id) : renderInbox();
      }, body);
    fill(body, h("p", {}, `You asked to be reminded of “${r.title}” at ${when(r.remindAt)}.`), h("div", { class: "row" }, h("button", { class: "primary", onclick: () => clear(true) }, "Open it"), h("button", { onclick: () => clear(false) }, "Done")), h("p", { class: "note small" }, "Either button clears the reminder."));
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }
  if (m.kind === "rowchange") {
    const ch = m.change;
    const decide = (decision) =>
      attempt(async () => {
        await api("POST", `workspace/tables/${ch.table}/changes/${ch.id}`, { decision });
        await loadPageSuggestions();
        ui.mailOpen = null;
        renderInbox();
        syncInboxCount();
      }, body);
    fill(
      body,
      h("p", {}, `I'd like to change the table “${ch.tableName}” on the workspace page “${ch.pageTitle}”.${ch.note ? ` ${ch.note}` : ""}`),
      h("p", { class: "card" }, ch.words),
      h("p", { class: "note small" }, "The table stays as it is until you accept. To let agents change this table without asking, set its page to take agents' changes straight away."),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => decide("accept") }, "Accept"), h("button", { onclick: () => decide("decline") }, "Decline"), h("button", { class: "plain", onclick: () => openPage(ch.page) }, "Open the page")),
    );
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }
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
  if (m.kind === "digest") {
    fill(body, h("div", { class: "md" }, renderMarkdown(m.digest.text)), h("p", { class: "note small" }, "Built from your tasks as they stood when it was sent. It uses no AI model, so it costs nothing."));
    return [tools, h("h2", { class: "readsubject" }, m.subject), from, body];
  }
  if (m.kind === "checkin") {
    const row = (t) => h("li", {}, h("button", { class: "plain link", onclick: () => openTask(t.id) }, `#${t.number} ${t.title}`), h("span", { class: "note small" }, ` · ${t.owner}${t.why ? ` · ${t.why}` : ""}`));
    const part = (label, list, empty) => [h("div", { class: "label" }, label), list.length ? h("ul", { class: "checkinlist" }, list.map(row)) : h("p", { class: "note small" }, empty)];
    fill(
      body,
      h("p", {}, "What each group moved since yesterday morning, what is stuck or waiting on you, and what is next. It is built from your tasks, so it costs nothing."),
      (state.checkIn?.groups ?? []).map((g) => h("section", { class: "checkin" }, h("h3", {}, g.leadName ? `${g.leadName} · ${g.group}` : g.group), part("Moved", g.moved, "Nothing finished since yesterday."), part("Stuck or waiting on you", g.stuck, "Nothing is stuck."), part("Next", g.next, "Nothing is queued."))),
      h("p", { class: "note small" }, "Switch the daily check-in off under Settings."),
    );
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }
  if (m.kind === "need") {
    const n = m.need;
    if (n.kind === "approval") {
      const a = n.approval;
      const decide = (decision) => act(() => api("POST", `conversations/${q.id}/approvals/${a.id}`, { decision }));
      fill(body, h("p", {}, `For “${q.title}”:`), approvalAsk(a, { who: roleOf(q.bot.id)?.title || q.bot.name, bot: q.bot, decide, extra: h("button", { class: "plain link small", onclick: () => go("quest", q.id) }, "Open the task") }));
    } else if (n.kind === "plan") fill(body, planCard(q, () => act(async () => {})), h("button", { class: "plain small", onclick: () => go("quest", q.id) }, "Open the task"));
    else if (n.kind === "asking") {
      const answer = h("textarea", { rows: 4, placeholder: "Your answer. The task starts once you send it.", "aria-label": "Answer" });
      fill(
        body,
        h("div", { class: "md readreport" }, q.said ? renderMarkdown(q.said) : h("p", {}, q.note || "I need something from you before I start.")),
        answer,
        q.grant?.length ? h("div", { class: "banner" }, h("b", {}, "One press fixes this. "), `Let the ${q.bot.title || q.bot.name} ${q.grant.map((g) => g.words).join(", and ")}. `, h("button", { class: "small primary", onclick: () => act(() => api("POST", `conversations/${q.id}/grant`), "Switched on. The task has started.") }, "Allow and start")) : null,
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
    else if (n.kind === "auto") fill(body, h("p", {}, n.j.last.outcome === "skipped" ? `The automation “${n.j.name}” did not run at its time. ${n.j.last.words}` : `The automation “${n.j.name}” ran but did not work: ${n.j.last.words}`), h("p", { class: "note small" }, "The next one runs at its usual time. You can also run it now from Automations."), h("button", { class: "primary", onclick: () => ((ui.autoTab = "runs"), go("jobs")) }, "Open the run history"));
    else if (n.kind === "service") fill(body, h("p", {}, `${n.p.name} stopped working: ${n.p.problem}`), h("p", { class: "note small" }, n.p.integration ? "Agents cannot use it until it is fixed. Make a new key in the service and connect again; the account keeps its settings." : "Tasks on its models will fail, or go to a backup model if you set one, until it is fixed. A new key usually fixes it."), h("button", { class: "primary", onclick: () => ((ui.integration = n.p.integration ?? "ai-models"), go("integrations")) }, n.p.integration ? "Open the connection" : "Open AI models"));
    else if (n.kind === "total") fill(body, h("p", {}, "All your agents together have reached this month's budget. No agent starts new work until you raise it or the month turns."), h("button", { class: "primary", onclick: () => go("team") }, "Change the budget"));
    else fill(body, h("p", {}, m.snippet), h("button", { class: "primary", onclick: () => go("quest", q.id) }, n.kind === "review" ? "Review the changes" : "Open the task"));
    return [tools, h("h2", { class: "readsubject" }, m.subject, h("span", { class: `mlabel ${m.label}` }, LABEL_WORDS[m.label])), from, body];
  }

  // A task: what the agent wrote, what it is doing, what it cost.
  const live = isLive(q);
  const report = h("div", { class: "md readreport" }, q.said ? renderMarkdown(q.said) : null);
  mailFullText(q).then((text) => text && report.isConnected && fill(report, renderMarkdown(text)));
  const approvals = (q.approvals ?? []).map((a) =>
    approvalAsk(a, { who: roleOf(q.bot.id)?.title || q.bot.name, bot: q.bot, decide: (decision) => act(() => api("POST", `conversations/${q.id}/approvals/${a.id}`, { decision })) }),
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
  const reply = h("textarea", { rows: 3, placeholder: `Reply to ${state.mail?.names?.[m.bot?.id] ? agentName(m.bot).split(" ")[0] : `the ${agentName(m.bot)}`}… (they will continue the task)`, "aria-label": "Reply" }, ui.mailDraft[q.id] ?? "");
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
    leads.length ? h("optgroup", { label: "Teams (the lead shares the work out)" }, leads.map((b) => h("option", { value: `team:${b.id}` }, `${agentWho(b)}'s team`))) : null,
    h("optgroup", { label: "Agents" }, bots.map((b) => h("option", { value: b.id }, agentWho(b)))),
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
  if (!lab("org")) return null;
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
  let graphs: any[] = [];
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
/** Makes a change to the chart that Undo can take back. `onUndo` restores anything else the change affected. */
async function orgChange(label, fn, onUndo?) {
  const org = activeOrg();
  const before = chartSnapshot(org);
  await attempt(async () => {
    await fn();
    ui.orgx.undo.push({ ...before, label, onUndo });
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
    last.onUndo?.();
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
  const byId = new Map<any, any>(bots.map((b) => [b.id, b]));
  const members = org.members.filter((m) => byId.has(m.bot));
  const groups = org.groups ?? [];
  const memberOf_ = (id) => members.find((m) => m.bot === id);
  const groupOfMember = (m) => groups.find((g) => g.name === m.department);
  const live = new Map<any, any>((state.quests ?? []).filter(isLive).map((q) => [q.bot.id, q]));
  const outside = bots.filter((b) => !members.some((m) => m.bot === b.id));
  const below = (id) => {
    const out: any[] = [];
    for (let wave = members.filter((m) => m.manager === id); wave.length; wave = members.filter((m) => m.manager && wave.some((w) => w.bot === m.manager))) out.push(...wave);
    return out;
  };
  const nameOf = (id) => (id ? (memberOf_(id)?.title ?? byId.get(id)?.name ?? id) : "you");
  const set = (bot, patch, label) => orgChange(label, () => api("PUT", `orgs/${org.id}/members`, { bot, ...patch }));
  const select = (sel, { byKey = false } = {}) => {
    o.sel = o.sel && sel && o.sel.kind === sel.kind && o.sel.id === sel.id ? null : sel;
    // Opened with the keyboard, its panel takes the focus, so every change can be made without a mouse.
    o.focusPanel = byKey && Boolean(o.sel);
    renderOrg();
  };
  /** Enter or Space presses a card, a group's heading or a row of the Add list, as it would a button. */
  const press = (fn) => (e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), fn());

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
  const dropOn = (target, e?) => {
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
      { class: `poscard ${o.sel?.kind === "position" && o.sel.id === m.bot ? "on" : ""} ${leads ? "lead" : ""}`, style: `${botStyle(bot)}; margin-left: ${depth * 22}px`, role: "button", tabindex: "0", title: "Click to edit: who it reports to, a dotted line, its group. Or drag onto someone to report to them (hold Option while dropping for a dotted line).", "aria-label": `${m.title}, ${m.department}, reports to ${nameOf(m.manager)}. Press Enter to change it.`, "aria-expanded": String(o.sel?.kind === "position" && o.sel.id === m.bot), onclick: () => select({ kind: "position", id: m.bot }), onkeydown: press(() => select({ kind: "position", id: m.bot }, { byKey: true })), ...drag({ kind: "position", id: m.bot }), ...drop({ kind: "position", id: m.bot }) },
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
    const out: any[] = [];
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
        { role: "button", tabindex: "0", title: "Click to edit the group", "aria-label": `The ${g.name} group, ${inIt.length} position${inIt.length === 1 ? "" : "s"}. Press Enter to change it.`, "aria-expanded": String(o.sel?.kind === "group" && o.sel.id === g.id), onclick: () => select({ kind: "group", id: g.id }), onkeydown: press(() => select({ kind: "group", id: g.id }, { byKey: true })) },
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
          const above = new Set<any>([m.bot, ...below(m.bot).map((x) => x.bot)]);
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
    const above = new Set<any>([m.bot, ...below(m.bot).map((x) => x.bot)]);
    const g = groupOfMember(m);
    const canHand = [...below(m.bot), ...members.filter((x) => x.also === m.bot)];
    const mine = new Set<any>(canHand.map((x) => x.bot));
    const canRequest = members.filter((x) => x.bot !== m.bot && !mine.has(x.bot) && x.department !== m.department && groups.find((gg) => gg.name === x.department)?.lead === x.bot);
    // Repeating work this position does. It stays with the position when a different agent fills it.
    const routinesBox = h("div", { class: "panelrules" }, h("div", { class: "label" }, "Automations"));
    api("GET", "jobs")
      .then((all) => {
        const mine = all.filter((j) => j.owner === m.bot);
        if (!routinesBox.isConnected) return;
        routinesBox.append(
          ...(mine.length ? mine.map((j) => h("p", {}, h("b", {}, j.name), ` · ${j.plain}${j.enabled ? "" : " · paused"}`)) : [h("p", { class: "note small" }, "No repeating work yet.")]),
          h("div", { class: "row" }, h("button", { class: "plain small", onclick: () => ((ui.routineFor = m.bot), go("jobs")) }, "+ Automation"), mine.length ? h("button", { class: "plain small", onclick: () => go("jobs") }, "See all automations") : null),
        );
      })
      .catch(() => {});
    const title = h("input", { value: m.title, maxlength: 50, "aria-label": "Title" });
    const resp = h("textarea", { rows: 3, maxlength: 400, placeholder: "What this position is responsible for, in a sentence or two. The agent is told.", "aria-label": "Responsibilities" }, m.responsibilities ?? "");
    const saveText = () => {
      const patch: any = {};
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
      h("label", {}, "Dotted line: also works with", h("select", { onchange: (e) => set(m.bot, { also: e.target.value || null }, e.target.value ? `${m.title} also works with ${nameOf(e.target.value)}` : `${m.title} has no dotted line`) }, h("option", { value: "", selected: !m.also }, "Nobody"), members.filter((x) => x.bot !== m.bot && x.bot !== m.manager).map((x) => h("option", { value: x.bot, selected: x.bot === m.also }, x.title)))),
      h("p", { class: "note small" }, "A dotted line is a second working relationship, for example a marketer who also works with Sales. It changes neither who this position reports to nor its group."),
      h("div", { class: "panelrules" }, h("div", { class: "label" }, "How work moves for this position"), h("p", {}, canHand.length ? `Can hand work to: ${canHand.map((x) => x.title).join(", ")}.` : "Hands no work out: nobody is below it."), canRequest.length ? h("p", {}, `Can request work from: ${canRequest.map((x) => x.title).join(", ")}.`) : null, h("p", {}, m.manager ? `Takes decisions up to: ${nameOf(m.manager)}.` : "Takes decisions up to: you."), g?.lead === m.bot ? h("p", {}, `Leads ${g.name}: work for the group comes here first.`) : null),
      h("div", { class: "panelline" }, h("span", { class: "grow" }, "Monthly budget"), h("b", {}, bot.month?.limit != null ? `${money(bot.month.spent ?? 0)} of ${money(bot.month.limit)}` : "No limit"), h("button", { class: "plain small", onclick: () => go("bot", bot.id) }, "Change")),
      h("div", { class: "panelline" }, h("span", { class: "grow" }, "Model"), h("b", {}, bot.model ? bot.model.split("/").pop() : "Your main model"), h("button", { class: "plain small", onclick: () => go("bot", bot.id) }, "Change")),
      swap,
      routinesBox,
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
    // The group's model: the team's model, one of the backups, or one typed in. Agents with a model of their own keep it.
    const known = [...new Set<any>([state.config.model, ...(state.config.backups ?? []), g.model].filter(Boolean))];
    const groupModel = h(
      "select",
      { "aria-label": "Group's model", onchange: (e) => patch({ model: e.target.value === state.config.model ? null : e.target.value }, e.target.value === state.config.model ? `${g.name} uses the team's model` : `${g.name} uses ${e.target.value.split("/").pop()}`) },
      known.map((ref) => h("option", { value: ref, selected: (g.model ?? state.config.model) === ref }, ref === state.config.model ? `The team's model (${ref.split("/").pop()})` : ref.split("/").pop())),
    );
    const others = groups.filter((x) => x.id !== g.id);
    const moveTo = h("select", { "aria-label": "Move its positions to" }, others.map((x) => h("option", { value: x.id }, x.name)));
    return [
      h("div", { class: "panelhead" }, h("span", { class: "groupmark", "aria-hidden": "true" }, g.name.slice(0, 1).toUpperCase()), h("div", { class: "grow" }, h("b", {}, g.name), h("div", { class: "note small" }, `${inIt.length} position${inIt.length === 1 ? "" : "s"}`)), h("button", { class: "plain small", "aria-label": "Close", onclick: () => select(null) }, "✕")),
      h("label", {}, "Name", name),
      h("label", {}, "Lead", h("select", { onchange: (e) => patch({ lead: e.target.value || null }, e.target.value ? `${nameOf(e.target.value)} leads ${g.name}` : `${g.name} has no lead`) }, h("option", { value: "", selected: !g.lead }, "Nobody yet"), members.map((m) => h("option", { value: m.bot, selected: m.bot === g.lead }, `${m.title}${m.department !== g.name ? ` (moves here)` : ""}`)))),
      h("p", { class: "note small" }, g.leadChosen ? "You chose this lead." : "Picked from the chart: the position at the top of the group. Choose one to keep it."),
      h("label", {}, "Purpose", goal),
      h("label", {}, "Model for its positions", groupModel),
      h("p", { class: "note small" }, "For example, a strong model for leadership and a cheaper one for a whole department. An agent with a model of its own keeps it. Add more choices as backup models under Connections → AI models."),
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
      return m ? h("aside", { class: "orgpanel2", tabindex: "-1", "aria-label": `Change the position ${m.title}` }, positionPanel(m)) : null;
    }
    if (o.sel?.kind === "group") {
      const g = groups.find((x) => x.id === o.sel.id);
      return g ? h("aside", { class: "orgpanel2", tabindex: "-1", "aria-label": `Change the group ${g.name}` }, groupPanel(g)) : null;
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
    const item = (bot, payload, sub) => h("div", { class: "additem", style: botStyle(bot), ...drag(payload), role: "button", tabindex: "0", title: "Drag onto the chart, or click to add it reporting to you", "aria-label": `Add ${bot.name} to the chart, reporting to you`, onclick: () => ((o.drag = payload), dropOn({ kind: "you" })), onkeydown: press(() => ((o.drag = payload), dropOn({ kind: "you" }))) }, keycap(bot, 24, "", bot.type), h("span", { class: "posmain" }, h("b", {}, bot.name), h("span", { class: "possub" }, sub)));
    const teams = (state.marketTeams ?? []).filter((t) => match(`${t.name} ${t.summary}`));
    const market = (state.market ?? []).filter((b) => !byId.has(b.id) && match(`${b.name} ${b.listing.category} ${b.listing.summary}`));
    const marketById = new Map<any, any>((state.market ?? []).map((b) => [b.id, b]));
    fill(
      addList,
      outside.filter((b) => match(`${b.name} ${b.group}`)).length ? [h("div", { class: "label" }, "Your agents, not on the chart"), outside.filter((b) => match(`${b.name} ${b.group}`)).map((b) => item(b, { kind: "agent", id: b.id }, b.group))] : null,
      teams.length
        ? [
            h("div", { class: "label" }, "Ready-made teams"),
            teams.map((t) => {
              const lead = marketById.get(t.bots[0]);
              return h("div", { class: "additem team", ...drag({ kind: "team", id: t.id, lead: t.bots[0], name: t.name }), role: "button", tabindex: "0", title: "Drag onto the position it should report to, or into a group, or click to add it under you", "aria-label": `Add the ${t.name} to the chart, under you`, onclick: () => ((o.drag = { kind: "team", id: t.id, lead: t.bots[0], name: t.name }), dropOn({ kind: "you" })), onkeydown: press(() => ((o.drag = { kind: "team", id: t.id, lead: t.bots[0], name: t.name }), dropOn({ kind: "you" }))) }, lead ? keycap(lead, 24, "", lead.type) : null, h("span", { class: "posmain" }, h("b", {}, t.name), h("span", { class: "possub" }, `${t.bots.length} positions, led by ${lead?.name ?? "its lead"}`)));
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
  const suggestNow = async (mission?) => {
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
  const accept = (p) => {
    const at = o.suggest.positions.indexOf(p);
    return orgChange(
      `Added ${p.title}${p.reportsTo ? `, reporting to ${nameOf(p.reportsTo)}` : ""}`,
      async () => {
        await api("POST", `orgs/${org.id}/accept`, { bot: p.bot, group: p.group, reportsTo: p.reportsTo });
        await loadCrew();
        o.suggest.positions = o.suggest.positions.filter((x) => x !== p);
      },
      // Undoing it puts the suggestion back where it was in the list.
      () => o.suggest && !o.suggest.positions.includes(p) && o.suggest.positions.splice(Math.max(0, at), 0, p),
    );
  };
  const skip = (p) => ((o.suggest.positions = o.suggest.positions.filter((x) => x !== p)), renderOrg());
  const suggestions = () => {
    if (!o.suggestOpen || o.suggestFor !== org.id && !o.suggesting) return null;
    const sg = o.suggest;
    const market = new Map<any, any>((state.market ?? []).map((b) => [b.id, b]));
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
      h("button", { class: "plain small", title: "Every change is recorded in the activity log", onclick: () => ((ui.audit = { kind: "organization", actor: "", since: "30", q: "" }), go("audit")) }, "History"),
    ),
    // Always there, so screen readers announce each change as it is made.
    h("div", { class: o.note ? "banner" : "", role: "status", "aria-live": "polite" }, o.note ? [o.note, o.undo.length && o.noteUndoes ? h("button", { class: "plain small", onclick: () => orgUndo() }, "Undo") : null] : null),
    problems.length ? h("div", { class: "orgproblems" }, problems.map(([text, fix, fn]) => h("div", { class: "orgproblem" }, h("span", { class: "grow" }, text), h("button", { class: "small", onclick: fn }, fix)))) : null,
    o.view === "access"
      ? orgAccessPanel(org)
      : o.view === "memory"
      ? orgMemoryPanel(org, groups)
      : h(
          "div",
          { class: `orgwork ${side ? "withpanel" : ""}` },
          h("aside", { class: "addbar" }, h("div", { class: "row" }, h("b", { class: "grow" }, "Add"), h("button", { class: "small", onclick: () => newGroup() }, "+ Group")), addFind, h("p", { class: "note small" }, "Drag onto a position to report to it, onto a group to join it, or onto You. Click a position on the chart to change its reporting line or add a dotted line."), addList),
          h("div", { class: "orgcanvas" }, proposals(), suggestions(), members.length ? (o.view === "chart" ? chartView() : o.view === "list" ? listView() : groupsView()) : startPanel()),
          side,
        ),
  );
  o.note = "";
  o.noteUndoes = false;
  // Opened from the keyboard: the panel takes the focus, so its fields are the next thing reached.
  if (o.focusPanel) {
    o.focusPanel = false;
    col.querySelector(".orgpanel2")?.focus();
  }

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
      lab("org") ? philosophy : null,
      h("label", {}, "Commitments above this many dollars need your approval", limit),
      lab("org") ? h("div", { class: "label", style: "margin-top: 10px" }, "Copy an example") : null,
      !lab("org") ? null : h("p", { class: "note small" }, "Adds the example's positions you don't have yet, with its lines. Nothing you have is removed or moved. Afterwards, work follows the lines on your chart, whichever example you used: an agent hands work to the positions below it or on a dotted line to it, requests work from other groups' leads, and can ask anyone a question."),
      !lab("org") ? null : h("div", { class: "row wrap" }, exIndustry, exStructure, h("button", { class: "small", onclick: () => (dialogDone("example"), null) }, "Copy")),
      h("div", { class: "label", style: "margin-top: 10px" }, "Save or share it"),
      h("p", { class: "note small" }, "One readable file with the chart and the agents you made or edited. No keys, tasks, memory or library files."),
      h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => dialogDone("export") }, "Export this organization"), h("button", { class: "small", onclick: () => dialogDone("import") }, "Import an organization…")),
      h("div", { class: "label", style: "margin-top: 10px" }, "Other organizations"),
      h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => dialogDone("new") }, "New organization"), h("button", { class: "small danger", onclick: () => dialogDone("clear") }, "Start over (empty chart)"), state.orgs.orgs.length > 1 ? h("button", { class: "small danger", onclick: () => dialogDone("delete") }, "Delete this organization") : null),
    );
    let dialogDone;
    const choice = await new Promise<any>((resolve) => {
      dialogDone = (v) => (document.querySelector<HTMLDialogElement>("dialog.libdialog")?.close(), document.querySelector("dialog.libdialog")?.remove(), resolve(v));
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
    const byId = new Map<any, any>((state.crew?.bots ?? []).map((b) => [b.id, b]));
    const shelf = (e) => (e.shelf === "org" ? "Whole organization" : e.shelf === "dept" ? `${e.key} group` : `${byId.get(e.key)?.name ?? e.key}${e.kind === "log" ? " · past work" : " · notes"}`);
    const text = h("textarea", { rows: 2, maxlength: 800, placeholder: "Something every agent should know. For example: our fiscal year starts in April." });
    const where = h("select", { "aria-label": "Who should know this" }, h("option", { value: "org:" }, "Whole organization"), groups.map((g) => h("option", { value: `dept:${g.name}` }, `${g.name} group`)));
    const grouped = new Map<any, any>();
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
const IMAGE_TYPES = new Set<any>(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const VIDEO_TYPES = new Set<any>(["mp4", "mov", "webm"]);
const AUDIO_TYPES = new Set<any>(["mp3", "m4a", "wav", "ogg"]);
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
  return new Promise<any>((resolve) => {
    const dialog = h("dialog", { class: "needs libdialog" });
    const done = (value) => (dialog.close(), dialog.remove(), resolve(value));
    fill(dialog, h("h2", {}, title), body, h("div", { class: "row end" }, h("button", { class: "plain", onclick: () => done(null) }, "Cancel"), buttons.map(([label, value, primary]) => h("button", { class: primary ? "primary" : "", onclick: () => done(typeof value === "function" ? value() : value) }, label))));
    dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
    document.body.append(dialog);
    dialog.showModal();
  });
}

// ---------- speech to text, on this computer ----------
/** Any recording as the plain sound the speech program takes: one channel, 16,000 samples a second, 16 bits (WAV). */
async function toPlainSound(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !window.OfflineAudioContext) throw new Error("This computer or browser cannot prepare sound for writing out.");
  const ctx = new Ctx();
  let heard;
  try {
    heard = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error("That recording could not be read. Try recording it again.");
  } finally {
    ctx.close();
  }
  if (heard.duration > 1200) throw new Error("That recording is longer than twenty minutes. Write out a shorter one.");
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(heard.duration * 16000)), 16000);
  const source = off.createBufferSource();
  source.buffer = heard;
  source.connect(off.destination);
  source.start();
  const samples = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, word) => [...word].forEach((ch, i) => out.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([out], { type: "audio/wav" });
}

/** Sends plain sound to be written out and returns the server's answer. */
async function writeOut(path, sound) {
  const res = await fetch(`/api/${path}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: sound });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That could not be written out.");
  return data;
}

/**
 * Whether speech can be written out now. The first time, it explains the one download and waits for it.
 * Resolves true when ready; false when the owner cancels or this copy of Talqava cannot do it.
 */
async function speechReady() {
  let info = await api("GET", "speech");
  if (info.state === "ready") return true;
  if (info.state === "unavailable") return (toast("This copy of Talqava cannot write out speech yet: it was built without the speech program."), false);
  const pick = h("select", { id: "speech-model", "aria-label": "Speech model" }, info.models.map((m) => h("option", { value: m.id, selected: m.id === info.model }, `${m.name} · ${m.mb} MB`)));
  const about = h("span", { class: "note small" });
  const say = () => (about.textContent = info.models.find((m) => m.id === pick.value)?.about ?? "");
  pick.addEventListener("change", say);
  say();
  const body = h(
    "div",
    { class: "composeform" },
    h("p", { class: "note" }, "Talqava writes out what you say on this computer. Nothing you say is sent anywhere, and it costs nothing to use."),
    h("p", { class: "note" }, "It needs one download first: the speech model. It is kept on this computer."),
    h("label", {}, "Speech model", pick, about),
  );
  const chosen = await libDialog("Write out speech", body, [["Download", () => pick.value, true]]);
  if (!chosen) return false;
  await api("POST", "speech/model", { model: chosen });
  // The download carries on in the background; this waits for it, saying how far it is.
  const status = h("p", { class: "note", role: "status" }, "Downloading the speech model…");
  const waiting = h("dialog", { class: "needs libdialog" }, h("h2", {}, "Downloading the speech model"), status, h("p", { class: "note small" }, "You can keep using Talqava; this closes by itself when it is done."), h("div", { class: "row end" }, h("button", { class: "plain", onclick: () => waiting.close() }, "Hide")));
  document.body.append(waiting);
  waiting.showModal();
  try {
    for (;;) {
      await new Promise<any>((r) => setTimeout(r, 1000));
      info = await api("GET", "speech");
      if (info.download?.problem) throw new Error(`The speech model could not be downloaded. ${info.download.problem}`);
      if (info.state === "ready" && !info.download) return true;
      status.textContent = `Downloading the speech model… ${info.download?.percent ?? 0}%`;
    }
  } finally {
    waiting.close();
    waiting.remove();
  }
}

/**
 * A microphone button for a text box: press, speak, press again, and what was said is added to the box.
 * The words are written out on this computer.
 */
function micButton(box, cls = "") {
  const MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7";
  let recorder = null;
  const button = h("button", { type: "button", class: `plain micbutton ${cls}`, "aria-label": "Speak instead of typing", title: "Speak instead of typing. Your words are written out on this computer." });
  button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${MIC}"/></svg>`;
  const idle = () => ((recorder = null), button.classList.remove("recording", "working"), (button.disabled = false), button.setAttribute("aria-label", "Speak instead of typing"));
  const start = async () => {
    if (!(await speechReady())) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("This computer or browser cannot record sound here.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
      throw new Error("The microphone could not be used. Allow Talqava to use the microphone (on a Mac: System Settings › Privacy & Security › Microphone), then try again.");
    });
    const parts: any[] = [];
    recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
    const limit = setTimeout(() => recorder?.stop(), 300_000);
    recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    recorder.onstop = async () => {
      clearTimeout(limit);
      stream.getTracks().forEach((t) => t.stop());
      const type = (recorder?.mimeType || "audio/webm").split(";")[0];
      button.classList.remove("recording");
      button.classList.add("working");
      button.disabled = true;
      try {
        if (!parts.length) return;
        const heard = await writeOut("speech/write-out", await toPlainSound(new Blob(parts, { type })));
        if (!heard.text) return toast("No words were heard. Try again, a little closer to the microphone.");
        const at = box.selectionStart ?? box.value.length;
        const before = box.value.slice(0, at);
        box.value = `${before}${before && !/\s$/.test(before) ? " " : ""}${heard.text}${box.value.slice(box.selectionEnd ?? at)}`;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.focus();
      } catch (err) {
        toast(err.message);
      } finally {
        idle();
      }
    };
    recorder.start(1000);
    button.classList.add("recording");
    button.setAttribute("aria-label", "Stop and write out what you said");
  };
  button.addEventListener("click", () => (recorder ? recorder.state === "recording" && recorder.stop() : start().catch((err) => (idle(), toast(err.message)))));
  return button;
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
  const out: any[] = [];
  const visit = async (entry) => {
    if (entry.isFile) return new Promise<void>((resolve) => entry.file((file) => (out.push({ file, rel: entry.fullPath.replace(/^\//, "") }), resolve()), () => resolve()));
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<any>((resolve) => reader.readEntries(resolve, () => resolve([])));
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
  const bots = new Map<any, any>((state.crew?.bots ?? []).map((b) => [b.id, b]));
  const act = (fn, note) => attempt(async () => (await fn(), note && (ui.libraryNote = note), again()), col);
  ui.libPath ??= "";
  if (ui.libPath && !lib.folders.some((f) => f.path === ui.libPath)) ui.libPath = "";
  ui.libSel ??= new Set<any>();
  const cur = ui.libPath;
  const docById = new Map<any, any>(lib.documents.map((d) => [d.id, d]));
  const folderByPath = new Map<any, any>(lib.folders.map((f) => [f.path, f]));
  const keyOf = (kind, p) => `${kind}:${p}`;
  const selected = () => [...ui.libSel].map((k) => ({ kind: k.slice(0, k.indexOf(":")), path: k.slice(k.indexOf(":") + 1) })).filter((t) => (t.kind === "folder" ? folderByPath.has(t.path) : lib.documents.some((d) => d.path === t.path)));
  const itemOf = (t) => (t.kind === "folder" ? folderByPath.get(t.path) : lib.documents.find((d) => d.path === t.path));

  // ----- uploading: buttons, or dropping files and folders from the computer anywhere on the list -----
  const status = h("span", { class: "note small" });
  const upload = async (list, into = cur) => {
    list = list.filter((x) => x.file.size > 0);
    if (!list.length) return;
    const failed: any[] = [];
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
        h("label", { class: "liblevel" }, "Sensitivity", h("select", { "aria-label": "Sensitivity", onchange: (e) => act(() => api("PATCH", `library/${d.id}`, { level: e.target.value }), `Marked ${LEVEL_NAMES[e.target.value]}.`) }, Object.entries(LEVEL_NAMES).map(([v, t]) => h("option", { value: v, selected: (d.level ?? "internal") === v }, t)))),
        h("p", { class: "note small" }, "Decides which AI services may receive it (set under Security). A Restricted document is hidden from every agent not named on it."),
      ),
      h("div", { class: "pfacts" }, fact("Where", d.path.includes("/") ? libParent(d.path) : "Library"), fact("Size", sizeWords(d.size)), fact("Changed", d.modified ? new Date(d.modified).toLocaleString() : "—"), fact("Read for agents", d.readable ? `${d.passages} part${d.passages === 1 ? "" : "s"}` : "Name only"), d.problem ? h("p", { class: "note small" }, d.problem) : null),
      /^(png|jpe?g|webp|gif)$/i.test(d.type)
        ? h("div", {}, h("button", { class: "small", onclick: () => confirm(`Read the words in “${d.name}”?\n\nThe picture is sent to your team's AI model, which writes out the words it sees. They are then kept with the picture, so you and your agents can find it by them. It costs about as much as a short question.`) && act(() => api("POST", `library/${d.id}/read-picture`), (r) => (r.words ? `Done: ${r.words} words were found and can now be searched.` : "No words were found in this picture.")) }, d.readable ? "Read the words again" : "Read the words in this picture"))
        : null,
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
    ui.libFindTimer = setTimeout(() => (again(), setTimeout(() => document.querySelector<HTMLElement>(".findbox")?.focus(), 0)), 250);
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

// ---------- the activity log: every operation, by you and by each agent ----------
const AUDIT_KINDS = [["", "Everything"], ["task", "Tasks"], ["tool", "Agent actions"], ["approval", "Approvals"], ["spend", "Spending"], ["problem", "Problems"], ["library", "Library"], ["settings", "Settings"], ["integration", "Connections"], ["organization", "Organization"], ["workspace", "Workspace"], ["chat", "Chats"], ["inbox", "Inbox"]];
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
  // Whether the record still matches its seals: nothing changed, removed or added by hand.
  const sealBox = h("div", { role: "status" });
  api("GET", "audit/verify")
    .then((v) =>
      sealBox.isConnected || state.view === "audit"
        ? fill(
            sealBox,
            v.intact
              ? h("p", { class: "note small sealok" }, h("span", { class: "chip on" }, "Record intact"), ` ${v.checked.toLocaleString()} sealed entr${v.checked === 1 ? "y" : "ies"} checked just now: none changed, removed or added by hand.${v.unsealed ? ` ${v.unsealed.toLocaleString()} older entries were written before sealing began and are not covered.` : ""}`)
              : h("div", { class: "banner error" }, h("b", {}, "The audit record does not match its seals. "), `${v.problem?.why ?? ""}${v.problem?.at ? ` Near the entry of ${when(v.problem.at)}.` : ""} Someone or something changed the record outside Talqava. Entries after this point cannot be relied on.`),
          )
        : null,
    )
    .catch(() => {});
  const pick = (key, options, label) => h("select", { "aria-label": label, onchange: (e) => ((f[key] = e.target.value), again()) }, options.map(([v, t]) => h("option", { value: v, selected: v === f[key] }, t)));
  const who = pick("actor", [["", "Everyone"], ["owner", "You"], ["agents", "All agents"], ...bots.map((b) => [b.id, b.title || b.name])], "Who");
  const find = h("input", { type: "search", placeholder: "Search: a command, a file, a task…", value: f.q, "aria-label": "Search the activity log" });
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
    sealBox,
    h("div", { class: "row" }, h("div", { class: "grow" }, h("h1", {}, "Activity log"), h("p", { class: "lead" }, "Every operation, by you and by each agent: what was done, to what, whether it worked, and what it cost. Kept on this computer; keys and passwords are never written down.")), h("button", { onclick: csv, disabled: !data.entries.length }, "Export CSV")),
    h("div", { class: "auditfilters" }, find, who, pick("kind", AUDIT_KINDS, "Kind"), pick("since", AUDIT_SINCE, "When")),
    h("div", { class: "auditstats" }, [[String(data.total), `operation${data.total === 1 ? "" : "s"}`], [String(byAgent), "by agents"], [String(problems), "did not work"], [money(spent), "spent"]].map(([n, t]) => h("div", {}, h("b", {}, n), h("span", {}, t)))),
    data.entries.length ? h("div", { class: "auditlist" }, data.entries.map(row)) : h("div", { class: "card quiet" }, h("b", {}, "Nothing recorded for these filters."), h("span", { class: "note" }, " Everything you and your agents do from now on is recorded here.")),
    data.total > data.entries.length ? h("p", { class: "note small" }, `Showing the newest ${data.entries.length} of ${data.total}. Narrow the filters to see the rest; Export CSV includes up to 5,000.`) : null,
  );
}

// ---------- integrations ----------
// The outside tools agents work with, filed by category. Git is the first:
// repositories agents may work on, each task in a branch and copy of its own.
const INTEGRATION_MARKS: Record<string, string> = {
  git: `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"><path d="M17 14v20M17 24c8 0 14-1 14-8"/></g><g fill="var(--bg)" stroke="var(--accent)" stroke-width="2.2"><circle cx="17" cy="14" r="3.4"/><circle cx="17" cy="34" r="3.4"/><circle cx="31" cy="15" r="3.4"/></g></svg>`,
};
INTEGRATION_MARKS.mcp = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 24h8M26 24h8"/><rect x="20" y="18" width="8" height="12" rx="2.5" fill="var(--bg)"/><circle cx="12" cy="24" r="3" fill="var(--bg)"/><circle cx="36" cy="24" r="3" fill="var(--bg)"/><path d="M24 12v6M24 30v6"/></g></svg>`;
INTEGRATION_MARKS.openrouter = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.45"/><g fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 24h7c3 0 4-1.5 5.5-4.5S28 14 31 14h5"/><path d="M12 24h7c3 0 4 1.5 5.5 4.5S28 34 31 34h5"/><path d="M19 24h17"/><path d="M33 11l3 3-3 3M33 21l3 3-3 3M33 31l3 3-3 3"/></g><circle cx="12" cy="24" r="2.6" fill="var(--accent)"/></svg>`;
INTEGRATION_MARKS["ai-models"] = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="15" y="15" width="18" height="18" rx="3"/><path d="M20 15v-4M28 15v-4M20 37v-4M28 37v-4M15 20h-4M15 28h-4M37 20h-4M37 28h-4"/><path d="M21 24h6"/></g></svg>`;
INTEGRATION_MARKS["api-keys"] = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="24" r="6"/><path d="M24 24h13M32 24v5M36 24v4"/></g></svg>`;

// A website tile of our own (a browser window), not WordPress's logo.
INTEGRATION_MARKS.wordpress = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="11" fill="var(--accent)" fill-opacity="0.11" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="1.25"/><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="14" width="24" height="20" rx="3"/><path d="M12 20h24M16 25h10M16 29h7"/></g></svg>`;
const integrationMark = (id) => {
  const node = h("span", { class: "imark" });
  node.innerHTML = INTEGRATION_MARKS[id] ?? "";
  return node;
};
const STATE_WORDS = { connected: ["Connected", "on"], "needs-setup": ["Not set up", ""], unavailable: ["Unavailable", "bad"], coming: ["Coming", ""] };

/** What the pages under Connections share: the settings they change, saved and then shown again. */
const connectionSaver = (col, again) => (patch) =>
  attempt(async () => {
    state.config = await api("PUT", "settings", patch);
    again();
  }, col);

/** Connections › AI models: every AI service, backups, and a service set up by hand. */
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

/** Connections › API keys: keys for any other service agents call, each sent only to its own address. */
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

/** Connections › Telegram: talk to the assistant from a private Telegram chat. A bot's token, then a code to pair the owner's own chat. */
async function telegramPage(col, again) {
  const info = await api("GET", "integrations/telegram").catch(() => ({ state: "off" }));
  if (state.view !== "integrations" || ui.integration !== "telegram") return;
  const act = (fn, done?) => attempt(async () => (await fn(), done && toast(done), again()), col);
  const token = h("input", { id: "telegram-token", type: "password", autocomplete: "off", placeholder: "123456789:AA…", "aria-label": "Bot token" });
  const head = [
    h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations"),
    h("div", { class: "ihero" }, h("span", { class: "packicon conn", "aria-hidden": "true" }, "T"), h("div", { class: "grow" }, h("h1", {}, "Telegram"), h("p", { class: "lead" }, "Talk to your assistant from your phone, in a private Telegram chat."))),
    h(
      "section",
      { class: "card" },
      h("b", {}, "What to expect"),
      h(
        "ul",
        {},
        h("li", {}, "It answers one chat only: yours. Anyone else who finds the bot is told it is private, and nothing they write reaches your assistant."),
        h("li", {}, "Anything that would send, change or delete something still waits for your yes in Talqava's Inbox. You cannot approve from Telegram."),
        h("li", {}, "It answers while Talqava is running on this computer."),
        h("li", {}, "What you write passes through Telegram's servers, as in any Telegram chat. Text only for now."),
      ),
    ),
  ];
  if (info.state === "on") {
    return fill(
      col,
      ...head,
      h("div", { class: "card" }, h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", {}, "Connected"), h("div", { class: "note small" }, `Answering ${info.who ?? "you"} as @${info.bot}. In Telegram, type /new to start a fresh conversation.`), info.problem ? h("div", { class: "note small bad" }, info.problem) : null), h("button", { class: "plain danger", onclick: () => confirm("Disconnect Telegram?\n\nThe bot stops answering and its token is forgotten. Nothing in Telegram is deleted.") && act(() => api("POST", "integrations/telegram/remove"), "Telegram is disconnected.") }, "Disconnect"))),
    );
  }
  if (info.state === "pairing") {
    // Looks every three seconds for the code being typed in Telegram.
    setTimeout(() => state.view === "integrations" && ui.integration === "telegram" && document.querySelector(".tgcode") && again(), 3000);
    return fill(
      col,
      ...head,
      h(
        "div",
        { class: "card form" },
        h("b", {}, "One more step: show it is you"),
        info.code
          ? [h("ol", {}, h("li", {}, "In Telegram, open a chat with ", h("b", {}, `@${info.bot}`), " and press Start."), h("li", {}, "Type this code there:")), h("div", { class: "tgcode", "aria-label": `Code: ${info.code.split("").join(" ")}` }, info.code), h("p", { class: "note small" }, "The code works for 15 minutes. The first chat that types it becomes the only one your assistant answers. This page updates when it is done.")]
          : [h("p", { class: "note tgcode-old" }, "The code ran out."), h("div", {}, h("button", { class: "primary", onclick: () => act(() => api("POST", "integrations/telegram/code")) }, "Show a new code"))],
        info.problem ? h("p", { class: "note small bad" }, info.problem) : null,
        h("div", {}, h("button", { class: "plain danger", onclick: () => act(() => api("POST", "integrations/telegram/remove"), "Cancelled.") }, "Cancel and forget the bot")),
      ),
    );
  }
  fill(
    col,
    ...head,
    h(
      "form",
      { class: "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", "integrations/telegram/connect", { token: token.value }))) },
      h("b", {}, "Connect a bot"),
      h("ol", {}, h("li", {}, "In Telegram, open a chat with ", h("b", {}, "@BotFather"), " (the one with the blue tick) and send ", h("code", {}, "/newbot"), "."), h("li", {}, "Give it a name, then a username ending in “bot”, such as mybakery_assistant_bot."), h("li", {}, "BotFather answers with a token: a line of digits, a colon, then letters. Copy it and paste it below.")),
      h("label", {}, "Bot token", token),
      h("p", { class: "note small" }, "The token stays on this computer and is sent only to Telegram. Telegram offers no sign-in page for bots, which is why this one connection uses a pasted token."),
      h("div", {}, h("button", { class: "primary" }, "Check and connect")),
    ),
  );
}

/** Connections › any service built on the connector kit: what agents can do, connect an account, set the rule. One page for all. */
async function servicePage(col, again, id) {
  const back = h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations");
  let d, svc;
  try {
    d = await api("GET", "integrations/services");
    svc = d.services.find((x) => x.id === id);
    if (!svc) throw new Error("There is no such service.");
  } catch (err) {
    return fill(col, back, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "integrations" || ui.integration !== `service:${id}`) return;
  const act = (fn, done) => attempt(async () => ((r) => (done && toast(typeof done === "function" ? done(r) : done), again()))(await fn()), col);
  const KINDS = [
    ["read", "Can read"],
    ["write", "Can change"],
    ["destructive", "Can delete (always asks you first)"],
  ];
  const allows = h(
    "div",
    { class: "card form" },
    h("b", {}, "What agents can do"),
    KINDS.filter(([k]) => svc.actions.some((a) => a.kind === k)).map(([k, words]) => h("div", {}, h("div", { class: "label" }, words), h("ul", {}, svc.actions.filter((a) => a.kind === k).map((a) => h("li", {}, a.summary))))),
    h("p", { class: "note small" }, "Only agents with the “connected services” power can use it. You choose below whether they only read, ask before each change, or change things without asking."),
  );
  const org = activeOrg();
  const patch = (c, change, done = "Saved.") => act(() => api("PATCH", `integrations/services/connections/${c.id}`, change), done);
  // Which agents may use the account: everyone with the power, or only the ones ticked.
  const whoMay = (c) => {
    if (!org?.members?.length) return null;
    const chosen = new Set<any>(c.agents ?? []);
    const boxes = org.members.map((m) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: chosen.has(m.bot), onchange: (e) => (e.target.checked ? chosen.add(m.bot) : chosen.delete(m.bot), patch(c, { agents: [...chosen] })) }), " ", m.title));
    return h("details", { class: "onthis", open: chosen.size > 0 }, h("summary", {}, h("b", {}, "Which agents may use it"), h("span", { class: "note small" }, chosen.size ? `${chosen.size} chosen` : "Every agent with the “connected services” power")), h("div", { class: "body" }, h("p", { class: "note small" }, "Tick agents to limit this account to them. With none ticked, every agent with the power may use it."), h("div", { class: "checks" }, boxes)));
  };
  // Single actions the owner can switch off for the account.
  const actionSwitches = (c) => {
    const off = new Set<any>(c.off ?? []);
    const boxes = svc.actions.map((a) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !off.has(a.name), onchange: (e) => (e.target.checked ? off.delete(a.name) : off.add(a.name), patch(c, { off: [...off] })) }), " ", a.summary));
    return h("details", { class: "onthis", open: off.size > 0 }, h("summary", {}, h("b", {}, "Which actions are on"), h("span", { class: "note small" }, off.size ? `${off.size} switched off` : "All of them")), h("div", { class: "body" }, h("div", { class: "checks" }, boxes)));
  };
  // Events: when something happens on the account, an agent gets a task.
  const eventsBox = (c) => {
    if (!svc.triggers.length) return null;
    const mine = svc.watches.filter((w) => w.connection === c.id);
    const name = (bot) => org?.members?.find((m) => m.bot === bot)?.title ?? "an agent no longer on the chart";
    const rows = mine.map((w) => {
      const t = svc.triggers.find((x) => x.name === w.trigger);
      return h(
        "div",
        { class: "reviewline" },
        h("div", { class: "grow" }, h("b", {}, `${t?.summary ?? w.trigger}${w.param ? ` (${w.param})` : ""}`), h("div", { class: "note small" }, `${name(w.bot)}: ${w.instructions}`), w.last?.problem ? h("div", { class: "note small bad" }, `Last look failed: ${w.last.problem}`) : w.last ? h("div", { class: "note small" }, `Last looked ${new Date(w.last.at).toLocaleString()}`) : null),
        h("button", { class: "small", onclick: () => act(() => api("PATCH", `integrations/services/watches/${w.id}`, { on: !w.on }), w.on ? "Paused." : "Watching again.") }, w.on ? "Pause" : "Resume"),
        h("button", { class: "small danger", onclick: () => confirm("Stop starting tasks for this?") && act(() => api("DELETE", `integrations/services/watches/${w.id}`), "Removed.") }, "Remove"),
      );
    });
    if (!org?.members?.length) return h("details", { class: "onthis" }, h("summary", {}, h("b", {}, "When something happens")), h("div", { class: "body" }, h("p", { class: "note small" }, "Add agents under Organization to have one handle new orders, emails or answers as they arrive.")));
    const trig = h("select", { "aria-label": "Event" }, svc.triggers.map((t) => h("option", { value: t.name }, t.summary)));
    const param = h("input", { "aria-label": "Which one" });
    const paramRow = h("label", {}, "", param);
    const showParam = () => {
      const t = svc.triggers.find((x) => x.name === trig.value);
      paramRow.hidden = !t?.param;
      paramRow.firstChild.textContent = t?.param?.label ?? "";
      param.placeholder = t?.param?.placeholder ?? "";
    };
    trig.addEventListener("change", showParam);
    showParam();
    const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
    const what = h("textarea", { rows: 2, placeholder: "What the agent should do each time, e.g. Check the order is complete, add it to the Orders sheet, and draft a thank-you email.", "aria-label": "What the agent should do" });
    return h(
      "details",
      { class: "onthis", open: mine.length > 0 },
      h("summary", {}, h("b", {}, "When something happens"), h("span", { class: "note small" }, mine.length ? `${mine.length} set up` : "Start a task when something new arrives")),
      h(
        "div",
        { class: "body" },
        rows,
        h(
          "form",
          { class: "form", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", "integrations/services/watches", { connection: c.id, trigger: trig.value, param: param.value, bot: who.value, instructions: what.value }), "Set up. Talqava looks every five minutes; only things that happen from now on start a task.")) },
          h("div", { class: "row wrap" }, h("span", {}, "When"), trig, h("span", {}, "give a task to"), who),
          paramRow,
          what,
          h("p", { class: "note small" }, "Each task costs what the AI model charges, and at most five start at a time. What the service sends is treated as information, never as instructions to the agent."),
          h("div", {}, h("button", { class: "primary" }, "Start watching")),
        ),
      ),
    );
  };
  const card = (c) => {
    const rule = h(
      "select",
      { "aria-label": "What agents may do", onchange: (e) => (e.target.value !== "auto" || confirm(`Let agents change things in ${svc.name} (${c.label}) without asking?\n\nChanges happen straight away in your real account. Choose this only when you trust the work and check it regularly.`) ? act(() => api("PATCH", `integrations/services/connections/${c.id}`, { rule: e.target.value }), "Saved.") : again()) },
      d.rules.map((r) => h("option", { value: r.id, selected: r.id === c.rule }, r.words)),
    );
    return h(
      "div",
      { class: "card form" },
      h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, c.label), h("div", { class: "note small" }, `Connected ${new Date(c.addedAt).toLocaleDateString()}`)), h("span", { class: `chip ${c.problem ? "bad" : "on"}` }, c.problem ? "Needs attention" : "Connected")),
      c.problem ? h("div", { class: "banner error" }, `${c.problem} ${svc.browser ? `Sign in to ${svc.name} again below` : "Make a new key and connect again below"}; the account keeps its settings.`) : null,
      h("label", {}, "What agents may do with this account", rule),
      whoMay(c),
      actionSwitches(c),
      eventsBox(c),
      h("p", { class: "note small" }, c.checkedAt ? `Last checked ${new Date(c.checkedAt).toLocaleString()}. Talqava checks every few hours that the key still works. ` : "", h("button", { type: "button", class: "plain link", onclick: () => act(() => api("POST", "integrations/services/check"), "Checked.") }, "Check now")),
      h("div", { class: "row" }, h("button", { class: "plain danger", onclick: () => confirm(`Disconnect ${svc.name} (${c.label})? Agents can no longer use it, and its key is forgotten. Nothing in ${svc.name} is changed.`) && act(() => api("DELETE", `integrations/services/connections/${c.id}`), "Disconnected.") }, "Disconnect")),
    );
  };
  const inputs = svc.fields.map((f) => ({ f, node: h("input", { type: f.secret ? "password" : "text", autocomplete: "off", placeholder: f.placeholder ?? f.label, "aria-label": f.label }) }));
  const values = () => Object.fromEntries(inputs.map((x) => [x.f.key, x.node.value]));
  // A service that signs in through the browser: the owner registers their own app once, then approves in the browser.
  const browserForm = () => {
    const idLabel = svc.browser.idLabel;
    const asks = svc.browser.ask.map((f) => ({ f, node: h("input", { autocomplete: "off", placeholder: f.placeholder ?? f.label, "aria-label": f.label }) }));
    const askRows = asks.map((x) => h("label", {}, x.f.label, x.node, x.f.help ? h("span", { class: "note small" }, x.f.help) : null));
    const oneClick = svc.browser.oneClick;
    const clientId = h("input", { autocomplete: "off", placeholder: idLabel, "aria-label": idLabel, value: ui.signIn?.id === id ? ui.signIn.clientId : "" });
    const clientSecret = h("input", { type: "password", autocomplete: "off", placeholder: svc.browser.secret === "optional" ? "Client secret (if your app has one)" : "Client secret", "aria-label": "Client secret" });
    const status = h("p", { class: "note", role: "status" }, ui.signIn?.id === id ? `Waiting for you to approve in the browser… This page updates when ${svc.name} is connected.` : "");
    const start = async () => {
      const { url } = await api("POST", `integrations/services/${svc.id}/sign-in`, { clientId: clientId.value, clientSecret: clientSecret.value, values: Object.fromEntries(asks.map((x) => [x.f.key, x.node.value])) });
      window.open(url, "_blank", "noopener");
      ui.signIn = { id, clientId: clientId.value, had: svc.connections.length, since: Date.now() };
      again();
    };
    return h(
      "form",
      { class: "card form", onsubmit: (e) => (e.preventDefault(), attempt(start, col)) },
      h("b", {}, svc.connections.length ? "Connect another account" : `Connect ${svc.name}`),
      oneClick
        ? [
            h("p", { class: "note small" }, `Press the button, sign in to ${svc.name} in your browser and approve. Nothing to copy or paste.`),
            svc.browser.viaTalqava ? h("p", { class: "note small" }, `The sign-in passes through Talqava's website (auth.talqava.com), which completes it with ${svc.name}. It keeps nothing: your sign-in is stored only on this computer.`) : null,
            askRows,
          ]
        : [
            h("p", { class: "note small" }, `${svc.name} signs in through your browser. It asks for an app registered with ${svc.name}; you register your own once, which takes about ten minutes, and it stays yours.`),
            h("ol", {}, svc.browser.appSteps.map((step) => h("li", {}, step.split(/(\{redirect\}|\{origin\})/).map((part) => (part === "{redirect}" ? h("code", {}, d.redirect) : part === "{origin}" ? h("code", {}, new URL(d.redirect).origin) : part))))),
            askRows,
            h("label", {}, idLabel, clientId),
            svc.browser.secret === "never" ? null : h("label", {}, "Client secret", clientSecret),
          ],
      status,
      h("p", { class: "note small" }, `Your app's details and the sign-in stay on this computer and are sent only to ${svc.name}. `, h("button", { type: "button", class: "plain link", onclick: () => window.open(svc.docs, "_blank", "noopener") }, `${svc.name}'s instructions`)),
      h("div", {}, h("button", { class: "primary" }, ui.signIn?.id === id ? "Open the sign-in again" : `Sign in to ${svc.name}`)),
    );
  };
  // While a sign-in is under way, look every two seconds for the new connection, for up to five minutes.
  if (ui.signIn?.id === id) {
    if (svc.connections.length > ui.signIn.had) (toast(`${svc.name} is connected.`), (ui.signIn = null));
    else if (Date.now() - ui.signIn.since > 300_000) ui.signIn = null;
    else setTimeout(() => state.view === "integrations" && ui.integration === `service:${id}` && ui.signIn?.id === id && again(), 2000);
  }
  fill(
    col,
    back,
    h("div", { class: "ihero" }, h("span", { class: "packicon conn big", "aria-hidden": "true" }, svc.name[0].toUpperCase()), h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, svc.name), h("span", { class: `chip ${svc.connections.length ? "on" : ""}` }, svc.connections.length ? "Connected" : "Not connected")), h("p", { class: "lead" }, svc.about))),
    allows,
    svc.connections.map(card),
    svc.browser ? browserForm() : null,
    !svc.fields.length ? null : ((form) => (svc.browser ? h("details", { class: "card form" }, h("summary", {}, "Use a key instead"), form) : form))(h(
      "form",
      { class: svc.browser ? "form" : "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", `integrations/services/${svc.id}/connect`, { values: values() }), (c) => `${svc.name} is connected (${c.label}). Agents ask before each change until you choose otherwise.`)) },
      svc.browser ? null : h("b", {}, svc.connections.length ? "Connect another account" : `Connect ${svc.name}`),
      h("ol", {}, svc.steps.map((step) => h("li", {}, step))),
      inputs.map((x) => h("label", {}, x.f.label, x.node, x.f.help ? h("span", { class: "note small" }, x.f.help) : null)),
      h("p", { class: "note small" }, `Talqava checks it with ${svc.name} before saving. It is kept on this computer and sent only to ${svc.name}. `, h("button", { type: "button", class: "plain link", onclick: () => window.open(svc.docs, "_blank", "noopener") }, `${svc.name}'s instructions`)),
      h("div", {}, h("button", { class: "primary" }, "Check and connect")),
    )),
  );
}

/** Connections › WordPress: connect a site, choose what agents may do there, and set up a blog post that writes itself. */
async function wordpressPage(col, again) {
  const back = h("button", { class: "plain back", onclick: () => ((ui.integration = null), again()) }, "← All integrations");
  let d;
  try {
    d = await api("GET", "integrations/wordpress");
  } catch (err) {
    return fill(col, back, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "integrations" || ui.integration !== "wordpress") return;
  const org = activeOrg();
  const act = (fn, done) => attempt(async () => ((r) => (done && toast(typeof done === "function" ? done(r) : done), again()))(await fn()), col);
  const url = h("input", { type: "url", placeholder: "Your site's address, e.g. https://example.com", "aria-label": "Site address" });
  const user = h("input", { placeholder: "Your WordPress user name", autocomplete: "off", "aria-label": "WordPress user name" });
  const pass = h("input", { type: "password", autocomplete: "off", placeholder: "Application password (looks like abcd efgh ijkl mnop qrst uvwx)", "aria-label": "Application password" });
  const siteCard = (site) => {
    const posts = h("div", { class: "wstasks" }, h("p", { class: "note small" }, "Loading recent posts…"));
    api("GET", `integrations/wordpress/${site.id}/posts`)
      .then((list) => fill(posts, list.length ? list.map((p) => h("div", { class: "row wppost" }, h("span", { class: "grow" }, p.title), h("span", { class: `chip ${p.status === "publish" ? "on" : ""}` }, p.status === "publish" ? "Public" : p.status === "future" ? "Scheduled" : "Draft"), h("a", { class: "note small", href: p.link, target: "_blank", rel: "noopener" }, "Open"))) : h("p", { class: "note small" }, "No posts yet.")))
      .catch((err) => fill(posts, h("p", { class: "note small bad" }, err.message)));
    const rule = h("select", { "aria-label": "What agents may do", onchange: (e) => (e.target.value !== "auto" || confirm(`Let agents publish on ${site.name} without asking?\n\nWhatever an agent writes goes live on your website straight away. Choose this only when you trust the automation and check the site regularly.`) ? act(() => api("PATCH", `integrations/wordpress/${site.id}`, { publish: e.target.value }), "Saved.") : again()) }, d.rules.map((r) => h("option", { value: r.id, selected: site.publish === r.id }, r.words)));
    const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
    const about = h("textarea", { rows: 2, placeholder: "What your blog is about and what to write on, e.g. Practical baking tips for home bakers; one recipe idea or technique each day.", "aria-label": "What the blog is about" });
    const hour = h("select", { "aria-label": "Time" }, [6, 7, 8, 9, 10, 12, 15, 18].map((n) => h("option", { value: n, selected: n === 9 }, `${n > 12 ? n - 12 : n}:00 ${n >= 12 ? "pm" : "am"}`)));
    const days = h("select", { "aria-label": "Days" }, h("option", { value: "every" }, "Every day"), h("option", { value: "weekdays" }, "Monday to Friday"));
    return h(
      "div",
      { class: "card form" },
      h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, site.name), h("div", { class: "note small" }, `${site.url.replace(/^https?:\/\//, "")} · signed in as ${site.user}${site.via === "xmlrpc" ? " · connected through WordPress's older entrance, because the web host drops the usual sign-in" : ""}`)), h("span", { class: "chip on" }, "Connected")),
      h("label", {}, "What agents may do on this site", rule),
      h("p", { class: "note small" }, "With drafts only, nothing an agent writes is public until you publish it in WordPress. Agents never delete posts or pages, and WordPress keeps earlier versions under Revisions."),
      h("div", { class: "label" }, "Recent posts"),
      posts,
      org.members.length
        ? h(
            "form",
            { class: "form wpdaily", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", `integrations/wordpress/${site.id}/daily`, { owner: who.value, about: about.value, hour: Number(hour.value), days: days.value }), "The automation is set up. You can change or pause it under Automations.")) },
            h("b", {}, "Have an agent write a blog post on a schedule"),
            about,
            h("div", { class: "row wrap" }, who, days, hour, h("button", { class: "primary" }, "Set up the automation")),
            h("p", { class: "note small" }, site.publish === "drafts" ? "Each post is saved as a draft for you to read and publish. Each run costs what the AI model charges; see it under Automations." : site.publish === "ask" ? "Each post waits for your approval before it goes public." : "Each post is published without asking."),
          )
        : h("p", { class: "note small" }, "Add agents under Organization to have one write posts on a schedule."),
      h("div", { class: "row" }, h("button", { class: "plain danger", onclick: () => confirm(`Disconnect ${site.name}? Agents can no longer read or write it. Nothing on the site is changed.`) && act(() => api("DELETE", `integrations/wordpress/${site.id}`), "Disconnected.") }, "Disconnect")),
    );
  };
  fill(
    col,
    back,
    h("div", { class: "ihero" }, integrationMark("wordpress"), h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, "WordPress"), h("span", { class: `chip ${d.sites.length ? "on" : ""}` }, d.sites.length ? "Connected" : "Not connected")), h("p", { class: "lead" }, "Let your agents write blog posts and update the pages of your WordPress website. You decide whether they only write drafts, ask before publishing, or publish by themselves."))),
    d.sites.map(siteCard),
    h(
      "form",
      { class: "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("POST", "integrations/wordpress/connect", { url: url.value, user: user.value, password: pass.value }), (s) => `${s.name} is connected. Agents write drafts only until you change that.`)) },
      h("b", {}, d.sites.length ? "Connect another site" : "Connect your site"),
      h("ol", {}, h("li", {}, "Sign in to your WordPress site and open ", h("b", {}, "Users › Profile"), "."), h("li", {}, "Scroll to ", h("b", {}, "Application Passwords"), ", type the name Talqava and press ", h("b", {}, "Add New Application Password"), "."), h("li", {}, "Copy the password it shows and paste it below. It is not your normal password, works only for this, and you can revoke it in WordPress at any time.")),
      url,
      user,
      pass,
      h("p", { class: "note small" }, "Talqava checks it with your site before saving. It is kept on this computer and sent only to your site. Use an account with the Author or Editor role: that limits what an agent could ever do."),
      h("div", {}, h("button", { class: "primary" }, "Check and connect")),
    ),
    h("p", { class: "note small" }, "Agents with the “connected services” power can use a connected site. To give work by hand, ask in a task: “Write a post about … for our blog” or “Update the Opening hours page on our website”."),
  );
}

/** Under Connections › MCP: connectors added by hand, including ones that run as a program on this computer. */
function connectorsByHand(col, again) {
  const c = state.config;
  const save = connectionSaver(col, again);
  const mName = h("input", { placeholder: "Name, e.g. crm" });
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
    // What has stopped working, for the line at the top of the list.
    state.serviceProblems = await api("GET", "gateway/problems").catch(() => state.serviceProblems ?? []);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "integrations") return;
  const act = (fn) => attempt(async () => (await fn(), (state.config = await api("GET", "state")), renderTop(), again()), col);

  if (ui.integration === "git" && git) return fill(col, ...gitIntegrationPage(git, act, col, again));
  if (ui.integration === "ai-models") return aiModelsPage(col, again);
  if (ui.integration === "api-keys") return apiKeysPage(col, again);
  if (ui.integration === "wordpress") return wordpressPage(col, again);
  if (ui.integration === "telegram") return telegramPage(col, again);
  if (ui.integration?.startsWith("service:")) return servicePage(col, again, ui.integration.slice(8));
  if (ui.integration === "mcp" && git) return (fill(col, ...mcpIntegrationPage(git, act, col, again)), connectorsByHand(col, again));
  if (ui.integration === "openrouter" && git) {
    if (ui.orWaiting && !git.connected) waitForSignIn();
    return fill(col, ...openrouterIntegrationPage(git, act, col, again));
  }

  // One directory: every service, connected, available or coming, filed under plain categories, with a search box.
  // Git repositories are set aside unless switched on under Labs, or already in use.
  const all = list.integrations.filter((i) => i.id !== "git" || lab("git") || i.state === "connected");
  const count = (state) => all.filter((i) => (state === "available" ? i.state === "needs-setup" || i.state === "unavailable" : i.state === state)).length;
  const SHOW = [
    ["all", `All (${all.length - count("coming")})`],
    ["connected", `Connected (${count("connected")})`],
    ["coming", `Planned, not built yet (${count("coming")})`],
  ];
  const open = async (i) => {
    if (i.state === "coming") return;
    (ui.integration = i.id), again();
  };
  const order = { connected: 0, "needs-setup": 1, unavailable: 1, coming: 2 };
  const cards = all
    .slice()
    .sort((x, y) => order[x.state] - order[y.state])
    .map((i) => {
      const mark = INTEGRATION_MARKS[i.id] ? integrationMark(i.id) : h("span", { class: "packicon conn", "aria-hidden": "true" }, i.name[0].toUpperCase());
      const inside = [h("div", { class: "ihead" }, mark, h("div", { class: "grow" }, h("b", {}, i.name), h("div", { class: "by" }, i.status)), h("span", { class: `chip ${STATE_WORDS[i.state][1]}` }, STATE_WORDS[i.state][0])), h("p", { class: "mdesc" }, i.summary)];
      const node = i.state === "coming" ? h("article", { class: "icard coming" }, ...inside) : h("button", { class: "icard", onclick: () => attempt(() => open(i), col) }, ...inside, h("span", { class: "ilink" }, i.state === "connected" ? "Manage →" : i.connector ? "See what it can do →" : "Set up →"));
      return { i, node, words: `${i.name} ${i.summary} ${i.category}`.toLowerCase() };
    });
  const sections = list.categories.map((c) => ({ c, mine: cards.filter((x) => x.i.category === c), node: null })).filter((x) => x.mine.length);
  for (const sec of sections) sec.node = h("section", { class: "icat" }, h("h2", {}, sec.c), h("div", { class: "igrid" }, sec.mine.map((x) => x.node)));
  const none = h("p", { class: "note", role: "status", hidden: true }, "Nothing matches. Any service that offers a connector (an MCP server) can be added by hand under Connectors and AI apps.");
  const search = h("input", { type: "search", class: "isearch", placeholder: "Search for a service, such as Asana or email", "aria-label": "Search integrations", value: ui.integrationSearch ?? "" });
  const showPills = h("div", { class: "pills", role: "group", "aria-label": "Show" });
  // The kinds of service are one menu beside the search box; the list below is already set out under the same headings.
  const catPick = h("select", { class: "icatpick", "aria-label": "Kind of service" });
  catPick.addEventListener("change", () => ((ui.integrationCategory = catPick.value), apply()));
  const apply = () => {
    const q = (ui.integrationSearch ?? "").trim().toLowerCase();
    const show = ui.integrationShow ?? "all";
    const cat = ui.integrationCategory ?? "All";
    const fits = (x) => (!q || q.split(/\s+/).every((w) => x.words.includes(w))) && (show === "all" ? Boolean(q) || x.i.state !== "coming" : (show === "available" ? x.i.state === "needs-setup" || x.i.state === "unavailable" : x.i.state === show));
    let any = false;
    for (const sec of sections) {
      let seen = false;
      for (const x of sec.mine) {
        const on = fits(x) && (cat === "All" || sec.c === cat);
        x.node.hidden = !on;
        seen = seen || on;
      }
      sec.node.hidden = !seen;
      any = any || seen;
    }
    none.hidden = any;
    fill(showPills, SHOW.map(([id, words]) => h("button", { class: `mpill ${id === show ? "on" : ""}`, "aria-pressed": String(id === show), onclick: () => ((ui.integrationShow = id), apply()) }, words)));
    fill(catPick, ["All", ...sections.map((x) => x.c)].map((c) => h("option", { value: c, selected: c === cat }, c === "All" ? "Every kind" : c)));
  };
  search.addEventListener("input", () => ((ui.integrationSearch = search.value), apply()));
  if (ui.integrationCategory && !sections.some((x) => x.c === ui.integrationCategory)) ui.integrationCategory = "All";
  if (ui.integrationShow === "available") ui.integrationShow = "all";
  fill(
    col,
    h("div", {}, h("h1", {}, "Connections"), h("p", { class: "lead" }, "Connect the tools your business already uses, so your agents can work where the work is. Each integration says exactly what agents can and cannot do with it.")),
    // Anything that has stopped working is said first, with the way to put it right.
    (state.serviceProblems ?? []).length
      ? h("div", { class: "banner error brokenlist", role: "alert" }, h("b", {}, (state.serviceProblems ?? []).length === 1 ? "One connection has stopped working." : `${state.serviceProblems.length} connections have stopped working.`), (state.serviceProblems ?? []).map((p) => h("div", { class: "row" }, h("span", { class: "grow" }, `${p.name}: ${p.problem}`), p.integration ? h("button", { class: "small", onclick: () => ((ui.integration = p.integration), again()) }, "Put it right") : null)))
      : null,
    h("div", { class: "row ifind" }, search, catPick),
    showPills,
    none,
    ...sections.map((x) => x.node),
    h("p", { class: "note" }, "Planned services that are not built yet are listed under “Planned, not built yet”, and show up when you search for them. Any service that offers a connector (an MCP server) can already be added under ", h("button", { class: "plain link", onclick: () => ((ui.integration = "mcp"), again()) }, "Connectors and AI apps"), "."),
  );
  apply();
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
          h("div", { class: "willbox will" }, h("div", { class: "label" }, "✓ With OpenRouter"), h("ul", {}, ...["Run your agents on models from Anthropic, OpenAI, Google, Meta, DeepSeek, Mistral, Qwen and more", "Give one agent a different model from the rest, such as a cheaper one for automation work", "See every model's price before you choose, and the real cost of each task on its receipt"].map((x) => h("li", {}, x)))),
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
  const suggested = new Map<any, any>(or.suggested.map((s) => [s.id, s.why]));
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
    const by = { cheap: (x, y) => taskCost(x.prices) - taskCost(y.prices), name: (x, y) => x.name.localeCompare(y.name), context: (x, y) => y.contextTokens - x.contextTokens, suggested: (x, y) => (Number(suggested.has(y.id)) - Number(suggested.has(x.id))) || (x.id === or.using ? -1 : y.id === or.using ? 1 : 0) || x.name.localeCompare(y.name) };
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
          : h("div", {}, h("b", {}, `Your team uses ${state.config?.model?.startsWith("anthropic/") ? "Claude, through your Anthropic key" : state.config?.model || "the model set under AI models"}`), h("p", { class: "note" }, "Choose a model below to run your team on OpenRouter instead. You can switch back at any time under Connections → AI models.")),
        h("p", { class: "note small" }, "To give one agent its own model, open that agent, and under Model choose OpenRouter and the model. Cheaper models suit automation work; stronger ones suit managers and complex tasks."),
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
  const name = h("input", { placeholder: "A short name, e.g. crm", "aria-label": "Connector name" });
  const address = h("input", { placeholder: "Its web address, e.g. https://mcp.example.com/mcp", "aria-label": "Connector address" });
  const token = h("input", { type: "password", placeholder: "Access token (only if it needs one)", autocomplete: "off", "aria-label": "Access token" });
  return [
    back,
    h("div", { class: "ihero" }, integrationMark("mcp"), h("div", { class: "grow" }, h("div", { class: "row" }, h("h1", {}, "Connectors and AI apps"), h("span", { class: `chip ${STATE_WORDS[mcp.state][1]}` }, STATE_WORDS[mcp.state][0])), h("p", { class: "lead" }, mcp.summary))),
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
    ui.gitPick ??= new Set<any>();
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
  const loadAccount = async (account?) => {
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
      step(hasRepo, "3. Give an agent a task on it", h("p", { class: "note" }, "Choose the repository at the top of the Agents page and assign a task. You review every change before it is kept.")),
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
      h("p", { class: "note" }, "To use it: connect a repository, choose it in the Repository box at the top of the Agents page, then assign a task. When the task stops, its page shows the changes with Keep the changes and Undo."),
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
  const crew = new Map<any, any>((state.market ?? []).map((b) => [b.id, b]));
  return new Promise<any>((resolve) => {
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

/** Before a company template or playbook is installed: exactly what it adds. Installing can be undone. */
async function kitPreview(k) {
  let p;
  try {
    p = await api("GET", `marketplace/kits/${k.id}/preview`);
  } catch (err) {
    return toast(err.message);
  }
  const dialog = h("dialog", { class: "aidialog" });
  const close = () => (dialog.close(), dialog.remove());
  const status = h("p", { class: "note", role: "status" });
  const add = h("button", { class: "primary" }, "Install");
  add.addEventListener("click", async () => {
    add.disabled = true;
    status.textContent = "Installing…";
    try {
      await api("POST", `marketplace/kits/${k.id}/install`);
      state.market = null;
      await Promise.all([loadCrew(), loadOrgs()]);
      close();
      toast(`${k.name} is installed.`, { label: "Undo", run: async () => (await api("POST", `marketplace/kits/${k.id}/undo`), (state.market = null), await Promise.all([loadCrew(), loadOrgs()]), go("market")) });
      go(k.kind === "company" ? "team" : "market");
    } catch (err) {
      status.textContent = err.message;
      status.className = "note bad";
      add.disabled = false;
    }
  });
  const few = (list, n = 8) => (list.length > n ? `${list.slice(0, n).join(", ")} and ${list.length - n} more` : list.join(", "));
  fill(
    dialog,
    h("h3", {}, `${k.icon} ${k.name}`),
    h("p", { class: "note" }, k.summary),
    h("div", { class: "label" }, "What installing it does"),
    h(
      "ul",
      {},
      k.kind === "company" ? h("li", {}, p.positions.length ? `Adds ${p.positions.length} position${p.positions.length === 1 ? "" : "s"} to your chart: ${few(p.positions)}. Nothing you have is removed or moved.` : "Adds no positions: your chart already has them all.") : null,
      p.packs.length ? h("li", {}, `Adds page packs to your Workspace: ${p.packs.map((x) => `${x.name} (${x.already ? "you already have it" : `${x.pages} pages`})`).join(", ")}.`) : null,
      p.page ? h("li", {}, `Adds the page “${p.page}” to your Workspace: the procedure your agents follow.`) : null,
      p.routines.length ? h("li", {}, `Adds ${p.routines.length} automation${p.routines.length === 1 ? "" : "s"}, paused: ${p.routines.map((r) => `${r.name} (${r.owner ? `the ${r.owner}` : `the lead of ${r.group}`})`).join(", ")}. An automation costs money each time it runs, so you switch each one on under Automations.`) : null,
      p.run ? h("li", {}, p.run.owner ? `Run it now gives the work to the ${p.run.owner}, who sends you a plan to approve first.` : `Run it now needs a ${p.run.groups[0]} group with a lead on your chart. Add one, or install a company template, before running it.`) : null,
      h("li", {}, `Nothing is spent by installing. Undo takes it all back: ${k.kind === "company" ? "your chart as it was, " : ""}its pages to Deleted, its automations removed.`),
    ),
    status,
    h("div", { class: "row" }, add, h("button", { class: "plain", onclick: close }, "Cancel")),
  );
  document.body.append(dialog);
  dialog.showModal();
}

/** Before a page pack is added: its pages, who will see them, which start protected. Adding can be undone. */
function packPreview(k) {
  const dialog = h("dialog", { class: "aidialog" });
  const close = () => (dialog.close(), dialog.remove());
  const status = h("p", { class: "note", role: "status" });
  const add = h("button", { class: "primary" }, "Add these pages");
  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      const top = await api("POST", `marketplace/packs/${encodeURIComponent(k.id)}/add`);
      state.market = null;
      close();
      toast(`${k.name} was added to your Workspace.`, { label: "Undo", run: async () => (await api("DELETE", `workspace/pages/${top.id}`), (state.market = null), state.view === "workspace" ? workspaceView() : state.view === "market" ? marketView() : null) });
      openPage(top.id);
    } catch (err) {
      status.textContent = err.message;
      status.className = "note bad";
      add.disabled = false;
    }
  });
  fill(
    dialog,
    h("h3", {}, `${k.icon} ${k.name}`),
    h("p", { class: "note" }, k.summary),
    h("div", { class: "label" }, "What adding it does"),
    h("ul", {}, h("li", {}, `Adds one page called “${k.name}” to your Workspace, with these ${k.pages.length} pages inside it:`), h("ul", {}, k.pages.map((x) => h("li", {}, `${x.icon} ${x.title}`, x.protected ? h("span", { class: "tag" }, "protected") : null))), h("li", {}, `They are shared with ${k.sharedWith}. You can change who sees each page afterwards.`), k.pages.some((x) => x.protected) ? h("li", {}, "Protected pages are never changed by agents directly: they can only suggest a change for you to accept.") : null, h("li", {}, "Nothing you already have is changed. To undo, press Undo, or delete the page; it stays in Deleted for 30 days.")),
    status,
    h("div", { class: "row" }, add, h("button", { class: "plain", onclick: close }, "Cancel")),
  );
  document.body.append(dialog);
  dialog.showModal();
}

async function marketView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "market" });
  fill(ui.body, h("main", { class: "center" }, col));
  const market = await attempt(loadMarket, col);
  if (!market || state.view !== "market") return;
  const bots = market.bots;
  const categories = [...new Set<any>(bots.map((b) => b.listing.category))].sort();
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
    const byBot = new Map<any, any>(bots.map((b) => [b.id, b]));
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
    // Page packs: ready-made workspace pages. Preview first; adding can be undone.
    const packs = (market.packs ?? []).filter((k) => cat !== "+mine" && (!cat || k.group === cat) && (!needle || `${k.name} ${k.summary} ${k.pages.map((x) => x.title).join(" ")}`.toLowerCase().includes(needle)));
    const packCard = (k) => {
      const add = h("button", { class: k.added ? "madd" : "madd primary" }, k.added ? "Open" : "Preview and add");
      add.addEventListener("click", () => (k.added ? openPage(k.added) : packPreview(k)));
      return h(
        "article",
        { class: "mcard tcard" },
        h("div", { class: "mhead" }, h("span", { class: "packicon", "aria-hidden": "true" }, k.icon), h("div", {}, h("b", {}, k.name), h("div", { class: "by" }, `${k.pages.length} pages · for ${k.group}`))),
        h("p", { class: "mdesc" }, k.summary),
        h("div", { class: "mfoot" }, h("span", { class: "mono small muted" }, k.added ? "✓ In your workspace" : "Free · can be undone"), add),
      );
    };
    // Company templates and playbooks: several things set up at once, previewed first, undone in one step.
    const kits = (market.kits ?? []).filter((k) => !cat && (!needle || `${k.name} ${k.summary}`.toLowerCase().includes(needle)));
    const kitCard = (k) => {
      const main = h("button", { class: k.installed ? "madd" : "madd primary" }, k.installed ? (k.canRun ? "Run it now" : "✓ Installed") : "Preview and install");
      main.disabled = k.installed && !k.canRun;
      main.addEventListener("click", () =>
        k.installed
          ? attempt(async () => {
              const r = await api("POST", `marketplace/kits/${k.id}/run`);
              toast(`Given to the ${r.owner}. Its plan will come to you for approval.`);
              openTask(r.task);
            }, ui.body)
          : kitPreview(k),
      );
      const undo = k.installed
        ? h("button", { class: "plain small", onclick: () => confirm(`Undo “${k.name}”?\n\n${k.kind === "company" ? "Your chart goes back to how it was before it was installed. " : ""}Its pages go to Deleted (kept 30 days) and its automations are removed.`) && attempt(async () => (await api("POST", `marketplace/kits/${k.id}/undo`), (state.market = null), await Promise.all([loadCrew(), loadOrgs()]), marketView()), ui.body) }, "Undo")
        : null;
      return h(
        "article",
        { class: "mcard tcard" },
        h("div", { class: "mhead" }, h("span", { class: "packicon", "aria-hidden": "true" }, k.icon), h("div", {}, h("b", {}, k.name), h("div", { class: "by" }, k.kind === "company" ? "Company template" : "Playbook"))),
        h("p", { class: "mdesc" }, k.summary),
        h("div", { class: "mfoot" }, h("span", { class: "mono small muted" }, k.installed ? "✓ Installed" : "Free · can be undone"), undo, main),
      );
    };
    const kitSection = (kind, title, note) => ((list) => (list.length ? h("section", {}, h("h2", {}, title), h("p", { class: "note", style: "margin: -6px 0 12px" }, note), h("div", { class: "mgrid wide" }, list.map(kitCard))) : null))(kits.filter((k) => k.kind === kind));
    fill(
      results,
      !lab("templates") ? null : kitSection("company", "Company templates", "A running start for your kind of business: the positions on your chart, the pages your agents follow, and automations, set up together."),
      market.officeTemplates?.length && !cat && (!needle || market.officeTemplates.some((t) => `${t.name} ${t.summary}`.toLowerCase().includes(needle)))
        ? h("section", {}, h("h2", {}, "Office templates"), h("p", { class: "note", style: "margin: -6px 0 12px" }, "Ready-made documents and sheets: a proposal, a quote, a budget, a cash forecast."), h("div", { class: "mgrid wide" }, market.officeTemplates.filter((t) => !needle || `${t.name} ${t.summary}`.toLowerCase().includes(needle)).map(officeTemplateCard)))
        : null,
      !lab("templates") ? null : kitSection("playbook", "Playbooks", "One known process, ready to run: its procedure as a page, an automation for the group that owns it, and Run it now."),
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
      packs.length ? h("section", {}, h("h2", {}, "Page packs"), h("p", { class: "note", style: "margin: -6px 0 12px" }, "Ready-made pages for your Workspace: procedures, a price list, handbooks. Agents follow them; you edit them to match how you work."), h("div", { class: "mgrid wide" }, packs.map(packCard))) : null,
      cat || needle ? section(cat === "+mine" ? "On my team" : cat || "Results", shown) : categories.map((c) => section(c, shown.filter((b) => b.listing.category === c))),
      shown.length ? null : h("p", { class: "note" }, cat === "+mine" ? "You have not added a marketplace agent yet." : "No agent matches that. Try other words, or create your own agent from the Agents page."),
    );
  };
  search.addEventListener("input", () => ((ui.marketSearch = search.value), draw()));
  col.append(
    h("h1", {}, "Marketplace"),
    h("p", { class: "lead" }, "Company templates, playbooks, page packs, ready-made teams and agents for every department. Read exactly what each one does before you add it to your organization."),
    ...(market.updates ? [h("div", { class: "banner" }, `${market.updates} agent${market.updates === 1 ? "" : "s"} on your team ${market.updates === 1 ? "has" : "have"} a newer version. Open ${market.updates === 1 ? "it" : "one"} to see what changed and update, or keep yours.`, " ", h("button", { class: "plain link", onclick: () => ((ui.marketCat = "+mine"), marketView()) }, "Show them"))] : []),
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
  const files = new Map<any, any>();
  let current = null;
  for (const line of diff.split("\n")) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) files.set(head[2], (current = []));
    if (current) current.push(line);
  }
  return files;
}

function renderSteps(q, conversation) {
  const results = new Map<any, any>();
  for (const m of conversation.messages) {
    if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);
  }
  const steps: any[] = [];
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
  // The files and pages this task read, changed or made, so the link runs both ways.
  const filesBlock = h("section", { class: "panel-block" }, h("h2", { class: "label" }, "Files and pages"), h("p", { class: "note small" }, "Looking…"));
  api("GET", `quests/${q.id}/receipt`)
    .then((r) => fill(filesBlock, h("h2", { class: "label" }, "Files and pages"), r.pages?.length ? r.pages.map((p) => h("button", { class: "plain wstaskrow", onclick: () => openPage(p.page) }, h("span", { class: "grow" }, p.title), h("span", { class: "note small" }, p.how.join(", ")))) : h("p", { class: "note small" }, "This task has not read or made a file or page.")))
    .catch(() => filesBlock.remove());
  fill(ui.qright,
    q.why?.length > 1 ? h("section", { class: "panel-block" }, h("h2", { class: "label" }, "Why"), whyChain(q)) : null,
    filesBlock,
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
    for (const x of l.calls ?? []) out.push(`    step: ${x.model}${x.backup ? " (backup)" : ""}, ${Math.round(x.ms / 100) / 10} s${x.cost !== undefined ? `, ${money(x.cost)}` : ""}`);
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
  const open = new Set<any>([...panel.querySelectorAll("details[open]")].map((d) => d.dataset.id));
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
            l.calls?.length ? stepsTable(l.calls) : null,
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

/** A part's model calls: which model answered each, how long it took and what it cost. Backups are marked. */
function stepsTable(steps) {
  const secs = (ms) => (ms < 1000 ? "under a second" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
  const models = new Set<any>(steps.map((x) => x.model));
  const total = steps.reduce((n, x) => n + x.ms, 0);
  return h(
    "details",
    { class: "rsteps" },
    h("summary", {}, `${steps.length} step${steps.length === 1 ? "" : "s"} · ${secs(total)} thinking${models.size > 1 ? ` · ${models.size} models` : ` · ${[...models][0]}`}${steps.some((x) => x.backup) ? " · a backup answered" : ""}`),
    h(
      "table",
      { class: "rsteptable" },
      h("thead", {}, h("tr", {}, h("th", {}, "Step"), h("th", {}, "Model"), h("th", {}, "Time"), h("th", {}, "Cost"))),
      h("tbody", {}, steps.map((x, i) => h("tr", {}, h("td", {}, String(i + 1)), h("td", {}, x.model, x.backup ? h("span", { class: "tag warn" }, "backup") : null), h("td", {}, secs(x.ms)), h("td", {}, x.cost !== undefined ? money(x.cost) : "")))),
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
    [...new Set<any>([...types, draft.type])].map((t) => h("option", { value: t, selected: t === draft.type }, TYPE_WORDS[t] ?? cap(t))),
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
  const groupList = h("datalist", { id: "team-groups" }, [...new Set<any>((state.crew?.bots ?? []).map((b) => b.group))].map((g) => h("option", { value: g })));
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
          h("div", { class: "row" }, h("label", { class: "field grow" }, "Budget per run ($)", spend), h("label", { class: "field grow" }, "Steps per run", steps)),
          h("div", { class: "row" }, h("label", { class: "field grow" }, "Monthly budget ($)", monthly)),
          h("p", { class: "note small" }, existing?.month ? `Spent this month: ${money(existing.month.spent)}. At its monthly budget an agent starts no new work until you raise it or the month turns.` : "At its monthly budget an agent starts no new work until you raise it or the month turns."),
        ),
      ),
    ),
  );
  if (isNew) name.focus();
}

// ---------- chats ----------
function conversationPane({ tools = false } = {}) {
  ui.log = h("div", { class: "col" });
  ui.scroll = h("div", { class: "scroll" }, ui.log);
  ui.input = h("textarea", { rows: 1, placeholder: `Message ${speaker()}…` });
  ui.send = h("button", { class: "primary" }, "Send");
  ui.cards = new Map<any, any>();
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
  // In a chat, the box carries one choice, which AI model answers, beside the microphone and send. How hard it thinks is under Settings.
  if (tools) {
    return h("div", { class: "convo" }, ui.scroll, h("div", { class: "compose" }, h("div", { class: "col composebox" }, ui.input, h("div", { class: "composetools" }, h("span", { class: "askchip", title: "It asks you before it sends, changes or deletes anything, unless you told it otherwise." }, "Asks before it changes anything"), h("span", { class: "grow" }), chatBotOf() ? null : modelPicker(), state.canSpeak ? micButton(ui.input, "chatmic") : null, ui.send))));
  }
  return h("div", { class: "convo" }, ui.scroll, h("div", { class: "compose" }, h("div", { class: "col" }, ui.input, state.canSpeak ? micButton(ui.input, "chatmic") : null, ui.send)));
}

/**
 * Beside the chat: what is waiting on the owner, what is being worked on, and what got done today. The same items
 * as the Inbox, in three short lists, so the owner never has to leave the conversation to see where things stand.
 */
function renderOverview() {
  if (!ui.over?.isConnected) return;
  let mail: any[] = [];
  try {
    // What the owner archived or deleted in the Inbox is out of the way here too, so this panel and the Inbox agree.
    mail = mailMessages().filter((m) => !markOf(m).archived && !markOf(m).deletedAt);
  } catch {}
  const today = new Date().toDateString();
  const needs = mail.filter((m) => m.label === "needs" || m.label === "failed");
  const working = mail.filter((m) => m.label === "working");
  const done = mail.filter((m) => m.label === "done" && new Date(m.activityAt ?? m.at).toDateString() === today);
  // With nothing waiting, running or done, the panel is not shown at all: an empty column says nothing.
  const quiet = !needs.length && !working.length && !done.length;
  ui.over.hidden = quiet;
  ui.body.classList.toggle("over", !quiet);
  if (quiet) return fill(ui.over);
  const open = (m) => ((ui.mailOpen = m.id), go("inbox"));
  const who = (m) => (m.bot ? roleOf(m.bot.id)?.title || m.bot.name : "");
  const card = (m, note, cls = "") => h("button", { class: `plain overcard ${cls}`, onclick: () => open(m), title: m.subject }, h("span", { class: "overrow" }, m.bot ? keycap(m.bot, 20, "", m.bot.type) : null, h("span", { class: "overname" }, m.subject)), h("span", { class: "note small" }, [who(m), note].filter(Boolean).join(" · ")));
  const group = (title, list, body) => h("section", { class: "overgroup" }, h("div", { class: "label overlabel" }, h("span", { class: "grow" }, title), h("span", {}, String(list.length))), body);
  fill(
    ui.over,
    h("div", { class: "overhead" }, h("b", { class: "grow" }, "Overview"), h("button", { class: "plain link small", onclick: () => go("inbox") }, "Inbox")),
    [
          group("Waiting on you", needs, needs.length ? needs.slice(0, 5).map((m) => card(m, m.label === "failed" ? "stopped; needs a look" : "needs your yes", "wait")) : h("p", { class: "note small" }, "Nothing. You're up to date.")),
          group("Working", working, working.length ? working.slice(0, 5).map((m) => card(m, m.snippet ? String(m.snippet).slice(0, 60) : "")) : h("p", { class: "note small" }, "Nothing is running.")),
          done.length ? group("Done today", done, done.slice(0, 6).map((m) => h("button", { class: "plain overdone", onclick: () => open(m), title: m.subject }, m.subject))) : null,
        ],
  );
}

function chatView() {
  ui.body.className = "body two over";
  ui.chatSide = h("aside", { class: "side" });
  const withBot = chatBotOf();
  ui.title = h("h1", {}, "New session");
  ui.meta = h("span", { class: "meta" });
  ui.remove = h("button", { class: "plain danger", title: "Delete this chat", onclick: deleteChat, hidden: !state.convId }, "Delete");
  // An open chat shows the space it belongs to, wherever it was opened from.
  const open = state.convs.find((c) => c.id === state.convId);
  if (open && (open.space || "") !== state.space) setSpace(open.space);
  ui.move = moveChatPicker();
  ui.pin = h("button", { class: "plain", hidden: true, onclick: () => pinChat({ id: state.convId }, !state.convs.find((c) => c.id === state.convId)?.pinned) }, "Pin");
  syncPin();
  const pane = conversationPane({ tools: true });
  fill(ui.body, ui.chatSide, h("main", { class: "center flush" }, h("div", { class: "chathead", style: withBot ? botStyle(withBot) : "" }, withBot ? keycap(withBot, 28, "", withBot.type) : null, ui.title, withBot ? h("span", { class: "small muted", title: "This chat is with one agent, in its role. It uses that agent's instructions, powers, model and limits." }, roleLine(withBot, roleOf(withBot.id)?.title)) : null, ui.meta, ui.move, ui.pin, ui.remove), pane));
  ui.over = h("aside", { class: "overpane", "aria-label": "Overview" });
  ui.body.append(ui.over);
  renderOverview();
  if (!state.mail) loadMail().then(renderOverview).catch(() => {});
  renderChatList();
  setRunning(false);
  if (state.convId) connect(state.convId);
  else {
    // A new session is where everything starts: what is missing to get going, a few things to try, and the box.
    if (!state.crew || !state.orgs) Promise.all([state.crew ? null : loadCrew(), state.orgs ? null : loadOrgs()]).then(() => state.view === "chat" && !state.convId && !ui.input.value && chatView()).catch(() => {});
    const bots = state.crew?.bots ?? [];
    const noModel = needsKey(state.config);
    const noTeam = Boolean(state.orgs) && !activeOrg().members?.length;
    const first = state.me?.person ? state.me.person.name.split(" ")[0] : "";
    const fromTeam: any[] = [];
    for (const b of bots) {
      const idea = (TASK_IDEAS[departmentOf(b.id)] ?? TASK_IDEAS[b.group] ?? [])[0];
      if (idea && !fromTeam.some((x) => x.idea === idea || x.dept === (departmentOf(b.id) ?? b.group))) fromTeam.push({ dept: departmentOf(b.id) ?? b.group ?? "Team", idea, bot: b });
      if (fromTeam.length === 3) break;
    }
    const ideas = fromTeam.length === 3 ? fromTeam : ["Summarize the news on a topic I care about", "Help me write an email", "Explain something step by step", "Find and compare options for me"].map((idea) => ({ dept: "", idea: `${idea}: `, bot: null }));
    const steps = [
      ["1", "Connect an AI model", "Your agents think with it. Pick a service and paste its key, or use a free model on this computer.", !noModel, () => ((ui.integration = "ai-models"), go("integrations"))],
      ["2", "Set up your team", "Say what your business does; Talqava suggests who you need.", !noTeam, () => ((ui.setup = { step: "mission" }), go("setup"))],
    ];
    ui.log.append(
      h(
        "div",
        { class: "empty hero" },
        heroVideo(),
        h("h2", {}, first ? `What do you need done, ${first}?` : "What do you need done?"),
        h("p", {}, noModel ? "One thing first: connect an AI model, so your team can think." : bots.length ? "Ask in your own words. Type @ and a name to give someone on your team a task; plain words go to your assistant." : "Ask in your own words. I can search the web, work with files and remember what matters to you."),
        noModel || noTeam ? h("div", { class: "card form askset" }, steps.filter((x) => !x[3]).map(([n, title, about, , run]) => h("div", { class: "istep" }, h("span", { class: "istepmark", "aria-hidden": "true" }, n), h("div", { class: "grow" }, h("b", {}, title), h("div", { class: "note small" }, about)), h("button", { class: n === "1" || !noModel ? "primary" : "", onclick: run }, n === "1" ? "Connect" : "Set up")))) : null,
        state.space
          ? h("p", { class: "note" }, `This session is in ${spaceName(state.space)}. I use ${spaceName(state.space)}'s memory along with your general memory, and what I learn here stays in ${spaceName(state.space)}.`)
          : null,
        h(
          "div",
          { class: "ideas" },
          ideas.map((x) => h("button", { title: "Puts this in the box, for you to change or send", onclick: () => ((ui.input.value = x.bot ? `@${x.bot.id} ${x.idea}` : x.idea), ui.input.focus()) }, x.idea.replace(/: $/, ""))),
        ),
        h("p", { class: "note small" }, bots.length ? h("button", { class: "plain link", onclick: () => newTaskDialog() }, "Give a task with more options") : null),
      ),
    );
  }
  ui.input.focus();
}

/**
 * Choose the AI model right where you chat. Lists Claude's models and every
 * model the other providers (Ollama, LM Studio and so on) say they have.
 */
/**
 * Which AI model answers, chosen in the message box. The button names the model in use; pressing it opens a short
 * list, not every model there is: the one in use, the ones kept (starred), the ones used lately and the backups.
 * Everything else is found by typing a few letters, or by opening a service. A long list is never shown at once.
 */
function modelPicker() {
  const c = state.config;
  const parts = (ref) => {
    const slash = ref.indexOf("/");
    const provider = c.providers.find((p) => p.id === ref.slice(0, slash));
    const name = ref.slice(slash + 1);
    const claude = provider?.kind === "anthropic";
    return { name: claude ? c.models.find((m) => m.id === name)?.label || name : name.split("/").pop(), service: claude ? "Claude" : provider?.name || ref.slice(0, slash), id: provider?.id ?? ref.slice(0, slash) };
  };
  const kept = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]").filter((x) => typeof x === "string");
    } catch {
      return [];
    }
  };
  const keep = (key, list) => {
    try {
      localStorage.setItem(key, JSON.stringify(list.slice(0, 12)));
    } catch {}
  };
  const button = h("button", { type: "button", class: "modelbtn", "aria-haspopup": "dialog", "aria-expanded": "false", title: "The AI model that answers. Press to choose another." });
  const name = () => fill(button, h("span", { class: "modelbtnname" }, parts(state.config.model).name), h("span", { class: "modelbtnmore", "aria-hidden": "true" }, "⌄"));
  name();
  // Every model of every connected service, fetched once when the list is first opened.
  let all = null;
  const load = async () =>
    (all ??= (
      await Promise.all(
        c.providers.map(async (p) => {
          if (p.kind === "anthropic") return c.hasApiKey ? c.models.map((m) => `${p.id}/${m.id}`) : [];
          const listed = await api("GET", `providers/${encodeURIComponent(p.id)}/models`).catch(() => ({ models: [] }));
          return listed.models.map((m) => `${p.id}/${m}`);
        }),
      )
    ).flat());
  const choose = (ref, box) =>
    attempt(async () => {
      state.config = await api("PUT", "settings", { model: ref });
      keep("talqava.models.recent", [ref, ...kept("talqava.models.recent").filter((x) => x !== ref)]);
      name();
      box.close();
    });
  button.addEventListener("click", () => {
    const open: any = document.querySelector(".modelmenu");
    if (open) return open.close();
    const box: any = h("div", { class: "modelmenu", role: "dialog", "aria-label": "Choose the AI model" });
    const find = h("input", { type: "search", class: "modelfind", placeholder: "Find a model by name", "aria-label": "Find a model", autocomplete: "off" });
    const list = h("div", { class: "modellist" });
    let openService = "";
    const row = (ref) => {
      const m = parts(ref);
      const starred = kept("talqava.models.kept").includes(ref);
      const star = h("button", { type: "button", class: `modelstar ${starred ? "on" : ""}`, "aria-pressed": String(starred), "aria-label": starred ? `Stop keeping ${m.name} in the short list` : `Keep ${m.name} in the short list`, title: starred ? "Kept in your short list. Press to take it out." : "Keep in your short list" }, starred ? "★" : "☆");
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        keep("talqava.models.kept", starred ? kept("talqava.models.kept").filter((x) => x !== ref) : [ref, ...kept("talqava.models.kept")]);
        draw();
      });
      const on = ref === state.config.model;
      return h("div", { class: `modelrow ${on ? "on" : ""}` }, h("button", { type: "button", class: "modelrowmain", "aria-current": on ? "true" : null, onclick: () => choose(ref, box) }, h("span", { class: "modelrowname" }, m.name), h("span", { class: "modelrowby" }, m.service), on ? h("span", { class: "modelrowon" }, "In use") : null), star);
    };
    const group = (title, refs) => (refs.length ? [h("div", { class: "modelgroup" }, title), ...refs.map(row)] : []);
    const draw = () => {
      const q = find.value.trim().toLowerCase();
      const known = new Set<any>(all ?? []);
      const have = (ref) => !all || known.has(ref) || ref === state.config.model;
      if (q) {
        const hits = (all ?? []).filter((ref) => q.split(/\s+/).every((w) => ref.toLowerCase().includes(w) || parts(ref).service.toLowerCase().includes(w)));
        return fill(list, hits.length ? [...hits.slice(0, 40).map(row), hits.length > 40 ? h("p", { class: "note small modelnote" }, `${hits.length - 40} more. Type more of the name.`) : null] : h("p", { class: "note small modelnote" }, all ? "No model with that name. Add a service under Add or set up models." : "Looking…"));
      }
      const current = state.config.model;
      const starred = kept("talqava.models.kept").filter((r) => r !== current && have(r));
      const recent = kept("talqava.models.recent").filter((r) => r !== current && !starred.includes(r) && have(r)).slice(0, 4);
      const backups = (c.backups ?? []).filter((r) => r !== current && !starred.includes(r) && !recent.includes(r));
      const services = c.providers.map((p) => ({ p, refs: (all ?? []).filter((r) => r.startsWith(`${p.id}/`)) })).filter((x) => x.refs.length);
      fill(
        list,
        ...group("In use", [current]),
        ...group("Kept", starred),
        ...group("Used lately", recent),
        ...group("Backups", backups),
        services.length ? h("div", { class: "modelgroup" }, "Every model, by service") : all ? null : h("p", { class: "note small modelnote" }, "Looking for your services' models…"),
        services.flatMap(({ p, refs }) => {
          const isOpen = openService === p.id;
          const head = h("button", { type: "button", class: "modelservice", "aria-expanded": String(isOpen), onclick: () => ((openService = isOpen ? "" : p.id), draw()) }, h("span", { class: "grow" }, p.kind === "anthropic" ? "Claude" : p.name), h("span", { class: "modelrowby" }, `${refs.length} model${refs.length === 1 ? "" : "s"}`), h("span", { "aria-hidden": "true" }, isOpen ? "⌄" : "›"));
          return isOpen ? [head, ...refs.slice(0, 60).map(row), refs.length > 60 ? h("p", { class: "note small modelnote" }, `${refs.length - 60} more. Find one by typing its name above.`) : null] : [head];
        }),
      );
    };
    const away = (e) => !box.contains(e.target) && !button.contains(e.target) && box.close();
    const key = (e) => e.key === "Escape" && (box.close(), button.focus());
    box.close = () => (box.remove(), button.setAttribute("aria-expanded", "false"), document.removeEventListener("pointerdown", away, true), document.removeEventListener("keydown", key, true));
    find.addEventListener("input", draw);
    fill(box, find, list, h("button", { type: "button", class: "plain link small modeladd", onclick: () => (box.close(), (ui.integration = "ai-models"), go("integrations")) }, "Add or set up models…"));
    document.body.append(box);
    // Opens above the button, within the window.
    const at = button.getBoundingClientRect();
    box.style.left = `${Math.max(12, Math.min(at.left, window.innerWidth - 372))}px`;
    box.style.bottom = `${Math.max(12, window.innerHeight - at.top + 8)}px`;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    draw();
    find.focus();
    load().then(() => box.isConnected && draw());
  });
  return button;
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
  if (!force && ui.chatSide.querySelector(".sessmenu[open]")) return; // nor while a session's menu is open
  // One list of sessions: every chat and every task you started, newest first. Each can be pinned, renamed and archived.
  const all = (state.sessions ?? state.convs.map((c) => ({ ...c, kind: "chat", state: c.needsApproval ? "waiting" : c.running ? "working" : "idle" }))).filter((x) => (x.space || "") === state.space || x.kind === "task");
  const open = (x) => (x.kind === "task" ? ((ui.questFrom = "sessions"), go("quest", x.id)) : go("chat", x.id));
  const change = (x, patch, done?) =>
    attempt(async () => {
      await api("PATCH", `conversations/${x.id}`, patch);
      await refreshList();
      renderChatList(true);
      if (x.id === state.convId) syncPin();
      if (done) toast(done);
    }, ui.chatSide);
  const rename = async (x) => {
    const box = h("input", { id: "session-name", value: x.title, maxlength: 80, "aria-label": "Name" });
    const name = await libDialog("Rename this session", h("div", { class: "composeform" }, h("label", {}, "Name", box)), [["Save", () => box.value.trim(), true]]);
    if (name && name !== x.title) change(x, { title: name }).then(() => x.id === state.convId && ui.title && (ui.title.textContent = name));
  };
  const STATE_WORDS2 = { waiting: "Waiting for you", working: "Working", stopped: "Stopped before it finished" };
  const row = (x) => {
    const menu = h("details", { class: "sessmenu" }, h("summary", { "aria-label": `More for ${x.title}`, title: "Pin, rename, archive" }, "⋯"));
    const pick = (label, run, cls = "") => h("button", { class: `plain ${cls}`, onclick: () => (menu.removeAttribute("open"), run()) }, label);
    menu.append(
      h(
        "div",
        { class: "automenulist" },
        x.archived ? null : pick(x.pinned ? "Unpin" : "Pin to the top", () => change(x, { pinned: !x.pinned })),
        pick("Rename…", () => rename(x)),
        pick(x.archived ? "Bring back" : "Archive", () => change(x, { archived: !x.archived }, x.archived ? "Brought back." : "Archived. Find it under Show archived.")),
        x.kind === "chat" ? pick("Delete…", () => deleteChatFromList(x), "danger") : null,
      ),
    );
    const who = x.kind === "task" ? x.bot : chatBotOf(x.id);
    return h(
      "div",
      { class: `chatrow sessrow ${x.id === state.convId ? "on" : ""} ${x.pinned ? "pinned" : ""}` },
      h(
        "button",
        { class: `navlink ${x.id === state.convId ? "on" : ""}`, title: x.kind === "task" ? `${x.bot?.title || x.bot?.name || "An agent"}: ${x.title}` : x.title, onclick: () => open(x) },
        who ? keycap(who, 18, "", who.type) : h("span", { class: "sesskind", "aria-hidden": "true" }, icon("chat")),
        h("span", { class: "title" }, x.title),
        STATE_WORDS2[x.state] ? h("i", { class: `dot ${x.state === "waiting" ? "wait" : x.state === "stopped" ? "bad" : ""}`, title: STATE_WORDS2[x.state] }) : null,
      ),
      menu,
    );
  };
  const shown = all.filter((x) => !x.archived);
  const archived = all.filter((x) => x.archived);
  const today = new Date().toDateString();
  const pinned = shown.filter((x) => x.pinned);
  const now = shown.filter((x) => !x.pinned && new Date(x.updatedAt).toDateString() === today);
  const earlier = shown.filter((x) => !x.pinned && new Date(x.updatedAt).toDateString() !== today).slice(0, 60);
  const part = (label, list) => (list.length ? [h("div", { class: "listlabel" }, label), ...list.map(row)] : null);
  // Before the first session there is nothing to list: the page is the question and the box, and nothing else.
  const bare = !(state.sessions ?? state.convs).length && !state.spaces.length && !ui.addingSpace;
  ui.chatSide.hidden = bare;
  ui.body.classList.toggle("noside", bare);
  fill(ui.chatSide,
    spacePicker(),
    h(
      "div",
      { class: "chatlist" },
      part("Pinned", pinned),
      part("Today", now),
      part("Earlier", earlier),
      shown.length ? null : h("p", { class: "note small", style: "padding: 0 8px" }, state.space ? `Nothing in ${spaceName(state.space)} yet.` : "No sessions yet. Ask for something to start one."),
      archived.length ? h("button", { class: "plain link small sessarch", onclick: () => ((ui.showArchived = !ui.showArchived), renderChatList(true)) }, ui.showArchived ? "Hide archived" : `Show archived · ${archived.length}`) : null,
      ui.showArchived ? part("Archived", archived) : null,
    ),
    navFooter("chat"),
  );
}

async function submit() {
  const text = ui.input.value.trim();
  if (!text || state.running) return;
  // In a new session, "@name …" gives that agent a task; plain words go to the assistant.
  if (!state.convId) {
    const bots = state.crew?.bots ?? [];
    const mention = /^@([\w-]+)\s+([\s\S]+)$/.exec(text);
    const bot = mention ? bots.find((b) => b.id === mention[1].toLowerCase() || b.name.toLowerCase().replace(/\s+/g, "-").startsWith(mention[1].toLowerCase()) || b.name.toLowerCase().startsWith(mention[1].toLowerCase())) : null;
    if (mention && !bot) return toast(`Nobody on your team is called “${mention[1]}”. Open Team to see their names, or ask without the @.`);
    if (bot) return (ui.input.value = ""), sendQuest(bot, mention[2].trim());
  }
  await attempt(async () => {
    if (!state.convId) {
      const conv = await api("POST", "conversations", state.space ? { space: state.space } : {});
      state.convId = conv.id;
      if (ui.remove) ui.remove.hidden = false;
      if (ui.move) ui.move.hidden = !state.spaces.length;
      fill(ui.log, );
      connect(conv.id);
      await new Promise<any>((resolve) => state.source.addEventListener("open", resolve, { once: true }));
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
async function chatWith(bot, where?) {
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

/** The two parts of Knowledge, to switch between at the top of each. */
const knowledgeParts = (on) =>
  h("div", { class: "segmented knowparts", role: "tablist", "aria-label": "Parts of Knowledge" }, [["memory", "Memory", "What is remembered"], ["skills", "Skills", "How things are done"]].map(([view, label, tip]) => h("button", { role: "tab", class: on === view ? "on" : "", "aria-selected": String(on === view), title: tip, onclick: () => on !== view && go(view) }, label)));

// ---------- memory ----------
/** Everything remembered, one space at a time: add, edit, move and forget entries, and manage the spaces. */
async function memoryView() {
  if (ui.memSpace === undefined || !["", ...state.spaces.map((s) => s.id)].includes(ui.memSpace)) ui.memSpace = state.space;
  const at = ui.memSpace;
  const name = spaceName(at);
  const again = () => memoryView();
  const col = page(
    "Knowledge",
    `What ${state.config.agentName} remembers between chats. It adds to this on its own, and tells you in the chat when it does. General memory goes into every chat; a project's memory goes only into that project's chats.`,
    knowledgeParts("memory"),
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
/** Writes a new skill, or changes one: its name, when it is for, and its steps. */
function skillDialog(existing = null) {
  const name = h("input", { value: existing?.name ?? "", placeholder: "e.g. monthly-invoice-check", maxlength: 60, "aria-label": "Name" });
  const description = h("input", { value: existing?.description ?? "", placeholder: "When to use it, in one line", maxlength: 300, "aria-label": "When it is for" });
  const content = h("textarea", { rows: 12, placeholder: "The steps, in order, as you would explain them to a new colleague.", "aria-label": "Steps" }, existing?.content ?? "");
  const status = h("p", { class: "note", role: "status" });
  const dialog = h("dialog", { class: "aidialog" });
  const close = () => (dialog.close(), dialog.remove());
  fill(
    dialog,
    h(
      "form",
      {
        class: "form",
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api("PUT", `skills/${encodeURIComponent(existing?.name ?? "")}`, { name: name.value, description: description.value, content: content.value });
            close();
            toast(existing ? "Skill saved." : "Skill added. Agents can follow it from now on.");
            skillsView();
          } catch (err) {
            status.textContent = err.message;
            status.className = "note bad";
          }
        },
      },
      h("h3", {}, existing ? `Change “${existing.name}”` : "New skill"),
      h("label", {}, "Name", name),
      h("label", {}, "When it is for", description),
      h("label", {}, "Steps", content),
      status,
      h("div", { class: "row" }, h("button", { class: "primary" }, "Save"), h("button", { type: "button", class: "plain", onclick: close }, "Cancel")),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
}

async function skillsView() {
  const col = page("Knowledge", `Procedures ${state.config.agentName} follows: written down by an agent after working out how to do something, or by you.`, knowledgeParts("skills"));
  const skills = await attempt(() => api("GET", "skills"), col);
  if (!skills) return;
  col.append(h("div", { class: "row" }, h("button", { class: "primary", onclick: () => skillDialog() }, "+ New skill")));
  if (!skills.length) col.append(h("p", { class: "note" }, "No skills yet. Write one with + New skill, or ask an agent to “save that as a skill” after a task you'll want again."));
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
          h("button", { onclick: () => skillDialog(s) }, "Change"),
          " ",
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
  // Opened from a position's panel, a new automation starts out belonging to that position.
  const who = whoPicker(job?.owner ?? ui.routineFor ?? "");
  ui.routineFor = null;
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
    h("div", { class: "row" }, job ? h("button", { type: "button", class: "plain", onclick: done }, "Cancel") : null, h("button", { class: "primary" }, job ? "Save changes" : "Add automation")),
  );
}

/** What an automation costs, said before it is switched on: for each run, and for a month on its schedule. */
function costWords(c, { short = false } = {}) {
  if (!c || c.from === "free") return short ? "Free" : "Free: uses no AI model";
  if (c.perRun === null || c.from === "unknown") return short ? "Not known" : "Uses your AI model; its price is not listed, so the cost is not known";
  const month = c.perRun * c.perMonth;
  if (short) return `about ${money(month)} a month`;
  return `About ${money(c.perRun)} each time, about ${money(month)} a month ${c.from === "history" ? "(from its past runs)" : "(estimate)"}`;
}
/** How a run turned out, as a word and a colour. */
const OUTCOME_WORDS = { done: ["Done", "ok"], working: ["Working", ""], waiting: ["Needs you", "wait"], failed: ["Did not work", "bad"], skipped: ["Left out", "bad"] };

/** Automations › Start a briefing: ready-made reports for the Inbox, switched on with one press. */
function briefingGallery(host, data, col) {
  state.briefings = data;
  const again = () => jobsView();
  const card = (b) => {
    const on = b.on;
    const act = (fn, done) => attempt(async () => (await fn(), done && toast(done), again()), col);
    return h(
      "article",
      { class: `briefcard ${on?.enabled ? "on" : ""}` },
      h("div", { class: "brieftop" }, h("b", { class: "grow" }, b.name), on ? h("span", { class: `briefstate ${on.enabled ? "on" : ""}` }, on.enabled ? "On" : "Paused") : null),
      h("p", { class: "briefabout" }, b.about),
      h("p", { class: "note small" }, `${b.when} · ${costWords(b.costs)}${on && b.sender ? ` · sent by the ${b.sender.title}` : ""}`),
      b.needs?.length ? h("p", { class: `note small ${b.ready ? "" : "briefneeds"}` }, b.ready ? `Reads ${b.needs.filter((n) => n.connected).map((n) => n.name).join(" and ")}` : `Needs ${b.needs.map((n) => n.name).join(" or ")}`) : null,
      b.review ? h("p", { class: "note small" }, "Drafts for you; nothing is sent. It waits for your yes.") : null,
      b.quiet ? h("p", { class: "note small" }, "Quiet unless there is something to say.") : null,
      on && b.ask?.value && !b.ask.list ? h("p", { class: "note small" }, `Watching: ${b.ask.value}`) : null,
      h(
        "div",
        { class: "row wrap brieffoot" },
        on
          ? [
              on.enabled ? h("button", { class: "small", onclick: () => act(() => api("PATCH", `jobs/${on.job}`, { enabled: false }), `${b.name} is paused.`) }, "Pause") : h("button", { class: "small primary", onclick: () => act(() => api("PATCH", `jobs/${on.job}`, { enabled: true }), `${b.name} is on again.`) }, "Switch back on"),
              h("button", { class: "small", title: b.ask ? "Change its answer and when it arrives" : "Change when it arrives", onclick: () => briefingEdit(b).then((ok) => ok && again()) }, "Edit"),
              h("button", { class: "small", title: "Send one now", onclick: () => attempt(async () => ((r) => (toast(r.skipped ?? "One is on its way to your Inbox."), again()))(await api("POST", `jobs/${on.job}/run`, {})), col) }, "Send one now"),
              h("button", { class: "plain link small", onclick: () => confirm(`Switch ${b.name} off for good? You can switch it on again later.`) && act(() => api("DELETE", `jobs/briefings/${b.id}`), `${b.name} is switched off.`) }, "Switch off"),
            ]
          : b.ready
            ? h("button", { class: "small primary", onclick: () => briefingOn(b).then((ok) => ok && again()) }, "Switch on")
            : h("button", { class: "small", onclick: () => ((ui.integration = `service:${b.needs[0].id}`), go("integrations")) }, `Connect ${b.needs.length === 1 ? b.needs[0].name : "a service"} first`),
      ),
    );
  };
  // The free ones first: they work for everyone on day one. A group opens by itself when something in it is on.
  const order = ["Your own work", "The outside world", "Money", "Customers", "Marketing", "Running the business", "People and renewals"];
  const groups = [...new Set<any>(data.briefings.map((b) => b.group))].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const onCount = data.briefings.filter((b) => b.on?.enabled).length;
  fill(
    host,
    h("p", { class: "note" }, `Ready-made automations. Each sends a report to your Inbox. Switch one on with one press; pause it any time.${onCount ? ` ${onCount} ${onCount === 1 ? "is" : "are"} on.` : ""}`),
    groups.map((g, i) => {
      const mine = data.briefings.filter((b) => b.group === g);
      const live = mine.filter((b) => b.on).length;
      return h("details", { class: "briefgroup", open: i < 2 || live > 0 }, h("summary", {}, h("b", {}, g), h("span", { class: "note small" }, ` · ${mine.length}${live ? ` · ${live} on` : ""}`)), h("div", { class: "briefgrid" }, mine.map(card)));
    }),
    data.planned?.length ? h("p", { class: "note small" }, `Planned, once their service is connected: ${data.planned.join("; ")}.`) : null,
  );
}

/** The times a briefing can arrive, in plain words, as the automation's timing. */
const BRIEF_TIMES = [
  ["every 30m", "Every 30 minutes"], ["every 1h", "Every hour"], ["0 6 * * 1-5", "Weekdays at 6:00"], ["0 9 * * *", "Every day at 9:00"], ["0 17 * * 1-5", "Weekdays at 5:00 pm"], ["0 9 * * 0", "Sundays at 9:00"], ["0 9 * * 5", "Fridays at 9:00"],
  ["0 7 * * *", "Every day at 7:00"], ["30 7 * * *", "Every day at 7:30"], ["0 8 * * *", "Every day at 8:00"], ["0 17 * * *", "Every day at 5:00 pm"], ["0 18 * * *", "Every day at 6:00 pm"],
  ["30 7 * * 1-5", "Weekdays at 7:30"], ["0 8 * * 1-5", "Weekdays at 8:00"], ["0 9 * * 1-5", "Weekdays at 9:00"], ["30 17 * * 1-5", "Weekdays at 5:30 pm"],
  ["0 8 * * 1", "Mondays at 8:00"], ["0 9 * * 1", "Mondays at 9:00"], ["0 9 * * 2", "Tuesdays at 9:00"], ["0 9 * * 4", "Thursdays at 9:00"], ["0 10 * * 5", "Fridays at 10:00"], ["0 15 * * 5", "Fridays at 3:00 pm"], ["0 16 * * 5", "Fridays at 4:00 pm"], ["0 9 * * 6", "Saturdays at 9:00"],
  ["0 8 1 * *", "The 1st of each month at 8:00"], ["0 9 1 * *", "The 1st of each month at 9:00"], ["0 8 2 * *", "The 2nd of each month at 8:00"], ["0 9 1 1,4,7,10 *", "The 1st of January, April, July and October"],
];

/** Editing a briefing that is on: its one answer (or its list), and when it arrives. */
/** Who sends a briefing and which AI model it uses: two choices, filled from the team and the connected AI services. */
async function briefingChoices(b, prefix) {
  const c = state.config;
  const team = (await api("GET", "jobs/briefings").catch(() => ({ team: [] }))).team ?? [];
  const sender = h("select", { id: `${prefix}-sender`, "aria-label": "Who sends it" }, team.map((m) => h("option", { value: m.bot, selected: m.bot === b.sender?.bot }, m.department ? `${m.title} (${m.department})` : m.title)));
  if (b.kind === "free") return { sender, model: null };
  const label = (ref) => {
    const slash = ref.indexOf("/");
    const provider = c.providers.find((p) => p.id === ref.slice(0, slash));
    const name = ref.slice(slash + 1);
    return provider?.kind === "anthropic" ? `Claude · ${c.models.find((m) => m.id === name)?.label || name}` : `${provider?.name || ref.slice(0, slash)} · ${name}`;
  };
  const model = h("select", { id: `${prefix}-model`, "aria-label": "AI model" });
  const show = (refs) => fill(model, h("option", { value: "", selected: !b.model }, "The sender's usual model"), [...new Set<any>([...(b.model ? [b.model] : []), c.model, ...refs])].map((ref) => h("option", { value: ref, selected: ref === b.model }, label(ref))));
  show([]);
  // The models of every connected AI service, as the chat's own picker lists them.
  Promise.all(
    c.providers.map(async (p) => {
      if (p.kind === "anthropic") return c.hasApiKey ? c.models.map((m) => `${p.id}/${m.id}`) : [];
      const listed = await api("GET", `providers/${encodeURIComponent(p.id)}/models`).catch(() => ({ models: [] }));
      return listed.models.map((m) => `${p.id}/${m}`);
    }),
  ).then((lists) => {
    const had = model.value;
    show(lists.flat());
    model.value = had;
  });
  return { sender, model };
}

async function briefingEdit(b) {
  const choice = await briefingChoices(b, "briefing-edit");
  const topic = !b.ask ? null : b.ask.list ? h("textarea", { id: "briefing-edit-topic", rows: 7, placeholder: b.ask.placeholder, maxlength: 4000, "aria-label": b.ask.label }, b.ask.value || "") : h("input", { id: "briefing-edit-topic", value: b.ask.value || "", placeholder: b.ask.placeholder, maxlength: 300, "aria-label": b.ask.label });
  const now = b.on?.schedule || b.schedule;
  const times = BRIEF_TIMES.some(([v]) => v === now) ? BRIEF_TIMES : [[now, "As set under your automations"], ...BRIEF_TIMES];
  const time = h("select", { id: "briefing-edit-time", "aria-label": "When it arrives" }, times.map(([v, label]) => h("option", { value: v, selected: v === now }, label)));
  const body = h(
    "div",
    { class: "composeform briefdialog" },
    topic ? h("label", {}, b.ask.label, topic, h("span", { class: "note small" }, b.ask.hint ? b.ask.hint : b.ask.list ? "One on each line: a name, a comma, then the date." : b.ask.required ? "Say it in a few words." : "Leave it empty to follow your mission.")) : null,
    h("label", {}, "When it arrives", time),
    h("label", {}, "Who sends it", choice.sender),
    choice.model ? h("label", {}, "AI model", choice.model, h("span", { class: "note small" }, "Used for this briefing only. A smaller model costs less; a larger one reads and writes better.")) : null,
    h("p", { class: "note small" }, "The change applies from the next one. Press Send one now on the card to see it straight away."),
  );
  const got = await libDialog(`Edit ${b.name}`, body, [["Save", () => ({ topic: topic?.value.trim() ?? b.ask?.value ?? "", schedule: time.value, sender: choice.sender.value, ...(choice.model ? { model: choice.model.value } : {}) }), true]]);
  if (!got) return false;
  if (b.ask?.required && !got.topic) return (toast(`${b.name} needs an answer.`), false);
  try {
    await api("PATCH", `jobs/briefings/${b.id}`, got);
    toast(`${b.name} is changed.`);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

/** Switching a briefing on: at most one question, and what an owner wants to know before saying yes. */
async function briefingOn(b) {
  if (!b.sender) return (toast("A briefing is sent by someone on your team. Set up your team first, under Team."), false);
  const org = activeOrg();
  const choice = await briefingChoices(b, "briefing");
  const topic = !b.ask ? null : b.ask.list ? h("textarea", { id: "briefing-topic", rows: 5, placeholder: b.ask.placeholder, maxlength: 4000, "aria-label": b.ask.label }, b.ask.value || "") : h("input", { id: "briefing-topic", value: b.ask.value || "", placeholder: b.ask.placeholder, maxlength: 300, "aria-label": b.ask.label });
  const fact = (label, value) => h("div", { class: "brieffact" }, h("span", {}, label), h("b", {}, value));
  const body = h(
    "div",
    { class: "composeform briefdialog" },
    h("p", { class: "note" }, b.about),
    topic ? h("label", {}, b.ask.label, topic, h("span", { class: "note small" }, b.ask.hint ? b.ask.hint : b.ask.list ? "A name, a comma, then the date. You can change the list later with Edit." : b.ask.required ? "Say it in a few words." : org.mission ? "Leave it empty to follow your mission." : "Say it in a few words.")) : null,
    h(
      "div",
      { class: "brieffacts" },
      fact("Arrives", b.when),
      fact("Where", b.review ? "Your Inbox, under Waiting on you" : "Your Inbox, under Updates"),
      b.needs?.length ? fact("Reads", b.needs.filter((n) => n.connected).map((n) => n.name).join(" and ")) : null,
      fact("Costs", b.kind === "free" ? "Nothing: it uses no AI model" : costWords(b.costs)),
      fact("Can it change anything?", b.kind === "free" ? "No. It only reads what Talqava holds." : b.review ? "No. It drafts; you decide what is sent." : "No. It reads and writes to you."),
      b.grants?.length ? fact("Also", `Lets whoever sends it ${b.grants.map((g) => (g === "web" ? "search the web" : g === "connectors" ? "use your connected services" : g)).join(" and ")}, if they cannot already`) : null,
    ),
    h("label", {}, "Who sends it", choice.sender, h("span", { class: "note small" }, `Talqava suggests your ${b.sender.title}. Choose someone else if this is their work.`)),
    choice.model ? h("label", {}, "AI model", choice.model, h("span", { class: "note small" }, "Used for this briefing only. A smaller model costs less; a larger one reads and writes better.")) : null,
    h("p", { class: "note small" }, b.quiet ? "It writes to you only when there is something to say; otherwise it stays quiet." : b.review ? "The first one arrives now. Reply to it with numbers to act: 1 send, 2 skip." : "The first one arrives now, so you can see it."),
  );
  const got = await libDialog(b.name, body, [["Switch on", () => ({ topic: topic?.value.trim() ?? "", sender: choice.sender.value, ...(choice.model ? { model: choice.model.value } : {}) }), true]]);
  if (!got) return false;
  if (b.ask?.required && !got.topic) return (toast(`${b.name} needs an answer first.`), false);
  try {
    const r = await api("POST", `jobs/briefings/${b.id}/on`, got);
    toast(r.problem ? `${b.name} is on, but the first one could not start: ${r.problem}` : `${b.name} is on. The first one is on its way to your Inbox.`);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

/** Usage: what the AI models cost, day by day, and which model and who it went to. */
async function usageView() {
  const span = [7, 30, 90, 365].includes(ui.usageDays) ? ui.usageDays : 30;
  const pick = h("select", { id: "usage-days", "aria-label": "Period", onchange: (e) => ((ui.usageDays = Number(e.target.value)), usageView()) }, [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"]].map(([v, label]) => h("option", { value: v, selected: v === span }, label)));
  const body = h("div", { class: "usagebody" });
  const col = page("Usage", "What your AI models were asked to do and what it cost, day by day, and which model and who it went to.", h("div", { class: "row" }, h("span", { class: "grow" }), pick), body);
  const u = await attempt(() => api("GET", `usage?days=${span}`), col);
  if (!u || state.view !== "usage") return;
  if (!u.since) return fill(body, h("div", { class: "card" }, h("b", {}, "Nothing to show yet."), h("p", { class: "note" }, "Each time a model answers, from now on, it is counted here: which model, who asked, and what it cost.")));
  const tokens = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const top = Math.max(...u.byDay.map((d) => d.cost), 0.0001);
  const dayWords = (key) => new Date(`${key}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });
  const fact = (value, label) => h("div", { class: "usagefact" }, h("b", {}, value), h("span", {}, label));
  const table = (title, firstHead, rows) =>
    h(
      "section",
      { class: "usagepart" },
      h("h3", {}, title),
      rows.length
        ? h("div", { class: "tablewrap" }, h("table", { class: "autotable" }, h("thead", {}, h("tr", {}, [firstHead, "Answers", "Sent", "Written", "Cost"].map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, h("b", {}, r.name)), h("td", { class: "autonum" }, String(r.calls)), h("td", { class: "autonum" }, `${tokens(r.input + r.cached)} tokens`), h("td", { class: "autonum" }, `${tokens(r.output)} tokens`), h("td", { class: "autonum" }, money(r.cost)))))))
        : h("p", { class: "note" }, "Nothing in this period."),
    );
  fill(
    body,
    h("div", { class: "usagefacts" }, fact(money(u.total.cost), "spent in this period"), fact(String(u.total.calls), u.total.calls === 1 ? "answer from a model" : "answers from models"), fact(tokens(u.total.input + u.total.cached), "tokens sent"), fact(tokens(u.total.output), "tokens written")),
    h(
      "section",
      { class: "usagepart" },
      h("h3", {}, "Day by day"),
      h(
        "div",
        { class: "usagechart", role: "img", "aria-label": `Cost for each of the last ${u.byDay.length} days. The most in one day was ${money(top)}.` },
        u.byDay.map((d) => h("div", { class: "usagebar", title: `${dayWords(d.day)}: ${money(d.cost)}, ${d.calls} answer${d.calls === 1 ? "" : "s"}` }, h("i", { style: `height: ${d.cost ? Math.max(3, Math.round((d.cost / top) * 100)) : 0}%` }))),
      ),
      h("div", { class: "usageaxis" }, h("span", {}, dayWords(u.byDay[0].day)), h("span", {}, `Most in a day: ${money(top < 0.001 ? 0 : top)}`), h("span", {}, dayWords(u.byDay.at(-1).day))),
    ),
    table("By AI model", "Model", u.models),
    table("By who asked", "Who", u.who),
    h("p", { class: "note small" }, `Counted since ${dayWords(u.since)}. Costs are estimates from each service's list prices; your bill from the service is what counts.${u.unpriced ? " A model with no known price shows its tokens and $0.00." : ""} Nothing that was said is kept here.`),
  );
}

/** Automations: every automation and briefing in one table, with a history of runs and the ready-made ones a press away. */
async function jobsView() {
  const TABS = [["all", "All"], ["active", "Active"], ["paused", "Paused"], ["runs", "Run history"], ["ready", "Ready-made"]];
  const tab = TABS.some(([id]) => id === ui.autoTab) ? ui.autoTab : "all";
  const tabs = h("div", { class: "autotabs", role: "tablist", "aria-label": "Automations" });
  const body = h("div", { class: "autobody" });
  const add = h("button", { class: "primary", onclick: () => ((ui.autoTab = "new"), jobsView()) }, "+ New automation");
  const col = page(
    "Automations",
    "Work that runs by itself: a morning news digest, a weekly report, a check that your website is up. Each one belongs to a position on your team, or to the assistant.",
    h("div", { class: "autobar" }, tabs, add),
    body,
    h("p", { class: "note small" }, "Automations run while Talqava is open. In the Mac app, closing the window keeps Talqava running; choosing Quit stops it. A run missed while it was stopped happens once when you open Talqava again."),
  );
  const [jobs, data] = await Promise.all([attempt(() => api("GET", "jobs"), col), api("GET", "jobs/briefings").catch(() => null)]);
  if (!jobs || state.view !== "jobs") return;
  state.briefings = data ?? state.briefings;
  const briefOf = (j) => (j.briefing ? data?.briefings.find((b) => b.id === j.briefing) : null);
  const count = { all: jobs.length, active: jobs.filter((j) => j.enabled).length, paused: jobs.filter((j) => !j.enabled).length, ready: data?.briefings.length ?? 0 };
  fill(tabs, TABS.map(([id, label]) => h("button", { class: `autotab ${tab === id ? "on" : ""}`, role: "tab", "aria-selected": String(tab === id), onclick: () => ((ui.autoTab = id), jobsView()) }, label, count[id] !== undefined ? h("span", { class: "autocount" }, String(count[id])) : null)));
  const again = () => jobsView();
  const act = (fn, done) => attempt(async () => (await fn(), done && toast(done), again()), col);

  // A new one, written by hand: the form takes the page until it is saved or cancelled.
  if (ui.autoTab === "new") {
    add.hidden = true;
    return fill(body, h("div", { class: "card form" }, h("h3", {}, "New automation"), scheduleForm(col, null, () => ((ui.autoTab = "all"), jobsView())), h("button", { class: "plain", onclick: () => ((ui.autoTab = "all"), jobsView()) }, "Cancel")), h("p", { class: "note" }, "Or switch on a ready-made one: ", h("button", { class: "plain link", onclick: () => ((ui.autoTab = "ready"), jobsView()) }, `see all ${count.ready}`), "."));
  }
  if (tab === "ready") {
    const gallery = h("section", { class: "briefgallery" });
    fill(body, gallery);
    return data ? briefingGallery(gallery, data, col) : fill(gallery, h("p", { class: "note" }, "The ready-made automations could not be loaded. Try again."));
  }
  if (tab === "runs") {
    const runs = await attempt(() => api("GET", "jobs/runs"), col);
    if (!runs || state.view !== "jobs") return;
    if (!runs.length) return fill(body, h("p", { class: "note" }, "Nothing has run yet. Each run is listed here from now on, with what it made."));
    return fill(
      body,
      h(
        "div",
        { class: "tablewrap" },
        h(
          "table",
          { class: "autotable" },
          h("thead", {}, h("tr", {}, ["Automation", "When", "Result", "Cost", ""].map((x) => h("th", {}, x)))),
          h(
            "tbody",
            {},
            runs.map((r) =>
              h(
                "tr",
                {},
                h("td", {}, h("b", {}, r.name), r.gone ? h("span", { class: "autoby" }, "Since deleted") : null),
                h("td", { class: "autonum" }, when(r.at)),
                h("td", {}, h("span", { class: `autoout ${OUTCOME_WORDS[r.outcome]?.[1] ?? ""}` }, OUTCOME_WORDS[r.outcome]?.[0] ?? "Done"), h("span", { class: r.outcome === "failed" || r.outcome === "skipped" ? "autobad" : "autoby" }, r.words ?? "")),
                h("td", { class: "autonum" }, r.cost >= 0.0005 ? money(r.cost) : r.outcome === "done" ? "free" : "—"),
                h("td", { class: "autoend" }, r.taskId ? h("button", { class: "small", onclick: () => ((ui.taskOpen = r.taskId), go("tasks")) }, "Open") : r.conversationId ? h("button", { class: "small", onclick: () => go("chat", r.conversationId) }, "Open") : null),
              ),
            ),
          ),
        ),
      ),
    );
  }
  const shown = jobs.filter((j) => (tab === "active" ? j.enabled : tab === "paused" ? !j.enabled : true));
  if (!shown.length) {
    return fill(
      body,
      h("div", { class: "card autoempty" }, h("b", {}, tab === "all" ? "Nothing runs by itself yet." : tab === "active" ? "Nothing is switched on." : "Nothing is paused."), tab === "all" ? h("p", { class: "note" }, "Start with a ready-made one, such as the Monday plan (free) or the morning news.") : null, tab === "all" ? h("div", { class: "row" }, h("button", { class: "primary", onclick: () => ((ui.autoTab = "ready"), jobsView()) }, "See the ready-made ones")) : null),
    );
  }
  const row = (j) => {
    const b = briefOf(j);
    const who = b ? `${b.kind === "free" ? "No AI model" : j.ownerName ? `${j.ownerName}${b.model ? ` · ${b.model.split("/").pop()}` : ""}` : "A position no longer on the chart"}${b.review ? " · drafts, you decide" : ""}${b.quiet ? " · quiet unless there is news" : ""}` : j.owner ? (j.ownerName ? `${j.ownerName}, as a task in their queue` : "Its position is no longer on the chart, so the assistant does it") : `${state.config.agentName}, in a chat`;
    const toggle = h("button", { class: `autotoggle ${j.enabled ? "on" : ""}`, role: "switch", "aria-checked": String(j.enabled), "aria-label": `${j.name}: ${j.enabled ? "on" : "paused"}`, title: j.enabled ? "On. Press to pause." : "Paused. Press to switch on.", onclick: () => act(() => api("PATCH", `jobs/${j.id}`, { enabled: !j.enabled }), `${j.name} is ${j.enabled ? "paused" : "on"}.`) });
    const menu = h("details", { class: "automenu" }, h("summary", { "aria-label": `More for ${j.name}`, title: "More" }, "⋯"));
    const pick = (label, run, cls = "") => h("button", { class: `plain ${cls}`, onclick: () => (menu.removeAttribute("open"), run()) }, label);
    const edit = h("tr", { class: "autoedit", hidden: true }, h("td", { colspan: 7 }));
    menu.append(
      h(
        "div",
        { class: "automenulist" },
        pick(b ? "Send one now" : "Run now", () =>
          attempt(async () => {
            const r = await api("POST", `jobs/${j.id}/run`, {});
            if (r.skipped) return toast(r.skipped), again();
            if (b) return toast("One is on its way to your Inbox.");
            if (r.taskId) (ui.taskOpen = r.taskId), go("tasks");
            else if (r.conversationId) go("chat", r.conversationId);
          }, col),
        ),
        pick(j.limit ? `Monthly limit: ${money(j.limit)}…` : "Set a monthly limit…", async () => {
          const box = h("input", { id: "auto-limit", inputmode: "decimal", value: j.limit ? String(j.limit) : "", placeholder: "No limit", "aria-label": "Most it may spend a month, in US dollars" });
          const said = await libDialog(`The most “${j.name}” may spend a month`, h("div", { class: "composeform" }, h("label", {}, "US dollars a month", box), h("p", { class: "note small" }, `So far this month: ${money(j.spent || 0)}. Once it reaches the limit, its timed runs are left out until the month turns or you raise it, and your Inbox says so. Leave it empty for no limit of its own.`)), [["Save", () => ({ v: box.value.trim() }), true]]);
          if (said) act(() => api("PATCH", `jobs/${j.id}`, { limit: said.v === "" ? null : Number(said.v.replace(/^\$/, "")) }), said.v === "" ? "It has no limit of its own now." : "Limit saved.");
        }),
        pick("Edit", () => (b ? briefingEdit(b).then((ok) => ok && again()) : ((edit.hidden = false), fill(edit.firstChild, h("div", { class: "card form" }, h("h4", {}, `Change “${j.name}”`), scheduleForm(col, j, again)))))),
        j.lastTaskId ? pick("Open the last run", () => ((ui.taskOpen = j.lastTaskId), go("tasks"))) : j.lastConversationId ? pick("Open the last run", () => go("chat", j.lastConversationId)) : null,
        pick(b ? "Switch off for good" : "Delete", () => confirm(b ? `Switch ${j.name} off for good? You can switch it on again later.` : `Delete the automation “${j.name}”?\n\nPast runs are kept.`) && act(() => api("DELETE", b ? `jobs/briefings/${b.id}` : `jobs/${j.id}`), b ? `${j.name} is switched off.` : "Deleted."), "danger"),
      ),
    );
    return [
      h(
        "tr",
        { class: j.enabled ? "" : "paused" },
        h("td", {}, h("div", { class: "autofirst" }, h("span", { class: `autodot ${j.enabled ? "on" : ""}`, "aria-hidden": "true" }), h("div", { class: "autoname" }, h("b", {}, j.name), h("span", { class: "autoby" }, who)))),
        h("td", {}, b?.when ?? j.plain),
        h("td", { class: "autonum" }, j.enabled ? when(j.nextRunAt) : "paused"),
        h("td", { class: "autonum" }, j.lastRunAt ? when(j.lastRunAt) : "not yet", j.last && j.last.outcome !== "done" ? h("span", { class: `autoout ${OUTCOME_WORDS[j.last.outcome]?.[1] ?? ""}`, title: j.last.words }, OUTCOME_WORDS[j.last.outcome]?.[0]) : null),
        h("td", { class: "autonum", title: costWords(j.costs) }, costWords(j.costs, { short: true }), j.limit ? h("span", { class: `autoby ${(j.spent || 0) >= j.limit ? "autobad" : ""}` }, `${money(j.spent || 0)} of ${money(j.limit)} this month`) : null),
        h("td", { class: "autoend" }, toggle),
        h("td", { class: "autoend" }, menu),
      ),
      edit,
    ];
  };
  fill(body, h("div", { class: "tablewrap" }, h("table", { class: "autotable" }, h("thead", {}, h("tr", {}, ["Name", "When", "Next run", "Last run", "Cost", "", ""].map((x) => h("th", {}, x)))), h("tbody", {}, shown.flatMap(row)))));
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
    const connectedIds = new Set<any>(live.map((c) => c.service));
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
                  h("div", { class: "row" }, serviceTile(c.name), h("strong", {}, c.name), c.inUse ? h("span", { class: "tag ok" }, "Your team's model") : null),
                  // A model program on this computer is checked now: it may have been closed, or have no models yet.
                  c.live
                    ? h(
                        "div",
                        { class: `note small ${c.live.running && c.live.models ? "" : "warnline"}` },
                        !c.live.running ? `Not running right now. Start ${c.name} to use it.` : c.live.models ? `Running · ${c.live.models} model${c.live.models === 1 ? "" : "s"} on this computer` : `Running, but no models downloaded yet. Download one in ${c.name}, then press Models.`,
                      )
                    : c.health && !c.health.ok
                      ? h("div", { class: "note small warnline" }, `Not working: ${c.health.problem}`)
                      : h("div", { class: "note small" }, [c.address ? short(c.address) : "Connected with your key", c.keys > 1 ? `${c.keys} keys, taking turns` : null, c.health?.ok ? `working, checked ${shortWhen(new Date(c.health.checkedAt).toISOString())}` : null].filter(Boolean).join(" · ")),
                ),
                h("button", { class: "small", onclick: () => modelsDialog(c) }, "Models"),
                // More keys for the same service spread the work and keep going when one reaches its rate limit.
                c.hasKey && !c.local && c.service !== "vertex" && c.service !== "anthropic"
                  ? h("button", { class: "small plain", title: "Work is spread across the keys, and when one reaches its rate limit the others keep going.", onclick: () => {
                      const key = prompt(`Paste another ${c.name} key.\n\nWork is spread across the keys, and when one reaches its rate limit the others keep going.`);
                      if (key && key.trim()) attempt(async () => (await api("POST", `gateway/${encodeURIComponent(c.id)}/keys`, { key: key.trim() }), toast(`${c.name} now has another key.`), refresh()), col);
                    } }, "+ Key")
                  : null,
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
                  h("div", { class: "aicardhead" }, serviceTile(s.name), h("strong", { class: "grow" }, s.name), on ? h("span", { class: "tag ok" }, "Connected") : null),
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
    const options: any[] = [];
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
      h("p", { class: "note small" }, `If ${modelName(g.model)} cannot answer (its service is down, busy or out of credit), the first backup answers instead, then the next. Each switch is noted in the activity log.`),
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
    // Google Vertex AI takes the service account's key file, not a pasted key: the file is read here and sent as text.
    const keyFile = s.id === "vertex" ? h("input", { type: "file", accept: ".json,application/json", "aria-label": "Service account key file (.json)" }) : null;
    const key = keyFile ? { value: "" } : s.needsKey || s.id === "custom" || s.id === "litellm" ? h("input", { type: "password", autocomplete: "off", placeholder: s.keyPrefix ? `${s.keyPrefix}…` : s.needsKey ? "Paste the key" : "Key, if it needs one", "aria-label": "Key" }) : null;
    keyFile?.addEventListener("change", async () => (key.value = keyFile.files?.[0] ? await keyFile.files[0].text() : ""));
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
      keyFile ? h("label", {}, "Service account key file (.json)", keyFile) : key,
      keyFile ? h("p", { class: "note small" }, "In Google Cloud: IAM → Service accounts → choose or create one with the Vertex AI User role → Keys → Add key → JSON. The file is kept on this computer; only a signed sign-in request goes to Google.") : null,
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
                    [m.tools === true ? "Works for agents" : m.tools === false ? "Cannot use tools" : "Not known if it can use tools", m.contextTokens ? `holds ${Math.round(m.contextTokens / 1000)}k tokens` : null, m.memory ? `${(m.memory.bytes / 1024 ** 3).toFixed(1)} GB` : null, m.prices ? (m.prices.input === 0 && m.prices.output === 0 ? "free" : `${money(m.prices.input)} in · ${money(m.prices.output)} out`) : null].filter(Boolean).join(" · "),
                  ),
                  m.memory?.fit === "too-big" ? h("div", { class: "note small bad" }, "Too big for this computer's memory: it would be very slow or not run. Choose a smaller one.") : m.memory?.fit === "tight" ? h("div", { class: "note small warn" }, "Only just fits in this computer's memory: close other apps while it works.") : null,
                ),
                g.model === `${c.id}/${m.id}`
                  ? h("span", { class: "tag ok" }, "In use")
                  : h("button", { class: "small", onclick: () => (m.memory?.fit !== "too-big" || confirm(`${m.id} is too big for this computer's memory, so it would be very slow or not run at all.\n\nUse it anyway?`)) && use(m.id) }, "Use for my team"),
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
  const col = page("Settings", "How your agents work, what they may spend, and how Talqava looks. AI models and other services are connected under Connections, in the account menu at the bottom left.");
  const save = (patch) =>
    attempt(async () => {
      state.config = await api("PUT", "settings", patch);
      document.title = state.config.agentName;
      renderSide();
      settingsView();
    }, col);
  const select = (options, value) => h("select", {}, options.map(([id, label]) => h("option", { value: id, selected: id === value }, label)));

  if (needsKey(c)) {
    col.append(h("div", { class: "banner" }, "To get started, connect an AI service: ", h("button", { class: "plain link", onclick: () => ((ui.integration = "ai-models"), go("integrations")) }, "Connections → AI models"), ". Anthropic (Claude), OpenAI, Google Gemini and many more, or free models on this computer."));
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
        const on = (window.talqavaTheme?.choice ?? "dark") === id;
        return h("button", { class: on ? "on" : "", role: "radio", "aria-checked": String(on), onclick: () => (window.talqavaTheme?.set(id), drawTheme()) }, h("span", { class: `themeswatch ${id}`, "aria-hidden": "true" }), label);
      }),
    );
  drawTheme();
  col.append(
    h("h3", {}, "Look"),
    h("p", { class: "note" }, "Appearance. Dark is the standard look; Match my computer switches between light and dark with it."),
    themeRow,
    h("p", { class: "note" }, "Accent colour: ", accentLabel, ". Used for buttons and highlights. Each agent is shown as a tile in its department's colour, with a symbol for its role; you can change both when you edit the agent."),
    accentRow,
  );


  const name = h("input", { value: c.agentName });
  const ref = () => c.model;
  const effort = select(c.efforts.map((e) => [e, e]), c.effort);
  const savings = select([["off", "Off: every agent uses my model"], ["balanced", "Balanced: match the model to the work"], ["cheapest", "Cheapest: cheaper models wherever they can do it"]], c.savings ?? "off");
  const checkFirst = select([["on", "On: check first, and ask me if something is missing"], ["off", "Off: start without checking"]], c.checkFirst === false ? "off" : "on");
  const privacy = select([["off", "Off: send conversations as they are"], ["mask", "On: hide email addresses, phone and card numbers"]], c.privacy ?? "off");
  const checkIn = select([["on", "On: one message a day in my Inbox"], ["off", "Off"]], c.checkIn === false ? "off" : "on");
  const moveUp = select([["on", "On: try once with a stronger model I set up"], ["off", "Off: stop and leave a hand-over note"]], c.moveUp === false ? "off" : "on");
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
  const monthlyAll = h("input", { type: "number", min: 0, max: 100000, step: 1, value: c.monthlyBudget ?? "", placeholder: "No limit" });

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
      checkButton.textContent = /^(local|ollama|lmstudio|llamacpp|jan|vllm)\//.test(ref()) ? "Checking… a model on this computer can take a minute to load" : "Checking…";
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
          save({ agentName: name.value, effort: effort.value, savings: savings.value, checkFirst: checkFirst.value === "on", planFirst: planFirst.value, privacy: privacy.value, moveUp: moveUp.value === "on", checkIn: checkIn.value === "on", approvalMode: mode.value, budget: { steps: Number(steps.value), spend: spend.value === "" ? null : Number(spend.value) }, monthlyBudget: monthlyAll.value === "" ? null : Number(monthlyAll.value) })
        ),
      },
      h("label", {}, "Name", name),
      // The team's model is chosen in one place, under Connections → AI models; here it is shown, and checked.
      h(
        "div",
        { class: "row wrap" },
        h("span", { class: "grow" }, "Your team's model: ", h("b", {}, c.model.slice(c.model.indexOf("/") + 1)), ` · ${c.providers.find((p) => p.id === c.model.slice(0, c.model.indexOf("/")))?.name ?? ""}`),
        h("button", { type: "button", class: "small", onclick: () => ((ui.integration = "ai-models"), go("integrations")) }, "Change it under Connections → AI models"),
      ),
      h("div", { class: "row" }, checkButton),
      checkBox,
      h("label", {}, "Effort, for Claude (higher thinks longer and costs more)", effort),
      h("h4", {}, "Before a task starts"),
      h("p", { class: "note small" }, "Two separate steps, in this order. Step 1 asks whether the agent has what it needs; step 2 asks whether you agree with how it will do the work."),
      h("label", {}, "1. Missing information check", checkFirst),
      h("p", { class: "note small" }, "The agent first checks it has what your task needs (information, a repository, documents, access). If something is missing, it asks you in your Inbox instead of spending money guessing. The check costs a few cents at most and shows on the receipt."),
      h("label", {}, "2. Plan for your approval", planFirst),
      h("p", { class: "note small" }, "The agent looks into the task and sends you a plan: the steps, who does each, and its cost estimate. It changes nothing and hands nothing on until you approve it, or ask for changes. A lead is an agent with people reporting to it."),
      h("h4", {}, "Models and cost"),
      h("label", {}, "Cost saving for your team of agents", savings),
      h("p", { class: "note small" }, "Balanced, with Claude Opus or Fable as your model: managers who plan and check keep your model, team members doing their own part use Claude Sonnet 5.5 (about half the price), and quick questions between agents use Claude Haiku 5.5 (about a fortieth). Cheapest also gives managers Sonnet. With another service, the cheaper models come from your backup models, so Talqava never uses a model you didn't choose. An agent you gave a model of its own keeps it, a stuck task can still move up, and the receipt shows which model did each step. Off uses your model for everything."),
      h("label", {}, "Leads' daily check-in", checkIn),
      h("p", { class: "note small" }, "Each day your Inbox gets one message: for every group, what moved since yesterday, what is stuck or waiting on you, and what is next. It is built from your tasks, so it costs nothing."),
      h("label", {}, "When a task gets stuck", moveUp),
      h("p", { class: "note small" }, "Stuck means trying the same step again and again, or every step failing. With this on, the task first carries on once with the strongest model you set up (your team's model or a backup) that costs clearly more than the one in use, within the same budget. A model on this computer never moves up to one online. The receipt shows which model did each step."),
      h("label", {}, "Privacy: hide personal details from AI services", privacy),
      h("p", { class: "note small" }, "With this on, email addresses, phone numbers, card numbers and US Social Security numbers are replaced with placeholders such as [EMAIL 1] before anything is sent to an AI service, and put back in the answer, so an agent can still email the right person. Your chats keep the real details. It doesn't catch names, street addresses or details inside pictures, and models on this computer send nothing out, so they see everything."),
      h("label", {}, "Approvals", mode),
      h("p", { class: "note" }, "With “ask”, an automation that needs approval waits until you open its chat and answer. “Run everything” is only sensible when the agent runs in Docker or on a machine with nothing you'd mind losing."),
      h("h4", {}, "Budgets"),
      h("label", {}, "Steps per run (model calls)", steps),
      h("label", {}, "Budget per task, in US dollars", spend),
      h("p", { class: "note small" }, "Budget per task: the most one task and everything handed on from it may spend together; each run of an agent stops there too. A run stops before going over either limit, and you can say “continue”. Agents and groups can have their own limits on their pages."),
      h("label", {}, "Monthly budget for all agents together, in US dollars", monthlyAll),
      h("p", { class: "note small" }, "When all your agents together reach it in a calendar month, none starts new work until you raise it or the month turns. Leave it empty for no limit. Spend is estimated from list prices; your provider's bill is the real figure."),
      h("div", {}, h("button", { class: "primary" }, "Save")),
    ),
  );

  // Each setting shows its choice; a long explanation folds under "What this does", so the page can be read at a glance.
  for (const note of [...col.querySelectorAll("p.note")] as any[]) {
    if (note.textContent.length < 170 || note.closest("details")) continue;
    const fold = h("details", { class: "why" }, h("summary", {}, "What this does"));
    note.replaceWith(fold);
    fold.append(note);
  }

  // About Talqava, its licence, privacy policy, terms and other policies.
  const legal = h("div", { class: "legallinks" });
  api("GET", "legal").then((docs) => legal.isConnected && fill(legal, docs.map((d) => h("button", { class: "small", onclick: () => showLegal(d.id) }, d.title)))).catch(() => {});
  col.append(
    h("h3", {}, "About and legal"),
    h("p", { class: "note" }, "Talqava is open-source software under the MIT licence, developed by GR Investments LLC. It runs on your computer and sends nothing to us: your data goes only to the services you connect, such as your AI model provider."),
    h("p", { class: "note small" }, TRADEMARKS),
    h("p", { class: "note small" }, "Files your agents work on are kept in ", h("code", {}, c.workspace), ". Everything else Talqava knows is in ", h("code", {}, c.dataDir), "."),
    legal,
  );
  // Last on the page: the parts of Talqava that are set aside.
  col.append(
    h("h3", {}, "Labs"),
    h("p", { class: "note" }, "Parts of Talqava that are set aside to keep it simple. Switch one on to show it. Nothing is deleted when one is off: whatever you made with it is kept, and agents can still use it."),
    h(
      "div",
      { class: "labslist" },
      LABS.map(([id, name, about]) =>
        h(
          "label",
          { class: "power lab" },
          h("input", {
            type: "checkbox",
            checked: lab(id),
            onchange: (e) => attempt(async () => ((state.config = await api("PUT", "settings", { labs: LABS.map(([x]) => x).filter((x) => (x === id ? e.target.checked : lab(x))) })), renderTop(), renderAreaTabs(), toast(`${name}: ${e.target.checked ? "shown" : "set aside"}.`)), col),
          }),
          h("span", {}, h("b", {}, name), h("span", { class: "note small" }, about)),
        ),
      ),
    ),
  );
}

/** Said wherever other companies' services are named: their names are used only to say Talqava works with them. */
const TRADEMARKS = "Product and company names are trademarks of their owners and are used only to say which services Talqava can connect to. Talqava is not affiliated with or endorsed by them.";

/**
 * A small tile for an AI service, in Talqava's own style: its initials on the brand's dark tile. Companies' own logos
 * are not shown; most of their brand rules allow their names in text, but not their logos without permission.
 */
function serviceTile(name) {
  const words = String(name).replace(/\(.*\)/, "").trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  return h("span", { class: "svctile", "aria-hidden": "true" }, letters);
}

boot();

// ---------- the workspace: pages the owner and the agents share ----------
// A tree of pages on the left; a page on the right, edited in place and saved as you type. Agents read pages,
// file their results as pages, and suggest changes that wait here (and in the inbox) for the owner.
let editorModule = null;
// The page editor is one bundled file (see public/vendor/editor.LICENSES.txt); it has no types of its own.
const EDITOR_FILE: string = "/vendor/editor.js";
const loadEditor = () => (editorModule ??= import(EDITOR_FILE));

/** Opens the workspace, at a page or at its home. */
async function openPage(id) {
  ui.ws ??= { collapsed: new Set<any>() };
  // A document or a note opens in Office; a page opens in the Workspace.
  let kind = "page";
  if (id) kind = await api("GET", `workspace/pages/${id}`).then((p) => p.kind).catch(() => (ui.ws.data?.tree ?? []).find((p) => p.id === id)?.kind ?? "page");
  const host = kind === "doc" ? "docs" : kind === "note" ? "notes" : kind === "sheet" ? "sheets" : kind === "deck" ? "slides" : "workspace";
  ui.ws.host = host;
  ui.ws.open = id;
  if (state.view !== host) go(host);
  else wsReload();
}

/** Draws again whichever screen is showing the page editor. */
const wsReload = () => (ui.ws?.host === "docs" ? docsView() : ui.ws?.host === "notes" ? notesView() : ui.ws?.host === "sheets" ? sheetsView() : ui.ws?.host === "slides" ? slidesView() : workspaceView());

async function workspaceView() {
  ui.ws ??= { collapsed: new Set<any>() };
  ui.ws.host = "workspace";
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
  const kids = new Map<any, any>();
  for (const p of tree) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)).push(p);
  const byId = new Map<any, any>(tree.map((p) => [p.id, p]));
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
    deleted.length
      ? h(
          "details",
          { class: "wsdeleted" },
          h("summary", { class: "note small" }, `Deleted (${deleted.length})`),
          h("p", { class: "note small" }, "Deleted pages can be restored for 30 days, then they are removed for good."),
          deleted.map((d) => h("div", { class: "row" }, h("span", { class: "grow small", title: `${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left to restore it` }, d.title), h("button", { class: "plain small", onclick: () => attempt(async () => (await api("POST", `workspace/pages/${d.id}/restore`), workspaceView()), side) }, "Restore"))),
          h("button", { class: "plain small danger", onclick: () => confirm(`Remove all ${deleted.length} deleted page${deleted.length === 1 ? "" : "s"} for good?\n\nTheir text and history are gone, and they cannot be restored.`) && attempt(async () => (await api("DELETE", "workspace/pages/deleted"), workspaceView()), side) }, "Empty deleted"),
        )
      : null,
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
  const parts = [...a.departments, ...a.agents.map((id) => activeOrg()?.members?.find((m) => m.bot === id)?.title ?? state.crew?.bots.find((b) => b.id === id)?.name ?? id)];
  return parts.length ? `Only ${parts.join(", ")}` : "Nobody but you";
}

/** Icons for pages, each with words to find it by. */
const PAGE_ICONS = [
  ["📄", "page document"], ["📝", "note memo write"], ["📋", "checklist procedure clipboard"], ["✅", "done check task"], ["📌", "pin important"],
  ["📎", "attachment clip"], ["📚", "library books handbook"], ["📖", "guide manual read"], ["🗂️", "folder files index"], ["🗃️", "archive records"],
  ["📊", "report chart numbers"], ["📈", "growth sales up"], ["📉", "down decline"], ["💰", "money finance budget"], ["💳", "payment card billing"],
  ["🧾", "receipt invoice"], ["🏦", "bank accounts"], ["🛒", "shop order cart"], ["📦", "product shipping stock inventory"], ["🚚", "delivery logistics"],
  ["🤝", "deal partner customer"], ["👥", "team people staff"], ["🧑‍💼", "hiring employee manager"], ["🎓", "training learning onboarding"], ["💬", "chat support conversation"],
  ["📞", "call phone contact"], ["✉️", "email letter"], ["📣", "marketing announce"], ["🎯", "goal target"], ["🗓️", "calendar schedule plan"],
  ["⏰", "deadline time"], ["⚖️", "legal law policy contract"], ["🔒", "private security"], ["🛡️", "safety risk compliance"], ["⚙️", "settings operations process"],
  ["🛠️", "tools fix maintenance"], ["💻", "software computer it"], ["🧪", "test experiment research"], ["💡", "idea"], ["🏠", "home start"],
  ["🏢", "company office"], ["🌍", "world international"], ["🍽️", "restaurant menu food"], ["☕", "cafe coffee"], ["🏥", "health medical"],
  ["❤️", "nonprofit care donors"], ["⭐", "favourite star quality"], ["🚀", "launch project"], ["🔥", "urgent priority"], ["❓", "question faq help"],
];

/**
 * A small picker of page icons: search by words, choose with the mouse or the keyboard (arrows, Enter, Escape),
 * or type any emoji into the search box and press Enter.
 */
function iconPicker(anchor, current, choose) {
  document.querySelector(".iconpicker")?.remove();
  const search = h("input", { type: "search", placeholder: "Find an icon, or type an emoji", "aria-label": "Find an icon" });
  const grid = h("div", { class: "icongrid", role: "listbox", "aria-label": "Icons" });
  const box = h("div", { class: "iconpicker", role: "dialog", "aria-label": "Choose an icon" }, search, grid, h("div", { class: "row" }, h("button", { class: "plain small", onclick: () => done("") }, "No icon"), h("span", { class: "grow" }), h("button", { class: "plain small", onclick: () => close() }, "Cancel")));
  let shown = PAGE_ICONS;
  let at = 0;
  const close = () => (box.remove(), document.removeEventListener("pointerdown", outside, true), anchor.focus());
  const done = (icon) => (close(), choose(icon));
  const outside = (e) => !box.contains(e.target) && e.target !== anchor && close();
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    shown = q ? PAGE_ICONS.filter(([icon, words]) => words.includes(q) || icon === q) : PAGE_ICONS;
    at = Math.min(at, Math.max(0, shown.length - 1));
    fill(grid, shown.length ? shown.map(([icon, words], i) => h("button", { class: `iconcell ${i === at ? "on" : ""} ${icon === current ? "current" : ""}`, role: "option", "aria-selected": String(i === at), title: words, onclick: () => done(icon) }, icon)) : h("p", { class: "note small" }, "None match. Press Enter to use what you typed."));
  };
  search.addEventListener("input", () => ((at = 0), draw()));
  search.addEventListener("keydown", (e) => {
    const cols = 8;
    if (e.key === "Escape") return e.preventDefault(), close();
    if (e.key === "Enter") return e.preventDefault(), shown.length ? done(shown[at][0]) : search.value.trim() && done(search.value.trim());
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move) e.preventDefault(), (at = Math.max(0, Math.min(shown.length - 1, at + move))), draw();
  });
  const r = anchor.getBoundingClientRect();
  box.style.top = `${r.bottom + window.scrollY + 6}px`;
  box.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 340))}px`;
  document.body.append(box);
  document.addEventListener("pointerdown", outside, true);
  draw();
  search.focus();
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
  if (state.view !== (ui.ws.host ?? "workspace") || ui.ws.open !== id) return;
  const office = page.kind === "doc" || page.kind === "note";
  const kindWord = page.kind === "doc" ? "document" : page.kind === "note" ? "note" : "page";
  const byId = new Map<any, any>(ui.ws.data.tree.map((p) => [p.id, p]));
  const trail: any[] = [];
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
        fill(conflict, h("div", { class: "banner error" }, err.message, " ", h("button", { class: "small", onclick: () => wsReload() }, "Reload")));
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
    if (office) return ui.ws.refreshSide?.();
    ui.ws.data = await api("GET", "workspace");
    renderWsTree(document.querySelector(".wsside"));
  }, col);
  title.addEventListener("change", saveTitle);
  title.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveTitle(), ui.wsEditor?.focus("start")));
  const iconBtn = h("button", { class: "plain wspageicon", title: "Change the icon", "aria-label": "Change the page's icon", "aria-haspopup": "dialog", onclick: () =>
    iconPicker(iconBtn, page.icon || "", (next) => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { icon: next }), wsReload()), col)),
  }, page.icon || "📄");

  // ----- the editor, its toolbar and the slash menu -----
  const surface = h("div", { class: "wseditor md" });
  const menu = h("div", { class: "wsslash", role: "listbox", "aria-label": "Blocks", hidden: true });
  let menuItems: any[] = [];
  let menuAt = 0;
  // The same menu offers blocks after "/" and pages after "[[".
  let menuKind = "block";
  const pickItem = (item) => (menuKind === "page" ? ui.wsEditor.linkPage(item.id, item.label) : ui.wsEditor.block(item.id));
  const drawLinkMenu = (query, at) => {
    menuKind = "page";
    menuItems = (ui.ws.data?.tree ?? [])
      .filter((p) => p.id !== id && (!query || p.title.toLowerCase().includes(query)))
      .slice(0, 8)
      .map((p) => ({ id: p.id, label: p.title || "Untitled", hint: p.icon || "📄" }));
    if (!menuItems.length) return (menu.hidden = true);
    menuAt = Math.min(menuAt, menuItems.length - 1);
    fill(menu, h("div", { class: "note small wsslashhead" }, "Link to a page"), menuItems.map((p, i) => h("button", { class: `wsslashitem ${i === menuAt ? "on" : ""}`, role: "option", "aria-selected": String(i === menuAt), onmousedown: (e) => (e.preventDefault(), pickItem(p)) }, h("span", {}, p.hint), " ", h("b", {}, p.label))));
    const box = col.getBoundingClientRect();
    menu.style.left = `${Math.max(0, at.left - box.left)}px`;
    menu.style.top = `${at.bottom - box.top + col.scrollTop + 6}px`;
    menu.hidden = false;
  };
  const drawMenu = (query, at) => {
    menuKind = "block";
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
        [...menu.querySelectorAll(".wsslashitem")].forEach((c, i) => (c.classList.toggle("on", i === menuAt), c.setAttribute("aria-selected", String(i === menuAt))));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        pickItem(menuItems[menuAt]);
      } else if (e.key === "Escape") {
        menu.hidden = true;
      }
    },
    true,
  );
  const tool = (kind, label, name) => h("button", { class: "plain small wstool", title: name, "aria-label": name, onmousedown: (e) => e.preventDefault(), onclick: () => (kind === "link" ? ((url) => url !== null && ui.wsEditor.format("link", url.trim()))(prompt("Link to (leave empty to remove the link):", "https://")) : ui.wsEditor.format(kind)) }, label);
  const toolbar = h("div", { class: "wstoolbar" }, tool("bold", h("b", {}, "B"), "Bold"), tool("italic", h("i", {}, "I"), "Italic"), tool("strike", h("s", {}, "S"), "Strike through"), tool("code", h("code", {}, "<>"), "Code"), tool("link", "🔗", "Link"), h("span", { class: "note small wshintkey" }, "Type / for headings and lists, [[ to link a page"), h("span", { class: "grow" }), status);

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
            wsReload();
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
  const groups = [...new Set<any>((org.groups ?? []).map((g) => g.name).concat(org.members.map((m) => m.department)))].filter(Boolean).sort();
  const patch = (body) => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, body), wsReload()), col);
  const mode = page.access.private ? "private" : !page.accessSet ? "inherit" : page.access.everyone ? "everyone" : "some";
  const who = h(
    "select",
    { "aria-label": "Who can see this page", onchange: (e) => (e.target.value === "some" ? fill(pick, groupBoxes()) : patch({ access: e.target.value === "inherit" ? null : e.target.value === "private" ? { private: true } : { everyone: true } })) },
    h("option", { value: "inherit", selected: mode === "inherit" }, page.parent ? `Same as “${byId.get(page.parent)?.title ?? "the page above"}”` : "Every agent (the default)"),
    h("option", { value: "everyone", selected: mode === "everyone" }, "Every agent"),
    h("option", { value: "some", selected: mode === "some" }, "Only some groups or agents"),
    h("option", { value: "private", selected: mode === "private" }, "Private: no agent sees it"),
  );
  const pick = h("div", { class: "wsgroups" });
  // Groups, and named agents (a position from another group, say), may see the page.
  const groupBoxes = () => {
    const boxes = groups.map((g) => [g, h("input", { type: "checkbox", checked: page.access.departments.includes(g) })]);
    const people = org.members.map((m) => [m.bot, m.title, h("input", { type: "checkbox", checked: (page.access.agents ?? []).includes(m.bot) })]);
    return [
      h("div", { class: "label small" }, "Groups"),
      h("div", { class: "wsgroupchecks" }, boxes.map(([g, box]) => h("label", { class: "power" }, box, g))),
      people.length ? [h("div", { class: "label small" }, "Agents"), h("div", { class: "wsgroupchecks" }, people.map(([, title, box]) => h("label", { class: "power" }, box, title)))] : null,
      h("button", { class: "small", onclick: () => patch({ access: { everyone: false, departments: boxes.filter(([, b]) => b.checked).map(([g]) => g), agents: people.filter(([, , b]) => b.checked).map(([id]) => id) } }) }, "Save"),
    ];
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

  const tablesBox = h("section", { class: "wstables", "aria-label": "Tables on this page" });
  drawTables(tablesBox, id);

  const backlinksBox = h("div", { class: "wstasks" });
  api("GET", `workspace/pages/${id}/backlinks`).then((pages) => backlinksBox.isConnected && fill(backlinksBox, pages.length ? pages.map((p) => h("button", { class: "plain wstaskrow", onclick: () => openPage(p.id) }, h("span", {}, p.icon || "📄"), " ", h("span", { class: "grow" }, p.title))) : h("p", { class: "note small" }, "No page links here yet. Type [[ in a page to link to this one."))).catch(() => {});
  const tasksBox = h("div", { class: "wstasks" });
  api("GET", `workspace/pages/${id}/tasks`).then((tasks) => tasksBox.isConnected && fill(tasksBox, tasks.length ? tasks.slice(0, 8).map((t) => h("button", { class: "plain wstaskrow", onclick: () => go("quest", t.task) }, h("span", { class: "grow" }, t.title), h("span", { class: "note small" }, `${t.agent ?? ""} ${t.how === "filed" ? "filed it" : t.how === "suggested" ? "suggested" : t.how === "changed" ? "changed it" : "read it"}`))) : h("p", { class: "note small" }, "No task has used this page yet."))).catch(() => {});

  // The settings of a file sit behind one button, so the page is the writing. The choice is remembered.
  let details = false;
  try {
    details = localStorage.getItem("talqava.details") === "1";
  } catch {}
  const detailsBtn = h("button", { class: "plain link small wsdetails", "aria-expanded": String(details), title: "Who can see it, how agents may change it, comments, history and delete" }, details ? "Hide details" : "Details");
  detailsBtn.addEventListener("click", () => {
    details = !details;
    try {
      localStorage.setItem("talqava.details", details ? "1" : "0");
    } catch {}
    aside.hidden = !details;
    aside.parentElement?.classList.toggle("nodetails", !details);
    detailsBtn.textContent = details ? "Hide details" : "Details";
    detailsBtn.setAttribute("aria-expanded", String(details));
  });
  const aside = h(
    "aside",
    { class: "wspanel", hidden: !details },
    h("div", { class: "label" }, "Who can see it"),
    who,
    pick,
    h("p", { class: "note small" }, accessWords(page.access)),
    h("div", { class: "label" }, "When agents want to change it"),
    edit,
    h("label", { class: "power" }, protect, "Protected: agents never change it directly"),
    h("p", { class: "note small" }, "Use Protected for prices, legal and people policies."),
    levelPicker(page, id),
    org.members.length ? [h("div", { class: "label" }, `Give this ${kindWord} to an agent`), giveTo, giveWhat, h("button", { class: "small", onclick: give }, "Give the task")] : null,
    office ? officePanel(page, id, surface, patch, col) : null,
    h("div", { class: "label" }, "Linked from"),
    backlinksBox,
    h("div", { class: "label" }, "Used by"),
    tasksBox,
    h("div", { class: "row wrap wspanelend" }, h("button", { class: "small", onclick: () => pageHistory(page) }, "History"), h("button", { class: "small danger", onclick: () => confirm(`Delete “${page.title}”${ui.ws.data.tree.some((p) => p.parent === id) ? " and the pages inside it" : ""}? You can restore it from Deleted.`) && attempt(async () => (await api("DELETE", `workspace/pages/${id}`), (ui.ws.open = page.parent), wsReload()), col) }, "Delete")),
  );

  fill(
    col,
    h(
      "div",
      { class: `wspage ${details ? "" : "nodetails"}` },
      h(
        "article",
        { class: `wsdoc ${page.kind === "doc" ? "paper" : ""}` },
        office ? h("nav", { class: "wstrail note small", "aria-label": "Where this is" }, h("button", { class: "plain link", onclick: () => ((ui.ws.open = null), wsReload()) }, page.kind === "doc" ? "Documents" : "Notes"), page.folder ? ` › ${page.folder}` : "") : null,
        trail.length ? h("nav", { class: "wstrail note small", "aria-label": "Where this page is" }, trail.map((t) => [h("button", { class: "plain link", onclick: () => openPage(t.id) }, t.title), " › "])) : null,
        h("div", { class: "wshead" }, iconBtn, title),
        h("p", { class: "note small wsmeta" }, `Edited by ${page.updatedBy} · ${when(page.updatedAt)}${page.protected ? " · Protected" : ""}`, " · ", detailsBtn),
        conflict,
        suggestBox,
        toolbar,
        surface,
        menu,
        tablesBox,
      ),
      aside,
    ),
  );
  ui.wsEditor = createEditor(surface, { markdown: page.markdown, placeholder: "Write here, type / for headings, lists and tables, or [[ to link a page", onChange: changed, onSlash: (q, at) => drawMenu(q, at), onSlashEnd: () => ((menu.hidden = true), (menuAt = 0)), onLink: (q, at) => drawLinkMenu(q, at), onLinkEnd: () => ((menu.hidden = true), (menuAt = 0)) });
  // A link to another page opens it here; other links open in the browser.
  surface.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (href.startsWith("#page/")) openPage(href.slice(6));
    else if (/^https?:\/\//.test(href) && (e.metaKey || e.ctrlKey || !ui.wsEditor)) window.open(href, "_blank", "noopener");
  });
  if (ui.ws.focusTitle) {
    ui.ws.focusTitle = false;
    title.focus();
  }
}

/** In a note's or document's side panel: the photos and files attached to it, and the words found in pictures. */
function attachmentsPart(page, id, col) {
  const files = page.files ?? [];
  const at = (f, rest = "") => `/api/workspace/pages/${id}/attachments/${f.id}${rest}`;
  const size = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
  const picker = h("input", { type: "file", multiple: true, hidden: true });
  const add = (list) =>
    attempt(async () => {
      for (const file of list) {
        if (file.size > 15_000_000) throw new Error(`“${file.name}” is larger than 15 MB. Put it in the Library instead, and mention it in the note.`);
        const res = await fetch(`/api/workspace/pages/${id}/attachments?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || "That file could not be attached.");
      }
      toast(list.length === 1 ? "Attached." : `${list.length} files attached.`);
      openPage(id);
    }, col);
  picker.addEventListener("change", () => picker.files.length && add([...picker.files]));
  const read = (f) =>
    confirm(`Read the words in “${f.name}”?\n\nThe picture is sent to your team's AI model, which writes out the words it sees. They are kept with this ${page.kind === "note" ? "note" : "document"}, so you can find it by them. It costs about as much as a short question.`) &&
    attempt(async () => {
      const r = await api("POST", `workspace/pages/${id}/attachments/${f.id}/read-words`);
      toast(r.words ? `Done: ${r.words} words were found. Search for any of them to find this ${page.kind === "note" ? "note" : "document"}.` : "No words were found in this picture.");
      openPage(id);
    }, col);
  const SOUND = /^(webm|m4a|mp3|wav|ogg|mp4|aac|flac)$/;
  // A recording: what is said in it is written out on this computer, so the note is found by those words.
  const hear = (f, link) =>
    attempt(async () => {
      if (!(await speechReady())) return;
      link.textContent = "Writing it out…";
      link.disabled = true;
      const sound = await toPlainSound(await (await fetch(at(f))).blob());
      const r = await writeOut(`workspace/pages/${id}/attachments/${f.id}/write-out`, sound);
      toast(r.words ? `Done: ${r.words} words were written out. Press Show words to read them.` : "No words were heard in this recording.");
      openPage(id);
    }, col).finally?.(() => ((link.textContent = f.words ? "Write it out again" : "Write it out"), (link.disabled = false)));
  const words = (f) => attempt(async () => alert((await api("GET", `workspace/pages/${id}/attachments/${f.id}/words`)).words), col);
  const remove = (f) => confirm(`Remove “${f.name}” from this ${page.kind === "note" ? "note" : "document"}? The file is deleted.`) && attempt(async () => (await api("DELETE", `workspace/pages/${id}/attachments/${f.id}`), openPage(id)), col);
  // A voice memo: recorded here with this computer's microphone and kept with the note. It is sent nowhere.
  const recordNote = h("p", { class: "note small", hidden: true, role: "status" });
  let recorder = null;
  const recordButton = h("button", { class: "small", onclick: () => (recorder ? recorder.stop() : record()) }, "Record a voice memo");
  const record = () =>
    attempt(async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("This computer or browser cannot record sound here.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
        throw new Error("The microphone could not be used. Allow Talqava to use the microphone (on a Mac: System Settings › Privacy & Security › Microphone), then try again.");
      });
      const parts: any[] = [];
      const started = Date.now();
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      const tick = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        recordNote.textContent = `Recording… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. Press Stop when you are done (20 minutes at most).`;
        if (s >= 1200) recorder?.stop();
      }, 500);
      recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
      recorder.onstop = () => {
        clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        const type = (recorder.mimeType || "audio/webm").split(";")[0];
        recorder = null;
        recordButton.textContent = "Record a voice memo";
        recordNote.hidden = true;
        const ending = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const now = new Date();
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`;
        if (parts.length) add([new File(parts, `Voice memo ${stamp}.${ending}`, { type })]);
      };
      recorder.start(1000);
      recordButton.textContent = "Stop recording";
      recordNote.hidden = false;
      recordNote.textContent = "Recording…";
    }, col);
  const zone = h(
    "div",
    {
      class: "attachzone",
      ondragover: (e) => (e.preventDefault(), zone.classList.add("over")),
      ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => (e.preventDefault(), zone.classList.remove("over"), e.dataTransfer.files.length && add([...e.dataTransfer.files])),
    },
    files.map((f) =>
      h(
        "div",
        { class: "attached" },
        f.picture ? h("button", { class: "plain", title: "Show it larger", onclick: (e) => e.currentTarget.closest(".attached").querySelector(".attachbig").toggleAttribute("hidden") }, h("img", { class: "fthumb", src: at(f), alt: f.name, loading: "lazy" })) : null,
        h("div", { class: "grow" }, h("a", { href: at(f, "?download=1"), download: f.name }, f.name), h("div", { class: "note small" }, size(f.size), f.words ? ` · ${f.words} words found` : "")),
        h(
          "div",
          { class: "row wrap" },
          f.picture ? h("button", { class: "plain link", onclick: () => read(f) }, f.words ? "Read again" : "Read the words") : null,
          SOUND.test(f.type) && state.canSpeak ? h("button", { class: "plain link", onclick: (e) => hear(f, e.currentTarget) }, f.words ? "Write it out again" : "Write it out") : null,
          f.words ? h("button", { class: "plain link", onclick: () => words(f) }, "Show words") : null,
          h("button", { class: "plain link", onclick: () => remove(f) }, "Remove"),
        ),
        f.picture ? h("img", { class: "attachbig", hidden: true, src: at(f), alt: f.name, loading: "lazy" }) : null,
        SOUND.test(f.type) ? h("audio", { class: "attachbig", controls: true, preload: "none", src: at(f) }) : null,
      ),
    ),
    h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => picker.click() }, "Attach a photo or file"), recordButton),
    recordNote,
    picker,
    h("p", { class: "note small" }, `Or drop files here. Up to 15 MB each. Attachments stay with you: agents are not given them. ${state.canSpeak ? "A voice memo is kept as sound. Press Write it out to have what is said written out on this computer, so you can find the note by those words; nothing is sent anywhere." : "A voice memo is kept as sound; it is not written out or sent anywhere."}`),
  );
  return [h("div", { class: "label" }, `Attachments${files.length ? ` · ${files.length}` : ""}`), zone];
}

/** In a document's or note's side panel: its folder or notebook, tags, what it can become, and downloads. */
function officePanel(page, id, surface, patch, col) {
  const isNote = page.kind === "note";
  const names = (isNote ? ui.ws.data?.notebooks : ui.ws.data?.folders) ?? [];
  const listId = `folders-${id}`;
  const folder = h("input", { value: page.folder, placeholder: isNote ? "e.g. Meetings" : "e.g. Customers", list: listId, maxlength: 60, "aria-label": isNote ? "Notebook" : "Folder" });
  folder.addEventListener("change", () => patch({ folder: folder.value }));
  const tags = h("input", { value: page.tags.join(", "), placeholder: "e.g. follow-up, pricing", "aria-label": "Tags" });
  tags.addEventListener("change", () => patch({ tags: tags.value }));
  const local = (iso) => ((d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16))(new Date(iso));
  const remind = h("input", { type: "datetime-local", value: page.remindAt ? local(page.remindAt) : "", "aria-label": "Remind me at" });
  remind.addEventListener("change", () => patch({ remindAt: remind.value ? new Date(remind.value).toISOString() : null }));
  const html = () => (surface.querySelector(".ProseMirror") ?? surface).innerHTML;
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const forWord = () => downloadFrom(`workspace/pages/${id}/docx`, `${page.title}.docx`, col);
  const print = () => {
    document.body.classList.add("printing");
    const done = () => (document.body.classList.remove("printing"), window.removeEventListener("afterprint", done));
    window.addEventListener("afterprint", done);
    window.print();
  };
  const become = (kind, words) => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { kind }), toast(`It is now ${words}.`), openPage(id)), col);
  const remember = () =>
    attempt(async () => {
      const text = `${page.title}\n\n${ui.wsEditor?.markdown() ?? ""}`.trim();
      if (text.length > 2000) throw new Error("This note is too long to remember whole. Select the part that matters, put it in a shorter note, and remember that.");
      await api("POST", "memory", { text });
      toast("Saved to Memory. Your agents will remember it.");
    }, col);
  return [
    h("label", { class: "power" }, h("input", { type: "checkbox", checked: page.pinned, onchange: (e) => patch({ pinned: e.target.checked }) }), `Pinned: keep at the top of ${isNote ? "Notes" : "Documents"}`),
    h("div", { class: "label" }, "Remind me"),
    remind,
    page.remindAt ? h("p", { class: "note small" }, `You will be reminded in your Inbox ${new Date(page.remindAt) <= new Date() ? "now" : `on ${when(page.remindAt)}`}. Clear the box to cancel.`) : h("p", { class: "note small" }, "Pick a date and time; the reminder appears in your Inbox."),
    h("div", { class: "label" }, isNote ? "Notebook" : "Folder"),
    folder,
    h("datalist", { id: listId }, names.map((n) => h("option", { value: n }))),
    isNote ? [h("div", { class: "label" }, "Tags"), tags, h("p", { class: "note small" }, "Separate tags with commas.")] : null,
    attachmentsPart(page, id, col),
    h("div", { class: "label" }, "Turn it into"),
    h(
      "div",
      { class: "officeturn" },
      isNote ? h("button", { class: "small", onclick: () => become("doc", "a document, under Documents") }, "A document") : h("button", { class: "small", onclick: () => become("note", "a note, under Notes") }, "A note"),
      h("button", { class: "small", onclick: () => confirm(`Move “${page.title}” to the Workspace as a page? Agents follow Workspace pages as procedures.`) && become("page", "a page in the Workspace") }, "A Workspace page"),
      isNote ? h("button", { class: "small", onclick: remember }, "Something to remember") : null,
    ),
    h("div", { class: "label" }, "Download"),
    h("div", { class: "officeturn" }, h("button", { class: "small", onclick: forWord }, "Word file (.docx)"), h("button", { class: "small", onclick: print }, "Print or save as PDF")),
  ];
}

/** What the two Office screens share: load the files, keep the editor tidy, and say who can use a file. */
async function officeLoad(view, side, col) {
  ui.ws ??= { collapsed: new Set<any>() };
  ui.ws.host = view;
  ui.wsFlush?.();
  ui.wsFlush = null;
  ui.wsEditor?.destroy();
  ui.wsEditor = null;
  ui.body.className = "body two wsbody";
  ui.log = null;
  fill(ui.body, side, col);
  let data;
  try {
    [data] = await Promise.all([api("GET", "workspace/office"), state.crew ? null : loadCrew(), state.orgs ? null : loadOrgs()]);
  } catch (err) {
    fill(col, h("div", { class: "banner error" }, err.message));
    return null;
  }
  if (state.view !== view) return null;
  ui.ws.data = data;
  const kind = view === "docs" ? "doc" : view === "sheets" ? "sheet" : view === "slides" ? "deck" : "note";
  if (ui.ws.open && !data.files.some((f) => f.id === ui.ws.open && f.kind === kind)) ui.ws.open = null;
  return data;
}
const officeWho = (f) => (f.access.private ? "Private" : f.access.everyone ? "Every agent" : [...f.access.departments, ...(f.access.agents.length ? [`${f.access.agents.length} agent${f.access.agents.length === 1 ? "" : "s"}`] : [])].join(", ") || "Every agent");
const officeDay = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const officeNew = (kind, folder = "") =>
  attempt(async () => {
    const page = await api("POST", "workspace/pages", { kind, folder, title: "Untitled" });
    ui.ws.focusTitle = true;
    ui.ws.open = page.id;
    wsReload();
  });

/** A deck's text as slides, and back. The same form the app itself uses (see workspace.ts). */
function parseDeck(text) {
  const slides = String(text ?? "")
    .split(/^\s*---\s*$/m)
    .map((part) => {
      const lines = part.replace(/^\n+|\s+$/g, "").split("\n");
      const at = lines.findIndex((l) => /^notes:/i.test(l.trim()));
      const main = at < 0 ? lines : lines.slice(0, at);
      const notes = at < 0 ? "" : [lines[at].trim().replace(/^notes:\s*/i, ""), ...lines.slice(at + 1)].join("\n").trim();
      const head = main.findIndex((l) => /^#{1,2}\s+/.test(l));
      const title = head < 0 ? "" : main[head].replace(/^#{1,2}\s+/, "").trim();
      const body = (head < 0 ? main : [...main.slice(0, head), ...main.slice(head + 1)]).join("\n").trim();
      return { title, body, notes };
    })
    .filter((x) => x.title || x.body || x.notes);
  return slides.length ? slides : [{ title: "", body: "", notes: "" }];
}
const writeDeck = (slides) => `${slides.map((x) => [`# ${x.title.replace(/\s+/g, " ").trim() || "Untitled slide"}`, x.body.trim(), x.notes.trim() ? `Notes: ${x.notes.trim()}` : ""].filter(Boolean).join("\n\n")).join("\n\n---\n\n")}\n`;
/** The numbers a chart shows: a column of labels beside a column of numbers, or one row. */
function chartPoints(eng, value, tab, range) {
  const out: any[] = [];
  const wide = range.r1 === range.r2 && range.c2 > range.c1;
  if (wide) for (let c = range.c1; c <= range.c2; c++) out.push({ label: eng.colName(c), v: value(tab, c, range.r1) });
  else for (let r = range.r1; r <= range.r2; r++) out.push({ label: range.c2 > range.c1 ? eng.show(value(tab, range.c1, r)) : String(r + 1), v: value(tab, range.c2, r) });
  return out.filter((p) => typeof p.v === "number");
}
/** A bar or line chart as a picture with its numbers in words for screen readers. */
function chartPicture(eng, type, pts) {
  if (!pts.length) return h("p", { class: "note small" }, "There are no numbers in that range yet.");
  const max = Math.max(1, ...pts.map((p) => Math.abs(p.v)));
  const words = pts.map((p) => `${p.label} ${eng.show(p.v, "number")}`).join("; ");
  let picture;
  if (type === "line" && pts.length > 1) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 300 110");
    svg.setAttribute("class", "sheetline");
    const low = Math.min(0, ...pts.map((p) => p.v));
    const high = Math.max(...pts.map((p) => p.v), low + 1);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("points", pts.map((p, n) => `${10 + (280 * n) / (pts.length - 1)},${100 - (90 * (p.v - low)) / (high - low)}`).join(" "));
    svg.append(line);
    picture = h("div", {}, svg, h("div", { class: "sheetlinelabels note small" }, pts.map((p) => h("span", {}, p.label))));
  } else picture = h("div", { class: "sheetbars" }, pts.map((p) => h("div", { class: "sheetbarrow" }, h("span", { class: "sheetbarlabel" }, p.label), h("span", { class: "sheetbarfill", style: `width: ${Math.max(1, (Math.abs(p.v) / max) * 100).toFixed(1)}%` }), h("span", { class: "mono small" }, eng.show(p.v, "number")))));
  return h("div", { role: "img", "aria-label": `${type === "line" ? "Line" : "Bar"} chart. ${words}` }, picture);
}

/** A line of a slide that shows a sheet's chart: "!chart <the sheet's page id> <the chart's title>". */
const SLIDE_CHART = /^!chart\s+([\w-]{4,80})(?:\s+(.*))?$/;
const sheetPages = new Map<any, any>();
/** A sheet's page, kept for half a minute so a deck with several charts asks once. */
const sheetPage = (id) => {
  const had = sheetPages.get(id);
  if (had && Date.now() - had.at < 30_000) return had.page;
  const page = api("GET", `workspace/pages/${id}`);
  sheetPages.set(id, { at: Date.now(), page });
  return page;
};
/** Draws a sheet's chart on a slide. It is read from the sheet each time, so it always shows the sheet as it is now. */
function slideChart(pageId, title) {
  const box = h("figure", { class: "slidechart" }, h("p", { class: "note small" }, "Loading the chart…"));
  (async () => {
    try {
      const [page, eng] = await Promise.all([sheetPage(pageId), import("/sheet-engine.js")]);
      if (page.kind !== "sheet") throw new Error("not a sheet");
      const file = eng.parseFile(page.markdown);
      const want = String(title ?? "").trim().toLowerCase();
      let found = null;
      file.sheets.forEach((sh, tab) => sh.charts.forEach((ch) => (found ??= !want || String(ch.title ?? "").trim().toLowerCase() === want ? { ch, tab } : null)));
      if (!found) return fill(box, h("p", { class: "note small" }, want ? `The sheet “${page.title}” has no chart called “${title}”.` : `The sheet “${page.title}” has no chart yet.`));
      fill(box, h("figcaption", {}, h("b", {}, found.ch.title || "Chart"), h("span", { class: "note small" }, ` · from ${page.title}`)), chartPicture(eng, found.ch.type, chartPoints(eng, eng.compute(file), found.tab, found.ch.range)));
    } catch {
      fill(box, h("p", { class: "note small" }, "This chart's sheet could not be opened. It may have been deleted, or you may not have access to it."));
    }
  })();
  return box;
}
/** Lets the owner pick one chart of one sheet, and hands back the line that shows it on a slide. */
async function pickSheetChart(done) {
  const dialog = h("dialog", { class: "aidialog" });
  const close = () => (dialog.close(), dialog.remove());
  const status = h("p", { class: "note", role: "status" }, "Loading your sheets…");
  const sheetSel = h("select", { "aria-label": "Sheet" });
  const chartSel = h("select", { "aria-label": "Chart" });
  const add = h("button", { class: "primary", disabled: true }, "Add to the slide");
  const loadCharts = async () => {
    add.disabled = true;
    fill(chartSel);
    if (!sheetSel.value) return;
    try {
      const [page, eng] = await Promise.all([api("GET", `workspace/pages/${sheetSel.value}`), import("/sheet-engine.js")]);
      const charts = eng.parseFile(page.markdown).sheets.flatMap((sh) => sh.charts);
      fill(chartSel, charts.map((ch) => h("option", { value: ch.title ?? "" }, ch.title || "Chart")));
      status.textContent = charts.length ? "The chart on the slide always shows the sheet as it is now." : "That sheet has no chart yet. Open it, select some numbers and press Add a chart.";
      add.disabled = !charts.length;
    } catch (err) {
      status.textContent = err.message;
    }
  };
  sheetSel.addEventListener("change", loadCharts);
  add.addEventListener("click", () => (done(`!chart ${sheetSel.value} ${chartSel.value}`.trim()), close()));
  fill(dialog, h("h3", {}, "Add a chart from a sheet"), h("div", { class: "form" }, h("label", {}, "Sheet", sheetSel), h("label", {}, "Chart", chartSel), status, h("div", { class: "row" }, add, h("button", { onclick: close }, "Cancel"))));
  document.body.append(dialog);
  dialog.showModal();
  try {
    const sheets = (await api("GET", "workspace/office")).files.filter((f) => f.kind === "sheet");
    fill(sheetSel, sheets.map((f) => h("option", { value: f.id }, f.title)));
    if (!sheets.length) status.textContent = "You have no sheets yet. Make one under Sheets, with a chart in it.";
    else await loadCharts();
  } catch (err) {
    status.textContent = err.message;
  }
}
/** A slide's text: Markdown, with any chart lines drawn in place. */
function slideBody(text) {
  const parts: any[] = [];
  let run: any[] = [];
  const flush = () => (run.join("\n").trim() && parts.push(renderMarkdown(run.join("\n"))), (run = []));
  for (const line of String(text ?? "").split("\n")) {
    const m = SLIDE_CHART.exec(line.trim());
    if (m) (flush(), parts.push(slideChart(m[1], m[2])));
    else run.push(line);
  }
  flush();
  return parts;
}
/** One slide drawn at 16:9: its title and its text. */
const slideFace = (x, n, total) => h("div", { class: "slideface" }, h("h2", {}, x.title || "Untitled slide"), h("div", { class: "md slidebody" }, slideBody(x.body || "")), total ? h("span", { class: "slidenum" }, `${n} / ${total}`) : null);

/** Shows a deck full screen, one slide at a time: arrows or a click move on, Escape leaves. */
function presentDeck(slides, from = 0) {
  let at = from;
  const stage = h("div", { class: "present", tabindex: "0", role: "dialog", "aria-label": "Presentation" });
  const draw = () => fill(stage, slideFace(slides[at], at + 1, slides.length), h("div", { class: "presentbar" }, h("button", { class: "plain", onclick: (e) => (e.stopPropagation(), move(-1)) }, "← Back"), h("button", { class: "plain", onclick: (e) => (e.stopPropagation(), move(1)) }, "Next →"), h("button", { class: "plain", onclick: (e) => (e.stopPropagation(), leave()) }, "Close (Esc)")));
  const move = (by) => ((at = Math.max(0, Math.min(slides.length - 1, at + by))), draw());
  const leave = () => (document.fullscreenElement && document.exitFullscreen().catch(() => {}), stage.remove());
  stage.addEventListener("keydown", (e) => (["ArrowRight", " ", "PageDown", "Enter"].includes(e.key) ? (e.preventDefault(), move(1)) : ["ArrowLeft", "PageUp", "Backspace"].includes(e.key) ? (e.preventDefault(), move(-1)) : e.key === "Escape" ? leave() : null));
  stage.addEventListener("click", () => move(1));
  document.body.append(stage);
  draw();
  stage.focus();
  stage.requestFullscreen?.().catch(() => {});
}

/** Office › Slides: presentations as a list of slides, each a title, a few points and speaker notes. */
async function slidesView() {
  const side = h("aside", { class: "side wsside", "aria-label": "Slides" });
  const col = h("main", { class: "center wscenter" });
  const data = await officeLoad("slides", side, col);
  if (!data) return;
  const decks = data.files.filter((f) => f.kind === "deck");
  const org = activeOrg();
  const open = (id) => ((ui.ws.open = id), slidesView());
  const make = () => attempt(async () => open((await api("POST", "workspace/pages", { kind: "deck", title: "Untitled slides", markdown: "# Title of the presentation\n\nA line about what it covers\n" })).id), col);
  fill(
    side,
    h("div", { class: "wssidehead" }, h("button", { class: `plain wshome ${ui.ws.open ? "" : "on"}`, onclick: () => open(null) }, "Slides"), h("button", { class: "small", onclick: make }, "+ Slides")),
    decks.map((f) => h("button", { class: `plain wsrow officerow ${ui.ws.open === f.id ? "on" : ""}`, "aria-current": ui.ws.open === f.id ? "true" : null, onclick: () => open(f.id) }, h("span", { class: "grow" }, f.title), f.suggestions ? h("span", { class: "count", title: "Changes from an agent waiting for you" }, String(f.suggestions)) : null)),
    decks.length ? null : h("p", { class: "note small", style: "padding: 8px 10px" }, "No slides yet."),
  );
  if (ui.ws.open) return renderDeck(col, ui.ws.open);

  const sources = data.files.filter((f) => f.kind !== "deck" && !f.access.private);
  const from = h("select", { "aria-label": "Make slides from" }, h("option", { value: "" }, "A subject I describe below"), sources.map((f) => h("option", { value: f.id }, `${{ doc: "Document", sheet: "Sheet", note: "Note" }[f.kind] ?? "File"}: ${f.title}`)));
  const what = h("input", { placeholder: "e.g. A 6-slide review of the spring campaign for the team", "aria-label": "What the slides are for" });
  const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const ask = () =>
    attempt(async () => {
      const src = sources.find((f) => f.id === from.value);
      const text = what.value.trim();
      if (!text && !src) throw new Error("Say what the slides are for, or choose a file to make them from.");
      const quest = await startTask({ bot: who.value, text: `Make a presentation${text ? `: ${text}` : ""}.${src ? `\n\nBuild it from “${src.title}” (${src.kind === "sheet" ? `a sheet: read it with the sheet tool, file ${src.id}` : `read it with the workspace tool, page ${src.id}`}). Use only what is in it; do not invent numbers.` : ""}\n\nSave it with the workspace tool: action "file", kind "slides", a clear title, and the slides as Markdown separated by lines of three dashes. One idea and at most five short points on each slide, with "Notes:" for what the presenter should say. Say in your report where it is.`, title: `Slides: ${text || src?.title}`.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  fill(
    col,
    h("div", { class: "officehome" }, h("h1", {}, "Slides"), h("p", { class: "lead" }, "Presentations: each slide is a title, a few points and notes for the presenter. Write them yourself, or have an agent draft them from a document, a sheet or a note.")),
    h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: make }, "+ New slides"), h("button", { onclick: () => importOfficeFile(".pptx", col) }, "Import a PowerPoint file")),
    org.members.length ? h("form", { class: "card form officeask", onsubmit: (e) => (e.preventDefault(), ask()) }, h("b", {}, "Or ask an agent to draft them"), from, h("div", { class: "row wrap" }, what, who, h("button", {}, "Give the task")), h("p", { class: "note small" }, "Private files are not offered here: an agent cannot read them.")) : null,
    decks.length
      ? h("div", { class: "card officetable" }, h("table", {}, h("thead", {}, h("tr", {}, ["Name", "Slides", "Last change", "Who can read it"].map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, decks.map((f) => h("tr", {}, h("td", {}, h("button", { class: "plain link", onclick: () => open(f.id) }, f.title)), h("td", {}, f.summary.split(":")[0]), h("td", {}, `${f.updatedBy} · ${officeDay(f.updatedAt)}`), h("td", {}, officeWho(f)))))))
      : h("p", { class: "note" }, "No slides yet. Start with + New slides, or ask an agent to draft some."),
  );
}

/** One deck: the list of slides, the slide being worked on, and its settings. */
async function renderDeck(col, id) {
  let page, suggestions;
  try {
    [page, suggestions] = await Promise.all([api("GET", `workspace/pages/${id}`), api("GET", `workspace/suggestions?page=${encodeURIComponent(id)}`)]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "slides" || ui.ws.open !== id) return;
  const org = activeOrg();
  let slides = parseDeck(page.markdown);
  let at = Math.min(ui.ws.slide?.[id] ?? 0, slides.length - 1);
  let rev = page.rev;
  let timer = null;
  const status = h("span", { class: "wsstatus note small" }, "Saved");
  const save = async () => {
    clearTimeout(timer);
    timer = null;
    status.textContent = "Saving…";
    try {
      rev = (await api("PUT", `workspace/pages/${id}`, { markdown: writeDeck(slides), baseRev: rev })).rev;
      status.textContent = "Saved";
    } catch (err) {
      status.textContent = "Not saved";
      toast(err.message, { label: "Reload", run: () => slidesView() });
    }
  };
  const changed = () => ((status.textContent = "Editing…"), clearTimeout(timer), (timer = setTimeout(save, 700)));
  ui.wsFlush = () => timer && save();

  const title = h("input", { class: "wstitlebox", value: page.title, maxlength: 120, "aria-label": "Name of these slides" });
  title.addEventListener("change", () => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { title: title.value.trim() || "Untitled slides" }), ui.ws.refreshSide?.()), col));
  const rail = h("div", { class: "sliderail", role: "list", "aria-label": "Slides" });
  const face = h("div", { class: "slidestage" });
  const sTitle = h("input", { placeholder: "Slide title", maxlength: 140, "aria-label": "Slide title" });
  const sBody = h("textarea", { rows: 7, placeholder: "A few short points, one on each line starting with “- ”.\nYou can also write a small table or a sentence.", "aria-label": "Slide text" });
  const sNotes = h("textarea", { rows: 3, placeholder: "What the presenter should say (not shown on the slide)", "aria-label": "Speaker notes" });
  const drawFace = () => fill(face, slideFace(slides[at], at + 1, slides.length));
  const pick = (i) => {
    at = Math.max(0, Math.min(slides.length - 1, i));
    (ui.ws.slide ??= {})[id] = at;
    sTitle.value = slides[at].title;
    sBody.value = slides[at].body;
    sNotes.value = slides[at].notes;
    drawRail();
    drawFace();
  };
  const drawRail = () =>
    fill(
      rail,
      slides.map((x, i) => h("button", { class: `slidethumb ${i === at ? "on" : ""}`, role: "listitem", "aria-current": i === at ? "true" : null, onclick: () => pick(i) }, h("span", { class: "note small" }, String(i + 1)), h("span", { class: "thumbface" }, h("b", {}, x.title || "Untitled slide"), h("span", {}, x.body.replace(/[#*_`>-]/g, "").slice(0, 60))))),
      h("button", { class: "small", onclick: () => (slides.splice(at + 1, 0, { title: "", body: "", notes: "" }), changed(), pick(at + 1), sTitle.focus()) }, "+ Slide"),
    );
  for (const [input, key] of [[sTitle, "title"], [sBody, "body"], [sNotes, "notes"]]) input.addEventListener("input", () => ((slides[at][key] = input.value), drawFace(), key !== "notes" && drawRail(), changed()));
  const move = (by) => {
    const to = at + by;
    if (to < 0 || to >= slides.length) return;
    [slides[at], slides[to]] = [slides[to], slides[at]];
    changed();
    pick(to);
  };
  const remove = () => (slides.length > 1 && confirm(`Delete slide ${at + 1}${slides[at].title ? ` “${slides[at].title}”` : ""}?`) ? (slides.splice(at, 1), changed(), pick(Math.min(at, slides.length - 1))) : null);
  const printDeck = () => {
    // Slides print one to a page, sideways; the page rule is added only while they print, so documents stay upright.
    const sheet = h("div", { class: "deckprint" }, h("style", {}, "@page { size: landscape; margin: 10mm; }"), slides.map((x, i) => slideFace(x, i + 1, slides.length)));
    document.body.append(sheet);
    document.body.classList.add("printingdeck");
    const done = () => (document.body.classList.remove("printingdeck"), sheet.remove(), window.removeEventListener("afterprint", done));
    window.addEventListener("afterprint", done);
    window.print();
  };

  // ----- what an agent wants to change -----
  const decide = (sg, decision) =>
    attempt(async () => {
      try {
        await api("POST", `workspace/suggestions/${sg.id}`, { decision });
      } catch (err) {
        if (err.status !== 409 || !confirm(`${err.message}\n\nUse the agent's version of the slides? Yours stays in History.`)) throw err;
        await api("POST", `workspace/suggestions/${sg.id}`, { decision, replace: true });
      }
      loadPageSuggestions();
      slidesView();
    }, col);
  const waiting = suggestions.length
    ? h(
        "div",
        { class: "card form" },
        h("b", {}, `Waiting for you · ${suggestions.length}`),
        suggestions.map((sg) => {
          const next = parseDeck(sg.markdown);
          const titles = new Set<any>(slides.map((x) => x.title));
          const added = next.filter((x) => !titles.has(x.title)).map((x) => x.title || "Untitled slide");
          return h("div", { class: "reviewline" }, h("div", { class: "grow" }, h("b", {}, sg.authorName), h("div", { class: "note small" }, `${sg.note || "A change to these slides."} It would make ${next.length} slide${next.length === 1 ? "" : "s"} (now ${slides.length})${added.length ? `; new or renamed: ${added.slice(0, 5).join(", ")}` : ""}.`)), h("div", { class: "row wrap" }, h("button", { class: "small", onclick: () => presentDeck(next) }, "Look at them"), h("button", { class: "small primary", onclick: () => decide(sg, "accept") }, "Accept"), h("button", { class: "small", onclick: () => decide(sg, "decline") }, "Decline")));
        }),
      )
    : null;

  // ----- settings -----
  const patch = (body) => attempt(async () => void Object.assign(page, await api("PATCH", `workspace/pages/${id}`, body)), col);
  const whoSel = h("select", { "aria-label": "Who can see it" }, [["everyone", "Every agent"], ["private", "Private: no agent sees it"]].map(([v, t]) => h("option", { value: v, selected: (page.access.private ? "private" : "everyone") === v }, t)));
  whoSel.addEventListener("change", () => patch({ access: whoSel.value === "private" ? { private: true } : { everyone: true } }));
  const edit = h("select", { "aria-label": "When agents want to change it" }, [["suggest", "They suggest; I accept or decline"], ["direct", "They change it straight away"]].map(([v, t]) => h("option", { value: v, selected: page.edit === v }, t)));
  edit.addEventListener("change", () => patch({ edit: edit.value }));
  const giveTo = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const giveWhat = h("textarea", { rows: 2, placeholder: "e.g. Tighten every slide to three points and add speaker notes.", "aria-label": "What to do" });
  const give = () =>
    attempt(async () => {
      const what = giveWhat.value.trim() || "Improve these slides.";
      const quest = await startTask({ bot: giveTo.value, text: `${what}\n\nThe slides are “${page.title}” (page ${id}). Read them with the workspace tool, then suggest the whole new text with action "suggest": slides separated by lines of three dashes, each "# Title", a few short points, and "Notes:" for the presenter.`, title: what.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  const aside = h(
    "aside",
    { class: "wspanel" },
    accessPicker(page, patch, org),
    h("div", { class: "label" }, "When agents want to change it"),
    edit,
    h("label", { class: "power" }, h("input", { type: "checkbox", checked: page.protected, onchange: (e) => patch({ protected: e.target.checked }) }), "Protected: agents never change it directly"),
    levelPicker(page, id),
    org.members.length ? [h("div", { class: "label" }, "Give these slides to an agent"), giveTo, giveWhat, h("button", { class: "small", onclick: give }, "Give the task")] : null,
    h("div", { class: "row wrap wspanelend" }, h("button", { class: "small", onclick: () => pageHistory(page) }, "History"), h("button", { class: "small danger", onclick: () => confirm(`Delete “${page.title}”? You can restore it from Deleted in the Workspace for 30 days.`) && attempt(async () => (await api("DELETE", `workspace/pages/${id}`), (ui.ws.open = null), slidesView()), col) }, "Delete")),
  );
  ui.ws.refreshSide = () => slidesView();
  fill(
    col,
    h(
      "div",
      { class: "wspage deckpage" },
      h(
        "article",
        { class: "wsdoc" },
        h("nav", { class: "wstrail note small" }, h("button", { class: "plain link", onclick: () => ((ui.ws.open = null), slidesView()) }, "Slides")),
        h("div", { class: "wshead" }, title),
        h("div", { class: "row wrap decktools" }, h("button", { class: "primary", onclick: () => presentDeck(slides, at) }, "Present"), h("button", { onclick: () => move(-1) }, "Move earlier"), h("button", { onclick: () => move(1) }, "Move later"), h("button", { class: "danger", onclick: remove }, "Delete slide"), h("button", { onclick: printDeck }, "Print or save as PDF"), h("button", { onclick: () => downloadFrom(`workspace/pages/${id}/pptx`, `${page.title}.pptx`, ui.body) }, "PowerPoint file (.pptx)"), status),
        waiting,
        h("div", { class: "deckwork" }, rail, h("div", { class: "deckmain" }, face, h("label", {}, "Slide title", sTitle), h("label", {}, "On the slide", sBody), h("div", {}, h("button", { type: "button", class: "small", onclick: () => pickSheetChart((line) => ((sBody.value = `${sBody.value.trim()}\n\n${line}`.trim()), sBody.dispatchEvent(new Event("input")))) }, "Add a chart from a sheet")), h("label", {}, "Speaker notes", sNotes))),
      ),
      aside,
    ),
  );
  pick(at);
}

/** Saves a file the app makes (a Word or Excel file) to the person's computer. */
async function downloadFrom(path, name, box) {
  await attempt(async () => {
    ui.wsFlush?.();
    const res = await fetch(`/api/${path}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "The file could not be made.");
    const a = h("a", { href: URL.createObjectURL(await res.blob()), download: name.replace(/[\\/:*?"<>|]+/g, " ") });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, box);
}

/** Brings a Word or Excel file in as a document or a sheet, and opens it. */
function importOfficeFile(accept, box) {
  const input = h("input", { type: "file", accept });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    attempt(async () => {
      if (file.size > 30_000_000) throw new Error("That file is larger than 30 MB.");
      const res = await fetch(`/api/workspace/import-file?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That file could not be brought in.");
      toast("Brought in. Text, headings, lists and tables are kept; fonts, colours and pictures are not.");
      openPage(data.id);
    }, box);
  });
  input.click();
}

/** The first-run welcome: the idea in a line, and the few places that matter. Shown once; Home can show it again. */
function showWelcome() {
  const dialog = h("dialog", { class: "aidialog welcome" });
  const close = () => {
    try {
      localStorage.setItem("talqava.welcomed", "1");
    } catch {}
    dialog.close();
    dialog.remove();
  };
  const point = (where, about) => h("li", {}, h("b", {}, where), ` ${about}`);
  fill(
    dialog,
    h("h3", {}, "Welcome to Talqava"),
    h("p", {}, "You ask, your AI agents do the work, and you stay in control. Start by typing what you need in the box on the first screen. The menu has five places:"),
    h(
      "ul",
      {},
      point("New.", "One box to ask for anything, or to give someone on your team a task."),
      point("Inbox.", "What is waiting on your yes: plans, questions, finished work, changes to accept."),
      point("Tasks.", "The work: every task, your projects, and work that repeats by itself."),
      point("Team.", "Who does the work: your agents, how they are organized, and ready-made additions."),
      point("Files.", "What you make (documents, sheets, slides, notes) and what your agents work from."),
    ),
    h("p", { class: "note" }, "More holds integrations, security and settings. The box at the top finds anything, and Help explains the screen you are on."),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => (close(), go("start")) }, "Start"), h("button", { class: "plain", onclick: () => (close(), showGuide("getting-started")) }, "Read Getting started")),
  );
  dialog.addEventListener("cancel", close);
  document.body.append(dialog);
  dialog.showModal();
}

/** Whether to open on the set-up chat: something is still missing, and the owner has not finished or skipped it. */
function setupWanted() {
  try {
    if (localStorage.getItem("talqava.setup") === "done") return false;
  } catch {}
  return needsKey(state.config) || !activeOrg()?.members?.length;
}

/**
 * First run as a short conversation: the assistant asks one thing at a time, with a small list to tick, Back and
 * Continue. It is scripted here (no AI model is needed for it), and uses the same steps as the Team page: the
 * mission, suggested positions, and adding the ones the owner keeps.
 */
async function setupView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "setupchat" });
  const side = h("aside", { class: "setupover", "aria-label": "Overview" });
  fill(ui.body, h("main", { class: "setupmain" }, col, side));
  if (!state.orgs) await loadOrgs();
  if (!state.crew) await loadCrew();
  if (state.view !== "setup") return;
  const su = (ui.setup = { step: "start", mission: "", found: null, picked: new Set<any>(), busy: false, error: "", said: [], ...(ui.setup ?? {}) });
  su.said ??= [];
  su.picked ??= new Set<any>();
  const first = state.me?.person ? state.me.person.name.split(" ")[0] : "";
  const finish = (to = "start") => {
    try {
      localStorage.setItem("talqava.setup", "done");
      localStorage.setItem("talqava.welcomed", "1");
    } catch {}
    ui.setup = null;
    go(to);
  };
  const to = (step, said) => ((su.step = step), (su.error = ""), said ? su.said.push(said) : null, draw());
  const back = (step) => (su.said.pop(), (su.step = step), (su.error = ""), draw());
  const mark = () => h("span", { class: "setupmark", "aria-hidden": "true" });
  const say = (...text) => h("div", { class: "setupsay" }, mark(), h("div", {}, h("b", {}, "Your assistant"), text.map((t) => h("p", {}, t))));
  const mine = (text) => h("div", { class: "setupmine" }, text);
  const card = (title, about, body, foot?) => h("section", { class: "setupcard" }, h("div", { class: "setuphead" }, h("b", {}, title), about ? h("span", { class: "note small" }, about) : null), body, foot ? h("div", { class: "setupfoot" }, foot) : null);
  const choice = (title, about, run, primary?) => h("button", { class: `plain setupopt ${primary ? "first" : ""}`, onclick: run }, h("span", { class: "grow" }, h("b", {}, title), h("span", { class: "note small" }, about)), h("span", { "aria-hidden": "true" }, "→"));

  const suggest = async () => {
    const org = activeOrg();
    su.busy = true;
    draw();
    try {
      if (su.mission.trim() !== (org.mission ?? "")) {
        await api("PATCH", `orgs/${org.id}`, { mission: su.mission.trim() });
        await loadOrgs();
      }
      su.found = await api("POST", `orgs/${org.id}/suggest`, { mission: su.mission.trim() });
      su.picked = new Set<any>((su.found.positions ?? []).map((p) => p.bot));
      su.busy = false;
      to("pick", su.mission.trim());
    } catch (err) {
      su.busy = false;
      su.error = err.message;
      draw();
    }
  };
  const add = async () => {
    const org = activeOrg();
    const keep = (su.found?.positions ?? []).filter((p) => su.picked.has(p.bot));
    if (!keep.length) return;
    su.busy = true;
    draw();
    try {
      // A position whose manager was not kept reports to the owner.
      for (const p of keep) await api("POST", `orgs/${org.id}/accept`, { bot: p.bot, group: p.group, reportsTo: keep.some((x) => x.bot === p.reportsTo) ? p.reportsTo : undefined });
      await Promise.all([loadOrgs(), loadCrew()]);
      su.busy = false;
      to("done", `Add ${keep.length === 1 ? "this one" : `these ${keep.length}`}`);
    } catch (err) {
      su.busy = false;
      su.error = err.message;
      await Promise.all([loadOrgs(), loadCrew()]).catch(() => {});
      draw();
    }
  };

  function draw() {
    const org = activeOrg();
    const noModel = needsKey(state.config);
    const team = org?.members ?? [];
    const steps: any[] = [];
    steps.push(say(`Hi${first ? ` ${first}` : ""}. I'm your assistant. This is where you and a team of AI agents get work done: you ask, they do it, and anything that sends, changes or deletes waits for your yes.`, "Two things get you going. Where do you want to start?"));
    if (su.step === "start") {
      steps.push(
        card(
          "Where do you want to start?",
          "",
          h(
            "div",
            { class: "setupopts" },
            choice("Build my team", team.length ? `You have ${team.length} agent${team.length === 1 ? "" : "s"}. Add more.` : "Tell me what your business does and I'll suggest who you need.", () => to("mission", "Build my team"), !team.length),
            choice("Connect an AI model", noModel ? "Your agents think with it. Needed before they can work." : "Connected. Change it or add another.", () => to("model", "Connect an AI model"), team.length && noModel),
            choice("Just let me ask something", "Skip set-up and go to the ask box. You can come back from there.", () => finish("start")),
          ),
        ),
      );
    }
    for (const text of su.said.slice(0, 1)) steps.push(mine(text));

    if (su.step === "mission") {
      const mission = h("input", { id: "setup-mission", value: su.mission || org?.mission || "", maxlength: 300, placeholder: "e.g. We bake bread and deliver it to cafés in town.", "aria-label": "What your business does" });
      mission.addEventListener("input", () => (su.mission = mission.value));
      mission.addEventListener("keydown", (e) => e.key === "Enter" && mission.value.trim() && ((su.mission = mission.value), suggest()));
      su.mission = mission.value;
      const quick = [["A shop or café", "We run a shop and serve customers in person."], ["Professional services", "We sell our time and advice to clients and bill them for it."], ["An online shop", "We sell products online and ship them to customers."], ["A nonprofit", "We raise funds and run programmes for our community."]];
      steps.push(
        say("What does your business do? One sentence is enough. Every agent is told it, and it shapes who I suggest."),
        card(
          "What your business does",
          "",
          h("div", { class: "setupbody" }, mission, h("div", { class: "ideachips" }, quick.map(([label, sentence]) => h("button", { type: "button", class: "ideachip", onclick: () => ((mission.value = sentence), (su.mission = sentence), mission.focus()) }, label))), su.error ? h("div", { class: "banner error" }, su.error) : null),
          [h("span", { class: "note small grow" }, su.busy ? "Finding the right positions…" : "Nothing is added until you say so."), h("button", { class: "plain", onclick: () => back("start") }, "Back"), h("button", { class: "primary", disabled: su.busy, onclick: () => (mission.value.trim() ? suggest() : mission.focus()) }, "Continue")],
        ),
      );
      setTimeout(() => mission.focus(), 0);
    }
    if (su.step === "pick" || su.step === "done") steps.push(mine(su.said[1] ?? su.mission));
    if (su.step === "pick") {
      const found = su.found?.positions ?? [];
      const market = new Map<any, any>((state.market ?? []).map((b) => [b.id, b]));
      const crew = new Map<any, any>((state.crew?.bots ?? []).map((b) => [b.id, b]));
      steps.push(
        say(found.length ? `For that, I'd start with ${found.length === 1 ? "this position" : `these ${found.length} positions`}. Untick any you don't want. You can add, remove and rearrange them later under Team.` : "I could not match positions to that. Try saying a little more about what you sell or do, or add agents yourself under Team."),
        card(
          "Who you need",
          su.found?.intro ?? "",
          h(
            "div",
            { class: "setuplist" },
            found.map((p) => {
              const bot = market.get(p.bot) ?? crew.get(p.bot);
              const box = h("input", { type: "checkbox", id: `setup-pick-${p.bot}`, checked: su.picked.has(p.bot), onchange: () => (box.checked ? su.picked.add(p.bot) : su.picked.delete(p.bot), draw()) });
              return h("label", { class: `setuprow ${su.picked.has(p.bot) ? "on" : ""}` }, box, bot ? keycap(bot, 26, "", bot.type) : null, h("span", { class: "grow" }, h("b", {}, p.title), h("span", { class: "note small" }, `${p.group} · ${p.why}`)));
            }),
            su.error ? h("div", { class: "banner error" }, su.error) : null,
          ),
          [h("span", { class: "note small grow" }, su.busy ? "Adding them…" : `${su.picked.size} chosen`), h("button", { class: "plain", onclick: () => back("mission") }, "Back"), h("button", { class: "primary", disabled: su.busy || !su.picked.size, onclick: add }, su.picked.size === 1 ? "Add this one" : `Add these ${su.picked.size}`)],
        ),
      );
    }
    if (su.step === "done") {
      steps.push(mine(su.said[2] ?? "Add them"));
      steps.push(
        say(`Done. Your team has ${team.length} agent${team.length === 1 ? "" : "s"}: ${team.slice(0, 8).map((m) => m.title).join(", ")}${team.length > 8 ? " and more" : ""}.`, noModel ? "One thing is left before they can work: an AI model for them to think with." : "They are ready. Ask for what you need in your own words."),
        card("What next?", "", h("div", { class: "setupopts" }, noModel ? choice("Connect an AI model", "Paste a key from a service such as Claude, or use a free model on this computer.", () => to("model", "Connect an AI model"), true) : choice("Give the first task", "Go to the ask box. I'll suggest three things to try.", () => finish("start"), true), noModel ? choice("Later", "Go to the ask box. It will remind you.", () => finish("start")) : choice("See my team", "Open the chart to rearrange it or set budgets.", () => finish("team")))),
      );
    }
    if (su.step === "model") {
      steps.push(
        say(noModel ? "Your agents think with an AI model. Talqava does not come with one: you connect your own, so your work goes only where you choose." : "An AI model is connected. You can add another as a backup.", "There are two ways."),
        card(
          "Connect an AI model",
          "",
          h(
            "div",
            { class: "setupopts" },
            choice("Use a service with a key", "Claude is the standard. You paste a key from your account with the service; it stays on this computer.", () => ((ui.integration = "ai-models"), go("integrations")), true),
            choice("Use a free model on this computer", "Nothing leaves your computer. It is slower, and needs a recent computer with enough memory.", () => ((ui.integration = "ai-models"), go("integrations"))),
          ),
          [h("span", { class: "note small grow" }, "Both open the AI models page. Come back to New when it is connected."), h("button", { class: "plain", onclick: () => back(team.length && su.said.length > 1 ? "done" : "start") }, "Back")],
        ),
      );
    }
    fill(col, steps);
    col.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    const line = (done, title, about) => h("div", { class: `setupline ${done ? "done" : ""}` }, h("span", { class: "setuptick", "aria-hidden": "true" }, done ? "✓" : ""), h("div", {}, h("b", {}, title), h("span", { class: "note small" }, about)));
    fill(
      side,
      h("div", { class: "label" }, "Overview"),
      line(team.length > 0, "Your team", team.length ? `${team.length} agent${team.length === 1 ? "" : "s"}` : "Nobody yet"),
      line(!noModel, "An AI model", noModel ? "Not connected yet" : "Connected"),
      line(false, "Your first task", "Ask for it in the box on New"),
      h("p", { class: "note small" }, "When you start working, this is where you will see what is waiting on you, what is being worked on, and what is done."),
      h("button", { class: "plain link small", onclick: () => finish("start") }, "Skip set-up"),
    );
  }
  draw();
}

/** A card for a ready-made Office file: preview its summary, make a file from it. */
function officeTemplateCard(t) {
  const kind = { doc: "Document", sheet: "Sheet", note: "Note" }[t.kind];
  return h(
    "article",
    { class: "mcard tcard" },
    h("div", { class: "mhead" }, h("span", { class: "packicon conn", "aria-hidden": "true" }, kind[0]), h("div", {}, h("b", {}, t.name), h("div", { class: "by" }, `${kind} template`))),
    h("p", { class: "mdesc" }, t.summary, t.uses ? ` Best filled from your “${t.uses}” page.` : ""),
    h("div", { class: "mfoot" }, h("span", { class: "mono small muted" }, "Free · delete the file to undo"), h("button", { class: "madd primary", onclick: () => attempt(async () => ((p) => (toast(`A new ${kind.toLowerCase()} was made from “${t.name}”. Replace the parts in [SQUARE BRACKETS].`), openPage(p.id)))(await api("POST", `workspace/office-templates/${t.id}`))) }, "Use this template")),
  );
}

/** Office home: start something, what is waiting, recent files of every kind, and a search across them all. */
async function officeView() {
  ui.body.className = "body";
  ui.log = null;
  ui.wsFlush?.();
  const col = h("div", { class: "integrations officehomepage" });
  fill(ui.body, h("main", { class: "center" }, col));
  let data, templates, library;
  try {
    [data, templates, library] = await Promise.all([api("GET", "workspace/office"), api("GET", "workspace/office-templates"), api("GET", "library").catch(() => ({ documents: [] })), state.crew ? null : loadCrew(), state.orgs ? null : loadOrgs()]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "office") return;
  const org = activeOrg();
  const KIND = { doc: ["Document", "Letters, proposals, policies", "docs"], sheet: ["Sheet", "Budgets, forecasts, lists that calculate", "sheets"], deck: ["Slides", "Pitches, reviews, training", "slides"], note: ["Note", "Quick thoughts, meetings, saved pages", "notes"] };
  const start = (kind) =>
    attempt(async () => {
      const page = kind === "sheet" ? await api("POST", "workspace/sheets", { title: "Untitled sheet" }) : await api("POST", "workspace/pages", { kind, title: kind === "deck" ? "Untitled slides" : "Untitled", ...(kind === "deck" ? { markdown: "# Title of the presentation\n\nA line about what it covers\n" } : {}) });
      ui.ws ??= { collapsed: new Set<any>() };
      ui.ws.focusTitle = true;
      openPage(page.id);
    }, col);
  const what = h("input", { placeholder: "e.g. A cash forecast for the next three months, from our sales sheet", "aria-label": "What should the agent make" });
  const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const ask = () =>
    attempt(async () => {
      const text = what.value.trim();
      if (!text) throw new Error("Say what the agent should make.");
      const quest = await startTask({ bot: who.value, text: `Make this: ${text}\n\nFirst look in the workspace for pages that apply (prices, procedures, rules) and follow them. If it is writing, save it as an Office document with the workspace tool (action "file", kind "document"). If it is numbers that calculate, make a sheet with the sheet tool (action "create", then "set"). Say in your report where it is.`, title: `Make: ${text}`.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  const waiting = data.files.filter((f) => f.suggestions);
  const q = h("input", { type: "search", placeholder: "Search documents, notes and pages, including the words inside", "aria-label": "Search Office" });
  const results = h("div");
  // Everything in one list: documents and notes, workspace pages, and the files in the library, newest change first.
  const KIND_WORDS = { doc: "Document", note: "Note", page: "Page", file: "Library file", sheet: "Sheet", deck: "Slides" };
  const office = data.files.filter((f) => lab("office") || (f.kind !== "sheet" && f.kind !== "deck"));
  const aside = data.files.length - office.length;
  const everything = [
    ...office.map((f) => ({ kind: f.kind, title: f.title, sub: f.folder, when: f.updatedAt, by: f.updatedBy, who: officeWho(f), level: f.level, pinned: f.pinned, open: () => openPage(f.id) })),
    ...(data.tree ?? []).filter((p) => p.kind === "page").map((p) => ({ kind: "page", title: p.title, sub: "", when: p.updatedAt, by: p.updatedBy, who: p.access ? officeWho(p) : "", level: p.level, pinned: false, open: () => openPage(p.id) })),
    ...(library.documents ?? []).map((d) => ({ kind: "file", title: d.name, sub: d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : "", when: new Date(d.modified).toISOString(), by: "", who: d.access ? officeWho(d) : "", level: d.level, pinned: false, open: () => ((ui.libFind = d.name), go("library")) })),
  ].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.when).localeCompare(String(a.when)));
  const kinds = ["doc", "note", "page", "file", "sheet", "deck"].filter((k) => everything.some((x) => x.kind === k));
  const recent = () => {
    const pick = kinds.includes(ui.filesKind) ? ui.filesKind : "all";
    const rows = everything.filter((x) => pick === "all" || x.kind === pick);
    const most = ui.filesAll ? rows.length : 50;
    const again = () => fill(results, recent());
    return [
      h("div", { class: "fileskinds", role: "tablist", "aria-label": "Kind of file" }, [["all", "Everything"], ...kinds.map((k) => [k, k === "deck" ? "Slides" : `${KIND_WORDS[k]}s`])].map(([k, label]) => h("button", { class: `mpill ${pick === k ? "on" : ""}`, role: "tab", "aria-selected": String(pick === k), onclick: () => ((ui.filesKind = k), (ui.filesAll = false), again()) }, label, h("span", { class: "autocount" }, String(k === "all" ? everything.length : everything.filter((x) => x.kind === k).length))))),
      rows.length
        ? h(
            "div",
            { class: "card officetable" },
            h(
              "table",
              {},
              h("thead", {}, h("tr", {}, ["Name", "Kind", "Last change", "Who can read it", "Sensitivity"].map((t) => h("th", { scope: "col" }, t)))),
              h("tbody", {}, rows.slice(0, most).map((f) => h("tr", {}, h("td", {}, h("button", { class: "plain link", onclick: f.open }, f.title), f.pinned ? h("span", { class: "tag" }, "pinned") : null), h("td", {}, `${KIND_WORDS[f.kind] ?? "Page"}${f.sub ? ` · ${f.sub}` : ""}`), h("td", {}, `${f.by ? `${f.by} · ` : ""}${officeDay(f.when)}`), h("td", {}, f.who), h("td", {}, LEVEL_NAMES[f.level] ?? "Internal")))),
            ),
          )
        : h("p", { class: "note" }, "Nothing of this kind yet."),
      rows.length > most ? h("button", { class: "plain link", onclick: () => ((ui.filesAll = true), again()) }, `Show all ${rows.length}`) : null,
      aside ? h("p", { class: "note small" }, `${aside} sheet${aside === 1 ? " or presentation is" : "s and presentations are"} set aside and not listed. Switch on Sheets and Slides under Settings › Labs to see ${aside === 1 ? "it" : "them"}.`) : null,
    ];
  };
  let timer = null;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const text = q.value.trim();
      if (text.length < 2) return fill(results, everything.length ? recent() : h("p", { class: "note" }, "Nothing yet. Start something above."));
      const hits = (await api("GET", `workspace/search?q=${encodeURIComponent(text)}`).catch(() => [])).filter((x) => office.some((f) => f.id === x.page) || (data.tree ?? []).some((p) => p.kind === "page" && p.id === x.page));
      const seen = new Set<any>();
      fill(results, h("div", { class: "label" }, `Found for “${text}”`), hits.length ? hits.filter((x) => !seen.has(x.page) && seen.add(x.page)).map((x) => h("button", { class: "plain card officewait", onclick: () => openPage(x.page) }, h("b", {}, x.title), h("div", { class: "note small" }, x.text.slice(0, 200)))) : h("p", { class: "note" }, "Nothing matches that in your documents, sheets or notes."));
    }, 250);
  });
  fill(
    col,
    h("div", {}, h("h1", {}, "Files"), h("p", { class: "lead" }, "Everything you and your agents make and work from, in one place: documents, notes, pages and the files in your library. It all stays on this computer.")),
    // With nothing made yet, the page is only the ways to start: no search over nothing, no empty list.
    everything.length ? q : null,
    h("section", { class: "isec" }, h("h2", {}, "Start something"), h("div", { class: "mgrid wide" }, Object.entries(KIND).filter(([kind]) => lab("office") || (kind !== "sheet" && kind !== "deck")).map(([kind, [name, about]]) => h("button", { class: "plain card officestart", onclick: () => start(kind) }, h("b", {}, `+ ${name}`), h("div", { class: "note small" }, about))), h("button", { class: "plain card officestart", onclick: () => go("library") }, h("b", {}, "+ Files from your computer"), h("div", { class: "note small" }, "PDFs, Word and Excel files, pictures"))), org.members.length ? h("form", { class: "card form officeask", onsubmit: (e) => (e.preventDefault(), ask()) }, h("b", {}, "Or ask an agent to make it"), h("div", { class: "row wrap" }, what, who, h("button", {}, "Give the task"))) : null),
    waiting.length ? h("section", { class: "isec" }, h("h2", {}, `Waiting for you · ${waiting.length}`), waiting.map((f) => h("button", { class: "plain card officewait", onclick: () => openPage(f.id) }, h("b", {}, f.title), h("span", { class: "note small" }, ` · ${KIND[f.kind]?.[0] ?? ""} · ${f.suggestions} change${f.suggestions === 1 ? "" : "s"} from an agent to review`)))) : null,
    everything.length ? h("section", { class: "isec" }, h("h2", {}, "All files"), results) : null,
    !everything.length ? null : h("section", { class: "isec filesmore" }, h("h2", {}, "Work in one kind"), h("p", { class: "note", style: "margin: -6px 0 12px" }, "Each kind has its own page, with folders and its own tools."), h("div", { class: "row wrap" }, [["docs", "Documents"], ["notes", "Notes"], ["workspace", "Workspace pages"], ["library", "Library: add and organize files"], ...(lab("office") ? [["sheets", "Sheets"], ["slides", "Slides"]] : [])].map(([v, label]) => h("button", { onclick: () => go(v) }, label)))),
    h("section", { class: "isec" }, h("h2", {}, "Start from a template"), h("p", { class: "note", style: "margin: -6px 0 12px" }, "Ready-made files with the parts to fill in marked in [SQUARE BRACKETS]."), h("div", { class: "mgrid wide" }, templates.filter((t) => lab("office") || (t.kind !== "sheet" && t.kind !== "deck")).map(officeTemplateCard))),
  );
  q.dispatchEvent(new Event("input"));
}

/** Office › Documents: letters, proposals and reports, by folder. Agents write them, suggest changes, or read them. */
async function docsView() {
  const side = h("aside", { class: "side wsside", "aria-label": "Documents" });
  const col = h("main", { class: "center wscenter" });
  const data = await officeLoad("docs", side, col);
  if (!data) return;
  const docs = data.files.filter((f) => f.kind === "doc");
  const org = activeOrg();
  const drawSide = (files = docs) => {
    const groups = new Map<any, any>();
    for (const f of files) (groups.get(f.folder || "") ?? groups.set(f.folder || "", []).get(f.folder || "")).push(f);
    const row = (f) => h("button", { class: `plain wsrow officerow ${ui.ws.open === f.id ? "on" : ""}`, "aria-current": ui.ws.open === f.id ? "true" : null, onclick: () => ((ui.ws.open = f.id), docsView()) }, h("span", { class: "grow" }, f.title), f.suggestions ? h("span", { class: "count", title: "Suggested changes waiting for you" }, String(f.suggestions)) : null);
    fill(
      side,
      h("div", { class: "wssidehead" }, h("button", { class: `plain wshome ${ui.ws.open ? "" : "on"}`, onclick: () => ((ui.ws.open = null), docsView()) }, "Documents"), h("button", { class: "small", onclick: () => officeNew("doc") }, "+ Document")),
      [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((name) => [h("div", { class: "label officegroup" }, name || (groups.size > 1 ? "No folder" : "All documents")), groups.get(name).map(row)]),
      docs.length ? null : h("p", { class: "note small", style: "padding: 8px 10px" }, "No documents yet."),
    );
  };
  ui.ws.refreshSide = async () => ((ui.ws.data = await api("GET", "workspace/office")), state.view === "docs" && flags.docsSide?.(ui.ws.data.files.filter((f) => f.kind === "doc")));
  flags.docsSide = drawSide;
  drawSide();
  if (ui.ws.open) return renderWsPage(col, ui.ws.open);

  const what = h("input", { placeholder: "e.g. A one-page proposal for a new customer, using our price list", "aria-label": "What should the document say" });
  const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const ask = () =>
    attempt(async () => {
      const text = what.value.trim();
      if (!text) throw new Error("Say what the document should be.");
      const quest = await startTask({ bot: who.value, text: `Write this document: ${text}\n\nBefore you write, look in the workspace for pages that apply (prices, procedures, rules) and follow them. Save the finished document with the workspace tool: action "file", kind "document", with a clear title. Say in your report where it is.`, title: `Write: ${text}`.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  const waiting = docs.filter((f) => f.suggestions);
  const q = h("input", { type: "search", placeholder: "Find a document by name or folder", "aria-label": "Find a document" });
  const table = h("div");
  const drawTable = () => {
    const needle = q.value.trim().toLowerCase();
    const shown = docs.filter((f) => !needle || `${f.title} ${f.folder} ${f.summary}`.toLowerCase().includes(needle));
    drawSide(shown);
    fill(
      table,
      shown.length
        ? h(
            "div",
            { class: "card officetable" },
            h(
              "table",
              {},
              h("thead", {}, h("tr", {}, ["Name", "Folder", "Last change", "Who can read it", "Agents' changes"].map((t) => h("th", { scope: "col" }, t)))),
              h(
                "tbody",
                {},
                shown.map((f) =>
                  h(
                    "tr",
                    {},
                    h("td", {}, h("button", { class: "plain link", onclick: () => ((ui.ws.open = f.id), docsView()) }, f.title), f.protected ? h("span", { class: "tag" }, "protected") : null),
                    h("td", {}, f.folder || "—"),
                    h("td", {}, `${f.updatedBy} · ${officeDay(f.updatedAt)}`),
                    h("td", {}, officeWho(f)),
                    h("td", {}, f.protected || f.edit !== "direct" ? "Wait for you" : "Straight away"),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "note" }, docs.length ? "No document matches that." : "No documents yet. Start one with + Document, or ask an agent to write one."),
    );
  };
  q.addEventListener("input", drawTable);
  fill(
    col,
    h("div", { class: "officehome" }, h("h1", {}, "Documents"), h("p", { class: "lead" }, "Letters, proposals and reports. You write them, or an agent does; an agent's changes to your document wait for you to accept, unless you let them through.")),
    h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: () => officeNew("doc") }, "+ New document"), h("button", { onclick: () => importOfficeFile(".docx", col) }, "Import a Word file"), q),
    org.members.length ? h("form", { class: "card form officeask", onsubmit: (e) => (e.preventDefault(), ask()) }, h("b", {}, "Or ask an agent to write it"), h("div", { class: "row wrap" }, what, who, h("button", {}, "Give the task")), h("p", { class: "note small" }, "The agent's document appears here when the task is done. It follows your Workspace pages, such as your price list.")) : null,
    waiting.length ? h("section", {}, h("div", { class: "label" }, `Waiting for you · ${waiting.length}`), waiting.map((f) => h("button", { class: "plain card officewait", onclick: () => ((ui.ws.open = f.id), docsView()) }, h("b", {}, f.title), h("span", { class: "note small" }, ` · ${f.suggestions} suggested change${f.suggestions === 1 ? "" : "s"} to review`)))) : null,
    table,
  );
  drawTable();
}

/** Office › Sheets: files of cells with formulas. Agents read the worked-out values and change cells under the file's rules. */
async function sheetsView() {
  const side = h("aside", { class: "side wsside", "aria-label": "Sheets" });
  const col = h("main", { class: "center wscenter" });
  const data = await officeLoad("sheets", side, col);
  if (!data) return;
  const files = data.files.filter((f) => f.kind === "sheet");
  const org = activeOrg();
  const make = (body) =>
    attempt(async () => {
      const page = await api("POST", "workspace/sheets", body);
      ui.ws.open = page.id;
      sheetsView();
    }, col);
  const fromCsv = () => {
    const input = h("input", { type: "file", accept: ".csv,text/csv" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2_000_000) return toast("That file is larger than 2 MB. Split it into smaller files.");
      make({ title: file.name.replace(/\.csv$/i, ""), csv: await file.text() });
    });
    input.click();
  };
  const groups = new Map<any, any>();
  for (const f of files) (groups.get(f.folder || "") ?? groups.set(f.folder || "", []).get(f.folder || "")).push(f);
  const row = (f) => h("button", { class: `plain wsrow officerow ${ui.ws.open === f.id ? "on" : ""}`, "aria-current": ui.ws.open === f.id ? "true" : null, onclick: () => ((ui.ws.open = f.id), sheetsView()) }, h("span", { class: "grow" }, f.title), f.suggestions ? h("span", { class: "count", title: "Changes waiting for you" }, String(f.suggestions)) : null);
  fill(
    side,
    h("div", { class: "wssidehead" }, h("button", { class: `plain wshome ${ui.ws.open ? "" : "on"}`, onclick: () => ((ui.ws.open = null), sheetsView()) }, "Sheets"), h("button", { class: "small", onclick: () => make({ title: "Untitled" }) }, "+ Sheet")),
    [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((name) => [h("div", { class: "label officegroup" }, name || (groups.size > 1 ? "No folder" : "All sheets")), groups.get(name).map(row)]),
    files.length ? null : h("p", { class: "note small", style: "padding: 8px 10px" }, "No sheets yet."),
  );
  if (ui.ws.open) return renderSheet(col, ui.ws.open);

  const what = h("input", { placeholder: "e.g. A cash forecast for the next three months, with a total for each month", "aria-label": "What should the sheet work out" });
  const who = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const ask = () =>
    attempt(async () => {
      const text = what.value.trim();
      if (!text) throw new Error("Say what the sheet should work out.");
      const quest = await startTask({ bot: who.value, text: `Build this sheet: ${text}\n\nUse the sheet tool: create a sheet file with a clear title, then fill it with set. Put headings in row 1, one kind of thing in each column, and use formulas for every total so it recalculates. Say in your report where it is and where its numbers came from.`, title: `Sheet: ${text}`.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  const waiting = files.filter((f) => f.suggestions);
  fill(
    col,
    h("div", { class: "officehome" }, h("h1", {}, "Sheets"), h("p", { class: "lead" }, "Budgets, forecasts and lists that calculate. Type numbers and formulas; agents read the results, and their changes to your cells wait for you unless you let them through.")),
    h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: () => make({ title: "Untitled" }) }, "+ New sheet"), h("button", { onclick: fromCsv }, "Import a CSV file"), h("button", { onclick: () => importOfficeFile(".xlsx", col) }, "Import an Excel file")),
    org.members.length ? h("form", { class: "card form officeask", onsubmit: (e) => (e.preventDefault(), ask()) }, h("b", {}, "Or ask an agent to build it"), h("div", { class: "row wrap" }, what, who, h("button", {}, "Give the task")), h("p", { class: "note small" }, "The agent's sheet appears here when the task is done.")) : null,
    waiting.length ? h("section", {}, h("div", { class: "label" }, `Waiting for you · ${waiting.length}`), waiting.map((f) => h("button", { class: "plain card officewait", onclick: () => ((ui.ws.open = f.id), sheetsView()) }, h("b", {}, f.title), h("span", { class: "note small" }, " · an agent's changes to review")))) : null,
    files.length
      ? h(
          "div",
          { class: "card officetable" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, ["Name", "Folder", "What is in it", "Last change", "Who can read it"].map((t) => h("th", { scope: "col" }, t)))),
            h("tbody", {}, files.map((f) => h("tr", {}, h("td", {}, h("button", { class: "plain link", onclick: () => ((ui.ws.open = f.id), sheetsView()) }, f.title), f.protected ? h("span", { class: "tag" }, "protected") : null), h("td", {}, f.folder || "—"), h("td", {}, f.summary), h("td", {}, `${f.updatedBy} · ${officeDay(f.updatedAt)}`), h("td", {}, officeWho(f))))),
          ),
        )
      : h("p", { class: "note" }, "No sheets yet. Start one with + New sheet, import a CSV file, or ask an agent to build one."),
  );
}

/** One sheet file: the grid, its formula bar, sheets, charts, the rules for agents, and any changes waiting. */
async function renderSheet(col, id) {
  let page, suggestions, eng;
  try {
    [page, suggestions, eng] = await Promise.all([api("GET", `workspace/pages/${id}`), api("GET", `workspace/suggestions?page=${encodeURIComponent(id)}`), import("/sheet-engine.js")]);
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "sheets" || ui.ws.open !== id) return;
  const org = activeOrg();
  const file = eng.parseFile(page.markdown);
  ui.sheet ??= {};
  const mem = (ui.sheet[id] ??= { tab: 0, rows: 0, cols: 0 });
  if (mem.tab >= file.sheets.length) mem.tab = 0;
  let value = eng.compute(file);
  let sel = { c1: 0, r1: 0, c2: 0, r2: 0 };
  let active = { col: 0, row: 0 };
  const sheet = () => file.sheets[mem.tab];

  // ----- saving as you type -----
  let rev = page.rev;
  let timer = null;
  let saving = Promise.resolve();
  const status = h("span", { class: "wsstatus note small", role: "status" }, "Saved");
  const conflict = h("div");
  const save = () => {
    clearTimeout(timer);
    timer = null;
    status.textContent = "Saving…";
    const markdown = eng.writeFile(file);
    saving = saving.then(async () => {
      try {
        rev = (await api("PUT", `workspace/pages/${id}`, { markdown, baseRev: rev })).rev;
        status.textContent = "Saved";
      } catch (err) {
        status.textContent = "Not saved";
        fill(conflict, h("div", { class: "banner error" }, err.message, " ", h("button", { class: "small", onclick: () => sheetsView() }, "Reload")));
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
  ui.wsEditor = { destroy() {}, markdown: () => eng.writeFile(file) };
  const flush = async () => (timer && save(), await saving);

  const title = h("input", { class: "wstitlebox", value: page.title === "Untitled" ? "" : page.title, placeholder: "Untitled", maxlength: 120, "aria-label": "Sheet title" });
  title.addEventListener("change", () => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { title: (page.title = title.value.trim() || "Untitled") }), ui.ws.refreshSide?.()), col));
  ui.ws.refreshSide = async () => {};

  // ----- cells waiting for the owner -----
  const pending = suggestions.map((s) => ({ s, cells: eng.diffFiles(file, eng.parseFile(s.markdown)) }));
  const waitingRefs = () => new Set<any>(pending.flatMap((p) => p.cells.filter((c) => c.sheet === sheet().name).map((c) => c.ref)));

  // ----- the grid -----
  const bar = h("input", { class: "sheetbar mono", "aria-label": "What is in the selected cell", placeholder: "Type a value, or a formula starting with =" });
  const where = h("span", { class: "sheetwhere mono" }, "A1");
  const gridBox = h("div", { class: "sheetscroll" });
  const chartsBox = h("div", { class: "sheetcharts" });
  const tabsBox = h("div", { class: "sheettabs", role: "tablist", "aria-label": "Sheets in this file" });
  const inputs = new Map<any, any>();
  const selName = () => eng.rangeName(sel);
  const paint = () => {
    const waiting = waitingRefs();
    for (const [ref, input] of inputs) {
      const { col: c, row: r } = eng.parseRef(ref);
      const v = value(mem.tab, c, r);
      if (document.activeElement !== input) input.value = eng.show(v, eng.formatOf(sheet(), c, r));
      const td = input.parentNode;
      td.className = [typeof v === "number" ? "n" : "", eng.isError(v) ? "bad" : "", eng.isLocked(sheet(), c, r) ? "locked" : "", waiting.has(ref) ? "sug" : "", c >= sel.c1 && c <= sel.c2 && r >= sel.r1 && r <= sel.r2 ? "sel" : ""].join(" ");
    }
    where.textContent = selName();
  };
  const commit = (c, r, raw) => {
    const ref = eng.refName(c, r);
    const text = String(raw).trim();
    if ((sheet().cells[ref] ?? "") === text) return;
    if (text === "") delete sheet().cells[ref];
    else sheet().cells[ref] = text.slice(0, 2000);
    value = eng.compute(file);
    paint();
    drawCharts();
    changed();
  };
  const focusCell = (c, r) => inputs.get(eng.refName(c, r))?.focus();
  const drawGrid = () => {
    const used = eng.extent(sheet());
    const rows = Math.min(eng.MAX_ROWS, Math.max(used.rows + 4, 20) + mem.rows);
    const cols = Math.min(eng.MAX_COLS, Math.max(used.cols + 3, 8) + mem.cols);
    inputs.clear();
    const body: any[] = [];
    for (let r = 0; r < rows; r++) {
      const cells = [h("th", { scope: "row" }, String(r + 1))];
      for (let c = 0; c < cols; c++) {
        const ref = eng.refName(c, r);
        const input = h("input", { "aria-label": ref, autocomplete: "off", spellcheck: "false" });
        input.addEventListener("focus", () => {
          input.value = sheet().cells[ref] ?? "";
          bar.value = input.value;
          if (!input.dataset.keep) sel = { c1: c, r1: r, c2: c, r2: r };
          delete input.dataset.keep;
          active = { col: c, row: r };
          paint();
        });
        input.addEventListener("mousedown", (e) => {
          if (!e.shiftKey) return;
          // Shift and click stretches the selection from the cell you were in.
          sel = { c1: Math.min(active.col, c), r1: Math.min(active.row, r), c2: Math.max(active.col, c), r2: Math.max(active.row, r) };
          e.preventDefault();
          paint();
        });
        input.addEventListener("input", () => (bar.value = input.value));
        input.addEventListener("blur", () => (commit(c, r, input.value), paint()));
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === "ArrowDown") (e.preventDefault(), focusCell(c, Math.min(r + 1, rows - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), focusCell(c, Math.max(r - 1, 0)));
          else if (e.key === "Escape") ((input.value = sheet().cells[ref] ?? ""), input.blur());
        });
        inputs.set(ref, input);
        cells.push(h("td", {}, input));
      }
      body.push(h("tr", {}, cells));
    }
    fill(gridBox, h("table", { class: "sheetgrid" }, h("thead", {}, h("tr", {}, h("th", {}), Array.from({ length: cols }, (_, c) => h("th", { scope: "col" }, eng.colName(c))))), h("tbody", {}, body)));
    paint();
  };
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commit(active.col, active.row, bar.value);
    focusCell(active.col, active.row + 1);
  });
  bar.addEventListener("change", () => commit(active.col, active.row, bar.value));

  // ----- charts -----
  const seriesOf = (range) => chartPoints(eng, value, mem.tab, range);
  const drawCharts = () => {
    fill(
      chartsBox,
      sheet().charts.map((ch, i) => {
        const pts = seriesOf(ch.range);
        const max = Math.max(1, ...pts.map((p) => Math.abs(p.v)));
        const words = pts.map((p) => `${p.label} ${eng.show(p.v, "number")}`).join("; ") || "no numbers in that range";
        const picture =
          ch.type === "line" && pts.length > 1
            ? (() => {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("viewBox", "0 0 300 110");
                svg.setAttribute("class", "sheetline");
                const low = Math.min(0, ...pts.map((p) => p.v));
                const high = Math.max(...pts.map((p) => p.v), low + 1);
                const xy = pts.map((p, n) => `${10 + (280 * n) / (pts.length - 1)},${100 - (90 * (p.v - low)) / (high - low)}`).join(" ");
                svg.innerHTML = `<polyline fill="none" stroke="currentColor" stroke-width="2" points="${xy}"/>`;
                return h("div", {}, svg, h("div", { class: "sheetlinelabels note small" }, pts.map((p) => h("span", {}, p.label))));
              })()
            : h("div", { class: "sheetbars" }, pts.map((p) => h("div", { class: "sheetbarrow" }, h("span", { class: "sheetbarlabel" }, p.label), h("span", { class: "sheetbarfill", style: `width: ${Math.max(1, (Math.abs(p.v) / max) * 100).toFixed(1)}%` }), h("span", { class: "mono small" }, eng.show(p.v, "number")))));
        return h(
          "figure",
          { class: "card sheetchart" },
          h("figcaption", { class: "row" }, h("b", { class: "grow" }, ch.title || "Chart"), h("span", { class: "note small mono" }, eng.rangeName(ch.range)), h("button", { class: "plain small danger", "aria-label": `Remove the chart ${ch.title || ""}`, onclick: () => (sheet().charts.splice(i, 1), drawCharts(), changed()) }, "Remove")),
          h("div", { role: "img", "aria-label": `${ch.type === "line" ? "Line" : "Bar"} chart. ${words}` }, pts.length ? picture : h("p", { class: "note small" }, "There are no numbers in that range yet.")),
        );
      }),
    );
  };

  // ----- sheets in the file -----
  const drawTabs = () =>
    fill(
      tabsBox,
      file.sheets.map((s, i) => h("button", { class: `mpill ${i === mem.tab ? "on" : ""}`, role: "tab", "aria-selected": String(i === mem.tab), onclick: () => ((mem.tab = i), (sel = { c1: 0, r1: 0, c2: 0, r2: 0 }), drawAll()) }, s.name)),
      h("button", { class: "plain small", onclick: () => ((n) => n && (file.sheets.push(eng.parseFile(`!sheet ${n}`).sheets[0]), (mem.tab = file.sheets.length - 1), (value = eng.compute(file)), drawAll(), changed()))(prompt("Name the new sheet", `Sheet ${file.sheets.length + 1}`)) }, "+ Add a sheet"),
      h("button", { class: "plain small", onclick: () => ((n) => n && n.trim() && ((sheet().name = eng.parseFile(`!sheet ${n}`).sheets[0].name), (value = eng.compute(file)), drawAll(), changed()))(prompt("Rename this sheet (formulas in other sheets that use its name will need the new name)", sheet().name)) }, "Rename"),
      file.sheets.length > 1 ? h("button", { class: "plain small danger", onclick: () => confirm(`Remove the sheet “${sheet().name}” and everything in it? You can get it back from History.`) && (file.sheets.splice(mem.tab, 1), (mem.tab = 0), (value = eng.compute(file)), drawAll(), changed()) }, "Remove this sheet") : null,
    );
  const drawAll = () => (drawTabs(), drawGrid(), drawCharts());

  // ----- the toolbar -----
  const format = h("select", { "aria-label": "Number format for the selected cells" }, [["plain", "As typed"], ["number", "Number 1,234.5"], ["money", "Money 1,234.50"], ["percent", "Percent 12%"]].map(([v, t]) => h("option", { value: v }, t)));
  format.addEventListener("change", () => ((sheet().formats = sheet().formats.filter((f) => eng.rangeName(f.range) !== selName())), sheet().formats.push({ range: { ...sel }, format: format.value }), paint(), changed()));
  const touches = (r) => !(r.c2 < sel.c1 || r.c1 > sel.c2 || r.r2 < sel.r1 || r.r1 > sel.r2);
  const addChart = (type) => {
    if (sel.c1 === sel.c2 && sel.r1 === sel.r2) return toast("Select the cells to chart first: click the first cell, then hold Shift and click the last.");
    const name = prompt("Name the chart", "Chart");
    if (name === null) return;
    sheet().charts.push({ type, range: { ...sel }, title: name.trim().slice(0, 80) });
    drawCharts();
    changed();
  };
  const exportCsv = () =>
    attempt(async () => {
      await flush();
      const f = await api("GET", `workspace/sheets/${id}/csv?sheet=${encodeURIComponent(sheet().name)}`);
      const a = h("a", { href: URL.createObjectURL(new Blob([f.csv], { type: "text/csv" })), download: f.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, col);
  const toolbar = h(
    "div",
    { class: "wstoolbar sheettools", role: "toolbar", "aria-label": "Sheet tools" },
    format,
    h("button", { class: "small", title: "Agents cannot change locked cells", onclick: () => (sheet().locks.push({ ...sel }), paint(), changed(), toast(`${selName()} is locked: agents cannot change it.`)) }, "Lock for agents"),
    h("button", { class: "small", onclick: () => ((sheet().locks = sheet().locks.filter((r) => !touches(r))), paint(), changed()) }, "Unlock"),
    h("button", { class: "small", onclick: () => addChart("bar") }, "Bar chart"),
    h("button", { class: "small", onclick: () => addChart("line") }, "Line chart"),
    h("button", { class: "small", onclick: () => ((mem.rows += 10), drawGrid()) }, "+ Rows"),
    h("button", { class: "small", onclick: () => ((mem.cols += 4), drawGrid()) }, "+ Columns"),
    h("button", { class: "small", onclick: exportCsv }, "Export CSV"),
    h("button", { class: "small", onclick: () => downloadFrom(`workspace/pages/${id}/xlsx`, `${page.title}.xlsx`, col) }, "Excel file (.xlsx)"),
    status,
  );

  // ----- changes waiting -----
  const labelOf = (c) => ((s) => (s ? ((at) => (at ? eng.show(eng.literal(s.cells[eng.refName(0, at.row)] ?? "")) : ""))(eng.parseRef(c.ref)) : ""))(file.sheets.find((x) => x.name === c.sheet));
  const decide = (sg, decision) =>
    attempt(async () => {
      await flush();
      try {
        await api("POST", `workspace/suggestions/${sg.id}`, { decision });
      } catch (err) {
        if (err.status !== 409 || !confirm(`${err.message}\n\nUse the agent's version of the sheet? Your newer cells stay in its history.`)) throw err;
        await api("POST", `workspace/suggestions/${sg.id}`, { decision, replace: true });
      }
      loadPageSuggestions();
      sheetsView();
    }, col);
  const waitingBox = pending.length
    ? h(
        "section",
        { class: "sheetwaiting" },
        h("div", { class: "label" }, `Waiting for you · ${pending.length}`),
        pending.map(({ s: sg, cells }) =>
          h(
            "div",
            { class: "card form" },
            h("div", {}, h("b", {}, sg.authorName), sg.note ? h("span", { class: "note small" }, ` · ${sg.note}`) : null),
            h("table", { class: "sheetdiff" }, h("tbody", {}, cells.slice(0, 40).map((c) => h("tr", {}, h("td", {}, `${file.sheets.length > 1 ? `${c.sheet} › ` : ""}${c.ref}${c.ref && labelOf(c) && !/^[A]\d+$/.test(c.ref) ? ` ${labelOf(c)}` : ""}`), h("td", { class: "mono" }, `${c.from || "(empty)"} → ${c.to || "(empty)"}`))))),
            cells.length > 40 ? h("p", { class: "note small" }, `and ${cells.length - 40} more cells`) : null,
            h("div", { class: "row" }, h("button", { class: "small primary", onclick: () => decide(sg, "accept") }, cells.length === 1 ? "Accept" : `Accept all ${cells.length}`), h("button", { class: "small", onclick: () => decide(sg, "decline") }, "Decline")),
          ),
        ),
        h("p", { class: "note small" }, "The cells an agent wants to change are outlined in the grid. Nothing changes until you accept."),
      )
    : null;

  // ----- the panel: who can see it, how agents change it, asking an agent -----
  const patch = (body, then?) => attempt(async () => (Object.assign(page, await api("PATCH", `workspace/pages/${id}`, body)), then?.()), col);
  const groupsOf = [...new Set<any>(org.members.map((m) => m.department))];
  const whoSel = h("select", { "aria-label": "Who can see it" }, [["everyone", "Every agent"], ["some", "Only some groups"], ["private", "Private: no agent sees it"]].map(([v, t]) => h("option", { value: v, selected: v === (page.access.private ? "private" : page.access.everyone ? "everyone" : "some") }, t)));
  const groupBox = h("div", { class: "sheetgroups" });
  const drawGroups = () => fill(groupBox, whoSel.value === "some" ? groupsOf.map((g) => h("label", { class: "power" }, h("input", { type: "checkbox", checked: page.access.departments.includes(g), onchange: (e) => patch({ access: { departments: e.target.checked ? [...page.access.departments, g] : page.access.departments.filter((x) => x !== g) } }) }), g)) : null);
  whoSel.addEventListener("change", () => patch({ access: whoSel.value === "everyone" ? { everyone: true } : whoSel.value === "private" ? { private: true } : { departments: page.access.departments } }, drawGroups));
  drawGroups();
  const edit = h("select", { "aria-label": "When agents want to change it" }, [["suggest", "They suggest; I accept or decline"], ["direct", "They change it straight away"]].map(([v, t]) => h("option", { value: v, selected: page.edit === v }, t)));
  edit.addEventListener("change", () => patch({ edit: edit.value }));
  const protect = h("input", { type: "checkbox", checked: page.protected, onchange: (e) => patch({ protected: e.target.checked }) });
  const folder = h("input", { value: page.folder, placeholder: "e.g. Finance", maxlength: 60, "aria-label": "Folder" });
  folder.addEventListener("change", () => patch({ folder: folder.value }));
  const giveTo = h("select", { "aria-label": "Agent" }, org.members.map((m) => h("option", { value: m.bot }, m.title)));
  const giveWhat = h("textarea", { rows: 2, placeholder: "e.g. Update March with this week's numbers and say what changed.", "aria-label": "What to do" });
  const give = () =>
    attempt(async () => {
      await flush();
      const what = giveWhat.value.trim() || `Check the sheet “${page.title}” and say what you find.`;
      const quest = await startTask({ bot: giveTo.value, text: `${what}\n\nWork on the Office sheet “${page.title}” (file ${id}) with the sheet tool: read it first, change cells with set and a one-line note, leave locked cells alone, and say in your report what you changed.`, title: what.slice(0, 80) });
      if (quest?.id) go("quest", quest.id);
      else if (quest?.queued) openTask(quest.queued.id);
    }, col);
  const aside = h(
    "aside",
    { class: "wspanel" },
    h("div", { class: "label" }, "Who can see it"),
    whoSel,
    groupBox,
    h("div", { class: "label" }, "When agents want to change it"),
    edit,
    h("label", { class: "power" }, protect, "Protected: agents never change it directly"),
    h("p", { class: "note small" }, "Agents can never change a locked cell, whatever is set here."),
    levelPicker(page, id),
    h("div", { class: "label" }, "Folder"),
    folder,
    org.members.length ? [h("div", { class: "label" }, "Ask an agent about this sheet"), giveTo, giveWhat, h("button", { class: "small", onclick: give }, "Give the task")] : null,
    h("div", { class: "row wrap wspanelend" }, h("button", { class: "small", onclick: async () => (await flush(), pageHistory(page)) }, "History"), h("button", { class: "small danger", onclick: () => confirm(`Delete “${page.title}”? You can restore it from the Workspace, under Deleted.`) && attempt(async () => (await api("DELETE", `workspace/pages/${id}`), (ui.ws.open = null), sheetsView()), col) }, "Delete")),
  );

  fill(
    col,
    h(
      "div",
      { class: "wspage sheetpage" },
      h(
        "article",
        { class: "wsdoc sheetdoc" },
        h("nav", { class: "wstrail note small", "aria-label": "Where this is" }, h("button", { class: "plain link", onclick: () => ((ui.ws.open = null), sheetsView()) }, "Sheets"), page.folder ? ` › ${page.folder}` : ""),
        h("div", { class: "wshead" }, title),
        conflict,
        waitingBox,
        toolbar,
        h("div", { class: "sheetbarrowtop" }, where, h("span", { class: "mono note small", "aria-hidden": "true" }, "fx"), bar),
        gridBox,
        tabsBox,
        chartsBox,
        h("p", { class: "note small" }, "Start a formula with =, for example =SUM(B2:B6) or =B2*1.1. To select several cells, click the first, then hold Shift and click the last."),
      ),
      aside,
    ),
  );
  drawAll();
}

/** Office › Notes: quick notes in notebooks, with tags. A note is private until the owner shares it. */
async function notesView() {
  const side = h("aside", { class: "side wsside notesside", "aria-label": "Notes" });
  const col = h("main", { class: "center wscenter" });
  const data = await officeLoad("notes", side, col);
  if (!data) return;
  ui.notes ??= { notebook: null, tag: null, q: "" };
  const f0 = ui.notes;
  const drawSide = (files = ui.ws.data.files) => {
    const notes = files.filter((f) => f.kind === "note");
    const notebooks = [...new Set<any>(notes.map((n) => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const tags = [...new Set<any>(notes.flatMap((n) => n.tags))].sort();
    if (f0.notebook && !notebooks.includes(f0.notebook)) f0.notebook = null;
    if (f0.tag && !tags.includes(f0.tag)) f0.tag = null;
    const needle = f0.q.trim().toLowerCase();
    const shown = notes.filter((n) => (!f0.notebook || n.folder === f0.notebook) && (!f0.tag || n.tags.includes(f0.tag)) && (!needle || `${n.title} ${n.summary} ${n.tags.join(" ")} ${n.folder} ${n.attached ?? ""}`.toLowerCase().includes(needle)));
    const q = h("input", { type: "search", value: f0.q, placeholder: "Search notes", "aria-label": "Search notes" });
    q.addEventListener("input", () => ((f0.q = q.value), drawSide(), side.querySelector("input[type=search]")?.focus()));
    const pick = (label, on, set, n) => h("button", { class: `plain wsrow officerow ${on ? "on" : ""}`, "aria-pressed": String(on), onclick: () => (set(), drawSide()) }, h("span", { class: "grow" }, label), h("span", { class: "note small" }, String(n)));
    fill(
      side,
      h("div", { class: "wssidehead" }, h("button", { class: `plain wshome ${ui.ws.open ? "" : "on"}`, onclick: () => ((ui.ws.open = null), notesView()) }, "Notes"), h("button", { class: "small", onclick: () => officeNew("note", f0.notebook ?? "") }, "+ Note")),
      h("button", { class: "plain small clipbtn", onclick: () => ((address) => address && attempt(async () => ((ui.ws.open = (await api("POST", "workspace/clip", { url: address })).id), toast("Saved as a note. It is private until you share it."), notesView()), side))(prompt("Save a web page as a note.\n\nPaste the page's address:")) }, "Save a web page as a note"),
      q,
      h("div", { class: "label officegroup" }, "Notebooks"),
      pick("All notes", !f0.notebook, () => (f0.notebook = null), notes.length),
      notebooks.map((name) => pick(name, f0.notebook === name, () => (f0.notebook = name), notes.filter((n) => n.folder === name).length)),
      tags.length ? [h("div", { class: "label officegroup" }, "Tags"), h("div", { class: "officetags" }, tags.map((t) => h("button", { class: `mpill ${f0.tag === t ? "on" : ""}`, "aria-pressed": String(f0.tag === t), onclick: () => ((f0.tag = f0.tag === t ? null : t), drawSide()) }, t)))] : null,
      h("div", { class: "label officegroup" }, `${shown.length} note${shown.length === 1 ? "" : "s"}`),
      shown.map((n) =>
        h(
          "button",
          { class: `plain notecard ${ui.ws.open === n.id ? "on" : ""}`, "aria-current": ui.ws.open === n.id ? "true" : null, onclick: () => ((ui.ws.open = n.id), notesView()) },
          h("b", {}, n.title),
          n.summary ? h("span", { class: "notesum" }, n.summary.slice(0, 110)) : null,
          h("span", { class: "note small" }, `${officeDay(n.updatedAt)}${n.folder ? ` · ${n.folder}` : ""}${n.access.private ? " · private" : " · shared with agents"}`),
        ),
      ),
      notes.length ? null : h("p", { class: "note small", style: "padding: 8px 10px" }, "No notes yet."),
    );
  };
  ui.ws.refreshSide = async () => ((ui.ws.data = await api("GET", "workspace/office")), state.view === "notes" && drawSide());
  drawSide();
  if (ui.ws.open) return renderWsPage(col, ui.ws.open);
  fill(
    col,
    h("div", { class: "officehome" }, h("h1", {}, "Notes"), h("p", { class: "lead" }, "Quick notes, meeting notes and ideas. A note is private: no agent can find or read it, and it is never sent to an AI model, until you choose who can see it or ask for the words in an attached picture to be read.")),
    h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: () => officeNew("note", f0.notebook ?? "") }, "+ New note")),
    h("div", { class: "card form" }, h("b", {}, "What a note can become"), h("ul", {}, h("li", {}, "A task: open the note and give it to an agent."), h("li", {}, "A document, when it grows into a letter or proposal."), h("li", {}, "A Workspace page, when it becomes a procedure agents should follow."), h("li", {}, "Something your agents remember, in Memory."))),
  );
}

/** Security: people, their roles, and how everyone signs in. */
async function securityView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "integrations security" });
  fill(ui.body, h("main", { class: "center" }, col));
  let data;
  try {
    data = await api("GET", "people");
  } catch (err) {
    // A member cannot see other people, but still manages their own sign-in.
    data = { enabled: true, people: [], settings: null, roles: [], me: state.me?.person ?? null, own: true, why: err.message };
  }
  if (state.view !== "security") return;
  const again = () => securityView();
  const act = (fn) => attempt(async () => (await fn(), again()), col);
  const head = h("div", {}, h("h1", {}, "Security"), h("p", { class: "lead" }, "Who can open Talqava, how they prove who they are, and what each person may do. Your agents' limits are on each agent's page and under Organization › Access."));
  const passwordHelp = "At least 12 characters. A few unrelated words work well.";

  // Not set up yet: this computer is trusted, as it always was. The owner can add people.
  if (!data.enabled) {
    const name = h("input", { placeholder: "Your name", autocomplete: "name", "aria-label": "Your name" });
    const email = h("input", { type: "email", placeholder: "Your email", autocomplete: "username", "aria-label": "Your email" });
    const pw = h("input", { type: "password", placeholder: "A password", autocomplete: "new-password", "aria-label": "A password" });
    return fill(
      col,
      head,
      securityCenter(),
      guaranteesCard(),
      h("div", { class: "card form" }, h("b", {}, "Right now: one person, no sign-in"), h("p", { class: "note" }, "Anyone who can use this computer can open Talqava and do everything. That is fine for one owner on their own computer.")),
      !lab("company") ? h("p", { class: "note" }, "Features for a company with several people (each with their own sign-in and role, single sign-on, and rules for sensitive information) are set aside. Switch them on under Settings › Labs.") : h(
        "form",
        { class: "card form", onsubmit: (e) => (e.preventDefault(), confirm("Turn on people and sign-in?\n\nFrom now on Talqava asks everyone, including you on this computer, to sign in. Keep your password safe: if you forget it, see “If something goes wrong” in the Security guide.") && attempt(async () => (await api("POST", "people/start", { name: name.value, email: email.value, password: pw.value }), boot()), col)) },
        h("b", {}, "Add people, each with their own sign-in and role"),
        h("p", { class: "note" }, "Start by making your own account. You become the Owner. Then add the others and choose what each may do."),
        name,
        email,
        pw,
        h("p", { class: "note small" }, passwordHelp),
        h("div", {}, h("button", { class: "primary" }, "Turn on people and sign-in")),
      ),
      lab("company") ? sensitivitySection(true) : null,
      sentSection(),
      guardrailsSection(true),
      securityOpsSection(true),
      backupSection(true),
    ), securityTabs(col);
  }

  const me = data.me;
  const admin = me && (me.role === "owner" || me.role === "admin");

  // ----- your own sign-in -----
  const stepBox = h("div");
  const startStep = () =>
    attempt(async () => {
      const s = await api("POST", "me/second-step");
      const code = h("input", { inputmode: "numeric", placeholder: "6-digit code", maxlength: 7, "aria-label": "Code from your authenticator app" });
      fill(
        stepBox,
        h("ol", {}, h("li", {}, "Open an authenticator app on your phone (any app that shows 6-digit codes)."), h("li", {}, "Add an account by typing this key: ", h("code", { class: "stepkey" }, s.key), " ", h("a", { href: s.link }, "or open it on this device")), h("li", {}, "Type the 6-digit code the app shows:")),
        h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), attempt(async () => (await api("POST", "me/second-step/confirm", { code: code.value }), toast("Your second step is on."), boot()), col)) }, code, h("button", { class: "primary" }, "Turn on")),
      );
      code.focus();
    }, col);
  const cur = h("input", { type: "password", placeholder: "Current password", autocomplete: "current-password", "aria-label": "Current password" });
  const next = h("input", { type: "password", placeholder: "New password", autocomplete: "new-password", "aria-label": "New password" });
  const mine = me
    ? h(
        "section",
        { class: "isec" },
        h("h2", {}, "Your sign-in"),
        h(
          "div",
          { class: "card form" },
          h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, me.name), h("div", { class: "note small" }, `${me.email} · ${state.me?.role?.name ?? me.role}`)), h("span", { class: `chip ${me.secondStep ? "on" : ""}` }, me.secondStep ? "Second step on" : "No second step")),
          state.me?.mustSetUpSecondStep ? h("div", { class: "banner error" }, "Your organization requires a second step. Set it up now to carry on.") : null,
          h("p", { class: "note" }, "A second step means a stolen password is not enough: signing in also needs a code from an app on your phone."),
          h("div", {}, h("button", { class: me.secondStep ? "" : "primary", onclick: startStep }, me.secondStep ? "Set it up again (new phone)" : "Set up a second step")),
          stepBox,
          h("form", { class: "form", onsubmit: (e) => (e.preventDefault(), attempt(async () => (await api("POST", "me/password", { current: cur.value, password: next.value }), toast("Password changed. Sign in again."), showLogin()), col)) }, h("b", {}, "Change your password"), cur, next, h("p", { class: "note small" }, passwordHelp), h("div", {}, h("button", {}, "Change password"))),
        ),
      )
    : null;
  if (data.own) return fill(col, head, mine, h("p", { class: "note" }, "Only owners, administrators, managers and auditors see the list of people."));

  // ----- people -----
  const roleSelect = (value, onchange, withOwner = false) => h("select", { "aria-label": "Role", onchange }, data.roles.filter((r) => withOwner || r.id !== "owner").map((r) => h("option", { value: r.id, selected: r.id === value }, r.name)));
  const row = (p) =>
    h(
      "tr",
      {},
      h("td", {}, h("b", {}, p.name), p.id === me?.id ? h("span", { class: "note small" }, " · you") : null, h("div", { class: "note small" }, p.email)),
      h("td", {}, admin && p.role !== "owner" && p.id !== me.id ? roleSelect(p.role, (e) => act(() => api("PATCH", `people/${p.id}`, { role: e.target.value }))) : data.roles.find((r) => r.id === p.role)?.name ?? p.role),
      h("td", {}, h("span", { class: `chip ${p.secondStep ? "on" : ""}` }, p.secondStep ? "On" : "Not set up"), p.locked ? h("span", { class: "chip warn" }, "Locked") : null, p.active === false ? h("span", { class: "chip bad" }, "Switched off by the directory") : null),
      h("td", {}, p.lastSignIn ? when(p.lastSignIn) : "Never"),
      h(
        "td",
        {},
        admin && p.id !== me.id && (p.role !== "owner" || me.role === "owner")
          ? h(
              "div",
              { class: "row wrap" },
              h("button", { class: "small", onclick: () => ((pw) => pw && act(() => api("POST", `people/${p.id}/password`, { password: pw })))(prompt(`A new password for ${p.name} (${passwordHelp.toLowerCase()}) Tell it to them in person; they should change it after signing in.`)) }, "New password"),
              p.secondStep ? h("button", { class: "small", onclick: () => confirm(`Take off ${p.name}'s second step? Do this only if they lost their phone, and you are sure it is them asking.`) && act(() => api("POST", `people/${p.id}/clear-second-step`)) }, "Lost phone") : null,
              p.role !== "owner" ? h("button", { class: "small danger", onclick: () => confirm(`Remove ${p.name}? They are signed out at once and can no longer open Talqava.`) && act(() => api("DELETE", `people/${p.id}`)) }, "Remove") : null,
            )
          : null,
      ),
    );
  const nName = h("input", { placeholder: "Name", "aria-label": "Name" });
  const nEmail = h("input", { type: "email", placeholder: "Email", "aria-label": "Email" });
  const nPw = h("input", { type: "password", placeholder: "A first password", autocomplete: "new-password", "aria-label": "A first password" });
  const nRole = roleSelect("member", null);
  const sessions = h("div");
  const showSessions = () => attempt(async () => fill(sessions, h("ul", {}, (await api("GET", "people/sessions")).map((x) => h("li", {}, h("b", {}, x.name), ` · signed in ${when(x.createdAt)} · last active ${when(x.seenAt)}`, h("div", { class: "note small" }, x.device || "Unknown device"))))), col);
  const st = data.settings;
  const networks = h("textarea", { rows: 3, placeholder: "203.0.113.0/24", "aria-label": "Approved networks" }, (st?.networks ?? []).join("\n"));
  fill(
    col,
    head,
    securityCenter(),
      guaranteesCard(),
    mine,
    h(
      "section",
      { class: "isec" },
      h("h2", {}, `People · ${data.people.length}`),
      h("div", { class: "card officetable" }, h("table", {}, h("thead", {}, h("tr", {}, ["Person", "Role", "Second step", "Last sign-in", ""].map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, data.people.map(row)))),
      admin
        ? h("form", { class: "card form", onsubmit: (e) => (e.preventDefault(), act(async () => (await api("POST", "people", { name: nName.value, email: nEmail.value, password: nPw.value, role: nRole.value }), toast(`${nName.value} can now sign in.`)))) }, h("b", {}, "Add a person"), h("div", { class: "row wrap" }, nName, nEmail, nRole), nPw, h("p", { class: "note small" }, `${passwordHelp} Tell it to them in person; they change it after signing in.`), h("div", {}, h("button", { class: "primary" }, "Add person")))
        : null,
    ),
    h("section", { class: "isec" }, h("h2", {}, "What each role may do"), h("div", { class: "card form" }, h("dl", { class: "roles" }, data.roles.map((r) => [h("dt", {}, r.name), h("dd", {}, r.may)])), h("p", { class: "note small" }, "Roles are enforced by the app itself, not just hidden on screen. Limiting a manager or member to their own groups is not built yet: a manager can change the whole chart."))),
    admin
      ? h(
          "section",
          { class: "isec" },
          h("h2", {}, "Rules for everyone"),
          h(
            "div",
            { class: "card form" },
            h("label", { class: "power" }, h("input", { type: "checkbox", checked: st.requireSecondStep, onchange: (e) => (!e.target.checked || me.secondStep || confirm("You have not set up your own second step yet. If you require it, you will be asked to set it up before you can do anything else. Carry on?") ? act(() => api("PUT", "people/settings", { requireSecondStep: e.target.checked })) : again()) }), "Require a second step for everyone"),
            h("p", { class: "note small" }, "Anyone without one is asked to set it up the next time they sign in, before they can do anything else."),
            h("label", {}, "Sign people out after this long without activity", h("select", { onchange: (e) => act(() => api("PUT", "people/settings", { idleMinutes: Number(e.target.value) })) }, st.idleChoices.map((m) => h("option", { value: m, selected: m === st.idleMinutes }, m < 120 ? `${m / 60} hour` : m < 2880 ? `${m / 60} hours` : `${m / 1440} days`)))),
            h("label", { class: "power" }, h("input", { type: "checkbox", checked: st.askAgain, onchange: (e) => act(() => api("PUT", "people/settings", { askAgain: e.target.checked })) }), `Ask for the password again before changes to people, rules or security (at most every ${st.confirmMinutes} minutes)`),
            h("label", { class: "power" }, h("input", { type: "checkbox", checked: st.twoAdmins, disabled: !st.twoAdmins && st.admins < 2, onchange: (e) => act(() => api("PUT", "people/settings", { twoAdmins: e.target.checked })) }), "Two administrators must agree on security changes: one asks, a different one approves"),
            st.admins < 2 ? h("p", { class: "note small" }, "This needs at least two people who are owner or administrator.") : null,
            h("label", {}, "Only allow signing in from these networks", networks),
            h("p", { class: "note small" }, "One range on each line, such as 203.0.113.0/24, or a single address. Leave empty to allow any network. The computer Talqava runs on is always allowed."),
            h("div", {}, h("button", { onclick: () => act(() => api("PUT", "people/settings", { networks: networks.value })) }, "Save the networks")),
            h("div", { class: "row wrap" }, h("button", { onclick: showSessions }, "See who is signed in"), h("button", { class: "danger", onclick: () => confirm("Sign everyone else out? They will need to sign in again. You stay signed in.") && act(async () => toast(`${(await api("POST", "people/sign-out-all")).ended} session(s) ended.`)) }, "Sign everyone else out")),
            sessions,
          ),
        )
      : null,
    admin ? waitingChangesSection() : null,
    admin ? ssoSection() : null,
    admin ? directorySection() : null,
    sensitivitySection(admin),
    admin || ["auditor", "manager"].includes(me?.role) ? sentSection() : null,
    guardrailsSection(admin),
    securityOpsSection(admin),
    admin || me?.role === "auditor" ? backupSection(admin) : null,
  );
  securityTabs(col);
}

/** Splits the Security page into tabs: each section belongs to one, and only the chosen tab's sections show. */
const SECURITY_TABS = [["overview", "Overview"], ["people", "People and sign-in"], ["info", "Information"], ["agents", "Agents"], ["watching", "Watching"], ["backups", "Backups"]];
function securityTabs(col) {
  const tabOf = (el) => {
    if (el.classList.contains("seccenter")) return "overview";
    const title = el.querySelector("h2")?.textContent ?? "";
    return /^(Sensitive information|What was sent)/.test(title) ? "info" : /^Agent guardrails/.test(title) ? "agents" : /^Alerts and reviews/.test(title) ? "watching" : /^Backups/.test(title) ? "backups" : "people";
  };
  const sections = [...col.children].slice(1);
  for (const el of sections) el.dataset.tab = tabOf(el);
  const have = new Set<any>(sections.map((el) => el.dataset.tab));
  if (state.me?.mustSetUpSecondStep) ui.securityTab = "people";
  if (!have.has(ui.securityTab)) ui.securityTab = "overview";
  const bar = h("div", { class: "pills sectabs", role: "tablist", "aria-label": "Parts of Security" });
  const show = () => {
    for (const el of sections) el.hidden = el.dataset.tab !== ui.securityTab;
    fill(bar, SECURITY_TABS.filter(([id]) => have.has(id)).map(([id, label]) => h("button", { class: `mpill ${ui.securityTab === id ? "on" : ""}`, role: "tab", "aria-selected": String(ui.securityTab === id), onclick: () => ((ui.securityTab = id), show()) }, label)));
  };
  col.children[0].after(bar);
  col.addEventListener("securitytab", (e) => ((ui.securityTab = e.detail), show(), bar.scrollIntoView({ block: "start" })));
  show();
}

/** Security › Backups and stored data: whether the disk is encrypted, encrypted backups, and testing a restore. */
function backupSection(canEdit) {
  const box = h("section", { class: "isec" }, h("h2", {}, "Backups and stored data"));
  const draw = async () => {
    let b;
    try {
      b = await api("GET", "security-ops/backup");
    } catch (err) {
      return fill(box, h("h2", {}, "Backups and stored data"), h("div", { class: "banner error" }, err.message));
    }
    const act = (fn, done?) => attempt(async () => ((r) => (done && toast(typeof done === "function" ? done(r) : done), draw()))(await fn()), box);
    const pass = h("input", { type: "password", autocomplete: "new-password", placeholder: b.ready ? "A new passphrase (to replace the one in use)" : "A passphrase for your backups, at least 12 characters", "aria-label": "Backup passphrase" });
    const where = h("input", { value: b.folder, placeholder: "The folder backups are kept in", "aria-label": "Backup folder" });
    const ask = (what) => prompt(`${what}\n\nType your backup passphrase:`);
    const size = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
    // Restore one backup in place. It asks for the passphrase, gets the backup ready, and is finished by opening Talqava again.
    const restoreHere = async (x) => {
      const pw = h("input", { id: "restore-pass", type: "password", autocomplete: "off", placeholder: "Your backup passphrase", "aria-label": "Backup passphrase" });
      const said = await libDialog(
        `Restore the backup of ${when(x.at)}?`,
        h("div", { class: "composeform" }, h("p", { class: "note" }, "Everything in Talqava goes back to how it was then: settings, chats, tasks, pages, files and memory. What you have now is not deleted. It is moved into a folder of its own, and you can put it back."), h("label", {}, "Backup passphrase", pw), h("p", { class: "note small" }, "Nothing changes until you quit Talqava and open it again.")),
        [["Get it ready", () => ({ p: pw.value }), true]],
      );
      if (said?.p) act(() => api("POST", "security-ops/backup/restore-here", { passphrase: said.p, name: x.name }), (r) => `Ready: ${r.files} files. Quit Talqava and open it again to finish.`);
    };
    fill(
      box,
      h("h2", {}, "Backups and stored data"),
      b.waiting
        ? h("div", { class: "banner restorewait", role: "status" }, h("div", { class: "grow" }, h("b", {}, b.waiting.undo ? "Ready to put back what you had. " : "A restore is ready. "), `Quit Talqava and open it again to finish: ${b.waiting.undo ? b.waiting.from : `the backup ${b.waiting.from}`}. Until then nothing has changed.`), canEdit ? h("button", { class: "small", onclick: () => act(() => api("POST", "security-ops/backup/restore-cancel"), "Called off. Nothing was changed.") }, "Call it off") : null)
        : b.restored
          ? h("div", { class: "banner restorewait" }, h("div", { class: "grow" }, h("b", {}, b.restored.undo ? "What you had was put back " : "Restored "), `${when(b.restored.at)}${b.restored.undo ? "." : `, from ${b.restored.from}.`} `, b.restored.keptHere ? `What was there before is kept in the folder ${b.restored.kept}, beside Talqava's data.` : ""), canEdit && b.restored.keptHere ? h("button", { class: "small", onclick: () => confirm("Put back what you had before this restore?\n\nIt is got ready now and put in place when you quit Talqava and open it again. What you have now is kept in a folder of its own.") && act(() => api("POST", "security-ops/backup/restore-undo"), "Ready. Quit Talqava and open it again to finish.") }, "Put it back") : null)
          : null,
      h("div", { class: "card form" }, h("div", { class: "row" }, h("b", { class: "grow" }, "This computer's disk"), h("span", { class: `chip ${b.disk.state === "on" ? "on" : b.disk.state === "off" ? "bad" : ""}` }, b.disk.state === "on" ? "Encrypted" : b.disk.state === "off" ? "Not encrypted" : "Could not check")), h("p", { class: "note" }, b.disk.words), h("p", { class: "note small" }, "Talqava relies on your computer's disk encryption for what is stored here, and encrypts every backup itself.")),
      h(
        "div",
        { class: "card form" },
        h("div", { class: "row" }, h("b", { class: "grow" }, "Encrypted backups"), h("span", { class: `chip ${b.ready ? "on" : ""}` }, b.ready ? (b.nightly ? "Every night" : "By hand") : "Not set up")),
        h("p", { class: "note" }, "One file with your settings, chats, tasks, pages, documents, memory, Library files and audit record, encrypted with a passphrase only you know. Keep the folder somewhere that is copied off this computer. Working copies of repositories are left out; they can be made again."),
        canEdit ? [pass, where, h("div", { class: "row wrap" }, h("button", { class: b.ready ? "" : "primary", onclick: () => act(() => api("PUT", "security-ops/backup", { ...(pass.value ? { passphrase: pass.value } : {}), folder: where.value }), b.ready ? "Saved." : "Backups are set up. Write the passphrase down somewhere safe: without it a backup cannot be opened.") }, b.ready ? "Save" : "Set up backups"), b.ready ? h("label", { class: "power" }, h("input", { type: "checkbox", checked: b.nightly, onchange: (e) => act(() => api("PUT", "security-ops/backup", { nightly: e.target.checked })) }), "Make one every night") : null)] : null,
        b.ready
          ? [
              h("p", { class: "note small" }, `${b.lastAt ? `Last backup ${when(b.lastAt)} (${b.lastFiles} files).` : "No backup made yet."} ${b.lastTestedAt ? `A restore was last tested ${when(b.lastTestedAt)}.` : "A restore has never been tested."} The newest ${b.keep} are kept.`),
              canEdit
                ? h(
                    "div",
                    { class: "row wrap" },
                    h("button", { class: "primary", onclick: () => act(() => api("POST", "security-ops/backup/now"), (r) => `Backup made: ${r.files} files, ${size(r.bytes)}.${r.skipped.length ? ` ${r.skipped.length} very large files were left out.` : ""}`) }, "Back up now"),
                    h("button", { onclick: () => ((p) => p && act(() => api("POST", "security-ops/backup/test", { passphrase: p }), (r) => `It works: ${r.files} files were read back from ${r.name}. Nothing was changed.`))(ask("Test a restore: Talqava opens the newest backup and reads every file back, without changing anything.")) }, "Test a restore"),
                    h("button", { class: "plain", onclick: () => ((p) => p && act(() => api("POST", "security-ops/backup/restore", { passphrase: p }), (r) => `${r.files} files were written to ${r.folder}. Your current data was not touched.`))(ask("Restore the newest backup into a new folder next to Talqava's data folder. Your current data is not touched; the Security guide says how to switch to the restored copy.")) }, "Restore into a new folder"),
                  )
                : null,
              b.backups.length
                ? h(
                    "div",
                    { class: "backuplist" },
                    h("div", { class: "label" }, "Your backups"),
                    b.backups.map((x) => h("div", { class: "row backuprow" }, h("div", { class: "grow" }, h("b", {}, when(x.at)), h("span", { class: "note small" }, ` · ${size(x.bytes)} · ${x.name}`)), canEdit ? h("button", { class: "small", onclick: () => restoreHere(x) }, "Restore this one…") : null)),
                  )
                : null,
            ]
          : null,
      ),
    );
  };
  draw();
  return box;
}

/** Security › Single sign-on: people sign in through the company's identity provider. */
/** Security: changes one administrator asked for that wait for a different one to approve. Shown only when there are any. */
/** Security › Sensitive information: what left this computer on one day. Names and counts only, never the content. */
function sentSection() {
  const body = h("div", { class: "card form" }, h("p", { class: "note" }, "Loading…"));
  const table = (heads, rows) => h("div", { class: "officetable" }, h("table", {}, h("thead", {}, h("tr", {}, heads.map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, rows)));
  const num = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const time = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dayWords = (day, i) => (i === 0 ? "Today" : new Date(`${day}T12:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }));
  const draw = async (day?) => {
    const d = await api("GET", `sent${day ? `?day=${day}` : ""}`).catch(() => null);
    if (!d) return fill(body, h("p", { class: "note" }, "This could not be loaded."));
    const out = d.ai.filter((a) => !a.local);
    const here = d.ai.filter((a) => a.local);
    const nothing = !d.ai.length && !d.items.length && !d.services.length && !d.web.length;
    fill(
      body,
      h("label", {}, "Day", h("select", { "aria-label": "Day", onchange: (e) => draw(e.target.value) }, d.days.map((x, i) => h("option", { value: x, selected: x === d.day }, dayWords(x, i))))),
      nothing ? h("p", { class: "note" }, "Nothing left this computer on this day.") : null,
      out.length ? [h("h3", {}, `AI services · ${num(out.reduce((n, a) => n + a.calls, 0), "call")}`), h("p", { class: "note small" }, "Each call sends the conversation so far to the model: the task, the agent's instructions and what its tools returned. A token is about three quarters of a word."), table(["Model", "Calls", "Tokens sent", "Used by"], out.map((a) => h("tr", {}, h("td", {}, a.model), h("td", {}, String(a.calls)), h("td", {}, a.tokens.toLocaleString()), h("td", {}, a.agents.join(", ")))))] : null,
      here.length ? h("p", { class: "note small" }, `Models on this computer answered ${num(here.reduce((n, a) => n + a.calls, 0), "call")} (${here.map((a) => a.model).join(", ")}). Nothing left the computer for those.`) : null,
      d.items.length ? [h("h3", {}, `Pages and documents handed to an agent · ${d.items.length}`), h("p", { class: "note small" }, "What an agent reads becomes part of what its AI service receives."), table(["Title", "Level", "Read by", "Went to", "Time"], d.items.map((i) => h("tr", {}, h("td", {}, i.title), h("td", {}, LEVEL_NAMES[i.level] ?? "Internal"), h("td", {}, i.who), h("td", {}, i.to), h("td", {}, time(i.at)))))] : null,
      d.services.length ? [h("h3", {}, `Changes made in connected services and websites · ${d.services.length}`), table(["Where", "What", "Time"], d.services.map((x) => h("tr", {}, h("td", {}, x.to), h("td", {}, x.what), h("td", {}, time(x.at)))))] : null,
      d.web.length ? [h("h3", {}, `Websites agents called · ${d.web.length}`), table(["Site", "Times", "Used by"], d.web.map((w) => h("tr", {}, h("td", {}, w.host), h("td", {}, String(w.calls)), h("td", {}, w.agents.join(", ")))))] : null,
      h("p", { class: "note small" }, "This lists where things went and how much, not the content itself. It is kept on this computer for 30 days. Reading from a connected service is not listed, only changes. Tools added from outside Talqava (connectors) appear in the activity log instead."),
    );
  };
  draw();
  return h("section", { class: "isec" }, h("h2", {}, "What was sent"), body);
}

function waitingChangesSection() {
  const box = h("section", { class: "isec", hidden: true });
  const draw = async () => {
    const list = await api("GET", "security-ops/changes").then((d) => d.changes).catch(() => []);
    box.hidden = !list.length;
    if (!list.length) return;
    const mine = state.me?.person?.id;
    fill(
      box,
      h("h2", {}, "Security changes waiting for a second administrator"),
      h(
        "div",
        { class: "card form" },
        list.map((c) =>
          h(
            "div",
            { class: "reviewline" },
            h("div", { class: "grow" }, h("b", {}, c.summary), h("div", { class: "note small" }, `Asked for by ${c.by.name}, ${new Date(c.at).toLocaleString()}`)),
            c.by.id === mine ? h("span", { class: "note small" }, "Waiting for another administrator") : h("button", { class: "small primary", onclick: () => attempt(async () => (await api("POST", `security-ops/changes/${c.id}/approve`), toast("Approved. The change is made."), securityView()), box) }, "Approve"),
            h("button", { class: "small", onclick: () => attempt(async () => (await api("POST", `security-ops/changes/${c.id}/decline`), toast(c.by.id === mine ? "Withdrawn." : "Declined."), draw()), box) }, c.by.id === mine ? "Withdraw" : "Decline"),
          ),
        ),
        h("p", { class: "note small" }, "A waiting change lapses after a day, or when Talqava restarts. What it holds, such as a new password, is never written to disk while it waits."),
      ),
    );
  };
  draw();
  return box;
}

/** Security › Directory sync: the company's identity provider adds people and switches them off, with a token made here. */
function directorySection() {
  const box = h("section", { class: "isec" }, h("h2", {}, "Directory sync"));
  const draw = async (shown = null) => {
    let d;
    try {
      d = await api("GET", "people/directory");
    } catch (err) {
      return fill(box, h("h2", {}, "Directory sync"), h("div", { class: "banner error" }, err.message));
    }
    const role = h("select", { "aria-label": "Role for new people" }, [["member", "Member"], ["manager", "Manager"], ["auditor", "Auditor"], ["admin", "Administrator"]].map(([v, t]) => h("option", { value: v, selected: d.role === v }, t)));
    const turnOn = () => attempt(async () => draw((await api("POST", "people/directory", { role: role.value })).token), box);
    fill(
      box,
      h("h2", {}, "Directory sync"),
      h("p", { class: "note", style: "margin: 0" }, "Let your company's identity provider (Microsoft Entra ID, Okta and others that speak SCIM) add people to Talqava and switch them off the moment they leave. It works when Talqava runs where your provider can reach it over the network; a copy on one computer cannot be reached."),
      h(
        "div",
        { class: "card form" },
        h("div", { class: "row" }, h("b", { class: "grow" }, d.on ? "On" : "Off"), h("span", { class: `chip ${d.on ? "on" : ""}` }, d.on ? (d.lastUsedAt ? `Last heard from ${new Date(d.lastUsedAt).toLocaleString()}` : "Not heard from yet") : "Not set up")),
        shown
          ? h("div", { class: "banner" }, h("b", {}, "Copy this token now. It is shown once."), h("div", { class: "mono", style: "word-break: break-all; margin-top: 6px" }, shown), h("p", { class: "note small" }, "Paste it into your provider as the secret token, with the address below as the tenant URL."))
          : null,
        h("label", {}, "Address to give your provider (tenant URL)", h("input", { readonly: true, value: d.address, "aria-label": "Directory address" })),
        h("label", {}, "Role for people the directory adds", role),
        h("p", { class: "note small" }, "People the directory adds sign in with the company account (single sign-on). A person it switches off is signed out at once and cannot sign in. The owner's account is never changed by the directory."),
        d.on && d.groups.length
          ? [
              h("div", { class: "label" }, "Roles from the directory's groups"),
              h("div", { class: "officetable" }, h("table", {}, h("thead", {}, h("tr", {}, ["Group", "People", "Role it gives"].map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, d.groups.map((g) => h("tr", {}, h("td", {}, g.name), h("td", {}, String(g.people)), h("td", {}, h("select", { "aria-label": `Role the group ${g.name} gives`, onchange: (e) => attempt(async () => (await api("PUT", "people/directory/groups", { roles: { [g.name]: e.target.value } }), toast("Saved. Roles were updated."), draw()), box) }, [["", "No role of its own"], ["member", "Member"], ["auditor", "Auditor"], ["manager", "Manager"], ["admin", "Administrator"]].map(([v, t]) => h("option", { value: v, selected: (g.role ?? "") === v }, t))))))))),
              h("p", { class: "note small" }, "A person in several groups gets the highest role among them. Someone in no group that gives a role gets the role for new people above. Until you choose a role for at least one group, groups change nobody's role. A changed role signs the person out so it takes effect."),
            ]
          : d.on ? h("p", { class: "note small" }, "When your provider sends groups, they appear here and you can choose the role each one gives.") : null,
        h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: () => (!d.on || confirm("Make a new token? The old one stops working, so your provider needs the new one.")) && turnOn() }, d.on ? "Make a new token" : "Switch on and show the token"), d.on ? h("button", { class: "danger", onclick: () => confirm("Switch off directory sync? Your provider can no longer add or switch off people. Nobody is removed.") && attempt(async () => (await api("DELETE", "people/directory"), draw()), box) }, "Switch off") : null),
      ),
    );
  };
  draw();
  return box;
}

function ssoSection() {
  const box = h("section", { class: "isec" }, h("h2", {}, "Single sign-on"));
  const draw = async () => {
    let d;
    try {
      d = await api("GET", "people/sso");
    } catch (err) {
      return fill(box, h("h2", {}, "Single sign-on"), h("div", { class: "banner error" }, err.message));
    }
    const c = d.sso ?? { issuer: "", clientId: "", domains: [], addPeople: false, role: "member", only: false, hasSecret: false };
    const issuer = h("input", { type: "url", value: c.issuer, placeholder: "Issuer address, e.g. https://login.microsoftonline.com/<your tenant>/v2.0", "aria-label": "Issuer address" });
    const client = h("input", { value: c.clientId, placeholder: "Client ID (also called Application ID)", "aria-label": "Client ID" });
    const secret = h("input", { type: "password", autocomplete: "off", placeholder: c.hasSecret ? "A client secret is saved; type a new one to replace it" : "Client secret", "aria-label": "Client secret" });
    const domains = h("input", { value: c.domains.join(", "), placeholder: "Only these email domains, e.g. yourcompany.com (optional)", "aria-label": "Allowed email domains" });
    const add = h("input", { type: "checkbox", checked: c.addPeople });
    const role = h("select", { "aria-label": "Role for new people" }, [["member", "Member"], ["manager", "Manager"], ["auditor", "Auditor"], ["admin", "Administrator"]].map(([v, t]) => h("option", { value: v, selected: c.role === v }, t)));
    const only = h("input", { type: "checkbox", checked: c.only });
    const save = () => attempt(async () => (await api("PUT", "people/sso", { issuer: issuer.value, clientId: client.value, clientSecret: secret.value || undefined, domains: domains.value, addPeople: add.checked, role: role.value, only: only.checked }), toast("Saved. The sign-in page now offers “Sign in with your company account”. Try it in a private window before you rely on it."), draw()), box);
    const copy = h("button", { type: "button", class: "small" }, "Copy");
    copy.addEventListener("click", () => navigator.clipboard?.writeText(d.redirect).then(() => ((copy.textContent = "Copied"), setTimeout(() => (copy.textContent = "Copy"), 1500))).catch(() => {}));
    fill(
      box,
      h("h2", {}, "Single sign-on"),
      h("p", { class: "note", style: "margin: 0" }, "People sign in through your company's identity provider (Microsoft Entra ID, Google Workspace, Okta, or any other that supports OpenID Connect). When someone leaves and you remove them there, they can no longer sign in here."),
      h(
        "form",
        { class: "card form", onsubmit: (e) => (e.preventDefault(), save()) },
        h("div", { class: "row" }, h("b", { class: "grow" }, c.issuer ? "Connected to your identity provider" : "Not set up"), h("span", { class: `chip ${c.issuer ? "on" : ""}` }, c.issuer ? "On" : "Off")),
        h("ol", {}, h("li", {}, "In your identity provider, register a new web application called Talqava."), h("li", {}, "Give it this redirect address: ", h("code", {}, d.redirect), " ", copy), h("li", {}, "Copy its issuer address, client ID and client secret into the boxes below.")),
        issuer,
        client,
        secret,
        domains,
        h("label", { class: "power" }, add, "Let anyone your provider signs in join Talqava the first time they sign in, as a"),
        role,
        h("p", { class: "note small" }, "Unticked, only people you have already added under People can sign in this way. Their email address here must match the one at your provider."),
        h("label", { class: "power" }, only, "Only single sign-on: switch passwords off for everyone except the owner"),
        h("p", { class: "note small" }, "The owner's password stays as the emergency way in, in case your identity provider is down. Keep it somewhere safe."),
        h("div", { class: "row wrap" }, h("button", { class: "primary" }, c.issuer ? "Save" : "Turn on single sign-on"), c.issuer ? h("button", { type: "button", class: "plain danger", onclick: () => confirm("Turn off single sign-on? People sign in with their email and password again.") && attempt(async () => (await api("PUT", "people/sso", { issuer: "" }), draw()), box) }, "Turn off") : null),
        h("p", { class: "note small" }, "This has been tested against a stand-in provider, not yet against a real one. Try it in a private window, staying signed in here, before you switch passwords off."),
      ),
    );
  };
  draw();
  return box;
}

/** Security › watching: alerts, access reviews, and sending the audit record to a monitoring system. */
function securityOpsSection(canEdit) {
  const box = h("section", { class: "isec" }, h("h2", {}, "Alerts and reviews"));
  const draw = async () => {
    let d;
    try {
      d = await api("GET", "security-ops");
    } catch (err) {
      return fill(box, h("h2", {}, "Alerts and reviews"), h("div", { class: "banner error" }, err.message));
    }
    const act = (fn, done?) => attempt(async () => (await fn(), done && toast(done), draw()), box);
    const open = d.reviews.find((r) => !r.finishedAt);
    const last = d.reviews.find((r) => r.finishedAt);
    const url = h("input", { type: "url", value: d.feed.url, placeholder: "https://… (the address your monitoring system gives you)", disabled: !canEdit, "aria-label": "Address to send events to" });
    const secret = h("input", { type: "password", placeholder: d.feed.signed ? "A signing secret is set; type a new one to replace it" : "Signing secret (optional)", autocomplete: "off", disabled: !canEdit, "aria-label": "Signing secret" });
    const personQ = h("input", { type: "search", placeholder: "A name or an email address", "aria-label": "A person's name or email" });
    const personOut = h("div");
    const personForm = h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), attempt(async () => {
      const r = await api("GET", `security-ops/person?q=${encodeURIComponent(personQ.value)}`);
      const text = [`Where “${r.query}” appears in Talqava, found on ${new Date().toLocaleDateString()}`, "", ...r.places.map((p) => `${p.where}: ${p.title}\n    ${p.snippet}`)].join("\n");
      const save = () => {
        const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: `talqava-person-search-${new Date().toISOString().slice(0, 10)}.txt` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      fill(personOut, r.places.length ? [h("p", { class: "note" }, `Found in ${r.places.length} place${r.places.length === 1 ? "" : "s"}. Open each to correct or delete it; Talqava does not erase it for you, because the name may sit inside text you still need.`), h("ul", { class: "refused" }, r.places.slice(0, 100).map((p) => h("li", {}, h("b", {}, `${p.where}: `), p.title, h("div", { class: "note small" }, p.snippet)))), h("button", { type: "button", onclick: save }, "Download this list")] : h("p", { class: "note" }, `“${r.query}” was not found anywhere.`));
    }, box)) }, personQ, h("button", {}, "Search"));
    const line = (r, i) => {
      const note = h("input", { value: i.note, placeholder: "Note (optional)", "aria-label": `Note for ${i.name}` });
      const set = (decision) => act(() => api("PATCH", `security-ops/reviews/${r.id}`, { item: i.id, decision, note: note.value }));
      note.addEventListener("change", () => i.decision && set(i.decision));
      return h("div", { class: "reviewline" }, h("div", { class: "grow" }, h("b", {}, i.name), h("span", { class: "note small" }, i.kind === "person" ? " · person" : " · agent"), h("div", { class: "note small" }, i.has)), h("div", { class: "row wrap" }, h("button", { class: `small ${i.decision === "keep" ? "primary" : ""}`, "aria-pressed": String(i.decision === "keep"), onclick: () => set("keep") }, "Still right"), h("button", { class: `small ${i.decision === "change" ? "primary" : ""}`, "aria-pressed": String(i.decision === "change"), onclick: () => set("change") }, "Needs a change"), note));
    };
    fill(
      box,
      h("h2", {}, "Alerts and reviews"),
      h("div", { class: "card form" }, h("b", {}, "Worth a look, from the last 7 days"), d.alerts.length ? h("ul", { class: "refused" }, d.alerts.map((a) => h("li", {}, h("span", { class: `chip ${a.level === "high" ? "bad" : ""}` }, a.level === "high" ? "High" : "Note"), " ", a.words, h("div", { class: "note small" }, `${when(a.at)}${a.detail ? ` · ${a.detail}` : ""}`)))) : h("p", { class: "note small" }, "Nothing unusual: no run of refused sign-ins, no changes to people or rules, no agent refused again and again.")),
      h(
        "div",
        { class: "card form" },
        h("div", { class: "row wrap" }, h("div", { class: "grow" }, h("b", {}, "Access review"), h("p", { class: "note small", style: "margin: 2px 0 0" }, `Every ${d.every} days, go down the list of people and agents and confirm each still needs what it has. ${last ? `Last finished ${when(last.finishedAt)}.` : "None done yet."} ${d.due.overdue ? "One is due now." : `Next due ${new Date(d.due.next).toLocaleDateString()}.`}`)), canEdit && !open ? h("button", { class: d.due.overdue ? "primary" : "", onclick: () => act(() => api("POST", "security-ops/reviews")) }, "Start a review") : null),
        open
          ? [
              h("p", { class: "note" }, `Started ${when(open.startedAt)} by ${open.startedBy}. Answer each line. Marking “Needs a change” only records it: make the change itself under People, or on the agent's page.`),
              open.items.map((i) => line(open, i)),
              canEdit ? h("div", { class: "row" }, h("button", { class: "primary", onclick: () => act(() => api("POST", `security-ops/reviews/${open.id}/finish`), "Review finished and recorded in the activity log.") }, "Finish the review"), h("span", { class: "note small" }, `${open.items.filter((i) => i.decision).length} of ${open.items.length} answered`)) : null,
            ]
          : last && last.items.some((i) => i.decision === "change")
            ? h("div", {}, h("p", { class: "note small" }, "Marked “Needs a change” in the last review:"), h("ul", {}, last.items.filter((i) => i.decision === "change").map((i) => h("li", {}, h("b", {}, i.name), i.note ? ` · ${i.note}` : ""))))
            : null,
      ),
      // Retention rules and the monitoring feed are company features: shown when switched on under Labs, or already in use.
      !(lab("company") || d.retention.days || d.retention.legalHold) ? null : h(
        "div",
        { class: "card form" },
        h("b", {}, "Keeping and deleting records"),
        h("label", {}, "Delete chats and finished tasks after", h("select", { disabled: !canEdit, onchange: (e) => (Number(e.target.value) === 0 || confirm(`Delete chats and finished tasks once they are ${e.target.selectedOptions[0].textContent} old?\n\nThis runs every day and cannot be undone. Pinned chats, running work and tasks with changes you have not kept or undone are never deleted.`) ? act(() => api("PUT", "settings", { retention: { days: Number(e.target.value) } }), "Saved.") : draw()) }, d.retentionChoices.map((n) => h("option", { value: n, selected: d.retention.days === n }, n === 0 ? "Never: keep until I delete them" : n < 365 ? `${n} days` : `${n / 365} year${n === 365 ? "" : "s"}`)))),
        h("label", { class: "power" }, h("input", { type: "checkbox", disabled: !canEdit, checked: d.retention.legalHold, onchange: (e) => act(() => api("PUT", "settings", { retention: { legalHold: e.target.checked } }), e.target.checked ? "Legal hold is on: nothing can be deleted." : "Legal hold is off.") }), "Legal hold: nothing is deleted, by anyone, while this is on"),
        h("p", { class: "note small" }, "Use a legal hold when a dispute or investigation means records must be kept. It stops the daily deletion above and every Delete button."),
        h("b", {}, "Find everything about one person"),
        h("p", { class: "note small" }, "When someone asks what you hold about them, or asks you to erase it: search their name or email across pages, documents, notes, sheets, the Library, Memory, chats and tasks."),
        personForm,
        personOut,
      ),
      !(lab("company") || d.feed.url) ? null : h(
        "form",
        { class: "card form", onsubmit: (e) => (e.preventDefault(), act(() => api("PUT", "security-ops/feed", { url: url.value, secret: secret.value || undefined }), url.value ? "Saved. Events are now sent as they happen." : "Stopped.")) },
        h("b", {}, "Send every event to your monitoring system"),
        h("p", { class: "note small" }, "Each entry of the activity log is also sent, as it is written, to an address you give (a “webhook” or “HTTP collector” in Splunk, Microsoft Sentinel, Datadog and similar). That copy is outside this computer, so it cannot be quietly changed here. With a signing secret, each delivery carries a signature your system can check."),
        url,
        secret,
        d.feed.url ? h("p", { class: `note small ${d.feed.lastError ? "bad" : ""}` }, d.feed.lastError ? `Last delivery failed: ${d.feed.lastError} ${d.feed.waiting} waiting to be sent again.` : `${d.feed.sent.toLocaleString()} events sent since Talqava started${d.feed.lastSentAt ? `, the last ${when(d.feed.lastSentAt)}` : ""}.`) : null,
        canEdit ? h("div", { class: "row wrap" }, h("button", {}, d.feed.url ? "Save" : "Start sending"), d.feed.url ? h("button", { type: "button", class: "plain danger", onclick: () => confirm("Stop sending events to your monitoring system?") && act(() => api("PUT", "security-ops/feed", { url: "" }), "Stopped.") }, "Stop sending") : null) : h("p", { class: "note small" }, "Only owners and administrators change this."),
      ),
    );
  };
  draw();
  return box;
}

/** Security › the center: which protections are on, what needs attention, and a report to download. */
/**
 * What holds whatever an agent is told or reads. Each of these is done by Talqava itself, in its own code, and not
 * by asking the AI model to behave: an instruction lost in a long conversation, or words planted in a web page or
 * an email, cannot switch any of them off.
 */
function guaranteesCard() {
  const line = (title, words) => h("li", {}, h("b", {}, title), " ", words);
  return h(
    "section",
    { class: "isec guarantees" },
    h("h2", {}, "What agents cannot get around"),
    h("p", { class: "note" }, "These are enforced by Talqava itself, not by instructions to the AI model. An agent that forgets what it was told, or reads something written to mislead it, still cannot do any of this."),
    h(
      "ul",
      { class: "guaranteelist" },
      line("Your yes comes first.", "A step that sends, changes or deletes waits for your answer in the Inbox or the chat, unless you chose to let that agent run without asking."),
      line("Some commands are never run.", "Wiping a disk or your home folder, switching the computer off, taking administrator rights, running a program straight from the web, reading the passwords saved on this computer: refused before an approval is even offered."),
      line("Your keys stay out of sight.", "A key, token or password saved in Talqava is taken out of anything a tool returns before the AI model sees it."),
      line("Spending stops at the limit.", "A task stops at its budget, and no new work starts once a monthly limit is reached, until you raise it."),
      line("Telegram cannot run commands.", "A session reached from Telegram has no command line, and approvals are only ever given in the app."),
    ),
  );
}

function securityCenter() {
  const box = h("section", { class: "isec seccenter" });
  api("GET", "security-center")
    .then((o) => {
      const word = { on: "On", partly: "Partly", off: "Off" };
      const report = () =>
        attempt(async () => {
          const f = await api("GET", "security-center/report");
          const a = h("a", { href: URL.createObjectURL(new Blob([f.text], { type: "text/markdown" })), download: f.name });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, box);
      fill(
        box,
        h("div", { class: "row wrap" }, h("h2", { class: "grow" }, `Where you stand · ${o.on} of ${o.of} protections on`), h("button", { onclick: report }, "Download a security report")),
        o.attention.length ? h("div", { class: "card form" }, h("b", {}, "Needs you now"), o.attention.map((a) => h("div", { class: "row" }, h("span", { class: `chip ${a.level === "high" ? "bad" : "warn"}` }, a.level === "high" ? "High" : "Soon"), h("div", { class: "grow" }, a.words, h("div", { class: "note small" }, a.next))))) : null,
        h("div", { class: "card form" }, o.protections.map((x) => h("div", { class: "row secrow" }, x.state === "on" ? null : h("button", { class: "small secgo", onclick: (e) => e.currentTarget.dispatchEvent(new CustomEvent("securitytab", { bubbles: true, detail: { people: "people", "second-step": "people", sensitivity: "info", masking: "info", changes: "agents", web: "agents", caps: "agents", audit: "watching", stored: "backups" }[x.id] ?? "overview" })) }, "Fix"), h("span", { class: `chip ${x.state === "on" ? "on" : x.state === "partly" ? "warn" : ""}` }, word[x.state]), h("div", { class: "grow" }, h("b", {}, x.name), h("div", { class: "note small" }, x.words, x.next ? h("span", {}, " ", h("b", {}, x.next)) : null))))),
        h("p", { class: "note small" }, "The report states the settings in force. It supports an audit; it is not a certificate."),
      );
    })
    .catch(() => {});
  return box;
}

const LEVEL_NAMES = { public: "Public", internal: "Internal", confidential: "Confidential", restricted: "Restricted" };
/** In a page's, document's, note's or sheet's panel: how sensitive it is. */
function levelPicker(page, id) {
  const note = h("p", { class: "note small" });
  const words = { public: "Fine for anyone to see.", internal: "Everyday business. The starting level.", confidential: "Customer records, contracts, finances.", restricted: "Payroll, health, legal. Hidden from every agent not named on it under “Who can see it”." };
  const sel = h("select", { "aria-label": "Sensitivity" }, Object.entries(LEVEL_NAMES).map(([v, t]) => h("option", { value: v, selected: page.level === v }, t)));
  const say = () => (note.textContent = `${words[sel.value]} Which AI services may receive each level is set under Security.`);
  sel.addEventListener("change", () => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { level: sel.value }), (page.level = sel.value), say(), toast(`Marked ${LEVEL_NAMES[sel.value]}.`))));
  say();
  // A nudge when the text looks more sensitive than its level: the owner decides, with one press.
  const hint = page.levelHint
    ? h("div", { class: "banner" }, `This looks more sensitive than ${LEVEL_NAMES[page.level] ?? "its level"}: ${page.levelHint.why}. `, h("button", { class: "small", onclick: () => ((sel.value = page.levelHint.level), sel.dispatchEvent(new Event("change")), hint.remove()) }, `Mark ${LEVEL_NAMES[page.levelHint.level]}`))
    : null;
  return [levelsEditor(page, id), h("div", { class: "label" }, "Sensitivity"), hint, sel, note, projectPicker(page, id), page.kind === "sheet" || page.kind === "deck" ? null : checklistBox(page, id), commentsBox(page, id), page.kind === "sheet" || page.kind === "deck" ? linksBox(id) : null];
}

const ACCESS_WORDS = { none: "No access", read: "Read", comment: "Comment", suggest: "Suggest", edit: "Edit" };
/** In a file's panel: a level for each group and agent, when the simple settings are not enough. */
function levelsEditor(page, id) {
  const org = activeOrg();
  const groups = [...new Set<any>((org.members ?? []).map((m) => m.department))];
  const lv = page.levels;
  const summary = lv ? [lv.everyone ? `Every agent: ${ACCESS_WORDS[lv.everyone]}` : "Every other agent: No access", ...Object.entries<any>(lv.departments).map(([g, l]) => `${g}: ${ACCESS_WORDS[l]}`), ...Object.entries<any>(lv.agents).map(([a, l]) => `${org.members?.find((m) => m.bot === a)?.title ?? a}: ${ACCESS_WORDS[l]}`)].join(" · ") : "";
  const open = () => {
    const dialog = h("dialog", { class: "aidialog levelsdialog" });
    const close = () => (dialog.close(), dialog.remove());
    const choice = (value, unset?) => h("select", {}, unset ? h("option", { value: "", selected: !value }, unset) : null, Object.entries(ACCESS_WORDS).map(([v, t]) => h("option", { value: v, selected: value === v }, t)));
    const everyone = choice(lv?.everyone ?? (lv ? "none" : page.access.everyone ? (page.edit === "direct" ? "edit" : "suggest") : "none"));
    const byGroup = groups.map((g) => [g, choice(lv?.departments[g] ?? (!lv && page.access.departments.includes(g) ? (page.edit === "direct" ? "edit" : "suggest") : ""), "Same as every agent")]);
    const byAgent = (org.members ?? []).map((m) => [m, choice(lv?.agents[m.bot] ?? (!lv && page.access.agents.includes(m.bot) ? (page.edit === "direct" ? "edit" : "suggest") : ""), "Same as its group")]);
    const save = (levels) => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { levels }), close(), toast(levels ? "Levels saved." : "Back to the simple settings."), wsReload()), dialog);
    fill(
      dialog,
      h("h3", {}, `Who can do what with “${page.title}”`),
      h("p", { class: "note" }, "Each group and agent gets one level. The most specific one wins: an agent's own, then its group's, then the one for every agent."),
      h("ul", { class: "note small levelwords" }, h("li", {}, h("b", {}, "No access: "), "cannot find or read it."), h("li", {}, h("b", {}, "Read: "), "reads it; changes nothing."), h("li", {}, h("b", {}, "Comment: "), "reads it and leaves notes for you."), h("li", {}, h("b", {}, "Suggest: "), "its changes wait for you to accept."), h("li", {}, h("b", {}, "Edit: "), "changes it straight away; every version is kept.")),
      h("div", { class: "levelrows" }, h("label", {}, h("b", {}, "Every agent"), everyone), h("div", { class: "label" }, "Groups"), byGroup.map(([g, sel]) => h("label", {}, g, sel)), h("details", {}, h("summary", {}, "Agents by name"), byAgent.map(([m, sel]) => h("label", {}, m.title, sel)))),
      page.protected ? h("p", { class: "note small" }, "This file is Protected, so nobody goes above Suggest whatever is chosen here.") : null,
      h("div", { class: "row wrap" }, h("button", { class: "primary", onclick: () => save({ everyone: everyone.value, departments: Object.fromEntries(byGroup.filter(([, sel]) => sel.value).map(([g, sel]) => [g, sel.value])), agents: Object.fromEntries(byAgent.filter(([, sel]) => sel.value).map(([m, sel]) => [m.bot, sel.value])) }) }, "Save levels"), lv ? h("button", { onclick: () => save(null) }, "Back to the simple settings") : null, h("button", { class: "plain", onclick: close }, "Cancel")),
    );
    document.body.append(dialog);
    dialog.showModal();
  };
  return [h("div", { class: "label" }, "Levels"), lv ? h("p", { class: "note small" }, `${summary}. These levels are in force; the two choices above are not used.`) : h("p", { class: "note small" }, "One setting for everyone who can see it. For different groups to read, comment, suggest or edit:"), h("button", { class: "small", onclick: open }, lv ? "Change the levels" : "Set a level for each group")];
}

/** In a file's panel: comments from you and from agents that may comment. */
function commentsBox(page, id) {
  const list = h("div", { class: "wstasks" });
  const text = h("textarea", { rows: 2, placeholder: "Leave a comment", "aria-label": "Leave a comment" });
  const draw = () =>
    api("GET", `workspace/pages/${id}/comments`)
      .then((all) => fill(list, all.length ? all.map((c) => h("div", { class: "commentrow" }, h("div", {}, h("b", {}, c.authorName), h("span", { class: "note small" }, ` · ${when(c.createdAt)}`)), h("p", {}, c.text), h("button", { class: "plain small", onclick: () => attempt(async () => (await api("POST", `workspace/pages/${id}/comments/${c.id}`), draw())) }, "Resolve"))) : h("p", { class: "note small" }, "No comments.")))
      .catch(() => {});
  draw();
  return [h("div", { class: "label" }, `Comments${page.comments ? ` · ${page.comments}` : ""}`), list, text, h("button", { class: "small", onclick: () => text.value.trim() && attempt(async () => (await api("POST", `workspace/pages/${id}/comments`, { text: text.value }), (text.value = ""), draw())) }, "Add comment")];
}

/** In a file's panel: the project it belongs to. */
function projectPicker(page, id) {
  const sel = h("select", { "aria-label": "Project" }, h("option", { value: "" }, "No project"));
  const draw = (list) => fill(sel, h("option", { value: "" }, "No project"), list.map((p) => h("option", { value: p.id, selected: page.project === p.id }, p.title)), page.project && !list.some((p) => p.id === page.project) ? h("option", { value: page.project, selected: true }, "A project that was removed") : null);
  if (ui.projects) draw(ui.projects);
  else api("GET", "goals").then((g) => ((ui.goals = g.goals), (ui.projects = g.projects), draw(g.projects))).catch(() => {});
  sel.addEventListener("change", () => attempt(async () => (await api("PATCH", `workspace/pages/${id}`, { project: sel.value || null }), (page.project = sel.value || null), toast(sel.value ? "Added to the project. It is listed under the project's Files." : "Taken out of its project."))));
  return [h("div", { class: "label" }, "Project"), sel, page.project ? h("button", { class: "plain link small", onclick: () => go("project", page.project) }, "Open the project") : null];
}

/** In a file's panel: the tasks that read, changed or made it, and the pages that link to it. */
/**
 * In a note's or document's panel: its unticked checklist items, each of which can become a task for an agent. An
 * item that became a task shows the task and how far along it is; nothing in the note itself is changed.
 */
function checklistBox(page, id) {
  const items = [...new Set<any>(String(page.markdown ?? "").split("\n").map((l) => /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(l)?.[1].trim()).filter(Boolean))].slice(0, 30);
  if (!items.length) return null;
  const box = h("div", { class: "wstasks" });
  const mark = `page ${id}`;
  const draw = async () => {
    const work = await api("GET", "work").then((w) => w.items).catch(() => []);
    fill(
      box,
      items.map((text) => {
        const task = work.find((t) => t.title === text.slice(0, 140) && String(t.description ?? "").includes(mark));
        return h(
          "div",
          { class: "row wstaskrow" },
          h("span", { class: "grow" }, text),
          task
            ? h("button", { class: "plain link small", onclick: () => openTask(task.id) }, `Task #${task.number} · ${TASK_STATUS_WORDS[task.status] ?? task.status}`)
            : h("button", { class: "small", onclick: () => newTaskDialog({ name: text.slice(0, 140), text: `From the checklist in “${page.title}” (${mark}).`, onCreated: () => (toast("The task is started. It shows here beside the item."), draw()) }) }, "Make a task"),
        );
      }),
    );
  };
  draw();
  return [h("div", { class: "label" }, "Checklist"), box];
}

function linksBox(id) {
  const used = h("div", { class: "wstasks" });
  const from = h("div", { class: "wstasks" });
  api("GET", `workspace/pages/${id}/tasks`).then((tasks) => fill(used, tasks.length ? tasks.slice(0, 8).map((t) => h("button", { class: "plain wstaskrow", onclick: () => go("quest", t.task) }, h("span", { class: "grow" }, t.title), h("span", { class: "note small" }, t.how))) : h("p", { class: "note small" }, "No task has used it yet."))).catch(() => {});
  api("GET", `workspace/pages/${id}/backlinks`).then((pages) => fill(from, pages.length ? pages.map((p) => h("button", { class: "plain wstaskrow", onclick: () => openPage(p.id) }, h("span", { class: "grow" }, p.title))) : h("p", { class: "note small" }, "No page links here yet."))).catch(() => {});
  return [h("div", { class: "label" }, "Used by"), used, h("div", { class: "label" }, "Linked from"), from];
}

/** In a file's panel: who can see it: every agent, only some groups or agents, or nobody. */
function accessPicker(page, patch, org) {
  const groups = [...new Set<any>((org.members ?? []).map((m) => m.department))];
  const mode = () => (page.access.private ? "private" : page.access.everyone ? "everyone" : "some");
  const sel = h("select", { "aria-label": "Who can see it" }, [["everyone", "Every agent"], ["some", "Only some groups or agents"], ["private", "Private: no agent sees it"]].map(([v, t]) => h("option", { value: v, selected: mode() === v }, t)));
  const box = h("div", { class: "sheetgroups" });
  const save = (access) => patch({ access });
  const draw = () =>
    fill(
      box,
      sel.value === "some"
        ? [
            ...groups.map((g) => h("label", { class: "power" }, h("input", { type: "checkbox", checked: page.access.departments.includes(g), onchange: (e) => save({ departments: e.target.checked ? [...page.access.departments, g] : page.access.departments.filter((x) => x !== g), agents: page.access.agents }) }), g)),
            h("details", {}, h("summary", { class: "note small" }, `Or agents by name${page.access.agents.length ? ` · ${page.access.agents.length} chosen` : ""}`), (org.members ?? []).map((m) => h("label", { class: "power" }, h("input", { type: "checkbox", checked: page.access.agents.includes(m.bot), onchange: (e) => save({ departments: page.access.departments, agents: e.target.checked ? [...page.access.agents, m.bot] : page.access.agents.filter((x) => x !== m.bot) }) }), m.title))),
          ]
        : null,
    );
  sel.addEventListener("change", () => (save(sel.value === "everyone" ? { everyone: true } : sel.value === "private" ? { private: true } : { departments: page.access.departments, agents: page.access.agents }), draw()));
  draw();
  return [h("div", { class: "label" }, "Who can see it"), sel, box];
}

/** Security › Sensitive information: which AI services may receive each level. Only owners and administrators change it. */
function sensitivitySection(canEdit) {
  const box = h("section", { class: "isec" }, h("h2", {}, "Sensitive information"));
  const draw = async () => {
    let d;
    try {
      d = await api("GET", "sensitivity");
    } catch (err) {
      return fill(box, h("h2", {}, "Sensitive information"), h("div", { class: "banner error" }, err.message));
    }
    const save = (patch) => attempt(async () => (await api("PUT", "settings", { sensitivity: patch }), toast("Saved. It applies to every task that starts from now on."), draw()), box);
    const outside = d.services.filter((x) => !x.local);
    fill(
      box,
      h("h2", {}, "Sensitive information"),
      h("p", { class: "note", style: "margin: 0" }, "Every page, document, note and sheet has a sensitivity level, set in its side panel; Library documents have one too. Here you decide which AI services may receive each level. An agent whose AI service may not receive a level is not given those items, is told why, and it is logged."),
      h(
        "div",
        { class: "card officetable" },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ["Level", "For example", "May be sent to", "May leave through connected services"].map((t) => h("th", { scope: "col" }, t)))),
          h(
            "tbody",
            {},
            d.levels.map((l) => h("tr", {}, h("td", {}, h("b", {}, l.name)), h("td", {}, l.about), h("td", {}, h("select", { "aria-label": `${l.name} may be sent to`, disabled: !canEdit, onchange: (e) => save({ services: { [l.id]: e.target.value } }) }, d.where.map((w) => h("option", { value: w.id, selected: d.policy.services[l.id] === w.id }, w.words)))), h("td", {}, l.id === "public" ? "Yes" : h("label", { class: "power" }, h("input", { type: "checkbox", "aria-label": `${l.name} may leave through connected services`, disabled: !canEdit, checked: d.policy.leave[l.id], onchange: (e) => save({ leave: { [l.id]: e.target.checked } }) }), "Yes")))),
          ),
        ),
      ),
      h(
        "div",
        { class: "card form" },
        h("b", {}, "Approved AI services"),
        h("p", { class: "note small" }, "Tick the services you trust with levels set to “Only approved AI services”. Before you tick one, check its terms: that it does not train on your data, and where it processes it. Models on this computer always count."),
        outside.length
          ? outside.map((x) => {
              const on = d.policy.approved.includes(x.id);
              const t = d.policy.terms[x.id] ?? { trains: "unknown" };
              return h(
                "div",
                { class: "termsrow" },
                h("label", { class: "power" }, h("input", { type: "checkbox", disabled: !canEdit, checked: on, onchange: (e) => save({ approved: e.target.checked ? [...d.policy.approved, x.id] : d.policy.approved.filter((a) => a !== x.id) }) }), x.name),
                on
                  ? h(
                      "div",
                      { class: "row wrap" },
                      h("label", { class: "grow" }, "Where it processes data", h("select", { "aria-label": `Where ${x.name} processes data`, disabled: !canEdit, onchange: (e) => save({ terms: { [x.id]: { region: e.target.value || null } } }) }, h("option", { value: "", selected: !t.region }, "Not recorded"), d.regions.map((r) => h("option", { value: r.id, selected: t.region === r.id }, r.words)))),
                      h("label", { class: "grow" }, "Does it train on what you send?", h("select", { "aria-label": `Whether ${x.name} trains on what you send`, disabled: !canEdit, onchange: (e) => save({ terms: { [x.id]: { trains: e.target.value } } }) }, [["unknown", "Not recorded"], ["no", "No"], ["yes", "Yes"]].map(([v, w]) => h("option", { value: v, selected: t.trains === v }, w)))),
                    )
                  : null,
                x.why ? h("div", { class: "banner" }, `${x.name} does not count as approved right now: ${x.why}.`) : null,
              );
            })
          : h("p", { class: "note small" }, "No AI service outside this computer is connected."),
        h("div", { class: "label" }, "Where data may be processed"),
        h("div", { class: "checks" }, d.regions.map((r) => h("label", { class: "check" }, h("input", { type: "checkbox", disabled: !canEdit, checked: d.policy.regions.includes(r.id), onchange: (e) => save({ regions: e.target.checked ? [...d.policy.regions, r.id] : d.policy.regions.filter((a) => a !== r.id) }) }), " ", r.words))),
        h("p", { class: "note small" }, "With none ticked, anywhere is allowed. With some ticked, an approved service counts only when the place you recorded for it is one of them. These are your own record of each service's terms; Talqava cannot check them. A service you recorded as training on what it is sent never counts as approved."),
        canEdit ? h("div", { class: "row wrap" }, h("button", { onclick: () => confirm("Use the recommended settings?\n\nPublic and Internal: any connected AI service.\nConfidential: only approved services and models on this computer.\nRestricted: only models on this computer.\n\nAgents on a service that is not approved will stop being given Confidential items.") && save({ services: d.recommended }) }, "Use the recommended settings")) : h("p", { class: "note small" }, "Only owners and administrators change these rules."),
      ),
      h("p", { class: "note small" }, "Untick “May leave” for a level, and a task that has read anything of that level sends nothing out for the rest of that task: no change in a connected service or on your website, no call that sends data to a web address, no typing into a web page, no connector. It still reads and works, and puts what it would have sent in its report. The rule follows the task because, once an agent has read a page, nothing can tell which words of an email came from it."),
      h("div", { class: "card form" }, h("label", {}, "Memory (what your agents remember) counts as", h("select", { disabled: !canEdit, onchange: (e) => save({ memory: e.target.value }) }, d.levels.map((l) => h("option", { value: l.id, selected: d.policy.memory === l.id }, l.name)))), h("p", { class: "note small" }, "Memory has one level as a whole. An agent whose AI service may not receive that level works without the organization's memory.")),
      h("div", { class: "card form" }, h("b", {}, "In plain words, right now"), h("ul", {}, d.words.map((w) => h("li", {}, w))), h("p", { class: "note small" }, "A task can fall back to a backup model, so it is only given what every model it might use may receive.")),
    );
  };
  draw();
  return box;
}

/** Security › Agent guardrails: rules above every agent's own settings. Only owners and administrators change them. */
function guardrailsSection(canEdit) {
  const box = h("section", { class: "isec" }, h("h2", {}, "Agent guardrails"));
  const draw = async () => {
    let data;
    try {
      data = await api("GET", "guardrails");
    } catch (err) {
      return fill(box, h("h2", {}, "Agent guardrails"), h("div", { class: "banner error" }, err.message));
    }
    const g = data.rules;
    const save = (patch) => attempt(async () => (await api("PUT", "settings", { guardrails: patch }), toast("Saved. It applies to every task that starts from now on."), draw()), box);
    const choice = (key, options) => {
      const sel = h("select", { disabled: !canEdit, onchange: (e) => save({ [key]: e.target.value }) }, options.map(([v, t]) => h("option", { value: v, selected: g[key] === v }, t)));
      return sel;
    };
    const sites = h("textarea", { rows: 4, disabled: !canEdit, placeholder: "One site on each line, for example:\nexample.com\ngov.uk", "aria-label": "Approved sites" }, g.sites.join("\n"));
    const spend = h("input", { type: "number", min: "0", step: "0.5", value: g.maxTaskSpend ?? "", placeholder: "No cap", disabled: !canEdit, "aria-label": "Most a task may spend, in dollars" });
    const minutes = h("input", { type: "number", min: "1", step: "1", value: g.maxMinutes ?? "", placeholder: "No cap", disabled: !canEdit, "aria-label": "Longest a task may run, in minutes" });
    const day = h("input", { type: "number", min: "0", step: "1", value: g.maxDaySpend ?? "", placeholder: "No limit", disabled: !canEdit, "aria-label": "Most all tasks together may spend in a day, in dollars" });
    const stuck = h("input", { type: "number", min: "2", step: "1", value: g.pauseAfter ?? "", placeholder: "Never", disabled: !canEdit, "aria-label": "Pause an agent after its work got stuck this many times within an hour" });
    day.addEventListener("change", () => save({ maxDaySpend: day.value }));
    stuck.addEventListener("change", () => save({ pauseAfter: stuck.value }));
    spend.addEventListener("change", () => save({ maxTaskSpend: spend.value }));
    minutes.addEventListener("change", () => save({ maxMinutes: minutes.value }));
    const org = activeOrg();
    fill(
      box,
      h("h2", {}, "Agent guardrails"),
      h("p", { class: "note", style: "margin: 0" }, "Rules for every agent, above each agent's own settings. An agent or a task can be stricter than these, never looser. They apply to tasks that start after you change them."),
      h(
        "div",
        { class: "card form" },
        h("label", {}, "When an agent wants to change something (a file, a page, another system)", choice("changes", [["agent", "Each agent's own setting decides"], ["ask", "Always ask a person first"]])),
        h("label", {}, "Running commands on this computer", choice("commands", [["allowed", "Allowed for agents with that power"], ["ask", "Always ask a person first"], ["never", "Never"]])),
        h("label", {}, "Connected services (connectors)", choice("connectors", [["allowed", "Allowed; their tools ask before changing anything"], ["approved", "Only the services approved below"], ["never", "Never"]])),
        g.connectors === "approved"
          ? [
              h("div", { class: "label" }, "Approved connected services"),
              data.connected.length
                ? h("div", { class: "checks" }, data.connected.map((c) => h("label", { class: "check" }, h("input", { type: "checkbox", disabled: !canEdit, checked: g.services.includes(c.id), onchange: (e) => save({ services: e.target.checked ? [...g.services, c.id] : g.services.filter((x) => x !== c.id) }) }), " ", c.name)))
                : h("p", { class: "note small" }, "No service is connected yet. Connect one under Connections, then approve it here."),
              h("p", { class: "note small" }, "Agents get the tools of ticked services only. A service connected later is off until you tick it."),
            ]
          : null,
        data.people.length >= 2
          ? [
              h("div", { class: "label" }, "Who approves each kind of step"),
              data.stepKinds.map((k) => {
                const r = g.approvers[k.id] ?? { people: [], two: false };
                return h(
                  "div",
                  { class: "termsrow" },
                  h("div", {}, k.words),
                  h("div", { class: "checks" }, data.people.map((p) => h("label", { class: "check" }, h("input", { type: "checkbox", disabled: !canEdit, checked: r.people.includes(p.id), onchange: (e) => save({ approvers: { [k.id]: { people: e.target.checked ? [...r.people, p.id] : r.people.filter((x) => x !== p.id) } } }) }), " ", p.name)), h("label", { class: "check" }, h("input", { type: "checkbox", disabled: !canEdit, checked: r.two, onchange: (e) => save({ approvers: { [k.id]: { two: e.target.checked } } }) }), " ", h("b", {}, "Two people must approve"))),
                );
              }),
              h("p", { class: "note small" }, "With nobody ticked, anyone who may approve today still may. With people ticked, only they may. With two people, the step waits until a second, different person approves; either may refuse it. Such a step is approved each time, never “always”. These rules cover steps that already ask; whether a step asks is set above and on each agent."),
            ]
          : h("p", { class: "note small" }, "To name who approves each kind of step, or to require two people, add at least two people under People and sign-in."),
        h("label", {}, "The Marketplace", choice("market", [["any", "Anything may be added"], ["approved", "Only items an owner or administrator approved"]])),
        g.market === "approved"
          ? [
              h("div", { class: "label" }, `Approved Marketplace items · ${g.listings.length}`),
              g.listings.length ? h("ul", { class: "refused" }, g.listings.map((id) => h("li", {}, id.replace(/^team:/, "Team: ").replace(/^kit:/, "Template or playbook: "), " ", canEdit ? h("button", { class: "plain link", onclick: () => save({ removeListing: id }) }, "Remove") : null))) : h("p", { class: "note small" }, "None yet."),
              h("p", { class: "note small" }, "To approve one, open it in the Marketplace and press its add button: you are asked whether to approve it. Agents already on your team stay."),
            ]
          : null,
        h("label", {}, "Deleting in a connected service (a calendar event, a file)", choice("deletes", [["ask", "Always ask a person first"], ["never", "Never"]])),
        h("label", {}, "The web", choice("web", [["any", "Any site, for agents with that power"], ["approved", "Only the sites approved below"], ["never", "Never"]])),
        g.web === "approved" ? [h("label", {}, "Approved sites", sites), h("p", { class: "note small" }, "A site covers its pages and its sub-sites: example.com also allows www.example.com. With none listed, the web is off."), canEdit ? h("div", {}, h("button", { onclick: () => save({ sites: sites.value }) }, "Save the list")) : null] : null,
        h("div", { class: "row wrap" }, h("label", { class: "grow" }, "Most one task may spend ($)", spend), h("label", { class: "grow" }, "Longest one task may run (minutes)", minutes)),
        h("p", { class: "note small" }, "These caps only ever tighten: an agent with a lower budget keeps it. Leave empty for no extra cap."),
        h("div", { class: "row wrap" }, h("label", { class: "grow" }, "Most all tasks together may spend in a day ($)", day), h("label", { class: "grow" }, "Pause an agent after its work got stuck this many times in an hour", stuck)),
        h("p", { class: "note small" }, data.spentToday !== undefined ? `Spent by tasks today: $${Number(data.spentToday).toFixed(2)}. When the daily limit is reached, nothing more starts until the next day or until you raise it. A paused agent loses nothing; resume it from Tasks.` : "When the daily limit is reached, nothing more starts until the next day or until you raise it."),
        canEdit ? null : h("p", { class: "note small" }, "Only owners and administrators change these rules."),
      ),
      h("div", { class: "card form" }, h("b", {}, "In plain words, right now"), h("ul", {}, data.words.map((w) => h("li", {}, w)))),
      org.members?.length
        ? h("div", { class: "card form stopall" }, h("div", { class: "row wrap" }, h("div", { class: "grow" }, h("b", {}, "Stop all agents"), h("p", { class: "note small", style: "margin: 2px 0 0" }, "Every agent on your chart pauses at once. Nothing is lost; resume them from Tasks when you are ready.")), h("button", { class: "danger", onclick: () => confirm("Pause every agent now? Work in progress stops where it is and can be resumed.") && attempt(async () => (await api("POST", "work/agents/pause", { all: true }), toast("Every agent is paused. Resume them from Tasks.")), box) }, "Stop everything")))
        : null,
      h("div", { class: "card form" }, h("b", {}, "Refused by these rules, and changes to them"), data.refused.length ? h("ul", { class: "refused" }, data.refused.map((e) => h("li", {}, h("span", { class: "note small" }, `${when(e.at)} · `), e.action, e.detail ? h("span", { class: "note small" }, ` · ${e.detail}`) : null))) : h("p", { class: "note small" }, "Nothing yet.")),
    );
  };
  draw();
  return box;
}

/** A table's columns: names, types and choices. Saving keeps the values that still fit. */
function columnsDialog(t, types, done) {
  const dialog = h("dialog", { class: "aidialog" });
  const close = () => (dialog.close(), dialog.remove());
  const status = h("p", { class: "note", role: "status" });
  const TYPE_WORDS = { text: "Text", number: "Number", date: "Date", choice: "Choice (pick one)", person: "Person (you or an agent)" };
  const list = h("div", { class: "colrows" });
  const addRow = (c: any = { name: "", type: "text" }) => {
    const name = h("input", { value: c.name, placeholder: "Column name", "aria-label": "Column name" });
    const type = h("select", { "aria-label": "Type" }, types.map((x) => h("option", { value: x, selected: x === c.type }, TYPE_WORDS[x] ?? x)));
    const options = h("input", { value: (c.options ?? []).join(", "), placeholder: "Choices, separated by commas", "aria-label": "Choices", hidden: c.type !== "choice" });
    type.addEventListener("change", () => (options.hidden = type.value !== "choice"));
    const row = h("div", { class: "colrow" }, name, type, options, h("button", { type: "button", class: "plain small danger", "aria-label": "Remove this column", onclick: () => row.remove() }, "Remove"));
    row.read = () => ({ id: c.id, name: name.value, type: type.value, options: options.value });
    list.append(row);
    return name;
  };
  t.columns.forEach((c) => addRow(c));
  const save = h("button", { class: "primary" }, "Save columns");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api("PATCH", `workspace/tables/${t.id}`, { columns: [...list.children].map((r) => r.read()) });
      close();
      done();
    } catch (err) {
      status.textContent = err.message;
      status.className = "note bad";
      save.disabled = false;
    }
  });
  fill(
    dialog,
    h("h3", {}, `Columns of “${t.name}”`),
    h("p", { class: "note" }, "Each column holds one kind of value. If you change a column's type, values that no longer fit are emptied; removing a column removes its values."),
    list,
    h("div", {}, h("button", { type: "button", class: "small", onclick: () => addRow().focus() }, "+ Add a column")),
    status,
    h("div", { class: "row" }, save, h("button", { class: "plain", onclick: close }, "Cancel")),
  );
  document.body.append(dialog);
  dialog.showModal();
}

/** The tables on a workspace page: rows you edit in place, changes agents asked for, CSV in and out. */
async function drawTables(box, pageId) {
  let data;
  try {
    data = await api("GET", `workspace/tables?page=${encodeURIComponent(pageId)}`);
  } catch {
    return;
  }
  if (ui.ws?.open !== pageId) return;
  const again = () => drawTables(box, pageId);
  const run = (fn) => attempt(async () => (await fn(), await again(), loadPageSuggestions()), box);
  const pickCsv = (then) => {
    const input = h("input", { type: "file", accept: ".csv,text/csv" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5_000_000) return toast("That file is larger than 5 MB. Split it into smaller files.");
      then(await file.text(), file.name.replace(/\.csv$/i, ""));
    });
    input.click();
  };
  const cell = (t, r, c) => {
    const v = r.values[c.id] ?? "";
    const set = (value) => attempt(async () => void (await api("POST", `workspace/tables/${t.id}/rows/${r.id}`, { values: { [c.id]: value } })), box).then(again);
    const label = `${c.name}`;
    if (c.type === "choice" || c.type === "person") {
      const options = c.type === "choice" ? c.options ?? [] : data.people;
      const sel = h("select", { "aria-label": label }, h("option", { value: "" }, ""), options.map((o) => h("option", { value: o, selected: o === v }, o)), v && !options.includes(v) ? h("option", { value: v, selected: true }, v) : null);
      sel.addEventListener("change", () => set(sel.value));
      return sel;
    }
    const input = h("input", { type: c.type === "number" ? "number" : c.type === "date" ? "date" : "text", value: String(v), step: "any", "aria-label": label });
    input.addEventListener("change", () => set(input.value));
    return input;
  };
  const one = (t) => {
    const name = h("input", { class: "tblname", value: t.name, "aria-label": "Table name" });
    name.addEventListener("change", () => run(() => api("PATCH", `workspace/tables/${t.id}`, { name: name.value })));
    const exportCsv = () =>
      attempt(async () => {
        const f = await api("GET", `workspace/tables/${t.id}/csv`);
        const a = h("a", { href: URL.createObjectURL(new Blob([f.csv], { type: "text/csv" })), download: f.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, box);
    const labelOf = (r) => String(t.columns.map((c) => r.values[c.id]).find((x) => x != null && x !== "") ?? "this row");
    return h(
      "div",
      { class: "card tbl" },
      h(
        "div",
        { class: "row wrap" },
        h("div", { class: "grow" }, name, h("div", { class: "note small tblnote" }, `${t.rows.length} row${t.rows.length === 1 ? "" : "s"} · ${t.agentsChangeDirectly ? "agents change it straight away" : "agents' changes wait for you"}`)),
        h("button", { class: "small", onclick: () => columnsDialog(t, data.types, again) }, "Columns"),
        h("button", { class: "small", onclick: () => pickCsv((csv) => run(async () => toast(`${(await api("POST", "workspace/tables/import", { table: t.id, csv })).added} rows added.`))) }, "Import CSV"),
        h("button", { class: "small", onclick: exportCsv }, "Export CSV"),
        h("button", { class: "small plain danger", onclick: () => confirm(`Delete the table “${t.name}” and its ${t.rows.length} row${t.rows.length === 1 ? "" : "s"}? This cannot be undone. Export it first if you may need it.`) && run(() => api("DELETE", `workspace/tables/${t.id}`)) }, "Delete"),
      ),
      t.changes.length
        ? h(
            "div",
            { class: "tblwaiting" },
            h("div", { class: "label" }, `Waiting for you · ${t.changes.length}`),
            t.changes.map((ch) => {
              const target = ch.row ? t.rows.find((r) => r.id === ch.row) : null;
              const words = `${ch.row ? `Change “${target ? labelOf(target) : "a deleted row"}”` : "Add a row"}: ${t.columns.filter((c) => c.id in ch.values).map((c) => `${c.name} = ${ch.values[c.id] ?? "(empty)"}`).join(", ")}`;
              return h("div", { class: "row wrap" }, h("span", { class: "grow" }, h("b", {}, ch.authorName), ` · ${words}`, ch.note ? h("span", { class: "note small" }, ` · ${ch.note}`) : null), h("button", { class: "small primary", onclick: () => run(() => api("POST", `workspace/tables/${t.id}/changes/${ch.id}`, { decision: "accept" })) }, "Accept"), h("button", { class: "small", onclick: () => run(() => api("POST", `workspace/tables/${t.id}/changes/${ch.id}`, { decision: "decline" })) }, "Decline"));
            }),
          )
        : null,
      h(
        "div",
        { class: "tblscroll" },
        h(
          "table",
          { class: "tblgrid" },
          h("thead", {}, h("tr", {}, t.columns.map((c) => h("th", { scope: "col" }, c.name, h("span", { class: "note small" }, ` ${c.type}`))), h("th", { "aria-label": "Delete" }))),
          h(
            "tbody",
            {},
            t.rows.map((r) => h("tr", {}, t.columns.map((c) => h("td", {}, cell(t, r, c))), h("td", {}, h("button", { class: "plain small danger", "aria-label": `Delete the row ${labelOf(r)}`, title: "Delete this row", onclick: () => confirm(`Delete the row “${labelOf(r)}”?`) && run(() => api("DELETE", `workspace/tables/${t.id}/rows/${r.id}`)) }, "×")))),
          ),
        ),
      ),
      h("div", {}, h("button", { class: "small", onclick: () => run(() => api("POST", `workspace/tables/${t.id}/rows`, { values: {} })) }, "+ Add a row")),
    );
  };
  fill(
    box,
    data.tables.length ? h("h3", {}, "Tables") : null,
    data.tables.map(one),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "small", onclick: () => run(() => api("POST", "workspace/tables", { page: pageId, name: "New table", columns: [{ name: "Name", type: "text" }, { name: "Status", type: "choice", options: ["To do", "Doing", "Done"] }, { name: "Owner", type: "person" }, { name: "Due", type: "date" }, { name: "Amount", type: "number" }] })) }, "+ Add a table"),
      h("button", { class: "small", onclick: () => pickCsv((csv, name) => run(() => api("POST", "workspace/tables/import", { page: pageId, name, csv }))) }, "Import a CSV as a new table"),
      data.tables.length ? null : h("span", { class: "note small" }, "A table holds records such as customers, stock or a tracker. Agents who can see this page can read it."),
    ),
  );
}

/** Which guide explains each page. */
const GUIDES_BY_VIEW = { chat: "chat", inbox: "inbox", tasks: "tasks", projects: "projects", project: "projects", home: "work-in-progress", quest: "work-in-progress", bot: "work-in-progress", jobs: "schedules", team: "organization", market: "marketplace", marketbot: "marketplace", workspace: "workspace", start: "getting-started", office: "office", slides: "office", docs: "office", notes: "office", security: "security", sheets: "office", library: "library", memory: "memory", skills: "skills", audit: "audit-log", integrations: "integrations", settings: "settings" };
const guideFor = (view) => (view === "integrations" && ui.integration === "ai-models" ? "ai-models" : GUIDES_BY_VIEW[view] ?? null);

/** Shows a user guide in a reader beside the page. Links between guides open in the reader; the list of guides is on the left. */
async function showGuide(id) {
  let doc;
  let list: any[] = [];
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
// For the desktop app's menu bar item: start a new session from anywhere.
window.talqavaNewSession = () => go("chat");
// A link to one of Talqava's own documents never leaves the page; the reader showing it opens it.
document.addEventListener("click", (e) => (e.target as Element).closest?.("a.doclink") && e.preventDefault(), true);

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
    .replace(/^([A-Z]{1,2}\d{1,4})\t/, "$1: ") // a sheet's cell
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
        i === 0 ? null : h("button", { class: "small", onclick: () => confirm("Put this version back? The page as it is now stays in the history.") && attempt(async () => (await api("POST", `workspace/pages/${page.id}/revisions/${v.rev}`), document.querySelector<HTMLDialogElement>("dialog.libdialog")?.close(), document.querySelector("dialog.libdialog")?.remove(), workspaceView())) }, "Put back"),
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
  ["done", "Done", "The last two weeks, unless you show older work"],
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
  const signature = JSON.stringify([data.items.map((t) => [t.id, t.status, t.detail, t.queue, t.priority, t.title, t.comments, t.owner, t.subtasks.open, t.goal, t.projectId, t.pausedAt, t.attention?.words]), planned, data.pausedAgents]);
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
  const crew = new Map<any, any>((state.crew?.bots ?? []).map((b) => [b.id, b]));
  ui.taskFilter ??= { who: "", q: "", cancelled: false, plan: "" };
  const f = ui.taskFilter;
  const twoWeeks = Date.now() - 14 * 86400_000;
  const inPlan = (t) => !f.plan || (f.plan.startsWith("goal:") ? t.goal === f.plan.slice(5) : t.projectId === f.plan.slice(8));
  // Done work older than two weeks is folded away, unless the owner asks for it or is searching (search finds any age).
  const shown = ui.tasks.filter((t) => (!f.look || t.attention) && (!f.who || t.owner === f.who) && inPlan(t) && (!f.q || `${t.number} ${t.title} ${t.ownerName}`.toLowerCase().includes(f.q.toLowerCase())) && (t.status !== "done" || f.older || f.q || Date.parse(t.updatedAt) > twoWeeks));
  const older = ui.tasks.filter((t) => t.status === "done" && Date.parse(t.updatedAt) <= twoWeeks).length;
  const plan = h(
    "select",
    { "aria-label": "Goal or project", onchange: (e) => ((f.plan = e.target.value), drawBoard()) },
    h("option", { value: "" }, "All goals and projects"),
    (ui.goals ?? []).filter((g) => g.status === "active").map((g) => h("option", { value: `goal:${g.id}`, selected: f.plan === `goal:${g.id}` }, `Goal: ${g.title}`)),
    (ui.projects ?? []).filter((p) => p.status !== "done").map((p) => h("option", { value: `project:${p.id}`, selected: f.plan === `project:${p.id}` }, `Project: ${p.title}`)),
  );
  const search = h("input", { type: "search", value: f.q, placeholder: "Find a task", "aria-label": "Find a task" });
  search.addEventListener("input", () => ((f.q = search.value), drawBoard(), document.querySelector<HTMLElement>(".tasks input[type=search]")?.focus()));
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
      t.attention ? h("span", { class: "taskattn", title: t.attention.words }, t.attention.kind === "stalled" ? "⚠ May be stuck" : "⏳ Waiting a long time") : null,
      t.projectName || t.goalTitle ? h("span", { class: "taskplan", title: t.goalTitle ? `Serves the goal: ${t.goalTitle}` : "" }, t.projectName ? `◇ ${t.projectName}` : `◎ ${t.goalTitle}`) : null,
      h("div", { class: "taskmeta" }, bot ? keycap(bot, 18, t.status === "working" ? "working" : "", bot.type) : null, h("span", { class: "grow" }, t.ownerName), t.subtasks.total ? h("span", { title: "Sub-tasks still open" }, `◫ ${t.subtasks.open}/${t.subtasks.total}`) : null, t.comments ? h("span", { title: "Comments" }, `💬 ${t.comments}`) : null, t.cost >= 0.01 ? h("span", {}, money(t.cost)) : null),
    );
  };
  if (!(ui.tasks ?? []).length)
    return fill(
      col,
      tasksHead(),
      h("div", { class: "card quiet firsttask" }, h("b", {}, "No tasks yet."), h("p", { class: "note" }, "A task is work you hand to someone on your team: they do it in the background and bring it back for you to accept."), h("div", { class: "row" }, h("button", { class: "primary", onclick: () => newTaskDialog() }, "Give the first task"))),
    );
  fill(
    col,
    tasksHead(),
    h("div", { class: "row tasks-tools" }, search, who, plan, h("label", { class: "power" }, h("input", { type: "checkbox", checked: f.cancelled, onchange: (e) => ((f.cancelled = e.target.checked), drawBoard()) }), "Show cancelled"), older ? h("label", { class: "power" }, h("input", { type: "checkbox", checked: Boolean(f.older), onchange: (e) => ((f.older = e.target.checked), drawBoard()) }), `Show older done work (${older})`) : null),
    todayStrip(f),
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

/** At a glance: what is being worked on, what needs the owner, what deserves a look, and what finished today. */
function todayStrip(f) {
  const tasks = ui.tasks ?? [];
  const today = new Date().toDateString();
  const count = (test) => tasks.filter(test).length;
  const look = count((t) => t.attention);
  const tile = (n, label, hint, cls = "", onclick = null) => h(onclick ? "button" : "div", { class: `todaytile ${cls} ${onclick ? "plain" : ""}`, title: hint, ...(onclick ? { onclick, "aria-pressed": String(Boolean(f.look)) } : {}) }, h("b", {}, String(n)), h("span", {}, label));
  return h(
    "div",
    { class: "todaystrip", role: "group", "aria-label": "At a glance" },
    tile(count((t) => t.status === "working"), "Working now", "Tasks an agent is doing right now"),
    tile(count((t) => t.status === "waiting" || t.status === "blocked"), "Need you", "Waiting for your answer, or stuck"),
    tile(look, f.look ? "Need a look (showing only these)" : "Need a look", "No progress for a while, or waiting a long time. Click to show only these.", look ? `warn ${f.look ? "on" : ""}` : "", look || f.look ? () => ((f.look = !f.look), drawBoard()) : null),
    tile(count((t) => t.status === "review"), "To review", "Finished: accept it, or send it back"),
    tile(count((t) => t.status === "done" && new Date(t.updatedAt).toDateString() === today), "Done today", "Accepted or finished today"),
  );
}

/**
 * Staying in charge: which agents are paused (with Resume), and buttons to pause the agent being looked at or all
 * work. Pausing stops work under way at a clean point; it leaves a hand-over note and carries on from it when resumed.
 */
function pauseBar(org, who) {
  const paused = ui.pausedAgents ?? [];
  const pausedIds = new Set<any>(paused.map((a) => a.bot));
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
  const crew = new Map<any, any>((state.crew?.bots ?? []).map((b) => [b.id, b]));
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
    t.attention ? h("div", { class: "banner" }, t.attention.kind === "stalled" ? "⚠ " : "⏳ ", t.attention.words) : null,
    h(
      "div",
      { class: "taskactions row wrap" },
      t.status === "review" ? h("button", { class: "primary small", onclick: () => act(() => api("POST", `work/${id}/accept`)) }, "Accept") : null,
      // Stuck, waiting or paused work can still be good enough: the owner can take it as it is.
      ["blocked", "waiting", "paused"].includes(t.status) ? h("button", { class: "small", title: "Close the task with the work done so far", onclick: () => confirm(`Accept task #${t.number} as it is?\n\nIt is closed with the work done so far${t.status === "waiting" ? ", and what it was waiting for is dropped" : ""}.`) && act(() => api("POST", `work/${id}/accept`)) }, "Accept as it is") : null,
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
async function newTaskDialog({ parent = null, owner = "", text = "", goal = "", projectId = "", name = "", onCreated = null } = {}) {
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
  const title = h("input", { maxlength: 140, placeholder: "e.g. Find ten wholesale bakeries near us", "aria-label": "Task", value: name });
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
    if (reply?.item) onCreated ? onCreated(reply.item) : openTask(reply.item.id);
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
                h("button", { class: "plain small", onclick: () => go("project", p.id) }, "Open"),
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
  const status = h("select", { "aria-label": "Status" }, (project ? ["planning", "active", "paused", "done"] : ["active", "planning"]).map((s) => h("option", { value: s, selected: (project?.status ?? "active") === s }, PROJECT_STATUS_WORDS[s])));
  const doneWhen = h("textarea", { rows: 2, placeholder: "e.g. Ten shops stock the new line and reorder once", "aria-label": "Done when" }, project?.doneWhen ?? "");
  const due = h("input", { type: "date", value: project?.due ?? "", "aria-label": "Due" });
  const got = await libDialog(project ? "Edit the project" : "New project", h("div", { class: "composeform" }, h("label", {}, "Project", title), h("label", {}, "About", about), h("label", {}, "Done when", doneWhen), h("div", { class: "row" }, h("label", { class: "grow" }, "Due", due), h("label", { class: "grow" }, "Status", status)), h("div", { class: "row" }, h("label", { class: "grow" }, "Goal", forGoal), h("label", { class: "grow" }, "Led by", lead)), h("p", { class: "note small" }, "A project is one folder for a body of work: its tasks, its chats and its own memory. Tasks in it serve its goal, and its lead is the natural owner of its tasks.")), [[project ? "Save" : "Start the project", () => ({ title: title.value.trim(), description: about.value.trim(), doneWhen: doneWhen.value.trim(), due: due.value || null, goal: forGoal.value || null, lead: lead.value || null, status: status.value }), true]]);
  if (!got) return;
  await attempt(async () => {
    const saved = project ? await api("PATCH", `projects/${project.id}`, got) : await api("POST", "projects", got);
    ui.projects = null;
    await loadSpaces().catch(() => {});
    if (state.view === "projects") return projectsView();
    if (state.view === "project") return projectView();
    if (!project && state.view !== "tasks") return go("project", saved.id);
    ui.tasksMode = "goals";
    await refreshTasks(true);
  }, ui.tasksCol ?? ui.body);
}

// ---------- projects: one folder for a body of work ----------
const PROJECT_STATUS_WORDS = { planning: "Planning", active: "Active", paused: "Paused", done: "Done" };
const HEALTH_WORDS = { "on-track": ["On track", "ok"], "at-risk": ["At risk", "warnline"], "off-track": ["Off track", "badline"] };
const healthTag = (p) => (p.health ? h("span", { class: `tag ${HEALTH_WORDS[p.health][1]}`, title: p.healthWhy || "Nothing is late or stuck" }, HEALTH_WORDS[p.health][0]) : null);

/** Every project as a card, grouped by status. */
async function projectsView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "projectspage" });
  fill(ui.body, h("main", { class: "center" }, col));
  let data;
  try {
    data = await api("GET", "projects");
  } catch (err) {
    return fill(col, h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "projects") return;
  ui.goals = data.goals;
  ui.projects = data.projects;
  loadSpaces().catch(() => {});
  const org = activeOrg();
  const f = (ui.projectFilter ??= { needs: false, goal: "", lead: "" });
  const shown = data.projects.filter((p) => (!f.needs || p.needsYou) && (!f.goal || p.goal === f.goal) && (!f.lead || p.lead === f.lead));
  const card = (p) =>
    h(
      "button",
      { class: `card projectcard st-${p.status}`, onclick: () => go("project", p.id) },
      h("div", { class: "row" }, h("b", { class: "grow projecttitle" }, p.title), healthTag(p)),
      h("div", { class: "note small" }, [p.leadName ? `Led by ${p.leadName}` : "No lead", p.goalTitle ? `Serves: ${p.goalTitle}` : null].filter(Boolean).join(" · ")),
      p.tasks.total ? h("span", { class: "goalbar tasks", role: "progressbar", "aria-valuenow": String(p.tasks.done), "aria-valuemax": String(p.tasks.total) }, h("i", { style: `width:${(p.tasks.done / p.tasks.total) * 100}%` })) : null,
      h("div", { class: "row note small" }, h("span", { class: "grow" }, [p.tasks.total ? `${p.tasks.done} of ${p.tasks.total} task${p.tasks.total === 1 ? "" : "s"} done` : "No tasks yet", p.chats ? `${p.chats} chat${p.chats === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")), p.due ? h("span", { class: p.health === "off-track" && p.healthWhy.startsWith("Past") ? "bad" : "" }, dueWords(p.due)) : null),
      p.needsYou ? h("div", {}, h("span", { class: "tag warnline" }, `${p.needsYou} need${p.needsYou === 1 ? "s" : ""} you`)) : null,
    );
  const group = (status) => {
    const list = shown.filter((p) => p.status === status);
    if (!list.length) return null;
    const grid = h("div", { class: "projectgrid" }, list.map(card));
    return status === "done" ? h("details", { class: "projectgroup" }, h("summary", {}, `Done · ${list.length}`), grid) : h("section", { class: "projectgroup" }, h("h2", {}, `${PROJECT_STATUS_WORDS[status]} · ${list.length}`), grid);
  };
  const pick = (label, value, options, set) => h("select", { "aria-label": label, onchange: (e) => (set(e.target.value), projectsView()) }, h("option", { value: "" }, label), options.map(([v, words]) => h("option", { value: v, selected: v === value }, words)));
  fill(
    col,
    h("div", { class: "row wrap" }, h("div", { class: "grow" }, h("h1", {}, "Projects"), h("p", { class: "lead" }, "One folder for each body of work: its tasks, its chats and its own memory, its lead, and where it stands.")), h("button", { class: "primary", onclick: () => projectDialog() }, "+ New project")),
    data.projects.length
      ? h(
          "div",
          { class: "row wrap projectfilters" },
          h("label", { class: "power" }, h("input", { type: "checkbox", checked: f.needs, onchange: (e) => ((f.needs = e.target.checked), projectsView()) }), "Needs me"),
          data.goals.length ? pick("Any goal", f.goal, data.goals.map((g) => [g.id, g.title]), (v) => (f.goal = v)) : null,
          org.members.length ? pick("Any lead", f.lead, org.members.filter((m) => data.projects.some((p) => p.lead === m.bot)).map((m) => [m.bot, m.title]), (v) => (f.lead = v)) : null,
        )
      : null,
    data.projects.length
      ? shown.length
        ? ["active", "planning", "paused", "done"].map(group)
        : h("p", { class: "note" }, "No project matches. Clear a filter to see them all.")
      : h("div", { class: "card projectempty" }, h("b", {}, "No projects yet"), h("p", { class: "note" }, "Start one for a client, a launch or anything with several tasks. Its tasks and chats then sit together, and its chats keep their own memory, apart from other projects."), h("div", {}, h("button", { class: "primary", onclick: () => projectDialog() }, "+ New project"))),
  );
}

/** One project: its header, then Overview, Tasks and Chats. */
async function projectView() {
  ui.body.className = "body";
  ui.log = null;
  const col = h("div", { class: "projectspage" });
  fill(ui.body, h("main", { class: "center" }, col));
  const id = state.projectId;
  let data;
  try {
    [data] = await Promise.all([api("GET", `projects/${id}`), ui.goals ? null : api("GET", "goals").then((g) => ((ui.goals = g.goals), (ui.projects = g.projects)))]);
  } catch (err) {
    return fill(col, h("button", { class: "plain back", onclick: () => go("projects") }, "← All projects"), h("div", { class: "banner error" }, err.message));
  }
  if (state.view !== "project" || state.projectId !== id) return;
  const p = data.project;
  const again = () => projectView();
  const act = (fn) => attempt(async () => (await fn(), (ui.projects = null), await again()), col);
  const tab = (ui.projectTab ??= "overview");
  const tabBtn = (key, label) => h("button", { class: tab === key ? "on" : "", role: "tab", "aria-selected": String(tab === key), onclick: () => ((ui.projectTab = key), again()) }, label);
  const status = h("select", { "aria-label": "Status", onchange: (e) => act(() => api("PATCH", `projects/${p.id}`, { status: e.target.value })) }, Object.entries(PROJECT_STATUS_WORDS).map(([v, words]) => h("option", { value: v, selected: p.status === v }, words)));
  const taskRow = (t) => h("button", { class: "plain projectrow", onclick: () => openTask(t.id) }, h("span", { class: `taskdot st-${t.status}`, title: TASK_STATUS_WORDS[t.status] }), h("span", { class: "grow" }, `#${t.number} ${t.title}`), h("span", { class: "note small" }, `${t.ownerName} · ${TASK_STATUS_WORDS[t.status]}`));
  const needs = data.tasks.filter((t) => ["review", "waiting", "blocked"].includes(t.status));
  const startChat = () =>
    attempt(async () => {
      const { space } = await api("POST", `projects/${p.id}/chat`);
      await loadSpaces();
      setSpace(space);
      go("chat");
    }, col);
  const openChat = (c) =>
    attempt(async () => {
      await loadSpaces();
      setSpace(p.space);
      go("chat", c.id);
    }, col);
  const remove = () => confirm(`Remove the project “${p.title}”?\n\nIts ${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"} stay, without a project. Its chats move to General, and the project's own memory is deleted.`) && attempt(async () => (await api("DELETE", `projects/${p.id}`), (ui.projects = null), await loadSpaces().catch(() => {}), go("projects")), col);
  const overview = () => [
    h("section", { class: "card" }, h("div", { class: "label" }, "What it covers"), p.description ? h("p", {}, p.description) : h("p", { class: "note" }, "No description yet. Press Edit to add one."), h("div", { class: "label" }, "Done when"), p.doneWhen ? h("p", {}, p.doneWhen) : h("p", { class: "note" }, "Not said yet. Saying what done looks like helps your agents aim at it.")),
    h("section", { class: "card" }, h("div", { class: "label" }, `Needs you · ${needs.length}`), needs.length ? needs.map(taskRow) : h("p", { class: "note" }, "Nothing in this project is waiting on you.")),
    h("section", { class: "card" }, h("div", { class: "label" }, "Team"), p.team.length ? h("p", {}, p.team.join(", ")) : h("p", { class: "note" }, "Nobody yet. Agents join when they take a task in the project.")),
  ];
  const tasks = () => {
    const order = ["working", "review", "waiting", "blocked", "todo", "paused", "done"];
    const sorted = [...data.tasks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.number - b.number);
    return [
      h("div", { class: "row" }, h("span", { class: "grow note" }, p.tasks.total ? `${p.tasks.done} of ${p.tasks.total} done` : "No tasks yet. Add the first one."), data.tasks.length ? h("button", { class: "small", onclick: () => (((ui.taskFilter ??= { who: "", q: "", cancelled: false, plan: "" }).plan = `project:${p.id}`), (ui.tasksMode = "board"), go("tasks")) }, "Open on the board") : null, h("button", { class: "small primary", onclick: () => newTaskDialog({ projectId: p.id, owner: p.lead || "" }) }, "+ Task")),
      sorted.length ? h("section", { class: "card" }, sorted.map(taskRow)) : null,
    ];
  };
  const FILE_KIND = { doc: "Document", sheet: "Sheet", deck: "Slides", note: "Note", page: "Workspace page" };
  const newFile = (kind) =>
    attempt(async () => {
      const made = kind === "sheet" ? await api("POST", "workspace/sheets", { title: `${p.title}: sheet` }) : await api("POST", "workspace/pages", { kind, title: kind === "deck" ? `${p.title}: slides` : "Untitled", project: p.id, ...(kind === "deck" ? { markdown: `# ${p.title}\n\nA line about what it covers\n` } : {}) });
      if (kind === "sheet") await api("PATCH", `workspace/pages/${made.id}`, { project: p.id });
      ui.ws ??= { collapsed: new Set<any>() };
      ui.ws.focusTitle = true;
      openPage(made.id);
    }, col);
  const files = () => [
    h("div", { class: "row wrap" }, h("span", { class: "grow note" }, "The documents, sheets, slides, notes and pages of this project. Agents working on the project's tasks are told about them. Add an existing file from its side panel, under Project."), ["doc", "sheet", "deck", "note"].map((k) => h("button", { class: "small", onclick: () => newFile(k) }, `+ ${FILE_KIND[k]}`))),
    (data.files ?? []).length ? h("section", { class: "card" }, data.files.map((f) => h("button", { class: "plain projectrow", onclick: () => openPage(f.id) }, h("span", { class: "grow" }, f.title), h("span", { class: "note small" }, `${FILE_KIND[f.kind] ?? "File"} · ${f.updatedBy} · ${officeDay(f.updatedAt)}`)))) : h("p", { class: "note" }, "No files in this project yet."),
  ];
  const chats = () => [
    h("div", { class: "row" }, h("span", { class: "grow note" }, "Chats in this project share the project's own memory, kept apart from other projects."), h("button", { class: "small primary", onclick: startChat }, "+ Chat in this project")),
    data.chats.length ? h("section", { class: "card" }, data.chats.map((c) => h("button", { class: "plain projectrow", onclick: () => openChat(c) }, h("span", { class: "grow" }, c.title || "New chat"), h("span", { class: "note small" }, when(c.updatedAt))))) : h("p", { class: "note" }, "No chats yet."),
  ];
  fill(
    col,
    h("button", { class: "plain back", onclick: () => go("projects") }, "← All projects"),
    h("div", { class: "row wrap projecthead" }, h("div", { class: "grow" }, h("h1", {}, p.title), h("div", { class: "note" }, [p.leadName ? `Led by ${p.leadName}` : "No lead", p.goalTitle ? `Serves: ${p.goalTitle}` : "No goal", p.due ? dueWords(p.due) : "No due day"].join(" · "), p.healthWhy ? ` · ${p.healthWhy}` : "")), healthTag(p), status, h("button", { class: "small", onclick: () => projectDialog({ project: p }) }, "Edit"), h("button", { class: "small plain danger", onclick: remove }, "Remove")),
    h("div", { class: "segmented projecttabs", role: "tablist", "aria-label": "Parts of this project" }, tabBtn("overview", "Overview"), tabBtn("tasks", `Tasks · ${data.tasks.length}`), tabBtn("files", `Files · ${(data.files ?? []).length}`), tabBtn("chats", `Chats · ${data.chats.length}`)),
    tab === "tasks" ? tasks() : tab === "files" ? files() : tab === "chats" ? chats() : overview(),
  );
}
