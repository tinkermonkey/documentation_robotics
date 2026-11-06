/**
 * Connection expectations as validation warnings (`dr validate --expected`).
 *
 * Opt-in and never an error: an unmet expectation is a warning with category "expected", which
 * `--strict` does not escalate. The same expectations drive `changeset_brief`'s
 * `missing-expected` gaps; see core/connection-expectations.ts.
 */

import type { Model } from "../core/model.js";
import {
  describeAlternatives,
  expectationsFor,
  isExpectationMet,
  loadExpectations,
  type ElementConnection,
  type ExpectationSet,
} from "../core/connection-expectations.js";
import { normalizeNodeType } from "../generated/node-types.js";
import type { ValidationResult } from "./types.js";

export interface ExpectationCheckSummary {
  checked: number;
  unmet: number;
  warnings: string[];
}

export function addExpectationWarnings(
  model: Model,
  result: ValidationResult,
  options: { layers?: string[]; expectations?: ExpectationSet } = {}
): ExpectationCheckSummary {
  const set = options.expectations ?? loadExpectations();
  const layerFilter = options.layers && options.layers.length > 0 ? new Set(options.layers) : null;

  // Every identifier an element is known by (path, UUID) → its path and spec node id.
  const byAlias = new Map<string, { path: string; specNodeId: string; layer: string }>();
  for (const [layerName, layer] of model.layers) {
    for (const element of layer.listElements()) {
      const path = element.path || element.id;
      const type = element.spec_node_id || `${layerName}.${normalizeNodeType(layerName, element.type)}`;
      const entry = { path, specNodeId: type, layer: layerName };
      byAlias.set(path, entry);
      if (element.id) byAlias.set(element.id, entry);
    }
  }

  const connections = new Map<string, ElementConnection[]>();
  const link = (source: string, predicate: string, target: string) => {
    const s = byAlias.get(source);
    const t = byAlias.get(target);
    if (!s || !t) return;
    const out = connections.get(s.path) ?? [];
    out.push({ direction: "out", predicate, otherType: t.specNodeId });
    connections.set(s.path, out);
    const inc = connections.get(t.path) ?? [];
    inc.push({ direction: "in", predicate, otherType: s.specNodeId });
    connections.set(t.path, inc);
  };
  for (const rel of model.relationships.getAll()) link(rel.source, rel.predicate, rel.target);
  for (const [, layer] of model.layers) {
    for (const element of layer.listElements()) {
      for (const ref of element.references ?? []) link(ref.source || element.path, ref.type, ref.target);
    }
  }

  let checked = 0;
  let unmet = 0;
  const seen = new Set<string>();
  for (const entry of byAlias.values()) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    if (layerFilter && !layerFilter.has(entry.layer)) continue;
    const own = connections.get(entry.path) ?? [];
    for (const expectation of expectationsFor(entry.specNodeId, set)) {
      checked++;
      if (isExpectationMet(expectation, own)) continue;
      unmet++;
      result.addWarning({
        message: `Element '${entry.path}' lacks an expected connection: ${describeAlternatives(expectation).join(", or ")}`,
        layer: entry.layer,
        elementId: entry.path,
        category: "expected",
        fixSuggestion: `${expectation.rationale} (expectation ${expectation.id})`,
      });
    }
  }
  return { checked, unmet, warnings: set.warnings };
}
