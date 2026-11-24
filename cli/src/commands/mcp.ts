/**
 * `dr mcp`: the MCP interface, served by the user's central DR process (issue 1279, slice 3A;
 * `docs/design/USER_LEVEL_DR.md` section 7).
 *
 * - stdio (default): the `McpStdioBridge` (mcp/stdio-bridge.ts). It finds the central process for
 *   the farm in use, or starts it detached, and forwards MCP messages between stdio and the
 *   process's `/mcp` with its token. stdout carries only the MCP protocol; everything else goes to
 *   stderr. The client's configuration doesn't change, and no token is written into it.
 * - `--http` (or `--transport http`): finds or starts the central process and prints its MCP
 *   endpoint (`http://127.0.0.1:<port>/mcp`) and the token file a client authenticates with, then
 *   exits. The process keeps serving: there is no separate HTTP MCP server any more.
 * - `DR_MCP_IN_PROCESS=1` (stdio only): serves the tools in this process, for one session, without
 *   the central process or the farm's registry: for a client that must not start a background
 *   process, and for tests that drive the tools over a real MCP connection. The session resolves
 *   its project from DR_MCP_ROOT_PATH, else the client's roots, else this process's working
 *   directory, without changing the working directory.
 */

import { isCancel, text } from "@clack/prompts";
import { ApiKeyManager, type ApiKeyStoragePrompt } from "../mcp/api-key-manager.js";
import type { EnsureCentralServer } from "../server/central-mcp-contract.js";
import { startActiveSpan } from "../telemetry/index.js";
import { CLIError, getErrorMessage } from "../utils/errors.js";

/**
 * Prompt the user (via stdout/stdin) for where to store a newly generated API key.
 * Only invoked when stdin is a TTY.
 */
const promptForKeyPath: ApiKeyStoragePrompt = async (defaultPath) => {
  const result = await text({
    message: "Where should the MCP API key be stored?",
    placeholder: defaultPath,
    defaultValue: defaultPath,
  });

  if (isCancel(result) || typeof result !== "string" || result.trim().length === 0) {
    return defaultPath;
  }
  return result.trim();
};

export interface McpCommandOptions {
  /** Force-generate a new API key, overwrite it at the configured storage path, and exit. */
  regenerateKey?: boolean;
  /** Transport type: "stdio" or "http" (default: "stdio") */
  transport?: "stdio" | "http";
  /** Ignored since the central process serves MCP: it picks its own port (`dr serve --port`). */
  port?: number;
  /** Ignored since the central process serves MCP: it listens on 127.0.0.1 only. */
  host?: string;
  /** Injected for tests. */
  ensure?: EnsureCentralServer;
  /** Where `--http` prints its endpoint. Default: stdout. */
  out?: (line: string) => void;
}

/** What `dr mcp --http` prints: where the central process serves MCP, and how to authenticate. */
export interface McpHttpEndpoint {
  url: string;
  tokenPath: string;
  pid: number;
  started: boolean;
  notice?: string;
}

export async function mcpCommand(options: McpCommandOptions = {}): Promise<void> {
  try {
    if (options.regenerateKey) {
      await startActiveSpan("mcp.key.rotate", async (span) => {
        const keyManager = new ApiKeyManager();
        const isInteractive = process.stdin.isTTY === true;
        const { key, path } = await keyManager.rotate(isInteractive ? promptForKeyPath : undefined);
        span.setAttribute("mcp.key.path", path);
        process.stderr.write(`Generated new MCP API key, stored at ${path}\n`);
        process.stderr.write(`MCP API key: ${key}\n`);
        process.stderr.write(
          "Note: dr mcp --http no longer uses this key. MCP is served by the DR process, with its own token (see dr mcp --http).\n"
        );
      });
      return;
    }

    const ensure = options.ensure ?? (await import("../server/ensure-central-server.js")).ensureCentralServer;

    if (options.transport === "http") {
      const endpoint = await mcpHttpEndpoint(ensure, options);
      const out = options.out ?? ((line: string) => console.log(line));
      if (endpoint.notice) process.stderr.write(`${endpoint.notice}\n`);
      out(`DR serves MCP at ${endpoint.url} (pid ${endpoint.pid}${endpoint.started ? ", started now" : ""})`);
      out(`Authenticate with the header "Authorization: Bearer <token>", the token being the content of ${endpoint.tokenPath}`);
      out("The token and port change when the DR process restarts; the stdio bridge (dr mcp) follows them for you.");
      return;
    }

    if (inProcessRequested()) {
      await serveInProcess();
      return;
    }

    await startActiveSpan("mcp.server.start", async (span) => {
      span.setAttribute("mcp.server.name", "documentation-robotics");
      span.setAttribute("mcp.server.transport", "stdio-bridge");
      const { runMcpStdioBridge } = await import("../mcp/stdio-bridge.js");
      // Runs until the client closes stdin.
      await runMcpStdioBridge({ ensure });
    });
  } catch (error) {
    if (error instanceof CLIError) throw error;
    const message = getErrorMessage(error);
    process.stderr.write(`Error: ${message}\n`);
    throw new CLIError(message, 1);
  }
}

/** Finds or starts the central process and says where it serves MCP. */
export async function mcpHttpEndpoint(ensure: EnsureCentralServer, options: McpCommandOptions = {}): Promise<McpHttpEndpoint> {
  if ((options.port !== undefined && options.port !== 3100) || (options.host !== undefined && options.host !== "127.0.0.1")) {
    process.stderr.write(
      "Warning: --port and --host no longer apply: the DR process serves MCP on 127.0.0.1 at its own port (dr serve --port sets it when it starts).\n"
    );
  }
  const ensured = await ensure();
  return {
    url: `http://127.0.0.1:${ensured.record.port}/mcp`,
    tokenPath: ensured.record.tokenPath,
    pid: ensured.record.pid,
    started: ensured.started,
    ...(ensured.notice ? { notice: ensured.notice } : {}),
  };
}

/** The in-process escape hatch: DR_MCP_IN_PROCESS set to a true value. */
export const MCP_IN_PROCESS_ENV = "DR_MCP_IN_PROCESS";

function inProcessRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env[MCP_IN_PROCESS_ENV]?.trim() ?? "");
}

/** Serves the tools in this process over stdio, as one MCP session (see the header). */
async function serveInProcess(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { existsSync, statSync } = await import("node:fs");
  const { McpSession } = await import("../mcp/mcp-session.js");
  const { createDrMcpServer } = await import("../mcp/central-mcp.js");
  const { pickSessionEnv } = await import("../core/session-env.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  let pinnedRoot = env.DR_MCP_ROOT_PATH?.trim() || undefined;
  if (pinnedRoot && !(existsSync(pinnedRoot) && statSync(pinnedRoot).isDirectory())) {
    process.stderr.write(`[mcp] DR_MCP_ROOT_PATH=${pinnedRoot} is not usable (not a directory); serving from ${process.cwd()}\n`);
    pinnedRoot = undefined;
  }
  const session = new McpSession({ pinnedRoot, fallback: process.cwd(), env: pickSessionEnv(env) });
  const server = await createDrMcpServer(session, { eagerRoots: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Documentation Robotics MCP server ready (stdio, in process)\n");
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
