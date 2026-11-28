/**
 * Landing part of a plan: changeset_commit and changeset_commit_preview with `ids`, `milestone` or
 * `withSourceReference` (#1388). core/partial-landing.ts chooses the part and finds the links that
 * cross its boundary; this is the tool half.
 *
 * What a landing does, in order:
 * 1. refuses, naming the crossing links, unless `crossing` says what to do with them ("include"
 *    brings the far ends of the links along, one level; "leave" keeps those links staged in the plan);
 * 2. writes the chosen changes into a new staged changeset (`<plan>-landed`), under the plan's base;
 * 3. lands that changeset through the ordinary commit (validation, drift, overlaps, rollback): it
 *    is the record of what landed, committed in the manifest's history like any landing;
 * 4. takes those changes out of the plan, which stays staged as the rest, with the part recorded in
 *    its metadata (`landed`), and re-baselines it when nothing but this landing moved the base.
 * If step 3 fails nothing changed: the new changeset is discarded and the plan is as it was. If
 * step 4 fails after 3, the plan still holds changes that landed: nothing is lost, and landing the
 * same part again lands them as already in the base and takes them out.
 */

import { z } from "zod";
import type { Changeset } from "../../core/changeset.js";
import { changesOfPart, planPartialLanding, type CrossingLink, type PartPlan, type PartSelection } from "../../core/partial-landing.js";
import { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, getErrorMessage } from "../../utils/errors.js";
import { jsonResult } from "./shared.js";
import { milestoneArgs, milestoneField } from "./changeset-shared.js";
import { landOne, prepareLanding, refusal, summarizeLanding, type LandedChangeset } from "./changeset-commit.js";
import { filesToCommit } from "./changeset-landed.js";
import path from "node:path";

/** The arguments that choose a part of a plan, shared by changeset_commit and its preview. */
export const partFields = {
  ids: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Land only these elements of the changeset (their staged adds, updates and deletes) and the links between them and " +
        "elements the model will have; the rest stays staged as the plan. Combines with milestone and withSourceReference."
    ),
  milestone: milestoneField,
  withSourceReference: z
    .boolean()
    .optional()
    .describe(
      "Land only the elements the plan ties to code (adds and updates with a source reference): what is built; the rest stays staged."
    ),
  crossing: z
    .enum(["refuse", "include", "leave"])
    .optional()
    .describe(
      "With a part chosen: what to do with staged links between a chosen element and an element the part does not take. " +
        '"refuse" (default): land nothing and list them (changeset_commit_preview lists them too). "include": the far end of ' +
        'each link lands with the part (one level; links from those to others stay staged). "leave": land the part and keep ' +
        "the crossing links staged in the plan."
    ),
};

export interface PartArgs {
  changeset?: string;
  changesets?: string[];
  ids?: string[];
  milestone?: string | string[];
  withSourceReference?: boolean;
  crossing?: "refuse" | "include" | "leave";
  rootPath?: string;
}

/** Whether a call chooses a part of the plan instead of the whole. */
export function choosesPart(args: PartArgs): boolean {
  return !!(args.ids?.length || milestoneArgs(args.milestone).length > 0 || args.withSourceReference);
}

function selectionOf(args: PartArgs): PartSelection {
  return {
    ...(args.ids?.length ? { ids: args.ids } : {}),
    ...(milestoneArgs(args.milestone).length > 0 ? { milestone: milestoneArgs(args.milestone) } : {}),
    ...(args.withSourceReference ? { withSourceReference: true } : {}),
    crossing: args.crossing ?? "refuse",
  };
}

const linkText = (l: CrossingLink) => `${l.source} --${l.predicate}--> ${l.target}`;

/** The crossing links as a sentence-ready listing: every one, with the end that is not in the part. */
function crossingSection(plan: PartPlan, limit = 50) {
  return {
    count: plan.crossing.length,
    links: plan.crossing.slice(0, limit).map((l) => `${linkText(l)} (${l.op === "relationship-add" ? "adds" : "deletes"}; not in the part: ${l.outside})`),
    ...(plan.crossing.length > limit ? { notListed: plan.crossing.length - limit, outsideEnds: [...new Set(plan.crossing.map((l) => l.outside))].sort() } : {}),
  };
}

function crossingRefusal(plan: PartPlan, changesetName: string): CLIError {
  const ends = new Set(plan.crossing.map((l) => l.outside)).size;
  return refusal(
    `${plan.crossing.length} staged link(s) of "${changesetName}" cross the boundary of the part chosen (${plan.selection}): ` +
      `one end lands, the other (${ends} element${ends === 1 ? "" : "s"} the plan adds) does not. Nothing was landed.`,
    [
      ...plan.crossing.slice(0, 10).map((l) => `${linkText(l)}: ${l.outside} is not in the part`),
      ...(plan.crossing.length > 10 ? [`... and ${plan.crossing.length - 10} more: changeset_commit_preview lists them all`] : []),
      'crossing: "include" lands the far ends with the part (one level)',
      'crossing: "leave" lands the part and keeps these links staged in the plan',
      "Or add those elements to ids (or choose by another milestone) and preview again",
    ]
  );
}

/** What the part is, counted: what lands, what stays, what crosses. */
function partSection(plan: PartPlan, changeset: Changeset) {
  return {
    selection: plan.selection,
    crossingPolicy: plan.policy,
    lands: { elements: plan.elements.length, relationships: plan.relationships, changes: plan.sequences.length },
    elements: plan.elements,
    ...(plan.included.length > 0 ? { includedForCrossingLinks: plan.included } : {}),
    stays: { ...plan.remaining, of: changeset.changes.length },
    ...(plan.crossing.length > 0 ? { crossing: crossingSection(plan) } : {}),
    ...(plan.unknownIds.length > 0 ? { unknownIds: plan.unknownIds, unknownNote: "The plan changes none of these ids, so they are not part of it." } : {}),
  };
}

function describePart(plan: PartPlan, changeset: Changeset): string {
  return (
    `Landed from the plan "${changeset.name}": ${plan.selection}. ${plan.elements.length} element(s) and ${plan.relationships} link(s); ` +
    `the plan keeps the other ${plan.remaining.changes} staged change(s).`
  );
}

/** changeset_commit_preview for a part: the checks and summary of landing it, nothing written for good. */
export async function previewPart(args: PartArgs & { changeset: string }) {
  const prepared = await prepareLanding({ changeset: args.changeset, rootPath: args.rootPath });
  if ("answer" in prepared) return jsonResult(prepared.answer);
  const { rootPath, model, manager, changeset } = prepared.landing;
  const plan = await planPartialLanding(model, changeset, selectionOf(args));
  const base = { id: changeset.id, name: changeset.name, partial: partSection(plan, changeset) };
  if (plan.policy === "refuse" && plan.crossing.length > 0) {
    return jsonResult({
      ...base,
      status: "crossing-links",
      summary: crossingRefusal(plan, changeset.name).message,
      next: 'Choose what to do with them: crossing: "include" or "leave" (or change the part), then preview again.',
    });
  }
  // The dry run needs the part as a changeset: made now and discarded before this returns.
  const part = await manager.createPart(changeset, changesOfPart(changeset, plan), describePart(plan, changeset));
  try {
    const target = await prepareLanding({ changeset: part.id!, rootPath: args.rootPath });
    if ("answer" in target) return jsonResult({ ...base, status: "nothing-to-commit", ...target.answer });
    const { message, overlaps } = await summarizeLanding(target.landing, "changeset_commit_preview");
    return jsonResult({
      ...base,
      status: "ready-to-commit",
      drifted: target.landing.hash.isDrifted,
      summary: message.replace(`"${part.name}"`, `part of "${changeset.name}"`),
      overlaps,
      filesToCommit: [...new Set([...(await filesToCommit(rootPath, part)), path.join("documentation-robotics", "changesets", changeset.id!)])].sort(),
      next: "When the user asks to land it, call changeset_commit with the same ids, milestone or withSourceReference (and crossing).",
    });
  } finally {
    await manager.discard(part.id!).catch((error) => console.error(`[mcp] could not discard the preview part '${part.name}': ${getErrorMessage(error)}`));
  }
}

/** changeset_commit for a part: lands it, and leaves the rest of the plan staged. */
export async function landPart(args: PartArgs & { changeset: string }, forceIgnored: boolean): Promise<LandedChangeset> {
  const prepared = await prepareLanding({ changeset: args.changeset, rootPath: args.rootPath });
  if ("answer" in prepared) return prepared.answer as LandedChangeset;
  const { rootPath, model, manager, changeset, hash } = prepared.landing;
  const plan = await planPartialLanding(model, changeset, selectionOf(args));
  if (plan.policy === "refuse" && plan.crossing.length > 0) throw crossingRefusal(plan, changeset.name);

  const part = await manager.createPart(changeset, changesOfPart(changeset, plan), describePart(plan, changeset));
  let landed: LandedChangeset;
  try {
    landed = await landOne(part.id!, args.rootPath, forceIgnored);
  } catch (error) {
    // Nothing landed: the plan is as it was, and the part's changeset goes.
    await manager.discard(part.id!).catch(() => undefined);
    throw error;
  }
  if (landed.status !== "committed") {
    await manager.discard(part.id!).catch(() => undefined);
    return landed;
  }

  const warnings: string[] = [...(landed.warnings ?? [])];
  const record = {
    changeset: part.name,
    id: part.id!,
    at: new Date().toISOString(),
    selection: plan.selection,
    elements: plan.elements,
    relationships: plan.relationships,
    ...(plan.crossing.length > 0 ? { leftStaged: plan.crossing.length } : {}),
  };
  let trimmed = true;
  try {
    await manager.removeLanded(changeset.id!, plan.sequences, record);
  } catch (error) {
    trimmed = false;
    warnings.push(
      `The part landed as "${part.name}", but taking its changes out of the plan "${changeset.name}" failed (${getErrorMessage(error)}). ` +
        "Nothing is lost: the plan still holds them, and landing the same part again lands them as already in the base and takes them out."
    );
  }
  if (trimmed && !hash.isDrifted) {
    // The base moved only by this landing: the rest of the plan reads as current, not drifted.
    try {
      const after = await Model.load(rootPath, { lazyLoad: false });
      await new StagingAreaManager(rootPath, after).rebaseline(changeset.id!);
    } catch (error) {
      warnings.push(`The plan "${changeset.name}" could not be re-baselined after the landing (${getErrorMessage(error)}); it reads as drifted until it is.`);
    }
  }

  const left = await manager.load(changeset.id!);
  const rest = left ?? changeset;
  return {
    ...landed,
    ...(warnings.length > 0 ? { warnings } : {}),
    partOf: {
      plan: { id: changeset.id, name: changeset.name, status: "staged" },
      part: partSection(plan, changeset),
      remaining: trimmed
        ? { changes: rest.changes.length, landedParts: rest.landed?.length ?? 0 }
        : { changes: rest.changes.length, note: "the plan was not trimmed (see warnings)" },
      record: `Landed: changeset "${part.name}" (committed, in the manifest's history). Still planned: "${changeset.name}", staged, with ${rest.changes.length} change(s); it records the part in its metadata.`,
    },
    filesToCommit: [...new Set([...(landed.filesToCommit ?? []), path.join("documentation-robotics", "changesets", changeset.id!)])].sort(),
  } as LandedChangeset;
}
