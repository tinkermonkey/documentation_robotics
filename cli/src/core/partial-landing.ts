/**
 * Landing part of a plan (#1388). A plan describes a whole roadmap; the code built so far matches
 * only some of it, so the part that is built lands and the rest stays staged as the plan.
 *
 * This module chooses the part and reports what crosses its boundary, with no writes:
 * - the part is chosen by element ids, by milestone (the milestone's scope, core/milestone-scope.ts,
 *   with the milestone elements themselves), by "everything with a source reference", or by any mix;
 * - a staged link between a chosen element and a staged-added element that is not chosen *crosses
 *   the boundary*: landing it would leave a link to an element that is not in the model. The
 *   caller refuses, brings the far end along (`include`, one level), or leaves such links in the
 *   plan (`leave`);
 * - a link whose ends will both be in the model once the part lands (or already are) lands with the
 *   part when it touches a chosen element.
 *
 * The landing itself (changeset_commit) writes the chosen changes into a new changeset, lands that
 * through the ordinary commit, and takes them out of the plan. See mcp/tools/changeset-commit.ts.
 */

import type { Changeset, StagedChange } from "./changeset.js";
import { withSequenceNumbers } from "./changeset.js";
import { ChangesetGraph } from "./changeset-graph.js";
import type { Model } from "./model.js";
import { milestoneScope, scopeViewOfGraph } from "./milestone-scope.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";

/** What to do with links that cross the boundary of the part. */
export type CrossingPolicy = "refuse" | "include" | "leave";

export interface PartSelection {
  /** Element ids whose staged changes land. */
  ids?: string[];
  /** A milestone (or several): its scope's changed elements, and the milestone elements the plan adds. */
  milestone?: string[];
  /** Every element the plan adds or updates that carries a source reference. */
  withSourceReference?: boolean;
  crossing?: CrossingPolicy;
}

/** A staged link between a chosen element and one the part does not take. */
export interface CrossingLink {
  op: "relationship-add" | "relationship-delete";
  source: string;
  predicate: string;
  target: string;
  /** The end that is in the part. */
  inside: string;
  /** The end that is not: a staged-added element. */
  outside: string;
}

export interface PartPlan {
  /** How the part was chosen, in words. */
  selection: string;
  /** Elements whose changes land, including the ones `include` brought along. */
  elements: string[];
  /** The elements `include` brought along because a chosen element's link reaches them. */
  included: string[];
  /** Sequence numbers of the staged changes that land (elements' and links'). */
  sequences: number[];
  /** Relationship changes that land. */
  relationships: number;
  /** Links that cross the boundary (with include: the ones left after the far ends came along). */
  crossing: CrossingLink[];
  /** What stays staged in the plan. */
  remaining: { changes: number; elements: number; relationships: number };
  /** Ids given that the plan does not change: not part of it. */
  unknownIds: string[];
  /** The policy that was applied. */
  policy: CrossingPolicy;
}

const isRelationship = (c: StagedChange) => c.type === "relationship-add" || c.type === "relationship-delete";

interface LinkChange {
  change: StagedChange;
  op: CrossingLink["op"];
  source: string;
  predicate: string;
  target: string;
}

/**
 * The part of `changeset` the selection names, and what crosses its boundary. Reads the plan as the
 * model projects it; writes nothing. Refuses a selection that names nothing the plan changes.
 */
export async function planPartialLanding(model: Model, changeset: Changeset, selection: PartSelection): Promise<PartPlan> {
  const policy = selection.crossing ?? "refuse";
  const graph = await ChangesetGraph.build(model, changeset);
  const changes = withSequenceNumbers(changeset.changes);

  const links: LinkChange[] = [];
  const changedElements = new Set<string>();
  const added = new Set<string>();
  for (const change of changes) {
    if (isRelationship(change)) {
      const rel = (change.type === "relationship-add" ? change.after : change.before) as
        | { source?: string; target?: string; predicate?: string }
        | undefined;
      if (rel?.source && rel.target && rel.predicate) {
        links.push({
          change,
          op: change.type as CrossingLink["op"],
          source: graph.resolve(rel.source),
          predicate: rel.predicate,
          target: graph.resolve(rel.target),
        });
      }
    } else {
      const id = graph.resolve(change.elementId);
      changedElements.add(id);
      // An add the base already has lands as the base's element (commit skips it): not pending.
      if (change.type === "add" && !graph.getElement(id)?.alreadyInBase) added.add(id);
    }
  }

  const chosen = new Set<string>();
  const unknownIds: string[] = [];
  const how: string[] = [];
  if (selection.ids?.length) {
    how.push(`${selection.ids.length} element id${selection.ids.length === 1 ? "" : "s"}`);
    for (const given of selection.ids) {
      const id = graph.resolve(given);
      if (changedElements.has(id)) chosen.add(id);
      else unknownIds.push(given);
    }
  }
  if (selection.milestone?.length) {
    const scope = milestoneScope(scopeViewOfGraph(graph), selection.milestone);
    how.push(`${scope.milestones.map((m) => `milestone ${m.id}`).join(", ")} (${scope.elements.length} elements in its scope)`);
    for (const id of scope.elements) if (changedElements.has(id)) chosen.add(id);
    // The milestone elements themselves go with the features scheduled for them, when the plan adds them.
    for (const milestone of scope.milestones) if (added.has(milestone.id)) chosen.add(milestone.id);
  }
  if (selection.withSourceReference) {
    how.push("elements with a source reference");
    for (const id of changedElements) {
      const element = graph.getElement(id);
      if (element && element.status !== "deleted" && element.sourceReference?.locations?.length) chosen.add(id);
    }
  }
  if (how.length === 0) {
    throw new CLIError("Choose the part to land: ids, milestone or withSourceReference", ErrorCategory.USER, [
      "ids: the elements to land; milestone: a milestone's elements; withSourceReference: every element the plan ties to code",
    ]);
  }
  if (chosen.size === 0) {
    throw new CLIError(
      `Nothing in the plan matches the part chosen (${how.join(", ")})`,
      ErrorCategory.USER,
      [
        unknownIds.length > 0
          ? `The plan changes none of: ${unknownIds.join(", ")} (changeset_brief with sections ["changes"] lists what it changes)`
          : "model_search with milestone lists a milestone's set; changeset_brief lists what the plan changes",
      ]
    );
  }

  // The links that cross the boundary: one end chosen, the other a staged add that is not.
  const crossingOf = (part: Set<string>): CrossingLink[] => {
    const crossing: CrossingLink[] = [];
    for (const link of links) {
      const sourceIn = part.has(link.source);
      const targetIn = part.has(link.target);
      if (sourceIn === targetIn) continue;
      const inside = sourceIn ? link.source : link.target;
      const outside = sourceIn ? link.target : link.source;
      if (added.has(outside)) crossing.push({ op: link.op, source: link.source, predicate: link.predicate, target: link.target, inside, outside });
    }
    return crossing;
  };

  let crossing = crossingOf(chosen);
  const included: string[] = [];
  if (policy === "include") {
    // One level: the far ends of the links come along; links from them to others stay in the plan.
    for (const link of crossing) {
      if (!chosen.has(link.outside)) {
        chosen.add(link.outside);
        included.push(link.outside);
      }
    }
    crossing = crossingOf(chosen);
  }

  // What lands: every change to a chosen element, and each link that touches a chosen element and
  // whose other end is chosen, or in the base, or not staged-added (a link left on the boundary stays).
  const sequences: number[] = [];
  let relationships = 0;
  for (const change of changes) {
    if (isRelationship(change)) continue;
    if (chosen.has(graph.resolve(change.elementId))) sequences.push(change.sequenceNumber);
  }
  for (const link of links) {
    const touches = chosen.has(link.source) || chosen.has(link.target);
    if (!touches) continue;
    const pending = (id: string) => added.has(id) && !chosen.has(id);
    if (pending(link.source) || pending(link.target)) continue;
    sequences.push(link.change.sequenceNumber);
    relationships++;
  }
  sequences.sort((a, b) => a - b);

  const landing = new Set(sequences);
  const rest = changes.filter((c) => !landing.has(c.sequenceNumber));
  return {
    selection: how.join(" and "),
    elements: [...chosen].sort(),
    included,
    sequences,
    relationships,
    crossing,
    remaining: {
      changes: rest.length,
      elements: rest.filter((c) => !isRelationship(c)).length,
      relationships: rest.filter(isRelationship).length,
    },
    unknownIds,
    policy,
  };
}

/** The changes a plan's part takes, as they are staged (sequence numbers kept), for the changeset that lands them. */
export function changesOfPart(changeset: Changeset, plan: Pick<PartPlan, "sequences">): StagedChange[] {
  const wanted = new Set(plan.sequences);
  return withSequenceNumbers(changeset.changes).filter((c) => wanted.has(c.sequenceNumber));
}
