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
  collectModel,
  collectSpec,
  runGit,
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
  const step = pickNextStep(s, ctx.root);
  if (!ctx.rootPath || !step.tool) return step;
  // A call that named its project passes it on, so the next call serves the same one.
  const withRoot = (args?: Record<string, unknown>) => ({ ...args, rootPath: ctx.rootPath });
  return {
    ...step,
    args: withRoot(step.args),
    ...(step.then ? { then: { ...step.then, args: withRoot(step.then.args) } } : {}),
  };
}

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
    const drift =
      `${files} source file${files === 1 ? "" : "s"} the model references changed since the model last changed ` +
      `(${sha.slice(0, 7)}, ${codeDrift.commitsSince} commit${codeDrift.commitsSince === 1 ? "" : "s"} ago).`;
    // codebase_verify refuses without a fresh index, so build or refresh it first.
    if (codeIndex.status !== "fresh") {
      const index = codeIndex.status === "stale" ? "The code index is stale" : "The code has no usable index";
      return {
        summary: `${drift} ${index}: rebuild it with codebase_index, then check the drift with codebase_verify.`,
        tool: "codebase_index",
        then: { tool: "codebase_verify" },
      };
    }
    return {
      summary: `${drift} Check them with codebase_verify, then model the changes with codebase_extract since ${sha.slice(0, 7)}.`,
      tool: "codebase_verify",
      then: { tool: "codebase_extract", args: { since: sha } },
    };
  }

  if (codeIndex.status === "absent") {
    return {
      summary: "The code has no index. Build one with codebase_index.",
      tool: "codebase_index",
    };
  }
  if (codeIndex.status === "stale") {
    return {
      summary: `The code index was built at ${codeIndex.indexedCommit.slice(0, 7)}, not the current HEAD. Refresh it with codebase_index.`,
      tool: "codebase_index",
    };
  }

  if (changesets.status === "ok" && changesets.staged.length > 0) {
    const names = changesets.staged.map((changeset) => `"${changeset.name}"`).join(", ");
    return {
      summary: `No changeset is active; ${changesets.staged.length} staged: ${names}. Activate one with changeset_activate to continue it, or plan a new change with changeset_create.`,
      tool: "changeset_activate",
    };
  }

  return {
    summary: "The model is current and in step with the code. To plan a change, start with changeset_create.",
    tool: "changeset_create",
  };
}

export async function projectStatusHandler(args: ProjectStatusArgs): Promise<CallToolResult> {
  return runTool(async () => jsonResult(await projectStatus(args), { compact: true }));
}

export const projectStatusTool: McpToolDefinition<typeof inputSchema> = {
  name: "project_status",
  description:
    "Where this repo stands with DR, and what to do next: the project root and how it was found, whether a model exists, its spec version against this CLI's, the active and staged changesets, whether the code index exists and is fresh, and code changed since the model last changed (from git). Ends with nextStep: a sentence and the tool to call. Reads local files and git only. Call it first in a session.",
  inputSchema,
  handler: projectStatusHandler,
};
