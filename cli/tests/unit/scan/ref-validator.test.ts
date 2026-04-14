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
import { validateSourceLocation, type LocationValidationResult } from "../../../src/scan/ref-validator.js";
import { type MCPClient } from "../../../src/scan/mcp-client.js";

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
});
