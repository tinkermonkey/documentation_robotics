/**
 * project_status — where this repo stands with DR, and what to do next. The first call an agent
 * makes in a session.
 *
 * It reads local files and git only: no network, and it never starts the code analyzer. Each
 * section comes from its own collector (project-status-collectors.ts), so one that fails reports
 * an error in its section and the others still answer.
 */

import path from "node:path";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { findProjectRoot } from "../../utils/project-paths.js";
import { fileExists } from "../../utils/file-io.js";
import { CLIError, ErrorCategory, getErrorMessage } from "../../utils/errors.js";
import { currentProjectRoot, whenProjectRootSettled, type ProjectRootSource } from "../project-root.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import {
  collectChangesets,
  collectCheckout,
  collectCodeDrift,
  collectCodeIndex,
  collectIndexing,
  collectModel,
  collectServer,
  collectSpec,
  collectTier1,
  collectViewer,
  compareVersions,
  LIST_DEFAULTS,
  pageOf,
  restartServer,
  runGit,
  shortenSections,
  staleServer,
  STATUS_LISTS,
  statusListItems,
  type ChangesetDriftEntry,
  type ChangesetEntry,
  type CodeDriftSection,
  type ErrorSection,
  type GitRunner,
  type ListPage,
  type RootResolution,
  type StatusContext,
  type StatusList,
  type StatusSession,
} from "./project-status-collectors.js";
import { DEFAULT_CENTRAL_DEPS, type CentralDeps } from "./central-viewer.js";

/** How many entries a `list` call returns when `limit` is not given. */
export const LIST_PAGE_DEFAULT = 50;

/** What a session is for, as project_status's `task` takes it (#1301). */
export const STATUS_TASKS = ["plan", "review", "reconcile"] as const;
export type StatusTask = (typeof STATUS_TASKS)[number];

const inputSchema = {
  rootPath: rootPathSchema,
  task: z
    .enum(STATUS_TASKS)
    .optional()
    .describe(
      "What this session is for, so nextStep fits it. plan: planning or building a change; review: reviewing a " +
        "change (a PR's plan, a staged changeset); reconcile: catching the model up with the code. With plan or " +
        "review, code drift and the code index are said in nextStep.info, not made the step. Omitted, the step " +
        "covers everything, drift included."
    ),
  list: z
    .enum(STATUS_LISTS)
    .optional()
    .describe(
      "Return one of the lists the status shortens, in full and paged, instead of the status: stagedChangesets, " +
        "changedSourceFiles and uncommittedSourceFiles (each file with every element that references it), " +
        "unreferencedFiles, landedSince (latest first), changedSinceIndex, uncommittedEdits or otherCheckouts (the project's " +
        "other checkouts). The status's more lines name the call."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`With list: how many entries to return (default ${LIST_PAGE_DEFAULT}). No upper bound: pass the list's total for all of it.`),
  offset: z.number().int().min(0).optional().describe("With list: how many entries to skip (default 0). The result's page.nextOffset is the next one."),
};

export type ProjectStatusArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The sections, one collector each. A new section is one more entry here. */
const COLLECTORS = {
  checkout: collectCheckout,
  model: collectModel,
  spec: collectSpec,
  server: collectServer,
  changesets: collectChangesets,
  codeIndex: collectCodeIndex,
  codeDrift: collectCodeDrift,
  indexing: collectIndexing,
  viewer: collectViewer,
  tier1: collectTier1,
} as const;

type Sections = {
  [K in keyof typeof COLLECTORS]: Awaited<ReturnType<(typeof COLLECTORS)[K]>> | ErrorSection;
};

export interface NextStep {
  summary: string;
  /** The tool to call, or null when the step is outside DR (update the CLI, fix a file). */
  tool: string | null;
  args?: Record<string, unknown>;
  /** A second call that follows the first. */
  then?: { tool: string; args?: Record<string, unknown> };
  /**
   * Something else that needs doing alongside this step, not after it: an index run in progress,
   * or an index that hasn't seen the latest code, while a changeset is active.
   */
  also?: { summary: string; tool: string; args?: Record<string, unknown> };
  /**
   * What the status found that this session's task leaves for later, said rather than made the
   * step: code drift and the index while planning or reviewing (task: plan or review).
   */
  info?: string;
}

export interface ProjectStatus extends Sections {
  /** Where the call resolved to; `name` and `checkout` when a farm project owns it (the checkout section has the rest). */
  project: { root: string; resolvedBy: RootResolution; projectRoot: string | null; name?: string; checkout?: string };
  nextStep: NextStep;
}

const RESOLVED_BY: Record<ProjectRootSource, RootResolution> = {
  env: "DR_MCP_ROOT_PATH",
  "client-roots": "mcp-roots",
  cwd: "cwd",
};

interface StatusOptions {
  git?: GitRunner;
  tier1?: StatusContext["tier1"];
  installedCli?: StatusContext["installedCli"];
  runningCodeBaseline?: StatusContext["runningCodeBaseline"];
  /** How the farm and the server record are read (tests pass their own). */
  central?: Partial<CentralDeps>;
}

/** What every collector gets for this call: the project it resolved to and the shared model. */
async function statusContext(args: ProjectStatusArgs, options: StatusOptions): Promise<StatusContext> {
  let root: string;
  let resolvedBy: RootResolution;
  if (args.rootPath) {
    root = path.resolve(args.rootPath);
    resolvedBy = "rootPath";
  } else {
    await whenProjectRootSettled();
    const current = currentProjectRoot();
    root = current.root;
    resolvedBy = RESOLVED_BY[current.source];
  }

  const projectRoot = await findProjectRoot(root);
  const manifest = projectRoot ? path.join(projectRoot, "documentation-robotics", "model", "manifest.yaml") : null;
  const modelDir = manifest && (await fileExists(manifest)) ? path.dirname(manifest) : null;

  let modelPromise: Promise<Model> | undefined;
  const central: CentralDeps = { ...DEFAULT_CENTRAL_DEPS, ...options.central };
  // Read-only: a folder no project owns is reported, not registered (review_open registers it).
  const where = projectRoot ?? root;
  let sessionPromise: Promise<StatusSession | null> | undefined;
  const session = () =>
    (sessionPromise ??= (async () => {
      const registry = await central.openRegistry(where);
      return { registry, resolved: await registry.resolvePath(where) };
    })());
  return {
    root,
    resolvedBy,
    projectRoot,
    modelDir,
    // The shared cache rereads the model when its files changed (a CLI command, a pull, a hand edit).
    model: () => (modelPromise ??= loadModel(args.rootPath)),
    git: options.git ?? runGit,
    ...(options.tier1 ? { tier1: options.tier1 } : {}),
    ...(options.installedCli ? { installedCli: options.installedCli } : {}),
    ...(options.runningCodeBaseline ? { runningCodeBaseline: options.runningCodeBaseline } : {}),
    session,
    central,
  };
}

/**
 * Collects every section and picks the next step. `git` is injectable for tests.
 *
 * The collectors return every list whole. The next step is picked from those, and only then are
 * the lists cut to their default sizes for the answer (shortenSections), so no verdict or count
 * depends on what is shown.
 */
export async function projectStatus(args: ProjectStatusArgs, options: StatusOptions = {}): Promise<ProjectStatus> {
  const ctx = await statusContext(args, options);
  const { root, resolvedBy, projectRoot } = ctx;

  const entries = await Promise.all(
    Object.entries(COLLECTORS).map(async ([key, collect]) => {
      try {
        return [key, await collect(ctx)] as const;
      } catch (error) {
        return [key, { status: "error", error: getErrorMessage(error) } satisfies ErrorSection] as const;
      }
    })
  );
  const sections = Object.fromEntries(entries) as Sections;

  const at = sections.checkout?.status === "ok" ? { name: sections.checkout.project, checkout: sections.checkout.checkout } : {};
  return {
    project: { root, resolvedBy, projectRoot, ...at },
    ...shortenSections(sections, args.rootPath),
    nextStep: suggestNextStep(sections, { root, rootPath: args.rootPath, task: args.task }),
  };
}

/** One page of a list the status shortens, in the shape every paged dr tool answers with. */
export interface StatusListPage {
  list: StatusList;
  items: unknown[];
  /** Where the page sits in the list: total, returned, offset, and nextOffset while entries are left. */
  page: ListPage;
  /** The call that returns the next page; absent when nothing is left. */
  more?: string;
  /** Set when the list could not be read: why. */
  note?: string;
}

/** The collector whose section holds each list. */
const LIST_SECTION: Record<StatusList, "changesets" | "codeIndex" | "codeDrift" | "checkout"> = {
  stagedChangesets: "changesets",
  changedSourceFiles: "codeDrift",
  uncommittedSourceFiles: "codeDrift",
  unreferencedFiles: "codeDrift",
  landedSince: "codeDrift",
  changedSinceIndex: "codeIndex",
  uncommittedEdits: "codeIndex",
  otherCheckouts: "checkout",
};

/**
 * One of the status's lists in full, paged: what `list` returns. Only the collector that holds
 * the list runs. `limit` has no upper bound, so one call can return all of it.
 */
export async function projectStatusList(
  args: ProjectStatusArgs & { list: StatusList },
  options: StatusOptions = {}
): Promise<StatusListPage> {
  // The list is the call for the rest, so every staged changeset's drift is described in full here.
  const ctx: StatusContext = { ...(await statusContext(args, options)), describeDrift: "all" };
  const key = LIST_SECTION[args.list];
  let section: Sections[typeof key];
  try {
    section = await COLLECTORS[key](ctx);
  } catch (error) {
    section = { status: "error", error: getErrorMessage(error) };
  }
  const read = statusListItems(args.list, { [key]: section });
  if ("unavailable" in read) {
    return { list: args.list, items: [], page: { total: 0, returned: 0, offset: 0 }, note: read.unavailable };
  }
  const { items, page } = pageOf(read.items, args.offset ?? 0, args.limit ?? LIST_PAGE_DEFAULT);
  return {
    list: args.list,
    items,
    page,
    ...(page.nextOffset !== undefined
      ? {
          more:
            `${page.total - page.nextOffset} more: project_status with list: "${args.list}", offset: ${page.nextOffset}` +
            `${args.limit ? `, limit: ${args.limit}` : ""}${args.rootPath ? `, rootPath: "${args.rootPath}"` : ""} returns the next page.`,
        }
      : {}),
  };
}

/**
 * The one thing to do next, in order: create a model, restart a dr server older than the installed
 * CLI when the spec versions disagree, upgrade the model, continue the active changeset, index the
 * code when drift needs a fresh index, catch the model up with the code, index the code. With task
 * plan or review, drift and the index are said in `info` and the step is the task's (#1301); the
 * old tracked active-changeset marker is said whatever the step (#1273).
 */
export function suggestNextStep(s: Sections, ctx: { root: string; rootPath?: string; task?: StatusTask }): NextStep {
  const picked = whileIndexing(pickNextStep(s, ctx.root, ctx.task), s);
  const info = ctx.task === "plan" || ctx.task === "review" ? driftAsInformation(s) : undefined;
  const informed = info ? { ...picked, info } : picked;
  const step = withLegacyMarkerNote(withServerNote(withIndexNote(informed, s, ctx.task), s), s);
  if (!ctx.rootPath) return step;
  // A call that named its project passes it on, so the next call serves the same one.
  const withRoot = (args?: Record<string, unknown>) => ({ ...args, rootPath: ctx.rootPath });
  return {
    ...step,
    ...(step.tool ? { args: withRoot(step.args) } : {}),
    ...(step.then ? { then: { ...step.then, args: withRoot(step.then.args) } } : {}),
    ...(step.also ? { also: { ...step.also, args: withRoot(step.also.args) } } : {}),
  };
}

/** The call that waits for an index run already going. */
const WAIT_ARGS = { status: true, wait: 30 };

/**
 * A step that isn't about the index still says when the index needs attention, so the agent
 * doesn't take an index run in progress, or one that hasn't seen the latest code, as settled.
 * The step itself stands: an active changeset is still the thing to pick up. The index call goes
 * in `also` unless the step already uses it, and in the summary either way.
 */
function withIndexNote(step: NextStep, s: Sections, task?: StatusTask): NextStep {
  if (step.tool === "codebase_index") return step;
  let also: NextStep["also"];
  if (s.indexing?.status === "running") {
    also = {
      summary: `The code is being indexed (started ${s.indexing.startedAt}); until it is done, codebase tools read the old index. Call codebase_index with status: true and wait: 30 to wait for it.`,
      tool: "codebase_index",
      args: WAIT_ARGS,
    };
  } else if (s.changesets?.status === "ok" && s.changesets.active && task !== "review") {
    // Without an active changeset, pickNextStep already sends a stale index to codebase_index. A
    // review reads the plan, not the code, so it is not told to refresh the index.
    if (s.codeIndex?.status === "fresh-with-uncommitted-edits" || s.codeIndex?.status === "stale") {
      const why =
        s.codeIndex.status === "stale"
          ? `The code index is stale${s.codeIndex.reason ? `: ${s.codeIndex.reason}` : ""}.`
          : `The code index predates uncommitted edits${s.codeIndex.reason ? `: ${s.codeIndex.reason}` : ""}.`;
      also = {
        summary: `${why} Refresh it with codebase_index before extracting or verifying against the code.`,
        tool: "codebase_index",
        args: INDEX_ARGS,
      };
    }
  }
  if (!also) return step;
  // A step that already has its own `also` (the as-built step's changeset_activate) keeps it; the
  // index still gets said, in the summary.
  if (step.also) return { ...step, summary: `${step.summary} Also: ${also.summary}` };
  return { ...step, summary: `${step.summary} Also: ${also.summary}`, also };
}

/**
 * A dr server whose CLI changed on disk after it started answers with the old code, whatever the
 * step: say so, unless the step is already the restart.
 */
function withServerNote(step: NextStep, s: Sections): NextStep {
  const stale = staleServer(s.server);
  if (!stale || step.summary.toLowerCase().includes(restart().toLowerCase())) return step;
  return { ...step, summary: `${step.summary} Also: ${stale.note}` };
}

/**
 * The old tracked active-changeset marker (#1273), whatever the step: said while git still tracks
 * it or it still decides the active changeset here. An untracked leftover is only in the section.
 */
function withLegacyMarkerNote(step: NextStep, s: Sections): NextStep {
  const legacy = s.changesets?.status === "ok" ? s.changesets.legacyMarker : undefined;
  if (!legacy || (!legacy.tracked && !legacy.inUse)) return step;
  return { ...step, summary: `${step.summary} Also: ${legacy.note}` };
}

/** The restart advice for the process answering (central, or in-process). */
const restart = (): string => restartServer();

/** A step that would start an index run waits for the one already running instead. */
function whileIndexing(step: NextStep, s: Sections): NextStep {
  if (step.tool !== "codebase_index" || s.indexing?.status !== "running") return step;
  return {
    summary: `The code is being indexed (started ${s.indexing.startedAt}). Call codebase_index with status: true and wait: 30 until it is done.`,
    tool: "codebase_index",
    args: { status: true, wait: 30 },
    ...(step.then ? { then: step.then } : {}),
  };
}

/** Starting an index run: block up to 30 s for it rather than poll. */
const INDEX_ARGS = { wait: 30 };

function pickNextStep(s: Sections, root: string, task?: StatusTask): NextStep {
  const ctx = { root };
  const { model, spec, changesets, codeDrift, codeIndex } = s;

  if (model.status === "absent") {
    return {
      summary: `There is no DR model in ${ctx.root}. Create one with project_init.`,
      tool: "project_init",
    };
  }
  if (model.status === "error") {
    return { summary: `The model could not be read: ${model.error}`, tool: null };
  }

  // A server process older than the installed CLI, when the spec versions disagree: the fix is a
  // restart, and it comes before any upgrade (which should be the installed CLI's, not this one's).
  const stale = staleServer(s.server);
  if (stale && spec.status === "ahead" && stale.installed.spec && compareVersions(stale.installed.spec, spec.model ?? "") >= 0) {
    return {
      summary:
        `The model is on spec ${spec.model}, newer than the ${spec.cli} this dr server is running (CLI ${stale.version}). The dr CLI ` +
        `installed now is already ${stale.installed.version} (spec ${stale.installed.spec}): this server process started before the ` +
        `upgrade. ${restart()} before changing the model; the CLI needs no update.`,
      tool: null,
    };
  }
  if (stale && spec.status === "behind") {
    return {
      summary:
        `This dr server process is CLI ${stale.version} (spec ${spec.cli}), and ${stale.installed.version}` +
        `${stale.installed.spec ? ` (spec ${stale.installed.spec})` : ""} is installed now. ${restart()}, then call project_status ` +
        `again: the model is on spec ${spec.model}, and its upgrade should come from the installed CLI, not this one.`,
      tool: null,
    };
  }
  if (spec.status === "behind") {
    const how = !spec.migration?.available
      ? "The CLI has no migration path between them; project_upgrade reports the options."
      : spec.migration.kind === "manifest-only"
        ? "The migration only stamps the new version: nothing in the model changes but spec_version in " +
          "manifest.yaml (migration.kind: manifest-only). Preview it with project_upgrade, tell the user that, and " +
          "apply it when they approve."
        : "Preview and apply the migration with project_upgrade.";
    return {
      summary: `The model is on spec ${spec.model}; this CLI carries ${spec.cli}. ${how}`,
      tool: "project_upgrade",
    };
  }
  if (spec.status === "ahead") {
    return {
      summary:
        `The model is on spec ${spec.model}, newer than this CLI's ${spec.cli}. Update the dr CLI, then ` +
        `${restart().charAt(0).toLowerCase()}${restart().slice(1)}, before changing the model.`,
      tool: null,
    };
  }

  if (model.loadError) {
    return {
      summary: `The model could not be loaded: ${model.loadError}. Fix the files under documentation-robotics/model/.`,
      tool: null,
    };
  }

  if (changesets.status === "ok" && changesets.active?.asBuilt) {
    return asBuiltStep(changesets.active, changesets.staged);
  }

  if (changesets.status === "ok" && changesets.active?.purpose === "upgrade-record") {
    return {
      summary:
        `Changeset "${changesets.active.name}" is active, but it is an upgrade record: the relationships a spec migration ` +
        "dropped. It never lands. Deactivate it with changeset_deactivate so writes don't stage into it, and read it with changeset_show.",
      tool: "changeset_deactivate",
    };
  }

  if (changesets.status === "ok" && changesets.active) {
    const { name, changes, drift } = changesets.active;
    const intro = `Changeset "${name}" is active with ${changes.total} staged change${changes.total === 1 ? "" : "s"}.`;
    if (drift?.state === "drifted") {
      return {
        summary:
          `${intro} ${changesetDriftSentence(drift)} Read what moved with changeset_brief (sections: ["drift"]) and check ` +
          "the plan still fits the base before building from it or landing it.",
        tool: "changeset_brief",
        args: { sections: ["drift"] },
      };
    }
    return {
      summary: `${intro}${drift ? ` ${changesetDriftSentence(drift)}` : ""} Read its brief with changeset_brief to pick up the plan.`,
      tool: "changeset_brief",
    };
  }

  // A review reads a plan, and planning makes one: code drift and the index are said in
  // nextStep.info for them, never made the step (#1301). Reconciling, or no task, puts them first.
  if (task === "review") return reviewStep(changesets);
  const upkeepFirst = task !== "plan";
  // Said with an upkeep step when the session didn't say what it is for.
  const taskHint = task ? "" : ` ${TASK_HINT}`;

  if (upkeepFirst && codeDrift.status === "drift") {
    const from = (codeDrift.countedFrom ?? codeDrift.modelCommit).sha;
    // The count could not start where it should: a since run from where it did start would leave
    // the earlier code unchecked and still end in "in step". Read the whole codebase instead.
    const partial = codeDrift.incompleteHistory !== undefined;
    const drift = `${codeDriftSentence(codeDrift)}${
      partial
        ? ` That is only what can be seen: the count should start earlier, at a commit this repository doesn't have${codeDrift.shallow ? " (it is a shallow clone)" : ""}.`
        : ""
    }`;
    const clear = partial
      ? "run codebase_extract with no since and no plan active, so code that changed before the commits this repository has is " +
        "read too, and land the changeset it makes when the user asks. A since run would leave that code unchecked."
      : codeDrift.basis === "last-reconciling-commit"
        ? `run codebase_extract with since: "${from.slice(0, 7)}" and no plan active, and land the reconcile changeset it makes when ` +
          "the user asks. If it stages nothing, create the changeset under the name it gives: any other name makes a plan, " +
          "which does not clear this."
        : `model the changes with codebase_extract since ${from.slice(0, 7)}.`;
    // codebase_verify refuses without a fresh index, so build or refresh it first.
    if (codeIndex.status !== "fresh") {
      const index =
        codeIndex.status === "stale"
          ? "The code index is stale"
          : codeIndex.status === "fresh-with-uncommitted-edits"
            ? "Source files were edited after the code index was taken"
            : "The code has no usable index";
      return {
        summary:
          `${drift} ${index}: rebuild it with codebase_index, then check the model against the code with codebase_verify ` +
          `and ${clear}${taskHint}`,
        tool: "codebase_index",
        args: INDEX_ARGS,
        then: { tool: "codebase_verify" },
      };
    }
    return {
      summary: `${drift} To clear it, check the model against the code with codebase_verify, then ${clear}${taskHint}`,
      tool: "codebase_verify",
      then: { tool: "codebase_extract", ...(partial ? {} : { args: { since: from } }) },
    };
  }

  // The baseline is out of reach and nothing is seen to have changed: that is not "in step".
  if (upkeepFirst && codeDrift.status === "unknown" && codeDrift.incompleteHistory) {
    const fetch = codeDrift.shallow
      ? "Fetch the full history (git fetch --unshallow) and call project_status again"
      : "Fetch the branch that holds that commit and call project_status again";
    return {
      summary:
        `Code drift can't be measured here: ${codeDrift.reason}. Don't take the model as current with the code. ${fetch}; ` +
        "if the commit is gone for good, run codebase_extract with no since and no plan active, and land the changeset it makes " +
        `when the user asks, which records a new baseline.${taskHint}`,
      tool: null,
    };
  }

  if (upkeepFirst && codeIndex.status === "absent") {
    return {
      summary: "The code has no index. Build one with codebase_index.",
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }
  if (upkeepFirst && codeIndex.status === "stale") {
    return {
      summary: `The code index is stale: ${codeIndex.reason ?? `it was built at ${codeIndex.indexedCommit.slice(0, 7)}`}. Refresh it with codebase_index.`,
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }
  if (upkeepFirst && codeIndex.status === "fresh-with-uncommitted-edits") {
    return {
      summary: `The code index predates uncommitted edits: ${codeIndex.reason}. Refresh it with codebase_index.`,
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }

  // An upgrade record is read and restored from, never continued
  const records = changesets.status === "ok" ? changesets.staged.filter((entry) => entry.purpose === "upgrade-record") : [];
  const continuable = changesets.status === "ok" ? changesets.staged.filter((entry) => entry.purpose !== "upgrade-record") : [];
  const recordNote =
    records.length > 0
      ? ` ${records.map((entry) => `"${entry.name}"`).join(", ")} ${records.length === 1 ? "records" : "record"} the relationships a spec migration dropped: ` +
        "read it with changeset_show, re-add what still applies in a changeset of the user's own, and discard it only when the user asks."
      : "";
  if (continuable.length > 0) {
    const names = nameSome(continuable.map((changeset) => changeset.name));
    const drifted = continuable.filter((changeset) => changeset.drift?.state === "drifted");
    const driftNote =
      drifted.length > 0
        ? ` The base model changed under ${nameSome(drifted.map((changeset) => changeset.name))}: ` +
          `${landingSentence(drifted[0].drift!)} changeset_brief with changeset: "${drifted[0].name}" and sections: ["drift"] names what moved.`
        : "";
    return {
      summary: `No changeset is active; ${continuable.length} staged: ${names}. Activate one with changeset_activate to continue it, or plan a new change with changeset_create.${driftNote}${recordNote}`,
      tool: "changeset_activate",
    };
  }

  const unseen = codeDrift.status === "in-step" ? unreferencedSentence(codeDrift) : "";
  const inStep =
    codeDrift.status === "in-step" && codeDrift.basis === "last-reconciling-commit"
      ? `The model is in step with the code: no source file it references changed ${sinceLanding(codeDrift)}.${unseen}`
      : codeDrift.status === "in-step"
        ? `The model is current and in step with the code, counted from its last commit: no as-built landing is recorded yet.${unseen}`
        : codeDrift.status === "drift"
          ? "The code has changed since the model was last reconciled with it (nextStep.info says what)."
          : codeDrift.status === "unlinked"
            ? "No element has a source reference, so changed code can't be tied to the model."
            : codeDrift.status === "unknown" || codeDrift.status === "no-git" || codeDrift.status === "error"
              ? `Whether the model is in step with the code could not be checked${"reason" in codeDrift && codeDrift.reason ? `: ${codeDrift.reason}` : "error" in codeDrift ? `: ${codeDrift.error}` : ""}.`
              : "The model is current.";
  // New source files no element references are code no extraction has read: offer the catch-up.
  const catchUp =
    codeDrift.status === "in-step" && (codeDrift.unreferenced?.newSourceFiles ?? 0) > 0
      ? {
          also: {
            summary: "Read the new source files with codebase_extract before planning on top of a model that has not seen them.",
            tool: "codebase_extract",
            args: { since: (codeDrift.countedFrom ?? codeDrift.modelCommit).sha },
          },
        }
      : {};
  return {
    summary: `${inStep} To plan a change, start with changeset_create.${recordNote}`,
    tool: "changeset_create",
    ...catchUp,
  };
}

type CodeDrift = Extract<CodeDriftSection, { status: "drift" | "in-step" | "unlinked" }>;

/** How many names a sentence spells out; the count it gives is always the whole one. */
const NAMES_IN_A_SENTENCE = 5;

/** `"a", "b"`, or the first few and how many more there are (the section lists them). */
function nameSome(names: string[]): string {
  const shown = names.slice(0, NAMES_IN_A_SENTENCE).map((name) => `"${name}"`).join(", ");
  return names.length > NAMES_IN_A_SENTENCE ? `${shown} and ${names.length - NAMES_IN_A_SENTENCE} more` : shown;
}

/** "3 elements changed, 1 relationship added": what moved in the base, or "" when nothing is counted. */
function baseChangeCounts(counts: NonNullable<ChangesetDriftEntry["baseChanges"]>): string {
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  return (
    [
      [counts.elementsChanged ?? 0, "element", "changed"],
      [counts.elementsAdded ?? 0, "element", "added"],
      [counts.elementsRemoved ?? 0, "element", "removed"],
      [counts.relationshipsAdded ?? 0, "relationship", "added"],
      [counts.relationshipsRemoved ?? 0, "relationship", "removed"],
    ] as Array<[number, string, string]>
  )
    .filter(([n]) => n > 0)
    .map(([n, noun, verb]) => `${plural(n, noun)} ${verb}`)
    .join(", ");
}

/** What a landing does about a changeset's base drift. */
function landingSentence(drift: ChangesetDriftEntry): string {
  if (drift.landing === "unknown") return "Whether it can land can't be told until its drift can be checked.";
  return drift.landing === "allowed-with-warning"
    ? "Landing it is allowed, with a warning: the person confirming is shown what overlaps (an unattended `dr changeset commit` needs --force)."
    : "Landing it is not blocked.";
}

/** A changeset's base drift in a sentence or two: what moved, what overlaps, what a landing does. */
function changesetDriftSentence(drift: ChangesetDriftEntry): string {
  if (drift.state === "unknown") {
    // With no base snapshot the reason itself says a commit is not blocked.
    return `Its base drift could not be checked: ${drift.reason ?? "no reason given"}${drift.landing === "unknown" ? ` ${landingSentence(drift)}` : ""}`;
  }
  const moved = drift.baseChanges ? baseChangeCounts(drift.baseChanges) : "";
  if (drift.state === "content-free") {
    return `The base model changed since it was created${moved ? ` (${moved})` : ""}, but nothing it stages against. ${landingSentence(drift)}`;
  }
  const overlaps = drift.overlapping ? drift.overlapping.elements + drift.overlapping.relationships : 0;
  const what = moved
    ? `${moved} in the base`
    : drift.baseIndex
      ? `it has no readable base index (${drift.baseIndex}), so what changed can't be named`
      : "what it stages against changed";
  const overlap =
    overlaps > 0
      ? `; ${overlaps} of its staged changes overlap${drift.overlapping!.first.length > 0 ? ` (${drift.overlapping!.first.join("; ")}${overlaps > drift.overlapping!.first.length ? "; ..." : ""})` : ""}`
      : "";
  return `The base model changed under it since it was created: ${what}${overlap}. ${landingSentence(drift)}`;
}

/** "since the as-built landing "x" (abc1234)", or since the code it read when that is where the count starts. */
function sinceLanding(codeDrift: CodeDrift): string {
  const landing = `the as-built landing "${codeDrift.reconciledBy?.changeset ?? "?"}"`;
  const from = codeDrift.countedFrom;
  return from && from.sha !== codeDrift.modelCommit.sha
    ? `since the code ${landing} read (${from.sha.slice(0, 7)})`
    : `since ${landing} (${codeDrift.modelCommit.sha.slice(0, 7)})`;
}

/** The changed files no element references, as a clause; "" when there are none worth saying. */
function unreferencedSentence(codeDrift: CodeDrift): string {
  const rest = codeDrift.unreferenced;
  if (!rest || rest.sourceFiles === 0) return "";
  const from = (codeDrift.countedFrom ?? codeDrift.modelCommit).sha.slice(0, 7);
  return (
    ` ${rest.sourceFiles} other changed source file${rest.sourceFiles === 1 ? "" : "s"} ${rest.sourceFiles === 1 ? "is" : "are"} referenced by no element` +
    `${rest.newSourceFiles > 0 ? ` (${rest.newSourceFiles} new)` : ""}, so this check can't judge ${rest.sourceFiles === 1 ? "it" : "them"}: ` +
    `codebase_extract with since: "${from}" reads ${rest.sourceFiles === 1 ? "it" : "them"}.`
  );
}

/** Code drift in a sentence or two: how many referenced files changed, counted from where, and what did not clear it. */
function codeDriftSentence(codeDrift: CodeDrift): string {
  const committed = codeDrift.referencedFilesChanged ?? codeDrift.changedSourceFiles.length;
  const edited = codeDrift.referencedFilesUncommitted ?? codeDrift.uncommittedSourceFiles.length;
  const reconciled = codeDrift.basis === "last-reconciling-commit";
  const from = (codeDrift.countedFrom ?? codeDrift.modelCommit).sha.slice(0, 7);
  const since = reconciled ? sinceLanding(codeDrift) : `since the model was last updated, not counting spec migrations (${from})`;
  const files = (n: number) => `${n} source file${n === 1 ? "" : "s"} the model references`;
  const have = (n: number) => (n === 1 ? "has" : "have");
  // Committed changes are counted from the baseline; uncommitted edits sit on top of HEAD.
  const changed =
    committed > 0
      ? `${files(committed)} changed ${since}, ${codeDrift.commitsSince} code commit${codeDrift.commitsSince === 1 ? "" : "s"} ago` +
        `${edited > 0 ? `, and ${edited} more ${have(edited)} uncommitted edits` : ""}`
      : `${files(edited)} ${have(edited)} uncommitted edits; none changed in a commit ${since}`;
  const rest = codeDrift.unreferenced;
  const unseen =
    rest && rest.files > 0
      ? ` ${rest.files} more changed file${rest.files === 1 ? " is" : "s are"} referenced by no element` +
        `${rest.sourceFiles > 0 ? ` (${rest.sourceFiles} source, ${rest.newSourceFiles} new)` : ""}, so ${rest.files === 1 ? "it" : "they"} can't show here.`
      : "";
  if (!reconciled) return `${changed}; no as-built landing is recorded yet.${unseen}`;

  // Said only when something landed since; `rule` says it for every reader.
  const landed = codeDrift.landedSince;
  const landedNote = landed
    ? ` Landed plans don't reconcile it, verified or not: ${landed.count} landed since ` +
      `(${nameSome(landed.changesets)}${landed.count > landed.changesets.length && landed.changesets.length <= NAMES_IN_A_SENTENCE ? ` and ${landed.count - landed.changesets.length} more` : ""}) and the baseline did not move.`
    : "";
  return `${changed}.${unseen}${landedNote}`;
}

/** What an upkeep step adds when the session didn't say what it is for (#1301). */
const TASK_HINT =
  'If this session is planning or reviewing a change rather than reconciling the model, call project_status with ' +
  'task: "plan" or "review": drift is then said in nextStep.info, not made the step.';

/**
 * The step for a session reviewing a change (task: review) with no changeset active: the staged
 * plan to read and show, or the ones to pick from. The active changeset is per checkout, so a plan
 * on a PR's branch is staged here but not active.
 */
function reviewStep(changesets: Sections["changesets"]): NextStep {
  if (changesets.status !== "ok") {
    const why = "error" in changesets ? `: ${changesets.error}` : "";
    return { summary: `The changesets could not be read${why}.`, tool: null };
  }
  // What a review reads is a plan (a DrBot chat's too): never an as-built record (bootstrap,
  // reconcile, verification) or an upgrade record.
  const plans = changesets.staged.filter((entry) => !entry.asBuilt && entry.purpose !== "upgrade-record");
  const perCheckout =
    "The active changeset is per checkout (.dr/active-changeset), so a plan from a branch is staged here, not active.";
  if (plans.length === 1) {
    const [plan] = plans;
    const changes = `${plan.changes.total} staged change${plan.changes.total === 1 ? "" : "s"}`;
    return {
      summary:
        `Changeset "${plan.name}" is staged, with ${changes}. ${perCheckout} Read it with changeset_brief ` +
        `(changeset: "${plan.name}"), and show it to the user with review_open; read their comments with annotation_list.`,
      tool: "changeset_brief",
      args: { changeset: plan.id },
      then: { tool: "review_open", args: { changeset: plan.id } },
    };
  }
  if (plans.length > 1) {
    return {
      summary:
        `${plans.length} changesets are staged: ${nameSome(plans.map((entry) => entry.name))}. ${perCheckout} ` +
        "Ask the user " +
        "which one is under review (a PR's diff names its folder under documentation-robotics/changesets/), then read it " +
        "with changeset_brief (changeset: <its name>) and show it with review_open.",
      tool: "changeset_list",
    };
  }
  return {
    summary:
      "No changeset is staged in this checkout, so there is no plan here to review. A PR's plan is staged on its branch, " +
      "under documentation-robotics/changesets/: check that branch out and call project_status again. A plan that landed " +
      "is part of the model: model_show reads its elements.",
    tool: null,
  };
}

/**
 * Code drift and the index's state, said as information for a session that is planning or
 * reviewing (task: plan or review); undefined when there is nothing to say.
 */
function driftAsInformation(s: Sections): string | undefined {
  const { codeDrift, codeIndex } = s;
  const parts: string[] = [];
  let drifted = false;
  if (codeDrift?.status === "drift") {
    parts.push(codeDriftSentence(codeDrift));
    drifted = true;
  } else if (codeDrift?.status === "unknown" && codeDrift.incompleteHistory) {
    parts.push(`Code drift can't be measured here: ${codeDrift.reason}.`);
    drifted = true;
  }
  const index =
    codeIndex?.status === "absent"
      ? "The code has no index."
      : codeIndex?.status === "stale"
        ? `The code index is stale${codeIndex.reason ? `: ${codeIndex.reason}` : ""}.`
        : codeIndex?.status === "fresh-with-uncommitted-edits"
          ? "The code index predates uncommitted edits."
          : "";
  if (index) parts.push(index);
  if (parts.length === 0) return undefined;
  const reconcile = drifted
    ? ' Reconciling the model with the code is a session of its own (project_status with task: "reconcile").'
    : "";
  const refresh = index ? " codebase_index refreshes the index when this task needs the code." : "";
  return `Not this session's task: ${parts.join(" ")}${reconcile}${refresh}`;
}

/**
 * The step for an active as-built changeset (one codebase_extract staged): it holds what was
 * built, not a plan, so it is never "the plan to pick up". With a plan staged it is the as-built
 * side of a verify, and the plan is reactivated before any edits; with none, it is a
 * keep-as-built catch-up, reviewed and landed as itself.
 */
function asBuiltStep(asBuilt: ChangesetEntry, staged: ChangesetEntry[]): NextStep {
  const changes = `${asBuilt.changes.total} staged change${asBuilt.changes.total === 1 ? "" : "s"}`;
  const intro =
    `Changeset "${asBuilt.name}" is active, with ${changes}: it is the as-built changeset codebase_extract staged ` +
    "from the code, not a plan. Don't build from it or edit it as a plan.";
  const plans = staged.filter((entry) => entry.id !== asBuilt.id && !entry.asBuilt && entry.purpose !== "upgrade-record");
  const fromRecord = asBuilt.previousActive ? plans.find((entry) => entry.id === asBuilt.previousActive!.id) : undefined;
  const plan = fromRecord ?? (plans.length === 1 ? plans[0] : undefined);

  if (plan) {
    return {
      summary:
        `${intro} It is the as-built side of a verify against the plan "${plan.name}": compare them with ` +
        `changeset_verify (changeset: "${plan.name}", against: {changeset: "${asBuilt.id}"}), and reactivate the plan ` +
        "with changeset_activate before any edits.",
      tool: "changeset_verify",
      args: { changeset: plan.id, against: { changeset: asBuilt.id } },
      also: {
        summary: `Reactivate the plan "${plan.name}" with changeset_activate before editing anything, so changes stage into it.`,
        tool: "changeset_activate",
        args: { changeset: plan.id },
      },
    };
  }
  if (plans.length > 1) {
    const names = plans.map((entry) => `"${entry.name}"`).join(", ");
    return {
      summary:
        `${intro} ${plans.length} plans are staged (${names}), and nothing records which one this build is for. ` +
        `Ask the user, then call changeset_verify with changeset: <that plan> and against: {changeset: "${asBuilt.id}"}, ` +
        "and reactivate the plan with changeset_activate before any edits.",
      tool: null,
    };
  }
  if (asBuilt.purpose === "verification") {
    // No plan is staged: it was discarded, or landed before a landing recorded its verification
    // records (changeset-purpose.ts, `recorded`). The record is never landed.
    const of = asBuilt.previousActive ? ` of the plan "${asBuilt.previousActive.name}"` : "";
    return {
      summary:
        `${intro} It is the verification record${of}, and no plan is staged: it is never landed. Ask the user whether ` +
        "to discard it (a landing records the verification records of its plan, so this one's plan was discarded or landed before that), and deactivate " +
        "it with changeset_deactivate so writes don't stage into it. To reconcile the model with code drift, run " +
        "codebase_extract with no plan active.",
      tool: "changeset_deactivate",
    };
  }
  // What a landing takes when the base moved under it: said here, not left to the refusal.
  const drift = asBuilt.drift && asBuilt.drift.state !== "content-free" ? ` ${changesetDriftSentence(asBuilt.drift)}` : "";
  return {
    summary:
      `${intro} No plan is staged, so it is a keep-as-built catch-up: it holds what was built and is reviewed and ` +
      `landed as itself. Show it to the user with review_open, and land it with changeset_commit when they ask.${drift}` +
      `${asBuilt.drift?.state === "drifted" ? ' changeset_brief with sections: ["drift"] lists what moved.' : ""}`,
    tool: "review_open",
    args: { changeset: asBuilt.id },
  };
}

export async function projectStatusHandler(args: ProjectStatusArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const { list } = args;
    if (list) return jsonResult(await projectStatusList({ ...args, list }), { compact: true });
    if (args.limit !== undefined || args.offset !== undefined) {
      throw new CLIError("limit and offset page one of the status's lists, so they need list", ErrorCategory.USER, [
        `Pass list with them: one of ${STATUS_LISTS.join(", ")}`,
        "Or call project_status without them for the status itself",
      ]);
    }
    return jsonResult(await projectStatus(args), { compact: true });
  });
}

export const projectStatusTool: McpToolDefinition<typeof inputSchema> = {
  name: "project_status",
  description:
    "Where this repo stands with DR, and what to do next: the project root and how it was found, whether a model exists, its spec version against this CLI's, whether this dr server is older than the CLI installed now (then it needs a restart, not an update), the active changeset (in this checkout: the marker is per checkout, in .dr/; an old documentation-robotics/changesets/.active still on disk or in git is reported as legacyMarker, with what to commit) and the staged changesets (for one whose base moved: its drift state, what a landing does about it and the call that lists what moved; for the active one also what changed under it and what overlaps), whether the code index exists and is fresh (and any indexing run in progress), code changed since the model was last reconciled with it (counted from the code the last as-built landing read, from git; landed plans do not reconcile; changed files no element references are counted apart; the changed files are counted per folder and their elements per layer in changedSourceSummary), the farm project and checkout this folder is (checkout) with the project's other checkouts (branch, head, state, active changeset, staged count), the central DR process serving the shared viewer with this checkout's link when it runs (it never starts it: review_open does), and Tier 1 (the opt-in decision model codebase_extract asks): its state (warming, with progress, while the codebase_index job fills its answer cache) and this month's spend against the cap (tier1_status has more). Ends with nextStep: a sentence and the tool to call. Pass task (plan, review or reconcile) to say what the session is for: while planning or reviewing, code drift and the index go in nextStep.info, not the step. The status is kept small, so its lists show their first entries by default: " +
    `${LIST_DEFAULTS.stagedChangesets} staged changesets, ${LIST_DEFAULTS.changedSourceFiles} changed source files with ${LIST_DEFAULTS.elementsPerFile} elements each, ` +
    `${LIST_DEFAULTS.unreferencedFiles} unreferenced files, the ${LIST_DEFAULTS.landedSince} latest changesets landed since, ${LIST_DEFAULTS.changedSinceIndex} files changed since the index, ` +
    `${LIST_DEFAULTS.otherCheckouts} other checkouts, ` +
    "and 3 overlapping changes per drifted changeset (changeset_brief with sections: [\"drift\"] lists those). Each shortened list has its true count beside it, its page (total, returned, offset, nextOffset) under pages, and a more line naming the call for the rest: " +
    `list returns any of them in full, paged with limit (default ${LIST_PAGE_DEFAULT}, no upper bound) and offset, as items and page. Every status, count and nextStep is computed over the whole lists, never over what is shown. ` +
    "Reads local files and git only. Call it first in a session.",
  inputSchema,
  handler: projectStatusHandler,
};
