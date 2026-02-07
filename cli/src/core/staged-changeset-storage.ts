/**
 * StagedChangesetStorage - Handles YAML-based storage for staged changesets
 *
 * Manages the new storage structure:
 * documentation-robotics/changesets/{changeset-id}/
 * ├── metadata.yaml       # Name, description, dates, status, base snapshot
 * └── changes.yaml        # Delta-only change records
 */

import { readFile, writeFile, readdir, rm } from 'fs/promises';
import { fileExists, ensureDir } from '../utils/file-io.js';
import { FileLock } from '../utils/file-lock.js';
import path from 'path';
import yaml from 'yaml';
import ansis from 'ansis';
import type { StagedChangesetData, StagedChange } from './changeset.js';
import { Changeset } from './changeset.js';

/**
 * Storage manager for staged changesets using YAML format
 */
export class StagedChangesetStorage {
  private changesetsDir: string;

  constructor(rootPath: string) {
    // Store changesets in documentation-robotics/changesets/ directory
    this.changesetsDir = path.join(rootPath, 'documentation-robotics', 'changesets');
  }

  /**
   * Create a new staged changeset directory structure
   */
  async create(
    id: string,
    name: string,
    description: string | undefined,
    baseSnapshot: string
  ): Promise<Changeset> {
    const now = new Date().toISOString();
    const sanitizedId = this.sanitizeId(id);
    const changesetPath = path.join(this.changesetsDir, sanitizedId);

    // Create directory structure
    await ensureDir(changesetPath);

    // Create metadata
    const metadata: Omit<StagedChangesetData, 'changes'> = {
      id: sanitizedId,
      name,
      description,
      created: now,
      modified: now,
      status: 'draft',
      baseSnapshot,
      stats: {
        additions: 0,
        modifications: 0,
        deletions: 0,
      },
    };

    // Write metadata.yaml
    await writeFile(
      path.join(changesetPath, 'metadata.yaml'),
      yaml.stringify(metadata),
      'utf-8'
    );

    // Write empty changes.yaml
    await writeFile(path.join(changesetPath, 'changes.yaml'), yaml.stringify([]), 'utf-8');

    // Return constructed changeset object
    return new Changeset({
      id: sanitizedId,
      name,
      description,
      created: now,
      modified: now,
      status: 'draft',
      baseSnapshot,
      changes: [],
      stats: metadata.stats,
    });
  }

  /**
   * Load a staged changeset from YAML files
   */
  async load(id: string): Promise<Changeset | null> {
    const sanitizedId = this.sanitizeId(id);
    const changesetPath = path.join(this.changesetsDir, sanitizedId);
    const metadataPath = path.join(changesetPath, 'metadata.yaml');
    const changesPath = path.join(changesetPath, 'changes.yaml');

    // Check if changeset directory exists
    if (!(await fileExists(changesetPath))) {
      return null; // Changeset doesn't exist - this is OK
    }

    // Changeset directory exists - files SHOULD be present
    const metadataExists = await fileExists(metadataPath);
    const changesExists = await fileExists(changesPath);

    if (!metadataExists || !changesExists) {
      // Changeset directory exists but required files are missing - this is corruption
      throw new Error(
        `Changeset '${id}' is corrupted (missing ${!metadataExists ? 'metadata.yaml' : 'changes.yaml'}). ` +
        `Location: ${changesetPath}\n` +
        `This may indicate disk failure or incomplete write. Check disk health and restore from backup if available.`
      );
    }

    try {
      // Load metadata
      const metadataContent = await readFile(metadataPath, 'utf-8');
      const metadata = yaml.parse(metadataContent);

      // Load changes
      const changesContent = await readFile(changesPath, 'utf-8');
      const changes = yaml.parse(changesContent) || [];

      // Construct changeset object
      const data: StagedChangesetData = {
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        created: metadata.created,
        modified: metadata.modified,
        status: metadata.status,
        baseSnapshot: metadata.baseSnapshot,
        changes: changes as StagedChange[],
        stats: metadata.stats || { additions: 0, modifications: 0, deletions: 0 },
      };

      return Changeset.fromJSON(data);
    } catch (error) {
      // YAML parsing or file read error - provide detailed guidance
      throw new Error(
        `Failed to load changeset '${id}': YAML parsing failed.\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n` +
        `Location: ${metadataPath}\n` +
        `This indicates file corruption. Try:\n` +
        `  1. Validate YAML syntax with: yamllint ${metadataPath}\n` +
        `  2. Restore from backup if available\n` +
        `  3. Manually edit to fix syntax errors`
      );
    }
  }

  /**
   * Save a staged changeset to YAML files
   */
  async save(changeset: Changeset): Promise<void> {
    if (!changeset.id) {
      throw new Error('Changeset must have an id to be saved in YAML format');
    }

    const sanitizedId = this.sanitizeId(changeset.id);
    const changesetPath = path.join(this.changesetsDir, sanitizedId);
    await ensureDir(changesetPath);

    // Prepare metadata (all fields except changes)
    const metadata = {
      id: changeset.id,
      name: changeset.name,
      description: changeset.description,
      created: changeset.created,
      modified: changeset.modified,
      status: changeset.status,
      baseSnapshot: changeset.baseSnapshot,
      stats: changeset.stats || { additions: 0, modifications: 0, deletions: 0 },
    };

    // Write metadata.yaml
    await writeFile(
      path.join(changesetPath, 'metadata.yaml'),
      yaml.stringify(metadata),
      'utf-8'
    );

    // Write changes.yaml
    await writeFile(path.join(changesetPath, 'changes.yaml'), yaml.stringify(changeset.changes), 'utf-8');
  }

  /**
   * List all staged changesets
   */
  async list(): Promise<Changeset[]> {
    if (!(await fileExists(this.changesetsDir))) {
      return [];
    }

    try {
      const entries = await readdir(this.changesetsDir, { withFileTypes: true });
      const changesets: Changeset[] = [];
      let skippedCount = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const changeset = await this.load(entry.name);
            if (changeset) {
              changesets.push(changeset);
            } else {
              // load() returned null - directory exists but no valid changeset
              console.warn(
                ansis.yellow(`⚠ Warning: Changeset directory '${entry.name}' exists but could not be loaded (may be corrupted)`)
              );
              skippedCount++;
            }
          } catch (loadError) {
            // load() threw an error - this is a corrupted changeset
            console.warn(
              ansis.yellow(`⚠ Warning: Failed to load changeset '${entry.name}': ${loadError instanceof Error ? loadError.message : String(loadError)}`)
            );
            skippedCount++;
          }
        }
      }

      // Show summary if any were skipped
      if (skippedCount > 0) {
        console.warn(
          ansis.yellow(`\n⚠ ${skippedCount} changeset(s) could not be loaded and were skipped.`) +
          ansis.dim(`\nRun 'dr changeset validate' to check for corruption and repair options.`)
        );
      }

      return changesets;
    } catch (error) {
      throw new Error(
        `Failed to list changesets: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete a staged changeset
   */
  async delete(id: string): Promise<void> {
    const sanitizedId = this.sanitizeId(id);
    const changesetPath = path.join(this.changesetsDir, sanitizedId);

    if (!(await fileExists(changesetPath))) {
      // List available changesets to help user
      const available = await this.list();
      const availableIds = available.map(cs => cs.id).join(', ');

      throw new Error(
        `Changeset '${id}' not found.\n` +
        `Available changesets: ${availableIds || '(none)'}\n` +
        `Run 'dr changeset list' to see all changesets.`
      );
    }

    try {
      await rm(changesetPath, { recursive: true, force: true });
    } catch (error) {
      throw new Error(
        `Failed to delete changeset '${id}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Add or update a change in the changeset's changes.yaml
   *
   * Uses file locking to prevent concurrent modification race conditions
   * Assigns sequence number atomically inside the lock to prevent duplicates
   *
   * @returns The assigned sequence number for the change
   * @throws {Error} If lock acquisition, changeset load, save, or lock release fails
   */
  async addChange(id: string, change: Omit<StagedChange, 'sequenceNumber'>): Promise<number> {
    const changesetPath = this.getChangesetPath(id);
    const lock = new FileLock(changesetPath);

    try {
      return await lock.withLock(async () => {
        const changeset = await this.load(id);
        if (!changeset) {
          throw new Error(`Changeset '${id}' not found`);
        }

        // Assign sequence number atomically inside the lock
        // This prevents race conditions when multiple concurrent operations
        // try to add changes at the same time
        const sequenceNumber = changeset.changes.length;
        const stagedChange: StagedChange = {
          ...change,
          sequenceNumber,
        };

        changeset.changes.push(stagedChange);
        changeset.updateModified();

        await this.save(changeset);

        return sequenceNumber;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Detect lock-specific errors
      if (errorMessage.includes('lock') || errorMessage.includes('timeout')) {
        const lockFilePath = path.join(changesetPath, '.lock');

        throw new Error(
          `Failed to add change to changeset '${id}': Lock acquisition failed.\n` +
          `Error: ${errorMessage}\n\n` +
          `This usually means another dr process is modifying this changeset.\n` +
          `If no other processes are running, a stale lock file may exist.\n\n` +
          `To resolve:\n` +
          `  1. Wait for other operations to complete\n` +
          `  2. Check for running dr processes: ps aux | grep dr\n` +
          `  3. If no processes found, remove stale lock: rm "${lockFilePath}"\n` +
          `  4. Retry the operation`
        );
      }

      // Generic error with context
      throw new Error(
        `Failed to add change to changeset '${id}': ${errorMessage}\n` +
        `Changeset path: ${changesetPath}`
      );
    }
  }

  /**
   * Remove a change by element ID
   *
   * Uses file locking to prevent concurrent modification race conditions
   *
   * @throws {Error} If lock acquisition, changeset load, save, or lock release fails
   */
  async removeChange(id: string, elementId: string): Promise<void> {
    const changesetPath = this.getChangesetPath(id);
    const lock = new FileLock(changesetPath);

    try {
      await lock.withLock(async () => {
        const changeset = await this.load(id);
        if (!changeset) {
          throw new Error(`Changeset '${id}' not found`);
        }

        // Filter out changes for this element
        const filtered = changeset.changes.filter((c) => c.elementId !== elementId);

        // Reconstruct changes with updated sequence numbers
        changeset.changes = filtered.map((c, idx) => ({
          ...c,
          sequenceNumber: idx,
        }));

        changeset.updateModified();

        await this.save(changeset);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Detect lock-specific errors
      if (errorMessage.includes('lock') || errorMessage.includes('timeout')) {
        const lockFilePath = path.join(changesetPath, '.lock');

        throw new Error(
          `Failed to remove change from changeset '${id}': Lock acquisition failed.\n` +
          `Error: ${errorMessage}\n\n` +
          `This usually means another dr process is modifying this changeset.\n` +
          `If no other processes are running, a stale lock file may exist.\n\n` +
          `To resolve:\n` +
          `  1. Wait for other operations to complete\n` +
          `  2. Check for running dr processes: ps aux | grep dr\n` +
          `  3. If no processes found, remove stale lock: rm "${lockFilePath}"\n` +
          `  4. Retry the operation`
        );
      }

      // Generic error with context
      throw new Error(
        `Failed to remove change from changeset '${id}': ${errorMessage}\n` +
        `Changeset path: ${changesetPath}`
      );
    }
  }

  /**
   * Get the storage path for a changeset
   */
  getChangesetPath(id: string): string {
    const sanitizedId = this.sanitizeId(id);
    return path.join(this.changesetsDir, sanitizedId);
  }

  /**
   * Get the root changesets directory
   */
  getChangesetsDir(): string {
    return this.changesetsDir;
  }

  /**
   * Sanitize changeset ID for safe use in file paths
   * Prevents path traversal by removing special characters and path separators
   */
  private sanitizeId(id: string): string {
    const sanitized = id
      .replace(/\.\./g, '')           // Remove .. (parent directory)
      .replace(/^\/+/, '')            // Remove leading slashes
      .replace(/^[A-Z]:\\/g, '')      // Remove Windows drive letters
      .toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/[^a-z0-9-]/g, '');    // Keep only alphanumeric and hyphens

    if (!sanitized) {
      throw new Error(
        `Invalid changeset ID '${id}': results in empty string after sanitization. ` +
        `ID must contain at least one alphanumeric character.`
      );
    }

    return sanitized;
  }
}
