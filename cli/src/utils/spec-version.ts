/**
 * Spec Version Utilities
 *
 * Manages spec version information for the CLI
 */

import { readJSON, fileExists } from './file-io.js';
import { join } from 'path';

/**
 * Bundled spec version
 * This should match the version in ../../../spec/VERSION
 * Updated during build process
 */
const BUNDLED_SPEC_VERSION = '0.7.0';

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
  const manifestPath = join(drPath, 'manifest.json');

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
  const manifestPath = join(modelPath, 'manifest.yaml');

  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    // Use YAML parser
    const yaml = await import('yaml');
    const fs = await import('fs/promises');
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = yaml.parse(content) as { spec_version?: string; specVersion?: string };
    // Check snake_case first (Python CLI format), then camelCase (legacy)
    return manifest.spec_version || manifest.specVersion || null;
  } catch {
    return null;
  }
}
