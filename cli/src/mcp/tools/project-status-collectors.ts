/**
 * The collectors behind project_status. Each one reports one section from local files and git,
 * independently of the others: a collector that fails reports its own error and the rest still
 * answer. A new section (the running viewer, indexing progress) is one more collector.
 *
 * Nothing here touches the network or starts the code analyzer.
 */

import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Model } from "../../core/model.js";
import type { Changeset } from "../../core/changeset.js";
import { BaseSnapshotManager } from "../../core/base-snapshot-manager.js";
import { MigrationRegistry } from "../../core/migration-registry.js";
import { StagedChangesetStorage } from "../../core/staged-changeset-storage.js";
import { readIndexMeta, readSession } from "../../analyzers/session-state.js";
import { getCliBundledSpecVersion, getModelSpecVersion } from "../../utils/spec-version.js";
import { fileExists, readFile } from "../../utils/file-io.js";
import { probeViewer, viewerUrl } from "../../server/viewer-registry.js";
import { readIndexJob } from "../../analyzers/index-job.js";
import { getErrorMessage } from "../../utils/errors.js";
import { indexProbe, judgeIndex, type GitRunner } from "./codebase-shared.js";

/** How the project root was chosen. */
export type RootResolution = "rootPath" | "DR_MCP_ROOT_PATH" | "mcp-roots" | "cwd";

/** What every collector gets: where the project is, and shared, lazily loaded resources. */
export interface StatusContext {
  /** The directory the call resolved to (the `rootPath` argument, or the served root). */
  root: string;
  resolvedBy: RootResolution;
  /** The directory holding documentation-robotics/, at or above `root`; null when there is none. */
  projectRoot: string | null;
  /** documentation-robotics/model/ when its manifest.yaml exists; null when there is no model. */
  modelDir: string | null;
  /** The loaded model, shared by every collector (and with the other tools through the cache). */
  model(): Promise<Model>;
  git: GitRunner;
}

/** A section a collector could not produce. */
export interface ErrorSection {
  status: "error";
  error: string;
}

// ---------------------------------------------------------------------------------------------
// git

// The read-only git runner lives with the index freshness rule (codebase-shared.ts), which uses it too.
export { runGit, type GitResult, type GitRunner } from "./codebase-shared.js";

/** NUL-separated git output (`-z`) as a list. */
function splitZ(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

/** `dir` with symlinks resolved, as git reports paths (macOS's /var is /private/var). */
async function real(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** The top of the git work tree holding `dir`, or why there is none. */
async function gitTopLevel(git: GitRunner, dir: string): Promise<{ top: string } | { reason: string }> {
  if (!(await fileExists(dir))) return { reason: `${dir} does not exist` };
  const result = await git(["rev-parse", "--show-toplevel"], dir);
  if (result.ok) return { top: await real(result.stdout.trim()) };
  if (result.missing) return { reason: "git is not installed" };
  return { reason: `${dir} is not in a git repository` };
}

// ---------------------------------------------------------------------------------------------
// model

export type ModelSection =
  | { status: "absent"; reason: string }
  | { status: "present"; path: string; name?: string; elements?: number; loadError?: string };

export async function collectModel(ctx: StatusContext): Promise<ModelSection> {
  if (!ctx.modelDir) {
    return {
      status: "absent",
      reason: ctx.projectRoot
        ? `${path.join(ctx.projectRoot, "documentation-robotics")} has no model/manifest.yaml`
        : `no documentation-robotics/ folder at or above ${ctx.root}`,
    };
  }
  const section: ModelSection = { status: "present", path: ctx.modelDir };
  try {
    const model = await ctx.model();
    section.name = model.manifest.name;
    section.elements = [...model.layers.values()].reduce((sum, layer) => sum + layer.listElements().length, 0);
  } catch (error) {
    section.loadError = getErrorMessage(error);
  }
  return section;
}

// ---------------------------------------------------------------------------------------------
// spec version

export type SpecSection = {
  /** current: same as the CLI's; behind: project_upgrade moves it; ahead: the CLI is older than the model. */
  status: "current" | "behind" | "ahead" | "no-model";
  model: string | null;
  cli: string;
  upgradeNeeded: boolean;
  /** When behind: whether the CLI has a migration path to its spec, and its steps. */
  migration?: { available: boolean; steps: string[] };
  reason?: string;
  /** Set when the manifest names no spec version and `model` is the assumed one. */
  assumed?: true;
  note?: string;
};

export async function collectSpec(ctx: StatusContext): Promise<SpecSection> {
  const cli = getCliBundledSpecVersion();
  if (!ctx.modelDir) return { status: "no-model", model: null, cli, upgradeNeeded: false };

  const declared = await getModelSpecVersion(ctx.modelDir);
  // A manifest without spec_version is read as 0.6.0 by Model.load and dr upgrade; say the same.
  const modelVersion = declared ?? ASSUMED_SPEC_VERSION;
  const assumed = declared
    ? {}
    : { assumed: true as const, note: `manifest.yaml has no spec_version; assumed ${ASSUMED_SPEC_VERSION}, as dr upgrade does` };

  const order = compareVersions(modelVersion, cli);
  if (order === 0) return { status: "current", model: modelVersion, cli, upgradeNeeded: false, ...assumed };
  if (order > 0) {
    return {
      status: "ahead",
      model: modelVersion,
      cli,
      upgradeNeeded: false,
      reason: `the model is on spec ${modelVersion}, newer than this CLI's ${cli}; update the dr CLI`,
      ...assumed,
    };
  }

  const steps = new MigrationRegistry().getMigrationPath(modelVersion, cli);
  const reaches = steps.length > 0 && steps[steps.length - 1].toVersion === cli;
  return {
    status: "behind",
    model: modelVersion,
    cli,
    upgradeNeeded: true,
    migration: {
      available: reaches,
      steps: steps.map((step) => `${step.fromVersion} → ${step.toVersion}`),
    },
    ...(reaches ? {} : { reason: `no migration path from ${modelVersion} to ${cli}` }),
    ...assumed,
  };
}

/** The spec version Model.load and dr upgrade read when the manifest names none. */
const ASSUMED_SPEC_VERSION = "0.6.0";

/** -1, 0 or 1, comparing dotted numeric versions part by part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// changesets

export interface ChangesetEntry {
  id: string;
  name: string;
  /** Staged changes by operation; `total` counts them all. */
  changes: Record<string, number> & { total: number };
  /** Whether the base model changed since the changeset was opened; null when that can't be told. */
  baseDrifted: boolean | null;
}

export type ChangesetsSection =
  | { status: "no-model" }
  | {
      status: "ok";
      active: ChangesetEntry | null;
      /** Every changeset still staged, the active one included. */
      staged: ChangesetEntry[];
      committed: number;
      discarded: number;
      /** Set when base drift could not be checked. */
      driftUnknown?: string;
    };

export async function collectChangesets(ctx: StatusContext): Promise<ChangesetsSection> {
  if (!ctx.projectRoot || !ctx.modelDir) return { status: "no-model" };

  const changesets = await new StagedChangesetStorage(ctx.projectRoot).list();
  const activeId = await readActiveChangesetId(ctx.projectRoot);
  const staged = changesets.filter((changeset) => changeset.status === "staged");

  // One snapshot of the base, compared with each changeset's: the hash drift check
  // StagingAreaManager.detectDrift makes, without re-hashing the model per changeset.
  let current: string | null = null;
  let driftUnknown: string | undefined;
  if (staged.length > 0) {
    try {
      current = await new BaseSnapshotManager().captureSnapshot(await ctx.model());
    } catch (error) {
      driftUnknown = `the model could not be loaded: ${getErrorMessage(error)}`;
    }
  }

  const entry = (changeset: Changeset): ChangesetEntry => ({
    id: changeset.id,
    name: changeset.name,
    changes: countChanges(changeset),
    baseDrifted: current && changeset.baseSnapshot ? changeset.baseSnapshot !== current : null,
  });

  const stagedEntries = staged.map(entry);
  const active = activeId ? changesets.find((changeset) => changeset.id === activeId) : undefined;
  return {
    status: "ok",
    active: active && active.status === "staged" ? stagedEntries.find((e) => e.id === active.id) ?? null : null,
    staged: stagedEntries,
    committed: changesets.filter((changeset) => changeset.status === "committed").length,
    discarded: changesets.filter((changeset) => changeset.status === "discarded").length,
    ...(driftUnknown ? { driftUnknown } : {}),
  };
}

async function readActiveChangesetId(projectRoot: string): Promise<string | null> {
  const activePath = path.join(projectRoot, "documentation-robotics", "changesets", ".active");
  if (!(await fileExists(activePath))) return null;
  return (await readFile(activePath)).trim() || null;
}

function countChanges(changeset: Changeset): ChangesetEntry["changes"] {
  const counts: ChangesetEntry["changes"] = { total: changeset.changes.length };
  for (const change of changeset.changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------
// code index

/**
 * Which analyzer the section describes. `session`: the active one in .dr/analyzers/session.json,
 * the one codebase_index and codebase_verify use. `first-indexed`: none is active, so the first
 * analyzer with an index.
 */
export type AnalyzerSource = "session" | "first-indexed";

export type CodeIndexSection =
  | { status: "absent"; analyzer: string | null; analyzerSource?: AnalyzerSource; reason: string }
  | {
      /** By the rule the codebase tools use (codebase-shared.ts judgeIndex); unknown when git can't say. */
      status: "fresh" | "fresh-with-uncommitted-edits" | "stale" | "unknown";
      analyzer: string;
      analyzerSource: AnalyzerSource;
      indexedAt: string;
      indexedCommit: string;
      headCommit?: string;
      nodes: number;
      edges: number;
      reason?: string;
      /** Source files changed by commits since the indexed commit. */
      changedSinceIndex?: string[];
      /** Source files with uncommitted edits written after the index was taken. */
      uncommittedEdits?: string[];
      note?: string;
    };

/**
 * Reads what `dr analyzer status` reads (.dr/analyzers/), and judges freshness by the rule the
 * codebase tools use: stale when commits since the index changed source files (commits that touch
 * only the model or DR's folders don't count), and fresh-with-uncommitted-edits when uncommitted
 * source edits are newer than the index.
 */
export async function collectCodeIndex(ctx: StatusContext): Promise<CodeIndexSection> {
  const base = ctx.projectRoot ?? ctx.root;
  const session = await readSession(base);
  let analyzer: string | null = session?.active_analyzer ?? null;
  const analyzerSource: AnalyzerSource = analyzer ? "session" : "first-indexed";
  analyzer ??= await firstIndexedAnalyzer(base);
  if (!analyzer) {
    return { status: "absent", analyzer: null, reason: "no code index in .dr/analyzers/" };
  }
  const meta = await readIndexMeta(base, analyzer);
  if (!meta) {
    return {
      status: "absent",
      analyzer,
      analyzerSource,
      reason: `${analyzer}, the active analyzer, has not indexed this codebase`,
    };
  }

  const section = {
    analyzer,
    analyzerSource,
    indexedAt: meta.timestamp,
    indexedCommit: meta.git_head,
    nodes: meta.node_count,
    edges: meta.edge_count,
    ...(analyzerSource === "first-indexed"
      ? { note: `no analyzer is active in .dr/analyzers/session.json; this is ${analyzer}'s index` }
      : {}),
  };
  const codebaseRoot = await codebaseRootOf(ctx);
  if (!(await fileExists(codebaseRoot))) {
    return { status: "unknown", ...section, reason: `the codebase root ${codebaseRoot} does not exist` };
  }
  const head = await ctx.git(["rev-parse", "HEAD"], codebaseRoot);
  if (!head.ok) {
    return {
      status: "unknown",
      ...section,
      reason: head.missing
        ? "git is not installed, and freshness is judged by commit"
        : `${codebaseRoot} has no git HEAD, and freshness is judged by commit`,
    };
  }
  const headCommit = head.stdout.trim();
  const judgement = await judgeIndex(
    { indexedCommit: meta.git_head, indexedAt: meta.timestamp },
    headCommit,
    indexProbe(await real(codebaseRoot), { git: ctx.git })
  );
  return {
    status: judgement.state,
    ...section,
    headCommit,
    ...(judgement.reason ? { reason: judgement.reason } : {}),
    ...(judgement.committedSince.length > 0 ? { changedSinceIndex: judgement.committedSince } : {}),
    ...(judgement.editedSince.length > 0 ? { uncommittedEdits: judgement.editedSince } : {}),
  };
}

/** With no analyzer selected, the first one that has an index. */
async function firstIndexedAnalyzer(base: string): Promise<string | null> {
  let names: string[];
  try {
    const entries = await readdir(path.join(base, ".dr", "analyzers"), { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    if (await fileExists(path.join(base, ".dr", "analyzers", name, "index-meta.json"))) return name;
  }
  return null;
}

/** Where the code lives: the model's codebase root, else the project root. */
async function codebaseRootOf(ctx: StatusContext): Promise<string> {
  const fallback = ctx.projectRoot ?? ctx.root;
  if (!ctx.modelDir) return fallback;
  try {
    return (await ctx.model()).codebaseRoot ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------------------------
// code drift (git only)

/** How many changed source files, and elements per file, the section lists. */
const MAX_FILES = 50;
const MAX_ELEMENTS_PER_FILE = 5;

export interface ChangedSourceFile {
  file: string;
  /** Elements whose source reference names the file (the first few). */
  elements: string[];
  elementCount: number;
}

export type CodeDriftSection =
  | { status: "no-model" }
  | { status: "no-git" | "unknown"; reason: string }
  | {
      /**
       * drift: files the model references changed since the model last did. unlinked: no element
       * has a source reference, so changed code can't be tied to the model.
       */
      status: "drift" | "in-step" | "unlinked";
      /** The last commit that touched documentation-robotics/model/. */
      modelCommit: { sha: string; date: string; subject: string };
      commitsSince: number;
      /** Files changed in those commits, outside documentation-robotics/. */
      filesChangedSince: number;
      /** Of those, the ones the model's elements reference as source files. */
      changedSourceFiles: ChangedSourceFile[];
      /** Referenced source files with uncommitted changes. */
      uncommittedSourceFiles: ChangedSourceFile[];
      /** Whether documentation-robotics/model/ itself has uncommitted changes. */
      modelUncommitted: boolean;
      /** How many distinct source files the model references. */
      referencedFiles: number;
      /** Set when a list was cut to its first entries. */
      truncated?: boolean;
    };

export async function collectCodeDrift(ctx: StatusContext): Promise<CodeDriftSection> {
  if (!ctx.projectRoot || !ctx.modelDir) return { status: "no-model" };
  const projectRoot = await real(ctx.projectRoot);
  const modelDir = await real(ctx.modelDir);

  const repo = await gitTopLevel(ctx.git, projectRoot);
  if ("reason" in repo) return { status: "no-git", reason: repo.reason };

  const modelPathspec = path.relative(repo.top, modelDir) || ".";
  const last = await ctx.git(["log", "-1", "--format=%H%x00%cI%x00%s", "--", modelPathspec], repo.top);
  if (!last.ok) return { status: "unknown", reason: `git log failed: ${last.error}` };
  const [sha, date, subject] = last.stdout.trim().split("\0");
  if (!sha) {
    return { status: "unknown", reason: "documentation-robotics/model/ has never been committed" };
  }

  let model: Model;
  try {
    model = await ctx.model();
  } catch (error) {
    return { status: "unknown", reason: `the model could not be loaded: ${getErrorMessage(error)}` };
  }

  const codebaseRoot = await real(model.codebaseRoot ?? projectRoot);
  const codeRepo = await gitTopLevel(ctx.git, codebaseRoot);
  if ("reason" in codeRepo || codeRepo.top !== repo.top) {
    return {
      status: "unknown",
      reason: `the code (${codebaseRoot}) is not in the model's git repository, so commits since the model changed can't be compared`,
    };
  }

  const [countResult, diffResult, uncommittedResult, modelStatus] = await Promise.all([
    ctx.git(["rev-list", "--count", `${sha}..HEAD`], repo.top),
    // --no-renames: a rename lists both paths, so a reference to the old path still counts.
    ctx.git(["diff", "--name-only", "--no-renames", "-z", sha, "HEAD"], repo.top),
    ctx.git(["diff", "--name-only", "--no-renames", "-z", "HEAD"], repo.top),
    ctx.git(["status", "--porcelain", "--", modelPathspec], repo.top),
  ]);
  if (!countResult.ok) return { status: "unknown", reason: `git rev-list failed: ${countResult.error}` };
  if (!diffResult.ok) return { status: "unknown", reason: `git diff failed: ${diffResult.error}` };
  if (!uncommittedResult.ok) return { status: "unknown", reason: `git diff failed: ${uncommittedResult.error}` };

  // Source references are relative to the codebase root; git names files from the top of the repo.
  const toPosix = (p: string) => p.split(path.sep).join("/");
  const prefix = toPosix(path.relative(repo.top, codebaseRoot));
  const referenced = referencedSourceFiles(model, prefix);
  const drDir = toPosix(path.relative(repo.top, path.join(projectRoot, "documentation-robotics"))) + "/";
  const outsideDr = (file: string) => !file.startsWith(drDir);
  const changed = splitZ(diffResult.stdout).filter(outsideDr);
  const uncommitted = splitZ(uncommittedResult.stdout).filter(outsideDr);

  const matched = matchReferenced(changed, referenced);
  const matchedUncommitted = matchReferenced(uncommitted, referenced);
  const truncated = matched.length > MAX_FILES || matchedUncommitted.length > MAX_FILES;

  return {
    status:
      referenced.size === 0 ? "unlinked" : matched.length + matchedUncommitted.length > 0 ? "drift" : "in-step",
    modelCommit: { sha, date, subject },
    commitsSince: Number.parseInt(countResult.stdout.trim(), 10) || 0,
    filesChangedSince: changed.length,
    changedSourceFiles: matched.slice(0, MAX_FILES),
    uncommittedSourceFiles: matchedUncommitted.slice(0, MAX_FILES),
    modelUncommitted: modelStatus.ok && modelStatus.stdout.trim().length > 0,
    referencedFiles: referenced.size,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Repo-relative source file → the ids of the elements that reference it. */
function referencedSourceFiles(model: Model, prefix: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      for (const location of element.getSourceReference()?.locations ?? []) {
        if (typeof location?.file !== "string") continue;
        const relative = location.file.replace(/\\/g, "/").replace(/^\.\//, "");
        if (!relative) continue;
        const file = prefix ? path.posix.join(prefix, relative) : relative;
        const ids = files.get(file) ?? [];
        if (!ids.includes(element.path)) ids.push(element.path);
        files.set(file, ids);
      }
    }
  }
  return files;
}

function matchReferenced(changed: string[], referenced: Map<string, string[]>): ChangedSourceFile[] {
  const out: ChangedSourceFile[] = [];
  for (const file of changed) {
    const ids = referenced.get(file);
    if (ids) out.push({ file, elements: ids.slice(0, MAX_ELEMENTS_PER_FILE), elementCount: ids.length });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------------------------------------
// viewer

export type ViewerSection =
  | { status: "none" }
  | { status: "running"; url: string; port: number; pid: number; startedAt: string; withChangesets: boolean }
  | { status: "unreachable"; port: number; pid: number; note: string };

/**
 * The viewer `dr visualize` (or review_open) runs for this project, from its record in the user's
 * state directory. The health probe is kept short so the call stays fast.
 */
export async function collectViewer(ctx: StatusContext): Promise<ViewerSection> {
  if (!ctx.projectRoot) return { status: "none" };
  const probe = await probeViewer(ctx.projectRoot, { probeTimeoutMs: 500, retryTimeoutMs: 1000 });
  if (probe.state === "none") return { status: "none" };
  const { record } = probe;
  if (probe.state === "unreachable") {
    return {
      status: "unreachable",
      port: record.port,
      pid: record.pid,
      note: "The viewer's process is alive but it did not answer; it may still be loading.",
    };
  }
  return {
    status: "running",
    url: viewerUrl(record),
    port: record.port,
    pid: record.pid,
    startedAt: record.startedAt,
    withChangesets: record.withChangesets,
  };
}

// ---------------------------------------------------------------------------------------------
// indexing

export type IndexingSection =
  | { status: "none" }
  | {
      status: "running" | "done" | "failed";
      jobId: string;
      phase: string | null;
      startedAt: string;
      finishedAt: string | null;
      error: string | null;
      logPath: string;
    };

/** The last codebase_index run, from `.dr/analyzers/index-job.json`. */
export async function collectIndexing(ctx: StatusContext): Promise<IndexingSection> {
  if (!ctx.projectRoot) return { status: "none" };
  const job = await readIndexJob(ctx.projectRoot);
  if (!job) return { status: "none" };
  return {
    status: job.state,
    jobId: job.jobId,
    phase: job.progress?.phase ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    logPath: job.logPath,
  };
}
