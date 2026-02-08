#!/usr/bin/env bun

/**
 * Documentation Generation Script
 *
 * Generates markdown documentation for all 12 layers from SpecLayer and SpecNode instances.
 * This implements the schema-driven documentation model where JSON specs are the source of truth.
 *
 * Usage:
 *   bun run scripts/generate-layer-docs.ts [--output <dir>] [--layer <layer-id>]
 *
 * Examples:
 *   bun run scripts/generate-layer-docs.ts                    # Generate all layers
 *   bun run scripts/generate-layer-docs.ts --output spec/layers/
 *   bun run scripts/generate-layer-docs.ts --layer motivation
 */

import * as fs from "fs";
import * as path from "path";

interface SpecLayer {
  id: string;
  number: number;
  name: string;
  description: string;
  inspired_by?: {
    standard: string;
    version: string;
    url: string;
  };
  node_types: string[];
}

interface SpecNodeAttribute {
  type: string;
  description: string;
  format?: string;
  enum?: string[];
}

interface SpecNode {
  id: string;
  layer_id: string;
  name: string;
  description: string;
  attributes: Record<string, SpecNodeAttribute>;
  required_attributes: string[];
}

interface LayerDocumentation {
  layerId: string;
  number: number;
  name: string;
  description: string;
  inspiredBy?: { standard: string; version: string; url: string };
  nodeTypes: SpecNode[];
}

/**
 * Load all SpecLayer instances from spec/layers/
 */
async function loadLayers(baseDir: string): Promise<SpecLayer[]> {
  const layersDir = path.join(baseDir, "spec", "layers");

  let files: string[];
  try {
    files = fs
      .readdirSync(layersDir)
      .filter((f) => f.endsWith(".layer.json"));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`spec/layers directory not found at ${layersDir}`);
    }
    throw new Error(`Failed to read spec/layers directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  const layers: SpecLayer[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(layersDir, file), "utf-8");
      try {
        const layer = JSON.parse(content) as SpecLayer;
        layers.push(layer);
      } catch (parseError) {
        throw new Error(
          `Failed to parse ${file}: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
      }
    } catch (readError) {
      throw new Error(
        `Failed to read spec/layers/${file}: ${readError instanceof Error ? readError.message : String(readError)}`
      );
    }
  }

  return layers.sort((a, b) => a.number - b.number);
}

/**
 * Load all SpecNode instances from spec/nodes/
 */
async function loadNodes(baseDir: string): Promise<SpecNode[]> {
  const nodesDir = path.join(baseDir, "spec", "nodes");
  const nodes: SpecNode[] = [];

  let layerDirs: string[];
  try {
    layerDirs = fs.readdirSync(nodesDir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`spec/nodes directory not found at ${nodesDir}`);
    }
    throw new Error(`Failed to read spec/nodes directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const layerDir of layerDirs) {
    const layerPath = path.join(nodesDir, layerDir);
    let isDir = false;

    try {
      isDir = fs.statSync(layerPath).isDirectory();
    } catch (statError) {
      throw new Error(
        `Failed to stat ${layerPath}: ${statError instanceof Error ? statError.message : String(statError)}`
      );
    }

    if (!isDir) continue;

    let files: string[];
    try {
      files = fs.readdirSync(layerPath);
    } catch (readError) {
      throw new Error(
        `Failed to read spec/nodes/${layerDir}: ${readError instanceof Error ? readError.message : String(readError)}`
      );
    }

    for (const file of files) {
      if (!file.endsWith(".node.json")) continue;

      try {
        const content = fs.readFileSync(path.join(layerPath, file), "utf-8");
        try {
          const node = JSON.parse(content) as SpecNode;
          nodes.push(node);
        } catch (parseError) {
          throw new Error(
            `Failed to parse spec/nodes/${layerDir}/${file}: ${parseError instanceof Error ? parseError.message : String(parseError)}`
          );
        }
      } catch (readError) {
        throw new Error(
          `Failed to read spec/nodes/${layerDir}/${file}: ${readError instanceof Error ? readError.message : String(readError)}`
        );
      }
    }
  }

  return nodes;
}

/**
 * Generate markdown for a layer's header section
 */
function generateHeader(layer: SpecLayer): string {
  const lines: string[] = [`# Layer ${layer.number}: ${layer.name}`, ""];

  if (layer.inspired_by) {
    lines.push(
      `**Standard**: [${layer.inspired_by.standard}](${layer.inspired_by.url})`
    );
  }

  lines.push("");
  lines.push("---");

  return lines.join("\n");
}

/**
 * Generate markdown for the Overview section
 */
function generateOverview(layer: SpecLayer, nodeTypes: SpecNode[]): string {
  const lines: string[] = ["## Overview", ""];

  // Only include description if it's not just repeating the layer name
  const layerNamePattern = `Layer ${layer.number}:`;
  if (!layer.description.includes(layerNamePattern)) {
    lines.push(layer.description);
    lines.push("");
  }

  lines.push(
    `This layer defines **${nodeTypes.length}** node types that represent various aspects of the architecture.`
  );

  return lines.join("\n");
}

/**
 * Format attribute type for display
 */
function formatAttributeType(attr: SpecNodeAttribute): string {
  let type = attr.type;
  if (attr.format) {
    type += ` (${attr.format})`;
  }
  if (attr.enum && attr.enum.length > 0) {
    type += ` - one of: ${attr.enum.join(", ")}`;
  }
  return type;
}

/**
 * Generate markdown for Node Types section
 */
function generateNodeTypesSection(nodeTypes: SpecNode[]): string {
  if (nodeTypes.length === 0) {
    return "## Node Types\n\nNo node types defined for this layer.";
  }

  const lines: string[] = ["## Node Types", ""];

  for (const node of nodeTypes) {
    lines.push(`### ${node.name}`);
    lines.push("");
    lines.push(`**ID**: \`${node.id}\``);
    lines.push("");
    lines.push(node.description);
    lines.push("");

    // Attributes section
    if (Object.keys(node.attributes).length > 0) {
      lines.push("**Attributes**:");
      lines.push("");

      for (const [attrName, attrSpec] of Object.entries(node.attributes)) {
        const typeStr = formatAttributeType(attrSpec);
        const required = node.required_attributes.includes(attrName)
          ? " (required)"
          : "";
        lines.push(`- \`${attrName}\`: ${typeStr}${required}`);
        if (attrSpec.description) {
          lines.push(`  - ${attrSpec.description}`);
        }
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate markdown for References section (if applicable)
 */
function generateReferencesSection(layer: SpecLayer): string {
  if (!layer.inspired_by) {
    return "";
  }

  return (
    `## References\n\n` +
    `- [${layer.inspired_by.standard}](${layer.inspired_by.url})\n`
  );
}

/**
 * Generate complete markdown documentation for a layer
 */
function generateLayerDocumentation(
  layer: SpecLayer,
  nodeTypes: SpecNode[]
): string {
  const sections: string[] = [
    generateHeader(layer),
    generateOverview(layer, nodeTypes),
    generateNodeTypesSection(nodeTypes),
  ];

  const references = generateReferencesSection(layer);
  if (references) {
    sections.push(references);
  }

  return sections.join("\n\n");
}

/**
 * Generate index document with cross-references
 */
function generateIndexDocument(
  layers: SpecLayer[],
  allNodes: SpecNode[]
): string {
  const lines: string[] = [
    "# Documentation Robotics Specification Index",
    "",
    "This index documents the 12-layer architecture model. Each layer contains specific node types that define elements within that architectural concern.",
    "",
    "## Layers",
    "",
  ];

  // Layer list
  for (const layer of layers) {
    const fileName = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer.md`;
    lines.push(`- [Layer ${layer.number}: ${layer.name}](layers/${fileName})`);
  }

  lines.push("");
  lines.push("## Node Types by Layer");
  lines.push("");

  // Node types grouped by layer
  for (const layer of layers) {
    const layerNodes = allNodes.filter((n) => n.layer_id === layer.id);
    if (layerNodes.length === 0) continue;

    lines.push(`### Layer ${layer.number}: ${layer.name}`);
    lines.push("");

    for (const node of layerNodes.sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const fileName = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer.md`;
      const anchor = node.name.toLowerCase().replace(/\s+/g, "-");
      lines.push(
        `- [\`${node.id}\`](layers/${fileName}#${anchor}) - ${node.description}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  let outputDir = "./spec/layers";
  let targetLayer: string | null = null;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (args[i] === "--layer" && i + 1 < args.length) {
      targetLayer = args[++i];
    }
  }

  const baseDir = process.cwd();

  console.log("📚 Generating documentation from schema definitions...");

  // Load all specifications
  const layers = await loadLayers(baseDir);
  const allNodes = await loadNodes(baseDir);

  // Ensure output directory exists
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (error) {
    throw new Error(
      `Failed to create output directory ${outputDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Generate layer documentation
  if (targetLayer) {
    // Generate specific layer
    const layer = layers.find((l) => l.id === targetLayer);
    if (!layer) {
      console.error(`❌ Layer "${targetLayer}" not found`);
      process.exit(1);
    }

    const nodeTypes = allNodes.filter((n) => n.layer_id === layer.id);
    const doc = generateLayerDocumentation(layer, nodeTypes);
    const fileName = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer.md`;
    const filePath = path.join(outputDir, fileName);

    try {
      fs.writeFileSync(filePath, doc);
      console.log(`✅ Generated ${filePath}`);
    } catch (writeError) {
      throw new Error(
        `Failed to write documentation to ${filePath}: ${writeError instanceof Error ? writeError.message : String(writeError)}`
      );
    }
  } else {
    // Generate all layers
    for (const layer of layers) {
      const nodeTypes = allNodes.filter((n) => n.layer_id === layer.id);
      const doc = generateLayerDocumentation(layer, nodeTypes);
      const fileName = `${String(layer.number).padStart(2, "0")}-${layer.id}-layer.md`;
      const filePath = path.join(outputDir, fileName);

      try {
        fs.writeFileSync(filePath, doc);
        console.log(`✅ Generated ${fileName}`);
      } catch (writeError) {
        throw new Error(
          `Failed to write documentation to ${filePath}: ${writeError instanceof Error ? writeError.message : String(writeError)}`
        );
      }
    }
  }

  // Generate index document
  const indexDoc = generateIndexDocument(layers, allNodes);
  const indexPath = path.join(outputDir, "INDEX.md");
  try {
    fs.writeFileSync(indexPath, indexDoc);
    console.log(`✅ Generated INDEX.md`);
  } catch (writeError) {
    throw new Error(
      `Failed to write INDEX.md to ${indexPath}: ${writeError instanceof Error ? writeError.message : String(writeError)}`
    );
  }

  console.log(
    "\n✨ Documentation generation complete! Files written to: " + outputDir
  );
}

main().catch((error) => {
  console.error("❌ Error generating documentation:", error);
  process.exit(1);
});
