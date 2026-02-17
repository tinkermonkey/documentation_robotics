/**
 * Visualization Server
 * HTTP server with WebSocket support for real-time model updates
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import { serve } from "bun";
import { Model } from "../core/model.js";
import { Element } from "../core/element.js";
import { telemetryMiddleware } from "./telemetry-middleware.js";
import { BaseChatClient } from "../coding-agents/base-chat-client.js";
import { ClaudeCodeClient } from "../coding-agents/claude-code-client.js";
import { CopilotClient } from "../coding-agents/copilot-client.js";
import { detectAvailableClients, selectChatClient } from "../coding-agents/chat-utils.js";
import { getErrorMessage } from "../utils/errors.js";
import {
  AnnotationCreateSchema,
  AnnotationUpdateSchema,
  AnnotationReplyCreateSchema,
  LayerNameSchema,
  IdSchema,
  AnnotationFilterSchema,
  ElementIdSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  AnnotationSchema,
  AnnotationReplySchema,
  AnnotationsListSchema,
  ChangesetsListSchema,
  ModelResponseSchema,
  LayerResponseSchema,
  ElementResponseSchema,
  SpecResponseSchema,
  ChangesetDetailSchema,
  AnnotationRepliesSchema,
} from "./schemas.js";

/**
 * JSON-RPC 2.0 Error Codes
 * Standard error codes for JSON-RPC error responses
 */
const JSONRPC_ERRORS = {
  // Standard JSON-RPC errors
  INVALID_PARAMS: -32602,      // Invalid method parameters
  METHOD_NOT_FOUND: -32601,    // Method does not exist
  INTERNAL_ERROR: -32603,      // Internal server error

  // Custom application errors
  NO_CLIENT_AVAILABLE: -32001, // No chat client available
} as const;

// Simple WebSocket messages
interface SimpleWSMessage {
  type: "subscribe" | "annotate" | "ping";
  topics?: string[];
  annotation?: {
    elementId: string;
    author: string;
    text: string;
    timestamp: string;
  };
}

// JSON-RPC 2.0 messages
interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id?: string | number;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

// Discriminated union of WebSocket message types
type WSMessage = SimpleWSMessage | JSONRPCRequest | JSONRPCResponse;

interface AnnotationReply {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

// Derive ClientAnnotation type from AnnotationSchema with proper serialization
type ClientAnnotation = z.infer<typeof AnnotationSchema>;

interface Changeset {
  metadata: {
    id: string;
    name: string;
    description?: string;
    type: "feature" | "bugfix" | "exploration";
    status: "active" | "applied" | "abandoned";
    created_at: string;
    updated_at?: string;
    workflow?: string;
    summary: {
      elements_added: number;
      elements_updated: number;
      elements_deleted: number;
    };
  };
  changes: {
    version: string;
    changes: Array<{
      timestamp: string;
      operation: "add" | "update" | "delete";
      element_id: string;
      layer: string;
      element_type: string;
      data?: any;
      before?: any;
      after?: any;
    }>;
  };
}

// Type for WebSocket context from Hono/Bun
// Defines the interface for WebSocket operations within the Hono/Bun environment
interface HonoWSContext {
  send(source: string | ArrayBuffer | Uint8Array | ArrayBufferView, options?: any): void;
  close(code?: number, reason?: string): void;
}

export interface VisualizationServerOptions {
  authEnabled?: boolean;
  authToken?: string;
  withDanger?: boolean;
  viewerPath?: string;
}

/**
 * Visualization Server class
 */
export class VisualizationServer {
  private app: OpenAPIHono;
  private model: Model;
  private _server?: ReturnType<typeof serve>;
  private clients: Set<HonoWSContext> = new Set();
  private watcher?: any;
  private annotations: Map<string, ClientAnnotation> = new Map(); // annotationId -> annotation
  private annotationsByElement: Map<string, Set<string>> = new Map(); // elementId -> Set<annotationId>
  private replies: Map<string, AnnotationReply[]> = new Map(); // annotationId -> replies[]
  private changesets: Map<string, Changeset> = new Map(); // changesetId -> changeset
  private authToken: string;
  private authEnabled: boolean = true; // Enabled by default for security
  private withDanger: boolean = false; // Danger mode disabled by default
  private viewerPath?: string; // Optional custom viewer path
  private activeChatProcesses: Map<string, any> = new Map(); // conversationId -> Bun.spawn process
  private chatConversationCounter: number = 0;
  private selectedChatClient?: BaseChatClient; // Selected chat client for server
  private chatInitializationError?: Error; // Store initialization error for status endpoint

  constructor(model: Model, options?: VisualizationServerOptions) {
    this.app = new OpenAPIHono();
    this.model = model;

    // Auth configuration (CLI options override environment variables)
    this.authEnabled = options?.authEnabled ?? process.env.DR_AUTH_ENABLED !== "false";
    this.authToken = options?.authToken || process.env.DR_AUTH_TOKEN || this.generateAuthToken();
    this.withDanger = options?.withDanger || false;
    this.viewerPath = options?.viewerPath;

    // Add CORS middleware
    this.app.use("/*", cors());

    // Add telemetry middleware to instrument all HTTP requests
    this.app.use("/*", telemetryMiddleware);

    // Add authentication middleware (except for health endpoint and root)
    this.app.use("/api/*", async (c, next) => {
      if (!this.authEnabled) {
        return next();
      }

      // Check for token in Authorization header or query parameter
      const authHeader = c.req.header("Authorization");
      const queryToken = c.req.query("token");

      let providedToken: string | null = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        providedToken = authHeader.substring(7);
      } else if (queryToken) {
        providedToken = queryToken;
      }

      if (!providedToken) {
        return c.json({ error: "Authentication required. Please provide a valid token." }, 401);
      }

      if (providedToken !== this.authToken) {
        return c.json({ error: "Invalid authentication token" }, 403);
      }

      return next();
    });

    this.setupRoutes();

    // Log auth token if enabled
    if (this.authEnabled && process.env.VERBOSE) {
      console.log(`[Auth] Authentication enabled. Token: ${this.authToken}`);
    }

    // Initialize chat clients asynchronously
    this.initializeChatClients().catch((error) => {
      this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
      console.error("[Chat] Failed to initialize chat clients:", error);
    });
  }

  /**
   * Detect and initialize available chat clients
   */
  private async initializeChatClients(): Promise<void> {
    const clients = await detectAvailableClients();

    // Select the chat client based on manifest preference
    const preferredAgent = this.model.manifest.getCodingAgent();
    this.selectedChatClient = selectChatClient(clients, preferredAgent);

    // Log warnings/info if needed
    if (
      preferredAgent &&
      this.selectedChatClient &&
      this.selectedChatClient.getClientName() !== preferredAgent
    ) {
      console.warn(
        `[Chat] Preferred client "${preferredAgent}" not available, using ${this.selectedChatClient.getClientName()}`
      );
    }

    if (this.selectedChatClient && process.env.VERBOSE) {
      console.log(`[Chat] Using chat client: ${this.selectedChatClient.getClientName()}`);
    } else if (clients.length === 0 && process.env.VERBOSE) {
      console.log("[Chat] No chat clients available");
    }
  }

  /**
   * Generate a random auth token
   */
  private generateAuthToken(): string {
    return `dr-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Setup HTTP routes and WebSocket handler
   */
  private setupRoutes(): void {
    // Static viewer HTML at root
    this.app.get("/", (c) => {
      if (this.viewerPath) {
        // Serve custom viewer index.html
        return this.serveCustomViewer("index.html");
      }
      return c.html(this.getViewerHTML());
    });

    // Serve static files from custom viewer path if provided
    // Note: This catch-all route must skip API/WS routes by passing to next handler
    if (this.viewerPath) {
      this.app.get("/*", async (c, next) => {
        const requestPath = c.req.path;
        if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all matched: ${requestPath}`);

        // Skip API routes and WebSocket - let them be handled by their specific routes
        if (requestPath.startsWith("/api/") || requestPath === "/ws" || requestPath === "/health" || requestPath === "/api-spec.yaml" || requestPath === "/api-docs") {
          if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all delegating to next handler for: ${requestPath}`);
          return next(); // Pass to next handler instead of returning 404
        }

        if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all serving custom viewer file: ${requestPath}`);
        return this.serveCustomViewer(requestPath.substring(1));
      });
    }

    // Health check endpoint
    const healthRoute = createRoute({
      method: 'get',
      path: '/health',
      tags: ['Health'],
      summary: 'Health check',
      description: 'Check if the server is running and healthy',
      responses: {
        200: {
          description: 'Server is healthy',
          content: {
            'application/json': {
              schema: HealthResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(healthRoute, (c) => {
      return c.json({
        status: "ok",
        version: "0.1.0",
      });
    });

    // Get full model
    const getModelRoute = createRoute({
      method: 'get',
      path: '/api/model',
      tags: ['Model'],
      summary: 'Get full model',
      description: 'Retrieve the complete architecture model across all layers',
      responses: {
        200: {
          description: 'Model data retrieved successfully',
          content: {
            'application/json': {
              schema: ModelResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getModelRoute, async (c) => {
      if (process.env.VERBOSE) console.log(`[ROUTE] /api/model handler called`);
      try {
        if (process.env.VERBOSE) console.log(`[ROUTE] /api/model serializing model...`);
        const modelData = await this.serializeModel();
        if (process.env.VERBOSE)
          console.log(
            `[ROUTE] /api/model returning ${Object.keys(modelData.layers || {}).length} layers`
          );
        return c.json(modelData);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error(`[ROUTE] /api/model error: ${message}`);
        return c.json({ error: message }, 500);
      }
    });

    // Get specific layer
    const getLayerRoute = createRoute({
      method: 'get',
      path: '/api/layers/:name',
      tags: ['Model'],
      summary: 'Get layer',
      description: 'Retrieve a specific layer with all its elements',
      request: {
        params: z.object({ name: LayerNameSchema }),
      },
      responses: {
        200: {
          description: 'Layer retrieved successfully',
          content: {
            'application/json': {
              schema: LayerResponseSchema,
            },
          },
        },
        404: {
          description: 'Layer not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getLayerRoute, (async (c: any) => {
      try {
        const { name: layerName } = c.req.valid("param");
        const layer = await this.model.getLayer(layerName);

        if (!layer) {
          return c.json({ error: "Layer not found" }, 404);
        }

        const elements = layer.listElements().map((e) => e.toJSON());

        return c.json({
          name: layerName,
          elements,
          elementCount: elements.length,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Get specific element
    const getElementRoute = createRoute({
      method: 'get',
      path: '/api/elements/:id',
      tags: ['Model'],
      summary: 'Get element',
      description: 'Retrieve a specific architecture element with its metadata and annotations',
      request: {
        params: z.object({ id: ElementIdSchema }),
      },
      responses: {
        200: {
          description: 'Element retrieved successfully',
          content: {
            'application/json': {
              schema: ElementResponseSchema,
            },
          },
        },
        404: {
          description: 'Element not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getElementRoute, (async (c: any) => {
      try {
        const { id: elementId } = c.req.valid("param");
        const element = await this.findElement(elementId);

        if (!element) {
          return c.json({ error: "Element not found" }, 404);
        }

        return c.json({
          ...element.toJSON(),
          annotations: this.annotations.get(elementId) || [],
        });
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Get JSON Schema specifications
    const getSpecRoute = createRoute({
      method: 'get',
      path: '/api/spec',
      tags: ['Schema'],
      summary: 'Get JSON schemas',
      description: 'Retrieve all JSON Schema definitions used by the system',
      responses: {
        200: {
          description: 'Schemas retrieved successfully',
          content: {
            'application/json': {
              schema: SpecResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getSpecRoute, (async (c: any) => {
      try {
        const schemas = await this.loadSchemas();
        return c.json({
          version: "0.1.0",
          type: "schema-collection",
          description: "JSON Schema definitions from dr CLI",
          source: "dr-cli",
          schemas,
          schemaCount: Object.keys(schemas).length,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Annotations API (spec-compliant routes)

    // Get all annotations (optionally filtered by elementId)
    const getAnnotationsRoute = createRoute({
      method: 'get',
      path: '/api/annotations',
      tags: ['Annotations'],
      summary: 'Get annotations',
      description: 'Retrieve all annotations, optionally filtered by element',
      request: {
        query: AnnotationFilterSchema,
      },
      responses: {
        200: {
          description: 'Annotations retrieved successfully',
          content: {
            'application/json': {
              schema: AnnotationsListSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getAnnotationsRoute, (c) => {
      const query = c.req.valid("query");
      const elementId = query.elementId;

      if (elementId) {
        // Filter by element
        const annotationIds = this.annotationsByElement.get(elementId) || new Set();
        const annotations = Array.from(annotationIds)
          .map((id) => this.annotations.get(id))
          .filter((a): a is ClientAnnotation => a !== undefined);

        return c.json({ annotations });
      } else {
        // Return all annotations
        const annotations = Array.from(this.annotations.values());
        return c.json({ annotations });
      }
    });

    // Create annotation
    const createAnnotationRoute = createRoute({
      method: 'post',
      path: '/api/annotations',
      tags: ['Annotations'],
      summary: 'Create annotation',
      description: 'Create a new annotation on a model element',
      request: {
        body: {
          content: {
            'application/json': {
              schema: AnnotationCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Annotation created successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        400: {
          description: 'Invalid request body',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        404: {
          description: 'Element not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(createAnnotationRoute, async (c) => {
      try {
        const body = c.req.valid("json");

        // Verify element exists
        const element = await this.findElement(body.elementId);
        if (!element) {
          return c.json({ error: "Element not found" }, 404);
        }

        // Create annotation
        const annotation: ClientAnnotation = {
          id: this.generateAnnotationId(),
          elementId: body.elementId,
          author: body.author,
          content: body.content,
          createdAt: new Date().toISOString(),
          tags: body.tags,
          resolved: false, // Default to unresolved
        };

        // Store annotation
        this.annotations.set(annotation.id, annotation);
        if (!this.annotationsByElement.has(annotation.elementId)) {
          this.annotationsByElement.set(annotation.elementId, new Set());
        }
        this.annotationsByElement.get(annotation.elementId)!.add(annotation.id);

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.added",
          annotationId: annotation.id,
          elementId: annotation.elementId,
          timestamp: annotation.createdAt,
        });

        return c.json(annotation, 201);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // Update annotation (PUT - partial update for compatibility)
    const putAnnotationRoute = createRoute({
      method: 'put',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Update annotation',
      description: 'Update an existing annotation (only provided fields are updated)',
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationUpdateSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Annotation updated successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(putAnnotationRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        const body = c.req.valid("json");

        // Update only provided fields (same as PATCH for compatibility)
        if (body.content !== undefined) {
          annotation.content = body.content;
        }
        if (body.tags !== undefined) {
          annotation.tags = body.tags;
        }
        if (body.resolved !== undefined) {
          annotation.resolved = body.resolved;
        }
        annotation.updatedAt = new Date().toISOString();

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.updated",
          annotationId: annotation.id,
          timestamp: annotation.updatedAt,
        });

        return c.json(annotation);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Update annotation (PATCH)
    const patchAnnotationRoute = createRoute({
      method: 'patch',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Partially update annotation',
      description: 'Partially update an existing annotation (recommended over PUT)',
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationUpdateSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Annotation updated successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(patchAnnotationRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        const body = c.req.valid("json");

        // Update only provided fields (partial update)
        if (body.content !== undefined) {
          annotation.content = body.content;
        }
        if (body.tags !== undefined) {
          annotation.tags = body.tags;
        }
        if (body.resolved !== undefined) {
          annotation.resolved = body.resolved;
        }
        annotation.updatedAt = new Date().toISOString();

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.updated",
          annotationId: annotation.id,
          timestamp: annotation.updatedAt,
        });

        return c.json(annotation);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Delete annotation
    const deleteAnnotationRoute = createRoute({
      method: 'delete',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Delete annotation',
      description: 'Delete an existing annotation',
      request: {
        params: z.object({ annotationId: IdSchema }),
      },
      responses: {
        204: {
          description: 'Annotation deleted successfully',
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(deleteAnnotationRoute, async (c) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        // Remove from storage
        this.annotations.delete(annotationId);
        this.replies.delete(annotationId); // Clean up replies
        const elementAnnotations = this.annotationsByElement.get(annotation.elementId);
        if (elementAnnotations) {
          elementAnnotations.delete(annotationId);
        }

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.deleted",
          annotationId,
          timestamp: new Date().toISOString(),
        });

        return c.body(null, 204);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // GET annotation replies
    const getAnnotationRepliesRoute = createRoute({
      method: 'get',
      path: '/api/annotations/:annotationId/replies',
      tags: ['Annotations'],
      summary: 'Get annotation replies',
      description: 'Retrieve all replies to an annotation',
      request: {
        params: z.object({ annotationId: IdSchema }),
      },
      responses: {
        200: {
          description: 'Replies retrieved successfully',
          content: {
            'application/json': {
              schema: AnnotationRepliesSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getAnnotationRepliesRoute, ((c: any) => {
      const { annotationId } = c.req.valid("param");
      const annotation = this.annotations.get(annotationId);

      if (!annotation) {
        return c.json({ error: "Annotation not found" }, 404);
      }

      const replies = this.replies.get(annotationId) || [];
      return c.json({ replies });
    }) as any);

    // POST annotation reply
    const createAnnotationReplyRoute = createRoute({
      method: 'post',
      path: '/api/annotations/:annotationId/replies',
      tags: ['Annotations'],
      summary: 'Create annotation reply',
      description: 'Add a reply to an annotation',
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationReplyCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Reply created successfully',
          content: {
            'application/json': {
              schema: AnnotationReplySchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(createAnnotationReplyRoute, async (c) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        const body = c.req.valid("json");

        const reply: AnnotationReply = {
          id: this.generateReplyId(),
          author: body.author,
          content: body.content,
          createdAt: new Date().toISOString(),
        };

        // Store reply
        if (!this.replies.has(annotationId)) {
          this.replies.set(annotationId, []);
        }
        this.replies.get(annotationId)!.push(reply);

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.reply.added",
          annotationId,
          replyId: reply.id,
          timestamp: reply.createdAt,
        });

        return c.json(reply, 201);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // Changesets API

    // Get all changesets
    const getChangesetsRoute = createRoute({
      method: 'get',
      path: '/api/changesets',
      tags: ['Changesets'],
      summary: 'Get changesets',
      description: 'Retrieve a list of all changesets',
      responses: {
        200: {
          description: 'Changesets retrieved successfully',
          content: {
            'application/json': {
              schema: ChangesetsListSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getChangesetsRoute, (c) => {
      const changesets: Record<string, any> = {};

      for (const [id, changeset] of this.changesets) {
        changesets[id] = {
          name: changeset.metadata.name,
          status: changeset.metadata.status,
          type: changeset.metadata.type,
          created_at: changeset.metadata.created_at,
          elements_count: changeset.changes.changes.length,
        };
      }

      return c.json({
        version: "1.0.0",
        changesets,
      });
    });

    // Get specific changeset
    const getChangesetRoute = createRoute({
      method: 'get',
      path: '/api/changesets/:changesetId',
      tags: ['Changesets'],
      summary: 'Get changeset',
      description: 'Retrieve a specific changeset with all its changes',
      request: {
        params: z.object({ changesetId: IdSchema }),
      },
      responses: {
        200: {
          description: 'Changeset retrieved successfully',
          content: {
            'application/json': {
              schema: ChangesetDetailSchema,
            },
          },
        },
        404: {
          description: 'Changeset not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(getChangesetRoute, ((c: any) => {
      const { changesetId } = c.req.valid("param");
      const changeset = this.changesets.get(changesetId);

      if (!changeset) {
        return c.json({ error: "Changeset not found" }, 404);
      }

      return c.json(changeset);
    }) as any);

    // OpenAPI documentation endpoint
    this.app.doc('/api-spec.yaml', {
      openapi: '3.1.0',
      info: {
        title: 'Documentation Robotics Visualization Server API',
        version: '0.1.0',
        description: 'API specification for the DR CLI visualization server',
        contact: {
          name: 'Documentation Robotics',
          url: 'https://github.com/tinkermonkey/documentation_robotics',
        },
        license: {
          name: 'ISC',
        },
      },
      servers: [
        { url: 'http://localhost:8080', description: 'Local development server' },
      ],
      tags: [
        { name: 'Health', description: 'Server health and status' },
        { name: 'Schema', description: 'JSON Schema specifications' },
        { name: 'Model', description: 'Architecture model data' },
        { name: 'Changesets', description: 'Model changesets and history' },
        { name: 'Annotations', description: 'User annotations on model elements' },
        { name: 'WebSocket', description: 'Real-time updates via WebSocket' },
      ],
    });

    // Swagger UI for interactive API exploration
    this.app.get('/api-docs', swaggerUI({ url: '/api-spec.yaml' }));

    // WebSocket endpoint
    this.app.get(
      "/ws",
      async (c, next) => {
        // Check WebSocket auth if enabled
        if (this.authEnabled) {
          // Accept token from multiple sources:
          // 1. Query parameter: ?token=<token> (works in all browsers)
          // 2. Sec-WebSocket-Protocol header: token, <actual-token> (browser-compatible workaround)
          // 3. Authorization header: Bearer <token> (non-browser clients only)

          const queryToken = c.req.query("token");

          // Check Sec-WebSocket-Protocol header (browser-compatible method)
          // Format: "token, <actual-token>" or "token,<actual-token>"
          const wsProtocol = c.req.header("Sec-WebSocket-Protocol");
          let protocolToken: string | null = null;
          if (wsProtocol) {
            const protocols = wsProtocol.split(",").map((p) => p.trim());
            // Look for protocol pair: ['token', '<actual-token>']
            const tokenIndex = protocols.indexOf("token");
            if (tokenIndex !== -1 && protocols.length > tokenIndex + 1) {
              protocolToken = protocols[tokenIndex + 1];
            }
          }

          // Check Authorization header (non-browser clients)
          const authHeader = c.req.header("Authorization");
          const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

          const token = queryToken || protocolToken || bearerToken;

          if (!token) {
            return c.json(
              {
                error:
                  'Authentication required. Provide token via: 1) Query param (?token=YOUR_TOKEN), 2) Sec-WebSocket-Protocol header (browser: new WebSocket(url, ["token", "YOUR_TOKEN"])), or 3) Authorization header (Bearer YOUR_TOKEN)',
              },
              401
            );
          }

          if (token !== this.authToken) {
            return c.json({ error: "Invalid authentication token" }, 403);
          }

          // If token came from Sec-WebSocket-Protocol, we need to respond with the protocol
          // This is required by the WebSocket spec for subprotocol negotiation
          if (protocolToken) {
            c.header("Sec-WebSocket-Protocol", "token");
          }
        }

        return next();
      },
      upgradeWebSocket(() => ({
        onOpen: async (_evt, ws) => {
          // Telemetry: Track WebSocket connection
          await this.recordWebSocketEvent("ws.connection.open", {
            "ws.client_count": this.clients.size + 1,
          });

          this.clients.add(ws);

          // Send connected message per spec
          ws.send(
            JSON.stringify({
              type: "connected",
              version: "0.1.0",
              timestamp: new Date().toISOString(),
            })
          );

          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client connected (total: ${this.clients.size})`);
          }
        },

        onClose: async (_evt, ws) => {
          // Telemetry: Track WebSocket disconnection
          await this.recordWebSocketEvent("ws.connection.close", {
            "ws.client_count": this.clients.size - 1,
          });

          this.clients.delete(ws);
          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client disconnected (total: ${this.clients.size})`);
          }
        },

        onMessage: async (message, ws) => {
          const messageStartTime = Date.now();
          let messageType = "unknown";

          try {
            // Extract the actual message data
            // In Hono/Bun, message is a MessageEvent with a data property
            const rawData = (message as any).data ?? message;

            // Handle different message types (string, Buffer, ArrayBuffer)
            let msgStr: string;
            if (typeof rawData === "string") {
              msgStr = rawData;
            } else if (rawData instanceof Buffer || rawData instanceof Uint8Array) {
              msgStr = new TextDecoder().decode(rawData);
            } else {
              msgStr = String(rawData);
            }
            const data = JSON.parse(msgStr) as WSMessage;
            const parsedData = data as any;
            messageType =
              parsedData.jsonrpc === "2.0" ? parsedData.method || "jsonrpc" : parsedData.type || "unknown";

            // Telemetry: Track message processing
            await this.recordWebSocketEvent("ws.message.received", {
              "ws.message.type": messageType,
              "ws.message.size_bytes": msgStr.length,
            });

            // Check if it's a JSON-RPC message
            if (parsedData.jsonrpc === "2.0") {
              await this.handleJSONRPCMessage(ws, data);
            } else {
              await this.handleWSMessage(ws, data);
            }

            // Telemetry: Track successful message processing
            const durationMs = Date.now() - messageStartTime;
            await this.recordWebSocketEvent("ws.message.processed", {
              "ws.message.type": messageType,
              "ws.message.duration_ms": durationMs,
              "ws.message.status": "success",
            });
          } catch (error) {
            const errorMsg = getErrorMessage(error);
            const durationMs = Date.now() - messageStartTime;

            // Telemetry: Track message processing error
            await this.recordWebSocketEvent("ws.message.error", {
              "ws.message.type": messageType,
              "ws.message.duration_ms": durationMs,
              "ws.message.status": "error",
              "error.message": errorMsg,
            });

            console.warn(`[WebSocket] Error handling message: ${errorMsg}`);
            ws.send(
              JSON.stringify({
                type: "error",
                message: errorMsg,
              })
            );
          }
        },

        onError: async (error) => {
          const message = getErrorMessage(error);

          // Telemetry: Track WebSocket error
          await this.recordWebSocketEvent("ws.error", {
            "error.type": error instanceof Error ? error.constructor.name : "unknown",
            "error.message": message,
          });

          console.error(`[WebSocket] Error: ${message}`);
        },
      }))
    );
  }

  /**
   * Get OpenAPI specification document
   * Provides a stable public API for OpenAPI spec generation
   */
  public getOpenAPIDocument(config: {
    openapi: string;
    info: {
      title: string;
      version: string;
      description?: string;
      contact?: { name?: string; url?: string };
      license?: { name: string };
    };
    servers?: Array<{ url: string; description?: string }>;
  }): any {
    return this.app.getOpenAPI31Document(config);
  }

  /**
   * Serialize model to JSON for client consumption
   */
  private async serializeModel(): Promise<any> {
    const layers: any = {};

    for (const [name, layer] of this.model.layers) {
      const elements = layer.listElements().map((e) => {
        const annotationIds = this.annotationsByElement.get(e.id) || new Set();
        const annotations = Array.from(annotationIds)
          .map((id) => {
            const annotation = this.annotations.get(id);
            if (!annotation) return undefined;

            // Include replies in annotation response
            const replies = this.replies.get(id) || [];
            return { ...annotation, replies };
          })
          .filter((a) => a !== undefined);

        return {
          ...e.toJSON(),
          annotations,
        };
      });

      layers[name] = {
        name,
        elements,
        elementCount: elements.length,
      };
    }

    return {
      manifest: this.model.manifest.toJSON(),
      layers,
      totalElements: Array.from(this.model.layers.values()).reduce(
        (sum, layer) => sum + layer.listElements().length,
        0
      ),
    };
  }

  /**
   * Generate unique annotation ID
   */
  private generateAnnotationId(): string {
    return `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique reply ID
   */
  private generateReplyId(): string {
    return `reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private async broadcastMessage(message: any): Promise<void> {
    const messageStr = JSON.stringify(message);
    const messageType = message.type || "unknown";

    // Telemetry: Track broadcast start
    await this.recordWebSocketEvent("ws.broadcast.start", {
      "ws.broadcast.type": messageType,
      "ws.broadcast.client_count": this.clients.size,
      "ws.broadcast.message_size_bytes": messageStr.length,
    });

    let failureCount = 0;
    for (const client of this.clients) {
      try {
        client.send(messageStr);
      } catch (error) {
        failureCount++;
        const msg = getErrorMessage(error);
        console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
      }
    }

    // Telemetry: Track broadcast completion
    await this.recordWebSocketEvent("ws.broadcast.complete", {
      "ws.broadcast.type": messageType,
      "ws.broadcast.success_count": this.clients.size - failureCount,
      "ws.broadcast.failure_count": failureCount,
    });

    if (failureCount > 0) {
      console.warn(
        `[WebSocket] Failed to send message to ${failureCount}/${this.clients.size} clients`
      );
    }
  }

  /**
   * Record WebSocket telemetry event
   * Creates spans for WebSocket operations when telemetry is enabled
   */
  private async recordWebSocketEvent(
    eventName: string,
    attributes: Record<string, any>
  ): Promise<void> {
    // Check if telemetry is enabled (compile-time constant set by esbuild)
    // @ts-ignore - TELEMETRY_ENABLED is a global constant defined at build time
    const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

    if (!isTelemetryEnabled) {
      return;
    }

    try {
      // Dynamic import for tree-shaking
      const { startSpan, endSpan } = await import("../telemetry/index.js");

      // Create span for WebSocket event
      const span = startSpan(eventName, attributes);

      // End span immediately (WebSocket events are typically instantaneous)
      endSpan(span);
    } catch (error) {
      // Log telemetry failures to enable production debugging
      console.warn(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Find an element across all layers
   */
  private async findElement(id: string): Promise<Element | null> {
    for (const layer of this.model.layers.values()) {
      const element = layer.getElement(id);
      if (element) return element;
    }
    return null;
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWSMessage(ws: HonoWSContext, data: WSMessage): Promise<void> {
    const simpleMsg = data as SimpleWSMessage;
    switch (simpleMsg.type) {
      case "subscribe":
        // Send subscribed confirmation
        const topics = simpleMsg.topics || ["model", "annotations"];
        ws.send(
          JSON.stringify({
            type: "subscribed",
            topics,
            timestamp: new Date().toISOString(),
          })
        );

        // Send initial model state
        const modelData = await this.serializeModel();
        ws.send(
          JSON.stringify({
            type: "model",
            data: modelData,
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "ping":
        // Respond with pong
        ws.send(
          JSON.stringify({
            type: "pong",
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "annotate":
        if (simpleMsg.annotation) {
          await this.broadcastMessage({
            type: "annotation",
            data: simpleMsg.annotation,
          });
        }
        break;

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type: ${simpleMsg.type}`,
          })
        );
    }
  }

  /**
   * Handle JSON-RPC 2.0 messages for chat functionality
   */
  private async handleJSONRPCMessage(ws: HonoWSContext, data: WSMessage): Promise<void> {
    const rpcMsg = data as JSONRPCRequest;
    const { method, params, id } = rpcMsg;

    // Helper to send JSON-RPC response
    const sendResponse = (result: any) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          result,
          id,
        })
      );
    };

    // Helper to send JSON-RPC error
    const sendError = (code: number, message: string, data?: any) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code, message, data },
          id,
        })
      );
    };

    try {
      switch (method) {
        case "chat.status":
          // Check if any chat client is available
          const hasClient = this.selectedChatClient !== undefined;

          // Determine error message: initialization error takes precedence
          let statusError: string | null = null;
          if (this.chatInitializationError) {
            statusError = `Chat initialization failed: ${this.chatInitializationError.message}`;
          } else if (!hasClient) {
            statusError = "No chat client available. Install Claude Code or GitHub Copilot.";
          }

          sendResponse({
            sdk_available: hasClient,
            sdk_version: hasClient ? this.selectedChatClient!.getClientName() : null,
            error_message: statusError,
          });
          break;

        case "chat.send":
          // Validate params
          if (!params || !params.message) {
            sendError(JSONRPC_ERRORS.INVALID_PARAMS, "Message cannot be empty");
            return;
          }

          // Check if chat client is available
          if (!this.selectedChatClient) {
            sendError(
              JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
              "No chat client available. Install Claude Code or GitHub Copilot to enable chat."
            );
            return;
          }

          // Generate conversation ID
          const conversationId = `conv-${++this.chatConversationCounter}-${Date.now()}`;

          // Launch chat with selected client
          await this.launchChat(ws, conversationId, params.message, id);
          break;

        case "chat.cancel":
          // Find and cancel any active conversation
          let cancelled = false;
          let cancelledConvId = null;

          for (const [convId, process] of this.activeChatProcesses) {
            try {
              process.kill();
              this.activeChatProcesses.delete(convId);
              cancelled = true;
              cancelledConvId = convId;
              break;
            } catch (error) {
              console.warn(`[Chat] Failed to cancel process for conversation ${convId}: ${getErrorMessage(error)}`);
            }
          }

          sendResponse({
            cancelled,
            conversation_id: cancelledConvId,
          });
          break;

        default:
          sendError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      sendError(JSONRPC_ERRORS.INTERNAL_ERROR, "Internal error", errorMsg);
    }
  }

  /**
   * Launch chat with selected client and stream responses via WebSocket
   */
  private async launchChat(
    ws: HonoWSContext,
    conversationId: string,
    message: string,
    requestId: string | number | undefined
  ): Promise<void> {
    if (!this.selectedChatClient) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
            message: "No chat client available",
          },
          id: requestId,
        })
      );
      return;
    }

    // Route to appropriate client-specific handler
    if (this.selectedChatClient instanceof ClaudeCodeClient) {
      await this.launchClaudeCodeChat(ws, conversationId, message, requestId);
    } else if (this.selectedChatClient instanceof CopilotClient) {
      await this.launchCopilotChat(ws, conversationId, message, requestId);
    } else {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
            message: "Unknown chat client type",
          },
          id: requestId,
        })
      );
    }
  }

  /**
   * Launch Claude Code CLI with dr-architect agent and stream responses
   */
  private async launchClaudeCodeChat(
    ws: HonoWSContext,
    conversationId: string,
    message: string,
    requestId: string | number | undefined
  ): Promise<void> {
    try {
      // Build command arguments
      const cmd = ["claude", "--agent", "dr-architect", "--print"];

      // Add dangerously-skip-permissions flag if withDanger is enabled
      if (this.withDanger) {
        cmd.push("--dangerously-skip-permissions");
      }

      cmd.push("--verbose", "--output-format", "stream-json");

      // Launch claude with dr-architect agent for comprehensive DR expertise
      const proc = Bun.spawn({
        cmd,
        cwd: this.model.rootPath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Store active process
      this.activeChatProcesses.set(conversationId, proc);

      // Send user message via stdin (like Python prototype)
      proc.stdin?.write(new TextEncoder().encode(message));
      proc.stdin?.end();

      // Stream stdout (JSON events)
      const stdoutReader = proc.stdout.getReader();
      const decoder = new TextDecoder();

      const streamOutput = async () => {
        let accumulatedText = "";
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Process complete lines (JSON events)
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const event = JSON.parse(line);

                if (event.type === "assistant") {
                  // Extract content blocks from assistant message
                  const content = event.message?.content || [];
                  for (const block of content) {
                    if (block.type === "text") {
                      accumulatedText += block.text;
                      // Send text chunk notification
                      ws.send(
                        JSON.stringify({
                          jsonrpc: "2.0",
                          method: "chat.response.chunk",
                          params: {
                            conversation_id: conversationId,
                            content: block.text,
                            is_final: false,
                            timestamp: new Date().toISOString(),
                          },
                        })
                      );
                    } else if (block.type === "tool_use") {
                      // Send tool invocation notification
                      ws.send(
                        JSON.stringify({
                          jsonrpc: "2.0",
                          method: "chat.tool.invoke",
                          params: {
                            conversation_id: conversationId,
                            tool_name: block.name,
                            tool_input: block.input,
                            timestamp: new Date().toISOString(),
                          },
                        })
                      );
                    }
                  }
                } else if (event.type === "result") {
                  // Tool result
                  ws.send(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      method: "chat.tool.result",
                      params: {
                        conversation_id: conversationId,
                        result: event.result,
                        timestamp: new Date().toISOString(),
                      },
                    })
                  );
                }
              } catch (parseError) {
                // Non-JSON line, send as raw text chunk
                if (process.env.DEBUG) {
                  console.debug(`[Chat] Failed to parse JSON chunk: ${getErrorMessage(parseError)}`);
                }
                ws.send(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    method: "chat.response.chunk",
                    params: {
                      conversation_id: conversationId,
                      content: line + "\n",
                      is_final: false,
                      timestamp: new Date().toISOString(),
                    },
                  })
                );
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "chat.response.chunk",
                params: {
                  conversation_id: conversationId,
                  content: buffer,
                  is_final: true,
                  timestamp: new Date().toISOString(),
                },
              })
            );
          }

          // Wait for process to complete
          const exitCode = await proc.exited;

          // Clean up
          this.activeChatProcesses.delete(conversationId);

          // Send completion response
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                conversation_id: conversationId,
                status: exitCode === 0 ? "complete" : "error",
                exit_code: exitCode,
                full_response: accumulatedText,
                timestamp: new Date().toISOString(),
              },
              id: requestId,
            })
          );
        } catch (error) {
          const errorMsg = getErrorMessage(error);

          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Chat failed: ${errorMsg}`,
              },
              id: requestId,
            })
          );

          this.activeChatProcesses.delete(conversationId);

          try {
            proc.kill();
          } catch (error) {
            console.warn(`[Claude Code] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
          }
        }
      };

      // Start streaming in background
      streamOutput();
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.INTERNAL_ERROR,
            message: `Failed to launch Claude Code: ${errorMsg}`,
          },
          id: requestId,
        })
      );
    }
  }

  /**
   * Launch GitHub Copilot CLI and stream responses via WebSocket
   */
  private async launchCopilotChat(
    ws: HonoWSContext,
    conversationId: string,
    message: string,
    requestId: string | number | undefined
  ): Promise<void> {
    try {
      // Determine which command to use (gh copilot or standalone copilot)
      let cmd: string[];

      // Check if gh CLI with copilot extension is available
      const ghResult = Bun.spawnSync({
        cmd: ["gh", "copilot", "--version"],
        stdout: "pipe",
        stderr: "pipe",
      });

      if (ghResult.exitCode === 0) {
        cmd = ["gh", "copilot", "explain"];

        // Add allow-all-tools flag if withDanger is enabled
        if (this.withDanger) {
          cmd.push("--allow-all-tools");
        }

        cmd.push(message);
      } else {
        // Try standalone copilot
        cmd = ["copilot", "explain"];

        // Add allow-all-tools flag if withDanger is enabled
        if (this.withDanger) {
          cmd.push("--allow-all-tools");
        }

        cmd.push(message);
      }

      // Launch GitHub Copilot
      const proc = Bun.spawn({
        cmd,
        cwd: this.model.rootPath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Store active process
      this.activeChatProcesses.set(conversationId, proc);

      // GitHub Copilot outputs plain text/markdown (not JSON)
      const stdoutReader = proc.stdout.getReader();
      const decoder = new TextDecoder();

      const streamOutput = async () => {
        let accumulatedText = "";

        try {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;

            // Send text chunk as it arrives
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "chat.response.chunk",
                params: {
                  conversation_id: conversationId,
                  content: chunk,
                  is_final: false,
                  timestamp: new Date().toISOString(),
                },
              })
            );
          }

          // Wait for process to complete
          const exitCode = await proc.exited;

          // Clean up
          this.activeChatProcesses.delete(conversationId);

          // Send completion response
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                conversation_id: conversationId,
                status: exitCode === 0 ? "complete" : "error",
                exit_code: exitCode,
                full_response: accumulatedText,
                timestamp: new Date().toISOString(),
              },
              id: requestId,
            })
          );
        } catch (error) {
          const errorMsg = getErrorMessage(error);

          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: JSONRPC_ERRORS.INTERNAL_ERROR,
                message: `Chat failed: ${errorMsg}`,
              },
              id: requestId,
            })
          );

          this.activeChatProcesses.delete(conversationId);

          try {
            proc.kill();
          } catch (error) {
            console.warn(`[Copilot] Failed to kill process for conversation ${conversationId}: ${getErrorMessage(error)}`);
          }
        }
      };

      // Start streaming in background
      streamOutput();
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: JSONRPC_ERRORS.INTERNAL_ERROR,
            message: `Failed to launch GitHub Copilot: ${errorMsg}`,
          },
          id: requestId,
        })
      );
    }
  }

  /**
   * Setup file watcher for model changes
   */
  private setupFileWatcher(): void {
    const drPath = `${this.model.rootPath}/.dr`;

    // Use Bun's global watch API (cast to any due to type definitions)
    const bunWatch = (globalThis as any).Bun?.watch;
    if (!bunWatch) {
      console.warn("[Watcher] Bun.watch not available, file watching disabled");
      return;
    }

    this.watcher = bunWatch(drPath, {
      recursive: true,
      onChange: async (_event: string, path: string) => {
        if (process.env.VERBOSE) {
          console.log(`[Watcher] File changed: ${path}`);
        }

        try {
          // Reload model
          this.model = await Model.load(this.model.rootPath, { lazyLoad: false });

          // Broadcast update to all clients
          const modelData = await this.serializeModel();
          const message = JSON.stringify({
            type: "model.updated",
            data: modelData,
            timestamp: new Date().toISOString(),
          });

          for (const client of this.clients) {
            try {
              client.send(message);
            } catch (error) {
              const msg = getErrorMessage(error);
              console.warn(`[Watcher] Failed to send update: ${msg}`);
            }
          }
        } catch (error) {
          const message = getErrorMessage(error);
          console.error(`[Watcher] Failed to reload model: ${message}`);
        }
      },
    });
  }

  /**
   * Load all JSON schemas from bundled directory (recursive)
   * Loads schemas from all subdirectories: base/, nodes/, relationships/, etc.
   */
  private async loadSchemas(): Promise<Record<string, any>> {
    const schemasPath = new URL("../schemas/bundled/", import.meta.url).pathname;
    const schemas: Record<string, any> = {};

    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      // Recursive function to walk through directories
      const walkDirectory = async (dir: string, prefix: string = ""): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const schemaKey = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            // Recursively walk subdirectories
            await walkDirectory(fullPath, schemaKey);
          } else if (entry.isFile() && (entry.name.endsWith(".schema.json") || entry.name.endsWith(".json"))) {
            // Load JSON schema files
            const content = await fs.readFile(fullPath, "utf-8");
            schemas[schemaKey] = JSON.parse(content);
          }
        }
      };

      await walkDirectory(schemasPath);

      return schemas;
    } catch (error) {
      console.error("Failed to load schemas:", error);
      throw new Error("Failed to load schema files");
    }
  }

  /**
   * Get viewer HTML
   */
  private getViewerHTML(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation Robotics Viewer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      color: #333;
    }

    header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-badge.connected {
      background: #4caf50;
      color: white;
    }

    .status-badge.disconnected {
      background: #f44336;
      color: white;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    .content {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 20px;
      height: calc(100vh - 100px);
    }

    .sidebar {
      background: white;
      border-radius: 4px;
      overflow-y: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 16px;
    }

    .main-panel {
      background: white;
      border-radius: 4px;
      overflow-y: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
    }

    .layer-group {
      margin-bottom: 16px;
    }

    .layer-header {
      font-weight: 600;
      padding: 8px 0;
      border-bottom: 2px solid #e0e0e0;
      margin-bottom: 8px;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
    }

    .layer-header:hover {
      color: #2196F3;
    }

    .layer-header::before {
      content: '▶';
      margin-right: 8px;
      display: inline-block;
      transition: transform 0.2s;
    }

    .layer-header.expanded::before {
      transform: rotate(90deg);
    }

    .layer-elements {
      margin-left: 16px;
      display: none;
    }

    .layer-elements.expanded {
      display: block;
    }

    .element-item {
      padding: 8px;
      margin-bottom: 4px;
      background: #f9f9f9;
      border-left: 3px solid #e0e0e0;
      cursor: pointer;
      border-radius: 2px;
      transition: all 0.2s;
      font-size: 13px;
    }

    .element-item:hover {
      background: #f0f0f0;
      border-left-color: #2196F3;
    }

    .element-item.selected {
      background: #e3f2fd;
      border-left-color: #2196F3;
      font-weight: 500;
    }

    .element-details {
      min-height: 300px;
    }

    .detail-header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }

    .detail-header h2 {
      font-size: 18px;
      margin-bottom: 4px;
    }

    .detail-header .element-type {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-section {
      margin-bottom: 16px;
    }

    .detail-section h3 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    .detail-value {
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      word-break: break-word;
    }

    .annotations-list {
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 8px;
    }

    .annotation-item {
      padding: 8px;
      margin-bottom: 8px;
      background: #fffde7;
      border-left: 3px solid #fbc02d;
      border-radius: 2px;
      font-size: 12px;
    }

    .annotation-item .author {
      font-weight: 600;
      color: #666;
    }

    .annotation-item .text {
      margin: 4px 0 0 0;
      color: #333;
    }

    .annotation-item .timestamp {
      font-size: 11px;
      color: #999;
      margin-top: 4px;
    }

    .annotation-form {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .annotation-form input,
    .annotation-form textarea {
      padding: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
    }

    .annotation-form textarea {
      resize: vertical;
      min-height: 60px;
    }

    .annotation-form button {
      padding: 8px 12px;
      background: #2196F3;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    .annotation-form button:hover {
      background: #1976D2;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .loading::after {
      content: '';
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #2196F3;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-left: 8px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .stats {
      font-size: 12px;
      color: #999;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div>
        <h1>📚 Documentation Robotics Viewer</h1>
      </div>
      <div class="status-badge connected" id="status">● Connected</div>
    </div>
  </header>

  <div class="container">
    <div class="content">
      <div class="sidebar">
        <div class="stats" id="stats">Loading...</div>
        <div id="model-tree">
          <div class="loading">Loading model...</div>
        </div>
      </div>

      <div class="main-panel">
        <div id="element-details">
          <div class="loading">Select an element to view details</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentModel = null;
    let selectedElementId = null;

    const statusEl = document.getElementById('status');
    const modelTreeEl = document.getElementById('model-tree');
    const detailsEl = document.getElementById('element-details');
    const statsEl = document.getElementById('stats');

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} HTML-escaped text
     */
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Extract token from URL query parameters if present
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    // Log token status for debugging
    if (!token) {
      console.warn('[WebSocket] No authentication token found in URL. If authentication is enabled, connection will fail.');
      console.warn('[WebSocket] Expected URL format: http://localhost:PORT?token=YOUR_TOKEN');
    } else {
      console.log('[WebSocket] Found authentication token in URL');
    }

    // Build WebSocket URL with token if available
    let wsUrl = \`ws://\${window.location.host}/ws\`;
    if (token) {
      wsUrl += \`?token=\${encodeURIComponent(token)}\`;
    }

    console.log('[WebSocket] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));

    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      console.log('WebSocket connected');
      updateStatus(true);
      ws.send(JSON.stringify({ type: 'subscribe' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'model' || message.type === 'model-update') {
          currentModel = message.data;
          renderModel();
        } else if (message.type === 'annotation') {
          // Update annotations for the element
          renderSelectedElement();
        } else if (message.type === 'error') {
          console.error('WebSocket error:', message.message);
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.addEventListener('close', (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      updateStatus(false);

      // If closed immediately with auth error codes, show helpful message
      if (!token && (event.code === 1002 || event.code === 1008 || event.code === 1006)) {
        showAuthError();
      }
    });

    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      updateStatus(false);

      // If we don't have a token, likely an auth issue
      if (!token) {
        showAuthError();
      }
    });

    function showAuthError() {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); background: #f44336; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; max-width: 500px; text-align: center;';
      errorDiv.innerHTML = \`
        <strong>⚠️ Authentication Required</strong><br>
        <span style="font-size: 14px; margin-top: 8px; display: inline-block;">
          Please use the full URL with authentication token from the terminal.
        </span>
      \`;
      document.body.appendChild(errorDiv);

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        errorDiv.style.transition = 'opacity 0.5s';
        errorDiv.style.opacity = '0';
        setTimeout(() => errorDiv.remove(), 500);
      }, 10000);
    }

    function updateStatus(connected) {
      if (connected) {
        statusEl.className = 'status-badge connected';
        statusEl.textContent = '● Connected';
      } else {
        statusEl.className = 'status-badge disconnected';
        statusEl.textContent = '● Disconnected';
      }
    }

    function renderModel() {
      if (!currentModel) return;

      // Update stats
      const layerCount = Object.keys(currentModel.layers).length;
      const elementCount = currentModel.totalElements || 0;
      statsEl.textContent = \`\${layerCount} layers · \${elementCount} elements\`;

      // Render layers and elements
      modelTreeEl.innerHTML = '';
      const layers = Object.entries(currentModel.layers)
        .sort((a, b) => a[0].localeCompare(b[0]));

      for (const [layerName, layerData] of layers) {
        const layerDiv = document.createElement('div');
        layerDiv.className = 'layer-group';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'layer-header';
        headerDiv.textContent = layerName;
        headerDiv.addEventListener('click', () => {
          headerDiv.classList.toggle('expanded');
          elementsDiv.classList.toggle('expanded');
        });

        const elementsDiv = document.createElement('div');
        elementsDiv.className = 'layer-elements';

        for (const element of layerData.elements) {
          const elemDiv = document.createElement('div');
          elemDiv.className = 'element-item';
          if (element.id === selectedElementId) {
            elemDiv.classList.add('selected');
          }
          elemDiv.innerHTML = \`\${escapeHtml(element.id)}<br><span style="font-size: 11px; color: #999;">\${escapeHtml(element.name)}</span>\`;
          elemDiv.addEventListener('click', () => {
            selectedElementId = element.id;
            document.querySelectorAll('.element-item').forEach(el => el.classList.remove('selected'));
            elemDiv.classList.add('selected');
            renderSelectedElement();
          });

          elementsDiv.appendChild(elemDiv);
        }

        layerDiv.appendChild(headerDiv);
        layerDiv.appendChild(elementsDiv);
        modelTreeEl.appendChild(layerDiv);
      }
    }

    function renderSelectedElement() {
      if (!selectedElementId || !currentModel) {
        detailsEl.innerHTML = '<div class="loading">Select an element to view details</div>';
        return;
      }

      // Find element in model
      let element = null;
      for (const layer of Object.values(currentModel.layers)) {
        element = layer.elements.find(e => e.id === selectedElementId);
        if (element) break;
      }

      if (!element) {
        detailsEl.innerHTML = '<div class="loading">Element not found</div>';
        return;
      }

      let html = \`
        <div class="detail-header">
          <div class="element-type">\${escapeHtml(element.type)}</div>
          <h2>\${escapeHtml(element.name)}</h2>
          <div style="font-size: 12px; color: #666; margin-top: 4px;"><code>\${escapeHtml(element.id)}</code></div>
        </div>
      \`;

      if (element.description) {
        html += \`
          <div class="detail-section">
            <h3>Description</h3>
            <div class="detail-value">\${escapeHtml(element.description)}</div>
          </div>
        \`;
      }

      if (element.properties && Object.keys(element.properties).length > 0) {
        html += \`
          <div class="detail-section">
            <h3>Properties</h3>
            <div class="detail-value"><pre>\${escapeHtml(JSON.stringify(element.properties, null, 2))}</pre></div>
          </div>
        \`;
      }

      if (element.annotations && element.annotations.length > 0) {
        html += \`
          <div class="detail-section">
            <h3>Annotations</h3>
            <div class="annotations-list">
              \${element.annotations.map(ann => \`
                <div class="annotation-item">
                  <div class="author">\${escapeHtml(ann.author)}</div>
                  <div class="text">\${escapeHtml(ann.text)}</div>
                  <div class="timestamp">\${new Date(ann.timestamp).toLocaleString()}</div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      html += \`
        <div class="detail-section">
          <h3>Add Annotation</h3>
          <form class="annotation-form" onsubmit="addAnnotation(event, '\${escapeHtml(element.id)}')">
            <input type="text" placeholder="Author name" id="ann-author" required>
            <textarea placeholder="Annotation text" id="ann-text" required></textarea>
            <button type="submit">Add Annotation</button>
          </form>
        </div>
      \`;

      detailsEl.innerHTML = html;
    }

    function addAnnotation(event, elementId) {
      event.preventDefault();

      const author = document.getElementById('ann-author').value;
      const text = document.getElementById('ann-text').value;

      if (!author || !text) return;

      // Send to server using new annotation API
      fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementId, author, content: text })
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.id) {
            document.getElementById('ann-author').value = '';
            document.getElementById('ann-text').value = '';
          }
        })
        .catch(err => console.error('Failed to add annotation:', err));
    }
  </script>
</body>
</html>`;
  }

  /**
   * Serve a file from the custom viewer path
   */
  private async serveCustomViewer(filePath: string): Promise<Response> {
    if (process.env.VERBOSE) console.log(`[VIEWER] serveCustomViewer called for: ${filePath}`);

    if (!this.viewerPath) {
      console.error(`[VIEWER] Custom viewer path not configured`);
      return new Response("Custom viewer path not configured", { status: 500 });
    }

    try {
      const path = await import("path");
      const fs = await import("fs/promises");

      // Resolve absolute path and prevent directory traversal
      const fullPath = path.resolve(this.viewerPath, filePath);
      if (process.env.VERBOSE) console.log(`[VIEWER] Resolved path: ${fullPath}`);

      // Security check: ensure the resolved path is within viewerPath
      if (!fullPath.startsWith(path.resolve(this.viewerPath))) {
        console.error(`[VIEWER] Security check failed - path outside viewer directory`);
        return new Response("Forbidden", { status: 403 });
      }

      // Read file
      if (process.env.VERBOSE) console.log(`[VIEWER] Reading file: ${fullPath}`);
      const content = await fs.readFile(fullPath);

      // Determine content type
      const ext = path.extname(fullPath).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".eot": "application/vnd.ms-fontobject",
      };

      const contentType = contentTypes[ext] || "application/octet-stream";

      if (process.env.VERBOSE)
        console.log(`[VIEWER] Successfully read file, returning with Content-Type: ${contentType}`);
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        console.error(`[VIEWER] File not found: ${filePath}`);
        return new Response("File not found", { status: 404 });
      }
      console.error(`[VIEWER] Error serving custom viewer file ${filePath}:`, error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /**
   * Start the server
   */
  async start(port: number = 8080): Promise<void> {
    this.setupFileWatcher();

    this._server = serve({
      port,
      fetch: this.app.fetch,
      websocket, // Add WebSocket handler from hono/bun
    });

    console.log(`✓ Visualization server running at http://localhost:${port}`);
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Check if authentication is enabled
   */
  isAuthEnabled(): boolean {
    return this.authEnabled;
  }

  /**
   * Stop the server
   */
  stop(): void {
    // Close all WebSocket connections
    for (const client of this.clients) {
      try {
        client.close();
      } catch (error) {
        // Only suppress expected "already closed" errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('already closed') && process.env.VERBOSE) {
          console.error(`[SERVER] Unexpected error closing WebSocket client: ${errorMessage}`);
        }
      }
    }
    this.clients.clear();

    // Stop file watcher
    if (this.watcher) {
      this.watcher.close?.();
    }

    // Stop the server
    if (this._server) {
      this._server.stop();
    }
  }
}
