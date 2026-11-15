/**
 * Decision-model backends, a thin adapter over the CLI's Tier-1 code
 * (src/analyzers/classifier/): the registry's adapters, the question builders of a question set
 * (`--qset`, default the current one) and `askCard`, so the harness measures what the CLI runs.
 *
 * Backend ids: `cloudflare:clef`, `cloudflare:clef-flash` (Workers AI), with `clef` and `clef-flash`
 * kept as aliases. Predictions keep the short name (`pred-clef@<tag>.jsonl`), so the committed runs
 * stay comparable. `openrouter:<model>@<upstream>` asks OpenRouter's Decisions API pinned to one
 * upstream (`openrouter:cloudflare/clef@cloudflare`, `openrouter:cloudflare/clef@deepinfra/fp8`,
 * `openrouter:typesafe/jev-1.14@typesafe`); its predictions are `pred-openrouter-<model>-<upstream>`
 * with `/` as `_` (`pred-openrouter-cloudflare_clef-deepinfra_fp8@<tag>.jsonl`), and record the
 * provider, the pinned upstream, and the upstream and model each response named (`served_by`).
 *
 * Env (repo-root `.env`): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Workers AI permission);
 * OPENROUTER_API_KEY for OpenRouter.
 */
import {
  askCard,
  choiceOf,
  createDecisionModel,
  credentialEnv,
  credentialsFromEnv,
  isUpstreamSlug,
  CURRENT_QSET_ID,
  noulOf,
  qsetById,
  qsetVariantId,
  resolveModel,
  scoreOf,
  v1,
  type DecisionModel,
  type Narrowing,
  type Question,
} from "../../../src/analyzers/classifier/index.js";
import { loadDotEnv, requireEnv } from "../lib/env.js";
import { currentSpec, NONE_OPTION, SIGNIFICANCE_LEVELS } from "../lib/spec.js";
import { CONCERNS, type Prediction } from "../lib/types.js";

export type { Narrowing, Question };
export const KIND_CANDIDATES = v1.KIND_CANDIDATES;

export interface DecisionBackend {
  /** `cloudflare:clef` */
  id: string;
  /** Prediction file stem and `backend` field: `clef`. */
  name: string;
  provider: string;
  model: string;
  upstream?: string;
}

const PROVIDER_ALIASES: Record<string, string> = { cloudflare: "cloudflare-workers-ai" };
const BACKEND_ALIASES: Record<string, string> = { clef: "cloudflare:clef", "clef-flash": "cloudflare:clef-flash" };
const CREDENTIAL_HINTS: Record<string, string> = {
  CLOUDFLARE_ACCOUNT_ID: "Add it to the repo .env (Cloudflare dashboard -> account id).",
  CLOUDFLARE_API_TOKEN: "Create a token with the 'Workers AI' template and add it to the repo .env.",
  OPENROUTER_API_KEY: "Create a key at openrouter.ai/settings/keys and add it to the repo .env.",
};

/** The decision backend for an id or alias (`cloudflare:clef`, `clef`), or undefined. */
export function decisionBackendOf(id: string): DecisionBackend | undefined {
  const full = BACKEND_ALIASES[id] ?? id;
  const m = /^([a-z0-9-]+):([^@]+)(?:@(.+))?$/.exec(full);
  if (!m) return undefined;
  const provider = PROVIDER_ALIASES[m[1]] ?? m[1];
  const registered = resolveModel(provider, m[2]);
  if (!registered) return undefined;
  if (provider === "openrouter" && !m[3]) {
    throw new Error(`${id}: an OpenRouter backend pins one upstream: openrouter:${registered.name}@<upstream> (e.g. @cloudflare, @deepinfra/fp8, @typesafe)`);
  }
  if (provider !== "openrouter" && m[3]) throw new Error(`${id}: only OpenRouter backends take an @upstream`);
  if (m[3] && !isUpstreamSlug(m[3])) {
    throw new Error(`${id}: "${m[3].slice(0, 64)}" is not an OpenRouter provider slug (lowercase, e.g. cloudflare, deepinfra/fp8, typesafe)`);
  }
  // Workers AI was the first provider: its runs keep the plain model name the committed files use.
  const name = provider === "cloudflare-workers-ai" ? registered.name : `${m[1]}-${registered.name}${m[3] ? `-${m[3]}` : ""}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return { id: full, name, provider, model: registered.name, ...(m[3] ? { upstream: m[3] } : {}) };
}

/** The `model` field a request body carries (for --dry-run). */
export function requestModelOf(backend: DecisionBackend): string {
  return resolveModel(backend.provider, backend.model)!.requestModel;
}

/** The stage-1 question set (layer, significance, concerns); exported for --dry-run. */
export function stage1Questions(narrow?: Narrowing, qset: string = CURRENT_QSET_ID): Record<string, Question> {
  return qsetById(qset).stage1Questions(currentSpec(), narrow);
}

export function stage2Questions(layer: string, kind?: string, kindNarrow = false, narrow?: Narrowing, qset: string = CURRENT_QSET_ID): Record<string, Question> {
  return qsetById(qset).stage2Questions(currentSpec(), layer, kind, kindNarrow, narrow);
}

const models = new Map<string, DecisionModel>();

function modelFor(backend: DecisionBackend): DecisionModel {
  const existing = models.get(backend.id);
  if (existing) return existing;
  loadDotEnv();
  for (const name of Object.values(credentialEnv(backend.provider))) requireEnv(name, CREDENTIAL_HINTS[name] ?? "Add it to the repo .env.");
  const model = createDecisionModel({
    provider: backend.provider,
    model: backend.model,
    credentials: credentialsFromEnv(backend.provider, process.env),
    fetch: (input, init) => fetch(input, init),
    // One pinned upstream: `only` is it alone, with no fallbacks and no data collection (the adapter's fixed routing).
    ...(backend.upstream ? { openrouter: { only: [backend.upstream] } } : {}),
  });
  models.set(backend.id, model);
  return model;
}

export async function classifyWithDecisionModel(
  backend: DecisionBackend,
  cardId: string,
  state: string,
  opts: { kind?: string; kindNarrow?: boolean; narrow?: Narrowing; qset?: string; qsetBase?: string } = {}
): Promise<Prediction> {
  const t0 = Date.now();
  const model = modelFor(backend);
  const qsetBase = opts.qsetBase ?? CURRENT_QSET_ID;
  const ask = await askCard(model, currentSpec(), { qset: qsetBase, state, kind: opts.kind, kindNarrow: !!opts.kindNarrow, narrow: opts.narrow });
  const raw1 = ask.stage1.result.raw;
  const layer = choiceOf(raw1.layer);
  const sig = scoreOf(raw1.significance, SIGNIFICANCE_LEVELS.length);
  const concerns: Record<string, number> = {};
  for (const c of CONCERNS) concerns[c] = noulOf(raw1[`concern_${c}`]);
  const etype = ask.stage2 ? choiceOf(ask.stage2.result.raw.element_type) : { choice: null, probabilities: {}, confidence: null };
  const usage = { input_tokens: ask.usage.inputTokens, output_tokens: ask.usage.outputTokens };
  return {
    card_id: cardId,
    backend: backend.name,
    provider: backend.provider,
    model: model.id.model,
    ...(backend.upstream ? { upstream: backend.upstream } : {}),
    ...(ask.servedBy.upstream || ask.servedBy.model ? { served_by: { ...ask.servedBy } } : {}),
    qset: opts.qset ?? qsetVariantId({ noKindNarrow: !opts.kindNarrow }, qsetBase),
    ...(currentSpec().specVersion ? { spec_version: currentSpec().specVersion } : {}),
    layer: { choice: layer.choice ?? NONE_OPTION, probabilities: layer.probabilities, confidence: layer.confidence },
    element_type: { choice: etype.choice === NONE_OPTION ? null : etype.choice, probabilities: etype.probabilities, confidence: etype.confidence },
    significance: sig,
    concerns,
    latency_ms: Date.now() - t0,
    usage,
    // The provider's own cost when it reports one (OpenRouter's usage.cost), else tokens at list price.
    cost_usd: ask.usage.costUsd,
    error: null,
  };
}
