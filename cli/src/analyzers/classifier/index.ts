/**
 * Tier 1 (decision model) of the classification cascade: docs/analyzers/TIER1_DESIGN.md.
 *
 * Rollout PRs 1 and 2: the provider-agnostic decision-model layer with the Workers AI adapter,
 * question sets dr-qset-1 and dr-qset-2 (current), criteria, state, bands with Clef's in-sample
 * defaults, and cache. Nothing in the CLI calls it yet; the classify-eval harness measures it. The
 * opt-in, the run loop, spend and `codebase_extract` follow in later PRs.
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
export * from "./criteria.js";
export * from "./state.js";
export * from "./bands.js";
export * from "./cache.js";
export * from "./run.js";
export { baseQsetOf, CURRENT_QSET, CURRENT_QSET_ID, QSETS, qsetById, qsetVariantId, v1, v2, type Narrowing, type Concern, type QsetModule, type QsetVariant } from "./qset/index.js";
