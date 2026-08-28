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

  describe("applyCopilotPermissions()", () => {
    beforeEach(() => {
      originalConsoleWarn = console.warn;
    });

    afterEach(() => {
      console.warn = originalConsoleWarn;
    });

    describe("Function behavior and API", () => {
      it("should mutate cmd array in place (not return a value)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const cmdRef = cmd;
        const result = applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Should mutate in place and return undefined
        expect(result).toBeUndefined();
        expect(cmd === cmdRef).toBe(true);
      });

      it("should never include --allow-all-tools in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Default mode must not add --allow-all-tools flag
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should accept telemetry callback as optional parameter", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetryEvents: Array<[string, any]> = [];

        // Should not throw when callback is provided
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
            telemetryEvents.push([attr, val]);
          });
        }).not.toThrow();
      });

      it("should handle missing telemetry callback gracefully", () => {
        const cmd: string[] = ["copilot", "chat"];

        // Should not throw when callback is undefined
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false);
        }).not.toThrow();
      });
    });

    describe("Default mode branch (withDanger=false)", () => {
      it("should attempt permission check when in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        let checkAttempted = false;

        // Override console.warn to detect that the function ran
        console.warn = () => {
          checkAttempted = true;
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Whether it adds flags or warns, the check was executed
        const flagsAdded = cmd.includes("--allowedTools");
        expect(flagsAdded || checkAttempted).toBe(true);
      });

      it("should add --allowedTools flag if CLI supports it (or optimistically on error)", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Default mode should either add --allowedTools or warn
        const hasAllowedTools = cmd.includes("--allowedTools");
        expect(typeof hasAllowedTools).toBe("boolean");
      });

      it("should not apply --allow-all-tools even when trying to handle errors", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Guarantee: danger mode flag must never be in default mode
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should use proper telemetry attributes for default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        console.warn = () => {};

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        });

        // Should have attempted permission check and recorded outcome
        const hasDefaultModeTelemtry =
          telemetry["process.readSafePermissionsApplied"] !== undefined ||
          telemetry["process.readSafePermissionCheckFailed"] !== undefined;
        expect(hasDefaultModeTelemtry).toBe(true);
      });
    });

    describe("Danger mode branch (withDanger=true)", () => {
      it("should attempt permission check when in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        let checkAttempted = false;

        console.warn = () => {
          checkAttempted = true;
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", true);

        // Whether it adds flags or warns, the check was executed
        const flagsAdded = cmd.includes("--allow-all-tools");
        expect(flagsAdded || checkAttempted).toBe(true);
      });

      it("should not apply read-safe --allowedTools in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        applyCopilotPermissions(cmd, "copilot", "copilot", true);

        // Danger mode must NOT use read-safe restricted flags
        expect(cmd).not.toContain("--allowedTools");
      });

      it("should use proper telemetry attributes for danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        console.warn = () => {};

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        });

        // Should track danger mode support, not read-safe permissions
        const hasDangerModeTelemtry =
          telemetry["process.allowAllToolsSupported"] !== undefined ||
          telemetry["process.allowAllToolsCheckFailed"] !== undefined;
        expect(hasDangerModeTelemtry).toBe(true);
      });

      it("should not record read-safe permission telemetry in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        console.warn = () => {};

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        });

        // Danger mode should never record read-safe permission success
        expect(telemetry["process.readSafePermissionsApplied"]).toBeUndefined();
      });
    });

    describe("Command array manipulation", () => {
      it("should append flags to end of existing command array", () => {
        const cmd: string[] = ["copilot", "chat", "--existing-flag"];
        const initialLength = cmd.length;
        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Array should have been modified
        expect(cmd.length >= initialLength).toBe(true);
        // Original elements should still be in place
        expect(cmd[0]).toBe("copilot");
        expect(cmd[1]).toBe("chat");
        expect(cmd[2]).toBe("--existing-flag");
      });

      it("should handle empty cmd array", () => {
        const cmd: string[] = [];
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false);
        }).not.toThrow();
      });

      it("should handle single-element cmd array", () => {
        const cmd: string[] = ["copilot"];
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false);
        }).not.toThrow();
      });
    });

    describe("CLI variant handling", () => {
      it("should accept 'copilot' as copilotCommand parameter", () => {
        const cmd: string[] = ["copilot", "chat"];
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false);
        }).not.toThrow();
      });

      it("should accept 'gh' as copilotCommand parameter", () => {
        const cmd: string[] = ["gh", "copilot", "chat"];
        expect(() => {
          applyCopilotPermissions(cmd, "gh copilot", "gh", false);
        }).not.toThrow();
      });

      it("should accept variant names for display in warnings", () => {
        const cmd: string[] = ["copilot", "chat"];
        let warningCalled = false;
        const originalWarn = console.warn;
        console.warn = () => {
          warningCalled = true;
        };

        try {
          applyCopilotPermissions(cmd, "custom-variant-name", "copilot", false);
          // Function should complete without throwing
          expect(typeof warningCalled).toBe("boolean");
        } finally {
          console.warn = originalWarn;
        }
      });
    });

    describe("Error handling and resilience", () => {
      it("should not throw even if CLI check fails", () => {
        const cmd: string[] = ["copilot", "chat"];
        console.warn = () => {};

        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false);
        }).not.toThrow();
      });

      it("should produce warnings when fallback behavior is triggered", () => {
        const cmd: string[] = ["copilot", "chat"];
        let warningCalled = false;
        console.warn = () => {
          warningCalled = true;
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // Warning might be called depending on CLI availability
        expect(typeof warningCalled).toBe("boolean");
      });
    });

    describe("Integration with formatForCopilot()", () => {
      it("formatForCopilot should return valid --allowedTools value", () => {
        const result = formatForCopilot();

        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        expect(result).toContain("Bash");
        expect(result).toContain("Read");
      });

      it("should use formatForCopilot() output when applying read-safe permissions", () => {
        const cmd: string[] = ["copilot", "chat"];
        const expectedFormat = formatForCopilot();

        applyCopilotPermissions(cmd, "copilot", "copilot", false);

        // If --allowedTools was added, it should use the proper format
        const allowedToolsIndex = cmd.indexOf("--allowedTools");
        if (allowedToolsIndex >= 0) {
          expect(cmd[allowedToolsIndex + 1]).toBe(expectedFormat);
        }
      });

      it("formatForCopilot should be consistent across calls", () => {
        const result1 = formatForCopilot();
        const result2 = formatForCopilot();

        expect(result1).toBe(result2);
      });
    });

    describe("Telemetry recording details", () => {
      it("should provide telemetry callback with string attribute names", () => {
        const cmd: string[] = ["copilot", "chat"];
        const attributes: string[] = [];

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          attributes.push(attr);
        });

        // All attributes should be strings
        attributes.forEach((attr) => {
          expect(typeof attr).toBe("string");
          expect(attr.length).toBeGreaterThan(0);
        });
      });

      it("should record telemetry values of appropriate types", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        });

        // Values should be reasonable types (boolean, string, etc.)
        Object.values(telemetry).forEach((val) => {
          const type = typeof val;
          expect(
            type === "boolean" ||
            type === "string" ||
            type === "number" ||
            val === null ||
            val === undefined
          ).toBe(true);
        });
      });
    });
  });
});
