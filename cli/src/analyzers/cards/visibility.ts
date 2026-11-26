/**
 * What a card's declaration says about who can reach the symbol, and whether it is declared inside
 * another function. Project rules (src/analyzers/project-rules.ts) and the triage groups
 * (src/analyzers/triage.ts) decide on these: "a module-private function is not an element" is the
 * kind of rule a project states once.
 *
 * Read from the declaration, never from the index's `is_exported`: codebase-memory-mcp 0.12.1
 * reports every TypeScript symbol as exported.
 */
import { declarationOf } from "../tier0-rules.js";
import type { SymbolCard } from "./types.js";

/**
 * `exported` / `local`: a top-level declaration other files can, or cannot, import.
 * `public` / `private` / `protected`: a member, by its modifier (or its language's convention).
 */
export type Visibility = "exported" | "local" | "public" | "private" | "protected";

export interface TriageFacts {
  visibility?: Visibility;
  /** Declared inside another function or method (a closure, a local helper). */
  nested?: true;
}

type FactsCard = Pick<SymbolCard, "label" | "name" | "file_path" | "source" | "signature" | "start_line" | "end_line">;

const JS = /\.[cm]?[jt]sx?$/i;
const PY = /\.py$/i;
const GO = /\.go$/i;
const JVM = /\.(java|kt|kts|cs|scala)$/i;

/** Labels that are members of a class: their visibility is a modifier, not an export. */
const MEMBER_LABELS: ReadonlySet<string> = new Set(["Method"]);
/** Labels a source file declares: the ones visibility is read for. */
const DECLARED_LABELS: ReadonlySet<string> = new Set(["Function", "Method", "Class", "Interface", "Type", "Enum", "Trait", "Struct", "Variable"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a JS/TS file exports a name apart from its declaration: `export { a, b as c }`,
 * `export default name`, `module.exports = name` or `exports.name = ...`.
 */
export function exportedElsewhere(fileText: string, name: string): boolean {
  const n = escapeRegExp(name);
  return (
    new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*(?:^|[\\s,{])${n}(?:\\s+as\\s+[\\w$]+)?\\s*(?:,|\\})`, "m").test(fileText) ||
    new RegExp(`export\\s+default\\s+${n}\\b`).test(fileText) ||
    new RegExp(`module\\.exports\\s*=\\s*(?:\\{[^}]*\\b${n}\\b|${n}\\b)`).test(fileText) ||
    new RegExp(`(?:^|[^\\w$.])exports\\.${n}\\s*=`, "m").test(fileText)
  );
}

/**
 * A symbol's visibility from its declaration and its language's rules, or undefined when the
 * language or the label gives none. `fileText` (the whole file) settles a JS/TS declaration that
 * is exported on another line.
 */
export function visibilityOf(card: FactsCard, fileText?: string | null): Visibility | undefined {
  const file = card.file_path ?? "";
  if (!DECLARED_LABELS.has(card.label)) return undefined;
  const declaration = (declarationOf(card.source, card.signature) ?? "").trim();
  const member = MEMBER_LABELS.has(card.label);
  if (JS.test(file)) {
    if (member) {
      if (/^(?:(?:static|async|override|readonly|abstract)\s+)*private\b/.test(declaration) || /^(?:(?:static|async)\s+)*#/.test(declaration) || card.name.startsWith("#")) return "private";
      if (/^(?:(?:static|async|override|readonly|abstract)\s+)*protected\b/.test(declaration)) return "protected";
      return "public";
    }
    if (/^export\b/.test(declaration)) return "exported";
    return fileText && exportedElsewhere(fileText, card.name) ? "exported" : "local";
  }
  if (PY.test(file)) {
    const hidden = card.name.startsWith("_") && !/^__\w+__$/.test(card.name);
    return member ? (hidden ? "private" : "public") : hidden ? "local" : "exported";
  }
  if (GO.test(file)) {
    const upper = /^[A-Z]/.test(card.name);
    return member ? (upper ? "public" : "private") : upper ? "exported" : "local";
  }
  if (JVM.test(file)) {
    const isPrivate = /(^|\s)private\s/.test(declaration);
    const isProtected = /(^|\s)protected\s/.test(declaration);
    if (member) return isPrivate ? "private" : isProtected ? "protected" : "public";
    return isPrivate ? "local" : "exported";
  }
  return undefined;
}

/**
 * The cards declared inside another function or method of their file: a function whose lines lie
 * within another function's or method's lines. Returned as a set of the cards themselves.
 */
export function nestedCards<T extends FactsCard>(cards: readonly T[]): Set<T> {
  const byFile = new Map<string, T[]>();
  for (const c of cards) {
    if (!c.file_path || c.start_line === null || (c.label !== "Function" && c.label !== "Method")) continue;
    (byFile.get(c.file_path) ?? byFile.set(c.file_path, []).get(c.file_path)!).push(c);
  }
  const nested = new Set<T>();
  for (const list of byFile.values()) {
    for (const c of list) {
      if (c.label !== "Function") continue;
      const start = c.start_line!;
      const end = c.end_line ?? start;
      const inside = list.some((o) => {
        if (o === c) return false;
        const oStart = o.start_line!;
        const oEnd = o.end_line ?? oStart;
        return oStart <= start && oEnd >= end && (oStart < start || oEnd > end);
      });
      if (inside) nested.add(c);
    }
  }
  return nested;
}

/**
 * The triage facts of every card: visibility and nesting. `readFile` gives a file's text (relative
 * to the codebase root), or null when it can't be read; it is asked once per JS/TS file that has a
 * declaration with no `export` on its own line.
 */
export function cardFacts<T extends FactsCard>(cards: readonly T[], readFile?: (file: string) => string | null): Map<T, TriageFacts> {
  const nested = nestedCards(cards);
  const texts = new Map<string, string | null>();
  const textOf = (file: string): string | null => {
    if (!readFile) return null;
    if (!texts.has(file)) texts.set(file, readFile(file));
    return texts.get(file) ?? null;
  };
  const out = new Map<T, TriageFacts>();
  for (const c of cards) {
    let visibility = visibilityOf(c);
    // A JS/TS declaration with no export of its own may be exported on another line of its file.
    if (visibility === "local" && c.file_path && JS.test(c.file_path) && !nested.has(c)) {
      const text = textOf(c.file_path);
      if (text && exportedElsewhere(text, c.name)) visibility = "exported";
    }
    const facts: TriageFacts = { ...(visibility ? { visibility } : {}), ...(nested.has(c) ? { nested: true as const } : {}) };
    if (facts.visibility || facts.nested) out.set(c, facts);
  }
  return out;
}
