/**
 * Unit tests for default-permissions module
 *
 * Tests verify that the read-safe permission allowlist is properly configured
 * and can be correctly formatted for both Claude Code and GitHub Copilot clients.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  DEFAULT_READ_SAFE_PERMISSIONS,
  formatForClaudeCode,
  isToolAllowed,
  getToolPermissions,
  validateReadSafeConstraints,
} from "../../src/coding-agents/default-permissions.js";

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

  describe("isToolAllowed()", () => {
    it("should return true for Bash tool", () => {
      expect(isToolAllowed("Bash")).toBe(true);
    });

    it("should return true for Read tool", () => {
      expect(isToolAllowed("Read")).toBe(true);
    });

    it("should return false for Edit tool", () => {
      expect(isToolAllowed("Edit")).toBe(false);
    });

    it("should return false for Write tool", () => {
      expect(isToolAllowed("Write")).toBe(false);
    });

    it("should return false for arbitrary tool", () => {
      expect(isToolAllowed("CustomTool")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(isToolAllowed("bash")).toBe(false);
      expect(isToolAllowed("read")).toBe(false);
    });
  });

  describe("getToolPermissions()", () => {
    it("should return array for Bash tool", () => {
      const perms = getToolPermissions("Bash");
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
      perms.forEach((p) => {
        expect(p.name).toBe("Bash");
      });
    });

    it("should return array for Read tool", () => {
      const perms = getToolPermissions("Read");
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
      perms.forEach((p) => {
        expect(p.name).toBe("Read");
      });
    });

    it("should return empty array for disallowed tool", () => {
      const perms = getToolPermissions("Edit");
      expect(Array.isArray(perms)).toBe(true);
      expect(perms).toHaveLength(0);
    });

    it("should preserve scope information for Read permissions", () => {
      const readPerms = getToolPermissions("Read");
      const withScope = readPerms.filter((p) => p.scope);
      expect(withScope.length).toBeGreaterThan(0);
    });
  });

  describe("validateReadSafeConstraints()", () => {
    it("should not throw error for default configuration", () => {
      expect(() => validateReadSafeConstraints()).not.toThrow();
    });

    it("should verify current permissions are read-safe", () => {
      // If this test fails, it means someone added a write permission to the default list
      validateReadSafeConstraints();

      // Double-check by asserting no write permissions exist
      const writePerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.allowsWrite);
      expect(writePerms).toHaveLength(0);
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
});
