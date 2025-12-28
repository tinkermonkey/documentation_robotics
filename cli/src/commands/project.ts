/**
 * Project command - project dependencies across layers
 *
 * NOTE: This command needs refactoring to use the new ProjectionEngine API
 * for element creation, or use DependencyTracker for dependency traversal.
 * Currently disabled pending refactoring.
 */

import ansis from 'ansis';

export async function projectCommand(
  _elementId: string,
  _targetLayer: string,
  _options: {
    reverse?: boolean;
    maxDepth?: number;
    showReachability?: boolean;
  } = {}
): Promise<void> {
  console.error(ansis.red('Error: Project command is currently disabled pending refactoring.'));
  console.error(ansis.yellow('The ProjectionEngine has been refactored for element creation.'));
  console.error(ansis.yellow('Use the trace command for dependency traversal.'));
  process.exit(1);
}
