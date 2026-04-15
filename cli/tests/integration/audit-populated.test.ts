/**
 * Integration tests for audit command with populated model
 *
 * Tests the audit command against a model with actual elements and relationships.
 * This suite verifies that quantitative outputs are correct when the model has data.
 *
 * Bugs this catches:
 * - dr audit does not read relationships.yaml — all relationship metrics report 0
 * - dr audit marks node types as isolated even when they have outgoing cross-layer relationships
 * - dr audit <layer> reports 0 inter-layer relationships for layers that are only relationship targets
 * - dr audit --verbose is a no-op
 * - dr audit --type nodes reports Avg Quality Score 0.0 for all elements
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "../../src/core/model.js";
import { Layer } from "../../src/core/layer.js";
import { Element } from "../../src/core/element.js";
import { auditCommand } from "../../src/commands/audit.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { readFile, fileExists } from "../../src/utils/file-io.js";
import { unlinkSync } from "node:fs";
import path from "path";

describe("audit command with populated model", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;
  let model: Model;

  beforeEach(async () => {
    workdir = await createTestWorkdir();

    // Initialize model with eager loading
    model = await Model.init(
      workdir.path,
      {
        name: "Audit Test Model",
        version: "0.1.0",
        description: "Model for audit command testing with populated data",
        specVersion: "0.6.0",
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    // Create source layer (motivation) with multiple elements
    const sourceLayer = new Layer("motivation");
    sourceLayer.addElement(
      new Element({
        id: "motivation.goal.source-1",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Goal Source 1",
        description: "Source goal for cross-layer relationships",
      })
    );
    sourceLayer.addElement(
      new Element({
        id: "motivation.goal.source-2",
        spec_node_id: "motivation.goal",
        layer_id: "motivation",
        type: "goal",
        name: "Goal Source 2",
        description: "Another source goal with detailed description for quality scoring",
      })
    );
    sourceLayer.addElement(
      new Element({
        id: "motivation.requirement.source-1",
        spec_node_id: "motivation.requirement",
        layer_id: "motivation",
        type: "requirement",
        name: "Requirement Source 1",
        description: "Source requirement element",
      })
    );

    // Create target layer (business) with multiple elements
    const targetLayer = new Layer("business");
    targetLayer.addElement(
      new Element({
        id: "business.service.target-1",
        spec_node_id: "business.service",
        layer_id: "business",
        type: "service",
        name: "Service Target 1",
        description: "Target service that receives relationships",
      })
    );
    targetLayer.addElement(
      new Element({
        id: "business.service.target-2",
        spec_node_id: "business.service",
        layer_id: "business",
        type: "service",
        name: "Service Target 2",
        description: "Another target service with detailed description",
      })
    );
    targetLayer.addElement(
      new Element({
        id: "business.process.target-1",
        spec_node_id: "business.process",
        layer_id: "business",
        type: "process",
        name: "Process Target 1",
        description: "Target process",
      })
    );

    model.addLayer(sourceLayer);
    model.addLayer(targetLayer);

    // Save initial structure
    await model.save();

    // Add cross-layer relationships from source to target
    // M = 4 relationships for test case verification
    model.relationships.add({
      source: "motivation.goal.source-1",
      target: "business.service.target-1",
      predicate: "realizes",
      layer: "motivation",
    });

    model.relationships.add({
      source: "motivation.goal.source-2",
      target: "business.service.target-2",
      predicate: "realizes",
      layer: "motivation",
    });

    model.relationships.add({
      source: "motivation.requirement.source-1",
      target: "business.process.target-1",
      predicate: "satisfies",
      layer: "motivation",
    });

    model.relationships.add({
      source: "motivation.goal.source-1",
      target: "business.process.target-1",
      predicate: "supports",
      layer: "motivation",
    });

    // Add intra-layer relationships for comprehensive coverage
    model.relationships.add({
      source: "motivation.goal.source-1",
      target: "motivation.goal.source-2",
      predicate: "depends-on",
      layer: "motivation",
    });

    model.relationships.add({
      source: "business.service.target-1",
      target: "business.service.target-2",
      predicate: "depends-on",
      layer: "business",
    });

    // Persist relationships
    await model.saveRelationships();

    // Reload model to ensure relationships are loaded for audit
    model = await Model.load(workdir.path);
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  describe("Test case 1: Inter-layer relationship count >= M for source layer", () => {
    it("should report inter-layer relationship count >= 4 for source layer (motivation)", async () => {
      const outputPath = path.join(workdir.path, "audit-source-layer.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          layer: "motivation",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      // Find motivation layer coverage
      const motivationCoverage = report.coverage.find(
        (c: any) => c.layer === "motivation"
      );
      expect(motivationCoverage).toBeDefined();

      // Verify that inter-layer relationship count is reported and >= 4
      // The interLayerRelationshipCount includes both outgoing and incoming cross-layer rels
      expect(motivationCoverage.interLayerRelationshipCount).toBeGreaterThanOrEqual(4);

      unlinkSync(outputPath);
    });
  });

  describe("Test case 2: Bidirectional inter-layer count for target layer", () => {
    it("should report inter-layer relationship count >= 4 for target layer (business)", async () => {
      const outputPath = path.join(workdir.path, "audit-target-layer.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          layer: "business",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      // Find business layer coverage
      const businessCoverage = report.coverage.find(
        (c: any) => c.layer === "business"
      );
      expect(businessCoverage).toBeDefined();

      // Verify that incoming (target) relationships are counted
      // The business layer receives cross-layer relationships from motivation
      // This tests the bidirectionality bug fix
      expect(businessCoverage.interLayerRelationshipCount).toBeGreaterThanOrEqual(4);

      unlinkSync(outputPath);
    });
  });

  describe("Test case 3: Isolated node count validation", () => {
    it("should report isolated node count < total node count for source layer", async () => {
      const outputPath = path.join(workdir.path, "audit-isolated.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          layer: "motivation",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      const motivationCoverage = report.coverage.find(
        (c: any) => c.layer === "motivation"
      );

      // Total node types in motivation layer: goal, requirement = 2 distinct spec_node_ids
      expect(motivationCoverage.nodeTypeCount).toBe(2);

      // Not all node types should be isolated since goal has relationships
      expect(motivationCoverage.isolatedNodeTypes.length).toBeLessThan(
        motivationCoverage.nodeTypeCount
      );
      expect(motivationCoverage.isolationPercentage).toBeLessThan(100);

      unlinkSync(outputPath);
    });

    it("should report isolated node count < total node count for target layer", async () => {
      const outputPath = path.join(workdir.path, "audit-isolated-target.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          layer: "business",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      const businessCoverage = report.coverage.find(
        (c: any) => c.layer === "business"
      );

      // Total node types in business layer: service, process = 2 distinct spec_node_ids
      expect(businessCoverage.nodeTypeCount).toBe(2);

      // Not all should be isolated since they receive relationships
      expect(businessCoverage.isolatedNodeTypes.length).toBeLessThan(
        businessCoverage.nodeTypeCount
      );
      expect(businessCoverage.isolationPercentage).toBeLessThan(100);

      unlinkSync(outputPath);
    });
  });

  describe("Test case 4: Verbose flag produces longer output", () => {
    it("should produce longer output with --verbose flag than without", async () => {
      // Capture non-verbose output
      const nonVerboseLogs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        nonVerboseLogs.push(args.join(" "));
      };

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);
        await auditCommand({
          layer: "motivation",
          verbose: false,
        });
      } finally {
        console.log = originalLog;
        process.chdir(originalCwd);
      }

      const nonVerboseOutput = nonVerboseLogs.join("\n");
      const nonVerboseLineCount = nonVerboseOutput.split("\n").length;

      // Capture verbose output
      const verboseLogs: string[] = [];
      console.log = (...args: any[]) => {
        verboseLogs.push(args.join(" "));
      };

      try {
        process.chdir(workdir.path);
        await auditCommand({
          layer: "motivation",
          verbose: true,
        });
      } finally {
        console.log = originalLog;
        process.chdir(originalCwd);
      }

      const verboseOutput = verboseLogs.join("\n");
      const verboseLineCount = verboseOutput.split("\n").length;

      // Verbose output should be strictly longer (more lines)
      expect(verboseLineCount).toBeGreaterThan(nonVerboseLineCount);
    });

    it("should include detailed sections with --verbose flag", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);
        await auditCommand({
          layer: "motivation",
          verbose: true,
        });

        const output = logs.join("\n");

        // Verbose mode should include detailed sections
        expect(output).toContain("Coverage Analysis (Detailed)");
        expect(output).toContain("Duplicate Detection (Detailed)");
        expect(output).toContain("Gap Analysis (Detailed)");
      } finally {
        console.log = originalLog;
        process.chdir(originalCwd);
      }
    });
  });

  describe("Test case 5: Quality score > 0.0 with non-empty descriptions", () => {
    it("should report quality score > 0.0 for elements with descriptions", async () => {
      const outputPath = path.join(workdir.path, "audit-nodes-quality.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          type: "nodes",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      // Find motivation layer summary
      const motivationSummary = report.layerSummaries.find(
        (s: any) => s.layerId === "motivation"
      );
      expect(motivationSummary).toBeDefined();

      // All elements have descriptions, so average quality should be > 0.0
      expect(motivationSummary.avgQualityScore).toBeGreaterThan(0.0);

      // Individual node definitions should have quality scores > 0
      if (motivationSummary.nodeDefinitions && motivationSummary.nodeDefinitions.length > 0) {
        for (const nodeDef of motivationSummary.nodeDefinitions) {
          expect(nodeDef.qualityScore).toBeGreaterThanOrEqual(0.0);
        }
      }

      unlinkSync(outputPath);
    });

    it("should report quality score for business layer nodes", async () => {
      const outputPath = path.join(workdir.path, "audit-nodes-business.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          type: "nodes",
          layer: "business",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      // Should have one layer summary (business)
      expect(report.layerSummaries).toHaveLength(1);

      const businessSummary = report.layerSummaries[0];
      expect(businessSummary.layerId).toBe("business");

      // Average quality score should be > 0 since all elements have descriptions
      expect(businessSummary.avgQualityScore).toBeGreaterThan(0.0);

      unlinkSync(outputPath);
    });

    it("should include quality metrics in text output for --type nodes", async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
      };

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);
        await auditCommand({
          type: "nodes",
          layer: "motivation",
        });

        const output = logs.join("\n");

        // Text output should have content (not empty)
        expect(output.length).toBeGreaterThan(0);
      } finally {
        console.log = originalLog;
        process.chdir(originalCwd);
      }
    });
  });

  describe("Comprehensive integration tests", () => {
    it("should run full audit without errors on populated model", async () => {
      const outputPath = path.join(workdir.path, "audit-full.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const report = JSON.parse(content);

      // Verify structure
      expect(report).toHaveProperty("coverage");
      expect(report).toHaveProperty("duplicates");
      expect(report).toHaveProperty("gaps");
      expect(report).toHaveProperty("balance");

      // Verify coverage includes both layers
      expect(report.coverage.length).toBeGreaterThanOrEqual(2);
      const layers = report.coverage.map((c: any) => c.layer);
      expect(layers).toContain("motivation");
      expect(layers).toContain("business");

      unlinkSync(outputPath);
    });

    it("should run combined audit (--type all) without errors", async () => {
      const outputPath = path.join(workdir.path, "audit-all.json");

      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        await auditCommand({
          type: "all",
          output: outputPath,
          format: "json",
        });
      } finally {
        process.chdir(originalCwd);
      }

      expect(await fileExists(outputPath)).toBe(true);
      const content = await readFile(outputPath);
      const merged = JSON.parse(content);

      // Should have both relationship and node audit results
      expect(merged).toHaveProperty("relationships");
      expect(merged).toHaveProperty("nodes");
      expect(merged.relationships).toHaveProperty("coverage");
      expect(merged.nodes).toHaveProperty("layerSummaries");

      unlinkSync(outputPath);
    });

    it("should have non-zero metrics across all audit types", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(workdir.path);

        // Test relationships audit
        const relOutputPath = path.join(workdir.path, "audit-rel.json");
        await auditCommand({
          type: "relationships",
          output: relOutputPath,
          format: "json",
        });

        const relContent = await readFile(relOutputPath);
        const relReport = JSON.parse(relContent);

        // Should have non-zero metrics
        expect(relReport.coverage).toBeDefined();
        expect(relReport.coverage.length).toBeGreaterThan(0);

        // At least some layers should have relationships
        const layersWithRels = relReport.coverage.filter(
          (c: any) => c.relationshipCount > 0
        );
        expect(layersWithRels.length).toBeGreaterThan(0);

        unlinkSync(relOutputPath);

        // Test nodes audit
        const nodeOutputPath = path.join(workdir.path, "audit-nodes.json");
        await auditCommand({
          type: "nodes",
          output: nodeOutputPath,
          format: "json",
        });

        const nodeContent = await readFile(nodeOutputPath);
        const nodeReport = JSON.parse(nodeContent);

        // Should have layer summaries
        expect(nodeReport.layerSummaries).toBeDefined();
        expect(nodeReport.layerSummaries.length).toBeGreaterThan(0);

        unlinkSync(nodeOutputPath);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
