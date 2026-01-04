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

        /** True if user modified this file since installation */
        modified: boolean;
      };
    };
  };
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
