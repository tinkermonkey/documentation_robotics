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
 * - `watchRunningCode` records what is installed when a process starts and says later whether it
 *   changed since. Drift already there at start (a dev checkout bumped without a rebuild, an
 *   npm-linked checkout, a skewed clock) is reported once and never refused or restarted on.
 * - `assertRunningCodeInstalled` refuses a base-model write once the installed CLI changed since
 *   the start. It is off until `enableRunningCodeGuard` turns it on, which only the central process
 *   does: a short-lived dr command has just loaded the installed code, and a test process must not
 *   trip on a rebuild. `withRunningCodeChecked` checks once for a whole commit, so a change partway
 *   through never leaves a landing half written.
 * - A detached central process started with the default options also restarts itself when the
 *   CLI changed and nothing a restart would cut is using it (central-lifetime.ts, `centralStaleReason`).
 */

import { AsyncLocalStorage } from "node:async_hooks";
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

/**
 * How the installed CLI changed since `baseline`, what was installed when the process started:
 * another version, or its files written since. Null when it didn't, or either can't be read.
 * Comparing two reads of the same files, it never mistakes drift there at start, or a skewed
 * clock, for a change.
 */
export function installedChangedSince(
  baseline: InstalledCli | null,
  current: InstalledCli | null,
  running: string = getCliVersion()
): RunningCodeDrift | null {
  if (!baseline || !current) return null;
  if (current.version !== baseline.version) return { reason: "version", running, installed: current };
  if (current.modifiedAt !== undefined && baseline.modifiedAt !== undefined && current.modifiedAt > baseline.modifiedAt) {
    return { reason: "rewritten", running, installed: current, changedAt: new Date(current.modifiedAt).toISOString() };
  }
  return null;
}

/** What a long-lived process records about its code when it starts (`watchRunningCode`). */
export interface RunningCodeWatch {
  /** What was installed at start; null when it couldn't be read (then nothing is ever reported). */
  baseline: InstalledCli | null;
  /** Drift already there at start: reported, never guarded or restarted on. */
  driftAtStart: RunningCodeDrift | null;
  /** How the installed CLI changed since the start; null while it hasn't. */
  check: () => Promise<RunningCodeDrift | null>;
}

let startupBaseline: Promise<InstalledCli | null> | undefined;

/**
 * What was installed when this process first loaded this module (read then, once): the baseline
 * the write guard and project_status's server section both compare with, so they always agree.
 */
export function runningCodeBaseline(): Promise<InstalledCli | null> {
  startupBaseline ??= readInstalledCli().catch(() => null);
  return startupBaseline;
}

// Read as the process starts, before anything could be installed over it.
void runningCodeBaseline();

/**
 * This process's baseline (`runningCodeBaseline`, or `read` once, in tests); `check` compares later
 * reads with it.
 */
export async function watchRunningCode(
  options: { read?: () => Promise<InstalledCli | null>; running?: string } = {}
): Promise<RunningCodeWatch> {
  const read = options.read ?? (() => readInstalledCli());
  const running = options.running ?? getCliVersion();
  const baseline = options.read ? await options.read() : await runningCodeBaseline();
  const driftAtStart = await runningCodeDrift({ installed: baseline, running });
  return { baseline, driftAtStart, check: async () => installedChangedSince(baseline, await read(), running) };
}

/** What happened, in a sentence. */
export function describeRunningCodeDrift(drift: RunningCodeDrift): string {
  return drift.reason === "version"
    ? `This DR process runs CLI ${drift.running}, and CLI ${drift.installed.version} is installed now: ` +
        "it started before the CLI changed and still runs the old code"
    : `The dr CLI's files on disk changed at ${drift.changedAt}, after this DR process started (the version is ` +
        `still ${drift.installed.version}): the process runs the code it started with`;
}

/**
 * How to get a process on the installed CLI: the central process serves every dr MCP session of
 * the farm, so restarting one session does not replace it while another uses it.
 */
export const RESTART_DR_PROCESS =
  "Restart the DR process (`dr serve --stop` stops it, with its browser tabs and DrBot turns; the dr MCP " +
  "server then reconnects on the next tool call and starts the installed CLI's process)";

/** The same for a dr MCP server that runs in the client's own process (DR_MCP_IN_PROCESS): no central process to stop. */
export const RESTART_IN_PROCESS =
  "Restart this dr MCP server (reconnect it in the client, or restart the session): it runs in the client's own " +
  "process (DR_MCP_IN_PROCESS), so dr serve --stop does not reach it";

/** How the process answering gets onto the installed CLI: the central process, or an in-process dr MCP server. */
export function restartAdvice(env: NodeJS.ProcessEnv = process.env): string {
  return /^(1|true|yes|on)$/i.test(env.DR_MCP_IN_PROCESS?.trim() ?? "") ? RESTART_IN_PROCESS : RESTART_DR_PROCESS;
}

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

/** How the guard reads drift: a `RunningCodeWatch`'s check in the central process, a fake in tests. */
export type RunningCodeCheck = () => Promise<RunningCodeDrift | null>;

interface Guard {
  check: RunningCodeCheck;
  checkedAt: number;
  drift: RunningCodeDrift | null;
}

let guard: Guard | null = null;

/** A drift check is reused this long; once drift is found it is kept (the process never catches up). */
const GUARD_RECHECK_MS = 2_000;

/** Set while a commit runs inside `withRunningCodeChecked`: its writes were checked once, at its start. */
const checkedForCommit = new AsyncLocalStorage<true>();

/**
 * Turns the write guard on for this process with how it reads drift (the central process passes
 * its `RunningCodeWatch`'s check, at start), or off with `false`.
 */
export function enableRunningCodeGuard(enabled: boolean, check?: RunningCodeCheck): void {
  if (enabled && !check) throw new Error("enableRunningCodeGuard(true) needs the check it reads drift with");
  guard = enabled ? { check: check!, checkedAt: Number.NEGATIVE_INFINITY, drift: null } : null;
}

/**
 * Throws RunningCodeChangedError when the guard is on and the installed CLI changed under this
 * process. Every write to the base model calls it (model.ts), next to assertBaseModelWritable.
 * Inside `withRunningCodeChecked` it passes: that commit was checked at its start.
 */
export async function assertRunningCodeInstalled(now: number = Date.now()): Promise<void> {
  // The guard as it is now: turning it off (or on again) during the await below changes nothing here.
  const current = guard;
  if (!current || checkedForCommit.getStore()) return;
  if (!current.drift && now - current.checkedAt >= GUARD_RECHECK_MS) {
    current.drift = await current.check();
    current.checkedAt = now;
  }
  if (current.drift) throw new RunningCodeChangedError(current.drift);
}

/**
 * Runs a commit with the guard checked once, at its start: refused then, or never during it. A
 * change of the installed CLI partway through can't stop a landing after its changeset is marked
 * committed and before the model is written (#1427).
 */
export async function withRunningCodeChecked<T>(commit: () => Promise<T>): Promise<T> {
  await assertRunningCodeInstalled();
  return checkedForCommit.run(true, commit);
}
