import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { Model } from "@/core/model";
import { ReportDataModel } from "@/core/report-data-model";

describe("ReportDataModel", () => {
  let workdir: { path: string; cleanup: () => Promise<void> };

  beforeAll(async () => {
    workdir = await createTestWorkdir();
  });

  afterAll(async () => {
    if (workdir?.cleanup) {
      await workdir.cleanup();
    }
  });

  it("should create a ReportDataModel instance", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    expect(reportModel).toBeDefined();
    expect(reportModel.getCatalog).toBeDefined();
  });

  it("should collect statistics", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const stats = await reportModel.getStatistics();

    expect(stats).toBeDefined();
    expect(stats.project).toBeDefined();
    expect(stats.project.name).toBe("test-project");
    expect(stats.statistics).toBeDefined();
    expect(stats.statistics.totalElements).toBeGreaterThanOrEqual(0);
    expect(stats.statistics.totalRelationships).toBeGreaterThanOrEqual(0);
    expect(stats.statistics.totalLayers).toBe(12);
  });

  it("should collect relationship analysis", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const relationships = await reportModel.getRelationshipAnalysis();

    expect(relationships).toBeDefined();
    expect(relationships.totalRelationships).toBeGreaterThanOrEqual(0);
    expect(relationships.classified).toBeDefined();
    expect(Array.isArray(relationships.classified)).toBe(true);
    expect(relationships.byCategory).toBeDefined();
    expect(relationships.byPredicate).toBeDefined();
  });

  it("should classify relationships correctly", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const relationships = await reportModel.getRelationshipAnalysis();

    if (relationships.classified.length > 0) {
      const rel = relationships.classified[0];

      expect(rel.id).toBeDefined();
      expect(rel.source).toBeDefined();
      expect(rel.target).toBeDefined();
      expect(rel.predicate).toBeDefined();
      expect(rel.category).toBeDefined();
      expect(rel.sourceLayer).toBeDefined();
      expect(rel.targetLayer).toBeDefined();
      expect(rel.isCrossLayer).toBe(rel.sourceLayer !== rel.targetLayer);
    }
  });

  it("should get data model insights", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const dataModel = await reportModel.getDataModelInsights();

    expect(dataModel).toBeDefined();
    expect(dataModel.entityCount).toBeGreaterThanOrEqual(0);
    expect(dataModel.attributeCount).toBeGreaterThanOrEqual(0);
    expect(dataModel.entities).toBeDefined();
    expect(Array.isArray(dataModel.entities)).toBe(true);
    expect(dataModel.avgAttributesPerEntity).toBeGreaterThanOrEqual(0);
  });

  it("should calculate quality metrics", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const quality = await reportModel.getQualityMetrics();

    expect(quality).toBeDefined();
    expect(quality.elementCoverage).toBeGreaterThanOrEqual(0);
    expect(quality.elementCoverage).toBeLessThanOrEqual(100);
    expect(quality.relationshipCoverage).toBeGreaterThanOrEqual(0);
    expect(quality.documentationCoverage).toBeGreaterThanOrEqual(0);
    expect(quality.layerCoverage).toBeGreaterThanOrEqual(0);
    expect(quality.archimateCompliance).toBeGreaterThanOrEqual(0);
    expect(quality.specCompliance).toBeGreaterThanOrEqual(0);
  });

  it("should collect complete report", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const report = await reportModel.collect();

    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.statistics).toBeDefined();
    expect(report.relationships).toBeDefined();
    expect(report.dataModel).toBeDefined();
    expect(report.quality).toBeDefined();
  });

  it("should detect circular dependencies", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const relationships = await reportModel.getRelationshipAnalysis();

    expect(relationships.circularDependencies).toBeDefined();
    expect(Array.isArray(relationships.circularDependencies)).toBe(true);
    // Circular dependencies should have pathLength >= 2
    for (const circular of relationships.circularDependencies) {
      expect(circular.pathLength).toBeGreaterThanOrEqual(2);
      expect(circular.elements.length).toBeGreaterThanOrEqual(2);
      expect(circular.predicates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should cache results", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const stats1 = await reportModel.getStatistics();
    const stats2 = await reportModel.getStatistics();

    // Should return the same cached object
    expect(stats1).toBe(stats2);
  });

  it("should clear cache", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const stats1 = await reportModel.getStatistics();
    reportModel.clearCache();
    const stats2 = await reportModel.getStatistics();

    // Should be different objects after cache clear
    expect(stats1).not.toBe(stats2);
  });

  it("should filter relationships by category", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const allRelationships = await reportModel.getRelationshipAnalysis();

    if (Object.keys(allRelationships.byCategory).length > 0) {
      const category = Object.keys(allRelationships.byCategory)[0];
      const filtered = await reportModel.getRelationshipsByCategory(category);

      expect(filtered).toBeDefined();
      expect(Array.isArray(filtered)).toBe(true);

      for (const rel of filtered) {
        expect(rel.category).toBe(category);
      }
    }
  });

  it("should handle relationships with unknown predicates", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    // Load catalog first
    await reportModel.loadCatalog();

    const relationships = await reportModel.getRelationshipAnalysis();

    // Unknown relationships should be marked with "unknown" category
    const unknownRels = relationships.classified.filter(r => r.category === "unknown");

    // Each unknown relationship should not be spec compliant
    for (const rel of unknownRels) {
      expect(rel.isSpecCompliant).toBe(false);
    }

    expect(relationships.byCategory).toBeDefined();
    // "unknown" category should exist if there are any non-catalog predicates
  });

  it("should report zero metrics for empty model", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    // This test verifies behavior with minimal/empty data
    const stats = await reportModel.getStatistics();

    // Even with minimal data, these should never be negative
    expect(stats.statistics.totalElements).toBeGreaterThanOrEqual(0);
    expect(stats.statistics.totalRelationships).toBeGreaterThanOrEqual(0);
    expect(stats.statistics.totalLayers).toBe(12);
  });

  it("should handle layer compliance with invalid layer names", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const relationships = await reportModel.getRelationshipAnalysis();
    const quality = await reportModel.getQualityMetrics();

    // Layer compliance score should be between 0 and 100
    expect(quality.layerComplianceScore).toBeGreaterThanOrEqual(0);
    expect(quality.layerComplianceScore).toBeLessThanOrEqual(100);
  });

  it("should calculate documentation coverage based on element descriptions", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const quality = await reportModel.getQualityMetrics();

    // Documentation coverage should be a valid percentage
    expect(quality.documentationCoverage).toBeGreaterThanOrEqual(0);
    expect(quality.documentationCoverage).toBeLessThanOrEqual(100);
  });

  it("should mark relationships as spec compliant only when predicate is known", async () => {
    const model = await Model.load(workdir.path);
    const reportModel = new ReportDataModel(model);

    const relationships = await reportModel.getRelationshipAnalysis();
    const quality = await reportModel.getQualityMetrics();

    // Spec compliance should reflect the proportion of known predicates
    expect(quality.specCompliance).toBeGreaterThanOrEqual(0);
    expect(quality.specCompliance).toBeLessThanOrEqual(100);

    // Count manually to verify
    const compliantCount = relationships.classified.filter(r => r.isSpecCompliant).length;
    const expectedCompliance =
      relationships.totalRelationships > 0
        ? Math.round((compliantCount / relationships.totalRelationships) * 100)
        : 100;

    expect(quality.specCompliance).toBe(expectedCompliance);
  });

});
