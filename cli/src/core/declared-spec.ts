/**
 * Whether a node type or relationship type is in the spec a model declares (#1411).
 *
 * The CLI validates against the catalog it bundles. A model whose manifest declares an older spec
 * would otherwise accept what only a newer spec defines: Context Studio's model declares 0.13.0,
 * took two `applicationservice accesses objectschema` relationships from a 0.14.0 CLI, and its own
 * import (which reads the model against 0.13.0) then could not resolve them. Staging, model_validate
 * and the landing preview ask here and refuse such a type or relationship, naming the model's
 * version, the version that has it and project_upgrade.
 *
 * What each released spec had comes from spec-catalog-history.ts, generated from the released
 * catalogs in git (0.8.1 on). A model on a version between two released ones is only refused what
 * neither of them has; a model on a version older than the first is checked as if it were on it.
 */

import { getCliBundledSpecVersion } from "../utils/spec-version.js";
import { SPEC_CATALOG_HISTORY } from "./spec-catalog-history.js";

/** The released spec versions before the bundled one, and what each had (see the generator). */
export interface SpecCatalogHistory {
  /** Released spec versions, oldest first */
  versions: string[];
  /** Node type (`layer.type`) to a mask over versions: "1" where that version has it */
  types: Record<string, string>;
  /** Relationship type (`source.predicate.destination`) to a mask over versions */
  relationships: Record<string, string>;
}

/** A type or relationship the model's declared spec lacks. */
export interface DeclaredSpecGap {
  /** The model's declared spec version */
  modelVersion: string;
  /** The first spec version after it that has it */
  since: string;
  /** The spec version this CLI carries, which project_upgrade moves the model to */
  bundled: string;
  /** One line saying so, with the fix */
  message: string;
}

/** -1, 0 or 1, comparing dotted numeric versions part by part. */
export function compareSpecVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The first version that has what `mask` describes, when the model's version has it in neither
 * the released version at or below it nor the one at or above it; null when it may have it.
 */
function missingSince(
  modelVersion: string,
  mask: string | undefined,
  history: SpecCatalogHistory,
  bundled: string
): string | null {
  const { versions } = history;
  const has = (index: number) => mask?.charAt(index) === "1";
  let floor = -1;
  let ceil = versions.length;
  versions.forEach((version, index) => {
    const order = compareSpecVersions(version, modelVersion);
    if (order <= 0) floor = index;
    if (order >= 0 && ceil === versions.length) ceil = index;
  });
  // Older than every released catalog the table has: read as the oldest
  if (floor < 0) floor = 0;
  // ceil === versions.length is the bundled catalog, which has it
  if (ceil >= versions.length || has(floor) || has(ceil)) return null;
  for (let index = ceil + 1; index < versions.length; index++) if (has(index)) return versions[index];
  return bundled;
}

function gap(
  what: string,
  modelVersion: string | null | undefined,
  mask: string | undefined,
  history: SpecCatalogHistory
): DeclaredSpecGap | null {
  const bundled = getCliBundledSpecVersion();
  if (!modelVersion || compareSpecVersions(modelVersion, bundled) >= 0 || history.versions.length === 0) return null;
  const since = missingSince(modelVersion, mask, history, bundled);
  if (!since) return null;
  return {
    modelVersion,
    since,
    bundled,
    message:
      `${what} is not in spec ${modelVersion}, the model's version; it exists from spec ${since}. ` +
      `Run project_upgrade first: it previews moving the model to spec ${bundled} (dr upgrade in a terminal).`,
  };
}

/**
 * Whether the spec the model declares lacks this node type (`layer.type`, as the bundled catalog
 * names it). Null when it has it, when the model declares no version, or when the model is on the
 * bundled spec or a newer one.
 */
export function typeNotInDeclaredSpec(
  modelVersion: string | null | undefined,
  specNodeId: string,
  history: SpecCatalogHistory = SPEC_CATALOG_HISTORY
): DeclaredSpecGap | null {
  return gap(`Type ${specNodeId}`, modelVersion, history.types[specNodeId], history);
}

/**
 * Whether the spec the model declares lacks this relationship type (source type, predicate and
 * destination type, as the bundled catalog names them). Null as for typeNotInDeclaredSpec.
 */
export function relationshipNotInDeclaredSpec(
  modelVersion: string | null | undefined,
  sourceSpecNodeId: string,
  predicate: string,
  destinationSpecNodeId: string,
  history: SpecCatalogHistory = SPEC_CATALOG_HISTORY
): DeclaredSpecGap | null {
  return gap(
    `${sourceSpecNodeId} --[${predicate}]--> ${destinationSpecNodeId}`,
    modelVersion,
    history.relationships[`${sourceSpecNodeId}.${predicate}.${destinationSpecNodeId}`],
    history
  );
}

/**
 * One line when the model declares a spec newer than this CLI's: a type or relationship that spec
 * added is unknown here, not invalid. Staging adds it to a refusal that would otherwise read as a
 * mistake in the model; nothing else is refused for it. Null when the model is not ahead.
 */
export function specAheadNote(modelVersion: string | null | undefined): string | null {
  const bundled = getCliBundledSpecVersion();
  if (!modelVersion || compareSpecVersions(modelVersion, bundled) <= 0) return null;
  return (
    `The model is on spec ${modelVersion}, newer than the ${bundled} this dr carries: a type or relationship ` +
    "that spec added is unknown here, not invalid. Update the dr CLI, then restart the session's dr server."
  );
}
