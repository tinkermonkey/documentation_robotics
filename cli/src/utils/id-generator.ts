/**
 * Element ID generation: the one place an element id is derived from a name.
 *
 * `dr add`, the MCP model_add tool and extraction (codebase_extract) all call
 * {@link deriveElementId}, so the same name gives the same id whichever of them makes the element
 * (#1225). An id is derived once, when its element is created, and stored on the element: a change
 * to these rules never renames an element that already exists.
 */

import crypto from "node:crypto";

/**
 * Convert text to kebab-case.
 * Matches Python implementation in utils/id_generator.py
 *
 * @example
 * toKebabCase("Customer Management") // "customer-management"
 * toKebabCase("CustomerManagement")  // "customer-management"
 * toKebabCase("customer_management") // "customer-management"
 * toKebabCase("PetTypeRepository.findPetTypes") // "pet-type-repository-find-pet-types"
 * toKebabCase("Node.js")             // "nodejs"
 * toKebabCase("Tier1Status")         // "tier1-status"
 * toKebabCase("Tier1 Panel")         // "tier1-panel"
 * toKebabCase("Vector3D")            // "vector3d"
 */
export function toKebabCase(text: string): string {
  // A dot between code-symbol parts is a word break: "Repo.findAll" → "Repo-findAll". A part is a
  // code symbol when it is camelCase (a lowercase letter followed by an uppercase one). Other dots
  // are dropped below, so "Node.js", "ASP.NET" and "1.2.3" join as before.
  let result = text.replace(/[A-Za-z0-9$]+(?:\.[A-Za-z0-9$]+)+/g, (chain) => {
    const parts = chain.split(".");
    const camel = (part: string) => /[a-z][A-Z]/.test(part);
    return parts.reduce((joined, part, i) => {
      if (i === 0) return part;
      return joined + (camel(parts[i - 1]) || camel(part) ? "-" : ".") + part;
    }, "");
  });

  // Replace spaces and underscores with hyphens
  result = result.replace(/[\s_]+/g, "-");

  // Insert hyphen before capital letters (for camelCase/PascalCase)
  result = result.replace(/([a-z])([A-Z])/g, "$1-$2");

  // A digit ends a word when a capitalised word follows it, as a lowercase letter does:
  // "Tier1Status" is tier1-status, like "Tier1 Panel" is tier1-panel (#1184). A digit followed by
  // a lone capital or an acronym stays joined ("3D", "Vector3D", "P2P").
  result = result.replace(/([0-9])([A-Z][a-z])/g, "$1-$2");

  // Convert to lowercase
  result = result.toLowerCase();

  // Remove dots (e.g. "Node.js" → "nodejs") to prevent extra ID segments
  result = result.replace(/\./g, "");

  // Remove any characters not valid in a slug (keeps only a-z, 0-9, hyphens)
  result = result.replace(/[^a-z0-9-]/g, "");

  // Remove multiple consecutive hyphens
  result = result.replace(/-+/g, "-");

  // Remove leading/trailing hyphens
  result = result.replace(/^-+|-+$/g, "");

  return result;
}

/** The longest kebab-case name an id keeps whole. */
export const MAX_ID_SLUG = 100;

/** What an id that cannot start with a digit is prefixed with. */
export const LEADING_DIGIT_PREFIX = "n-";

export interface DerivedElementId {
  /** `{layer}.{type}.{slug}`. The slug is empty when the name has no letter or digit. */
  id: string;
  /** The id's last segment. */
  slug: string;
  /**
   * What the derivation did that the name does not make obvious (a word break at a dot or a
   * slash, a prefix, a cut), one sentence each, so a caller can say how the id came about. Empty
   * when the slug is the name's plain kebab case.
   */
  notes: string[];
}

/**
 * Derives an element id from a name. The rules, in order:
 *
 * 1. A route on the root path is `<method> root`: "GET /" → `get-root`.
 * 2. Dots, slashes and braces are word breaks: "Node.js" → `node-js`,
 *    "GET /owners/{ownerId}" → `get-owners-owner-id`.
 * 3. The name is kebab-cased ({@link toKebabCase}): split at spaces, underscores, camelCase, and a
 *    digit followed by a capitalised word ("Tier1Status" → `tier1-status`).
 * 4. An id must start with a letter, so a slug that starts with a digit is prefixed with `n-`:
 *    "3D Object Effect" → `n-3d-object-effect`.
 * 5. A slug longer than {@link MAX_ID_SLUG} characters (a test case's title path) is cut at a word
 *    break and given a short hash of the whole, so the id stays readable, stable and distinct.
 *
 * The element keeps its full name; only the id is shaped.
 */
export function deriveElementId(layer: string, elementType: string, name: string): DerivedElementId {
  const notes: string[] = [];
  const root = /^\s*([A-Z]+)\s+\/\s*$/.exec(name);
  let slug = toKebabCase(root ? `${root[1]} root` : name.replace(/[./{}]+/g, " "));

  // The id a reader of the name would expect is its plain kebab case. Where rules 1 and 2 give
  // another, say so: a caller that is not shown every id (a batch) then knows to read this one.
  if (slug && slug !== toKebabCase(name)) {
    notes.push(
      root
        ? "A route on the root path gets an id that ends in -root."
        : "Dots, slashes and braces in the name are word breaks in the id."
    );
  }

  if (/^[0-9]/.test(slug)) {
    slug = `${LEADING_DIGIT_PREFIX}${slug}`;
    notes.push(`The name starts with a digit and an id must start with a letter, so the id is prefixed with '${LEADING_DIGIT_PREFIX}'.`);
  }

  if (slug.length > MAX_ID_SLUG) {
    const whole = slug.length;
    const hash = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 8);
    const cut = slug.slice(0, MAX_ID_SLUG);
    const atWord = cut.lastIndexOf("-");
    slug = `${(atWord > MAX_ID_SLUG / 2 ? cut.slice(0, atWord) : cut).replace(/-+$/, "")}-${hash}`;
    notes.push(
      `The id is shortened: the name is ${whole} characters as an id and an id keeps ${MAX_ID_SLUG}, so it is cut at a word ` +
        `and ends with a hash of the whole. The element keeps its full name.`
    );
  }

  return { id: `${layer}.${elementType}.${slug}`, slug, notes };
}

/**
 * Generate an element ID, {layer}.{type}.{kebab-name}, by the shared rules of
 * {@link deriveElementId}.
 *
 * @example
 * generateElementId("business", "service", "Customer Management")
 * // "business.service.customer-management"
 */
export function generateElementId(layer: string, elementType: string, name: string): string {
  return deriveElementId(layer, elementType, name).id;
}

/**
 * An id reduced to its layer and the letters and digits of its type and name, so ids that differ
 * only by hyphens (or case, or other separators) compare equal: `data-model.objectschema.tier1status`
 * and `data-model.objectschema.tier1-status`. Undefined when `ref` is not `layer.type.name`.
 */
export function compactId(ref: string): string | undefined {
  const compact = (part: string) => part.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [layer, type, ...rest] = ref.split(".");
  const slug = compact(rest.join("."));
  return layer && type && slug ? `${layer}.${compact(type)}.${slug}` : undefined;
}

/**
 * How a new element's id sits beside the ids already there that differ from it only by hyphens
 * (`near`: the elements with the same {@link compactId}). One of them with the same name is the
 * same element under an id an earlier rule derived: `existing` names it, and the add is refused as
 * it would have been when the two ids were equal, so a change to the derivation never adds a
 * second copy of an element. Any other is worth a `warning`.
 */
export function nearDuplicateId(
  id: string,
  name: string,
  near: Array<{ id: string; name?: string }>
): { existing?: string; warning?: string } {
  const others = near.filter((e) => e.id !== id);
  if (others.length === 0) return {};
  const same = others.find((e) => e.name === name);
  if (same) return { existing: same.id };
  return {
    warning: `${id} differs only by hyphens from ${others.map((e) => e.id).join(", ")}: check that they are not the same element.`,
  };
}

const byCompactIdOf = new WeakMap<object, Map<string, Array<{ id: string; name?: string }>>>();

/**
 * The element among `elements` that has `name` and an id that differs from `id` only by hyphens:
 * the element `id` would have named had it been derived by the rule of its day. A caller that
 * finds an element by the id a name derives (extraction looking for a hand-modelled or planned
 * element to attach code to) falls back to this, so a change to the derivation does not lose the
 * element and add a second copy. The index over `elements` is built once per array.
 */
export function elementUnderEarlierId<T extends { id: string; name?: string }>(
  id: string,
  name: string,
  elements: readonly T[]
): T | undefined {
  let index = byCompactIdOf.get(elements);
  if (!index) {
    index = new Map();
    for (const element of elements) {
      const key = compactId(element.id);
      if (key) index.set(key, [...(index.get(key) ?? []), element]);
    }
    byCompactIdOf.set(elements, index);
  }
  const key = compactId(id);
  const near = (key && index.get(key)) || [];
  const existing = nearDuplicateId(id, name, near).existing;
  return existing ? (near.find((e) => e.id === existing) as T) : undefined;
}

/**
 * Generate a new UUIDv4 using the Node.js built-in crypto module.
 *
 * @example
 * generateUUID() // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
