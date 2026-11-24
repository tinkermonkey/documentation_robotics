/**
 * A central server over a scratch farm, for tests that drive the visualization server in process.
 *
 * The server has one mode (issue 1279, slice 4B): it serves every project and checkout of a farm,
 * and every project-data route names its checkout (`/api/projects/{project}/checkouts/{checkout}/...`).
 * So a test that wants "a server for this model" registers the model's folder as the one project
 * of a scratch farm and talks to that project's main checkout.
 *
 * - The project folder becomes a git repository if it is not one (`git init`, everything
 *   committed on `main`): a farm project is a git repository.
 * - The farm lives in its own temporary folder, removed by `stop()`. Nothing reads or writes the
 *   user's real farm: the registry is built from that folder, never from `DR_FARM_PATH` or
 *   `XDG_CONFIG_HOME`, and tests/setup.ts points `DR_STATE_DIR` at a scratch folder.
 * - The server loads the checkout's model from disk itself, on the first request or message
 *   for it: save a model before starting, and reach the server's own model with `context()`.
 * - Chat-client detection is stubbed out unless `detectChat` is set (see
 *   tests/unit/server/helpers.ts: the real probe freezes concurrent tests for seconds).
 */

import { spyOn } from "bun:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { ProjectRegistry, type FarmLocation } from "../../src/core/project-registry.js";
import { MAIN_CHECKOUT, type CheckoutRef } from "../../src/core/checkout-types.js";
import type { CheckoutContext } from "../../src/server/checkout-context.js";
import { VisualizationServer, type VisualizationServerOptions } from "../../src/server/server.js";

const run = promisify(execFile);

/** The token every test server uses unless told otherwise. */
export const TEST_TOKEN = "dr-test-token";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV });
  return stdout;
}

/**
 * Makes `dir` a git repository of its own, everything committed on main, unless it already is
 * one (its own `.git`, not an enclosing repository's).
 */
export async function ensureGitRepository(dir: string): Promise<void> {
  if (existsSync(path.join(dir, ".git"))) return;
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "--allow-empty", "-m", "test model");
}

export interface TestFarmServerOptions {
  /** The project's name in the farm (default "test-project"). */
  project?: string;
  /** Listen on a port (default false: requests go through `request()`, in process). */
  listen?: boolean;
  /** The port to listen on (default 0: the OS picks one). */
  port?: number;
  /** The token (default TEST_TOKEN). */
  token?: string;
  /** Detect the installed chat CLIs, as the real server does (default false). */
  detectChat?: boolean;
  /** Other server options (withDanger, withChangesets, viewerPath, launcherPid, ...). */
  server?: Omit<VisualizationServerOptions, "central" | "authToken">;
  /** Central-mode options beyond the farm (pool, serverId, removalCheckMs). */
  central?: Partial<Omit<VisualizationServerOptions["central"], "registry">>;
}

export interface TestFarmServer {
  server: VisualizationServer;
  registry: ProjectRegistry;
  farm: FarmLocation;
  /** The project's name in the farm. */
  project: string;
  /** Always `main`. */
  checkout: string;
  ref: CheckoutRef;
  /** The project folder's real path. */
  root: string;
  token: string;
  /** `{ Authorization: "Bearer <token>" }`. */
  auth: Record<string, string>;
  /** The scoped path for `rest`: `/api/projects/<project>/checkouts/main<rest>` (rest starts with "/"). */
  api(rest: string): string;
  /** An in-process request (`app.request`) to `path` as given (no scoping), with the token unless `init.headers` says otherwise. */
  raw(path: string, init?: RequestInit): Promise<Response>;
  /** An in-process request to the scoped path for `rest`, with the token. */
  request(rest: string, init?: RequestInit): Promise<Response>;
  /** The bound port (with `listen`). */
  port: number;
  /** `http://127.0.0.1:<port><path>` (with `listen`). */
  url(path: string): string;
  /** `ws://127.0.0.1:<port>/ws?token=<token>` (with `listen`). */
  wsUrl(): string;
  /** The checkout's context on the server, loaded on first use. */
  context(): Promise<CheckoutContext>;
  /** Runs fn in the checkout's context, as a request for it would be. */
  inCheckout<T>(fn: () => T | Promise<T>): Promise<T>;
  /** Stops the server and removes the farm folder (not the project folder). */
  stop(): Promise<void>;
}

/** Starts a central server over a scratch farm whose one project is `projectRoot`. */
export async function startTestFarmServer(projectRoot: string, options: TestFarmServerOptions = {}): Promise<TestFarmServer> {
  const root = await realpath(projectRoot);
  await ensureGitRepository(root);

  const farmDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-test-farm-")));
  const farmRoot = path.join(farmDir, "farm");
  await mkdir(farmRoot);
  const file = path.join(farmRoot, "farm.yaml");
  await FarmManifest.create("test-farm").save(file);
  const farm: FarmLocation = { root: farmRoot, file, source: "folder" };
  const registry = ProjectRegistry.fromManifest(farm, await FarmManifest.load(file));
  const project = options.project ?? "test-project";
  await registry.registerProject(root, { name: project });

  const ref: CheckoutRef = { project, checkout: MAIN_CHECKOUT };
  const token = options.token ?? TEST_TOKEN;
  const serverOptions: VisualizationServerOptions = {
    ...(options.server ?? {}),
    authToken: token,
    central: { registry, defaultCheckout: ref, removalCheckMs: 0, ...(options.central ?? {}) },
  };

  let server: VisualizationServer;
  if (options.detectChat) {
    server = new VisualizationServer(serverOptions);
  } else {
    const detect = spyOn(VisualizationServer.prototype as any, "initializeChatClients").mockResolvedValue(undefined);
    try {
      server = new VisualizationServer(serverOptions);
    } finally {
      detect.mockRestore();
    }
  }

  if (options.listen) await server.start(options.port ?? 0);
  const port = options.listen ? (server.listeningPort() ?? options.port ?? 0) : 0;
  const auth = { Authorization: `Bearer ${token}` };
  const api = (rest: string) =>
    `/api/projects/${encodeURIComponent(project)}/checkouts/${MAIN_CHECKOUT}${rest}`;
  const raw = (p: string, init: RequestInit = {}) =>
    (server as any).app.request(p, { ...init, headers: init.headers ?? auth }) as Promise<Response>;

  const context = async (): Promise<CheckoutContext> => {
    const found = await (server as any).acquireCheckout(ref);
    if ("error" in found) throw new Error(found.error);
    return found.context;
  };

  let stopped: Promise<void> | undefined;
  return {
    server,
    registry,
    farm,
    project,
    checkout: MAIN_CHECKOUT,
    ref,
    root,
    token,
    auth,
    api,
    raw,
    request: (rest, init = {}) => raw(api(rest), { ...init, headers: { ...auth, ...((init.headers as any) ?? {}) } }),
    port,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    wsUrl: () => `ws://127.0.0.1:${port}/ws?token=${token}`,
    context,
    inCheckout: async (fn) => {
      const ctx = await context();
      return (server as any).inContext(ctx, fn);
    },
    stop: () =>
      (stopped ??= (async () => {
        await server.stopCentral();
        await rm(farmDir, { recursive: true, force: true });
      })()),
  };
}
