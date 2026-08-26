/**
 * Migration Registry - Manages version-based model migrations
 *
 * Handles sequential migrations from one spec version to another,
 * supporting the evolution of the architecture model specification.
 */

import type { Model } from "./model.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Represents a single version migration
 */
export interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  apply: (model: Model) => Promise<MigrationResult>;
}

/**
 * Result of applying a migration
 */
export interface MigrationResult {
  migrationsApplied: number;
  filesModified: number;
  description: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Migration Registry managing all available migrations
 */
export class MigrationRegistry {
  private migrations: Migration[] = [];

  constructor() {
    this.registerMigrations();
  }

  /**
   * Register all available migrations
   */
  private registerMigrations(): void {
    // Migration from v0.5.0 to v0.6.0: Relationship Taxonomy
    this.migrations.push({
      fromVersion: "0.5.0",
      toVersion: "0.6.0",
      description: "Relationship Taxonomy (Spec v0.6.0)",
      apply: async () => {
        // This migration is opt-in - the new relationship taxonomy
        // is fully backward compatible with existing models
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.6.0 (Relationship Taxonomy now available)",
        };
      },
    });

    // Migration from v0.6.0 to v0.7.0: Layer Schema Relationship Metadata
    this.migrations.push({
      fromVersion: "0.6.0",
      toVersion: "0.7.0",
      description: "Layer Schema Relationship Metadata (Spec v0.7.0)",
      apply: async () => {
        // This migration updates layer schemas with relationship metadata sections
        // - All 12 layer schemas now include layerMetadata, intraLayerRelationships, crossLayerRelationships
        // - Deprecated link-registry.json (removed in v0.8.0)
        // - Terminology change: "cross-layer links" → "cross-layer relationships"
        // Fully backward compatible - existing models continue to work
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description:
            "Spec version updated to 0.7.0 (Layer schemas now include relationship metadata sections)",
        };
      },
    });

    // Migration from v0.7.0 to v0.7.1: Source Code Reference Infrastructure
    this.migrations.push({
      fromVersion: "0.7.0",
      toVersion: "0.7.1",
      description: "Source Code Reference Infrastructure (Spec v0.7.1)",
      apply: async () => {
        // This migration adds source code reference infrastructure
        // - Common schema definitions in spec/schemas/common/
        // - Source references integrated across 10 layers
        // - Backward compatible - existing models continue to work
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.7.1 (Source Code Reference Infrastructure)",
        };
      },
    });

    // Migration from v0.7.1 to v0.8.0: JSON Schema-Only Spec Architecture
    this.migrations.push({
      fromVersion: "0.7.1",
      toVersion: "0.8.0",
      description: "JSON Schema-Only Spec Architecture (Spec v0.8.0)",
      apply: async () => {
        // Spec architecture refactored to JSON Schema-only model:
        // - Node type definitions moved to spec/schemas/nodes/{layer}/*.node.schema.json
        // - Relationship definitions moved to spec/schemas/relationships/{layer}/*.relationship.schema.json
        // - Predicates relocated to spec/schemas/base/predicates.json
        // This is a spec architecture change only - model data files are fully backward compatible
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.8.0 (JSON Schema-Only Spec Architecture)",
        };
      },
    });

    // Migration from v0.8.0 to v0.8.1: Expanded Relationship Coverage and Node Improvements
    this.migrations.push({
      fromVersion: "0.8.0",
      toVersion: "0.8.1",
      description: "Expanded Relationship Coverage and Node Improvements (Spec v0.8.1)",
      apply: async () => {
        // Spec enhancements only - no model data format changes:
        // - 733 new relationship schemas added across all 12 layers
        // - Node type descriptions improved for all 12 layers
        // - Enum-masquerader node types consolidated into parent attributes
        // - Existing models continue to work without modification
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.8.1 (Expanded Relationship Coverage and Node Improvements)",
        };
      },
    });

    // Migration from v0.8.1 to v0.8.2: UUID/Path identifier separation
    this.migrations.push({
      fromVersion: "0.8.1",
      toVersion: "0.8.2",
      description: "UUID/Path identifier separation (Spec v0.8.2)",
      apply: async () => {
        // The path field is now required on all spec nodes (spec-node.schema.json).
        // Existing elements are migrated automatically on load in model.ts (loadLayer):
        // - Elements with slug-format id: slug moved to path, deterministic UUID assigned to id
        // - Elements with UUID id but no path: path derived from layer_id.type.kebab(name)
        // No manual data file changes needed; migration runs transparently on next load/save.
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.8.2 (UUID/Path identifier separation)",
        };
      },
    });

    // Migration from v0.8.2 to v0.8.3: Inter-layer Relationship Schemas and APM Node Types
    this.migrations.push({
      fromVersion: "0.8.2",
      toVersion: "0.8.3",
      description: "Inter-layer Relationship Schemas and APM Node Types (Spec v0.8.3)",
      apply: async () => {
        // Major expansion of inter-layer relationship coverage and APM layer:
        // - 495 new inter-layer relationship schemas across all 12 layers
        // - Total relationship count increased from 969 to 1,447
        // - 2 new APM node types: apm.alert and apm.dashboard
        // - Backward compatible - existing models continue to work without modification
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.8.3 (Inter-layer Relationship Schemas and APM Node Types)",
        };
      },
    });

    // Migration from v0.8.3 to v0.8.4: Analyzer Infrastructure (CBM Mapping)
    this.migrations.push({
      fromVersion: "0.8.3",
      toVersion: "0.8.4",
      description: "Analyzer Infrastructure (Spec v0.8.4)",
      apply: async () => {
        // Introduces spec/analyzers/ with codebase-memory (CBM) mapping:
        // - New analyzer adapter foundation and full analyzer subcommands
        // - dr analyzer verify with changeset awareness
        // - Claude Code integration commands (/dr-verify, /dr-map, dr-extractor)
        // - No model data format changes; existing models are fully compatible
        return {
          migrationsApplied: 1,
          filesModified: 0,
          description: "Spec version updated to 0.8.4 (Analyzer Infrastructure)",
        };
      },
    });

    // Migration from v0.8.4 to v0.9.0: Product Layer Introduction
    this.migrations.push({
      fromVersion: "0.8.4",
      toVersion: "0.9.0",
      description: "Product Layer Introduction (Spec v0.9.0)",
      apply: async (model: Model) => {
        const fs = await import("fs/promises");
        const pathModule = await import("path");

        const modelDir = `${model.rootPath}/documentation-robotics/model`;
        let filesModified = 0;

        try {
          // Verify model directory exists
          await fs.access(modelDir);
        } catch (error) {
          const err = error as { code?: string };
          // ENOENT means the directory doesn't exist - nothing to migrate
          if (err.code === "ENOENT") {
            return {
              migrationsApplied: 1,
              filesModified: 0,
              description:
                "Spec version updated to 0.9.0 (Product layer introduced; no model directories to migrate)",
            };
          }
          // Re-throw other errors (e.g., EACCES for permission denied)
          throw error;
        }

        // Rename existing layer directories: shift from 03-12 to 04-13
        // Must do this in reverse order (12→13, 11→12, ..., 03→04) to avoid conflicts
        const renameMap = [
          ["12_testing", "13_testing"],
          ["11_apm", "12_apm"],
          ["10_navigation", "11_navigation"],
          ["09_ux", "10_ux"],
          ["08_data-store", "09_data-store"],
          ["07_data-model", "08_data-model"],
          ["06_api", "07_api"],
          ["05_technology", "06_technology"],
          ["04_application", "05_application"],
          ["03_security", "04_security"],
        ];

        const renameErrors: string[] = [];

        for (const [oldName, newName] of renameMap) {
          const oldPath = pathModule.join(modelDir, oldName);
          const newPath = pathModule.join(modelDir, newName);

          try {
            await fs.rename(oldPath, newPath);
            filesModified++;
          } catch (error) {
            const err = error as { code?: string };
            // ENOENT is expected when a directory hasn't been created yet
            if (err.code === "ENOENT") {
              continue;
            }
            // Track non-ENOENT errors to report them in the result
            renameErrors.push(
              `Failed to rename ${oldName} to ${newName}: ${getErrorMessage(error)}`
            );
          }
        }

        // If there were any rename failures, include them in the error field
        if (renameErrors.length > 0) {
          return {
            migrationsApplied: 1,
            filesModified,
            description:
              "Spec version updated to 0.9.0 (Product layer introduced at layer 3; Security through Testing shifted from layers 3–12 to 4–13)",
            error: renameErrors.join("; "),
          };
        }

        // Create new product layer directory (it will be empty for now)
        // recursive: true handles EEXIST, so no catch needed
        const productPath = pathModule.join(modelDir, "03_product");
        await fs.mkdir(productPath, { recursive: true });

        return {
          migrationsApplied: 1,
          filesModified,
          description:
            "Spec version updated to 0.9.0 (Product layer introduced at layer 3; Security through Testing shifted from layers 3–12 to 4–13)",
        };
      },
    });

    // Migration from v0.9.0 to v0.10.0: Data Model objectschema.required type change
    this.migrations.push({
      fromVersion: "0.9.0",
      toVersion: "0.10.0",
      description: "Data Model objectschema.required type change (Spec v0.10.0)",
      apply: async (model: Model) => {
        const fs = await import("fs/promises");
        const pathModule = await import("path");
        const YAML = await import("yaml");

        const modelDir = `${model.rootPath}/documentation-robotics/model`;
        const dataModelDir = pathModule.join(modelDir, "08_data-model");
        let filesModified = 0;

        try {
          // Verify data model directory exists
          await fs.access(dataModelDir);
        } catch (error) {
          const err = error as { code?: string };
          // ENOENT means the directory doesn't exist - nothing to migrate
          if (err.code === "ENOENT") {
            return {
              migrationsApplied: 1,
              filesModified: 0,
              description:
                "Spec version updated to 0.10.0 (objectschema.required type changed from string to array; no model data to migrate)",
            };
          }
          // Re-throw other errors
          throw error;
        }

        // Scan all YAML files in the data model directory
        const files = await fs.readdir(dataModelDir);
        const migrationErrors: string[] = [];

        for (const file of files) {
          if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
            continue;
          }

          const filePath = pathModule.join(dataModelDir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            let modified = false;
            const doc = YAML.parse(content);

            if (!doc || typeof doc !== "object") {
              continue;
            }

            // Iterate through all elements in the file
            for (const [, element] of Object.entries(doc)) {
              if (
                !element ||
                typeof element !== "object" ||
                (element as Record<string, unknown>).spec_node_id !== "data-model.objectschema"
              ) {
                continue;
              }

              const elem = element as Record<string, unknown>;
              const attributes = elem.attributes as Record<string, unknown> | undefined;

              if (attributes && typeof attributes === "object") {
                const required = attributes.required;

                // Check if required field exists and is a string
                if (required && typeof required === "string") {
                  // Convert comma-separated string to array
                  attributes.required = required
                    .split(",")
                    .map((item: string) => item.trim())
                    .filter((item: string) => item.length > 0);
                  modified = true;
                }
              }
            }

            // Write back if modified
            if (modified) {
              await fs.writeFile(filePath, YAML.stringify(doc), "utf-8");
              filesModified++;
            }
          } catch (error) {
            migrationErrors.push(
              `Failed to migrate ${file}: ${getErrorMessage(error)}`
            );
          }
        }

        if (migrationErrors.length > 0) {
          return {
            migrationsApplied: 1,
            filesModified,
            description:
              "Spec version updated to 0.10.0 (objectschema.required converted from string to array)",
            error: migrationErrors.join("; "),
          };
        }

        return {
          migrationsApplied: 1,
          filesModified,
          description:
            "Spec version updated to 0.10.0 (objectschema.required converted from string to array)",
        };
      },
    });
  }

  /**
   * Get the latest available specification version
   */
  getLatestVersion(): string {
    if (this.migrations.length === 0) {
      return "0.7.0";
    }

    // Return the highest toVersion from all migrations using proper version comparison
    const versions = this.migrations.map((m) => m.toVersion);
    return versions.reduce((max, current) => {
      return this.compareVersions(current, max) > 0 ? current : max;
    });
  }

  /**
   * Get the sequence of migrations needed from one version to another
   */
  getMigrationPath(fromVersion: string, toVersion?: string): Migration[] {
    const targetVersion = toVersion || this.getLatestVersion();

    if (this.compareVersions(fromVersion, targetVersion) >= 0) {
      return [];
    }

    const path: Migration[] = [];
    let current = fromVersion;

    // Sort migrations by fromVersion
    const sortedMigrations = [...this.migrations].sort((a, b) =>
      this.compareVersions(a.fromVersion, b.fromVersion)
    );

    for (const migration of sortedMigrations) {
      // Check if this migration is in our path
      if (
        this.compareVersions(current, migration.fromVersion) >= 0 &&
        this.compareVersions(current, migration.toVersion) < 0 &&
        this.compareVersions(migration.toVersion, targetVersion) <= 0
      ) {
        path.push(migration);
        current = migration.toVersion;
      }
    }

    return path;
  }

  /**
   * Check if a model requires migration
   */
  requiresMigration(currentVersion: string): boolean {
    const path = this.getMigrationPath(currentVersion);
    return path.length > 0;
  }

  /**
   * Apply all migrations in sequence
   */
  async applyMigrations(
    model: Model,
    options: {
      fromVersion: string;
      toVersion?: string;
      dryRun?: boolean;
      validate?: boolean;
    }
  ): Promise<ApplyMigrationsResult> {
    const path = this.getMigrationPath(options.fromVersion, options.toVersion);
    const targetVersion = options.toVersion || this.getLatestVersion();

    if (path.length === 0) {
      return {
        applied: [],
        currentVersion: options.fromVersion,
        targetVersion,
        totalChanges: 0,
      };
    }

    const results: ApplyMigrationsResult = {
      applied: [],
      currentVersion: options.fromVersion,
      targetVersion,
      totalChanges: 0,
    };

    for (const migration of path) {
      if (!options.dryRun) {
        try {
          const result = await migration.apply(model);

          results.applied.push({
            from: migration.fromVersion,
            to: migration.toVersion,
            description: migration.description,
            changes: result,
          });

          results.totalChanges += result.migrationsApplied;

          // Only update model's spec version if migration succeeded (no error field)
          if (!result.error) {
            model.manifest.specVersion = migration.toVersion;
          } else {
            // If migration has errors, throw to prevent partial success state
            throw new Error(result.error);
          }
        } catch (error) {
          throw new Error(
            `Migration ${migration.fromVersion} → ${migration.toVersion} failed: ${
              getErrorMessage(error)
            }`
          );
        }
      } else {
        // Dry run - just record what would happen
        results.applied.push({
          from: migration.fromVersion,
          to: migration.toVersion,
          description: migration.description,
          dryRun: true,
        });
      }
    }

    return results;
  }

  /**
   * Get a summary of migrations that would be applied
   */
  getMigrationSummary(
    fromVersion: string,
    toVersion?: string
  ): {
    currentVersion: string;
    targetVersion: string;
    migrationsNeeded: number;
    migrations: Array<{
      from: string;
      to: string;
      description: string;
    }>;
  } {
    const path = this.getMigrationPath(fromVersion, toVersion);
    const targetVersion = toVersion || this.getLatestVersion();

    return {
      currentVersion: fromVersion,
      targetVersion,
      migrationsNeeded: path.length,
      migrations: path.map((m) => ({
        from: m.fromVersion,
        to: m.toVersion,
        description: m.description,
      })),
    };
  }

  /**
   * Compare two version strings
   * Returns: -1 if a < b, 0 if a == b, 1 if a > b
   */
  private compareVersions(a: string, b: string): number {
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);

    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;

      if (aPart < bPart) return -1;
      if (aPart > bPart) return 1;
    }

    return 0;
  }
}

/**
 * Result of applying multiple migrations
 */
export interface ApplyMigrationsResult {
  applied: Array<{
    from: string;
    to: string;
    description: string;
    changes?: MigrationResult;
    dryRun?: boolean;
  }>;
  currentVersion: string;
  targetVersion: string;
  totalChanges: number;
}
