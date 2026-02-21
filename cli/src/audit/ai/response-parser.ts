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

      // Validate and extract required fields with type guards
      if (!rec.predicate || typeof rec.predicate !== "string") {
        throw new Error(
          `Recommendation at index ${index} missing or invalid required field: predicate (must be string)`
        );
      }

      const sourceNodeType = rec.sourceNodeType || rec.source;
      if (!sourceNodeType || typeof sourceNodeType !== "string") {
        throw new Error(
          `Recommendation at index ${index} missing or invalid required field: sourceNodeType or source (must be string)`
        );
      }

      const destinationNodeType = rec.destinationNodeType || rec.destination;
      if (!destinationNodeType || typeof destinationNodeType !== "string") {
        throw new Error(
          `Recommendation at index ${index} missing or invalid required field: destinationNodeType or destination (must be string)`
        );
      }

      const justification = rec.justification || rec.reason;
      if (!justification || typeof justification !== "string") {
        throw new Error(
          `Recommendation at index ${index} missing or invalid required field: justification or reason (must be string)`
        );
      }

      const priority = rec.priority;
      if (priority && typeof priority !== "string") {
        throw new Error(
          `Recommendation at index ${index} has invalid priority field (must be string)`
        );
      }

      const standardReference = rec.standardReference;
      if (standardReference !== undefined && typeof standardReference !== "string") {
        throw new Error(
          `Recommendation at index ${index} has invalid standardReference field (must be string)`
        );
      }

      return {
        sourceNodeType,
        predicate: rec.predicate,
        destinationNodeType,
        justification,
        priority: (priority as "high" | "medium" | "low") || "medium",
        standardReference: typeof standardReference === "string" ? standardReference : undefined,
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

    // Validate and extract required fields with type guards
    const coherenceIssues = reviewObj.coherenceIssues || reviewObj.coherence_issues;
    if (!coherenceIssues || !Array.isArray(coherenceIssues)) {
      throw new Error("Layer review missing or invalid required field: coherenceIssues (must be array)");
    }
    if (!coherenceIssues.every((item) => typeof item === "string")) {
      throw new Error("Layer review coherenceIssues must contain only strings");
    }

    const missingPatterns = reviewObj.missingPatterns || reviewObj.missing_patterns;
    if (!missingPatterns || !Array.isArray(missingPatterns)) {
      throw new Error("Layer review missing or invalid required field: missingPatterns (must be array)");
    }
    if (!missingPatterns.every((item) => typeof item === "string")) {
      throw new Error("Layer review missingPatterns must contain only strings");
    }

    const recommendations = reviewObj.recommendations;
    if (!recommendations || !Array.isArray(recommendations)) {
      throw new Error("Layer review missing or invalid required field: recommendations (must be array)");
    }

    const balanceAssessment = reviewObj.balanceAssessment || reviewObj.balance_assessment;
    if (!balanceAssessment || typeof balanceAssessment !== "string") {
      throw new Error("Layer review missing or invalid required field: balanceAssessment (must be string)");
    }

    return {
      coherenceIssues,
      missingPatterns,
      recommendations: recommendations as RelationshipRecommendation[],
      balanceAssessment,
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

    // Validate violations field
    const violations = validationObj.violations;
    if (!violations || !Array.isArray(violations)) {
      throw new Error("Inter-layer validation missing or invalid required field: violations (must be array)");
    }

    // Validate each violation object
    const validatedViolations = violations.map((v: unknown, index: number) => {
      if (typeof v !== "object" || v === null) {
        throw new Error(`Violation at index ${index} is not a valid object`);
      }
      const violation = v as Record<string, unknown>;

      if (!violation.sourceLayer || typeof violation.sourceLayer !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: sourceLayer (must be string)`);
      }
      if (!violation.targetLayer || typeof violation.targetLayer !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: targetLayer (must be string)`);
      }
      if (!violation.issue || typeof violation.issue !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: issue (must be string)`);
      }

      return {
        sourceLayer: violation.sourceLayer,
        targetLayer: violation.targetLayer,
        issue: violation.issue,
      };
    });

    // Validate recommendations field
    const recommendations = validationObj.recommendations;
    if (!recommendations || !Array.isArray(recommendations)) {
      throw new Error("Inter-layer validation missing or invalid required field: recommendations (must be array)");
    }
    if (!recommendations.every((item) => typeof item === "string")) {
      throw new Error("Inter-layer validation recommendations must contain only strings");
    }

    return {
      violations: validatedViolations,
      recommendations,
    };
  }
}
