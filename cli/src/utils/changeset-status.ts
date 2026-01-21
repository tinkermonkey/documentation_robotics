/**
 * Changeset Status Display Utility
 *
 * Provides user feedback about active changeset status in command output
 */

import ansis from 'ansis';
import type { Model } from '../core/model.js';

/**
 * Display the current changeset status at the start of a command
 * Shows either "None" (yellow) or the active changeset name (green)
 *
 * @param model The model instance
 */
export async function displayChangesetStatus(model: Model): Promise<void> {
  const context = model.getActiveChangesetContext();
  const activeChangeset = await context.getActive();

  if (activeChangeset) {
    console.log(ansis.dim('Active changeset: ') + ansis.green(ansis.bold(activeChangeset)));
  } else {
    console.log(ansis.dim('Active changeset: ') + ansis.yellow(ansis.bold('None')));
  }
}
