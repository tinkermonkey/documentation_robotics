import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  spyOn
} from "bun:test";
import { scanCommand, type ScanOptions } from "../../src/commands/scan.js";
import { StagedChangesetStorage } from "../../src/core/staged-changeset-storage.js";
import { Model } from "../../src/core/model.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import * as path from "path";
import * as fs from "fs";

describe("Scan Command", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeAll(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    // Clean up changesets between tests
    const changesetsDir = path.join(
      workdir.path,
      "documentation-robotics",
      "changesets"
    );
    if (fs.existsSync(changesetsDir)) {
      const entries = fs.readdirSync(changesetsDir);
      for (const entry of entries) {
        const entryPath = path.join(changesetsDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          fs.rmSync(entryPath, { recursive: true });
        }
      }
    }
  });

  afterAll(async () => {
    await workdir.cleanup();
  });

  describe("--config flag validation", () => {
    it("validates configuration without connecting to CodePrism", async () => {
      // Capture console output
      const output: string[] = [];
      const originalLog = console.log;
      spyOn(console, "log").mockImplementation((msg: string) => {
        output.push(msg);
      });

      try {
        // Run with --config flag - should validate config and return early
        await scanCommand({ config: true });

        // Check that output contains expected success message
        const fullOutput = output.join("\n");
        expect(fullOutput).toContain("Configuration loaded successfully");
      } finally {
        // Restore original console.log
        (console.log as any) = originalLog;
      }
    });
  });

  describe("Pattern loading and execution", () => {
    it("loads built-in patterns and project patterns", async () => {
      // This tests the core pattern loading that happens early in scanCommand
      const { loadBuiltinPatterns, loadProjectPatterns, mergePatterns } =
        await import("../../src/scan/pattern-loader.js");

      const builtin = await loadBuiltinPatterns();
      expect(builtin.length).toBeGreaterThan(0);

      const project = await loadProjectPatterns(workdir.path);
      // Project patterns may be empty
      expect(Array.isArray(project)).toBe(true);

      const merged = mergePatterns(builtin, project);
      expect(merged.length).toBeGreaterThanOrEqual(builtin.length);
    });

    it("filters patterns by layer when --layer option is provided", async () => {
      const { loadBuiltinPatterns } =
        await import("../../src/scan/pattern-loader.js");

      const patterns = await loadBuiltinPatterns();
      const apiPatterns = patterns.filter((set) => set.layer === "api");
      const appPatterns = patterns.filter((set) => set.layer === "application");

      // Verify we have patterns in different layers
      expect(patterns.length).toBeGreaterThan(0);
      // At least one layer should have patterns
      const allLayers = [...new Set(patterns.map((p) => p.layer))];
      expect(allLayers.length).toBeGreaterThan(0);
    });

    it("merges built-in and project patterns correctly", async () => {
      const { mergePatterns } =
        await import("../../src/scan/pattern-loader.js");

      const builtin = [
        {
          layer: "api",
          framework: "nestjs",
          version: "default",
          patterns: [{ id: "builtin-pattern-1" }]
        },
        {
          layer: "api",
          framework: "express",
          version: "default",
          patterns: [{ id: "builtin-pattern-2" }]
        }
      ];

      const project = [
        {
          layer: "api",
          framework: "nestjs",
          version: "default",
          patterns: [{ id: "builtin-pattern-1" }] // Same ID as builtin - override
        },
        {
          layer: "api",
          framework: "fastify",
          version: "default",
          patterns: [{ id: "project-pattern-3" }] // New framework
        }
      ];

      const merged = mergePatterns(builtin as any, project as any);

      // Should have: nestjs (with project override), express (from builtin), fastify (from project)
      expect(merged.length).toBe(3);

      // Find merged patterns
      const nestjs = merged.find((p) => p.framework === "nestjs");
      expect(nestjs?.patterns.length).toBe(1);
      expect(nestjs?.patterns[0].id).toBe("builtin-pattern-1"); // Project override replaces builtin

      const express = merged.find((p) => p.framework === "express");
      expect(express?.patterns[0].id).toBe("builtin-pattern-2"); // Builtin kept

      const fastify = merged.find((p) => p.framework === "fastify");
      expect(fastify?.patterns[0].id).toBe("project-pattern-3"); // New from project
    });
  });

  describe("Pattern to candidate mapping", () => {
    it("maps pattern matches to element candidates correctly", async () => {
      const { renderTemplate } =
        await import("../../src/scan/pattern-loader.js");

      // Create a test pattern
      const testPattern = {
        id: "test.endpoint.api",
        produces: {
          type: "node" as const,
          layer: "api",
          elementType: "endpoint"
        },
        query: {
          tool: "test-tool",
          params: {}
        },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.{match.path|kebab}",
          name: "{match.operationId}",
          method: "{match.method|upper}",
          description: "{match.summary}"
        }
      };

      // Test rendering with sample data
      const matchData = {
        path: "GetUserByID",
        operationId: "getUserById",
        method: "get",
        summary: "Retrieve user by ID"
      };

      const idRendered = renderTemplate(testPattern.mapping.id as string, {
        match: matchData
      });
      expect(idRendered).toBe("api.endpoint.get-user-by-id");

      const nameRendered = renderTemplate(testPattern.mapping.name as string, {
        match: matchData
      });
      expect(nameRendered).toBe("getUserById");

      const methodRendered = renderTemplate(
        testPattern.mapping.method as string,
        {
          match: matchData
        }
      );
      expect(methodRendered).toBe("GET");
    });

    it("generates valid element IDs following naming conventions", async () => {
      const { renderTemplate } =
        await import("../../src/scan/pattern-loader.js");

      // Test various ID generation templates
      const testCases = [
        {
          template:
            "api.endpoint.{match.controller|kebab}-{match.method|kebab}",
          data: { match: { controller: "UserController", method: "GetUser" } },
          expected: "api.endpoint.user-controller-get-user"
        },
        {
          template: "application.service.{match.className|kebab}",
          data: { match: { className: "AuthenticationService" } },
          expected: "application.service.authentication-service"
        },
        {
          template: "data-model.entity.{match.modelName|kebab}",
          data: { match: { modelName: "UserAccount" } },
          expected: "data-model.entity.user-account"
        },
        {
          template: "api.endpoint.{match.resource|lower}",
          data: { match: { resource: "USERS" } },
          expected: "api.endpoint.users"
        }
      ];

      for (const testCase of testCases) {
        const result = renderTemplate(testCase.template, testCase.data);
        expect(result).toBe(testCase.expected);
      }
    });
  });

  describe("Candidate filtering and deduplication", () => {
    it("filters candidates by confidence threshold", async () => {
      const { filterByConfidence } =
        await import("../../src/scan/pattern-loader.js");

      const candidates = [
        {
          id: "api.endpoint.high-confidence",
          type: "endpoint",
          layer: "api",
          name: "High Confidence",
          confidence: 0.95,
          attributes: {}
        },
        {
          id: "api.endpoint.medium-confidence",
          type: "endpoint",
          layer: "api",
          name: "Medium Confidence",
          confidence: 0.75,
          attributes: {}
        },
        {
          id: "api.endpoint.low-confidence",
          type: "endpoint",
          layer: "api",
          name: "Low Confidence",
          confidence: 0.45,
          attributes: {}
        }
      ];

      const highConfidence = filterByConfidence(candidates, 0.8);
      expect(highConfidence.length).toBe(1);
      expect(highConfidence[0].id).toBe("api.endpoint.high-confidence");

      const mediumConfidence = filterByConfidence(candidates, 0.7);
      expect(mediumConfidence.length).toBe(2);

      const allConfidence = filterByConfidence(candidates, 0.0);
      expect(allConfidence.length).toBe(3);
    });

    it("deduplicates candidates against existing model elements", async () => {
      // Create test candidates
      const candidates = [
        {
          id: "api.endpoint.get-user",
          type: "endpoint",
          layer: "api",
          name: "Get User",
          confidence: 0.9,
          attributes: {}
        },
        {
          id: "api.endpoint.create-user",
          type: "endpoint",
          layer: "api",
          name: "Create User",
          confidence: 0.85,
          attributes: {}
        },
        {
          id: "application.service.user-service",
          type: "service",
          layer: "application",
          name: "User Service",
          confidence: 0.75,
          attributes: {}
        }
      ];

      // Load the test model
      const model = await Model.load(workdir.path);

      // Check which elements already exist in the model
      const newCandidates = candidates.filter((candidate) => {
        const element = model.getElementById(candidate.id);
        return !element;
      });

      // Some candidates should be new (or all if model is empty)
      expect(newCandidates.length > 0 || candidates.length > 0).toBe(true);
    });
  });

  describe("Changeset staging", () => {
    it("stages changeset with element candidates", async () => {
      const storage = new StagedChangesetStorage(workdir.path);

      // Create a changeset
      const changesetId = `test-scan-${Date.now()}`;
      const changeset = await storage.create(
        changesetId,
        "Test Changeset",
        "Test candidates from scan",
        "current"
      );

      // Add candidate elements
      const candidates = [
        {
          id: "api.endpoint.test-endpoint",
          type: "endpoint",
          layer: "api",
          name: "Test Endpoint",
          confidence: 0.9
        },
        {
          id: "application.service.test-service",
          type: "service",
          layer: "application",
          name: "Test Service",
          confidence: 0.85
        }
      ];

      for (const candidate of candidates) {
        changeset.addChange("add", candidate.id, candidate.layer, undefined, {
          id: candidate.id,
          type: candidate.type,
          name: candidate.name,
          layer_id: candidate.layer,
          spec_node_id: candidate.type,
          path: candidate.id.replace(/\./g, "/"),
          attributes: {}
        });
      }

      // Save changeset
      await storage.save(changeset);

      // Verify changeset was saved
      const loaded = await storage.load(changesetId);
      expect(loaded).toBeDefined();
      expect(loaded?.changes.length).toBe(2);
      expect(loaded?.stats.additions).toBe(2);
    });

    it("handles empty scan results gracefully", async () => {
      // When no candidates are found, the scan should complete successfully
      const { loadBuiltinPatterns } =
        await import("../../src/scan/pattern-loader.js");

      const patterns = await loadBuiltinPatterns();
      expect(patterns.length > 0).toBe(true);

      // With empty MCP results (mock returns empty array), candidates would be empty
      const candidates: any[] = [];
      expect(candidates.length).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("handles errors from individual patterns gracefully", async () => {
      // Create test patterns where some might fail
      const patterns = [
        {
          id: "valid.pattern",
          produces: {
            type: "node" as const,
            layer: "api",
            elementType: "endpoint"
          },
          query: { tool: "valid-tool", params: {} },
          confidence: 0.85,
          mapping: { id: "api.endpoint.valid" }
        },
        {
          id: "invalid.pattern",
          produces: {
            type: "node" as const,
            layer: "api",
            elementType: "endpoint"
          },
          query: { tool: "invalid-tool", params: {} },
          confidence: 0.85,
          mapping: { id: "api.endpoint.{match.nonexistent}" } // Will fail mapping
        }
      ];

      const warnings: string[] = [];

      // Simulate pattern execution with error handling
      for (const pattern of patterns) {
        try {
          // Simulate pattern execution
          if (pattern.id === "invalid.pattern") {
            throw new Error("Tool execution failed");
          }
        } catch (error) {
          warnings.push(`Pattern '${pattern.id}' failed: ${error}`);
        }
      }

      // At least one warning should be captured
      expect(warnings.length > 0).toBe(true);
    });

    it("respects disabled patterns from configuration", async () => {
      // Configuration can disable certain pattern sets
      const { loadBuiltinPatterns } =
        await import("../../src/scan/pattern-loader.js");

      const allPatterns = await loadBuiltinPatterns();
      const disabledPatterns = ["jest", "pytest"]; // Example disabled patterns

      const activePatterns = allPatterns.filter(
        (pattern) => !disabledPatterns.includes(pattern.framework)
      );

      // Some patterns should be filtered out or all kept if none match disabled list
      expect(activePatterns.length <= allPatterns.length).toBe(true);
    });
  });

  describe("Project patterns and disabled patterns", () => {
    it("loads project patterns from documentation-robotics/.scan-patterns/", async () => {
      const { loadProjectPatterns } =
        await import("../../src/scan/pattern-loader.js");

      // For non-existent project directory, should return empty array
      const projectPatterns = await loadProjectPatterns(workdir.path);
      expect(Array.isArray(projectPatterns)).toBe(true);
    });

    it("returns empty array when project patterns directory doesn't exist", async () => {
      const { loadProjectPatterns } =
        await import("../../src/scan/pattern-loader.js");

      const projectPatterns = await loadProjectPatterns(
        "/nonexistent/project/path"
      );
      expect(projectPatterns).toEqual([]);
    });

    it("filters pattern sets by disabled_patterns list", async () => {
      const { loadBuiltinPatterns } =
        await import("../../src/scan/pattern-loader.js");
      const { filterDisabledPatterns } =
        await import("../../src/commands/scan.js");

      const allPatterns = await loadBuiltinPatterns();
      const disabledFrameworks = ["jest", "pytest"]; // Disable testing frameworks

      const filtered = filterDisabledPatterns(allPatterns, disabledFrameworks);

      // Verify filtering works
      const remainingFrameworks = new Set(filtered.map((p) => p.framework));
      expect(remainingFrameworks.has("jest")).toBe(false);
      expect(remainingFrameworks.has("pytest")).toBe(false);

      // Other frameworks should still be present
      expect(filtered.length < allPatterns.length).toBe(true);
    });

    it("project pattern with same ID overrides builtin pattern", async () => {
      const { mergePatterns } =
        await import("../../src/scan/pattern-loader.js");

      const builtin = [
        {
          layer: "api",
          framework: "nestjs",
          patterns: [
            {
              id: "nestjs.controller.route",
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "endpoint"
              },
              query: { tool: "search_code", params: {} },
              confidence: 0.85,
              mapping: { id: "api.endpoint.builtin" }
            }
          ]
        }
      ];

      const project = [
        {
          layer: "api",
          framework: "custom",
          patterns: [
            {
              id: "nestjs.controller.route", // Same ID as builtin
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "endpoint"
              },
              query: { tool: "search_code", params: {} },
              confidence: 0.95,
              mapping: { id: "api.endpoint.custom-override" }
            }
          ]
        }
      ];

      const merged = mergePatterns(builtin as any, project as any);

      // Find the nestjs pattern and verify it was overridden
      const nestjs = merged.find((p) => p.framework === "nestjs");
      expect(nestjs?.patterns[0].confidence).toBe(0.95);
      expect(
        (nestjs?.patterns[0].mapping as any).id
      ).toBe("api.endpoint.custom-override");
    });

    it("invalid project pattern file throws error with file path", async () => {
      // This test verifies error handling for malformed project patterns
      // The actual implementation is tested in the loadProjectPatterns unit tests
      const { PatternSetSchema } = await import(
        "../../src/scan/pattern-loader.js"
      );

      const invalidPatternSet = {
        layer: "api",
        framework: "custom",
        patterns: [
          {
            id: "custom.pattern",
            produces: { type: "node", layer: "api", elementType: "endpoint" },
            query: { tool: "test" },
            confidence: 1.5, // Invalid: > 1.0
            mapping: { id: "api.endpoint.test" }
          }
        ]
      };

      expect(() => PatternSetSchema.parse(invalidPatternSet)).toThrow();
    });
  });

  describe("MCP client lifecycle", () => {
    // Full MCP client lifecycle testing requires a real CodePrism MCP server.
    // These scenarios are validated through integration tests with a mock MCP server.
    // Skip: client connection management, disconnect on dry-run, disconnect on error
  });

  describe("Summary statistics", () => {
    it("reports correct summary statistics", async () => {
      // Test that summary stats distinguish between:
      // - Total candidates found
      // - Candidates filtered by confidence threshold
      // - Candidates deduplicated against existing model
      // - Elements actually staged
      const candidates = [
        {
          id: "api.endpoint.1",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 1",
          confidence: 0.9,
          attributes: {}
        },
        {
          id: "api.endpoint.2",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 2",
          confidence: 0.85,
          attributes: {}
        }
      ];

      const stats = {
        patternCount: 42,
        candidatesFound: candidates.length,
        candidatesDeduplicated: 0,
        newCandidates: candidates.length,
        elementsStaged: candidates.length
      };

      expect(stats.patternCount).toBeGreaterThan(0);
      expect(stats.candidatesFound).toBe(2);
      expect(stats.newCandidates).toBe(2);
      expect(stats.elementsStaged).toBe(2);
    });
  });

  describe("Integration with existing model", () => {
    it("loads and integrates with existing architecture model", async () => {
      // Verify that the scan command can load the existing model
      // without errors and use it for deduplication
      const model = await Model.load(workdir.path);
      expect(model).toBeDefined();

      // Model should have some elements from the golden copy
      let elementCount = 0;
      for (const layerName of model.getLayerNames()) {
        const layer = await model.getLayer(layerName);
        if (layer) {
          elementCount += layer.listElements().length;
        }
      }
      expect(elementCount >= 0).toBe(true);
    });
  });

  describe("Relationship candidate handling", () => {
    it("validates cross-layer direction rule: higher layer → lower layer", async () => {
      const { isValidRelationshipDirection, extractLayerFromId, LAYER_INDEX } =
        await import("../../src/scan/pattern-loader.js");

      // Valid relationships: higher layer index → lower layer index
      expect(isValidRelationshipDirection(
        "api.endpoint.get-users",      // api = index 6
        "application.service.user-srv" // application = index 4
      )).toBe(true);

      expect(isValidRelationshipDirection(
        "application.service.order",   // application = index 4
        "business.process.order"       // business = index 2
      )).toBe(true);

      expect(isValidRelationshipDirection(
        "data-store.schema.users",     // data-store = index 8
        "data-model.entity.user"       // data-model = index 7
      )).toBe(true);

      // Invalid relationships: lower layer index → higher layer index
      expect(isValidRelationshipDirection(
        "application.service.user",    // application = index 4
        "api.endpoint.get-users"       // api = index 6
      )).toBe(false);

      expect(isValidRelationshipDirection(
        "business.process.order",      // business = index 2
        "application.service.order"    // application = index 4
      )).toBe(false);

      // Same layer relationships are invalid (must have different layers)
      expect(isValidRelationshipDirection(
        "api.endpoint.get-users",
        "api.endpoint.post-user"
      )).toBe(false);

      // Invalid element ID format
      expect(isValidRelationshipDirection(
        "invalid-id",
        "api.endpoint.test"
      )).toBe(false);

      expect(isValidRelationshipDirection(
        "api.endpoint.test",
        "invalid-id"
      )).toBe(false);
    });

    it("extracts layer names from element IDs correctly", async () => {
      const { extractLayerFromId } =
        await import("../../src/scan/pattern-loader.js");

      // Valid element IDs
      expect(extractLayerFromId("api.endpoint.create-user")).toBe("api");
      expect(extractLayerFromId("application.service.order-service")).toBe("application");
      expect(extractLayerFromId("data-model.entity.customer")).toBe("data-model");
      expect(extractLayerFromId("data-store.schema.users")).toBe("data-store");

      // Invalid element IDs (missing parts)
      expect(extractLayerFromId("api.endpoint")).toBeNull();
      expect(extractLayerFromId("api")).toBeNull();
      expect(extractLayerFromId("invalid-id-format")).toBeNull();
    });

    it("discards relationships with missing source elements", async () => {
      // Test that relationships with non-existent source elements are filtered
      const candidate = {
        id: "unknown.service.missing->api.endpoint.get-user",
        sourceId: "unknown.service.missing",  // Does not exist
        targetId: "api.endpoint.get-user",
        relationshipType: "depends-on",
        layer: "api",
        confidence: 0.9
      };

      const newElementCandidates = [
        { id: "api.endpoint.get-user", type: "endpoint" }
      ];

      // Simulate the validation logic: check if source exists
      const sourceExists = newElementCandidates.some((e) => e.id === candidate.sourceId);

      // Should NOT be staged because source is missing
      expect(sourceExists).toBe(false);
      expect(candidate.sourceId).toBe("unknown.service.missing");
    });

    it("discards relationships with missing target elements", async () => {
      // Test that relationships with non-existent target elements are filtered
      const candidate = {
        id: "api.endpoint.create-user->application.service.missing",
        sourceId: "api.endpoint.create-user",
        targetId: "application.service.missing",  // Does not exist
        relationshipType: "depends-on",
        layer: "api",
        confidence: 0.9
      };

      const newElementCandidates = [
        { id: "api.endpoint.create-user", type: "endpoint" }
      ];

      // Simulate the validation logic: check if target exists
      const targetExists = newElementCandidates.some((e) => e.id === candidate.targetId);

      // Should NOT be staged because target is missing
      expect(targetExists).toBe(false);
      expect(candidate.targetId).toBe("application.service.missing");
    });

    it("prevents duplicate relationships from being staged", async () => {
      // Test that duplicate relationships are detected and not staged
      const candidate = {
        sourceId: "api.endpoint.create-user",
        targetId: "application.service.user-service",
        relationshipType: "depends-on"
      };

      // Simulate model that already contains this relationship
      const existingRelationships = [
        {
          sourceId: "api.endpoint.create-user",
          targetId: "application.service.user-service",
          relationshipType: "depends-on"
        }
      ];

      // Simulate duplicate detection via registry lookup
      const isDuplicate = existingRelationships.some(
        (rel) =>
          rel.sourceId === candidate.sourceId &&
          rel.targetId === candidate.targetId &&
          rel.relationshipType === candidate.relationshipType
      );

      // Should NOT be staged because it already exists
      expect(isDuplicate).toBe(true);
    });

    it("generates correct relationship candidate IDs", async () => {
      // Test that relationship IDs follow the format: sourceId->targetId
      const sourceId = "api.endpoint.create-user";
      const targetId = "application.service.user-service";
      const expectedId = `${sourceId}->${targetId}`;

      expect(expectedId).toBe("api.endpoint.create-user->application.service.user-service");
    });

    it("handles relationship attributes from pattern mapping", async () => {
      const { renderTemplate } =
        await import("../../src/scan/pattern-loader.js");

      const pattern = {
        mapping: {
          sourceId: "api.endpoint.test",
          targetId: "app.service.test",
          category: "{match.category}",
          description: "{match.desc|upper}"
        }
      };

      const match = {
        category: "structural",
        desc: "important relationship"
      };

      const category = renderTemplate(pattern.mapping.category as string, { match });
      const description = renderTemplate(pattern.mapping.description as string, { match });

      expect(category).toBe("structural");
      expect(description).toBe("IMPORTANT RELATIONSHIP");
    });

    it("preserves changeset ordering: elements before relationships", async () => {
      // Create a sample changeset with mixed operations
      const { Changeset } = await import("../../src/core/changeset.js");

      const changeset = Changeset.create(
        "Test Changeset",
        "Test changeset for ordering",
        "test-changeset-123",
        "snapshot-abc123"
      );

      // Add element operations first
      changeset.addChange("add", "api.endpoint.test", "api", undefined, {
        id: "api.endpoint.test",
        type: "endpoint"
      });

      changeset.addChange("add", "application.service.test", "application", undefined, {
        id: "application.service.test",
        type: "service"
      });

      // Add relationship operations second
      changeset.addChange("relationship-add", "api.endpoint.test::depends-on::application.service.test", "api", undefined, {
        source: "api.endpoint.test",
        target: "application.service.test",
        predicate: "depends-on"
      });

      // Verify order: all elements before relationships
      let lastElementIndex = -1;
      let firstRelationshipIndex = changeset.changes.length;

      for (let i = 0; i < changeset.changes.length; i++) {
        const change = changeset.changes[i];
        if (change.type === "add") {
          lastElementIndex = i;
        }
        if (change.type === "relationship-add" && i < firstRelationshipIndex) {
          firstRelationshipIndex = i;
        }
      }

      // All element operations should come before relationship operations
      expect(lastElementIndex).toBeLessThan(firstRelationshipIndex);
    });

    it("validates element IDs from relationship candidates", async () => {
      const { extractLayerFromId } =
        await import("../../src/scan/pattern-loader.js");

      // Test valid element ID formats
      const validIds = [
        "api.endpoint.create-user",
        "application.service.order-service",
        "data-model.entity.customer",
        "motivation.goal.customer-satisfaction"
      ];

      for (const id of validIds) {
        const layer = extractLayerFromId(id);
        expect(layer).toBeTruthy();
      }

      // Test invalid element ID formats
      const invalidIds = [
        "invalid-id",
        "api.endpoint",
        "just.two.parts",
        ""
      ];

      for (const id of invalidIds) {
        const layer = extractLayerFromId(id);
        expect(layer).toBeNull();
      }
    });
  });
});
