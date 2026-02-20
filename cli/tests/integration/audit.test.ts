/**
 * Integration tests for the audit command
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { auditCommand } from "../../src/commands/audit.js";
import { fileExists, readFile } from "../../src/utils/file-io.js";
import { unlinkSync } from "node:fs";
import path from "path";
import { createTestWorkdir } from "../helpers/golden-copy.js";

describe("audit command", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("should run full audit and output text by default", async () => {
    // Capture console output
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await auditCommand({});

      // Verify output contains expected sections
      const output = logs.join("\n");
      expect(output).toContain("Relationship Audit Report");
      expect(output).toContain("Coverage Analysis Summary");
      expect(output).toContain("Duplicate Detection Summary");
      expect(output).toContain("Gap Analysis Summary");
      expect(output).toContain("Balance Assessment Summary");
      expect(output).toContain("Connectivity Analysis Summary");
    } finally {
      console.log = originalLog;
    }
  });

  it("should generate JSON audit report", async () => {
    const outputPath = path.join(workdir.path, "audit-report.json");

    await auditCommand({
      output: outputPath,
      format: "json",
    });

    // Verify file exists
    expect(await fileExists(outputPath)).toBe(true);

    // Verify JSON structure
    const content = await readFile(outputPath);
    const report = JSON.parse(content);

    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("model");
    expect(report).toHaveProperty("coverage");
    expect(report).toHaveProperty("duplicates");
    expect(report).toHaveProperty("gaps");
    expect(report).toHaveProperty("balance");
    expect(report).toHaveProperty("connectivity");

    // Verify coverage has entries
    expect(Array.isArray(report.coverage)).toBe(true);
    expect(report.coverage.length).toBeGreaterThan(0);

    // Verify connectivity structure
    expect(report.connectivity).toHaveProperty("components");
    expect(report.connectivity).toHaveProperty("degrees");
    expect(report.connectivity).toHaveProperty("transitiveChains");
    expect(report.connectivity).toHaveProperty("stats");

    // Clean up
    unlinkSync(outputPath);
  });

  it("should generate Markdown audit report", async () => {
    const outputPath = path.join(workdir.path, "audit-report.md");

    await auditCommand({
      output: outputPath,
      format: "markdown",
    });

    // Verify file exists
    expect(await fileExists(outputPath)).toBe(true);

    // Verify markdown structure
    const content = await readFile(outputPath);
    expect(content).toContain("# Relationship Audit Report");
    expect(content).toContain("## Contents");
    expect(content).toContain("## Executive Summary");
    expect(content).toContain("## Coverage Analysis");
    expect(content).toContain("## Duplicate Detection");
    expect(content).toContain("## Gap Analysis");
    expect(content).toContain("## Balance Assessment");
    expect(content).toContain("## Connectivity Analysis");

    // Verify markdown tables
    expect(content).toMatch(/\|.*\|.*\|/); // Contains table rows

    // Clean up
    unlinkSync(outputPath);
  });

  it("should auto-detect format from file extension", async () => {
    const jsonPath = path.join(workdir.path, "audit.json");
    const mdPath = path.join(workdir.path, "audit.md");

    // Test JSON auto-detection
    await auditCommand({
      output: jsonPath,
    });

    expect(await fileExists(jsonPath)).toBe(true);
    const jsonContent = await readFile(jsonPath);
    expect(() => JSON.parse(jsonContent)).not.toThrow();

    // Test Markdown auto-detection
    await auditCommand({
      output: mdPath,
    });

    expect(await fileExists(mdPath)).toBe(true);
    const mdContent = await readFile(mdPath);
    expect(mdContent).toContain("# Relationship Audit Report");

    // Clean up
    unlinkSync(jsonPath);
    unlinkSync(mdPath);
  });

  it("should audit specific layer", async () => {
    const outputPath = path.join(workdir.path, "motivation-audit.json");

    await auditCommand({
      layer: "motivation",
      output: outputPath,
      format: "json",
    });

    // Verify file exists
    expect(await fileExists(outputPath)).toBe(true);

    // Verify content is filtered to motivation layer
    const content = await readFile(outputPath);
    const report = JSON.parse(content);

    // Coverage should have only one entry (motivation layer)
    expect(report.coverage.length).toBe(1);
    expect(report.coverage[0].layer).toBe("motivation");

    // Clean up
    unlinkSync(outputPath);
  });

  it("should include verbose details when requested", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      await auditCommand({
        verbose: true,
      });

      const output = logs.join("\n");

      // Verbose mode should include detailed sections
      expect(output).toContain("Coverage Analysis (Detailed)");
      expect(output).toContain("Duplicate Detection (Detailed)");
      expect(output).toContain("Gap Analysis (Detailed)");
      expect(output).toContain("Balance Assessment (Detailed)");
      expect(output).toContain("Connectivity Analysis (Detailed)");
    } finally {
      console.log = originalLog;
    }
  });

  it("should handle invalid layer gracefully", async () => {
    const outputPath = path.join(workdir.path, "invalid-audit.json");

    await expect(
      auditCommand({
        layer: "invalid-layer",
        output: outputPath,
      })
    ).rejects.toThrow("Layer not found: invalid-layer");

    // Verify no file was created
    expect(await fileExists(outputPath)).toBe(false);
  });

  it("should include all expected metrics in report", async () => {
    const outputPath = path.join(workdir.path, "full-audit.json");

    await auditCommand({
      output: outputPath,
      format: "json",
    });

    const content = await readFile(outputPath);
    const report = JSON.parse(content);

    // Verify coverage metrics
    for (const coverage of report.coverage) {
      expect(coverage).toHaveProperty("layer");
      expect(coverage).toHaveProperty("nodeTypeCount");
      expect(coverage).toHaveProperty("relationshipCount");
      expect(coverage).toHaveProperty("isolatedNodeTypes");
      expect(coverage).toHaveProperty("isolationPercentage");
      expect(coverage).toHaveProperty("availablePredicates");
      expect(coverage).toHaveProperty("usedPredicates");
      expect(coverage).toHaveProperty("utilizationPercentage");
      expect(coverage).toHaveProperty("relationshipsPerNodeType");
    }

    // Verify duplicate candidates have required fields
    for (const dup of report.duplicates) {
      expect(dup).toHaveProperty("relationships");
      expect(dup).toHaveProperty("predicates");
      expect(dup).toHaveProperty("sourceNodeType");
      expect(dup).toHaveProperty("destinationNodeType");
      expect(dup).toHaveProperty("reason");
      expect(dup).toHaveProperty("confidence");
    }

    // Verify gap candidates have required fields
    for (const gap of report.gaps) {
      expect(gap).toHaveProperty("sourceNodeType");
      expect(gap).toHaveProperty("destinationNodeType");
      expect(gap).toHaveProperty("suggestedPredicate");
      expect(gap).toHaveProperty("reason");
      expect(gap).toHaveProperty("priority");
    }

    // Verify balance assessments have required fields
    for (const balance of report.balance) {
      expect(balance).toHaveProperty("nodeType");
      expect(balance).toHaveProperty("layer");
      expect(balance).toHaveProperty("category");
      expect(balance).toHaveProperty("currentCount");
      expect(balance).toHaveProperty("targetRange");
      expect(balance).toHaveProperty("status");
    }

    // Verify connectivity stats
    expect(report.connectivity.stats).toHaveProperty("totalNodes");
    expect(report.connectivity.stats).toHaveProperty("totalEdges");
    expect(report.connectivity.stats).toHaveProperty("connectedComponents");
    expect(report.connectivity.stats).toHaveProperty("largestComponentSize");
    expect(report.connectivity.stats).toHaveProperty("isolatedNodes");
    expect(report.connectivity.stats).toHaveProperty("averageDegree");
    expect(report.connectivity.stats).toHaveProperty("transitiveChainCount");

    // Clean up
    unlinkSync(outputPath);
  });

  it("should create output directory if it does not exist", async () => {
    const outputDir = path.join(workdir.path, "reports", "audit");
    const outputPath = path.join(outputDir, "audit-report.json");

    await auditCommand({
      output: outputPath,
      format: "json",
    });

    // Verify file exists (directory was created)
    expect(await fileExists(outputPath)).toBe(true);

    // Clean up
    unlinkSync(outputPath);
  });
});
