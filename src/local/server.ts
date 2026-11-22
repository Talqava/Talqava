// Web server of the local edition: serves the chat page and the small JSON API behind it.
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Engine, JobBook, BRAND, checkModel, describeError, setting } from "../core/index.ts";
import type { Decision, Job, RunEvent } from "../core/index.ts";
import {
  ROOT,
  DATA,
  WORKSPACE,
  EFFORTS,
  initStore,
  getConfig,
  saveConfig,
  publicConfig,
  conversations,
  memory,
  skills,
  jobStore,
} from "./store.ts";
import type { Config, ProviderConfig } from "./store.ts";
import { localRunSpec } from "./tools.ts";
import { resolveModel, splitRef } from "./models.ts";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const PASSWORD = setting("PASSWORD") || "";
const SESSION_COOKIE = `${BRAND.slug}_session`;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PUBLIC = path.join(ROOT, "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// The local edition wires the shared core to file storage and local tools.
export const jobs = new JobBook(jobStore);
export const engine = new Engine({
  conversations,
  resolveRun: localRunSpec(jobs),
});

async function runJob(job: Job) {
  const { conversation } = await engine.runJob(job);
  await jobs.update(job.id, { lastConversationId: conversation.id });
  return conversation;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- sign-in ----------
const sha = (text: string) => crypto.createHash("sha256").update(text).digest();
const sessionToken = () => crypto.createHmac("sha256", getConfig().sessionSecret).update(`session:${PASSWORD}`).digest("hex");

function signedIn(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const cookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie || "");
  return Boolean(cookie) && crypto.timingSafeEqual(sha(cookie![1]), sha(sessionToken()));
}

// Without a password the page only answers to this machine's own address, and
// only to requests that come from the page itself. This stops other websites
// open in the same browser from reaching the agent.
function checkOrigin(req: IncomingMessage) {
  const host = (req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!PASSWORD && !LOCAL_HOSTS.has(host)) throw new HttpError(403, "Open this page as http://localhost.");
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "Cross-site request refused.");
}

// ---------- helpers ----------
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": raw ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(raw ? (body as string | Buffer) : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  if (!/^application\/json/.test(req.headers["content-type"] || "")) throw new HttpError(415, "Send JSON.");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new HttpError(413, "Too large.");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

function serveStatic(res: ServerResponse, urlPath: string) {
  const file = path.join(PUBLIC, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new HttpError(404, "Not found.");
  }
  send(res, 200, fs.readFileSync(file), {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
}

function conversationOr404(id: string) {
  const conversation = /^[a-f0-9]{16}$/.test(id) ? conversations.get(id) : null;
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  return conversation;
}

function updateSettings(body: any) {
  const cfg = getConfig();
  const patch: Partial<Config> = {};
  if (typeof body.agentName === "string" && body.agentName.trim()) patch.agentName = body.agentName.trim().slice(0, 40);
  if (typeof body.model === "string") {
    const { providerId, model } = splitRef(body.model.trim());
    if (!cfg.providers.some((p) => p.id === providerId)) throw new HttpError(400, `No model provider called "${providerId}".`);
    if (!/^[\w.:@/+-]{1,120}$/.test(model)) throw new HttpError(400, "Type the model's name, e.g. llama3.1 or claude-opus-5-5.");
    patch.model = `${providerId}/${model}`;
  }
  if (EFFORTS.includes(body.effort)) patch.effort = body.effort;
  if (["ask", "auto"].includes(body.approvalMode)) patch.approvalMode = body.approvalMode;
  if (typeof body.apiKey === "string") patch.apiKey = body.apiKey.trim();

  if (body.secret) {
    const { name, value, host, remove } = body.secret;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(name || "")) throw new HttpError(400, "Secret names use letters, digits and underscores.");
    const secrets = { ...cfg.secrets };
    if (remove) delete secrets[name];
    else {
      if (!value || !/^[a-z0-9.-]+$/i.test(host || "")) {
        throw new HttpError(400, "A secret needs a value and the host it may be sent to, e.g. api.example.com.");
      }
      secrets[name] = { value: String(value), host: host.toLowerCase() };
    }
    patch.secrets = secrets;
  }

  if (body.budget) {
    const steps = Number(body.budget.steps);
    const spend = body.budget.spend === null || body.budget.spend === "" ? undefined : Number(body.budget.spend);
    if (!Number.isInteger(steps) || steps < 1 || steps > 500) throw new HttpError(400, "The step budget is a whole number from 1 to 500.");
    if (spend !== undefined && (!Number.isFinite(spend) || spend < 0 || spend > 100)) throw new HttpError(400, "The spend budget is from $0 to $100.");
    patch.budget = { steps, ...(spend !== undefined ? { spend } : {}) };
  }

  if (body.provider) {
    const { id, name, baseUrl, apiKey, prices, remove } = body.provider;
    if (!/^[a-z0-9-]{1,30}$/.test(id || "")) throw new HttpError(400, "Provider ids use lowercase letters, digits and dashes.");
    const existing = cfg.providers.find((p) => p.id === id);
    if (existing?.kind === "anthropic") throw new HttpError(400, "The Anthropic provider cannot be changed here; set its key above.");
    let providers = cfg.providers.filter((p) => p.id !== id);
    if (remove) {
      if (splitRef(cfg.model).providerId === id) throw new HttpError(400, "Choose another model before removing the provider it uses.");
    } else {
      let url: URL;
      try {
        url = new URL(String(baseUrl || ""));
      } catch {
        throw new HttpError(400, "A provider needs an address, e.g. http://localhost:11434/v1.");
      }
      if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "A provider's address starts with http:// or https://.");
      const provider: ProviderConfig = {
        id,
        kind: "openai",
        name: String(name || id).trim().slice(0, 60),
        baseUrl: url.href.replace(/\/+$/, ""),
        // A blank key keeps the one already saved.
        apiKey: typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : existing?.apiKey,
      };
      if (prices && prices.input !== "" && prices.output !== "") {
        const input = Number(prices.input);
        const output = Number(prices.output);
        if (![input, output].every((n) => Number.isFinite(n) && n >= 0 && n < 1000)) throw new HttpError(400, "Prices are dollars per million tokens.");
        provider.prices = { input, output };
      }
      providers = [...providers, provider];
    }
    patch.providers = providers;
  }

  if (body.mcpServer) {
    const { name, url, token, remove } = body.mcpServer;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name || "")) throw new HttpError(400, "Connector names use letters, digits, dashes and underscores.");
    const servers = cfg.mcpServers.filter((s) => s.name !== name);
    if (!remove) {
      if (!/^https:\/\//.test(url || "")) throw new HttpError(400, "A connector needs an https:// address.");
      servers.push({ name, url, token: token ? String(token) : "" });
    }
    patch.mcpServers = servers;
  }
  saveConfig(patch);
  return publicConfig();
}

// ---------- routes ----------
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const route = `${req.method} ${parts[0] || ""}`;
  const body = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBody(req) : {};

  if (route === "POST login") {
    const ok = PASSWORD && crypto.timingSafeEqual(sha(String(body.password || "")), sha(PASSWORD));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1000)); // slows password guessing
      throw new HttpError(401, "Wrong password.");
    }
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return send(res, 200, { ok: true }, { "set-cookie": `${SESSION_COOKIE}=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
  }
  if (!signedIn(req)) throw new HttpError(401, "Sign in first.");

  if (route === "GET state") return send(res, 200, publicConfig());
  if (route === "PUT settings") return send(res, 200, updateSettings(body));
  if (route === "POST model-check") {
    const cfg = getConfig();
    let model;
    try {
      model = resolveModel(cfg, typeof body.model === "string" && body.model ? body.model : cfg.model);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const result = await checkModel(model, AbortSignal.timeout(180_000)).catch((err) => {
      throw new HttpError(502, describeError(err));
    });
    saveConfig({ modelChecks: { ...getConfig().modelChecks, [model.ref]: result } });
    return send(res, 200, result);
  }

  if (parts[0] === "conversations") {
    const [, id, action, actionId] = parts;
    if (!id) {
      if (req.method === "GET") {
        return send(res, 200, conversations.list().map((c) => ({ ...c, running: engine.isRunning(c.id), needsApproval: engine.awaitingApproval(c.id) })));
      }
      if (req.method === "POST") return send(res, 200, conversations.create());
    }
    const conversation = conversationOr404(id);
    if (!action && req.method === "GET") return send(res, 200, { ...conversation, live: engine.liveState(id) });
    if (!action && req.method === "DELETE") {
      engine.stop(id);
      conversations.remove(id);
      return send(res, 200, { ok: true });
    }
    if (action === "messages" && req.method === "POST") {
      const text = String(body.text || "").trim();
      if (!text) throw new HttpError(400, "Type a message first.");
      if (engine.isRunning(id)) throw new HttpError(409, "The agent is still working. Stop it first.");
      await engine.startRun(id, text);
      return send(res, 200, { ok: true });
    }
    if (action === "stop" && req.method === "POST") {
      engine.stop(id);
      return send(res, 200, { ok: true });
    }
    if (action === "approvals" && req.method === "POST") {
      if (!["allow", "always", "deny"].includes(body.decision)) throw new HttpError(400, "Bad decision.");
      if (!engine.resolveApproval(id, actionId, body.decision as Decision)) throw new HttpError(404, "That request is no longer waiting.");
      return send(res, 200, { ok: true });
    }
    if (action === "events" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      const write = (event: RunEvent | { type: "sync"; conversation: unknown; live: unknown }) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      // The snapshot and the subscription happen in the same tick, so nothing is missed between them.
      write({ type: "sync", conversation, live: engine.liveState(id) });
      const unsubscribe = engine.subscribe(id, write);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }
  }

  // Mistakes in what was typed (a bad schedule, a full memory) come back as plain messages.
  const attempt = async <T>(fn: () => T | Promise<T>) => {
    try {
      return (await fn()) ?? { ok: true };
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError(400, (err as Error).message);
    }
  };

  if (route === "GET memory") return send(res, 200, memory.list());
  if (route === "POST memory") return send(res, 200, await attempt(() => memory.add(body.text)));
  if (route === "DELETE memory") return send(res, 200, await attempt(() => memory.remove(parts[1])));

  if (route === "GET skills") return send(res, 200, skills.list());
  if (route === "DELETE skills") return send(res, 200, await attempt(() => skills.remove(decodeURIComponent(parts[1]))));

  if (route === "GET jobs") return send(res, 200, await jobs.list());
  if (route === "POST jobs" && !parts[1]) return send(res, 200, await attempt(() => jobs.create(body)));
  if (route === "POST jobs" && parts[2] === "run") {
    const job = (await jobs.list()).find((j) => j.id === parts[1]);
    if (!job) throw new HttpError(404, "Job not found.");
    const conversation = await runJob(job);
    await jobs.update(job.id, { lastRunAt: new Date().toISOString() });
    return send(res, 200, { conversationId: conversation.id });
  }
  if (route === "PATCH jobs") return send(res, 200, await attempt(() => jobs.update(parts[1], { enabled: Boolean(body.enabled) })));
  if (route === "DELETE jobs") return send(res, 200, await attempt(() => jobs.remove(parts[1])));

  throw new HttpError(404, "Not found.");
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    checkOrigin(req);
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    return serveStatic(res, url.pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Something went wrong on the server." : (err as Error).message });
    else res.end();
  }
}

export function start() {
  if (!LOCAL_HOSTS.has(HOST) && !PASSWORD) {
    console.error(
      `Refusing to start: HOST is ${HOST}, which other machines can reach, but ${BRAND.envPrefix}PASSWORD is not set.\n` +
        `This agent can run commands, so it must not be open to a network without a password. Set ${BRAND.envPrefix}PASSWORD in .env.`,
    );
    process.exit(1);
  }
  initStore();
  getConfig();
  const server = http.createServer(handle);
  server.listen(PORT, HOST, () => {
    console.log(`${BRAND.name} is running at http://${LOCAL_HOSTS.has(HOST) ? "localhost" : HOST}:${PORT}`);
    console.log(`Data: ${DATA}\nWorkspace: ${WORKSPACE}`);
  });
  jobs.start(runJob);
  return server;
}
