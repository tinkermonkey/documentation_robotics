/**
 * Base Integration Manager
 *
 * Abstract base class providing shared logic for integration managers.
 * Handles file operations, version management, change detection, and installation.
 *
 * Subclasses (ClaudeIntegrationManager, CopilotIntegrationManager) must define:
 * - components: Registry of component configurations
 * - targetDir: Installation target directory (.claude or .github)
 * - versionFileName: Version file name (.dr-version or .dr-copilot-version)
 * - integrationSourceDir: Integration directory name (claude_code or github_copilot)
 */

import * as yaml from "yaml";
import { join, dirname, isAbsolute } from "node:path";
import {
  mkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  rm,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeDirectoryHashes, computeFileHash } from "./hash-utils.js";
import {
  ComponentConfig,
  VersionData,
  FileChange,
  ObsoleteFile,
  validateVersionData,
} from "./types.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getCliVersion as getCliVersionFromUtils } from "../utils/spec-version.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Abstract base class for integration managers
 * Provides shared logic for file operations, version management, and update detection
 */
export abstract class BaseIntegrationManager {
  /**
   * Component registry mapping component names to their configurations
   * Must be defined by subclasses
   */
  protected abstract readonly components: Record<string, ComponentConfig>;

  /**
   * Target directory for installation (.claude or .github)
   * Must be defined by subclasses
   */
  protected abstract readonly targetDir: string;

  /**
   * Version file name (.dr-version or .dr-copilot-version)
   * Must be defined by subclasses
   */
  protected abstract readonly versionFileName: string;

  /**
   * Integration source directory name (claude_code or github_copilot)
   * Must be defined by subclasses
   */
  protected abstract readonly integrationSourceDir: string;

  /**
   * Get path to integration source files
   *
   * Handles both development (integrations/ in repo) and production (bundled in dist/)
   * environments by checking for the existence of source directories.
   *
   * Development structure:
   *   /workspace/integrations/{integrationSourceDir}/
   *
   * Production structure:
   *   dist/integrations/{integrationSourceDir}/
   *
   * @returns Absolute path to integration source directory
   * @throws Error if integration source directory cannot be found
   */
  protected getSourceRoot(): string {
    // Get the path to the compiled CLI directory
    // import.meta.url points to the compiled .js file, e.g., dist/integrations/base-manager.js
    const cliDir = dirname(fileURLToPath(import.meta.url));

    // Production: dist/integrations/{integrationSourceDir}/
    // The integrations/ directory is in the same dist/ folder as cli.js
    const prodPath = join(cliDir, this.integrationSourceDir);
    if (existsSync(prodPath)) {
      return prodPath;
    }

    // Development: integrations/{integrationSourceDir}/ relative to repo root
    // From dist/integrations/base-manager.js, go up 3 levels to repo root
    const repoRoot = dirname(dirname(dirname(dirname(cliDir))));
    const devPath = join(repoRoot, "integrations", this.integrationSourceDir);
    if (existsSync(devPath)) {
      return devPath;
    }

    throw new Error(
      `Integration source directory not found for ${this.integrationSourceDir}. ` +
        `Checked: ${prodPath} and ${devPath}`
    );
  }

  /**
   * Get the absolute path to the target directory
   *
   * Resolves the project root and combines it with the relative targetDir.
   * This method ensures that integration operations work from any directory
   * within the project, not just from the project root.
   *
   * @returns Absolute path to the target directory
   * @throws Error if project root cannot be found
   */
  protected async getAbsoluteTargetDir(): Promise<string> {
    if (isAbsolute(this.targetDir)) {
      return this.targetDir;
    }
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      throw new Error(
        `Could not find project root. Are you in a Documentation Robotics project? ` +
          `Expected to find 'documentation-robotics' folder in directory hierarchy.`
      );
    }
    return join(projectRoot, this.targetDir);
  }

  /**
   * Check if integration is already installed
   *
   * @returns True if version file exists in target directory
   */
  public async isInstalled(): Promise<boolean> {
    const absoluteTargetDir = await this.getAbsoluteTargetDir();
    const versionFilePath = join(absoluteTargetDir, this.versionFileName);
    return existsSync(versionFilePath);
  }

  /**
   * Load version file from target directory
   *
   * Parses YAML format version file tracking installed version and file hashes.
   * Validates deserialized data to ensure all required fields are present and correctly typed.
   *
   * @returns VersionData if version file exists, null otherwise
   * @throws Error if version file cannot be parsed or fails validation
   */
  public async loadVersionFile(): Promise<VersionData | null> {
    const absoluteTargetDir = await this.getAbsoluteTargetDir();
    const versionFilePath = join(absoluteTargetDir, this.versionFileName);

    if (!existsSync(versionFilePath)) {
      return null;
    }

    try {
      const content = await fsReadFile(versionFilePath, "utf-8");
      const parsed = yaml.parse(content);
      // Validate deserialized data at boundary to catch corrupted files early
      return validateVersionData(parsed);
    } catch (error) {
      throw new Error(`Failed to parse version file at ${versionFilePath}: ${error}`);
    }
  }

  /**
   * Check if a component is tracked (DR-owned)
   *
   * A component is tracked if its tracked property is not explicitly false.
   * This handles the implicit default of true for backwards compatibility.
   *
   * @param componentName - Component name
   * @returns True if component should be tracked in version file
   */
  protected isTrackedComponent(componentName: string): boolean {
    const config = this.components[componentName];
    if (!config) {
      return false;
    }
    return config.tracked !== false;
  }

  /**
   * Update version file with current CLI version and component hashes
   *
   * Computes hashes for all currently installed DR-owned files and writes a new
   * version file tracking the CLI version, installation timestamp, and
   * file hashes for change detection.
   *
   * Only DR-owned components (tracked: true) are included in the version file.
   * User-customizable components (tracked: false) are not tracked to avoid
   * conflicts with user modifications.
   *
   * @param cliVersion - Current CLI version (usually from package.json)
   * @throws Error if version file cannot be written
   */
  protected async updateVersionFile(cliVersion: string): Promise<void> {
    const components: VersionData["components"] = {};
    const sourceRoot = this.getSourceRoot();
    const absoluteTargetDir = await this.getAbsoluteTargetDir();

    try {
      // Compute hashes for all DR-owned component files from SOURCE directory
      for (const [componentName] of Object.entries(this.components)) {
        // Skip non-tracked components (user-customizable)
        if (!this.isTrackedComponent(componentName)) {
          continue;
        }

        const config = this.components[componentName];

        const sourceDir = join(sourceRoot, config.source);
        const targetPath = join(absoluteTargetDir, config.target);

        // Compute hashes for files in SOURCE directory (DR-owned files only)
        const sourceHashes = existsSync(sourceDir)
          ? await computeDirectoryHashes(sourceDir, config.prefix)
          : new Map<string, string>();

        // Record hashes from source directory
        components[componentName] = {};
        for (const [filePath, sourceHash] of sourceHashes) {
          const targetFilePath = join(targetPath, filePath);
          // Check if file has been modified in target
          let modified = false;
          if (existsSync(targetFilePath)) {
            // File exists in target - check if it's been modified
            try {
              const targetHash = await computeFileHash(targetFilePath);
              modified = sourceHash !== targetHash;
            } catch (error) {
              // If we can't compute hash, assume modified to prevent data loss
              console.warn(
                `⚠ Warning: Could not compute hash for ${targetFilePath}: ${getErrorMessage(error)}`
              );
              modified = true;
            }
          }

          components[componentName][filePath] = {
            hash: sourceHash,
            modified,
          };
        }
      }

      // Create version data structure
      const versionData: VersionData = {
        version: cliVersion,
        installed_at: new Date().toISOString(),
        components,
      };

      // Write version file
      const versionFilePath = join(absoluteTargetDir, this.versionFileName);
      await mkdir(dirname(versionFilePath), { recursive: true });
      const yamlContent = yaml.stringify(versionData);
      await fsWriteFile(versionFilePath, yamlContent, "utf-8");
    } catch (error) {
      throw new Error(`Failed to update version file: ${error}`);
    }
  }

  /**
   * Detect files present in installation but missing from source
   *
   * Compares installed files (from version file) against current source files,
   * identifying which files no longer exist in source and should be removed.
   *
   * @returns Array of obsolete files (empty if none found)
   */
  protected async detectObsoleteFiles(): Promise<ObsoleteFile[]> {
    const versionData = await this.loadVersionFile();
    if (!versionData) {
      return []; // No installed version, nothing is obsolete
    }

    const obsolete: ObsoleteFile[] = [];
    const sourceRoot = this.getSourceRoot();

    // Check each component and its files
    for (const [componentName, files] of Object.entries(versionData.components)) {
      // Only check tracked components
      if (!this.isTrackedComponent(componentName)) {
        continue;
      }

      const config = this.components[componentName];
      const sourceDir = join(sourceRoot, config.source);

      // Check each installed file against source
      for (const filePath of Object.keys(files)) {
        const sourcePath = join(sourceDir, filePath);
        if (!existsSync(sourcePath)) {
          obsolete.push({
            path: filePath,
            component: componentName,
          });
        }
      }
    }

    return obsolete;
  }

  /**
   * Check for updates to a component's files
   *
   * Compares source files against installed files using hashes to detect:
   * - New files (in source but not installed)
   * - Modified files (hash changed in source)
   * - Deleted files (in installation but not in source)
   * - User-modified files (hash differs from recorded hash)
   * - Conflicts (user modified, but source also changed)
   *
   * @param componentName - Component to check
   * @param versionData - Current version data from installation
   * @returns Array of FileChange objects describing all detected changes
   */
  protected async checkUpdates(
    componentName: string,
    versionData: VersionData
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const config = this.components[componentName];

    if (!config) {
      throw new Error(`Unknown component: ${componentName}`);
    }

    const sourceRoot = this.getSourceRoot();
    const sourceDir = join(sourceRoot, config.source);
    const absoluteTargetDir = await this.getAbsoluteTargetDir();
    const targetPath = join(absoluteTargetDir, config.target);

    // Get hashes from source
    const sourceHashes = await computeDirectoryHashes(sourceDir, config.prefix);

    // Get hashes from installation (empty map if directory doesn't exist)
    const installedHashes = existsSync(targetPath)
      ? await computeDirectoryHashes(targetPath, config.prefix)
      : new Map<string, string>();

    // Get recorded hashes from version file
    const recordedHashes = versionData.components[componentName] || {};

    // Check source files
    for (const [filePath, sourceHash] of sourceHashes) {
      const installedHash = installedHashes.get(filePath);
      const recordedEntry = recordedHashes[filePath];
      const recordedHash = recordedEntry?.hash;

      if (!installedHash) {
        // File exists in source but not installed
        changes.push({
          path: filePath,
          component: componentName,
          changeType: "added",
          sourceHash,
        });
      } else if (sourceHash !== recordedHash) {
        // Source file changed
        if (installedHash !== recordedHash) {
          // User also modified the file - conflict
          changes.push({
            path: filePath,
            component: componentName,
            changeType: "conflict",
            sourceHash,
            installedHash,
          });
        } else {
          // Only source changed
          changes.push({
            path: filePath,
            component: componentName,
            changeType: "modified",
            sourceHash,
            installedHash,
          });
        }
      } else if (installedHash !== recordedHash) {
        // User modified the file
        changes.push({
          path: filePath,
          component: componentName,
          changeType: "user-modified",
          sourceHash,
          installedHash,
        });
      }
    }

    // Check for deleted files (in version but not in source)
    for (const [filePath] of Object.entries(recordedHashes)) {
      if (!sourceHashes.has(filePath)) {
        changes.push({
          path: filePath,
          component: componentName,
          changeType: "deleted",
          installedHash: installedHashes.get(filePath),
        });
      }
    }

    return changes;
  }

  /**
   * Install or update a component's files
   *
   * Copies all files from source to target directory, creating parent
   * directories as needed. Optionally forces overwrite of user-modified files.
   *
   * @param componentName - Component to install
   * @param force - If true, overwrite user-modified files
   * @returns Number of files installed/updated
   * @throws Error if installation fails
   */
  protected async installComponent(componentName: string, force: boolean = false): Promise<number> {
    const config = this.components[componentName];

    if (!config) {
      throw new Error(`Unknown component: ${componentName}`);
    }

    const sourceRoot = this.getSourceRoot();
    const sourceDir = join(sourceRoot, config.source);
    const absoluteTargetDir = await this.getAbsoluteTargetDir();
    const targetPath = join(absoluteTargetDir, config.target);
    const versionData = await this.loadVersionFile();

    // Get list of changes
    const changes = versionData ? await this.checkUpdates(componentName, versionData) : [];

    let filesInstalled = 0;

    // Get all source files
    const sourceHashes = await computeDirectoryHashes(sourceDir, config.prefix);

    // Copy files from source
    for (const filePath of sourceHashes.keys()) {
      const sourcePath = join(sourceDir, filePath);
      const targetFilePath = join(targetPath, filePath);

      // Check for conflicts with user modifications or conflicts
      const change = changes.find((c) => c.path === filePath);
      if (change && !force) {
        // Skip user-modified files unless force is set
        if (change.changeType === "user-modified") {
          continue;
        }
        // Skip conflict files - they require explicit resolution
        if (change.changeType === "conflict") {
          continue;
        }
      }

      // Create parent directories
      await mkdir(dirname(targetFilePath), { recursive: true });

      // Copy file
      await copyFile(sourcePath, targetFilePath);
      filesInstalled++;
    }

    return filesInstalled;
  }

  /**
   * Remove a file from the installation
   *
   * @param filePath - Relative path to file to remove
   * @throws Error if file cannot be deleted
   */
  protected async removeFile(filePath: string): Promise<void> {
    // Find which component this file belongs to
    const versionData = await this.loadVersionFile();
    if (!versionData) {
      return;
    }

    const absoluteTargetDir = await this.getAbsoluteTargetDir();

    for (const [componentName] of Object.entries(versionData.components)) {
      const config = this.components[componentName];
      if (!config) continue;

      const targetPath = join(absoluteTargetDir, config.target);
      const fullPath = join(targetPath, filePath);

      if (existsSync(fullPath)) {
        await rm(fullPath, { force: true });
        return;
      }
    }
  }

  /**
   * Remove all obsolete files
   *
   * Deletes files that are in the installation but no longer exist in source.
   *
   * @returns Number of files removed
   */
  protected async removeObsoleteFiles(): Promise<number> {
    const obsolete = await this.detectObsoleteFiles();
    let removed = 0;

    for (const obsoleteFile of obsolete) {
      try {
        await this.removeFile(obsoleteFile.path);
        removed++;
      } catch (error) {
        // Log error but continue removing other files
        console.error(`Failed to remove obsolete file ${obsoleteFile.path}:`, error);
      }
    }

    return removed;
  }

  /**
   * Get the current CLI version
   *
   * @returns Version string (e.g., "0.1.0")
   */
  protected async getCliVersion(): Promise<string> {
    return getCliVersionFromUtils();
  }
}
