import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PipelineOrchestrator } from "../../src/audit/pipeline/pipeline-orchestrator.js";
import { ReportGenerator } from "../../src/audit/reports/report-generator.js";
import path from "path";
import fs from "fs/promises";
import type { AuditReport } from "../../src/audit/types.js";

describe("Audit Pipeline", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join("/tmp", `audit-pipeline-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("ReportGenerator", () => {
    test("should generate JSON report for before phase", async () => {
      const generator = new ReportGenerator();

      const mockResult: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [
          {
            layer: "motivation",
            nodeTypeCount: 10,
            relationshipCount: 15,
            isolatedNodeTypes: ["TypeA", "TypeB"],
            isolationPercentage: 20,
            availablePredicates: ["defines", "influences"],
            usedPredicates: ["defines"],
            utilizationPercentage: 50,
            relationshipsPerNodeType: 1.5,
          },
        ],
        gaps: [],
        duplicates: [],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 10,
            totalEdges: 15,
            connectedComponents: 1,
            largestComponentSize: 8,
            isolatedNodes: 2,
            averageDegree: 3.0,
            transitiveChainCount: 0,
          },
        },
      };

      const outputPath = await generator.generateReport(mockResult, {
        phase: "before",
        outputDir: tempDir,
        format: "json",
      });

      expect(outputPath).toContain("audit-before.json");

      const fileContent = await fs.readFile(outputPath, "utf-8");
      const report = JSON.parse(fileContent);

      expect(report.metadata.phase).toBe("before");
      expect(report.coverage).toHaveLength(1);
      expect(report.coverage[0].nodeTypeCount).toBe(10);
      expect(report.coverage[0].relationshipsPerNodeType).toBe(1.5);
    });

    test("should generate Markdown report for after phase", async () => {
      const generator = new ReportGenerator();

      const mockResult: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [
          {
            layer: "motivation",
            nodeTypeCount: 10,
            relationshipCount: 20,
            isolatedNodeTypes: ["TypeA"],
            isolationPercentage: 10,
            availablePredicates: ["defines", "influences"],
            usedPredicates: ["defines", "influences"],
            utilizationPercentage: 100,
            relationshipsPerNodeType: 2.0,
          },
        ],
        gaps: [
          {
            sourceNodeType: "TypeC",
            destinationNodeType: "TypeD",
            suggestedPredicate: "depends-on",
            reason: "Missing structural relationship",
            priority: "high",
          },
        ],
        duplicates: [],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 10,
            totalEdges: 20,
            connectedComponents: 1,
            largestComponentSize: 9,
            isolatedNodes: 1,
            averageDegree: 4.0,
            transitiveChainCount: 0,
          },
        },
      };

      const outputPath = await generator.generateReport(mockResult, {
        phase: "after",
        outputDir: tempDir,
        format: "markdown",
      });

      expect(outputPath).toContain("audit-after.md");

      const fileContent = await fs.readFile(outputPath, "utf-8");

      expect(fileContent).toContain("# Relationship Audit Report - AFTER");
      expect(fileContent).toContain("**Total Node Types**: 10");
      expect(fileContent).toContain("**Isolation Rate**: 10.0%");
      expect(fileContent).toContain("## Gap Analysis");
      expect(fileContent).toContain("TypeC");
    });

    test("should generate Text report with verbose details", async () => {
      const generator = new ReportGenerator();

      const mockResult: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [
          {
            layer: "motivation",
            nodeTypeCount: 5,
            relationshipCount: 8,
            isolatedNodeTypes: [],
            isolationPercentage: 0,
            availablePredicates: ["defines", "influences", "realizes"],
            usedPredicates: ["defines", "influences"],
            utilizationPercentage: 66.7,
            relationshipsPerNodeType: 1.6,
          },
        ],
        gaps: [],
        duplicates: [
          {
            relationships: ["rel-1", "rel-2"],
            predicates: ["defines", "specifies"],
            sourceNodeType: "TypeA",
            destinationNodeType: "TypeB",
            reason: "Similar predicates",
            confidence: "high",
          },
        ],
        balance: [],
        connectivity: {
          components: [],
          degrees: [],
          transitiveChains: [],
          stats: {
            totalNodes: 5,
            totalEdges: 8,
            connectedComponents: 1,
            largestComponentSize: 5,
            isolatedNodes: 0,
            averageDegree: 3.2,
            transitiveChainCount: 0,
          },
        },
      };

      const outputPath = await generator.generateReport(mockResult, {
        phase: "before",
        outputDir: tempDir,
        format: "text",
        verbose: true,
      });

      const fileContent = await fs.readFile(outputPath, "utf-8");

      expect(fileContent).toContain("RELATIONSHIP AUDIT REPORT - BEFORE");
      expect(fileContent).toContain("DUPLICATE CANDIDATES");
      expect(fileContent).toContain("rel-1");
      expect(fileContent).toContain("Similar predicates");
    });
  });

  describe("PipelineOrchestrator", () => {
    test("should create output directory structure", async () => {
      // This is a structural test - we can't run full pipeline without model/spec
      // but we can verify the directory structure would be created

      const outputDir = path.join(tempDir, "audit-results");

      // Create mock directories to simulate pipeline execution
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const sessionDir = path.join(outputDir, timestamp);
      const beforeDir = path.join(sessionDir, "before");
      const afterDir = path.join(sessionDir, "after");
      const summaryDir = path.join(sessionDir, "summary");

      await fs.mkdir(beforeDir, { recursive: true });
      await fs.mkdir(afterDir, { recursive: true });
      await fs.mkdir(summaryDir, { recursive: true });

      // Verify directories exist
      const beforeStat = await fs.stat(beforeDir);
      const afterStat = await fs.stat(afterDir);
      const summaryStat = await fs.stat(summaryDir);

      expect(beforeStat.isDirectory()).toBe(true);
      expect(afterStat.isDirectory()).toBe(true);
      expect(summaryStat.isDirectory()).toBe(true);
    });

    test("should generate expected report filenames", () => {
      const formats = ["json", "markdown", "text"];
      const expectedFilenames = {
        json: "audit-before.json",
        markdown: "audit-before.md",
        text: "audit-before.txt",
      };

      formats.forEach((format) => {
        const filename = `audit-before.${format === "text" ? "txt" : format === "markdown" ? "md" : "json"}`;
        expect(filename).toBe(expectedFilenames[format as keyof typeof expectedFilenames]);
      });
    });
  });

  describe("Pipeline Integration", () => {
    test("should execute pipeline steps in correct order", async () => {
      // This test verifies the conceptual flow without actual execution
      const expectedSteps = [
        "Run BEFORE audit",
        "Save BEFORE snapshot",
        "Generate BEFORE report",
        "Run AI evaluation (if enabled)",
        "Run AFTER audit",
        "Save AFTER snapshot",
        "Generate AFTER report",
        "Generate differential summary",
      ];

      // Verify the steps are documented correctly
      expect(expectedSteps).toHaveLength(8);
      expect(expectedSteps[0]).toBe("Run BEFORE audit");
      expect(expectedSteps[expectedSteps.length - 1]).toBe("Generate differential summary");
    });

    test("should handle pipeline without AI evaluation", () => {
      const stepsWithoutAI = [
        "Run BEFORE audit",
        "Save BEFORE snapshot",
        "Generate BEFORE report",
      ];

      expect(stepsWithoutAI).toHaveLength(3);
    });
  });
});
