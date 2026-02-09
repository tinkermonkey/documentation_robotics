/**
 * Migration Registry - Manages version-based model migrations
 *
 * Handles sequential migrations from one spec version to another,
 * supporting the evolution of the architecture model specification.
 */

import type { Model } from "./model.js";

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
  }

  /**
   * Get the latest available specification version
   */
  getLatestVersion(): string {
    if (this.migrations.length === 0) {
      return "0.7.0";
    }

    // Return the highest toVersion from all migrations
    const versions = this.migrations.map((m) => m.toVersion);
    return versions.sort().reverse()[0];
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

          // Update model's spec version
          model.manifest.specVersion = migration.toVersion;
        } catch (error) {
          throw new Error(
            `Migration ${migration.fromVersion} → ${migration.toVersion} failed: ${
              error instanceof Error ? error.message : String(error)
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
