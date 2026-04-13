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
import { startSpan, endSpan } from "../telemetry/index.js";
import { hasLayerReports, regenerateLayerReports } from "./reports.js";

// Build-time constant for telemetry feature detection
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

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
  versionBumpOnly?: boolean;
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

/**
 * Check if layer reports exist; if not, offer to generate them.
 * Defaults to generating (yes) — including in non-interactive/programmatic mode.
 */
async function checkAndGenerateReports(
  projectRoot: string,
  options: UpgradeOptions
): Promise<void> {
  if (await hasLayerReports(projectRoot)) {
    return;
  }

  console.log(ansis.yellow("\n⚠ No layer reports found"));

  if (options.dryRun) {
    console.log(ansis.yellow("[DRY RUN] Would generate all 12 layer reports\n"));
    return;
  }

  // Determine whether to generate: default is yes
  let shouldGenerate: boolean;
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

  if (options.yes) {
    shouldGenerate = true;
  } else if (isInteractive) {
    const response = await confirm({
      message: "Generate layer reports?",
      initialValue: true,
    });
    shouldGenerate = response === true;
  } else {
    // Non-interactive / programmatic: auto-generate since default is yes
    shouldGenerate = true;
  }

  if (!shouldGenerate) {
    console.log(ansis.dim("Skipping report generation\n"));
    return;
  }

  try {
    console.log();
    await regenerateLayerReports(projectRoot);
  } catch (error) {
    // Warn but don't block upgrade success
    console.warn(ansis.yellow(`\n⚠ Failed to generate reports: ${getErrorMessage(error)}\n`));
  }
}

export async function upgradeCommand(options: UpgradeOptions = {}): Promise<void> {
  const commandSpan = isTelemetryEnabled
    ? startSpan("upgrade.execute", {
        "upgrade.yes": options.yes || false,
        "upgrade.dry_run": options.dryRun || false,
        "upgrade.force": options.force || false,
      })
    : null;

  try {
    console.log(ansis.bold("\nScanning for available upgrades...\n"));

    // Find project root
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      const error = new Error("No DR project found. Run \"dr init\" to create a new project");
      if (commandSpan) {
        commandSpan.recordException(error);
        commandSpan.setStatus({
          code: 2, // SpanStatusCode.ERROR
          message: error.message,
        });
        commandSpan.setAttribute("upgrade.result", "no_project");
      }
      console.error(ansis.red("Error: No DR project found"));
      console.error(ansis.dim('Run "dr init" to create a new project'));
      throw error;
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
      let installedSpecVersion: string | null = null;
      try {
        installedSpecVersion = await getInstalledSpecVersion(drPath);
      } catch (error) {
        // Manifest file exists but is corrupted or unreadable
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
        throw error;
      }
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
        await handleUpgrade(projectRoot, actions, options, integrationUpToDate, commandSpan);
      }
      // No model loaded — report generation not applicable
      return;
    }

    let modelSpecVersion: string | null = null;
    try {
      modelSpecVersion = await getModelSpecVersion(modelPath);
    } catch (error) {
      // Manifest file exists but is corrupted or unreadable
      const message = error instanceof Error ? error.message : String(error);
      console.error(ansis.red(`Error: ${message}`));
      throw error;
    }

    if (!modelSpecVersion) {
      console.log(ansis.yellow("⚠ Model manifest.yaml not found or missing specVersion"));
      console.log(ansis.dim("  Check documentation_robotics/model/manifest.yaml\n"));

      // If only spec needs upgrade, handle it
      if (actions.length > 0) {
        const { actions: integrationActions, upToDate: integrationUpToDate } =
          await buildIntegrationActions(cliVersion, options.force ?? false);
        actions.push(...integrationActions);
        await handleUpgrade(projectRoot, actions, options, integrationUpToDate, commandSpan);
      }
      // No readable model manifest — report generation not applicable
      return;
    }

    // Determine target spec version for model
    const targetSpecVersion = currentSpecVersion || bundledSpecVersion;

    if (modelSpecVersion !== targetSpecVersion) {
      // Check if we have a migration path
      const registry = new MigrationRegistry();
      const summary = registry.getMigrationSummary(modelSpecVersion, targetSpecVersion);

      if (summary.migrationsNeeded === 0) {
        if (options.force) {
          // No migration path exists, but --force allows bumping the model version directly.
          // This is safe for additive spec changes (new node types / relationships) that
          // require no structural data changes.
          actions.push({
            type: "model",
            description: "Force-update model spec version (no migration required)",
            fromVersion: modelSpecVersion,
            toVersion: targetSpecVersion,
            details: ["Update manifest.yaml specVersion (no data changes needed)"],
            versionBumpOnly: true,
          });
        } else {
          const error = new Error(
            `No migration path found from model v${modelSpecVersion} to v${targetSpecVersion}`
          );
          if (commandSpan) {
            commandSpan.recordException(error);
            commandSpan.setStatus({
              code: 2, // SpanStatusCode.ERROR
              message: error.message,
            });
            commandSpan.setAttribute("upgrade.result", "no_migration_path");
          }
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
          throw error;
        }
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
      if (commandSpan) {
        commandSpan.setAttribute("upgrade.result", "up_to_date");
        commandSpan.setAttribute("upgrade.actions_count", 0);
      }
      console.log(ansis.green("✓ Everything is up to date!\n"));
      console.log(ansis.dim(`  Spec reference: v${currentSpecVersion || bundledSpecVersion}`));
      console.log(ansis.dim(`  Model: v${modelSpecVersion}\n`));
      await checkAndGenerateReports(projectRoot, options);
      return;
    }

    if (commandSpan) {
      commandSpan.setAttribute("upgrade.actions_count", actions.length);
      commandSpan.setAttribute(
        "upgrade.has_spec_upgrade",
        actions.some((a) => a.type === "spec")
      );
      commandSpan.setAttribute(
        "upgrade.has_model_migration",
        actions.some((a) => a.type === "model")
      );
      commandSpan.setAttribute(
        "upgrade.has_integration_upgrade",
        actions.some((a) => a.type === "integration")
      );
    }

    await handleUpgrade(projectRoot, actions, options, integrationUpToDate, commandSpan);
    await checkAndGenerateReports(projectRoot, options);

    if (commandSpan) {
      commandSpan.setAttribute("upgrade.result", "success");
    }
  } catch (error) {
    if (commandSpan) {
      commandSpan.recordException(error as Error);
      commandSpan.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: getErrorMessage(error),
      });
      commandSpan.setAttribute("upgrade.result", "error");
    }
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    throw error;
  } finally {
    endSpan(commandSpan);
  }
}

/**
 * Handle the upgrade process
 */
async function handleUpgrade(
  projectRoot: string,
  actions: UpgradeAction[],
  options: UpgradeOptions,
  integrationUpToDate: string[] = [],
  parentSpan: any = null
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
    if (parentSpan) {
      parentSpan.setAttribute("upgrade.dry_run_completed", true);
    }
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
      const error = new Error("Non-interactive mode requires --yes flag to proceed with upgrade");
      if (parentSpan) {
        parentSpan.recordException(error);
        parentSpan.setAttribute("upgrade.result", "non_interactive_abort");
      }
      console.error(
        ansis.red("Error: Non-interactive mode requires --yes flag to proceed with upgrade")
      );
      throw error;
    }
  }

  if (!shouldProceed) {
    console.log(ansis.dim("\nUpgrade cancelled\n"));
    if (parentSpan) {
      parentSpan.setAttribute("upgrade.user_cancelled", true);
    }
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
  const operationSpan = isTelemetryEnabled
    ? startSpan("upgrade.spec", {
        "upgrade.spec.from_version": action.fromVersion || "none",
        "upgrade.spec.to_version": action.toVersion,
        "upgrade.spec.is_reinstall": !action.fromVersion,
      })
    : null;

  try {
    console.log(ansis.dim(`Installing spec reference v${action.toVersion}...`));
    await installSpecReference(projectRoot, true);
    console.log(ansis.green(`✓ Spec reference upgraded to v${action.toVersion}`));

    if (operationSpan) {
      operationSpan.setAttribute("upgrade.spec.result", "success");
    }
  } catch (error) {
    if (operationSpan) {
      operationSpan.recordException(error as Error);
      operationSpan.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: getErrorMessage(error),
      });
      operationSpan.setAttribute("upgrade.spec.result", "error");
    }
    console.error(
      ansis.red(
        `Error upgrading spec reference: ${getErrorMessage(error)}`
      )
    );
    throw error;
  } finally {
    endSpan(operationSpan);
  }
}

/**
 * Execute model migration
 */
async function executeModelMigration(
  action: UpgradeAction,
  options: UpgradeOptions
): Promise<void> {
  const operationSpan = isTelemetryEnabled
    ? startSpan("upgrade.model", {
        "upgrade.model.from_version": action.fromVersion || "unknown",
        "upgrade.model.to_version": action.toVersion,
        "upgrade.model.version_bump_only": action.versionBumpOnly || false,
        "upgrade.model.validate": !options.force,
      })
    : null;

  try {
    if (action.versionBumpOnly) {
      console.log(
        ansis.dim(`Bumping model spec version from v${action.fromVersion} to v${action.toVersion}...`)
      );
      const model = await Model.load(process.cwd(), { lazyLoad: true });
      model.manifest.specVersion = action.toVersion;
      await model.saveManifest();
      console.log(ansis.green(`✓ Model spec version updated to v${action.toVersion}`));

      if (operationSpan) {
        operationSpan.setAttribute("upgrade.model.result", "version_bumped");
      }
      return;
    }

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

    if (operationSpan) {
      operationSpan.setAttribute("upgrade.model.result", "migrated");
      operationSpan.setAttribute("upgrade.model.migrations_applied", result.applied.length);
    }
  } catch (error) {
    if (operationSpan) {
      operationSpan.recordException(error as Error);
      operationSpan.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: getErrorMessage(error),
      });
      operationSpan.setAttribute("upgrade.model.result", "error");
    }
    console.error(
      ansis.red(`Error migrating model: ${getErrorMessage(error)}`)
    );
    throw error;
  } finally {
    endSpan(operationSpan);
  }
}

/**
 * Execute integration update
 */
async function executeIntegrationUpdate(
  label: string,
  updateFn: () => Promise<void>
): Promise<void> {
  const operationSpan = isTelemetryEnabled
    ? startSpan("upgrade.integration", {
        "upgrade.integration.label": label,
        "upgrade.integration.type": label.includes("Claude")
          ? "claude"
          : label.includes("Copilot")
          ? "copilot"
          : "unknown",
      })
    : null;

  try {
    console.log(ansis.dim(`${label}...`));
    await updateFn();
    console.log(ansis.green(`✓ ${label}`));

    if (operationSpan) {
      operationSpan.setAttribute("upgrade.integration.result", "success");
    }
  } catch (error) {
    if (operationSpan) {
      operationSpan.recordException(error as Error);
      operationSpan.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: getErrorMessage(error),
      });
      operationSpan.setAttribute("upgrade.integration.result", "error");
    }
    console.error(ansis.red(`Error: ${label} failed: ${getErrorMessage(error)}`));
    throw error;
  } finally {
    endSpan(operationSpan);
  }
}
