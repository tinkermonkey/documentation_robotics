/**
 * The shared golden copy cache survives being left half built (#1220).
 *
 * The cache directory is shared by every test process on the machine. These tests give each case
 * a cache directory of its own and damage it the ways the shared one gets damaged: files removed
 * with their folders kept (the operating system's temp cleaner), a build that never finished (a
 * killed run), and several runs building at once.
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
const PROBE_TEST = "tests/fixtures/preload-probe/probe.test.ts";

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

  /** Names in the cache directory, split into entries and temporary folders */
  const cacheContents = async () => {
    const names = await readdir(cacheDir);
    return {
      entries: names.filter((name) => !name.includes(".tmp-")),
      temporary: names.filter((name) => name.includes(".tmp-")),
    };
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

  it("builds a whole entry the first time and says nothing", async () => {
    await freshManager().init();

    const { entries, temporary } = await cacheContents();
    expect(entries).toHaveLength(1);
    expect(temporary).toEqual([]);

    const entryDir = join(cacheDir, entries[0]);
    const listed = JSON.parse(await readFile(join(entryDir, "files.json"), "utf-8")).files;
    expect(listed).toContain(join("documentation-robotics", "model", "manifest.yaml"));
    expect(await filesUnder(join(entryDir, "golden-model"))).toEqual(listed);
    expect(rebuildLines()).toEqual([]);
  });

  it("loads a whole entry without rebuilding it", async () => {
    await freshManager().init();
    const [entry] = (await cacheContents()).entries;
    const manifestPath = join(
      cacheDir,
      entry,
      "golden-model/documentation-robotics/model/manifest.yaml"
    );
    const builtManifest = await readFile(manifestPath, "utf-8");

    await freshManager().init();

    // The manifest carries its creation time, so a rebuild would have changed it
    expect(await readFile(manifestPath, "utf-8")).toBe(builtManifest);
    expect(rebuildLines()).toEqual([]);
  });

  it("rebuilds an entry whose files are gone, and says so in one line", async () => {
    await freshManager().init();
    const [entry] = (await cacheContents()).entries;
    const entryDir = join(cacheDir, entry);
    await removeFilesKeepFolders(entryDir);

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain(entryDir);
    expect(rebuildLines()[0]).toContain("files.json is missing");
    expect(rebuildLines()[0]).not.toContain("\n");

    // Whole again, under the same name, with nothing left over
    expect(await cacheContents()).toEqual({ entries: [entry], temporary: [] });
    const listed = JSON.parse(await readFile(join(entryDir, "files.json"), "utf-8")).files;
    expect(await filesUnder(join(entryDir, "golden-model"))).toEqual(listed);

    // And usable
    const clone = await manager.clone();
    expect(clone.model.manifest.name).toBe("Golden Copy Test Model");
    await clone.cleanup();
  });

  it("rebuilds an entry that lost only its manifest", async () => {
    await freshManager().init();
    const [entry] = (await cacheContents()).entries;
    const manifest = join("documentation-robotics", "model", "manifest.yaml");
    await unlink(join(cacheDir, entry, "golden-model", manifest));

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain(`files are missing (${manifest})`);
    const clone = await manager.clone();
    await clone.cleanup();
  });

  it("rebuilds an entry whose model does not load", async () => {
    await freshManager().init();
    const [entry] = (await cacheContents()).entries;
    await writeFile(
      join(cacheDir, entry, "golden-model/documentation-robotics/model/manifest.yaml"),
      "{ this is: not, a manifest"
    );

    const manager = freshManager();
    await manager.init();

    expect(rebuildLines()).toHaveLength(1);
    expect(rebuildLines()[0]).toContain("its model does not load");
    const clone = await manager.clone();
    await clone.cleanup();
  });

  it("is not affected by a build that was killed partway", async () => {
    await freshManager().init();
    const [entry] = (await cacheContents()).entries;
    await rm(join(cacheDir, entry), { recursive: true });

    // What a killed build leaves: a temporary folder with part of a model, nothing at the entry
    const recent = join(cacheDir, `${entry}.tmp-build-99999-recent00`);
    const old = join(cacheDir, `${entry}.tmp-build-99998-old00000`);
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
    const { entries, temporary } = await cacheContents();
    expect(entries).toEqual([entry]);
    expect(temporary).toEqual([`${entry}.tmp-build-99999-recent00`]);
  });

  it("names the entry for what it depends on", async () => {
    await freshManager().init();
    const [plain] = (await cacheContents()).entries;
    expect(plain).toStartWith(`cli${getCliVersion()}-spec${getCliBundledSpecVersion()}-`);

    await freshManager({ warmup: true }).init();
    await freshManager({
      modelOptions: { name: "Another Model", specVersion: "0.1.0" },
    }).init();
    // eagerLoad changes how the model is read, not what is on disk
    await freshManager({ eagerLoad: true }).init();

    const { entries } = await cacheContents();
    expect(entries).toHaveLength(3);
    expect(new Set(entries).has(plain)).toBe(true);
  });

  it("does not load an entry built with other options", async () => {
    await freshManager({ modelOptions: { name: "Another Model" } }).init();

    const manager = freshManager();
    await manager.init();

    expect(manager.getGoldenModel()?.manifest.name).toBe("Golden Copy Test Model");
  });

  it("removes its entry on cleanup", async () => {
    const manager = freshManager();
    await manager.init();
    await manager.cleanup();

    expect(await cacheContents()).toEqual({ entries: [], temporary: [] });
  });

  it("gives several processes building at once the same whole entry", async () => {
    const script = join(cacheDir, "build-and-clone.ts");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      script,
      `import { GoldenCopyCacheManager } from ${JSON.stringify(MANAGER_MODULE)};
const manager = GoldenCopyCacheManager.getInstance({ cacheDir: process.argv[2] });
await manager.init();
const clone = await manager.clone();
if (clone.model.manifest.name !== "Golden Copy Test Model") throw new Error("wrong model");
await clone.cleanup();
`
    );
    const sharedCache = join(cacheDir, "shared");

    const results = await Promise.all(
      Array.from({ length: 6 }, () => run("bun", [script, sharedCache], process.env))
    );

    for (const result of results) {
      expect(result.output).not.toContain("Rebuilding");
      expect(result.code).toBe(0);
    }
    const names = await readdir(sharedCache);
    expect(names).toHaveLength(1);
    const listed = JSON.parse(await readFile(join(sharedCache, names[0], "files.json"), "utf-8"));
    expect(await filesUnder(join(sharedCache, names[0], "golden-model"))).toEqual(listed.files);
  }, 60000);

  describe("in a test run (tests/setup.ts)", () => {
    /** `bun test` on one small file, with the system temp directory pointed at `tmp` */
    const runProbe = (tmp: string) =>
      run("bun", ["test", "--timeout=30000", PROBE_TEST], {
        ...process.env,
        TMPDIR: tmp,
      });

    it("prints no set-up error over a half-built cache and leaves it whole", async () => {
      // tmpdir() of the child is cacheDir, so its shared cache is in here
      const sharedCache = join(cacheDir, "dr-golden-copy-cache");

      const first = await runProbe(cacheDir);
      expect(first.code).toBe(0);
      expect(first.output).not.toContain("Failed to initialize golden copy cache");
      expect(first.output).not.toContain("Rebuilding");
      const [entry] = await readdir(sharedCache);
      const built = await filesUnder(join(sharedCache, entry));
      expect(built).toContain("files.json");

      await removeFilesKeepFolders(sharedCache);

      const second = await runProbe(cacheDir);
      expect(second.code).toBe(0);
      expect(second.output).not.toContain("Failed to initialize golden copy cache");
      expect(second.output.match(/Rebuilding the golden copy cache/g)).toHaveLength(1);
      expect(await readdir(sharedCache)).toEqual([entry]);
      expect(await filesUnder(join(sharedCache, entry))).toEqual(built);
    }, 60000);

    it("ignores the half-built folder that earlier versions left behind", async () => {
      // As found on a developer machine: <tmp>/dr-golden-copy-cache/golden-model with the layer
      // folders and no manifest
      const legacy = join(cacheDir, "dr-golden-copy-cache", "golden-model");
      await mkdir(join(legacy, "documentation-robotics/model/01_motivation"), {
        recursive: true,
      });

      const result = await runProbe(cacheDir);

      expect(result.code).toBe(0);
      expect(result.output).not.toContain("Failed to initialize golden copy cache");
      expect(result.output).not.toContain("Model not found");
    }, 60000);
  });
});
