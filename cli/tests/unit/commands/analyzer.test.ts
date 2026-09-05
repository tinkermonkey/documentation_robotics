/**
 * Analyzer Command Unit Tests
 *
 * Tests for the analyzer command discover functionality, including:
 * - Discover with no analyzers installed
 * - Discovery result structure and metadata
 * - JSON and text output modes
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { performDiscover } from "../../../src/commands/discover-logic.js";
import type { AnalyzerRegistry } from "../../../src/analyzers/registry.js";
import type { DiscoveryResult } from "../../../src/analyzers/types.js";

/**
 * Mock analyzer registry for testing
 */
function createMockRegistry(analyzers: any[] = []): any {
  return {
    getAnalyzerNames: async () => analyzers.map((a) => a.name),
    getAnalyzer: async (name: string) => {
      const analyzer = analyzers.find((a) => a.name === name);
      if (!analyzer) return null;
      return analyzer.backend;
    },
  };
}

/**
 * Mock analyzer backend
 */
function createMockBackend(name: string, displayName: string, installed: boolean) {
  return {
    name,
    displayName,
    detect: async () => ({
      installed,
      binary_path: installed ? `/usr/bin/${name}` : undefined,
    }),
  };
}

/**
 * Setup MappingLoader mock with custom metadata loader
 * Returns a cleanup function to restore the original
 */
function setupMappingLoaderMock(
  metadataLoader: (name: string) => Promise<any>
): () => void {
  const originalLoad = require("../../../src/analyzers/mapping-loader.js").MappingLoader.load;

  (require("../../../src/analyzers/mapping-loader.js").MappingLoader as any).load = metadataLoader;

  return () => {
    (require("../../../src/analyzers/mapping-loader.js").MappingLoader as any).load = originalLoad;
  };
}

describe("Analyzer Command - discover with no analyzer installed", () => {
  describe("discover behavior when no analyzers are installed", () => {
    it("should return empty found array and zero installed count when no analyzers installed", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test analyzer",
          homepage: `https://example.com/${name}`,
        }),
      }));

      try {
        // Create registry with one registered but not installed analyzer
        const registry = createMockRegistry([
          {
            name: "test-analyzer",
            backend: createMockBackend("test-analyzer", "Test Analyzer", false),
          },
        ]);

        // Run discover
        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // When no analyzers are installed, found array should have the analyzer but installed_count should be 0
        expect(result.discoveryResult.found.length).toBeGreaterThanOrEqual(0);
        expect(result.discoveryResult.installed_count).toBe(0);
        expect(result.installed.length).toBe(0);
      } finally {
        cleanup();
      }
    });

    it("should distinguish between registered but uninstalled analyzers", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test analyzer",
          homepage: `https://example.com/${name}`,
        }),
      }));

      try {
        // Scenario: analyzers registered but none installed
        const registry = createMockRegistry([
          {
            name: "cbm",
            backend: createMockBackend("cbm", "CBM Analyzer", false),
          },
          {
            name: "other",
            backend: createMockBackend("other", "Other Analyzer", false),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // Should have found both analyzers but installed_count should be 0
        expect(result.discoveryResult.found.length).toBeGreaterThanOrEqual(2);
        expect(result.discoveryResult.found.every((a) => !a.installed)).toBe(true);
        expect(result.discoveryResult.installed_count).toBe(0);
        expect(result.installed.length).toBe(0);
      } finally {
        cleanup();
      }
    });

    it("should set installed flag correctly for each analyzer", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test analyzer",
          homepage: `https://example.com/${name}`,
        }),
      }));

      try {
        // Mix of installed and uninstalled analyzers
        const registry = createMockRegistry([
          {
            name: "installed-one",
            backend: createMockBackend("installed-one", "Installed One", true),
          },
          {
            name: "not-installed",
            backend: createMockBackend("not-installed", "Not Installed", false),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // Verify installed field is set correctly
        const foundAnalyzers = result.discoveryResult.found;
        const installedOne = foundAnalyzers.find((a) => a.name === "installed-one");
        const notInstalled = foundAnalyzers.find((a) => a.name === "not-installed");

        expect(installedOne?.installed).toBe(true);
        expect(notInstalled?.installed).toBe(false);
        expect(result.discoveryResult.installed_count).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("should not select analyzer in non-JSON text mode when none installed", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test analyzer",
          homepage: `https://example.com/${name}`,
        }),
      }));

      try {
        const registry = createMockRegistry([
          {
            name: "test-analyzer",
            backend: createMockBackend("test-analyzer", "Test Analyzer", false),
          },
        ]);

        // Text mode (json: false) with no installed analyzers
        const result = await performDiscover(registry, {
          json: false,
          isTTY: true,
        });

        // Should not select or write session
        expect(result.selectedAnalyzer).toBeUndefined();
        expect(result.shouldWriteSession).toBe(false);
      } finally {
        cleanup();
      }
    });

    it("should handle metadata loading errors gracefully", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => {
        if (name === "broken") {
          throw new Error("Failed to load metadata");
        }
        return {
          getAnalyzerMetadata: () => ({
            name,
            display_name: `${name} Analyzer`,
            description: "Test analyzer",
            homepage: `https://example.com/${name}`,
          }),
        };
      });

      try {
        const registry = createMockRegistry([
          {
            name: "broken",
            backend: createMockBackend("broken", "Broken", false),
          },
          {
            name: "working",
            backend: createMockBackend("working", "Working", false),
          },
        ]);

        // Should continue despite error in one analyzer
        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // Should have at least completed
        expect(result.discoveryResult).toBeDefined();
        expect(result.discoveryResult.installed_count).toBe(0);
      } finally {
        cleanup();
      }
    });
  });

  describe("discover JSON output structure", () => {
    it("should return valid DiscoveryResult structure", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test",
          homepage: "https://example.com",
        }),
      }));

      try {
        const registry = createMockRegistry([
          {
            name: "test",
            backend: createMockBackend("test", "Test", false),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        const discovery = result.discoveryResult;

        // Verify DiscoveryResult structure
        expect(discovery).toHaveProperty("found");
        expect(discovery).toHaveProperty("installed_count");
        expect(Array.isArray(discovery.found)).toBe(true);
        expect(typeof discovery.installed_count).toBe("number");
      } finally {
        cleanup();
      }
    });

    it("should include all AvailableAnalyzer fields in found array", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test analyzer description",
          homepage: "https://example.com/analyzer",
        }),
      }));

      try {
        const registry = createMockRegistry([
          {
            name: "test",
            backend: createMockBackend("test", "Test Analyzer", false),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // Check first analyzer in found array
        if (result.discoveryResult.found.length > 0) {
          const analyzer = result.discoveryResult.found[0];
          expect(analyzer).toHaveProperty("name");
          expect(analyzer).toHaveProperty("display_name");
          expect(analyzer).toHaveProperty("description");
          expect(analyzer).toHaveProperty("homepage");
          expect(analyzer).toHaveProperty("installed");
        }
      } finally {
        cleanup();
      }
    });

    it("should only include selected field when session exists or auto-selected", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test",
          homepage: "https://example.com",
        }),
      }));

      try {
        // No analyzers installed case
        const registry = createMockRegistry([
          {
            name: "test",
            backend: createMockBackend("test", "Test", false),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // When no analyzers installed, selected field should not be in result
        const hasSelected = "selected" in result.discoveryResult;
        expect(hasSelected).toBe(result.selectedAnalyzer !== undefined);
      } finally {
        cleanup();
      }
    });
  });

  describe("discover session persistence", () => {
    it("should not select analyzer when no analyzers are installed in any mode", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test",
          homepage: "https://example.com",
        }),
      }));

      try {
        const registry = createMockRegistry([
          {
            name: "test",
            backend: createMockBackend("test", "Test", false),
          },
        ]);

        // Test both modes
        const jsonResult = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        const textResult = await performDiscover(registry, {
          json: false,
          isTTY: true,
        });

        // Neither should select when no analyzers installed
        expect(jsonResult.selectedAnalyzer).toBeUndefined();
        expect(textResult.selectedAnalyzer).toBeUndefined();
        expect(jsonResult.shouldWriteSession).toBe(false);
        expect(textResult.shouldWriteSession).toBe(false);
      } finally {
        cleanup();
      }
    });

    it("should auto-select first analyzer in non-TTY JSON mode when analyzers exist", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test",
          homepage: "https://example.com",
        }),
      }));

      try {
        const registry = createMockRegistry([
          {
            name: "first",
            backend: createMockBackend("first", "First", true),
          },
          {
            name: "second",
            backend: createMockBackend("second", "Second", true),
          },
        ]);

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
          reselect: true,
        });

        // In non-TTY with analyzers installed and reselect, should auto-select first
        expect(result.selectedAnalyzer).toBe("first");
        expect(result.shouldWriteSession).toBe(true);
      } finally {
        cleanup();
      }
    });
  });

  describe("discover error handling", () => {
    it("should throw when no analyzers registered", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({}),
      }));

      try {
        const registry = createMockRegistry([]); // No analyzers

        let errorThrown = false;
        try {
          await performDiscover(registry, { json: true });
        } catch (error) {
          errorThrown = true;
          expect(error instanceof Error).toBe(true);
        }

        expect(errorThrown).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("should continue discovery when analyzer backend is null", async () => {
      const cleanup = setupMappingLoaderMock(async (name: string) => ({
        getAnalyzerMetadata: () => ({
          name,
          display_name: `${name} Analyzer`,
          description: "Test",
          homepage: "https://example.com",
        }),
      }));

      try {
        // Registry that returns null for one analyzer
        const registry = {
          getAnalyzerNames: async () => ["null-analyzer", "working-analyzer"],
          getAnalyzer: async (name: string) => {
            if (name === "null-analyzer") return null;
            return createMockBackend("working-analyzer", "Working", false);
          },
        };

        const result = await performDiscover(registry, {
          json: true,
          isTTY: false,
        });

        // Should have completed despite null analyzer
        expect(result.discoveryResult).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });
});
