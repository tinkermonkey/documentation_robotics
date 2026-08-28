/**
 * Unit tests for default-permissions module
 *
 * Tests verify that the read-safe permission allowlist is properly configured
 * and can be correctly formatted for both Claude Code and GitHub Copilot clients.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  DEFAULT_READ_SAFE_PERMISSIONS,
  formatForClaudeCode,
  formatForCopilot,
  applyCopilotPermissions,
  validatePermissions,
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

    it("should have Bash permission with a scope restriction", () => {
      // Verify Bash permission has a scope to restrict it to dr CLI only
      const bashPerm = DEFAULT_READ_SAFE_PERMISSIONS.find((p) => p.name === "Bash");
      expect(bashPerm?.scope).toBeDefined();
      expect(typeof bashPerm?.scope).toBe("string");
      expect((bashPerm?.scope ?? "").length).toBeGreaterThan(0);
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

    it("should include Bash tool with read-safe dr scope", () => {
      const result = formatForClaudeCode();
      expect(result).toContain("Bash(dr query|dr show|dr list");
      // Ensure wildcard scope is not used
      expect(result).not.toContain("Bash(dr *)");
      expect(result).not.toContain("Bash(*)");
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


  describe("validatePermissions() - Negative Path Tests", () => {
    it("should reject non-Bash/Read tools like NotebookEdit", () => {
      const invalidPerms = [
        {
          name: "NotebookEdit",
          description: "Edit notebooks",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/only include Bash and Read tools/);
    });

    it("should reject Bash permissions with scope 'dr *' wildcard", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute the dr CLI tool",
          scope: "dr *",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/dangerous wildcard pattern/);
    });

    it("should reject Bash permissions with scope '*' bare wildcard", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute the dr CLI tool",
          scope: "*",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/dangerous wildcard pattern/);
    });

    it("should reject Bash permissions with scope '.' bare dot", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute the dr CLI tool",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/dangerous wildcard pattern/);
    });

    it("should reject permissions with allowsWrite=true", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute the dr CLI tool for read-safe model queries",
          scope: "dr query|dr show",
          allowsWrite: true,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/must not allow write operations/);
    });

    it("should reject Bash permissions without 'dr' in description", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute generic shell commands",
          scope: "dr query|dr show",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/Bash permission must be for dr CLI only/);
    });

    it("should reject Bash permissions with scope not starting with 'dr '", () => {
      const invalidPerms = [
        {
          name: "Bash",
          description: "Execute the dr CLI tool for read-safe model queries",
          scope: "other query|other show",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read files from the codebase",
          scope: ".",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the documentation-robotics model folder",
          scope: "documentation-robotics",
          allowsWrite: false,
        },
        {
          name: "Read",
          description: "Read from the dr configuration folder",
          scope: ".dr",
          allowsWrite: false,
        },
      ];

      expect(() => {
        validatePermissions(invalidPerms);
      }).toThrow(/must start with 'dr '/);
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
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        const result = applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // Should mutate in place and return undefined
        expect(result).toBeUndefined();
        expect(cmd === cmdRef).toBe(true);
      });

      it("should never include --allow-all-tools in default mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // Default mode must not add --allow-all-tools flag
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should accept telemetry callback as optional parameter", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetryEvents: Array<[string, any]> = [];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        // Should not throw when callback is provided
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
            telemetryEvents.push([attr, val]);
          }, mockSpawnSync as any);
        }).not.toThrow();
      });

      it("should handle missing telemetry callback gracefully", () => {
        const cmd: string[] = ["copilot", "chat"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        // Should not throw when callback is undefined
        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });
    });

    describe("Default mode branch (withDanger=false)", () => {
      it("should add --allowedTools flag when CLI supports it (Branch 1)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Must add --allowedTools flag when supported
        expect(cmd).toContain("--allowedTools");
        expect(telemetry["process.readSafePermissionsApplied"]).toBe(true);
      });

      it("should apply --allowedTools optimistically when not advertised (Branch 2 - fail-safe)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        let warningText = "";
        console.warn = (msg: any) => {
          warningText = msg.toString();
        };

        const mockSpawnSync = () => ({
          stdout: "copilot help text without permission flags",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Should add --allowedTools optimistically even when not advertised
        expect(cmd).toContain("--allowedTools");
        // Should record that permissions were applied (fail-safe approach)
        expect(telemetry["process.readSafePermissionsApplied"]).toBe(true);
        // Should have warned user about non-advertised flag
        expect(warningText.includes("doesn't advertise --allowedTools")).toBe(true);
      });

      it("should apply --allowedTools defensively when check fails (Branch 3 - fail-closed)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        let warningText = "";
        console.warn = (msg: any) => {
          warningText = msg.toString();
        };

        const mockSpawnSync = () => {
          throw new Error("CLI not available");
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Should add --allowedTools defensively when check fails (fail-closed for read-safe guarantee)
        expect(cmd).toContain("--allowedTools");
        // Should record the check failure
        expect(telemetry["process.readSafePermissionCheckFailed"]).toBe(true);
        // Should record that permissions were applied as a defensive fallback
        expect(telemetry["process.readSafePermissionsApplied"]).toBe(true);
        // Should have warned user about defensive application
        expect(warningText.includes("Could not verify")).toBe(true);
        expect(warningText.includes("defensively")).toBe(true);
      });

      it("should not apply --allow-all-tools even when handling errors", () => {
        const cmd: string[] = ["copilot", "chat"];
        console.warn = () => {};

        const mockSpawnSync = () => {
          throw new Error("CLI not available");
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // Guarantee: danger mode flag must never be in default mode
        expect(cmd).not.toContain("--allow-all-tools");
      });

      it("should use proper telemetry attributes for default mode (success path)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Should record success outcome
        const hasDefaultModeTelemetry =
          telemetry["process.readSafePermissionsApplied"] !== undefined ||
          telemetry["process.readSafePermissionCheckFailed"] !== undefined;
        expect(hasDefaultModeTelemetry).toBe(true);
      });
    });

    describe("Danger mode branch (withDanger=true)", () => {
      it("should add --allow-all-tools when CLI supports it (Branch 4)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allow-all-tools Allow unrestricted tool access",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Must add --allow-all-tools when supported
        expect(cmd).toContain("--allow-all-tools");
        expect(telemetry["process.allowAllToolsSupported"]).toBe(true);
      });

      it("should warn when CLI doesn't support --allow-all-tools (Branch 5)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        let warningText = "";
        console.warn = (msg: any) => {
          warningText = msg.toString();
        };

        const mockSpawnSync = () => ({
          stdout: "copilot help text without danger flags",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Should not add --allow-all-tools when not supported
        expect(cmd).not.toContain("--allow-all-tools");
        // Should record that feature is not supported
        expect(telemetry["process.allowAllToolsSupported"]).toBe(false);
        // Should have warned user
        expect(warningText.includes("not supported")).toBe(true);
      });

      it("should gracefully degrade when check fails in danger mode (Branch 6 - no fallback)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        let warningText = "";
        console.warn = (msg: any) => {
          warningText = msg.toString();
        };

        const mockSpawnSync = () => {
          throw new Error("CLI not available");
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // In danger mode, should NOT apply fallback (graceful degradation, not fail-closed)
        expect(cmd).not.toContain("--allow-all-tools");
        // Should record the check failure
        expect(telemetry["process.allowAllToolsCheckFailed"]).toBe(true);
        // Should have warned user
        expect(warningText.includes("Could not verify")).toBe(true);
      });

      it("should not apply read-safe --allowedTools in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allow-all-tools Allow unrestricted tool access",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", true, undefined, mockSpawnSync as any);

        // Danger mode must NOT use read-safe restricted flags
        expect(cmd).not.toContain("--allowedTools");
      });

      it("should use proper telemetry attributes for danger mode (success path)", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allow-all-tools Allow unrestricted tool access",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Should track danger mode support, not read-safe permissions
        const hasDangerModeTelemetry =
          telemetry["process.allowAllToolsSupported"] !== undefined ||
          telemetry["process.allowAllToolsCheckFailed"] !== undefined;
        expect(hasDangerModeTelemetry).toBe(true);
      });

      it("should not record read-safe permission telemetry in danger mode", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allow-all-tools Allow unrestricted tool access",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", true, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

        // Danger mode should never record read-safe permission success
        expect(telemetry["process.readSafePermissionsApplied"]).toBeUndefined();
      });
    });

    describe("Command array manipulation", () => {
      it("should append flags to end of existing command array", () => {
        const cmd: string[] = ["copilot", "chat", "--existing-flag"];
        const initialLength = cmd.length;
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // Array should have been modified (flags added)
        expect(cmd.length > initialLength).toBe(true);
        // Original elements should still be in place
        expect(cmd[0]).toBe("copilot");
        expect(cmd[1]).toBe("chat");
        expect(cmd[2]).toBe("--existing-flag");
      });

      it("should handle empty cmd array", () => {
        const cmd: string[] = [];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });

      it("should handle single-element cmd array", () => {
        const cmd: string[] = ["copilot"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });
    });

    describe("CLI variant handling", () => {
      it("should accept 'copilot' as copilotCommand parameter", () => {
        const cmd: string[] = ["copilot", "chat"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });

      it("should accept 'gh' as copilotCommand parameter", () => {
        const cmd: string[] = ["gh", "copilot", "chat"];
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        expect(() => {
          applyCopilotPermissions(cmd, "gh copilot", "gh", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });

      it("should accept variant names for display in warnings", () => {
        const cmd: string[] = ["copilot", "chat"];
        let warningCalled = false;
        const originalWarn = console.warn;
        console.warn = () => {
          warningCalled = true;
        };

        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        try {
          applyCopilotPermissions(cmd, "custom-variant-name", "copilot", false, undefined, mockSpawnSync as any);
          // Function should complete without throwing - should add flags
          const flagsAdded = cmd.includes("--allowedTools");
          expect(flagsAdded).toBe(true);
        } finally {
          console.warn = originalWarn;
        }
      });
    });

    describe("Error handling and resilience", () => {
      it("should not throw even if CLI check fails", () => {
        const cmd: string[] = ["copilot", "chat"];
        console.warn = () => {};

        const mockSpawnSync = () => {
          throw new Error("CLI not available");
        };

        expect(() => {
          applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);
        }).not.toThrow();
      });

      it("should produce warnings when fallback behavior is triggered", () => {
        const cmd: string[] = ["copilot", "chat"];
        let warningCalled = false;
        console.warn = () => {
          warningCalled = true;
        };

        const mockSpawnSync = () => {
          throw new Error("CLI not available");
        };

        applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // Warning should be called when fallback is triggered
        expect(warningCalled).toBe(true);
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
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, undefined, mockSpawnSync as any);

        // When --allowedTools is added, it must use the proper format
        const allowedToolsIndex = cmd.indexOf("--allowedTools");
        expect(allowedToolsIndex).toBeGreaterThanOrEqual(0);
        expect(cmd[allowedToolsIndex + 1]).toBe(expectedFormat);
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
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          attributes.push(attr);
        }, mockSpawnSync as any);

        // All attributes should be strings
        attributes.forEach((attr) => {
          expect(typeof attr).toBe("string");
          expect(attr.length).toBeGreaterThan(0);
        });
      });

      it("should record telemetry values of appropriate types", () => {
        const cmd: string[] = ["copilot", "chat"];
        const telemetry: Record<string, any> = {};
        const mockSpawnSync = () => ({
          stdout: "copilot --allowedTools List allowed tools",
          stderr: "",
          status: 0,
        });

        applyCopilotPermissions(cmd, "copilot", "copilot", false, (attr, val) => {
          telemetry[attr] = val;
        }, mockSpawnSync as any);

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
