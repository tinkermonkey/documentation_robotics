// Integration tests for ANSI color suppression on non-TTY stdout

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr, stripAnsi } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

describe("ANSI color suppression on non-TTY", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  function containsAnsiCodes(text: string): boolean {
    return text !== stripAnsi(text);
  }

  describe("Read commands (non-mutating)", () => {
    it("should not emit ANSI codes in piped info command output", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Test Model"], { cwd: tempDir.path });

      // Run info command with piped stdout (default for runDr - uses spawnSync with stdio: pipe)
      const result = await runDr(["info"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Output should not contain ANSI escape sequences
      expect(containsAnsiCodes(result.stdout)).toBe(false);
      expect(result.stdout).toContain("Test Model"); // Verify output is still present
    });

    it("should not emit ANSI codes in piped list command output", async () => {
      // Initialize a model and add some elements
      await runDr(["init", "--name", "List Test Model"], { cwd: tempDir.path });
      await runDr(
        [
          "add",
          "motivation",
          "goal",
          "motivation-goal-list-1",
          "--name",
          "Goal 1",
          "--attributes",
          '{"priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      // Run list command
      const result = await runDr(["list", "motivation"], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      expect(containsAnsiCodes(result.stdout)).toBe(false);
      expect(result.stdout).toContain("motivation-goal-list-1");
    });

    it("should not emit ANSI codes in piped show command output", async () => {
      // Initialize a model and add an element
      await runDr(["init", "--name", "Show Test Model"], { cwd: tempDir.path });
      await runDr(
        [
          "add",
          "motivation",
          "goal",
          "motivation-goal-test-1",
          "--name",
          "Customer Satisfaction",
          "--attributes",
          '{"priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      // Run show command
      const result = await runDr(["show", "motivation.goal.motivation-goal-test-1"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBe(0);
      expect(containsAnsiCodes(result.stdout)).toBe(false);
      expect(result.stdout).toContain("motivation-goal-test-1");
    });
  });

  describe("Write commands (mutating)", () => {
    it("should not emit ANSI codes in piped add command output", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Add Test Model"], { cwd: tempDir.path });

      // Run add command with valid element type
      const result = await runDr(
        [
          "add",
          "motivation",
          "goal",
          "motivation-goal-add-1",
          "--name",
          "Add Test Goal",
          "--attributes",
          '{"priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBe(0);
      // Output should not contain ANSI escape sequences
      expect(containsAnsiCodes(result.stdout)).toBe(false);
      // Verify output is still present and meaningful
      expect(result.stdout).toContain("motivation-goal-add-1");
    });

    it("should not emit ANSI codes in piped update command output", async () => {
      // Initialize a model and add an element
      await runDr(["init", "--name", "Update Test Model"], { cwd: tempDir.path });
      await runDr(
        [
          "add",
          "motivation",
          "goal",
          "motivation-goal-update-1",
          "--name",
          "Original",
          "--attributes",
          '{"priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      // Run update command
      const result = await runDr(
        ["update", "motivation.goal.motivation-goal-update-1", "--name", "Updated Goal"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBe(0);
      expect(containsAnsiCodes(result.stdout)).toBe(false);
    });

    it("should not emit ANSI codes in piped delete command output", async () => {
      // Initialize a model and add an element
      await runDr(["init", "--name", "Delete Test Model"], { cwd: tempDir.path });
      await runDr(
        [
          "add",
          "motivation",
          "goal",
          "motivation-goal-delete-1",
          "--name",
          "To Delete",
          "--attributes",
          '{"priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      // Run delete command (use --force to skip confirmation prompt)
      const result = await runDr(["delete", "motivation.goal.motivation-goal-delete-1", "--force"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBe(0);
      expect(containsAnsiCodes(result.stdout)).toBe(false);
    });

    it("should not emit ANSI codes in piped changeset create output", async () => {
      // Initialize a model
      await runDr(["init", "--name", "Changeset Test Model"], { cwd: tempDir.path });

      // Run changeset create command
      const result = await runDr(
        ["changeset", "create", "Test Changeset", "--description", "Test"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBe(0);
      expect(containsAnsiCodes(result.stdout)).toBe(false);
    });
  });

  describe("Error output", () => {
    it("should not emit ANSI codes in piped error messages", async () => {
      // Run a command that will fail
      const result = await runDr(["show", "nonexistent.element.id"], { cwd: tempDir.path });

      // Command should fail
      expect(result.exitCode).toBe(1);
      // Error output should also not contain ANSI codes
      const output = result.stdout + result.stderr;
      expect(containsAnsiCodes(output)).toBe(false);
    });

    it("should not emit ANSI codes when adding to non-existent model", async () => {
      const result = await runDr(
        ["add", "api", "endpoint", "api-endpoint-test-1", "--name", "GET /users"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(containsAnsiCodes(output)).toBe(false);
    });
  });

  describe("Output content preservation", () => {
    it("should preserve meaningful output content while removing ANSI codes", async () => {
      // Initialize a model and add an element
      await runDr(["init", "--name", "Content Test Model"], { cwd: tempDir.path });
      await runDr(
        [
          "add",
          "motivation",
          "requirement",
          "motivation-requirement-content-1",
          "--name",
          "Test Requirement",
          "--attributes",
          '{"requirementType":"functional","priority":"high"}',
        ],
        { cwd: tempDir.path }
      );

      // Run show command
      const result = await runDr(["show", "motivation.requirement.motivation-requirement-content-1"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBe(0);
      // Verify content is present
      expect(result.stdout).toContain("motivation-requirement-content-1");
      expect(result.stdout).toContain("Test Requirement");
      // Verify no ANSI codes
      expect(containsAnsiCodes(result.stdout)).toBe(false);
    });
  });
});
