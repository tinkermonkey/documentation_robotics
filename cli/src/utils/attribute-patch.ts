/**
 * Attribute updates for `dr update` and the MCP `model_update` tool.
 *
 * `attributes` replaces an element's attributes; `attributePatch` merges into them, so changing one
 * attribute does not mean repeating every required one. A `null` value in a patch removes that key.
 * Both callers resolve the new attributes here so they behave the same; schema validation then runs
 * on the result.
 */

import { CLIError, ErrorCategory } from "./errors.js";

export type AttributePatch = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Merges `patch` over `current` (shallow: a patched key's value replaces the old one), removing keys
 * whose patch value is `null`. Returns a new object; `current` is not modified (staged `before`
 * snapshots share the element's attributes object).
 */
export function applyAttributePatch(
  current: Record<string, unknown> | undefined,
  patch: AttributePatch
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * The patch as an update: an empty patch names no key, so it changes nothing and is not an update
 * (callers then report "No fields specified" and stage nothing).
 */
export function effectiveAttributePatch(patch: AttributePatch | undefined): AttributePatch | undefined {
  return patch !== undefined && Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The attributes an update asks for: `attributes` as given (replace), or `attributePatch` merged
 * over `current`, or undefined when the update leaves attributes alone. Passing both is an error.
 *
 * @param flags how the two options are spelled to the caller, for the error message
 */
export function resolveAttributeUpdate(
  current: Record<string, unknown> | undefined,
  update: { attributes?: Record<string, unknown>; attributePatch?: AttributePatch },
  flags: { attributes: string; attributePatch: string } = { attributes: "attributes", attributePatch: "attributePatch" }
): Record<string, unknown> | undefined {
  if (update.attributes !== undefined && update.attributePatch !== undefined) {
    throw new CLIError(`Cannot use ${flags.attributes} and ${flags.attributePatch} together`, ErrorCategory.USER, [
      `Use ${flags.attributes} to replace all attributes, or ${flags.attributePatch} to change only the keys it names`,
    ]);
  }
  if (update.attributes !== undefined) return update.attributes;
  if (update.attributePatch !== undefined) return applyAttributePatch(current, update.attributePatch);
  return undefined;
}

/** Parses a CLI JSON option that must be an object (`--attributes`, `--attribute-patch`). */
export function parseJsonObjectOption(raw: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CLIError(`Invalid JSON in ${flag}`, ErrorCategory.USER, ["Ensure your JSON is valid and properly formatted"]);
  }
  if (!isPlainObject(parsed)) {
    throw new CLIError(`${flag} must be a JSON object`, ErrorCategory.USER, [`Example: ${flag} '{"summary":"New summary"}'`]);
  }
  return parsed;
}
