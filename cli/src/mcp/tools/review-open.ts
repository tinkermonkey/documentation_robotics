/**
 * review_open — hand the human a link that opens a changeset on the graph in the shared viewer
 * (issue 1279, design section 9).
 *
 * One central DR process serves every project and checkout of a farm. review_open resolves the
 * call's checkout through the project registry (registering its repository when no project owns
 * it yet) and returns a `ViewerLink` to the changeset on that process: the route and the token in
 * the URL fragment. It gets the process through an injected `EnsureCentralServer`, which finds the
 * running one or starts `dr serve` detached; it spawns no viewer of its own.
 *
 * A running process older than this CLI is kept while a tab, MCP session or DrBot turn is
 * connected; `EnsureCentralServer` then gives a notice, which review_open passes on. `restart:
 * true` replaces the process: it ends DrBot chats in every checkout, so the agent asks the user
 * first. The process is stopped only once its pid is confirmed (as `dr serve --stop` confirms it),
 * and never from inside itself.
 *
 * DrBot does not get this tool: it already lives in the viewer (coding-agents/drbot-mcp.ts).
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerRecord } from "../../core/checkout-types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import type { EnsureCentralServer } from "../../server/central-mcp-contract.js";
import { serveCommand } from "../../commands/serve.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";
import {
  DEFAULT_CENTRAL_DEPS,
  centralLink,
  loadedEnsureCentralServer,
  resolveSessionCheckout,
  type CentralDeps,
} from "./central-viewer.js";

const inputSchema = {
  changeset: z.string().optional().describe("Changeset ID or name. Defaults to the active changeset."),
  restart: z
    .boolean()
    .optional()
    .describe(
      "Replace the central DR process serving the viewer with a fresh one. Use it when review_open says the process is " +
        "older than this CLI; it ends every DrBot chat running in it, in every project, so ask the user first."
    ),
  rootPath: rootPathSchema,
};

export type ReviewOpenArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export interface ReviewOpenDeps extends CentralDeps {
  /** Finds the farm's central process, or starts it (slice 3A's `ensureCentralServer`). */
  ensureCentralServer: EnsureCentralServer;
  /**
   * Stops the farm's running central process, for `restart: true`, once its pid is confirmed to be
   * that process. `cwd` resolves the farm. Throws when it can't.
   */
  stopCentralServer: (cwd: string) => Promise<void>;
  /** This process's pid: a process never stops itself. */
  selfPid: number;
}

/** `dr serve --stop` for the farm `cwd` is in: the same confirmation before any signal. */
async function stopWithServe(cwd: string): Promise<void> {
  await serveCommand({ stop: true, json: true }, { cwd, out: () => {} });
}

const DEFAULT_DEPS: ReviewOpenDeps = {
  ...DEFAULT_CENTRAL_DEPS,
  ensureCentralServer: loadedEnsureCentralServer,
  stopCentralServer: stopWithServe,
  selfPid: process.pid,
};

/** What to tell the human about an older process that was kept, when `EnsureCentralServer` gave no notice. */
function outdatedNotice(record: ServerRecord, cliVersion: string): string {
  return (
    `The DR process serving the viewer runs CLI ${record.cliVersion}; this CLI is ${cliVersion}, so it lacks its fixes. ` +
    "To replace it, ask the user, then call review_open with restart: true. That ends every DrBot chat running in it."
  );
}

/** Builds the review_open handler; tests inject the registry, the central process and the stop. */
export function createReviewOpenHandler(overrides: Partial<ReviewOpenDeps> = {}) {
  const deps: ReviewOpenDeps = { ...DEFAULT_DEPS, ...overrides };

  /** Stops the running central process for a restart; refuses to stop the one answering this call. */
  async function stopForRestart(cwd: string): Promise<{ pid: number; cliVersion: string } | null> {
    const session = await resolveSessionCheckout(cwd, { deps });
    const farmRoot = session?.registry.farm.root ?? (await deps.openRegistry(cwd)).farm.root;
    const running = await deps.findRunningServer(farmRoot);
    if (!running) return null;
    if (running.record.pid === deps.selfPid) {
      throw new CLIError(
        `restart: true can't replace the DR process from inside it: this MCP session is served by that process (pid ${running.record.pid}).`,
        ErrorCategory.USER,
        ["Call review_open without restart for the link; the next dr MCP session replaces an older process once nothing is connected to it"]
      );
    }
    await deps.stopCentralServer(cwd);
    return { pid: running.record.pid, cliVersion: running.record.cliVersion };
  }

  return async function reviewOpenHandler(args: ReviewOpenArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      const manager = new StagingAreaManager(model.rootPath, model);
      const changeset = await resolveChangeset(manager, args.changeset, "changeset");

      const session = await resolveSessionCheckout(model.rootPath, { register: true, deps });
      if (!session) {
        throw new CLIError(`No project in the farm owns ${model.rootPath}.`, ErrorCategory.USER);
      }
      const ref = session.resolved.ref;

      const replaced = args.restart === true ? await stopForRestart(model.rootPath) : null;
      const ensured = await deps.ensureCentralServer({ cwd: model.rootPath });
      const { link, outdated } = centralLink(ensured, ref, { changeset: changeset.id }, deps.cliVersion);

      return jsonResult({
        url: link.url,
        link,
        project: ref.project,
        checkout: ref.checkout,
        changesetId: changeset.id,
        changesetName: changeset.name,
        port: ensured.record.port,
        started: ensured.started,
        serverCliVersion: ensured.record.cliVersion,
        ...(outdated ? { outdated: true, cliVersion: deps.cliVersion } : {}),
        ...(ensured.notice || outdated ? { notice: ensured.notice ?? outdatedNotice(ensured.record, deps.cliVersion) } : {}),
        ...(replaced ? { replaced } : {}),
      });
    });
  };
}

export const reviewOpenHandler = createReviewOpenHandler();

export const reviewOpenTool: McpToolDefinition<typeof inputSchema> = {
  name: "review_open",
  description:
    "Get a link that opens a changeset (by id or name; default the active one) on the graph in the DR viewer, " +
    "for the human to review. One central DR process serves every project and checkout; the link names this " +
    "project and checkout, and review_open starts that process when none runs. When the running process is older than " +
    "this CLI and something is connected to it, it is kept: the result has outdated: true and a notice to relay, and " +
    "restart: true replaces it (ask the user first: it ends every DrBot chat in it). The token is in the link's " +
    "fragment; give the human the url as it is, and never send them to the CLI. They comment on elements there, " +
    "including ones the plan adds (read them with annotation_list, answer with annotation_reply), and commit the " +
    "changeset there when the work lands.",
  inputSchema,
  handler: (args) => reviewOpenHandler(args),
};
