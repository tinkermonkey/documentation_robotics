import { Layer } from "./layer.js";
import { Manifest } from "./manifest.js";
import { Element } from "./element.js";
import { GraphModel, type GraphEdge } from "./graph-model.js";
import { VirtualProjectionEngine } from "./virtual-projection.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import { Relationships } from "./relationships.js";
import { CANONICAL_LAYER_NAMES } from "./layers.js";
import type { StagedChange } from "./changeset.js";
import { ensureDir, writeFile } from "../utils/file-io.js";
import { getCliVersion } from "../utils/spec-version.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getNodeType } from "../generated/node-types.js";
import type { SpecNodeId } from "../generated/node-types.js";
import type { ManifestData, ModelOptions } from "../types/index.js";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

/**
 * Derive a deterministic UUID from a path string using SHA-256.
 * Produces a stable UUID4-like value so migration doesn't regenerate UUIDs on every load.
 */
function deterministicUUID(path: string): string {
  const hash = crypto.createHash("sha256").update(path).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16), // version 4 marker
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.slice(18, 20), // variant
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Convert a PascalCase title to snake_case.
 * Handles acronyms correctly: "UXApplication" → "ux_application", "OpenAPIDocument" → "open_api_document".
 */
function titleToSnakeCase(title: string): string {
  return title
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2") // "APIDoc" → "API_Doc"
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")       // "appComponent" → "app_Component"
    .toLowerCase();
}

/**
 * Derive a snake_case file stem for a given element type.
 * Uses the spec node title for accurate word boundaries (e.g., "InputSpacePartition" → "input_space_partition").
 * Falls back to the raw type string when the title is unavailable.
 */
function typeToSnakeStem(specNodeId: string | undefined, type: string): string {
  if (specNodeId) {
    const nodeType = getNodeType(specNodeId as SpecNodeId);
    if (nodeType?.title) {
      return titleToSnakeCase(nodeType.title);
    }
  }
  return type;
}

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

/**
 * Model class representing the complete architecture model
 * Uses GraphModel internally for graph-based storage
 */
export class Model {
  rootPath: string;
  manifest: Manifest;
  graph: GraphModel;
  layers: Map<string, Layer>;
  relationships: Relationships;
  lazyLoad: boolean;
  private loadedLayers: Set<string>;
  private virtualProjectionEngine?: VirtualProjectionEngine;
  /** ID of the currently active changeset, or null if none is active. Set during load(). */
  private _activeChangesetId: string | null = null;
  /** Layer names that exist only in staged changes (not yet committed to base model). */
  private _stagedLayerNames: Set<string> = new Set();

  constructor(rootPath: string, manifest: Manifest, options: ModelOptions = {}) {
    this.rootPath = rootPath;
    this.manifest = manifest;
    this.graph = new GraphModel();
    this.layers = new Map();
    this.relationships = new Relationships();
    this.lazyLoad = options.lazyLoad ?? false;
    this.loadedLayers = new Set();
  }

  /**
   * Get the committed base layer (no staging projection).
   * Used internally by VirtualProjectionEngine and commit() to access the raw base model
   * without triggering infinite recursion or double-projection.
   */
  async getBaseLayer(name: string): Promise<Layer | undefined> {
    if (this.lazyLoad && !this.loadedLayers.has(name)) {
      await this.loadLayer(name);
    }
    return this.layers.get(name);
  }

  /**
   * Get a layer, transparently merging staged changes when an active changeset exists.
   * Falls back to the committed base layer if no changeset is active or projection fails.
   */
  async getLayer(name: string): Promise<Layer | undefined> {
    if (this.lazyLoad && !this.loadedLayers.has(name)) {
      await this.loadLayer(name);
    }

    // If an active changeset is present, return a projected (base + staged) layer
    if (this._activeChangesetId) {
      try {
        return await this.getVirtualProjectionEngine().projectLayer(
          this,
          this._activeChangesetId,
          name
        );
      } catch {
        // Fall back to base layer on projection failure (e.g. corrupt changeset)
        return this.layers.get(name);
      }
    }

    return this.layers.get(name);
  }

  /**
   * Get an element by ID across all layers
   * Supports both UUID and semantic ID (layer.type.kebab-name) lookup
   */
  getElementById(id: string): Element | undefined {
    for (const layer of this.layers.values()) {
      const element = layer.getElement(id);
      if (element) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Get virtual projection engine (lazily initialized)
   */
  getVirtualProjectionEngine(): VirtualProjectionEngine {
    if (!this.virtualProjectionEngine) {
      this.virtualProjectionEngine = new VirtualProjectionEngine(this.rootPath);
    }
    return this.virtualProjectionEngine;
  }

  /**
   * Load a layer from disk (model/XX_layername/*.yaml files)
   */
  async loadLayer(name: string): Promise<void> {
    const layerSpan = isTelemetryEnabled
      ? startSpan("layer.load", {
          "layer.name": name,
        })
      : null;

    try {
      const fs = await import("fs/promises");
      const yaml = await import("yaml");

      let layerPath: string | null = null;

      // Auto-discover by scanning directory with naming convention
      const modelDir = `${this.rootPath}/documentation-robotics/model`;

      try {
        const entries = await fs.readdir(modelDir, { withFileTypes: true });
        const layerDir = entries.find(
          (e) =>
            e.isDirectory() && e.name.match(/^\d{2}_/) && e.name.replace(/^\d{2}_/, "") === name
        );

        if (layerDir) {
          layerPath = `${modelDir}/${layerDir.name}`;
        }
      } catch {
        // Model directory doesn't exist or can't be read
      }

      if (!layerPath) {
        return; // Layer directory not found
      }

      const layer = new Layer(name, this.graph);
      let parseErrorCount = 0;

      // Load all YAML files in the layer directory
      const files = await fs.readdir(layerPath);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const filePath = `${layerPath}/${file}`;
          try {
            const yamlContent = await fs.readFile(filePath, "utf-8");
            const elements = yaml.parse(yamlContent);

            // Add each element from the YAML file
            if (elements && typeof elements === "object") {
              for (const [key, element] of Object.entries(elements)) {
                if (element && typeof element === "object") {
                  const el: any = element;

                  // Derive id, path, and type using the 3-case migration logic:
                  // Case 1: element already has both id (UUID) and path → use as-is
                  // Case 2: element.id looks like a slug (layer.type.name) → move to path, generate UUID
                  // Case 3: element has UUID id but no path → derive path from layer_id.type.kebab(name)
                  const isSlugPattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(el.id || "");
                  const isUUIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(el.id || "");

                  let elementId: string;
                  let elementPath: string;
                  let extractedType: string | undefined = undefined;

                  if (el.path && isUUIDPattern) {
                    // Case 1: already has both path and UUID id
                    elementId = el.id;
                    elementPath = el.path;
                    const pathParts = el.path.split(".");
                    if (pathParts.length >= 3) extractedType = pathParts[1];
                  } else if (el.path && !isUUIDPattern) {
                    // Has a path but id is not a UUID — migrate id to deterministic UUID
                    elementPath = el.path;
                    elementId = deterministicUUID(el.path);
                    const pathParts = el.path.split(".");
                    if (pathParts.length >= 3) extractedType = pathParts[1];
                  } else if (isSlugPattern) {
                    // Case 2: slug-looking id → move to path, generate deterministic UUID
                    elementPath = el.id;
                    elementId = deterministicUUID(el.id);
                    const parts = el.id.split(".");
                    if (parts.length >= 3) extractedType = parts[1];
                  } else if (isUUIDPattern) {
                    // Case 3: UUID id, no path → derive path
                    elementId = el.id;
                    const layerId = el.layer_id || name;
                    const rawType = el.type || "";
                    const rawName = el.name || key;
                    const kebabName = rawName.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
                    elementPath = `${layerId}.${rawType}.${kebabName}`;
                    extractedType = rawType || undefined;
                  } else {
                    // Fallback: derive a path from available data, generate deterministic UUID
                    const layerId = el.layer_id || name;
                    const rawType = el.type || (typeof el.id === "string" && el.id.includes(".") ? el.id.split(".")[1] : "") || "";
                    const rawName = el.name || key;
                    const kebabName = rawName.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
                    elementPath = `${layerId}.${rawType || "element"}.${kebabName}`;
                    elementId = deterministicUUID(elementPath);
                    if (rawType) extractedType = rawType;
                    else if (typeof el.id === "string" && el.id.includes(".")) {
                      const parts = el.id.split(".");
                      if (parts.length >= 3) extractedType = parts[1];
                    }
                  }

                  const elementName = el.name || key;
                  const elementType = el.type || extractedType;
                  const layerId = el.layer_id || name;

                  const newElement = new Element({
                    id: elementId,
                    path: elementPath,
                    spec_node_id: el.spec_node_id,
                    layer_id: layerId,
                    attributes: el.attributes,
                    source_reference: el.source_reference,
                    metadata: el.metadata,
                    name: elementName,
                    type: elementType,
                    description: el.description || "",
                    relationships: el.relationships || [],
                    references: el.references || [],
                    layer: layerId,
                  } as any);
                  layer.addElement(newElement);
                }
              }
            }
          } catch (fileError) {
            // Log YAML parsing errors but continue loading other files
            const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
            console.error(`Warning: Failed to parse ${filePath}: ${errorMsg}`);
            parseErrorCount++;
            // Continue with next file
          }
        }
      }

      // If we had parse errors, add a note to the layer
      if (parseErrorCount > 0) {
        console.error(
          `Warning: Layer '${name}' loaded with ${parseErrorCount} YAML parse error(s)`
        );
      }

      this.layers.set(name, layer);
      this.loadedLayers.add(name);

      if (isTelemetryEnabled && layerSpan) {
        layerSpan.setAttribute("layer.element_count", layer.elements.size);
      }
    } finally {
      if (isTelemetryEnabled) {
        endSpan(layerSpan);
      }
    }
  }

  /**
   * Add a layer to the model
   */
  addLayer(layer: Layer): void {
    // If the layer has elements in its isolated graph, migrate them to the model's graph
    if (layer.graph.getNodeCount() > 0) {
      for (const node of layer.graph.nodes.values()) {
        this.graph.addNode(node);
      }
      for (const edge of layer.graph.edges.values()) {
        this.graph.addEdge(edge);
      }
    }
    // Ensure layer uses the model's graph for future operations
    layer.graph = this.graph;
    this.layers.set(layer.name, layer);
    this.loadedLayers.add(layer.name);
  }

  /**
   * Get all layer names, including layers that exist only in staged changes.
   * When an active changeset introduces elements for a layer with no committed data,
   * that layer name is included so findElementLayer() and other callers can discover it.
   */
  getLayerNames(): string[] {
    const base = Array.from(this.layers.keys());
    if (this._stagedLayerNames.size === 0) {
      return base;
    }
    // Include staged-only layers (layers that have staged elements but no committed elements)
    const staged = Array.from(this._stagedLayerNames).filter((l) => !this.layers.has(l));
    return [...base, ...staged];
  }

  /**
   * Save a layer to disk (model/XX_layername/*.yaml)
   */
  async saveLayer(name: string): Promise<void> {
    const layer = this.layers.get(name);
    if (!layer) {
      throw new Error(`Layer ${name} not found`);
    }

    const fs = await import("fs/promises");
    const yaml = await import("yaml");

    let layerPath: string | null = null;

    // Discover by scanning directory
    const modelDir = `${this.rootPath}/documentation-robotics/model`;

    try {
      const entries = await fs.readdir(modelDir, { withFileTypes: true });
      const layerDir = entries.find(
        (e) =>
          e.isDirectory() && e.name.match(/^\d{2}_/) && e.name.replace(/^\d{2}_/, "") === name
      );

      if (layerDir) {
        layerPath = `${modelDir}/${layerDir.name}`;
      }
    } catch {
      // Model directory doesn't exist or can't be read
    }

    // If still not found, create using default format
    if (!layerPath) {
      // Find the order number for this layer
      // Handle layer names with or without numeric prefix (e.g., "motivation" or "01-motivation")
      const layerNameWithoutPrefix = name.replace(/^\d{2}-/, "");
      const index = CANONICAL_LAYER_NAMES.indexOf(layerNameWithoutPrefix as typeof CANONICAL_LAYER_NAMES[number]);
      if (index >= 0) {
        const orderNum = String(index + 1).padStart(2, "0");
        layerPath = `${this.rootPath}/documentation-robotics/model/${orderNum}_${layerNameWithoutPrefix}`;
        await ensureDir(layerPath);
      } else {
        throw new Error(`Unknown layer ${name} and no path configured in manifest`);
      }
    }

    // Delete all existing YAML files in the layer directory to ensure
    // we don't keep stale files after element deletion
    try {
      const existingFiles = await fs.readdir(layerPath);
      for (const file of existingFiles) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          await fs.unlink(`${layerPath}/${file}`);
        }
      }
    } catch (err) {
      // Only ignore "directory not found" errors — re-throw permission/I/O errors
      const isNotFoundError = (err as any)?.code === "ENOENT";
      if (!isNotFoundError) {
        throw new Error(
          `Failed to clean existing YAML files: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Group elements by type, computing the snake_case file stem from the spec node title
    const elementsByType = new Map<string, { stem: string; elements: Element[] }>();
    for (const element of layer.elements.values()) {
      const typeKey = element.type;
      if (!elementsByType.has(typeKey)) {
        const stem = typeToSnakeStem(element.spec_node_id, element.type);
        elementsByType.set(typeKey, { stem, elements: [] });
      }
      elementsByType.get(typeKey)!.elements.push(element);
    }

    // Internal graph fields — never written to YAML
    const INTERNAL_FIELDS = new Set([
      "__references__", "__relationships__",
      "source", "x-source-reference",
    ]);

    // Write each type to its own YAML file
    for (const [, { stem, elements }] of elementsByType) {
      const filename = `${stem}.yaml`;
      const filePath = `${layerPath}/${filename}`;

      // Convert elements to spec-node format YAML
      const yamlData: any = {};
      for (const element of elements) {
        const json = element.toJSON();

        // Clean attributes: remove graph-internal keys that should not be persisted
        const cleanAttrs = json.attributes
          ? Object.fromEntries(
              Object.entries(json.attributes).filter(([k]) => !INTERNAL_FIELDS.has(k))
            )
          : undefined;

        // Use path as YAML key (human-readable); fall back to id for elements without path
        const key = element.path || element.id;
        yamlData[key] = {
          id: json.id,
          path: json.path,
          spec_node_id: json.spec_node_id,
          type: json.type,
          layer_id: json.layer_id,
          name: json.name,
          ...(json.description && { description: json.description }),
          ...(cleanAttrs && Object.keys(cleanAttrs).length > 0 && { attributes: cleanAttrs }),
          ...(json.source_reference && { source_reference: json.source_reference }),
          ...(json.metadata && { metadata: json.metadata }),
          ...(json.references && json.references.length > 0 && { references: json.references }),
          // Relationships are now stored in centralized relationships.yaml, not inline
        };
      }

      await writeFile(filePath, yaml.stringify(yamlData));
    }

    layer.markClean();
  }

  /**
   * Save model (saves all dirty layers and manifest)
   */
  async save(): Promise<void> {
    await this.saveDirtyLayers();
    await this.saveManifest();
  }

  /**
   * Save all dirty layers to disk
   */
  async saveDirtyLayers(): Promise<void> {
    // Count dirty layers before operation
    let dirtyLayerCount = 0;
    for (const layer of this.layers.values()) {
      if (layer.isDirty()) {
        dirtyLayerCount++;
      }
    }

    const span = isTelemetryEnabled
      ? startSpan("model.save", {
          "model.path": this.rootPath,
          "model.dirty_layer_count": dirtyLayerCount,
        })
      : null;

    try {
      for (const layer of this.layers.values()) {
        if (layer.isDirty()) {
          await this.saveLayer(layer.name);
        }
      }
    } finally {
      if (isTelemetryEnabled) {
        endSpan(span);
      }
    }
  }

  /**
   * Save the manifest to disk (documentation-robotics/model/manifest.yaml)
   */
  async saveManifest(): Promise<void> {
    this.manifest.updateModified();
    const yaml = await import("yaml");
    const manifestPath = `${this.rootPath}/documentation-robotics/model/manifest.yaml`;

    // Convert to YAML format
    const yamlData: any = {
      version: this.manifest.version,
      schema: "documentation-robotics-v1",
      cli_version: getCliVersion(),
      spec_version: this.manifest.specVersion,
      created: this.manifest.created,
      updated: this.manifest.modified,
      project: {
        name: this.manifest.name,
        description: this.manifest.description,
        version: this.manifest.version,
      },
      documentation: ".dr/README.md",
      layers: {},
    };

    // Generate layer structure from current model state
    const layerOrder = [
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

    for (let i = 0; i < layerOrder.length; i++) {
      const layerName = layerOrder[i];
      const layer = this.layers.get(layerName);
      const orderNum = String(i + 1).padStart(2, "0");

      yamlData.layers[layerName] = {
        order: i + 1,
        name: layerName.charAt(0).toUpperCase() + layerName.slice(1).replace("-", " "),
        path: `documentation-robotics/model/${orderNum}_${layerName}/`,
        enabled: true,
        ...(layer && { elements: this.getLayerElementCounts(layer) }),
      };
    }

    if (this.manifest.changeset_history && this.manifest.changeset_history.length > 0) {
      yamlData.changeset_history = this.manifest.changeset_history;
    }

    await ensureDir(`${this.rootPath}/documentation-robotics/model`);
    await writeFile(manifestPath, yaml.stringify(yamlData));
  }

  private getLayerElementCounts(layer: Layer): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const element of layer.elements.values()) {
      counts[element.type] = (counts[element.type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Load relationships from relationships.yaml
   */
  async loadRelationships(): Promise<void> {
    const fs = await import("fs/promises");
    const yaml = await import("yaml");
    const relationshipsPath = `${this.rootPath}/documentation-robotics/model/relationships.yaml`;

    let data: any;
    try {
      const yamlContent = await fs.readFile(relationshipsPath, "utf-8");
      data = yaml.parse(yamlContent);
    } catch (err) {
      // If file doesn't exist, that's okay - start with empty relationships
      if ((err as any).code !== "ENOENT") {
        // But if it's a different error (YAML parse, permission denied, etc), throw it
        // so the caller knows about the issue
        throw new Error(
          `Failed to load relationships.yaml: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // ENOENT: file doesn't exist, return with empty relationships
      return;
    }

    // Validate that parsed content is an array
    if (!Array.isArray(data)) {
      const typeLabel = data === null ? "null" : typeof data;
      console.warn(
        `Warning: relationships.yaml contains non-array content (received ${typeLabel}). Expected an array of relationships. Skipping relationship loading.`
      );
      return;
    }

    this.relationships = Relationships.fromArray(data);
    // Sync relationships to graph
    // Note: addEdge may throw if graph nodes don't exist, but we log a warning
    // and continue since it can occur during partial model construction
    for (let i = 0; i < data.length; i++) {
      const rel = data[i];
      const edge: GraphEdge = {
        id: `rel-${i}-${crypto.randomBytes(4).toString("hex")}`,
        source: rel.source,
        destination: rel.target,
        predicate: rel.predicate,
        properties: rel.properties,
        category: rel.category,
      };
      try {
        this.graph.addEdge(edge);
      } catch (err) {
        // Graph validation errors (e.g., node doesn't exist) are logged but not fatal
        // This can happen during partial model construction
        console.warn(
          `Warning: Failed to sync relationship to graph (source: ${rel.source}, target: ${rel.target}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /**
   * Save relationships to relationships.yaml
   */
  async saveRelationships(): Promise<void> {
    const fs = await import("fs/promises");
    const yaml = await import("yaml");
    const relationshipsPath = `${this.rootPath}/documentation-robotics/model/relationships.yaml`;

    await ensureDir(`${this.rootPath}/documentation-robotics/model`);

    const data = this.relationships.toArray();

    // Add header comment with timestamp to ensure file always changes
    const timestamp = new Date().toISOString();
    const header = `# Intra-layer relationships
# Format: source_id -> predicate -> target_id
# Last updated: ${timestamp}

`;
    const yamlContent = header + yaml.stringify(data);

    await fs.writeFile(relationshipsPath, yamlContent, "utf-8");
    this.relationships.markClean();
  }

  /**
   * Resolve model paths (private helper)
   *
   * @param startPath - Starting path for search
   * @returns Project root and manifest path
   */
  private static async resolveModelPaths(startPath?: string): Promise<{
    projectRoot: string;
    manifestPath: string;
  }> {
    const searchPath = startPath || process.cwd();

    // Optional override via env var (highest priority)
    if (process.env.DR_MODEL_PATH) {
      const envPath = path.resolve(process.env.DR_MODEL_PATH);
      let manifestPath: string;

      if (envPath.endsWith("manifest.yaml")) {
        manifestPath = envPath;
      } else if (envPath.endsWith("model")) {
        manifestPath = path.join(envPath, "manifest.yaml");
      } else {
        manifestPath = path.join(envPath, "documentation-robotics", "model", "manifest.yaml");
      }

      try {
        await fs.access(manifestPath);
        const projectRoot = path.dirname(path.dirname(path.dirname(manifestPath)));
        return { projectRoot, manifestPath: path.normalize(manifestPath) };
      } catch {
        throw new Error(`Model not found at DR_MODEL_PATH: ${process.env.DR_MODEL_PATH}`);
      }
    }

    // Use findProjectRoot to locate documentation_robotics/ folder
    const projectRoot = await findProjectRoot(searchPath);

    if (!projectRoot) {
      throw new Error(
        "No DR project found. Could not find documentation_robotics/ folder.\n" +
          'Run "dr init" to create a new project, or navigate to a directory containing a DR project.'
      );
    }

    const manifestPath = path.join(projectRoot, "documentation-robotics", "model", "manifest.yaml");

    try {
      await fs.access(manifestPath);
      return { projectRoot, manifestPath };
    } catch {
      throw new Error(
        `Found documentation_robotics/ at ${projectRoot} but no model found. ` +
          `Expected: ${manifestPath}\n` +
          `Run "dr init" to create a model.`
      );
    }
  }

  /**
   * Load a model from disk
   *
   * Expected structure:
   * <project-root>/
   * └── documentation_robotics/
   *     └── model/
   *         └── manifest.yaml
   *
   * @param startPath - Starting path for project search (defaults to process.cwd())
   * @param options - Model loading options
   * @returns Loaded Model instance
   */
  static async load(startPath?: string, options: ModelOptions = {}): Promise<Model> {
    const span = isTelemetryEnabled
      ? startSpan("model.load", {
          "model.path": startPath || process.cwd(),
          "model.type": "dr",
        })
      : null;

    try {
      // Resolve project root and manifest path
      const { projectRoot, manifestPath } = await Model.resolveModelPaths(startPath);

      const yaml = await import("yaml");

      // Load manifest from resolved path
      const yamlContent = await fs.readFile(manifestPath, "utf-8");
      const manifestYaml = yaml.parse(yamlContent);

      // Convert manifest to internal format
      const manifestData: any = {
        name: manifestYaml.project?.name || "Unnamed Model",
        description: manifestYaml.project?.description || "",
        version: manifestYaml.project?.version || manifestYaml.version || "0.1.0",
        specVersion: manifestYaml.spec_version || "0.6.0",
        created: manifestYaml.created || new Date().toISOString(),
        modified: manifestYaml.updated || new Date().toISOString(),
      };
      const manifest = new Manifest(manifestData);
      const model = new Model(projectRoot, manifest, options);

      // Load all available layers if lazyLoad is false
      if (!options.lazyLoad) {
        try {
          // If manifest has layer definitions, use those
          if (manifestYaml.layers) {
            for (const layerName of Object.keys(manifestYaml.layers)) {
              const layerConfig = manifestYaml.layers[layerName];
              if (layerConfig.enabled !== false) {
                await model.loadLayer(layerName);
              }
            }
          } else {
            // Otherwise scan for layer directories
            const modelDir = manifestPath.replace("/manifest.yaml", "");
            const entries = await fs.readdir(modelDir, { withFileTypes: true });

            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.match(/^\d{2}_/)) {
                const layerName = entry.name.replace(/^\d{2}_/, "");
                await model.loadLayer(layerName);
              }
            }
          }
        } catch (e) {
          // Check if this is a "directory not found" error (expected case)
          const isNotFoundError = (e as any)?.code === "ENOENT";
          if (!isNotFoundError) {
            // Re-throw non-ENOENT errors: permission errors, YAML parsing failures, I/O errors, etc.
            throw new Error(
              `Failed to load layers: ${e instanceof Error ? e.message : String(e)}`
            );
          }
          // ENOENT is expected if layer directory doesn't exist yet, so just continue
        }
      }

      // Load relationships from relationships.yaml
      await model.loadRelationships();

      // Check for active changeset and pre-load staged metadata for transparent projection.
      // This enables getLayer() to return projected views and getLayerNames() to include
      // layers that exist only in staged changes.
      const activePath = path.join(
        projectRoot,
        "documentation-robotics",
        "changesets",
        ".active"
      );
      try {
        const activeContent = await fs.readFile(activePath, "utf-8");
        const activeId = activeContent.trim();
        if (activeId) {
          model._activeChangesetId = activeId;
          const storage = new StagedChangesetStorage(projectRoot);
          const changeset = await storage.load(activeId);
          if (changeset) {
            for (const change of changeset.changes as StagedChange[]) {
              // Track layer names for getLayerNames()
              if (
                change.type === "add" ||
                change.type === "update" ||
                change.type === "delete"
              ) {
                model._stagedLayerNames.add(change.layerName);
              }

              // Inject staged relationship-adds into model.relationships so that
              // read commands (list, show, export) transparently see staged relationships.
              if (change.type === "relationship-add" && change.after) {
                const rel = change.after as {
                  source: string;
                  target: string;
                  predicate: string;
                  layer: string;
                  targetLayer?: string;
                  category?: "structural" | "behavioral";
                  properties?: Record<string, unknown>;
                };
                model.relationships.add({
                  source: rel.source,
                  target: rel.target,
                  predicate: rel.predicate,
                  layer: rel.layer,
                  ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
                  category: rel.category ?? "structural",
                  ...(rel.properties ? { properties: rel.properties } : {}),
                });
              }

              // Remove staged relationship-deletes from model.relationships so that
              // read commands see the relationship as already deleted.
              if (change.type === "relationship-delete" && change.before) {
                const rel = change.before as {
                  source: string;
                  target: string;
                  predicate?: string;
                };
                model.relationships.delete(rel.source, rel.target, rel.predicate);
              }
            }
          }
        }
      } catch {
        // No active changeset or unreadable — proceed with base model only
        model._activeChangesetId = null;
      }

      // Count total entities across all layers
      let entityCount = 0;
      for (const layer of model.layers.values()) {
        entityCount += layer.elements.size;
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute("model.entity_count", entityCount);
        span.setAttribute("model.layer_count", model.layers.size);
      }

      return model;
    } finally {
      if (isTelemetryEnabled) {
        endSpan(span);
      }
    }
  }

  /**
   * Initialize a new model in a directory
   */
  static async init(
    rootPath: string,
    manifestData: ManifestData,
    options: ModelOptions = {}
  ): Promise<Model> {
    // Create model directory structure
    await ensureDir(`${rootPath}/documentation-robotics/model`);

    for (let i = 0; i < CANONICAL_LAYER_NAMES.length; i++) {
      const orderNum = String(i + 1).padStart(2, "0");
      const layerName = CANONICAL_LAYER_NAMES[i];
      await ensureDir(`${rootPath}/documentation-robotics/model/${orderNum}_${layerName}`);
    }

    const manifest = new Manifest(manifestData);
    const model = new Model(rootPath, manifest, options);

    await model.saveManifest();

    return model;
  }

  /**
   * Graph-based API methods for querying the model
   * These methods delegate to the underlying GraphModel for efficient queries
   */

  /**
   * Get a node by its UUID
   */
  getNode(id: string) {
    return this.graph.getNode(id);
  }

  /**
   * Get all nodes in a specific layer
   */
  getNodesByLayer(layerId: string) {
    return this.graph.getNodesByLayer(layerId);
  }

  /**
   * Get all nodes of a specific type
   */
  getNodesByType(type: string) {
    return this.graph.getNodesByType(type);
  }

  /**
   * Get all edges (relationships) in the model
   */
  getAllEdges() {
    return this.graph.getAllEdges();
  }

  /**
   * Get edges originating from a specific node
   */
  getEdgesFrom(nodeId: string, predicate?: string) {
    return this.graph.getEdgesFrom(nodeId, predicate);
  }

  /**
   * Get edges terminating at a specific node
   */
  getEdgesTo(nodeId: string, predicate?: string) {
    return this.graph.getEdgesTo(nodeId, predicate);
  }

  /**
   * Get edges between two specific nodes
   */
  getEdgesBetween(sourceId: string, destinationId: string, predicate?: string) {
    return this.graph.getEdgesBetween(sourceId, destinationId, predicate);
  }

  /**
   * Traverse the graph starting from a node, following a specific predicate
   */
  async traverse(startNodeId: string, predicate: string, maxDepth: number = 10) {
    return this.graph.traverse(startNodeId, predicate, maxDepth);
  }

  /**
   * Create a backup of the current model state
   * Used for rollback support in migration operations
   *
   * @param label Descriptive label for the backup (e.g., "pre-migration")
   * @returns Path to the backup directory
   */
  async createBackup(label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(this.rootPath, ".dr-backups", `${label}-${timestamp}`);

    // Create backup directory
    await ensureDir(backupDir);

    // Backup layers directory
    const layersSource = path.join(this.rootPath, "documentation-robotics", "model");
    const layersBackup = path.join(backupDir, "layers");
    if (await this.directoryExists(layersSource)) {
      await this.copyDirectory(layersSource, layersBackup);
    }

    // Backup manifest
    const manifestSource = path.join(this.rootPath, "documentation-robotics", "model", "manifest.yaml");
    const manifestBackup = path.join(backupDir, "manifest.yaml");
    if (await this.fileExists(manifestSource)) {
      await fs.copyFile(manifestSource, manifestBackup);
    }

    return backupDir;
  }

  /**
   * Restore model from a backup directory
   * Used for rollback after failed migrations
   *
   * @param backupPath Path to the backup directory
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    // Restore layers
    const layersBackup = path.join(backupPath, "layers");
    const layersTarget = path.join(this.rootPath, "documentation-robotics", "model");
    if (await this.directoryExists(layersBackup)) {
      await this.copyDirectory(layersBackup, layersTarget);
    }

    // Restore manifest
    const manifestBackup = path.join(backupPath, "manifest.yaml");
    const manifestTarget = path.join(this.rootPath, "documentation-robotics", "model", "manifest.yaml");
    if (await this.fileExists(manifestBackup)) {
      await fs.copyFile(manifestBackup, manifestTarget);
    }

    // Reload model to refresh in-memory state
    const reloadedModel = await Model.load(this.rootPath, { lazyLoad: this.lazyLoad });
    this.layers = reloadedModel.layers;
    this.manifest = reloadedModel.manifest;
    this.graph = reloadedModel.graph;
    this.relationships = reloadedModel.relationships;
  }

  /**
   * Save dirty layers with atomic write semantics
   * Writes to temporary file first, then renames on success to ensure data safety
   *
   * @throws Error if atomic write fails
   */
  async saveDirtyLayersAtomic(): Promise<void> {
    // First, save all layers to temporary files
    const tempLayerWrites: Array<{ layer: Layer; tempPath: string }> = [];

    try {
      for (const layer of this.layers.values()) {
        if (layer.isDirty()) {
          const layerPath = path.join(
            this.rootPath,
            "documentation-robotics",
            "model",
            `${layer.name}_layer`
          );

          const tempPath = `${layerPath}.tmp`;
          await ensureDir(tempPath);

          // Write layer elements to temp directory
          for (const element of layer.elements.values()) {
            const elementPath = path.join(tempPath, `${element.path || element.id}.json`);
            const content = JSON.stringify(element.toJSON(), null, 2);
            await writeFile(elementPath, content);
          }

          tempLayerWrites.push({ layer, tempPath });
        }
      }

      // All temp writes succeeded, now commit by renaming
      for (const { layer, tempPath } of tempLayerWrites) {
        const layerPath = path.join(
          this.rootPath,
          "documentation-robotics",
          "model",
          `${layer.name}_layer`
        );

        // Remove old directory and rename temp to actual
        if (await this.directoryExists(layerPath)) {
          await fs.rm(layerPath, { recursive: true, force: true });
        }
        await fs.rename(tempPath, layerPath);
      }
    } catch (error) {
      // Cleanup any temp directories on failure
      for (const { tempPath } of tempLayerWrites) {
        if (await this.directoryExists(tempPath)) {
          await fs.rm(tempPath, { recursive: true, force: true });
        }
      }
      throw error;
    }
  }

  /**
   * Helper: Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Helper: Recursively copy directory
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await ensureDir(dest);
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
