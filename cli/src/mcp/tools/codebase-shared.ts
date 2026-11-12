/**
 * Shared pieces of the codebase tools (codebase_index, codebase_verify, codebase_extract): the
 * analyzer access they need, injectable so tests run without codebase-memory-mcp, the errors that
 * tell the agent what to do next, and the one rule for whether the code index is fresh (also used
 * by project_status).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AnalyzerRegistry } from "../../analyzers/registry.js";
import { analyzerHomepage, currentGitHead, installedAnalyzerVersion, readIndexFreshness, type IndexFreshness } from "../../analyzers/active-analyzer.js";
import { SOURCE_EXT, VENDOR_EXCLUDE } from "../../analyzers/cards/build.js";
import { readIndexJob } from "../../analyzers/index-job.js";
import { analyzerChanged } from "../../analyzers/version.js";
import { readSession } from "../../analyzers/session-state.js";
import type { CodeChangesResult } from "../../analyzers/code-changes.js";
import type { AnalyzerBackend } from "../../analyzers/base-analyzer.js";
import type { AvailableAnalyzer } from "../../analyzers/types.js";
import type { SpawnFn } from "../../analyzers/index-job.js";
import type { RangeSize } from "../../analyzers/range-size.js";
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
  /**
   * The installed analyzer's version, or null when it can't be read (defaults to the binary's
   * `--version`). An index another version built is stale.
   */
  analyzerVersion?: (analyzer: string) => Promise<string | null>;
  /** Files a git range changed, for codebase_extract's `since` (defaults to git). */
  codeChanges?: (codebaseRoot: string, since: string) => Promise<CodeChangesResult>;
  /**
   * How many commits a `since` range covers, and shorter ranges inside it (defaults to git), for
   * codebase_extract's long-range notice and `preview`. Null when git can't say. The shorter
   * ranges are needed only when `wantSteps` (given the commit count) is true.
   */
  rangeSize?: (codebaseRoot: string, base: string, wantSteps?: (commits: number) => boolean) => RangeSize | null;
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
  analyzerVersion: installedAnalyzerVersion,
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

/**
 * The error for an analyzer that detection could not use. With `detail` (a binary was
 * found but failed, e.g. its initialize handshake timed out) the message says why, so an
 * agent is not told to reinstall something that is installed.
 */
export async function notInstalledError(name: string, detail?: string): Promise<CLIError> {
  if (detail) {
    return new CLIError(`The code analyzer ${name} could not be started: ${detail}`, ErrorCategory.USER, [
      "If it timed out on a slow or busy machine, raise DR_CBM_INIT_TIMEOUT_MS (milliseconds) in the dr MCP server's environment and restart the client",
      "Otherwise check that the binary runs, e.g. codebase-memory-mcp --version",
      "Then call codebase_index again",
    ]);
  }
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
 * Source files the analyzer indexes: what extraction reads (SOURCE_EXT), plus the other languages
 * codebase-memory-mcp supports (spec/analyzers/cbm/analyzer.json) and their header and module
 * variants.
 */
const INDEXED_EXT = /\.(mts|cts|kts|c|cc|cpp|cxx|h|hh|hpp|hxx|lua|dart|groovy)$/i;

/**
 * Whether a change to `file` (relative to the codebase root) can change what the index holds: a
 * source file the analyzer reads, outside DR's own folders and vendored or built code.
 */
export function isIndexedSource(file: string): boolean {
  const posix = file.replace(/\\/g, "/");
  if (posix.split("/").some((segment) => DR_FOLDERS.has(segment))) return false;
  if (VENDOR_EXCLUDE.test(posix)) return false;
  return SOURCE_EXT.test(posix) || INDEXED_EXT.test(posix);
}

/** An uncommitted change to a source file: `gone` when it was deleted or renamed away. */
interface WorkingChange {
  file: string;
  gone: boolean;
}

/**
 * The source files with uncommitted changes (staged, unstaged or untracked), relative to the
 * codebase root. A delete, and the old path of a rename, come back `gone`. Null when git can't say.
 */
async function workingChanges(git: GitRunner, codebaseRoot: string): Promise<WorkingChange[] | null> {
  const prefix = await git(["rev-parse", "--show-prefix"], codebaseRoot);
  if (!prefix.ok) return null;
  const status = await git(["status", "--porcelain", "-z", "--untracked-files=all", "--", "."], codebaseRoot);
  if (!status.ok) return null;
  const top = prefix.stdout.trim();
  const local = (file: string): string | null => (!top ? file : file.startsWith(top) ? file.slice(top.length) : null);
  const changes: WorkingChange[] = [];
  const add = (file: string | undefined, gone: boolean) => {
    const l = file ? local(file) : null;
    if (l && isIndexedSource(l)) changes.push({ file: l, gone });
  };
  const parts = status.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code[0] === "R" || code[0] === "C") {
      const from = parts[++i];
      add(file, false);
      if (code[0] === "R") add(from, true);
      continue;
    }
    add(file, code.includes("D"));
  }
  return changes;
}

/** A hash of each changed file's content; null for a file that is gone. */
async function hashWorkingChanges(codebaseRoot: string, changes: WorkingChange[]): Promise<Record<string, string | null>> {
  const files: Record<string, string | null> = {};
  for (const change of changes) {
    if (change.gone) {
      files[change.file] = null;
      continue;
    }
    try {
      files[change.file] = createHash("sha1").update(await readFile(path.join(codebaseRoot, change.file))).digest("hex");
    } catch {
      files[change.file] = null;
    }
  }
  return files;
}

/**
 * The uncommitted source files as an index run starts, so a later check can tell any change to
 * them, including a revert (`git stash`, `git checkout -- file`) that no mtime shows. Written by
 * codebase_index next to the index; used only when it belongs to the run that wrote the index.
 */
export interface WorktreeSnapshot {
  version: 1;
  jobId: string;
  takenAt: string;
  files: Record<string, string | null>;
}

const snapshotPath = (projectRoot: string, analyzer: string) =>
  path.join(projectRoot, ".dr", "analyzers", analyzer, "index-worktree.json");

/** The working tree's uncommitted source files now, with their content hashes. */
export async function takeWorktreeSnapshot(codebaseRoot: string, git: GitRunner = runGit): Promise<Omit<WorktreeSnapshot, "jobId"> | null> {
  const takenAt = new Date().toISOString();
  const changes = await workingChanges(git, codebaseRoot);
  if (!changes) return null;
  return { version: 1, takenAt, files: await hashWorkingChanges(codebaseRoot, changes) };
}

export async function writeWorktreeSnapshot(projectRoot: string, analyzer: string, snapshot: WorktreeSnapshot): Promise<void> {
  await mkdir(path.dirname(snapshotPath(projectRoot, analyzer)), { recursive: true });
  await writeFile(snapshotPath(projectRoot, analyzer), JSON.stringify(snapshot, null, 2));
}

/**
 * The snapshot of the run that wrote the current index, or null. It must belong to the last job,
 * that job must have finished, and the index must have been taken between the snapshot and the
 * job's end; an index from another run (a failed one, or `dr analyzer index` outside MCP) has none.
 */
export async function readWorktreeSnapshot(
  projectRoot: string,
  analyzer: string,
  indexedAt: string,
  isAlive?: (pid: number) => boolean
): Promise<WorktreeSnapshot | null> {
  let snapshot: WorktreeSnapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath(projectRoot, analyzer), "utf-8")) as WorktreeSnapshot;
  } catch {
    return null;
  }
  const job = await readIndexJob(projectRoot, { isAlive });
  const at = Date.parse(indexedAt);
  if (!job || job.jobId !== snapshot.jobId || job.state !== "done" || snapshot.version !== 1) return null;
  if (!(Date.parse(snapshot.takenAt) <= at) || (job.finishedAt && Date.parse(job.finishedAt) < at)) return null;
  return snapshot;
}

/** A clock a little ahead of this one still counts as now; beyond that an mtime is skew. */
const CLOCK_SKEW_MS = 1000;

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

/**
 * The probe the rule uses: git from the codebase root (async), or the injected deps.
 *
 * Uncommitted changes: with the snapshot of the run that wrote the index, any source file whose
 * uncommitted state differs from the snapshot (edited, deleted, renamed, reverted). Without one,
 * every delete and renamed-away path, and the files written after the index was taken; an mtime
 * in the future is clock skew and is ignored, so it can't ask for a re-index on every call.
 */
export function indexProbe(
  codebaseRoot: string,
  options: { git?: GitRunner; snapshot?: WorktreeSnapshot | null } & Pick<CodebaseToolDeps, "committedChanges" | "sourceEdits"> = {}
): IndexProbe {
  const git = options.git ?? runGit;
  return {
    async changedBetween(from, to) {
      if (options.committedChanges) return options.committedChanges(codebaseRoot, from, to);
      const result = await git(["diff", "--name-only", "--no-renames", "-z", "--relative", from, to, "--"], codebaseRoot);
      return result.ok ? result.stdout.split("\0").filter((file) => file.length > 0) : null;
    },
    async editedSince(sinceMs) {
      if (options.sourceEdits) return options.sourceEdits(codebaseRoot, sinceMs, isIndexedSource);
      const changes = await workingChanges(git, codebaseRoot);
      if (!changes) return [];
      if (options.snapshot) {
        const now = await hashWorkingChanges(codebaseRoot, changes);
        const then = options.snapshot.files;
        const files = new Set([...Object.keys(now), ...Object.keys(then)]);
        return [...files].filter((file) => !(file in now) || !(file in then) || now[file] !== then[file]);
      }
      const limit = Date.now() + CLOCK_SKEW_MS;
      const edited: string[] = [];
      for (const change of changes) {
        if (change.gone) {
          edited.push(change.file);
          continue;
        }
        try {
          const mtime = (await stat(path.join(codebaseRoot, change.file))).mtimeMs;
          if (mtime > sinceMs && mtime <= limit) edited.push(change.file);
        } catch {
          edited.push(change.file); // listed by git, gone now
        }
      }
      return [...new Set(edited)];
    },
  };
}

const short = (sha: string): string => sha.slice(0, 7);

function listed(files: string[]): string {
  return files.length > 5 ? `${files.slice(0, 5).join(", ")} and ${files.length - 5} more` : files.join(", ");
}

/**
 * Whether an index taken at `indexedCommit` and `indexedAt` still describes the code at `head`.
 * The one freshness rule for project_status, codebase_index, codebase_verify and codebase_extract.
 *
 * An index built by another analyzer version than `installedVersion` is stale whatever the code
 * did: an analyzer upgrade can change the graph's format and qualified names (codebase-memory-mcp
 * 0.11, 0.12.0 and 0.12.1 each did). A version unknown on either side does not count.
 */
export async function judgeIndex(
  index: { indexedCommit: string; indexedAt: string; analyzerVersion?: string },
  head: string | null,
  probe: IndexProbe,
  installedVersion?: string | null
): Promise<IndexJudgement> {
  if (head === null) {
    return { state: "stale", reason: "the code's git HEAD can't be read", committedSince: [], editedSince: [] };
  }
  if (analyzerChanged({ analyzer_version: index.analyzerVersion }, installedVersion)) {
    return {
      state: "stale",
      reason: `it was built by analyzer version ${index.analyzerVersion}, and ${installedVersion} is installed now`,
      committedSince: [],
      editedSince: [],
    };
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
      reason: `${n} source file${n === 1 ? " has" : "s have"} uncommitted changes (edits, deletes or renames) the index hasn't seen: ${listed(editedSince)}`,
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
  // Only an index that recorded its analyzer version can be judged by it; don't run the binary otherwise.
  const installedVersion = freshness.meta.analyzer_version ? await (deps.analyzerVersion ?? installedAnalyzerVersion)(analyzer) : null;
  const snapshot =
    options.uncommittedEdits === false ? null : await readWorktreeSnapshot(projectRoot, analyzer, freshness.meta.timestamp, deps.isAlive);
  const probe = indexProbe(codebaseRoot, { ...deps, snapshot });
  const judgement = await judgeIndex(
    { indexedCommit: freshness.meta.git_head, indexedAt: freshness.meta.timestamp, analyzerVersion: freshness.meta.analyzer_version },
    freshness.currentGitHead,
    options.uncommittedEdits === false ? { ...probe, editedSince: async () => [] } : probe,
    installedVersion
  );
  return { freshness, judgement };
}

/**
 * The index part of a codebase tool result. `fresh` is true only for the `fresh` state. Without a
 * judgement it never judges by HEAD equality: it reports the freshness it was given, which
 * requireFreshIndex sets by the rule, and otherwise says the state is unknown.
 *
 * Pass the judgement whenever there is one, so the state matches project_status: a caller of
 * requireFreshIndex passes its `index` (`describeIndex(result.freshness, result.index)`), and
 * then uncommitted edits read `fresh-with-uncommitted-edits` (with `fresh: false`, the reason and
 * `uncommittedEdits`) instead of a plain `fresh` beside a warning about those edits.
 */
export function describeIndex(freshness: IndexFreshness, judgement?: IndexJudgement | null): Record<string, unknown> {
  if (!freshness.indexed) return { indexed: false, fresh: false };
  const state: IndexState | "unknown" = judgement?.state ?? (freshness.fresh ? "fresh" : "unknown");
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
    ...(freshness.meta.analyzer_version ? { analyzerVersion: freshness.meta.analyzer_version } : {}),
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
    // `fresh` by the rule, not by HEAD equality, for callers that describe it (describeIndex).
    freshness: { ...freshness, fresh: true } as Extract<IndexFreshness, { indexed: true }> & { currentGitHead: string },
    index: judgement,
  };
}
