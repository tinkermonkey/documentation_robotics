/**
 * Trace command - display dependency trace for an element
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { ReferenceRegistry } from '../core/reference-registry.js';
import { DependencyTracker } from '../core/dependency-tracker.js';
import { fileExists } from '../utils/file-io.js';
import { findElementLayer } from '../utils/element-utils.js';

export async function traceCommand(
  elementId: string,
  options: {
    direction?: 'up' | 'down' | 'both';
    depth?: number;
    showMetrics?: boolean;
  } = {}
): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

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

    // Get dependency graph and create tracker
    const graph = registry.getDependencyGraph();
    const tracker = new DependencyTracker(graph);

    // Set default direction
    const direction = options.direction || 'both';
    const showMetrics = options.showMetrics ?? false;

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
      const transitiveDependents = tracker.getTransitiveDependents(elementId);
      const directDependents = tracker.getDependents(elementId);

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
          d => !directDependents.includes(d)
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
      const transitiveDependencies = tracker.getTransitiveDependencies(
        elementId
      );
      const directDependencies = tracker.getDependencies(elementId);

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
          d => !directDependencies.includes(d)
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

    // Detect and display cycles
    const cycles = tracker.detectCycles();
    if (cycles.length > 0) {
      console.log('');
      console.log(
        ansis.yellow(
          `⚠️  Warning: ${cycles.length} cycle(s) detected in the dependency graph`
        )
      );
      for (const cycle of cycles.slice(0, 5)) {
        const cycleStr = cycle.join(ansis.yellow(' → '));
        console.log(`  ${cycleStr}`);
      }
      if (cycles.length > 5) {
        console.log(
          ansis.dim(`  ... and ${cycles.length - 5} more cycle(s)`)
        );
      }
    }

    // Display metrics if requested
    if (showMetrics) {
      console.log('');
      console.log(ansis.bold('Graph Metrics:'));
      const metrics = tracker.getMetrics();
      console.log(`  ${ansis.gray('Nodes:')}                ${metrics.nodeCount}`);
      console.log(`  ${ansis.gray('Edges:')}                ${metrics.edgeCount}`);
      console.log(
        `  ${ansis.gray('Connected Components:')} ${metrics.connectedComponents}`
      );
      console.log(`  ${ansis.gray('Cycles:')}               ${metrics.cycleCount}`);

      // Display element-specific metrics
      console.log('');
      console.log(ansis.bold('Element Metrics:'));
      const impactRadius = tracker.getImpactRadius(elementId);
      const dependencyDepth = tracker.getDependencyDepth(elementId);
      console.log(`  ${ansis.gray('Impact Radius:')} ${impactRadius} elements`);
      console.log(`  ${ansis.gray('Dependency Depth:')} ${dependencyDepth}`);
    }

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
