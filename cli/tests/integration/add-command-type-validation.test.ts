/**
 * Integration tests for add command with element type validation
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { spawn } from "child_process";
import * as path from "path";

interface TestWorkdir {
  path: string;
  cleanup: () => Promise<void>;
}

// Helper to run CLI command and capture output
async function runCLICommand(
  workdir: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), "dist", "cli.js");
    const proc = spawn("node", [cliPath, ...args], { cwd: workdir });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.toString();
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

describe("Add Command - Type Validation", () => {
  let workdir: TestWorkdir;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("Valid type for layer", () => {
    it("should accept valid motivation.goal type", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "customer-satisfaction",
        "--description",
        "Test goal",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("customer-satisfaction");
    });

    it("should accept valid api.operation type", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "api",
        "operation",
        "create-order",
        "--description",
        "Test operation",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("create-order");
    });

    it("should accept valid data-store.table type", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "data-store",
        "table",
        "users",
        "--description",
        "Users table",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("users");
    });
  });

  describe("Invalid type for layer", () => {
    it("should reject goal type in api layer", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "api",
        "goal",
        "test-element",
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("Invalid element type");
    });

    it("should reject operation type in motivation layer", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "operation",
        "test-element",
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("Invalid element type");
    });

    it("should reject table type in api layer", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "api",
        "table",
        "test-element",
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("Invalid element type");
    });
  });

  describe("Type validation error messages", () => {
    it("should show valid types when invalid type is provided", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "invalid-type",
        "test",
      ]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Valid types for motivation:");
      expect(output).toContain("goal");
      expect(output).toContain("requirement");
    });

    it("should suggest similar types for typos", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goel", // Typo: should be "goal"
        "test",
      ]);

      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Did you mean:");
    });
  });

  describe("Type validation with different layers", () => {
    it("should validate types for all layers", async () => {
      const testCases = [
        { layer: "motivation", validType: "goal", invalidType: "operation" },
        { layer: "business", validType: "businessservice", invalidType: "goal" },
        { layer: "api", validType: "operation", invalidType: "goal" },
        { layer: "data-store", validType: "table", invalidType: "goal" },
      ];

      for (const testCase of testCases) {
        // Valid type should work
        const validResult = await runCLICommand(workdir.path, [
          "add",
          testCase.layer,
          testCase.validType,
          `test-${testCase.validType}`,
          "--description",
          `Test ${testCase.validType}`,
        ]);
        expect(validResult.exitCode).toBe(0);

        // Invalid type should fail
        const invalidResult = await runCLICommand(workdir.path, [
          "add",
          testCase.layer,
          testCase.invalidType,
          `test-${testCase.invalidType}`,
        ]);
        expect(invalidResult.exitCode).not.toBe(0);
      }
    });
  });
});
