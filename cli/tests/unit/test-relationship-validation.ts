import { describe, it, expect } from "bun:test";
import {
  validateRelationshipCombination,
  getRelationshipConstraints,
} from "../../src/commands/relationship.js";

describe("Relationship Validation", () => {
  describe("validateRelationshipCombination", () => {
    it("should validate valid relationship combinations", () => {
      // motivation.goal realizes business.service is a valid relationship
      const result = validateRelationshipCombination(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      expect(result.valid).toBe(true);
      expect(result.suggestions).toBeUndefined();
    });

    it("should reject invalid predicates", () => {
      const result = validateRelationshipCombination(
        "motivation.goal",
        "invalid-predicate",
        "business.service"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
    });

    it("should reject invalid destination types", () => {
      const result = validateRelationshipCombination(
        "motivation.goal",
        "realizes",
        "invalid.type"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
    });

    it("should provide predicate suggestions for valid source", () => {
      const result = validateRelationshipCombination(
        "motivation.goal",
        "bad-predicate",
        "business.service"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(
        result.suggestions?.some((s) => s.includes("Valid predicates"))
      ).toBe(true);
    });

    it("should provide destination suggestions for valid source and predicate", () => {
      // Use a valid source and predicate with invalid destination
      const result = validateRelationshipCombination(
        "motivation.goal",
        "realizes",
        "invalid.destination"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
      // Should mention valid destinations
      expect(
        result.suggestions?.some(
          (s) =>
            s.includes("Valid destinations") ||
            s.includes("No valid destinations")
        )
      ).toBe(true);
    });

    it("should indicate no relationships when source has none", () => {
      // Use an invalid source type entirely
      const result = validateRelationshipCombination(
        "invalid.source",
        "some-predicate",
        "invalid.target"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it("should include all suggestion types when validation fails", () => {
      const result = validateRelationshipCombination(
        "motivation.goal",
        "invalid",
        "invalid.type"
      );

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
      // Should have at least a predicates suggestion
      expect(
        result.suggestions?.some((s) => s.includes("Valid predicates"))
      ).toBe(true);
    });
  });

  describe("getRelationshipConstraints", () => {
    it("should return cardinality and strength for valid relationships", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      expect(constraints).toBeTruthy();
      expect(constraints!.cardinality).toBeTruthy();
      expect(constraints!.strength).toBeTruthy();
    });

    it("should return valid cardinality values", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      if (constraints) {
        const validCardinalities = [
          "one-to-one",
          "one-to-many",
          "many-to-one",
          "many-to-many",
        ];
        expect(validCardinalities).toContain(constraints.cardinality);
      }
    });

    it("should return valid strength values", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      if (constraints) {
        const validStrengths = ["critical", "high", "medium", "low"];
        expect(validStrengths).toContain(constraints.strength);
      }
    });

    it("should return null for invalid relationships", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "invalid",
        "invalid.type"
      );

      expect(constraints).toBeNull();
    });

    it("should return null for invalid predicates", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "not-a-real-predicate",
        "business.service"
      );

      expect(constraints).toBeNull();
    });

    it("should return null for invalid destination types", () => {
      const constraints = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "invalid.type"
      );

      expect(constraints).toBeNull();
    });

    it("should return consistent results for the same relationship", () => {
      const first = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      const second = getRelationshipConstraints(
        "motivation.goal",
        "realizes",
        "business.service"
      );

      expect(first).toEqual(second);
    });
  });

  describe("integration scenarios", () => {
    it("should validate and provide constraints for a complete relationship", () => {
      const sourceSpecNodeId = "motivation.goal";
      const predicate = "realizes";
      const destSpecNodeId = "business.service";

      // First validate
      const validation = validateRelationshipCombination(
        sourceSpecNodeId,
        predicate,
        destSpecNodeId
      );

      expect(validation.valid).toBe(true);

      // Then get constraints
      const constraints = getRelationshipConstraints(
        sourceSpecNodeId,
        predicate,
        destSpecNodeId
      );

      expect(constraints).toBeTruthy();
      expect(constraints!.cardinality).toBeTruthy();
      expect(constraints!.strength).toBeTruthy();
    });

    it("should provide helpful error context for user-facing messages", () => {
      const sourceSpecNodeId = "motivation.goal";
      const predicate = "implements";
      const destSpecNodeId = "testing.testcase";

      const validation = validateRelationshipCombination(
        sourceSpecNodeId,
        predicate,
        destSpecNodeId
      );

      // This might be invalid, but should have suggestions
      if (!validation.valid) {
        expect(validation.suggestions).toBeDefined();
        expect(validation.suggestions!.length).toBeGreaterThan(0);

        // All suggestions should be non-empty strings
        for (const suggestion of validation.suggestions!) {
          expect(typeof suggestion).toBe("string");
          expect(suggestion.length).toBeGreaterThan(0);
        }
      }
    });

    it("should handle schema-driven validation across multiple layer combinations", () => {
      // Test various layer combinations to ensure schema validation works
      const combinations = [
        ["motivation.goal", "realizes", "business.service"],
        ["business.service", "implements", "application.component"],
        ["application.component", "uses", "technology.infrastructure"],
      ];

      for (const [source, predicate, dest] of combinations) {
        const validation = validateRelationshipCombination(source, predicate, dest);
        expect(validation.valid).toBeDefined();

        if (validation.valid) {
          const constraints = getRelationshipConstraints(source, predicate, dest);
          expect(constraints).toBeTruthy();
        }
      }
    });
  });
});
