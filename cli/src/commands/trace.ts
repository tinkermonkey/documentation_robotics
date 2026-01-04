/**
 * Trace command - display dependency trace for an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { ReferenceRegistry } from '../core/reference-registry.js';
import { DependencyTracker, TraceDirection } from '../core/dependency-tracker.js';
import { findElementLayer } from '../utils/element-utils.js';

export async function traceCommand(
  elementId: string,
  options: {
    direction?: 'up' | 'down' | 'both';
    depth?: number;
    showMetrics?: boolean;
    model?: string;
  } = {}
): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model);

    // Find element
    const layerName = await findElementLayer(model, elementId);
    if (!layerName) {
      console.error(ansis.red(`Error: Element ${elementId} not found`));
      process.exit(1);
    }

    // Build reference registry
    const registry = new ReferenceRegistry();
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    // Create dependency tracker with registry
    const tracker = new DependencyTracker(registry);

    // Set default direction
    const direction = options.direction || 'both';

    // Display header
    console.log('');
    console.log(
      ansis.bold(
        `${ansis.blue('Dependency Trace:')} ${ansis.yellow(elementId)}`
      )
    );
    console.log(ansis.dim('─'.repeat(80)));

    // Display dependents (elements that depend on this element - upward)
    if (direction === 'up' || direction === 'both') {
      const transitiveDependents = tracker.traceDependencies(elementId, TraceDirection.DOWN, null);
      const directDependents = tracker.traceDependencies(elementId, TraceDirection.DOWN, 1);

      console.log('');
      console.log(
        ansis.cyan(
          `Dependents (${directDependents.length} direct, ${transitiveDependents.length} transitive):`
        )
      );

      if (directDependents.length === 0) {
        console.log(ansis.dim('  (none)'));
      } else {
        // Show direct dependents with indentation
        console.log(ansis.gray('  Direct:'));
        for (const dep of directDependents.slice(0, 10)) {
          console.log(
            `    ${ansis.yellow('←')} ${ansis.green(dep)}`
          );
        }
        if (directDependents.length > 10) {
          console.log(
            ansis.dim(`    ... and ${directDependents.length - 10} more`)
          );
        }
      }

      if (transitiveDependents.length > 0 && directDependents.length > 0) {
        console.log(ansis.gray('  Transitive:'));
        const transitiveOnly = transitiveDependents.filter(
          (d: string) => !directDependents.includes(d)
        );
        for (const dep of transitiveOnly.slice(0, 10)) {
          console.log(
            `    ${ansis.yellow('↖')} ${ansis.dim(dep)}`
          );
        }
        if (transitiveOnly.length > 10) {
          console.log(
            ansis.dim(`    ... and ${transitiveOnly.length - 10} more`)
          );
        }
      }
    }

    // Display dependencies (elements this element depends on - downward)
    if (direction === 'down' || direction === 'both') {
      const transitiveDependencies = tracker.traceDependencies(
        elementId,
        TraceDirection.UP,
        null
      );
      const directDependencies = tracker.traceDependencies(elementId, TraceDirection.UP, 1);

      console.log('');
      console.log(
        ansis.cyan(
          `Dependencies (${directDependencies.length} direct, ${transitiveDependencies.length} transitive):`
        )
      );

      if (directDependencies.length === 0) {
        console.log(ansis.dim('  (none)'));
      } else {
        // Show direct dependencies with indentation
        console.log(ansis.gray('  Direct:'));
        for (const dep of directDependencies.slice(0, 10)) {
          console.log(
            `    ${ansis.yellow('→')} ${ansis.green(dep)}`
          );
        }
        if (directDependencies.length > 10) {
          console.log(
            ansis.dim(`    ... and ${directDependencies.length - 10} more`)
          );
        }
      }

      if (transitiveDependencies.length > 0 && directDependencies.length > 0) {
        console.log(ansis.gray('  Transitive:'));
        const transitiveOnly = transitiveDependencies.filter(
          (d: string) => !directDependencies.includes(d)
        );
        for (const dep of transitiveOnly.slice(0, 10)) {
          console.log(
            `    ${ansis.yellow('↘')} ${ansis.dim(dep)}`
          );
        }
        if (transitiveOnly.length > 10) {
          console.log(
            ansis.dim(`    ... and ${transitiveOnly.length - 10} more`)
          );
        }
      }
    }

    // Note: Advanced features like cycle detection and metrics are not yet implemented
    // in the refactored DependencyTracker matching Python CLI API

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
