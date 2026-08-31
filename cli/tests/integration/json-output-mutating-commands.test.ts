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
        "--name",
        "Customer Satisfaction",
        "--attributes",
        '{"priority":"high"}',
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
      expect(json.name).toBe("Customer Satisfaction");
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
        "--name",
        "Create Order",
        "--attributes",
        '{"operationId":"createOrder","summary":"Create a new order","tags":"orders"}',
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changeset).toBe("test-changeset");
      expect(json.elementId).toContain("api.operation.");
    });
  });

  describe("dr update --json", () => {
    it("should output valid JSON with elementId, layer fields", async () => {
      // First add an element
      const addResult = await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "order-mgmt",
        "--json",
      ]);

      expect(addResult.exitCode).toBe(0);
      const addedJson = JSON.parse(addResult.stdout.trim());
      const elementId = addedJson.elementId;

      // Then update it
      const result = await runCLICommand(workdir.path, [
        "update",
        elementId,
        "--name",
        "Order Management v2",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.elementId).toBe(elementId);
      expect(json.layer).toBe("business");
      expect(json.name).toBe("Order Management v2");
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("dr delete --json", () => {
    it("should output valid JSON with elementId, layer, totalElementsDeleted", async () => {
      // First add an element
      const addResult = await runCLICommand(workdir.path, [
        "add",
        "application",
        "component",
        "temp-component",
        "--json",
      ]);

      expect(addResult.exitCode).toBe(0);
      const addedJson = JSON.parse(addResult.stdout.trim());
      const elementId = addedJson.elementId;

      // Then delete it
      const result = await runCLICommand(workdir.path, [
        "delete",
        elementId,
        "--force",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.elementId).toBe(elementId);
      expect(json.layer).toBe("application");
      expect(json.totalElementsDeleted).toBe(1);
      // Should not contain ANSI codes
      expect(result.stdout).not.toContain("\x1b");
    });
  });

  describe("dr relationship add --json", () => {
    it("should output valid JSON with source, target, predicate, layer fields", async () => {
      // Add two elements first
      const add1Result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "goal-a",
        "--name",
        "Goal A",
        "--attributes",
        '{"priority":"high"}',
        "--json",
      ]);
      expect(add1Result.exitCode).toBe(0);
      const goal1Id = JSON.parse(add1Result.stdout.trim()).elementId;

      const add2Result = await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "goal-b",
        "--name",
        "Goal B",
        "--attributes",
        '{"priority":"high"}',
        "--json",
      ]);
      expect(add2Result.exitCode).toBe(0);
      const goal2Id = JSON.parse(add2Result.stdout.trim()).elementId;

      const result = await runCLICommand(workdir.path, [
        "relationship",
        "add",
        goal1Id,
        goal2Id,
        "--predicate",
        "aggregates",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.source).toBe(goal1Id);
      expect(json.target).toBe(goal2Id);
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
      const add1Result = await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "proc-a",
        "--json",
      ]);
      expect(add1Result.exitCode).toBe(0);
      const proc1Id = JSON.parse(add1Result.stdout.trim()).elementId;

      const add2Result = await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "proc-b",
        "--json",
      ]);
      expect(add2Result.exitCode).toBe(0);
      const proc2Id = JSON.parse(add2Result.stdout.trim()).elementId;

      await runCLICommand(workdir.path, [
        "relationship",
        "add",
        proc1Id,
        proc2Id,
        "--predicate",
        "aggregates",
      ]);

      const result = await runCLICommand(workdir.path, [
        "relationship",
        "delete",
        proc1Id,
        proc2Id,
        "--force",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.source).toBe(proc1Id);
      expect(json.target).toBe(proc2Id);
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
        "artifact",
        "test-artifact",
        "--name",
        "Test Artifact",
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
      expect(json.changesetName).toBe("test-changes");
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

    it("dr changeset apply --json should output valid JSON", async () => {
      // Create a changeset with some changes
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "apply-test",
      ]);

      // Add an element (will be staged)
      await runCLICommand(workdir.path, [
        "add",
        "motivation",
        "goal",
        "test-goal",
        "--name",
        "Test Goal",
        "--attributes",
        '{"priority":"high"}',
      ]);

      const result = await runCLICommand(workdir.path, [
        "changeset",
        "apply",
        "apply-test",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changesetName).toBe("apply-test");
      expect(json.committed).toBeGreaterThanOrEqual(0);
      expect(result.stdout).not.toContain("\x1b");
    });

    it("dr changeset deactivate --json should output valid JSON", async () => {
      // Create and keep a changeset active
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "deactivate-test",
      ]);

      const result = await runCLICommand(workdir.path, [
        "changeset",
        "deactivate",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changesetId).toBeDefined();
      expect(result.stdout).not.toContain("\x1b");
    });

    it("dr changeset delete --json should output valid JSON", async () => {
      // Create and deactivate a changeset
      await runCLICommand(workdir.path, [
        "changeset",
        "create",
        "delete-test",
      ]);
      await runCLICommand(workdir.path, ["changeset", "deactivate"]);

      const result = await runCLICommand(workdir.path, [
        "changeset",
        "delete",
        "delete-test",
        "--force",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout.trim());
      expect(json.status).toBe("ok");
      expect(json.changesetName).toBe("delete-test");
      expect(json.changesetId).toBeDefined();
      expect(result.stdout).not.toContain("\x1b");
    });
  });
});
