/**
 * createTestWorkdir(), the set-up that fifty test files run before every test (#1244).
 *
 * It used to run a machine-wide `sync` and then poll for the copy to "become ready". On a busy
 * machine the `sync` alone took seconds, and a set-up that ran past the suite's 30 second hook
 * timeout failed whichever test it was setting up, with nothing saying what it had been doing.
 *
 * Every test is `it.serial`: they share the helper's one golden copy and the environment, so
 * they must not overlap when the file is run under `--concurrent` (as `npm run test:all` does).
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { access, cp, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Model } from "../../src/core/model.js";
import {
  DEFAULT_SETUP_BUDGET_MS,
  SETUP_BUDGET_ENV,
  cleanupGoldenCopy,
  createTestWorkdir,
  getGoldenCopyPath,
  initGoldenCopy,
  setupBudgetMs,
} from "../helpers/golden-copy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_SOURCE = resolve(HERE, "../helpers/golden-copy.ts");
const BASELINE = resolve(HERE, "../../../cli-validation/test-project/baseline");

/** A file of the baseline that the readiness check does not look for by name */
const ORDINARY_FILE = join("documentation-robotics", "model", "relationships.yaml");

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  );

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1;
  }
  return count;
}

/** The folder a failed set-up names in its error */
const folderIn = (error: Error) =>
  /Failed to create test workdir at (\S+):/.exec(error.message)![1];

const failure = async (attempt: Promise<unknown>): Promise<Error> => {
  try {
    await attempt;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the set-up to fail");
};

describe("createTestWorkdir (#1244)", () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it.serial(
    "gives a test a whole copy of the baseline model and removes it on cleanup",
    async () => {
      const workdir = await createTestWorkdir();

      const model = await Model.load(workdir.path);
      expect(model.manifest.name).toBeTruthy();
      expect(await countFiles(workdir.path)).toBe(await countFiles(getGoldenCopyPath()!));

      await workdir.cleanup();
      expect(await exists(workdir.path)).toBe(false);
    }
  );

  it.serial("does not start a machine-wide sync, or any other process", async () => {
    const source = await readFile(HELPER_SOURCE, "utf-8");

    expect(source).not.toContain("child_process");
    expect(source).not.toContain("spawnSync");
  });

  it.serial("stops below the suite's 30 second hook timeout unless told otherwise", () => {
    const configured = process.env[SETUP_BUDGET_ENV];
    try {
      delete process.env[SETUP_BUDGET_ENV];
      expect(DEFAULT_SETUP_BUDGET_MS).toBeLessThan(30000);
      expect(setupBudgetMs()).toBe(DEFAULT_SETUP_BUDGET_MS);

      process.env[SETUP_BUDGET_ENV] = "45000";
      expect(setupBudgetMs()).toBe(45000);

      process.env[SETUP_BUDGET_ENV] = "not a number";
      expect(setupBudgetMs()).toBe(DEFAULT_SETUP_BUDGET_MS);
    } finally {
      if (configured === undefined) delete process.env[SETUP_BUDGET_ENV];
      else process.env[SETUP_BUDGET_ENV] = configured;
    }
  });

  it.serial("takes its budget from the environment", async () => {
    const configured = process.env[SETUP_BUDGET_ENV];
    process.env[SETUP_BUDGET_ENV] = "200";
    try {
      const error = await failure(createTestWorkdir({ copy: () => new Promise<void>(() => {}) }));

      expect(error.message).toMatch(/stalled in the copy step: .*\(0\.2s allowed/);
    } finally {
      if (configured === undefined) delete process.env[SETUP_BUDGET_ENV];
      else process.env[SETUP_BUDGET_ENV] = configured;
    }
  });

  it.serial("names the step that stalled and how long it took", async () => {
    const started = performance.now();

    const error = await failure(
      createTestWorkdir({
        budgetMs: 300,
        copy: () => new Promise<void>(() => {}),
      })
    );

    expect(error.message).toMatch(
      /stalled in the copy step: no result after \d+\.\ds \(0\.3s allowed for the whole set-up; golden copy \d+\.\ds, copy \d+\.\ds\)/
    );
    // It gave up at the budget instead of retrying past it, and left no folder behind
    expect(performance.now() - started).toBeLessThan(5000);
    expect(await exists(folderIn(error))).toBe(false);
  });

  it.serial("leaves no folder behind when the copy it gave up on finishes later", async () => {
    let copyFinished = false;

    const error = await failure(
      createTestWorkdir({
        budgetMs: 100,
        copy: async (from, to) => {
          await sleep(400);
          await cp(from, to, { recursive: true });
          copyFinished = true;
        },
      })
    );
    expect(error.message).toContain("stalled in the copy step");

    // The abandoned copy goes on to fill the folder; the set-up removes it again afterwards
    const folder = folderIn(error);
    for (
      let waited = 0;
      waited < 5000 && !(copyFinished && !(await exists(folder)));
      waited += 20
    ) {
      await sleep(20);
    }
    expect(copyFinished).toBe(true);
    expect(await exists(folder)).toBe(false);
  });

  it.serial("names the step that failed, after retrying it", async () => {
    let attempts = 0;

    const error = await failure(
      createTestWorkdir({
        copy: async () => {
          attempts++;
          throw new Error("ENOSPC: no space left on device");
        },
      })
    );

    expect(attempts).toBe(3);
    expect(error.message).toMatch(
      /the copy step failed after \d+\.\ds: ENOSPC: no space left on device/
    );
    expect(await exists(folderIn(error))).toBe(false);
  });

  it.serial("catches a copy that resolved without the model", async () => {
    const error = await failure(
      createTestWorkdir({
        copy: async (_from, to) => {
          await mkdir(join(to, "documentation-robotics", "model", "01_motivation"), {
            recursive: true,
          });
        },
      })
    );

    expect(error.message).toMatch(/the readiness check step failed after \d+\.\ds: /);
    expect(error.message).toContain("is missing manifest.yaml, 02_business");
  });

  it.serial("catches a copy that is one file short, and tries again", async () => {
    let attempts = 0;

    const workdir = await createTestWorkdir({
      copy: async (from, to) => {
        await cp(from, to, { recursive: true });
        // What a copy looks like when its source was being removed under it
        if (++attempts === 1) await unlink(join(to, ORDINARY_FILE));
      },
    });
    cleanups.push(workdir.cleanup);

    expect(attempts).toBe(2);
    expect(await exists(join(workdir.path, ORDINARY_FILE))).toBe(true);
  });

  it.serial("says how short a copy is when every attempt is short", async () => {
    const error = await failure(
      createTestWorkdir({
        copy: async (from, to) => {
          await cp(from, to, { recursive: true });
          await unlink(join(to, ORDINARY_FILE));
        },
      })
    );

    expect(error.message).toMatch(
      /the readiness check step failed after \d+\.\ds: .* has (\d+) of the golden copy's (\d+) files and folders/
    );
    const [, got, wanted] = /has (\d+) of the golden copy's (\d+)/.exec(error.message)!;
    expect(Number(wanted) - Number(got)).toBe(1);
  });

  // Callers that overlap at first use (test files under --concurrent) used to be handed the
  // golden copy's folder while the baseline was still being copied into it, and copied what was
  // there so far. The folder is now announced only when it is whole.
  it.serial("does not announce the golden copy before it is whole", async () => {
    await cleanupGoldenCopy();
    const baselineFiles = await countFiles(BASELINE);

    const initializing = initGoldenCopy();
    let announced: string | null = null;
    let filesWhenAnnounced = -1;
    while (announced === null) {
      announced = getGoldenCopyPath();
      if (announced !== null) filesWhenAnnounced = await countFiles(announced);
      else await new Promise((resolvePromise) => setImmediate(resolvePromise));
    }

    expect(filesWhenAnnounced).toBe(baselineFiles);
    expect(await initializing).toBe(announced);
  });

  it.serial("gives callers that overlap at first use whole folders", async () => {
    const baselineFiles = await countFiles(BASELINE);

    for (let round = 0; round < 5; round++) {
      await cleanupGoldenCopy();
      const files = await Promise.all(
        Array.from({ length: 8 }, async (_, caller) => {
          await sleep(caller * 0.4);
          const workdir = await createTestWorkdir();
          cleanups.push(workdir.cleanup);
          return countFiles(workdir.path);
        })
      );
      expect(files).toEqual(Array(8).fill(baselineFiles));
    }
  });

  it.serial(
    "gives whole folders when the golden copy is cleaned up while copies are running",
    async () => {
      const baselineFiles = await countFiles(BASELINE);

      for (let round = 0; round < 5; round++) {
        const files = await Promise.all(
          Array.from({ length: 8 }, async (_, caller) => {
            await sleep(caller * 0.4);
            if (caller === 4) void cleanupGoldenCopy();
            const workdir = await createTestWorkdir();
            cleanups.push(workdir.cleanup);
            return countFiles(workdir.path);
          })
        );
        expect(files).toEqual(Array(8).fill(baselineFiles));
      }
    }
  );

  it.serial("recovers when the first copy fails", async () => {
    let attempts = 0;

    const workdir = await createTestWorkdir({
      copy: async (from, to) => {
        if (++attempts === 1) throw new Error("EMFILE: too many open files");
        await cp(from, to, { recursive: true });
      },
    });
    cleanups.push(workdir.cleanup);

    expect(attempts).toBe(2);
    await Model.load(workdir.path);
  });

  it.serial("makes a new golden copy when another test file cleaned it up", async () => {
    const before = await createTestWorkdir();
    cleanups.push(before.cleanup);
    const firstGolden = getGoldenCopyPath();

    await cleanupGoldenCopy();
    const after = await createTestWorkdir();
    cleanups.push(after.cleanup);

    expect(getGoldenCopyPath()).not.toBe(firstGolden);
    await Model.load(after.path);
  });

  // The `sync` was added in February 2026 as "a workaround for concurrent test execution race
  // conditions": files of a fresh copy that were supposedly not there yet when the test read
  // them. Here is that situation without the workaround: many folders copied at once, each read
  // the moment its set-up returns.
  it.serial("hands back folders that are whole the moment it returns, many at once", async () => {
    const first = await createTestWorkdir();
    cleanups.push(first.cleanup);
    const expected = await countFiles(first.path);

    const workdirs = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const workdir = await createTestWorkdir();
        cleanups.push(workdir.cleanup);
        const files = await countFiles(workdir.path);
        const model = await Model.load(workdir.path);
        return { files, layers: model.getLayerNames().length };
      })
    );

    for (const workdir of workdirs) {
      expect(workdir.files).toBe(expected);
      expect(workdir.layers).toBeGreaterThan(0);
    }
  });

  it.serial("can clean up twice without reporting an error", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const workdir = await createTestWorkdir();
      await workdir.cleanup();
      // Removing a folder that is already gone is not an error
      await workdir.cleanup();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
