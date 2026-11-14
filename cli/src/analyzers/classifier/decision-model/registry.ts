/**
 * Decision-model providers: provider name -> adapter factory, and model id -> canonical model and
 * price. Nothing outside `decision-model/` imports an adapter; callers ask the registry.
 *
 * Registered: `cloudflare-workers-ai` (Clef, Clef-flash). `openrouter` is rollout PR 6.
 */
import {
  CLOUDFLARE_WORKERS_AI,
  createCloudflareWorkersAiModel,
  WORKERS_AI_MODELS,
  workersAiModelOf,
  type FetchLike,
} from "./adapters/cloudflare-workers-ai.js";
import type { DecisionModel } from "./types.js";

export type { FetchLike } from "./adapters/cloudflare-workers-ai.js";

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
  /** Provider credentials; for `cloudflare-workers-ai`: `{ accountId, apiToken }`. */
  credentials: Record<string, string | undefined>;
  fetch?: FetchLike;
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
        fetch: options.fetch ?? ((input, init) => fetch(input, init)),
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
  return provider.create(options, model);
}
