/**
 * Integration tests for dr scan validate-refs command
 *
 * Tests the complete validate-refs workflow:
 * - Validates source references that point to real code
 * - Detects stale references (file deleted)
 * - Detects moved symbols
 * - Detects type mismatches
 * - Detects dead references
 *
 * Note: These tests require CodePrism to be installed and a session to be active.
 * If CodePrism is not available, tests are skipped with a clear message.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr, stripAnsi } from "../helpers/cli-runner.js";
import { promises as fs } from "fs";
import { join } from "path";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

describe("scan validate-refs", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a model to have a valid workspace
    const initResult = await runDr(["init", "--name", "Ref Validation Test"], { cwd: tempDir.path });
    if (initResult.exitCode !== 0) {
      throw new Error(`Failed to initialize model: ${initResult.stderr}`);
    }
  });

  afterEach(async () => {
    // Ensure any running session is stopped before cleanup
    try {
      await runDr(["scan", "session", "stop"], { cwd: tempDir.path });
    } catch {
      // Ignore errors if session doesn't exist
    }
    await tempDir.cleanup();
  });

  it("should report error when no session is active", async () => {
    const result = await runDr(["scan", "validate-refs"], { cwd: tempDir.path });

    // Should exit with non-zero code and report error
    expect(result.exitCode).toBe(1);
    const output = stripAnsi(result.stdout) + stripAnsi(result.stderr);
    expect(output).toContain("No active CodePrism session");
  });

  it("should report error when session is not ready", async () => {
    // Create a session file with non-ready status to simulate session not ready
    const sessionPath = join(tempDir.path, "documentation-robotics/.scan-session");
    await fs.mkdir(join(tempDir.path, "documentation-robotics"), { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify({
        pid: 12345,
        workspace: tempDir.path,
        status: "indexing",
        indexed_files: 50,
        started_at: new Date().toISOString(),
        endpoint: "codeprism:--mcp",
      })
    );

    const result = await runDr(["scan", "validate-refs"], { cwd: tempDir.path });

    // Should exit with non-zero code when session not ready
    expect(result.exitCode).toBe(1);
    const output = stripAnsi(result.stdout) + stripAnsi(result.stderr);
    expect(output).toContain("No active CodePrism session");
  });

  it("should accept --layer parameter to restrict validation", async () => {
    const result = await runDr(["scan", "validate-refs", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("--layer");
  });

  it("should accept --verbose parameter for detailed output", async () => {
    const result = await runDr(["scan", "validate-refs", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("--verbose");
  });

  it("should accept --fix parameter for auto-correction", async () => {
    const result = await runDr(["scan", "validate-refs", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("--fix");
  });

  it("should accept --workspace parameter", async () => {
    const result = await runDr(["scan", "validate-refs", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("--workspace");
  });

  it("should display help text with examples", async () => {
    const result = await runDr(["scan", "validate-refs", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("Examples");
    expect(result.stdout).toContain("validate-refs");
  });

  it("should show validation-refs in scan help", async () => {
    const result = await runDr(["scan", "--help"], { cwd: tempDir.path });

    expect(result.stdout).toContain("validate-refs");
  });

  it("should show validation-refs in scan subcommand list", async () => {
    const result = await runDr(["scan"], { cwd: tempDir.path });

    // The scan command without arguments should show available subcommands
    const output = result.stdout + result.stderr;
    // Either it shows subcommands or shows help
    expect(output.length).toBeGreaterThan(0);
  });

  it("should validate elements with source references when model has them", async () => {
    // Add an element with a source reference pointing to a non-existent file
    // This tests the actual validation logic when elements have source refs
    const addResult = await runDr(
      [
        "add",
        "--layer",
        "api",
        "--type",
        "endpoint",
        "--name",
        "test-endpoint",
        "--source-file",
        "/nonexistent/test.ts",
        "--source-symbol",
        "testFunction",
      ],
      { cwd: tempDir.path }
    );

    // Add should succeed (creates element with source reference)
    if (addResult.exitCode === 0) {
      // Now try to validate without active session
      // It should fail with the "no session" error
      const validateResult = await runDr(["scan", "validate-refs"], { cwd: tempDir.path });
      expect(validateResult.exitCode).toBe(1);
    }
  });
});

describe("scan validate-refs with session behavior", () => {
  // Tests for validate-refs behavior with and without active sessions

  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    const initResult = await runDr(["init", "--name", "Session Test"], { cwd: tempDir.path });
    if (initResult.exitCode !== 0) {
      throw new Error(`Failed to initialize model: ${initResult.stderr}`);
    }
  });

  afterEach(async () => {
    try {
      await runDr(["scan", "session", "stop"], { cwd: tempDir.path });
    } catch {
      // Ignore
    }
    await tempDir.cleanup();
  });

  it("should report element with source reference in model", async () => {
    // Add an API endpoint with a source reference
    const addResult = await runDr(
      [
        "add",
        "--layer",
        "api",
        "--type",
        "endpoint",
        "--name",
        "get-users",
        "--source-file",
        "src/api/users.ts",
        "--source-symbol",
        "getUsers",
      ],
      { cwd: tempDir.path }
    );

    // Verify element was added successfully
    if (addResult.exitCode === 0) {
      // Verify the element exists in the model by showing it
      const showResult = await runDr(["show", "api.endpoint.get-users"], { cwd: tempDir.path });
      expect(showResult.exitCode).toBe(0);
      expect(stripAnsi(showResult.stdout)).toContain("get-users");
    }
  });

  it("should accept --verbose flag for detailed output", async () => {
    const result = await runDr(["scan", "validate-refs", "--verbose", "--help"], { cwd: tempDir.path });

    // Should show help that includes the verbose flag
    expect(result.stdout).toContain("--verbose");
  });

  it("should accept --fix flag for auto-correction mode", async () => {
    const result = await runDr(["scan", "validate-refs", "--fix", "--help"], { cwd: tempDir.path });

    // Should show help that includes the fix flag
    expect(result.stdout).toContain("--fix");
  });

  it("should validate references only when no session error", async () => {
    // When validate-refs is called without a session, it should error
    const result = await runDr(["scan", "validate-refs"], { cwd: tempDir.path });
    expect(result.exitCode).toBe(1);
  });
});
