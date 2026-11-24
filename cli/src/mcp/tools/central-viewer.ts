/**
 * What review_open, project_status, project_list and changeset_commit share about the central DR
 * process (issue 1279, design section 9): the farm and checkout a call resolves to, and deep links
 * into the shared viewer that process serves.
 *
 * Only review_open may start the central process (through an injected `EnsureCentralServer`).
 * Everything else here reads the server record (`findRunningServer`) and starts nothing
 * (`motivation.requirement.links-into-the-shared-viewer-start-no-process`).
 */

import path from "node:path";
import type { CheckoutRef, ResolvedCheckout, ServerRecord, ViewerLink } from "../../core/checkout-types.js";
import { ProjectRegistry } from "../../core/project-registry.js";
import { findRunningServer, type RunningServer } from "../../server/server-record.js";
import { viewerUrl, type ViewerLinkTarget } from "../../server/viewer-link.js";
import type { EnsureCentralServer } from "../../server/central-mcp-contract.js";
import { ensureCentralServer } from "../../server/ensure-central-server.js";
import { isOlderViewer } from "../../server/viewer-control.js";
import { getCliVersion } from "../../utils/spec-version.js";
import { currentProjectRoot, whenProjectRootSettled } from "../project-root.js";

/** How the tools reach the registry and the server record; tests pass their own. */
export interface CentralDeps {
  /** The registry over the farm in use, resolved from `cwd` (`resolveFarm`). */
  openRegistry: (cwd: string) => Promise<ProjectRegistry>;
  /** The central process serving the farm at `farmRoot`, when one runs. Starts nothing. */
  findRunningServer: (farmRoot: string) => Promise<RunningServer | null>;
  /** This CLI's version, compared with the central process's. */
  cliVersion: string;
}

export const DEFAULT_CENTRAL_DEPS: CentralDeps = {
  openRegistry: (cwd) => ProjectRegistry.open({ cwd }),
  findRunningServer: (farmRoot) => findRunningServer(farmRoot),
  cliVersion: getCliVersion(),
};

/** The directory a call is about: its `rootPath`, else the session's project root. */
export async function sessionRoot(rootPath?: string): Promise<string> {
  if (rootPath) return path.resolve(rootPath);
  await whenProjectRootSettled();
  return currentProjectRoot().root;
}

/** The checkout a call resolves to, with the registry it was resolved in. */
export interface SessionCheckout {
  registry: ProjectRegistry;
  resolved: ResolvedCheckout;
}

/**
 * The checkout `dir` is in. With `register`, a repository no project owns yet is added to the
 * farm first (what an MCP root gets); without, an unowned folder gives null.
 */
export async function resolveSessionCheckout(
  dir: string,
  options: { register?: boolean; deps?: Pick<CentralDeps, "openRegistry"> } = {}
): Promise<SessionCheckout | null> {
  const deps = options.deps ?? DEFAULT_CENTRAL_DEPS;
  const registry = await deps.openRegistry(dir);
  const resolved = options.register ? await registry.resolveOrRegister(dir) : await registry.resolvePath(dir);
  return resolved ? { registry, resolved } : null;
}

/** A link and what it says about the process it points at. */
export interface CentralLink {
  link: ViewerLink;
  record: ServerRecord;
  /** The process runs a CLI older than this one. */
  outdated: boolean;
}

/** The link to `ref` on the process `running` describes. */
export function centralLink(
  running: { record: ServerRecord; token: string | null },
  ref: CheckoutRef,
  target: ViewerLinkTarget = {},
  cliVersion: string = getCliVersion()
): CentralLink {
  return {
    link: viewerUrl(running.record, ref, target, running.token),
    record: running.record,
    outdated: isOlderViewer(running.record.cliVersion, cliVersion),
  };
}

/**
 * The link to `ref` when the farm's central process runs; null when none does. Reads the server
 * record only: it never starts a process.
 */
export async function runningCentralLink(
  farmRoot: string,
  ref: CheckoutRef,
  target: ViewerLinkTarget = {},
  deps: Pick<CentralDeps, "findRunningServer" | "cliVersion"> = DEFAULT_CENTRAL_DEPS
): Promise<CentralLink | null> {
  const running = await deps.findRunningServer(farmRoot);
  return running ? centralLink(running, ref, target, deps.cliVersion) : null;
}

/**
 * The link to a changeset of the checkout `dir` is in, when the central process runs: for a
 * refusal that tells the user to land it in the viewer. Best effort: null on anything it cannot
 * tell, never an error, so a refusal is never lost to it.
 */
export async function changesetLinkIfRunning(
  dir: string,
  changesetId: string | undefined,
  deps: CentralDeps = DEFAULT_CENTRAL_DEPS
): Promise<ViewerLink | null> {
  try {
    const session = await resolveSessionCheckout(dir, { deps });
    if (!session) return null;
    const found = await runningCentralLink(
      session.registry.farm.root,
      session.resolved.ref,
      changesetId ? { changeset: changesetId } : {},
      deps
    );
    return found?.link ?? null;
  } catch {
    return null;
  }
}

/** The real `EnsureCentralServer` (slice 3A of issue 1279): finds the farm's central process or starts one. */
export const loadedEnsureCentralServer: EnsureCentralServer = ensureCentralServer;
