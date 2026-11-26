/**
 * Staged plans in the other checkouts of a project (#1368), for changeset_create and
 * project_status: what the central process's farm knows about a project's worktrees, read now.
 * When the farm can't tell (no project owns the folder, the registry failed), the section says so
 * with the reason; it never shows none in place of "could not look".
 */

import type { SiblingPlan } from "../../core/checkout-types.js";
import { matchSiblingPlans, type PlanCandidate, type SiblingPlanMatch } from "../../core/sibling-plans.js";
import { getErrorMessage } from "../../utils/errors.js";
import { DEFAULT_CENTRAL_DEPS, resolveSessionCheckout, type CentralDeps } from "./central-viewer.js";

export type SiblingPlansSection =
  | { status: "ok"; plans: SiblingPlan[]; /** What could not be read: an empty `plans` is "none" only without these. */ notes: string[] }
  | { status: "unavailable"; reason: string };

/** The staged plans in the other checkouts of the project `dir` is in. */
export async function collectSiblingPlans(
  dir: string,
  deps: Pick<CentralDeps, "openRegistry"> = DEFAULT_CENTRAL_DEPS
): Promise<SiblingPlansSection> {
  try {
    const session = await resolveSessionCheckout(dir, { deps });
    if (!session) {
      return {
        status: "unavailable",
        reason: `No project in the farm owns ${dir}, so the farm can't say what other checkouts of this project have staged.`,
      };
    }
    const { ref } = session.resolved;
    const { plans, notes } = await session.registry.siblingPlans(ref.project, ref.checkout);
    return { status: "ok", plans, notes };
  } catch (error) {
    return {
      status: "unavailable",
      reason: `The farm could not list other checkouts' plans: ${getErrorMessage(error)}`,
    };
  }
}

/** A section's sentence, or what to do about it, for the agent planning here. */
export function siblingPlansWarning(matches: SiblingPlanMatch[]): string {
  const lines = matches.map(
    ({ plan, reasons }) =>
      `"${plan.name}" in checkout ${plan.checkout}${plan.branch ? ` (branch ${plan.branch})` : ""}: ${reasons.join(", ")}`
  );
  return (
    `A plan that looks like this one is already staged in another checkout: ${lines.join("; ")}. ` +
    "Read it (in that checkout's changesets folder, under its path) before planning the same work twice; " +
    "if it is the same work, discard this plan (changeset_discard, with the user's say) and continue there. This is a warning: nothing was refused."
  );
}

export { matchSiblingPlans };
export type { PlanCandidate };

/** The fields changeset_create adds for the plans staged in other checkouts: nothing when there are none and all was read. */
export function siblingPlanFields(
  section: SiblingPlansSection,
  matches: SiblingPlanMatch[]
): Record<string, unknown> {
  if (section.status === "unavailable") {
    return { siblingPlans: { status: "unavailable", reason: section.reason } };
  }
  const notes = section.notes.length > 0 ? { siblingPlansNotRead: section.notes } : {};
  if (section.plans.length === 0) return notes;
  return {
    ...notes,
    siblingPlans: section.plans.map(shortPlan),
    ...(matches.length > 0 ? { siblingWarning: siblingPlansWarning(matches) } : {}),
  };
}

const DESCRIPTION_SHOWN = 200;

/** A sibling plan as a result lists it: its intent cut short (read it in full in its checkout). */
export function shortPlan(plan: SiblingPlan): Omit<SiblingPlan, "path" | "description"> & { path: string; description?: string } {
  const description = plan.description?.trim();
  return {
    ...plan,
    ...(description
      ? { description: description.length > DESCRIPTION_SHOWN ? `${description.slice(0, DESCRIPTION_SHOWN)}…` : description }
      : {}),
  };
}
