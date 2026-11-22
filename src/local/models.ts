// Turns the model named in the settings ("provider/model") into something the engine can call.
import { AnthropicModel, OpenAICompatibleModel } from "../core/index.ts";
import type { Model } from "../core/index.ts";
import { apiKey, getConfig } from "./store.ts";
import type { Config } from "./store.ts";

export function splitRef(ref: string): { providerId: string; model: string } {
  const at = ref.indexOf("/");
  return at === -1 ? { providerId: "anthropic", model: ref } : { providerId: ref.slice(0, at), model: ref.slice(at + 1) };
}

export function resolveModel(cfg: Config = getConfig(), ref = cfg.model): Model {
  const { providerId, model } = splitRef(ref);
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error(`No model provider called "${providerId}". Choose a model under Settings.`);
  if (!model) throw new Error("No model is chosen. Choose one under Settings.");
  if (provider.kind === "anthropic") {
    return new AnthropicModel({ apiKey: apiKey(cfg) || undefined, model, effort: cfg.effort, providerId: provider.id });
  }
  if (!provider.baseUrl) throw new Error(`${provider.name} has no address. Add it under Settings.`);
  return new OpenAICompatibleModel({
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey || undefined,
    model,
    prices: provider.prices,
  });
}
