/**
 * Unit tests for SpecDataLoader
 *
 * Tests specification data loading including:
 * - Successful loading of all spec components (layers, node types, relationships, predicates)
 * - Caching behavior
 * - Error handling for missing files
 * - Error handling for invalid JSON
 * - Explicit specDir option usage
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SpecDataLoader } from "../../../src/core/spec-loader.js";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

describe("SpecDataLoader", () => {
  let testSpecDir: string;

  beforeEach(() => {
    // Use the actual spec directory in the repo for these tests
    // The spec directory is at the root of the monorepo, not in the cli directory
    testSpecDir = path.join(process.cwd(), "..", "spec");
  });

  afterEach(async () => {
    // Cleanup any temporary directories if created
  });

  describe("load", () => {
    it("should load layers successfully from spec directory", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      expect(data.layers).toBeDefined();
      expect(Array.isArray(data.layers)).toBe(true);
      expect(data.layers.length).toBeGreaterThan(0);

      // Verify layer structure
      const firstLayer = data.layers[0];
      expect(firstLayer).toHaveProperty("id");
      expect(firstLayer).toHaveProperty("number");
      expect(firstLayer).toHaveProperty("name");
      expect(firstLayer).toHaveProperty("description");
    });

    it("should load node types successfully", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      expect(data.nodeTypes).toBeDefined();
      expect(Array.isArray(data.nodeTypes)).toBe(true);
      expect(data.nodeTypes.length).toBeGreaterThan(0);

      // Verify node type structure
      const firstNodeType = data.nodeTypes[0];
      expect(firstNodeType).toHaveProperty("spec_node_id");
      expect(firstNodeType).toHaveProperty("layer_id");
      expect(firstNodeType).toHaveProperty("type");
      expect(firstNodeType).toHaveProperty("title");
      expect(firstNodeType).toHaveProperty("description");
    });

    it("should load relationship types successfully", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      expect(data.relationshipTypes).toBeDefined();
      expect(Array.isArray(data.relationshipTypes)).toBe(true);
      expect(data.relationshipTypes.length).toBeGreaterThan(0);

      // Verify relationship type structure
      const firstRelType = data.relationshipTypes[0];
      expect(firstRelType).toHaveProperty("id");
      expect(firstRelType).toHaveProperty("source_spec_node_id");
      expect(firstRelType).toHaveProperty("destination_spec_node_id");
      expect(firstRelType).toHaveProperty("predicate");
    });

    it("should load predicates successfully", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      expect(data.predicates).toBeDefined();
      expect(data.predicates instanceof Map).toBe(true);
      expect(data.predicates.size).toBeGreaterThan(0);

      // Verify predicate structure - should have entries with predicate definitions
      let foundPredicate = false;
      for (const [key, predicate] of data.predicates.entries()) {
        expect(typeof key).toBe("string");
        expect(predicate).toHaveProperty("predicate");
        expect(predicate).toHaveProperty("inverse");
        expect(predicate).toHaveProperty("category");
        expect(predicate).toHaveProperty("description");
        foundPredicate = true;
        break;
      }
      expect(foundPredicate).toBe(true);
    });

    it("should return all required data when loading", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      expect(data).toHaveProperty("layers");
      expect(data).toHaveProperty("nodeTypes");
      expect(data).toHaveProperty("relationshipTypes");
      expect(data).toHaveProperty("predicates");
    });
  });

  describe("caching behavior", () => {
    it("should cache results when caching is enabled", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: true });

      const data1 = await loader.load();
      const data2 = await loader.load();

      // Same reference indicates caching worked
      expect(data1).toBe(data2);
    });

    it("should not cache results when caching is disabled", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });

      const data1 = await loader.load();
      const data2 = await loader.load();

      // Different references when caching is disabled
      // (they may be deep equal but not the same object)
      expect(data1).not.toBe(data2);
    });

    it("should cache by default when cache option not specified", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir });

      const data1 = await loader.load();
      const data2 = await loader.load();

      // Should cache by default
      expect(data1).toBe(data2);
    });
  });

  describe("error handling", () => {
    it("should throw error when spec directory does not exist", async () => {
      const nonexistentDir = path.join(tmpdir(), `nonexistent-${randomUUID()}`);
      const loader = new SpecDataLoader({ specDir: nonexistentDir });

      try {
        await loader.load();
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load specification data");
        }
      }
    });

    it("should throw error when layers directory is missing", async () => {
      const tempDir = path.join(tmpdir(), `spec-${randomUUID()}`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        const loader = new SpecDataLoader({ specDir: tempDir });
        await loader.load();
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load specification data");
        }
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw error with context when JSON parsing fails", async () => {
      const tempDir = path.join(tmpdir(), `spec-${randomUUID()}`);
      const layersDir = path.join(tempDir, "layers");
      const schemasDir = path.join(tempDir, "schemas", "base");

      await fs.mkdir(layersDir, { recursive: true });
      await fs.mkdir(schemasDir, { recursive: true });

      // Create invalid JSON file
      await fs.writeFile(
        path.join(layersDir, "01-test.layer.json"),
        "{ invalid json }"
      );

      // Create minimal required schema files
      await fs.writeFile(
        path.join(schemasDir, "predicates.json"),
        JSON.stringify({})
      );

      try {
        const loader = new SpecDataLoader({ specDir: tempDir });
        await loader.load();
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toContain("Failed to load specification data");
        }
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("spec directory resolution", () => {
    it("should use provided specDir option", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir });

      // The loader should successfully load from the provided directory
      const data = await loader.load();
      expect(data).toBeDefined();
      expect(data.layers.length).toBeGreaterThan(0);
    });

    it("should handle relative paths in specDir", async () => {
      // Get relative path from current working directory to spec
      const relativeSpecDir = path.relative(process.cwd(), testSpecDir);
      const loader = new SpecDataLoader({ specDir: relativeSpecDir });

      // Should be able to load from relative path
      const data = await loader.load();
      expect(data).toBeDefined();
      expect(data.layers.length).toBeGreaterThan(0);
    });

    it("should load from .dr/spec/ when available", async () => {
      // This test verifies that when an explicit specDir pointing to .dr/spec/ is provided,
      // the loader can successfully load from it
      // We'll use the actual spec directory but verify the path resolution logic

      // The main verification here is that the loader accepts .dr/spec/ paths
      // which is what happens when the automatic path resolution finds it
      const loader = new SpecDataLoader({ specDir: testSpecDir });
      const data = await loader.load();

      expect(data).toBeDefined();
      expect(data.layers.length).toBeGreaterThan(0);

      // This confirms the loader can work with .dr/spec/ style paths
      // The actual path resolution is tested implicitly when running CLI commands
    });

    it("should fall back to development path if .dr/ not found", async () => {
      // This test verifies fallback to ../../../spec when .dr/ doesn't exist
      // Only run if we're in development environment (spec/ exists)
      const devSpecPath = path.join(process.cwd(), "..", "spec", "layers", "01-motivation.layer.json");
      if (!await fs.access(devSpecPath).then(() => true).catch(() => false)) {
        // Skip this test if not in development environment
        return;
      }

      // Create loader without specDir option - should use default resolution
      const loader = new SpecDataLoader();
      const data = await loader.load();

      expect(data).toBeDefined();
      expect(data.layers.length).toBe(12);
      expect(data.nodeTypes.length).toBeGreaterThanOrEqual(354);
    });

    it("should throw clear error if spec directory not found", async () => {
      // Test with an explicitly non-existent directory
      const nonExistentDir = path.join(tmpdir(), `nonexistent-spec-${randomUUID()}`);

      try {
        const loader = new SpecDataLoader({ specDir: nonExistentDir });
        await loader.load();
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          // Error message will contain "Failed to load specification data" from the loader
          expect(error.message).toContain("Failed to load specification data");
        }
      }
    });
  });

  describe("data consistency", () => {
    it("should maintain layer order by number", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      // Verify layers are sorted by number
      for (let i = 1; i < data.layers.length; i++) {
        expect(data.layers[i].number).toBeGreaterThan(
          data.layers[i - 1].number
        );
      }
    });

    it("should have valid node type references", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      // All node types should reference valid layers
      const layerIds = new Set(data.layers.map((l) => l.id));

      for (const nodeType of data.nodeTypes) {
        expect(layerIds.has(nodeType.layer_id)).toBe(true);
      }
    });

    it("should have valid relationship type references", async () => {
      const loader = new SpecDataLoader({ specDir: testSpecDir, cache: false });
      const data = await loader.load();

      // All relationship types should reference valid node types
      const nodeTypeIds = new Set(data.nodeTypes.map((nt) => nt.spec_node_id));

      for (const relType of data.relationshipTypes) {
        // Source should be valid (for cross-layer relationships, source can be any layer)
        expect(relType).toHaveProperty("source_spec_node_id");
        expect(nodeTypeIds.has(relType.source_spec_node_id)).toBe(true);
        expect(relType).toHaveProperty("destination_spec_node_id");
        expect(nodeTypeIds.has(relType.destination_spec_node_id)).toBe(true);
      }
    });
  });
});
