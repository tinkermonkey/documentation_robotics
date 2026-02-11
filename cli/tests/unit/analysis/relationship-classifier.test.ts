import { describe, it, expect, beforeAll } from "bun:test";
import { RelationshipCatalog } from "@/core/relationship-catalog";
import { RelationshipClassifier } from "@/analysis/relationship-classifier";
import type { Relationship } from "@/types/index";

describe("RelationshipClassifier", () => {
  let classifier: RelationshipClassifier;

  beforeAll(async () => {
    const catalog = new RelationshipCatalog();
    classifier = new RelationshipClassifier(catalog);
    await classifier.load();
  });

  it("should create a classifier instance", () => {
    expect(classifier).toBeDefined();
  });

  it("should classify a single relationship", async () => {
    const rel: Relationship = {
      source: "motivation.goal.customer-satisfaction",
      target: "business.process.order-management",
      predicate: "supports",
    };

    const classified = await classifier.classify(rel);

    expect(classified).toBeDefined();
    expect(classified.source).toBe(rel.source);
    expect(classified.target).toBe(rel.target);
    expect(classified.predicate).toBe(rel.predicate);
    expect(classified.category).toBeDefined();
    expect(classified.sourceLayer).toBe("motivation");
    expect(classified.targetLayer).toBe("business");
    expect(classified.isCrossLayer).toBe(true);
  });

  it("should classify batch of relationships", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.customer-satisfaction",
        target: "business.process.order-management",
        predicate: "supports",
      },
      {
        source: "business.process.order-management",
        target: "application.service.order-service",
        predicate: "realizes",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);

    expect(classified).toBeDefined();
    expect(classified.length).toBe(2);
    expect(classified[0].predicate).toBe("supports");
    expect(classified[1].predicate).toBe("realizes");
  });

  it("should get category breakdown", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.test1",
        target: "business.process.test1",
        predicate: "supports",
      },
      {
        source: "motivation.goal.test2",
        target: "business.process.test2",
        predicate: "supports",
      },
      {
        source: "business.process.test1",
        target: "application.service.test1",
        predicate: "realizes",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);
    const breakdown = await classifier.getCategoryBreakdown(classified);

    expect(breakdown).toBeDefined();
    expect(Array.isArray(breakdown)).toBe(true);
    expect(breakdown.length).toBeGreaterThan(0);

    // Check that breakdown entries have correct structure
    for (const entry of breakdown) {
      expect(entry.category).toBeDefined();
      expect(entry.count).toBeGreaterThan(0);
      expect(entry.percentage).toBeGreaterThan(0);
      expect(entry.percentage).toBeLessThanOrEqual(100);
      expect(Array.isArray(entry.predicates)).toBe(true);
    }
  });

  it("should analyze transitive relationships", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.test1",
        target: "motivation.goal.test2",
        predicate: "depends-on",
      },
      {
        source: "motivation.goal.test2",
        target: "motivation.goal.test3",
        predicate: "depends-on",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);
    const analysis = await classifier.analyzeTransitivity(classified, "depends-on");

    expect(analysis).toBeDefined();
    expect(analysis.predicate).toBe("depends-on");
    expect(typeof analysis.isTransitive).toBe("boolean");
    expect(Array.isArray(analysis.chains)).toBe(true);
  });

  it("should validate semantic compliance", async () => {
    const rel: Relationship = {
      source: "motivation.goal.test1",
      target: "business.process.test1",
      predicate: "supports",
    };

    const classified = await classifier.classify(rel);
    const validation = await classifier.validateSemantics(classified);

    expect(validation).toBeDefined();
    expect(typeof validation.isValid).toBe("boolean");
    expect(validation.category).toBeDefined();
    expect(validation.predicate).toBeDefined();
    expect(Array.isArray(validation.issues)).toBe(true);
    expect(Array.isArray(validation.warnings)).toBe(true);
  });

  it("should validate batch of relationships", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.test1",
        target: "business.process.test1",
        predicate: "supports",
      },
      {
        source: "business.process.test1",
        target: "application.service.test1",
        predicate: "realizes",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);
    const validations = await classifier.validateBatch(classified);

    expect(validations).toBeDefined();
    expect(validations.length).toBe(2);

    for (const validation of validations) {
      expect(typeof validation.isValid).toBe("boolean");
      expect(Array.isArray(validation.issues)).toBe(true);
    }
  });

  it("should find semantic violations", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.test1",
        target: "business.process.test1",
        predicate: "supports",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);
    const violations = await classifier.findSemanticViolations(classified);

    expect(Array.isArray(violations)).toBe(true);
    // Violations should be a subset of validations
    expect(violations.length).toBeLessThanOrEqual(classified.length);
  });

  it("should analyze relationship patterns", async () => {
    const relationships: Relationship[] = [
      {
        source: "motivation.goal.test1",
        target: "business.process.test1",
        predicate: "supports",
      },
      {
        source: "motivation.goal.test2",
        target: "business.process.test2",
        predicate: "supports",
      },
      {
        source: "business.process.test1",
        target: "application.service.test1",
        predicate: "realizes",
      },
      {
        source: "business.process.test2",
        target: "application.service.test2",
        predicate: "realizes",
      },
    ];

    const classified = await classifier.classifyBatch(relationships);
    const patterns = await classifier.analyzePatterns(classified);

    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);

    // Should be sorted by count descending
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1].count).toBeGreaterThanOrEqual(patterns[i].count);
    }

    // Check pattern structure
    for (const pattern of patterns) {
      expect(pattern.predicate).toBeDefined();
      expect(pattern.category).toBeDefined();
      expect(pattern.count).toBeGreaterThan(0);
      expect(pattern.percentage).toBeGreaterThan(0);
      expect(pattern.percentage).toBeLessThanOrEqual(100);
      expect(Array.isArray(pattern.examples)).toBe(true);
    }
  });

  it("should handle intra-layer relationships", async () => {
    const rel: Relationship = {
      source: "motivation.goal.test1",
      target: "motivation.goal.test2",
      predicate: "depends-on",
    };

    const classified = await classifier.classify(rel);

    expect(classified.sourceLayer).toBe("motivation");
    expect(classified.targetLayer).toBe("motivation");
    expect(classified.isCrossLayer).toBe(false);
  });
});
