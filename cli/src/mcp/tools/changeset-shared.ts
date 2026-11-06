/**
 * Helpers shared by the changeset-planning MCP tools.
 */

import type { Changeset } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";

/** Loads a changeset by id or name, or the active one when none is named. */
export async function resolveChangeset(
  manager: StagingAreaManager,
  changesetId?: string
): Promise<Changeset> {
  const id = changesetId ?? (await manager.getActiveId());
  if (!id) {
    throw new CLIError("No changeset named and none is active", ErrorCategory.USER, [
      'Pass "changesetId", or use "changeset_create" / "changeset_activate" first',
      'Use "changeset_list" to see existing changesets',
    ]);
  }
  const changeset = await manager.load(id);
  if (!changeset) {
    throw new CLIError(`Changeset ${id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "changeset_list" to see all available changesets',
    ]);
  }
  return changeset;
}

/** The active changeset when it can still accept changes, else null. */
export async function activeStagedChangeset(manager: StagingAreaManager): Promise<Changeset | null> {
  const active = await manager.getActive();
  return active && active.status === "staged" ? active : null;
}

/** Builds the projected graph for a changeset (by id/name, or the active one). */
export async function loadChangesetGraph(
  model: Model,
  changesetId?: string
): Promise<{ manager: StagingAreaManager; changeset: Changeset; graph: ChangesetGraph }> {
  const manager = new StagingAreaManager(model.rootPath, model);
  const changeset = await resolveChangeset(manager, changesetId);
  const graph = await ChangesetGraph.build(model, changeset);
  return { manager, changeset, graph };
}
