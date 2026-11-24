/**
 * `dr visualize [path]`: open the shared viewer at the checkout `path` (default: the working
 * directory) resolves to (issue 1279, slice 4A; `docs/design/USER_LEVEL_DR.md` section 7).
 *
 * It ensures the farm's central DR process runs (`ensureCentralServer`, which starts `dr serve`
 * detached when none does) and opens the browser at the `ViewerLink` for that checkout. A path
 * no project owns yet is registered first, as an MCP root or `dr farm add` would. It never
 * starts a per-project server and writes no per-project viewer record.
 *
 * `--port`, `--viewer-path`, `--with-danger`, `--read-only` and `--with-changesets` apply only
 * when this call starts the process; when one already runs, a notice says which were not applied.
 * `--no-auth` and `--token` are refused: every route of the central process requires its token
 * (ruling 3). `--list` and `--stop` are in visualize-viewers.ts.
 *
 * (`application.applicationservice.visualize-command`)
 */

import ansis from "ansis";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ResolvedCheckout } from "../core/checkout-types.js";
import { ProjectRegistry } from "../core/project-registry.js";
import type { CentralStartOptions, EnsureCentralServer } from "../server/central-mcp-contract.js";
import { viewerUrl } from "../server/viewer-link.js";
import { CLIError, getErrorMessage } from "../utils/errors.js";
import { isJson, logVerbose } from "../utils/globals.js";
import { findProjectRoot } from "../utils/project-paths.js";

export interface VisualizeOptions {
  /** The folder whose checkout to open (default: the working directory). */
  path?: string;
  /** Where the port search starts (start only). */
  port?: string | number;
  noBrowser?: boolean;
  /** Refused: every route requires the token. */
  noAuth?: boolean;
  /** Refused: the process makes its own token. */
  token?: string;
  /** Start only. */
  withDanger?: boolean;
  /** The old name for the default (changeset staging); start only, and changes nothing. */
  withChangesets?: boolean;
  /** Limit the chat agent to reading the model: no changeset staging (start only). */
  readOnly?: boolean;
  /** Start only. */
  viewerPath?: string;
  /** Refused: the central process has its own idle exit (DR_VIEWER_IDLE_HOURS). */
  idleExit?: string | number;
  /** Refused: the central process is shared, so no one caller's exit ends it. */
  exitWithParent?: boolean;
  json?: boolean;
}

/**
 * Parses an --idle-exit value: hours as a number, 0 for never. Throws on anything else.
 * `dr visualize` refuses --idle-exit now; this stays for the per-project viewer's lifetime tests
 * until slice 4B removes that mode.
 */
export function parseIdleExitHours(value: string | number | undefined): number {
  if (value === undefined || value === "") return 0;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid --idle-exit value: ${value}. Give a number of hours (0 means never).`);
  }
  return hours;
}

/**
 * The chat agent's permission mode for these options. It stages changes in a changeset by default
 * (#1240): --read-only turns that off, and danger mode already allows everything, so it wins over
 * both. --with-changesets is the old name for the default and changes nothing.
 */
export function resolveChatMode(options: Pick<VisualizeOptions, "withDanger" | "readOnly">): {
  withDanger: boolean;
  withChangesets: boolean;
} {
  const withDanger = options.withDanger || false;
  return { withDanger, withChangesets: !withDanger && !options.readOnly };
}

/**
 * Addresses a port must be free on before the central process takes it. It binds the loopback
 * addresses; the wildcards are checked too, because on macOS a loopback bind succeeds while
 * another process holds `*:<port>`, and the two would then share localhost traffic.
 */
const PROBE_HOSTS = ["127.0.0.1", "::1", "0.0.0.0", "::"] as const;

/** Errors that mean "this machine has no such address" (no IPv6), not "the port is taken". */
const NO_ADDRESS_CODES = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

/** Whether nothing listens on the port on any loopback or wildcard address. */
export async function isPortFree(port: number): Promise<boolean> {
  const { createServer } = await import("net");
  for (const host of PROBE_HOSTS) {
    const result = await new Promise<"free" | "taken" | "no-address">((resolvePort) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) =>
        resolvePort(NO_ADDRESS_CODES.has(error.code ?? "") ? "no-address" : "taken")
      );
      server.once("listening", () => server.close(() => resolvePort("free")));
      server.listen(port, host);
    });
    if (result === "taken") return false;
  }
  return true;
}

/** The first port from startPort that is free on every address isPortFree checks. */
export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("No available ports found");
}

/** Everything `dr visualize` touches outside itself, injected for tests. */
export interface VisualizeDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  ensure: EnsureCentralServer;
  openRegistry: (cwd: string, env: NodeJS.ProcessEnv) => Promise<ProjectRegistry>;
  /** Whether a folder holds a DR model (its project root, or null). */
  findProjectRoot: (path: string) => Promise<string | null>;
  openBrowser: (url: string) => void;
  out: (line: string) => void;
}

function defaultOpenBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
    child.on("error", () => logVerbose("Could not open the browser (not critical)"));
    child.unref();
  } catch {
    logVerbose("Could not open the browser (not critical)");
  }
}

async function defaultDeps(): Promise<VisualizeDeps> {
  const { ensureCentralServer } = await import("../server/ensure-central-server.js");
  return {
    cwd: process.cwd(),
    env: process.env,
    ensure: ensureCentralServer,
    openRegistry: (cwd, env) => ProjectRegistry.open({ cwd, env }),
    findProjectRoot,
    openBrowser: defaultOpenBrowser,
    out: (line) => console.log(line),
  };
}

/** Options that `dr visualize` no longer takes, with why: thrown before anything starts. */
export function refusedVisualizeOptions(options: VisualizeOptions): string[] {
  const refused: string[] = [];
  if (options.noAuth) {
    refused.push("--no-auth: the DR process serves every project, and every route requires its token.");
  }
  if (options.token !== undefined) {
    refused.push("--token: the DR process makes its own token; the link it opens carries it.");
  }
  if (options.idleExit !== undefined) {
    refused.push("--idle-exit: the DR process exits after DR_VIEWER_IDLE_HOURS (default 24) with nothing using it.");
  }
  if (options.exitWithParent) {
    refused.push("--exit-with-parent: the DR process is shared; stop it with dr visualize --stop.");
  }
  return refused;
}

/** The start-only options given, by flag. */
export function startOnlyFlags(options: VisualizeOptions): string[] {
  return [
    options.port !== undefined && "--port",
    options.viewerPath !== undefined && "--viewer-path",
    options.withDanger && "--with-danger",
    options.readOnly && "--read-only",
    options.withChangesets && "--with-changesets",
  ].filter((flag): flag is string => typeof flag === "string");
}

function parsePort(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const text = String(raw).trim();
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) {
    throw new CLIError(`Invalid port number: ${raw}. Port must be between 1 and 65535.`);
  }
  return port;
}

/** The checkout `target` is in, registering its repository first when no project owns it. */
async function resolveTarget(target: string, deps: VisualizeDeps): Promise<ResolvedCheckout> {
  let registry: ProjectRegistry;
  try {
    registry = await deps.openRegistry(target, deps.env);
  } catch (error) {
    throw new CLIError(`Could not read the project registry: ${getErrorMessage(error)}`);
  }
  let resolved = await registry.resolvePath(target);
  if (!resolved) {
    // Register only a folder with a model: a repository without one has nothing to show.
    if (!(await deps.findProjectRoot(target))) {
      throw new CLIError(`No DR model at ${target}.`, 1, [
        "Run dr visualize inside a project (or name one: dr visualize <path>).",
        "dr init creates a model.",
      ]);
    }
    try {
      resolved = await registry.resolveOrRegister(target);
    } catch (error) {
      throw new CLIError(`Could not add ${target} to the project registry: ${getErrorMessage(error)}`, 1, [
        "dr farm add <path> registers a project by hand; dr farm list shows the farm.",
      ]);
    }
  }
  return resolved;
}

/**
 * `dr visualize [path]`: ensure the central process runs and open (or, with --no-browser, print)
 * the link to the checkout `path` resolves to.
 */
export async function visualizeCommand(options: VisualizeOptions, overrides: Partial<VisualizeDeps> = {}): Promise<void> {
  const deps: VisualizeDeps = { ...(await defaultDeps()), ...overrides };
  const json = options.json ?? isJson();

  const refused = refusedVisualizeOptions(options);
  if (refused.length > 0) {
    throw new CLIError(`dr visualize no longer takes ${refused.length === 1 ? "this option" : "these options"}:\n  ${refused.join("\n  ")}`);
  }
  const port = parsePort(options.port);
  const target = resolve(deps.cwd, options.path ?? ".");
  if (!existsSync(target)) throw new CLIError(`No such folder: ${target}`);

  const resolved = await resolveTarget(target, deps);
  const start: CentralStartOptions = {
    ...(port !== undefined ? { port } : {}),
    ...(options.viewerPath !== undefined ? { viewerPath: resolve(deps.cwd, options.viewerPath) } : {}),
    ...(options.withDanger ? { withDanger: true } : {}),
    ...(options.readOnly ? { readOnly: true } : {}),
  };
  let ensured;
  try {
    ensured = await deps.ensure({ cwd: target, env: deps.env, start });
  } catch (error) {
    throw new CLIError(`Could not start the DR process: ${getErrorMessage(error)}`, 1, [
      "dr serve --status shows the process for this farm.",
    ]);
  }
  const link = viewerUrl(ensured.record, resolved.ref, {}, ensured.token);
  const notApplied = ensured.started ? [] : startOnlyFlags(options);

  if (json) {
    deps.out(
      JSON.stringify(
        {
          url: link.url,
          project: link.project,
          checkout: link.checkout,
          pid: ensured.record.pid,
          port: ensured.record.port,
          started: ensured.started,
          ...(notApplied.length > 0 ? { notApplied } : {}),
          ...(ensured.notice ? { notice: ensured.notice } : {}),
        },
        null,
        2
      )
    );
  } else {
    const { pid, port: listening } = ensured.record;
    deps.out(
      ensured.started
        ? ansis.green(`✓ Started the DR process (pid ${pid}, port ${listening})`)
        : `The DR process is running (pid ${pid}, port ${listening})`
    );
    deps.out(`  ${link.project} / ${link.checkout}: ${link.url}`);
    if (ensured.started) {
      const { withDanger, withChangesets } = resolveChatMode(start);
      deps.out(
        ansis.dim(
          withDanger
            ? "  Danger mode: chat may land and delete changesets"
            : withChangesets
              ? "  Chat can stage model changes in a changeset; --read-only turns that off"
              : "  Chat is read-only (--read-only)"
        )
      );
    }
    if (notApplied.length > 0) {
      deps.out(
        ansis.yellow(
          `  Not applied (the DR process was already running): ${notApplied.join(", ")}. ` +
            "dr visualize --stop, then run this again, to start it with them."
        )
      );
    }
    if (ensured.notice) deps.out(ansis.yellow(`  ${ensured.notice}`));
  }
  if (!options.noBrowser) deps.openBrowser(link.url);
}
