/**
 * The contract between the central server and the process that runs it (issue 1279, slice 2).
 *
 * `docs/design/USER_LEVEL_DR.md` section 7. One central process per farm serves every project
 * and checkout the farm lists. Slice 2 builds it in two parts that meet here:
 *
 * - the server (`cli/src/server/central-server.ts`, `startCentralServer`): routes, per-checkout
 *   contexts through the project registry, the websocket feed and `/health`;
 * - the process (`dr serve`): the server record and token file, port choice, idle exit and the
 *   start-up sweep of per-project viewers.
 *
 * Change these shapes only together with both parts.
 */

import type { ContextPoolSettings } from "../core/checkout-types.js";
import type { FarmLocation, ProjectRegistry } from "../core/project-registry.js";

export interface CentralServerOptions {
  /** The farm this process serves. */
  farm: FarmLocation;
  /** The farm's registry: the only way the server resolves a project or checkout. */
  registry: ProjectRegistry;
  /** Context pool limits. Default: `contextPoolSettingsFromEnv()`. */
  pool?: ContextPoolSettings;
  /** Port to listen on, on 127.0.0.1 only. The process picks it (8080 or the next free port). */
  port: number;
  /** The one token every route except `/health` requires. */
  token: string;
  /** This process's id, reported by `/health`, so a reader can tell it from whatever else holds the port. */
  serverId: string;
  /** Pid of the launcher that started this process detached, reported by `/health`. */
  launcherPid?: number;
  /** A custom viewer build to serve instead of the bundled one. */
  viewerPath?: string;
  /** DrBot may stage changes in a changeset (the default for `dr visualize` since 0.7.0). */
  withChangesets?: boolean;
  /** DrBot may also land and delete. */
  withDanger?: boolean;
}

/** What the process needs to decide whether it is idle (design section 7, "Idle exit"). */
export interface CentralActivity {
  /** Browser tabs connected now (websocket clients), across every checkout. */
  clients: number;
  /** MCP sessions open now on `/mcp`. */
  mcpSessions: number;
  /** DrBot turns running now, across every checkout. */
  drBotTurns: number;
  /** When it was last used: a request other than `/health`, or a websocket opening or closing. Epoch ms. */
  lastActivityAt: number;
  /** API requests and MCP tool calls being answered now (absent: not counted). */
  requestsInFlight?: number;
}

/** `GET /health` on the central process. Unauthenticated: status and version only, unless the token is sent. */
export interface CentralHealth {
  status: "ok";
  cliVersion: string;
  /** With the token only: */
  serverId?: string;
  pid?: number;
  launcherPid?: number;
  /** Real path of the farm root it serves. */
  farmRoot?: string;
  clients?: number;
  /** MCP sessions open now (slice 3). A process that doesn't report it serves no MCP. */
  mcpSessions?: number;
  /** DrBot turns running now (slice 3). */
  drBotTurns?: number;
  /** Checkout contexts loaded now. */
  loadedCheckouts?: number;
}

export interface CentralServer {
  /** The port it listens on. */
  readonly port: number;
  activity(): CentralActivity;
  /**
   * Closes every checkout context (ending its DrBot turns and telling its subscribers), then the
   * listener. With `processExiting` the file watchers are left to the exit: closing one while its
   * tree is being deleted deadlocks Bun (#1235). Safe to call more than once.
   */
  stop(options?: { processExiting?: boolean }): Promise<void>;
}

export type StartCentralServer = (options: CentralServerOptions) => Promise<CentralServer>;
