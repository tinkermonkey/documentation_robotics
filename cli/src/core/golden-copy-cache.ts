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
 *   <cacheDir>/<key>/<build>/golden-model/   the model that clones are copied from
 *   <cacheDir>/<key>/<build>/files.json      the files the model was built with
 *
 * - <key> names what the model depends on (CLI version, bundled spec version, model options,
 *   warm-up, and the source of the code that writes the model), so a checkout never loads a
 *   model that another version of the code built.
 * - A build is made under a temporary name and renamed to a name of its own, which nothing else
 *   ever has. So a build is whole from the moment it exists, a run that is killed while building
 *   leaves nothing under <key>, and runs building at once cannot touch each other's work.
 * - A build never changes after that, except by losing files: the operating system's temp
 *   cleaner removes old files and keeps their folders. A build that has lost files is therefore
 *   never coming back, and removing it is safe whoever does it and whenever. A build that is
 *   whole is never moved or removed by another process. No lock is needed.
 * - A process uses the oldest whole build under its key, and makes one when there is none.
 * - A key's folder is never removed once made, even when empty: a process on that key may be
 *   between making the folder and renaming its build into it.
 */

import { Model } from "./model.js";
import { Layer } from "./layer.js";
import { Element } from "./element.js";
import {
  mkdir,
  cp,
  rm,
  access,
  rename,
  readdir,
  readFile,
  writeFile,
  stat,
} from "fs/promises";
import { readFileSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { getErrorMessage } from "../utils/errors.js";
import { getCliVersion, getCliBundledSpecVersion } from "../utils/spec-version.js";

/** Folder inside a build that holds the model. */
const GOLDEN_MODEL_DIR = "golden-model";

/** File inside a build that lists the model's files, relative to the model folder. */
const FILE_LIST = "files.json";

/**
 * Bumped when the layout of the cache changes, so older layouts are not read as this one.
 *
 * A new layout must also change how key folders are named (KEY_NAME below), not only this
 * number. The sweep judges every folder that matches KEY_NAME by this layout's `files.json`,
 * whatever key it is, so code on this layout would take a later layout's builds under
 * same-shaped names for builds that have lost their files, and remove them.
 */
const CACHE_LAYOUT = 2;

/** Infix of the temporary folders a build is made in. */
const TEMP_INFIX = ".tmp-";

/** A key folder: cli<version>-spec<version>-<hash>. Nothing else in the cache directory is touched. */
const KEY_NAME = /^cli.+-spec.+-[0-9a-f]{12}$/;

/** A build folder: <time in ms>-<random>, so the oldest sorts first. */
const BUILD_NAME = /^\d{13}-[0-9a-f]{8}$/;

/**
 * Environment variable: age in milliseconds after which a temporary build folder is taken to
 * belong to a run that was killed, and is removed at the next build.
 */
const STALE_TEMP_ENV = "DR_GOLDEN_COPY_STALE_TEMP_MS";

/** Default for STALE_TEMP_ENV: one hour. A build takes tens of milliseconds. */
const DEFAULT_STALE_TEMP_MS = 60 * 60 * 1000;

function staleTempMs(): number {
  const value = Number(process.env[STALE_TEMP_ENV]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALE_TEMP_MS;
}

/** The modules that write a model to disk. Their source is part of the cache key. */
const BUILDER_MODULES = [
  "golden-copy-cache",
  "model",
  "manifest",
  "layer",
  "layers",
  "element",
  "relationships",
];

let builderFingerprintCache: string | undefined;

/**
 * A hash of the source of the modules that write the golden model, as this process runs them
 * (`.ts` under Bun, `.js` from `dist`). With it in the key, a change to what `Model.init` or the
 * warm-up writes gets a new cache entry even while the CLI and spec versions stay the same.
 * It covers the listed modules, not everything they import.
 */
function builderFingerprint(): string {
  if (builderFingerprintCache === undefined) {
    const here = dirname(fileURLToPath(import.meta.url));
    const hash = createHash("sha256");
    for (const name of BUILDER_MODULES) {
      for (const extension of [".js", ".ts"]) {
        try {
          hash.update(readFileSync(join(here, name + extension)));
          break;
        } catch {
          // The other extension, or (in a bundle) no separate file: the versions still apply.
        }
      }
    }
    builderFingerprintCache = hash.digest("hex");
  }
  return builderFingerprintCache;
}

/** What looking at one build on disk found. */
type BuildState =
  | { status: "usable"; model: Model }
  | {
      status: "damaged";
      reason: string;
      /** Files it was built with are gone. It cannot become whole again, so it can be removed. */
      hollow: boolean;
    };

/** What looking at a key's builds found: the one to use, and the damaged ones passed over. */
interface KeyState {
  usable?: { model: Model; buildDir: string };
  damaged: { buildDir: string; reason: string; hollow: boolean }[];
}

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

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
  /**
   * Layout of the cache this code reads and writes. tests/setup.ts loads this class from `dist`
   * and compares, so a `dist` built before a layout change is reported instead of used.
   */
  static readonly cacheLayout: number = CACHE_LAYOUT;

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

      const keyDir = join(this.config.cacheDir, this.cacheKey());
      let found = await this.readKey(keyDir);

      if (!found.usable) {
        if (found.damaged.length > 0) {
          // The one line a rebuild prints. A first build prints nothing.
          console.warn(
            `[GoldenCopy] Rebuilding the golden copy cache at ${keyDir}: ${found.damaged[0].reason}.`
          );
        }
        found = await this.build(keyDir);
      }
      if (!found.usable) {
        throw new Error(
          `no usable golden copy under ${keyDir} after building one` +
            (found.damaged.length > 0 ? ` (${found.damaged[0].reason})` : "")
        );
      }

      this.goldenModel = found.usable.model;
      this.goldenRootPath = join(found.usable.buildDir, GOLDEN_MODEL_DIR);

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
   * Name of this configuration's folder in the cache directory.
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
          builder: builderFingerprint(),
          modelOptions: this.config.modelOptions,
          warmup: this.config.warmup,
        })
      )
      .digest("hex")
      .slice(0, 12);
    return `cli${cliVersion}-spec${specVersion}-${hash}`;
  }

  /**
   * Check a build's files against the list it was built with, without loading its model.
   *
   * @returns null when every file is there, otherwise why not and whether files are gone
   * @private
   */
  private async checkFiles(buildDir: string): Promise<{ reason: string; hollow: boolean } | null> {
    let files: unknown;
    try {
      files = (
        JSON.parse(await readFile(join(buildDir, FILE_LIST), "utf-8")) as { files?: unknown }
      ).files;
    } catch (error) {
      if (isMissing(error)) {
        return { reason: `${FILE_LIST} is missing`, hollow: true };
      }
      // Invalid JSON never happens to a build that was renamed into place whole, and does not
      // mend. Any other error (too many open files, say) may pass, so the build is left alone.
      return {
        reason: `${FILE_LIST} cannot be read (${getErrorMessage(error)})`,
        hollow: error instanceof SyntaxError,
      };
    }
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      return { reason: `${FILE_LIST} is not a list of files`, hollow: true };
    }

    const gone: string[] = [];
    for (const file of files as string[]) {
      try {
        await access(join(buildDir, GOLDEN_MODEL_DIR, file));
      } catch (error) {
        if (!isMissing(error)) {
          return { reason: `${file} cannot be read (${getErrorMessage(error)})`, hollow: false };
        }
        gone.push(file);
      }
    }
    if (gone.length > 0) {
      return {
        reason: `${gone.length} of its ${files.length} files are missing (${gone[0]}${gone.length > 1 ? ", ..." : ""})`,
        hollow: true,
      };
    }
    return null;
  }

  /**
   * Look at one build: usable (and loaded), or damaged with the reason.
   *
   * A build is usable when every file it was built with is still there and the model loads.
   * @private
   */
  private async readBuild(buildDir: string): Promise<BuildState> {
    const filesProblem = await this.checkFiles(buildDir);
    if (filesProblem) {
      return { status: "damaged", ...filesProblem };
    }

    try {
      // A warmed-up model is read with its layers, as it was when the process that built it kept
      // the model it had just populated. The model is the same whoever built it.
      const model = await Model.load(join(buildDir, GOLDEN_MODEL_DIR), {
        lazyLoad: !(this.config.eagerLoad || this.config.warmup),
      });
      return { status: "usable", model };
    } catch (error) {
      // Its files are all there, so this is not the temp cleaner. Passed over, not removed.
      return {
        status: "damaged",
        reason: `its model does not load (${getErrorMessage(error)})`,
        hollow: false,
      };
    }
  }

  /**
   * Look at a key's builds, oldest first, and stop at the first usable one. Every process
   * that sees the same builds therefore picks the same one.
   * @private
   */
  private async readKey(keyDir: string): Promise<KeyState> {
    const state: KeyState = { damaged: [] };

    let names: string[];
    try {
      names = await readdir(keyDir);
    } catch {
      return state; // No folder for this key yet
    }

    for (const name of names.filter((n) => BUILD_NAME.test(n)).sort()) {
      const buildDir = join(keyDir, name);
      const build = await this.readBuild(buildDir);
      if (build.status === "usable") {
        state.usable = { model: build.model, buildDir };
        return state;
      }
      state.damaged.push({ buildDir, reason: build.reason, hollow: build.hollow });
    }
    return state;
  }

  /**
   * Make a build under a temporary name, rename it to a name of its own under the key, and
   * return what the key holds then.
   *
   * The rename is the only step that touches the key's folder, and its target is a new name, so
   * there is never anything to replace or move aside. A run killed before the rename leaves the
   * key as it was. Runs building at once each add a whole build, and the oldest is used.
   * @private
   */
  private async build(keyDir: string): Promise<KeyState> {
    const staging = `${keyDir}${TEMP_INFIX}build-${process.pid}-${randomUUID().slice(0, 8)}`;

    try {
      const stagedRoot = join(staging, GOLDEN_MODEL_DIR);
      const staged = await Model.init(
        stagedRoot,
        {
          name: this.config.modelOptions.name || "Golden Copy Test Model",
          version: this.config.modelOptions.version || "0.1.0",
          specVersion: this.config.modelOptions.specVersion || getCliBundledSpecVersion(),
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

      // Nothing removes a key's folder, so it is still there for the rename
      await mkdir(keyDir, { recursive: true });
      await rename(staging, join(keyDir, `${Date.now()}-${randomUUID().slice(0, 8)}`));
    } finally {
      // Gone already when the rename worked.
      await rm(staging, { recursive: true, force: true });
    }

    await this.sweep();
    return this.readKey(keyDir);
  }

  /**
   * Remove what is of no use to anyone in the cache directory: builds that have lost files
   * (under any key) and temporary folders that killed runs left.
   *
   * Key folders stay, empty or not. Removing an empty one took it from under a process on that
   * key that had just made it and was about to rename its build in; that rename then failed.
   *
   * Whole builds are never touched, whatever their key: another checkout may be using them.
   * Names that are not this cache's (an older layout's `golden-model`, say) are left alone.
   * Best effort: a failure here never fails a build.
   * @private
   */
  private async sweep(): Promise<void> {
    try {
      for (const name of await readdir(this.config.cacheDir)) {
        const path = join(this.config.cacheDir, name);
        try {
          if (name.includes(TEMP_INFIX)) {
            if (Date.now() - (await stat(path)).mtimeMs > staleTempMs()) {
              await rm(path, { recursive: true, force: true });
            }
          } else if (KEY_NAME.test(name)) {
            for (const build of await readdir(path)) {
              if (!BUILD_NAME.test(build)) continue;
              const buildDir = join(path, build);
              if ((await this.checkFiles(buildDir))?.hollow) {
                await rm(buildDir, { recursive: true, force: true });
              }
            }
          }
        } catch {
          // Another run got there first.
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
   * process on the machine, and one of them removing a build would pull it out from under the
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
        // The whole build: the model and its file list. The key's folder stays.
        await rm(dirname(this.goldenRootPath), { recursive: true, force: true });
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
