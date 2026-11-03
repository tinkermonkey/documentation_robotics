/**
 * Changeset-only guard for chat agents.
 *
 * `dr visualize --with-changesets` lets its chat agent run `dr add`, `dr update` and
 * `dr relationship add`. Those commands stage their change when a changeset is active,
 * but write straight to the model when none is, and Claude Code's permission rules can't
 * tell the two apart. So the agent process runs with `CHANGESET_ONLY_ENV` set, and every
 * method that saves the base model calls `assertBaseModelWritable()` first: with the
 * variable set, the write fails and nothing on disk changes. Staging writes go to the
 * changeset store, not through the model, so they are unaffected.
 */
import { CLIError, ErrorCategory } from "../utils/errors.js";

export const CHANGESET_ONLY_ENV = "DR_CHANGESET_ONLY";

export function isChangesetOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CHANGESET_ONLY_ENV] === "true";
}

/** Throws when this process may only change the model through a changeset. */
export function assertBaseModelWritable(env: NodeJS.ProcessEnv = process.env): void {
  if (!isChangesetOnly(env)) return;
  throw new CLIError(
    "This session can only change the model through a changeset, and no changeset is active.",
    ErrorCategory.USER,
    [
      'Run "dr changeset create <name>" (it activates the new changeset), or "dr changeset activate <name>"',
      "Then re-run the command: it will be staged in the changeset for the user to review and commit",
    ],
    { operation: "save model", context: `${CHANGESET_ONLY_ENV}=true` }
  );
}
