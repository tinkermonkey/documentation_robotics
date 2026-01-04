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

import * as yaml from 'yaml';
import { join, dirname } from 'node:path';
import {
  mkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  rm,
  copyFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeDirectoryHashes } from './hash-utils.js';
import { ComponentConfig, VersionData, FileChange, ObsoleteFile } from './types.js';

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
    const devPath = join(repoRoot, 'integrations', this.integrationSourceDir);
    if (existsSync(devPath)) {
      return devPath;
    }

    throw new Error(
      `Integration source directory not found for ${this.integrationSourceDir}. ` +
        `Checked: ${prodPath} and ${devPath}`
    );
  }

  /**
   * Check if integration is already installed
   *
   * @returns True if version file exists in target directory
   */
  protected async isInstalled(): Promise<boolean> {
    const versionFilePath = join(this.targetDir, this.versionFileName);
    return existsSync(versionFilePath);
  }

  /**
   * Load version file from target directory
   *
   * Parses YAML format version file tracking installed version and file hashes.
   *
   * @returns VersionData if version file exists, null otherwise
   * @throws Error if version file cannot be parsed
   */
  protected async loadVersionFile(): Promise<VersionData | null> {
    const versionFilePath = join(this.targetDir, this.versionFileName);

    if (!existsSync(versionFilePath)) {
      return null;
    }

    try {
      const content = await fsReadFile(versionFilePath, 'utf-8');
      return yaml.parse(content) as VersionData;
    } catch (error) {
      throw new Error(`Failed to parse version file at ${versionFilePath}: ${error}`);
    }
  }

  /**
   * Update version file with current CLI version and component hashes
   *
   * Computes hashes for all currently installed files and writes a new
   * version file tracking the CLI version, installation timestamp, and
   * file hashes for change detection.
   *
   * @param cliVersion - Current CLI version (usually from package.json)
   * @throws Error if version file cannot be written
   */
  protected async updateVersionFile(cliVersion: string): Promise<void> {
    const components: VersionData['components'] = {};

    try {
      // Compute hashes for all installed component files
      for (const [componentName, config] of Object.entries(this.components)) {
        const targetPath = join(this.targetDir, config.target);

        // Skip if component target doesn't exist yet
        if (!existsSync(targetPath)) {
          components[componentName] = {};
          continue;
        }

        // Compute hashes for all files in this component
        const hashes = await computeDirectoryHashes(targetPath, config.prefix);

        // Build component entry with relative paths and hash data
        components[componentName] = {};
        for (const [filePath, hash] of hashes) {
          components[componentName][filePath] = {
            hash,
            modified: false, // New files are not user-modified
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
      const versionFilePath = join(this.targetDir, this.versionFileName);
      await mkdir(dirname(versionFilePath), { recursive: true });
      const yamlContent = yaml.stringify(versionData);
      await fsWriteFile(versionFilePath, yamlContent, 'utf-8');
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
      const config = this.components[componentName];
      if (!config) {
        // Component definition was removed from config
        continue;
      }

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
    const targetPath = join(this.targetDir, config.target);

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
          changeType: 'added',
          sourceHash,
        });
      } else if (sourceHash !== recordedHash) {
        // Source file changed
        if (installedHash !== recordedHash) {
          // User also modified the file - conflict
          changes.push({
            path: filePath,
            component: componentName,
            changeType: 'conflict',
            sourceHash,
            installedHash,
          });
        } else {
          // Only source changed
          changes.push({
            path: filePath,
            component: componentName,
            changeType: 'modified',
            sourceHash,
            installedHash,
          });
        }
      } else if (installedHash !== recordedHash) {
        // User modified the file
        changes.push({
          path: filePath,
          component: componentName,
          changeType: 'user-modified',
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
          changeType: 'deleted',
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
  protected async installComponent(
    componentName: string,
    force: boolean = false
  ): Promise<number> {
    const config = this.components[componentName];

    if (!config) {
      throw new Error(`Unknown component: ${componentName}`);
    }

    const sourceRoot = this.getSourceRoot();
    const sourceDir = join(sourceRoot, config.source);
    const targetPath = join(this.targetDir, config.target);
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

      // Check for conflicts with user modifications
      const change = changes.find((c) => c.path === filePath);
      if (change && change.changeType === 'user-modified' && !force) {
        // Skip user-modified files unless force is set
        continue;
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

    for (const [componentName] of Object.entries(versionData.components)) {
      const config = this.components[componentName];
      if (!config) continue;

      const targetPath = join(this.targetDir, config.target);
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
}
