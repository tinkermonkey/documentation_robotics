/**
 * Unit tests for MCP shared tool helpers (`cli/src/mcp/tools/shared.ts`):
 * `loadModel`'s error translation, the model cache, and `runTool`'s
 * unconditional stderr logging.
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
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

    it("rereads the model when another process changed its files (a landing, a pull, a hand edit)", async () => {
      const workdir = await createTestWorkdir();
      try {
        const cached = await loadModel(workdir.path);
        // `dr changeset commit` in a terminal, or the viewer's Apply: another Model writes the files.
        const elsewhere = await Model.load(workdir.path, { lazyLoad: false });
        elsewhere.manifest.description = "changed outside the MCP server";
        await elsewhere.saveManifest();

        const fresh = await loadModel(workdir.path);
        expect(fresh).not.toBe(cached);
        expect(fresh.manifest.description).toBe("changed outside the MCP server");
        // And it is cached again until the files change.
        expect(await loadModel(workdir.path)).toBe(fresh);
      } finally {
        await workdir.cleanup();
      }
    });

    it("rereads the model when a changeset is activated outside the server, and sees what is staged into it there", async () => {
      const workdir = await createTestWorkdir();
      try {
        const cached = await loadModel(workdir.path);
        expect(cached.getActiveChangesetId()).toBeNull();
        // Another cache key stands in for another process: the cache under workdir.path is untouched.
        const elsewhere = `${workdir.path}/`;
        const created = await changesetCreateHandler({ name: "made-elsewhere", rootPath: elsewhere });
        expect(created.isError).toBeUndefined();
        const id = JSON.parse((created.content[0] as { text: string }).text).id as string;

        const activated = await loadModel(workdir.path);
        expect(activated).not.toBe(cached);
        expect(activated.getActiveChangesetId()).toBe(id);

        const added = await modelAddHandler({ layer: "application", type: "applicationfunction", name: "refund-elsewhere", rootPath: elsewhere });
        expect(added.isError).toBeUndefined();
        const staged = await loadModel(workdir.path);
        expect(staged).not.toBe(activated);
        expect((await staged.getLayer("application"))?.getElement("application.applicationfunction.refund-elsewhere")).toBeDefined();
      } finally {
        await workdir.cleanup();
      }
    });

    it("keeps the server's own writes through the cached model", async () => {
      const workdir = await createTestWorkdir();
      try {
        const cached = await loadModel(workdir.path);
        cached.manifest.description = "written by a tool";
        await cached.saveManifest();

        const next = await loadModel(workdir.path);
        expect(next.manifest.description).toBe("written by a tool");
      } finally {
        await workdir.cleanup();
      }
    });

    it("rereads a model that changed during its first read", async () => {
      const workdir = await createTestWorkdir();
      const manifestPath = join(workdir.path, "documentation-robotics", "model", "manifest.yaml");
      const realLoad = Model.load.bind(Model);
      // Another process lands a change while the server reads the model for the first time.
      const loadSpy = vi.spyOn(Model, "load").mockImplementationOnce(async (startPath, options) => {
        const model = await realLoad(startPath, options);
        const manifest = parseYaml(await readFile(manifestPath, "utf-8"));
        manifest.project = { ...manifest.project, description: "landed during the first read" };
        await writeFile(manifestPath, stringifyYaml(manifest));
        return model;
      });
      try {
        const first = await loadModel(workdir.path);
        const next = await loadModel(workdir.path);
        expect(next).not.toBe(first);
        expect(next.manifest.description).toBe("landed during the first read");
      } finally {
        loadSpy.mockRestore();
        await workdir.cleanup();
      }
    });

    it("keeps every element when two model_add calls run in parallel over a large layer", async () => {
      const workdir = await createTestWorkdir();
      const layerDir = join(workdir.path, "documentation-robotics", "model", "01_motivation");
      const types = ["assessment", "constraint", "driver", "goal", "meaning", "outcome", "principle", "requirement", "stakeholder", "value"];
      const perType = 50;
      try {
        for (const type of types) {
          let yaml = "";
          for (let n = 0; n < perType; n++) {
            const id = `motivation.${type}.bulk-${n}`;
            yaml += `${id}:\n  id: ${crypto.randomUUID()}\n  path: ${id}\n  spec_node_id: motivation.${type}\n  type: ${type}\n  layer_id: motivation\n  name: Bulk ${n}\n  description: Item ${n}\n`;
          }
          await writeFile(join(layerDir, `${type}.yaml`), yaml);
        }
        // A layer save removes the layer's files and writes them one by one: a second call that
        // reread the model while the first is saving would see part of the layer and save that.
        for (const delay of [1, 3, 6]) {
          clearModelCache();
          const before = (await (await loadModel(workdir.path)).getLayer("motivation"))!.listElements().length;
          const add = (name: string) =>
            modelAddHandler({ layer: "motivation", type: "goal", name, description: "d", attributes: { priority: "high" }, rootPath: workdir.path });
          const first = add(`parallel-a-${delay}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          const results = await Promise.all([first, add(`parallel-b-${delay}`)]);
          expect(results.map((r) => r.isError)).toEqual([undefined, undefined]);

          const onDisk = await Model.load(workdir.path, { lazyLoad: false });
          expect((await onDisk.getLayer("motivation"))!.listElements().length).toBe(before + 2);
        }
      } finally {
        await workdir.cleanup();
      }
    }, 60000);

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
      // A manifest for the cache to fingerprint (with no model files, every load would reread).
      await mkdir(join(rootPath, "documentation-robotics", "model"), { recursive: true });
      await writeFile(join(rootPath, "documentation-robotics", "model", "manifest.yaml"), "version: 0.1.0\n");

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
