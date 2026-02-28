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

interface CompiledManifest {
  specVersion: string;
  builtAt: string;
  layers: Array<{ id: string; number: number; name: string; nodeTypeCount: number; relationshipCount: number }>;
}

interface CompiledBase {
  specVersion: string;
  schemas: Record<string, unknown>;
  predicates: unknown;
}

interface RelationshipFlatData {
  id: string;
  source_spec_node_id: string;
  source_layer: string;
  destination_spec_node_id: string;
  destination_layer: string;
  predicate: string;
  cardinality: string;
  strength: string;
  required?: boolean;
}

interface CompiledLayer {
  layer: Record<string, unknown>;
  nodeSchemas: Record<string, unknown>;
  relationshipSchemas: Record<string, RelationshipFlatData>;
}

/**
 * Expand compiled spec dist files into individual schema files under destDir
 *
 * Reads the 14 compiled JSON files (manifest + base + 12 layer files) and
 * writes individual schema files in the traditional directory structure that
 * spec-loader.ts and other consumers expect.
 */
async function expandCompiledSpec(bundledDir: string, destDir: string): Promise<void> {
  const compiledManifest = JSON.parse(
    await fs.readFile(join(bundledDir, "manifest.json"), "utf-8")
  ) as CompiledManifest;

  const baseData = JSON.parse(
    await fs.readFile(join(bundledDir, "base.json"), "utf-8")
  ) as CompiledBase;

  // Write base schema files
  const baseDestDir = join(destDir, "schemas", "base");
  await ensureDir(baseDestDir);

  for (const [key, schema] of Object.entries(baseData.schemas)) {
    await writeFile(
      join(baseDestDir, `${key}.schema.json`),
      JSON.stringify(schema, null, 2)
    );
  }

  // Write predicates.json
  await writeFile(
    join(baseDestDir, "predicates.json"),
    JSON.stringify({ predicates: baseData.predicates }, null, 2)
  );

  // Expand each layer
  for (const { id: layerId, number: layerNum } of compiledManifest.layers) {
    const layerData = JSON.parse(
      await fs.readFile(join(bundledDir, `${layerId}.json`), "utf-8")
    ) as CompiledLayer;

    // Write layer instance file
    const layerNumPadded = String(layerNum).padStart(2, "0");
    await writeFile(
      join(destDir, "layers", `${layerNumPadded}-${layerId}.layer.json`),
      JSON.stringify(layerData.layer, null, 2)
    );

    // Write node schemas
    const nodesDir = join(destDir, "schemas", "nodes", layerId);
    await ensureDir(nodesDir);
    for (const [type, schema] of Object.entries(layerData.nodeSchemas)) {
      await writeFile(
        join(nodesDir, `${type}.node.schema.json`),
        JSON.stringify(schema, null, 2)
      );
    }

    // Write relationship schemas as JSON Schema wrapper format
    // (spec-loader.ts reads schema.properties?.id?.const etc.)
    for (const relData of Object.values(layerData.relationshipSchemas)) {
      const sourceType = relData.source_spec_node_id.slice(relData.source_layer.length + 1);
      const destType = relData.destination_spec_node_id.slice(relData.destination_layer.length + 1);

      const relDir = join(destDir, "schemas", "relationships", relData.source_layer);
      await ensureDir(relDir);

      const srcTitle = sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
      const dstTitle = destType.charAt(0).toUpperCase() + destType.slice(1);

      const schemaWrapper: Record<string, unknown> = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": `${srcTitle} ${relData.predicate} ${dstTitle}`,
        "description": `Defines relationship: ${relData.source_spec_node_id} ${relData.predicate} ${relData.destination_spec_node_id}`,
        "allOf": [{ "$ref": "../../base/spec-node-relationship.schema.json" }],
        "properties": {
          "id": { "const": relData.id },
          "source_spec_node_id": { "const": relData.source_spec_node_id },
          "source_layer": { "const": relData.source_layer },
          "destination_spec_node_id": { "const": relData.destination_spec_node_id },
          "destination_layer": { "const": relData.destination_layer },
          "predicate": { "const": relData.predicate },
          "cardinality": { "const": relData.cardinality || "many-to-many" },
          "strength": { "const": relData.strength || "medium" },
        },
      };

      if (relData.required) {
        (schemaWrapper["properties"] as Record<string, unknown>)["required"] = { "const": true };
      }

      await writeFile(
        join(relDir, `${sourceType}.${relData.predicate}.${destType}.relationship.schema.json`),
        JSON.stringify(schemaWrapper, null, 2)
      );
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
 * @param force - If true, wipe spec content dirs before expanding to remove stale files
 */
export async function installSpecReference(
  projectRoot: string,
  force: boolean = false
): Promise<void> {
  const drPath = join(projectRoot, ".dr");
  const specVersion = getCliBundledSpecVersion();

  // Create .dr directory structure
  await ensureDir(drPath);
  await ensureDir(join(drPath, "spec"));

  // On forced upgrade, delete and recreate spec content directories to eliminate
  // ghost files left behind from types removed or renamed in the new spec version.
  // .dr/changesets/ and .dr/manifest.json are intentionally NOT touched.
  if (force) {
    for (const dir of [
      join(drPath, "spec", "layers"),
      join(drPath, "spec", "schemas", "nodes"),
      join(drPath, "spec", "schemas", "relationships"),
    ]) {
      await fs.rm(dir, { recursive: true, force: true });
      await ensureDir(dir);
    }
  }

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

  // Expand compiled bundled schemas into individual spec files
  // Resolve bundled schemas directory with fallback
  let schemaSourceDir: string = "";
  let schemaSourcePath: string | null = null;

  // Try paths in order, detecting compiled format by presence of manifest.json
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
    if (existsSync(join(path, "manifest.json"))) {
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

  // Expand compiled spec dist files into individual schema files
  const specDestDir = join(drPath, "spec");
  await expandCompiledSpec(schemaSourceDir, specDestDir);

  // Keep old .dr/schemas/base/ for backward compatibility (DEPRECATED)
  // These files may not exist in the compiled format; failures are non-fatal.
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
      const sourcePath = join(specDestDir, "schemas", "base", schema);
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

  if (layerFiles.length !== 12 || nodeSchemas.length < 184 || relSchemas.length < 955) {
    throw new Error(
      `Incomplete spec installation: expected 12 layers (got ${layerFiles.length}), ` +
      `184+ node schemas (got ${nodeSchemas.length}), 955+ relationship schemas (got ${relSchemas.length})`
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
 * Returns true if the .dr/manifest.json is missing, unreadable, or records a
 * specVersion that doesn't match the CLI's bundled spec version.
 *
 * @param projectRoot - Path to project root
 * @returns True if installation/update is needed
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
