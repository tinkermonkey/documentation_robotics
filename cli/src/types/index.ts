/**
 * Core type definitions for Documentation Robotics CLI
 */

// Export source reference types
export type {
  ProvenanceType,
  SourceLocation,
  RepositoryContext,
  SourceReference,
} from "./source-reference.js";

/**
 * Reference across layers
 */
export interface Reference {
  source: string; // Element ID
  target: string; // Element ID
  type: string; // Reference type
  description?: string;
}

/**
 * Intra-layer relationship
 */
export interface Relationship {
  source: string;
  target: string;
  predicate: string; // e.g., "depends-on", "implements"
  properties?: Record<string, unknown>;
  category?: "structural" | "behavioral"; // Relationship classification
}

/**
 * Element representation
 */
export interface Element {
  id: string; // Format: {layer}-{type}-{kebab-case-name}
  type: string;
  name: string;
  description?: string;
  properties?: Record<string, unknown>;
  references?: Reference[];
  relationships?: Relationship[];
}

/**
 * Layer container
 */
export interface LayerData {
  elements: Element[];
  metadata?: {
    layer: string;
    version: string;
  };
}

/**
 * Model statistics metadata
 * Tracks aggregate statistics about the model across all layers
 */
export interface ModelStatistics {
  /** Total number of elements across all layers */
  total_elements: number;
  /** Total number of intra-layer relationships */
  total_relationships: number;
  /** Model completeness percentage (0-100) */
  completeness?: number;
  /** ISO 8601 timestamp of last validation */
  last_validation?: string;
  /** Status of last validation ('passed', 'failed', 'warning') */
  validation_status?: string;
}

/**
 * Cross-layer reference statistics
 * Tracks references between different layers
 */
export interface CrossReferenceStatistics {
  /** Total number of cross-layer references */
  total: number;
  /** Breakdown of references by type */
  by_type: Record<string, number>;
}

/**
 * Changeset application history entry
 * Records when changesets were applied or reverted to the model
 */
export interface ChangesetHistoryEntry {
  /** Name of the changeset that was applied or reverted */
  name: string;
  /** ISO 8601 timestamp when the action occurred */
  applied_at: string;
  /** Type of action performed */
  action: "applied" | "reverted";
}

/**
 * Manifest metadata
 */
export interface ManifestData {
  name: string;
  version: string;
  description?: string;
  author?: string;
  created?: string;
  modified?: string;
  specVersion?: string;
  /** Statistics about the model */
  statistics?: ModelStatistics;
  /** Cross-layer reference tracking */
  cross_references?: CrossReferenceStatistics;
  /** Changeset history for the model */
  changeset_history?: ChangesetHistoryEntry[];
  /** Chat client preference (e.g., "Claude Code", "GitHub Copilot") */
  preferred_chat_client?: string;
  /** Python CLI compatibility fields */
  pythonCliCompat?: PythonCliCompat;
}

/**
 * Model options for customization
 */
export interface ModelOptions {
  enableCache?: boolean;
  lazyLoad?: boolean;
  referenceRegistry?: unknown; // Will be properly typed when implemented
}

/**
 * JSON Schema property definition
 * Represents a single property in a JSON Schema object
 */
export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Tool parameter definition for Claude AI tools
 * Describes a single input parameter for a tool
 */
export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  [key: string]: unknown;
}

/**
 * Tool input schema definition
 * Defines the structure of inputs for a Claude AI tool
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required: string[];
}

/**
 * Tool definition for Claude AI integration
 * Represents a single tool that Claude can call
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

/**
 * Result of executing a tool
 * All tool results are returned as JSON-serializable objects
 */
export interface ToolExecutionResult {
  [key: string]: unknown;
  error?: string;
}

/**
 * Python CLI Compatibility Fields
 *
 * This interface documents fields that exist for backward compatibility with the Python CLI.
 * These fields are not part of the core data model but are preserved for interoperability.
 *
 * NOTE: These fields should not be used in new code. They are maintained for:
 * - Changelog migrations from Python CLI v0.8.0 format
 * - Manifest compatibility when reading old models
 * - Migration scripts that bridge Python and TypeScript CLI versions
 *
 * See also: changeset-migration.ts for Python CLI format handling
 */
export interface PythonCliCompat {
  /**
   * Layer catalog mapping from Python CLI format
   *
   * Python CLI v0.8.0 used a different layer storage structure.
   * This field preserves that structure for migration purposes.
   * Maps layer names to their element configurations.
   *
   * @deprecated Only used during migration from Python CLI format
   */
  layers?: Record<string, unknown>;

  /**
   * Legacy changeset tracking from Python CLI format
   *
   * Python CLI tracked changesets differently than the TypeScript CLI.
   * This field preserves that structure for historical record.
   *
   * @deprecated Only used during migration from Python CLI format
   */
  changesets?: Record<string, unknown>;

  /**
   * Additional metadata from Python CLI that may not map to TypeScript model
   *
   * Catch-all for fields that existed in Python CLI format but don't have
   * a direct equivalent in the TypeScript implementation.
   */
  [key: string]: unknown;
}

/**
 * SHA256 hash branded type for compile-time safety
 * Prevents accidental misuse of arbitrary strings as cryptographic checksums
 */
export type Sha256Hash = string & { readonly __brand: "Sha256Hash" };

/**
 * Create a Sha256Hash from a hex string
 * This is the only valid way to construct a Sha256Hash value
 *
 * @param hash - The hex string representation of a SHA256 hash
 * @returns A branded Sha256Hash type
 * @throws Error if the hash is not a valid 64-character hex string
 */
export function createSha256Hash(hash: string): Sha256Hash {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`Invalid SHA256 hash format. Expected 64-character hex string, got: ${hash}`);
  }
  return hash as Sha256Hash;
}

/**
 * Backup manifest entry for a single file
 * All properties are readonly to enforce immutability of backup records
 */
export interface BackupManifestFile {
  readonly path: string; // Relative path to the file in the backup directory
  readonly checksum: Sha256Hash; // SHA256 hash of the file contents (branded type)
  readonly size: number; // File size in bytes
}

/**
 * Backup manifest tracking files and creation timestamp
 * Used for backup integrity validation and recovery
 * All properties are readonly to enforce immutability of backup records
 */
export interface BackupManifest {
  readonly files: ReadonlyArray<BackupManifestFile>; // Array of backed up files with metadata
  readonly timestamp: string; // ISO 8601 timestamp when backup was created
}

/**
 * Create and validate a BackupManifest from raw data
 * Validates structure and transforms string checksums to Sha256Hash branded type
 *
 * @param data - Unknown data to validate (typically from JSON parsing)
 * @returns Validated and typed BackupManifest object
 * @throws Error if data doesn't match expected structure or contains invalid checksums
 */
export function createBackupManifest(data: unknown): BackupManifest {
  if (!data || typeof data !== "object") {
    throw new Error("Backup manifest must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (!obj.files || !Array.isArray(obj.files)) {
    throw new Error("Backup manifest must have a files array");
  }

  if (obj.timestamp && typeof obj.timestamp !== "string") {
    throw new Error("Backup manifest timestamp must be a string if provided");
  }

  // Validate ISO 8601 timestamp if provided
  let timestamp: string;
  if (obj.timestamp) {
    const timestampDate = new Date(obj.timestamp as string);
    if (isNaN(timestampDate.getTime())) {
      throw new Error(`Invalid timestamp format: ${obj.timestamp}. Expected ISO 8601 string.`);
    }
    timestamp = obj.timestamp as string;
  } else {
    timestamp = new Date().toISOString();
  }

  // Validate and transform each file entry
  const files: readonly BackupManifestFile[] = obj.files.map((file: unknown, index: number) => {
    if (!file || typeof file !== "object") {
      throw new Error(`Backup manifest file entry ${index} must be an object`);
    }

    const fileObj = file as Record<string, unknown>;

    if (typeof fileObj.path !== "string" || !fileObj.path) {
      throw new Error(`Backup manifest file entry ${index} must have a non-empty path string`);
    }

    if (typeof fileObj.checksum !== "string") {
      throw new Error(`Backup manifest file entry ${index} must have a checksum string`);
    }

    if (typeof fileObj.size !== "number" || fileObj.size < 0) {
      throw new Error(`Backup manifest file entry ${index} must have a non-negative size number`);
    }

    return {
      path: fileObj.path,
      checksum: createSha256Hash(fileObj.checksum),
      size: fileObj.size,
    };
  });

  return {
    files,
    timestamp,
  };
}

/**
 * Verify backup manifest against actual file checksums
 * Checks that all files in the manifest exist and have matching checksums
 *
 * @param manifest - The backup manifest to verify
 * @param readFile - Function to read file contents by path
 * @param fileExists - Function to check if a file exists by path
 * @param backupDir - Base directory path for resolving relative file paths
 * @returns Promise resolving to verification result with detailed error information
 */
export async function verifyBackupIntegrity(
  manifest: BackupManifest,
  readFile: (path: string) => Promise<string>,
  fileExists: (path: string) => Promise<boolean>,
  backupDir: string
): Promise<{
  isValid: boolean;
  filesChecked: number;
  errors: string[];
}> {
  const { createHash } = await import("crypto");
  const path = await import("path");

  const errors: string[] = [];
  let filesChecked = 0;

  try {
    // Verify each file in the manifest
    for (const file of manifest.files) {
      filesChecked++;
      const backupFilePath = path.join(backupDir, file.path);

      // Check file exists
      if (!(await fileExists(backupFilePath))) {
        errors.push(`Missing: ${file.path}`);
        continue;
      }

      try {
        // Read file and verify checksum
        const content = await readFile(backupFilePath);
        const checksum = createHash("sha256").update(content).digest("hex") as Sha256Hash;

        if (checksum !== file.checksum) {
          errors.push(
            `Checksum mismatch: ${file.path} (expected ${file.checksum}, got ${checksum})`
          );
          continue;
        }

        // Verify size matches
        if (content.length !== file.size) {
          errors.push(`Size mismatch: ${file.path} (expected ${file.size}, got ${content.length})`);
        }
      } catch (err) {
        errors.push(
          `Failed to verify: ${file.path} (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      filesChecked,
      errors,
    };
  } catch (err) {
    return {
      isValid: false,
      filesChecked,
      errors: [
        ...errors,
        `Integrity verification failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}
