/**
 * Pairing planned elements with the built elements they became (`matchPlannedElements`).
 *
 * One function, so everything that compares a plan with a build pairs the same way: changeset_verify
 * today, and codebase_extract's plan coverage (#1323) once it uses it. A planned element is paired
 * with at most one built element, tier by tier, the surest tier first:
 *
 * 1. the same id: exact;
 * 2. the same layer and type, and a source file and symbol both sides name: exact (#1318, #1348). A
 *    source reference the plan carries, adopted by hand or confirmed in the code, is evidence enough
 *    that this is the element, whatever the plan and the code call it;
 * 3. the same layer and type, and the same name ignoring case and separators: probable;
 * 4. the same layer and name, built as another type: probable;
 * 5. the same file and symbol, built as another type: probable;
 * 6. the same layer and type, and a shared source file: probable. When several elements share the
 *    file, the one whose description and name are most like the plan's is taken if it stands alone
 *    (#1348);
 * 7. the same layer and type, and a similar description, when the plan names no source file at all:
 *    probable.
 *
 * Tiers 3 to 7 give a probable match: the caller reports why, and the agent confirms it. A built
 * element that cannot be the build of a planned add (it existed before the plan) is never taken.
 */

import type { BuiltSide, MatchKind, Plan, PlannedElementChange, VerifyElement } from "./changeset-verify.js";
import type { SourceLocation } from "../types/source-reference.js";

/** What a planned element was paired with. */
export interface ElementPairing {
  built: string;
  match: MatchKind;
  /** Why a probable match was made. */
  reason?: string;
  /**
   * Paired by the source symbol the plan and the build both name (not by name): the planned name
   * against the built symbol's name says nothing about whether it is the same element.
   */
  bySource?: boolean;
}

export interface ElementMatching {
  /** Planned element id → what it was paired with. */
  pairs: Map<string, ElementPairing>;
  /** Planned element id → the built ids that each could be it, when no tier picked one. */
  ambiguous: Map<string, string[]>;
  /**
   * No base index was recorded for the plan, so the elements that existed before it are not known
   * exactly (see Plan.baseElementIds): unchanged elements unrelated to the plan were set aside.
   */
  baseUnknown: boolean;
  /**
   * Planned adds whose id is in the built world but not among what the build changed: they were
   * already in the base (a plan applied before its build). They are not paired with themselves; they
   * were looked for among the build's changed elements, and are listed here whether or not one was found.
   */
  alreadyInBase: Set<string>;
}

export interface MatchingOptions {
  /** Pair by shared source file, with or without the symbol (default true). */
  matchBySource?: boolean;
}

// ---------------------------------------------------------------------------
// Names, types, source locations
// ---------------------------------------------------------------------------

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function idNameSegment(id: string): string | undefined {
  const parts = id.split(".");
  return parts.length >= 3 ? parts.slice(2).join(".") : undefined;
}

export function nameKeys(element: VerifyElement): Set<string> {
  const keys = new Set<string>();
  if (element.name) keys.add(normalizeName(element.name));
  const segment = idNameSegment(element.id);
  if (segment) keys.add(normalizeName(segment));
  keys.delete("");
  return keys;
}

export function namesMatch(a: VerifyElement, b: VerifyElement): boolean {
  const keys = nameKeys(b);
  for (const key of nameKeys(a)) if (keys.has(key)) return true;
  return false;
}

export function sameType(a: VerifyElement, b: VerifyElement): boolean {
  return normalizeName(a.type) === normalizeName(b.type);
}

const cleanFile = (file: unknown): string => (typeof file === "string" ? file.replace(/^\.\//, "").replace(/\\/g, "/") : "");

export function sourceFiles(element: VerifyElement): string[] {
  return (element.sourceReference?.locations ?? []).map((l) => cleanFile(l?.file)).filter((f) => f.length > 0);
}

export function sharedSourceFiles(a: VerifyElement, b: VerifyElement): string[] {
  const files = new Set(sourceFiles(b));
  return sourceFiles(a).filter((f) => files.has(f));
}

export function sharesSourceFile(a: VerifyElement, b: VerifyElement): boolean {
  return sharedSourceFiles(a, b).length > 0;
}

/** The `file#symbol` locations both elements name (both carry the symbol, and it is the same). */
export function sharedSourceSymbols(a: VerifyElement, b: VerifyElement): string[] {
  const keyed = (element: VerifyElement) =>
    (element.sourceReference?.locations ?? [])
      .filter((l: SourceLocation | undefined): l is SourceLocation => !!l && cleanFile(l.file).length > 0 && !!l.symbol?.trim())
      .map((l) => `${cleanFile(l.file)}#${l.symbol!.trim()}`);
  const theirs = new Set(keyed(b));
  return [...new Set(keyed(a))].filter((k) => theirs.has(k));
}

// ---------------------------------------------------------------------------
// Description similarity
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "are", "its", "has", "have", "not", "can", "any", "all", "when", "which", "each"]);

function wordsOf(text: string | undefined): Set<string> {
  return new Set(
    (text ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** How alike a planned and a built element read: their descriptions, and what their names say. */
function likeness(planned: VerifyElement, candidate: VerifyElement): number {
  return (
    jaccard(wordsOf(planned.description), wordsOf(candidate.description)) +
    0.5 * jaccard(wordsOf(`${planned.name} ${idNameSegment(planned.id) ?? ""}`), wordsOf(`${candidate.name} ${idNameSegment(candidate.id) ?? ""}`))
  );
}

/** A description this alike a planned element's, with no file to go by, makes a built element a probable match. */
const DESCRIPTION_MATCH = 0.5;
/** Among elements sharing a file, the likeness that must be reached for one to be picked over the rest. */
const FILE_PICK_MIN = 0.15;

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

interface Tier {
  test: (planned: VerifyElement, candidate: VerifyElement) => boolean;
  reason: (planned: VerifyElement, candidate: VerifyElement) => string;
  match: MatchKind;
  bySource?: boolean;
  /** Several candidates: pick the one most like the plan's, when it stands clearly ahead. */
  rank?: (planned: VerifyElement, candidate: VerifyElement) => number;
  minRank?: number;
}

export function matchPlannedElements(plan: Plan, built: BuiltSide, options: MatchingOptions = {}): ElementMatching {
  const matchBySource = options.matchBySource ?? true;
  const builtById = new Map(built.elements.map((e) => [e.id, e]));
  const changedIds = new Set((built.changedElements ?? []).map((e) => e.id));
  const claimed = new Set<string>();
  const pairs = new Map<string, ElementPairing>();
  const ambiguous = new Map<string, string[]>();

  const live = plan.elements.filter((e) => e.op !== "delete");
  // Against an as-built changeset (what the build changed is known), a planned add that is already in
  // the base unchanged would match itself: the plan was applied before it was built. That says nothing
  // about the build, so it is matched among the build's changed elements instead (#1307).
  const alreadyInBase = new Set<string>();
  for (const planned of live) {
    if (!builtById.has(planned.id)) continue;
    claimed.add(planned.id);
    if (planned.op === "add" && built.changedElements && !changedIds.has(planned.id)) {
      alreadyInBase.add(planned.id);
      continue;
    }
    pairs.set(planned.id, { built: planned.id, match: "exact" });
  }
  const pending = live.filter((e) => !pairs.has(e.id));

  const tiers: Tier[] = [];
  if (matchBySource) {
    tiers.push({
      test: (p, c) => p.layer === c.layer && sameType(p, c) && sharedSourceSymbols(p, c).length > 0,
      reason: (p, c) => `same source file and symbol (${sharedSourceSymbols(p, c).join(", ")})`,
      match: "exact",
      bySource: true,
    });
  }
  tiers.push(
    {
      test: (p, c) => p.layer === c.layer && sameType(p, c) && namesMatch(p, c),
      reason: (p, c) => `same layer and type, name matches ignoring case and separators ("${p.name}" ~ "${c.name}")`,
      match: "probable",
    },
    {
      test: (p, c) => p.layer === c.layer && !sameType(p, c) && namesMatch(p, c),
      reason: (p, c) => `same layer and name, but built as ${c.type} instead of ${p.type}`,
      match: "probable",
    }
  );
  if (matchBySource) {
    tiers.push(
      {
        test: (p, c) => p.layer === c.layer && !sameType(p, c) && sharedSourceSymbols(p, c).length > 0,
        reason: (p, c) => `same source file and symbol (${sharedSourceSymbols(p, c).join(", ")}), but built as ${c.type} instead of ${p.type}`,
        match: "probable",
        bySource: true,
      },
      {
        test: (p, c) => p.layer === c.layer && sameType(p, c) && sharesSourceFile(p, c),
        reason: (p, c) => `same layer and type, shares source file ${sharedSourceFiles(p, c).join(", ")}`,
        match: "probable",
        rank: likeness,
        minRank: FILE_PICK_MIN,
      }
    );
  }
  tiers.push({
    test: (p, c) =>
      p.layer === c.layer && sameType(p, c) && sourceFiles(p).length === 0 && jaccard(wordsOf(p.description), wordsOf(c.description)) >= DESCRIPTION_MATCH,
    reason: (_p, c) =>
      `same layer and type, and the description reads alike ("${(c.description ?? "").slice(0, 60)}${(c.description ?? "").length > 60 ? "…" : ""}")`,
    match: "probable",
    rank: likeness,
    minRank: DESCRIPTION_MATCH,
  });

  // A planned add cannot have been built as an element that existed before the plan. With the plan's
  // base index that is exact; without one, an unchanged element with no relationship to the plan's
  // elements is taken to predate it.
  const baseIds = plan.baseElementIds ? new Set(plan.baseElementIds) : undefined;
  const builtNeighbors = new Map<string, Set<string>>();
  for (const rel of built.relationships) {
    for (const [a, b] of [
      [rel.source, rel.target],
      [rel.target, rel.source],
    ]) {
      const set = builtNeighbors.get(a) ?? new Set<string>();
      set.add(b);
      builtNeighbors.set(a, set);
    }
  }
  const planTouched = new Set<string>([...plan.elements.map((e) => e.id), ...plan.relationships.flatMap((r) => [r.source, r.target])]);
  const neighborCache = new Map<string, Set<string>>();
  const plannedNeighbors = (id: string): Set<string> => {
    const cached = neighborCache.get(id);
    if (cached) return cached;
    const own = plan.relationships
      .filter((r) => r.op === "add" && (r.source === id || r.target === id))
      .map((r) => (r.source === id ? r.target : r.source));
    const ids = own.length > 0 ? own : [...planTouched].filter((other) => other !== id);
    const near = new Set(ids.flatMap((other) => [other, pairs.get(other)?.built ?? other]));
    neighborCache.set(id, near);
    return near;
  };
  let baseUnknown = false;
  const canBeBuildOf = (planned: PlannedElementChange, candidate: VerifyElement): boolean => {
    if (planned.op !== "add") return true;
    if (baseIds) return !baseIds.has(candidate.id);
    if (changedIds.has(candidate.id)) return true;
    baseUnknown = true;
    const near = plannedNeighbors(planned.id);
    for (const other of builtNeighbors.get(candidate.id) ?? []) if (near.has(other)) return true;
    return false;
  };

  for (const tier of tiers) {
    for (const planned of pending) {
      if (pairs.has(planned.id)) continue;
      const candidates = built.elements.filter(
        (c) =>
          !claimed.has(c.id) &&
          (!alreadyInBase.has(planned.id) || changedIds.has(c.id)) &&
          tier.test(planned, c) &&
          canBeBuildOf(planned, c)
      );
      if (candidates.length === 0) continue;
      let chosen = candidates;
      if (chosen.length > 1 && changedIds.size > 0) {
        const changed = chosen.filter((c) => changedIds.has(c.id));
        if (changed.length > 0) chosen = changed;
      }
      if (chosen.length > 1 && tier.rank) {
        const scored = chosen.map((c) => ({ c, score: tier.rank!(planned, c) })).sort((a, b) => b.score - a.score);
        if (scored[0].score >= (tier.minRank ?? 0) && scored[0].score > scored[1].score) chosen = [scored[0].c];
      }
      if (chosen.length === 1) {
        const candidate = chosen[0];
        claimed.add(candidate.id);
        // A file and symbol that other planned elements name too does not tell which of them this
        // built element is: the pair is offered as probable, never exact.
        const sharers =
          tier.match === "exact"
            ? pending.filter((o) => o.id !== planned.id && !pairs.has(o.id) && o.layer === planned.layer && sameType(o, planned) && sharedSourceSymbols(o, candidate).length > 0)
            : [];
        const shared = sharers.length > 0;
        pairs.set(planned.id, {
          built: candidate.id,
          match: shared ? "probable" : tier.match,
          reason: shared
            ? `${tier.reason(planned, candidate)}, but ${sharers.map((o) => o.id).join(", ")} name${sharers.length === 1 ? "s" : ""} it too: confirm which is which`
            : tier.reason(planned, candidate),
          ...(tier.bySource ? { bySource: true } : {}),
        });
        ambiguous.delete(planned.id);
      } else if (!ambiguous.has(planned.id)) {
        ambiguous.set(
          planned.id,
          chosen.map((c) => c.id)
        );
      }
    }
  }
  return { pairs, ambiguous, baseUnknown, alreadyInBase };
}
