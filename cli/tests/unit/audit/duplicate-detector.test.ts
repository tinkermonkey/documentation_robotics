/**
 * Unit tests for DuplicateDetector
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { DuplicateDetector } from "../../../src/audit/analysis/duplicate-detector.js";
import { RelationshipCatalog } from "../../../src/core/relationship-catalog.js";

describe("DuplicateDetector", () => {
  let catalog: RelationshipCatalog;
  let detector: DuplicateDetector;

  beforeAll(async () => {
    catalog = new RelationshipCatalog();
    await catalog.load();
    detector = new DuplicateDetector(catalog);
  });

  it("should detect duplicate candidates", async () => {
    const duplicates = await detector.detectDuplicates();

    expect(duplicates).toBeDefined();
    expect(Array.isArray(duplicates)).toBe(true);

    // Each duplicate should have required properties
    for (const dup of duplicates) {
      expect(dup).toHaveProperty("relationships");
      expect(dup).toHaveProperty("predicates");
      expect(dup).toHaveProperty("sourceNodeType");
      expect(dup).toHaveProperty("destinationNodeType");
      expect(dup).toHaveProperty("reason");
      expect(dup).toHaveProperty("confidence");

      // Confidence must be valid
      expect(["high", "medium", "low"]).toContain(dup.confidence);

      // Should have exactly 2 relationships
      expect(dup.relationships.length).toBe(2);
      expect(dup.predicates.length).toBe(2);
    }
  });

  it("should identify duplicates with same category", async () => {
    const duplicates = await detector.detectDuplicates();

    // Find duplicates where both predicates are in same category
    const sameCategoryDuplicates = duplicates.filter((dup) =>
      dup.reason.includes("category")
    );

    for (const dup of sameCategoryDuplicates) {
      const pred1 = catalog.getTypeByPredicate(dup.predicates[0]);
      const pred2 = catalog.getTypeByPredicate(dup.predicates[1]);

      expect(pred1).toBeDefined();
      expect(pred2).toBeDefined();
      expect(pred1?.category).toBe(pred2?.category);
    }
  });

  it("should assign confidence levels correctly", async () => {
    const duplicates = await detector.detectDuplicates();

    // High confidence should have matching semantics
    const highConfidence = duplicates.filter((d) => d.confidence === "high");
    for (const dup of highConfidence) {
      const pred1 = catalog.getTypeByPredicate(dup.predicates[0]);
      const pred2 = catalog.getTypeByPredicate(dup.predicates[1]);

      expect(pred1).toBeDefined();
      expect(pred2).toBeDefined();

      // Should have same category
      expect(pred1?.category).toBe(pred2?.category);
    }
  });

  it("should filter duplicates by layer", async () => {
    const motivationDuplicates = await detector.detectDuplicatesByLayer(
      "motivation"
    );

    // All duplicates should be from motivation layer
    for (const dup of motivationDuplicates) {
      expect(dup.sourceNodeType.startsWith("motivation.")).toBe(true);
    }
  });

  it("should filter duplicates by confidence", async () => {
    const highConfidence = await detector.detectDuplicatesByConfidence("high");
    const mediumConfidence = await detector.detectDuplicatesByConfidence(
      "medium"
    );
    const lowConfidence = await detector.detectDuplicatesByConfidence("low");

    // Each should only contain specified confidence
    for (const dup of highConfidence) {
      expect(dup.confidence).toBe("high");
    }
    for (const dup of mediumConfidence) {
      expect(dup.confidence).toBe("medium");
    }
    for (const dup of lowConfidence) {
      expect(dup.confidence).toBe("low");
    }
  });

  it("should provide meaningful reasons", async () => {
    const duplicates = await detector.detectDuplicates();

    for (const dup of duplicates) {
      expect(dup.reason.length).toBeGreaterThan(0);
      expect(dup.reason).not.toBe("Unknown");
    }
  });

  it("should handle relationships with no duplicates", async () => {
    const duplicates = await detector.detectDuplicates();

    // Should not throw error
    expect(duplicates).toBeDefined();

    // Each duplicate should have valid relationship IDs
    for (const dup of duplicates) {
      expect(dup.relationships[0]).toBeTruthy();
      expect(dup.relationships[1]).toBeTruthy();
      expect(dup.relationships[0]).not.toBe(dup.relationships[1]);
    }
  });
});
