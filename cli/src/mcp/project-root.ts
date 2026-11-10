/**
 * Which project the MCP server serves when a tool call doesn't name one with `rootPath`.
 *
 * In order of precedence:
 * 1. DR_MCP_ROOT_PATH, set by a launcher that names the model (DrBot under `dr visualize`).
 * 2. The client's MCP roots: the folder the editor or agent session has open. This lets one
 *    server registered per user (a Claude Code plugin) serve whichever project is in front of
 *    the developer, whatever directory the client happens to start it in.
 * 3. The server's own working directory.
 *
 * The server moves its working directory to the chosen root, so every tool, and the CLI code
 * under it, finds the project the same way it does from a terminal in that folder.
 */

import { fileURLToPath } from "node:url";
import { findProjectRoot } from "../utils/project-paths.js";
import { getErrorMessage } from "../utils/errors.js";

export type ProjectRootSource = "env" | "client-roots" | "cwd";

export interface ProjectRoot {
  /** Directory the server serves from (its working directory). */
  root: string;
  /** Where that directory came from. */
  source: ProjectRootSource;
}

let current: ProjectRoot = { root: process.cwd(), source: "cwd" };
let settled: Promise<void> = Promise.resolve();

/** The directory the server serves from, and where it came from. */
export function currentProjectRoot(): ProjectRoot {
  return { ...current };
}

/**
 * Resolves once the server knows which project to serve. Tool calls and model loads wait on
 * this so none runs against the wrong folder while the client's roots are still being asked for.
 */
export function whenProjectRootSettled(): Promise<void> {
  return settled;
}

/** Records that a launcher chose the root (DR_MCP_ROOT_PATH); client roots are then ignored. */
export function markEnvProjectRoot(root: string): void {
  current = { root, source: "env" };
}

/** Test-only: forget any chosen root and pending resolution. */
export function resetProjectRoot(root: string = process.cwd()): void {
  current = { root, source: "cwd" };
  settled = Promise.resolve();
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

/**
 * The root to serve: the first one inside a DR project (a documentation-robotics/ folder at or
 * above it), else the first root, so a project without a model yet is still the one in front
 * of the developer. Undefined when there are no usable roots.
 */
export async function pickProjectRoot(
  paths: readonly string[],
  findProject: (path: string) => Promise<string | null> = findProjectRoot
): Promise<string | undefined> {
  for (const path of paths) {
    if (await findProject(path)) return path;
  }
  return paths[0];
}

export interface FollowClientRootsOptions {
  /** Called after the server moved to a different root (drop cached models, warm the new one). */
  onChange?: (root: string) => void | Promise<void>;
  /** Give up on a client that doesn't answer roots/list within this time (default 5s). */
  timeoutMs?: number;
  chdir?: (path: string) => void;
  log?: (message: string) => void;
}

/**
 * Asks the client for its roots and moves the server to the chosen one. Call it when the
 * client has initialized and again when it says its roots changed. Never throws: a client that
 * fails or doesn't answer leaves the server where it is. A launcher's DR_MCP_ROOT_PATH wins.
 */
export function followClientRoots(
  listRoots: () => Promise<{ roots: ReadonlyArray<{ uri: string }> }>,
  options: FollowClientRootsOptions = {}
): Promise<void> {
  const chdir = options.chdir ?? ((path: string) => process.chdir(path));
  const log = options.log ?? ((message: string) => process.stderr.write(`[mcp] ${message}\n`));
  const timeoutMs = options.timeoutMs ?? 5000;

  const previous = settled;
  // Assigned before any await, so a tool call that arrives next already waits on it.
  settled = (async () => {
    await previous;
    if (current.source === "env") return;

    let uris: string[];
    try {
      const { roots } = await withTimeout(listRoots(), timeoutMs);
      uris = roots.map((root) => root.uri);
    } catch (error) {
      log(`client roots unavailable (${getErrorMessage(error)}); serving from ${current.root}`);
      return;
    }

    const root = await pickProjectRoot(rootUrisToPaths(uris));
    if (!root || root === current.root) {
      if (root) current = { root, source: "client-roots" };
      return;
    }
    try {
      chdir(root);
    } catch (error) {
      log(`client root ${root} is not usable (${getErrorMessage(error)}); serving from ${current.root}`);
      return;
    }
    current = { root, source: "client-roots" };
    try {
      await options.onChange?.(root);
    } catch (error) {
      log(`after moving to ${root}: ${getErrorMessage(error)}`);
    }
  })();
  return settled;
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
