/**
 * Decision-model providers: provider name -> adapter factory, and model id -> canonical model and
 * price. Nothing outside `decision-model/` imports an adapter; callers ask the registry.
 *
 * Registered: `cloudflare-workers-ai` (Clef, Clef-flash) and `openrouter` (the Decisions API:
 * `cloudflare/clef`, `cloudflare/clef-flash`, `typesafe/jev-1.14`, `typesafe/jev-1.13`). Canonical
 * models are shared across providers: `cloudflare/clef` on OpenRouter is `clef`, as on Workers AI,
 * so it gets Clef's thresholds; `typesafe/jev-1.14` is `jev-1.14`.
 */
import {
  CLOUDFLARE_WORKERS_AI,
  createCloudflareWorkersAiModel,
  WORKERS_AI_MODELS,
  workersAiModelOf,
  type FetchLike,
} from "./adapters/cloudflare-workers-ai.js";
import { createOpenRouterModel, OPENROUTER, OPENROUTER_MODELS, type OpenRouterRouting } from "./adapters/openrouter.js";
import type { DecisionModel } from "./types.js";

export type { FetchLike } from "./adapters/http.js";
export type { OpenRouterRouting } from "./adapters/openrouter.js";

/** One model a provider serves. */
export interface RegisteredModel {
  provider: string;
  /** The short name users configure (`clef`). */
  name: string;
  /** The provider's id (`@cf/cloudflare/clef`). */
  id: string;
  /** The `model` field a request body carries (`clef` on Workers AI). */
  requestModel: string;
  /** What thresholds and the cache key on (`clef`), shared across providers serving the same weights. */
  canonicalModel: string;
  /** USD per million input tokens. */
  inputPerM: number;
}

export interface CreateDecisionModelOptions {
  provider: string;
  model: string;
  /** Provider credentials; for `cloudflare-workers-ai`: `{ accountId, apiToken }`; for `openrouter`: `{ apiKey }`. */
  credentials: Record<string, string | undefined>;
  /** `openrouter` only, required there: the upstreams allowed to receive card text. */
  openrouter?: OpenRouterRouting;
  /** Required, never defaulted to the global: tests pass a fake, so nothing reaches the network by accident. */
  fetch: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface ProviderEntry {
  models: RegisteredModel[];
  /** Credential names and the environment variables they come from (TIER1_DESIGN.md section 2.3). */
  credentials: Record<string, string>;
  resolve(model: string): RegisteredModel | undefined;
  create(options: CreateDecisionModelOptions, model: RegisteredModel): DecisionModel;
}

const PROVIDERS: Record<string, ProviderEntry> = {
  [CLOUDFLARE_WORKERS_AI]: {
    models: Object.entries(WORKERS_AI_MODELS).map(([name, m]) => ({
      provider: CLOUDFLARE_WORKERS_AI,
      name,
      id: m.id,
      requestModel: m.wireModel,
      canonicalModel: m.canonicalModel,
      inputPerM: m.inputPerM,
    })),
    credentials: { accountId: "CLOUDFLARE_ACCOUNT_ID", apiToken: "CLOUDFLARE_API_TOKEN" },
    resolve(model) {
      const m = workersAiModelOf(model);
      return m ? this.models.find((r) => r.id === m.id) : undefined;
    },
    create(options, model) {
      const { accountId, apiToken } = options.credentials;
      if (!accountId || !apiToken) {
        throw new Error(`${CLOUDFLARE_WORKERS_AI} needs credentials accountId and apiToken (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)`);
      }
      return createCloudflareWorkersAiModel({
        model: model.name,
        credentials: { accountId, apiToken },
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        backoffMs: options.backoffMs,
        sleep: options.sleep,
      });
    },
  },
  [OPENROUTER]: {
    models: Object.entries(OPENROUTER_MODELS).map(([id, m]) => ({
      provider: OPENROUTER,
      name: id,
      id,
      requestModel: id,
      canonicalModel: m.canonicalModel,
      inputPerM: m.inputPerM,
    })),
    credentials: { apiKey: "OPENROUTER_API_KEY" },
    resolve(model) {
      return this.models.find((r) => r.id === model);
    },
    create(options, model) {
      const { apiKey } = options.credentials;
      if (!apiKey) throw new Error(`${OPENROUTER} needs credential apiKey (OPENROUTER_API_KEY)`);
      if (!options.openrouter?.only?.length) throw new Error(`${OPENROUTER} needs the upstreams allowed to receive card text (openrouter.only)`);
      return createOpenRouterModel({
        model: model.id,
        credentials: { apiKey },
        routing: options.openrouter,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        backoffMs: options.backoffMs,
        sleep: options.sleep,
      });
    },
  },
};

export function providerNames(): string[] {
  return Object.keys(PROVIDERS);
}

export function registeredModels(provider?: string): RegisteredModel[] {
  return Object.entries(PROVIDERS)
    .filter(([name]) => !provider || name === provider)
    .flatMap(([, p]) => p.models);
}

/** The registered model for a provider and a model name or id, or undefined. */
export function resolveModel(provider: string, model: string): RegisteredModel | undefined {
  return PROVIDERS[provider]?.resolve(model);
}

/** Environment variable names per credential for a provider (empty for an unknown provider). */
export function credentialEnv(provider: string): Record<string, string> {
  return { ...(PROVIDERS[provider]?.credentials ?? {}) };
}

/** Credentials for a provider read from an environment (the harness passes its own `.env`). */
export function credentialsFromEnv(provider: string, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(credentialEnv(provider)).map(([k, v]) => [k, env[v]]));
}

/** A {@link DecisionModel} for a provider and model; throws for an unknown one or missing credentials. */
export function createDecisionModel(options: CreateDecisionModelOptions): DecisionModel {
  const provider = PROVIDERS[options.provider];
  if (!provider) throw new Error(`Unknown decision-model provider "${options.provider}" (known: ${providerNames().join(", ")})`);
  const model = provider.resolve(options.model);
  if (!model) {
    throw new Error(`Unknown model "${options.model}" for ${options.provider} (known: ${provider.models.map((m) => m.name).join(", ")})`);
  }
  if (typeof options.fetch !== "function") throw new Error("createDecisionModel needs a fetch implementation (it never falls back to the global one)");
  return provider.create(options, model);
}
