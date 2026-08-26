import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { MigrationRegistry } from "../../src/core/migration-registry.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";
import { mkdir, rm, readdir, writeFile, access as fsAccess } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("MigrationRegistry", () => {
  describe("getLatestVersion", () => {
    it("should return the latest available version", () => {
      const registry = new MigrationRegistry();
      const latest = registry.getLatestVersion();
      expect(latest).toBe("0.10.0");
    });
  });

  describe("getMigrationPath", () => {
    it("should return empty path when version is current", () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath("0.6.0", "0.6.0");
      expect(path).toHaveLength(0);
    });

    it("should return empty path when version is already newer than target", () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath("0.6.0", "0.5.0");
      expect(path).toHaveLength(0);
    });

    it("should return migration path from 0.5.0 to latest", () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath("0.5.0");
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1].toVersion).toBe("0.10.0");
    });

    it("should return migration path from 0.5.0 to 0.6.0", () => {
      const registry = new MigrationRegistry();
      const path = registry.getMigrationPath("0.5.0", "0.6.0");
      expect(path).toHaveLength(1);
      expect(path[0].fromVersion).toBe("0.5.0");
      expect(path[0].toVersion).toBe("0.6.0");
    });
  });

  describe("requiresMigration", () => {
    it("should return true when migration is needed", () => {
      const registry = new MigrationRegistry();
      expect(registry.requiresMigration("0.5.0")).toBe(true);
    });

    it("should return false when no migration is needed", () => {
      const registry = new MigrationRegistry();
      expect(registry.requiresMigration("0.10.0")).toBe(false);
    });

    it("should return true when 0.8.4 needs migration to latest", () => {
      const registry = new MigrationRegistry();
      expect(registry.requiresMigration("0.8.4")).toBe(true);
    });
  });

  describe("getMigrationSummary", () => {
    it("should return migration summary", () => {
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary("0.5.0", "0.6.0");

      expect(summary.currentVersion).toBe("0.5.0");
      expect(summary.targetVersion).toBe("0.6.0");
      expect(summary.migrationsNeeded).toBe(1);
      expect(summary.migrations).toHaveLength(1);
      expect(summary.migrations[0].description).toContain("0.6.0");
    });

    it("should use latest version as default target", () => {
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary("0.5.0");

      expect(summary.targetVersion).toBe("0.10.0");
    });
  });

  describe("applyMigrations", () => {
    it("should apply migration and update manifest version", async () => {
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.5.0",
      });

      const model = new Model("/tmp/test", manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.5.0",
        toVersion: "0.6.0",
      });

      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.6.0");
      expect(model.manifest.specVersion).toBe("0.6.0");
    });

    it("should support dry run mode", async () => {
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.5.0",
      });

      const model = new Model("/tmp/test", manifest);
      const registry = new MigrationRegistry();

      await registry.applyMigrations(model, {
        fromVersion: "0.5.0",
        toVersion: "0.6.0",
        dryRun: true,
      });

      // Model manifest should not be modified in dry run
      expect(model.manifest.specVersion).toBe("0.5.0");
    });

    it("should return empty result when no migrations needed", async () => {
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.6.0",
      });

      const model = new Model("/tmp/test", manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.6.0",
        toVersion: "0.6.0",
      });

      expect(result.applied).toHaveLength(0);
      expect(result.totalChanges).toBe(0);
    });
  });

  describe("v0.8.4 → v0.9.0 migration (filesystem operations)", () => {
    let tempRootPath: string;

    beforeEach(async () => {
      tempRootPath = join(
        tmpdir(),
        `dr-test-migration-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
      );
      await mkdir(tempRootPath, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(tempRootPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in tests
      }
    });

    it("should rename all 10 layer directories and create product layer", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");

      // Create old 12-layer structure (03_security through 12_testing)
      const oldLayers = [
        "03_security",
        "04_application",
        "05_technology",
        "06_api",
        "07_data-model",
        "08_data-store",
        "09_ux",
        "10_navigation",
        "11_apm",
        "12_testing",
      ];

      for (const layer of oldLayers) {
        await mkdir(join(modelDir, layer), { recursive: true });
      }

      // Create model with 0.8.4 spec version
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.8.4",
        toVersion: "0.9.0",
      });

      // Verify migration was applied
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.9.0");

      // Verify all old directories were renamed
      const dirs = await readdir(modelDir);
      expect(dirs).toContain("04_security");
      expect(dirs).toContain("05_application");
      expect(dirs).toContain("06_technology");
      expect(dirs).toContain("07_api");
      expect(dirs).toContain("08_data-model");
      expect(dirs).toContain("09_data-store");
      expect(dirs).toContain("10_ux");
      expect(dirs).toContain("11_navigation");
      expect(dirs).toContain("12_apm");
      expect(dirs).toContain("13_testing");

      // Verify new product layer was created
      expect(dirs).toContain("03_product");

      // Verify old names are gone
      expect(dirs).not.toContain("03_security");
      expect(dirs).not.toContain("12_testing");

      // Verify filesModified count (10 successful renames)
      expect(result.applied[0].changes?.filesModified).toBe(10);
    });

    it("should handle gracefully when model directory does not exist", async () => {
      // Don't create any directories
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.8.4",
        toVersion: "0.9.0",
      });

      // Migration should succeed with no files modified but still count as 1 migration applied
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.9.0");
      expect(result.applied[0].changes?.filesModified).toBe(0);
      expect(result.totalChanges).toBe(1);
    });

    it("should handle partial migrations (some directories already renamed)", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");

      // Create a partially migrated structure
      // Some old names still exist, some new names already exist
      const partiallMigratedLayers = [
        "03_security", // Old name, should be renamed
        "05_application", // Already renamed (new name)
        "05_technology", // Old name, should be renamed
      ];

      for (const layer of partiallMigratedLayers) {
        await mkdir(join(modelDir, layer), { recursive: true });
      }

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.8.4",
        toVersion: "0.9.0",
      });

      // Migration should complete successfully
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.9.0");

      // Verify directories exist in correct form
      const dirs = await readdir(modelDir);
      expect(dirs).toContain("04_security"); // Renamed from 03_security
      expect(dirs).toContain("06_technology"); // Renamed from 05_technology
      expect(dirs).toContain("05_application"); // Already existed
    });

    it("should create product layer directory even when no other layers exist", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");
      await mkdir(modelDir, { recursive: true });

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.8.4",
        toVersion: "0.9.0",
      });

      expect(result.applied).toHaveLength(1);
      const dirs = await readdir(modelDir);
      expect(dirs).toContain("03_product");
    });

    it("should update manifest spec version to 0.9.0", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");
      await mkdir(modelDir, { recursive: true });

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      await registry.applyMigrations(model, {
        fromVersion: "0.8.4",
        toVersion: "0.9.0",
      });

      // Verify manifest was updated
      expect(model.manifest.specVersion).toBe("0.9.0");
    });

    it("should throw when fs.access fails with permission denied", async () => {
      const restrictedDir = join(tempRootPath, "restricted-model");
      const modelDir = join(restrictedDir, "documentation-robotics/model");
      await mkdir(modelDir, { recursive: true });

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(restrictedDir, manifest);
      const registry = new MigrationRegistry();

      // Restrict permissions on the model directory to trigger permission error
      // This requires running as non-root (uid != 0)
      const { chmod } = await import("fs/promises");
      await chmod(modelDir, 0o000);

      try {
        await registry.applyMigrations(model, {
          fromVersion: "0.8.4",
          toVersion: "0.9.0",
        });
        // If we reach here, the test should fail
        throw new Error("Expected migration to throw permission error");
      } catch (error) {
        // Verify a permission-related error was thrown (not silently ignored)
        // The key test: permission errors should be re-thrown, not handled as success
        expect(error).toBeDefined();
        const err = error as any;
        // The error should not be "Expected migration to throw permission error" (our own thrown error)
        // which means applyMigrations actually threw an error
        expect(err.message).not.toBe("Expected migration to throw permission error");
      } finally {
        // Restore permissions for cleanup
        try {
          await chmod(modelDir, 0o755);
        } catch {
          // Ignore restore errors, directory will be cleaned up anyway
        }
      }
    });

    it("should fail migration and not update spec version when rename fails", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");

      // Create a scenario where rename will fail: put a file where we expect a directory
      await mkdir(modelDir, { recursive: true });

      // Create the old layer directory
      await mkdir(join(modelDir, "03_security"), { recursive: true });

      // Create a file at the target rename location to cause EEXIST with contents
      // First create 04_security as a file (not a directory) to cause rename to fail
      await writeFile(join(modelDir, "04_security"), "this is a file, not a directory");

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      try {
        await registry.applyMigrations(model, {
          fromVersion: "0.8.4",
          toVersion: "0.9.0",
        });
        // If we reach here, the test should fail because an error should have been thrown
        throw new Error("Expected migration to throw rename error");
      } catch (error) {
        // Verify the error was thrown
        expect(error).toBeDefined();

        // Verify spec version was NOT updated due to the error
        expect(model.manifest.specVersion).toBe("0.8.4");
      }
    });

    it("should track and report rename failures in error field", async () => {
      const modelDir = join(tempRootPath, "documentation-robotics/model");

      // Create a scenario where one rename will fail
      await mkdir(modelDir, { recursive: true });

      // Create an old layer directory that will fail to rename
      await mkdir(join(modelDir, "03_security"), { recursive: true });

      // Create a file where the target directory should go, causing rename to fail
      await writeFile(join(modelDir, "04_security"), "blocking file");

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.8.4",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      try {
        await registry.applyMigrations(model, {
          fromVersion: "0.8.4",
          toVersion: "0.9.0",
        });
        throw new Error("Expected migration to fail with rename error");
      } catch (error) {
        // Verify error contains information about the failed rename
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain("03_security");

        // Verify spec version was not bumped (because migration threw error)
        expect(model.manifest.specVersion).toBe("0.8.4");
      }
    });
  });

  describe("v0.9.0 → v0.10.0 migration (objectschema.required type change)", () => {
    let tempRootPath: string;

    beforeEach(async () => {
      tempRootPath = join(
        tmpdir(),
        `dr-test-migration-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
      );
      await mkdir(tempRootPath, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(tempRootPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in tests
      }
    });

    it("should convert string required field to array in objectschema elements", async () => {
      const { writeFile: yamlWriteFile } = await import("fs/promises");
      const YAML = await import("yaml");

      const modelDir = join(tempRootPath, "documentation-robotics/model/08_data-model");
      await mkdir(modelDir, { recursive: true });

      // Create an objectschema element with string-typed required field
      const objectschemaData = {
        "user-schema": {
          id: "user-schema",
          path: "data-model.objectschema.user-schema",
          spec_node_id: "data-model.objectschema",
          type: "objectschema",
          layer_id: "data-model",
          name: "User Schema",
          description: "User object schema",
          attributes: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
            },
            required: "id,name,email", // String format - should be converted to array
          },
        },
      };

      const schemaPath = join(modelDir, "objectschema.yaml");
      await yamlWriteFile(schemaPath, YAML.stringify(objectschemaData), "utf-8");

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.9.0",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
      });

      // Verify migration was applied
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.10.0");
      expect(result.applied[0].changes?.filesModified).toBe(1);

      // Verify the file was updated correctly
      const content = await (
        await import("fs/promises")
      ).readFile(schemaPath, "utf-8");
      const migratedData = YAML.parse(content);

      // Verify required field is now an array
      expect(Array.isArray(migratedData["user-schema"].attributes.required)).toBe(true);
      expect(migratedData["user-schema"].attributes.required).toEqual([
        "id",
        "name",
        "email",
      ]);

      // Verify manifest version was updated
      expect(model.manifest.specVersion).toBe("0.10.0");
    });

    it("should handle objectschema elements that already have array-typed required field", async () => {
      const { writeFile: yamlWriteFile } = await import("fs/promises");
      const YAML = await import("yaml");

      const modelDir = join(tempRootPath, "documentation-robotics/model/08_data-model");
      await mkdir(modelDir, { recursive: true });

      // Create an objectschema element that already has array-typed required field
      const objectschemaData = {
        "product-schema": {
          id: "product-schema",
          path: "data-model.objectschema.product-schema",
          spec_node_id: "data-model.objectschema",
          type: "objectschema",
          layer_id: "data-model",
          name: "Product Schema",
          description: "Product object schema",
          attributes: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id", "name"], // Already an array - should not be modified
          },
        },
      };

      const schemaPath = join(modelDir, "objectschema.yaml");
      await yamlWriteFile(schemaPath, YAML.stringify(objectschemaData), "utf-8");

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.9.0",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
      });

      // Verify migration was applied but file was not modified (no conversion needed)
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].changes?.filesModified).toBe(0);
      expect(model.manifest.specVersion).toBe("0.10.0");
    });

    it("should handle mixed content in data-model directory", async () => {
      const { writeFile: yamlWriteFile } = await import("fs/promises");
      const YAML = await import("yaml");

      const modelDir = join(tempRootPath, "documentation-robotics/model/08_data-model");
      await mkdir(modelDir, { recursive: true });

      // Create multiple files with different elements
      const objectschemaData = {
        "user-schema": {
          id: "user-schema",
          path: "data-model.objectschema.user-schema",
          spec_node_id: "data-model.objectschema",
          type: "objectschema",
          layer_id: "data-model",
          name: "User Schema",
          attributes: {
            type: "object",
            required: "id,email", // String format
          },
        },
      };

      const entityData = {
        "user-entity": {
          id: "user-entity",
          path: "data-model.entity.user-entity",
          spec_node_id: "data-model.entity",
          type: "entity",
          layer_id: "data-model",
          name: "User Entity",
          description: "User entity",
        },
      };

      await yamlWriteFile(
        join(modelDir, "objectschema.yaml"),
        YAML.stringify(objectschemaData),
        "utf-8"
      );
      await yamlWriteFile(
        join(modelDir, "entity.yaml"),
        YAML.stringify(entityData),
        "utf-8"
      );

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.9.0",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
      });

      // Verify migration processed both files but only modified the one with objectschema
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].changes?.filesModified).toBe(1);

      // Verify the objectschema file was updated
      const content = await (
        await import("fs/promises")
      ).readFile(join(modelDir, "objectschema.yaml"), "utf-8");
      const migratedData = YAML.parse(content);
      expect(migratedData["user-schema"].attributes.required).toEqual(["id", "email"]);

      // Verify the entity file was not modified
      const entityContent = await (
        await import("fs/promises")
      ).readFile(join(modelDir, "entity.yaml"), "utf-8");
      const entityData2 = YAML.parse(entityContent);
      expect(entityData2["user-entity"].spec_node_id).toBe("data-model.entity");
    });

    it("should handle gracefully when data-model directory does not exist", async () => {
      // Don't create any directories
      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.9.0",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      const result = await registry.applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
      });

      // Migration should succeed with no files modified
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].to).toBe("0.10.0");
      expect(result.applied[0].changes?.filesModified).toBe(0);
      expect(model.manifest.specVersion).toBe("0.10.0");
    });

    it("should handle required field with spaces in comma-separated values", async () => {
      const { writeFile: yamlWriteFile } = await import("fs/promises");
      const YAML = await import("yaml");

      const modelDir = join(tempRootPath, "documentation-robotics/model/08_data-model");
      await mkdir(modelDir, { recursive: true });

      const objectschemaData = {
        "schema-with-spaces": {
          id: "schema-with-spaces",
          path: "data-model.objectschema.schema-with-spaces",
          spec_node_id: "data-model.objectschema",
          type: "objectschema",
          layer_id: "data-model",
          name: "Schema with Spaces",
          attributes: {
            type: "object",
            required: "id , name , email", // Spaces around values
          },
        },
      };

      const schemaPath = join(modelDir, "objectschema.yaml");
      await yamlWriteFile(schemaPath, YAML.stringify(objectschemaData), "utf-8");

      const manifest = new Manifest({
        name: "test-model",
        version: "1.0.0",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        specVersion: "0.9.0",
      });

      const model = new Model(tempRootPath, manifest);
      const registry = new MigrationRegistry();

      await registry.applyMigrations(model, {
        fromVersion: "0.9.0",
        toVersion: "0.10.0",
      });

      const content = await (
        await import("fs/promises")
      ).readFile(schemaPath, "utf-8");
      const migratedData = YAML.parse(content);

      // Verify spaces were trimmed
      expect(migratedData["schema-with-spaces"].attributes.required).toEqual([
        "id",
        "name",
        "email",
      ]);
    });
  });
});
