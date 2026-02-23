import type { LayerDefinition, ParsedNodeSchema } from "../node-audit-types.js";

export class NodePromptTemplates {
  /**
   * Build a per-layer batch prompt that asks Claude to evaluate every node type
   * for alignment to the layer's inspiring standard and documentation quality.
   */
  layerEvaluation(context: {
    layerDef: LayerDefinition;
    schemas: ParsedNodeSchema[];
  }): string {
    const { layerDef, schemas } = context;
    const standard = layerDef.inspiredBy
      ? `${layerDef.inspiredBy.standard} ${layerDef.inspiredBy.version}`
      : this.getFallbackStandard(layerDef.id);

    const inputItems = schemas.map((s) => ({
      specNodeId: s.specNodeId,
      title: s.title,
      description: s.description,
      attributeNames: Object.keys(s.attributes.properties),
    }));

    return `You are evaluating node type definitions in a federated architecture specification.

Layer: ${layerDef.name} (layer ${layerDef.number})
Inspiring Standard: ${standard}

For each node type, score it on two dimensions (0-100 each):

ALIGNMENT SCORE — How well does this node type conceptually belong in the ${layerDef.name} layer as defined by ${standard}?
  90-100: Core concept in the standard, perfect fit for this layer
  70-89:  Clearly related to the standard, well-placed in this layer
  50-69:  Loosely related, could belong here or in an adjacent layer
  30-49:  Weak connection to the standard's domain
  0-29:   Appears misplaced; would fit better in a different layer

DOCUMENTATION SCORE — Is the description accurate, useful, and sufficient?
  90-100: Clear, accurate, implementation-agnostic, and complete
  70-89:  Mostly good with minor gaps
  50-69:  Generic or vague but not wrong
  30-49:  Misleading or too brief to be useful
  0-29:   Empty, missing, or actively wrong

Input node types:
\`\`\`json
${JSON.stringify(inputItems, null, 2)}
\`\`\`

Return ONLY a JSON array (no prose, no markdown outside the array) with one object per node type:
[
  {
    "specNodeId": "string",
    "alignmentScore": 0-100,
    "alignmentReasoning": "brief explanation",
    "documentationScore": 0-100,
    "documentationReasoning": "brief explanation",
    "suggestions": ["actionable suggestion 1", ...]
  }
]`;
  }

  /**
   * Fallback standard names for layers without inspiredBy metadata.
   * Public so NodeAIEvaluator can use the same mapping for LayerAIReview.standard.
   */
  getFallbackStandard(layerId: string): string {
    const standards: Record<string, string> = {
      motivation: "ArchiMate 3.2",
      business: "ArchiMate 3.2",
      security: "NIST SP 800-53",
      application: "ArchiMate 3.2",
      technology: "ArchiMate 3.2",
      api: "OpenAPI 3.0",
      "data-model": "JSON Schema Draft 7",
      "data-store": "Database design patterns",
      ux: "Component-based UI patterns",
      navigation: "Application routing patterns",
      apm: "OpenTelemetry",
      testing: "Software testing best practices",
    };
    return standards[layerId] ?? "Architecture best practices";
  }
}
