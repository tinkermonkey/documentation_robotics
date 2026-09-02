/**
 * Farm Commands - Manage model farms and project registration
 */

import ansis from "ansis";
import { Command } from "commander";
import path from "path";
import { FarmManifest } from "../core/farm-manifest.js";
import { findFarmRoot } from "../utils/project-paths.js";
import { fileExists, ensureDir } from "../utils/file-io.js";
import { execSync } from "child_process";
import * as prompts from "@clack/prompts";
import { getErrorMessage, handleSuccess, handleInfo } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { Model } from "../core/model.js";
import { ComposedReferenceValidator } from "../validators/composed-reference-validator.js";
import { ValidationFormatter } from "../validators/validation-formatter.js";
import { FarmSyncEngine } from "../core/farm-sync-engine.js";

/**
 * Initialize a new farm
 */
export async function farmInitCommand(options: {
  name?: string;
  description?: string;
}): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.init") : null;

  try {
    const farmPath = process.cwd();
    const farmYamlPath = path.join(farmPath, "farm.yaml");

    // Check if farm.yaml already exists
    if (await fileExists(farmYamlPath)) {
      const message = "Farm already initialized in this directory";
      if (isJson()) {
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

    // Create manifest
    const manifest = FarmManifest.create(farmName);
    await manifest.save(farmYamlPath);

    if (isJson()) {
      console.log(JSON.stringify({ status: "ok", farmPath, farmName }));
    } else {
      handleSuccess(
        `Farm initialized: ${ansis.bold(farmName)}\n  Location: ${farmPath}`
      );
    }

    if (span) endSpan(span);
  } catch (error) {
    if (isJson()) {
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
  }
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.add", { "project.name": name }) : null;

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

      if (!isJson()) {
        handleInfo(`Cloning ${options.remote} to ${codebasePath}...`);
      }

      try {
        execSync(`git clone ${options.remote} "${codebaseFullPath}"`, {
          stdio: isJson() ? "pipe" : "inherit",
        });
      } catch (error) {
        throw new Error(`Failed to clone repository: ${getErrorMessage(error)}`);
      }
    }

    // Create model folder
    const modelFolder = `${name}-model`;
    const modelFullPath = path.join(farmRoot, modelFolder);

    if (!(await fileExists(modelFullPath))) {
      await ensureDir(modelFullPath);
      if (!isJson()) {
        handleInfo(`Created model folder: ${modelFolder}`);
      }
    }

    // Add project to manifest
    manifest.addProject(name, {
      name,
      codebase_path: codebasePath,
      model_folder: modelFolder,
      remote_url: options.remote,
    });

    await manifest.save(farmYamlPath);

    if (isJson()) {
      console.log(
        JSON.stringify({
          status: "ok",
          project: name,
          codebase_path: codebasePath,
          model_folder: modelFolder,
        })
      );
    } else {
      handleSuccess(
        `Project added to farm: ${ansis.bold(name)}\n  Codebase: ${codebasePath}\n  Model: ${modelFolder}`
      );
    }

    if (span) endSpan(span);
  } catch (error) {
    if (isJson()) {
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
  }
): Promise<void> {
  const span = isTelemetryEnabled ? startSpan("farm.remove", { "project.name": name }) : null;

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
      const modelFullPath = path.join(farmRoot, project.model_folder);
      if (await fileExists(modelFullPath)) {
        try {
          // Use rm -rf for simplicity; in production, might use fs.rmdir with recursive: true
          execSync(`rm -rf "${modelFullPath}"`, {
            stdio: isJson() ? "pipe" : "inherit",
          });
          if (!isJson()) {
            handleInfo(`Deleted model folder: ${project.model_folder}`);
          }
        } catch (error) {
          throw new Error(`Failed to delete model folder: ${getErrorMessage(error)}`);
        }
      }
    }

    // Remove project from manifest
    manifest.removeProject(name);
    await manifest.save(farmYamlPath);

    if (isJson()) {
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
    if (isJson()) {
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
export async function farmStatusCommand(): Promise<void> {
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

    if (isJson()) {
      console.log(
        JSON.stringify({
          status: "ok",
          farm: {
            name: manifest.name,
            path: farmRoot,
            created: manifest.created,
            modified: manifest.modified,
          },
          projects: projects.map((p) => ({
            name: p.name,
            codebase_path: p.codebase_path,
            model_folder: p.model_folder,
            remote_url: p.remote_url,
          })),
          project_count: projects.length,
        })
      );
    } else {
      console.log(ansis.bold(`Farm: ${manifest.name}`));
      console.log(`Location: ${farmRoot}`);
      console.log(`Projects: ${projects.length}\n`);

      if (projects.length === 0) {
        console.log(ansis.dim("No projects registered yet."));
      } else {
        projects.forEach((project) => {
          console.log(`  ${ansis.cyan(project.name)}`);
          console.log(`    Codebase: ${project.codebase_path}`);
          console.log(`    Model:    ${project.model_folder}`);
          if (project.remote_url) {
            console.log(`    Remote:   ${project.remote_url}`);
          }
        });
      }
    }

    if (span) endSpan(span);
  } catch (error) {
    if (isJson()) {
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
 * Validate a farm project or all projects using composed scope
 */
export async function farmValidateCommand(options: {
  project?: string;
  verbose?: boolean;
  quiet?: boolean;
  output?: string;
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

    // Determine which projects to validate
    let projectsToValidate = farmManifest.getAllProjects();
    if (options.project) {
      const project = farmManifest.getProject(options.project);
      if (!project) {
        throw new Error(`Project '${options.project}' not found in farm`);
      }
      projectsToValidate = [project];
    }

    if (projectsToValidate.length === 0) {
      throw new Error("No projects found in farm");
    }

    // Create composed validator from farm
    const composedValidator = await ComposedReferenceValidator.fromFarm(farmRoot);

    if (isJson()) {
      console.log(JSON.stringify({ status: "validating", projects: projectsToValidate.length }));
    } else if (!options.quiet) {
      if (options.project) {
        handleInfo(`Validating project '${options.project}' with farm-aware references...`);
      } else {
        handleInfo(`Validating ${projectsToValidate.length} farm project(s) with farm-aware references...`);
      }
    }

    const allResults = [];
    const reportData = [];

    // Validate each project
    for (const project of projectsToValidate) {
      const modelPath = path.join(farmRoot, project.model_folder);

      // Check if model folder exists
      if (!(await fileExists(modelPath))) {
        const error = `Model folder not found for project '${project.name}' at ${modelPath}`;
        if (isJson()) {
          console.log(
            JSON.stringify({
              status: "error",
              code: 1,
              project: project.name,
              message: error,
            })
          );
        } else {
          console.error(ansis.red(`Error: ${error}`));
        }
        if (span) endSpan(span);
        process.exit(1);
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

        // Validate using composed reference validator
        const result = await composedValidator.validateModel(model);

        allResults.push({ project: project.name, result });

        // Format and display validation output
        const formatted = ValidationFormatter.format(result, model, {
          verbose: options.verbose,
          quiet: options.quiet,
        });

        // Collect report data for output file
        reportData.push({
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
        });

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
          projects: reportData.map((r) => ({
            project: r.project,
            valid: r.valid,
            errors: r.errors,
            warnings: r.warnings,
          })),
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

    if (isJson()) {
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
      throw new Error("Farm validation failed");
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
    if (isJson()) {
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
 * Pull latest changes from remote for farm projects
 */
export async function farmPullCommand(options: {
  project?: string;
  verbose?: boolean;
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

    if (!isJson() && !options.verbose) {
      handleInfo(`Pulling ${projectsToPull.length} project(s)...`);
    }

    // Create sync engine (model not needed for pull)
    const mockModel = {
      layers: new Map(),
      relationships: { find: () => [] },
    } as any;
    const engine = new FarmSyncEngine(farmRoot, mockModel);

    const results = [];

    // Pull each project
    for (const project of projectsToPull) {
      try {
        const commit = await engine.pullCodebase(project.codebase_path);

        results.push({
          project: project.name,
          status: "success",
          commit,
        });

        if (options.verbose && !isJson()) {
          handleInfo(`  ✓ ${project.name}: ${commit.substring(0, 8)}`);
        }
      } catch (error) {
        results.push({
          project: project.name,
          status: "error",
          message: getErrorMessage(error),
        });

        if (!isJson()) {
          console.error(ansis.red(`  ✗ ${project.name}: ${getErrorMessage(error)}`));
        }
      }
    }

    const allSucceeded = results.every((r) => r.status === "success");

    if (isJson()) {
      console.log(
        JSON.stringify({
          status: allSucceeded ? "ok" : "partial",
          projects: results,
          pulled: results.filter((r) => r.status === "success").length,
          failed: results.filter((r) => r.status === "error").length,
        })
      );
    } else if (allSucceeded) {
      handleSuccess(`Pulled ${projectsToPull.length} project(s) successfully`);
    } else {
      throw new Error(`Pull failed for some projects`);
    }

    if (span) endSpan(span);
  } catch (error) {
    if (isJson()) {
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
 * Sync farm projects with their models
 */
export async function farmSyncCommand(options: {
  project?: string;
  verbose?: boolean;
  dryRun?: boolean;
  force?: boolean;
  output?: string;
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

    if (!isJson() && !options.verbose) {
      handleInfo(`Syncing ${projectsToSync.length} project(s)...`);
    }

    const allResults = [];

    // Sync each project
    for (const project of projectsToSync) {
      try {
        const modelPath = path.join(farmRoot, project.model_folder);

        if (!(await fileExists(modelPath))) {
          throw new Error(`Model folder not found for project '${project.name}' at ${modelPath}`);
        }

        // Load model using detached model layout
        const originalDRModelPath = process.env.DR_MODEL_PATH;
        let drModelPath = modelPath;
        const manifestPath = path.join(modelPath, "manifest.yaml");
        if (await fileExists(manifestPath)) {
          drModelPath = manifestPath;
        }

        process.env.DR_MODEL_PATH = drModelPath;

        try {
          const model = await Model.load();
          const engine = new FarmSyncEngine(farmRoot, model);

          const result = await engine.syncProject(project, {
            verbose: options.verbose,
            dryRun: options.dryRun,
            force: options.force,
          });

          allResults.push({
            project: project.name,
            status: result.success ? "success" : "failed",
            changeCount: result.changeCount,
            changesetId: result.changesetId,
            filesChanged: result.filesChanged,
            ambiguities: result.ambiguities.length,
            commitsBefore: result.commitsBefore,
            commitsAfter: result.commitsAfter,
          });

          if (options.verbose && !isJson()) {
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
        } finally {
          // Restore original DR_MODEL_PATH
          if (originalDRModelPath !== undefined) {
            process.env.DR_MODEL_PATH = originalDRModelPath;
          } else {
            delete process.env.DR_MODEL_PATH;
          }
        }
      } catch (error) {
        allResults.push({
          project: project.name,
          status: "error",
          message: getErrorMessage(error),
        });

        if (!isJson()) {
          console.error(ansis.red(`✗ ${project.name}: ${getErrorMessage(error)}`));
        }
      }
    }

    const allSucceeded = allResults.every((r) => r.status === "success" || r.status === "partial");

    if (isJson()) {
      console.log(
        JSON.stringify({
          status: allSucceeded ? "ok" : "error",
          projects: allResults,
          synced: allResults.filter((r) => r.status === "success").length,
          failed: allResults.filter((r) => r.status === "error").length,
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
  } catch (error) {
    if (isJson()) {
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
 * Register farm commands with the CLI
 */
export function farmCommands(program: Command): void {
  const farmGroup = program.command("farm").description("Manage model farms");

  farmGroup
    .command("init")
    .description("Initialize a new farm")
    .option("--name <name>", "Farm name")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm init
  $ dr farm init --name "My Architecture Farm"`
    )
    .action(async (options) => {
      await farmInitCommand(options);
    });

  farmGroup
    .command("add <name>")
    .description("Add a project to the farm")
    .option("--remote <url>", "Git remote URL to clone")
    .option("--codebase <path>", "Path to codebase folder (defaults to project name)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm add my-service
  $ dr farm add my-service --remote https://github.com/org/my-service.git
  $ dr farm add my-service --codebase ./services/my-service`
    )
    .action(async (name, options) => {
      await farmAddCommand(name, options);
    });

  farmGroup
    .command("remove <name>")
    .description("Remove a project from the farm")
    .option("--delete-model", "Also delete the model folder")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm remove my-service
  $ dr farm remove my-service --delete-model`
    )
    .action(async (name, options) => {
      await farmRemoveCommand(name, options);
    });

  farmGroup
    .command("status")
    .description("Show farm status and registered projects")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm status`
    )
    .action(async () => {
      await farmStatusCommand();
    });

  farmGroup
    .command("validate")
    .description("Validate farm projects using composed scope (cross-model references)")
    .option("--project <name>", "Validate only a specific project (default: all)")
    .option("--verbose", "Show verbose validation output")
    .option("--quiet", "Suppress success messages")
    .option("--output <path>", "Export validation report to file (JSON/Markdown)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm validate
  $ dr farm validate --project my-service
  $ dr farm validate --verbose
  $ dr farm validate --output report.json`
    )
    .action(async (options) => {
      await farmValidateCommand(options);
    });

  farmGroup
    .command("pull")
    .description("Pull latest changes from remote for farm projects")
    .option("--project <name>", "Pull only a specific project (default: all)")
    .option("--verbose", "Show verbose output")
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm pull
  $ dr farm pull --project my-service
  $ dr farm pull --verbose`
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
    .addHelpText(
      "after",
      `
Examples:
  $ dr farm sync
  $ dr farm sync --project my-service
  $ dr farm sync --verbose --output sync-report.json
  $ dr farm sync --dry-run`
    )
    .action(async (options) => {
      await farmSyncCommand(options);
    });

  farmGroup.showSuggestionAfterError();
}
