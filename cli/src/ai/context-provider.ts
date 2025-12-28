/**
 * Model Context Provider
 * Generates context about the architecture model for Claude to use
 */

import { Model } from '../core/model.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Provides context about the model for AI interactions
 */
export class ModelContextProvider {
  private model: Model;
  private layerNameMap: Record<string, string> = {
    motivation: '01',
    business: '02',
    security: '03',
    application: '04',
    technology: '05',
    api: '06',
    'data-model': '07',
    'data-store': '08',
    ux: '09',
    navigation: '10',
    apm: '11',
    testing: '12',
  };

  constructor(model: Model) {
    this.model = model;
  }

  /**
   * Generate markdown context about the current architecture model
   * @returns Markdown string with model overview and element summaries
   */
  async generateContext(): Promise<string> {
    const context: string[] = [];

    context.push('# Current Architecture Model\n');
    context.push(`**Name**: ${this.model.manifest.name}`);
    context.push(`**Version**: ${this.model.manifest.version}`);
    if (this.model.manifest.description) {
      context.push(`**Description**: ${this.model.manifest.description}`);
    }
    context.push('');

    context.push('## Layers Overview\n');

    // Get all available layers
    const layerNames = this.model.getLayerNames();
    const layerDetails: string[] = [];

    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (layer) {
        const elementCount = layer.listElements().length;
        layerDetails.push(`- **${layerName}**: ${elementCount} elements`);
      }
    }

    if (layerDetails.length > 0) {
      context.push(layerDetails.join('\n'));
    } else {
      context.push('_No layers loaded_');
    }

    context.push('');
    context.push('## Element Summary\n');

    // Show elements per layer
    for (const layerName of layerNames) {
      const layer = await this.model.getLayer(layerName);
      if (!layer) continue;

      const elements = layer.listElements();
      if (elements.length === 0) continue;

      context.push(`### ${layerName}\n`);

      // Show up to 10 elements per layer
      const displayElements = elements.slice(0, 10);
      for (const element of displayElements) {
        const desc = element.description ? ` - ${element.description}` : '';
        context.push(`- \`${element.id}\` (${element.type}): ${element.name}${desc}`);
      }

      if (elements.length > 10) {
        context.push(`- ... and ${elements.length - 10} more elements`);
      }

      context.push('');
    }

    return context.join('\n');
  }

  /**
   * Generate markdown context about the testing layer specification
   * @returns Markdown string with testing layer specification
   */
  async generateTestingLayerSpec(): Promise<string> {
    return this.generateLayerSpec('testing');
  }

  /**
   * Generate markdown context about a specific layer specification
   * @param layerName The layer name (e.g., 'motivation', 'business', 'api')
   * @returns Markdown string with layer specification
   */
  async generateLayerSpec(layerName: string): Promise<string> {
    try {
      const specPath = this.getLayerSpecPath(layerName);
      const content = await readFile(specPath, 'utf-8');
      return content;
    } catch (error) {
      return `# ${layerName} Layer\n\n_Layer specification not found._`;
    }
  }

  /**
   * Get the file path for a layer specification
   * @param layerName The layer name
   * @returns The file path to the layer specification
   */
  private getLayerSpecPath(layerName: string): string {
    const normalizedName = layerName.toLowerCase().replace(/\s+/g, '-');
    const layerNumber = this.layerNameMap[normalizedName];

    if (!layerNumber) {
      throw new Error(`Unknown layer: ${layerName}`);
    }

    // Get the path relative to this file, going up to cli, then to spec
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const specDir = join(__dirname, '../../spec/layers');

    // Handle special case for data-store which is called datastore in spec
    let fileName: string;
    if (normalizedName === 'data-store') {
      fileName = `${layerNumber}-datastore-layer.md`;
    } else if (normalizedName === 'apm') {
      fileName = `${layerNumber}-apm-observability-layer.md`;
    } else {
      fileName = `${layerNumber}-${normalizedName}-layer.md`;
    }

    return join(specDir, fileName);
  }

  /**
   * Get a list of all available layers
   * @returns Array of layer names
   */
  getAvailableLayers(): string[] {
    return Object.keys(this.layerNameMap);
  }

  /**
   * Get element count for a specific layer
   * @param layerName The layer name
   * @returns The number of elements in the layer, or 0 if not loaded
   */
  async getLayerElementCount(layerName: string): Promise<number> {
    const layer = await this.model.getLayer(layerName);
    return layer ? layer.listElements().length : 0;
  }

  /**
   * Get total element count across all layers
   * @returns Total number of elements
   */
  async getTotalElementCount(): Promise<number> {
    let total = 0;
    for (const layerName of this.model.getLayerNames()) {
      const layer = await this.model.getLayer(layerName);
      if (layer) {
        total += layer.listElements().length;
      }
    }
    return total;
  }
}
