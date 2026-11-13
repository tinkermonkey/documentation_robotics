/**
 * Plan an as-built changeset from what the extraction read (cards/extract.ts): what to add, what
 * to update, which relationships to stage, what is already modelled, what looks deleted, and which
 * symbols need the agent's decision. Pure: it reads the projected model and writes nothing.
 * `codebase_extract` stages the plan.
 *
 * Existing elements are matched to symbols by their source reference (file and symbol); a route
 * also matches an `api.operation` with the same method and path, and a decided symbol matches an
 * element of its type and id that has no source location yet. A match whose code-derived fields
 * are unchanged is left out, a match that changed is an update, and a decided symbol with no match
 * is an add. So an empty model gets the bootstrap and an unchanged repository gets nothing.
 *
 * Deletes are never planned, only listed: an element whose source file is gone, or whose symbol
 * the file no longer has, is a candidate delete, with the evidence.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { ChangesetGraph, GraphElement } from "../core/changeset-graph.js";
import type { SourceReference } from "../types/source-reference.js";
import { toKebabCase } from "../utils/id-generator.js";
import { changedInRange } from "./code-changes.js";
import type { DocEvidence } from "./cards/docs.js";
import { planDecisionRecords, type RetiredDecision } from "./decision-records.js";
import { dedupeRelationships, relationshipFor, type EdgeRelationship } from "./edge-relationships.js";
import {
  FILE_JOINED_EDGES,
  parseRouteName,
  shortQualifiedName,
  symbolSpellings,
  type EdgeEnd,
  type ExtractedSymbol,
  type ExtractionGraph,
} from "./cards/extract.js";

/** Edges that say a file refers to a type: it names it, imports it, or calls it (a constructor). */
const REFERENCE_EDGES: ReadonlySet<string> = new Set(["USAGE", "IMPORTS", "CALLS"]);

/**
 * Whether `refs` (what a file names, imports or calls) refers to the class `cls` itself: the class, or
 * its constructor (`Owner.Owner` in Java and C#, `constructor` in TypeScript, `__init__` in Python),
 * which is how the index records `new Owner()`. A member such as `Owner.name` doesn't count: the
 * index matches members by name.
 */
function refersToClass(refs: Set<string> | undefined, cls: string): boolean {
  if (!refs) return false;
  const simple = cls.slice(cls.lastIndexOf(".") + 1);
  return refs.has(cls) || refs.has(`${cls}.${simple}`) || refs.has(`${cls}.constructor`) || refs.has(`${cls}.__init__`);
}

/** Files a `since` range changed, relative to the codebase root. */
export interface CodeChanges {
  /** Files added or modified (a renamed file under its new path). */
  changed: Set<string>;
  /** Files deleted, or renamed away: old path -> new path (null when deleted). */
  deleted: Map<string, string | null>;
  /**
   * The lines each changed file changed, on its new side: line ranges, or "all" for a file that
   * is new in the range. A changed file missing here changed in a way git can't place (binary).
   */
  hunks?: Map<string, LineRanges>;
  /**
   * A file's text at the range's base commit; null when it didn't exist there, undefined when it
   * can't be read.
   */
  fileAtBase?: (file: string) => string | null | undefined;
  /** Why the changed lines couldn't be read, when they couldn't (so no card says changedInRange). */
  hunksError?: string;
}

/**
 * A changed line range, [start, end] (1-based, inclusive). A pure deletion has no new lines: it is
 * the line before the deleted block, [N, N, true], so it says where code went, not which symbol
 * changed.
 */
export type LineRange = [start: number, end: number] | [start: number, end: number, deletion: true];

/** Changed lines of a file: line ranges, or the whole file. */
export type LineRanges = LineRange[] | "all";

export interface PlannedElement {
  id: string;
  layer: string;
  type: string;
  name: string;
  description?: string;
  attributes: Record<string, unknown>;
  /** Where the code is; absent for a route CBM found no file for (it is matched by method and path). */
  sourceReference?: SourceReference;
  /** The symbol it came from. */
  symbol: ExtractedSymbol;
  rule: string;
}

export interface PlannedUpdate {
  id: string;
  layer: string;
  /** The changed fields and their new values (`description`, `attributes.http_path`, `source_reference`). */
  fields: Record<string, unknown>;
  symbol: ExtractedSymbol;
}

export interface PlannedRelationship {
  source: string;
  predicate: string;
  target: string;
  sourceLayer: string;
  targetLayer: string;
  /** The CBM edge type it came from. */
  edge: string;
}

export interface CandidateDelete {
  id: string;
  layer: string;
  type: string;
  file: string;
  symbol?: string;
  /**
   * `symbol-missing`: the file no longer has the symbol (with `since`, it had it at the base).
   * `reference-never-matched`: with `since`, the file didn't have it at the base either, so the
   * range didn't remove it; the model's reference was wrong before the range.
   */
  evidence: "file-deleted" | "file-renamed" | "file-missing" | "symbol-missing" | "reference-never-matched" | "decision-superseded";
  detail: string;
  /** The element this run stages for the same symbol at the file's new path, after a rename. */
  replacedBy?: string;
}

export interface Retyped {
  id: string;
  currentType: string;
  decidedType: string;
  rule: string;
  file: string | null;
  symbol: string;
}

/**
 * `unhandled-route`: a route nothing in the code handles (a URL tests or clients call); last in the list.
 * `decision-record`: an architecture decision record, for a motivation element (decision-records.ts).
 */
export type UndecidedKind = "needs-attributes" | "ambiguous" | "narrowed" | "no-rule" | "unhandled-route" | "decision-record";

export interface UndecidedCard {
  cardId: string;
  kind: UndecidedKind;
  label: string;
  /** The value for model_add's sourceSymbol. */
  symbol: string;
  /** With `since`: the symbol's lines are new or changed in the range. Such cards come first. */
  changedInRange?: true;
  /** A name for model_add whose id keeps the symbol's word breaks (`PetTypeRepository findPetTypes`). */
  name?: string;
  file: string | null;
  lines: string | null;
  qualifiedName: string;
  signature?: string;
  docstring?: string;
  decorators?: string[];
  /** The types Tier 0 allows (`layer.type`, or `layer.*` for any type in the layer); empty when open. */
  candidates: string[];
  /** The analyzer's default type for the label, when Tier 0 left it open. */
  hint?: string;
  rule?: string;
  reason: string;
  /**
   * For needs-attributes: the element Tier 0 decided, with the attributes it could derive. model_add
   * with `name` gives the element `id`.
   */
  proposed?: { layer: string; type: string; name: string; id: string; attributes: Record<string, unknown> };
  /** Doc sections that mention the symbol or name its file: evidence for its description. */
  docs?: DocEvidence[];
  /** For a decision-record card: what the record says (cards/docs.ts). */
  decision?: {
    id: string;
    title: string;
    status: string;
    date?: string;
    deciders?: string;
    decision?: string;
    context?: string;
    consequences?: string;
    /** Records this one supersedes (`ADR-2 (Store orders in SQLite)`): they are retired. */
    supersedes?: string[];
    /** Code its sections name: qualified symbols and file paths. */
    mentions?: string[];
  };
}

export interface ElementPlan {
  adds: PlannedElement[];
  updates: PlannedUpdate[];
  /** Decided symbols whose element is already as the code says. */
  unchanged: number;
  /** Symbols Tier 0 did not decide (or rejected) that already have an element. */
  modelled: number;
  /** Rejected by Tier 0 (not model elements), with no element. */
  rejected: number;
  /** Symbols left out because a recorded decision says they are not elements ({@link PlanOptions.notElements}). */
  skipped: number;
  /** Decided into a layer outside `layers`. */
  outsideLayers: number;
  retyped: Retyped[];
  undecided: UndecidedCard[];
  candidateDeletes: CandidateDelete[];
  /** Symbol (full qualified name) -> the element it is: an add or a match. */
  elementOf: Map<string, string>;
  /** Descriptions this run writes from docstrings, by element id (adds and updates). */
  descriptions: Record<string, string>;
  /** Decision records: how many became cards, how many are modelled, and the retired ones. */
  decisions?: { cards: number; modelled: number; retired: RetiredDecision[] };
}

export interface PlanOptions {
  /** Only these layers (default every layer). */
  layers?: string[];
  /** The files the extraction covered, with what a `since` range deleted; null for the whole codebase. */
  changes?: CodeChanges | null;
  /** Whether a file exists, relative to the codebase root (used without `since`). */
  fileExists: (file: string) => boolean;
  /**
   * A file's text, or null when it can't be read. A symbol the analyzer doesn't list (a prop, a
   * local) still counts as present while its name appears in the file.
   */
  fileText?: (file: string) => string | null;
  /**
   * The descriptions earlier runs wrote from docstrings, by element id. A description is only
   * replaced when it is empty or still the one extraction wrote, so someone's own text stays.
   */
  extractedDescriptions?: Record<string, string>;
  /**
   * Symbols someone decided are not elements, by {@link decisionKey}. An unmatched symbol with a
   * decision is neither staged nor carded; one that has an element is matched as usual.
   */
  notElements?: ReadonlySet<string>;
}

/**
 * The key a "not an element" decision is recorded under: `file#symbol`, a route's parameters
 * normalised (`file#GET /owners/{}`). A route keeps its file, so a rejected client URL with no file
 * can't hide a route served in a file.
 */
export function decisionKey(file: string | null, symbol: string): string {
  return `${file ?? ""}#${routeKey(symbol) ?? symbol}`;
}

// ---------------------------------------------------------------------------
// Naming and attributes
// ---------------------------------------------------------------------------

/** A route symbol's path, with its parameters named where the code names them. */
function routePathOf(s: ExtractedSymbol, route: { path: string }): string {
  return s.routePath ?? route.path;
}

/** The source symbol an extracted element records: `METHOD /path`, `Parent.method`, the name, or a module's qualified name. */
export function sourceSymbolOf(s: ExtractedSymbol, project: string): string {
  const { card } = s;
  const route = parseRouteName(card.name);
  if (route) return `${route.method} ${routePathOf(s, route)}`;
  if (card.label === "Module") return shortQualifiedName(s.qualifiedName, project);
  if (card.label === "Method" && card.parent_class) {
    const parent = card.parent_class.split(".").pop();
    if (parent) return `${parent}.${card.name}`;
  }
  return card.name;
}

/**
 * The element name for a symbol: `GET /owners/{ownerId}` (`{param}` where the code names no
 * parameter), `OwnerController.showOwner`, `Owner`, a module's file path without its extension
 * (`src/utils/graphDegree`).
 */
function baseNameOf(s: ExtractedSymbol, project: string): string {
  const route = parseRouteName(s.card.name);
  if (route) return `${route.method} ${routePathOf(s, route).replace(/\{\}/g, "{param}")}`;
  if (s.card.label === "Module") return (s.card.file_path || s.card.name).replace(/\.[^./]+$/, "");
  return sourceSymbolOf(s, project);
}

/**
 * A name for model_add that gives the id extraction would ({@link extractedElementId}). model_add
 * drops a dot or a slash rather than breaking the word there, so `PetTypeRepository.findPetTypes`
 * becomes `PetTypeRepository findPetTypes`, a module's `src/utils/graphDegree` becomes
 * `src utils graphDegree`, and `GET /owners/{ownerId}` becomes `GET owners ownerId` (`GET /` is
 * `GET root`). Undefined when the name needs no change.
 */
export function modelAddName(name: string): string | undefined {
  const root = /^\s*([A-Z]+)\s+\/\s*$/.exec(name);
  const out = root
    ? `${root[1]} root`
    : /[/{}]/.test(name)
      ? name.replace(/[./{}]+/g, " ").replace(/\s+/g, " ").trim()
      : name.replace(/([\w$)])\.(?=[A-Za-z_$])/g, "$1 ");
  return out !== name ? out : undefined;
}

/**
 * An element id for a name: dots, slashes and braces become word breaks before kebab-casing. A
 * route on the root path is `<method> root` (`api.operation.get-root`). A name longer than
 * {@link MAX_ID_SLUG} characters as kebab case (a test case's title path) is cut at a word break
 * and given a short hash of the whole, so the id stays readable, stable and distinct; the element
 * keeps the full name and source symbol.
 */
export function extractedElementId(layer: string, type: string, name: string): string {
  const root = /^\s*([A-Z]+)\s+\/\s*$/.exec(name);
  return `${layer}.${type}.${cappedSlug(toKebabCase(root ? `${root[1]} root` : name.replace(/[./{}]+/g, " ")))}`;
}

/** The longest kebab-case name an extracted id keeps whole. */
export const MAX_ID_SLUG = 100;

function cappedSlug(slug: string): string {
  if (slug.length <= MAX_ID_SLUG) return slug;
  const hash = createHash("sha1").update(slug).digest("hex").slice(0, 8);
  const cut = slug.slice(0, MAX_ID_SLUG);
  const atWord = cut.lastIndexOf("-");
  return `${(atWord > MAX_ID_SLUG / 2 ? cut.slice(0, atWord) : cut).replace(/-+$/, "")}-${hash}`;
}

/** First paragraph of a docstring, without comment markers, at most 280 characters. */
export function describeDocstring(doc: string | null): string | undefined {
  if (!doc) return undefined;
  const text = doc
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(\*|\/\/\/?|#)\s?/, "").trim())
    .join("\n")
    .replace(/^["']{3}|["']{3}$/g, "")
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.startsWith("@")) return undefined;
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

/**
 * Attributes the code gives for a decided type: `facts` are read from the code and compared on a
 * re-run; `defaults` fill a type's required attributes on an add only, so a value someone set by
 * hand is never overwritten.
 */
export function deriveAttributes(
  layer: string,
  type: string,
  s: ExtractedSymbol
): { facts: Record<string, unknown>; defaults: Record<string, unknown> } {
  const key = `${layer}.${type}`;
  const route = parseRouteName(s.card.name);
  switch (key) {
    case "api.operation": {
      if (!route) return { facts: {}, defaults: {} };
      const p = routePathOf(s, route);
      const segment = p.split("/").find((x) => x && !x.startsWith("{") && !x.startsWith(":")) ?? "default";
      const words = p.replace(/[/{}:]+/g, " ").trim();
      return {
        facts: { http_method: route.method, http_path: p },
        defaults: {
          operationId: toKebabCase(`${route.method} ${words || "root"}`),
          summary: `${route.method} ${p}`,
          tags: segment,
        },
      };
    }
    case "testing.testcasesketch":
      // It exists as a test in the code.
      return { facts: {}, defaults: { status: "automated" } };
    case "application.applicationinterface":
      return { facts: {}, defaults: { protocol: s.facts.decorator_names.includes("RestController") ? "REST" : "HTTP" } };
    case "application.applicationcomponent":
      return { facts: {}, defaults: { type: "internal" } };
    case "application.applicationservice":
      return { facts: {}, defaults: { serviceType: "synchronous" } };
    case "data-model.objectschema":
      return { facts: {}, defaults: { type: "object" } };
    case "data-store.accesspattern": {
      // A repository interface names its entity: `extends JpaRepository<Owner, Integer>`.
      const entity = /Repository\s*<\s*([\w.]+)/.exec(s.card.source ?? s.card.signature ?? "")?.[1];
      return { facts: {}, defaults: { patternType: "CUSTOM", ...(entity ? { targetCollection: entity.split(".").pop() } : {}) } };
    }
    default:
      return { facts: {}, defaults: {} };
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function codeLocations(e: GraphElement): Array<{ file: string; symbol?: string }> {
  return (e.sourceReference?.locations ?? [])
    .filter((l) => typeof l.file === "string" && l.file)
    .map((l) => ({ file: l.file.replace(/\\/g, "/").replace(/^\.\//, ""), ...(l.symbol ? { symbol: l.symbol } : {}) }));
}

function normPath(p: string): string {
  return p.replace(/\{[^}]*\}|:[A-Za-z_]\w*/g, "{}").replace(/\/+$/, "") || "/";
}

interface ExistingIndex {
  /** `file#symbol` -> elements naming that symbol. */
  bySymbol: Map<string, GraphElement[]>;
  /** `file#METHOD /path` -> elements whose symbol is that route, parameters normalised. */
  byRouteSymbol: Map<string, GraphElement[]>;
  /** `METHOD /path` -> elements whose symbol is that route, in any file. */
  byRouteSymbolAnyFile: Map<string, GraphElement[]>;
  /** `METHOD /path` -> operations by their attributes, only those naming no code. */
  byRoute: Map<string, GraphElement[]>;
  byId: Map<string, GraphElement>;
  live: GraphElement[];
}

function indexExisting(graph: ChangesetGraph): ExistingIndex {
  const bySymbol = new Map<string, GraphElement[]>();
  const byRouteSymbol = new Map<string, GraphElement[]>();
  const byRouteSymbolAnyFile = new Map<string, GraphElement[]>();
  const byRoute = new Map<string, GraphElement[]>();
  const byId = new Map<string, GraphElement>();
  const live: GraphElement[] = [];
  const push = (m: Map<string, GraphElement[]>, k: string, e: GraphElement) => (m.get(k) ?? m.set(k, []).get(k)!).push(e);
  for (const e of graph.elements.values()) {
    byId.set(e.id, e);
    if (e.status === "deleted") continue;
    live.push(e);
    const locations = codeLocations(e);
    for (const loc of locations) {
      if (!loc.symbol) continue;
      push(bySymbol, `${loc.file}#${loc.symbol}`, e);
      const route = routeKey(loc.symbol);
      if (route) {
        push(byRouteSymbol, `${loc.file}#${route}`, e);
        push(byRouteSymbolAnyFile, route, e);
      }
    }
    // By method and path only an operation that names no code, so code elsewhere (another
    // service's GET /health) can't claim one that does.
    if (e.layer === "api" && e.type === "operation" && !locations.length) {
      const method = e.attributes.http_method;
      const p = e.attributes.http_path;
      if (typeof method === "string" && typeof p === "string") push(byRoute, `${method.toUpperCase()} ${normPath(p)}`, e);
    }
  }
  return { bySymbol, byRouteSymbol, byRouteSymbolAnyFile, byRoute, byId, live };
}

function findBySymbol(index: ExistingIndex, file: string | null, spellings: string[]): GraphElement | undefined {
  for (const s of spellings) {
    if (file) {
      const hit = index.bySymbol.get(`${file}#${s}`);
      if (hit?.length) return hit[0];
    }
  }
  return undefined;
}

function hasSymbol(spellings: Set<string> | undefined, symbol: string): boolean {
  return !!spellings && spellings.has(symbol);
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const LABEL_ORDER = ["Route", "Class", "Interface", "Type", "Enum", "Trait", "Struct", "Function", "Method", "Module"];
// Decision records first: there are few, and they are the only cards for the motivation layer.
const KIND_ORDER: UndecidedKind[] = ["decision-record", "needs-attributes", "ambiguous", "narrowed", "no-rule", "unhandled-route"];

function inLayers(layer: string, layers: Set<string> | null): boolean {
  return !layers || layers.has(layer);
}

/** Cards changed in the range first, then by kind, label, file and name. */
function sortCards(cards: UndecidedCard[]): UndecidedCard[] {
  const rank = (l: string) => {
    const i = LABEL_ORDER.indexOf(l);
    return i < 0 ? LABEL_ORDER.length : i;
  };
  return cards.sort(
    (a, b) =>
      (a.changedInRange ? 0 : 1) - (b.changedInRange ? 0 : 1) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      rank(a.label) - rank(b.label) ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      a.qualifiedName.localeCompare(b.qualifiedName)
  );
}

function cardOf(
  s: ExtractedSymbol,
  project: string,
  kind: UndecidedKind,
  reason: string,
  extra: Partial<UndecidedCard> = {},
  hunks?: Map<string, LineRanges>,
  renamedTo?: ReadonlySet<string>
): UndecidedCard {
  const { card } = s;
  const doc = describeDocstring(card.docstring);
  const name = modelAddName(baseNameOf(s, project));
  // A module spans its whole file, so any edit in the file would touch it: it counts as changed
  // only when the range added the file. Its identity is its path, so the new path of a rename
  // is added too, whatever its hunks say.
  const ranges = hunks && card.file_path ? hunks.get(card.file_path) : undefined;
  const changed =
    card.label === "Module"
      ? !!hunks && !!card.file_path && (ranges === "all" || !!renamedTo?.has(card.file_path))
      : changedInRange(ranges, card.start_line, card.end_line);
  return {
    cardId: card.id,
    kind,
    label: card.label,
    symbol: sourceSymbolOf(s, project),
    ...(changed ? { changedInRange: true as const } : {}),
    ...(name ? { name } : {}),
    file: card.file_path,
    lines: card.start_line !== null ? `${card.start_line}-${card.end_line ?? card.start_line}` : null,
    qualifiedName: card.qualified_name,
    ...(card.signature ? { signature: card.signature.slice(0, 200) } : {}),
    ...(doc ? { docstring: doc } : {}),
    ...(s.facts.decorator_names.length ? { decorators: s.facts.decorator_names } : {}),
    candidates: [],
    reason,
    ...(s.docs?.length ? { docs: s.docs } : {}),
    ...extra,
  };
}

/** Plan the element changes. Relationships are planned after the adds are validated ({@link planRelationships}). */
export function planElements(extraction: ExtractionGraph, existing: ChangesetGraph, options: PlanOptions): ElementPlan {
  const { project, config } = extraction;
  const layers = options.layers?.length ? new Set(options.layers) : null;
  const index = indexExisting(existing);
  const taken = new Set(index.byId.keys());
  const plan: ElementPlan = {
    adds: [],
    updates: [],
    unchanged: 0,
    modelled: 0,
    rejected: 0,
    skipped: 0,
    outsideLayers: 0,
    retyped: [],
    undecided: [],
    candidateDeletes: [],
    elementOf: new Map(),
    descriptions: {},
  };
  const matched = new Set<string>();
  const hunks = options.changes?.hunks;
  const renamedTo = renameTargets(options.changes);
  const cardFor = (s: ExtractedSymbol, kind: UndecidedKind, reason: string, extra: Partial<UndecidedCard> = {}) =>
    cardOf(s, project, kind, reason, extra, hunks, renamedTo);
  const notElements = options.notElements ?? new Set<string>();

  // Stable order, so names that collide are qualified the same way each run.
  const symbols = [...extraction.symbols].sort(
    (a, b) => (a.card.file_path ?? "").localeCompare(b.card.file_path ?? "") || a.qualifiedName.localeCompare(b.qualifiedName)
  );

  // Match symbols to elements in two passes, each element to one symbol: first by the symbol's
  // own spellings (`Parent.method`, the qualified name, a route), then by the looser ones (a route
  // by method and path, the bare name, the id). A symbol whose only match another symbol already
  // took is ambiguous: it goes to the agent rather than updating that element too.
  const claimed = new Set<string>();
  const matchOf = new Map<ExtractedSymbol, GraphElement>();
  const ambiguousWith = new Map<ExtractedSymbol, string>();
  const pick = (candidates: GraphElement[] | undefined, prefer?: (e: GraphElement) => boolean): GraphElement | "claimed" | undefined => {
    if (!candidates?.length) return undefined;
    const free = candidates.filter((e) => !claimed.has(e.id));
    if (!free.length) return "claimed";
    return (prefer && free.find(prefer)) ?? free[0];
  };
  const tryLookups = (s: ExtractedSymbol, lookups: Array<() => GraphElement | "claimed" | undefined>): void => {
    for (const lookup of lookups) {
      const hit = lookup();
      if (hit === "claimed") {
        const owner = lookupOwner(s);
        if (owner) ambiguousWith.set(s, owner);
        continue;
      }
      if (hit) {
        claimed.add(hit.id);
        matchOf.set(s, hit);
        ambiguousWith.delete(s);
        return;
      }
    }
  };
  // The element a looser lookup would have hit, for the ambiguity note.
  const lookupOwner = (s: ExtractedSymbol): string | undefined => {
    const file = s.card.file_path;
    const route = parseRouteName(s.card.name);
    const keys = route
      ? [file ? index.byRouteSymbol.get(`${file}#${routeKey(s.card.name)}`) : index.byRouteSymbolAnyFile.get(routeKey(s.card.name)!), index.byRoute.get(`${route.method} ${normPath(route.path)}`)]
      : [file ? index.bySymbol.get(`${file}#${s.card.name}`) : undefined];
    return keys.find((k) => k?.length)?.[0]?.id;
  };
  const strongSpellings = (s: ExtractedSymbol) => {
    const symbol = sourceSymbolOf(s, project);
    return [symbol, ...symbolSpellings(s.qualifiedName, s.card.name, project)].filter(
      (sp, i, all) => all.indexOf(sp) === i && (sp === symbol || sp !== s.card.name)
    );
  };
  for (const s of symbols) {
    const file = s.card.file_path;
    if (!file) continue;
    tryLookups(
      s,
      strongSpellings(s).map((sp) => () => pick(index.bySymbol.get(`${file}#${sp}`)))
    );
  }
  for (const s of symbols) {
    if (matchOf.has(s)) continue;
    const { card, tier0 } = s;
    const file = card.file_path;
    const route = parseRouteName(card.name);
    const lookups: Array<() => GraphElement | "claimed" | undefined> = [];
    if (route) {
      const key = routeKey(card.name)!;
      const exact = (e: GraphElement) => e.attributes.http_path === route.path;
      lookups.push(() => pick(file ? index.byRouteSymbol.get(`${file}#${key}`) : index.byRouteSymbolAnyFile.get(key)));
      lookups.push(() => pick(index.byRoute.get(`${route.method} ${normPath(route.path)}`), exact));
    } else if (file && sourceSymbolOf(s, project) !== card.name) {
      lookups.push(() => pick(index.bySymbol.get(`${file}#${card.name}`)));
    }
    if (tier0?.kind === "decide") {
      // An element of this type and id that names no code yet (modelled by hand, or planned).
      const decided = tier0;
      lookups.push(() => {
        const byId = index.byId.get(extractedElementId(decided.layer, decided.type, baseNameOf(s, project)));
        if (!byId || byId.status === "deleted" || byId.layer !== decided.layer || byId.type !== decided.type || codeLocations(byId).length) {
          return undefined;
        }
        return pick([byId]);
      });
    }
    tryLookups(s, lookups);
  }

  for (const s of symbols) {
    const { card, tier0 } = s;
    const file = card.file_path;
    const symbol = sourceSymbolOf(s, project);
    const decided = tier0?.kind === "decide" ? tier0 : null;
    const spellings = [symbol, ...symbolSpellings(s.qualifiedName, card.name, project)];
    const match = matchOf.get(s);

    // Someone decided it is not an element: neither staged nor carded, unless it has one now.
    if (!match && notElements.has(decisionKey(file, symbol))) {
      plan.skipped++;
      continue;
    }

    // A rejected symbol is not an element, ambiguous or not.
    const ambiguous = !match && tier0?.kind !== "reject" ? ambiguousWith.get(s) : undefined;
    if (ambiguous) {
      if (decided && !inLayers(decided.layer, layers)) {
        plan.outsideLayers++;
        continue;
      }
      plan.undecided.push(
        cardFor(
          s,
          "ambiguous",
          `Its name also matches ${ambiguous}, which another symbol already matched. If it is a separate element, stage it under its own symbol; if it is that one, add this location to it.`,
          {
            candidates: decided
              ? [`${decided.layer}.${decided.type}`]
              : tier0?.kind === "narrow"
                ? tier0.candidates.map((c) => `${c.layer}.${c.type ?? "*"}`)
                : [],
            ...(tier0 && tier0.kind !== "reject" ? { rule: tier0.rule } : {}),
          }
        )
      );
      continue;
    }

    if (match) {
      matched.add(match.id);
      plan.elementOf.set(s.qualifiedName, match.id);
      if (!decided) {
        plan.modelled++;
        continue;
      }
      if (match.layer !== decided.layer || match.type !== decided.type) {
        plan.retyped.push({ id: match.id, currentType: `${match.layer}.${match.type}`, decidedType: `${decided.layer}.${decided.type}`, rule: decided.rule, file, symbol });
        continue;
      }
      if (!inLayers(decided.layer, layers)) {
        plan.outsideLayers++;
        continue;
      }
      const fields = changedFields(match, s, symbol, spellings, decided.layer, decided.type, options.extractedDescriptions ?? {});
      if (typeof fields.description === "string") plan.descriptions[match.id] = fields.description;
      if (Object.keys(fields).length) plan.updates.push({ id: match.id, layer: match.layer, fields, symbol: s });
      else plan.unchanged++;
      continue;
    }

    if (s.unhandled) {
      if (layers && !layers.has("api")) {
        plan.outsideLayers++;
        continue;
      }
      plan.undecided.push(
        cardFor(
          s,
          "unhandled-route",
          "Nothing in this code handles this route (no handler, no file of its own): it is most likely a URL that tests or client code call. " +
            "Model it as an api.operation only if this codebase serves it; otherwise reject it.",
          { candidates: ["api.operation"] }
        )
      );
      continue;
    }

    if (!tier0 || tier0.kind === "narrow") {
      const candidates = tier0 ? tier0.candidates.map((c) => `${c.layer}.${c.type ?? "*"}`) : [];
      const hint = config.labelDefaults[card.label];
      const relevant = layers
        ? tier0
          ? tier0.candidates.some((c) => layers.has(c.layer))
          : !!hint && layers.has(hint.split(".")[0])
        : true;
      if (!relevant) {
        plan.outsideLayers++;
        continue;
      }
      plan.undecided.push(
        tier0
          ? cardFor(s, "narrowed", `Tier 0 rule ${tier0.rule} narrows it to these types; choosing needs judgment (Tier 1 is not wired).`, {
              candidates: candidates.filter((c) => !layers || layers.has(c.split(".")[0])),
              rule: tier0.rule,
            })
          : cardFor(s, "no-rule", `No Tier-0 rule covers this ${card.label}: decide whether it is a model element, and which.`, {
              ...(hint ? { hint } : {}),
            })
      );
      continue;
    }
    if (tier0.kind === "reject") {
      plan.rejected++;
      continue;
    }

    // Decided, and not modelled yet: an add.
    if (!inLayers(tier0.layer, layers)) {
      plan.outsideLayers++;
      continue;
    }
    const { facts, defaults } = deriveAttributes(tier0.layer, tier0.type, s);
    const base = baseNameOf(s, project);
    const name = uniqueName(base, s, tier0.layer, tier0.type, taken);
    const id = extractedElementId(tier0.layer, tier0.type, name);
    taken.add(id);
    const description = describeDocstring(card.docstring);
    if (description) plan.descriptions[id] = description;
    plan.adds.push({
      id,
      layer: tier0.layer,
      type: tier0.type,
      name,
      ...(description ? { description } : {}),
      attributes: { ...defaults, ...facts },
      ...(file ? { sourceReference: { provenance: "extracted" as const, locations: [{ file, symbol }] } } : {}),
      symbol: s,
      rule: tier0.rule,
    });
    plan.elementOf.set(s.qualifiedName, id);
  }

  plan.candidateDeletes = candidateDeletes(extraction, index, matched, plan.adds, options, layers);

  // Decision records: cards for the agent's motivation elements, and the retired ones.
  if (extraction.decisions?.length) {
    const decisions = planDecisionRecords(extraction.decisions, index.live, project, {
      layers,
      changes: options.changes ?? null,
      rejected: (file, symbol) => notElements.has(decisionKey(file, symbol)),
    });
    plan.undecided.push(...decisions.cards);
    plan.skipped += decisions.skipped;
    plan.outsideLayers += decisions.outsideLayers;
    const listed = new Set(plan.candidateDeletes.map((d) => d.id));
    plan.candidateDeletes.push(...decisions.candidateDeletes.filter((d) => !listed.has(d.id)));
    plan.candidateDeletes.sort((a, b) => a.id.localeCompare(b.id));
    plan.decisions = { cards: decisions.cards.length, modelled: decisions.modelled, retired: decisions.retired };
  }
  plan.undecided = sortCards(plan.undecided);
  return plan;
}

/**
 * A decided add whose attributes don't validate (a required one the code can't give), handed to
 * the agent with what Tier 0 decided instead of being staged invalid.
 */
/** The new paths of the files a range renamed. */
function renameTargets(changes: CodeChanges | null | undefined): Set<string> {
  return new Set([...(changes?.deleted.values() ?? [])].filter((to): to is string => !!to));
}

export function needsAttributesCard(add: PlannedElement, project: string, errors: string[], hunks?: Map<string, LineRanges>): UndecidedCard {
  return cardOf(
    add.symbol,
    project,
    "needs-attributes",
    `Tier 0 decided ${add.layer}.${add.type} (${add.rule}), but its attributes don't validate: ${errors
      .map((e) => e.replace(/^Element '[^']*':\s*/, ""))
      .join("; ")}. Stage it with valid attributes (model_add with proposed.name gives it proposed.id), or reject it if it is not an element.`,
    {
      candidates: [`${add.layer}.${add.type}`],
      rule: add.rule,
      proposed: { layer: add.layer, type: add.type, name: modelAddName(add.name) ?? add.name, id: add.id, attributes: add.attributes },
    },
    hunks
  );
}

function lineSpan(card: UndecidedCard): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec(card.lines ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Credit a change to the innermost card it touched: a card whose changed lines all lie inside
 * members that are changed cards themselves (a class whose only edits are in a changed method)
 * loses changedInRange, so only the member says it changed.
 */
export function attributeChangedLines(cards: UndecidedCard[], hunks?: Map<string, LineRanges>): UndecidedCard[] {
  if (!hunks) return cards;
  const flagged = cards.filter((c) => c.changedInRange && c.file);
  return cards.map((card) => {
    if (!card.changedInRange || !card.file || card.label === "Module") return card;
    const ranges = hunks.get(card.file);
    const own = lineSpan(card);
    if (!ranges || ranges === "all" || !own) return card;
    const members = flagged
      .filter((m) => m !== card && m.file === card.file && m.qualifiedName.startsWith(card.qualifiedName + "."))
      .map(lineSpan)
      .filter((span): span is [number, number] => span !== null);
    if (!members.length) return card;
    const inMember = (line: number) => members.some(([a, b]) => line >= a && line <= b);
    const ownChange = ranges.some(([a, b, deletion]) => {
      // A deletion inside the card stays with it: the line it follows may be a member's last,
      // but what was removed (a member, say) was the container's.
      if (deletion) return a >= own[0] && a < own[1] && !members.some(([m0, m1]) => a >= m0 && a < m1);
      for (let line = Math.max(a, own[0]); line <= Math.min(b, own[1]); line++) if (!inMember(line)) return true;
      return false;
    });
    if (ownChange) return card;
    const { changedInRange: _changed, ...rest } = card;
    return rest;
  });
}

/** Re-sort undecided cards after adding to them. */
export function sortUndecided(cards: UndecidedCard[]): UndecidedCard[] {
  return sortCards(cards);
}

/** A name whose id is free: the symbol's, else qualified by its file, else by its qualified name. */
function uniqueName(base: string, s: ExtractedSymbol, layer: string, type: string, taken: Set<string>): string {
  const file = s.card.file_path ?? "";
  const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
  const dir = path.posix.dirname(file);
  const options = [base, `${stem} ${base}`, `${dir}/${stem} ${base}`, s.card.qualified_name];
  for (const name of options) {
    if (!taken.has(extractedElementId(layer, type, name))) return name;
  }
  for (let i = 2; ; i++) {
    const name = `${s.card.qualified_name} ${i}`;
    if (!taken.has(extractedElementId(layer, type, name))) return name;
  }
}

/**
 * The code-derived fields of a matched element that differ from the code: its source location
 * (added when the element names none for this symbol), the type's code facts (an operation's
 * method and path) and the description from the docstring, when the code has one and the element's
 * description is not someone's own (`manual` provenance).
 */
function changedFields(
  match: GraphElement,
  s: ExtractedSymbol,
  symbol: string,
  spellings: string[],
  layer: string,
  type: string,
  extractedDescriptions: Record<string, string>
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const file = s.card.file_path;
  const locations = codeLocations(match);
  // A route location counts with its parameters named or not (`GET /owners/{ownerId}`).
  const route = routeKey(s.card.name);
  const names = (l: { symbol?: string }) => !!l.symbol && (spellings.includes(l.symbol) || (!!route && routeKey(l.symbol) === route));
  if (file && !locations.some((l) => l.file === file && names(l))) {
    const ref = match.sourceReference;
    fields.source_reference = {
      provenance: ref?.provenance ?? "extracted",
      locations: [...(ref?.locations ?? []), { file, symbol }],
      ...(ref?.repository ? { repository: ref.repository } : {}),
    } satisfies SourceReference;
  }
  const { facts } = deriveAttributes(layer, type, s);
  for (const [k, v] of Object.entries(facts)) {
    if (!sameFact(k, match.attributes[k], v)) fields[`attributes.${k}`] = v;
  }
  // The docstring replaces a description only when there is none, or it is still the one an
  // earlier run wrote: a description someone wrote is theirs.
  const description = describeDocstring(s.card.docstring);
  const current = match.description ?? "";
  if (description && current !== description && (!current || current === extractedDescriptions[match.id])) {
    fields.description = description;
  }
  return fields;
}

/**
 * Whether an element's attribute already says what the code says. CBM drops path parameter names
 * (`/owners/{}`), so paths compare with parameters and a trailing slash normalised, and methods
 * ignore case: `/owners/{ownerId}` and `get` are left as they are.
 */
export function sameFact(key: string, current: unknown, fromCode: unknown): boolean {
  if (typeof current === "string" && typeof fromCode === "string") {
    if (key === "http_path") return normPath(current) === normPath(fromCode);
    if (key === "http_method") return current.toUpperCase() === fromCode.toUpperCase();
  }
  return current === fromCode;
}

function candidateDeletes(
  extraction: ExtractionGraph,
  index: ExistingIndex,
  matched: Set<string>,
  adds: PlannedElement[],
  options: PlanOptions,
  layers: Set<string> | null
): CandidateDelete[] {
  const routes = new Set(extraction.routes.map(routeKey).filter((k): k is string => !!k));
  const fileSymbols = new Map(Object.entries(extraction.fileSymbols).map(([f, s]) => [f, new Set(s)]));
  const addAt = new Map<string, string>();
  for (const a of adds) for (const l of a.sourceReference?.locations ?? []) addAt.set(`${l.file}#${l.symbol ?? ""}`, a.id);
  const testFiles = new Set(extraction.testFiles ?? []);
  const out: CandidateDelete[] = [];
  for (const e of index.live) {
    if (matched.has(e.id) || !inLayers(e.layer, layers)) continue;
    const locations = codeLocations(e);
    if (!locations.length) continue;
    let gone: Omit<CandidateDelete, "id" | "layer" | "type"> | null = null;
    let present = false;
    // A test element's title in a JS/TS test file whose every suite and case was read; only an
    // extracted element's, as a hand-written symbol may be prose that names no title.
    const titled = e.layer === "testing" && e.sourceReference?.provenance === "extracted" ? testFiles : undefined;
    for (const loc of locations) {
      const verdict = judgeLocation(loc, options, fileSymbols, routes, addAt, titled);
      if (verdict) gone ??= verdict;
      else present = true;
    }
    if (gone && !present) out.push({ id: e.id, layer: e.layer, type: e.type, ...gone });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Why a source location is gone, or null when it is there (or outside the run's scope).
 * `titledFiles`: test files whose test titles were all read, where a title symbol (prose, such as
 * `Model > loads layers`) can be checked against the file's symbols.
 */
function judgeLocation(
  loc: { file: string; symbol?: string },
  options: PlanOptions,
  fileSymbols: Map<string, Set<string>>,
  routes: Set<string>,
  addAt: Map<string, string>,
  titledFiles?: Set<string>
): Omit<CandidateDelete, "id" | "layer" | "type"> | null {
  const base = { file: loc.file, ...(loc.symbol ? { symbol: loc.symbol } : {}) };
  const changes = options.changes;
  if (changes) {
    if (changes.deleted.has(loc.file)) {
      const to = changes.deleted.get(loc.file);
      if (to) {
        const replacedBy = loc.symbol ? addAt.get(`${to}#${loc.symbol}`) : undefined;
        return { ...base, evidence: "file-renamed", detail: `${loc.file} was renamed to ${to} in the range`, ...(replacedBy ? { replacedBy } : {}) };
      }
      return { ...base, evidence: "file-deleted", detail: `${loc.file} was deleted in the range` };
    }
    if (!changes.changed.has(loc.file)) return null;
  } else if (!options.fileExists(loc.file)) {
    return { ...base, evidence: "file-missing", detail: `${loc.file} does not exist in the codebase` };
  }
  if (!loc.symbol) return null;
  const route = routeKey(loc.symbol);
  if (route) {
    return routes.has(route) ? null : { ...base, evidence: "symbol-missing", detail: `the code has no route ${loc.symbol}` };
  }
  // Only a name the code could declare can be checked; prose ("the layout loop") can't, except a
  // test title in a test file whose titles were all read.
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(loc.symbol)) {
    if (!titledFiles?.has(loc.file) || hasSymbol(fileSymbols.get(loc.file), loc.symbol)) return null;
    return { ...base, evidence: "symbol-missing", detail: `${loc.file} has no test titled ${loc.symbol}` };
  }
  const symbols = fileSymbols.get(loc.file);
  if (hasSymbol(symbols, loc.symbol)) return null;
  const last = loc.symbol.split(".").pop()!.replace(/\$/g, "\\$");
  const names = (text: string) => new RegExp(`(^|[^\\w$])${last}($|[^\\w$])`).test(text);
  const text = options.fileText?.(loc.file) ?? null;
  if (text === null) {
    if (!symbols) return null; // not a file the analyzer reads symbols from, and unreadable
  } else if (names(text)) return null;
  // With a range: gone in the range only if the file had it at the base.
  if (changes?.fileAtBase) {
    // A file renamed in the range had its old path at the base.
    const oldPath = [...changes.deleted].find(([, to]) => to === loc.file)?.[0];
    const before = changes.fileAtBase(oldPath ?? loc.file);
    if (before === undefined) {
      return { ...base, evidence: "symbol-missing", detail: `${loc.file} has no ${loc.symbol} (not among its symbols, and the name is not in the file); its text at the start of the range couldn't be read` };
    }
    if (before === null || !names(before)) {
      return {
        ...base,
        evidence: "reference-never-matched",
        detail: `The model's reference to ${loc.symbol} matches nothing in ${loc.file}, and ${
          before === null ? "the file didn't exist" : "the file didn't have it either"
        } at the start of the range: the range didn't remove it, the reference was wrong before it`,
      };
    }
    return { ...base, evidence: "symbol-missing", detail: `${loc.file} had ${loc.symbol} at the start of the range and doesn't now (not among its symbols, and the name is not in the file)` };
  }
  return { ...base, evidence: "symbol-missing", detail: `${loc.file} has no ${loc.symbol} (not among its symbols, and the name is not in the file)` };
}

/** `GET /owners/{}`, `__route__GET__/owners/{}` or `GET /owners/{id}` -> `GET /owners/{}`; null for a non-route. */
function routeKey(symbol: string): string | null {
  const parsed = parseRouteName(symbol);
  if (parsed) return `${parsed.method} ${normPath(parsed.path)}`;
  const m = /^([A-Z]+) (\/\S*)$/.exec(symbol);
  return m ? `${m[1]} ${normPath(m[2])}` : null;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export interface RelationshipPlan {
  relationships: PlannedRelationship[];
  /** Mapped edges whose relationship the model (or the changeset) already has. */
  alreadyPresent: number;
}

/**
 * The relationships the edge mapping gives the mapped CBM edges between two elements, at least one
 * of them a symbol in scope; ends are the run's adds and matches (elements staged by hand from
 * cards included: they are matched by source file and symbol), or existing elements found by
 * their source reference. An end with no element of its own (a method of a class modelled as a
 * component) counts as the class or module it is in, when that is an element. `elements` are the
 * elements the plan keeps (adds after validation and every live existing element), by id, with
 * their `layer.type`.
 */
export function planRelationships(
  extraction: ExtractionGraph,
  existing: ChangesetGraph,
  elementOf: Map<string, string>,
  elements: Map<string, { layer: string; type: string }>,
  hasTriple: (id: string) => boolean,
  layers?: string[]
): RelationshipPlan {
  const { project } = extraction;
  const index = indexExisting(existing);
  const inScope = new Set(extraction.symbols.map((s) => s.qualifiedName));
  const moduleOf = new Map<string, string>();
  for (const s of extraction.symbols) {
    const id = elementOf.get(s.qualifiedName);
    if (s.card.label === "Module" && s.card.file_path && id) moduleOf.set(s.card.file_path, id);
  }
  const moduleIds = new Set(moduleOf.values());
  const layerSet = layers?.length ? new Set(layers) : null;
  const mappings = new Map(extraction.config.edgeMappings.map((m) => [m.cbm_edge, m]));
  // What each file refers to (USAGE, IMPORTS or CALLS edges from any of its symbols). The index
  // resolves a call by its member's name, so MockMvc's `view().name(..)` can land on an entity's
  // `name`: a test's call is a call to a class only when the test's file refers to that class.
  const referencedIn = new Map<string, Set<string>>();
  for (const e of extraction.edges) {
    if (!REFERENCE_EDGES.has(e.type) || !e.from.file) continue;
    let refs = referencedIn.get(e.from.file);
    if (!refs) referencedIn.set(e.from.file, (refs = new Set()));
    refs.add(e.to.qualifiedName);
  }

  // The element a symbol is: this run's add or match, else (out of scope) an element naming it.
  const direct = (qualifiedName: string, name: string, file: string | null): string | undefined => {
    const own = elementOf.get(qualifiedName);
    if (own) return own;
    if (inScope.has(qualifiedName)) return undefined; // a symbol in scope with no element
    const route = parseRouteName(name) ?? parseRouteName(qualifiedName);
    if (route) {
      const key = `${route.method} ${normPath(route.path)}`;
      return (index.byRouteSymbolAnyFile.get(key)?.[0] ?? index.byRoute.get(key)?.[0])?.id;
    }
    return findBySymbol(index, file, symbolSpellings(qualifiedName, name, project))?.id;
  };
  // An edge end: its own element; for a file-joined edge, its file's module; else, for a member
  // with no element of its own (a method, a module's function), the class or module it is in.
  const resolve = (end: EdgeEnd, fileJoined: boolean): { id: string; rolledUp?: string } | undefined => {
    const own = direct(end.qualifiedName, end.name, end.file);
    if (own) return { id: own };
    if (fileJoined) return end.file && moduleOf.has(end.file) ? { id: moduleOf.get(end.file)! } : undefined;
    if (parseRouteName(end.name)) return undefined;
    const cut = end.qualifiedName.lastIndexOf(".");
    const parent = cut > 0 ? end.qualifiedName.slice(0, cut) : "";
    if (!parent || parent === project) return undefined;
    const id = direct(parent, parent.slice(parent.lastIndexOf(".") + 1), end.file);
    return id ? { id, rolledUp: parent } : undefined;
  };

  const found: Array<{ sourceId: string; destinationId: string; relationship: EdgeRelationship; edge: string }> = [];
  for (const edge of extraction.edges) {
    const m = mappings.get(edge.type);
    if (!m) continue;
    const fileJoined = FILE_JOINED_EDGES.has(edge.type);
    const ra = resolve(edge.from, fileJoined);
    const rb = resolve(edge.to, fileJoined);
    if (!ra || !rb) continue;
    // A member rolled up to its class says nothing about that class's own members.
    if ((ra.rolledUp && edge.to.qualifiedName.startsWith(ra.rolledUp + ".")) || (rb.rolledUp && edge.from.qualifiedName.startsWith(rb.rolledUp + "."))) continue;
    const a = ra.id;
    const b = rb.id;
    if (a === b) continue;
    const ea = elements.get(a);
    const eb = elements.get(b);
    if (!ea || !eb) continue;
    // A test's call to a member of a class it never refers to is the index matching a name, not
    // the test exercising that class. A module's function is left alone: tests import modules.
    if (ea.layer === "testing" && rb.rolledUp && !moduleIds.has(b) && !(edge.from.file && refersToClass(referencedIn.get(edge.from.file), rb.rolledUp))) {
      continue;
    }
    const rel = relationshipFor(m, `${ea.layer}.${ea.type}`, `${eb.layer}.${eb.type}`, hasTriple);
    if (!rel) continue;
    const [sourceId, destinationId] = rel.inverted ? [b, a] : [a, b];
    found.push({ sourceId, destinationId, relationship: rel, edge: edge.type });
  }

  const relationships: PlannedRelationship[] = [];
  let alreadyPresent = 0;
  for (const r of dedupeRelationships(found)) {
    const source = elements.get(r.sourceId)!;
    const target = elements.get(r.destinationId)!;
    if (layerSet && !layerSet.has(source.layer) && !layerSet.has(target.layer)) continue;
    // In the model already, or deleted by this changeset on purpose: leave it.
    if (existing.getRelationship(r.sourceId, r.relationship.predicate, r.destinationId)) {
      alreadyPresent++;
      continue;
    }
    relationships.push({
      source: r.sourceId,
      predicate: r.relationship.predicate,
      target: r.destinationId,
      sourceLayer: source.layer,
      targetLayer: target.layer,
      edge: r.edge,
    });
  }
  relationships.sort((x, y) => x.source.localeCompare(y.source) || x.predicate.localeCompare(y.predicate) || x.target.localeCompare(y.target));
  return { relationships, alreadyPresent };
}
