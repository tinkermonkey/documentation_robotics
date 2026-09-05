/**
 * MCP server command - Starts an MCP server for AI assistant integration
 *
 * Runs in-process over stdio. All non-protocol output goes to stderr, since stdout
 * carries the MCP JSON-RPC transport once the server is connected.
 */

import { isCancel, text } from "@clack/prompts";
import { ApiKeyManager, type ApiKeyStoragePrompt } from "../mcp/api-key-manager.js";
import { McpResourceRegistry } from "../mcp/resource-registry.js";
import { McpToolRegistry } from "../mcp/tool-registry.js";
import { loadModel } from "../mcp/tools/shared.js";
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

export interface McpCommandOptions {
  /** Force-generate a new API key, overwrite it at the configured storage path, and exit. */
  regenerateKey?: boolean;
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

    const isInteractive = process.stdin.isTTY === true;
    const { key, path, isNew } = await keyManager.ensureKey(
      isInteractive ? promptForKeyPath : undefined
    );

    if (isNew) {
      process.stderr.write(`Generated new MCP API key, stored at ${path}\n`);
    }
    // Required every launch: print the API key to stderr (never stdout, which
    // carries the MCP protocol).
    process.stderr.write(`MCP API key: ${key}\n`);

    if (!keyManager.validate(process.env.DR_MCP_API_KEY, key)) {
      process.stderr.write(
        "Error: DR_MCP_API_KEY environment variable is missing or does not match the stored API key.\n"
      );
      process.stderr.write(
        "Set DR_MCP_API_KEY to the key above when configuring the MCP client, e.g.:\n"
      );
      process.stderr.write(
        '  { "command": "dr", "args": ["mcp"], "env": { "DR_MCP_API_KEY": "<key>" } }\n'
      );
      throw new CLIError("MCP authentication failed: invalid or missing DR_MCP_API_KEY", 1);
    }

    const transport = await startActiveSpan(
      "mcp.server.start",
      async (span) => {
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

        const server = new McpServer({
          name: "documentation-robotics",
          version: cliVersion,
        });

        // Register the model tool surface (list/show/search/add/update/delete/
        // validate/export/trace/stats/info) and the spec/model manifest resources.
        new McpToolRegistry().registerAll(server);
        await new McpResourceRegistry().registerAll(server);

        // Warm the model cache at startup so it's loaded once and held in memory
        // for the session, rather than waiting for the first tool call. Best-effort:
        // a server started outside a DR project (or before one exists) still starts
        // up cleanly — the first tool call that supplies a valid rootPath will load
        // and cache it.
        try {
          await loadModel();
        } catch (error) {
          process.stderr.write(
            `[mcp] model warmup skipped: ${getErrorMessage(error)}\n`
          );
        }

        span.setAttribute("mcp.server.name", "documentation-robotics");
        span.setAttribute("mcp.server.version", cliVersion);

        const serverTransport = new StdioServerTransport();
        await server.connect(serverTransport);
        return serverTransport;
      },
      { "mcp.server.transport": "stdio" }
    );

    process.stderr.write("Documentation Robotics MCP server ready (stdio)\n");

    // Keep the process alive for the lifetime of the stdio session; the
    // transport closes (and the process exits) when stdin closes. Shutdown
    // is implicit in the `mcp.server.start` span's end, so no separate
    // zero-duration "stop" span is recorded here.
    await new Promise<void>((resolve) => {
      transport.onclose = () => resolve();
    });
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    const message = getErrorMessage(error);
    process.stderr.write(`Error: ${message}\n`);
    throw new CLIError(message, 1);
  }
}
