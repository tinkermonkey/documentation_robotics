/**
 * Relationship catalog migration
 *
 * When the spec removes, renames or reverses relationship schemas, relationships that a model
 * recorded against the old catalog stop validating. RELATIONSHIP_REWRITE_TABLE maps every retired
 * triple ({sourceLayer}.{sourceType}.{predicate}.{destLayer}.{destType}) to the triple that now
 * expresses the same meaning, and every retired predicate to its replacement. The table is
 * generated from the applied-*.json change records by cli/scripts/generate-relationship-migration.ts;
 * this module applies it to a model's relationships.yaml.
 */

import type { Model } from "./model.js";
import type { Element } from "./element.js";
import type { Relationship } from "./relationships.js";
import { CANONICAL_LAYER_NAMES } from "./layers.js";
import { normalizeNodeType } from "../generated/node-types.js";
import { RELATIONSHIP_REWRITE_TABLE } from "./relationship-migration-table.js";

export interface RelationshipRewriteRule {
  /** Replacement triple, or null when the relationship has no replacement and is dropped */
  to: string | null;
  /** True when the replacement runs the other way, so the relationship's source and target swap */
  swap: boolean;
  /** Change records the rule was composed from, oldest first */
  records: string[];
}

export interface RelationshipRewriteTable {
  /** Change record files the table was generated from */
  sources: string[];
  /** Retired predicate -> replacement predicate, applied to any pair */
  predicateRenames: Record<string, string>;
  /** Retired triple -> replacement */
  triples: Record<string, RelationshipRewriteRule>;
}

/** What a model element id resolves to, for rule lookup and duplicate detection */
export interface ResolvedElement {
  /** Spec node type, e.g. "application.applicationservice" */
  specNodeId: string;
  /** One id per element, so a path and a UUID naming the same element compare equal */
  canonicalId: string;
}

export type ElementResolver = (elementId: string) => ResolvedElement | undefined;

export interface RelationshipRewriteChange {
  action: "rewritten" | "dropped-duplicate" | "dropped";
  before: { source: string; predicate: string; target: string };
  after?: { source: string; predicate: string; target: string };
  /** The rules applied, e.g. "a.x.implements.b.y -> a.x.realizes.b.y" */
  rules: string[];
}

export interface RelationshipRewriteResult {
  relationships: Relationship[];
  changes: RelationshipRewriteChange[];
}

/** Rules are composed when the table is generated, so a chain is at most a predicate rename plus one triple rule */
const MAX_RULES_PER_RELATIONSHIP = 4;

function predicateOf(triple: string): string {
  const parts = triple.split(".");
  if (parts.length !== 5) {
    throw new Error(`Malformed relationship triple '${triple}' in the rewrite table`);
  }
  return parts[2];
}

function swapEnds(rel: Relationship, predicate: string): Relationship {
  const sourceLayer = rel.targetLayer ?? rel.layer;
  const targetLayer = rel.layer;
  const swapped: Relationship = {
    ...rel,
    source: rel.target,
    target: rel.source,
    predicate,
    layer: sourceLayer,
  };
  if (targetLayer && targetLayer !== sourceLayer) {
    swapped.targetLayer = targetLayer;
  } else {
    delete swapped.targetLayer;
  }
  return swapped;
}

function rewriteOne(
  rel: Relationship,
  resolve: ElementResolver,
  table: RelationshipRewriteTable
): { rel: Relationship | null; rules: string[] } | null {
  let current = rel;
  const rules: string[] = [];

  for (let i = 0; i < MAX_RULES_PER_RELATIONSHIP; i++) {
    const source = resolve(current.source);
    const target = resolve(current.target);
    const key =
      source && target ? `${source.specNodeId}.${current.predicate}.${target.specNodeId}` : undefined;
    const rule = key ? table.triples[key] : undefined;

    if (key && rule) {
      if (rule.to === null) {
        rules.push(`${key} -> (removed)`);
        return { rel: null, rules };
      }
      rules.push(`${key} -> ${rule.to}`);
      const predicate = predicateOf(rule.to);
      current = rule.swap ? swapEnds(current, predicate) : { ...current, predicate };
      continue;
    }

    const renamed = table.predicateRenames[current.predicate];
    if (renamed) {
      rules.push(`${current.predicate} -> ${renamed}`);
      current = { ...current, predicate: renamed };
      continue;
    }

    break;
  }

  return rules.length > 0 ? { rel: current, rules } : null;
}

/**
 * Rewrite relationships recorded against retired catalog entries.
 *
 * A relationship whose triple has a rule takes the replacement predicate, with source and target
 * swapped when the replacement runs the other way. A relationship whose endpoints cannot be
 * resolved only gets predicate renames, which need no types. A rewritten relationship that would
 * duplicate one already in the list (same source, predicate and target) is dropped; relationships
 * the table does not touch are kept as they are, in their original order.
 */
export function rewriteRelationships(
  relationships: Relationship[],
  resolve: ElementResolver,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): RelationshipRewriteResult {
  const identity = (rel: Relationship) =>
    [
      resolve(rel.source)?.canonicalId ?? rel.source,
      rel.predicate,
      resolve(rel.target)?.canonicalId ?? rel.target,
    ].join("\u0000");
  const triple = (rel: Relationship) => ({
    source: rel.source,
    predicate: rel.predicate,
    target: rel.target,
  });

  const outcomes = relationships.map((rel) => ({ rel, outcome: rewriteOne(rel, resolve, table) }));

  // Untouched relationships win over rewritten ones, wherever they appear in the file
  const present = new Set(outcomes.filter((o) => o.outcome === null).map((o) => identity(o.rel)));

  const result: Relationship[] = [];
  const changes: RelationshipRewriteChange[] = [];

  for (const { rel, outcome } of outcomes) {
    if (outcome === null) {
      result.push(rel);
      continue;
    }
    if (outcome.rel === null) {
      changes.push({ action: "dropped", before: triple(rel), rules: outcome.rules });
      continue;
    }
    const key = identity(outcome.rel);
    if (present.has(key)) {
      changes.push({
        action: "dropped-duplicate",
        before: triple(rel),
        after: triple(outcome.rel),
        rules: outcome.rules,
      });
      continue;
    }
    present.add(key);
    result.push(outcome.rel);
    changes.push({
      action: "rewritten",
      before: triple(rel),
      after: triple(outcome.rel),
      rules: outcome.rules,
    });
  }

  return { relationships: result, changes };
}

/**
 * Build a resolver over the model's base layers (never a changeset projection), loading any
 * layer that is not in memory yet.
 */
async function buildResolver(model: Model): Promise<ElementResolver> {
  for (const layerName of CANONICAL_LAYER_NAMES) {
    if (!model.layers.has(layerName)) {
      await model.loadLayer(layerName);
    }
  }

  const toResolved = (element: Element, layerName: string): ResolvedElement | undefined => {
    const layerId = element.layer_id || layerName;
    const specNodeId =
      element.spec_node_id ||
      (element.type ? `${layerId}.${normalizeNodeType(layerId, element.type)}` : undefined);
    return specNodeId ? { specNodeId, canonicalId: element.id } : undefined;
  };

  // Index paths and UUIDs once; Layer.getElement scans every node for a UUID
  const index = new Map<string, ResolvedElement | undefined>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      const resolved = toResolved(element, layer.name);
      index.set(element.path, resolved);
      index.set(element.id, resolved);
    }
  }

  return (elementId: string) => {
    if (index.has(elementId)) {
      return index.get(elementId);
    }
    // Legacy semantic ids are only reachable through Layer.getElement
    let resolved: ResolvedElement | undefined;
    for (const layer of model.layers.values()) {
      const element = layer.getElement(elementId);
      if (element) {
        resolved = toResolved(element, layer.name);
        break;
      }
    }
    index.set(elementId, resolved);
    return resolved;
  };
}

export interface RelationshipMigrationResult {
  filesModified: number;
  changes: RelationshipRewriteChange[];
  error?: string;
}

/**
 * Apply the rewrite table to documentation-robotics/model/relationships.yaml on disk.
 * The file is rewritten only when at least one relationship changes.
 */
export async function migrateRelationshipsFile(
  model: Model,
  table: RelationshipRewriteTable = RELATIONSHIP_REWRITE_TABLE
): Promise<RelationshipMigrationResult> {
  const fs = await import("fs/promises");
  const YAML = await import("yaml");
  const relationshipsPath = `${model.rootPath}/documentation-robotics/model/relationships.yaml`;

  let content: string;
  try {
    content = await fs.readFile(relationshipsPath, "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { filesModified: 0, changes: [] };
    }
    throw error;
  }

  const data = YAML.parse(content) ?? [];
  if (!Array.isArray(data)) {
    return {
      filesModified: 0,
      changes: [],
      error: `relationships.yaml is not a list of relationships (found ${typeof data}); fix the file and run the upgrade again`,
    };
  }

  const resolve = await buildResolver(model);
  const { relationships, changes } = rewriteRelationships(data as Relationship[], resolve, table);

  if (changes.length === 0) {
    return { filesModified: 0, changes };
  }

  // Same layout as Model.saveRelationships()
  const header = `# Intra-layer relationships
# Format: source_id -> predicate -> target_id
# Last updated: ${new Date().toISOString()}

`;
  await fs.writeFile(relationshipsPath, header + YAML.stringify(relationships), "utf-8");
  return { filesModified: 1, changes };
}

/** One-line summary of a relationship migration, for the upgrade output */
export function summarizeRelationshipChanges(changes: RelationshipRewriteChange[]): string {
  const count = (action: RelationshipRewriteChange["action"]) =>
    changes.filter((c) => c.action === action).length;
  const parts = [`${count("rewritten")} rewritten`, `${count("dropped-duplicate")} dropped as duplicates`];
  const dropped = count("dropped");
  if (dropped > 0) {
    parts.push(`${dropped} dropped (no replacement)`);
  }
  return `relationships: ${parts.join(", ")}`;
}
