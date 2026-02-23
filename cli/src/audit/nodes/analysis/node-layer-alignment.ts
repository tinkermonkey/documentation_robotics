/**
 * Node layer alignment assessor.
 * Pure function — no I/O.
 *
 * Checks whether a layer's node type names contain keywords expected for
 * the layer's inspiring standard (ArchiMate, OpenAPI, etc.).
 */

import type { LayerDefinition, ParsedNodeSchema, LayerAlignmentAssessment } from "../node-audit-types.js";

/**
 * Expected keyword fragments per inspiring standard.
 * A node type name that contains at least one keyword is considered aligned.
 */
const STANDARD_KEYWORDS: Record<string, string[]> = {
  "ArchiMate 3.2": [
    "role", "process", "service", "component", "interface", "event",
    "function", "interaction", "collaboration", "artifact", "node",
    "infrastructure", "system", "application", "business", "data",
    "value", "goal", "driver", "assessment", "requirement", "constraint",
    "principle", "stakeholder", "outcome", "meaning", "capability",
    "resource", "course", "gap", "plateau", "junction",
  ],
  "OpenAPI 3.0": [
    "operation", "parameter", "response", "schema", "header", "server",
    "path", "media", "security", "oauth", "tag", "info", "license",
    "contact", "callback", "link", "encoding", "example", "request",
    "components", "openapi", "externaldocumentation",
  ],
  "JSON Schema Draft 7": [
    "schema", "property", "definition", "array", "object", "enum",
    "format", "entity", "relationship", "attribute", "type",
  ],
  "NIST SP 800-53": [
    "control", "threat", "risk", "policy", "audit", "access",
    "authentication", "authorization", "vulnerability", "incident",
    "compliance", "security",
  ],
  "OpenTelemetry": [
    "trace", "span", "metric", "log", "signal", "attribute", "resource",
    "context", "instrument", "exporter", "sampler", "propagator",
  ],
};

export class NodeLayerAlignmentAssessor {
  assess(
    layerDef: LayerDefinition,
    schemas: ParsedNodeSchema[]
  ): LayerAlignmentAssessment {
    const standard = layerDef.inspiredBy?.standard;

    if (!standard) {
      // No standard to align against — consider fully aligned
      return {
        layerId: layerDef.id,
        standard: "(none)",
        totalNodeTypes: schemas.length,
        alignedCount: schemas.length,
        misalignedTypes: [],
        alignmentPercentage: 100,
      };
    }

    const keywords = STANDARD_KEYWORDS[standard] ?? [];
    if (keywords.length === 0) {
      // Unknown standard — skip alignment check
      return {
        layerId: layerDef.id,
        standard,
        totalNodeTypes: schemas.length,
        alignedCount: schemas.length,
        misalignedTypes: [],
        alignmentPercentage: 100,
      };
    }

    const misalignedTypes: string[] = [];

    for (const schema of schemas) {
      const name = schema.typeName.toLowerCase();
      const aligned = keywords.some((kw) => name.includes(kw.toLowerCase()));
      if (!aligned) {
        misalignedTypes.push(schema.specNodeId);
      }
    }

    const alignedCount = schemas.length - misalignedTypes.length;
    const alignmentPercentage =
      schemas.length > 0 ? (alignedCount / schemas.length) * 100 : 100;

    return {
      layerId: layerDef.id,
      standard,
      totalNodeTypes: schemas.length,
      alignedCount,
      misalignedTypes,
      alignmentPercentage,
    };
  }
}
