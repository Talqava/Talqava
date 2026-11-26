// Langfuse (MIT, langfuse.com): an optional place to see what Talqava's agents cost and do, for owners who already
// use it. Each model call is sent as one "generation" on a trace for its task or chat: which model, how many tokens,
// what it cost, how long it took, and which agent. Only those numbers and names are sent, never what was said, and
// only when the owner connects Langfuse with their own keys.
//
// Langfuse takes OpenTelemetry (its older upload API was retired on Langfuse Cloud in November 2026), so each call is
// one span in OTLP/HTTP JSON, posted to {host}/api/public/otel/v1/traces with the keys as Basic sign-in.
import crypto from "node:crypto";
import { getConfig, saveConfig } from "./store.ts";
import { audit } from "./audit.ts";
import type { IntegrationInfo } from "./integrations.ts";
import type { StepInfo } from "../core/index.ts";

export const LANGFUSE_HOSTS = { eu: "https://cloud.langfuse.com", us: "https://us.cloud.langfuse.com", jp: "https://jp.cloud.langfuse.com" } as const;

export interface LangfuseConfig {
  host: string;
  publicKey: string;
  secretKey: string;
}

const endpoint = (host: string) => `${host.replace(/\/+$/, "")}/api/public/otel/v1/traces`;
const headers = (c: LangfuseConfig) => ({
  "content-type": "application/json",
  authorization: `Basic ${Buffer.from(`${c.publicKey}:${c.secretKey}`).toString("base64")}`,
  "x-langfuse-ingestion-version": "4",
});

type Attr = { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number } };
const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });

/** One model call as an OpenTelemetry span, in the shape Langfuse reads as a generation. */
export function spanOf(step: StepInfo, about: { trace: string; traceName: string; agent: string; session: string }, endedAt = Date.now()) {
  const end = BigInt(endedAt) * 1_000_000n;
  const start = end - BigInt(Math.max(0, Math.round(step.ms))) * 1_000_000n;
  const usage: Record<string, number> = {};
  if (step.input !== undefined) usage.input = step.input;
  if (step.output !== undefined) usage.output = step.output;
  if (step.cacheRead) usage.cache_read_input_tokens = step.cacheRead;
  return {
    traceId: crypto.createHash("sha256").update(about.trace).digest("hex").slice(0, 32),
    spanId: crypto.randomBytes(8).toString("hex"),
    name: step.model,
    kind: 3,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: end.toString(),
    attributes: [
      str("langfuse.trace.name", about.traceName),
      str("langfuse.session.id", about.session),
      str("langfuse.observation.type", "generation"),
      str("langfuse.observation.model.name", step.model),
      ...(Object.keys(usage).length ? [str("langfuse.observation.usage_details", JSON.stringify(usage))] : []),
      ...(step.cost !== undefined ? [str("langfuse.observation.cost_details", JSON.stringify({ total: step.cost }))] : []),
      str("langfuse.observation.metadata.agent", about.agent),
      ...(step.backup ? [str("langfuse.observation.metadata.backup", "true")] : []),
    ],
  };
}

const body = (spans: unknown[]) => ({ resourceSpans: [{ resource: { attributes: [str("service.name", "talqava")] }, scopeSpans: [{ scope: { name: "talqava" }, spans }] }] });

let queue: unknown[] = [];
let timer: NodeJS.Timeout | null = null;
let warned = false;

/** Sends what is waiting. Failures are noted once in the activity log; Talqava's own work never waits on Langfuse. */
export async function flushLangfuse(): Promise<void> {
  const c = getConfig().langfuse;
  if (timer) clearTimeout(timer), (timer = null);
  if (!c || !queue.length) return;
  const spans = queue.splice(0, 200);
  try {
    const r = await fetch(endpoint(c.host), { method: "POST", headers: headers(c), body: JSON.stringify(body(spans)), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Langfuse answered ${r.status}`);
    warned = false;
  } catch (err) {
    if (!warned) audit({ actor: "system", actorName: "Talqava", kind: "problem", ok: false, action: "Could not send costs to Langfuse", detail: (err as Error).message });
    warned = true;
  }
  if (queue.length) await flushLangfuse();
}

/** Queues one model call to send, when Langfuse is connected. Sent in batches, within ten seconds. */
export function recordStep(step: StepInfo, about: { trace: string; traceName: string; agent: string; session: string }) {
  if (!getConfig().langfuse) return;
  queue.push(spanOf(step, about));
  if (queue.length >= 50) void flushLangfuse();
  else timer ??= setTimeout(() => void flushLangfuse(), 10_000);
}

/** Checks the keys with Langfuse (an empty upload), then saves them. */
export async function connectLangfuse(input: { host?: unknown; publicKey?: unknown; secretKey?: unknown }): Promise<{ ok: true }> {
  const named = String(input.host ?? "eu");
  const host = (LANGFUSE_HOSTS as Record<string, string>)[named] ?? named.trim();
  if (!/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(host)) throw new Error("Choose the Langfuse region, or give the address of your own Langfuse.");
  const c: LangfuseConfig = { host: host.replace(/\/+$/, ""), publicKey: String(input.publicKey ?? "").trim(), secretKey: String(input.secretKey ?? "").trim() };
  if (!c.publicKey.startsWith("pk-lf-") || !c.secretKey.startsWith("sk-lf-")) throw new Error("Paste both Langfuse keys: the public key starts with pk-lf- and the secret key with sk-lf-. They are under Settings → API keys in your Langfuse project.");
  let r: Response;
  try {
    r = await fetch(endpoint(c.host), { method: "POST", headers: headers(c), body: JSON.stringify({ resourceSpans: [] }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`Could not reach Langfuse at ${c.host}. Check the address and your internet connection.`);
  }
  if (r.status === 401 || r.status === 403) throw new Error("Langfuse did not accept those keys. Check you copied both from the right project.");
  if (!r.ok) throw new Error(`Langfuse answered with an error (${r.status}). Check the address, or try again in a minute.`);
  saveConfig({ langfuse: c });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: "Connected Langfuse", detail: c.host });
  return { ok: true };
}

export function removeLangfuse(): { ok: true } {
  saveConfig({ langfuse: undefined });
  queue = [];
  audit({ actor: "owner", actorName: "You", kind: "integration", action: "Disconnected Langfuse" });
  return { ok: true };
}

export function langfuseIntegration(): IntegrationInfo & { host: string | null } {
  const c = getConfig().langfuse;
  return {
    id: "langfuse",
    name: "Langfuse",
    category: "Other services",
    summary: "Optional: see your agents' costs and steps in Langfuse, if you already use it. Each model call is sent with its model, tokens, cost, time and agent; never what was said.",
    state: c ? "connected" : "needs-setup",
    status: c ? `Sending to ${c.host.replace(/^https?:\/\//, "")}` : "Not connected",
    host: c?.host ?? null,
  };
}
