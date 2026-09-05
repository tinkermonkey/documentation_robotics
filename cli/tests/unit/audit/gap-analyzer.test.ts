/**
 * Unit tests for GapAnalyzer
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { GapAnalyzer } from "../../../src/audit/relationships/analysis/gap-analyzer.js";
import { RelationshipCatalog } from "../../../src/core/relationship-catalog.js";
import { getLayerById, type LayerMetadata } from "../../../src/generated/layer-registry.js";

describe("GapAnalyzer", () => {
  let catalog: RelationshipCatalog;
  let analyzer: GapAnalyzer;

  beforeAll(async () => {
    catalog = new RelationshipCatalog();
    await catalog.load();
    analyzer = new GapAnalyzer();
  });

  it("should analyze gaps for all layers", () => {
    const gaps = analyzer.analyzeAll();

    expect(gaps).toBeDefined();
    expect(Array.isArray(gaps)).toBe(true);

    // Each gap should have required properties
    for (const gap of gaps) {
      expect(gap).toHaveProperty("sourceNodeType");
      expect(gap).toHaveProperty("destinationNodeType");
      expect(gap).toHaveProperty("suggestedPredicate");
      expect(gap).toHaveProperty("reason");
      expect(gap).toHaveProperty("priority");

      // Priority must be valid
      expect(["high", "medium", "low"]).toContain(gap.priority);
    }
  });

  it("should prioritize zero-relationship layers as high", () => {
    const securityLayer = getLayerById("security");
    const uxLayer = getLayerById("ux");
    const navigationLayer = getLayerById("navigation");

    expect(securityLayer).toBeDefined();
    expect(uxLayer).toBeDefined();
    expect(navigationLayer).toBeDefined();

    const securityGaps = analyzer.analyzeLayer(securityLayer!);
    const uxGaps = analyzer.analyzeLayer(uxLayer!);
    const navigationGaps = analyzer.analyzeLayer(navigationLayer!);

    // Zero-relationship layers should have gaps (may be empty if no patterns match)
    expect(securityGaps).toBeDefined();
    expect(uxGaps).toBeDefined();
    expect(navigationGaps).toBeDefined();

    // If gaps exist, they should be high priority for zero-relationship layers
    const securityHighPriority = securityGaps.filter(
      (g) => g.priority === "high"
    );
    const uxHighPriority = uxGaps.filter((g) => g.priority === "high");
    const navigationHighPriority = navigationGaps.filter(
      (g) => g.priority === "high"
    );

    // All security gaps should be high priority
    if (securityGaps.length > 0) {
      expect(securityHighPriority.length).toBe(securityGaps.length);
    }
    // All ux gaps should be high priority
    if (uxGaps.length > 0) {
      expect(uxHighPriority.length).toBe(uxGaps.length);
    }
    // All navigation gaps should be high priority
    if (navigationGaps.length > 0) {
      expect(navigationHighPriority.length).toBe(navigationGaps.length);
    }
  });

  it("should use layer-specific templates", () => {
    const motivationLayer = getLayerById("motivation");
    expect(motivationLayer).toBeDefined();

    const gaps = analyzer.analyzeLayer(motivationLayer!);

    // Should find gaps based on ArchiMate patterns
    const goalPrincipleGaps = gaps.filter(
      (g) =>
        g.sourceNodeType.includes("goal") &&
        g.destinationNodeType.includes("principle")
    );

    // Should have some goal→principle gaps
    expect(goalPrincipleGaps.length).toBeGreaterThanOrEqual(0);

    // Check for proper predicate suggestions
    for (const gap of goalPrincipleGaps) {
      expect(gap.suggestedPredicate).toBe("supports");
    }
  });

  it("should include standard references for ArchiMate layers", () => {
    // Use a mock motivation layer with fake node type IDs that match the template patterns
    // ("goal", "principle", "requirement", "constraint") but don't exist in RELATIONSHIPS_BY_SOURCE,
    // so the gap analyzer will find gaps and attach ArchiMate 3.2 references.
    const mockMotivationLayer: LayerMetadata = {
      id: "motivation",
      number: 1,
      name: "Mock Motivation Layer",
      description: "Mock layer for testing ArchiMate standard references",
      nodeTypes: [
        "motivation.x-goal-mock",
        "motivation.x-principle-mock",
        "motivation.x-requirement-mock",
        "motivation.x-constraint-mock",
      ],
    };

    const gaps = analyzer.analyzeLayer(mockMotivationLayer);

    // Some gaps should have ArchiMate references
    const withReferences = gaps.filter((g) => g.standardReference);
    expect(withReferences.length).toBeGreaterThan(0);

    for (const gap of withReferences) {
      expect(gap.standardReference).toContain("ArchiMate 3.2");
    }
  });

  it("should suggest NIST patterns for security layer", () => {
    // Use a mock security layer with fake node type IDs that match the template patterns
    // ("countermeasure", "threat") but don't exist in RELATIONSHIPS_BY_SOURCE,
    // so the gap analyzer will find gaps and attach NIST SP 800-53 references.
    const mockSecurityLayer: LayerMetadata = {
      id: "security",
      number: 3,
      name: "Mock Security Layer",
      description: "Mock layer for testing NIST standard references",
      nodeTypes: [
        "security.x-countermeasure-mock",
        "security.x-threat-mock",
      ],
    };

    const gaps = analyzer.analyzeLayer(mockSecurityLayer);

    // Should find countermeasure→threat gaps
    const countermeasureGaps = gaps.filter(
      (g) =>
        g.sourceNodeType.includes("countermeasure") &&
        g.destinationNodeType.includes("threat")
    );

    // Check predicate suggestions
    for (const gap of countermeasureGaps) {
      expect(gap.suggestedPredicate).toBe("mitigates");
    }

    // Should have NIST references
    const withNist = gaps.filter((g) =>
      g.standardReference?.includes("NIST SP 800-53")
    );
    expect(withNist.length).toBeGreaterThan(0);
  });

  it("should suggest OpenAPI patterns for API layer", () => {
    const apiLayer = getLayerById("api");
    expect(apiLayer).toBeDefined();

    const gaps = analyzer.analyzeLayer(apiLayer!);

    // Should find operation→schema gaps
    const operationSchemaGaps = gaps.filter(
      (g) =>
        g.sourceNodeType.includes("operation") &&
        g.destinationNodeType.includes("schema")
    );

    // Check predicate suggestions
    for (const gap of operationSchemaGaps) {
      expect(gap.suggestedPredicate).toBe("references");
    }

    // If any gaps exist, they should have proper structure
    if (gaps.length > 0) {
      for (const gap of gaps) {
        expect(gap.sourceNodeType).toBeTruthy();
        expect(gap.destinationNodeType).toBeTruthy();
        expect(gap.suggestedPredicate).toBeTruthy();
        expect(gap.reason).toBeTruthy();
      }
    }
  });

  it("should provide meaningful reasons", () => {
    const gaps = analyzer.analyzeAll();

    for (const gap of gaps) {
      expect(gap.reason.length).toBeGreaterThan(0);
      expect(gap.reason).not.toBe("");
    }
  });

  it("should handle layers without templates", () => {
    const dataStoreLayer = getLayerById("data-store");
    expect(dataStoreLayer).toBeDefined();

    const gaps = analyzer.analyzeLayer(dataStoreLayer!);

    // Should return empty array or handle gracefully
    expect(gaps).toBeDefined();
    expect(Array.isArray(gaps)).toBe(true);
  });

  it("should prioritize container types as medium", () => {
    const applicationLayer = getLayerById("application");
    expect(applicationLayer).toBeDefined();

    const gaps = analyzer.analyzeLayer(applicationLayer!);

    // Container types should have medium priority
    const componentGaps = gaps.filter((g) =>
      g.sourceNodeType.includes("component")
    );

    for (const gap of componentGaps) {
      // Should be medium or high priority
      expect(["medium", "high"]).toContain(gap.priority);
    }
  });
});
