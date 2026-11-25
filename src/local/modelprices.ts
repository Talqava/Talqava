// The public list of models kept by the LiteLLM project (MIT licence): for about 2,000 chat models across 70 services,
// what each costs, how much it holds, and whether it can call tools. Talqava reads it once a day, keeps a small
// copy on this computer, and uses it for models that OpenRouter's list does not cover, so that services connected
// directly (OpenAI, Mistral, Groq, Together and others) show prices and tool support, and receipts are accurate.
// Nothing about the person is sent: it is one plain download of a public file.
import path from "node:path";
import type { Prices } from "../core/index.ts";
import { DATA, readJson, writeJson } from "./store.ts";

/** Where the list is. Tests point it at a stand-in. */
export const modelListUrl = () => process.env.TALQAVA_MODEL_PRICES || "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** What is known about one model: prices in dollars per million tokens, how much it holds, whether it calls tools. */
export interface KnownModel {
  prices?: Prices;
  contextTokens?: number;
  tools?: boolean;
}

/** Each of Talqava's services, under the name the list gives it. */
export const LIST_NAMES: Record<string, string> = {
  openai: "openai",
  azure: "azure",
  bedrock: "bedrock_mantle",
  gemini: "gemini",
  xai: "xai",
  mistral: "mistral",
  deepseek: "deepseek",
  groq: "groq",
  together: "together_ai",
  fireworks: "fireworks_ai",
  cerebras: "cerebras",
  nvidia: "nvidia_nim",
  moonshot: "moonshot",
  qwen: "dashscope",
  cohere: "cohere_chat",
};

/** The parts of a model's name that differ between the list and the service's own name for it. */
const plain = (name: string) => name.toLowerCase().replace(/^accounts\/fireworks\/models\//, "").replace(/^models\//, "");

interface Kept {
  fetchedAt: string;
  /** Service (by the list's name) → model name → [input, output, cache read, context, tools]; null where not known. */
  models: Record<string, Record<string, [number | null, number | null, number | null, number | null, boolean | null]>>;
}
const keptFile = () => path.join(DATA, "model-prices.json");
const DAY = 24 * 3600 * 1000;
let memo: Kept | null = null;

const perMillion = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 1_000_000 * 1e6) / 1e6 : null);

/** The list, cut down to chat models of the services Talqava connects to. */
export function toKept(data: unknown): Kept["models"] {
  const wanted = new Set(Object.values(LIST_NAMES));
  const models: Kept["models"] = {};
  for (const [key, row] of Object.entries((data ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!row || typeof row !== "object" || row.mode !== "chat") continue;
    const service = String(row.litellm_provider ?? "");
    if (!wanted.has(service)) continue;
    const name = plain(key.startsWith(`${service}/`) ? key.slice(service.length + 1) : key);
    const context = typeof row.max_input_tokens === "number" ? row.max_input_tokens : null;
    const tools = typeof row.supports_function_calling === "boolean" ? row.supports_function_calling : null;
    (models[service] ??= {})[name] = [perMillion(row.input_cost_per_token), perMillion(row.output_cost_per_token), perMillion(row.cache_read_input_token_cost), context, tools];
  }
  return models;
}

/** The list, from the copy on this computer (refreshed once a day) or from the web. Empty when neither is there. */
export async function loadModelList(refresh = false): Promise<void> {
  const kept = memo ?? readJson<Kept | null>(keptFile(), null);
  if (kept && !refresh && Date.now() - new Date(kept.fetchedAt).getTime() < DAY) {
    memo = kept;
    return;
  }
  // Tests never reach the internet: they give a stand-in address, or go without the list.
  if (process.env.NODE_TEST_CONTEXT && !process.env.TALQAVA_MODEL_PRICES) {
    memo = kept;
    return;
  }
  try {
    const r = await fetch(modelListUrl(), { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(String(r.status));
    const models = toKept(await r.json());
    if (Object.keys(models).length) {
      memo = { fetchedAt: new Date().toISOString(), models };
      writeJson(keptFile(), memo);
      return;
    }
  } catch {
    // Offline or moved: the copy kept from before is used, or nothing is known.
  }
  memo = kept;
}

/** What the list says about one model of one of Talqava's services, from the copy already loaded. */
export function knownModel(serviceId: string | undefined, model: string): KnownModel | undefined {
  const listName = serviceId ? LIST_NAMES[serviceId] : undefined;
  const list = listName ? (memo ?? (memo = readJson<Kept | null>(keptFile(), null)))?.models[listName] : undefined;
  if (!list) return undefined;
  const name = plain(model);
  const row = list[name] ?? list[name.replace(/-latest$/, "")] ?? list[name.split("/").pop()!];
  if (!row) return undefined;
  const [input, output, cacheRead, context, tools] = row;
  return {
    ...(input !== null && output !== null ? { prices: { input, output, ...(cacheRead !== null && cacheRead > 0 ? { cacheRead } : {}) } } : {}),
    ...(context ? { contextTokens: context } : {}),
    ...(tools !== null ? { tools } : {}),
  };
}

/** For tests: forgets the copy in memory. */
export function forgetModelList() {
  memo = null;
}
