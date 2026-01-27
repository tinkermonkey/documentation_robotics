import { Layer } from "./layer.js"
import { Manifest } from "./manifest.js"
import { Element } from "./element.js";
import { ProjectionEngine } from "./projection-engine.js";
import { VirtualProjectionEngine } from "./virtual-projection.js";
import { Relationships } from "./relationships.js";
import { ActiveChangesetContext } from "./active-changeset.js";
import { ensureDir, writeFile } from "../utils/file-io.js";
import { getCliVersion } from "../utils/spec-version.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { findProjectRoot } from "../utils/project-paths.js";
import type { ManifestData, ModelOptions } from "../types/index.js";
import path from 'node:path';
import fs from 'node:fs/promises';

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false

/**
 * Model class representing the complete architecture model
 */
export class Model {
  rootPath: string
  manifest: Manifest
  layers: Map<string, Layer>
  relationships: Relationships
  lazyLoad: boolean
  private loadedLayers: Set<string>
  private projectionEngine?: ProjectionEngine
  private virtualProjectionEngine?: VirtualProjectionEngine
  private activeChangesetContext?: ActiveChangesetContext

  constructor(rootPath: string, manifest: Manifest, options: ModelOptions = {}) {
    this.rootPath = rootPath
    this.manifest = manifest
    this.layers = new Map()
    this.relationships = new Relationships()
    this.lazyLoad = options.lazyLoad ?? false
    this.loadedLayers = new Set()
  }

  /**
   * Get a layer, loading it if lazy loading is enabled
   */
  async getLayer(name: string): Promise<Layer | undefined> {
    if (this.lazyLoad && !this.loadedLayers.has(name)) {
      await this.loadLayer(name)
    }
    return this.layers.get(name)
  }

  /**
   * Get an element by ID across all layers
   */
  getElementById(id: string): Element | undefined {
    for (const layer of this.layers.values()) {
      const element = layer.elements.get(id);
      if (element) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Get projection engine (lazily initialized)
   */
  getProjectionEngine(): ProjectionEngine {
    if (!this.projectionEngine) {
      this.projectionEngine = new ProjectionEngine(this);
    }
    return this.projectionEngine;
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
   * Get active changeset context (lazily initialized)
   */
  getActiveChangesetContext(): ActiveChangesetContext {
    if (!this.activeChangesetContext) {
      this.activeChangesetContext = new ActiveChangesetContext(this.rootPath);
    }
    return this.activeChangesetContext;
  }

  /**
   * Load a layer from disk (legacy format: model/XX_layername/*.yaml files)
   * Supports reading layer paths from manifest for Python CLI compatibility
   */
  async loadLayer(name: string): Promise<void> {
    const layerSpan = isTelemetryEnabled ? startSpan('layer.load', {
      'layer.name': name,
    }) : null

    try {
      const fs = await import('fs/promises')
      const yaml = await import('yaml')

      let layerPath: string | null = null

      // PRIORITY 1: Read layer path from manifest (Python CLI compatibility)
      if (this.manifest.layers && this.manifest.layers[name]) {
        const layerConfig = this.manifest.layers[name]
        if (layerConfig.path) {
          // Path in manifest is relative to root
          const fullPath = `${this.rootPath}/${layerConfig.path.replace(/\/$/, '')}`
          try {
            await fs.access(fullPath)
            layerPath = fullPath
          } catch (err) {
            // Path in manifest doesn't exist - this is an error
            if (process.env.DEBUG) {
              console.debug(`Manifest specifies path ${layerConfig.path} but it doesn't exist`)
            }
          }
        }
      }

      // FALLBACK: Auto-discover by scanning directory with naming convention
      if (!layerPath) {
        const modelDir = `${this.rootPath}/documentation-robotics/model`

        try {
          const entries = await fs.readdir(modelDir, { withFileTypes: true })
          const layerDir = entries.find(e =>
            e.isDirectory() && e.name.match(/^\d{2}_/) && e.name.replace(/^\d{2}_/, '') === name
          )

          if (layerDir) {
            layerPath = `${modelDir}/${layerDir.name}`
          }
        } catch {
          // Model directory doesn't exist or can't be read
        }
      }

      if (!layerPath) {
        return // Layer directory not found
      }

      const layer = new Layer(name)
      let parseErrorCount = 0

      // Load all YAML files in the layer directory
      const files = await fs.readdir(layerPath)
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          const filePath = `${layerPath}/${file}`
          try {
            const yamlContent = await fs.readFile(filePath, 'utf-8')
            const elements = yaml.parse(yamlContent)

            // Add each element from the YAML file
            if (elements && typeof elements === 'object') {
              for (const [key, element] of Object.entries(elements)) {
              if (element && typeof element === 'object') {
                const el: any = element

                // Auto-generate layer-prefixed ID if missing (Python CLI compatibility)
                // Python: element_id = f"{self.name}.{key}" when no id field
                const elementId = el.id || `${name}.${key}`

                // Infer type from filename if not specified (Python CLI compatibility)
                // Python: _infer_type_from_file removes trailing 's' from stem
                let elementType = el.type
                if (!elementType) {
                  const stem = file.replace(/\.ya?ml$/, '')
                  elementType = stem.endsWith('s') ? stem.slice(0, -1) : stem
                }

                const newElement = new Element({
                  id: elementId,
                  name: el.name || key,
                  type: elementType,
                  description: el.description || el.documentation || '',
                  properties: el.properties || {},
                  relationships: el.relationships || [],
                  references: el.references || [],
                  layer: name,  // Track layer (Python CLI compatibility)
                  filePath: filePath,  // Track source file (Python CLI compatibility)
                  rawData: el  // Preserve raw YAML data (Python CLI compatibility)
                });
                layer.addElement(newElement);
              }
            }
            }
          } catch (fileError) {
            // Log YAML parsing errors but continue loading other files
            const errorMsg = fileError instanceof Error ? fileError.message : String(fileError)
            console.error(`Warning: Failed to parse ${filePath}: ${errorMsg}`)
            parseErrorCount++
            // Continue with next file
          }
        }
      }

      // If we had parse errors, add a note to the layer
      if (parseErrorCount > 0) {
        console.error(`Warning: Layer '${name}' loaded with ${parseErrorCount} YAML parse error(s)`)
      }

      this.layers.set(name, layer)
      this.loadedLayers.add(name)

      if (isTelemetryEnabled && layerSpan) {
        layerSpan.setAttribute('layer.element_count', layer.elements.size)
      }
    } finally {
      if (isTelemetryEnabled) {
        endSpan(layerSpan)
      }
    }
  }

  /**
   * Add a layer to the model
   */
  addLayer(layer: Layer): void {
    this.layers.set(layer.name, layer)
    this.loadedLayers.add(layer.name)
  }

  /**
   * Get all loaded layer names
   */
  getLayerNames(): string[] {
    return Array.from(this.layers.keys())
  }

  /**
   * Save a layer to disk (legacy format: model/XX_layername/*.yaml)
   */
  async saveLayer(name: string): Promise<void> {
    const layer = this.layers.get(name)
    if (!layer) {
      throw new Error(`Layer ${name} not found`)
    }

    const fs = await import('fs/promises')
    const yaml = await import('yaml')

    let layerPath: string | null = null

    // Try to get layer path from manifest first (Python CLI compatibility)
    if (this.manifest.layers && this.manifest.layers[name]) {
      const layerConfig = this.manifest.layers[name]
      if (layerConfig.path) {
        const fullPath = `${this.rootPath}/${layerConfig.path.replace(/\/$/, '')}`
        try {
          await fs.access(fullPath)
          layerPath = fullPath
        } catch {
          // Path doesn't exist, create it
          await ensureDir(fullPath)
          layerPath = fullPath
        }
      }
    }

    // If manifest path not found, try discovery by scanning directory
    if (!layerPath) {
      const modelDir = `${this.rootPath}/documentation-robotics/model`

      try {
        const entries = await fs.readdir(modelDir, { withFileTypes: true })
        const layerDir = entries.find(e =>
          e.isDirectory() && e.name.match(/^\d{2}_/) &&
          e.name.replace(/^\d{2}_/, '') === name
        )

        if (layerDir) {
          layerPath = `${modelDir}/${layerDir.name}`
        }
      } catch {
        // Model directory doesn't exist or can't be read
      }
    }

    // If still not found, create using default format
    if (!layerPath) {
      // Find the order number for this layer
      // Handle layer names with or without numeric prefix (e.g., "motivation" or "01-motivation")
      const layerNameWithoutPrefix = name.replace(/^\d{2}-/, '')
      const layerOrder = [
        'motivation', 'business', 'security', 'application', 'technology',
        'api', 'data-model', 'datastore', 'ux', 'navigation', 'apm', 'testing'
      ]
      const index = layerOrder.indexOf(layerNameWithoutPrefix)
      if (index >= 0) {
        const orderNum = String(index + 1).padStart(2, '0')
        // Use Python CLI structure
        layerPath = `${this.rootPath}/documentation-robotics/model/${orderNum}_${layerNameWithoutPrefix}`
        await ensureDir(layerPath)
      } else {
        throw new Error(`Unknown layer ${name} and no path configured in manifest`)
      }
    }

    // Delete all existing YAML files in the layer directory to ensure
    // we don't keep stale files after element deletion
    try {
      const existingFiles = await fs.readdir(layerPath)
      for (const file of existingFiles) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          await fs.unlink(`${layerPath}/${file}`)
        }
      }
    } catch (err) {
      // Directory might not exist yet, that's okay
    }

    // Group elements by type
    const elementsByType = new Map<string, any[]>()
    for (const element of layer.elements.values()) {
      const type = element.type + 's' // pluralize (e.g., goal -> goals)
      if (!elementsByType.has(type)) {
        elementsByType.set(type, [])
      }
      elementsByType.get(type)!.push(element)
    }

    // Write each type to its own YAML file
    for (const [type, elements] of elementsByType) {
      const filename = `${type}.yaml`
      const filePath = `${layerPath}/${filename}`

      // Convert elements to YAML format
      const yamlData: any = {}
      for (const element of elements) {
        const key = element.id.split('.').pop() || element.id
        yamlData[key] = {
          id: element.id,
          name: element.name,
          type: element.type,
          ...(element.description && { documentation: element.description }),
          ...(Object.keys(element.properties || {}).length > 0 && { properties: element.properties }),
          ...(element.references && element.references.length > 0 && { references: element.references }),
          // Relationships are now stored in centralized relationships.yaml, not inline
        }
      }

      await writeFile(filePath, yaml.stringify(yamlData))
    }

    layer.markClean()
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
    let dirtyLayerCount = 0
    for (const layer of this.layers.values()) {
      if (layer.isDirty()) {
        dirtyLayerCount++
      }
    }

    const span = isTelemetryEnabled ? startSpan('model.save', {
      'model.path': this.rootPath,
      'model.dirty_layer_count': dirtyLayerCount,
    }) : null

    try {
      for (const layer of this.layers.values()) {
        if (layer.isDirty()) {
          await this.saveLayer(layer.name)
        }
      }
    } finally {
      if (isTelemetryEnabled) {
        endSpan(span)
      }
    }
  }

  /**
   * Save the manifest to disk (Python CLI format: documentation-robotics/model/manifest.yaml)
   * Preserves Python CLI metadata fields for compatibility
   */
  async saveManifest(): Promise<void> {
    this.manifest.updateModified()
    const yaml = await import('yaml')
    const manifestPath = `${this.rootPath}/documentation-robotics/model/manifest.yaml`

    // Convert to legacy YAML format, preserving Python CLI fields
    const yamlData: any = {
      version: this.manifest.version,
      schema: 'documentation-robotics-v1',
      cli_version: getCliVersion(),
      spec_version: this.manifest.specVersion,
      created: this.manifest.created,
      updated: this.manifest.modified,
      project: {
        name: this.manifest.name,
        description: this.manifest.description,
        version: this.manifest.version,
      },
      documentation: '.dr/README.md',
      layers: this.manifest.layers || {} as any,
    }

    // If layers not preserved from load, generate default structure
    if (!this.manifest.layers || Object.keys(this.manifest.layers).length === 0) {
      const layerOrder = [
        'motivation', 'business', 'security', 'application', 'technology',
        'api', 'data-model', 'datastore', 'ux', 'navigation', 'apm', 'testing'
      ]

      for (let i = 0; i < layerOrder.length; i++) {
        const layerName = layerOrder[i]
        const layer = this.layers.get(layerName)
        const orderNum = String(i + 1).padStart(2, '0')

        yamlData.layers[layerName] = {
          order: i + 1,
          name: layerName.charAt(0).toUpperCase() + layerName.slice(1).replace('-', ' '),
          path: `documentation-robotics/model/${orderNum}_${layerName}/`,
          schema: `.dr/schemas/${orderNum}-${layerName}-layer.schema.json`,
          enabled: true,
          ...(layer && { elements: this.getLayerElementCounts(layer) }),
        }
      }
    } else {
      // Update element counts in existing layer configs
      for (const [layerName, layerConfig] of Object.entries(yamlData.layers)) {
        const layer = this.layers.get(layerName)
        if (layer) {
          (layerConfig as any).elements = this.getLayerElementCounts(layer)
        }
      }
    }

    // Preserve Python CLI metadata fields
    if (this.manifest.statistics) {
      // Update statistics with current counts
      const stats = { ...this.manifest.statistics }
      stats.total_elements = Array.from(this.layers.values())
        .reduce((sum, layer) => sum + layer.elements.size, 0)
      yamlData.statistics = stats
    }

    if (this.manifest.cross_references) {
      yamlData.cross_references = this.manifest.cross_references
    }

    if (this.manifest.conventions) {
      yamlData.conventions = this.manifest.conventions
    }

    if (this.manifest.upgrade_history) {
      yamlData.upgrade_history = this.manifest.upgrade_history
    }

    if (this.manifest.changeset_history && this.manifest.changeset_history.length > 0) {
      yamlData.changeset_history = this.manifest.changeset_history
    }

    if (this.manifest.preferred_chat_client) {
      yamlData.preferred_chat_client = this.manifest.preferred_chat_client
    }

    await ensureDir(`${this.rootPath}/documentation-robotics/model`)
    await writeFile(manifestPath, yaml.stringify(yamlData))
  }

  private getLayerElementCounts(layer: Layer): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const element of layer.elements.values()) {
      counts[element.type] = (counts[element.type] || 0) + 1
    }
    return counts
  }

  /**
   * Load relationships from relationships.yaml
   */
  async loadRelationships(): Promise<void> {
    const fs = await import('fs/promises')
    const yaml = await import('yaml')
    const relationshipsPath = `${this.rootPath}/documentation-robotics/model/relationships.yaml`

    try {
      const yamlContent = await fs.readFile(relationshipsPath, 'utf-8')
      const data = yaml.parse(yamlContent)

      if (Array.isArray(data)) {
        this.relationships = Relationships.fromArray(data)
      }
    } catch (err) {
      // If file doesn't exist, that's okay - start with empty relationships
      if ((err as any).code !== 'ENOENT') {
        // But if it's a different error, we should know about it
        if (process.env.DEBUG) {
          console.debug(`Warning: Failed to load relationships.yaml: ${err}`)
        }
      }
    }
  }

  /**
   * Save relationships to relationships.yaml
   */
  async saveRelationships(): Promise<void> {
    const fs = await import('fs/promises')
    const yaml = await import('yaml')
    const relationshipsPath = `${this.rootPath}/documentation-robotics/model/relationships.yaml`

    await ensureDir(`${this.rootPath}/documentation-robotics/model`)

    const data = this.relationships.toArray()

    // Add header comment with timestamp to ensure file always changes
    // This matches Python CLI behavior
    const timestamp = new Date().toISOString()
    const header = `# Intra-layer relationships
# Format: source_id -> predicate -> target_id
# Last updated: ${timestamp}

`
    const yamlContent = header + yaml.stringify(data)

    await fs.writeFile(relationshipsPath, yamlContent, 'utf-8')
    this.relationships.markClean()
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

      if (envPath.endsWith('manifest.yaml')) {
        manifestPath = envPath;
      } else if (envPath.endsWith('model')) {
        manifestPath = path.join(envPath, 'manifest.yaml');
      } else {
        manifestPath = path.join(envPath, 'documentation-robotics', 'model', 'manifest.yaml');
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
        'No DR project found. Could not find documentation_robotics/ folder.\n' +
        'Run "dr init" to create a new project, or navigate to a directory containing a DR project.'
      );
    }

    const manifestPath = path.join(projectRoot, 'documentation-robotics', 'model', 'manifest.yaml');

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
    const span = isTelemetryEnabled ? startSpan('model.load', {
      'model.path': startPath || process.cwd(),
      'model.type': 'dr-legacy',
    }) : null

    try {
      // Resolve project root and manifest path
      const { projectRoot, manifestPath } = await Model.resolveModelPaths(startPath);

      const yaml = await import('yaml')

      // Load manifest from resolved path
      const yamlContent = await fs.readFile(manifestPath, 'utf-8')
      const legacyData = yaml.parse(yamlContent)

      // Convert legacy format to internal format
      const manifestData: any = {
        name: legacyData.project?.name || 'Unnamed Model',
        description: legacyData.project?.description || '',
        version: legacyData.project?.version || legacyData.version || '0.1.0',
        specVersion: legacyData.spec_version || '0.6.0',
        created: legacyData.created || new Date().toISOString(),
        modified: legacyData.updated || new Date().toISOString(),
        // Preserve Python CLI metadata fields
        layers: legacyData.layers,
        statistics: legacyData.statistics || {
          total_elements: 0,
          total_relationships: 0,
          completeness: 0.0,
          last_validation: null,
          validation_status: 'not_validated'
        },
        cross_references: legacyData.cross_references || {
          total: 0,
          by_type: {}
        },
        conventions: legacyData.conventions,
        upgrade_history: legacyData.upgrade_history || [],
        preferred_chat_client: legacyData.preferred_chat_client
      }
      const manifest = new Manifest(manifestData)
      const model = new Model(projectRoot, manifest, options)

      // Load all available layers if lazyLoad is false
      if (!options.lazyLoad) {
        try {
          // If manifest has layer definitions, use those
          if (legacyData.layers) {
            for (const layerName of Object.keys(legacyData.layers)) {
              const layerConfig = legacyData.layers[layerName]
              if (layerConfig.enabled !== false) {
                await model.loadLayer(layerName)
              }
            }
          } else {
            // Otherwise scan for layer directories
            const modelDir = manifestPath.replace('/manifest.yaml', '')
            const entries = await fs.readdir(modelDir, { withFileTypes: true })

            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.match(/^\d{2}_/)) {
                const layerName = entry.name.replace(/^\d{2}_/, '')
                await model.loadLayer(layerName)
              }
            }
          }
        } catch (e) {
          // If layers directory doesn't exist or can't be read, just continue
          if (process.env.DEBUG) {
            const error = e instanceof Error ? e.message : String(e)
            if (!error.includes('ENOENT')) {
              console.debug(`Warning: Failed to load layers directory: ${error}`)
            }
          }
        }
      }

      // Load relationships from relationships.yaml
      await model.loadRelationships()

      // Count total entities across all layers
      let entityCount = 0
      for (const layer of model.layers.values()) {
        entityCount += layer.elements.size
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute('model.entity_count', entityCount)
        span.setAttribute('model.layer_count', model.layers.size)
      }

      return model
    } finally {
      if (isTelemetryEnabled) {
        endSpan(span)
      }
    }
  }

  /**
   * Initialize a new model in a directory (legacy format)
   */
  static async init(
    rootPath: string,
    manifestData: ManifestData,
    options: ModelOptions = {}
  ): Promise<Model> {
    // Create model directory using Python CLI structure: documentation-robotics/model/
    await ensureDir(`${rootPath}/documentation-robotics/model`);

    const layerOrder = [
      'motivation', 'business', 'security', 'application', 'technology',
      'api', 'data-model', 'data-store', 'ux', 'navigation', 'apm', 'testing'
    ];

    for (let i = 0; i < layerOrder.length; i++) {
      const orderNum = String(i + 1).padStart(2, '0');
      const layerName = layerOrder[i];
      await ensureDir(`${rootPath}/documentation-robotics/model/${orderNum}_${layerName}`);
    }

    const manifest = new Manifest(manifestData);
    const model = new Model(rootPath, manifest, options);

    await model.saveManifest();

    return model;
  }
}
