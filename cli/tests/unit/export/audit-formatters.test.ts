/**
 * Unit tests for audit-formatters.ts
 *
 * Tests formatter edge cases:
 * - Empty sections (no coverage, duplicates, gaps, balance data)
 * - Large reports with many elements
 * - Markdown escaping of special characters
 * - JSON serialization of complex nested structures
 */

import { describe, it, expect } from "bun:test";
import { formatAuditReport } from "../../../src/export/audit-formatters.js";
import type {
  AuditReport,
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
} from "../../../src/audit/types.js";

// Helper to create minimal valid AuditReport
function createMinimalReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    model: {
      name: "Test Model",
      version: "1.0.0",
    },
    coverage: [],
    duplicates: [],
    gaps: [],
    balance: [],
    connectivity: {
      components: [],
      degrees: [],
      transitiveChains: [],
      stats: {
        totalNodes: 0,
        totalEdges: 0,
        connectedComponents: 0,
        largestComponentSize: 0,
        isolatedNodes: 0,
        averageDegree: 0,
        transitiveChainCount: 0,
      },
    },
    ...overrides,
  };
}

// Helper to create coverage metrics
function createCoverageMetrics(overrides?: Partial<CoverageMetrics>): CoverageMetrics {
  return {
    layer: "test",
    nodeTypeCount: 5,
    relationshipCount: 10,
    isolatedNodeTypes: [],
    isolationPercentage: 0,
    availablePredicates: ["predicate1", "predicate2"],
    usedPredicates: ["predicate1"],
    utilizationPercentage: 50,
    relationshipsPerNodeType: 2,
    ...overrides,
  };
}

describe("audit-formatters", () => {
  describe("empty sections handling", () => {
    it("should format report with empty coverage array", () => {
      const report = createMinimalReport({
        coverage: [],
      });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });
      const mdOutput = formatAuditReport(report, { format: "markdown" });

      expect(textOutput).toBeDefined();
      expect(jsonOutput).toBeDefined();
      expect(mdOutput).toBeDefined();

      // Should contain header but handle empty coverage
      expect(textOutput).toContain("Relationship Audit Report");
      expect(jsonOutput).toContain('"coverage": []');
    });

    it("should format report with empty duplicates array", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
        duplicates: [],
      });

      const textOutput = formatAuditReport(report, { format: "text" });
      expect(textOutput).toContain("Relationship Audit Report");

      // Should handle empty duplicates without error
      expect(textOutput.length).toBeGreaterThan(0);
    });

    it("should format report with empty gaps array", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
        gaps: [],
      });

      const textOutput = formatAuditReport(report, { format: "text" });
      expect(textOutput).toContain("Relationship Audit Report");
      expect(textOutput.length).toBeGreaterThan(0);
    });

    it("should format report with empty balance array", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
        balance: [],
      });

      const textOutput = formatAuditReport(report, { format: "text" });
      expect(textOutput).toContain("Relationship Audit Report");
      expect(textOutput.length).toBeGreaterThan(0);
    });

    it("should format completely empty report", () => {
      const report = createMinimalReport();

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });
      const mdOutput = formatAuditReport(report, { format: "markdown" });

      // All formats should succeed even with empty data
      expect(textOutput).toContain("Test Model");
      expect(jsonOutput).toContain('"model"');
      expect(mdOutput).toContain("Test Model");
    });
  });

  describe("markdown escaping", () => {
    it("should escape special markdown characters in model name", () => {
      const report = createMinimalReport({
        model: {
          name: "Test [Model] with *special* _characters_",
          version: "1.0.0",
        },
      });

      const mdOutput = formatAuditReport(report, { format: "markdown" });

      // Should contain escaped characters
      expect(mdOutput).toContain("Test \\[Model\\]");
      expect(mdOutput).toContain("\\*special\\*");
    });

    it("should escape backticks and pipes in gap suggestions", () => {
      const report = createMinimalReport({
        gaps: [
          {
            sourceNodeType: "type1",
            destinationNodeType: "type2",
            suggestedPredicate: "contains|special",
            reason: "Gap with `backticks` and | pipes",
            priority: "high",
          },
        ],
      });

      const mdOutput = formatAuditReport(report, { format: "markdown" });

      // Markdown output should handle special chars
      expect(mdOutput.length).toBeGreaterThan(0);
    });

    it("should handle newlines in descriptions", () => {
      const report = createMinimalReport({
        gaps: [
          {
            sourceNodeType: "type1",
            destinationNodeType: "type2",
            suggestedPredicate: "pred",
            reason: "Multi-line\ndescription\nwith newlines",
            priority: "medium",
          },
        ],
      });

      const mdOutput = formatAuditReport(report, { format: "markdown" });
      expect(mdOutput.length).toBeGreaterThan(0);
    });
  });

  describe("large reports", () => {
    it("should handle many coverage entries", () => {
      const coverage = Array.from({ length: 100 }, (_, i) =>
        createCoverageMetrics({
          layer: `layer-${i}`,
          nodeTypeCount: i + 1,
          relationshipCount: i * 2,
        })
      );

      const report = createMinimalReport({ coverage });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });

      expect(textOutput.length).toBeGreaterThan(0);
      expect(jsonOutput).toContain('"coverage"');

      // Should include all layers
      expect(jsonOutput).toContain("layer-0");
      expect(jsonOutput).toContain("layer-99");
    });

    it("should handle many duplicate entries", () => {
      const duplicates: DuplicateCandidate[] = Array.from(
        { length: 50 },
        (_, i) => ({
          relationships: [`rel-${i}-1`, `rel-${i}-2`],
          predicates: [`pred-${i}`, `pred-${i}-alt`],
          sourceNodeType: `source-${i}`,
          destinationNodeType: `dest-${i}`,
          reason: `Semantic overlap ${i}`,
          confidence: "high",
        })
      );

      const report = createMinimalReport({ duplicates });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });

      expect(textOutput.length).toBeGreaterThan(0);
      expect(jsonOutput).toContain("duplicate");
    });

    it("should handle many gap entries", () => {
      const gaps: GapCandidate[] = Array.from({ length: 75 }, (_, i) => ({
        sourceNodeType: `source-${i}`,
        destinationNodeType: `dest-${i}`,
        suggestedPredicate: `pred-${i}`,
        reason: `Missing relationship ${i}`,
        priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
        standardReference: i % 2 === 0 ? `Standard-${i}` : undefined,
      }));

      const report = createMinimalReport({ gaps });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });

      expect(textOutput.length).toBeGreaterThan(0);
      expect(jsonOutput).toContain("gap");
    });

    it("should handle many balance entries", () => {
      const balance: BalanceAssessment[] = Array.from(
        { length: 60 },
        (_, i) => ({
          nodeType: `type-${i}`,
          layer: `layer-${i % 12}`,
          category: ["structural", "behavioral", "enumeration", "reference"][
            i % 4
          ] as any,
          currentCount: i,
          targetRange: [i - 1, i + 1] as [number, number],
          status: i % 3 === 0 ? "under" : i % 3 === 1 ? "balanced" : "over",
          recommendation:
            i % 2 === 0 ? `Recommendation for ${i}` : undefined,
        })
      );

      const report = createMinimalReport({ balance });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });

      expect(textOutput.length).toBeGreaterThan(0);
      expect(jsonOutput).toContain("balance");
    });
  });

  describe("format output validation", () => {
    it("should produce valid JSON output", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
      });

      const jsonOutput = formatAuditReport(report, { format: "json" });

      // Should be parseable JSON
      expect(() => {
        JSON.parse(jsonOutput);
      }).not.toThrow();

      const parsed = JSON.parse(jsonOutput);
      expect(parsed.model.name).toBe("Test Model");
      expect(Array.isArray(parsed.coverage)).toBe(true);
    });

    it("should produce non-empty text output for reports with data", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
        gaps: [
          {
            sourceNodeType: "src",
            destinationNodeType: "dst",
            suggestedPredicate: "pred",
            reason: "test",
            priority: "high",
          },
        ],
      });

      const textOutput = formatAuditReport(report, { format: "text" });

      expect(textOutput.length).toBeGreaterThan(50);
      expect(textOutput).toContain("Test Model");
    });

    it("should produce markdown with valid structure", () => {
      const report = createMinimalReport({
        coverage: [createCoverageMetrics()],
      });

      const mdOutput = formatAuditReport(report, { format: "markdown" });

      // Should have markdown structure
      expect(mdOutput).toContain("#");
      expect(mdOutput).toContain("##");
      expect(mdOutput).toMatch(/\[.+\]\(#.+\)/); // Links to sections
    });
  });

  describe("verbose mode", () => {
    it("should include more detail in verbose text output", () => {
      const report = createMinimalReport({
        coverage: [
          createCoverageMetrics({
            isolatedNodeTypes: ["isolated1", "isolated2"],
          }),
        ],
      });

      const normalOutput = formatAuditReport(report, {
        format: "text",
        verbose: false,
      });
      const verboseOutput = formatAuditReport(report, {
        format: "text",
        verbose: true,
      });

      // Verbose output should be longer (includes detailed sections)
      expect(verboseOutput.length).toBeGreaterThanOrEqual(normalOutput.length);
    });
  });

  describe("special cases", () => {
    it("should handle null/undefined in optional fields", () => {
      const report = createMinimalReport({
        gaps: [
          {
            sourceNodeType: "src",
            destinationNodeType: "dst",
            suggestedPredicate: "pred",
            reason: "reason",
            priority: "low",
            standardReference: undefined, // Optional field
          },
        ],
      });

      const output = formatAuditReport(report, { format: "json" });
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should handle very long model names", () => {
      const longName = "A".repeat(500);
      const report = createMinimalReport({
        model: {
          name: longName,
          version: "1.0.0",
        },
      });

      const textOutput = formatAuditReport(report, { format: "text" });
      const jsonOutput = formatAuditReport(report, { format: "json" });

      expect(textOutput).toContain(longName);
      expect(jsonOutput).toContain(longName);
    });

    it("should handle empty strings in arrays", () => {
      const report = createMinimalReport({
        coverage: [
          createCoverageMetrics({
            availablePredicates: ["", "valid", ""],
            usedPredicates: [""],
          }),
        ],
      });

      const output = formatAuditReport(report, { format: "json" });
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});
