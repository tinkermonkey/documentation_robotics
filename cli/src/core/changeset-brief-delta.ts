/**
 * Brief deltas — what changed in a changeset's brief since an earlier revision.
 *
 * Nothing is stored between calls: the earlier brief is rebuilt from the changes staged up to that
 * revision (a `ChangesetGraph` over that prefix, against today's base) and compared with the brief
 * now. See "Iterating on a plan" in docs/CHANGE_MODELING.md.
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
import { ChangesetGraph } from "./changeset-graph.js";
import type { Model } from "./model.js";

export type UnwiredDeltaEntry = { element: string; layer: string } & UnwiredEntry;

export interface BriefDelta {
  /** The revision compared against, as asked. */
  since: number;
  /** The revision now. */
  revision: number;
  /** Elements that entered or left the change. */
  elements: { added: string[]; removed: string[] };
  gaps: { opened: BriefGap[]; closed: BriefGap[] };
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
}

const NOTE =
  "The earlier state is rebuilt from the changes staged up to `since`, applied to today's base model; nothing " +
  "is stored between calls. It is approximate when a change was unstaged since then (unstaging renumbers the " +
  "later changes) or when an element staged by then was updated afterwards (the staged change is rewritten " +
  "in place), and base drift since then is not separated out.";

/** Rebuilds the brief side for `since` and compares it with `now`. */
export async function briefDelta(model: Model, now: { graph: ChangesetGraph; brief: ChangesetBrief }, since: number): Promise<BriefDelta> {
  const earlier = await ChangesetGraph.build(model, now.graph.changeset, { throughSequence: since });
  const then: BriefSide = { brief: buildBrief({ graph: earlier, unwired: "none" }), unwired: computeUnwired(earlier) };
  return diffBriefs(then, { brief: now.brief, unwired: computeUnwired(now.graph) }, since);
}

export function diffBriefs(then: BriefSide, now: BriefSide, since: number): BriefDelta {
  const revision = now.brief.revision;
  const warnings: string[] = [];
  if (since > revision) {
    warnings.push(
      `since (${since}) is past the current revision (${revision}): changes were unstaged after it. The ` +
        "earlier state can't be rebuilt from what is staged now, so this delta compares the changeset with " +
        "itself and does not list what was unstaged; compare the two briefs' layers to see it."
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
    },
    gaps: {
      opened: [...nowGaps].filter(([k]) => !thenGaps.has(k)).map(([, g]) => g),
      closed: [...thenGaps].filter(([k]) => !nowGaps.has(k)).map(([, g]) => g),
    },
    unwired: {
      wired: [...thenUnwired]
        .filter(([k, e]) => !nowUnwired.has(k) && nowScoped.has(e.element))
        .map(([, e]) => e),
      new: [...nowUnwired].filter(([k, e]) => !thenUnwired.has(k) && thenScoped.has(e.element)).map(([, e]) => e),
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
