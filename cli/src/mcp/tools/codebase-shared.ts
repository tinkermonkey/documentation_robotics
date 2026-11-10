/**
 * Shared pieces of the codebase tools (codebase_index, codebase_verify, codebase_extract): the
 * analyzer access they need, injectable so tests run without codebase-memory-mcp, the errors that
 * tell the agent what to do next, and the one rule for whether the code index is fresh (also used
 * by project_status).
 */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { AnalyzerRegistry } from "../../analyzers/registry.js";
import { analyzerHomepage, currentGitHead, readIndexFreshness, type IndexFreshness } from "../../analyzers/active-analyzer.js";
import { SOURCE_EXT } from "../../analyzers/cards/build.js";
import { sourceEditsSince } from "../../analyzers/code-changes.js";
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
  /**
   * Files changed between two commits, relative to the codebase root; null when git can't say
   * (defaults to git diff). Index freshness reads it when HEAD has moved since the index.
   */
  committedChanges?: (codebaseRoot: string, from: string, to: string) => Promise<string[] | null>;
  /** How long codebase_index's `wait` sleeps between reads of the job (default 1 s). */
  pollIntervalMs?: number;
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

// ---------------------------------------------------------------------------------------------
// git

export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; missing?: boolean };
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

/** Runs git read-only: no shell, no optional locks (so it never contends for index.lock), a timeout. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 10_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ ok: true, stdout: String(stdout) });
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        resolve({ ok: false, missing, error: String(stderr).trim() || error.message });
      }
    );
  });

// ---------------------------------------------------------------------------------------------
// index freshness: the one rule

/** DR's own folders. Changes under them never make the code index stale. */
const DR_FOLDERS = new Set(["documentation-robotics", ".dr"]);

/**
 * Whether a change to `file` (relative to the codebase root) can change what the index holds: a
 * source file of a kind extraction reads, outside DR's own folders.
 */
export function isIndexedSource(file: string): boolean {
  const posix = file.replace(/\\/g, "/");
  if (posix.split("/").some((segment) => DR_FOLDERS.has(segment))) return false;
  return SOURCE_EXT.test(posix);
}

/**
 * - `fresh`: no source file changed since the index was taken. HEAD may have moved, by commits
 *   that touched only the model, DR's folders or non-source files.
 * - `fresh-with-uncommitted-edits`: no commit changed a source file, but uncommitted source edits
 *   were written after the index was taken. The tools still run, with a warning.
 * - `stale`: commits since the index changed source files, or git can't tell.
 */
export type IndexState = "fresh" | "fresh-with-uncommitted-edits" | "stale";

export interface IndexJudgement {
  state: IndexState;
  /** Why the index is not plainly fresh, or why it is fresh though HEAD moved. */
  reason?: string;
  /** Source files changed by commits since the indexed commit. */
  committedSince: string[];
  /** Source files with uncommitted edits written after the index was taken. */
  editedSince: string[];
}

/** What the rule asks git: commits between two points, and uncommitted edits after a time. */
export interface IndexProbe {
  /** Files changed between two commits, relative to the codebase root; null when git can't say. */
  changedBetween(from: string, to: string): Promise<string[] | null>;
  /** Source files with uncommitted edits written after `sinceMs`, relative to the codebase root. */
  editedSince(sinceMs: number): Promise<string[]>;
}

/** The probe the rule uses: git from the codebase root, or the injected deps. */
export function indexProbe(
  codebaseRoot: string,
  options: { git?: GitRunner } & Pick<CodebaseToolDeps, "committedChanges" | "sourceEdits"> = {}
): IndexProbe {
  const git = options.git ?? runGit;
  return {
    async changedBetween(from, to) {
      if (options.committedChanges) return options.committedChanges(codebaseRoot, from, to);
      const result = await git(["diff", "--name-only", "--no-renames", "-z", "--relative", from, to, "--"], codebaseRoot);
      return result.ok ? result.stdout.split("\0").filter((file) => file.length > 0) : null;
    },
    editedSince: (sinceMs) => (options.sourceEdits ?? sourceEditsSince)(codebaseRoot, sinceMs, isIndexedSource),
  };
}

const short = (sha: string): string => sha.slice(0, 7);

function listed(files: string[]): string {
  return files.length > 5 ? `${files.slice(0, 5).join(", ")} and ${files.length - 5} more` : files.join(", ");
}

/**
 * Whether an index taken at `indexedCommit` and `indexedAt` still describes the code at `head`.
 * The one freshness rule for project_status, codebase_index, codebase_verify and codebase_extract.
 */
export async function judgeIndex(
  index: { indexedCommit: string; indexedAt: string },
  head: string | null,
  probe: IndexProbe
): Promise<IndexJudgement> {
  if (head === null) {
    return { state: "stale", reason: "the code's git HEAD can't be read", committedSince: [], editedSince: [] };
  }
  let committedSince: string[] = [];
  let moved: string | undefined;
  if (head !== index.indexedCommit) {
    const changed = await probe.changedBetween(index.indexedCommit, head);
    if (changed === null) {
      return {
        state: "stale",
        reason: `it was taken at git HEAD ${index.indexedCommit}, and the code is now at ${head}`,
        committedSince: [],
        editedSince: [],
      };
    }
    committedSince = changed.filter(isIndexedSource).sort();
    if (committedSince.length > 0) {
      const n = committedSince.length;
      return {
        state: "stale",
        reason:
          `${n} source file${n === 1 ? "" : "s"} changed in commits since it was taken at ` +
          `${short(index.indexedCommit)} (the code is now at ${short(head)}): ${listed(committedSince)}`,
        committedSince,
        editedSince: [],
      };
    }
    moved = `the code moved from ${short(index.indexedCommit)} to ${short(head)}, but no commit since changed a source file`;
  }
  const at = Date.parse(index.indexedAt);
  const editedSince = Number.isNaN(at) ? [] : [...(await probe.editedSince(at))].sort();
  if (editedSince.length > 0) {
    const n = editedSince.length;
    return {
      state: "fresh-with-uncommitted-edits",
      reason: `${n} source file${n === 1 ? " has" : "s have"} uncommitted edits made after the index was taken: ${listed(editedSince)}`,
      committedSince,
      editedSince,
    };
  }
  return { state: "fresh", ...(moved ? { reason: moved } : {}), committedSince, editedSince };
}

/**
 * The index's freshness by the rule, read the way the codebase tools read it. With
 * `uncommittedEdits: false` it skips the uncommitted-edits check (which never makes an index
 * stale), so `fresh-with-uncommitted-edits` reads as `fresh`.
 */
export async function assessIndex(
  projectRoot: string,
  analyzer: string,
  codebaseRoot: string,
  deps: CodebaseToolDeps,
  options: { uncommittedEdits?: boolean } = {}
): Promise<{ freshness: IndexFreshness; judgement: IndexJudgement | null }> {
  const freshness = await readIndexFreshness(projectRoot, analyzer, codebaseRoot, deps.gitHead);
  if (!freshness.indexed) return { freshness, judgement: null };
  const probe = indexProbe(codebaseRoot, deps);
  const judgement = await judgeIndex(
    { indexedCommit: freshness.meta.git_head, indexedAt: freshness.meta.timestamp },
    freshness.currentGitHead,
    options.uncommittedEdits === false ? { ...probe, editedSince: async () => [] } : probe
  );
  return { freshness, judgement };
}

/** The index part of a codebase tool result. `fresh` is true only for the `fresh` state. */
export function describeIndex(freshness: IndexFreshness, judgement?: IndexJudgement | null): Record<string, unknown> {
  if (!freshness.indexed) return { indexed: false, fresh: false };
  const state: IndexState = judgement?.state ?? (freshness.fresh ? "fresh" : "stale");
  return {
    indexed: true,
    fresh: state === "fresh",
    state,
    ...(judgement?.reason ? { reason: judgement.reason } : {}),
    ...(judgement?.editedSince.length ? { uncommittedEdits: judgement.editedSince } : {}),
    lastIndexed: freshness.meta.timestamp,
    gitHead: freshness.meta.git_head,
    currentGitHead: freshness.currentGitHead,
    nodeCount: freshness.meta.node_count,
    edgeCount: freshness.meta.edge_count,
  };
}

/** How an agent waits for an index run: a blocking call, not a tight polling loop. */
export const WAIT_FOR_INDEX = "Call codebase_index with status: true and wait: 30 until job.state is done";

/**
 * The analyzer and its index, when the index is usable: not stale by the rule (judgeIndex), with
 * no index run in flight. Otherwise a CLIError that points at codebase_index, then `tool` again.
 *
 * Uncommitted edits never block. With `uncommittedEdits: true`, `index.state` is
 * `fresh-with-uncommitted-edits` when uncommitted source edits are newer than the index, and
 * `index.editedSince` lists them for the caller's warning; without it that check is skipped.
 */
export async function requireFreshIndex(
  projectRoot: string,
  codebaseRoot: string,
  deps: CodebaseToolDeps,
  tool: string,
  options: { uncommittedEdits?: boolean } = {}
): Promise<{
  analyzer: string;
  freshness: Extract<IndexFreshness, { indexed: true }> & { currentGitHead: string };
  index: IndexJudgement;
}> {
  const reindex = `Call codebase_index with wait: 30 (then with status: true and wait: 30 until job.state is done), then call ${tool} again`;
  const job = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
  if (job?.state === "running") {
    throw new CLIError(`An index run is in progress (started ${job.startedAt})`, ErrorCategory.USER, [
      `${WAIT_FOR_INDEX}, then call ${tool} again`,
    ]);
  }
  const analyzer = (await readSession(projectRoot))?.active_analyzer;
  const { freshness, judgement } = analyzer
    ? await assessIndex(projectRoot, analyzer, codebaseRoot, deps, { uncommittedEdits: options.uncommittedEdits === true })
    : { freshness: { indexed: false, fresh: false } as const, judgement: null };
  if (!analyzer || !freshness.indexed || !judgement) {
    throw new CLIError("The code is not indexed", ErrorCategory.USER, [reindex]);
  }
  if (judgement.state === "stale" || freshness.currentGitHead === null) {
    const why = freshness.currentGitHead === null ? `the code's git HEAD can't be read in ${codebaseRoot}` : judgement.reason;
    throw new CLIError(`The index is stale: ${why}`, ErrorCategory.USER, [reindex]);
  }
  return {
    analyzer,
    freshness: freshness as Extract<IndexFreshness, { indexed: true }> & { currentGitHead: string },
    index: judgement,
  };
}
