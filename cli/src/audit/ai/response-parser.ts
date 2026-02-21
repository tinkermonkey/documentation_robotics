import { getErrorMessage } from "../../utils/errors.js";

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
    let recommendations: unknown;

    try {
      recommendations = JSON.parse(jsonString);
    } catch (error: unknown) {
      throw new Error(`Failed to parse JSON from AI response: ${getErrorMessage(error)}`);
    }

    if (!Array.isArray(recommendations)) {
      throw new Error("Expected JSON array of recommendations from AI response");
    }

    // Validate structure and normalize field names
    return recommendations.map((r: unknown, index: number) => {
      // Type narrowing: ensure r is an object
      if (typeof r !== "object" || r === null) {
        throw new Error(`Recommendation at index ${index} is not a valid object`);
      }

      const rec = r as Record<string, unknown>;
      if (!rec.predicate) {
        throw new Error(
          `Recommendation at index ${index} missing required field: predicate`
        );
      }
      if (!rec.sourceNodeType && !rec.source) {
        throw new Error(
          `Recommendation at index ${index} missing required field: sourceNodeType or source`
        );
      }
      if (!rec.destinationNodeType && !rec.destination) {
        throw new Error(
          `Recommendation at index ${index} missing required field: destinationNodeType or destination`
        );
      }
      if (!rec.justification && !rec.reason) {
        throw new Error(
          `Recommendation at index ${index} missing required field: justification or reason`
        );
      }

      return {
        sourceNodeType: (rec.sourceNodeType || rec.source) as string,
        predicate: rec.predicate as string,
        destinationNodeType: (rec.destinationNodeType || rec.destination) as string,
        justification: (rec.justification || rec.reason) as string,
        priority: (rec.priority as "high" | "medium" | "low") || "medium",
        standardReference: rec.standardReference as string | undefined,
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
    let review: unknown;

    try {
      review = JSON.parse(jsonString);
    } catch (error: unknown) {
      throw new Error(`Failed to parse JSON from layer review: ${getErrorMessage(error)}`);
    }

    // Type narrowing: ensure review is an object
    if (typeof review !== "object" || review === null) {
      throw new Error("Layer review response is not a valid object");
    }

    const reviewObj = review as Record<string, unknown>;

    // Validate required fields
    if (!reviewObj.coherenceIssues && !reviewObj.coherence_issues) {
      throw new Error("Layer review missing required field: coherenceIssues");
    }
    if (!reviewObj.missingPatterns && !reviewObj.missing_patterns) {
      throw new Error("Layer review missing required field: missingPatterns");
    }
    if (!reviewObj.recommendations) {
      throw new Error("Layer review missing required field: recommendations");
    }
    if (!reviewObj.balanceAssessment && !reviewObj.balance_assessment) {
      throw new Error("Layer review missing required field: balanceAssessment");
    }

    return {
      coherenceIssues: (reviewObj.coherenceIssues || reviewObj.coherence_issues || []) as string[],
      missingPatterns: (reviewObj.missingPatterns || reviewObj.missing_patterns || []) as string[],
      recommendations: (reviewObj.recommendations || []) as RelationshipRecommendation[],
      balanceAssessment:
        (reviewObj.balanceAssessment || reviewObj.balance_assessment || "") as string,
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
    let validation: unknown;

    try {
      validation = JSON.parse(jsonString);
    } catch (error: unknown) {
      throw new Error(
        `Failed to parse JSON from inter-layer validation: ${getErrorMessage(error)}`
      );
    }

    // Type narrowing: ensure validation is an object
    if (typeof validation !== "object" || validation === null) {
      throw new Error("Inter-layer validation response is not a valid object");
    }

    const validationObj = validation as Record<string, unknown>;

    // Validate required fields
    if (!validationObj.violations) {
      throw new Error("Inter-layer validation missing required field: violations");
    }
    if (!validationObj.recommendations) {
      throw new Error("Inter-layer validation missing required field: recommendations");
    }

    return {
      violations: validationObj.violations as Array<{
        sourceLayer: string;
        targetLayer: string;
        issue: string;
      }>,
      recommendations: validationObj.recommendations as string[],
    };
  }
}
