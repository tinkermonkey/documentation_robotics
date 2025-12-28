import { Layer } from "./layer.js";
import { Manifest } from "./manifest.js";
import { ensureDir, writeJSON, readJSON, fileExists } from "../utils/file-io.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import type { LayerData, ManifestData, ModelOptions } from "../types/index.js";

// Fallback for runtime environments where TELEMETRY_ENABLED is not defined by esbuild
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

/**
 * Model class representing the complete architecture model
 */
export class Model {
  rootPath: string;
  manifest: Manifest;
  layers: Map<string, Layer>;
  lazyLoad: boolean;
  private loadedLayers: Set<string>;

  constructor(rootPath: string, manifest: Manifest, options: ModelOptions = {}) {
    this.rootPath = rootPath;
    this.manifest = manifest;
    this.layers = new Map();
    this.lazyLoad = options.lazyLoad ?? false;
    this.loadedLayers = new Set();
  }

  /**
   * Get a layer, loading it if lazy loading is enabled
   */
  async getLayer(name: string): Promise<Layer | undefined> {
    if (this.lazyLoad && !this.loadedLayers.has(name)) {
      await this.loadLayer(name);
    }
    return this.layers.get(name);
  }

  /**
   * Load a layer from disk
   */
  async loadLayer(name: string): Promise<void> {
    const layerSpan = isTelemetryEnabled ? startSpan('layer.load', {
      'layer.name': name,
    }) : null;

    try {
      const layerPath = `${this.rootPath}/.dr/layers/${name}.json`;
      if (await fileExists(layerPath)) {
        const data = await readJSON<LayerData>(layerPath);
        const layer = Layer.fromJSON(name, data);
        this.layers.set(name, layer);
        this.loadedLayers.add(name);

        if (isTelemetryEnabled && layerSpan) {
          layerSpan.setAttribute('layer.element_count', layer.elements.size);
        }
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
    this.layers.set(layer.name, layer);
    this.loadedLayers.add(layer.name);
  }

  /**
   * Get all loaded layer names
   */
  getLayerNames(): string[] {
    return Array.from(this.layers.keys());
  }

  /**
   * Save a layer to disk
   */
  async saveLayer(name: string): Promise<void> {
    const layer = this.layers.get(name);
    if (!layer) {
      throw new Error(`Layer ${name} not found`);
    }

    const layerPath = `${this.rootPath}/.dr/layers/${name}.json`;
    await ensureDir(`${this.rootPath}/.dr/layers`);
    await writeJSON(layerPath, layer.toJSON(), true);
    layer.markClean();
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

    const span = isTelemetryEnabled ? startSpan('model.save', {
      'model.path': this.rootPath,
      'model.dirty_layer_count': dirtyLayerCount,
    }) : null;

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
   * Save the manifest to disk
   */
  async saveManifest(): Promise<void> {
    this.manifest.updateModified();
    const manifestPath = `${this.rootPath}/.dr/manifest.json`;
    await ensureDir(`${this.rootPath}/.dr`);
    await writeJSON(manifestPath, this.manifest.toJSON(), true);
  }

  /**
   * Load a model from disk
   */
  static async load(rootPath: string, options: ModelOptions = {}): Promise<Model> {
    const span = isTelemetryEnabled ? startSpan('model.load', {
      'model.path': rootPath,
      'model.type': 'dr-native',
    }) : null;

    try {
      const manifestPath = `${rootPath}/.dr/manifest.json`;
      const json = await readJSON<ManifestData>(manifestPath);
      const manifest = new Manifest(json);
      const model = new Model(rootPath, manifest, options);

      // Load all available layers if lazyLoad is false
      if (!options.lazyLoad) {
        try {
          const layersDir = `${rootPath}/.dr/layers`;
          const fs = await import('fs/promises');
          const files = await fs.readdir(layersDir);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const layerName = file.slice(0, -5); // Remove .json extension
              await model.loadLayer(layerName);
            }
          }
        } catch (e) {
          // If layers directory doesn't exist or can't be read, just continue
          // Only log in debug mode if needed
          if (process.env.DEBUG) {
            const error = e instanceof Error ? e.message : String(e);
            if (!error.includes('ENOENT')) {
              console.debug(`Warning: Failed to load layers directory: ${error}`);
            }
          }
        }
      }

      // Count total entities across all layers
      let entityCount = 0;
      for (const layer of model.layers.values()) {
        entityCount += layer.elements.size;
      }

      if (isTelemetryEnabled && span) {
        span.setAttribute('model.entity_count', entityCount);
        span.setAttribute('model.layer_count', model.layers.size);
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
    await ensureDir(`${rootPath}/.dr/layers`);

    const manifest = new Manifest(manifestData);
    const model = new Model(rootPath, manifest, options);

    await model.saveManifest();

    return model;
  }
}
