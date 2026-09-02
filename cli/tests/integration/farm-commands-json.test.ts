/**
 * Farm Commands JSON Output Tests
 * Tests that farm subcommands produce valid JSON output when --format json is used
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, ensureDir, writeFile } from "../../src/utils/file-io.js";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { execSync } from "child_process";

describe("Farm Commands - JSON Output Format", () => {
  let farmDir: string;
  let farmYamlPath: string;

  beforeEach(async () => {
    // Create a temporary farm directory
    farmDir = path.join("/tmp", `farm-json-test-${Date.now()}`);
    await ensureDir(farmDir);
    farmYamlPath = path.join(farmDir, "farm.yaml");
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fileExists(farmDir)) {
      await fs.rm(farmDir, { recursive: true, force: true });
    }
  });

  it("should output valid JSON for dr farm init --format json", async () => {
    // Run farm init with JSON output
    const result = execSync(
      `cd ${farmDir} && dr farm init --name "Test Farm" --format json`,
      { encoding: "utf-8" }
    );

    // Parse and validate JSON
    const output = JSON.parse(result);
    expect(output.status).toBe("ok");
    expect(output.farmPath).toBeDefined();
    expect(output.farmName).toBe("Test Farm");
  });

  it("should output valid JSON for dr farm add --format json", async () => {
    // Create a farm first
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Run farm add with JSON output
    const result = execSync(
      `cd ${farmDir} && dr farm add test-service --format json`,
      { encoding: "utf-8" }
    );

    // Parse and validate JSON
    const output = JSON.parse(result);
    expect(output.status).toBe("ok");
    expect(output.project).toBe("test-service");
    expect(output.codebase_path).toBeDefined();
    expect(output.model_folder).toBeDefined();
  });

  it("should output valid JSON for dr farm remove --format json", async () => {
    // Create a farm with a project
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("test-service", {
      name: "test-service",
      codebase_path: "test-service",
      model_folder: "test-service-model",
    });
    await manifest.save(farmYamlPath);

    // Run farm remove with JSON output
    const result = execSync(
      `cd ${farmDir} && dr farm remove test-service --format json`,
      { encoding: "utf-8" }
    );

    // Parse and validate JSON
    const output = JSON.parse(result);
    expect(output.status).toBe("ok");
    expect(output.project).toBe("test-service");
    expect(output.modelDeleted).toBe(false);
  });

  it("should output valid JSON for dr farm status --format json", async () => {
    // Create a farm
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("test-service", {
      name: "test-service",
      codebase_path: "test-service",
      model_folder: "test-service-model",
    });
    await manifest.save(farmYamlPath);

    // Run farm status with JSON output
    const result = execSync(
      `cd ${farmDir} && dr farm status --format json`,
      { encoding: "utf-8" }
    );

    // Parse and validate JSON
    const output = JSON.parse(result);
    expect(output.status).toBe("ok");
    expect(output.farm).toBeDefined();
    expect(output.farm.name).toBe("Test Farm");
    expect(output.projects).toBeDefined();
    expect(Array.isArray(output.projects)).toBe(true);
    expect(output.project_count).toBe(1);

    // Verify hasPendingChanges is always a boolean, not undefined
    if (output.projects.length > 0) {
      expect(typeof output.projects[0].hasPendingChanges).toBe("boolean");
    }
  });

  it("should output valid JSON for dr farm validate --format json", async () => {
    // Create a basic farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Run farm validate with JSON output (will fail but should still output valid JSON)
    try {
      execSync(
        `cd ${farmDir} && dr farm validate --format json`,
        { encoding: "utf-8" }
      );
    } catch (error: any) {
      // Expected to fail since there are no projects to validate
      const output = JSON.parse(error.stdout || error.message);
      expect(output).toBeDefined();
    }
  });

  it("should output valid JSON for dr farm pull --format json", async () => {
    // Create a basic farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Run farm pull with JSON output (will fail but should still output valid JSON)
    try {
      execSync(
        `cd ${farmDir} && dr farm pull --format json`,
        { encoding: "utf-8" }
      );
    } catch (error: any) {
      // Expected to fail since there are no projects
      // The important thing is that the error output should be valid JSON
      const output = JSON.parse(error.stdout || error.message);
      expect(output).toBeDefined();
    }
  });
});
