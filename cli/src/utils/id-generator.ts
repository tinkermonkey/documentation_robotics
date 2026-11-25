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
 * toKebabCase("HTTPServer")          // "http-server"
 * toKebabCase("Vector3DPoint")       // "vector3d-point"
 * toKebabCase("APIs")                // "apis"
 */
export function toKebabCase(text: string): string {
  return kebabCase(text, TODAY);
}

/** The kebab-case rules {@link toKebabCase} applies today. */
const TODAY: KebabRules = { digitBreak: true, camelDotBreak: true, acronymBreak: true };

/** The kebab-case rules that came later, switchable so an earlier release's ids can be derived. */
interface KebabRules {
  /** A digit ends a word before a capitalised word (CLI 0.7.0). */
  digitBreak: boolean;
  /** A dot between camelCase parts is a word break (CLI 0.4.0). */
  camelDotBreak?: boolean;
  /** A run of capitals ends before its last capital when a lowercase letter follows (CLI 0.8.0). */
  acronymBreak?: boolean;
}

/**
 * {@link toKebabCase}, with the rules that came later switchable, so the ids of an earlier release
 * can still be derived ({@link earlierElementIds}).
 */
function kebabCase(text: string, rules: KebabRules): string {
  // A dot between code-symbol parts is a word break: "Repo.findAll" → "Repo-findAll". A part is a
  // code symbol when it is camelCase (a lowercase letter followed by an uppercase one). Other dots
  // are dropped below, so "Node.js", "ASP.NET" and "1.2.3" join as before. (Through CLI 0.3.x
  // every dot was dropped: camelDotBreak false.)
  let result = rules.camelDotBreak === false ? text : text.replace(/[A-Za-z0-9$]+(?:\.[A-Za-z0-9$]+)+/g, (chain) => {
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
  if (rules.digitBreak) result = result.replace(/([0-9])([A-Z][a-z])/g, "$1-$2");

  // A run of capitals is an acronym, and it ends before its last capital when a lowercase letter
  // follows, so the capital starts the next word: "HTTPServer" is http-server, like "HTTP Server";
  // "Vector3DPoint" is vector3d-point, like "Vector3D Point" (#1184). A plural acronym stays whole
  // ("URLs", "APIs", "getIDsFor"). Mixed-case brand words split as camelCase does: "OAuth" is
  // o-auth, as "GitHub" is git-hub.
  if (rules.acronymBreak) result = result.replace(/([A-Z])(?=[A-Z][a-z])(?![A-Z]s(?![a-z]))/g, "$1-");

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
 * 3. The name is kebab-cased ({@link toKebabCase}): split at spaces, underscores, camelCase, a
 *    digit followed by a capitalised word ("Tier1Status" → `tier1-status`), and the end of an
 *    acronym followed by a capitalised word ("HTTPServer" → `http-server`).
 * 4. An id must start with a letter, so a slug that starts with a digit is prefixed with `n-`:
 *    "3D Object Effect" → `n-3d-object-effect`.
 * 5. A slug longer than {@link MAX_ID_SLUG} characters (a test case's title path) is cut at a word
 *    break and given a short hash of the whole, so the id stays readable, stable and distinct.
 *
 * The element keeps its full name; only the id is shaped.
 */
export function deriveElementId(layer: string, elementType: string, name: string): DerivedElementId {
  const { slug, notes } = deriveSlug(name, TODAY);
  return { id: `${layer}.${elementType}.${slug}`, slug, notes };
}

/** {@link deriveElementId}'s slug and notes under the given kebab-case rules. */
function deriveSlug(name: string, rules: KebabRules): { slug: string; notes: string[] } {
  const notes: string[] = [];
  const root = /^\s*([A-Z]+)\s+\/\s*$/.exec(name);
  let slug = kebabCase(root ? `${root[1]} root` : name.replace(/[./{}]+/g, " "), rules);

  // The id a reader of the name would expect is its plain kebab case. Where rules 1 and 2 give
  // another, say so: a caller that is not shown every id (a batch) then knows to read this one.
  if (slug && slug !== kebabCase(name, rules)) {
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
    slug = cutSlug(slug);
    notes.push(
      `The id is shortened: the name is ${whole} characters as an id and an id keeps ${MAX_ID_SLUG}, so it is cut at a word ` +
        `and ends with a hash of the whole. The element keeps its full name.`
    );
  }

  return { slug, notes };
}

/** Which rule of {@link deriveElementId} a note describes. */
export type IdNoteKind = "root-route" | "word-breaks" | "digit-prefix" | "shortened";

/**
 * A note's rule, for a batch that reports each rule once with a count instead of the note on every
 * element (#1302, #1415): the shortened-id note names each name's own length, so grouping the notes
 * by their text gave one group per length. Undefined for a note that is not an id note.
 */
export function idNoteKind(note: string): IdNoteKind | undefined {
  if (note.startsWith("A route on the root path")) return "root-route";
  if (note.startsWith("Dots, slashes and braces")) return "word-breaks";
  if (note.startsWith("The name starts with a digit")) return "digit-prefix";
  if (note.startsWith("The id is shortened")) return "shortened";
  return undefined;
}

/** What each rule did, said once for every element of a batch it applied to. */
export const ID_NOTE_SUMMARY: Record<IdNoteKind, string> = {
  "root-route": "Routes on the root path get ids that end in -root.",
  "word-breaks": "Dots, slashes and braces in these names are word breaks in their ids.",
  "digit-prefix": `These names start with a digit, and an id must start with a letter, so their ids are prefixed with '${LEADING_DIGIT_PREFIX}'.`,
  shortened:
    `These names are longer than ${MAX_ID_SLUG} characters as ids, so each id is cut at a word and ends with a hash of the ` +
    "whole name. The elements keep their full names.",
};

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

/** A slug longer than {@link MAX_ID_SLUG}, cut at a word break and ended with a hash of the whole. */
function cutSlug(slug: string): string {
  const hash = crypto.createHash("sha1").update(slug).digest("hex").slice(0, 8);
  const cut = slug.slice(0, MAX_ID_SLUG);
  const atWord = cut.lastIndexOf("-");
  return `${(atWord > MAX_ID_SLUG / 2 ? cut.slice(0, atWord) : cut).replace(/-+$/, "")}-${hash}`;
}

/**
 * Every rule a released CLI used to derive an id from a name, read from the code at each `cli-v*`
 * tag (0.1.4 to 0.7.x). An element keeps the id of the release that made it, so these are the ids
 * under which the element a name describes may already exist.
 *
 * | Rule | Releases | Used by | How |
 * | --- | --- | --- | --- |
 * | `add-0.1` | 0.1.4–0.3.x | `dr add`, model_add (0.2.0+) | kebab case, every dot dropped |
 * | `add-0.4` | 0.4.0–0.6.0 | `dr add`, model_add | as above, but a dot between camelCase parts is a word break |
 * | `extract-0.4` | 0.4.0 | codebase_extract | dots, slashes and braces as word breaks, the root route; no cut |
 * | `extract-0.5` | 0.5.0–0.6.0 | codebase_extract | as 0.4.0, cut past 100 characters with a hash of the uncut slug |
 * | `derive-0.7` | 0.7.x | all three ({@link deriveElementId}) | as `extract-0.5`, a word break after a digit before a capitalised word, the `n-` prefix; no acronym break |
 *
 * None before 0.7.0 breaks a word after a digit or prefixes a leading digit; none before 0.8.0
 * ends an acronym before a capitalised word ("HTTPServer" was `httpserver`). The
 * analyzer's suggested names (cbm-analyzer) were names, turned into ids by `dr add`.
 *
 * Not listed: the Python CLI and the TypeScript CLI before 0.1.4 kept dots and other characters
 * in ids. A short such id differs from today's only in separators and is found by the hyphen
 * comparison below; a name long enough to be cut today is not.
 *
 * When {@link deriveElementId} changes again, add the rule it replaces here: the guard below and
 * the sweep in tests/unit/utils/id-rules-existing-model.test.ts depend on every past rule being
 * listed.
 */
export const EARLIER_ID_RULES: ReadonlyArray<{ rule: string; slug: (name: string) => string }> = [
  { rule: "add-0.1", slug: (name) => kebabCase(name, { digitBreak: false, camelDotBreak: false }) },
  { rule: "add-0.4", slug: (name) => kebabCase(name, { digitBreak: false, camelDotBreak: true }) },
  { rule: "extract-0.4", slug: (name) => kebabCase(extractionText(name), { digitBreak: false, camelDotBreak: true }) },
  {
    rule: "extract-0.5",
    slug: (name) => {
      const slug = kebabCase(extractionText(name), { digitBreak: false, camelDotBreak: true });
      return slug.length > MAX_ID_SLUG ? cutSlug(slug) : slug;
    },
  },
  { rule: "derive-0.7", slug: (name) => deriveSlug(name, { digitBreak: true, camelDotBreak: true }).slug },
];

/** What extraction kebab-cases for a name: a root route as `<method> root`, and dots, slashes and braces as spaces. */
function extractionText(name: string): string {
  const root = /^\s*([A-Z]+)\s+\/\s*$/.exec(name);
  return root ? `${root[1]} root` : name.replace(/[./{}]+/g, " ");
}

/** The ids earlier releases derived from this name ({@link EARLIER_ID_RULES}), where they differ from today's. */
export function earlierElementIds(layer: string, elementType: string, name: string): string[] {
  const today = deriveElementId(layer, elementType, name).id;
  const ids = EARLIER_ID_RULES.map(({ slug }) => slug(name))
    .filter((slug) => slug !== "")
    .map((slug) => `${layer}.${elementType}.${slug}`);
  return [...new Set(ids)].filter((id) => id !== today);
}

/**
 * Whether two names are one element's name: the same text, or text that gives the same id under
 * today's rule ("TIER1Status" and "Tier1Status", "GET  /" and "GET /"). An earlier rule is not
 * asked: those rules merged names that are different things ("GET /" and "GET /*" both gave
 * `get`; "Version 1.2" and "Version 12" both gave `version-12`), and today's rule tells them apart.
 */
export function namesShareAnId(layer: string, elementType: string, a: string, b: string): boolean {
  if (a === b) return true;
  const slug = deriveElementId(layer, elementType, a).slug;
  return slug !== "" && slug === deriveElementId(layer, elementType, b).slug;
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

/** How a caller looks up the elements that are already there. */
export interface ExistingElements {
  /** The live element with exactly this id. */
  byId(id: string): { id: string; name?: string } | undefined;
  /** The live elements whose {@link compactId} is `key`. */
  byCompactId(key: string): Array<{ id: string; name?: string }>;
}

/**
 * Whether the element a new add describes already exists under another id, for a name whose id
 * (`id`, as {@link deriveElementId} gives it today) is free.
 *
 * `existing` is the id of an element with the same name (or one {@link namesShareAnId} with it:
 * the same id under today's rule; `existingName` then says which) that sits where an earlier rule would
 * have put it: at one of {@link earlierElementIds}, or at any id that differs from today's only
 * by hyphens. It is the same element, and the add is refused as it was when the two ids were
 * equal, so a change to the derivation never adds a second copy of an element. An element with
 * another name whose id differs only by hyphens is another element, worth a `warning`.
 */
export function existingUnderEarlierId(
  layer: string,
  elementType: string,
  name: string,
  id: string,
  elements: ExistingElements,
  /** The name the element carries, when it is not the name its id comes from (`dr add <id-name> --name <shown>`). */
  shownName: string = name
): { existing?: string; existingName?: string; warning?: string } {
  const key = compactId(id);
  const near = (key ? elements.byCompactId(key) : []).filter((e) => e.id !== id);
  const earlier = earlierElementIds(layer, elementType, name)
    .map((earlierId) => elements.byId(earlierId))
    .filter((e): e is { id: string; name?: string } => e !== undefined && e.id !== id);
  // The same name, or one that would have given the same id under some rule.
  const candidates = [...earlier, ...near];
  const same =
    candidates.find((e) => e.name === shownName) ??
    candidates.find((e) => e.name !== undefined && namesShareAnId(layer, elementType, e.name, shownName));
  if (same) return { existing: same.id, ...(same.name !== shownName && same.name !== undefined ? { existingName: same.name } : {}) };
  if (near.length === 0) return {};
  return {
    warning: `${id} differs only by hyphens from ${near.map((e) => e.id).join(", ")}: check that they are not the same element.`,
  };
}

/** An {@link ExistingElements} over a list, indexed on first use and kept for the list's lifetime. */
export function existingElementsIn<T extends { id: string; name?: string }>(
  elements: readonly T[]
): { byId(id: string): T | undefined; byCompactId(key: string): T[] } {
  let index = indexOf.get(elements) as { byId: Map<string, T>; byCompact: Map<string, T[]> } | undefined;
  if (!index) {
    index = { byId: new Map(), byCompact: new Map() };
    for (const element of elements) {
      index.byId.set(element.id, element);
      const key = compactId(element.id);
      if (key) index.byCompact.set(key, [...(index.byCompact.get(key) ?? []), element]);
    }
    indexOf.set(elements, index);
  }
  const built = index;
  return { byId: (id) => built.byId.get(id), byCompactId: (key) => built.byCompact.get(key) ?? [] };
}

const indexOf = new WeakMap<object, { byId: Map<string, unknown>; byCompact: Map<string, unknown[]> }>();

/**
 * The element among `elements` that `name` describes under an earlier rule's id
 * ({@link existingUnderEarlierId}). A caller that finds an element by the id a name derives
 * (extraction looking for a hand-modelled or planned element to attach code to) falls back to
 * this, so a change to the derivation does not lose the element and add a second copy.
 */
export function elementUnderEarlierId<T extends { id: string; name?: string }>(
  id: string,
  name: string,
  elements: readonly T[]
): T | undefined {
  const [layer, elementType] = id.split(".");
  const existing = existingElementsIn(elements);
  const found = existingUnderEarlierId(layer, elementType, name, id, existing).existing;
  return found ? existing.byId(found) : undefined;
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
