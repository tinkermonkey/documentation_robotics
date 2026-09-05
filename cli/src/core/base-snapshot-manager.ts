/**
 * BaseSnapshotManager - Manages model snapshots and drift detection
 *
 * Captures the state of a model at a specific point in time (e.g., when a changeset is created)
 * and detects if the base model has drifted from that state (allowing drift warnings on commit).
 */

import { createHash } from "crypto";
import type { Model } from "./model.js";

/**
 * Report on model drift between snapshots
 *
 * NOTE: Current implementation identifies that drift occurred but not the specific
 * changes. To identify actual changes, we would need to store detailed snapshot data
 * (not just hashes). The affectedLayers and affectedElements fields report ALL
 * layers/elements when drift is detected, not specifically what changed.
 */
export interface DriftReport {
  baseSnapshotHash: string;
  currentModelHash: string;
  hasDrift: boolean;
  // When hasDrift is true, these contain ALL current layers/elements (not specific changes)
  // Full diff detection would require storing complete snapshot data
  potentiallyAffectedLayers: string[];
  potentiallyAffectedElements: string[];
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
    const hash = createHash("sha256");

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

    return `sha256:${hash.digest("hex")}`;
  }

  /**
   * Detect drift between expected snapshot and current model
   *
   * Returns a report indicating whether drift occurred.
   *
   * NOTE: This method only identifies that the model has changed (hasDrift: true/false).
   * It cannot determine which specific layers/elements changed without storing
   * detailed snapshot data. When drift is detected, potentiallyAffectedLayers and
   * potentiallyAffectedElements contain ALL current layers/elements as a conservative
   * estimate. For precise change detection, implement snapshot comparison with
   * stored layer/element state data.
   */
  async detectDrift(expectedSnapshot: string, currentModel: Model): Promise<DriftReport> {
    const currentSnapshot = await this.captureSnapshot(currentModel);
    const hasDrift = expectedSnapshot !== currentSnapshot;

    // If no drift, return quickly
    if (!hasDrift) {
      return {
        baseSnapshotHash: expectedSnapshot,
        currentModelHash: currentSnapshot,
        hasDrift: false,
        potentiallyAffectedLayers: [],
        potentiallyAffectedElements: [],
      };
    }

    // Drift detected but we cannot pinpoint exact changes without stored snapshot data
    // Return all current layers/elements as potentially affected
    const potentiallyAffectedLayers: string[] = [];
    const potentiallyAffectedElements: string[] = [];

    for (const layerName of currentModel.layers.keys()) {
      potentiallyAffectedLayers.push(layerName);
      const layer = currentModel.layers.get(layerName);
      if (layer) {
        layer.listElements().forEach((e) => {
          potentiallyAffectedElements.push(e.id);
        });
      }
    }

    return {
      baseSnapshotHash: expectedSnapshot,
      currentModelHash: currentSnapshot,
      hasDrift: true,
      potentiallyAffectedLayers,
      potentiallyAffectedElements,
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
