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
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { spawn } from "child_process";
import * as path from "path";
import { readdir, readFile } from "fs/promises";

interface TestWorkdir {
  path: string;
  cleanup: () => Promise<void>;
}

async function runCLICommand(
  workdir: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), "dist", "cli.js");
    const proc = spawn("node", [cliPath, ...args], { cwd: workdir });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.toString();
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Read YAML files from a layer directory and find an element by path
 */
async function findElementByPath(
  layerPath: string,
  targetPath: string
): Promise<any> {
  const files = await readdir(layerPath);
  const yaml = await import("yaml");

  for (const file of files.filter((f) => f.endsWith(".yaml"))) {
    const filePath = path.join(layerPath, file);
    const content = await readFile(filePath, "utf-8");
    const data = yaml.parse(content);

    if (data && typeof data === "object") {
      for (const value of Object.values(data)) {
        const el = value as any;
        if (el && el.path === targetPath) {
          return el;
        }
      }
    }
  }

  return null;
}

describe("Regression: type-normalization", () => {
  let workdir: TestWorkdir;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("Application layer abbreviated types", () => {
    it("should store 'application service' with canonical spec_node_id 'application.applicationservice'", async () => {
      // Add using abbreviated form: "service"
      const result = await runCLICommand(workdir.path, [
        "add",
        "application",
        "service",
        "Order Management Service",
        "--description",
        "Manages customer orders",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("order-management-service");

      // Find the stored element
      const appLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "04_application"
      );

      const element = await findElementByPath(
        appLayerPath,
        "application.applicationservice.order-management-service"
      );

      expect(element).not.toBeNull();
      // Critical assertion: spec_node_id must be the CANONICAL form
      expect(element.spec_node_id).toBe("application.applicationservice");
      // Not the abbreviated form
      expect(element.spec_node_id).not.toBe("application.service");
    });

    it("should store 'application component' with canonical spec_node_id 'application.applicationcomponent'", async () => {
      // Add using abbreviated form: "component"
      const result = await runCLICommand(workdir.path, [
        "add",
        "application",
        "component",
        "User Profile Component",
        "--description",
        "Displays user profile information",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("user-profile-component");

      // Find the stored element
      const appLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "04_application"
      );

      const element = await findElementByPath(
        appLayerPath,
        "application.applicationcomponent.user-profile-component"
      );

      expect(element).not.toBeNull();
      // Critical assertion: spec_node_id must be the CANONICAL form
      expect(element.spec_node_id).toBe("application.applicationcomponent");
      // Not the abbreviated form
      expect(element.spec_node_id).not.toBe("application.component");
    });

    it("should pass validation after adding element with abbreviated 'application service'", async () => {
      // Add using abbreviated form
      await runCLICommand(workdir.path, [
        "add",
        "application",
        "service",
        "Payment Service",
        "--description",
        "Processes payments",
      ]);

      // Run validation
      const validateResult = await runCLICommand(workdir.path, ["validate"]);

      // Validation should succeed (no schema errors)
      // Exit code might be 1 due to warnings about orphaned elements, which is acceptable
      const output = validateResult.stdout + validateResult.stderr;
      expect(output).toContain("0 error(s)");
      // Should NOT contain schema errors for the added element
      expect(output).not.toContain("schema error");
      // Should contain successful schema validation
      expect(output).toContain("Application layer");
    });

    it("should pass validation after adding element with abbreviated 'application component'", async () => {
      // Add using abbreviated form
      await runCLICommand(workdir.path, [
        "add",
        "application",
        "component",
        "Authentication Component",
        "--description",
        "Handles user authentication",
      ]);

      // Run validation
      const validateResult = await runCLICommand(workdir.path, ["validate"]);

      // Validation should succeed (no schema errors)
      // Exit code might be 1 due to warnings about orphaned elements, which is acceptable
      const output = validateResult.stdout + validateResult.stderr;
      expect(output).toContain("0 error(s)");
      // Should NOT contain schema errors for the added element
      expect(output).not.toContain("schema error");
      // Should contain successful schema validation
      expect(output).toContain("Application layer");
    });
  });

  describe("Business layer abbreviated types", () => {
    it("should store 'business service' with canonical spec_node_id 'business.businessservice'", async () => {
      // Add using abbreviated form: "service"
      const result = await runCLICommand(workdir.path, [
        "add",
        "business",
        "service",
        "Customer Service",
        "--description",
        "Provides customer support",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("customer-service");

      // Find the stored element
      const businessLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "02_business"
      );

      const element = await findElementByPath(
        businessLayerPath,
        "business.businessservice.customer-service"
      );

      expect(element).not.toBeNull();
      // Critical assertion: spec_node_id must be the CANONICAL form
      expect(element.spec_node_id).toBe("business.businessservice");
      // Not the abbreviated form
      expect(element.spec_node_id).not.toBe("business.service");
    });

    it("should store 'business process' with canonical spec_node_id 'business.businessprocess'", async () => {
      // Add using abbreviated form: "process"
      const result = await runCLICommand(workdir.path, [
        "add",
        "business",
        "process",
        "Order Processing",
        "--description",
        "Processes incoming customer orders",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("order-processing");

      // Find the stored element
      const businessLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "02_business"
      );

      const element = await findElementByPath(
        businessLayerPath,
        "business.businessprocess.order-processing"
      );

      expect(element).not.toBeNull();
      // Critical assertion: spec_node_id must be the CANONICAL form
      expect(element.spec_node_id).toBe("business.businessprocess");
      // Not the abbreviated form
      expect(element.spec_node_id).not.toBe("business.process");
    });
  });

  describe("Technology layer abbreviated types", () => {
    it("should store 'technology service' with canonical spec_node_id 'technology.technologyservice'", async () => {
      // Add using abbreviated form: "service"
      const result = await runCLICommand(workdir.path, [
        "add",
        "technology",
        "service",
        "Database Service",
        "--description",
        "Manages database infrastructure",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("database-service");

      // Find the stored element
      const techLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "05_technology"
      );

      const element = await findElementByPath(
        techLayerPath,
        "technology.technologyservice.database-service"
      );

      expect(element).not.toBeNull();
      // Critical assertion: spec_node_id must be the CANONICAL form
      expect(element.spec_node_id).toBe("technology.technologyservice");
      // Not the abbreviated form
      expect(element.spec_node_id).not.toBe("technology.service");
    });
  });

  describe("Type normalization with validation pipeline", () => {
    it("abbreviated types should work end-to-end: add, validate, and persist correct spec_node_id", async () => {
      // Step 1: Add element using abbreviated type
      const addResult = await runCLICommand(workdir.path, [
        "add",
        "application",
        "service",
        "Integration Service",
        "--description",
        "Integrates external systems",
      ]);

      expect(addResult.exitCode).toBe(0);

      // Step 2: Verify element is stored with canonical spec_node_id
      const appLayerPath = path.join(
        workdir.path,
        "documentation-robotics",
        "model",
        "04_application"
      );

      const element = await findElementByPath(
        appLayerPath,
        "application.applicationservice.integration-service"
      );

      expect(element).not.toBeNull();
      // Verify the canonical spec_node_id was stored
      expect(element.spec_node_id).toBe("application.applicationservice");

      // Step 3: Run validation to ensure no schema errors
      const validateResult = await runCLICommand(workdir.path, ["validate"]);

      const output = validateResult.stdout + validateResult.stderr;
      // Should have no schema errors
      expect(output).toContain("0 error(s)");
      expect(output).not.toContain("schema error");
    });

    it("multiple abbreviated types should all normalize correctly", async () => {
      // Add multiple elements with different abbreviated types
      const testCases = [
        {
          layer: "application",
          type: "service",
          name: "Test Service",
          expectedPath: "application.applicationservice.test-service",
          expectedSpecNodeId: "application.applicationservice",
        },
        {
          layer: "application",
          type: "component",
          name: "Test Component",
          expectedPath: "application.applicationcomponent.test-component",
          expectedSpecNodeId: "application.applicationcomponent",
        },
        {
          layer: "business",
          type: "service",
          name: "Test Business Service",
          expectedPath: "business.businessservice.test-business-service",
          expectedSpecNodeId: "business.businessservice",
        },
      ];

      for (const testCase of testCases) {
        const result = await runCLICommand(workdir.path, [
          "add",
          testCase.layer,
          testCase.type,
          testCase.name,
        ]);

        expect(result.exitCode).toBe(0);

        // Find the element
        const layerDirMap: { [key: string]: string } = {
          application: "04_application",
          business: "02_business",
        };

        const layerPath = path.join(
          workdir.path,
          "documentation-robotics",
          "model",
          layerDirMap[testCase.layer]
        );

        const element = await findElementByPath(
          layerPath,
          testCase.expectedPath
        );

        expect(element).not.toBeNull();
        expect(element.spec_node_id).toBe(testCase.expectedSpecNodeId);
      }

      // Final validation should pass for all elements
      const validateResult = await runCLICommand(workdir.path, ["validate"]);
      const output = validateResult.stdout + validateResult.stderr;
      expect(output).toContain("0 error(s)");
      expect(output).not.toContain("schema error");
    });
  });

  describe("Regression: verify bug fix prevents reoccurrence", () => {
    it("spec_node_id mismatch would cause dr validate to fail on the added element", async () => {
      // This test documents what WOULD happen if the bug still existed.
      // If spec_node_id were incorrectly set to "application.service" instead of
      // "application.applicationservice", validation would fail because the schema
      // validation looks up the element's type in the spec using spec_node_id.

      // Add element using abbreviated type
      await runCLICommand(workdir.path, [
        "add",
        "application",
        "service",
        "Validation Test Service",
      ]);

      // If the bug existed:
      // - spec_node_id would be "application.service" (WRONG)
      // - validate would try to find schema for "application.service"
      // - would fail because canonical is "application.applicationservice"

      // With bug fixed:
      // - spec_node_id is "application.applicationservice" (CORRECT)
      // - validate finds correct schema
      // - passes validation

      const validateResult = await runCLICommand(workdir.path, ["validate"]);
      const output = validateResult.stdout + validateResult.stderr;
      expect(output).toContain("0 error(s)");
      expect(output).not.toContain("schema error");
    });
  });
});
