/**
 * Model Migrate Command
 *
 * Transforms layer YAML based models to graph format (GraphNode/GraphEdge).
 * Supports backup, validation, and rollback capabilities.
 */

import ansis from "ansis";
import * as path from "path";
import { Model } from "../core/model.js";
import {
  ModelMigrationService,
  type ModelMigrationResult,
} from "../export/model-migration.js";

/**
 * Model migration command options
 */
export interface ModelMigrateOptions {
  source?: string;
  target?: string;
  noBackup?: boolean;
  skipValidation?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Rollback command options
 */
export interface MigrateRollbackOptions {
  backup: string;
  target?: string;
  verbose?: boolean;
}

/**
 * Migrate command handler - transforms layer YAML to graph format
 */
export async function modelMigrateCommand(
  options: ModelMigrateOptions
): Promise<void> {
  const sourceDir = options.source || process.cwd();
  const targetDir = options.target || path.join(sourceDir, "model-v2");

  try {
    console.log(ansis.bold(`\n🔄 Model Migration to Graph Format\n`));
    console.log(ansis.cyan(`Source: ${path.relative(process.cwd(), sourceDir)}`));
    console.log(ansis.cyan(`Target: ${path.relative(process.cwd(), targetDir)}\n`));

    if (options.dryRun) {
      console.log(ansis.yellow("DRY RUN MODE - No changes will be written\n"));
    }

    // Load source model
    const model = await Model.load(sourceDir, { lazyLoad: false });
    const service = new ModelMigrationService(model);

    // Perform migration
    const result = await service.migrate(sourceDir, {
      targetDir,
      backupOriginal: options.noBackup !== true,
      validateAfterMigration: options.skipValidation !== true,
      preserveProperties: true,
    });

    // Display results
    displayMigrationResults(result, options.verbose || false);

    if (!result.success) {
      console.error(ansis.red("\n✗ Migration failed with validation errors"));
      process.exit(1);
    }

    console.log(ansis.green("\n✓ Migration completed successfully"));
    if (result.backupDir) {
      console.log(ansis.dim(`  Backup saved to: ${result.backupDir}`));
      console.log(
        ansis.dim(
          `  Rollback: dr migrate rollback --backup ${path.basename(
            result.backupDir
          )}`
        )
      );
    }
  } catch (error) {
    console.error(ansis.red("✗ Migration error:"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Rollback command handler - restore from backup
 */
export async function migrateRollbackCommand(
  options: MigrateRollbackOptions
): Promise<void> {
  const backupDir = options.backup;
  const targetDir = options.target || process.cwd();

  try {
    console.log(ansis.bold(`\n↩️  Migration Rollback\n`));
    console.log(ansis.cyan(`Backup: ${path.relative(process.cwd(), backupDir)}`));
    console.log(
      ansis.cyan(`Target: ${path.relative(process.cwd(), targetDir)}\n`)
    );

    const model = await Model.load(targetDir, { lazyLoad: false });
    const service = new ModelMigrationService(model);

    console.log(ansis.yellow("Restoring from backup..."));
    await service.rollback(backupDir, targetDir);

    console.log(ansis.green("✓ Rollback completed successfully"));
    console.log(ansis.dim(`  Model restored from: ${backupDir}`));
  } catch (error) {
    console.error(ansis.red("✗ Rollback failed:"));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Display migration results with formatting
 */
function displayMigrationResults(
  result: ModelMigrationResult,
  verbose: boolean
): void {
  console.log(ansis.dim("Migration Summary:"));
  console.log(
    ansis.dim(`  Elements migrated: ${ansis.cyan(result.elementCount.toString())}`)
  );
  console.log(
    ansis.dim(`  Relationships created: ${ansis.cyan(result.relationshipCount.toString())}`)
  );
  console.log(ansis.dim(`  Duration: ${ansis.cyan(result.duration + "ms")}`));

  if (result.warnings.length > 0) {
    console.log(ansis.yellow(`\n  Warnings (${result.warnings.length}):`));
    result.warnings.forEach((w) => {
      console.log(ansis.dim(`    - ${w}`));
    });
  }

  if (result.validationErrors.length > 0) {
    console.log(ansis.red(`\n  Validation Errors (${result.validationErrors.length}):`));
    result.validationErrors.slice(0, 5).forEach((e) => {
      console.log(ansis.dim(`    - ${e}`));
    });
    if (result.validationErrors.length > 5) {
      console.log(
        ansis.dim(
          `    ... and ${result.validationErrors.length - 5} more errors`
        )
      );
    }
  }

  if (verbose && result.mappingFilePath) {
    console.log(
      ansis.dim(
        `\n  Mapping table: ${path.relative(process.cwd(), result.mappingFilePath)}`
      )
    );
  }
}
