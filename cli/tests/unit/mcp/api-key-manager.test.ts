/**
 * Tests for ApiKeyManager (generate/store/load/validate/ensureKey)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ApiKeyManager, getDefaultApiKeyPath } from "../../../src/mcp/api-key-manager";

const originalDRConfigPath = process.env.DR_CONFIG_PATH;

let testDir: string;
let configPath: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `dr-api-key-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  configPath = join(testDir, ".dr-config.yaml");
  process.env.DR_CONFIG_PATH = configPath;
});

afterEach(async () => {
  if (originalDRConfigPath) process.env.DR_CONFIG_PATH = originalDRConfigPath;
  else delete process.env.DR_CONFIG_PATH;

  await rm(testDir, { recursive: true, force: true });
});

describe("getDefaultApiKeyPath()", () => {
  it("resolves to .dr-mcp-key under the home directory", () => {
    expect(getDefaultApiKeyPath()).toBe(join(homedir(), ".dr-mcp-key"));
  });
});

describe("ApiKeyManager", () => {
  describe("generate()", () => {
    it("generates a key with the dr-mcp- prefix", () => {
      const manager = new ApiKeyManager();
      const key = manager.generate();
      expect(key.startsWith("dr-mcp-")).toBe(true);
    });

    it("generates unique keys on each call", () => {
      const manager = new ApiKeyManager();
      const a = manager.generate();
      const b = manager.generate();
      expect(a).not.toBe(b);
    });
  });

  describe("store() / load()", () => {
    it("writes the key to disk and reads it back", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "key-file");
      const key = manager.generate();

      await manager.store(keyPath, key);
      const loaded = await manager.load(keyPath);

      expect(loaded).toBe(key);
    });

    it("writes the key file with 0600 permissions", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "key-file-perms");
      await manager.store(keyPath, manager.generate());

      const mode = statSync(keyPath).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("creates parent directories that do not yet exist", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "nested", "dir", "key-file");
      await manager.store(keyPath, manager.generate());

      expect(existsSync(keyPath)).toBe(true);
    });

    it("trims trailing whitespace when loading", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "key-file-trim");
      await manager.store(keyPath, "dr-mcp-abc123");

      const raw = await readFile(keyPath, "utf-8");
      expect(raw.endsWith("\n")).toBe(true);

      const loaded = await manager.load(keyPath);
      expect(loaded).toBe("dr-mcp-abc123");
    });
  });

  describe("validate()", () => {
    it("returns true for a matching key", () => {
      const manager = new ApiKeyManager();
      expect(manager.validate("dr-mcp-secret", "dr-mcp-secret")).toBe(true);
    });

    it("returns false for a mismatched key", () => {
      const manager = new ApiKeyManager();
      expect(manager.validate("dr-mcp-wrong", "dr-mcp-secret")).toBe(false);
    });

    it("returns false for keys of different length", () => {
      const manager = new ApiKeyManager();
      expect(manager.validate("short", "dr-mcp-a-much-longer-secret")).toBe(false);
    });

    it("returns false when no key is provided", () => {
      const manager = new ApiKeyManager();
      expect(manager.validate(undefined, "dr-mcp-secret")).toBe(false);
      expect(manager.validate(null, "dr-mcp-secret")).toBe(false);
      expect(manager.validate("", "dr-mcp-secret")).toBe(false);
    });
  });

  describe("ensureKey()", () => {
    it("generates a new key, stores it, and records the path in the config file on first run", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "generated-key");

      const result = await manager.ensureKey(async (defaultPath) => {
        expect(defaultPath.length).toBeGreaterThan(0);
        return keyPath;
      });

      expect(result.isNew).toBe(true);
      expect(result.path).toBe(keyPath);
      expect(result.key.startsWith("dr-mcp-")).toBe(true);
      expect(existsSync(keyPath)).toBe(true);

      const { loadDRConfig } = await import("../../../src/config");
      const config = await loadDRConfig();
      expect(config.mcp?.api_key_path).toBe(keyPath);
    });

    it("loads the existing key without prompting on subsequent runs", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "existing-key");

      const first = await manager.ensureKey(async () => keyPath);

      let promptCalled = false;
      const second = await manager.ensureKey(async (defaultPath) => {
        promptCalled = true;
        return defaultPath;
      });

      expect(promptCalled).toBe(false);
      expect(second.isNew).toBe(false);
      expect(second.key).toBe(first.key);
      expect(second.path).toBe(keyPath);
    });

    it("uses the injected default path without prompting when no prompt function is given", async () => {
      const defaultPath = join(testDir, "default-key-path");
      const manager = new ApiKeyManager(defaultPath);

      const result = await manager.ensureKey();

      expect(result.isNew).toBe(true);
      expect(result.path).toBe(defaultPath);
      expect(existsSync(defaultPath)).toBe(true);
    });

    it("regenerates a key if the recorded path no longer exists on disk", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "missing-key");

      const first = await manager.ensureKey(async () => keyPath);
      await rm(keyPath, { force: true });

      let promptCalled = false;
      const second = await manager.ensureKey(async (defaultPath) => {
        promptCalled = true;
        return defaultPath;
      });

      expect(promptCalled).toBe(true);
      expect(second.isNew).toBe(true);
      expect(second.key).not.toBe(first.key);
    });
  });

  describe("rotate()", () => {
    it("overwrites the key at the already-configured path without prompting", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "rotate-key");

      const original = await manager.ensureKey(async () => keyPath);

      let promptCalled = false;
      const rotated = await manager.rotate(async (defaultPath) => {
        promptCalled = true;
        return defaultPath;
      });

      expect(promptCalled).toBe(false);
      expect(rotated.path).toBe(keyPath);
      expect(rotated.key).not.toBe(original.key);
      expect(await manager.load(keyPath)).toBe(rotated.key);
    });

    it("generates a new key even when the existing key file is still present", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "still-present-key");

      const first = await manager.ensureKey(async () => keyPath);
      expect(existsSync(keyPath)).toBe(true);

      const second = await manager.rotate();

      expect(second.key).not.toBe(first.key);
      expect(second.path).toBe(keyPath);
    });

    it("uses the injected default path and prompts when no key is configured yet", async () => {
      const manager = new ApiKeyManager();
      const keyPath = join(testDir, "prompted-rotate-key");

      const result = await manager.rotate(async (defaultPath) => {
        expect(defaultPath.length).toBeGreaterThan(0);
        return keyPath;
      });

      expect(result.path).toBe(keyPath);
      expect(existsSync(keyPath)).toBe(true);

      const { loadDRConfig } = await import("../../../src/config");
      const config = await loadDRConfig();
      expect(config.mcp?.api_key_path).toBe(keyPath);
    });
  });
});
