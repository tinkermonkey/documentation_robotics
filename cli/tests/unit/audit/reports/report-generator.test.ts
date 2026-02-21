import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { ReportGenerator } from "../../../../src/audit/reports/report-generator.js";
import { JsonFormatter } from "../../../../src/audit/reports/json-formatter.js";
import { MarkdownFormatter } from "../../../../src/audit/reports/markdown-formatter.js";
import type { ReportOptions } from "../../../../src/audit/reports/report-generator.js";
import { promises as fs } from "fs";
import * as path from "path";
import { tmpdir } from "os";

describe("ReportGenerator", () => {
  let outputDir: string;
  let generator: ReportGenerator;
  let jsonFormatter: JsonFormatter;
  let markdownFormatter: MarkdownFormatter;

  beforeEach(async () => {
    // Create temporary output directory
    outputDir = path.join(tmpdir(), `report-test-${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    jsonFormatter = new JsonFormatter();
    markdownFormatter = new MarkdownFormatter();
    generator = new ReportGenerator(jsonFormatter, markdownFormatter);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("should create phase directory structure", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
      },
    };

    await generator.generate(options);

    const phaseDir = path.join(outputDir, "before");
    const exists = await fs.stat(phaseDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("should generate coverage reports in JSON and Markdown", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [
          {
            layer: "api",
            nodeTypeCount: 10,
            relationshipCount: 15,
            isolatedNodeTypes: ["api.endpoint.foo", "api.endpoint.bar"],
            isolationPercentage: 20,
            availablePredicates: ["uses", "calls", "depends-on", "implements", "provides", "consumes", "triggers", "invokes"],
            usedPredicates: ["uses", "calls", "depends-on", "implements", "provides"],
            utilizationPercentage: 62.5,
            relationshipsPerNodeType: 1.5,
          },
        ],
        duplicates: [],
        gaps: [],
        balance: [],
      },
    };

    await generator.generate(options);

    const jsonPath = path.join(outputDir, "before", "coverage-report.json");
    const mdPath = path.join(outputDir, "before", "coverage-report.md");

    const jsonExists = await fs.stat(jsonPath).then(() => true).catch(() => false);
    const mdExists = await fs.stat(mdPath).then(() => true).catch(() => false);

    expect(jsonExists).toBe(true);
    expect(mdExists).toBe(true);
  });

  it("should generate specialized reports", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "after",
      metrics: {
        coverage: [],
        duplicates: [
          {
            relationships: ["api.endpoint.foo", "api.endpoint.bar"],
            reason: "Both connect A to B",
            category: "structural",
            severity: "high",
          },
        ],
        gaps: [
          {
            sourceNodeType: "api.endpoint",
            destinationNodeType: "data-model.entity",
            recommendedPredicate: "uses",
            rationale: "Endpoints typically use entities",
            priority: "high",
          },
        ],
        balance: [
          {
            layer: "api",
            nodeType: "endpoint",
            relationshipCount: 10,
            classification: "structural",
            targetMin: 2,
            targetMax: 5,
            status: "over",
          },
        ],
      },
    };

    await generator.generate(options);

    const duplicatesPath = path.join(outputDir, "after", "duplicates.json");
    const gapsPath = path.join(outputDir, "after", "gaps.json");
    const balancePath = path.join(outputDir, "after", "balance.json");

    const duplicatesExists = await fs.stat(duplicatesPath).then(() => true).catch(() => false);
    const gapsExists = await fs.stat(gapsPath).then(() => true).catch(() => false);
    const balanceExists = await fs.stat(balancePath).then(() => true).catch(() => false);

    expect(duplicatesExists).toBe(true);
    expect(gapsExists).toBe(true);
    expect(balanceExists).toBe(true);
  });

  it("should generate connectivity reports when data available", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
        connectivity: {
          totalNodes: 50,
          totalEdges: 75,
          connectedComponents: 3,
          largestComponentSize: 40,
          isolatedNodes: 5,
          averageDegree: 1.5,
          transitiveChainCount: 12,
        },
      },
    };

    await generator.generate(options);

    const jsonPath = path.join(outputDir, "before", "connectivity.json");
    const mdPath = path.join(outputDir, "before", "connectivity.md");

    const jsonExists = await fs.stat(jsonPath).then(() => true).catch(() => false);
    const mdExists = await fs.stat(mdPath).then(() => true).catch(() => false);

    expect(jsonExists).toBe(true);
    expect(mdExists).toBe(true);
  });

  it("should generate layer-specific reports when requested", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [
          {
            layer: "api",
            nodeTypeCount: 10,
            relationshipCount: 20,
            isolatedNodeTypes: ["api.endpoint.orphan"],
            isolationPercentage: 10,
            availablePredicates: ["uses", "calls", "depends-on", "implements", "provides", "consumes", "triggers", "invokes"],
            usedPredicates: ["uses", "calls", "depends-on", "implements", "provides", "consumes"],
            utilizationPercentage: 75.0,
            relationshipsPerNodeType: 2.0,
          },
          {
            layer: "data-model",
            nodeTypeCount: 5,
            relationshipCount: 15,
            isolatedNodeTypes: [],
            isolationPercentage: 0,
            availablePredicates: ["has", "contains", "references", "extends", "maps-to", "validates"],
            usedPredicates: ["has", "contains", "references", "extends"],
            utilizationPercentage: 66.7,
            relationshipsPerNodeType: 3.0,
          },
        ],
        duplicates: [
          {
            relationships: ["api.endpoint.a", "api.endpoint.b"],
            reason: "Test duplicate",
            category: "structural",
            severity: "low",
          },
        ],
        gaps: [
          {
            sourceNodeType: "api.endpoint",
            destinationNodeType: "data-model.entity",
            recommendedPredicate: "uses",
            rationale: "Test gap",
            priority: "medium",
          },
        ],
        balance: [
          {
            layer: "api",
            nodeType: "endpoint",
            relationshipCount: 5,
            classification: "structural",
            targetMin: 2,
            targetMax: 5,
            status: "optimal",
          },
        ],
      },
      layerReports: true,
    };

    await generator.generate(options);

    const apiLayerPath = path.join(outputDir, "before", "layer-reports", "api.json");
    const dataModelLayerPath = path.join(outputDir, "before", "layer-reports", "data-model.json");

    const apiExists = await fs.stat(apiLayerPath).then(() => true).catch(() => false);
    const dataModelExists = await fs.stat(dataModelLayerPath).then(() => true).catch(() => false);

    expect(apiExists).toBe(true);
    expect(dataModelExists).toBe(true);

    // Verify layer-specific content filters duplicates/gaps correctly
    const apiContent = JSON.parse(await fs.readFile(apiLayerPath, "utf-8"));
    expect(apiContent.layer).toBe("api");
    expect(apiContent.duplicates).toHaveLength(1); // Filtered to API layer
    expect(apiContent.gaps).toHaveLength(1); // Source is API layer
  });

  it("should not generate connectivity reports when data unavailable", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [],
        duplicates: [],
        gaps: [],
        balance: [],
        // No connectivity data
      },
    };

    await generator.generate(options);

    const jsonPath = path.join(outputDir, "before", "connectivity.json");
    const mdPath = path.join(outputDir, "before", "connectivity.md");

    const jsonExists = await fs.stat(jsonPath).then(() => true).catch(() => false);
    const mdExists = await fs.stat(mdPath).then(() => true).catch(() => false);

    expect(jsonExists).toBe(false);
    expect(mdExists).toBe(false);
  });

  it("should aggregate layer data correctly for filtering", async () => {
    const options: ReportOptions = {
      outputDir,
      phase: "before",
      metrics: {
        coverage: [
          {
            layer: "api",
            nodeTypeCount: 5,
            relationshipCount: 10,
            isolatedNodeTypes: [],
            isolationPercentage: 0,
            availablePredicates: ["uses", "calls", "depends-on", "implements", "provides"],
            usedPredicates: ["uses", "calls", "depends-on"],
            utilizationPercentage: 60.0,
            relationshipsPerNodeType: 2.0,
          },
        ],
        duplicates: [
          {
            relationships: ["api.endpoint.a", "api.endpoint.b"],
            reason: "API duplicate",
            category: "structural",
            severity: "low",
          },
          {
            relationships: ["data-model.entity.x", "data-model.entity.y"],
            reason: "Data model duplicate",
            category: "structural",
            severity: "low",
          },
        ],
        gaps: [
          {
            sourceNodeType: "api.endpoint",
            destinationNodeType: "data-model.entity",
            recommendedPredicate: "uses",
            rationale: "API gap",
            priority: "high",
          },
          {
            sourceNodeType: "business.service",
            destinationNodeType: "data-model.entity",
            recommendedPredicate: "manages",
            rationale: "Business gap",
            priority: "low",
          },
        ],
        balance: [
          {
            layer: "api",
            nodeType: "endpoint",
            relationshipCount: 5,
            classification: "structural",
            targetMin: 2,
            targetMax: 6,
            status: "optimal",
          },
          {
            layer: "data-model",
            nodeType: "entity",
            relationshipCount: 3,
            classification: "structural",
            targetMin: 2,
            targetMax: 5,
            status: "optimal",
          },
        ],
      },
      layerReports: true,
    };

    await generator.generate(options);

    const apiLayerPath = path.join(outputDir, "before", "layer-reports", "api.json");
    const apiContent = JSON.parse(await fs.readFile(apiLayerPath, "utf-8"));

    // Verify filtering worked correctly
    expect(apiContent.duplicates).toHaveLength(1); // Only API duplicate
    expect(apiContent.gaps).toHaveLength(1); // Only gap with API as source
    expect(apiContent.balance).toHaveLength(1); // Only API balance
    expect(apiContent.balance[0].layer).toBe("api");
  });
});
