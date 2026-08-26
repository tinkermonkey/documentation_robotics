/**
 * Unit tests for MCP shared tool helpers (`cli/src/mcp/tools/shared.ts`):
 * `loadModel`'s error translation, the model cache, and `runTool`'s
 * unconditional stderr logging.
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadModel,
  reloadModel,
  clearModelCache,
  runTool,
  jsonResult,
} from "../../../src/mcp/tools/shared.js";
import { CLIError, ModelNotFoundError, ErrorCategory } from "../../../src/utils/errors.js";
import { Model } from "../../../src/core/model.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";

function tmpProjectDir(): string {
  return join(tmpdir(), `dr-mcp-shared-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("MCP shared tool helpers", () => {
  describe("loadModel", () => {
    it("translates 'No DR project found' into a ModelNotFoundError", async () => {
      const rootPath = tmpProjectDir();
      await mkdir(rootPath, { recursive: true });
      try {
        await expect(loadModel(rootPath)).rejects.toThrow(ModelNotFoundError);
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });

    it("translates 'but no model found' into a ModelNotFoundError", async () => {
      const rootPath = tmpProjectDir();
      await mkdir(join(rootPath, "documentation-robotics"), { recursive: true });
      try {
        await expect(loadModel(rootPath)).rejects.toThrow(ModelNotFoundError);
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });

    it("translates the DR_MODEL_PATH 'Model not found' error into a ModelNotFoundError", async () => {
      const rootPath = tmpProjectDir();
      await mkdir(rootPath, { recursive: true });
      const previous = process.env.DR_MODEL_PATH;
      process.env.DR_MODEL_PATH = join(rootPath, "manifest.yaml");
      try {
        await expect(loadModel(rootPath)).rejects.toThrow(ModelNotFoundError);
      } finally {
        if (previous === undefined) {
          delete process.env.DR_MODEL_PATH;
        } else {
          process.env.DR_MODEL_PATH = previous;
        }
        await rm(rootPath, { recursive: true, force: true });
      }
    });

    it("re-throws CLIError instances from Model.load unchanged", async () => {
      // ModelNotFoundError produced above is itself a CLIError; confirm loadModel
      // preserves category/suggestions rather than re-wrapping it generically.
      const rootPath = tmpProjectDir();
      await mkdir(rootPath, { recursive: true });
      try {
        await expect(loadModel(rootPath)).rejects.toMatchObject({
          name: "ModelNotFoundError",
          exitCode: ErrorCategory.NOT_FOUND,
        });
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });
  });

  describe("model cache", () => {
    beforeEach(() => {
      clearModelCache();
    });

    it("returns the identical Model instance across repeated loadModel() calls (cache hit)", async () => {
      const workdir = await createTestWorkdir();
      try {
        const first = await loadModel(workdir.path);
        const second = await loadModel(workdir.path);
        expect(second).toBe(first);
      } finally {
        await workdir.cleanup();
      }
    });

    it("returns a different instance than a prior loadModel() after reloadModel() (cache replacement)", async () => {
      const workdir = await createTestWorkdir();
      try {
        const loaded = await loadModel(workdir.path);
        const reloaded = await reloadModel(workdir.path);
        expect(reloaded).not.toBe(loaded);

        // Subsequent loadModel() calls should now return the reloaded instance.
        const cached = await loadModel(workdir.path);
        expect(cached).toBe(reloaded);
      } finally {
        await workdir.cleanup();
      }
    });

    it("evicts a failed loadModel() so a subsequent call retries (cache eviction on failure)", async () => {
      const rootPath = tmpProjectDir();
      await mkdir(rootPath, { recursive: true });
      try {
        await expect(loadModel(rootPath)).rejects.toThrow(ModelNotFoundError);

        // The failure must not have poisoned the cache: a retry should hit disk
        // again rather than replay the cached rejection.
        const loadSpy = vi.spyOn(Model, "load").mockResolvedValueOnce({} as Model);
        try {
          await expect(loadModel(rootPath)).resolves.toBeDefined();
          expect(loadSpy).toHaveBeenCalledTimes(1);
        } finally {
          loadSpy.mockRestore();
        }
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    });

    it("does not let a stale rejection from an older promise evict a newer cache entry (race fix)", async () => {
      const rootPath = tmpProjectDir();
      await mkdir(rootPath, { recursive: true });

      // loadModel("A") creates P1 (kept pending); reloadModel("A") then replaces
      // the cache entry with P2, which resolves immediately. P1 rejecting afterwards
      // must not evict P2 from the cache.
      let rejectFirst: (error: unknown) => void = () => {};
      const firstLoad = new Promise<Model>((_resolve, reject) => {
        rejectFirst = reject;
      });
      const secondModel = {} as Model;
      const loadSpy = vi
        .spyOn(Model, "load")
        .mockImplementationOnce(() => firstLoad)
        .mockImplementationOnce(async () => secondModel);

      try {
        const p1 = loadModel(rootPath);
        p1.catch(() => {}); // expected to reject later; avoid an unhandled-rejection warning

        const reloaded = await reloadModel(rootPath);
        expect(reloaded).toBe(secondModel);

        rejectFirst(new Error("stale failure"));
        // Flush the microtask queue so the stale .catch() handler runs.
        await new Promise((resolve) => setTimeout(resolve, 0));

        const cached = await loadModel(rootPath);
        expect(cached).toBe(reloaded);
        expect(loadSpy).toHaveBeenCalledTimes(2);
      } finally {
        loadSpy.mockRestore();
        await rm(rootPath, { recursive: true, force: true });
      }
    });
  });

  describe("runTool", () => {
    it("logs the error to stderr and returns a structured result for a CLIError", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await runTool(async () => {
          throw new CLIError("boom", ErrorCategory.VALIDATION, ["fix it"]);
        });
        expect(result.isError).toBe(true);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain("boom");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("logs the stack trace to stderr for a generic Error", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await runTool(async () => {
          throw new Error("unexpected failure");
        });
        expect(result.isError).toBe(true);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = errorSpy.mock.calls[0][0] as string;
        expect(logged).toContain("unexpected failure");
        expect(logged).toContain("Error:");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("does not log anything when the handler succeeds", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await runTool(async () => jsonResult({ ok: true }));
        expect(result.isError).toBeUndefined();
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
