/**
 * What the build's files say about a planned element extraction did not stage (changeset_verify).
 *
 * Extraction makes elements from declarations (classes, functions, methods, types), HTTP routes,
 * infrastructure objects and test cases. Two kinds of planned element fall outside that, and
 * neither is "missing" from the build:
 *
 * - something the code registers by a name string, with no declaration of that name: an MCP tool
 *   (`server.registerTool("diff_set", handler)`), a CLI command, an event, a job, a feature flag.
 *   The file names it, only inside quotes, so no symbol of that name exists for extraction to
 *   stage. `registeredByName` finds these; verify reports them as unverifiable, with the file and
 *   the string, so the agent checks one place once instead of treating "missing" as a false report
 *   on every run (#1226);
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

/** Where the code registers an element by a name string. */
export interface RegisteredByName {
  file: string;
  /** The string the file names it by. */
  string: string;
}

/**
 * The file that names this element only as a quoted string, when one does: some spelling of its
 * name (or one of its source symbols) is a whole string literal in the file, and no spelling
 * appears there outside quotes as a word (which would be a declaration or a reference, something
 * extraction can see). The element's own source files are looked at first, then the build's.
 *
 * A one-word name is taken only from the element's own source files: `"status"` in some file of
 * the build says nothing about an element called Status.
 */
export function registeredByName(element: EvidenceElement, buildFiles: BuildFile[]): RegisteredByName | null {
  const own = new Set(
    (element.sourceReference?.locations ?? []).map((l) => (typeof l?.file === "string" ? l.file.replace(/\\/g, "/").replace(/^\.\//, "") : "")).filter(Boolean)
  );
  const symbols = (element.sourceReference?.locations ?? [])
    .map((l) => l?.symbol)
    .filter((s): s is string => typeof s === "string" && s.length >= 3 && !/\s/.test(s));
  const spellings = [...new Set([...symbols, ...nameSpellings(element)])];
  if (spellings.length === 0) return null;
  const oneWord = nameWords(element.name).length < 2 && symbols.length === 0;
  const ordered = [...buildFiles.filter((f) => own.has(f.file)), ...buildFiles.filter((f) => !own.has(f.file))];
  for (const { file, text } of ordered) {
    if (oneWord && !own.has(file)) continue;
    let found: string | null = null;
    let declared = false;
    for (const spelling of spellings) {
      const m = mentions(text, spelling);
      if (m.bare > 0) declared = true;
      if (m.quoted > 0 && !found) found = spelling;
    }
    if (found && !declared) return { file, string: found };
  }
  return null;
}

/** A file of the build that may hold a planned element's code. */
export interface SourceCandidate {
  file: string;
  /** The symbol or string the file names it by, when it names it exactly. */
  symbol?: string;
  /**
   * `names-it`: a spelling of the element's name is in the file as a word. `named-as-string`: only
   * inside quotes (registered by name). `file-name`: the file is named after it. `mentions-words`:
   * the file's name or text has the words of its name, no more.
   */
  evidence: "names-it" | "named-as-string" | "file-name" | "mentions-words";
}

/** Candidates listed per element. */
export const SOURCE_CANDIDATE_LIMIT = 3;

/**
 * The build's files that may hold this element's code, best first: a file that names it exactly,
 * a file named after it, then files whose name and text carry the words of its name (all of them
 * for a name of up to three words, most of them for a longer one). Empty when none does: a goal
 * or a requirement usually has no file of its own.
 */
export function sourceCandidates(element: EvidenceElement, buildFiles: BuildFile[], limit = SOURCE_CANDIDATE_LIMIT): SourceCandidate[] {
  const spellings = nameSpellings(element);
  const words = [...new Set(nameWords(element.name).filter((w) => w.length >= 3))];
  if (spellings.length === 0 && words.length === 0) return [];
  const scored: Array<{ candidate: SourceCandidate; score: number }> = [];
  for (const { file, text } of buildFiles) {
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
    if (exact) {
      scored.push({
        candidate: { file, symbol: exact.spelling, evidence: exact.quotedOnly ? "named-as-string" : "names-it" },
        score: 100 + (namedAfter ? 20 : 0) + inName,
      });
    } else if (namedAfter) {
      scored.push({ candidate: { file, evidence: "file-name" }, score: 60 + inText });
    } else if (words.length >= 2 && inText >= needed && inName > 0) {
      scored.push({ candidate: { file, evidence: "mentions-words" }, score: 10 * inName + inText });
    }
  }
  // A test names what it tests as often as the code does: the code first.
  const isTest = (file: string) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  return scored
    .sort((a, b) => Number(isTest(a.candidate.file)) - Number(isTest(b.candidate.file)) || b.score - a.score || a.candidate.file.localeCompare(b.candidate.file))
    .slice(0, limit)
    .map((s) => s.candidate);
}

/** The files of the build, and why some could not be read. */
export interface BuildFiles {
  files: BuildFile[];
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
  let note: string | undefined;
  if (since) {
    try {
      const changes = await codeChangesSince(codebaseRoot, since);
      for (const f of [...changes.changed].sort()) want(f);
    } catch (error) {
      note = `The files changed since ${since} could not be listed (${error instanceof Error ? error.message : String(error)}), so the build's files were not searched for planned elements extraction can't see.`;
    }
  }
  if (wanted.length > BUILD_FILE_LIMIT) {
    note = `${wanted.length} files changed in the build; the first ${BUILD_FILE_LIMIT} were searched for planned elements extraction can't see.`;
    wanted.length = BUILD_FILE_LIMIT;
  }
  const root = path.resolve(codebaseRoot);
  const files: BuildFile[] = [];
  for (const file of wanted) {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(root + path.sep)) continue;
    try {
      if ((await stat(abs)).size > BUILD_FILE_MAX_BYTES) continue;
      files.push({ file, text: await readFile(abs, "utf-8") });
    } catch {
      // Deleted in the range, or unreadable: nothing to search.
    }
  }
  return { files, ...(note ? { note } : {}) };
}
