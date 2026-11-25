/**
 * Parallel Test Execution Setup
 *
 * This file is preloaded by Bun before running tests in parallel.
 * It initializes shared resources, configures isolation, and sets up
 * metrics collection for test execution analysis.
 *
 * Golden Copy Systems (Two separate optimization paths):
 *
 * 1. GoldenCopyCacheManager (initialized here):
 *    - Caches Model instances for tests that need programmatic Model access
 *    - Used by createTestModelWithGoldenCopy() in golden-copy-helper.ts
 *    - Creates fresh models with optional warmup data
 *
 * 2. Filesystem Golden Copy (golden-copy.ts):
 *    - Copies the baseline directory structure for CLI/integration tests
 *    - Used by createTestWorkdir() which clones from baseline
 *    - Tests that need the actual baseline directory use this approach
 *
 * These are complementary systems serving different test requirements.
 */

import { randomUUID } from "crypto";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { jest } from "bun:test";
import { GoldenCopyCacheManager } from "../dist/core/golden-copy-cache.js";

// Best-effort default per-test timeout for ad-hoc `bun test <file>` runs
// invoked directly (outside the npm scripts below). Bun's own default is
// 5000ms, which is too tight for integration tests that shell out to real
// analyzer binaries (see #802). bunfig.toml's `[test]` section has no
// timeout/timeoutMs key - it was never a real Bun config option, so a
// previous `timeoutMs = 30000` entry there silently did nothing.
//
// NOT authoritative: verified this doesn't reliably propagate to Bun's
// parallel test workers (bunfig.toml's `workers = 4`) - under real
// multi-file concurrent runs it intermittently has no effect at all, which
// is worse than useless since it looks configured but isn't. The real fix
// is the `--timeout=30000` flag added directly to every `bun test`
// invocation in package.json's scripts and scripts/run-smoke-tests.sh,
// which is immune to that worker-isolation gap. Keep this call only as a
// convenience for developers running a single file by hand.
jest.setTimeout(30000);

// Global test configuration for parallel execution
declare global {
  var __TEST_ID__: string;
  var __TEST_START_TIME__: number;
  var __GOLDEN_COPY_INITIALIZED__: boolean;
}

// Initialize per-worker test context
globalThis.__TEST_ID__ = randomUUID();
globalThis.__TEST_START_TIME__ = Date.now();

// Initialize golden copy cache flag
globalThis.__GOLDEN_COPY_INITIALIZED__ = false;

// Configure test isolation: each worker gets unique directories
process.env.TEST_WORKER_ID = globalThis.__TEST_ID__;
process.env.TEST_TEMP_DIR = `/tmp/test-${globalThis.__TEST_ID__}`;

// Suppress verbose CLI output in tests
if (!process.env.TEST_VERBOSE) {
  process.env.CLI_QUIET = "true";
}

// Enable test-specific configuration
process.env.NODE_ENV = "test";

// Keep viewer records (written by every `dr visualize` a test starts, and inherited by its
// children) out of the developer's real ~/.local/state/dr/viewers. Tests that need their own
// state dir set DR_STATE_DIR themselves.
process.env.DR_STATE_DIR = join(tmpdir(), `dr-test-state-${globalThis.__TEST_ID__}`);

// Keep every test out of the developer's real user farm (~/.config/dr/farm.yaml), which a test once
// filled with its scratch project (#1438). The user farm of this run, and of every dr process a test
// starts, is a scratch one, and no farm.yaml write in this process or its children may reach the
// real one: FarmManifest.save refuses the files DR_PROTECTED_FARM_FILES names, so a test that
// resolves the farm from an env without XDG_CONFIG_HOME (`env: {}`) fails instead of writing there.
// A DR_FARM_PATH from the developer's shell would point tests at a real farm, so it goes too.
{
  const configHome = process.env.XDG_CONFIG_HOME;
  const realUserFarms = new Set([
    join(configHome && isAbsolute(configHome) ? configHome : join(process.env.HOME || homedir(), ".config"), "dr", "farm.yaml"),
    join(homedir(), ".config", "dr", "farm.yaml"),
  ]);
  process.env.DR_PROTECTED_FARM_FILES = [...realUserFarms].join(delimiter);
  process.env.XDG_CONFIG_HOME = join(tmpdir(), `dr-test-config-${globalThis.__TEST_ID__}`);
  delete process.env.DR_FARM_PATH;
}

// Work around broken .gitconfig directory at system level by pointing git to /dev/null
// This prevents "unable to read configuration files (.gitconfig is a directory)" errors
// See: https://github.com/anthropics/claude-code/issues/425
if (!process.env.GIT_CONFIG_GLOBAL) {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
}

// The cache layout this file expects of the GoldenCopyCacheManager it loads from cli/dist.
// Keep it equal to CACHE_LAYOUT in src/core/golden-copy-cache.ts.
const EXPECTED_CACHE_LAYOUT = 2;

// Initialize the golden copy cache: load this checkout's entry in the shared cache directory, or
// build it (and rebuild it when its files have gone missing - see GoldenCopyCacheManager).
// This runs once per test process.
const initializeGoldenCopy = async () => {
  if (process.env.DISABLE_GOLDEN_COPY === "true") {
    if (process.env.DEBUG_TEST_SETUP) {
      console.log(`[Setup] Golden copy disabled via DISABLE_GOLDEN_COPY environment variable`);
    }
    return;
  }

  // The manager comes from cli/dist. After a pull or a rebase, dist is whatever was built last,
  // and an older manager would build its cache the older way without a word. Say so instead.
  // (npm test, test:integration, test:all and test:smoke check dist before they start; test:unit,
  // test:compatibility and a direct `bun test` do not.)
  const distLayout = (GoldenCopyCacheManager as { cacheLayout?: number }).cacheLayout;
  if (distLayout !== EXPECTED_CACHE_LAYOUT) {
    console.error(
      `[Setup] cli/dist is out of date: its golden copy cache is layout ${distLayout ?? "1 or older"}, ` +
        `and these tests expect layout ${EXPECTED_CACHE_LAYOUT}. Run \`npm run build\` in cli/. ` +
        `The golden copy cache is not used in this run.`
    );
    return;
  }

  try {
    const manager = GoldenCopyCacheManager.getInstance({
      warmup: process.env.GOLDEN_COPY_WARMUP === "true",
      eagerLoad: process.env.GOLDEN_COPY_EAGER === "true",
    });

    const initStart = Date.now();
    await manager.init();
    const initTime = Date.now() - initStart;

    globalThis.__GOLDEN_COPY_INITIALIZED__ = true;

    if (process.env.DEBUG_TEST_SETUP) {
      console.log(`[Setup] Golden copy initialized in ${initTime}ms`);
      console.log(`[Setup] Cache location: ${manager.getCacheDir()}`);
    }
  } catch (error) {
    console.error(
      "[Setup] Failed to initialize golden copy cache:",
      error instanceof Error ? error.message : String(error)
    );
    // Don't fail setup if golden copy fails - tests will fall back to createTestModel
  }
};

// Log test environment setup
if (process.env.DEBUG_TEST_SETUP) {
  console.log(`[Setup] Test worker initialized: ${globalThis.__TEST_ID__}`);
  console.log(`[Setup] Temp directory: ${process.env.TEST_TEMP_DIR}`);
}

// Wait for it, so the cache is whole before the first test runs. It used to run in the
// background, and a test file that finished within a few milliseconds ended the process partway
// through the build: one of the ways the shared cache was left half built (#1220). Loading an
// existing entry takes a few milliseconds and building one a few tens.
//
// The wait is capped, so a stuck filesystem delays a run instead of hanging it: after
// DR_TEST_GOLDEN_COPY_INIT_WAIT_MS milliseconds (default 10000) the tests start without the
// cache, and a line says so.
const GOLDEN_COPY_INIT_WAIT_ENV = "DR_TEST_GOLDEN_COPY_INIT_WAIT_MS";
const DEFAULT_GOLDEN_COPY_INIT_WAIT_MS = 10000;
const configuredInitWait = Number(process.env[GOLDEN_COPY_INIT_WAIT_ENV]);
const goldenCopyInitWaitMs =
  Number.isFinite(configuredInitWait) && configuredInitWait > 0
    ? configuredInitWait
    : DEFAULT_GOLDEN_COPY_INIT_WAIT_MS;

let initWaitTimer: ReturnType<typeof setTimeout> | undefined;
await Promise.race([
  initializeGoldenCopy(),
  new Promise<void>((resolve) => {
    initWaitTimer = setTimeout(() => {
      console.error(
        `[Setup] Golden copy cache not ready after ${goldenCopyInitWaitMs / 1000}s ` +
          `(${GOLDEN_COPY_INIT_WAIT_ENV}); starting the tests without waiting for it`
      );
      resolve();
    }, goldenCopyInitWaitMs);
  }),
]);
clearTimeout(initWaitTimer);

// No cleanup of the cache when the process ends. The cache directory is shared by every test
// process on the machine (other checkouts and worktrees included), so removing the entry here
// would pull it out from under a run that is cloning from it. The entry is small, it is named for
// what it depends on, and it is rebuilt when it goes missing.

export {};
