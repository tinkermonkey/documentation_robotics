/**
 * review_open — hand the human a link that opens a changeset on the graph in the viewer.
 *
 * Reuses the `dr visualize` already serving this project (found through the viewer registry,
 * server/viewer-registry.ts) or starts one: a detached `dr visualize --with-changesets
 * --no-browser` run in the project root with this installation's runtime and CLI entry. A viewer
 * it starts keeps running after the session ends, so the human can review at their own pace. It
 * ends on its own after 24 hours with no browser tab connected and no request
 * (DR_VIEWER_IDLE_HOURS; 0 means never), or when its project folder is gone.
 *
 * A running viewer keeps the code it started with, so after a CLI upgrade the viewer is older
 * than the CLI asking for it (#1237). review_open compares the viewer's cliVersion (from its
 * health check) with its own. An older viewer is replaced without asking only when review_open
 * started it and it reports that no browser tab is connected; the new one takes its port and
 * token, so links already given keep working. Any other older viewer (a tab is open, a person
 * runs it in a terminal, it does not say who started it or how many tabs it has) is reused, with
 * a notice; `restart: true` replaces it.
 *
 * Replacing a viewer means stopping it, and a pid is signalled only once it is confirmed to be
 * that viewer's (server/viewer-control.ts). A viewer that cannot be confirmed is never
 * signalled: review_open says so and starts no second viewer beside one that still answers.
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
  EXIT_WITH_PARENT_ENV,
  VIEWER_STARTED_BY_ENV,
  canonicalProjectRoot,
  describePortHolder,
  ensureViewerRecordDir,
  isProcessAlive,
  probeViewer,
  readViewerStarting,
  removeViewerRecord,
  removeViewerStarting,
  viewerLogPath,
  viewerUrl,
  writeViewerStarting,
  type ViewerProbe,
  type SweepResult,
  type ViewerRecord,
  type ViewerStarting,
} from "../../server/viewer-registry.js";
import { isOlderViewer, stopRecordedViewer, type StopRecordedResult } from "../../server/viewer-control.js";
import { ignoredViewerSettings, viewerSetting } from "../../server/viewer-settings.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

const inputSchema = {
  changeset: z.string().optional().describe("Changeset ID or name. Defaults to the active changeset."),
  restart: z
    .boolean()
    .optional()
    .describe(
      "Replace the viewer running for this project with a fresh one (same port and token when they are free). " +
        "Use it when review_open says the viewer is older than this CLI or does not answer; it ends any chat running in that viewer, so ask the user first."
    ),
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
  startViewer: (projectRoot: string, options?: StartViewerOptions) => Promise<StartedViewer>;
  /**
   * Stops a running viewer and waits for it to be gone (to replace it). Says what happened: a
   * viewer whose pid could not be confirmed, or that belongs to someone else, is not signalled.
   */
  stopViewer: (record: ViewerRecord) => Promise<StopRecordedResult>;
  /** Removes a viewer's record (one that was not stopped because it could not be confirmed, and does not answer). */
  forgetViewer: (record: ViewerRecord) => Promise<void>;
  /** This CLI's version, compared with the running viewer's. */
  cliVersion: string;
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

export interface StartViewerOptions {
  /** The first port to try (default 8080). */
  port?: number;
  /** The auth token to serve with, when replacing a viewer whose links should keep working. */
  token?: string;
}

/** The idle limit, in hours, for a viewer review_open starts: DR_VIEWER_IDLE_HOURS, else 24 (0: never). */
export function viewerIdleHours(env: NodeJS.ProcessEnv = process.env): number {
  return viewerSetting("idleHours", env);
}

/**
 * Starts `dr visualize --with-changesets --no-browser --idle-exit <hours>` for the project,
 * detached and unref'd, marked as started by review_open. dr visualize takes the first port that
 * is free from 8080, or from `port` when given.
 */
export async function spawnDetachedViewer(projectRoot: string, options: StartViewerOptions = {}): Promise<StartedViewer> {
  const dr = resolveDrCommand();
  await ensureViewerRecordDir();
  const logPath = viewerLogPath(projectRoot);
  const fd = openSync(logPath, "w", 0o600);

  // The viewer is the human's: their commit must not be refused by an agent's changeset-only
  // mode, and it serves the project it is started in, not a pinned MCP root.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[CHANGESET_ONLY_ENV];
  delete env[DR_MCP_ROOT_PATH_ENV];
  // It outlives this session by design, whatever started the MCP server.
  delete env[EXIT_WITH_PARENT_ENV];
  env[VIEWER_STARTED_BY_ENV] = "review_open";
  // The token goes in the environment, not the arguments, which any user can read with ps.
  if (options.token) env.DR_AUTH_TOKEN = options.token;
  else delete env.DR_AUTH_TOKEN;

  let child;
  try {
    const portArgs = options.port !== undefined ? ["--port", String(options.port)] : [];
    const idleHours = viewerIdleHours();
    const idleArgs = idleHours > 0 ? ["--idle-exit", String(idleHours)] : [];
    child = spawn(dr.command, [...dr.args, "visualize", "--with-changesets", "--no-browser", ...idleArgs, ...portArgs], {
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
  stopViewer: (record) => stopRecordedViewer(record),
  forgetViewer: async (record) => {
    await removeViewerRecord(record.projectRoot, { pid: record.pid });
  },
  cliVersion: getCliVersion(),
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
        `Wait and call review_open again, or call it with restart: true to replace that viewer with a fresh one`,
      ]
    );
  }

  /** Why a running viewer was replaced, for the result. */
  type Replaced = {
    pid: number;
    port: number;
    cliVersion: string | null;
    reason: "older" | "restart";
    /** False when the old viewer was not signalled: its pid could not be confirmed, so only its record was dropped. */
    stopped?: boolean;
    note?: string;
  };
  /** What to do with a viewer to be replaced whose pid cannot be confirmed. */
  type Unconfirmed = "refuse" | "forget";
  interface ViewerChoice {
    record: ViewerRecord;
    reused: boolean;
    /** The reused viewer's CLI version, when its health check gave one. */
    viewerCliVersion?: string;
    /** Browser tabs connected to the reused viewer, when it reports them (since 0.7.0). */
    viewerClients?: number;
    /** The reused viewer is older than this CLI and was left running. */
    outdated?: boolean;
    replaced?: Replaced;
    /** What reading the registry removed (stale records, old logs), when it removed anything. */
    swept?: SweepResult;
  }

  /**
   * Starts a viewer and waits for it. Registered in `pending` before the first await, so a
   * concurrent call waits on this start. `replace` is stopped first; the new viewer then takes
   * its port and token, so links to the old one keep working. When `replace` could not be
   * stopped, nothing is started beside it: the call fails and says why, unless the old viewer
   * does not answer either (`unconfirmed: "forget"`), in which case its record is dropped, it is
   * left unsignalled, and `replaced` says so.
   */
  async function startNew(
    projectRoot: string,
    replace?: ViewerRecord,
    unconfirmed: Unconfirmed = "refuse",
    replaced?: Replaced
  ): Promise<ViewerRecord> {
    const startOptions: StartViewerOptions = replace
      ? { port: replace.port, ...(replace.token ? { token: replace.token } : {}) }
      : {};
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
          viewer = await deps.startViewer(projectRoot, { ...startOptions, port: taken + 1 });
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
      if (replace) {
        if (replaced?.reason === "older") {
          // Not asked for: replaced only while nobody is looking at it. A tab may have opened since
          // the first probe, so ask again just before stopping it.
          const now = await deps.probeViewer(projectRoot);
          const stillUnattended = now.state === "running" && now.record.pid === replace.pid && now.health?.clients === 0;
          if (!stillUnattended) {
            throw new CLIError("A browser tab connected to the viewer before it could be replaced; it was left running.", ErrorCategory.SYSTEM);
          }
        }
        const stop = await deps.stopViewer(replace);
        const which = `pid ${replace.pid}, port ${replace.port}`;
        if (stop.outcome === "timed-out") {
          throw new CLIError(
            `The viewer for this project (${which}) did not exit in time and its pid could not be checked again, so it was not killed and not replaced.`,
            ErrorCategory.SYSTEM
          );
        }
        if (stop.outcome === "not-permitted") {
          throw new CLIError(
            `The viewer for this project (${which}) belongs to another user and could not be stopped, so it was not replaced.`,
            ErrorCategory.SYSTEM
          );
        }
        if (stop.outcome === "unverified") {
          if (unconfirmed === "refuse") {
            throw new CLIError(
              `The viewer for this project (${which}) was not replaced: its pid could not be confirmed to be that viewer ` +
                `(${stop.reason ?? "unknown"}), so nothing was signalled, and no second viewer was started beside it.`,
              ErrorCategory.SYSTEM,
              ["Its link still works. To replace it, the user stops it themselves (it is theirs to end) and calls review_open again"]
            );
          }
          await deps.forgetViewer(replace);
          if (replaced) {
            replaced.stopped = false;
            replaced.note =
              `The old viewer (${which}) does not answer and its pid could not be confirmed to be that viewer ` +
              `(${stop.reason ?? "unknown"}), so it was not signalled. Its record was dropped; if it is still running, it is left as it is.`;
          }
        } else if (replaced) {
          replaced.stopped = true;
        }
      }
      const viewer = await deps.startViewer(projectRoot, startOptions);
      entry.pid = viewer.pid;
      entry.logPath = viewer.logPath;
      resolveStart(viewer);
    } catch (error) {
      rejectStart(error);
      throw error;
    }
    return awaitReady(entry);
  }

  async function viewerFor(projectRoot: string, restart: boolean): Promise<ViewerChoice> {
    const inFlight = pending.get(projectRoot);
    if (inFlight) return { record: await awaitReady(inFlight), reused: true };

    const probe = await deps.probeViewer(projectRoot);
    const choice = await chooseViewer(projectRoot, restart, probe);
    return probe.swept ? { ...choice, swept: probe.swept } : choice;
  }

  async function chooseViewer(projectRoot: string, restart: boolean, probe: ViewerProbe): Promise<ViewerChoice> {
    // A concurrent call may have registered a start (or a replacement) during the probe.
    const again = pending.get(projectRoot);
    if (again) return { record: await awaitReady(again), reused: true };

    if (probe.state === "running") {
      const older = isOlderViewer(probe.cliVersion, deps.cliVersion);
      const clients = probe.health?.clients;
      // Replaced without asking only when review_open started it (nobody's terminal runs it) and
      // it says no browser tab is connected (nobody is looking at it). A viewer that does not
      // report its tabs (before 0.7.0) may have one open, so it is left and the notice given.
      const unattended = probe.record.startedBy === "review_open" && clients === 0;
      if (restart || (older && unattended)) {
        const replaced: Replaced = {
          pid: probe.record.pid,
          port: probe.record.port,
          cliVersion: probe.cliVersion ?? null,
          reason: restart ? "restart" : "older",
        };
        try {
          return { record: await startNew(projectRoot, probe.record, "refuse", replaced), reused: false, replaced };
        } catch (error) {
          // Not asked for, and not possible: the viewer is still there, so give its link and the notice.
          if (restart) throw error;
        }
      }
      return {
        record: probe.record,
        reused: true,
        ...(probe.cliVersion ? { viewerCliVersion: probe.cliVersion } : {}),
        ...(clients !== undefined ? { viewerClients: clients } : {}),
        ...(older ? { outdated: true } : {}),
      };
    }
    if (probe.state === "unreachable") {
      if (!restart) throw unreachable(probe.record, projectRoot);
      const replaced: Replaced = { pid: probe.record.pid, port: probe.record.port, cliVersion: null, reason: "restart" };
      return { record: await startNew(projectRoot, probe.record, "forget", replaced), reused: false, replaced };
    }

    // Another session may have started one that is still loading.
    const marker = await deps.readStarting(projectRoot);
    const meanwhile = pending.get(projectRoot); // a concurrent call may have registered during that read
    if (meanwhile) return { record: await awaitReady(meanwhile), reused: true };
    if (marker) {
      const entry = track(projectRoot, { pid: marker.pid, logPath: marker.logPath });
      return { record: await awaitReady(entry), reused: true };
    }

    return { record: await startNew(projectRoot), reused: false };
  }

  /** What to tell the human about a viewer that is older than this CLI and was left running. */
  function outdatedNotice(viewerCliVersion: string | undefined, clients: number | undefined): string {
    const theirs = viewerCliVersion ? `CLI ${viewerCliVersion}` : "a CLI older than 0.6.0";
    const tabs =
      clients === undefined
        ? ""
        : clients > 0
          ? ` ${clients === 1 ? "A browser tab is" : `${clients} browser tabs are`} connected to it.`
          : " No browser tab is connected to it.";
    return (
      `This viewer runs ${theirs}; this CLI is ${deps.cliVersion}, so the viewer lacks its fixes.${tabs} ` +
      `To replace it, ask the user, then call review_open with restart: true. ` +
      `That ends any chat running in the viewer; the link stays the same when its port is still free.`
    );
  }

  return async function reviewOpenHandler(args: ReviewOpenArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      const projectRoot = canonicalProjectRoot(model.rootPath);
      const manager = new StagingAreaManager(model.rootPath, model);
      const changeset = await resolveChangeset(manager, args.changeset, "changeset");

      const choice = await viewerFor(projectRoot, args.restart === true);
      const { record, reused } = choice;
      return jsonResult({
        url: viewerUrl(record, { changesetId: changeset.id }),
        reused,
        port: record.port,
        changesetId: changeset.id,
        changesetName: changeset.name,
        ...(choice.viewerCliVersion ? { viewerCliVersion: choice.viewerCliVersion } : {}),
        ...(choice.viewerClients !== undefined ? { viewerClients: choice.viewerClients } : {}),
        ...(choice.outdated
          ? {
              outdated: true,
              cliVersion: deps.cliVersion,
              notice: outdatedNotice(choice.viewerCliVersion, choice.viewerClients),
            }
          : {}),
        // A viewer review_open starts has an idle limit: say what it is, and say when the
        // setting for it held something that could not be used.
        ...(reused ? {} : { idleExitHours: viewerIdleHours() }),
        ...(ignoredViewerSettings().length > 0 ? { settingsIgnored: ignoredViewerSettings() } : {}),
        ...(choice.replaced ? { replaced: choice.replaced } : {}),
        // Reading the registry cleans it; say so when it did, rather than do it unseen.
        ...(choice.swept
          ? {
              staleRemoved: {
                records: choice.swept.records,
                startingMarkers: choice.swept.markers,
                logs: choice.swept.logs,
                tempFiles: choice.swept.tempFiles,
              },
            }
          : {}),
      });
    });
  };
}

export const reviewOpenHandler = createReviewOpenHandler();

export const reviewOpenTool: McpToolDefinition<typeof inputSchema> = {
  name: "review_open",
  description:
    "Get a link that opens a changeset (by id or name; default the active one) on the graph in the DR viewer, " +
    "for the human to review. Reuses the viewer already running for this project, or starts one on a free " +
    "local port that keeps running after this session (it exits on its own after a day with no browser tab " +
    "connected). A viewer older than this CLI is replaced when review_open started it and no browser tab is " +
    "connected to it; otherwise the result has outdated: true and a notice to relay, and restart: true " +
    "replaces it. A viewer is stopped only when its pid is confirmed to be that viewer's; if it is not, " +
    "the call says so and nothing is signalled. staleRemoved counts what " +
    "reading the viewer registry cleaned up (records and logs of viewers that are gone). " +
    "It returns a link, or says what holds the port; never " +
    "send the human to the CLI. Give the human the url; they comment on elements there, including ones the plan " +
    "adds (read them with annotation_list, answer with annotation_reply) and commit the changeset there when the " +
    "work lands. If it says the viewer is still starting, call it again.",
  inputSchema,
  handler: (args) => reviewOpenHandler(args),
};
