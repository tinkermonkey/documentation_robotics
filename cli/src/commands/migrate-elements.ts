/**
 * Migrate Elements Command - Migrates elements to spec-node aligned format
 *
 * Handles migration of elements from legacy format to spec-node aligned format.
 * - Generates UUIDs for elements that lack them
 * - Migrates flat properties to structured attributes
 * - Preserves semantic IDs in elementId field for backward compatibility
 * - Initializes metadata with migration timestamps
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { ElementMigration } from "../utils/element-migration.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { getErrorMessage } from "../utils/errors.js";

export async function migrateElementsCommand(options: {
  dryRun?: boolean;
}): Promise<void> {
  try {
    // Load the model from current directory
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    console.log(ansis.bold("\nMigrating elements to spec-node aligned format\n"));

    const migration = new ElementMigration();

    if (options.dryRun) {
      console.log(ansis.yellow("[DRY RUN] The following elements would be migrated:"));
      console.log();
    }

    const result = await migration.migrateModel(model);

    // Display detailed migration results
    if (result.details.length > 0) {
      const migrated = result.details.filter((d) => d.status === "migrated");
      const skipped = result.details.filter((d) => d.status === "skipped");
      const errored = result.details.filter((d) => d.status === "error");

      if (migrated.length > 0) {
        console.log(ansis.green(`Migrated: ${migrated.length}`));
        migrated.forEach((d) => {
          console.log(
            ansis.dim(`  ✓ ${d.layerName}/${d.elementId}: ${d.message || "migrated"}`)
          );
        });
        console.log();
      }

      if (skipped.length > 0) {
        console.log(ansis.yellow(`Skipped (already migrated): ${skipped.length}`));
        skipped.forEach((d) => {
          console.log(ansis.dim(`  ⊘ ${d.layerName}/${d.elementId}: already in new format`));
        });
        console.log();
      }

      if (errored.length > 0) {
        console.log(ansis.red(`Errors: ${errored.length}`));
        errored.forEach((d) => {
          console.log(ansis.red(`  ✗ ${d.layerName}/${d.elementId}: ${d.message || "error"}`));
        });
        console.log();
      }
    }

    // Summary
    console.log(ansis.dim("Migration Summary:"));
    console.log(ansis.dim(`  Total migrated: ${result.migrated}`));
    console.log(ansis.dim(`  Total skipped: ${result.skipped}`));
    console.log(ansis.dim(`  Total errors: ${result.errors.length}`));
    console.log();

    if (!options.dryRun && result.errors.length === 0) {
      // Create atomic backup before migration
      const backupPath = await model.createBackup("pre-migration");
      console.log(ansis.dim(`  Backup created: ${backupPath}`));

      try {
        // Save the updated model with atomic write semantics
        // Write to temporary file first, then rename on success to ensure atomicity
        await model.saveDirtyLayersAtomic();

        console.log(ansis.green(`✓ Element migration complete`));
        console.log(
          ansis.dim(`${result.migrated} elements migrated to spec-node aligned format`)
        );
      } catch (error) {
        console.error(
          ansis.red(
            `✗ Migration failed to save changes: ${getErrorMessage(error)}`
          )
        );
        console.log(ansis.yellow(`  Rollback: Restoring from backup at ${backupPath}`));
        try {
          await model.restoreFromBackup(backupPath);
          console.log(ansis.yellow(`  Rollback successful`));
        } catch (rollbackError) {
          console.error(
            ansis.red(
              `  CRITICAL: Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            )
          );
          console.error(ansis.red(`  Manual recovery needed from backup at: ${backupPath}`));
        }
        throw new CLIError(
          `Migration failed to save changes: ${getErrorMessage(error)}`,
          ErrorCategory.SYSTEM,
          [`Check backup at: ${backupPath}`]
        );
      }
    } else if (options.dryRun) {
      console.log(ansis.yellow(`✓ Dry run complete (no changes saved)`));
    } else {
      throw new CLIError(
        `Migration failed with ${result.errors.length} errors. No changes saved.`,
        ErrorCategory.SYSTEM,
        result.errors.slice(0, 5)
      );
    }

    console.log();
  } catch (error) {
    throw error;
  }
}
