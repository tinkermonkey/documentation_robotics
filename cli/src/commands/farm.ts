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

  farmGroup.showSuggestionAfterError();
}
