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
const BUNDLED_DIR = path.join(CLI_DIR, "src", "schemas", "bundled");
const GENERATED_DIR = path.join(CLI_DIR, "src", "generated");

// ─── Compiled dist format types ────────────────────────────────────────────────

interface ManifestDistFile {
  specVersion: string;
  builtAt: string;
  layers: Array<{
    id: string;
    number: number;
    name: string;
    nodeTypeCount: number;
    relationshipCount: number;
  }>;
  totals: { nodeTypes: number; relationships: number };
}

interface LayerDistInstance {
  id: string;
  number: number;
  name: string;
  description: string;
  node_types: string[];
  inspired_by?: { standard: string; version: string; url?: string };
}

interface LayerDistFile {
  specVersion: string;
  layer: LayerDistInstance;
  nodeSchemas: Record<string, any>;
  relationshipSchemas: Record<string, {
    id: string;
    source_spec_node_id: string;
    destination_spec_node_id: string;
    predicate: string;
    cardinality: string;
    strength: string;
    required?: boolean;
  }>;
}

/**
 * Expected layer count for the architecture model
 * The current 12-layer model is a specification invariant (expected value validated at build time).
 * Future expansion would require updating this constant, layer instance files, and layer schemas.
 * See: spec/layers/ for all layer definitions
 */
const EXPECTED_LAYER_COUNT = 12;

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

interface RelationshipSchemaFile {
  id: string;
  source_spec_node_id: string;
  destination_spec_node_id: string;
  predicate: string;
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  strength: "critical" | "high" | "medium" | "low";
  required?: boolean;
}

/**
 * Load the manifest from bundled directory
 */
function loadManifest(): ManifestDistFile {
  const manifestPath = path.join(BUNDLED_DIR, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: manifest.json not found at ${manifestPath}`);
    console.error("Run 'npm run sync-schemas' first (which requires 'npm run build:spec' at repo root).");
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ManifestDistFile;
}

/**
 * Load a single layer dist file from bundled directory
 */
function loadLayerDistFile(layerId: string): LayerDistFile {
  const layerPath = path.join(BUNDLED_DIR, `${layerId}.json`);

  if (!fs.existsSync(layerPath)) {
    console.error(`ERROR: Layer file not found: ${layerPath}`);
    process.exit(1);
  }

  return JSON.parse(fs.readFileSync(layerPath, "utf-8")) as LayerDistFile;
}

/**
 * Load all layer instances from bundled compiled format
 */
function loadLayerInstances(quiet: boolean = false): LayerMetadata[] {
  const manifest = loadManifest();

  if (manifest.layers.length !== EXPECTED_LAYER_COUNT) {
    console.error(`ERROR: Expected ${EXPECTED_LAYER_COUNT} layers, but manifest has ${manifest.layers.length}`);
    process.exit(1);
  }

  const layers: LayerMetadata[] = manifest.layers
    .sort((a, b) => a.number - b.number)
    .map((entry) => {
      const layerFile = loadLayerDistFile(entry.id);
      const instance = layerFile.layer;

      return {
        id: instance.id,
        number: instance.number,
        name: instance.name,
        description: instance.description,
        nodeTypes: instance.node_types,
        ...(instance.inspired_by && { inspiredBy: instance.inspired_by }),
      };
    });

  // Validate layers are numbered sequentially from 1 to EXPECTED_LAYER_COUNT
  const numbers = layers.map((l) => l.number).sort((a, b) => a - b);
  const expectedSequence = Array.from({ length: EXPECTED_LAYER_COUNT }, (_, i) => i + 1).join(",");
  if (numbers.join(",") !== expectedSequence) {
    console.error(`ERROR: Invalid layer numbers: ${numbers.join(", ")}`);
    console.error(`Expected sequential numbering: ${expectedSequence}`);
    process.exit(1);
  }

  return layers;
}

/**
 * Load all node schemas from bundled compiled format
 */
function loadNodeSchemas(quiet: boolean = false): NodeTypeInfo[] {
  const manifest = loadManifest();
  const nodeTypes: NodeTypeInfo[] = [];

  for (const entry of manifest.layers.sort((a, b) => a.number - b.number)) {
    const layerFile = loadLayerDistFile(entry.id);

    for (const [type, schema] of Object.entries(layerFile.nodeSchemas)) {
      const s = schema as any;
      const specNodeId = s.properties?.spec_node_id?.const;
      const layer = s.properties?.layer_id?.const;
      const nodeType = s.properties?.type?.const;
      const title = s.title || type;

      if (!specNodeId || !layer || !nodeType) {
        throw new Error(
          `Invalid node schema for '${entry.id}.${type}': missing spec_node_id, layer_id, or type`
        );
      }

      const attributesSchema = s.properties?.attributes;
      const requiredAttributes = attributesSchema?.required || [];
      const allAttributes = Object.keys(attributesSchema?.properties || {});
      const optionalAttributes = allAttributes.filter(
        (a: string) => !requiredAttributes.includes(a)
      );

      nodeTypes.push({
        specNodeId,
        layer,
        type: nodeType,
        title,
        requiredAttributes,
        optionalAttributes,
        attributeConstraints: attributesSchema?.properties || {},
      });
    }
  }

  if (nodeTypes.length === 0) {
    console.error("ERROR: No node types found in bundled layer files");
    process.exit(1);
  }

  return nodeTypes;
}

/**
 * Load all relationship schemas from bundled compiled format
 *
 * @param strictMode Not used in compiled format (duplicates are deduplicated at build:spec time)
 * @param quiet If true, suppress all progress output
 */
function loadRelationshipSchemas(strictMode: boolean = false, quiet: boolean = false): RelationshipSchemaFile[] {
  const manifest = loadManifest();
  const relationships: RelationshipSchemaFile[] = [];

  for (const entry of manifest.layers.sort((a, b) => a.number - b.number)) {
    const layerFile = loadLayerDistFile(entry.id);

    for (const rel of Object.values(layerFile.relationshipSchemas)) {
      relationships.push({
        id: rel.id,
        source_spec_node_id: rel.source_spec_node_id,
        destination_spec_node_id: rel.destination_spec_node_id,
        predicate: rel.predicate,
        cardinality: (rel.cardinality || "many-to-many") as RelationshipSchemaFile["cardinality"],
        strength: (rel.strength || "medium") as RelationshipSchemaFile["strength"],
        required: rel.required || false,
      });
    }
  }

  return relationships;
}

/**
 * Generate relationship-index.ts with all 252+ relationship specifications
 */
function generateRelationshipIndex(relationships: RelationshipSchemaFile[]): string {
  // Generate constants for each relationship
  const constants = relationships
    .map(
      (r) => `
const RELATIONSHIP_${r.id
        .replace(/\./g, "_")
        .replace(/-/g, "_")
        .toUpperCase()}: RelationshipSpec = /*#__PURE__*/ {
  id: "${r.id}",
  sourceSpecNodeId: "${r.source_spec_node_id}",
  destinationSpecNodeId: "${r.destination_spec_node_id}",
  predicate: "${r.predicate}",
  cardinality: "${r.cardinality}",
  strength: "${r.strength}",
  required: ${r.required || false},
};`
    )
    .join("\n");

  // Generate RELATIONSHIPS array
  const relationshipsArray = relationships
    .map((r) => `    RELATIONSHIP_${r.id.replace(/\./g, "_").replace(/-/g, "_").toUpperCase()}`)
    .join(",\n");

  // Generate indexed maps for O(1) lookups
  const bySourceEntries = relationships
    .reduce<Map<string, RelationshipSchemaFile[]>>((acc, r) => {
      if (!acc.has(r.source_spec_node_id)) {
        acc.set(r.source_spec_node_id, []);
      }
      acc.get(r.source_spec_node_id)!.push(r);
      return acc;
    }, new Map())
    .entries();

  const bySourceMap = Array.from(bySourceEntries)
    .map(
      ([source, rels]) =>
        `    ["${source}", [${rels.map((r) => `RELATIONSHIP_${r.id.replace(/\./g, "_").replace(/-/g, "_").toUpperCase()}`).join(", ")}]]`
    )
    .join(",\n");

  const byPredicateEntries = relationships
    .reduce<Map<string, RelationshipSchemaFile[]>>((acc, r) => {
      if (!acc.has(r.predicate)) {
        acc.set(r.predicate, []);
      }
      acc.get(r.predicate)!.push(r);
      return acc;
    }, new Map())
    .entries();

  const byPredicateMap = Array.from(byPredicateEntries)
    .map(
      ([predicate, rels]) =>
        `    ["${predicate}", [${rels.map((r) => `RELATIONSHIP_${r.id.replace(/\./g, "_").replace(/-/g, "_").toUpperCase()}`).join(", ")}]]`
    )
    .join(",\n");

  const byDestinationEntries = relationships
    .reduce<Map<string, RelationshipSchemaFile[]>>((acc, r) => {
      if (!acc.has(r.destination_spec_node_id)) {
        acc.set(r.destination_spec_node_id, []);
      }
      acc.get(r.destination_spec_node_id)!.push(r);
      return acc;
    }, new Map())
    .entries();

  const byDestinationMap = Array.from(byDestinationEntries)
    .map(
      ([destination, rels]) =>
        `    ["${destination}", [${rels.map((r) => `RELATIONSHIP_${r.id.replace(/\./g, "_").replace(/-/g, "_").toUpperCase()}`).join(", ")}]]`
    )
    .join(",\n");

  return `/**
 * GENERATED FILE - DO NOT EDIT
 * This file is automatically generated by scripts/generate-registry.ts
 * during the build process. Changes will be overwritten.
 *
 * Source: cli/src/schemas/bundled/relationships (252+ .relationship.schema.json files)
 */

/**
 * Relationship specification extracted from relationship schema files
 * Defines source/destination node types, predicates, and cardinality constraints
 */
export interface RelationshipSpec {
  id: string;                    // "motivation.supports.motivation"
  sourceSpecNodeId: string;      // "motivation.goal"
  destinationSpecNodeId: string; // "motivation.requirement"
  predicate: string;             // "supports"
  cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
  strength: "critical" | "high" | "medium" | "low";
  required: boolean;
}

${constants}

/**
 * All ${relationships.length} relationship specifications from schema files
 */
export const RELATIONSHIPS: RelationshipSpec[] = /*#__PURE__*/ [
${relationshipsArray}
];

/**
 * Relationships indexed by source node type ID for O(1) lookup
 * Key: "motivation.goal", Value: [RelationshipSpec, ...]
 */
export const RELATIONSHIPS_BY_SOURCE: Map<string, RelationshipSpec[]> = /*#__PURE__*/ new Map([
${bySourceMap}
]);

/**
 * Relationships indexed by predicate for O(1) lookup
 * Key: "supports", Value: [RelationshipSpec, ...]
 */
export const RELATIONSHIPS_BY_PREDICATE: Map<string, RelationshipSpec[]> = /*#__PURE__*/ new Map([
${byPredicateMap}
]);

/**
 * Relationships indexed by destination node type ID for O(1) lookup
 * Key: "motivation.requirement", Value: [RelationshipSpec, ...]
 */
export const RELATIONSHIPS_BY_DESTINATION: Map<string, RelationshipSpec[]> = /*#__PURE__*/ new Map([
${byDestinationMap}
]);

/**
 * Find all valid relationships for a source type, optionally filtered by predicate and destination
 */
export function getValidRelationships(
  sourceType: string,
  predicate?: string,
  destinationType?: string
): RelationshipSpec[] {
  let results = RELATIONSHIPS_BY_SOURCE.get(sourceType) || [];

  if (predicate) {
    results = results.filter((r) => r.predicate === predicate);
  }

  if (destinationType) {
    results = results.filter((r) => r.destinationSpecNodeId === destinationType);
  }

  return results;
}

/**
 * Check if a relationship is valid according to schemas
 */
export function isValidRelationship(
  sourceType: string,
  predicate: string,
  destinationType: string
): boolean {
  const rels = getValidRelationships(sourceType, predicate, destinationType);
  return rels.length > 0;
}

/**
 * Get all valid predicates for a source type
 */
export function getValidPredicatesForSource(sourceType: string): string[] {
  const rels = RELATIONSHIPS_BY_SOURCE.get(sourceType) || [];
  return Array.from(new Set(rels.map((r) => r.predicate)));
}

/**
 * Get all valid destination types for a source type and predicate
 */
export function getValidDestinationsForSourceAndPredicate(
  sourceType: string,
  predicate: string
): string[] {
  const rels = getValidRelationships(sourceType, predicate);
  return Array.from(new Set(rels.map((r) => r.destinationSpecNodeId)));
}
`;
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
const LAYER_METADATA_${toIdentifier(l.id)}: LayerMetadata = /*#__PURE__*/ {
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
export const LAYERS: Map<string, LayerMetadata> = /*#__PURE__*/ new Map([
${mapEntries}
]);

/**
 * All 12 layers with metadata, indexed by layer number for O(1) lookup
 */
export const LAYERS_BY_NUMBER: Map<number, LayerMetadata> = /*#__PURE__*/ new Map([
${mapEntriesByNumber}
]);

/**
 * Layer hierarchy - ordered array of layer numbers for reference validation
 */
export const LAYER_HIERARCHY: readonly number[] = /*#__PURE__*/ [${layerHierarchy}] as const;

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
        .toUpperCase()}: NodeTypeInfo = /*#__PURE__*/ {
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
export const NODE_TYPES: Map<SpecNodeId, NodeTypeInfo> = /*#__PURE__*/ new Map([
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
 * Normalize a user-provided type name to match the schema type name for a layer.
 * Supports abbreviated type names (e.g., "service" → "businessservice" for business layer).
 *
 * @param layer - The layer name
 * @param type - The user-provided type name (can be abbreviated or full)
 * @returns The normalized type name that matches the schema, or the original if no match found
 */
export function normalizeNodeType(layer: string, type: string): string {
  // First, check if the type exists as-is
  for (const nodeType of NODE_TYPES.values()) {
    if (nodeType.layer === layer && nodeType.type === type) {
      return type; // Already correct
    }
  }

  // Try prepending the layer name for common patterns
  // e.g., "service" → "businessservice" for business layer
  const layerPrefixedType = \`\${layer}\${type}\`;
  for (const nodeType of NODE_TYPES.values()) {
    if (nodeType.layer === layer && nodeType.type === layerPrefixedType) {
      return layerPrefixedType;
    }
  }

  // Return original if no normalization worked
  return type;
}

/**
 * Check if a type is valid for a given layer (supports abbreviated type names)
 */
export function isValidNodeType(layer: string, type: string): boolean {
  const normalizedType = normalizeNodeType(layer, type);
  for (const nodeType of NODE_TYPES.values()) {
    if (nodeType.layer === layer && nodeType.type === normalizedType) {
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
export type { LayerId } from "./layer-types.js";
export { isLayerId } from "./layer-types.js";

// Node types exports (new detailed type information)
export type { SpecNodeId, NodeType, NodeTypeInfo } from "./node-types.js";
export {
  NODE_TYPES,
  getNodeType,
  getNodeTypesForLayer,
  isValidNodeType,
  getRequiredAttributes,
  isValidSpecNodeId,
} from "./node-types.js";

// Relationship index exports (schema-based relationship validation)
export type { RelationshipSpec } from "./relationship-index.js";
export {
  RELATIONSHIPS,
  RELATIONSHIPS_BY_SOURCE,
  RELATIONSHIPS_BY_PREDICATE,
  RELATIONSHIPS_BY_DESTINATION,
  getValidRelationships,
  isValidRelationship,
  getValidPredicatesForSource,
  getValidDestinationsForSourceAndPredicate,
} from "./relationship-index.js";
`;
}

/**
 * Write generated files
 */
function writeGeneratedFiles(
  layers: LayerMetadata[],
  nodeTypes: NodeTypeInfo[],
  relationships: RelationshipSchemaFile[],
  quiet: boolean = false
): void {
  ensureGeneratedDir();

  const registryPath = path.join(GENERATED_DIR, "layer-registry.ts");
  const typesPath = path.join(GENERATED_DIR, "layer-types.ts");
  const nodeTypesPath = path.join(GENERATED_DIR, "node-types.ts");
  const relationshipIndexPath = path.join(GENERATED_DIR, "relationship-index.ts");
  const indexPath = path.join(GENERATED_DIR, "index.ts");

  const registryContent = generateLayerRegistry(layers);
  const typesContent = generateLayerTypes(layers);
  const nodeTypesContent = generateNodeTypes(nodeTypes);
  const relationshipIndexContent = generateRelationshipIndex(relationships);
  const indexContent = generateIndexBarrel();

  fs.writeFileSync(registryPath, registryContent);
  fs.writeFileSync(typesPath, typesContent);
  fs.writeFileSync(nodeTypesPath, nodeTypesContent);
  fs.writeFileSync(relationshipIndexPath, relationshipIndexContent);
  fs.writeFileSync(indexPath, indexContent);

  if (!quiet) {
    console.log(`[OK] Generated ${registryPath}`);
    console.log(`[OK] Generated ${typesPath}`);
    console.log(`[OK] Generated ${nodeTypesPath} (${nodeTypes.length} node types)`);
    console.log(`[OK] Generated ${relationshipIndexPath} (${relationships.length} relationship specs)`);
    console.log(`[OK] Generated ${indexPath}`);
  }
}

/**
 * Main entry point
 *
 * Supports optional flags for build customization:
 *   npm run build                 # Development: all output, warnings only
 *   npm run build -- --strict     # Production: duplicates cause build failure
 *   npm run build -- --quiet      # Silent mode: errors only, no progress output
 */
async function main(): Promise<void> {
  try {
    // Check for --strict and --quiet flags (passed via npm scripts or direct invocation)
    const strictMode = process.argv.includes("--strict");
    const quiet = process.argv.includes("--quiet");

    if (!quiet) {
      if (strictMode) {
        console.log("Generating layer registry in STRICT MODE (duplicates will fail build)...");
      } else {
        console.log("Generating layer registry, node type index, and relationship index...");
      }
    }

    const layers = loadLayerInstances(quiet);
    if (!quiet) {
      console.log(`[OK] Loaded ${layers.length} layer instances`);
    }

    const nodeTypes = loadNodeSchemas(quiet);
    if (!quiet) {
      console.log(`[OK] Loaded ${nodeTypes.length} node type schemas`);
    }

    const relationships = loadRelationshipSchemas(strictMode, quiet);
    if (!quiet) {
      console.log(`[OK] Loaded ${relationships.length} relationship specs`);
    }

    writeGeneratedFiles(layers, nodeTypes, relationships, quiet);
    if (!quiet) {
      console.log("[OK] Registry and index generation complete");
    }
  } catch (error) {
    console.error("ERROR: Registry generation failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
