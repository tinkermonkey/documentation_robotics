export interface RelationshipRecommendation {
  sourceNodeType: string;
  predicate: string;
  destinationNodeType: string;
  justification: string;
  priority: "high" | "medium" | "low";
  standardReference?: string;
}

export interface LayerReview {
  coherenceIssues: string[];
  missingPatterns: string[];
  recommendations: RelationshipRecommendation[];
  balanceAssessment: string;
}

export interface InterLayerValidation {
  violations: Array<{
    sourceLayer: string;
    targetLayer: string;
    issue: string;
  }>;
  recommendations: string[];
}

export class ResponseParser {
  /**
   * Parse element evaluation recommendations from Claude response
   */
  parseElementRecommendations(response: string): RelationshipRecommendation[] {
    // Extract JSON from Claude response
    const jsonMatch =
      response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      throw new Error(
        "Failed to extract JSON from AI response. Expected JSON array in code block or raw JSON array."
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let recommendations: any[];

    try {
      recommendations = JSON.parse(jsonString);
    } catch (error: any) {
      throw new Error(`Failed to parse JSON from AI response: ${error.message}`);
    }

    if (!Array.isArray(recommendations)) {
      throw new Error("Expected JSON array of recommendations from AI response");
    }

    // Validate structure and normalize field names
    return recommendations.map((r: any, index: number) => {
      if (!r.predicate) {
        throw new Error(
          `Recommendation at index ${index} missing required field: predicate`
        );
      }
      if (!r.sourceNodeType && !r.source) {
        throw new Error(
          `Recommendation at index ${index} missing required field: sourceNodeType or source`
        );
      }
      if (!r.destinationNodeType && !r.destination) {
        throw new Error(
          `Recommendation at index ${index} missing required field: destinationNodeType or destination`
        );
      }
      if (!r.justification && !r.reason) {
        throw new Error(
          `Recommendation at index ${index} missing required field: justification or reason`
        );
      }

      return {
        sourceNodeType: r.sourceNodeType || r.source,
        predicate: r.predicate,
        destinationNodeType: r.destinationNodeType || r.destination,
        justification: r.justification || r.reason,
        priority: r.priority || "medium",
        standardReference: r.standardReference,
      };
    });
  }

  /**
   * Parse layer review from Claude response
   */
  parseLayerReview(response: string): LayerReview {
    const jsonMatch =
      response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error(
        "Failed to extract JSON from layer review. Expected JSON object in code block or raw JSON object."
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let review: any;

    try {
      review = JSON.parse(jsonString);
    } catch (error: any) {
      throw new Error(`Failed to parse JSON from layer review: ${error.message}`);
    }

    // Validate required fields
    if (!review.coherenceIssues && !review.coherence_issues) {
      throw new Error("Layer review missing required field: coherenceIssues");
    }
    if (!review.missingPatterns && !review.missing_patterns) {
      throw new Error("Layer review missing required field: missingPatterns");
    }
    if (!review.recommendations) {
      throw new Error("Layer review missing required field: recommendations");
    }
    if (!review.balanceAssessment && !review.balance_assessment) {
      throw new Error("Layer review missing required field: balanceAssessment");
    }

    return {
      coherenceIssues: review.coherenceIssues || review.coherence_issues || [],
      missingPatterns: review.missingPatterns || review.missing_patterns || [],
      recommendations: review.recommendations || [],
      balanceAssessment:
        review.balanceAssessment || review.balance_assessment || "",
    };
  }

  /**
   * Parse inter-layer validation from Claude response
   */
  parseInterLayerValidation(response: string): InterLayerValidation {
    const jsonMatch =
      response.match(/```json\n([\s\S]*?)\n```/) || response.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error(
        "Failed to extract JSON from inter-layer validation. Expected JSON object in code block or raw JSON object."
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let validation: any;

    try {
      validation = JSON.parse(jsonString);
    } catch (error: any) {
      throw new Error(
        `Failed to parse JSON from inter-layer validation: ${error.message}`
      );
    }

    return {
      violations: validation.violations || [],
      recommendations: validation.recommendations || [],
    };
  }
}
