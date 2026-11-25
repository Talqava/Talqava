// Backup models: when the chosen model's service is down, busy, out of credit
// or refuses the key, the next model in the list answers instead. A switch only
// happens before any of the reply has arrived, so a reply is never half from one
// model and half from another.
import { costOf } from "./pricing.ts";
import { trimOldResults } from "../context.ts";
import type { Model, ModelCallbacks, ModelReply, ModelRequest, Prices } from "./types.ts";

/** Told about each switch, so it can be shown and logged. */
export type OnSwitch = (from: Model, to: Model, reason: string) => void;

/** Errors worth trying another model for: the service, not the request. */
function worthSwitching(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  // A request the model itself cannot handle (400, 404, 413, 422) would fail on the backup too, except a bad key or missing model.
  if (status === undefined) return true;
  return status === 401 || status === 402 || status === 403 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}

export class FallbackModel implements Model {
  readonly ref: string;
  readonly label: string;
  readonly kind: Model["kind"];
  readonly prices?: Prices;
  readonly trimsOnServer?: boolean;
  readonly models: Model[];
  #onSwitch?: OnSwitch;

  constructor(models: Model[], onSwitch?: OnSwitch) {
    if (!models.length) throw new Error("A model is needed.");
    this.models = models;
    const [first] = models;
    this.ref = first.ref;
    this.label = first.label;
    this.kind = first.kind;
    this.prices = first.prices;
    this.trimsOnServer = first.trimsOnServer;
    this.#onSwitch = onSwitch;
  }

  async call(request: ModelRequest, callbacks: ModelCallbacks): Promise<ModelReply> {
    let lastError: unknown;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      let started = false;
      const watched: ModelCallbacks = {
        onText: (t) => ((started = true), callbacks.onText(t)),
        onThinking: (t) => ((started = true), callbacks.onThinking(t)),
        onToolStart: (n) => ((started = true), callbacks.onToolStart(n)),
      };
      try {
        // Tools that Anthropic runs on its side only work on Claude.
        // A backup that does not clear old outputs itself gets them shortened here, as the engine would have.
        const sent = this.trimsOnServer && !model.trimsOnServer ? { ...request, messages: trimOldResults(request.messages).messages } : request;
        const reply = await model.call(model.kind === "anthropic" ? sent : { ...sent, hostedTools: [] }, watched);
        // A backup's cost is counted at the backup's own prices.
        if (i > 0 && reply.usage.cost === undefined && model.prices) reply.usage = { ...reply.usage, cost: costOf(model.prices, reply.usage) };
        return reply;
      } catch (err) {
        if (request.signal.aborted || started || !worthSwitching(err) || i === this.models.length - 1) throw err;
        lastError = err;
        this.#onSwitch?.(model, this.models[i + 1], (err as Error)?.message ?? String(err));
      }
    }
    throw lastError;
  }
}
