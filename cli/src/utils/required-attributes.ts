/**
 * What a node type requires, with what each required attribute takes, so a caller can send valid
 * attributes the first time instead of learning them from a refusal (#1153). One source for the
 * model_add refusal, dr add's message and the codebase_extract cards.
 */

import { getNodeType, type SpecNodeId } from "../generated/node-types.js";

/**
 * A type's required attributes as `attribute → what it takes` ("one of [a, b]", "string"), or
 * undefined when the type requires none or the spec does not define it.
 */
export function requiredAttributesOf(specNodeId: string): Record<string, string> | undefined {
  const info = getNodeType(specNodeId as SpecNodeId);
  if (!info || info.requiredAttributes.length === 0) return undefined;
  return Object.fromEntries(
    info.requiredAttributes.map((name) => {
      const constraint = (info.attributeConstraints[name] ?? {}) as { type?: unknown; enum?: unknown[] };
      const takes = Array.isArray(constraint.enum)
        ? `one of [${constraint.enum.join(", ")}]`
        : typeof constraint.type === "string"
          ? constraint.type
          : "any value";
      return [name, takes];
    })
  );
}

/**
 * The required attributes of each of these types that has any, keyed by `layer.type`. Wildcards
 * (`layer.*`) and unknown types are skipped.
 */
export function requiredAttributesFor(specNodeIds: Iterable<string>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const id of [...new Set(specNodeIds)].sort()) {
    if (id.endsWith(".*")) continue;
    const required = requiredAttributesOf(id);
    if (required) out[id] = required;
  }
  return out;
}

/** One line naming what a type requires, for a refusal's suggestions; undefined when nothing. */
export function requiredAttributesLine(specNodeId: string): string | undefined {
  const required = requiredAttributesOf(specNodeId);
  if (!required) return undefined;
  const parts = Object.entries(required).map(([name, takes]) => `${name} (${takes})`);
  return `${specNodeId} requires: ${parts.join("; ")}`;
}
