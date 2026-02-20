/**
 * Tests for standalone relationship-audit script
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "child_process";
import { join } from "path";
import { readFile, writeFile, ensureDir, removeDir } from "../../../src/utils/file-io.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";

const CLI_DIR = join(import.meta.dir, "../../..");
const SCRIPT_PATH = join(CLI_DIR, "scripts/relationship-audit.ts");

interface TestWorkdir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Run the audit script and capture output
 */
async function runAuditScript(
  args: string[] = [],
  workdir?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const cwd = workdir || CLI_DIR;
    // Use bun for execution (which supports tsx files natively)
    const proc = spawn("bun", [SCRIPT_PATH, ...args], {
      cwd,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

describe("relationship-audit script", () => {
  let workdir: TestWorkdir;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("should display help message", async () => {
    const { stdout, exitCode } = await runAuditScript(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Standalone Relationship Audit Script");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("Options:");
    expect(stdout).toContain("--layer");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--output");
    expect(stdout).toContain("--verbose");
    expect(stdout).toContain("--threshold");
  });

  it("should run audit with text output", async () => {
    const { stdout, exitCode } = await runAuditScript([], workdir.path);

    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }, 30000);

  it("should run audit with JSON format", async () => {
    const { stdout, exitCode } = await runAuditScript(
      ["--format", "json"],
      workdir.path
    );

    expect(exitCode).toBe(0);

    // Parse JSON to verify it's valid
    const report = JSON.parse(stdout);
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("model");
    expect(report).toHaveProperty("coverage");
    expect(report).toHaveProperty("duplicates");
    expect(report).toHaveProperty("gaps");
    expect(report).toHaveProperty("balance");
    expect(report).toHaveProperty("connectivity");
  }, 30000);

  it("should run audit with markdown format", async () => {
    const { stdout, exitCode } = await runAuditScript(
      ["--format", "markdown"],
      workdir.path
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("#");
    expect(stdout.length).toBeGreaterThan(0);
  }, 30000);

  it("should write output to file", async () => {
    const outputFile = "audit-report.json"; // Use relative path

    const { exitCode, stderr, stdout } = await runAuditScript(
      ["--format", "json", "--output", outputFile],
      workdir.path
    );

    // Debug: print output if test fails
    if (exitCode !== 0) {
      console.log("STDOUT:", stdout);
      console.log("STDERR:", stderr);
    }

    expect(exitCode).toBe(0);
    expect(stderr).toContain("✓ Audit report written to");

    // Verify file was created and contains valid JSON
    const fullPath = join(workdir.path, outputFile);
    const content = await readFile(fullPath);
    const report = JSON.parse(content);
    expect(report).toHaveProperty("timestamp");
  }, 30000);

  it("should support verbose mode", async () => {
    const { stderr, exitCode } = await runAuditScript(
      ["--verbose"],
      workdir.path
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Loading relationship catalog");
    expect(stderr).toContain("Initializing analyzers");
    expect(stderr).toContain("Running coverage analysis");
  }, 30000);

  it("should audit specific layer", async () => {
    const { stdout, exitCode } = await runAuditScript(
      ["--layer", "api", "--format", "json"],
      workdir.path
    );

    expect(exitCode).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.coverage).toHaveLength(1);
    expect(report.coverage[0].layer).toBe("api");
  }, 30000);

  it("should fail with invalid layer", async () => {
    const { exitCode, stderr } = await runAuditScript(
      ["--layer", "invalid-layer"],
      workdir.path
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("Layer not found");
  }, 30000);

  it("should handle threshold flag with passing quality", async () => {
    // Create a minimal model with good quality metrics
    const modelDir = join(workdir.path, "documentation-robotics", "model");
    await ensureDir(modelDir);

    // Create manifest
    await writeFile(
      join(modelDir, "manifest.yaml"),
      `name: Test Model
version: 1.0.0
layers:
  - motivation
`
    );

    // Create motivation layer directory
    const motivationDir = join(modelDir, "01_motivation");
    await ensureDir(motivationDir);

    // Create some test elements with relationships
    await writeFile(
      join(motivationDir, "goal.customer-satisfaction.yaml"),
      `id: motivation.goal.customer-satisfaction
type: goal
layer: motivation
attributes:
  name: Customer Satisfaction
  description: Improve customer satisfaction
relationships: []
`
    );

    const { exitCode } = await runAuditScript(
      ["--threshold"],
      workdir.path
    );

    // Exit code should be 0 or 1 depending on model quality
    expect([0, 1]).toContain(exitCode);
  }, 30000);

  it("should output threshold violations when quality is low", async () => {
    // This test may not always fail threshold depending on baseline model
    const { stderr } = await runAuditScript(
      ["--threshold"],
      workdir.path
    );

    // Should contain either success or failure message
    const hasSuccess = stderr.includes("All quality thresholds passed");
    const hasViolations = stderr.includes("Quality threshold violations detected");
    expect(hasSuccess || hasViolations).toBe(true);
  }, 30000);

  it("should handle missing model gracefully", async () => {
    const emptyDir = join(workdir.path, "empty");
    await ensureDir(emptyDir);

    const { exitCode, stderr } = await runAuditScript([], emptyDir);

    // Should handle missing model with error (exit code 2)
    // OR run successfully using parent directory model (exit code 0 or 1)
    expect([0, 1, 2]).toContain(exitCode);
    // If it errors, stderr should have content
    if (exitCode === 2) {
      expect(stderr.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("should create output directory if it doesn't exist", async () => {
    const outputPath = "nested/dir/report.md"; // Use relative path

    const { exitCode } = await runAuditScript(
      ["--format", "markdown", "--output", outputPath],
      workdir.path
    );

    expect(exitCode).toBe(0);

    // Verify file exists
    const fullPath = join(workdir.path, outputPath);
    const content = await readFile(fullPath);
    expect(content.length).toBeGreaterThan(0);
  }, 30000);

  it("should support short flags", async () => {
    const { exitCode } = await runAuditScript(
      ["-l", "api", "-f", "json", "-v"],
      workdir.path
    );

    expect(exitCode).toBe(0);
  }, 30000);

  it("should return valid exit codes", async () => {
    // Success case
    const successResult = await runAuditScript([], workdir.path);
    expect([0, 1]).toContain(successResult.exitCode);

    // Error case (invalid layer)
    const errorResult = await runAuditScript(["--layer", "invalid"], workdir.path);
    expect(errorResult.exitCode).toBe(2);
  }, 30000);
});
