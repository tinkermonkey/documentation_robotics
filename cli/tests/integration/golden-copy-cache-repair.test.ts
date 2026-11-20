/**
 * The shared golden copy cache survives being left half built (#1220).
 *
 * The cache directory is shared by every test process on the machine. These tests give each case
 * a cache directory of its own and damage it the ways the shared one gets damaged: files removed
 * with their folders kept (the operating system's temp cleaner), a build that never finished (a
 * killed run), and several runs building or repairing at once.
 *
 * On disk: <cacheDir>/<key>/<build>/golden-model/ and <cacheDir>/<key>/<build>/files.json.
 *
 * Every test is `it.serial`: they share the manager's singleton and the console, so they must
 * not overlap when the file is run under `--concurrent` (as `npm run test:all` does).
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoldenCopyCacheManager } from "../../src/core/golden-copy-cache.js";
import { getCliBundledSpecVersion, getCliVersion } from "../../src/utils/spec-version.js";

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANAGER_MODULE = join(CLI_DIR, "src/core/golden-copy-cache.ts");
const MANIFEST = join("documentation-robotics", "model", "manifest.yaml");

/** Every file under a folder, relative to it */
async function filesUnder(dir: string, base: string = dir): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(full, base)));
    else found.push(full.slice(base.length + 1));
  }
  return found.sort();
}

/** Remove every file and keep the folders: what the temp cleaner leaves of an old cache */
async function removeFilesKeepFolders(dir: string): Promise<void> {
  for (const file of await filesUnder(dir)) {
    await unlink(join(dir, file));
  }
}

/** Run a command to the end, with its combined output */
function run(
  command: string,
  args: string[],
  env: Record<string, string | undefined>
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: CLI_DIR, env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

describe("golden copy cache repair (#1220)", () => {
  let cacheDir: string;
  let warn: ReturnType<typeof spyOn>;

  /** A manager as a new test process would get it: nothing in memory, the same folder on disk */
  const freshManager = (config: Record<string, unknown> = {}) => {
    GoldenCopyCacheManager.resetInstance();
    return GoldenCopyCacheManager.getInstance({ cacheDir, ...config });
  };

  /** Names in a cache directory: key folders, and temporary folders of builds in progress */
  const cacheContents = async (dir: string = cacheDir) => {
    const names = (await readdir(dir)).sort();
    return {
      keys: names.filter((name) => !name.includes(".tmp-")),
      temporary: names.filter((name) => name.includes(".tmp-")),
    };
  };

  /** The one key folder of a cache directory that has been used with one configuration */
  const onlyKey = async (dir: string = cacheDir) => {
    const { keys } = await cacheContents(dir);
    expect(keys).toHaveLength(1);
    return join(dir, keys[0]);
  };

  /** The build folders under a key, oldest first */
  const buildsOf = async (keyDir: string) =>
    (await readdir(keyDir)).sort().map((name) => join(keyDir, name));

  /** True when a build still has every file it was built with */
  const isWhole = async (buildDir: string) => {
    const listed = JSON.parse(await readFile(join(buildDir, "files.json"), "utf-8")).files;
    expect(listed).toContain(MANIFEST);
    expect(await filesUnder(join(buildDir, "golden-model"))).toEqual(listed);
    return true;
  };

  const rebuildLines = () =>
    warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("Rebuilding"));

  beforeEach(() => {
    cacheDir = join(tmpdir(), `golden-copy-repair-${randomUUID()}`);
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    GoldenCopyCacheManager.resetInstance();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it.serial("makes a whole build the first time and says nothing", async () => {
    await freshManager().init();

    const builds = await buildsOf(await onlyKey());
    expect(builds).toHaveLength(1);
    expect(await isWhole(builds[0])).toBe(true);
    expect((await cacheContents()).temporary).toEqual([]);
    expect(rebuildLines()).toEqual([]);
  });

  it.serial("loads a whole build without making another", async () => {
    await freshManager().init();
    const builds = await buildsOf(await onlyKey());

    await freshManager().init();

    expect(await buildsOf(await onlyKey())).toEqual(builds);
    expect(rebuildLines()).toEqual([]);
  });

  it.serial("rebuilds when the files are gone, and says so in one line", async () => {
    await freshManager().init();
    const keyDir = await onlyKey();
    const [hollowed] = await buildsOf(keyDir);
    await removeFilesKeepFolders(hollowed);

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain(keyDir);
    expect(rebuildLines()[0]).toContain("files.json is missing");
    expect(rebuildLines()[0]).not.toContain("\n");

    // One whole build under the same key; the hollow one is gone, with nothing left over
    const builds = await buildsOf(await onlyKey());
    expect(builds).toHaveLength(1);
    expect(builds[0]).not.toBe(hollowed);
    expect(await isWhole(builds[0])).toBe(true);
    expect((await cacheContents()).temporary).toEqual([]);

    // And usable
    const clone = await manager.clone();
    expect(clone.model.manifest.name).toBe("Golden Copy Test Model");
    await clone.cleanup();
  });

  it.serial("rebuilds when only the manifest is gone", async () => {
    await freshManager().init();
    const [build] = await buildsOf(await onlyKey());
    await unlink(join(build, "golden-model", MANIFEST));

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain(`files are missing (${MANIFEST})`);
    const clone = await manager.clone();
    await clone.cleanup();
  });

  it.serial("passes over a build whose model does not load, without removing it", async () => {
    await freshManager().init();
    const keyDir = await onlyKey();
    const [broken] = await buildsOf(keyDir);
    await writeFile(join(broken, "golden-model", MANIFEST), "{ this is: not, a manifest");

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain("its model does not load");
    const clone = await manager.clone();
    await clone.cleanup();

    // Its files are all there, so it is not known to be beyond use by others: it stays, and the
    // next run goes straight to the good build without another rebuild
    expect(await buildsOf(keyDir)).toHaveLength(2);
    await freshManager().init();
    expect(await buildsOf(keyDir)).toHaveLength(2);
    expect(rebuildLines()).toHaveLength(1);
  });

  it.serial("is not affected by a build that was killed partway", async () => {
    await freshManager().init();
    const keyDir = await onlyKey();
    await rm(keyDir, { recursive: true });

    // What a killed build leaves: a temporary folder with part of a model, nothing under the key
    const recent = `${keyDir}.tmp-build-99999-recent00`;
    const old = `${keyDir}.tmp-build-99998-old00000`;
    for (const dir of [recent, old]) {
      await mkdir(join(dir, "golden-model/documentation-robotics/model/01_motivation"), {
        recursive: true,
      });
    }
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(old, twoHoursAgo, twoHoursAgo);

    const manager = freshManager();
    await manager.init();

    const clone = await manager.clone();
    await clone.cleanup();
    expect(rebuildLines()).toEqual([]);

    // The old leftover is swept; the recent one may belong to a run that is still building
    expect((await cacheContents()).temporary).toEqual([recent.slice(cacheDir.length + 1)]);
  });

  it.serial(
    "takes the age of a killed build's leftovers from DR_GOLDEN_COPY_STALE_TEMP_MS",
    async () => {
      await freshManager().init();
      const keyDir = await onlyKey();
      await rm(keyDir, { recursive: true });
      const leftover = `${keyDir}.tmp-build-99999-recent00`;
      await mkdir(leftover, { recursive: true });
      const tenSecondsAgo = new Date(Date.now() - 10_000);
      await utimes(leftover, tenSecondsAgo, tenSecondsAgo);

      process.env.DR_GOLDEN_COPY_STALE_TEMP_MS = "5000";
      try {
        await freshManager().init();
      } finally {
        delete process.env.DR_GOLDEN_COPY_STALE_TEMP_MS;
      }

      expect((await cacheContents()).temporary).toEqual([]);
    }
  );

  it.serial("names the key for what the model depends on", async () => {
    await freshManager().init();
    const plain = await onlyKey();
    expect(plain.slice(cacheDir.length + 1)).toMatch(
      new RegExp(
        `^cli${getCliVersion()}-spec${getCliBundledSpecVersion()}-[0-9a-f]{12}$`.replace(
          /\./g,
          "\\."
        )
      )
    );

    await freshManager({ warmup: true }).init();
    await freshManager({ modelOptions: { name: "Another Model", specVersion: "0.1.0" } }).init();
    // eagerLoad changes how the model is read, not what is on disk
    await freshManager({ eagerLoad: true }).init();

    const { keys } = await cacheContents();
    expect(keys).toHaveLength(3);
    expect(keys).toContain(plain.slice(cacheDir.length + 1));
  });

  it.serial("does not load a build made with other options", async () => {
    await freshManager({ modelOptions: { name: "Another Model" } }).init();

    const manager = freshManager();
    await manager.init();

    expect(manager.getGoldenModel()?.manifest.name).toBe("Golden Copy Test Model");
  });

  it.serial(
    "sweeps hollow builds of other keys and keeps whole ones and foreign folders",
    async () => {
      // Two other configurations' entries, one of them hollowed by the temp cleaner
      await freshManager({ modelOptions: { name: "Kept" } }).init();
      const kept = await onlyKey();
      await freshManager({ modelOptions: { name: "Hollowed" } }).init();
      const hollowed = (await cacheContents()).keys
        .map((key) => join(cacheDir, key))
        .find((key) => key !== kept)!;
      await removeFilesKeepFolders(hollowed);
      // The folder an older version of this cache left behind, and one that is not ours at all
      const legacy = join(cacheDir, "golden-model", "documentation-robotics", "model");
      const foreign = join(cacheDir, "something-else", "1795191405652-ab12cd34");
      await mkdir(legacy, { recursive: true });
      await mkdir(foreign, { recursive: true });

      await freshManager().init();

      const { keys } = await cacheContents();
      expect(keys).not.toContain(hollowed.slice(cacheDir.length + 1));
      expect(keys).toContain(kept.slice(cacheDir.length + 1));
      expect(await isWhole((await buildsOf(kept))[0])).toBe(true);
      expect(await readdir(legacy)).toEqual([]);
      expect(await readdir(foreign)).toEqual([]);
      expect(rebuildLines()).toEqual([]);
    }
  );

  it.serial("removes its build on cleanup", async () => {
    const manager = freshManager();
    await manager.init();
    await manager.cleanup();

    expect(await cacheContents()).toEqual({ keys: [], temporary: [] });
  });

  it.serial("has the cache layout that tests/setup.ts expects of cli/dist", async () => {
    const setup = await readFile(join(CLI_DIR, "tests/setup.ts"), "utf-8");
    const expected = /const EXPECTED_CACHE_LAYOUT = (\d+);/.exec(setup);

    expect(expected).not.toBeNull();
    expect(GoldenCopyCacheManager.cacheLayout).toBe(Number(expected![1]));
  });

  describe("several processes at once", () => {
    /**
     * Start `count` processes that each init the cache and clone from it, all at the same
     * moment: the script waits for a clock time so that process start-up does not spread them.
     */
    const initTogether = async (sharedCache: string, count: number) => {
      const script = join(cacheDir, "init-at.ts");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(
        script,
        `import { GoldenCopyCacheManager } from ${JSON.stringify(MANAGER_MODULE)};
const wait = Number(process.argv[3]) - Date.now();
if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
const manager = GoldenCopyCacheManager.getInstance({ cacheDir: process.argv[2] });
await manager.init();
const clone = await manager.clone();
if (clone.model.manifest.name !== "Golden Copy Test Model") throw new Error("wrong model");
await clone.cleanup();
`
      );
      const startAt = String(Date.now() + 1000);
      return Promise.all(
        Array.from({ length: count }, () => run("bun", [script, sharedCache, startAt], process.env))
      );
    };

    it.serial(
      "building an empty cache all end up with whole builds",
      async () => {
        const sharedCache = join(cacheDir, "shared");

        const results = await initTogether(sharedCache, 6);

        for (const result of results) {
          expect(result.output).not.toContain("Rebuilding");
          expect(result.code).toBe(0);
        }
        // Each may have added a build of its own; every one of them is whole
        const builds = await buildsOf(await onlyKey(sharedCache));
        expect(builds.length).toBeGreaterThanOrEqual(1);
        for (const build of builds) expect(await isWhole(build)).toBe(true);
        expect((await cacheContents(sharedCache)).temporary).toEqual([]);
      },
      60000
    );

    // The case that failed before builds got names of their own: every process read "incomplete",
    // one put a good entry in place, and another, acting on what it had read earlier, moved that
    // good entry aside and deleted it.
    it.serial(
      "repairing a hollowed cache never take a good build from each other",
      async () => {
        const sharedCache = join(cacheDir, "shared");
        GoldenCopyCacheManager.resetInstance();
        await GoldenCopyCacheManager.getInstance({ cacheDir: sharedCache }).init();
        const keyDir = await onlyKey(sharedCache);
        const [hollowed] = await buildsOf(keyDir);
        await removeFilesKeepFolders(hollowed);

        for (let round = 0; round < 3; round++) {
          const results = await initTogether(sharedCache, 8);

          for (const result of results) {
            expect(result.output).not.toContain("Failed to initialize");
            expect(result.code).toBe(0);
          }
          const builds = await buildsOf(keyDir);
          expect(builds).not.toContain(hollowed);
          expect(builds.length).toBeGreaterThanOrEqual(1);
          for (const build of builds) expect(await isWhole(build)).toBe(true);

          // Hollow everything again for the next round
          for (const build of builds) await removeFilesKeepFolders(build);
        }
      },
      120000
    );
  });

  describe("in a test run (tests/setup.ts)", () => {
    /**
     * `bun test` on a one-line test file, with the system temp directory pointed at `tmp`, to
     * see what the preload prints and leaves on disk. The file is written outside the repo so
     * that no test run picks it up.
     */
    const runProbe = async (tmp: string) => {
      const probe = join(cacheDir, "probe.test.ts");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(
        probe,
        `import { expect, test } from "bun:test";\ntest("preload probe", () => {\n  expect(true).toBe(true);\n});\n`
      );
      const result = await run("bun", ["test", "--timeout=30000", probe], {
        ...process.env,
        TMPDIR: tmp,
      });
      if (result.output.includes("cli/dist is out of date")) {
        // The preload loads the cache manager from cli/dist, so this test can only see the fix
        // in a dist that has it
        throw new Error("cli/dist is out of date: run `npm run build` in cli/ and run this again");
      }
      return result;
    };

    it.serial(
      "prints no set-up error over a half-built cache and leaves it whole",
      async () => {
        // tmpdir() of the child is `tmp`, so its shared cache is in there
        const tmp = join(cacheDir, "tmp");
        await mkdir(tmp, { recursive: true });
        const sharedCache = join(tmp, "dr-golden-copy-cache");

        const first = await runProbe(tmp);
        expect(first.code).toBe(0);
        expect(first.output).not.toContain("Failed to initialize golden copy cache");
        expect(first.output).not.toContain("Rebuilding");
        const keyDir = await onlyKey(sharedCache);
        const [built] = await buildsOf(keyDir);
        expect(await isWhole(built)).toBe(true);

        await removeFilesKeepFolders(sharedCache);

        const second = await runProbe(tmp);
        expect(second.code).toBe(0);
        expect(second.output).not.toContain("Failed to initialize golden copy cache");
        expect(second.output.match(/Rebuilding the golden copy cache/g)).toHaveLength(1);
        const builds = await buildsOf(await onlyKey(sharedCache));
        expect(builds).toHaveLength(1);
        expect(await isWhole(builds[0])).toBe(true);

        const third = await runProbe(tmp);
        expect(third.code).toBe(0);
        expect(third.output).not.toContain("Rebuilding");
      },
      60000
    );

    it.serial(
      "ignores the half-built folder that earlier versions left behind",
      async () => {
        // As found on a developer machine: <tmp>/dr-golden-copy-cache/golden-model with the layer
        // folders and no manifest
        const tmp = join(cacheDir, "tmp");
        const legacy = join(tmp, "dr-golden-copy-cache", "golden-model");
        await mkdir(join(legacy, "documentation-robotics/model/01_motivation"), {
          recursive: true,
        });

        const result = await runProbe(tmp);

        expect(result.code).toBe(0);
        expect(result.output).not.toContain("Failed to initialize golden copy cache");
        expect(result.output).not.toContain("Model not found");
        expect(await readdir(join(legacy, "documentation-robotics/model"))).toEqual([
          "01_motivation",
        ]);
      },
      60000
    );
  });
});
