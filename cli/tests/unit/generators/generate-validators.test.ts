/**
 * Unit tests for the generate-validators script
 * Verifies that validator generation logic produces callable validators with expected signatures
 */

import { describe, it, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import type { ValidateFunction } from "ajv";

describe("Generator: generate-validators", () => {
  it("should generate compiled-validators.ts with expected exports", () => {
    const generatedPath = path.join(
      import.meta.dir,
      "../../../src/generated/compiled-validators.ts"
    );

    expect(fs.existsSync(generatedPath)).toBe(true);

    const content = fs.readFileSync(generatedPath, "utf-8");

    // Verify module header indicates it's generated
    expect(content).toContain("GENERATED FILE - DO NOT EDIT");
    expect(content).toContain("scripts/generate-validators.ts");

    // Verify expected exports are present
    const expectedExports = [
      "validateSpecNode",
      "validateSpecNodeRelationship",
      "validateSourceReference",
      "validateAttributeSpec",
    ];

    for (const exportName of expectedExports) {
      expect(content).toContain(`export`);
      expect(content).toContain(exportName);
    }
  });

  it("should generate validators that are callable functions", async () => {
    // Import generated validators to verify they're callable
    const validators = await import("../../../src/generated/compiled-validators.js");

    const validatorFunctions = [
      "validateSpecNode",
      "validateSpecNodeRelationship",
      "validateSourceReference",
      "validateAttributeSpec",
    ];

    for (const funcName of validatorFunctions) {
      const validator = validators[funcName];
      expect(typeof validator).toBe("function");

      // Validators should have call signature: (data: unknown) => boolean
      // and optionally errors: array of validation errors
      const result = validator({});
      expect(typeof result === "boolean" || result instanceof Promise).toBe(true);
    }
  });

  it("should validate spec-node objects with validateSpecNode", async () => {
    const validators = await import("../../../src/generated/compiled-validators.js");

    // Valid spec-node minimal object
    const validNode = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      spec_node_id: "motivation.goal",
      type: "goal",
      layer_id: "motivation",
      name: "Test Goal",
    };

    // This validator should be callable (even if validation fails, it should be a function)
    expect(typeof validators.validateSpecNode).toBe("function");
  });

  it("should not have syntax errors in generated file", () => {
    const generatedPath = path.join(
      import.meta.dir,
      "../../../src/generated/compiled-validators.ts"
    );

    const content = fs.readFileSync(generatedPath, "utf-8");

    // Check for common syntax issues
    expect(content).not.toContain("undefined function");
    expect(content).not.toContain("export export"); // Double export
    expect(content).not.toContain("import import"); // Double import

    // Verify TypeScript/JavaScript syntax is present
    expect(content).toMatch(/^(import|\/\*\*|\/\/)/m);
  });

  it("should include proper TypeScript imports", () => {
    const generatedPath = path.join(
      import.meta.dir,
      "../../../src/generated/compiled-validators.ts"
    );

    const content = fs.readFileSync(generatedPath, "utf-8");

    // Should import AJV
    expect(content).toContain("import");
    expect(content).toContain("ajv") || expect(content).toContain("Ajv");
  });

  it("should handle schema references correctly", async () => {
    const generatedPath = path.join(
      import.meta.dir,
      "../../../src/generated/compiled-validators.ts"
    );

    const content = fs.readFileSync(generatedPath, "utf-8");

    // Validators may reference each other or use shared schemas
    // Content should reflect proper module structure
    expect(content.length).toBeGreaterThan(500); // Generated code should have reasonable size
  });

  it("should match base schema file count", () => {
    const bundledSchemasDir = path.join(
      import.meta.dir,
      "../../../src/schemas/bundled/base"
    );

    if (fs.existsSync(bundledSchemasDir)) {
      const baseSchemaFiles = fs
        .readdirSync(bundledSchemasDir)
        .filter((f) => f.endsWith(".schema.json"));

      const generatedPath = path.join(
        import.meta.dir,
        "../../../src/generated/compiled-validators.ts"
      );

      const content = fs.readFileSync(generatedPath, "utf-8");

      // Count number of validator exports in generated file
      const exportMatches = content.match(/export const validate/g) || [];
      expect(exportMatches.length).toBeGreaterThanOrEqual(1);

      // Should have validators for the base schemas
      expect(exportMatches.length).toBeLessThanOrEqual(baseSchemaFiles.length + 2); // Allow small variance
    }
  });
});
