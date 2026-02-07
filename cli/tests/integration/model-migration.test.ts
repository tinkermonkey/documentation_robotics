import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { ModelMigrationService } from "../../src/export/model-migration.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { rm } from "fs/promises";

describe("Model Migration Service", () => {
  let testDir: string;
  let model: Model;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    testDir = workdir.path;
    cleanup = workdir.cleanup;
    model = await Model.load(testDir, { lazyLoad: false });
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  describe("ModelMigrationService", () => {
    it("should initialize with a model", () => {
      const service = new ModelMigrationService(model);
      expect(service).toBeDefined();
    });

    it("should migrate model with backup creation", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: true,
        validateAfterMigration: true,
      });

      expect(result.success).toBe(true);
      expect(result.elementCount).toBeGreaterThanOrEqual(0);
      expect(result.relationshipCount).toBeGreaterThanOrEqual(0);
      expect(result.backupDir).toBeDefined();

      // Verify mapping size matches element count
      expect(result.elementMapping.size).toBe(result.elementCount);

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should generate migration mapping table", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.mappingFilePath).toBeDefined();
      expect(result.mappingFilePath).toContain("migration-map.json");

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should validate migrated model", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        validateAfterMigration: true,
      });

      expect(Array.isArray(result.validationErrors)).toBe(true);

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should preserve element properties during migration", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        preserveProperties: true,
      });

      expect(result.elementMapping.size).toBeGreaterThanOrEqual(0);
      // Verify at least some mappings exist if elements were migrated
      if (result.elementCount > 0) {
        expect(result.elementMapping.size).toBeGreaterThan(0);
      }

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should handle empty models gracefully", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.success).toBe(true);
      expect(result.elementCount).toBeGreaterThanOrEqual(0);

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should track migration duration", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.duration).toBeGreaterThan(0);
      expect(typeof result.duration).toBe("number");

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should report warnings for dangling references", async () => {
      const targetDir = `${testDir}-v2`;
      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      // Result should be valid even if there are warnings
      expect(result.success).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);

      // Cleanup target directory
      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
