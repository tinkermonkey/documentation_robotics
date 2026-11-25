/**
 * Spec Version Utilities
 *
 * Manages spec version information for the CLI
 */

import { readJSON, fileExists } from "./file-io.js";
import { join } from "path";
import { createRequire } from "node:module";

// Declare build-time constant (substituted by esbuild)
declare const CLI_VERSION: string;

/**
 * Bundled spec version
 * This should match the version in ../../../spec/VERSION
 * Updated during build process
 */
const BUNDLED_SPEC_VERSION = "0.15.0";

// Dev-mode fallback (e.g. `tsx src/cli.ts`) that reads package.json directly, so it can't drift.
function resolveDevVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch (error) {
    console.error(
      `Failed to resolve dev-mode CLI version from package.json, falling back to "0.0.0": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "0.0.0";
  }
}

/**
 * Get the CLI version
 *
 * @returns CLI version string
 */
export function getCliVersion(): string {
  return typeof CLI_VERSION !== "undefined" ? CLI_VERSION : resolveDevVersion();
}

/**
 * Get the CLI's bundled spec version
 *
 * This is the version of the DR specification that is bundled with this CLI.
 * It represents what version of the spec this CLI supports.
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
 */
export async function getInstalledSpecVersion(drPath: string): Promise<string | null> {
  const manifestPath = join(drPath, "manifest.json");

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    const manifest = await readJSON<{ specVersion?: string }>(manifestPath);
    return manifest.specVersion || null;
  } catch {
    return null;
  }
}

/**
 * Read spec version from documentation_robotics/model/manifest.yaml
 *
 * @param modelPath - Path to model directory
 * @returns Spec version from model manifest, or null if not found
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
  } catch {
    return null;
  }
}

/**
 * Where a model's spec version stands against the spec this CLI carries: "behind" (an upgrade
 * migrates it), "ahead" (it needs a newer CLI), or null when they match or the model has none.
 */
/** -1, 0 or 1, comparing dotted numeric versions part by part ("0.9.0" before "0.10.0"). */
export function compareSpecVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function modelSpecStanding(modelSpecVersion: string | null | undefined): "behind" | "ahead" | null {
  if (!modelSpecVersion || modelSpecVersion === BUNDLED_SPEC_VERSION) {
    return null;
  }
  const model = modelSpecVersion.split(".").map(Number);
  const bundled = BUNDLED_SPEC_VERSION.split(".").map(Number);
  for (let i = 0; i < Math.max(model.length, bundled.length); i++) {
    const d = (model[i] || 0) - (bundled[i] || 0);
    if (d !== 0) return d < 0 ? "behind" : "ahead";
  }
  return null;
}
