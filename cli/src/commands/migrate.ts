/**
 * Migrate Command - Migrates model to a different spec version
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { MigrationRegistry } from "../core/migration-registry.js";
import { extractErrorMessage } from "../utils/error-utils.js";

export async function migrateCommand(options: {
  to?: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  try {
    // Load the model from current directory
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    const registry = new MigrationRegistry();
    const currentVersion = model.manifest.specVersion || "0.5.0";
    const targetVersion = options.to || registry.getLatestVersion();

    console.log(
      ansis.bold(`\nMigrating model from spec v${currentVersion} to v${targetVersion}\n`)
    );

    // Check if migration is needed
    if (currentVersion === targetVersion) {
      console.log(ansis.yellow(`Model is already at spec version ${targetVersion}`));
      return;
    }

    // Get migration summary
    const summary = registry.getMigrationSummary(currentVersion, targetVersion);

    if (summary.migrationsNeeded === 0) {
      console.log(
        ansis.yellow(`No migration path found from v${currentVersion} to v${targetVersion}`)
      );
      console.log(`Available migrations:`);
      registry.getMigrationSummary("0.5.0").migrations.forEach((m) => {
        console.log(ansis.dim(`  - ${m.from} → ${m.to}: ${m.description}`));
      });
      process.exit(1);
    }

    // Display migration plan
    console.log(ansis.dim("Migration path:"));
    for (const migration of summary.migrations) {
      console.log(ansis.dim(`  ${migration.from} → ${migration.to}: ${migration.description}`));
    }
    console.log();

    if (options.dryRun) {
      console.log(ansis.yellow("[DRY RUN] The following changes would be applied:"));
      console.log();
    }

    // Apply migrations
    const result = await registry.applyMigrations(model, {
      fromVersion: currentVersion,
      toVersion: targetVersion,
      dryRun: options.dryRun,
      validate: !options.force,
    });

    // Display results
    for (const applied of result.applied) {
      if (applied.dryRun) {
        console.log(
          ansis.yellow(`[DRY RUN] ${applied.from} → ${applied.to}: ${applied.description}`)
        );
      } else {
        console.log(ansis.green(`✓ ${applied.from} → ${applied.to}: ${applied.description}`));
        if (applied.changes?.filesModified) {
          console.log(ansis.dim(`  Files modified: ${applied.changes.filesModified}`));
        }
      }
    }

    console.log();

    if (!options.dryRun) {
      // Save the updated manifest and all dirty layers
      await model.saveManifest();
      await model.saveDirtyLayers();

      console.log(ansis.green(`✓ Migration complete`));
      console.log(
        ansis.dim(`Spec version updated to v${targetVersion} and saved to model/manifest.yaml`)
      );
    } else {
      console.log(ansis.yellow(`✓ Dry run complete (no changes saved)`));
    }

    console.log();
  } catch (error) {
    console.error(ansis.red(`Error: ${extractErrorMessage(error)}`));
    process.exit(1);
  }
}
