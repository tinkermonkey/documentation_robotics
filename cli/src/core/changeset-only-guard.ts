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

const ON_VALUES = new Set(["true", "1", "yes", "on"]);
const OFF_VALUES = new Set(["false", "0", "no", "off"]);
const warnedValues = new Set<string>();

/**
 * Whether this process may only change the model through a changeset.
 *
 * Unset or empty means off. true/1/yes/on (any case) mean on, false/0/no/off mean off. Any
 * other value fails safe: the guard is on, and a warning naming the value goes to stderr once,
 * so a typo never silently lets an agent write the base model.
 */
export function isChangesetOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CHANGESET_ONLY_ENV];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === "" || OFF_VALUES.has(value)) return false;
  if (ON_VALUES.has(value)) return true;
  if (!warnedValues.has(raw)) {
    warnedValues.add(raw);
    console.error(
      `[dr] ${CHANGESET_ONLY_ENV}=${JSON.stringify(raw)} is not a recognised value ` +
        "(use true/1/yes/on or false/0/no/off); treating it as on, so base-model writes are refused."
    );
  }
  return true;
}

/** Test hook: forget which unrecognised values have already been warned about. */
export function resetChangesetOnlyWarnings(): void {
  warnedValues.clear();
}

/** Thrown by `assertBaseModelWritable()`, so callers (e.g. the MCP server) can recognise the refusal. */
export class ChangesetOnlyError extends CLIError {
  constructor(...args: ConstructorParameters<typeof CLIError>) {
    super(...args);
    this.name = "ChangesetOnlyError";
  }
}

/** Throws when this process may only change the model through a changeset. */
export function assertBaseModelWritable(env: NodeJS.ProcessEnv = process.env): void {
  if (!isChangesetOnly(env)) return;
  throw new ChangesetOnlyError(
    "This session can only change the model through a changeset, and no changeset is active.",
    ErrorCategory.USER,
    [
      'Run "dr changeset create <name>" (it activates the new changeset), or "dr changeset activate <name>"',
      "Then re-run the command: it will be staged in the changeset for the user to review and commit",
    ],
    { operation: "save model", context: `${CHANGESET_ONLY_ENV}=${env[CHANGESET_ONLY_ENV]}` }
  );
}
