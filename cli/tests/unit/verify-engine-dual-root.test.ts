/**
 * Verify Engine Dual-Root Tests
 *
 * Validates that VerifyEngine uses model.codebaseRoot when resolving source file paths
 * during drift detection and verification.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../src/core/model.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { VerifyEngine } from "../../src/analyzers/verify-engine.js";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

let TEST_DIR: string;

beforeAll(async () => {
  TEST_DIR = join(tmpdir(), `dr-verify-engine-dual-root-test-${randomUUID()}`);
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

describe("VerifyEngine with Dual-Root", () => {
  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("Source File Resolution in Detached Mode", () => {
    it("should resolve source files against codebaseRoot, not modelRoot", async () => {
      const farmRoot = join(TEST_DIR, "verify-file-in-codebase-only");
      const modelRoot = join(farmRoot, "service-model");
      const codebaseRoot = join(farmRoot, "service-code");

      // Create directories
      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });
      await mkdir(join(codebaseRoot, "src"), { recursive: true });

      // Create a source file ONLY in codebaseRoot (not in modelRoot)
      const sourceFile = join(codebaseRoot, "src", "api.ts");
      await writeFile(sourceFile, "export function getUser() { }");

      // Verify file does NOT exist at modelRoot/src/api.ts
      const wrongPath = join(modelRoot, "src", "api.ts");
      expect(await Bun.file(wrongPath).exists()).toBe(false);

      // Create model structure with manifest
      const modelDir = join(modelRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });
      await mkdir(join(modelDir, "07_api"), { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Verify Detached Test"
  version: "0.1.0"
spec_version: "0.6.0"
source: "../service-code"`
      );

      // Write API layer with element that references the source file
      const apiYaml = `
get-user:
  id: "api-test-1"
  path: "api.operation.get-user"
  type: "operation"
  name: "Get User"
  layer_id: "api"
  source_reference:
    provenance: "extracted"
    locations:
      - file: "src/api.ts"
        symbol: "getUser"
  attributes:
    http_method: "GET"
    http_path: "/users/{id}"
`;
      await writeFile(join(modelDir, "07_api", "operations.yaml"), apiYaml);

      // Verify with NO routes - this forces the engine to check file existence
      // without any route matching to confuse the results
      const engine = new VerifyEngine();
      const report = await engine.computeReport(
        modelRoot,
        [],
        { changesetAware: false }
      );

      // The critical assertion: the element should be in in_model_only
      // because the file exists in codebaseRoot (so it passes file-existence check)
      // If codebaseRoot were not being used and we looked in modelRoot instead,
      // the file wouldn't exist and the element would NOT be in in_model_only
      expect(report.buckets.in_model_only.length).toBeGreaterThan(0);
    });

    it("should exclude elements when files exist only in modelRoot, not codebaseRoot", async () => {
      const farmRoot = join(TEST_DIR, "verify-file-modelroot-only");
      const modelRoot = join(farmRoot, "model");
      const codebaseRoot = join(farmRoot, "separate-codebase");

      // Create directories
      await mkdir(modelRoot, { recursive: true });
      await mkdir(join(modelRoot, "src"), { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      // Create a source file ONLY in modelRoot (NOT in codebaseRoot)
      const fileInModelRoot = join(modelRoot, "src", "handler.ts");
      await writeFile(fileInModelRoot, "export function handler() { }");

      // Verify file does NOT exist at codebaseRoot/src/handler.ts
      const wrongPath = join(codebaseRoot, "src", "handler.ts");
      expect(await Bun.file(wrongPath).exists()).toBe(false);

      // Create model structure with manifest pointing to separate codebase
      const modelDir = join(modelRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });
      await mkdir(join(modelDir, "07_api"), { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "File Only in Model Test"
  version: "0.1.0"
spec_version: "0.6.0"
source: "../separate-codebase"`
      );

      // Write API layer with element referencing a file that only exists in modelRoot
      const apiYaml = `
handle-request:
  id: "api-test-2"
  path: "api.operation.handle-request"
  type: "operation"
  name: "Handle Request"
  layer_id: "api"
  source_reference:
    provenance: "extracted"
    locations:
      - file: "src/handler.ts"
        symbol: "handler"
  attributes:
    http_method: "POST"
    http_path: "/handle"
`;
      await writeFile(join(modelDir, "07_api", "operations.yaml"), apiYaml);

      const engine = new VerifyEngine();

      // Run verification with NO routes - forces file existence check
      const report = await engine.computeReport(
        modelRoot,
        [],
        { changesetAware: false }
      );

      // CRITICAL: The element should NOT be in in_model_only because the file
      // doesn't exist at codebaseRoot/src/handler.ts (only at modelRoot/src/handler.ts).
      // This proves that codebaseRoot is actually being used for file resolution.
      // If modelRoot were being used instead, the element would be in in_model_only.
      expect(report.buckets.in_model_only.length).toBe(0);
    });
  });

  describe("Co-located Mode Backwards Compatibility", () => {
    it("should resolve source files against rootPath when codebaseRoot is not set", async () => {
      const modelRoot = join(TEST_DIR, "verify-colocated");

      // Create directories
      await mkdir(modelRoot, { recursive: true });
      await mkdir(join(modelRoot, "src"), { recursive: true });

      // Create a source file in the model root (co-located)
      const sourceFile = join(modelRoot, "src", "service.ts");
      await writeFile(sourceFile, "export class Service { }");

      // Create model structure with manifest (no source)
      const modelDir = join(modelRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });
      await mkdir(join(modelDir, "07_api"), { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Co-located Verify Test"
  version: "0.1.0"
spec_version: "0.6.0"`
      );

      // Write API layer with element
      const apiYaml = `
get-service:
  id: "api-test-3"
  path: "api.operation.get-service"
  type: "operation"
  name: "Get Service"
  layer_id: "api"
  source_reference:
    provenance: "extracted"
    locations:
      - file: "src/service.ts"
        symbol: "Service"
  attributes:
    http_method: "GET"
    http_path: "/service"
`;
      await writeFile(join(modelDir, "07_api", "operations.yaml"), apiYaml);

      const engine = new VerifyEngine();
      const report = await engine.computeReport(
        modelRoot,
        [],
        { changesetAware: false }
      );

      // File should be found in co-located model (codebaseRoot defaults to modelRoot)
      expect(report.buckets.in_model_only.length).toBeGreaterThan(0);
    });
  });
});
