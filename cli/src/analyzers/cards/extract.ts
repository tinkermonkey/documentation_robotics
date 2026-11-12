/**
 * What the extraction cascade reads from a CBM project: a card, its facts and its Tier-0 outcome
 * for every candidate symbol in scope, and the CBM edges the edge mapping turns into
 * relationships. No network, no model calls, no writes. `codebase_extract` plans and stages a
 * changeset from it (src/analyzers/extraction-plan.ts).
 *
 * Tier 1 (a decision model) is not wired: a symbol Tier 0 narrows or leaves open is returned
 * undecided, for the calling agent. A Tier-1 pass would run between the Tier-0 outcome and the
 * plan, on the cards this returns (docs/analyzers/CASCADE_DESIGN.md, build step 3).
 */
import type { Tier0Outcome, Tier0Rule } from "../tier0-rules.js";
import type { AnalyzerEdgeMapping, AnalyzerNodeMapping } from "../types.js";
import { CARD_FIELDS, CardBuilder, VENDOR_EXCLUDE, cardId, isCandidate } from "./build.js";
import { defaultLabels } from "./classify.js";
import { CbmToolError } from "../cbm-responses.js";
import { buildDocIndex, collectDecisionRecords, docsFor, readMentions, type DecisionRecord, type DocEvidence, type DocIndex } from "./docs.js";
import { buildEdgeIndex } from "./edge-index.js";
import { buildFactsIndex, factsFor } from "./facts.js";
import { TEST_PATH, namedRoutePath, routesCalledIn } from "./routes.js";
import { TEST_CASE_LABEL, collectJsTestCases, type TestCaseStats } from "./test-cases.js";
import { tier0ForCard } from "./tier0.js";
import type { CardFacts, CardGraph, GraphNode, SymbolCard } from "./types.js";

/** Files whose symbols one query lists. */
const CHECK_FILES_PER_QUERY = 200;

/** CBM edges whose ends are files: an end is joined to the Module card of its file. */
export const FILE_JOINED_EDGES: ReadonlySet<string> = new Set(["IMPORTS", "TESTS_FILE"]);

/** A layer and type a label maps to outright (the node mapping's high-confidence entries). */
export interface LabelDecision {
  layer: string;
  type: string;
}

export interface ExtractionConfig {
  rules: Tier0Rule[];
  /** Edge mappings that create relationships (`usage: "verification_and_mapping"`). */
  edgeMappings: AnalyzerEdgeMapping[];
  /**
   * Labels whose node mapping decides the type when no Tier-0 rule matches: a CBM Route is an
   * `api.operation` (docs/analyzers/CASCADE_DESIGN.md, "A route handler is an application
   * function, not an operation").
   */
  labelDecisions: Record<string, LabelDecision>;
  /** The node mapping's default type per label, offered to the agent as a hint for undecided cards. */
  labelDefaults: Record<string, string>;
}

/** The extraction settings an analyzer mapping gives: its Tier-0 rules, edge and node mappings. */
export function extractionConfigFrom(
  rules: Tier0Rule[],
  edgeMappings: AnalyzerEdgeMapping[],
  nodeMappings: AnalyzerNodeMapping[]
): ExtractionConfig {
  const labelDecisions: Record<string, LabelDecision> = {};
  const labelDefaults: Record<string, string> = {};
  for (const m of nodeMappings) {
    if (!m.dr_layer || !m.dr_element_type) continue;
    labelDefaults[m.cbm_label] = `${m.dr_layer}.${m.dr_element_type}`;
    if (m.confidence === "high") labelDecisions[m.cbm_label] = { layer: m.dr_layer, type: m.dr_element_type };
  }
  return {
    rules,
    edgeMappings: edgeMappings.filter((m) => m.usage === "verification_and_mapping"),
    labelDecisions,
    labelDefaults,
  };
}

export interface ExtractOptions {
  /** Absolute path of the indexed codebase, so source is read from disk. */
  sourceRoot?: string;
  /** Only symbols in these files (paths relative to the codebase root); every file when absent. */
  files?: ReadonlySet<string>;
  /** CBM labels to extract (default: the card labels plus every label a rule names). */
  labels?: string[];
  /**
   * Files whose symbols the caller wants listed (in {@link ExtractionGraph.fileSymbols}), to check
   * that the symbols existing elements name are still there.
   */
  checkFiles?: string[];
  /** Give up past this time (epoch ms), with an {@link ExtractionTimeoutError}. */
  deadline?: number;
  onProgress?: (done: number, total: number) => void;
}

/** The extraction ran past its deadline. */
export class ExtractionTimeoutError extends Error {
  constructor(readonly stage: string) {
    super(`Extraction ran out of time while ${stage}`);
    this.name = "ExtractionTimeoutError";
  }
}

export interface ExtractedSymbol {
  /** Full qualified name (with the CBM project prefix; none for routes). */
  qualifiedName: string;
  card: SymbolCard;
  facts: CardFacts;
  /** The Tier-0 outcome, or a node-mapping decision (`rule: "node-mapping:<label>"`), or null. */
  tier0: Tier0Outcome | null;
  /** For a route: its path with the parameters named where the code names them (`/owners/{ownerId}`). */
  routePath?: string;
  /**
   * For a route: nothing in the code handles it (no file of its own, no HANDLES edge). It is a URL
   * client or test code calls, not one this code serves, so it is never decided.
   */
  unhandled?: true;
  /** Doc sections that mention the symbol or name its file: description evidence (cards/docs.ts). */
  docs?: DocEvidence[];
}

export interface EdgeEnd {
  qualifiedName: string;
  name: string;
  file: string | null;
}

export interface ExtractedEdge {
  type: string;
  from: EdgeEnd;
  to: EdgeEnd;
}

export interface ExtractionGraph {
  analyzer: string;
  project: string;
  config: ExtractionConfig;
  symbols: ExtractedSymbol[];
  /** Mapped CBM edges with at least one end in scope. */
  edges: ExtractedEdge[];
  /**
   * For each requested file the graph has nodes in: every spelling of their symbols (name,
   * `Parent.name`, qualified name without the project). A file the graph has no nodes in is absent.
   */
  fileSymbols: Record<string, string[]>;
  /** Every route the graph has, as `METHOD /path` and as `__route__METHOD__/path`. */
  routes: string[];
  /** The project's architecture decision records (CBM `ADR` nodes), whatever the file scope. */
  decisions?: DecisionRecord[];
  /** Why the documentation evidence (decision records, doc sections) couldn't be read, when it couldn't. */
  docsError?: string;
  summary: { cards: number; decided: number; rejected: number; narrowed: number; undecided: number; no_source: number };
  /**
   * JavaScript and TypeScript test files whose suites and cases were read from their text
   * (cards/test-cases.ts): a test-case symbol a file in this list doesn't have is gone.
   */
  testFiles?: string[];
  /** What reading the JS/TS test files found, when there were any. */
  testCases?: TestCaseStats;
}

/** `__route__GET__/owners/{}` -> { method: "GET", path: "/owners/{}" }, or null for anything else. */
export function parseRouteName(name: string): { method: string; path: string } | null {
  const m = /^__route__([A-Z]+)__(\/.*)$/.exec(name);
  return m ? { method: m[1], path: m[2] } : null;
}

/** A qualified name without the project prefix. */
export function shortQualifiedName(qn: string, project: string): string {
  return qn.startsWith(project + ".") ? qn.slice(project.length + 1) : qn;
}

/**
 * The ways an element's source reference may name a symbol: its name, `Parent.name` and its
 * qualified name without the project; for a route, `METHOD /path` and CBM's route name.
 */
export function symbolSpellings(qualifiedName: string, name: string, project: string): string[] {
  const route = parseRouteName(name) ?? parseRouteName(qualifiedName);
  if (route) return [`${route.method} ${route.path}`, `__route__${route.method}__${route.path}`];
  const short = shortQualifiedName(qualifiedName, project);
  const parts = short.split(".");
  const out = new Set<string>([name]);
  if (parts.length >= 2 && parts[parts.length - 1] === name) out.add(`${parts[parts.length - 2]}.${name}`);
  out.add(short);
  return [...out].filter(Boolean);
}

function cypherString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Read a project for extraction. Cards and Tier 0 are those of `dr analyzer classify
 * --tier0-only`; a label the node mapping decides outright (Route) is decided when no rule matches.
 */
export async function collectExtraction(
  graph: CardGraph,
  config: ExtractionConfig,
  analyzer: string,
  options: ExtractOptions = {}
): Promise<ExtractionGraph> {
  const checkDeadline = (stage: string) => {
    if (options.deadline !== undefined && Date.now() > options.deadline) throw new ExtractionTimeoutError(stage);
  };
  const labels = options.labels?.length
    ? options.labels
    : [...new Set([...defaultLabels(config.rules), ...Object.keys(config.labelDecisions)])];

  // Candidates for cards, and every route.
  const routes = new Set<string>();
  const routeNodes: GraphNode[] = [];
  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    for (const node of await graph.search(label, undefined, CARD_FIELDS[label] ?? [])) {
      if (label === "Route") {
        for (const s of symbolSpellings(node.qualified_name, node.name, graph.project)) routes.add(s);
        routeNodes.push(node);
      }
      if (!isCandidate(node, label, VENDOR_EXCLUDE) || seen.has(node.qualified_name)) continue;
      // A Java or C# constructor is named after its class: like `constructor`, not an element.
      if (label === "Method" && node.qualified_name.split(".").slice(-2, -1)[0] === node.name) continue;
      // A route often has no file of its own (it takes its handler's); keep it until its card says.
      if (options.files && node.file_path && !options.files.has(node.file_path)) continue;
      seen.add(node.qualified_name);
      nodes.push(node);
    }
  }

  const edgeIndex = await buildEdgeIndex(graph);
  const factsIndex = await buildFactsIndex(graph);
  // Documentation evidence is optional: an analyzer that can't answer these queries leaves it out
  // and says why, rather than failing the extraction.
  let docIndex: DocIndex | null = null;
  let decisions: DecisionRecord[] = [];
  let docsError: string | undefined;
  try {
    // One MENTIONS query for both.
    const mentions = await readMentions(graph);
    docIndex = await buildDocIndex(graph, mentions);
    decisions = await collectDecisionRecords(graph, mentions);
  } catch (error) {
    if (!(error instanceof CbmToolError)) throw error;
    docIndex = null;
    decisions = [];
    docsError = error.message;
  }
  checkDeadline("reading the graph");
  // With a file scope, a route with no file of its own is built (its handler resolved, its source
  // read) only when its handler, or something that reaches it, is in a scoped file.
  if (options.files) {
    const files = options.files;
    const inFiles = (qns: string[] | undefined) => (qns ?? []).some((qn) => files.has(edgeIndex.qnFile.get(qn) ?? ""));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.label === "Route" && !n.file_path && !inFiles(edgeIndex.routeHandlers.get(n.qualified_name)) && !inFiles(edgeIndex.routeCallers.get(n.qualified_name))) {
        nodes.splice(i, 1);
      }
    }
  }
  const builder = new CardBuilder(graph, edgeIndex, { scope: graph.project, sourceRoot: options.sourceRoot });

  // A route is served here when it has a file of its own or a HANDLES edge.
  const handled = (n: GraphNode) => !!n.file_path || (edgeIndex.routeHandlers.get(n.qualified_name) ?? []).length > 0;
  const served = routeNodes
    .filter(handled)
    .map((n) => ({ name: n.qualified_name, ...parseRouteName(n.qualified_name)! }))
    .filter((r) => r.method);
  // CBM's stored route names keep the code's parameter names (`/owners/{ownerId}`); search_graph
  // returns them as `{}`, a query returns them as stored.
  const routeNames = new Map<string, string>();
  if (routeNodes.length) {
    for (const [qn, name] of await graph.rows("MATCH (r:Route) RETURN r.qualified_name, r.name")) {
      if (typeof qn === "string" && typeof name === "string") routeNames.set(qn, name);
    }
  }

  const symbols: ExtractedSymbol[] = [];
  const summary = { cards: 0, decided: 0, rejected: 0, narrowed: 0, undecided: 0, no_source: 0 };
  let done = 0;
  for (const node of nodes) {
    if (done % 50 === 0) checkDeadline("building cards");
    const card = await builder.build(node);
    options.onProgress?.(++done, nodes.length);
    if (options.files && !(card.file_path && options.files.has(card.file_path))) continue;
    const facts = factsFor(factsIndex, node.qualified_name, card.file_path);
    const route = card.label === "Route" ? parseRouteName(card.name) : null;
    // A route with no file of its own and no HANDLES edge: a URL that test or client code calls,
    // whoever the callers are.
    const unhandled = !!route && !handled(node);
    let tier0 = unhandled ? null : tier0ForCard(card, facts, config.rules);
    const byLabel = config.labelDecisions[card.label];
    if (!tier0 && byLabel && !unhandled) {
      tier0 = { kind: "decide", layer: byLabel.layer, type: byLabel.type, rule: `node-mapping:${card.label}`, confidence: "high" };
    }
    const docs = docIndex ? docsFor(docIndex, node.qualified_name, card.file_path, card.label) : [];
    summary.cards++;
    if (card.source === null && card.label !== "Route") summary.no_source++;
    if (!tier0) summary.undecided++;
    else if (tier0.kind === "decide") summary.decided++;
    else if (tier0.kind === "reject") summary.rejected++;
    else summary.narrowed++;
    symbols.push({
      qualifiedName: node.qualified_name,
      card,
      facts,
      tier0,
      ...(route ? { routePath: namedRoutePath(route.path, routeNames.get(node.qualified_name), card.source) } : {}),
      ...(unhandled ? { unhandled: true as const } : {}),
      ...(docs.length ? { docs } : {}),
    });
  }

  // Mapped edges with an end in scope (all of them when the whole project is in scope).
  const inScope = new Set(symbols.map((s) => s.qualifiedName));
  const scopeFiles = new Set(symbols.map((s) => s.card.file_path).filter((f): f is string => !!f));
  const edges: ExtractedEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const type of [...new Set(config.edgeMappings.map((m) => m.cbm_edge))]) {
    checkDeadline("reading edges");
    const rows = await graph.rows(
      `MATCH (a)-[r:${type}]->(b) RETURN a.qualified_name, a.file_path, a.name, b.qualified_name, b.file_path, b.name`
    );
    const fileJoined = FILE_JOINED_EDGES.has(type);
    for (const [aq, af, an, bq, bf, bn] of rows) {
      if (typeof aq !== "string" || typeof bq !== "string" || aq === bq) continue;
      const from = { qualifiedName: aq, name: str(an) ?? aq, file: str(af) };
      const to = { qualifiedName: bq, name: str(bn) ?? bq, file: str(bf) };
      const touches =
        !options.files ||
        inScope.has(aq) ||
        inScope.has(bq) ||
        (fileJoined && ((from.file !== null && scopeFiles.has(from.file)) || (to.file !== null && scopeFiles.has(to.file))));
      if (!touches) continue;
      const key = `${type}|${aq}|${bq}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({ type, from, to });
    }
  }

  // JavaScript and TypeScript test cases: anonymous it() / test() callbacks have no node, so they
  // are read from the test files' text, with the calls each one makes (cards/test-cases.ts).
  const mappedEdges = new Set(config.edgeMappings.map((m) => m.cbm_edge));
  let testCases: Awaited<ReturnType<typeof collectJsTestCases>> | null = null;
  if (options.sourceRoot && (!options.labels?.length || options.labels.includes(TEST_CASE_LABEL))) {
    checkDeadline("reading test files");
    testCases = await collectJsTestCases(graph, (qn) => cardId(graph.project, qn), {
      sourceRoot: options.sourceRoot,
      files: options.files,
      edgeTypes: mappedEdges,
    });
    for (const s of testCases.symbols) {
      symbols.push(s);
      summary.cards++;
      if (s.tier0?.kind === "decide") summary.decided++;
      else summary.rejected++;
    }
    for (const e of testCases.edges) {
      const key = `${e.type}|${e.from.qualifiedName}|${e.to.qualifiedName}`;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push(e);
    }
  }

  // A test that calls a served route by its URL (MockMvc, RestTemplate, supertest) makes the HTTP
  // call CBM has no edge for: one HTTP_CALLS edge from the test to the route.
  if (config.edgeMappings.some((m) => m.cbm_edge === "HTTP_CALLS")) {
    for (const s of symbols) {
      const testing = s.tier0?.kind === "decide" && s.tier0.layer === "testing";
      if (!testing && !(s.card.file_path && TEST_PATH.test(s.card.file_path))) continue;
      for (const name of routesCalledIn(s.card.source, served)) {
        const key = `HTTP_CALLS|${s.qualifiedName}|${name}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        edges.push({
          type: "HTTP_CALLS",
          from: { qualifiedName: s.qualifiedName, name: s.card.name, file: s.card.file_path },
          to: { qualifiedName: name, name, file: null },
        });
      }
    }
  }

  // The symbols in each file the caller asked about, of every label (a React component declared
  // as `const X = () => ...` is a Variable), a batch of files per query.
  const fileSymbols: Record<string, string[]> = {};
  const checkFiles = [...new Set(options.checkFiles ?? [])];
  for (let i = 0; i < checkFiles.length; i += CHECK_FILES_PER_QUERY) {
    const batch = checkFiles.slice(i, i + CHECK_FILES_PER_QUERY);
    const rows = await graph.rows(
      `MATCH (n) WHERE n.file_path IN [${batch.map(cypherString).join(", ")}] RETURN n.file_path, n.qualified_name, n.name, n.label`
    );
    for (const [file, qn, name, label] of rows) {
      // A file the graph holds only as a File node (a document, a config) has no symbols to check.
      if (typeof file !== "string" || typeof qn !== "string" || label === "File" || label === "Folder") continue;
      const found = (fileSymbols[file] ??= []);
      for (const sp of symbolSpellings(qn, str(name) ?? qn, graph.project)) if (!found.includes(sp)) found.push(sp);
    }
  }
  // A test file's suites and cases are its symbols too.
  for (const file of checkFiles) {
    for (const name of testCases?.fileSymbols[file] ?? []) {
      const found = (fileSymbols[file] ??= []);
      if (!found.includes(name)) found.push(name);
    }
  }

  return {
    analyzer,
    project: graph.project,
    config,
    symbols,
    edges,
    fileSymbols,
    routes: [...routes],
    ...(decisions.length ? { decisions } : {}),
    ...(docsError ? { docsError } : {}),
    summary,
    ...(testCases ? { testFiles: testCases.filesRead } : {}),
    ...(testCases?.stats.files ? { testCases: testCases.stats } : {}),
  };
}
