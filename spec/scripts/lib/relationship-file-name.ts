/**
 * Relationship schema file names (spec/schemas/relationships/{source layer}/{file}).
 *
 * The rule (spec 0.12.x, issue #1090):
 *
 *   {sourceType}.{predicate}.{destinationType}.relationship.schema.json
 *       when the destination's type name is defined in exactly one layer
 *   {sourceType}.{predicate}.{destinationLayer}.{destinationType}.relationship.schema.json
 *       when the destination's type name is defined in more than one layer
 *       (today: view, validationrule and retentionpolicy)
 *
 * The source type is never qualified: the file sits in its source layer's directory, which
 * already says which layer it belongs to. Only the destination can be ambiguous.
 *
 * Parsing is unambiguous because no segment contains a dot. Layer names may contain hyphens
 * (data-model, data-store), type names are lowercase letters, and predicates are hyphenated
 * words, so splitting the stem on "." gives three segments (unqualified) or four (qualified, the
 * third being the destination layer). Any other count is not a relationship schema file name.
 *
 * Each triple has exactly one canonical file name: qualification is required when the type name is
 * ambiguous and not allowed otherwise. The file's JSON content (properties.id,
 * source_spec_node_id, destination_spec_node_id) stays the authority on what the triple is; the
 * name has to agree with it, and build-spec.ts refuses a file whose name isn't the canonical one.
 * When a new node type reuses an existing type name in another layer, the relationship files
 * pointing at the old one must be renamed to the qualified form (build-spec.ts says which).
 *
 * This module depends only on Node built-ins, so spec/scripts, cli/scripts and the tests can all
 * import it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const RELATIONSHIP_SCHEMA_SUFFIX = ".relationship.schema.json";

/** One segment of a file name or triple id: no dots, nothing empty. */
const SEGMENT = /^[a-z][a-z0-9-]*$/;

export interface RelationshipFileName {
  sourceType: string;
  predicate: string;
  /** Present only in the qualified form. */
  destinationLayer?: string;
  destinationType: string;
}

export interface RelationshipTriple {
  sourceLayer: string;
  sourceType: string;
  predicate: string;
  destinationLayer: string;
  destinationType: string;
}

/**
 * Split a relationship id ({sourceLayer}.{sourceType}.{predicate}.{destinationLayer}.{destinationType})
 * into its parts.
 *
 * @throws Error when the id doesn't have five non-empty dot-separated segments
 */
export function parseRelationshipId(id: string): RelationshipTriple {
  const p = id.split(".");
  if (p.length !== 5 || !p.every((s) => SEGMENT.test(s))) {
    throw new Error(`'${id}' is not a {sourceLayer}.{sourceType}.{predicate}.{destinationLayer}.{destinationType} relationship id`);
  }
  return { sourceLayer: p[0], sourceType: p[1], predicate: p[2], destinationLayer: p[3], destinationType: p[4] };
}

/**
 * Type names that more than one layer defines, from spec node ids ({layer}.{type}).
 * A destination with one of these names needs its layer in the relationship file name.
 */
export function ambiguousTypeNames(specNodeIds: Iterable<string>): Set<string> {
  const layersByType = new Map<string, Set<string>>();
  for (const id of specNodeIds) {
    const dot = id.indexOf(".");
    if (dot < 1) continue;
    const layer = id.slice(0, dot);
    const type = id.slice(dot + 1);
    if (!layersByType.has(type)) layersByType.set(type, new Set());
    layersByType.get(type)!.add(layer);
  }
  return new Set([...layersByType].filter(([, layers]) => layers.size > 1).map(([type]) => type));
}

/**
 * The canonical file name for a relationship (without its directory, which is the source layer).
 *
 * @param ambiguous type names defined in more than one layer (ambiguousTypeNames)
 */
export function relationshipFileName(id: string | RelationshipTriple, ambiguous: ReadonlySet<string>): string {
  const t = typeof id === "string" ? parseRelationshipId(id) : id;
  const destination = ambiguous.has(t.destinationType) ? `${t.destinationLayer}.${t.destinationType}` : t.destinationType;
  return `${t.sourceType}.${t.predicate}.${destination}${RELATIONSHIP_SCHEMA_SUFFIX}`;
}

/** The canonical path of a relationship's file relative to spec/schemas/relationships. */
export function relationshipFilePath(id: string | RelationshipTriple, ambiguous: ReadonlySet<string>): string {
  const t = typeof id === "string" ? parseRelationshipId(id) : id;
  return `${t.sourceLayer}/${relationshipFileName(t, ambiguous)}`;
}

/**
 * Parse a relationship schema file name. Returns null when it isn't one (wrong suffix, or not
 * three or four dot-separated segments).
 */
export function parseRelationshipFileName(fileName: string): RelationshipFileName | null {
  if (!fileName.endsWith(RELATIONSHIP_SCHEMA_SUFFIX)) return null;
  const p = fileName.slice(0, -RELATIONSHIP_SCHEMA_SUFFIX.length).split(".");
  if (!p.every((s) => SEGMENT.test(s))) return null;
  if (p.length === 3) return { sourceType: p[0], predicate: p[1], destinationType: p[2] };
  if (p.length === 4) return { sourceType: p[0], predicate: p[1], destinationLayer: p[2], destinationType: p[3] };
  return null;
}

/**
 * Why a relationship schema file's name doesn't fit its content, or null when it is the
 * canonical name for the triple the content declares.
 *
 * @param sourceLayerDir the directory the file is in (its source layer)
 * @param fileName the file's base name
 * @param id the content's properties.id.const
 * @param ambiguous type names defined in more than one layer (ambiguousTypeNames)
 */
export function relationshipFileNameProblem(sourceLayerDir: string, fileName: string, id: string, ambiguous: ReadonlySet<string>): string | null {
  let t: RelationshipTriple;
  try {
    t = parseRelationshipId(id);
  } catch (e) {
    return (e as Error).message;
  }
  if (t.sourceLayer !== sourceLayerDir) {
    return `holds ${id}, whose source layer is ${t.sourceLayer}, but is in the ${sourceLayerDir} directory`;
  }
  const expected = relationshipFileName(t, ambiguous);
  if (fileName === expected) return null;
  const parsed = parseRelationshipFileName(fileName);
  if (parsed && !parsed.destinationLayer && ambiguous.has(t.destinationType)) {
    return `holds ${id}, but its name leaves out the destination layer, and ${t.destinationType} is defined in more than one layer; rename it to ${expected}`;
  }
  if (parsed?.destinationLayer && !ambiguous.has(t.destinationType)) {
    return `holds ${id}, but its name qualifies ${t.destinationType}, which only one layer defines; rename it to ${expected}`;
  }
  return `holds ${id}, but its name should be ${expected}`;
}

/** Every spec node id ({layer}.{type}) under {schemasDir}/nodes, read from the file names. */
export function specNodeIdsIn(schemasDir: string): string[] {
  const nodesDir = path.join(schemasDir, "nodes");
  const ids: string[] = [];
  if (!existsSync(nodesDir)) return ids;
  for (const layer of readdirSync(nodesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(path.join(nodesDir, layer.name)).filter((f) => f.endsWith(".node.schema.json"))) {
      ids.push(`${layer.name}.${f.slice(0, -".node.schema.json".length)}`);
    }
  }
  return ids;
}

/**
 * Every relationship schema under {schemasDir}/relationships whose file name isn't the canonical
 * name for the triple its content declares, as "relationships/{layer}/{file} {problem}" lines.
 * Files that don't parse or carry no id are left to the loaders to report.
 *
 * @param nodeIds the spec node ids to judge ambiguity by (default: those under {schemasDir}/nodes)
 */
export function relationshipFileNameProblems(schemasDir: string, nodeIds: Iterable<string> = specNodeIdsIn(schemasDir)): string[] {
  const ambiguous = ambiguousTypeNames(nodeIds);
  const relRoot = path.join(schemasDir, "relationships");
  const problems: string[] = [];
  if (!existsSync(relRoot)) return problems;
  for (const layer of readdirSync(relRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = path.join(relRoot, layer.name);
    for (const fileName of readdirSync(dir).filter((f) => f.endsWith(RELATIONSHIP_SCHEMA_SUFFIX)).sort()) {
      let id: unknown;
      try {
        id = JSON.parse(readFileSync(path.join(dir, fileName), "utf-8")).properties?.id?.const;
      } catch {
        continue;
      }
      if (typeof id !== "string") continue;
      const problem = relationshipFileNameProblem(layer.name, fileName, id, ambiguous);
      if (problem) problems.push(`relationships/${layer.name}/${fileName} ${problem}`);
    }
  }
  return problems;
}
