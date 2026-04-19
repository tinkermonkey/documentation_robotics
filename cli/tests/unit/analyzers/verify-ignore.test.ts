/**
 * Unit tests for IgnoreFileLoader
 *
 * Tests covering:
 * - Ignore file parsing (YAML format with version 1)
 * - Glob pattern matching for handler names
 * - Exact path matching
 * - Exact element_id matching
 * - Missing ignore file produces empty rules (no error)
 * - Reason is preserved on ignored entries
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { IgnoreFileLoader, type IgnoreRule } from "@/analyzers/verify-ignore.js";

let testDir: string = "";

describe("IgnoreFileLoader", () => {
  beforeEach(async () => {
    testDir = `/tmp/verify-ignore-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      if (testDir && testDir.startsWith("/tmp/")) {
        await rm(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("load", () => {
    it("should parse valid ignore file with version 1", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"
  - path: "/admin"
    reason: "Admin routes ignored"
  - element_ids: ["api.operation.get-status"]
    reason: "Status endpoint ignored"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(3);
      expect(rules[0].handler).toBe("*HealthHandler*");
      expect(rules[0].reason).toBe("Health check endpoints ignored");
      expect(rules[1].path).toBe("/admin");
      expect(rules[1].reason).toBe("Admin routes ignored");
      expect(rules[2].element_ids).toContain("api.operation.get-status");
      expect(rules[2].reason).toBe("Status endpoint ignored");
    });

    it("should return empty array when file doesn't exist (no error)", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should return empty array when version is not 1", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 2
ignore:
  - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should return empty array when ignore key is missing", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should skip rules without reason field", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - handler: "*HealthHandler*"
  - path: "/admin"
    reason: "Admin routes ignored"
  - element_ids: ["api.operation.get-status"]`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(1);
      expect(rules[0].path).toBe("/admin");
    });

    it("should handle mixed rule types in single file", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - handler: "*Health*"
    reason: "Health patterns"
  - path: "/admin"
    reason: "Admin path"
  - element_ids: ["api.operation.get-status", "api.operation.post-config"]
    reason: "Multiple element IDs"
  - handler: "*Mock*"
    path: "/test"
    reason: "Both handler and path"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(4);
      expect(rules[2].element_ids?.length).toBe(2);
      expect(rules[3].handler).toBe("*Mock*");
      expect(rules[3].path).toBe("/test");
    });
  });

  describe("matches", () => {
    it("should match handler glob pattern", () => {
      const rules: IgnoreRule[] = [
        { handler: "*HealthHandler*", reason: "Health check" },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "MyHealthHandler" },
        "route",
        rules
      );
      expect(result).toBe("Health check");
    });

    it("should not match handler glob pattern when no match", () => {
      const rules: IgnoreRule[] = [
        { handler: "*HealthHandler*", reason: "Health check" },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "MyUserHandler" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });

    it("should match exact path", () => {
      const rules: IgnoreRule[] = [{ path: "/admin", reason: "Admin path" }];

      const result = IgnoreFileLoader.matches(
        { path: "/admin" },
        "route",
        rules
      );
      expect(result).toBe("Admin path");
    });

    it("should not match path when different", () => {
      const rules: IgnoreRule[] = [{ path: "/admin", reason: "Admin path" }];

      const result = IgnoreFileLoader.matches(
        { path: "/admin/users" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });

    it("should match element_ids", () => {
      const rules: IgnoreRule[] = [
        {
          element_ids: ["api.operation.get-status", "api.operation.post-config"],
          reason: "Ignored elements",
        },
      ];

      const result = IgnoreFileLoader.matches(
        { element_id: "api.operation.get-status" },
        "element",
        rules
      );
      expect(result).toBe("Ignored elements");
    });

    it("should not match element_ids when not in list", () => {
      const rules: IgnoreRule[] = [
        {
          element_ids: ["api.operation.get-status"],
          reason: "Ignored elements",
        },
      ];

      const result = IgnoreFileLoader.matches(
        { element_id: "api.operation.post-config" },
        "element",
        rules
      );
      expect(result).toBeNull();
    });

    it("should return first matching rule reason", () => {
      const rules: IgnoreRule[] = [
        { handler: "*Health*", reason: "First match" },
        { handler: "*Health*", reason: "Second match" },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "HealthService" },
        "route",
        rules
      );
      expect(result).toBe("First match");
    });

    it("should handle empty rules array", () => {
      const result = IgnoreFileLoader.matches(
        { handler: "MyHandler" },
        "route",
        []
      );
      expect(result).toBeNull();
    });

    it("should handle missing handler in entry", () => {
      const rules: IgnoreRule[] = [
        { handler: "*Health*", reason: "Health check" },
      ];

      const result = IgnoreFileLoader.matches({ path: "/health" }, "route", rules);
      expect(result).toBeNull();
    });

    it("should handle missing path in entry", () => {
      const rules: IgnoreRule[] = [
        { path: "/admin", reason: "Admin path" },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "AdminHandler" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });

    it("should handle rules with multiple conditions (OR semantics)", () => {
      const rules: IgnoreRule[] = [
        {
          handler: "*Health*",
          path: "/health",
          reason: "Health endpoint",
        },
      ];

      // Should match by handler alone
      const result1 = IgnoreFileLoader.matches(
        { handler: "HealthCheck", path: "/other" },
        "route",
        rules
      );
      expect(result1).toBe("Health endpoint");

      // Should match by path alone
      const result2 = IgnoreFileLoader.matches(
        { handler: "UserService", path: "/health" },
        "route",
        rules
      );
      expect(result2).toBe("Health endpoint");

      // Should not match when neither matches
      const result3 = IgnoreFileLoader.matches(
        { handler: "UserService", path: "/users" },
        "route",
        rules
      );
      expect(result3).toBeNull();
    });
  });
});
