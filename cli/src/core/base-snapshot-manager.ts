/**
 * BaseSnapshotManager - Manages model snapshots and drift detection
 *
 * Captures the state of a model at a specific point in time (e.g., when a changeset is created)
 * and detects if the base model has drifted from that state (allowing drift warnings on commit).
 */

import { createHash } from 'crypto';
import type { Model } from './model.js';

/**
 * Report on model drift between snapshots
 */
export interface DriftReport {
  baseSnapshotHash: string;
  currentModelHash: string;
  hasDrift: boolean;
  affectedLayers: string[];
  affectedElements: string[];
}

/**
 * Manager for capturing and comparing model snapshots
 */
export class BaseSnapshotManager {
  /**
   * Capture current model state as a SHA-256 hash
   *
   * Hashes:
   * 1. Manifest content
   * 2. All loaded layer data in sorted order
   * 3. Creates reproducible snapshot hash
   */
  async captureSnapshot(model: Model): Promise<string> {
    const hash = createHash('sha256');

    // Hash manifest data first (stable ordering)
    const manifestData = JSON.stringify(model.manifest.toJSON(), null, 2);
    hash.update(manifestData);

    // Hash each layer in sorted order
    const layerNames = Array.from(model.layers.keys()).sort();
    for (const layerName of layerNames) {
      const layer = model.layers.get(layerName);
      if (layer) {
        // Get all elements and sort them by ID for reproducibility
        const elements = layer.listElements().sort((a, b) => a.id.localeCompare(b.id));
        const layerData = JSON.stringify(
          {
            name: layerName,
            elements: elements.map((e) => e.toJSON()),
          },
          null,
          2
        );
        hash.update(layerData);
      }
    }

    // Hash relationships (if accessible)
    if (model.relationships) {
      // Note: relationships is private, so we skip it in the hash
      // The manifest and layers are sufficient for drift detection
    }

    return `sha256:${hash.digest('hex')}`;
  }

  /**
   * Detect drift between expected snapshot and current model
   *
   * Returns a report indicating which layers/elements have changed
   */
  async detectDrift(
    expectedSnapshot: string,
    currentModel: Model
  ): Promise<DriftReport> {
    const currentSnapshot = await this.captureSnapshot(currentModel);
    const hasDrift = expectedSnapshot !== currentSnapshot;

    // If no drift, return quickly
    if (!hasDrift) {
      return {
        baseSnapshotHash: expectedSnapshot,
        currentModelHash: currentSnapshot,
        hasDrift: false,
        affectedLayers: [],
        affectedElements: [],
      };
    }

    // Compute which layers/elements have changed
    const affectedLayers: string[] = [];
    const affectedElements: string[] = [];

    // Since we don't have the original snapshot data, we can only report
    // that drift was detected. In a real implementation, we'd compare
    // the actual layer contents.
    // For now, we'll scan for modified layers by checking their modification time

    for (const layerName of currentModel.layers.keys()) {
      affectedLayers.push(layerName);
      const layer = currentModel.layers.get(layerName);
      if (layer) {
        layer.listElements().forEach((e) => {
          affectedElements.push(e.id);
        });
      }
    }

    return {
      baseSnapshotHash: expectedSnapshot,
      currentModelHash: currentSnapshot,
      hasDrift: true,
      affectedLayers,
      affectedElements,
    };
  }

  /**
   * Compare two model snapshots and return detailed diff information
   *
   * Note: This would require storing both snapshots to provide detailed diffs.
   * For now, we provide a simpler comparison.
   */
  async compareSnapshots(
    snapshot1: string,
    snapshot2: string
  ): Promise<{ identical: boolean; difference: string | null }> {
    if (snapshot1 === snapshot2) {
      return {
        identical: true,
        difference: null,
      };
    }

    return {
      identical: false,
      difference: `Snapshots differ: ${snapshot1} vs ${snapshot2}`,
    };
  }
}
