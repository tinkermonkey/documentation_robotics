import { describe, it, expect } from "bun:test";
import {
  mapToElementCandidate,
  mapToRelationshipCandidate,
  expandWildcardElementId,
  filterDisabledPatterns,
} from "../../../src/commands/scan.js";
import type { PatternDefinition, ElementCandidate, RelationshipCandidate } from "../../../src/scan/pattern-loader.js";

describe("Scan Command - Pattern Mapping", () => {
  describe("mapToElementCandidate", () => {
    it("maps pattern match to element candidate with template rendering", () => {
      const pattern: PatternDefinition = {
        id: "test.endpoint.api",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.{match.path|kebab}",
          name: "{match.operationId}",
          description: "{match.summary}",
        },
      };

      const match = {
        path: "GetUserByID",
        operationId: "getUserById",
        summary: "Retrieve user by ID",
      };

      const candidate = mapToElementCandidate(pattern, match, []);

      expect(candidate).toBeTruthy();
      expect(candidate?.id).toBe("api.endpoint.get-user-by-id");
      expect(candidate?.name).toBe("getUserById");
      expect(candidate?.type).toBe("endpoint");
      expect(candidate?.layer).toBe("api");
      expect(candidate?.confidence).toBe(0.85);
      expect(candidate?.attributes?.description).toBe("Retrieve user by ID");
    });

    it("uses default ID template when mapping omits id field", () => {
      const pattern: PatternDefinition = {
        id: "test.service.app",
        produces: {
          type: "node",
          layer: "application",
          elementType: "service",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.9,
        mapping: {
          name: "{match.className}",
        },
      };

      const match = {
        className: "UserService",
        name: "user-service", // Provide name for default ID template
      };

      const candidate = mapToElementCandidate(pattern, match, []);

      expect(candidate).toBeTruthy();
      // Default template: "{layer}.{elementType}.{match.name|kebab}"
      expect(candidate?.id).toContain("application.service");
      expect(candidate?.id).toBe("application.service.user-service");
      expect(candidate?.name).toBe("UserService");
    });

    it("includes source reference when file and line are provided in match", () => {
      const pattern: PatternDefinition = {
        id: "test.endpoint",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          id: "api.endpoint.test",
          name: "Test Endpoint",
        },
      };

      const match = {
        file: "/src/controllers/user.ts",
        line: "42",
      };

      const candidate = mapToElementCandidate(pattern, match, []);

      expect(candidate?.source).toBeTruthy();
      expect(candidate?.source?.file).toBe("/src/controllers/user.ts");
      expect(candidate?.source?.line).toBe(42);
    });

    it("handles missing template variables gracefully as warnings", () => {
      const pattern: PatternDefinition = {
        id: "test.endpoint",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          id: "api.endpoint.{match.nonexistent|kebab}",
          name: "Test",
        },
      };

      const match = {
        name: "test",
      };

      const warnings: string[] = [];
      const candidate = mapToElementCandidate(pattern, match, warnings);

      // Should fail to map and collect warning
      expect(candidate).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      // Check for mapping error message (actual wording may vary)
      expect(warnings[0]).toContain("failed to map element candidate");
    });

    it("collects all non-id, non-name attributes from mapping", () => {
      const pattern: PatternDefinition = {
        id: "test.endpoint",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          id: "api.endpoint.test",
          name: "Test",
          method: "{match.httpMethod|upper}",
          path: "{match.urlPath}",
          description: "{match.summary}",
        },
      };

      const match = {
        httpMethod: "get",
        urlPath: "/users",
        summary: "Get users",
      };

      const candidate = mapToElementCandidate(pattern, match, []);

      expect(candidate?.attributes?.method).toBe("GET");
      expect(candidate?.attributes?.path).toBe("/users");
      expect(candidate?.attributes?.description).toBe("Get users");
      // Verify id and name are not in attributes
      expect(candidate?.attributes?.id).toBeUndefined();
      expect(candidate?.attributes?.name).toBeUndefined();
    });
  });

  describe("mapToRelationshipCandidate", () => {
    it("maps pattern match to relationship candidate with fully-qualified IDs", () => {
      const pattern: PatternDefinition = {
        id: "test.relationship",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.9,
        mapping: {
          source: "api.endpoint.{match.sourceName|kebab}",
          target: "application.service.{match.targetName|kebab}",
        },
      };

      const match = {
        sourceName: "GetUser",
        targetName: "UserService",
      };

      const candidate = mapToRelationshipCandidate(pattern, match, []);

      expect(candidate).toBeTruthy();
      expect(candidate?.sourceId).toBe("api.endpoint.get-user");
      expect(candidate?.targetId).toBe("application.service.user-service");
      expect(candidate?.relationshipType).toBe("depends-on");
      expect(candidate?.id).toBe("api.endpoint.get-user::depends-on::application.service.user-service");
      expect(candidate?.confidence).toBe(0.9);
    });

    it("supports both 'source'/'target' and 'sourceId'/'targetId' mapping keys", () => {
      const patternSourceTarget: PatternDefinition = {
        id: "test.rel.1",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "api.endpoint.test",
          target: "application.service.test",
        },
      };

      const patternSourceIdTargetId: PatternDefinition = {
        id: "test.rel.2",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          sourceId: "api.endpoint.test",
          targetId: "application.service.test",
        },
      };

      const match = {};

      const candidate1 = mapToRelationshipCandidate(patternSourceTarget, match, []);
      const candidate2 = mapToRelationshipCandidate(patternSourceIdTargetId, match, []);

      expect(candidate1?.sourceId).toBe("api.endpoint.test");
      expect(candidate1?.targetId).toBe("application.service.test");
      expect(candidate2?.sourceId).toBe("api.endpoint.test");
      expect(candidate2?.targetId).toBe("application.service.test");
    });

    it("rejects bare names in source and target (must be fully-qualified)", () => {
      const pattern: PatternDefinition = {
        id: "test.bare-name",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "{match.sourceName|kebab}", // Bare name - no layer/type
          target: "application.service.test",
        },
      };

      const match = {
        sourceName: "UserService",
      };

      const warnings: string[] = [];
      const candidate = mapToRelationshipCandidate(pattern, match, warnings);

      expect(candidate).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("Invalid source element ID format");
    });

    it("includes source reference with file and line", () => {
      const pattern: PatternDefinition = {
        id: "test.rel",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "api.endpoint.test",
          target: "application.service.test",
        },
      };

      const match = {
        file: "/src/services/user.ts",
        line: "105",
      };

      const candidate = mapToRelationshipCandidate(pattern, match, []);

      expect(candidate?.source?.file).toBe("/src/services/user.ts");
      expect(candidate?.source?.line).toBe(105);
    });

    it("collects relationship attributes excluding source/target fields", () => {
      const pattern: PatternDefinition = {
        id: "test.rel",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "api.endpoint.test",
          target: "application.service.test",
          category: "{match.relationshipCategory}",
          strength: "{match.strength}",
          description: "{match.desc}",
        },
      };

      const match = {
        relationshipCategory: "structural",
        strength: "strong",
        desc: "Used by",
      };

      const candidate = mapToRelationshipCandidate(pattern, match, []);

      expect(candidate?.attributes?.category).toBe("structural");
      expect(candidate?.attributes?.strength).toBe("strong");
      expect(candidate?.attributes?.description).toBe("Used by");
      // Verify source/target not in attributes
      expect(candidate?.attributes?.source).toBeUndefined();
      expect(candidate?.attributes?.target).toBeUndefined();
    });

    it("requires relationshipType in produces section", () => {
      const pattern: PatternDefinition = {
        id: "test.rel",
        produces: {
          type: "relationship",
          layer: "api",
          // relationshipType missing
        } as any,
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "api.endpoint.test",
          target: "application.service.test",
        },
      };

      const match = {};
      const warnings: string[] = [];
      const candidate = mapToRelationshipCandidate(pattern, match, warnings);

      expect(candidate).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("validates element ID format for target (must have at least 3 parts)", () => {
      const pattern: PatternDefinition = {
        id: "test.rel",
        produces: {
          type: "relationship",
          layer: "api",
          relationshipType: "depends-on",
        },
        query: { tool: "test-tool", params: {} },
        confidence: 0.8,
        mapping: {
          source: "api.endpoint.test",
          target: "invalid.id.format.with.too.many.parts",
        },
      };

      const match = {};
      const warnings: string[] = [];
      const candidate = mapToRelationshipCandidate(pattern, match, warnings);

      // Invalid: more than 3 parts should fail
      expect(candidate).toBeNull();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("mapping error");
    });
  });

  describe("expandWildcardElementId", () => {
    it("expands wildcard element IDs to matching concrete elements", () => {
      const availableElements = [
        { id: "api.endpoint.get-user" },
        { id: "api.endpoint.create-user" },
        { id: "api.endpoint.delete-user" },
        { id: "application.service.user-service" },
      ];

      const expanded = expandWildcardElementId("api.endpoint.*", availableElements);

      expect(expanded.length).toBe(3);
      expect(expanded).toContain("api.endpoint.get-user");
      expect(expanded).toContain("api.endpoint.create-user");
      expect(expanded).toContain("api.endpoint.delete-user");
    });

    it("returns empty array when wildcard matches no elements", () => {
      const availableElements = [
        { id: "api.endpoint.test" },
        { id: "application.service.test" },
      ];

      const expanded = expandWildcardElementId("data-model.entity.*", availableElements);

      expect(expanded.length).toBe(0);
      expect(expanded).toEqual([]);
    });

    it("returns original element ID if it contains no wildcard", () => {
      const availableElements = [
        { id: "api.endpoint.get-user" },
        { id: "api.endpoint.create-user" },
      ];

      const expanded = expandWildcardElementId("api.endpoint.get-user", availableElements);

      expect(expanded.length).toBe(1);
      expect(expanded[0]).toBe("api.endpoint.get-user");
    });

    it("rejects invalid wildcard formats", () => {
      const availableElements = [
        { id: "api.endpoint.get-user" },
      ];

      // Invalid: has wildcard but wrong format
      const expanded1 = expandWildcardElementId("api.*", availableElements);
      expect(expanded1.length).toBe(0);

      // Invalid: multiple wildcards
      const expanded2 = expandWildcardElementId("api.*.*.test", availableElements);
      expect(expanded2.length).toBe(0);

      // Invalid: wildcard not at end
      const expanded3 = expandWildcardElementId("api.*.test", availableElements);
      expect(expanded3.length).toBe(0);
    });

    it("matches elements across all layers when expanding wildcards", () => {
      const availableElements = [
        { id: "api.endpoint.test" },
        { id: "application.service.test" },
        { id: "business.process.test" },
        { id: "data-model.entity.test" },
      ];

      const apiExpanded = expandWildcardElementId("api.*", availableElements);
      const appExpanded = expandWildcardElementId("application.*", availableElements);

      // These should not match because "api.*" pattern should require 3 parts
      expect(apiExpanded.length).toBe(0);
      expect(appExpanded.length).toBe(0);

      // Proper format: api.endpoint.*
      const proper = expandWildcardElementId("api.endpoint.*", availableElements);
      expect(proper.length).toBe(1);
      expect(proper[0]).toBe("api.endpoint.test");
    });
  });

  describe("filterDisabledPatterns", () => {
    it("removes pattern sets whose framework is in disabled list", () => {
      const patterns = [
        { layer: "api", framework: "nestjs", version: "default", patterns: [] },
        { layer: "api", framework: "express", version: "default", patterns: [] },
        { layer: "api", framework: "fastify", version: "default", patterns: [] },
        { layer: "testing", framework: "jest", version: "default", patterns: [] },
        { layer: "testing", framework: "pytest", version: "default", patterns: [] },
      ] as any;

      const filtered = filterDisabledPatterns(patterns, ["jest", "pytest"]);

      expect(filtered.length).toBe(3);
      const frameworks = filtered.map((p) => p.framework);
      expect(frameworks).toContain("nestjs");
      expect(frameworks).toContain("express");
      expect(frameworks).toContain("fastify");
      expect(frameworks).not.toContain("jest");
      expect(frameworks).not.toContain("pytest");
    });

    it("returns all patterns if disabled list is empty", () => {
      const patterns = [
        { layer: "api", framework: "nestjs", version: "default", patterns: [] },
        { layer: "api", framework: "express", version: "default", patterns: [] },
      ] as any;

      const filtered = filterDisabledPatterns(patterns, []);

      expect(filtered.length).toBe(2);
    });

    it("returns all patterns if disabled list is undefined", () => {
      const patterns = [
        { layer: "api", framework: "nestjs", version: "default", patterns: [] },
        { layer: "api", framework: "express", version: "default", patterns: [] },
      ] as any;

      const filtered = filterDisabledPatterns(patterns);

      expect(filtered.length).toBe(2);
    });

    it("handles mixed case framework names correctly (case-sensitive)", () => {
      const patterns = [
        { layer: "api", framework: "Jest", version: "default", patterns: [] },
        { layer: "api", framework: "jest", version: "default", patterns: [] },
      ] as any;

      const filtered = filterDisabledPatterns(patterns, ["jest"]);

      // Only lowercase 'jest' should be filtered, not 'Jest'
      expect(filtered.length).toBe(1);
      expect(filtered[0].framework).toBe("Jest");
    });
  });
});
