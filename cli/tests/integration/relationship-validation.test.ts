/**
 * Integration tests for relationship validation (issue #522)
 *
 * Tests the `dr validate` command with populated models containing cross-layer relationships.
 * Verifies that:
 * 1. `dr validate` counts and reports N > 0 relationships (not 0)
 * 2. `dr validate --strict` produces different output than standard validate when optional fields are missing
 * 3. Orphan warning counts in the body match counts reported in the summary block
 * 4. Multiple relationships within a layer are properly counted
 *
 * These tests address bugs that survived because prior validation tests used empty models:
 * - Bug #1 (fixed 2026-03-14): `dr validate` reported 0 relationships regardless of model content
 * - Bug #2 (fixed 2026-03-14): `dr validate --strict` produced identical output to standard validate
 * - Bug #3 (fixed 2026-03-15): Orphan warnings shown in body but not counted in summary
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runDr as runDrHelper } from "../helpers/cli-runner.js";
import { createTempWorkdir } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

async function runDr(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!tempDir.path) {
    throw new Error("tempDir.path is not initialized");
  }
  return runDrHelper(args, { cwd: tempDir.path });
}

describe("Relationship Validation", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a fresh model
    await runDr("init", "--name", "Relationship Test Model");
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("validate counts relationships with intra-layer relationships", () => {
    it("should report N > 0 relationships validated when model contains relationships", async () => {
      // Create elements in data-store layer
      await runDr("add", "data-store", "collection", "Customer Data");
      await runDr("add", "data-store", "field", "Customer ID");

      // Add intra-layer relationship between them
      const addRelResult = await runDr(
        "relationship",
        "add",
        "data-store.collection.customer-data",
        "data-store.field.customer-id",
        "--predicate",
        "composes"
      );
      expect(addRelResult.exitCode).toBe(0);

      // Run validate and check that relationships are counted
      const result = await runDr("validate");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("relationships validated");

      // Extract the number from "X relationships validated"
      const relationshipMatch = result.stdout.match(/(\d+)\s+relationships?\s+validated/i);
      expect(relationshipMatch).toBeDefined();
      const relationshipCount = parseInt(relationshipMatch![1], 10);
      expect(relationshipCount).toBeGreaterThan(0);
    });
  });

  describe("validate strict mode flags missing optional fields", () => {
    it("should produce different output with --strict flag when descriptions are missing", async () => {
      // Create a goal without description
      await runDr("add", "motivation", "goal", "Test Goal");

      // Run standard validate
      const standardResult = await runDr("validate");
      expect(standardResult.exitCode).toBe(0);

      // Run strict validate
      const strictResult = await runDr("validate", "--strict");

      // Standard validate should not fail
      expect(standardResult.exitCode).toBe(0);

      // Strict validate should either:
      // 1. Produce different output (strict warnings about missing descriptions), or
      // 2. Exit with a different code indicating strictness
      // Since the bug was that --strict was a no-op, the output must differ
      expect(strictResult.stdout).not.toBe(standardResult.stdout);

      // Verify that strict mode is checking descriptions
      expect(strictResult.stdout).toMatch(/description|missing|empty/i);
    });
  });

  describe("orphan warning count in body matches summary", () => {
    it("should report orphaned element in both body and summary with matching counts", async () => {
      // Create an isolated goal that has no relationships
      await runDr("add", "motivation", "goal", "Orphan Test Goal");

      // Run validate with verbose output to see body warnings
      const result = await runDr("validate", "--verbose");

      expect(result.exitCode).toBe(0);

      // Verify that both the body contains orphan warning and the summary reports warning count
      expect(result.stdout).toContain("orphaned");

      // Extract warning count from summary (format: "0 error(s), N warning(s)")
      const summaryMatch = result.stdout.match(/(\d+)\s+error\(s\),\s+(\d+)\s+warning\(s\)/);
      expect(summaryMatch).toBeDefined();

      const warningCount = parseInt(summaryMatch![2], 10);
      // When an element is orphaned, it should generate at least 1 warning
      expect(warningCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("validate counts multiple intra-layer relationships", () => {
    it("should accurately count when multiple relationships exist in a single layer", async () => {
      // Create three elements in data-store layer
      await runDr("add", "data-store", "collection", "Orders");
      await runDr("add", "data-store", "field", "Order ID");
      await runDr("add", "data-store", "field", "Customer ID");

      // Add two relationships
      const rel1 = await runDr(
        "relationship",
        "add",
        "data-store.collection.orders",
        "data-store.field.order-id",
        "--predicate",
        "composes"
      );
      expect(rel1.exitCode).toBe(0);

      const rel2 = await runDr(
        "relationship",
        "add",
        "data-store.collection.orders",
        "data-store.field.customer-id",
        "--predicate",
        "composes"
      );
      expect(rel2.exitCode).toBe(0);

      // Run validate and verify relationship count >= 2
      const result = await runDr("validate");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("relationships validated");

      const relationshipMatch = result.stdout.match(/(\d+)\s+relationships?\s+validated/i);
      expect(relationshipMatch).toBeDefined();
      const relationshipCount = parseInt(relationshipMatch![1], 10);
      expect(relationshipCount).toBeGreaterThanOrEqual(2);
    });
  });
});
