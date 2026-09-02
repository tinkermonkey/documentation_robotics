import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

describe("Model - Manifest Models Field Validation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dr-manifest-validation-${randomUUID()}`);
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("validateModelsField", () => {
    it("should accept undefined models", () => {
      const result = Model.validateModelsField(undefined);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept null models", () => {
      const result = Model.validateModelsField(null);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept an empty object", () => {
      const result = Model.validateModelsField({});
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept a valid models object", () => {
      const result = Model.validateModelsField({
        "auth-service": { url: "https://github.com/org/auth" },
        "payment-service": { role: "shared" },
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject a string value", () => {
      const result = Model.validateModelsField("auth-service");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("expected an object");
      expect(result.error).toContain("a string");
    });

    it("should reject an array value", () => {
      const result = Model.validateModelsField(["auth-service"]);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("expected an object");
      expect(result.error).toContain("an array");
    });

    it("should reject a number value", () => {
      const result = Model.validateModelsField(123);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("expected an object");
      expect(result.error).toContain("a number");
    });

    it("should reject a boolean value", () => {
      const result = Model.validateModelsField(true);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("expected an object");
    });

    it("should provide helpful error message for string case", () => {
      const result = Model.validateModelsField("auth-service");
      expect(result.error).toContain("YAML syntax is incorrect");
      expect(result.error).toContain("'models: auth-service'");
    });
  });

  describe("Model.load - manifest validation integration", () => {
    async function createTestProject(manifestContent: string): Promise<string> {
      const projectRoot = testDir;
      const modelDir = join(projectRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });
      await writeFile(join(modelDir, "manifest.yaml"), manifestContent);
      return projectRoot;
    }

    it("should load manifest with valid models object", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
models:
  auth-service:
    url: https://github.com/org/auth
  payment-service:
    role: shared
`;
      const projectRoot = await createTestProject(manifestYaml);
      const model = await Model.load(projectRoot, { lazyLoad: true });
      expect(model.manifest.models).toBeDefined();
      expect(model.manifest.models?.["auth-service"]).toBeDefined();
      expect(model.manifest.models?.["payment-service"]).toBeDefined();
    });

    it("should load manifest without models field", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
`;
      const projectRoot = await createTestProject(manifestYaml);
      const model = await Model.load(projectRoot, { lazyLoad: true });
      expect(model.manifest.models).toBeUndefined();
    });

    it("should reject manifest with models as string", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
models: auth-service
`;
      const projectRoot = await createTestProject(manifestYaml);
      try {
        await Model.load(projectRoot, { lazyLoad: true });
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message).toContain("Invalid manifest 'models' field");
        expect((error as Error).message).toContain("expected an object");
        expect((error as Error).message).toContain("YAML syntax is incorrect");
      }
    });

    it("should reject manifest with models as array", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
models:
  - auth-service
  - payment-service
`;
      const projectRoot = await createTestProject(manifestYaml);
      try {
        await Model.load(projectRoot, { lazyLoad: true });
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message).toContain("Invalid manifest 'models' field");
        expect((error as Error).message).toContain("expected an object");
        expect((error as Error).message).toContain("an array");
      }
    });

    it("should reject manifest with models as number", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
models: 123
`;
      const projectRoot = await createTestProject(manifestYaml);
      try {
        await Model.load(projectRoot, { lazyLoad: true });
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect((error as Error).message).toContain("Invalid manifest 'models' field");
        expect((error as Error).message).toContain("expected an object");
      }
    });

    it("error message provides example of correct syntax", async () => {
      const manifestYaml = `
project:
  name: Test Model
  version: 1.0.0
models: auth-service
`;
      const projectRoot = await createTestProject(manifestYaml);
      try {
        await Model.load(projectRoot, { lazyLoad: true });
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("e.g., {");
        expect(message).toContain("auth-service");
      }
    });
  });
});
