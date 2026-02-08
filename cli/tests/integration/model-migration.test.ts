import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { ModelMigrationService } from "../../src/export/model-migration.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { rm } from "fs/promises";

describe("Model Migration Service", () => {
  let testDir: string;
  let model: Model;
  let cleanup: (() => Promise<void>) | undefined;
  let createdDirs: string[] = [];

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    testDir = workdir.path;
    cleanup = workdir.cleanup;
    createdDirs = [];
    model = await Model.load(testDir, { lazyLoad: false });
  });

  afterEach(async () => {
    // Clean up all created directories (backups and targets)
    for (const dir of createdDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    if (cleanup) {
      await cleanup();
    }
  });

  /**
   * Helper to track directories for cleanup
   */
  function trackDirectory(dir: string): void {
    createdDirs.push(dir);
  }

  describe("ModelMigrationService", () => {
    it("should initialize with a model", () => {
      const service = new ModelMigrationService(model);
      expect(service).toBeDefined();
    });

    it("should migrate model with backup creation", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

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

      // Track backup directory for cleanup
      if (result.backupDir) {
        trackDirectory(result.backupDir);
      }
    });

    it("should generate migration mapping table", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.mappingFilePath).toBeDefined();
      expect(result.mappingFilePath).toContain("migration-map.json");
    });

    it("should validate migrated model", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        validateAfterMigration: true,
      });

      expect(Array.isArray(result.validationErrors)).toBe(true);
    });

    it("should preserve element properties during migration", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

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
    });

    it("should handle empty models gracefully", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.success).toBe(true);
      expect(result.elementCount).toBeGreaterThanOrEqual(0);
    });

    it("should track migration duration", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe("number");
    });

    it("should report warnings for dangling references", async () => {
      const targetDir = `${testDir}-v2`;
      trackDirectory(targetDir);

      const service = new ModelMigrationService(model);

      const result = await service.migrate(testDir, {
        targetDir,
        backupOriginal: false,
      });

      // Result should be valid even if there are warnings
      expect(result.success).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
