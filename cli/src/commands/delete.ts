/**
 * Delete an element
 */

import { confirm } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { StagingAreaManager } from '../core/staging-area.js';
import { findElementLayer } from '../utils/element-utils.js';
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

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      console.error(ansis.red(`Error: Element ${id} not found`));
      process.exit(1);
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

    // Capture element state for changeset tracking before deletion
    const element = layer.getElement(id)!;
    const beforeState = element.toJSON();

    // Check for active staging changeset
    const stagingManager = new StagingAreaManager(model.rootPath);
    const activeChangeset = await stagingManager.getActive();

    // STAGING INTERCEPTION: If active changeset with 'staged' status, redirect to staging only
    if (activeChangeset && activeChangeset.status === 'staged') {
      // Record change in staging area, don't delete from model
      await stagingManager.stage(activeChangeset.id!, {
        type: 'delete',
        elementId: id,
        layerName,
        before: beforeState as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });

      console.log(ansis.green(`✓ Staged deletion of element ${ansis.bold(id)} in ${ansis.bold(activeChangeset.name)}`));
      if (options.verbose) {
        console.log(ansis.dim(`  Changeset: ${activeChangeset.name}`));
        console.log(ansis.dim(`  Status: staged (base model unchanged)`));
      }
      return;
    }

    // Normal flow: Delete from base model directly
    const deleted = layer.deleteElement(id);
    if (!deleted) {
      console.error(ansis.red(`Error: Failed to delete element ${id}`));
      process.exit(1);
    }

    // Delete all relationships involving this element
    model.relationships.deleteForElement(id);

    // Track change in legacy changeset context if present
    const activeChangesetContext = model.getActiveChangesetContext();
    await activeChangesetContext.trackChange(
      'delete',
      id,
      layerName,
      beforeState as unknown as Record<string, unknown>,
      undefined
    );

    // Save layer and manifest
    await model.saveLayer(layerName);

    // Only save relationships if they were modified
    if (model.relationships.isDirty()) {
      await model.saveRelationships();
    }

    await model.saveManifest();

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
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  } finally {
    if (isTelemetryEnabled) {
      endSpan(span);
    }
  }
}
