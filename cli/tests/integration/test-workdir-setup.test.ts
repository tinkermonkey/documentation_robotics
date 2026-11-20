/**
 * createTestWorkdir(), the set-up that fifty test files run before every test (#1244).
 *
 * It used to run a machine-wide `sync` and then poll for the copy to "become ready". On a busy
 * machine the `sync` alone took seconds, and a set-up that ran past the suite's 30 second hook
 * timeout failed whichever test it was setting up, with nothing saying what it had been doing.
 */

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { access, cp, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Model } from "../../src/core/model.js";
import {
  SETUP_BUDGET_MS,
  cleanupGoldenCopy,
  createTestWorkdir,
  getGoldenCopyPath,
} from "../helpers/golden-copy.js";

const HELPER_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../helpers/golden-copy.ts");

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

  it("gives a test a whole copy of the baseline model and removes it on cleanup", async () => {
    const workdir = await createTestWorkdir();

    const model = await Model.load(workdir.path);
    expect(model.manifest.name).toBeTruthy();
    expect(await countFiles(workdir.path)).toBe(await countFiles(getGoldenCopyPath()!));

    await workdir.cleanup();
    expect(await exists(workdir.path)).toBe(false);
  });

  it("does not start a machine-wide sync, or any other process", async () => {
    const source = await readFile(HELPER_SOURCE, "utf-8");

    expect(source).not.toContain("child_process");
    expect(source).not.toContain("spawnSync");
  });

  it("stops below the suite's 30 second hook timeout", () => {
    expect(SETUP_BUDGET_MS).toBeLessThan(30000);
  });

  it("names the step that stalled and how long it took", async () => {
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

  it("names the step that failed, after retrying it", async () => {
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

  it("catches a copy that resolved without the model", async () => {
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

  it("recovers when the first copy fails", async () => {
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

  it("makes a new golden copy when another test file cleaned it up", async () => {
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
  it("hands back folders that are whole the moment it returns, many at once", async () => {
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

  it("can clean up twice without reporting an error", async () => {
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
