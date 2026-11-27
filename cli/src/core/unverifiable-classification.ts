/**
 * Why a planned element changeset_verify couldn't pair with a built one is unverifiable, not
 * missing (#1371, #1374, #1351, #1319).
 *
 * "Missing" means the code isn't there. Four cases leave an unpaired planned element that the
 * tools can't judge either way, so they go on the unverifiable list with a reason, for the agent
 * to check by reading the code. None counts toward the verdict:
 *
 * - `exists-unchanged`: a planned add whose source reference names a file and symbol the code
 *   declares. The code is there; the range didn't change it, so extraction staged no card (#1371);
 * - `no-source-reference`: a planned delete of an element with no source reference. Extraction
 *   can't tell whether it still exists (#1374);
 * - `file-collection`: a planned data-store collection that is not a table: extraction reads
 *   collections from SQL tables and entity classes, never from a file the code reads and writes
 *   (#1351);
 * - `unindexed-language`: a planned element sourced to files in a language the code index doesn't
 *   read (shell scripts). The agent extracts, models and verifies them by reading the code (#1319).
 *
 * The evidence is the file's text, not the code graph: the index is an aid, and where it can't
 * see, the agent does the work.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { codeChangesSince } from "../analyzers/code-changes.js";
import type { SourceReference } from "../types/source-reference.js";

/** A planned element, as far as the classification reads it. */
export interface UnseenCandidate {
  id: string;
  layer: string;
  type: string;
  op: "add" | "update" | "delete";
  attributes?: Record<string, unknown>;
  sourceReference?: SourceReference;
}

export type UnseenKind = "exists-unchanged" | "no-source-reference" | "file-collection" | "unindexed-language";

export interface UnseenClassification {
  kind: UnseenKind;
  reason: string;
}

export interface UnseenResult {
  /** By planned element id. */
  byId: Map<string, UnseenClassification>;
  /** Planned or changed files in a language the code index doesn't read, sorted. */
  unindexedFiles: string[];
  /** Set when the changed files could not be listed. */
  note?: string;
}

/** Languages the code index doesn't read, by extension: shell and batch scripts. */
const UNINDEXED_LANGUAGES: Record<string, string> = {
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  fish: "shell",
  ps1: "PowerShell",
  psm1: "PowerShell",
  bat: "batch",
  cmd: "batch",
};

/** What the agent is told for every element or file in such a language. */
export const UNINDEXED_INSTRUCTION =
  "the code index doesn't read this language, so extraction and verify can't see it: extract, model and verify it by reading the code";

/** The language of a file the index doesn't read, or undefined. */
export function unindexedLanguage(file: string): string | undefined {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1]?.toLowerCase();
  return ext ? UNINDEXED_LANGUAGES[ext] : undefined;
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function locationsOf(element: UnseenCandidate): Array<{ file: string; symbol?: string }> {
  return (element.sourceReference?.locations ?? [])
    .filter((l) => typeof l?.file === "string" && l.file.length > 0)
    .map((l) => ({ file: normalize(l.file), ...(l.symbol ? { symbol: l.symbol } : {}) }));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MODIFIERS = "public|private|protected|static|async|export|override|readonly|final|abstract|get|set|pub";

/** Lines of `text` that are not comments (a crude cut: line comments and the middle of block comments). */
function codeLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|#(?!!)|\*|\/\*|--)/.test(line))
    .join("\n");
}

/**
 * Whether `text` declares `symbol` (its last dotted segment): after a declaration keyword, with a
 * modifier, or as a method or function header (parameters, then `{` or `:` at the line's end). A call,
 * an assignment, a mention in a comment doesn't count; for a dotted symbol the owner must appear too.
 */
export function declaresSymbol(text: string, symbol: string): boolean {
  const parts = symbol.split(/[.#:]/).filter(Boolean);
  const name = parts.pop();
  if (!name || !/^[\w$]+$/.test(name)) return false;
  const code = codeLines(text);
  const owner = parts.pop();
  if (owner && !new RegExp(`\\b${escapeRegExp(owner)}\\b`).test(code)) return false;
  const n = escapeRegExp(name);
  const keyword = new RegExp(
    `\\b(?:def|function\\*?|class|interface|type|enum|struct|trait|fn|func|const|let|var|val|object|record|namespace|module|impl|protocol|data)\\s+${n}\\b`
  );
  const modified = new RegExp(`^[ \\t]*(?:(?:${MODIFIERS})\\s+)+${n}\\s*[(<=:]`, "m");
  const header = new RegExp(`^[ \\t]*${n}\\s*(?:<[^>\\n]*>)?\\([^;\\n]*\\)\\s*(?::[^;={\\n]*)?\\{\\s*$`, "m");
  return keyword.test(code) || modified.test(code) || header.test(code);
}

async function readInside(root: string, file: string): Promise<string | undefined> {
  if (/^(?:[A-Za-z]:)?[\\/]/.test(file)) return undefined;
  const abs = path.resolve(root, file);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return undefined;
  try {
    return await readFile(abs, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Classifies the planned elements verify may not be able to pair. `builtIds` are the ids of the
 * built side: a planned add already built is paired by id and never asked about. Without `since`
 * (the range the build was extracted from) nothing is said to exist unchanged in it.
 */
export async function classifyUnseenElements(
  plan: UnseenCandidate[],
  context: { codebaseRoot: string; since?: string; builtIds: ReadonlySet<string> }
): Promise<UnseenResult> {
  const byId = new Map<string, UnseenClassification>();
  const unindexed = new Set<string>();
  let note: string | undefined;

  let changes: Awaited<ReturnType<typeof codeChangesSince>> | undefined;
  if (context.since) {
    try {
      changes = await codeChangesSince(context.codebaseRoot, context.since);
    } catch (error) {
      note = `The files changed since ${context.since} could not be listed (${error instanceof Error ? error.message : String(error)}), so code that exists unchanged in the range and the changed files the code index doesn't read are not reported.`;
    }
  }
  const texts = new Map<string, string | undefined>();
  const textOf = async (file: string) => {
    if (!texts.has(file)) texts.set(file, await readInside(context.codebaseRoot, file));
    return texts.get(file);
  };
  /** Whether the symbol was declared in the file before the range, or the range left the file alone. */
  const unchangedInRange = (file: string, symbol: string, text: string): boolean => {
    if (!changes) return false;
    if (!changes.changed.has(file)) return declaresSymbol(text, symbol);
    const before = changes.fileAtBase?.(file);
    return typeof before === "string" && declaresSymbol(before, symbol);
  };

  for (const element of plan) {
    if (element.op === "update") continue;
    if (element.op === "add" && context.builtIds.has(element.id)) continue;
    if (element.op === "delete" && !context.builtIds.has(element.id)) continue;
    const locations = locationsOf(element);

    // Files in a language the index doesn't read, that exist: only those are on the list. One that
    // isn't there is not "unseen", it is absent, and the element stays missing.
    const shell = locations.filter((l) => unindexedLanguage(l.file));
    if (shell.length > 0 && shell.length === locations.length) {
      const present = [];
      for (const l of shell) if ((await textOf(l.file)) !== undefined) present.push(l);
      for (const l of present) unindexed.add(l.file);
      if (present.length > 0 || element.op === "delete") {
        const languages = [...new Set(shell.map((l) => unindexedLanguage(l.file)))];
        byId.set(element.id, { kind: "unindexed-language", reason: `its source files are in ${languages.join("/")}: ${UNINDEXED_INSTRUCTION}` });
        continue;
      }
    }

    if (element.op === "delete") {
      if (locations.length === 0) {
        byId.set(element.id, {
          kind: "no-source-reference",
          reason: "no source reference: extraction can't tell whether it still exists. Check in the code that what it stood for is gone",
        });
      }
      continue;
    }

    // A planned add that was not built. The code is there only when the range left the symbol
    // alone: one it wrote that extraction staged no card for is a failure to see, not code that existed.
    for (const l of locations) {
      if (!l.symbol) continue;
      const text = await textOf(l.file);
      if (text !== undefined && unchangedInRange(l.file, l.symbol, text)) {
        byId.set(element.id, {
          kind: "exists-unchanged",
          reason:
            `exists, unchanged in the range: ${l.file} declares ${l.symbol}, and it did before the range, so extraction staged no ` +
            "card for it. The code is there: check that the element describes it",
        });
        break;
      }
    }
    if (byId.has(element.id)) continue;

    const collectionType = String(element.attributes?.collectionType ?? "").toUpperCase();
    if (element.layer === "data-store" && element.type === "collection" && collectionType && collectionType !== "TABLE") {
      if (!locations.some((l) => /\.(sql|prisma)$/i.test(l.file))) {
        byId.set(element.id, {
          kind: "file-collection",
          reason:
            `a collection that is not a table (${collectionType}), a file say: extraction reads collections from SQL tables and entity ` +
            "classes, so it can't see this one. Check in the code that something reads or writes it; give it the source file and symbol " +
            "that owns its path and verify matches it there",
        });
      }
    }
  }

  const changedUnindexed = changes ? [...changes.changed].filter((f) => unindexedLanguage(f)) : [];
  const unindexedFiles = [...new Set([...unindexed, ...changedUnindexed])].sort();
  return { byId, unindexedFiles, ...(note ? { note } : {}) };
}
