/**
 * Shared pieces of the codebase tools (codebase_index, codebase_verify): the analyzer access they
 * need, injectable so tests run without codebase-memory-mcp, and the errors that tell the agent
 * what to do next.
 */

import { realpath } from "node:fs/promises";
import { AnalyzerRegistry } from "../../analyzers/registry.js";
import { analyzerHomepage, currentGitHead, readIndexFreshness, type IndexFreshness } from "../../analyzers/active-analyzer.js";
import { readIndexJob } from "../../analyzers/index-job.js";
import { readSession } from "../../analyzers/session-state.js";
import type { CodeChangesResult } from "../../analyzers/code-changes.js";
import type { AnalyzerBackend } from "../../analyzers/base-analyzer.js";
import type { AvailableAnalyzer } from "../../analyzers/types.js";
import type { SpawnFn } from "../../analyzers/index-job.js";
import type { DrCommand } from "../../coding-agents/drbot-mcp.js";
import { performDiscover } from "../../commands/discover-logic.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";

export interface CodebaseToolDeps {
  /** The registered backend for an analyzer name. */
  getAnalyzer(name: string): Promise<AnalyzerBackend | undefined>;
  /** Non-interactive discovery: the analyzers found, and the first installed one. */
  discover(): Promise<{ found: AvailableAnalyzer[]; selected?: string }>;
  /** Spawns the background `dr analyzer index` (defaults to node's spawn). */
  spawn?: SpawnFn;
  /** How to run this dr installation (defaults to the running one). */
  drCommand?: DrCommand;
  /** Whether a job's process is still the job (defaults to the pid's liveness and command line). */
  isAlive?: (pid: number) => boolean;
  /** Sends signals, to stop a run that `force` replaces (defaults to `process.kill`). */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** The code's git HEAD (defaults to `git rev-parse HEAD`). */
  gitHead?: (dir: string) => string | null;
  /** Files a git range changed, for codebase_extract's `since` (defaults to git). */
  codeChanges?: (codebaseRoot: string, since: string) => Promise<CodeChangesResult>;
  /** Source files with uncommitted edits newer than a time (defaults to git status and mtimes). */
  sourceEdits?: (codebaseRoot: string, sinceMs: number, isSource: (file: string) => boolean) => Promise<string[]>;
  /** codebase_extract's time budget in milliseconds (default 100 s). */
  budgetMs?: number;
}

export const defaultCodebaseToolDeps: CodebaseToolDeps = {
  async getAnalyzer(name) {
    const registry = AnalyzerRegistry.getInstance();
    await registry.initialize();
    return registry.getAnalyzer(name);
  },
  async discover() {
    const registry = AnalyzerRegistry.getInstance();
    await registry.initialize();
    const { discoveryResult } = await performDiscover(registry, { json: true, isTTY: false });
    return { found: discoveryResult.found, selected: discoveryResult.selected ?? undefined };
  },
  gitHead: currentGitHead,
};

/**
 * The project and codebase roots, spelled canonically (symlinks resolved). The background child
 * finds its project from its working directory, which the OS reports resolved, and the analyzer
 * matches projects by the exact root string, so both sides must use these spellings.
 */
export async function canonicalRoots(model: { rootPath: string; codebaseRoot: string }): Promise<{
  projectRoot: string;
  codebaseRoot: string;
}> {
  const resolve = async (dir: string) => {
    try {
      return await realpath(dir);
    } catch {
      return dir;
    }
  };
  return { projectRoot: await resolve(model.rootPath), codebaseRoot: await resolve(model.codebaseRoot) };
}

/** How to install an analyzer, for an agent to relay. */
export async function installSuggestions(name: string): Promise<string[]> {
  const homepage = await analyzerHomepage(name);
  return [
    `Install codebase-memory-mcp (${homepage}), for example: npm install -g codebase-memory-mcp`,
    "Make sure the binary is on the PATH the dr MCP server runs with (restart the client after installing)",
    "Then call codebase_index again",
  ];
}

export async function notInstalledError(name: string): Promise<CLIError> {
  return new CLIError(`The code analyzer is not installed: ${name}`, ErrorCategory.USER, await installSuggestions(name));
}

export function analyzerNotFoundError(name: string): CLIError {
  return new CLIError(`Analyzer not found: ${name}`, ErrorCategory.NOT_FOUND, [
    "Run `dr analyzer discover --reselect` in the project to select an installed analyzer",
  ]);
}

/** The index part of a codebase tool result. */
export function describeIndex(freshness: IndexFreshness): Record<string, unknown> {
  if (!freshness.indexed) return { indexed: false, fresh: false };
  return {
    indexed: true,
    fresh: freshness.fresh,
    lastIndexed: freshness.meta.timestamp,
    gitHead: freshness.meta.git_head,
    currentGitHead: freshness.currentGitHead,
    nodeCount: freshness.meta.node_count,
    edgeCount: freshness.meta.edge_count,
  };
}

/**
 * The analyzer and its index, when the index is fresh: taken at the code's current git HEAD, with
 * no index run in flight. Otherwise a CLIError that points at codebase_index, then `tool` again.
 */
export async function requireFreshIndex(
  projectRoot: string,
  codebaseRoot: string,
  deps: CodebaseToolDeps,
  tool: string
): Promise<{ analyzer: string; freshness: Extract<IndexFreshness, { indexed: true }> & { currentGitHead: string } }> {
  const reindex = `Call codebase_index, poll it with status: true until job.state is done, then call ${tool} again`;
  const job = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
  if (job?.state === "running") {
    throw new CLIError(`An index run is in progress (started ${job.startedAt})`, ErrorCategory.USER, [
      `Poll codebase_index with status: true until job.state is done, then call ${tool} again`,
    ]);
  }
  const analyzer = (await readSession(projectRoot))?.active_analyzer;
  const freshness = analyzer
    ? await readIndexFreshness(projectRoot, analyzer, codebaseRoot, deps.gitHead)
    : ({ indexed: false, fresh: false } as const);
  if (!analyzer || !freshness.indexed) {
    throw new CLIError("The code is not indexed", ErrorCategory.USER, [reindex]);
  }
  if (!freshness.fresh || freshness.currentGitHead === null) {
    const why =
      freshness.currentGitHead === null
        ? `the code's git HEAD can't be read in ${codebaseRoot}`
        : `it was taken at git HEAD ${freshness.meta.git_head}, and the code is now at ${freshness.currentGitHead}`;
    throw new CLIError(`The index is stale: ${why}`, ErrorCategory.USER, [reindex]);
  }
  return { analyzer, freshness: freshness as Extract<IndexFreshness, { indexed: true }> & { currentGitHead: string } };
}
