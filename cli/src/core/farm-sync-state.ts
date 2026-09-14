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
  changeset?: string; // ID of generated changeset
  files_changed?: number; // Number of files that changed
  elements_affected?: number; // Number of model elements affected
  status: "success" | "partial" | "failed"; // Status of the sync
  notes?: string; // Optional notes about the sync
}

/**
 * Farm sync state for a single project
 */
export interface FarmSyncStateData {
  project_name: string;
  last_sync_commit?: string; // Last successful sync commit SHA
  last_sync_timestamp?: string; // ISO 8601 timestamp
  sync_history: SyncRecord[]; // Complete history of syncs
  ambiguities?: Array<{
    file_path: string;
    possible_elements: Array<{
      element_id: string;
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
    this.projectName = data.project_name;
    this.lastSyncCommit = data.last_sync_commit;
    this.lastSyncTimestamp = data.last_sync_timestamp;
    this.syncHistory = data.sync_history || [];
    this.ambiguities = data.ambiguities?.map(a => ({
      filePath: a.file_path,
      possibleElements: a.possible_elements.map(e => ({
        elementId: e.element_id,
        layer: e.layer,
        confidence: e.confidence,
      })),
    })) || [];
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
    const rawData = yaml.parse(content) as any;

    if (!rawData) {
      throw new Error(
        `Invalid farm sync state: file is empty or contains invalid YAML at ${filePath}`
      );
    }

    // Handle both old (camelCase) and new (snake_case) formats for backward compatibility
    const data: FarmSyncStateData = {
      project_name: rawData.project_name || rawData.projectName,
      last_sync_commit: rawData.last_sync_commit || rawData.lastSyncCommit,
      last_sync_timestamp: rawData.last_sync_timestamp || rawData.lastSyncTimestamp,
      sync_history: (rawData.sync_history || rawData.syncHistory || []).map((record: any) => ({
        timestamp: record.timestamp,
        commit: record.commit,
        changeset: record.changeset || record.changesetId,
        files_changed: record.files_changed || record.filesChanged,
        elements_affected: record.elements_affected || record.elementsAffected,
        status: record.status,
        notes: record.notes,
      })),
      ambiguities: (rawData.ambiguities || []).map((a: any) => ({
        file_path: a.file_path || a.filePath,
        possible_elements: (a.possible_elements || a.possibleElements || []).map((e: any) => ({
          element_id: e.element_id || e.elementId,
          layer: e.layer,
          confidence: e.confidence,
        })),
      })),
    };

    if (!data.project_name) {
      throw new Error("Farm sync state must have a 'project_name' field");
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
      project_name: projectName,
      last_sync_commit: options.lastSyncCommit,
      last_sync_timestamp: options.lastSyncTimestamp,
      sync_history: [],
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

    // Update lastSyncCommit on successful and partial syncs to avoid reprocessing confident files.
    // Failed syncs do not advance the pointer (will retry from same point).
    // Partial syncs advance because confident files have been processed and staged;
    // ambiguous files are tracked separately for manual review.
    if (status === "success" || status === "partial") {
      this.lastSyncCommit = record.commit;
      this.lastSyncTimestamp = record.timestamp;
    }

    this.syncHistory.push({
      timestamp: record.timestamp,
      commit: record.commit,
      status,
      changeset: record.changeset,
      files_changed: record.files_changed,
      elements_affected: record.elements_affected,
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
      project_name: this.projectName,
      last_sync_commit: this.lastSyncCommit,
      last_sync_timestamp: this.lastSyncTimestamp,
      sync_history: this.syncHistory.map(record => ({
        timestamp: record.timestamp,
        commit: record.commit,
        changeset: record.changeset,
        files_changed: record.files_changed,
        elements_affected: record.elements_affected,
        status: record.status,
        notes: record.notes,
      })),
      ...(this.ambiguities.length > 0 && {
        ambiguities: this.ambiguities.map(a => ({
          file_path: a.filePath,
          possible_elements: a.possibleElements.map(e => ({
            element_id: e.elementId,
            layer: e.layer,
            confidence: e.confidence,
          })),
        }))
      }),
    };
  }
}
