/**
 * The call-edge evidence gate: whether a CBM `CALLS` edge is trustworthy enough to become a DR
 * relationship, from the evidence codebase-memory-mcp records on the edge.
 *
 * CBM resolves a call expression to a definition by one of several strategies and stores the
 * strategy, a confidence and the number of candidate definitions on every `CALLS` edge
 * (`{"callee":"radiusOf","strategy":"suffix_match","confidence":0.28,"candidates":3}`); functions
 * and methods carry an `importance` (weighted degree). `trace_path` with `include_evidence` shows
 * the same confidence with the strategy coarsened to `lsp` / `heuristic`, one call per function, so
 * extraction reads the edge properties in its existing bulk edge query instead: no extra calls.
 *
 * Measured on four indexes (docs/analyzers/CBM_MAPPING_INVENTORY.md, "Call-edge evidence"), edges
 * at confidence 0.5 or more (LSP, import-map, same-module, unique-name 0.75 and suffix 0.55
 * resolutions) are almost always right; below it (unique-name 0.38, suffix matches at 0.41 and
 * under) about half are a name matched to the wrong definition: a callback parameter (`fn`,
 * `radiusOf`, `onSelect`), a library function with a project namesake (`writeFile`, `useState`,
 * yaml's `parse`), a field (`view().name` on an entity's `name`). A low-confidence edge is kept
 * only when something corroborates it:
 *
 *   unique-member  the callee is called on a receiver (`owner.getPet`, `crud.authenticate`) and its
 *                  name is unique in the project (strategy unique_name, one candidate);
 *   own-member     `this.m()` (or Python's `self.m()`) resolved to a method in the caller's own file;
 *   imported       a bare call (`initX()`) whose name the caller's file imports statically from
 *                  the callee's file, or from an index module (`index.ts`, `__init__.py`) of a
 *                  directory the callee's file is in.
 *
 * A low-confidence edge whose callee has no `importance` is never kept: CBM sets importance on
 * functions, methods and classes, so its absence means the call landed on a field or a variable.
 * An edge with no evidence (route registrations, older indexes) is kept as before.
 */
import type { AnalyzerHeuristic } from "./types.js";

/** The heuristic in extraction-heuristics.json that configures the gate. */
export const CALL_GATE_HEURISTIC = "call_edge_evidence";

export interface CallGate {
  /** Edges of these CBM types are gated (default `["CALLS"]`). */
  edges: string[];
  /** At or above this confidence an edge is kept without corroboration. */
  minConfidence: number;
}

/** What CBM records about one call edge, and what the caller's file imports. */
export interface CallEvidence {
  /** Resolution strategy (`lsp_type_dispatch`, `import_map`, `unique_name`, `suffix_match`, ...). */
  strategy?: string;
  /** Resolution confidence, 0 to 1. */
  confidence?: number;
  /** How many definitions the callee's name matched. */
  candidates?: number;
  /** The call expression's callee as written (`owner.getPet`, `this.load`, `writeFile`). */
  callee?: string;
  /** The callee's `importance`; undefined when CBM sets none (a field or a variable). */
  calleeImportance?: number;
  /** The files of the caller and of the callee definition. */
  callerFile?: string | null;
  calleeFile?: string | null;
  /** Files the caller's file statically imports the bare callee name from. */
  importedFrom?: string[];
}

export type CallVerdictReason = "no-evidence" | "confident" | "unique-member" | "own-member" | "imported" | "not-callable" | "uncorroborated";

export interface CallVerdict {
  keep: boolean;
  reason: CallVerdictReason;
}

export const DEFAULT_CALL_GATE: CallGate = Object.freeze({ edges: ["CALLS"], minConfidence: 0.5 }) as CallGate;

/** The gate an analyzer's heuristics configure, or null when it has no `call_edge_evidence` heuristic. */
export function callGateFrom(heuristics: AnalyzerHeuristic[]): CallGate | null {
  const h = heuristics.find((x) => x.name === CALL_GATE_HEURISTIC);
  if (!h) return null;
  const p = (h.parameters ?? {}) as Record<string, unknown>;
  const min = p.min_confidence ?? DEFAULT_CALL_GATE.minConfidence;
  if (typeof min !== "number" || min < 0 || min > 1) throw new Error(`${CALL_GATE_HEURISTIC}: min_confidence must be a number from 0 to 1`);
  const edges = p.edges ?? DEFAULT_CALL_GATE.edges;
  if (!Array.isArray(edges) || !edges.length || !edges.every((e) => typeof e === "string")) {
    throw new Error(`${CALL_GATE_HEURISTIC}: edges must be a non-empty list of CBM edge types`);
  }
  return { edges: edges as string[], minConfidence: min };
}

/** Whether `imported` (a file a name is imported from) is `calleeFile` or an index module of a directory holding it. */
function importReaches(imported: string, calleeFile: string): boolean {
  if (imported === calleeFile) return true;
  const slash = imported.lastIndexOf("/");
  const dir = slash >= 0 ? imported.slice(0, slash) : "";
  const stem = imported.slice(slash + 1).split(".")[0];
  if (stem !== "index" && stem !== "__init__") return false;
  return dir === "" || calleeFile.startsWith(`${dir}/`);
}

/** The bare name a callee expression imports by: `writeFile` for `writeFile`, none for `a.b`. */
export function bareCallee(callee: string | undefined): string | null {
  return callee && /^[\w$]+$/.test(callee) ? callee : null;
}

/** Keep or drop one call edge, and why. */
export function callEdgeVerdict(e: CallEvidence, gate: CallGate = DEFAULT_CALL_GATE): CallVerdict {
  if (e.confidence === undefined || !Number.isFinite(e.confidence)) return { keep: true, reason: "no-evidence" };
  if (e.confidence >= gate.minConfidence) return { keep: true, reason: "confident" };
  if (e.calleeImportance === undefined) return { keep: false, reason: "not-callable" };
  const callee = e.callee ?? "";
  if (callee.includes(".") && e.strategy === "unique_name" && e.candidates === 1) return { keep: true, reason: "unique-member" };
  if (/^(this|self)\.[\w$]+$/.test(callee) && e.callerFile && e.callerFile === e.calleeFile) return { keep: true, reason: "own-member" };
  if (bareCallee(callee) && e.calleeFile && (e.importedFrom ?? []).some((f) => importReaches(f, e.calleeFile!))) {
    return { keep: true, reason: "imported" };
  }
  return { keep: false, reason: "uncorroborated" };
}
