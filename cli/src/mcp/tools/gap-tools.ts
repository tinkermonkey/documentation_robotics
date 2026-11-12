/**
 * gap_accept, gap_reopen — record that a connection the catalog allows for an element's type is
 * deliberately absent (an accepted gap, the element's `accepted_gaps`), or take that decision back.
 *
 * Any agent may accept a gap, but only as a staged change in the active changeset: the human
 * approves it when the changeset lands, so both tools refuse when no changeset is active (whatever
 * the changeset-only mode). gap_accept refuses a triple the catalog doesn't define, one it marks
 * required, and one the element already has a relationship for. See `cli/src/core/accepted-gaps.ts`
 * and "Accepted gaps" in docs/CHANGE_MODELING.md (#1026).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  acceptedGapKey,
  acceptedGapProblem,
  readAcceptedGaps,
  acceptedGapView,
  describeTriple,
  gapCatalogProblem,
  gapTripleKey,
  type AcceptedGap,
  type GapDirection,
} from "../../core/accepted-gaps.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import type { Changeset } from "../../core/changeset.js";
import type { Element } from "../../core/element.js";
import type { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { normalizeNodeType } from "../../generated/node-types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { activeStagedChangeset } from "./changeset-shared.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const tripleSchema = {
  element: z.string().describe("Element ID or path the gap is on (e.g. 'api.operation.export-layout')."),
  direction: z
    .enum(["outgoing", "incoming"])
    .describe("'outgoing' when the element would be the relationship's source, 'incoming' when it would be the target."),
  predicate: z.string().describe("The relationship predicate, e.g. 'accesses'."),
  otherType: z
    .string()
    .describe("Spec node type of the other end, 'layer.type' (e.g. 'data-store.collection'), as spec_type and the brief's unwired entries name it."),
};

const acceptInputSchema = {
  ...tripleSchema,
  reason: z.string().min(1).describe("Why the connection doesn't apply to this element. Shown wherever the gap is reported."),
  decidedBy: z
    .string()
    .optional()
    .describe("Who decided: the person who asked for it, or the agent (default \"agent\"). The human approves it when the changeset lands."),
  rootPath: rootPathSchema,
};

const reopenInputSchema = {
  ...tripleSchema,
  rootPath: rootPathSchema,
};

export type GapAcceptArgs = z.infer<z.ZodObject<typeof acceptInputSchema>>;
export type GapReopenArgs = z.infer<z.ZodObject<typeof reopenInputSchema>>;

interface Target {
  model: Model;
  changeset: Changeset;
  layerName: string;
  layer: Layer;
  element: Element;
  elementId: string;
  /** The element's spec node type, `layer.type`. */
  specNodeId: string;
  /** The element's accepted gaps as stored: a malformed hand-edited entry is kept, never dropped. */
  gaps: AcceptedGap[];
}

/** Index of the well-formed stored gap with this triple key, or -1. */
function indexOfGap(gaps: AcceptedGap[], key: string): number {
  return gaps.findIndex((g) => acceptedGapProblem(g) === null && acceptedGapKey(g) === key);
}

/** The active changeset and the element as it leaves it; refuses without an active changeset. */
async function resolveTarget(elementRef: string, rootPath: string | undefined, toolName: string): Promise<Target> {
  const model = await loadModel(rootPath);
  const changeset = await activeStagedChangeset(new StagingAreaManager(model.rootPath, model));
  if (!changeset) {
    throw new CLIError(
      `${toolName} stages into the active changeset, and none is active. An accepted gap is a decision the human approves when the changeset lands.`,
      ErrorCategory.USER,
      ['Call "changeset_create" (or "changeset_activate" from "changeset_list"), then call it again']
    );
  }
  const layerName = await findElementLayer(model, elementRef);
  const layer = layerName ? await model.getLayer(layerName) : undefined;
  const element = layer?.getElement(elementRef);
  if (!layerName || !layer || !element) {
    throw new CLIError(`Element ${elementRef} not found`, ErrorCategory.NOT_FOUND, ['Use "model_search" to find it']);
  }
  return {
    model,
    changeset,
    layerName,
    layer,
    element,
    elementId: element.path || element.id,
    specNodeId: `${layerName}.${normalizeNodeType(layerName, element.type)}`,
    gaps: element.accepted_gaps ?? [],
  };
}

/** Stages the element's new list of accepted gaps (an empty list clears them) into the active changeset. */
async function stageGaps(target: Target, next: AcceptedGap[], rootPath: string | undefined): Promise<{ foldedIntoAdd: boolean }> {
  const handler = new MutationHandler(target.model, target.elementId, target.layerName);
  await handler.executeUpdate(target.element, async (elem, after) => {
    elem.accepted_gaps = next.length > 0 ? next : undefined;
    after.accepted_gaps = next;
    target.layer.updateElement(elem);
  });
  await reloadModel(rootPath);
  return { foldedIntoAdd: handler.wasFoldedIntoAdd() };
}

export async function gapAcceptHandler(args: GapAcceptArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const reason = args.reason.trim();
    if (!reason) throw new CLIError("reason is empty: say why the connection doesn't apply", ErrorCategory.USER);
    if (!/^[a-z-]+\.[a-z][a-z0-9-]*$/.test(args.otherType)) {
      throw new CLIError(`otherType "${args.otherType}" is not a spec node type ('layer.type')`, ErrorCategory.USER, [
        'Use "spec_type" for the types the element may connect to',
      ]);
    }
    const target = await resolveTarget(args.element, args.rootPath, "gap_accept");
    const triple = { direction: args.direction as GapDirection, predicate: args.predicate, other_spec_node_id: args.otherType };
    const described = describeTriple(target.specNodeId, triple);

    const problem = gapCatalogProblem(target.specNodeId, triple);
    if (problem) {
      throw new CLIError(problem.detail, ErrorCategory.USER, [
        problem.kind === "required"
          ? "Wire the relationship instead: a required relationship is expected on every element of the type"
          : `Use "spec_type" with layer "${target.layerName}" and type "${target.element.type}" for the connections the catalog defines`,
      ]);
    }

    // A connection the element has is not a gap.
    const graph = await ChangesetGraph.build(target.model, target.changeset);
    const wanted = gapTripleKey(triple.direction, triple.predicate, triple.other_spec_node_id);
    const wired = graph.neighbors(target.elementId).find((n) => {
      const other = graph.getElement(n.other);
      if (!other || other.status === "deleted") return false;
      const otherType = `${other.layer}.${normalizeNodeType(other.layer, other.type)}`;
      return gapTripleKey(n.direction, n.relationship.predicate, otherType) === wanted;
    });
    if (wired) {
      const rel = wired.relationship;
      throw new CLIError(
        `${target.elementId} has this connection (${rel.source} --${rel.predicate}--> ${rel.target}), so it is not a gap`,
        ErrorCategory.USER,
        ['Remove the relationship with "relationship_delete" first if the connection really doesn\'t apply']
      );
    }

    const gap: AcceptedGap = {
      ...triple,
      reason,
      decided_by: args.decidedBy?.trim() || "agent",
      decided_at: new Date().toISOString(),
      changeset: target.changeset.id!,
    };
    const existing = target.gaps[indexOfGap(target.gaps, wanted)] as AcceptedGap | undefined;
    if (existing && existing.reason === gap.reason && existing.decided_by === gap.decided_by) {
      return jsonResult({
        status: "already-accepted",
        element: target.elementId,
        triple: described,
        gap: acceptedGapView(existing),
      });
    }
    const next = existing ? target.gaps.map((g) => (g === existing ? gap : g)) : [...target.gaps, gap];
    const { foldedIntoAdd } = await stageGaps(target, next, args.rootPath);
    return jsonResult({
      status: "staged",
      changeset: { id: target.changeset.id, name: target.changeset.name },
      element: target.elementId,
      triple: described,
      gap: acceptedGapView(gap),
      ...(existing ? { replaced: acceptedGapView(existing) } : {}),
      ...(foldedIntoAdd ? { foldedIntoAdd: true } : {}),
      note:
        "Staged in the changeset: the human approves it when the changeset lands. changeset_brief now lists this " +
        "connection as accepted, not unwired; gap_reopen takes it back.",
    });
  });
}

export async function gapReopenHandler(args: GapReopenArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const target = await resolveTarget(args.element, args.rootPath, "gap_reopen");
    const wanted = gapTripleKey(args.direction as GapDirection, args.predicate, args.otherType);
    const existing = target.gaps[indexOfGap(target.gaps, wanted)] as AcceptedGap | undefined;
    if (!existing) {
      const have = readAcceptedGaps(target.gaps).map((g) => describeTriple(target.specNodeId, g));
      throw new CLIError(
        `${target.elementId} has no accepted gap ${describeTriple(target.specNodeId, {
          direction: args.direction as GapDirection,
          predicate: args.predicate,
          other_spec_node_id: args.otherType,
        })}`,
        ErrorCategory.NOT_FOUND,
        [have.length > 0 ? `Its accepted gaps: ${have.join("; ")}` : "It has no accepted gaps (model_show lists them)"]
      );
    }
    const next = target.gaps.filter((g) => g !== existing);
    const { foldedIntoAdd } = await stageGaps(target, next, args.rootPath);
    return jsonResult({
      status: "staged",
      changeset: { id: target.changeset.id, name: target.changeset.name },
      element: target.elementId,
      reopened: acceptedGapView(existing),
      remaining: next.length,
      ...(foldedIntoAdd ? { foldedIntoAdd: true } : {}),
      note: "Staged in the changeset: the connection counts as unwired again once it lands (in this changeset's brief now).",
    });
  });
}

export const gapAcceptTool: McpToolDefinition<typeof acceptInputSchema> = {
  name: "gap_accept",
  description:
    "Accept a gap: record on an element that a connection the catalog allows for its type is deliberately absent, " +
    "with the reason (one triple: direction, predicate, other type). Staged in the active changeset (refused without " +
    "one); the human approves it when the changeset lands. changeset_brief then lists the connection as accepted, " +
    "not unwired, and extraction and verification report it as contradicted if the code shows it. Refused for a " +
    "triple the catalog doesn't define, one it marks required, or one the element already has.",
  inputSchema: acceptInputSchema,
  handler: gapAcceptHandler,
};

export const gapReopenTool: McpToolDefinition<typeof reopenInputSchema> = {
  name: "gap_reopen",
  description:
    "Reopen an accepted gap: remove the decision that a connection doesn't apply to an element, so it counts as " +
    "unwired again. Staged in the active changeset (refused without one).",
  inputSchema: reopenInputSchema,
  handler: gapReopenHandler,
};
