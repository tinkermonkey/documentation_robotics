/**
 * Changeset Commands - Manage model change tracking and versioning
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { overlapKinds, type OverlapKind } from "../core/changeset-base-index.js";
import type { Changeset } from "../core/changeset.js";
import { VerificationRecordLandingError, allowedActions, type RecordLandingError } from "../core/changeset-purpose.js";
import { summarizeChangeset } from "../core/changeset-summary.js";
import { descriptionExcerpt, descriptionLines } from "../core/changeset-description.js";
import { resolveOrigin } from "../core/changeset-review.js";
import { originLabel } from "../core/changeset.js";
import { ChangesetExporter } from "../core/changeset-exporter.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";
import { Command, Option } from "commander";
import * as prompts from "@clack/prompts";
import path from "path";
import { isTelemetryEnabled, startSpan, endSpan, startActiveSpan } from "../telemetry/index.js";
import { CLIError, ErrorCategory, getErrorMessage, handleSuccess, handleInfo, handleWarning } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { findElementLayer } from "../utils/element-utils.js";
import { changesetVerifyCommand } from "./changeset-verify.js";

/**
 * Generate a unique ID for imported changesets
 */
function generateImportedChangesetId(): string {
  return `imported-${Date.now()}`;
}

/**
 * Create a new changeset
 */
export async function changesetCreateCommand(
  name: string,
  options: {
    model?: string;
    /** The change's intent, as markdown (#1433); `description` is its older name. */
    intent?: string;
    description?: string;
  }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.create", {
        "changeset.name": name,
        "changeset.hasDescription": !!(options.intent ?? options.description),
      })
    : null;

  try {
    // Load with lazyLoad: false to ensure consistent snapshot hashing
    // (base snapshot must include all layers for accurate drift detection)
    const model = await Model.load(options.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    // Check if changeset already exists
    const existing = await manager.load(name);
    if (existing) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: `Changeset '${name}' already exists` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${name}' already exists`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset already exists" });
      }
      endSpan(span);
      process.exit(1);
    }

    // The intent, under either name; two different ones can't both be meant
    if (options.intent !== undefined && options.description !== undefined && options.intent !== options.description) {
      throw new Error("--intent and --description name the same thing, and they differ: pass one of them");
    }
    let description = options.intent ?? options.description;
    if (!description) {
      const isInteractive = process.stdin.isTTY;
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("cli.interactive", isInteractive);
      }
      if (isInteractive) {
        const result = await prompts.text({
          message: "The change's intent (optional; markdown)",
        });

        if (typeof result === "string") {
          description = result;
        }
      }
    }

    // Made from the CLI, unless DrBot (in `dr visualize`) runs this command.
    const changeset = await manager.create(name, description || undefined, resolveOrigin("cli"));

    // Activate immediately so add/update/delete commands stage into this changeset
    const previouslyActive = await manager.getActiveId();
    if (previouslyActive && !isJson()) {
      const previous = await manager.load(previouslyActive);
      console.log(ansis.yellow(`  Deactivating changeset: ${ansis.bold(previous?.name ?? previouslyActive)}`));
    }
    await manager.setActive(changeset.id);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", changeset.id);
      (span as any).setStatus({ code: 0 });
    }

    const createDetails: Record<string, unknown> = {
      changesetId: changeset.id,
      changesetName: name,
      path: `documentation-robotics/changesets/${changeset.id}/`,
    };
    if (changeset.description) {
      createDetails.description = changeset.description;
    }
    handleSuccess(`Created and activated changeset: ${ansis.bold(name)}`, createDetails, { verbose: true });
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * List all changesets
 */
export async function changesetListCommand(options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.list") : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const changesets = await manager.list();

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.count", changesets.length);
    }

    if (changesets.length === 0) {
      console.log(ansis.yellow("No changesets found"));
      console.log();
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    console.log(ansis.bold(`\nChangesets (${changesets.length}):\n`));

    for (const changeset of changesets) {
      const statusColor =
        changeset.status === "committed"
          ? ansis.green
          : changeset.status === "discarded"
            ? ansis.gray
            : ansis.yellow; // "staged" status shows yellow

      const { purpose } = await manager.purposeOf(changeset);
      console.log(
        `${statusColor(changeset.status.toUpperCase())} ${ansis.bold(changeset.name)} ${ansis.dim(`(${purpose})`)}`
      );

      // The description is markdown and can run to many lines: its first line here, all of it in show.
      const excerpt = descriptionExcerpt(changeset.description);
      if (excerpt) {
        console.log(ansis.dim(`  ${excerpt}`));
      }

      console.log(
        ansis.dim(
          `  Changes: ${changeset.getChangeCount()} | Created: ${new Date(
            changeset.created
          ).toLocaleDateString()}`
        )
      );

      const changesByType = {
        add: changeset.getChangesByType("add").length,
        update: changeset.getChangesByType("update").length,
        delete: changeset.getChangesByType("delete").length,
      };

      const parts = [];
      if (changesByType.add > 0) parts.push(`+${changesByType.add}`);
      if (changesByType.update > 0) parts.push(`~${changesByType.update}`);
      if (changesByType.delete > 0) parts.push(`-${changesByType.delete}`);

      if (parts.length > 0) {
        console.log(ansis.dim(`  ${parts.join(" ")}`));
      }

      console.log();
    }
    console.log(ansis.dim("dr changeset show <name> prints one in full: its whole description and each change."));
    console.log();

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Report how a commit's validation went beyond pass/fail: that it was skipped, or how
 * many errors already in the base model were not counted against the changeset.
 * Adds the fields to `details` and, in text mode, prints a warning line.
 */
function reportCommitValidation(
  result: { validation: { ran?: boolean; preExistingErrors?: number; preExistingSample?: string[] } },
  details: Record<string, unknown>
): void {
  if (result.validation.ran === false) {
    // Nothing was validated, so there is no pass to report.
    delete details.validationPassed;
    details.validationSkipped = true;
    if (!isJson()) {
      console.log(ansis.yellow(`⚠ Validation skipped (--no-validate); run 'dr validate' to check the result`));
    }
    return;
  }
  const preExisting = result.validation.preExistingErrors ?? 0;
  details.preExistingErrors = preExisting;
  if (preExisting > 0) {
    details.preExistingSample = result.validation.preExistingSample ?? [];
    if (!isJson()) {
      console.log(
        ansis.yellow(
          `⚠ ${preExisting} validation error(s) already in the base model were ignored; ` +
            `the changeset introduced none. Run 'dr validate' to see them.`
        )
      );
    }
  }
}

/**
 * Records whether the commit deactivated the changeset, and warns when it landed but is still the
 * active changeset (StagingAreaManager.commit could not clear the marker).
 */
function reportDeactivation(
  result: { deactivated: boolean; deactivationError?: string },
  details: Record<string, unknown>
): void {
  details.deactivated = result.deactivated;
  if (result.deactivationError) {
    details.deactivationError = result.deactivationError;
    handleWarning(
      `The changeset was committed, but its active-changeset marker could not be cleared (${result.deactivationError}). ` +
        "The marker is ignored, since a committed changeset is never the active one.",
      ["Run 'dr changeset deactivate' once the cause is fixed, to remove the marker"]
    );
  }
}

/** What a landing from the CLI does about staged changes the base overlaps. */
export type OverlapDecision = "land" | "ask" | "refuse";

/**
 * Whether a CLI landing goes ahead when the base overlaps what the changeset stages.
 *
 * Drift never refuses a landing by itself, but someone has to have read what it will do: through
 * MCP and the viewer a person reads the overlaps before confirming. On the CLI, with a terminal the
 * person is asked. With none (a script, CI) nobody reads them, and a staged update made on older
 * content would replace newer base content and exit 0, so it is refused unless `--force` says to
 * land it anyway. With no overlap (the base is as it was, or changed elsewhere) there is nothing to
 * read and it lands.
 */
export function overlapDecision(overlaps: number, options: { force?: boolean; interactive: boolean }): OverlapDecision {
  if (overlaps === 0 || options.force === true) return "land";
  return options.interactive ? "ask" : "refuse";
}

/** Every overlap, grouped by what landing does about it, as lines: the true count first, nothing left out. */
export function overlapReport(kinds: OverlapKind[]): string[] {
  const total = kinds.reduce((n, kind) => n + kind.items.length, 0);
  const lines = [`The base model overlaps ${total} staged change(s). Landing would do this:`];
  for (const kind of kinds) {
    lines.push(`  - ${kind.reason}, ${kind.items.length} ${kind.of}(s): ${kind.consequence}`);
    for (const item of kind.items) lines.push(`      ${item}`);
  }
  return lines;
}

/**
 * The CLI's check before a landing (`dr changeset commit` and `dr changeset apply`): reads what the
 * base overlaps, and lands, asks or refuses (overlapDecision). Resolves to false when the person
 * was asked and said no; throws the refusal when no one could be asked.
 */
export async function landsOverOverlaps(
  manager: Pick<StagingAreaManager, "detectDrift">,
  changeset: Changeset,
  options: {
    force?: boolean;
    /** Whether a person is at a terminal to be asked. Default: stdin and stdout are terminals and output is not JSON. */
    interactive?: boolean;
    /** Asks the person; default a prompt that answers no unless they say yes. */
    confirm?: (message: string) => Promise<boolean>;
  } = {}
): Promise<boolean> {
  const confirm =
    options.confirm ?? (async (message: string) => (await prompts.confirm({ message, initialValue: false })) === true);
  const report = await manager.detectDrift(changeset);
  const kinds = report.isDrifted && report.described ? overlapKinds(report.described) : [];
  const total = kinds.reduce((n, kind) => n + kind.items.length, 0);
  const interactive = options.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY && !isJson());
  const decision = overlapDecision(total, { force: options.force, interactive });
  if (decision === "land") {
    // Nothing to ask about, but the base did move: say so, and what could not be checked.
    const notChecked = report.described?.notChecked?.sentence;
    if (!isJson() && (report.contentFree || report.isDrifted || notChecked) && total === 0) {
      console.log(
        ansis.yellow(
          (report.currentSnapshotId !== report.baseSnapshotId
            ? "⚠ The base model changed since this changeset was created; nothing it stages was found to overlap the change."
            : "⚠ Nothing this changeset stages was found to overlap the base.") + (notChecked ? ` ${notChecked}` : "")
        )
      );
    }
    return true;
  }

  const lines = overlapReport(kinds);
  if (report.described?.notChecked) lines.push(`  ${report.described.notChecked.sentence}`);
  if (decision === "ask") {
    console.log(ansis.yellow(`\n⚠ ${lines[0]}`));
    for (const line of lines.slice(1)) console.log(ansis.yellow(line));
    console.log();
    return confirm(`Land changeset '${changeset.name}' over ${total === 1 ? "this overlap" : `these ${total} overlaps`}?`);
  }
  throw new CLIError(
    `Changeset '${changeset.name}' was not committed: ${lines[0].replace("Landing would do this:", "No one is at a terminal to read what landing would do, so nothing was written.")}\n` +
      lines.slice(1).join("\n"),
    ErrorCategory.USER,
    [
      "Every overlap is listed above. Resolve them in the plan (restage on the current base, or unstage), or",
      "run the command in a terminal to be asked, or pass --force to land it over them",
    ]
  );
}

/**
 * Apply a changeset to the model
 */
export async function changesetApplyCommand(
  name: string,
  options?: { model?: string; validate?: boolean; force?: boolean }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.apply", {
        "changeset.name": name,
        "apply.validate": options?.validate !== false,
        "apply.force": options?.force === true,
      })
    : null;

  try {
    const model = await Model.load(options?.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${name}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${name}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", changeset.id);
      (span as any).setAttribute("changeset.changeCount", changeset.changes.length);
    }

    if (!isJson()) {
      console.log(ansis.bold(`\nApplying changeset: ${ansis.cyan(name)}\n`));
      console.log(ansis.dim(`Changes: ${changeset.changes.length}`));

      // Show model health snapshot (base model, before this changeset is applied).
      // This intentionally reflects the pre-apply state so agents see what was already
      // present, not what the changeset is about to add.
      const preApplyStats = ValidationFormatter.calculateStats(model);
      if (preApplyStats.orphanedElements.length > 0) {
        console.log(ansis.dim(
          `Model health before apply: ${preApplyStats.orphanedElements.length} orphaned element(s) — run 'dr validate --orphans' for details`
        ));
      }
    }

    const changesetId = changeset.id || name;
    if (!changesetId) {
      const errMsg = "Changeset ID could not be determined";
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: errMsg }));
      } else {
        console.error(
          ansis.red("Error: " + errMsg) +
            "\n" +
            ansis.dim(
              "This indicates a corrupted changeset. The changeset exists but has no ID field."
            ) +
            "\n" +
            ansis.dim(`Try:\n`) +
            ansis.dim(`  1. Run 'dr changeset list' to see available changesets\n`) +
            ansis.dim(`  2. Delete and recreate the changeset if possible\n`) +
            ansis.dim(`  3. Contact support if this persists`)
        );
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset ID missing" });
      }
      endSpan(span);
      process.exit(1);
    }
    // Someone has to have read what landing does about overlaps: ask, or refuse without --force.
    if (!(await landsOverOverlaps(manager, changeset, { force: options?.force }))) {
      handleInfo("Not applied. Nothing was written.");
      return;
    }
    const result = await manager.apply(model, changesetId, {
      validate: options?.validate,
    });

    handleInfo("");

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("apply.committed", result.committed);
      (span as any).setAttribute("apply.failed", result.failed);
      (span as any).setAttribute("apply.validationPassed", result.validation.passed);
    }

    const applyDetails: Record<string, unknown> = {
      changesetName: name,
      changesetId: changeset.id,
      committed: result.committed,
      failed: result.failed,
      validationPassed: result.validation.passed,
    };
    reportCommitValidation(result, applyDetails);
    reportDeactivation(result, applyDetails);

    if (result.failed > 0) {
      applyDetails.errors = result.validation.errors;
      if (!isJson()) {
        handleInfo(ansis.red(`✗ Failed to apply ${result.failed} change(s):`));
        for (const error of result.validation.errors) {
          handleInfo(ansis.dim(`  - ${error}`));
        }
      }
    }

    // Always show applied message, even if 0 changes
    handleSuccess(`Applied ${result.committed} change(s) from changeset`, applyDetails);

    // manager.apply (StagingAreaManager.commit) already recorded the changeset in the manifest
    // history and saved the manifest; recording it here again would list it twice.
    await model.saveDirtyLayers();
    await model.saveManifest();

    if (result.failed === 0) {
      handleInfo(ansis.dim(`Changeset marked as committed`));
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    handleInfo("");
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Revert a changeset from the model
 */
export async function changesetRevertCommand(name: string, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.revert", {
        "changeset.name": name,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${name}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${name}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", changeset.id);
      (span as any).setAttribute("changeset.changeCount", changeset.changes.length);
    }

    if (!isJson()) {
      console.log(ansis.bold(`\nReverting changeset: ${ansis.cyan(name)}\n`));
      console.log(ansis.dim(`Changes to discard: ${changeset.changes.length}`));
    }

    const changesetId = changeset.id || name;
    if (!changesetId) {
      const errMsg = "Changeset ID could not be determined";
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: errMsg }));
      } else {
        console.error(
          ansis.red("Error: " + errMsg) +
            "\n" +
            ansis.dim("The changeset must have an ID to proceed with revert.")
        );
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset ID missing" });
      }
      endSpan(span);
      process.exit(1);
    }
    const was = await manager.revert(changesetId);

    handleInfo("");

    // Show reverted message
    handleSuccess(`Reverted changeset: ${name}`, {
      changesetName: name,
      changesetId,
      changesetStatus: "discarded",
    });
    if (was === "committed") {
      // Revert never undid a landing: say so rather than let "Reverted" imply it.
      handleInfo(
        ansis.dim("This changeset was already applied. Its record is now discarded; the model keeps the changes it applied.")
      );
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    handleInfo("");
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Activate a changeset for automatic tracking
 */
export async function changesetActivateCommand(name: string, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.activate", {
        "changeset.name": name,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await manager.load(name);
    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${name}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${name}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }
    await manager.setActive(name);

    handleSuccess(`Activated changeset: ${ansis.bold(name)}`, {
      changesetName: name,
      changesetId: changeset.id,
    });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/** "'name', which is committed" / "changeset-1, which is missing", for a marker left behind. */
function staleMarkerLabel(stale: { id: string; name?: string; status: string }): string {
  return `${stale.name ? `'${stale.name}'` : stale.id}, which is ${stale.status}`;
}

/**
 * Deactivate the current changeset
 */
export async function changesetDeactivateCommand(options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.deactivate") : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();

    if (!active) {
      // A marker left behind by a changeset that is no longer staged: it is not the active
      // changeset, but deactivating is the moment to remove it.
      const stale = await manager.staleActiveMarker();
      if (stale) await manager.clearActive();
      handleInfo(
        ansis.yellow(
          stale
            ? `No active changeset (cleared a marker left by ${staleMarkerLabel(stale)})`
            : "No active changeset"
        )
      );
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("changeset.wasActive", false);
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.name", active);
      (span as any).setAttribute("changeset.wasActive", true);
    }

    const changeset = await manager.load(active);
    await manager.clearActive();
    handleSuccess(`Deactivated changeset: ${ansis.bold(active)}`, {
      changesetId: active,
      name: changeset?.name || active,
    });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Delete a changeset permanently
 */
export async function changesetDeleteCommand(
  name: string,
  options: {
    model?: string;
    force?: boolean;
  }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.delete", {
        "changeset.name": name,
        "delete.force": options.force === true,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${name}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${name}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Check if changeset is currently active (compare by ID, not user-provided name)
    const active = await manager.getActiveId();
    if (active === changeset.id) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: `Cannot delete active changeset '${name}'` }));
      } else {
        console.error(ansis.red(`Error: Cannot delete active changeset '${name}'`));
        console.log(ansis.dim("  Run `dr changeset deactivate` first"));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Cannot delete active changeset" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Confirm deletion unless --force is used or in non-interactive environment
    if (!options.force) {
      const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("cli.interactive", isInteractive);
      }
      if (isInteractive) {
        const confirm = await prompts.confirm({
          message: `Delete changeset '${name}'? This cannot be undone.`,
        });

        if (!confirm || typeof confirm !== "boolean") {
          handleSuccess("Deletion cancelled", {
            status: "cancelled",
          });
          if (isTelemetryEnabled && span) {
            (span as any).setAttribute("delete.cancelled", true);
            (span as any).setStatus({ code: 0 });
          }
          endSpan(span);
          return;
        }
      } else {
        // In non-interactive environment, require --force flag
        if (isJson()) {
          console.log(JSON.stringify({ status: "error", code: 1, message: "Cannot confirm deletion in non-interactive environment" }));
        } else {
          console.error(ansis.red("Error: Cannot confirm deletion in non-interactive environment"));
          console.log(ansis.dim("  Use --force flag to confirm deletion"));
        }
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "Interactive confirmation required" });
        }
        endSpan(span);
        process.exit(1);
      }
    }

    await manager.delete(name);

    handleSuccess(`Deleted changeset: ${ansis.bold(name)}`, {
      changesetName: name,
      changesetId: changeset.id,
    });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Show the currently active changeset
 */
export async function changesetStatusCommand(options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.status") : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();

    if (!active) {
      console.log(ansis.dim("No active changeset"));
      const stale = await manager.staleActiveMarker();
      if (stale) {
        console.log(
          ansis.dim(`  The active-changeset marker names ${staleMarkerLabel(stale)}; it is ignored, and writes go to the base model`)
        );
      }
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("changeset.hasActive", false);
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.name", active);
      (span as any).setAttribute("changeset.hasActive", true);
    }

    console.log(ansis.bold(`Active changeset: ${ansis.cyan(active)}`));

    // Load and show changeset details
    const changeset = await manager.load(active);

    if (changeset) {
      console.log(ansis.dim(`  Changes tracked: ${changeset.changes.length}`));
      const changesByType = changeset.stats;

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("changeset.changeCount", changeset.changes.length);
        (span as any).setAttribute("changeset.adds", changesByType.additions);
        (span as any).setAttribute("changeset.updates", changesByType.modifications);
        (span as any).setAttribute("changeset.deletes", changesByType.deletions);
      }

      const parts = [];
      if (changesByType.additions > 0) parts.push(`+${changesByType.additions}`);
      if (changesByType.modifications > 0) parts.push(`~${changesByType.modifications}`);
      if (changesByType.deletions > 0) parts.push(`-${changesByType.deletions}`);
      if (parts.length > 0) {
        console.log(ansis.dim(`  ${parts.join(" ")}`));
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * The changeset a read command (show, staged, diff, preview) names, by name or id and in any
 * state (an upgrade record or a committed changeset too), or the active one when it names none.
 * When there is neither, what to say instead: `noActive` when nothing was named and none is
 * active, so the caller keeps its own wording for that case.
 */
export async function changesetForCommand(
  manager: StagingAreaManager,
  named: string | undefined
): Promise<{ changeset: Changeset } | { error: string; noActive?: true }> {
  if (named) {
    const changeset = await manager.load(named);
    return changeset
      ? { changeset }
      : { error: `Changeset '${named}' not found. dr changeset list shows every changeset by name.` };
  }
  const activeId = await manager.getActiveId();
  const changeset = activeId ? await manager.load(activeId) : null;
  return changeset ? { changeset } : { error: "No active changeset", noActive: true };
}

/** Print a read command's refusal, as JSON or text, and exit 1. */
function failRead(error: string, span: unknown): never {
  if (isJson()) {
    console.log(JSON.stringify({ status: "error", code: 1, message: error }));
  } else {
    console.error(ansis.red(`Error: ${error}`));
  }
  if (isTelemetryEnabled && span) {
    (span as any).setStatus({ code: 2, message: error });
  }
  endSpan(span as any);
  process.exit(1);
}

/** The line `dr changeset show` prints for one change of the summary (changeset-summary.ts). */
function changeLine(change: ReturnType<typeof summarizeChangeset>["changes"][number]): string {
  const mark = change.operation.endsWith("add") ? "+" : change.operation.endsWith("delete") ? "-" : "~";
  const what = change.elementId
    ? `${change.elementId}${change.elementType ? ` (${change.elementType})` : ""}`
    : `${change.source} --${change.predicate}--> ${change.target}`;
  const fields = change.changedFields?.length ? `: ${change.changedFields.join(", ")}` : "";
  const origin = change.origin ? `  [${change.origin}]` : "";
  return `${mark} #${change.sequence} ${what}${fields}${origin}`;
}

/**
 * Show one changeset, whatever its state or purpose (the active one when none is named): its
 * status, purpose and the actions its state allows, its description as written (markdown, line
 * breaks kept), and one line per change. --json returns what changeset_show with detail "summary"
 * returns, so a reader of either gets the same fields (#1219).
 */
export async function changesetShowCommand(name: string | undefined, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.show", { "changeset.named": !!name }) : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const found = await changesetForCommand(manager, name);
    if ("error" in found) {
      failRead(found.noActive ? "No active changeset: name one (dr changeset list shows them)" : found.error, span);
    }
    const { changeset } = found;
    const { purpose, verifies, scope } = await manager.purposeOf(changeset);
    const actions = allowedActions(purpose, changeset.status);
    const summary = summarizeChangeset(changeset.changes);
    const active = (await manager.getActiveId()) === changeset.id;

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.changeCount", changeset.changes.length);
      (span as any).setAttribute("changeset.purpose", purpose);
      (span as any).setStatus({ code: 0 });
    }

    if (isJson()) {
      console.log(
        JSON.stringify({
          id: changeset.id,
          name: changeset.name,
          description: changeset.description,
          status: changeset.status,
          active,
          created: changeset.created,
          modified: changeset.modified,
          detail: "summary",
          ...(changeset.origin ? { origin: changeset.origin } : {}),
          purpose,
          ...(verifies ? { verifies } : {}),
          ...(scope ? { scope } : {}),
          actions,
          totals: summary.totals,
          changes: summary.changes,
        })
      );
      return;
    }

    console.log(ansis.bold(`\nChangeset ${ansis.cyan(changeset.name)}${active ? ansis.green(" (active)") : ""}`));
    console.log(ansis.dim(`  Id: ${changeset.id}`));
    const verifying = verifies ? ` (verifies ${verifies})` : "";
    console.log(ansis.dim(`  Status: ${changeset.status} | Purpose: ${purpose}${verifying}`));
    console.log(ansis.dim(`  Actions: ${actions.length > 0 ? actions.join(", ") : "none"}`));
    const created = new Date(changeset.created).toLocaleString();
    console.log(ansis.dim(`  Created: ${created} | Modified: ${new Date(changeset.modified).toLocaleString()}`));
    if (changeset.origin) {
      const { kind, detail } = changeset.origin;
      console.log(ansis.dim(`  Origin: ${kind}${detail ? ` (${detail})` : ""}`));
    }

    const description = descriptionLines(changeset.description);
    if (description.length > 0) {
      console.log(ansis.bold("\nDescription\n"));
      for (const line of description) console.log(line);
    }

    // Every operation with changes, relationship ones included
    const { total, ...byOperation } = summary.totals;
    const counts = Object.entries(byOperation)
      .filter(([, count]) => count > 0)
      .map(([operation, count]) => `${operation} ${count}`)
      .join(", ");
    console.log(ansis.bold(`\nChanges (${total})`) + ansis.dim(counts ? `  ${counts}\n` : "\n"));
    for (const change of summary.changes) {
      console.log(`  ${changeLine(change)}`);
    }
    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: getErrorMessage(error) });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * List the staged changes of the changeset named (by name or id, in any state), or of the active
 * one when none is named.
 */
export async function changesetStagedCommand(
  name: string | undefined,
  options: { model?: string; layer?: string }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.staged", {
        "staged.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const found = await changesetForCommand(manager, name);

    if ("error" in found) {
      if (found.noActive) {
        // As before #1219: nothing named and nothing active is said, not a failure.
        if (isJson()) {
          console.log(JSON.stringify({ status: "error", code: 1, message: "No active changeset" }));
        } else {
          console.error(ansis.red("Error: No active changeset"));
        }
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "No active changeset" });
        }
        endSpan(span);
        return;
      }
      failRead(found.error, span);
    }

    const { changeset } = found;
    const changesetId = changeset.id;

    let changes = changeset.changes;

    if (options.layer) {
      changes = changes.filter((c: any) => c.layerName === options.layer);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("staged.changeCount", changes.length);
      (span as any).setAttribute("staged.totalChanges", changeset.changes.length);
    }

    if (changes.length === 0) {
      handleSuccess("No staged changes", {
        changesetId,
        changeCount: 0,
        changes: [],
      }, { verbose: true });
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    if (!isJson()) {
      console.log(ansis.bold(`\nStaged Changes (${changes.length}):`) + ansis.dim(` ${changeset.name}\n`));
      // The Origin column (who decided each change) only when codebase_extract staged some.
      const withOrigin = changes.some((c) => !!c.origin);
      const tableData = changes.map((c: any) => ({
        "Element ID": c.elementId,
        Layer: c.layerName,
        Type: c.type,
        ...(withOrigin ? { Origin: c.origin ? originLabel(c.origin) : "" } : {}),
        Timestamp: new Date(c.timestamp || Date.now()).toISOString(),
      }));
      console.table(tableData);
    }

    handleSuccess(`Listed ${changes.length} staged change(s)`, {
      changesetId,
      changesetName: changeset.name,
      changeCount: changes.length,
      changes: changes.map((c: any) => ({
        elementId: c.elementId,
        layer: c.layerName,
        operation: c.type,
        ...(c.origin ? { origin: c.origin, originLabel: originLabel(c.origin) } : {}),
        timestamp: new Date(c.timestamp || Date.now()).toISOString(),
      })),
    });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Remove specific element from staging area
 */
export async function changesetExplicitStageCommand(elementId: string, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.stage-explicit", { "stage.elementId": elementId })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: "No active changeset" }));
      } else {
        console.error(ansis.red("Error: No active changeset"));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const layerName = await findElementLayer(model, elementId);
    if (!layerName) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Element '${elementId}' not found` }));
      } else {
        console.error(ansis.red(`Error: Element '${elementId}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Element not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    const layer = await model.getLayer(layerName);
    const element = layer?.getElement(elementId);
    if (!element) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Element '${elementId}' not found in layer '${layerName}'` }));
      } else {
        console.error(ansis.red(`Error: Element '${elementId}' not found in layer '${layerName}'`));
      }
      endSpan(span);
      process.exit(1);
    }

    // Guard against staging the same element twice
    const activeChangeset = await manager.load(activeChangesetId);
    if (activeChangeset?.changes.some((c: any) => c.elementId === elementId)) {
      console.warn(ansis.yellow(`Warning: Element '${elementId}' is already staged in the active changeset. Skipping.`));
      endSpan(span);
      return;
    }

    await manager.stage(activeChangesetId, {
      type: "add",
      elementId,
      layerName,
      after: element.toJSON() as unknown as Record<string, unknown>,
    });

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("stage.layerName", layerName);
      (span as any).setStatus({ code: 0 });
    }

    handleSuccess(`Staged element: ${elementId}`, {
      elementId,
      layer: layerName,
      changesetId: activeChangesetId,
      operation: "add",
    }, { verbose: true });
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: getErrorMessage(error) });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

export async function changesetUnstageCommand(elementId: string, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.unstage", {
        "unstage.elementId": elementId,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: "No active changeset" }));
      } else {
        console.error(ansis.red("Error: No active changeset"));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${activeChangesetId}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      }
      process.exit(1);
    }

    // Check if element exists in changes
    const initialCount = changeset.changes.length;

    // Use the manager's unstage method
    await manager.unstage(activeChangesetId, elementId);

    // Reload to get updated count
    const updated = await manager.load(activeChangesetId);

    if (updated && updated.changes.length === initialCount) {
      handleWarning(`Element '${elementId}' not found in staged changes`);
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("unstage.found", false);
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("unstage.found", true);
      (span as any).setAttribute("unstage.remainingChanges", updated?.getChangeCount() || 0);
    }

    handleSuccess(`Unstaged element: ${elementId}`, {
      changesetId: activeChangesetId,
      elementId,
      remainingChanges: updated?.getChangeCount() || 0,
    }, { verbose: true });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Discard all or single staged changes
 */
export async function changesetDiscardCommand(elementId?: string, options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.discard", {
        "discard.elementId": elementId,
        "discard.all": !elementId,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: "No active changeset" }));
      } else {
        console.error(ansis.red("Error: No active changeset"));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${activeChangesetId}' not found` }));
      } else {
        console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("discard.changeCount", changeset.changes.length);
    }

    if (elementId) {
      // Discard single element
      const initialCount = changeset.changes.length;

      // Use the manager's unstage method for single element
      await manager.unstage(activeChangesetId, elementId);

      // Reload to verify
      const updated = await manager.load(activeChangesetId);

      if (updated && updated.changes.length === initialCount) {
        handleWarning(`Element '${elementId}' not found in staged changes`);
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute("discard.found", false);
          (span as any).setStatus({ code: 0 });
        }
        endSpan(span);
        return;
      }

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("discard.found", true);
      }

      handleSuccess(`Discarded changes for element: ${elementId}`, {
        elementId,
      }, { verbose: true });
    } else {
      // Discard all changes with confirmation
      const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("cli.interactive", isInteractive);
      }

      if (isInteractive) {
        const confirmed = await prompts.confirm({
          message: `Discard all ${changeset.changes.length} staged changes? This cannot be undone.`,
        });

        if (!confirmed || typeof confirmed !== "boolean") {
          handleSuccess("Discard cancelled", {
            status: "cancelled",
          });
          if (isTelemetryEnabled && span) {
            (span as any).setAttribute("discard.cancelled", true);
            (span as any).setStatus({ code: 0 });
          }
          endSpan(span);
          return;
        }
      } else {
        // In non-interactive environment, require explicit flag or piped input
        console.error(
          ansis.red("Error: Cannot confirm discard of all changes in non-interactive environment")
        );
        console.log(ansis.dim("  Specify an element ID to discard only that element"));
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "Interactive confirmation required" });
        }
        endSpan(span);
        process.exit(1);
      }

      // Use the manager's discard method for all changes
      await manager.discard(activeChangesetId);

      handleSuccess(`Discarded all staged changes`, {
        changesetStatus: "discarded",
      }, { verbose: true });
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    if (!isJson()) {
      console.log();
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Preview the merged model state with the staged changes of the changeset named (by name or id,
 * in any state), or of the active one when none is named.
 */
export async function changesetPreviewCommand(
  name: string | undefined,
  options: { model?: string; layer?: string }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.preview", {
        "preview.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const found = await changesetForCommand(manager, name);

    if ("error" in found) {
      if (found.noActive) {
        // As before #1219: nothing named and nothing active is said, not a failure.
        console.error(ansis.red("Error: No active changeset"));
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "No active changeset" });
        }
        endSpan(span);
        return;
      }
      failRead(found.error, span);
    }

    const { changeset } = found;

    console.log(ansis.bold(`\nPreview: Merged Model State (${ansis.cyan("with staged changes")})`));
    console.log(ansis.dim(`Changeset: ${changeset.name}`));
    console.log();

    // Show summary of changes
    const additions = changeset.getChangesByType("add").length;
    const modifications = changeset.getChangesByType("update").length;
    const deletions = changeset.getChangesByType("delete").length;

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("preview.additions", additions);
      (span as any).setAttribute("preview.modifications", modifications);
      (span as any).setAttribute("preview.deletions", deletions);
      (span as any).setAttribute("preview.totalChanges", changeset.changes.length);
    }

    if (additions > 0) {
      console.log(ansis.green(`+ ${additions} additions`));
    }
    if (modifications > 0) {
      console.log(ansis.yellow(`~ ${modifications} modifications`));
    }
    if (deletions > 0) {
      console.log(ansis.red(`- ${deletions} deletions`));
    }

    console.log();

    if (options.layer) {
      // Filter changes by layer
      const layerChanges = changeset.changes.filter((c: any) => c.layerName === options.layer);

      if (layerChanges.length === 0) {
        console.log(ansis.dim(`No staged changes in layer '${options.layer}'`));
        return;
      }

      console.log(ansis.bold(`Layer: ${options.layer}`));
      const tableData = layerChanges.map((c: any) => ({
        "Element ID": c.elementId + ansis.dim(" (staged)"),
        Type: c.type,
        Status: c.type === "add" ? "new" : c.type === "delete" ? "removed" : "updated",
      }));
      console.table(tableData);
    } else {
      // Show all layers with staged changes
      const layerMap = new Map<string, any[]>();
      changeset.changes.forEach((c: any) => {
        const existing = layerMap.get(c.layerName) ?? [];
        existing.push(c);
        layerMap.set(c.layerName, existing);
      });

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("preview.layerCount", layerMap.size);
      }

      for (const [layerName, changes] of layerMap) {
        console.log(ansis.bold(`Layer: ${layerName}`));
        const tableData = changes.map((c: any) => ({
          "Element ID": c.elementId,
          Type: c.type,
          Status: c.type === "add" ? "new" : c.type === "delete" ? "removed" : "updated",
        }));
        console.table(tableData);
        console.log();
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Show the delta between the base model and the staged changes of the changeset named (by name or
 * id, in any state), or of the active one when none is named.
 */
export async function changesetDiffCommand(
  name: string | undefined,
  options: { model?: string; layer?: string }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.diff", {
        "diff.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const found = await changesetForCommand(manager, name);

    if ("error" in found) {
      if (found.noActive) {
        // As before #1219: nothing named and nothing active is said, not a failure.
        console.error(ansis.red("Error: No active changeset"));
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "No active changeset" });
        }
        endSpan(span);
        return;
      }
      failRead(found.error, span);
    }

    const { changeset } = found;

    console.log(ansis.bold("\nDiff: Base Model vs Staged Changes"));
    console.log(ansis.dim(`Changeset: ${changeset.name}\n`));

    // Group changes by layer
    const layerMap = new Map<string, any[]>();
    changeset.changes.forEach((c: any) => {
      if (!options.layer || c.layerName === options.layer) {
        const existing = layerMap.get(c.layerName) ?? [];
        existing.push(c);
        layerMap.set(c.layerName, existing);
      }
    });

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("diff.layerCount", layerMap.size);
      (span as any).setAttribute("diff.totalChanges", changeset.changes.length);
    }

    if (layerMap.size === 0) {
      console.log(
        ansis.dim(options.layer ? `No changes in layer '${options.layer}'` : "No staged changes")
      );
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    // Display changes grouped by layer
    for (const [layerName, changes] of layerMap) {
      console.log(ansis.bold(`Layer: ${layerName}`));

      for (const change of changes) {
        if (change.type === "add") {
          console.log(ansis.green(`+ ${change.elementId}`));
          console.log(ansis.dim(`  ${JSON.stringify(change.after || {}, null, 2)}`));
        } else if (change.type === "delete") {
          console.log(ansis.red(`- ${change.elementId}`));
          console.log(ansis.dim(`  ${JSON.stringify(change.before || {}, null, 2)}`));
        } else if (change.type === "update") {
          console.log(ansis.yellow(`~ ${change.elementId}`));
          console.log(ansis.dim(`  Before: ${JSON.stringify(change.before || {})}`));
          console.log(ansis.dim(`  After:  ${JSON.stringify(change.after || {})}`));
        }
      }

      console.log();
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Throw the refusal to land a record, with the CLI's own next steps. A record (a verification
 * record or an upgrade record) never lands, --force or not; StagingAreaManager.commit refuses it too.
 */
function throwIfRecord(refusal: RecordLandingError | null, changesetName: string): void {
  if (!refusal) return;
  if (refusal instanceof VerificationRecordLandingError) {
    const plan = refusal.plan;
    throw new CLIError(refusal.message, ErrorCategory.USER, [
      plan ? `Land the plan instead: dr changeset commit "${plan.name}"` : "Land the plan it verifies instead",
      `Keep this record (it stays staged and is committed to git with the plan), or discard it: dr changeset delete "${changesetName}"`,
      "To reconcile the model with code drift, extract without a plan active and land that changeset",
    ]);
  }
  throw new CLIError(refusal.message, ErrorCategory.USER, [
    "To restore a dropped relationship, add one of a type the catalog has now (dr relationship add); the record's description lists those types",
    `Keep this record while you still need it, then discard it: dr changeset delete "${changesetName}"`,
  ]);
}

/**
 * Apply staged changes to the base model
 *
 * Implements atomic commit with validation and rollback on failure.
 * All changes are applied atomically—on any failure, the model is rolled back.
 *
 * @param options - Commit options
 * @param options.validate - Run validation before commit (default: true; --no-validate skips it).
 *   When enabled, errors the changeset introduces (present in the projected model but not
 *   the base) block the commit; errors the base model already had are counted and reported,
 *   not blocking.
 * @param options.force - Land over staged changes the base overlaps without being asked. Drift does
 *   not refuse a commit by itself (#1200), but someone has to have read what landing does: with a
 *   terminal the overlaps are listed and the person is asked; with none (a script, CI) the commit
 *   is refused unless this is passed. Without overlaps it changes nothing. See overlapDecision.
 *
 * @param nameOrId - The changeset to commit (id or name). Defaults to the active one. A named
 *   changeset that is not active is activated for the commit; the changeset that was active before
 *   is active again afterwards, whether the commit succeeds or not.
 *
 * @throws Error if validation fails, the base overlaps the changeset with no one to ask and no
 *   --force, or commit fails
 */
export async function changesetCommitCommand(
  nameOrId?: string,
  options?: {
    model?: string;
    validate?: boolean;
    force?: boolean;
  }
): Promise<void> {
  // Set when a named changeset was activated for the commit: what to make active again after it.
  let restoreActive: { rootPath: string; previous: string | null } | null = null;
  const restore = async (): Promise<void> => {
    if (!restoreActive) return;
    const { rootPath, previous } = restoreActive;
    restoreActive = null;
    const probe = await Model.load(rootPath, { lazyLoad: true });
    const manager = new StagingAreaManager(probe.rootPath, probe);
    const prior = previous ? await manager.load(previous) : null;
    // An upgrade record can't be made active (setActive refuses it)
    if (prior?.status === "staged" && prior.purpose !== "upgrade-record") {
      await manager.setActive(previous!);
      if (!isJson()) console.log(ansis.dim(`Changeset '${prior.name}' is active again.`));
    } else {
      await manager.clearActive();
    }
  };

  await startActiveSpan(
    "changeset.commit",
    async (span) => {
      try {
        if (nameOrId) {
          const probe = await Model.load(options?.model, { lazyLoad: true });
          const probeManager = new StagingAreaManager(probe.rootPath, probe);
          const target = await probeManager.load(nameOrId);
          if (!target || !target.id) {
            throw new CLIError(`Changeset '${nameOrId}' not found`, ErrorCategory.USER, [
              'Run "dr changeset list" to see changesets by name and id',
            ]);
          }
          if (target.status !== "staged") {
            throw new CLIError(
              `Changeset '${target.name}' is ${target.status}; only a staged changeset can be committed`,
              ErrorCategory.USER,
              ['Run "dr changeset list" to find a staged changeset']
            );
          }
          // A record never lands: refuse it before it is made active for the commit.
          throwIfRecord(await probeManager.landingRefusal(target), target.name);
          const activeId = await probeManager.getActiveId();
          if (activeId !== target.id) {
            // Commit works on the active changeset: the model it loads merges that one's staged changes.
            restoreActive = { rootPath: probe.rootPath, previous: activeId };
            await probeManager.setActive(target.id);
          }
        }

        const model = await Model.load(options?.model, { lazyLoad: false });
        const stagingManager = new StagingAreaManager(model.rootPath, model);
        const activeChangesetId = await stagingManager.getActiveId();

        if (!activeChangesetId) {
          if (isJson()) {
            console.log(JSON.stringify({ status: "error", code: 1, message: "No active changeset" }));
          } else {
            console.error(ansis.red("Error: No active changeset"));
          }
          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 2, message: "No active changeset" });
          }
          return;
        }

        const changeset = await stagingManager.load(activeChangesetId);

        if (!changeset) {
          if (isJson()) {
            console.log(JSON.stringify({ status: "error", code: 2, message: `Changeset '${activeChangesetId}' not found` }));
          } else {
            console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
          }
          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 2, message: "Changeset not found" });
          }
          span.end();
          process.exit(1);
        }

        // A record never lands, --force or not (StagingAreaManager.commit refuses it too); here
        // with the CLI's own next steps.
        throwIfRecord(await stagingManager.landingRefusal(changeset), changeset.name);

        const changeCount = changeset.changes.length;

        if (isTelemetryEnabled) {
          (span as any).setAttribute("changeset.id", activeChangesetId);
          (span as any).setAttribute("changeset.name", changeset.name);
          (span as any).setAttribute("changeset.changeCount", changeCount);
        }

        if (changeCount === 0) {
          handleSuccess("No staged changes to commit", {
            name: changeset.name,
            changesetId: activeChangesetId,
            stagedChanges: 0,
          }, { verbose: true });
          await restore();
          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 0 });
          }
          return;
        }

        // Someone has to have read what landing does about overlaps: ask, or refuse without --force.
        if (!(await landsOverOverlaps(stagingManager, changeset, { force: options?.force }))) {
          handleSuccess("Not committed. Nothing was written.", {
            name: changeset.name,
            changesetId: activeChangesetId,
            status: "cancelled",
          }, { verbose: true });
          await restore();
          if (isTelemetryEnabled) {
            (span as any).setAttribute("commit.cancelled", true);
            (span as any).setStatus({ code: 0 });
          }
          return;
        }

        if (!isJson()) {
          console.log(ansis.bold(`\nCommitting changeset: ${ansis.cyan(changeset.name)}`));
          console.log(ansis.dim(`Staged changes: ${changeCount}`));
          console.log();
        }

        // Execute atomic commit with validation and rollback
        try {
          const result = await stagingManager.commit(model, activeChangesetId, {
            validate: options?.validate !== false,
          });

          // StagingAreaManager.commit deactivated the changeset (reportDeactivation warns if not)

          if (isTelemetryEnabled) {
            (span as any).setAttribute("commit.committed", result.committed);
            (span as any).setAttribute("commit.skipped", result.skipped);
            (span as any).setAttribute("commit.failed", result.failed);
            (span as any).setAttribute("commit.validationPassed", result.validation.passed);
          }

          const commitDetails: Record<string, unknown> = {
            name: changeset.name,
            changesetId: activeChangesetId,
            committedCount: result.committed,
            stagedChanges: changeCount,
            validationPassed: result.validation.passed,
          };
          reportCommitValidation(result, commitDetails);
          reportDeactivation(result, commitDetails);

          if ((result.skipped ?? 0) > 0) {
            commitDetails.skipped = result.skipped;
            commitDetails.skippedDetails = (result.skippedDetails ?? []).slice(0, 10);
          }

          if (result.failed > 0) {
            commitDetails.failed = result.failed;
          }

          // Safety net: warn if any staged changes were neither committed, skipped, nor failed
          const accountedFor = result.committed + (result.skipped ?? 0) + result.failed;
          if (accountedFor < changeCount) {
            const unaccounted = changeCount - accountedFor;
            commitDetails.unaccountedChanges = unaccounted;
            if (!isJson()) {
              console.log(
                ansis.yellow(
                  `⚠ Warning: ${unaccounted} staged change(s) were not applied, skipped, or reported as failed.` +
                  ` This is unexpected — check the changeset log for details.`
                )
              );
            }
          }

          if (result.driftWarning) {
            // Drift never refuses a commit (#1200): it landed, and this says over what.
            commitDetails.driftDetected = true;
            const overlaps = result.driftDetail
              ? [
                  ...result.driftDetail.overlapping.elements.map((e) => `${e.id} (${e.reason}): ${e.consequence}`),
                  ...result.driftDetail.overlapping.relationships.map(
                    (r) => `${r.source} --${r.predicate}--> ${r.target} (${r.reason}): ${r.consequence}`
                  ),
                ]
              : [];
            if (overlaps.length > 0) commitDetails.driftOverlaps = overlaps;
            if (!isJson()) {
              console.log(
                ansis.yellow(
                  overlaps.length > 0
                    ? `⚠ Warning: the base model overlapped ${overlaps.length} staged change(s). The changeset landed:`
                    : "⚠ Warning: the base model had changed under this changeset, and it has no base index to list what overlapped. The changeset landed."
                )
              );
              for (const line of overlaps) console.log(ansis.yellow(`  - ${line}`));
            }
            if (isTelemetryEnabled) {
              (span as any).setAttribute("commit.driftDetected", true);
            }
          }

          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 0 });
          }

          handleSuccess(`Committed ${result.committed} change(s)`, commitDetails, { verbose: true });
          await restore();

          if (!isJson()) {
            console.log();
          }
        } catch (error) {
          // Commit failed - error was thrown from StagingAreaManager
          // Model has been automatically rolled back
          if (isJson()) {
            console.log(JSON.stringify({ status: "error", code: 1, message: `Commit failed and rolled back: ${getErrorMessage(error)}` }));
          } else {
            console.log(
              ansis.red(
                `✗ Commit failed and rolled back: ${getErrorMessage(error)}`
              )
            );
          }
          if (isTelemetryEnabled) {
            (span as any).setAttribute("commit.rolledBack", true);
          }
          throw error;
        }
      } catch (error) {
        if (isTelemetryEnabled) {
          (span as any).recordException(error as Error);
          (span as any).setStatus({
            code: 2,
            message: getErrorMessage(error),
          });
        }
        if (isJson()) {
          console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
        } else {
          console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
          if (error instanceof CLIError && error.suggestions?.length) {
            for (const suggestion of error.suggestions) console.error(ansis.dim(`  ${suggestion}`));
          }
        }
        await restore().catch((restoreError) =>
          console.error(ansis.red(`Error: could not reactivate the previous changeset: ${getErrorMessage(restoreError)}`))
        );
        span.end();
        process.exit(1);
      }
    },
    {
      "commit.validate": options?.validate !== false,
      "commit.force": options?.force === true,
    }
  );
}

/**
 * Export changeset to portable file
 */
export async function changesetExportCommand(
  changesetId: string,
  options: {
    model?: string;
    output?: string;
    format?: "yaml" | "json" | "patch";
  }
): Promise<void> {
  const format = options.format || "yaml";
  const span = isTelemetryEnabled
    ? startSpan("changeset.export", {
        "changeset.id": changesetId,
        "export.format": format,
      })
    : null;

  try {
    const model = await Model.load(options.model, { lazyLoad: true });
    const exporter = new ChangesetExporter(model.rootPath);

    // Default output filename based on changeset id and format
    const ext = format === "patch" ? "patch" : format;
    const outputPath = options.output || `${changesetId}.${ext}`;

    // Ensure output path is absolute
    const absolutePath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(process.cwd(), outputPath);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("export.outputPath", outputPath);
    }

    await exporter.exportToFile(changesetId, absolutePath, format);

    handleSuccess(`Exported changeset to ${outputPath}`, {
      changesetId,
      outputPath,
      format,
    }, { verbose: true });

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    if (isJson()) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Import changeset from portable file
 */
export async function changesetImportCommand(
  file: string,
  options: { model?: string; force?: boolean } = {}
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.import", {
        "import.file": file,
        "import.force": options.force === true,
      })
    : null;

  try {
    // Load full model for compatibility validation
    const model = await Model.load(options.model, { lazyLoad: false });
    const exporter = new ChangesetExporter(model.rootPath);

    // Ensure file path is absolute
    const absolutePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

    // Import changeset
    const imported = await exporter.importFromFile(absolutePath);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.name", imported.name);
      (span as any).setAttribute("changeset.changeCount", imported.changes.length);
    }

    // Validate compatibility with current model
    const compatibility = await exporter.validateCompatibility(imported, model);

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("import.compatible", compatibility.compatible);
      (span as any).setAttribute("import.baseSnapshotMatch", compatibility.baseSnapshotMatch);
    }

    // Check for issues
    if (!compatibility.compatible) {
      if (isJson()) {
        console.log(JSON.stringify({ status: "error", code: 1, message: "Changeset is incompatible", warnings: compatibility.warnings }));
      } else {
        console.error(ansis.red("✗ Import failed: Changeset is incompatible"));
        console.error(ansis.dim(`  Issues:`));
        for (const warning of compatibility.warnings) {
          console.error(ansis.dim(`    - ${warning}`));
        }
      }
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset incompatible" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Check for drift and require --force if detected
    if (!compatibility.baseSnapshotMatch) {
      if (!options.force) {
        if (isJson()) {
          console.log(JSON.stringify({ status: "error", code: 1, message: "Imported changeset has base model drift" }));
        } else {
          console.error(
            ansis.red("Error: Imported changeset has base model drift") +
              "\n" +
              ansis.dim("The model has been modified since this changeset was created.") +
              "\n" +
              ansis.dim("This may cause conflicts or unexpected behavior when committing.") +
              "\n\n" +
              ansis.dim("To import anyway, use: --force")
          );
        }
        if (isTelemetryEnabled && span) {
          (span as any).setStatus({ code: 2, message: "Drift detected, force required" });
        }
        endSpan(span);
        process.exit(1);
      }

      console.warn(
        ansis.yellow(`⚠ Warning: Base model drift detected (--force used)`) +
          "\n" +
          ansis.dim("Review changes carefully before committing.")
      );
      console.log();

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("import.driftOverridden", true);
      }
    }

    // Assign new ID to avoid conflicts
    const newId = generateImportedChangesetId();
    imported.id = newId;

    // Save to staging area using storage
    const storage = new StagedChangesetStorage(model.rootPath);
    await storage.save(imported);

    const importDetails: Record<string, unknown> = {
      changesetName: imported.name,
      changesetId: newId,
      additions: imported.stats?.additions || 0,
      modifications: imported.stats?.modifications || 0,
      deletions: imported.stats?.deletions || 0,
    };

    if (!compatibility.baseSnapshotMatch) {
      importDetails.driftDetected = true;
    }

    handleSuccess(`Imported changeset: ${imported.name}`, importDetails, { verbose: true });

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", newId);
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Register changeset subcommands
 */
export function changesetCommands(program: Command): void {
  const changesetGroup = program.command("changeset").description("Manage changesets");

  changesetGroup
    .command("create <name>")
    .description("Create a new changeset and activate it")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option(
      "--intent <markdown>",
      "The change's intent, as markdown: what it is for, what it covers, what done looks like"
    )
    .option("--description <desc>", "Older name for --intent")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset create "v1.1 migration"
  $ dr changeset create api-refactoring --intent "Refactor the API layer's endpoints.

**Done when** every endpoint has an operationId."`
    )
    .action(async (name, options) => {
      await changesetCreateCommand(name, options);
    });

  changesetGroup
    .command("list")
    .description("List all changesets")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset list`
    )
    .action(async (options) => {
      await changesetListCommand(options);
    });

  changesetGroup
    .command("apply <name>")
    .description("Apply a changeset to the model")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("--no-validate", "Skip validation before applying")
    .option("--force", "Land over staged changes the base overlaps without being asked (needed with no terminal attached)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset apply "v1.1 migration"
  $ dr changeset apply "v1.1 migration" --no-validate
  $ dr changeset apply "v1.1 migration" --force`
    )
    .action(async (name, options) => {
      await changesetApplyCommand(name, options);
    });

  changesetGroup
    .command("revert <name>")
    .description("Discard a changeset. One already applied keeps its changes in the model; only its record is marked discarded")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset revert "v1.1 migration"`
    )
    .action(async (name, options) => {
      await changesetRevertCommand(name, options);
    });

  changesetGroup
    .command("activate <name>")
    .description("Activate a changeset for automatic change tracking")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset activate "v1.1 migration"`
    )
    .action(async (name, options) => {
      await changesetActivateCommand(name, options);
    });

  changesetGroup
    .command("deactivate")
    .description("Deactivate the currently active changeset")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset deactivate`
    )
    .action(async (options) => {
      await changesetDeactivateCommand(options);
    });

  changesetGroup
    .command("status")
    .description("Show the currently active changeset")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset status`
    )
    .action(async (options) => {
      await changesetStatusCommand(options);
    });

  changesetGroup
    .command("show [changeset]")
    .description(
      "Show one changeset by name or id, whatever its state or purpose (the active one when none is named): " +
        "status, purpose, allowed actions, its description and one line per change"
    )
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset show                        # The active changeset
  $ dr changeset show add-order-export       # Any changeset, by name or id
  $ dr changeset show upgrade-drops-0.15.0   # An upgrade record, which can't be activated
  $ dr changeset show add-order-export --json`
    )
    .action(async (name: string | undefined, options) => {
      await changesetShowCommand(name, options);
    });

  changesetGroup
    .command("delete <name>")
    .description("Delete a changeset permanently")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-f, --force", "Skip confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset delete my-feature
  $ dr changeset delete my-feature --force`
    )
    .action(async (name, options) => {
      await changesetDeleteCommand(name, options);
    });

  // Staging operation commands
  changesetGroup
    .command("staged [changeset]")
    .description("List the staged changes of a changeset by name or id (the active one when none is named)")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Filter by layer name")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset staged
  $ dr changeset staged add-order-export
  $ dr changeset staged --layer api`
    )
    .action(async (name: string | undefined, options) => {
      await changesetStagedCommand(name, options);
    });

  changesetGroup
    .command("stage <element-id>")
    .description("Stage a specific element into the active changeset")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset stage api.operation.get-users
  $ dr changeset stage ux.uicomponent.login-form`
    )
    .action(async (elementId, options) => {
      await changesetExplicitStageCommand(elementId, options);
    });

  changesetGroup
    .command("unstage <element-id>")
    .description("Remove specific element from staging area")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset unstage api-endpoint-create-customer`
    )
    .action(async (elementId, options) => {
      await changesetUnstageCommand(elementId, options);
    });

  changesetGroup
    .command("discard [element-id]")
    .description("Discard all or single staged changes")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset discard
  $ dr changeset discard api-endpoint-create-customer`
    )
    .action(async (elementId, options) => {
      await changesetDiscardCommand(elementId, options);
    });

  changesetGroup
    .command("preview [changeset]")
    .description("Preview the model with a changeset's staged changes applied (the active one when none is named)")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Preview specific layer only")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset preview
  $ dr changeset preview add-order-export
  $ dr changeset preview --layer application`
    )
    .action(async (name: string | undefined, options) => {
      await changesetPreviewCommand(name, options);
    });

  changesetGroup
    .command("diff [changeset]")
    .description(
      "Show the delta between the base model and a changeset's staged changes (the active one when none is named)"
    )
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Show diff for specific layer only")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset diff
  $ dr changeset diff add-order-export
  $ dr changeset diff --layer api`
    )
    .action(async (name: string | undefined, options) => {
      await changesetDiffCommand(name, options);
    });

  changesetGroup
    .command("commit [changeset]")
    .description("Apply a changeset's staged changes to the base model (the active one, or the one named)")
    .allowExcessArguments(false)
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    // Kept for scripts written against the old help, which listed --validate; validation runs by default.
    .addOption(new Option("--validate", "Run validation before commit (default)").hideHelp())
    .option(
      "--no-validate",
      "Skip validation before commit (validation runs by default; only errors the changeset introduces block, errors already in the base model are reported as a count)"
    )
    .option(
      "--force",
      "Land over staged changes the base overlaps without being asked (needed with no terminal attached; does not skip validation)",
      false
    )
    .addHelpText(
      "after",
      `
Validation compares the model with and without the changeset. Errors the
changeset introduces block the commit; errors the base model already had are
not counted against it, and the output says how many there were.

A base model that changed elsewhere never holds up a commit. When it overlaps
what the changeset stages (the base edited an element the plan updates, say),
the overlaps are listed with what landing would do about each, and you are
asked. With no terminal attached (a script, CI) there is no one to ask, so the
commit is refused with the list and a non-zero exit, unless --force is passed.

A named changeset (id or name) need not be active: it is activated for the
commit, and the changeset that was active before is active again afterwards.

Examples:
  $ dr changeset commit
  $ dr changeset commit add-order-api    # commit the changeset named add-order-api
  $ dr changeset commit --force          # land over overlaps without being asked
  $ dr changeset commit --no-validate    # skip validation entirely`
    )
    .action(async (name: string | undefined, options) => {
      await changesetCommitCommand(name, options);
    });

  changesetGroup
    .command("export <changeset-id>")
    .description("Export changeset to portable file")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-o, --output <file>", "Output file path")
    .option("-f, --format <format>", "Export format (yaml|json|patch)", "yaml")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset export api-updates
  $ dr changeset export api-updates --output changes.yaml
  $ dr changeset export api-updates --format json --output changes.json
  $ dr changeset export api-updates --format patch --output changes.patch`
    )
    .action(async (changesetId, options) => {
      await changesetExportCommand(changesetId, options);
    });

  changesetGroup
    .command("import <file>")
    .description("Import changeset from file")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-f, --force", "Import despite base model drift", false)
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset import changes.yaml
  $ dr changeset import ../team-changes.json
  $ dr changeset import changes.yaml --force`
    )
    .action(async (file, options) => {
      await changesetImportCommand(file, options);
    });

  changesetGroup
    .command("verify [planned]")
    .description("Compare a planned changeset with what was built (an as-built changeset, or the base model)")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("--against <changeset>", "As-built changeset (ID or name) to compare with")
    .option("--base", "Compare with the base model")
    .option(
      "--extracted",
      "With --base: the as-built side landed from codebase_extract, so planned parts extraction can't observe are unverifiable, not missing"
    )
    .option("--no-match-by-source", "Do not match elements by shared source file")
    .option(
      "--adopt-source-references",
      "Copy onto the plan the source references its as-built matches have and it lacks (exact matches only); writes the plan"
    )
    .option(
      "--ids <ids>",
      "With --adopt-source-references: comma-separated planned element ids whose probable match you confirmed in the code"
    )
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
The planned changeset defaults to the active one. Verify is read-only unless
--adopt-source-references is passed: it copies the source references the report
lists onto the plan, before it lands. Matches against as-built elements that
extraction didn't stage are never copied.

Examples:
  $ dr changeset verify export-orders --against export-orders-as-built
  $ dr changeset verify export-orders --base --json
  $ dr changeset verify export-orders --base --extracted
  $ dr changeset verify export-orders --against export-orders-as-built --adopt-source-references
  $ dr changeset verify export-orders --against export-orders-as-built --adopt-source-references \\
      --ids application.applicationcomponent.order-exporter`
    )
    .action(async (planned, options) => {
      await changesetVerifyCommand(planned, options);
    });

  changesetGroup.showSuggestionAfterError();
}
