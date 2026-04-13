/**
 * Reports subcommands for managing the maintained set of markdown layer reports
 */

import { Command } from "commander";
import ansis from "ansis";
import * as fs from "fs/promises";
import * as path from "path";
import { Model } from "../core/model.js";
import { ModelReportOrchestrator } from "../reports/model-report-orchestrator.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getErrorMessage } from "../utils/errors.js";

export function reportsCommands(parent: Command): void {
  parent
    .command("regenerate")
    .description("Delete existing layer reports and regenerate all 12 markdown reports")
    .addHelpText(
      "after",
      `
Examples:
  $ dr reports regenerate    # Delete existing reports and regenerate all 12 layer reports`
    )
    .action(async () => {
      await reportsRegenerateCommand();
    });
}

/**
 * Delete existing layer reports and regenerate all 12 markdown reports.
 */
export async function reportsRegenerateCommand(): Promise<void> {
  try {
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      console.error(ansis.red("Error: No DR project found"));
      console.error(ansis.dim('Run "dr init" to create a new project'));
      process.exit(1);
    }

    await regenerateLayerReports(projectRoot);
  } catch (error) {
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    process.exit(1);
  }
}

/**
 * Delete existing reports directory and regenerate all 12 layer reports.
 * Exported for use in the upgrade command.
 */
export async function regenerateLayerReports(projectRoot: string): Promise<void> {
  const reportDir = path.join(projectRoot, "documentation-robotics", "reports");

  // Remove the entire reports directory so stale reports from removed/renamed layers don't linger.
  // force: true means no error if the directory doesn't exist yet.
  // ModelReportOrchestrator.regenerateAll() recreates the directory before writing.
  console.log(ansis.dim("Removing existing reports..."));
  await fs.rm(reportDir, { recursive: true, force: true });

  // Load model and regenerate all reports
  console.log(ansis.dim("Loading model..."));
  const model = await Model.load(projectRoot);

  const orchestrator = new ModelReportOrchestrator(model, projectRoot);
  console.log(ansis.dim("Generating 12 layer reports..."));
  await orchestrator.regenerateAll();

  console.log(ansis.green("✓ All 12 layer reports regenerated"));
  console.log(ansis.dim("  Reports written to: documentation-robotics/reports/"));
}

/**
 * Check whether any layer reports exist in the reports directory.
 * Returns false if the directory doesn't exist or contains no .md files.
 */
export async function hasLayerReports(projectRoot: string): Promise<boolean> {
  const reportDir = path.join(projectRoot, "documentation-robotics", "reports");
  try {
    const entries = await fs.readdir(reportDir);
    return entries.some((f) => f.endsWith(".md"));
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return false;
    throw error;
  }
}
