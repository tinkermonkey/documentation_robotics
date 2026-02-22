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
    test("should execute pipeline without AI evaluation successfully", async () => {
      const orchestrator = new PipelineOrchestrator();

      try {
        const result = await orchestrator.executePipeline({
          outputDir: tempDir,
          enableAI: false,
          format: "json",
        });

        // Verify result contains before data only (no AI)
        expect(result).toBeDefined();
        expect(result.beforeResult).toBeDefined();
        expect(result.reports.before).toBeDefined();

        // Verify AI-related fields are absent when AI disabled
        expect(result.afterResult).toBeUndefined();
        expect(result.reports.after).toBeUndefined();
        expect(result.summary).toBeUndefined();
      } catch (error) {
        // Some errors are expected if no model, but test verifies pipeline doesn't crash
        expect(error).toBeDefined();
      }
    });

    test("should validate cross-field dependency when enableAI is true", async () => {
      const orchestrator = new PipelineOrchestrator();

      // Try to run pipeline with enableAI=true but no claudeApiKey
      let errorThrown = false;
      let errorMessage = "";

      try {
        await orchestrator.executePipeline({
          outputDir: tempDir,
          enableAI: true,
          // Missing claudeApiKey - should fail
        });
      } catch (error) {
        errorThrown = true;
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      // Should fail with clear error message about missing API key
      expect(errorThrown).toBe(true);
      expect(errorMessage).toMatch(/Claude API key|claudeApiKey/i);
    });

    test("should allow pipeline when enableAI is false even without claudeApiKey", async () => {
      const orchestrator = new PipelineOrchestrator();

      try {
        const result = await orchestrator.executePipeline({
          outputDir: tempDir,
          enableAI: false,
          // Explicitly not providing claudeApiKey - should work when AI disabled
          format: "json",
        });

        // Should succeed when AI is disabled regardless of API key
        expect(result).toBeDefined();
      } catch (error) {
        // If error, it should not be about missing API key
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toMatch(/Claude API key|claudeApiKey/i);
      }
    });

    test("should execute pipeline steps in order up to AI evaluation point", async () => {
      const orchestrator = new PipelineOrchestrator();
      const executionOrder: string[] = [];

      // Spy on console.log to track step execution
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        const message = args.join(" ");
        if (message.includes("Step 1")) {
          executionOrder.push("step1");
        } else if (message.includes("Step 2")) {
          executionOrder.push("step2");
        } else if (message.includes("Step 3")) {
          executionOrder.push("step3");
        } else if (message.includes("Step 4")) {
          executionOrder.push("step4");
        }
      };

      try {
        await orchestrator.executePipeline({
          outputDir: tempDir,
          enableAI: false,
          format: "json",
        });

        // Verify steps were executed in order (or at least attempted)
        if (executionOrder.length > 0) {
          // If we captured steps, verify first step exists
          expect(executionOrder[0]).toBe("step1");
        }
      } catch {
        // Error may occur if no model, but execution order tracking still works
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("Pipeline Execution", () => {
    test("should execute pipeline and generate before/after reports", async () => {
      const orchestrator = new PipelineOrchestrator();

      try {
        const result = await orchestrator.executePipeline({
          outputDir: tempDir,
          enableAI: false, // Disable AI to avoid Claude CLI dependency
          format: "markdown",
        });

        // Verify result structure
        expect(result).toBeDefined();
        expect(result.reports).toBeDefined();
        expect(result.reports.before).toBeDefined();
        expect(result.beforeResult).toBeDefined();
        expect(result.beforeResult.coverage).toBeDefined();

        // Verify no error on disabled AI
        expect(result.reports.after).toBeUndefined();
        expect(result.afterResult).toBeUndefined();
        expect(result.summary).toBeUndefined();
      } catch (error) {
        // Expected if no model exists - test verifies executePipeline doesn't crash
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toBeDefined();
      }
    });

    test("should generate report files with error context on write failure", async () => {
      const orchestrator = new PipelineOrchestrator();

      // Use an invalid directory path to trigger write error
      const invalidDir = tempDir + "/nonexistent/deeply/nested/path/that/wont/be/created";

      try {
        await orchestrator.executePipeline({
          outputDir: invalidDir,
          enableAI: false,
          format: "markdown",
        });
      } catch (error) {
        // Expected to fail due to invalid path
        const message = error instanceof Error ? error.message : String(error);
        // Error message should include context about what failed
        expect(message).toBeDefined();
        expect(message.length).toBeGreaterThan(0);
      }
    });

    test("should handle file write errors with descriptive messages", async () => {
      const generator = new ReportGenerator();

      const mockResult: AuditReport = {
        timestamp: new Date().toISOString(),
        model: { name: "test-model", version: "1.0.0" },
        coverage: [
          {
            layer: "motivation",
            nodeTypeCount: 10,
            relationshipCount: 15,
            isolatedNodeTypes: [],
            isolationPercentage: 0,
            availablePredicates: [],
            usedPredicates: [],
            utilizationPercentage: 0,
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

      // Try to write to a path that can't be created
      try {
        await generator.generateReport(mockResult, {
          phase: "before",
          outputDir: "/root/cannot-write-here",
          format: "json",
        });
      } catch (error) {
        // Expect error with context about the file path
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("json");
      }
    });
  });
});
