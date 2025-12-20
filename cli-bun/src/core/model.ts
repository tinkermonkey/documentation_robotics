import { Layer } from "./layer";
import { Manifest } from "./manifest";
import { ensureDir, readFile, writeJSON, readJSON, fileExists } from "@/utils/file-io";
import type { LayerData, ManifestData, ModelOptions } from "@/types/index";

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
    const layerPath = `${this.rootPath}/.dr/layers/${name}.json`;
    if (await fileExists(layerPath)) {
      const data = await readJSON<LayerData>(layerPath);
      const layer = Layer.fromJSON(name, data);
      this.layers.set(name, layer);
      this.loadedLayers.add(name);
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
    for (const layer of this.layers.values()) {
      if (layer.isDirty()) {
        await this.saveLayer(layer.name);
      }
    }
  }

  /**
   * Save the manifest to disk
   */
  async saveManifest(): Promise<void> {
    this.manifest.updateModified();
    const manifestPath = `${this.rootPath}/.dr/manifest.yaml`;
    await ensureDir(`${this.rootPath}/.dr`);
    await Bun.write(manifestPath, this.manifest.toYAML());
  }

  /**
   * Load a model from disk
   */
  static async load(rootPath: string, options: ModelOptions = {}): Promise<Model> {
    const manifestPath = `${rootPath}/.dr/manifest.yaml`;
    const yaml = await readFile(manifestPath);
    const manifest = Manifest.fromYAML(yaml);
    return new Model(rootPath, manifest, options);
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
