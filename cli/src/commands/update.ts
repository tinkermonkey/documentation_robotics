/**
 * Update an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { MutationHandler } from '../core/mutation-handler.js';
import { findElementLayer } from '../utils/element-utils.js';
import { CLIError, handleError } from '../utils/errors.js';
import { validateSourceReferenceOptions, buildSourceReference } from '../utils/source-reference.js';
import { startSpan, endSpan } from '../telemetry/index.js';

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

export interface UpdateOptions {
  name?: string;
  description?: string;
  properties?: string;
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  clearSourceReference?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

/**
 * Validate update-specific source reference options
 */
function validateUpdateSourceReferenceOptions(options: UpdateOptions): void {
  const hasSourceOptions = options.sourceFile || options.sourceSymbol ||
                           options.sourceProvenance || options.sourceRepoRemote ||
                           options.sourceRepoCommit;

  if (options.clearSourceReference && hasSourceOptions) {
    throw new CLIError(
      'Cannot use --clear-source-reference with other source reference options',
      1,
      ['Specify either --clear-source-reference or other source options, not both']
    );
  }

  // Use shared validation for source reference options if any are provided
  if (hasSourceOptions) {
    validateSourceReferenceOptions(options);
  }
}

export async function updateCommand(id: string, options: UpdateOptions): Promise<void> {
  const changedFields: string[] = [];
  if (options.name) changedFields.push('name');
  if (options.description) changedFields.push('description');
  if (options.properties) changedFields.push('properties');
  if (options.sourceFile || options.clearSourceReference) changedFields.push('sourceReference');

  const span = isTelemetryEnabled ? startSpan('element.update', {
    'element.id': id,
    'element.changed_fields': changedFields.join(','),
  }) : null;

  try {
    // Validate source reference options
    validateUpdateSourceReferenceOptions(options);

    // Load model
    const model = await Model.load();

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      throw new CLIError(`Element ${id} not found`, 1);
    }

    const layer = (await model.getLayer(layerName))!;
    const element = layer.getElement(id)!;

    // Validate that at least one field is specified
    const hasUpdates = options.name || options.description !== undefined ||
                       options.properties || options.sourceFile || options.clearSourceReference;

    if (!hasUpdates) {
      console.log(ansis.yellow('No fields specified for update'));
      return;
    }

    // Single unified mutation handler for update
    const handler = new MutationHandler(model, id, layerName);

    // Execute update through unified path (handles staging and base model consistently)
    // The mutator function applies all updates in a single pass with validated JSON parsing
    await handler.executeUpdate(element, async (elem, after) => {
      // Parse JSON once here in the mutator - shared by both staging and base paths
      let parsedProperties: Record<string, unknown> | undefined;
      if (options.properties) {
        try {
          parsedProperties = JSON.parse(options.properties);
        } catch (e) {
          throw new CLIError(
            'Invalid JSON in --properties',
            1,
            ['Ensure your JSON is valid and properly formatted']
          );
        }
      }

      // Apply updates to both element and after state
      if (options.name) {
        elem.name = options.name;
        after.name = options.name;
      }

      if (options.description !== undefined) {
        elem.description = options.description || undefined;
        after.description = options.description || undefined;
      }

      if (parsedProperties) {
        elem.properties = { ...elem.properties, ...parsedProperties };
        after.properties = { ...(after.properties as Record<string, unknown>), ...parsedProperties };
      }

      if (options.clearSourceReference) {
        elem.setSourceReference(undefined);
        after.sourceReference = undefined;
      } else if (options.sourceFile) {
        const newRef = buildSourceReference(options);
        if (newRef) {
          elem.setSourceReference(newRef);
          after.sourceReference = newRef;
        }
      }
    });

    console.log(ansis.green(`✓ Updated element ${ansis.bold(id)}`));
    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
      if (options.name) {
        console.log(ansis.dim(`  Name: ${options.name}`));
      }
      if (options.description) {
        console.log(ansis.dim(`  Description: ${options.description}`));
      }
      if (options.sourceFile) {
        console.log(ansis.dim(`  Source: ${options.sourceFile}`));
      }
      if (options.clearSourceReference) {
        console.log(ansis.dim(`  Source: cleared`));
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
