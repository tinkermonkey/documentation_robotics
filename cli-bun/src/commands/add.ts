/**
 * Add an element to a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { Layer } from '../core/layer.js';
import { Element } from '../core/element.js';
import { fileExists } from '../utils/file-io.js';
import {
  ModelNotFoundError,
  InvalidJSONError,
  CLIError,
  handleError,
  handleSuccess,
} from '../utils/errors.js';

export interface AddOptions {
  name?: string;
  description?: string;
  properties?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function addCommand(
  layer: string,
  type: string,
  id: string,
  options: AddOptions
): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      throw new ModelNotFoundError(rootPath);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Get or create layer
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }

    // Parse properties if provided
    let properties: Record<string, unknown> = {};
    if (options.properties) {
      try {
        properties = JSON.parse(options.properties);
      } catch (e) {
        throw new InvalidJSONError(options.properties, '--properties');
      }
    }

    // Create element
    const element = new Element({
      id,
      type,
      name: options.name || id,
      description: options.description,
      properties,
    });

    // Check if element already exists
    if (layerObj.getElement(id)) {
      throw new CLIError(
        `Element ${id} already exists in ${layer} layer`,
        1,
        [`Use "dr show ${id}" to view the existing element`, `Use "dr update ${id}" to modify it`]
      );
    }

    // Add to layer
    layerObj.addElement(element);

    // Save
    await model.saveLayer(layer);
    await model.saveManifest();

    handleSuccess(`Added element ${ansis.bold(id)} to ${ansis.bold(layer)} layer`, {
      type,
      name: options.name || id,
      description: options.description || '(none)',
    });
  } catch (error) {
    handleError(error);
  }
}
