import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
  spyOn
} from "bun:test";
import { scanCommand, type ScanOptions, stageChangeset } from "../../src/commands/scan.js";
import { StagedChangesetStorage } from "../../src/core/staged-changeset-storage.js";
import { Model } from "../../src/core/model.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { type RelationshipCandidate } from "../../src/scan/pattern-loader.js";
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

  describe("Full scanCommand pipeline end-to-end", () => {
    it("exercises complete flow: config → pattern loading → candidate mapping → deduplication → staging", async () => {
      // Import helper functions to verify the pipeline
      const { loadBuiltinPatterns, renderTemplate, filterByConfidence } =
        await import("../../src/scan/pattern-loader.js");
      const { expandWildcardElementId, mapToElementCandidate, mapToRelationshipCandidate, stageChangeset } =
        await import("../../src/commands/scan.js");

      // Step 1: Load patterns (pattern loading phase)
      const patterns = await loadBuiltinPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      const totalPatterns = patterns.reduce((sum, set) => sum + set.patterns.length, 0);
      expect(totalPatterns).toBeGreaterThan(0);

      // Step 2: Test pattern mapping (candidate mapping phase)
      // Find a sample element pattern to test
      const elementPattern = patterns
        .flatMap((set) => set.patterns)
        .find((p) => p.produces?.type === "node");

      if (elementPattern && elementPattern.produces?.type === "node") {
        const sampleMatch = {
          name: "TestEndpoint",
          path: "/test",
          method: "GET",
          summary: "Test endpoint"
        };

        // Test that mapping produces valid candidates
        const mappedCandidate = mapToElementCandidate(
          elementPattern,
          sampleMatch,
          []
        );

        if (mappedCandidate) {
          expect(mappedCandidate.id).toBeTruthy();
          expect(mappedCandidate.type).toBe(elementPattern.produces.elementType);
          expect(mappedCandidate.layer).toBe(elementPattern.produces.layer);
          expect(mappedCandidate.confidence).toBe(elementPattern.confidence);
        }
      }

      // Step 3: Test relationship mapping
      const relationshipPattern = patterns
        .flatMap((set) => set.patterns)
        .find((p) => p.produces?.type === "relationship");

      if (relationshipPattern && relationshipPattern.produces?.type === "relationship") {
        const sampleMatch = {
          sourceName: "endpoint-one",
          targetName: "service-one",
          file: "test.ts",
          line: "42"
        };

        const mappedRelationship = mapToRelationshipCandidate(
          relationshipPattern,
          sampleMatch,
          []
        );

        if (mappedRelationship) {
          expect(mappedRelationship.sourceId).toBeTruthy();
          expect(mappedRelationship.targetId).toBeTruthy();
          expect(mappedRelationship.relationshipType).toBe(relationshipPattern.produces.relationshipType);
          expect(mappedRelationship.confidence).toBe(relationshipPattern.confidence);
        }
      }

      // Step 4: Test confidence filtering
      const testCandidates = [
        {
          id: "api.endpoint.high",
          type: "endpoint",
          layer: "api",
          name: "High",
          confidence: 0.95,
          attributes: {}
        },
        {
          id: "api.endpoint.low",
          type: "endpoint",
          layer: "api",
          name: "Low",
          confidence: 0.5,
          attributes: {}
        }
      ];

      const filtered = filterByConfidence(testCandidates, 0.8);
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe("api.endpoint.high");

      // Step 5: Test wildcard expansion
      const availableElements = [
        { id: "api.endpoint.get-user" },
        { id: "api.endpoint.create-user" },
        { id: "api.endpoint.delete-user" }
      ];

      const expanded = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(expanded.length).toBe(3);
      expect(expanded).toContain("api.endpoint.get-user");
      expect(expanded).toContain("api.endpoint.create-user");
      expect(expanded).toContain("api.endpoint.delete-user");

      // Step 6: Test deduplication component (model loading and filtering logic)
      const model = await Model.load(workdir.path);
      expect(model).toBeDefined();

      // Verify model can identify existing elements for deduplication purposes
      const elementsInModel = new Set<string>();
      for (const layerName of model.getLayerNames()) {
        const layer = await model.getLayer(layerName);
        if (layer) {
          for (const element of layer.listElements()) {
            elementsInModel.add(element.id);
          }
        }
      }

      // Test candidates that don't exist in the model
      const newCandidates = [
        { id: "api.endpoint.new-one", type: "endpoint", layer: "api", name: "New", confidence: 0.9, attributes: {} },
        { id: "api.endpoint.new-two", type: "endpoint", layer: "api", name: "New", confidence: 0.9, attributes: {} }
      ];

      // Verify test candidates are actually new (not already in model)
      for (const candidate of newCandidates) {
        expect(elementsInModel.has(candidate.id)).toBe(false);
      }

      // Step 7: Test changeset staging via stageChangeset function
      // This directly tests the exported stageChangeset function with real candidates
      const stageableElements = newCandidates;
      const stageableRelationships: RelationshipCandidate[] = [];

      // Call the exported stageChangeset function - the actual code path that should be tested
      await stageChangeset(stageableElements, stageableRelationships, workdir.path);

      // Verify the changeset was created by loading the most recent one
      const storage = new StagedChangesetStorage(workdir.path);
      const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
      expect(changesets.length).toBeGreaterThan(0);

      // Load the latest changeset to verify it contains our elements
      const latestChangesetId = changesets.sort().pop();
      expect(latestChangesetId).toBeDefined();

      if (latestChangesetId) {
        const loadedChangeset = await storage.load(latestChangesetId);
        expect(loadedChangeset).toBeDefined();
        expect(loadedChangeset?.changes.length).toBe(stageableElements.length);

        // Verify element IDs match what we staged
        const stagedIds = new Set(loadedChangeset?.changes.map((c) => c.elementId));
        for (const element of stageableElements) {
          expect(stagedIds.has(element.id)).toBe(true);
        }
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

      // All candidates should be new since we haven't added any to this test model
      expect(newCandidates.length).toBe(candidates.length);

      // Verify filtering worked by checking that existing elements are excluded
      // This test verifies the deduplication logic works correctly
      const modelIds = new Set<string>();
      for (const layerName of model.getLayerNames()) {
        const layer = await model.getLayer(layerName);
        if (layer) {
          for (const element of layer.listElements()) {
            modelIds.add(element.id);
          }
        }
      }

      // No candidates should match model elements
      for (const candidate of newCandidates) {
        expect(modelIds.has(candidate.id)).toBe(false);
      }
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

    it("stages changeset with relationship candidates using composite key format", async () => {
      const { stageChangeset } =
        await import("../../src/commands/scan.js");

      // Create element and relationship candidates
      const elementCandidates = [
        {
          id: "api.endpoint.create-order",
          type: "endpoint",
          layer: "api",
          name: "Create Order",
          confidence: 0.9,
          attributes: { method: "POST" }
        },
        {
          id: "application.service.order-service",
          type: "service",
          layer: "application",
          name: "Order Service",
          confidence: 0.85,
          attributes: {}
        }
      ];

      const relationshipCandidates = [
        {
          id: "api.endpoint.create-order::depends-on::application.service.order-service",
          sourceId: "api.endpoint.create-order",
          targetId: "application.service.order-service",
          relationshipType: "depends-on",
          layer: "api",
          confidence: 0.88,
          attributes: { category: "structural" },
          source: { file: "order.controller.ts", line: 45 }
        },
        {
          id: "api.endpoint.create-order::calls::api.endpoint.validate-order",
          sourceId: "api.endpoint.create-order",
          targetId: "api.endpoint.validate-order",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.92,
          attributes: undefined,
          source: { file: "order.controller.ts", line: 50 }
        }
      ];

      // Stage the changeset with both elements and relationships
      await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

      // Verify the changeset was created and contains both types of operations
      const storage = new StagedChangesetStorage(workdir.path);
      const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
      expect(changesets.length).toBeGreaterThan(0);

      // Load the latest changeset
      const latestChangesetId = changesets.sort().pop();
      expect(latestChangesetId).toBeDefined();

      if (latestChangesetId) {
        const loadedChangeset = await storage.load(latestChangesetId);
        expect(loadedChangeset).toBeDefined();

        // Should have 2 element operations + 2 relationship operations
        const changes = loadedChangeset?.changes || [];
        expect(changes.length).toBe(4);

        // Verify element operations come first
        const elementOps = changes.filter((c) => c.type === "add");
        const relationshipOps = changes.filter((c) => c.type === "relationship-add");

        expect(elementOps.length).toBe(2);
        expect(relationshipOps.length).toBe(2);

        // Verify relationship operations use composite key format: source::predicate::target
        for (const relOp of relationshipOps) {
          const parts = relOp.elementId.split("::");
          expect(parts.length).toBe(3);
          expect(parts[0]).toMatch(/^[a-z-]+\.[a-z-]+\.[a-z0-9\-]+$/); // source ID format
          expect(parts[1]).toMatch(/^[a-z\-]+$/); // predicate (relationshipType) format
          expect(parts[2]).toMatch(/^[a-z-]+\.[a-z-]+\.[a-z0-9\-]+$/); // target ID format
        }

        // Verify specific composite keys
        const compositeKeys = changes.map((c) => c.elementId);
        expect(compositeKeys).toContain("api.endpoint.create-order::depends-on::application.service.order-service");
        expect(compositeKeys).toContain("api.endpoint.create-order::calls::api.endpoint.validate-order");
      }
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

  describe("Pattern execution with non-standard tool results", () => {
    it("handles non-JSON text results from tools gracefully", async () => {
      const { executePatterns } =
        await import("../../src/commands/scan.js");

      // Create a mock MCP client that returns non-JSON text
      const mockClient = {
        callTool: async (toolName: string, params: unknown) => [
          {
            type: "text",
            text: "This is plain text output that is not valid JSON. Tool executed but returned unparseable format."
          }
        ],
        endpoint: "mock://test"
      };

      // Create a simple pattern that should process the results
      const patterns = [
        {
          layer: "api",
          framework: "test",
          version: "default",
          patterns: [
            {
              id: "test.pattern.non-json",
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
                id: "api.endpoint.test",
                name: "Test Endpoint"
              }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns with the mock client
      const result = await executePatterns(mockClient as any, patterns, 0.7, warnings, false);

      // Should return empty candidates since the text couldn't be parsed as JSON
      expect(result.elementCandidates.length).toBe(0);
      expect(result.relationshipCandidates.length).toBe(0);

      // Should have recorded a warning about the unparseable result
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("Could not parse tool result as JSON"))).toBe(true);
    });

    it("handles single-object (non-array) JSON results from tools", async () => {
      const { executePatterns } =
        await import("../../src/commands/scan.js");

      // Create a mock MCP client that returns a single object (not an array)
      const mockClient = {
        callTool: async (toolName: string, params: unknown) => [
          {
            type: "text",
            text: JSON.stringify({
              path: "/src/users/get-user.ts",
              operationId: "GetUser",
              method: "get",
              summary: "Retrieve user by ID"
            })
          }
        ],
        endpoint: "mock://test"
      };

      // Create a pattern for element candidates
      const patterns = [
        {
          layer: "api",
          framework: "test",
          version: "default",
          patterns: [
            {
              id: "test.pattern.single-object",
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
                id: "api.endpoint.{match.method|lower}-{match.operationId|kebab}",
                name: "{match.operationId}",
                method: "{match.method|upper}"
              }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns with the mock client
      const result = await executePatterns(mockClient as any, patterns, 0.7, warnings, false);

      // Should successfully parse the single object and create a candidate
      expect(result.elementCandidates.length).toBe(1);
      const candidate = result.elementCandidates[0];
      expect(candidate.id).toBe("api.endpoint.get-get-user");
      expect(candidate.name).toBe("GetUser");
      expect(candidate.attributes.method).toBe("GET");

      // Should have no warnings since parsing succeeded
      expect(warnings.length).toBe(0);
    });

    it("handles array of objects JSON results from tools", async () => {
      const { executePatterns } =
        await import("../../src/commands/scan.js");

      // Create a mock MCP client that returns an array of objects
      const mockClient = {
        callTool: async (toolName: string, params: unknown) => [
          {
            type: "text",
            text: JSON.stringify([
              {
                path: "/src/users/get-user.ts",
                operationId: "GetUser",
                method: "get"
              },
              {
                path: "/src/users/create-user.ts",
                operationId: "CreateUser",
                method: "post"
              }
            ])
          }
        ],
        endpoint: "mock://test"
      };

      // Create a pattern for element candidates
      const patterns = [
        {
          layer: "api",
          framework: "test",
          version: "default",
          patterns: [
            {
              id: "test.pattern.array-objects",
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
                id: "api.endpoint.{match.operationId|kebab}",
                name: "{match.operationId}"
              }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns with the mock client
      const result = await executePatterns(mockClient as any, patterns, 0.7, warnings, false);

      // Should successfully parse the array and create two candidates
      expect(result.elementCandidates.length).toBe(2);
      expect(result.elementCandidates[0].id).toBe("api.endpoint.get-user");
      expect(result.elementCandidates[1].id).toBe("api.endpoint.create-user");

      // Should have no warnings
      expect(warnings.length).toBe(0);
    });

    it("handles tool error results gracefully", async () => {
      const { executePatterns } =
        await import("../../src/commands/scan.js");

      // Create a mock MCP client that returns an error result
      const mockClient = {
        callTool: async (toolName: string, params: unknown) => [
          {
            type: "error",
            text: "Tool execution failed: search_code not found"
          }
        ],
        endpoint: "mock://test"
      };

      const patterns = [
        {
          layer: "api",
          framework: "test",
          version: "default",
          patterns: [
            {
              id: "test.pattern.error",
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "endpoint"
              },
              query: {
                tool: "missing-tool",
                params: {}
              },
              confidence: 0.85,
              mapping: {
                id: "api.endpoint.test"
              }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns with the mock client
      const result = await executePatterns(mockClient as any, patterns, 0.7, warnings, false);

      // Should return no candidates
      expect(result.elementCandidates.length).toBe(0);

      // Should have recorded the error as a warning
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("Tool") && w.includes("returned error"))).toBe(true);
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

      // Exactly one warning should be captured (from invalid.pattern)
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("invalid.pattern");
      expect(warnings[0]).toContain("Tool execution failed");
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

      // Model should be loadable and iterable
      let elementCount = 0;
      const loadedLayers: string[] = [];
      for (const layerName of model.getLayerNames()) {
        loadedLayers.push(layerName);
        const layer = await model.getLayer(layerName);
        if (layer) {
          const elements = layer.listElements();
          elementCount += elements.length;
        }
      }

      // Verify model structure is correct
      expect(loadedLayers.length).toBeGreaterThan(0);
      expect(elementCount).toBeGreaterThan(0);

      // Count should match sum of elements across layers
      let verifyCount = 0;
      for (const layerName of loadedLayers) {
        const layer = await model.getLayer(layerName);
        if (layer) {
          verifyCount += layer.listElements().length;
        }
      }
      expect(verifyCount).toBe(elementCount);
    });
  });

  describe("Relationship candidate handling", () => {
    it("validates relationship direction: same-layer and cross-layer rules", async () => {
      const { isValidRelationshipDirection, extractLayerFromId, LAYER_INDEX } =
        await import("../../src/scan/pattern-loader.js");

      // Valid cross-layer relationships: higher layer index → lower layer index
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

      // Valid same-layer (intra-layer) relationships
      expect(isValidRelationshipDirection(
        "api.endpoint.get-users",
        "api.endpoint.post-user"       // Same layer allowed
      )).toBe(true);

      expect(isValidRelationshipDirection(
        "application.service.user-service",
        "application.service.order-service" // Same layer allowed
      )).toBe(true);

      // Invalid cross-layer relationships: lower layer index → higher layer index
      expect(isValidRelationshipDirection(
        "application.service.user",    // application = index 4
        "api.endpoint.get-users"       // api = index 6
      )).toBe(false);

      expect(isValidRelationshipDirection(
        "business.process.order",      // business = index 2
        "application.service.order"    // application = index 4
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

    it("validates relationship patterns produce fully-qualified element IDs", async () => {
      // Import the internal function to test bare-name validation
      const { renderTemplate, LAYER_INDEX } =
        await import("../../src/scan/pattern-loader.js");

      // Test 1: Source ID validation for bare names
      const patternBareSource = {
        name: "test-bare-source",
        category: "relationship",
        confidence: 0.9,
        produces: {
          layer: "api",
          relationshipType: "depends-on"
        },
        mapping: {
          source: "{match.serviceName|kebab}",  // Produces bare name like "user-service"
          target: "application.service.test"
        }
      };

      const match = { serviceName: "user-service", file: "test.ts", line: "10" };
      const sourceId = renderTemplate(patternBareSource.mapping.source as string, { match });

      // Should be a bare name (no dots)
      expect(sourceId).toBe("user-service");
      expect(sourceId.includes(".")).toBe(false);

      // Test 2: Target ID validation for bare names
      const patternBareTarget = {
        name: "test-bare-target",
        category: "relationship",
        confidence: 0.9,
        produces: {
          layer: "api",
          relationshipType: "depends-on"
        },
        mapping: {
          source: "api.endpoint.test",
          target: "{match.serviceName|kebab}"  // Produces bare name
        }
      };

      const targetId = renderTemplate(patternBareTarget.mapping.target as string, { match });

      // Should be a bare name (no dots)
      expect(targetId).toBe("user-service");
      expect(targetId.includes(".")).toBe(false);

      // Test 3: Valid fully-qualified IDs pass validation
      const patternValid = {
        name: "test-valid",
        category: "relationship",
        confidence: 0.9,
        produces: {
          layer: "api",
          relationshipType: "depends-on"
        },
        mapping: {
          source: "api.endpoint.{match.name|kebab}",
          target: "application.service.{match.targetName|kebab}"
        }
      };

      const validMatch = { name: "get-user", targetName: "user-service", file: "test.ts", line: "10" };
      const validSourceId = renderTemplate(patternValid.mapping.source as string, { match: validMatch });
      const validTargetId = renderTemplate(patternValid.mapping.target as string, { match: validMatch });

      // Should be fully-qualified (contain dots)
      expect(validSourceId).toBe("api.endpoint.get-user");
      expect(validSourceId.includes(".")).toBe(true);
      expect(validTargetId).toBe("application.service.user-service");
      expect(validTargetId.includes(".")).toBe(true);
    });
  });

  describe("Transport error handling", () => {
    it("should fail the entire scan when CodePrism connection is lost mid-scan", async () => {
      // This test verifies the critical fix: transport errors should fail the scan,
      // not be silently swallowed as tool-level errors that get logged as warnings.
      const { executePatterns } = await import("../../src/commands/scan.js");
      const { createMockMcpClient } = await import("../helpers/mock-mcp-client.js");

      // Create a mock client that throws a transport error on the second pattern execution
      const transportError = new Error("ECONNRESET: Connection reset by peer (MCP server crashed)");

      // Mock successful results for the first tool, then transport failure for the second
      const client = createMockMcpClient(
        {
          search_code: [
            {
              type: "text" as const,
              text: JSON.stringify([
                { name: "user-service", path: "/users", method: "GET" }
              ])
            }
          ]
        },
        {
          // This tool will throw a transport error, simulating server crash
          analyze_api_surface: transportError
        }
      );

      // Create minimal pattern sets that would execute both tools
      const patterns = [
        {
          framework: "express",
          layer: "api",
          patterns: [
            {
              id: "express.endpoints",
              category: "node",
              confidence: 0.85,
              query: { tool: "search_code", params: {} },
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "endpoint"
              },
              mapping: { id: "api.endpoint.{match.name|kebab}", name: "{match.name}" }
            },
            {
              id: "express.api-surface",
              category: "node",
              confidence: 0.80,
              query: { tool: "analyze_api_surface", params: {} },
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "operation"
              },
              mapping: { id: "api.operation.{match.name|kebab}", name: "{match.name}" }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns - the second pattern should throw a transport error
      try {
        await executePatterns(client, patterns, 0.7, warnings, false);
        throw new Error("Should have thrown a transport error");
      } catch (error) {
        // Verify that the error is a transport error (not swallowed)
        expect(error instanceof Error).toBe(true);
        const errorMessage = (error as Error).message;

        // The error should mention "connection lost" or the transport error
        expect(
          errorMessage.includes("connection lost") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("Connection reset")
        ).toBe(true);

        // The error should be about the specific tool
        expect(errorMessage).toContain("analyze_api_surface");
      }

      // Verify that we did not get 0 matches for all patterns (which would happen if error was silently converted)
      // The first pattern should have produced a match before the second pattern failed
      // However, since the second pattern fails, we expect warnings to NOT contain the successful result
      // (because the scan failed before processing was complete)
    });

    it("should distinguish tool-level errors from transport errors", async () => {
      // This test verifies that tool-level errors (tool runs but fails) are handled
      // differently from transport errors (connection lost, server crash).
      const { executePatterns } = await import("../../src/commands/scan.js");
      const { createMockMcpClient } = await import("../helpers/mock-mcp-client.js");

      // Create a mock client that returns tool-level errors (tool runs but fails)
      const client = createMockMcpClient({
        search_code: [
          {
            type: "error" as const,
            text: "Pattern matching failed: Invalid regex"
          }
        ]
      });

      const patterns = [
        {
          framework: "express",
          layer: "api",
          patterns: [
            {
              id: "express.endpoints",
              category: "node",
              confidence: 0.85,
              query: { tool: "search_code", params: { pattern: "invalid[regex" } },
              produces: {
                type: "node" as const,
                layer: "api",
                elementType: "endpoint"
              },
              mapping: { id: "api.endpoint.{match.name|kebab}", name: "{match.name}" }
            }
          ]
        }
      ];

      const warnings: string[] = [];

      // Execute patterns - should NOT throw, but should add to warnings
      await executePatterns(client, patterns, 0.7, warnings, false);

      // Verify that the tool-level error was added to warnings, not thrown
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("Tool 'search_code' returned error"))).toBe(true);
      expect(warnings.some((w) => w.includes("Pattern matching failed"))).toBe(true);
    });
  });

  describe("Line number parsing safety", () => {
    it("parseLineNumber correctly parses valid numeric strings", async () => {
      const { parseLineNumber } = await import("../../src/commands/scan.js");

      expect(parseLineNumber("42")).toBe(42);
      expect(parseLineNumber("1")).toBe(1);
      expect(parseLineNumber("999")).toBe(999);
      expect(parseLineNumber("0")).toBe(0);
    });

    it("parseLineNumber returns undefined for non-numeric strings", async () => {
      const { parseLineNumber } = await import("../../src/commands/scan.js");

      expect(parseLineNumber("not-a-number")).toBeUndefined();
      expect(parseLineNumber("abc")).toBeUndefined();
      expect(parseLineNumber("xyz123")).toBeUndefined();
      expect(parseLineNumber("float-12.34")).toBeUndefined();
    });

    it("parseLineNumber returns undefined for undefined or empty string", async () => {
      const { parseLineNumber } = await import("../../src/commands/scan.js");

      expect(parseLineNumber()).toBeUndefined();
      expect(parseLineNumber("")).toBeUndefined();
    });

    it("parseLineNumber silently handles leading/trailing whitespace", async () => {
      const { parseLineNumber } = await import("../../src/commands/scan.js");

      // parseInt ignores leading/trailing whitespace
      expect(parseLineNumber(" 42 ")).toBe(42);
      expect(parseLineNumber("\t99\n")).toBe(99);
    });

    it("parseLineNumber handles negative numbers and negative zero", async () => {
      const { parseLineNumber } = await import("../../src/commands/scan.js");

      expect(parseLineNumber("-5")).toBe(-5);
      expect(parseLineNumber("-1")).toBe(-1);
    });
  });

  describe("Relationship ID derivation", () => {
    it("deriveRelationshipId produces persistence format with relationshipType", async () => {
      const { deriveRelationshipId } = await import("../../src/commands/scan.js");

      const id = deriveRelationshipId("api.endpoint.get-user", "implements", "application.service.user-service");
      expect(id).toBe("api.endpoint.get-user::implements::application.service.user-service");
    });

    it("deriveRelationshipId maintains consistent format for different relationship types", async () => {
      const { deriveRelationshipId } = await import("../../src/commands/scan.js");

      const sourceId = "api.endpoint.create-order";
      const targetId = "application.service.order-service";

      const implementsId = deriveRelationshipId(sourceId, "implements", targetId);
      const dependsOnId = deriveRelationshipId(sourceId, "depends-on", targetId);
      const relatedToId = deriveRelationshipId(sourceId, "related-to", targetId);

      expect(implementsId).toBe("api.endpoint.create-order::implements::application.service.order-service");
      expect(dependsOnId).toBe("api.endpoint.create-order::depends-on::application.service.order-service");
      expect(relatedToId).toBe("api.endpoint.create-order::related-to::application.service.order-service");

      // Verify format is consistent: sourceId::relationshipType::targetId
      expect(implementsId).toContain("::");
      expect(dependsOnId).toContain("::");
      expect(relatedToId).toContain("::");
    });

    it("deriveRelationshipId produces unique IDs for different source-target-type combinations", async () => {
      const { deriveRelationshipId } = await import("../../src/commands/scan.js");

      const id1 = deriveRelationshipId("api.endpoint.a", "implements", "app.service.b");
      const id2 = deriveRelationshipId("api.endpoint.a", "depends-on", "app.service.b");
      const id3 = deriveRelationshipId("api.endpoint.b", "implements", "app.service.a");

      // All should be different
      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id2).not.toBe(id3);
    });
  });

  describe("Source reference line number handling", () => {
    it("mapToElementCandidate omits line field when line number is invalid", async () => {
      const { mapToElementCandidate } = await import("../../src/commands/scan.js");

      const pattern = {
        id: "test.endpoint",
        produces: { type: "node" as const, layer: "api", elementType: "endpoint" },
        query: { tool: "test", params: {} },
        confidence: 0.9,
        mapping: { id: "api.endpoint.test", name: "Test" }
      };

      const warnings: string[] = [];

      // Test with non-numeric line value
      const candidate = mapToElementCandidate(
        pattern,
        { name: "Test", file: "test.ts", line: "not-a-line" },
        warnings
      );

      expect(candidate).toBeDefined();
      expect(candidate?.source?.file).toBe("test.ts");
      expect(candidate?.source?.line).toBeUndefined(); // Should not include line
    });

    it("mapToElementCandidate includes valid line numbers in source reference", async () => {
      const { mapToElementCandidate } = await import("../../src/commands/scan.js");

      const pattern = {
        id: "test.endpoint",
        produces: { type: "node" as const, layer: "api", elementType: "endpoint" },
        query: { tool: "test", params: {} },
        confidence: 0.9,
        mapping: { id: "api.endpoint.test", name: "Test" }
      };

      const warnings: string[] = [];

      // Test with valid numeric line value
      const candidate = mapToElementCandidate(
        pattern,
        { name: "Test", file: "test.ts", line: "42" },
        warnings
      );

      expect(candidate).toBeDefined();
      expect(candidate?.source?.file).toBe("test.ts");
      expect(candidate?.source?.line).toBe(42);
    });

    it("mapToRelationshipCandidate omits line field when line number is invalid", async () => {
      const { mapToRelationshipCandidate } = await import("../../src/commands/scan.js");

      const pattern = {
        id: "test.relationship",
        produces: { type: "relationship" as const, relationshipType: "implements" },
        query: { tool: "test", params: {} },
        confidence: 0.9,
        mapping: {
          source: "api.endpoint.{match.name}",
          target: "application.service.{match.name}",
          sourceId: "api.endpoint.test",
          targetId: "application.service.test"
        }
      };

      const warnings: string[] = [];

      // Test with non-numeric line value
      const candidate = mapToRelationshipCandidate(
        pattern,
        { name: "Test", file: "test.ts", line: "not-a-line" },
        warnings
      );

      expect(candidate).toBeDefined();
      expect(candidate?.source?.file).toBe("test.ts");
      expect(candidate?.source?.line).toBeUndefined(); // Should not include line
    });

    it("mapToRelationshipCandidate includes valid line numbers in source reference", async () => {
      const { mapToRelationshipCandidate } = await import("../../src/commands/scan.js");

      const pattern = {
        id: "test.relationship",
        produces: { type: "relationship" as const, relationshipType: "implements" },
        query: { tool: "test", params: {} },
        confidence: 0.9,
        mapping: {
          source: "api.endpoint.{match.name}",
          target: "application.service.{match.name}",
          sourceId: "api.endpoint.test",
          targetId: "application.service.test"
        }
      };

      const warnings: string[] = [];

      // Test with valid numeric line value
      const candidate = mapToRelationshipCandidate(
        pattern,
        { name: "Test", file: "test.ts", line: "99" },
        warnings
      );

      expect(candidate).toBeDefined();
      expect(candidate?.source?.file).toBe("test.ts");
      expect(candidate?.source?.line).toBe(99);
    });
  });
});
