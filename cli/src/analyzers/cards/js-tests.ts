/**
 * JavaScript and TypeScript test cases from a test file's text.
 *
 * A Jest, Vitest, Bun, Mocha or Playwright test case is an anonymous callback passed to `it()` or
 * `test()`, so codebase-memory-mcp (CBM) has no node for it: its calls are recorded on the test
 * file's Module. This reads the file with the TypeScript compiler's parser (which also reads
 * JavaScript and JSX) and returns every `describe` / `it` / `test` call: its title, the suites it
 * is nested in, its lines, and the names its callback calls, so extraction can make one card per
 * call and attribute the Module's calls to the test case that makes them (cards/test-cases.ts).
 *
 * Recognised:
 * - suites: `describe`, `context`, `suite`, `fdescribe`, `xdescribe`, Playwright's `test.describe`;
 * - cases: `it`, `test`, `specify`, `fit`, `xit`, `xtest`;
 * - modifiers chained on either: `.skip`, `.only`, `.each`, `.concurrent`, `.sequential`,
 *   `.failing`, `.fails`, `.skipIf(c)`, `.runIf(c)`, `.if(c)`, `.serial`, `.parallel`, `.fixme`,
 *   `.slow`, with `.each(table)(...)` and `.each\`table\`(...)` forms;
 * - titles: string literals, template literals (a substitution is kept as written: `loads ${name}`)
 *   and any other expression as written (`describe(Model.name, ...)`).
 *
 * A call counts only with a callback (a function, or a reference to one) after its title: `it.todo`
 * and a helper that happens to be called `test` don't. Hooks (`beforeEach`, `afterAll`) are not
 * test cases; the names they call are not any case's.
 */
import type * as TS from "typescript";

export type JsTestKind = "suite" | "case";

export interface JsTestCall {
  kind: JsTestKind;
  /** The callee as written, without its arguments: `it`, `test.skip`, `describe.each`. */
  callee: string;
  /** The title as written, whitespace collapsed. */
  title: string;
  /** The titles of the suites it is nested in, outermost first. */
  suites: string[];
  /** 1-based lines of the whole call. */
  startLine: number;
  endLine: number;
  /**
   * What the callback calls (`writeFile`, `loader.load`), constructs (`Model` for `new Model()`) or
   * renders (`Panel` for `<Panel />`), spelled as CBM spells a callee.
   */
  calls: string[];
  /** `.each`: one call that runs once per row of a table. */
  parameterized: boolean;
  /** `.skip`, `.fixme`, `xit`, `xdescribe`, `xtest`: present but not run. */
  skipped: boolean;
}

const SUITE_FNS = new Set(["describe", "context", "suite", "fdescribe", "xdescribe"]);
const CASE_FNS = new Set(["it", "test", "specify", "fit", "xit", "xtest"]);
const SKIP_FNS = new Set(["xdescribe", "xit", "xtest"]);
/**
 * Modifiers a test runner chains on a suite or case. `describe` turns `test` into a suite
 * (Playwright). `todo` is left out on purpose: a to-do has no test yet.
 */
const MODIFIERS = new Set([
  "skip", "only", "each", "concurrent", "sequential", "failing", "fails", "skipIf", "runIf", "if", "serial", "parallel", "fixme", "slow", "describe",
]);
const SKIP_MODIFIERS = new Set(["skip", "fixme"]);
/** A title longer than this is cut, so element names stay readable. */
const MAX_TITLE = 160;

/** File extensions this parser reads. */
export const JS_SOURCE = /\.[cm]?[jt]sx?$/i;

let tsModule: Promise<typeof TS> | null = null;

/** The TypeScript compiler, loaded on first use. */
export function loadTypeScript(): Promise<typeof TS> {
  tsModule ??= import("typescript").then((m) => ((m as unknown as { default?: typeof TS }).default ?? (m as unknown as typeof TS)));
  return tsModule;
}

/** The callee chain of a call: `it.each(table)` -> { base: "it", modifiers: ["each"] }; null when it isn't one. */
function calleeChain(ts: typeof TS, expr: TS.Expression): { base: string; modifiers: string[] } | null {
  if (ts.isIdentifier(expr)) return { base: expr.text, modifiers: [] };
  if (ts.isPropertyAccessExpression(expr)) {
    const inner = calleeChain(ts, expr.expression);
    if (!inner) return null;
    return { base: inner.base, modifiers: [...inner.modifiers, expr.name.text] };
  }
  // `it.each(table)` and `test.skipIf(cond)`, then called with the title.
  if (ts.isCallExpression(expr)) return calleeChain(ts, expr.expression);
  // it.each`table`
  if (ts.isTaggedTemplateExpression(expr)) return calleeChain(ts, expr.tag);
  if (ts.isParenthesizedExpression(expr)) return calleeChain(ts, expr.expression);
  return null;
}

/** The kind of call a callee chain makes, or null when it is not a suite or case. */
function kindOf(chain: { base: string; modifiers: string[] }): JsTestKind | null {
  if (!chain.modifiers.every((m) => MODIFIERS.has(m))) return null;
  if (SUITE_FNS.has(chain.base)) return chain.modifiers.includes("describe") ? null : "suite";
  if (CASE_FNS.has(chain.base)) return chain.modifiers.includes("describe") ? "suite" : "case";
  return null;
}

function isFunctionLike(ts: typeof TS, e: TS.Expression): e is TS.ArrowFunction | TS.FunctionExpression {
  return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
}

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 3).trimEnd()}...` : t;
}

/** The title argument as written: a string's value, a template's text, else the expression. */
function titleOf(ts: typeof TS, arg: TS.Expression, sf: TS.SourceFile): string {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return oneLine(arg.text);
  if (ts.isTemplateExpression(arg)) return oneLine(arg.getText(sf).slice(1, -1));
  return oneLine(arg.getText(sf));
}

function nameOfCallee(ts: typeof TS, e: TS.Expression): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text;
  if (ts.isParenthesizedExpression(e)) return nameOfCallee(ts, e.expression);
  if (ts.isNonNullExpression(e)) return nameOfCallee(ts, e.expression);
  return null;
}

/** A member call's receiver and name: `Model.load` for `Model.load()`, `loader.load` for `this.loader.load()`. */
function memberOf(ts: typeof TS, e: TS.Expression): string | null {
  if (!ts.isPropertyAccessExpression(e)) return null;
  const receiver = nameOfCallee(ts, e.expression) ?? (e.expression.kind === ts.SyntaxKind.ThisKeyword ? "this" : null);
  return receiver ? `${receiver}.${e.name.text}` : null;
}

/**
 * Names called, constructed or rendered anywhere under a node, spelled as CBM spells a callee: a
 * bare call by its name (`writeFile`), a member call on a named receiver as `receiver.name`
 * (`fs.writeFile`, `loader.load`), a member call on anything else by its name (`toBe` in
 * `expect(x).toBe(y)`). So a case calling `fs.writeFile` doesn't make CBM's bare `writeFile`.
 */
function callsUnder(ts: typeof TS, root: TS.Node): string[] {
  const names = new Set<string>();
  const visit = (n: TS.Node): void => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const name = memberOf(ts, n.expression) ?? nameOfCallee(ts, n.expression);
      if (name) names.add(name);
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const name = nameOfCallee(ts, n.tagName as TS.Expression);
      if (name && /^[A-Z]/.test(name)) names.add(name);
    } else if (ts.isTaggedTemplateExpression(n)) {
      const name = nameOfCallee(ts, n.tag);
      if (name) names.add(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return [...names];
}

function scriptKind(ts: typeof TS, fileName: string): TS.ScriptKind {
  const ext = /\.([cm]?[jt]sx?)$/i.exec(fileName)?.[1].toLowerCase() ?? "ts";
  if (ext.endsWith("tsx")) return ts.ScriptKind.TSX;
  if (ext.endsWith("jsx")) return ts.ScriptKind.JSX;
  if (ext.endsWith("js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Every suite and case call in a test file, in source order. The parser recovers from syntax
 * errors, so a file that doesn't compile still gives the calls it can read.
 */
export function parseJsTestCalls(ts: typeof TS, fileName: string, text: string): JsTestCall[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(ts, fileName));
  const out: JsTestCall[] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: TS.Node, suites: string[]): void => {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(ts, node.expression);
      const kind = chain ? kindOf(chain) : null;
      const [titleArg, ...rest] = node.arguments;
      // The callback: the first argument after the title that is a function, or (when none is) a
      // reference to one. Vitest and Playwright allow an options object before it.
      const fn = rest.find((a) => isFunctionLike(ts, a));
      const callback = fn ?? rest.find((a) => ts.isIdentifier(a) || ts.isPropertyAccessExpression(a));
      if (chain && kind && titleArg && callback) {
        const title = titleOf(ts, titleArg, sf);
        out.push({
          kind,
          callee: [chain.base, ...chain.modifiers].join("."),
          title,
          suites,
          startLine: line(node.getStart(sf)),
          endLine: line(node.getEnd()),
          calls: fn ? callsUnder(ts, fn.body) : [],
          parameterized: chain.modifiers.includes("each"),
          skipped: SKIP_FNS.has(chain.base) || chain.modifiers.some((m) => SKIP_MODIFIERS.has(m)),
        });
        // Calls nested in a suite (or, rarely, a case) are read with the path extended; the callee
        // and title are not visited again.
        for (const a of rest) visit(a, [...suites, title]);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, suites));
  };
  visit(sf, []);
  return out;
}
