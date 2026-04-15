/**
 * Regression test: naming-edge-cases
 *
 * Verifies that element names with non-alphanumeric characters (dots, special chars,
 * all-special-char names) are handled correctly:
 * 1. Names with embedded dots are slugified correctly (dots removed, not kept as separators)
 * 2. Names with special characters are stripped cleanly
 * 3. Names that collapse to empty produce user-friendly errors
 *
 * Regression tests for:
 * - BUG-6072-001: Name slugification produces invalid element IDs for names with embedded dots (e.g. Node.js)
 * - BUG-ADVENTURE-2026-03-16_00-50-24-003: Element name with special characters produces opaque path-pattern validation error
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { findElementBySemanticId } from "../helpers/element-finder.js";

describe("regression: naming-edge-cases", () => {
  let workdir: any;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("name with embedded dot", () => {
    it("should handle name with embedded dot (Node.js) correctly", async () => {
      // Add element with name containing a dot
      const result = await runDr(["add", "technology", "service", "Node.js"], {
        cwd: workdir.path,
      });

      // Should succeed (exit 0)
      expect(result.exitCode).toBe(0);

      // Load model and verify the element was created
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("technology");
      expect(layerObj).toBeDefined();

      // The dot should be stripped, so ID should be "nodejs" not "node.js"
      const element = findElementBySemanticId(
        layerObj!,
        "technology.technologyservice.nodejs"
      );
      expect(element).toBeDefined();
      expect(element!.name).toBe("Node.js");

      // Verify the generated ID matches pattern: technology.{type}.nodejs
      // (dot is removed, not kept as a segment separator)
      expect(element!.path).toMatch(/^technology\.[a-z]+\.nodejs$/);
    });

    it("dr validate should report 0 errors for element with dot in name", async () => {
      // Add element with embedded dot
      await runDr(["add", "technology", "service", "Node.js"], {
        cwd: workdir.path,
      });

      // Run validation
      const result = await runDr(["validate"], { cwd: workdir.path });
      const output = result.stdout + result.stderr;

      // Should report 0 errors (ID is valid 3-segment path)
      expect(output).toContain("0 error(s)");
      // Should not contain any schema validation errors
      expect(output).not.toContain("schema error");
    });
  });

  describe("name with special characters", () => {
    it("should handle name with special characters (Auth & Session) correctly", async () => {
      // Add element with special characters
      const result = await runDr(["add", "application", "service", "Auth & Session"], {
        cwd: workdir.path,
      });

      // Should succeed (exit 0)
      expect(result.exitCode).toBe(0);

      // Load model and verify the element was created
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("application");
      expect(layerObj).toBeDefined();

      // Special char (&) should be stripped: "Auth & Session" → "auth-session"
      const element = findElementBySemanticId(
        layerObj!,
        "application.applicationservice.auth-session"
      );
      expect(element).toBeDefined();
      expect(element!.name).toBe("Auth & Session");

      // Verify the generated ID is valid 3-segment kebab-case
      expect(element!.path).toMatch(/^application\.[a-z]+\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it("dr validate should report 0 errors for element with special characters", async () => {
      // Add element with special characters
      await runDr(["add", "application", "service", "Auth & Session"], {
        cwd: workdir.path,
      });

      // Run validation
      const result = await runDr(["validate"], { cwd: workdir.path });
      const output = result.stdout + result.stderr;

      // Should report 0 errors
      expect(output).toContain("0 error(s)");
      // Should not contain schema validation errors
      expect(output).not.toContain("schema error");
    });

    it("should strip multiple special characters from name", async () => {
      // Test with multiple different special characters
      const result = await runDr(["add", "motivation", "goal", "User@#$Experience"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).toBe(0);

      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("motivation");
      expect(layerObj).toBeDefined();

      // All special chars stripped: "User@#$Experience" → "userexperience"
      // (special chars are removed, not replaced with hyphens)
      const element = findElementBySemanticId(
        layerObj!,
        "motivation.goal.userexperience"
      );
      expect(element).toBeDefined();
    });
  });

  describe("all-special-character name", () => {
    it("should reject name that is entirely special characters (@@@) with user-friendly error", async () => {
      // Add element with name that is ONLY special characters
      const result = await runDr(["add", "motivation", "goal", "@@@"], {
        cwd: workdir.path,
      });

      // Should fail (non-zero exit code)
      expect(result.exitCode).not.toBe(0);

      // Error message should be user-friendly, not opaque schema error
      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
      // Should NOT be a confusing schema validation error
      expect(output).not.toContain("path-pattern");
      expect(output).not.toContain("schema error");
    });

    it("should reject name that collapses to empty (---) with user-friendly error", async () => {
      // Add element with name that is only hyphens (will collapse to empty after stripping)
      // Note: use -- to signal end of options so --- is treated as a name argument, not a flag
      const result = await runDr(["add", "motivation", "goal", "--", "---"], {
        cwd: workdir.path,
      });

      // Should fail (non-zero exit code)
      expect(result.exitCode).not.toBe(0);

      // Error message should be user-friendly
      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
      // Should NOT be a confusing schema validation error
      expect(output).not.toContain("path-pattern");
      expect(output).not.toContain("schema error");
    });

    it("should reject name that is all exclamation marks (!!!!) with user-friendly error", async () => {
      const result = await runDr(["add", "motivation", "goal", "!!!!"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).not.toBe(0);

      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
    });

    it("should reject name that is all asterisks (****) with user-friendly error", async () => {
      const result = await runDr(["add", "motivation", "goal", "****"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).not.toBe(0);

      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
    });

    it("should reject name that is all hashes (####) with user-friendly error", async () => {
      const result = await runDr(["add", "motivation", "goal", "####"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).not.toBe(0);

      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
    });

    it("should reject name that is all ampersands (&&&&) with user-friendly error", async () => {
      const result = await runDr(["add", "motivation", "goal", "&&&&"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).not.toBe(0);

      const output = result.stdout + result.stderr;
      expect(output).toContain("Cannot generate a valid element ID");
      expect(output).toContain("Element names must contain at least one letter or digit");
    });
  });

  describe("edge case: names that almost collapse", () => {
    it("should handle name with mostly special chars but valid result (A@@@B)", async () => {
      // Name with valid chars surrounded by special chars
      const result = await runDr(["add", "motivation", "goal", "A@@@B"], {
        cwd: workdir.path,
      });

      // Should succeed because "A@@@B" → "ab" (still has 2 valid chars)
      expect(result.exitCode).toBe(0);

      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("motivation");

      // The "A" and "B" should remain (separated by removed special chars)
      const element = findElementBySemanticId(
        layerObj!,
        "motivation.goal.ab"
      );
      expect(element).toBeDefined();
    });

    it("should handle name with dot and special chars combined (Node@.js$)", async () => {
      // Test combination of dot and special chars
      const result = await runDr(["add", "technology", "service", "Node@.js$"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).toBe(0);

      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("technology");

      // Both dot and @ and $ should be stripped: "Node@.js$" → "nodejs"
      const element = findElementBySemanticId(
        layerObj!,
        "technology.technologyservice.nodejs"
      );
      expect(element).toBeDefined();
    });
  });
});
