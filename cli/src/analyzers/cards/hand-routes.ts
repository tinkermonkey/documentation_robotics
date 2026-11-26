/**
 * Routes the graph doesn't give: those a server routes by hand, and what a route definition says
 * about its operation.
 *
 * CBM reads routes from framework registrations. A Node `http.createServer` handler that compares
 * the method and path itself (`if (route === '/files/have' && req.method === 'POST')`), or a
 * gateway that matches a ROUTES table or regexes, has none. {@link readHandRoutes} reads those from
 * the file's text where the path is readable, and says when a file looks hand-routed but gave none:
 * that is for the agent to check, never a route absent. {@link readRouteDefinitions} reads
 * `operationId`, `summary` and `tags` from a Hono `createRoute` (or any object with `method` and
 * `path`) so extraction never makes them up from the path.
 *
 * Both read text. Neither guesses: a path comparison with no method beside it, or a regex that is
 * more than literal segments and captures, is left unread.
 */
import { VENDOR_EXCLUDE } from "./build.js";
import { TEST_PATH, normRoutePath } from "./routes.js";

export interface HandRoute {
  method: string;
  /** The path as the code states it, parameters as `{}`. */
  path: string;
  /** 1-based line of the comparison or table entry. */
  line: number;
  /** The table entry's handler, when it names one. */
  handler?: string;
}

export interface HandRoutesRead {
  routes: HandRoute[];
  /**
   * The file hand-routes (it creates a server, or has a route table) but a route in it could not be
   * read: a path built at run time, a comparison with no method, a regex that is not literal. The
   * routes above are not necessarily all of them.
   */
  partial: boolean;
}

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const METHOD_ONLY = new RegExp(`\\b(?:req|request)\\.method\\s*===?\\s*['"\`](${METHODS})['"\`]|\\bmethod\\s*===?\\s*['"\`](${METHODS})['"\`]`, "g");
const PATH_VAR = "(?:route|pathname|path|url|\\w*[Pp]ath\\w*|(?:req|request)\\.url|\\w+\\.pathname)";
/** `route === '/x'` or `'/x' === route`. */
const PATH_EQ = new RegExp(`\\b${PATH_VAR}\\s*===?\\s*(['"\`])(\\/[^'"\`\\s]*)\\1|(['"\`])(\\/[^'"\`\\s]*)\\3\\s*===?\\s*${PATH_VAR}\\b`, "g");
/** `/^\/x\/([^/]+)$/.test(route)` or `.exec(route)`. */
/** A regex literal's source: escapes, character classes (which may hold a `/`), and other characters. */
const RE_BODY = String.raw`(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\\[])+`;
const RE_LITERAL = String.raw`\/\^?${RE_BODY}\$?\/[a-z]*`;
const REGEX_TEST = new RegExp(`(${RE_LITERAL})\\s*\\.\\s*(?:test|exec)\\s*\\(`, "g");
const REGEX_MATCH = new RegExp(`\\b(?:route|pathname|path|url|\\w*[Pp]ath\\w*)\\s*\\.\\s*match\\s*\\(\\s*(${RE_LITERAL})\\s*\\)`, "g");

/** A path that is only literal segments and parameters (`{}`), at least one segment. */
function isReadablePath(p: string): boolean {
  return /^\/[\w\-.~%!$&'()*+,;=:@/{}]*$/.test(p) && !/[*]/.test(p);
}

/**
 * A regex literal (`/^\/api\/projects\/([^/]+)\/revert$/`) as a route path
 * (`/api/projects/{}/revert`), or null when it is more than literal segments and one capture per
 * parameter. A named capture group (`(?<id>...)`) gives the parameter its name.
 */
export function regexRoutePath(literal: string): string | null {
  const m = /^\/(.*)\/[a-z]*$/s.exec(literal);
  if (!m) return null;
  let src = m[1];
  if (!src.startsWith("^")) return null;
  src = src.slice(1).replace(/(?:\\\/\?)?\$$/, "");
  let out = "";
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    const group = /^\((?:\?<(\w+)>)?((?:[^()\\]|\\.)*)\)/.exec(rest);
    if (group) {
      // One path segment: a character class that excludes `/`, or a word/digit class.
      if (!/^(\[\^\/\]|\[\\w-?\]|\[\\w\\-\]|\[\\w\.-\]|\[\w\\-\]|\[A-Za-z0-9_-\]|\\w|\\d|\[0-9a-f-\]|\[\^\/\?#\])[+*]?\??$/.test(group[2])) return null;
      out += group[1] ? `{${group[1]}}` : "{}";
      i += group[0].length;
      continue;
    }
    if (rest.startsWith("\\/")) {
      out += "/";
      i += 2;
    } else if (rest.startsWith("\\.")) {
      out += ".";
      i += 2;
    } else if (rest.startsWith("\\-")) {
      out += "-";
      i += 2;
    } else if (/^[\w\-/~%]/.test(rest)) {
      out += rest[0];
      i += 1;
    } else return null;
  }
  return out.startsWith("/") && out.length > 1 ? out : null;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function methodsIn(s: string): string[] {
  return [...s.matchAll(METHOD_ONLY)].map((m) => (m[1] ?? m[2]).toUpperCase());
}

/**
 * The routes a file routes by hand. Reads comparisons inside a server handler (the method and the
 * path in one condition, or the path under a method's `if` on the line before) and route tables
 * (`{ method: 'GET', path: '/x' }`, `{ method: 'GET', pattern: /^\/x$/ }`, `['GET', '/x', handler]`).
 * A file that is neither, or a test file's own text, gives nothing and is not partial.
 */
export function readHandRoutes(text: string): HandRoutesRead {
  const server = /\bcreateServer\s*\(/.test(text);
  const table = /\b(?:matchRoute|ROUTES|routes)\b/.test(text);
  if (!server && !table) return { routes: [], partial: false };
  const found = new Map<string, HandRoute>();
  const add = (method: string, path: string, line: number, handler?: string) => {
    if (!isReadablePath(path)) return false;
    const key = `${method} ${normRoutePath(path)}`;
    if (!found.has(key)) found.set(key, { method, path: normRoutePath(path), line, ...(handler ? { handler } : {}) });
    return true;
  };
  let unread = false;

  if (server) {
    const lines = text.split("\n");
    let previousMethods: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const here = methodsIn(line);
      const paths: string[] = [];
      for (const m of line.matchAll(PATH_EQ)) paths.push(m[2] ?? m[4]);
      for (const re of [REGEX_TEST, REGEX_MATCH]) {
        for (const m of line.matchAll(re)) {
          const p = regexRoutePath(m[1]);
          if (p) paths.push(p);
          else if (/^\/\^/.test(m[1])) unread = true;
        }
      }
      if (paths.length) {
        // The method in the same condition, else the one the line before opens a block for.
        const methods = here.length ? here : /\{\s*$/.test(lines[i - 1] ?? "") ? previousMethods : [];
        if (methods.length === 0) unread = true;
        else for (const p of paths) for (const method of new Set(methods)) if (!add(method, p, i + 1)) unread = true;
      }
      if (line.trim()) previousMethods = /\{\s*$/.test(line) ? here : previousMethods;
    }
  }

  // Tables: an object literal or a tuple with a method and a path or pattern.
  for (const m of text.matchAll(new RegExp(`\\{[^{}]*?\\bmethod\\s*:\\s*['"\`](${METHODS})['"\`][^{}]*?\\}|\\{[^{}]*?\\b(?:path|pattern|url|route|regex|re)\\s*:[^{}]*?\\}`, "gi"))) {
    const body = m[0];
    const method = new RegExp(`\\bmethod\\s*:\\s*['"\`](${METHODS})['"\`]`, "i").exec(body)?.[1]?.toUpperCase();
    if (!method) continue;
    const handler = /\bhandler\s*:\s*([A-Za-z_$][\w$.]*)/.exec(body)?.[1];
    const lit = /\b(?:path|url|route)\s*:\s*['"`](\/[^'"`\s]*)['"`]/.exec(body)?.[1];
    const re = new RegExp(`\\b(?:pattern|regex|re|path|route)\\s*:\\s*(${RE_LITERAL})`).exec(body)?.[1];
    const path = lit ?? (re ? regexRoutePath(re) : null);
    if (!path) {
      unread = true;
      continue;
    }
    if (!add(method, path, lineOf(text, m.index ?? 0), handler)) unread = true;
  }
  for (const m of text.matchAll(new RegExp(`\\[\\s*['"\`](${METHODS})['"\`]\\s*,\\s*(?:['"\`](\\/[^'"\`\\s]*)['"\`]|(${RE_LITERAL}))\\s*,\\s*([A-Za-z_$][\\w$.]*)?`, "g"))) {
    const path = m[2] ?? (m[3] ? regexRoutePath(m[3]) : null);
    if (!path) {
      unread = true;
      continue;
    }
    if (!add(m[1], path, lineOf(text, m.index ?? 0), m[4])) unread = true;
  }

  const routes = [...found.values()].sort((a, b) => a.line - b.line);
  // A server file or table with nothing read at all is partial too: there is something to read.
  return { routes, partial: unread || (routes.length === 0 && server) };
}

// ---------------------------------------------------------------------------
// Route definitions (Hono createRoute, OpenAPI route objects)
// ---------------------------------------------------------------------------

export interface RouteDefinition {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  /** The definition's tags, joined with ", " (the spec stores one string). */
  tags?: string;
}

/** The text of the `{...}` starting at `open`, strings and comments skipped, or null when unbalanced. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 1;
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

/** Brace depth of each character of a `{...}` text (strings count as their opening depth). */
function depths(def: string): number[] {
  const out: number[] = new Array(def.length).fill(0);
  let depth = 0;
  for (let i = 0; i < def.length; i++) {
    const ch = def[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      for (; j < def.length && def[j] !== ch; j++) if (def[j] === "\\") j++;
      for (let k = i; k <= Math.min(j, def.length - 1); k++) out[k] = depth;
      i = j;
      continue;
    }
    if (ch === "}") depth--;
    out[i] = depth;
    if (ch === "{") depth++;
  }
  return out;
}

/**
 * The route definitions in a source text: `createRoute({ method, path, operationId, summary, tags })`
 * or any object literal with a literal `method` and `path` and at least one of those three. A field
 * the definition doesn't state as a string literal (a variable, a template with holes) stays unset.
 */
export function readRouteDefinitions(text: string): RouteDefinition[] {
  const out: RouteDefinition[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(/\bcreateRoute\s*\(\s*\{|\{\s*(?=[^{}]*\bmethod\s*:)/g)) {
    const open = (m.index ?? 0) + m[0].lastIndexOf("{");
    if (seen.has(open)) continue;
    seen.add(open);
    const def = balanced(text, open);
    if (!def) continue;
    const depth = depths(def);
    // The first match that starts at the definition's own level, not in a nested object.
    const own = (re: RegExp): RegExpExecArray | undefined => [...def.matchAll(re)].find((x) => depth[x.index ?? 0] === 1);
    const str = (key: string) => own(new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1\\s*[,}]`, "g"))?.[2];
    const method = str("method")?.toUpperCase();
    const route = str("path");
    if (!method || !route || !new RegExp(`^(${METHODS})$`).test(method)) continue;
    const operationId = str("operationId");
    const summary = str("summary");
    const tagList = own(/\btags\s*:\s*\[([^\]]*)\]/g)?.[1];
    const tags = tagList ? [...tagList.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((t) => t[2]).join(", ") : undefined;
    // Not a route definition without any of the three: an unrelated `{ method, path }` object.
    if (!operationId && !summary && !tags && !/\bcreateRoute\b/.test(m[0])) continue;
    out.push({
      method,
      path: route,
      ...(operationId ? { operationId } : {}),
      ...(summary ? { summary } : {}),
      ...(tags ? { tags } : {}),
    });
  }
  return out;
}

/** The definition for a route (its path with `{name}` or `:name` parameters as `{}`), or undefined. */
export function definitionFor(definitions: RouteDefinition[], method: string, routePath: string): RouteDefinition | undefined {
  const want = normRoutePath(routePath);
  return definitions.find((d) => d.method === method.toUpperCase() && normRoutePath(d.path) === want);
}

/** Source files a hand-written router can be in: JavaScript and TypeScript, outside tests and vendored code. */
const HAND_ROUTED_FILE = /\.[cm]?[jt]sx?$/;

export interface FileHandRoute extends HandRoute {
  file: string;
}

/**
 * The hand-routed routes of a project's files, and the files that look hand-routed but gave a
 * partial reading (what they route may be more than the routes listed). `text` reads a file's text.
 */
export function collectHandRoutes(
  files: Iterable<string>,
  text: (file: string) => string | null
): { routes: FileHandRoute[]; partialFiles: string[] } {
  const routes: FileHandRoute[] = [];
  const partialFiles: string[] = [];
  for (const file of files) {
    if (!HAND_ROUTED_FILE.test(file) || TEST_PATH.test(file) || VENDOR_EXCLUDE.test(file)) continue;
    const source = text(file);
    if (!source) continue;
    const read = readHandRoutes(source);
    for (const r of read.routes) routes.push({ ...r, file });
    if (read.partial) partialFiles.push(file);
  }
  return { routes, partialFiles };
}
