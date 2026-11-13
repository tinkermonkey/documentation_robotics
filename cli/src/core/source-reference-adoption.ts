/**
 * Copy the source references verify found on the as-built side onto the plan
 * (`changeset_adopt_source_references`; `changeset_verify` only lists them).
 *
 * A plan's code-level elements are drawn before the code exists, so they carry no source file or
 * symbol. Verify matches them to the as-built elements extraction staged, which do. Landing the plan
 * without copying those references leaves the model unable to tie the elements to the code: the next
 * codebase_extract offers their symbols again, and adding them fails because the ids exist.
 *
 * Each copy is staged into the plan in one write: an element the plan adds has its add rewritten in
 * place (the same fold model_update does); an element the plan updates gets one more update, from
 * its latest staged state with the reference added. Matches against elements extraction didn't
 * stage (`builtByAgent`) are not copied: their reference is the agent's, not evidence. Only exact
 * matches are copied by default: a probable match (same name or source file, different id) may be
 * the wrong element, so it is copied only when the caller confirms it by its planned id.
 *
 * `adoptVerifiedSourceReferences` is the whole flow from a verify report, shared by
 * `changeset_adopt_source_references` and `dr changeset verify --adopt-source-references`.
 */

import type { Changeset, StagedChange } from "./changeset.js";
import { ChangesetGraph } from "./changeset-graph.js";
import type { Model } from "./model.js";
import type { StagingAreaManager } from "./staging-area.js";
import { setStagedSourceReference } from "./staged-source-reference.js";
import type { SourceReferenceGap, VerifyReport } from "./changeset-verify.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";

export interface AdoptionResult {
  adopted: SourceReferenceGap[];
  skipped: Array<{ planned: string; reason: string }>;
  /** Confirmed ids that name none of the gaps (so confirm nothing). */
  unknownIds?: string[];
}

type Rewrite = { elementId: string; change: Omit<StagedChange, "sequenceNumber"> };

export interface AdoptionOptions {
  /** Planned element ids (dotted id, path or UUID) whose probable matches the caller confirmed. */
  confirmed?: readonly string[];
}

export async function adoptSourceReferences(
  model: Model,
  manager: StagingAreaManager,
  planned: Changeset,
  gaps: SourceReferenceGap[],
  options: AdoptionOptions = {}
): Promise<AdoptionResult> {
  const adopted: SourceReferenceGap[] = [];
  const skipped: AdoptionResult["skipped"] = [];
  if (gaps.length === 0) {
    return { adopted, skipped, ...(options.confirmed?.length ? { unknownIds: [...options.confirmed] } : {}) };
  }
  if (planned.status !== "staged") {
    return {
      adopted,
      skipped: gaps.map((g) => ({
        planned: g.planned,
        reason:
          `the plan "${planned.name}" is ${planned.status}, so it can't be staged into: set sourceFile and sourceSymbol ` +
          "on the element with model_update instead",
      })),
    };
  }

  const graph = await ChangesetGraph.build(model, planned);
  // Each element's staged changes, in sequence order, keyed by the dotted id verify reports.
  const ordered = [...(planned.changes as StagedChange[])]
    .map((change, index) => ({ change, index }))
    .sort((a, b) => (a.change.sequenceNumber ?? a.index) - (b.change.sequenceNumber ?? b.index))
    .map(({ change }) => change);
  const byElement = new Map<string, StagedChange[]>();
  for (const change of ordered) {
    if (change.type !== "add" && change.type !== "update") continue;
    const id = graph.resolve(change.elementId);
    byElement.set(id, [...(byElement.get(id) ?? []), change]);
  }
  const confirmed = new Set((options.confirmed ?? []).map((id) => graph.resolve(id)));
  const listed = new Set(gaps.map((g) => g.planned));
  const unknownIds = (options.confirmed ?? []).filter((id) => !listed.has(graph.resolve(id)));

  const appended: Array<Omit<StagedChange, "sequenceNumber">> = [];
  const rewrites: Rewrite[] = [];
  for (const gap of gaps) {
    if (gap.builtByAgent) {
      skipped.push({
        planned: gap.planned,
        reason: `its as-built match ${gap.built} was not staged by extraction, so its source reference is no evidence: confirm it in the code`,
      });
      continue;
    }
    if (gap.match !== "exact" && !confirmed.has(gap.planned)) {
      skipped.push({
        planned: gap.planned,
        reason:
          `its match to ${gap.built} is probable, not exact${gap.matchReason ? ` (${gap.matchReason})` : ""}: confirm in ` +
          "the code that it is the same element, then pass its planned id in ids",
      });
      continue;
    }
    const changes = (byElement.get(gap.planned) ?? []).filter((c) => c.after);
    const latest = changes[changes.length - 1];
    if (!latest?.after) {
      skipped.push({ planned: gap.planned, reason: "the plan has no staged add or update of it to carry the reference" });
      continue;
    }
    const withReference = (snapshot: Record<string, unknown>) => {
      const copy = structuredClone(snapshot);
      setStagedSourceReference(copy, structuredClone(gap.adopt));
      return copy;
    };
    // The add is the element's only change (model_update folds edits into it): rewrite it in place.
    // The storage rewrites the first change with this key, so only when that is this add.
    const firstWithKey = (planned.changes as StagedChange[]).find((c) => c.elementId === latest.elementId);
    if (latest.type === "add" && firstWithKey === latest && changes.length === 1) {
      rewrites.push({
        elementId: latest.elementId,
        change: {
          type: "add",
          elementId: latest.elementId,
          layerName: latest.layerName,
          ...(latest.before !== undefined ? { before: latest.before } : {}),
          after: withReference(latest.after),
        },
      });
    } else {
      appended.push({
        type: "update",
        elementId: latest.elementId,
        layerName: latest.layerName,
        before: structuredClone(latest.after),
        after: withReference(latest.after),
      });
    }
    adopted.push(gap);
  }

  if (appended.length > 0 || rewrites.length > 0) {
    await manager.stageMany(planned.id!, appended, rewrites);
  }
  return { adopted, skipped, ...(unknownIds.length > 0 ? { unknownIds } : {}) };
}

/** What adopting the references a verify report lists did: changeset_adopt_source_references' result. */
export interface VerifiedAdoptionReport {
  plannedChangeset: { id?: string; name: string };
  adopted: SourceReferenceGap[];
  /** Why each listed reference that was not copied was skipped. */
  skipped?: AdoptionResult["skipped"];
  /** The listed references still not on the plan. */
  missing?: SourceReferenceGap[];
  /** Confirmed ids that name no listed reference: nothing to confirm for them. */
  unknownIds?: string[];
  next: string;
}

export interface VerifiedAdoptionInputs {
  planned: Changeset;
  /** The as-built changeset verify compared against, when it compared against one (not the base). */
  asBuilt?: Changeset;
  /** The verify report of planned against what was built. */
  report: Pick<VerifyReport, "sourceReferences">;
  /** Planned element ids whose probable matches the caller confirmed. */
  confirmed?: readonly string[];
  /** The hint for the refusal when planned and asBuilt are the same changeset (wording per caller). */
  sameChangesetHint: string;
}

/**
 * Copy onto the plan the source references a verify report lists in `sourceReferences.missing`:
 * the flow `changeset_adopt_source_references` and `dr changeset verify --adopt-source-references`
 * share. Refuses when the plan and the as-built changeset are the same changeset: codebase_extract
 * leaves its as-built changeset active, so an omitted plan resolves to it, and copying would write
 * the as-built side instead of the plan.
 */
export async function adoptVerifiedSourceReferences(
  model: Model,
  manager: StagingAreaManager,
  inputs: VerifiedAdoptionInputs
): Promise<VerifiedAdoptionReport> {
  const { planned, asBuilt, report } = inputs;
  if (asBuilt && asBuilt.id === planned.id) {
    throw new CLIError(
      `planned and against name the same changeset ('${planned.name}'): nothing to copy onto a plan`,
      ErrorCategory.USER,
      [inputs.sameChangesetHint]
    );
  }
  const gaps = report.sourceReferences?.missing ?? [];
  const { adopted, skipped, unknownIds } = await adoptSourceReferences(model, manager, planned, gaps, {
    confirmed: inputs.confirmed,
  });
  const adoptedIds = new Set(adopted.map((g) => g.planned));
  const left = gaps.filter((g) => !adoptedIds.has(g.planned));
  return {
    plannedChangeset: { id: planned.id, name: planned.name },
    adopted,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(left.length > 0 ? { missing: left } : {}),
    ...(unknownIds && unknownIds.length > 0 ? { unknownIds } : {}),
    next:
      adopted.length > 0
        ? `Copied the source references of ${adopted.length} element(s) onto the plan "${planned.name}"` +
          (left.length > 0 ? `; ${left.length} were not copied (skipped says why)` : "") +
          ". The plan lands with them."
        : gaps.length === 0
          ? "No matched plan element lacks its as-built match's source reference: nothing to copy."
          : "Nothing was copied (skipped says why).",
  };
}
