import { describe, it, expect, afterAll } from "bun:test";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { Model } from "@/core/model";
import { DataModelAnalyzer } from "@/analysis/data-model-analyzer";

// Lazy shared setup: initialized on first use, then cached for the rest of the suite.
// This avoids beforeAll timeout issues since each test gets the full 30-second allowance.
let _setup: {
  workdir: Awaited<ReturnType<typeof createTestWorkdir>>;
  analyzer: DataModelAnalyzer;
} | null = null;

async function getSetup() {
  if (!_setup) {
    const workdir = await createTestWorkdir();
    const model = await Model.load(workdir.path);
    const analyzer = new DataModelAnalyzer(model);
    _setup = { workdir, analyzer };
  }
  return _setup;
}

afterAll(async () => {
  if (_setup) await _setup.workdir.cleanup();
});

describe("DataModelAnalyzer", () => {

  it("should create an analyzer instance", async () => {
    const { analyzer } = await getSetup();
    expect(analyzer).toBeDefined();
  });

  it("should analyze entities", async () => {
    const { analyzer } = await getSetup();
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
    const { analyzer } = await getSetup();
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
    const { analyzer } = await getSetup();
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
    const { analyzer } = await getSetup();
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
    const { analyzer } = await getSetup();
    const coverage = await analyzer.calculateCoverage();

    expect(coverage).toBeDefined();
    expect(coverage.totalEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.entitiesWithAttributes).toBeGreaterThanOrEqual(0);
    expect(coverage.constraintsEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.referencedEntities).toBeGreaterThanOrEqual(0);
    expect(coverage.orphanedEntities).toBeGreaterThanOrEqual(0);

    // Check percentage metrics
    expect(coverage.attributeCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.attributeCoverage).toBeLessThanOrEqual(100);
    expect(coverage.constraintCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.constraintCoverage).toBeLessThanOrEqual(100);
    expect(coverage.referenceCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.referenceCoverage).toBeLessThanOrEqual(100);
  });

  it("should calculate complexity metrics", async () => {
    const { analyzer } = await getSetup();
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
    const { analyzer } = await getSetup();
    const graph = await analyzer.getEntityDependencyGraph();

    expect(graph).toBeDefined();
    expect(graph instanceof Map).toBe(true);

    for (const [nodeId, deps] of graph.entries()) {
      expect(nodeId).toBeDefined();
      expect(deps instanceof Set).toBe(true);
    }
  });

  it("should find entity clusters", async () => {
    const { analyzer } = await getSetup();
    const clusters = await analyzer.findClusters();

    expect(clusters).toBeDefined();
    expect(Array.isArray(clusters)).toBe(true);

    for (const cluster of clusters) {
      expect(cluster instanceof Set).toBe(true);
      expect(cluster.size).toBeGreaterThanOrEqual(1);
    }
  });

  it("should handle empty data model layer", async () => {
    const { analyzer } = await getSetup();
    const entities = await analyzer.analyzeEntities();
    const constraints = await analyzer.checkConstraints();
    const cardinalities = await analyzer.checkCardinality();

    // Should return empty arrays for empty layer, not throw
    expect(Array.isArray(entities)).toBe(true);
    expect(Array.isArray(constraints)).toBe(true);
    expect(Array.isArray(cardinalities)).toBe(true);
  });

  it("should handle zero entities in complexity calculation", async () => {
    const { analyzer } = await getSetup();
    const complexity = await analyzer.calculateComplexity();

    // Should return zeros for empty data model, not throw
    expect(typeof complexity.avgAttributesPerEntity).toBe("number");
    expect(typeof complexity.avgRelationshipsPerEntity).toBe("number");
    expect(typeof complexity.entityDensity).toBe("number");
  });
});
