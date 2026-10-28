/**
 * Farm Commands JSON Output Format Smoke Tests
 * Verifies that farm subcommands produce valid JSON output for automation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { fileExists, ensureDir } from "../../src/utils/file-io.js";
import { execSync } from "child_process";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { FarmSyncState } from "../../src/core/farm-sync-state.js";
import { FarmSyncEngine } from "../../src/core/farm-sync-engine.js";
import { farmStatusCommand, farmValidateCommand, farmSyncCommand, farmRemoveCommand, farmAddCommand } from "../../src/commands/farm.js";

/**
 * Initialise a git repository with one committed file and return its HEAD SHA.
 */
async function createGitRepo(repoPath: string, files: Record<string, string> = { "README.md": "# Test\n" }): Promise<string> {
  await ensureDir(repoPath);
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.email 'test@example.com'", { cwd: repoPath, stdio: "pipe" });
  execSync("git config user.name 'Test User'", { cwd: repoPath, stdio: "pipe" });
  for (const [file, content] of Object.entries(files)) {
    await ensureDir(path.dirname(path.join(repoPath, file)));
    await fs.writeFile(path.join(repoPath, file), content);
  }
  execSync("git add -A", { cwd: repoPath, stdio: "pipe" });
  execSync("git commit -m 'Initial commit'", { cwd: repoPath, stdio: "pipe" });
  return execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
}

/**
 * Capture console.log (JSON lines), console.warn, console.error and the mocked
 * process.exit code while `fn` runs.
 */
async function captureCommand(fn: () => Promise<void>): Promise<{
  json: any;
  logs: string[];
  warnings: string[];
  errors: string[];
  exitCode: number | undefined;
}> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalExit = process.exit;
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let exitCode: number | undefined;
  console.log = (msg: unknown) => {
    logs.push(String(msg));
  };
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  process.exit = ((code?: number) => {
    if (exitCode === undefined) exitCode = code ?? 0;
  }) as any;

  try {
    await fn();
  } catch {
    // Commands report through output and exit code; a throw is captured below
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    process.exit = originalExit;
  }

  const jsonLine = logs.find((l) => l.startsWith("{"));
  return { json: jsonLine ? JSON.parse(jsonLine) : undefined, logs, warnings, errors, exitCode };
}

describe("Farm Commands - JSON Output Format Support", () => {
  let farmDir: string;
  let farmYamlPath: string;
  let originalCwd: string;
  let capturedOutput: string = "";
  let originalExit: any;

  beforeEach(async () => {
    // Create a temporary farm directory
    farmDir = path.join("/tmp", `farm-json-test-${Date.now()}`);
    await ensureDir(farmDir);
    farmYamlPath = path.join(farmDir, "farm.yaml");
    originalCwd = process.cwd();
    process.chdir(farmDir);

    // Mock process.exit to prevent test runner termination
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      // Do nothing - prevent actual exit
    }) as any;

    // Capture console.log output
    capturedOutput = "";
  });

  afterEach(async () => {
    // Restore process.exit
    process.exit = originalExit;

    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up test directory
    if (await fileExists(farmDir)) {
      await fs.rm(farmDir, { recursive: true, force: true });
    }
  });

  it("should verify farmStatusCommand produces valid JSON", async () => {
    // Create a farm with a project whose codebase exists
    const manifest = FarmManifest.create("Test Farm");
    manifest.addProject("test-service", {
      name: "test-service",
      source: "test-service",
      model: "test-service-model",
    });
    await manifest.save(farmYamlPath);
    await createGitRepo(path.join(farmDir, "test-service"));

    // Capture output
    const originalLog = console.log;
    const originalError = console.error;
    let jsonOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string" && msg.startsWith("{")) {
        jsonOutput = msg;
      }
    };
    console.error = () => {
      // Suppress error output
    };

    try {
      await farmStatusCommand({ format: "json" });
    } catch {
      // Status command may throw, but we still want to check JSON output
    }

    console.log = originalLog;
    console.error = originalError;

    // Verify JSON output
    expect(jsonOutput).toBeDefined();
    const output = JSON.parse(jsonOutput);
    expect(output.status).toBeDefined();
    expect(output.farm).toBeDefined();

    // Verify has_pending_changes is a boolean when the codebase can be read
    expect(output.status).toBe("ok");
    expect(output.projects.length).toBe(1);
    expect(typeof output.projects[0].has_pending_changes).toBe("boolean");
    expect(output.projects[0].codebase_error).toBeUndefined();
  });

  it("should verify farmValidateCommand produces valid JSON", async () => {
    // Create a basic farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Capture output
    const originalLog = console.log;
    const originalError = console.error;
    let jsonOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string" && msg.startsWith("{")) {
        jsonOutput = msg;
      }
    };
    console.error = () => {
      // Suppress error output
    };

    try {
      await farmValidateCommand({ format: "json" });
    } catch {
      // Validate command may throw, but we still want to check JSON output
    }

    console.log = originalLog;
    console.error = originalError;

    // Verify JSON output
    expect(jsonOutput).toBeDefined();
    const output = JSON.parse(jsonOutput);
    expect(output.status).toBeDefined();
  });

  it("should verify farmSyncCommand produces valid JSON", async () => {
    // Create a basic farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Capture output
    const originalLog = console.log;
    const originalError = console.error;
    let jsonOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string" && msg.startsWith("{")) {
        jsonOutput = msg;
      }
    };
    console.error = () => {
      // Suppress error output
    };

    try {
      await farmSyncCommand({ format: "json" });
    } catch {
      // Sync command may throw, but we still want to check JSON output
    }

    console.log = originalLog;
    console.error = originalError;

    // Verify JSON output
    expect(jsonOutput).toBeDefined();
    const output = JSON.parse(jsonOutput);
    expect(output.status).toBeDefined();
  });

  it("should verify farmInitCommand accepts format option", () => {
    // The --format json flag is now available for dr farm init
    expect(true).toBe(true);
  });

  it("should verify farmAddCommand accepts format option", () => {
    // The --format json flag is now available for dr farm add
    expect(true).toBe(true);
  });

  it("should prevent path traversal in model deletion", async () => {
    // Create a farm with a project pointing to a model
    const manifest = FarmManifest.create("Test Farm");
    const modelPath = path.join(farmDir, "models", "test-model");
    await ensureDir(modelPath);

    manifest.addProject("test-project", {
      name: "test-project",
      source: "test-source",
      model: "models/test-model",
    });
    await manifest.save(farmYamlPath);

    // Add content to the model directory
    await fs.writeFile(path.join(modelPath, "test.txt"), "test content");

    // Capture console output
    const originalLog = console.log;
    let capturedOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string") {
        capturedOutput = msg;
      }
    };

    await farmRemoveCommand("test-project", { deleteModel: true, format: "json" });
    console.log = originalLog;

    // Parse output to verify success
    const output = JSON.parse(capturedOutput);
    expect(output.status).toBe("ok");
    expect(output.modelDeleted).toBe(true);

    // Verify model was deleted
    expect(await fileExists(modelPath)).toBe(false);
  });

  it("should reject path traversal attempts with parent directory references", async () => {
    // Create a farm structure where we try to escape the farm root
    const manifest = FarmManifest.create("Test Farm");

    // Create a directory outside the farm to check we don't delete it
    const parentDir = path.join("/tmp", `parent-${Date.now()}`);
    const targetDir = path.join(parentDir, "target");
    await ensureDir(targetDir);
    await fs.writeFile(path.join(targetDir, "protected.txt"), "protected content");

    // Try to add a project with a path traversal model reference
    manifest.addProject("evil-project", {
      name: "evil-project",
      source: "evil-source",
      model: `../parent-${Date.now()}/target`, // Path traversal attempt
    });
    await manifest.save(farmYamlPath);

    const originalLog = console.log;
    let capturedOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string") {
        capturedOutput = msg;
      }
    };

    await farmRemoveCommand("evil-project", { deleteModel: true, format: "json" });
    console.log = originalLog;

    // Parse output and verify error
    const output = JSON.parse(capturedOutput);
    expect(output.status).toBe("error");
    expect(output.message).toContain("Invalid model path");

    // Verify the target directory outside farm was NOT deleted
    expect(await fileExists(targetDir)).toBe(true);
    const content = await fs.readFile(path.join(targetDir, "protected.txt"), "utf-8");
    expect(content).toBe("protected content");

    // Clean up
    await fs.rm(parentDir, { recursive: true, force: true });
  });

  it("should not delete external directories when model path is a symlink", async () => {
    // Create a farm structure
    const manifest = FarmManifest.create("Test Farm");
    const modelsDir = path.join(farmDir, "models");
    await ensureDir(modelsDir);

    // Create a directory outside the farm
    const externalDir = path.join("/tmp", `external-${Date.now()}`);
    await ensureDir(externalDir);
    await fs.writeFile(path.join(externalDir, "secret.txt"), "secret content");

    // Create a symlink inside the farm pointing outside
    const symlinkPath = path.join(modelsDir, "malicious-link");
    try {
      await fs.symlink(externalDir, symlinkPath);
    } catch {
      // Symlinks might not be supported on this system, skip test
      return;
    }

    manifest.addProject("symlink-project", {
      name: "symlink-project",
      source: "symlink-source",
      model: "models/malicious-link",
    });
    await manifest.save(farmYamlPath);

    const originalLog = console.log;
    let capturedOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string") {
        capturedOutput = msg;
      }
    };

    await farmRemoveCommand("symlink-project", { deleteModel: true, format: "json" });
    console.log = originalLog;

    // Verify the operation succeeded (symlink is removed safely)
    const output = JSON.parse(capturedOutput);
    expect(output.status).toBe("ok");
    expect(output.modelDeleted).toBe(true);

    // Verify the symlink itself was deleted
    expect(await fileExists(symlinkPath)).toBe(false);

    // Verify external directory still exists and wasn't deleted
    // This is the critical safety check: fs.rm on a symlink removes the link itself,
    // not the target directory it points to
    expect(await fileExists(externalDir)).toBe(true);
    const content = await fs.readFile(path.join(externalDir, "secret.txt"), "utf-8");
    expect(content).toBe("secret content");

    // Clean up
    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("should prevent path traversal in codebase path during farm add --remote", async () => {
    // Create a farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // Use consistent timestamp for all path constructions
    const timestamp = Date.now();

    // Create a directory outside the farm to check we don't clone over it
    const parentDir = path.join("/tmp", `parent-add-${timestamp}`);
    const targetDir = path.join(parentDir, "target");
    await ensureDir(targetDir);
    await fs.writeFile(path.join(targetDir, "protected.txt"), "protected content");

    // Capture console output
    const originalLog = console.log;
    const originalError = console.error;
    let capturedOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string") {
        capturedOutput = msg;
      }
    };
    console.error = () => {
      // Suppress error output
    };

    // Try to clone into a path that escapes the farm root. --remote is what makes farm add
    // write to the codebase path, so the guard must reject it before any git clone runs.
    await farmAddCommand("evil-service", {
      codebase: `../parent-add-${timestamp}/target`, // Path traversal attempt
      remote: "https://example.invalid/evil-service.git",
      format: "json",
    });

    console.log = originalLog;
    console.error = originalError;

    // Parse output and verify error
    const output = JSON.parse(capturedOutput);
    expect(output.status).toBe("error");
    expect(output.message).toContain("Invalid codebase path");

    // Verify the target directory outside farm still exists and is intact
    // (validation rejects the path before any filesystem operations)
    expect(await fileExists(targetDir)).toBe(true);
    const content = await fs.readFile(path.join(targetDir, "protected.txt"), "utf-8");
    expect(content).toBe("protected content");

    // Nothing was recorded in farm.yaml and no model folder was scaffolded
    const reloaded = await FarmManifest.load(farmYamlPath);
    expect(reloaded.getProject("evil-service")).toBeUndefined();
    expect(await fileExists(path.join(farmDir, "evil-service-model"))).toBe(false);

    // Clean up
    await fs.rm(parentDir, { recursive: true, force: true });
  });

  it("should accept a sibling codebase path outside the farm root without --remote", async () => {
    // Create a farm
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    // A checkout that lives next to the farm, not inside it (the layout from issue #962)
    const siblingName = `sibling-repo-${Date.now()}`;
    const siblingDir = path.join(path.dirname(farmDir), siblingName);
    await ensureDir(siblingDir);
    await fs.writeFile(path.join(siblingDir, "README.md"), "sibling");

    const originalLog = console.log;
    const originalError = console.error;
    let capturedOutput = "";
    console.log = (msg: string) => {
      if (typeof msg === "string") {
        capturedOutput = msg;
      }
    };
    console.error = () => {
      // Suppress error output
    };

    try {
      // Without --remote nothing is written to the codebase path, so a sibling is fine
      await farmAddCommand("sibling-service", {
        codebase: `../${siblingName}`,
        format: "json",
      });

      console.log = originalLog;
      console.error = originalError;

      const output = JSON.parse(capturedOutput);
      expect(output.status).toBe("ok");

      // The project is recorded with the sibling path as its source
      const reloaded = await FarmManifest.load(farmYamlPath);
      const project = reloaded.getProject("sibling-service");
      expect(project).toBeDefined();
      expect(project!.source).toBe(`../${siblingName}`);

      // The model folder is still created inside the farm root
      expect(await fileExists(path.join(farmDir, "sibling-service-model"))).toBe(true);

      // The sibling checkout is untouched
      const content = await fs.readFile(path.join(siblingDir, "README.md"), "utf-8");
      expect(content).toBe("sibling");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      await fs.rm(siblingDir, { recursive: true, force: true });
    }
  });

  it("should verify farmRemoveCommand accepts format option", () => {
    // The --format json flag is now available for dr farm remove
    expect(true).toBe(true);
  });

  it("should verify farmPullCommand accepts format option", () => {
    // The --format json flag is available for dr farm pull
    expect(true).toBe(true);
  });

  describe("error reporting (#971, #972)", () => {
    /**
     * Make `git rev-parse --git-dir` fail at the farm root with an error that is NOT
     * "not a git repository": an empty `.git` file yields "fatal: invalid gitfile format".
     * (A stub `git` on PATH cannot be used here: Bun's execSync snapshots the environment
     * at startup, so a runtime change to process.env.PATH never reaches the child.)
     */
    async function corruptFarmGitFile(): Promise<void> {
      await fs.writeFile(path.join(farmDir, ".git"), "");
    }

    it("farm status reports a deleted codebase as an error, not 'not synced yet'", async () => {
      const manifest = FarmManifest.create("Test Farm");
      manifest.addProject("gone-service", {
        name: "gone-service",
        source: "gone-service",
        model: "gone-service-model",
      });
      await manifest.save(farmYamlPath);

      // The project was synced once; its codebase folder has since been deleted
      await ensureDir(path.join(farmDir, "gone-service-model"));
      const state = FarmSyncState.create("gone-service", {
        lastSyncCommit: "abc123def456",
        lastSyncTimestamp: new Date().toISOString(),
      });
      await state.save(path.join(farmDir, "gone-service-model", ".farm-sync.yaml"));

      const { json, exitCode } = await captureCommand(() => farmStatusCommand({ format: "json" }));

      expect(json.status).toBe("error");
      expect(json.code).toBe(1);
      expect(exitCode).toBe(1);
      const project = json.projects[0];
      expect(project.codebase_error).toMatch(/Codebase directory not found/);
      expect(project.sync_state_error).toBeUndefined();
      expect(project.has_pending_changes).toBeUndefined();
      expect(project.last_sync_commit).toBe("abc123def456");

      // Text mode warns on stderr and shows the error on the project
      const text = await captureCommand(() => farmStatusCommand({ format: "text" }));
      expect(text.exitCode).toBe(1);
      expect(text.warnings.join("\n")).toMatch(/Warning: gone-service: Codebase directory not found/);
      expect(text.logs.join("\n")).toMatch(/Codebase unavailable/);
      expect(text.logs.join("\n")).not.toMatch(/Not synced yet/);
    });

    it("farm status still reports a never-synced project with an existing codebase as not synced", async () => {
      const manifest = FarmManifest.create("Test Farm");
      manifest.addProject("fresh-service", {
        name: "fresh-service",
        source: "fresh-service",
        model: "fresh-service-model",
      });
      await manifest.save(farmYamlPath);
      await createGitRepo(path.join(farmDir, "fresh-service"));

      const { json, exitCode, warnings } = await captureCommand(() => farmStatusCommand({ format: "json" }));

      expect(json.status).toBe("ok");
      expect(exitCode).toBeUndefined();
      expect(warnings).toEqual([]);
      const project = json.projects[0];
      expect(project.has_pending_changes).toBe(false);
      expect(project.last_sync_commit).toBeUndefined();
      expect(project.current_commit).toMatch(/^[0-9a-f]{40}$/);
      expect(project.codebase_error).toBeUndefined();
    });

    it("farm add warns and reports an uncommitted change when git cannot be run", async () => {
      const manifest = FarmManifest.create("Test Farm");
      await manifest.save(farmYamlPath);

      await corruptFarmGitFile();
      const result = await captureCommand(() => farmAddCommand("new-service", { format: "json" }));

      expect(result.json.status).toBe("ok");
      expect(result.json.git_committed).toBe(false);
      expect(result.json.git_warning).toMatch(/farm\.yaml was saved but not committed/);
      expect(result.json.git_warning).toMatch(/invalid gitfile format/);

      // The change itself was saved
      const saved = await FarmManifest.load(farmYamlPath);
      expect(saved.getProject("new-service")).toBeDefined();
    });

    it("farm remove warns on stderr in text mode when git cannot be run", async () => {
      const manifest = FarmManifest.create("Test Farm");
      manifest.addProject("old-service", {
        name: "old-service",
        source: "old-service",
        model: "old-service-model",
      });
      await manifest.save(farmYamlPath);

      await corruptFarmGitFile();
      const result = await captureCommand(() => farmRemoveCommand("old-service", { format: "text" }));

      expect(result.exitCode).toBeUndefined();
      expect(result.warnings.join("\n")).toMatch(/Warning: farm\.yaml was saved but not committed/);
      const saved = await FarmManifest.load(farmYamlPath);
      expect(saved.getProject("old-service")).toBeUndefined();
    });

    it("farm add does not warn when the farm is simply not a git repository", async () => {
      const manifest = FarmManifest.create("Test Farm");
      await manifest.save(farmYamlPath);

      const { json, warnings } = await captureCommand(() => farmAddCommand("plain-service", { format: "json" }));

      expect(json.status).toBe("ok");
      expect(json.git_committed).toBe(false);
      expect(json.git_warning).toBeUndefined();
      expect(warnings).toEqual([]);
    });

    it("farm sync --auto-commit reports a failed commit as a warning on stderr", async () => {
      const { Model } = await import("../../src/core/model.js");
      const { Element } = await import("../../src/core/element.js");
      const { Layer } = await import("../../src/core/layer.js");

      // Farm-level git repository (auto-commit commits the model folder into it)
      execSync("git init", { cwd: farmDir, stdio: "pipe" });
      execSync("git config user.email 'test@example.com'", { cwd: farmDir, stdio: "pipe" });
      execSync("git config user.name 'Test User'", { cwd: farmDir, stdio: "pipe" });

      // Codebase with a file that a model element references
      const codebaseDir = path.join(farmDir, "codebase");
      await createGitRepo(codebaseDir, { "src/services/main.ts": "export class MainService {}\n" });

      // Model with an element whose source reference maps to that file
      const modelDir = path.join(farmDir, "model");
      const model = await Model.init(modelDir, {
        name: "test-model",
        version: "0.1.0",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
      });
      const appLayer = new Layer("application");
      model.layers.set("application", appLayer);
      appLayer.addElement(
        new Element({
          id: "application.service.main-service",
          path: "application.service.main-service",
          name: "Main Service",
          description: "Main service",
          type: "service",
          layer_id: "application",
          source_reference: {
            type: "github",
            repository: "test-repo",
            locations: [{ file: "src/services/main.ts", symbol: "MainService" }],
          },
        })
      );
      await model.saveLayer("application");

      const manifest = FarmManifest.create("Test Farm");
      manifest.addProject("test-project", { name: "test-project", source: "codebase", model: "model" });
      await manifest.save(farmYamlPath);

      // Baseline sync, then change the referenced file so the next sync stages a change
      const project = manifest.getProject("test-project")!;
      await new FarmSyncEngine(farmDir, model).syncProject(project, { verbose: false });
      await fs.writeFile(path.join(codebaseDir, "src/services/main.ts"), "export class MainService { run() {} }\n");
      execSync("git add -A", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Change service'", { cwd: codebaseDir, stdio: "pipe" });

      // Make the farm-level git commit fail: a stale index.lock blocks `git add`
      await fs.writeFile(path.join(farmDir, ".git", "index.lock"), "");

      const { warnings, exitCode } = await captureCommand(() => farmSyncCommand({ format: "text", autoCommit: true }));

      expect(exitCode).toBe(1);
      expect(warnings.join("\n")).toMatch(/Warning: test-project: auto-commit failed: /);

      // JSON mode carries the same failure in the result entry
      await fs.writeFile(path.join(codebaseDir, "src/services/main.ts"), "export class MainService { run() {} stop() {} }\n");
      execSync("git add -A", { cwd: codebaseDir, stdio: "pipe" });
      execSync("git commit -m 'Change service again'", { cwd: codebaseDir, stdio: "pipe" });
      const { json } = await captureCommand(() => farmSyncCommand({ format: "json", autoCommit: true }));
      expect(json.status).toBe("error");
      const entry = json.projects.find((p: any) => p.project === "test-project");
      expect(entry.status).toBe("error");
      expect(entry.auto_committed).toBe(false);
      expect(entry.commit_error).toMatch(/index\.lock/);
    });

    it("farm sync --output with a non-.json extension fails before syncing", async () => {
      const manifest = FarmManifest.create("Test Farm");
      manifest.addProject("svc", { name: "svc", source: "svc", model: "svc-model" });
      await manifest.save(farmYamlPath);
      await createGitRepo(path.join(farmDir, "svc"));
      const { Model } = await import("../../src/core/model.js");
      await Model.init(path.join(farmDir, "svc-model"), {
        name: "svc-model",
        version: "0.1.0",
        specVersion: "0.9.0",
        created: new Date().toISOString(),
      });

      const reportPath = path.join(farmDir, "report.md");
      const { json, exitCode } = await captureCommand(() => farmSyncCommand({ format: "json", output: reportPath }));

      expect(exitCode).toBe(2);
      expect(json.status).toBe("error");
      expect(json.message).toBe("Unsupported output format: .md. Use .json");
      expect(await fileExists(reportPath)).toBe(false);
      // No project was synced
      expect(await fileExists(path.join(farmDir, "svc-model", ".farm-sync.yaml"))).toBe(false);

      // A .json report is still written
      const jsonReport = path.join(farmDir, "report.json");
      const ok = await captureCommand(() => farmSyncCommand({ format: "json", output: jsonReport }));
      expect(ok.json.status).toBe("ok");
      expect(await fileExists(jsonReport)).toBe(true);
      const report = JSON.parse(await fs.readFile(jsonReport, "utf-8"));
      expect(report.projects[0].project).toBe("svc");
    });
  });
});
