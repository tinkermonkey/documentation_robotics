/**
 * Unit Tests for Golden Copy Cache Manager
 *
 * Tests the core golden copy caching functionality:
 * - Singleton pattern and initialization
 * - Model cloning and efficiency
 * - Cache lifecycle management
 * - Statistics tracking
 * - Error handling and fallbacks
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GoldenCopyCacheManager, type GoldenCopyCacheConfig } from '../../src/core/golden-copy-cache.js';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('GoldenCopyCacheManager', () => {
  let manager: GoldenCopyCacheManager;
  let testCacheDir: string;

  beforeEach(() => {
    // Reset singleton for each test
    GoldenCopyCacheManager.resetInstance();

    // Use UUID for unique directory per test in concurrent execution
    testCacheDir = join(tmpdir(), `golden-copy-test-${randomUUID()}`);
  });

  afterEach(async () => {
    // Clean up the manager
    if (manager && manager.isInitialized()) {
      await manager.cleanup();
    }

    // Clean up test directory
    try {
      await rm(testCacheDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Reset singleton
    GoldenCopyCacheManager.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const manager1 = GoldenCopyCacheManager.getInstance();
      const manager2 = GoldenCopyCacheManager.getInstance();
      expect(manager1).toBe(manager2);
    });

    it('should create a new instance after reset', () => {
      const manager1 = GoldenCopyCacheManager.getInstance();
      GoldenCopyCacheManager.resetInstance();
      const manager2 = GoldenCopyCacheManager.getInstance();
      expect(manager1).not.toBe(manager2);
    });

    it('should respect custom configuration', () => {
      const config: GoldenCopyCacheConfig = {
        cacheDir: testCacheDir,
        warmup: true,
        eagerLoad: false,
      };

      manager = GoldenCopyCacheManager.getInstance(config);
      expect(manager.getCacheDir()).toBe(testCacheDir);
    });
  });

  describe('Initialization', () => {
    it('should initialize golden copy on first call', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(false);

      await manager.init();

      expect(manager.isInitialized()).toBe(true);
    });

    it('should not reinitialize on subsequent calls', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      await manager.init();
      const stats1 = manager.getStats();
      const initCountAfterFirst = stats1.initCount;

      // Call init again - should be idempotent
      await manager.init();
      const stats2 = manager.getStats();
      const initCountAfterSecond = stats2.initCount;

      // Init count should not increase (idempotent behavior)
      expect(initCountAfterFirst).toBe(initCountAfterSecond);
    });

    it('should have valid manifest after initialization', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      await manager.init();

      const goldenModel = manager.getGoldenModel();
      expect(goldenModel).not.toBeNull();
      expect(goldenModel?.manifest).toBeDefined();
      expect(goldenModel?.manifest.name).toBeDefined();
    });
  });

  describe('Cloning', () => {
    beforeEach(async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });
      await manager.init();
    });

    it('should clone the golden model', async () => {
      const cloned = await manager.clone();

      expect(cloned.model).toBeDefined();
      expect(cloned.rootPath).toBeDefined();
      expect(cloned.cleanup).toBeDefined();
    });

    it('should create independent clones', async () => {
      const clone1 = await manager.clone();
      const clone2 = await manager.clone();

      expect(clone1.model).not.toBe(clone2.model);
      expect(clone1.rootPath).not.toBe(clone2.rootPath);
    });

    it('should populate clone stats', async () => {
      const cloned = await manager.clone();

      expect(cloned.stats).toBeDefined();
      expect(cloned.stats.cloneTime).toBeGreaterThanOrEqual(0);
      expect(cloned.stats.cloneTime).toBeLessThan(5000); // Reasonable upper bound
    });

    it('should fail gracefully if not initialized', async () => {
      GoldenCopyCacheManager.resetInstance();
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.isInitialized()).toBe(false);

      try {
        await manager.clone();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('not initialized');
      }
    });
  });

  describe('Statistics Tracking', () => {
    beforeEach(async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });
      await manager.init();
    });

    it('should track initialization count', async () => {
      const stats1 = manager.getStats();
      expect(stats1.initCount).toBe(1);

      // Calling init again shouldn't increase count (idempotent)
      await manager.init();
      const stats2 = manager.getStats();
      expect(stats2.initCount).toBe(1);
    });

    it('should track clone count', async () => {
      const stats1 = manager.getStats();
      expect(stats1.cloneCount).toBe(0);

      await manager.clone();
      const stats2 = manager.getStats();
      expect(stats2.cloneCount).toBe(1);

      await manager.clone();
      const stats3 = manager.getStats();
      expect(stats3.cloneCount).toBe(2);
    });

    it('should calculate average clone time', async () => {
      await manager.clone();
      await manager.clone();
      await manager.clone();

      const stats = manager.getStats();

      expect(stats.cloneCount).toBe(3);
      expect(stats.totalCloneTime).toBeGreaterThan(0);
      expect(stats.avgCloneTime).toBe(stats.totalCloneTime / stats.cloneCount);
    });

    it('should track total and average initialization time', async () => {
      const stats = manager.getStats();

      expect(stats.initCount).toBe(1);
      expect(stats.totalInitTime).toBeGreaterThanOrEqual(0);
      expect(stats.avgInitTime).toBe(stats.totalInitTime / stats.initCount);
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });
      await manager.init();
    });

    it('should reset state after cleanup', async () => {
      expect(manager.isInitialized()).toBe(true);

      await manager.cleanup();

      expect(manager.isInitialized()).toBe(false);
      expect(manager.getGoldenModel()).toBeNull();
    });

    it('should reset singleton after cleanup', async () => {
      await manager.cleanup();

      GoldenCopyCacheManager.resetInstance();
      const newManager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(newManager.isInitialized()).toBe(false);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Create a clone to ensure there's something to clean
      await manager.clone();

      // Cleanup should complete without throwing
      expect(async () => {
        await manager.cleanup();
      }).not.toThrow();
    });
  });

  describe('Cache Directory Management', () => {
    it('should use custom cache directory', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      expect(manager.getCacheDir()).toBe(testCacheDir);

      await manager.init();
      // Cache directory should exist
    });

    it('should return correct cache directory path', async () => {
      const customPath = join(tmpdir(), 'custom-golden-cache');
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: customPath,
      });

      expect(manager.getCacheDir()).toBe(customPath);
    });
  });

  describe('Error Handling', () => {
    it('should provide meaningful error messages', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      try {
        await manager.clone();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('not initialized');
      }
    });
  });

  describe('Configuration Options', () => {
    it('should respect eagerLoad option', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
        eagerLoad: false, // Load on demand
      });

      await manager.init();
      const model = manager.getGoldenModel();

      expect(model?.lazyLoad).toBe(true); // Opposite of eagerLoad
    });

    it('should respect warmup option', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
        warmup: true, // Populate with sample data
      });

      await manager.init();
      const model = manager.getGoldenModel();

      // Check that some elements exist from warmup
      expect(model?.layers.size).toBeGreaterThan(0);
    });

    it('should use default model options when not provided', async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });

      await manager.init();
      const model = manager.getGoldenModel();

      expect(model?.manifest.name).toContain('Golden');
    });

    it('should use custom model options when provided', async () => {
      const customName = 'My Custom Model';
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
        modelOptions: {
          name: customName,
          version: '1.0.0',
          specVersion: '0.7.1',
        },
      });

      await manager.init();
      const model = manager.getGoldenModel();

      expect(model?.manifest.name).toBe(customName);
      expect(model?.manifest.version).toBe('1.0.0');
    });
  });

  describe('Performance Characteristics', () => {
    beforeEach(async () => {
      manager = GoldenCopyCacheManager.getInstance({
        cacheDir: testCacheDir,
      });
      await manager.init();
    });

    it('should track clone performance', async () => {
      // Create a clone
      const cloned = await manager.clone();

      const cloneStats = manager.getStats();

      // Should have tracked the clone
      expect(cloneStats.cloneCount).toBe(1);
      expect(cloneStats.avgCloneTime).toBeGreaterThan(0);
      expect(cloneStats.totalCloneTime).toBeGreaterThan(0);

      // Clone should have been fairly fast (less than 5 seconds in typical cases)
      expect(cloned.stats.cloneTime).toBeLessThan(5000);

      await cloned.cleanup();
    });

    it('should handle multiple rapid clones', async () => {
      const clones = [];

      // Create multiple clones rapidly
      for (let i = 0; i < 10; i++) {
        const cloned = await manager.clone();
        clones.push(cloned);
      }

      const stats = manager.getStats();
      expect(stats.cloneCount).toBe(10);

      // Clean up all clones
      for (const clone of clones) {
        await clone.cleanup();
      }
    });
  });
});
