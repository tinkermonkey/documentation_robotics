/**
 * Add an element to a layer
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { Layer } from '../core/layer.js';
import { Element } from '../core/element.js';
import { StagingAreaManager } from '../core/staging-area.js';
import {
  InvalidJSONError,
  CLIError,
  handleError,
  handleSuccess,
} from '../utils/errors.js';
import { validateSourceReferenceOptions, buildSourceReference } from '../utils/source-reference.js';
import { startSpan, endSpan } from '../telemetry/index.js';

// Telemetry flag check
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

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
  id: string,
  options: AddOptions
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan('element.add', {
    'layer.name': layer,
    'element.type': type,
    'element.id': id,
  }) : null;

  try {
    // Validate source reference options
    validateSourceReferenceOptions(options);

    // Load model
    const model = await Model.load();

    // Get or create layer
    let layerObj = await model.getLayer(layer);
    if (!layerObj) {
      layerObj = new Layer(layer);
      model.addLayer(layerObj);
    }

    // Validate element ID format (should be kebab-case, no underscores)
    if (id.includes('_')) {
      throw new CLIError(
        `Invalid element ID: "${id}". Element IDs must use kebab-case (hyphens) not underscores.`,
        1,
        ['Use hyphens (-) instead of underscores (_)', 'Example: my-element-name not my_element_name']
      );
    }

    // Validate that name is explicitly provided
    // Elements should have meaningful names, not default to ID
    if (!options.name) {
      throw new CLIError(
        'Element name is required. Please specify --name option.',
        1,
        ['Provide a descriptive name using --name option', 'Example: --name "User Authentication Service"']
      );
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
      layer, // Set layer so setSourceReference can use it
    });

    // Add source reference if provided
    const sourceRef = buildSourceReference(options);
    if (sourceRef) {
      element.setSourceReference(sourceRef);
    }

    // Check if element already exists in base model
    if (layerObj.getElement(id)) {
      throw new CLIError(
        `Element ${id} already exists in ${layer} layer`,
        1,
        [`Use "dr show ${id}" to view the existing element`, `Use "dr update ${id}" to modify it`]
      );
    }

    // Check for active staging changeset
    const stagingManager = new StagingAreaManager(model.rootPath);
    const activeChangeset = await stagingManager.getActive();

    // STAGING INTERCEPTION: If active changeset with 'staged' status, redirect to staging only
    if (activeChangeset && activeChangeset.status === 'staged') {
      // Record change in staging area, block model mutation
      await stagingManager.stage(activeChangeset.id!, {
        type: 'add',
        elementId: id,
        layerName: layer,
        after: element.toJSON() as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });

      handleSuccess(`Staged element ${ansis.bold(id)} to ${ansis.bold(activeChangeset.name)}`, {
        status: 'staged',
        changeset: activeChangeset.name,
        type,
        name: options.name || id,
      });
      return;
    }

    // Normal flow: Add to base model directly
    layerObj.addElement(element);

    // Track change in legacy changeset context if present
    const activeChangesetContext = model.getActiveChangesetContext();
    await activeChangesetContext.trackChange(
      'add',
      id,
      layer,
      undefined,
      element.toJSON() as unknown as Record<string, unknown>
    );

    // Save
    await model.saveLayer(layer);
    await model.saveManifest();

    handleSuccess(`Added element ${ansis.bold(id)} to ${ansis.bold(layer)} layer`, {
      type,
      name: options.name || id,
      description: options.description || '(none)',
    });
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
