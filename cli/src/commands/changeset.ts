/**
 * Changeset Commands - Manage model change tracking and versioning
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { ChangesetExporter } from "../core/changeset-exporter.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";
import { Command } from "commander";
import * as prompts from "@clack/prompts";
import path from "path";
import { isTelemetryEnabled, startSpan, endSpan, startActiveSpan } from "../telemetry/index.js";
import { getErrorMessage, handleSuccess, handleInfo } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { findElementLayer } from "../utils/element-utils.js";

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
    description?: string;
  }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.create", {
        "changeset.name": name,
        "changeset.hasDescription": !!options.description,
      })
    : null;

  try {
    // Load with lazyLoad: false to ensure consistent snapshot hashing
    // (base snapshot must include all layers for accurate drift detection)
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    // Check if changeset already exists
    const existing = await manager.load(name);
    if (existing) {
      console.error(ansis.red(`Error: Changeset '${name}' already exists`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset already exists" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Get description if not provided
    let description = options.description;
    if (!description) {
      const isInteractive = process.stdin.isTTY;
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("cli.interactive", isInteractive);
      }
      if (isInteractive) {
        const result = await prompts.text({
          message: "Changeset description (optional)",
        });

        if (typeof result === "string") {
          description = result;
        }
      }
    }

    const changeset = await manager.create(name, description || undefined);

    // Activate immediately so add/update/delete commands stage into this changeset
    const previouslyActive = await manager.getActiveId();
    if (previouslyActive) {
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
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

      console.log(`${statusColor(changeset.status.toUpperCase())} ${ansis.bold(changeset.name)}`);

      if (changeset.description) {
        console.log(ansis.dim(`  ${changeset.description}`));
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
    const model = await Model.load(options?.model || process.cwd(), { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
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
      console.error(
        ansis.red("Error: Changeset ID could not be determined") +
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
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset ID missing" });
      }
      endSpan(span);
      process.exit(1);
    }
    const result = await manager.apply(model, changesetId, {
      validate: options?.validate,
      force: options?.force
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

    // Add changeset to manifest history
    if (!model.manifest.changeset_history) {
      model.manifest.changeset_history = [];
    }
    model.manifest.changeset_history.push({
      name,
      committed_at: new Date().toISOString(),
      action: "committed",
    });

    // Always save the model and manifest, even if 0 changes
    // This ensures manifest is updated with changeset metadata
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
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
      console.error(ansis.red("Error: Changeset ID could not be determined"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset ID missing" });
      }
      endSpan(span);
      process.exit(1);
    }
    await manager.revert(changesetId);

    handleInfo("");

    // Show reverted message
    handleSuccess(`Reverted changeset: ${name}`, {
      changesetName: name,
      changesetId,
      changesetStatus: "discarded",
    });

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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Deactivate the current changeset
 */
export async function changesetDeactivateCommand(options: { model?: string } = {}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.deactivate") : null;

  try {
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();

    if (!active) {
      handleInfo(ansis.yellow("No active changeset"));
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
      changesetName: changeset?.name || active,
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(name);
    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${name}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Check if changeset is currently active (compare by ID, not user-provided name)
    const active = await manager.getActiveId();
    if (active === changeset.id) {
      console.error(ansis.red(`Error: Cannot delete active changeset '${name}'`));
      console.log(ansis.dim("  Run `dr changeset deactivate` first"));
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
          handleInfo(ansis.yellow("Deletion cancelled"));
          if (isTelemetryEnabled && span) {
            (span as any).setAttribute("delete.cancelled", true);
            (span as any).setStatus({ code: 0 });
          }
          endSpan(span);
          return;
        }
      } else {
        // In non-interactive environment, require --force flag
        console.error(ansis.red("Error: Cannot confirm deletion in non-interactive environment"));
        console.log(ansis.dim("  Use --force flag to confirm deletion"));
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();

    if (!active) {
      console.log(ansis.dim("No active changeset"));
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * List all staged changes in the active changeset
 */
export async function changesetStagedCommand(options: { model?: string; layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.staged", {
        "staged.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangeset = await manager.getActiveId();

    if (!activeChangeset) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangeset);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangeset}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

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
        changesetName: activeChangeset,
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
      console.log(ansis.bold(`\nStaged Changes (${changes.length}):\n`));
      const tableData = changes.map((c: any) => ({
        "Element ID": c.elementId,
        Layer: c.layerName,
        Type: c.type,
        Timestamp: new Date(c.timestamp || Date.now()).toISOString(),
      }));
      console.table(tableData);
    }

    handleSuccess(`Listed ${changes.length} staged change(s)`, {
      changesetName: activeChangeset,
      changeCount: changes.length,
      changes: changes.map((c: any) => ({
        elementId: c.elementId,
        layer: c.layerName,
        type: c.type,
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const layerName = await findElementLayer(model, elementId);
    if (!layerName) {
      console.error(ansis.red(`Error: Element '${elementId}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Element not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    const layer = await model.getLayer(layerName);
    const element = layer?.getElement(elementId);
    if (!element) {
      console.error(ansis.red(`Error: Element '${elementId}' not found in layer '${layerName}'`));
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
    }, { verbose: true });
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: getErrorMessage(error) });
    }
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      process.exit(1);
    }

    // Check if element exists in changes
    const initialCount = changeset.changes.length;

    // Use the manager's unstage method
    await manager.unstage(activeChangesetId, elementId);

    // Reload to get updated count
    const updated = await manager.load(activeChangesetId);

    if (updated && updated.changes.length === initialCount) {
      handleSuccess(`Element not found in staged changes`, {
        elementId,
        found: false,
        remainingChanges: updated?.getChangeCount() || 0,
        status: "not_found",
      });
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
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
        handleSuccess(`Element not found in staged changes`, {
          elementId,
          found: false,
          status: "not_found",
        });
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
            cancelled: true,
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Preview the merged model state with staged changes applied
 */
export async function changesetPreviewCommand(options: { model?: string; layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.preview", {
        "preview.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

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
 * Show delta between base model and staged changes
 */
export async function changesetDiffCommand(options: { model?: string; layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.diff", {
        "diff.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await manager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await manager.load(activeChangesetId);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    console.log(ansis.bold("\nDiff: Base Model vs Staged Changes\n"));

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
 * Apply staged changes to the base model
 *
 * Implements atomic commit with validation and rollback on failure.
 * All changes are applied atomically—on any failure, the model is rolled back.
 *
 * @param options - Commit options
 * @param options.validate - Run validation before commit (default: true).
 *   When enabled, schema, reference, and semantic validation must pass.
 *   Validation errors always block the commit and cannot be overridden with --force.
 * @param options.force - Skip drift detection warnings (default: false).
 *   When the base model has changed since the changeset was created, drift is detected.
 *   Use --force to commit despite drift. Validation errors always block commit regardless of --force.
 *
 * @throws Error if validation fails, drift detected without --force, or commit fails
 */
export async function changesetCommitCommand(options?: {
  model?: string;
  validate?: boolean;
  force?: boolean;
}): Promise<void> {
  await startActiveSpan(
    "changeset.commit",
    async (span) => {
      try {
        const model = await Model.load(options?.model || process.cwd(), { lazyLoad: false });
        const stagingManager = new StagingAreaManager(model.rootPath, model);
        const activeChangesetId = await stagingManager.getActiveId();

        if (!activeChangesetId) {
          console.error(ansis.red("Error: No active changeset"));
          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 2, message: "No active changeset" });
          }
          return;
        }

        const changeset = await stagingManager.load(activeChangesetId);

        if (!changeset) {
          console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 2, message: "Changeset not found" });
          }
          span.end();
          process.exit(1);
        }

        const changeCount = changeset.changes.length;

        if (isTelemetryEnabled) {
          (span as any).setAttribute("changeset.id", activeChangesetId);
          (span as any).setAttribute("changeset.name", changeset.name);
          (span as any).setAttribute("changeset.changeCount", changeCount);
        }

        if (changeCount === 0) {
          handleSuccess("No staged changes to commit", {
            changesetName: changeset.name,
            changesetId: activeChangesetId,
            stagedChanges: 0,
          }, { verbose: true });
          if (isTelemetryEnabled) {
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
            force: options?.force === true,
          });

          // Deactivate the changeset after successful commit
          await stagingManager.clearActive();

          if (isTelemetryEnabled) {
            (span as any).setAttribute("commit.committed", result.committed);
            (span as any).setAttribute("commit.skipped", result.skipped);
            (span as any).setAttribute("commit.failed", result.failed);
            (span as any).setAttribute("commit.validationPassed", result.validation.passed);
          }

          const commitDetails: Record<string, unknown> = {
            changesetName: changeset.name,
            changesetId: activeChangesetId,
            committed: result.committed,
            stagedChanges: changeCount,
            validationPassed: result.validation.passed,
          };

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
            commitDetails.driftDetected = true;
            if (!isJson()) {
              console.log(
                ansis.yellow(`⚠ Warning: Model had drifted since changeset creation (--force was used)`)
              );
            }
            if (isTelemetryEnabled) {
              (span as any).setAttribute("commit.driftDetected", true);
            }
          }

          if (isTelemetryEnabled) {
            (span as any).setStatus({ code: 0 });
          }

          handleSuccess(`Committed ${result.committed} change(s)`, commitDetails, { verbose: true });

          if (!isJson()) {
            console.log();
          }
        } catch (error) {
          // Commit failed - error was thrown from StagingAreaManager
          // Model has been automatically rolled back
          console.log(
            ansis.red(
              `✗ Commit failed and rolled back: ${getErrorMessage(error)}`
            )
          );
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
        console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: true });
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
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
    const model = await Model.load(options.model || process.cwd(), { lazyLoad: false });
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
      console.error(ansis.red("✗ Import failed: Changeset is incompatible"));
      console.error(ansis.dim(`  Issues:`));
      for (const warning of compatibility.warnings) {
        console.error(ansis.dim(`    - ${warning}`));
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
        console.error(
          ansis.red("Error: Imported changeset has base model drift") +
            "\n" +
            ansis.dim("The model has been modified since this changeset was created.") +
            "\n" +
            ansis.dim("This may cause conflicts or unexpected behavior when committing.") +
            "\n\n" +
            ansis.dim("To import anyway, use: --force")
        );
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
    .description("Create a new changeset")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("--description <desc>", "Changeset description")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset create "v1.1 migration"
  $ dr changeset create "api-refactoring" --description "Refactor API layer endpoints"`
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
    .option("--force", "Force apply even if base model has drifted")
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
    .description("Revert a changeset from the model")
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
    .command("show [name]")
    .description("Show changeset details (use: status, staged, diff, or preview)")
    .addHelpText(
      "after",
      `
To inspect a changeset, use one of:
  $ dr changeset status              # Show the active changeset
  $ dr changeset staged              # List all staged changes
  $ dr changeset diff [name]         # Show a diff of staged changes
  $ dr changeset preview [name]      # Preview what will be committed`
    )
    .action(async (name?: string) => {
      const nameHint = name ? ` '${name}'` : "";
      console.error(
        `error: 'dr changeset show${nameHint}' is not a valid subcommand.\n\n` +
        `To inspect a changeset, use one of:\n` +
        `  dr changeset status        — show the active changeset\n` +
        `  dr changeset staged        — list all staged changes\n` +
        `  dr changeset diff          — show a diff of staged changes\n` +
        `  dr changeset preview       — preview what will be committed`
      );
      process.exit(1);
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
    .command("staged")
    .description("List all staged changes in the active changeset")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Filter by layer name")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset staged
  $ dr changeset staged --layer api`
    )
    .action(async (options) => {
      await changesetStagedCommand(options);
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
    .command("preview")
    .description("Preview the merged model state with staged changes applied")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Preview specific layer only")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset preview
  $ dr changeset preview --layer application`
    )
    .action(async (options) => {
      await changesetPreviewCommand(options);
    });

  changesetGroup
    .command("diff")
    .description("Show delta between base model and staged changes")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("-l, --layer <layer>", "Show diff for specific layer only")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset diff
  $ dr changeset diff --layer api`
    )
    .action(async (options) => {
      await changesetDiffCommand(options);
    });

  changesetGroup
    .command("commit")
    .description("Apply staged changes to the base model")
    .option("--model <path>", "Path to model root (contains model/manifest.yaml)")
    .option("--validate", "Run validation before commit (default: true)", true)
    .option("--force", "Commit despite drift warnings", false)
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset commit
  $ dr changeset commit --validate
  $ dr changeset commit --force`
    )
    .action(async (options) => {
      await changesetCommitCommand(options);
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

  changesetGroup.showSuggestionAfterError();
}
