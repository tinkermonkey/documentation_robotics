/**
 * Delete an element
 */

import { confirm } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { MutationHandler } from '../core/mutation-handler.js';
import { findElementLayer } from '../utils/element-utils.js';
import { CLIError, handleError } from '../utils/errors.js';
import { displayChangesetStatus } from '../utils/changeset-status.js';
import { startSpan, endSpan } from '../telemetry/index.js';

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

export interface DeleteOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function deleteCommand(id: string, options: DeleteOptions): Promise<void> {
  const span = isTelemetryEnabled ? startSpan('element.delete', {
    'element.id': id,
    'element.force': !!options.force,
  }) : null;

  try {
    // Load model
    const model = await Model.load();

    // Display active changeset status
    await displayChangesetStatus(model);

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      throw new CLIError(`Element ${id} not found`, 1);
    }

    // Confirm deletion unless --force
    if (!options.force) {
      const confirmed = await confirm({
        message: `Delete element ${ansis.bold(id)}? This cannot be undone.`,
        initialValue: false,
      });

      if (!confirmed) {
        console.log(ansis.dim('Cancelled'));
        process.exit(0);
      }
    }

    const layer = (await model.getLayer(layerName))!;
    const element = layer.getElement(id)!;

    // Unified mutation handler for delete operation
    const handler = new MutationHandler(model, id, layerName);

    // Execute delete through unified path (handles staging and base model consistently)
    // Delete has no mutator function as the delete operation is handled by MutationHandler.executeDelete
    await handler.executeDelete(element);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('layer.name', layerName);
    }

    console.log(ansis.green(`✓ Deleted element ${ansis.bold(id)}`));
    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
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
