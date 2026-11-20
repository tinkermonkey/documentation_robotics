/**
 * Golden Copy Test Helper
 *
 * Provides the core interface for tests to use the shared golden copy cache.
 * This is the spec-aligned implementation that all tests should use.
 *
 * Architecture:
 * - Single golden copy created once per test suite at suite initialization
 * - Stored in a temporary location (`/tmp/dr-golden-*`)
 * - Each test receives a unique working directory cloned from the golden copy
 * - Thread-safe: Multiple test workers can clone from the same golden copy
 * - Cleanup occurs at test suite shutdown via cleanupGoldenCopy()
 */

import { mkdir, cp, rm, access, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { cwd } from "process";

/** A finished golden copy: where it is and how many files and folders it holds. */
interface GoldenCopy {
  path: string;
  entries: number;
}

// Set only once the copy is finished and checked. A caller that arrives while it is being made
// waits on initializationPromise; it must never be handed a folder that is still filling up.
let goldenCopy: GoldenCopy | null = null;
let initializationPromise: Promise<GoldenCopy> | null = null;
// Goes up on every cleanupGoldenCopy(), so a copy that was being made at that moment is not kept.
let goldenCopyGeneration = 0;

/**
 * Timeout for golden copy operations (used in Bun test beforeEach hooks)
 */
export const GOLDEN_COPY_HOOK_TIMEOUT = 30000; // 30 seconds

/**
 * Environment variable: time in milliseconds that one createTestWorkdir() call, or one cleanup,
 * may take.
 */
export const SETUP_BUDGET_ENV = "DR_TEST_SETUP_BUDGET_MS";

/**
 * Default for SETUP_BUDGET_ENV: 20 seconds.
 *
 * It is below the suite's 30 second hook timeout on purpose. When Bun's own timeout fires first
 * it reports "a beforeEach/afterEach hook timed out for this test" against a test that did
 * nothing wrong, and does not say what the hook was doing. Stopping earlier lets the set-up say
 * which step stalled and for how long. Normal set-up takes a few milliseconds. A value at or
 * above the hook timeout hands the reporting back to Bun.
 */
export const DEFAULT_SETUP_BUDGET_MS = 20000;

/** The set-up budget in force: SETUP_BUDGET_ENV when it is a positive number, else the default. */
export function setupBudgetMs(): number {
  const value = Number(process.env[SETUP_BUDGET_ENV]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETUP_BUDGET_MS;
}

/** A set-up that finished, but took longer than this, prints its step timings. */
const SLOW_SETUP_MS = 5000;

/** The steps of a set-up, as error messages and timings name them. */
export type SetupStep = "golden copy" | "copy" | "readiness check";

/**
 * Overrides for the helper's own tests. Test files call createTestWorkdir() with no argument.
 */
export interface CreateTestWorkdirOptions {
  /** Time allowed for the whole set-up (default setupBudgetMs()) */
  budgetMs?: number;
  /** Replaces the copy of the golden copy into the test folder */
  copy?: (from: string, to: string) => Promise<void>;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Runs a set-up's steps against one shared budget and keeps what each one took. */
class SetupClock {
  private readonly started = performance.now();
  private readonly timings: { step: SetupStep; ms: number }[] = [];

  constructor(private readonly budgetMs: number) {}

  /** Time since the set-up started */
  elapsed(): number {
    return performance.now() - this.started;
  }

  /** "golden copy 0.0s, copy 20.0s": every step run so far, in order */
  summary(): string {
    return this.timings.map((t) => `${t.step} ${seconds(t.ms)}`).join(", ");
  }

  /**
   * Run one step. It rejects with a message that names the step and how long it took, whether
   * the step failed or used up what was left of the budget.
   */
  async run<T>(step: SetupStep, work: () => Promise<T>): Promise<T> {
    const stepStarted = performance.now();
    const timing = { step, ms: 0 };
    this.timings.push(timing);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          timing.ms = performance.now() - stepStarted;
          reject(
            new SetupStalledError(
              `stalled in the ${step} step: no result after ${seconds(timing.ms)} ` +
                `(${seconds(this.budgetMs)} allowed for the whole set-up; ${this.summary()})`
            )
          );
        },
        Math.max(0, this.budgetMs - this.elapsed())
      );
    });

    try {
      const result = await Promise.race([work(), stalled]);
      timing.ms = performance.now() - stepStarted;
      return result;
    } catch (error) {
      if (error instanceof SetupStalledError) throw error;
      timing.ms = performance.now() - stepStarted;
      throw new Error(
        `the ${step} step failed after ${seconds(timing.ms)}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A step ran out of budget. Retrying would only run past the hook timeout, so nothing does. */
class SetupStalledError extends Error {}

/**
 * Initialize the shared golden copy of the baseline test project.
 * This is called once per test suite execution.
 * Thread-safe: subsequent calls return the same path.
 *
 * Architecture:
 * - Creates a single copy of the baseline project in a temporary location
 * - All test working directories are subsequently cloned from this golden copy
 * - The golden copy itself is read-only after initialization
 * - Initialized on first call or when accessed via createTestWorkdir()
 *
 * Usage:
 * ```typescript
 * beforeAll(async () => {
 *   const goldenPath = await initGoldenCopy();
 *   console.log(`Golden copy at: ${goldenPath}`);
 * });
 * ```
 *
 * @returns Promise<string> Path to the golden copy directory
 */
export async function initGoldenCopy(): Promise<string> {
  return (await ensureGoldenCopy()).path;
}

/**
 * The golden copy, made on first use. Callers that arrive while it is being made all wait for
 * the same copy to finish.
 * @private
 */
async function ensureGoldenCopy(): Promise<GoldenCopy> {
  // Return the finished copy if there is one
  if (goldenCopy) return goldenCopy;

  // If initialization is in progress, wait for it to complete
  if (initializationPromise) return initializationPromise;

  const generation = goldenCopyGeneration;

  // Create a new initialization promise and cache it to prevent concurrent initialization
  initializationPromise = (async () => {
    // Resolve baseline path - try both possible locations
    let BASELINE = resolve("/workspace", "cli-validation/test-project/baseline");

    // Fallback: try relative to current working directory
    try {
      await access(BASELINE);
    } catch {
      const projectRoot = resolve(cwd(), "..");
      BASELINE = resolve(projectRoot, "cli-validation/test-project/baseline");
    }

    const path = join(
      tmpdir(),
      `dr-golden-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    );

    try {
      await mkdir(path, { recursive: true });
      await cp(BASELINE, path, { recursive: true });

      // The baseline must have arrived whole: every later test folder is a copy of this one
      await checkModelFolder(path);
      const [entries, expected] = await Promise.all([countEntries(path), countEntries(BASELINE)]);
      if (entries !== expected) {
        throw new Error(
          `${path} has ${entries} of the baseline's ${expected} files and folders (${BASELINE})`
        );
      }

      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`Golden copy initialized at: ${path}`);
      }

      const finished = { path, entries };
      // Not kept when cleanupGoldenCopy() ran meanwhile: the next caller makes its own
      if (generation === goldenCopyGeneration) {
        goldenCopy = finished;
      }
      return finished;
    } catch (error) {
      if (generation === goldenCopyGeneration) {
        initializationPromise = null;
      }
      await rm(path, { recursive: true, force: true }).catch(() => {});
      // The failure is not kept. The next caller tries again, so one failed copy of the baseline
      // cannot fail every set-up that comes after it in the process; a cause that lasts fails
      // each of them with its own message.
      throw new Error(
        `Failed to initialize golden copy: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();

  return initializationPromise;
}

/**
 * Create an isolated test working directory from the golden copy.
 * Each test receives a unique directory pre-populated with baseline data.
 *
 * This is the primary function tests use for setup.
 *
 * Architecture:
 * - Ensures golden copy is initialized on first call
 * - Creates a unique temporary directory for each test
 * - Copies entire golden copy to the test directory
 * - Returns cleanup function to remove the test directory
 * - Test directory is independent and can be safely modified
 *
 * Usage:
 * ```typescript
 * let testDir: string;
 * let cleanup: () => Promise<void>;
 *
 * beforeEach(async () => {
 *   const workdir = await createTestWorkdir();
 *   testDir = workdir.path;
 *   cleanup = workdir.cleanup;
 * });
 *
 * afterEach(async () => {
 *   await cleanup();
 * });
 *
 * test("validates model", async () => {
 *   const result = await runDr(['validate'], { cwd: testDir });
 *   expect(result.exitCode).toBe(0);
 * });
 * ```
 *
 * @returns Promise resolving to { path: string, cleanup: () => Promise<void> }
 */
export async function createTestWorkdir(options: CreateTestWorkdirOptions = {}): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const budgetMs = options.budgetMs ?? setupBudgetMs();
  const copy = options.copy ?? ((from: string, to: string) => cp(from, to, { recursive: true }));

  const testId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const testDir = join(tmpdir(), `dr-test-${testId}`);
  const clock = new SetupClock(budgetMs);

  const maxAttempts = 3;
  // The copy in flight, kept so a set-up that gives up on it can clean up after it
  let copying: Promise<void> | null = null;

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        // Inside the loop: when another test file cleaned the golden copy up, this makes a new one
        const golden = await clock.run("golden copy", () => ensureGoldenCopy());

        await clock.run("copy", () => {
          copying = (async () => {
            await mkdir(testDir, { recursive: true });
            await copy(golden.path, testDir);
          })();
          return copying;
        });

        // No flush and no wait between the copy and this check. Once the copy has resolved,
        // every file it wrote is visible to this process and to any `dr` it starts: that is what
        // the filesystem guarantees, and a `sync` adds nothing to it. The check is there for a
        // copy that resolved short, because its source was removed under it: the model's
        // manifest and layer folders by name, then everything else by count.
        await clock.run("readiness check", async () => {
          await checkModelFolder(testDir);
          const entries = await countEntries(testDir);
          if (entries !== golden.entries) {
            throw new Error(
              `${testDir} has ${entries} of the golden copy's ${golden.entries} files and folders`
            );
          }
        });
        break; // Success
      } catch (error) {
        if (error instanceof SetupStalledError || attempt === maxAttempts) {
          throw error;
        }
        // Clean up the partial copy before retrying
        try {
          await rm(testDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors during retry
        }
        await dropGoldenCopyIfDamaged();
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
      }
    }

    if (clock.elapsed() > SLOW_SETUP_MS) {
      console.warn(
        `[GoldenCopy] Slow test workdir set-up: ${seconds(clock.elapsed())} (${clock.summary()})`
      );
    }

    if (process.env.DEBUG_GOLDEN_COPY) {
      console.log(`Test workdir created at: ${testDir}`);
    }

    return {
      path: testDir,
      cleanup: async () => {
        // Bounded like the set-up: a removal that stalls is reported here, by name, instead of
        // as a hook timeout against the test that just passed.
        const started = performance.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            rm(testDir, { recursive: true, force: true }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`no result after ${seconds(budgetMs)}`)),
                budgetMs
              );
            }),
          ]);
          if (process.env.DEBUG_GOLDEN_COPY) {
            console.log(`Test workdir cleaned up: ${testDir}`);
          }
        } catch (error) {
          // Always log cleanup errors - they can cause disk space issues
          console.error(
            `[GoldenCopy] ERROR: Failed to clean up test workdir at ${testDir} ` +
              `(${seconds(performance.now() - started)} in the cleanup step). ` +
              `This may cause disk space issues. ` +
              `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    // Attempt cleanup on error
    try {
      await rm(testDir, { recursive: true, force: true });
      if (error instanceof SetupStalledError && copying) {
        // The copy this set-up gave up on is still running and puts the folder back as it
        // goes. Remove the folder again when the copy has settled.
        void (copying as Promise<void>)
          .catch(() => {})
          .then(() => rm(testDir, { recursive: true, force: true }))
          .catch(() => {});
      }
    } catch (cleanupError) {
      // Log cleanup failures even in error paths
      console.error(
        `[GoldenCopy] ERROR: Test workdir creation failed AND cleanup failed. ` +
          `Orphaned directory may exist at ${testDir}. ` +
          `Creation error: ${error instanceof Error ? error.message : String(error)}. ` +
          `Cleanup error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      );
    }
    throw new Error(
      `Failed to create test workdir at ${testDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Forget the golden copy when it is no longer the folder that was checked: gone, or short of
 * files, because something other than cleanupGoldenCopy() removed them. No copy made from it can
 * be whole however often it is tried, so the next attempt makes a new golden copy instead.
 * @private
 */
async function dropGoldenCopyIfDamaged(): Promise<void> {
  const current = goldenCopy;
  if (!current) return;

  const entries = await countEntries(current.path).catch(() => -1);
  if (entries !== current.entries && goldenCopy === current) {
    goldenCopy = null;
    initializationPromise = null;
    goldenCopyGeneration++;
  }
}

/**
 * Clean up the golden copy at test suite shutdown.
 * Call this in global afterAll hook.
 *
 * Architecture:
 * - Removes the golden copy directory from temporary storage
 * - Resets the initialization state so next test run creates a new golden copy
 * - Safe to call multiple times (idempotent)
 * - Should be called in test runner's global teardown
 *
 * Usage:
 * ```typescript
 * afterAll(async () => {
 *   await cleanupGoldenCopy();
 * });
 * ```
 *
 * @returns Promise<void>
 */
export async function cleanupGoldenCopy(): Promise<void> {
  const finished = goldenCopy;
  // Reset first, so nothing started from here on is handed the folder being removed
  goldenCopy = null;
  initializationPromise = null;
  goldenCopyGeneration++;

  if (finished) {
    try {
      await rm(finished.path, { recursive: true, force: true });
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.log(`Golden copy cleaned up: ${finished.path}`);
      }
    } catch (error) {
      // Always log cleanup errors
      console.error(
        `[GoldenCopy] ERROR: Failed to clean up golden copy at ${finished.path}. ` +
          `This may cause disk space issues. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Get the current golden copy path (for debugging/diagnostics)
 *
 * @returns The golden copy path if initialized, null otherwise
 */
export function getGoldenCopyPath(): string | null {
  return goldenCopy?.path ?? null;
}

/**
 * Check if golden copy is initialized
 *
 * @returns true if golden copy has been initialized
 */
export function isGoldenCopyInitialized(): boolean {
  return goldenCopy !== null;
}

/**
 * Check that a folder holds a whole copy of the model: its manifest and the thirteen layer
 * folders. One pass, no waiting and no retries: a copy that has resolved is either all there or
 * it is not, and a missing file does not turn up later.
 *
 * @param path - Folder to check
 * @private
 */
async function checkModelFolder(path: string): Promise<void> {
  const modelDir = join(path, "documentation-robotics", "model");
  const expected = [
    "manifest.yaml",
    "01_motivation",
    "02_business",
    "03_product",
    "04_security",
    "05_application",
    "06_technology",
    "07_api",
    "08_data-model",
    "09_data-store",
    "10_ux",
    "11_navigation",
    "12_apm",
    "13_testing",
  ];

  const missing: string[] = [];
  for (const name of expected) {
    try {
      await access(join(modelDir, name));
    } catch {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`${modelDir} is missing ${missing.join(", ")}`);
  }
}

/**
 * Count the files and folders under a folder.
 *
 * @param dir - Folder to count
 * @private
 */
async function countEntries(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    count += 1;
    if (entry.isDirectory()) {
      count += await countEntries(join(dir, entry.name));
    }
  }
  return count;
}
