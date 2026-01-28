/**
 * Golden Copy Cache Management
 *
 * Provides a shared golden copy of a test model that can be efficiently cloned
 * for use across multiple tests, improving test initialization performance.
 *
 * Key Features:
 * - Single initialization of a canonical test model on first use
 * - Fast cloning via filesystem copy (copy-on-write semantics)
 * - Automatic cache lifecycle management
 * - Optional warm-up for eager element loading
 * - Support for custom golden copy configurations
 */

import { Model } from './model.js';
import { Layer } from './layer.js';
import { Element } from './element.js';
import { mkdir, cp, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Configuration for the golden copy cache
 */
export interface GoldenCopyCacheConfig {
  /** Base directory for golden copy cache (defaults to temp directory) */
  cacheDir?: string;

  /** Whether to eagerly load all layers when creating golden copy */
  eagerLoad?: boolean;

  /** Whether to enable warm-up (populate with sample data) */
  warmup?: boolean;

  /** Custom test model options */
  modelOptions?: {
    name?: string;
    version?: string;
    specVersion?: string;
    description?: string;
    author?: string;
  };
}

/**
 * Statistics for golden copy cache operations
 */
export interface GoldenCopyStats {
  initCount: number;
  cloneCount: number;
  totalInitTime: number;
  totalCloneTime: number;
  avgInitTime: number;
  avgCloneTime: number;
}

/**
 * Result of a golden copy clone operation
 */
export interface ClonedModel {
  model: Model;
  rootPath: string;
  cleanup: () => Promise<void>;
  stats: {
    cloneTime: number;
  };
}

/**
 * Golden Copy Cache Manager
 *
 * Manages the lifecycle of a shared golden test model and provides
 * efficient cloning for individual test use.
 */
export class GoldenCopyCacheManager {
  private static instance: GoldenCopyCacheManager | null = null;
  private goldenModel: Model | null = null;
  private goldenRootPath: string | null = null;
  private config: Required<GoldenCopyCacheConfig>;
  private stats: GoldenCopyStats = {
    initCount: 0,
    cloneCount: 0,
    totalInitTime: 0,
    totalCloneTime: 0,
    avgInitTime: 0,
    avgCloneTime: 0,
  };

  private constructor(config: GoldenCopyCacheConfig = {}) {
    this.config = {
      cacheDir: config.cacheDir || join(tmpdir(), 'dr-golden-copy-cache'),
      eagerLoad: config.eagerLoad ?? false,
      warmup: config.warmup ?? false,
      modelOptions: config.modelOptions || {
        name: 'Golden Copy Test Model',
        version: '0.1.0',
        specVersion: '0.7.1',
        description: 'Shared golden copy for test initialization',
        author: 'Test Suite',
      },
    };
  }

  /**
   * Get or create the singleton instance
   *
   * Thread-safe: If multiple threads/workers call getInstance() concurrently
   * with different configs, the first one wins. This is acceptable because
   * getInstance() should be called early in test setup with consistent config.
   * Use GOLDEN_COPY_STRICT=true in tests to enforce config consistency if needed.
   */
  static getInstance(config?: GoldenCopyCacheConfig): GoldenCopyCacheManager {
    if (!GoldenCopyCacheManager.instance) {
      GoldenCopyCacheManager.instance = new GoldenCopyCacheManager(config);
    }
    return GoldenCopyCacheManager.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    GoldenCopyCacheManager.instance = null;
  }

  /**
   * Initialize the golden copy cache
   *
   * Creates or loads a shared golden model that serves as the basis
   * for all test model clones. This should be called once per test worker.
   * Subsequent calls are idempotent (no-op if already initialized).
   *
   * @returns Promise resolving when golden copy is ready
   */
  async init(): Promise<void> {
    // If already initialized, return early (idempotent)
    if (this.isInitialized()) {
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log('[GoldenCopy] Already initialized, skipping init');
      }
      return;
    }

    const startTime = Date.now();

    try {
      // Create cache directory
      await mkdir(this.config.cacheDir, { recursive: true });

      // Check if golden copy already exists on disk
      const goldenPath = join(this.config.cacheDir, 'golden-model');
      let modelExists = false;

      try {
        await access(goldenPath);
        modelExists = true;
      } catch {
        // Directory doesn't exist, will create new
      }

      if (!modelExists) {
        // Create new golden model
        const created = await Model.init(
          goldenPath,
          {
            name: this.config.modelOptions.name || 'Golden Copy Test Model',
            version: this.config.modelOptions.version || '0.1.0',
            specVersion: this.config.modelOptions.specVersion || '0.7.1',
            description: this.config.modelOptions.description || 'Shared golden copy for test initialization',
            author: this.config.modelOptions.author || 'Test Suite',
            created: new Date().toISOString(),
          },
          { lazyLoad: !this.config.eagerLoad }
        );

        this.goldenModel = created;
        this.goldenRootPath = goldenPath;

        // Optional warm-up: populate with sample data
        if (this.config.warmup) {
          await this.populateGoldenCopy();
          await created.save();
        }
      } else {
        // Load existing golden model
        this.goldenModel = await Model.load(goldenPath, { lazyLoad: !this.config.eagerLoad });
        this.goldenRootPath = goldenPath;
      }

      this.stats.initCount++;
      this.stats.totalInitTime += Date.now() - startTime;
      this.stats.avgInitTime = this.stats.totalInitTime / this.stats.initCount;

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`[GoldenCopy] Initialized in ${Date.now() - startTime}ms`);
      }
    } catch (error) {
      throw new Error(`Failed to initialize golden copy cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Clone the golden model for test use
   *
   * Creates an independent copy of the golden model that a test can safely modify
   * without affecting other tests. The clone is isolated in its own temporary directory.
   *
   * @returns Promise resolving to the cloned model with cleanup handler
   */
  async clone(): Promise<ClonedModel> {
    if (!this.goldenModel || !this.goldenRootPath) {
      throw new Error('Golden copy cache not initialized. Call init() first.');
    }

    const startTime = Date.now();
    const cloneId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const clonePath = join(tmpdir(), `dr-test-clone-${cloneId}`);

    try {
      // Create a filesystem copy of the golden model
      // This is efficient and provides copy-on-write semantics
      await cp(this.goldenRootPath, clonePath, { recursive: true });

      // Load the cloned model
      const clonedModel = await Model.load(clonePath);

      const cloneTime = Date.now() - startTime;
      this.stats.cloneCount++;
      this.stats.totalCloneTime += cloneTime;
      this.stats.avgCloneTime = this.stats.totalCloneTime / this.stats.cloneCount;

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`[GoldenCopy] Cloned model in ${cloneTime}ms (clone ${this.stats.cloneCount})`);
      }

      return {
        model: clonedModel,
        rootPath: clonePath,
        cleanup: async () => {
          try {
            await rm(clonePath, { recursive: true, force: true });
          } catch (e) {
            // Always log cleanup errors - they can cause disk space issues
            console.error(
              `[GoldenCopy] ERROR: Failed to clean up cloned model at ${clonePath}. ` +
              `This may cause disk space issues. ` +
              `Error: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        },
        stats: {
          cloneTime,
        },
      };
    } catch (error) {
      // Ensure cleanup on error
      try {
        await rm(clonePath, { recursive: true, force: true });
      } catch (cleanupError) {
        // Log cleanup failures even in error paths
        console.error(
          `[GoldenCopy] ERROR: Clone failed AND cleanup failed. ` +
          `Orphaned directory may exist at ${clonePath}. ` +
          `Clone error: ${error instanceof Error ? error.message : String(error)}. ` +
          `Cleanup error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
      throw new Error(`Failed to clone golden copy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Populate the golden copy with standard test data
   *
   * This is called during warmup to pre-populate the golden model with
   * a canonical set of test elements across layers.
   *
   * @private
   */
  private async populateGoldenCopy(): Promise<void> {
    if (!this.goldenModel) {
      throw new Error('Golden model not initialized');
    }

    const addElement = async (
      layerName: string,
      type: string,
      id: string,
      name: string,
      properties?: Record<string, unknown>
    ) => {
      let layer = await this.goldenModel!.getLayer(layerName);
      if (!layer) {
        layer = new Layer(layerName);
        this.goldenModel!.addLayer(layer);
      }

      const element = new Element({
        id,
        type,
        name,
        description: `Golden copy element: ${name}`,
        properties: properties || {},
      });

      layer.addElement(element);
    };

    // Motivation layer
    await addElement('motivation', 'goal', 'motivation.goal.golden-1', 'Golden Goal 1');
    await addElement('motivation', 'goal', 'motivation.goal.golden-2', 'Golden Goal 2');
    await addElement('motivation', 'requirement', 'motivation.requirement.golden-1', 'Golden Requirement 1');

    // Business layer
    await addElement('business', 'process', 'business.process.golden-1', 'Golden Process 1');
    await addElement('business', 'service', 'business.service.golden-1', 'Golden Service 1');

    // Application layer
    await addElement('application', 'component', 'application.component.golden-1', 'Golden Component 1');
    await addElement('application', 'service', 'application.service.golden-1', 'Golden Service 1');

    // Technology layer
    await addElement('technology', 'infrastructure', 'technology.infrastructure.golden-1', 'Golden Infrastructure 1');
    await addElement('technology', 'platform', 'technology.platform.golden-1', 'Golden Platform 1');

    // API layer
    await addElement('api', 'endpoint', 'api.endpoint.golden-1', 'Golden Endpoint 1', {
      method: 'GET',
      path: '/golden/1',
    });
    await addElement('api', 'endpoint', 'api.endpoint.golden-2', 'Golden Endpoint 2', {
      method: 'POST',
      path: '/golden/2',
    });

    // Data Model layer
    await addElement('data-model', 'entity', 'data-model.entity.golden-1', 'Golden Entity 1');
    await addElement('data-model', 'entity', 'data-model.entity.golden-2', 'Golden Entity 2');
  }

  /**
   * Get statistics about golden copy cache performance
   */
  getStats(): GoldenCopyStats {
    return { ...this.stats };
  }

  /**
   * Check if golden copy is initialized
   */
  isInitialized(): boolean {
    return this.goldenModel !== null && this.goldenRootPath !== null;
  }

  /**
   * Get the golden model (read-only access)
   *
   * @returns The golden model or null if not initialized
   */
  getGoldenModel(): Model | null {
    return this.goldenModel;
  }

  /**
   * Get the cache directory path
   */
  getCacheDir(): string {
    return this.config.cacheDir;
  }

  /**
   * Clean up the golden copy cache
   *
   * Removes the cached golden model and resets the cache manager.
   * Should be called at the end of test suite execution.
   */
  async cleanup(): Promise<void> {
    try {
      if (this.goldenRootPath) {
        await rm(this.goldenRootPath, { recursive: true, force: true });
      }
      this.goldenModel = null;
      this.goldenRootPath = null;
      GoldenCopyCacheManager.resetInstance();

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log('[GoldenCopy] Cache cleaned up');
        console.log('[GoldenCopy] Stats:', this.stats);
      }
    } catch (error) {
      // Always log cleanup errors
      console.error(
        `[GoldenCopy] ERROR: Failed to clean up golden copy cache at ${this.goldenRootPath}. ` +
        `This may cause disk space issues. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
