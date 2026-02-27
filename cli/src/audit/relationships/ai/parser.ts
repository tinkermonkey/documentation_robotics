import { recommendationImpactScore } from "../../types.js";
import { getErrorMessage } from "../../../utils/errors.js";

export interface RelationshipRecommendation {
  sourceNodeType: string;
  predicate: string;
  destinationNodeType: string;
  justification: string;
  priority: "high" | "medium" | "low";
  standardReference?: string;
  /** How necessary this recommendation is (0–100). Derived from priority. */
  impactScore: number;
  /** 100 - impactScore; aligns with NodeAIEvaluation.alignmentScore semantics */
  alignmentScore: number;
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
      const truncated = response.substring(0, 200);
      throw new Error(
        `Failed to extract JSON from AI response. Expected JSON array in code block or raw JSON array.\nReceived: ${truncated}${response.length > 200 ? "..." : ""}`
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let recommendations: unknown;

    try {
      recommendations = JSON.parse(jsonString);
    } catch (error: unknown) {
      const truncated = jsonString.substring(0, 200);
      throw new Error(
        `Failed to parse JSON from AI response: ${getErrorMessage(error)}\nReceived: ${truncated}${jsonString.length > 200 ? "..." : ""}`
      );
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

      const resolvedPriority = (priority as "high" | "medium" | "low") || "medium";
      const impactScore = recommendationImpactScore(resolvedPriority);
      return {
        sourceNodeType,
        predicate: rec.predicate,
        destinationNodeType,
        justification,
        priority: resolvedPriority,
        standardReference: typeof standardReference === "string" ? standardReference : undefined,
        impactScore,
        alignmentScore: 100 - impactScore,
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
      const truncated = response.substring(0, 200);
      throw new Error(
        `Failed to extract JSON from layer review. Expected JSON object in code block or raw JSON object.\nReceived: ${truncated}${response.length > 200 ? "..." : ""}`
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let review: unknown;

    try {
      review = JSON.parse(jsonString);
    } catch (error: unknown) {
      const truncated = jsonString.substring(0, 200);
      throw new Error(
        `Failed to parse JSON from layer review: ${getErrorMessage(error)}\nReceived: ${truncated}${jsonString.length > 200 ? "..." : ""}`
      );
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

    // Validate each recommendation in the array with per-element structural validation
    const validatedRecommendations = recommendations.map((r: unknown, index: number) => {
      // Type narrowing: ensure r is an object
      if (typeof r !== "object" || r === null) {
        throw new Error(`Recommendation at index ${index} in layer review is not a valid object`);
      }

      const rec = r as Record<string, unknown>;

      // Validate and extract required fields with type guards (matching parseElementRecommendations)
      if (!rec.predicate || typeof rec.predicate !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review missing or invalid required field: predicate (must be string)`
        );
      }

      const sourceNodeType = rec.sourceNodeType || rec.source;
      if (!sourceNodeType || typeof sourceNodeType !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review missing or invalid required field: sourceNodeType or source (must be string)`
        );
      }

      const destinationNodeType = rec.destinationNodeType || rec.destination;
      if (!destinationNodeType || typeof destinationNodeType !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review missing or invalid required field: destinationNodeType or destination (must be string)`
        );
      }

      const justification = rec.justification || rec.reason;
      if (!justification || typeof justification !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review missing or invalid required field: justification or reason (must be string)`
        );
      }

      const priority = rec.priority;
      if (priority && typeof priority !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review has invalid priority field (must be string)`
        );
      }

      const standardReference = rec.standardReference;
      if (standardReference !== undefined && typeof standardReference !== "string") {
        throw new Error(
          `Recommendation at index ${index} in layer review has invalid standardReference field (must be string)`
        );
      }

      const resolvedPriority = (priority as "high" | "medium" | "low") || "medium";
      const impactScore = recommendationImpactScore(resolvedPriority);
      return {
        sourceNodeType,
        predicate: rec.predicate,
        destinationNodeType,
        justification,
        priority: resolvedPriority,
        standardReference: typeof standardReference === "string" ? standardReference : undefined,
        impactScore,
        alignmentScore: 100 - impactScore,
      };
    });

    const balanceAssessment = reviewObj.balanceAssessment || reviewObj.balance_assessment;
    if (!balanceAssessment || typeof balanceAssessment !== "string") {
      throw new Error("Layer review missing or invalid required field: balanceAssessment (must be string)");
    }

    return {
      coherenceIssues,
      missingPatterns,
      recommendations: validatedRecommendations,
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
      const truncated = response.substring(0, 200);
      throw new Error(
        `Failed to extract JSON from inter-layer validation. Expected JSON object in code block or raw JSON object.\nReceived: ${truncated}${response.length > 200 ? "..." : ""}`
      );
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    let validation: unknown;

    try {
      validation = JSON.parse(jsonString);
    } catch (error: unknown) {
      const truncated = jsonString.substring(0, 200);
      throw new Error(
        `Failed to parse JSON from inter-layer validation: ${getErrorMessage(error)}\nReceived: ${truncated}${jsonString.length > 200 ? "..." : ""}`
      );
    }

    // Type narrowing: ensure validation is an object
    if (typeof validation !== "object" || validation === null) {
      throw new Error("Inter-layer validation response is not a valid object");
    }

    const validationObj = validation as Record<string, unknown>;

    // Normalize top-level violations key (Claude may use alternate key names)
    const violations =
      validationObj.violations ||
      validationObj.hierarchy_violations ||
      validationObj.cross_layer_violations ||
      validationObj.layer_violations;
    if (!violations || !Array.isArray(violations)) {
      throw new Error("Inter-layer validation missing or invalid required field: violations (must be array)");
    }

    // Validate each violation object with field normalization
    const validatedViolations = violations.map((v: unknown, index: number) => {
      if (typeof v !== "object" || v === null) {
        throw new Error(`Violation at index ${index} is not a valid object`);
      }
      const violation = v as Record<string, unknown>;

      // Normalize sourceLayer: accepts sourceLayer, source.layer, source_layer, from
      const rawSource = violation.source;
      const sourceLayer =
        violation.sourceLayer ||
        (typeof rawSource === "object" && rawSource !== null
          ? (rawSource as Record<string, unknown>).layer
          : undefined) ||
        violation.source_layer ||
        violation.from;
      if (!sourceLayer || typeof sourceLayer !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: sourceLayer (must be string)`);
      }

      // Normalize targetLayer: accepts targetLayer, destination.layer, target.layer, target_layer, to
      const rawDest = violation.destination;
      const targetLayer =
        violation.targetLayer ||
        (typeof rawDest === "object" && rawDest !== null
          ? (rawDest as Record<string, unknown>).layer
          : undefined) ||
        violation.target_layer ||
        violation.to;
      if (!targetLayer || typeof targetLayer !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: targetLayer (must be string)`);
      }

      // Normalize issue: accepts issue, violation, description, message, problem
      const issue =
        violation.issue ||
        violation.violation ||
        violation.description ||
        violation.message ||
        violation.problem;
      if (!issue || typeof issue !== "string") {
        throw new Error(`Violation at index ${index} missing or invalid field: issue (must be string)`);
      }

      return {
        sourceLayer: sourceLayer as string,
        targetLayer: targetLayer as string,
        issue: issue as string,
      };
    });

    // Normalize recommendations: accept string[] or object[]{action, description}
    const rawRecs = validationObj.recommendations;
    if (!rawRecs || !Array.isArray(rawRecs)) {
      throw new Error("Inter-layer validation missing or invalid required field: recommendations (must be array)");
    }
    const recommendations = rawRecs.map((r: unknown) => {
      if (typeof r === "string") return r;
      if (typeof r === "object" && r !== null) {
        const obj = r as Record<string, unknown>;
        return String(obj.action || obj.description || JSON.stringify(r));
      }
      return String(r);
    });

    return {
      violations: validatedViolations,
      recommendations,
    };
  }
}
