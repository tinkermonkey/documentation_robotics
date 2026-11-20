/**
 * BaseSnapshotManager - the base model's hash, recorded on a changeset when it is created (its
 * `baseSnapshot`) and compared at landing to tell whether the base moved under it.
 *
 * Two formats:
 * - The content snapshot (`v2:sha256:<hex>`, `captureSnapshot`): the content of every base element
 *   (type, name, description, attributes, source reference) and every base relationship, and
 *   nothing else. It is the hash of the changeset's base index (changeset-base-index.ts), so the
 *   hash differs exactly when the index would list a change. The manifest (its `modified`,
 *   `cliVersion`, `changeset_history`, `reconciled`) and element metadata are not in it: landing
 *   another changeset or stamping an upgrade that changes no content leaves it as it was (#1169).
 * - The full snapshot (`sha256:<hex>`, `captureFullSnapshot`): the manifest and every element as
 *   stored. It is what changesets created before CLI 0.7.0 recorded, and it misses relationships.
 *   It is kept to compare those changesets with the base in their own format, and for callers
 *   that want any change to the model files to count (the commit confirmation's fingerprint).
 *
 * The version prefix says which format a recorded hash is in, so a hash is only ever compared with
 * one made the same way (`captureSnapshotLike`): a format change is never read as drift.
 */

import { createHash } from "crypto";
import type { Model } from "./model.js";

/** The prefix of a content snapshot. A recorded hash without it is a full snapshot. */
export const CONTENT_SNAPSHOT_PREFIX = "v2:sha256:";

/** Whether a recorded hash is a content snapshot (`captureSnapshot`), not a full one. */
export function isContentSnapshot(snapshotId: string): boolean {
  return snapshotId.startsWith(CONTENT_SNAPSHOT_PREFIX);
}

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
   * The base model's content snapshot: the hash of its base index, with the version prefix. Always
   * the base model, never an active changeset's projection.
   */
  async captureSnapshot(model: Model): Promise<string> {
    // Imported here: changeset-base-index reads the model through the changeset graph.
    const { captureBaseIndex, snapshotOfIndex } = await import("./changeset-base-index.js");
    return snapshotOfIndex(await captureBaseIndex(model));
  }

  /**
   * The model's hash in the format `recorded` was made in, to compare the two: a content snapshot
   * for a content snapshot, a full snapshot for a hash recorded before CLI 0.7.0.
   */
  async captureSnapshotLike(model: Model, recorded: string): Promise<string> {
    return isContentSnapshot(recorded) ? this.captureSnapshot(model) : this.captureFullSnapshot(model);
  }

  /**
   * The full snapshot: a SHA-256 of the manifest and of every loaded layer's elements as stored,
   * in sorted order. Any change to them changes it, a landing's manifest history included.
   */
  async captureFullSnapshot(model: Model): Promise<string> {
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
   * Returns a report indicating whether drift occurred. The model is hashed in the expected
   * snapshot's format.
   *
   * NOTE: This method only identifies that the model has changed (hasDrift: true/false).
   * It cannot determine which specific layers/elements changed without storing
   * detailed snapshot data. When drift is detected, potentiallyAffectedLayers and
   * potentiallyAffectedElements contain ALL current layers/elements as a conservative
   * estimate. What changed is the base index's to say (changeset-base-index.ts).
   */
  async detectDrift(expectedSnapshot: string, currentModel: Model): Promise<DriftReport> {
    const currentSnapshot = await this.captureSnapshotLike(currentModel, expectedSnapshot);
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
