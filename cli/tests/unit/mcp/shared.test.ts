/**
 * Unit tests for MCP shared tool helpers (`cli/src/mcp/tools/shared.ts`):
 * `loadModel`'s error translation and `runTool`'s unconditional stderr logging.
 */

import { describe, it, expect, vi } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModel, runTool, jsonResult } from "../../../src/mcp/tools/shared.js";
import { CLIError, ModelNotFoundError, ErrorCategory } from "../../../src/utils/errors.js";

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
