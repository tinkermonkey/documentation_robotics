/**
 * GitHub Copilot Integration Manager
 *
 * Manages installation, updates, and removal of GitHub Copilot integration files.
 * Extends the base integration manager with Copilot-specific configuration and behavior.
 *
 * Handles 2 component types:
 * - agents: Specialized agents (.md files in agents/)
 * - skills: Auto-activating capabilities (directories with SKILL.md)
 */

import { BaseIntegrationManager } from "./base-manager.js";
import { ComponentConfig } from "./types.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { confirm, spinner } from "@clack/prompts";
import ansis from "ansis";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

/**
 * GitHub Copilot Integration Manager
 *
 * Manages installation and updating of GitHub Copilot integration files in .github/ directory
 */
export class CopilotIntegrationManager extends BaseIntegrationManager {
  protected targetDir: string = ".github";
  protected readonly versionFileName = ".dr-copilot-version";
  protected readonly integrationSourceDir = "github_copilot";

  /**
   * Component configuration for Copilot integration
   * Extends BaseIntegrationManager with Copilot-specific components.
   *
   * All components are DR-owned (tracked: true by default).
   * See isTrackedComponent in base-manager.ts for tracking logic.
   */
  protected readonly components: Record<string, ComponentConfig> = {
    agents: {
      source: "agents",
      target: "agents",
      description: "Specialized sub-agent definitions",
      prefix: "",
      type: "files",
      // tracked: true (default)
    },
    skills: {
      source: "skills",
      target: "skills",
      description: "Auto-activating capabilities",
      prefix: "",
      type: "dirs",
      // tracked: true (default)
    },
  };

  /**
   * Install Copilot integration files
   *
   * Copies files from bundled source to .github/ directory, prompting for
   * confirmation if files already exist. Optionally filters to specific components.
   *
   * @param options Installation options
   * @param options.components Optional list of component names to install
   * @param options.force Skip confirmation prompts
   */
  async install(
    options: {
      components?: string[];
      force?: boolean;
    } = {}
  ): Promise<void> {
    const projectRoot = await this.getProjectRoot();
    this.targetDir = join(projectRoot, ".github");

    const { components = Object.keys(this.components), force = false } = options;

    // Validate components
    const invalid = components.filter((c) => !this.components[c]);
    if (invalid.length > 0) {
      console.error(ansis.red("✗ Invalid components: " + invalid.join(", ")));
      console.error(ansis.dim("  Valid: " + Object.keys(this.components).join(", ")));
      process.exit(1);
    }

    // Check if already installed
    if (await this.isInstalled()) {
      if (!force) {
        const response = await confirm({
          message: "GitHub Copilot integration already installed. Overwrite?",
        });
        if (!response) {
          console.log(ansis.yellow("✗ Installation cancelled"));
          process.exit(0);
        }
      }
    }

    // Create .github directory
    await mkdir(this.targetDir, { recursive: true });

    // Install components
    let totalInstalled = 0;
    const spinnerObj = spinner();
    spinnerObj.start("Installing components...");

    try {
      for (const componentName of components) {
        const count = await this.installComponent(componentName, force);
        totalInstalled += count;
      }

      spinnerObj.stop("Installation complete");

      // Update version file
      const cliVersion = await this.getCliVersion();
      await this.updateVersionFile(cliVersion);

      console.log(ansis.green("✓ GitHub Copilot integration installed successfully!"));
      console.log(ansis.green("  Installed " + totalInstalled + " files"));

      // Print next steps
      this.printNextSteps();
    } catch (error) {
      spinnerObj.stop("Installation failed");
      console.error(
        ansis.red("✗ Error: " + (error instanceof Error ? error.message : String(error)))
      );
      process.exit(1);
    }
  }

  /**
   * Upgrade installed Copilot integration files
   *
   * Detects file changes, shows a summary, and applies upgrades with optional
   * dry-run mode to preview changes without applying them.
   *
   * @param options Upgrade options
   * @param options.dryRun Preview changes without applying
   * @param options.force Skip confirmation prompts
   */
  async upgrade(
    options: {
      dryRun?: boolean;
      force?: boolean;
    } = {}
  ): Promise<void> {
    const projectRoot = await this.getProjectRoot();
    this.targetDir = join(projectRoot, ".github");

    const { dryRun = false, force = false } = options;

    // Check if installed
    if (!(await this.isInstalled())) {
      console.log(ansis.yellow("⚠ GitHub Copilot integration not installed"));
      console.log(ansis.dim("Run: dr copilot install"));
      return;
    }

    // Load version file
    const versionData = await this.loadVersionFile();
    if (!versionData) {
      console.log(ansis.red("✗ Version file corrupted. Run: dr copilot install"));
      process.exit(1);
    }

    // Check for updates
    let totalChanges = 0;
    const changes: Array<{ file: string; status: string; action: string }> = [];

    for (const componentName of Object.keys(this.components)) {
      const componentChanges = await this.checkUpdates(componentName, versionData);

      for (const change of componentChanges) {
        const status = this.changeTypeToStatus(change.changeType);
        const action = this.changeTypeToAction(change.changeType);
        changes.push({
          file: change.component + "/" + change.path,
          status,
          action,
        });
        totalChanges++;
      }
    }

    // Check for obsolete files
    const obsolete = await this.detectObsoleteFiles();
    for (const file of obsolete) {
      changes.push({
        file: file.component + "/" + file.path,
        status: "Obsolete",
        action: "Remove",
      });
      totalChanges++;
    }

    // If no changes, still update version file if needed
    if (totalChanges === 0) {
      console.log(ansis.green("✓ All files are up to date"));

      // Update version file even if no file changes
      const cliVersion = await this.getCliVersion();
      if (versionData.version !== cliVersion) {
        await this.updateVersionFile(cliVersion);
        console.log(ansis.green("✓ Version updated to " + cliVersion));
      }
      return;
    }

    // Show changes
    console.log(ansis.bold("\nPlanned Changes:"));
    for (const change of changes) {
      const statusColor = change.status === "Obsolete" ? ansis.yellow : ansis.cyan;
      const actionColor = change.action === "Remove" ? ansis.red : ansis.green;
      console.log(
        "  " +
          statusColor(change.status.padEnd(10)) +
          " " +
          change.file +
          " " +
          actionColor(change.action)
      );
    }

    if (dryRun) {
      console.log(ansis.yellow("\nDry run - no changes applied"));
      return;
    }

    // Ask for confirmation
    if (!force) {
      const response = await confirm({
        message: "Apply upgrades?",
      });
      if (!response) {
        console.log(ansis.yellow("✗ Upgrade cancelled"));
        return;
      }
    }

    // Apply upgrades
    const spinnerObj = spinner();
    spinnerObj.start("Applying upgrades...");

    try {
      for (const componentName of Object.keys(this.components)) {
        await this.installComponent(componentName, true);
      }

      // Remove obsolete files
      await this.removeObsoleteFiles();

      spinnerObj.stop("Upgrades applied");

      // Update version file
      const cliVersion = await this.getCliVersion();
      await this.updateVersionFile(cliVersion);

      console.log(ansis.green("✓ Upgrade completed successfully!"));
    } catch (error) {
      spinnerObj.stop("Upgrade failed");
      console.error(
        ansis.red("✗ Error: " + (error instanceof Error ? error.message : String(error)))
      );
      process.exit(1);
    }
  }

  /**
   * Remove Copilot integration files
   *
   * Removes files and the version file. Optionally filters to specific components.
   *
   * @param options Remove options
   * @param options.components Optional list of component names to remove
   * @param options.force Skip confirmation prompts
   */
  async remove(
    options: {
      components?: string[];
      force?: boolean;
    } = {}
  ): Promise<void> {
    const projectRoot = await this.getProjectRoot();
    this.targetDir = join(projectRoot, ".github");

    const { components = Object.keys(this.components), force = false } = options;

    // Check if installed
    if (!(await this.isInstalled())) {
      console.log(ansis.yellow("⚠ GitHub Copilot integration not installed"));
      return;
    }

    // Ask for confirmation
    if (!force) {
      console.log(ansis.yellow("This will remove: " + components.join(", ")));
      const response = await confirm({
        message: "Continue?",
      });
      if (!response) {
        console.log(ansis.yellow("✗ Removal cancelled"));
        return;
      }
    }

    // Remove components
    const spinnerObj = spinner();
    spinnerObj.start("Removing files...");

    try {
      const fs = await import("node:fs/promises");
      const { rmSync } = await import("node:fs");

      let removedCount = 0;

      for (const componentName of components) {
        const config = this.components[componentName];
        if (!config) continue;

        const targetPath = join(this.targetDir, config.target);
        if (existsSync(targetPath)) {
          rmSync(targetPath, { recursive: true, force: true });
          removedCount++;
        }
      }

      // Remove version file if all components were removed
      if (components.length === Object.keys(this.components).length) {
        const versionFile = join(this.targetDir, this.versionFileName);
        if (existsSync(versionFile)) {
          await fs.unlink(versionFile);
        }
      }

      spinnerObj.stop("Removal complete");
      console.log(ansis.green("✓ Removed " + removedCount + " component(s) successfully"));
    } catch (error) {
      spinnerObj.stop("Removal failed");
      console.error(
        ansis.red("✗ Error: " + (error instanceof Error ? error.message : String(error)))
      );
      process.exit(1);
    }
  }

  /**
   * Display installation status
   *
   * Shows what's installed, which files are modified, and version information.
   */
  async status(): Promise<void> {
    const projectRoot = await this.getProjectRoot();
    this.targetDir = join(projectRoot, ".github");

    if (!(await this.isInstalled())) {
      console.log(ansis.yellow("GitHub Copilot integration not installed"));
      console.log(ansis.dim("Run: dr copilot install"));
      return;
    }

    const versionData = await this.loadVersionFile();
    if (!versionData) {
      console.log(ansis.red("✗ Version file corrupted"));
      return;
    }

    console.log(ansis.bold("\nInstallation Status"));
    console.log("Version: " + ansis.cyan(versionData.version));
    console.log("Installed: " + ansis.cyan(new Date(versionData.installed_at).toLocaleString()));
    console.log("");

    // Show component table
    console.log(ansis.bold("Components:"));
    for (const [componentName] of Object.entries(this.components)) {
      const files = versionData.components[componentName] || {};
      const fileCount = Object.keys(files).length;
      const status = fileCount > 0 ? ansis.green("✓") : ansis.dim("-");

      console.log("  " + status + " " + componentName.padEnd(20) + " " + fileCount + " files");
    }
  }

  /**
   * List available components
   *
   * Shows all components that can be installed along with descriptions.
   */
  async list(): Promise<void> {
    console.log(ansis.bold("\nAvailable Components:"));
    console.log("");

    for (const [name, config] of Object.entries(this.components)) {
      console.log(ansis.cyan(name));
      console.log(ansis.dim("  " + config.description));
      console.log("");
    }
  }

  /**
   * Get the project root directory
   *
   * @returns Absolute path to project root
   * @throws Error if no project found
   */
  private async getProjectRoot(): Promise<string> {
    const root = await findProjectRoot();
    if (!root) {
      console.error(ansis.red("Error: No DR project found"));
      console.error(ansis.dim('Run "dr init" to create a new project'));
      process.exit(1);
    }
    return root;
  }

  /**
   * Convert change type to human-readable status
   */
  private changeTypeToStatus(changeType: string): string {
    switch (changeType) {
      case "added":
        return "New";
      case "modified":
        return "Updated";
      case "user-modified":
        return "Modified";
      case "conflict":
        return "Conflict";
      case "deleted":
        return "Removed";
      default:
        return changeType;
    }
  }

  /**
   * Convert change type to action
   */
  private changeTypeToAction(changeType: string): string {
    switch (changeType) {
      case "added":
      case "modified":
      case "deleted":
        return "Update";
      case "user-modified":
        return "Skip";
      case "conflict":
        return "Conflict";
      default:
        return "Update";
    }
  }

  /**
   * Print helpful next steps after installation
   */
  private printNextSteps(): void {
    console.log(ansis.bold("\nNext steps:"));
    console.log("1. Agents available in: .github/agents/");
    console.log("2. Skills available in: .github/skills/");
    console.log("3. Run: dr copilot status");
    console.log(ansis.dim("\nNote: Restart Copilot to load new files"));
  }
}
