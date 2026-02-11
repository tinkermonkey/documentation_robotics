/**
 * Changeset Commands - Manage model change tracking and versioning
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { ChangesetExporter } from "../core/changeset-exporter.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { Command } from "commander";
import * as prompts from "@clack/prompts";
import path from "path";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { extractErrorMessage } from "../utils/error-utils.js";

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
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", changeset.id);
      (span as any).setStatus({ code: 0 });
    }

    console.log(ansis.green(`✓ Created changeset: ${ansis.bold(name)}`));
    if (changeset.description) {
      console.log(ansis.dim(`  ${changeset.description}`));
    }
    console.log(ansis.dim(`  Path: documentation-robotics/changesets/${changeset.id}/`));
    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * List all changesets
 */
export async function changesetListCommand(): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.list") : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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
        changeset.status === "applied"
          ? ansis.green
          : changeset.status === "reverted"
            ? ansis.gray
            : ansis.yellow;

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
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
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
  options?: { validate?: boolean }
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.apply", {
        "changeset.name": name,
        "apply.validate": options?.validate !== false,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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

    console.log(ansis.bold(`\nApplying changeset: ${ansis.cyan(name)}\n`));
    console.log(ansis.dim(`Changes: ${changeset.changes.length}`));

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
    const result = await manager.apply(model, changesetId, { validate: options?.validate });

    console.log();

    // Always show applied message, even if 0 changes
    console.log(ansis.green(`✓ Applied ${result.committed} change(s) from changeset`));

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("apply.committed", result.committed);
      (span as any).setAttribute("apply.failed", result.failed);
      (span as any).setAttribute("apply.validationPassed", result.validation.passed);
    }

    if (result.failed > 0) {
      console.log(ansis.red(`✗ Failed to apply ${result.failed} change(s):`));
      for (const error of result.validation.errors) {
        console.log(ansis.dim(`  - ${error}`));
      }
    }

    // Add changeset to manifest history
    if (!model.manifest.changeset_history) {
      model.manifest.changeset_history = [];
    }
    model.manifest.changeset_history.push({
      name,
      applied_at: new Date().toISOString(),
      action: "applied",
    });

    // Always save the model and manifest, even if 0 changes
    // This ensures manifest is updated with changeset metadata
    await model.saveDirtyLayers();
    await model.saveManifest();

    if (result.failed === 0) {
      console.log(ansis.dim(`Changeset marked as applied`));
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Revert a changeset from the model
 */
export async function changesetRevertCommand(name: string): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.revert", {
        "changeset.name": name,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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

    console.log(ansis.bold(`\nReverting changeset: ${ansis.cyan(name)}\n`));
    console.log(ansis.dim(`Changes to discard: ${changeset.changes.length}`));

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

    console.log();

    // Show reverted message
    console.log(ansis.green(`✓ Reverted changeset: ${name}`));
    console.log(ansis.dim(`Changeset marked as discarded`));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Activate a changeset for automatic tracking
 */
export async function changesetActivateCommand(name: string): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.activate", {
        "changeset.name": name,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    await manager.setActive(name);

    console.log(ansis.green(`✓ Activated changeset: ${ansis.bold(name)}`));
    console.log(ansis.dim("  All model changes will now be tracked in this changeset"));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Deactivate the current changeset
 */
export async function changesetDeactivateCommand(): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.deactivate") : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();

    if (!active) {
      console.log(ansis.yellow("No active changeset"));
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

    await manager.clearActive();
    console.log(ansis.green(`✓ Deactivated changeset: ${ansis.bold(active)}`));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
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
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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

    // Check if changeset is currently active
    const active = await manager.getActiveId();
    if (active === name) {
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
          console.log(ansis.yellow("Deletion cancelled"));
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

    console.log(ansis.green(`✓ Deleted changeset: ${ansis.bold(name)}`));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Show the currently active changeset
 */
export async function changesetStatusCommand(): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("changeset.status") : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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
      const changesByType = {
        add: changeset.changes.filter((c) => c.type === "add").length,
        update: changeset.changes.filter((c) => c.type === "update").length,
        delete: changeset.changes.filter((c) => c.type === "delete").length,
      };

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("changeset.changeCount", changeset.changes.length);
        (span as any).setAttribute("changeset.adds", changesByType.add);
        (span as any).setAttribute("changeset.updates", changesByType.update);
        (span as any).setAttribute("changeset.deletes", changesByType.delete);
      }

      const parts = [];
      if (changesByType.add > 0) parts.push(`+${changesByType.add}`);
      if (changesByType.update > 0) parts.push(`~${changesByType.update}`);
      if (changesByType.delete > 0) parts.push(`-${changesByType.delete}`);
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
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * List all staged changes in the active changeset
 */
export async function changesetStagedCommand(options: { layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.staged", {
        "staged.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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
      console.log(ansis.yellow("No staged changes"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    console.log(ansis.bold(`\nStaged Changes (${changes.length}):\n`));

    const tableData = changes.map((c: any) => ({
      "Element ID": c.elementId,
      Layer: c.layerName,
      Type: c.type,
      Timestamp: new Date(c.timestamp || Date.now()).toISOString(),
    }));

    console.table(tableData);

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Remove specific element from staging area
 */
export async function changesetUnstageCommand(elementId: string): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.unstage", {
        "unstage.elementId": elementId,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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
      console.error(ansis.yellow(`Warning: Element '${elementId}' not found in staged changes`));
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

    console.log(ansis.green(`✓ Unstaged element: ${ansis.bold(elementId)}`));
    console.log(ansis.dim(`  Remaining staged changes: ${updated?.getChangeCount() || 0}`));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Discard all or single staged changes
 */
export async function changesetDiscardCommand(elementId?: string): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.discard", {
        "discard.elementId": elementId,
        "discard.all": !elementId,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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
        console.error(ansis.yellow(`Warning: Element '${elementId}' not found in staged changes`));
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

      console.log(ansis.green(`✓ Discarded changes for element: ${ansis.bold(elementId)}`));
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
          console.log(ansis.dim("Cancelled"));
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

      console.log(ansis.green(`✓ Discarded all staged changes`));
      console.log(ansis.dim(`  Changeset status: discarded`));
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }

    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Preview the merged model state with staged changes applied
 */
export async function changesetPreviewCommand(options: { layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.preview", {
        "preview.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Show delta between base model and staged changes
 */
export async function changesetDiffCommand(options: { layer?: string }): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.diff", {
        "diff.layer": options.layer,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
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
  validate?: boolean;
  force?: boolean;
}): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.commit", {
        "commit.validate": options?.validate !== false,
        "commit.force": options?.force === true,
      })
    : null;

  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });
    const stagingManager = new StagingAreaManager(model.rootPath, model);
    const activeChangesetId = await stagingManager.getActiveId();

    if (!activeChangesetId) {
      console.error(ansis.red("Error: No active changeset"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "No active changeset" });
      }
      endSpan(span);
      return;
    }

    const changeset = await stagingManager.load(activeChangesetId);

    if (!changeset) {
      console.error(ansis.red(`Error: Changeset '${activeChangesetId}' not found`));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Changeset not found" });
      }
      endSpan(span);
      process.exit(1);
    }

    const changeCount = changeset.changes.length;

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", activeChangesetId);
      (span as any).setAttribute("changeset.name", changeset.name);
      (span as any).setAttribute("changeset.changeCount", changeCount);
    }

    if (changeCount === 0) {
      console.log(ansis.yellow("No staged changes to commit"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }
      endSpan(span);
      return;
    }

    console.log(ansis.bold(`\nCommitting changeset: ${ansis.cyan(changeset.name)}`));
    console.log(ansis.dim(`Staged changes: ${changeCount}`));
    console.log();

    // Execute atomic commit with validation and rollback
    try {
      const result = await stagingManager.commit(model, activeChangesetId, {
        validate: options?.validate !== false,
        force: options?.force === true,
      });

      // Show results
      console.log(ansis.green(`✓ Committed ${result.committed} change(s)`));

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("commit.committed", result.committed);
        (span as any).setAttribute("commit.failed", result.failed);
        (span as any).setAttribute("commit.validationPassed", result.validation.passed);
      }

      if (result.driftWarning) {
        console.log(
          ansis.yellow(`⚠ Warning: Model had drifted since changeset creation (--force was used)`)
        );
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute("commit.driftDetected", true);
        }
      }

      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 0 });
      }

      console.log();
    } catch (error) {
      // Commit failed - error was thrown from StagingAreaManager
      // Model has been automatically rolled back
      console.log(
        ansis.red(
          `✗ Commit failed and rolled back: ${extractErrorMessage(error)}`
        )
      );
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("commit.rolledBack", true);
      }
      throw error;
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}

/**
 * Export changeset to portable file
 */
export async function changesetExportCommand(
  changesetId: string,
  options: {
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
    const model = await Model.load(process.cwd(), { lazyLoad: true });
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

    console.log(ansis.green(`✓ Exported changeset to ${ansis.cyan(outputPath)}`));
    console.log(ansis.dim(`  Format: ${format}`));

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
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
  options: { force?: boolean } = {}
): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("changeset.import", {
        "import.file": file,
        "import.force": options.force === true,
      })
    : null;

  try {
    // Load full model for compatibility validation
    const model = await Model.load(process.cwd(), { lazyLoad: false });
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

    console.log(ansis.green(`✓ Imported changeset: ${ansis.cyan(imported.name)}`));
    console.log(ansis.dim(`  ID: ${newId}`));
    console.log(
      ansis.dim(
        `  Changes: +${imported.stats?.additions || 0} ~${imported.stats?.modifications || 0} -${imported.stats?.deletions || 0}`
      )
    );

    if (!compatibility.baseSnapshotMatch) {
      console.log(ansis.yellow(`  ⚠ Base model drift detected - review before committing`));
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("changeset.id", newId);
      (span as any).setStatus({ code: 0 });
    }

    console.log();
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
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
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset list`
    )
    .action(async () => {
      await changesetListCommand();
    });

  changesetGroup
    .command("apply <name>")
    .description("Apply a changeset to the model")
    .option("--no-validate", "Skip validation before applying")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset apply "v1.1 migration"
  $ dr changeset apply "v1.1 migration" --no-validate`
    )
    .action(async (name, options) => {
      await changesetApplyCommand(name, options);
    });

  changesetGroup
    .command("revert <name>")
    .description("Revert a changeset from the model")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset revert "v1.1 migration"`
    )
    .action(async (name) => {
      await changesetRevertCommand(name);
    });

  changesetGroup
    .command("activate <name>")
    .description("Activate a changeset for automatic change tracking")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset activate "v1.1 migration"`
    )
    .action(async (name) => {
      await changesetActivateCommand(name);
    });

  changesetGroup
    .command("deactivate")
    .description("Deactivate the currently active changeset")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset deactivate`
    )
    .action(async () => {
      await changesetDeactivateCommand();
    });

  changesetGroup
    .command("status")
    .description("Show the currently active changeset")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset status`
    )
    .action(async () => {
      await changesetStatusCommand();
    });

  changesetGroup
    .command("delete <name>")
    .description("Delete a changeset permanently")
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
    .command("unstage <element-id>")
    .description("Remove specific element from staging area")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset unstage api-endpoint-create-customer`
    )
    .action(async (elementId) => {
      await changesetUnstageCommand(elementId);
    });

  changesetGroup
    .command("discard [element-id]")
    .description("Discard all or single staged changes")
    .addHelpText(
      "after",
      `
Examples:
  $ dr changeset discard
  $ dr changeset discard api-endpoint-create-customer`
    )
    .action(async (elementId) => {
      await changesetDiscardCommand(elementId);
    });

  changesetGroup
    .command("preview")
    .description("Preview the merged model state with staged changes applied")
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
}
