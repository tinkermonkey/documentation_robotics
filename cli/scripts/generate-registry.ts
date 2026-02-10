#!/usr/bin/env -S node --loader tsx

/**
 * generate-registry.ts
 *
 * Build-time code generation that derives layer metadata from spec/layers/*.layer.json
 * and generates:
 *   - cli/src/generated/layer-registry.ts (LayerRegistry and typed exports)
 *   - cli/src/generated/layer-types.ts (LayerId and related union types)
 *
 * This script is run automatically during npm run build (via prebuild script)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.join(__dirname, "..");
const BUNDLED_LAYERS_DIR = path.join(CLI_DIR, "src", "schemas", "bundled", "layers");
const BUNDLED_NODES_DIR = path.join(CLI_DIR, "src", "schemas", "bundled", "nodes");
const GENERATED_DIR = path.join(CLI_DIR, "src", "generated");

interface LayerInstance {
  id: string;
  number: number;
  name: string;
  description: string;
  node_types: string[];
  inspired_by?: {
    standard: string;
    version: string;
    url?: string;
  };
}

interface LayerMetadata {
  id: string;
  number: number;
  name: string;
  description: string;
  nodeTypes: string[];
  inspiredBy?: {
    standard: string;
    version: string;
    url?: string;
  };
}

interface NodeTypeInfo {
  specNodeId: string;
  layer: string;
  type: string;
  title: string;
  requiredAttributes: string[];
  optionalAttributes: string[];
  attributeConstraints: Record<string, unknown>;
}

/**
 * Recursively find all node schema files in a directory
 */
function findNodeSchemaFiles(dir: string): string[] {
  const files: string[] = [];

  function traverse(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.name.endsWith(".node.schema.json")) {
        files.push(fullPath);
      }
    }
  }

  traverse(dir);
  return files.sort();
}

/**
 * Load all node schema files from bundled directory and extract metadata
 */
function loadNodeSchemas(): NodeTypeInfo[] {
  if (!fs.existsSync(BUNDLED_NODES_DIR)) {
    console.error(`ERROR: Node schemas directory not found at ${BUNDLED_NODES_DIR}`);
    process.exit(1);
  }

  const schemaFiles = findNodeSchemaFiles(BUNDLED_NODES_DIR);

  if (schemaFiles.length === 0) {
    console.error(`ERROR: No .node.schema.json files found in ${BUNDLED_NODES_DIR}`);
    process.exit(1);
  }

  const nodeTypes: NodeTypeInfo[] = schemaFiles.map((schemaFile) => {
    const content = fs.readFileSync(schemaFile, "utf-8");
    const schema = JSON.parse(content);

    const specNodeId = schema.properties?.spec_node_id?.const;
    const layer = schema.properties?.layer_id?.const;
    const type = schema.properties?.type?.const;
    const title = schema.title || type;

    if (!specNodeId || !layer || !type) {
      throw new Error(
        `Invalid node schema at ${schemaFile}: missing spec_node_id, layer_id, or type`
      );
    }

    // Extract attribute information
    const attributesSchema = schema.properties?.attributes;
    const requiredAttributes = attributesSchema?.required || [];
    const allAttributes = Object.keys(attributesSchema?.properties || {});
    const optionalAttributes = allAttributes.filter(
      (a) => !requiredAttributes.includes(a)
    );

    return {
      specNodeId,
      layer,
      type,
      title,
      requiredAttributes,
      optionalAttributes,
      attributeConstraints: attributesSchema?.properties || {},
    };
  });

  return nodeTypes;
}

/**
 * Load all layer instance files from bundled directory
 */
function loadLayerInstances(): LayerMetadata[] {
  if (!fs.existsSync(BUNDLED_LAYERS_DIR)) {
    console.error(`ERROR: Layer instances directory not found at ${BUNDLED_LAYERS_DIR}`);
    console.error("Run 'npm run sync-schemas' first to copy layer instances from spec/");
    process.exit(1);
  }

  const files = fs
    .readdirSync(BUNDLED_LAYERS_DIR)
    .filter((f) => f.endsWith(".layer.json"))
    .sort();

  if (files.length === 0) {
    console.error(`ERROR: No .layer.json files found in ${BUNDLED_LAYERS_DIR}`);
    process.exit(1);
  }

  const layers: LayerMetadata[] = files.map((file) => {
    const filePath = path.join(BUNDLED_LAYERS_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const instance: LayerInstance = JSON.parse(content);

    return {
      id: instance.id,
      number: instance.number,
      name: instance.name,
      description: instance.description,
      nodeTypes: instance.node_types,
      ...(instance.inspired_by && { inspiredBy: instance.inspired_by }),
    };
  });

  // Validate we have all 12 layers
  if (layers.length !== 12) {
    console.error(`ERROR: Expected 12 layers, but found ${layers.length}`);
    console.error(`Files found: ${files.join(", ")}`);
    process.exit(1);
  }

  // Validate layers are numbered 1-12
  const numbers = layers.map((l) => l.number).sort((a, b) => a - b);
  if (numbers.join(",") !== "1,2,3,4,5,6,7,8,9,10,11,12") {
    console.error(`ERROR: Invalid layer numbers: ${numbers.join(", ")}`);
    process.exit(1);
  }

  return layers.sort((a, b) => a.number - b.number);
}

/**
 * Generate layer-registry.ts with LayerRegistry interface and exports
 */
function generateLayerRegistry(layers: LayerMetadata[]): string {
  const layerHierarchy = layers.map((l) => l.number).join(", ");

  // Helper to convert layer ID to valid TypeScript identifier
  const toIdentifier = (id: string): string => id.replace(/-/g, "_").toUpperCase();

  // Generate constant declarations FIRST
  const constants = layers
    .map(
      (l) => `
const LAYER_METADATA_${toIdentifier(l.id)}: LayerMetadata = {
  id: "${l.id}",
  number: ${l.number},
  name: "${l.name}",
  description: "${l.description}",
  nodeTypes: [${l.nodeTypes.map((t) => `"${t}"`).join(", ")}],${
        l.inspiredBy
          ? `
  inspiredBy: {
    standard: "${l.inspiredBy.standard}",
    version: "${l.inspiredBy.version}",${l.inspiredBy.url ? `
    url: "${l.inspiredBy.url}",` : ""}
  },`
          : ""
      }
};`
    )
    .join("\n");

  // Generate Map constructor entries
  const mapEntries = layers
    .map((l) => `    ["${l.id}", LAYER_METADATA_${toIdentifier(l.id)}]`)
    .join(",\n");

  // Generate Map entries indexed by number for O(1) lookup
  const mapEntriesByNumber = layers
    .map((l) => `    [${l.number}, LAYER_METADATA_${toIdentifier(l.id)}]`)
    .join(",\n");

  return `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-registry.ts
 * during the build process. Changes will be overwritten.
 *
 * Source: spec/layers/*.layer.json
 */

/**
 * Layer metadata derived from specification layer instances
 */
export interface LayerMetadata {
  id: string;           // "motivation", "data-store", etc. (canonical hyphenated form)
  number: number;       // 1-12
  name: string;         // "Motivation Layer", "Data Store Layer"
  description: string;  // Layer description
  nodeTypes: string[];  // ["motivation.goal", "motivation.requirement", ...]
  inspiredBy?: {
    standard: string;
    version: string;
    url?: string;
  };
}

${constants}

/**
 * All 12 layers with metadata, indexed by layer ID
 */
export const LAYERS: Map<string, LayerMetadata> = new Map([
${mapEntries}
]);

/**
 * All 12 layers with metadata, indexed by layer number for O(1) lookup
 */
export const LAYERS_BY_NUMBER: Map<number, LayerMetadata> = new Map([
${mapEntriesByNumber}
]);

/**
 * Layer hierarchy - ordered array of layer numbers for reference validation
 */
export const LAYER_HIERARCHY: readonly number[] = [${layerHierarchy}] as const;

/**
 * Get layer metadata by layer number (1-12)
 */
export function getLayerByNumber(n: number): LayerMetadata | undefined {
  return LAYERS_BY_NUMBER.get(n);
}

/**
 * Get layer metadata by canonical layer ID
 */
export function getLayerById(id: string): LayerMetadata | undefined {
  return LAYERS.get(id);
}

/**
 * Check if a layer ID is valid
 */
export function isValidLayer(id: string): boolean {
  return LAYERS.has(id);
}

/**
 * Get all valid node types for a layer
 */
export function getNodeTypesForLayer(layerId: string): string[] {
  const layer = LAYERS.get(layerId);
  return layer ? layer.nodeTypes : [];
}

/**
 * Get all canonical layer IDs in numeric order
 */
export function getAllLayerIds(): string[] {
  return Array.from(LAYERS.values())
    .sort((a, b) => a.number - b.number)
    .map((l) => l.id);
}

/**
 * Get all layers in numeric order
 */
export function getAllLayers(): LayerMetadata[] {
  return Array.from(LAYERS.values()).sort((a, b) => a.number - b.number);
}
`;
}

/**
 * Format a union type with proper line wrapping
 */
function formatUnionType(members: string[], itemsPerLine: number = 5): string {
  const lines: string[] = [];
  for (let i = 0; i < members.length; i += itemsPerLine) {
    lines.push(members.slice(i, i + itemsPerLine).join(" | "));
  }
  return lines.join(" |\n  ");
}

/**
 * Generate node-types.ts with NodeTypeInfo interface and node type index
 */
function generateNodeTypes(nodeTypes: NodeTypeInfo[]): string {
  // Create SpecNodeId union type with all 354 types
  const specNodeIdMembers = nodeTypes.map((n) => `"${n.specNodeId}"`);
  const specNodeIds = formatUnionType(specNodeIdMembers);

  // Create NodeType union type with unique type names
  const uniqueTypeMembers = Array.from(new Set(nodeTypes.map((n) => n.type)))
    .map((t) => `"${t}"`)
    .sort();
  const uniqueTypes = formatUnionType(uniqueTypeMembers);

  // Create LayerId union type from node types
  const uniqueLayerMembers = Array.from(new Set(nodeTypes.map((n) => n.layer)))
    .map((l) => `"${l}"`)
    .sort();
  const uniqueLayers = formatUnionType(uniqueLayerMembers);

  // Generate NodeTypeInfo constants
  const constants = nodeTypes
    .map(
      (n) => `
const NODE_TYPE_${n.specNodeId
        .replace(/\./g, "_")
        .replace(/-/g, "_")
        .toUpperCase()}: NodeTypeInfo = {
  specNodeId: "${n.specNodeId}",
  layer: "${n.layer}",
  type: "${n.type}",
  title: "${n.title.replace(/"/g, '\\"')}",
  requiredAttributes: [${n.requiredAttributes.map((a) => `"${a}"`).join(", ")}],
  optionalAttributes: [${n.optionalAttributes.map((a) => `"${a}"`).join(", ")}],
  attributeConstraints: ${JSON.stringify(n.attributeConstraints)},
};`
    )
    .join("\n");

  // Generate Map entries
  const mapEntries = nodeTypes
    .map(
      (n) =>
        `    ["${n.specNodeId}", NODE_TYPE_${n.specNodeId
          .replace(/\./g, "_")
          .replace(/-/g, "_")
          .toUpperCase()}]`
    )
    .join(",\n");

  return `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-registry.ts
 * during the build process. Changes will be overwritten.
 *
 * Source: cli/src/schemas/bundled/nodes (354 .node.schema.json files)
 */

/**
 * Metadata for a specific node type extracted from its schema
 */
export interface NodeTypeInfo {
  specNodeId: SpecNodeId;
  layer: LayerId;
  type: NodeType;
  title: string;
  requiredAttributes: string[];
  optionalAttributes: string[];
  attributeConstraints: Record<string, unknown>;
}

/**
 * Union type of all 354 valid node type identifiers (spec_node_id values)
 * Format: "{layer}.{type}" e.g., "motivation.goal", "api.endpoint", "data-model.entity"
 */
export type SpecNodeId =
  | ${specNodeIds};

/**
 * Union type of all unique node type names across all layers
 * E.g., "goal", "requirement", "endpoint", "table", etc.
 */
export type NodeType =
  | ${uniqueTypes};

/**
 * Union type of layer IDs that have node types
 */
export type LayerId =
  | ${uniqueLayers};
${constants}

/**
 * All ${nodeTypes.length} node types with metadata, indexed by spec_node_id
 * Provides O(1) lookup for node type information
 */
export const NODE_TYPES: Map<SpecNodeId, NodeTypeInfo> = new Map([
${mapEntries}
]);

/**
 * Get node type metadata by spec_node_id
 */
export function getNodeType(specNodeId: SpecNodeId): NodeTypeInfo | undefined {
  return NODE_TYPES.get(specNodeId);
}

/**
 * Get all valid node types for a given layer
 */
export function getNodeTypesForLayer(layer: string): NodeTypeInfo[] {
  const result: NodeTypeInfo[] = [];
  for (const nodeType of NODE_TYPES.values()) {
    if (nodeType.layer === layer) {
      result.push(nodeType);
    }
  }
  return result;
}

/**
 * Check if a type is valid for a given layer
 */
export function isValidNodeType(layer: string, type: string): boolean {
  for (const nodeType of NODE_TYPES.values()) {
    if (nodeType.layer === layer && nodeType.type === type) {
      return true;
    }
  }
  return false;
}

/**
 * Get required attributes for a node type
 */
export function getRequiredAttributes(specNodeId: SpecNodeId): string[] {
  const nodeType = NODE_TYPES.get(specNodeId);
  return nodeType ? nodeType.requiredAttributes : [];
}

/**
 * Check if a spec_node_id is valid
 */
export function isValidSpecNodeId(value: unknown): value is SpecNodeId {
  return typeof value === "string" && NODE_TYPES.has(value as SpecNodeId);
}
`;
}

/**
 * Generate layer-types.ts with LayerId union type
 */
function generateLayerTypes(layers: LayerMetadata[]): string {
  const layerIdType = layers.map((l) => `"${l.id}"`).join(" | ");

  return `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-registry.ts
 * during the build process. Changes will be overwritten.
 *
 * Source: spec/layers/*.layer.json
 */

/**
 * Union type of all valid layer IDs in the 12-layer architecture model
 */
export type LayerId = ${layerIdType};

/**
 * Check if a value is a valid LayerId
 */
export function isLayerId(value: unknown): value is LayerId {
  const validIds: LayerId[] = [${layers.map((l) => `"${l.id}"`).join(", ")}];
  return typeof value === "string" && validIds.includes(value as LayerId);
}
`;
}

/**
 * Ensure generated directory exists
 */
function ensureGeneratedDir(): void {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

/**
 * Generate index.ts barrel file
 */
function generateIndexBarrel(): string {
  return `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-registry.ts
 * during the build process. Changes will be overwritten.
 *
 * Central exports for all generated code
 */

// Layer registry exports (legacy spec node IDs)
export {
  LayerMetadata,
  LAYERS,
  LAYERS_BY_NUMBER,
  LAYER_HIERARCHY,
  getLayerByNumber,
  getLayerById,
  isValidLayer,
  getNodeTypesForLayer as getSpecNodeTypesForLayer,
  getAllLayerIds,
  getAllLayers,
} from "./layer-registry.js";

// Layer types exports
export type { LayerId as LayerIdType } from "./layer-types.js";
export { isLayerId } from "./layer-types.js";

// Node types exports (new detailed type information)
export type { SpecNodeId, NodeType, LayerId, NodeTypeInfo } from "./node-types.js";
export {
  NODE_TYPES,
  getNodeType,
  getNodeTypesForLayer,
  isValidNodeType,
  getRequiredAttributes,
  isValidSpecNodeId,
} from "./node-types.js";
`;
}

/**
 * Write generated files
 */
function writeGeneratedFiles(layers: LayerMetadata[], nodeTypes: NodeTypeInfo[]): void {
  ensureGeneratedDir();

  const registryPath = path.join(GENERATED_DIR, "layer-registry.ts");
  const typesPath = path.join(GENERATED_DIR, "layer-types.ts");
  const nodeTypesPath = path.join(GENERATED_DIR, "node-types.ts");
  const indexPath = path.join(GENERATED_DIR, "index.ts");

  const registryContent = generateLayerRegistry(layers);
  const typesContent = generateLayerTypes(layers);
  const nodeTypesContent = generateNodeTypes(nodeTypes);
  const indexContent = generateIndexBarrel();

  fs.writeFileSync(registryPath, registryContent);
  fs.writeFileSync(typesPath, typesContent);
  fs.writeFileSync(nodeTypesPath, nodeTypesContent);
  fs.writeFileSync(indexPath, indexContent);

  console.log(`✓ Generated ${registryPath}`);
  console.log(`✓ Generated ${typesPath}`);
  console.log(`✓ Generated ${nodeTypesPath} (${nodeTypes.length} node types)`);
  console.log(`✓ Generated ${indexPath}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    console.log("Generating layer registry and node type index...");
    const layers = loadLayerInstances();
    console.log(`✓ Loaded ${layers.length} layer instances`);

    const nodeTypes = loadNodeSchemas();
    console.log(`✓ Loaded ${nodeTypes.length} node type schemas`);

    writeGeneratedFiles(layers, nodeTypes);
    console.log("✓ Layer registry and node type index generation complete");
  } catch (error) {
    console.error("ERROR: Registry generation failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
