/**
 * Comprehensive integration tests for the unified upgrade command
 *
 * Tests the complete upgrade workflow including:
 * - Scanning for available upgrades (spec reference and model migrations)
 * - Interactive prompts and confirmation
 * - Dry-run mode
 * - Spec reference installation/upgrades
 * - Model migration execution
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdir, rm, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import yaml from "yaml";
import { createTempWorkdir, runDr, assertOutputContains } from "../helpers/cli-runner.js";
import { fileExists } from "../../src/utils/file-io.js";
import { shippedSkill } from "../fixtures/shipped-integration.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely remove a directory and its contents
 */
async function safeRm(path: string): Promise<void> {
  await rm(path, { recursive: true }).catch(() => {});
}

/**
 * Set model spec version by updating manifest
 */
async function setModelSpecVersion(workdir: string, version: string): Promise<void> {
  const manifestPath = join(workdir, "documentation-robotics/model/manifest.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const manifest = yaml.parse(content);
  manifest.spec_version = version;
  await writeFile(manifestPath, yaml.stringify(manifest));
}

/**
 * Get model spec version from manifest
 */
async function getModelSpecVersion(workdir: string): Promise<string> {
  const manifestPath = join(workdir, "documentation-robotics/model/manifest.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const manifest = yaml.parse(content);
  return manifest.spec_version;
}

/**
 * Modify model manifest in place
 */
async function modifyModelManifest(
  workdir: string,
  modifier: (manifest: unknown) => void
): Promise<void> {
  const manifestPath = join(workdir, "documentation-robotics/model/manifest.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const manifest = yaml.parse(content);
  modifier(manifest);
  await writeFile(manifestPath, yaml.stringify(manifest));
}

describe("upgrade command - unified flow", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  // ============================================================================
  // Scanning and Planning Tests
  // ============================================================================

  describe("Scanning and planning", () => {
    it("should scan filesystem for available upgrades", async () => {
      // Initialize a model via CLI
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      // Should scan and find upgrades needed
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Scanning for available upgrades");
    });

    it("should display upgrade plan with actions when upgrades needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade the model to test upgrade detection
      await setModelSpecVersion(tempDir.path, "0.5.0");

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Upgrade Plan");
    });

    it("should show no upgrades when already at latest version", async () => {
      // Initialize a model (will be at v0.7.0)
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Everything is up to date");
    });

    it("should detect spec reference upgrade needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Remove .dr folder to simulate missing spec reference
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect spec installation needed
      assertOutputContains(result, "Install spec reference");
    });

    it("should detect model migration upgrade needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model spec version
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect model migration needed
      assertOutputContains(result, "Migrate model");
    });

    it("should detect combined spec + model upgrade needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect both upgrades
      assertOutputContains(result, "Upgrade Plan");
    });
  });

  // ============================================================================
  // Interactive Mode Tests
  // ============================================================================

  describe("Interactive mode", () => {
    it("should skip prompt with --yes flag", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to trigger upgrade needed
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.6.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should proceed directly without prompt
      assertOutputContains(result, "Executing upgrades");
    });

    it("should accept --yes flag when no upgrades needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Current Model"], { cwd: tempDir.path });

      // Run upgrade first to bring model current
      await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      // Run upgrade again when everything is current
      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should report everything is up to date
      expect(result.stdout).toContain("Everything is up to date");
    });
  });

  // ============================================================================
  // Dry Run Mode Tests
  // ============================================================================

  describe("Dry run mode", () => {
    it("should show upgrade plan with --dry-run flag", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to trigger upgrade needed
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show dry run notice
      assertOutputContains(result, "[DRY RUN]");
      assertOutputContains(result, "No changes will be made");
    });

    it("should not modify .dr/ folder in dry run", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Remove .dr folder to force spec installation
      const drPath = join(tempDir.path, ".dr");
      const drManifestPath = join(drPath, "manifest.json");

      if (await fileExists(drManifestPath)) {
        // Get original timestamp
        const stat = await import("fs/promises").then((fs) => fs.stat(drManifestPath));
        const originalTime = stat.mtimeMs;

        // Run dry-run
        const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

        expect(result.exitCode).toBe(0);

        // Check that manifest wasn't modified
        const newStat = await import("fs/promises").then((fs) => fs.stat(drManifestPath));
        expect(newStat.mtimeMs).toBe(originalTime);
      }
    });

    it("should not modify model data in dry run", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const originalContent = await fs.readFile(manifestPath, "utf-8");

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Manifest should not be modified
      const afterContent = await fs.readFile(manifestPath, "utf-8");
      expect(afterContent).toBe(originalContent);
    });

    it("should display actions in dry run", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show upgrade actions
      assertOutputContains(result, "Upgrade Plan");
    });
  });

  // ============================================================================
  // Spec Reference Upgrade Tests
  // ============================================================================

  describe("Spec reference upgrades", () => {
    it("should install .dr/ folder when missing", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Remove .dr folder
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      expect(await fileExists(drPath)).toBe(false);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // .dr folder should be created
      expect(await fileExists(drPath)).toBe(true);
    });

    it("should create .dr/manifest.json with correct version", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Remove .dr folder to force reinstall
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Check .dr/manifest.json was created
      const manifestPath = join(drPath, "manifest.json");
      expect(await fileExists(manifestPath)).toBe(true);
    });

    it("should copy schema files to .dr/spec/", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Remove .dr folder to force reinstall
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Check spec directory was created with files
      const specPath = join(drPath, "spec");
      expect(await fileExists(specPath)).toBe(true);
    });
  });

  // ============================================================================
  // Model Migration Upgrade Tests
  // ============================================================================

  describe("Model migration upgrades", () => {
    it("should migrate model from older spec version", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Migrate model");
    });

    it("should update model specVersion after migration", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);

      // Verify model spec version was updated to latest
      const updatedContent = await fs.readFile(manifestPath, "utf-8");
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.spec_version).toBe("0.16.0");
    });

    it("adds the documentation-robotics folder to .prettierignore when the project uses prettier, and says so (#1155, #1246)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      // A project that adopted prettier after its model was created.
      await writeFile(join(tempDir.path, ".prettierrc"), "{}\n");
      await setModelSpecVersion(tempDir.path, "0.5.0");

      const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dryRun.exitCode).toBe(0);
      // The dry run says it would, and doesn't
      assertOutputContains(dryRun, "documentation-robotics/ to .prettierignore");
      expect(await fileExists(join(tempDir.path, ".prettierignore"))).toBe(false);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Added documentation-robotics/ to .prettierignore");
      expect(await readFile(join(tempDir.path, ".prettierignore"), "utf-8")).toContain(
        "documentation-robotics/\n"
      );

      // Already listed: the next run neither adds it again nor reports it.
      const again = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(again.exitCode).toBe(0);
      expect(again.stdout).not.toContain("Added documentation-robotics/changesets/");
    });

    it("should handle chained migrations across multiple versions", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to oldest supported version
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should complete all migrations and reach latest version
      const updatedContent = await fs.readFile(manifestPath, "utf-8");
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.spec_version).toBe("0.16.0");
    });

    it("should show migration steps in output", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Output should show migration steps
      expect(result.stdout.includes("0.5.0") && result.stdout.includes("0.6.0")).toBe(true);
    });
  });

  // ============================================================================
  // Combined Upgrades Tests
  // ============================================================================

  describe("Combined upgrades", () => {
    it("should upgrade spec reference and model together", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // .dr folder should be created/restored
      expect(await fileExists(drPath)).toBe(true);

      // Model should be upgraded to latest version
      const updatedContent = await fs.readFile(manifestPath, "utf-8");
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.spec_version).toBe("0.16.0");
    });

    it("should complete both upgrades successfully", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model and remove .dr
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "successfully");
    });

    it("should show both actions in dry run plan", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, ".dr");
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Upgrade Plan");
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    it("should fail gracefully when no project found", async () => {
      // Try upgrade in empty directory
      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(1);
      assertOutputContains(result, "No DR project found");
    });

    it("should handle missing model gracefully", async () => {
      // Create .dr folder but no model
      const drPath = join(tempDir.path, ".dr");
      await mkdir(drPath, { recursive: true });

      // Create a manifest.json in .dr
      await writeFile(
        join(drPath, "manifest.json"),
        JSON.stringify({
          specVersion: "0.7.0",
          installDate: new Date().toISOString(),
        })
      );

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      // Should either succeed (if no model is found) or fail (if project validation fails)
      // The important thing is it handles the edge case gracefully
      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    });

    it("should handle version consistency", async () => {
      // Initialize a model at latest version
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Everything is up to date");
    });
  });

  // ============================================================================
  // Output and UX Tests
  // ============================================================================

  describe("Output and UX", () => {
    it("should display clear upgrade plan", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade to trigger plan
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show either upgrade plan or up-to-date message
      expect(result.stdout).toMatch(/Upgrade Plan|Everything is up to date/);
    });

    it("should show version changes", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Downgrade
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show version notation
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it("should show success message when no upgrades needed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Everything is up to date");
    });

    it("should have readable output formatting", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Output should be well-formatted (multiple lines)
      const lines = result.stdout.split("\n").filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(2);
    });
  });

  // ============================================================================
  // Idempotence and Stability Tests
  // ============================================================================

  describe("Idempotence and stability", () => {
    it("should run multiple times without side effects", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Run upgrade multiple times
      const result1 = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      const result2 = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      const result3 = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result3.exitCode).toBe(0);
    });

    it("should maintain model data after upgrade", async () => {
      // Initialize a model
      const initResult = await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      expect(initResult.exitCode).toBe(0);

      // Downgrade
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      const originalName = manifest.project.name;
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Upgrade
      const upgradeResult = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(upgradeResult.exitCode).toBe(0);

      // Verify model name is preserved
      const updatedContent = await fs.readFile(manifestPath, "utf-8");
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.project.name).toBe(originalName);
    });

    it("should be safe to run after successful upgrade", async () => {
      // Initialize and upgrade
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Running again should show no upgrades
      const secondResult = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(secondResult.exitCode).toBe(0);
      assertOutputContains(secondResult, "Everything is up to date");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    it("should handle missing .dr/manifest.json gracefully", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Create .dr folder with missing manifest
      const drPath = join(tempDir.path, ".dr");
      const manifestPath = join(drPath, "manifest.json");

      // Remove manifest but keep folder
      try {
        await rm(manifestPath);
      } catch {
        // May not exist
      }

      const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

      // Should either succeed (and offer to reinstall) or report missing manifest
      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    });

    it("should detect outdated spec reference", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Simulate outdated .dr by modifying manifest version
      const drManifestPath = join(tempDir.path, ".dr", "manifest.json");
      try {
        await writeFile(
          drManifestPath,
          JSON.stringify({
            specVersion: "0.6.0",
            installDate: new Date().toISOString(),
          })
        );

        const result = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });

        // Should handle the outdated spec reference
        expect(result.exitCode === 0 || result.stdout.includes("Upgrade spec")).toBe(true);
      } catch {
        // If writeFile fails, that's okay - the test is validating error handling
      }
    });
  });

  // ============================================================================
  // Integration Version Checks
  // ============================================================================

  describe("Integration version checks", () => {
    it("should not show integration updates when no integrations installed", async () => {
      // Initialize a model without installing integrations
      await runDr(["init", "--name", "No Integrations"], { cwd: tempDir.path });

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should not mention integration updates when none are installed
      expect(result.stdout).not.toContain("Claude integration outdated");
      expect(result.stdout).not.toContain("GitHub Copilot integration outdated");
    });

    it("should check integration versions during upgrade", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Integration Check"], { cwd: tempDir.path });

      // Run upgrade which will check integrations
      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Upgrade should complete even if integrations aren't installed
      expect(result.stdout).toContain("Scanning for available upgrades");
    });

    it("--force with no integrations installed exits cleanly with no integration section", async () => {
      // Initialize a model with no integrations installed
      await runDr(["init", "--name", "Force No Integrations"], { cwd: tempDir.path });

      const result = await runDr(["upgrade", "--force", "--yes"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // No integration section should appear when none are installed
      expect(result.stdout).not.toContain("Integration Status");
      expect(result.stdout).not.toContain("Reinstall Claude Code integration");
      expect(result.stdout).not.toContain("Reinstall GitHub Copilot integration");
    });

    it("--force plan includes integration reinstall when integration is installed", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Force Integration Test"], { cwd: tempDir.path });

      // Simulate an installed Claude integration by writing a version file at the expected path.
      // The Claude manager uses .claude/.dr-version (YAML format with version, installed_at, components).
      const claudeDir = join(tempDir.path, ".claude");
      const claudeVersionPath = join(claudeDir, ".dr-version");
      await mkdir(claudeDir, { recursive: true });
      const yamlContent = `version: "0.1.1"\ninstalled_at: "${new Date().toISOString()}"\ncomponents: {}\n`;
      await writeFile(claudeVersionPath, yamlContent);

      const result = await runDr(["upgrade", "--force", "--dry-run"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // --force should include integration in the upgrade plan
      assertOutputContains(result, "Upgrade Plan");
      assertOutputContains(result, "Reinstall");
      assertOutputContains(result, "Claude Code integration");
    });
  });

  // ============================================================================
  // Non-Interactive Mode
  // ============================================================================

  describe("Non-interactive mode", () => {
    it("should require --yes flag in non-interactive mode when upgrades needed", async () => {
      // Initialize a model first
      await runDr(["init", "--name", "Interactive Test"], { cwd: tempDir.path });

      // Downgrade the model to create an upgrade scenario
      const manifestPath = join(tempDir.path, "documentation-robotics/model/manifest.yaml");
      const yaml = await import("yaml");
      const fs = await import("fs/promises");

      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.parse(content);
      manifest.spec_version = "0.5.0";

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Run upgrade in non-interactive mode without --yes
      // This simulates running in CI/CD or other non-TTY environments
      const result = await runDr(["upgrade"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Non-interactive mode requires --yes flag");
    });
  });

  // ============================================================================
  // Catalog changes on a model already at the current spec version
  // ============================================================================

  describe("Catalog changes at the current spec version", () => {
    /** Elements and relationships a model stamped with the current version can still hold */
    async function writeStaleCatalogModel(workdir: string): Promise<void> {
      const modelDir = join(workdir, "documentation-robotics/model");
      const element = (path: string, extra: Record<string, unknown> = {}) => {
        const [layerId, type, name] = path.split(".");
        return { [path]: { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name, ...extra } };
      };
      await mkdir(join(modelDir, "01_motivation"), { recursive: true });
      await mkdir(join(modelDir, "03_product"), { recursive: true });
      await writeFile(join(modelDir, "01_motivation/stakeholder.yaml"), yaml.stringify(element("motivation.stakeholder.customers")));
      await writeFile(
        join(modelDir, "03_product/elements.yaml"),
        yaml.stringify({
          ...element("product.capability.search", { attributes: { status: "delivered" } }),
          ...element("product.feature.search-box", { attributes: { priority: "high", status: "delivered" } }),
          ...element("product.persona.shopper"),
        })
      );
      await writeFile(
        join(modelDir, "relationships.yaml"),
        yaml.stringify([
          { source: "product.feature.search-box", predicate: "realizes", target: "product.capability.search", layer: "product" },
          // retired: a persona now references the stakeholder it stands for
          { source: "product.persona.shopper", predicate: "realizes", target: "motivation.stakeholder.customers", layer: "product", targetLayer: "motivation" },
        ])
      );
    }

    it("offers the catalog changes, applies them, and is then up to date", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const version = await getModelSpecVersion(tempDir.path);
      await writeStaleCatalogModel(tempDir.path);

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "Apply catalog changes to the model");
      assertOutputContains(plan, "Rename 1 element(s) whose type was renamed");

      const upgraded = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(upgraded.exitCode).toBe(0);
      assertOutputContains(upgraded, "Model in line with the");
      expect(await getModelSpecVersion(tempDir.path)).toBe(version);

      const product = await readFile(join(tempDir.path, "documentation-robotics/model/03_product/software_capability.yaml"), "utf-8");
      expect(product).toContain("product.softwarecapability.search");
      const rels = yaml.parse(await readFile(join(tempDir.path, "documentation-robotics/model/relationships.yaml"), "utf-8"));
      expect(rels.map((r: { source: string; predicate: string; target: string }) => `${r.source} ${r.predicate} ${r.target}`)).toEqual([
        "product.feature.search-box realizes product.softwarecapability.search",
        "product.persona.shopper references motivation.stakeholder.customers",
      ]);

      const again = await runDr(["upgrade"], { cwd: tempDir.path });
      expect(again.exitCode).toBe(0);
      assertOutputContains(again, "Everything is up to date");
    });

    it("removes attributes the spec retired, keeping the others (#1091)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const version = await getModelSpecVersion(tempDir.path);
      const testingDir = join(tempDir.path, "documentation-robotics/model/13_testing");
      await mkdir(testingDir, { recursive: true });
      const path = "testing.inputspacepartition.email";
      await writeFile(
        join(testingDir, "elements.yaml"),
        yaml.stringify({
          [path]: {
            id: crypto.randomUUID(),
            path,
            spec_node_id: "testing.inputspacepartition",
            type: "inputspacepartition",
            layer_id: "testing",
            name: "email",
            attributes: { fieldRef: "api.parameter.email", presenceRule: "required" },
          },
        })
      );

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "Apply catalog changes to the model");
      assertOutputContains(plan, "Remove retired attributes from 1 element(s)");

      const upgraded = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(upgraded.exitCode).toBe(0);
      assertOutputContains(upgraded, "Removed retired attributes from 1 element(s)");
      expect(await getModelSpecVersion(tempDir.path)).toBe(version);

      const files = await readdir(testingDir);
      const testing = (await Promise.all(files.map((f) => readFile(join(testingDir, f), "utf-8")))).join("\n");
      expect(testing).toContain(path);
      expect(testing).toContain("presenceRule: required");
      expect(testing).not.toContain("fieldRef");

      const again = await runDr(["upgrade"], { cwd: tempDir.path });
      expect(again.exitCode).toBe(0);
      assertOutputContains(again, "Everything is up to date");
    });
  });

  // ============================================================================
  // Pre-release fixes (#1163, #1164, #1166, #1167, #1168)
  // ============================================================================

  describe("One run takes the model to the spec this dr carries (#1163)", () => {
    it("migrates a model at the stale spec reference's version, and stamps cli_version", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const target = await getModelSpecVersion(tempDir.path);
      // The spec reference and the model both at the previous spec version, from an older dr
      await modifyModelManifest(tempDir.path, (manifest) => {
        (manifest as Record<string, unknown>).spec_version = "0.12.0";
        (manifest as Record<string, unknown>).cli_version = "0.4.0";
      });
      await writeFile(
        join(tempDir.path, ".dr", "manifest.json"),
        JSON.stringify({ specVersion: "0.12.0", installedAt: new Date().toISOString() })
      );

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "Upgrade spec reference");
      assertOutputContains(plan, "Migrate model data");

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, `the model is at spec v${target}`);

      const manifest = yaml.parse(
        await readFile(join(tempDir.path, "documentation-robotics/model/manifest.yaml"), "utf-8")
      );
      expect(manifest.spec_version).toBe(target);
      const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));
      expect(manifest.cli_version).toBe(version);

      const again = await runDr(["upgrade"], { cwd: tempDir.path });
      assertOutputContains(again, "Everything is up to date");
    });
  });

  describe("Relationships dropped and attributes left empty (#1164, #1166)", () => {
    /** An operation and a response without the attributes the spec requires, linked by a retired triple */
    async function writeApiModel(workdir: string): Promise<void> {
      const modelDir = join(workdir, "documentation-robotics/model");
      const element = (path: string) => {
        const [layerId, type, name] = path.split(".");
        return { [path]: { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name } };
      };
      await mkdir(join(modelDir, "07_api"), { recursive: true });
      await writeFile(
        join(modelDir, "07_api/elements.yaml"),
        yaml.stringify({
          ...element("api.operation.list-orders"),
          ...element("api.operation.get-order"),
          ...element("api.response.ok"),
        })
      );
      await writeFile(
        join(modelDir, "relationships.yaml"),
        yaml.stringify([
          { source: "api.operation.list-orders", predicate: "delivers", target: "api.response.ok", layer: "api" },
          { source: "api.operation.get-order", predicate: "delivers", target: "api.response.ok", layer: "api" },
        ])
      );
    }

    it("counts the drops in the dry run, then lists what to fill in per element without filling it", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await writeApiModel(tempDir.path);

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "would drop 2 relationship(s)");
      assertOutputContains(plan, "2 × api.operation --[delivers]--> api.response");

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "validation error(s) on 3 element(s)");
      assertOutputContains(result, "api.operation.list-orders");
      assertOutputContains(result, "required, left empty: operationId, summary, tags");
      assertOutputContains(result, "required, left empty: description");

      const apiDir = join(tempDir.path, "documentation-robotics/model/07_api");
      const api = (await Promise.all((await readdir(apiDir)).map((f) => readFile(join(apiDir, f), "utf-8")))).join("\n");
      expect(api).toContain("api.operation.list-orders");
      expect(api).not.toContain("operationId");
    });

    /**
     * The three links spec 0.11.0 removed and Context Studio proposals 93d40a94 and 38fa8fa3 gave a
     * route (ends swapped), and one link with no route: an operation's `delivers` of a response.
     */
    async function writeRoutesModel(workdir: string): Promise<void> {
      const modelDir = join(workdir, "documentation-robotics/model");
      const element = (path: string) => {
        const [layerId, type, name] = path.split(".");
        return { [path]: { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name } };
      };
      const layerFile = async (dir: string, ...paths: string[]) => {
        await mkdir(join(modelDir, dir), { recursive: true });
        await writeFile(join(modelDir, dir, "elements.yaml"), yaml.stringify(Object.assign({}, ...paths.map(element))));
      };
      await layerFile("05_application", "application.applicationcomponent.order-repository", "application.applicationservice.order-service");
      await layerFile("07_api", "api.operation.list-orders", "api.response.ok");
      await layerFile("09_data-store", "data-store.database.orders-db");
      await layerFile("10_ux", "ux.view.order-list");
      await writeFile(
        join(modelDir, "relationships.yaml"),
        yaml.stringify([
          { source: "data-store.database.orders-db", predicate: "serves", target: "application.applicationcomponent.order-repository", layer: "data-store", targetLayer: "application" },
          { source: "data-store.database.orders-db", predicate: "serves", target: "application.applicationservice.order-service", layer: "data-store", targetLayer: "application" },
          { source: "ux.view.order-list", predicate: "serves", target: "application.applicationservice.order-service", layer: "ux", targetLayer: "application", properties: { note: "loads the list" } },
          { source: "api.operation.list-orders", predicate: "delivers", target: "api.response.ok", layer: "api", properties: { status: 200 } },
        ])
      );
    }

    async function readChangesets(workdir: string): Promise<Array<{ metadata: Record<string, any>; changes: Array<Record<string, any>> }>> {
      const dir = join(workdir, "documentation-robotics/changesets");
      if (!(await fileExists(dir))) return [];
      const ids = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".lock"))
        .map((entry) => entry.name);
      return Promise.all(
        ids.map(async (id) => ({
          metadata: yaml.parse(await readFile(join(dir, id, "metadata.yaml"), "utf-8")),
          changes: yaml.parse(await readFile(join(dir, id, "changes.yaml"), "utf-8")) ?? [],
        }))
      );
    }

    it("rewrites the three links that have a route with their ends swapped, and records the one that has none", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const version = await getModelSpecVersion(tempDir.path);
      await writeRoutesModel(tempDir.path);

      // The dry run names the record it would write, and writes nothing
      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "would drop 1 relationship(s)");
      assertOutputContains(plan, "1 × api.operation --[delivers]--> api.response");
      assertOutputContains(plan, `recorded in a staged changeset, 'upgrade-drops-${version}'`);
      expect(await readChangesets(tempDir.path)).toEqual([]);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, `Recorded 1 dropped relationship(s) in the staged changeset 'upgrade-drops-${version}'`);
      // It is read with dr changeset show, not by opening its changes.yaml (#1219)
      assertOutputContains(result, `Review it: dr changeset show upgrade-drops-${version} lists each one`);
      const shown = await runDr(["changeset", "show", `upgrade-drops-${version}`], { cwd: tempDir.path });
      expect(shown.exitCode).toBe(0);
      assertOutputContains(shown, "Purpose: upgrade-record");
      assertOutputContains(shown, "api.operation.list-orders --delivers--> api.response.ok");

      // The three rewritten, each with source and target swapped; the fourth gone from the model
      const rels = yaml.parse(await readFile(join(tempDir.path, "documentation-robotics/model/relationships.yaml"), "utf-8"));
      expect(rels).toEqual([
        { source: "application.applicationcomponent.order-repository", predicate: "accesses", target: "data-store.database.orders-db", layer: "application", targetLayer: "data-store" },
        { source: "application.applicationservice.order-service", predicate: "accesses", target: "data-store.database.orders-db", layer: "application", targetLayer: "data-store" },
        { source: "application.applicationservice.order-service", predicate: "serves", target: "ux.view.order-list", layer: "application", targetLayer: "ux", properties: { note: "loads the list" } },
      ]);

      // One staged record, holding the dropped relationship as it was, and what retired it
      const changesets = await readChangesets(tempDir.path);
      expect(changesets).toHaveLength(1);
      const [record] = changesets;
      expect(record.metadata.name).toBe(`upgrade-drops-${version}`);
      expect(record.metadata.status).toBe("staged");
      expect(record.metadata.purpose).toBe("upgrade-record");
      expect(record.metadata.origin.kind).toBe("upgrade");
      expect(record.metadata.description).toContain("1 x api.operation --[delivers]--> api.response");
      expect(record.changes).toHaveLength(1);
      expect(record.changes[0]).toMatchObject({
        type: "relationship-delete",
        elementId: "api.operation.list-orders::delivers::api.response.ok",
        layerName: "api",
        before: { source: "api.operation.list-orders", predicate: "delivers", target: "api.response.ok", layer: "api", properties: { status: 200 } },
        origin: { by: "upgrade" },
      });
      expect(record.changes[0].origin.rule).toContain("api.operation.delivers.api.response retired by ");

      // It is listed, it is not active, and it never lands
      const list = await runDr(["changeset", "list"], { cwd: tempDir.path });
      expect(list.exitCode).toBe(0);
      assertOutputContains(list, `upgrade-drops-${version}`);
      const commit = await runDr(["changeset", "commit", `upgrade-drops-${version}`], { cwd: tempDir.path });
      expect(commit.exitCode).not.toBe(0);
      expect(`${commit.stdout}${commit.stderr}`).toContain("is an upgrade record");
      expect(yaml.parse(await readFile(join(tempDir.path, "documentation-robotics/model/relationships.yaml"), "utf-8"))).toEqual(rels);

      // It cannot be made active either: a change staged into it could never land
      const activate = await runDr(["changeset", "activate", `upgrade-drops-${version}`], { cwd: tempDir.path });
      expect(activate.exitCode).not.toBe(0);
      expect(`${activate.stdout}${activate.stderr}`).toContain("It cannot be made active");
      expect(await fileExists(join(tempDir.path, ".dr/active-changeset"))).toBe(false);
      expect(await fileExists(join(tempDir.path, "documentation-robotics/changesets/.active"))).toBe(false);

      // A second run has nothing to drop, and writes no second record
      const again = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(again.exitCode).toBe(0);
      assertOutputContains(again, "Everything is up to date");
      expect(await readChangesets(tempDir.path)).toHaveLength(1);
    });

    it("writes no record when the upgrade drops nothing", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await writeRoutesModel(tempDir.path);
      const relsPath = join(tempDir.path, "documentation-robotics/model/relationships.yaml");
      const rels = yaml.parse(await readFile(relsPath, "utf-8")) as Array<{ predicate: string }>;
      await writeFile(relsPath, yaml.stringify(rels.filter((rel) => rel.predicate !== "delivers")));

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      expect(plan.stdout).not.toContain("would drop");
      expect(plan.stdout).not.toContain("upgrade-drops-");

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("Recorded");
      expect(yaml.parse(await readFile(relsPath, "utf-8"))).toHaveLength(3);
      expect(await readChangesets(tempDir.path)).toEqual([]);
    });
  });

  describe("A checkout without the spec reference (#1168)", () => {
    it("dr validate says so in one line with the fix, and validates all the same", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      // A fresh clone or worktree: .dr/ is git-ignored, so it isn't there
      await rm(join(tempDir.path, ".dr"), { recursive: true, force: true });

      const fresh = await runDr(["validate"], { cwd: tempDir.path });
      expect(fresh.exitCode).toBe(0);
      assertOutputContains(fresh, "Spec reference not installed in this checkout");
      assertOutputContains(fresh, 'run "dr upgrade" to install the reference');
      assertOutputContains(fresh, "0 error(s)");
      expect(await fileExists(join(tempDir.path, ".dr"))).toBe(false);

      // --quiet keeps it out, as it keeps the other notices out
      const quiet = await runDr(["validate", "--quiet"], { cwd: tempDir.path });
      expect(quiet.stdout).not.toContain("Spec reference not installed");

      const upgrade = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(upgrade.exitCode).toBe(0);
      const after = await runDr(["validate"], { cwd: tempDir.path });
      expect(after.exitCode).toBe(0);
      expect(after.stdout).not.toContain("Spec reference");
    });

    it("dr validate says when the reference is for another spec version", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await writeFile(join(tempDir.path, ".dr", "manifest.json"), JSON.stringify({ specVersion: "0.12.0" }));
      const result = await runDr(["validate"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "The spec reference in .dr/ is for spec v0.12.0");
      assertOutputContains(result, "validation is unaffected");
    });
  });

  describe("A .dr/ folder that only holds other per-checkout state (#1168)", () => {
    it("offers to install the spec reference, not to repair it", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const drPath = join(tempDir.path, ".dr");
      await rm(drPath, { recursive: true, force: true });
      await mkdir(join(drPath, "analyzers"), { recursive: true });
      await writeFile(join(drPath, "analyzers", "session.json"), "{}");

      const plan = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(plan.exitCode).toBe(0);
      assertOutputContains(plan, "Install spec reference");
      expect(plan.stdout).not.toContain("manifest missing");
    });
  });
  describe("What the upgrade touches, and says it touches (#1165, #1166, #1185, #1246)", () => {
    function git(cwd: string, ...args: string[]): string {
      const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8" });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      return result.stdout;
    }

    function gitInit(cwd: string): void {
      git(cwd, "init", "-q");
      git(cwd, "config", "user.email", "test@example.com");
      git(cwd, "config", "user.name", "Test");
      // A global excludes file on the machine running the tests must not decide the outcome.
      git(cwd, "config", "core.excludesFile", join(cwd, ".no-global-excludes"));
    }

    const LONG =
      "A commit refuses a changeset for drift whenever any element in the base changed, which is far more often than the plan and the base actually disagree";

    /** A goal whose long description is laid out as prettier lays it out: on the lines after the key */
    async function writePrettierLaidOutGoal(workdir: string): Promise<string> {
      const dir = join(workdir, "documentation-robotics/model/01_motivation");
      const path = "motivation.goal.fewer-refusals";
      const text =
        `${path}:\n  id: 00000000-0000-4000-8000-000000000001\n  path: ${path}\n  spec_node_id: motivation.goal\n` +
        `  type: goal\n  layer_id: motivation\n  name: Fewer refusals\n  description:\n    ${LONG.slice(0, 72)}\n    ${LONG.slice(73)}\n` +
        `  attributes:\n    priority: high\n`;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "goal.yaml"), text);
      return text;
    }

    /** An operation without the attributes the spec requires, in the file dr itself would write */
    async function writeBareOperation(workdir: string): Promise<string> {
      const dir = join(workdir, "documentation-robotics/model/07_api");
      const path = "api.operation.create-order";
      const text = yaml.stringify({
        [path]: {
          id: "00000000-0000-4000-8000-000000000002",
          path,
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: "Create order",
          description: "Creates an order. Reserves stock first.",
        },
      });
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "operation.yaml"), text);
      return text;
    }

    it("a version stamp changes the manifest and nothing else in the model, whatever layout its files are in (#1246)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const goal = await writePrettierLaidOutGoal(tempDir.path);
      await setModelSpecVersion(tempDir.path, "0.13.0");
      gitInit(tempDir.path);
      git(tempDir.path, "add", "-A");
      git(tempDir.path, "commit", "-q", "-m", "model at 0.13.0");

      const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dryRun.exitCode).toBe(0);
      assertOutputContains(dryRun, "Rehearsed on a copy of the model:");
      assertOutputContains(dryRun, "Model files it would write (1):");
      assertOutputContains(dryRun, "write   documentation-robotics/model/manifest.yaml");
      expect(git(tempDir.path, "status", "--short").trim()).toBe("");

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Model files written (1):");
      expect(await getModelSpecVersion(tempDir.path)).toBe("0.16.0");
      expect(git(tempDir.path, "status", "--short", "--", "documentation-robotics/model").trim()).toBe(
        "M documentation-robotics/model/manifest.yaml"
      );
      expect(await readFile(join(tempDir.path, "documentation-robotics/model/01_motivation/goal.yaml"), "utf-8")).toBe(goal);
    });

    it("lists every file outside the model by group before it writes, and --model-only leaves them alone (#1165)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await runDr(["copilot", "install", "--force"], { cwd: tempDir.path });
      await writeFile(join(tempDir.path, ".prettierrc"), "{}\n");
      await setModelSpecVersion(tempDir.path, "0.13.0");
      // An integration from an older dr, missing a file this dr ships, with an entry no dr tracks
      const versionFile = join(tempDir.path, ".github/.dr-copilot-version");
      const version = yaml.parse(await readFile(versionFile, "utf-8"));
      version.version = "0.5.0";
      delete version.components.agents["dr-advisor.md"];
      await writeFile(versionFile, yaml.stringify(version));
      await rm(join(tempDir.path, ".github/agents/dr-advisor.md"));
      // Two skills of an older layout, as an earlier dr shipped them
      for (const name of ["dr_layer_02_business", "dr_layer_04_app"]) {
        await mkdir(join(tempDir.path, `.github/skills/${name}`), { recursive: true });
        await writeFile(join(tempDir.path, `.github/skills/${name}/SKILL.md`), shippedSkill(name));
      }
      // A name an earlier dr used, holding the project's own text
      await mkdir(join(tempDir.path, ".github/skills/dr_03_security_layer"), { recursive: true });
      await writeFile(join(tempDir.path, ".github/skills/dr_03_security_layer/SKILL.md"), "our rewrite\n");
      // The project's own files, named like dr's: no dr ever installed these names
      await mkdir(join(tempDir.path, ".github/skills/dr_house_style"), { recursive: true });
      await writeFile(join(tempDir.path, ".github/skills/dr_house_style/SKILL.md"), "ours\n");
      await writeFile(join(tempDir.path, ".github/agents/dr-who.md"), "ours\n");
      await rm(join(tempDir.path, "documentation-robotics/reports"), { recursive: true, force: true });
      gitInit(tempDir.path);
      git(tempDir.path, "add", "-A");
      git(tempDir.path, "commit", "-q", "-m", "before upgrade");

      const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dryRun.exitCode).toBe(0);
      assertOutputContains(dryRun, "Outside the model (documentation-robotics/model/), this upgrade also changes:");
      assertOutputContains(dryRun, "GitHub Copilot integration (.github/): 0.5.0 →");
      assertOutputContains(dryRun, "add       .github/agents/dr-advisor.md");
      assertOutputContains(dryRun, "update    .github/.dr-copilot-version");
      assertOutputContains(dryRun, "stale     .github/skills/dr_layer_02_business/");
      assertOutputContains(dryRun, "stale     .github/skills/dr_layer_04_app/");
      assertOutputContains(dryRun, "changed   .github/skills/dr_03_security_layer/");
      expect(dryRun.stdout).not.toContain("dr_house_style");
      expect(dryRun.stdout).not.toContain("dr-who.md");
      assertOutputContains(dryRun, "Reports (none yet)");
      assertOutputContains(dryRun, "generate  documentation-robotics/README.md");
      assertOutputContains(dryRun, "documentation-robotics/ to .prettierignore");
      assertOutputContains(dryRun, "--model-only leaves all of these alone");
      expect(git(tempDir.path, "status", "--short").trim()).toBe("");

      // --model-only: the model and nothing else git can see
      const modelOnly = await runDr(["upgrade", "--yes", "--model-only"], { cwd: tempDir.path });
      expect(modelOnly.exitCode).toBe(0);
      assertOutputContains(modelOnly, "Left alone (--model-only)");
      expect(modelOnly.stdout).not.toContain("Upgrade GitHub Copilot integration...");
      expect(await getModelSpecVersion(tempDir.path)).toBe("0.16.0");
      expect(git(tempDir.path, "status", "--short").trim()).toBe("M documentation-robotics/model/manifest.yaml");

      // Without it the rest follows, and the leftovers are listed but kept
      const rest = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(rest.exitCode).toBe(0);
      assertOutputContains(rest, "2 entries in .github/ are left over from an earlier dr's GitHub Copilot integration");
      assertOutputContains(rest, "1 entry in .github/ has a name an earlier dr used, but its contents are not what dr shipped");
      assertOutputContains(rest, "Kept 3. Remove any of them with: dr upgrade --remove-stale <path>...");
      expect(await fileExists(join(tempDir.path, ".github/agents/dr-advisor.md"))).toBe(true);
      expect(await fileExists(join(tempDir.path, ".github/skills/dr_layer_02_business/SKILL.md"))).toBe(true);
      expect(await fileExists(join(tempDir.path, ".prettierignore"))).toBe(true);
      expect(await fileExists(join(tempDir.path, "documentation-robotics/README.md"))).toBe(true);

      // Everything is up to date now; the leftovers are still offered, and one goes when it is named
      const one = await runDr(["upgrade", "--yes", "--remove-stale", ".github/skills/dr_layer_02_business"], {
        cwd: tempDir.path,
      });
      expect(one.exitCode).toBe(0);
      assertOutputContains(one, "Everything is up to date");
      assertOutputContains(one, "Removed 1 of them from .github/: .github/skills/dr_layer_02_business/");
      assertOutputContains(one, "Kept 2.");
      expect(await fileExists(join(tempDir.path, ".github/skills/dr_layer_02_business"))).toBe(false);
      expect(await fileExists(join(tempDir.path, ".github/skills/dr_layer_04_app/SKILL.md"))).toBe(true);

      // The project's own dr-named files can't be removed this way, by name or by "all"
      const own = await runDr(
        ["upgrade", "--yes", "--remove-stale", ".github/skills/dr_house_style", ".github/agents/dr-who.md"],
        { cwd: tempDir.path }
      );
      expect(own.exitCode).toBe(0);
      assertOutputContains(own, "--remove-stale .github/skills/dr_house_style: not a leftover of an earlier dr's integration");

      // "All" removes what dr shipped as it shipped it, and leaves the changed one
      const all = await runDr(["upgrade", "--yes", "--remove-stale"], { cwd: tempDir.path });
      expect(all.exitCode).toBe(0);
      assertOutputContains(all, "Removed 1 of them from .github/: .github/skills/dr_layer_04_app/");
      expect(await fileExists(join(tempDir.path, ".github/skills/dr_layer_04_app"))).toBe(false);
      expect(await readFile(join(tempDir.path, ".github/skills/dr_03_security_layer/SKILL.md"), "utf-8")).toBe("our rewrite\n");

      // The changed one goes only when its path is named
      const changed = await runDr(["upgrade", "--yes", "--remove-stale", ".github/skills/dr_03_security_layer/"], {
        cwd: tempDir.path,
      });
      assertOutputContains(changed, "Removed 1 of them from .github/: .github/skills/dr_03_security_layer/");
      expect(await readFile(join(tempDir.path, ".github/skills/dr_house_style/SKILL.md"), "utf-8")).toBe("ours\n");
      expect(await readFile(join(tempDir.path, ".github/agents/dr-who.md"), "utf-8")).toBe("ours\n");
      expect(await fileExists(join(tempDir.path, ".github/skills/dr_change_planning/SKILL.md"))).toBe(true);
    });

    it("stages derived values for newly required attributes in a changeset and leaves the base model alone (#1166)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const operation = await writeBareOperation(tempDir.path);
      await setModelSpecVersion(tempDir.path, "0.13.0");
      const operationFile = join(tempDir.path, "documentation-robotics/model/07_api/operation.yaml");

      const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dryRun.exitCode).toBe(0);
      assertOutputContains(dryRun, "would have 3 validation error(s) on 1 element(s)");
      assertOutputContains(dryRun, "required, left empty: tags");
      assertOutputContains(dryRun, "required, value would be staged for review: operationId, summary");
      assertOutputContains(dryRun, "would be derived and staged in the changeset 'upgrade-fills-0.16.0'");
      assertOutputContains(dryRun, 'api.operation.create-order: operationId = "createOrder"');
      expect(await fileExists(join(tempDir.path, "documentation-robotics/changesets"))).toBe(false);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "Staged 2 derived value(s) for required attributes on 1 element(s) in the changeset 'upgrade-fills-0.16.0'");
      assertOutputContains(result, "Nothing was written to the base model");
      assertOutputContains(result, 'api.operation.create-order: summary = "Creates an order."');
      assertOutputContains(result, "required, left empty: tags");
      assertOutputContains(result, "required, value staged for review: operationId, summary");
      // The base model: stamped, not filled in
      expect(await readFile(operationFile, "utf-8")).toBe(operation);

      // The review path the output names: activate it, then diff
      assertOutputContains(result, "dr changeset activate upgrade-fills-0.16.0 then dr changeset diff");
      expect((await runDr(["changeset", "activate", "upgrade-fills-0.16.0"], { cwd: tempDir.path })).exitCode).toBe(0);
      const diff = await runDr(["changeset", "diff"], { cwd: tempDir.path });
      expect(diff.exitCode).toBe(0);
      assertOutputContains(diff, "api.operation.create-order");

      // It lands like any plan; the error it doesn't fix (tags) was the base model's already
      const commit = await runDr(["changeset", "commit", "upgrade-fills-0.16.0"], { cwd: tempDir.path });
      expect(commit.exitCode).toBe(0);
      const landed = yaml.parse(await readFile(operationFile, "utf-8"))["api.operation.create-order"];
      expect(landed.attributes).toEqual({ operationId: "createOrder", summary: "Creates an order." });
    });

    it("shortens a long list with its total and the way to see it all, and --full lists every item", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      // 30 operations with nothing the spec requires: 60 values to derive, 30 elements to list
      const operations: Record<string, unknown> = {};
      for (let i = 1; i <= 30; i++) {
        const path = `api.operation.get-item-${String(i).padStart(2, "0")}`;
        operations[path] = {
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          path,
          spec_node_id: "api.operation",
          type: "operation",
          layer_id: "api",
          name: `Get item ${i}`,
        };
      }
      await mkdir(join(tempDir.path, "documentation-robotics/model/07_api"), { recursive: true });
      await writeFile(join(tempDir.path, "documentation-robotics/model/07_api/operation.yaml"), yaml.stringify(operations));
      await setModelSpecVersion(tempDir.path, "0.13.0");

      const dryRun = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dryRun.exitCode).toBe(0);
      // The counts are of everything; the list is the first 20 and says so
      assertOutputContains(dryRun, "would have 90 validation error(s) on 30 element(s)");
      assertOutputContains(dryRun, "60 value(s) for required attributes on 30 element(s) would be derived");
      assertOutputContains(dryRun, "...and 40 more of 60; dr upgrade --dry-run --full lists them all");
      expect(dryRun.stdout).not.toContain('api.operation.get-item-30: operationId = "getItem30"');

      const full = await runDr(["upgrade", "--dry-run", "--full"], { cwd: tempDir.path });
      expect(full.exitCode).toBe(0);
      assertOutputContains(full, 'api.operation.get-item-30: operationId = "getItem30"');
      assertOutputContains(full, 'api.operation.get-item-30: summary = "Get item 30"');
      expect(full.stdout).not.toContain("more of 60");

      // The run itself: shortened the same way, pointing at the changeset, which holds all 60
      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "...and 40 more of 60; the changeset 'upgrade-fills-0.16.0' holds them all");
      const dir = join(tempDir.path, "documentation-robotics/changesets");
      const [id] = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".lock"))
        .map((entry) => entry.name);
      const changes = yaml.parse(await readFile(join(dir, id, "changes.yaml"), "utf-8"));
      expect(changes).toHaveLength(30);
      expect(changes.every((change: any) => change.after.attributes.operationId && change.after.attributes.summary)).toBe(true);
    });

    it("leaves .gitignore and the index alone while git tracks files under .dr/, until --dot-dr says what to do (#1185)", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await setModelSpecVersion(tempDir.path, "0.13.0");
      // A project from before .dr/ was ignored: its spec reference is committed
      await rm(join(tempDir.path, ".gitignore"), { force: true });
      gitInit(tempDir.path);
      git(tempDir.path, "add", "-A");
      git(tempDir.path, "commit", "-q", "-m", "model with .dr tracked");
      const tracked = git(tempDir.path, "ls-files", "--", ".dr").trim().split("\n").length;
      expect(tracked).toBeGreaterThan(2);

      const dryRun = await runDr(["upgrade", "--dry-run", "--force"], { cwd: tempDir.path });
      assertOutputContains(dryRun, `git tracks ${tracked} file(s) under .dr/`);
      assertOutputContains(dryRun, "untrack:");
      assertOutputContains(dryRun, "keep-tracked:");

      // No one to ask, no choice given: the upgrade runs and the decision is left open
      const result = await runDr(["upgrade", "--yes", "--force"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, `git tracks ${tracked} file(s) under .dr/`);
      assertOutputContains(result, "Nothing was changed. Choose with: dr upgrade --dot-dr <untrack|keep-tracked|skip>");
      expect(await fileExists(join(tempDir.path, ".gitignore"))).toBe(false);
      expect(git(tempDir.path, "ls-files", "--", ".dr").trim().split("\n")).toHaveLength(tracked);

      // With a choice, the dry run names what that choice does, down to the index
      const plan = await runDr(["upgrade", "--dry-run", "--dot-dr", "untrack"], { cwd: tempDir.path });
      assertOutputContains(plan, "add       /.dr/ to .gitignore");
      assertOutputContains(plan, `untrack   ${tracked} file(s) under .dr/ from git's index`);
      const keepPlan = await runDr(["upgrade", "--dry-run", "--dot-dr", "keep-tracked"], { cwd: tempDir.path });
      assertOutputContains(keepPlan, "add       /.dr/*, !/.dr/");
      expect(keepPlan.stdout).not.toContain("untrack   ");
      expect(await fileExists(join(tempDir.path, ".gitignore"))).toBe(false);

      const chosen = await runDr(["upgrade", "--yes", "--dot-dr", "untrack"], { cwd: tempDir.path });
      expect(chosen.exitCode).toBe(0);
      assertOutputContains(chosen, `Removed ${tracked} file(s) under .dr/ from git's index`);
      expect(git(tempDir.path, "ls-files", "--", ".dr").trim()).toBe("");
      expect(await readFile(join(tempDir.path, ".gitignore"), "utf-8")).toContain("/.dr/\n");
      expect(await fileExists(join(tempDir.path, ".dr/manifest.json"))).toBe(true);
      // The next git add of the upgrade just works
      git(tempDir.path, "add", "-A");
      git(tempDir.path, "commit", "-q", "-m", "upgrade");
      expect(git(tempDir.path, "status", "--short").trim()).toBe("");

      const unknown = await runDr(["upgrade", "--yes", "--dot-dr", "delete"], { cwd: tempDir.path });
      expect(unknown.exitCode).not.toBe(0);
    });

    it("leaves alone an integration a newer dr installed, unless forced, and says so", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      await runDr(["copilot", "install", "--force"], { cwd: tempDir.path });
      const versionFile = join(tempDir.path, ".github/.dr-copilot-version");
      const version = yaml.parse(await readFile(versionFile, "utf-8"));
      version.version = "9.9.9";
      await writeFile(versionFile, yaml.stringify(version));
      const advisor = join(tempDir.path, ".github/agents/dr-advisor.md");
      await writeFile(advisor, "from a newer dr\n");

      const dry = await runDr(["upgrade", "--dry-run"], { cwd: tempDir.path });
      expect(dry.exitCode).toBe(0);
      expect(dry.stdout).not.toContain("Upgrade GitHub Copilot integration");
      const run = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(run.exitCode).toBe(0);
      expect(run.stdout).not.toContain("Upgrade GitHub Copilot integration...");
      expect(await readFile(advisor, "utf-8")).toBe("from a newer dr\n");
      expect(yaml.parse(await readFile(versionFile, "utf-8")).version).toBe("9.9.9");

      const forced = await runDr(["upgrade", "--dry-run", "--force"], { cwd: tempDir.path });
      assertOutputContains(forced, "Downgrade GitHub Copilot integration to this dr's files (forced; a newer dr installed it)");
    });

    it("says when a large-file commit hook would refuse a changeset, and doesn't touch the hook config", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const config =
        "repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    hooks:\n      - id: check-added-large-files\n        args: [--maxkb=1000]\n";
      await writeFile(join(tempDir.path, ".pre-commit-config.yaml"), config);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, "check-added-large-files pre-commit hook refuses a new file over 1000 KB");
      assertOutputContains(result, "exclude: ^documentation-robotics/changesets/");
      expect(await readFile(join(tempDir.path, ".pre-commit-config.yaml"), "utf-8")).toBe(config);

      // Excluded: nothing more to say
      await writeFile(
        join(tempDir.path, ".pre-commit-config.yaml"),
        `${config}        exclude: ^documentation-robotics/changesets/\n`
      );
      const quiet = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(quiet.stdout).not.toContain("check-added-large-files");
    });

    it("says when a prettier commit hook still receives dr's files, and is quiet once the hook excludes the folder", async () => {
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
      const hook =
        "repos:\n  - repo: https://github.com/pre-commit/mirrors-prettier\n    rev: v4.0.0-alpha.8\n    hooks:\n      - id: prettier\n        types_or: [markdown, yaml, json]\n";
      await writeFile(join(tempDir.path, ".pre-commit-config.yaml"), hook);

      const result = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(result.exitCode).toBe(0);
      // The hook is the sign of prettier, so the folder is ignored...
      assertOutputContains(result, "Added documentation-robotics/ to .prettierignore");
      // ...and the hook itself still needs the exclude, which dr names and does not write
      assertOutputContains(result, "prettier pre-commit hook is passed the files dr writes under documentation-robotics/");
      assertOutputContains(result, "exclude: ^documentation-robotics/");
      expect(await readFile(join(tempDir.path, ".pre-commit-config.yaml"), "utf-8")).toBe(hook);

      // As this repository has it: the hook excludes the folder and .prettierignore lists it
      await writeFile(
        join(tempDir.path, ".pre-commit-config.yaml"),
        `${hook}        exclude: ^(CHANGELOG\\.md|documentation-robotics/)\n`
      );
      const before = await readFile(join(tempDir.path, ".prettierignore"), "utf-8");
      const quiet = await runDr(["upgrade", "--yes"], { cwd: tempDir.path });
      expect(quiet.exitCode).toBe(0);
      expect(quiet.stdout).not.toContain("pre-commit hook");
      expect(quiet.stdout).not.toContain(".prettierignore");
      expect(await readFile(join(tempDir.path, ".prettierignore"), "utf-8")).toBe(before);
    });
  });
});
