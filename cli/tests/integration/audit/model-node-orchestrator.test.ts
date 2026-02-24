/**
 * Integration tests for ModelNodeAuditOrchestrator
 *
 * Tests the model-side node audit that groups model elements by type and
 * reports distribution, orphaned types, and malformed elements.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { ModelNodeAuditOrchestrator } from "../../../src/audit/nodes/model/orchestrator.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import type { NodeAuditReport } from "../../../src/audit/nodes/types.js";

// Lazy shared setup: initialized on first use, then cached for the rest of the suite.
// This avoids beforeAll timeout issues since each test gets the full 30-second allowance.
let _setup: {
  workdir: Awaited<ReturnType<typeof createTestWorkdir>>;
  report: NodeAuditReport;
} | null = null;

async function getSetup() {
  if (!_setup) {
    const workdir = await createTestWorkdir();
    const report = await new ModelNodeAuditOrchestrator().runAudit({ projectRoot: workdir.path });
    _setup = { workdir, report };
  }
  return _setup;
}

afterAll(async () => {
  if (_setup) await _setup.workdir.cleanup();
});

describe("ModelNodeAuditOrchestrator", () => {
  describe("runAudit — basic structure", () => {
    it("should return a valid NodeAuditReport with required top-level fields", async () => {
      const { report } = await getSetup();

      expect(report).toHaveProperty("timestamp");
      expect(report).toHaveProperty("spec");
      expect(report).toHaveProperty("layerSummaries");
      expect(report).toHaveProperty("definitionQuality");
      expect(report).toHaveProperty("overlaps");
      expect(report).toHaveProperty("completenessIssues");

      expect(Array.isArray(report.definitionQuality)).toBe(true);
      expect(Array.isArray(report.overlaps)).toBe(true);
      expect(Array.isArray(report.layerSummaries)).toBe(true);
      expect(Array.isArray(report.completenessIssues)).toBe(true);

      expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
    });

    it("should have valid spec fields", async () => {
      const { report } = await getSetup();

      expect(typeof report.spec.version).toBe("string");
      expect(typeof report.spec.totalNodeTypes).toBe("number");
      expect(typeof report.spec.totalLayers).toBe("number");
      expect(report.spec.totalNodeTypes).toBeGreaterThanOrEqual(0);
    });

    it("should include a valid layer summary for each layer", async () => {
      const { report } = await getSetup();

      for (const summary of report.layerSummaries) {
        expect(typeof summary.layerId).toBe("string");
        expect(summary.layerId.length).toBeGreaterThan(0);
        expect(typeof summary.totalNodeTypes).toBe("number");
        expect(summary.totalNodeTypes).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("runAudit — layer filtering", () => {
    it("should return a single layer summary when --layer is specified", async () => {
      const { workdir } = await getSetup();
      const orchestrator = new ModelNodeAuditOrchestrator();
      const report = await orchestrator.runAudit({ projectRoot: workdir.path, layer: "motivation" });

      expect(report.layerSummaries).toHaveLength(1);
      expect(report.layerSummaries[0].layerId).toBe("motivation");
    });

    it("full report has more layer summaries than single-layer report", async () => {
      const { workdir, report: fullReport } = await getSetup();
      const orchestrator = new ModelNodeAuditOrchestrator();
      const filtered = await orchestrator.runAudit({ projectRoot: workdir.path, layer: "motivation" });

      expect(fullReport.layerSummaries.length).toBeGreaterThan(filtered.layerSummaries.length);
    });

    it("should return layer summary even when layer has no elements", async () => {
      const { workdir } = await getSetup();
      const orchestrator = new ModelNodeAuditOrchestrator();
      const report = await orchestrator.runAudit({ projectRoot: workdir.path, layer: "testing" });

      expect(report.layerSummaries).toHaveLength(1);
      expect(report.layerSummaries[0].layerId).toBe("testing");
      expect(report.layerSummaries[0].totalNodeTypes).toBeGreaterThanOrEqual(0);
    });
  });

  describe("runAudit — completeness issues", () => {
    it("should have valid fields on all completeness issues", async () => {
      const { report } = await getSetup();

      for (const issue of report.completenessIssues) {
        expect(typeof issue.layerId).toBe("string");
        expect(typeof issue.specNodeId).toBe("string");
        expect(typeof issue.detail).toBe("string");
        expect(issue.detail.length).toBeGreaterThan(0);
      }
    });

    it("completeness issue types should be valid enum values", async () => {
      const { report } = await getSetup();

      const validTypes = ["missing_schema", "orphaned_schema", "malformed_element"];
      for (const issue of report.completenessIssues) {
        expect(validTypes).toContain(issue.issueType);
      }
    });
  });

  describe("runAudit — error handling", () => {
    it("should throw with context when model directory does not exist", async () => {
      const orchestrator = new ModelNodeAuditOrchestrator();
      await expect(
        orchestrator.runAudit({ projectRoot: "/nonexistent/path/to/project" })
      ).rejects.toThrow("Failed to load project model from /nonexistent/path/to/project");
    });
  });

  describe("runAudit — report consistency", () => {
    it("spec.totalNodeTypes should equal sum of layer summary totalNodeTypes", async () => {
      const { report } = await getSetup();

      const sumFromSummaries = report.layerSummaries.reduce(
        (sum, s) => sum + s.totalNodeTypes,
        0
      );
      expect(report.spec.totalNodeTypes).toBe(sumFromSummaries);
    });

    it("spec.totalLayers should be between 0 and number of layer summaries", async () => {
      const { report } = await getSetup();

      expect(report.spec.totalLayers).toBeGreaterThanOrEqual(0);
      expect(report.spec.totalLayers).toBeLessThanOrEqual(report.layerSummaries.length);
    });
  });
});
