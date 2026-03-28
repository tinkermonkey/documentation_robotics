/**
 * MCP Client Adapter for CodePrism Integration
 *
 * Wraps @modelcontextprotocol/sdk with DR-specific concerns:
 * - Stdio-based transport for local CodePrism process spawning
 * - Connection validation with configurable timeout
 * - Graceful error handling with actionable remediation steps
 * - Process cleanup on shutdown
 * - Tool invocation with type-safe query execution
 *
 * @example
 * ```typescript
 * const config: ScanConfig = {
 *   codeprism: {
 *     command: 'codeprism',
 *     args: ['--mcp'],
 *     timeout: 5000
 *   },
 *   confidence_threshold: 0.6
 * };
 *
 * const client = await createMcpClient(config);
 * await validateConnection(client);
 * const results = await client.callTool('search_code', { pattern: 'foo.*', language: 'javascript' });
 * // ... proceed with scan operations
 * ```
 */

import { spawnSync } from "node:child_process";
import { z } from "zod";
import { getErrorMessage } from "../utils/errors.js";

// MCP SDK types - these will be available at runtime when the package is installed
// For compile-time type checking, we use inline type definitions below
type Tool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * Scan configuration loaded from ~/.dr-config.yaml
 */
export const ScanConfigSchema = z.object({
  codeprism: z
    .object({
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      timeout: z.number().int().positive().optional(),
    })
    .optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  disabled_patterns: z.array(z.string()).optional(),
});

export type ScanConfig = z.infer<typeof ScanConfigSchema>;

/**
 * Tool invocation result from CodePrism
 *
 * Discriminated union where only relevant fields are required for each type:
 * - "text" type must have a `text` field
 * - "image" type must have a `data` field
 * - "error" type must have a `text` field with error message
 */
export const ToolResultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    text: z.string(),
  }),
]);

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * MCP Client interface representing connection to CodePrism
 */
export interface MCPClient {
  readonly isConnected: boolean;
  endpoint?: string;
  disconnect: () => Promise<void>;
  callTool: (toolName: string, toolArgs: Record<string, unknown>) => Promise<ToolResult[]>;
  listTools: () => Promise<Tool[]>;
}

/**
 * Create an MCP client connection to CodePrism
 *
 * Validates that the CodePrism binary is available via PATH or specified path.
 * Establishes the stdio transport connection to the CodePrism MCP server.
 * Does not validate server responsiveness until validateConnection() is called.
 *
 * @param config - Scan configuration containing CodePrism command and args
 * @returns MCP client object ready for connection validation
 * @throws Error if required config is missing or CodePrism binary cannot be found
 *
 * @example
 * ```typescript
 * const client = await createMcpClient(config);
 * await validateConnection(client);
 * const results = await client.callTool('search_code', { pattern: 'foo', language: 'js' });
 * ```
 */
export async function createMcpClient(config: ScanConfig): Promise<MCPClient> {
  if (!config.codeprism) {
    throw new Error(
      "Missing scan configuration\n\n" +
        "Configure CodePrism in ~/.dr-config.yaml:\n" +
        "  scan:\n" +
        "    codeprism:\n" +
        "      command: codeprism      # or path to binary\n" +
        "      args: [--mcp]           # arguments for MCP mode\n" +
        "      timeout: 5000           # connection timeout in ms"
    );
  }

  const command = config.codeprism.command || "codeprism";
  const args = config.codeprism.args || ["--mcp"];
  const timeout = config.codeprism.timeout || 5000;

  // Validate binary is available by checking if it can be spawned
  // Use spawnSync without shell to get proper ENOENT errors
  const checkResult = spawnSync(command, ["--version"], {
    stdio: "pipe",
    timeout: 2000,
    shell: false,
  });

  if (checkResult.error) {
    const error = checkResult.error as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(
        `Error: CodePrism binary not found: '${command}'\n\n` +
          "Suggestions:\n" +
          "  • Install CodePrism with: cargo install codeprism-mcp-server\n" +
          `  • Ensure the binary is in your PATH or provide the full path\n` +
          "  • Verify the binary name is correct in ~/.dr-config.yaml\n" +
          `  • Current setting: scan.codeprism.command = '${command}'`
      );
    } else if (error.code === "EACCES") {
      throw new Error(
        `Error: CodePrism binary found but not executable: '${command}'\n\n` +
          "Suggestions:\n" +
          `  • Make binary executable: chmod +x ${command}\n` +
          `  • Verify permissions: ls -l ${command}`
      );
    } else {
      throw new Error(
        `Error: Failed to access CodePrism binary: '${command}'\n\n` +
          `Details: ${getErrorMessage(error)}`
      );
    }
  }

  // Dynamically import MCP SDK at runtime to defer dependency requirements
  let ClientClass: any;
  let StdioClientTransportClass: any;

  try {
    // @ts-ignore - MCP SDK will be installed at runtime
    const clientModule = await import("@modelcontextprotocol/sdk/client/index.js");
    ClientClass = clientModule.Client;

    // @ts-ignore - MCP SDK will be installed at runtime
    const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js");
    StdioClientTransportClass = stdioModule.StdioClientTransport;
  } catch (importError) {
    throw new Error(
      "MCP SDK not installed. Please install with:\n" +
        "  npm install @modelcontextprotocol/sdk\n\n" +
        "Or if using a different package manager:\n" +
        "  yarn add @modelcontextprotocol/sdk\n" +
        "  pnpm add @modelcontextprotocol/sdk"
    );
  }

  // Create stdio transport and MCP client
  const transport = new StdioClientTransportClass({
    command,
    args,
    env: {
      ...process.env,
      CODEPRISM_PROFILE: "development",
      RUST_LOG: "warn",
    },
  });

  const mcpClient = new ClientClass({
    name: "documentation-robotics",
    version: "0.1.0",
  });

  let actualClient: any | null = null;
  let actualTransport: any | null = transport;
  const tools: Map<string, Tool> = new Map();

  try {
    // Connect to the MCP server via stdio
    await Promise.race([
      mcpClient.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP connection timeout after ${timeout}ms`)), timeout)
      ),
    ]);

    actualClient = mcpClient;
  } catch (error) {
    // Ensure transport is closed on connection failure
    try {
      await transport.close();
    } catch (e) {
      // Log close errors but don't let them mask the primary connection failure.
      // This prevents transport cleanup from obscuring the real issue.
      const closeErrorMsg = getErrorMessage(e);
      console.debug(`Warning: transport close failed during error recovery: ${closeErrorMsg}`);
    }
    actualTransport = null;
    throw error;
  }

  // Wrapper client object
  const client: MCPClient = {
    get isConnected(): boolean {
      // Always reflect actual connection state rather than a separate flag
      return actualClient !== null;
    },
    endpoint: `${command}:${args.join(" ")}`,

    async callTool(toolName: string, toolArgs: Record<string, unknown>): Promise<ToolResult[]> {
      if (!actualClient) {
        throw new Error("MCP client not connected");
      }

      try {
        const result = await (actualClient as any).callTool(
          {
            name: toolName,
            arguments: toolArgs,
          },
          {}
        );

        // Convert MCP tool result to ToolResult format and validate against schema
        return result.content.map((content: any) => {
          const toolResult =
            content.type === "text"
              ? { type: "text" as const, text: content.text }
              : content.type === "image"
                ? { type: "image" as const, data: content.data }
                : { type: "error" as const, text: "unknown_type" };

          // Validate result against schema to ensure all required fields are present
          const validated = ToolResultSchema.safeParse(toolResult);
          if (!validated.success) {
            // If validation fails, return error result with validation message
            return {
              type: "error" as const,
              text: `Invalid tool result: ${validated.error.message}`,
            };
          }
          return validated.data;
        });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        return [{ type: "error", text: errorMsg }];
      }
    },

    async listTools(): Promise<Tool[]> {
      if (!actualClient) {
        throw new Error("MCP client not connected");
      }

      try {
        // Get tools list and cache it
        if (tools.size === 0) {
          const response = await (actualClient as any).listTools();
          for (const tool of response.tools) {
            tools.set(tool.name, tool);
          }
        }
        return Array.from(tools.values());
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        throw new Error(`Failed to list CodePrism tools: ${errorMsg}`);
      }
    },

    async disconnect(): Promise<void> {
      if (actualClient) {
        try {
          await (actualClient as any).close();
        } catch (error) {
          // Log disconnect errors but continue cleanup. This prevents client.close()
          // failures from preventing the actualClient reference from being cleared.
          const errorMsg = getErrorMessage(error);
          console.debug(`Warning: failed to close MCP client: ${errorMsg}`);
        }
      }
      actualClient = null;

      // Close the stdio transport to ensure the CodePrism process doesn't linger
      if (actualTransport) {
        try {
          await actualTransport.close();
        } catch (error) {
          // Log transport close errors but continue cleanup. The MCP client is already
          // closed, so a transport close failure is secondary and shouldn't prevent cleanup.
          const errorMsg = getErrorMessage(error);
          console.debug(`Warning: failed to close transport: ${errorMsg}`);
        }
      }
      actualTransport = null;
    },
  };

  return client;
}

/**
 * Validate that MCP client can reach CodePrism server
 *
 * Performs a lightweight connection check by listing available tools.
 * If CodePrism is not running or unresponsive, this will fail with a clear error message.
 *
 * FR-1.3: This function is required to validate server reachability before proceeding
 * with analysis, ensuring that the scan command fails early with actionable guidance
 * if CodePrism is not available.
 *
 * @param client - MCP client from createMcpClient()
 * @throws Error if CodePrism server is not reachable or unresponsive
 *
 * @example
 * ```typescript
 * const client = await createMcpClient(config);
 * try {
 *   await validateConnection(client);
 *   // Proceed with scan
 * } catch (error) {
 *   console.error(getErrorMessage(error));
 *   process.exit(1);
 * }
 * ```
 */
export async function validateConnection(client: MCPClient): Promise<void> {
  if (!client.endpoint) {
    throw new Error("Client not properly configured");
  }

  try {
    // Attempt to list tools to verify the server is responding
    // This is a lightweight MCP operation that tests basic connectivity
    const tools = await client.listTools();

    if (!tools || tools.length === 0) {
      throw new Error(
        "CodePrism MCP server is running but reports no available tools. " +
          "This may indicate a server configuration issue."
      );
    }
  } catch (error) {
    // Preserve the original error while adding context
    const errorMsg = getErrorMessage(error);
    const wrappedError = new Error(
      `Error: Cannot reach CodePrism MCP server (${client.endpoint})\n\n` +
        `Details: ${errorMsg}\n\n` +
        "Suggestions:\n" +
        "  • Ensure CodePrism is running: codeprism --mcp\n" +
        "  • Check that the binary is installed: cargo install codeprism-mcp-server\n" +
        "  • Review CodePrism logs for errors\n" +
        "  • Verify the configuration in ~/.dr-config.yaml"
    );
    // Preserve original error chain
    if (error instanceof Error) {
      wrappedError.cause = error;
    }
    throw wrappedError;
  }
}

/**
 * Disconnect MCP client
 *
 * @param client - MCP client to disconnect
 */
export async function disconnectMcpClient(client: MCPClient): Promise<void> {
  await client.disconnect();
}
