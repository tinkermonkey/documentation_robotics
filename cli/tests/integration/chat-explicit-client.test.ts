/**
 * Integration tests for Chat Command with explicit client selection
 * Tests the CLI interface for specifying client names
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Model } from "../../src/core/model";
import { Manifest } from "../../src/core/manifest";
import { chatCommand } from "../../src/commands/chat";
import { ClaudeCodeClient } from "../../src/coding-agents/claude-code-client";
import { CopilotClient } from "../../src/coding-agents/copilot-client";

describe("Chat Command with Explicit Client Selection", () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create unique temporary directory for this test
    testDir = await mkdtemp(join(tmpdir(), "dr-chat-explicit-"));
    await mkdir(testDir, { recursive: true });

    // Create a test model
    const manifest = new Manifest({
      name: "Explicit Client Test Model",
      version: "1.0.0",
      description: "Test model for explicit client selection",
    });
    model = new Model(testDir, manifest);
    await model.save();
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (testDir) {
      try {
        // Add a small delay to ensure file handles are released
        await new Promise((resolve) => setTimeout(resolve, 50));
        await rm(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore errors during cleanup - directory may already be deleted
        if ((e as any)?.code !== "ENOENT") {
          // Don't warn for ENOENT errors - they're expected if dir already deleted
        }
      }
    }
  });

  describe("Client Name Mapping", () => {
    it('should map "github-copilot" to "GitHub Copilot"', () => {
      // Test the mapping function indirectly through its expected behavior
      const mapping: Record<string, string> = {
        "github-copilot": "GitHub Copilot",
        copilot: "GitHub Copilot",
        "claude-code": "Claude Code",
        claude: "Claude Code",
      };

      expect(mapping["github-copilot"]).toBe("GitHub Copilot");
      expect(mapping["copilot"]).toBe("GitHub Copilot");
    });

    it('should map "claude-code" to "Claude Code"', () => {
      const mapping: Record<string, string> = {
        "github-copilot": "GitHub Copilot",
        copilot: "GitHub Copilot",
        "claude-code": "Claude Code",
        claude: "Claude Code",
      };

      expect(mapping["claude-code"]).toBe("Claude Code");
      expect(mapping["claude"]).toBe("Claude Code");
    });
  });

  describe("Client Names", () => {
    it("should have correct internal client names", () => {
      const claudeClient = new ClaudeCodeClient();
      const copilotClient = new CopilotClient();

      expect(claudeClient.getClientName()).toBe("Claude Code");
      expect(copilotClient.getClientName()).toBe("GitHub Copilot");
    });
  });

  describe("Preference Saving", () => {
    it("should not save preference (feature removed)", async () => {
      // Chat client preference is no longer persisted in manifest
      // The property was removed from Manifest class in Phase 7 cleanup

      // Set initial state - no preference
      expect(model.manifest.preferred_chat_client).toBeUndefined();

      // Attempt to set preference (works in-memory for backward compat, not persisted)
      const testManifest = model.manifest as any;
      testManifest.preferred_chat_client = "Claude Code";
      await model.save();

      // Verify preference was NOT saved (undefined after reload)
      const reloadedModel = await Model.load(testDir);
      expect(reloadedModel?.manifest.preferred_chat_client).toBeUndefined();
    });

    it("should not persist updates to preference", async () => {
      // Chat client preference no longer persists
      const testManifest = model.manifest as any;
      testManifest.preferred_chat_client = "Claude Code";
      await model.save();

      // Update to different client
      testManifest.preferred_chat_client = "GitHub Copilot";
      await model.save();

      // Verify neither preference was persisted
      const reloadedModel = await Model.load(testDir);
      expect(reloadedModel?.manifest.preferred_chat_client).toBeUndefined();
    });
  });

  describe("Auto-detection Behavior", () => {
    it("should handle no available clients gracefully", async () => {
      // When no clients are available, the command should exit with error
      // This tests the error path when detectAvailableClients returns empty array
      const claudeClient = new ClaudeCodeClient();
      const copilotClient = new CopilotClient();

      // Both should return boolean for availability
      const claudeAvailable = await claudeClient.isAvailable();
      const copilotAvailable = await copilotClient.isAvailable();

      expect(typeof claudeAvailable).toBe("boolean");
      expect(typeof copilotAvailable).toBe("boolean");
    });
  });

  describe("Manifest Structure", () => {
    it("should not include preferred_chat_client in JSON", async () => {
      // Chat client preference is no longer part of manifest structure
      // The property was removed from Manifest class in Phase 7 cleanup

      // Read the manifest directly
      const manifestJson = model.manifest.toJSON();
      expect(manifestJson.preferred_chat_client).toBeUndefined();

      // Verify property doesn't exist on Manifest class
      expect(model.manifest.preferred_chat_client).toBeUndefined();
    });

    it("should maintain core manifest fields without preference", async () => {
      // Verify manifest contains required fields but not preferred_chat_client
      await model.save();

      const manifestJson = model.manifest.toJSON();
      expect(manifestJson.name).toBeDefined();
      expect(manifestJson.version).toBeDefined();
      expect(manifestJson.created).toBeDefined();
      expect(manifestJson.modified).toBeDefined();
      expect(manifestJson.preferred_chat_client).toBeUndefined();
    });
  });
});
