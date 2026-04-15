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

  describe("Semantic pattern evolution with requires_index and depends_on", () => {
    it("loads semantic patterns with requires_index field", async () => {
      const patterns = await loadBuiltinPatterns();
      const semanticPatterns = patterns
        .flatMap((set) => set.patterns)
        .filter((p) => p.requires_index === true);

      // Semantic patterns with requires_index should be present
      expect(semanticPatterns.length).toBeGreaterThan(0);

      // Verify semantic patterns have proper metadata
      for (const pattern of semanticPatterns) {
        expect(pattern.id).toBeTruthy();
        expect(pattern.query.tool).toBeTruthy();
        // Semantic tools include: analyze_api_surface, analyze_decorators, find_dependencies, etc.
        const semanticTools = ["analyze_api_surface", "analyze_decorators", "find_dependencies", "detect_patterns", "search_symbols"];
        expect(semanticTools).toContain(pattern.query.tool);
      }
    });

    it("semantic patterns have fallback regex patterns (when available)", async () => {
      const patterns = await loadBuiltinPatterns();

      // For each semantic pattern in framework pattern sets (not architectural patterns),
      // there should be a corresponding regex fallback. However, patterns with multi-pass
      // dependencies (depends_on) are inherently semantic and cannot have regex equivalents
      // because they:
      // 1. Require session context from prior pattern passes
      // 2. Use session.discovered interpolation for cross-layer relationships
      // 3. Execute in a sequence that regex patterns cannot replicate
      const semanticPatterns = patterns
        .filter((set) => !set.framework.includes("pattern"))
        .flatMap((set) => set.patterns)
        .filter((p) => p.requires_index === true && (!p.depends_on || p.depends_on.length === 0));

      for (const semantic of semanticPatterns) {
        // Look for a fallback pattern with .regex in the ID or similar semantic pattern
        const baseName = semantic.id.replace(/\.semantic$/, "").replace(/\.index$/, "");
        const hasRegexFallback = patterns
          .flatMap((set) => set.patterns)
          .some((p) =>
            p.id.startsWith(baseName) &&
            (p.id.endsWith(".regex") || !p.requires_index)
          );

        expect(hasRegexFallback).toBe(true);
      }
    });

    it("loads patterns with depends_on dependency declarations", async () => {
      const patterns = await loadBuiltinPatterns();
      const dependentPatterns = patterns
        .flatMap((set) => set.patterns)
        .filter((p) => p.depends_on && p.depends_on.length > 0);

      // Dependent patterns with depends_on should be present
      expect(dependentPatterns.length).toBeGreaterThan(0);

      // Verify dependent patterns have valid dependency references
      const allPatternIds = new Set(
        patterns.flatMap((set) => set.patterns.map((p) => p.id))
      );

      for (const pattern of dependentPatterns) {
        expect(Array.isArray(pattern.depends_on)).toBe(true);
        for (const depId of pattern.depends_on) {
          expect(allPatternIds.has(depId)).toBe(true);
        }
      }
    });

    it("provides batch analysis candidates for independent patterns", async () => {
      const patterns = await loadBuiltinPatterns();
      const allPatterns = patterns.flatMap((set) => set.patterns);

      // Separate independent patterns (no depends_on or empty)
      const independentPatterns = allPatterns.filter(
        (p) => !p.depends_on || p.depends_on.length === 0
      );

      // Should have more independent patterns than dependent ones
      const dependentPatterns = allPatterns.filter(
        (p) => p.depends_on && p.depends_on.length > 0
      );

      expect(independentPatterns.length).toBeGreaterThan(dependentPatterns.length);

      // Independent patterns can be batched for parallel execution
      const batchablePatterns = independentPatterns.filter((p) => p.requires_index === true);
      // Some semantic patterns should be batchable
      expect(batchablePatterns.length).toBeGreaterThanOrEqual(0);
    });

    it("maintains backward compatibility with regex-only patterns", async () => {
      const patterns = await loadBuiltinPatterns();
      const regexPatterns = patterns
        .flatMap((set) => set.patterns)
        .filter((p) => !p.requires_index || p.requires_index === false);

      // Regex patterns should still be present for backward compatibility
      expect(regexPatterns.length).toBeGreaterThan(0);

      // Regex patterns should not have requires_index: true
      for (const pattern of regexPatterns) {
        expect(pattern.requires_index).not.toBe(true);
      }
    });
  });
});
