/**
 * StagedChangesetStorage - Handles YAML-based storage for staged changesets
 *
 * Manages the new storage structure:
 * documentation-robotics/changesets/{changeset-id}/
 * ├── metadata.yaml       # Name, description, dates, status, base snapshot
 * └── changes.yaml        # Delta-only change records
 */

import { readFile, writeFile, readdir, rm } from "fs/promises";
import { fileExists, ensureDir } from "../utils/file-io.js";
import { FileLock } from "../utils/file-lock.js";
import path from "path";
import yaml from "yaml";
import ansis from "ansis";
import type { StagedChangesetData, StagedChange, UnstagedChange } from "./changeset.js";
import { Changeset, compactChange, nextSequenceNumber, sequenceOf, withSequenceNumbers } from "./changeset.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * How many unstaged changes a changeset keeps as tombstones. Older ones are dropped (and
 * `unstagedPrunedThrough` records how far), so a delta reaching back past them says it is
 * approximate.
 */
export const MAX_UNSTAGED_TOMBSTONES = 200;

/**
 * Reads the tombstone list from metadata.yaml, keeping the well-formed entries. Malformed entries
 * are reported, not silently dropped: the changeset still loads, and its changes are untouched.
 */
function readTombstones(value: unknown, id: string): UnstagedChange[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    console.warn(ansis.yellow(`⚠ Changeset '${id}': 'unstaged' in metadata.yaml is not a list; ignoring it`));
    return undefined;
  }
  const valid = value.filter(
    (t): t is UnstagedChange =>
      !!t &&
      typeof t === "object" &&
      typeof t.sequence === "number" &&
      typeof t.removedAt === "number" &&
      !!t.change &&
      typeof t.change === "object" &&
      typeof t.change.type === "string" &&
      typeof t.change.elementId === "string"
  );
  if (valid.length < value.length) {
    console.warn(
      ansis.yellow(
        `⚠ Changeset '${id}': ignoring ${value.length - valid.length} malformed 'unstaged' entr(ies) in metadata.yaml`
      )
    );
  }
  return valid;
}

/** Appends tombstones, keeping the newest MAX_UNSTAGED_TOMBSTONES and recording how far it trimmed. */
function addTombstones(changeset: Changeset, tombstones: UnstagedChange[]): void {
  changeset.unstaged = [...changeset.unstaged, ...tombstones];
  if (changeset.unstaged.length > MAX_UNSTAGED_TOMBSTONES) {
    const dropped = changeset.unstaged.slice(0, changeset.unstaged.length - MAX_UNSTAGED_TOMBSTONES);
    changeset.unstaged = changeset.unstaged.slice(-MAX_UNSTAGED_TOMBSTONES);
    changeset.unstagedPrunedThrough = Math.max(changeset.unstagedPrunedThrough ?? -1, ...dropped.map((t) => t.removedAt));
  }
}

/**
 * Storage manager for staged changesets using YAML format
 */
export class StagedChangesetStorage {
  private changesetsDir: string;

  constructor(rootPath: string) {
    // Store changesets in documentation-robotics/changesets/ directory
    this.changesetsDir = path.join(rootPath, "documentation-robotics", "changesets");
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
    const metadata: Omit<StagedChangesetData, "changes"> = {
      id: sanitizedId,
      name,
      description,
      created: now,
      modified: now,
      status: "staged",
      baseSnapshot,
      stats: {
        additions: 0,
        modifications: 0,
        deletions: 0,
      },
    };

    // Write metadata.yaml
    await writeFile(path.join(changesetPath, "metadata.yaml"), yaml.stringify(metadata), "utf-8");

    // Write empty changes.yaml
    await writeFile(path.join(changesetPath, "changes.yaml"), yaml.stringify([]), "utf-8");

    // Return constructed changeset object
    return new Changeset({
      id: sanitizedId,
      name,
      description,
      created: now,
      modified: now,
      status: "staged",
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
    const metadataPath = path.join(changesetPath, "metadata.yaml");
    const changesPath = path.join(changesetPath, "changes.yaml");

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
        `Changeset '${id}' is corrupted (missing ${!metadataExists ? "metadata.yaml" : "changes.yaml"}). ` +
          `Location: ${changesetPath}\n` +
          `This may indicate disk failure or incomplete write. Check disk health and restore from backup if available.`
      );
    }

    try {
      // Load metadata
      const metadataContent = await readFile(metadataPath, "utf-8");
      const metadata = yaml.parse(metadataContent);

      // Load changes
      const changesContent = await readFile(changesPath, "utf-8");
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
        ...(typeof metadata.lastSequence === "number" ? { lastSequence: metadata.lastSequence } : {}),
        ...(typeof metadata.unstagedPrunedThrough === "number"
          ? { unstagedPrunedThrough: metadata.unstagedPrunedThrough }
          : {}),
      };
      const unstaged = readTombstones(metadata.unstaged, id);
      if (unstaged) data.unstaged = unstaged;

      return Changeset.fromJSON(data);
    } catch (error) {
      // YAML parsing or file read error - provide detailed guidance
      throw new Error(
        `Failed to load changeset '${id}': YAML parsing failed.\n` +
          `Error: ${getErrorMessage(error)}\n` +
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
      throw new Error("Changeset must have an id to be saved in YAML format");
    }

    const sanitizedId = this.sanitizeId(changeset.id);
    const changesetPath = path.join(this.changesetsDir, sanitizedId);
    await ensureDir(changesetPath);

    // A change staged in memory without a number gets the next unused one (never one an unstaged
    // change or unstage event took); lastSequence then covers it.
    const numbered = withSequenceNumbers(changeset.changes, nextSequenceNumber(changeset));
    const lastSequence =
      changeset.lastSequence !== undefined
        ? Math.max(changeset.lastSequence, ...numbered.map((c) => c.sequenceNumber))
        : undefined;

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
      // Sequence bookkeeping (see nextSequenceNumber); absent on changesets never unstaged from.
      ...(lastSequence !== undefined ? { lastSequence } : {}),
      ...(changeset.unstagedPrunedThrough !== undefined
        ? { unstagedPrunedThrough: changeset.unstagedPrunedThrough }
        : {}),
      ...(changeset.unstaged.length > 0 ? { unstaged: changeset.unstaged } : {}),
    };

    // Write metadata.yaml
    await writeFile(path.join(changesetPath, "metadata.yaml"), yaml.stringify(metadata), "utf-8");

    // Write changes.yaml
    await writeFile(
      path.join(changesetPath, "changes.yaml"),
      yaml.stringify(numbered),
      "utf-8"
    );
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
                ansis.yellow(
                  `⚠ Warning: Changeset directory '${entry.name}' exists but could not be loaded (may be corrupted)`
                )
              );
              skippedCount++;
            }
          } catch (loadError) {
            // load() threw an error - this is a corrupted changeset
            console.warn(
              ansis.yellow(
                `⚠ Warning: Failed to load changeset '${entry.name}': ${loadError instanceof Error ? loadError.message : String(loadError)}`
              )
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
        `Failed to list changesets: ${getErrorMessage(error)}`
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
      const availableIds = available.map((cs) => cs.id).join(", ");

      throw new Error(
        `Changeset '${id}' not found.\n` +
          `Available changesets: ${availableIds || "(none)"}\n` +
          `Run 'dr changeset list' to see all changesets.`
      );
    }

    try {
      await rm(changesetPath, { recursive: true, force: true });
    } catch (error) {
      throw new Error(
        `Failed to delete changeset '${id}': ${getErrorMessage(error)}`
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
  async addChange(id: string, change: Omit<StagedChange, "sequenceNumber">): Promise<number> {
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
        // try to add changes at the same time. One past every number used so far (unstaged
        // changes and unstage events included), so a number is never reused and a revision
        // always names the same prefix of the plan.
        const sequenceNumber = nextSequenceNumber(changeset);
        const stagedChange: StagedChange = {
          ...change,
          sequenceNumber,
        };

        changeset.changes = withSequenceNumbers(changeset.changes);
        changeset.changes.push(stagedChange);
        changeset.lastSequence = sequenceNumber;
        changeset.updateModified();

        await this.save(changeset);

        return sequenceNumber;
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      // Detect lock-specific errors
      if (errorMessage.includes("lock") || errorMessage.includes("timeout")) {
        const lockFilePath = path.join(changesetPath, ".lock");

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
   * Add several changes, and rewrite some staged ones in place, in one write: one load and one save
   * instead of one per change. Additions take the next sequence numbers in order; a rewrite keeps
   * its change's number and leaves a tombstone, as {@link updateChange} does.
   *
   * @returns The sequence numbers assigned to the additions, in order
   */
  async addChanges(
    id: string,
    changes: Array<Omit<StagedChange, "sequenceNumber">>,
    rewrites: Array<{ elementId: string; change: Omit<StagedChange, "sequenceNumber"> }> = []
  ): Promise<number[]> {
    if (changes.length === 0 && rewrites.length === 0) return [];
    const changesetPath = this.getChangesetPath(id);
    const lock = new FileLock(changesetPath);
    try {
      return await lock.withLock(async () => {
        const changeset = await this.load(id);
        if (!changeset) {
          throw new Error(`Changeset '${id}' not found`);
        }
        changeset.changes = withSequenceNumbers(changeset.changes, nextSequenceNumber(changeset));
        for (const { elementId, change } of rewrites) {
          const index = changeset.changes.findIndex((c) => c.elementId === elementId);
          if (index === -1) {
            throw new Error(`No change for element '${elementId}' in changeset '${id}'`);
          }
          const existing = changeset.changes[index] as StagedChange;
          const rewrittenAt = nextSequenceNumber(changeset);
          changeset.lastSequence = rewrittenAt;
          addTombstones(changeset, [
            { sequence: existing.sequenceNumber, removedAt: rewrittenAt, change: compactChange(existing), rewritten: true },
          ]);
          changeset.changes[index] = { ...existing, ...change, sequenceNumber: existing.sequenceNumber } as StagedChange;
        }
        const numbers: number[] = [];
        for (const change of changes) {
          const sequenceNumber = nextSequenceNumber(changeset);
          const staged: StagedChange = { ...change, sequenceNumber };
          changeset.changes.push(staged);
          changeset.lastSequence = sequenceNumber;
          numbers.push(sequenceNumber);
        }
        changeset.updateModified();
        await this.save(changeset);
        return numbers;
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes("lock") || errorMessage.includes("timeout")) {
        const lockFilePath = path.join(changesetPath, ".lock");
        throw new Error(
          `Failed to add changes to changeset '${id}': Lock acquisition failed.\n` +
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
      throw new Error(`Failed to add changes to changeset '${id}': ${errorMessage}\n` + `Changeset path: ${changesetPath}`);
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

        // Number any change that carries none by its position first, so the ones that stay keep
        // the numbers they had. Remaining changes are not renumbered.
        const numbered = withSequenceNumbers(changeset.changes);
        const removed = numbered.filter((c) => c.elementId === elementId);
        changeset.changes = numbered.filter((c) => c.elementId !== elementId);

        if (removed.length > 0) {
          // The unstage is a revision of its own: it takes the next sequence number, and each
          // removed change is kept as a tombstone so the plan before it can be rebuilt.
          const removedAt = nextSequenceNumber({ ...changeset, changes: numbered });
          changeset.lastSequence = removedAt;
          addTombstones(
            changeset,
            removed.map((c, index) => ({
              sequence: sequenceOf(c, index),
              removedAt,
              change: compactChange(c),
            }))
          );
        }

        changeset.updateModified();

        await this.save(changeset);
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      // Detect lock-specific errors
      if (errorMessage.includes("lock") || errorMessage.includes("timeout")) {
        const lockFilePath = path.join(changesetPath, ".lock");

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
   * Update an existing change in-place within the changeset's changes.yaml
   *
   * Atomically replaces the change for the given elementId under a single file lock,
   * preventing data loss if the process is interrupted between a remove and add.
   * The original sequence number is preserved so commit-ordering is unaffected.
   *
   * @throws {Error} If changeset not found, elementId not found in changes, or I/O error
   */
  async updateChange(
    id: string,
    elementId: string,
    updated: Omit<StagedChange, "sequenceNumber">
  ): Promise<void> {
    const changesetPath = this.getChangesetPath(id);
    const lock = new FileLock(changesetPath);

    try {
      await lock.withLock(async () => {
        const changeset = await this.load(id);
        if (!changeset) {
          throw new Error(`Changeset '${id}' not found`);
        }

        const index = changeset.changes.findIndex((c) => c.elementId === elementId);
        if (index === -1) {
          throw new Error(`No change for element '${elementId}' in changeset '${id}'`);
        }

        // Number every change first (an older changes.yaml may carry none), so the list is never
        // left half numbered. Spread the existing entry so runtime fields like sequenceNumber and
        // timestamp are preserved; `updated` omits sequenceNumber and cannot overwrite it.
        changeset.changes = withSequenceNumbers(changeset.changes, nextSequenceNumber(changeset));
        const existing = changeset.changes[index] as StagedChange;
        // The rewrite is a revision of its own, like an unstage: it takes the next sequence number,
        // and the version the change had is kept as a tombstone so the plan before it can be rebuilt.
        const rewrittenAt = nextSequenceNumber(changeset);
        changeset.lastSequence = rewrittenAt;
        addTombstones(changeset, [
          { sequence: existing.sequenceNumber, removedAt: rewrittenAt, change: compactChange(existing), rewritten: true },
        ]);
        changeset.changes[index] = {
          ...existing,
          ...updated,
          sequenceNumber: existing.sequenceNumber,
        } as StagedChange;

        changeset.updateModified();
        await this.save(changeset);
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      throw new Error(
        `Failed to update change in changeset '${id}': ${errorMessage}\n` +
          `Changeset path: ${changesetPath}`
      );
    }
  }

  /**
   * Change a changeset's name and/or description in place, under the changeset's file lock so a
   * concurrent stage cannot be lost. Staged changes are untouched.
   *
   * @returns The updated changeset
   * @throws {Error} If the changeset is not found, or on lock or I/O failure
   */
  async updateMetadata(
    id: string,
    patch: { name?: string; description?: string }
  ): Promise<Changeset> {
    const lock = new FileLock(this.getChangesetPath(id));
    return lock.withLock(async () => {
      const changeset = await this.load(id);
      if (!changeset) {
        throw new Error(`Changeset '${id}' not found`);
      }
      if (patch.name !== undefined) changeset.name = patch.name;
      if (patch.description !== undefined) changeset.description = patch.description || undefined;
      changeset.updateModified();
      await this.save(changeset);
      return changeset;
    });
  }

  /**
   * Get the storage path for a changeset
   */
  /**
   * Remove every file in the changeset's directory except metadata.yaml and changes.yaml (and
   * dotfiles such as a lock): e.g. the base index, once the changeset is discarded and nothing
   * reads it again.
   *
   * @returns The names of the files removed
   */
  async removeSideFiles(id: string): Promise<string[]> {
    const changesetPath = this.getChangesetPath(id);
    if (!(await fileExists(changesetPath))) return [];
    const keep = new Set(["metadata.yaml", "changes.yaml"]);
    const removed: string[] = [];
    for (const entry of await readdir(changesetPath, { withFileTypes: true })) {
      if (keep.has(entry.name) || entry.name.startsWith(".") || !entry.isFile()) continue;
      await rm(path.join(changesetPath, entry.name), { force: true });
      removed.push(entry.name);
    }
    return removed;
  }

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
      .replace(/\.\./g, "") // Remove .. (parent directory)
      .replace(/^\/+/, "") // Remove leading slashes
      .replace(/^[A-Z]:\\/g, "") // Remove Windows drive letters
      .toLowerCase()
      .replace(/\s+/g, "-") // Replace spaces with hyphens
      .replace(/[^a-z0-9-]/g, ""); // Keep only alphanumeric and hyphens

    if (!sanitized) {
      throw new Error(
        `Invalid changeset ID '${id}': results in empty string after sanitization. ` +
          `ID must contain at least one alphanumeric character.`
      );
    }

    return sanitized;
  }
}
