/**
 * serveFromRootPathEnv: `dr mcp` serves the model at DR_MCP_ROOT_PATH (DrBot's launch sets it)
 * whatever cwd the MCP client spawned it in; a bad path is reported and the cwd is left alone.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, spyOn } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Model } from "../../../src/core/model.js";
import { serveFromRootPathEnv } from "../../../src/commands/mcp.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";

const originalCwd = process.cwd();
let base: string;
let modelRoot: string;

beforeAll(async () => {
  base = join(await realpath(tmpdir()), `dr-serve-root-${randomUUID()}`);
  modelRoot = join(base, "project");
  await mkdir(modelRoot, { recursive: true });
  await mkdir(join(base, "elsewhere"), { recursive: true });
  await Model.init(modelRoot, { name: "Serve Root Model", version: "0.1.0" }, { lazyLoad: false });
});

afterEach(() => {
  process.chdir(originalCwd);
  clearModelCache();
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(base, { recursive: true, force: true });
});

describe("serveFromRootPathEnv", () => {
  it("moves the server to DR_MCP_ROOT_PATH so tools load that model by default", async () => {
    process.chdir(join(base, "elsewhere"));
    serveFromRootPathEnv({ DR_MCP_ROOT_PATH: modelRoot });
    expect(await realpath(process.cwd())).toBe(await realpath(modelRoot));
    const model = await loadModel();
    expect(model.manifest.name).toBe("Serve Root Model");
  });

  it("reports an unusable path and leaves the cwd unchanged", () => {
    const elsewhere = join(base, "elsewhere");
    process.chdir(elsewhere);
    const before = process.cwd();
    const stderr = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      serveFromRootPathEnv({ DR_MCP_ROOT_PATH: join(base, "missing") });
      expect(process.cwd()).toBe(before);
      expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain("is not usable");
    } finally {
      stderr.mockRestore();
    }
  });

  it("does nothing when DR_MCP_ROOT_PATH is unset", () => {
    const before = process.cwd();
    serveFromRootPathEnv({});
    expect(process.cwd()).toBe(before);
  });
});
