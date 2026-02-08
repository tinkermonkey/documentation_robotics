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
import { fileURLToPath } from "url";

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
  await ensureDir(join(drPath, "schemas"));
  await ensureDir(join(drPath, "schemas", "common"));
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
      path: join(projectRoot, "src/schemas/bundled"),
      description: "source directory (src)",
    },
    {
      path: join(projectRoot, "dist/schemas/bundled"),
      description: "built directory (dist)",
    },
  ];

  for (const { path, description } of pathsToTry) {
    try {
      await fs.access(join(path, "01-motivation-layer.schema.json"));
      schemaSourceDir = path;
      schemaSourcePath = description;
      console.debug(`Using bundled schemas from: ${description} (${path})`);
      break;
    } catch (error) {
      // Only continue on file not found (ENOENT); re-throw other errors (EACCES, etc)
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      // Continue to next path
    }
  }

  if (!schemaSourcePath) {
    throw new Error(
      `Could not find bundled schemas at any of the expected locations:\n` +
        pathsToTry.map((p) => `  - ${p.path} (${p.description})`).join("\n")
    );
  }

  // Copy layer schemas
  const layerSchemas = [
    "01-motivation-layer.schema.json",
    "02-business-layer.schema.json",
    "03-security-layer.schema.json",
    "04-application-layer.schema.json",
    "05-technology-layer.schema.json",
    "06-api-layer.schema.json",
    "07-data-model-layer.schema.json",
    "08-data-store-layer.schema.json",
    "09-ux-layer.schema.json",
    "10-navigation-layer.schema.json",
    "11-apm-observability-layer.schema.json",
    "12-testing-layer.schema.json",
  ];

  for (const schema of layerSchemas) {
    const sourcePath = join(schemaSourceDir, schema);
    const targetPath = join(drPath, "schemas", schema);
    await fs.copyFile(sourcePath, targetPath);
  }

  // Copy catalog and registry files
  const catalogFiles = [
    "relationship-catalog.json",
    "link-registry.json",
    "link-registry.schema.json",
    "relationship-type.schema.json",
  ];

  for (const file of catalogFiles) {
    const sourcePath = join(schemaSourceDir, file);
    const targetPath = join(drPath, "schemas", file);
    await fs.copyFile(sourcePath, targetPath);
  }

  // Copy common schemas
  const commonSchemas = [
    "layer-extensions.schema.json",
    "predicates.schema.json",
    "relationships.schema.json",
    "source-references.schema.json",
  ];

  for (const schema of commonSchemas) {
    const sourcePath = join(schemaSourceDir, "common", schema);
    const targetPath = join(drPath, "schemas", "common", schema);
    await fs.copyFile(sourcePath, targetPath);
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
- \`schemas/\` - JSON Schema definitions for all layers
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
