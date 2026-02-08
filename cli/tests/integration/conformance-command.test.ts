/**
 * Integration tests for the conformance command
 * Verifies that the command executes successfully and produces expected output
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr, parseJsonOutput } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> };

describe("conformance command", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it("should execute successfully with no arguments", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
  });

  it('should output text that includes "Layer conformance"', async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Layer conformance");
  });

  it('should output "Summary" section', async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Summary");
  });

  it("should support --json output format", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance", "--json"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Should return valid JSON
    const output = parseJsonOutput(result);
    expect(output).toBeTruthy();
    expect(typeof output).toBe("object");
  });

  it("--json format should contain conformance data structure", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance", "--json"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    const output = parseJsonOutput(result) as Record<string, unknown>;
    expect(output).toHaveProperty("conformance");
  });

  it("should support --verbose output", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });
    await runDr(["add", "api", "endpoint", "api-endpoint-test-1", "--name", "Test"], {
      cwd: tempDir.path,
    });

    const result = await runDr(["conformance", "--verbose"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("should display consistent results on repeated runs", async () => {
    await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

    const result1 = await runDr(["conformance"], { cwd: tempDir.path });
    const result2 = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result1.exitCode).toBe(0);
    expect(result2.exitCode).toBe(0);
    expect(result1.stdout).toBe(result2.stdout);
  });

  it("should work with multiple elements across layers", async () => {
    await runDr(["init", "--name", "Multi-layer Model"], { cwd: tempDir.path });
    await runDr(["add", "motivation", "goal", "motivation-goal-test-1", "--name", "Goal"], {
      cwd: tempDir.path,
    });
    await runDr(
      ["add", "business", "business-service", "business-service-test-1", "--name", "Service"],
      { cwd: tempDir.path }
    );
    await runDr(["add", "api", "endpoint", "api-endpoint-test-1", "--name", "Endpoint"], {
      cwd: tempDir.path,
    });

    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Layer conformance");
  });

  it("should handle empty model gracefully", async () => {
    await runDr(["init", "--name", "Empty Model"], { cwd: tempDir.path });

    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Layer conformance");
  });

  it("should fail gracefully when model does not exist", async () => {
    const result = await runDr(["conformance"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(1);
  });
});
