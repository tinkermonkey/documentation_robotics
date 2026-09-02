/**
 * Farm Command Tests - Test farm initialization, project management, and status
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { fileExists, ensureDir } from "../../src/utils/file-io.js";

describe("FarmManifest", () => {
  let testDir: string;
  let farmYamlPath: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join("/tmp", `farm-test-${Date.now()}`);
    await ensureDir(testDir);
    farmYamlPath = path.join(testDir, "farm.yaml");
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create a new farm manifest", async () => {
    const manifest = FarmManifest.create("Test Farm");

    expect(manifest.name).toBe("Test Farm");
    expect(manifest.projects.size).toBe(0);
    expect(manifest.created).toBeDefined();
    expect(manifest.modified).toBeDefined();
  });

  it("should save and load farm manifest", async () => {
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.name).toBe("Test Farm");
    expect(loaded.projects.size).toBe(0);
    expect(loaded.created).toBeDefined();
    expect(loaded.modified).toBeDefined();
  });

  it("should add projects to farm", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
      remote_url: "https://github.com/org/service-a.git",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    expect(manifest.projects.size).toBe(2);
    expect(manifest.getProject("service-a")).toBeDefined();
    expect(manifest.getProject("service-b")).toBeDefined();
  });

  it("should remove projects from farm", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    expect(manifest.projects.size).toBe(1);

    const removed = manifest.removeProject("service-a");

    expect(removed).toBe(true);
    expect(manifest.projects.size).toBe(0);
    expect(manifest.getProject("service-a")).toBeUndefined();
  });

  it("should return undefined for non-existent project", async () => {
    const manifest = FarmManifest.create("Test Farm");
    const project = manifest.getProject("non-existent");

    expect(project).toBeUndefined();
  });

  it("should get all projects", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    const projects = manifest.getAllProjects();

    expect(projects.length).toBe(2);
    expect(projects[0].name).toBe("service-a");
    expect(projects[1].name).toBe("service-b");
  });

  it("should persist and restore full farm state", async () => {
    const manifest = FarmManifest.create("Architecture Farm", {
      platform_view: true,
      sync: { enabled: true, interval: 300 },
    });

    manifest.addProject("api-service", {
      name: "api-service",
      codebase_path: "services/api",
      model_folder: "api-service-model",
      remote_url: "https://github.com/org/api-service.git",
    });

    manifest.addProject("web-service", {
      name: "web-service",
      codebase_path: "services/web",
      model_folder: "web-service-model",
      remote_url: "https://github.com/org/web-service.git",
    });

    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.name).toBe("Architecture Farm");
    expect(loaded.platform_view).toBe(true);
    expect(loaded.sync?.enabled).toBe(true);
    expect(loaded.sync?.interval).toBe(300);
    expect(loaded.projects.size).toBe(2);

    const apiService = loaded.getProject("api-service");
    expect(apiService).toBeDefined();
    expect(apiService?.codebase_path).toBe("services/api");
    expect(apiService?.model_folder).toBe("api-service-model");
    expect(apiService?.remote_url).toBe("https://github.com/org/api-service.git");
  });

  it("should update modified timestamp when adding projects", async () => {
    const manifest = FarmManifest.create("Test Farm");
    const originalModified = manifest.modified;

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    expect(manifest.modified).not.toBe(originalModified);
  });

  it("should update modified timestamp when removing projects", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    const afterAdd = manifest.modified;
    await new Promise((resolve) => setTimeout(resolve, 10));

    manifest.removeProject("service-a");

    expect(manifest.modified).not.toBe(afterAdd);
  });

  it("should serialize to JSON correctly", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
      remote_url: "https://github.com/org/service-a.git",
    });

    const json = manifest.toJSON();

    expect(json.name).toBe("Test Farm");
    expect(json.projects.hasOwnProperty("service-a")).toBe(true);
    expect(json.projects["service-a"].codebase_path).toBe("services/service-a");
  });

  it("should handle farm with optional fields", async () => {
    const manifest = FarmManifest.create("Simple Farm");
    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.platform_view).toBeUndefined();
    expect(loaded.sync).toBeUndefined();
  });

  it("should throw error on missing name", async () => {
    const invalidYamlPath = path.join(testDir, "invalid.yaml");
    const invalidContent = `
id: test-id
projects: {}
`;

    await fs.writeFile(invalidYamlPath, invalidContent, "utf-8");

    try {
      await FarmManifest.load(invalidYamlPath);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).toContain("must have a 'name' field");
    }
  });
});

describe("Farm integration with model paths", () => {
  let testDir: string;
  let farmRoot: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `farm-integration-${Date.now()}`);
    farmRoot = testDir;
    await ensureDir(farmRoot);
  });

  afterEach(async () => {
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create farm with multiple projects", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Multi-Project Farm");

    // Add first project
    const serviceACodebase = path.join(farmRoot, "services/service-a");
    const serviceAModel = path.join(farmRoot, "service-a-model");
    await ensureDir(serviceACodebase);
    await ensureDir(serviceAModel);

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    // Add second project
    const serviceBCodebase = path.join(farmRoot, "services/service-b");
    const serviceBModel = path.join(farmRoot, "service-b-model");
    await ensureDir(serviceBCodebase);
    await ensureDir(serviceBModel);

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    await manifest.save(farmYamlPath);

    // Verify both projects exist
    expect(await fileExists(serviceACodebase)).toBe(true);
    expect(await fileExists(serviceAModel)).toBe(true);
    expect(await fileExists(serviceBCodebase)).toBe(true);
    expect(await fileExists(serviceBModel)).toBe(true);

    // Load and verify
    const loaded = await FarmManifest.load(farmYamlPath);
    expect(loaded.projects.size).toBe(2);
    expect(loaded.getProject("service-a")).toBeDefined();
    expect(loaded.getProject("service-b")).toBeDefined();
  });

  it("should handle nested codebase paths", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Nested Farm");

    const codebasePath = "backend/services/auth-service";
    const modelFolder = "auth-service-model";

    manifest.addProject("auth-service", {
      name: "auth-service",
      codebase_path: codebasePath,
      model_folder: modelFolder,
    });

    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);
    const project = loaded.getProject("auth-service");

    expect(project?.codebase_path).toBe(codebasePath);
    expect(project?.model_folder).toBe(modelFolder);
  });
});
