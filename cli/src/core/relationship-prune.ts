/**
 * Dangling relationship detection for `dr relationship prune`.
 *
 * A relationship row is dangling when its `source` or `target` matches neither the
 * UUID `id` nor the dotted `path` of any current element. Both forms are legal in
 * relationships.yaml, so matching on only one of them produces false positives.
 */

import type { Relationship } from "./relationships.js";
import { elementIdentifiers } from "./relationships.js";

export type UnresolvedSide = "source" | "target" | "both";

export interface DanglingRelationship {
  relationship: Relationship;
  /** Which endpoint(s) failed to resolve to a current element */
  unresolved: UnresolvedSide;
}

export interface PruneAnalysis {
  /** Rows examined (after the optional layer filter) */
  scanned: number;
  /** Rows to remove, in file order */
  dangling: DanglingRelationship[];
  /** Rows to keep (including rows outside the layer filter), in file order */
  kept: Relationship[];
}

export interface PruneOptions {
  /**
   * Restrict the scan to rows whose source layer (`layer`) or target layer
   * (`targetLayer`) is one of these canonical layer names. Rows outside the
   * filter are always kept.
   */
  layers?: string[];
}

/**
 * Collect every identifier (UUID id and dotted path) of the given elements.
 */
export function collectKnownIdentifiers(
  elements: Iterable<{ id?: unknown; path?: unknown }>
): Set<string> {
  const known = new Set<string>();
  for (const element of elements) {
    for (const id of elementIdentifiers(element)) {
      known.add(id);
    }
  }
  return known;
}

/**
 * Partition relationships into dangling rows and rows to keep.
 *
 * Order is preserved in both lists so a rewrite of relationships.yaml keeps the
 * surviving rows in their original sequence.
 */
export function findDanglingRelationships(
  relationships: readonly Relationship[],
  knownIdentifiers: ReadonlySet<string>,
  options: PruneOptions = {}
): PruneAnalysis {
  const layerFilter = options.layers && options.layers.length > 0 ? new Set(options.layers) : null;

  const dangling: DanglingRelationship[] = [];
  const kept: Relationship[] = [];
  let scanned = 0;

  for (const rel of relationships) {
    const inScope =
      !layerFilter ||
      layerFilter.has(rel.layer) ||
      (rel.targetLayer !== undefined && layerFilter.has(rel.targetLayer));

    if (!inScope) {
      kept.push(rel);
      continue;
    }

    scanned++;
    const sourceMissing = !knownIdentifiers.has(rel.source);
    const targetMissing = !knownIdentifiers.has(rel.target);

    if (!sourceMissing && !targetMissing) {
      kept.push(rel);
      continue;
    }

    const unresolved: UnresolvedSide =
      sourceMissing && targetMissing ? "both" : sourceMissing ? "source" : "target";
    dangling.push({ relationship: rel, unresolved });
  }

  return { scanned, dangling, kept };
}

/**
 * Split a relationships.yaml document into its leading comment block and the rest.
 *
 * The header is every line up to (but excluding) the first line that is neither a
 * `#` comment nor blank. An empty string is returned when the file has no header.
 */
export function extractRelationshipsHeader(yamlContent: string): string {
  const lines = yamlContent.split("\n");
  const headerLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      headerLines.push(line);
    } else {
      break;
    }
  }
  // Drop trailing blank lines; the writer re-adds a single separator
  while (headerLines.length > 0 && headerLines[headerLines.length - 1].trim() === "") {
    headerLines.pop();
  }
  return headerLines.length > 0 ? headerLines.join("\n") + "\n" : "";
}
