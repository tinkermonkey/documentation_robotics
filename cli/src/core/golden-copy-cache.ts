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
 *
 * On disk (the cache directory is shared by every test process on the machine, whatever
 * checkout it runs from):
 *
 *   <cacheDir>/<key>/golden-model/   the model that clones are copied from
 *   <cacheDir>/<key>/files.json      the files the model was built with
 *
 * - <key> names what the model depends on (CLI version, bundled spec version, model options,
 *   warm-up), so checkouts on different versions never load each other's model.
 * - An entry is built under a temporary name and renamed into place, so a run that is killed
 *   while building leaves nothing at <key>, and two runs building at once both end up on
 *   whichever finished first.
 * - An entry whose files are gone is rebuilt. That happens without any run failing: the
 *   operating system's temp cleaner removes old files and keeps their folders.
 */

import { Model } from "./model.js";
import { Layer } from "./layer.js";
import { Element } from "./element.js";
import { mkdir, cp, rm, access, rename, readdir, readFile, writeFile, stat } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { dirname, join, relative } from "path";
import { tmpdir } from "os";
import { getErrorMessage } from "../utils/errors.js";
import { getCliVersion, getCliBundledSpecVersion } from "../utils/spec-version.js";

/** Folder inside a cache entry that holds the model. */
const GOLDEN_MODEL_DIR = "golden-model";

/** File inside a cache entry that lists the model's files, relative to the model folder. */
const FILE_LIST = "files.json";

/** Bumped when the layout of a cache entry changes, so old entries are not read as new ones. */
const CACHE_LAYOUT = 1;

/** Infix of the temporary folders an entry is built in or moved aside to. */
const TEMP_INFIX = ".tmp-";

/** A temporary folder older than this belongs to a run that was killed, and is removed. */
const STALE_TEMP_MS = 60 * 60 * 1000;

/** What looking at a cache entry on disk found. */
type CacheEntryState =
  | { status: "usable"; model: Model }
  | { status: "absent" }
  | { status: "incomplete"; reason: string };

/** Every file under `dir`, as sorted paths relative to it. */
async function listFiles(dir: string, base: string = dir): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, base)));
    } else {
      files.push(relative(base, full));
    }
  }
  return files.sort();
}

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
 * Lifecycle state of the golden copy manager
 */
type ManagerLifecycleState =
  | { status: "uninitialized" }
  | { status: "initializing"; promise: Promise<void> }
  | { status: "initialized"; model: Model; rootPath: string }
  | { status: "cleaned-up" };

/**
 * Golden Copy Cache Manager
 *
 * Manages the lifecycle of a shared golden test model and provides
 * efficient cloning for individual test use.
 */
export class GoldenCopyCacheManager {
  private static instance: GoldenCopyCacheManager | null = null;
  private static lastConfig: GoldenCopyCacheConfig | undefined;
  private goldenModel: Model | null = null;
  private goldenRootPath: string | null = null;
  private config: Required<GoldenCopyCacheConfig>;
  private lifecycleState: ManagerLifecycleState = { status: "uninitialized" };
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
      cacheDir: config.cacheDir || join(tmpdir(), "dr-golden-copy-cache"),
      eagerLoad: config.eagerLoad ?? false,
      warmup: config.warmup ?? false,
      modelOptions: config.modelOptions || {
        name: "Golden Copy Test Model",
        version: "0.1.0",
        specVersion: "0.7.1",
        description: "Shared golden copy for test initialization",
        author: "Test Suite",
      },
    };
  }

  /**
   * Get or create the singleton instance
   *
   * Thread-safe: If multiple threads/workers call getInstance() concurrently
   * with different configs, the first one wins. This is acceptable because
   * getInstance() should be called early in test setup with consistent config.
   *
   * @throws Error if config differs from existing instance and GOLDEN_COPY_STRICT is enabled
   */
  static getInstance(config?: GoldenCopyCacheConfig): GoldenCopyCacheManager {
    if (!GoldenCopyCacheManager.instance) {
      GoldenCopyCacheManager.instance = new GoldenCopyCacheManager(config);
      GoldenCopyCacheManager.lastConfig = config;
    } else if (process.env.GOLDEN_COPY_STRICT === "true") {
      // In strict mode, warn if config differs
      const configStr = JSON.stringify(config || {});
      const lastConfigStr = JSON.stringify(GoldenCopyCacheManager.lastConfig || {});
      if (configStr !== lastConfigStr) {
        console.warn(
          `[GoldenCopy] WARNING: getInstance() called with different config. ` +
            `First config wins. Current: ${configStr}, Last: ${lastConfigStr}`
        );
      }
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
   * Thread-safe: Concurrent calls before initialization completes are handled
   * via initializationPromise lock. Only the first call performs actual work.
   *
   * @returns Promise resolving when golden copy is ready
   */
  async init(): Promise<void> {
    // If already initialized, return early (idempotent)
    if (this.lifecycleState.status === "initialized") {
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log("[GoldenCopy] Already initialized, skipping init");
      }
      return;
    }

    // If initialization is in progress, wait for it to complete
    if (this.lifecycleState.status === "initializing") {
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log("[GoldenCopy] Initialization in progress, waiting...");
      }
      return this.lifecycleState.promise;
    }

    // If cleaned up, cannot reinitialize
    if (this.lifecycleState.status === "cleaned-up") {
      throw new Error("Golden copy manager has been cleaned up. Create a new instance.");
    }

    // Mark initialization as in progress
    const initPromise = this.performInitialization();
    this.lifecycleState = { status: "initializing", promise: initPromise };

    try {
      await initPromise;
    } catch (error) {
      // Reset to uninitialized on failure
      this.lifecycleState = { status: "uninitialized" };
      throw error;
    }
  }

  /**
   * Perform the actual initialization work
   * @private
   */
  private async performInitialization(): Promise<void> {
    const startTime = Date.now();

    try {
      // Create cache directory
      await mkdir(this.config.cacheDir, { recursive: true });

      const entryDir = join(this.config.cacheDir, this.cacheKey());
      const existing = await this.readEntry(entryDir);

      let model: Model;
      if (existing.status === "usable") {
        model = existing.model;
      } else {
        if (existing.status === "incomplete") {
          // The one line a rebuild prints. A first build prints nothing.
          console.warn(
            `[GoldenCopy] Rebuilding the golden copy cache at ${entryDir}: ${existing.reason}.`
          );
        }
        model = await this.buildEntry(entryDir);
      }

      this.goldenModel = model;
      this.goldenRootPath = join(entryDir, GOLDEN_MODEL_DIR);

      this.stats.initCount++;
      this.stats.totalInitTime += Date.now() - startTime;
      this.stats.avgInitTime = this.stats.totalInitTime / this.stats.initCount;

      // Mark as initialized
      this.lifecycleState = {
        status: "initialized",
        model: this.goldenModel,
        rootPath: this.goldenRootPath,
      };

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`[GoldenCopy] Initialized in ${Date.now() - startTime}ms`);
      }
    } catch (error) {
      throw new Error(`Failed to initialize golden copy cache: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Name of this configuration's entry in the cache directory.
   *
   * It covers everything the model on disk depends on, so a process only ever loads a model
   * built the way it would build one itself. `eagerLoad` is left out: it changes how the model
   * is read, not what is written.
   * @private
   */
  private cacheKey(): string {
    const cliVersion = getCliVersion();
    const specVersion = getCliBundledSpecVersion();
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          layout: CACHE_LAYOUT,
          cliVersion,
          specVersion,
          modelOptions: this.config.modelOptions,
          warmup: this.config.warmup,
        })
      )
      .digest("hex")
      .slice(0, 12);
    return `cli${cliVersion}-spec${specVersion}-${hash}`;
  }

  /**
   * Look at a cache entry: usable (and loaded), absent, or incomplete with the reason.
   *
   * An entry is complete when every file it was built with is still there and the model loads.
   * @private
   */
  private async readEntry(entryDir: string): Promise<CacheEntryState> {
    try {
      await access(entryDir);
    } catch {
      return { status: "absent" };
    }

    const goldenPath = join(entryDir, GOLDEN_MODEL_DIR);

    let files: unknown;
    try {
      files = (
        JSON.parse(await readFile(join(entryDir, FILE_LIST), "utf-8")) as {
          files?: unknown;
        }
      ).files;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      return {
        status: "incomplete",
        reason: missing
          ? `${FILE_LIST} is missing`
          : `${FILE_LIST} cannot be read (${getErrorMessage(error)})`,
      };
    }
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      return {
        status: "incomplete",
        reason: `${FILE_LIST} is not a list of files`,
      };
    }

    const gone: string[] = [];
    for (const file of files as string[]) {
      try {
        await access(join(goldenPath, file));
      } catch {
        gone.push(file);
      }
    }
    if (gone.length > 0) {
      return {
        status: "incomplete",
        reason: `${gone.length} of its ${files.length} files are missing (${gone[0]}${gone.length > 1 ? ", ..." : ""})`,
      };
    }

    try {
      // A warmed-up model is read with its layers, as it was when the process that built it kept
      // the model it had just populated. The model is the same whoever built the entry.
      const model = await Model.load(goldenPath, {
        lazyLoad: !(this.config.eagerLoad || this.config.warmup),
      });
      return { status: "usable", model };
    } catch (error) {
      return {
        status: "incomplete",
        reason: `its model does not load (${getErrorMessage(error)})`,
      };
    }
  }

  /**
   * Build a cache entry under a temporary name and rename it into place.
   *
   * The rename is the only step that touches `entryDir`, so a run killed at any earlier point
   * leaves `entryDir` as it was. When something is already there, it is either another run's
   * finished entry (use it and drop ours) or an incomplete one (move it aside and try again).
   * @private
   */
  private async buildEntry(entryDir: string): Promise<Model> {
    await this.removeStaleTempFolders();

    const staging = `${entryDir}${TEMP_INFIX}build-${process.pid}-${randomUUID().slice(0, 8)}`;

    try {
      const stagedRoot = join(staging, GOLDEN_MODEL_DIR);
      const staged = await Model.init(
        stagedRoot,
        {
          name: this.config.modelOptions.name || "Golden Copy Test Model",
          version: this.config.modelOptions.version || "0.1.0",
          specVersion: this.config.modelOptions.specVersion || "0.7.1",
          description:
            this.config.modelOptions.description || "Shared golden copy for test initialization",
          author: this.config.modelOptions.author || "Test Suite",
          created: new Date().toISOString(),
        },
        { lazyLoad: !this.config.eagerLoad }
      );

      // Optional warm-up: populate with sample data
      if (this.config.warmup) {
        await this.populateGoldenCopy(staged);
        await staged.save();
      }

      await writeFile(
        join(staging, FILE_LIST),
        JSON.stringify({ files: await listFiles(stagedRoot) }, null, 2)
      );

      let renameError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await rename(staging, entryDir);
          renameError = undefined;
          break;
        } catch (error) {
          renameError = error;
        }

        const current = await this.readEntry(entryDir);
        if (current.status === "usable") {
          // Another run finished first. Its entry is as good as ours.
          return current.model;
        }
        if (current.status === "incomplete") {
          const aside = `${entryDir}${TEMP_INFIX}incomplete-${process.pid}-${randomUUID().slice(0, 8)}`;
          try {
            await rename(entryDir, aside);
            await rm(aside, { recursive: true, force: true });
          } catch {
            // Another run moved it first. The next attempt finds out what is there now.
          }
        }
      }

      const installed = await this.readEntry(entryDir);
      if (installed.status === "usable") {
        return installed.model;
      }
      throw new Error(
        `could not put a golden copy at ${entryDir} (` +
          (installed.status === "incomplete" ? installed.reason : "nothing is there") +
          (renameError ? `; last rename error: ${getErrorMessage(renameError)}` : "") +
          `)`
      );
    } finally {
      // Gone already when the rename worked.
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Remove temporary folders that killed runs left in the cache directory. Best effort.
   * @private
   */
  private async removeStaleTempFolders(): Promise<void> {
    try {
      for (const name of await readdir(this.config.cacheDir)) {
        if (!name.includes(TEMP_INFIX)) continue;
        const path = join(this.config.cacheDir, name);
        try {
          if (Date.now() - (await stat(path)).mtimeMs > STALE_TEMP_MS) {
            await rm(path, { recursive: true, force: true });
          }
        } catch {
          // Removed by another run in the meantime.
        }
      }
    } catch {
      // Not worth failing a build over.
    }
  }

  /**
   * Clone the golden model for test use
   *
   * Creates an independent copy of the golden model that a test can safely modify
   * without affecting other tests. The clone is isolated in its own temporary directory.
   *
   * Handles filesystem errors:
   * - EEXIST: Retries with new random suffix (collision handling)
   * - ENOSPC: Reports disk full error with guidance
   * - Other: Reports with context
   *
   * Differentiates between copy failures and model load failures in error messages.
   *
   * @returns Promise resolving to the cloned model with cleanup handler
   */
  async clone(): Promise<ClonedModel> {
    if (!this.goldenModel || !this.goldenRootPath) {
      throw new Error("Golden copy cache not initialized. Call init() first.");
    }

    const startTime = Date.now();
    let clonePath: string | null = null;
    let copySuccessful = false;

    try {
      // Generate clone path with retry logic for collisions
      clonePath = await this.generateClonePath();

      // Create a filesystem copy of the golden model
      // This is efficient and provides copy-on-write semantics
      try {
        await cp(this.goldenRootPath, clonePath, { recursive: true });
        copySuccessful = true;
      } catch (copyError) {
        // Distinguish copy errors
        if (copyError instanceof Error && (copyError as NodeJS.ErrnoException).code === "ENOSPC") {
          throw new Error(
            `Disk space exhausted while cloning golden copy. ` +
              `Ensure at least 100MB free space is available. ` +
              `Error: ${copyError.message}`
          );
        }
        throw new Error(
          `Failed to copy golden model to ${clonePath}: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        );
      }

      // Load the cloned model
      let clonedModel: Model;
      try {
        clonedModel = await Model.load(clonePath);
      } catch (loadError) {
        throw new Error(
          `Successfully copied golden model to ${clonePath}, but failed to load cloned model. ` +
            `This suggests corrupted source data. Error: ${loadError instanceof Error ? loadError.message : String(loadError)}`
        );
      }

      const cloneTime = Date.now() - startTime;
      this.stats.cloneCount++;
      this.stats.totalCloneTime += cloneTime;
      this.stats.avgCloneTime = this.stats.totalCloneTime / this.stats.cloneCount;

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`[GoldenCopy] Cloned model in ${cloneTime}ms (clone ${this.stats.cloneCount})`);
      }

      let cleanupCalled = false;

      return {
        model: clonedModel,
        rootPath: clonePath,
        cleanup: async () => {
          if (cleanupCalled) {
            if (process.env.DEBUG_GOLDEN_COPY) {
              console.log(`[GoldenCopy] Cleanup already called for ${clonePath}`);
            }
            return;
          }
          cleanupCalled = true;

          try {
            await rm(clonePath!, { recursive: true, force: true });
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
      // Attempt cleanup only if copy was successful
      if (copySuccessful && clonePath) {
        try {
          await rm(clonePath, { recursive: true, force: true });
        } catch (cleanupError) {
          // Log cleanup failures even in error paths
          console.error(
            `[GoldenCopy] ERROR: Model load failed AND cleanup failed. ` +
              `Orphaned directory may exist at ${clonePath}. ` +
              `Load error: ${getErrorMessage(error)}. ` +
              `Cleanup error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Generate a unique clone path with retry logic for EEXIST collisions
   * @private
   */
  private async generateClonePath(maxRetries: number = 5): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const cloneId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}-attempt${attempt}`;
      const clonePath = join(tmpdir(), `dr-test-clone-${cloneId}`);

      try {
        // Check if path already exists
        await access(clonePath);
        // Path exists, continue to next attempt
      } catch {
        // Path doesn't exist, we can use it
        return clonePath;
      }
    }

    throw new Error(
      `Failed to generate unique clone path after ${maxRetries} attempts. ` +
        `Potential issue with concurrent test execution or stale directories.`
    );
  }

  /**
   * Populate the golden copy with standard test data
   *
   * This is called during warmup to pre-populate the model being built with
   * a canonical set of test elements across layers.
   *
   * @private
   */
  private async populateGoldenCopy(model: Model): Promise<void> {
    const addElement = async (
      layerName: string,
      type: string,
      id: string,
      name: string,
      attributes?: Record<string, unknown>
    ) => {
      let layer = await model.getLayer(layerName);
      if (!layer) {
        layer = new Layer(layerName);
        model.addLayer(layer);
      }

      const element = new Element({
        id,
        type,
        name,
        description: `Golden copy element: ${name}`,
        attributes: attributes || {},
      });

      layer.addElement(element);
    };

    // Motivation layer
    await addElement("motivation", "goal", "motivation.goal.golden-1", "Golden Goal 1");
    await addElement("motivation", "goal", "motivation.goal.golden-2", "Golden Goal 2");
    await addElement(
      "motivation",
      "requirement",
      "motivation.requirement.golden-1",
      "Golden Requirement 1"
    );

    // Business layer
    await addElement("business", "process", "business.process.golden-1", "Golden Process 1");
    await addElement("business", "service", "business.service.golden-1", "Golden Service 1");

    // Application layer
    await addElement(
      "application",
      "component",
      "application.component.golden-1",
      "Golden Component 1"
    );
    await addElement("application", "service", "application.service.golden-1", "Golden Service 1");

    // Technology layer
    await addElement(
      "technology",
      "infrastructure",
      "technology.infrastructure.golden-1",
      "Golden Infrastructure 1"
    );
    await addElement("technology", "platform", "technology.platform.golden-1", "Golden Platform 1");

    // API layer
    await addElement("api", "endpoint", "api.endpoint.golden-1", "Golden Endpoint 1", {
      method: "GET",
      path: "/golden/1",
    });
    await addElement("api", "endpoint", "api.endpoint.golden-2", "Golden Endpoint 2", {
      method: "POST",
      path: "/golden/2",
    });

    // Data Model layer
    await addElement("data-model", "entity", "data-model.entity.golden-1", "Golden Entity 1");
    await addElement("data-model", "entity", "data-model.entity.golden-2", "Golden Entity 2");
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
   * Get the golden model (immutable reference)
   *
   * Returns a frozen reference to prevent accidental mutations that could
   * corrupt the shared golden copy. Direct modifications through the returned
   * object will fail at runtime.
   *
   * @returns Frozen golden model or null if not initialized
   */
  getGoldenModel(): Readonly<Model> | null {
    if (!this.goldenModel) {
      return null;
    }
    // Return frozen reference to prevent mutations
    return Object.freeze(
      Object.create(
        Object.getPrototypeOf(this.goldenModel),
        Object.getOwnPropertyDescriptors(this.goldenModel)
      )
    );
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
   *
   * For a cache directory of your own. The default cache directory is shared by every test
   * process on the machine, and one of them removing the entry would pull it out from under the
   * others: leave it in place there (it is small, and it is rebuilt when it goes missing).
   *
   * Idempotent: Safe to call multiple times without error.
   */
  async cleanup(): Promise<void> {
    // If already cleaned up, this is a no-op
    if (this.lifecycleState.status === "cleaned-up") {
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log("[GoldenCopy] Already cleaned up, skipping");
      }
      return;
    }

    try {
      if (this.goldenRootPath) {
        // The whole entry: the model and its file list.
        await rm(dirname(this.goldenRootPath), {
          recursive: true,
          force: true,
        });
      }
      this.goldenModel = null;
      this.goldenRootPath = null;
      this.lifecycleState = { status: "cleaned-up" };
      GoldenCopyCacheManager.resetInstance();

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log("[GoldenCopy] Cache cleaned up");
        console.log("[GoldenCopy] Stats:", this.stats);
      }
    } catch (error) {
      // Always log cleanup errors
      console.error(
        `[GoldenCopy] ERROR: Failed to clean up golden copy cache at ${this.goldenRootPath}. ` +
          `This may cause disk space issues. ` +
          `Error: ${getErrorMessage(error)}`
      );
    }
  }
}
