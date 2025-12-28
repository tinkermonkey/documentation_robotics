/**
 * Project command - project dependencies across layers
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { ProjectionEngine, type ProjectionRule } from '../core/projection-engine.js';
import { fileExists } from '../utils/file-io.js';
import { findElementLayer } from '../utils/element-utils.js';

/**
 * Default projection rules - follow references across most layers
 */
function getDefaultProjectionRules(): ProjectionRule[] {
  return [
    // Motivation → Business
    { sourceLayer: '01', targetLayer: '02' },
    // Business → Security
    { sourceLayer: '02', targetLayer: '03' },
    // Business → Application
    { sourceLayer: '02', targetLayer: '04' },
    // Security → Application
    { sourceLayer: '03', targetLayer: '04' },
    // Application → Technology
    { sourceLayer: '04', targetLayer: '05' },
    // Technology → API
    { sourceLayer: '05', targetLayer: '06' },
    // API → Data Model
    { sourceLayer: '06', targetLayer: '07' },
    // Data Model → Data Store
    { sourceLayer: '07', targetLayer: '08' },
    // Application → UX
    { sourceLayer: '04', targetLayer: '09' },
    // UX → Navigation
    { sourceLayer: '09', targetLayer: '10' },
    // Application → APM
    { sourceLayer: '04', targetLayer: '11' },
    // Application → Testing
    { sourceLayer: '04', targetLayer: '12' },
    // Technology → Testing
    { sourceLayer: '05', targetLayer: '12' },
    // API → Testing
    { sourceLayer: '06', targetLayer: '12' },
    // Data Store → Testing
    { sourceLayer: '08', targetLayer: '12' },
  ];
}

export async function projectCommand(
  elementId: string,
  targetLayer: string,
  options: {
    reverse?: boolean;
    maxDepth?: number;
    showReachability?: boolean;
  } = {}
): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/model/manifest.yaml`))) {
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

    // Create and configure projection engine
    const engine = new ProjectionEngine();
    const rules = getDefaultProjectionRules();
    for (const rule of rules) {
      engine.addRule(rule);
    }

    // Extract layer prefix from target layer
    const normalizedTarget = targetLayer.startsWith('0')
      ? targetLayer
      : targetLayer.padStart(2, '0');

    // Set default options
    const reverse = options.reverse ?? false;
    const maxDepth = options.maxDepth ?? 10;
    const showReachability = options.showReachability ?? false;

    // Display header
    console.log('');
    console.log(
      ansis.bold(
        `${ansis.blue('Dependency Projection:')} ${ansis.yellow(elementId)} → ${ansis.cyan(normalizedTarget)}`
      )
    );
    console.log(ansis.dim('─'.repeat(80)));

    // Perform projection
    let results;
    if (reverse) {
      results = await engine.projectReverse(
        model,
        elementId,
        normalizedTarget
      );
      console.log('');
      console.log(
        ansis.cyan(`Elements in layer ${normalizedTarget} that lead to ${elementId}:`)
      );
    } else {
      results = await engine.project(model, elementId, normalizedTarget);
      console.log('');
      console.log(
        ansis.cyan(
          `Elements in layer ${normalizedTarget} that ${elementId} depends on:`
        )
      );
    }

    // Display results
    if (results.length === 0) {
      console.log(ansis.dim('  (no projections found)'));
    } else {
      for (let i = 0; i < Math.min(results.length, 20); i++) {
        const element = results[i];
        console.log(`  ${ansis.green('✓')} ${ansis.yellow(element.id)}`);
        if (element.name) {
          console.log(`    ${ansis.gray('Name:')} ${element.name}`);
        }
        if (element.description) {
          console.log(`    ${ansis.gray('Description:')} ${element.description}`);
        }
      }

      if (results.length > 20) {
        console.log(
          ansis.dim(`  ... and ${results.length - 20} more element(s)`)
        );
      }

      console.log('');
      console.log(
        ansis.bold(`Total: ${ansis.yellow(String(results.length))} element(s)`)
      );
    }

    // Show reachability analysis if requested
    if (showReachability) {
      console.log('');
      console.log(ansis.bold('Reachability Analysis:'));

      const reachable = await engine.getReachable(model, elementId, maxDepth);

      if (reachable.size === 0) {
        console.log(ansis.dim('  (no reachable elements)'));
      } else {
        // Group by depth
        const byDepth = new Map<number, string[]>();
        for (const [elemId, depth] of reachable.entries()) {
          if (!byDepth.has(depth)) {
            byDepth.set(depth, []);
          }
          byDepth.get(depth)!.push(elemId);
        }

        // Display by depth
        const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
        for (const depth of sortedDepths) {
          const elements = byDepth.get(depth)!;
          console.log(
            ansis.gray(`  Depth ${depth} (${elements.length} element(s)):`)
          );
          for (const elem of elements.slice(0, 5)) {
            console.log(`    ${ansis.dim('•')} ${elem}`);
          }
          if (elements.length > 5) {
            console.log(
              ansis.dim(`    ... and ${elements.length - 5} more`)
            );
          }
        }
      }
    }

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
