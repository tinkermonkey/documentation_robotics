/**
 * The central server: one server for every project and checkout of a farm (issue 1279, slice 2A;
 * `docs/design/USER_LEVEL_DR.md` sections 7 and 8). `dr serve` (slice 2B) runs it.
 *
 * It is the visualization server in central mode (`VisualizationServer` with `central`): each
 * checkout's state is a `CheckoutContext` from a `CheckoutContextPool` over the registry's
 * resolver; a `checkout-removed` event closes that checkout's context. It serves:
 *
 * - `GET /api/projects`, `/api/projects/{project}` and `/api/projects/{project}/checkouts`;
 * - every project-data route under `/api/projects/{project}/checkouts/{checkout}/...`, and 404
 *   for an unknown project or checkout, or a checkout that is not on disk;
 * - the retired unscoped project-data paths (`/api/model`, `/api/changesets`, ...), each `410 Gone`
 *   with the scoped template that replaces it, for this one release (slice 4);
 * - `/mcp`, the MCP interface for every session of the farm;
 * - `/ws`: one socket per tab, subscribing per checkout with `{action, project, checkout}` frames;
 * - `/health` as `CentralHealth`, the only route that needs no token (the viewer's pages carry the
 *   token in the URL fragment, so they need none either), and the viewer, its deep-link paths
 *   (`/p/<project>/c/<checkout>/...`) included.
 *
 * It listens on 127.0.0.1 only. (`application.applicationcomponent.visualization-server`)
 */

import { MAIN_CHECKOUT, type CheckoutRef } from "../core/checkout-types.js";
import type { ProjectRegistry } from "../core/project-registry.js";
import { getErrorMessage } from "../utils/errors.js";
import type { CentralServer, CentralServerOptions, StartCentralServer } from "./central-server-contract.js";
import { VisualizationServer } from "./server.js";

/**
 * The MCP fallback root (an MCP session with no root of its own works there): the checkout the
 * process was started in (its working directory), else the main checkout of the farm's first
 * project by name; null for an empty farm. It serves no route.
 */
export async function defaultCheckoutFor(registry: ProjectRegistry, cwd: string = process.cwd()): Promise<CheckoutRef | null> {
  try {
    const here = await registry.resolvePath(cwd);
    if (here) return here.ref;
  } catch (error) {
    console.warn(`[Central] Could not resolve ${cwd} to a checkout: ${getErrorMessage(error)}`);
  }
  const first = registry.farmManifest
    .getAllProjects()
    .map((project) => project.name)
    .sort((a, b) => a.localeCompare(b))[0];
  return first ? { project: first, checkout: MAIN_CHECKOUT } : null;
}

export interface StartCentralServerTestOptions {
  /** The MCP fallback root. Default: `defaultCheckoutFor(registry)`. */
  defaultCheckout?: CheckoutRef | null;
  /** How often the server asks the registry about removed checkouts (ms; 0 turns it off). */
  removalCheckMs?: number;
}

/** Starts the central server for a farm. (`StartCentralServer` in central-server-contract.ts) */
export const startCentralServer: StartCentralServer = (options) => startCentralServerWith(options);

/** startCentralServer, with the knobs tests need. */
export async function startCentralServerWith(
  options: CentralServerOptions,
  extra: StartCentralServerTestOptions = {}
): Promise<CentralServer> {
  const defaultCheckout =
    extra.defaultCheckout !== undefined ? extra.defaultCheckout : await defaultCheckoutFor(options.registry);
  const server = new VisualizationServer({
    authToken: options.token,
    withChangesets: options.withChangesets,
    withDanger: options.withDanger,
    viewerPath: options.viewerPath,
    launcherPid: options.launcherPid,
    central: {
      registry: options.registry,
      pool: options.pool,
      defaultCheckout,
      serverId: options.serverId,
      removalCheckMs: extra.removalCheckMs,
    },
  });
  await server.start(options.port);
  let stopped: Promise<void> | undefined;
  return {
    port: server.listeningPort() ?? options.port,
    activity: () => server.centralActivity(),
    stop: () => (stopped ??= server.stopCentral()),
  };
}
