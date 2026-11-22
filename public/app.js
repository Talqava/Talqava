// The chat page. No framework: small helpers that build DOM nodes.
import { renderMarkdown } from "/markdown.js";

const app = document.getElementById("app");
const state = { config: null, convs: [], view: "chat", convId: null, conv: null, running: false, source: null };
const ui = {}; // live nodes of the open conversation

// ---------- helpers ----------
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
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

// Runs an action and shows any failure next to where it happened.
async function attempt(fn, where) {
  try {
    return await fn();
  } catch (err) {
    const box = h("div", { class: "banner error" }, err.message);
    (where || ui.log || app).append(box);
    setTimeout(() => box.remove(), 8000);
  }
}

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never");

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
    h("div", { class: "brand" }, "Sign in"),
    password,
    h("button", { class: "primary" }, "Sign in"),
  );
  app.replaceChildren(form);
  password.focus();
}

// ---------- layout ----------
async function boot() {
  try {
    state.config = await api("GET", "state");
  } catch {
    return;
  }
  document.title = state.config.agentName;
  if (needsKey(state.config)) state.view = "settings";
  await refreshList();
  render();
  clearInterval(boot.timer);
  boot.timer = setInterval(refreshList, 5000);
}

// A Claude model with no key cannot run; a local model needs none.
const needsKey = (c) => c.model.startsWith("anthropic/") && !c.hasApiKey;

async function refreshList() {
  try {
    state.convs = await api("GET", "conversations");
    renderSide();
  } catch {}
}

function render() {
  ui.side = h("aside", { class: "side" });
  ui.main = h("main", { class: "main" });
  app.replaceChildren(ui.side, ui.main);
  renderSide();
  renderMain();
}

function go(view, convId = null) {
  state.view = view;
  state.convId = convId;
  app.classList.remove("open");
  renderSide();
  renderMain();
}

function renderSide() {
  if (!ui.side) return;
  const tabs = [
    ["chat", "Chats"],
    ["memory", "Memory"],
    ["skills", "Skills"],
    ["jobs", "Schedules"],
    ["settings", "Settings"],
  ];
  ui.side.replaceChildren(
    h("div", { class: "brand" }, state.config.agentName),
    h("button", { class: "new primary", onclick: () => go("chat") }, "New chat"),
    h(
      "nav",
      { class: "nav" },
      tabs.map(([view, label]) => h("button", { class: state.view === view ? "on" : "", onclick: () => go(view) }, label)),
    ),
    h(
      "div",
      { class: "convs" },
      state.convs.map((c) =>
        h(
          "button",
          { class: `conv ${c.id === state.convId ? "on" : ""}`, title: c.title, onclick: () => go("chat", c.id) },
          h("span", { class: "title" }, c.title),
          c.needsApproval ? h("span", { class: "dot wait", title: "Waiting for your approval" }) : c.running ? h("span", { class: "dot", title: "Working" }) : null,
        ),
      ),
    ),
  );
}

function header(title, ...extra) {
  return h(
    "div",
    { class: "head" },
    h("button", { class: "menu", onclick: () => app.classList.toggle("open"), "aria-label": "Menu" }, "☰"),
    h("h1", {}, title),
    ...extra,
  );
}

function renderMain() {
  state.source?.close();
  state.source = null;
  const views = { chat: chatView, memory: memoryView, skills: skillsView, jobs: jobsView, settings: settingsView };
  views[state.view]();
}

function page(title, intro, ...children) {
  ui.log = null;
  const col = h("div", { class: "col page" }, h("h2", {}, title), h("p", { class: "note" }, intro), ...children);
  ui.main.replaceChildren(header(title), h("div", { class: "scroll" }, col));
  return col;
}

// ---------- chat ----------
function chatView() {
  ui.title = h("h1", {}, "New chat");
  ui.meta = h("span", { class: "meta" });
  ui.log = h("div", { class: "col" });
  ui.scroll = h("div", { class: "scroll" }, ui.log);
  ui.input = h("textarea", { rows: 1, placeholder: `Message ${state.config.agentName}…` });
  ui.send = h("button", { class: "primary" }, "Send");
  ui.cards = new Map();
  ui.stream = null;
  ui.working = null;
  ui.remove = h("button", { class: "plain danger", title: "Delete this chat", onclick: deleteChat, hidden: !state.convId }, "Delete");

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

  ui.main.replaceChildren(
    h("div", { class: "head" }, h("button", { class: "menu", onclick: () => app.classList.toggle("open"), "aria-label": "Menu" }, "☰"), ui.title, ui.meta, ui.remove),
    ui.scroll,
    h("div", { class: "compose" }, h("div", { class: "col" }, ui.input, ui.send)),
  );
  setRunning(false);
  if (state.convId) connect(state.convId);
  else {
    ui.log.append(
      h("div", { class: "empty" }, h("h2", {}, `Hello. I'm ${state.config.agentName}.`), h("p", {}, "Ask me to look something up, write or run code, work with files, call an API, or do something on a schedule.")),
    );
  }
  ui.input.focus();
}

async function submit() {
  const text = ui.input.value.trim();
  if (!text || state.running) return;
  await attempt(async () => {
    if (!state.convId) {
      const conv = await api("POST", "conversations");
      state.convId = conv.id;
      ui.remove.hidden = false;
      ui.log.replaceChildren();
      connect(conv.id);
      await new Promise((resolve) => state.source.addEventListener("open", resolve, { once: true }));
    }
    await api("POST", `conversations/${state.convId}/messages`, { text });
    ui.input.value = "";
    ui.input.style.height = "auto";
    refreshList();
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
    if (state.convId === id) onEvent(JSON.parse(e.data));
  };
}

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
  ui.log.replaceChildren();
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
        s.md.replaceChildren(renderMarkdown(s.text));
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
      h("strong", {}, `${state.config.agentName} wants to use: ${NAMES[approval.name] || approval.name}`),
      h("pre", {}, detail),
      h(
        "div",
        { class: "row" },
        h("button", { class: "primary", onclick: () => decide("allow") }, "Allow once"),
        h("button", { onclick: () => decide("always") }, `Always allow ${NAMES[approval.name] || approval.name} in this chat`),
        h("button", { class: "danger", onclick: () => decide("deny") }, "Don't allow"),
      ),
    ),
  );
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
  list.replaceChildren(
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
    if (!result) return checkBox.replaceChildren(h("p", { class: "note" }, "Not checked yet. The check takes under a minute and costs a few cents at most on a paid model."));
    const mark = (ok, label) => h("span", { class: ok ? "state ok" : "state bad" }, `${ok ? "✓" : "✗"} ${label}  `);
    checkBox.replaceChildren(
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
