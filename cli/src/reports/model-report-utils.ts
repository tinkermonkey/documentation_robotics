import type { CanonicalLayerName } from '../core/layers.js';
import { getLayerOrder } from '../core/layers.js';

/**
 * Generate the report filename for a layer using the shared pattern: {NN}-{layerName}-layer-report.md
 *
 * @param layerName - The canonical layer name (e.g., 'api', 'data-model')
 * @returns The filename string with zero-padded layer number
 */
export function getLayerReportFileName(layerName: CanonicalLayerName): string {
  const layerNumber = getLayerOrder(layerName);
  const paddedNumber = String(layerNumber).padStart(2, '0');
  return `${paddedNumber}-${layerName}-layer-report.md`;
}
