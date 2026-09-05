/**
 * Node schema completeness checker.
 * Pure function — no I/O.
 *
 * Compares layer.json node_types lists against actual schema files loaded from disk.
 */

import type { LayerDefinition, ParsedNodeSchema, SchemaCompletenessIssue } from "../types.js";

export class NodeCompletenessChecker {
  check(
    layerDefs: LayerDefinition[],
    schemas: ParsedNodeSchema[]
  ): SchemaCompletenessIssue[] {
    const issues: SchemaCompletenessIssue[] = [];

    // Build a set of all specNodeIds present as schema files
    const schemaIds = new Set(schemas.map((s) => s.specNodeId));

    // Build a set of all specNodeIds declared in layer.json files
    const declaredIds = new Set<string>();
    for (const layer of layerDefs) {
      for (const nodeType of layer.nodeTypes) {
        declaredIds.add(nodeType);
      }
    }

    // Build a quick lookup: layerId → layer definition
    const layerById = new Map(layerDefs.map((l) => [l.id, l]));

    // missing_schema: declared in layer.json but no schema file found
    for (const layer of layerDefs) {
      for (const nodeType of layer.nodeTypes) {
        if (!schemaIds.has(nodeType)) {
          issues.push({
            layerId: layer.id,
            specNodeId: nodeType,
            issueType: "missing_schema",
            detail: `"${nodeType}" is listed in ${layer.id} layer.json but has no corresponding .node.schema.json file.`,
          });
        }
      }
    }

    // orphaned_schema: schema file exists but not listed in any layer.json
    for (const schema of schemas) {
      if (!declaredIds.has(schema.specNodeId)) {
        const layer = layerById.get(schema.layerId);
        issues.push({
          layerId: schema.layerId,
          specNodeId: schema.specNodeId,
          issueType: "orphaned_schema",
          detail: `"${schema.specNodeId}" has a schema file but is not listed in ${layer ? layer.id : schema.layerId} layer.json.`,
        });
      }
    }

    return issues;
  }
}
