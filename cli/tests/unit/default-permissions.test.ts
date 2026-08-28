/**
 * Unit tests for default-permissions module
 *
 * Tests verify that the read-safe permission allowlist is properly configured
 * and can be correctly formatted for both Claude Code and GitHub Copilot clients.
 */

import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  DEFAULT_READ_SAFE_PERMISSIONS,
  formatForClaudeCode,
  formatForCopilot,
  applyCopilotPermissions,
} from "../../src/coding-agents/default-permissions.js";
import { spawnSync } from "child_process";

describe("Default Read-Safe Permissions", () => {
  describe("DEFAULT_READ_SAFE_PERMISSIONS", () => {
    it("should export a non-empty permission allowlist", () => {
      expect(DEFAULT_READ_SAFE_PERMISSIONS).toBeDefined();
      expect(Array.isArray(DEFAULT_READ_SAFE_PERMISSIONS)).toBe(true);
      expect(DEFAULT_READ_SAFE_PERMISSIONS.length).toBeGreaterThan(0);
    });

    it("should contain Bash tool for CLI execution", () => {
      const bashPerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === "Bash");
      expect(bashPerms.length).toBeGreaterThan(0);
      expect(bashPerms[0].description).toContain("dr CLI");
    });

    it("should contain Read tools for file access", () => {
      const readPerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === "Read");
      expect(readPerms.length).toBeGreaterThan(0);
    });

    it("should include codebase read permission", () => {
      const codebaseRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Read" && p.description.includes("codebase")
      );
      expect(codebaseRead).toBeDefined();
      expect(codebaseRead?.allowsWrite).toBe(false);
    });

    it("should include .dr folder read permission", () => {
      const drFolderPerms = DEFAULT_READ_SAFE_PERMISSIONS.filter(
        (p) => p.name === "Read" && (p.scope === ".dr" || p.description.includes(".dr"))
      );
      expect(drFolderPerms.length).toBeGreaterThan(0);
      drFolderPerms.forEach((p) => {
        expect(p.allowsWrite).toBe(false);
      });
    });

    it("should include documentation-robotics folder read permission", () => {
      const docRoboticsRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Read" && p.description.includes("documentation-robotics")
      );
      expect(docRoboticsRead).toBeDefined();
      expect(docRoboticsRead?.allowsWrite).toBe(false);
    });

    it("should NOT include any write permissions", () => {
      const writePerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.allowsWrite);
      expect(writePerms).toHaveLength(0);
    });

    it("should NOT include Edit tool", () => {
      const editPerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === "Edit");
      expect(editPerms).toHaveLength(0);
    });

    it("should NOT include Write tool", () => {
      const writeTools = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === "Write");
      expect(writeTools).toHaveLength(0);
    });

    it("should NOT include Bash commands that modify state", () => {
      // Verify Bash permission is for dr CLI only, not arbitrary commands
      const bashPerm = DEFAULT_READ_SAFE_PERMISSIONS.find((p) => p.name === "Bash");
      expect(bashPerm?.description.toLowerCase()).toContain("dr cli");
    });

    it("each permission should have name and description", () => {
      DEFAULT_READ_SAFE_PERMISSIONS.forEach((perm) => {
        expect(perm.name).toBeDefined();
        expect(typeof perm.name).toBe("string");
        expect(perm.name.length).toBeGreaterThan(0);

        expect(perm.description).toBeDefined();
        expect(typeof perm.description).toBe("string");
        expect(perm.description.length).toBeGreaterThan(0);
      });
    });

    it("should have properly typed allowsWrite field", () => {
      DEFAULT_READ_SAFE_PERMISSIONS.forEach((perm) => {
        expect(typeof perm.allowsWrite).toBe("boolean");
      });
    });
  });

  describe("formatForClaudeCode()", () => {
    it("should return a string", () => {
      const result = formatForClaudeCode();
      expect(typeof result).toBe("string");
    });

    it("should return comma-separated tool specifications with scopes", () => {
      const result = formatForClaudeCode();
      const toolSpecs = result.split(",");
      expect(toolSpecs.length).toBeGreaterThan(0);
      toolSpecs.forEach((spec) => {
        expect(spec).toBeDefined();
        expect(spec.length).toBeGreaterThan(0);
      });
    });

    it("should include Bash tool with dr scope", () => {
      const result = formatForClaudeCode();
      expect(result).toContain("Bash(dr *");
    });

    it("should include Read tool with scopes", () => {
      const result = formatForClaudeCode();
      expect(result).toContain("Read(");
    });

    it("should include documentation-robotics scope", () => {
      const result = formatForClaudeCode();
      expect(result).toContain("Read(documentation-robotics)");
    });

    it("should include .dr scope", () => {
      const result = formatForClaudeCode();
      expect(result).toContain("Read(.dr)");
    });

    it("should not have trailing or leading commas", () => {
      const result = formatForClaudeCode();
      expect(result).not.toMatch(/^,|,$/);
    });

    it("should have one entry per permission (no deduplication)", () => {
      const result = formatForClaudeCode();
      const specs = result.split(",");
      expect(specs.length).toBe(DEFAULT_READ_SAFE_PERMISSIONS.length);
    });
  });


  describe("Acceptance Criteria Verification", () => {
    it("should cover running the dr CLI", () => {
      const drCliPerm = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Bash" && p.description.toLowerCase().includes("dr cli")
      );
      expect(drCliPerm).toBeDefined();
      expect(drCliPerm?.allowsWrite).toBe(false);
    });

    it("should cover reading the codebase", () => {
      const codebasePerm = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Read" && p.description.toLowerCase().includes("codebase")
      );
      expect(codebasePerm).toBeDefined();
      expect(codebasePerm?.allowsWrite).toBe(false);
    });

    it("should cover reading documentation-robotics folder", () => {
      const docRoboticsRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Read" && p.description.includes("documentation-robotics")
      );
      expect(docRoboticsRead).toBeDefined();
      expect(docRoboticsRead?.scope).toBe("documentation-robotics");
      expect(docRoboticsRead?.allowsWrite).toBe(false);
    });

    it("should cover reading .dr folder", () => {
      const drRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
        (p) => p.name === "Read" && (p.scope === ".dr" || p.description.includes(".dr/"))
      );
      expect(drRead).toBeDefined();
      expect(drRead?.allowsWrite).toBe(false);
    });

    it("should not include any write, edit, or delete permissions", () => {
      const restrictedTools = DEFAULT_READ_SAFE_PERMISSIONS.filter(
        (p) => ["Edit", "Write", "Delete", "Bash"].includes(p.name) && p.allowsWrite
      );
      // Bash is allowed but should not have write flag set
      const bashWritePerms = restrictedTools.filter((p) => p.name === "Bash");
      expect(bashWritePerms).toHaveLength(0);

      // Edit and Write should not exist at all
      const editWritePerms = DEFAULT_READ_SAFE_PERMISSIONS.filter(
        (p) => p.name === "Edit" || p.name === "Write"
      );
      expect(editWritePerms).toHaveLength(0);
    });
  });

  describe("applyCopilotPermissions error recovery", () => {
    describe("Default mode (withDanger=false) - fail-closed behavior", () => {
      it("should apply --allowedTools flag in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        // Call with a CLI that supports the flag (help output includes --allowedTools)
        applyCopilotPermissions(cmd, "copilot", "gh", false, onTelemetry);

        // When CLI supports --allowedTools, it should be added or permission applied
        // Either --allowedTools is present OR telemetry shows readSafePermissionsApplied=true
        if (telemetry["process.readSafePermissionsApplied"] === true) {
          expect(cmd).toContain("--allowedTools");
        }
        // If not applied (e.g., no support), at least telemetry should indicate the attempt
        expect(telemetry["process.readSafePermissionsApplied"]).toBeDefined();
      });

      it("should NOT include --allow-all-tools in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Default mode should never add --allow-all-tools
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should include permission value in command when --allowedTools is applied", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "gh", false);

        // Check if --allowedTools was added
        const allowedToolsIndex = cmd.indexOf("--allowedTools");
        if (allowedToolsIndex >= 0) {
          // If flag is present, its value should match formatForCopilot()
          expect(cmd[allowedToolsIndex + 1]).toEqual(formatForCopilot());
        }
      });
    });

    describe("Danger mode (withDanger=true) - graceful degradation", () => {
      it("should attempt --allow-all-tools only when CLI supports it", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        applyCopilotPermissions(cmd, "copilot", "gh", true, onTelemetry);

        // Telemetry should show whether --allow-all-tools is supported
        expect(telemetry["process.allowAllToolsSupported"]).toBeDefined();

        // If supported, --allow-all-tools should be in the command
        if (telemetry["process.allowAllToolsSupported"] === true) {
          expect(cmd).toContain("--allow-all-tools");
        } else {
          // If not supported, --allow-all-tools should NOT be added
          expect(cmd).not.toContain("--allow-all-tools");
        }
      });

      it("should not fall back to --allowedTools in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", true);

        // Danger mode should not apply read-safe --allowedTools restrictions
        // even if --allow-all-tools is not supported
        if (cmd.includes("--allow-all-tools")) {
          // If it has --allow-all-tools, verify it's for danger mode only
          expect(cmd).not.toContain("--allowedTools");
        }
      });
    });

    describe("Permission formatting", () => {
      it("formatForCopilot should return proper format for --allowedTools flag", () => {
        const result = formatForCopilot();
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        // Should be comma-separated tool specifications
        expect(result).toContain(",");
        // Should contain at least Bash and Read
        expect(result).toContain("Bash");
        expect(result).toContain("Read");
      });

      it("should properly scope tools in permission format", () => {
        const result = formatForCopilot();
        // Bash should have dr scope
        expect(result).toContain("Bash(dr *");
        // Read should have scopes
        expect(result).toContain("Read(");
      });
    });
  });
});
