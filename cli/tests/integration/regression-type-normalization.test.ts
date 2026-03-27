/**
 * Regression test: type-normalization
 *
 * Verifies that elements added using abbreviated type names are stored with their
 * canonical spec_node_id. Using the wrong spec_node_id caused `dr validate` failures
 * and broke downstream `/dr-relate` passes.
 *
 * Regression tests for:
 * - BUG-2026-03-16_14-49-35-001: dr add uses abbreviated type name for spec_node_id
 * - BUG-2026-03-16_14-49-35-002: /dr-relate produces 0 cross-layer relationships due to spec_node_id mismatch
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir, GOLDEN_COPY_HOOK_TIMEOUT } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { findElementBySemanticId } from "../helpers/element-finder.js";

describe("regression: type-normalization", () => {
  let workdir: any;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  }, GOLDEN_COPY_HOOK_TIMEOUT);

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("spec_node_id normalization for abbreviated type names", () => {
    const testCases = [
      {
        layer: "application",
        abbreviatedType: "service",
        canonicalType: "applicationservice",
        name: "test-service",
      },
      {
        layer: "application",
        abbreviatedType: "component",
        canonicalType: "applicationcomponent",
        name: "test-component",
      },
      {
        layer: "business",
        abbreviatedType: "service",
        canonicalType: "businessservice",
        name: "test-service",
      },
      {
        layer: "business",
        abbreviatedType: "process",
        canonicalType: "businessprocess",
        name: "test-process",
      },
      {
        layer: "technology",
        abbreviatedType: "service",
        canonicalType: "technologyservice",
        name: "test-service",
      },
    ];

    testCases.forEach(({ layer, abbreviatedType, canonicalType, name }) => {
      it(`should store canonical spec_node_id when adding ${layer} ${abbreviatedType}`, async () => {
        // Add element using abbreviated type name
        const result = await runDr(
          ["add", layer, abbreviatedType, name],
          { cwd: workdir.path }
        );
        expect(result.exitCode).toBe(0);

        // Load model and verify spec_node_id is canonical form
        const model = await Model.load(workdir.path);
        const layerObj = await model.getLayer(layer);
        expect(layerObj).toBeDefined();

        const element = findElementBySemanticId(
          layerObj!,
          `${layer}.${canonicalType}.${name}`
        );
        expect(element).toBeDefined();
        expect(element!.spec_node_id).toBe(`${layer}.${canonicalType}`);
      });
    });
  });

  describe("validation pipeline with abbreviated types", () => {
    it("should pass validation after adding elements with abbreviated type names", async () => {
      // Add elements using different abbreviated types
      await runDr(["add", "application", "service", "auth-service"], {
        cwd: workdir.path,
      });
      await runDr(["add", "application", "component", "auth-component"], {
        cwd: workdir.path,
      });
      await runDr(["add", "business", "service", "user-service"], {
        cwd: workdir.path,
      });

      // Validate all elements
      const result = await runDr(["validate"], { cwd: workdir.path });

      // Exit code may be non-zero due to orphaned element warnings, but schemas should be valid
      const output = result.stdout + result.stderr;
      expect(output).toContain("0 error(s)");
      // Should NOT contain schema validation errors
      expect(output).not.toContain("schema error");
    });
  });

  describe("regression: bugs this test would have caught", () => {
    it("should verify spec_node_id mismatch would cause validation failures (BUG-2026-03-16_14-49-35-001)", async () => {
      // This test documents the bug: if spec_node_id was stored as abbreviated form
      // (e.g., "application.service" instead of "application.applicationservice"),
      // validation would fail because the schema expects the canonical form.
      const result = await runDr(
        ["add", "application", "service", "regression-test"],
        { cwd: workdir.path }
      );
      expect(result.exitCode).toBe(0);

      // Load and verify canonical form was persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer("application");
      expect(layerObj).toBeDefined();

      const element = findElementBySemanticId(
        layerObj!,
        "application.applicationservice.regression-test"
      );
      expect(element).toBeDefined();
      expect(element!.spec_node_id).toBe("application.applicationservice");

      // Run validation to ensure the persisted spec_node_id passes schema validation
      const validateResult = await runDr(["validate"], { cwd: workdir.path });
      const validateOutput = validateResult.stdout + validateResult.stderr;
      expect(validateOutput).toContain("0 error(s)");
      expect(validateOutput).not.toContain("schema error");
    });
  });
});
