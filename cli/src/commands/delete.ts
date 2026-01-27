/**
 * Delete an element
 */

import { confirm } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { MutationHandler } from '../core/mutation-handler.js';
import { ReferenceRegistry } from '../core/reference-registry.js';
import { DependencyTracker, TraceDirection } from '../core/dependency-tracker.js';
import { findElementLayer } from '../utils/element-utils.js';
import { CLIError, handleError, ErrorCategory } from '../utils/errors.js';
import { startSpan, endSpan } from '../telemetry/index.js';

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== 'undefined' ? TELEMETRY_ENABLED : false;

export interface DeleteOptions {
  force?: boolean;
  verbose?: boolean;
  debug?: boolean;
  cascade?: boolean;
  dryRun?: boolean;
}

export async function deleteCommand(id: string, options: DeleteOptions): Promise<void> {
  const span = isTelemetryEnabled ? startSpan('element.delete', {
    'element.id': id,
    'element.force': !!options.force,
    'element.cascade': !!options.cascade,
    'element.dryRun': !!options.dryRun,
  }) : null;

  try {
    // Load model
    const model = await Model.load();

    // Find element
    const layerName = await findElementLayer(model, id);
    if (!layerName) {
      throw new CLIError(
        `Element ${id} not found`,
        ErrorCategory.NOT_FOUND,
        [
          `Use "dr search ${id}" to find similar elements`,
          'Use "dr list <layer>" to list all elements in a layer',
        ]
      );
    }

    const layer = (await model.getLayer(layerName))!;
    const element = layer.getElement(id)!;

    // Build reference registry to track dependencies
    const registry = new ReferenceRegistry();
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    // Create dependency tracker
    const tracker = new DependencyTracker(registry, model);

    // Find all elements that depend on this element (would be orphaned)
    const dependents = tracker.traceDependencies(id, TraceDirection.DOWN, null);

    // Display element information
    console.log('');
    console.log(ansis.bold(`Removing element: ${ansis.yellow(id)}`));
    console.log(ansis.dim(`  Layer: ${layerName}`));
    console.log(ansis.dim(`  Type: ${element.type || 'unknown'}`));
    if (element.name) {
      console.log(ansis.dim(`  Name: ${element.name}`));
    }

    // Display dependencies if any exist
    if (dependents.length > 0) {
      console.log('');
      console.log(
        ansis.yellow(
          `⚠ Warning: This element has ${dependents.length} dependent element(s):`
        )
      );

      const directDependents = tracker.traceDependencies(id, TraceDirection.DOWN, 1);

      // Show direct dependents
      for (const dep of directDependents.slice(0, 5)) {
        const depElement = model.getElementById(dep);
        const depLayer = depElement?.layer || 'unknown';
        console.log(ansis.dim(`  - ${dep} (${depLayer})`));
      }

      if (directDependents.length > 5) {
        console.log(ansis.dim(`  ... and ${directDependents.length - 5} more direct dependents`));
      }

      if (dependents.length > directDependents.length) {
        console.log(ansis.dim(`  (${dependents.length - directDependents.length} transitive dependents not shown)`));
      }

      // Check if cascade or force is enabled
      if (!options.cascade && !options.force) {
        console.log('');
        console.log(ansis.red('✗ Cannot remove element with dependencies.'));
        console.log(ansis.dim('Use --cascade to remove all dependent elements'));
        console.log(ansis.dim('or --force to skip dependency checks'));
        const suggestions = [
          `Use --dry-run with --cascade to preview what would be deleted`,
          'Review dependencies before deletion using "dr show <element>"',
          'Use --cascade to automatically remove all dependent elements',
          'Or use --force to remove only this element (dependencies will reference a non-existent element)',
        ];
        throw new CLIError('Element has dependencies', ErrorCategory.USER, suggestions, {
          operation: 'delete',
          relatedElements: directDependents.slice(0, 10),
          context: `Element ${id} has ${dependents.length} dependent elements`,
        });
      }
    }

    // Calculate total elements to remove
    const elementsToRemove = options.cascade ? [id, ...dependents] : [id];

    // Display dry-run summary
    if (options.dryRun) {
      console.log('');
      console.log(ansis.yellow(`Dry run - not removing`));
      console.log(ansis.dim(`Would remove ${elementsToRemove.length} element(s)`));

      if (options.cascade && dependents.length > 0) {
        console.log('');
        console.log(ansis.dim('Elements that would be removed:'));
        console.log(ansis.dim(`  - ${id} (target)`));
        for (const dep of dependents.slice(0, 10)) {
          console.log(ansis.dim(`  - ${dep} (dependent)`));
        }
        if (dependents.length > 10) {
          console.log(ansis.dim(`  ... and ${dependents.length - 10} more`));
        }
      }

      return;
    }

    // Confirm deletion unless --force
    if (!options.force) {
      const message = options.cascade && dependents.length > 0
        ? `Delete ${ansis.bold(id)} and ${ansis.bold(String(dependents.length))} dependent element(s)? This cannot be undone.`
        : `Delete element ${ansis.bold(id)}? This cannot be undone.`;

      const confirmed = await confirm({
        message,
        initialValue: false,
      });

      if (!confirmed) {
        console.log(ansis.dim('Cancelled'));
        process.exit(0);
      }
    }

    // Execute deletion with error recovery guidance
    let deletedCount = 0;
    try {
      if (options.cascade && dependents.length > 0) {
        // Delete dependents first (reverse dependency order to avoid orphaned references)
        const sortedDependents = [...dependents].reverse();

        for (const depId of sortedDependents) {
          try {
            const depLayerName = await findElementLayer(model, depId);
            if (!depLayerName) continue;

            const depLayer = (await model.getLayer(depLayerName))!;
            const depElement = depLayer.getElement(depId)!;

            const handler = new MutationHandler(model, depId, depLayerName);
            await handler.executeDelete(depElement);
            deletedCount++;

            if (options.verbose) {
              console.log(ansis.dim(`  Deleted dependent: ${depId}`));
            }
          } catch (depError) {
            // Track partial progress for error recovery
            const suggestions = [
              `${deletedCount} dependent element(s) were deleted before the error`,
              'Check the model state with "dr validate" to identify any broken references',
              'You may need to manually delete remaining elements or use "dr show" to inspect',
            ];
            throw new CLIError(
              `Failed to delete dependent element ${depId}`,
              ErrorCategory.SYSTEM,
              suggestions,
              {
                operation: 'delete (cascade)',
                partialProgress: { completed: deletedCount, total: sortedDependents.length },
                relatedElements: [id, ...sortedDependents.slice(0, 5)],
              }
            );
          }
        }
      }
    } catch (error) {
      // If we're in the middle of cascade deletion, provide recovery info
      if (options.cascade && deletedCount > 0 && !(error instanceof CLIError)) {
        const suggestions = [
          `${deletedCount} dependent element(s) were successfully deleted`,
          'Use "dr validate" to check for broken references',
          'The target element was not deleted - you can retry the operation',
        ];
        throw new CLIError(
          'Cascade deletion was partially completed but encountered an error',
          ErrorCategory.SYSTEM,
          suggestions,
          {
            operation: 'delete (cascade)',
            partialProgress: { completed: deletedCount, total: dependents.length },
          }
        );
      }
      throw error;
    }

    // Delete the target element
    const handler = new MutationHandler(model, id, layerName);
    await handler.executeDelete(element);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('layer.name', layerName);
      (span as any).setAttribute('element.dependents', dependents.length);
      (span as any).setAttribute('element.totalDeleted', elementsToRemove.length);
    }

    console.log('');
    console.log(ansis.green(`✓ Deleted element ${ansis.bold(id)}`));

    if (options.cascade && dependents.length > 0) {
      console.log(ansis.green(`✓ Deleted ${dependents.length} dependent element(s)`));
    }

    if (options.verbose) {
      console.log(ansis.dim(`  Layer: ${layerName}`));
      console.log(ansis.dim(`  Total elements deleted: ${elementsToRemove.length}`));
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
