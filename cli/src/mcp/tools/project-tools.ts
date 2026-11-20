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
 * migration table makes, anything it can't migrate, and (from a rehearsal on a copy) the model
 * files it would write and the required attributes it would leave empty or derive values for.
 * `apply: true` runs the migration, then reloads and validates the model with the warnings
 * `dr validate` reports, and lists every file it wrote, the model's apart from the rest. Values
 * derived for required attributes are staged in a changeset for review, never written to the base
 * model. Per-project integration files are left alone (the dr plugin replaces them). Files git
 * tracks under .dr/ are the caller's decision to put to the user (`gitignore`).
 *
 * Both write outside a changeset, so changeset-only mode refuses them (mcp/changeset-only.ts),
 * and DrBot is not given them (coding-agents/drbot-mcp.ts).
 */

import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { initProject, hasModel } from "../../core/project-init.js";
import {
  ensureDotDrIgnored,
  dotDrDecisionLines,
  dotDrIgnoreNotes,
  dotDrIgnoreWarnings,
  DOT_DR_IGNORE_LINE,
  DOT_DR_FILES_SHOWN,
  type DotDrIgnoreResult,
} from "../../core/dot-dr-ignore.js";
import { PRETTIER_IGNORE_BY_HAND, ensurePrettierIgnoresDrFiles } from "../../core/prettier-ignore.js";
import { commitHookNotes } from "../../core/commit-hooks.js";
import { scanOutsideModel } from "../../core/upgrade-outside-model.js";
import {
  countFiles,
  diffFiles,
  filesOutside,
  filesUnder,
  hashFiles,
  rehearseModelUpgrade,
  type FilesChanged,
} from "../../core/upgrade-rehearsal.js";
import type { UpgradeFills } from "../../core/upgrade-fills.js";
import { trackModelWrite } from "../../core/model-write-tracker.js";
import {
  countDroppedRelationships,
  previewDropRecord,
  emptyCatalogDetails,
  previewCatalog,
  scanUpgrades,
  type UpgradeAction,
  type UpgradeScan,
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
import {
  upgradeModel,
  type ChangesetRebaselineResult,
  type ModelUpgradeOptions,
  type ModelUpgradeResult,
} from "../../core/model-upgrade.js";
import { formatRoutes, type UpgradeDropRecord } from "../../core/upgrade-drop-record.js";
import type { Model } from "../../core/model.js";
import { installSpecReference } from "../../utils/spec-installer.js";
import { findProjectRoot } from "../../utils/project-paths.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { isDebug, isVerbose } from "../../utils/globals.js";
import { unfilledRequired, validationSummary, type UnfilledRequired } from "../../core/upgrade-validation.js";
import { fileExists } from "../../utils/file-io.js";
import { hasLayerReports, regenerateLayerReports } from "../../commands/reports.js";
import { currentProjectRoot, whenProjectRootSettled } from "../project-root.js";
import { clearModelCache, jsonResult, reloadModel, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";

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

/**
 * How many items a list in a project_upgrade result holds by default (relationship rewrites,
 * element renames, elements with empty attributes, orphans). A default, not a cut-off: each list
 * comes with its true count, a shortened one says how many it shows and leaves out and how to get
 * the rest, and `detail: "full"` lists every item.
 */
const MAX_LISTED = 200;

/** The call in progress: whether it asked for every item (`detail: "full"`), and whether it applies. */
const callDetail = new AsyncLocalStorage<{ full: boolean; apply: boolean }>();

const wantsFull = (): boolean => callDetail.getStore()?.full === true;

/**
 * How to get what a shortened list leaves out. A preview can simply be asked again. An apply
 * can't be repeated, so its hint points at what is still there afterwards.
 */
function more(): string {
  return callDetail.getStore()?.apply
    ? 'This list is shortened. git diff of documentation-robotics/ shows every change this apply made; pass detail: "full" with apply: true to get every item in the result.'
    : 'Call project_upgrade again with detail: "full" for every item.';
}

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

    const commitHooks = await hookNotes(root);
    const initWarnings = [
      ...(result.reportError !== undefined ? [`Layer reports and README were not generated: ${result.reportError}`] : []),
      ...(result.gitignore ? dotDrIgnoreWarnings(result.gitignore) : []),
      ...(result.gitignore?.decision
        ? [
            `${dotDrDecisionLines(result.gitignore.decision)[0]} Put the choice to the user, then call project_upgrade with apply: true and gitignore: "untrack", "keep-tracked" or "skip".`,
          ]
        : []),
      ...(result.gitignoreError !== undefined
        ? [`.gitignore was not updated: ${result.gitignoreError}. Ask the user to add /.dr/ to it.`]
        : []),
      ...(result.prettierignoreError !== undefined
        ? [`.prettierignore was not updated: ${result.prettierignoreError}. Ask the user to add ${PRETTIER_IGNORE_BY_HAND} to it.`]
        : []),
      ...commitHooks,
    ];

    return jsonResult({
      status: "created",
      rootPath: result.rootPath,
      model: {
        name: result.name,
        version: result.version,
        specVersion: result.specVersion,
        path: result.modelPath,
      },
      ...(result.gitignore?.added ? { gitignore: { path: result.gitignore.path, added: [DOT_DR_IGNORE_LINE] } } : {}),
      ...(result.prettierignore?.status === "added"
        ? { prettierignore: { path: result.prettierignore.path, added: result.prettierignore.entries } }
        : {}),
      ...(initWarnings.length > 0 ? { warnings: initWarnings } : {}),
      next: "The model is empty. Ask the user whether to bootstrap it from the code now (codebase_index, then codebase_extract) or let it grow with each change (changeset_create), and wait for their answer.",
    });
  }));
}

export const projectInitTool: McpToolDefinition<typeof initInputSchema> = {
  name: "project_init",
  description:
    "Create an empty DR model at the current spec version in the project folder (documentation-robotics/), with its spec reference (.dr/) and layer reports. Before calling it, propose a name (usually the project's) and confirm it with the user. Fails if the folder already has a model. Installs no integration files. Lists documentation-robotics/ in .prettierignore when the project uses prettier, and warns when a commit hook would get in the way of committing dr's files (a large-file hook that would refuse a changeset's changes.yaml, a prettier hook that still receives the folder).",
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
  gitignore: z
    .enum(["untrack", "keep-tracked", "skip"])
    .optional()
    .describe(
      "Only with apply: true, and only the user's choice. When git tracks files under .dr/ (the preview's gitignore.wouldIgnoreTracked), an ignore rule alone leaves them tracked and unstageable, so nothing is changed until this is passed: untrack removes them from git's index and ignores .dr/; keep-tracked ignores the rest of .dr/ and keeps them tracked; skip leaves .gitignore and the index as they are."
    ),
  detail: z
    .enum(["compact", "full"])
    .optional()
    .describe(
      'compact (default): each long list holds its first items, with its true count, how many it shows and leaves out, and how to get the rest. full: every item of every list. Counts and the validation verdict always cover the whole model, whichever is asked for.'
    ),
  modelOnly: z
    .boolean()
    .optional()
    .describe(
      "Only with apply: true. Upgrade the model and the per-checkout spec reference and nothing else: no layer reports, no .gitignore or .prettierignore lines."
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

const MODEL_PREFIX = "documentation-robotics/model/";

/** How many files each of modified, added and removed lists by default; see {@link capped}. */
const MAX_FILES_LISTED = 100;

/** The three lists, each shortened on its own; the caller gives the true count of all three. */
function cappedFiles(files: FilesChanged) {
  const modified = capped(files.modified, MAX_FILES_LISTED);
  const added = capped(files.added, MAX_FILES_LISTED);
  const removed = capped(files.removed, MAX_FILES_LISTED);
  const omitted = (modified.rest.omitted ?? 0) + (added.rest.omitted ?? 0) + (removed.rest.omitted ?? 0);
  return {
    modified: modified.items,
    added: added.items,
    removed: removed.items,
    ...(omitted > 0 ? { shown: countFiles(files) - omitted, omitted, more: more() } : {}),
  };
}

/**
 * The files written under documentation-robotics/ between two hashFiles snapshots: the model's
 * (filesModified, files) apart from the rest (otherFiles: changesets, reports), so a reviewer can
 * tell the migration from everything else.
 */
function filesChanged(before: Map<string, string>, after: Map<string, string>) {
  const changed = diffFiles(before, after);
  const model = filesUnder(changed, MODEL_PREFIX);
  const other = filesOutside(changed, MODEL_PREFIX);
  return {
    filesModified: countFiles(model),
    files: cappedFiles(model),
    ...(countFiles(other) > 0
      ? { otherFilesModified: countFiles(other), otherFiles: cappedFiles(other) }
      : {}),
  };
}

/** What the project's commit hooks would do to a commit of the files dr writes; empty when nothing. */
function hookNotes(projectRoot: string): Promise<string[]> {
  return commitHookNotes(projectRoot, { full: wantsFull() });
}

/** How many derived values are listed by default; see {@link capped}. The changeset holds them all. */
const MAX_FILLS_LISTED = 100;

/**
 * The values derived for required attributes (core/upgrade-fills.ts) and the changeset they are
 * staged in for review (`written` false in a preview).
 */
function fillsReport(fills: UpgradeFills | undefined, written: boolean) {
  if (!fills) return {};
  const { items, rest } = capped(fills.fills, MAX_FILLS_LISTED);
  const base = {
    changeset: fills.name,
    values: fills.count,
    elements: fills.elements,
    fills: items.map((fill) => ({
      elementId: fill.elementId,
      attribute: fill.attribute,
      value: fill.value,
      rule: fill.rule,
    })),
    ...rest,
    // Once written, the changeset itself is the complete list
    ...(rest.omitted && written && !fills.error
      ? { more: `changeset_show ${fills.name} lists every staged value.` }
      : {}),
  };
  if (fills.error) {
    return {
      derivedValues: {
        ...base,
        error: `The derived values could not be staged in a changeset: ${fills.error}. They are listed here; nothing was written.`,
      },
    };
  }
  return {
    derivedValues: {
      ...base,
      // A preview's id is the rehearsal copy's: only a written changeset has one to give
      ...(written && fills.id ? { id: fills.id } : {}),
      note: written
        ? "Values derived from each element's own name or description for required attributes it left empty, staged in this changeset (changeset_show). Nothing was written to the base model. Show them to the user; fix or unstage what is wrong (changeset_activate, then model_update or changeset_unstage); land it with changeset_commit only when the user asks."
        : "Applying stages these derived values in this changeset for review. Nothing is written to the base model until the user lands it.",
    },
  };
}

/** Values an earlier upgrade staged in a fills changeset that has not landed: not staged a second time. */
function stagedEarlierReport(result: Pick<ModelUpgradeResult, "stagedEarlier"> | undefined) {
  const earlier = result?.stagedEarlier ?? [];
  if (earlier.length === 0) return {};
  return {
    alreadyStaged: {
      note: "Derived values an earlier upgrade staged in these changesets, which have not landed. They are waiting for the user's review there and are not staged again.",
      changesets: earlier.map((entry) => ({ changeset: entry.changeset, values: entry.fills.length })),
    },
  };
}

/** The required attributes no derivation covers, per element. */
function unfilledReport(unfilled: UnfilledRequired[] | undefined) {
  if (!unfilled || unfilled.length === 0) return {};
  const { items, rest } = capped(unfilled);
  return {
    unfilledRequired: {
      note: "Required attributes these elements would leave empty with no value to derive. Fill them in from the code or the user after the upgrade.",
      elementCount: unfilled.length,
      attributeCount: unfilled.reduce((n, item) => n + item.attributes.length, 0),
      elements: items,
      ...rest,
    },
  };
}

/** upgradeModel's options for a scanned model action. */
function modelUpgradeOptions(action: UpgradeAction, force: boolean): ModelUpgradeOptions {
  return {
    fromVersion: action.fromVersion!,
    toVersion: action.toVersion,
    // As `dr upgrade --force`: skip migration validation
    validate: !force,
    catalogOnly: action.catalogOnly,
    versionBumpOnly: action.versionBumpOnly,
  };
}

/**
 * The model step rehearsed on a copy (core/upgrade-rehearsal.ts): the model files it would write,
 * the changeset files, the validation errors the upgraded model would have, the values it would
 * derive and the required attributes it would leave empty.
 */
async function rehearsalReport(projectRoot: string, scan: UpgradeScan, force: boolean) {
  const action = scan.actions.find((candidate) => candidate.type === "model");
  if (!action) return {};
  try {
    const { result, modelFiles, otherFiles } = await rehearseModelUpgrade(projectRoot, modelUpgradeOptions(action, force));
    const errors = result.validationErrors;
    return {
      wouldWrite: {
        note: "From running the migration on a copy of documentation-robotics/. The project was not written.",
        modelFiles: { count: countFiles(modelFiles), ...cappedFiles(modelFiles) },
        ...(countFiles(otherFiles) > 0 ? { changesetFiles: { count: countFiles(otherFiles), ...cappedFiles(otherFiles) } } : {}),
        ...(errors
          ? { validationErrorsAfter: errors.length }
          : { validationError: `The upgraded copy could not be validated: ${result.validationError}` }),
      },
      ...fillsReport(result.fills, false),
      ...stagedEarlierReport(result),
      ...unfilledReport(result.unfilled ?? (errors && !result.fills ? unfilledRequired(errors) : undefined)),
    };
  } catch (error) {
    return { wouldWrite: { error: `Could not rehearse the migration on a copy: ${getErrorMessage(error)}` } };
  }
}

/** The choices for files git tracks under .dr/, as the preview and an apply without a choice return them. */
function gitignoreDecision(ignore: DotDrIgnoreResult, projectRoot: string) {
  const decision = ignore.decision!;
  const { items, rest } = capped(decision.files, DOT_DR_FILES_SHOWN);
  return {
    path: join(projectRoot, ".gitignore"),
    wouldIgnoreTracked: decision.wouldIgnoreTracked,
    trackedFiles: items,
    ...rest,
    alreadyIgnored: decision.alreadyIgnored,
    options: decision.options,
    note: 'Nothing changes until the user chooses. Put the options to them, then call project_upgrade with apply: true and gitignore: "untrack", "keep-tracked" or "skip".',
  };
}

/**
 * Keep .dr/ out of git on apply, with the caller's choice for files git already tracks there.
 * Returns the `gitignore` field of the result (what changed, or the decision still open) and
 * pushes warnings.
 */
async function applyGitignore(projectRoot: string, choice: ProjectUpgradeArgs["gitignore"], warnings: string[]) {
  try {
    const ignore = await ensureDotDrIgnored(projectRoot, { tracked: choice });
    warnings.push(...dotDrIgnoreWarnings(ignore));
    if (ignore.decision) return { gitignore: gitignoreDecision(ignore, projectRoot) };
    const notes = dotDrIgnoreNotes(ignore);
    if (notes.length === 0) return {};
    return {
      gitignore: {
        path: ignore.path,
        ...(ignore.added ? { added: ignore.keptTracked ? ["/.dr/*", ...ignore.keptTracked] : [DOT_DR_IGNORE_LINE] } : {}),
        ...(ignore.applied ? { applied: ignore.applied } : {}),
        ...(ignore.untracked ? { untracked: ignore.untracked } : {}),
        ...(ignore.replaced?.length ? { replaced: ignore.replaced } : {}),
        notes,
      },
    };
  } catch (error) {
    warnings.push(`.gitignore was not updated: ${getErrorMessage(error)}. Ask the user to add /.dr/ to it.`);
    return {};
  }
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

/**
 * A list as a result carries it: all of it when it is within the default size or the call asked
 * for `detail: "full"`, else its first `max` items with `rest` saying how many are shown, how many
 * are left out and how to get them. Callers give the true count beside it.
 */
function capped<T>(
  items: T[],
  max: number = MAX_LISTED
): { items: T[]; rest: { shown?: number; omitted?: number; more?: string } } {
  if (wantsFull() || items.length <= max) return { items, rest: {} };
  return { items: items.slice(0, max), rest: { shown: max, omitted: items.length - max, more: more() } };
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
    const { items, rest } = capped(group.elements);
    return {
      fromType: group.fromType,
      toType: group.toType,
      count: group.elements.length,
      elements: items,
      ...rest,
    };
  });
}

/** Elements (or staged changes) that lose attributes the spec removed from their type */
function retiredAttributeRemovals(changes: Array<RetiredAttributeChange | StagedRetiredAttributeChange>, noun?: string) {
  const { items, rest } = capped(changes);
  return {
    summary: summarizeRetiredAttributeChanges(changes, noun),
    count: changes.length,
    changes: items.map((change) => ({
      element: change.element,
      type: change.specNodeId,
      attributes: change.attributes,
      ...("changeset" in change ? { changeset: change.changeset, stagedAs: change.stagedAs } : {}),
    })),
    ...rest,
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
  const { items, rest } = capped(changes);
  return {
    summary: summarizeRelationshipChanges(changes, label),
    count: changes.length,
    changes: items.map(relationshipChange),
    ...rest,
  };
}

/** What a catalog migration renames and rewrites, and what it drops or fails on. */
function catalogReport(catalog: CatalogMigrationResult["details"], errors: string[]) {
  const dropped = [...catalog.relationshipChanges, ...catalog.stagedRelationshipChanges].filter(
    (change) => change.action === "dropped"
  );
  const droppedByType = countDroppedRelationships(catalog.relationshipChanges);
  return {
    // The model's dropped relationships by predicate and source and target type
    ...(droppedByType.length > 0 ? { droppedByType } : {}),
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
    const { items, rest } = capped(orphans);
    return {
      wouldOrphan: {
        count: orphans.length,
        note: "These elements lose their last relationship with the dropped ones; validation reports them as orphaned after apply. Relink them, or accept them as they are.",
        elements: items,
        ...rest,
      },
    };
  } catch (error) {
    return { wouldOrphan: { error: `Could not predict orphaned elements: ${getErrorMessage(error)}` } };
  }
}

/**
 * The upgrade record (core/upgrade-drop-record.ts): the staged changeset the dropped relationships
 * are written to on apply (`written` false in a preview), with the dropped types the catalog
 * still links and the relationship types it has between their element types.
 */
function dropRecordReport(record: UpgradeDropRecord | undefined, written: boolean) {
  if (!record) return {};
  const routes = record.byType
    .filter((entry) => entry.routes.length > 0)
    .map((entry) => ({
      dropped: `${entry.sourceType} --[${entry.predicate}]--> ${entry.targetType}`,
      count: entry.count,
      catalogHas: formatRoutes(entry.routes),
    }));
  const base = {
    changeset: record.name,
    relationships: record.count,
    ...(routes.length > 0 ? { routes } : {}),
  };
  if (record.error) {
    return {
      dropRecord: {
        ...base,
        error: `The dropped relationships could not be recorded in a changeset: ${record.error}. They are listed in dropped.`,
      },
    };
  }
  return {
    dropRecord: {
      ...base,
      ...(record.id ? { id: record.id } : {}),
      note: written
        ? "The dropped relationships are recorded in this staged changeset, one staged relationship delete each (changeset_show). It is a record and never lands. To restore one, add a relationship of a type the catalog has now (routes lists them per dropped type) in a changeset of the user's own; discard the record only when the user asks."
        : "Applying records the dropped relationships in this staged changeset, to review and restore from. It never lands. routes lists, per dropped type, the relationship types the catalog still has between the same element types.",
    },
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

function changesetSummary(result: ChangesetRebaselineResult) {
  return {
    rebaselined: result.rebaselined.map((ref) => ref.name),
    ...(result.drifted.length > 0
      ? {
          drifted: result.drifted.map((ref) => ref.name),
          driftedNote:
            "These had drifted from the model before the upgrade; they keep their old base, and changeset_commit lands them only with force: true, once the user agrees.",
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

/**
 * What applying would touch outside the model (core/upgrade-outside-model.ts): the spec reference,
 * layer reports, the ignore files (or the decision about files git tracks under .dr/) and what a
 * large-file commit hook would do. Empty when it touches nothing there.
 */
async function outsideModelReport(projectRoot: string, scan: UpgradeScan) {
  const outside = await scanOutsideModel(projectRoot, scan);
  let decision: ReturnType<typeof gitignoreDecision> | undefined;
  if (outside.gitignore?.decision) {
    const ignore = await ensureDotDrIgnored(projectRoot, { dryRun: true });
    if (ignore.decision) decision = gitignoreDecision(ignore, projectRoot);
  }
  const groups = {
    ...(outside.specReference ? { specReference: outside.specReference.description } : {}),
    ...(outside.reports ? { reports: { generate: outside.reports.files, note: "No layer reports yet; applying generates them." } } : {}),
    ...(outside.gitignore && !outside.gitignore.decision
      ? {
          gitignore: {
            path: outside.gitignore.path,
            ...(outside.gitignore.add ? { add: outside.gitignore.add } : {}),
            ...(outside.gitignore.replace ? { replace: outside.gitignore.replace } : {}),
            ...(outside.gitignore.untrack ? { untrack: outside.gitignore.untrack } : {}),
          },
        }
      : {}),
    ...(outside.prettierignore ? { prettierignore: { path: outside.prettierignore.path, add: outside.prettierignore.add } } : {}),
  };
  return {
    ...(Object.keys(groups).length > 0
      ? {
          outsideModel: {
            note: "What applying also writes outside documentation-robotics/model/. modelOnly: true (with apply) skips all of it except the spec reference.",
            ...groups,
          },
        }
      : {}),
    ...(decision ? { gitignore: decision } : {}),
    ...(outside.commitHooks ? { commitHooks: outside.commitHooks } : {}),
    ...(outside.errors.length > 0 ? { outsideModelErrors: outside.errors } : {}),
  };
}

/**
 * Applying holds the project's write lock from the scan through the reread after it, so no other
 * tool's write lands in the middle of a migration or saves a model read before it over it. A
 * preview only reads, and doesn't take it.
 */
function lockedWhenApplying(args: ProjectUpgradeArgs, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return args.apply ? withProjectWriteLock(args.rootPath, fn) : fn();
}

export async function projectUpgradeHandler(args: ProjectUpgradeArgs): Promise<CallToolResult> {
  return callDetail.run({ full: args.detail === "full", apply: args.apply === true }, () => runProjectUpgrade(args));
}

async function runProjectUpgrade(args: ProjectUpgradeArgs): Promise<CallToolResult> {
  return runTool(() => withConsoleOnStderr(() => lockedWhenApplying(args, async () => {
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
      // A model already on this spec still gets what dr upgrade gives it outside the model: the
      // .prettierignore entries and the .dr/ ignore rule. A preview says what is missing, apply
      // adds it; files git tracks under .dr/ wait for the user's choice either way.
      const warnings: string[] = [];
      const outside = await scanOutsideModel(projectRoot, scan, { dotDr: args.gitignore });
      for (const error of outside.errors) console.error(`[mcp] project_upgrade: ${error}`);
      const pending: string[] = [];
      let gitignore: Record<string, unknown> = {};
      let prettierignore: Record<string, unknown> = {};
      if (args.apply && !args.modelOnly) {
        gitignore = await applyGitignore(projectRoot, args.gitignore, warnings);
        try {
          const ignore = await ensurePrettierIgnoresDrFiles(projectRoot);
          if (ignore.status === "added") prettierignore = { prettierignore: { path: ignore.path, added: ignore.entries } };
        } catch (error) {
          warnings.push(`.prettierignore was not updated: ${getErrorMessage(error)}. Ask the user to add ${PRETTIER_IGNORE_BY_HAND} to it.`);
        }
      } else if (!args.modelOnly) {
        if (outside.gitignore?.add) {
          gitignore = { gitignore: { path: join(projectRoot, outside.gitignore.path), missing: outside.gitignore.add } };
          pending.push(`${outside.gitignore.path} doesn't ignore .dr/ (dr's per-checkout state)`);
        }
        if (outside.prettierignore) {
          prettierignore = {
            prettierignore: { path: join(projectRoot, outside.prettierignore.path), missing: outside.prettierignore.add },
          };
          pending.push(
            `the project uses prettier, which reformats the files dr writes, and ${outside.prettierignore.path} doesn't ignore ${outside.prettierignore.add.join(" and ")}`
          );
        }
      }
      if (!args.modelOnly && outside.gitignore?.decision && !("gitignore" in gitignore)) {
        const ignore = await ensureDotDrIgnored(projectRoot, { dryRun: true });
        if (ignore.decision) gitignore = { gitignore: gitignoreDecision(ignore, projectRoot) };
      }
      const decisionOpen = Boolean((gitignore.gitignore as { options?: unknown } | undefined)?.options);
      return jsonResult({
        status: "up-to-date",
        rootPath: projectRoot,
        ...versions(scan),
        message: `The model is at spec v${specVersion}, the version this dr carries. Nothing to upgrade.`,
        ...gitignore,
        ...prettierignore,
        ...(outside.commitHooks && !args.modelOnly ? { commitHooks: outside.commitHooks } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(pending.length > 0 || decisionOpen
          ? {
              next: [
                ...(pending.length > 0
                  ? [`${pending.join("; ")}. Calling project_upgrade with apply: true adds the missing lines, once the user approves.`]
                  : []),
                ...(decisionOpen
                  ? ['git tracks files under .dr/: put gitignore.options to the user, then call project_upgrade with apply: true and their choice as gitignore.']
                  : []),
              ].join(" "),
            }
          : {}),
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
          ...dropRecordReport(await previewDropRecord(projectRoot, scan, catalog.details).catch(() => undefined), false),
          ...(await wouldOrphan(projectRoot, catalog.details)),
          ...(await rehearsalReport(projectRoot, scan, force)),
          ...(await outsideModelReport(projectRoot, scan)),
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
    let dropRecord: UpgradeDropRecord | undefined;
    let modelResult: ModelUpgradeResult | undefined;
    try {
      // One tracked write: the server's other calls don't read the model while it is half migrated.
      await trackModelWrite(projectRoot, undefined, async () => {
        for (const action of scan.actions) {
          if (action.type === "spec") {
            await installSpecReference(projectRoot, true);
            applied.push(actionSummary(action));
          } else if (action.type === "model") {
            const result = await upgradeModel(projectRoot, modelUpgradeOptions(action, force));
            modelResult = result;
            changesets = result.changesets;
            dropRecord = result.dropRecord;
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
      });
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
      ...dropRecordReport(dropRecord, true),
      ...fillsReport(modelResult?.fills, true),
      ...stagedEarlierReport(modelResult),
      ...(changesets ? { changesets: changesetSummary(changesets) } : {}),
    };
    const warnings = [...checkErrors];

    // Outside the model: .dr/ kept out of git (files git already tracks there are the user's
    // choice, #1185) and prettier kept off the files dr writes (#1155, #1246). Not with modelOnly.
    let gitignore: Record<string, unknown> = {};
    let prettierignoreAdded: { path: string; added: string[] } | undefined;
    if (!args.modelOnly) {
      gitignore = await applyGitignore(projectRoot, args.gitignore, warnings);
      try {
        const ignore = await ensurePrettierIgnoresDrFiles(projectRoot);
        if (ignore.status === "added") prettierignoreAdded = { path: ignore.path!, added: ignore.entries! };
      } catch (error) {
        warnings.push(
          `.prettierignore was not updated: ${getErrorMessage(error)}. Ask the user to add ${PRETTIER_IGNORE_BY_HAND} to it.`
        );
      }
    }
    const commitHooks = args.modelOnly ? [] : await hookNotes(projectRoot);

    // The migration is on disk from here: a failure in the follow-up steps is reported with it.
    try {
      let reports: { reports: string } | Record<string, never> = {};
      if (!args.modelOnly && !(await hasLayerReports(projectRoot))) {
        try {
          await regenerateLayerReports(projectRoot, logToStderr);
          reports = { reports: "Generated documentation-robotics/reports/ (13 layer reports) and documentation-robotics/README.md: the project had none." };
        } catch (error) {
          warnings.push(`Layer reports were not generated: ${getErrorMessage(error)}`);
        }
      }
      const model = await reloadModel(args.rootPath);
      const validation = await validationSummary(
        model,
        undefined,
        [
          ...(modelResult?.fills ? [modelResult.fills] : []),
          ...(modelResult?.stagedEarlier ?? []).map((entry) => ({ name: entry.changeset, fills: entry.fills })),
        ],
        { full: args.detail === "full" }
      );
      const decisionOpen = Boolean((gitignore.gitignore as { options?: unknown } | undefined)?.options);
      return jsonResult(
        {
          status: "applied",
          ...appliedResult,
          to: model.manifest.specVersion,
          validation,
          ...gitignore,
          ...(prettierignoreAdded ? { prettierignore: prettierignoreAdded } : {}),
          ...reports,
          ...(commitHooks.length > 0 ? { commitHooks } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(await integrationsNote(projectRoot)),
          ...(decisionOpen
            ? {
                next: 'The model is upgraded. git tracks files under .dr/, so .gitignore was left alone: put gitignore.options to the user, then call project_upgrade with apply: true and their choice as gitignore.',
              }
            : {}),
        },
        { compact: true }
      );
    } catch (error) {
      return jsonResult(
        {
          status: "applied-with-errors",
          ...appliedResult,
          followUpError: `The migration was applied, but reloading or validating the model failed: ${getErrorMessage(error)}`,
          ...gitignore,
          ...(prettierignoreAdded ? { prettierignore: prettierignoreAdded } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(await integrationsNote(projectRoot)),
          next: "Tell the user the model was migrated, then check it with model_reload and model_validate.",
        },
        { compact: true }
      );
    }
  })));
}

export const projectUpgradeTool: McpToolDefinition<typeof upgradeInputSchema> = {
  name: "project_upgrade",
  description:
    "Move the model to the spec version this dr carries. Previews by default: the version path, element type renames, retired attributes removed (retiredAttributes, stagedRetiredAttributes), relationship rewrites, anything it can't migrate (the dropped relationships counted by predicate and source and target type in droppedByType), the staged changeset the dropped relationships would be recorded in (dropRecord, with the relationship types the catalog still has between the same element types in routes), the elements the dropped relationships would leave orphaned (wouldOrphan), and, from running the migration on a copy, the model files it would write (wouldWrite), the values it would derive for required attributes (derivedValues) and the required attributes it would leave empty (unfilledRequired). It also lists what applying writes outside the model (outsideModel: spec reference, layer reports, .gitignore and .prettierignore lines) and what the repository's commit hooks would do to a commit of dr's files (commitHooks: a large-file hook that would refuse one, a prettier hook that still receives them). apply: true runs the migration, writes the drop record when it dropped any (an upgrade-record changeset: it never lands; the user restores from it by hand), stages the derived values in a changeset, upgrade-fills-<spec version>, for the user to review and land (never written to the base model), then reloads and validates the base model; force: true (with apply) stamps the version when no migration leads to it; modelOnly: true (with apply) writes nothing outside the model but the spec reference. The applied result lists the model files written (files) apart from the others (otherFiles), the warnings dr validate reports, and the required attributes still empty (validation.unfilledRequired), per element. When git tracks files under .dr/, the result carries gitignore.options and changes nothing there: put them to the user and pass their choice as gitignore with apply: true. Long lists hold their first items and say so (shown, omitted, more) beside the true count; detail: \"full\" returns every item.",
  inputSchema: upgradeInputSchema,
  handler: projectUpgradeHandler,
};
