/**
 * Upgrade Command - Manages spec reference and model upgrades
 *
 * Two-step process:
 * 1. Check and upgrade .dr/ (spec reference) if CLI has newer bundled version
 * 2. Check and upgrade model if .dr/ spec is newer than model spec
 */

import ansis from 'ansis';
import { findProjectRoot, getSpecReferencePath, getModelPath } from '../utils/project-paths.js';
import {
  getCliBundledSpecVersion,
  getInstalledSpecVersion,
  getModelSpecVersion,
} from '../utils/spec-version.js';
import { MigrationRegistry } from '../core/migration-registry.js';

export async function upgradeCommand(): Promise<void> {
  try {
    console.log(ansis.bold('\nChecking for available upgrades...\n'));

    // Find project root
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      console.error(ansis.red('Error: No DR project found'));
      console.error(ansis.dim('Run "dr init" to create a new project'));
      process.exit(1);
    }

    const bundledSpecVersion = getCliBundledSpecVersion();

    // STEP 1: Check .dr/ (spec reference) upgrade
    console.log(ansis.bold('Step 1: Checking spec reference (.dr/)...\n'));

    const drPath = await getSpecReferencePath();
    if (!drPath) {
      console.log(ansis.yellow('⚠ No .dr/ folder found'));
      console.log(ansis.dim(`  Run "dr init" to install spec reference (v${bundledSpecVersion})\n`));
    } else {
      const installedSpecVersion = await getInstalledSpecVersion(drPath);

      if (!installedSpecVersion) {
        console.log(ansis.yellow('⚠ .dr/manifest.json not found or invalid'));
        console.log(ansis.dim(`  Reinstall with: dr init --force\n`));
      } else if (installedSpecVersion !== bundledSpecVersion) {
        console.log(
          ansis.yellow(
            `Spec reference upgrade available: ${installedSpecVersion} → ${bundledSpecVersion}`
          )
        );
        console.log(ansis.dim(`  .dr/ folder will be updated to v${bundledSpecVersion}`));
        console.log(ansis.dim('  Run: dr upgrade spec\n'));
      } else {
        console.log(ansis.green(`✓ Spec reference is up to date (v${installedSpecVersion})\n`));
      }
    }

    // STEP 2: Check model upgrade
    console.log(ansis.bold('Step 2: Checking model (documentation_robotics/model/)...\n'));

    const modelPath = await getModelPath();
    if (!modelPath) {
      console.log(ansis.yellow('⚠ No model found'));
      console.log(ansis.dim('  Run "dr init" to create a model\n'));
      return;
    }

    const modelSpecVersion = await getModelSpecVersion(modelPath);
    if (!modelSpecVersion) {
      console.log(ansis.yellow('⚠ Model manifest.yaml not found or missing specVersion'));
      console.log(ansis.dim('  Check documentation_robotics/model/manifest.yaml\n'));
      return;
    }

    // Compare model spec to installed spec (or bundled if .dr/ doesn't exist)
    const targetSpecVersion = drPath
      ? (await getInstalledSpecVersion(drPath)) || bundledSpecVersion
      : bundledSpecVersion;

    if (modelSpecVersion !== targetSpecVersion) {
      console.log(
        ansis.yellow(
          `Model upgrade available: ${modelSpecVersion} → ${targetSpecVersion}`
        )
      );
      console.log(ansis.dim(`  Model will be migrated to spec v${targetSpecVersion}`));

      // Show migration path
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary(modelSpecVersion, targetSpecVersion);

      if (summary.migrationsNeeded > 0) {
        console.log(ansis.dim('\nMigration path:'));
        for (const migration of summary.migrations) {
          console.log(
            ansis.dim(`  • ${migration.from} → ${migration.to}: ${migration.description}`)
          );
        }
      }

      console.log(ansis.dim(`\n  Run: dr migrate --to ${targetSpecVersion}\n`));
    } else {
      console.log(ansis.green(`✓ Model is up to date (v${modelSpecVersion})\n`));
    }
  } catch (error) {
    console.error(
      ansis.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
  }
}
