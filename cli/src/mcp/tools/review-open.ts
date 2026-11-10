/**
 * review_open — hand the human a link that opens a changeset on the graph in the viewer.
 *
 * Reuses the `dr visualize` already serving this project (found through the viewer registry,
 * server/viewer-registry.ts) or starts one: a detached `dr visualize --with-changesets
 * --no-browser` run in the project root with this installation's runtime and CLI entry. A viewer
 * it starts keeps running after the session ends, so the human can review at their own pace.
 *
 * Never two viewers for one project: a viewer whose process is alive but doesn't answer is
 * reported, not replaced, and one still loading its model (a `.starting` marker next to the
 * record) is waited for, not started again. A viewer that is slow to load is left running; the
 * call says to try again.
 *
 * DrBot does not get this tool: it already lives in the viewer (coding-agents/drbot-mcp.ts).
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CHANGESET_ONLY_ENV } from "../../core/changeset-only-guard.js";
import { DR_MCP_ROOT_PATH_ENV, resolveDrCommand } from "../../coding-agents/drbot-mcp.js";
import {
  canonicalProjectRoot,
  describePortHolder,
  ensureViewerRecordDir,
  isProcessAlive,
  probeViewer,
  readViewerStarting,
  removeViewerStarting,
  viewerLogPath,
  viewerUrl,
  writeViewerStarting,
  type ViewerProbe,
  type ViewerRecord,
  type ViewerStarting,
} from "../../server/viewer-registry.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  changeset: z.string().optional().describe("Changeset ID or name. Defaults to the active changeset."),
  rootPath: rootPathSchema,
};

export type ReviewOpenArgs = z.infer<z.ZodObject<typeof inputSchema>>;

type ExitInfo = { code: number | null; signal: string | null; error?: string };

/** A viewer process review_open started. */
export interface StartedViewer {
  pid?: number;
  /** Settles when the process exits (or fails to start). */
  exited: Promise<ExitInfo>;
  /** Where its output goes, for the error when it fails. */
  logPath?: string;
}

export interface ReviewOpenDeps {
  /** What the registry says about the project's viewer (running, unreachable, none). */
  probeViewer: (projectRoot: string) => Promise<ViewerProbe>;
  /** A viewer another call started that is still loading, if its process is alive. */
  readStarting: (projectRoot: string) => Promise<ViewerStarting | null>;
  /** Starts a detached viewer for a project, from a port when given (default: from 8080). */
  startViewer: (projectRoot: string, options?: { port?: number }) => Promise<StartedViewer>;
  /** Says what holds a port, for the error when every port tried was taken. */
  describePortHolder: (port: number) => Promise<string>;
  /** How many viewers to start, each from the next port, when one finds its port taken (default 3). */
  portAttempts: number;
  /** Whether a pid is alive (for a viewer another process started). */
  isAlive: (pid: number) => boolean;
  /** How long one call waits for a starting viewer before saying "call again" (default 60s). */
  timeoutMs: number;
  /** How long a started viewer is watched in the background before the watch gives up (default 10min). */
  watchMs: number;
  /** Poll interval while waiting (default 250ms). */
  pollMs: number;
}

/**
 * Starts `dr visualize --with-changesets --no-browser` for the project, detached and unref'd.
 * dr visualize takes the first port that is free from 8080, or from `port` when given.
 */
export async function spawnDetachedViewer(projectRoot: string, options: { port?: number } = {}): Promise<StartedViewer> {
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
    const portArgs = options.port !== undefined ? ["--port", String(options.port)] : [];
    child = spawn(dr.command, [...dr.args, "visualize", "--with-changesets", "--no-browser", ...portArgs], {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", fd, fd],
      env,
    });
  } finally {
    closeSync(fd);
  }

  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
  });
  child.unref();
  return { pid: child.pid, exited, logPath };
}

const DEFAULT_DEPS: ReviewOpenDeps = {
  probeViewer: (projectRoot) => probeViewer(projectRoot),
  readStarting: (projectRoot) => readViewerStarting(projectRoot),
  startViewer: spawnDetachedViewer,
  describePortHolder: (port) => describePortHolder(port),
  portAttempts: 3,
  isAlive: isProcessAlive,
  timeoutMs: 60_000,
  watchMs: 10 * 60_000,
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

function logSuggestion(logPath: string | undefined): string[] {
  return logPath ? [`Its output is in ${logPath}`] : [];
}

/** A viewer that exited before it answered, with the end of its output. */
class ViewerExitedError extends CLIError {
  constructor(
    message: string,
    readonly tail: string,
    logPath: string | undefined
  ) {
    super(message, ErrorCategory.SYSTEM, logSuggestion(logPath));
  }
}

/** The port a viewer's output says was taken, if that is why it exited. */
export function portInUse(output: string): number | null {
  const match = /Port (\d+) is already in use/.exec(output);
  return match ? Number(match[1]) : null;
}

/** A viewer that is starting: its pid, its log, and a watch that settles when it is ready. */
interface PendingStart {
  pid?: number;
  logPath?: string;
  /** Resolves with the record once the viewer answers; null if the watch gave up; rejects if it exited. */
  ready: Promise<ViewerRecord | null>;
}

/** Builds the review_open handler; tests inject the registry lookups and the spawner. */
export function createReviewOpenHandler(overrides: Partial<ReviewOpenDeps> = {}) {
  const deps: ReviewOpenDeps = { ...DEFAULT_DEPS, ...overrides };
  // Viewers this server is watching start, per project.
  const pending = new Map<string, PendingStart>();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Polls until the viewer answers (record), it exits (throws), or the watch gives up (null). */
  async function watch(
    projectRoot: string,
    viewer: { pid?: number; logPath?: string; exited?: Promise<ExitInfo> }
  ): Promise<ViewerRecord | null> {
    let exit: ExitInfo | null = null;
    viewer.exited?.then((info) => {
      exit = info;
    });
    const giveUpAt = Date.now() + deps.watchMs;
    while (Date.now() < giveUpAt) {
      const probe = await deps.probeViewer(projectRoot);
      if (probe.state === "running") return probe.record;
      const gone = exit ?? (!viewer.exited && viewer.pid && !deps.isAlive(viewer.pid) ? { code: null, signal: null } : null);
      if (gone) {
        const info = gone as ExitInfo;
        const how = info.error ?? (info.signal ? `signal ${info.signal}` : info.code !== null ? `code ${info.code}` : "");
        const tail = logTail(viewer.logPath);
        throw new ViewerExitedError(
          `The viewer exited before it was ready${how ? ` (${how})` : ""}${tail ? `:\n${tail}` : ""}`,
          tail,
          viewer.logPath
        );
      }
      await sleep(deps.pollMs);
    }
    return null;
  }

  function track(projectRoot: string, viewer: { pid?: number; logPath?: string; exited?: Promise<ExitInfo> }): PendingStart {
    const ready = watch(projectRoot, viewer).finally(() => {
      if (pending.get(projectRoot)?.ready === ready) pending.delete(projectRoot);
      if (viewer.pid) void removeViewerStarting(projectRoot, { pid: viewer.pid });
    });
    // The watch outlives a caller that timed out; nobody may be awaiting it when it settles.
    ready.catch(() => {});
    const entry = { pid: viewer.pid, logPath: viewer.logPath, ready };
    pending.set(projectRoot, entry);
    return entry;
  }

  /** Waits up to timeoutMs for a starting viewer; still loading means "call again", not a kill. */
  async function awaitReady(entry: PendingStart): Promise<ViewerRecord> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), deps.timeoutMs);
    });
    try {
      const result = await Promise.race([entry.ready, timedOut]);
      if (result && result !== "timeout") return result;
    } finally {
      clearTimeout(timer);
    }
    throw new CLIError(
      `The viewer is still starting (pid ${entry.pid ?? "unknown"}); it is loading the model. Call review_open again in a moment.`,
      ErrorCategory.SYSTEM,
      logSuggestion(entry.logPath)
    );
  }

  /** Every port a viewer tried was taken: say what holds the last one. */
  async function portTakenError(port: number, logPath: string | undefined): Promise<CLIError> {
    const holder = await deps.describePortHolder(port);
    return new CLIError(
      `Could not start a viewer for this project: port ${port} is held by ${holder}, and the ports tried before it were taken too.`,
      ErrorCategory.SYSTEM,
      [...logSuggestion(logPath), `Free a port (stop ${holder}, if it is not needed) and call review_open again`]
    );
  }

  function unreachable(record: ViewerRecord, projectRoot: string): CLIError {
    const logPath = viewerLogPath(projectRoot);
    return new CLIError(
      `The viewer for this project (pid ${record.pid}, port ${record.port}) is running but does not answer its health check`,
      ErrorCategory.SYSTEM,
      [
        ...(existsSync(logPath) ? [`Its output is in ${logPath}`] : []),
        `Wait and call review_open again, or stop it (kill ${record.pid}) and call review_open to start a fresh one`,
      ]
    );
  }

  async function viewerFor(projectRoot: string): Promise<{ record: ViewerRecord; reused: boolean }> {
    const inFlight = pending.get(projectRoot);
    if (inFlight) return { record: await awaitReady(inFlight), reused: true };

    const probe = await deps.probeViewer(projectRoot);
    if (probe.state === "running") return { record: probe.record, reused: true };
    if (probe.state === "unreachable") throw unreachable(probe.record, projectRoot);

    // Another call (this server's or another session's) may have started one that is still loading.
    const again = pending.get(projectRoot);
    if (again) return { record: await awaitReady(again), reused: true };
    const marker = await deps.readStarting(projectRoot);
    const meanwhile = pending.get(projectRoot); // a concurrent call may have registered during that read
    if (meanwhile) return { record: await awaitReady(meanwhile), reused: true };
    if (marker) {
      const entry = track(projectRoot, { pid: marker.pid, logPath: marker.logPath });
      return { record: await awaitReady(entry), reused: true };
    }

    // Register before the first await so a concurrent call waits on this start.
    let resolveStart!: (viewer: StartedViewer) => void;
    let rejectStart!: (error: unknown) => void;
    const started = new Promise<StartedViewer>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    const ready = started.then(async (first) => {
      let viewer = first;
      for (let attempt = 1; ; attempt++) {
        if (viewer.pid) {
          await writeViewerStarting(projectRoot, {
            pid: viewer.pid,
            startedAt: new Date().toISOString(),
            ...(viewer.logPath ? { logPath: viewer.logPath } : {}),
          }).catch(() => {});
        }
        try {
          return await watch(projectRoot, viewer);
        } catch (error) {
          // Another process took the port between the viewer's free-port check and its bind:
          // start another from the next port.
          const taken = error instanceof ViewerExitedError ? portInUse(error.tail) : null;
          if (taken === null) throw error;
          if (attempt >= deps.portAttempts) throw await portTakenError(taken, viewer.logPath);
          viewer = await deps.startViewer(projectRoot, { port: taken + 1 });
          entry.pid = viewer.pid;
          entry.logPath = viewer.logPath;
        }
      }
    });
    const entry: PendingStart = { ready };
    pending.set(projectRoot, entry);
    ready.catch(() => {});
    void ready
      .finally(() => {
        if (pending.get(projectRoot) === entry) pending.delete(projectRoot);
        if (entry.pid) void removeViewerStarting(projectRoot, { pid: entry.pid });
      })
      .catch(() => {});

    try {
      const viewer = await deps.startViewer(projectRoot);
      entry.pid = viewer.pid;
      entry.logPath = viewer.logPath;
      resolveStart(viewer);
    } catch (error) {
      rejectStart(error);
      throw error;
    }
    return { record: await awaitReady(entry), reused: false };
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
    "comment on elements there (read them with annotation_list) and commit the changeset there when the work lands. " +
    "If it says the viewer is still starting, call it again.",
  inputSchema,
  handler: (args) => reviewOpenHandler(args),
};
