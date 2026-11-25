/**
 * model_add's `after` / `before` for a product workflow step (#1396): place a new step between
 * existing ones in one call. Without it, inserting a step meant unstaging the flows-to hand-offs
 * around the gap, adding the step and two new hand-offs, and a model_update per later step to
 * shift its sequence.
 *
 * - `after: A` puts the step right after A: it takes A's sequence + 1, A flows to it, and it flows
 *   to whatever A flowed to. `before: B` puts it right before B: it takes B's sequence, what flowed
 *   to B flows to it, and it flows to B. Both together name one hand-off, A flows-to B, to split.
 * - The step joins the user workflow that composes its neighbour. That workflow's later steps are
 *   renumbered where their sequence would collide, and no further: a gap in the numbering ends
 *   the shift. With no workflow, the steps downstream along flows-to are renumbered the same way.
 *
 * Everything is checked before anything is written: the step against its schema, and every link
 * against the catalog and the projection (planRelationshipBatch). In the active changeset it is then
 * one write (stageMany): the step, the renumbered sequences, the replaced hand-offs removed and the
 * new links. In the model, the step is added, the later steps renumbered (model_update's code), and
 * the hand-offs replaced, with nothing left to refuse.
 */

import type { StagedChange } from "../../core/changeset.js";
import type { ChangesetGraph, GraphRelationship } from "../../core/changeset-graph.js";
import { ChangesetGraph as Graph } from "../../core/changeset-graph.js";
import { planRelationshipBatch, relationshipDeleteChange, stagedRelationshipKeys } from "../../core/relationship-staging.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { deleteRelationshipHandler } from "../../commands/relationship.js";
import { deriveElementId } from "../../utils/id-generator.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { loadModel, reloadModel } from "./shared.js";
import { addOneElement, prepareElement, type ElementSpec, type SingleAddOutcome } from "./model-add.js";
import { updateElement } from "./model-update.js";
import { addRelationshipBatch, previewChangeset } from "./relationship-tools.js";

const STEP = "workflowstep";
const WORKFLOW = "userworkflow";

export interface WorkflowStepPlacement {
  after?: string;
  before?: string;
}

export interface WorkflowStepInsertOutcome extends SingleAddOutcome {
  inserted: {
    after?: string;
    before?: string;
    sequence: number;
    workflow?: string;
    /** Each later step whose sequence moved, from and to. */
    renumbered: Array<{ id: string; from: number; to: number }>;
    flowsTo: { removed: string[]; added: string[] };
  };
}

function live(graph: ChangesetGraph, id: string) {
  const element = graph.getElement(id);
  return element && element.status !== "deleted" ? element : undefined;
}

function liveRelationships(graph: ChangesetGraph, predicate: string): GraphRelationship[] {
  return graph.relationships().filter((rel) => rel.status !== "deleted" && rel.predicate === predicate);
}

function sequenceOf(graph: ChangesetGraph, id: string): number {
  const value = Number(live(graph, id)?.attributes?.sequence);
  if (!Number.isInteger(value)) {
    throw new CLIError(`Workflow step ${id} has no sequence to place a step beside`, ErrorCategory.USER, [
      `Give it one first: model_update with id ${id} and attributePatch {sequence: <n>}`,
    ]);
  }
  return value;
}

/** A live workflow step, or a refusal naming what the reference is instead. */
function stepOf(graph: ChangesetGraph, ref: string, role: "after" | "before"): string {
  const id = graph.resolve(ref);
  const element = live(graph, id);
  if (!element) {
    throw new CLIError(`${role}: ${ref} is not in the model or the active changeset`, ErrorCategory.USER, [
      'Name an existing product.workflowstep by its id; "model_search" with type "workflowstep" finds them',
    ]);
  }
  if (element.layer !== "product" || element.type !== STEP) {
    throw new CLIError(`${role}: ${id} is a ${element.layer}.${element.type}, not a product.workflowstep`, ErrorCategory.USER, [
      "after and before place a step beside another product.workflowstep",
    ]);
  }
  return id;
}

/**
 * The sequence changes that make room for `sequence` among `steps`: each step from there on moves up
 * by one while the next number is taken, and the shift stops at the first gap.
 */
export function renumberings(
  steps: Array<{ id: string; sequence: number }>,
  sequence: number
): Array<{ id: string; from: number; to: number }> {
  const moves: Array<{ id: string; from: number; to: number }> = [];
  let taken = sequence;
  for (const step of [...steps].filter((s) => s.sequence >= sequence).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))) {
    if (step.sequence > taken) break;
    moves.push({ id: step.id, from: step.sequence, to: taken + 1 });
    taken++;
  }
  return moves;
}

/** Inserts a new workflow step after and/or before existing ones (see the module comment). */
export async function insertWorkflowStep(
  spec: ElementSpec,
  placement: WorkflowStepPlacement,
  rootPath: string | undefined
): Promise<WorkflowStepInsertOutcome> {
  if (spec.layer !== "product" || spec.type !== STEP) {
    throw new CLIError("after and before place a product workflow step", ErrorCategory.USER, [
      'Send layer "product" and type "workflowstep" with them, or leave them out',
    ]);
  }
  if (spec.attributes && "sequence" in spec.attributes) {
    throw new CLIError("Send no sequence with after or before: the step's place gives it", ErrorCategory.USER, [
      "Leave attributes.sequence out; the result says the sequence it got and which steps were renumbered",
    ]);
  }

  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await manager.getWriteTarget();
  const graph = await Graph.build(model, active ?? previewChangeset());

  const after = placement.after ? stepOf(graph, placement.after, "after") : undefined;
  const before = placement.before ? stepOf(graph, placement.before, "before") : undefined;
  const flows = liveRelationships(graph, "flows-to").filter(
    (rel) => live(graph, rel.source)?.type === STEP && live(graph, rel.target)?.type === STEP
  );
  if (after && before && !flows.some((rel) => rel.source === after && rel.target === before)) {
    throw new CLIError(`after and before name one hand-off to split, and ${after} does not flow to ${before}`, ErrorCategory.USER, [
      "Send after alone, or before alone, or the two ends of a flows-to between steps",
    ]);
  }

  const newId = deriveElementId(spec.layer, STEP, spec.name).id;
  if (live(graph, newId)) {
    throw new CLIError(`Element ${newId} already exists: after and before place a new step`, ErrorCategory.USER, [
      "To move an existing step, unstage or delete its flows-to links and add them again",
    ]);
  }

  // Where the step goes, and the hand-offs it replaces.
  const sequence = after ? sequenceOf(graph, after) + 1 : sequenceOf(graph, before!);
  const replaced = after && before
    ? flows.filter((rel) => rel.source === after && rel.target === before)
    : after
      ? flows.filter((rel) => rel.source === after)
      : flows.filter((rel) => rel.target === before);
  const added = after && before
    ? [{ source: after, target: newId }, { source: newId, target: before }]
    : after
      ? [{ source: after, target: newId }, ...replaced.map((rel) => ({ source: newId, target: rel.target }))]
      : [...replaced.map((rel) => ({ source: rel.source, target: newId })), { source: newId, target: before! }];

  // The workflow its neighbour belongs to, and the steps that may need renumbering.
  const anchor = (after ?? before)!;
  const workflows = liveRelationships(graph, "composes")
    .filter((rel) => rel.target === anchor && live(graph, rel.source)?.type === WORKFLOW)
    .map((rel) => rel.source);
  if (workflows.length > 1) {
    throw new CLIError(`${anchor} is composed by more than one workflow (${workflows.join(", ")})`, ErrorCategory.USER, [
      "A step belongs to exactly one UserWorkflow: remove the extra composes link first",
    ]);
  }
  const workflow = workflows[0];
  let siblings: string[];
  if (workflow) {
    siblings = liveRelationships(graph, "composes")
      .filter((rel) => rel.source === workflow && live(graph, rel.target)?.type === STEP)
      .map((rel) => rel.target);
  } else {
    // No workflow: the steps downstream of the new one, along flows-to.
    const next = new Map<string, string[]>();
    for (const rel of flows) next.set(rel.source, [...(next.get(rel.source) ?? []), rel.target]);
    const seen = new Set<string>();
    const queue = after ? replaced.map((rel) => rel.target).concat(before ? [before] : []) : [before!];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id) || id === after) continue;
      seen.add(id);
      queue.push(...(next.get(id) ?? []));
    }
    siblings = [...seen];
  }
  const renumbered = renumberings(
    siblings.flatMap((id) => {
      const value = Number(live(graph, id)?.attributes?.sequence);
      return Number.isInteger(value) ? [{ id, sequence: value }] : [];
    }),
    sequence
  );

  // Check everything before writing anything: the step against its schema, and every link it
  // gets against the catalog and the projection (#1396 review): a refusal leaves the workflow as it was.
  const step = { ...spec, attributes: { ...(spec.attributes ?? {}), sequence } };
  const prepared = await prepareElement(step, model.manifest);
  const links = [
    ...added.map((rel) => ({ ...rel, predicate: "flows-to" })),
    ...(workflow ? [{ source: workflow, predicate: "composes", target: newId }] : []),
  ];
  const plan = await planRelationshipBatch(graph, active ?? previewChangeset(), links, {
    pending: new Map([[newId, { id: newId, layer: "product", type: STEP, name: spec.name }]]),
    addStatus: active ? "staged" : "added",
    specVersion: model.manifest,
  });
  const refused = plan.results.filter((r) => r.status === "invalid");
  if (refused.length > 0) {
    throw new CLIError(
      `Step ${newId} was not added: ${refused.length} of the links it needs ${refused.length === 1 ? "is" : "are"} refused: ` +
        refused.map((r) => `${r.source} --[${r.predicate}]--> ${r.target}: ${r.reason}`).join("; "),
      ErrorCategory.USER,
      ["Nothing was written. Fix what the reasons name, or add the step without after/before and link it by hand"]
    );
  }

  let outcome: SingleAddOutcome;
  if (active) {
    // In a changeset, one write: the step, the later steps' sequences (folded into a staged add, or
    // an update), the hand-offs it replaces removed (an add this changeset made is unstaged) and the
    // new links staged.
    const product = await model.getLayer("product");
    const changes: Array<Omit<StagedChange, "sequenceNumber">> = [
      { type: "add", elementId: newId, layerName: "product", after: prepared.element.toJSON() as unknown as Record<string, unknown> },
    ];
    const rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }> = [];
    for (const move of renumbered) {
      const add = (active.changes as StagedChange[]).find((c) => c.type === "add" && graph.resolve(c.elementId) === move.id);
      if (add?.after) {
        const after = add.after as Record<string, unknown>;
        const attributes = { ...((after.attributes as Record<string, unknown>) ?? {}), sequence: move.to };
        const { sequenceNumber: _sequence, ...rest } = add;
        rewrites.push({ elementId: add.elementId, change: { ...rest, after: { ...after, attributes } } });
        continue;
      }
      const before = product?.getElement(move.id)?.toJSON() as unknown as Record<string, unknown> | undefined;
      if (!before) throw new CLIError(`Workflow step ${move.id} could not be read to renumber it`, ErrorCategory.SYSTEM);
      const attributes = { ...((before.attributes as Record<string, unknown>) ?? {}), sequence: move.to };
      changes.push({ type: "update", elementId: move.id, layerName: "product", before, after: { ...before, attributes } });
    }
    const removals: string[] = [...plan.unstageKeys];
    for (const rel of replaced) {
      if (rel.status === "added") removals.push(...stagedRelationshipKeys(graph, active, "relationship-add", rel));
      else changes.push(relationshipDeleteChange(rel));
    }
    changes.push(...plan.changes);
    await manager.stageMany(active.id!, changes, rewrites, [...new Set(removals)]);
    await reloadModel(rootPath);
    outcome = { status: "staged", changeset: active.name, id: newId, layer: "product", type: STEP, name: spec.name };
  } else {
    // In the model: everything was checked above, so these writes fail only on I/O.
    outcome = await addOneElement(step, rootPath);
    await reloadModel(rootPath);
    for (const move of [...renumbered].reverse()) {
      await updateElement(await loadModel(rootPath), { id: move.id, attributePatch: { sequence: move.to } });
    }
    for (const rel of replaced) {
      await deleteRelationshipHandler(await loadModel(rootPath), rel.source, rel.target, rel.predicate, undefined, "mcp");
    }
    await reloadModel(rootPath);
    await addRelationshipBatch(links, rootPath);
  }
  if (prepared.notes.length > 0) outcome = { ...outcome, notes: prepared.notes };
  if (prepared.warnings.length > 0) outcome = { ...outcome, warnings: prepared.warnings };

  return {
    ...outcome,
    inserted: {
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      sequence,
      ...(workflow ? { workflow } : {}),
      renumbered,
      flowsTo: {
        removed: replaced.map((rel) => `${rel.source} -> ${rel.target}`),
        added: added.map((rel) => `${rel.source} -> ${rel.target}`),
      },
    },
  };
}
