import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MigrationRegistry } from "../../src/core/migration-registry.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";
import { mkdir, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("MigrationRegistry", () => {
  describe("getLatestVersion", () => {
    it("should return the latest available version", () => {
      const registry = new MigrationRegistry();
      const latest = registry.getLatestVersion();
      expect(latest).toBe("0.9.0");
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
      expect(path[path.length - 1].toVersion).toBe("0.9.0");
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
      expect(registry.requiresMigration("0.9.0")).toBe(false);
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

      expect(summary.targetVersion).toBe("0.9.0");
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
  });
});
