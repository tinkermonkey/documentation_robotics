/**
 * Spec Version Utilities
 *
 * Manages spec version information for the CLI
 */

import { readJSON, fileExists } from "./file-io.js";
import { join } from "path";
import { fileURLToPath } from "url";
import path from "path";
import { readFileSync, existsSync } from "fs";

/**
 * CLI version
 * This should match the version in ../package.json
 * Updated during release process
 */
const CLI_VERSION = "0.1.3";

/**
 * Resolve the bundled spec directory
 * Priority:
 * 1. CLI installation: schemas/bundled/ next to compiled source
 * 2. Development monorepo: spec/dist/
 *
 * @throws {Error} If manifest.json cannot be found in any candidate location
 */
function getBundledSpecDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  // Try 1: CLI installation (dist/utils → dist/schemas/bundled)
  const installPath = path.join(currentDir, "..", "schemas", "bundled");
  if (existsSync(path.join(installPath, "manifest.json"))) {
    return installPath;
  }

  // Try 2: Development path — spec/dist/ in monorepo
  const devDistPath = path.join(currentDir, "../../../spec/dist");
  if (existsSync(path.join(devDistPath, "manifest.json"))) {
    return devDistPath;
  }

  // Manifest not found in any expected location
  throw new Error(
    `Could not locate spec manifest.json. Tried: ${installPath}, ${devDistPath}`
  );
}

/**
 * Read the bundled spec version from manifest.json at module load time.
 * This is cached and reused for all subsequent calls.
 */
function readBundledSpecVersionSync(): string {
  try {
    const bundledDir = getBundledSpecDir();
    const manifestPath = path.join(bundledDir, "manifest.json");
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as { specVersion?: string };

    if (!manifest.specVersion) {
      throw new Error("manifest.json is missing specVersion field");
    }

    return manifest.specVersion;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read bundled spec version from manifest.json: ${message}`);
  }
}

/**
 * Bundled spec version (read from manifest.json at module load time)
 * This is cached and reused for all subsequent calls.
 */
const BUNDLED_SPEC_VERSION = readBundledSpecVersionSync();

/**
 * Get the CLI version
 *
 * @returns CLI version string
 */
export function getCliVersion(): string {
  return CLI_VERSION;
}

/**
 * Get the CLI's bundled spec version
 *
 * This is the version of the DR specification that is bundled with this CLI.
 * It represents what version of the spec this CLI supports.
 *
 * The version is read from bundled manifest.json at module load time.
 *
 * @returns Bundled spec version string
 */
export function getCliBundledSpecVersion(): string {
  return BUNDLED_SPEC_VERSION;
}

/**
 * Read spec version from .dr/manifest.json (installed spec reference)
 *
 * @param drPath - Path to .dr/ directory
 * @returns Spec version from .dr/manifest.json, or null if not found
 * @throws {Error} If manifest exists but cannot be read or is corrupted
 */
export async function getInstalledSpecVersion(drPath: string): Promise<string | null> {
  const manifestPath = join(drPath, "manifest.json");

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    const manifest = await readJSON<{ specVersion?: string }>(manifestPath);
    return manifest.specVersion || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read .dr/manifest.json at ${manifestPath}: ${message}. ` +
      `Ensure the file is valid JSON. You may need to reinstall the spec reference.`
    );
  }
}

/**
 * Read spec version from documentation_robotics/model/manifest.yaml
 *
 * @param modelPath - Path to model directory
 * @returns Spec version from model manifest, or null if not found
 * @throws {Error} If manifest exists but cannot be read or is corrupted
 */
export async function getModelSpecVersion(modelPath: string): Promise<string | null> {
  const manifestPath = join(modelPath, "manifest.yaml");

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    // Use YAML parser
    const yaml = await import("yaml");
    const fs = await import("fs/promises");
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = yaml.parse(content) as { spec_version?: string; specVersion?: string };
    // Check snake_case first (Python CLI format), then camelCase (legacy)
    return manifest.spec_version || manifest.specVersion || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read manifest.yaml at ${manifestPath}: ${message}. ` +
      `Ensure the file is valid YAML with spec_version or specVersion field.`
    );
  }
}
