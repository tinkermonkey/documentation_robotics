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
 * catalogs in git (0.8.0 on). A model on a version between two released ones is only refused what
 * neither of them has; a model on a version older than the first is checked as if it were on it.
 * Only what the bundled catalog has is checked: an unknown type or relationship is the other
 * validators' to report.
 *
 * A manifest with no spec_version is read as 0.6.0 (Model.load, dr upgrade). It declares nothing,
 * so a gap against that assumed version is a warning with the call that stamps the version, never a
 * refusal (`assumed` on the gap).
 */

import { compareSpecVersions, getCliBundledSpecVersion } from "../utils/spec-version.js";
import { getNodeType, type SpecNodeId } from "../generated/node-types.js";
import { getValidRelationships } from "../generated/relationship-index.js";
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

/**
 * The spec a model declares: a version, or the manifest (whose specVersionAssumed says Model.load
 * read a missing spec_version as 0.6.0).
 */
export type DeclaredSpec = string | { specVersion?: string; specVersionAssumed?: boolean } | null | undefined;

/** A type or relationship the model's declared spec lacks. */
export interface DeclaredSpecGap {
  /** The model's declared spec version (or the one assumed for it) */
  modelVersion: string;
  /** The first spec version after it that has it */
  since: string;
  /** The spec version this CLI carries, which project_upgrade moves the model to */
  bundled: string;
  /**
   * The manifest has no spec_version and modelVersion is the one assumed for it: warn, don't
   * refuse, since the model declares nothing
   */
  assumed?: true;
  /** One line saying so, with the fix */
  message: string;
}

/** For tests: the history to read, and whether the bundled catalog has the id. */
export interface DeclaredSpecOptions {
  history?: SpecCatalogHistory;
  bundledHas?: boolean;
}

/** The declared version and whether it was assumed. */
function declaredVersion(declared: DeclaredSpec): { version?: string; assumed: boolean } {
  if (!declared) return { assumed: false };
  if (typeof declared === "string") return { version: declared, assumed: false };
  return { version: declared.specVersion, assumed: declared.specVersionAssumed === true };
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
  declared: DeclaredSpec,
  mask: string | undefined,
  history: SpecCatalogHistory,
  bundledHas: boolean
): DeclaredSpecGap | null {
  const bundled = getCliBundledSpecVersion();
  const { version: modelVersion, assumed } = declaredVersion(declared);
  // Not in the bundled catalog: unknown to this dr, not a version gap, and reported elsewhere
  if (!bundledHas) return null;
  if (!modelVersion || compareSpecVersions(modelVersion, bundled) >= 0 || history.versions.length === 0) return null;
  const since = missingSince(modelVersion, mask, history, bundled);
  if (!since) return null;
  if (assumed) {
    return {
      modelVersion,
      since,
      bundled,
      assumed: true,
      message:
        `${what} is not in spec ${modelVersion}, the version a manifest with no spec_version is read as; it exists ` +
        `from spec ${since}. project_upgrade stamps the model's spec version (preview it first; dr upgrade in a ` +
        "terminal), after which this is checked against it.",
    };
  }
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
 * Whether the spec the model declares lacks this node type (`layer.type`, canonical, as the bundled
 * catalog names it). Null when it has it, when the bundled catalog doesn't, when the model declares
 * no version, or when the model is on the bundled spec or a newer one.
 */
export function typeNotInDeclaredSpec(
  declared: DeclaredSpec,
  specNodeId: string,
  options: DeclaredSpecOptions = {}
): DeclaredSpecGap | null {
  const history = options.history ?? SPEC_CATALOG_HISTORY;
  const bundledHas = options.bundledHas ?? getNodeType(specNodeId as SpecNodeId) !== undefined;
  return gap(`Type ${specNodeId}`, declared, history.types[specNodeId], history, bundledHas);
}

/**
 * Whether the spec the model declares lacks this relationship type (source type, predicate and
 * destination type, as the bundled catalog names them). Null as for typeNotInDeclaredSpec.
 */
export function relationshipNotInDeclaredSpec(
  declared: DeclaredSpec,
  sourceSpecNodeId: string,
  predicate: string,
  destinationSpecNodeId: string,
  options: DeclaredSpecOptions = {}
): DeclaredSpecGap | null {
  const history = options.history ?? SPEC_CATALOG_HISTORY;
  const bundledHas =
    options.bundledHas ?? getValidRelationships(sourceSpecNodeId, predicate, destinationSpecNodeId).length > 0;
  return gap(
    `${sourceSpecNodeId} --[${predicate}]--> ${destinationSpecNodeId}`,
    declared,
    history.relationships[`${sourceSpecNodeId}.${predicate}.${destinationSpecNodeId}`],
    history,
    bundledHas
  );
}

/**
 * One line when the model declares a spec newer than this CLI's: a type or relationship that spec
 * added is unknown here, not invalid. Staging adds it to a refusal that would otherwise read as a
 * mistake in the model; nothing else is refused for it. Null when the model is not ahead.
 */
export function specAheadNote(declared: DeclaredSpec): string | null {
  const bundled = getCliBundledSpecVersion();
  const { version: modelVersion } = declaredVersion(declared);
  if (!modelVersion || compareSpecVersions(modelVersion, bundled) <= 0) return null;
  return (
    `The model is on spec ${modelVersion}, newer than the ${bundled} this dr carries: a type or relationship ` +
    "that spec added is unknown here, not invalid. Update the dr CLI, then restart the session's dr server."
  );
}
