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
      // Save the updated model
      await model.saveDirtyLayers();

      console.log(ansis.green(`✓ Element migration complete`));
      console.log(
        ansis.dim(`${result.migrated} elements migrated to spec-node aligned format`)
      );
    } else if (options.dryRun) {
      console.log(ansis.yellow(`✓ Dry run complete (no changes saved)`));
    } else {
      console.log(
        ansis.red(`✗ Migration failed with ${result.errors.length} errors. No changes saved.`)
      );
      process.exit(1);
    }

    console.log();
  } catch (error) {
    console.error(ansis.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
