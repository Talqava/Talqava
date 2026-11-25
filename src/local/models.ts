// Turns the model named in the settings ("provider/model") into something the engine can call,
// with the backup models behind it.
import { AnthropicModel, FallbackModel, OpenAICompatibleModel, PrivacyModel } from "../core/index.ts";
import type { Model } from "../core/index.ts";
import { apiKey, getConfig, summaries } from "./store.ts";
import type { Config } from "./store.ts";
import { ATTRIBUTION, OPENROUTER_ID, openrouterCatalogNow, openrouterModelInfo } from "./openrouter.ts";
import { isLocalRef, keySource, knownPricesNow, serviceOf } from "./gateway.ts";
import { audit } from "./audit.ts";

export function splitRef(ref: string): { providerId: string; model: string } {
  const at = ref.indexOf("/");
  return at === -1 ? { providerId: "anthropic", model: ref } : { providerId: ref.slice(0, at), model: ref.slice(at + 1) };
}

/** One model, on its own, with no backups. */
export function resolveOne(cfg: Config = getConfig(), ref = cfg.model): Model {
  const { providerId, model } = splitRef(ref);
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error(`No AI service called "${providerId}" is connected. Connect it under Integrations → AI models.`);
  if (!model) throw new Error("No model is chosen. Choose one under Integrations → AI models.");
  if (provider.kind === "anthropic") {
    return new AnthropicModel({ apiKey: apiKey(cfg) || undefined, model, effort: cfg.effort, providerId: provider.id });
  }
  if (!provider.baseUrl) throw new Error(`${provider.name} has no address. Set it up again under Integrations → AI models.`);
  const service = provider.service ? serviceOf(provider.service) : undefined;
  // On OpenRouter every model has its own prices and size; they come from its list of models.
  // Other services' prices come from the same list when the service is the model's maker.
  const listed = provider.id === OPENROUTER_ID ? openrouterModelInfo(model) : undefined;
  const known = listed ? undefined : knownPricesNow(provider, model, openrouterCatalogNow());
  const contextTokens = listed?.contextTokens ?? provider.contextTokens ?? known?.contextTokens;
  return new OpenAICompatibleModel({
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey || undefined,
    getKey: keySource(provider),
    model,
    prices: listed?.prices ?? provider.prices ?? known?.prices,
    contextTokens,
    keyHeader: provider.keyHeader ?? service?.keyHeader,
    tokenLimit: service?.tokenLimit,
    ...(provider.id === OPENROUTER_ID
      ? { headers: ATTRIBUTION, maxTokens: listed ? Math.min(16_000, Math.max(4096, Math.floor(listed.contextTokens / 8))) : undefined }
      : {}),
    summaries,
  });
}

/**
 * The model to use, with the backups chosen under Integrations → AI models behind it: if its service is down,
 * busy or out of credit before it starts answering, the next one answers instead.
 */
export function resolveModel(cfg: Config = getConfig(), ref = cfg.model): Model {
  const model = withBackups(cfg, ref);
  // The privacy guardrail hides personal details from AI services; a model on this computer sends nothing out.
  return cfg.privacy === "mask" && !(isLocalRef(ref) && !(cfg.backups ?? []).some((b) => b !== ref && !isLocalRef(b))) ? new PrivacyModel(model) : model;
}

function withBackups(cfg: Config, ref: string): Model {
  const first = resolveOne(cfg, ref);
  const backups: Model[] = [];
  for (const backup of cfg.backups ?? []) {
    if (backup === ref) continue;
    try {
      backups.push(resolveOne(cfg, backup));
    } catch {
      // A backup whose service was disconnected is skipped.
    }
  }
  if (!backups.length) return first;
  return new FallbackModel([first, ...backups], (from, to, reason) =>
    audit({ actor: "system", actorName: "Talqava", kind: "problem", ok: false, action: `Switched from ${from.label} to the backup ${to.label}`, detail: reason.slice(0, 300) }),
  );
}
