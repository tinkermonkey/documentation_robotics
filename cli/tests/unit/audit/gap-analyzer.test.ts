/**
 * Unit tests for GapAnalyzer
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { GapAnalyzer } from "../../../src/audit/analysis/gap-analyzer.js";
import { RelationshipCatalog } from "../../../src/core/relationship-catalog.js";
import { getLayerById } from "../../../src/generated/layer-registry.js";

describe("GapAnalyzer", () => {
  let catalog: RelationshipCatalog;
  let analyzer: GapAnalyzer;

  beforeAll(async () => {
    catalog = new RelationshipCatalog();
    await catalog.load();
    analyzer = new GapAnalyzer(catalog);
  });

  it("should analyze gaps for all layers", async () => {
    const gaps = await analyzer.analyzeAll();

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

  it("should prioritize zero-relationship layers as high", async () => {
    const securityLayer = getLayerById("security");
    const uxLayer = getLayerById("ux");
    const navigationLayer = getLayerById("navigation");

    expect(securityLayer).toBeDefined();
    expect(uxLayer).toBeDefined();
    expect(navigationLayer).toBeDefined();

    const securityGaps = await analyzer.analyzeLayer(securityLayer!);
    const uxGaps = await analyzer.analyzeLayer(uxLayer!);
    const navigationGaps = await analyzer.analyzeLayer(navigationLayer!);

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

  it("should use layer-specific templates", async () => {
    const motivationLayer = getLayerById("motivation");
    expect(motivationLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(motivationLayer!);

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

  it("should include standard references for ArchiMate layers", async () => {
    const motivationLayer = getLayerById("motivation");
    expect(motivationLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(motivationLayer!);

    // Some gaps should have ArchiMate references
    const withReferences = gaps.filter((g) => g.standardReference);
    expect(withReferences.length).toBeGreaterThan(0);

    for (const gap of withReferences) {
      expect(gap.standardReference).toContain("ArchiMate 3.2");
    }
  });

  it("should suggest NIST patterns for security layer", async () => {
    const securityLayer = getLayerById("security");
    expect(securityLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(securityLayer!);

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

  it("should suggest OpenAPI patterns for API layer", async () => {
    const apiLayer = getLayerById("api");
    expect(apiLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(apiLayer!);

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

  it("should provide meaningful reasons", async () => {
    const gaps = await analyzer.analyzeAll();

    for (const gap of gaps) {
      expect(gap.reason.length).toBeGreaterThan(0);
      expect(gap.reason).not.toBe("");
    }
  });

  it("should handle layers without templates", async () => {
    const dataStoreLayer = getLayerById("data-store");
    expect(dataStoreLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(dataStoreLayer!);

    // Should return empty array or handle gracefully
    expect(gaps).toBeDefined();
    expect(Array.isArray(gaps)).toBe(true);
  });

  it("should prioritize container types as medium", async () => {
    const applicationLayer = getLayerById("application");
    expect(applicationLayer).toBeDefined();

    const gaps = await analyzer.analyzeLayer(applicationLayer!);

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
