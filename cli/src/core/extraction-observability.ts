/**
 * Extraction observability — which planned elements, relationships and fields code extraction can
 * see.
 *
 * `changeset_verify` compares a plan with an as-built changeset. When the as-built side came from
 * `codebase_extract`, a planned element extraction can never produce (a requirement, a re-export,
 * a TypeScript test case) is not "missing": it is unverifiable, and stays out of the verdict.
 *
 * What extraction can produce is read from the analyzer's own mapping (spec/analyzers/<name>/):
 *
 * - the node mapping: each CBM label becomes one element type (and a promoted type), and fills some
 *   of its attributes;
 * - the Tier-0 rules: each decides or narrows to element types, some only for files matching a
 *   pattern;
 * - the edge mapping: each mapped CBM edge becomes a relationship between two element types,
 *   through the relationship catalog and the edge's from_types and to_types, the way
 *   `relationshipFor` decides it during extraction.
 *
 * Facts the mapping files don't state are kept here, each with its reason:
 *
 * - a Route is an HTTP route: an operation sourced to a barrel file (a package entry that
 *   re-exports) with no method and path is not one, and an operation with no method, no path and
 *   no source reference gives extraction nothing to find it by;
 * - some CBM edges link labels no node mapping or Tier-0 rule produces (DEPLOYS links
 *   infrastructure resources), so they make no relationship at all;
 * - DEFINES_METHOD links a class to its methods, not a module to its functions;
 * - the card builder makes no cards for JavaScript and TypeScript test cases (anonymous `it()`
 *   callbacks), so the testing layer is not observable in those files (docs/EXTRACTION_STRATEGY.md,
 *   "Known gap");
 * - extraction writes an operation's method and path (`http_method`, `http_path`) besides the
 *   node mapping's fields.
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

/** Barrel files: a package entry that re-exports what other files define. */
const BARREL_FILE = /(^|\/)(index\.[cm]?[jt]sx?|__init__\.py|mod\.rs)$/;

/** Attributes extraction writes from the code beyond the node mapping (see deriveAttributes). */
const CODE_FACTS: Record<string, string[]> = {
  "api.operation": ["http_method", "http_path"],
};

/**
 * CBM edges whose ends are particular labels. An edge one of whose ends must be a label no node
 * mapping or Tier-0 rule produces makes no relationship: its ends never become elements.
 */
const EDGE_LABELS: Record<string, { oneEndOf: string[]; why: string }> = {
  DEPLOYS: { oneEndOf: ["Resource", "Image"], why: "links infrastructure resources and images" },
  INFRA_MAPS: { oneEndOf: ["Resource"], why: "links infrastructure resources" },
  DEPENDS_ON: { oneEndOf: ["Package", "Image", "Resource"], why: "links packages, images and resources" },
  SPAWNS: { oneEndOf: ["Process"], why: "links code to the processes it launches" },
};

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

/** What an analyzer's extraction can produce, by element type, relationship triple and field. */
export class ExtractionCoverage {
  readonly analyzer: string;
  private readonly producers = new Map<string, Producer[]>();
  /** Layers a Tier-0 rule narrows to with `layer.*`. */
  private readonly wildcardLayers = new Map<string, Producer[]>();
  /** Attributes the node mapping fills, by element type. */
  private readonly filled = new Map<string, Set<string>>();
  private readonly edgeMappings: AnalyzerEdgeMapping[];
  private readonly hasTriple: (id: string) => boolean;
  private readonly tripleCache = new Map<string, Array<{ edge: string; inverted: boolean }>>();

  constructor(input: ExtractionCoverageInput) {
    this.analyzer = input.analyzer;
    this.hasTriple = input.hasTriple ?? catalogHasTriple;
    const add = (type: string, producer: Producer) => {
      const list = this.producers.get(type) ?? [];
      list.push(producer);
      this.producers.set(type, list);
    };
    const fill = (type: string, attributes: string[]) => {
      const set = this.filled.get(type) ?? new Set<string>();
      for (const a of attributes) set.add(a);
      this.filled.set(type, set);
    };
    // Labels whose symbols can become elements, by the node mapping or a Tier-0 rule.
    const labels = new Set<string>();
    for (const m of input.nodeMappings) {
      if (!m.dr_layer || !m.dr_element_type) continue;
      labels.add(m.cbm_label);
      const producer = { via: `node mapping ${m.cbm_label}`, label: m.cbm_label };
      const mapped = m as AnalyzerNodeMapping & {
        dr_element_type_promoted?: string;
        attribute_mappings?: Array<{ dr_attribute?: string }>;
      };
      const attributes = [
        ...(mapped.attribute_mappings ?? []).map((a) => a.dr_attribute).filter((a): a is string => !!a),
        ...Object.keys(m.dr_element_fields ?? {}),
      ];
      for (const type of [m.dr_element_type, mapped.dr_element_type_promoted].filter((t): t is string => !!t)) {
        add(`${m.dr_layer}.${type}`, producer);
        fill(`${m.dr_layer}.${type}`, attributes);
      }
    }
    for (const rule of input.rules) {
      if (rule.action.kind === "reject") continue;
      for (const label of rule.labels) labels.add(label);
      const producer: Producer = { via: `Tier-0 rule ${rule.name}`, ...(rule.when.file ? { file: rule.when.file } : {}) };
      if (rule.action.kind === "decide") add(`${rule.action.layer}.${rule.action.type}`, producer);
      else {
        for (const c of rule.action.candidates) {
          if (c.type) add(`${c.layer}.${c.type}`, producer);
          else this.wildcardLayers.set(c.layer, [...(this.wildcardLayers.get(c.layer) ?? []), producer]);
        }
      }
    }
    for (const [type, facts] of Object.entries(CODE_FACTS)) fill(type, facts);
    this.edgeMappings = input.edgeMappings.filter(
      (m) => m.usage === "verification_and_mapping" && (!EDGE_LABELS[m.cbm_edge] || EDGE_LABELS[m.cbm_edge].oneEndOf.some((l) => labels.has(l)))
    );
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

    const unlocated = isUnlocatedOperation(element, locations);
    const possible = producers.filter((p) => {
      if (p.file && locations.length > 0 && !locations.some((l) => p.file!.test(l.file))) return false;
      if (p.label === "Route" && (unlocated || isReExport(element, locations))) return false;
      return true;
    });
    if (possible.length === 0) {
      const routeOnly = producers.every((p) => p.label === "Route");
      return {
        observable: false,
        reason: !routeOnly
          ? `no ${this.analyzer} rule producing ${type} applies to ${locations.map((l) => l.file).join(", ")}`
          : unlocated
            ? `extraction produces ${type} only from HTTP routes, and this one has no method, path or source reference to find ` +
              "it by. To make it verifiable, give it http_method and http_path (for a route), or sourceFile and sourceSymbol " +
              "(the handler that serves it)"
            : `extraction produces ${type} only from HTTP routes, and this one is a re-export from ${locations.map((l) => l.file).join(", ")} with no method and path`,
      };
    }
    return { observable: true };
  }

  /**
   * Whether extraction writes this field of an element of this type: the name and type, the
   * attributes the node mapping fills, and the code facts it reads (an operation's method and
   * path). Never the description, which comes from a docstring at most, or other attributes.
   */
  field(element: ObservedElement, field: string): boolean {
    if (field === "name" || field === "type") return true;
    if (!field.startsWith("attributes.")) return false;
    return this.filled.get(`${element.layer}.${element.type}`)?.has(field.slice("attributes.".length)) ?? false;
  }

  /**
   * Whether some mapped code edge between these two elements becomes this relationship: by their
   * types, as extraction decides it, and by what the edge links (see EDGE_LABELS, EDGE_ENDPOINTS).
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
          if (r && r.source === sourceType && r.destination === targetType && r.predicate === predicate) {
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
 * A re-export, not a route: no method and path, sourced to a barrel file (a package entry), under a
 * name that isn't route-shaped. Without that evidence an operation may be a route (a handler symbol
 * such as `OwnerController.showVisits` names the code that serves it).
 */
function isReExport(element: ObservedElement, locations: Array<{ file: string; symbol?: string }>): boolean {
  const attrs = element.attributes ?? {};
  if (attrs.http_method || attrs.http_path || attrs.method || attrs.path) return false;
  if (locations.length === 0) return false;
  return locations.every((l) => BARREL_FILE.test(l.file) && !(l.symbol && ROUTE_SYMBOL.test(l.symbol)));
}

/**
 * An operation planned with nothing extraction could find it by: no method or path, and no source
 * reference (so no handler or route symbol either). Extraction finds operations only as routes, by
 * method and path or by the handler's file and symbol, so it can't show such a one either way.
 */
function isUnlocatedOperation(element: ObservedElement, locations: Array<{ file: string; symbol?: string }>): boolean {
  const attrs = element.attributes ?? {};
  if (attrs.http_method || attrs.http_path || attrs.method || attrs.path) return false;
  return locations.length === 0;
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
