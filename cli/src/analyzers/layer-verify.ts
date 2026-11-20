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
 *   in_model_only  an element of a checked type, sourced to a location of the kind that type's
 *                  code comes from (a `.sql` file for a collection; a compose or Kubernetes
 *                  manifest and its `Kind/name` symbol for a node or service), that extraction
 *                  could produce, and that no symbol matches
 *   not_indexed    the same, when the analyzer didn't index its file or parsed it only in part
 *                  and the file still names it: a parse gap, not drift (check_index_coverage)
 *   ignored        in the code only or in the model only, but a rule in .dr-verify-ignore.yaml
 *                  covers it
 *
 * The testing layer also compares the `tests` relationships of the test cases that matched, and
 * reads the it() / test() cases of JavaScript and TypeScript test files (extraction's TestCase
 * cards). System software sourced to a dependency manifest is compared with what the manifest
 * lists, from the model's side only (extraction makes no element from a manifest).
 *
 * Elements that can't be checked (no source file, a location of another kind, a type extraction
 * doesn't produce there) are listed under `not_checked`, grouped by why, with what would make each
 * group checkable. Each layer's report leads with its status (verify-status.ts): in step, drifted,
 * or not checked; a layer that compared nothing is never in step. Recorded "not an element" and "not a
 * relationship" decisions (codebase_extract's decisions.json) hold here too: a symbol decided not
 * to be an element is not in the code only, nor is a relationship decided not to be one.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ChangesetGraph, GraphElement } from "../core/changeset-graph.js";
import type { ExtractionCoverage } from "../core/extraction-observability.js";
import { SOURCE_EXT, VENDOR_EXCLUDE } from "./cards/build.js";
import { collectExtraction, type ExtractionConfig, type ExtractionGraph } from "./cards/extract.js";
import { TEST_PATH } from "./cards/routes.js";
import { TEST_CASE_LABEL } from "./cards/test-cases.js";
import type { CardGraph } from "./cards/types.js";
import { planElements, planRelationships, type ElementPlan } from "./extraction-plan.js";
import type { LayerVerifyEntry, LayerVerifyRelationship, LayerVerifyReport } from "./types.js";
import { IgnoreFileLoader, type IgnoreRule } from "./verify-ignore.js";
import { groupNotChecked, layerStatus, type LayerNouns, type NotCheckedElement } from "./verify-status.js";

/** A model element's source location. */
interface Location {
  file: string;
  symbol?: string;
}

/** A compose or Kubernetes object's symbol: its kind and name (`Service/db`, `Deployment/web`). */
const KIND_SYMBOL = /^[A-Z][A-Za-z0-9]*\/[^/]+$/;
/** A compose file or Kubernetes manifest location, with the object's `Kind/name` symbol. */
const manifest = (l: Location) => /\.ya?ml$/i.test(l.file) && !!l.symbol && KIND_SYMBOL.test(l.symbol);
const sqlFile = (l: Location) => /\.sql$/i.test(l.file);
const helmChart = (l: Location) => /(^|\/)Chart\.ya?ml$/i.test(l.file);

/** What each layer's check compares, and where its code comes from. */
export interface LayerCheck {
  /** Element types (in the layer) the check covers. */
  types: string[];
  /** CBM labels whose symbols extraction decides into those types. */
  labels: string[];
  /**
   * Per type, the source locations its code is declared in: an element sourced only elsewhere (a
   * hand-modelled artifact sourced to a CI workflow, say) isn't checked. A type missing here has no
   * file in the code (system software, an image) and is never in the model only.
   */
  sources: Readonly<Record<string, (l: Location) => boolean>>;
  /** What the check compares, for the report. */
  checks: string;
  /** How the check names what it compares, for the layer's status. */
  nouns: LayerNouns;
  /**
   * Per type, why an element sourced only to files the check doesn't read can't be compared, and
   * what would make it checkable; `*` for the types not listed.
   */
  outOfScope: Readonly<Record<string, { reason: string; to_check: string }>>;
}

/** Why an element with no source reference can't be checked, and what would make it checkable. */
const NO_SOURCE = {
  reason: "no source reference: nothing ties it to a file to find it in",
  to_check: "set the element's source file and symbol",
};

/**
 * A dependency manifest: where a system software element that is a library or a runtime, not a
 * launched program, is declared (`package.json` with `dependencies.react` as its symbol).
 * Extraction makes no element from a manifest, so this is read here, from the model's side only:
 * the manifest still lists the dependency, or it doesn't.
 */
const DEPENDENCY_MANIFEST =
  /(^|\/)(package\.json|composer\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|pom\.xml|build\.gradle(\.kts)?|[^/]+\.csproj)$/i;
const dependencyManifest = (l: Location) => DEPENDENCY_MANIFEST.test(l.file);
/** The sections of a manifest a dependency's symbol may start with (`devDependencies.vite`). */
const MANIFEST_SECTION = /^(?:[\w-]*dependencies|require(?:-dev)?|packages?|tool\.poetry(?:\.[\w-]+)*|project(?:\.[\w-]+)*)\./i;

/**
 * Whether a manifest lists the dependency a symbol names (`dependencies.react`, `react`): by key
 * in a JSON manifest's dependency sections, else by name in the file's text. Null when the file
 * can't be read or the symbol names nothing to look for.
 */
export function manifestLists(file: string, text: string | null | undefined, symbol: string | undefined): boolean | null {
  if (text === null || text === undefined || !symbol) return null;
  const name = symbol.replace(MANIFEST_SECTION, "");
  if (!name) return null;
  if (/\.json$/i.test(file)) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const sections = Object.entries(json).filter(([key, value]) => /dependencies$|^require(-dev)?$|^engines$/i.test(key) && value && typeof value === "object");
      return sections.some(([, deps]) => Object.prototype.hasOwnProperty.call(deps, name));
    } catch {
      return null;
    }
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w$-])${escaped}($|[^\\w$-])`, "i").test(text);
}

export const LAYER_CHECKS: Readonly<Record<string, LayerCheck>> = Object.freeze({
  "data-store": {
    types: ["collection"],
    labels: ["Table"],
    sources: { collection: sqlFile },
    checks: "SQL tables the analyzer found (CBM Table nodes) against the model's data-store collections",
    nouns: { model: "data-store collections", code: "SQL tables", reads: "SQL tables only: CREATE TABLE statements in .sql files" },
    outOfScope: {
      "*": {
        reason:
          "sourced to a file that is not a SQL schema: this check reads SQL tables only, so a collection kept another way (a key-value store, files, a document database) can't be compared",
        to_check: "nothing to change when the store is not SQL; a SQL table is checked once its collection is sourced to the .sql file that creates it",
      },
    },
  },
  technology: {
    types: ["node", "technologyservice", "artifact", "systemsoftware"],
    labels: ["Resource", "Image", "Chart", "Process"],
    sources: {
      node: manifest,
      technologyservice: manifest,
      // A Kubernetes Secret or a Helm chart; an image has no file.
      artifact: (l) => (manifest(l) && l.symbol!.startsWith("Secret/")) || helmChart(l),
    },
    checks:
      "compose services, Kubernetes objects (a Secret as a configuration artifact), container images, Helm charts and launched programs (CBM Resource, Image, Chart and Process nodes) against the model's technology nodes, services, artifacts and system software; and system software sourced to a dependency manifest (package.json, requirements.txt, go.mod, ...) against what that manifest lists",
    nouns: {
      model: "technology nodes, services, artifacts and system software",
      code: "infrastructure objects, images and launched programs",
      reads: "compose files, Kubernetes manifests, Helm charts, image references and the programs the code launches",
    },
    outOfScope: {
      systemsoftware: {
        reason:
          "system software sourced to a file that is not a dependency manifest: it is compared only with the programs the code launches, and none is it",
        to_check: "source it to the manifest that declares it, with the dependency as the symbol (package.json and dependencies.<name>)",
      },
      artifact: {
        reason: "an artifact sourced to a file that is not a Kubernetes Secret manifest or a Helm chart: it is compared only with the images the code names, and none is it",
        to_check: "source a chart to its Chart.yaml and a Secret to its manifest with Secret/<name> as the symbol",
      },
      "*": {
        reason: "sourced to a file that is not a compose file or a Kubernetes manifest with a Kind/name symbol",
        to_check: "source it to the compose file or manifest that declares it, with its kind and name as the symbol (Service/db, Deployment/web)",
      },
    },
  },
  testing: {
    types: ["testcasesketch"],
    // TestCase is extraction's own label for a JavaScript or TypeScript it() / test() call, read
    // from the test file's text (cards/test-cases.ts): without it no JS/TS test case is compared.
    labels: ["Function", "Method", TEST_CASE_LABEL],
    sources: { testcasesketch: (l) => TEST_PATH.test(l.file) },
    checks:
      "test cases the analyzer found in test files (annotated or runner-named test functions and methods, and the it() / test() calls of JavaScript and TypeScript test files) against the model's test case sketches, and their tests relationships",
    nouns: {
      model: "test case sketches",
      code: "test cases",
      reads: "test files by their path (tests/, *.test.ts, *.spec.ts, test_*.py, *_test.go, *Test.java): test functions and methods, and it() / test() calls",
    },
    outOfScope: {
      "*": {
        reason: "sourced to a file that is not a test file by its path (tests/, *.test.ts, *.spec.ts, test_*.py, *_test.go, *Test.java)",
        to_check: "source it to the test file that holds the case, with the case's title (suite > case) or function as the symbol",
      },
    },
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
  /** Symbols recorded as not elements, by `decisionKey` (codebase_extract's decisions). */
  notElements?: ReadonlySet<string>;
  /** Relationships recorded as not relationships, as `source::predicate::target`. */
  notRelationships?: ReadonlySet<string>;
  /**
   * .dr-verify-ignore.yaml's rules: `graph_only` rules cover what is in the code only (by element
   * id, or `handler` as a glob over the symbol), `model_only` rules what is in the model only.
   */
  ignoreRules?: IgnoreRule[];
}

interface Planned {
  extraction: ExtractionGraph;
  plan: ElementPlan;
}

/** The layers checked, and those whose check failed (with why). */
export interface LayerVerifyResult {
  reports: LayerVerifyReport[];
  notVerified: Array<{ layer: string; reason: string }>;
}

/**
 * The "not an element" and "not a relationship" decisions codebase_extract records
 * (`.dr/analyzers/extract/decisions.json`, see codebase-extract.ts), as the keys layer verify
 * filters by. None when the file is missing or unreadable. With the project's changesets, a
 * decision inferred from an unstage (`how: "unstaged"`) holds only as codebase_extract keeps it:
 * while its changeset is staged, and for a relationship also once that changeset landed. Others
 * are left out here (codebase_extract drops them from the file on its next run).
 */
export async function readRecordedDecisions(
  projectRoot: string,
  changesets?: ReadonlyArray<{ id: string; status: string }>
): Promise<{ notElements: Set<string>; notRelationships: Set<string> }> {
  try {
    const stored = JSON.parse(await readFile(path.join(projectRoot, ".dr", "analyzers", "extract", "decisions.json"), "utf-8"));
    const staged = new Set((changesets ?? []).filter((c) => c.status === "staged").map((c) => c.id));
    const landed = new Set((changesets ?? []).filter((c) => c.status === "committed").map((c) => c.id));
    const keys = (o: unknown, holds: (changesetId: string | undefined) => boolean) =>
      new Set(
        o && typeof o === "object"
          ? Object.entries(o as Record<string, { how?: string; changesetId?: string } | null>)
              .filter(([, d]) => !changesets || d?.how !== "unstaged" || holds(d.changesetId))
              .map(([key]) => key)
          : []
      );
    return {
      notElements: keys(stored?.notElements, (id) => !!id && staged.has(id)),
      notRelationships: keys(stored?.notRelationships, (id) => !!id && (staged.has(id) || landed.has(id))),
    };
  } catch {
    return { notElements: new Set(), notRelationships: new Set() };
  }
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

function locationsOf(e: GraphElement): Location[] {
  return (e.sourceReference?.locations ?? [])
    .filter((l) => typeof l.file === "string" && l.file)
    .map((l) => ({ file: l.file.replace(/\\/g, "/").replace(/^\.\//, ""), ...(l.symbol ? { symbol: l.symbol } : {}) }));
}

/** The graph with each Cypher query's rows read once, however often extraction asks. */
function sharedQueries(graph: CardGraph): CardGraph {
  const rows = new Map<string, Promise<unknown[][]>>();
  return {
    project: graph.project,
    search: (label, filePattern, fields) => graph.search(label, filePattern, fields),
    snippet: (qn) => graph.snippet(qn),
    rows: (cypher) => {
      let hit = rows.get(cypher);
      if (!hit) {
        hit = graph.rows(cypher);
        // A failed query is asked again, not remembered.
        hit.catch(() => rows.delete(cypher));
        rows.set(cypher, hit);
      }
      return hit;
    },
  };
}

/** Verify each requested layer that has a check, in the order asked. */
export async function verifyLayers(input: LayerVerifyInput): Promise<LayerVerifyResult> {
  const layers = input.layers.filter((l) => LAYER_CHECKS[l]);
  const notVerified: LayerVerifyResult["notVerified"] = [];
  if (!layers.length) return { reports: [], notVerified };
  // A layer whose check fails is reported as not verified; the other layers' results stand.
  const failed = new Map<string, string>();
  const attempt = async <T>(forLayers: string[], run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const l of forLayers) if (!failed.has(l)) failed.set(l, reason);
      return null;
    }
  };
  // The two extractions read the same edge, fact and doc indexes: query the graph for them once.
  input = { ...input, graph: sharedQueries(input.graph) };
  const live = [...input.model.elements.values()].filter((e) => e.status !== "deleted");
  const plan = (extraction: ExtractionGraph): Planned => ({
    extraction,
    plan: planElements(extraction, input.model, { fileExists: input.fileExists, ...(input.notElements ? { notElements: input.notElements } : {}) }),
  });

  // Infrastructure: one extraction over the requested layers' labels, the whole project.
  const infraLayers = layers.filter((l) => l !== "testing");
  const infraLabels = [...new Set(infraLayers.flatMap((l) => LAYER_CHECKS[l].labels))];
  const infra = infraLabels.length
    ? await attempt(infraLayers, async () =>
        plan(await collectExtraction(input.graph, input.config, input.analyzer, { sourceRoot: input.sourceRoot, labels: infraLabels }))
      )
    : null;

  // Test cases: functions and methods in test files only (the graph's, and those the model names).
  const tests = layers.includes("testing") ? await attempt(["testing"], () => planTests(input, live, plan)) : null;

  const reports: LayerVerifyReport[] = [];
  for (const layer of layers) {
    if (failed.has(layer)) continue;
    const report = await attempt([layer], () => verifyLayer(layer, layer === "testing" ? tests : infra, live, input));
    if (report) reports.push(report);
  }
  for (const layer of layers) if (failed.has(layer)) notVerified.push({ layer, reason: failed.get(layer)! });
  return { reports, notVerified };
}

/** The test cases' extraction and plan, or null when no test file is in the graph or the model. */
async function planTests(input: LayerVerifyInput, live: GraphElement[], plan: (extraction: ExtractionGraph) => Planned): Promise<Planned | null> {
  const files = new Set<string>();
  for (const [file] of await input.graph.rows("MATCH (f:File) RETURN f.file_path")) {
    if (typeof file === "string" && TEST_PATH.test(file) && SOURCE_EXT.test(file) && !VENDOR_EXCLUDE.test(file)) files.add(file);
  }
  for (const e of live) {
    if (e.layer !== "testing") continue;
    for (const l of locationsOf(e)) if (TEST_PATH.test(l.file) && SOURCE_EXT.test(l.file)) files.add(l.file);
  }
  if (!files.size) return null;
  // Routes too, so a test that calls a served route by its URL (MockMvc, supertest) gets the
  // HTTP_CALLS edge extraction derives; a route's own card drops out of the file scope.
  const labels = [...LAYER_CHECKS.testing.labels, "Route"];
  return plan(await collectExtraction(input.graph, input.config, input.analyzer, { sourceRoot: input.sourceRoot, labels, files }));
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

  // The model's elements of the checked types that no symbol matched: each ends in the model only
  // (drift), not indexed, or not checked with why. None is only counted.
  const candidates: Array<{ e: GraphElement; files: string[]; symbol?: string }> = [];
  const uncompared: NotCheckedElement[] = [];
  const inModel: LayerVerifyEntry[] = [];
  let notChecked = 0;
  let withoutSource = 0;
  // JavaScript and TypeScript test files extraction read for their it() / test() calls: a case
  // sourced to one of them is compared here, whatever the plan-side coverage says of such cases.
  const testFilesRead = new Set(layer === "testing" ? (planned?.extraction.testFiles ?? []) : []);
  for (const e of live) {
    if (!checked(e.layer, e.type) || matched.has(e.id)) continue;
    const locations = locationsOf(e);
    if (!locations.length) {
      withoutSource++;
      uncompared.push({ id: e.id, ...NO_SOURCE });
      continue;
    }
    // System software declared in a dependency manifest: the manifest lists it, or it doesn't.
    const declaredIn = layer === "technology" && e.type === "systemsoftware" ? locations.find(dependencyManifest) : undefined;
    if (declaredIn) {
      const entry: LayerVerifyEntry = { id: e.id, type: `${e.layer}.${e.type}`, name: e.name, files: [declaredIn.file], ...(declaredIn.symbol ? { symbol: declaredIn.symbol } : {}) };
      if (!input.fileExists(declaredIn.file)) {
        inModel.push({ ...entry, reason: "its source file is gone" });
        continue;
      }
      const listed = manifestLists(declaredIn.file, input.fileText?.(declaredIn.file), declaredIn.symbol);
      if (listed === true) matched.set(e.id, entry);
      else if (listed === false) inModel.push({ ...entry, reason: `${declaredIn.file} doesn't list it any more` });
      else {
        notChecked++;
        uncompared.push({
          id: e.id,
          reason: "sourced to a dependency manifest with no symbol naming the dependency, or one that can't be read",
          to_check: "give its source reference the dependency as the symbol (package.json and dependencies.<name>)",
        });
      }
      continue;
    }
    const accepts = check.sources[e.type];
    const inScope = accepts ? locations.filter(accepts) : [];
    const files = [...new Set(inScope.map((l) => l.file))];
    if (!files.length) {
      notChecked++;
      uncompared.push({ id: e.id, ...(check.outOfScope[e.type] ?? check.outOfScope["*"]) });
      continue;
    }
    const readAsTests = files.some((f) => testFilesRead.has(f));
    const verdict = input.coverage && !readAsTests ? input.coverage.element(e) : null;
    if (verdict && !verdict.observable) {
      notChecked++;
      uncompared.push({ id: e.id, reason: verdict.reason ?? "extraction can't produce an element of this type from its source file" });
      continue;
    }
    candidates.push({ e, files, symbol: inScope.find((l) => l.symbol)?.symbol });
  }
  const gaps = candidates.length ? await input.notIndexed([...new Set(candidates.flatMap((c) => c.files))]) : new Map<string, string>();
  const notIndexed: LayerVerifyEntry[] = [];
  for (const { e, files, symbol } of candidates) {
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

  // What .dr-verify-ignore.yaml covers is neither a gap nor drift.
  const ignored: LayerVerifyEntry[] = [];
  const unlessIgnored = (entries: LayerVerifyEntry[], as: "route" | "element") =>
    entries.filter((entry) => {
      const reason = input.ignoreRules?.length ? IgnoreFileLoader.matches({ element_id: entry.id, handler: entry.symbol }, as, input.ignoreRules) : null;
      if (reason) ignored.push({ ...entry, reason });
      return !reason;
    });
  const inGraphOnly = unlessIgnored([...inCode.values()], "route");
  const inModelOnly = unlessIgnored(inModel, "element");

  // The testing layer also compares the matched test cases' tests relationships.
  const rels = layer === "testing" && planned ? testsRelationships(planned, new Set(matched.keys()), input) : null;
  const notCheckedGroups = groupNotChecked(uncompared);
  const report: LayerVerifyReport = {
    layer,
    ...layerStatus(
      {
        matched: matched.size,
        inCodeOnly: inGraphOnly.length,
        inModelOnly: inModelOnly.length,
        notIndexed: notIndexed.length,
        notChecked: uncompared.length,
        ignoredInModel: inModel.length - inModelOnly.length,
        ...(rels ? { relationshipDifferences: rels.in_graph_only.length + rels.in_model_only.length } : {}),
      },
      check.nouns
    ),
    ...(notCheckedGroups.length ? { not_checked: notCheckedGroups } : {}),
    checks: check.checks,
    buckets: {
      matched: [...matched.values()],
      in_graph_only: inGraphOnly,
      in_model_only: inModelOnly,
      not_indexed: notIndexed,
      ...(ignored.length ? { ignored } : {}),
    },
    summary: {
      matched_count: matched.size,
      gap_count: inGraphOnly.length,
      drift_count: inModelOnly.length,
      not_indexed_count: notIndexed.length,
      elements_without_source_ref: withoutSource,
      elements_not_checked: notChecked,
      ...(ignored.length ? { ignored_count: ignored.length } : {}),
    },
  };

  if (rels) {
    report.relationships = rels;
    report.summary.relationships = { matched_count: rels.matched.length, gap_count: rels.in_graph_only.length, drift_count: rels.in_model_only.length };
  }

  for (const key of ["matched", "in_graph_only", "in_model_only", "not_indexed", "ignored"] as const) {
    const list = report.buckets[key];
    if (list && list.length > LIST_LIMIT) {
      (report.omitted ??= {})[key] = list.length - LIST_LIMIT;
      report.buckets[key] = list.slice(0, LIST_LIMIT);
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
  // A relationship recorded as not one (codebase_extract reject) is not in the code only.
  const inCode = relationships.filter((r) => fromTests(r) && !input.notRelationships?.has(`${r.source}::${r.predicate}::${r.target}`)).map(shape);
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
