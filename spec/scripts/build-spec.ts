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
import Ajv from "ajv";
import { default as ajvFormats } from "ajv-formats";

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

interface AttributeMapping {
  analyzer_field: string;
  dr_attribute: string;
  transform?: string;
}

interface AnalyzerNodeMapping {
  analyzer_node_type: string;
  dr_layer: "motivation" | "business" | "security" | "application" | "technology" | "api" | "data-model" | "data-store" | "ux" | "navigation" | "apm" | "testing";
  dr_node_type: string;
  confidence: "high" | "medium" | "low";
  description?: string;
  source_reference?: {
    provenance: "extracted" | "inferred";
    file?: { from: string };
    symbol?: { from: string };
  };
  attribute_mappings?: AttributeMapping[];
  conditions?: Record<string, unknown>;
}

interface UnmappedLabel {
  analyzer_node_type: string;
  reason?: string;
}

interface AnalyzerNodeMappingFile {
  version?: string;
  field_conventions?: Record<string, unknown>;
  mappings: AnalyzerNodeMapping[];
  unmapped_labels?: UnmappedLabel[];
}

interface AnalyzerEdgeMapping {
  analyzer_edge_type: string;
  dr_relationship: string | null;
  confidence: "high" | "medium" | "low";
  directionality_transform?: "invert" | "bidirectional" | "symmetric" | null;
  usage?: "verification_and_mapping" | "traversal_only";
  dr_scope?: "intra-layer" | "cross-layer" | "both";
  direction?: "forward" | "backward" | "bidirectional";
  confidence_from_property?: string;
  dr_pattern?: string;
  implementation_note?: string;
  description?: string;
  conditions?: Record<string, unknown>;
}

interface AnalyzerEdgeMappingFile {
  version?: string;
  field_conventions?: Record<string, unknown>;
  mappings: AnalyzerEdgeMapping[];
}

interface ToolContract {
  version: string;
  input_type: "codebase" | "file" | "directory" | "ast" | "semantic_graph";
  output_type: "semantic_graph" | "ast" | "csv" | "json" | "structured_output";
}

interface ProjectIdentification {
  method: "package.json" | "pyproject.toml" | "pom.xml" | "build.gradle" | "go.mod" | "cargo.toml" | "directory_structure" | "custom";
  fields?: string[];
  validation_rules?: Record<string, unknown>;
}

interface AnalyzerMetadata {
  version?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
}

interface AnalyzerSpec {
  name: string;
  display_name: string;
  mcp_server_name: string;
  supported_tool_contract: ToolContract;
  supported_languages: string[];
  project_identification: ProjectIdentification;
  description?: string;
  configuration?: Record<string, unknown>;
  metadata?: AnalyzerMetadata;
}

interface Heuristic {
  name: string;
  description: string;
  applies_to?: string[];
  rule?: string;
  conditions?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  confidence_adjustment?: number;
}

interface InferenceRule {
  name: string;
  description: string;
  pattern: string;
  confidence?: "high" | "medium" | "low";
  enabled?: boolean;
}

interface FilteringRule {
  name: string;
  description: string;
  pattern?: string;
  filter_type?: string;
  threshold?: number;
  enabled?: boolean;
}

interface DeduplicationRule {
  name: string;
  description: string;
  match_strategy?: string;
  resolution_strategy?: string;
  enabled?: boolean;
}

interface ConfidenceThreshold {
  min: number;
  max: number;
  description?: string;
}

interface ConfidenceRubric {
  high: ConfidenceThreshold;
  medium: ConfidenceThreshold;
  low: ConfidenceThreshold;
}

interface HeuristicsMetadata {
  version?: string;
  created_at?: string;
  updated_at?: string;
}

interface AnalyzerHeuristics {
  heuristics?: Heuristic[];
  inference_rules?: InferenceRule[];
  filtering_rules?: FilteringRule[];
  deduplication_rules?: DeduplicationRule[];
  confidence_rubric?: ConfidenceRubric;
  metadata?: HeuristicsMetadata;
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

// ─── JSON Schema Validation ────────────────────────────────────────────────────

/**
 * Format Ajv validation errors into a readable string
 */
function formatAjvErrors(errors: any[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "Unknown validation error";
  }
  return errors
    .map((err) => {
      const path = err.instancePath || "(root)";
      const keyword = err.keyword;
      const params = err.params;

      // Build descriptive error message based on keyword
      let message = "";
      if (keyword === "required") {
        message = `missing required fields: ${params.missingProperty}`;
      } else if (keyword === "type") {
        message = err.message || `expected type ${params.type}`;
      } else if (keyword === "enum") {
        message = `must be one of: ${params.allowedValues?.join(", ") || "unknown"}`;
      } else if (keyword === "pattern") {
        message = `does not match pattern: ${params.pattern}`;
      } else if (keyword === "additionalProperties") {
        message = `unexpected property: ${params.additionalProperty}`;
      } else {
        message = err.message || "validation failed";
      }

      return `${path}: ${message}`;
    })
    .join("; ");
}

/**
 * Create a validator for the analyzer schemas by loading actual schema files
 * Throws if any schema file is missing or malformed (called lazily to not block base schema build)
 */
function createAnalyzerValidator() {
  const ajv = new Ajv({ strict: false });
  ajvFormats(ajv);

  // Load the actual schema files from spec/schemas/base/
  const analyzerSpecSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "base", "analyzer-spec.schema.json"), "utf-8")
  );
  const analyzerNodeMappingSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "base", "analyzer-node-mapping.schema.json"), "utf-8")
  );
  const analyzerEdgeMappingSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "base", "analyzer-edge-mapping.schema.json"), "utf-8")
  );
  const analyzerHeuristicsSchema = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "base", "analyzer-heuristics.schema.json"), "utf-8")
  );

  // Compile schemas once during initialization
  const validateSpec = ajv.compile(analyzerSpecSchema);
  const validateNodeMapping = ajv.compile(analyzerNodeMappingSchema);
  const validateEdgeMapping = ajv.compile(analyzerEdgeMappingSchema);
  const validateHeuristics = ajv.compile(analyzerHeuristicsSchema);

  return {
    validateSpec: (data: unknown) => {
      const valid = validateSpec(data);
      return { valid, errors: validateSpec.errors };
    },
    validateNodeMapping: (data: unknown) => {
      const valid = validateNodeMapping(data);
      return { valid, errors: validateNodeMapping.errors };
    },
    validateEdgeMapping: (data: unknown) => {
      const valid = validateEdgeMapping(data);
      return { valid, errors: validateEdgeMapping.errors };
    },
    validateHeuristics: (data: unknown) => {
      const valid = validateHeuristics(data);
      return { valid, errors: validateHeuristics.errors };
    },
  };
}

// Validator is lazily initialized in buildAnalyzers() to avoid blocking the entire build
// if analyzer schema files are missing or malformed
let schemaValidator: ReturnType<typeof createAnalyzerValidator> | null = null;

// ─── Analyzer validation and compilation ───────────────────────────────────────

/**
 * Validate that all dr_layer values in node mappings are valid canonical layer IDs
 */
function validateDrLayers(nodeMappings: AnalyzerNodeMappingFile): string[] {
  const errors: string[] = [];
  const validLayers = new Set(LAYER_ORDER);

  for (const mapping of nodeMappings.mappings) {
    if (!validLayers.has(mapping.dr_layer)) {
      errors.push(
        `Invalid dr_layer '${mapping.dr_layer}' in analyzer_node_type '${mapping.analyzer_node_type}' — must be one of: ${Array.from(validLayers).join(", ")}`
      );
    }
  }

  return errors;
}

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
 * Load analyzer files from a directory and validate them.
 * Returns the packed analyzer artifact or null if validation fails.
 */
function loadAndValidateAnalyzer(
  analyzerDir: string,
  analyzerName: string,
  predicates: unknown
): PackedAnalyzer | null {
  const requiredFiles = [
    "analyzer.json",
    "node-mapping.json",
    "edge-mapping.json",
    "extraction-heuristics.json",
  ];

  // Check that all required files exist
  for (const name of requiredFiles) {
    const filepath = path.join(analyzerDir, name);
    if (!fs.existsSync(filepath)) {
      console.error(`[ERROR] Required file missing in analyzer '${analyzerName}': ${name}`);
      return null;
    }
  }

  // Load all files with individual error handling
  let analyzerSpec: AnalyzerSpec | null = null;
  let nodeMapping: AnalyzerNodeMappingFile | null = null;
  let edgeMapping: AnalyzerEdgeMappingFile | null = null;
  let heuristics: AnalyzerHeuristics | null = null;

  const analyzerPath = path.join(analyzerDir, "analyzer.json");
  try {
    analyzerSpec = JSON.parse(fs.readFileSync(analyzerPath, "utf-8"));
  } catch (err: any) {
    console.error(`[ERROR] Failed to parse analyzer.json in '${analyzerName}': ${err.message}`);
    return null;
  }

  const nodeMappingPath = path.join(analyzerDir, "node-mapping.json");
  try {
    nodeMapping = JSON.parse(fs.readFileSync(nodeMappingPath, "utf-8"));
  } catch (err: any) {
    console.error(`[ERROR] Failed to parse node-mapping.json in '${analyzerName}': ${err.message}`);
    return null;
  }

  const edgeMappingPath = path.join(analyzerDir, "edge-mapping.json");
  try {
    edgeMapping = JSON.parse(fs.readFileSync(edgeMappingPath, "utf-8"));
  } catch (err: any) {
    console.error(`[ERROR] Failed to parse edge-mapping.json in '${analyzerName}': ${err.message}`);
    return null;
  }

  const heuristicsPath = path.join(analyzerDir, "extraction-heuristics.json");
  try {
    heuristics = JSON.parse(fs.readFileSync(heuristicsPath, "utf-8"));
  } catch (err: any) {
    console.error(`[ERROR] Failed to parse extraction-heuristics.json in '${analyzerName}': ${err.message}`);
    return null;
  }

  // Validate each file against its schema structure
  if (!analyzerSpec) {
    console.error(`[ERROR] analyzer.json in '${analyzerName}' failed to parse`);
    return null;
  }
  const specValidation = schemaValidator!.validateSpec(analyzerSpec);
  if (!specValidation.valid) {
    console.error(`[ERROR] analyzer.json in '${analyzerName}' does not match schema: ${formatAjvErrors(specValidation.errors)}`);
    return null;
  }

  if (!nodeMapping) {
    console.error(`[ERROR] node-mapping.json in '${analyzerName}' failed to parse`);
    return null;
  }
  const nodeMappingValidation = schemaValidator!.validateNodeMapping(nodeMapping);
  if (!nodeMappingValidation.valid) {
    console.error(`[ERROR] node-mapping.json in '${analyzerName}' does not match schema: ${formatAjvErrors(nodeMappingValidation.errors)}`);
    return null;
  }

  if (!edgeMapping) {
    console.error(`[ERROR] edge-mapping.json in '${analyzerName}' failed to parse`);
    return null;
  }
  const edgeMappingValidation = schemaValidator!.validateEdgeMapping(edgeMapping);
  if (!edgeMappingValidation.valid) {
    console.error(`[ERROR] edge-mapping.json in '${analyzerName}' does not match schema: ${formatAjvErrors(edgeMappingValidation.errors)}`);
    return null;
  }

  if (!heuristics) {
    console.error(`[ERROR] extraction-heuristics.json in '${analyzerName}' failed to parse`);
    return null;
  }
  const heuristicsValidation = schemaValidator!.validateHeuristics(heuristics);
  if (!heuristicsValidation.valid) {
    console.error(`[ERROR] extraction-heuristics.json in '${analyzerName}' does not match schema: ${formatAjvErrors(heuristicsValidation.errors)}`);
    return null;
  }

  // Validate dr_layer values are valid canonical layer IDs
  const layerErrors = validateDrLayers(nodeMapping);
  if (layerErrors.length > 0) {
    console.error(`[ERROR] Invalid dr_layer values in '${analyzerName}':`);
    layerErrors.forEach((err) => console.error(`  ${err}`));
    return null;
  }

  // Validate dr_relationship values against predicates
  const relationshipErrors = validateDrRelationships(edgeMapping, predicates);
  if (relationshipErrors.length > 0) {
    console.error(`[ERROR] Invalid dr_relationship values in '${analyzerName}':`);
    relationshipErrors.forEach((err) => console.error(`  ${err}`));
    return null;
  }

  // Get version from analyzer.json metadata — must be present and valid
  let version: string | null = null;
  if (analyzerSpec.metadata && typeof analyzerSpec.metadata === "object") {
    const metadata = analyzerSpec.metadata as AnalyzerMetadata;
    if (metadata.version && typeof metadata.version === "string") {
      version = metadata.version;
    }
  }

  if (!version) {
    console.error(`[ERROR] analyzer '${analyzerName}' is missing metadata.version — must be a non-empty string`);
    return null;
  }

  // Build nodes_by_label index and detect duplicates (including case-collisions)
  const nodesByLabel: Record<string, AnalyzerNodeMapping> = {};
  const labelLookup = new Map<string, string>(); // Maps lowercase label to original label for collision detection
  const duplicateLabels: Array<{ new: string; existing: string }> = [];

  for (const mapping of nodeMapping.mappings) {
    // Capitalize first letter only (e.g., "test_node" → "Test_node", not "TestNode")
    const labelKey = mapping.analyzer_node_type.charAt(0).toUpperCase() + mapping.analyzer_node_type.slice(1);
    const lowerLabel = labelKey.toLowerCase();

    if (labelLookup.has(lowerLabel)) {
      const existingLabel = labelLookup.get(lowerLabel)!;
      duplicateLabels.push({ new: labelKey, existing: existingLabel });
    } else {
      nodesByLabel[labelKey] = mapping;
      labelLookup.set(lowerLabel, labelKey);
    }
  }

  if (duplicateLabels.length > 0) {
    console.error(`[ERROR] analyzer '${analyzerName}' has duplicate/case-collision node labels:`);
    duplicateLabels.forEach(({ new: newLabel, existing }) => {
      console.error(`  '${newLabel}' conflicts with existing '${existing}'`);
    });
    return null;
  }

  // Build edges_by_type index and detect duplicates
  const edgesByType: Record<string, AnalyzerEdgeMapping> = {};
  const duplicateEdges: string[] = [];

  for (const mapping of edgeMapping.mappings) {
    if (edgesByType.hasOwnProperty(mapping.analyzer_edge_type)) {
      duplicateEdges.push(mapping.analyzer_edge_type);
    } else {
      edgesByType[mapping.analyzer_edge_type] = mapping;
    }
  }

  if (duplicateEdges.length > 0) {
    console.error(`[ERROR] analyzer '${analyzerName}' has duplicate edge types:`);
    duplicateEdges.forEach((edgeType) => {
      console.error(`  '${edgeType}'`);
    });
    return null;
  }

  // Build packed analyzer artifact
  const packed: PackedAnalyzer = {
    name: analyzerSpec.name,
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
async function buildAnalyzers(predicates: unknown): Promise<AnalyzerManifestEntry[]> {
  const analyzersRootDir = path.join(SPEC_DIR, "analyzers");

  if (!fs.existsSync(analyzersRootDir)) {
    console.log("  No analyzers directory found — skipping analyzer build");
    return [];
  }

  // Lazily initialize schema validator — only when analyzer build is actually needed
  // This way, if analyzer schema files are missing, it doesn't block the entire build
  if (!schemaValidator) {
    try {
      schemaValidator = createAnalyzerValidator();
    } catch (err: any) {
      console.error(`[ERROR] Failed to initialize analyzer schema validator: ${err.message}`);
      process.exit(1);
    }
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
    const packed = loadAndValidateAnalyzer(analyzerDir, analyzerName, predicates);

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
  const analyzerManifestEntries = await buildAnalyzers(predicates);

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
