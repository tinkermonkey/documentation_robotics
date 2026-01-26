/**
 * Add an element to a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { Layer } from '../core/layer.js';
import { Element } from '../core/element.js';
import { MutationHandler } from '../core/mutation-handler.js';
import {
  InvalidJSONError,
  CLIError,
  handleError,
  handleSuccess,
  ErrorCategory,
  findSimilar,
  formatValidOptions,
} from '../utils/errors.js';
import { validateSourceReferenceOptions, buildSourceReference } from '../utils/source-reference.js';
import { displayChangesetStatus } from '../utils/changeset-status.js';
import { startSpan, endSpan } from '../telemetry/index.js';
import { generateElementId } from '../utils/id-generator.js';

// Telemetry flag check
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

// Valid canonical layer names (from CLAUDE.md section 4.1)
const VALID_LAYERS = [
  'motivation',
  'business',
  'security',
  'application',
  'technology',
  'api',
  'data-model',
  'data-store',
  'ux',
  'navigation',
  'apm',
  'testing',
];

export interface AddOptions {
  name?: string;
  description?: string;
  properties?: string;
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function addCommand(
  layer: string,
  type: string,
  name: string,
  options: AddOptions
): Promise<void> {
  // Validate layer name
  if (!VALID_LAYERS.includes(layer)) {
    const similar = findSimilar(layer, VALID_LAYERS, 3);
    const suggestions: string[] = [
      `Use a valid layer name: ${formatValidOptions(VALID_LAYERS)}`,
    ];
    if (similar.length > 0) {
      suggestions.unshift(`Did you mean: ${similar.join(' or ')}?`);
    }
    throw new CLIError(
      `Invalid layer "${layer}"`,
      ErrorCategory.USER,
      suggestions,
      { operation: 'add', context: `Layer: ${layer}, Type: ${type}, Name: ${name}` }
    );
  }

  // Generate full element ID: {layer}.{type}.{kebab-name}
  // This matches Python CLI format for compatibility
  const elementId = generateElementId(layer, type, name);

  const span = isTelemetryEnabled ? startSpan('element.add', {
    'layer.name': layer,
    'element.type': type,
    'element.id': elementId,
  }) : null;

  try {
    // Validate source reference options
    validateSourceReferenceOptions(options);

    // Load model
    const model = await Model.load();

    // Display active changeset status
    await displayChangesetStatus(model);

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

    // Create element with Python CLI compatible ID format
    const element = new Element({
      id: elementId,
      type,
      name: options.name || name,
      description: options.description,
      properties,
      layer, // Set layer so setSourceReference can use it
    });

    // Add source reference if provided
    const sourceRef = buildSourceReference(options);
    if (sourceRef) {
      element.setSourceReference(sourceRef);
    }

    // Check if element already exists
    if (layerObj.getElement(elementId)) {
      throw new CLIError(
        `Element ${elementId} already exists in ${layer} layer`,
        ErrorCategory.USER,
        [
          `Use "dr show ${elementId}" to view the existing element`,
          `Use "dr update ${elementId}" to modify it`,
          `Use "dr delete ${elementId}" to remove it first if you want to recreate it`,
        ],
        { operation: 'add', context: `Duplicate element ID` }
      );
    }

    // Unified mutation handler for add operation
    const handler = new MutationHandler(model, elementId, layer);

    // Execute add through unified path (handles staging and base model consistently)
    await handler.executeAdd(element, (elem) => {
      // This mutator is called by executeAdd for base model path only
      layerObj.addElement(elem);
    });

    // Determine if operation was staged or applied to base model
    if (handler.getAfterState()) {
      // Check if we went through staging path
      const stagingManager = handler.getStagingManager();
      const activeChangeset = await stagingManager.getActive();
      if (activeChangeset && activeChangeset.status === 'staged') {
        // Staging path
        handleSuccess(`Staged element ${ansis.bold(elementId)} to ${ansis.bold(activeChangeset.name)}`, {
          status: 'staged',
          changeset: activeChangeset.name,
          type,
          name: options.name || name,
        });
      } else {
        // Base model path
        handleSuccess(`Added element ${ansis.bold(elementId)} to ${ansis.bold(layer)} layer`, {
          type,
          name: options.name || name,
          description: options.description || '(none)',
        });
      }
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: (error as Error).message });
    }
    handleError(error);
  } finally {
    if (isTelemetryEnabled) {
      endSpan(span);
    }
  }
}
