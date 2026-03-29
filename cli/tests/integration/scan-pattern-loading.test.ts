import { describe, it, expect } from "bun:test";
import { loadBuiltinPatterns, filterByConfidence, renderTemplate } from "../../src/scan/pattern-loader.js";

describe("Pattern Loading Integration", () => {
  it("loads all built-in patterns from the CLI package", async () => {
    const patterns = await loadBuiltinPatterns();

    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("provides patterns for all required frameworks", async () => {
    const patterns = await loadBuiltinPatterns();
    const frameworks = patterns.map((p) => p.framework);

    // Verify all frameworks from Phase 2 spec
    const requiredFrameworks = [
      "nestjs",
      "express",
      "nestjs-service",
      "typeorm",
      "prisma",
      "prisma-schema",
      "react",
      "jest",
      "pytest",
      "passport",
      "opentelemetry",
    ];

    for (const framework of requiredFrameworks) {
      expect(frameworks).toContain(framework);
    }
  });

  it("provides patterns for all required architecture layers", async () => {
    const patterns = await loadBuiltinPatterns();
    const layers = [...new Set(patterns.map((p) => p.layer))];

    const requiredLayers = [
      "api",
      "application",
      "data-model",
      "data-store",
      "ux",
      "testing",
      "security",
      "apm",
    ];

    for (const layer of requiredLayers) {
      expect(layers).toContain(layer);
    }
  });

  it("generates valid element IDs from pattern templates", async () => {
    const patterns = await loadBuiltinPatterns();

    // Test rendering a few templates from different pattern sets
    const testCases = [
      {
        pattern: "api.endpoint.{match.controller|kebab}-{match.route|kebab}",
        data: { match: { controller: "UserController", route: "GetUser" } },
        expected: "api.endpoint.user-controller-get-user",
      },
      {
        pattern: "application.service.{match.className|kebab}",
        data: { match: { className: "AuthenticationService" } },
        expected: "application.service.authentication-service",
      },
      {
        pattern: "data-model.entity.{match.modelName|kebab}",
        data: { match: { modelName: "UserModel" } },
        expected: "data-model.entity.user-model",
      },
      {
        pattern: "ux.component.{match.componentName|kebab}",
        data: { match: { componentName: "LoginForm" } },
        expected: "ux.component.login-form",
      },
    ];

    for (const testCase of testCases) {
      const result = renderTemplate(testCase.pattern, testCase.data);
      expect(result).toBe(testCase.expected);
    }
  });

  it("filters patterns below confidence threshold", async () => {
    const patterns = await loadBuiltinPatterns();

    // Create mock candidates from the patterns
    const candidates = patterns
      .slice(0, 5) // Use first 5 pattern sets
      .flatMap((patternSet) =>
        patternSet.patterns.map((pattern) => ({
          id: pattern.id,
          type: pattern.produces.elementType,
          layer: pattern.produces.layer,
          name: pattern.id,
          confidence: pattern.confidence,
          attributes: {},
        }))
      );

    // Filter with different thresholds
    const highConfidence = filterByConfidence(candidates, 0.8);
    const mediumConfidence = filterByConfidence(candidates, 0.7);
    const lowConfidence = filterByConfidence(candidates, 0.5);

    expect(highConfidence.every((c) => c.confidence >= 0.8)).toBe(true);
    expect(mediumConfidence.every((c) => c.confidence >= 0.7)).toBe(true);
    expect(lowConfidence.every((c) => c.confidence >= 0.5)).toBe(true);

    // More permissive threshold should include more candidates
    expect(mediumConfidence.length).toBeGreaterThanOrEqual(highConfidence.length);
    expect(lowConfidence.length).toBeGreaterThanOrEqual(mediumConfidence.length);
  });

  it("provides reasonable confidence scores for all patterns", async () => {
    const patterns = await loadBuiltinPatterns();

    const allPatterns = patterns.flatMap((set) => set.patterns);

    for (const pattern of allPatterns) {
      expect(pattern.confidence).toBeGreaterThanOrEqual(0.6);
      expect(pattern.confidence).toBeLessThanOrEqual(1.0);
    }

    // Verify distribution of confidence scores
    const highConfidence = allPatterns.filter((p) => p.confidence >= 0.85).length;
    const mediumConfidence = allPatterns.filter((p) => p.confidence >= 0.7 && p.confidence < 0.85).length;
    const lowConfidence = allPatterns.filter((p) => p.confidence < 0.7).length;

    // Most patterns should be high or medium confidence
    const totalPatterns = allPatterns.length;
    expect(highConfidence + mediumConfidence).toBeGreaterThan(totalPatterns * 0.5);
  });

  it("provides comprehensive pattern coverage for each layer", async () => {
    const patterns = await loadBuiltinPatterns();

    const byLayer: Record<string, number> = {};
    for (const patternSet of patterns) {
      byLayer[patternSet.layer] = (byLayer[patternSet.layer] || 0) + patternSet.patterns.length;
    }

    // Each layer should have at least 1 pattern
    const requiredLayers = [
      "api",
      "application",
      "data-model",
      "data-store",
      "ux",
      "testing",
      "security",
      "apm",
    ];

    for (const layer of requiredLayers) {
      expect(byLayer[layer]).toBeGreaterThanOrEqual(1);
    }
  });

  it("default confidence threshold matches config specification", () => {
    // The Phase 2 spec defines default threshold as 0.7
    const defaultThreshold = 0.7;

    const candidates = [
      { id: "1", type: "test", layer: "test", name: "test", confidence: 0.8, attributes: {} },
      { id: "2", type: "test", layer: "test", name: "test", confidence: 0.6, attributes: {} },
    ];

    const filtered = filterByConfidence(candidates); // Uses default threshold

    expect(filtered.length).toBe(1);
    expect(filtered[0].confidence).toBeGreaterThanOrEqual(defaultThreshold);
  });
});
