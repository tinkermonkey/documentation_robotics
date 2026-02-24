/**
 * Spec Reference Installer
 *
 * Manages the .dr/ folder which contains the spec reference (schemas, etc.)
 * This is an ephemeral folder that should be git-ignored
 */

import { ensureDir, writeFile } from "./file-io.js";
import { join, dirname } from "path";
import { getCliBundledSpecVersion } from "./spec-version.js";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { logDebug } from "./globals.js";
import { glob } from "glob";

/**
 * Recursively copy directory contents
 */
async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Install or update the .dr/ spec reference folder
 *
 * Creates:
 * - .dr/manifest.json with spec version
 * - .dr/schemas/ with all bundled schemas
 * - .dr/changesets/ directory
 * - .dr/README.md
 *
 * @param projectRoot - Path to project root
 * @param _force - If true, overwrite existing files (reserved for future use)
 */
export async function installSpecReference(
  projectRoot: string,
  _force: boolean = false
): Promise<void> {
  const drPath = join(projectRoot, ".dr");
  const specVersion = getCliBundledSpecVersion();

  // Create .dr directory structure
  await ensureDir(drPath);
  await ensureDir(join(drPath, "spec"));
  await ensureDir(join(drPath, "spec", "layers"));
  await ensureDir(join(drPath, "spec", "schemas"));
  await ensureDir(join(drPath, "changesets"));

  // Write manifest.json
  const manifestPath = join(drPath, "manifest.json");
  const manifest = {
    specVersion: specVersion,
    installedAt: new Date().toISOString(),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Copy bundled schemas
  // Resolve schema source directory with fallback
  let schemaSourceDir: string = "";
  let schemaSourcePath: string | null = null;

  // Try paths in order, recording which one works
  const pathsToTry = [
    {
      path: join(dirname(fileURLToPath(import.meta.url)), "../schemas/bundled"),
      description: "bundled from CLI installation",
    },
    {
      path: join(dirname(fileURLToPath(import.meta.url)), "../../src/schemas/bundled"),
      description: "source directory relative to compiled code",
    },
    {
      path: join(projectRoot, "src/schemas/bundled"),
      description: "source directory (src) relative to project root",
    },
    {
      path: join(projectRoot, "dist/schemas/bundled"),
      description: "built directory (dist) relative to project root",
    },
  ];

  for (const { path, description } of pathsToTry) {
    if (existsSync(join(path, "base", "spec-node.schema.json"))) {
      schemaSourceDir = path;
      schemaSourcePath = description;
      logDebug(`Using bundled schemas from: ${description} (${path})`);
      break;
    }
  }

  if (!schemaSourcePath) {
    throw new Error(
      `Could not find bundled schemas at any of the expected locations:\n` +
        pathsToTry.map((p) => `  - ${p.path} (${p.description})`).join("\n")
    );
  }

  // Copy complete spec from bundled schemas
  // Layer instances (12 files)
  await copyDirectoryRecursive(
    join(schemaSourceDir, "layers"),
    join(drPath, "spec", "layers")
  );

  // All schemas (base + nodes + relationships)
  await copyDirectoryRecursive(
    join(schemaSourceDir, "base"),
    join(drPath, "spec", "schemas", "base")
  );

  await copyDirectoryRecursive(
    join(schemaSourceDir, "nodes"),
    join(drPath, "spec", "schemas", "nodes")
  );

  await copyDirectoryRecursive(
    join(schemaSourceDir, "relationships"),
    join(drPath, "spec", "schemas", "relationships")
  );

  // Keep old .dr/schemas/base/ for backward compatibility (DEPRECATED)
  await ensureDir(join(drPath, "schemas", "base"));
  const baseSchemas = [
    "spec-node.schema.json",
    "spec-layer.schema.json",
    "source-references.schema.json",
    "attribute-spec.schema.json",
    "predicates.json",
  ];

  for (const schema of baseSchemas) {
    try {
      const sourcePath = join(schemaSourceDir, "base", schema);
      const targetPath = join(drPath, "schemas", "base", schema);
      await fs.copyFile(sourcePath, targetPath);
    } catch (error: any) {
      logDebug(`Note: Could not copy base schema ${schema}: ${error.message}`);
    }
  }

  // Verify installation completeness
  const layerFiles = await glob(join(drPath, "spec", "layers", "*.layer.json"));
  const nodeSchemas = await glob(join(drPath, "spec", "schemas", "nodes", "**", "*.node.schema.json"));
  const relSchemas = await glob(join(drPath, "spec", "schemas", "relationships", "**", "*.relationship.schema.json"));

  logDebug(`Installed spec: ${layerFiles.length} layers, ${nodeSchemas.length} node types, ${relSchemas.length} relationship types`);

  if (layerFiles.length !== 12 || nodeSchemas.length < 335 || relSchemas.length < 250) {
    throw new Error(
      `Incomplete spec installation: expected 12 layers (got ${layerFiles.length}), ` +
      `335+ node schemas (got ${nodeSchemas.length}), 250+ relationship schemas (got ${relSchemas.length})`
    );
  }

  // Create README.md
  const readmePath = join(drPath, "README.md");
  const readme = `# Documentation Robotics - Spec Reference

This directory contains the specification reference for Documentation Robotics.

**Spec Version:** ${specVersion}
**Installed:** ${new Date().toISOString()}
**Schema Source:** ${schemaSourcePath}

## Structure

- \`manifest.json\` - Spec version information
- \`spec/\` - Complete specification reference
  - \`layers/\` - 12 layer instance definitions
  - \`schemas/base/\` - 8 base schemas
  - \`schemas/nodes/\` - ${nodeSchemas.length} node type schemas (organized by layer)
  - \`schemas/relationships/\` - ${relSchemas.length} relationship type schemas
- \`schemas/\` - (DEPRECATED) Legacy base schemas for backward compatibility
- \`changesets/\` - Model changesets (active and saved)

## Important

This directory is ephemeral and should be git-ignored. It will be recreated
automatically by the CLI when needed.

Do not manually edit files in this directory.
`;
  await writeFile(readmePath, readme);
}

/**
 * Check if spec reference needs to be installed or updated
 *
 * @param projectRoot - Path to project root
 * @returns True if installation/update is needed
 */
export async function needsSpecReferenceInstall(projectRoot: string): Promise<boolean> {
  const manifestPath = join(projectRoot, ".dr", "manifest.json");

  try {
    const fs = await import("fs/promises");
    await fs.access(manifestPath);
    return false;
  } catch {
    return true;
  }
}
