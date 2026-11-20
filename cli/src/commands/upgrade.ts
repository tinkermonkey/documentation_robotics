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
import { findProjectRoot, getModelPath } from "../utils/project-paths.js";
import { getCliVersion, getCliBundledSpecVersion, getModelSpecVersion } from "../utils/spec-version.js";
import {
  countDroppedRelationships,
  previewCatalog,
  previewDropRecord,
  scanUpgrades,
  UpgradeScanError,
  type UpgradeAction,
  type UpgradeScan,
} from "../core/upgrade-plan.js";
import {
  upgradeModel,
  type ChangesetRebaselineResult,
  type ChangesetRef,
} from "../core/model-upgrade.js";
import { formatRoutes, type UpgradeDropRecord } from "../core/upgrade-drop-record.js";
import {
  summarizeRelationshipChanges,
  type RelationshipRewriteChange,
  type StagedRelationshipRewriteChange,
} from "../core/relationship-migration.js";
import { installSpecReference } from "../utils/spec-installer.js";
import { ensureDotDrIgnored, dotDrIgnoreWarnings } from "../core/dot-dr-ignore.js";
import { CHANGESETS_FOLDER, ensurePrettierIgnoresChangesets, prettierIgnoreNote } from "../core/prettier-ignore.js";
import {
  summarizeRetiredAttributeChanges,
  type RetiredAttributeChange,
  type StagedRetiredAttributeChange,
} from "../core/attribute-migration.js";
import { ClaudeIntegrationManager } from "../integrations/claude-manager.js";
import { CopilotIntegrationManager } from "../integrations/copilot-manager.js";
import { getErrorMessage } from "../utils/errors.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { hasLayerReports, regenerateLayerReports } from "./reports.js";
import { Model } from "../core/model.js";
import { errorsByElement, validateBaseModel } from "../core/upgrade-validation.js";
import type { ValidationIssue } from "../validators/types.js";

// Build-time constant for telemetry feature detection
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface UpgradeOptions {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
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
    console.log(ansis.yellow("[DRY RUN] Would generate all 13 layer reports\n"));
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

    // ============================================================================
    // STEPS 1-2: Check the spec reference (.dr/ folder) and the model
    // ============================================================================

    let scan: UpgradeScan;
    try {
      // Target the spec this dr carries, so the model moves in the same run as a stale or
      // missing spec reference rather than on the next one
      scan = await scanUpgrades(projectRoot, { force: options.force, targetBundledSpec: true });
    } catch (error) {
      // The spec reference or model manifest exists but is corrupted or unreadable
      if (error instanceof UpgradeScanError) {
        console.error(ansis.red(`Error: ${error.message}`));
      }
      throw error;
    }
    const actions: UpgradeAction[] = [...scan.actions];
    const currentSpecVersion = scan.installedSpecVersion;

    if (scan.model.state !== "found") {
      if (scan.model.state === "missing") {
        console.log(ansis.yellow("⚠ No model found"));
        console.log(ansis.dim('  Run "dr init" to create a model\n'));
      } else {
        console.log(ansis.yellow("⚠ Model manifest.yaml not found or missing specVersion"));
        console.log(ansis.dim("  Check documentation_robotics/model/manifest.yaml\n"));
      }

      // If only spec needs upgrade, handle it
      if (actions.length > 0) {
        const { actions: integrationActions, upToDate: integrationUpToDate } =
          await buildIntegrationActions(cliVersion, options.force ?? false);
        actions.push(...integrationActions);
        await handleUpgrade(projectRoot, actions, options, integrationUpToDate, commandSpan);
      }
      // No readable model — report generation not applicable
      return;
    }

    const modelSpecVersion = scan.model.specVersion;

    if (scan.noMigrationPath) {
      const { from, to, available } = scan.noMigrationPath;
      const error = new Error(`No migration path found from model v${from} to v${to}`);
      if (commandSpan) {
        commandSpan.recordException(error);
        commandSpan.setStatus({
          code: 2, // SpanStatusCode.ERROR
          message: error.message,
        });
        commandSpan.setAttribute("upgrade.result", "no_migration_path");
      }
      console.log(ansis.yellow(`⚠ No migration path found from model v${from} to v${to}`));
      console.log(ansis.dim("\nAvailable migrations:"));
      for (const migration of available) {
        console.log(ansis.dim(`  • ${migration.from} → ${migration.to}: ${migration.description}`));
      }
      console.log();
      throw error;
    }

    if (scan.catalogCheckError !== undefined) {
      console.log(ansis.yellow(`⚠ Could not check the model against the catalog: ${scan.catalogCheckError}`));
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
      if (!options.dryRun) await keepPrettierOffChangesets(projectRoot);
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

    await handleUpgrade(projectRoot, actions, options, integrationUpToDate, commandSpan, scan);
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
  parentSpan: any = null,
  scan?: UpgradeScan
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

  // Before anything is written, say which relationships the migration would drop
  if (scan && actions.some((a) => a.type === "model") && (options.dryRun || !options.yes)) {
    await printDroppedRelationshipPreview(projectRoot, scan);
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
  let drifted: ChangesetRef[] = [];
  let modelUpgraded = false;
  for (const action of actions) {
    if (action.type === "spec") {
      await executeSpecUpgrade(projectRoot, action);
    } else if (action.type === "model") {
      drifted = (await executeModelMigration(projectRoot, action, options)).drifted;
      modelUpgraded = true;
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

  await keepPrettierOffChangesets(projectRoot);

  if (modelUpgraded) {
    await printValidationChecklist(projectRoot);
  }

  // Drifted changesets lead the summary, where they can't be missed at the end of a long log
  printDriftedChangesets(drifted);
  await printUpgradeOutcome(projectRoot);
}

/**
 * dr writes changeset files in its own layout: when the project uses prettier, list the
 * changesets folder in .prettierignore so prettier doesn't reformat them (#1155).
 */
async function keepPrettierOffChangesets(projectRoot: string): Promise<void> {
  try {
    const note = prettierIgnoreNote(await ensurePrettierIgnoresChangesets(projectRoot));
    if (note) console.log(ansis.dim(note));
  } catch (error) {
    console.warn(
      ansis.yellow(`⚠ Warning: could not update .prettierignore: ${getErrorMessage(error)}. Add ${CHANGESETS_FOLDER}/ to it by hand.`)
    );
  }
}

/** At most this many elements are listed in the post-upgrade validation checklist */
const MAX_CHECKLIST_ELEMENTS = 50;

/**
 * Validate the upgraded base model and list its errors per element: the required attributes each
 * element leaves empty, then its other errors. The upgrade fills nothing in; this is what's left.
 */
async function printValidationChecklist(projectRoot: string): Promise<void> {
  let errors: ValidationIssue[];
  try {
    const model = await Model.load(projectRoot, { lazyLoad: false });
    errors = (await validateBaseModel(model)).errors;
  } catch (error) {
    console.warn(ansis.yellow(`\n⚠ Could not validate the upgraded model: ${getErrorMessage(error)}`));
    return;
  }
  if (errors.length === 0) {
    console.log(ansis.green("\n✓ The upgraded model validates without errors"));
    return;
  }

  const groups = errorsByElement(errors);
  console.log(
    ansis.yellow(
      `\n⚠ The upgraded model has ${errors.length} validation error(s) on ${groups.length} element(s):`
    )
  );
  for (const group of groups.slice(0, MAX_CHECKLIST_ELEMENTS)) {
    console.log(`  ${group.elementId ?? `(${group.layer} layer)`}`);
    if (group.missingAttributes.length > 0) {
      console.log(ansis.dim(`    required, left empty: ${group.missingAttributes.join(", ")}`));
    }
    for (const message of group.messages) {
      console.log(ansis.dim(`    ${message}`));
    }
  }
  if (groups.length > MAX_CHECKLIST_ELEMENTS) {
    console.log(
      ansis.dim(`  ...and ${groups.length - MAX_CHECKLIST_ELEMENTS} more element(s); dr validate lists them all`)
    );
  }
}

/**
 * Say where the upgrade left the model: at the spec version this dr carries, or not, in which
 * case the success line would mislead
 */
async function printUpgradeOutcome(projectRoot: string): Promise<void> {
  const bundledSpecVersion = getCliBundledSpecVersion();
  const modelPath = await getModelPath(projectRoot);
  const modelSpecVersion = modelPath ? await getModelSpecVersion(modelPath).catch(() => null) : null;

  if (!modelSpecVersion) {
    console.log(ansis.green("\n✓ All upgrades completed successfully!\n"));
  } else if (modelSpecVersion === bundledSpecVersion) {
    console.log(
      ansis.green(`\n✓ All upgrades completed successfully: the model is at spec v${modelSpecVersion}\n`)
    );
  } else {
    console.log(
      ansis.yellow(
        `\n⚠ Upgrades completed, but the model is at spec v${modelSpecVersion}, not the v${bundledSpecVersion} this dr carries\n`
      )
    );
  }
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

    // .dr/ is per-checkout state: make sure the project doesn't commit it.
    try {
      const ignore = await ensureDotDrIgnored(projectRoot);
      if (ignore.added) {
        console.log(ansis.dim(`Added /.dr/ to ${ignore.path} (DR's per-checkout state; commit the .gitignore change)`));
      }
      for (const warning of dotDrIgnoreWarnings(ignore)) console.warn(ansis.yellow(`⚠ Warning: ${warning}`));
    } catch (error) {
      console.warn(ansis.yellow(`⚠ Warning: could not update .gitignore: ${getErrorMessage(error)}. Add /.dr/ to it by hand.`));
    }

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
  projectRoot: string,
  action: UpgradeAction,
  options: UpgradeOptions
): Promise<ChangesetRebaselineResult> {
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
      const result = await upgradeModel(projectRoot, {
        fromVersion: action.fromVersion!,
        toVersion: action.toVersion,
        versionBumpOnly: true,
      });
      console.log(ansis.green(`✓ Model spec version updated to v${action.toVersion}`));
      printChangesetRebaseline(result.changesets);

      if (operationSpan) {
        operationSpan.setAttribute("upgrade.model.result", "version_bumped");
        operationSpan.setAttribute(
          "upgrade.model.changesets_rebaselined",
          result.changesets.rebaselined.length
        );
      }
      return result.changesets;
    }

    console.log(
      ansis.dim(
        action.catalogOnly
          ? `Applying catalog changes to the model (v${action.toVersion})...`
          : `Migrating model from v${action.fromVersion} to v${action.toVersion}...`
      )
    );

    // Apply migrations, save the model and re-baseline staged changesets on it
    const result = await upgradeModel(projectRoot, {
      fromVersion: action.fromVersion!,
      toVersion: action.toVersion,
      validate: !options.force,
      catalogOnly: action.catalogOnly,
    });
    const applied = result.migration?.applied ?? [];

    // Display migration results
    for (const migration of applied) {
      console.log(ansis.green(`  ✓ ${migration.from} → ${migration.to}: ${migration.description}`));
      if (migration.changes?.filesModified) {
        console.log(ansis.dim(`    Files modified: ${migration.changes.filesModified}`));
      }
      printElementTypeChanges(migration.changes?.details?.elementTypeChanges);
      printRetiredAttributeChanges(migration.changes?.details?.retiredAttributeChanges);
      printStagedRetiredAttributeChanges(migration.changes?.details?.stagedRetiredAttributeChanges);
      printRelationshipChanges(migration.changes?.details?.relationshipChanges);
      printStagedRelationshipChanges(migration.changes?.details?.stagedRelationshipChanges);
    }

    console.log(
      ansis.green(
        action.catalogOnly
          ? `✓ Model in line with the v${action.toVersion} catalog`
          : `✓ Model migrated to v${action.toVersion}`
      )
    );
    printChangesetRebaseline(result.changesets);
    printDropRecord(result.dropRecord);

    if (operationSpan) {
      operationSpan.setAttribute("upgrade.model.result", "migrated");
      operationSpan.setAttribute("upgrade.model.relationships_dropped", result.dropRecord?.count ?? 0);
      operationSpan.setAttribute("upgrade.model.migrations_applied", applied.length);
      operationSpan.setAttribute(
        "upgrade.model.changesets_rebaselined",
        result.changesets.rebaselined.length
      );
    }
    return result.changesets;
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
 * Report elements whose type a catalog migration renamed
 */
function printElementTypeChanges(changes: unknown): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }
  const byType = new Map<string, number>();
  for (const c of changes as Array<{ fromType: string; toType: string }>) {
    const key = `${c.fromType} → ${c.toType}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  for (const [key, n] of byType) {
    console.log(ansis.dim(`    Renamed ${n} element(s): ${key}`));
  }
}

/**
 * Report elements a catalog migration removed retired attributes from
 */
function printRetiredAttributeChanges(changes: unknown): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }
  console.log(
    ansis.dim(
      `    Removed retired attributes from ${changes.length} element(s): ${summarizeRetiredAttributeChanges(changes as RetiredAttributeChange[])}`
    )
  );
}

/**
 * Report staged changeset changes a catalog migration removed retired attributes from, per changeset
 */
function printStagedRetiredAttributeChanges(changes: unknown): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }
  const byChangeset = new Map<string, StagedRetiredAttributeChange[]>();
  for (const change of changes as StagedRetiredAttributeChange[]) {
    byChangeset.set(change.changeset, [...(byChangeset.get(change.changeset) ?? []), change]);
  }
  for (const [changeset, staged] of byChangeset) {
    console.log(
      ansis.dim(
        `    changeset ${changeset}, removed retired attributes from ${staged.length} staged change(s): ${summarizeRetiredAttributeChanges(staged, "staged change")}`
      )
    );
  }
}

/**
 * Before the upgrade runs: count the relationships the catalog migration would drop for want of
 * a replacement, by predicate and source and target type
 */
async function printDroppedRelationshipPreview(projectRoot: string, scan: UpgradeScan): Promise<void> {
  const { details, errors } = await previewCatalog(projectRoot, scan);
  for (const error of errors) {
    console.log(ansis.yellow(`⚠ ${error}`));
  }

  const dropped = countDroppedRelationships(details.relationshipChanges);
  const stagedDropped = details.stagedRelationshipChanges.filter((change) => change.action === "dropped").length;
  if (dropped.length === 0 && stagedDropped === 0) {
    return;
  }

  const total = dropped.reduce((n, entry) => n + entry.count, 0);
  if (total > 0) {
    console.log(
      ansis.yellow(`⚠ The migration would drop ${total} relationship(s) that have no replacement in the catalog:`)
    );
    for (const entry of dropped) {
      console.log(ansis.dim(`   ${entry.count} × ${entry.sourceType} --[${entry.predicate}]--> ${entry.targetType}`));
    }
  }
  if (stagedDropped > 0) {
    console.log(
      ansis.yellow(`⚠ The migration would drop ${stagedDropped} staged relationship change(s) that have no replacement in the catalog`)
    );
  }
  const record = await previewDropRecord(projectRoot, scan, details).catch(() => undefined);
  if (record) {
    console.log(
      ansis.dim(
        `   They would be recorded in a staged changeset, '${record.name}' (${record.count} relationship(s)), to review and restore from; it never lands`
      )
    );
    printDropRoutes(record);
  }
  console.log();
}

/** For each dropped type the catalog still links, the relationship types it has between the two element types */
function printDropRoutes(record: UpgradeDropRecord): void {
  const withRoutes = record.byType.filter((entry) => entry.routes.length > 0);
  if (withRoutes.length === 0) {
    return;
  }
  console.log(ansis.dim("   The catalog still has a relationship type between the element types of:"));
  for (const entry of withRoutes) {
    console.log(
      ansis.dim(`     ${entry.sourceType} --[${entry.predicate}]--> ${entry.targetType}: ${formatRoutes(entry.routes)}`)
    );
  }
}

/** After the upgrade: where the dropped relationships were recorded */
function printDropRecord(record: UpgradeDropRecord | undefined): void {
  if (!record) {
    return;
  }
  if (record.error) {
    console.log(
      ansis.yellow(
        `⚠ Could not record the ${record.count} dropped relationship(s) in a changeset: ${record.error}. They are listed above and in the git diff of relationships.yaml.`
      )
    );
    return;
  }
  console.log(
    ansis.yellow(
      `⚠ Recorded ${record.count} dropped relationship(s) in the staged changeset '${record.name}'. It is a record and never lands.`
    )
  );
  console.log(
    ansis.dim(
      `   Review it: documentation-robotics/changesets/${record.id}/changes.yaml lists each one (also in dr changeset list and the viewer's changesets view)`
    )
  );
  printDropRoutes(record);
  console.log(
    ansis.dim(`   Restore what still applies with dr relationship add, then discard it: dr changeset delete ${record.name}`)
  );
}

/**
 * Report relationships a catalog migration rewrote, listing each one it dropped
 */
function printRelationshipChanges(changes: unknown): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }
  const relationshipChanges = changes as RelationshipRewriteChange[];

  console.log(ansis.dim(`    ${summarizeRelationshipChanges(relationshipChanges)}`));
  for (const change of relationshipChanges) {
    if (change.action === "dropped-duplicate" && change.after) {
      console.log(
        ansis.dim(
          `      dropped ${formatRelationship(change.before)} (now the same as ${formatRelationship(change.after)})`
        )
      );
    } else if (change.action === "dropped") {
      console.log(
        ansis.dim(`      dropped ${formatRelationship(change.before)} (no replacement in the catalog)`)
      );
    }
  }
}

/**
 * Report staged changeset changes a catalog migration rewrote, per changeset, listing each one
 * it removed from its changeset
 */
function printStagedRelationshipChanges(changes: unknown): void {
  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }
  const byChangeset = new Map<string, StagedRelationshipRewriteChange[]>();
  for (const change of changes as StagedRelationshipRewriteChange[]) {
    byChangeset.set(change.changeset, [...(byChangeset.get(change.changeset) ?? []), change]);
  }

  for (const [changeset, staged] of byChangeset) {
    console.log(
      ansis.dim(`    ${summarizeRelationshipChanges(staged, `changeset ${changeset}, staged relationships`)}`)
    );
    for (const change of staged) {
      if (change.action === "rewritten") {
        continue;
      }
      const kind = change.stagedAs === "relationship-add" ? "add" : "delete";
      console.log(
        ansis.dim(
          `      dropped staged ${kind} of ${formatRelationship(change.before)} (${stagedDropReason(change)})`
        )
      );
    }
  }
}

function stagedDropReason(change: StagedRelationshipRewriteChange): string {
  if (change.action === "dropped" || !change.after) {
    return "no replacement in the catalog";
  }
  const sameAs = `now the same as ${formatRelationship(change.after)}`;
  switch (change.duplicateOf) {
    case "model":
      return `${sameAs}, already in the model`;
    case "kept":
      return `${sameAs}, which also stands for a relationship the changeset keeps`;
    default:
      return change.stagedAs === "relationship-add"
        ? `${sameAs}, which the changeset already adds`
        : `${sameAs}, which the changeset already deletes`;
  }
}

function formatRelationship(rel: { source: string; predicate: string; target: string }): string {
  return `${rel.source} --[${rel.predicate}]--> ${rel.target}`;
}

const changesetNames = (refs: ChangesetRef[]) => refs.map((ref) => ref.name).join(", ");
const stagedChangesets = (n: number) => `${n} staged changeset${n === 1 ? "" : "s"}`;

/**
 * Report the staged changesets re-baselined on the upgraded model. Those left on their old base
 * snapshot because they had drifted before the upgrade go in the final summary
 * (printDriftedChangesets).
 */
function printChangesetRebaseline(result: ChangesetRebaselineResult): void {
  if (result.rebaselined.length > 0) {
    console.log(
      ansis.green(
        `✓ Re-baselined ${stagedChangesets(result.rebaselined.length)} on the upgraded model: ${changesetNames(result.rebaselined)}`
      )
    );
  }
  for (const error of result.errors) {
    console.log(ansis.yellow(`⚠ ${error}`));
  }
}

/** The staged changesets that had drifted from the model before the upgrade, by name */
function printDriftedChangesets(drifted: ChangesetRef[]): void {
  if (drifted.length === 0) {
    return;
  }
  console.log(
    ansis.yellow(
      `\n⚠ ${stagedChangesets(drifted.length)} had drifted from the model before the upgrade, so ${drifted.length === 1 ? "it lands" : "they land"} with a drift warning that names what overlaps: ${changesetNames(drifted)}`
    )
  );
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
