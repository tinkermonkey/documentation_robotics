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
 * to be an element is not in the code only, nor is a relationship decided not to be one. So do the
 * project's kept rules (documentation-robotics/extraction-rules.yaml, #1414), applied as
 * codebase_extract applies them: what a rule says is not an element is listed under `ignored` with
 * the rule, and a symbol a rule held for Tier 0 is the rule's when its add would not validate.
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
import { decisionKey, ownerTypeResolver, planElements, planRelationships, sourceSymbolOf, type ElementPlan } from "./extraction-plan.js";
import { applyProjectRules, isProjectRule, overrideTier0Advice, projectRuleName, type CompiledRule } from "./project-rules.js";
import { validatePlannedAdds } from "./validate-planned.js";
import type { LayerVerifyEntry, LayerVerifyRelationship, LayerVerifyReport, VerifyRejections, VerifyRules } from "./types.js";
import { IgnoreFileLoader, type IgnoreRule } from "./verify-ignore.js";
import { groupNotChecked, layerStatus, REJECTED_REASON, RULE_REASON, type LayerNouns, type NotCheckedElement } from "./verify-status.js";

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
  /** The project's kept extraction rules (documentation-robotics/extraction-rules.yaml), applied as codebase_extract applies them. */
  rules?: readonly CompiledRule[];
}

interface Planned {
  /** The extraction as the analyzer and Tier 0 gave it, before the project's rules. */
  extraction: ExtractionGraph;
  plan: ElementPlan;
  /** Symbols (by qualified name) a project rule says are not elements, with the rule's name and reason. */
  ruled: Map<string, { rule: string; reason: string }>;
  /** Adds (by id) a none rule matched and left to Tier 0, which can stage them, with the rule's name (#1424). */
  heldKept: Map<string, string>;
}

/** The layers checked, and those whose check failed (with why). */
export interface LayerVerifyResult {
  reports: LayerVerifyReport[];
  notVerified: Array<{ layer: string; reason: string }>;
  /**
   * Per `none` rule without overrideTier0: symbols of a checked type it matches that Tier 0 decided
   * and can stage, so they stay in the code only (#1424). Absent when there are none.
   */
  tier0Kept?: Record<string, number>;
}

/**
 * The "not an element" and "not a relationship" decisions codebase_extract records
 * (`.dr/analyzers/extract/decisions.json`, see codebase-extract.ts), as the keys layer verify
 * filters by. None when the file is missing or unreadable. With the project's changesets, a
 * decision inferred from an unstage (`how: "unstaged"`) holds only as codebase_extract keeps it:
 * while its changeset is staged, and for a relationship also once that changeset landed. Others
 * are left out here (codebase_extract drops them from the file on its next run).
 *
 * The result also says where the decisions live, whether the file was found, and why it could not
 * be read when it could not: the file is under `.dr/`, which git ignores, so two checkouts of one
 * commit can hold different decisions, and a verdict that depends on them has to say which it used.
 */
export interface RecordedDecisions {
  notElements: Set<string>;
  notRelationships: Set<string>;
  /** The decisions file, relative to the project root. */
  file: string;
  /** Whether the file exists in this checkout. */
  found: boolean;
  /** Set when the file exists and could not be read or parsed: no decision was applied. */
  error?: string;
}

export async function readRecordedDecisions(
  projectRoot: string,
  changesets?: ReadonlyArray<{ id: string; status: string }>
): Promise<RecordedDecisions> {
  const file = path.join(".dr", "analyzers", "extract", "decisions.json");
  let text: string;
  try {
    text = await readFile(path.join(projectRoot, file), "utf-8");
  } catch (error) {
    // No file: nothing was recorded in this checkout. Anything else is a read error, and is said.
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      notElements: new Set(),
      notRelationships: new Set(),
      file,
      found: false,
      ...(missing ? {} : { error: `could not read ${file}: ${error instanceof Error ? error.message : String(error)}` }),
    };
  }
  try {
    const stored = JSON.parse(text);
    const staged = new Set((changesets ?? []).filter((c) => c.status === "staged").map((c) => c.id));
    const landed = new Set((changesets ?? []).filter((c) => c.status === "committed" || c.status === "recorded").map((c) => c.id));
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
      file,
      found: true,
    };
  } catch (error) {
    return {
      notElements: new Set(),
      notRelationships: new Set(),
      file,
      found: true,
      error: `${file} is not valid JSON, so no recorded rejection was applied: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * What a verification says about the recorded rejections it used: the file, how many decisions it
 * read, how many entries each layer left out because of one (listed under that layer's `ignored`),
 * and the read error when there was one.
 */
export function rejectionsApplied(recorded: RecordedDecisions, layers: LayerVerifyReport[]): VerifyRejections {
  const applied: Record<string, number> = {};
  for (const layer of layers) applied[layer.layer] = (layer.buckets.ignored ?? []).filter((e) => e.reason === REJECTED_REASON).length;
  const total = Object.values(applied).reduce((n, c) => n + c, 0);
  const counts = { elements: recorded.notElements.size, relationships: recorded.notRelationships.size };
  const local = `${recorded.file} is not in git (.dr/ is ignored), so another checkout of this commit may hold other decisions and report differently.`;
  return {
    file: recorded.file,
    found: recorded.found,
    recorded: counts,
    applied,
    ...(recorded.error ? { error: recorded.error } : {}),
    note: recorded.error
      ? `No recorded rejection was applied: ${recorded.error}. Entries someone rejected may be listed as in the code only.`
      : !recorded.found
        ? `This checkout has no recorded rejections, so nothing was left out because of one. ${local}`
        : `${counts.elements} recorded rejection(s) were read and ${total} kept an entry out of "in the code only" (each is under its layer's ignored bucket). ${local}`,
  };
}

/**
 * What a verification says about the project's kept rules it applied: the file, how many rules it
 * read, how many entries each layer left out because of one (under that layer's `ignored`, the API
 * layer's routes included), and why none was applied when the file could not be used.
 */
export function rulesApplied(read: number, layers: LayerVerifyReport[], error?: string, tier0Kept: Record<string, number> = {}): VerifyRules {
  const applied: Record<string, number> = {};
  for (const layer of layers) applied[layer.layer] = (layer.buckets.ignored ?? []).filter((e) => e.reason?.startsWith(RULE_REASON)).length;
  const total = Object.values(applied).reduce((n, c) => n + c, 0);
  const file = path.join("documentation-robotics", "extraction-rules.yaml");
  // A kept none rule without overrideTier0 that matches what Tier 0 can stage: those stay in the
  // code only, and the report says what to add, as codebase_extract's ruleWarnings does (#1424).
  const kept = Object.entries(tier0Kept).filter(([, n]) => n > 0);
  const warnings = kept.map(
    ([rule, n]) =>
      `Rule '${rule}' says none, but ${n} symbol(s) it matches were decided by Tier 0 as elements, which codebase_extract stages, so they are listed in the code only. ` +
      `${overrideTier0Advice(rule, n, true)}.`
  );
  return {
    file,
    read,
    applied,
    ...(error ? { error } : {}),
    ...(kept.length ? { tier0Kept: Object.fromEntries(kept), warnings } : {}),
    note: error
      ? `No kept rule was applied: ${error}. Entries a rule says are not elements may be listed as in the code only.`
      : read
        ? `${read} kept rule(s) were applied as codebase_extract applies them, and ${total} kept an entry out of "in the code only" (each is under its layer's ignored bucket, with the rule).`
        : "The project keeps no extraction rules, so none was applied.",
  };
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
  const tier0Kept: Record<string, number> = {};
  const plan = async (extraction: ExtractionGraph): Promise<Planned> => {
    const rules = input.rules ?? [];
    const applied = rules.length ? applyProjectRules(extraction, rules, { ownerTypeOf: ownerTypeResolver(input.model, extraction.project) }) : null;
    const planned = planElements(applied?.extraction ?? extraction, input.model, {
      fileExists: input.fileExists,
      ...(input.notElements ? { notElements: input.notElements } : {}),
    });
    const ruled = new Map<string, { rule: string; reason: string }>();
    const heldKept = new Map<string, string>();
    if (applied) {
      const reasonOf = new Map(rules.map((r) => [r.rule.name, r.rule.reason] as const));
      for (const s of applied.extraction.symbols) {
        if (s.tier0?.kind !== "reject" || !isProjectRule(s.tier0.rule)) continue;
        const rule = projectRuleName(s.tier0.rule);
        ruled.set(s.qualifiedName, { rule, reason: reasonOf.get(rule) ?? "" });
      }
      // A symbol a none rule held for Tier 0 whose add would not validate is a needs-attributes card
      // to codebase_extract, which the rule then decides: the rule's here too, not in the code only.
      const held = planned.adds.filter((a) => applied.held.has(a.symbol.card.id));
      if (held.length) {
        const failing = new Set((await validatePlannedAdds(held)).filter((x) => x.errors.length).map((x) => x.add));
        // What Tier 0 can stage stays Tier 0's: counted under the rule that matched it once its layer's
        // check says it is in the code only (an ignore rule may still cover it).
        for (const a of held) if (!failing.has(a)) heldKept.set(a.id, applied.held.get(a.symbol.card.id)!.rule);
        if (failing.size) {
          planned.adds = planned.adds.filter((a) => !failing.has(a));
          for (const a of failing) {
            planned.elementOf.delete(a.symbol.qualifiedName);
            const rule = applied.held.get(a.symbol.card.id)!.rule;
            ruled.set(a.symbol.qualifiedName, { rule, reason: reasonOf.get(rule) ?? "" });
          }
        }
      }
    }
    return { extraction, plan: planned, ruled, heldKept };
  };

  // Infrastructure: one extraction over the requested layers' labels, the whole project.
  const infraLayers = layers.filter((l) => l !== "testing");
  const infraLabels = [...new Set(infraLayers.flatMap((l) => LAYER_CHECKS[l].labels))];
  const infra = infraLabels.length
    ? await attempt(infraLayers, async () =>
        await plan(await collectExtraction(input.graph, input.config, input.analyzer, { sourceRoot: input.sourceRoot, labels: infraLabels }))
      )
    : null;

  // Test cases: functions and methods in test files only (the graph's, and those the model names).
  const tests = layers.includes("testing") ? await attempt(["testing"], () => planTests(input, live, plan)) : null;

  const reports: LayerVerifyReport[] = [];
  for (const layer of layers) {
    if (failed.has(layer)) continue;
    const report = await attempt([layer], () => verifyLayer(layer, layer === "testing" ? tests : infra, live, input, tier0Kept));
    if (report) reports.push(report);
  }
  for (const layer of layers) if (failed.has(layer)) notVerified.push({ layer, reason: failed.get(layer)! });
  return { reports, notVerified, ...(Object.keys(tier0Kept).length ? { tier0Kept } : {}) };
}

/** The test cases' extraction and plan, or null when no test file is in the graph or the model. */
async function planTests(input: LayerVerifyInput, live: GraphElement[], plan: (extraction: ExtractionGraph) => Promise<Planned>): Promise<Planned | null> {
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

async function verifyLayer(
  layer: string,
  planned: Planned | null,
  live: GraphElement[],
  input: LayerVerifyInput,
  /** Counts, per none rule, this layer's in-the-code-only entries that rule left to Tier 0. */
  tier0Kept: Record<string, number> = {}
): Promise<LayerVerifyReport> {
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

  // Symbols a recorded rejection, or a kept rule, keeps out of "in the code only": listed under
  // ignored with why, as the API layer lists its rejected routes, so neither changes a status unseen.
  const rejected: LayerVerifyEntry[] = [];
  if (planned && (input.notElements?.size || planned.ruled.size)) {
    const seen = new Set<string>();
    for (const s of planned.extraction.symbols) {
      const t = s.tier0;
      if (t?.kind !== "decide" || !checked(t.layer, t.type) || planned.plan.elementOf.has(s.qualifiedName)) continue;
      const symbol = sourceSymbolOf(s);
      const key = decisionKey(s.card.file_path, symbol);
      const ruled = planned.ruled.get(s.qualifiedName);
      const recorded = !!input.notElements?.has(key);
      if ((!recorded && !ruled) || seen.has(key)) continue;
      seen.add(key);
      rejected.push({
        id: key,
        type: `${t.layer}.${t.type}`,
        name: s.card.name,
        files: s.card.file_path ? [s.card.file_path] : [],
        symbol,
        reason: recorded ? REJECTED_REASON : `${RULE_REASON} (${ruled!.rule}${ruled!.reason ? `: ${ruled!.reason}` : ""})`,
      });
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
  const ignored: LayerVerifyEntry[] = [...rejected];
  const unlessIgnored = (entries: LayerVerifyEntry[], as: "route" | "element") =>
    entries.filter((entry) => {
      const reason = input.ignoreRules?.length ? IgnoreFileLoader.matches({ element_id: entry.id, handler: entry.symbol }, as, input.ignoreRules) : null;
      if (reason) ignored.push({ ...entry, reason });
      return !reason;
    });
  const inGraphOnly = unlessIgnored([...inCode.values()], "route");
  for (const entry of inGraphOnly) {
    const rule = planned?.heldKept.get(entry.id);
    if (rule) tier0Kept[rule] = (tier0Kept[rule] ?? 0) + 1;
  }
  const inModelOnly = unlessIgnored(inModel, "element");

  // The testing layer also compares the matched test cases' tests relationships.
  const rels = layer === "testing" && planned ? testsRelationships(planned, matched, input) : null;
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
        // The model's `tests` links the code graph can't confirm are not differences: they are for
        // the agent to check (#1413), listed under relationships.tests_to_check.
        ...(rels ? { relationshipDifferences: rels.in_graph_only.length, testsToCheck: rels.tests_to_check.length } : {}),
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
    report.summary.relationships = {
      matched_count: rels.matched.length,
      gap_count: rels.in_graph_only.length,
      drift_count: 0,
      tests_to_check_count: rels.tests_to_check.length,
    };
    if (rels.tests_to_check.length) report.tests_to_check_note = TESTS_TO_CHECK_NOTE;
  }

  return report;
}

/** What checking a `tests` link means (#1413), said once in the report that lists any. */
export const TESTS_TO_CHECK_NOTE =
  "tests_to_check lists the model's tests links the code graph can't confirm: not drift, and not accepted away. " +
  "Check each in the code: is the link accurate, or did extraction miss it? Fix the model if it is wrong. " +
  "Once it is accurate, decide whether a test is missing and needs writing, or the plan specified a test that isn't needed (remove the link). " +
  "The list stays until the model changes.";

/** Why the code graph can't confirm a model `tests` link, as far as is known. */
function testsLinkReason(
  input: LayerVerifyInput,
  source: { layer: string; type: string },
  predicate: string,
  target: { layer: string; type: string },
  files: string[]
): string {
  const targetVerdict = input.coverage?.element(target as never);
  if (targetVerdict && !targetVerdict.observable) return `target type unreachable from code: ${targetVerdict.reason ?? `${target.layer}.${target.type}`}`;
  const edge = input.coverage?.relationship(source as never, predicate, target as never);
  if (edge && !edge.observable) return `the code graph has no edge for this link: ${edge.reason ?? "no mapped edge"}`;
  if (files.some((f) => /\.(spec|e2e)\.[cm]?[jt]sx?$|(^|\/)(e2e|playwright)\//.test(f))) {
    return "a spec that drives a page or UI: it makes no call into the target, and its file name doesn't match the target's file";
  }
  return "no call from the test reaches the target directly; it may reach it indirectly, through other calls";
}

/**
 * The `tests` relationships from the test cases that matched model elements: those extraction
 * finds to other model elements (matched when the model has them, in the code only when not)
 * against the model's own (in the model only when extraction could produce one like it and
 * doesn't).
 */
function testsRelationships(
  planned: Planned,
  matchedEntries: Map<string, LayerVerifyEntry>,
  input: LayerVerifyInput
): NonNullable<LayerVerifyReport["relationships"]> {
  const elements = new Map<string, { layer: string; type: string }>();
  for (const e of input.model.elements.values()) if (e.status !== "deleted") elements.set(e.id, { layer: e.layer, type: e.type });
  const own = new Map([...planned.plan.elementOf].filter(([, id]) => elements.has(id)));
  const { relationships, present = [] } = planRelationships(planned.extraction, input.model, own, elements, input.hasTriple, undefined, {
    includePresent: true,
  });
  const matchedTests = new Set(matchedEntries.keys());
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
  const toCheck: LayerVerifyRelationship[] = [];
  for (const r of input.model.relationships()) {
    if (r.status === "deleted" || r.predicate !== "tests" || !matchedTests.has(r.source) || found.has(key(r))) continue;
    const source = input.model.getElement(r.source);
    const target = input.model.getElement(r.target);
    if (!source || !target) continue;
    toCheck.push({ ...shape(r), reason: testsLinkReason(input, source, r.predicate, target, matchedEntries.get(r.source)?.files ?? []) });
  }
  return { matched, in_graph_only: inCode, tests_to_check: toCheck };
}
