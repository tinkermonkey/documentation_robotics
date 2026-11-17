import { criteriaDigest, DEFAULT_THRESHOLDS, loadSpecCriteria, modeOf } from "../../src/analyzers/classifier/index.js";

/**
 * Whether a shipped default's held-out record was scored with other criteria than the bundled spec
 * sends. The spec's definitions changed since the held-out runs and the runs were not repeated, so
 * the verdict is stale (session.ts) until they are. False for a default with no held-out record.
 */
export async function shippedVerdictIsStale(qset: string, model: string): Promise<boolean> {
  const held = DEFAULT_THRESHOLDS[qset]?.[model]?.heldOut;
  return !!held && held.criteriaDigest !== criteriaDigest(await loadSpecCriteria());
}

/**
 * The mode a run on the verified serving takes with DR's shipped defaults and the bundled spec:
 * the shipped verdict (`modeOf`) while its held-out record matches the criteria this CLI sends,
 * else suggest.
 */
export async function shippedModeNow(qset: string, model: string): Promise<"suggest" | "hide" | "stage"> {
  return (await shippedVerdictIsStale(qset, model)) ? "suggest" : modeOf(qset, model);
}
