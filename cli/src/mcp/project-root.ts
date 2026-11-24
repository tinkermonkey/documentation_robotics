/**
 * Which project an MCP session serves when a tool call doesn't name one with `rootPath`
 * (issue 1279, `docs/design/USER_LEVEL_DR.md` sections 7 and 9).
 *
 * Every MCP session has its own {@link McpSessionRoot}. In order of precedence:
 * 1. DR_MCP_ROOT_PATH, set by a launcher that names the checkout (DrBot) and sent by the
 *    `dr mcp` bridge to the central process as the session's pinned root.
 * 2. The client's MCP roots: the folder the editor or agent session has open. The first root
 *    inside a registered project's checkout wins; else the first root, which the project
 *    registry then registers.
 * 3. A fallback: the central process's default checkout, or the server's working directory.
 *
 * Nothing here changes the process's working directory: two sessions in two checkouts run in
 * one process and never see each other's project. Tools read the session's root through
 * {@link currentProjectRoot}, which finds the session the call runs in from an
 * `AsyncLocalStorage` the tool dispatch sets ({@link runInMcpSession}). Code outside any session
 * (direct handler calls in tests) gets the process default session.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckoutRef, ResolvedCheckout } from "../core/checkout-types.js";
import { findProjectRoot } from "../utils/project-paths.js";
import { getErrorMessage } from "../utils/errors.js";

export type ProjectRootSource = "env" | "client-roots" | "cwd";

export interface ProjectRoot {
  /** Directory the session serves: tools load the model from here when no rootPath is given. */
  root: string;
  /** Where that directory came from. */
  source: ProjectRootSource;
  /** The project and checkout the root resolved to in the registry, when the session has one. */
  checkout?: CheckoutRef;
}

/**
 * How a session turns a path into a checkout: the central process's project registry. `register`
 * lets it add the project of an unregistered path (a client root, or the pinned path).
 */
export interface SessionCheckoutResolver {
  resolve(target: string, options: { register: boolean }): Promise<ResolvedCheckout | null>;
}

/** A SessionCheckoutResolver over a project registry. */
export function registryCheckoutResolver(registry: {
  resolvePath(target: string): Promise<ResolvedCheckout | null>;
  resolveOrRegister(target: string): Promise<ResolvedCheckout>;
}): SessionCheckoutResolver {
  return {
    async resolve(target, { register }) {
      try {
        return register ? await registry.resolveOrRegister(target) : await registry.resolvePath(target);
      } catch {
        // Not in a git working tree, or its name is held by another repository: no checkout.
        return null;
      }
    },
  };
}

/**
 * The directory to serve for a path that resolved to a checkout: the project root holding the
 * checkout's model (`.../documentation-robotics/model`) when the path is at or above it, else the
 * path itself.
 */
export function servedRootFor(target: string, resolved: ResolvedCheckout | null): string {
  if (!resolved) return path.resolve(target);
  const full = realOrResolved(target);
  const parts = path.resolve(resolved.modelPath).split(path.sep);
  const n = parts.length;
  if (n >= 2 && parts[n - 2] === "documentation-robotics" && parts[n - 1] === "model") {
    const projectRoot = parts.slice(0, n - 2).join(path.sep) || path.sep;
    if (projectRoot === full || projectRoot.startsWith(full + path.sep)) return projectRoot;
  }
  return full;
}

function realOrResolved(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

export interface FollowClientRootsOptions {
  /** Called after the session moved to a different root (drop cached models, warm the new one). */
  onChange?: (root: string) => void | Promise<void>;
  /** Give up on a client that doesn't answer roots/list within this time (default 5s). */
  timeoutMs?: number;
  log?: (message: string) => void;
}

export interface McpSessionRootOptions {
  /** Where the session serves until something better is known (source "cwd"). */
  fallback?: string;
  /** Resolves paths to checkouts; without one (no registry) roots are served as they are. */
  resolver?: SessionCheckoutResolver;
  log?: (message: string) => void;
}

/** One MCP session's project: its pinned root, else its client's roots, else a fallback. */
export class McpSessionRoot {
  private current: ProjectRoot;
  private settled: Promise<void> = Promise.resolve();
  /** The client's roots changed (or were never asked for) and are to be asked before the next tool call. */
  private rootsStale = false;
  private readonly resolver?: SessionCheckoutResolver;
  private readonly log: (message: string) => void;

  constructor(options: McpSessionRootOptions = {}) {
    this.current = { root: options.fallback ?? process.cwd(), source: "cwd" };
    this.resolver = options.resolver;
    this.log = options.log ?? ((message: string) => process.stderr.write(`[mcp] ${message}\n`));
  }

  /** The directory the session serves, where it came from and its checkout. */
  get(): ProjectRoot {
    return { ...this.current, ...(this.current.checkout ? { checkout: { ...this.current.checkout } } : {}) };
  }

  /** Resolves once the session knows which project it serves. */
  whenSettled(): Promise<void> {
    return this.settled;
  }

  /** Resolves the fallback root to its checkout, when it is in one (no registration). */
  resolveFallback(): Promise<void> {
    return this.chain(async () => {
      if (this.current.source !== "cwd" || !this.resolver) return;
      const resolved = await this.resolver.resolve(this.current.root, { register: false });
      if (this.current.source !== "cwd") return;
      this.current = { root: servedRootFor(this.current.root, resolved), source: "cwd", ...checkoutOf(resolved) };
    });
  }

  /**
   * Pins the session to a launcher's root (DR_MCP_ROOT_PATH); client roots are then ignored. The
   * path is resolved through the registry, registering its project when none owns it.
   */
  pin(root: string): Promise<void> {
    this.current = { root: path.resolve(root), source: "env" };
    return this.chain(async () => {
      const resolved = this.resolver ? await this.resolver.resolve(root, { register: true }) : null;
      this.current = { root: servedRootFor(root, resolved), source: "env", ...checkoutOf(resolved) };
    });
  }

  /** The client's roots are to be asked for before the next tool call (it initialized, or said they changed). */
  markRootsStale(): void {
    if (this.current.source !== "env") this.rootsStale = true;
  }

  /** Whether the next tool call should ask the client for its roots first. */
  get needsRoots(): boolean {
    return this.rootsStale && this.current.source !== "env";
  }

  /**
   * Asks the client for its roots and serves the chosen one. Never throws: a client that fails or
   * doesn't answer leaves the session where it is. A pinned root (DR_MCP_ROOT_PATH) wins.
   */
  follow(
    listRoots: () => Promise<{ roots: ReadonlyArray<{ uri: string }> }>,
    options: FollowClientRootsOptions = {}
  ): Promise<void> {
    const log = options.log ?? this.log;
    const timeoutMs = options.timeoutMs ?? 5000;
    this.rootsStale = false;
    return this.chain(async () => {
      if (this.current.source === "env") return;

      let uris: string[];
      try {
        const { roots } = await withTimeout(listRoots(), timeoutMs);
        uris = roots.map((root) => root.uri);
      } catch (error) {
        log(`client roots unavailable (${getErrorMessage(error)}); serving from ${this.current.root}`);
        return;
      }

      const picked = await pickProjectRoot(rootUrisToPaths(uris), undefined, this.resolver);
      if (!picked) return;
      const before = this.current.root;
      this.current = { root: picked.root, source: "client-roots", ...checkoutOf(picked.checkout) };
      if (picked.root === before) return;
      try {
        await options.onChange?.(picked.root);
      } catch (error) {
        log(`after moving to ${picked.root}: ${getErrorMessage(error)}`);
      }
    });
  }

  /** Test-only: forget any chosen root and pending resolution. */
  reset(root: string = process.cwd()): void {
    this.current = { root, source: "cwd" };
    this.settled = Promise.resolve();
    this.rootsStale = false;
  }

  /** Runs `step` after every earlier resolution; assigned before any await, so a call that arrives next waits on it. */
  private chain(step: () => Promise<void>): Promise<void> {
    const previous = this.settled;
    this.settled = (async () => {
      await previous;
      try {
        await step();
      } catch (error) {
        this.log(`resolving the session's project failed: ${getErrorMessage(error)}`);
      }
    })();
    return this.settled;
  }
}

function checkoutOf(resolved: ResolvedCheckout | null | undefined): { checkout?: CheckoutRef } {
  return resolved ? { checkout: { ...resolved.ref } } : {};
}

const sessions = new AsyncLocalStorage<McpSessionRoot>();
const processDefault = new McpSessionRoot();

/** Runs `fn` as part of `session`: currentProjectRoot and loadModel then serve that session's project. */
export function runInMcpSession<T>(session: McpSessionRoot, fn: () => T): T {
  return sessions.run(session, fn);
}

/** The session the current call runs in, else the process default. */
export function currentMcpSession(): McpSessionRoot {
  return sessions.getStore() ?? processDefault;
}

/** The directory the current session serves, where it came from and its checkout. */
export function currentProjectRoot(): ProjectRoot {
  return currentMcpSession().get();
}

/**
 * Resolves once the current session knows which project to serve. Tool calls and model loads
 * wait on this so none runs against the wrong folder while the client's roots are being asked for.
 */
export function whenProjectRootSettled(): Promise<void> {
  return currentMcpSession().whenSettled();
}

/** Pins the process default session to a launcher's root; client roots are then ignored. */
export function markEnvProjectRoot(root: string): void {
  void processDefault.pin(root);
}

/** Test-only: forget the process default session's root and pending resolution. */
export function resetProjectRoot(root: string = process.cwd()): void {
  processDefault.reset(root);
}

/** {@link McpSessionRoot.follow} for the current session (the process default outside one). */
export function followClientRoots(
  listRoots: () => Promise<{ roots: ReadonlyArray<{ uri: string }> }>,
  options: FollowClientRootsOptions = {}
): Promise<void> {
  return currentMcpSession().follow(listRoots, options);
}

/** Local paths for the `file://` root URIs; roots with other schemes are skipped. */
export function rootUrisToPaths(uris: readonly string[]): string[] {
  const paths: string[] = [];
  for (const uri of uris) {
    if (!uri.startsWith("file:")) continue;
    try {
      paths.push(fileURLToPath(uri));
    } catch {
      // A malformed file URI can't name a folder; skip it.
    }
  }
  return paths;
}

/** The root a session serves, with the checkout it resolved to. */
export interface PickedRoot {
  root: string;
  checkout: ResolvedCheckout | null;
}

/**
 * The checkout to serve, from the client's roots. With a registry: the first root inside a
 * registered project's checkout, else the first root, which the registry then registers (a root
 * outside any git working tree is served as it is). Without one: the first root inside a DR
 * project (a documentation-robotics/ folder at or above it), else the first root. Undefined when
 * there are no usable roots.
 */
export async function pickProjectRoot(
  paths: readonly string[],
  findProject: (path: string) => Promise<string | null> = findProjectRoot,
  resolver?: SessionCheckoutResolver
): Promise<PickedRoot | undefined> {
  if (paths.length === 0) return undefined;
  if (resolver) {
    for (const target of paths) {
      const resolved = await resolver.resolve(target, { register: false });
      if (resolved) return { root: servedRootFor(target, resolved), checkout: resolved };
    }
    const first = paths[0];
    const registered = await resolver.resolve(first, { register: true });
    return { root: servedRootFor(first, registered), checkout: registered };
  }
  for (const target of paths) {
    if (await findProject(target)) return { root: target, checkout: null };
  }
  return { root: paths[0], checkout: null };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
