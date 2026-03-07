/**
 * Integration tests for element subcommand group
 * Tests the alternative interface for managing model elements via "element" subcommands
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { runDr as runDrHelper } from "../helpers/cli-runner.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { findElementBySemanticId } from "../helpers/element-finder.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

/**
 * Wrapper around the cli-runner helper
 */
async function runDr(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe("Element Subcommand Group", () => {
  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("element add", () => {
    it("should add an element to a layer via element add", async () => {
      const result = await runDr("element", "add", "motivation", "goal", "Test Goal");

      expect(result.exitCode).toBe(0);

      // Verify element was created
      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("motivation");
      expect(layer).toBeDefined();
      const element = findElementBySemanticId(layer!,"motivation.goal.test-goal");
      expect(element).toBeDefined();
      expect(element!.name).toBe("Test Goal");
    });

    it("should add element with description via element add", async () => {
      const result = await runDr(
        "element",
        "add",
        "motivation",
        "goal",
        "Customer Satisfaction",
        "--description",
        "Ensure customers are satisfied"
      );

      expect(result.exitCode).toBe(0);

      // Verify element with description
      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("motivation");
      const element = findElementBySemanticId(layer!,"motivation.goal.customer-satisfaction");
      expect(element!.description).toBe("Ensure customers are satisfied");
    });

    it("should fail to add element with invalid layer", async () => {
      const result = await runDr(
        "element",
        "add",
        "invalid-layer",
        "goal",
        "Test Goal"
      );

      expect(result.exitCode).not.toBe(0);
    });

    it("should fail to add element with invalid type for layer", async () => {
      const result = await runDr(
        "element",
        "add",
        "motivation",
        "endpoint",
        "Test"
      );

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("element list", () => {
    beforeEach(async () => {
      // Add some test elements
      await runDr("element", "add", "motivation", "goal", "Goal One");
      await runDr("element", "add", "motivation", "goal", "Goal Two");
      await runDr("element", "add", "motivation", "stakeholder", "Stakeholder One");
    });

    it("should list all elements in a layer via element list", async () => {
      const result = await runDr("element", "list", "motivation");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Goal One");
      expect(result.stdout).toContain("Goal Two");
      expect(result.stdout).toContain("Stakeholder One");
    });

    it("should filter elements by type via --type option", async () => {
      const result = await runDr("element", "list", "motivation", "--type", "goal");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Goal One");
      expect(result.stdout).toContain("Goal Two");
      expect(result.stdout).not.toContain("Stakeholder One");
    });

    it("should fail to list elements in invalid layer", async () => {
      const result = await runDr("element", "list", "invalid-layer");

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("element show", () => {
    beforeEach(async () => {
      // Add test element
      await runDr("element", "add", "motivation", "goal", "Get Order");
    });

    it("should display element details via element show", async () => {
      const result = await runDr("element", "show", "motivation.goal.get-order");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Get Order");
      expect(result.stdout).toContain("motivation.goal.get-order");
    });

    it("should fail to show non-existent element", async () => {
      const result = await runDr("element", "show", "motivation.goal.non-existent");

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("element delete", () => {
    beforeEach(async () => {
      // Add test elements
      await runDr("element", "add", "motivation", "goal", "Goal To Delete");
      await runDr("element", "add", "motivation", "goal", "Goal To Keep");
    });

    it("should delete element via element delete with --force", async () => {
      const result = await runDr("element", "delete", "motivation.goal.goal-to-delete", "--force");

      expect(result.exitCode).toBe(0);

      // Verify element was deleted
      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("motivation");
      const deleted = findElementBySemanticId(layer!,"motivation.goal.goal-to-delete");
      expect(deleted).toBeUndefined();

      // Verify other element still exists
      const kept = findElementBySemanticId(layer!,"motivation.goal.goal-to-keep");
      expect(kept).toBeDefined();
    });

    it("should not delete when element does not exist", async () => {
      const result = await runDr("element", "delete", "motivation.goal.non-existent", "--force");

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("element update", () => {
    beforeEach(async () => {
      // Add test element
      await runDr("element", "add", "motivation", "goal", "Original Goal");
    });

    it("should update element name via element update", async () => {
      const result = await runDr(
        "element",
        "update",
        "motivation.goal.original-goal",
        "--name",
        "Updated Goal"
      );

      expect(result.exitCode).toBe(0);

      // Verify name was updated (use the new semantic ID after name change)
      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("motivation");
      const element = findElementBySemanticId(layer!,"motivation.goal.updated-goal");
      expect(element!.name).toBe("Updated Goal");
    });

    it("should update element description via element update", async () => {
      const result = await runDr(
        "element",
        "update",
        "motivation.goal.original-goal",
        "--description",
        "New description"
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("motivation");
      const element = findElementBySemanticId(layer!,"motivation.goal.original-goal");
      expect(element!.description).toBe("New description");
    });

    it("should fail to update non-existent element", async () => {
      const result = await runDr(
        "element",
        "update",
        "motivation.goal.non-existent",
        "--name",
        "Updated"
      );

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("element subcommand consistency with root commands", () => {
    it("element add should produce same result as add command", async () => {
      // Add via element subcommand
      const elementResult = await runDr("element", "add", "business", "process", "Process A");
      expect(elementResult.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer("business");
      const element = findElementBySemanticId(layer!,"business.process.process-a");

      expect(element).toBeDefined();
      expect(element!.name).toBe("Process A");
    });
  });
});
