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
      expect(element!.path).toMatch(/^application\.[a-z]+\.[\w-]+$/);
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

    it("should reject name that is all punctuation with user-friendly error", async () => {
      // Test with various punctuation-only names
      const testNames = ["!!!!", "****", "####", "&&&&"];

      for (const name of testNames) {
        const result = await runDr(["add", "motivation", "goal", name], {
          cwd: workdir.path,
        });

        expect(result.exitCode).not.toBe(0);

        const output = result.stdout + result.stderr;
        expect(output).toContain("Cannot generate a valid element ID");
        expect(output).toContain("Element names must contain at least one letter or digit");
      }
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

  describe("regression: bugs this test would have caught", () => {
    it("would have caught BUG-6072-001 (dot produces invalid ID)", async () => {
      // Before the fix, "Node.js" might have generated an invalid 4-segment ID
      // like "technology.service.node.js" instead of 3-segment "technology.service.nodejs"
      const result = await runDr(["add", "technology", "service", "Node.js"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).toBe(0);

      // Verify validation passes (proves ID is valid 3-segment format)
      const validateResult = await runDr(["validate"], { cwd: workdir.path });
      const output = validateResult.stdout + validateResult.stderr;
      expect(output).toContain("0 error(s)");
      expect(output).not.toContain("schema error");
    });

    it("would have caught BUG-ADVENTURE-003 (opaque error for special chars)", async () => {
      // Before the fix, this would have produced an opaque "path-pattern" schema error
      // instead of a user-friendly "Cannot generate valid ID" error
      const result = await runDr(["add", "motivation", "goal", "@@@"], {
        cwd: workdir.path,
      });

      expect(result.exitCode).not.toBe(0);

      const output = result.stdout + result.stderr;
      // Should have user-friendly error message (added by add.ts validation)
      expect(output).toContain("Cannot generate a valid element ID");
      // Should NOT have opaque schema error
      expect(output).not.toContain("path-pattern");
      expect(output).not.toContain("schema error");
    });
  });
});
