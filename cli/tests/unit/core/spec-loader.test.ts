/**
 * Unit tests for SpecDataLoader
 *
 * Tests specification data loading from the bundled compiled dist format
 * (14 JSON files: manifest.json, base.json, {layer}.json x12).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SpecDataLoader } from "../../../src/core/spec-loader.js";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

describe("SpecDataLoader", () => {
  // Use spec/dist in the dev monorepo as the canonical bundled dir for tests
  let testBundledDir: string;

  beforeEach(() => {
    testBundledDir = path.join(process.cwd(), "..", "spec", "dist");
  });

  describe("load", () => {
    it("should load layers successfully from bundled dist", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      expect(data.layers).toBeDefined();
      expect(Array.isArray(data.layers)).toBe(true);
      expect(data.layers.length).toBe(12);

      const firstLayer = data.layers[0];
      expect(firstLayer).toHaveProperty("id");
      expect(firstLayer).toHaveProperty("number");
      expect(firstLayer).toHaveProperty("name");
      expect(firstLayer).toHaveProperty("description");
    });

    it("should load node types successfully", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      expect(data.nodeTypes).toBeDefined();
      expect(Array.isArray(data.nodeTypes)).toBe(true);
      expect(data.nodeTypes.length).toBeGreaterThanOrEqual(184);

      const firstNodeType = data.nodeTypes[0];
      expect(firstNodeType).toHaveProperty("spec_node_id");
      expect(firstNodeType).toHaveProperty("layer_id");
      expect(firstNodeType).toHaveProperty("type");
      expect(firstNodeType).toHaveProperty("title");
      expect(firstNodeType).toHaveProperty("description");
    });

    it("should load relationship types successfully", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      expect(data.relationshipTypes).toBeDefined();
      expect(Array.isArray(data.relationshipTypes)).toBe(true);
      expect(data.relationshipTypes.length).toBeGreaterThanOrEqual(955);

      const firstRelType = data.relationshipTypes[0];
      expect(firstRelType).toHaveProperty("id");
      expect(firstRelType).toHaveProperty("source_spec_node_id");
      expect(firstRelType).toHaveProperty("destination_spec_node_id");
      expect(firstRelType).toHaveProperty("predicate");
    });

    it("should load predicates successfully", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      expect(data.predicates).toBeDefined();
      expect(data.predicates instanceof Map).toBe(true);
      expect(data.predicates.size).toBeGreaterThan(0);

      for (const [key, predicate] of data.predicates.entries()) {
        expect(typeof key).toBe("string");
        expect(predicate).toHaveProperty("predicate");
        expect(predicate).toHaveProperty("inverse");
        expect(predicate).toHaveProperty("category");
        expect(predicate).toHaveProperty("description");
        break;
      }
    });

    it("should return all required data when loading", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      expect(data).toHaveProperty("layers");
      expect(data).toHaveProperty("nodeTypes");
      expect(data).toHaveProperty("relationshipTypes");
      expect(data).toHaveProperty("predicates");
    });
  });

  describe("caching behavior", () => {
    it("should cache results when caching is enabled", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: true });

      const data1 = await loader.load();
      const data2 = await loader.load();

      expect(data1).toBe(data2);
    });

    it("should not cache results when caching is disabled", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });

      const data1 = await loader.load();
      const data2 = await loader.load();

      expect(data1).not.toBe(data2);
    });

    it("should cache by default when cache option not specified", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir });

      const data1 = await loader.load();
      const data2 = await loader.load();

      expect(data1).toBe(data2);
    });
  });

  describe("error handling", () => {
    it("should throw error when bundled dir does not exist", async () => {
      const nonexistentDir = path.join(tmpdir(), `nonexistent-${randomUUID()}`);
      const loader = new SpecDataLoader({ bundledDir: nonexistentDir });

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

    it("should throw error when manifest.json is missing", async () => {
      const tempDir = path.join(tmpdir(), `bundled-${randomUUID()}`);
      await fs.mkdir(tempDir, { recursive: true });

      try {
        const loader = new SpecDataLoader({ bundledDir: tempDir });
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

    it("should throw error when manifest.json has invalid JSON", async () => {
      const tempDir = path.join(tmpdir(), `bundled-${randomUUID()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(path.join(tempDir, "manifest.json"), "{ invalid json }");

      try {
        const loader = new SpecDataLoader({ bundledDir: tempDir });
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

  describe("bundled dir resolution", () => {
    it("should use provided bundledDir option", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir });
      const data = await loader.load();
      expect(data).toBeDefined();
      expect(data.layers.length).toBe(12);
    });

    it("should fall back to development spec/dist path if no option given", async () => {
      // Only run if we're in the development monorepo
      const devDistPath = path.join(process.cwd(), "..", "spec", "dist", "manifest.json");
      const inDevEnv = await fs.access(devDistPath).then(() => true).catch(() => false);
      if (!inDevEnv) return;

      const loader = new SpecDataLoader();
      const data = await loader.load();

      expect(data).toBeDefined();
      expect(data.layers.length).toBe(12);
      expect(data.nodeTypes.length).toBeGreaterThanOrEqual(184);
    });

    it("should throw clear error if bundled schemas not found", async () => {
      // Simulate an environment where no bundled schemas exist by pointing
      // to a temp dir with a manifest but no layer files
      const tempDir = path.join(tmpdir(), `missing-bundled-${randomUUID()}`);
      await fs.mkdir(tempDir, { recursive: true });
      const manifest = { specVersion: "0.8.1", builtAt: new Date().toISOString(), layers: [{ id: "motivation", number: 1, name: "Motivation", nodeTypeCount: 0, relationshipCount: 0 }] };
      await fs.writeFile(path.join(tempDir, "manifest.json"), JSON.stringify(manifest));
      // No motivation.json written — so layer load fails

      try {
        const loader = new SpecDataLoader({ bundledDir: tempDir });
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

  describe("data consistency", () => {
    it("should maintain layer order by number", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      for (let i = 1; i < data.layers.length; i++) {
        expect(data.layers[i].number).toBeGreaterThan(data.layers[i - 1].number);
      }
    });

    it("should have valid node type references", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      const layerIds = new Set(data.layers.map((l) => l.id));
      for (const nodeType of data.nodeTypes) {
        expect(layerIds.has(nodeType.layer_id)).toBe(true);
      }
    });

    it("should have valid relationship type references", async () => {
      const loader = new SpecDataLoader({ bundledDir: testBundledDir, cache: false });
      const data = await loader.load();

      const nodeTypeIds = new Set(data.nodeTypes.map((nt) => nt.spec_node_id));
      for (const relType of data.relationshipTypes) {
        expect(relType).toHaveProperty("source_spec_node_id");
        expect(nodeTypeIds.has(relType.source_spec_node_id)).toBe(true);
        expect(relType).toHaveProperty("destination_spec_node_id");
        expect(nodeTypeIds.has(relType.destination_spec_node_id)).toBe(true);
      }
    });
  });
});
