/**
 * Shared pieces of the codebase tools (codebase_index, codebase_verify): the analyzer access they
 * need, injectable so tests run without codebase-memory-mcp, and the errors that tell the agent
 * what to do next.
 */

import { AnalyzerRegistry } from "../../analyzers/registry.js";
import { analyzerHomepage, currentGitHead, type IndexFreshness } from "../../analyzers/active-analyzer.js";
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
  /** Whether a job's process is alive (defaults to a signal-0 probe). */
  isAlive?: (pid: number) => boolean;
  /** The code's git HEAD (defaults to `git rev-parse HEAD`). */
  gitHead?: (dir: string) => string | null;
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
