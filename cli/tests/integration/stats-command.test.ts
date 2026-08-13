/**
 * Integration tests for the stats command
 * Verifies statistics collection and output formatting
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr, stripAnsi } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = {
  path: "",
  cleanup: async () => {}
};

describe("stats command", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it("should display basic statistics", async () => {
    // Initialize a model
    await runDr(["init", "--name", "Test Stats Model"], { cwd: tempDir.path });

    const result = await runDr(["stats"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Test Stats Model");
    expect(result.stdout).toContain("Overview");
    expect(result.stdout).toContain("Elements by Layer");
  });

  it("should display relationship statistics", async () => {
    await runDr(["init", "--name", "Relationship Stats"], {
      cwd: tempDir.path
    });

    // Add elements
    await runDr(
      [
        "add",
        "motivation",
        "goal",
        "test-goal-1",
        "--name",
        "Satisfy users",
        "--attributes",
        '{"priority":"high"}'
      ],
      {
        cwd: tempDir.path
      }
    );
    await runDr(
      [
        "add",
        "business",
        "service",
        "test-service-1",
        "--name",
        "User Service"
      ],
      {
        cwd: tempDir.path
      }
    );

    // Add relationship
    await runDr(
      [
        "relationship",
        "add",
        "motivation.goal.test-goal-1",
        "business.service.test-service-1"
      ],
      {
        cwd: tempDir.path
      }
    );

    const result = await runDr(["stats"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    // Command should succeed and show model info
    expect(result.stdout).toContain("Relationship Stats");
    expect(result.stdout).toContain("Elements by Layer");
  });

  it("should support compact format", async () => {
    await runDr(["init", "--name", "Compact Stats"], { cwd: tempDir.path });

    const result = await runDr(["stats", "--compact"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Compact Stats");
    expect(result.stdout).toContain("elements");
    expect(result.stdout).toContain("relationships");
    // Compact format should be on one or two lines
    expect(result.stdout.trim().split("\n").length).toBeLessThanOrEqual(2);
  });

  it("should support JSON format", async () => {
    await runDr(["init", "--name", "JSON Stats"], { cwd: tempDir.path });

    const result = await runDr(["stats", "--format", "json"], {
      cwd: tempDir.path
    });

    expect(result.exitCode).toBe(0);

    // Parse JSON to verify it's valid
    const stats = JSON.parse(result.stdout);
    expect(stats.project.name).toBe("JSON Stats");
    expect(stats.statistics).toBeDefined();
    expect(stats.statistics.totalElements).toBeGreaterThanOrEqual(0);
    expect(stats.layers).toBeDefined();
    expect(Array.isArray(stats.layers)).toBe(true);
  });

  it("should support markdown format", async () => {
    await runDr(["init", "--name", "Markdown Stats"], { cwd: tempDir.path });

    const result = await runDr(["stats", "--format", "markdown"], {
      cwd: tempDir.path
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Markdown Stats");
    expect(result.stdout).toContain("## Overview");
    expect(result.stdout).toContain("## Elements by Layer");
    expect(result.stdout).toContain("| Layer |");
  });

  it("should save to file with auto-detected format", async () => {
    await runDr(["init", "--name", "File Output Stats"], { cwd: tempDir.path });

    // Test JSON file output
    const jsonResult = await runDr(["stats", "--output", "stats.json"], {
      cwd: tempDir.path
    });
    expect(jsonResult.exitCode).toBe(0);
    expect(jsonResult.stdout).toContain("stats.json");

    // Read the file
    const fs = await import("fs/promises");
    const jsonContent = await fs.readFile(
      `${tempDir.path}/stats.json`,
      "utf-8"
    );
    const stats = JSON.parse(jsonContent);
    expect(stats.project.name).toBe("File Output Stats");
  });

  it("should save markdown to file", async () => {
    await runDr(["init", "--name", "Markdown File Stats"], {
      cwd: tempDir.path
    });

    const result = await runDr(["stats", "--output", "stats.md"], {
      cwd: tempDir.path
    });
    expect(result.exitCode).toBe(0);

    // Read the file
    const fs = await import("fs/promises");
    const mdContent = await fs.readFile(`${tempDir.path}/stats.md`, "utf-8");
    expect(mdContent).toContain("# Markdown File Stats");
    expect(mdContent).toContain("## Overview");
  });

  it("should show validation status", async () => {
    await runDr(["init", "--name", "Valid Model"], { cwd: tempDir.path });

    const result = await runDr(["stats"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Status");
    expect(result.stdout).toContain("Valid");
  });

  it("should calculate completeness metrics", async () => {
    await runDr(["init", "--name", "Completeness Test"], { cwd: tempDir.path });

    const result = await runDr(["stats"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Completeness");
    expect(result.stdout).toContain("%");

    // Validate that output contains progress bar elements
    // Progress bar should have filled (█) and/or empty (░) blocks
    const completenessSection = stripAnsi(result.stdout);
    const hasProgressBar =
      /[█░]/.test(completenessSection) &&
      /\d+(\.\d+)?%/.test(completenessSection);
    expect(hasProgressBar).toBe(true);
  });

  it("should format dates nicely in output", async () => {
    await runDr(["init", "--name", "Date Format Test"], { cwd: tempDir.path });

    const result = await runDr(["stats"], { cwd: tempDir.path });

    expect(result.exitCode).toBe(0);

    // Validate date format with structured assertion
    // Expected format: "Jan 15, 2024" (Month DD, YYYY)
    const cleanOutput = stripAnsi(result.stdout);
    const dateRegex = /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/;
    const dateMatch = cleanOutput.match(dateRegex);

    expect(dateMatch).toBeTruthy();
    if (dateMatch) {
      // Verify the extracted date is valid by attempting to parse it
      const dateStr = dateMatch[1];
      const parsedDate = new Date(dateStr);
      expect(isNaN(parsedDate.getTime())).toBe(false);
    }
  });
});
