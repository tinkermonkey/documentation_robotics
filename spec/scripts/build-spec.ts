#!/usr/bin/env npx tsx

/**
 * build-spec.ts — Spec compiler
 *
 * Compiles spec source files (spec/schemas/, spec/layers/) into a compact
 * distribution format in spec/dist/:
 *   - manifest.json          — index of all layers with counts
 *   - base.json              — all base schemas + predicates
 *   - {layer}.json (x12)     — per-layer: metadata + nodeSchemas + relationshipSchemas
 *
 * $ref values are rewritten from relative filesystem paths to URN-style IDs:
 *   "../../base/spec-node.schema.json" → "urn:dr:spec:base:spec-node"
 *
 * Usage: npx tsx spec/scripts/build-spec.ts [--validate]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import prettier from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPEC_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.join(__dirname, "../..");
const SCHEMAS_DIR = path.join(SPEC_DIR, "schemas");
const LAYERS_DIR = path.join(SPEC_DIR, "layers");
const DIST_DIR = path.join(SPEC_DIR, "dist");
const VERSION_FILE = path.join(SPEC_DIR, "VERSION");

// Base schema filename → URN-style ID mapping
const BASE_SCHEMA_ID_MAP: Record<string, string> = {
  "spec-node.schema.json": "urn:dr:spec:base:spec-node",
  "spec-node-relationship.schema.json": "urn:dr:spec:base:spec-node-relationship",
  "source-references.schema.json": "urn:dr:spec:base:source-references",
  "attribute-spec.schema.json": "urn:dr:spec:base:attribute-spec",
  "model-node-relationship.schema.json": "urn:dr:spec:base:model-node-relationship",
  "predicate-catalog.schema.json": "urn:dr:spec:base:predicate-catalog",
  "spec-layer.schema.json": "urn:dr:spec:base:spec-layer",
};

// $ref patterns to rewrite: relative path → URN
// Handles both bare refs and refs with fragment (#/definitions/...)
const REF_REWRITE_RULES: Array<[RegExp, string]> = [
  // Relative paths from node/relationship schemas (../../base/...)
  [/^\.\.\/\.\.\/base\/spec-node\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-node$1"],
  [/^\.\.\/\.\.\/base\/spec-node-relationship\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-node-relationship$1"],
  [/^\.\.\/\.\.\/base\/source-references\.schema\.json(#.*)?$/, "urn:dr:spec:base:source-references$1"],
  [/^\.\.\/\.\.\/base\/attribute-spec\.schema\.json(#.*)?$/, "urn:dr:spec:base:attribute-spec$1"],
  [/^\.\.\/\.\.\/base\/model-node-relationship\.schema\.json(#.*)?$/, "urn:dr:spec:base:model-node-relationship$1"],
  [/^\.\.\/\.\.\/base\/predicate-catalog\.schema\.json(#.*)?$/, "urn:dr:spec:base:predicate-catalog$1"],
  [/^\.\.\/\.\.\/base\/spec-layer\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-layer$1"],
  // Bare filename refs (used within base schemas referencing each other)
  [/^spec-node\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-node$1"],
  [/^spec-node-relationship\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-node-relationship$1"],
  [/^source-references\.schema\.json(#.*)?$/, "urn:dr:spec:base:source-references$1"],
  [/^attribute-spec\.schema\.json(#.*)?$/, "urn:dr:spec:base:attribute-spec$1"],
  [/^model-node-relationship\.schema\.json(#.*)?$/, "urn:dr:spec:base:model-node-relationship$1"],
  [/^predicate-catalog\.schema\.json(#.*)?$/, "urn:dr:spec:base:predicate-catalog$1"],
  [/^spec-layer\.schema\.json(#.*)?$/, "urn:dr:spec:base:spec-layer$1"],
];

// Layer ID → canonical name mapping (ordered)
const LAYER_ORDER = [
  "motivation",
  "business",
  "security",
  "application",
  "technology",
  "api",
  "data-model",
  "data-store",
  "ux",
  "navigation",
  "apm",
  "testing",
];

// Layer instance filename prefix → canonical ID
const LAYER_FILE_PREFIX_MAP: Record<string, string> = {
  "01-motivation": "motivation",
  "02-business": "business",
  "03-security": "security",
  "04-application": "application",
  "05-technology": "technology",
  "06-api": "api",
  "07-data-model": "data-model",
  "08-data-store": "data-store",
  "09-ux": "ux",
  "10-navigation": "navigation",
  "11-apm": "apm",
  "12-testing": "testing",
};

// Node schema folder name → canonical layer ID
const NODE_FOLDER_TO_LAYER: Record<string, string> = {
  motivation: "motivation",
  business: "business",
  security: "security",
  application: "application",
  technology: "technology",
  api: "api",
  "data-model": "data-model",
  "data-store": "data-store",
  ux: "ux",
  navigation: "navigation",
  apm: "apm",
  testing: "testing",
};

// ─── Type definitions ──────────────────────────────────────────────────────────

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

interface RelationshipData {
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

interface LayerDistFile {
  specVersion: string;
  layer: LayerInstance;
  nodeSchemas: Record<string, unknown>;
  relationshipSchemas: Record<string, RelationshipData>;
}

interface BaseDistFile {
  specVersion: string;
  schemas: Record<string, unknown>;
  predicates: unknown;
}

interface ManifestEntry {
  id: string;
  number: number;
  name: string;
  nodeTypeCount: number;
  relationshipCount: number;
}

interface ManifestDistFile {
  specVersion: string;
  layers: ManifestEntry[];
  totals: {
    nodeTypes: number;
    relationships: number;
  };
}

interface AnalyzerNodeMapping {
  analyzer_node_type: string;
  dr_layer: string;
  dr_node_type: string;
  confidence: string;
  [key: string]: unknown;
}

interface AnalyzerEdgeMapping {
  analyzer_edge_type: string;
  dr_relationship: string | null;
  confidence: string;
  [key: string]: unknown;
}

interface AnalyzerNodeMappingFile {
  mappings: AnalyzerNodeMapping[];
  unmapped_labels?: string[];
}

interface AnalyzerEdgeMappingFile {
  mappings: AnalyzerEdgeMapping[];
}

interface AnalyzerSpec {
  name: string;
  [key: string]: unknown;
}

interface AnalyzerHeuristics {
  [key: string]: unknown;
}

interface PackedAnalyzer {
  name: string;
  version: string;
  source_version: string;
  analyzer: AnalyzerSpec;
  nodes_by_label: Record<string, AnalyzerNodeMapping>;
  edges_by_type: Record<string, AnalyzerEdgeMapping>;
  heuristics: AnalyzerHeuristics;
}

interface AnalyzerManifestEntry {
  name: string;
  version: string;
}

interface AnalyzerManifestFile {
  specVersion: string;
  analyzers: AnalyzerManifestEntry[];
}

// ─── $ref rewriting ────────────────────────────────────────────────────────────

/**
 * Rewrite a single $ref value from relative path to URN-style ID.
 * Returns the original value if no rule matches.
 */
function rewriteRef(ref: string): string {
  for (const [pattern, replacement] of REF_REWRITE_RULES) {
    const match = ref.match(pattern);
    if (match) {
      // Reconstruct with fragment if present
      const fragment = match[1] || "";
      return ref.replace(pattern, replacement);
    }
  }
  return ref;
}

/**
 * Recursively walk a JSON object and rewrite all "$ref" string values.
 * Mutates the object in-place (after deep clone by caller).
 */
function rewriteRefs(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(rewriteRefs);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string") {
      result[key] = rewriteRef(value);
    } else {
      result[key] = rewriteRefs(value);
    }
  }
  return result;
}

/**
 * Rewrite $id in a schema to use URN-style ID
 */
function rewriteSchemaId(schema: Record<string, unknown>, newId: string): Record<string, unknown> {
  return { ...schema, $id: newId };
}

// ─── Phase 1: Load source files ────────────────────────────────────────────────

function loadSpecVersion(): string {
  return fs.readFileSync(VERSION_FILE, "utf-8").trim();
}

function loadBaseSchemas(): Record<string, unknown> {
  const baseDir = path.join(SCHEMAS_DIR, "base");
  const schemas: Record<string, unknown> = {};

  for (const [filename, urnId] of Object.entries(BASE_SCHEMA_ID_MAP)) {
    const filepath = path.join(baseDir, filename);
    if (!fs.existsSync(filepath)) {
      console.warn(`[WARN] Base schema not found: ${filepath}`);
      continue;
    }

    const content = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    // Rewrite $refs within the base schema itself
    const withRewrittenRefs = rewriteRefs(content) as Record<string, unknown>;
    // Rewrite $id to URN
    const withNewId = rewriteSchemaId(withRewrittenRefs, urnId);
    // Extract the schema key (e.g., "spec-node" from "urn:dr:spec:base:spec-node")
    const key = urnId.replace("urn:dr:spec:base:", "");
    schemas[key] = withNewId;
  }

  return schemas;
}

function loadPredicates(): unknown {
  const predicatesPath = path.join(SCHEMAS_DIR, "base", "predicates.json");
  if (!fs.existsSync(predicatesPath)) {
    console.warn(`[WARN] predicates.json not found at ${predicatesPath}`);
    return {};
  }
  const data = JSON.parse(fs.readFileSync(predicatesPath, "utf-8"));
  // predicates.json has { predicates: {...} } — store only the inner dict
  return data.predicates ?? data;
}

function loadLayerInstance(layerFile: string): LayerInstance {
  const content = fs.readFileSync(layerFile, "utf-8");
  return JSON.parse(content) as LayerInstance;
}

function loadNodeSchemasForLayer(layerId: string): Record<string, unknown> {
  const layerDir = path.join(SCHEMAS_DIR, "nodes", layerId);
  const schemas: Record<string, unknown> = {};

  if (!fs.existsSync(layerDir)) {
    console.warn(`[WARN] Node schemas directory not found: ${layerDir}`);
    return schemas;
  }

  const files = fs.readdirSync(layerDir).filter((f) => f.endsWith(".node.schema.json")).sort();

  for (const filename of files) {
    // Extract type from filename: "goal.node.schema.json" → "goal"
    const type = filename.replace(".node.schema.json", "");
    const filepath = path.join(layerDir, filename);
    const content = JSON.parse(fs.readFileSync(filepath, "utf-8"));

    // Rewrite $refs
    const withRewrittenRefs = rewriteRefs(content) as Record<string, unknown>;

    // Rewrite $id
    const newId = `urn:dr:spec:node:${layerId}.${type}`;
    const withNewId = { ...withRewrittenRefs, $id: newId };

    schemas[type] = withNewId;
  }

  return schemas;
}

function loadRelationshipSchemasForLayer(layerId: string): Record<string, RelationshipData> {
  const layerDir = path.join(SCHEMAS_DIR, "relationships", layerId);
  const schemas: Record<string, RelationshipData> = {};

  if (!fs.existsSync(layerDir)) {
    console.warn(`[WARN] Relationship schemas directory not found: ${layerDir}`);
    return schemas;
  }

  const files = fs
    .readdirSync(layerDir)
    .filter((f) => f.endsWith(".relationship.schema.json"))
    .sort();

  for (const filename of files) {
    const filepath = path.join(layerDir, filename);
    try {
      const schema = JSON.parse(fs.readFileSync(filepath, "utf-8"));

      // Extract flat data from JSON Schema wrapper
      const id = schema.properties?.id?.const;
      const source_spec_node_id = schema.properties?.source_spec_node_id?.const;
      const source_layer = schema.properties?.source_layer?.const;
      const destination_spec_node_id = schema.properties?.destination_spec_node_id?.const;
      const destination_layer = schema.properties?.destination_layer?.const;
      const predicate = schema.properties?.predicate?.const;
      const cardinality = schema.properties?.cardinality?.const ?? "many-to-many";
      const strength = schema.properties?.strength?.const ?? "medium";
      const required = schema.properties?.required?.const ?? false;

      if (!id || !source_spec_node_id || !source_layer || !destination_spec_node_id || !destination_layer || !predicate) {
        console.warn(`[WARN] Incomplete relationship schema: ${filepath}`);
        continue;
      }

      const relationshipData: RelationshipData = {
        id,
        source_spec_node_id,
        source_layer,
        destination_spec_node_id,
        destination_layer,
        predicate,
        cardinality,
        strength,
        required,
      };

      // Deduplicate: only keep first occurrence
      if (!schemas[id]) {
        schemas[id] = relationshipData;
      } else {
        console.warn(`[WARN] Duplicate relationship ID '${id}' in ${filename} — skipping`);
      }
    } catch (err: any) {
      console.warn(`[WARN] Failed to parse relationship schema ${filepath}: ${err.message}`);
    }
  }

  return schemas;
}

// ─── Phase 2-5: Compile and write ─────────────────────────────────────────────

async function writeJsonFile(filepath: string, data: unknown): Promise<void> {
  // Write JSON with Prettier formatting to match project's prettier config
  const json = JSON.stringify(data, null, 2);
  const options = await prettier.resolveConfig(filepath);
  const formatted = await prettier.format(json, {
    ...options,
    parser: "json",
  });
  fs.writeFileSync(filepath, formatted, "utf-8");
}

function ensureDistDir(): void {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
}

function ensureAnalyzersDistDir(): void {
  const analyzersDir = path.join(DIST_DIR, "analyzers");
  if (!fs.existsSync(analyzersDir)) {
    fs.mkdirSync(analyzersDir, { recursive: true });
  }
}

// ─── Analyzer validation and compilation ───────────────────────────────────────

/**
 * Validate that all dr_relationship values in edge mappings exist in predicates
 */
function validateDrRelationships(edgeMappings: AnalyzerEdgeMappingFile, predicates: unknown): string[] {
  const errors: string[] = [];
  const predicateDict = (predicates as Record<string, unknown>) || {};

  for (const mapping of edgeMappings.mappings) {
    // null is allowed (unmappable relationships)
    if (mapping.dr_relationship !== null && !predicateDict[mapping.dr_relationship]) {
      errors.push(
        `Invalid dr_relationship '${mapping.dr_relationship}' in analyzer_edge_type '${mapping.analyzer_edge_type}' — not found in predicates.json`
      );
    }
  }

  return errors;
}

/**
 * Load analyzer files from a directory and validate them against base schemas.
 * Returns the packed analyzer artifact or null if validation fails.
 */
function loadAndValidateAnalyzer(
  analyzerDir: string,
  analyzerName: string,
  baseSchemas: Record<string, unknown>,
  predicates: unknown
): PackedAnalyzer | null {
  const requiredFiles = [
    { name: "analyzer.json", schemaKey: "analyzer-spec" },
    { name: "node-mapping.json", schemaKey: "analyzer-node-mapping" },
    { name: "edge-mapping.json", schemaKey: "analyzer-edge-mapping" },
    { name: "extraction-heuristics.json", schemaKey: "analyzer-heuristics" },
  ];

  const loadedFiles: Record<string, unknown> = {};

  // Check that all required files exist
  for (const { name } of requiredFiles) {
    const filepath = path.join(analyzerDir, name);
    if (!fs.existsSync(filepath)) {
      console.error(`[ERROR] Required file missing in analyzer '${analyzerName}': ${name}`);
      return null;
    }
  }

  // Load all files
  let analyzerSpec: AnalyzerSpec | null = null;
  let nodeMapping: AnalyzerNodeMappingFile | null = null;
  let edgeMapping: AnalyzerEdgeMappingFile | null = null;
  let heuristics: AnalyzerHeuristics | null = null;

  try {
    const analyzerPath = path.join(analyzerDir, "analyzer.json");
    analyzerSpec = JSON.parse(fs.readFileSync(analyzerPath, "utf-8"));
    loadedFiles["analyzer.json"] = analyzerSpec;

    const nodeMappingPath = path.join(analyzerDir, "node-mapping.json");
    nodeMapping = JSON.parse(fs.readFileSync(nodeMappingPath, "utf-8"));
    loadedFiles["node-mapping.json"] = nodeMapping;

    const edgeMappingPath = path.join(analyzerDir, "edge-mapping.json");
    edgeMapping = JSON.parse(fs.readFileSync(edgeMappingPath, "utf-8"));
    loadedFiles["edge-mapping.json"] = edgeMapping;

    const heuristicsPath = path.join(analyzerDir, "extraction-heuristics.json");
    heuristics = JSON.parse(fs.readFileSync(heuristicsPath, "utf-8"));
    loadedFiles["extraction-heuristics.json"] = heuristics;
  } catch (err: any) {
    console.error(`[ERROR] Failed to parse analyzer files in '${analyzerName}': ${err.message}`);
    return null;
  }

  // Validate each file against its base schema
  // Note: We're doing basic validation by checking required fields rather than full JSON schema validation
  // to keep the build script lightweight
  if (!analyzerSpec || !analyzerSpec.name) {
    console.error(`[ERROR] analyzer.json in '${analyzerName}' missing required 'name' field`);
    return null;
  }

  if (!nodeMapping || !Array.isArray(nodeMapping.mappings)) {
    console.error(`[ERROR] node-mapping.json in '${analyzerName}' missing required 'mappings' array`);
    return null;
  }

  if (!edgeMapping || !Array.isArray(edgeMapping.mappings)) {
    console.error(`[ERROR] edge-mapping.json in '${analyzerName}' missing required 'mappings' array`);
    return null;
  }

  if (!heuristics) {
    console.error(`[ERROR] extraction-heuristics.json in '${analyzerName}' failed to load`);
    return null;
  }

  // Validate dr_relationship values against predicates
  const relationshipErrors = validateDrRelationships(edgeMapping, predicates);
  if (relationshipErrors.length > 0) {
    console.error(`[ERROR] Invalid dr_relationship values in '${analyzerName}':`);
    relationshipErrors.forEach((err) => console.error(`  ${err}`));
    return null;
  }

  // Get version from node-mapping.json (should have version in metadata or analyzer.json)
  let version = "1.0";
  if (analyzerSpec.metadata && typeof analyzerSpec.metadata === "object") {
    const metadata = analyzerSpec.metadata as Record<string, unknown>;
    if (metadata.version && typeof metadata.version === "string") {
      version = metadata.version;
    }
  }

  // Build nodes_by_label index (using analyzer_node_type as the label/key)
  const nodesByLabel: Record<string, AnalyzerNodeMapping> = {};
  for (const mapping of nodeMapping.mappings) {
    nodesByLabel[mapping.analyzer_node_type] = mapping;
  }

  // Build edges_by_type index (using analyzer_edge_type as the key)
  const edgesByType: Record<string, AnalyzerEdgeMapping> = {};
  for (const mapping of edgeMapping.mappings) {
    edgesByType[mapping.analyzer_edge_type] = mapping;
  }

  // Build packed analyzer artifact
  const packed: PackedAnalyzer = {
    name: analyzerSpec.name as string,
    version,
    source_version: loadSpecVersion(), // Get current spec version
    analyzer: analyzerSpec,
    nodes_by_label: nodesByLabel,
    edges_by_type: edgesByType,
    heuristics,
  };

  return packed;
}

/**
 * Discover and compile all analyzers in spec/analyzers/
 */
async function buildAnalyzers(baseSchemas: Record<string, unknown>, predicates: unknown): Promise<AnalyzerManifestEntry[]> {
  const analyzersRootDir = path.join(SPEC_DIR, "analyzers");

  if (!fs.existsSync(analyzersRootDir)) {
    console.log("  No analyzers directory found — skipping analyzer build");
    return [];
  }

  ensureAnalyzersDistDir();
  const analyzersDistDir = path.join(DIST_DIR, "analyzers");

  const entries = fs.readdirSync(analyzersRootDir);
  const analyzerDirs = entries.filter((entry) => {
    const fullPath = path.join(analyzersRootDir, entry);
    return fs.statSync(fullPath).isDirectory();
  });

  if (analyzerDirs.length === 0) {
    console.log("  No analyzer subdirectories found");
    return [];
  }

  const manifestEntries: AnalyzerManifestEntry[] = [];

  for (const analyzerName of analyzerDirs.sort()) {
    const analyzerDir = path.join(analyzersRootDir, analyzerName);
    const packed = loadAndValidateAnalyzer(analyzerDir, analyzerName, baseSchemas, predicates);

    if (!packed) {
      // Validation failed — propagate error and stop build
      console.error(`\nFailed to build analyzer '${analyzerName}' — aborting build`);
      process.exit(1);
    }

    // Write packed analyzer artifact
    const analyzerDistFile = path.join(analyzersDistDir, `${analyzerName}.json`);
    await writeJsonFile(analyzerDistFile, packed);
    console.log(`  [OK] spec/dist/analyzers/${analyzerName}.json (v${packed.version})`);

    manifestEntries.push({
      name: packed.name,
      version: packed.version,
    });
  }

  return manifestEntries;
}

async function build(validate: boolean = false): Promise<void> {
  console.log("Building spec distribution...");

  ensureDistDir();

  // Phase 1: Load
  const specVersion = loadSpecVersion();
  console.log(`  Spec version: ${specVersion}`);

  const baseSchemas = loadBaseSchemas();
  console.log(`  Loaded ${Object.keys(baseSchemas).length} base schemas`);

  const predicates = loadPredicates();

  // Phase 3: Write base.json
  const baseOutput: BaseDistFile = {
    specVersion,
    schemas: baseSchemas,
    predicates,
  };
  await writeJsonFile(path.join(DIST_DIR, "base.json"), baseOutput);
  console.log(`  [OK] spec/dist/base.json`);

  // Phase 4: Build each layer file
  const manifest: ManifestEntry[] = [];
  let totalNodeTypes = 0;
  let totalRelationships = 0;

  // Get layer files in order
  const layerFiles = fs
    .readdirSync(LAYERS_DIR)
    .filter((f) => f.endsWith(".layer.json"))
    .sort();

  for (const layerFilename of layerFiles) {
    const prefix = layerFilename.replace(".layer.json", "");
    const layerId = LAYER_FILE_PREFIX_MAP[prefix];

    if (!layerId) {
      console.warn(`[WARN] Unknown layer file: ${layerFilename} — skipping`);
      continue;
    }

    const layerInstance = loadLayerInstance(path.join(LAYERS_DIR, layerFilename));
    const nodeSchemas = loadNodeSchemasForLayer(layerId);
    const relationshipSchemas = loadRelationshipSchemasForLayer(layerId);

    const nodeCount = Object.keys(nodeSchemas).length;
    const relCount = Object.keys(relationshipSchemas).length;

    const layerOutput: LayerDistFile = {
      specVersion,
      layer: layerInstance,
      nodeSchemas,
      relationshipSchemas,
    };

    await writeJsonFile(path.join(DIST_DIR, `${layerId}.json`), layerOutput);
    console.log(
      `  [OK] spec/dist/${layerId}.json (${nodeCount} node types, ${relCount} relationships)`
    );

    manifest.push({
      id: layerId,
      number: layerInstance.number,
      name: layerInstance.name,
      nodeTypeCount: nodeCount,
      relationshipCount: relCount,
    });

    totalNodeTypes += nodeCount;
    totalRelationships += relCount;
  }

  // Phase 5: Write manifest.json
  const manifestOutput: ManifestDistFile = {
    specVersion,
    layers: manifest.sort((a, b) => a.number - b.number),
    totals: {
      nodeTypes: totalNodeTypes,
      relationships: totalRelationships,
    },
  };

  await writeJsonFile(path.join(DIST_DIR, "manifest.json"), manifestOutput);
  console.log(`  [OK] spec/dist/manifest.json`);

  // Phase 6: Build analyzers
  console.log("");
  console.log("Building analyzers...");
  const analyzerManifestEntries = await buildAnalyzers(baseSchemas, predicates);

  if (analyzerManifestEntries.length > 0) {
    const analyzerManifestOutput: AnalyzerManifestFile = {
      specVersion,
      analyzers: analyzerManifestEntries,
    };
    const analyzersManifestPath = path.join(DIST_DIR, "analyzers", "manifest.json");
    await writeJsonFile(analyzersManifestPath, analyzerManifestOutput);
    console.log(`  [OK] spec/dist/analyzers/manifest.json (${analyzerManifestEntries.length} analyzers)`);
  }

  console.log("");
  console.log(`Build complete: ${totalNodeTypes} node types, ${totalRelationships} relationships`);
  console.log(`Output: ${DIST_DIR}/`);

  // Optional validation
  if (validate) {
    console.log("");
    console.log("Running validation...");
    validateOutput();
  }
}

function validateOutput(): void {
  const manifestPath = path.join(DIST_DIR, "manifest.json");
  const manifest: ManifestDistFile = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  let errors = 0;

  // Check all expected layer files exist
  for (const layer of manifest.layers) {
    const layerFile = path.join(DIST_DIR, `${layer.id}.json`);
    if (!fs.existsSync(layerFile)) {
      console.error(`  [FAIL] Missing layer file: ${layer.id}.json`);
      errors++;
    } else {
      const layerData: LayerDistFile = JSON.parse(fs.readFileSync(layerFile, "utf-8"));

      // Validate nodeSchemas count matches layer.node_types (only when layer.node_types is populated)
      const nodeSchemaCount = Object.keys(layerData.nodeSchemas).length;
      const expectedNodeCount = layerData.layer.node_types.length;

      if (expectedNodeCount > 0 && nodeSchemaCount !== expectedNodeCount) {
        console.error(
          `  [FAIL] ${layer.id}: nodeSchemas has ${nodeSchemaCount} entries but layer.node_types has ${expectedNodeCount}`
        );
        errors++;
      } else if (expectedNodeCount === 0 && nodeSchemaCount > 0) {
        console.warn(
          `  [WARN] ${layer.id}: layer.node_types is empty but ${nodeSchemaCount} node schema files found (spec inconsistency)`
        );
      }

      // Verify no original $refs remain
      const layerJson = JSON.stringify(layerData.nodeSchemas);
      if (layerJson.includes("../../base/")) {
        console.error(`  [FAIL] ${layer.id}: unrewritten relative $refs found in nodeSchemas`);
        errors++;
      }

      console.log(
        `  [OK] ${layer.id}.json (${nodeSchemaCount} node types, ${Object.keys(layerData.relationshipSchemas).length} relationships)`
      );
    }
  }

  // Check base.json
  const basePath = path.join(DIST_DIR, "base.json");
  const baseData: BaseDistFile = JSON.parse(fs.readFileSync(basePath, "utf-8"));
  const baseJson = JSON.stringify(baseData.schemas);
  if (baseJson.includes("../../base/")) {
    console.error("  [FAIL] base.json: unrewritten relative $refs found");
    errors++;
  } else {
    console.log(`  [OK] base.json (${Object.keys(baseData.schemas).length} base schemas)`);
  }

  if (errors > 0) {
    console.error(`\nValidation failed: ${errors} error(s)`);
    process.exit(1);
  } else {
    console.log("\nValidation passed");
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────────

const validate = process.argv.includes("--validate");
await build(validate);
