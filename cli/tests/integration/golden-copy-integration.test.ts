/**
 * Integration Tests for Golden Copy Helper Functions
 *
 * Tests the high-level golden copy API used by tests:
 * - createTestModelWithGoldenCopy
 * - initializeGoldenCopy
 * - cleanupGoldenCopy
 * - getGoldenCopyStats
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createTestModelWithGoldenCopy,
  initializeGoldenCopy,
  cleanupGoldenCopy,
  getGoldenCopyStats,
  resetGoldenCopyManager,
} from "../../tests/helpers/golden-copy-helper.js";
import {
  createTestModel,
  addTestElement,
  addTestElements,
} from "../../tests/helpers/test-fixtures.js";
import { GoldenCopyCacheManager } from "../../src/core/golden-copy-cache.js";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

describe("Golden Copy Integration", () => {
  let testCacheDir: string;

  beforeEach(() => {
    resetGoldenCopyManager();
    testCacheDir = join(
      tmpdir(),
      `golden-copy-integration-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    );

    // Configure manager with test cache directory
    GoldenCopyCacheManager.getInstance({
      cacheDir: testCacheDir,
    });
  });

  afterEach(async () => {
    await cleanupGoldenCopy();

    // Clean up test directory
    try {
      await rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    resetGoldenCopyManager();
  });

  describe("createTestModelWithGoldenCopy", () => {
    it("should create a test model with golden copy enabled by default", async () => {
      await initializeGoldenCopy({ cacheDir: testCacheDir });

      const { model, cleanup, fromGoldenCopy } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      expect(model).toBeDefined();
      expect(model.rootPath).toBeDefined();
      expect(cleanup).toBeDefined();
      expect(fromGoldenCopy).toBe(true);

      await cleanup();
    });

    it("should create a fresh model when golden copy is disabled", async () => {
      const { model, cleanup, fromGoldenCopy } = await createTestModelWithGoldenCopy({
        useGoldenCopy: false,
      });

      expect(model).toBeDefined();
      expect(fromGoldenCopy).toBe(false);

      await cleanup();
    });

    it("should fall back gracefully if golden copy fails", async () => {
      // Don't initialize golden copy, so clone will fail
      const { model, cleanup, fromGoldenCopy } = await createTestModelWithGoldenCopy({
        useGoldenCopy: true, // Try to use golden copy
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      // Should fall back to fresh model
      expect(model).toBeDefined();
      expect(typeof fromGoldenCopy).toBe("boolean");

      await cleanup();
    });

    it("should provide valid model for use", async () => {
      await initializeGoldenCopy({ cacheDir: testCacheDir, warmup: true });

      const { model, cleanup } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      // Should be able to add elements
      const element = await addTestElement(model, "api", "endpoint", "api.endpoint.test", {
        name: "Test Endpoint",
        properties: { method: "GET", path: "/test" },
      });

      expect(element).toBeDefined();
      expect(model.getElementById("api.endpoint.test")).toBeDefined();

      await cleanup();
    });

    it("should support custom model options", async () => {
      const { model, cleanup } = await createTestModelWithGoldenCopy({
        useGoldenCopy: false, // Fresh model for testing options
        fallbackOptions: {
          name: "Custom Test Model",
          version: "2.0.0",
          specVersion: "0.7.1",
        },
      });

      expect(model.manifest.name).toBe("Custom Test Model");
      expect(model.manifest.version).toBe("2.0.0");

      await cleanup();
    });
  });

  describe("initializeGoldenCopy", () => {
    it("should initialize golden copy with config", async () => {
      const manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(false);

      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(true);
    });

    it("should support warmup during initialization", async () => {
      // Create a fresh manager instance for this test
      GoldenCopyCacheManager.resetInstance();

      const manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
        warmup: true,
        eagerLoad: true, // Load layers eagerly so warmup elements are visible
      });

      // Initialize the manager
      await manager.init();

      const goldenModel = manager.getGoldenModel();
      // With warmup, should have elements in the layers
      expect(goldenModel).toBeDefined();
      expect(goldenModel?.layers.size).toBeGreaterThan(0);

      // Verify that at least one layer has elements
      let elementCount = 0;
      for (const layer of goldenModel?.layers.values() ?? []) {
        elementCount += layer.elements.size;
      }
      expect(elementCount).toBeGreaterThan(0);
    });

    it("should not reinitialize if already initialized", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      const manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      // Verify initialization status before and after second init call
      expect(manager.isInitialized()).toBe(true);
      const statsBeforeReinit = manager.getStats();

      // Call init again
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      // Should still be initialized and stats should not have incremented
      // (proving no reinitialization occurred)
      expect(manager.isInitialized()).toBe(true);
      const statsAfterReinit = manager.getStats();
      expect(statsAfterReinit.initCount).toBe(statsBeforeReinit.initCount);
    });
  });

  describe("cleanupGoldenCopy", () => {
    it("should clean up golden copy resources", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      let manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(true);

      await cleanupGoldenCopy();

      // Reset and get new manager
      resetGoldenCopyManager();
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(false);
    });

    it("should handle cleanup when not initialized", async () => {
      // Should not throw even if not initialized
      expect(async () => {
        await cleanupGoldenCopy();
      }).not.toThrow();
    });
  });

  describe("getGoldenCopyStats", () => {
    it("should return statistics object", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      const stats = getGoldenCopyStats();

      expect(stats).toBeDefined();
      expect(stats.initCount).toBeGreaterThan(0);
      expect(stats.cloneCount).toBe(0);
      expect(stats.totalInitTime).toBeGreaterThanOrEqual(0);
    });

    it("should track clone statistics", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      // Create a clone
      const { cleanup } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      const stats = getGoldenCopyStats();

      expect(stats.cloneCount).toBe(1);
      expect(stats.totalCloneTime).toBeGreaterThanOrEqual(0);
      expect(stats.avgCloneTime).toBeGreaterThan(0);

      await cleanup();
    });

    it("should calculate correct averages", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      // Create multiple clones
      const clones = [];
      for (let i = 0; i < 3; i++) {
        const clone = await createTestModelWithGoldenCopy({
          goldenCopyConfig: { cacheDir: testCacheDir },
        });
        clones.push(clone);
      }

      const stats = getGoldenCopyStats();

      expect(stats.cloneCount).toBe(3);
      expect(stats.avgCloneTime).toBe(stats.totalCloneTime / stats.cloneCount);

      for (const clone of clones) {
        await clone.cleanup();
      }
    });
  });

  describe("Integration Workflows", () => {
    it("should support typical test suite workflow", async () => {
      // Suite setup
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
        warmup: true,
      });

      // Test 1
      const { model: model1, cleanup: cleanup1 } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      const element1 = await addTestElement(model1, "api", "endpoint", "api.endpoint.test-1", {
        name: "Test Endpoint 1",
      });

      expect(element1).toBeDefined();
      await cleanup1();

      // Test 2
      const { model: model2, cleanup: cleanup2 } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      const element2 = await addTestElement(model2, "api", "endpoint", "api.endpoint.test-2", {
        name: "Test Endpoint 2",
      });

      expect(element2).toBeDefined();
      await cleanup2();

      // Verify stats
      const stats = getGoldenCopyStats();
      expect(stats.cloneCount).toBe(2);

      // Suite cleanup
      await cleanupGoldenCopy();
    });

    it("should mix golden copy and fresh models", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      // Use golden copy
      const {
        model: model1,
        fromGoldenCopy: isGolden1,
        cleanup: cleanup1,
      } = await createTestModelWithGoldenCopy({
        useGoldenCopy: true,
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      expect(isGolden1).toBe(true);
      await cleanup1();

      // Use fresh model
      const {
        model: model2,
        fromGoldenCopy: isGolden2,
        cleanup: cleanup2,
      } = await createTestModelWithGoldenCopy({
        useGoldenCopy: false,
      });

      expect(isGolden2).toBe(false);
      await cleanup2();

      await cleanupGoldenCopy();
    });

    it("should support batch test execution", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
        warmup: true,
      });

      const testCount = 5;
      const cleans: Array<() => Promise<void>> = [];

      // Create multiple models
      for (let i = 0; i < testCount; i++) {
        const { cleanup } = await createTestModelWithGoldenCopy({
          goldenCopyConfig: { cacheDir: testCacheDir },
        });
        cleans.push(cleanup);
      }

      const stats = getGoldenCopyStats();
      expect(stats.cloneCount).toBe(testCount);

      // Clean up all
      for (const cleanup of cleans) {
        await cleanup();
      }

      await cleanupGoldenCopy();
    });
  });

  describe("Error Handling and Resilience", () => {
    it("should handle missing golden copy gracefully", async () => {
      // Don't initialize, try to use it
      const { model, fromGoldenCopy, cleanup } = await createTestModelWithGoldenCopy({
        useGoldenCopy: true,
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      // Should still create a model (fallback)
      expect(model).toBeDefined();
      expect(typeof fromGoldenCopy).toBe("boolean");

      await cleanup();
    });

    it("should not throw on cleanup errors", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      const { cleanup } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      // Call cleanup multiple times - should not throw
      await cleanup();
      expect(async () => {
        await cleanup();
      }).not.toThrow();

      await cleanupGoldenCopy();
    });
  });

  describe("Model State Independence", () => {
    it("should provide independent model instances", async () => {
      await initializeGoldenCopy({
        cacheDir: testCacheDir,
      });

      const { model: model1, cleanup: cleanup1 } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      const { model: model2, cleanup: cleanup2 } = await createTestModelWithGoldenCopy({
        goldenCopyConfig: { cacheDir: testCacheDir },
      });

      // Models should be different instances
      expect(model1).not.toBe(model2);
      expect(model1.rootPath).not.toBe(model2.rootPath);

      // Changes to one shouldn't affect the other
      await addTestElement(model1, "api", "endpoint", "api.endpoint.unique-1", {
        name: "Unique Endpoint 1",
      });

      // model2 shouldn't have this element
      const found = model2.getElementById("api.endpoint.unique-1");
      expect(found).toBeUndefined();

      await cleanup1();
      await cleanup2();
      await cleanupGoldenCopy();
    });
  });
});
