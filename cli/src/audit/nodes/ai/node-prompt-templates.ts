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

PATTERN DETECTION — In addition to scoring, identify two structural anti-patterns. When found, apply the scoring impact below and include a specific remediation suggestion.

PATTERN A — Cross-layer reference annotation:
  A node whose sole purpose is to carry metadata that belongs to another layer.
  Indicators:
    • Name uses x- prefix (e.g. x-database, x-ui, x-security, x-apm-*)
    • Description says things like "links schema to...", "reference to ... in another layer",
      "UI rendering hints", "security metadata", "database mapping information"
    • Attributes describe properties of another layer's concepts, not this layer's
  Scoring impact: Alignment score must be 0–29. This is a conceptual misalignment — the node
    embeds cross-layer coupling inside a layer's type catalog instead of using relationships
    or metadata attachments.
  Required suggestion: Recommend moving this to a relationship property or cross-reference
    annotation, and identify which layer it actually belongs to.

PATTERN B — Enum-masquerading node type:
  A node that enumerates a closed set of values but is modeled as a first-class node type.
  Indicators:
    • Has only one attribute (commonly named "value" with type string or enum)
    • Name or description uses words like "type", "kind", "mode", "status", or implies
      a finite set of choices (e.g. "Core JSON data types", "String type definition")
    • Represents a primitive value constraint rather than a structural concept
  Scoring impact: Reduce alignment score by 20–30 points. These inflate the type catalog
    and are modeling primitives incorrectly used.
  Required suggestion: Recommend collapsing into an \`enum\`-constrained string attribute on
    the parent schema (or a shared \`$defs\` enum referenced via \`$ref\`), and name the
    specific attribute and schema where it should live.

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
