/**
 * Unit tests for default-permissions module
 *
 * Tests verify that the read-safe permission allowlist is properly configured
 * and can be correctly formatted for both Claude Code and GitHub Copilot clients.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as childProcess from "child_process";
import {
  DEFAULT_READ_SAFE_PERMISSIONS,
  formatForClaudeCode,
  formatForCopilot,
  applyCopilotPermissions,
} from "../../src/coding-agents/default-permissions.js";

// Store original functions for restoration
let originalConsoleWarn: typeof console.warn;

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
    beforeEach(() => {
      originalConsoleWarn = console.warn;
    });

    afterEach(() => {
      console.warn = originalConsoleWarn;
    });

    describe("Default mode (withDanger=false) - fail-closed behavior", () => {
      it("should never include --allow-all-tools in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Default mode should never add --allow-all-tools
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should always attempt permission check and record telemetry (happy path or error)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false, onTelemetry);

        // Should have recorded permission check result (either applied, not applied, or failed)
        const hasChecked =
          telemetry["process.readSafePermissionsApplied"] !== undefined ||
          telemetry["process.readSafePermissionCheckFailed"] !== undefined;
        expect(hasChecked).toBe(true);
      });

      it("should structure --allowedTools with correct value when applied", async () => {
        // Mock child_process to simulate support for --allowedTools flag
        mock.module("child_process", () => ({
          spawnSync: () => ({
            stdout: "Options:\n  --allowedTools    Specify allowed tools\n",
            stderr: "",
            status: 0,
          }),
        }));

        // Dynamically import after mocking to get the mocked version
        const { applyCopilotPermissions: applyCopilotPermissionsMocked } = await import(
          "../../src/coding-agents/default-permissions.js"
        );

        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissionsMocked(cmd, "copilot", "copilot", false);

        // Verify --allowedTools is present and structured correctly
        const allowedToolsIndex = cmd.indexOf("--allowedTools");
        expect(allowedToolsIndex >= 0).toBe(true);
        expect(allowedToolsIndex + 1 < cmd.length).toBe(true);
        expect(cmd[allowedToolsIndex + 1]).toEqual(formatForCopilot());
        // Value should contain expected tool specs
        expect(cmd[allowedToolsIndex + 1]).toContain("Bash");
        expect(cmd[allowedToolsIndex + 1]).toContain("Read");
      });

      it("should apply --allowedTools optimistically when capability check fails (fail-closed behavior)", async () => {
        // Mock child_process at module level before importing the function
        mock.module("child_process", () => ({
          spawnSync: () => {
            throw new Error("simulated spawnSync failure");
          },
        }));

        let warnCalled = false;
        console.warn = mock(() => {
          warnCalled = true;
        });

        // Dynamically import after mocking to get the mocked version
        const { applyCopilotPermissions: applyCopilotPermissionsMocked } = await import(
          "../../src/coding-agents/default-permissions.js"
        );

        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        applyCopilotPermissionsMocked(cmd, "test-variant", "copilot", false, onTelemetry);

        // Verify fail-closed behavior: error recovery was triggered
        expect(telemetry["process.readSafePermissionCheckFailed"]).toBe(true);
        // --allowedTools should be applied as fail-closed fallback
        expect(cmd).toContain("--allowedTools");
        // warn() should have been called to inform user
        expect(warnCalled).toBe(true);
      });
    });

    describe("Danger mode (withDanger=true) - graceful degradation", () => {
      it("should never apply --allowedTools in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];

        applyCopilotPermissions(cmd, "copilot", "copilot", true);

        // Danger mode should NOT apply read-safe --allowedTools restrictions
        expect(cmd).not.toContain("--allowedTools");
      });

      it("should track --allow-all-tools support in danger mode, not read-safe permissions", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", true, onTelemetry);

        // In danger mode, should track --allow-all-tools support, not read-safe permissions
        expect(telemetry["process.readSafePermissionsApplied"]).toBeUndefined();
        // But should have danger mode telemetry
        const hasDangerModeTelemetry =
          telemetry["process.allowAllToolsSupported"] !== undefined ||
          telemetry["process.allowAllToolsCheckFailed"] !== undefined;
        expect(hasDangerModeTelemetry).toBe(true);
      });

      it("should not fall back to read-safe --allowedTools when error occurs in danger mode", async () => {
        // Mock child_process at module level before importing the function
        mock.module("child_process", () => ({
          spawnSync: () => {
            throw new Error("simulated spawnSync failure");
          },
        }));

        console.warn = mock(() => {
          // Silent warn mock to avoid console output
        });

        // Dynamically import after mocking to get the mocked version
        const { applyCopilotPermissions: applyCopilotPermissionsMocked } = await import(
          "../../src/coding-agents/default-permissions.js"
        );

        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const onTelemetry = (attr: string, value: any) => {
          telemetry[attr] = value;
        };

        applyCopilotPermissionsMocked(cmd, "test-variant", "copilot", true, onTelemetry);

        // Danger mode should NEVER apply read-safe --allowedTools as fallback
        expect(cmd).not.toContain("--allowedTools");
        // Should have tracked danger mode error telemetry
        expect(telemetry["process.allowAllToolsCheckFailed"]).toBe(true);
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
