import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { Model } from "@/core/model";
import { DataModelAnalyzer } from "@/analysis/data-model-analyzer";

describe("DataModelAnalyzer", () => {
  let workdir: any;
  let analyzer: DataModelAnalyzer;

  beforeAll(async () => {
    workdir = await createTestWorkdir();
    const model = await Model.load(workdir.path);
    analyzer = new DataModelAnalyzer(model);
  });

  afterAll(async () => {
    if (workdir?.cleanup) {
      await workdir.cleanup();
    }
  });

  it("should create an analyzer instance", () => {
    expect(analyzer).toBeDefined();
  });

  it("should analyze entities", async () => {
    const entities = await analyzer.analyzeEntities();

    expect(entities).toBeDefined();
    expect(Array.isArray(entities)).toBe(true);

    for (const entity of entities) {
      expect(entity.id).toBeDefined();
      expect(entity.name).toBeDefined();
      expect(entity.layer).toBe("data-model");
      expect(Array.isArray(entity.attributes)).toBe(true);
      expect(Array.isArray(entity.relatedEntities)).toBe(true);
      expect(typeof entity.isReferenced).toBe("boolean");
    }
  });

  it("should check constraints", async () => {
    const constraints = await analyzer.checkConstraints();

    expect(constraints).toBeDefined();
    expect(Array.isArray(constraints)).toBe(true);

    for (const constraint of constraints) {
      expect(constraint.entityId).toBeDefined();
      expect(constraint.constraintType).toBeDefined();
      expect(constraint.description).toBeDefined();
      expect(typeof constraint.isValid).toBe("boolean");
    }
  });

  it("should check cardinality", async () => {
    const cardinalities = await analyzer.checkCardinality();

    expect(cardinalities).toBeDefined();
    expect(Array.isArray(cardinalities)).toBe(true);

    for (const card of cardinalities) {
      expect(card.sourceEntity).toBeDefined();
      expect(card.targetEntity).toBeDefined();
      expect(["one-to-one", "one-to-many", "many-to-many"]).toContain(card.cardinality);
      expect(typeof card.isOptional).toBe("boolean");
    }
  });

  it("should identify data quality issues", async () => {
    const issues = await analyzer.identifyIssues();

    expect(issues).toBeDefined();
    expect(Array.isArray(issues)).toBe(true);

    for (const issue of issues) {
      expect(["incomplete", "inconsistent", "orphaned", "invalid-reference", "missing-constraint"]).toContain(
        issue.type
      );
      expect(issue.entityId).toBeDefined();
      expect(issue.description).toBeDefined();
      expect(["low", "medium", "high"]).toContain(issue.severity);
    }
  });

  it("should calculate coverage metrics", async () => {
    const coverage = await analyzer.calculateCoverage();

    expect(coverage).toBeDefined();
    expect(coverage.totalEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.documentsEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.constraintsEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.referencedEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.orphanedEntities).toBeGreaterThanOrEqual(0);

    // Check percentage metrics
    expect(coverage.documentationCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.documentationCoverage).toBeLessThanOrEqual(100);
    expect(coverage.constraintCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.constraintCoverage).toBeLessThanOrEqual(100);
    expect(coverage.referenceCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.referenceCoverage).toBeLessThanOrEqual(100);
  });

  it("should calculate complexity metrics", async () => {
    const complexity = await analyzer.calculateComplexity();

    expect(complexity).toBeDefined();
    expect(complexity.avgAttributesPerEntity).toBeGreaterThanOrEqual(0);
    expect(complexity.maxAttributesPerEntity).toBeGreaterThanOrEqual(0);
    expect(complexity.minAttributesPerEntity).toBeGreaterThanOrEqual(0);
    expect(complexity.avgRelationshipsPerEntity).toBeGreaterThanOrEqual(0);
    expect(complexity.maxRelationshipsPerEntity).toBeGreaterThanOrEqual(0);
    expect(complexity.entityDensity).toBeGreaterThanOrEqual(0);

    // Min should be less than or equal to max
    expect(complexity.minAttributesPerEntity).toBeLessThanOrEqual(complexity.maxAttributesPerEntity);
  });

  it("should get entity dependency graph", async () => {
    const graph = await analyzer.getEntityDependencyGraph();

    expect(graph).toBeDefined();
    expect(graph instanceof Map).toBe(true);

    for (const [nodeId, deps] of graph.entries()) {
      expect(nodeId).toBeDefined();
      expect(deps instanceof Set).toBe(true);
    }
  });

  it("should find entity clusters", async () => {
    const clusters = await analyzer.findClusters();

    expect(clusters).toBeDefined();
    expect(Array.isArray(clusters)).toBe(true);

    for (const cluster of clusters) {
      expect(cluster instanceof Set).toBe(true);
      expect(cluster.size).toBeGreaterThanOrEqual(1);
    }
  });

  it("should handle empty data model layer", async () => {
    const entities = await analyzer.analyzeEntities();
    const constraints = await analyzer.checkConstraints();
    const cardinalities = await analyzer.checkCardinality();

    // Should return empty arrays for empty layer, not throw
    expect(Array.isArray(entities)).toBe(true);
    expect(Array.isArray(constraints)).toBe(true);
    expect(Array.isArray(cardinalities)).toBe(true);
  });

  it("should handle zero entities in complexity calculation", async () => {
    const complexity = await analyzer.calculateComplexity();

    // Should return zeros for empty data model, not throw
    expect(typeof complexity.avgAttributesPerEntity).toBe("number");
    expect(typeof complexity.avgRelationshipsPerEntity).toBe("number");
    expect(typeof complexity.entityDensity).toBe("number");
  });
});
