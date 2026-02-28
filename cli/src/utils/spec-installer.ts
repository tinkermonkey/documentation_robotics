/**
 * Spec Reference Installer
 *
 * Manages the .dr/ folder (spec reference), which only needs to store
 * the installed spec version and a changesets directory.
 *
 * Schema data is read directly from the CLI's bundled compiled format
 * (cli/src/schemas/bundled/) and never expanded into .dr/.
 */

import { ensureDir, writeFile } from "./file-io.js";
import { join } from "path";
import { getCliBundledSpecVersion } from "./spec-version.js";
import fs from "fs/promises";

/**
 * Install or update the .dr/ spec reference folder.
 *
 * Creates:
 * - .dr/manifest.json  — installed spec version record
 * - .dr/changesets/    — directory for model changesets
 * - .dr/README.md      — informational readme
 *
 * Schema data is NOT copied here; the CLI reads directly from its
 * bundled compiled schemas (cli/src/schemas/bundled/).
 *
 * @param projectRoot - Path to project root
 * @param _force - Reserved; kept for API compatibility
 */
export async function installSpecReference(
  projectRoot: string,
  _force: boolean = false
): Promise<void> {
  const drPath = join(projectRoot, ".dr");
  const specVersion = getCliBundledSpecVersion();

  await ensureDir(drPath);
  await ensureDir(join(drPath, "changesets"));

  // Write manifest.json
  const manifest = {
    specVersion: specVersion,
    installedAt: new Date().toISOString(),
  };
  await writeFile(join(drPath, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Write README.md
  const readme = `# Documentation Robotics - Spec Reference

This directory is managed by the Documentation Robotics CLI.

**Spec Version:** ${specVersion}
**Installed:** ${new Date().toISOString()}

## Structure

- \`manifest.json\`  — Spec version information
- \`changesets/\`    — Model changesets (active and saved)

## Important

This directory should be git-ignored. It will be recreated automatically
by the CLI when needed (e.g. after \`dr init\` or \`dr upgrade\`).

Schema data is NOT stored here. The CLI reads schema definitions directly
from its bundled compiled distribution (cli/src/schemas/bundled/).

Do not manually edit files in this directory.
`;
  await writeFile(join(drPath, "README.md"), readme);
}

/**
 * Check if spec reference needs to be installed or updated.
 *
 * Returns true if .dr/manifest.json is missing, unreadable, or records a
 * specVersion that doesn't match the CLI's bundled spec version.
 */
export async function needsSpecReferenceInstall(projectRoot: string): Promise<boolean> {
  const manifestPath = join(projectRoot, ".dr", "manifest.json");

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as { specVersion?: string };
    return manifest.specVersion !== getCliBundledSpecVersion();
  } catch {
    return true; // manifest missing or unreadable
  }
}
