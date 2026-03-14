import type { CoverageMetrics } from "../../types.js";

/**
 * Optional spec context passed to interLayerValidation() to ground the prompt
 * in real node types and existing schemas rather than relying on static hints.
 */
export interface InterLayerContext {
  /** 1-based layer number of the more-abstract (lower-numbered) layer */
  sourceLayerNumber: number;
  /** 1-based layer number of the more-concrete (higher-numbered) layer */
  targetLayerNumber: number;
  /** Node types available in the more-concrete layer (concrete → abstract references) */
  concreteNodeTypes?: string[];
  /** Node types available in the more-abstract layer */
  abstractNodeTypes?: string[];
  /** Cross-layer schemas already defined for this pair — excluded from suggestions */
  existingSchemas?: string[];
  /** Predicates valid for cross-layer use in this spec version */
  availablePredicates?: string[];
}

export class PromptTemplates {
  /**
   * Generate element evaluation prompt for low-coverage node types
   */
  elementEvaluation(
    nodeType: string,
    coverage: CoverageMetrics,
    predicates: string[]
  ): string {
    const [layer, type] = nodeType.split(".");
    const standard = this.getLayerStandard(layer);
    const targetRange = this.getTargetRange();

    return `Evaluate the node type '${nodeType}' for missing intra-layer relationships.

Layer: ${layer}
Node Type: ${type}
Current Relationships: ${coverage.relationshipsPerNodeType} (target: ${targetRange})
Layer Standard: ${standard}

Available Predicates:
${predicates.map((p) => `- ${p}: ${this.getPredicateDefinition(p)}`).join("\n")}

Suggest meaningful intra-layer relationships based on ${standard} patterns.
For each suggestion, provide:
1. Source node type (this type: ${nodeType})
2. Predicate (from available list)
3. Destination node type (must exist in ${layer} layer)
4. Architectural justification (reference ${standard} specification)
5. Priority (high/medium/low)

Format as JSON array of relationship recommendations.`;
  }

  /**
   * Generate layer review prompt for overall coherence evaluation
   */
  layerReview(layer: string, coverage: CoverageMetrics[]): string {
    const layerMetrics = coverage.find((c) => c.layer === layer);
    if (!layerMetrics) {
      throw new Error(`No coverage metrics found for layer: ${layer}`);
    }

    const standard = this.getLayerStandard(layer);

    return `Review the ${layer} layer relationship coverage.

Node Types: ${layerMetrics.nodeTypeCount}
Current Relationships: ${layerMetrics.relationshipCount}
Isolation: ${layerMetrics.isolationPercentage}%
Density: ${layerMetrics.relationshipsPerNodeType} per node type
Standard: ${standard}

Evaluate:
1. Semantic coherence of existing relationships
2. Missing critical relationship patterns from ${standard}
3. Prioritized recommendations for relationship additions
4. Balance assessment (are we over/under-specifying?)

Respond with ONLY the following JSON, wrapped in a json code block (no other text before or after):

\`\`\`json
{
  "coherenceIssues": ["description of coherence issue"],
  "missingPatterns": ["description of missing pattern from ${standard}"],
  "recommendations": [
    {
      "sourceNodeType": "${layer}.nodeType",
      "predicate": "predicate-name",
      "destinationNodeType": "${layer}.otherNodeType",
      "justification": "architectural justification",
      "priority": "high"
    }
  ],
  "balanceAssessment": "brief assessment of relationship density and coverage"
}
\`\`\``;
  }

  /**
   * Generate inter-layer gap identification prompt.
   *
   * Identifies cross-layer relationship schemas that are architecturally missing
   * from the spec — schemas that SHOULD exist but DON'T — rather than validating
   * existing ones. Output `violations` entries represent missing schemas;
   * `recommendations` list the concrete spec files to create.
   *
   * @param sourceLayer - The more-abstract (lower-numbered) layer in the pair
   * @param targetLayer - The more-concrete (higher-numbered) layer in the pair
   * @param context - Optional spec context to ground suggestions in real node types
   */
  interLayerValidation(
    sourceLayer: string,
    targetLayer: string,
    context?: InterLayerContext
  ): string {
    // Determine which layer is more concrete (higher-numbered = closer to implementation).
    // The pipeline always passes source=lower-index, target=higher-index, so target
    // is typically the concrete layer. Use context numbers when available.
    const sourceNum = context?.sourceLayerNumber ?? this.getLayerNumber(sourceLayer);
    const targetNum = context?.targetLayerNumber ?? this.getLayerNumber(targetLayer);

    const [concreteLayer, concreteNum, abstractLayer, abstractNum] =
      sourceNum < targetNum
        ? [targetLayer, targetNum, sourceLayer, sourceNum]
        : [sourceLayer, sourceNum, targetLayer, targetNum];

    // Node type sections — use context when available, otherwise fall back to static list
    const concreteTypes =
      context?.concreteNodeTypes?.join(", ") ??
      this.getLayerNodeTypeHint(concreteLayer);
    const abstractTypes =
      context?.abstractNodeTypes?.join(", ") ??
      this.getLayerNodeTypeHint(abstractLayer);

    // Existing-schema section (skip boilerplate when the pair has no prior schemas)
    const existingSection =
      context?.existingSchemas && context.existingSchemas.length > 0
        ? `\n## Schemas Already Defined for This Pair\nDo NOT re-suggest these — they exist:\n${context.existingSchemas.map((s) => `- ${s}`).join("\n")}\n`
        : "";

    // Available predicates section
    const predicateSection =
      context?.availablePredicates && context.availablePredicates.length > 0
        ? `\n## Valid Cross-Layer Predicates\nOnly use predicates from this list:\n${context.availablePredicates.map((p) => `- ${p}`).join("\n")}\n`
        : `\n## Commonly Valid Cross-Layer Predicates\nUse one of: realizes, serves, accesses, uses, references, triggers, monitors, tests, covers, satisfies, implements, depends-on, maps-to, requires\n`;

    return `You are an architecture spec analyst for the Documentation Robotics 12-layer model.

## Task
Identify cross-layer relationship schemas that are MISSING from the spec for the layer pair:
  **${concreteLayer}** (layer ${concreteNum}, more concrete) → **${abstractLayer}** (layer ${abstractNum}, more abstract)

A "missing schema" is a relationship type that:
- Would be meaningfully instantiated in real codebases regularly — not just theoretically possible
- Does NOT yet exist in the spec for this layer pair
- Enables traceability, governance, or cross-cutting concern validation across this boundary
- Follows the correct reference direction: ${concreteLayer} → ${abstractLayer}

## The 12-Layer Model (concrete → abstract)

| # | Layer | Standard | Representative Node Types |
|---|-------|----------|--------------------------|
| 12 | testing | IEEE 829 | testsuite, testcase, testdata, teststrategy, testcoverage |
| 11 | apm | OpenTelemetry | metric, trace, span, alert, dashboard, traceconfiguration |
| 10 | navigation | Router patterns | route, menu, menuitem, breadcrumb, flow, tab |
|  9 | ux | Component patterns | view, subview, librarycomponent, actioncomponent, formcomponent |
|  8 | data-store | DB patterns | database, table, collection, index, view |
|  7 | data-model | JSON Schema | entity, attribute, relationship, enum, type |
|  6 | api | OpenAPI 3.0 | operation, pathitem, requestbody, response, schema, securityscheme |
|  5 | technology | ArchiMate | node, device, systemsoftware, technologyservice, infrastructureservice |
|  4 | application | ArchiMate | applicationcomponent, applicationservice, applicationfunction, applicationinterface |
|  3 | security | NIST SP 800-53 | secureresource, securitypolicy, threat, control, accesscontrol |
|  2 | business | ArchiMate | businessprocess, businessservice, businessfunction, businessrole, businessobject |
|  1 | motivation | ArchiMate | goal, driver, requirement, principle, constraint, outcome, stakeholder |

## Reference Direction Rule
CONCRETE layers (higher numbers, closer to implementation) reference ABSTRACT layers (lower numbers, closer to goals). References flow downward through the stack:
  testing(12) → apm(11) → navigation(10) → ux(9) → data-store(8) → data-model(7) → api(6) → technology(5) → application(4) → security(3) → business(2) → motivation(1)

For this pair, valid schemas define relationships **from ${concreteLayer} node types to ${abstractLayer} node types**.
${existingSection}${predicateSection}
## Node Types in This Pair

**${concreteLayer}** (source of relationships): ${concreteTypes}
**${abstractLayer}** (target of relationships): ${abstractTypes}

## Anti-Noise Criteria
ONLY suggest a schema if ALL of the following hold:
1. A real development team would routinely create instances of this relationship
2. The schema enables meaningful traceability or cross-cutting validation at this layer boundary
3. The source and target node types are semantically compatible (the relationship "makes sense" to a developer)
4. The gap would affect ≥10% of real models containing both layers
5. The relationship is NOT already covered by an existing schema for this pair

Do NOT suggest schemas that are:
- Speculative, aspirational, or "might be useful someday"
- Already covered by existing schemas (listed above)
- In the wrong direction (abstract → concrete references are violations of the model)
- Between node types with no natural semantic connection

## Output Format
Respond with ONLY the following JSON, wrapped in a json code block (no other text before or after):

\`\`\`json
{
  "violations": [
    {
      "sourceLayer": "${concreteLayer}",
      "targetLayer": "${abstractLayer}",
      "issue": "Missing schema: {sourceNodeType}.{predicate}.{targetNodeType} — {one-sentence architectural justification}"
    }
  ],
  "recommendations": [
    "Add spec/schemas/relationships/${concreteLayer}/{sourceNodeType}.{predicate}.{targetNodeType}.relationship.schema.json"
  ]
}
\`\`\`

Rules:
- Each violation entry corresponds to exactly one missing schema
- Each recommendation is the concrete spec file path to create for that schema
- Limit to at most 8 gap suggestions — prefer highest-confidence, highest-impact gaps
- If no schemas are architecturally missing, return: { "violations": [], "recommendations": [] }`;
  }

  /**
   * Get the canonical layer number (1–12) for a layer name.
   * Returns 0 if the layer name is unrecognized.
   */
  private getLayerNumber(layer: string): number {
    const order = [
      "motivation",
      "business",
      "security",
      "application",
      "technology",
      "api",
      "data-model",
      "data-store",
      "ux",
      "navigation",
      "apm",
      "testing",
    ];
    const idx = order.indexOf(layer);
    return idx >= 0 ? idx + 1 : 0;
  }

  /**
   * Get a representative hint string for the node types in a layer.
   * Used as a fallback when context.concreteNodeTypes / context.abstractNodeTypes
   * are not provided by the caller.
   */
  private getLayerNodeTypeHint(layer: string): string {
    const hints: Record<string, string> = {
      motivation: "goal, driver, requirement, principle, constraint, outcome, stakeholder",
      business:
        "businessprocess, businessservice, businessfunction, businessrole, businessobject, businessactor, product",
      security: "secureresource, securitypolicy, threat, control, accesscontrol, identitysubject",
      application:
        "applicationcomponent, applicationservice, applicationfunction, applicationinterface, applicationevent",
      technology:
        "node, device, systemsoftware, technologyservice, technologyfunction, infrastructureservice",
      api: "openapidocument, pathitem, operation, requestbody, response, schema, securityscheme, server, ratelimit",
      "data-model": "entity, attribute, relationship, enum, type",
      "data-store": "database, table, collection, index, view",
      ux: "view, subview, librarycomponent, actioncomponent, formcomponent, contentcomponent, loadingstate, modal",
      navigation: "route, menu, menuitem, breadcrumb, flow, tab",
      apm: "metric, trace, span, alert, dashboard, traceconfiguration, logsource, sdkconfig",
      testing: "testsuite, testcase, testdata, teststrategy, testcoverage",
    };
    return hints[layer] ?? "see layer spec for node types";
  }

  /**
   * Get the standard/framework for a layer
   */
  getLayerStandard(layer: string): string {
    const standards: Record<string, string> = {
      motivation: "ArchiMate 3.2",
      business: "ArchiMate 3.2",
      security: "NIST SP 800-53",
      application: "ArchiMate 3.2",
      technology: "ArchiMate 3.2",
      api: "OpenAPI 3.0",
      "data-model": "JSON Schema Draft 7",
      "data-store": "Database patterns",
      ux: "React/Component patterns",
      navigation: "Router patterns",
      apm: "OpenTelemetry",
      testing: "Test patterns",
    };
    return standards[layer] || "Architecture best practices";
  }

  /**
   * Get target relationship range for a node type
   *
   * Returns a static range "2-5" for all types. This is intentionally
   * simplified for AI prompts to avoid over-constraining suggestions.
   * Type-specific refinement could be added in the future if needed,
   * but the current approach works well for generating diverse recommendations.
   */
  private getTargetRange(): string {
    // Default target based on common patterns across all types
    return "2-5";
  }

  /**
   * Get predicate definition/description
   *
   * NOTE: These predicate definitions are intentionally a curated subset
   * rather than being loaded from the full relationship catalog. This is
   * by design to keep AI prompts focused on the most common and important
   * relationships. The full catalog has 252 relationship types which would
   * overwhelm the AI context window and reduce prompt clarity.
   */
  private getPredicateDefinition(predicate: string): string {
    // Curated predicate definitions (subset of relationship catalog)
    const definitions: Record<string, string> = {
      realizes: "Realization relationship - implements or fulfills",
      serves: "Serving relationship - provides service to",
      accesses: "Access relationship - reads/writes data",
      triggers: "Triggering relationship - initiates or causes",
      influences: "Influence relationship - affects or impacts",
      uses: "Usage relationship - employs or utilizes",
      composes: "Composition relationship - structural part-of",
      aggregates: "Aggregation relationship - logical grouping",
      specializes: "Specialization relationship - is-a subtype of",
      assigns: "Assignment relationship - allocates responsibility",
      flows: "Flow relationship - information or control transfer",
    };

    return definitions[predicate] || "Relationship between elements";
  }
}
