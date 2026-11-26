/**
 * The contract between the three pieces of slice 3 of issue 1279 (`docs/design/USER_LEVEL_DR.md`
 * sections 7, 9 and 14):
 *
 * - 3A, MCP on the central process: `/mcp` served by `dr serve`, `ensureCentralServer`, `dr mcp`
 *   over stdio as a bridge to it, and each MCP session resolving its own checkout;
 * - 3B, the tools: `project_list`, and `review_open` and `project_status` returning deep links
 *   into the shared viewer instead of starting viewers;
 * - 3C, DrBot: the `DrBotLauncher` running each turn in its checkout.
 *
 * Change these shapes only together with every piece.
 */

import type { CheckoutRef, ServerRecord } from "../core/checkout-types.js";

/**
 * Set on a process to pin its dr MCP to one checkout: `dr mcp` (the bridge) sends it to the
 * central process as the session's root, ahead of the client's roots. DrBot's launcher sets it
 * to the checkout's path. The same name `cli/src/coding-agents/drbot-mcp.ts` already exports.
 */
export const MCP_ROOT_PATH_ENV = "DR_MCP_ROOT_PATH";

export interface EnsureCentralServerOptions {
  /** Where to resolve the farm from (`resolveFarm`). Default: the process's working directory. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** How long to wait for a process it starts to answer `/health`. */
  startTimeoutMs?: number;
  /**
   * How to start the process, used only when this call starts it (`dr visualize`'s start-only
   * options). A running process keeps the options it started with; `started` says which happened.
   */
  start?: CentralStartOptions;
}

/** `dr serve`'s start options: applied only by the call that starts the process. */
export interface CentralStartOptions {
  /** Where the port search starts (default 8080). */
  port?: number;
  /** A custom viewer build to serve instead of the bundled one (an absolute path). */
  viewerPath?: string;
  /** DrBot may also land and delete. */
  withDanger?: boolean;
  /** DrBot reads only: no changeset staging. */
  readOnly?: boolean;
}

export interface EnsuredCentralServer {
  record: ServerRecord;
  /** Read from the record's token file. */
  token: string;
  /** It started the process (none was running, or it replaced an older idle one). */
  started: boolean;
  /** A running process older than this CLI was kept because a tab, MCP session or DrBot turn is connected: say so. */
  notice?: string;
}

/**
 * Finds the central process for the farm in use from its server record, or starts `dr serve`
 * detached under the starting marker so concurrent callers wait for one start. Built by 3A
 * (`cli/src/server/ensure-central-server.ts`); 3B's tools take it as an injected dependency.
 */
export type EnsureCentralServer = (options?: EnsureCentralServerOptions) => Promise<EnsuredCentralServer>;

/**
 * What every MCP tool result names: the checkout the call resolved to, and the branch it is on (#1422:
 * `main` is the farm's key for a project's primary folder, whatever branch that folder has checked
 * out). `branch` is null when the checkout is detached; absent when the caller doesn't know it.
 */
export type McpResultCheckout = CheckoutRef & { branch?: string | null };

/**
 * Identifies a DrBot conversation in the central process. The same conversation id in another
 * checkout is another conversation. (`data-model.objectschema.dr-bot-session-key`)
 */
export interface DrBotSessionKey extends CheckoutRef {
  conversationId: string;
}

/** Running DrBot turns allowed per central process; a turn over the cap waits, and the chat says it is queued. */
export const DEFAULT_DRBOT_TURN_CAP = 3;
export const DRBOT_TURN_CAP_ENV = "DR_DRBOT_MAX_TURNS";
