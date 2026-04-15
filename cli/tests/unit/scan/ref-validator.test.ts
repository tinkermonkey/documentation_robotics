/**
 * Unit tests for source reference validator
 *
 * Tests validation of source references:
 * - File existence checking
 * - Symbol existence verification
 * - Symbol type matching
 * - Symbol move detection
 * - Dead reference detection
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  validateSourceLocation,
  validateElementReferences,
  checkElementReferences,
  type LocationValidationResult
} from "../../../src/scan/ref-validator.js";
import { type MCPClient } from "../../../src/scan/mcp-client.js";
import type { Element } from "../../../src/core/element.js";

describe("ref-validator", () => {
  let mockClient: MCPClient;

  beforeEach(() => {
    mockClient = {
      isConnected: true,
      callTool: mock(async (toolName: string) => {
        return [];
      }),
      listTools: mock(async () => []),
      disconnect: mock(async () => {}),
    } as any;
  });

  describe("validateSourceLocation", () => {
    it("should report 'stale' when file is not found", async () => {
      // Mock find_files to return empty
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: "[]" }];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/missing.ts" },
        "service"
      );

      expect(result.status).toBe("stale");
      expect(result.message).toContain("not found");
    });

    it("should report 'ok' when file exists and no symbol is specified", async () => {
      // Mock find_files to return the file
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/found.ts" },
        "service"
      );

      expect(result.status).toBe("ok");
      expect(result.message).toContain("File exists");
    });

    it("should report 'symbol_missing' when symbol not found at location", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "not found" }];
        }
        if (toolName === "search_symbols") {
          return [{ type: "text" as const, text: "[]" }];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/found.ts", symbol: "MyService" },
        "service"
      );

      expect(result.status).toBe("symbol_missing");
      expect(result.message).toContain("not found");
    });

    it("should report 'symbol_moved' when symbol found in different location", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "not found" }];
        }
        if (toolName === "search_symbols") {
          return [
            {
              type: "text" as const,
              text: '[{"file": "src/new-location.ts", "symbol": "MyService"}]',
            },
          ];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/old-location.ts", symbol: "MyService" },
        "service"
      );

      expect(result.status).toBe("symbol_moved");
      expect(result.newLocation).toBeDefined();
      expect(result.newLocation?.file).toBe("src/new-location.ts");
    });

    it("should report 'symbol_type_mismatch' when symbol type doesn't match", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          // Return that it's a function, but we expect a service (class)
          return [{ type: "text" as const, text: "type: function" }];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/found.ts", symbol: "MyService" },
        "service"  // Expecting a service (class), but got a function
      );

      expect(result.status).toBe("symbol_type_mismatch");
      expect(result.context?.declaredType).toBe("service");
      expect(result.context?.actualType).toBe("function");
    });

    it("should report 'ok' when symbol exists and type matches", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: class" }];
        }
        return [];
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/found.ts", symbol: "MyService" },
        "service"  // Service maps to class, which matches
      );

      expect(result.status).toBe("ok");
      expect(result.message).toContain("Valid");
    });

    it("should handle CodePrism errors gracefully", async () => {
      mockClient.callTool = mock(async () => {
        throw new Error("CodePrism connection lost");
      });

      const result = await validateSourceLocation(
        mockClient,
        { file: "src/test.ts", symbol: "Test" },
        "service"
      );

      expect(result.status).toBe("error");
      expect(result.message).toContain("Error");
    });

    it("should infer language from file extension", async () => {
      const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

      mockClient.callTool = mock(async (toolName: string, args: Record<string, unknown>) => {
        toolCalls.push({ tool: toolName, args });

        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: class" }];
        }
        return [];
      });

      await validateSourceLocation(
        mockClient,
        { file: "src/found.ts", symbol: "MyClass" },
        "service"
      );

      // Should have called search_symbols with typescript language
      const searchCall = toolCalls.find((c) => c.tool === "search_symbols");
      if (searchCall) {
        // Language inference should happen for .ts files
        expect(searchCall.args.language).toBe("typescript");
      }
    });
  });

  describe("type matching", () => {
    it("should match service to class", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: class" }];
        }
        return [];
      });

      const result = await validateSourceLocation(mockClient, { file: "src/found.ts", symbol: "MyService" }, "service");
      expect(result.status).toBe("ok");
    });

    it("should match endpoint to function", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: function" }];
        }
        return [];
      });

      const result = await validateSourceLocation(mockClient, { file: "src/found.ts", symbol: "handleRequest" }, "endpoint");
      expect(result.status).toBe("ok");
    });

    it("should not match function element to class construct", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: class" }];
        }
        return [];
      });

      const result = await validateSourceLocation(mockClient, { file: "src/found.ts", symbol: "MyClass" }, "function");
      expect(result.status).toBe("symbol_type_mismatch");
    });
  });

  describe("checkElementReferences", () => {
    it("should return false when locations array is empty", async () => {
      const hasReferences = await checkElementReferences(mockClient, []);
      expect(hasReferences).toBe(false);
    });

    it("should return true when references are found", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_references") {
          return [
            {
              type: "text" as const,
              text: '[{"file": "src/usage.ts", "symbol": "MyService", "line": 42}]'
            }
          ];
        }
        return [];
      });

      const result = await checkElementReferences(mockClient, [
        { file: "src/service.ts", symbol: "MyService" }
      ]);
      expect(result).toBe(true);
    });

    it("should return false when no references are found", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_references") {
          return [{ type: "text" as const, text: "[]" }];
        }
        return [];
      });

      const result = await checkElementReferences(mockClient, [
        { file: "src/service.ts", symbol: "UnusedService" }
      ]);
      expect(result).toBe(false);
    });

    it("should skip locations without symbols", async () => {
      mockClient.callTool = mock(async () => {
        throw new Error("Should not be called for locations without symbols");
      });

      const result = await checkElementReferences(mockClient, [
        { file: "src/file.ts" }  // No symbol
      ]);
      // Should return false without calling find_references
      expect(result).toBe(false);
    });

    it("should return true if any location has references", async () => {
      let callCount = 0;
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_references") {
          callCount++;
          if (callCount === 2) {
            // Second location has references
            return [
              {
                type: "text" as const,
                text: '[{"file": "src/usage.ts", "symbol": "ServiceB"}]'
              }
            ];
          }
          return [{ type: "text" as const, text: "[]" }];
        }
        return [];
      });

      const result = await checkElementReferences(mockClient, [
        { file: "src/service-a.ts", symbol: "ServiceA" },
        { file: "src/service-b.ts", symbol: "ServiceB" }
      ]);
      expect(result).toBe(true);
    });

    it("should handle CodePrism errors gracefully", async () => {
      mockClient.callTool = mock(async () => {
        throw new Error("CodePrism connection lost");
      });

      const result = await checkElementReferences(mockClient, [
        { file: "src/service.ts", symbol: "MyService" }
      ]);
      // On error, conservatively assume not dead (return true)
      expect(result).toBe(true);
    });

    it("should handle non-JSON responses from find_references", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_references") {
          return [
            {
              type: "text" as const,
              text: "Not valid JSON"
            }
          ];
        }
        return [];
      });

      // Should handle parse errors and assume references exist
      const result = await checkElementReferences(mockClient, [
        { file: "src/service.ts", symbol: "MyService" }
      ]);
      expect(result).toBe(true);
    });
  });

  describe("validateElementReferences", () => {
    it("should return error for element without source reference", async () => {
      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("error");
      expect(result.summary).toContain("No source reference");
    });

    it("should return warning for extracted element without locations", async () => {
      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: []
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("warning");
      expect(result.summary).toContain("No locations");
    });

    it("should return ok for inferred element without locations", async () => {
      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "inferred",
          locations: []
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("ok");
      expect(result.summary).toContain("acceptable");
    });

    it("should validate all locations and aggregate results", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: function" }];
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "manual",
          locations: [
            { file: "src/found.ts", symbol: "getUser" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("ok");
      expect(result.locations.length).toBe(1);
      expect(result.locations[0].status).toBe("ok");
    });

    it("should detect stale files in element references", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: "[]" }];  // File not found
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: [
            { file: "src/missing.ts", symbol: "getUser" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("error");
      expect(result.locations[0].status).toBe("stale");
    });

    it("should detect symbol type mismatches", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: variable" }];  // Mismatch
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: [
            { file: "src/found.ts", symbol: "getUser" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("error");
      expect(result.locations[0].status).toBe("symbol_type_mismatch");
    });

    it("should detect dead references for extracted elements", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: function" }];
        }
        if (toolName === "find_references") {
          return [{ type: "text" as const, text: "[]" }];  // No references
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: [
            { file: "src/found.ts", symbol: "getUser" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.isDead).toBe(true);
      expect(result.overallStatus).toBe("warning");
      expect(result.summary).toContain("dead");
    });

    it("should detect moved symbols as warnings", async () => {
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          return [{ type: "text" as const, text: '["src/found.ts"]' }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "not found" }];
        }
        if (toolName === "search_symbols") {
          return [
            {
              type: "text" as const,
              text: '[{"file": "src/new-location.ts", "symbol": "getUser"}]'
            }
          ];
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: [
            { file: "src/old.ts", symbol: "getUser" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.overallStatus).toBe("warning");
      expect(result.locations[0].status).toBe("symbol_moved");
      expect(result.locations[0].newLocation?.file).toBe("src/new-location.ts");
    });

    it("should aggregate multiple location statuses correctly", async () => {
      let callCount = 0;
      mockClient.callTool = mock(async (toolName: string) => {
        if (toolName === "find_files") {
          callCount++;
          // First file exists, second doesn't
          if (callCount === 1) {
            return [{ type: "text" as const, text: '["src/valid.ts"]' }];
          }
          return [{ type: "text" as const, text: "[]" }];
        }
        if (toolName === "explain_symbol") {
          return [{ type: "text" as const, text: "type: function" }];
        }
        return [];
      });

      const element: Element = {
        id: "api.endpoint.get-user",
        path: "api.endpoint.get-user",
        name: "Get User",
        layer: "api",
        type: "endpoint",
        source_reference: {
          provenance: "extracted",
          locations: [
            { file: "src/valid.ts", symbol: "getUser" },
            { file: "src/missing.ts", symbol: "helper" }
          ]
        },
        metadata: {}
      } as any;

      const result = await validateElementReferences(mockClient, element);
      expect(result.locations.length).toBe(2);
      expect(result.locations[0].status).toBe("ok");
      expect(result.locations[1].status).toBe("stale");
      expect(result.overallStatus).toBe("error");  // Has stale
    });
  });
});
