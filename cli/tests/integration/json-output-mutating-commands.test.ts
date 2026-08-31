/**
 * Integration tests for --json flag on mutating commands
 * Tests that mutating commands (add, update, delete, relationship add/delete, changeset subcommands)
 * output valid JSON when --json flag is used
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

describe("JSON Output on Mutating Commands", () => {
  let workdir: TestWorkdir;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("dr add --json", () => {
    it("should output valid JSON with elementId, layer, type, name fields", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "customer-satisfaction",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toEqual("");

      const output = result.stdout.trim();
      const json = JSON.parse(output);

      expect(json.status).toBe("ok");
      expect(json.elementId).toContain("motivation.goal.");
      expect(json.layer).toBe("motivation");
      expect(json.type).toBe("goal");
      expect(json.name).toBe("customer-satisfaction");
      // Should not contain ANSI codes
      expect(output).not.toContain("\x1b");
    });

    it("should include changeset name when staging is active", async () => {
      // Create and activate a changeset
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "test-changeset",
      ]);

      const result = await runCLICommand(workdir.path, [
        "add",
        "api",
        "operation",
        "create-order",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBeUndefined(); // Not set for staged, only "ok"
      expect(json.changeset).toBe("test-changeset");
      expect(json.elementId).toContain("api.operation.");
    });
  });

  describe("dr update --json", () => {
    it("should output valid JSON with elementId, layer fields", async () => {
      // First add an element
      await runCLICommand(workdir.path, [
        "add",
        "business",
        "service",
        "order-mgmt",
      ]);

      // Then update it
      const result = await runCLICommand(workdir.path, [
        "update",
        "business.service.order-mgmt",
        "--name",
        "Order Management v2",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.elementId).toBe("business.service.order-mgmt");
      expect(json.layer).toBe("business");
      expect(json.name).toBe("Order Management v2");
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("dr delete --json", () => {
    it("should output valid JSON with elementId, layer, totalElementsDeleted", async () => {
      // First add an element
      await runCLICommand(workdir.path, [
        "add",
        "application",
        "service",
        "temp-service",
      ]);

      // Then delete it
      const result = await runCLICommand(workdir.path, [
        "delete",
        "application.service.temp-service",
        "--force",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.elementId).toBe("application.service.temp-service");
      expect(json.layer).toBe("application");
      expect(json.totalElementsDeleted).toBe(1);
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("dr relationship add --json", () => {
    it("should output valid JSON with source, target, predicate, layer fields", async () => {
      // Add two elements first
      await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "goal-a",
      ]);
      await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "goal-b",
      ]);

      const result = await runCLICommand(workdir.path, [
        "relationship",
        "add",
        "motivation.goal.goal-a",
        "motivation.goal.goal-b",
        "--predicate",
        "aggregates",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.source).toBe("motivation.goal.goal-a");
      expect(json.target).toBe("motivation.goal.goal-b");
      expect(json.predicate).toBe("aggregates");
      expect(json.layer).toBe("motivation");
      // Cardinality and strength may or may not be present depending on schema
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("dr relationship delete --json", () => {
    it("should output valid JSON with source, target, deletedCount fields", async () => {
      // Add two elements and a relationship
      await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "proc-a",
      ]);
      await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "proc-b",
      ]);
      await runCLICommand(workdir.path, [
        "relationship",
        "add",
        "business.process.proc-a",
        "business.process.proc-b",
        "--predicate",
        "aggregates",
      ]);

      const result = await runCLICommand(workdir.path, [
        "relationship",
        "delete",
        "business.process.proc-a",
        "business.process.proc-b",
        "--force",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.source).toBe("business.process.proc-a");
      expect(json.target).toBe("business.process.proc-b");
      expect(json.deletedCount).toBe(1);
      expect(json.layer).toBe("business");
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("JSON output with verbose flag", () => {
    it("should not mix human-oriented text with JSON in JSON mode", async () => {
      const result = await runCLICommand(workdir.path, [
        "add",
        "technology",
        "platform",
        "test-platform",
        "--verbose",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      // Output should be a single valid JSON object
      const output = result.stdout.trim();
      expect(output.startsWith("{")).toBe(true);
      expect(output.endsWith("}")).toBe(true);

      // Should parse as single JSON object
      const json = JSON.parse(output);
      expect(json.status).toBe("ok");
      expect(json.elementId).toBeDefined();

      // No separate info messages should appear
      const lines = result.stdout.split("\n");
      expect(lines.length).toBe(1);
    });
  });

  describe("Changeset commands JSON output", () => {
    it("dr changeset create --json should output valid JSON", async () => {
      const result = await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "test-changes",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.name).toBe("test-changes");
      expect(json.changesetId).toBeDefined();
      expect(result.stdout).not.toContain("\x1b");
    });

    it("dr changeset revert --json should output valid JSON", async () => {
      // Create and activate a changeset
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "temp-changes",
      ]);

      const result = await runCLICommand(workdir.path, [
        "changeset",
        "revert",
        "temp-changes",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changesetName).toBe("temp-changes");
      expect(result.stdout).not.toContain("\x1b");
    });

    it("dr changeset activate --json should output valid JSON", async () => {
      // Create a changeset
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "activate-test",
      ]);
      // Deactivate it
      await runCLICommand(workdir.path, ["changeset", "deactivate"]);

      const result = await runCLICommand(workdir.path, [
        "changeset",
        "activate",
        "activate-test",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changesetName).toBe("activate-test");
      expect(result.stdout).not.toContain("\x1b");
    });
  });
});
