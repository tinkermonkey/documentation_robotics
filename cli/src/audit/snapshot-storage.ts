/**
 * Audit snapshot storage and management
 *
 * Provides persistence for audit reports to enable temporal analysis
 * and before/after differential comparison.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { AuditReport } from "./types.js";

/**
 * Metadata for a stored audit snapshot
 */
export interface SnapshotMetadata {
  id: string; // Unique identifier (timestamp-based)
  timestamp: string; // ISO 8601 timestamp
  modelName: string;
  modelVersion: string;
  layers: string[]; // Layers included in this snapshot
  snapshotPath: string; // Path to snapshot file
}

/**
 * Snapshot storage configuration
 */
export interface SnapshotStorageConfig {
  storageDir?: string; // Override default storage directory
  maxSnapshots?: number; // Maximum snapshots to retain (0 = unlimited)
}

/**
 * Manager for audit snapshot persistence
 */
export class SnapshotStorage {
  private readonly storageDir: string;
  private readonly maxSnapshots: number;

  constructor(config: SnapshotStorageConfig = {}) {
    this.storageDir =
      config.storageDir || path.join(process.cwd(), ".dr", "audit-snapshots");
    this.maxSnapshots = config.maxSnapshots || 0; // Unlimited by default
  }

  /**
   * Initialize storage directory
   */
  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Generate snapshot ID from timestamp
   */
  private generateSnapshotId(timestamp: string): string {
    // Format: YYYYMMDD-HHmmss
    const date = new Date(timestamp);
    const formatted = date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    return formatted;
  }

  /**
   * Get snapshot file path
   */
  private getSnapshotPath(id: string): string {
    return path.join(this.storageDir, `${id}.json`);
  }

  /**
   * Get metadata file path
   */
  private getMetadataPath(id: string): string {
    return path.join(this.storageDir, `${id}.meta.json`);
  }

  /**
   * Save an audit report as a snapshot
   */
  async save(report: AuditReport): Promise<SnapshotMetadata> {
    await this.ensureStorageDir();

    const id = this.generateSnapshotId(report.timestamp);
    const snapshotPath = this.getSnapshotPath(id);
    const metadataPath = this.getMetadataPath(id);

    // Extract layers from coverage data
    const layers = report.coverage.map((c) => c.layer);

    const metadata: SnapshotMetadata = {
      id,
      timestamp: report.timestamp,
      modelName: report.model.name,
      modelVersion: report.model.version,
      layers,
      snapshotPath,
    };

    // Write snapshot data
    await fs.writeFile(snapshotPath, JSON.stringify(report, null, 2), "utf-8");

    // Write metadata
    await fs.writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );

    // Cleanup old snapshots if limit exceeded
    if (this.maxSnapshots > 0) {
      await this.cleanupOldSnapshots();
    }

    return metadata;
  }

  /**
   * Load a snapshot by ID or timestamp
   */
  async load(idOrTimestamp: string): Promise<AuditReport> {
    await this.ensureStorageDir();

    let id: string;

    // Check if input is already a snapshot ID
    if (/^\d{8}-\d{6}$/.test(idOrTimestamp)) {
      id = idOrTimestamp;
    } else {
      // Assume it's a timestamp, convert to ID
      id = this.generateSnapshotId(idOrTimestamp);
    }

    const snapshotPath = this.getSnapshotPath(id);

    try {
      const content = await fs.readFile(snapshotPath, "utf-8");
      return JSON.parse(content) as AuditReport;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Snapshot not found: ${id}. Use 'dr audit snapshots' to list available snapshots.`,
        );
      }
      throw error;
    }
  }

  /**
   * List all available snapshots
   */
  async list(): Promise<SnapshotMetadata[]> {
    await this.ensureStorageDir();

    try {
      const files = await fs.readdir(this.storageDir);
      const metadataFiles = files.filter((f) => f.endsWith(".meta.json"));

      const snapshots: SnapshotMetadata[] = [];
      for (const file of metadataFiles) {
        const content = await fs.readFile(
          path.join(this.storageDir, file),
          "utf-8",
        );
        snapshots.push(JSON.parse(content) as SnapshotMetadata);
      }

      // Sort by timestamp (newest first)
      return snapshots.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // Directory doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Delete a snapshot
   */
  async delete(idOrTimestamp: string): Promise<void> {
    await this.ensureStorageDir();

    let id: string;
    if (/^\d{8}-\d{6}$/.test(idOrTimestamp)) {
      id = idOrTimestamp;
    } else {
      id = this.generateSnapshotId(idOrTimestamp);
    }

    const snapshotPath = this.getSnapshotPath(id);
    const metadataPath = this.getMetadataPath(id);

    await Promise.all([
      fs.unlink(snapshotPath).catch(() => {}), // Ignore if doesn't exist
      fs.unlink(metadataPath).catch(() => {}),
    ]);
  }

  /**
   * Get the most recent snapshot
   */
  async getLatest(): Promise<AuditReport | null> {
    const snapshots = await this.list();
    if (snapshots.length === 0) {
      return null;
    }
    return this.load(snapshots[0].id);
  }

  /**
   * Get the two most recent snapshots for comparison
   */
  async getLatestPair(): Promise<
    [AuditReport, AuditReport] | [null, null]
  > {
    const snapshots = await this.list();
    if (snapshots.length < 2) {
      return [null, null];
    }

    const [after, before] = await Promise.all([
      this.load(snapshots[0].id),
      this.load(snapshots[1].id),
    ]);

    return [before, after];
  }

  /**
   * Clean up old snapshots beyond the retention limit
   */
  private async cleanupOldSnapshots(): Promise<void> {
    const snapshots = await this.list();

    if (snapshots.length <= this.maxSnapshots) {
      return;
    }

    const toDelete = snapshots.slice(this.maxSnapshots);
    await Promise.all(toDelete.map((s) => this.delete(s.id)));
  }

  /**
   * Clear all snapshots
   */
  async clear(): Promise<void> {
    const snapshots = await this.list();
    await Promise.all(snapshots.map((s) => this.delete(s.id)));
  }
}
