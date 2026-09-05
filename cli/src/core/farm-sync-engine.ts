/**
 * Farm Sync Engine - Orchestrates headless sync pipeline
 *
 * Implements:
 * - Git pull for tracked codebases
 * - Diff computation between sync commits
 * - File-to-element mapping via source references
 * - Changeset generation for affected elements
 * - Staged changeset integration
 */

import path from "path";
import { execSync, execFileSync } from "child_process";
import { fileExists, ensureDir } from "../utils/file-io.js";
import { FarmSyncState } from "./farm-sync-state.js";
import { Model } from "./model.js";
import { StagingAreaManager } from "./staging-area.js";
import { getErrorMessage } from "../utils/errors.js";
import type { FarmProject } from "./farm-manifest.js";

/**
 * Options for sync operation
 */
export interface SyncOptions {
  dryRun?: boolean; // Preview without creating changeset
  force?: boolean; // Proceed despite ambiguities
  verbose?: boolean; // Detailed output
}

/**
 * Result of file diff analysis
 */
export interface FileDiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Mapping of file path to model elements
 */
export interface FileElementMapping {
  filePath: string;
  possibleElements: Array<{
    elementId: string;
    layer: string;
    confidence: number; // 0-100
    sourceRef: {
      file: string;
      symbol?: string;
    };
  }>;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  projectName: string;
  commitsBefore: string;
  commitsAfter: string;
  filesChanged: FileDiffResult;
  elementMappings: FileElementMapping[];
  ambiguities: FileElementMapping[]; // Mappings with low confidence
  changesetId?: string; // ID of generated changeset if applicable
  changeCount: number; // Total staged changes
  notes: string[];
}

/**
 * FarmSyncEngine - Orchestrates the sync pipeline
 * Model parameter is optional - only required for sync operations, not for pull
 */
export class FarmSyncEngine {
  private farmRoot: string;
  private model: Model | null;

  constructor(farmRoot: string, model?: Model) {
    this.farmRoot = farmRoot;
    this.model = model || null;
  }

  /**
   * Pull latest changes from remote for a codebase
   * @param codebasePath - Relative path to codebase folder
   * @returns Updated commit SHA
   */
  async pullCodebase(codebasePath: string): Promise<string> {
    const fullPath = path.join(this.farmRoot, codebasePath);

    if (!(await fileExists(fullPath))) {
      throw new Error(`Codebase directory not found: ${codebasePath}`);
    }

    try {
      // Try to fetch latest if remote exists
      try {
        execSync("git fetch --prune", { cwd: fullPath, stdio: "pipe" });
      } catch {
        // Repository has no remote - this is okay for local-only repos
      }

      // Try to pull if remote exists
      try {
        execSync("git pull --no-rebase", { cwd: fullPath, stdio: "pipe" });
      } catch {
        // Repository has no remote - this is okay for local-only repos
      }

      // Get current HEAD commit
      const commit = execSync("git rev-parse HEAD", { cwd: fullPath, encoding: "utf-8" }).trim();

      return commit;
    } catch (error) {
      throw new Error(`Failed to pull codebase '${codebasePath}': ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get the current HEAD commit SHA for a codebase
   */
  async getCurrentCommit(codebasePath: string): Promise<string> {
    const fullPath = path.join(this.farmRoot, codebasePath);

    if (!(await fileExists(fullPath))) {
      throw new Error(`Codebase directory not found: ${codebasePath}`);
    }

    try {
      const commit = execSync("git rev-parse HEAD", { cwd: fullPath, encoding: "utf-8" }).trim();
      return commit;
    } catch (error) {
      throw new Error(`Failed to get current commit for '${codebasePath}': ${getErrorMessage(error)}`);
    }
  }

  /**
   * Compute diff between two commits
   * Commit SHAs are validated before use to prevent command injection
   */
  async computeDiff(codebasePath: string, fromCommit: string, toCommit: string): Promise<FileDiffResult> {
    const fullPath = path.join(this.farmRoot, codebasePath);

    if (!(await fileExists(fullPath))) {
      throw new Error(`Codebase directory not found: ${codebasePath}`);
    }

    // Validate commit SHAs to prevent command injection
    const commitShaRegex = /^[0-9a-f]{7,40}$/i;
    if (!commitShaRegex.test(fromCommit) || !commitShaRegex.test(toCommit)) {
      throw new Error(
        `Invalid commit SHA format. Expected 7-40 character hex string. Got: ${fromCommit}, ${toCommit}`
      );
    }

    try {
      // Get diff status between commits using execFileSync to avoid shell interpretation
      const diffOutput = execFileSync("git", ["diff", "--name-status", `${fromCommit}...${toCommit}`], {
        cwd: fullPath,
        encoding: "utf-8",
      });

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      for (const line of diffOutput.trim().split("\n")) {
        if (!line) continue;

        const [status, ...fileParts] = line.split("\t");
        const filePath = fileParts.join("\t"); // Handle paths with tabs

        switch (status) {
          case "A":
            added.push(filePath);
            break;
          case "M":
            modified.push(filePath);
            break;
          case "D":
            deleted.push(filePath);
            break;
          // Ignore renames, copies, etc for now - they'll be handled as add+delete
        }
      }

      return { added, modified, deleted };
    } catch (error) {
      throw new Error(`Failed to compute diff for '${codebasePath}': ${getErrorMessage(error)}`);
    }
  }

  /**
   * Map changed files to model elements using source references
   * Looks at each model element's source references and matches against changed files
   * Returns empty results if model is not available
   */
  async mapFilesToElements(): Promise<{ confident: FileElementMapping[]; ambiguous: FileElementMapping[] }> {
    if (!this.model) {
      return { confident: [], ambiguous: [] };
    }

    const confident: Map<string, FileElementMapping> = new Map();
    const ambiguous: Map<string, FileElementMapping> = new Map();

    // Iterate through all layers and elements
    for (const layer of this.model.layers.values()) {
      for (const element of layer.listElements()) {
        if (!element.source_reference) continue;

        const sourceRef = element.source_reference;
        if (!sourceRef.locations || sourceRef.locations.length === 0) continue;

        // Match each source location against potential changed files
        for (const location of sourceRef.locations) {
          // Use file path as key
          const filePath = location.file;

          if (!confident.has(filePath) && !ambiguous.has(filePath)) {
            const mapping: FileElementMapping = {
              filePath,
              possibleElements: [
                {
                  elementId: element.id,
                  layer: layer.name,
                  confidence: 100, // Exact match from source reference
                  sourceRef: location,
                },
              ],
            };
            confident.set(filePath, mapping);
          } else if (confident.has(filePath)) {
            // Multiple elements reference the same file - mark as ambiguous
            const existing = confident.get(filePath)!;
            confident.delete(filePath);

            existing.possibleElements.push({
              elementId: element.id,
              layer: layer.name,
              confidence: 100,
              sourceRef: location,
            });

            ambiguous.set(filePath, existing);
          } else {
            // Already ambiguous, add another possibility
            const existing = ambiguous.get(filePath)!;
            existing.possibleElements.push({
              elementId: element.id,
              layer: layer.name,
              confidence: 100,
              sourceRef: location,
            });
          }
        }
      }
    }

    return {
      confident: Array.from(confident.values()),
      ambiguous: Array.from(ambiguous.values()),
    };
  }

  /**
   * Generate a changeset from file-to-element mappings
   * Creates add/update/delete changes based on the diff and mappings
   * Stages changes into the changeset for review before commit
   */
  async generateChangeset(
    project: FarmProject,
    diff: FileDiffResult,
    mappings: { confident: FileElementMapping[]; ambiguous: FileElementMapping[] },
    options: SyncOptions = {}
  ): Promise<{ changesetId: string; changeCount: number; warnings: string[] }> {
    if (!this.model) {
      throw new Error("Model is required for changeset generation");
    }

    const stagingManager = new StagingAreaManager(this.farmRoot, this.model);

    // Create a new changeset
    const changesetName = `farm-sync-${project.name}-${Date.now()}`;
    const changeset = await stagingManager.create(changesetName, `Auto-generated from farm sync of ${project.name}`);

    if (!changeset.id) {
      throw new Error("Failed to create changeset - no ID assigned");
    }

    const warnings: string[] = [];
    let changeCount = 0;

    // Create a map of file path -> confident mapping for quick lookup
    const confidentMap = new Map(mappings.confident.map((m) => [m.filePath, m]));

    // Process added files
    for (const filePath of diff.added) {
      const mapping = confidentMap.get(filePath);
      if (mapping && mapping.possibleElements.length === 1) {
        const element = mapping.possibleElements[0];
        // Stage the change
        await stagingManager.stage(changeset.id, {
          type: "add",
          elementId: element.elementId,
          layerName: element.layer,
          after: {
            sourceFile: filePath,
            syncSource: "codebase",
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
        warnings.push(
          `File added: ${filePath} -> ${element.elementId} (staged for review, verify content accuracy)`
        );
        changeCount++;
      }
    }

    // Process modified files
    for (const filePath of diff.modified) {
      const mapping = confidentMap.get(filePath);
      if (mapping && mapping.possibleElements.length === 1) {
        const element = mapping.possibleElements[0];
        // Stage the change
        await stagingManager.stage(changeset.id, {
          type: "update",
          elementId: element.elementId,
          layerName: element.layer,
          before: {
            sourceFile: filePath,
            syncSource: "codebase",
          },
          after: {
            sourceFile: filePath,
            syncSource: "codebase",
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
        warnings.push(`File modified: ${filePath} -> ${element.elementId} (staged for review)`);
        changeCount++;
      }
    }

    // Process deleted files
    for (const filePath of diff.deleted) {
      const mapping = confidentMap.get(filePath);
      if (mapping && mapping.possibleElements.length === 1) {
        const element = mapping.possibleElements[0];
        // Stage the change
        await stagingManager.stage(changeset.id, {
          type: "delete",
          elementId: element.elementId,
          layerName: element.layer,
          before: {
            sourceFile: filePath,
            syncSource: "codebase",
          },
          timestamp: new Date().toISOString(),
        });
        warnings.push(`File deleted: ${filePath} -> ${element.elementId} (staged for review)`);
        changeCount++;
      }
    }

    // Flag ambiguities
    if (mappings.ambiguous.length > 0 && !options.force) {
      for (const ambiguity of mappings.ambiguous) {
        warnings.push(
          `Ambiguous mapping: ${ambiguity.filePath} -> ${ambiguity.possibleElements.map((e) => e.elementId).join(", ")} (skipped, use --force to proceed)`
        );
      }
    }

    return {
      changesetId: changeset.id,
      changeCount,
      warnings,
    };
  }

  /**
   * Execute a complete sync operation for a project
   */
  async syncProject(project: FarmProject, options: SyncOptions = {}): Promise<SyncResult> {
    const codebasePath = project.source;
    const notes: string[] = [];

    // Step 1: Pull latest changes
    if (options.verbose) {
      notes.push(`Pulling latest from ${codebasePath}...`);
    }
    const currentCommit = await this.pullCodebase(codebasePath);

    // Step 2: Load sync state
    const syncStatePath = path.join(this.farmRoot, project.model, ".farm-sync.yaml");
    await ensureDir(path.dirname(syncStatePath));
    const syncState = await FarmSyncState.loadOrCreate(syncStatePath, project.name);

    const previousCommit = syncState.lastSyncCommit;
    notes.push(`Current commit: ${currentCommit}`);
    notes.push(`Previous sync commit: ${previousCommit || "none"}`);

    // Step 3: If no previous sync, this is initial sync - just record state
    if (!previousCommit) {
      notes.push("Initial sync - recording baseline only");
      syncState.recordSync({
        timestamp: new Date().toISOString(),
        commit: currentCommit,
        status: "success",
        filesChanged: 0,
        elementsAffected: 0,
        notes: "Initial sync, no changes to sync",
      });
      await syncState.save(syncStatePath);

      return {
        success: true,
        projectName: project.name,
        commitsBefore: "none",
        commitsAfter: currentCommit,
        filesChanged: { added: [], modified: [], deleted: [] },
        elementMappings: [],
        ambiguities: [],
        changeCount: 0,
        notes,
      };
    }

    // Step 4: Compute diff
    if (options.verbose) {
      notes.push(`Computing diff between ${previousCommit.substring(0, 8)} and ${currentCommit.substring(0, 8)}...`);
    }
    const diff = await this.computeDiff(codebasePath, previousCommit, currentCommit);

    // If no changes, return early
    if (diff.added.length === 0 && diff.modified.length === 0 && diff.deleted.length === 0) {
      notes.push("No changes detected");
      syncState.recordSync({
        timestamp: new Date().toISOString(),
        commit: currentCommit,
        status: "success",
        filesChanged: 0,
        elementsAffected: 0,
        notes: "No changes to sync",
      });
      await syncState.save(syncStatePath);

      return {
        success: true,
        projectName: project.name,
        commitsBefore: previousCommit.substring(0, 8),
        commitsAfter: currentCommit.substring(0, 8),
        filesChanged: diff,
        elementMappings: [],
        ambiguities: [],
        changeCount: 0,
        notes,
      };
    }

    notes.push(
      `Files changed: ${diff.added.length} added, ${diff.modified.length} modified, ${diff.deleted.length} deleted`
    );

    // Step 5: Map files to elements
    if (options.verbose) {
      notes.push("Mapping changed files to model elements...");
    }
    const mappings = await this.mapFilesToElements();

    // Step 6: Record ambiguities in sync state
    if (mappings.ambiguous.length > 0) {
      syncState.recordAmbiguities(
        mappings.ambiguous.map((m) => ({
          filePath: m.filePath,
          possibleElements: m.possibleElements.map((e) => ({
            elementId: e.elementId,
            layer: e.layer,
            confidence: e.confidence,
          })),
        }))
      );
      notes.push(`Ambiguities detected: ${mappings.ambiguous.length} files`);
    }

    // Step 7: Generate changeset
    let changesetId: string | undefined;
    let changeCount = 0;

    if (!options.dryRun) {
      const changesetResult = await this.generateChangeset(project, diff, mappings, options);
      changesetId = changesetResult.changesetId;
      changeCount = changesetResult.changeCount;
      notes.push(...changesetResult.warnings);
    }

    // Step 8: Record sync in state
    syncState.recordSync({
      timestamp: new Date().toISOString(),
      commit: currentCommit,
      status: mappings.ambiguous.length > 0 && !options.force ? "partial" : "success",
      changesetId,
      filesChanged: diff.added.length + diff.modified.length + diff.deleted.length,
      elementsAffected: mappings.confident.length + mappings.ambiguous.length,
      notes: notes.join("\n"),
    });
    await syncState.save(syncStatePath);

    return {
      success: true,
      projectName: project.name,
      commitsBefore: previousCommit.substring(0, 8),
      commitsAfter: currentCommit.substring(0, 8),
      filesChanged: diff,
      elementMappings: mappings.confident,
      ambiguities: mappings.ambiguous,
      changesetId,
      changeCount,
      notes,
    };
  }
}
