import { describe, it, expect } from "bun:test";
import { ResponseParser } from "../../../../src/audit/relationships/ai/parser.js";

describe("ResponseParser", () => {
  const parser = new ResponseParser();

  describe("parseElementRecommendations", () => {
    it("should parse well-formed JSON array in code block", () => {
      const response = `Here are the recommendations:

\`\`\`json
[
  {
    "sourceNodeType": "motivation.goal.customer-satisfaction",
    "predicate": "realizes",
    "destinationNodeType": "motivation.requirement.high-availability",
    "justification": "Customer satisfaction depends on system availability",
    "priority": "high",
    "standardReference": "ArchiMate 3.2 Motivation Layer"
  }
]
\`\`\`

These recommendations follow ArchiMate patterns.`;

      const recommendations = parser.parseElementRecommendations(response);

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]).toEqual({
        sourceNodeType: "motivation.goal.customer-satisfaction",
        predicate: "realizes",
        destinationNodeType: "motivation.requirement.high-availability",
        justification: "Customer satisfaction depends on system availability",
        priority: "high",
        standardReference: "ArchiMate 3.2 Motivation Layer",
        impactScore: 85,
        alignmentScore: 15,
      });
    });

    it("should parse raw JSON array without code block", () => {
      const response = `[{"sourceNodeType":"api.endpoint.create-order","predicate":"accesses","destinationNodeType":"api.endpoint.validate-payment","justification":"Order creation requires payment validation","priority":"medium"}]`;

      const recommendations = parser.parseElementRecommendations(response);

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].sourceNodeType).toBe("api.endpoint.create-order");
      expect(recommendations[0].predicate).toBe("accesses");
    });

    it("should normalize field names (source -> sourceNodeType)", () => {
      const response = `\`\`\`json
[
  {
    "source": "security.threat.sql-injection",
    "predicate": "influences",
    "destination": "security.control.input-validation",
    "reason": "Input validation mitigates SQL injection threat",
    "priority": "high"
  }
]
\`\`\``;

      const recommendations = parser.parseElementRecommendations(response);

      expect(recommendations[0].sourceNodeType).toBe("security.threat.sql-injection");
      expect(recommendations[0].destinationNodeType).toBe(
        "security.control.input-validation"
      );
      expect(recommendations[0].justification).toBe(
        "Input validation mitigates SQL injection threat"
      );
    });

    it("should default priority to medium if not provided", () => {
      const response = `[{"sourceNodeType":"test","predicate":"uses","destinationNodeType":"test2","justification":"Test"}]`;

      const recommendations = parser.parseElementRecommendations(response);

      expect(recommendations[0].priority).toBe("medium");
      expect(recommendations[0].impactScore).toBe(55);
      expect(recommendations[0].alignmentScore).toBe(45);
    });

    it("should compute correct scores for medium and low priority", () => {
      const response = `[
        {"sourceNodeType":"a","predicate":"uses","destinationNodeType":"b","justification":"J","priority":"medium"},
        {"sourceNodeType":"c","predicate":"uses","destinationNodeType":"d","justification":"J","priority":"low"}
      ]`;

      const recommendations = parser.parseElementRecommendations(response);

      expect(recommendations[0].impactScore).toBe(55);
      expect(recommendations[0].alignmentScore).toBe(45);
      expect(recommendations[1].impactScore).toBe(25);
      expect(recommendations[1].alignmentScore).toBe(75);
    });

    it("should throw error if no JSON found in response", () => {
      const response = "This is just text with no JSON";

      expect(() => parser.parseElementRecommendations(response)).toThrow(
        "Failed to extract JSON from AI response"
      );
    });

    it("should throw error if JSON is malformed", () => {
      const response = `\`\`\`json
[{invalid json}]
\`\`\``;

      expect(() => parser.parseElementRecommendations(response)).toThrow(
        "Failed to parse JSON from AI response"
      );
    });

    it("should throw error if result is not an array", () => {
      const response = `\`\`\`json
{"not": "an array"}
\`\`\``;

      expect(() => parser.parseElementRecommendations(response)).toThrow(
        "Expected JSON array of recommendations"
      );
    });

    it("should validate required fields and throw descriptive errors", () => {
      const missingPredicate = `[{"sourceNodeType":"test","destinationNodeType":"test2","justification":"Test"}]`;
      expect(() => parser.parseElementRecommendations(missingPredicate)).toThrow(
        "missing or invalid required field: predicate"
      );

      const missingSource = `[{"predicate":"uses","destinationNodeType":"test2","justification":"Test"}]`;
      expect(() => parser.parseElementRecommendations(missingSource)).toThrow(
        "missing or invalid required field: sourceNodeType or source"
      );

      const missingDestination = `[{"sourceNodeType":"test","predicate":"uses","justification":"Test"}]`;
      expect(() => parser.parseElementRecommendations(missingDestination)).toThrow(
        "missing or invalid required field: destinationNodeType or destination"
      );

      const missingJustification = `[{"sourceNodeType":"test","predicate":"uses","destinationNodeType":"test2"}]`;
      expect(() => parser.parseElementRecommendations(missingJustification)).toThrow(
        "missing or invalid required field: justification or reason"
      );
    });
  });

  describe("parseLayerReview", () => {
    it("should parse well-formed layer review JSON", () => {
      const response = `\`\`\`json
{
  "coherenceIssues": ["Missing relationships between goals and requirements"],
  "missingPatterns": ["ArchiMate realization pattern not fully implemented"],
  "recommendations": [
    {
      "sourceNodeType": "motivation.goal.test",
      "predicate": "realizes",
      "destinationNodeType": "motivation.requirement.test",
      "justification": "Test",
      "priority": "high"
    }
  ],
  "balanceAssessment": "Layer is under-specified with only 5 relationships"
}
\`\`\``;

      const review = parser.parseLayerReview(response);

      expect(review.coherenceIssues).toHaveLength(1);
      expect(review.missingPatterns).toHaveLength(1);
      expect(review.recommendations).toHaveLength(1);
      expect(review.balanceAssessment).toContain("under-specified");
    });

    it("should normalize snake_case field names", () => {
      const response = `\`\`\`json
{
  "coherence_issues": ["Issue 1"],
  "missing_patterns": ["Pattern 1"],
  "recommendations": [],
  "balance_assessment": "Balanced"
}
\`\`\``;

      const review = parser.parseLayerReview(response);

      expect(review.coherenceIssues).toEqual(["Issue 1"]);
      expect(review.missingPatterns).toEqual(["Pattern 1"]);
      expect(review.balanceAssessment).toBe("Balanced");
    });

    it("should throw error for missing required fields", () => {
      const missingCoherence = `{"missing_patterns":[],"recommendations":[],"balance_assessment":"test"}`;
      expect(() => parser.parseLayerReview(missingCoherence)).toThrow(
        "missing or invalid required field: coherenceIssues"
      );

      const missingPatterns = `{"coherence_issues":[],"recommendations":[],"balance_assessment":"test"}`;
      expect(() => parser.parseLayerReview(missingPatterns)).toThrow(
        "missing or invalid required field: missingPatterns"
      );

      const missingRecommendations = `{"coherence_issues":[],"missing_patterns":[],"balance_assessment":"test"}`;
      expect(() => parser.parseLayerReview(missingRecommendations)).toThrow(
        "missing or invalid required field: recommendations"
      );

      const missingBalance = `{"coherence_issues":[],"missing_patterns":[],"recommendations":[]}`;
      expect(() => parser.parseLayerReview(missingBalance)).toThrow(
        "missing or invalid required field: balanceAssessment"
      );
    });

    it("should throw error if no JSON found", () => {
      expect(() => parser.parseLayerReview("No JSON here")).toThrow(
        "Failed to extract JSON from layer review"
      );
    });
  });

  describe("parseInterLayerValidation", () => {
    it("should parse well-formed inter-layer validation JSON", () => {
      const response = `\`\`\`json
{
  "violations": [
    {
      "sourceLayer": "technology",
      "targetLayer": "application",
      "issue": "Lower layer referencing higher layer (violates architecture rule)"
    }
  ],
  "recommendations": [
    "Reverse the reference direction to comply with layer hierarchy"
  ]
}
\`\`\``;

      const validation = parser.parseInterLayerValidation(response);

      expect(validation.violations).toHaveLength(1);
      expect(validation.violations[0].sourceLayer).toBe("technology");
      expect(validation.violations[0].targetLayer).toBe("application");
      expect(validation.recommendations).toHaveLength(1);
    });

    it("should handle empty violations and recommendations", () => {
      const response = `{"violations":[],"recommendations":[]}`;

      const validation = parser.parseInterLayerValidation(response);

      expect(validation.violations).toEqual([]);
      expect(validation.recommendations).toEqual([]);
    });

    it("should throw error if no JSON found", () => {
      expect(() => parser.parseInterLayerValidation("No JSON")).toThrow(
        "Failed to extract JSON from inter-layer validation"
      );
    });

    it("should throw error for malformed JSON", () => {
      const response = `\`\`\`json
{invalid}
\`\`\``;

      expect(() => parser.parseInterLayerValidation(response)).toThrow(
        "Failed to parse JSON from inter-layer validation"
      );
    });
  });
});
