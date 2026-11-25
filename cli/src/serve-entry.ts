/**
 * The central DR process (`dr serve`, issue 1279): one per farm, serving every project and
 * checkout the farm lists. `dr serve` spawns this file (detached, or attached with --foreground)
 * with the runtime that runs the CLI. See server/central-lifetime.ts for what it does.
 *
 * Environment, set by `dr serve`:
 *   DR_SERVE_PORT          where the port search starts (default 8080)
 *   DR_SERVE_VIEWER_PATH   a custom viewer build to serve instead of the bundled one
 *   DR_SERVE_WITH_DANGER   "1": DrBot may also land and delete
 *   DR_SERVE_READ_ONLY     "1": DrBot reads only (the default is changeset staging)
 *   DR_SERVE_LAUNCHER_PID  the `dr serve` process that started this one
 *   DR_SERVE_EXACT_PORT    "1": listen on DR_SERVE_PORT itself or fail (an isolated process)
 *   DR_SERVE_TOKEN_FILE    a file whose first line is the token to use instead of a new one
 *   DR_SERVE_NO_SWEEP      "1": no start-up sweep of per-project viewers
 *   DR_SERVE_READY_JSON    "1": print one JSON line on stdout once it serves (pid, port, url, farmRoot,
 *                          projects with their checkout keys); everything else it logs goes to stderr
 *   DR_SERVE_FOREGROUND    "1": attached to a terminal, so it never restarts itself
 *   DR_STATE_DIR           where its record, token and log go (an isolated process's own folder)
 *   DR_FARM_PATH, ...      the farm, as `resolveFarm` reads it (from this process's cwd)
 *
 * It turns on the running-code guard (utils/running-code.ts): once the CLI installed where it was
 * loaded from changes since it started, it refuses to write the model. Started detached with the
 * default options, it also stops for a restart as soon as nothing a restart would cut is using it;
 * otherwise it keeps running and says to restart it by hand (#1427).
 *
 * For tests only:
 *   DR_SERVE_TEST_STARTER  path of a module whose `startCentralServer` replaces the real one,
 *                          so the process can be run end to end against a fake server.
 */

import type { StartCentralServer } from "./server/central-server-contract.js";
import {
  CentralProcessRunningError,
  EXIT_ALREADY_RUNNING,
  runCentralProcess,
  SERVE_TEST_STARTER_ENV,
  type CentralProcess,
} from "./server/central-lifetime.js";
import { loadFarm, ProjectRegistry, resolveFarm } from "./core/project-registry.js";
import { entryRunOptionsFromEnv, readTokenFile, restartsItselfWhenStale, startOptionsFromEnv } from "./commands/serve.js";
import { resolveChatMode } from "./commands/visualize.js";
import { getErrorMessage } from "./utils/errors.js";
import { getCliVersion } from "./utils/spec-version.js";
import { describeRunningCodeDrift, enableRunningCodeGuard, watchRunningCode } from "./utils/running-code.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

/**
 * The server to run. The real one, `startCentralServer` in server/central-server.ts, is built in
 * parallel (slice 2A); it is loaded by path at run time so this file builds without it.
 */
async function loadStartCentralServer(): Promise<StartCentralServer> {
  const override = process.env[SERVE_TEST_STARTER_ENV];
  const specifier: string = override || "./server/central-server.js";
  const module = (await import(specifier)) as { startCentralServer?: StartCentralServer };
  if (typeof module.startCentralServer !== "function") {
    throw new Error(`${specifier} has no startCentralServer`);
  }
  return module.startCentralServer;
}

function positiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

let running: CentralProcess | null = null;
let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // process.exit follows: the file watchers are left to it (#1235).
    if (running) await running.stop({ processExiting: true });
    if (isTelemetryEnabled) {
      const { shutdownTelemetry } = await import("./telemetry/index.js");
      await shutdownTelemetry();
    }
  } catch (error) {
    console.error(`[serve] Error while stopping: ${getErrorMessage(error)}`);
  } finally {
    process.exit(exitCode);
  }
}

/** One line a script reads on stdout once the process serves (`--foreground --json`), as JSON. */
function printReady(ready: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(ready)}\n`);
}

/** The farm's projects and their present checkouts' keys, for the ready line. */
async function readyProjects(farm: Awaited<ReturnType<typeof resolveFarm>>): Promise<Array<{ project: string; checkouts: string[] }>> {
  try {
    const registry = ProjectRegistry.fromManifest(farm, await loadFarm(farm, { create: false }));
    return (await registry.listProjects()).map((entry) => ({
      project: entry.name,
      checkouts: entry.checkouts.filter((checkout) => checkout.state === "present").map((checkout) => checkout.key),
    }));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const run = entryRunOptionsFromEnv(process.env);
  // With --json, stdout carries the ready line alone: everything else this process logs goes to stderr.
  if (run.readyJson) {
    console.log = console.error;
    console.info = console.error;
  }

  process.on("SIGINT", () => {
    console.log("[serve] SIGINT: stopping");
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    console.log("[serve] SIGTERM: stopping");
    void shutdown(0);
  });
  process.on("uncaughtException", (error) => {
    console.error("[serve] Uncaught exception:", error);
    void shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[serve] Unhandled rejection:", reason);
    void shutdown(1);
  });

  if (isTelemetryEnabled) {
    try {
      const { initTelemetry } = await import("./telemetry/index.js");
      await initTelemetry();
    } catch (error) {
      console.error(`[serve] Telemetry did not start; continuing without it: ${getErrorMessage(error)}`);
    }
  }

  try {
    const farm = await resolveFarm();
    const start = startOptionsFromEnv(process.env);
    // What is installed now is this process's baseline: only a change since then is refused or
    // restarted on. Drift already there (a checkout bumped without a rebuild) is said, once (#1427).
    const code = await watchRunningCode();
    if (code.driftAtStart) {
      console.log(`[serve] Note: ${describeRunningCodeDrift(code.driftAtStart)}. That was so when this process started, so it is not refused or restarted on.`);
    }
    enableRunningCodeGuard(true, code.check);
    running = await runCentralProcess({
      farm,
      startServer: await loadStartCentralServer(),
      port: start.port,
      exactPort: run.exactPort,
      sweep: run.sweep,
      ...(run.tokenFile ? { token: readTokenFile(run.tokenFile) } : {}),
      serverOptions: {
        ...(start.viewerPath ? { viewerPath: start.viewerPath } : {}),
        ...resolveChatMode(start),
      },
      launcherPid: positiveInt(process.env.DR_SERVE_LAUNCHER_PID),
      cliVersion: getCliVersion(),
      staleCheck: code.check,
      restartWhenStale: restartsItselfWhenStale(start, run),
      onIdleExit: () => void shutdown(0),
    });
    if (run.readyJson) {
      const { record } = running;
      printReady({
        ready: true,
        pid: record.pid,
        port: record.port,
        url: `http://127.0.0.1:${record.port}/`,
        farmRoot: record.farmRoot,
        cliVersion: record.cliVersion,
        projects: await readyProjects(farm),
      });
    }
  } catch (error) {
    if (error instanceof CentralProcessRunningError) {
      console.error(`[serve] ${error.message}`);
      shuttingDown = true;
      process.exit(EXIT_ALREADY_RUNNING);
    }
    console.error(`[serve] Could not start: ${getErrorMessage(error)}`);
    await shutdown(1);
  }
}

void main();
