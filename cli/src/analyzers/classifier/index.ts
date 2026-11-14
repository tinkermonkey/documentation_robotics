/**
 * Tier 1 (decision model) of the classification cascade: docs/analyzers/TIER1_DESIGN.md.
 *
 * Rollout PR 1: the provider-agnostic decision-model layer with the Workers AI adapter, question
 * set dr-qset-1, criteria, state, bands and cache. Nothing in the CLI calls it yet; the
 * classify-eval harness measures it. The opt-in, the run loop, spend and `codebase_extract` follow
 * in later PRs.
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
export { CURRENT_QSET, CURRENT_QSET_ID, QSETS, qsetVariantId, v1, type Narrowing, type Concern, type QsetVariant } from "./qset/index.js";
