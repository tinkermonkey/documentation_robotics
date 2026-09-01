/**
 * Shape check for "does this string plausibly identify a DR model element" — a UUIDv4
 * (element.id), a dot-separated `{layer}.{type}.{slug}` id whose first segment is a real,
 * known DR layer (matching the id scheme `NamingValidator` enforces on every element), or
 * a qualified cross-model reference in the format `@{model-name}/{layer}.{type}.{slug}`.
 *
 * Used by `ReferenceRegistry` to gate its `*Ref`/`*Reference` attribute-name heuristic: an
 * attribute NAME matching that convention is not, by itself, reliable evidence that its VALUE
 * is an element reference — `api.link.operationRef` is a schema-declared OpenAPI URL fragment
 * (e.g. "#/paths/~1users/get"), not an element id, and matches the naming convention purely by
 * coincidence. Checking the value's shape catches that case (and any future one like it)
 * without needing per-attribute schema annotations that don't exist today.
 *
 * Deliberately a shape check, not an existence check: a value that looks like an element id but
 * doesn't resolve to one is exactly what `ReferenceRegistry.findBrokenReferences()` is supposed
 * to catch, so this must not filter those out too.
 */
import { getAllLayerIds } from "../generated/layer-registry.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUALIFIED_PREFIX_PATTERN = /^@[a-z0-9][a-z0-9_-]*\//i;
const KNOWN_LAYERS = new Set(getAllLayerIds());

export function looksLikeElementReference(value: string): boolean {
  if (UUID_PATTERN.test(value)) return true;

  // Check for qualified reference format: @{model-name}/{layer}.{type}.{slug}
  if (QUALIFIED_PREFIX_PATTERN.test(value)) {
    // Extract segment after @model-name/ and check if it looks like an element path
    const slashIndex = value.indexOf("/");
    if (slashIndex > 0 && slashIndex < value.length - 1) {
      const segment = value.substring(slashIndex + 1);
      const dotIndex = segment.indexOf(".");
      if (dotIndex > 0) {
        return KNOWN_LAYERS.has(segment.slice(0, dotIndex));
      }
    }
    return false;
  }

  // Check for unqualified reference format: {layer}.{type}.{slug}
  const dotIndex = value.indexOf(".");
  if (dotIndex <= 0) return false;

  return KNOWN_LAYERS.has(value.slice(0, dotIndex));
}
