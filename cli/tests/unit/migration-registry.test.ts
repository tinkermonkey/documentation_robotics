import { describe, it, expect } from "bun:test";
import { MigrationRegistry } from "../../src/core/migration-registry.js";
import { Model } from "../../src/core/model.js";
import { Manifest } from "../../src/core/manifest.js";
import { getCliBundledSpecVersion } from "../../src/utils/spec-version.js";

describe("MigrationRegistry", () => {
  // Test version comparison through getMigrationPath (public API)
  describe("version comparison (via getMigrationPath)", () => {
    it("should correctly compare release versions", () => {
      const registry = new MigrationRegistry();
      // 0.5.0 < 0.6.0 should return migration path
      const path1 = registry.getMigrationPath("0.5.0", "0.6.0");
      expect(path1.length).toBeGreaterThan(0);

      // 0.6.0 >= 0.5.0 should return empty path
      const path2 = registry.getMigrationPath("0.6.0", "0.5.0");
      expect(path2).toHaveLength(0);

      // 0.6.0 == 0.6.0 should return empty path
      const path3 = registry.getMigrationPath("0.6.0", "0.6.0");
      expect(path3).toHaveLength(0);
    });

    it("should treat metadata as insignificant for comparison", () => {
      const registry = new MigrationRegistry();

      // Metadata (+build) should be ignored in comparison
      // 0.5.0+build123 == 0.5.0 for versioning purposes
      const path = registry.getMigrationPath("0.5.0+build123", "0.5.0");
      expect(path).toHaveLength(0);

      // Also works in reverse
      const path2 = registry.getMigrationPath("0.5.0", "0.5.0+somebuild");
      expect(path2).toHaveLength(0);
    });

    it("should handle pre-release versions correctly", () => {
      const registry = new MigrationRegistry();

      // Pre-release version (0.5.0-beta) is less than release version (0.5.0)
      // There should be a migration path from pre-release to release
      const pathFromPrerelease = registry.getMigrationPath("0.5.0-beta", "0.5.0");
      expect(pathFromPrerelease.length).toBeGreaterThan(0);

      // Release version (0.5.0) is greater than pre-release (0.5.0-beta)
      // No migration path should exist going backward
      const pathToPrerelease = registry.getMigrationPath("0.5.0", "0.5.0-beta");
      expect(pathToPrerelease).toHaveLength(0);
    });
  });

  describe("getLatestVersion", () => {
    it("should return the latest available version", () => {
      const registry = new MigrationRegistry();
      const latest = registry.getLatestVersion();
      expect(latest).toBe(getCliBundledSpecVersion());
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
      expect(path[path.length - 1].toVersion).toBe(getCliBundledSpecVersion());
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
      expect(registry.requiresMigration(getCliBundledSpecVersion())).toBe(false);
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

      expect(summary.targetVersion).toBe(getCliBundledSpecVersion());
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
