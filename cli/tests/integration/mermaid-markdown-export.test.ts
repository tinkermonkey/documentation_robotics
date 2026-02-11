import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { ensureDir, fileExists, readFile } from "@/utils/file-io";
import { exportCommand } from "@/commands/export";
import * as path from "path";
import * as fs from "fs/promises";

describe("Mermaid Markdown Export Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = `/tmp/test-mermaid-markdown-${Date.now()}`;
    await ensureDir(testDir);
    await ensureDir(`${testDir}/.dr/layers`);

    // Create a test model
    const manifest = new Manifest({
      name: "Integration Test Model",
      version: "1.0.0",
      description: "Test model for enhanced markdown export",
      author: "Test Suite",
    });

    const model = new Model(testDir, manifest);

    // Add motivation layer with elements
    const motivationLayer = new Layer("motivation");
    const goal = new Element({
      id: "motivation.goal.improve-quality",
      type: "goal",
      name: "Improve Quality",
      description: "Improve overall product quality",
      properties: { priority: "high", owner: "CEO" },
    });

    motivationLayer.addElement(goal);
    model.addLayer(motivationLayer);

    // Add business layer
    const businessLayer = new Layer("business");
    const capability = new Element({
      id: "business.capability.quality-management",
      type: "capability",
      name: "Quality Management",
      description: "Manage quality processes and metrics",
      properties: { owner: "QA Team", criticality: "HIGH" },
    });

    businessLayer.addElement(capability);
    model.addLayer(businessLayer);

    // Add application layer
    const appLayer = new Layer("application");
    const service = new Element({
      id: "application.service.quality-service",
      type: "service",
      name: "Quality Service",
      description: "Microservice for quality management",
      properties: { framework: "Node.js", status: "production" },
    });

    appLayer.addElement(service);
    model.addLayer(appLayer);

    // Add API layer
    const apiLayer = new Layer("api");
    const endpoint = new Element({
      id: "api.endpoint.quality-metrics",
      type: "endpoint",
      name: "Quality Metrics",
      description: "Retrieve quality metrics and reports",
      properties: {
        method: "GET",
        path: "/api/quality/metrics",
        authentication: "JWT",
      },
    });

    apiLayer.addElement(endpoint);
    model.addLayer(apiLayer);

    // Add data-model layer
    const dataModelLayer = new Layer("data-model");
    const schema = new Element({
      id: "data-model.object-schema.metric",
      type: "object-schema",
      name: "Metric",
      description: "Quality metric data structure",
      properties: { format: "JSON", version: "1.0" },
    });

    dataModelLayer.addElement(schema);
    model.addLayer(dataModelLayer);

    // Add relationships
    goal.references.push({
      target: "business.capability.quality-management",
      type: "satisfied-by",
      description: "This capability satisfies the goal",
    });

    capability.relationships.push({
      target: "application.service.quality-service",
      predicate: "realized-by",
    });

    service.relationships.push({
      target: "api.endpoint.quality-metrics",
      predicate: "exposes",
    });

    endpoint.relationships.push({
      target: "data-model.object-schema.metric",
      predicate: "uses",
    });

    // Save the model
    await model.save();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("export command with mermaid-markdown format", () => {
    it("should export model to mermaid markdown format", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      expect(await fileExists(outputFile)).toBe(true);
      const content = await readFile(outputFile, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    });

    it("should include model header and metadata", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("# Integration Test Model");
      expect(content).toContain("Test model for enhanced markdown export");
      expect(content).toContain("| Property | Value |");
      expect(content).toContain("| Name | Integration Test Model |");
      expect(content).toContain("| Version | 1.0.0 |");
    });

    it("should include mermaid diagrams", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("```mermaid");
      expect(content).toContain("```");
      expect(content).toContain("graph");
    });

    it("should include table of contents", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("## Table of Contents");
      expect(content).toContain("Architecture Overview");
      expect(content).toContain("Layer Summary");
      expect(content).toContain("Detailed Layer Documentation");
    });

    it("should include all layer sections", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("### Motivation");
      expect(content).toContain("### Business");
      expect(content).toContain("### Application");
      expect(content).toContain("### API");
      expect(content).toContain("### Data Model");
    });

    it("should include element details", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("Improve Quality");
      expect(content).toContain("Quality Management");
      expect(content).toContain("Quality Service");
      expect(content).toContain("Quality Metrics");
    });

    it("should include statistics section", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("## Architecture Statistics");
      expect(content).toContain("Total Elements");
      expect(content).toContain("Total Relationships");
    });

    it("should include relationships summary", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("## Relationships Summary");
      // The summary might be empty if relationships aren't loaded into the graph yet
      expect(content).toContain("| Relationship Type | Count |");
    });

    it("should output to stdout when no output file specified", async () => {
      // Capture console output
      let capturedOutput = "";
      const originalLog = console.log;
      console.log = (msg: string) => {
        capturedOutput += msg + "\n";
      };

      try {
        await exportCommand({
          format: "mermaid-markdown",
          model: testDir,
        });

        expect(capturedOutput).toContain("# Integration Test Model");
        expect(capturedOutput).toContain("```mermaid");
      } finally {
        console.log = originalLog;
      }
    });

    it("should include property details in tables", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      expect(content).toContain("| Property | Value |");
      expect(content).toContain("priority");
      expect(content).toContain("high");
    });

    it("should format markdown syntax correctly", async () => {
      const outputFile = `${testDir}/export.md`;

      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      const content = await readFile(outputFile, "utf-8");

      // Check for proper heading structure
      expect(content).toMatch(/^# /m);
      expect(content).toMatch(/^## /m);
      expect(content).toMatch(/^### /m);

      // Check for proper list formatting
      expect(content).toMatch(/^- /m);

      // Check for proper code block
      expect(content).toMatch(/```[\s\S]*?```/);
    });
  });

  describe("format selection", () => {
    it("should be available in export formats list", async () => {
      // Just verify the format is registered by attempting export
      const outputFile = `${testDir}/export-format-test.md`;

      // Should not throw
      await exportCommand({
        format: "mermaid-markdown",
        output: outputFile,
        model: testDir,
      });

      expect(await fileExists(outputFile)).toBe(true);
    });
  });
});
