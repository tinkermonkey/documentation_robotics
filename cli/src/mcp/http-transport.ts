/**
 * HTTP transport implementation for MCP server
 *
 * Provides an Express-based HTTP server exposing the MCP protocol over a /mcp endpoint
 * with per-session server/transport handling and bearer token authentication.
 */

import { Server as HttpServer } from "http";
import express, { Express, Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ApiKeyManager } from "./api-key-manager.js";

interface SessionData {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, SessionData>();

/**
 * Middleware to validate bearer token authentication.
 * Extracts and validates the Authorization header, rejecting with 401 if invalid.
 */
export function createBearerAuthMiddleware(keyManager: ApiKeyManager, expectedKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/);
    const providedKey = match ? match[1] : undefined;

    if (!keyManager.validate(providedKey, expectedKey)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

/**
 * Create an Express application configured for MCP HTTP transport.
 *
 * @param keyManager API key manager for authentication
 * @param apiKey The API key to authenticate requests
 * @param createServer Async function to create a configured MCP server
 */
export async function createMcpHttpApp(
  keyManager: ApiKeyManager,
  apiKey: string,
  createServer: () => Promise<McpServer>
): Promise<Express> {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.raw({ type: "application/octet-stream" }));

  // Apply bearer token authentication to all MCP endpoints
  app.use("/mcp", createBearerAuthMiddleware(keyManager, apiKey));

  // Handle POST requests for MCP protocol
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // Extract session ID from request headers if provided
      const requestedSessionId = req.headers["mcp-session-id"] as string | undefined;

      // Check if this is a continuation of an existing session
      if (requestedSessionId && sessions.has(requestedSessionId)) {
        // Reuse existing session
        const sessionData = sessions.get(requestedSessionId);
        if (sessionData) {
          try {
            await sessionData.transport.handleRequest(req, res, req.body);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "unknown error";
            process.stderr.write(`[mcp:http] POST handleRequest error: ${errorMsg}\n`);
            if (!res.headersSent) {
              res.status(500).json({ error: "Internal server error" });
            }
          }
          return;
        }
      }

      // Only create a new session for initialize requests
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request: initialize required for new session" }, id: null });
        return;
      }

      // Create a new session
      let server: McpServer | null = null;
      let transport: StreamableHTTPServerTransport | null = null;

      try {
        server = await createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });

        // Register onclose handler to clean up session when transport closes
        transport.onclose = () => {
          if (transport && transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        // Connect server to transport before handling the request
        await server.connect(transport);

        // Handle the request through the streamable HTTP transport
        await transport.handleRequest(req, res, req.body);

        // Store session data for later cleanup after handleRequest completes and sessionId is set
        const sessionId = transport.sessionId;
        if (sessionId && !sessions.has(sessionId)) {
          sessions.set(sessionId, { server, transport });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "unknown error";
        process.stderr.write(`[mcp:http] POST setup error: ${errorMsg}\n`);

        // Clean up resources on setup failure
        if (transport) {
          try {
            await transport.close();
          } catch (closeError) {
            process.stderr.write(
              `[mcp:http] Error closing transport during cleanup: ${
                closeError instanceof Error ? closeError.message : "unknown error"
              }\n`
            );
          }
        }
        if (server) {
          try {
            await server.close();
          } catch (closeError) {
            process.stderr.write(
              `[mcp:http] Error closing server during cleanup: ${
                closeError instanceof Error ? closeError.message : "unknown error"
              }\n`
            );
          }
        }

        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`[mcp:http] POST outer error: ${errorMsg}\n`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Handle GET requests for SSE streams
  app.get("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: "Invalid or missing session ID" });
        return;
      }

      const sessionData = sessions.get(sessionId);
      if (!sessionData) {
        res.status(400).json({ error: "Session not found" });
        return;
      }

      // Reuse the existing transport for this session
      await sessionData.transport.handleRequest(req, res);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`[mcp:http] GET handleRequest error: ${errorMsg}\n`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Handle DELETE requests for session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
      res.status(400).json({ error: "Session not found" });
      return;
    }

    try {
      // Handle the DELETE request through the transport
      await sessionData.transport.handleRequest(req, res);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "unknown error";
      process.stderr.write(`[mcp:http] DELETE handleRequest error: ${errorMsg}\n`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    } finally {
      // Always clean up the session, even if handleRequest throws
      sessions.delete(sessionId);
    }
  });

  return app;
}

/**
 * Start the HTTP server and return the listening HttpServer instance.
 *
 * @param app Express application
 * @param host Host address to bind to
 * @param port Port to bind to
 * @returns HttpServer instance when listening
 */
export async function startHttpServer(
  app: Express,
  host: string,
  port: number
): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });

    server.once("error", reject);
  });
}

/**
 * Gracefully close all active sessions and the HTTP server.
 *
 * @param server HttpServer instance
 */
export async function closeHttpServer(server: HttpServer): Promise<void> {
  // Close all active sessions
  for (const [sessionId, { transport }] of sessions.entries()) {
    try {
      await transport.close();
      sessions.delete(sessionId);
    } catch (error) {
      // Log but continue closing other sessions
      process.stderr.write(
        `[mcp] Error closing session ${sessionId}: ${
          error instanceof Error ? error.message : "unknown error"
        }\n`
      );
    }
  }

  // Close the HTTP server
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
