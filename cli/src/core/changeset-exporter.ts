/**
 * ChangesetExporter - Export changesets to portable formats
 *
 * Supports exporting changesets in multiple formats:
 * - YAML: Human-readable format with full changeset metadata
 * - JSON: Machine-readable format for programmatic use
 * - Patch: Git-style unified diff format for version control
 */

import { readFile, writeFile } from 'fs/promises';
import { fileExists } from '../utils/file-io.js';
import yaml from 'yaml';
import { Changeset, type ChangesetStatus, type Change } from './changeset.js';
import { StagedChangesetStorage } from './staged-changeset-storage.js';
import type { Model } from './model.js';
import { BaseSnapshotManager } from './base-snapshot-manager.js';

/**
 * Export format type
 */
export type ExportFormat = 'yaml' | 'json' | 'patch';

/**
 * Compatibility report for imported changesets
 */
export interface CompatibilityReport {
  compatible: boolean;
  baseSnapshotMatch: boolean;
  missingElements: string[];
  warnings: string[];
  affectedLayers: string[];
}

/**
 * Exporter for changesets in portable formats
 */
export class ChangesetExporter {
  private storage: StagedChangesetStorage;
  private snapshotManager: BaseSnapshotManager;

  constructor(rootPath: string) {
    this.storage = new StagedChangesetStorage(rootPath);
    this.snapshotManager = new BaseSnapshotManager();
  }

  /**
   * Export changeset to string in specified format
   */
  async export(
    changesetId: string,
    format: ExportFormat = 'yaml'
  ): Promise<string> {
    const changeset = await this.storage.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    switch (format) {
      case 'yaml':
        return this.exportToYaml(changeset);
      case 'json':
        return this.exportToJson(changeset);
      case 'patch':
        return this.exportToPatch(changeset);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Export changeset to file
   */
  async exportToFile(
    changesetId: string,
    outputPath: string,
    format: ExportFormat = 'yaml'
  ): Promise<void> {
    const content = await this.export(changesetId, format);
    await writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Import changeset from string
   */
  async import(data: string, format?: ExportFormat): Promise<Changeset> {
    // Auto-detect format if not specified
    if (!format) {
      format = this.detectFormat(data);
    }

    switch (format) {
      case 'yaml':
        return this.importFromYaml(data);
      case 'json':
        return this.importFromJson(data);
      case 'patch':
        return this.importFromPatch(data);
      default:
        throw new Error(`Unsupported import format: ${format}`);
    }
  }

  /**
   * Import changeset from file
   */
  async importFromFile(inputPath: string): Promise<Changeset> {
    if (!(await fileExists(inputPath))) {
      throw new Error(`File not found: ${inputPath}`);
    }

    const data = await readFile(inputPath, 'utf-8');
    const format = this.detectFormat(data);

    return this.import(data, format);
  }

  /**
   * Validate imported changeset compatibility with current model
   */
  async validateCompatibility(
    changeset: Changeset,
    currentModel: Model
  ): Promise<CompatibilityReport> {
    const report: CompatibilityReport = {
      compatible: true,
      baseSnapshotMatch: true,
      missingElements: [],
      warnings: [],
      affectedLayers: [],
    };

    // Check base snapshot match
    if (changeset.baseSnapshot) {
      const currentSnapshot = await this.snapshotManager.captureSnapshot(
        currentModel
      );
      if (changeset.baseSnapshot !== currentSnapshot) {
        report.baseSnapshotMatch = false;
        report.warnings.push(
          'Base model has changed since changeset was created'
        );
      }
    }

    // Validate all elements referenced in changes exist in current model
    // (for updates and deletes)
    const affectedLayerSet = new Set<string>();

    for (const change of changeset.changes || []) {
      affectedLayerSet.add(change.layerName);

      if (change.type === 'update' || change.type === 'delete') {
        // For updates and deletes, element must exist in current model
        const layer = await currentModel.getLayer(change.layerName);
        if (!layer || !layer.getElement(change.elementId)) {
          if (change.type === 'delete') {
            // Deletes of non-existent elements are warnings, not blockers
            report.warnings.push(
              `Element ${change.elementId} not found in layer ${change.layerName} (will be skipped)`
            );
          } else {
            // Updates of non-existent elements are errors
            report.compatible = false;
            report.missingElements.push(change.elementId);
            report.warnings.push(
              `Cannot update non-existent element ${change.elementId}`
            );
          }
        }
      }

      // For adds, element must not exist
      if (change.type === 'add') {
        const layer = await currentModel.getLayer(change.layerName);
        if (layer && layer.getElement(change.elementId)) {
          report.compatible = false;
          report.warnings.push(
            `Element ${change.elementId} already exists in layer ${change.layerName}`
          );
        }
      }
    }

    report.affectedLayers = Array.from(affectedLayerSet);

    return report;
  }

  /**
   * Export changeset to YAML format
   */
  private exportToYaml(changeset: Changeset): string {
    const exportData = {
      id: changeset.id,
      name: changeset.name,
      description: changeset.description,
      created: changeset.created,
      modified: changeset.modified,
      status: changeset.status,
      baseSnapshot: changeset.baseSnapshot,
      export: {
        version: '0.1.0',
        exportedAt: new Date().toISOString(),
        format: 'yaml',
      },
      stats: changeset.stats || {
        additions: 0,
        modifications: 0,
        deletions: 0,
      },
      changes: changeset.changes || [],
    };

    return yaml.stringify(exportData, {
      indent: 2,
      lineWidth: 120,
    });
  }

  /**
   * Export changeset to JSON format
   */
  private exportToJson(changeset: Changeset): string {
    const exportData = {
      id: changeset.id,
      name: changeset.name,
      description: changeset.description,
      created: changeset.created,
      modified: changeset.modified,
      status: changeset.status,
      baseSnapshot: changeset.baseSnapshot,
      export: {
        version: '0.1.0',
        exportedAt: new Date().toISOString(),
        format: 'json',
      },
      stats: changeset.stats || {
        additions: 0,
        modifications: 0,
        deletions: 0,
      },
      changes: changeset.changes || [],
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export changeset to patch format (Git-style unified diff)
   */
  private exportToPatch(changeset: Changeset): string {
    const lines: string[] = [];

    // Patch header
    lines.push(`From: ${changeset.id}`);
    lines.push(`Date: ${new Date().toISOString()}`);
    if (changeset.baseSnapshot) {
      lines.push(`Base: ${changeset.baseSnapshot}`);
    }
    lines.push(`Subject: ${changeset.name}`);
    lines.push('');
    if (changeset.description) {
      lines.push(changeset.description);
      lines.push('');
    }

    // Summary statistics
    const stats = changeset.stats || {
      additions: 0,
      modifications: 0,
      deletions: 0,
    };
    lines.push('---');
    lines.push(
      ` ${stats.additions + stats.modifications + stats.deletions} file${stats.additions + stats.modifications + stats.deletions !== 1 ? 's' : ''} changed, ${stats.additions} insertions(+), ${stats.deletions} deletions(-)`
    );
    lines.push('');

    // Group changes by layer for diff-style output
    const layerMap = new Map<string, (typeof changeset.changes)[number][]>();
    for (const change of changeset.changes || []) {
      if (!layerMap.has(change.layerName)) {
        layerMap.set(change.layerName, []);
      }
      layerMap.get(change.layerName)!.push(change);
    }

    // Generate diff-style output for each layer
    for (const [layerName, changes] of layerMap) {
      const filePath = `${layerName}/elements.yaml`;
      lines.push(`diff --git a/${filePath} b/${filePath}`);
      lines.push(`index abc123..def456 100644`);
      lines.push(`--- a/${filePath}`);
      lines.push(`+++ b/${filePath}`);

      // Add hunk header
      lines.push(`@@ -10,3 +10,${changes.length + 3} @@`);

      // Show context and changes
      for (const change of changes) {
        if (change.type === 'add') {
          lines.push(`+ - id: ${change.elementId}`);
          if (change.after) {
            const afterData = change.after as Record<string, unknown>;
            if (afterData.name) {
              lines.push(`+   name: "${afterData.name}"`);
            }
            if (afterData.type) {
              lines.push(`+   type: ${afterData.type}`);
            }
            if (afterData.properties) {
              lines.push(
                `+   properties: ${JSON.stringify(afterData.properties)}`
              );
            }
          }
        } else if (change.type === 'delete') {
          lines.push(`- - id: ${change.elementId}`);
          if (change.before) {
            const beforeData = change.before as Record<string, unknown>;
            if (beforeData.name) {
              lines.push(`-   name: "${beforeData.name}"`);
            }
            if (beforeData.type) {
              lines.push(`-   type: ${beforeData.type}`);
            }
          }
        } else if (change.type === 'update') {
          // Show context line and changes
          lines.push(`  - id: ${change.elementId}`);
          if (change.before && change.after) {
            const beforeData = change.before as Record<string, unknown>;
            const afterData = change.after as Record<string, unknown>;
            if (beforeData.name !== afterData.name) {
              lines.push(`-   name: "${beforeData.name}"`);
              lines.push(`+   name: "${afterData.name}"`);
            }
          }
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Import changeset from YAML format
   */
  private importFromYaml(data: string): Changeset {
    const parsed = yaml.parse(data);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid YAML format');
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const {
      id,
      name,
      description,
      created,
      modified,
      status,
      baseSnapshot,
      changes = [],
      stats,
    } = parsedRecord;

    if (!id || !name || !created || !modified) {
      throw new Error(
        'Missing required fields: id, name, created, modified'
      );
    }

    // Reconstruct changeset with defaults for optional fields
    const changesetStatus = (typeof status === 'string' ? status : 'draft') as ChangesetStatus;
    const statsRecord = stats as Record<string, unknown> | undefined;
    const changesetStats = {
      additions: typeof statsRecord?.additions === 'number' ? statsRecord.additions : 0,
      modifications: typeof statsRecord?.modifications === 'number' ? statsRecord.modifications : 0,
      deletions: typeof statsRecord?.deletions === 'number' ? statsRecord.deletions : 0,
    };
    const changesetSnapshot = typeof baseSnapshot === 'string' ? baseSnapshot : 'unknown';

    const changeset = new Changeset({
      id: String(id),
      name: String(name),
      description: typeof description === 'string' ? description : undefined,
      created: String(created),
      modified: String(modified),
      status: changesetStatus,
      baseSnapshot: changesetSnapshot,
      changes: (changes as Change[]) || [],
      stats: changesetStats,
    });

    return changeset;
  }

  /**
   * Import changeset from JSON format
   */
  private importFromJson(data: string): Changeset {
    const parsed = JSON.parse(data);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON format');
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const {
      id,
      name,
      description,
      created,
      modified,
      status,
      baseSnapshot,
      changes = [],
      stats,
    } = parsedRecord;

    if (!id || !name || !created || !modified) {
      throw new Error(
        'Missing required fields: id, name, created, modified'
      );
    }

    // Reconstruct changeset with defaults for optional fields
    const changesetStatus = (typeof status === 'string' ? status : 'draft') as ChangesetStatus;
    const statsRecord = stats as Record<string, unknown> | undefined;
    const changesetStats = {
      additions: typeof statsRecord?.additions === 'number' ? statsRecord.additions : 0,
      modifications: typeof statsRecord?.modifications === 'number' ? statsRecord.modifications : 0,
      deletions: typeof statsRecord?.deletions === 'number' ? statsRecord.deletions : 0,
    };
    const changesetSnapshot = typeof baseSnapshot === 'string' ? baseSnapshot : 'unknown';

    const changeset = new Changeset({
      id: String(id),
      name: String(name),
      description: typeof description === 'string' ? description : undefined,
      created: String(created),
      modified: String(modified),
      status: changesetStatus,
      baseSnapshot: changesetSnapshot,
      changes: (changes as Change[]) || [],
      stats: changesetStats,
    });

    return changeset;
  }

  /**
   * Import changeset from patch format
   *
   * NOTE: Patch format import extracts metadata and base snapshot from headers only.
   * The unified diff format makes it impractical to reconstruct full change details
   * without complex diff parsing. For this reason, patch format import returns a
   * changeset with empty changes array and is primarily useful for preserving metadata.
   *
   * Use YAML or JSON formats for changesets that need to be re-imported with full
   * change data. Patch format is recommended for email-based sharing and archival.
   */
  private importFromPatch(data: string): Changeset {
    const lines = data.split('\n');
    const metadata: Record<string, string> = {};
    const changes: Change[] = [];

    let i = 0;
    // Parse header lines - continue until we hit the --- marker or blank line
    while (i < lines.length && !lines[i].startsWith('---') && lines[i].trim() !== '') {
      const line = lines[i];
      if (line.startsWith('From:')) {
        metadata.id = line.substring('From:'.length).trim();
      } else if (line.startsWith('Date:')) {
        metadata.exportedAt = line.substring('Date:'.length).trim();
      } else if (line.startsWith('Base:')) {
        metadata.baseSnapshot = line.substring('Base:'.length).trim();
      } else if (line.startsWith('Subject:')) {
        metadata.name = line.substring('Subject:'.length).trim();
      }
      i++;
    }

    // Skip blank lines
    while (i < lines.length && lines[i].trim() === '') {
      i++;
    }

    // Description is between header and --- marker
    const descriptionLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith('---')) {
      descriptionLines.push(lines[i]);
      i++;
    }
    if (descriptionLines.length > 0) {
      metadata.description = descriptionLines.join('\n').trim();
    }

    // Validate required metadata
    if (!metadata.id || !metadata.name) {
      throw new Error('Missing required fields in patch header: id, name');
    }

    // Create changeset with extracted metadata
    // Note: changes array remains empty as diff parsing is complex
    const changeset = new Changeset({
      id: metadata.id,
      name: metadata.name,
      description: metadata.description,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      status: 'draft',
      baseSnapshot: metadata.baseSnapshot || 'unknown',
      changes,
      stats: {
        additions: 0,
        modifications: 0,
        deletions: 0,
      },
    });

    return changeset;
  }

  /**
   * Detect export format from content
   */
  private detectFormat(data: string): ExportFormat {
    const trimmed = data.trim();

    // Check for JSON
    if (trimmed.startsWith('{')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Not valid JSON, try next format
      }
    }

    // Check for YAML
    if (trimmed.includes('id:') && trimmed.includes('name:')) {
      try {
        yaml.parse(trimmed);
        return 'yaml';
      } catch {
        // Not valid YAML, try next format
      }
    }

    // Check for patch format
    if (trimmed.startsWith('From:')) {
      return 'patch';
    }

    // Default to YAML
    return 'yaml';
  }
}
