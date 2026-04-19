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
  - patterns:
      - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"
    match: "graph_only"
  - patterns:
      - path: "/admin"
    reason: "Admin routes ignored"
    match: "graph_only"
  - patterns:
      - element_ids: ["api.operation.get-status"]
    reason: "Status endpoint ignored"
    match: "model_only"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(3);
      expect(rules[0].patterns[0].handler).toBe("*HealthHandler*");
      expect(rules[0].reason).toBe("Health check endpoints ignored");
      expect(rules[0].match).toBe("graph_only");
      expect(rules[1].patterns[0].path).toBe("/admin");
      expect(rules[1].reason).toBe("Admin routes ignored");
      expect(rules[1].match).toBe("graph_only");
      expect(rules[2].patterns[0].element_ids).toContain("api.operation.get-status");
      expect(rules[2].reason).toBe("Status endpoint ignored");
      expect(rules[2].match).toBe("model_only");
    });

    it("should return empty array when file doesn't exist (no error)", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should throw error when version is not 1", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 2
ignore:
  - patterns:
      - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("version");
      }
    });

    it("should throw error when ignore key is missing", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("ignore");
      }
    });

    it("should throw error for rule without reason field", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*HealthHandler*"
    match: "graph_only"
  - patterns:
      - path: "/admin"
    reason: "Admin routes ignored"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("reason");
      }
    });

    it("should handle mixed rule types in single file", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*Health*"
    reason: "Health patterns"
    match: "graph_only"
  - patterns:
      - path: "/admin"
    reason: "Admin path"
    match: "graph_only"
  - patterns:
      - element_ids: ["api.operation.get-status", "api.operation.post-config"]
    reason: "Multiple element IDs"
    match: "model_only"
  - patterns:
      - handler: "*Mock*"
      - path: "/test"
    reason: "Both handler and path"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(4);
      expect(rules[2].patterns[0].element_ids?.length).toBe(2);
      expect(rules[3].patterns[0].handler).toBe("*Mock*");
      expect(rules[3].patterns[1].path).toBe("/test");
    });
  });

  describe("matches", () => {
    it("should match handler glob pattern", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ handler: "*HealthHandler*" }],
          reason: "Health check",
          match: "graph_only",
        },
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
        {
          patterns: [{ handler: "*HealthHandler*" }],
          reason: "Health check",
          match: "graph_only",
        },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "MyUserHandler" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });

    it("should match exact path", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ path: "/admin" }],
          reason: "Admin path",
          match: "graph_only",
        },
      ];

      const result = IgnoreFileLoader.matches(
        { path: "/admin" },
        "route",
        rules
      );
      expect(result).toBe("Admin path");
    });

    it("should not match path when different", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ path: "/admin" }],
          reason: "Admin path",
          match: "graph_only",
        },
      ];

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
          patterns: [
            {
              element_ids: [
                "api.operation.get-status",
                "api.operation.post-config",
              ],
            },
          ],
          reason: "Ignored elements",
          match: "model_only",
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
          patterns: [{ element_ids: ["api.operation.get-status"] }],
          reason: "Ignored elements",
          match: "model_only",
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
        {
          patterns: [{ handler: "*Health*" }],
          reason: "First match",
          match: "graph_only",
        },
        {
          patterns: [{ handler: "*Health*" }],
          reason: "Second match",
          match: "graph_only",
        },
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
        {
          patterns: [{ handler: "*Health*" }],
          reason: "Health check",
          match: "graph_only",
        },
      ];

      const result = IgnoreFileLoader.matches({ path: "/health" }, "route", rules);
      expect(result).toBeNull();
    });

    it("should handle missing path in entry", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ path: "/admin" }],
          reason: "Admin path",
          match: "graph_only",
        },
      ];

      const result = IgnoreFileLoader.matches(
        { handler: "AdminHandler" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });

    it("should handle rules with multiple patterns (OR semantics)", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ handler: "*Health*" }, { path: "/health" }],
          reason: "Health endpoint",
          match: "graph_only",
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

    it("should filter rules by match bucket type (graph_only for routes)", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ handler: "*Health*" }],
          reason: "Route ignore rule",
          match: "graph_only",
        },
        {
          patterns: [{ handler: "*Health*" }],
          reason: "Element ignore rule",
          match: "model_only",
        },
      ];

      // Route type should only match graph_only rules
      const resultRoute = IgnoreFileLoader.matches(
        { handler: "HealthCheck" },
        "route",
        rules
      );
      expect(resultRoute).toBe("Route ignore rule");

      // Element type should only match model_only rules
      const resultElement = IgnoreFileLoader.matches(
        { handler: "HealthCheck" },
        "element",
        rules
      );
      expect(resultElement).toBe("Element ignore rule");
    });

    it("should not match rules with wrong bucket type", () => {
      const rules: IgnoreRule[] = [
        {
          patterns: [{ handler: "*Health*" }],
          reason: "Element rule",
          match: "model_only",
        },
      ];

      // Route type should not match model_only rule
      const result = IgnoreFileLoader.matches(
        { handler: "HealthCheck" },
        "route",
        rules
      );
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should throw error for missing match field", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*HealthHandler*"
    reason: "Health check"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("match");
      }
    });

    it("should throw error for invalid match value", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*HealthHandler*"
    reason: "Health check"
    match: "invalid_bucket"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("invalid_bucket");
      }
    });

    it("should throw error for empty patterns array", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns: []
    reason: "Empty patterns"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("empty");
      }
    });

    it("should throw error for pattern with no matching criteria", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - {}
    reason: "Empty pattern"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("matching criteria");
      }
    });

    it("should throw error for unknown pattern field", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*Health*"
        unknown_field: "value"
    reason: "Invalid pattern"
    match: "graph_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("unknown");
      }
    });

    it("should throw error for non-string element_ids", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - element_ids: ["api.operation.get-status", 123]
    reason: "Invalid element_ids"
    match: "model_only"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("strings");
      }
    });

    it("should throw error for non-object YAML content", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `"just a string"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("expected an object");
      }
    });

    it("should throw error for unknown field at rule level", async () => {
      const ignoreFile = join(testDir, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - patterns:
      - handler: "*Health*"
    reason: "Invalid rule"
    match: "graph_only"
    severity: "high"`;

      await writeFile(ignoreFile, content);

      try {
        await IgnoreFileLoader.load(ignoreFile);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("unknown field");
        expect((error as Error).message).toContain("severity");
      }
    });
  });
});
