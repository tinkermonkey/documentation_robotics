import { Element } from "../../src/core/element.js";
import { Layer } from "../../src/core/layer.js";

/**
 * Find an element by semantic ID format.
 * Helper for tests that need to look up elements by semantic ID.
 * - Dot-separated: {layer}.{type}.{kebab-name}
 * - Hyphen-separated: {layer}-{type}-{kebab-name}
 *
 * @param layer - The layer to search in
 * @param semanticId - Semantic ID of the element to find
 * @returns The element if found, undefined if not found
 */
export function findElementBySemanticId(
  layer: Layer,
  semanticId: string
): Element | undefined {
  const dotCount = (semanticId.match(/\./g) || []).length;
  const isDotSeparated = dotCount >= 2;
  const isHyphenSeparated =
    semanticId.includes("-") &&
    semanticId.startsWith(layer.name) &&
    semanticId.length > layer.name.length + 1;

  if (!isDotSeparated && !isHyphenSeparated) {
    return undefined;
  }

  // Search all nodes in the layer
  for (const candidate of layer.elements.values()) {
    // Build semantic IDs from element name - must match toKebabCase in id-generator.ts
    let kebabName = candidate.name.replace(/[\s_]+/g, "-");
    kebabName = kebabName.replace(/([a-z])([A-Z])/g, "$1-$2");
    kebabName = kebabName.toLowerCase();
    kebabName = kebabName.replace(/\./g, "");
    kebabName = kebabName.replace(/[^a-z0-9-]/g, ""); // Remove non-alphanumeric except hyphens
    kebabName = kebabName.replace(/-+/g, "-");
    kebabName = kebabName.replace(/^-+|-+$/g, "");

    const semanticIds = [
      `${candidate.layer_id || layer.name}.${candidate.type}.${kebabName}`,
      `${candidate.layer_id || layer.name}-${candidate.type}-${kebabName}`,
    ];

    if (semanticIds.includes(semanticId)) {
      return layer.getElement(candidate.id);
    }
  }

  return undefined;
}
