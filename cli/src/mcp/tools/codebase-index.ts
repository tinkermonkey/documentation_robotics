/**
 * codebase_index — index the project's code with the analyzer (codebase-memory-mcp), in the
 * background.
 *
 * It starts `dr analyzer index` in a detached process and returns at once; it never waits for
 * the index. The agent polls with `status: true` (or `project_status`) until the job is done or
 * failed. Indexing a large codebase outlasts an MCP call, and a client that moves a long call to
 * the background (Claude Code after 2 minutes) loses its result under `claude -p`. The job record
 * is `.dr/analyzers/index-job.json` (analyzers/index-job.ts). Writes no model files.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readIndexFreshness } from "../../analyzers/active-analyzer.js";
import { readIndexJob, startIndexJob, type IndexJob } from "../../analyzers/index-job.js";
import { readSession, writeSession } from "../../analyzers/session-state.js";
import type { IndexFreshness } from "../../analyzers/active-analyzer.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import {
  analyzerNotFoundError,
  canonicalRoots,
  defaultCodebaseToolDeps,
  describeIndex,
  installSuggestions,
  notInstalledError,
  type CodebaseToolDeps,
} from "./codebase-shared.js";

const inputSchema = {
  status: z
    .boolean()
    .optional()
    .describe("Only report the current or last run and the index's freshness; start nothing."),
  force: z
    .boolean()
    .optional()
    .describe("Re-index even when the index is fresh. Also stops a run in flight and starts over (for a stuck run)."),
  rootPath: rootPathSchema,
};

export type CodebaseIndexArgs = z.infer<z.ZodObject<typeof inputSchema>>;

const POLL =
  "Indexing runs in the background. Call codebase_index with status: true about every 30 seconds until job.state is done or failed; carry on with other work meanwhile.";

/** What the agent should do next, given the job and the index. */
function nextStep(job: IndexJob | null, freshness: IndexFreshness): string {
  if (job?.state === "running") return POLL;
  if (job?.state === "failed" && !freshness.fresh) {
    return "The last run failed: see job.error and the log at job.logPath. Fix the cause, then call codebase_index again.";
  }
  if (freshness.fresh) return "The index is fresh. codebase_verify compares the code's routes with the model's API.";
  if (freshness.indexed) return "The code has changed since the last index. Call codebase_index to re-index.";
  return "The code is not indexed. Call codebase_index to index it.";
}

export function createCodebaseIndexHandler(deps: CodebaseToolDeps = defaultCodebaseToolDeps) {
  return async function codebaseIndexHandler(args: CodebaseIndexArgs): Promise<CallToolResult> {
    return runTool(async () => {
      // The project comes from rootPath or the client's roots (loadModel waits for them).
      const model = await loadModel(args.rootPath);
      // One spelling of each root for this call and the child it starts (see canonicalRoots).
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);
      const gitHead = deps.gitHead;
      const job = await readIndexJob(projectRoot, { isAlive: deps.isAlive });
      const session = await readSession(projectRoot);

      const report = async (analyzer: string | null, started: boolean, current: IndexJob | null, extra = {}) => {
        const freshness: IndexFreshness = analyzer
          ? await readIndexFreshness(projectRoot, analyzer, codebaseRoot, gitHead)
          : { indexed: false, fresh: false };
        return jsonResult({
          projectRoot,
          analyzer,
          started,
          job: current,
          index: describeIndex(freshness),
          next: nextStep(current, freshness),
          ...extra,
        });
      };

      if (args.status) {
        return report(session?.active_analyzer || job?.analyzer || null, false, job);
      }

      // One run at a time: a call while one is in flight reports that run. force replaces it.
      if (job?.state === "running" && !args.force) {
        return report(job.analyzer, false, job);
      }

      // Pick the analyzer, discovering one when none is selected yet.
      let analyzer = session?.active_analyzer;
      let discovered = false;
      if (!analyzer) {
        const discovery = await deps.discover();
        if (!discovery.selected) {
          const name = discovery.found[0]?.name ?? "cbm";
          throw new CLIError("No code analyzer is installed", ErrorCategory.USER, await installSuggestions(name));
        }
        analyzer = discovery.selected;
        discovered = true;
        await writeSession({ active_analyzer: analyzer, selected_at: new Date().toISOString() }, projectRoot);
      }

      const backend = await deps.getAnalyzer(analyzer);
      if (!backend) throw analyzerNotFoundError(analyzer);
      // Discovery has just checked it; otherwise check before starting a run that would fail.
      if (!discovered) {
        const detection = await backend.detect(projectRoot);
        if (!detection.installed) throw await notInstalledError(analyzer);
      }

      if (!args.force) {
        const freshness = await readIndexFreshness(projectRoot, analyzer, codebaseRoot, gitHead);
        if (freshness.fresh) {
          return report(analyzer, false, job, {
            ...(discovered ? { discovered: true } : {}),
            message: "The index is fresh; nothing to do. Pass force: true to re-index anyway.",
          });
        }
      }

      const { started, job: current, replaced } = await startIndexJob({
        projectRoot,
        codebaseRoot,
        analyzer,
        force: args.force,
        replaceRunning: args.force,
        spawn: deps.spawn,
        kill: deps.kill,
        drCommand: deps.drCommand,
        isAlive: deps.isAlive,
      });
      return report(analyzer, started, current, {
        ...(discovered ? { discovered: true } : {}),
        ...(replaced ? { replaced } : {}),
      });
    });
  };
}

export const codebaseIndexHandler = createCodebaseIndexHandler();

export const codebaseIndexTool: McpToolDefinition<typeof inputSchema> = {
  name: "codebase_index",
  description:
    "Index the project's code with the code analyzer (codebase-memory-mcp) in the background. Returns at once " +
    "with the job ({state: running|done|failed, startedAt, finishedAt, error, progress, logPath}); it never " +
    "waits for the index. Poll with status: true until job.state is done or failed. A call while a run is in " +
    "flight returns that run; force: true stops it and starts over. Skips a fresh index unless force: true. Selects an installed analyzer if none is. " +
    "Writes only .dr/analyzers/, never the model.",
  inputSchema,
  handler: codebaseIndexHandler,
};
