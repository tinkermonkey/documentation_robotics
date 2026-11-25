/**
 * Whether this process runs the dr CLI that is installed (#1427).
 *
 * A long-lived DR process (the central process `dr serve` runs, which also answers every dr MCP
 * session) keeps the code it started with. When the CLI is upgraded in place under it, it goes on
 * answering with the old code, and a landing through it stamps the old `cli_version` and writes
 * the old file layout. Two signs give it away: the version on disk where the process was loaded
 * from differs from the one it was built with, or the installed files were written after it
 * started (the same version installed or built again).
 *
 * - `runningCodeDrift` says which, or null. project_status's server section reads it.
 * - `assertRunningCodeInstalled` refuses a base-model write once it finds drift. It is off until
 *   `enableRunningCodeGuard` turns it on, which only the central process does: a short-lived dr
 *   command has just loaded the installed code, and a test process must not trip on a rebuild.
 * - The central process also restarts itself when it finds drift and only MCP sessions, which the
 *   dr mcp bridge reconnects, are using it (central-lifetime.ts, `centralStaleReason`).
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIError, ErrorCategory } from "./errors.js";
import { getCliVersion } from "./spec-version.js";

/** This module's file, and the package it was loaded from: `<package>/{src,dist}/utils/` → `<package>`. */
const THIS_FILE = fileURLToPath(import.meta.url);
export const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..", "..");

/** The CLI found on disk where this process was loaded from. */
export interface InstalledCli {
  version: string;
  spec: string | null;
  /** When the installed files were last written (ms since the epoch); undefined when that can't be read. */
  modifiedAt?: number;
}

/** A file's modification time in ms, or undefined when it can't be read. */
async function modifiedAt(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The CLI installed where this process was loaded from, read from disk now. A long-lived process
 * keeps the code it started with, so after an upgrade in place this differs from getCliVersion(),
 * and after any install or build its files are newer than the process. Null when the package
 * can't be read (its folder was removed or moved).
 */
export async function readInstalledCli(packageRoot: string = PACKAGE_ROOT): Promise<InstalledCli | null> {
  let version: unknown;
  try {
    version = (JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf-8")) as { version?: unknown }).version;
  } catch {
    return null;
  }
  if (typeof version !== "string" || !version) return null;
  let spec: string | null = null;
  // The tree this process runs from first (dist when built, src under a dev runner), then the other.
  const running = path.relative(PACKAGE_ROOT, THIS_FILE).split(path.sep)[0] === "src" ? "src" : "dist";
  for (const dir of [running, running === "src" ? "dist" : "src"]) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(packageRoot, dir, "schemas", "bundled", "manifest.json"), "utf-8")
      ) as { specVersion?: unknown };
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
    await Promise.all([
      modifiedAt(path.join(packageRoot, "package.json")),
      modifiedAt(path.join(packageRoot, path.relative(PACKAGE_ROOT, THIS_FILE))),
    ])
  ).filter((time): time is number => time !== undefined);
  return { version, spec, ...(times.length > 0 ? { modifiedAt: Math.max(...times) } : {}) };
}

/** Files written this long after the process started are a new install, not this process's own start-up. */
export const STARTUP_MARGIN_MS = 5_000;

/** How the installed CLI differs from the code this process runs. */
export type RunningCodeDrift =
  /** Another version is installed now. */
  | { reason: "version"; running: string; installed: InstalledCli }
  /** The same version, installed or built again after the process started. */
  | { reason: "rewritten"; running: string; installed: InstalledCli; changedAt: string };

export interface RunningCodeOptions {
  /** The installed CLI (default: read from disk now). */
  installed?: InstalledCli | null;
  /** The version this process runs (default: getCliVersion()). */
  running?: string;
  /** When this process started, ms since the epoch (default: from process.uptime()). */
  startedAt?: number;
}

/** How the CLI installed where this process was loaded from differs from the code it runs; null when they agree or the package can't be read. */
export async function runningCodeDrift(options: RunningCodeOptions = {}): Promise<RunningCodeDrift | null> {
  const running = options.running ?? getCliVersion();
  const installed = options.installed !== undefined ? options.installed : await readInstalledCli();
  if (!installed) return null;
  if (installed.version !== running) return { reason: "version", running, installed };
  const startedAt = options.startedAt ?? Date.now() - process.uptime() * 1000;
  if (installed.modifiedAt !== undefined && installed.modifiedAt > startedAt + STARTUP_MARGIN_MS) {
    return { reason: "rewritten", running, installed, changedAt: new Date(installed.modifiedAt).toISOString() };
  }
  return null;
}

/** What happened, in a sentence. */
export function describeRunningCodeDrift(drift: RunningCodeDrift): string {
  return drift.reason === "version"
    ? `This DR process runs CLI ${drift.running}, and CLI ${drift.installed.version} is installed now: ` +
        "it started before the CLI changed and still runs the old code"
    : `The dr CLI's files on disk changed at ${drift.changedAt}, after this DR process started (the version is ` +
        `still ${drift.running}): the process runs the code it started with`;
}

/**
 * How to get a process on the installed CLI: the central process serves every dr MCP session of
 * the farm, so restarting one session does not replace it while another uses it.
 */
export const RESTART_DR_PROCESS =
  "Restart the DR process (`dr serve --stop` stops it, with its browser tabs and DrBot turns; the dr MCP " +
  "server then reconnects on the next tool call and starts the installed CLI's process)";

/** Refused: a write to the base model by a process whose installed CLI changed under it. */
export class RunningCodeChangedError extends CLIError {
  constructor(readonly drift: RunningCodeDrift) {
    super(
      `${describeRunningCodeDrift(drift)}. Nothing was written: the old code would stamp cli_version ` +
        `${drift.running} and write the model in its own layout.`,
      ErrorCategory.USER,
      [`${RESTART_DR_PROCESS}, then make the change again.`]
    );
    this.name = "RunningCodeChangedError";
  }
}

/** How the guard reads drift; replaced in tests. */
export type RunningCodeCheck = () => Promise<RunningCodeDrift | null>;

let guard: { check: RunningCodeCheck; checkedAt: number; drift: RunningCodeDrift | null } | null = null;

/** A drift check is reused this long; once drift is found it is kept (the process never catches up). */
const GUARD_RECHECK_MS = 2_000;

/**
 * Turns the write guard on for this process (the central process does, at start), or off with
 * `false`. `check` replaces how drift is read (tests).
 */
export function enableRunningCodeGuard(enabled: boolean = true, check: RunningCodeCheck = () => runningCodeDrift()): void {
  guard = enabled ? { check, checkedAt: Number.NEGATIVE_INFINITY, drift: null } : null;
}

/**
 * Throws RunningCodeChangedError when the guard is on and the installed CLI changed under this
 * process. Every write to the base model calls it (model.ts), next to assertBaseModelWritable.
 */
export async function assertRunningCodeInstalled(now: number = Date.now()): Promise<void> {
  if (!guard) return;
  if (!guard.drift && now - guard.checkedAt >= GUARD_RECHECK_MS) {
    guard.drift = await guard.check();
    guard.checkedAt = now;
  }
  if (guard.drift) throw new RunningCodeChangedError(guard.drift);
}
