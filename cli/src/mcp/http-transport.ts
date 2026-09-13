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
function createBearerAuthMiddleware(keyManager: ApiKeyManager, expectedKey: string) {
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
          await sessionData.transport.handleRequest(req, res, req.body);
          return;
        }
      }

      // Create a new session
      const server = await createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

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
      const message = error instanceof Error ? error.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
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
      const message = error instanceof Error ? error.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  });

  // Handle DELETE requests for session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
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

      // Handle the DELETE request through the transport
      await sessionData.transport.handleRequest(req, res);

      // Clean up the session
      sessions.delete(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
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
