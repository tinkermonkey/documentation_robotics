/**
 * Farm Sync State - Manages .farm-sync.yaml per project
 *
 * Tracks sync history, last sync commit, and timestamps for each project.
 */

import yaml from "yaml";
import { readFile, writeFile, fileExists } from "../utils/file-io.js";

/**
 * Represents a single sync record
 */
export interface SyncRecord {
  timestamp: string; // ISO 8601 timestamp
  commit: string; // Commit SHA where sync occurred
  changesetId?: string; // ID of generated changeset
  filesChanged?: number; // Number of files that changed
  elementsAffected?: number; // Number of model elements affected
  status: "success" | "partial" | "failed"; // Status of the sync
  notes?: string; // Optional notes about the sync
}

/**
 * Farm sync state for a single project
 */
export interface FarmSyncStateData {
  projectName: string;
  lastSyncCommit?: string; // Last successful sync commit SHA
  lastSyncTimestamp?: string; // ISO 8601 timestamp
  syncHistory: SyncRecord[]; // Complete history of syncs
  ambiguities?: Array<{
    filePath: string;
    possibleElements: Array<{
      elementId: string;
      layer: string;
      confidence: number; // 0-100 confidence score
    }>;
  }>; // Ambiguous file-to-element mappings flagged for review
}

/**
 * FarmSyncState class - Load, validate, and save farm sync state per project
 */
export class FarmSyncState {
  projectName: string;
  lastSyncCommit?: string;
  lastSyncTimestamp?: string;
  syncHistory: SyncRecord[];
  ambiguities: Array<{
    filePath: string;
    possibleElements: Array<{
      elementId: string;
      layer: string;
      confidence: number;
    }>;
  }>;
  filePath?: string;

  constructor(data: FarmSyncStateData) {
    this.projectName = data.projectName;
    this.lastSyncCommit = data.lastSyncCommit;
    this.lastSyncTimestamp = data.lastSyncTimestamp;
    this.syncHistory = data.syncHistory || [];
    this.ambiguities = data.ambiguities || [];
  }

  /**
   * Load farm sync state from file
   * @param filePath - Path to .farm-sync.yaml
   * @returns FarmSyncState instance
   */
  static async load(filePath: string): Promise<FarmSyncState> {
    if (!(await fileExists(filePath))) {
      throw new Error(`Farm sync state file not found: ${filePath}`);
    }

    const content = await readFile(filePath);
    const data = yaml.parse(content) as FarmSyncStateData;

    if (!data.projectName) {
      throw new Error("Farm sync state must have a 'projectName' field");
    }

    const state = new FarmSyncState(data);
    state.filePath = filePath;
    return state;
  }

  /**
   * Create a new farm sync state
   * @param projectName - Name of the project
   * @param options - Optional initial state
   * @returns FarmSyncState instance
   */
  static create(
    projectName: string,
    options: {
      lastSyncCommit?: string;
      lastSyncTimestamp?: string;
    } = {}
  ): FarmSyncState {
    return new FarmSyncState({
      projectName,
      lastSyncCommit: options.lastSyncCommit,
      lastSyncTimestamp: options.lastSyncTimestamp,
      syncHistory: [],
      ambiguities: [],
    });
  }

  /**
   * Load or create farm sync state
   * @param filePath - Path to .farm-sync.yaml
   * @param projectName - Project name (used if creating new)
   * @returns FarmSyncState instance
   */
  static async loadOrCreate(filePath: string, projectName: string): Promise<FarmSyncState> {
    if (await fileExists(filePath)) {
      return this.load(filePath);
    }
    return this.create(projectName);
  }

  /**
   * Save state to file
   * @param filePath - Path where to save .farm-sync.yaml
   */
  async save(filePath?: string): Promise<void> {
    const targetPath = filePath || this.filePath;
    if (!targetPath) {
      throw new Error("No file path specified for saving farm sync state");
    }

    const data = this.toJSON();
    const yamlContent = yaml.stringify(data, { lineWidth: 0 });

    await writeFile(targetPath, yamlContent);
    this.filePath = targetPath;
  }

  /**
   * Record a sync (successful or failed)
   */
  recordSync(record: Omit<SyncRecord, "status"> & { status?: "success" | "partial" | "failed" }): void {
    const status = record.status || "success";

    // Only update lastSyncCommit on successful syncs to avoid advancing past unprocessed changes
    if (status === "success") {
      this.lastSyncCommit = record.commit;
      this.lastSyncTimestamp = record.timestamp;
    }

    this.syncHistory.push({
      timestamp: record.timestamp,
      commit: record.commit,
      status,
      changesetId: record.changesetId,
      filesChanged: record.filesChanged,
      elementsAffected: record.elementsAffected,
      notes: record.notes,
    });

    // Keep history trimmed to last 100 syncs
    if (this.syncHistory.length > 100) {
      this.syncHistory = this.syncHistory.slice(-100);
    }
  }

  /**
   * Record ambiguous file-to-element mappings for review
   */
  recordAmbiguities(
    ambiguities: Array<{
      filePath: string;
      possibleElements: Array<{
        elementId: string;
        layer: string;
        confidence: number;
      }>;
    }>
  ): void {
    this.ambiguities = ambiguities;
  }

  /**
   * Clear ambiguities after review
   */
  clearAmbiguities(): void {
    this.ambiguities = [];
  }

  /**
   * Get the last sync record if any
   */
  getLastSync(): SyncRecord | undefined {
    return this.syncHistory.length > 0 ? this.syncHistory[this.syncHistory.length - 1] : undefined;
  }

  /**
   * Serialize to JSON representation for saving
   */
  toJSON(): FarmSyncStateData {
    return {
      projectName: this.projectName,
      lastSyncCommit: this.lastSyncCommit,
      lastSyncTimestamp: this.lastSyncTimestamp,
      syncHistory: this.syncHistory,
      ...(this.ambiguities.length > 0 && { ambiguities: this.ambiguities }),
    };
  }
}
