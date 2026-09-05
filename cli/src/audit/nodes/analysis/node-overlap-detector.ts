/**
 * Node semantic overlap detector.
 * Pure function — no I/O.
 *
 * Compares all pairs within a layer (O(n²)) to find potentially duplicate
 * node types based on name similarity, attribute overlap, or description overlap.
 */

import type { ParsedNodeSchema, SemanticOverlapCandidate } from "../types.js";

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Jaccard similarity of two sets of strings.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Tokenize a description into lowercase words for overlap comparison.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

export class NodeOverlapDetector {
  detectOverlaps(schemas: ParsedNodeSchema[]): SemanticOverlapCandidate[] {
    const candidates: SemanticOverlapCandidate[] = [];

    // Group by layer
    const byLayer = new Map<string, ParsedNodeSchema[]>();
    for (const schema of schemas) {
      const group = byLayer.get(schema.layerId) ?? [];
      group.push(schema);
      byLayer.set(schema.layerId, group);
    }

    for (const [layerId, layerSchemas] of byLayer) {
      const n = layerSchemas.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = layerSchemas[i];
          const b = layerSchemas[j];

          const candidate = this.comparePair(a, b, layerId);
          if (candidate) candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  private comparePair(
    a: ParsedNodeSchema,
    b: ParsedNodeSchema,
    layerId: string
  ): SemanticOverlapCandidate | null {
    // Name similarity: strip layer prefix, compare type names
    const nameA = a.typeName.toLowerCase();
    const nameB = b.typeName.toLowerCase();
    const nameDist = levenshteinDistance(nameA, nameB);
    const minNameLen = Math.min(nameA.length, nameB.length);

    if (minNameLen >= 6 && nameDist <= 2) {
      return {
        nodeTypeA: a.specNodeId,
        nodeTypeB: b.specNodeId,
        layerId,
        reason: `Type names "${nameA}" and "${nameB}" differ by only ${nameDist} character(s).`,
        confidence: "high",
        overlapType: "name_similarity",
      };
    }

    // Attribute similarity: Jaccard > 0.8 AND name distance <= 4
    const keysA = new Set(Object.keys(a.attributes.properties));
    const keysB = new Set(Object.keys(b.attributes.properties));
    if (keysA.size > 0 && keysB.size > 0) {
      const attrJaccard = jaccardSimilarity(keysA, keysB);
      if (attrJaccard > 0.8 && nameDist <= 4) {
        return {
          nodeTypeA: a.specNodeId,
          nodeTypeB: b.specNodeId,
          layerId,
          reason: `Attribute sets are ${(attrJaccard * 100).toFixed(0)}% similar (Jaccard) with name distance ${nameDist}.`,
          confidence: "high",
          overlapType: "attribute_similarity",
        };
      }
    }

    // Description similarity: Jaccard word overlap > 0.7 (only for "good" descriptions)
    if (a.description && b.description) {
      const wordsA = tokenize(a.description);
      const wordsB = tokenize(b.description);
      if (wordsA.size >= 4 && wordsB.size >= 4) {
        const descJaccard = jaccardSimilarity(wordsA, wordsB);
        if (descJaccard > 0.7) {
          return {
            nodeTypeA: a.specNodeId,
            nodeTypeB: b.specNodeId,
            layerId,
            reason: `Descriptions share ${(descJaccard * 100).toFixed(0)}% word overlap.`,
            confidence: "medium",
            overlapType: "description_similarity",
          };
        }
      }
    }

    return null;
  }
}
