import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadScanConfig } from "../../../src/scan/config.js";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("Scan Config Loader", () => {
  let tempConfigPath: string;

  beforeEach(() => {
    tempConfigPath = join(tmpdir(), ".dr-config-test.yaml");
  });

  afterEach(async () => {
    try {
      await rm(tempConfigPath);
    } catch {
      // File may not exist
    }
    delete process.env.DR_CONFIG_PATH;
  });

  it("should return default config when file does not exist", async () => {
    process.env.DR_CONFIG_PATH = join(tmpdir(), "nonexistent-config.yaml");
    const config = await loadScanConfig();

    expect(config).toBeDefined();
    expect(config.codeprism?.command).toBe("codeprism");
    expect(config.confidence_threshold).toBe(0.7);
  });

  it("should load config from file", async () => {
    const yaml = `scan:
  codeprism:
    command: my-codeprism
    args: ["--mcp", "--debug"]
    timeout: 10000
  confidence_threshold: 0.8
  disabled_patterns: ["pattern1", "pattern2"]
`;
    await writeFile(tempConfigPath, yaml);
    process.env.DR_CONFIG_PATH = tempConfigPath;

    const config = await loadScanConfig();

    expect(config.codeprism?.command).toBe("my-codeprism");
    expect(config.codeprism?.args).toEqual(["--mcp", "--debug"]);
    expect(config.codeprism?.timeout).toBe(10000);
    expect(config.confidence_threshold).toBe(0.8);
    expect(config.disabled_patterns).toEqual(["pattern1", "pattern2"]);
  });

  it("should apply environment variable overrides", async () => {
    process.env.SCAN_CODEPRISM_COMMAND = "env-codeprism";
    process.env.SCAN_CONFIDENCE_THRESHOLD = "0.9";

    const config = await loadScanConfig();

    expect(config.codeprism?.command).toBe("env-codeprism");
    expect(config.confidence_threshold).toBe(0.9);

    delete process.env.SCAN_CODEPRISM_COMMAND;
    delete process.env.SCAN_CONFIDENCE_THRESHOLD;
  });

  it("should validate confidence threshold range", async () => {
    const yaml = `scan:
  confidence_threshold: 1.5
`;
    await writeFile(tempConfigPath, yaml);
    process.env.DR_CONFIG_PATH = tempConfigPath;

    try {
      await loadScanConfig();
      throw new Error("Should have thrown");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toContain("between 0.0 and 1.0");
    }
  });

  it("should handle invalid YAML gracefully", async () => {
    // Use YAML with bad indentation which will fail parsing
    const yaml = `scan:
  codeprism:
    command: test
  confidence_threshold: 0.5
	invalid_tab: here
`;
    await writeFile(tempConfigPath, yaml);
    process.env.DR_CONFIG_PATH = tempConfigPath;

    // Should throw error when YAML is invalid - fail explicitly to alert user
    try {
      await loadScanConfig();
      throw new Error("Should have thrown for invalid YAML");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      const message = (error as Error).message;
      // Error message should mention YAML syntax issue or config file error
      expect(message.toLowerCase()).toContain("yaml") || expect(message).toContain("config file");
    }
  });
});
