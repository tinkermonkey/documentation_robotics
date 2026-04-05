/**
 * Model Report Orchestrator
 *
 * Coordinates report generation across all 12 architecture layers.
 * Determines which reports need regeneration and manages the report directory.
 */

import type { Model } from '../core/model.js';
import { ModelReportDataCollector } from './model-report-data.js';
import { ModelLayerReportGenerator } from './model-layer-report-generator.js';
import { CANONICAL_LAYER_NAMES, getLayerOrder, isValidLayerName } from '../core/layers.js';
import { getErrorMessage } from '../utils/errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ModelReportOrchestrator {
  private collector: ModelReportDataCollector;
  private generator: ModelLayerReportGenerator;

  constructor(private model: Model, private rootPath: string) {
    this.collector = new ModelReportDataCollector();
    const modelVersion = model.manifest.version || 'unknown';
    const generatedAt = new Date().toISOString();
    this.generator = new ModelLayerReportGenerator(modelVersion, generatedAt);
  }

  /**
   * Regenerate reports for a specific set of affected layers.
   * On first invocation or when reports don't exist, regenerates all 12 reports.
   * Invalid layer names in the affected set are skipped with a warning.
   */
  async regenerate(affectedLayers: Set<string>): Promise<void> {
    if (!(await this.isInitialized())) {
      return this.regenerateAll();
    }

    for (const layerName of affectedLayers) {
      // Validate layer name before processing
      if (!isValidLayerName(layerName)) {
        console.warn(`Skipping invalid layer name: ${layerName}`);
        continue;
      }
      await this.generateLayerReport(layerName);
    }
  }

  /**
   * Regenerate all 12 layer reports.
   */
  async regenerateAll(): Promise<void> {
    // Ensure report directory exists
    const reportDir = this.getReportDir();
    try {
      await fs.mkdir(reportDir, { recursive: true });
    } catch (error) {
      emitLog(
        SeverityNumber.WARN,
        "Failed to create reports directory, skipping report generation",
        {
          "reportDir": reportDir,
          "error.message": getErrorMessage(error),
        }
      );
      return;
    }

    // Generate all 12 layer reports
    for (const layerName of CANONICAL_LAYER_NAMES) {
      await this.generateLayerReport(layerName);
    }
  }

  /**
   * Compute the set of layers affected by a change to a primary layer.
   * Returns the primary layer plus any layers that have cross-layer relationships with it.
   * Throws if the primary layer is not a recognized canonical layer name.
   */
  computeAffectedLayers(primaryLayer: string): Set<string> {
    // Validate that the primary layer is a known canonical layer
    if (!isValidLayerName(primaryLayer)) {
      throw new Error(
        `Invalid primary layer name: '${primaryLayer}' is not a recognized canonical layer. ` +
        `Valid layers are: ${CANONICAL_LAYER_NAMES.join(', ')}`
      );
    }

    const affected = new Set<string>([primaryLayer]);

    for (const rel of this.model.relationships.getAll()) {
      // Outbound: this layer references another layer
      if (rel.layer === primaryLayer && rel.targetLayer) {
        affected.add(rel.targetLayer);
      }
      // Inbound: another layer references this layer
      if (rel.targetLayer === primaryLayer) {
        affected.add(rel.layer);
      }
    }

    return affected;
  }

  /**
   * Check if all 12 report files exist and are initialized.
   */
  private async isInitialized(): Promise<boolean> {
    try {
      for (const layerName of CANONICAL_LAYER_NAMES) {
        await fs.access(this.getReportFilePath(layerName));
      }
      return true;
    } catch {
      return false;
    }
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
  private getReportFilePath(layerName: string): string {
    const layerNumber = getLayerOrder(layerName);
    const paddedNumber = String(layerNumber).padStart(2, '0');
    const filename = `${paddedNumber}-${layerName}-layer-report.md`;
    return path.join(this.getReportDir(), filename);
  }

  /**
   * Generate and write a single layer report.
   * Wraps generation in try/catch to isolate failures.
   */
  private async generateLayerReport(layerName: string): Promise<void> {
    try {
      // Collect layer data
      const data = this.collector.collectLayerData(this.model, layerName);

      // Generate markdown report
      const markdown = this.generator.generate(data);

      // Write to file
      const filePath = this.getReportFilePath(layerName);
      await fs.writeFile(filePath, markdown, 'utf-8');
    } catch (error) {
      console.warn(`Failed to generate report for layer: ${layerName} - ${getErrorMessage(error)}`);
    }
  }
}
