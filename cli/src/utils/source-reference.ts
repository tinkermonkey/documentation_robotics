/**
 * Source Reference Utilities
 * Shared validation and builder functions for source reference options
 */

import type { SourceReference, ProvenanceType } from "../types/index.js";
import { CLIError } from "./errors.js";
import { optionExample, optionName, type HintOption, type HintSurface } from "./error-hints.js";

export interface SourceReferenceOptions {
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
}

const VALID_PROVENANCE = ["extracted", "manual", "inferred", "generated"];

/** Provenances the source-references schema documents as needing a location (a file). */
const FILE_REQUIRED_PROVENANCE = ["extracted", "manual"];

/** The provenance given to a source file sent without one. The schema has no `planned` value. */
export const DEFAULT_PROVENANCE = "manual";

export interface ResolvedSourceReferenceOptions {
  /** The options to build the reference from: provenance filled in, or the source fields dropped. */
  options: SourceReferenceOptions;
  /** What was defaulted or ignored, to show the caller. */
  warnings: string[];
}

function hasSourceOptions(options: SourceReferenceOptions): boolean {
  return !!(
    options.sourceFile ||
    options.sourceSymbol ||
    options.sourceProvenance ||
    options.sourceRepoRemote ||
    options.sourceRepoCommit
  );
}

/**
 * Check source reference options and settle the two partial forms instead of refusing them:
 *
 * - A file without a provenance gets the element's current provenance (`existing`, on update),
 *   else `manual`.
 * - An `extracted` or `manual` provenance without a file (and no file on the element already) is
 *   ignored with a warning: the schema documents a location as required for those two. `inferred`
 *   and `generated` need no file.
 *
 * Throws for what cannot be settled: an unknown provenance, a symbol without a file, a bad commit
 * SHA, or repository fields without a file or with one of the pair missing.
 */
export function resolveSourceReferenceOptions(
  options: SourceReferenceOptions,
  surface: HintSurface = "cli",
  existing?: SourceReference
): ResolvedSourceReferenceOptions {
  const name = (option: HintOption) => optionName(surface, option);
  const example = (option: HintOption, value: string) => optionExample(surface, option, value);
  const warnings: string[] = [];

  if (!hasSourceOptions(options)) {
    return { options, warnings };
  }

  if (options.sourceProvenance && !VALID_PROVENANCE.includes(options.sourceProvenance)) {
    throw new CLIError(`Invalid ${name("sourceProvenance")} value: "${options.sourceProvenance}"`, 1, [
      `Must be one of: ${VALID_PROVENANCE.join(", ")}`,
    ]);
  }

  // A symbol names something inside a file: it needs the file.
  if (options.sourceSymbol && !options.sourceFile) {
    throw new CLIError(`${name("sourceSymbol")} requires ${name("sourceFile")}`, 1, [
      "Provide the source file that contains the symbol",
      `Example: ${example("sourceFile", "src/auth.ts")} ${example("sourceSymbol", "validateToken")}`,
    ]);
  }

  // Validate commit SHA format if provided
  if (options.sourceRepoCommit && !/^[0-9a-f]{40}$/.test(options.sourceRepoCommit)) {
    throw new CLIError(`Invalid ${name("sourceRepoCommit")} value: "${options.sourceRepoCommit}"`, 1, [
      "Must be exactly 40 hexadecimal characters (full Git commit SHA)",
    ]);
  }

  // Require both or neither repo context fields
  if (options.sourceRepoRemote && !options.sourceRepoCommit) {
    throw new CLIError(
      `${name("sourceRepoCommit")} is required when ${name("sourceRepoRemote")} is provided`,
      1,
      ["Provide both remote URL and commit SHA for repository context"]
    );
  }

  if (options.sourceRepoCommit && !options.sourceRepoRemote) {
    throw new CLIError(
      `${name("sourceRepoRemote")} is required when ${name("sourceRepoCommit")} is provided`,
      1,
      ["Provide both remote URL and commit SHA for repository context"]
    );
  }

  if (!options.sourceProvenance) {
    if (!options.sourceFile) {
      // Only repository fields: there is no file to attach them to.
      throw new CLIError(`${name("sourceRepoRemote")} and ${name("sourceRepoCommit")} need a source file`, 1, [
        `Send ${name("sourceFile")} with them, e.g. ${example("sourceFile", "src/services/auth.ts")}`,
      ]);
    }
    const provenance = existing?.provenance ?? DEFAULT_PROVENANCE;
    warnings.push(
      `${name("sourceProvenance")} was not given; used '${provenance}'` +
        (existing?.provenance ? " (the element's current provenance)." : ".")
    );
    return { options: { ...options, sourceProvenance: provenance }, warnings };
  }

  const hasFile = !!options.sourceFile || (existing?.locations?.length ?? 0) > 0;
  if (!hasFile && FILE_REQUIRED_PROVENANCE.includes(options.sourceProvenance)) {
    warnings.push(
      `${name("sourceProvenance")} '${options.sourceProvenance}' was ignored: it needs a ${name("sourceFile")}, so no ` +
        `source reference was recorded. For an element with no code yet, send no source fields (or ` +
        `${example("sourceProvenance", "inferred")}); otherwise send ${name("sourceFile")} with it.`
    );
    return { options: {}, warnings };
  }

  return { options, warnings };
}

/**
 * Validate source reference options. Throws where {@link resolveSourceReferenceOptions} throws;
 * the partial forms it settles pass.
 */
export function validateSourceReferenceOptions(
  options: SourceReferenceOptions,
  surface: HintSurface = "cli"
): void {
  if (!hasSourceOptions(options)) {
    if (process.stderr.isTTY) {
      const name = (option: HintOption) => optionName(surface, option);
      console.warn(
        `Warning: no source provenance specified. Add ${name("sourceFile")} and ${name("sourceProvenance")} to maintain traceability for drift detection and /dr-sync workflows.`
      );
    }
    return;
  }
  resolveSourceReferenceOptions(options, surface);
}

/**
 * Build SourceReference object from options. On update, pass the element's current reference as
 * `existing`: a change that names no file keeps its locations (and its repository with them).
 */
export function buildSourceReference(
  options: SourceReferenceOptions,
  existing?: SourceReference
): SourceReference | undefined {
  if (!options.sourceProvenance) {
    return undefined;
  }

  const reference: SourceReference = {
    provenance: options.sourceProvenance as ProvenanceType,
  };

  if (options.sourceFile) {
    reference.locations = [
      {
        file: options.sourceFile,
        ...(options.sourceSymbol && { symbol: options.sourceSymbol }),
      },
    ];
  }

  if (options.sourceRepoRemote && options.sourceRepoCommit) {
    reference.repository = {
      url: options.sourceRepoRemote,
      commit: options.sourceRepoCommit,
    };
  }

  if (!reference.locations && existing?.locations?.length) {
    reference.locations = existing.locations;
    if (!reference.repository && existing.repository) reference.repository = existing.repository;
  }

  return reference;
}
