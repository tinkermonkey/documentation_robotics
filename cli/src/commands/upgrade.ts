/**
 * Upgrade Command - Manages spec reference and model upgrades
 *
 * Scans the filesystem to determine what needs upgrading:
 * 1. .dr/ (spec reference) - if CLI has newer bundled version
 * 2. Model data - if model spec version doesn't match spec reference
 * 3. Installed integrations (.claude/, .github/), layer reports and the ignore files
 *
 * Shows the upgrade plan, with every file it would touch outside the model listed by group, and
 * prompts for confirmation before proceeding. `--model-only` leaves everything outside the model
 * and the spec reference alone. The dry run rehearses the model step on a copy, so it names the
 * model files that would change and what the upgraded model would still need.
 */

import ansis from "ansis";
import { confirm, isCancel, multiselect, select } from "@clack/prompts";
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
  type ModelUpgradeOptions,
  type ModelUpgradeResult,
} from "../core/model-upgrade.js";
import { countFiles, diffFiles, filesOutside, filesUnder, hashFiles, rehearseModelUpgrade, type FilesChanged } from "../core/upgrade-rehearsal.js";
import {
  outsideModelLines,
  scanOutsideModel,
  touchesOutsideModel,
  type IntegrationPlan,
  type OutsideModel,
} from "../core/upgrade-outside-model.js";
import type { UpgradeFills } from "../core/upgrade-fills.js";
import { commitHookNotes } from "../core/commit-hooks.js";
import { formatRoutes, type UpgradeDropRecord } from "../core/upgrade-drop-record.js";
import {
  summarizeRelationshipChanges,
  type RelationshipRewriteChange,
  type StagedRelationshipRewriteChange,
} from "../core/relationship-migration.js";
import { installSpecReference } from "../utils/spec-installer.js";
import {
  ensureDotDrIgnored,
  dotDrDecisionLines,
  dotDrIgnoreNotes,
  dotDrIgnoreWarnings,
  DOT_DR_TRACKED_CHOICES,
  type DotDrTrackedChoice,
} from "../core/dot-dr-ignore.js";
import { PRETTIER_IGNORE_BY_HAND, ensurePrettierIgnoresDrFiles, prettierIgnoreNote } from "../core/prettier-ignore.js";
import {
  summarizeRetiredAttributeChanges,
  type RetiredAttributeChange,
  type StagedRetiredAttributeChange,
} from "../core/attribute-migration.js";
import { ClaudeIntegrationManager } from "../integrations/claude-manager.js";
import { CopilotIntegrationManager } from "../integrations/copilot-manager.js";
import { getErrorMessage } from "../utils/errors.js";
import { relayoutModelFiles } from "../core/model-relayout.js";
import { startSpan, endSpan } from "../telemetry/index.js";
import { hasLayerReports, regenerateLayerReports } from "./reports.js";
import { errorsByElement } from "../core/upgrade-validation.js";

// Build-time constant for telemetry feature detection
declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface UpgradeOptions {
  yes?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /**
   * Upgrade the model (and the per-checkout spec reference it is validated against) and nothing
   * else: no integration files, no reports, no ignore-file lines.
   */
  modelOnly?: boolean;
  /** What to do about files git tracks under .dr/; without it the upgrade asks, or leaves them */
  dotDr?: DotDrTrackedChoice;
  /**
   * Remove leftovers of older integration layouts without asking: `true` for every one listed, or
   * the paths to remove (as the plan lists them). A path that isn't a listed leftover is refused.
   */
  removeStale?: boolean | string[];
  /**
   * List every file, element and derived value, however many. Without it long lists show their
   * first entries with the true total and say how to see the rest; nothing is ever touched that
   * the full list would not name.
   */
  full?: boolean;
  /**
   * Also lay out the model's element files an earlier dr wrote (or prettier laid out) as this dr
   * writes them, data unchanged, as a step of its own (#1439). Without it the plan only counts them.
   */
  relayout?: boolean;
}

/** -1, 0 or 1 as version a is older than, the same as, or newer than b (numeric dotted parts) */
function compareVersions(a: string, b: string): number {
  const as = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const bs = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The managers of the per-project integrations, by name */
const INTEGRATIONS = [
  { name: "claude" as const, label: "Claude Code", create: () => new ClaudeIntegrationManager() },
  { name: "copilot" as const, label: "GitHub Copilot", create: () => new CopilotIntegrationManager() },
];

/**
 * Build integration upgrade actions, collect up-to-date status lines, and plan what each
 * installed integration's upgrade would change (plus the stale DR-named entries it would leave)
 */
async function buildIntegrationActions(
  cliVersion: string,
  force: boolean
): Promise<{ actions: UpgradeAction[]; upToDate: string[]; plans: IntegrationPlan[] }> {
  const actions: UpgradeAction[] = [];
  const upToDate: string[] = [];
  const plans: IntegrationPlan[] = [];

  for (const { name, label, create } of INTEGRATIONS) {
    const manager = create();
    if (!(await manager.isInstalled())) continue;

    const installedVersion = (await manager.loadVersionFile())?.version;
    // A newer dr installed it: replacing its files with this dr's older ones is a downgrade, so
    // it happens only with --force, and says so
    const newer = Boolean(installedVersion && compareVersions(installedVersion, cliVersion) > 0);
    const needsUpgrade = Boolean(installedVersion && installedVersion !== cliVersion && !newer);
    const upgrade = force || needsUpgrade;

    if (upgrade) {
      actions.push({
        type: "integration",
        description: newer
          ? `Downgrade ${label} integration to this dr's files (forced; a newer dr installed it)`
          : force
            ? `Reinstall ${label} integration (forced)`
            : `Upgrade ${label} integration`,
        fromVersion: installedVersion,
        toVersion: cliVersion,
        integrationName: name,
      });
    } else if (newer) {
      upToDate.push(
        `  ${ansis.yellow("⚠")} ${label} integration was installed by a newer dr (v${installedVersion}); this dr (v${cliVersion}) leaves it alone. dr upgrade --force would replace it with this dr's older files.`
      );
    } else if (installedVersion) {
      upToDate.push(`  ${ansis.green("✓")} ${label} integration up to date (v${installedVersion})`);
    }

    try {
      // dr upgrade runs the integration upgrade with force, which replaces files edited in the project
      const plan = await manager.planUpgrade({ force: true });
      if (plan) plans.push({ ...plan, name, label, toVersion: cliVersion, upgrade });
    } catch (error) {
      console.log(ansis.yellow(`⚠ Could not plan the ${label} integration upgrade: ${getErrorMessage(error)}`));
    }
  }

  return { actions, upToDate, plans };
}

/**
 * Check if layer reports exist; if not, offer to generate them.
 * Defaults to generating (yes) — including in non-interactive/programmatic mode.
 * The plan has already listed them (printOutsideModelPlan); a dry run never gets here.
 */
async function checkAndGenerateReports(
  projectRoot: string,
  options: UpgradeOptions
): Promise<void> {
  if (await hasLayerReports(projectRoot)) {
    return;
  }

  console.log(ansis.yellow("\n⚠ No layer reports found"));

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

/** What the run found outside the model before it wrote anything */
interface OutsideContext {
  outside: OutsideModel;
  integrations: IntegrationPlan[];
  /** Status lines for integrations that need no upgrade */
  upToDate: string[];
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
      scan = await scanUpgrades(projectRoot, { force: options.force, targetBundledSpec: true, relayout: options.relayout });
    } catch (error) {
      // The spec reference or model manifest exists but is corrupted or unreadable
      if (error instanceof UpgradeScanError) {
        console.error(ansis.red(`Error: ${error.message}`));
      }
      throw error;
    }
    const actions: UpgradeAction[] = [...scan.actions];
    const currentSpecVersion = scan.installedSpecVersion;

    // ============================================================================
    // STEP 3: Check integration versions and everything else outside the model
    // ============================================================================

    const integration = await buildIntegrationActions(cliVersion, options.force ?? false);
    if (!options.modelOnly) {
      actions.push(...integration.actions);
    }
    const context: OutsideContext = {
      outside: await scanOutsideModel(projectRoot, scan, { dotDr: options.dotDr }),
      integrations: integration.plans,
      upToDate: integration.upToDate,
    };
    for (const error of context.outside.errors) {
      console.log(ansis.yellow(`⚠ ${error}`));
    }

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
        await handleUpgrade(projectRoot, actions, options, context, commandSpan);
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
    if (scan.relayout && !options.relayout) {
      console.log(
        ansis.dim(
          `ℹ ${scan.relayout.files.length} model file(s) are in an earlier dr's layout (long strings folded at 80 ` +
            "columns): the next change to one lays it out anew, so its diff shows every line. dr upgrade --relayout " +
            "lays them all out now, data unchanged; commit that on its own.\n"
        )
      );
    }

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
      // Still due outside the model: ignore-file lines, reports, stale integration files
      printOutsideModelPlan(context, options);
      if (!options.dryRun && !options.modelOnly) {
        await applyOutsideModel(projectRoot, options, context);
        await printCommitHookNote(projectRoot, options);
      } else if (options.dryRun) {
        printScannedHookNotes(context, options);
      }
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
      commandSpan.setAttribute("upgrade.model_only", options.modelOnly || false);
    }

    await handleUpgrade(projectRoot, actions, options, context, commandSpan, scan);

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

/** upgradeModel's options for a model action */
function modelUpgradeOptions(action: UpgradeAction, options: UpgradeOptions): ModelUpgradeOptions {
  return {
    fromVersion: action.fromVersion!,
    toVersion: action.toVersion,
    ...(action.versionBumpOnly ? { versionBumpOnly: true } : {}),
    ...(action.catalogOnly ? { catalogOnly: true } : {}),
    validate: !options.force,
  };
}

/**
 * Handle the upgrade process
 */
async function handleUpgrade(
  projectRoot: string,
  actions: UpgradeAction[],
  options: UpgradeOptions,
  context: OutsideContext,
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

      const icon =
        action.type === "spec"
          ? "📦"
          : action.type === "integration"
            ? "🔌"
            : action.type === "relayout"
              ? "📐"
              : "🔄";
      console.log(ansis.yellow(`${icon} ${action.description}`));
      console.log(ansis.dim(`   Version: ${versionChange}`));

      // --full lists every file the relayout step lays out, not only the first
      const details =
        action.type === "relayout" && options.full && scan?.relayout
          ? [action.details?.[0] ?? "", ...scan.relayout.files]
          : action.details;
      if (details && details.length > 0) {
        for (const detail of details) {
          console.log(ansis.dim(`   • ${detail}`));
        }
      }
      console.log();
    }
  }

  // Every file outside the model the run would touch, before anything is written
  printOutsideModelPlan(context, options);

  // Before anything is written, say which relationships the migration would drop, and rehearse
  // the model step on a copy: the files it would write and what the model would still need
  const modelAction = actions.find((a) => a.type === "model");
  if (scan && modelAction && (options.dryRun || !options.yes)) {
    await printDroppedRelationshipPreview(projectRoot, scan);
    await printRehearsal(projectRoot, modelAction, options);
  }

  // Display integration status for up-to-date integrations
  if (context.upToDate.length > 0 && !options.modelOnly) {
    console.log(ansis.bold("Integration Status:"));
    context.upToDate.forEach((msg) => console.log(msg));
    console.log();
  }

  // Handle dry-run mode
  if (options.dryRun) {
    printScannedHookNotes(context, options);
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
  let modelResult: ModelUpgradeResult | undefined;
  for (const action of actions) {
    if (action.type === "spec") {
      await executeSpecUpgrade(projectRoot, action);
    } else if (action.type === "model") {
      // Hash the project's DR folder around the step, to name every file it wrote
      const before = await hashFiles(projectRoot, DR_FOLDER);
      modelResult = await executeModelMigration(projectRoot, action, options);
      printFilesWritten(diffFiles(before, await hashFiles(projectRoot, DR_FOLDER)), options);
    } else if (action.type === "relayout") {
      const relayout = await relayoutModelFiles(projectRoot);
      console.log(ansis.green(`✓ Laid out ${relayout.files.length} model file(s) as this dr writes them (data unchanged)`));
      for (const { file, reason } of relayout.skipped) console.log(ansis.yellow(`  ⚠ Left ${file} alone: ${reason}`));
      console.log();
    } else if (action.type === "integration") {
      await executeIntegrationUpdate(action.description, async () => {
        const manager = INTEGRATIONS.find((integration) => integration.name === action.integrationName)!.create();
        await manager.upgrade({ force: true }); // force=true skips internal prompts (user confirmed above)
      });
    }
  }

  if (!options.modelOnly) {
    // The scan is passed only when the project has a readable model
    await applyOutsideModel(projectRoot, options, context, scan !== undefined);
  }

  if (modelResult) {
    printValidationChecklist(modelResult, options);
    printFills(modelResult.fills, options);
    printStagedEarlier(modelResult);
  }

  // Drifted changesets lead the summary, where they can't be missed at the end of a long log
  printDriftedChangesets(modelResult?.changesets.drifted ?? []);
  await printUpgradeOutcome(projectRoot);
  if (!options.modelOnly) {
    await printCommitHookNote(projectRoot, options);
  }
}

/** The project's DR folder: the model, its changesets and its reports */
const DR_FOLDER = "documentation-robotics";
const MODEL_PREFIX = `${DR_FOLDER}/model/`;

/**
 * How many files a group lists by default in the plan and the summary. The heading always gives
 * the true count, and --full lists every file.
 */
const FILES_SHOWN = 30;

/** How to see the rest of a shortened list: before the run, the dry run with --full */
const FULL_DRY_RUN = "dr upgrade --dry-run --full lists them all";

/**
 * @param rest - how the reader gets the entries a shortened list leaves out
 */
function printFileList(files: FilesChanged, options: UpgradeOptions, rest: string): void {
  const entries = [
    ...files.modified.map((file) => `write   ${file}`),
    ...files.added.map((file) => `add     ${file}`),
    ...files.removed.map((file) => `remove  ${file}`),
  ];
  const shown = options.full ? entries : entries.slice(0, FILES_SHOWN);
  for (const entry of shown) {
    console.log(ansis.dim(`   ${entry}`));
  }
  if (entries.length > shown.length) {
    console.log(ansis.dim(`   ...and ${entries.length - shown.length} more of ${entries.length} file(s); ${rest}`));
  }
}

/** After the model step: every file under documentation-robotics/ it wrote, model files first */
function printFilesWritten(written: FilesChanged, options: UpgradeOptions): void {
  const model = filesUnder(written, MODEL_PREFIX);
  const other = filesOutside(written, MODEL_PREFIX);
  // After the run git has the whole list
  const rest = `git status --short ${DR_FOLDER} lists them all`;
  console.log(ansis.dim(`Model files written (${countFiles(model)}):`));
  printFileList(model, options, rest);
  if (countFiles(other) > 0) {
    console.log(ansis.dim(`Changeset files written (${countFiles(other)}):`));
    printFileList(other, options, rest);
  }
}

/**
 * What the run touches outside the model, by group, before it writes: or, with --model-only,
 * what it leaves alone. Says nothing when there is nothing.
 */
function printOutsideModelPlan(context: OutsideContext, options: UpgradeOptions): void {
  const { outside, integrations } = context;
  if (!touchesOutsideModel(outside, integrations)) {
    return;
  }

  if (options.modelOnly) {
    const lines = outsideModelLines(outside, integrations, { skipped: true, full: options.full });
    if (outside.specReference) {
      console.log(ansis.dim(`Spec reference: ${outside.specReference.description}`));
    }
    if (lines.length > 0) {
      console.log(ansis.bold("Left alone (--model-only); dr upgrade without it would change:"));
      lines.forEach((line) => console.log(ansis.dim(line)));
    }
    console.log();
    return;
  }

  console.log(ansis.bold(`Outside the model (${MODEL_PREFIX}), this upgrade also changes:`));
  outsideModelLines(outside, integrations, { full: options.full }).forEach((line) => console.log(ansis.dim(line)));
  if (outside.gitignore?.decision) {
    dotDrDecisionLines(outside.gitignore.decision, { full: options.full }).forEach((line) =>
      console.log(ansis.yellow(`  ${line}`))
    );
  }
  console.log(ansis.dim("  --model-only leaves all of these alone except the spec reference.\n"));
}

/**
 * The steps outside the model, after the actions ran: the ignore files, the stale integration
 * files (an offer, never a silent removal) and the layer reports.
 */
async function applyOutsideModel(
  projectRoot: string,
  options: UpgradeOptions,
  context: OutsideContext,
  hasModel: boolean = true
): Promise<void> {
  await keepDotDrOutOfGit(projectRoot, options);
  await keepPrettierOffDrFiles(projectRoot);
  await offerStaleRemoval(options, context.integrations);
  // No readable model: there is nothing to report on
  if (hasModel) {
    await checkAndGenerateReports(projectRoot, options);
  }
}

/**
 * .dr/ is per-checkout state: make sure the project doesn't commit it. When git already tracks
 * files there, an ignore rule alone leaves a half state (#1185), so that is the user's decision:
 * --dot-dr, a prompt in a terminal, or nothing changes and the choices are printed.
 */
async function keepDotDrOutOfGit(projectRoot: string, options: UpgradeOptions): Promise<void> {
  try {
    let ignore = await ensureDotDrIgnored(projectRoot, { tracked: options.dotDr });
    if (ignore.decision) {
      const lines = dotDrDecisionLines(ignore.decision, { full: options.full });
      const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
      if (isInteractive && !options.yes) {
        console.log(ansis.yellow(`\n⚠ ${lines[0]}`));
        console.log(ansis.dim(lines[1]));
        const choice = await select({
          message: "What should happen to the files git tracks under .dr/?",
          options: ignore.decision.options.map((option) => ({
            value: option.choice,
            label: option.choice,
            hint: option.effect,
          })),
        });
        if (isCancel(choice)) {
          console.log(ansis.dim("Left .gitignore and the tracked files under .dr/ as they are"));
          return;
        }
        ignore = await ensureDotDrIgnored(projectRoot, { tracked: choice as DotDrTrackedChoice });
      } else {
        console.log(ansis.yellow(`\n⚠ ${lines[0]}`));
        lines.slice(1).forEach((line) => console.log(ansis.dim(line)));
        console.log(
          ansis.dim(`  Nothing was changed. Choose with: dr upgrade --dot-dr <${DOT_DR_TRACKED_CHOICES.join("|")}>`)
        );
        return;
      }
    }
    for (const note of dotDrIgnoreNotes(ignore)) console.log(ansis.dim(note));
    for (const warning of dotDrIgnoreWarnings(ignore)) console.warn(ansis.yellow(`⚠ Warning: ${warning}`));
  } catch (error) {
    console.warn(
      ansis.yellow(
        `⚠ Warning: could not update .gitignore: ${getErrorMessage(error)}. Before adding /.dr/ to it by hand, run git ls-files .dr: if git tracks files there, decide first whether to untrack them (git rm -r --cached .dr), or the rule leaves them tracked and unstageable.`
      )
    );
  }
}

/**
 * dr writes the files in documentation-robotics/ in its own layout: when the project uses
 * prettier, list the folder in .prettierignore so prettier doesn't reformat them (#1155, #1246).
 */
async function keepPrettierOffDrFiles(projectRoot: string): Promise<void> {
  try {
    const note = prettierIgnoreNote(await ensurePrettierIgnoresDrFiles(projectRoot), projectRoot);
    if (note) console.log(ansis.dim(note));
  } catch (error) {
    console.warn(
      ansis.yellow(`⚠ Warning: could not update .prettierignore: ${getErrorMessage(error)}. Add ${PRETTIER_IGNORE_BY_HAND} to it by hand.`)
    );
  }
}

/** A stale entry's path without a trailing slash, for comparing what the user typed */
const withoutSlash = (entry: string) => entry.replace(/\/+$/, "");

/**
 * Leftovers of older integration layouts (see BaseIntegrationManager.findStaleEntries), each the
 * person's to keep or remove:
 * - an entry whose contents are a version dr shipped is a leftover: --remove-stale removes all of
 *   them, --remove-stale <path>... the ones named, a terminal offers a pick-list;
 * - an entry with a name dr once used but other contents (edited, or the project's own) is listed
 *   apart and removed only when its path is named, or picked in a terminal.
 * Otherwise they are listed with how to remove them.
 */
async function offerStaleRemoval(options: UpgradeOptions, integrations: IntegrationPlan[]): Promise<void> {
  const listed = integrations.flatMap((plan) => [...plan.stale, ...plan.changed]);
  const asked = Array.isArray(options.removeStale) ? options.removeStale.map(withoutSlash) : [];
  // A path that is not listed is never removed: say so, and remove nothing in its place
  const unknown = asked.filter((entry) => !listed.some((stale) => withoutSlash(stale) === entry));
  for (const entry of unknown) {
    console.warn(
      ansis.yellow(`⚠ --remove-stale ${entry}: not a leftover of an earlier dr's integration, so it was left alone`)
    );
  }

  for (const plan of integrations) {
    if (plan.stale.length === 0 && plan.changed.length === 0) continue;
    const manager = INTEGRATIONS.find((integration) => integration.name === plan.name)!.create();

    if (plan.stale.length > 0) {
      const one = plan.stale.length === 1;
      console.log(
        ansis.yellow(
          `\n⚠ ${plan.stale.length} entr${one ? "y" : "ies"} in ${plan.folder}/ ${one ? "is" : "are"} left over from an earlier dr's ${plan.label} integration: dr shipped ${one ? "it" : "them"} with exactly these contents, this dr's integration has no such entry, and no upgrade updates or removes ${one ? "it" : "them"}:`
        )
      );
      plan.stale.forEach((entry) => console.log(ansis.dim(`   ${entry}`)));
    }
    if (plan.changed.length > 0) {
      const one = plan.changed.length === 1;
      console.log(
        ansis.yellow(
          `\n⚠ ${plan.changed.length} entr${one ? "y" : "ies"} in ${plan.folder}/ ${one ? "has" : "have"} a name an earlier dr used, but ${one ? "its" : "their"} contents are not what dr shipped (edited since, or the project's own file). ${one ? "It is" : "They are"} kept unless you name ${one ? "it" : "them"}:`
        )
      );
      plan.changed.forEach((entry) => console.log(ansis.dim(`   ${entry}`)));
    }

    let chosen: string[] = [];
    let named: string[] = [];
    if (options.removeStale === true) {
      // "All" means the leftovers dr shipped, never a changed file
      chosen = plan.stale;
    } else if (Array.isArray(options.removeStale)) {
      chosen = [...plan.stale, ...plan.changed].filter((entry) => asked.includes(withoutSlash(entry)));
      named = chosen;
    } else if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
      const picked = await multiselect({
        message: "Remove which? (space to pick, enter to confirm; none picked keeps them all)",
        options: [
          ...plan.stale.map((entry) => ({ value: entry, label: entry, hint: "as dr shipped it" })),
          ...plan.changed.map((entry) => ({ value: entry, label: entry, hint: "contents differ from what dr shipped" })),
        ],
        required: false,
      });
      chosen = isCancel(picked) ? [] : (picked as string[]);
      named = chosen;
    }

    const all = [...plan.stale, ...plan.changed];
    const kept = all.filter((entry) => !chosen.includes(entry));
    if (chosen.length > 0) {
      try {
        const removed = await manager.removeStaleEntries(chosen, { named });
        console.log(
          ansis.green(`✓ Removed ${removed.length} of them from ${plan.folder}/: ${removed.join(", ")}`)
        );
      } catch (error) {
        console.warn(ansis.yellow(`⚠ Warning: could not remove the stale entries: ${getErrorMessage(error)}`));
      }
    }
    if (kept.length > 0) {
      const keptStale = kept.filter((entry) => plan.stale.includes(entry));
      console.log(
        ansis.dim(
          `   Kept ${kept.length}. Remove ${kept.length === 1 ? "it" : "any of them"} with: dr upgrade --remove-stale ${kept.length === 1 ? kept[0] : "<path>..."}` +
            (keptStale.length > 0 ? " (--remove-stale alone removes only the ones dr shipped as they are)" : "")
        )
      );
    }
  }
}

/** In a dry run: the commit hook notes the scan found (the run itself prints them at its end) */
function printScannedHookNotes(context: OutsideContext, options: UpgradeOptions): void {
  if (options.modelOnly) return;
  for (const note of context.outside.commitHooks ?? []) {
    console.log(ansis.yellow(`⚠ ${note}\n`));
  }
}

/** What the project's commit hooks would do to a commit of the files dr writes; dr changes nothing */
async function printCommitHookNote(projectRoot: string, options: UpgradeOptions): Promise<void> {
  for (const note of await commitHookNotes(projectRoot, { full: options.full })) {
    console.log(ansis.yellow(`⚠ ${note}\n`));
  }
}

/**
 * Run the model step on a copy of the model and say what it did there: the model files it would
 * write, the changesets it would touch, and how the upgraded model would validate.
 */
async function printRehearsal(projectRoot: string, action: UpgradeAction, options: UpgradeOptions): Promise<void> {
  let rehearsal;
  try {
    rehearsal = await rehearseModelUpgrade(projectRoot, modelUpgradeOptions(action, options));
  } catch (error) {
    console.log(ansis.yellow(`⚠ Could not rehearse the model upgrade on a copy: ${getErrorMessage(error)}\n`));
    return;
  }

  const { result, modelFiles, otherFiles } = rehearsal;
  console.log(ansis.bold("Rehearsed on a copy of the model:"));
  console.log(ansis.dim(`Model files it would write (${countFiles(modelFiles)}):`));
  printFileList(modelFiles, options, FULL_DRY_RUN);
  if (countFiles(otherFiles) > 0) {
    console.log(ansis.dim(`Changeset files it would write (${countFiles(otherFiles)}):`));
    // A new changeset's folder is shown by its name: its id is made when the run creates it
    printFileList(otherFiles, options, FULL_DRY_RUN);
    if (result.changesets.rebaselined.length > 0) {
      console.log(
        ansis.dim(
          `   re-baseline ${stagedChangesets(result.changesets.rebaselined.length)} on the upgraded model: ${changesetNames(result.changesets.rebaselined)}`
        )
      );
    }
    if (result.dropRecord) {
      console.log(ansis.dim(`   add '${result.dropRecord.name}', the record of ${result.dropRecord.count} dropped relationship(s)`));
    }
    if (result.fills) {
      console.log(
        ansis.dim(`   add '${result.fills.name}', ${result.fills.count} derived value(s) on ${result.fills.elements} element(s), for review`)
      );
    }
  }
  printValidationChecklist(result, options, true);
  printFills(result.fills, options, true);
  printStagedEarlier(result);
  console.log();
}

/**
 * How many elements the validation checklist lists by default. Its heading counts every error and
 * every element; --full (or dr validate, after the run) lists them all.
 */
const CHECKLIST_ELEMENTS_SHOWN = 50;

/**
 * The upgraded base model's validation errors per element: the required attributes each element
 * leaves empty, then its other errors. Attributes with a derived value staged for review are
 * marked; the rest are what's left to fill in by hand.
 *
 * @param would - the result is a rehearsal's: say what would be, not what is
 */
function printValidationChecklist(result: ModelUpgradeResult, options: UpgradeOptions, would: boolean = false): void {
  if (result.validationError !== undefined) {
    console.warn(ansis.yellow(`\n⚠ Could not validate the upgraded model: ${result.validationError}`));
    return;
  }
  const errors = result.validationErrors ?? [];
  if (errors.length === 0) {
    console.log(
      ansis.green(would ? "✓ The upgraded model would validate without errors" : "\n✓ The upgraded model validates without errors")
    );
    return;
  }

  const derived = new Set(
    [
      ...(result.fills?.error ? [] : result.fills?.fills ?? []),
      ...(result.stagedEarlier ?? []).flatMap((entry) => entry.fills),
    ].map((fill) => `${fill.elementId} ${fill.attribute}`)
  );
  const groups = errorsByElement(errors);
  console.log(
    ansis.yellow(
      `${would ? "" : "\n"}⚠ The upgraded model ${would ? "would have" : "has"} ${errors.length} validation error(s) on ${groups.length} element(s):`
    )
  );
  const shownGroups = options.full ? groups : groups.slice(0, CHECKLIST_ELEMENTS_SHOWN);
  for (const group of shownGroups) {
    console.log(`  ${group.elementId ?? `(${group.layer} layer)`}`);
    const staged = group.missingAttributes.filter((attribute) => derived.has(`${group.elementId} ${attribute}`));
    const empty = group.missingAttributes.filter((attribute) => !derived.has(`${group.elementId} ${attribute}`));
    if (empty.length > 0) {
      console.log(ansis.dim(`    required, left empty: ${empty.join(", ")}`));
    }
    if (staged.length > 0) {
      console.log(ansis.dim(`    required, value ${would ? "would be " : ""}staged for review: ${staged.join(", ")}`));
    }
    for (const message of group.messages) {
      console.log(ansis.dim(`    ${message}`));
    }
  }
  if (groups.length > shownGroups.length) {
    console.log(
      ansis.dim(
        `  ...and ${groups.length - shownGroups.length} more of ${groups.length} element(s); ${would ? FULL_DRY_RUN : "dr validate lists them all"}`
      )
    );
  }
}

/** Values an earlier run staged that this one leaves where they are, not staged a second time */
function printStagedEarlier(result: ModelUpgradeResult): void {
  for (const entry of result.stagedEarlier ?? []) {
    console.log(
      ansis.dim(
        `${entry.fills.length} derived value(s) are already staged in the changeset '${entry.changeset}' from an earlier upgrade, waiting for review; they are not staged again.`
      )
    );
  }
}

/**
 * How many derived values are listed by default. The heading counts them all; --full lists them
 * all, and after the run the changeset holds every one.
 */
const FILLS_SHOWN = 20;

/** The values derived for required attributes, and the changeset they are staged in for review */
function printFills(fills: UpgradeFills | undefined, options: UpgradeOptions, would: boolean = false): void {
  if (!fills) {
    return;
  }
  if (fills.error) {
    console.log(
      ansis.yellow(`⚠ Derived ${fills.count} value(s) for required attributes but could not stage them in a changeset: ${fills.error}`)
    );
    return;
  }
  console.log(
    ansis.yellow(
      would
        ? `⚠ ${fills.count} value(s) for required attributes on ${fills.elements} element(s) would be derived and staged in the changeset '${fills.name}' for review:`
        : `\n⚠ Staged ${fills.count} derived value(s) for required attributes on ${fills.elements} element(s) in the changeset '${fills.name}'. Nothing was written to the base model.`
    )
  );
  const shownFills = options.full ? fills.fills : fills.fills.slice(0, FILLS_SHOWN);
  for (const fill of shownFills) {
    console.log(ansis.dim(`   ${fill.elementId}: ${fill.attribute} = ${JSON.stringify(fill.value)}`));
  }
  if (fills.fills.length > shownFills.length) {
    console.log(
      ansis.dim(
        `   ...and ${fills.fills.length - shownFills.length} more of ${fills.fills.length}; ${would ? FULL_DRY_RUN : `the changeset '${fills.name}' holds them all`}`
      )
    );
  }
  if (!would) {
    console.log(
      ansis.dim(
        `   Review it in the viewer's changesets view, or with dr changeset activate ${fills.name} then dr changeset diff. Fix or unstage what is wrong, then land it: dr changeset commit ${fills.name}`
      )
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
): Promise<ModelUpgradeResult> {
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
      const result = await upgradeModel(projectRoot, modelUpgradeOptions(action, options));
      console.log(ansis.green(`✓ Model spec version updated to v${action.toVersion}`));
      printChangesetRebaseline(result.changesets);

      if (operationSpan) {
        operationSpan.setAttribute("upgrade.model.result", "version_bumped");
        operationSpan.setAttribute(
          "upgrade.model.changesets_rebaselined",
          result.changesets.rebaselined.length
        );
      }
      return result;
    }

    console.log(
      ansis.dim(
        action.catalogOnly
          ? `Applying catalog changes to the model (v${action.toVersion})...`
          : `Migrating model from v${action.fromVersion} to v${action.toVersion}...`
      )
    );

    // Apply migrations, save the model and re-baseline staged changesets on it
    const result = await upgradeModel(projectRoot, modelUpgradeOptions(action, options));
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
      operationSpan.setAttribute("upgrade.model.fills_staged", result.fills?.count ?? 0);
    }
    return result;
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
      `\n⚠ ${stagedChangesets(drifted.length)} had drifted from the model before the upgrade: a commit lists what the base overlaps and asks (with no terminal it needs --force when something does): ${changesetNames(drifted)}`
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
