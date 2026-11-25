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
 *   DR_FARM_PATH, ...      the farm, as `resolveFarm` reads it (from this process's cwd)
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
import { resolveFarm } from "./core/project-registry.js";
import { startOptionsFromEnv } from "./commands/serve.js";
import { resolveChatMode } from "./commands/visualize.js";
import { getErrorMessage } from "./utils/errors.js";
import { getCliVersion } from "./utils/spec-version.js";

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

async function main(): Promise<void> {
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
    running = await runCentralProcess({
      farm,
      startServer: await loadStartCentralServer(),
      port: start.port,
      serverOptions: {
        ...(start.viewerPath ? { viewerPath: start.viewerPath } : {}),
        ...resolveChatMode(start),
      },
      launcherPid: positiveInt(process.env.DR_SERVE_LAUNCHER_PID),
      cliVersion: getCliVersion(),
      onIdleExit: () => void shutdown(0),
    });
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
