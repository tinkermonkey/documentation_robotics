/**
 * Brief deltas — what changed in a changeset's brief since an earlier revision.
 *
 * The earlier brief is rebuilt from the changes that made up the plan at that revision (a
 * `ChangesetGraph` over them, against today's base) and compared with the brief now. Sequence
 * numbers are never reused and every unstage leaves a tombstone, so the plan at a revision can be
 * rebuilt after later unstages too. See "Iterating on a plan" in docs/CHANGE_MODELING.md.
 */

import {
  buildBrief,
  computeUnwired,
  unwiredKey,
  type BriefGap,
  type ChangesetBrief,
  type ElementUnwired,
  type UnwiredEntry,
} from "./changeset-analysis.js";
import {
  ChangesetGraph,
  changesetRevisionToken,
  parseRevisionToken,
  relationshipKey,
  unstagedSince,
  type GraphElement,
} from "./changeset-graph.js";
import { summarizeChange, type ChangeSummaryEntry } from "./changeset-summary.js";
import { toShortDirection } from "./accepted-gaps.js";
import type { StagedChange } from "./changeset.js";
import type { Model } from "./model.js";

export type UnwiredDeltaEntry = { element: string; layer: string } & UnwiredEntry;

export type RelationshipTriple = { source: string; predicate: string; target: string };

/** One accepted gap in a delta: the element, the triple from its side, and the reason. */
export type AcceptedGapDeltaEntry = {
  element: string;
  direction: "out" | "in";
  predicate: string;
  otherType: string;
  reason: string;
};

export interface BriefDelta {
  /** The revision compared against, as asked (the number, when a revision token was passed). */
  since: number;
  /** The revision now. */
  revision: number;
  /**
   * Elements that entered or left the change, and elements whose content (name, description,
   * attributes, source reference) changed since, with the fields that did.
   */
  elements: { added: string[]; removed: string[]; updated: Array<{ element: string; fields: string[] }> };
  /** Relationships live now and not then (added), or then and not now (removed), new elements' included. */
  relationships: { added: RelationshipTriple[]; removed: RelationshipTriple[] };
  /** Changes staged at `since` and unstaged after it, with the revision each unstage made. */
  unstaged: Array<ChangeSummaryEntry & { removedAt: number }>;
  gaps: { opened: BriefGap[]; closed: BriefGap[] };
  /**
   * Accepted gaps (`accepted_gaps`) recorded since `since` (e.g. with gap_accept in this changeset)
   * and ones reopened since. A connection accepted since is not listed as wired below, nor a
   * reopened one as new.
   */
  acceptedGaps: { accepted: AcceptedGapDeltaEntry[]; reopened: AcceptedGapDeltaEntry[] };
  unwired: {
    /** Unwired then, wired now (the element is still in the change). */
    wired: UnwiredDeltaEntry[];
    /** Unwired now, not then, on elements that were already in the change. */
    new: UnwiredDeltaEntry[];
    /** Elements new to the change, with how many unwired connections they bring (listed under `unwired`). */
    newElements: Array<{ element: string; count: number }>;
  };
  reach: { newlyReached: string[]; noLongerReached: string[] };
  intent: { newlyTraced: string[]; newlyUntraced: string[] };
  /** How the earlier state was rebuilt, and when it is approximate. */
  note: string;
  warnings?: string[];
}

export interface BriefSide {
  brief: ChangesetBrief;
  unwired: ElementUnwired[];
  /** The projection the brief was built from; needed for element updates and relationship changes. */
  graph?: ChangesetGraph;
}

const NOTE =
  "The earlier state is rebuilt from the changes that made up the plan at `since` (unstaged ones from the " +
  "changeset's unstage record), applied to today's base model; base drift since then is not separated out. " +
  "It is approximate when a change staged by then was rewritten in place afterwards: pass the brief's " +
  "revisionToken as `since` to be warned when that happened.";

/**
 * Rebuilds the brief side for `since` (a revision number, or a brief's `revisionToken`) and compares
 * it with `now`. A token whose hash no longer matches the plan at its revision adds a warning: a
 * change up to it was rewritten in place, so the rebuilt earlier state is not the one the token was
 * taken from.
 */
export async function briefDelta(
  model: Model,
  now: { graph: ChangesetGraph; brief: ChangesetBrief },
  since: number | string
): Promise<BriefDelta> {
  let revision: number;
  const warnings: string[] = [];
  const changeset = now.graph.changeset;
  if (typeof since === "string") {
    const parsed = parseRevisionToken(since);
    if (!parsed) {
      throw new Error(`since "${since}" is neither a revision number nor a revision token (<revision>:<hash>) from a brief`);
    }
    revision = parsed.revision;
    const today = changesetRevisionToken(changeset, revision);
    if (revision <= now.brief.revision && today !== since) {
      warnings.push(
        `The plan at revision ${revision} is not the one that revision token was taken from: a change up to it ` +
          "was rewritten in place since then (or the changeset was rewritten, e.g. by an upgrade). The earlier " +
          "state below is rebuilt from what is recorded now, so this delta is approximate."
      );
    }
  } else {
    revision = since;
  }
  const prunedThrough = changeset.unstagedPrunedThrough;
  if (prunedThrough !== undefined && revision < prunedThrough) {
    warnings.push(
      `Unstage tombstones up to revision ${prunedThrough} were dropped to keep the record bounded, so changes ` +
        `unstaged between revision ${revision} and then may be missing from the rebuilt earlier state and from ` +
        "`unstaged`; this delta is approximate."
    );
  }
  const earlier = await ChangesetGraph.build(model, changeset, { throughSequence: revision });
  const then: BriefSide = {
    brief: buildBrief({ graph: earlier, unwired: "none" }),
    unwired: computeUnwired(earlier),
    graph: earlier,
  };
  const delta = diffBriefs(then, { brief: now.brief, unwired: computeUnwired(now.graph), graph: now.graph }, revision, warnings);
  delta.unstaged = unstagedSince(changeset, revision).map((t, index) => ({
    ...summarizeChange({ ...t.change, sequenceNumber: t.sequence } as StagedChange, index),
    removedAt: t.removedAt,
  }));
  return delta;
}

export function diffBriefs(then: BriefSide, now: BriefSide, since: number, extraWarnings: string[] = []): BriefDelta {
  const revision = now.brief.revision;
  const warnings: string[] = [...extraWarnings];
  if (since > revision) {
    warnings.push(
      `since (${since}) is past the current revision (${revision}), so it is not a revision of this plan; the ` +
        "delta compares the changeset with itself."
    );
  }

  const changedIds = (brief: ChangesetBrief) => brief.layers.flatMap((l) => l.changes.map((c) => c.id));
  const thenIds = new Set(changedIds(then.brief));
  const nowIds = new Set(changedIds(now.brief));

  const gapKey = (g: BriefGap) => `${g.kind}|${g.element}|${g.kind === "peer-pattern" ? g.detail.replace(/^\d+ of \d+ /, "") : g.detail}`;
  const thenGaps = new Map(then.brief.gaps.map((g) => [gapKey(g), g]));
  const nowGaps = new Map(now.brief.gaps.map((g) => [gapKey(g), g]));

  const flatten = (list: ElementUnwired[]) => {
    const map = new Map<string, UnwiredDeltaEntry>();
    for (const { element, byLayer } of list) {
      for (const { layer, entries } of byLayer) {
        for (const entry of entries) map.set(unwiredKey(element, entry), { element, layer, ...entry });
      }
    }
    return map;
  };
  const thenUnwired = flatten(then.unwired);
  const nowUnwired = flatten(now.unwired);
  const thenScoped = new Set(then.unwired.map((u) => u.element));
  const nowScoped = new Set(now.unwired.map((u) => u.element));
  const acceptedGaps =
    then.graph && now.graph ? acceptedGapChanges(then.graph, now.graph) : { accepted: [], reopened: [] };
  const acceptedSince = new Set(acceptedGaps.accepted.map((e) => unwiredKey(e.element, e)));
  const reopenedSince = new Set(acceptedGaps.reopened.map((e) => unwiredKey(e.element, e)));

  const traced = (brief: ChangesetBrief) => new Set(brief.intent.traced.map((t) => t.element));
  const untraced = (brief: ChangesetBrief) => new Set(brief.intent.untraced);
  const thenTraced = traced(then.brief);
  const thenUntraced = untraced(then.brief);
  const thenReach = new Set(then.brief.reach.touched);
  const nowReach = new Set(now.brief.reach.touched);

  return {
    since,
    revision,
    elements: {
      added: [...nowIds].filter((id) => !thenIds.has(id)),
      removed: [...thenIds].filter((id) => !nowIds.has(id)),
      updated: then.graph && now.graph ? elementUpdates(then.graph, now.graph) : [],
    },
    relationships: then.graph && now.graph ? relationshipChanges(then.graph, now.graph) : { added: [], removed: [] },
    unstaged: [],
    gaps: {
      opened: [...nowGaps].filter(([k]) => !thenGaps.has(k)).map(([, g]) => g),
      closed: [...thenGaps].filter(([k]) => !nowGaps.has(k)).map(([, g]) => g),
    },
    acceptedGaps,
    unwired: {
      wired: [...thenUnwired]
        .filter(([k, e]) => !nowUnwired.has(k) && nowScoped.has(e.element) && !acceptedSince.has(k))
        .map(([, e]) => e),
      new: [...nowUnwired]
        .filter(([k, e]) => !thenUnwired.has(k) && thenScoped.has(e.element) && !reopenedSince.has(k))
        .map(([, e]) => e),
      newElements: now.unwired
        .filter((u) => !thenScoped.has(u.element))
        .map((u) => ({ element: u.element, count: u.byLayer.reduce((sum, l) => sum + l.entries.length, 0) })),
    },
    reach: {
      newlyReached: now.brief.reach.touched.filter((l) => !thenReach.has(l)),
      noLongerReached: then.brief.reach.touched.filter((l) => !nowReach.has(l)),
    },
    intent: {
      newlyTraced: now.brief.intent.traced.map((t) => t.element).filter((id) => !thenTraced.has(id)),
      newlyUntraced: now.brief.intent.untraced.filter((id) => !thenUntraced.has(id)),
    },
    note: NOTE,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/** Elements present (not deleted) in both projections whose content differs, with the fields that do. */
function elementUpdates(then: ChangesetGraph, now: ChangesetGraph): Array<{ element: string; fields: string[] }> {
  const updates: Array<{ element: string; fields: string[] }> = [];
  for (const after of now.elements.values()) {
    if (after.status === "deleted") continue;
    const before = then.getElement(after.id);
    if (!before || before.status === "deleted") continue;
    // Both from the base: same content. (One unchanged and one not still compares: an update
    // staged or unstaged since.)
    if (before.status === "unchanged" && after.status === "unchanged") continue;
    const fields = changedFields(before, after);
    if (fields.length > 0) updates.push({ element: after.id, fields });
  }
  return updates;
}

function changedFields(before: GraphElement, after: GraphElement): string[] {
  const fields: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!same(before.name, after.name)) fields.push("name");
  if (!same(before.description, after.description)) fields.push("description");
  for (const key of [...new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)])].sort()) {
    if (!same(before.attributes[key], after.attributes[key])) fields.push(`attributes.${key}`);
  }
  if (!same(before.sourceReference, after.sourceReference)) fields.push("sourceReference");
  if (!same(before.acceptedGaps, after.acceptedGaps)) fields.push("accepted_gaps");
  return fields;
}

/** Accepted gaps on live elements now and not then (accepted), or then and not now (reopened). */
function acceptedGapChanges(
  then: ChangesetGraph,
  now: ChangesetGraph
): { accepted: AcceptedGapDeltaEntry[]; reopened: AcceptedGapDeltaEntry[] } {
  const collect = (graph: ChangesetGraph) => {
    const map = new Map<string, AcceptedGapDeltaEntry>();
    for (const element of graph.elements.values()) {
      if (element.status === "deleted") continue;
      for (const gap of element.acceptedGaps ?? []) {
        const entry: AcceptedGapDeltaEntry = {
          element: element.id,
          direction: toShortDirection(gap.direction),
          predicate: gap.predicate,
          otherType: gap.other_spec_node_id,
          reason: gap.reason,
        };
        map.set(unwiredKey(element.id, entry), entry);
      }
    }
    return map;
  };
  const before = collect(then);
  const after = collect(now);
  return {
    accepted: [...after].filter(([k]) => !before.has(k)).map(([, e]) => e),
    reopened: [...before].filter(([k]) => !after.has(k)).map(([, e]) => e),
  };
}

/** Relationships live in one projection and not the other. */
function relationshipChanges(
  then: ChangesetGraph,
  now: ChangesetGraph
): { added: RelationshipTriple[]; removed: RelationshipTriple[] } {
  const live = (graph: ChangesetGraph) =>
    new Map(
      graph
        .relationships()
        .filter((r) => r.status !== "deleted")
        .map((r) => [relationshipKey(r), { source: r.source, predicate: r.predicate, target: r.target }])
    );
  const before = live(then);
  const after = live(now);
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, r]) => r),
    removed: [...before].filter(([k]) => !after.has(k)).map(([, r]) => r),
  };
}
