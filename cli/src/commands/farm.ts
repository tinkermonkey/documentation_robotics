/**
 * Farm Commands - Manage model farms and project registration
 */

import ansis from "ansis";
import { Command } from "commander";
import path from "path";
import { FarmManifest } from "../core/farm-manifest.js";
import { findFarmRoot } from "../utils/project-paths.js";
import { fileExists } from "../utils/file-io.js";
import { execSync } from "child_process";
import * as prompts from "@clack/prompts";
import { getErrorMessage, handleSuccess, handleInfo } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { Model } from "../core/model.js";
import { ComposedReferenceValidator } from "../validators/composed-reference-validator.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";
import { FarmSyncEngine } from "../core/farm-sync-engine.js";

interface FarmSyncResultEntry {
  project: string;
  status: "success" | "error" | "partial";
  changeCount?: number;
  changesetId?: string;
  filesChanged?: { added: string[]; modified: string[]; deleted: string[] };
  ambiguities?: number;
  commitsBefore?: string;
  commitsAfter?: string;
  autoCommitted?: boolean;
  committedChanges?: number;
  commitError?: string;
  message?: string;
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
  name: string,
  options: {
    remote?: string;
    codebase?: string;
    format?: string;
  }
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.add", { "project.name": name }) : null;
  const useJson = options.format === "json" || isJson();

  try {
    // Find farm root
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory. Run 'dr farm init' first.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

    // Check if project already exists
    if (manifest.getProject(name)) {
      throw new Error(`Project '${name}' already exists in this farm`);
    }

    // Determine codebase path
    let codebasePath = options.codebase || name;

    // Clone if remote URL provided
    if (options.remote) {
      const codebaseFullPath = path.join(farmRoot, codebasePath);
      if (await fileExists(codebaseFullPath)) {
        throw new Error(`Codebase directory '${codebasePath}' already exists`);
      }

      if (!useJson) {
        handleInfo(`Cloning ${options.remote} to ${codebasePath}...`);
      }

      try {
        execSync(`git clone ${options.remote} "${codebaseFullPath}"`, {
          stdio: useJson ? "pipe" : "inherit",
        });
      } catch (error) {
        throw new Error(`Failed to clone repository: ${getErrorMessage(error)}`);
      }
    }

    // Create and scaffold model folder
    const modelFolder = `${name}-model`;
    const modelFullPath = path.join(farmRoot, modelFolder);

    if (!(await fileExists(modelFullPath))) {
      // Initialize model with manifest and layer structure
      await Model.init(
        modelFullPath,
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

      // Initialize git repository for the model
      try {
        execSync("git init", { cwd: modelFullPath, stdio: useJson ? "pipe" : "inherit" });
        execSync("git config user.email 'dr-farm@localhost'", {
          cwd: modelFullPath,
          stdio: "pipe",
        });
        execSync("git config user.name 'DR Farm'", {
          cwd: modelFullPath,
          stdio: "pipe",
        });

        // Add all initial files and commit
        execSync("git add .", { cwd: modelFullPath, stdio: "pipe" });
        execSync("git commit -m 'Initialize model scaffold'", {
          cwd: modelFullPath,
          stdio: useJson ? "pipe" : "inherit",
        });
      } catch (gitError) {
        throw new Error(
          `Failed to initialize model git repository: ${getErrorMessage(gitError)}`
        );
      }

      if (!useJson) {
        handleInfo(`Created and initialized model folder: ${modelFolder}`);
      }
    }

    // Add project to manifest
    manifest.addProject(name, {
      name,
      source: codebasePath,
      model: modelFolder,
      remote: options.remote,
    });

    await manifest.save(farmYamlPath);

    if (useJson) {
      console.log(
        JSON.stringify({
          status: "ok",
          project: name,
          source: codebasePath,
          model: modelFolder,
        })
      );
    } else {
      handleSuccess(
        `Project added to farm: ${ansis.bold(name)}\n  Codebase: ${codebasePath}\n  Model: ${modelFolder}`
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
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

    // Check if project exists
    const project = manifest.getProject(name);
    if (!project) {
      throw new Error(`Project '${name}' not found in farm`);
    }

    // Remove model folder if requested
    if (options.deleteModel) {
      const modelFullPath = path.join(farmRoot, project.model);
      if (await fileExists(modelFullPath)) {
        try {
          // Use rm -rf for simplicity; in production, might use fs.rmdir with recursive: true
          execSync(`rm -rf "${modelFullPath}"`, {
            stdio: useJson ? "pipe" : "inherit",
          });
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

    if (useJson) {
      console.log(
        JSON.stringify({
          status: "ok",
          project: name,
          modelDeleted: options.deleteModel ?? false,
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
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

    const projects = manifest.getAllProjects();
    const engine = new FarmSyncEngine(farmRoot);

    // Compute pending changes using lightweight commit comparison
    const projectsWithStatus = await Promise.all(
      projects.map(async (p) => {
        try {
          const syncStatePath = path.join(farmRoot, p.model, ".farm-sync.yaml");
          const syncState = await (await import("../core/farm-sync-state.js")).FarmSyncState.loadOrCreate(
            syncStatePath,
            p.name
          );

          // Use lightweight commit comparison instead of full diff
          const currentCommit = await engine.getCurrentCommit(p.source);
          const lastSyncCommit = syncState.lastSyncCommit;
          const hasPendingChanges = !!(lastSyncCommit && lastSyncCommit !== currentCommit);

          return {
            name: p.name,
            source: p.source,
            model: p.model,
            remote: p.remote,
            lastSyncCommit: lastSyncCommit,
            currentCommit: currentCommit,
            hasPendingChanges: hasPendingChanges,
          };
        } catch {
          // If sync state doesn't exist or error reading commits, treat as no sync yet
          return {
            name: p.name,
            source: p.source,
            model: p.model,
            remote: p.remote,
            lastSyncCommit: undefined,
            currentCommit: undefined,
            hasPendingChanges: false,
          };
        }
      })
    );

    if (options.format === "json") {
      console.log(
        JSON.stringify({
          status: "ok",
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
          console.log(`    Codebase: ${project.source}`);
          console.log(`    Model:    ${project.model}`);
          if (project.remote) {
            console.log(`    Remote:   ${project.remote}`);
          }
          if (project.hasPendingChanges) {
            console.log(`    Status:   ${ansis.yellow("⚠ Pending changes")}`);
          } else if (project.lastSyncCommit) {
            console.log(`    Status:   ${ansis.green("✓ Up to date")}`);
          } else {
            console.log(`    Status:   ${ansis.dim("Not synced yet")}`);
          }
        });
      }
    }

    if (span) endSpan(span);
  } catch (error) {
    if (options.format === "json") {
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
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory. Run 'dr farm init' first.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const farmManifest = await FarmManifest.load(farmYamlPath);
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
      const modelPath = path.join(farmRoot, project.model);

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

      // Load the model using DR_MODEL_PATH to support detached model layouts
      // Save current DR_MODEL_PATH if it exists
      const originalDRModelPath = process.env.DR_MODEL_PATH;

      // For detached models, check if manifest.yaml exists directly in the model folder.
      // If so, set DR_MODEL_PATH to point to the manifest.yaml file so Model.load()
      // can find it correctly.
      let drModelPath = modelPath;
      const manifestPath = path.join(modelPath, "manifest.yaml");
      if (await fileExists(manifestPath)) {
        // Point directly to the manifest.yaml file
        drModelPath = manifestPath;
      }

      process.env.DR_MODEL_PATH = drModelPath;

      try {
        const model = await Model.load();

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
      } finally {
        // Restore original DR_MODEL_PATH
        if (originalDRModelPath !== undefined) {
          process.env.DR_MODEL_PATH = originalDRModelPath;
        } else {
          delete process.env.DR_MODEL_PATH;
        }
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
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory. Run 'dr farm init' first.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

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
        const commit = await engine.pullCodebase(project.source);

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
    const farmRoot = await findFarmRoot();
    if (!farmRoot) {
      throw new Error("Not in a farm directory. Run 'dr farm init' first.");
    }

    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

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

    const useJson = options.format === "json" || isJson();
    if (!useJson && !options.verbose) {
      handleInfo(`Syncing ${projectsToSync.length} project(s) (concurrency: ${concurrency})...`);
    }

    const allResults: FarmSyncResultEntry[] = [];

    // Process projects with concurrency control
    const processSyncProject = async (project: typeof projectsToSync[0]) => {
      try {
        const modelPath = path.join(farmRoot, project.model);

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
            status: result.success ? "success" : "error",
            changeCount: result.changeCount,
            changesetId: result.changesetId,
            filesChanged: result.filesChanged,
            ambiguities: result.ambiguities.length,
            commitsBefore: result.commitsBefore,
            commitsAfter: result.commitsAfter,
          };

          // Auto-commit if requested and changes were staged
          if (options.autoCommit && result.changesetId && result.changeCount > 0 && !options.dryRun) {
            try {
              const stagingManager = new (await import("../core/staging-area.js")).StagingAreaManager(
                farmRoot,
                model
              );
              const commitResult = await stagingManager.commit(model, result.changesetId);
              resultEntry.autoCommitted = true;
              resultEntry.committedChanges = commitResult.committed;

              // Also commit changes to the farm's model git repository
              try {
                const modelPath = path.join(farmRoot, project.model);
                execSync("git add .", { cwd: modelPath, stdio: "pipe" });
                execSync(
                  `git commit -m "Sync: ${result.changesetId} - ${commitResult.committed} change(s)"`,
                  { cwd: modelPath, stdio: "pipe" }
                );
              } catch (gitCommitError) {
                // If there's nothing to commit (no changes), that's fine
                if (!getErrorMessage(gitCommitError).includes("nothing to commit")) {
                  throw gitCommitError;
                }
              }

              if (options.verbose && !useJson) {
                handleInfo(`  Auto-committed: ${commitResult.committed} change(s)`);
              }
            } catch (commitError) {
              resultEntry.autoCommitted = false;
              resultEntry.commitError = getErrorMessage(commitError);
              if (options.verbose && !useJson) {
                handleInfo(`  Auto-commit failed: ${getErrorMessage(commitError)}`);
              }
            }
          }

          allResults.push(resultEntry);

          if (options.verbose && !useJson) {
            handleInfo(`\nProject: ${project.name}`);
            handleInfo(`  Status: ${result.success ? "✓ Success" : "✗ Failed"}`);
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
          active.push(
            promise.then(() => {
              active.splice(active.indexOf(promise), 1);
            })
          );
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
          autoCommitted: options.autoCommit,
        })
      );
    } else {
      const synced = allResults.filter((r) => r.status === "success").length;
      if (allSucceeded) {
        handleSuccess(`Synced ${synced}/${projectsToSync.length} project(s)`);
      }
    }

    // Write output file if requested
    if (options.output) {
      const { writeFile } = await import("../utils/file-io.js");
      const outputExt = path.extname(options.output).toLowerCase();

      if (outputExt === ".json") {
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
    .command("add <name>")
    .description("Add a project to the farm")
    .option("--remote <url>", "Git remote URL to clone")
    .option("--codebase <path>", "Path to codebase folder (defaults to project name)")
    .option("--format <format>", "Output format: text, json", "text")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm add my-service
  $ dr farm add my-service --remote https://github.com/org/my-service.git
  $ dr farm add my-service --codebase ./services/my-service
  $ dr farm add my-service --format json`
    )
    .action(async (name, options) => {
      await farmAddCommand(name, options);
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
    .option("--output <path>", "Export sync report to file (JSON)")
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
  $ dr farm sync --format json --auto-commit --concurrency 4 --output sync-report.json`
    )
    .action(async (options) => {
      await farmSyncCommand(options);
    });

  farmGroup.showSuggestionAfterError();
}
