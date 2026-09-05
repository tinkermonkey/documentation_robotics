/**
 * Node definition quality analyzer.
 * Pure function — no I/O.
 */

import type { ParsedNodeSchema, NodeDefinitionQuality, DefinitionIssue } from "../types.js";

const GENERIC_DESCRIPTION_RE = /\w+ element in \w+ layer/i;

/**
 * Classify description quality for a node schema.
 */
function classifyDescription(description: string): "empty" | "generic" | "good" {
  if (!description || description.trim() === "") return "empty";
  if (GENERIC_DESCRIPTION_RE.test(description)) return "generic";
  return "good";
}

/**
 * Count how many attribute properties have a non-empty description field.
 */
function countDocumentedAttributes(
  properties: Record<string, { type?: string; description?: string; format?: string; enum?: string[] }>
): number {
  return Object.values(properties).filter(
    (p) => typeof p.description === "string" && p.description.trim() !== ""
  ).length;
}

export class NodeDefinitionAnalyzer {
  analyze(schema: ParsedNodeSchema): NodeDefinitionQuality {
    const issues: DefinitionIssue[] = [];
    let score = 100;

    const descriptionQuality = classifyDescription(schema.description);
    const hasDescription = descriptionQuality !== "empty";

    // Description issues
    if (descriptionQuality === "empty") {
      issues.push({
        severity: "error",
        code: "EMPTY_DESCRIPTION",
        message: `Node type "${schema.specNodeId}" has no description.`,
      });
      score -= 30;
    } else if (descriptionQuality === "generic") {
      issues.push({
        severity: "warning",
        code: "GENERIC_DESCRIPTION",
        message: `Node type "${schema.specNodeId}" uses generic template description: "${schema.description}"`,
      });
      score -= 15;
    } else if (schema.description.trim().length < 20) {
      issues.push({
        severity: "info",
        code: "SHORT_DESCRIPTION",
        message: `Node type "${schema.specNodeId}" has a very short description (${schema.description.trim().length} chars).`,
      });
      score -= 5;
    }

    // Attribute documentation
    const attributeCount = Object.keys(schema.attributes.properties).length;
    const documentedAttributeCount = countDocumentedAttributes(schema.attributes.properties);
    const attributeDocumentationRatio =
      attributeCount > 0 ? documentedAttributeCount / attributeCount : 1.0;

    if (attributeCount > 3 && attributeDocumentationRatio < 0.5) {
      issues.push({
        severity: "warning",
        code: "LOW_ATTRIBUTE_DOCUMENTATION",
        message: `Node type "${schema.specNodeId}" has low attribute documentation: ${documentedAttributeCount}/${attributeCount} attributes described.`,
      });
      score -= 10;
    }

    return {
      specNodeId: schema.specNodeId,
      layerId: schema.layerId,
      hasDescription,
      descriptionQuality,
      attributeCount,
      documentedAttributeCount,
      attributeDocumentationRatio,
      issues,
      score: Math.max(0, score),
    };
  }
}
