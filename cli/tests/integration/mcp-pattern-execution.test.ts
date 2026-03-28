/**
 * MCP Pattern Execution Tests
 *
 * Tests for the executePatterns function that invokes CodePrism tools
 * and maps results to element and relationship candidates.
 * These tests verify FR-1 requirement: Pattern Execution Engine
 */

import { describe, it, expect } from "bun:test";
import { executePatterns } from "../../src/commands/scan.js";
import { createMockMcpClient } from "../helpers/mock-mcp-client.js";
import type { PatternSet, PatternDefinition } from "../../src/scan/pattern-loader.js";

describe("Pattern Execution via MCP", () => {
  describe("Element Pattern Execution", () => {
    it("should execute a simple element pattern and produce candidates", async () => {
      // Create mock tool results that simulate CodePrism search_code response
      const mockResults = [
        {
          type: "text" as const,
          text: JSON.stringify([
            { path: "/api/users", method: "GET", file: "src/routes/users.ts", line: 10 },
            { path: "/api/products", method: "GET", file: "src/routes/products.ts", line: 25 },
          ]),
        },
      ];

      const client = createMockMcpClient({
        search_code: mockResults,
      });

      // Create test pattern
      const pattern: PatternDefinition = {
        id: "express.route.handler",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: {
          tool: "search_code",
          params: {
            pattern: "(app|router)\\.(get|post|put|delete)",
            language: "javascript",
          },
        },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.{match.path|kebab}",
          name: "{match.path}",
          method: "{match.method|upper}",
        },
      };

      // Execute the pattern through the production executePatterns function
      const patternSet: PatternSet = {
        layer: "api",
        framework: "express",
        version: "1.0",
        patterns: [pattern],
      };

      const warnings: string[] = [];
      const result = await executePatterns(client, [patternSet], 0.5, warnings, false);

      // Verify candidates were produced
      expect(result).toBeDefined();
      expect(result.elementCandidates).toBeDefined();
      expect(result.elementCandidates.length).toBeGreaterThan(0);

      // Verify the candidates have the expected structure
      const candidate = result.elementCandidates[0];
      expect(candidate.id).toBeDefined();
      expect(candidate.name).toBeDefined();
    });

    it("should handle empty pattern results gracefully", async () => {
      const client = createMockMcpClient({
        search_code: [
          {
            type: "text" as const,
            text: JSON.stringify([]),
          },
        ],
      });

      const pattern: PatternDefinition = {
        id: "test.pattern",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: {
          tool: "search_code",
          params: { pattern: "notfound" },
        },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.test",
          name: "test",
        },
      };

      const patternSet: PatternSet = {
        layer: "api",
        framework: "test",
        version: "1.0",
        patterns: [pattern],
      };

      const warnings: string[] = [];
      const result = await executePatterns(client, [patternSet], 0.5, warnings, false);

      // Should handle empty results without crashing
      expect(result.elementCandidates).toBeDefined();
      expect(result.elementCandidates.length).toBe(0);
    });
  });

  describe("Pattern Set Execution", () => {
    it("should execute multiple patterns from a pattern set", async () => {
      const mockResults = [
        {
          type: "text" as const,
          text: JSON.stringify([
            { path: "/users", method: "GET", file: "src/api.ts", line: 5 },
          ]),
        },
      ];

      const client = createMockMcpClient({
        search_code: mockResults,
        find_dependencies: [
          {
            type: "text" as const,
            text: JSON.stringify([
              {
                sourceId: "api.endpoint.get-users",
                targetId: "data-model.entity.user",
                type: "accesses",
              },
            ]),
          },
        ],
      });

      // Create a pattern set with multiple patterns
      const patternSet: PatternSet = {
        layer: "api",
        framework: "express",
        version: "1.0",
        patterns: [
          {
            id: "express.route.handler",
            produces: {
              type: "node",
              layer: "api",
              elementType: "endpoint",
            },
            query: {
              tool: "search_code",
              params: {
                pattern: "(app|router)\\.(get|post)",
                language: "javascript",
              },
            },
            confidence: 0.85,
            mapping: {
              id: "api.endpoint.{match.path|kebab}",
              name: "{match.path}",
            },
          },
        ],
      };

      // Execute the pattern set through production code
      const warnings: string[] = [];
      const result = await executePatterns(client, [patternSet], 0.5, warnings, false);

      expect(result).toBeDefined();
      expect(result.elementCandidates).toBeDefined();
      expect(result.elementCandidates.length).toBeGreaterThan(0);
    });
  });

  describe("Relationship Pattern Execution", () => {
    it("should execute relationship patterns", async () => {
      const mockResults = [
        {
          type: "text" as const,
          text: JSON.stringify([
            {
              sourceId: "api.endpoint.get-users",
              targetId: "data-model.entity.user",
              type: "accesses",
            },
          ]),
        },
      ];

      const client = createMockMcpClient({
        find_dependencies: mockResults,
      });

      const pattern: PatternDefinition = {
        id: "api.endpoint.accesses.data-model",
        produces: {
          type: "relationship",
          sourceLayer: "api",
          targetLayer: "data-model",
          relationshipType: "accesses",
        },
        query: {
          tool: "find_dependencies",
          params: {
            symbolId: "getUsersEndpoint",
          },
        },
        confidence: 0.8,
        mapping: {
          sourceId: "{match.sourceId}",
          targetId: "{match.targetId}",
          type: "{match.type}",
        },
      };

      const patternSet: PatternSet = {
        layer: "api",
        framework: "express",
        version: "1.0",
        patterns: [pattern],
      };

      const warnings: string[] = [];
      const result = await executePatterns(client, [patternSet], 0.5, warnings, false);

      // Should produce relationship candidates
      expect(result.relationshipCandidates).toBeDefined();
      expect(result.relationshipCandidates.length).toBeGreaterThan(0);

      const candidate = result.relationshipCandidates[0];
      expect(candidate.sourceId).toBe("api.endpoint.get-users");
      expect(candidate.targetId).toBe("data-model.entity.user");
    });
  });

  describe("Tool Error Handling", () => {
    it("should handle tool invocation errors gracefully", async () => {
      const mockResults = [
        {
          type: "error" as const,
          text: "Tool execution failed: timeout",
        },
      ];

      const client = createMockMcpClient({
        search_code: mockResults,
      });

      const pattern: PatternDefinition = {
        id: "test.error.pattern",
        produces: {
          type: "node",
          layer: "api",
          elementType: "endpoint",
        },
        query: {
          tool: "search_code",
          params: { pattern: "test" },
        },
        confidence: 0.85,
        mapping: {
          id: "api.endpoint.test",
          name: "test",
        },
      };

      const patternSet: PatternSet = {
        layer: "api",
        framework: "test",
        version: "1.0",
        patterns: [pattern],
      };

      const warnings: string[] = [];
      const result = await executePatterns(client, [patternSet], 0.5, warnings, false);

      // Should handle errors gracefully without throwing
      expect(result).toBeDefined();
      expect(warnings.length).toBe(1); // Tool errors are logged as warnings
      expect(warnings[0]).toContain("Tool 'search_code' returned error");
      expect(result.elementCandidates.length).toBe(0); // No candidates produced from error result
      expect(result.relationshipCandidates.length).toBe(0);
    });
  });
});
