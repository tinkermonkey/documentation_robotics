/**
 * One MCP session in the central process (issue 1279, slice 3A): which checkout it serves and
 * the environment its calls run under. The `/mcp` endpoint makes one per session from the
 * session's initialize request; the tool dispatch (tool-registry.ts) runs each call in it.
 */

import { randomUUID } from "node:crypto";
import type { CheckoutRef } from "../core/checkout-types.js";
import type { SessionEnvValues } from "../core/session-env.js";
import { McpSessionRoot, type SessionCheckoutResolver } from "./project-root.js";

export interface McpSessionOptions {
  /** Resolves paths to checkouts (the central process's project registry). */
  resolver?: SessionCheckoutResolver;
  /** DR_MCP_ROOT_PATH as the bridge sent it: the session serves this checkout, whatever its roots. */
  pinnedRoot?: string;
  /** Where the session serves until its client's roots are known. */
  fallback?: string;
  /** The session's values of the variables in SESSION_ENV_KEYS (core/session-env.ts). */
  env?: SessionEnvValues;
  log?: (message: string) => void;
}

export class McpSession {
  readonly root: McpSessionRoot;
  readonly env: SessionEnvValues;
  /**
   * Who this session's writes are from (core/changeset-write-activity.ts): one central process
   * serves every session and the viewer, so a process id can't tell them apart.
   */
  readonly writer = `mcp:${randomUUID().slice(0, 8)}`;
  private readonly resolver?: SessionCheckoutResolver;

  constructor(options: McpSessionOptions = {}) {
    this.resolver = options.resolver;
    this.env = { ...(options.env ?? {}) };
    this.root = new McpSessionRoot({ fallback: options.fallback, resolver: options.resolver, log: options.log });
    if (options.pinnedRoot) void this.root.pin(options.pinnedRoot);
    else void this.root.resolveFallback();
  }

  /** The client initialized: ask for its roots before the next tool call (none when it is pinned). */
  clientInitialized(): void {
    this.root.markRootsStale();
  }

  /**
   * The checkout a call resolved to: the one `rootPath` is in (through the registry, without
   * registering anything), else the session's. Null when the registry knows no checkout there.
   */
  async checkoutFor(rootPath: string | undefined): Promise<CheckoutRef | null> {
    if (rootPath !== undefined && rootPath !== "") {
      const resolved = (await this.resolver?.resolve(rootPath, { register: false })) ?? null;
      return resolved ? { ...resolved.ref } : null;
    }
    await this.root.whenSettled();
    return this.root.get().checkout ?? null;
  }
}
