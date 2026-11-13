import type {
  ManifestData,
  ChangesetHistoryEntry,
  ExternalModelDeclaration,
  ReconciledStamp,
} from "../types/index.js";

/**
 * Read one changeset history entry as manifest.yaml holds it, accepting the legacy field names
 * (`applied_at`, `action: applied | reverted`). Returns null for an entry this CLI cannot read:
 * no name, no timestamp, or an action other than committed, discarded, applied or reverted.
 */
export function readChangesetHistoryEntry(raw: unknown): ChangesetHistoryEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.length === 0) return null;
  let action: ChangesetHistoryEntry["action"];
  if (entry.action === "committed" || entry.action === "applied") {
    action = "committed";
  } else if (entry.action === "discarded" || entry.action === "reverted") {
    action = "discarded";
  } else {
    return null;
  }
  const at = entry.committed_at ?? entry.applied_at;
  const committedAt = at instanceof Date ? at.toISOString() : typeof at === "string" ? at : "";
  if (!committedAt) return null;
  return { name: entry.name, committed_at: committedAt, action };
}

function historyKey(entry: ChangesetHistoryEntry): string {
  return `${entry.name}\u0000${entry.committed_at}\u0000${entry.action}`;
}

/**
 * Merge the changeset history on disk with the history in memory, so a manifest save never drops
 * an entry: every entry on disk is kept, in its order (an entry this CLI cannot read is kept
 * as written), and each entry in memory that the disk does not have is appended. The disk may
 * hold entries the model in memory never saw, when another process (the MCP server, another
 * CLI run) committed after this model was loaded.
 *
 * @param onDisk - The `changeset_history` value of manifest.yaml as parsed (anything)
 * @param inMemory - The model's history entries
 * @returns `entries`, the merged history to write, and `readable`, those of them this CLI reads
 */
export function mergeChangesetHistory(
  onDisk: unknown,
  inMemory: ChangesetHistoryEntry[]
): { entries: unknown[]; readable: ChangesetHistoryEntry[] } {
  const entries: unknown[] = [];
  const readable: ChangesetHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(onDisk) ? onDisk : []) {
    const entry = readChangesetHistoryEntry(raw);
    if (!entry) {
      entries.push(raw);
      continue;
    }
    const key = historyKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    readable.push(entry);
  }
  for (const entry of inMemory) {
    const key = historyKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    readable.push(entry);
  }
  return { entries, readable };
}

/**
 * Manifest representing model metadata and configuration
 *
 * The Manifest class manages all metadata about a Documentation Robotics model,
 * including project information, changeset history, layer configuration, and
 * external model declarations.
 *
 * This class handles:
 * - Project metadata (name, version, description, author)
 * - Changeset application history
 * - External model declarations for cross-model references
 */
export class Manifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  cliVersion?: string;
  specVersion?: string;
  changeset_history?: ChangesetHistoryEntry[];
  models?: Record<string, ExternalModelDeclaration>;
  codebase_path?: string;
  /** The last as-built landing, which reconciled the model with the code (see core/reconciliation.ts). */
  reconciled?: ReconciledStamp;

  constructor(data: ManifestData) {
    this.name = data.name;
    this.version = data.version;
    this.description = data.description;
    this.author = data.author;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.cliVersion = data.cliVersion;
    this.specVersion = data.specVersion;
    this.models = data.models;
    this.codebase_path = data.codebase_path;
    this.reconciled = data.reconciled;

    // Migrate changeset history from legacy format (if present)
    this.changeset_history = this.migrateChangesetHistory(data.changeset_history);
  }

  /**
   * Migrate changeset history from legacy field names to new format
   * Legacy format: applied_at → committed_at, action: "applied" → action: "committed"
   *
   * @param history - Changeset history from manifest (may use legacy field names)
   * @returns Migrated changeset history using new field names
   * @throws Error if action value is unrecognized (not "committed", "discarded", "applied", or "reverted")
   */
  private migrateChangesetHistory(
    history: ChangesetHistoryEntry[] | undefined
  ): ChangesetHistoryEntry[] {
    if (!history || history.length === 0) {
      return [];
    }

    return history.map((entry: any) => {
      // Validate action value to prevent silent data corruption
      let action: "committed" | "discarded";
      if (entry.action === "applied" || entry.action === "committed") {
        action = "committed";
      } else if (entry.action === "reverted" || entry.action === "discarded") {
        action = "discarded";
      } else {
        throw new Error(
          `Invalid changeset history action '${entry.action}' for changeset '${entry.name}'. ` +
          `Expected: committed, discarded, applied (legacy), or reverted (legacy).`
        );
      }

      return {
        name: entry.name,
        // Handle legacy field name: applied_at → committed_at
        committed_at: entry.committed_at || entry.applied_at || new Date().toISOString(),
        action,
      };
    });
  }

  /**
   * Update the modified timestamp to current time
   */
  updateModified(): void {
    this.modified = new Date().toISOString();
  }

  /**
   * Serialize to JSON representation
   *
   * Converts the Manifest to a JSON-serializable object that includes project
   * metadata, changeset history, and external model declarations.
   *
   * @returns ManifestData object suitable for JSON serialization
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: this.name,
      version: this.version,
      created: this.created,
      modified: this.modified,
    };

    if (this.description) {
      result.description = this.description;
    }

    if (this.author) {
      result.author = this.author;
    }

    if (this.cliVersion) {
      result.cliVersion = this.cliVersion;
    }

    if (this.specVersion) {
      result.specVersion = this.specVersion;
    }

    if (this.codebase_path) {
      result.codebase_path = this.codebase_path;
    }

    if (this.changeset_history && this.changeset_history.length > 0) {
      result.changeset_history = this.changeset_history;
    }

    if (this.models && Object.keys(this.models).length > 0) {
      result.models = this.models;
    }

    if (this.reconciled) {
      result.reconciled = this.reconciled;
    }

    return result;
  }

  /**
   * Create Manifest from JSON string
   */
  static fromJSON(json: string): Manifest {
    const data = JSON.parse(json) as ManifestData;
    return new Manifest(data);
  }

  /**
   * String representation
   */
  toString(): string {
    return `Manifest(${this.name} v${this.version})`;
  }
}
