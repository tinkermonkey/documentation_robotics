/**
 * Extraction observability — which planned elements and relationships code extraction can see.
 *
 * `changeset_verify` compares a plan with an as-built changeset. When the as-built side came from
 * `codebase_extract`, a planned element extraction can never produce (a requirement, a re-export,
 * a TypeScript test case) is not "missing": it is unverifiable, and stays out of the verdict.
 *
 * What extraction can produce is read from the analyzer's own mapping (spec/analyzers/<name>/):
 *
 * - the node mapping: each CBM label becomes one element type (and a promoted type);
 * - the Tier-0 rules: each decides or narrows to element types, some only for files matching a
 *   pattern;
 * - the edge mapping: each mapped CBM edge becomes a relationship between two element types,
 *   through the relationship catalog, the way `relationshipFor` decides it during extraction, within
 *   the layers of its `dr_pattern` (or its from_types and to_types).
 *
 * Facts the mapping files don't state are kept here, each with its reason:
 *
 * - a Route is an HTTP route: an operation without a method and path, or whose source symbol is a
 *   plain identifier (a re-exported function), is not one;
 * - DEFINES_METHOD links a class to its methods, not a module to its functions;
 * - the card builder makes no cards for JavaScript and TypeScript test cases (anonymous `it()`
 *   callbacks), so the testing layer is not observable in those files (docs/EXTRACTION_STRATEGY.md,
 *   "Known gap").
 *
 * Intent (motivation, business, product) is never read from code.
 */

import { MappingLoader } from "../analyzers/mapping-loader.js";
import { relationshipFor } from "../analyzers/edge-relationships.js";
import { tier0RulesFrom, type Tier0Rule } from "../analyzers/tier0-rules.js";
import type { AnalyzerEdgeMapping, AnalyzerNodeMapping } from "../analyzers/types.js";
import { getValidRelationships } from "../generated/relationship-index.js";
import type { SourceReference } from "../types/source-reference.js";

/** Layers that state intent; no code says why the system exists. */
const NEVER_OBSERVABLE_LAYERS = new Set(["motivation", "business", "product"]);

/** Files the card builder makes no test cards for: JS/TS test cases are anonymous callbacks. */
const NO_TEST_CARDS = /\.[cm]?[jt]sx?$/;

/** A Route's symbol: `GET /owners/{id}` or CBM's `__route__GET__/owners/{id}`. */
const ROUTE_SYMBOL = /^(?:__route__[A-Z]+__\/|[A-Z]+ \/)/;

/**
 * CBM edges that link only some symbols of their element types, by which end (in CBM's direction)
 * must be what. DEFINES_METHOD runs from a class to its methods: a module-level function, whose
 * symbol names no owner (`computeNodeDegrees`, not `OwnerController.initCreationForm`), has none.
 */
const EDGE_ENDPOINTS: Record<string, { to?: (element: ObservedElement) => boolean; why: string }> = {
  DEFINES_METHOD: {
    to: (element) => {
      const symbols = sourceLocations(element)
        .map((l) => l.symbol)
        .filter((s): s is string => !!s);
      return symbols.length === 0 || symbols.some((s) => s.includes("."));
    },
    why: "links a class to its methods only, and this function is not a method",
  },
};

/** What an element looks like to the observability check. */
export interface ObservedElement {
  layer: string;
  type: string;
  attributes?: Record<string, unknown>;
  sourceReference?: SourceReference;
}

export interface ObservabilityVerdict {
  observable: boolean;
  /** Why not, when it is not. */
  reason?: string;
}

/** One way extraction produces an element type. */
interface Producer {
  /** `node mapping <Label>` or `Tier-0 rule <name>`. */
  via: string;
  /** For a node mapping: the CBM label. */
  label?: string;
  /** For a Tier-0 rule with a file condition: the files it applies to. */
  file?: RegExp;
}

export interface ExtractionCoverageInput {
  analyzer: string;
  nodeMappings: AnalyzerNodeMapping[];
  edgeMappings: AnalyzerEdgeMapping[];
  rules: Tier0Rule[];
  /** Catalog check by triple id (`layer.type.predicate.layer.type`); defaults to the generated index. */
  hasTriple?: (id: string) => boolean;
}

function catalogHasTriple(id: string): boolean {
  const parts = id.split(".");
  if (parts.length !== 5) return false;
  return getValidRelationships(`${parts[0]}.${parts[1]}`, parts[2], `${parts[3]}.${parts[4]}`).length > 0;
}

function sourceLocations(element: ObservedElement): Array<{ file: string; symbol?: string }> {
  return (element.sourceReference?.locations ?? [])
    .filter((l) => typeof l?.file === "string" && l.file.length > 0)
    .map((l) => ({ file: l.file.replace(/\\/g, "/").replace(/^\.\//, ""), ...(l.symbol ? { symbol: l.symbol } : {}) }));
}

/** What an analyzer's extraction can produce, by element type and relationship triple. */
export class ExtractionCoverage {
  readonly analyzer: string;
  private readonly producers = new Map<string, Producer[]>();
  /** Layers a Tier-0 rule narrows to with `layer.*`. */
  private readonly wildcardLayers = new Map<string, Producer[]>();
  private readonly edgeMappings: AnalyzerEdgeMapping[];
  private readonly hasTriple: (id: string) => boolean;
  private readonly tripleCache = new Map<string, Array<{ edge: string; inverted: boolean }>>();

  constructor(input: ExtractionCoverageInput) {
    this.analyzer = input.analyzer;
    this.hasTriple = input.hasTriple ?? catalogHasTriple;
    this.edgeMappings = input.edgeMappings.filter((m) => m.usage === "verification_and_mapping");
    const add = (type: string, producer: Producer) => {
      const list = this.producers.get(type) ?? [];
      list.push(producer);
      this.producers.set(type, list);
    };
    for (const m of input.nodeMappings) {
      if (!m.dr_layer || !m.dr_element_type) continue;
      const producer = { via: `node mapping ${m.cbm_label}`, label: m.cbm_label };
      add(`${m.dr_layer}.${m.dr_element_type}`, producer);
      const promoted = (m as AnalyzerNodeMapping & { dr_element_type_promoted?: string }).dr_element_type_promoted;
      if (promoted) add(`${m.dr_layer}.${promoted}`, producer);
    }
    for (const rule of input.rules) {
      const producer: Producer = { via: `Tier-0 rule ${rule.name}`, ...(rule.when.file ? { file: rule.when.file } : {}) };
      if (rule.action.kind === "decide") add(`${rule.action.layer}.${rule.action.type}`, producer);
      else if (rule.action.kind === "narrow") {
        for (const c of rule.action.candidates) {
          if (c.type) add(`${c.layer}.${c.type}`, producer);
          else this.wildcardLayers.set(c.layer, [...(this.wildcardLayers.get(c.layer) ?? []), producer]);
        }
      }
    }
  }

  /** Element types extraction can produce at all (`layer.type`), sorted. */
  observableTypes(): string[] {
    return [...this.producers.keys()].sort();
  }

  /**
   * Whether extraction could produce this element. `codeFiles` are the files the build was
   * extracted from; they stand in for the element's own source file when it names none.
   */
  element(element: ObservedElement, codeFiles: string[] = []): ObservabilityVerdict {
    const type = `${element.layer}.${element.type}`;
    if (NEVER_OBSERVABLE_LAYERS.has(element.layer)) {
      return { observable: false, reason: `extraction does not read intent (${element.layer}) from code` };
    }
    const producers = [...(this.producers.get(type) ?? []), ...(this.wildcardLayers.get(element.layer) ?? [])];
    if (producers.length === 0) {
      return { observable: false, reason: `the ${this.analyzer} mapping produces no ${type} elements` };
    }

    const locations = sourceLocations(element);
    const files = locations.length > 0 ? locations.map((l) => l.file) : codeFiles;
    if (element.layer === "testing" && files.length > 0 && files.every((f) => NO_TEST_CARDS.test(f))) {
      return {
        observable: false,
        reason: "JavaScript and TypeScript test cases are anonymous callbacks and never become extraction cards",
      };
    }

    const possible = producers.filter((p) => {
      if (p.file && locations.length > 0 && !locations.some((l) => p.file!.test(l.file))) return false;
      if (p.label === "Route" && !looksLikeRoute(element, locations)) return false;
      return true;
    });
    if (possible.length === 0) {
      const routeOnly = producers.every((p) => p.label === "Route");
      return {
        observable: false,
        reason: routeOnly
          ? `extraction produces ${type} only from HTTP routes, and this one names no method and path (e.g. a re-export)`
          : `no ${this.analyzer} rule producing ${type} applies to ${locations.map((l) => l.file).join(", ")}`,
      };
    }
    return { observable: true };
  }

  /**
   * Whether some mapped code edge between these two elements becomes this relationship: by their
   * types, as extraction decides it, and by what the edge links (see EDGE_ENDPOINTS).
   */
  relationship(source: ObservedElement, predicate: string, target: ObservedElement): ObservabilityVerdict {
    const sourceType = `${source.layer}.${source.type}`;
    const targetType = `${target.layer}.${target.type}`;
    const key = `${sourceType}|${predicate}|${targetType}`;
    let edges = this.tripleCache.get(key);
    if (edges === undefined) {
      // Each producing edge, with the CBM edge's own ends: `inverted` when it runs target → source.
      edges = [];
      for (const m of this.edgeMappings) {
        for (const inverted of [false, true]) {
          const [from, to] = inverted ? [targetType, sourceType] : [sourceType, targetType];
          const r = relationshipFor(m, from, to, this.hasTriple);
          if (r && r.source === sourceType && r.destination === targetType && r.predicate === predicate && withinPattern(m, r)) {
            edges.push({ edge: m.cbm_edge, inverted });
          }
        }
      }
      this.tripleCache.set(key, edges);
    }
    if (edges.length === 0) {
      return { observable: false, reason: `the ${this.analyzer} edge mapping turns no code edge into ${sourceType} ${predicate} ${targetType}` };
    }
    const possible = edges.filter(({ edge, inverted }) => {
      const check = EDGE_ENDPOINTS[edge]?.to;
      return !check || check(inverted ? source : target);
    });
    if (possible.length === 0) {
      return {
        observable: false,
        reason: edges.map(({ edge }) => `${edge} ${EDGE_ENDPOINTS[edge]?.why ?? "does not apply"}`).join("; "),
      };
    }
    return { observable: true };
  }
}

/**
 * Whether a relationship stays in the layers the edge mapping's dr_pattern names. A CBM edge links
 * particular labels (DEPLOYS links infrastructure resources, CALLS functions), so the layers of its
 * typical case bound what it can produce. A side with from_types or to_types is bounded by those
 * instead, through relationshipFor.
 */
function withinPattern(m: AnalyzerEdgeMapping, r: { source: string; destination: string; inverted: boolean }): boolean {
  const pattern = /^\s*([a-z-]+)\.[\w*-]+\s*→\s*([a-z-]+)\.[\w*-]+\s*$/.exec(m.dr_pattern ?? "");
  if (!pattern) return true;
  const conditions = (m.conditions ?? {}) as { from_types?: unknown; to_types?: unknown };
  const typed = (side: unknown) => Array.isArray(side) && side.length > 0;
  // dr_pattern is in DR direction; from_types/to_types are on the CBM edge's ends.
  const [sourceTyped, destinationTyped] = r.inverted
    ? [typed(conditions.to_types), typed(conditions.from_types)]
    : [typed(conditions.from_types), typed(conditions.to_types)];
  const layer = (type: string) => type.split(".")[0];
  return (sourceTyped || layer(r.source) === pattern[1]) && (destinationTyped || layer(r.destination) === pattern[2]);
}

/** An HTTP route: a method and path in its attributes, or a route-shaped source symbol. */
function looksLikeRoute(element: ObservedElement, locations: Array<{ symbol?: string }>): boolean {
  const attrs = element.attributes ?? {};
  if (attrs.http_method || attrs.http_path || attrs.method || attrs.path) return true;
  const symbols = locations.map((l) => l.symbol).filter((s): s is string => !!s);
  // Nothing says what it is: it may be a route.
  if (symbols.length === 0) return true;
  return symbols.some((s) => ROUTE_SYMBOL.test(s));
}

/** The coverage of an analyzer's bundled mapping, or null when it can't be read. */
export async function loadExtractionCoverage(analyzer: string): Promise<ExtractionCoverage | null> {
  try {
    const mapper = await MappingLoader.load(analyzer);
    const nodeMappings = mapper
      .getNodeLabels()
      .map((label) => mapper.getNodeMapping(label))
      .filter((m): m is AnalyzerNodeMapping => !!m);
    const edgeMappings = mapper
      .getEdgeTypes()
      .map((type) => mapper.getEdgeMapping(type))
      .filter((m): m is AnalyzerEdgeMapping => !!m);
    return new ExtractionCoverage({ analyzer, nodeMappings, edgeMappings, rules: tier0RulesFrom(mapper.getHeuristics()) });
  } catch {
    return null;
  }
}
