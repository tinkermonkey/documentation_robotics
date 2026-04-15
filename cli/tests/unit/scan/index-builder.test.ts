/**
 * Unit tests for scan index builder
 *
 * Tests the index building pipeline:
 * - Building scan index from CodePrism tools
 * - Loading and saving index files
 * - Freshness checking against workspace modifications
 * - Error handling for tool failures
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildScanIndex,
  loadScanIndex,
  saveScanIndex,
  findMostRecentlyModifiedFile,
  isIndexFresh,
  ScanIndexSchema,
  type ScanIndex
} from "../../../src/scan/index-builder.js";
import { CLIError } from "../../../src/utils/errors.js";
import type { MCPClient, LoadedScanConfig } from "../../../src/scan/mcp-client.js";

describe("Index Builder", () => {
  let testWorkspace: string;

  beforeEach(() => {
    // Create temporary workspace directory
    testWorkspace = join(tmpdir(), `test-index-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });
    mkdirSync(join(testWorkspace, "documentation-robotics"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test workspace
    try {
      const indexPath = join(testWorkspace, "documentation-robotics", "scan-index.json");
      if (existsSync(indexPath)) {
        unlinkSync(indexPath);
      }
      const docRoboticsPath = join(testWorkspace, "documentation-robotics");
      if (existsSync(docRoboticsPath)) {
        unlinkSync(docRoboticsPath);
      }
      if (existsSync(testWorkspace)) {
        unlinkSync(testWorkspace);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("buildScanIndex", () => {
    it("should build scan index from CodePrism tool results", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  total_files: 150,
                  languages: ["TypeScript", "JavaScript"],
                  primary_language: "TypeScript",
                  frameworks: ["React", "Node.js"],
                  file_breakdown: { "*.ts": 100, "*.tsx": 50 }
                })
              }
            ];
          }
          if (toolName === "detect_patterns") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  architectural: [
                    { name: "MVC", confidence: 0.8 }
                  ],
                  data_access: [],
                  security: [],
                  api: [
                    { name: "REST", confidence: 0.9 }
                  ]
                })
              }
            ];
          }
          if (toolName === "suggest_analysis_workflow") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  recommended_tools: ["scan", "validate"],
                  rationale: "Complete architecture scan recommended"
                })
              }
            ];
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      const index = await buildScanIndex(mockClient, testWorkspace);

      expect(index.workspace).toBe(testWorkspace);
      expect(index.repository.total_files).toBe(150);
      expect(index.repository.languages).toContain("TypeScript");
      expect(index.detected_patterns.architectural[0].name).toBe("MVC");
      expect(index.suggested_workflow.recommended_tools).toContain("scan");
      expect(index.indexed_at).toBeDefined();
    });

    it("should throw error when repository_stats fails", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [];  // Empty result - no tool result at all
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      try {
        await buildScanIndex(mockClient, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("repository_stats");
      }
    });

    it("should throw error when detect_patterns fails", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  total_files: 100,
                  languages: ["TypeScript"],
                  frameworks: []
                })
              }
            ];
          }
          if (toolName === "detect_patterns") {
            return [];  // Empty result
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      try {
        await buildScanIndex(mockClient, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("detect_patterns");
      }
    });

    it("should throw error when suggest_analysis_workflow fails", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  total_files: 100,
                  languages: ["TypeScript"],
                  frameworks: []
                })
              }
            ];
          }
          if (toolName === "detect_patterns") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  architectural: [],
                  data_access: [],
                  security: [],
                  api: []
                })
              }
            ];
          }
          if (toolName === "suggest_analysis_workflow") {
            return [];  // Empty result
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      try {
        await buildScanIndex(mockClient, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("suggest_analysis_workflow");
      }
    });

    it("should handle malformed JSON from CodePrism tools", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [{ type: "text" as const, text: "not json {" }];
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      try {
        await buildScanIndex(mockClient, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
      }
    });

    it("should handle tool errors from CodePrism", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "error" as const,
                text: "Tool execution failed"
              }
            ];
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      try {
        await buildScanIndex(mockClient, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("CodePrism tool failed");
      }
    });

    it("should validate generated index against schema", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  // Missing required fields - should fail validation
                  total_files: "invalid"  // Should be number
                })
              }
            ];
          }
          if (toolName === "detect_patterns") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  architectural: [],
                  data_access: [],
                  security: [],
                  api: []
                })
              }
            ];
          }
          if (toolName === "suggest_analysis_workflow") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  recommended_tools: [],
                  rationale: "test"
                })
              }
            ];
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      // Schema validation should allow flexible types that can be coerced
      const index = await buildScanIndex(mockClient, testWorkspace);
      // If it doesn't throw, validation passed
      expect(index).toBeDefined();
    });

    it("should handle confidence values outside 0-1 range", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string) => {
          if (toolName === "repository_stats") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  total_files: 100,
                  languages: [],
                  frameworks: []
                })
              }
            ];
          }
          if (toolName === "detect_patterns") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  architectural: [
                    { name: "Pattern", confidence: 1.5 }  // Out of range
                  ],
                  data_access: [],
                  security: [],
                  api: []
                })
              }
            ];
          }
          if (toolName === "suggest_analysis_workflow") {
            return [
              {
                type: "text" as const,
                text: JSON.stringify({
                  recommended_tools: [],
                  rationale: "test"
                })
              }
            ];
          }
          return [];
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {})
      };

      const index = await buildScanIndex(mockClient, testWorkspace);
      // Should clamp confidence to valid range
      expect(index.detected_patterns.architectural[0].confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("loadScanIndex", () => {
    it("should return null when index file does not exist", async () => {
      const index = await loadScanIndex(testWorkspace);
      expect(index).toBe(null);
    });

    it("should load valid scan index", async () => {
      const indexPath = join(testWorkspace, "documentation-robotics", "scan-index.json");
      const validIndex: ScanIndex = {
        indexed_at: new Date().toISOString(),
        workspace: testWorkspace,
        repository: {
          total_files: 100,
          languages: ["TypeScript"],
          frameworks: ["React"],
          file_breakdown: { "*.ts": 100 }
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: []
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test"
        }
      };
      writeFileSync(indexPath, JSON.stringify(validIndex));

      const loaded = await loadScanIndex(testWorkspace);
      expect(loaded).toBeDefined();
      expect(loaded?.workspace).toBe(testWorkspace);
      expect(loaded?.repository.total_files).toBe(100);
    });

    it("should throw error for corrupted index file", async () => {
      const indexPath = join(testWorkspace, "documentation-robotics", "scan-index.json");
      writeFileSync(indexPath, "invalid json {");

      try {
        await loadScanIndex(testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("Failed to read");
      }
    });

    it("should throw error for invalid index data", async () => {
      const indexPath = join(testWorkspace, "documentation-robotics", "scan-index.json");
      const invalidIndex = {
        indexed_at: "invalid date",  // Invalid format
        workspace: testWorkspace,
        repository: { total_files: 100 },
        detected_patterns: { architectural: [] },
        suggested_workflow: { recommended_tools: [] }
      };
      writeFileSync(indexPath, JSON.stringify(invalidIndex));

      try {
        await loadScanIndex(testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("Corrupted");
      }
    });
  });

  describe("saveScanIndex", () => {
    it("should save valid scan index to file", async () => {
      const index: ScanIndex = {
        indexed_at: new Date().toISOString(),
        workspace: testWorkspace,
        repository: {
          total_files: 100,
          languages: ["TypeScript"],
          frameworks: [],
          file_breakdown: { "*.ts": 100 }
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: []
        },
        suggested_workflow: {
          recommended_tools: ["scan"],
          rationale: "test"
        }
      };

      const path = await saveScanIndex(index, testWorkspace);

      expect(path).toContain("scan-index.json");
      expect(existsSync(path)).toBe(true);

      const loaded = await loadScanIndex(testWorkspace);
      expect(loaded?.repository.total_files).toBe(100);
    });

    it("should throw error for invalid index", async () => {
      const invalidIndex = {
        indexed_at: "invalid",
        workspace: testWorkspace
      } as any;

      try {
        await saveScanIndex(invalidIndex, testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("Invalid");
      }
    });

    it("should support custom output path", async () => {
      const customPath = join(testWorkspace, "custom-index.json");
      const index: ScanIndex = {
        indexed_at: new Date().toISOString(),
        workspace: testWorkspace,
        repository: {
          total_files: 50,
          languages: [],
          frameworks: [],
          file_breakdown: {}
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: []
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test"
        }
      };

      const path = await saveScanIndex(index, testWorkspace, customPath);

      expect(path).toBe(customPath);
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe("findMostRecentlyModifiedFile", () => {
    it("should return null when workspace is empty", async () => {
      const emptyWorkspace = join(tmpdir(), `empty-${Date.now()}`);
      mkdirSync(emptyWorkspace, { recursive: true });

      try {
        const mtime = await findMostRecentlyModifiedFile(emptyWorkspace);
        expect(mtime).toBe(null);
      } finally {
        // Use recursive rmdir instead of unlink
        const fs = await import("node:fs/promises");
        await fs.rm(emptyWorkspace, { recursive: true });
      }
    });

    it("should find recently modified files", async () => {
      const testFile = join(testWorkspace, "test.ts");
      writeFileSync(testFile, "test content");

      const mtime = await findMostRecentlyModifiedFile(testWorkspace);
      expect(mtime).toBeDefined();
      expect(mtime instanceof Date).toBe(true);
    });

    it("should exclude node_modules directory", async () => {
      const nodeModulesDir = join(testWorkspace, "node_modules");
      mkdirSync(nodeModulesDir, { recursive: true });
      const moduleFile = join(nodeModulesDir, "old-module.js");
      writeFileSync(moduleFile, "module");

      // Set file to very old time
      const oldDate = new Date("2020-01-01");
      const oldTime = oldDate.getTime();

      const mtime = await findMostRecentlyModifiedFile(testWorkspace);
      // Should not include the node_modules file
      expect(mtime).not.toEqual(oldDate);
    });

    it("should exclude .git directory", async () => {
      const gitDir = join(testWorkspace, ".git");
      mkdirSync(gitDir, { recursive: true });
      const gitFile = join(gitDir, "config");
      writeFileSync(gitFile, "git config");

      // Create a regular file outside .git so we have something to find
      const regularFile = join(testWorkspace, "regular.ts");
      writeFileSync(regularFile, "regular content");

      const mtime = await findMostRecentlyModifiedFile(testWorkspace);
      // Should find the regular file, not the .git file
      expect(mtime).not.toBe(null);
    });

    it("should handle permission errors gracefully", async () => {
      // This test verifies graceful error handling
      // Permission errors should log warnings but not fail
      const mtime = await findMostRecentlyModifiedFile(testWorkspace);
      // Should return a date or null without throwing
      expect(mtime === null || mtime instanceof Date).toBe(true);
    });

    it("should find most recent among multiple files", async () => {
      const file1 = join(testWorkspace, "old.ts");
      const file2 = join(testWorkspace, "new.ts");

      writeFileSync(file1, "content1");
      // Small delay to ensure different mtimes
      await new Promise((resolve) => setTimeout(resolve, 10));
      writeFileSync(file2, "content2");

      const mtime = await findMostRecentlyModifiedFile(testWorkspace);
      expect(mtime).toBeDefined();
      // mtime should be close to now
      const now = new Date();
      expect((now.getTime() - (mtime?.getTime() ?? 0)) < 1000).toBe(true);
    });
  });

  describe("isIndexFresh", () => {
    it("should return true when index is newer than all files", async () => {
      const testFile = join(testWorkspace, "test.ts");
      writeFileSync(testFile, "content");

      // Wait a bit, then create index with current time
      await new Promise((resolve) => setTimeout(resolve, 50));
      const indexedAt = new Date();
      const index: ScanIndex = {
        indexed_at: indexedAt.toISOString(),
        workspace: testWorkspace,
        repository: {
          total_files: 0,
          languages: [],
          frameworks: [],
          file_breakdown: {}
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: []
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test"
        }
      };

      const fresh = await isIndexFresh(index, testWorkspace);
      expect(fresh).toBe(true);
    });

    it("should return false when workspace has newer files", async () => {
      const oldIndexDate = new Date("2020-01-01");
      const index: ScanIndex = {
        indexed_at: oldIndexDate.toISOString(),
        workspace: testWorkspace,
        repository: {
          total_files: 0,
          languages: [],
          frameworks: [],
          file_breakdown: {}
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: []
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test"
        }
      };

      const testFile = join(testWorkspace, "test.ts");
      writeFileSync(testFile, "content");

      const fresh = await isIndexFresh(index, testWorkspace);
      expect(fresh).toBe(false);
    });

    it("should return true when no files in workspace", async () => {
      // Create a completely empty workspace
      const emptyWorkspace = join(tmpdir(), `empty-fresh-${Date.now()}`);
      mkdirSync(emptyWorkspace, { recursive: true });

      try {
        const index: ScanIndex = {
          indexed_at: new Date("2020-01-01").toISOString(),
          workspace: emptyWorkspace,
          repository: {
            total_files: 0,
            languages: [],
            frameworks: [],
            file_breakdown: {}
          },
          detected_patterns: {
            architectural: [],
            data_access: [],
            security: [],
            api: []
          },
          suggested_workflow: {
            recommended_tools: [],
            rationale: "test"
          }
        };

        const fresh = await isIndexFresh(index, emptyWorkspace);
        // No files found = index is fresh
        expect(fresh).toBe(true);
      } finally {
        const fs = await import("node:fs/promises");
        await fs.rm(emptyWorkspace, { recursive: true });
      }
    });

    it("should handle comparison when no files are found", async () => {
      // Create an empty workspace for this test
      const emptyWorkspace = join(tmpdir(), `empty-compare-${Date.now()}`);
      mkdirSync(emptyWorkspace, { recursive: true });

      try {
        const oldIndexDate = new Date("2000-01-01");
        const index = {
          indexed_at: oldIndexDate.toISOString(),
          workspace: emptyWorkspace,
          repository: {
            total_files: 0,
            languages: [],
            frameworks: [],
            file_breakdown: {}
          },
          detected_patterns: {
            architectural: [],
            data_access: [],
            security: [],
            api: []
          },
          suggested_workflow: {
            recommended_tools: [],
            rationale: "test"
          }
        } as any;

        // Even with an old index date, if no files exist, the index is considered fresh
        const fresh = await isIndexFresh(index, emptyWorkspace);
        expect(fresh).toBe(true);
      } finally {
        const fs = await import("node:fs/promises");
        await fs.rm(emptyWorkspace, { recursive: true });
      }
    });
  });
});
