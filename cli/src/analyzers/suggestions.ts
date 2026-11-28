/**
 * Suggested relationships and deletions, and how the agent accepts them (#1492).
 *
 * Extraction derives links from CBM edges (a call, a usage, a test file's name) and notices elements
 * whose code is gone. Neither is a rule about how to model the code: each is a suggestion with its
 * evidence, and nothing is staged until the agent decides. The agent accepts suggestions in bulk, as
 * its own decision, by what they rest on (the edge, the predicate, the files, the resolution
 * confidence), so a bootstrap's relationship pass is a few calls and not thousands.
 */
import { minimatch } from "minimatch";
import type { CandidateDelete, PlannedRelationship } from "./extraction-plan.js";

/** What the agent accepts, as the `acceptLinks` items say it. */
export interface AcceptLinkItem {
  edge?: string | string[];
  predicate?: string | string[];
  files?: string | string[];
  source?: string;
  target?: string;
  minConfidence?: number;
  keys?: string[];
  all?: true;
}

export interface AcceptDeleteItem {
  evidence?: string | string[];
  files?: string | string[];
  ids?: string[];
  all?: true;
}

const list = (v: string | string[] | undefined): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/** A suggested relationship's key, as a staged relationship's elementId spells it. */
export function linkKey(r: { source: string; predicate: string; target: string }): string {
  return `${r.source}::${r.predicate}::${r.target}`;
}

/** The CBM edge a suggestion rests on (`CALLS`, `TEST_FILE_NAME`), as `edge:` evidence names it. */
export function linkEdge(r: PlannedRelationship): string {
  return r.evidence?.kind.replace(/^edge:/, "") ?? r.edge;
}

/** Whether a file is named by a path, a folder or a glob (relative to the codebase root). */
export function fileMatches(file: string, patterns: string[]): boolean {
  const f = file.replace(/\\/g, "/");
  return patterns.some((p) => {
    const pat = p.replace(/\\/g, "/").replace(/^\.\//, "");
    return f === pat || f.startsWith(pat.endsWith("/") ? pat : `${pat}/`) || minimatch(f, pat, { dot: true });
  });
}

/** The files a suggested link rests on: its call sites' callers' (a test's file for a tests link). */
export function linkFiles(r: PlannedRelationship): string[] {
  return [...new Set((r.evidence?.sites ?? []).map((s) => s.fromFile).filter((f): f is string => !!f))];
}

/** Every condition of an item must hold; an item with none matches nothing (`all: true` is the explicit "every one"). */
function linkMatches(item: AcceptLinkItem, r: PlannedRelationship): boolean {
  if (item.all) return true;
  let conditions = 0;
  const check = (given: boolean, holds: () => boolean): boolean => {
    if (!given) return true;
    conditions++;
    return holds();
  };
  const edges = list(item.edge);
  const predicates = list(item.predicate);
  const files = list(item.files);
  return (
    check(!!edges, () => edges!.includes(linkEdge(r))) &&
    check(!!predicates, () => predicates!.includes(r.predicate)) &&
    check(!!files, () => linkFiles(r).some((f) => fileMatches(f, files!))) &&
    check(item.source !== undefined, () => r.source === item.source) &&
    check(item.target !== undefined, () => r.target === item.target) &&
    check(item.minConfidence !== undefined, () => r.evidence?.confidence !== undefined && r.evidence.confidence >= item.minConfidence!) &&
    check(!!item.keys, () => item.keys!.includes(linkKey(r))) &&
    conditions > 0
  );
}

/** The suggested links the items accept, and the items that matched none (so the agent hears about a mistyped one). */
export function acceptedLinks(
  items: readonly AcceptLinkItem[],
  suggested: readonly PlannedRelationship[]
): { accepted: PlannedRelationship[]; matched: number[]; unmatched: number[]; empty: number[] } {
  const accepted = new Map<string, PlannedRelationship>();
  const matched = items.map(() => 0);
  const empty: number[] = [];
  items.forEach((item, i) => {
    if (!item.all && !item.edge && !item.predicate && !item.files && item.source === undefined && item.target === undefined && item.minConfidence === undefined && !item.keys) {
      empty.push(i);
      return;
    }
    for (const r of suggested) {
      if (!linkMatches(item, r)) continue;
      matched[i]++;
      accepted.set(linkKey(r), r);
    }
  });
  return { accepted: [...accepted.values()], matched, unmatched: matched.flatMap((n, i) => (n === 0 && !empty.includes(i) ? [i] : [])), empty };
}

function deleteMatches(item: AcceptDeleteItem, d: CandidateDelete): boolean {
  if (item.all) return true;
  const evidence = list(item.evidence);
  const files = list(item.files);
  const given = !!evidence || !!files || !!item.ids;
  return given && (!evidence || evidence.includes(d.evidence)) && (!files || fileMatches(d.file, files)) && (!item.ids || item.ids.includes(d.id));
}

/** The suggested deletes the items accept. */
export function acceptedDeletes(
  items: readonly AcceptDeleteItem[],
  suggested: readonly CandidateDelete[]
): { accepted: CandidateDelete[]; matched: number[]; unmatched: number[]; empty: number[] } {
  const accepted = new Map<string, CandidateDelete>();
  const matched = items.map(() => 0);
  const empty: number[] = [];
  items.forEach((item, i) => {
    if (!item.all && !item.evidence && !item.files && !item.ids) {
      empty.push(i);
      return;
    }
    for (const d of suggested) {
      if (!deleteMatches(item, d)) continue;
      matched[i]++;
      accepted.set(d.id, d);
    }
  });
  return { accepted: [...accepted.values()], matched, unmatched: matched.flatMap((n, i) => (n === 0 && !empty.includes(i) ? [i] : [])), empty };
}

/** How many suggestions rest on each value (`CALLS` 412, `TEST_FILE_NAME` 9), most first. */
export function tally<T>(items: readonly T[], by: (item: T) => string): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(by(i), (counts.get(by(i)) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
