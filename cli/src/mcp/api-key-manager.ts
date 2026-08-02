/**
 * MCP API key lifecycle management
 *
 * The API key is a per-installation shared secret that authenticates MCP client
 * connections to `dr mcp` (see cli/src/commands/mcp.ts). It is generated once,
 * stored on disk at a user-chosen location, and its path is recorded under
 * `mcp.api_key_path` in ~/.dr-config.yaml so subsequent launches can find it
 * without re-prompting.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DRConfig, DRConfigParseError, loadDRConfig, saveDRConfig } from "../config.js";

/** Owner read/write only — the key file must not be group/world readable. */
const KEY_FILE_MODE = 0o600;

/**
 * Default location for a newly generated API key. Resolved lazily (rather than
 * cached at module load) so it always reflects the current home directory —
 * relevant for tests that override HOME.
 */
export function getDefaultApiKeyPath(): string {
  return join(homedir(), ".dr-mcp-key");
}

export interface EnsureKeyResult {
  key: string;
  path: string;
  /** True when a new key was generated on this call (vs. loaded from an existing path). */
  isNew: boolean;
}

export interface RotateKeyResult {
  key: string;
  path: string;
}

/** Prompts the user for a storage path, given the default path to offer. */
export type ApiKeyStoragePrompt = (defaultPath: string) => Promise<string>;

export class ApiKeyManager {
  /**
   * @param defaultKeyPath Path offered as the default storage location when no
   *   key is yet configured. Defaults to `getDefaultApiKeyPath()`; overridable
   *   for tests so they never touch the real home directory.
   */
  constructor(private readonly defaultKeyPath: string = getDefaultApiKeyPath()) {}

  /** Generate a new random API key. */
  generate(): string {
    return `dr-mcp-${randomBytes(32).toString("base64url")}`;
  }

  /** Read a previously stored key from disk. */
  async load(path: string): Promise<string> {
    const content = await readFile(path, "utf-8");
    const key = content.trim();

    if (!key) {
      throw new Error(
        `API key file at ${path} is empty or corrupt. ` +
          "Delete it and re-run to generate a new key, or restore a valid key file."
      );
    }

    return key;
  }

  /** Write a key to disk with owner-only permissions. */
  async store(path: string, key: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${key}\n`, { mode: KEY_FILE_MODE });
    // writeFile's mode is only applied when creating a new file; force it
    // in case the file already existed with different permissions.
    await chmod(path, KEY_FILE_MODE);
  }

  /** Constant-time comparison of a client-provided key against the expected key. */
  validate(provided: string | undefined | null, expected: string): boolean {
    if (!provided) return false;

    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(providedBuf, expectedBuf);
  }

  /**
   * Load the DR config, refusing to proceed if the file exists but is
   * corrupted. Without this, a corrupted config looks identical to "no key
   * configured yet", which would cause `ensureKey`/`rotate` to silently
   * generate a new key and overwrite `mcp.api_key_path` — orphaning any
   * valid key already on disk and breaking every MCP client configured with
   * the old one.
   */
  private async loadConfigOrThrow(): Promise<DRConfig> {
    try {
      return await loadDRConfig({ strict: true });
    } catch (error) {
      if (error instanceof DRConfigParseError) {
        throw new Error(
          `Cannot determine the configured MCP API key path: ${error.configPath} is corrupted. ` +
            "Fix or remove this file before continuing — proceeding could orphan an existing key " +
            "and break already-configured MCP clients.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  /**
   * Resolve the API key to use for this session: load it from the previously
   * configured path, or generate+store a new one on first use.
   *
   * @param promptForPath Called only when no key is yet configured, to ask the
   *   user where to store it. When omitted (e.g. non-interactive launches),
   *   `defaultKeyPath` is used without prompting.
   */
  async ensureKey(promptForPath?: ApiKeyStoragePrompt): Promise<EnsureKeyResult> {
    const config = await this.loadConfigOrThrow();
    const existingPath = config.mcp?.api_key_path;

    if (existingPath && existsSync(existingPath)) {
      const key = await this.load(existingPath);
      return { key, path: existingPath, isNew: false };
    }

    const chosenPath = promptForPath
      ? await promptForPath(this.defaultKeyPath)
      : this.defaultKeyPath;

    const key = this.generate();
    await this.store(chosenPath, key);
    await saveDRConfig({
      ...config,
      mcp: { ...config.mcp, api_key_path: chosenPath },
    });

    return { key, path: chosenPath, isNew: true };
  }

  /**
   * Force-generate a new API key, overwriting whatever is at the configured
   * (or default) storage path, regardless of whether a key already exists
   * there. Unlike `ensureKey`, this always writes a fresh key.
   *
   * @param promptForPath Called only when no storage path is yet configured,
   *   to ask the user where to store it. When omitted, `defaultKeyPath` is
   *   used without prompting.
   */
  async rotate(promptForPath?: ApiKeyStoragePrompt): Promise<RotateKeyResult> {
    const config = await this.loadConfigOrThrow();
    const path =
      config.mcp?.api_key_path ??
      (promptForPath ? await promptForPath(this.defaultKeyPath) : this.defaultKeyPath);

    const key = this.generate();
    await this.store(path, key);
    await saveDRConfig({
      ...config,
      mcp: { ...config.mcp, api_key_path: path },
    });

    return { key, path };
  }
}
