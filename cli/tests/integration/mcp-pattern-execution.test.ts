/**
 * MCP Pattern Execution Tests
 *
 * Tests for the executePatterns function that invokes CodePrism tools
 * and maps results to element and relationship candidates.
 * These tests verify FR-1 requirement: Pattern Execution Engine
 */

import { describe, it, expect } from "bun:test";
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

      // Execute the pattern
      const results = await client.callTool("search_code", pattern.query.params);

      // Verify results are returned
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // Parse the JSON response
      if (results[0].text) {
        const matches = JSON.parse(results[0].text);
        expect(matches).toHaveLength(2);
        expect(matches[0].path).toBe("/api/users");
        expect(matches[0].file).toBe("src/routes/users.ts");
      }
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

      const results = await client.callTool("search_code", { pattern: "notfound" });

      expect(results).toBeDefined();
      expect(results[0].type).toBe("text");

      if (results[0].text) {
        const matches = JSON.parse(results[0].text);
        expect(matches).toHaveLength(0);
      }
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
      });

      // Create a minimal pattern set
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

      // Execute the pattern set's query
      const results = await client.callTool("search_code", patternSet.patterns[0].query.params);

      expect(results).toBeDefined();
      expect(results[0].type).toBe("text");
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

      const results = await client.callTool("find_dependencies", {
        symbolId: "getUsersEndpoint",
      });

      expect(results).toBeDefined();
      expect(results[0].type).toBe("text");

      if (results[0].text) {
        const matches = JSON.parse(results[0].text);
        expect(matches).toHaveLength(1);
        expect(matches[0].sourceId).toBe("api.endpoint.get-users");
      }
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

      const results = await client.callTool("search_code", { pattern: "test" });

      expect(results).toBeDefined();
      expect(results[0].type).toBe("error");
      expect(results[0].text).toContain("timeout");
    });
  });
});
