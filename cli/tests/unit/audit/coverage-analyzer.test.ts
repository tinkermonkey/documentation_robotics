/**
 * Unit tests for CoverageAnalyzer
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { CoverageAnalyzer } from "../../../src/audit/analysis/coverage-analyzer.js";
import { RelationshipCatalog } from "../../../src/core/relationship-catalog.js";
import {
  getLayerById,
  getAllLayers,
} from "../../../src/generated/layer-registry.js";

describe("CoverageAnalyzer", () => {
  let catalog: RelationshipCatalog;
  let analyzer: CoverageAnalyzer;

  beforeAll(async () => {
    catalog = new RelationshipCatalog();
    await catalog.load();
    analyzer = new CoverageAnalyzer(catalog);
  });

  it("should analyze coverage for all layers", async () => {
    const results = await analyzer.analyzeAll();

    expect(results).toBeDefined();
    expect(results.length).toBe(12); // 12 layers

    // Each result should have required properties
    for (const result of results) {
      expect(result).toHaveProperty("layer");
      expect(result).toHaveProperty("nodeTypeCount");
      expect(result).toHaveProperty("relationshipCount");
      expect(result).toHaveProperty("isolatedNodeTypes");
      expect(result).toHaveProperty("isolationPercentage");
      expect(result).toHaveProperty("availablePredicates");
      expect(result).toHaveProperty("usedPredicates");
      expect(result).toHaveProperty("utilizationPercentage");
      expect(result).toHaveProperty("relationshipsPerNodeType");
    }
  });

  it("should identify zero-relationship layers", async () => {
    const securityLayer = getLayerById("security");
    const uxLayer = getLayerById("ux");
    const navigationLayer = getLayerById("navigation");

    expect(securityLayer).toBeDefined();
    expect(uxLayer).toBeDefined();
    expect(navigationLayer).toBeDefined();

    const securityCoverage = await analyzer.analyzeLayer(securityLayer!);
    const uxCoverage = await analyzer.analyzeLayer(uxLayer!);
    const navigationCoverage = await analyzer.analyzeLayer(navigationLayer!);

    // These layers should have zero relationships
    expect(securityCoverage.relationshipCount).toBe(0);
    expect(uxCoverage.relationshipCount).toBe(0);
    expect(navigationCoverage.relationshipCount).toBe(0);

    // Isolation percentage should be 100%
    expect(securityCoverage.isolationPercentage).toBe(100);
    expect(uxCoverage.isolationPercentage).toBe(100);
    expect(navigationCoverage.isolationPercentage).toBe(100);

    // All node types should be isolated
    expect(securityCoverage.isolatedNodeTypes.length).toBe(
      securityCoverage.nodeTypeCount
    );
    expect(uxCoverage.isolatedNodeTypes.length).toBe(
      uxCoverage.nodeTypeCount
    );
    expect(navigationCoverage.isolatedNodeTypes.length).toBe(
      navigationCoverage.nodeTypeCount
    );
  });

  it("should calculate correct isolation percentage", async () => {
    const motivationLayer = getLayerById("motivation");
    expect(motivationLayer).toBeDefined();

    const coverage = await analyzer.analyzeLayer(motivationLayer!);

    // Motivation layer should have relationships
    expect(coverage.relationshipCount).toBeGreaterThan(0);

    // Isolation percentage should be less than 100%
    expect(coverage.isolationPercentage).toBeLessThan(100);
    expect(coverage.isolationPercentage).toBeGreaterThanOrEqual(0);

    // Calculate expected isolation
    const expectedIsolation =
      (coverage.isolatedNodeTypes.length / coverage.nodeTypeCount) * 100;
    expect(coverage.isolationPercentage).toBe(expectedIsolation);
  });

  it("should calculate predicate utilization", async () => {
    const motivationLayer = getLayerById("motivation");
    expect(motivationLayer).toBeDefined();

    const coverage = await analyzer.analyzeLayer(motivationLayer!);

    // Should have available predicates
    expect(coverage.availablePredicates.length).toBeGreaterThan(0);

    // Should have some used predicates
    expect(coverage.usedPredicates.length).toBeGreaterThan(0);

    // Used predicates should be subset of available
    for (const used of coverage.usedPredicates) {
      expect(coverage.availablePredicates).toContain(used);
    }

    // Utilization should be correct
    const expectedUtilization =
      (coverage.usedPredicates.length / coverage.availablePredicates.length) *
      100;
    expect(coverage.utilizationPercentage).toBe(expectedUtilization);
  });

  it("should calculate relationship density", async () => {
    const apiLayer = getLayerById("api");
    expect(apiLayer).toBeDefined();

    const coverage = await analyzer.analyzeLayer(apiLayer!);

    // Density should be correct
    const expectedDensity =
      coverage.nodeTypeCount > 0
        ? coverage.relationshipCount / coverage.nodeTypeCount
        : 0;
    expect(coverage.relationshipsPerNodeType).toBe(expectedDensity);
  });

  it("should include standard alignment for ArchiMate layers", async () => {
    const motivationLayer = getLayerById("motivation");
    const businessLayer = getLayerById("business");
    const applicationLayer = getLayerById("application");
    const technologyLayer = getLayerById("technology");

    const motivationCoverage = await analyzer.analyzeLayer(motivationLayer!);
    const businessCoverage = await analyzer.analyzeLayer(businessLayer!);
    const applicationCoverage = await analyzer.analyzeLayer(applicationLayer!);
    const technologyCoverage = await analyzer.analyzeLayer(technologyLayer!);

    // ArchiMate layers should have standard alignment
    expect(motivationCoverage.standardAlignment).toBeDefined();
    expect(motivationCoverage.standardAlignment?.standard).toBe(
      "ArchiMate 3.2"
    );

    expect(businessCoverage.standardAlignment).toBeDefined();
    expect(businessCoverage.standardAlignment?.standard).toBe("ArchiMate 3.2");

    expect(applicationCoverage.standardAlignment).toBeDefined();
    expect(applicationCoverage.standardAlignment?.standard).toBe(
      "ArchiMate 3.2"
    );

    expect(technologyCoverage.standardAlignment).toBeDefined();
    expect(technologyCoverage.standardAlignment?.standard).toBe(
      "ArchiMate 3.2"
    );
  });

  it("should not include standard alignment for non-ArchiMate layers", async () => {
    const apiLayer = getLayerById("api");
    const securityLayer = getLayerById("security");

    const apiCoverage = await analyzer.analyzeLayer(apiLayer!);
    const securityCoverage = await analyzer.analyzeLayer(securityLayer!);

    // Non-ArchiMate layers should not have ArchiMate standard alignment
    expect(apiCoverage.standardAlignment).toBeUndefined();
    expect(securityCoverage.standardAlignment).toBeUndefined();
  });

  it("should handle empty node types gracefully", async () => {
    const dataModelLayer = getLayerById("data-model");
    expect(dataModelLayer).toBeDefined();

    const coverage = await analyzer.analyzeLayer(dataModelLayer!);

    // Data-model layer has 0 node types in the layer registry
    expect(coverage.nodeTypeCount).toBe(0);
    expect(coverage.isolatedNodeTypes.length).toBe(0);
    expect(coverage.isolationPercentage).toBe(0);
  });
});
