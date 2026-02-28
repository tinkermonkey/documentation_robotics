/**
 * Spec Reference Installer
 *
 * Manages the .dr/ folder, which stores:
 *   - The 14 compiled spec files in .dr/spec/ for agent and user access
 *   - The installed spec version in .dr/manifest.json
 *   - Changesets in .dr/changesets/
 *
 * The spec files in .dr/spec/ are the same 14 compiled JSON files bundled
 * with the CLI (manifest.json, base.json, {layer}.json x12). They are copied
 * from the CLI's bundled schemas on every install/upgrade so agents, skills,
 * and end users can read the spec directly from the project directory.
 */

import { ensureDir, writeFile } from "./file-io.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getCliBundledSpecVersion } from "./spec-version.js";
import fs from "fs/promises";
import { existsSync } from "fs";

/**
 * Resolve the directory containing the CLI's bundled compiled spec files.
 * Mirrors the logic in SpecDataLoader.getDefaultBundledDir().
 */
function getBundledSpecDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // CLI installation: dist/utils → dist/schemas/bundled
  const installPath = join(currentDir, "..", "schemas", "bundled");
  if (existsSync(join(installPath, "manifest.json"))) {
    return installPath;
  }

  // Development monorepo: spec/dist/
  const devDistPath = join(currentDir, "../../../spec/dist");
  if (existsSync(join(devDistPath, "manifest.json"))) {
    return devDistPath;
  }

  throw new Error("Cannot find bundled spec schemas. Run 'npm run build' first.");
}

/**
 * Install or update the .dr/ spec reference folder.
 *
 * Creates:
 * - .dr/spec/            — 14 compiled spec files (manifest.json, base.json, {layer}.json x12)
 * - .dr/manifest.json    — installed spec version record
 * - .dr/changesets/      — directory for model changesets
 * - .dr/README.md        — informational readme
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

  // Copy the 14 bundled compiled spec files to .dr/spec/
  // This gives agents, skills, and end users direct file access to the spec.
  // Remove first to clear any stale files or subdirectories from old formats.
  const bundledDir = getBundledSpecDir();
  const specDestDir = join(drPath, "spec");
  await fs.rm(specDestDir, { recursive: true, force: true });
  await ensureDir(specDestDir);

  const specFiles = await fs.readdir(bundledDir);
  await Promise.all(
    specFiles
      .filter((f) => f.endsWith(".json"))
      .map((f) => fs.copyFile(join(bundledDir, f), join(specDestDir, f)))
  );

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

- \`spec/\`          — Compiled spec files (14 JSON files: manifest, base, one per layer)
- \`manifest.json\`  — Spec version information
- \`changesets/\`    — Model changesets (active and saved)

## Spec Files

The \`spec/\` directory contains the complete compiled specification:

- \`manifest.json\`  — Layer index with node type and relationship counts
- \`base.json\`      — Base schemas and predicate definitions
- \`{layer}.json\`   — One file per layer (12 total), each containing:
  - \`layer\`               — Layer metadata (id, name, description, node_types)
  - \`nodeSchemas\`         — JSON Schema definitions for all node types in the layer
  - \`relationshipSchemas\` — Flat relationship definitions for all relationships in the layer

These files are regenerated on \`dr init\` and \`dr upgrade\` to match the
current CLI version. Do not manually edit them.

This directory should be git-ignored.
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
