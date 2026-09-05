/**
 * Farm Sync End-to-End Tests
 * Tests the complete flow: farm setup, codebase changes, sync, and changeset generation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, ensureDir, writeFile } from "../../src/utils/file-io.js";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { FarmSyncState } from "../../src/core/farm-sync-state.js";
import { FarmSyncEngine } from "../../src/core/farm-sync-engine.js";
import { Model } from "../../src/core/model.js";
import { farmSyncCommand } from "../../src/commands/farm.js";
import { execSync } from "child_process";

/**
 * Create a test model folder with manifest
 * Returns the path to the manifest.yaml file
 */
async function createTestModel(modelPath: string): Promise<string> {
  await ensureDir(modelPath);

  // Create basic manifest.yaml directly in modelPath
  const manifestPath = path.join(modelPath, "manifest.yaml");
  await writeFile(
    manifestPath,
    `version: "1.0"
name: Test Model
created: ${new Date().toISOString()}
modified: ${new Date().toISOString()}
`
  );

  // Create a layers directory (required for model initialization)
  const layersDir = path.join(modelPath, "01_motivation");
  await ensureDir(layersDir);

  // Create empty elements.yaml
  await writeFile(path.join(layersDir, "elements.yaml"), "");

  return manifestPath;
}

/**
 * Create a test git repository with initial content
 */
async function createTestGitRepo(repoPath: string): Promise<string> {
  await ensureDir(repoPath);

  // Initialize git repo
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: repoPath, stdio: "pipe" });

  // Create initial file and commit
  await writeFile(path.join(repoPath, "src/main.ts"), "export function main() { console.log('hello'); }");
  execSync("git add .", { cwd: repoPath, stdio: "pipe" });
  execSync("git commit -m 'Initial commit'", { cwd: repoPath, stdio: "pipe" });

  // Get commit SHA
  const commit = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
  return commit;
}

describe("Farm Sync - End-to-End Flow", () => {
  let farmDir: string;
  let codebaseDir: string;
  let modelDir: string;
  let farmManifest: FarmManifest;
  let initialCommit: string;

  beforeEach(async () => {
    // Create farm structure
    farmDir = path.join("/tmp", `farm-e2e-test-${Date.now()}`);
    await ensureDir(farmDir);

    codebaseDir = path.join(farmDir, "codebase");
    modelDir = path.join(farmDir, "model");

    // Create codebase with git repo
    initialCommit = await createTestGitRepo(codebaseDir);

    // Create model - returns path to manifest
    await createTestModel(modelDir);

    // Create farm manifest
    farmManifest = FarmManifest.create("Test Farm");
    farmManifest.addProject("test-project", {
      name: "test-project",
      source: "codebase",
      model: "model",
    });

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await farmManifest.save(farmYamlPath);
  });

  afterEach(async () => {
    if (await fileExists(farmDir)) {
      await fs.rm(farmDir, { recursive: true, force: true });
    }
  });

  it("should perform initial sync without changes", async () => {
    // Load model
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = path.join(modelDir, "manifest.yaml");

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);

      const project = farmManifest.getProject("test-project")!;
      const result = await engine.syncProject(project, { verbose: false });

      // Verify result
      expect(result.success).toBe(true);
      expect(result.projectName).toBe("test-project");
      expect(result.commitsBefore).toBe("none");
      expect(result.filesChanged.added.length).toBe(0);
      expect(result.changeCount).toBe(0);

      // Verify sync state was saved
      const syncStateFile = path.join(farmDir, ".farm-sync", "test-project.yaml");
      expect(await fileExists(syncStateFile)).toBe(true);

      const syncState = await FarmSyncState.load(syncStateFile);
      expect(syncState.lastSyncCommit).toBeDefined();
      expect(syncState.syncHistory.length).toBe(1);
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });

  it("should detect changes after second sync", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = path.join(modelDir, "manifest.yaml");

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);

      const project = farmManifest.getProject("test-project")!;

      // First sync
      const result1 = await engine.syncProject(project, { verbose: false });
      expect(result1.success).toBe(true);

      // Make a change to the codebase
      const serviceFile = path.join(codebaseDir, "src/service.ts");
      await writeFile(serviceFile, "export class Service {}");
      execSync("git add src/service.ts", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Add service'", { cwd: codebaseDir, stdio: "pipe" });

      // Second sync - should detect changes
      const result2 = await engine.syncProject(project, { verbose: false });
      expect(result2.success).toBe(true);
      expect(result2.filesChanged.added.length).toBeGreaterThan(0);
      expect(result2.filesChanged.added).toContain("src/service.ts");

      // Verify sync state history
      const syncStateFile = path.join(farmDir, ".farm-sync", "test-project.yaml");
      const syncState = await FarmSyncState.load(syncStateFile);
      expect(syncState.syncHistory.length).toBe(2);
      expect(syncState.getLastSync()?.filesChanged).toBeGreaterThan(0);
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });

  it("should track sync state across multiple syncs", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = path.join(modelDir, "manifest.yaml");

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Perform 3 syncs with changes
      for (let i = 0; i < 3; i++) {
        const result = await engine.syncProject(project, { verbose: false });
        expect(result.success).toBe(true);

        if (i < 2) {
          // Add file between syncs
          const file = path.join(codebaseDir, `src/file${i}.ts`);
          await writeFile(file, `export const value${i} = ${i};`);
          execSync(`git add src/file${i}.ts`, { cwd: codebaseDir, stdio: "pipe" });
          execSync(`git commit -m 'Add file${i}'`, { cwd: codebaseDir, stdio: "pipe" });
        }
      }

      // Verify sync history
      const syncStateFile = path.join(farmDir, ".farm-sync", "test-project.yaml");
      const syncState = await FarmSyncState.load(syncStateFile);
      expect(syncState.syncHistory.length).toBe(3);

      // Verify commits are tracked
      expect(syncState.lastSyncCommit).toBeDefined();
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });

  it("should handle file modifications correctly", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = path.join(modelDir, "manifest.yaml");

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Initial sync
      await engine.syncProject(project, { verbose: false });

      // Modify existing file
      const mainFile = path.join(codebaseDir, "src/main.ts");
      await writeFile(mainFile, "export function main() { console.log('modified'); }");
      execSync("git add src/main.ts", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Modify main'", { cwd: codebaseDir, stdio: "pipe" });

      // Sync and verify modification is detected
      const result = await engine.syncProject(project, { verbose: false });
      expect(result.filesChanged.modified).toContain("src/main.ts");
      expect(result.filesChanged.added.length).toBe(0);
      expect(result.filesChanged.deleted.length).toBe(0);
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });

  it("should handle file deletions correctly", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = path.join(modelDir, "manifest.yaml");

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Initial sync
      await engine.syncProject(project, { verbose: false });

      // Delete file
      execSync("git rm src/main.ts", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Delete main'", { cwd: codebaseDir, stdio: "pipe" });

      // Sync and verify deletion is detected
      const result = await engine.syncProject(project, { verbose: false });
      expect(result.filesChanged.deleted).toContain("src/main.ts");
      expect(result.filesChanged.added.length).toBe(0);
      expect(result.filesChanged.modified.length).toBe(0);
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });
});
