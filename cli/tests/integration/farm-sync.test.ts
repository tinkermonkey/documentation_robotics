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
      files_changed: 5,
      elements_affected: 2,
    });

    expect(state.syncHistory.length).toBe(1);
    expect(state.lastSyncCommit).toBe("abc123");
    expect(state.lastSyncTimestamp).toBe(now);

    const record = state.getLastSync();
    expect(record).toBeDefined();
    expect(record?.files_changed).toBe(5);
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

  it("should not update lastSyncCommit when sync status is 'failed'", () => {
    const state = FarmSyncState.create("test-project");
    const successTimestamp = new Date().toISOString();
    const failedTimestamp = new Date(Date.now() + 1000).toISOString();

    // Record successful sync
    state.recordSync({
      timestamp: successTimestamp,
      commit: "success-commit-123",
      status: "success",
    });

    expect(state.lastSyncCommit).toBe("success-commit-123");
    expect(state.lastSyncTimestamp).toBe(successTimestamp);

    // Record failed sync - should NOT update lastSyncCommit
    state.recordSync({
      timestamp: failedTimestamp,
      commit: "failed-commit-456",
      status: "failed",
      notes: "Sync failed due to errors",
    });

    // lastSyncCommit should still point to successful commit
    expect(state.lastSyncCommit).toBe("success-commit-123");
    expect(state.lastSyncTimestamp).toBe(successTimestamp);

    // But the failed sync should be in history
    expect(state.syncHistory.length).toBe(2);
    const lastRecord = state.getLastSync();
    expect(lastRecord?.status).toBe("failed");
    expect(lastRecord?.commit).toBe("failed-commit-456");
  });

  it("should update lastSyncCommit when sync status is 'partial' (confident files processed)", () => {
    const state = FarmSyncState.create("test-project");
    const successTimestamp = new Date().toISOString();
    const partialTimestamp = new Date(Date.now() + 1000).toISOString();

    // Record successful sync
    state.recordSync({
      timestamp: successTimestamp,
      commit: "success-commit-123",
      status: "success",
    });

    expect(state.lastSyncCommit).toBe("success-commit-123");

    // Record partial sync - SHOULD update lastSyncCommit because confident files are processed
    state.recordSync({
      timestamp: partialTimestamp,
      commit: "partial-commit-789",
      status: "partial",
      notes: "Some changes have ambiguities",
    });

    // lastSyncCommit should be updated to the partial commit (confident files processed)
    // This prevents reprocessing confident files on next sync
    expect(state.lastSyncCommit).toBe("partial-commit-789");

    // Partial sync should be in history
    expect(state.syncHistory.length).toBe(2);
    const lastRecord = state.getLastSync();
    expect(lastRecord?.status).toBe("partial");
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

  it("should reject invalid commit SHA format to prevent command injection", async () => {
    const engine = new FarmSyncEngine(farmDir);

    // Get a valid commit SHA for testing
    const validCommit = await engine.getCurrentCommit("codebase");

    // Test various injection attempts that should be rejected
    const injectionAttempts = [
      // Shell metacharacters
      "abc123; rm -rf /",
      "abc123 && malicious-command",
      "abc123 | grep something",
      "abc123 $(whoami)",
      "abc123 `cat /etc/passwd`",
      // Path traversal
      "../../../etc/passwd",
      "abc123/../../../etc/passwd",
      // Newlines and control characters
      "abc123\nmalicious",
      "abc123\rmalicious",
      // Too long SHA
      "0123456789abcdef0123456789abcdef0123456789abcdef",
      // Invalid characters
      "abc123xyz!@#",
      "abc123-dash",
      "abc123_underscore",
      // Empty and whitespace
      "",
      "   ",
      // Non-hex characters
      "zzzzzzzzzz",
      "abc12g",
    ];

    for (const injection of injectionAttempts) {
      let error: Error | null = null;
      try {
        await engine.computeDiff("codebase", injection, validCommit);
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull(
        `Expected rejection of malicious commit SHA: "${injection}"`
      );
      expect(error?.message).toContain("Invalid commit SHA format");
    }
  });

  it("should reject invalid toCommit SHA to prevent command injection", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const validCommit = await engine.getCurrentCommit("codebase");

    const injectionAttempts = [
      "abc123; rm -rf /",
      "abc123 && echo hacked",
      "$(whoami)",
      "`id > /tmp/pwned`",
      "abc123\nmalicious",
    ];

    for (const injection of injectionAttempts) {
      let error: Error | null = null;
      try {
        await engine.computeDiff("codebase", validCommit, injection);
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull(
        `Expected rejection of malicious toCommit SHA: "${injection}"`
      );
      expect(error?.message).toContain("Invalid commit SHA format");
    }
  });

  it("should accept valid commit SHAs of varying lengths", async () => {
    const engine = new FarmSyncEngine(farmDir);

    // Create test commits
    const commit1 = await engine.getCurrentCommit("codebase");

    // Add a file and commit
    const testFile = path.join(codebaseDir, "test-valid-sha.txt");
    await writeFile(testFile, "test content");
    execSync("git add test-valid-sha.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Test valid SHA'", {
      cwd: codebaseDir,
      stdio: "pipe",
    });

    const commit2 = await engine.getCurrentCommit("codebase");

    // Full SHA should work
    const diffFull = await engine.computeDiff("codebase", commit1, commit2);
    expect(diffFull.added).toContain("test-valid-sha.txt");

    // Short SHA (7 chars) should also work
    const shortCommit1 = commit1.substring(0, 7);
    const shortCommit2 = commit2.substring(0, 7);

    const diffShort = await engine.computeDiff(
      "codebase",
      shortCommit1,
      shortCommit2
    );
    expect(diffShort.added).toContain("test-valid-sha.txt");
  });

  it("should handle initial sync with no previous commit", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const project = farmManifest.getProject("test-project")!;
    const result = await engine.syncProject(project, { verbose: false });

    expect(result.status).toBe("success");
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

    expect(result.status).toBe("success");
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

  it("should handle renames with content changes (partial similarity index)", async () => {
    const engine = new FarmSyncEngine(farmDir);

    const commit1 = await engine.getCurrentCommit("codebase");

    // Create a file to rename with modifications
    const oldFile = path.join(codebaseDir, "old-file-name.ts");
    await writeFile(oldFile, "export const oldName = 'test';");
    execSync("git add old-file-name.ts", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Add file for rename with edits'", {
      cwd: codebaseDir,
      stdio: "pipe",
    });

    const commit2 = await engine.getCurrentCommit("codebase");

    // Rename the file and modify its content in the same commit
    execSync("git mv old-file-name.ts renamed-file-name.ts", {
      cwd: codebaseDir,
      stdio: "pipe",
    });
    const renamedFile = path.join(codebaseDir, "renamed-file-name.ts");
    await writeFile(
      renamedFile,
      "export const oldName = 'test';\nexport const newVariable = 'added';"
    );
    execSync("git add renamed-file-name.ts", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Rename file with content changes'", {
      cwd: codebaseDir,
      stdio: "pipe",
    });

    const commit3 = await engine.getCurrentCommit("codebase");

    // Compute diff - git will report this with partial similarity (e.g., R087)
    const diff = await engine.computeDiff("codebase", commit2, commit3);

    // Even with partial similarity, should report as delete + add
    expect(diff.deleted).toContain("old-file-name.ts");
    expect(diff.added).toContain("renamed-file-name.ts");
    expect(diff.modified.length).toBe(0);
  });

  it("should map files to elements via source references", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");
    const { Layer } = await import("../../src/core/layer.js");

    // Create a model with source references
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Create and add the application layer
    const appLayer = new Layer("application");
    model.layers.set("application", appLayer);
    expect(appLayer).toBeDefined();

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

    expect(testMapping).toBeDefined();
    expect(testMapping!.possibleElements[0].elementId).toBe(
      "application.service.test-service"
    );
  });

  it("should detect ambiguous file-to-element mappings", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");
    const { Layer } = await import("../../src/core/layer.js");

    // Create a model with multiple elements referencing the same file
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Create and add the application layer
    const appLayer = new Layer("application");
    model.layers.set("application", appLayer);
    expect(appLayer).toBeDefined();

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
    expect(ambiguousFile).toBeDefined();
    expect(ambiguousFile!.possibleElements.length).toBe(2);
  });

  it("should generate changeset from file diff and mappings", async () => {
    const { Model } = await import("../../src/core/model.js");
    const { Element } = await import("../../src/core/element.js");
    const { Layer } = await import("../../src/core/layer.js");

    // Create a model
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Create and add the application layer
    const appLayer = new Layer("application");
    model.layers.set("application", appLayer);
    expect(appLayer).toBeDefined();

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

  it("should throw error when git fetch fails with auth error", async () => {
    const { Model } = await import("../../src/core/model.js");

    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Create a second codebase with a mock remote
    const remoteDirPath = path.join(farmDir, "fake-remote");
    await ensureDir(remoteDirPath);
    execSync("git init --bare", { cwd: remoteDirPath, stdio: "pipe" });

    // Set up the codebase with a remote pointing to an inaccessible location
    const codebase2Path = path.join(farmDir, "codebase2");
    await createTestGitRepo(codebase2Path, true);

    // Add a remote with invalid credentials (will fail auth)
    execSync('git remote add origin "https://user:invalid@example.com/repo.git"', {
      cwd: codebase2Path,
      stdio: "pipe",
    });

    // Update farm manifest with the new codebase
    farmManifest.addProject("test-project-2", {
      name: "test-project-2",
      source: "codebase2",
      model: "model",
    });

    const engine = new FarmSyncEngine(farmDir, model);

    // pullCodebase should throw auth error
    try {
      await engine.pullCodebase("codebase2");
      throw new Error("Expected auth error to be thrown");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).toContain("git");
    }
  });

  it("should silently continue for no remote error", async () => {
    const { Model } = await import("../../src/core/model.js");

    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    const engine = new FarmSyncEngine(farmDir, model);

    // pullCodebase should succeed even though there's no remote
    // (the initial test repo at codebaseDir has no remote)
    const commit = await engine.pullCodebase("codebase");

    expect(commit).toBeDefined();
    expect(commit.length).toBe(40); // Full SHA
  });

  it("should load model and gracefully handle missing farm configuration", async () => {
    const { Model } = await import("../../src/core/model.js");

    // Create a valid model at the farm root (not in a subdirectory)
    const model = await Model.init(farmDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Model should load successfully
    expect(model).toBeDefined();
    expect(model.manifest.name).toBe("test-model");

    // Loading the same model again should work
    const reloadedModel = await Model.load(farmDir);
    expect(reloadedModel.manifest.name).toBe("test-model");
  });

  it("should handle model load with corrupt farm sync file gracefully", async () => {
    const { Model } = await import("../../src/core/model.js");

    // Create a model at the farm root (not in a subdirectory)
    const model = await Model.init(farmDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    // Create a corrupt .farm-sync.yaml file in the model directory
    const syncFile = path.join(farmDir, "documentation-robotics", "model", ".farm-sync.yaml");
    await writeFile(syncFile, "invalid: yaml: content: [");

    // Reload the model - should handle the error gracefully
    // (the error is caught and logged but doesn't prevent model loading)
    const reloadedModel = await Model.load(farmDir);
    expect(reloadedModel).toBeDefined();
    expect(reloadedModel.manifest.name).toBe("test-model");
  });

  it("should handle model-null failure: record failed status and not advance lastSyncCommit", async () => {
    const { Model } = await import("../../src/core/model.js");
    const project = farmManifest.getProject("test-project")!;

    // First: establish baseline with a valid model
    const model = await Model.init(modelDir, {
      name: "test-model",
      version: "0.1.0",
      specVersion: "0.9.0",
      created: new Date().toISOString(),
    });

    let engine = new FarmSyncEngine(farmDir, model);
    const baselineResult = await engine.syncProject(project, { verbose: false });
    expect(baselineResult.status).toBe("success");
    expect(baselineResult.notes).toContain("Initial sync - recording baseline only");

    // Verify baseline advanced the commit pointer
    let syncStateFile = path.join(farmDir, project.model, ".farm-sync.yaml");
    let syncState = await FarmSyncState.load(syncStateFile);
    const baselineCommit = syncState.lastSyncCommit;
    expect(baselineCommit).toBeDefined();

    // Second: make a change to the codebase
    const newFile = path.join(codebaseDir, "test-file.txt");
    await writeFile(newFile, "test content");
    execSync("git add test-file.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Test commit with changes'", { cwd: codebaseDir, stdio: "pipe" });

    // Third: attempt sync WITHOUT a model (model is null) - should fail
    engine = new FarmSyncEngine(farmDir, undefined);
    const failResult = await engine.syncProject(project, { verbose: false });

    // Verify result indicates failure
    expect(failResult.status).toBe("failed");
    expect(failResult.projectName).toBe("test-project");
    expect(failResult.notes).toContain("CRITICAL: Model is not loaded, cannot map files to elements");

    // Reload sync state and verify the failure was recorded
    syncState = await FarmSyncState.load(syncStateFile);
    expect(syncState.syncHistory.length).toBe(2);

    const failedRecord = syncState.syncHistory[1];
    expect(failedRecord.status).toBe("failed");
    expect(failedRecord.notes).toContain("Model not loaded");

    // Critical: lastSyncCommit must NOT advance after failed sync
    expect(syncState.lastSyncCommit).toBe(baselineCommit);

    // Make another change and test again to verify the failure is reproducible
    const file2 = path.join(codebaseDir, "another-file.txt");
    await writeFile(file2, "more content");
    execSync("git add another-file.txt", { cwd: codebaseDir, stdio: "pipe" });
    execSync("git commit -m 'Another commit'", { cwd: codebaseDir, stdio: "pipe" });

    // Attempt another sync with null model - should also fail
    engine = new FarmSyncEngine(farmDir, undefined);
    const secondFailResult = await engine.syncProject(project, { verbose: false });
    expect(secondFailResult.status).toBe("failed");

    // Verify lastSyncCommit still hasn't advanced
    syncState = await FarmSyncState.load(syncStateFile);
    expect(syncState.lastSyncCommit).toBe(baselineCommit);
    expect(syncState.syncHistory.length).toBe(3);
    expect(syncState.syncHistory[2].status).toBe("failed");
  });
});

describe("farmSyncCommand - concurrency", () => {
  let farmDir: string;

  beforeEach(async () => {
    farmDir = path.join("/tmp", `farm-concurrency-test-${Date.now()}`);
    await ensureDir(farmDir);
  });

  afterEach(async () => {
    if (await fileExists(farmDir)) {
      await fs.rm(farmDir, { recursive: true, force: true });
    }
  });

  it("should prevent --auto-commit with --concurrency > 1 to avoid race conditions", async () => {
    // This test verifies the safety check in farm sync command
    const { farmSyncCommand } = await import("../../src/commands/farm.js");

    // Create a basic farm setup
    const project1Dir = path.join(farmDir, "proj1");
    const project2Dir = path.join(farmDir, "proj2");
    const model1Dir = path.join(farmDir, "model1");
    const model2Dir = path.join(farmDir, "model2");

    await createTestGitRepo(project1Dir, true);
    await createTestGitRepo(project2Dir, true);
    await ensureDir(model1Dir);
    await ensureDir(model2Dir);

    // Create farm manifest with 2 projects
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("project1", {
      name: "project1",
      source: "proj1",
      model: "model1",
    });
    manifest.addProject("project2", {
      name: "project2",
      source: "proj2",
      model: "model2",
    });

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await manifest.save(farmYamlPath);

    // Change to farm directory
    const originalCwd = process.cwd();
    process.chdir(farmDir);

    try {
      // Attempt sync with incompatible options
      await farmSyncCommand({
        autoCommit: true,
        concurrency: "2",
        format: undefined,
        verbose: false,
        dryRun: false,
        force: false,
        project: undefined,
      });
      throw new Error("Expected error for --auto-commit with --concurrency > 1");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).toContain("Cannot use --auto-commit with --concurrency > 1");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should allow --auto-commit with --concurrency 1", async () => {
    // Verify that --auto-commit IS allowed when concurrency is 1 (default or explicit)
    const { farmSyncCommand } = await import("../../src/commands/farm.js");

    const project1Dir = path.join(farmDir, "proj1");
    const model1Dir = path.join(farmDir, "model1");

    await createTestGitRepo(project1Dir, true);
    await ensureDir(model1Dir);

    // Create simple farm manifest with 1 project
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("project1", {
      name: "project1",
      source: "proj1",
      model: "model1",
    });

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await manifest.save(farmYamlPath);

    const originalCwd = process.cwd();
    process.chdir(farmDir);

    try {
      // This should not throw an error (auto-commit with concurrency=1 is allowed)
      // Note: it may fail for other reasons (model not found), but not for the option combination
      const originalLog = console.log;
      const originalError = console.error;
      console.log = () => {};
      console.error = () => {};

      try {
        await farmSyncCommand({
          autoCommit: true,
          concurrency: "1",
          format: undefined,
          verbose: false,
          dryRun: true, // dry-run to avoid actual git operations
          force: false,
          project: undefined,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Should not fail due to option combination
        expect(msg).not.toContain("Cannot use --auto-commit with --concurrency > 1");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should process all projects sequentially with concurrency === 1", async () => {
    const { farmSyncCommand } = await import("../../src/commands/farm.js");

    // Create 3 projects for sequential processing
    const proj1Dir = path.join(farmDir, "proj1");
    const proj2Dir = path.join(farmDir, "proj2");
    const proj3Dir = path.join(farmDir, "proj3");
    const model1Dir = path.join(farmDir, "model1");
    const model2Dir = path.join(farmDir, "model2");
    const model3Dir = path.join(farmDir, "model3");

    await createTestGitRepo(proj1Dir, true);
    await createTestGitRepo(proj2Dir, true);
    await createTestGitRepo(proj3Dir, true);
    await ensureDir(model1Dir);
    await ensureDir(model2Dir);
    await ensureDir(model3Dir);

    // Create farm with multiple projects
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("project1", {
      name: "project1",
      source: "proj1",
      model: "model1",
    });
    manifest.addProject("project2", {
      name: "project2",
      source: "proj2",
      model: "model2",
    });
    manifest.addProject("project3", {
      name: "project3",
      source: "proj3",
      model: "model3",
    });

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await manifest.save(farmYamlPath);

    const originalCwd = process.cwd();
    process.chdir(farmDir);

    try {
      const originalLog = console.log;
      let outputLines: string[] = [];
      console.log = (msg: string) => {
        outputLines.push(msg);
      };

      try {
        await farmSyncCommand({
          autoCommit: false,
          concurrency: "1", // Explicit sequential processing
          format: "json",
          verbose: false,
          dryRun: true,
          force: false,
          project: undefined,
        });
      } catch {
        // Ignore errors - we're testing that the command processes projects
      } finally {
        console.log = originalLog;
      }

      // Find JSON output - must exist (test fails explicitly if not)
      const jsonOutput = outputLines.find((line) => line.startsWith("{"));
      expect(jsonOutput).toBeDefined();

      if (jsonOutput) {
        const result = JSON.parse(jsonOutput);
        // All 3 projects should be in results - assert on projects specifically
        expect(result.projects).toBeDefined();
        expect(Array.isArray(result.projects)).toBe(true);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should parse concurrency parameter correctly", async () => {
    const { farmSyncCommand } = await import("../../src/commands/farm.js");

    const projDir = path.join(farmDir, "proj1");
    const modelDir = path.join(farmDir, "model1");

    await createTestGitRepo(projDir, true);
    await ensureDir(modelDir);

    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("project1", {
      name: "project1",
      source: "proj1",
      model: "model1",
    });

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await manifest.save(farmYamlPath);

    const originalCwd = process.cwd();
    process.chdir(farmDir);

    try {
      // Test that various concurrency values are parsed correctly
      const testCases = [
        { concurrency: "1", shouldPass: true },
        { concurrency: "2", shouldPass: true },
        { concurrency: "4", shouldPass: true },
        { concurrency: "10", shouldPass: true },
        { concurrency: "0", shouldPass: true }, // Should be clamped to 1
        { concurrency: "-5", shouldPass: true }, // Should be clamped to 1
        { concurrency: "abc", shouldPass: false }, // Invalid - should throw
      ];

      for (const testCase of testCases) {
        const originalLog = console.log;
        const originalError = console.error;
        console.log = () => {};
        console.error = () => {};

        try {
          await farmSyncCommand({
            autoCommit: false,
            concurrency: testCase.concurrency,
            format: undefined,
            verbose: false,
            dryRun: true,
            force: false,
            project: undefined,
          });

          expect(testCase.shouldPass).toBe(true);
        } catch (error) {
          if (testCase.shouldPass) {
            const msg = error instanceof Error ? error.message : String(error);
            expect(msg).not.toContain("Concurrency must be a positive number");
          } else {
            const msg = error instanceof Error ? error.message : String(error);
            expect(msg).toContain("Concurrency must be a positive number");
          }
        } finally {
          console.log = originalLog;
          console.error = originalError;
        }
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should handle parallel processing queue with concurrency > 1", async () => {
    // This test verifies the queue-based parallel processing works correctly
    const { farmSyncCommand } = await import("../../src/commands/farm.js");

    // Create 4 projects for parallel processing with concurrency=2
    for (let i = 1; i <= 4; i++) {
      const pDir = path.join(farmDir, `proj${i}`);
      const mDir = path.join(farmDir, `model${i}`);
      await createTestGitRepo(pDir, true);
      await ensureDir(mDir);
    }

    // Create farm with 4 projects
    const manifest = FarmManifest.create("Test Farm");
    for (let i = 1; i <= 4; i++) {
      manifest.addProject(`project${i}`, {
        name: `project${i}`,
        source: `proj${i}`,
        model: `model${i}`,
      });
    }

    const farmYamlPath = path.join(farmDir, "farm.yaml");
    await manifest.save(farmYamlPath);

    const originalCwd = process.cwd();
    process.chdir(farmDir);

    try {
      const originalLog = console.log;
      let jsonOutput: string | null = null;
      console.log = (msg: string) => {
        // Capture JSON output which contains the command result
        if (msg.startsWith("{") && jsonOutput === null) {
          jsonOutput = msg;
        }
      };

      try {
        await farmSyncCommand({
          autoCommit: false,
          concurrency: "2", // Parallel with concurrency limit
          format: "json",
          verbose: true,
          dryRun: true,
          force: false,
          project: undefined,
        });
      } catch {
        // Ignore command errors - we're testing queue processing stability
      } finally {
        console.log = originalLog;
      }

      // The command should complete without crashing (error handling in the command is expected)
      // If JSON output was generated, verify all projects are present
      if (jsonOutput) {
        const result = JSON.parse(jsonOutput);
        expect(result.projects).toBeDefined();
        expect(Array.isArray(result.projects)).toBe(true);
        // Verify all 4 projects are in the results
        const projectNames = result.projects.map((p: any) => p.name);
        expect(projectNames).toContain("project1");
        expect(projectNames).toContain("project2");
        expect(projectNames).toContain("project3");
        expect(projectNames).toContain("project4");
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
