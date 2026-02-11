import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { Model } from "@/core/model";
import { ReportDataModel } from "@/core/report-data-model";

describe("ReportDataModel", () => {
  let workdir: any;

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
});
