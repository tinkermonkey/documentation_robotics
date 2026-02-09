import { describe, it, expect } from "bun:test";
import { MigrationRegistry } from "../../src/core/migration-registry.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";

describe("MigrationRegistry", () => {
  describe("getLatestVersion", () => {
    it("should return the latest available version", () => {
      const registry = new MigrationRegistry();
      const latest = registry.getLatestVersion();
      expect(latest).toBe("0.7.1");
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
      expect(path[path.length - 1].toVersion).toBe("0.7.1");
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
      expect(registry.requiresMigration("0.7.1")).toBe(false);
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

      expect(summary.targetVersion).toBe("0.7.1");
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
});
