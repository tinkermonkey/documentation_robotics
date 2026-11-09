/**
 * MCP server command - Starts an MCP server for AI assistant integration
 *
 * Supports two transport modes:
 * - stdio (default): In-process over stdio; stdout carries the MCP JSON-RPC protocol. The client
 *   spawns the server as the same user, so there is no API key: anything that can start
 *   `dr mcp` can already read the model files.
 * - http: HTTP server with Express, exposing MCP at /mcp endpoint with bearer token auth
 *
 * All non-protocol output goes to stderr.
 */

import { isCancel, text } from "@clack/prompts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { ApiKeyManager, type ApiKeyStoragePrompt } from "../mcp/api-key-manager.js";
import { type HttpTransportApp } from "../mcp/http-transport.js";
import { followClientRoots, markEnvProjectRoot } from "../mcp/project-root.js";
import { McpResourceRegistry } from "../mcp/resource-registry.js";
import { SERVER_INSTRUCTIONS } from "../mcp/server-instructions.js";
import { McpToolRegistry } from "../mcp/tool-registry.js";
import { clearModelCache, loadModel } from "../mcp/tools/shared.js";
import { startActiveSpan } from "../telemetry/index.js";
import { CLIError, getErrorMessage } from "../utils/errors.js";
import { getCliVersion } from "../utils/spec-version.js";

const cliVersion = getCliVersion();

/**
 * Prompt the user (via stdout/stdin) for where to store a newly generated API key.
 * Only invoked when stdin is a TTY — non-interactive launches (e.g. an MCP client
 * spawning `dr mcp`) fall back to the default path without prompting.
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

async function createConfiguredServer(): Promise<McpServer> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");

  const server = new McpServer(
    { name: "documentation-robotics", version: cliVersion },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // Register the model tool surface and spec/model manifest resources.
  new McpToolRegistry().registerAll(server);
  await new McpResourceRegistry().registerAll(server);
  return server;
}

/**
 * Loads the default project's model into the cache so the first tool call doesn't wait for it.
 * Best-effort: a server started outside a DR project still starts cleanly, and the first tool
 * call that supplies a valid rootPath loads and caches that model.
 */
async function warmModel(): Promise<void> {
  try {
    await loadModel();
  } catch (error) {
    process.stderr.write(`[mcp] model warmup skipped: ${getErrorMessage(error)}\n`);
  }
}

/**
 * Serve the project the client has open: once the client has initialized, ask for its roots
 * (mcp/project-root.ts), and ask again whenever it says they changed. A client without roots
 * leaves the server in its working directory.
 */
function serveClientRoots(server: McpServer): void {
  const inner = server.server;
  const follow = () =>
    followClientRoots(() => inner.listRoots(), { onChange: () => clearModelCache() }).then(warmModel);

  inner.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await follow();
  });
  inner.oninitialized = () => {
    if (inner.getClientCapabilities()?.roots) {
      void follow();
    } else {
      void warmModel();
    }
  };
}

/**
 * DR_MCP_ROOT_PATH lets a launcher (DrBot under `dr visualize`) point the server at a model
 * without relying on the cwd its MCP client spawns it in: tools default to this directory, and
 * the client's roots are not consulted. A bad path is reported and the server keeps its own cwd.
 * Returns whether the server now serves from DR_MCP_ROOT_PATH.
 */
export function serveFromRootPathEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const rootPath = env.DR_MCP_ROOT_PATH;
  if (!rootPath) return false;
  try {
    process.chdir(rootPath);
  } catch (error) {
    process.stderr.write(
      `[mcp] DR_MCP_ROOT_PATH=${rootPath} is not usable (${getErrorMessage(error)}); serving from ${process.cwd()}\n`
    );
    return false;
  }
  markEnvProjectRoot(process.cwd());
  return true;
}

export interface McpCommandOptions {
  /** Force-generate a new API key, overwrite it at the configured storage path, and exit. */
  regenerateKey?: boolean;
  /** Transport type: "stdio" or "http" (default: "stdio") */
  transport?: "stdio" | "http";
  /** Port for HTTP transport (default: 3100, only meaningful with --transport http) */
  port?: number;
  /** Host address for HTTP transport (default: "127.0.0.1", only meaningful with --transport http) */
  host?: string;
}

export async function mcpCommand(options: McpCommandOptions = {}): Promise<void> {
  const keyManager = new ApiKeyManager();

  try {
    if (options.regenerateKey) {
      await startActiveSpan("mcp.key.rotate", async (span) => {
        const isInteractive = process.stdin.isTTY === true;
        const { key, path } = await keyManager.rotate(
          isInteractive ? promptForKeyPath : undefined
        );
        span.setAttribute("mcp.key.path", path);
        process.stderr.write(`Generated new MCP API key, stored at ${path}\n`);
        process.stderr.write(`MCP API key: ${key}\n`);
      });
      return;
    }

    const servesEnvRoot = serveFromRootPathEnv();

    if (options.transport === "http") {
      // HTTP clients authenticate with the API key as a bearer token.
      const isInteractive = process.stdin.isTTY === true;
      const { key, path, isNew } = await keyManager.ensureKey(
        isInteractive ? promptForKeyPath : undefined
      );
      if (isNew) {
        process.stderr.write(`Generated new MCP API key, stored at ${path}\n`);
      }
      // Print the key to stderr so a user can configure a client. DR_MCP_QUIET_KEY keeps it out
      // of logs for a launcher that already has it.
      if (!/^(1|true|yes|on)$/i.test(process.env.DR_MCP_QUIET_KEY ?? "")) {
        process.stderr.write(`MCP API key: ${key}\n`);
      }

      // One server for every HTTP session, so the project is the env root or the cwd (client
      // roots are per session and can't move a shared working directory).
      await warmModel();
      const { createMcpHttpApp, startHttpServer, closeHttpServer } = await import(
        "../mcp/http-transport.js"
      );

      const host = options.host || "127.0.0.1";
      const port = options.port || 3100;

      let httpApp: HttpTransportApp;
      const httpServer = await startActiveSpan(
        "mcp.server.start",
        async (span) => {
          httpApp = await createMcpHttpApp(keyManager, key, createConfiguredServer, host);
          const server = await startHttpServer(httpApp, host, port);

          span.setAttribute("mcp.server.name", "documentation-robotics");
          span.setAttribute("mcp.server.version", cliVersion);
          span.setAttribute("mcp.server.transport", "http");
          span.setAttribute("mcp.server.host", host);
          span.setAttribute("mcp.server.port", port);

          return server;
        }
      );

      // Warn if bound to 0.0.0.0
      if (host === "0.0.0.0") {
        process.stderr.write(
          "Warning: Server bound to 0.0.0.0. DNS rebinding protection is not automatic; ensure your MCP client validates the Host header.\n"
        );
      }

      process.stderr.write(`Documentation Robotics MCP server ready (http://${host}:${port}/mcp)\n`);

      // Set up graceful shutdown on SIGINT/SIGTERM
      let resolveKeepAlive: () => void;
      const keepAlive = new Promise<void>((resolve) => {
        resolveKeepAlive = resolve;
      });

      let isShuttingDown = false;
      const shutdown = async () => {
        if (isShuttingDown) {
          return;
        }
        isShuttingDown = true;

        try {
          process.stderr.write("\nShutting down HTTP server...\n");
          await closeHttpServer(httpServer, httpApp);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "unknown error";
          process.stderr.write(`[mcp] Error closing server: ${errorMsg}\n`);
        } finally {
          resolveKeepAlive!();
        }
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep the process alive until explicitly terminated
      await keepAlive;
    } else {
      // Stdio transport (default). No API key: the client spawns this process as its own user.
      const transport = await startActiveSpan(
        "mcp.server.start",
        async (span) => {
          const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

          const server = await createConfiguredServer();
          if (servesEnvRoot) {
            await warmModel();
          } else {
            serveClientRoots(server);
          }

          span.setAttribute("mcp.server.name", "documentation-robotics");
          span.setAttribute("mcp.server.version", cliVersion);
          span.setAttribute("mcp.server.transport", "stdio");

          const serverTransport = new StdioServerTransport();
          await server.connect(serverTransport);
          return serverTransport;
        }
      );

      process.stderr.write("Documentation Robotics MCP server ready (stdio)\n");

      // Keep the process alive for the lifetime of the stdio session; the
      // transport closes (and the process exits) when stdin closes. Shutdown
      // is implicit in the `mcp.server.start` span's end, so no separate
      // zero-duration "stop" span is recorded here.
      await new Promise<void>((resolve) => {
        transport.onclose = () => resolve();
      });
    }
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }

    let message = getErrorMessage(error);

    // Handle port-in-use errors with actionable message
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      const port = options.port || 3100;
      message = `Port ${port} is already in use. Try a different port with --port or kill the process using that port.`;
    }

    process.stderr.write(`Error: ${message}\n`);
    throw new CLIError(message, 1);
  }
}
