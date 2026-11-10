/**
 * Source Reference Utilities
 * Shared validation and builder functions for source reference options
 */

import type { SourceReference, SourceLocation, ProvenanceType } from "../types/index.js";
import { CLIError } from "./errors.js";
import { optionExample, optionName, type HintOption, type HintSurface } from "./error-hints.js";

export interface SourceReferenceOptions {
  sourceFile?: string;
  sourceSymbol?: string;
  sourceProvenance?: string;
  sourceRepoRemote?: string;
  sourceRepoCommit?: string;
  /**
   * Set only by {@link resolveSourceReferenceOptions} for a symbol sent without a file: the
   * element's locations with the symbol added. {@link buildSourceReference} uses them as they are.
   */
  settledLocations?: SourceLocation[];
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

/** The distinct files an element's source reference names, in order. */
function referenceFiles(reference?: SourceReference): string[] {
  return [...new Set((reference?.locations ?? []).map((location) => location.file).filter(Boolean))];
}

/**
 * Settle a symbol sent without a file, on the element's one source file, keeping its other
 * locations, its provenance and its repository unless the call names them:
 *
 * - one location with no symbol: the symbol goes on it;
 * - otherwise the file holds other symbols: `{file, symbol}` is appended, unless it is there already.
 *
 * Throws when there is no file to keep (always, on add) or more than one to choose from.
 */
function symbolOnExistingFile(
  options: SourceReferenceOptions,
  surface: HintSurface,
  existing?: SourceReference
): SourceReferenceOptions {
  const name = (option: HintOption) => optionName(surface, option);
  const example = (option: HintOption, value: string) => optionExample(surface, option, value);
  const files = referenceFiles(existing);

  if (files.length === 0) {
    throw new CLIError(
      `${name("sourceSymbol")} needs ${name("sourceFile")}: a symbol names something inside a file, and the ` +
        `element has no source file to put it on`,
      1,
      [
        "Send the source file that contains the symbol with it",
        `Example: ${example("sourceFile", "src/auth.ts")} ${example("sourceSymbol", "validateToken")}`,
      ]
    );
  }
  if (files.length > 1) {
    throw new CLIError(
      `${name("sourceSymbol")} alone is ambiguous: this element has ${files.length} source files (${files.join(", ")})`,
      1,
      [`Send ${name("sourceFile")} with it to say which file holds the symbol`]
    );
  }

  const file = files[0];
  const symbol = options.sourceSymbol!;
  const current = existing?.locations ?? [];
  const settledLocations: SourceLocation[] =
    current.length === 1 && !current[0].symbol
      ? [{ ...current[0], symbol }]
      : current.some((location) => location.symbol === symbol)
        ? current.map((location) => ({ ...location }))
        : [...current.map((location) => ({ ...location })), { file, symbol }];

  const repository = existing?.repository;
  const keepRepository =
    !options.sourceRepoRemote && !options.sourceRepoCommit && !!repository?.url && !!repository?.commit;
  return {
    ...options,
    sourceFile: file,
    settledLocations,
    sourceProvenance: options.sourceProvenance ?? existing?.provenance ?? DEFAULT_PROVENANCE,
    ...(keepRepository ? { sourceRepoRemote: repository!.url, sourceRepoCommit: repository!.commit } : {}),
  };
}

/**
 * Refuse, before the element is loaded, the source options no element could settle. A symbol sent
 * without a file is left to {@link resolveSourceReferenceOptions} with the element's reference: on
 * update it can go on the element's own file.
 */
export function precheckUpdateSourceReferenceOptions(
  options: SourceReferenceOptions,
  surface: HintSurface = "cli"
): void {
  resolveSourceReferenceOptions(options.sourceFile ? options : { ...options, sourceSymbol: undefined }, surface);
}

/**
 * Check source reference options and settle the two partial forms instead of refusing them:
 *
 * - A file without a provenance gets the element's current provenance (`existing`, on update),
 *   else `manual`.
 * - A symbol without a file goes on the element's one source file (`existing`, on update), keeping
 *   its provenance and repository.
 * - An `extracted` or `manual` provenance without a file (and no file on the element already) is
 *   ignored with a warning: the schema documents a location as required for those two. `inferred`
 *   and `generated` need no file.
 *
 * Throws for what cannot be settled: an unknown provenance, a symbol with no file sent or kept, a bad commit
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

  // A symbol names something inside a file. Sent alone on update, it goes on the element's own
  // file, keeping the provenance and repository; with no file to keep, the file must be sent.
  if (options.sourceSymbol && !options.sourceFile) {
    options = symbolOnExistingFile(options, surface, existing);
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

  if (options.settledLocations) {
    reference.locations = options.settledLocations;
  } else if (options.sourceFile) {
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
