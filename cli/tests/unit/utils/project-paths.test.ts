/**
 * Tests for resolveModelDirectory: the shared standard / legacy / detached model lookup
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { ensureDir } from "../../../src/utils/file-io.js";
import { resolveModelDirectory } from "../../../src/utils/project-paths.js";

describe("resolveModelDirectory", () => {
  // The unit suite runs tests concurrently, so each test gets its own directory
  const root = path.join("/tmp", `resolve-model-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  async function freshDir(name: string): Promise<string> {
    const dir = path.join(root, name);
    await ensureDir(dir);
    return dir;
  }

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns null when none of the layouts exists", async () => {
    expect(await resolveModelDirectory(path.join(root, "missing"))).toBeNull();
  });

  it("prefers the standard layout, then legacy, then the path itself", async () => {
    const base = await freshDir("order");
    await ensureDir(path.join(base, "documentation-robotics", "model"));
    await ensureDir(path.join(base, "model"));

    expect(await resolveModelDirectory(base)).toEqual({
      modelDir: path.join(base, "documentation-robotics", "model"),
      layout: "standard",
      isDirectory: true,
    });

    await fs.rm(path.join(base, "documentation-robotics"), { recursive: true });
    expect((await resolveModelDirectory(base))?.layout).toBe("legacy");

    await fs.rm(path.join(base, "model"), { recursive: true });
    expect(await resolveModelDirectory(base)).toEqual({ modelDir: base, layout: "detached", isDirectory: true });
  });

  it("reports a file sitting at a candidate path instead of skipping it", async () => {
    const base = await freshDir("file-candidate");
    await fs.writeFile(path.join(base, "model"), "not a directory");

    const resolved = await resolveModelDirectory(base);
    expect(resolved?.layout).toBe("legacy");
    expect(resolved?.isDirectory).toBe(false);
  });

  it("with requireManifest only accepts a directory holding manifest.yaml", async () => {
    const base = await freshDir("require-manifest");
    // An empty standard-layout folder is skipped in favour of a detached model
    await ensureDir(path.join(base, "documentation-robotics", "model"));
    await fs.writeFile(path.join(base, "manifest.yaml"), "project:\n  name: x\n");

    expect((await resolveModelDirectory(base, { requireManifest: true }))?.layout).toBe("detached");

    await fs.writeFile(path.join(base, "documentation-robotics", "model", "manifest.yaml"), "project:\n  name: x\n");
    expect((await resolveModelDirectory(base, { requireManifest: true }))?.layout).toBe("standard");

    await fs.rm(base, { recursive: true });
    await ensureDir(path.join(base, "model"));
    expect(await resolveModelDirectory(base, { requireManifest: true })).toBeNull();
  });
});
