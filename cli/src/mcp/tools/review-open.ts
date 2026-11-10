/**
 * review_open — hand the human a link that opens a changeset on the graph in the viewer.
 *
 * Reuses the `dr visualize` already serving this project (found through the viewer registry,
 * server/viewer-registry.ts) or starts one: a detached `dr visualize --with-changesets
 * --no-browser` run in the project root with this installation's runtime and CLI entry. A viewer
 * it starts keeps running after the session ends, so the human can review at their own pace.
 *
 * DrBot does not get this tool: it already lives in the viewer (coding-agents/drbot-mcp.ts).
 */

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CHANGESET_ONLY_ENV } from "../../core/changeset-only-guard.js";
import { DR_MCP_ROOT_PATH_ENV, resolveDrCommand } from "../../coding-agents/drbot-mcp.js";
import {
  canonicalProjectRoot,
  ensureViewerRecordDir,
  findRunningViewer,
  viewerLogPath,
  viewerUrl,
  type ViewerRecord,
} from "../../server/viewer-registry.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  changeset: z.string().optional().describe("Changeset ID or name. Defaults to the active changeset."),
  rootPath: rootPathSchema,
};

export type ReviewOpenArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** A viewer process review_open started. */
export interface StartedViewer {
  pid?: number;
  /** Settles when the process exits (or fails to start). */
  exited: Promise<{ code: number | null; signal: string | null; error?: string }>;
  /** Where its output goes, for the error when it fails. */
  logPath?: string;
  /** Stops it (used when it never became ready). */
  stop: () => void;
}

export interface ReviewOpenDeps {
  /** Finds the viewer serving a project (pid alive, health answers), else null. */
  findViewer: (projectRoot: string) => Promise<ViewerRecord | null>;
  /** Starts a detached viewer for a project. */
  startViewer: (projectRoot: string) => Promise<StartedViewer>;
  /** How long to wait for a started viewer to record itself and answer (default 20s). */
  timeoutMs: number;
  /** Poll interval while waiting (default 250ms). */
  pollMs: number;
}

/** Starts `dr visualize --with-changesets --no-browser` for the project, detached and unref'd. */
export async function spawnDetachedViewer(projectRoot: string): Promise<StartedViewer> {
  const dr = resolveDrCommand();
  await ensureViewerRecordDir();
  const logPath = viewerLogPath(projectRoot);
  const fd = openSync(logPath, "w", 0o600);

  // The viewer is the human's: their commit must not be refused by an agent's changeset-only
  // mode, and it serves the project it is started in, not a pinned MCP root.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[CHANGESET_ONLY_ENV];
  delete env[DR_MCP_ROOT_PATH_ENV];

  let child;
  try {
    child = spawn(dr.command, [...dr.args, "visualize", "--with-changesets", "--no-browser"], {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
    });
  } finally {
    closeSync(fd);
  }

  const exited = new Promise<{ code: number | null; signal: string | null; error?: string }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
  });
  child.unref();

  const pid = child.pid;
  return {
    pid,
    exited,
    logPath,
    stop: () => {
      if (!pid) return;
      try {
        process.kill(-pid, "SIGTERM"); // its process group: dr visualize and its server
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    },
  };
}

const DEFAULT_DEPS: ReviewOpenDeps = {
  findViewer: (projectRoot) => findRunningViewer(projectRoot),
  startViewer: spawnDetachedViewer,
  timeoutMs: 20_000,
  pollMs: 250,
};

function logTail(logPath: string | undefined, lines = 15): string {
  if (!logPath) return "";
  try {
    return readFileSync(logPath, "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Builds the review_open handler; tests inject the viewer lookup and the spawner. */
export function createReviewOpenHandler(overrides: Partial<ReviewOpenDeps> = {}) {
  const deps: ReviewOpenDeps = { ...DEFAULT_DEPS, ...overrides };
  // One start per project at a time: a second call while a viewer is starting waits for it.
  const starting = new Map<string, Promise<ViewerRecord>>();

  async function startAndWait(projectRoot: string): Promise<ViewerRecord> {
    const started = await deps.startViewer(projectRoot);
    let exit: Awaited<StartedViewer["exited"]> | null = null;
    started.exited.then((info) => {
      exit = info;
    });

    const deadline = Date.now() + deps.timeoutMs;
    while (Date.now() < deadline) {
      const record = await deps.findViewer(projectRoot);
      if (record) return record;
      if (exit) {
        const info = exit as Awaited<StartedViewer["exited"]>;
        const how = info.error ?? (info.signal ? `signal ${info.signal}` : `code ${info.code}`);
        const tail = logTail(started.logPath);
        throw new CLIError(
          `The viewer exited before it was ready (${how})${tail ? `:\n${tail}` : ""}`,
          ErrorCategory.SYSTEM,
          [
            ...(started.logPath ? [`Its output is in ${started.logPath}`] : []),
            `Run "dr visualize" in ${projectRoot} to see the error`,
          ]
        );
      }
      await new Promise((resolve) => setTimeout(resolve, deps.pollMs));
    }
    started.stop();
    throw new CLIError(
      `The viewer did not start within ${deps.timeoutMs >= 1000 ? `${Math.round(deps.timeoutMs / 1000)}s` : `${deps.timeoutMs}ms`}`,
      ErrorCategory.SYSTEM,
      [
        ...(started.logPath ? [`Its output is in ${started.logPath}`] : []),
        `Run "dr visualize" in ${projectRoot} to see what it is waiting on`,
      ]
    );
  }

  async function viewerFor(projectRoot: string): Promise<{ record: ViewerRecord; reused: boolean }> {
    const pending = starting.get(projectRoot);
    if (pending) return { record: await pending, reused: true };

    const running = await deps.findViewer(projectRoot);
    if (running) return { record: running, reused: true };

    const again = starting.get(projectRoot);
    if (again) return { record: await again, reused: true };

    const start = startAndWait(projectRoot).finally(() => starting.delete(projectRoot));
    starting.set(projectRoot, start);
    return { record: await start, reused: false };
  }

  return async function reviewOpenHandler(args: ReviewOpenArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      const projectRoot = canonicalProjectRoot(model.rootPath);
      const manager = new StagingAreaManager(model.rootPath, model);
      const changeset = await resolveChangeset(manager, args.changeset, "changeset");

      const { record, reused } = await viewerFor(projectRoot);
      return jsonResult({
        url: viewerUrl(record, { changesetId: changeset.id }),
        reused,
        port: record.port,
        changesetId: changeset.id,
        changesetName: changeset.name,
      });
    });
  };
}

export const reviewOpenHandler = createReviewOpenHandler();

export const reviewOpenTool: McpToolDefinition<typeof inputSchema> = {
  name: "review_open",
  description:
    "Get a link that opens a changeset (by id or name; default the active one) on the graph in the DR viewer, " +
    "for the human to review. Reuses the viewer already running for this project, or starts one " +
    "(dr visualize --with-changesets) that keeps running after this session. Give the human the url; they " +
    "comment on elements there (read them with annotation_list) and commit the changeset there when the work lands.",
  inputSchema,
  handler: (args) => reviewOpenHandler(args),
};
