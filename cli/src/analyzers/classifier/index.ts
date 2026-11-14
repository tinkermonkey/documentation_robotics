/**
 * Tier 1 (decision model) of the classification cascade: docs/analyzers/TIER1_DESIGN.md.
 *
 * Rollout PRs 1 and 2: the provider-agnostic decision-model layer with the Workers AI adapter,
 * question sets dr-qset-1 and dr-qset-2 (current), criteria, state, bands with Clef's in-sample
 * defaults, and cache. PR 3: the opt-in (`tier1.json`, `config.ts`), the spend ledger and monthly
 * cap (`spend.ts`), the probe, the run loop (`classifyTier1`), the cache's upkeep, and
 * `dr analyzer classify` with Tier 1 (`classify-run.ts`). PR 4: the status shared by the CLI, the
 * `tier1_status` MCP tool and `project_status` (`status.ts`), and `codebase_extract` in suggest
 * mode (`mcp/tools/codebase-extract-tier1.ts`).
 */
export * from "./decision-model/types.js";
export {
  createDecisionModel,
  credentialEnv,
  credentialsFromEnv,
  providerNames,
  registeredModels,
  resolveModel,
  type CreateDecisionModelOptions,
  type FetchLike,
  type RegisteredModel,
} from "./decision-model/registry.js";
export { choiceOf, noulOf, scoreOf, toAnswer, normaliseJevAnswers, type JevAnswer } from "./decision-model/jev-answers.js";
export * from "./decision-model/probe.js";
export * from "./criteria.js";
export * from "./state.js";
export * from "./bands.js";
export * from "./cache.js";
export * from "./run.js";
export * from "./types.js";
export * from "./config.js";
export * from "./spend.js";
export * from "./session.js";
export * from "./classify-run.js";
export * from "./status.js";
export { baseQsetOf, CURRENT_QSET, CURRENT_QSET_ID, QSETS, qsetById, qsetVariantId, v1, v2, type Narrowing, type Concern, type QsetModule, type QsetVariant } from "./qset/index.js";
