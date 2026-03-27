import { describe, it, expect, beforeEach } from "bun:test";
import {
  PatternSetSchema,
  PatternDefinitionSchema,
  loadBuiltinPatterns,
  loadProjectPatterns,
  mergePatterns,
  filterByConfidence,
  renderTemplate,
  type ElementCandidate,
  type PatternSet,
} from "../../../src/scan/pattern-loader.js";
import { z } from "zod";

describe("Pattern Loader", () => {
  describe("PatternSetSchema Validation", () => {
    it("validates a complete pattern set with required fields", () => {
      const validPatternSet = {
        layer: "api",
        framework: "nestjs",
        version: "1.0",
        patterns: [
          {
            id: "nestjs.controller.route",
            produces: {
              type: "node",
              layer: "api",
              elementType: "endpoint",
            },
            query: {
              tool: "search_code",
              params: { pattern: "@Get" },
            },
            confidence: 0.85,
            mapping: {
              id: "api.endpoint.{match.controller}",
              name: "{match.route}",
              attributes: {},
            },
          },
        ],
      };

      expect(() => PatternSetSchema.parse(validPatternSet)).not.toThrow();
    });

    it("rejects pattern set missing framework", () => {
      const invalidPatternSet = {
        layer: "api",
        patterns: [],
      };

      expect(() => PatternSetSchema.parse(invalidPatternSet)).toThrow();
    });

    it("rejects pattern set with invalid confidence", () => {
      const invalidPatternSet = {
        layer: "api",
        framework: "test",
        patterns: [
          {
            id: "test.pattern",
            produces: { type: "node", layer: "api", elementType: "endpoint" },
            query: { tool: "search_code" },
            confidence: 1.5, // Invalid: > 1.0
            mapping: { id: "api.endpoint.test" },
          },
        ],
      };

      expect(() => PatternSetSchema.parse(invalidPatternSet)).toThrow();
    });

    it("accepts relationship pattern with relationshipType", () => {
      const validRelationshipPattern = {
        layer: "api",
        framework: "test",
        patterns: [
          {
            id: "test.relationship",
            produces: {
              type: "relationship",
              layer: "api",
              elementType: "endpoint",
              relationshipType: "depends-on",
            },
            query: { tool: "get_definitions" },
            confidence: 0.75,
            mapping: { source: "api.endpoint.a", target: "api.endpoint.b" },
          },
        ],
      };

      expect(() => PatternSetSchema.parse(validRelationshipPattern)).not.toThrow();
    });
  });

  describe("PatternDefinitionSchema Validation", () => {
    it("validates a complete pattern definition", () => {
      const validPattern = {
        id: "nestjs.controller.route",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: {
          tool: "search_code",
          params: { pattern: "@Get" },
        },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.{match.controller}",
          name: "{match.route}",
        },
      };

      expect(() => PatternDefinitionSchema.parse(validPattern)).not.toThrow();
    });

    it("rejects pattern with missing id", () => {
      const invalidPattern = {
        produces: { type: "node", layer: "api", elementType: "endpoint" },
        query: { tool: "search_code" },
        confidence: 0.85,
        mapping: { id: "api.endpoint.test" },
      };

      expect(() => PatternDefinitionSchema.parse(invalidPattern)).toThrow();
    });

    it("rejects pattern with confidence out of range", () => {
      const tooLowConfidence = {
        id: "test.pattern",
        produces: { type: "node", layer: "api", elementType: "endpoint" },
        query: { tool: "search_code" },
        confidence: -0.1,
        mapping: { id: "api.endpoint.test" },
      };

      expect(() => PatternDefinitionSchema.parse(tooLowConfidence)).toThrow();
    });

    it("accepts confidence at boundary values (0.0 and 1.0)", () => {
      const minConfidence = {
        id: "test.min",
        produces: { type: "node", layer: "api", elementType: "endpoint" },
        query: { tool: "search_code" },
        confidence: 0.0,
        mapping: { id: "api.endpoint.test" },
      };

      const maxConfidence = {
        id: "test.max",
        produces: { type: "node", layer: "api", elementType: "endpoint" },
        query: { tool: "search_code" },
        confidence: 1.0,
        mapping: { id: "api.endpoint.test" },
      };

      expect(() => PatternDefinitionSchema.parse(minConfidence)).not.toThrow();
      expect(() => PatternDefinitionSchema.parse(maxConfidence)).not.toThrow();
    });
  });

  describe("loadBuiltinPatterns()", () => {
    it("loads all built-in pattern sets without error", async () => {
      const patterns = await loadBuiltinPatterns();

      expect(patterns).toBeDefined();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("loads patterns for all required frameworks", async () => {
      const patterns = await loadBuiltinPatterns();
      const frameworks = patterns.map((p) => p.framework);

      // Check for all required frameworks from Phase 2 spec
      expect(frameworks).toContain("nestjs");
      expect(frameworks).toContain("express");
      expect(frameworks).toContain("nestjs-service");
      expect(frameworks).toContain("typeorm");
      expect(frameworks).toContain("prisma");
      expect(frameworks).toContain("prisma-schema");
      expect(frameworks).toContain("react");
      expect(frameworks).toContain("jest");
      expect(frameworks).toContain("pytest");
      expect(frameworks).toContain("passport");
      expect(frameworks).toContain("opentelemetry");
    });

    it("loads patterns for all required layers", async () => {
      const patterns = await loadBuiltinPatterns();
      const layers = [...new Set(patterns.map((p) => p.layer))];

      expect(layers).toContain("api");
      expect(layers).toContain("application");
      expect(layers).toContain("data-model");
      expect(layers).toContain("data-store");
      expect(layers).toContain("ux");
      expect(layers).toContain("testing");
      expect(layers).toContain("security");
      expect(layers).toContain("apm");
    });

    it("validates all loaded pattern sets against schema", async () => {
      const patterns = await loadBuiltinPatterns();

      for (const patternSet of patterns) {
        expect(() => PatternSetSchema.parse(patternSet)).not.toThrow();
      }
    });

    it("each pattern has valid confidence scores", async () => {
      const patterns = await loadBuiltinPatterns();

      for (const patternSet of patterns) {
        for (const pattern of patternSet.patterns) {
          expect(pattern.confidence).toBeGreaterThanOrEqual(0);
          expect(pattern.confidence).toBeLessThanOrEqual(1);
        }
      }
    });

    it("loads all built-in patterns successfully", async () => {
      const patterns = await loadBuiltinPatterns();
      expect(patterns.length).toBeGreaterThan(0); // Proves files were found
    });

    it("throws error with descriptive message when pattern has invalid schema", () => {
      // Test that PatternSetSchema properly validates and reports schema errors
      const invalidPatternSet = {
        layer: "api",
        framework: "test",
        patterns: [
          {
            id: "test.pattern",
            produces: { type: "node", layer: "api", elementType: "endpoint" },
            query: { tool: "search_code" },
            confidence: 1.5, // Invalid: exceeds max of 1.0
            mapping: { id: "api.endpoint.test" },
          },
        ],
      };

      expect(() => PatternSetSchema.parse(invalidPatternSet)).toThrow("confidence");
    });
  });

  describe("loadProjectPatterns()", () => {
    it("returns empty array when project patterns directory doesn't exist", async () => {
      const patterns = await loadProjectPatterns("/nonexistent/path");
      expect(patterns).toEqual([]);
    });

    it("accepts custom pattern directory", async () => {
      // Implementation should accept custom directory parameter
      const patterns = await loadProjectPatterns("/nonexistent/path", "custom/patterns");
      expect(patterns).toEqual([]);
    });
  });

  describe("mergePatterns()", () => {
    beforeEach(() => {
      // Pattern sets for testing
    });

    it("merges builtin and project patterns", () => {
      const builtinPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "nestjs",
          version: "1.0",
          patterns: [
            {
              id: "nestjs.controller",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.9,
              mapping: { id: "api.endpoint.test" },
            },
          ],
        },
      ];

      const projectPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "custom",
          patterns: [
            {
              id: "custom.endpoint",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.8,
              mapping: { id: "api.endpoint.custom" },
            },
          ],
        },
      ];

      const merged = mergePatterns(builtinPatterns, projectPatterns);

      expect(merged.length).toBe(2);
      expect(merged[0].framework).toBe("nestjs");
      expect(merged[1].framework).toBe("custom");
    });

    it("project patterns override builtin patterns with same ID", () => {
      const builtinPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "nestjs",
          version: "1.0",
          patterns: [
            {
              id: "nestjs.controller",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.9,
              mapping: { id: "api.endpoint.builtin" },
            },
          ],
        },
      ];

      const projectPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "custom",
          patterns: [
            {
              id: "nestjs.controller", // Same ID as builtin - should override
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.75,
              mapping: { id: "api.endpoint.custom" },
            },
          ],
        },
      ];

      const merged = mergePatterns(builtinPatterns, projectPatterns);

      // Should have 1 framework (nestjs) since custom's only pattern overrides builtin
      expect(merged.length).toBe(1);

      // Find nestjs and verify it has the overridden pattern
      const nestjsSet = merged.find((p) => p.framework === "nestjs");
      expect(nestjsSet?.patterns[0].id).toBe("nestjs.controller");
      expect(nestjsSet?.patterns[0].confidence).toBe(0.75); // From project
      expect((nestjsSet?.patterns[0].mapping as any).id).toBe("api.endpoint.custom");

      // Custom framework should NOT be present since all its patterns override builtin
      const customSet = merged.find((p) => p.framework === "custom");
      expect(customSet).toBeUndefined();
    });

    it("preserves builtin patterns order when no overrides", () => {
      const builtinPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "nestjs",
          patterns: [
            {
              id: "nestjs.test",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "test" },
              confidence: 0.8,
              mapping: { id: "api.test" },
            },
          ],
        },
        {
          layer: "api",
          framework: "express",
          patterns: [
            {
              id: "express.test",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "test" },
              confidence: 0.8,
              mapping: { id: "api.test" },
            },
          ],
        },
        {
          layer: "data-model",
          framework: "typeorm",
          patterns: [
            {
              id: "typeorm.test",
              produces: { type: "node", layer: "data-model", elementType: "entity" },
              query: { tool: "test" },
              confidence: 0.8,
              mapping: { id: "data-model.test" },
            },
          ],
        },
      ];

      const projectPatterns: PatternSet[] = [];

      const merged = mergePatterns(builtinPatterns, projectPatterns);

      expect(merged.length).toBe(3);
      expect(merged[0].framework).toBe("nestjs");
      expect(merged[1].framework).toBe("express");
      expect(merged[2].framework).toBe("typeorm");
    });

    it("project pattern with matching ID overrides builtin pattern", () => {
      const builtinPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "nestjs",
          version: "1.0",
          patterns: [
            {
              id: "nestjs.controller.route",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.85,
              mapping: { id: "api.endpoint.builtin" },
            },
          ],
        },
      ];

      const projectPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "custom",
          patterns: [
            {
              id: "nestjs.controller.route", // Same ID as builtin - overrides
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.95,
              mapping: { id: "api.endpoint.custom-override" },
            },
          ],
        },
      ];

      const merged = mergePatterns(builtinPatterns, projectPatterns);

      // Should have only 1 pattern set (nestjs) since custom's only pattern overrides builtin
      expect(merged.length).toBe(1);

      // Find the nestjs pattern set and verify the override
      const nestjsSet = merged.find((p) => p.framework === "nestjs");
      expect(nestjsSet).toBeDefined();
      expect(nestjsSet?.patterns[0].confidence).toBe(0.95);
      expect(nestjsSet?.patterns[0].mapping.id).toBe("api.endpoint.custom-override");

      // Custom framework should NOT be in result since all its patterns override builtin
      const customSet = merged.find((p) => p.framework === "custom");
      expect(customSet).toBeUndefined();
    });

    it("duplicate project pattern IDs in non-builtin patterns throw error", () => {
      // When the same pattern ID appears in two different project frameworks (not overriding builtin),
      // it should throw an error
      const builtinPatterns: PatternSet[] = [];

      const projectPatterns: PatternSet[] = [
        {
          layer: "api",
          framework: "custom1",
          patterns: [
            {
              id: "custom.newpattern",
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.8,
              mapping: { id: "api.endpoint.dup1" },
            },
          ],
        },
        {
          layer: "api",
          framework: "custom2",
          patterns: [
            {
              id: "custom.newpattern", // Duplicate ID not in builtin
              produces: { type: "node", layer: "api", elementType: "endpoint" },
              query: { tool: "search_code" },
              confidence: 0.8,
              mapping: { id: "api.endpoint.dup2" },
            },
          ],
        },
      ];

      expect(() => mergePatterns(builtinPatterns, projectPatterns)).toThrow(/Duplicate pattern ID/);
    });
  });

  describe("filterByConfidence()", () => {
    let candidates: ElementCandidate[];

    beforeEach(() => {
      candidates = [
        {
          id: "api.endpoint.perfect",
          type: "endpoint",
          layer: "api",
          name: "PerfectConfidence",
          confidence: 1.0,
          attributes: {},
        },
        {
          id: "api.endpoint.high",
          type: "endpoint",
          layer: "api",
          name: "HighConfidence",
          confidence: 0.95,
          attributes: {},
        },
        {
          id: "api.endpoint.medium",
          type: "endpoint",
          layer: "api",
          name: "MediumConfidence",
          confidence: 0.75,
          attributes: {},
        },
        {
          id: "api.endpoint.low",
          type: "endpoint",
          layer: "api",
          name: "LowConfidence",
          confidence: 0.65,
          attributes: {},
        },
        {
          id: "api.endpoint.zero",
          type: "endpoint",
          layer: "api",
          name: "ZeroConfidence",
          confidence: 0.0,
          attributes: {},
        },
      ];
    });

    it("filters candidates below default threshold (0.7)", () => {
      const filtered = filterByConfidence(candidates);

      expect(filtered.length).toBe(3);
      expect(filtered[0].id).toBe("api.endpoint.perfect");
      expect(filtered[1].id).toBe("api.endpoint.high");
      expect(filtered[2].id).toBe("api.endpoint.medium");
    });

    it("filters candidates below custom threshold", () => {
      const filtered = filterByConfidence(candidates, 0.8);

      expect(filtered.length).toBe(2);
      expect(filtered[0].id).toBe("api.endpoint.perfect");
      expect(filtered[1].id).toBe("api.endpoint.high");
    });

    it("includes candidates exactly at threshold", () => {
      const filtered = filterByConfidence(candidates, 0.75);

      expect(filtered.length).toBe(3);
      expect(filtered[0].id).toBe("api.endpoint.perfect");
      expect(filtered[1].id).toBe("api.endpoint.high");
      expect(filtered[2].id).toBe("api.endpoint.medium");
    });

    it("includes all candidates with threshold 0.0", () => {
      const filtered = filterByConfidence(candidates, 0.0);

      expect(filtered.length).toBe(5);
    });

    it("excludes all candidates below perfect confidence threshold 1.0", () => {
      const filtered = filterByConfidence(candidates, 1.0);

      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("api.endpoint.perfect");
    });

    it("throws error for invalid threshold values", () => {
      expect(() => filterByConfidence(candidates, -0.1)).toThrow();
      expect(() => filterByConfidence(candidates, 1.1)).toThrow();
    });

    it("silently discards low confidence matches (no errors or warnings)", () => {
      const result = filterByConfidence(candidates, 0.9);

      expect(result.length).toBe(2);
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.9);
      expect(result[1].confidence).toBeGreaterThanOrEqual(0.9);
      // No errors thrown, no console output expected
    });
  });

  describe("renderTemplate()", () => {
    it("renders simple field substitution", () => {
      const template = "api.endpoint.{match.name}";
      const data = { match: { name: "createUser" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("api.endpoint.createUser");
    });

    it("renders kebab-case transformation", () => {
      const template = "{match.className|kebab}";
      const data = { match: { className: "CreateUserController" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("create-user-controller");
    });

    it("renders uppercase transformation", () => {
      const template = "{match.method|upper}";
      const data = { match: { method: "get" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("GET");
    });

    it("renders chained transformations", () => {
      const template = "{match.name|kebab|upper}";
      const data = { match: { name: "CreateUser" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("CREATE-USER");
    });

    it("handles nested object paths", () => {
      const template = "{source.parent.child}";
      const data = { source: { parent: { child: "value" } } };

      const result = renderTemplate(template, data);

      expect(result).toBe("value");
    });

    it("throws error for missing data", () => {
      const template = "api.endpoint.{match.missing}";
      const data = { match: { name: "test" } };

      expect(() => renderTemplate(template, data)).toThrow(
        /Template rendering failed.*cannot resolve placeholder.*match\.missing/
      );
    });

    it("handles multiple placeholders in single template", () => {
      const template = "api.endpoint.{match.controller|kebab}-{match.method|lower}";
      const data = { match: { controller: "UserController", method: "GET" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("api.endpoint.user-controller-get");
    });

    it("handles underscores and hyphens in kebab conversion", () => {
      const template = "{match.name|kebab}";
      const data = { match: { name: "create_user_endpoint" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("create-user-endpoint");
    });

    it("handles spaces in kebab conversion", () => {
      const template = "{match.name|kebab}";
      const data = { match: { name: "create user endpoint" } };

      const result = renderTemplate(template, data);

      expect(result).toBe("create-user-endpoint");
    });

    it("ignores unknown transformations", () => {
      const template = "{match.name|unknown}";
      const data = { match: { name: "TestName" } };

      const result = renderTemplate(template, data);

      // Unknown transformation is ignored, returns original string
      expect(result).toBe("TestName");
    });
  });

  describe("Element ID construction", () => {
    it("constructs valid element IDs from templates", () => {
      const template = "{layer}.endpoint.{match.controller|kebab}-{match.method|lower}";
      const data = {
        layer: "api",
        match: { controller: "UserController", method: "POST" },
      };

      const result = renderTemplate(template, data);

      expect(result).toBe("api.endpoint.user-controller-post");
      expect(result).toMatch(/^[a-z]+\.[a-z-]+\.[a-z0-9-]+$/); // Matches {layer}.{type}.{kebab}
    });

    it("ensures element IDs are unique for different matches", () => {
      const template = "api.endpoint.{match.name|kebab}";

      const id1 = renderTemplate(template, { match: { name: "GetUser" } });
      const id2 = renderTemplate(template, { match: { name: "CreateUser" } });

      expect(id1).not.toBe(id2);
      expect(id1).toBe("api.endpoint.get-user");
      expect(id2).toBe("api.endpoint.create-user");
    });
  });

  describe("Phase 2 Acceptance Criteria", () => {
    it("loads all required pattern files without configuration", async () => {
      const patterns = await loadBuiltinPatterns();

      const frameworkCount = new Set(patterns.map((p) => p.framework)).size;
      expect(frameworkCount).toBeGreaterThanOrEqual(9); // At least 9 frameworks as per spec
    });

    it("filters patterns by confidence threshold (default 0.7)", () => {
      const candidates: ElementCandidate[] = [
        { id: "test1", type: "test", layer: "api", name: "test", confidence: 0.8, attributes: {} },
        { id: "test2", type: "test", layer: "api", name: "test", confidence: 0.6, attributes: {} },
      ];

      const filtered = filterByConfidence(candidates, 0.7);

      expect(filtered.length).toBe(1);
      expect(filtered[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("validates pattern schema before loading", async () => {
      const patterns = await loadBuiltinPatterns();

      for (const patternSet of patterns) {
        // Validate each pattern set matches schema
        expect(() => PatternSetSchema.parse(patternSet)).not.toThrow();

        // Validate each pattern definition
        for (const pattern of patternSet.patterns) {
          expect(() => PatternDefinitionSchema.parse(pattern)).not.toThrow();
        }
      }
    });
  });
});
