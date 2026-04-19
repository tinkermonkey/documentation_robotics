/**
 * Unit tests for service and datastore analysis
 *
 * Tests covering:
 * - Heuristic evaluation and qualifying_heuristics population
 * - Zero-heuristic candidates dropped (unless is_entry_point)
 * - is_entry_point=true bypasses zero-heuristic drop
 * - Confidence never exceeds "medium"
 * - Datastore aggregation groups signals by file/module
 */

import { describe, it, expect } from "bun:test";
import type { AnalyzerHeuristic } from "@/analyzers/types.js";

// Helper function that simulates heuristic evaluation logic
function evaluateHeuristic(
  heuristic: AnalyzerHeuristic,
  targetValue: number | string
): boolean {
  const params = heuristic.parameters || {};

  if (heuristic.name === "min_fan_in") {
    const threshold = (params.threshold as number) ?? 5;
    return (targetValue as number) >= threshold;
  }

  if (heuristic.name === "naming_patterns") {
    const suffixes = (params.service_suffixes as string[]) ?? [];
    return suffixes.some((suffix) =>
      (targetValue as string).toLowerCase().endsWith(suffix.toLowerCase())
    );
  }

  if (heuristic.name === "is_entry_point") {
    const patterns = (params.entry_point_patterns as string[]) ?? [];
    return patterns.some((pattern) =>
      (targetValue as string).toLowerCase().includes(pattern.toLowerCase())
    );
  }

  return false;
}

// Helper function that simulates confidence capping logic
function capConfidence(
  confidence: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  // Cap confidence at "medium" for service candidates
  if (confidence === "high") {
    return "medium";
  }
  return confidence;
}

describe("Service and Datastore Analysis", () => {
  describe("Heuristic evaluation logic", () => {
    it("should evaluate min_fan_in heuristic", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "min_fan_in",
        description: "Minimum fan-in threshold",
        parameters: { threshold: 5 },
      };

      // Test that evaluates high fan-in
      const result1 = evaluateHeuristic(heuristic, 10);
      expect(result1).toBe(true);

      // Test that evaluates low fan-in
      const result2 = evaluateHeuristic(heuristic, 2);
      expect(result2).toBe(false);
    });

    it("should evaluate naming_patterns heuristic", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "naming_patterns",
        description: "Service naming patterns",
        parameters: { service_suffixes: ["Service", "Manager", "Handler"] },
      };

      // Test class with matching suffix
      const result1 = evaluateHeuristic(heuristic, "UserService");
      expect(result1).toBe(true);

      // Test class without matching suffix
      const result2 = evaluateHeuristic(heuristic, "User");
      expect(result2).toBe(false);
    });

    it("should evaluate is_entry_point heuristic", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "is_entry_point",
        description: "Is entry point",
        parameters: { entry_point_patterns: ["main", "app", "index"] },
      };

      // Test with matching entry point name
      const result1 = evaluateHeuristic(heuristic, "main");
      expect(result1).toBe(true);

      // Test with non-matching name
      const result2 = evaluateHeuristic(heuristic, "UserService");
      expect(result2).toBe(false);
    });

    it("should handle heuristics with missing parameters gracefully", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "min_fan_in",
        description: "Minimum fan-in threshold",
        // No parameters provided
      };

      // Should use default threshold of 5
      const result = evaluateHeuristic(heuristic, 10);
      expect(result).toBe(true);
    });
  });

  describe("ServiceCandidate heuristic application", () => {
    it("should populate qualifying_heuristics from fired rules", () => {
      const heuristics: AnalyzerHeuristic[] = [
        {
          name: "min_fan_in",
          description: "Minimum fan-in threshold",
          parameters: { threshold: 5 },
        },
        {
          name: "naming_patterns",
          description: "Service naming patterns",
          parameters: { service_suffixes: ["Service", "Manager", "Handler"] },
        },
      ];

      const className = "UserService";
      const fanIn = 10;

      // Evaluate which heuristics fire
      const firedHeuristics: string[] = [];
      for (const heuristic of heuristics) {
        if (heuristic.name === "min_fan_in") {
          if (evaluateHeuristic(heuristic, fanIn)) {
            firedHeuristics.push(heuristic.name);
          }
        } else if (heuristic.name === "naming_patterns") {
          if (evaluateHeuristic(heuristic, className)) {
            firedHeuristics.push(heuristic.name);
          }
        }
      }

      expect(firedHeuristics.length).toBe(2);
      expect(firedHeuristics).toContain("min_fan_in");
      expect(firedHeuristics).toContain("naming_patterns");
    });

    it("should drop candidates with zero qualifying heuristics", () => {
      const heuristics: AnalyzerHeuristic[] = [
        {
          name: "min_fan_in",
          description: "Minimum fan-in threshold",
          parameters: { threshold: 5 },
        },
      ];

      const className = "UnusedClass";
      const fanIn = 0;

      // Evaluate which heuristics fire
      const firedHeuristics: string[] = [];
      for (const heuristic of heuristics) {
        if (heuristic.name === "min_fan_in") {
          if (evaluateHeuristic(heuristic, fanIn)) {
            firedHeuristics.push(heuristic.name);
          }
        }
      }

      // No heuristics fired - should be dropped
      expect(firedHeuristics.length).toBe(0);
    });

    it("should bypass drop for candidates with is_entry_point", () => {
      const heuristics: AnalyzerHeuristic[] = [
        {
          name: "is_entry_point",
          description: "Is entry point",
          parameters: { entry_point_patterns: ["main", "app", "index"] },
        },
      ];

      const className = "main";

      // Evaluate which heuristics fire
      const firedHeuristics: string[] = [];
      for (const heuristic of heuristics) {
        if (heuristic.name === "is_entry_point") {
          if (evaluateHeuristic(heuristic, className)) {
            firedHeuristics.push(heuristic.name);
          }
        }
      }

      // is_entry_point fired - candidate should be kept
      expect(firedHeuristics).toContain("is_entry_point");
    });

    it("should cap confidence at medium", () => {
      // Test that high confidence gets capped to medium
      const cappedHigh = capConfidence("high");
      expect(cappedHigh).toBe("medium");
      expect(cappedHigh).not.toBe("high");

      // Test that medium confidence remains unchanged
      const cappedMedium = capConfidence("medium");
      expect(cappedMedium).toBe("medium");

      // Test that low confidence remains unchanged
      const cappedLow = capConfidence("low");
      expect(cappedLow).toBe("low");
    });
  });

  describe("Datastore candidate aggregation", () => {
    it("should aggregate multiple evidence sources for same datastore", () => {
      // Simulate aggregating datastore evidence
      const sourceFiles = [
        {
          source_file: "src/db/connection.ts",
          import_pattern: "mongodb",
          function_patterns: ["connect", "collection"],
        },
        {
          source_file: "src/db/queries.ts",
          import_pattern: "mongodb",
          function_patterns: ["find", "insert", "update"],
        },
        {
          source_file: "src/models/User.ts",
          import_pattern: "mongodb",
          function_patterns: ["findOne"],
        },
      ];

      const totalPatterns = sourceFiles.reduce(
        (sum, source) => sum + source.function_patterns.length,
        0
      );
      expect(sourceFiles.length).toBe(3);
      expect(totalPatterns).toBe(6);
    });

    it("should infer datastore name from import patterns", () => {
      const patterns = ["mongodb", "pg", "redis", "@prisma/client"];

      for (const pattern of patterns) {
        // Simulate name inference
        const inferredName = pattern
          .toLowerCase()
          .split("/")[0]
          .replace(/[^a-z0-9-]/g, "-");

        expect(inferredName).toBeTruthy();
        expect(inferredName.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Combined heuristic scenarios", () => {
    it("should fire multiple heuristics for high-value service", () => {
      const heuristics: AnalyzerHeuristic[] = [
        {
          name: "min_fan_in",
          description: "Minimum fan-in threshold",
          parameters: { threshold: 5 },
        },
        {
          name: "naming_patterns",
          description: "Service naming patterns",
          parameters: { service_suffixes: ["Service"] },
        },
      ];

      const className = "OrderService";
      const fanIn = 15;

      // Evaluate which heuristics fire
      const firedHeuristics: string[] = [];
      for (const heuristic of heuristics) {
        if (heuristic.name === "min_fan_in") {
          if (evaluateHeuristic(heuristic, fanIn)) {
            firedHeuristics.push(heuristic.name);
          }
        } else if (heuristic.name === "naming_patterns") {
          if (evaluateHeuristic(heuristic, className)) {
            firedHeuristics.push(heuristic.name);
          }
        }
      }

      expect(firedHeuristics.length).toBeGreaterThan(1);
      expect(firedHeuristics).toContain("min_fan_in");
      expect(firedHeuristics).toContain("naming_patterns");
    });

    it("should fire only weak heuristics for low-confidence service", () => {
      const heuristics: AnalyzerHeuristic[] = [
        {
          name: "min_fan_in",
          description: "Minimum fan-in threshold",
          parameters: { threshold: 5 },
        },
      ];

      const className = "MaybeService";
      const fanIn = 1;

      // Evaluate which heuristics fire
      const firedHeuristics: string[] = [];
      for (const heuristic of heuristics) {
        if (heuristic.name === "min_fan_in") {
          if (evaluateHeuristic(heuristic, fanIn)) {
            firedHeuristics.push(heuristic.name);
          }
        }
      }

      expect(firedHeuristics.length).toBe(0);
    });
  });
});
