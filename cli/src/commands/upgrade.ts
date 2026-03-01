/**
 * Upgrade Command - Manages spec reference and model upgrades
 *
 * Scans the filesystem to determine what needs upgrading:
 * 1. .dr/ (spec reference) - if CLI has newer bundled version
 * 2. Model data - if model spec version doesn't match spec reference
 *
 * Shows upgrade plan and prompts for confirmation before proceeding.
 */

import ansis from "ansis";
import { confirm } from "@clack/prompts";
import { findProjectRoot, getSpecReferencePath, getModelPath } from "../utils/project-paths.js";
import {
  getCliVersion,
  getCliBundledSpecVersion,
  getInstalledSpecVersion,
  getModelSpecVersion,
} from "../utils/spec-version.js";
import { MigrationRegistry } from "../core/migration-registry.js";
import { installSpecReference } from "../utils/spec-installer.js";
import { Model } from "../core/model.js";
import { ClaudeIntegrationManager } from "../integrations/claude-manager.js";
import { CopilotIntegrationManager } from "../integrations/copilot-manager.js";
import { getErrorMessage } from "../utils/errors.js";

export interface UpgradeOptions {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

interface UpgradeAction {
  type: "spec" | "model" | "integration";
  description: string;
  fromVersion?: string;
  toVersion: string;
  details?: string[];
  integrationName?: "claude" | "copilot";
}

/**
 * Build integration upgrade actions and collect up-to-date status lines
 */
async function buildIntegrationActions(
  cliVersion: string,
  force: boolean
): Promise<{ actions: UpgradeAction[]; upToDate: string[] }> {
  const actions: UpgradeAction[] = [];
  const upToDate: string[] = [];

  // Check Claude integration
  const claudeManager = new ClaudeIntegrationManager();
  if (await claudeManager.isInstalled()) {
    const claudeVersion = await claudeManager.loadVersionFile();
    const installedVersion = claudeVersion?.version;
    const needsUpgrade = installedVersion && installedVersion !== cliVersion;

    if (force || needsUpgrade) {
      actions.push({
        type: "integration",
        description: force
          ? "Reinstall Claude Code integration (forced)"
          : "Upgrade Claude Code integration",
        fromVersion: installedVersion,
        toVersion: cliVersion,
        integrationName: "claude",
      });
    } else if (installedVersion) {
      upToDate.push(
        `  ${ansis.green("✓")} Claude Code integration up to date (v${installedVersion})`
      );
    }
  }

  // Check Copilot integration
  const copilotManager = new CopilotIntegrationManager();
  if (await copilotManager.isInstalled()) {
    const copilotVersion = await copilotManager.loadVersionFile();
    const installedVersion = copilotVersion?.version;
    const needsUpgrade = installedVersion && installedVersion !== cliVersion;

    if (force || needsUpgrade) {
      actions.push({
        type: "integration",
        description: force
          ? "Reinstall GitHub Copilot integration (forced)"
          : "Upgrade GitHub Copilot integration",
        fromVersion: installedVersion,
        toVersion: cliVersion,
        integrationName: "copilot",
      });
    } else if (installedVersion) {
      upToDate.push(
        `  ${ansis.green("✓")} GitHub Copilot integration up to date (v${installedVersion})`
      );
    }
  }

  return { actions, upToDate };
}

export async function upgradeCommand(options: UpgradeOptions = {}): Promise<void> {
  try {
    console.log(ansis.bold("\nScanning for available upgrades...\n"));

    // Find project root
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      console.error(ansis.red("Error: No DR project found"));
      console.error(ansis.dim('Run "dr init" to create a new project'));
      process.exit(1);
    }

    const bundledSpecVersion = getCliBundledSpecVersion();
    const cliVersion = getCliVersion();
    const actions: UpgradeAction[] = [];

    // ============================================================================
    // STEP 1: Check spec reference (.dr/ folder)
    // ============================================================================

    const drPath = await getSpecReferencePath();
    let currentSpecVersion: string | null = null;

    if (!drPath) {
      actions.push({
        type: "spec",
        description: "Install spec reference",
        toVersion: bundledSpecVersion,
        details: [
          "Create .dr/ folder",
          "Install schema files",
          `Set spec version to ${bundledSpecVersion}`,
        ],
      });
    } else {
      const installedSpecVersion = await getInstalledSpecVersion(drPath);
      currentSpecVersion = installedSpecVersion;

      if (!installedSpecVersion) {
        actions.push({
          type: "spec",
          description: "Reinstall spec reference (manifest missing)",
          toVersion: bundledSpecVersion,
          details: [
            "Recreate .dr/manifest.json",
            "Update schema files",
            `Set spec version to ${bundledSpecVersion}`,
          ],
        });
      } else if (installedSpecVersion !== bundledSpecVersion || options.force) {
        actions.push({
          type: "spec",
          description: installedSpecVersion !== bundledSpecVersion
            ? "Upgrade spec reference"
            : "Reinstall spec reference (forced)",
          fromVersion: installedSpecVersion,
          toVersion: bundledSpecVersion,
          details: ["Update schema files", "Update .dr/manifest.json"],
        });
      }
    }

    // ============================================================================
    // STEP 2: Check model upgrade
    // ============================================================================

    const modelPath = await getModelPath();
    if (!modelPath) {
      console.log(ansis.yellow("⚠ No model found"));
      console.log(ansis.dim('  Run "dr init" to create a model\n'));

      // If only spec needs upgrade, handle it
      if (actions.length > 0) {
        const { actions: integrationActions, upToDate: integrationUpToDate } =
          await buildIntegrationActions(cliVersion, options.force ?? false);
        actions.push(...integrationActions);
        await handleUpgrade(projectRoot, actions, options, integrationUpToDate);
      }
      return;
    }

    const modelSpecVersion = await getModelSpecVersion(modelPath);
    if (!modelSpecVersion) {
      console.log(ansis.yellow("⚠ Model manifest.yaml not found or missing specVersion"));
      console.log(ansis.dim("  Check documentation_robotics/model/manifest.yaml\n"));

      // If only spec needs upgrade, handle it
      if (actions.length > 0) {
        const { actions: integrationActions, upToDate: integrationUpToDate } =
          await buildIntegrationActions(cliVersion, options.force ?? false);
        actions.push(...integrationActions);
        await handleUpgrade(projectRoot, actions, options, integrationUpToDate);
      }
      return;
    }

    // Determine target spec version for model
    const targetSpecVersion = currentSpecVersion || bundledSpecVersion;

    if (modelSpecVersion !== targetSpecVersion) {
      // Check if we have a migration path
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary(modelSpecVersion, targetSpecVersion);

      if (summary.migrationsNeeded === 0) {
        console.log(
          ansis.yellow(
            `⚠ No migration path found from model v${modelSpecVersion} to v${targetSpecVersion}`
          )
        );
        console.log(ansis.dim("\nAvailable migrations:"));
        const allMigrations = registry.getMigrationSummary("0.5.0").migrations;
        for (const migration of allMigrations) {
          console.log(
            ansis.dim(`  • ${migration.from} → ${migration.to}: ${migration.description}`)
          );
        }
        console.log();
        process.exit(1);
      }

      const migrationDetails = summary.migrations.map(
        (m) => `${m.from} → ${m.to}: ${m.description}`
      );

      actions.push({
        type: "model",
        description: "Migrate model data",
        fromVersion: modelSpecVersion,
        toVersion: targetSpecVersion,
        details: migrationDetails,
      });
    }

    // ============================================================================
    // STEP 3: Check integration versions
    // ============================================================================

    const { actions: integrationActions, upToDate: integrationUpToDate } =
      await buildIntegrationActions(cliVersion, options.force ?? false);
    actions.push(...integrationActions);

    // ============================================================================
    // STEP 4: Display upgrade plan and execute
    // ============================================================================

    if (actions.length === 0) {
      console.log(ansis.green("✓ Everything is up to date!\n"));
      console.log(ansis.dim(`  Spec reference: v${currentSpecVersion || bundledSpecVersion}`));
      console.log(ansis.dim(`  Model: v${modelSpecVersion}\n`));
      return;
    }

    await handleUpgrade(projectRoot, actions, options, integrationUpToDate);
  } catch (error) {
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    process.exit(1);
  }
}

/**
 * Handle the upgrade process
 */
async function handleUpgrade(
  projectRoot: string,
  actions: UpgradeAction[],
  options: UpgradeOptions,
  integrationUpToDate: string[] = []
): Promise<void> {
  // Display upgrade plan
  if (actions.length > 0) {
    console.log(ansis.bold("Upgrade Plan:\n"));

    for (const action of actions) {
      const versionChange = action.fromVersion
        ? `${action.fromVersion} → ${action.toVersion}`
        : `v${action.toVersion}`;

      const icon = action.type === "spec" ? "📦" : action.type === "integration" ? "🔌" : "🔄";
      console.log(ansis.yellow(`${icon} ${action.description}`));
      console.log(ansis.dim(`   Version: ${versionChange}`));

      if (action.details && action.details.length > 0) {
        for (const detail of action.details) {
          console.log(ansis.dim(`   • ${detail}`));
        }
      }
      console.log();
    }
  }

  // Display integration status for up-to-date integrations
  if (integrationUpToDate.length > 0) {
    console.log(ansis.bold("Integration Status:"));
    integrationUpToDate.forEach((msg) => console.log(msg));
    console.log();
  }

  // Handle dry-run mode
  if (options.dryRun) {
    console.log(ansis.yellow("[DRY RUN] No changes will be made\n"));
    return;
  }

  // Prompt for confirmation unless --yes flag is set
  let shouldProceed = options.yes;
  if (!shouldProceed) {
    // Check if we're in an interactive terminal
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (isInteractive) {
      const response = await confirm({
        message: "Proceed with upgrade?",
      });
      shouldProceed = response === true;
    } else {
      console.error(
        ansis.red("Error: Non-interactive mode requires --yes flag to proceed with upgrade")
      );
      process.exit(1);
    }
  }

  if (!shouldProceed) {
    console.log(ansis.dim("\nUpgrade cancelled\n"));
    return;
  }

  console.log(ansis.bold("\nExecuting upgrades...\n"));

  // Execute actions in order: spec, model, then integrations
  for (const action of actions) {
    if (action.type === "spec") {
      await executeSpecUpgrade(projectRoot, action);
    } else if (action.type === "model") {
      await executeModelMigration(action, options);
    } else if (action.type === "integration") {
      await executeIntegrationUpdate(action.description, async () => {
        if (action.integrationName === "claude") {
          const m = new ClaudeIntegrationManager();
          await m.upgrade({ force: true }); // force=true skips internal prompts (user confirmed above)
        } else {
          const m = new CopilotIntegrationManager();
          await m.upgrade({ force: true });
        }
      });
    }
  }

  console.log(ansis.green("\n✓ All upgrades completed successfully!\n"));
}

/**
 * Execute spec reference upgrade
 */
async function executeSpecUpgrade(projectRoot: string, action: UpgradeAction): Promise<void> {
  try {
    console.log(ansis.dim(`Installing spec reference v${action.toVersion}...`));
    await installSpecReference(projectRoot, true);
    console.log(ansis.green(`✓ Spec reference upgraded to v${action.toVersion}`));
  } catch (error) {
    console.error(
      ansis.red(
        `Error upgrading spec reference: ${getErrorMessage(error)}`
      )
    );
    throw error;
  }
}

/**
 * Execute model migration
 */
async function executeModelMigration(
  action: UpgradeAction,
  options: UpgradeOptions
): Promise<void> {
  try {
    console.log(
      ansis.dim(`Migrating model from v${action.fromVersion} to v${action.toVersion}...`)
    );

    // Load the model
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    // Apply migrations
    const registry = new MigrationRegistry();
    const result = await registry.applyMigrations(model, {
      fromVersion: action.fromVersion!,
      toVersion: action.toVersion,
      dryRun: false,
      validate: !options.force,
    });

    // Display migration results
    for (const applied of result.applied) {
      console.log(ansis.green(`  ✓ ${applied.from} → ${applied.to}: ${applied.description}`));
      if (applied.changes?.filesModified) {
        console.log(ansis.dim(`    Files modified: ${applied.changes.filesModified}`));
      }
    }

    // Save changes
    await model.saveManifest();
    await model.saveDirtyLayers();

    console.log(ansis.green(`✓ Model migrated to v${action.toVersion}`));
  } catch (error) {
    console.error(
      ansis.red(`Error migrating model: ${getErrorMessage(error)}`)
    );
    throw error;
  }
}

/**
 * Execute integration update
 */
async function executeIntegrationUpdate(
  label: string,
  updateFn: () => Promise<void>
): Promise<void> {
  try {
    console.log(ansis.dim(`${label}...`));
    await updateFn();
    console.log(ansis.green(`✓ ${label}`));
  } catch (error) {
    console.error(ansis.red(`Error: ${label} failed: ${getErrorMessage(error)}`));
    throw error;
  }
}
