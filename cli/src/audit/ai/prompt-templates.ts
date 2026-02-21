import type { CoverageMetrics } from "../types.js";

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

Provide structured recommendations as JSON.`;
  }

  /**
   * Generate inter-layer validation prompt
   */
  interLayerValidation(sourceLayer: string, targetLayer: string): string {
    return `Validate cross-layer relationships from ${sourceLayer} to ${targetLayer}.

Architecture Rule: Higher layers → lower layers only

Verify:
1. All references respect layer hierarchy
2. No circular dependencies
3. Reference relationships are architecturally meaningful

Report violations and recommendations as JSON.`;
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
