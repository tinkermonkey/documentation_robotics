/**
 * Model Report Orchestrator
 *
 * Coordinates report generation across all 13 architecture layers.
 * Determines which reports need regeneration and manages the report directory.
 */

import type { Model } from '../core/model.js';
import { ModelReportDataCollector } from './model-report-data.js';
import { ModelLayerReportGenerator } from './model-layer-report-generator.js';
import { ModelReadmeGenerator } from './model-readme-generator.js';
import { CANONICAL_LAYER_NAMES, type CanonicalLayerName, isValidLayerName } from '../core/layers.js';
import { getErrorMessage } from '../utils/errors.js';
import { getLayerReportFileName } from './model-report-utils.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ModelReportOrchestrator {
  private collector: ModelReportDataCollector;
  private generator: ModelLayerReportGenerator;
  private readmeGenerator: ModelReadmeGenerator;

  constructor(private model: Model, private rootPath: string) {
    this.collector = new ModelReportDataCollector();
    const modelVersion = model.manifest.version || 'unknown';
    const generatedAt = new Date().toISOString();
    this.generator = new ModelLayerReportGenerator(modelVersion, generatedAt);
    this.readmeGenerator = new ModelReadmeGenerator();
  }

  /**
   * Regenerate reports for a specific set of affected layers.
   * On first invocation or when reports don't exist, regenerates all 13 reports.
   * Invalid layer names in the affected set are skipped with a warning.
   * Also regenerates the README since it contains model-wide stats that may have changed.
   */
  async regenerate(affectedLayers: Set<string>): Promise<void> {
    if (!(await this.isInitialized())) {
      return this.regenerateAll();
    }

    for (const layerName of affectedLayers) {
      // Type predicate narrows layerName to CanonicalLayerName automatically
      if (!isValidLayerName(layerName)) {
        console.warn(`Skipping invalid layer name: ${layerName}`);
        continue;
      }
      await this.generateLayerReport(layerName);
    }

    // Regenerate README since model-wide stats may have changed
    await this.generateReadme();
  }

  /**
   * Regenerate all 13 layer reports and the README.
   * Lets mkdir errors propagate so callers can handle them with proper telemetry.
   */
  async regenerateAll(): Promise<void> {
    // Ensure report directory exists
    const reportDir = this.getReportDir();
    await fs.mkdir(reportDir, { recursive: true });

    // Generate all 13 layer reports
    for (const layerName of CANONICAL_LAYER_NAMES) {
      await this.generateLayerReport(layerName);
    }

    // Generate README
    await this.generateReadme();
  }

  /**
   * Compute the set of layers affected by a change to a primary layer.
   * Returns the primary layer plus any layers that have cross-layer relationships with it.
   * Throws if the primary layer is not a recognized canonical layer name.
   */
  computeAffectedLayers(primaryLayer: CanonicalLayerName): Set<CanonicalLayerName> {
    // Defense-in-depth: validate despite type signature (guards against as casts from callers)
    if (!isValidLayerName(primaryLayer)) {
      throw new Error(
        `Invalid primary layer name: '${primaryLayer}' is not a recognized canonical layer. ` +
        `Valid layers are: ${CANONICAL_LAYER_NAMES.join(', ')}`
      );
    }

    const affected = new Set<CanonicalLayerName>([primaryLayer]);

    for (const rel of this.model.relationships.getAll()) {
      // Outbound: this layer references another layer
      if (rel.layer === primaryLayer && rel.targetLayer) {
        // Validate layer name before casting (defensive: guards against user-editable YAML with invalid layer names)
        if (isValidLayerName(rel.targetLayer)) {
          affected.add(rel.targetLayer);
        }
      }
      // Inbound: another layer references this layer
      if (rel.targetLayer === primaryLayer) {
        // Validate layer name before casting (defensive: guards against user-editable YAML with invalid layer names)
        if (isValidLayerName(rel.layer)) {
          affected.add(rel.layer);
        }
      }
    }

    return affected;
  }

  /**
   * Check if all 13 report files exist and are initialized.
   * Returns false only if files don't exist (ENOENT); propagates other errors like EACCES, EMFILE, EIO.
   */
  private async isInitialized(): Promise<boolean> {
    for (const layerName of CANONICAL_LAYER_NAMES) {
      try {
        await fs.access(this.getReportFilePath(layerName));
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        // Only ENOENT (file not found) should return false; other errors propagate
        if (err.code === 'ENOENT') {
          return false;
        }
        // Re-throw permission errors, I/O errors, etc.
        throw error;
      }
    }
    return true;
  }

  /**
   * Get the reports directory path.
   */
  private getReportDir(): string {
    return path.join(this.rootPath, 'documentation-robotics', 'reports');
  }

  /**
   * Get the full file path for a layer report.
   */
  private getReportFilePath(layerName: CanonicalLayerName): string {
    const filename = getLayerReportFileName(layerName);
    return path.join(this.getReportDir(), filename);
  }

  /**
   * Generate and write a single layer report.
   * Separates concerns to distinguish programming bugs from I/O errors.
   * Lets generation and write errors propagate so callers can handle them with proper telemetry.
   */
  private async generateLayerReport(layerName: CanonicalLayerName): Promise<void> {
    let data;
    let markdown;

    try {
      // Collect layer data (may throw if programming bug or model is corrupted)
      data = this.collector.collectLayerData(this.model, layerName);

      // Generate markdown report (may throw if programming bug)
      markdown = this.generator.generate(data);
    } catch (error) {
      throw new Error(
        `Failed to generate report content for layer: ${layerName} (programming error or corrupted model) - ${getErrorMessage(error)}`
      );
    }

    // Write to file (may throw for I/O errors like ENOSPC, EACCES, EIO)
    // Let write errors propagate so callers can handle them with proper telemetry
    const filePath = this.getReportFilePath(layerName);
    await fs.writeFile(filePath, markdown, 'utf-8');
  }

  /**
   * Generate and write the model README.
   * Separates concerns to distinguish programming bugs from I/O errors.
   * Lets generation and write errors propagate so callers can handle them with proper telemetry.
   */
  private async generateReadme(): Promise<void> {
    let data;
    let markdown;

    try {
      // Collect model-wide data (may throw if programming bug or model is corrupted)
      data = this.collector.collectModelData(this.model);

      // Generate markdown README (may throw if programming bug)
      markdown = this.readmeGenerator.generate(data);
    } catch (error) {
      throw new Error(
        `Failed to generate README content (programming error or corrupted model) - ${getErrorMessage(error)}`
      );
    }

    // Write to file (may throw for I/O errors like ENOSPC, EACCES, EIO)
    // Let write errors propagate so callers can handle them with proper telemetry
    const filePath = path.join(this.getReportDir(), 'README.md');
    await fs.writeFile(filePath, markdown, 'utf-8');
  }
}
