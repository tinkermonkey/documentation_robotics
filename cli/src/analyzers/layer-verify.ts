/**
 * codebase_verify beyond the API layer (#1082): the model's tables, infrastructure and test cases
 * against what extraction makes of the code, per layer, in the API check's buckets.
 *
 * The code side is extraction itself, read-only: the cards and Tier-0 decisions of the layer's CBM
 * labels (cards/extract.ts) planned against the model (extraction-plan.ts planElements), so verify
 * and codebase_extract agree on what is the same element (source location, merged infrastructure
 * names, ids). Per layer:
 *
 *   matched        a model element of a checked type that a symbol matches
 *   in_graph_only  a symbol extraction would add as a new element of a checked type
 *   in_model_only  an element of a checked type, sourced to a file of the kind the layer's code
 *                  comes from, that extraction could produce, and that no symbol matches
 *   not_indexed    the same, when the analyzer didn't index its file or parsed it only in part
 *                  and the file still names it: a parse gap, not drift (check_index_coverage)
 *
 * The testing layer also compares the `tests` relationships of the test cases that matched.
 * Elements that can't be checked (no source file, a file of another kind, a type extraction
 * doesn't produce there, such as a TypeScript test case) are counted, not listed.
 */
import type { ChangesetGraph, GraphElement } from "../core/changeset-graph.js";
import type { ExtractionCoverage } from "../core/extraction-observability.js";
import { INFRA_FILE, SOURCE_EXT, VENDOR_EXCLUDE } from "./cards/build.js";
import { collectExtraction, type ExtractionConfig, type ExtractionGraph } from "./cards/extract.js";
import { TEST_PATH } from "./cards/routes.js";
import type { CardGraph } from "./cards/types.js";
import { planElements, planRelationships, type ElementPlan } from "./extraction-plan.js";
import type { LayerVerifyEntry, LayerVerifyRelationship, LayerVerifyReport } from "./types.js";

/** What each layer's check compares, and where its code comes from. */
export interface LayerCheck {
  /** Element types (in the layer) the check covers. */
  types: string[];
  /** CBM labels whose symbols extraction decides into those types. */
  labels: string[];
  /** Files the layer's code is declared in: an element sourced only elsewhere isn't checked. */
  files: RegExp;
  /** What the check compares, for the report. */
  checks: string;
}

export const LAYER_CHECKS: Readonly<Record<string, LayerCheck>> = Object.freeze({
  "data-store": {
    types: ["collection"],
    labels: ["Table"],
    files: INFRA_FILE,
    checks: "SQL tables the analyzer found (CBM Table nodes) against the model's data-store collections",
  },
  technology: {
    types: ["node", "technologyservice", "artifact", "systemsoftware"],
    labels: ["Resource", "Image", "Chart", "Process"],
    files: INFRA_FILE,
    checks:
      "compose services, Kubernetes objects, container images, Helm charts and launched programs (CBM Resource, Image, Chart and Process nodes) against the model's technology nodes, services, artifacts and system software",
  },
  security: {
    types: ["secureresource"],
    labels: ["Resource"],
    files: INFRA_FILE,
    checks: "Kubernetes Secrets (CBM Resource nodes) against the model's security secure resources",
  },
  testing: {
    types: ["testcasesketch"],
    labels: ["Function", "Method"],
    files: TEST_PATH,
    checks:
      "test cases the analyzer found in test files (annotated or runner-named test functions and methods) against the model's test case sketches, and their tests relationships",
  },
});

/** Entries listed per bucket; the summary counts all of them. */
const LIST_LIMIT = 200;

export interface LayerVerifyInput {
  graph: CardGraph;
  config: ExtractionConfig;
  analyzer: string;
  sourceRoot: string;
  /** The model as verify sees it (the active changeset's view, or the base). */
  model: ChangesetGraph;
  layers: string[];
  /** What extraction can produce, for which model elements and relationships can be checked. */
  coverage: ExtractionCoverage | null;
  /** The files among these the analyzer didn't (fully) index, with why. */
  notIndexed: (files: string[]) => Promise<Map<string, string>>;
  fileExists: (file: string) => boolean;
  /** A file's text, or null when it can't be read. */
  fileText?: (file: string) => string | null;
  /** Catalog check by triple id. */
  hasTriple: (id: string) => boolean;
}

interface Planned {
  extraction: ExtractionGraph;
  plan: ElementPlan;
}

/**
 * Whether a file's text names a symbol's last segment (`Deployment/web` names `web`); true when
 * the text can't be read, so an unreadable file never turns a parse gap into drift.
 */
function names(text: string | null | undefined, symbol: string): boolean {
  if (text === null || text === undefined) return true;
  const last = symbol.split(/[./]/).filter(Boolean).pop() ?? symbol;
  const escaped = last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w$-])${escaped}($|[^\\w$-])`).test(text);
}

function locationsOf(e: GraphElement): Array<{ file: string; symbol?: string }> {
  return (e.sourceReference?.locations ?? [])
    .filter((l) => typeof l.file === "string" && l.file)
    .map((l) => ({ file: l.file.replace(/\\/g, "/").replace(/^\.\//, ""), ...(l.symbol ? { symbol: l.symbol } : {}) }));
}

/** Verify each requested layer that has a check, in the order asked. */
export async function verifyLayers(input: LayerVerifyInput): Promise<LayerVerifyReport[]> {
  const layers = input.layers.filter((l) => LAYER_CHECKS[l]);
  if (!layers.length) return [];
  const live = [...input.model.elements.values()].filter((e) => e.status !== "deleted");
  const plan = (extraction: ExtractionGraph): Planned => ({
    extraction,
    plan: planElements(extraction, input.model, { fileExists: input.fileExists }),
  });

  // Infrastructure: one extraction over the requested layers' labels, the whole project.
  const infraLabels = [...new Set(layers.filter((l) => l !== "testing").flatMap((l) => LAYER_CHECKS[l].labels))];
  const infra = infraLabels.length
    ? plan(await collectExtraction(input.graph, input.config, input.analyzer, { sourceRoot: input.sourceRoot, labels: infraLabels }))
    : null;

  // Test cases: functions and methods in test files only (the graph's, and those the model names).
  let tests: Planned | null = null;
  if (layers.includes("testing")) {
    const files = new Set<string>();
    for (const [file] of await input.graph.rows("MATCH (f:File) RETURN f.file_path")) {
      if (typeof file === "string" && TEST_PATH.test(file) && SOURCE_EXT.test(file) && !VENDOR_EXCLUDE.test(file)) files.add(file);
    }
    for (const e of live) {
      if (e.layer !== "testing") continue;
      for (const l of locationsOf(e)) if (TEST_PATH.test(l.file) && SOURCE_EXT.test(l.file)) files.add(l.file);
    }
    if (files.size) {
      // Routes too, so a test that calls a served route by its URL (MockMvc, supertest) gets the
      // HTTP_CALLS edge extraction derives; a route's own card drops out of the file scope.
      const labels = [...LAYER_CHECKS.testing.labels, "Route"];
      tests = plan(await collectExtraction(input.graph, input.config, input.analyzer, { sourceRoot: input.sourceRoot, labels, files }));
    }
  }

  const reports: LayerVerifyReport[] = [];
  for (const layer of layers) reports.push(await verifyLayer(layer, layer === "testing" ? tests : infra, live, input));
  return reports;
}

async function verifyLayer(layer: string, planned: Planned | null, live: GraphElement[], input: LayerVerifyInput): Promise<LayerVerifyReport> {
  const check = LAYER_CHECKS[layer];
  const checked = (layerOf: string, type: string) => layerOf === layer && check.types.includes(type);
  const matched = new Map<string, LayerVerifyEntry>();
  const inCode = new Map<string, LayerVerifyEntry>();

  if (planned) {
    const adds = new Map(planned.plan.adds.map((a) => [a.id, a]));
    for (const s of planned.extraction.symbols) {
      const id = planned.plan.elementOf.get(s.qualifiedName);
      if (!id) continue;
      const add = adds.get(id);
      const element = add ? undefined : input.model.getElement(id);
      const layerOf = add?.layer ?? element?.layer;
      const typeOf = add?.type ?? element?.type;
      if (!layerOf || !typeOf || !checked(layerOf, typeOf)) continue;
      const target = add ? inCode : matched;
      let entry = target.get(id);
      if (!entry) {
        entry = { id, type: `${layerOf}.${typeOf}`, name: add?.name ?? element?.name ?? s.card.name, files: [], symbol: s.card.name };
        const t = s.tier0;
        if (element && t?.kind === "decide" && `${t.layer}.${t.type}` !== entry.type) entry.code_type = `${t.layer}.${t.type}`;
        target.set(id, entry);
      }
      const file = s.card.file_path;
      if (file && !entry.files.includes(file)) entry.files.push(file);
    }
  }

  // The model's elements of the checked types that no symbol matched.
  const candidates: Array<{ e: GraphElement; files: string[] }> = [];
  let notChecked = 0;
  let withoutSource = 0;
  for (const e of live) {
    if (!checked(e.layer, e.type) || matched.has(e.id)) continue;
    const locations = locationsOf(e);
    if (!locations.length) {
      withoutSource++;
      continue;
    }
    const files = [...new Set(locations.map((l) => l.file).filter((f) => check.files.test(f)))];
    if (!files.length || (input.coverage && !input.coverage.element(e).observable)) {
      notChecked++;
      continue;
    }
    candidates.push({ e, files });
  }
  const gaps = candidates.length ? await input.notIndexed([...new Set(candidates.flatMap((c) => c.files))]) : new Map<string, string>();
  const inModel: LayerVerifyEntry[] = [];
  const notIndexed: LayerVerifyEntry[] = [];
  for (const { e, files } of candidates) {
    const symbol = locationsOf(e).find((l) => l.symbol && check.files.test(l.file))?.symbol;
    const entry: LayerVerifyEntry = { id: e.id, type: `${e.layer}.${e.type}`, name: e.name, files, ...(symbol ? { symbol } : {}) };
    if (files.every((f) => !input.fileExists(f))) inModel.push({ ...entry, reason: "its source file is gone" });
    else if (files.every((f) => gaps.has(f) || !input.fileExists(f))) {
      // None of its files is fully in the graph, so the analyzer may not have seen it: a parse gap,
      // unless no file names it any more (a table dropped from a schema CBM parses only in part).
      const gone = !!symbol && files.every((f) => !names(input.fileText?.(f), symbol));
      if (gone) inModel.push({ ...entry, reason: "its source file doesn't name it any more" });
      else notIndexed.push({ ...entry, reason: gaps.get(files.find((f) => gaps.has(f))!)! });
    } else inModel.push({ ...entry, reason: "the code has no symbol this element names" });
  }

  const report: LayerVerifyReport = {
    layer,
    checks: check.checks,
    buckets: { matched: [...matched.values()], in_graph_only: [...inCode.values()], in_model_only: inModel, not_indexed: notIndexed },
    summary: {
      matched_count: matched.size,
      gap_count: inCode.size,
      drift_count: inModel.length,
      not_indexed_count: notIndexed.length,
      elements_without_source_ref: withoutSource,
      elements_not_checked: notChecked,
    },
  };

  if (layer === "testing" && planned) {
    const rels = testsRelationships(planned, new Set(matched.keys()), input);
    report.relationships = rels;
    report.summary.relationships = { matched_count: rels.matched.length, gap_count: rels.in_graph_only.length, drift_count: rels.in_model_only.length };
  }

  for (const key of ["matched", "in_graph_only", "in_model_only", "not_indexed"] as const) {
    if (report.buckets[key].length > LIST_LIMIT) {
      (report.omitted ??= {})[key] = report.buckets[key].length - LIST_LIMIT;
      report.buckets[key] = report.buckets[key].slice(0, LIST_LIMIT);
    }
  }
  return report;
}

/**
 * The `tests` relationships from the test cases that matched model elements: those extraction
 * finds to other model elements (matched when the model has them, in the code only when not)
 * against the model's own (in the model only when extraction could produce one like it and
 * doesn't).
 */
function testsRelationships(
  planned: Planned,
  matchedTests: Set<string>,
  input: LayerVerifyInput
): NonNullable<LayerVerifyReport["relationships"]> {
  const elements = new Map<string, { layer: string; type: string }>();
  for (const e of input.model.elements.values()) if (e.status !== "deleted") elements.set(e.id, { layer: e.layer, type: e.type });
  const own = new Map([...planned.plan.elementOf].filter(([, id]) => elements.has(id)));
  const { relationships, present = [] } = planRelationships(planned.extraction, input.model, own, elements, input.hasTriple, undefined, {
    includePresent: true,
  });
  const key = (r: { source: string; predicate: string; target: string }) => `${r.source}|${r.predicate}|${r.target}`;
  const fromTests = (r: { source: string; predicate: string }) => r.predicate === "tests" && matchedTests.has(r.source);
  const shape = ({ source, predicate, target, edge }: { source: string; predicate: string; target: string; edge?: string }): LayerVerifyRelationship => ({
    source,
    predicate,
    target,
    ...(edge ? { edge } : {}),
  });
  const matched = present.filter(fromTests).map(shape);
  const inCode = relationships.filter(fromTests).map(shape);
  const found = new Set(matched.map(key));
  const inModel: LayerVerifyRelationship[] = [];
  for (const r of input.model.relationships()) {
    if (r.status === "deleted" || r.predicate !== "tests" || !matchedTests.has(r.source) || found.has(key(r))) continue;
    const source = input.model.getElement(r.source);
    const target = input.model.getElement(r.target);
    if (!source || !target) continue;
    if (input.coverage && !input.coverage.relationship(source, r.predicate, target).observable) continue;
    inModel.push(shape(r));
  }
  return { matched, in_graph_only: inCode, in_model_only: inModel };
}
