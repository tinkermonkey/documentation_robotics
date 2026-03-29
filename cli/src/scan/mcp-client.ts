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
 * const config: LoadedScanConfig = {
 *   codeprism: {
 *     command: 'codeprism',
 *     args: ['--mcp'],
 *     timeout: 5000
 *   },
 *   confidence_threshold: 0.7,
 *   disabled_patterns: []
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
 * MCP tool result content item returned by CodePrism
 * Has optional text (for text/error types) and data (for image type)
 */
type MCPToolResultContent = {
  type: string;
  text?: string;
  data?: string;
};

/**
 * MCP tool call response returned by the SDK's callTool method
 * Note: content can be undefined if the server returns a malformed response
 */
type MCPToolCallResponse = {
  content?: MCPToolResultContent[];
};

/**
 * MCP list tools response returned by the SDK's listTools method
 */
type MCPListToolsResponse = {
  tools: Tool[];
};

/**
 * MCP Client instance from @modelcontextprotocol/sdk
 * Provides connection and tool invocation methods.
 * We use a minimal interface that captures only what we need,
 * without requiring the full SDK types at compile time.
 */
type MCPClientInstance = {
  connect(transport: unknown): Promise<void>;
  callTool(request: unknown, options?: unknown): Promise<MCPToolCallResponse>;
  listTools(): Promise<MCPListToolsResponse>;
  close(): Promise<void>;
};

/**
 * Constructor for MCP Client class.
 * The actual SDK constructor signature is complex with generics;
 * we use a simple constructor type that accepts name and version.
 */
type MCPClientConstructor = {
  new (options: { name: string; version: string }): MCPClientInstance;
};

/**
 * MCP stdio transport instance for process communication
 */
type MCPStdioTransport = {
  close(): Promise<void>;
};

/**
 * Constructor for MCP stdio transport class
 */
type MCPStdioTransportConstructor = {
  new (options: {
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
  }): MCPStdioTransport;
};

/**
 * Raw scan configuration schema for validation before merging defaults
 * All fields are optional since file config may be partial
 */
export const RawScanConfigSchema = z.object({
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

export type RawScanConfig = z.infer<typeof RawScanConfigSchema>;

/**
 * Loaded scan configuration with all defaults merged in
 * All fields are guaranteed to be populated after loadScanConfig()
 * This eliminates the need for ?? fallbacks in consumers
 */
export const LoadedScanConfigSchema = z.object({
  codeprism: z.object({
    command: z.string(),
    args: z.array(z.string()),
    timeout: z.number().int().positive(),
  }),
  confidence_threshold: z.number().min(0).max(1),
  disabled_patterns: z.array(z.string()),
});

export type LoadedScanConfig = z.infer<typeof LoadedScanConfigSchema>;

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
 * Detects if an error is a transport/infrastructure failure (connection lost, timeout, process crash)
 * rather than a tool-level error (tool ran but returned error).
 *
 * Transport errors include:
 * - Connection refused/reset/closed (ECONNREFUSED, ECONNRESET, EPIPE)
 * - Timeouts (ETIMEDOUT)
 * - Transport layer errors from MCP SDK
 * - Process/binary errors (ENOENT, crash messages)
 *
 * @param error - The error to check
 * @returns true if this is a transport/infrastructure error, false if tool-level
 */
export function isTransportError(error: unknown): boolean {
  if (!error) return false;

  const errorMsg = getErrorMessage(error);

  // Safely extract error properties using type guards
  let errorName = "";
  let errorCode = "";

  if (typeof error === "object" && error !== null) {
    const errorObj = error as Record<string, unknown>;
    const name = errorObj.name;
    const code = errorObj.code;

    if (typeof name === "string") {
      errorName = name;
    }
    if (typeof code === "string") {
      errorCode = code;
    }
  }

  // Explicit error codes indicating transport failure
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH"].includes(errorCode)) {
    return true;
  }

  // Message patterns indicating transport failure
  if (
    errorMsg.includes("disconnected") ||
    errorMsg.includes("connection closed") ||
    errorMsg.includes("transport") ||
    errorMsg.includes("timeout") ||
    errorMsg.includes("ECONNREFUSED") ||
    errorMsg.includes("ECONNRESET") ||
    errorMsg.includes("refused") ||
    errorMsg.includes("reset by peer") ||
    errorMsg.includes("broken pipe") ||
    errorMsg.includes("EPIPE")
  ) {
    return true;
  }

  // MCP SDK specific errors
  if (errorName.includes("Transport") || errorName.includes("Connection")) {
    return true;
  }

  return false;
}

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
export async function createMcpClient(config: LoadedScanConfig): Promise<MCPClient> {
  // LoadedScanConfig guarantees all codeprism fields are populated, no null checks needed
  const command = config.codeprism.command;
  const args = config.codeprism.args;
  const timeout = config.codeprism.timeout;

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
  let ClientClass: MCPClientConstructor;
  let StdioClientTransportClass: MCPStdioTransportConstructor;

  try {
    const clientModule = await import("@modelcontextprotocol/sdk/client/index.js");
    ClientClass = clientModule.Client as unknown as MCPClientConstructor;

    const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js");
    StdioClientTransportClass = stdioModule.StdioClientTransport as unknown as MCPStdioTransportConstructor;
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

  let actualClient: MCPClientInstance | null = null;
  let actualTransport: MCPStdioTransport | null = transport;
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
        const result = await actualClient.callTool(
          {
            name: toolName,
            arguments: toolArgs,
          },
          {}
        );

        // Validate that the server response includes the content property
        if (!result.content || !Array.isArray(result.content)) {
          return [
            {
              type: "error" as const,
              text: `CodePrism returned malformed response: missing or invalid 'content' array`,
            },
          ];
        }

        // Convert MCP tool result to ToolResult format and validate against schema
        return result.content.map((content) => {
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
        // Distinguish between transport/infrastructure errors and tool-level errors.
        // Transport errors (connection lost, process crash, timeout) should be thrown
        // to fail the scan immediately, as remaining patterns are unreliable.
        // Tool-level errors (tool runs but fails) can be returned as error results.
        if (isTransportError(error)) {
          const errorMsg = getErrorMessage(error);
          throw new Error(
            `CodePrism connection lost while calling '${toolName}': ${errorMsg}\n\n` +
              "The MCP server may have crashed, become unreachable, or been terminated.\n" +
              "Remaining scan results are unreliable and the scan cannot continue."
          );
        }

        // For non-transport errors, return as a tool-level error result
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
          const response = await actualClient.listTools();
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
          await actualClient.close();
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
