/**
 * Route helpers for extraction: the parameter names a route's path has in the code, and the
 * routes test code calls by URL.
 *
 * CBM names a route's parameters `{}` (`__route__GET__/owners/{}`). The names come from CBM's own
 * route name when it has them (`/owners/{ownerId}`), else from the handler: a path literal in its
 * source with as many parameters, or its path-annotated parameters, or its parameters.
 */

/** A path with every parameter as `{}` and no trailing slash: `/owners/{ownerId}/` -> `/owners/{}`. */
export function normRoutePath(p: string): string {
  return p.replace(/\{[^}]*\}|:[A-Za-z_]\w*/g, "{}").replace(/\/+$/, "") || "/";
}

function slots(p: string): number {
  return (p.match(/\{\}/g) ?? []).length;
}

/** Fill a `{}` path's parameters with these names, in order. */
function fill(p: string, names: string[]): string {
  let i = 0;
  return p.replace(/\{\}/g, () => `{${names[i++]}}`);
}

/** Parameter names in a path template, `{name}` or `:name`, in order. */
function templateNames(p: string): string[] {
  return [...p.matchAll(/\{(\w+)[^}]*\}|:([A-Za-z_]\w*)/g)].map((m) => m[1] ?? m[2]);
}

/** Parameters that never carry a path segment: request objects, models, framework plumbing. */
const NOT_PATH = /^(req|res|request|response|next|ctx|context|model|modelMap|session|self|cls|body|payload|result|bindingResult|redirectAttributes|principal|page|pageable|locale|headers?|form|dto)$/i;
const SEGMENT_TYPE = /^(final\s+)?(int|long|short|Integer|Long|Short|String|string|number|str|UUID|uuid\.UUID|bool|boolean|Boolean|Int|i32|i64|u32|u64|&str)\b/;
const NOT_PATH_TYPE =/\b(Model|ModelMap|BindingResult|HttpServletRequest|HttpServletResponse|RedirectAttributes|Principal|Pageable|Locale|Errors|WebRequest|Request|Response|NextFunction)\b/;

/** The parameter list of the first function or method declared in a source text. */
function parameterList(source: string): string | null {
  const m = /\b[\w$]+\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::[^{=]+)?(?:throws [\w., ]+)?\s*(?:\{|=>|->|:)/.exec(source);
  return m ? m[1] : null;
}

function splitParams(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if ("(<[{".includes(ch)) depth++;
    else if (")>]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A parameter's name: `int ownerId`, `ownerId: int`, `owner_id: int = Path(...)`, `@PathVariable("ownerId") int id`. */
function paramName(p: string): { name: string; annotated: string | null; type: string } | null {
  const annotated = /@PathVariable\s*\(\s*(?:(?:name|value)\s*=\s*)?["'](\w+)["']/.exec(p)?.[1] ?? null;
  const pathMarked = annotated !== null || /@(PathVariable|PathParam|Param)\b|\bPath\s*\(/.test(p);
  const bare = p.replace(/@\w+(\s*\([^)]*\))?/g, "").replace(/=.*$/, "").trim();
  let name: string | undefined;
  let type = "";
  const colon = /^([A-Za-z_$][\w$]*)\??\s*:\s*(.+)$/.exec(bare);
  if (colon) {
    name = colon[1];
    type = colon[2];
  } else {
    const words = bare.split(/\s+/).filter(Boolean);
    name = words[words.length - 1]?.replace(/^[*&.]+/, "");
    type = words.slice(0, -1).join(" ");
  }
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  return { name, annotated: pathMarked ? (annotated ?? name) : null, type };
}

/**
 * The route's path with its parameters named where the code names them. `path` is CBM's
 * (`/owners/{}`); `cbmName` is CBM's own route name; `handlerSource` the handler's source.
 * Unnamed parameters stay `{}`.
 */
export function namedRoutePath(path: string, cbmName: unknown, handlerSource: string | null): string {
  const n = slots(path);
  if (n === 0) return path;
  if (typeof cbmName === "string" && cbmName.startsWith("/") && normRoutePath(cbmName) === normRoutePath(path) && templateNames(cbmName).length === n) {
    return fill(path, templateNames(cbmName));
  }
  if (!handlerSource) return path;
  // A path literal in the handler (its mapping annotation) whose parameters line up with the route's.
  const norm = normRoutePath(path);
  for (const m of handlerSource.matchAll(/["'`](\/[^"'`\s]*)["'`]/g)) {
    const literal = m[1];
    const names = templateNames(literal);
    if (names.length === n && norm.endsWith(normRoutePath(literal))) return fill(path, names);
  }
  // The handler's parameters: those marked as path parameters, else the ones that could be.
  const list = parameterList(handlerSource);
  if (list === null) return path;
  const params = splitParams(list).map(paramName).filter((p): p is NonNullable<typeof p> => !!p);
  const marked = params.filter((p) => p.annotated).map((p) => p.annotated!);
  if (marked.length === n) return fill(path, marked);
  // Unmarked, only those of a type a path segment can be (or of no stated type).
  const plain = params
    .filter((p) => !NOT_PATH.test(p.name) && !NOT_PATH_TYPE.test(p.type) && (!p.type || SEGMENT_TYPE.test(p.type.trim())))
    .map((p) => p.name);
  return plain.length === n ? fill(path, plain) : path;
}

/** A test file, by its path. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|Tests?\.(java|kt|cs)$/;

const HTTP_CALL = /\b(get|post|put|patch|delete)(?:ForEntity|ForObject)?\s*\(\s*["'`](\/[^"'`\s]*)["'`]/gi;

/**
 * The served routes (`__route__METHOD__/path` names) a test's source calls by URL:
 * `get("/owners/{ownerId}", 1)`, `RequestEntity.get("/owners/1")`, `request(app).post('/users')`.
 * A URL matches a route whose literal segments it repeats, a parameter matching any segment; the
 * query string is ignored. Of several, the one with fewest parameters wins.
 */
export function routesCalledIn(source: string | null, served: ReadonlyArray<{ name: string; method: string; path: string }>): string[] {
  if (!source) return [];
  const out = new Set<string>();
  for (const m of source.matchAll(HTTP_CALL)) {
    const method = m[1].toUpperCase();
    const url = m[2].replace(/[?#].*$/, "");
    const segs = normRoutePath(url).split("/");
    let best: { name: string; params: number } | null = null;
    for (const r of served) {
      if (r.method !== method) continue;
      const rsegs = normRoutePath(r.path).split("/");
      if (rsegs.length !== segs.length) continue;
      if (!rsegs.every((s, i) => s === "{}" ? segs[i] !== "" : s === segs[i])) continue;
      const params = slots(normRoutePath(r.path));
      if (!best || params < best.params) best = { name: r.name, params };
    }
    if (best) out.add(best.name);
  }
  return [...out];
}
