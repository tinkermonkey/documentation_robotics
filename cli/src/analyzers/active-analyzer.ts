/**
 * Shared steps of the analyzer commands (`dr analyzer index`, `dr analyzer verify`) and the
 * codebase MCP tools (`codebase_index`, `codebase_verify`): which analyzer a project uses, its
 * backend, how to install it, which layers verify covers, and whether the index is fresh.
 */

import { spawnSync } from "node:child_process";
import { AnalyzerRegistry } from "./registry.js";
import { MappingLoader } from "./mapping-loader.js";
import { readIndexMeta, readSession } from "./session-state.js";
import type { AnalyzerBackend } from "./base-analyzer.js";
import type { IndexMeta } from "./types.js";
import { VERIFIABLE_LAYERS } from "./types.js";
import { binaryVersion } from "./version.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";

export const NO_ANALYZER_SELECTED = "No analyzer selected. Run `dr analyzer discover` first.";

// Layers `verify` can check, defined in types.ts so verify-engine.ts can read it without importing
// this module (which loads the analyzer registry, and through it cbm-analyzer.ts: a cycle).
export { VERIFIABLE_LAYERS } from "./types.js";

/** The analyzer to use: `explicit`, else the one selected for the project (session.json). */
export async function resolveAnalyzerName(projectRoot: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const session = await readSession(projectRoot);
  if (!session) {
    throw new CLIError(NO_ANALYZER_SELECTED, ErrorCategory.USER);
  }
  return session.active_analyzer;
}

/** The registered backend for `name`. Throws a not-found CLIError, with `suggestions`, if none. */
export async function getAnalyzerBackend(name: string, suggestions?: string[]): Promise<AnalyzerBackend> {
  const registry = AnalyzerRegistry.getInstance();
  await registry.initialize();
  const backend = await registry.getAnalyzer(name);
  if (!backend) {
    throw new CLIError(`Analyzer not found: ${name}`, ErrorCategory.NOT_FOUND, suggestions);
  }
  return backend;
}

/** The analyzer's homepage, from its mapping metadata. */
export async function analyzerHomepage(name: string): Promise<string> {
  try {
    const mapper = await MappingLoader.load(name);
    return mapper.getAnalyzerMetadata()?.homepage || "https://github.com/search?q=codebase-memory";
  } catch {
    return "https://github.com/search?q=codebase-memory";
  }
}

/** Splits requested layers into the ones verify checks and the ones it has no check for. */
export function splitVerifyLayers(requested: readonly string[] | undefined): {
  verifiable: string[];
  unsupported: string[];
} {
  const layers = requested && requested.length > 0 ? [...requested] : ["api"];
  return {
    verifiable: layers.filter((layer) => VERIFIABLE_LAYERS.includes(layer)),
    unsupported: layers.filter((layer) => !VERIFIABLE_LAYERS.includes(layer)),
  };
}

/** The git HEAD of `dir`, or null when it isn't a git repository or git fails. */
export function currentGitHead(dir: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, stdio: "pipe", encoding: "utf-8" });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The version of an analyzer's installed binary (`<binary> --version`), or null when none of its
 * binaries runs or prints a version. Reads the binary names from the analyzer's mapping metadata.
 */
export async function installedAnalyzerVersion(analyzerName: string): Promise<string | null> {
  let binaryNames: string[] = [];
  try {
    const mapper = await MappingLoader.load(analyzerName);
    binaryNames = (mapper.getAnalyzerMetadata()?.binary_names as string[] | undefined) ?? [];
  } catch {
    return null;
  }
  for (const binary of binaryNames) {
    try {
      const version = binaryVersion(binary);
      if (version) return version;
    } catch {
      // not installed under this name
    }
  }
  return null;
}

export type IndexFreshness =
  | { indexed: false; fresh: false }
  | {
      indexed: true;
      /** The index was taken at the code's current git HEAD. */
      fresh: boolean;
      meta: IndexMeta;
      /** The code's current git HEAD; null when it can't be read (the index then counts as stale). */
      currentGitHead: string | null;
    };

/**
 * Whether the project has an index from `analyzerName`, and whether it was taken at the code's
 * current git HEAD. Reads `.dr/analyzers/{analyzer}/index-meta.json` and runs git; it does not
 * start the analyzer. The same test as the analyzer's own `status()`.
 */
export async function readIndexFreshness(
  projectRoot: string,
  analyzerName: string,
  codebaseRoot: string,
  gitHead: (dir: string) => string | null = currentGitHead
): Promise<IndexFreshness> {
  const meta = await readIndexMeta(projectRoot, analyzerName);
  if (!meta) return { indexed: false, fresh: false };
  const head = gitHead(codebaseRoot);
  return { indexed: true, fresh: head !== null && head === meta.git_head, meta, currentGitHead: head };
}
