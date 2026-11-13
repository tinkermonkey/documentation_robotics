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
 * reloads and validates the model with the warnings `dr validate` reports, and lists every model
 * file it wrote. Per-project integration files are left alone (the dr plugin replaces them).
 *
 * Both write outside a changeset, so changeset-only mode refuses them (mcp/changeset-only.ts),
 * and DrBot is not given them (coding-agents/drbot-mcp.ts).
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  summarizeRetiredAttributeChanges,
  type RetiredAttributeChange,
  type StagedRetiredAttributeChange,
} from "../../core/attribute-migration.js";
import {
  summarizeRelationshipChanges,
  type RelationshipRewriteChange,
  type StagedRelationshipRewriteChange,
} from "../../core/relationship-migration.js";
import { upgradeModel, type ChangesetRebaselineResult } from "../../core/model-upgrade.js";
import type { Model } from "../../core/model.js";
import { Relationships } from "../../core/relationships.js";
import { installSpecReference } from "../../utils/spec-installer.js";
import { findProjectRoot } from "../../utils/project-paths.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { isDebug, isVerbose } from "../../utils/globals.js";
import { Validator } from "../../validators/validator.js";
import { addModelWarnings } from "../../validators/model-warnings.js";
import { fileExists } from "../../utils/file-io.js";
import { hasLayerReports, regenerateLayerReports } from "../../commands/reports.js";
import { currentProjectRoot, whenProjectRootSettled } from "../project-root.js";
import { clearModelCache, jsonResult, reloadModel, runTool, type McpToolDefinition } from "./shared.js";

/** The MCP server's stdout carries the protocol: progress lines go to stderr. */
const logToStderr = (message: string): void => {
  process.stderr.write(`[mcp] ${message}\n`);
};

/** --verbose and --debug lines from the shared cores, on stderr. */
const verboseToStderr = (message: string): void => {
  if (isVerbose()) logToStderr(message);
};
const debugToStderr = (message: string): void => {
  if (isDebug()) logToStderr(`[DEBUG] ${message}`);
};

let consoleGuards = 0;
let savedConsole: Pick<Console, "log" | "info" | "debug"> | undefined;

/**
 * Runs fn with console.log, console.info and console.debug sent to stderr. The init and upgrade
 * cores are CLI code: any line one of them prints while this server runs over stdio would land in
 * the JSON-RPC stream. Counted, so overlapping calls restore the console only when the last ends.
 */
export async function withConsoleOnStderr<T>(fn: () => Promise<T>): Promise<T> {
  if (consoleGuards++ === 0) {
    savedConsole = { log: console.log, info: console.info, debug: console.debug };
    const toStderr = (...args: unknown[]) => console.error(...args);
    console.log = toStderr;
    console.info = toStderr;
    console.debug = toStderr;
  }
  try {
    return await fn();
  } finally {
    if (--consoleGuards === 0 && savedConsole) {
      console.log = savedConsole.log;
      console.info = savedConsole.info;
      console.debug = savedConsole.debug;
      savedConsole = undefined;
    }
  }
}

/** A rootPath argument must be absolute: a relative one would resolve against the server's cwd. */
function absoluteRootPath(rootPath: string): string {
  if (!isAbsolute(rootPath)) {
    throw new CLIError(`rootPath must be an absolute path: ${rootPath}`, ErrorCategory.USER, [
      "Pass the absolute path of the project folder",
    ]);
  }
  return resolve(rootPath);
}

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
    root = absoluteRootPath(rootPath);
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
  return runTool(() => withConsoleOnStderr(async () => {
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
      logVerbose: verboseToStderr,
      logDebug: debugToStderr,
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
      next: "The model is empty. Ask the user whether to bootstrap it from the code now (codebase_index, then codebase_extract) or let it grow with each change (changeset_create), and wait for their answer.",
    });
  }));
}

export const projectInitTool: McpToolDefinition<typeof initInputSchema> = {
  name: "project_init",
  description:
    "Create an empty DR model at the current spec version in the project folder (documentation-robotics/), with its spec reference (.dr/) and layer reports. Before calling it, propose a name (usually the project's) and confirm it with the user. Fails if the folder already has a model. Installs no integration files.",
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
  force: z
    .boolean()
    .optional()
    .describe(
      "Only with apply: true. As `dr upgrade --force`: stamp the new spec version when no migration leads to it (additive spec changes), reinstall the spec reference, and skip migration validation. Use it only when the user approves."
    ),
  rootPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to the project root containing documentation-robotics/. Defaults to the project the client has open (its MCP roots)."
    ),
};

export type ProjectUpgradeArgs = z.infer<z.ZodObject<typeof upgradeInputSchema>>;

/**
 * What to say about per-project integration files, which the dr plugin replaces: nothing when
 * there are none, which is the usual case.
 */
async function integrationsNote(projectRoot: string): Promise<{ integrations?: string }> {
  const notes: string[] = [];
  if (await fileExists(join(projectRoot, ".claude", ".dr-version"))) {
    notes.push(
      "This project still has per-project integration files from `dr claude install` (.claude/). The dr Claude Code plugin replaces them and project_upgrade leaves them alone; the user can remove them."
    );
  }
  if (await fileExists(join(projectRoot, ".github", ".dr-copilot-version"))) {
    notes.push(
      "This project has per-project GitHub Copilot integration files from `dr copilot install` (.github/), which project_upgrade leaves alone. To bring them up to this dr's version, the user runs `dr copilot upgrade` in a terminal (there is no tool for it)."
    );
  }
  return notes.length > 0 ? { integrations: notes.join(" ") } : {};
}

/** Every file under `dir` with a hash of its content, by path relative to `root`. */
async function hashFiles(root: string, dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let entries;
  try {
    entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
  } catch {
    return hashes;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    try {
      hashes.set(relative(root, file).split(sep).join("/"), createHash("sha1").update(await readFile(file)).digest("hex"));
    } catch {
      // gone since the listing
    }
  }
  return hashes;
}

/** The files written, added and removed between two hashFiles snapshots. */
function filesChanged(before: Map<string, string>, after: Map<string, string>) {
  const modified: string[] = [];
  const added: string[] = [];
  for (const [file, hash] of after) {
    const old = before.get(file);
    if (old === undefined) added.push(file);
    else if (old !== hash) modified.push(file);
  }
  const removed = [...before.keys()].filter((file) => !after.has(file));
  return {
    filesModified: modified.length + added.length + removed.length,
    files: { modified: modified.sort(), added: added.sort(), removed: removed.sort() },
  };
}

async function upgradeRoot(rootPath: string | undefined): Promise<string> {
  if (rootPath === undefined) await whenProjectRootSettled();
  const start = rootPath !== undefined ? absoluteRootPath(rootPath) : process.cwd();
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

/** Elements (or staged changes) that lose attributes the spec removed from their type */
function retiredAttributeRemovals(changes: Array<RetiredAttributeChange | StagedRetiredAttributeChange>, noun?: string) {
  const { items, omitted } = capped(changes);
  return {
    summary: summarizeRetiredAttributeChanges(changes, noun),
    count: changes.length,
    changes: items.map((change) => ({
      element: change.element,
      type: change.specNodeId,
      attributes: change.attributes,
      ...("changeset" in change ? { changeset: change.changeset, stagedAs: change.stagedAs } : {}),
    })),
    ...(omitted ? { omitted } : {}),
  };
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
    ...(catalog.retiredAttributeChanges.length > 0
      ? { retiredAttributes: retiredAttributeRemovals(catalog.retiredAttributeChanges) }
      : {}),
    ...(catalog.stagedRetiredAttributeChanges.length > 0
      ? { stagedRetiredAttributes: retiredAttributeRemovals(catalog.stagedRetiredAttributeChanges, "staged change") }
      : {}),
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

/**
 * The elements the migration would leave with no relationship and no reference: connected now,
 * and not in the relationships the migration itself produces (`committedRelationshipsAfter`,
 * from its dry run). What `dr validate` reports as orphaned after apply, staged changes aside as
 * in the applied validation. Only elements are reported, under their post-migration ids; a
 * relationship end that names no element is never one. Null when the dry run didn't produce the
 * migrated relationships.
 */
export function predictOrphans(
  model: Pick<Model, "layers" | "getBaseRelationships">,
  catalog: CatalogMigrationResult["details"]
): Array<{ elementId: string; loses: string[] }> | null {
  const after = catalog.committedRelationshipsAfter;
  if (!after) return null;
  // In a dry run the element files aren't renamed yet, so ids may still be the old ones.
  const renamed = new Map(catalog.elementTypeChanges.map((change) => [change.from, change.to]));
  const id = (elementId: string) => renamed.get(elementId) ?? elementId;

  const elements = new Set<string>();
  const referenced = new Set<string>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      const elementId = id(element.path || element.id);
      elements.add(elementId);
      if ((element.references ?? []).length === 0) continue;
      referenced.add(elementId);
      for (const ref of element.references ?? []) referenced.add(id(ref.target));
    }
  }

  const connectedAfter = new Set(referenced);
  for (const rel of after) {
    connectedAfter.add(id(rel.source));
    connectedAfter.add(id(rel.target));
  }
  const loses = new Map<string, string[]>();
  for (const rel of model.getBaseRelationships()) {
    for (const end of [id(rel.source), id(rel.target)]) {
      if (!elements.has(end) || connectedAfter.has(end)) continue;
      loses.set(end, [...(loses.get(end) ?? []), formatRelationship(rel)]);
    }
  }
  return [...loses.entries()]
    .map(([elementId, lost]) => ({ elementId, loses: lost }))
    .sort((a, b) => a.elementId.localeCompare(b.elementId));
}

/** predictOrphans for the preview, loading the model; says so when it can't predict. */
export async function wouldOrphan(projectRoot: string, catalog: CatalogMigrationResult["details"]) {
  // Any rewrite can orphan an element (one that moves a relationship to other elements, as much
  // as a drop), so it runs whenever the dry run gave the migrated relationships.
  if (!catalog.committedRelationshipsAfter && catalog.relationshipChanges.length === 0) return {};
  try {
    const { Model } = await import("../../core/model.js");
    const orphans = predictOrphans(await Model.load(projectRoot, { lazyLoad: false }), catalog);
    if (orphans === null) {
      return { wouldOrphan: { error: "Could not predict orphaned elements: the dry run didn't produce the migrated relationships." } };
    }
    if (orphans.length === 0) return {};
    const { items, omitted } = capped(orphans);
    return {
      wouldOrphan: {
        count: orphans.length,
        note: "These elements lose their last relationship with the dropped ones; validation reports them as orphaned after apply. Relink them, or accept them as they are.",
        elements: items,
        ...(omitted ? { omitted } : {}),
      },
    };
  } catch (error) {
    return { wouldOrphan: { error: `Could not predict orphaned elements: ${getErrorMessage(error)}` } };
  }
}

function emptyCatalogDetails(): CatalogMigrationResult["details"] {
  return {
    elementTypeChanges: [],
    retiredAttributeChanges: [],
    stagedRetiredAttributeChanges: [],
    relationshipChanges: [],
    stagedRelationshipChanges: [],
  };
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

/**
 * Validate the committed model only, with the warnings `dr validate` adds (orphaned elements, no
 * source reference), so the counts match it. Model.load merges an active changeset's staged
 * relationship adds and deletes into `relationships` (its layers stay the base), so the check
 * swaps the committed relationships back in rather than validate a mix of base and plan.
 */
async function validationSummary(model: Model) {
  const base = { ...model, relationships: new Relationships(model.getBaseRelationships()) } as unknown as Model;
  const result = await new Validator().validateModel(base);
  addModelWarnings(result, base);
  const issue = (item: { layer: string; elementId?: string; message: string }) => ({
    layer: item.layer,
    ...(item.elementId ? { elementId: item.elementId } : {}),
    message: item.message,
  });
  const errors = result.errors.slice(0, MAX_VALIDATION_ERRORS).map(issue);
  const warnings = result.warnings.slice(0, MAX_VALIDATION_ERRORS).map(issue);
  return {
    scope: "base model (staged changesets not included)",
    valid: result.isValid(),
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    ...(errors.length > 0 ? { errors } : {}),
    ...(result.errors.length > errors.length ? { moreErrors: result.errors.length - errors.length } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(result.warnings.length > warnings.length ? { moreWarnings: result.warnings.length - warnings.length } : {}),
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

/** Why the scan couldn't check the model against the catalog, if it couldn't. */
function catalogCheckErrors(scan: UpgradeScan): string[] {
  return [
    ...(scan.catalogCheckError !== undefined
      ? [`Could not check the model against the catalog: ${scan.catalogCheckError}`]
      : []),
    ...(scan.catalogPreview?.errors ?? []),
  ];
}

export async function projectUpgradeHandler(args: ProjectUpgradeArgs): Promise<CallToolResult> {
  return runTool(() => withConsoleOnStderr(async () => {
    if (args.force && !args.apply) {
      throw new CLIError("force is only used together with apply: true", ErrorCategory.USER, [
        "Preview without force first, then call project_upgrade with apply: true and force: true when the user approves",
      ]);
    }
    const projectRoot = await upgradeRoot(args.rootPath);
    const force = args.force === true;
    const scan = await scanUpgrades(projectRoot, { targetBundledSpec: true, force });

    if (scan.model.state !== "found") {
      throw new CLIError(
        "The model's manifest has no spec version, so the upgrade can't tell which migrations it needs.",
        ErrorCategory.USER,
        ["Check spec_version in documentation-robotics/model/manifest.yaml"]
      );
    }

    // A model ahead of this dr can't be migrated, with or without force.
    const { specVersion, targetSpecVersion } = scan.model;
    if (compareVersions(specVersion, targetSpecVersion) > 0) {
      const message = `The model is at spec v${specVersion}, newer than the v${targetSpecVersion} this dr carries. Update dr to work with it.`;
      if (args.apply) {
        throw new CLIError(message, ErrorCategory.USER, [
          "Install a newer dr (npm install -g @documentation-robotics/cli)",
        ]);
      }
      return jsonResult({ status: "model-newer", rootPath: projectRoot, ...versions(scan), message });
    }

    if (scan.noMigrationPath) {
      const { from, to, available } = scan.noMigrationPath;
      const message = `No migration leads from spec v${from} to v${to}. If the spec change is additive (new types and relationships only), project_upgrade with apply: true and force: true stamps the model with v${to} without changing its data.`;
      if (args.apply) {
        throw new CLIError(message, ErrorCategory.USER, [
          "Call project_upgrade with apply: true and force: true once the user approves stamping the new version",
        ]);
      }
      return jsonResult({
        status: "no-migration-path",
        rootPath: projectRoot,
        ...versions(scan),
        message,
        availableMigrations: available,
      });
    }

    const checkErrors = catalogCheckErrors(scan);
    if (scan.actions.length === 0) {
      if (checkErrors.length > 0) {
        return jsonResult({
          status: "check-failed",
          rootPath: projectRoot,
          ...versions(scan),
          message: `The model is at spec v${specVersion}, but it could not be checked against the catalog, so it may still need catalog changes. Nothing was changed.`,
          errors: checkErrors,
        });
      }
      return jsonResult({
        status: "up-to-date",
        rootPath: projectRoot,
        ...versions(scan),
        message: `The model is at spec v${specVersion}, the version this dr carries. Nothing to upgrade.`,
      });
    }

    if (!args.apply) {
      const catalog = await previewCatalog(projectRoot, scan);
      const errors = [...new Set([...checkErrors, ...catalog.errors])];
      return jsonResult(
        {
          status: "preview",
          rootPath: projectRoot,
          ...versions(scan),
          steps: scan.steps,
          actions: scan.actions.map(actionSummary),
          ...catalogReport(catalog.details, errors),
          ...(await wouldOrphan(projectRoot, catalog.details)),
          ...(!(await hasLayerReports(projectRoot)) ? { reports: "No layer reports yet; applying generates them." } : {}),
          ...(await integrationsNote(projectRoot)),
          next: "Nothing has changed. Show this to the user; call project_upgrade with apply: true when they approve.",
        },
        { compact: true }
      );
    }

    // Apply: spec reference first, then the model, as `dr upgrade` does. The model folder is
    // hashed before and after, so the result names every file the migration wrote, added or removed.
    const modelFilesBefore = await hashFiles(projectRoot, "documentation-robotics");
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
            // As `dr upgrade --force`: skip migration validation
            validate: !force,
            catalogOnly: action.catalogOnly,
            versionBumpOnly: action.versionBumpOnly,
          });
          changesets = result.changesets;
          if (action.versionBumpOnly) {
            applied.push(actionSummary(action));
          }
          for (const step of result.migration?.applied ?? []) {
            // No per-step file count: the migrations count only some of the files they write.
            applied.push({
              type: "model",
              from: step.from,
              to: step.to,
              description: step.changes?.description ?? step.description,
            });
            const stepDetails = step.changes?.details as Partial<CatalogMigrationResult["details"]> | undefined;
            details.elementTypeChanges.push(...(stepDetails?.elementTypeChanges ?? []));
            details.retiredAttributeChanges.push(...(stepDetails?.retiredAttributeChanges ?? []));
            details.stagedRetiredAttributeChanges.push(...(stepDetails?.stagedRetiredAttributeChanges ?? []));
            details.relationshipChanges.push(...(stepDetails?.relationshipChanges ?? []));
            details.stagedRelationshipChanges.push(...(stepDetails?.stagedRelationshipChanges ?? []));
          }
        }
      }
    } catch (error) {
      if (applied.length === 0) throw error;
      // Part of the plan is already on disk: say what, then what failed.
      return jsonResult(
        {
          status: "partially-applied",
          rootPath: projectRoot,
          applied,
          ...filesChanged(modelFilesBefore, await hashFiles(projectRoot, "documentation-robotics")),
          error: getErrorMessage(error),
          next: "Some changes were written before the failure. Check the model (model_validate) and tell the user.",
        },
        { isError: true, compact: true }
      );
    } finally {
      // Files changed on disk under any cached model, even when a step failed part way.
      clearModelCache();
    }

    const { cannotMigrate, ...rewrites } = catalogReport(details, []);
    const appliedResult = {
      rootPath: projectRoot,
      from: specVersion,
      to: targetSpecVersion,
      applied,
      ...filesChanged(modelFilesBefore, await hashFiles(projectRoot, "documentation-robotics")),
      ...rewrites,
      ...(cannotMigrate.length > 0 ? { dropped: cannotMigrate } : {}),
      ...(changesets ? { changesets: changesetSummary(changesets) } : {}),
    };
    const warnings = [...checkErrors];

    // The migration is on disk from here: a failure in the follow-up steps is reported with it.
    try {
      if (!(await hasLayerReports(projectRoot))) {
        try {
          await regenerateLayerReports(projectRoot, logToStderr);
        } catch (error) {
          warnings.push(`Layer reports were not generated: ${getErrorMessage(error)}`);
        }
      }
      const model = await reloadModel(args.rootPath);
      const validation = await validationSummary(model);
      return jsonResult(
        {
          status: "applied",
          ...appliedResult,
          to: model.manifest.specVersion,
          validation,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(await integrationsNote(projectRoot)),
        },
        { compact: true }
      );
    } catch (error) {
      return jsonResult(
        {
          status: "applied-with-errors",
          ...appliedResult,
          followUpError: `The migration was applied, but reloading or validating the model failed: ${getErrorMessage(error)}`,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(await integrationsNote(projectRoot)),
          next: "Tell the user the model was migrated, then check it with model_reload and model_validate.",
        },
        { compact: true }
      );
    }
  }));
}

export const projectUpgradeTool: McpToolDefinition<typeof upgradeInputSchema> = {
  name: "project_upgrade",
  description:
    "Move the model to the spec version this dr carries. Previews by default: the version path, element type renames, retired attributes removed (retiredAttributes, stagedRetiredAttributes), relationship rewrites, anything it can't migrate, and the elements the dropped relationships would leave orphaned (wouldOrphan). apply: true runs the migration, then reloads and validates the base model; force: true (with apply) stamps the version when no migration leads to it. The applied result counts the model files written and the warnings dr validate reports.",
  inputSchema: upgradeInputSchema,
  handler: projectUpgradeHandler,
};
