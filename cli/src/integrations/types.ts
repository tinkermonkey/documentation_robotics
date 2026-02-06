/**
 * Integration Management Types
 *
 * Defines the core data structures for managing Claude Code and GitHub Copilot
 * integrations, matching the Python CLI's integration manager patterns.
 */

/**
 * Component configuration matching Python COMPONENTS dict structure
 * Describes how a component should be copied from source to target
 */
export interface ComponentConfig {
  /** Source directory name in integrations/{integration}/ */
  source: string;

  /** Target directory in project (.claude/ or .github/) */
  target: string;

  /** Human-readable description of this component */
  description: string;

  /** Optional file prefix filter (e.g., "dr-" to only copy dr-*.md) */
  prefix?: string;

  /** Whether component contains individual files or subdirectories */
  type: 'files' | 'dirs';

  /**
   * Whether this component is DR-owned (tracked in version file for updates)
   * Set to false for user-customizable components like templates
   * Defaults to true if not specified
   */
  tracked?: boolean;
}

/**
 * Version file YAML schema (.dr-version, .dr-copilot-version)
 * Tracks installation metadata and file hashes for change detection
 */
export interface VersionData {
  /** CLI version that installed this integration */
  version: string;

  /** ISO 8601 timestamp when integration was installed/updated */
  installed_at: string;

  /** Mapping of component names to their installed file hashes */
  components: {
    [componentName: string]: {
      [fileName: string]: {
        /** SHA256 hash truncated to 8 characters */
        hash: string;

        /** True if file was modified (source hash differs from installed hash) */
        modified: boolean;
      };
    };
  };
}

/**
 * Validate VersionData deserialization result
 *
 * Ensures that the YAML-deserialized object has the required structure
 * and types. Catches corrupted version files early.
 *
 * @param data Deserialized object from YAML
 * @returns VersionData if valid
 * @throws Error if validation fails
 */
export function validateVersionData(data: unknown): VersionData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Version data must be an object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'string') {
    throw new Error('Missing or invalid "version" field in version file');
  }

  if (typeof obj.installed_at !== 'string') {
    throw new Error('Missing or invalid "installed_at" field in version file');
  }

  if (typeof obj.components !== 'object' || obj.components === null) {
    throw new Error('Missing or invalid "components" field in version file');
  }

  // Basic structure validation - deeper structure verified on access
  return obj as VersionData;
}

/**
 * File change detected during update operation
 * Used to categorize and report changes between installed and source versions
 */
export interface FileChange {
  /** Relative path to file within target directory */
  path: string;

  /** Component name this file belongs to */
  component: string;

  /** Type of change detected */
  changeType: 'added' | 'modified' | 'deleted' | 'user-modified' | 'conflict';

  /** Hash of source file (if it exists in source) */
  sourceHash?: string;

  /** Hash of installed file (if it exists in target) */
  installedHash?: string;
}

/**
 * Obsolete file detected during cleanup
 * Represents a file in the installed integration that no longer exists in source
 */
export interface ObsoleteFile {
  /** Relative path to file within target directory */
  path: string;

  /** Component name this file belonged to */
  component: string;
}
