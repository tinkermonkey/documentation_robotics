/**
 * What a JavaScript or TypeScript declaration is, read from its own text: exported, a React hook, a
 * React component. Tier-0 rules match on these (`when.shape`, src/analyzers/tier0-rules.ts), so a
 * rule can say "an exported component" without a regular expression over source.
 *
 * Read from the declaration and, for a component, the source's first lines: codebase-memory-mcp
 * labels `export const Box = React.forwardRef(...)` a Variable, a function a Function, and reports
 * every TypeScript symbol as exported, so neither label nor `is_exported` says what it is.
 */
import { declarationOf } from "../tier0-rules.js";

export type CardShape = "exported" | "react-hook" | "react-component";

type ShapeCard = { label: string; name: string; file_path: string | null; source: string | null; signature?: string | null };

const JS = /\.[cm]?[jt]sx?$/i;
const JSX_FILE = /\.[jt]sx$/i;
/** A hook or component is a function or a const holding one; a class component is a class's job. */
const UNIT_LABELS: ReadonlySet<string> = new Set(["Function", "Variable"]);
/** The initializer wraps a component: `forwardRef(...)`, `React.memo(...)`, `memo(forwardRef(...))`. */
const COMPONENT_WRAPPER = /=\s*(?:React\.)?(?:forwardRef|memo)\b\s*[<(]/;
/** A JSX element or a createElement call in the source. */
const RENDERS = /<[A-Za-z][\w.]*(?:\s[^<>]*)?\/?>|<>|\bcreateElement\s*\(/;
/** A primitive literal initializer: `export const LIMIT = 5` is a value, not a unit of the design. */
const PRIMITIVE_CONST = /=\s*(?:-?\d[\d_.eE+-]*n?|"[^"]*"|'[^']*'|`[^`$]*`|true|false|null|undefined)\s*(?:as\s+const\s*)?;?\s*$/;

/** The shapes a JS/TS declaration has, [] for other languages. */
export function shapesOf(card: ShapeCard): CardShape[] {
  if (!card.file_path || !JS.test(card.file_path)) return [];
  const declaration = (declarationOf(card.source, card.signature) ?? "").trim();
  if (!/^export\b/.test(declaration)) return [];
  const shapes: CardShape[] = ["exported"];
  if (!UNIT_LABELS.has(card.label)) return shapes;
  if (/^use[A-Z0-9]/.test(card.name)) shapes.push("react-hook");
  else if (/^[A-Z]/.test(card.name)) {
    if (COMPONENT_WRAPPER.test(declaration) || (JSX_FILE.test(card.file_path) && RENDERS.test(card.source ?? ""))) shapes.push("react-component");
  }
  return shapes;
}

/**
 * Whether a Variable card is worth a card: exported from its file and not a primitive constant.
 * (Every Variable the graph holds is a candidate otherwise: every module-level const.)
 */
export function isDeclaredVariable(card: ShapeCard): boolean {
  if (card.label !== "Variable") return true;
  if (!card.file_path || !JS.test(card.file_path)) return false;
  const declaration = (declarationOf(card.source, card.signature) ?? "").trim();
  return /^export\b/.test(declaration) && !PRIMITIVE_CONST.test(declaration);
}
