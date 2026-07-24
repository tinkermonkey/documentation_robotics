/**
 * MCP server command - Starts an MCP server for AI assistant integration
 *
 * Runs in-process over stdio (see ADR: In-Process Server over Subprocess in the
 * architecture design). All non-protocol output goes to stderr, since stdout
 * carries the MCP JSON-RPC transport once the server is connected.
 */

import { isCancel, text } from "@clack/prompts";
import { ApiKeyManager, type ApiKeyStoragePrompt } from "../mcp/api-key-manager.js";
import { CLIError, getErrorMessage } from "../utils/errors.js";

// Declare build-time constant (substituted by esbuild)
declare const CLI_VERSION: string;
const cliVersion = typeof CLI_VERSION !== "undefined" ? CLI_VERSION : "0.1.3";

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

export async function mcpCommand(): Promise<void> {
  const keyManager = new ApiKeyManager();

  try {
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

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

    const server = new McpServer({
      name: "documentation-robotics",
      version: cliVersion,
    });

    // No tools registered yet — this phase establishes the server shell and
    // the initialize/tools/list handshake only. Advertise the tools
    // capability with an empty list handler directly on the underlying
    // low-level Server, since McpServer only wires up tools/list once at
    // least one tool has been registered via server.tool()/registerTool().
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.stderr.write("Documentation Robotics MCP server ready (stdio)\n");

    // Keep the process alive for the lifetime of the stdio session; the
    // transport closes (and the process exits) when stdin closes.
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
