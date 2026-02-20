/**
 * Audit snapshots command - Manage audit snapshots
 */

import ansis from "ansis";
import { CLIError, getErrorMessage } from "../utils/errors.js";
import { SnapshotStorage, SnapshotMetadata } from "../audit/snapshot-storage.js";

export interface AuditSnapshotsOptions {
  action: "list" | "delete" | "clear";
  id?: string; // For delete action
  debug?: boolean;
}

/**
 * Run the audit snapshots command
 */
export async function auditSnapshotsCommand(
  options: AuditSnapshotsOptions,
): Promise<void> {
  try {
    const storage = new SnapshotStorage();

    switch (options.action) {
      case "list":
        await listSnapshots(storage);
        break;

      case "delete":
        if (!options.id) {
          throw new CLIError(
            "Snapshot ID required for delete action. Use --id <snapshot-id>",
          );
        }
        await deleteSnapshot(storage, options.id);
        break;

      case "clear":
        await clearSnapshots(storage);
        break;

      default:
        throw new CLIError(
          `Unknown action: ${options.action}. Use 'list', 'delete', or 'clear'.`,
        );
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (options.debug) {
      console.error(error);
    }
    throw new CLIError(`Snapshot management failed: ${message}`);
  }
}

/**
 * List all snapshots
 */
async function listSnapshots(storage: SnapshotStorage): Promise<void> {
  const snapshots = await storage.list();

  if (snapshots.length === 0) {
    console.log(ansis.dim("No snapshots available."));
    console.log(
      ansis.dim("\nRun 'dr audit --save-snapshot' to create a snapshot."),
    );
    return;
  }

  console.log(ansis.bold("\nAudit Snapshots:"));
  console.log(ansis.dim("─".repeat(80)));

  for (const snapshot of snapshots) {
    const timestamp = new Date(snapshot.timestamp).toLocaleString();
    console.log(
      ansis.bold(`\n${ansis.cyan(snapshot.id)}`),
    );
    console.log(`  Timestamp: ${timestamp}`);
    console.log(`  Model:     ${snapshot.modelName} v${snapshot.modelVersion}`);
    console.log(`  Layers:    ${snapshot.layers.join(", ")}`);
  }

  console.log(ansis.dim("\n" + "─".repeat(80)));
  console.log(
    ansis.dim(
      `\nTotal: ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}`,
    ),
  );
}

/**
 * Delete a specific snapshot
 */
async function deleteSnapshot(
  storage: SnapshotStorage,
  id: string,
): Promise<void> {
  // Verify snapshot exists before deletion
  const snapshots = await storage.list();
  if (!snapshots.some((s) => s.id === id)) {
    throw new CLIError(`Snapshot not found: ${id}`);
  }

  await storage.delete(id);
  console.log(ansis.green(`✓ Snapshot deleted: ${id}`));
}

/**
 * Clear all snapshots
 */
async function clearSnapshots(storage: SnapshotStorage): Promise<void> {
  const snapshots = await storage.list();
  const count = snapshots.length;

  if (count === 0) {
    console.log(ansis.dim("No snapshots to clear."));
    return;
  }

  await storage.clear();
  console.log(
    ansis.green(
      `✓ Cleared ${count} snapshot${count === 1 ? "" : "s"}`,
    ),
  );
}
