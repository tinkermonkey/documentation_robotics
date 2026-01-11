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
import path from 'path';
import yaml from 'yaml';
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
    const changesetPath = path.join(this.changesetsDir, id);

    // Create directory structure
    await ensureDir(changesetPath);

    // Create metadata
    const metadata: Omit<StagedChangesetData, 'changes'> = {
      id,
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
      id,
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
    const changesetPath = path.join(this.changesetsDir, id);
    const metadataPath = path.join(changesetPath, 'metadata.yaml');
    const changesPath = path.join(changesetPath, 'changes.yaml');

    // Check if paths exist
    if (!(await fileExists(metadataPath)) || !(await fileExists(changesPath))) {
      return null;
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
      throw new Error(
        `Failed to load changeset '${id}': ${error instanceof Error ? error.message : String(error)}`
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

    const changesetPath = path.join(this.changesetsDir, changeset.id);
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

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const changeset = await this.load(entry.name);
          if (changeset) {
            changesets.push(changeset);
          }
        }
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
    const changesetPath = path.join(this.changesetsDir, id);

    if (!(await fileExists(changesetPath))) {
      throw new Error(`Changeset '${id}' not found`);
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
   */
  async addChange(id: string, change: StagedChange): Promise<void> {
    const changeset = await this.load(id);
    if (!changeset) {
      throw new Error(`Changeset '${id}' not found`);
    }

    // Add change with sequence number if not present
    if (!change.sequenceNumber) {
      change.sequenceNumber = changeset.changes.length;
    }

    changeset.changes.push(change);
    changeset.updateModified();
    changeset.updateStats();

    await this.save(changeset);
  }

  /**
   * Remove a change by element ID
   */
  async removeChange(id: string, elementId: string): Promise<void> {
    const changeset = await this.load(id);
    if (!changeset) {
      throw new Error(`Changeset '${id}' not found`);
    }

    // Filter out changes for this element
    changeset.changes = changeset.changes.filter((c) => c.elementId !== elementId);

    // Recalculate sequence numbers
    changeset.changes.forEach((c, idx) => {
      (c as StagedChange).sequenceNumber = idx;
    });

    changeset.updateModified();
    changeset.updateStats();

    await this.save(changeset);
  }

  /**
   * Get the storage path for a changeset
   */
  getChangesetPath(id: string): string {
    return path.join(this.changesetsDir, id);
  }

  /**
   * Get the root changesets directory
   */
  getChangesetsDir(): string {
    return this.changesetsDir;
  }
}
