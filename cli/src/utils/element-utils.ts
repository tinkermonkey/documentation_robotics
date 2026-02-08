/**
 * Element utility functions shared across commands
 */

import { Model } from "../core/model.js";

/**
 * Find which layer contains an element by ID
 */
export async function findElementLayer(
  model: Model,
  elementId: string
): Promise<string | undefined> {
  for (const layerName of model.getLayerNames()) {
    const layer = await model.getLayer(layerName);
    if (layer && layer.getElement(elementId)) {
      return layerName;
    }
  }
  return undefined;
}
