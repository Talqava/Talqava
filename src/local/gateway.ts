// The gateway to AI models: one list of the AI services Talqava can use, and
// one way to connect any of them. Pick a service, paste its key, and Talqava
// checks the key, finds the service's models and fills in everything else.
//
// Nearly every service speaks one of two formats: Anthropic's (Claude) or the
// common "chat completions" format that OpenAI started and most others copy.
// Talqava speaks both, so a service is just an entry in this list: where it
// is, where to get a key, and its small differences. Prices, sizes and which
// models can use tools come from OpenRouter's public list of models, which is
// kept up to date by OpenRouter and needs no account.
import { getConfig, saveConfig } from "./store.ts";
import type { ProviderConfig } from "./store.ts";
import { OPENROUTER_ID, openrouterModels } from "./openrouter.ts";
import type { OpenRouterModel } from "./openrouter.ts";
import { audit } from "./audit.ts";
import { MODELS } from "./store.ts";
import type { Prices } from "../core/index.ts";
import os from "node:os";
import { knownModel, loadModelList, modelsOf } from "./modelprices.ts";
import { accessToken, parseServiceAccount } from "./googleauth.ts";

export type ServiceGroup = "popular" | "open" | "makers" | "gateways" | "local";

export interface Service {
  id: string;
  name: string;
  /** One line on what it is and why someone would choose it. */
  about: string;
  group: ServiceGroup;
  kind: "anthropic" | "openai";
  /** The address; "{resource}" in it is filled from what the person types. Empty when the person gives the whole address. */
  baseUrl: string;
  /** What to ask for when the address depends on the person's account. */
  addressHint?: string;
  /** What "{resource}" in the address is: an Azure resource name (the default) or an AWS region. */
  resource?: "azure" | "aws-region";
  /** The key is a Google Cloud service account file, traded for a token that lasts an hour (Vertex AI). */
  serviceAccount?: boolean;
  /** Where to get a key. */
  keyUrl?: string;
  /** What a key looks like, to catch a key pasted into the wrong service. */
  keyPrefix?: string;
  needsKey: boolean;
  keyHeader?: "bearer" | "api-key" | "x-portkey-api-key";
  tokenLimit?: "max_tokens" | "max_completion_tokens";
  /** This service's models on OpenRouter's list start with this, e.g. "openai/". Their prices are the same. */
  priceFrom?: string;
  /** Hosts of open models: sizes and tool use are looked up by the model's name, but their prices are their own. */
  hostsOpenModels?: boolean;
  /** Its own sign-in screen in Talqava. */
  ownSetup?: "openrouter";
}

export const SERVICES: Service[] = [
  // The model makers most people know.
  { id: "anthropic", name: "Anthropic (Claude)", about: "Claude: Talqava's standard models, the best at agent work. Web search and connectors run on Claude.", group: "popular", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys", keyPrefix: "sk-ant-", needsKey: true },
  { id: "openai", name: "OpenAI (GPT)", about: "The GPT models from the makers of ChatGPT.", group: "popular", kind: "openai", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", keyPrefix: "sk-", needsKey: true, tokenLimit: "max_completion_tokens", priceFrom: "openai/" },
  { id: "gemini", name: "Google (Gemini)", about: "Google's Gemini models. A key from Google AI Studio has a free allowance.", group: "popular", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", needsKey: true, priceFrom: "google/" },
  { id: "xai", name: "xAI (Grok)", about: "The Grok models from xAI.", group: "popular", kind: "openai", baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", keyPrefix: "xai-", needsKey: true, priceFrom: "x-ai/" },
  { id: "mistral", name: "Mistral", about: "Mistral's models, from France.", group: "popular", kind: "openai", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", needsKey: true, priceFrom: "mistralai/" },
  { id: "deepseek", name: "DeepSeek", about: "Strong models at a very low price.", group: "popular", kind: "openai", baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", keyPrefix: "sk-", needsKey: true, priceFrom: "deepseek/" },
  // Fast, low-cost hosts of open models (Llama, Qwen, DeepSeek, gpt-oss and others).
  { id: "groq", name: "Groq", about: "Open models answered very fast, at a low price.", group: "open", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", keyPrefix: "gsk_", needsKey: true, hostsOpenModels: true },
  { id: "together", name: "Together AI", about: "Hundreds of open models in one place.", group: "open", kind: "openai", baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", needsKey: true, hostsOpenModels: true },
  { id: "fireworks", name: "Fireworks AI", about: "Fast open models for business use.", group: "open", kind: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", keyUrl: "https://fireworks.ai/account/api-keys", keyPrefix: "fw_", needsKey: true, hostsOpenModels: true },
  { id: "cerebras", name: "Cerebras", about: "Very fast answers from open models.", group: "open", kind: "openai", baseUrl: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai", keyPrefix: "csk-", needsKey: true, hostsOpenModels: true },
  { id: "nvidia", name: "NVIDIA", about: "Open models hosted by NVIDIA.", group: "open", kind: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com", keyPrefix: "nvapi-", needsKey: true, hostsOpenModels: true },
  { id: "huggingface", name: "Hugging Face", about: "Open models from many hosts through one Hugging Face account.", group: "open", kind: "openai", baseUrl: "https://router.huggingface.co/v1", keyUrl: "https://huggingface.co/settings/tokens", keyPrefix: "hf_", needsKey: true, hostsOpenModels: true },
  // More model makers.
  { id: "moonshot", name: "Moonshot (Kimi)", about: "Moonshot AI's Kimi models.", group: "makers", kind: "openai", baseUrl: "https://api.moonshot.ai/v1", keyUrl: "https://platform.moonshot.ai/console/api-keys", keyPrefix: "sk-", needsKey: true, priceFrom: "moonshotai/" },
  { id: "qwen", name: "Alibaba (Qwen)", about: "Alibaba's Qwen models, through Alibaba Cloud Model Studio (international).", group: "makers", kind: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyUrl: "https://modelstudio.console.alibabacloud.com", keyPrefix: "sk-", needsKey: true, priceFrom: "qwen/" },
  { id: "cohere", name: "Cohere", about: "Cohere's Command models, made for business.", group: "makers", kind: "openai", baseUrl: "https://api.cohere.ai/compatibility/v1", keyUrl: "https://dashboard.cohere.com/api-keys", needsKey: true, priceFrom: "cohere/" },
  // One account for many models, or a company's own gateway or cloud.
  { id: OPENROUTER_ID, name: "OpenRouter", about: "One account for hundreds of models from every major maker, paid from one balance. Sign in with your browser: no key to copy.", group: "gateways", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", keyPrefix: "sk-or-", needsKey: true, ownSetup: "openrouter" },
  { id: "azure", name: "Microsoft Azure OpenAI", about: "OpenAI's models on your company's Azure account. Give your resource's name and key.", group: "gateways", kind: "openai", baseUrl: "https://{resource}.openai.azure.com/openai/v1", addressHint: "Your Azure resource name (the first part of its address), or its full address", keyUrl: "https://portal.azure.com", needsKey: true, keyHeader: "api-key", tokenLimit: "max_completion_tokens", priceFrom: "openai/" },
  { id: "bedrock", name: "Amazon Bedrock", about: "Claude, GPT-OSS, Llama, Mistral, Qwen, DeepSeek and more on your company's AWS account. Give a Bedrock API key and your region.", group: "gateways", kind: "openai", baseUrl: "https://bedrock-mantle.{resource}.api.aws/v1", resource: "aws-region", addressHint: "Your AWS region, e.g. us-east-1", keyUrl: "https://console.aws.amazon.com/bedrock/home#/api-keys", needsKey: true },
  { id: "vertex", name: "Google Vertex AI", about: "Google's Gemini models on your company's Google Cloud account. Give the service account's key file, and the region if it isn't global.", group: "gateways", kind: "openai", baseUrl: "https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/endpoints/openapi", addressHint: "Region, if not global (e.g. us-central1)", keyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts", needsKey: true, serviceAccount: true },
  { id: "portkey", name: "Portkey", about: "Your Portkey gateway: the models in your Portkey Model Catalog, with Portkey's own routing, caching and limits. Paste your Portkey API key.", group: "gateways", kind: "openai", baseUrl: "https://api.portkey.ai/v1", keyUrl: "https://app.portkey.ai/api-keys", needsKey: true, keyHeader: "x-portkey-api-key" },
  { id: "litellm", name: "LiteLLM gateway", about: "Your company's own LiteLLM gateway, which can reach Amazon Bedrock, Google Vertex and others.", group: "gateways", kind: "openai", baseUrl: "", addressHint: "The gateway's address, e.g. http://localhost:4000", needsKey: true },
  { id: "custom", name: "Another service", about: "Any other service or gateway that offers the common chat completions format (Portkey, vLLM on a server, and many more).", group: "gateways", kind: "openai", baseUrl: "", addressHint: "Its address, usually ending in /v1", needsKey: false },
  // On this computer: free, private, nothing leaves the computer.
  { id: "ollama", name: "Ollama", about: "Free models that run on this computer. Nothing leaves it.", group: "local", kind: "openai", baseUrl: "http://localhost:11434/v1", keyUrl: "https://ollama.com/download", needsKey: false },
  { id: "lmstudio", name: "LM Studio", about: "Free models on this computer, with an easy app to download them.", group: "local", kind: "openai", baseUrl: "http://localhost:1234/v1", keyUrl: "https://lmstudio.ai", needsKey: false },
  { id: "llamacpp", name: "llama.cpp", about: "The llama.cpp server on this computer.", group: "local", kind: "openai", baseUrl: "http://localhost:8080/v1", needsKey: false },
  { id: "jan", name: "Jan", about: "Free models on this computer, in the Jan app.", group: "local", kind: "openai", baseUrl: "http://localhost:1337/v1", keyUrl: "https://jan.ai", needsKey: false },
  { id: "vllm", name: "vLLM", about: "A vLLM server on this computer.", group: "local", kind: "openai", baseUrl: "http://localhost:8000/v1", needsKey: false },
];

export const GROUP_NAMES: Record<ServiceGroup, string> = {
  popular: "The best-known model makers",
  open: "Fast, low-cost hosts of open models",
  makers: "More model makers",
  gateways: "One account for many models, or your company's own",
  local: "On this computer: free and private",
};

/** Before a service is connected, the local model runner from the standard settings counts as Ollama. */
const LEGACY_LOCAL = "local";

export const serviceOf = (id: string) => SERVICES.find((s) => s.id === id);

/** The service a saved provider came from. */
function serviceOfProvider(p: ProviderConfig): Service | undefined {
  if (p.kind === "anthropic") return serviceOf("anthropic");
  if (p.id === OPENROUTER_ID) return serviceOf(OPENROUTER_ID);
  return p.service ? serviceOf(p.service) : undefined;
}

// ---------- addresses and keys ----------

/** Vertex AI's address, from the project in the key file and the region (global when none is typed). */
export function vertexAddress(project: string, typed?: unknown): string {
  const region = String(typed ?? "").trim().toLowerCase() || "global";
  if (region !== "global" && !/^[a-z]+-[a-z]+\d+$/.test(region)) throw new Error("That does not look like a Google Cloud region. It looks like us-central1 or europe-west4; leave it empty for global.");
  const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${region}/endpoints/openapi`;
}

/** The address to use, from the service and what the person typed. */
export function addressFor(service: Service, typed?: unknown): string {
  const text = String(typed ?? "").trim();
  let address = service.baseUrl;
  if (service.baseUrl.includes("{resource}")) {
    if (!text) throw new Error(`${service.name} needs ${service.addressHint?.toLowerCase() ?? "an address"}.`);
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      address = service.resource === "aws-region" ? `${url.origin}/v1` : `${url.origin}/openai/v1`;
    } else if (service.resource === "aws-region") {
      if (!/^[a-z]{2}(-gov)?-[a-z]+-\d$/i.test(text)) throw new Error("That does not look like an AWS region. It looks like us-east-1 or eu-west-2: you can see it at the top right of the AWS console.");
      address = service.baseUrl.replace("{resource}", text.toLowerCase());
    } else {
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(text)) throw new Error("That does not look like an Azure resource name. It is the first part of the resource's address, e.g. my-company in my-company.openai.azure.com.");
      address = service.baseUrl.replace("{resource}", text.toLowerCase());
    }
  } else if (!service.baseUrl || (text && service.group === "local")) {
    if (!text) throw new Error(`${service.name} needs ${service.addressHint?.toLowerCase() ?? "an address"}.`);
    address = text;
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("That address is not complete. It starts with http:// or https://.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("An address starts with http:// or https://.");
  let clean = url.href.replace(/\/+$/, "");
  // A LiteLLM gateway answers both with and without /v1; the common form is used.
  if (service.id === "litellm" && !/\/v1$/.test(clean)) clean += "/v1";
  return clean;
}

function headersFor(service: Service | undefined, key: string | undefined): Record<string, string> {
  if (!key) return {};
  if (service?.kind === "anthropic") return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  return service?.keyHeader === "api-key" ? { "api-key": key } : service?.keyHeader === "x-portkey-api-key" ? { "x-portkey-api-key": key } : { authorization: `Bearer ${key}` };
}

// ---------- models ----------

/** Models that are not for chat (pictures, speech, embeddings, moderation) are left out of the lists. */
const NOT_CHAT = /(embed|embedding|whisper|tts|speech|transcri|dall-e|image|imagen|veo|sora|audio|realtime|moderation|rerank|guard|davinci|babbage|-search|ocr|vision-preview$|text-similarity|clip)/i;

export interface ListedModel {
  id: string;
  /** Can call tools, which agents need: true, false, or null when not known. */
  tools: boolean | null;
  contextTokens?: number;
  prices?: Prices;
  /** For a model on this computer: its size, and whether it fits in this computer's memory. */
  memory?: { bytes: number; fit: Fit };
}

/** Whether a local model fits in this computer's memory: comfortably, only just, or not at all. */
export type Fit = "ok" | "tight" | "too-big";

/**
 * Local model families that can call tools, for runners that do not say (LM Studio, llama.cpp, Jan, vLLM). Ollama
 * says for each model, and its answer is used instead.
 */
const LOCAL_TOOL_FAMILIES =
  /^(qwen2\.5|qwen3|qwq|llama3\.[1-3]|llama4|mistral(-nemo|-small|-large|-medium)?|mixtral|ministral|devstral|magistral|command-r|firefunction|hermes3|granite3|granite4|gpt-oss|phi4-mini|smollm2|athene|nemotron|cogito|deepseek-v3|kimi-k2|glm-4)/;

/** A local model's name as a family name: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF" → "llama3.1-8b-…". */
function familyName(id: string): string {
  return id
    .toLowerCase()
    .split("/")
    .pop()!
    .replace(/^meta-/, "")
    .replace(/^llama-?(\d)[.-](\d)/, "llama$1.$2")
    .replace(/^qwen-?(\d(?:\.\d)?)/, "qwen$1");
}

/** Whether a local model can call tools, from its name: true for a known family, otherwise not known. */
export function localTools(id: string): boolean | null {
  return LOCAL_TOOL_FAMILIES.test(familyName(id)) ? true : null;
}

/**
 * Whether a model of this many bytes fits in memory. A model needs about its file size plus a fifth (for the
 * conversation it holds) plus room for the system and other apps.
 */
export function fitFor(bytes: number, total = os.totalmem()): Fit {
  const need = bytes * 1.2;
  if (need > total * 0.7) return "too-big";
  if (need > total * 0.5) return "tight";
  return "ok";
}

/** What Ollama says about its models: each one's size, and whether it can call tools. */
async function ollamaDetails(baseUrl: string): Promise<Map<string, { bytes?: number; tools?: boolean }>> {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const details = new Map<string, { bytes?: number; tools?: boolean }>();
  try {
    const r = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = (await r.json()) as { models?: { name: string; size?: number }[] };
    await Promise.all(
      (data.models ?? []).slice(0, 60).map(async (m) => {
        const entry: { bytes?: number; tools?: boolean } = { bytes: typeof m.size === "number" ? m.size : undefined };
        try {
          const shown = await fetch(`${root}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(3000) });
          const caps = ((await shown.json()) as { capabilities?: string[] }).capabilities;
          if (Array.isArray(caps)) entry.tools = caps.includes("tools");
        } catch {
          // An older Ollama: its answer is left out, and the name decides.
        }
        details.set(m.name, entry);
      }),
    );
  } catch {
    // Not Ollama after all, or not answering: the names decide.
  }
  return details;
}

/** OpenRouter's public list, as a lookup. Kept for a day; an empty list when it cannot be reached. */
async function catalog(): Promise<OpenRouterModel[]> {
  return openrouterModels().catch(() => []);
}

/** What is known about one model of a service: tool use, size and prices. */
export function infoFor(service: Service | undefined, model: string, list: OpenRouterModel[]): Omit<ListedModel, "id"> {
  const name = model.replace(/^models\//, "").toLowerCase();
  if (service?.priceFrom) {
    const exact = list.find((m) => m.id.toLowerCase() === `${service.priceFrom}${name}`) ?? list.find((m) => m.id.toLowerCase() === `${service.priceFrom}${name.replace(/-latest$/, "")}`);
    if (exact) return { tools: true, contextTokens: exact.contextTokens, prices: exact.prices };
  }
  // LiteLLM's public list knows the service's own prices (a host's too), how much a model holds, and whether it calls tools.
  const known = service?.group === "local" ? undefined : knownModel(service?.id, model);
  if (known && (known.prices || known.tools !== undefined)) return { tools: known.tools ?? null, ...(known.contextTokens ? { contextTokens: known.contextTokens } : {}), ...(known.prices ? { prices: known.prices } : {}) };
  if (service?.group !== "local") {
    // A host's or gateway's own name for an open model, e.g. meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8: its size and tool use, not its price.
    let tail = name.split("/").pop()!.replace(/:.*$/, "");
    for (let before = ""; before !== tail; ) (before = tail), (tail = tail.replace(/[-_](instruct|turbo|chat|it|fp8|fp16|bf16|awq|int4|int8|gguf|latest)$/, ""));
    const near = list.find((m) => m.id.split("/").pop()!.toLowerCase() === tail);
    if (near) return { tools: true, contextTokens: near.contextTokens };
  }
  return { tools: null };
}

/** A service's models, as it lists them, with what is known about each. Chat models that can use tools come first. */
export async function listModels(provider: ProviderConfig): Promise<{ models: ListedModel[]; reachable: boolean; note?: string }> {
  if (provider.kind === "anthropic") return { models: MODELS.map((m) => ({ id: m.id, tools: true })), reachable: true };
  if (provider.id === OPENROUTER_ID) return { models: (await catalog()).map((m) => ({ id: m.id, tools: true, contextTokens: m.contextTokens, prices: m.prices })), reachable: true };
  const service = serviceOfProvider(provider);
  if (service?.serviceAccount) {
    await loadModelList();
    const models = modelsOf(service.id)
      .filter((m) => m.tools !== false && /^gemini/.test(m.name))
      .map((m) => ({ id: `google/${m.name}`, tools: m.tools, ...(m.contextTokens ? { contextTokens: m.contextTokens } : {}), ...(m.prices ? { prices: m.prices } : {}) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models, reachable: true, ...(models.length ? {} : { note: "Type the model's name, for example google/gemini-2.5-flash." }) };
  }
  try {
    const r = await fetch(`${String(provider.baseUrl).replace(/\/+$/, "")}/models`, {
      headers: headersFor(service ?? ({ keyHeader: provider.keyHeader } as Service), provider.apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401 || r.status === 403) return { models: [], reachable: true, note: `${provider.name} did not accept the key. Connect it again with a new key.` };
    if (!r.ok) return { models: [], reachable: true, note: `${provider.name} did not list its models (it answered ${r.status}). Type the model's name instead.` };
    const data = (await r.json()) as { data?: { id: string; supports_tools?: boolean }[]; models?: { name?: string; id?: string }[] };
    const rows: { id: string; supports_tools?: boolean }[] = (data.data ?? data.models?.map((m) => ({ id: String(m.id ?? m.name ?? "") })) ?? []).filter((m) => m.id && !NOT_CHAT.test(m.id));
    const [list] = await Promise.all([catalog(), loadModelList()]);
    const local = service?.group === "local" || (provider.id === LEGACY_LOCAL && !provider.service);
    // Ollama says what each of its models is; other runners are judged by the model's name.
    const ollama = local && (service?.id ?? "ollama") === "ollama" ? await ollamaDetails(String(provider.baseUrl)) : new Map<string, { bytes?: number; tools?: boolean }>();
    const models = rows.map((m) => {
      const id = m.id.replace(/^models\//, "");
      const info = infoFor(service, id, list);
      const told = ollama.get(id) ?? ollama.get(`${id}:latest`);
      const tools = typeof m.supports_tools === "boolean" ? m.supports_tools : typeof told?.tools === "boolean" ? told.tools : local ? localTools(id) : info.tools;
      return { id, ...info, tools, ...(told?.bytes ? { memory: { bytes: told.bytes, fit: fitFor(told.bytes) } } : {}) };
    });
    // Models that can use tools and fit in memory first; those too big for this computer last.
    const rank = (m: ListedModel) => (m.memory?.fit === "too-big" ? 3 : m.tools === true ? 0 : m.tools === null ? 1 : 2);
    models.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    return { models, reachable: true };
  } catch {
    const local = service?.group === "local" || /localhost|127\.0\.0\.1/.test(String(provider.baseUrl));
    return { models: [], reachable: false, note: local ? `${provider.name} is not running at ${provider.baseUrl}. Start it, then try again.` : `${provider.name} could not be reached at ${provider.baseUrl}.` };
  }
}

/** Prices and size for one model, when known, for counting its cost. */
export async function knownPrices(provider: ProviderConfig, model: string): Promise<{ prices?: Prices; contextTokens?: number }> {
  const service = serviceOfProvider(provider);
  if (!service || service.group === "local") return {};
  const info = infoFor(service, model, await catalog());
  return { prices: info.prices, contextTokens: info.contextTokens };
}

/** The same, from the copy of the list kept on this computer, without waiting on the network. */
export function knownPricesNow(provider: ProviderConfig, model: string, list: OpenRouterModel[]): { prices?: Prices; contextTokens?: number } {
  const service = serviceOfProvider(provider);
  if (!service || service.group === "local") return {};
  const info = infoFor(service, model, list);
  return { prices: info.prices, contextTokens: info.contextTokens };
}

// ---------- connecting ----------

/** The provider id a service is saved under. Local runners keep the id "local" for the first one, so settings from before still work. */
function providerIdFor(service: Service, cfg = getConfig()): string {
  if (service.id === "ollama" && cfg.providers.some((p) => p.id === LEGACY_LOCAL && (!p.service || p.service === "ollama"))) return LEGACY_LOCAL;
  return service.id;
}

/** Checks a key and address with the service itself, before anything is saved. */
async function tryConnection(service: Service, baseUrl: string, key: string | undefined): Promise<{ models: number; note?: string }> {
  const url = service.kind === "anthropic" ? `${baseUrl}/v1/models` : `${baseUrl}/models`;
  let r: Response;
  try {
    r = await fetch(url, { headers: headersFor(service, key), signal: AbortSignal.timeout(12_000) });
  } catch {
    if (service.group === "local") throw new Error(`${service.name} is not running on this computer${service.keyUrl ? `. Install it from ${service.keyUrl.replace(/^https:\/\//, "")}, start it, then connect again` : ". Start it, then connect again"}.`);
    throw new Error(`${service.name} could not be reached at ${baseUrl}. Check the address and your internet connection.`);
  }
  if (r.status === 401 || r.status === 403) throw new Error(`${service.name} did not accept that key. Check you copied all of it${service.keyUrl ? ` from ${service.keyUrl.replace(/^https:\/\//, "")}` : ""}.`);
  // Some services do not list their models; the key is still good, and the model's name is typed instead.
  if (r.status === 404 || r.status === 405) return { models: 0, note: `${service.name} does not list its models, so type the name of the model you want when you choose it.` };
  if (!r.ok) throw new Error(`${service.name} answered with an error (${r.status}). Check the address and key, or try again in a minute.`);
  const data = (await r.json().catch(() => ({}))) as { data?: unknown[]; models?: unknown[] };
  return { models: (data.data ?? data.models ?? []).length };
}

export interface ConnectInput {
  key?: unknown;
  address?: unknown;
  /** For "Another service": its name. */
  name?: unknown;
}

/** Connects a service: checks the key with the service, then saves it. Returns how many models it has. */
export async function connect(serviceId: string, input: ConnectInput): Promise<{ provider: string; models: number; note?: string }> {
  const service = serviceOf(serviceId);
  if (!service) throw new Error("There is no such AI service in the list.");
  if (service.ownSetup) throw new Error(`${service.name} has its own sign-in under Integrations.`);
  const key = String(input.key ?? "").trim() || undefined;
  const cfg = getConfig();
  const id = service.id === "custom" ? customId(String(input.name ?? ""), cfg) : providerIdFor(service, cfg);
  const existing = cfg.providers.find((p) => p.id === id);
  const keyToUse = key ?? (service.kind === "anthropic" ? cfg.apiKey || undefined : existing?.apiKey);
  if (service.serviceAccount && !keyToUse) throw new Error(`Choose the service account's key file (.json) for ${service.name}.`);
  if (service.needsKey && !keyToUse) throw new Error(`Paste your ${service.name} key${service.keyUrl ? `. You can get one at ${service.keyUrl.replace(/^https:\/\//, "")}` : ""}.`);
  if (key) {
    // A key from another service is caught before it is sent anywhere: it would only be refused.
    const other = SERVICES.filter((x) => x.id !== service.id && x.keyPrefix && x.keyPrefix.length > (service.keyPrefix?.length ?? 0) && key.startsWith(x.keyPrefix)).sort((x, y) => y.keyPrefix!.length - x.keyPrefix!.length)[0];
    if (other) throw new Error(`That looks like a key for ${other.name}, not ${service.name}.${service.keyPrefix ? ` A key for ${service.name} starts with ${service.keyPrefix}` : ""}`.replace(/\.?$/, "."));
    if (service.keyPrefix && !key.startsWith(service.keyPrefix)) throw new Error(`A key for ${service.name} starts with ${service.keyPrefix}. Check you copied the right one.`);
  }
  const account = service.serviceAccount ? parseServiceAccount(keyToUse) : null;
  const baseUrl = service.kind === "anthropic" ? service.baseUrl : account ? vertexAddress(account.project_id, input.address) : addressFor(service, input.address);
  // A key file is checked by signing in with it; Vertex AI does not list its models, so Talqava's list is used.
  const result = account ? (await accessToken(account), { models: modelsOf(service.id).length }) : await tryConnection(service, baseUrl, keyToUse);

  if (service.kind === "anthropic") {
    if (key) saveConfig({ apiKey: key });
  } else {
    const provider: ProviderConfig = {
      ...existing,
      id,
      kind: "openai",
      service: service.id,
      name: service.id === "custom" ? String(input.name ?? "").trim().slice(0, 60) || "Another service" : service.name,
      baseUrl,
      apiKey: keyToUse,
      ...(service.keyHeader ? { keyHeader: service.keyHeader } : {}),
      ...(service.group === "local" ? { prices: { input: 0, output: 0 } } : {}),
    };
    saveConfig({ providers: [...cfg.providers.filter((p) => p.id !== id), provider] });
  }
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Connected ${service.id === "custom" ? String(input.name ?? "another AI service") : service.name}`, detail: result.models ? `${result.models} models` : result.note });
  return { provider: service.kind === "anthropic" ? "anthropic" : id, ...result };
}

function customId(name: string, cfg = getConfig()): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  if (!/[a-z]/.test(base)) throw new Error("Give the service a name, e.g. Portkey.");
  // A name that is also a listed service, or a provider already connected from elsewhere, gets a number.
  let id = base;
  for (let n = 2; SERVICES.some((s) => s.id === id && s.id !== "custom") || cfg.providers.some((p) => p.id === id && p.service !== "custom"); n++) id = `${base}-${n}`;
  return id;
}

/** Disconnects a service. Its key is forgotten; agents using one of its models go back to Claude. */
/** Adds another key to a connected service, after checking it with the service. Up to five keys. */
export async function addKey(providerId: string, typed: unknown): Promise<{ keys: number }> {
  const cfg = getConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider || provider.kind === "anthropic") throw new Error("That AI service is not connected.");
  const service = serviceOfProvider(provider);
  if (!service || service.group === "local" || service.serviceAccount) throw new Error(`${provider.name} takes one key.`);
  const key = String(typed ?? "").trim();
  if (!key) throw new Error("Paste the key.");
  const keys = [provider.apiKey, ...(provider.moreKeys ?? [])].filter(Boolean);
  if (keys.includes(key)) throw new Error("That key is already there.");
  if (keys.length >= 5) throw new Error("Up to five keys for one service.");
  await tryConnection(service, String(provider.baseUrl), key);
  saveConfig({ providers: cfg.providers.map((p) => (p.id === providerId ? { ...p, moreKeys: [...(p.moreKeys ?? []), key] } : p)) });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Added another key to ${provider.name}`, detail: `${keys.length + 1} keys` });
  return { keys: keys.length + 1 };
}

export function disconnect(providerId: string): { model: string } {
  const cfg = getConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("That AI service is not connected.");
  const fallback = "anthropic/claude-opus-5-5";
  const uses = (ref: string) => ref.startsWith(`${providerId}/`);
  if (provider.kind === "anthropic") {
    saveConfig({ apiKey: "" });
    audit({ actor: "owner", actorName: "You", kind: "integration", action: "Removed the Anthropic key" });
    return { model: cfg.model };
  }
  const model = uses(cfg.model) ? fallback : cfg.model;
  saveConfig({ model, providers: cfg.providers.filter((p) => p.id !== providerId), backups: (cfg.backups ?? []).filter((b) => !uses(b)) });
  audit({ actor: "owner", actorName: "You", kind: "integration", action: `Disconnected ${provider.name}`, detail: uses(cfg.model) ? "Your team went back to Claude, which it used before." : undefined });
  return { model };
}

/** Whether a model reference ("provider/model") runs on this computer. */
export function isLocalRef(ref: string): boolean {
  const provider = getConfig().providers.find((p) => ref.startsWith(`${p.id}/`));
  if (!provider || provider.kind === "anthropic") return false;
  const service = serviceOfProvider(provider);
  return service?.group === "local" || (provider.id === LEGACY_LOCAL && !provider.service) || /localhost|127\.0\.0\.1/.test(String(provider.baseUrl));
}

/** This computer's memory, in gigabytes, for messages. */
export const memoryGb = () => Math.round(os.totalmem() / 1024 ** 3);

/** Looks for model runners on this computer and connects every one that is running. */
export async function findLocal(): Promise<{ found: { service: string; name: string; models: number }[] }> {
  const found: { service: string; name: string; models: number }[] = [];
  await Promise.all(
    SERVICES.filter((s) => s.group === "local").map(async (service) => {
      try {
        const r = await fetch(`${service.baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
        if (!r.ok) return;
        const data = (await r.json()) as { data?: unknown[] };
        found.push({ service: service.id, name: service.name, models: data.data?.length ?? 0 });
      } catch {
        // Not running.
      }
    }),
  );
  for (const f of found) await connect(f.service, {}).catch(() => {});
  return { found: found.sort((a, b) => a.name.localeCompare(b.name)) };
}

// ---------- backups ----------

/** Sets the backup models, in order. Each must come from a connected service. */
export function setBackups(list: unknown): { backups: string[] } {
  if (!Array.isArray(list)) throw new Error("Send the backups as a list.");
  const cfg = getConfig();
  const backups: string[] = [];
  for (const item of list) {
    const ref = String(item ?? "").trim();
    const at = ref.indexOf("/");
    if (at < 1 || !/^[\w.:@/+-]{1,160}$/.test(ref)) throw new Error("Choose each backup from the list of models.");
    if (!cfg.providers.some((p) => p.id === ref.slice(0, at))) throw new Error(`${ref.slice(0, at)} is not connected.`);
    if (ref !== cfg.model && !backups.includes(ref)) backups.push(ref);
  }
  if (backups.length > 4) throw new Error("Up to four backups.");
  saveConfig({ backups });
  return { backups };
}

// ---------- what the page shows ----------

/** Whether a model runner on this computer is answering now, and how many models it has. */
async function liveLocal(baseUrl: string): Promise<{ running: boolean; models: number }> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { running: true, models: 0 };
    const data = (await r.json()) as { data?: unknown[] };
    return { running: true, models: data.data?.length ?? 0 };
  } catch {
    return { running: false, models: 0 };
  }
}

// ---------- is each service still working? ----------
// Each connected service online is checked every few hours with the same free request used when it was connected
// (list its models, or sign in), so an expired key or an account out of credit is found before a task fails.
const health = new Map<string, { ok: boolean; problem?: string; checkedAt: number }>();
const HEALTH_EVERY = 6 * 3600 * 1000;
const checking = new Set<string>();

async function checkService(provider: ProviderConfig): Promise<{ ok: boolean; problem?: string }> {
  const cfg = getConfig();
  const service = serviceOfProvider(provider);
  try {
    if (service?.serviceAccount) {
      await accessToken(parseServiceAccount(provider.apiKey));
    } else if (provider.kind === "anthropic") {
      const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return { ok: true };
      await tryConnection(serviceOf("anthropic")!, serviceOf("anthropic")!.baseUrl, key);
    } else {
      await tryConnection(service ?? ({ id: provider.id, name: provider.name, group: "gateways", kind: "openai", baseUrl: "", needsKey: false, keyHeader: provider.keyHeader } as Service), String(provider.baseUrl), provider.apiKey);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, problem: (err as Error).message };
  }
}

/** Checks the connected services online that were not checked lately (or all, when forced), in the background. */
export function refreshHealth(force = false): Promise<void> {
  // Tests never reach real services unless a test asks for the check.
  if (process.env.NODE_TEST_CONTEXT && !process.env.TALQAVA_CHECK_SERVICES) return Promise.resolve();
  const cfg = getConfig();
  const due = cfg.providers.filter((p) => {
    // Model programs on this computer are shown live instead (see liveLocal).
    if (serviceOfProvider(p)?.group === "local" || (p.id === LEGACY_LOCAL && !p.service) || checking.has(p.id)) return false;
    if (p.kind === "anthropic" && !(cfg.apiKey || process.env.ANTHROPIC_API_KEY)) return false;
    const last = health.get(p.id);
    return force || !last || Date.now() - last.checkedAt > HEALTH_EVERY;
  });
  return Promise.all(
    due.map(async (p) => {
      checking.add(p.id);
      try {
        const result = await checkService(p);
        const before = health.get(p.id);
        health.set(p.id, { ...result, checkedAt: Date.now() });
        if (!result.ok && before?.ok !== false) audit({ actor: "system", actorName: "Talqava", kind: "problem", ok: false, action: `${p.name} stopped working`, detail: result.problem });
      } finally {
        checking.delete(p.id);
      }
    }),
  ).then(() => undefined);
}

/** Connected services that are not working now, with what is wrong. */
export function serviceProblems(): { id: string; name: string; problem: string }[] {
  const cfg = getConfig();
  return cfg.providers.flatMap((p) => {
    const h = health.get(p.id);
    return h && !h.ok ? [{ id: p.id, name: p.kind === "anthropic" ? "Anthropic (Claude)" : p.name, problem: h.problem ?? "It could not be reached." }] : [];
  });
}

/** For tests: forgets what was checked. */
export function forgetHealth() {
  health.clear();
}

export async function gatewayState({ live = true } = {}) {
  void refreshHealth();
  const cfg = getConfig();
  const connected = cfg.providers
    .filter((p) => (p.kind === "anthropic" ? Boolean(cfg.apiKey || process.env.ANTHROPIC_API_KEY) : true))
    .map((p) => {
      const service = serviceOfProvider(p) ?? (p.id === LEGACY_LOCAL ? serviceOf("ollama") : undefined);
      return {
        id: p.id,
        name: p.kind === "anthropic" ? "Anthropic (Claude)" : p.name,
        service: service?.id ?? "custom",
        group: service?.group ?? "gateways",
        address: p.kind === "anthropic" ? null : p.baseUrl,
        hasKey: p.kind === "anthropic" ? true : Boolean(p.apiKey),
        keys: p.kind === "anthropic" ? 1 : [p.apiKey, ...(p.moreKeys ?? [])].filter(Boolean).length,
        inUse: cfg.model.startsWith(`${p.id}/`),
        // The standard local entry is there from the start; it only counts once something answers.
        standard: p.id === LEGACY_LOCAL && !p.service,
        local: service?.group === "local",
        health: health.get(p.id) ?? null,
      };
    });
  // A model runner on this computer may have been closed since it was connected: say how it is now.
  const withLive = await Promise.all(
    connected.map(async (c) => (live && c.local && c.address && !c.standard ? { ...c, live: await liveLocal(c.address) } : { ...c, live: null as null | { running: boolean; models: number } })),
  );
  return {
    services: SERVICES.map(({ id, name, about, group, needsKey, keyUrl, keyPrefix, addressHint, baseUrl, ownSetup }) => ({ id, name, about, group, needsKey, keyUrl, keyPrefix, addressHint: addressHint ?? null, address: group === "local" ? baseUrl : null, ownSetup: ownSetup ?? null })),
    groups: GROUP_NAMES,
    connected: withLive,
    model: cfg.model,
    backups: cfg.backups ?? [],
  };
}

/** For a service whose key is a service account file: a way to get a fresh token before each request. */
export function keySource(provider: ProviderConfig): (() => Promise<string>) | undefined {
  const service = serviceOfProvider(provider);
  if (!service?.serviceAccount || !provider.apiKey) return undefined;
  const account = parseServiceAccount(provider.apiKey);
  return () => accessToken(account);
}
