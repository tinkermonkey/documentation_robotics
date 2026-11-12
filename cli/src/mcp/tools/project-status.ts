/**
 * project_status — where this repo stands with DR, and what to do next. The first call an agent
 * makes in a session.
 *
 * It reads local files and git only: no network, and it never starts the code analyzer. Each
 * section comes from its own collector (project-status-collectors.ts), so one that fails reports
 * an error in its section and the others still answer.
 */

import path from "node:path";
import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { findProjectRoot } from "../../utils/project-paths.js";
import { fileExists } from "../../utils/file-io.js";
import { getErrorMessage } from "../../utils/errors.js";
import { currentProjectRoot, whenProjectRootSettled, type ProjectRootSource } from "../project-root.js";
import { readdir, stat } from "node:fs/promises";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import {
  collectChangesets,
  collectCodeDrift,
  collectCodeIndex,
  collectIndexing,
  collectModel,
  collectSpec,
  collectViewer,
  runGit,
  type ChangesetEntry,
  type ErrorSection,
  type GitRunner,
  type RootResolution,
  type StatusContext,
} from "./project-status-collectors.js";

const inputSchema = {
  rootPath: rootPathSchema,
};

export type ProjectStatusArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The sections, one collector each. A new section is one more entry here. */
const COLLECTORS = {
  model: collectModel,
  spec: collectSpec,
  changesets: collectChangesets,
  codeIndex: collectCodeIndex,
  codeDrift: collectCodeDrift,
  indexing: collectIndexing,
  viewer: collectViewer,
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
}

export interface ProjectStatus extends Sections {
  project: { root: string; resolvedBy: RootResolution; projectRoot: string | null };
  nextStep: NextStep;
}

const RESOLVED_BY: Record<ProjectRootSource, RootResolution> = {
  env: "DR_MCP_ROOT_PATH",
  "client-roots": "mcp-roots",
  cwd: "cwd",
};

/** Collects every section and picks the next step. `git` is injectable for tests. */
export async function projectStatus(
  args: ProjectStatusArgs,
  options: { git?: GitRunner } = {}
): Promise<ProjectStatus> {
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
  const ctx: StatusContext = {
    root,
    resolvedBy,
    projectRoot,
    modelDir,
    model: () => (modelPromise ??= freshModel(args.rootPath, modelDir)),
    git: options.git ?? runGit,
  };

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

  return {
    project: { root, resolvedBy, projectRoot },
    ...sections,
    nextStep: suggestNextStep(sections, { root, rootPath: args.rootPath }),
  };
}

/** The model files' signature when this tool last read the model, per rootPath cache key. */
const lastSignature = new Map<string, string>();

/** Test-only: forget the recorded signatures. */
export function clearProjectStatusSignatures(): void {
  lastSignature.clear();
}

/**
 * The model as it is on disk now. The server's cached model can be stale after a CLI command, a
 * pull or a hand edit, while git and changesets are read fresh. So the model files are stat'ed
 * (cheap), and the model is reloaded into the shared cache when they changed since this tool last
 * read it, or when this tool has not read it yet.
 */
async function freshModel(rootPath: string | undefined, modelDir: string | null): Promise<Model> {
  const key = rootPath ?? "";
  const signature = modelDir ? await filesSignature(modelDir) : null;
  if (signature !== null && lastSignature.get(key) === signature) return loadModel(rootPath);
  const model = await reloadModel(rootPath);
  if (signature !== null) lastSignature.set(key, signature);
  return model;
}

/** File count, summed mtimes and summed sizes of every file under `dir`. */
async function filesSignature(dir: string): Promise<string | null> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    const stats = await Promise.all(
      entries.filter((entry) => entry.isFile()).map((entry) => stat(path.join(entry.parentPath, entry.name)))
    );
    let mtimes = 0;
    let sizes = 0;
    for (const s of stats) {
      mtimes += s.mtimeMs;
      sizes += s.size;
    }
    return `${stats.length}:${mtimes}:${sizes}`;
  } catch {
    return null;
  }
}

/**
 * The one thing to do next, in order: create a model, upgrade it, continue the active changeset,
 * index the code when drift needs a fresh index, catch the model up with the code, index the code.
 */
export function suggestNextStep(s: Sections, ctx: { root: string; rootPath?: string }): NextStep {
  const step = withIndexNote(whileIndexing(pickNextStep(s, ctx.root), s), s);
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
function withIndexNote(step: NextStep, s: Sections): NextStep {
  if (step.tool === "codebase_index") return step;
  let also: NextStep["also"];
  if (s.indexing?.status === "running") {
    also = {
      summary: `The code is being indexed (started ${s.indexing.startedAt}); until it is done, codebase tools read the old index. Call codebase_index with status: true and wait: 30 to wait for it.`,
      tool: "codebase_index",
      args: WAIT_ARGS,
    };
  } else if (s.changesets?.status === "ok" && s.changesets.active) {
    // Without an active changeset, pickNextStep already sends a stale index to codebase_index.
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

function pickNextStep(s: Sections, root: string): NextStep {
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

  if (spec.status === "behind") {
    const how = spec.migration?.available
      ? "Preview and apply the migration with project_upgrade."
      : "The CLI has no migration path between them; project_upgrade reports the options.";
    return {
      summary: `The model is on spec ${spec.model}; this CLI carries ${spec.cli}. ${how}`,
      tool: "project_upgrade",
    };
  }
  if (spec.status === "ahead") {
    return {
      summary: `The model is on spec ${spec.model}, newer than this CLI's ${spec.cli}. Update the dr CLI before changing the model.`,
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

  if (changesets.status === "ok" && changesets.active) {
    const { name, changes, baseDrifted } = changesets.active;
    const drifted = baseDrifted ? " Its base model has changed since it was opened." : "";
    return {
      summary: `Changeset "${name}" is active with ${changes.total} staged change${changes.total === 1 ? "" : "s"}.${drifted} Read its brief with changeset_brief to pick up the plan.`,
      tool: "changeset_brief",
    };
  }

  if (codeDrift.status === "drift") {
    const files = codeDrift.changedSourceFiles.length + codeDrift.uncommittedSourceFiles.length;
    const sha = codeDrift.modelCommit.sha;
    const ago = `${sha.slice(0, 7)}, ${codeDrift.commitsSince} commit${codeDrift.commitsSince === 1 ? "" : "s"} ago`;
    const drift =
      codeDrift.basis === "last-reconciling-commit"
        ? `${files} source file${files === 1 ? "" : "s"} the model references changed since the model was last reconciled ` +
          `with the code, by the as-built landing "${codeDrift.reconciledBy?.changeset ?? "?"}" (${ago}). Landed plans don't reconcile it.`
        : `${files} source file${files === 1 ? "" : "s"} the model references changed since the model was last updated, ` +
          `not counting spec migrations (${ago}); no as-built landing is recorded yet.`;
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
          `${drift} ${index}: rebuild it with codebase_index, then check the API layer with codebase_verify ` +
          `and model the changes with codebase_extract since ${sha.slice(0, 7)}.`,
        tool: "codebase_index",
        args: INDEX_ARGS,
        then: { tool: "codebase_verify" },
      };
    }
    return {
      summary: `${drift} Check the API layer with codebase_verify, then model the changes with codebase_extract since ${sha.slice(0, 7)}.`,
      tool: "codebase_verify",
      then: { tool: "codebase_extract", args: { since: sha } },
    };
  }

  if (codeIndex.status === "absent") {
    return {
      summary: "The code has no index. Build one with codebase_index.",
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }
  if (codeIndex.status === "stale") {
    return {
      summary: `The code index is stale: ${codeIndex.reason ?? `it was built at ${codeIndex.indexedCommit.slice(0, 7)}`}. Refresh it with codebase_index.`,
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }
  if (codeIndex.status === "fresh-with-uncommitted-edits") {
    return {
      summary: `The code index predates uncommitted edits: ${codeIndex.reason}. Refresh it with codebase_index.`,
      tool: "codebase_index",
      args: INDEX_ARGS,
    };
  }

  if (changesets.status === "ok" && changesets.staged.length > 0) {
    const names = changesets.staged.map((changeset) => `"${changeset.name}"`).join(", ");
    return {
      summary: `No changeset is active; ${changesets.staged.length} staged: ${names}. Activate one with changeset_activate to continue it, or plan a new change with changeset_create.`,
      tool: "changeset_activate",
    };
  }

  const inStep =
    codeDrift.status === "in-step" && codeDrift.basis === "last-reconciling-commit"
      ? `The model is in step with the code: no source file it references changed since the as-built landing ` +
        `"${codeDrift.reconciledBy?.changeset ?? "?"}" (${codeDrift.modelCommit.sha.slice(0, 7)}).`
      : codeDrift.status === "in-step"
        ? "The model is current and in step with the code, counted from its last commit: no as-built landing is recorded yet."
        : "The model is current.";
  return {
    summary: `${inStep} To plan a change, start with changeset_create.`,
    tool: "changeset_create",
  };
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
  const plans = staged.filter((entry) => entry.id !== asBuilt.id && !entry.asBuilt);
  const fromRecord = asBuilt.previousActive ? plans.find((entry) => entry.id === asBuilt.previousActive!.id) : undefined;
  const plan = fromRecord ?? (plans.length === 1 ? plans[0] : undefined);

  if (plan) {
    return {
      summary:
        `${intro} It is the as-built side of a verify against the plan "${plan.name}": compare them with ` +
        `changeset_verify (planned: "${plan.name}", against: {changesetId: "${asBuilt.id}"}), and reactivate the plan ` +
        "with changeset_activate before any edits.",
      tool: "changeset_verify",
      args: { planned: plan.id, against: { changesetId: asBuilt.id } },
      also: {
        summary: `Reactivate the plan "${plan.name}" with changeset_activate before editing anything, so changes stage into it.`,
        tool: "changeset_activate",
        args: { changesetId: plan.id },
      },
    };
  }
  if (plans.length > 1) {
    const names = plans.map((entry) => `"${entry.name}"`).join(", ");
    return {
      summary:
        `${intro} ${plans.length} plans are staged (${names}), and nothing records which one this build is for. ` +
        `Ask the user, then call changeset_verify with planned: <that plan> and against: {changesetId: "${asBuilt.id}"}, ` +
        "and reactivate the plan with changeset_activate before any edits.",
      tool: null,
    };
  }
  return {
    summary:
      `${intro} No plan is staged, so it is a keep-as-built catch-up: it holds what was built and is reviewed and ` +
      "landed as itself. Show it to the user with review_open, and land it with changeset_commit when they ask.",
    tool: "review_open",
    args: { changeset: asBuilt.id },
  };
}

export async function projectStatusHandler(args: ProjectStatusArgs): Promise<CallToolResult> {
  return runTool(async () => jsonResult(await projectStatus(args), { compact: true }));
}

export const projectStatusTool: McpToolDefinition<typeof inputSchema> = {
  name: "project_status",
  description:
    "Where this repo stands with DR, and what to do next: the project root and how it was found, whether a model exists, its spec version against this CLI's, the active and staged changesets, whether the code index exists and is fresh (and any indexing run in progress), code changed since the model was last reconciled with it (the last as-built landing, from git; landed plans do not reconcile), and the viewer running for the project with its link. Ends with nextStep: a sentence and the tool to call. Reads local files and git only. Call it first in a session.",
  inputSchema,
  handler: projectStatusHandler,
};
