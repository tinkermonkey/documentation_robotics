/**
 * Source Reference Utilities
 * Shared validation and builder functions for source reference options
 */

import type { SourceReference, ProvenanceType } from '../types/index.js';
import { CLIError } from './errors.js';

export interface SourceReferenceOptions {
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
}

/**
 * Validate source reference options
 */
export function validateSourceReferenceOptions(options: SourceReferenceOptions): void {
  const hasSourceOptions = options.sourceFile || options.sourceSymbol ||
                           options.sourceProvenance || options.sourceRepoRemote ||
                           options.sourceRepoCommit;

  if (!hasSourceOptions) {
    return; // No source options provided
  }

  // If any source option provided, require file and provenance
  if (!options.sourceFile) {
    throw new CLIError(
      '--source-file is required when specifying source reference',
      1,
      ['Provide source file path relative to repository root', 'Example: --source-file "src/services/auth.ts"']
    );
  }

  if (!options.sourceProvenance) {
    throw new CLIError(
      '--source-provenance is required when specifying source reference',
      1,
      ['Specify provenance type: extracted, manual, inferred, or generated']
    );
  }

  // Validate provenance enum
  const validProvenance = ['extracted', 'manual', 'inferred', 'generated'];
  if (!validProvenance.includes(options.sourceProvenance)) {
    throw new CLIError(
      `Invalid --source-provenance value: "${options.sourceProvenance}"`,
      1,
      [`Must be one of: ${validProvenance.join(', ')}`]
    );
  }

  // Validate commit SHA format if provided
  if (options.sourceRepoCommit && !/^[0-9a-f]{40}$/.test(options.sourceRepoCommit)) {
    throw new CLIError(
      `Invalid --source-repo-commit value: "${options.sourceRepoCommit}"`,
      1,
      ['Must be exactly 40 hexadecimal characters (full Git commit SHA)']
    );
  }

  // Require both or neither repo context fields
  if (options.sourceRepoRemote && !options.sourceRepoCommit) {
    throw new CLIError(
      '--source-repo-commit is required when --source-repo-remote is provided',
      1,
      ['Provide both remote URL and commit SHA for repository context']
    );
  }

  if (options.sourceRepoCommit && !options.sourceRepoRemote) {
    throw new CLIError(
      '--source-repo-remote is required when --source-repo-commit is provided',
      1,
      ['Provide both remote URL and commit SHA for repository context']
    );
  }
}

/**
 * Build SourceReference object from options
 */
export function buildSourceReference(options: SourceReferenceOptions): SourceReference | undefined {
  if (!options.sourceFile) {
    return undefined;
  }

  const reference: SourceReference = {
    provenance: options.sourceProvenance as ProvenanceType,
    locations: [{
      file: options.sourceFile,
      ...(options.sourceSymbol && { symbol: options.sourceSymbol })
    }]
  };

  if (options.sourceRepoRemote && options.sourceRepoCommit) {
    reference.repository = {
      url: options.sourceRepoRemote,
      commit: options.sourceRepoCommit
    };
  }

  return reference;
}
