import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { reportCommand } from "@/commands/report";
import { readFile } from "@/utils/file-io";
import path from "path";

describe("Report Command Integration", () => {
  let workdir: any;

  beforeAll(async () => {
    workdir = await createTestWorkdir();
  });

  afterAll(async () => {
    if (workdir?.cleanup) {
      await workdir.cleanup();
    }
  });

  it("should run report command with default options", async () => {
    // This test just verifies the command doesn't throw
    // Output goes to stdout
    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      format: "text",
    });
  });

  it("should generate comprehensive report", async () => {
    const outputPath = path.join(workdir.path, "test-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Architecture Report");
  });

  it("should generate statistics report", async () => {
    const outputPath = path.join(workdir.path, "stats-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "statistics",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
  });

  it("should generate relationships report", async () => {
    const outputPath = path.join(workdir.path, "relationships-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "relationships",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Relationship");
  });

  it("should generate data-model report", async () => {
    const outputPath = path.join(workdir.path, "datamodel-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "data-model",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
  });

  it("should generate quality report", async () => {
    const outputPath = path.join(workdir.path, "quality-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "quality",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("Quality");
  });

  it("should export report as JSON", async () => {
    const outputPath = path.join(workdir.path, "report.json");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      format: "json",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);

    const parsed = JSON.parse(content);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.statistics).toBeDefined();
    expect(parsed.relationships).toBeDefined();
  });

  it("should export report as Markdown", async () => {
    const outputPath = path.join(workdir.path, "report.md");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      format: "markdown",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("# Architecture Report");
  });

  it("should auto-detect format from file extension", async () => {
    const outputPath = path.join(workdir.path, "auto-detect.md");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      // Don't specify format - should auto-detect from .md extension
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content).toContain("# Architecture Report");
  });

  it("should auto-detect JSON format from extension", async () => {
    const outputPath = path.join(workdir.path, "auto-detect.json");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      // Don't specify format - should auto-detect from .json extension
      output: outputPath,
    });

    const content = await readFile(outputPath);
    const parsed = JSON.parse(content);
    expect(parsed.timestamp).toBeDefined();
  });

  it("should include verbose output when requested", async () => {
    const outputPath = path.join(workdir.path, "verbose-report.txt");

    await reportCommand({
      model: workdir.path,
      type: "comprehensive",
      format: "text",
      output: outputPath,
      verbose: true,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
  });

  it("should handle missing data model gracefully", async () => {
    const outputPath = path.join(workdir.path, "dm-report.txt");

    // data-model type should work even if layer is empty
    await reportCommand({
      model: workdir.path,
      type: "data-model",
      format: "text",
      output: outputPath,
    });

    const content = await readFile(outputPath);
    expect(content.length).toBeGreaterThan(0);
  });
});
