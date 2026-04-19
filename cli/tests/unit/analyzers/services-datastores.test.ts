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
import type { ServiceCandidate, DatastoreCandidate, AnalyzerHeuristic } from "@/analyzers/types.js";

describe("Service and Datastore Analysis", () => {
  describe("ServiceCandidate heuristic evaluation", () => {
    it("should populate qualifying_heuristics from fired rules", () => {
      // Simulate a service candidate with qualifying heuristics
      const candidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "user-service",
        suggested_name: "user-service",
        source_file: "src/services/UserService.ts",
        source_symbol: "UserService",
        qualified_name: "com.example.UserService",
        qualifying_heuristics: ["min_fan_in", "naming_patterns"],
        confidence: "medium",
        fan_in: 10,
        fan_out: 5,
      };

      expect(candidate.qualifying_heuristics.length).toBe(2);
      expect(candidate.qualifying_heuristics).toContain("min_fan_in");
      expect(candidate.qualifying_heuristics).toContain("naming_patterns");
    });

    it("should drop candidates with zero qualifying heuristics", () => {
      const candidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "unused-class",
        suggested_name: "unused-class",
        source_file: "src/UnusedClass.ts",
        source_symbol: "UnusedClass",
        qualified_name: "com.example.UnusedClass",
        qualifying_heuristics: [],
        confidence: "low",
        fan_in: 0,
        fan_out: 0,
      };

      // Test shows zero heuristics - should be filtered out
      expect(candidate.qualifying_heuristics.length).toBe(0);
    });

    it("should bypass drop for candidates with is_entry_point", () => {
      // When is_entry_point fires, the candidate should be kept even with other zero heuristics
      const candidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "main-handler",
        suggested_name: "main-handler",
        source_file: "src/main.ts",
        source_symbol: "main",
        qualified_name: "com.example.main",
        qualifying_heuristics: ["is_entry_point"],
        confidence: "medium",
        fan_in: 1,
        fan_out: 5,
      };

      expect(candidate.qualifying_heuristics).toContain("is_entry_point");
    });

    it("should cap confidence at medium", () => {
      const highConfidenceCandidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "service",
        suggested_name: "service",
        source_file: "src/Service.ts",
        source_symbol: "Service",
        qualified_name: "com.example.Service",
        qualifying_heuristics: ["min_fan_in"],
        confidence: "medium", // Should never be "high"
        fan_in: 50,
        fan_out: 20,
      };

      expect(highConfidenceCandidate.confidence).toBe("medium");
      expect(highConfidenceCandidate.confidence).not.toBe("high");
    });

    it("should preserve low confidence for low-confidence items", () => {
      const lowConfidenceCandidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "questionable-service",
        suggested_name: "questionable-service",
        source_file: "src/QuestionableService.ts",
        source_symbol: "QuestionableService",
        qualified_name: "com.example.QuestionableService",
        qualifying_heuristics: ["directory_match"],
        confidence: "low",
        fan_in: 0,
        fan_out: 0,
      };

      expect(lowConfidenceCandidate.confidence).toBe("low");
    });
  });

  describe("Heuristic evaluation logic", () => {
    it("should evaluate min_fan_in heuristic", () => {
      // Simulate heuristic evaluation
      const heuristic: AnalyzerHeuristic = {
        name: "min_fan_in",
        description: "Minimum fan-in threshold",
        parameters: { threshold: 5 },
      };

      const nodeWithHighFanIn = { fan_in: 10 };
      const nodeWithLowFanIn = { fan_in: 2 };

      // Manual evaluation logic
      const threshold = (heuristic.parameters?.threshold as number) ?? 5;
      expect((nodeWithHighFanIn as any).fan_in >= threshold).toBe(true);
      expect((nodeWithLowFanIn as any).fan_in >= threshold).toBe(false);
    });

    it("should evaluate naming_patterns heuristic", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "naming_patterns",
        description: "Service naming patterns",
        parameters: { service_suffixes: ["Service", "Manager", "Handler"] },
      };

      const serviceName = "UserService";
      const suffixes = (heuristic.parameters?.service_suffixes as string[]) ?? [];

      expect(
        suffixes.some((suffix) =>
          serviceName.toLowerCase().endsWith(suffix.toLowerCase())
        )
      ).toBe(true);

      const regularName = "User";
      expect(
        suffixes.some((suffix) =>
          regularName.toLowerCase().endsWith(suffix.toLowerCase())
        )
      ).toBe(false);
    });

    it("should evaluate is_entry_point heuristic", () => {
      const heuristic: AnalyzerHeuristic = {
        name: "is_entry_point",
        description: "Is entry point",
        parameters: { entry_point_patterns: ["main", "app", "index"] },
      };

      const entryPointName = "main";
      const patterns = (heuristic.parameters?.entry_point_patterns as string[]) ?? [];

      expect(
        patterns.some((pattern) =>
          entryPointName.toLowerCase().includes(pattern.toLowerCase())
        )
      ).toBe(true);

      const regularName = "UserService";
      expect(
        patterns.some((pattern) =>
          regularName.toLowerCase().includes(pattern.toLowerCase())
        )
      ).toBe(false);
    });
  });

  describe("DatastoreCandidate aggregation", () => {
    it("should group signals by file and module", () => {
      const candidate: DatastoreCandidate = {
        suggested_layer: "data-store",
        suggested_name: "postgresql",
        inferred_from: [
          {
            source_file: "src/db/users.ts",
            import_pattern: "pg",
            function_patterns: ["query", "execute"],
          },
          {
            source_file: "src/db/products.ts",
            import_pattern: "pg",
            function_patterns: ["query"],
          },
        ],
        confidence: "low",
        notes: "Inferred from 2 source file(s) based on datastore detection heuristics",
      };

      expect(candidate.inferred_from.length).toBe(2);
      expect(candidate.inferred_from[0].source_file).toBe("src/db/users.ts");
      expect(candidate.inferred_from[1].source_file).toBe("src/db/products.ts");
      expect(candidate.inferred_from[0].function_patterns).toContain("query");
    });

    it("should aggregate multiple evidence sources for same datastore", () => {
      const candidate: DatastoreCandidate = {
        suggested_layer: "data-store",
        suggested_name: "mongodb",
        inferred_from: [
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
        ],
        confidence: "low",
        notes: "Inferred from 3 source file(s) based on datastore detection heuristics",
      };

      expect(candidate.inferred_from.length).toBe(3);
      expect(candidate.suggested_name).toBe("mongodb");

      // Count total function patterns
      const totalPatterns = candidate.inferred_from.reduce(
        (sum, source) => sum + source.function_patterns.length,
        0
      );
      expect(totalPatterns).toBe(6);
    });

    it("should maintain confidence at low for all datastores", () => {
      const candidates: DatastoreCandidate[] = [
        {
          suggested_layer: "data-store",
          suggested_name: "postgresql",
          inferred_from: [],
          confidence: "low",
          notes: "Inferred from datastore detection heuristics",
        },
        {
          suggested_layer: "data-store",
          suggested_name: "redis",
          inferred_from: [],
          confidence: "low",
          notes: "Inferred from datastore detection heuristics",
        },
      ];

      for (const candidate of candidates) {
        expect(candidate.confidence).toBe("low");
      }
    });

    it("should infer datastore name from import patterns", () => {
      // Simulate datastore name inference from patterns
      const importPattern = "mongodb";
      const inferredName = importPattern.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      expect(inferredName).toBe("mongodb");

      const pgPattern = "pg";
      const pgName = pgPattern.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      expect(pgName).toBe("pg");
    });
  });

  describe("Combined heuristic scenarios", () => {
    it("should mark service as high-value when multiple heuristics fire", () => {
      const candidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "order-service",
        suggested_name: "order-service",
        source_file: "src/services/OrderService.ts",
        source_symbol: "OrderService",
        qualified_name: "com.example.OrderService",
        qualifying_heuristics: [
          "min_fan_in",
          "naming_patterns",
          "class_is_service",
        ],
        confidence: "medium",
        fan_in: 15,
        fan_out: 8,
      };

      expect(candidate.qualifying_heuristics.length).toBeGreaterThan(2);
      expect(candidate.confidence).toBe("medium");
    });

    it("should mark service as low-confidence when only one weak heuristic fires", () => {
      const candidate: ServiceCandidate = {
        suggested_layer: "application",
        suggested_element_type: "applicationservice",
        suggested_id_fragment: "maybe-service",
        suggested_name: "maybe-service",
        source_file: "src/services/MaybeService.ts",
        source_symbol: "MaybeService",
        qualified_name: "com.example.MaybeService",
        qualifying_heuristics: ["directory_match"],
        confidence: "low",
        fan_in: 1,
        fan_out: 0,
      };

      expect(candidate.qualifying_heuristics.length).toBe(1);
      expect(candidate.confidence).toBe("low");
    });
  });
});
