/**
 * The collectors behind project_status. Each one reports one section from local files and git,
 * independently of the others: a collector that fails reports its own error and the rest still
 * answer. A new section (the running viewer, indexing progress) is one more collector.
 *
 * Nothing here touches the network or starts the code analyzer.
 */

import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "../../core/model.js";
import type { Changeset } from "../../core/changeset.js";
import { driftDetail, type DriftDetail } from "../../core/changeset-drift-status.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { MigrationRegistry } from "../../core/migration-registry.js";
import { StagedChangesetStorage } from "../../core/staged-changeset-storage.js";
import { readIndexMeta, readSession } from "../../analyzers/session-state.js";
import { getCliBundledSpecVersion, getCliVersion, getModelSpecVersion } from "../../utils/spec-version.js";
import { fileExists, readFile } from "../../utils/file-io.js";
import { readActiveMarker } from "../../core/active-changeset-marker.js";
import { probeViewer, viewerUrl } from "../../server/viewer-registry.js";
import { readIndexJob } from "../../analyzers/index-job.js";
import { installedAnalyzerVersion } from "../../analyzers/active-analyzer.js";
import { getErrorMessage } from "../../utils/errors.js";
import { indexProbe, isIndexedSource, judgeIndex, readWorktreeSnapshot, type GitRunner } from "./codebase-shared.js";
import { isExtractionChangeset } from "./codebase-extract.js";
import { parse as parseYaml } from "yaml";
import { extractionOrigin, readReconciledStamp } from "../../core/reconciliation.js";
import { allowedActions, purposeOf, type ChangesetAction, type ChangesetPurpose } from "../../core/changeset-purpose.js";
import type { ReconciledStamp } from "../../types/index.js";
import { tier1Brief, type Tier1Brief, type Tier1StatusOptions } from "../../analyzers/classifier/status.js";

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
  /** The installed analyzer's version, or null (defaults to the binary's `--version`). */
  analyzerVersion?: (analyzer: string) => Promise<string | null>;
  /** How Tier 1's state is read (default `process.env` and git); tests pass their own environment. */
  tier1?: Tier1StatusOptions;
  /** The CLI on disk where this process was loaded from (default: its package.json, read now). */
  installedCli?: () => Promise<InstalledCli | null>;
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
    // "Ahead" has two causes with different fixes: the CLI on disk is too old (update it), or it is
    // new enough and this server process predates its upgrade (restart the server).
    const stale = staleServer(await collectServer(ctx).catch(() => null));
    const restart = stale?.installed.spec && compareVersions(stale.installed.spec, modelVersion) >= 0;
    return {
      status: "ahead",
      model: modelVersion,
      cli,
      upgradeNeeded: false,
      reason: restart
        ? `the model is on spec ${modelVersion}, newer than the ${cli} this dr server is running, but the dr CLI installed ` +
          `now (${stale.installed.version}) carries ${stale.installed.spec}: restart the session's dr server; the CLI needs no update`
        : `the model is on spec ${modelVersion}, newer than this CLI's ${cli}; update the dr CLI, then restart the session's dr server`,
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
// the dr server answering this call

/** The CLI found on disk: its version, the spec version it bundles (null when that can't be read) and when its files last changed. */
export interface InstalledCli {
  version: string;
  spec: string | null;
  /** When the installed files were last written (ms since the epoch); undefined when that can't be read. */
  modifiedAt?: number;
}

export type ServerSection =
  | {
      /** The process answering is the CLI that is installed. */
      status: "current";
      version: string;
    }
  | {
      /**
       * The CLI on disk changed after this server process started (another version, or the same
       * version installed or built again), so the session is still talking to the old code. Fixed
       * by restarting the session's dr server, not by updating the CLI.
       */
      status: "stale";
      version: string;
      installed: { version: string; spec: string | null };
      /** When the installed files changed, when that is what gave it away. */
      changedAt?: string;
      /** What happened and what to do, in a sentence: shown as it is. */
      note: string;
    }
  | { status: "unknown"; version: string; reason: string };

/** How a session gets the installed CLI's server: nothing the agent can call. */
export const RESTART_SERVER = "Restart the session's dr server (reconnect the dr MCP server, or restart the session)";

/** This module's file, and the package it was loaded from: `<package>/{src,dist}/mcp/tools/` → `<package>`. */
const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..", "..", "..");

/** A file's modification time in ms, or undefined when it can't be read. */
async function modifiedAt(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The CLI installed where this process was loaded from, read from disk now. A long-lived `dr mcp`
 * process keeps the code it started with, so after an upgrade in place this differs from
 * getCliVersion(), and after any install or build its files are newer than the process. Null when
 * the package can't be read (its folder was removed or moved).
 */
export async function readInstalledCli(packageRoot: string = PACKAGE_ROOT): Promise<InstalledCli | null> {
  let version: unknown;
  try {
    version = (JSON.parse(await readFile(path.join(packageRoot, "package.json"))) as { version?: unknown }).version;
  } catch {
    return null;
  }
  if (typeof version !== "string" || !version) return null;
  let spec: string | null = null;
  for (const dir of ["dist", "src"]) {
    try {
      const manifest = JSON.parse(await readFile(path.join(packageRoot, dir, "schemas", "bundled", "manifest.json"))) as {
        specVersion?: unknown;
      };
      if (typeof manifest.specVersion === "string" && manifest.specVersion) {
        spec = manifest.specVersion;
        break;
      }
    } catch {
      // Not built there; try the next.
    }
  }
  // An install rewrites package.json; a build rewrites this module's file.
  const times = (
    await Promise.all([modifiedAt(path.join(packageRoot, "package.json")), modifiedAt(path.join(packageRoot, path.relative(PACKAGE_ROOT, THIS_FILE)))])
  ).filter((time): time is number => time !== undefined);
  return { version, spec, ...(times.length > 0 ? { modifiedAt: Math.max(...times) } : {}) };
}

/** Files written this long after the process started are a new install, not this process's own start-up. */
const STARTUP_MARGIN_MS = 5_000;

/**
 * Whether this server process is the CLI that is installed. Two signs that it is not: the version
 * on disk where it was loaded from differs from the one it was built with, or the installed files
 * were written after it started (the same version installed or built again). Either way a `dr mcp`
 * process started before the change answers with the old code, and the old bundled spec, until it
 * is restarted.
 */
export async function collectServer(ctx: StatusContext): Promise<ServerSection> {
  const version = getCliVersion();
  const installed = await (ctx.installedCli ?? readInstalledCli)();
  if (!installed) {
    return { status: "unknown", version, reason: `the CLI's package.json could not be read under ${PACKAGE_ROOT}` };
  }
  const found = { version: installed.version, spec: installed.spec };
  if (installed.version !== version) {
    return {
      status: "stale",
      version,
      installed: found,
      note:
        `This dr server process is CLI ${version}, and ${installed.version} is installed now: it started before the CLI ` +
        `changed and still runs the old code. ${RESTART_SERVER} to use the installed one.`,
    };
  }
  const startedAt = Date.now() - process.uptime() * 1000;
  if (installed.modifiedAt !== undefined && installed.modifiedAt > startedAt + STARTUP_MARGIN_MS) {
    const changedAt = new Date(installed.modifiedAt).toISOString();
    return {
      status: "stale",
      version,
      installed: found,
      changedAt,
      note:
        `The dr CLI's files on disk changed at ${changedAt}, after this dr server process started (the version is still ` +
        `${version}): the process runs the code it started with. ${RESTART_SERVER} to use what is installed.`,
    };
  }
  return { status: "current", version };
}

/** The section when it says the server is stale, else undefined. */
export function staleServer(section: ServerSection | ErrorSection | null | undefined): Extract<ServerSection, { status: "stale" }> | undefined {
  return section?.status === "stale" ? section : undefined;
}

// ---------------------------------------------------------------------------------------------
// changesets

/**
 * How the base model moved under a staged changeset, and what that does to landing it. The state
 * and whether it blocks are changeset-drift-status.ts's answer, the one a commit acts on; nothing
 * is decided here. Absent from an entry whose base is as it was (`none`) and from a record, which
 * never lands (`not-applicable`).
 */
export interface ChangesetDriftEntry {
  /**
   * content-free: the base changed, but nothing this changeset stages against. drifted: the base
   * overlaps a staged change, or there is no base index to tell. unknown: it could not be checked.
   */
  state: "content-free" | "drifted" | "unknown";
  /**
   * What a landing does about it. refused-without-force: changeset_commit refuses unless the user
   * agrees to force: true, and the viewer's Apply, which has no force, refuses.
   */
  landing: "allowed" | "allowed-with-warning" | "refused-without-force";
  /** Set when the changeset has no usable record of the base it was staged against: what changed can't be named. */
  baseIndex?: "not-recorded" | "unreadable";
  /** How many base elements and relationships changed since the changeset was created. Zero counts are left out. */
  baseChanges?: Partial<Record<BaseChangeCount, number>>;
  /** For `drifted`: how many of the changeset's own staged changes the base now overlaps, and the first few. */
  overlapping?: { elements: number; relationships: number; first: string[] };
  /** Why it could not be told (state unknown, or drifted with no base index). */
  reason?: string;
  /** For `drifted`: the call that lists what moved and what overlaps. */
  next?: { tool: "changeset_brief"; args: { changeset: string; sections: ["drift"] } };
}

export type BaseChangeCount = "elementsAdded" | "elementsRemoved" | "elementsChanged" | "relationshipsAdded" | "relationshipsRemoved";

/** How many overlapping changes an entry names; changeset_brief with sections: ["drift"] lists them all. */
const MAX_OVERLAPS_NAMED = 3;

/** The entry's `drift` from the core's detail, or undefined when there is nothing to say. */
function driftEntry(changesetId: string, detail: DriftDetail): ChangesetDriftEntry | undefined {
  if (detail.state === "none" || detail.state === "not-applicable") return undefined;
  if (detail.state === "unknown") return { state: "unknown", landing: "allowed", reason: detail.message };
  const counts = detail.baseChanges?.counts;
  const baseChanges = counts
    ? (Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) as Partial<Record<BaseChangeCount, number>>)
    : undefined;
  const common = {
    ...(detail.baseIndex && detail.baseIndex !== "recorded" ? { baseIndex: detail.baseIndex } : {}),
    ...(baseChanges ? { baseChanges } : {}),
  };
  if (detail.state === "content-free") return { state: "content-free", landing: "allowed", ...common };

  const elements = detail.overlapping?.elements ?? [];
  const relationships = detail.overlapping?.relationships ?? [];
  const first = [
    ...elements.map((e) => `${e.id} (${e.reason})`),
    ...relationships.map((r) => `${r.source} ${r.predicate} ${r.target} (${r.reason})`),
  ].slice(0, MAX_OVERLAPS_NAMED);
  return {
    state: "drifted",
    // The core's answer, so a rule that stops refusing on drift (#1200) is reported as it lands.
    landing: detail.blocksCommit ? "refused-without-force" : "allowed-with-warning",
    ...common,
    ...(detail.overlapping ? { overlapping: { elements: elements.length, relationships: relationships.length, first } } : {}),
    // Only what could not be told: with a base index and overlaps named, the counts say it.
    ...(detail.warnings?.length ? { reason: detail.warnings.join(" ") } : {}),
    next: { tool: "changeset_brief", args: { changeset: changesetId, sections: ["drift"] } },
  };
}

export interface ChangesetEntry {
  id: string;
  name: string;
  /** Staged changes by operation; `total` counts them all. */
  changes: Record<string, number> & { total: number };
  /**
   * Whether the base model changed under what the changeset stages since it was created (drift
   * state `drifted`); null when that can't be told. `drift` says what moved and what a landing does.
   */
  baseDrifted: boolean | null;
  /** Set when the base's hash changed since the changeset was created, or drift could not be checked. */
  drift?: ChangesetDriftEntry;
  /** What it is for (changeset-purpose.ts): declared, or inferred for an older changeset. */
  purpose: ChangesetPurpose;
  /** For a verification record: the id of the plan it verifies. */
  verifies?: string;
  /** The moves its state allows: a verification record is discarded or kept, never committed. */
  actions: ChangesetAction[];
  /**
   * Set when codebase_extract staged it: the as-built side of a verify (or a keep-as-built
   * catch-up), not a plan.
   */
  asBuilt?: true;
  /** For an as-built changeset, the changeset that was active when extraction started it. */
  previousActive?: { id: string; name: string };
}

export type ChangesetsSection =
  | { status: "no-model" }
  | {
      status: "ok";
      active: ChangesetEntry | null;
      /** How many changesets are staged, the active one included; `staged` lists the first. */
      stagedTotal: number;
      /** The changesets still staged, the active one included. */
      staged: ChangesetEntry[];
      /** Set when `staged` shows only its first entries: what is shown, of how many, and the call for the rest. */
      more?: string[];
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

  // Drift is read through changeset-drift-status.ts, the answer a commit acts on, against the base
  // model as loaded: one manager for the call.
  let base: { model: Model; manager: StagingAreaManager } | undefined;
  let driftUnknown: string | undefined;
  if (staged.length > 0) {
    try {
      const model = await ctx.model();
      base = { model, manager: new StagingAreaManager(model.rootPath, model) };
    } catch (error) {
      driftUnknown = `the model could not be loaded: ${getErrorMessage(error)}`;
    }
  }

  const projectRoot = ctx.projectRoot;
  const entry = async (changeset: Changeset): Promise<ChangesetEntry> => {
    const { purpose, verifies } = await purposeOf(projectRoot, changeset);
    const asBuilt =
      purpose === "bootstrap" ||
      purpose === "reconcile" ||
      purpose === "verification" ||
      EXTRACTION_MARKER.test(changeset.description ?? "") ||
      (await isExtractionChangeset(projectRoot, changeset.id, changeset.name).catch(() => false));
    const previousActive = asBuilt ? await extractionPreviousActive(projectRoot, changeset.id) : undefined;
    let baseDrifted: boolean | null = null;
    let drift: ChangesetDriftEntry | undefined;
    if (base) {
      const plan = verifies ? changesets.find((other) => other.id === verifies) : undefined;
      const detail = await driftDetail(base.model, base.manager, {
        changeset,
        purpose,
        ...(plan ? { plan: { name: plan.name, status: plan.status } } : {}),
      });
      baseDrifted = detail.state === "unknown" ? null : detail.state === "drifted";
      drift = driftEntry(changeset.id, detail);
    }
    return {
      id: changeset.id,
      name: changeset.name,
      changes: countChanges(changeset),
      baseDrifted,
      ...(drift ? { drift } : {}),
      purpose,
      ...(verifies ? { verifies } : {}),
      actions: allowedActions(purpose, changeset.status),
      ...(asBuilt ? { asBuilt: true as const } : {}),
      ...(previousActive ? { previousActive } : {}),
    };
  };

  const stagedEntries = await Promise.all(staged.map(entry));
  const active = activeId ? changesets.find((changeset) => changeset.id === activeId) : undefined;
  return {
    status: "ok",
    active: active && active.status === "staged" ? stagedEntries.find((e) => e.id === active.id) ?? null : null,
    stagedTotal: stagedEntries.length,
    staged: stagedEntries,
    committed: changesets.filter((changeset) => changeset.status === "committed").length,
    discarded: changesets.filter((changeset) => changeset.status === "discarded").length,
    ...(driftUnknown ? { driftUnknown } : {}),
  };
}

/** The description codebase_extract gives the changesets it creates. */
const EXTRACTION_MARKER = /Staged by codebase_extract/;

/**
 * The changeset that was active when codebase_extract started this one, from the extraction
 * record (.dr/analyzers/extract/<id>.json, `previousActive`); undefined when it has none.
 */
async function extractionPreviousActive(
  projectRoot: string,
  changesetId: string
): Promise<{ id: string; name: string } | undefined> {
  const record = path.join(projectRoot, ".dr", "analyzers", "extract", `${changesetId.replace(/[^\w.-]/g, "_")}.json`);
  try {
    const stored = JSON.parse(await readFile(record)) as { previousActive?: { id?: unknown; name?: unknown } | null };
    const previous = stored.previousActive;
    if (previous && typeof previous.id === "string") {
      return { id: previous.id, name: typeof previous.name === "string" ? previous.name : previous.id };
    }
  } catch {
    // No record, or one that can't be read: nothing to go on.
  }
  return undefined;
}

async function readActiveChangesetId(projectRoot: string): Promise<string | null> {
  return readActiveMarker(projectRoot);
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
      /** How many there are; `changedSinceIndex` lists the first. */
      changedSinceIndexCount?: number;
      /** Source files with uncommitted edits written after the index was taken. */
      uncommittedEdits?: string[];
      /** How many there are; `uncommittedEdits` lists the first. */
      uncommittedEditsCount?: number;
      /** One line per shortened list: what is shown, of how many, and the call that returns the rest. */
      more?: string[];
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
    ...(meta.analyzer_version ? { analyzerVersion: meta.analyzer_version } : {}),
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
  const installedVersion = meta.analyzer_version ? await (ctx.analyzerVersion ?? installedAnalyzerVersion)(analyzer) : null;
  const judgement = await judgeIndex(
    { indexedCommit: meta.git_head, indexedAt: meta.timestamp, analyzerVersion: meta.analyzer_version },
    headCommit,
    indexProbe(await real(codebaseRoot), { git: ctx.git, snapshot: await readWorktreeSnapshot(base, analyzer, meta.timestamp) }),
    installedVersion
  );
  return {
    status: judgement.state,
    ...section,
    headCommit,
    ...(judgement.reason ? { reason: judgement.reason } : {}),
    ...(judgement.committedSince.length > 0
      ? { changedSinceIndex: judgement.committedSince, changedSinceIndexCount: judgement.committedSince.length }
      : {}),
    ...(judgement.editedSince.length > 0
      ? { uncommittedEdits: judgement.editedSince, uncommittedEditsCount: judgement.editedSince.length }
      : {}),
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

/**
 * How many entries of each list project_status shows by default. The call opens every session, so
 * its lists start short. Each number is a default, not a cut-off: the collectors return every
 * list whole, `shortenSections` cuts them for the default answer and says so (the true count
 * beside the list, and a `more` line naming the call for the rest), and `list` pages any of them
 * in full. Verdicts and counts are always computed over the whole lists.
 */
export const LIST_DEFAULTS = {
  stagedChangesets: 20,
  changedSourceFiles: 15,
  uncommittedSourceFiles: 15,
  /** Element ids per changed file; `elementCount` is the whole count. */
  elementsPerFile: 3,
  unreferencedFiles: 5,
  landedSince: 5,
  changedSinceIndex: 15,
  uncommittedEdits: 15,
} as const;

/** The lists `project_status` pages with `list`, `limit` and `offset`. */
export const STATUS_LISTS = [
  "stagedChangesets",
  "changedSourceFiles",
  "uncommittedSourceFiles",
  "unreferencedFiles",
  "landedSince",
  "changedSinceIndex",
  "uncommittedEdits",
] as const;
export type StatusList = (typeof STATUS_LISTS)[number];

export interface ChangedSourceFile {
  file: string;
  /** Elements whose source reference names the file (the first few). */
  elements: string[];
  elementCount: number;
}

/**
 * Changed files this check cannot judge: no element's source reference names them, so they can
 * never show in `changedSourceFiles`, whatever changed in them.
 */
export interface UnreferencedChanges {
  /** Every changed file outside documentation-robotics/ that no element references. */
  files: number;
  /** Of those, source files the code analyzer reads (not docs, config, vendored or built code). */
  sourceFiles: number;
  /** Of those source files, the ones added since the baseline: code no extraction has read. */
  newSourceFiles: number;
  /** The first few source files, new ones first. Absent when none is a source file. */
  first?: string[];
  /**
   * Every unreferenced file: new source files first, then the other source files, then the rest.
   * Only on the collector's own answer and in the `unreferencedFiles` list; the default answer
   * keeps `first`.
   */
  all?: UnreferencedFile[];
}

export interface UnreferencedFile {
  file: string;
  /** A source file the code analyzer reads. */
  source: boolean;
  /** Added since the baseline. */
  added: boolean;
}

export type CodeDriftSection =
  | { status: "no-model" }
  | { status: "no-git" | "unknown"; reason: string }
  | {
      /**
       * drift: files the model references changed since `countedFrom`. in-step: none did (files
       * no element references may still have changed: `unreferenced`). unlinked: no element has a
       * source reference, so changed code can't be tied to the model.
       */
      status: "drift" | "in-step" | "unlinked";
      /**
       * The commit that brought the model to its reconciled state. Only an as-built landing
       * reconciles the model with the code: the commit that brought in the manifest's `reconciled`
       * stamp, which landing a bootstrap or reconcile changeset from codebase_extract writes. A
       * landed plan, a hand edit or a spec migration doesn't. A model with no stamp falls back to
       * the last commit to documentation-robotics/model/ that isn't a spec migration (one whose
       * manifest.yaml diff changes `spec_version`).
       */
      modelCommit: CommitInfo;
      /**
       * The commit drift is counted from, and the `since` for codebase_extract. With an as-built
       * landing it is the code commit that landing's extraction read (`reconciledBy.codeCommit`),
       * which is older than `modelCommit` when code merged between the extraction and the model's
       * commit (#1195); `modelCommit` when the stamp names no code commit or the repository
       * doesn't have it.
       */
      countedFrom: CommitInfo;
      /**
       * Which rule chose `modelCommit`: last-reconciling-commit (the last as-built landing),
       * else, for a model with no stamp, last-non-migration-commit, or last-model-commit when every
       * recent model commit is a migration or the migrations couldn't be told apart (`note` says).
       */
      basis: "last-reconciling-commit" | "last-non-migration-commit" | "last-model-commit";
      /** The rule in a sentence: where drift is counted from, why, and what moves that baseline. */
      rule: string;
      /** With basis last-reconciling-commit: the as-built landing, from the manifest's stamp. */
      reconciledBy?: { changeset: string; changesetId: string; landedAt: string; codeCommit?: string };
      /**
       * With basis last-reconciling-commit: how many changesets landed after that as-built landing,
       * and their names, latest first. None of them moved the baseline (one that had would be `reconciledBy`).
       */
      landedSince?: { count: number; changesets: string[] };
      /**
       * An as-built landing in the working tree that isn't committed yet (the manifest's stamp
       * differs from HEAD's): drift counts from it once documentation-robotics/ is committed.
       */
      uncommittedReconciliation?: { changeset: string; changesetId: string; landedAt: string };
      /** The last commit that touched documentation-robotics/model/, when newer than `modelCommit`. */
      lastModelCommit?: CommitInfo;
      note?: string;
      /** Commits since `countedFrom` that changed files outside documentation-robotics/. */
      commitsSince: number;
      /** Files changed since `countedFrom`, outside documentation-robotics/. */
      filesChangedSince: number;
      /** How many of those the model's elements reference as source files; `changedSourceFiles` lists the first. */
      referencedFilesChanged: number;
      /** Referenced source files that changed, with the elements that reference each. */
      changedSourceFiles: ChangedSourceFile[];
      /** The rest: changed files no element references. Absent when there are none. */
      unreferenced?: UnreferencedChanges;
      /** How many referenced source files have uncommitted changes; `uncommittedSourceFiles` lists the first. */
      referencedFilesUncommitted: number;
      /** Referenced source files with uncommitted changes. */
      uncommittedSourceFiles: ChangedSourceFile[];
      /** Whether documentation-robotics/model/ itself has uncommitted changes. */
      modelUncommitted: boolean;
      /** How many distinct source files the model references. */
      referencedFiles: number;
      /** Set when a list here shows only its first entries; `more` names the call for the rest of each. */
      truncated?: boolean;
      /** One line per shortened list: what is shown, of how many, and the call that returns the rest. */
      more?: string[];
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
  const lastModelCommit = parseCommitLine(last.stdout.trim());
  if (!lastModelCommit) {
    return { status: "unknown", reason: "documentation-robotics/model/ has never been committed" };
  }
  let model: Model;
  try {
    model = await ctx.model();
  } catch (error) {
    return { status: "unknown", reason: `the model could not be loaded: ${getErrorMessage(error)}` };
  }

  // The baseline: the commit that brought in the last as-built landing (the manifest's
  // `reconciled` stamp at HEAD). Only that reconciles the model with the code; a landed plan or a
  // hand edit doesn't. A model with no stamp falls back to the earlier rule.
  let reconciling: Awaited<ReturnType<typeof lastReconcilingCommit>>;
  try {
    reconciling = await lastReconcilingCommit(ctx.git, repo.top, modelPathspec);
  } catch (error) {
    reconciling = { stamp: null, error: getErrorMessage(error) };
  }
  const reconcilingCommit = "commit" in reconciling ? reconciling.commit : null;
  const headStamp = "stamp" in reconciling ? reconciling.stamp : null;
  // The working tree's stamp, when an as-built landing isn't committed yet.
  const worktreeStamp = model.manifest.reconciled;
  // Not when HEAD's stamp couldn't be read: the working tree's would then look uncommitted when it isn't.
  const uncommittedReconciliation =
    !("error" in reconciling) && worktreeStamp && worktreeStamp.changeset_id !== headStamp?.changeset_id
      ? { changeset: worktreeStamp.changeset, changesetId: worktreeStamp.changeset_id, landedAt: worktreeStamp.landed_at }
      : undefined;
  const uncommittedNote = uncommittedReconciliation
    ? `The as-built landing "${uncommittedReconciliation.changeset}" isn't committed yet: commit documentation-robotics/ and drift is counted from that commit.`
    : undefined;

  let baseline: CommitInfo;
  let basis: "last-reconciling-commit" | "last-non-migration-commit" | "last-model-commit";
  let baselineNote: string | undefined;
  if (reconcilingCommit && headStamp) {
    // What later model commits are (landed plans, by name) is in `landedSince` and `lastModelCommit`.
    baseline = reconcilingCommit;
    basis = "last-reconciling-commit";
  } else {
    // No as-built landing recorded (an older model, or one that grew plan by plan): the last
    // model commit that isn't a spec migration. A failure here falls back to the last model commit
    // and says so, rather than blanking the section.
    let found: Awaited<ReturnType<typeof lastNonMigrationCommit>>;
    try {
      found = await lastNonMigrationCommit(ctx.git, repo.top, modelPathspec);
    } catch (error) {
      found = { error: getErrorMessage(error) };
    }
    baseline = "error" in found ? lastModelCommit : (found.commit ?? lastModelCommit);
    basis = "error" in found || !found.commit ? "last-model-commit" : "last-non-migration-commit";
    const stampLost =
      headStamp && "error" in reconciling
        ? `The manifest records the as-built landing "${headStamp.changeset}", but its commit could not be found (${reconciling.error}), so the earlier rule applies. `
        : headStamp
          ? `The manifest records the as-built landing "${headStamp.changeset}", but no commit in this history brought it in (a shallow clone?), so the earlier rule applies. `
          : "";
    baselineNote =
      "error" in found
        ? `${stampLost}Could not tell spec-migration commits apart (${found.error}), so drift is counted from the last model commit, which may be a migration.`
        : !found.commit
          ? `${stampLost}The last ${found.skipped.length} model commits are all spec migrations, so drift is counted from the last model commit.`
          : lastModelCommit.sha !== baseline.sha
            ? `${stampLost}Later model commits (the last: ${lastModelCommit.sha.slice(0, 7)} "${lastModelCommit.subject}") migrated the ` +
              "model to a new spec version, which doesn't check it against the code; drift is counted from the last commit before them. " +
              "Any other model edits made in those commits don't reset drift either."
            : stampLost
              ? stampLost.trim()
              : undefined;
  }
  // Extracted elements but no stamp, and no landed plan to explain them: the bootstrap was modelled
  // by hand, or landed before landings were stamped. Say so, or the earlier rule applies silently.
  // Not when HEAD's stamp couldn't be read: the project may well have one.
  const unstampedNote =
    !("error" in reconciling) && !headStamp && !uncommittedReconciliation
      ? await unexplainedExtractionNote(projectRoot, model)
      : undefined;
  if (unstampedNote) baselineNote = baselineNote ? `${baselineNote} ${unstampedNote}` : unstampedNote;
  if (uncommittedNote) baselineNote = baselineNote ? `${baselineNote} ${uncommittedNote}` : uncommittedNote;
  const { sha, date, subject } = baseline;

  const codebaseRoot = await real(model.codebaseRoot ?? projectRoot);
  const codeRepo = await gitTopLevel(ctx.git, codebaseRoot);
  if ("reason" in codeRepo || codeRepo.top !== repo.top) {
    return {
      status: "unknown",
      reason: `the code (${codebaseRoot}) is not in the model's git repository, so commits since the model changed can't be compared`,
    };
  }

  // Where drift is counted from. An as-built landing describes the code its extraction read, and
  // the model is committed later: after a review, on a branch that is then rebased or merged. Code
  // that merged in between is in the model's commit but not in the model (#1195), so the count
  // starts at the extraction's commit when the repository has it. The trees are compared, so it
  // need not be an ancestor of HEAD (a squash merge or a rebase leaves it off the branch).
  const reconciled = basis === "last-reconciling-commit" ? headStamp : null;
  const short = (commit: string) => commit.slice(0, 7);
  let countedFrom: CommitInfo = baseline;
  let rule: string;
  if (reconciled) {
    const moves =
      "Only landing a bootstrap or reconcile changeset (one codebase_extract makes) moves it; a landed plan does not, verified or not.";
    const code = reconciled.code_commit;
    // A manifest value goes to git as a revision only when it looks like a commit id.
    const codeCommit =
      code && COMMIT_ID.test(code)
        ? parseCommitLine((await ctx.git(["log", "-1", "--format=%H%x00%cI%x00%s", `${code}^{commit}`], repo.top).then((r) => (r.ok ? r.stdout.trim() : ""))))
        : null;
    if (codeCommit) {
      countedFrom = codeCommit;
      rule =
        `Counted from ${short(codeCommit.sha)}, the code the as-built landing "${reconciled.changeset}" read` +
        `${codeCommit.sha !== sha ? ` (the model was committed later, in ${short(sha)})` : ""}. ${moves}`;
    } else {
      const why = code
        ? `: the code commit it read (${short(code)}) is not in this repository, so code that merged between the two is not counted`
        : " (it recorded no code commit)";
      rule = `Counted from ${short(sha)}, the commit that brought in the as-built landing "${reconciled.changeset}"${why}. ${moves}`;
    }
  } else if (basis === "last-non-migration-commit") {
    rule =
      `No as-built landing is recorded, so drift is counted from the last model commit that is not a spec migration (${short(sha)}). ` +
      "Any commit to the model moves it, though none of them checks the model against the code; landing a bootstrap or " +
      "reconcile changeset (one codebase_extract makes) records a baseline that only such a landing moves.";
  } else {
    rule =
      `No as-built landing is recorded, so drift is counted from the last model commit (${short(sha)}), which may be a spec ` +
      "migration (note says why). Any commit to the model moves it.";
  }
  const from = countedFrom.sha;

  // Source references are relative to the codebase root; git names files from the top of the repo.
  const toPosix = (p: string) => p.split(path.sep).join("/");
  const prefix = toPosix(path.relative(repo.top, codebaseRoot));
  const drDir = toPosix(path.relative(repo.top, path.join(projectRoot, "documentation-robotics")));

  const [countResult, diffResult, uncommittedResult, modelStatus] = await Promise.all([
    // Commits that changed code: one that only lands or edits the model is not code drift.
    ctx.git(["rev-list", "--count", `${from}..HEAD`, "--", ".", `:(exclude)${drDir}`], repo.top),
    // --no-renames: a rename lists both paths, so a reference to the old path still counts.
    ctx.git(["diff", "--name-status", "--no-renames", "-z", from, "HEAD"], repo.top),
    ctx.git(["diff", "--name-only", "--no-renames", "-z", "HEAD"], repo.top),
    ctx.git(["status", "--porcelain", "--", modelPathspec], repo.top),
  ]);
  if (!countResult.ok) return { status: "unknown", reason: `git rev-list failed: ${countResult.error}` };
  if (!diffResult.ok) return { status: "unknown", reason: `git diff failed: ${diffResult.error}` };
  if (!uncommittedResult.ok) return { status: "unknown", reason: `git diff failed: ${uncommittedResult.error}` };

  const referenced = referencedSourceFiles(model, prefix);
  const outsideDr = (file: string) => !file.startsWith(`${drDir}/`);
  const changedEntries = parseNameStatus(diffResult.stdout).filter((entry) => outsideDr(entry.file));
  const changed = changedEntries.map((entry) => entry.file);
  const uncommitted = splitZ(uncommittedResult.stdout).filter(outsideDr);

  const matched = matchReferenced(changed, referenced);
  const matchedUncommitted = matchReferenced(uncommitted, referenced);
  const unreferenced = unreferencedChanges(changedEntries, referenced, prefix);
  const landedSince = reconciled ? landedSinceReconciliation(model, reconciled, uncommittedReconciliation) : undefined;

  return {
    status:
      referenced.size === 0 ? "unlinked" : matched.length + matchedUncommitted.length > 0 ? "drift" : "in-step",
    modelCommit: { sha, date, subject },
    countedFrom,
    basis,
    rule,
    ...(reconciled
      ? {
          reconciledBy: {
            changeset: reconciled.changeset,
            changesetId: reconciled.changeset_id,
            landedAt: reconciled.landed_at,
            ...(reconciled.code_commit ? { codeCommit: reconciled.code_commit } : {}),
          },
        }
      : {}),
    ...(landedSince ? { landedSince } : {}),
    ...(uncommittedReconciliation ? { uncommittedReconciliation } : {}),
    ...(lastModelCommit.sha !== sha ? { lastModelCommit } : {}),
    ...(baselineNote ? { note: baselineNote } : {}),
    commitsSince: Number.parseInt(countResult.stdout.trim(), 10) || 0,
    filesChangedSince: changed.length,
    referencedFilesChanged: matched.length,
    changedSourceFiles: matched,
    ...(unreferenced ? { unreferenced } : {}),
    referencedFilesUncommitted: matchedUncommitted.length,
    uncommittedSourceFiles: matchedUncommitted,
    modelUncommitted: modelStatus.ok && modelStatus.stdout.trim().length > 0,
    referencedFiles: referenced.size,
  };
}

/** A full or abbreviated commit id, and nothing git could read as an option or a range. */
const COMMIT_ID = /^[0-9a-f]{7,64}$/i;

/** `git diff --name-status -z` output (`M\0path\0A\0path\0`) as entries; `added` for a new file. */
function parseNameStatus(stdout: string): Array<{ file: string; added: boolean }> {
  const parts = splitZ(stdout);
  const entries: Array<{ file: string; added: boolean }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) entries.push({ file: parts[i + 1], added: parts[i].startsWith("A") });
  return entries;
}

/**
 * The changed files no element references, counted: the check ties code to the model through
 * source references only, so these can't show as drift. Undefined when every changed file is
 * referenced.
 */
function unreferencedChanges(
  changed: Array<{ file: string; added: boolean }>,
  referenced: Map<string, string[]>,
  prefix: string
): UnreferencedChanges | undefined {
  const rest = changed.filter((entry) => !referenced.has(entry.file));
  if (rest.length === 0) return undefined;
  // isIndexedSource reads a path from the codebase root; a file outside it is not the model's code.
  const source = rest.filter((entry) => {
    if (!prefix) return isIndexedSource(entry.file);
    return entry.file.startsWith(`${prefix}/`) && isIndexedSource(entry.file.slice(prefix.length + 1));
  });
  const sourceFiles = new Set(source.map((entry) => entry.file));
  const added = source.filter((entry) => entry.added);
  const all: UnreferencedFile[] = [
    ...added,
    ...source.filter((entry) => !entry.added),
    ...rest.filter((entry) => !sourceFiles.has(entry.file)),
  ].map((entry) => ({ file: entry.file, source: sourceFiles.has(entry.file), added: entry.added }));
  return { files: rest.length, sourceFiles: source.length, newSourceFiles: added.length, all };
}

/**
 * The changesets landed after the as-built landing the manifest's stamp names, from the manifest's
 * history (the working tree's, so a landing not committed yet is counted). None of them moved the
 * baseline: a later bootstrap or reconcile landing would have replaced the stamp. Undefined when
 * nothing landed since.
 */
function landedSinceReconciliation(
  model: Model,
  stamp: ReconciledStamp,
  uncommitted: { changeset: string } | undefined
): { count: number; changesets: string[] } | undefined {
  const since = Date.parse(stamp.landed_at);
  if (Number.isNaN(since)) return undefined;
  const names = (model.manifest.changeset_history ?? [])
    .filter((entry) => entry.action === "committed" && Date.parse(entry.committed_at) > since)
    // Not the as-built landing itself, should its history entry be a moment later than its stamp.
    .filter((entry) => !(entry.name === stamp.changeset && Date.parse(entry.committed_at) - since < 60_000))
    // A later as-built landing waiting to be committed is reported as uncommittedReconciliation.
    .filter((entry) => entry.name !== uncommitted?.changeset)
    .map((entry) => entry.name);
  if (names.length === 0) return undefined;
  // Latest first: the ones the reader just landed.
  return { count: names.length, changesets: names.reverse() };
}

export interface CommitInfo {
  sha: string;
  date: string;
  subject: string;
}

/** `%H%x00%cI%x00%s` → the commit, or null for empty output. */
function parseCommitLine(line: string): CommitInfo | null {
  const [sha, date, subject] = line.split("\0");
  return sha ? { sha, date: date ?? "", subject: subject ?? "" } : null;
}

/** How many model commits, newest first, the walk past spec migrations looks at. */
const MAX_BASELINE_CANDIDATES = 50;

/** A `spec_version:` line in a diff of manifest.yaml: its sign and its value. */
const SPEC_VERSION_LINE = /^([+-])spec_version:\s*["']?([^"'\s#]*)["']?/;

/**
 * Whether a diff of manifest.yaml changes the model's spec version: it removes a `spec_version`
 * and adds a different one. The commit that creates the manifest only adds one, so it isn't a
 * migration.
 */
export function changesSpecVersion(manifestDiff: string): boolean {
  let removed: string | undefined;
  let added: string | undefined;
  for (const line of manifestDiff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const match = SPEC_VERSION_LINE.exec(line);
    if (!match) continue;
    if (match[1] === "-") removed = match[2];
    else added = match[2];
  }
  return removed !== undefined && added !== undefined && removed !== added;
}

/**
 * The fallback baseline for a model with no as-built landing recorded (no `reconciled` stamp in
 * its manifest; see lastReconcilingCommit): the last commit to the model that isn't a spec
 * migration. Any other model commit (a landed changeset, a catch-up after codebase_verify, a hand edit) is
 * someone looking at the model, so drift counts from it; a migration (`project_upgrade`, `dr
 * upgrade`) rewrites the model to a new spec without looking at the code, so it is walked past.
 * A commit is a migration when its diff of manifest.yaml changes `spec_version` (a merge's diff
 * against its first parent, so merging in an upgrade counts too).
 *
 * Limits: other model edits made in a migration commit don't reset drift. An upgrade committed in
 * two parts, the model files first and the manifest after, leaves the first part looking like an
 * ordinary model commit, so drift can be under-reported from it.
 *
 * Looks at the last MAX_BASELINE_CANDIDATES model commits. `commit` is null when every one of
 * them is a migration; the caller then uses the last model commit.
 */
export async function lastNonMigrationCommit(
  git: GitRunner,
  repoTop: string,
  modelPathspec: string
): Promise<{ commit: CommitInfo | null; skipped: CommitInfo[] } | { error: string }> {
  const manifest = path.join(modelPathspec, "manifest.yaml");
  const [commits, manifestLog] = await Promise.all([
    git(["log", `-n${MAX_BASELINE_CANDIDATES}`, "--format=%H%x00%cI%x00%s", "--", modelPathspec], repoTop),
    git(
      // A merge that brings in a migration shows its manifest change only diffed against its first
      // parent; by default git log prints no diff for a merge, and it would become the baseline.
      ["log", `-n${MAX_BASELINE_CANDIDATES}`, "-p", "-U0", "--diff-merges=first-parent", "--no-color", "--no-ext-diff", "--format=%x01%H", "--", manifest],
      repoTop
    ),
  ]);
  if (!commits.ok) return { error: `git log failed: ${commits.error}` };
  if (!manifestLog.ok) return { error: `git log failed: ${manifestLog.error}` };

  const migrations = new Set<string>();
  for (const chunk of manifestLog.stdout.split("\u0001").slice(1)) {
    const newline = chunk.indexOf("\n");
    const sha = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    if (sha && changesSpecVersion(newline === -1 ? "" : chunk.slice(newline + 1))) migrations.add(sha);
  }

  const skipped: CommitInfo[] = [];
  for (const line of commits.stdout.split("\n")) {
    const commit = parseCommitLine(line.trim());
    if (!commit) continue;
    if (!migrations.has(commit.sha)) return { commit, skipped };
    skipped.push(commit);
  }
  return { commit: null, skipped };
}

/**
 * The commit that reconciled the model with the code: the one that brought in the manifest's
 * current `reconciled` stamp, which an as-built landing writes (see core/reconciliation.ts). The
 * stamp is read from HEAD's manifest, and its commit found by the changeset id it names
 * (`git log -S`, the last commit that changed how often the id appears), so a rebase or a squash
 * merge that keeps the stamp keeps the baseline.
 *
 * `stamp` is null when HEAD's manifest has none (no as-built landing committed): the caller then
 * applies the earlier rule. `commit` is null when the stamp is there but no commit in this history
 * brought it in (a shallow clone).
 */
export async function lastReconcilingCommit(
  git: GitRunner,
  repoTop: string,
  modelPathspec: string
): Promise<{ stamp: ReconciledStamp | null; commit: CommitInfo | null } | { stamp: ReconciledStamp | null; error: string }> {
  const manifest = path.posix.join(modelPathspec.split(path.sep).join("/"), "manifest.yaml");
  const shown = await git(["show", `HEAD:${manifest}`], repoTop);
  // Not in HEAD (never committed, or no HEAD yet): no stamp.
  if (!shown.ok) return { stamp: null, commit: null };
  let stamp: ReconciledStamp | null;
  try {
    stamp = readReconciledStamp((parseYaml(shown.stdout) as Record<string, unknown> | null)?.reconciled);
  } catch (error) {
    return { stamp: null, error: `manifest.yaml at HEAD could not be read: ${getErrorMessage(error)}` };
  }
  if (!stamp) return { stamp: null, commit: null };
  const log = await git(["log", "-1", "--format=%H%x00%cI%x00%s", "-S", stamp.changeset_id, "--", manifest], repoTop);
  if (!log.ok) return { stamp, error: `git log failed: ${log.error}` };
  return { stamp, commit: parseCommitLine(log.stdout.trim()) };
}

/** How many base-model elements came from extraction (source reference provenance `extracted`). */
function extractedElementCount(model: Model): number {
  let n = 0;
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      if (element.getSourceReference()?.provenance === "extracted") n++;
    }
  }
  return n;
}

/**
 * Whether the model's landings leave extracted elements unexplained, for a model with no stamp. A
 * plan picks up extracted references too (changeset_adopt_source_references), so a model grown plan
 * by plan has them: when changesets have landed and none was extraction's, they are explained.
 * Unexplained: an extraction changeset landed (before landings were stamped), or nothing has landed
 * at all (the elements were written straight into the base). A history entry whose changeset isn't
 * on disk can't be told apart, so it counts as explained.
 */
async function extractionUnexplained(projectRoot: string, model: Model): Promise<boolean> {
  let changesets: Changeset[];
  try {
    changesets = await new StagedChangesetStorage(projectRoot).list();
  } catch {
    return false;
  }
  const landed = changesets.filter((c) => c.status === "committed");
  for (const c of landed) {
    if ((await extractionOrigin(projectRoot, c)).asBuilt) return true;
  }
  const history = (model.manifest.changeset_history ?? []).filter((h) => h.action === "committed");
  return landed.length === 0 && history.length === 0;
}

async function unexplainedExtractionNote(projectRoot: string, model: Model): Promise<string | undefined> {
  const extracted = extractedElementCount(model);
  if (!extracted || !(await extractionUnexplained(projectRoot, model))) return undefined;
  return noAsBuiltLandingNote(extracted);
}

/**
 * Informational: a model with extracted elements no landed plan explains, and no as-built landing
 * recorded. Undefined when no element came from extraction.
 */
function noAsBuiltLandingNote(extracted: number): string | undefined {
  if (!extracted) return undefined;
  return (
    `No as-built landing is recorded, though ${extracted} element(s) have extracted provenance and no landed plan accounts ` +
    "for them (a bootstrap modelled by hand, or landed before landings were stamped), so drift is counted from the last " +
    "model commit. Nothing needs doing; if the user wants drift counted from an as-built baseline, landing a changeset " +
    "codebase_extract stages (with their go-ahead) records one in manifest.yaml."
  );
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
    if (ids) out.push({ file, elements: [...ids], elementCount: ids.length });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------------------------------------
// shortening for the default answer, and the lists in full

/** The sections that hold lists the default answer shortens. */
export interface ListSections {
  changesets: ChangesetsSection | ErrorSection;
  codeIndex: CodeIndexSection | ErrorSection;
  codeDrift: CodeDriftSection | ErrorSection;
}

/** `project_status with list: "x", offset: n` as an agent would write the call. */
function listCall(list: StatusList, offset: number, rootPath?: string): string {
  return `project_status with list: "${list}"${offset > 0 ? `, offset: ${offset}` : ""}${rootPath ? `, rootPath: "${rootPath}"` : ""}`;
}

/** The `more` line for a list that shows `shown` of `total`. */
function moreLine(list: StatusList, shown: number, total: number, rootPath?: string): string {
  return `${list} shows ${shown} of ${total}: ${listCall(list, shown, rootPath)} returns the rest.`;
}

/** The items of one of the lists, whole, from sections as the collectors return them. */
export function statusListItems(list: StatusList, s: Partial<ListSections>): { items: unknown[] } | { unavailable: string } {
  const unavailable = (section: { status: string; reason?: string; error?: string } | undefined, what: string) => ({
    unavailable: section ? `${what} is ${section.status}${section.reason ? `: ${section.reason}` : section.error ? `: ${section.error}` : ""}` : `${what} was not read`,
  });
  if (list === "stagedChangesets") {
    return s.changesets?.status === "ok" ? { items: s.changesets.staged } : unavailable(s.changesets, "changesets");
  }
  if (list === "changedSinceIndex" || list === "uncommittedEdits") {
    const index = s.codeIndex;
    if (!index || index.status === "error" || index.status === "absent") return unavailable(index, "codeIndex");
    return { items: index[list] ?? [] };
  }
  const drift = s.codeDrift;
  if (!drift || (drift.status !== "drift" && drift.status !== "in-step" && drift.status !== "unlinked")) {
    return unavailable(drift, "codeDrift");
  }
  if (list === "changedSourceFiles") return { items: drift.changedSourceFiles };
  if (list === "uncommittedSourceFiles") return { items: drift.uncommittedSourceFiles };
  if (list === "unreferencedFiles") return { items: drift.unreferenced?.all ?? [] };
  return { items: drift.landedSince?.changesets ?? [] };
}

/**
 * The sections as the default answer shows them: each list cut to its default size
 * (LIST_DEFAULTS), with its true count beside it and a `more` line naming the call that returns
 * the rest. Nothing but the lists changes: every count, status and note was computed over the
 * whole lists, and stays. `rootPath` is the call's own argument, repeated in the calls named.
 */
export function shortenSections<S extends Partial<ListSections>>(sections: S, rootPath?: string): S {
  const out: S = { ...sections };

  if (out.changesets?.status === "ok" && out.changesets.staged.length > LIST_DEFAULTS.stagedChangesets) {
    const all = out.changesets.staged;
    const shown = all.slice(0, LIST_DEFAULTS.stagedChangesets);
    const hiddenDrifted = all.slice(shown.length).filter((entry) => entry.drift?.state === "drifted").length;
    out.changesets = {
      ...out.changesets,
      staged: shown,
      more: [
        `${moreLine("stagedChangesets", shown.length, all.length, rootPath)}` +
          `${hiddenDrifted > 0 ? ` ${hiddenDrifted} of those not shown ${hiddenDrifted === 1 ? "has" : "have"} a drifted base.` : ""}`,
      ],
    };
  }

  const index = out.codeIndex;
  if (index && index.status !== "error" && index.status !== "absent") {
    const more: string[] = [];
    const cut = (list: "changedSinceIndex" | "uncommittedEdits"): string[] | undefined => {
      const all = index[list];
      if (!all || all.length <= LIST_DEFAULTS[list]) return all;
      more.push(moreLine(list, LIST_DEFAULTS[list], all.length, rootPath));
      return all.slice(0, LIST_DEFAULTS[list]);
    };
    const changedSinceIndex = cut("changedSinceIndex");
    const uncommittedEdits = cut("uncommittedEdits");
    if (more.length > 0) {
      out.codeIndex = {
        ...index,
        ...(changedSinceIndex ? { changedSinceIndex } : {}),
        ...(uncommittedEdits ? { uncommittedEdits } : {}),
        more,
      };
    }
  }

  const drift = out.codeDrift;
  if (drift && (drift.status === "drift" || drift.status === "in-step" || drift.status === "unlinked")) {
    const more: string[] = [];
    let elementsCut = false;
    const cutFiles = (list: "changedSourceFiles" | "uncommittedSourceFiles"): ChangedSourceFile[] => {
      const all = drift[list];
      if (all.length > LIST_DEFAULTS[list]) more.push(moreLine(list, LIST_DEFAULTS[list], all.length, rootPath));
      return all.slice(0, LIST_DEFAULTS[list]).map((entry) => {
        if (entry.elements.length <= LIST_DEFAULTS.elementsPerFile) return entry;
        elementsCut = true;
        return { ...entry, elements: entry.elements.slice(0, LIST_DEFAULTS.elementsPerFile) };
      });
    };
    const changedSourceFiles = cutFiles("changedSourceFiles");
    const uncommittedSourceFiles = cutFiles("uncommittedSourceFiles");
    if (elementsCut) {
      more.push(
        `elements shows ${LIST_DEFAULTS.elementsPerFile} per file (elementCount is the whole count): ` +
          `${listCall("changedSourceFiles", 0, rootPath)} or list: "uncommittedSourceFiles" returns every element of each file.`
      );
    }

    let unreferenced = drift.unreferenced;
    if (unreferenced) {
      const { all = [], ...counts } = unreferenced;
      // The source files lead `all`, new ones first, so the names shown are its first entries.
      const first = all.filter((entry) => entry.source).slice(0, LIST_DEFAULTS.unreferencedFiles).map((entry) => entry.file);
      unreferenced = { ...counts, ...(first.length > 0 ? { first } : {}) };
      if (all.length > first.length) more.push(moreLine("unreferencedFiles", first.length, all.length, rootPath));
    }

    let landedSince = drift.landedSince;
    if (landedSince && landedSince.changesets.length > LIST_DEFAULTS.landedSince) {
      more.push(moreLine("landedSince", LIST_DEFAULTS.landedSince, landedSince.count, rootPath));
      landedSince = { ...landedSince, changesets: landedSince.changesets.slice(0, LIST_DEFAULTS.landedSince) };
    }

    out.codeDrift = {
      ...drift,
      changedSourceFiles,
      uncommittedSourceFiles,
      ...(unreferenced ? { unreferenced } : {}),
      ...(landedSince ? { landedSince } : {}),
      ...(more.length > 0 ? { truncated: true, more } : {}),
    };
  }
  return out;
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
      /**
       * The Tier-1 cache fill after the index (when the checkout opted in): its state, cards done
       * of total and cost so far. Phase `classifying` while it runs; the index is done meanwhile.
       */
      tier1?: { state: string; cards: { done: number; total: number } | null; costUsd: number; reason?: string };
    };

/** The last codebase_index run, from `.dr/analyzers/index-job.json`. */
export async function collectIndexing(ctx: StatusContext): Promise<IndexingSection> {
  if (!ctx.projectRoot) return { status: "none" };
  // The same liveness check as the tier1 section's `warming` (tests pass one).
  const job = await readIndexJob(ctx.projectRoot, ctx.tier1?.isAlive ? { isAlive: ctx.tier1.isAlive } : {});
  if (!job) return { status: "none" };
  return {
    status: job.state,
    jobId: job.jobId,
    phase: job.progress?.phase ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    logPath: job.logPath,
    ...(job.tier1
      ? { tier1: { state: job.tier1.state, cards: job.tier1.cards, costUsd: job.tier1.costUsd, ...(job.tier1.reason ? { reason: job.tier1.reason } : {}) } }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// tier 1

export type Tier1Section = Tier1Brief | { state: "off"; analyzer: null; reason: string };

/**
 * Tier 1 (the decision model codebase_extract asks, when the checkout opted in): its state,
 * provider and model, and this month's spend against the cap, from `tier1.json` and the spend
 * ledger of the active analyzer (else cbm). Never a key and never a request (tier1_status probes).
 */
export async function collectTier1(ctx: StatusContext): Promise<Tier1Section> {
  if (!ctx.projectRoot) return { state: "off", analyzer: null, reason: "no project" };
  const session = await readSession(ctx.projectRoot).catch(() => null);
  return tier1Brief(ctx.projectRoot, session?.active_analyzer ?? "cbm", ctx.tier1 ?? {});
}
