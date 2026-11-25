/**
 * Farm Commands - Manage model farms and project registration
 */

import ansis from "ansis";
import { Command } from "commander";
import path from "path";
import { realpath, rm } from "fs/promises";
import { FarmManifest, farmPathFor, resolveFarmPath } from "../core/farm-manifest.js";
import {
  ProjectRegistry,
  deriveProjectName,
  DEFAULT_MODEL_FOLDER,
  loadFarm,
  removeProjectCall,
  resolveFarm,
  resolveRepository,
  type FarmLocation,
} from "../core/project-registry.js";
import { migrateFarmManifest, type FarmMigrationPlan } from "../core/farm-migration.js";
import { resolveModelDirectory } from "../utils/project-paths.js";
import { fileExists } from "../utils/file-io.js";
import { execSync, execFileSync } from "child_process";
import * as prompts from "@clack/prompts";
import { getErrorMessage, handleSuccess, handleInfo, handleWarning } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { Model } from "../core/model.js";
import { ComposedReferenceValidator } from "../validators/composed-reference-validator.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";
import { FarmSyncEngine } from "../core/farm-sync-engine.js";
import { FarmSyncState, FarmSyncStateNotFoundError } from "../core/farm-sync-state.js";

interface FarmSyncResultEntry {
  project: string;
  status: "success" | "error" | "partial";
  change_count?: number;
  changeset_id?: string;
  files_changed?: { added: string[]; modified: string[]; deleted: string[] };
  ambiguities?: number;
  commits_before?: string;
  commits_after?: string;
  auto_committed?: boolean;
  committed_changes?: number;
  commit_error?: string;
  /** Whether the model changes were committed to the farm-level git repository */
  git_committed?: boolean;
  /** Set when the farm git repository could not be checked; changes were saved but not committed */
  git_warning?: string;
  message?: string;
}

interface ProjectStatus {
  name: string;
  repository: string;
  model: string;
  remote?: string;
  last_sync_commit: string | undefined;
  current_commit: string | undefined;
  has_pending_changes: boolean | undefined;
  /** Set when .farm-sync.yaml exists but could not be read (corrupt YAML, permissions, ...) */
  sync_state_error?: string;
  /** Set when the project's codebase directory is missing or its HEAD cannot be read */
  codebase_error?: string;
  /** Set when the repository folder is gone: the project stays in the farm until it is removed (#1438) */
  repository_missing?: true;
  /** With repository_missing: the call that drops the project from the farm */
  remove?: string;
}

/**
 * Result of checking whether a directory is a git repository.
 * - `isRepo: true` — git rev-parse succeeded; auto-commits can proceed.
 * - `isRepo: false, error: undefined` — git reported "not a git repository"; auto-commits are
 *   skipped silently (the farm was never put under version control).
 * - `isRepo: false, error: string` — git could not answer (binary missing, permission denied,
 *   ...). Callers must surface `error` so a change that was saved but not committed is visible.
 */
interface GitRepositoryCheck {
  isRepo: boolean;
  error?: string;
}

/**
 * Check if a directory is a git repository, distinguishing "not a repository" from
 * unexpected failures of the git command itself.
 */
function checkGitRepository(cwd: string): GitRepositoryCheck {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
    return { isRepo: true };
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    // Pattern: "fatal: not a git repository" (case insensitive check for safety)
    if (errorMsg.toLowerCase().includes("not a git repository")) {
      return { isRepo: false };
    }

    // Missing git binary, permission denied, corrupt .git, ... — the caller decides
    // how to report it; the change itself has already been saved to disk.
    return { isRepo: false, error: errorMsg.trim() };
  }
}

/**
 * Build the user-facing warning for a change that was saved to disk but could not be
 * committed because the farm git repository could not be checked.
 */
function uncommittedChangeWarning(what: string, farmRoot: string, gitError: string): string {
  return `${what} was saved but not committed: could not check git repository at ${farmRoot}: ${gitError}`;
}

/**
 * Resolve the top-level directory of the git repository containing `cwd`, or null when
 * `cwd` is not inside one (or git cannot answer).
 */
function gitTopLevel(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe", encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * True when `target` is tracked by the same git repository as `farmRoot`, i.e. a
 * `git add` of it from the farm root can succeed. A model outside the farm root, or inside
 * a nested checkout with its own `.git`, belongs to another repository.
 */
function isInSameGitRepository(farmRoot: string, target: string): boolean {
  const farmTop = gitTopLevel(farmRoot);
  return farmTop !== null && farmTop === gitTopLevel(target);
}

/**
 * How `dr farm add` settled on a model folder for a project.
 */
interface ModelRegistration {
  /** Model path as recorded in farm.yaml: relative to the farm root, and allowed to leave it */
  modelFolder: string;
  /** Absolute path of the registered model directory */
  modelFullPath: string;
  /** True when an existing model was registered instead of scaffolding one */
  adopted: boolean;
  /** Set when --new-model ignored a model that lives in the codebase */
  ignoredModelPath?: string;
  /** User-facing warning attached to the registration (also carried in JSON output) */
  warning?: string;
  /** True when the model folder is recorded but not created (the user farm, a repository with no model yet) */
  notCreated?: boolean;
}

/**
 * A path relative to the farm root, using forward slashes so farm.yaml stays portable.
 * Returns "." for the farm root itself.
 */
function farmRelativePath(farmRoot: string, target: string, absoluteOutside = false): string {
  if (absoluteOutside) {
    return farmPathFor(farmRoot, target);
  }
  const rel = path.relative(farmRoot, target);
  return rel === "" ? "." : rel.split(path.sep).join("/");
}

/**
 * True when `target` is `parent` itself or lies strictly inside it (lexical check on
 * resolved paths; symlinks are not followed).
 */
function isWithinPath(target: string, parent: string): boolean {
  return target === parent || target.startsWith(parent + path.sep);
}

/**
 * Decide which model folder a newly added project should use.
 *
 * Lookup order, mirroring `ComposedReferenceValidator`'s external model resolution:
 * `{codebase}/documentation-robotics/model`, `{codebase}/model`, then the codebase path
 * itself. A codebase that already carries a model is adopted in place unless
 * `forceNewModel` asks for the old scaffold-a-duplicate behaviour; `explicitModel` skips
 * detection and registers that path (resolved with the same lookup order).
 */
async function resolveProjectModel(
  name: string,
  input: {
    farmRoot: string;
    codebaseFullPath: string;
    explicitModel?: string;
    forceNewModel: boolean;
    /** Record a path outside the farm root as absolute (the user farm) instead of farm-relative. */
    absoluteOutside?: boolean;
  }
): Promise<ModelRegistration> {
  const { farmRoot, codebaseFullPath, explicitModel, forceNewModel } = input;
  const absoluteOutside = input.absoluteOutside ?? false;

  if (explicitModel) {
    const explicitFullPath = absoluteOutside ? path.resolve(explicitModel) : path.resolve(farmRoot, explicitModel);
    const resolved = await resolveModelDirectory(explicitFullPath, { requireManifest: true });
    if (!resolved) {
      throw new Error(
        `No model found at '${explicitModel}': expected manifest.yaml in ${explicitFullPath}, ` +
          `${path.join(explicitFullPath, "model")} or ${path.join(explicitFullPath, "documentation-robotics", "model")}. ` +
          `Omit --model to scaffold a new model at ${name}-model.`
      );
    }
    return {
      modelFolder: farmRelativePath(farmRoot, resolved.modelDir, absoluteOutside),
      modelFullPath: resolved.modelDir,
      adopted: true,
    };
  }

  // A codebase that self-hosts its model (documentation-robotics/model/manifest.yaml) is
  // adopted rather than shadowed by an empty duplicate (#962). The farm root itself is
  // never a candidate: a farm is not a model.
  const detected =
    codebaseFullPath === farmRoot
      ? null
      : await resolveModelDirectory(codebaseFullPath, { requireManifest: true });

  if (detected && !forceNewModel) {
    return {
      modelFolder: farmRelativePath(farmRoot, detected.modelDir, absoluteOutside),
      modelFullPath: detected.modelDir,
      adopted: true,
    };
  }

  if (absoluteOutside) {
    // The user farm keeps no model folders of its own: a repository without a model gets one
    // recorded at its default place (documentation-robotics/model), created by `dr init` there.
    if (forceNewModel) {
      throw new Error("--new-model scaffolds <name>-model inside a folder farm; the user farm keeps no model folders");
    }
    const modelFullPath = path.join(codebaseFullPath, DEFAULT_MODEL_FOLDER);
    return { modelFolder: modelFullPath, modelFullPath, adopted: false, notCreated: true };
  }

  // Scaffold (or reuse) <farm>/<name>-model
  const modelFolder = `${name}-model`;
  const modelFullPath = path.resolve(path.join(farmRoot, modelFolder));

  // Validate path traversal for model folder
  if (!modelFullPath.startsWith(farmRoot + path.sep)) {
    throw new Error(`Invalid model path: would escape farm root. Path: ${modelFolder}`);
  }

  return {
    modelFolder,
    modelFullPath,
    adopted: false,
    ...(detected ? { ignoredModelPath: farmRelativePath(farmRoot, detected.modelDir, absoluteOutside) } : {}),
  };
}

/** The farm in use, loaded. */
interface OpenFarm {
  location: FarmLocation;
  farmRoot: string;
  farmYamlPath: string;
  manifest: FarmManifest;
}

/**
 * Open the farm in use (DR_FARM_PATH, else a farm found upward, else the user farm). A
 * dr-farm-v1 farm is read with a notice on stderr naming `dr farm migrate`. The user farm is
 * written on first use only when `create` is true; otherwise it is read as empty.
 */
async function openFarm(options: { create?: boolean } = {}): Promise<OpenFarm> {
  const location = await resolveFarm();
  const manifest = await loadFarm(location, { create: options.create ?? false });
  const notice = manifest.legacyNotice();
  if (notice) {
    console.error(ansis.yellow(`Notice: ${notice}`));
  }
  return { location, farmRoot: location.root, farmYamlPath: location.file, manifest };
}

/** Refuse a write to a dr-farm-v1 farm, before anything else is changed. */
function refuseLegacyWrite(manifest: FarmManifest): void {
  const notice = manifest.legacyNotice();
  if (notice) {
    throw new Error(notice);
  }
}

/**
 * Initialize a new farm
 */
export async function farmInitCommand(options: {
  name?: string;
  description?: string;
  format?: string;
  platformView?: boolean;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.init") : null;

  try {
    const farmPath = process.cwd();
    const farmYamlPath = path.join(farmPath, "farm.yaml");

    // Check if farm.yaml already exists
    const useJson = options.format === "json" || isJson();
    if (await fileExists(farmYamlPath)) {
      const message = "Farm already initialized in this directory";
      if (useJson) {
        console.log(JSON.stringify({ status: "error", code: 1, message }));
      } else {
        console.error(ansis.red(`Error: ${message}`));
      }
      if (span) endSpan(span);
      process.exit(1);
    }

    // Get farm name
    let farmName = options.name;
    if (!farmName) {
      const isInteractive = process.stdin.isTTY;
      if (isInteractive) {
        const result = await prompts.text({
          message: "Farm name",
          placeholder: "My Architecture Farm",
        });

        if (typeof result === "string") {
          farmName = result;
        }
      }
    }

    if (!farmName) {
      farmName = "Architecture Farm";
    }

    // Create manifest with platform_view support if requested
    const manifest = FarmManifest.create(farmName, {
      platform_view: options.platformView || false,
    });
    await manifest.save(farmYamlPath);

    // Initialize farm-level git repository
    try {
      execSync("git init", { cwd: farmPath, stdio: useJson ? "pipe" : "inherit" });
      execSync("git config user.email 'dr-farm@localhost'", {
        cwd: farmPath,
        stdio: "pipe",
      });
      execSync("git config user.name 'DR Farm'", {
        cwd: farmPath,
        stdio: "pipe",
      });

      // Add farm.yaml and commit
      execSync("git add farm.yaml", { cwd: farmPath, stdio: "pipe" });
      execSync("git commit -m 'Initialize farm manifest'", {
        cwd: farmPath,
        stdio: useJson ? "pipe" : "inherit",
      });
    } catch (gitError) {
      throw new Error(
        `Failed to initialize farm git repository: ${getErrorMessage(gitError)}`
      );
    }

    if (useJson) {
      console.log(JSON.stringify({ status: "ok", farmPath, farmName, platform_view: options.platformView || false }));
    } else {
      const platformViewNote = options.platformView ? " (platform-view enabled)" : "";
      handleSuccess(
        `Farm initialized: ${ansis.bold(farmName)}${platformViewNote}\n  Location: ${farmPath}`
      );
    }

    if (span) endSpan(span);
  } catch (error) {
    const useJsonError = options.format === "json" || isJson();
    if (useJsonError) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 1,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(1);
  }
}

/**
 * Add a project to the farm
 */
export async function farmAddCommand(
  nameArg: string | undefined,
  options: {
    remote?: string;
    codebase?: string;
    model?: string;
    newModel?: boolean;
    format?: string;
  }
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.add", { "project.name": nameArg ?? "" }) : null;
  const useJson = options.format === "json" || isJson();

  try {
    if (options.model && options.newModel) {
      throw new Error(
        "--model and --new-model cannot be combined: --model registers an existing model, --new-model scaffolds a fresh one"
      );
    }
    if (!nameArg && !options.codebase) {
      throw new Error("Name the project or its codebase: dr farm add <name> [--codebase <path>], or dr farm add --codebase <path>");
    }
    if (!nameArg && options.remote) {
      throw new Error("--remote clones into <name>: name the project (dr farm add <name> --remote <url>)");
    }

    // The farm in use: DR_FARM_PATH, else a farm found upward, else the user farm.
    const { location, farmRoot, farmYamlPath, manifest } = await openFarm();
    refuseLegacyWrite(manifest);

    const userFarm = location.source === "user";
    if (userFarm && options.remote) {
      throw new Error(
        `--remote clones into a folder farm. The farm in use is the user farm (${farmYamlPath}): ` +
          `clone the repository yourself, then 'dr farm add --codebase <path>'.`
      );
    }

    // Determine codebase path. In the user farm a relative --codebase is relative to the working
    // directory and recorded absolute; in a folder farm it is relative to the farm root.
    let codebasePath = options.codebase || (nameArg as string);
    if (userFarm) {
      codebasePath = path.resolve(codebasePath);
    }

    let codebaseFullPath = resolveFarmPath(farmRoot, codebasePath);
    const farmRootResolved = path.resolve(farmRoot);

    // Clone if remote URL provided
    if (options.remote) {
      // Validate path traversal: `git clone` writes to codebaseFullPath, so it must resolve
      // within farmRoot. Without --remote nothing is written to the codebase path (it is only
      // recorded in farm.yaml), so a sibling checkout such as `--codebase ../my-service` is
      // allowed and resolved later by FarmSyncEngine.
      if (!codebaseFullPath.startsWith(farmRootResolved + path.sep)) {
        throw new Error(
          `Invalid codebase path: would escape farm root. Path: ${codebasePath}`
        );
      }

      if (await fileExists(codebaseFullPath)) {
        throw new Error(`Codebase directory '${codebasePath}' already exists`);
      }

      if (!useJson) {
        handleInfo(`Cloning ${options.remote} to ${codebasePath}...`);
      }

      try {
        execFileSync("git", ["clone", options.remote, codebaseFullPath], {
          stdio: useJson ? "pipe" : "inherit",
        });
      } catch (error) {
        throw new Error(`Failed to clone repository: ${getErrorMessage(error)}`);
      }
    }

    // A codebase in git is its repository's project: a worktree path resolves to the main
    // checkout, so adding a worktree finds (or adds) its project, never a project per worktree.
    const repository = await resolveRepository(codebaseFullPath);
    let resolvedFromWorktree: string | undefined;
    if (repository && repository.mainCheckout !== (await realPathOf(codebaseFullPath))) {
      resolvedFromWorktree = codebasePath;
      codebaseFullPath = repository.mainCheckout;
      codebasePath = farmPathFor(farmRoot, repository.mainCheckout);
    }

    if (repository) {
      const registry = ProjectRegistry.fromManifest(location, manifest);
      const existing = await registry.projectForRepository(repository);
      if (existing) {
        if (nameArg && nameArg !== existing.name) {
          throw new Error(
            `Repository ${repository.mainCheckout} is already in the farm as project '${existing.name}'`
          );
        }
        reportExistingProject(existing.name, existing.repository, existing.model, resolvedFromWorktree, useJson);
        if (span) endSpan(span);
        return;
      }
    }

    const holders = new Map(
      manifest.getAllProjects().map((p) => [p.name, resolveFarmPath(farmRoot, p.repository)] as const)
    );
    if (nameArg && manifest.getProject(nameArg)) {
      throw new Error(`Project '${nameArg}' already exists in this farm`);
    }
    const name = deriveProjectName(codebaseFullPath, (n) => holders.get(n), nameArg);

    // Decide which model the project uses: an explicit --model path, the codebase's own
    // self-hosted model (adopted in place), or a fresh scaffold at <name>-model.
    const registration = await resolveProjectModel(name, {
      farmRoot: farmRootResolved,
      codebaseFullPath,
      explicitModel: options.model,
      forceNewModel: options.newModel ?? false,
      absoluteOutside: userFarm,
    });
    const modelFolder = registration.modelFolder;

    if (registration.ignoredModelPath) {
      const ignoredWarning = `Codebase '${codebasePath}' already has a model at ${registration.ignoredModelPath}; ignoring it and scaffolding a new model at ${modelFolder} (--new-model)`;
      registration.warning = ignoredWarning;
      if (!useJson) {
        handleWarning(ignoredWarning);
      }
    }

    if (registration.adopted) {
      if (!useJson) {
        handleInfo(`Using existing model at ${registration.modelFullPath}; nothing was created`);
      }
    } else if (registration.notCreated) {
      registration.warning = `No model yet at ${registration.modelFullPath}; run 'dr init' in ${codebaseFullPath} to create it`;
      if (!useJson) {
        handleWarning(registration.warning);
      }
    } else if (!(await fileExists(registration.modelFullPath))) {
      // Initialize model with manifest and layer structure
      await Model.init(
        registration.modelFullPath,
        {
          name: name,
          version: "0.1.0",
          description: undefined,
          author: undefined,
          specVersion: (await import("../utils/spec-version.js")).getCliBundledSpecVersion(),
          created: new Date().toISOString(),
        },
        { lazyLoad: false }
      );

      if (!useJson) {
        handleInfo(`Created and initialized model folder: ${modelFolder}`);
      }
    }

    // Add project to manifest
    manifest.addProject(name, {
      name,
      repository: codebasePath,
      model: modelFolder,
      ...((options.remote ?? repository?.remote) ? { remote: options.remote ?? repository?.remote } : {}),
    });

    await manifest.save(farmYamlPath);

    // Commit farm.yaml changes to farm-level git repository if git is available
    const gitCheck = checkGitRepository(farmRoot);
    let gitCommitted = false;
    let gitWarning: string | undefined;

    if (gitCheck.error) {
      gitWarning = uncommittedChangeWarning("farm.yaml", farmRoot, gitCheck.error);
      if (!useJson) {
        handleWarning(gitWarning);
      }
    } else if (gitCheck.isRepo) {
      // Proceed with commit (handle commit errors independently)
      try {
        execSync("git add farm.yaml", { cwd: farmRoot, stdio: "pipe" });
        execFileSync("git", ["commit", "-m", `Add project: ${name}`], {
          cwd: farmRoot,
          stdio: useJson ? "pipe" : "inherit",
        });
        gitCommitted = true;
      } catch (commitError) {
        const errorMsg = getErrorMessage(commitError);
        // If nothing to commit, that's fine
        if (!errorMsg.includes("nothing to commit")) {
          throw new Error(`Failed to commit farm changes: ${errorMsg}`);
        }
      }
    }

    if (useJson) {
      console.log(
        JSON.stringify({
          status: "ok",
          project: name,
          repository: codebasePath,
          ...(resolvedFromWorktree ? { resolved_from: resolvedFromWorktree } : {}),
          created: true,
          farm: farmYamlPath,
          model: modelFolder,
          model_path: registration.modelFullPath,
          model_adopted: registration.adopted,
          ...(registration.ignoredModelPath ? { ignored_model: registration.ignoredModelPath } : {}),
          ...(registration.warning ? { warning: registration.warning } : {}),
          git_committed: gitCommitted,
          ...(gitWarning ? { git_warning: gitWarning } : {}),
        })
      );
    } else {
      const modelNote = registration.adopted ? " (existing model, adopted in place)" : "";
      const worktreeNote = resolvedFromWorktree ? ` (main checkout of ${resolvedFromWorktree})` : "";
      handleSuccess(
        `Project added to farm: ${ansis.bold(name)}\n  Codebase: ${codebasePath}${worktreeNote}\n  Model: ${modelFolder}${modelNote}\n  Farm: ${farmYamlPath}`
      );
    }

    if (span) endSpan(span);
  } catch (error) {
    if (useJson) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 1,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(1);
  }
}

async function realPathOf(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** Report a `dr farm add` whose repository is already a project: nothing is written. */
function reportExistingProject(
  name: string,
  repository: string,
  model: string,
  resolvedFrom: string | undefined,
  useJson: boolean
): void {
  if (useJson) {
    console.log(
      JSON.stringify({
        status: "ok",
        project: name,
        repository,
        ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
        model,
        created: false,
      })
    );
  } else {
    const from = resolvedFrom ? `${resolvedFrom} is a checkout of ` : "";
    handleInfo(`${from}project ${ansis.bold(name)} (${repository}), already in the farm; nothing was changed`);
  }
}

/**
 * Remove a project from the farm
 */
export async function farmRemoveCommand(
  name: string,
  options: {
    deleteModel?: boolean;
    format?: string;
  }
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.remove", { "project.name": name }) : null;
  const useJson = options.format === "json" || isJson();

  try {
    // Find farm root
    const { farmRoot, farmYamlPath, manifest } = await openFarm();
    refuseLegacyWrite(manifest);

    // Check if project exists
    const project = manifest.getProject(name);
    if (!project) {
      throw new Error(`Project '${name}' not found in farm`);
    }

    // Remove model folder if requested. Only a model the farm scaffolded for itself is
    // deleted: one adopted from the codebase (inside the project's source tree) or lying
    // outside the farm root is left untouched and the project is merely deregistered.
    let modelDeleted = false;
    let modelKeptReason: string | undefined;
    if (options.deleteModel) {
      const modelFullPath = resolveFarmPath(farmRoot, project.model);
      const farmRootResolved = path.resolve(farmRoot);
      const codebaseFullPath = resolveFarmPath(farmRoot, project.repository);

      if (!modelFullPath.startsWith(farmRootResolved + path.sep)) {
        // Traversal guard: never delete anything outside the farm root
        modelKeptReason = `model '${project.model}' lies outside the farm root and is not managed by the farm`;
      } else if (isWithinPath(modelFullPath, codebaseFullPath)) {
        modelKeptReason = `model '${project.model}' is the codebase's own model (inside '${project.repository}')`;
      }

      if (modelKeptReason) {
        if (!useJson) {
          handleWarning(`Model folder not deleted: ${modelKeptReason}. Remove it by hand if that is what you want.`);
        }
      } else if (await fileExists(modelFullPath)) {
        try {
          await rm(modelFullPath, { recursive: true, force: false });
          modelDeleted = true;
          if (!useJson) {
            handleInfo(`Deleted model folder: ${project.model}`);
          }
        } catch (error) {
          throw new Error(`Failed to delete model folder: ${getErrorMessage(error)}`);
        }
      }
    }

    // Remove project from manifest
    manifest.removeProject(name);
    await manifest.save(farmYamlPath);

    // Commit farm.yaml changes to farm-level git repository if git is available
    const gitCheck = checkGitRepository(farmRoot);
    let gitCommitted = false;
    let gitWarning: string | undefined;

    if (gitCheck.error) {
      gitWarning = uncommittedChangeWarning("farm.yaml", farmRoot, gitCheck.error);
      if (!useJson) {
        handleWarning(gitWarning);
      }
    } else if (gitCheck.isRepo) {
      // Proceed with commit (handle commit errors independently)
      try {
        execSync("git add farm.yaml", { cwd: farmRoot, stdio: "pipe" });
        execFileSync("git", ["commit", "-m", `Remove project: ${name}`], {
          cwd: farmRoot,
          stdio: useJson ? "pipe" : "inherit",
        });
        gitCommitted = true;
      } catch (commitError) {
        const errorMsg = getErrorMessage(commitError);
        // If nothing to commit, that's fine
        if (!errorMsg.includes("nothing to commit")) {
          throw new Error(`Failed to commit farm changes: ${errorMsg}`);
        }
      }
    }

    if (useJson) {
      console.log(
        JSON.stringify({
          status: "ok",
          project: name,
          model: project.model,
          modelDeleted,
          ...(modelKeptReason ? { model_kept_reason: modelKeptReason } : {}),
          git_committed: gitCommitted,
          ...(gitWarning ? { git_warning: gitWarning } : {}),
        })
      );
    } else {
      handleSuccess(`Project removed from farm: ${ansis.bold(name)}`);
    }

    if (span) endSpan(span);
  } catch (error) {
    if (useJson) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 1,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(1);
  }
}

/**
 * Show farm status
 */
export async function farmStatusCommand(options: {
  format?: string;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.status") : null;

  try {
    // Find farm root
    const { farmRoot, manifest } = await openFarm();

    const projects = manifest.getAllProjects();
    const engine = new FarmSyncEngine(farmRoot);

    const useJson = options.format === "json" || isJson();

    // Compute pending changes using lightweight commit comparison
    const projectsWithStatus = await Promise.all(
      projects.map(async (p) => {
        const result: ProjectStatus = {
          name: p.name,
          repository: p.repository,
          model: p.model,
          remote: p.remote,
          last_sync_commit: undefined,
          current_commit: undefined,
          has_pending_changes: undefined,
        };

        // A project whose repository folder was deleted is listed until removed: say so, and how (#1438).
        if (!(await fileExists(resolveFarmPath(farmRoot, p.repository)))) {
          result.repository_missing = true;
          result.remove = removeProjectCall(p.name);
        }

        // Step 1: sync state. A missing .farm-sync.yaml means the project has never been
        // synced (loadOrCreate returns an empty state); anything else is a real error.
        let lastSyncCommit: string | undefined;
        try {
          const syncStatePath = path.join(resolveFarmPath(farmRoot, p.model), ".farm-sync.yaml");
          const syncState = await FarmSyncState.loadOrCreate(syncStatePath, p.name);
          lastSyncCommit = syncState.lastSyncCommit;
          result.last_sync_commit = lastSyncCommit;
        } catch (error) {
          if (error instanceof FarmSyncStateNotFoundError) {
            // Not synced yet (defensive: loadOrCreate does not normally throw this)
            result.has_pending_changes = false;
            return result;
          }
          // Corrupt YAML, permission denied, ... — report it on the project
          result.sync_state_error = getErrorMessage(error);
          if (!useJson) {
            handleWarning(`${p.name}: could not read sync state: ${result.sync_state_error}`);
          }
          return result;
        }

        // Step 2: codebase HEAD. A missing codebase directory is an error on the project,
        // never "not synced yet".
        try {
          const currentCommit = await engine.getCurrentCommit(await engine.mainCheckoutPath(p));
          result.current_commit = currentCommit;
          result.has_pending_changes = !!(lastSyncCommit && lastSyncCommit !== currentCommit);
        } catch (error) {
          result.codebase_error = getErrorMessage(error);
          if (result.repository_missing) {
            result.codebase_error += `; its repository folder is gone: ${result.remove} drops the project from the farm`;
          }
          if (!useJson) {
            handleWarning(`${p.name}: ${result.codebase_error}`);
          }
        }

        return result;
      })
    );

    const projectsWithErrors = projectsWithStatus.filter(
      (p) => p.sync_state_error !== undefined || p.codebase_error !== undefined
    );
    const allHealthy = projectsWithErrors.length === 0;

    if (useJson) {
      console.log(
        JSON.stringify({
          status: allHealthy ? "ok" : "error",
          code: allHealthy ? 0 : 1,
          farm: {
            name: manifest.name,
            path: farmRoot,
            created: manifest.created,
            modified: manifest.modified,
            platform_view: manifest.platform_view,
          },
          projects: projectsWithStatus,
          project_count: projects.length,
        })
      );
    } else {
      console.log(ansis.bold(`Farm: ${manifest.name}`));
      console.log(`Location: ${farmRoot}`);
      if (manifest.platform_view) {
        console.log(`Platform-View: ${ansis.green("enabled")}`);
      }
      console.log(`Projects: ${projects.length}\n`);

      if (projects.length === 0) {
        console.log(ansis.dim("No projects registered yet."));
      } else {
        projectsWithStatus.forEach((project) => {
          console.log(`  ${ansis.cyan(project.name)}`);
          console.log(`    Codebase: ${project.repository}`);
          console.log(`    Model:    ${project.model}`);
          if (project.remote) {
            console.log(`    Remote:   ${project.remote}`);
          }
          if (project.sync_state_error) {
            console.log(`    Status:   ${ansis.red("✗ Sync state corrupted")}`);
            console.log(`    Error:    ${project.sync_state_error}`);
          } else if (project.codebase_error) {
            console.log(`    Status:   ${ansis.red("✗ Codebase unavailable")}`);
            console.log(`    Error:    ${project.codebase_error}`);
            if (project.remove) console.log(`    Remove:   ${project.remove}`);
          } else if (project.has_pending_changes) {
            console.log(`    Status:   ${ansis.yellow("⚠ Pending changes")}`);
          } else if (project.last_sync_commit) {
            console.log(`    Status:   ${ansis.green("✓ Up to date")}`);
          } else {
            console.log(`    Status:   ${ansis.dim("Not synced yet")}`);
          }
        });
      }

      if (!allHealthy) {
        console.error(
          ansis.red(`\n${projectsWithErrors.length} project(s) could not be checked (see errors above)`)
        );
      }
    }

    if (span) endSpan(span);
    if (!allHealthy) {
      process.exit(1);
    }
  } catch (error) {
    const useJsonError = options.format === "json" || isJson();
    if (useJsonError) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 2,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(2);
  }
}

/**
 * dr farm migrate: preview the dr-farm-v1 to dr-farm-v2 migration of the farm in use, and
 * write it with --apply (`application.applicationservice.farm-migrate-command`).
 */
export async function farmMigrateCommand(options: { apply?: boolean; format?: string }): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.migrate") : null;
  const useJson = options.format === "json" || isJson();

  try {
    const location = await resolveFarm();
    const manifest = await loadFarm(location, { create: false });
    const plan = await migrateFarmManifest(manifest, location.root);

    let applied = false;
    let gitCommitted = false;
    let gitWarning: string | undefined;
    if (options.apply && !plan.upToDate) {
      if (plan.conflicts.length > 0 || !plan.manifest) {
        throw new Error(
          `Not migrated: ${plan.conflicts.map((c) => c.message).join("; ")}`
        );
      }
      await plan.manifest.save(location.file);
      applied = true;

      const gitCheck = checkGitRepository(location.root);
      if (gitCheck.error) {
        gitWarning = uncommittedChangeWarning("farm.yaml", location.root, gitCheck.error);
      } else if (gitCheck.isRepo && location.source !== "user") {
        // A folder farm is versioned with its farm.yaml; the user farm's folder may sit in an
        // unrelated dotfiles repository, which is not ours to commit to.
        try {
          execFileSync("git", ["add", "farm.yaml"], { cwd: location.root, stdio: "pipe" });
          execFileSync("git", ["commit", "-m", "Migrate farm.yaml to dr-farm-v2"], {
            cwd: location.root,
            stdio: "pipe",
          });
          gitCommitted = true;
        } catch (commitError) {
          const errorMsg = getErrorMessage(commitError);
          if (!errorMsg.includes("nothing to commit")) {
            gitWarning = `farm.yaml was migrated but not committed: ${errorMsg.trim()}`;
          }
        }
      }
    }

    if (useJson) {
      console.log(JSON.stringify(migrationJson(plan, location.file, applied, gitCommitted, gitWarning)));
    } else {
      printMigrationPlan(plan, location.file, applied, options.apply ?? false);
      if (gitWarning) handleWarning(gitWarning);
    }

    if (span) endSpan(span);
    if (plan.conflicts.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    if (useJson) {
      console.log(JSON.stringify({ status: "error", code: 1, message: getErrorMessage(error) }));
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(1);
  }
}

function migrationJson(
  plan: FarmMigrationPlan,
  file: string,
  applied: boolean,
  gitCommitted: boolean,
  gitWarning: string | undefined
): Record<string, unknown> {
  return {
    status: plan.conflicts.length > 0 ? "error" : "ok",
    farm: file,
    from: plan.from,
    to: plan.to,
    up_to_date: plan.upToDate,
    applied,
    ...(applied ? { git_committed: gitCommitted } : {}),
    ...(gitWarning ? { git_warning: gitWarning } : {}),
    projects: plan.projects.map((p) => ({
      ...p.project,
      name_derived: p.nameDerived,
      checkouts: p.entries,
    })),
    dropped: plan.dropped,
    not_in_git: plan.notInGit,
    conflicts: plan.conflicts,
  };
}

function printMigrationPlan(plan: FarmMigrationPlan, file: string, applied: boolean, apply: boolean): void {
  if (plan.upToDate) {
    handleSuccess(`${file} is already ${plan.to}; nothing to migrate`);
    return;
  }
  console.log(ansis.bold(`${applied ? "Migrated" : "Migration preview"}: ${file} (${plan.from} → ${plan.to})`));
  console.log(`Projects: ${plan.projects.length}\n`);
  for (const migrated of plan.projects) {
    const p = migrated.project;
    const derived = migrated.nameDerived ? ansis.dim(" (named after the main checkout's folder)") : "";
    console.log(`  ${ansis.cyan(p.name)}${derived}`);
    console.log(`    Repository: ${p.repository}`);
    console.log(`    Model:      ${p.model}`);
    if (p.remote) console.log(`    Remote:     ${p.remote}`);
    for (const e of migrated.entries) {
      const key = e.checkout ? `checkout ${e.checkout}` : "not a git checkout";
      const kept = e.entry === p.name ? "" : ansis.yellow(" (name dropped)");
      console.log(`    - ${e.entry}: ${e.source} → ${key}${kept}`);
    }
  }
  if (plan.dropped.length > 0) {
    console.log(ansis.yellow(`\nDropped names (${plan.dropped.length}): not kept as aliases; update scripts that use them`));
    for (const d of plan.dropped) {
      console.log(`  ${d.name} → project ${d.project}${d.checkout ? `, checkout ${d.checkout}` : ""}`);
    }
  }
  if (plan.notInGit.length > 0) {
    console.log(ansis.dim(`\nNot in git, kept as projects of their own: ${plan.notInGit.join(", ")}`));
  }
  if (plan.conflicts.length > 0) {
    console.error(ansis.red(`\nCannot migrate (${plan.conflicts.length}):`));
    for (const c of plan.conflicts) console.error(ansis.red(`  ${c.message}`));
    return;
  }
  if (!applied && !apply) {
    console.log(`\nRun ${ansis.bold("dr farm migrate --apply")} to write it.`);
  }
}

/**
 * Validate a farm project or all projects using composed scope
 */
export async function farmValidateCommand(options: {
  project?: string;
  verbose?: boolean;
  quiet?: boolean;
  output?: string;
  format?: string;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.validate") : null;

  try {
    // Find farm root
    const { farmRoot, manifest: farmManifest } = await openFarm();
    const useJson = options.format === "json" || isJson();

    // Determine which projects to validate
    let projectsToValidate = farmManifest.getAllProjects();
    let isPlatformViewValidation = false;

    if (options.project) {
      const project = farmManifest.getProject(options.project);
      if (!project) {
        throw new Error(`Project '${options.project}' not found in farm`);
      }
      projectsToValidate = [project];

      // Check if this is a platform-view project validation
      if (farmManifest.isPlatformViewEnabled() && options.project === "platform-view") {
        isPlatformViewValidation = true;
      } else if (options.project === "platform-view" && !farmManifest.isPlatformViewEnabled()) {
        // Warn if platform-view project is being validated but platform-view is not enabled
        if (!useJson && !options.quiet) {
          handleInfo(
            `Note: Validating platform-view project, but platform-view is not enabled on this farm`
          );
        }
      }
    }

    if (projectsToValidate.length === 0) {
      throw new Error("No projects found in farm");
    }

    // Create composed validator from farm
    // This automatically resolves model-path overrides for all projects in the farm
    const composedValidator = await ComposedReferenceValidator.fromFarm(farmRoot);
    if (useJson) {
      console.log(JSON.stringify({ status: "validating", projects: projectsToValidate.length, platform_view: isPlatformViewValidation }));
    } else if (!options.quiet) {
      if (options.project) {
        const platformViewNote = isPlatformViewValidation ? " (platform-view aggregation)" : "";
        handleInfo(`Validating project '${options.project}'${platformViewNote} with farm-aware references...`);
      } else {
        handleInfo(`Validating ${projectsToValidate.length} farm project(s) with farm-aware references...`);
      }
    }

    const allResults = [];
    const reportData = [];

    // Validate each project
    for (const project of projectsToValidate) {
      const modelPath = resolveFarmPath(farmRoot, project.model);

      // Check if model folder exists
      if (!(await fileExists(modelPath))) {
        const error = `Model folder not found for project '${project.name}' at ${modelPath}`;
        if (useJson) {
          console.log(
            JSON.stringify({
              status: "error",
              code: 2,
              project: project.name,
              message: error,
            })
          );
        } else {
          console.error(ansis.red(`Error: ${error}`));
        }
        if (span) endSpan(span);
        process.exit(2);
      }

      // Load the model using the safer startPath parameter
      // For detached models, check if manifest.yaml exists directly in the model folder.
      // If so, pass it directly to Model.load().
      let drModelPath = modelPath;
      const manifestPath = path.join(modelPath, "manifest.yaml");
      if (await fileExists(manifestPath)) {
        // Point directly to the manifest.yaml file
        drModelPath = manifestPath;
      }

      const model = await Model.load(drModelPath);

      let platformViewInfo: {
        declared_models: string[];
        missing_models: string[];
      } | undefined;

      // For platform-view projects, validate that all declared external models are resolvable
      if (isPlatformViewValidation) {
        const declaredModels = model.manifest.models || {};
        const declaredModelNames = Object.keys(declaredModels);

        platformViewInfo = {
          declared_models: declaredModelNames,
          missing_models: [],
        };

        if (declaredModelNames.length === 0) {
          if (!useJson && !options.quiet) {
            handleInfo(
              `  Platform-view project has no declared external models`
            );
          }
        } else {
          if (!useJson && !options.quiet) {
            handleInfo(
              `  Platform-view is declaring external models: ${declaredModelNames.join(", ")}`
            );
          }

          // Verify all declared models are available in the farm
          const missingModels: string[] = [];
          for (const declaredModelName of declaredModelNames) {
            const farmProject = farmManifest.getProject(declaredModelName);
            if (!farmProject) {
              missingModels.push(declaredModelName);
            }
          }

          platformViewInfo.missing_models = missingModels;

          if (missingModels.length > 0) {
            if (!useJson) {
              console.error(
                ansis.yellow(
                  `  ⚠ Warning: The following declared external models are not registered in the farm: ${missingModels.join(", ")}`
                )
              );
            }
          }
        }
      }

      // Validate using composed reference validator
      const result = await composedValidator.validateModel(model);

      allResults.push({ project: project.name, result });

      // Format and display validation output
      const formatted = ValidationFormatter.format(result, model, {
        verbose: options.verbose,
        quiet: options.quiet,
      });

      // Collect report data for output file
      const reportItem: any = {
        project: project.name,
        valid: result.isValid(),
        errors: result.errors.map((e) => ({
          message: e.message,
          layer: e.layer,
          elementId: e.elementId,
          location: e.location,
        })),
        warnings: result.warnings.map((w) => ({
          message: w.message,
          layer: w.layer,
          elementId: w.elementId,
          location: w.location,
        })),
        formatted,
      };

      if (platformViewInfo) {
        reportItem.platform_view_info = platformViewInfo;
      }

      reportData.push(reportItem);

      if (!options.quiet) {
        console.log(ansis.bold(`\nProject: ${project.name}`));
        console.log(formatted);
      }

      if (!result.isValid()) {
        if (options.project) {
          // Single project validation failed
          throw new Error(`Validation failed for project '${project.name}'`);
        }
        // Multi-project validation: track but continue
      }
    }

    // Check if all validations passed
    const allValid = allResults.every((r) => r.result.isValid());

    // Write output file if requested
    if (options.output) {
      const outputExt = path.extname(options.output).toLowerCase();

      if (outputExt === ".json") {
        // Write JSON report
        const jsonReport = {
          timestamp: new Date().toISOString(),
          farm_root: farmRoot,
          all_valid: allValid,
          projects: reportData.map((r) => {
            const projectData: any = {
              project: r.project,
              valid: r.valid,
              errors: r.errors,
              warnings: r.warnings,
            };
            if (r.platform_view_info) {
              projectData.platform_view_info = r.platform_view_info;
            }
            return projectData;
          }),
        };
        await (await import("fs/promises")).writeFile(
          options.output,
          JSON.stringify(jsonReport, null, 2),
          "utf-8"
        );
      } else if (outputExt === ".md") {
        // Write Markdown report
        let mdContent = `# Farm Validation Report\n\n`;
        mdContent += `**Date**: ${new Date().toISOString()}\n`;
        mdContent += `**Farm Root**: ${farmRoot}\n`;
        mdContent += `**Overall Status**: ${allValid ? "✅ Valid" : "❌ Invalid"}\n\n`;

        mdContent += `## Projects\n\n`;
        for (const r of reportData) {
          mdContent += `### ${r.project}\n\n`;
          mdContent += `**Status**: ${r.valid ? "✅ Valid" : "❌ Invalid"}\n\n`;

          if (r.errors.length > 0) {
            mdContent += `#### Errors (${r.errors.length})\n\n`;
            for (const err of r.errors) {
              mdContent += `- ${err.message}\n`;
            }
            mdContent += "\n";
          }

          if (r.warnings.length > 0) {
            mdContent += `#### Warnings (${r.warnings.length})\n\n`;
            for (const warn of r.warnings) {
              mdContent += `- ${warn.message}\n`;
            }
            mdContent += "\n";
          }
        }

        await (await import("fs/promises")).writeFile(options.output, mdContent, "utf-8");
      } else {
        throw new Error(`Unsupported output format: ${outputExt}. Use .json or .md`);
      }

      if (!options.quiet) {
        handleInfo(`Report written to ${options.output}`);
      }
    }

    if (useJson) {
      console.log(
        JSON.stringify({
          status: "ok",
          projects: allResults.map((r) => ({
            name: r.project,
            valid: r.result.isValid(),
            errors: r.result.errors.length,
            warnings: r.result.warnings.length,
          })),
          all_valid: allValid,
          output: options.output ? path.resolve(options.output) : undefined,
        })
      );
    }

    if (!allValid) {
      if (span) endSpan(span);
      process.exit(1);
    }

    if (!options.quiet) {
      handleSuccess(
        options.project
          ? `Project '${options.project}' validated successfully`
          : `All farm projects validated successfully`
      );
    }

    if (span) endSpan(span);
  } catch (error) {
    const useJson = options.format === "json" || isJson();
    if (useJson) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 2,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(2);
  }
}

/**
 * Pull latest changes from remote for farm projects
 */
export async function farmPullCommand(options: {
  project?: string;
  verbose?: boolean;
  format?: string;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.pull") : null;

  try {
    // Find farm root
    const { farmRoot, manifest } = await openFarm();

    // Determine which projects to pull
    let projectsToPull = manifest.getAllProjects();
    if (options.project) {
      const project = manifest.getProject(options.project);
      if (!project) {
        throw new Error(`Project '${options.project}' not found in farm`);
      }
      projectsToPull = [project];
    }

    if (projectsToPull.length === 0) {
      throw new Error("No projects found in farm");
    }

    const useJson = options.format === "json" || isJson();
    if (!useJson && !options.verbose) {
      handleInfo(`Pulling ${projectsToPull.length} project(s)...`);
    }

    // Create sync engine (model not needed for pull-only operations)
    const engine = new FarmSyncEngine(farmRoot);

    const results = [];

    // Pull each project
    for (const project of projectsToPull) {
      try {
        const commit = await engine.pullCodebase(await engine.mainCheckoutPath(project));

        results.push({
          project: project.name,
          status: "success",
          commit,
        });

        if (options.verbose && !useJson) {
          handleInfo(`  ✓ ${project.name}: ${commit.substring(0, 8)}`);
        }
      } catch (error) {
        results.push({
          project: project.name,
          status: "error",
          message: getErrorMessage(error),
        });

        if (!useJson) {
          console.error(ansis.red(`  ✗ ${project.name}: ${getErrorMessage(error)}`));
        }
      }
    }

    const allSucceeded = results.every((r) => r.status === "success");

    if (useJson) {
      console.log(
        JSON.stringify({
          status: allSucceeded ? "ok" : "partial",
          code: allSucceeded ? 0 : 1,
          projects: results,
          pulled: results.filter((r) => r.status === "success").length,
          failed: results.filter((r) => r.status === "error").length,
        })
      );
    } else if (allSucceeded) {
      handleSuccess(`Pulled ${projectsToPull.length} project(s) successfully`);
    } else {
      console.error(ansis.red(`Pull failed for some projects`));
    }

    if (span) endSpan(span);
    if (!allSucceeded) {
      process.exit(1);
    }
  } catch (error) {
    const useJson = options.format === "json" || isJson();
    if (useJson) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 2,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(2);
  }
}

/**
 * Sync farm projects with their models
 */
export async function farmSyncCommand(options: {
  project?: string;
  verbose?: boolean;
  dryRun?: boolean;
  force?: boolean;
  output?: string;
  format?: string;
  autoCommit?: boolean;
  concurrency?: string;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.sync") : null;

  try {
    // Find farm root
    const { farmRoot, manifest } = await openFarm();

    // Determine which projects to sync
    let projectsToSync = manifest.getAllProjects();
    if (options.project) {
      const project = manifest.getProject(options.project);
      if (!project) {
        throw new Error(`Project '${options.project}' not found in farm`);
      }
      projectsToSync = [project];
    }

    if (projectsToSync.length === 0) {
      throw new Error("No projects found in farm");
    }

    // Parse concurrency level
    const concurrency = options.concurrency ? Math.max(1, parseInt(options.concurrency, 10)) : 1;
    if (isNaN(concurrency)) {
      throw new Error("Concurrency must be a positive number");
    }

    // Reject incompatible option combination: --auto-commit with --concurrency > 1
    if (options.autoCommit && concurrency > 1) {
      throw new Error(
        "Cannot use --auto-commit with --concurrency > 1: concurrent git operations would cause race conditions. " +
        "Use --concurrency 1 for auto-commit, or remove --auto-commit for parallel processing."
      );
    }

    // Validate the report path before any project is synced so an unsupported extension
    // fails fast instead of silently writing nothing after the work is done
    if (options.output) {
      const outputExt = path.extname(options.output).toLowerCase();
      if (outputExt !== ".json") {
        throw new Error(`Unsupported output format: ${outputExt || "(no extension)"}. Use .json`);
      }
    }

    const useJson = options.format === "json" || isJson();
    if (!useJson && !options.verbose) {
      handleInfo(`Syncing ${projectsToSync.length} project(s) (concurrency: ${concurrency})...`);
    }

    const allResults: FarmSyncResultEntry[] = [];

    // Process projects with concurrency control
    const processSyncProject = async (project: typeof projectsToSync[0]) => {
      try {
        const modelPath = resolveFarmPath(farmRoot, project.model);

        if (!(await fileExists(modelPath))) {
          throw new Error(`Model folder not found for project '${project.name}' at ${modelPath}`);
        }

        // Load model using detached model layout
        let drModelPath = modelPath;
        const manifestPath = path.join(modelPath, "manifest.yaml");
        if (await fileExists(manifestPath)) {
          drModelPath = manifestPath;
        }

        try {
          const model = await Model.load(drModelPath);
          const engine = new FarmSyncEngine(farmRoot, model);

          const result = await engine.syncProject(project, {
            verbose: options.verbose,
            dryRun: options.dryRun,
            force: options.force,
          });

          const resultEntry: FarmSyncResultEntry = {
            project: project.name,
            status: result.status === "failed" ? "error" : result.status,
            change_count: result.changeCount,
            changeset_id: result.changesetId,
            files_changed: result.filesChanged,
            ambiguities: result.ambiguities.length,
            commits_before: result.commitsBefore,
            commits_after: result.commitsAfter,
          };

          // Auto-commit if requested and changes were staged
          if (options.autoCommit && result.changesetId && result.changeCount > 0 && !options.dryRun) {
            try {
              // The staging area lives under the model's project root (which, for a model
              // adopted from a codebase, is the codebase itself rather than farm.yaml's `model`)
              const stagingManager = new (await import("../core/staging-area.js")).StagingAreaManager(
                model.rootPath,
                model
              );
              const commitResult = await stagingManager.commit(model, result.changesetId);
              resultEntry.auto_committed = true;
              resultEntry.committed_changes = commitResult.committed;

              // Commit changes to the farm-level git repository if git is available
              // Scope git add to the project's model folder to avoid staging unrelated changes
              const gitCheck = checkGitRepository(farmRoot);

              if (gitCheck.error) {
                // The model changes are on disk; say so rather than silently skipping the commit
                resultEntry.git_committed = false;
                resultEntry.git_warning = uncommittedChangeWarning(
                  `Model '${project.model}'`,
                  farmRoot,
                  gitCheck.error
                );
                if (!useJson) {
                  handleWarning(`${project.name}: ${resultEntry.git_warning}`);
                }
              } else if (gitCheck.isRepo && !isInSameGitRepository(farmRoot, modelPath)) {
                // An adopted model outside the farm's repository (a sibling checkout, or a
                // nested clone with its own .git) cannot be committed from the farm root.
                // The changes are on disk in the model's own repository; say so.
                resultEntry.git_committed = false;
                resultEntry.git_warning =
                  `Model '${project.model}' is outside the farm git repository at ${farmRoot}: ` +
                  `the synced changes were saved but not committed. Commit them in the model's own repository.`;
                if (!useJson) {
                  handleWarning(`${project.name}: ${resultEntry.git_warning}`);
                }
              } else if (gitCheck.isRepo) {
                // Proceed with commit (handle commit errors independently)
                try {
                  execFileSync("git", ["add", project.model], { cwd: farmRoot, stdio: "pipe" });
                  execFileSync(
                    "git",
                    ["commit", "-m", `Sync: ${result.changesetId} - ${commitResult.committed} change(s)`],
                    { cwd: farmRoot, stdio: "pipe" }
                  );
                  resultEntry.git_committed = true;
                } catch (gitCommitError) {
                  // If there's nothing to commit (no changes), that's fine
                  if (!getErrorMessage(gitCommitError).includes("nothing to commit")) {
                    throw gitCommitError;
                  }
                  resultEntry.git_committed = true;
                }
              } else {
                resultEntry.git_committed = false;
              }

              if (options.verbose && !useJson) {
                handleInfo(`  Auto-committed: ${commitResult.committed} change(s)`);
              }
            } catch (commitError) {
              resultEntry.auto_committed = false;
              resultEntry.commit_error = getErrorMessage(commitError);
              resultEntry.status = "error";
              if (!useJson) {
                handleWarning(`${project.name}: auto-commit failed: ${getErrorMessage(commitError)}`);
              }
            }
          }

          allResults.push(resultEntry);

          if (options.verbose && !useJson) {
            handleInfo(`\nProject: ${project.name}`);
            const statusEmoji = result.status === "success" ? "✓" : result.status === "partial" ? "⚠" : "✗";
            const statusText = result.status === "success" ? "Success" : result.status === "partial" ? "Partial" : "Failed";
            handleInfo(`  Status: ${statusEmoji} ${statusText}`);
            handleInfo(`  Commits: ${result.commitsBefore}...${result.commitsAfter}`);
            handleInfo(
              `  Files changed: +${result.filesChanged.added.length} ~${result.filesChanged.modified.length} -${result.filesChanged.deleted.length}`
            );
            handleInfo(`  Staged changes: ${result.changeCount}`);
            if (result.changesetId) {
              handleInfo(`  Changeset: ${result.changesetId}`);
            }
            if (result.ambiguities.length > 0) {
              handleInfo(`  Ambiguities: ${result.ambiguities.length} (flagged for review)`);
            }
            for (const note of result.notes) {
              console.log(`    ${note}`);
            }
          }
        } catch (error) {
          allResults.push({
            project: project.name,
            status: "error",
            message: getErrorMessage(error),
          });

          if (!useJson) {
            console.error(ansis.red(`✗ ${project.name}: ${getErrorMessage(error)}`));
          }
        }
      } catch (error) {
        allResults.push({
          project: project.name,
          status: "error",
          message: getErrorMessage(error),
        });

        if (!useJson) {
          console.error(ansis.red(`✗ ${project.name}: ${getErrorMessage(error)}`));
        }
      }
    };

    // Process with concurrency control
    if (concurrency === 1) {
      // Sequential processing
      for (const project of projectsToSync) {
        await processSyncProject(project);
      }
    } else {
      // Parallel processing with limited concurrency
      const queue = [...projectsToSync];
      const active: Promise<void>[] = [];

      while (queue.length > 0 || active.length > 0) {
        while (active.length < concurrency && queue.length > 0) {
          const project = queue.shift()!;
          const promise = processSyncProject(project);
          const wrapped = promise.then(() => {
            const idx = active.indexOf(wrapped);
            if (idx !== -1) {
              active.splice(idx, 1);
            }
          });
          active.push(wrapped);
        }

        if (active.length > 0) {
          await Promise.race(active);
        }
      }
    }

    const allSucceeded = allResults.every((r) => r.status === "success" || r.status === "partial");

    if (useJson) {
      console.log(
        JSON.stringify({
          status: allSucceeded ? "ok" : "error",
          code: allSucceeded ? 0 : 1,
          projects: allResults,
          synced: allResults.filter((r) => r.status === "success").length,
          failed: allResults.filter((r) => r.status === "error").length,
          auto_committed: options.autoCommit,
        })
      );
    } else {
      const synced = allResults.filter((r) => r.status === "success").length;
      if (allSucceeded) {
        handleSuccess(`Synced ${synced}/${projectsToSync.length} project(s)`);
      }
    }

    // Write output file if requested (extension validated above; only .json is supported)
    if (options.output) {
      const { writeFile } = await import("../utils/file-io.js");
      await writeFile(
        options.output,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            farm_root: farmRoot,
            projects: allResults,
          },
          null,
          2
        )
      );
      if (!useJson) {
        handleInfo(`Report written to ${options.output}`);
      }
    }

    if (span) endSpan(span);
    if (!allSucceeded) {
      process.exit(1);
    }
  } catch (error) {
    const useJson = options.format === "json" || isJson();
    if (useJson) {
      console.log(
        JSON.stringify({
          status: "error",
          code: 2,
          message: getErrorMessage(error),
        })
      );
    } else {
      console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    }
    if (span) endSpan(span);
    process.exit(2);
  }
}

/**
 * Register farm commands with the CLI
 */
export function farmCommands(program: Command): void {
  const farmGroup = program.command("farm").description("Manage model farms");

  farmGroup
    .command("init")
    .description("Initialize a new farm")
    .option("--name <name>", "Farm name")
    .option("--platform-view", "Enable platform-view support for cross-model aggregation")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm init
  $ dr farm init --name "My Architecture Farm"
  $ dr farm init --platform-view
  $ dr farm init --format json

Notes:
  When using --platform-view, create a project named exactly "platform-view" to serve as
  the aggregation hub. When validating this project with 'dr farm validate --project platform-view',
  the CLI will automatically resolve cross-model references from all farm projects.`
    )
    .action(async (options) => {
      await farmInitCommand(options);
    });

  farmGroup
    .command("add [name]")
    .description(
      "Add a project to the farm in use (a folder farm found upward, else the user farm ~/.config/dr/farm.yaml)"
    )
    .option("--remote <url>", "Git remote URL to clone")
    .option(
      "--codebase <path>",
      "Path to codebase folder, relative to the farm root (defaults to project name; may point outside the farm root unless --remote is used)"
    )
    .option(
      "--model <path>",
      "Register an existing model at this path (relative to the farm root) instead of detecting or scaffolding one"
    )
    .option(
      "--new-model",
      "Always scaffold a fresh <name>-model, even when the codebase already carries a model"
    )
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm add my-service
  $ dr farm add my-service --remote https://github.com/org/my-service.git
  $ dr farm add my-service --codebase ./services/my-service
  $ dr farm add my-service --codebase ../my-service   # sibling checkout outside the farm root
  $ dr farm add my-service --codebase ../my-service --new-model
  $ dr farm add my-service --model ../shared-models/my-service
  $ dr farm add my-service --format json
  $ dr farm add --codebase ~/work/my-service   # name derived from the main checkout's folder

Worktrees:
  A codebase in git is one project per repository. A path inside a linked worktree resolves to
  the repository's main checkout: adding it finds the project that already holds the repository,
  or adds the repository under its main checkout. Checkouts are discovered from git, never added.

Naming:
  Without <name>, the project is named after the main checkout's folder, in kebab case. A name
  another repository already holds is refused; pass an explicit <name> instead.

Model detection:
  If the codebase already holds a model (documentation-robotics/model/manifest.yaml, model/manifest.yaml
  or manifest.yaml at the codebase path itself), that model is adopted in place and nothing is
  created; farm.yaml records its path (which may lie outside the farm root). Use --new-model to
  scaffold a separate <name>-model regardless, or --model to point at a model explicitly.`
    )
    .action(async (name, options) => {
      await farmAddCommand(name, options);
    });

  farmGroup
    .command("migrate")
    .description("Move a dr-farm-v1 farm.yaml to dr-farm-v2 (preview by default; --apply writes it)")
    .option("--apply", "Write the migrated farm.yaml")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
dr-farm-v1 has one entry per checkout; dr-farm-v2 has one project per git repository, and
checkouts (the main worktree and every linked worktree) are discovered from git.

  1. Entries are grouped by repository (the git common directory of each entry's source).
  2. The entry whose source is the main checkout names the project; if none is, the main
     checkout's folder name (kebab case) does.
  3. Every other entry in the group is one of that project's checkouts: its name is dropped,
     not kept as an alias. The preview lists dropped names so scripts can be fixed first.
  4. branch is dropped. A second run changes nothing.

Examples:
  $ dr farm migrate
  $ dr farm migrate --apply
  $ dr farm migrate --format json`
    )
    .action(async (options) => {
      await farmMigrateCommand(options);
    });

  farmGroup
    .command("remove <name>")
    .description("Remove a project from the farm")
    .option("--delete-model", "Also delete the model folder")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm remove my-service
  $ dr farm remove my-service --delete-model
  $ dr farm remove my-service --format json`
    )
    .action(async (name, options) => {
      await farmRemoveCommand(name, options);
    });

  farmGroup
    .command("status")
    .description("Show farm status and registered projects")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm status
  $ dr farm status --format json`
    )
    .action(async (options) => {
      await farmStatusCommand(options);
    });

  farmGroup
    .command("validate")
    .description("Validate farm projects using composed scope (cross-model references)")
    .option("--project <name>", "Validate only a specific project (default: all)")
    .option("--verbose", "Show verbose validation output")
    .option("--quiet", "Suppress success messages")
    .option("--output <path>", "Export validation report to file (JSON/Markdown)")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm validate
  $ dr farm validate --project my-service
  $ dr farm validate --verbose
  $ dr farm validate --format json
  $ dr farm validate --output report.json

Notes:
  For platform-view aggregation: Use 'dr farm validate --project platform-view' to validate
  a platform-view project. The project name must be exactly 'platform-view' and the farm
  must have platform-view enabled (set during 'dr farm init --platform-view').`
    )
    .action(async (options) => {
      await farmValidateCommand(options);
    });

  farmGroup
    .command("pull")
    .description("Pull latest changes from remote for farm projects")
    .option("--project <name>", "Pull only a specific project (default: all)")
    .option("--verbose", "Show verbose output")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm pull
  $ dr farm pull --project my-service
  $ dr farm pull --verbose
  $ dr farm pull --format json`
    )
    .action(async (options) => {
      await farmPullCommand(options);
    });

  farmGroup
    .command("sync")
    .description("Sync farm projects with their models (generates staged changesets)")
    .option("--project <name>", "Sync only a specific project (default: all)")
    .option("--verbose", "Show verbose output")
    .option("--dry-run", "Preview without creating changesets")
    .option("--force", "Proceed despite ambiguous file-to-element mappings")
    .option("--output <path>", "Export sync report to file (.json only)")
    .option("--format <format>", "Output format: text, json", "text")
    .option("--auto-commit", "Automatically commit changes (bypasses staged review)")
    .option("--concurrency <n>", "Process multiple projects in parallel (default: 1)", "1")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm sync
  $ dr farm sync --project my-service
  $ dr farm sync --verbose --output sync-report.json
  $ dr farm sync --dry-run
  $ dr farm sync --format json --auto-commit
  $ dr farm sync --concurrency 4

Automation (cron/CI):
  $ dr farm sync --format json --auto-commit --output sync-report.json
  $ dr farm sync --format json --concurrency 4 --output sync-report.json

Note: --auto-commit and --concurrency > 1 cannot be used together (race condition risk).
Use --concurrency 1 (default) with --auto-commit for automated syncs.`
    )
    .action(async (options) => {
      await farmSyncCommand(options);
    });

  farmGroup.showSuggestionAfterError();
}
