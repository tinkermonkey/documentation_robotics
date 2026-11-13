/**
 * Test-case cards for JavaScript and TypeScript test files, and the `tests` evidence for them.
 *
 * CBM gives a JS/TS test file as a Module (`is_test: "true"`) whose CALLS and HTTP_CALLS edges
 * carry every call the file makes, one edge per caller and callee with the line of the first call;
 * the `it()` / `test()` callbacks that make the calls have no node (docs/analyzers/
 * CBM_MAPPING_INVENTORY.md). This module reads each test file's text (cards/js-tests.ts) and:
 *
 * - makes one card per call: an `it` / `test` is a `TestCase` card, decided as a
 *   `testing.testcasesketch`; a `describe` is a `TestSuite` card, rejected (its title prefixes the
 *   names of the cases in it: `ModelLoader > loads every layer`);
 * - attributes the file's calls to the cases that make them: a case makes a call when its callback
 *   calls the callee's name (an HTTP call: when its text quotes the whole URL path of the route,
 *   with the same method when the code says it), and when CBM's line for the call is inside the
 *   case. CBM keeps one edge per caller and callee with its first line, so the name is what finds
 *   the other cases making the same call. A call to a helper defined in the test file counts as
 *   the helper's own calls. A call with a line that no case makes (a hook, a suite body, the
 *   module's top level) is left out; a plain call with no line that no case names is attributed
 *   to every case in the file (file level), an HTTP call only when the file has one case. Each way
 *   is counted in the stats;
 * - keeps a call only into production code: a source file that is not a test file or test support
 *   (`testing/`, mocks, fixtures), and that the test file imports (or that CBM resolved through the
 *   file's imports), so a call CBM bound by a bare name to some unrelated function is dropped; as
 *   is one CBM bound to a symbol of another name. A qualified callee (`Model.load`) is matched only
 *   by a case calling it on that receiver.
 *
 * The edges come out as CALLS and HTTP_CALLS from the case, which the edge mapping turns into
 * `testing.testcasesketch tests ...` relationships (extraction-plan.ts), where the rule that a
 * member call counts only when the test file uses or imports the class still applies.
 *
 * Card labels `TestCase` and `TestSuite` are DR's, not CBM's: CBM has no node for either.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Tier0Outcome } from "../tier0-rules.js";
import { SOURCE_EXT, VENDOR_EXCLUDE } from "./build.js";
import type { ExtractedEdge, ExtractedSymbol } from "./extract.js";
import { JS_SOURCE, loadTypeScript, parseJsTestCalls, type JsTestCall } from "./js-tests.js";
import { TEST_PATH, normRoutePath, urlMatchesRoute } from "./routes.js";
import type { CardFacts, CardGraph, SymbolCard } from "./types.js";

/** Card labels for test calls read from a file's text. */
export const TEST_CASE_LABEL = "TestCase";
export const TEST_SUITE_LABEL = "TestSuite";

/** Rule names on the outcomes of test calls (in the place of a Tier-0 rule's name). */
export const TEST_CASE_RULE = "js_test_case_call";
export const TEST_SUITE_RULE = "js_test_suite_call";

/** Separator between suite and case titles in a test call's name and source symbol. */
export const TITLE_SEPARATOR = " > ";

/** Test files per graph query. */
const FILES_PER_QUERY = 200;
/** Source lines kept on a test card. */
const SOURCE_LINES = 120;
/** How deep calls through helpers in the test file are followed. */
const HELPER_DEPTH = 4;

export interface TestCaseStats {
  /** JS/TS test files read. */
  files: number;
  /** Files with at least one suite or case. */
  filesWithTests: number;
  cases: number;
  suites: number;
  /** Cases with at least one call into production code attributed to them. */
  casesWithCalls: number;
  /** Production calls (caller, callee) from test files, before attribution. */
  calls: number;
  /** Of those, attributed to at least one case by the name it calls. */
  byName: number;
  /** Attributed by CBM's line only (the case's callback never names the callee). */
  byLine: number;
  /**
   * Calls with no line that no case names, attributed to every case in their file (file level);
   * an HTTP call only in a file with one case (else it is counted in {@link outsideCases}).
   */
  byFile: number;
  /** Made by no case: hooks, suite bodies, the module's top level. No link. */
  outsideCases: number;
  /** Dropped: the callee's file is not one the test file imports, and CBM didn't resolve it through an import. */
  notImported: number;
  /** Dropped: CBM bound the call to a symbol of another name (`path.join` to a function `path`). */
  misbound: number;
  /** Edges from cases to production symbols and routes (CALLS and HTTP_CALLS). */
  edges: number;
}

export interface TestCaseExtraction {
  symbols: ExtractedSymbol[];
  edges: ExtractedEdge[];
  /** The test files read: every suite and case in them is in {@link fileSymbols}. */
  filesRead: string[];
  /** For each file with tests: the source symbols of its suites and cases. */
  fileSymbols: Record<string, string[]>;
  stats: TestCaseStats;
}

export interface TestCaseOptions {
  /** Absolute path of the indexed codebase: test files are read from it. */
  sourceRoot: string;
  /** Only test files in this set (paths relative to the root). */
  files?: ReadonlySet<string>;
  /** Edge types to produce (those the edge mapping maps). */
  edgeTypes: ReadonlySet<string>;
}

interface CallRow {
  type: "CALLS" | "HTTP_CALLS";
  callerQn: string;
  callerLabel: string;
  callerFile: string;
  calleeQn: string;
  calleeLabel: string;
  calleeName: string;
  calleeFile: string;
  /** The name the code calls (`load`, `Model.init`); for HTTP, the URL path. */
  callee: string | null;
  line: number | null;
  strategy: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cypherString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Whether a module's file is a JS/TS test file: CBM's `is_test`, or DR's test-path pattern. */
export function isJsTestFile(file: string, isTest: unknown): boolean {
  if (!JS_SOURCE.test(file) || VENDOR_EXCLUDE.test(file)) return false;
  return isTest === true || isTest === "true" || TEST_PATH.test(file);
}

const NO_FACTS: CardFacts = Object.freeze({ decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 }) as CardFacts;

function emptyCard(): Omit<SymbolCard, "id" | "label" | "name" | "qualified_name" | "file_path" | "start_line" | "end_line" | "source" | "source_lines_total" | "source_truncated"> {
  return {
    signature: null,
    docstring: null,
    is_exported: null,
    is_entry_point: null,
    complexity: null,
    parent_class: null,
    base_classes: [],
    return_type: null,
    callers: [],
    callees: [],
    callers_total: 0,
    callees_total: 0,
    imports: [],
    env_vars: [],
    routes_handled: [],
    http_calls: [],
    inherits: [],
    implements: [],
    route_method: null,
  };
}

/**
 * A URL literal in code: a quoted or template string that is a path, after an optional
 * `scheme://host` or (in a template) a `${base}` substitution, ending at its closing quote.
 */
const URL_LITERAL = /(["'`])((?:[a-z][a-z\d+.-]*:\/\/[^/"'`\s]*|\$\{[^}]*\})?\/[^"'`\s]*)\1/gi;
const URL_PREFIX = /^(?:[a-z][a-z\d+.-]*:\/\/[^/]*|\$\{[^}]*\})/i;
const VERB_BEFORE = /(?:^|[^\w$])(get|post|put|patch|delete|head|options)\s*\(\s*$/i;
const FETCH_BEFORE = /(?:^|[^\w$])fetch\s*\(\s*$/;
const FETCH_METHOD = /\bmethod\s*:\s*["'`](\w+)["'`]/;

/**
 * The method a `fetch(url, ...)` call names, from what follows the URL literal: GET when the call
 * ends there (`fetch(url)`), the `method` of an options object literal (nested objects such as
 * `headers` included), and null when the options are not a literal the code spells out
 * (`fetch(url, init)`) or name no method there: unknown, not compared.
 */
function fetchMethod(after: string): string | null {
  const rest = after.replace(/^\s+/, "");
  if (rest.startsWith(")")) return "GET";
  const options = /^,\s*\{/.exec(rest);
  if (!options) return null;
  // The options object, to its matching brace (strings skipped), so a later call's method isn't read.
  let depth = 0;
  let quote: string | null = null;
  for (let i = options[0].length - 1; i < rest.length; i++) {
    const c = rest[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const found = FETCH_METHOD.exec(rest.slice(options[0].length, i));
      return found ? found[1].toUpperCase() : null;
    }
  }
  return null;
}

/** The HTTP method of the call a URL literal is the first argument of, when the code says it. */
function methodAt(source: string, start: number, end: number): string | null {
  const before = source.slice(Math.max(0, start - 60), start);
  const verb = VERB_BEFORE.exec(before);
  if (verb) return verb[1].toUpperCase();
  if (FETCH_BEFORE.test(before)) return fetchMethod(source.slice(end, end + 400));
  return null;
}

/**
 * Whether a test's source quotes a URL that reaches a route's path (CBM's `{}` parameter, or
 * the route's own `{name}`, standing for any one segment): the whole path of a string literal,
 * not a prefix of a longer one (`/api/models` doesn't reach `/api/models/{}/elements`). A
 * template's `${id}` fills a parameter segment. When both the route's method and the method of
 * the call the URL is passed to (`.post(...)`, `fetch(url, {method})`) are known, they must agree.
 * The root route `/` matches only a call whose method is known.
 */
export function quotesUrl(source: string, routePath: string, method: string | null = null): boolean {
  for (const m of source.matchAll(URL_LITERAL)) {
    const url = m[2].replace(URL_PREFIX, "");
    if (!urlMatchesRoute(url, routePath)) continue;
    const called = methodAt(source, m.index!, m.index! + m[0].length);
    if (method && called && called !== method) continue;
    // A bare "/" is in plenty of code that isn't a request (`path.split("/")`): the root route
    // needs a call whose method the code says.
    if (normRoutePath(routePath) === "/" && called === null) continue;
    return true;
  }
  return false;
}

/** A route callee's method and path, from CBM's `__route__METHOD__/path` name. */
function routeOf(r: CallRow): { method: string; path: string } | null {
  const m = /^__route__([A-Z]+)__(\/.*)$/.exec(r.calleeName) ?? /__route__([A-Z]+)__(\/.*)$/.exec(r.calleeQn);
  return m ? { method: m[1], path: m[2] } : null;
}

/** The last part of a callee as written: `Model.init` -> `init`. */
function calledName(callee: string): string {
  return callee.slice(callee.lastIndexOf(".") + 1);
}

/**
 * How a case's call names (cards/js-tests.ts) spell a callee: `Model.init` for CBM's `Model.init`
 * or `a.Model.init`, `load` for `load`. A qualified callee needs the case to call it on that
 * receiver, so a case calling `FarmManifest.load()` doesn't make CBM's `Model.load`.
 */
function callKey(callee: string): string {
  const parts = callee.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : callee;
}

/**
 * Test support outside test files: `testing/` and `test-utils/` folders, `testing.ts` and
 * `foo.testing.ts`, mocks and fixtures. Calls into them are not tests of production code.
 */
const TEST_SUPPORT = /(^|[/.])(testing|test-?utils?|test-?helpers?|__mocks__|mocks?|__fixtures__|fixtures?)(\/|\.[cm]?[jt]sx?$)/;

/**
 * Read every JS/TS test file in scope: a card per suite and case, and the CALLS and HTTP_CALLS
 * edges from each case into production code.
 */
export async function collectJsTestCases(
  graph: CardGraph,
  cardId: (qualifiedName: string) => string,
  options: TestCaseOptions
): Promise<TestCaseExtraction> {
  const stats: TestCaseStats = {
    files: 0,
    filesWithTests: 0,
    cases: 0,
    suites: 0,
    casesWithCalls: 0,
    calls: 0,
    byName: 0,
    byLine: 0,
    byFile: 0,
    outsideCases: 0,
    notImported: 0,
    misbound: 0,
    edges: 0,
  };
  const result: TestCaseExtraction = { symbols: [], edges: [], filesRead: [], fileSymbols: {}, stats };
  const root = path.resolve(options.sourceRoot);

  // Test modules, and every test file (a call into one is never production code).
  const moduleOf = new Map<string, string>();
  const testFiles = new Set<string>();
  for (const [file, qn, isTest] of await graph.rows("MATCH (m:Module) RETURN m.file_path, m.qualified_name, m.is_test")) {
    if (typeof file !== "string" || typeof qn !== "string" || !file) continue;
    if (isTest === true || isTest === "true" || TEST_PATH.test(file)) testFiles.add(file);
    if (!isJsTestFile(file, isTest) || (options.files && !options.files.has(file))) continue;
    moduleOf.set(file, qn);
  }
  if (!moduleOf.size) return result;

  const ts = await loadTypeScript();
  const parsed = new Map<string, { calls: JsTestCall[]; lines: string[] }>();
  for (const file of [...moduleOf.keys()].sort()) {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(root + path.sep)) continue;
    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    stats.files++;
    result.filesRead.push(file);
    const calls = parseJsTestCalls(ts, file, text);
    if (!calls.length) continue;
    stats.filesWithTests++;
    parsed.set(file, { calls, lines: text.split("\n") });
  }
  if (!parsed.size) return result;

  // The files' calls, HTTP calls and imports, a batch of files per query.
  const files = [...parsed.keys()];
  const rows: CallRow[] = [];
  const imports = new Map<string, Set<string>>();
  for (let i = 0; i < files.length; i += FILES_PER_QUERY) {
    const list = `[${files.slice(i, i + FILES_PER_QUERY).map(cypherString).join(", ")}]`;
    if (options.edgeTypes.has("CALLS")) {
      for (const r of await graph.rows(
        `MATCH (a)-[r:CALLS]->(b) WHERE a.file_path IN ${list} RETURN a.qualified_name, a.label, a.file_path, b.qualified_name, b.label, b.name, b.file_path, r.callee, r.line, r.strategy`
      )) {
        const [aq, al, af, bq, bl, bn, bf, callee, line, strategy] = r;
        if (typeof aq !== "string" || typeof bq !== "string" || typeof af !== "string") continue;
        rows.push({ type: "CALLS", callerQn: aq, callerLabel: str(al) ?? "", callerFile: af, calleeQn: bq, calleeLabel: str(bl) ?? "", calleeName: str(bn) ?? bq, calleeFile: str(bf) ?? "", callee: str(callee), line: num(line), strategy: str(strategy) });
      }
    }
    if (options.edgeTypes.has("HTTP_CALLS")) {
      for (const r of await graph.rows(
        `MATCH (a)-[r:HTTP_CALLS]->(b) WHERE a.file_path IN ${list} RETURN a.qualified_name, a.label, a.file_path, b.qualified_name, b.label, b.name, b.file_path, r.url_path, r.line`
      )) {
        const [aq, al, af, bq, bl, bn, bf, url, line] = r;
        if (typeof aq !== "string" || typeof bq !== "string" || typeof af !== "string") continue;
        rows.push({ type: "HTTP_CALLS", callerQn: aq, callerLabel: str(al) ?? "", callerFile: af, calleeQn: bq, calleeLabel: str(bl) ?? "", calleeName: str(bn) ?? bq, calleeFile: str(bf) ?? "", callee: str(url), line: num(line), strategy: null });
      }
    }
    for (const [af, bf] of await graph.rows(`MATCH (a)-[r:IMPORTS]->(b) WHERE a.file_path IN ${list} RETURN a.file_path, b.file_path`)) {
      if (typeof af !== "string" || typeof bf !== "string" || !bf) continue;
      (imports.get(af) ?? imports.set(af, new Set()).get(af)!).add(bf);
    }
  }
  const rowsByCaller = new Map<string, CallRow[]>();
  for (const r of rows) (rowsByCaller.get(r.callerQn) ?? rowsByCaller.set(r.callerQn, []).get(r.callerQn)!).push(r);

  const isRoute = (r: CallRow) => r.calleeLabel === "Route" || /^__route__[A-Z]+__\//.test(r.calleeName) || /^__route__[A-Z]+__\//.test(r.calleeQn);
  const production = (r: CallRow) =>
    r.type === "HTTP_CALLS"
      ? isRoute(r)
      : !!r.calleeFile &&
        SOURCE_EXT.test(r.calleeFile) &&
        !VENDOR_EXCLUDE.test(r.calleeFile) &&
        !testFiles.has(r.calleeFile) &&
        !TEST_PATH.test(r.calleeFile) &&
        !TEST_SUPPORT.test(r.calleeFile);
  // CBM bound the call to a symbol of another name (`path.join` to a function `path`).
  const misbound = (r: CallRow) => r.type === "CALLS" && !!r.callee && calledName(r.callee) !== r.calleeName && r.calleeName !== "constructor";

  for (const [file, { calls, lines }] of parsed) {
    const moduleQn = moduleOf.get(file)!;
    const imported = imports.get(file) ?? new Set<string>();
    const resolvedByImport = (r: CallRow) => !!r.strategy && r.strategy.startsWith("import_map");
    // A call CBM bound by a bare name into a file this test file doesn't import is not one it makes.
    const unimported = (r: CallRow) => r.type === "CALLS" && !imported.has(r.calleeFile) && !resolvedByImport(r);
    const fileRows = rows.filter((r) => r.callerFile === file);
    const moduleRows = fileRows.filter((r) => r.callerQn === moduleQn || r.callerLabel === "Module");

    /** A call's production calls: itself, or (a helper in this file) the helper's own calls. */
    const expand = (r: CallRow, depth: number, seen: Set<string>, out: CallRow[]): void => {
      if (r.type === "CALLS" && r.calleeFile === file) {
        if (depth >= HELPER_DEPTH || seen.has(r.calleeQn)) return;
        seen.add(r.calleeQn);
        for (const h of rowsByCaller.get(r.calleeQn) ?? []) expand(h, depth + 1, seen, out);
        return;
      }
      if (production(r)) out.push(r);
    };

    // Production calls of the file, for the counts: every (caller, callee) a case could make.
    const fileProduction = new Map<string, CallRow>();
    for (const r of moduleRows) {
      const out: CallRow[] = [];
      expand(r, 0, new Set(), out);
      for (const p of out) fileProduction.set(`${p.type}|${p.calleeQn}`, p);
    }
    stats.calls += fileProduction.size;

    // Names: the title path, made unique within the file.
    const seenNames = new Map<string, number>();
    const cases: Array<{ call: JsTestCall; symbol: ExtractedSymbol }> = [];
    for (const call of calls) {
      const base = [...call.suites, call.title].join(TITLE_SEPARATOR);
      const n = (seenNames.get(base) ?? 0) + 1;
      seenNames.set(base, n);
      const name = n > 1 ? `${base} #${n}` : base;
      const qualifiedName = `${moduleQn}::${name}`;
      const all = lines.slice(call.startLine - 1, call.endLine);
      const source = all.slice(0, SOURCE_LINES).join("\n");
      const tier0: Tier0Outcome =
        call.kind === "case"
          ? { kind: "decide", layer: "testing", type: "testcasesketch", rule: TEST_CASE_RULE, confidence: "high" }
          : { kind: "reject", rule: TEST_SUITE_RULE, confidence: "high" };
      const card: SymbolCard = {
        id: cardId(qualifiedName),
        label: call.kind === "case" ? TEST_CASE_LABEL : TEST_SUITE_LABEL,
        name,
        qualified_name: `${moduleQn.slice(graph.project.length + 1)}::${name}`,
        file_path: file,
        start_line: call.startLine,
        end_line: call.endLine,
        ...emptyCard(),
        signature: call.callee,
        source,
        source_lines_total: all.length,
        source_truncated: all.length > SOURCE_LINES,
      };
      const symbol: ExtractedSymbol = { qualifiedName, card, facts: NO_FACTS, tier0 };
      result.symbols.push(symbol);
      (result.fileSymbols[file] ??= []).push(name);
      if (call.kind === "case") {
        stats.cases++;
        cases.push({ call, symbol });
      } else stats.suites++;
    }

    // Attribute each of the module's calls: to the cases whose callback calls the callee's name
    // (an HTTP call: whose text quotes its URL), and to the case CBM's line is in. A plain call
    // with no line that no case names goes to every case in the file; an HTTP call with no line
    // and no quoted URL only when the file has one case. A call with a line in no case is a
    // hook's, a suite body's or the module's own.
    const how = new Map<string, "byName" | "byLine" | "byFile">();
    const RANK = { byFile: 0, byLine: 1, byName: 2 } as const;
    const targetsOf = new Map<ExtractedSymbol, Map<string, CallRow>>(cases.map((c) => [c.symbol, new Map()]));
    for (const r of moduleRows) {
      let way: "byName" | "byLine" | "byFile" = "byName";
      const route = r.type === "HTTP_CALLS" ? routeOf(r) : null;
      const urlPath = route?.path ?? r.callee;
      const byName = cases.filter(({ call, symbol }) =>
        r.type === "CALLS"
          ? !!r.callee && call.calls.includes(callKey(r.callee))
          : !!urlPath && quotesUrl(symbol.card.source ?? "", urlPath, route?.method ?? null)
      );
      const byLine = cases.filter(({ call }) => r.line !== null && r.line >= call.startLine && r.line <= call.endLine);
      let hits = [...new Set([...byName, ...byLine])];
      if (!byName.length) way = "byLine";
      if (!hits.length && r.line === null && (r.type === "CALLS" || cases.length === 1)) {
        way = "byFile";
        hits = cases;
      }
      if (!hits.length) continue;
      const out: CallRow[] = [];
      expand(r, 0, new Set(), out);
      for (const p of out) {
        if (unimported(p) || misbound(p)) continue;
        const key = `${p.type}|${p.calleeQn}`;
        const before = how.get(key);
        if (!before || RANK[way] > RANK[before]) how.set(key, way);
        for (const h of hits) targetsOf.get(h.symbol)!.set(key, p);
      }
    }
    const short = (qn: string) => (qn.startsWith(graph.project + ".") ? qn.slice(graph.project.length + 1) : qn);
    for (const [symbol, targets] of targetsOf) {
      for (const p of targets.values()) {
        result.edges.push({
          type: p.type,
          from: { qualifiedName: symbol.qualifiedName, name: symbol.card.name, file },
          to: { qualifiedName: p.calleeQn, name: p.calleeName, file: p.calleeFile || null },
        });
      }
      if (targets.size) stats.casesWithCalls++;
      symbol.card.callees = [...targets.values()].map((p) => short(p.calleeQn)).slice(0, 12);
      symbol.card.callees_total = targets.size;
    }

    for (const [key, p] of fileProduction) {
      const way = how.get(key);
      if (way) stats[way]++;
      else if (unimported(p)) stats.notImported++;
      else if (misbound(p)) stats.misbound++;
      else stats.outsideCases++;
    }
  }
  stats.edges = result.edges.length;
  return result;
}
