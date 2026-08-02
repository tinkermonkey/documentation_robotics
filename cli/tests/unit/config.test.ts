/**
 * Tests for the shared DR config loader (cli/src/config.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRConfigParseError, getDRConfigPath, loadDRConfig, saveDRConfig } from "../../src/config";

const originalDRConfigPath = process.env.DR_CONFIG_PATH;

let testDir: string;
let configPath: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `dr-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  configPath = join(testDir, ".dr-config.yaml");
  process.env.DR_CONFIG_PATH = configPath;
});

afterEach(async () => {
  if (originalDRConfigPath) process.env.DR_CONFIG_PATH = originalDRConfigPath;
  else delete process.env.DR_CONFIG_PATH;

  await rm(testDir, { recursive: true, force: true });
});

describe("getDRConfigPath()", () => {
  it("honors DR_CONFIG_PATH override", () => {
    expect(getDRConfigPath()).toBe(configPath);
  });
});

describe("loadDRConfig()", () => {
  it("returns an empty object when the config file does not exist", async () => {
    const config = await loadDRConfig();
    expect(config).toEqual({});
  });

  it("parses telemetry and mcp sections from the config file", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      configPath,
      `telemetry:
  otlp:
    endpoint: 'http://localhost:4318/v1/traces'
mcp:
  api_key_path: '/home/user/.dr-mcp-key'
`
    );

    const config = await loadDRConfig();
    expect(config.telemetry?.otlp?.endpoint).toBe("http://localhost:4318/v1/traces");
    expect(config.mcp?.api_key_path).toBe("/home/user/.dr-mcp-key");
  });

  it("returns an empty object (not a throw) for invalid YAML", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, "invalid: yaml: content: [");

    const config = await loadDRConfig();
    expect(config).toEqual({});
  });

  it("returns an empty object for an empty file", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, "");

    const config = await loadDRConfig();
    expect(config).toEqual({});
  });

  it("throws a DRConfigParseError for invalid YAML when strict is requested", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, "invalid: yaml: content: [");

    await expect(loadDRConfig({ strict: true })).rejects.toThrow(DRConfigParseError);
  });

  it("does not throw in strict mode when the config file does not exist", async () => {
    const config = await loadDRConfig({ strict: true });
    expect(config).toEqual({});
  });

  it("does not throw in strict mode when the config file is valid", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(configPath, "mcp:\n  api_key_path: '/tmp/key'\n");

    const config = await loadDRConfig({ strict: true });
    expect(config.mcp?.api_key_path).toBe("/tmp/key");
  });
});

describe("saveDRConfig()", () => {
  it("writes the config to disk in YAML format", async () => {
    await saveDRConfig({ mcp: { api_key_path: "/tmp/key" } });

    expect(existsSync(configPath)).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("api_key_path");
    expect(content).toContain("/tmp/key");
  });

  it("creates parent directories that do not yet exist", async () => {
    const nestedPath = join(testDir, "nested", "dir", ".dr-config.yaml");
    process.env.DR_CONFIG_PATH = nestedPath;

    await saveDRConfig({ mcp: { api_key_path: "/tmp/key" } });

    expect(existsSync(nestedPath)).toBe(true);
  });

  it("round-trips through loadDRConfig()", async () => {
    await saveDRConfig({
      telemetry: { otlp: { service_name: "test-service" } },
      mcp: { api_key_path: "/tmp/key" },
    });

    const config = await loadDRConfig();
    expect(config.telemetry?.otlp?.service_name).toBe("test-service");
    expect(config.mcp?.api_key_path).toBe("/tmp/key");
  });

  it("preserves existing sections when only one is updated (read-modify-write)", async () => {
    await saveDRConfig({ telemetry: { otlp: { service_name: "existing-service" } } });

    const current = await loadDRConfig();
    await saveDRConfig({ ...current, mcp: { api_key_path: "/tmp/key" } });

    const updated = await loadDRConfig();
    expect(updated.telemetry?.otlp?.service_name).toBe("existing-service");
    expect(updated.mcp?.api_key_path).toBe("/tmp/key");
  });
});
