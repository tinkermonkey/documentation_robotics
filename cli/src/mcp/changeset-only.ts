/**
 * Changeset-only mode on the MCP server.
 *
 * When `dr mcp` runs with DR_CHANGESET_ONLY=true (DrBot under `dr visualize --with-changesets`
 * starts it that way), an agent may change the model only by staging into an active changeset.
 * The tools below write the base model when no changeset is active, so the tool registry asks
 * `changesetOnlyRefusal()` before running them and returns its refusal instead: the agent is told
 * to call changeset_create (or changeset_activate) and retry.
 *
 * This check runs before the handler so a refused call never touches the cached in-memory model.
 * Any other base-model save still hits the core guard (core/changeset-only-guard.ts), whose
 * ChangesetOnlyError runTool turns into the same refusal, after dropping the model cache so a
 * half-applied in-memory edit can't linger.
 */

import type { Model } from "../core/model.js";
import { isChangesetOnly, CHANGESET_ONLY_ENV } from "../core/changeset-only-guard.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../utils/errors.js";
import { activeStagedChangeset } from "./tools/changeset-shared.js";

/** Tools that write the base model when no changeset is active. */
export const BASE_MODEL_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "model_add",
  "model_update",
  "model_delete",
  "relationship_add",
  "relationship_delete",
]);

/** The error an agent gets for a base-model write in changeset-only mode. */
export function changesetOnlyError(toolName?: string): CLIError {
  const retry = toolName ? `Then call "${toolName}" again` : "Then retry the call";
  return new CLIError(
    "This session can only change the model through a changeset, and no changeset is active.",
    ErrorCategory.USER,
    [
      'Call "changeset_create" with a name for the change (it activates the new changeset), or ' +
        '"changeset_activate" to resume one from "changeset_list"',
      `${retry}: it will be staged in the changeset for the user to review and commit`,
    ],
    { operation: toolName ?? "save model", context: `${CHANGESET_ONLY_ENV}=${process.env[CHANGESET_ONLY_ENV] ?? "true"}` }
  );
}

/**
 * The refusal for this call, or null when it may run: always null outside changeset-only mode,
 * for tools that don't write the base model, and when a staged changeset is active.
 *
 * If the model or the active changeset can't be read, the check steps aside (null, logged) and
 * the tool reports that failure itself; the core guard still stops any base-model save.
 */
export async function changesetOnlyRefusal(
  toolName: string,
  rootPath: string | undefined,
  loadModel: (rootPath?: string) => Promise<Model>,
  env: NodeJS.ProcessEnv = process.env
): Promise<CLIError | null> {
  if (!isChangesetOnly(env) || !BASE_MODEL_WRITE_TOOLS.has(toolName)) {
    return null;
  }
  try {
    const model = await loadModel(rootPath);
    const active = await activeStagedChangeset(new StagingAreaManager(model.rootPath, model));
    return active ? null : changesetOnlyError(toolName);
  } catch (error) {
    console.error(`[mcp] changeset-only check for ${toolName} skipped: ${getErrorMessage(error)}`);
    return null;
  }
}
