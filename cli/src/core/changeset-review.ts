/**
 * Changeset review — the reviewer's per-change verdicts (keep / drop / ask), where a changeset came
 * from, and what a staged delete would leave dangling.
 *
 * The verdicts are stored in `review.yaml` beside the changeset's `metadata.yaml` and `changes.yaml`
 * (written under the changeset's file lock by StagedChangesetStorage.updateReview). They are keyed
 * by sequence number, which a change keeps for life (see StagedChange.sequenceNumber). A decision
 * records the revision it was made at (`atRevision`, the changeset's `nextSequenceNumber` then), so
 * a later rewrite of the change (a `rewritten` tombstone with a higher `removedAt`) marks it stale.
 */

import type { Change, Changeset, StagedChange } from "./changeset.js";
import { nextSequenceNumber, sequenceOf } from "./changeset.js";
import type { ChangesetGraph } from "./changeset-graph.js";
import { relationshipKey } from "./changeset-graph.js";

/** The file the review is stored in, inside the changeset's directory. */
export const REVIEW_FILE = "review.yaml";

/**
 * Set in the environment of DrBot's processes (its `dr` commands and its dr MCP server) by
 * `dr visualize`, so a changeset DrBot creates records `origin.kind: chat`.
 */
export const CHANGESET_ORIGIN_ENV = "DR_CHANGESET_ORIGIN";

export const REVIEW_VERDICTS = ["keep", "drop", "ask"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface ReviewDecision {
  verdict: ReviewVerdict;
  note?: string;
  /** The changeset's revision (`nextSequenceNumber`) when the decision was made. */
  atRevision: number;
  /** ISO timestamp of the decision. */
  decidedAt: string;
}

export interface ChangesetReview {
  /** Keyed by sequence number, as a string. */
  decisions: Record<string, ReviewDecision>;
  /** The highest `atRevision` among the decisions; absent when there are none. */
  lastReviewedRevision?: number;
}

export const ORIGIN_KINDS = ["chat", "plan", "extract", "cli"] as const;
export type ChangesetOriginKind = (typeof ORIGIN_KINDS)[number];

export interface ChangesetOrigin {
  kind: ChangesetOriginKind;
  detail?: string;
}

/** One relationship that still names an element a staged delete removes. */
export interface DeleteBlocker {
  /** `source::predicate::target`, dotted ids. */
  relationshipId: string;
  /** "out" when the deleted element is the relationship's source, "in" when it is the target. */
  direction: "in" | "out";
  otherElementId: string;
  predicate: string;
}

/** The changeset's revision as the review API names it: its `nextSequenceNumber`. */
export function reviewRevision(changeset: Changeset): number {
  return nextSequenceNumber(changeset);
}

/**
 * The origin to record for a changeset created by `kind` of caller: `chat` when the process runs
 * for DrBot (CHANGESET_ORIGIN_ENV), else `kind`.
 */
export function resolveOrigin(kind: ChangesetOriginKind, env: NodeJS.ProcessEnv = process.env): ChangesetOrigin {
  const fromEnv = env[CHANGESET_ORIGIN_ENV];
  if (fromEnv === "chat") return { kind: "chat" };
  return { kind };
}

/** Reads an origin from metadata.yaml, or undefined when absent or malformed. */
export function readOrigin(value: unknown): ChangesetOrigin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { kind, detail } = value as { kind?: unknown; detail?: unknown };
  if (typeof kind !== "string" || !(ORIGIN_KINDS as readonly string[]).includes(kind)) return undefined;
  return {
    kind: kind as ChangesetOriginKind,
    ...(typeof detail === "string" && detail.length > 0 ? { detail } : {}),
  };
}

/**
 * Reads review.yaml's parsed content, keeping the well-formed decisions. Missing or malformed
 * content reads as no decisions: a review is advisory and never stops a changeset loading.
 */
export function readReview(value: unknown): ChangesetReview {
  const decisions: Record<string, ReviewDecision> = {};
  const raw = value && typeof value === "object" ? (value as { decisions?: unknown }).decisions : undefined;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !entry || typeof entry !== "object") continue;
      const { verdict, note, atRevision, decidedAt } = entry as Record<string, unknown>;
      if (typeof verdict !== "string" || !(REVIEW_VERDICTS as readonly string[]).includes(verdict)) continue;
      if (typeof atRevision !== "number" || typeof decidedAt !== "string") continue;
      decisions[key] = {
        verdict: verdict as ReviewVerdict,
        ...(typeof note === "string" && note.length > 0 ? { note } : {}),
        atRevision,
        decidedAt,
      };
    }
  }
  return withLastReviewed(decisions);
}

/** The review object for a set of decisions, with `lastReviewedRevision` computed. */
export function withLastReviewed(decisions: Record<string, ReviewDecision>): ChangesetReview {
  const revisions = Object.values(decisions).map((d) => d.atRevision);
  return {
    decisions,
    ...(revisions.length > 0 ? { lastReviewedRevision: Math.max(...revisions) } : {}),
  };
}

/** The sequence numbers of the changeset's staged changes. */
export function stagedSequences(changeset: Changeset): Set<number> {
  return new Set(changeset.changes.map((change, index) => sequenceOf(change, index)));
}

/**
 * Whether a decision still applies: its change is still staged and was not rewritten after the
 * decision (a `rewritten` tombstone for it with `removedAt` above the decision's `atRevision`).
 */
export function decisionIsCurrent(changeset: Changeset, sequence: number, decision: ReviewDecision): boolean {
  if (!stagedSequences(changeset).has(sequence)) return false;
  return !(changeset.unstaged ?? []).some(
    (t) => t.sequence === sequence && t.rewritten === true && t.removedAt > decision.atRevision
  );
}

/** The list entry's review counts (see GET /api/changesets). */
export function reviewCounts(
  changeset: Changeset,
  review: ChangesetReview
): { decided: number; total: number; asked: number } {
  let decided = 0;
  let asked = 0;
  for (const [key, decision] of Object.entries(review.decisions)) {
    if (!decisionIsCurrent(changeset, Number(key), decision)) continue;
    decided++;
    if (decision.verdict === "ask") asked++;
  }
  return { decided, total: changeset.changes.length, asked };
}

/** Every identifier an element change can be named by: its change key, the snapshot's id and path. */
function elementIds(change: Change): Set<string> {
  const ids = new Set<string>([change.elementId]);
  for (const snapshot of [change.after, change.before]) {
    if (!snapshot) continue;
    for (const key of ["id", "path"]) {
      const value = snapshot[key];
      if (typeof value === "string" && value.length > 0) ids.add(value);
    }
  }
  return ids;
}

/**
 * The changes to leave out of a commit for `drop`: the dropped ones, plus every staged change that
 * depends on an element a dropped `add` creates — a relationship-add with it at either end, or an
 * update of it. Unknown sequence numbers are returned apart.
 */
export function cascadeDrops(changeset: Changeset, drop: number[]): { dropped: number[]; unknown: number[] } {
  const staged = (changeset.changes as StagedChange[]).map((change, index) => ({
    change,
    sequence: sequenceOf(change, index),
  }));
  const bySequence = new Map(staged.map((entry) => [entry.sequence, entry.change]));
  const unknown = [...new Set(drop)].filter((sequence) => !bySequence.has(sequence));
  const dropped = new Set(drop.filter((sequence) => bySequence.has(sequence)));

  const removedElements = new Set<string>();
  for (const sequence of dropped) {
    const change = bySequence.get(sequence)!;
    if (change.type === "add") for (const id of elementIds(change)) removedElements.add(id);
  }
  if (removedElements.size > 0) {
    for (const { change, sequence } of staged) {
      if (dropped.has(sequence)) continue;
      if (change.type === "relationship-add") {
        const rel = (change.after ?? {}) as { source?: unknown; target?: unknown };
        const [keySource, , keyTarget] = change.elementId.split("::");
        const ends = [rel.source, rel.target, keySource, keyTarget].filter((v): v is string => typeof v === "string");
        if (ends.some((id) => removedElements.has(id))) dropped.add(sequence);
      } else if (change.type === "update") {
        if ([...elementIds(change)].some((id) => removedElements.has(id))) dropped.add(sequence);
      }
    }
  }
  return { dropped: [...dropped].sort((a, b) => a - b), unknown };
}

/**
 * For each staged `delete`, the relationships in the projected model (base + changeset) that still
 * name the deleted element and that the changeset does not delete. Keyed by sequence number; a
 * delete with none is absent.
 */
export function deleteBlockers(graph: ChangesetGraph, changeset: Changeset): Map<number, DeleteBlocker[]> {
  const result = new Map<number, DeleteBlocker[]>();
  (changeset.changes as StagedChange[]).forEach((change, index) => {
    if (change.type !== "delete") return;
    const ids = new Set<string>([...elementIds(change)].map((id) => graph.resolve(id)));
    const seen = new Set<string>();
    const blockers: DeleteBlocker[] = [];
    for (const id of ids) {
      for (const neighbor of graph.neighbors(id)) {
        const key = relationshipKey(neighbor.relationship);
        if (seen.has(key)) continue;
        seen.add(key);
        blockers.push({
          relationshipId: key,
          direction: neighbor.direction,
          otherElementId: neighbor.other,
          predicate: neighbor.relationship.predicate,
        });
      }
    }
    if (blockers.length > 0) result.set(sequenceOf(change, index), blockers);
  });
  return result;
}

/**
 * What an agent needs from the review (changeset_show, changeset_brief): the verdicts with each
 * change's element, the `ask` notes, and which decisions no longer apply. Undefined when there are
 * no decisions.
 */
export function reviewForAgent(changeset: Changeset, review: ChangesetReview):
  | {
      lastReviewedRevision?: number;
      decisions: Array<{
        sequence: number;
        verdict: ReviewVerdict;
        note?: string;
        atRevision: number;
        elementId?: string;
        type?: Change["type"];
        current: boolean;
      }>;
    }
  | undefined {
  const entries = Object.entries(review.decisions);
  if (entries.length === 0) return undefined;
  const bySequence = new Map(
    (changeset.changes as StagedChange[]).map((change, index) => [sequenceOf(change, index), change])
  );
  return {
    ...(review.lastReviewedRevision !== undefined ? { lastReviewedRevision: review.lastReviewedRevision } : {}),
    decisions: entries
      .map(([key, decision]) => {
        const sequence = Number(key);
        const change = bySequence.get(sequence) ?? changeset.unstaged.find((t) => t.sequence === sequence)?.change;
        return {
          sequence,
          verdict: decision.verdict,
          ...(decision.note ? { note: decision.note } : {}),
          atRevision: decision.atRevision,
          ...(change ? { elementId: change.elementId, type: change.type } : {}),
          current: decisionIsCurrent(changeset, sequence, decision),
        };
      })
      .sort((a, b) => a.sequence - b.sequence),
  };
}
