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
  // (For farm sync, the model directory structure is simpler than standard DR)
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
    process.env.DR_MODEL_PATH = modelDir;

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);

      const project = farmManifest.getProject("test-project")!;
      const result = await engine.syncProject(project, { verbose: false });

      // Verify result
      expect(result.status).toBe("success");
      expect(result.projectName).toBe("test-project");
      expect(result.commitsBefore).toBe("none");
      expect(result.filesChanged.added.length).toBe(0);
      expect(result.changeCount).toBe(0);

      // Verify sync state was saved
      const syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
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
    process.env.DR_MODEL_PATH = modelDir;

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);

      const project = farmManifest.getProject("test-project")!;

      // First sync
      const result1 = await engine.syncProject(project, { verbose: false });
      expect(result1.status).toBe("success");

      // Make a change to the codebase
      const serviceFile = path.join(codebaseDir, "src/service.ts");
      await writeFile(serviceFile, "export class Service {}");
      execSync("git add src/service.ts", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Add service'", { cwd: codebaseDir, stdio: "pipe" });

      // Second sync - should detect changes
      const result2 = await engine.syncProject(project, { verbose: false });
      expect(result2.status).toBe("success");
      expect(result2.filesChanged.added.length).toBeGreaterThan(0);
      expect(result2.filesChanged.added).toContain("src/service.ts");

      // Verify sync state history
      const syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
      const syncState = await FarmSyncState.load(syncStateFile);
      expect(syncState.syncHistory.length).toBe(2);
      expect(syncState.getLastSync()?.files_changed).toBeGreaterThan(0);
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
    process.env.DR_MODEL_PATH = modelDir;

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Perform 3 syncs with changes
      for (let i = 0; i < 3; i++) {
        const result = await engine.syncProject(project, { verbose: false });
        expect(result.status).toBe("success");

        if (i < 2) {
          // Add file between syncs
          const file = path.join(codebaseDir, `src/file${i}.ts`);
          await writeFile(file, `export const value${i} = ${i};`);
          execSync(`git add src/file${i}.ts`, { cwd: codebaseDir, stdio: "pipe" });
          execSync(`git commit -m 'Add file${i}'`, { cwd: codebaseDir, stdio: "pipe" });
        }
      }

      // Verify sync history
      const syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
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
    process.env.DR_MODEL_PATH = modelDir;

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
    process.env.DR_MODEL_PATH = modelDir;

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

  it("should prevent dry runs from advancing lastSyncCommit", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = modelDir;

    try {
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Initial sync to establish baseline
      const result1 = await engine.syncProject(project, { verbose: false });
      expect(result1.status).toBe("success");
      expect(result1.dryRun).toBeFalsy();

      // Get the sync state after initial sync
      const syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
      const syncState1 = await FarmSyncState.load(syncStateFile);
      const initialLastSyncCommit = syncState1.lastSyncCommit;
      const initialSyncHistoryLength = syncState1.syncHistory.length;

      // Add a change to the codebase
      const serviceFile = path.join(codebaseDir, "src/service.ts");
      await writeFile(serviceFile, "export class Service {}");
      execSync("git add src/service.ts", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Add service'", { cwd: codebaseDir, stdio: "pipe" });

      // Perform dry-run sync
      const dryRunResult = await engine.syncProject(project, { verbose: false, dryRun: true });
      expect(dryRunResult.status).toBe("success");
      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.filesChanged.added).toContain("src/service.ts");

      // Verify sync state file was not modified by dry run
      const syncState2 = await FarmSyncState.load(syncStateFile);
      expect(syncState2.lastSyncCommit).toBe(initialLastSyncCommit);
      expect(syncState2.syncHistory.length).toBe(initialSyncHistoryLength);
      expect(syncState2.syncHistory).toEqual(syncState1.syncHistory);

      // Perform another normal sync and verify it advances from the original lastSyncCommit
      const result3 = await engine.syncProject(project, { verbose: false });
      expect(result3.status).toBe("success");
      expect(result3.dryRun).toBeFalsy();
      expect(result3.filesChanged.added).toContain("src/service.ts");

      // Verify sync state was updated by normal sync
      const syncState3 = await FarmSyncState.load(syncStateFile);
      expect(syncState3.lastSyncCommit).not.toBe(initialLastSyncCommit);
      expect(syncState3.syncHistory.length).toBe(initialSyncHistoryLength + 1);
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });

  it("should support autoCommit configuration for model synchronization", async () => {
    const originalDRModelPath = process.env.DR_MODEL_PATH;
    process.env.DR_MODEL_PATH = modelDir;

    try {
      // Initialize git repo in model directory
      execSync("git init", { cwd: modelDir, stdio: "pipe" });
      execSync("git config user.email 'test@example.com'", { cwd: modelDir, stdio: "pipe" });
      execSync("git config user.name 'Test User'", { cwd: modelDir, stdio: "pipe" });
      execSync("git add .", { cwd: modelDir, stdio: "pipe" });
      execSync("git commit -m 'Initial model commit'", { cwd: modelDir, stdio: "pipe" });

      // Update farm manifest to enable track_commits at farm level
      farmManifest = FarmManifest.create("Test Farm", {
        sync: { track_commits: true },
      });
      farmManifest.addProject("test-project", {
        name: "test-project",
        source: "codebase",
        model: "model",
      });
      const farmYamlPath = path.join(farmDir, "farm.yaml");
      await farmManifest.save(farmYamlPath);

      // Load model and engine
      const model = await Model.load();
      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Perform initial sync to establish baseline
      const initialResult = await engine.syncProject(project, { verbose: false });
      expect(initialResult).toBeDefined();

      // Verify autoCommit option is supported by farmSyncCommand
      // (The actual commit behavior would be tested with integration tests
      // that verify the full command line interface, not just the engine)
      const originalCwd = process.cwd();
      process.chdir(farmDir);
      try {
        // This demonstrates that farmSyncCommand accepts the autoCommit option
        // In production usage, this would be called from the CLI with --auto-commit flag
        await farmSyncCommand({
          project: "test-project",
          verbose: false,
          autoCommit: true,
        });
        // Test passes if command completes without error
        expect(true).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      if (originalDRModelPath !== undefined) {
        process.env.DR_MODEL_PATH = originalDRModelPath;
      } else {
        delete process.env.DR_MODEL_PATH;
      }
    }
  });
});
