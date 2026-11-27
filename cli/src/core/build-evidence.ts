/**
 * What the build's files say about a planned element extraction did not stage (changeset_verify).
 *
 * Extraction makes elements from declarations (classes, functions, methods, types), HTTP routes,
 * infrastructure objects and test cases. Two kinds of planned element fall outside that, and
 * neither is "missing" from the build:
 *
 * - something the code registers by a name string, with no declaration of that name: an MCP tool
 *   (`server.registerTool("diff_set", handler)`), a CLI command, an event, a job. A code file names
 *   it as a call's argument or a name property, only inside quotes, so no symbol of that name
 *   exists for extraction to stage. `registeredByName` finds these, for the element types that can
 *   be registered that way; verify reports them as unverifiable ("may be registered by name"),
 *   with the file, line and string, so the agent checks one place once instead of treating
 *   "missing" as a false report on every run (#1226). The evidence is textual, so a clean match
 *   never rests on it: the verdict names these elements;
 * - an intent-layer element (a feature, a requirement) that the build has code for. Extraction
 *   never reads intent, so no as-built match exists to copy a source reference from.
 *   `sourceCandidates` ranks the build's files by how they name the element, for the agent to
 *   confirm and adopt (#1159).
 *
 * Both read the text of the files the build changed (the `since` range of the as-built changeset)
 * and of the planned element's own source files. Nothing here reads the code graph.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { codeChangesSince } from "../analyzers/code-changes.js";
import type { SourceReference } from "../types/source-reference.js";

/** A file of the build, with its text. */
export interface BuildFile {
  file: string;
  text: string;
}

/** A planned element, as the evidence checks read it. */
export interface EvidenceElement {
  id: string;
  name: string;
  /** Needed to tell whether the element is of a kind code can register by name. */
  layer?: string;
  type?: string;
  sourceReference?: SourceReference;
}

/** Files read per verification, and the size above which a file is skipped (generated, bundled). */
export const BUILD_FILE_LIMIT = 400;
const BUILD_FILE_MAX_BYTES = 512 * 1024;

/** Text files worth reading for a name: code, markup and configuration, never binaries or lock files. */
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|kts|cs|rs|php|swift|scala|groovy|sh|bash|vue|svelte|sql|ya?ml|json|toml|md)$/i;
const NOT_EVIDENCE = /(^|\/)(node_modules|dist|build|vendor|\.git)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock)$/;

const QUOTES = ['"', "'", "`"];
const isWordChar = (ch: string | undefined) => !!ch && /[\w$-]/.test(ch);

/** A name's words: split at separators and camelCase boundaries, lower-cased. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * The spellings code may give an element's name: the name itself, and its words joined as
 * snake_case, kebab-case, camelCase and PascalCase. From the element's name and its id's last
 * segment (`application.applicationservice.diff-set` gives `diff-set`). A one-word spelling
 * shorter than four letters is left out: it would match too much to be evidence.
 */
export function nameSpellings(element: EvidenceElement): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    if (s.length >= 4 || /[_\-.]/.test(s)) out.add(s);
  };
  const tail = element.id.split(".").slice(2).join(".");
  for (const raw of [element.name, tail]) {
    if (!raw) continue;
    if (!/\s/.test(raw)) add(raw);
    const words = nameWords(raw);
    if (words.length === 0) continue;
    add(words.join("_"));
    add(words.join("-"));
    add(words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join(""));
    add(words.map((w) => w[0].toUpperCase() + w.slice(1)).join(""));
  }
  return [...out];
}

/**
 * How a text mentions a spelling: inside quotes as the whole string, and elsewhere as a whole word.
 * Only a spelling that can be an identifier counts elsewhere: `diff-set` in an import path
 * (`"./tools/diff-set.js"`) is neither a declaration nor a reference.
 */
function mentions(text: string, spelling: string): { quoted: number; bare: number } {
  let quoted = 0;
  let bare = 0;
  const identifier = /^[A-Za-z_$][\w$]*$/.test(spelling);
  for (let at = text.indexOf(spelling); at !== -1; at = text.indexOf(spelling, at + spelling.length)) {
    const before = text[at - 1];
    const after = text[at + spelling.length];
    if (before !== undefined && QUOTES.includes(before) && after === before) quoted++;
    else if (identifier && !isWordChar(before) && !isWordChar(after)) bare++;
  }
  return { quoted, bare };
}

/** Where the code may register an element by a name string. */
export interface RegisteredByName {
  file: string;
  /** The string the file names it by. */
  string: string;
  /** The line of the first such string, 1-based. */
  line: number;
  /** How the string is used: an argument of a call, or the value of a `name`-like property. */
  how: "call-argument" | "name-property";
}

/**
 * Element types that code may register by a name string instead of declaring: a service, an
 * interface, a function, an event or a process of the application layer (an MCP tool, a CLI
 * command, an RPC method, an event name, a job), and an API operation. A component, a data object
 * or a schema is a class, a module or a type: it is declared, so one that no declaration matches is
 * missing, whatever string the build quotes.
 */
export const REGISTRABLE_BY_NAME: ReadonlySet<string> = new Set([
  "application.applicationservice",
  "application.applicationinterface",
  "application.applicationfunction",
  "application.applicationevent",
  "application.applicationprocess",
  "api.operation",
]);

/** Source code, where a registration is made. Documents and configuration quote names without registering anything. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|kts|cs|rs|php|swift|scala|groovy|vue|svelte)$/i;

/** A property or keyword a registration names its subject by: `name: "diff_set"`, `name="grid_lookup"`. */
const NAME_PROPERTY = /(?:^|[^\w$])["']?(?:name|command|tool|event|method|topic|channel|job|task)["']?\s*[:=]\s*$/;

/**
 * A callee that registers what its first argument names: `register*`, `define*`, `tool`,
 * `command`, `add*Tool`, `add*Command`, `add*Handler`, `add*Job` (`server.registerTool`,
 * `program.command`, `mcp.tool`, `queue.defineJob`). A call to anything else (`track`, `t`,
 * `expect`, `localStorage.getItem`, `it`) quotes a name without registering it.
 */
const REGISTERING_CALLEE = /^(?:register\w*|define\w*|tool|command|add\w*(?:Tool|Command|Handler|Job|Task|Route|Method))$/i;

/** A declared type that marks an object as a registration: `const t: McpToolDefinition = { name: ... }`. */
const REGISTRATION_TYPE = /:\s*[\w$.]*(?:Tool|Command|Handler|Job|Task|Route|Method)(?:Definition|Spec|Config|Registration)?\b[^=]*=\s*$/;

/** The callee of the call whose `(` ends `text` (`server.registerTool(` gives `registerTool`), or null. */
function calleeBefore(text: string): string | null {
  const m = /([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\($/.exec(text);
  return m ? m[1] : null;
}

/**
 * The text before the bracket that encloses position `at` (the nearest `(` or `{` not closed
 * before it), and which bracket it is; null at the top level.
 */
function enclosing(text: string, at: number): { bracket: "(" | "{"; before: string } | null {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")" || ch === "}" || ch === "]") depth++;
    else if (ch === "(" || ch === "{" || ch === "[") {
      if (depth > 0) depth--;
      else if (ch === "[") return null;
      else return { bracket: ch, before: text.slice(Math.max(0, i - 200), i + 1) };
    }
  }
  return null;
}

/**
 * Whether the quoted string starting at `at` (the index of its first character, after the opening
 * quote) is used the way a registration uses one:
 * - the first argument of a call whose callee registers ({@link REGISTERING_CALLEE}):
 *   `server.registerTool("diff_set", handler)`;
 * - the value of a name-like property of an object passed to such a call, or of an object
 *   declared with a registration type: `server.tool({ name: "x" })`, `@mcp.tool(name="x")`,
 *   `const t: McpToolDefinition = { name: "x", ... }`.
 * Anything else (a list of menu items, an analytics event, a translation key, an assertion, a
 * storage key) quotes the name without registering it.
 */
function registrationUse(text: string, at: number, length: number): RegisteredByName["how"] | null {
  const before = text.slice(Math.max(0, at - 1 - 80), at - 1);
  const after = text.slice(at + length + 1, at + length + 1 + 40);
  if (NAME_PROPERTY.test(before)) {
    const outer = enclosing(text, at - 1);
    if (!outer) return null;
    if (outer.bracket === "(") {
      const callee = calleeBefore(outer.before);
      return callee && REGISTERING_CALLEE.test(callee) ? "name-property" : null;
    }
    // An object: passed to a registering call, or declared with a registration type.
    const lead = outer.before.slice(0, -1).replace(/\s+$/, "");
    const call = /([A-Za-z_$][\w$]*)\s*\(\s*(?:[^()]*,\s*)?$/.exec(lead);
    if (call && REGISTERING_CALLEE.test(call[1])) return "name-property";
    return REGISTRATION_TYPE.test(lead) ? "name-property" : null;
  }
  // The first argument of a registering call.
  const lead = before.replace(/\s+$/, "");
  const trail = after.replace(/^\s+/, "");
  if (!/^[,)]/.test(trail) || !lead.endsWith("(")) return null;
  const callee = calleeBefore(lead);
  return callee && REGISTERING_CALLEE.test(callee) ? "call-argument" : null;
}

/**
 * The text with its comments blanked (same length, line breaks kept), so a name in a comment
 * (`// see register("x")`, `/* name: "x" *\/`, `# name="x"`) is never read as code.
 */
export function withoutComments(file: string, text: string): string {
  const hash = /\.(?:py|rb)$/i.test(file);
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      // A string: copied as is, up to its closing quote (escapes kept).
      let j = i + 1;
      while (j < text.length && text[j] !== ch && !(ch !== "`" && text[j] === "\n")) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (!hash && ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (!hash && ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (hash && ch === "#") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** A test file, by its path: a registration there is a test's, not the build's. */
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/;

/**
 * The code file that may register this element by a name string, when one does: the element is of
 * a type that can be registered that way ({@link REGISTRABLE_BY_NAME}); some spelling of its name
 * (or one of its source symbols) is a whole string in a code file that is not a test, outside
 * comments, used as the first argument of a registering call or as a name property of an object
 * registered that way (see {@link registrationUse}); and no spelling appears in that file outside quotes as an
 * identifier (which would be a declaration or a reference, something extraction can see). The
 * element's own source files are looked at first, then the build's.
 *
 * This is evidence that the element may be registered by name, not that it is: the caller reports
 * it as unverifiable with the file and line, and never lets a clean match rest on it.
 *
 * A one-word name is taken only from the element's own source files: `"status"` in some file of
 * the build says nothing about an element called Status.
 */
export function registeredByName(element: EvidenceElement, buildFiles: BuildFile[]): RegisteredByName | null {
  if (!element.layer || !element.type || !REGISTRABLE_BY_NAME.has(`${element.layer}.${element.type}`)) return null;
  const own = new Set(
    (element.sourceReference?.locations ?? []).map((l) => (typeof l?.file === "string" ? l.file.replace(/\\/g, "/").replace(/^\.\//, "") : "")).filter(Boolean)
  );
  const symbols = (element.sourceReference?.locations ?? [])
    .map((l) => l?.symbol)
    .filter((s): s is string => typeof s === "string" && s.length >= 3 && !/\s/.test(s));
  const spellings = [...new Set([...symbols, ...nameSpellings(element)])];
  if (spellings.length === 0) return null;
  const oneWord = nameWords(element.name).length < 2 && symbols.length === 0;
  const code = buildFiles.filter((f) => CODE_FILE.test(f.file) && !TEST_FILE.test(f.file));
  const ordered = [...code.filter((f) => own.has(f.file)), ...code.filter((f) => !own.has(f.file))];
  for (const { file, text: raw } of ordered) {
    if (oneWord && !own.has(file)) continue;
    const text = withoutComments(file, raw);
    let found: Omit<RegisteredByName, "file"> | null = null;
    let declared = false;
    for (const spelling of spellings) {
      const identifier = /^[A-Za-z_$][\w$]*$/.test(spelling);
      for (let at = text.indexOf(spelling); at !== -1; at = text.indexOf(spelling, at + spelling.length)) {
        const before = text[at - 1];
        const after = text[at + spelling.length];
        // A plain string: a template literal is built text, not a name.
        if (before !== undefined && (before === '"' || before === "'") && after === before) {
          const how = registrationUse(text, at, spelling.length);
          if (how && !found) found = { string: spelling, line: text.slice(0, at).split("\n").length, how };
        } else if (identifier && !isWordChar(before) && !isWordChar(after)) declared = true;
      }
    }
    if (found && !declared) return { file, ...found };
  }
  return null;
}

/** A symbol a planned element's source reference names, found in the build's file (#1429). */
export interface DeclaredSymbol {
  file: string;
  symbol: string;
  /** The line of the first whole-word mention outside comments, 1-based. */
  line: number;
}

/**
 * The location of a planned element's own source reference (file and symbol) whose symbol the
 * file's text names as a whole word outside comments, when one does. This is what an element
 * extraction produces nothing of that type for (a plain dict an object schema describes, a shape
 * checked by a function) has to show that its code is in the build. Evidence from the file's text,
 * not the code graph: the caller reports the element as unverifiable with it, never as matched.
 * Only a declaration counts (a keyword and the name, or a member or assignment at the start of a line), in a file the build changed: an import, a call or a quoted string is not one. A qualified symbol (`Class.method`, `module::fn`) is looked for by its last segment.
 */
export function declaredSymbol(element: EvidenceElement, buildFiles: BuildFile[], changedFiles?: ReadonlySet<string>): DeclaredSymbol | null {
  for (const location of element.sourceReference?.locations ?? []) {
    const symbol = typeof location?.symbol === "string" ? location.symbol.trim() : "";
    const file = typeof location?.file === "string" ? location.file.replace(/\\/g, "/").replace(/^\.\//, "") : "";
    if (!symbol || !file) continue;
    // Only a file the build changed can show that the build holds the symbol.
    if (changedFiles && !changedFiles.has(file)) continue;
    const parts = symbol.split(/[.#:/]+/).filter(Boolean);
    const name = parts[parts.length - 1] ?? symbol;
    const found = buildFiles.find((f) => f.file === file);
    if (!found || !/^[\w$]+$/.test(name)) continue;
    const text = withoutComments(file, found.text);
    // A qualified symbol needs its qualifier in the file too (`Order.cancel`: `Order`).
    if (parts.slice(0, -1).some((q) => !new RegExp(`(?<![\\w$])${q.replace(/[^\w$]/g, "")}(?![\\w$])`).test(text))) continue;
    // A declaration: a keyword then the name, or a member/assignment at the start of a line.
    const declaration = new RegExp(
      `(?:\\b(?:def|function\\*?|class|interface|type|enum|const|let|var|fn|func|struct|trait|object|val)\\s+${name}(?![\\w$]))|` +
        `(?:^[ \\t]*(?:(?:export|public|private|protected|static|async|readonly)\\s+)*${name}[ \\t]*(?:[:=](?!=)|(?:<[^>\\n]*>)?\\([^)\\n]*\\)[^;\\n]*\\{))`,
      "m"
    );
    const hit = declaration.exec(text);
    if (hit) return { file, symbol, line: text.slice(0, hit.index + hit[0].indexOf(name)).split("\n").length };
  }
  return null;
}

/** A file of the build that may hold a planned element's code. */
export interface SourceCandidate {
  file: string;
  /** The symbol or string the file names it by, when it names it exactly. */
  symbol?: string;
  /**
   * `names-it`: a spelling of the element's name is in the file as a word (a name it only quotes
   * is never offered). `file-name`: the file is named after it. `mentions-words`:
   * the file's name or text has the words of its name, no more.
   */
  evidence: "names-it" | "file-name" | "mentions-words";
}

/** Candidates shown per element on a compact line; the report itself holds every one, best first. */
export const SOURCE_CANDIDATES_SHOWN = 3;

/**
 * The build's files that may hold this element's code, best first: a file that names it exactly,
 * a file named after it, then files whose name and text carry the words of its name (all of them
 * for a name of up to three words, most of them for a longer one). Every such file is returned;
 * a compact line shows the first few and says how many more. Empty when none does: a goal or a
 * requirement usually has no file of its own.
 */
export function sourceCandidates(element: EvidenceElement, buildFiles: BuildFile[]): SourceCandidate[] {
  const spellings = nameSpellings(element);
  const words = [...new Set(nameWords(element.name).filter((w) => w.length >= 3))];
  if (spellings.length === 0 && words.length === 0) return [];
  const scored: Array<{ candidate: SourceCandidate; score: number }> = [];
  // A test holds no element's code: it is never offered (it names what it tests as often as the code does).
  for (const { file, text } of buildFiles.filter((f) => !TEST_FILE.test(f.file))) {
    const base = path.basename(file).replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "");
    const baseWords = new Set(nameWords(base));
    let exact: { spelling: string; quotedOnly: boolean } | null = null;
    for (const spelling of spellings) {
      const m = mentions(text, spelling);
      if (m.bare > 0) {
        exact = { spelling, quotedOnly: false };
        break;
      }
      if (m.quoted > 0 && !exact) exact = { spelling, quotedOnly: true };
    }
    const inName = words.filter((w) => baseWords.has(w)).length;
    const namedAfter = words.length > 0 && inName === words.length;
    const lower = text.toLowerCase();
    const inText = words.filter((w) => lower.includes(w)).length;
    const needed = words.length <= 3 ? words.length : Math.ceil(words.length * 0.75);
    // A name the file only quotes is not offered: it says nothing about where the element's code
    // is (a menu label, an event name), and adopting it would tie the element to that string.
    if (exact && !exact.quotedOnly) {
      scored.push({ candidate: { file, symbol: exact.spelling, evidence: "names-it" }, score: 100 + (namedAfter ? 20 : 0) + inName });
    } else if (namedAfter) {
      scored.push({ candidate: { file, evidence: "file-name" }, score: 60 + inText });
    } else if (words.length >= 2 && inText >= needed && inName > 0) {
      scored.push({ candidate: { file, evidence: "mentions-words" }, score: 10 * inName + inText });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.candidate.file.localeCompare(b.candidate.file))
    .map((s) => s.candidate);
}

/** The files of the build, and why some could not be read. */
export interface BuildFiles {
  files: BuildFile[];
  /** The files the `since` range changed (not the extra files), when they could be listed. */
  changed: Set<string>;
  /** Set when the range's files could not be listed, or more changed than are read. */
  note?: string;
}

/**
 * The text of the files the build changed since `since` (when given), and of `extraFiles` (the
 * planned elements' own source files), from the codebase root. At most {@link BUILD_FILE_LIMIT}
 * files; binaries, lock files, generated output and very large files are left out.
 */
export async function readBuildFiles(codebaseRoot: string, since: string | undefined, extraFiles: Iterable<string> = []): Promise<BuildFiles> {
  const wanted: string[] = [];
  const seen = new Set<string>();
  const want = (file: string) => {
    const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!f || seen.has(f) || !TEXT_FILE.test(f) || NOT_EVIDENCE.test(f)) return;
    seen.add(f);
    wanted.push(f);
  };
  for (const f of extraFiles) want(f);
  const changed = new Set<string>();
  let note: string | undefined;
  if (since) {
    try {
      const changes = await codeChangesSince(codebaseRoot, since);
      for (const f of [...changes.changed].sort()) {
        want(f);
        changed.add(f.replace(/\\/g, "/").replace(/^\.\//, ""));
      }
    } catch (error) {
      note = `The files changed since ${since} could not be listed (${error instanceof Error ? error.message : String(error)}), so the build's files were not searched for planned elements extraction can't see.`;
    }
  }
  if (wanted.length > BUILD_FILE_LIMIT) {
    note =
      `${wanted.length} files changed in the build; the first ${BUILD_FILE_LIMIT} (the planned elements' own files, then the changed files by path) ` +
      `were searched for planned elements extraction can't see, and the other ${wanted.length - BUILD_FILE_LIMIT} were not: a planned element ` +
      "registered by name in one of those reads as missing. Give such an element its sourceFile and it is searched there first.";
    wanted.length = BUILD_FILE_LIMIT;
  }
  const root = path.resolve(codebaseRoot);
  const files: BuildFile[] = [];
  const tooLarge: string[] = [];
  for (const file of wanted) {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(root + path.sep)) continue;
    try {
      if ((await stat(abs)).size > BUILD_FILE_MAX_BYTES) {
        tooLarge.push(file);
        continue;
      }
      files.push({ file, text: await readFile(abs, "utf-8") });
    } catch {
      // Deleted in the range, or unreadable: nothing to search.
    }
  }
  // What was not searched is said, so "missing" is never read as "looked everywhere".
  if (tooLarge.length > 0) {
    const large = `${tooLarge.length} file(s) over ${BUILD_FILE_MAX_BYTES / 1024} KB were not searched for planned elements extraction can't see: ${tooLarge.join(", ")}.`;
    note = note ? `${note} ${large}` : large;
  }
  return { files, changed, ...(note ? { note } : {}) };
}
