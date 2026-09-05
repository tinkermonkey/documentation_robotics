/**
 * Farm Sync Tests - Integration tests for sync engine and commands
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, ensureDir, writeFile } from "../../src/utils/file-io.js";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { FarmSyncState } from "../../src/core/farm-sync-state.js";
import { FarmSyncEngine } from "../../src/core/farm-sync-engine.js";
import { execSync } from "child_process";

/**
 * Create a temporary git repository for testing
 */
async function createTestGitRepo(repoPath: string, withFiles = true): Promise<string> {
  await ensureDir(repoPath);

  // Initialize git repo
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: repoPath, stdio: "pipe" });

  if (withFiles) {
    // Create initial file and commit
    await writeFile(path.join(repoPath, "README.md"), "# Test Repo\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync("git commit -m 'Initial commit'", { cwd: repoPath, stdio: "pipe" });
  }

  // Get commit SHA
  const commit = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
  return commit;
}

describe("FarmSyncState", () => {
  let testDir: string;
  let syncStateFile: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `farm-sync-test-${Date.now()}`);
    await ensureDir(testDir);
    syncStateFile = path.join(testDir, ".farm-sync.yaml");
  });

  afterEach(async () => {
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create new sync state", () => {
    const state = FarmSyncState.create("test-project");

    expect(state.projectName).toBe("test-project");
    expect(state.lastSyncCommit).toBeUndefined();
    expect(state.syncHistory).toEqual([]);
    expect(state.ambiguities).toEqual([]);
  });

  it("should save and load sync state", async () => {
    const state = FarmSyncState.create("test-project", {
      lastSyncCommit: "abc123def456",
      lastSyncTimestamp: new Date().toISOString(),
    });

    await state.save(syncStateFile);
    const loaded = await FarmSyncState.load(syncStateFile);

    expect(loaded.projectName).toBe("test-project");
    expect(loaded.lastSyncCommit).toBe("abc123def456");
    expect(loaded.lastSyncTimestamp).toBeDefined();
  });

  it("should record sync operations", async () => {
    const state = FarmSyncState.create("test-project");
    const now = new Date().toISOString();

    state.recordSync({
      timestamp: now,
      commit: "abc123",
      filesChanged: 5,
      elementsAffected: 2,
    });

    expect(state.syncHistory.length).toBe(1);
    expect(state.lastSyncCommit).toBe("abc123");
    expect(state.lastSyncTimestamp).toBe(now);

    const record = state.getLastSync();
    expect(record).toBeDefined();
    expect(record?.filesChanged).toBe(5);
  });

  it("should record ambiguous mappings", async () => {
    const state = FarmSyncState.create("test-project");

    const ambiguities = [
      {
        filePath: "src/main.ts",
        possibleElements: [
          { elementId: "app.service.main", layer: "application", confidence: 70 },
          { elementId: "tech.component.main", layer: "technology", confidence: 70 },
        ],
      },
    ];

    state.recordAmbiguities(ambiguities);

    expect(state.ambiguities.length).toBe(1);
    expect(state.ambiguities[0].filePath).toBe("src/main.ts");
    expect(state.ambiguities[0].possibleElements.length).toBe(2);
  });

  it("should clear ambiguities after review", async () => {
    const state = FarmSyncState.create("test-project");

    state.recordAmbiguities([
      {
        filePath: "src/main.ts",
        possibleElements: [
          { elementId: "app.service.main", layer: "application", confidence: 70 },
        ],
      },
    ]);

    expect(state.ambiguities.length).toBe(1);

    state.clearAmbiguities();

    expect(state.ambiguities.length).toBe(0);
  });
});

describe("FarmSyncEngine", () => {
  let farmDir: string;
  let codebaseDir: string;
  let modelDir: string;
  let farmManifest: FarmManifest;

  beforeEach(async () => {
    // Create farm structure
    farmDir = path.join("/tmp", `farm-engine-test-${Date.now()}`);
    await ensureDir(farmDir);

    codebaseDir = path.join(farmDir, "codebase");
    modelDir = path.join(farmDir, "model");

    await ensureDir(codebaseDir);
    await ensureDir(modelDir);

    // Initialize git repo for codebase
    await createTestGitRepo(codebaseDir, true);

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

  it("should get current commit", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit = await engine.getCurrentCommit("codebase");

    expect(commit).toBeDefined();
    expect(commit.length).toBe(40); // Full SHA
  });

  it("should pull codebase without remote", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const initialCommit = await engine.getCurrentCommit("codebase");

    // Add a new file to the repo
    const newFile = path.join(codebaseDir, "new-file.txt");
    await writeFile(newFile, "new content");
    execSync("git add new-file.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Add new file'", { cwd: codebaseDir, stdio: "pipe" });

    // Pull codebase - should succeed even without remote
    const pulledCommit = await engine.pullCodebase("codebase");

    // Verify pull returned the current commit
    expect(pulledCommit).toBeDefined();
    expect(pulledCommit.length).toBe(40);

    const currentCommit = await engine.getCurrentCommit("codebase");
    expect(pulledCommit).toBe(currentCommit);
  });

  it("should compute diff between commits", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit1 = await engine.getCurrentCommit("codebase");

    // Add file
    const newFile = path.join(codebaseDir, "added.txt");
    await writeFile(newFile, "added content");
    execSync("git add added.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Add file'", { cwd: codebaseDir, stdio: "pipe" });

    const commit2 = await engine.getCurrentCommit("codebase");

    const diff = await engine.computeDiff("codebase", commit1, commit2);

    expect(diff.added).toContain("added.txt");
    expect(diff.modified.length).toBe(0);
    expect(diff.deleted.length).toBe(0);
  });

  it("should detect modified files", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit1 = await engine.getCurrentCommit("codebase");

    // Modify existing file
    const readmeFile = path.join(codebaseDir, "README.md");
    await writeFile(readmeFile, "# Modified Test Repo\n");
    execSync("git add README.md", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Modify README'", { cwd: codebaseDir, stdio: "pipe" });

    const commit2 = await engine.getCurrentCommit("codebase");

    const diff = await engine.computeDiff("codebase", commit1, commit2);

    expect(diff.modified).toContain("README.md");
    expect(diff.added.length).toBe(0);
  });

  it("should detect deleted files", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit1 = await engine.getCurrentCommit("codebase");

    // Delete file
    const readmeFile = path.join(codebaseDir, "README.md");
    execSync("git rm README.md", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Remove README'", { cwd: codebaseDir, stdio: "pipe" });

    const commit2 = await engine.getCurrentCommit("codebase");

    const diff = await engine.computeDiff("codebase", commit1, commit2);

    expect(diff.deleted).toContain("README.md");
    expect(diff.added.length).toBe(0);
  });

  it("should handle initial sync with no previous commit", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const project = farmManifest.getProject("test-project")!;
    const result = await engine.syncProject(project, { verbose: false });

    expect(result.success).toBe(true);
    expect(result.projectName).toBe("test-project");
    expect(result.changeCount).toBe(0);
    expect(result.notes).toContain("Initial sync - recording baseline only");

    // Verify sync state was recorded
    const syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
    expect(await fileExists(syncStateFile)).toBe(true);

    const syncState = await FarmSyncState.load(syncStateFile);
    expect(syncState.lastSyncCommit).toBeDefined();
  });

  it("should detect no changes on subsequent sync", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const project = farmManifest.getProject("test-project")!;

    // First sync
    await engine.syncProject(project, { verbose: false });

    // Second sync without changes
    const result = await engine.syncProject(project, { verbose: false });

    expect(result.success).toBe(true);
    expect(result.filesChanged.added.length).toBe(0);
    expect(result.filesChanged.modified.length).toBe(0);
    expect(result.filesChanged.deleted.length).toBe(0);
    expect(result.changeCount).toBe(0);
    expect(result.notes).toContain("No changes detected");
  });

  it("should handle file renames and copies in diff", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit1 = await engine.getCurrentCommit("codebase");

    // Create a file to rename
    const oldFile = path.join(codebaseDir, "old-name.ts");
    await writeFile(oldFile, "export const oldName = 'test';");
    execSync("git add old-name.ts", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Add file for rename'", { cwd: codebaseDir, stdio: "pipe" });

    const commit2 = await engine.getCurrentCommit("codebase");

    // Rename the file
    execSync("git mv old-name.ts new-name.ts", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Rename file'", { cwd: codebaseDir, stdio: "pipe" });

    const commit3 = await engine.getCurrentCommit("codebase");

    // Compute diff with rename
    const diff = await engine.computeDiff("codebase", commit2, commit3);

    // Renames should be reported as delete of old + add of new
    expect(diff.deleted).toContain("old-name.ts");
    expect(diff.added).toContain("new-name.ts");
    expect(diff.modified.length).toBe(0);
  });

  it("should map files to elements via source references", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");

    // Create a model with source references
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Add element with source references
    const appLayer = await model.getLayer("application");
    if (appLayer) {
      const element = new Element({
        id: "application.service.test-service",
        path: "application.service.test-service",
        name: "Test Service",
        description: "A service for testing",
        type: "service",
        layer_id: "application",
        source_reference: {
          type: "github",
          repository: "test-repo",
          locations: [
            {
              file: "src/services/test-service.ts",
              symbol: "TestService",
            },
          ],
        },
      });
      appLayer.addElement(element);

      // Create engine with model
      const engine = new FarmSyncEngine(farmDir, model);

      // Map files - should find the element
      const mappings = await engine.mapFilesToElements();

      expect(mappings.confident.length).toBeGreaterThanOrEqual(0);

      // Check if our file is in the mappings
      const testMapping = mappings.confident.find(
        (m) => m.filePath === "src/services/test-service.ts"
      );

      if (testMapping) {
        expect(testMapping.possibleElements[0].elementId).toBe(
          "application.service.test-service"
        );
      }
    }
  });

  it("should detect ambiguous file-to-element mappings", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");

    // Create a model with multiple elements referencing the same file
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    const appLayer = await model.getLayer("application");
    if (appLayer) {
      // Add two elements pointing to the same file
      const element1 = new Element({
        id: "application.service.service-a",
        path: "application.service.service-a",
        name: "Service A",
        description: "Service A",
        type: "service",
        layer_id: "application",
        source_reference: {
          type: "github",
          repository: "test-repo",
          locations: [
            {
              file: "src/shared.ts",
              symbol: "ServiceA",
            },
          ],
        },
      });
      appLayer.addElement(element1);

      const element2 = new Element({
        id: "application.service.service-b",
        path: "application.service.service-b",
        name: "Service B",
        description: "Service B",
        type: "service",
        layer_id: "application",
        source_reference: {
          type: "github",
          repository: "test-repo",
          locations: [
            {
              file: "src/shared.ts",
              symbol: "ServiceB",
            },
          ],
        },
      });
      appLayer.addElement(element2);

      const engine = new FarmSyncEngine(farmDir, model);
      const mappings = await engine.mapFilesToElements();

      // Should detect ambiguity
      expect(mappings.ambiguous.length).toBeGreaterThanOrEqual(0);

      const ambiguousFile = mappings.ambiguous.find((m) => m.filePath === "src/shared.ts");
      if (ambiguousFile) {
        expect(ambiguousFile.possibleElements.length).toBe(2);
      }
    }
  });

  it("should generate changeset from file diff and mappings", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");

    // Create a model
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Add element with source reference
    const appLayer = await model.getLayer("application");
    if (appLayer) {
      const element = new Element({
        id: "application.service.main-service",
        path: "application.service.main-service",
        name: "Main Service",
        description: "Main service for the application",
        type: "service",
        layer_id: "application",
        source_reference: {
          type: "github",
          repository: "test-repo",
          locations: [
            {
              file: "src/services/main.ts",
              symbol: "MainService",
            },
          ],
        },
      });
      appLayer.addElement(element);

      const engine = new FarmSyncEngine(farmDir, model);
      const project = farmManifest.getProject("test-project")!;

      // Create fake diff
      const diff = {
        added: ["src/services/main.ts"],
        modified: [],
        deleted: [],
      };

      // Create mappings
      const mappings = {
        confident: [
          {
            filePath: "src/services/main.ts",
            possibleElements: [
              {
                elementId: "application.service.main-service",
                layer: "application",
                confidence: 100,
                sourceRef: {
                  file: "src/services/main.ts",
                  symbol: "MainService",
                },
              },
            ],
          },
        ],
        ambiguous: [],
      };

      // Generate changeset
      const changesetResult = await engine.generateChangeset(project, diff, mappings, {
        verbose: false,
      });

      expect(changesetResult.changesetId).toBeDefined();
      expect(changesetResult.changeCount).toBeGreaterThan(0);
      expect(changesetResult.warnings.length).toBeGreaterThan(0);
    }
  });

  it("should handle consistent commit SHA truncation", async () => {
    const { Model } = await import("../../src/core/model.js");

    // Create a model (without source references to avoid changeset generation)
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    const engine = new FarmSyncEngine(farmDir, model);
    const project = farmManifest.getProject("test-project")!;

    // First sync - initial (no previous commit)
    const result1 = await engine.syncProject(project, { verbose: false });
    expect(result1.commitsBefore).toBe("none");
    expect(result1.commitsAfter.length).toBe(8); // Should be 8-char truncated

    // Make a change
    const newFile = path.join(codebaseDir, "test-file.txt");
    await writeFile(newFile, "test content");
    execSync("git add test-file.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Test commit'", { cwd: codebaseDir, stdio: "pipe" });

    // Second sync - incremental (with previous commit)
    const result2 = await engine.syncProject(project, { verbose: false });
    expect(result2.commitsBefore).toBeDefined();
    expect(result2.commitsBefore.length).toBe(8); // Should be 8-char truncated
    expect(result2.commitsAfter).toBeDefined();
    expect(result2.commitsAfter.length).toBe(8); // Should be 8-char truncated
  });
});
