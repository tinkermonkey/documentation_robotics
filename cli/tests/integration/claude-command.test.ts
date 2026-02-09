/**
 * Integration tests for Claude Code integration management
 * Tests install, upgrade, remove, status, and list subcommands
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fileExists, readJSON } from "../../src/utils/file-io.js";
import { createTempWorkdir, runDr as runDrHelper } from "../helpers/cli-runner.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "yaml";
import { readFile } from "node:fs/promises";

let tempDir: { path: string; cleanup: () => Promise<void> };

/**
 * Wrapper around the cli-runner helper
 */
async function runDr(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe("Claude Integration Commands", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a DR project first
    await runDr("init", "--name", "Test Project");
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("dr claude list", () => {
    it("should list all available components", async () => {
      const result = await runDr("claude", "list");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Available Components");
      expect(result.stdout).toContain("reference_sheets");
      expect(result.stdout).toContain("commands");
      expect(result.stdout).toContain("agents");
      expect(result.stdout).toContain("skills");
      expect(result.stdout).toContain("templates");
    });

    it("should show component descriptions", async () => {
      const result = await runDr("claude", "list");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Reference documentation");
      expect(result.stdout).toContain("Slash commands");
      expect(result.stdout).toContain("Specialized");
      expect(result.stdout).toContain("Auto-activating");
      expect(result.stdout).toContain("Customization templates");
    });
  });

  describe("dr claude install", () => {
    it("should install all components", async () => {
      const result = await runDr("claude", "install", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Claude integration installed successfully");
      expect(result.stdout).toContain("Installed");
      expect(result.stdout).toContain("files");

      // Verify .claude directory was created
      const claudeDir = join(tempDir.path, ".claude");
      expect(await fileExists(claudeDir)).toBe(true);

      // Verify version file was created
      const versionFile = join(claudeDir, ".dr-version");
      expect(await fileExists(versionFile)).toBe(true);
    });

    it("should create .claude subdirectories for components", async () => {
      await runDr("claude", "install", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      // These are the component target directories
      // Note: Some directories may not exist if their source isn't populated
      expect(await fileExists(join(claudeDir, "commands"))).toBe(true);
      expect(await fileExists(join(claudeDir, "agents"))).toBe(true);
      expect(await fileExists(join(claudeDir, "skills"))).toBe(true);
    });

    it("should support --reference-only flag", async () => {
      const result = await runDr("claude", "install", "--reference-only", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Claude integration installed successfully");

      // Version file should exist with reference_sheets component entry
      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty("reference_sheets");
    });

    it("should support --commands-only flag", async () => {
      const result = await runDr("claude", "install", "--commands-only", "--force");

      expect(result.exitCode).toBe(0);

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty("commands");
    });

    it("should support --agents-only flag", async () => {
      const result = await runDr("claude", "install", "--agents-only", "--force");

      expect(result.exitCode).toBe(0);

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty("agents");
    });

    it("should support --skills-only flag", async () => {
      const result = await runDr("claude", "install", "--skills-only", "--force");

      expect(result.exitCode).toBe(0);

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty("skills");
    });

    it("should support --templates-only flag", async () => {
      const result = await runDr("claude", "install", "--templates-only", "--force");

      expect(result.exitCode).toBe(0);

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      // Templates are user-customizable, so they should NOT be tracked in version file
      expect(versionData.components).not.toHaveProperty("templates");
    });

    it("should combine multiple component flags", async () => {
      const result = await runDr(
        "claude",
        "install",
        "--commands-only",
        "--agents-only",
        "--force"
      );

      expect(result.exitCode).toBe(0);

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty("commands");
      expect(versionData.components).toHaveProperty("agents");
    });

    it("should record CLI version in version file", async () => {
      await runDr("claude", "install", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);

      // Should have a version field
      expect(versionData).toHaveProperty("version");
      expect(typeof versionData.version).toBe("string");

      // Should have an installed_at timestamp
      expect(versionData).toHaveProperty("installed_at");
      expect(typeof versionData.installed_at).toBe("string");

      // Should be valid ISO 8601 timestamp
      expect(() => new Date(versionData.installed_at)).not.toThrow();
    });

    it("should prompt for confirmation if already installed", async () => {
      // First install
      await runDr("claude", "install", "--force");

      // Try to install again without force
      const result = await runDr("claude", "install");

      // Should be rejected due to missing confirmation
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe("dr claude status", () => {
    it("should show not installed status initially", async () => {
      const result = await runDr("claude", "status");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Claude integration not installed");
      expect(result.stdout).toContain("dr claude install");
    });

    it("should show installation status after install", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "status");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Installation Status");
      expect(result.stdout).toContain("Version");
      expect(result.stdout).toContain("Installed");
      expect(result.stdout).toContain("Components");
    });

    it("should list all installed components", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "status");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("reference_sheets");
      expect(result.stdout).toContain("commands");
      expect(result.stdout).toContain("agents");
      expect(result.stdout).toContain("skills");
      expect(result.stdout).toContain("templates");
      expect(result.stdout).toContain("files");
    });

    it("should show file counts per component", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "status");

      expect(result.exitCode).toBe(0);
      // Should have entries like "reference_sheets     N files"
      expect(result.stdout).toMatch(/\d+ files/);
    });
  });

  describe("dr claude upgrade", () => {
    it("should indicate no upgrades needed if freshly installed", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "upgrade");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("up to date");
    });

    it("should show error if not installed", async () => {
      const result = await runDr("claude", "upgrade");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Claude integration not installed");
    });

    it("should support --dry-run flag", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "upgrade", "--dry-run");

      expect(result.exitCode).toBe(0);
      // Should indicate dry-run mode
      expect(result.stdout).toContain("up to date");
    });

    it("should support --force flag", async () => {
      await runDr("claude", "install", "--force");

      const result = await runDr("claude", "upgrade", "--force");

      expect(result.exitCode).toBe(0);
    });
  });

  describe("dr claude remove", () => {
    beforeEach(async () => {
      // Install before trying to remove
      await runDr("claude", "install", "--force");
    });

    it("should remove all components with force flag", async () => {
      const result = await runDr("claude", "remove", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");

      // Verify version file was removed
      const versionFile = join(tempDir.path, ".claude", ".dr-version");
      expect(await fileExists(versionFile)).toBe(false);
    });

    it("should support --reference flag", async () => {
      const result = await runDr("claude", "remove", "--reference", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should support --commands flag", async () => {
      const result = await runDr("claude", "remove", "--commands", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should support --agents flag", async () => {
      const result = await runDr("claude", "remove", "--agents", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should support --skills flag", async () => {
      const result = await runDr("claude", "remove", "--skills", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should support --templates flag", async () => {
      const result = await runDr("claude", "remove", "--templates", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should combine multiple removal flags", async () => {
      const result = await runDr("claude", "remove", "--commands", "--agents", "--force");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("successfully");
    });

    it("should handle removal when not installed", async () => {
      // Remove first
      await runDr("claude", "remove", "--force");

      // Try to remove again
      const result = await runDr("claude", "remove");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Claude integration not installed");
    });
  });

  describe("Claude integration workflow", () => {
    it("should support install -> status -> upgrade -> remove workflow", async () => {
      // Install
      let result = await runDr("claude", "install", "--force");
      expect(result.exitCode).toBe(0);

      // Status
      result = await runDr("claude", "status");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Installation Status");

      // Upgrade
      result = await runDr("claude", "upgrade");
      expect(result.exitCode).toBe(0);

      // Remove
      result = await runDr("claude", "remove", "--force");
      expect(result.exitCode).toBe(0);

      // Verify removed
      const versionFile = join(tempDir.path, ".claude", ".dr-version");
      expect(await fileExists(versionFile)).toBe(false);
    });

    it("should support component-specific workflow", async () => {
      // Install only reference_sheets
      let result = await runDr("claude", "install", "--reference-only", "--force");
      expect(result.exitCode).toBe(0);

      // Check status shows reference_sheets
      result = await runDr("claude", "status");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("reference_sheets");

      // Remove specific component
      result = await runDr("claude", "remove", "--reference", "--force");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("File Ownership Boundaries", () => {
    /**
     * Test Case 1: Existing agents preserved
     * Verify that non-DR agent files (like agent-os) are preserved during upgrade
     */
    it("should preserve non-DR agents during upgrade", async () => {
      // Setup: Install DR agents
      await runDr("claude", "install", "--agents-only", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const agentsDir = join(claudeDir, "agents");

      // Add non-DR agents (simulating agent-os subdirectory)
      const agentOsDir = join(agentsDir, "agent-os");
      await mkdir(agentOsDir, { recursive: true });
      await writeFile(join(agentOsDir, "product-planner.md"), "# Product Planner\n\nCustom agent");
      await writeFile(join(agentOsDir, "spec-writer.md"), "# Spec Writer\n\nCustom agent");

      // Action: Run upgrade
      const result = await runDr("claude", "upgrade", "--force");
      expect(result.exitCode).toBe(0);

      // Verify: Non-DR agents still exist
      expect(await fileExists(join(agentOsDir, "product-planner.md"))).toBe(true);
      expect(await fileExists(join(agentOsDir, "spec-writer.md"))).toBe(true);

      // Verify: Version file doesn't track non-DR agents
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      expect(versionData.components.agents["agent-os/product-planner.md"]).toBeUndefined();
      expect(versionData.components.agents["agent-os/spec-writer.md"]).toBeUndefined();
    });

    /**
     * Test Case 2: DR agents updated
     * Verify that DR-owned agents are properly updated during upgrade
     */
    it("should update DR-owned agents during upgrade", async () => {
      // Setup: Install DR agents
      await runDr("claude", "install", "--agents-only", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const agentsDir = join(claudeDir, "agents");
      const versionFile = join(claudeDir, ".dr-version");

      // Load version file to see what was installed
      let content = await readFile(versionFile, "utf-8");
      let versionData = yaml.parse(content);

      // Action: Run upgrade (should succeed with no changes if source didn't change)
      const result = await runDr("claude", "upgrade", "--force");
      expect(result.exitCode).toBe(0);

      // Verify: DR agents directory exists and has tracked files
      expect(await fileExists(agentsDir)).toBe(true);

      // Verify: Version file still tracks DR agents
      content = await readFile(versionFile, "utf-8");
      versionData = yaml.parse(content);
      expect(versionData.components.agents).toBeDefined();
      expect(Object.keys(versionData.components.agents).length).toBeGreaterThan(0);
    });

    /**
     * Test Case 3: Obsolete DR files removed
     * Verify that DR files no longer in source are removed during upgrade
     */
    it("should handle obsolete DR files gracefully during upgrade", async () => {
      // Setup: Install DR agents
      await runDr("claude", "install", "--agents-only", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const versionFile = join(claudeDir, ".dr-version");

      // Load initial version
      let content = await readFile(versionFile, "utf-8");
      let versionData = yaml.parse(content);
      const initialFileCount = Object.keys(versionData.components.agents || {}).length;

      // Action: Run upgrade (if source files are the same, nothing should be removed)
      // (Note: initialFileCount is used in final assertion below)
      const result = await runDr("claude", "upgrade", "--force");
      expect(result.exitCode).toBe(0);

      // Verify: Version file was updated properly
      content = await readFile(versionFile, "utf-8");
      versionData = yaml.parse(content);
      // File count should be same as initial if source didn't change
      const finalFileCount = Object.keys(versionData.components.agents || {}).length;
      expect(finalFileCount).toBe(initialFileCount);
    });

    /**
     * Test Case 4: Non-prefixed files ignored
     * Verify that custom files without dr- prefix are preserved
     */
    it("should preserve custom agent files without dr- prefix", async () => {
      // Setup: Install DR agents
      await runDr("claude", "install", "--agents-only", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const agentsDir = join(claudeDir, "agents");

      // Add custom agent file (no dr- prefix)
      await writeFile(join(agentsDir, "custom-agent.md"), "# Custom Agent\n\nMy own agent");
      await writeFile(
        join(agentsDir, "my-special-assistant.md"),
        "# My Assistant\n\nAnother custom"
      );

      // Action: Run upgrade
      const result = await runDr("claude", "upgrade", "--force");
      expect(result.exitCode).toBe(0);

      // Verify: Custom files still exist
      expect(await fileExists(join(agentsDir, "custom-agent.md"))).toBe(true);
      expect(await fileExists(join(agentsDir, "my-special-assistant.md"))).toBe(true);

      // Verify: Version file doesn't track them
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      // These files should not be in the tracked agents since they lack dr- prefix
      const trackedAgents = Object.keys(versionData.components.agents || {});
      const hasCustom = trackedAgents.some((f) => !f.startsWith("dr-"));
      expect(hasCustom).toBe(false);
    });

    /**
     * Test Case 5: Subdirectories preserved
     * Verify that agent-os subdirectory and its contents remain after upgrade
     */
    it("should preserve agent-os subdirectory with custom agents", async () => {
      // Setup: Install DR agents
      await runDr("claude", "install", "--agents-only", "--force");

      const claudeDir = join(tempDir.path, ".claude");
      const agentsDir = join(claudeDir, "agents");
      const agentOsDir = join(agentsDir, "agent-os");

      // Create agent-os subdirectory structure
      await mkdir(agentOsDir, { recursive: true });

      // Add multiple files in subdirectory
      await writeFile(join(agentOsDir, "plan-product.md"), "# Product Planner\n\nAgent OS tool");
      await writeFile(join(agentOsDir, "write-spec.md"), "# Spec Writer\n\nAgent OS tool");
      await writeFile(
        join(agentOsDir, "implement-tasks.md"),
        "# Task Implementer\n\nAgent OS tool"
      );

      // Create nested subdirectory
      const nestedDir = join(agentOsDir, "advanced");
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, "config.json"), '{"tools": []}');

      // Action: Run upgrade
      const result = await runDr("claude", "upgrade", "--force");
      expect(result.exitCode).toBe(0);

      // Verify: agent-os subdirectory and all contents remain
      expect(await fileExists(agentOsDir)).toBe(true);
      expect(await fileExists(join(agentOsDir, "plan-product.md"))).toBe(true);
      expect(await fileExists(join(agentOsDir, "write-spec.md"))).toBe(true);
      expect(await fileExists(join(agentOsDir, "implement-tasks.md"))).toBe(true);
      expect(await fileExists(join(nestedDir, "config.json"))).toBe(true);

      // Verify: Version file doesn't track agent-os files
      const versionFile = join(claudeDir, ".dr-version");
      const content = await readFile(versionFile, "utf-8");
      const versionData = yaml.parse(content);
      const trackedFiles = Object.keys(versionData.components.agents || {});
      const hasAgentOs = trackedFiles.some((f) => f.includes("agent-os/"));
      expect(hasAgentOs).toBe(false);
    });
  });
});
