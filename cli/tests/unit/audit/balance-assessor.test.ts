/**
 * Unit tests for BalanceAssessor
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { BalanceAssessor } from "../../../src/audit/relationships/analysis/balance-assessor.js";
import { getLayerById, type LayerMetadata } from "../../../src/generated/layer-registry.js";

describe("BalanceAssessor", () => {
  let assessor: BalanceAssessor;

  beforeAll(() => {
    assessor = new BalanceAssessor();
  });

  it("should assess balance for all layers", () => {
    const assessments = assessor.assessAll();

    expect(assessments).toBeDefined();
    expect(Array.isArray(assessments)).toBe(true);
    expect(assessments.length).toBeGreaterThan(0);

    // Each assessment should have required properties
    for (const assessment of assessments) {
      expect(assessment).toHaveProperty("nodeType");
      expect(assessment).toHaveProperty("layer");
      expect(assessment).toHaveProperty("category");
      expect(assessment).toHaveProperty("currentCount");
      expect(assessment).toHaveProperty("targetRange");
      expect(assessment).toHaveProperty("status");

      // Category must be valid
      expect(["structural", "behavioral", "enumeration", "reference"]).toContain(
        assessment.category
      );

      // Status must be valid
      expect(["under", "balanced", "over"]).toContain(assessment.status);

      // Target range must be valid
      expect(assessment.targetRange.length).toBe(2);
      expect(assessment.targetRange[0]).toBeLessThanOrEqual(
        assessment.targetRange[1]
      );
    }
  });

  it("should classify enumeration types correctly", () => {
    // Use all assessments since motivation no longer has raw enumeration node types
    // (they were collapsed into inline enum attributes on parent schemas)
    const allAssessments = assessor.assessAll();

    // Find enumeration types (types ending in "type", "status", "category", etc.)
    const enumerationTypes = allAssessments.filter(
      (a) => a.category === "enumeration"
    );

    expect(enumerationTypes.length).toBeGreaterThan(0);

    // Enumeration types should have target range [1, 2]
    for (const assessment of enumerationTypes) {
      expect(assessment.targetRange).toEqual([1, 2]);
    }
  });

  it("should classify structural types correctly", () => {
    const applicationLayer = getLayerById("application");
    expect(applicationLayer).toBeDefined();

    const assessments = assessor.assessLayer(applicationLayer!);

    // Find structural types (component, service, etc.)
    const structuralTypes = assessments.filter(
      (a) => a.category === "structural"
    );

    expect(structuralTypes.length).toBeGreaterThan(0);

    // Structural types should have target range [2, 4]
    for (const assessment of structuralTypes) {
      expect(assessment.targetRange).toEqual([2, 4]);
    }
  });

  it("should classify behavioral types correctly", () => {
    const businessLayer = getLayerById("business");
    expect(businessLayer).toBeDefined();

    const assessments = assessor.assessLayer(businessLayer!);

    // Find behavioral types (process, event, etc.)
    const behavioralTypes = assessments.filter(
      (a) => a.category === "behavioral"
    );

    expect(behavioralTypes.length).toBeGreaterThan(0);

    // Behavioral types should have target range [3, 5]
    for (const assessment of behavioralTypes) {
      expect(assessment.targetRange).toEqual([3, 5]);
    }
  });

  it("should classify reference types as default", () => {
    const apiLayer = getLayerById("api");
    expect(apiLayer).toBeDefined();

    const assessments = assessor.assessLayer(apiLayer!);

    // Find reference types (default category)
    const referenceTypes = assessments.filter(
      (a) => a.category === "reference"
    );

    expect(referenceTypes.length).toBeGreaterThan(0);

    // Reference types should have target range [0, 1]
    for (const assessment of referenceTypes) {
      expect(assessment.targetRange).toEqual([0, 1]);
    }
  });

  it("should determine status correctly", () => {
    const assessments = assessor.assessAll();

    // Check status determination
    for (const assessment of assessments) {
      const [min, max] = assessment.targetRange;
      const count = assessment.currentCount;

      if (count < min) {
        expect(assessment.status).toBe("under");
      } else if (count > max) {
        expect(assessment.status).toBe("over");
      } else {
        expect(assessment.status).toBe("balanced");
      }
    }
  });

  it("should provide recommendations for under status", () => {
    const underAssessments = assessor.assessByStatus("under");

    for (const assessment of underAssessments) {
      expect(assessment.recommendation).toBeDefined();
      expect(assessment.recommendation).toContain("Add");
      expect(assessment.recommendation).toContain("relationship");
    }
  });

  it("should provide recommendations for over status", () => {
    const overAssessments = assessor.assessByStatus("over");

    for (const assessment of overAssessments) {
      expect(assessment.recommendation).toBeDefined();
      expect(assessment.recommendation).toContain("removing");
    }
  });

  it("should not provide recommendations for balanced status", () => {
    const balancedAssessments = assessor.assessByStatus("balanced");

    for (const assessment of balancedAssessments) {
      expect(assessment.recommendation).toBeUndefined();
    }
  });

  it("should filter assessments by status", () => {
    const underAssessments = assessor.assessByStatus("under");
    const balancedAssessments = assessor.assessByStatus("balanced");
    const overAssessments = assessor.assessByStatus("over");

    // All should have correct status
    for (const assessment of underAssessments) {
      expect(assessment.status).toBe("under");
    }
    for (const assessment of balancedAssessments) {
      expect(assessment.status).toBe("balanced");
    }
    for (const assessment of overAssessments) {
      expect(assessment.status).toBe("over");
    }
  });

  it("should filter assessments by category", () => {
    const structuralAssessments = assessor.assessByCategory("structural");
    const behavioralAssessments = assessor.assessByCategory("behavioral");
    const enumerationAssessments = assessor.assessByCategory("enumeration");
    const referenceAssessments = assessor.assessByCategory("reference");

    // All should have correct category
    for (const assessment of structuralAssessments) {
      expect(assessment.category).toBe("structural");
    }
    for (const assessment of behavioralAssessments) {
      expect(assessment.category).toBe("behavioral");
    }
    for (const assessment of enumerationAssessments) {
      expect(assessment.category).toBe("enumeration");
    }
    for (const assessment of referenceAssessments) {
      expect(assessment.category).toBe("reference");
    }
  });

  it("should identify zero-relationship node types correctly", () => {
    // Use a mock layer with fake node types covering each category so we can
    // verify the zero-relationship behavior independently of the real spec.
    // Fake IDs won't exist in RELATIONSHIPS_BY_SOURCE, so currentCount will be 0.
    const mockLayer: LayerMetadata = {
      id: "mock-zero",
      number: 99,
      name: "Mock Zero Layer",
      description: "Mock layer for zero-relationship testing",
      nodeTypes: [
        "mock-zero.myreference",     // → "reference" (default, no keyword match)
        "mock-zero.mytype",          // → "enumeration" (endsWith "type")
        "mock-zero.myservice",       // → "structural" (includes "service")
        "mock-zero.myprocess",       // → "behavioral" (includes "process")
      ],
    };

    const assessments = assessor.assessLayer(mockLayer);

    // All mock node types have zero relationships (not in RELATIONSHIPS_BY_SOURCE)
    for (const assessment of assessments) {
      expect(assessment.currentCount).toBe(0);

      // Status depends on category and target range:
      // - Enumeration types (target [1, 2]): under (0 < 1)
      // - Reference types (target [0, 1]): balanced (0 is in range)
      // - Structural types (target [2, 4]): under (0 < 2)
      // - Behavioral types (target [3, 5]): under (0 < 3)
      if (assessment.category === "reference") {
        expect(assessment.status).toBe("balanced");
      } else {
        expect(assessment.status).toBe("under");
      }
    }
  });
});
