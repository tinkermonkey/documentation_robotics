/**
 * project_init, project_upgrade — onboard a project and move its model to a new spec version
 * from the conversation.
 *
 * project_init mirrors `dr init` without the prompts: the name and the rest are arguments. It
 * installs no per-project integration files (the Claude Code plugin replaces
 * `dr claude install`).
 *
 * project_upgrade mirrors `dr upgrade` for the spec reference and the model. It previews by
 * default: the version path, the element type renames and relationship rewrites the generated
 * migration table makes, and anything it can't migrate. `apply: true` runs the migration, then
 * reloads and validates the model. Installed integrations are left alone; `dr upgrade` updates
 * them.
 *
 * Both write outside a changeset, so changeset-only mode refuses them (mcp/changeset-only.ts),
 * and DrBot is not given them (coding-agents/drbot-mcp.ts).
 */

import { z } from "zod";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { initProject, hasModel } from "../../core/project-init.js";
import {
  previewCatalogMigration,
  scanUpgrades,
  type UpgradeAction,
  type UpgradeScan,
  type UpgradeStep,
} from "../../core/upgrade-plan.js";
import type { CatalogMigrationResult } from "../../core/catalog-migration.js";
import type { ElementTypeRenameChange } from "../../core/element-type-migration.js";
import {
  summarizeRelationshipChanges,
  type RelationshipRewriteChange,
  type StagedRelationshipRewriteChange,
} from "../../core/relationship-migration.js";
import { upgradeModel, type ChangesetRebaselineResult } from "../../core/model-upgrade.js";
import type { Model } from "../../core/model.js";
import { installSpecReference } from "../../utils/spec-installer.js";
import { findProjectRoot } from "../../utils/project-paths.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { Validator } from "../../validators/validator.js";
import { hasLayerReports, regenerateLayerReports } from "../../commands/reports.js";
import { currentProjectRoot, whenProjectRootSettled } from "../project-root.js";
import { clearModelCache, jsonResult, reloadModel, runTool, type McpToolDefinition } from "./shared.js";

/** The MCP server's stdout carries the protocol: progress lines go to stderr. */
const logToStderr = (message: string): void => {
  process.stderr.write(`[mcp] ${message}\n`);
};

/** At most this many relationship rewrites or element renames are listed; the rest are counted. */
const MAX_LISTED = 200;
/** At most this many validation errors are listed after an upgrade. */
const MAX_VALIDATION_ERRORS = 20;

// ---------------------------------------------------------------------------
// project_init
// ---------------------------------------------------------------------------

const initInputSchema = {
  name: z.string().trim().min(1).describe("The model's name, usually the project's."),
  description: z.string().optional().describe("What the model describes."),
  author: z.string().optional().describe("The model's author or owning team."),
  rootPath: z
    .string()
    .optional()
    .describe(
      "Absolute path of the folder to create the model in (documentation-robotics/ goes inside it). Defaults to the project the client has open (its MCP roots)."
    ),
};

export type ProjectInitArgs = z.infer<z.ZodObject<typeof initInputSchema>>;

/**
 * The folder to create the model in: rootPath, else the folder the client has open (or the one
 * DR_MCP_ROOT_PATH names). Never the server's own working directory, which for a server
 * registered once per user is wherever the client started it.
 */
async function initRoot(rootPath: string | undefined): Promise<string> {
  let root: string;
  if (rootPath !== undefined) {
    if (!isAbsolute(rootPath)) {
      throw new CLIError(`rootPath must be an absolute path: ${rootPath}`, ErrorCategory.USER, [
        "Pass the absolute path of the folder to create the model in",
      ]);
    }
    root = resolve(rootPath);
  } else {
    await whenProjectRootSettled();
    const current = currentProjectRoot();
    if (current.source === "cwd") {
      throw new CLIError(
        "The client has not said which folder is open (no MCP roots), so there is no folder to create the model in.",
        ErrorCategory.USER,
        ["Pass rootPath: the absolute path of the project folder"]
      );
    }
    root = current.root;
  }

  let isDirectory = false;
  try {
    isDirectory = (await stat(root)).isDirectory();
  } catch {
    // Reported below.
  }
  if (!isDirectory) {
    throw new CLIError(`Not a folder: ${root}`, ErrorCategory.NOT_FOUND, [
      "Pass rootPath: the absolute path of an existing project folder",
    ]);
  }
  return root;
}

export async function projectInitHandler(args: ProjectInitArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const root = await initRoot(args.rootPath);
    if (await hasModel(root)) {
      throw new CLIError(`A DR model already exists in ${root}`, ErrorCategory.USER, [
        'Use the model tools (model_info, model_search) to work with it, or "project_upgrade" to move it to the current spec version',
      ]);
    }

    const result = await initProject(root, {
      name: args.name,
      description: args.description,
      author: args.author,
      log: logToStderr,
    });

    // Drop every cached model (and any failed "no model" lookup) so the next call reads the
    // new one, then warm the cache for the folder the model was created in.
    clearModelCache();
    try {
      await reloadModel(args.rootPath);
    } catch (error) {
      // The model was created; the next tool call loads it.
      logToStderr(`after project_init, loading the new model failed: ${getErrorMessage(error)}`);
    }

    return jsonResult({
      status: "created",
      rootPath: result.rootPath,
      model: {
        name: result.name,
        version: result.version,
        specVersion: result.specVersion,
        path: result.modelPath,
      },
      ...(result.reportError !== undefined
        ? { warnings: [`Layer reports and README were not generated: ${result.reportError}`] }
        : {}),
      next: "The model is empty. Bootstrap it from the code, or let it grow with each change (changeset_create).",
    });
  });
}

export const projectInitTool: McpToolDefinition<typeof initInputSchema> = {
  name: "project_init",
  description:
    "Create an empty DR model at the current spec version in the project folder (documentation-robotics/), with its spec reference (.dr/) and layer reports. Fails if the folder already has a model. Installs no integration files.",
  inputSchema: initInputSchema,
  handler: projectInitHandler,
};

// ---------------------------------------------------------------------------
// project_upgrade
// ---------------------------------------------------------------------------

const upgradeInputSchema = {
  apply: z
    .boolean()
    .optional()
    .describe(
      "Apply the migration. Without it the tool only previews: show the preview to the user and apply only when they approve."
    ),
  rootPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to the project root containing documentation-robotics/. Defaults to the project the client has open (its MCP roots)."
    ),
};

export type ProjectUpgradeArgs = z.infer<z.ZodObject<typeof upgradeInputSchema>>;

const INTEGRATIONS_NOTE =
  "Installed integrations (Claude Code, Copilot) are left alone; `dr upgrade` in a terminal updates them.";

async function upgradeRoot(rootPath: string | undefined): Promise<string> {
  if (rootPath === undefined) await whenProjectRootSettled();
  const start = rootPath ?? process.cwd();
  const root = await findProjectRoot(start);
  if (!root || !(await hasModel(root))) {
    throw new CLIError(`No DR model found at ${start}`, ErrorCategory.NOT_FOUND, [
      'Call "project_init" to create one',
    ]);
  }
  return root;
}

function compareVersions(a: string, b: string): number {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] || 0) - (bs[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function formatRelationship(rel: { source: string; predicate: string; target: string }): string {
  return `${rel.source} --[${rel.predicate}]--> ${rel.target}`;
}

function capped<T>(items: T[]): { items: T[]; omitted?: number } {
  return items.length > MAX_LISTED ? { items: items.slice(0, MAX_LISTED), omitted: items.length - MAX_LISTED } : { items };
}

function elementTypeRenames(changes: ElementTypeRenameChange[]) {
  const byType = new Map<string, { fromType: string; toType: string; elements: Array<{ from: string; to: string }> }>();
  for (const change of changes) {
    const key = `${change.fromType}->${change.toType}`;
    const group = byType.get(key) ?? { fromType: change.fromType, toType: change.toType, elements: [] };
    group.elements.push({ from: change.from, to: change.to });
    byType.set(key, group);
  }
  return [...byType.values()].map((group) => {
    const { items, omitted } = capped(group.elements);
    return {
      fromType: group.fromType,
      toType: group.toType,
      count: group.elements.length,
      elements: items,
      ...(omitted ? { omitted } : {}),
    };
  });
}

function relationshipChange(change: RelationshipRewriteChange | StagedRelationshipRewriteChange) {
  const staged = "changeset" in change ? change : undefined;
  return {
    action: change.action,
    before: formatRelationship(change.before),
    ...(change.after ? { after: formatRelationship(change.after) } : {}),
    rules: change.rules,
    ...(staged ? { changeset: staged.changeset, stagedAs: staged.stagedAs } : {}),
    ...(staged?.duplicateOf ? { duplicateOf: staged.duplicateOf } : {}),
  };
}

function relationshipRewrites(changes: RelationshipRewriteChange[], label?: string) {
  const { items, omitted } = capped(changes);
  return {
    summary: summarizeRelationshipChanges(changes, label),
    changes: items.map(relationshipChange),
    ...(omitted ? { omitted } : {}),
  };
}

/** What a catalog migration renames and rewrites, and what it drops or fails on. */
function catalogReport(catalog: CatalogMigrationResult["details"], errors: string[]) {
  const dropped = [...catalog.relationshipChanges, ...catalog.stagedRelationshipChanges].filter(
    (change) => change.action === "dropped"
  );
  return {
    elementTypeRenames: elementTypeRenames(catalog.elementTypeChanges),
    relationshipRewrites: relationshipRewrites(catalog.relationshipChanges),
    ...(catalog.stagedRelationshipChanges.length > 0
      ? { stagedRelationshipRewrites: relationshipRewrites(catalog.stagedRelationshipChanges, "staged relationship changes") }
      : {}),
    cannotMigrate: [
      ...dropped.map((change) => ({
        kind: "relationship-dropped",
        relationship: formatRelationship(change.before),
        reason: "The catalog has no replacement for this relationship type; it is removed.",
        ...("changeset" in change ? { changeset: (change as StagedRelationshipRewriteChange).changeset } : {}),
      })),
      ...errors.map((message) => ({ kind: "error", message })),
    ],
  };
}

function emptyCatalogDetails(): CatalogMigrationResult["details"] {
  return { elementTypeChanges: [], relationshipChanges: [], stagedRelationshipChanges: [] };
}

function actionSummary(action: UpgradeAction) {
  return {
    type: action.type,
    description: action.description,
    ...(action.fromVersion ? { from: action.fromVersion } : {}),
    to: action.toVersion,
    ...(action.details?.length ? { details: action.details } : {}),
  };
}

function versions(scan: UpgradeScan) {
  const model = scan.model.state === "found" ? scan.model : undefined;
  return {
    cliVersion: getCliVersion(),
    cliSpecVersion: scan.bundledSpecVersion,
    model: { specVersion: model?.specVersion ?? null, targetSpecVersion: model?.targetSpecVersion ?? null },
    specReference: { installed: scan.installedSpecVersion },
  };
}

/** The catalog changes the plan makes: from the scan, or a dry run when a step rewrites the catalog. */
async function previewCatalog(
  projectRoot: string,
  scan: UpgradeScan
): Promise<{ details: CatalogMigrationResult["details"]; errors: string[] }> {
  if (scan.catalogPreview) {
    return { details: scan.catalogPreview.details, errors: scan.catalogPreview.errors };
  }
  if (!scan.steps.some((step: UpgradeStep) => step.rewritesCatalog)) {
    return { details: emptyCatalogDetails(), errors: [] };
  }
  try {
    const preview = await previewCatalogMigration(projectRoot);
    return { details: preview.details, errors: preview.errors };
  } catch (error) {
    return {
      details: emptyCatalogDetails(),
      errors: [`Could not preview the catalog changes: ${getErrorMessage(error)}`],
    };
  }
}

async function validationSummary(model: Model) {
  const result = await new Validator().validateModel(model);
  const errors = result.errors.slice(0, MAX_VALIDATION_ERRORS).map((issue) => ({
    layer: issue.layer,
    ...(issue.elementId ? { elementId: issue.elementId } : {}),
    message: issue.message,
  }));
  return {
    valid: result.isValid(),
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    ...(errors.length > 0 ? { errors } : {}),
    ...(result.errors.length > errors.length ? { moreErrors: result.errors.length - errors.length } : {}),
  };
}

function changesetSummary(result: ChangesetRebaselineResult) {
  return {
    rebaselined: result.rebaselined.map((ref) => ref.name),
    ...(result.drifted.length > 0
      ? {
          drifted: result.drifted.map((ref) => ref.name),
          driftedNote:
            "These had drifted from the model before the upgrade; they keep their old base and need --force to commit.",
        }
      : {}),
    ...(result.errors.length > 0 ? { errors: result.errors } : {}),
  };
}

export async function projectUpgradeHandler(args: ProjectUpgradeArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const projectRoot = await upgradeRoot(args.rootPath);
    const scan = await scanUpgrades(projectRoot, { targetBundledSpec: true });

    if (scan.model.state !== "found") {
      throw new CLIError(
        "The model's manifest has no spec version, so the upgrade can't tell which migrations it needs.",
        ErrorCategory.USER,
        ["Check spec_version in documentation-robotics/model/manifest.yaml"]
      );
    }

    if (scan.noMigrationPath) {
      const { from, to, available } = scan.noMigrationPath;
      const newer = compareVersions(from, to) > 0;
      const message = newer
        ? `The model is at spec v${from}, newer than the v${to} this dr carries. Update dr to work with it.`
        : `No migration leads from spec v${from} to v${to}.`;
      if (args.apply) {
        throw new CLIError(message, ErrorCategory.USER, [
          newer
            ? "Install a newer dr (npm install -g @documentation-robotics/cli)"
            : "If the spec change is additive, `dr upgrade --force` in a terminal stamps the new version without migrating",
        ]);
      }
      return jsonResult({
        status: newer ? "model-newer" : "no-migration-path",
        rootPath: projectRoot,
        ...versions(scan),
        message,
        availableMigrations: available,
      });
    }

    if (scan.actions.length === 0) {
      return jsonResult({
        status: "up-to-date",
        rootPath: projectRoot,
        ...versions(scan),
        message: `The model is at spec v${scan.model.specVersion}, the version this dr carries. Nothing to upgrade.`,
      });
    }

    if (!args.apply) {
      const catalog = await previewCatalog(projectRoot, scan);
      return jsonResult(
        {
          status: "preview",
          rootPath: projectRoot,
          ...versions(scan),
          steps: scan.steps,
          actions: scan.actions.map(actionSummary),
          ...catalogReport(catalog.details, catalog.errors),
          ...(!(await hasLayerReports(projectRoot)) ? { reports: "No layer reports yet; applying generates them." } : {}),
          integrations: INTEGRATIONS_NOTE,
          next: "Nothing has changed. Show this to the user; call project_upgrade with apply: true when they approve.",
        },
        { compact: true }
      );
    }

    // Apply: spec reference first, then the model, as `dr upgrade` does.
    const applied: Array<Record<string, unknown>> = [];
    const details = emptyCatalogDetails();
    let changesets: ChangesetRebaselineResult | undefined;
    try {
      for (const action of scan.actions) {
        if (action.type === "spec") {
          await installSpecReference(projectRoot, true);
          applied.push(actionSummary(action));
        } else if (action.type === "model") {
          const result = await upgradeModel(projectRoot, {
            fromVersion: action.fromVersion!,
            toVersion: action.toVersion,
            validate: true,
            catalogOnly: action.catalogOnly,
            versionBumpOnly: action.versionBumpOnly,
          });
          changesets = result.changesets;
          for (const step of result.migration?.applied ?? []) {
            applied.push({
              type: "model",
              from: step.from,
              to: step.to,
              description: step.changes?.description ?? step.description,
              filesModified: step.changes?.filesModified ?? 0,
            });
            const stepDetails = step.changes?.details as Partial<CatalogMigrationResult["details"]> | undefined;
            details.elementTypeChanges.push(...(stepDetails?.elementTypeChanges ?? []));
            details.relationshipChanges.push(...(stepDetails?.relationshipChanges ?? []));
            details.stagedRelationshipChanges.push(...(stepDetails?.stagedRelationshipChanges ?? []));
          }
        }
      }
    } finally {
      // Files changed on disk under any cached model, even when a step failed part way.
      clearModelCache();
    }

    const warnings: string[] = [];
    if (!(await hasLayerReports(projectRoot))) {
      try {
        await regenerateLayerReports(projectRoot, logToStderr);
      } catch (error) {
        warnings.push(`Layer reports were not generated: ${getErrorMessage(error)}`);
      }
    }

    const model = await reloadModel(args.rootPath);
    const { cannotMigrate, ...rewrites } = catalogReport(details, []);

    return jsonResult(
      {
        status: "applied",
        rootPath: projectRoot,
        from: scan.model.specVersion,
        to: model.manifest.specVersion,
        applied,
        ...rewrites,
        ...(cannotMigrate.length > 0 ? { dropped: cannotMigrate } : {}),
        ...(changesets ? { changesets: changesetSummary(changesets) } : {}),
        validation: await validationSummary(model),
        ...(warnings.length > 0 ? { warnings } : {}),
        integrations: INTEGRATIONS_NOTE,
      },
      { compact: true }
    );
  });
}

export const projectUpgradeTool: McpToolDefinition<typeof upgradeInputSchema> = {
  name: "project_upgrade",
  description:
    "Move the model to the spec version this dr carries. Previews by default: the version path, element type renames, relationship rewrites and anything it can't migrate. apply: true runs the migration, then reloads and validates the model. Leaves installed integrations alone.",
  inputSchema: upgradeInputSchema,
  handler: projectUpgradeHandler,
};
