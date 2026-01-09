/**
 * Visualization Server
 * HTTP server with WebSocket support for real-time model updates
 */

import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { serve } from 'bun';
import { Model } from '../core/model.js';
import { Element } from '../core/element.js';
import { telemetryMiddleware } from './telemetry-middleware.js';
import { BaseChatClient } from '../ai/base-chat-client.js';
import { ClaudeCodeClient } from '../ai/claude-code-client.js';
import { CopilotClient } from '../ai/copilot-client.js';
import { detectAvailableClients, selectChatClient } from '../ai/chat-utils.js';

interface WSMessage {
  type: 'subscribe' | 'annotate' | 'ping';
  topics?: string[];
  annotation?: {
    elementId: string;
    author: string;
    text: string;
    timestamp: string;
  };
  jsonrpc?: string; // For JSON-RPC 2.0 messages
  method?: string;
  params?: any;
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface ClientAnnotation {
  id: string;
  elementId: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
}

interface Changeset {
  metadata: {
    id: string;
    name: string;
    description?: string;
    type: 'feature' | 'bugfix' | 'exploration';
    status: 'active' | 'applied' | 'abandoned';
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
      operation: 'add' | 'update' | 'delete';
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
type HonoWSContext = any;

export interface VisualizationServerOptions {
  authEnabled?: boolean;
  authToken?: string;
  withDanger?: boolean;
}

/**
 * Visualization Server class
 */
export class VisualizationServer {
  private app: Hono;
  private model: Model;
  private _server?: ReturnType<typeof serve>;
  private clients: Set<HonoWSContext> = new Set();
  private watcher?: any;
  private annotations: Map<string, ClientAnnotation> = new Map(); // annotationId -> annotation
  private annotationsByElement: Map<string, Set<string>> = new Map(); // elementId -> Set<annotationId>
  private changesets: Map<string, Changeset> = new Map(); // changesetId -> changeset
  private authToken: string;
  private authEnabled: boolean = true; // Enabled by default for security
  private withDanger: boolean = false; // Danger mode disabled by default
  private activeChatProcesses: Map<string, any> = new Map(); // conversationId -> Bun.spawn process
  private chatConversationCounter: number = 0;
  private selectedChatClient?: BaseChatClient; // Selected chat client for server

  constructor(model: Model, options?: VisualizationServerOptions) {
    this.app = new Hono();
    this.model = model;

    // Auth configuration (CLI options override environment variables)
    this.authEnabled = options?.authEnabled ?? (process.env.DR_AUTH_ENABLED !== 'false');
    this.authToken = options?.authToken || process.env.DR_AUTH_TOKEN || this.generateAuthToken();
    this.withDanger = options?.withDanger || false;

    // Add CORS middleware
    this.app.use('/*', cors());

    // Add telemetry middleware to instrument all HTTP requests
    this.app.use('/*', telemetryMiddleware);

    // Add authentication middleware (except for health endpoint and root)
    this.app.use('/api/*', async (c, next) => {
      if (!this.authEnabled) {
        return next();
      }

      // Check for token in Authorization header or query parameter
      const authHeader = c.req.header('Authorization');
      const queryToken = c.req.query('token');

      let providedToken: string | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.substring(7);
      } else if (queryToken) {
        providedToken = queryToken;
      }

      if (!providedToken) {
        return c.json({ error: 'Authentication required. Please provide a valid token.' }, 401);
      }

      if (providedToken !== this.authToken) {
        return c.json({ error: 'Invalid authentication token' }, 403);
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
      console.error('[Chat] Failed to initialize chat clients:', error);
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
    if (preferredAgent && this.selectedChatClient && 
        this.selectedChatClient.getClientName() !== preferredAgent) {
      console.warn(`[Chat] Preferred client "${preferredAgent}" not available, using ${this.selectedChatClient.getClientName()}`);
    }

    if (this.selectedChatClient && process.env.VERBOSE) {
      console.log(`[Chat] Using chat client: ${this.selectedChatClient.getClientName()}`);
    } else if (clients.length === 0 && process.env.VERBOSE) {
      console.log('[Chat] No chat clients available');
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
    this.app.get('/', (c) => {
      return c.html(this.getViewerHTML());
    });

    // Health check endpoint
    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        version: '0.1.0'
      });
    });

    // REST API endpoints

    // Get full model
    this.app.get('/api/model', async (c) => {
      try {
        const modelData = await this.serializeModel();
        return c.json(modelData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Get specific layer
    this.app.get('/api/layers/:name', async (c) => {
      try {
        const layerName = c.req.param('name');
        const layer = await this.model.getLayer(layerName);

        if (!layer) {
          return c.json({ error: 'Layer not found' }, 404);
        }

        const elements = layer
          .listElements()
          .map((e) => e.toJSON());

        return c.json({
          name: layerName,
          elements,
          elementCount: elements.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Get specific element
    this.app.get('/api/elements/:id', async (c) => {
      try {
        const elementId = c.req.param('id');
        const element = await this.findElement(elementId);

        if (!element) {
          return c.json({ error: 'Element not found' }, 404);
        }

        return c.json({
          ...element.toJSON(),
          annotations: this.annotations.get(elementId) || [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Get JSON Schema specifications
    this.app.get('/api/spec', async (c) => {
      try {
        const schemas = await this.loadSchemas();
        return c.json({
          version: '0.1.0',
          type: 'schema-collection',
          description: 'JSON Schema definitions from dr CLI',
          source: 'dr-cli',
          schemas,
          schemaCount: Object.keys(schemas).length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Get link registry
    this.app.get('/api/link-registry', async (c) => {
      try {
        const linkRegistry = await this.loadLinkRegistry();
        return c.json(linkRegistry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 404);
      }
    });

    // Annotations API (spec-compliant routes)

    // Get all annotations (optionally filtered by elementId)
    this.app.get('/api/annotations', (c) => {
      const elementId = c.req.query('elementId');

      if (elementId) {
        // Filter by element
        const annotationIds = this.annotationsByElement.get(elementId) || new Set();
        const annotations = Array.from(annotationIds)
          .map(id => this.annotations.get(id))
          .filter((a): a is ClientAnnotation => a !== undefined);

        return c.json({ annotations });
      } else {
        // Return all annotations
        const annotations = Array.from(this.annotations.values());
        return c.json({ annotations });
      }
    });

    // Create annotation
    this.app.post('/api/annotations', async (c) => {
      try {
        const body = await c.req.json();

        // Validate required fields
        if (!body.elementId || !body.content || !body.author) {
          return c.json({
            error: 'Missing required fields: elementId, content, author'
          }, 400);
        }

        // Verify element exists
        const element = await this.findElement(body.elementId);
        if (!element) {
          return c.json({ error: 'Element not found' }, 404);
        }

        // Create annotation
        const annotation: ClientAnnotation = {
          id: this.generateAnnotationId(),
          elementId: String(body.elementId),
          author: String(body.author),
          content: String(body.content),
          createdAt: new Date().toISOString(),
          tags: body.tags || [],
        };

        // Store annotation
        this.annotations.set(annotation.id, annotation);
        if (!this.annotationsByElement.has(annotation.elementId)) {
          this.annotationsByElement.set(annotation.elementId, new Set());
        }
        this.annotationsByElement.get(annotation.elementId)!.add(annotation.id);

        // Broadcast to all clients
        await this.broadcastMessage({
          type: 'annotation.added',
          annotationId: annotation.id,
          elementId: annotation.elementId,
          timestamp: annotation.createdAt,
        });

        return c.json(annotation, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Update annotation
    this.app.put('/api/annotations/:annotationId', async (c) => {
      try {
        const annotationId = c.req.param('annotationId');
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: 'Annotation not found' }, 404);
        }

        const body = await c.req.json();

        // Update fields
        if (body.content !== undefined) {
          annotation.content = String(body.content);
        }
        if (body.tags !== undefined) {
          annotation.tags = body.tags;
        }
        annotation.updatedAt = new Date().toISOString();

        // Broadcast to all clients
        await this.broadcastMessage({
          type: 'annotation.updated',
          annotationId: annotation.id,
          timestamp: annotation.updatedAt,
        });

        return c.json(annotation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Delete annotation
    this.app.delete('/api/annotations/:annotationId', async (c) => {
      try {
        const annotationId = c.req.param('annotationId');
        const annotation = this.annotations.get(annotationId);

        if (!annotation) {
          return c.json({ error: 'Annotation not found' }, 404);
        }

        // Remove from storage
        this.annotations.delete(annotationId);
        const elementAnnotations = this.annotationsByElement.get(annotation.elementId);
        if (elementAnnotations) {
          elementAnnotations.delete(annotationId);
        }

        // Broadcast to all clients
        await this.broadcastMessage({
          type: 'annotation.deleted',
          annotationId,
          timestamp: new Date().toISOString(),
        });

        return c.body(null, 204);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // Changesets API

    // Get all changesets
    this.app.get('/api/changesets', (c) => {
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
        version: '1.0.0',
        changesets,
      });
    });

    // Get specific changeset
    this.app.get('/api/changesets/:changesetId', (c) => {
      const changesetId = c.req.param('changesetId');
      const changeset = this.changesets.get(changesetId);

      if (!changeset) {
        return c.json({ error: 'Changeset not found' }, 404);
      }

      return c.json(changeset);
    });

    // Deprecated: Get annotations for an element (use /api/annotations?elementId=xyz instead)
    this.app.get('/api/elements/:id/annotations', (c) => {
      const elementId = c.req.param('id');
      const annotationIds = this.annotationsByElement.get(elementId) || new Set();
      const annotations = Array.from(annotationIds)
        .map(id => this.annotations.get(id))
        .filter((a): a is ClientAnnotation => a !== undefined);

      return c.json({ elementId, annotations });
    });

    // Deprecated: Post annotation to element (use POST /api/annotations instead)
    this.app.post('/api/elements/:id/annotations', async (c) => {
      try {
        const elementId = c.req.param('id');

        // Verify element exists
        const element = await this.findElement(elementId);
        if (!element) {
          return c.json({ error: 'Element not found' }, 404);
        }

        const body = await c.req.json();

        // Support both 'text' and 'content' for backward compatibility
        const content = (body.content || body.text) && String(body.content || body.text).trim();
        if (!content) {
          return c.json({ error: 'Annotation content cannot be empty' }, 400);
        }

        const author = body.author ? String(body.author).trim() : 'Anonymous';

        const annotation: ClientAnnotation = {
          id: this.generateAnnotationId(),
          elementId,
          author,
          content,
          createdAt: new Date().toISOString(),
          tags: body.tags || [],
        };

        // Store annotation
        this.annotations.set(annotation.id, annotation);
        if (!this.annotationsByElement.has(elementId)) {
          this.annotationsByElement.set(elementId, new Set());
        }
        this.annotationsByElement.get(elementId)!.add(annotation.id);

        // Broadcast to all clients
        await this.broadcastMessage({
          type: 'annotation.added',
          annotationId: annotation.id,
          elementId: annotation.elementId,
          timestamp: annotation.createdAt,
        });

        return c.json({ success: true, annotation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // WebSocket endpoint
    this.app.get(
      '/ws',
      async (c, next) => {
        // Check WebSocket auth if enabled
        if (this.authEnabled) {
          const queryToken = c.req.query('token');

          if (!queryToken) {
            return c.json({ error: 'Authentication required. Provide token as query parameter: ?token=YOUR_TOKEN' }, 401);
          }

          if (queryToken !== this.authToken) {
            return c.json({ error: 'Invalid authentication token' }, 403);
          }
        }

        return next();
      },
      upgradeWebSocket(() => ({
        onOpen: (_evt, ws) => {
          this.clients.add(ws);

          // Send connected message per spec
          ws.send(JSON.stringify({
            type: 'connected',
            version: '0.1.0',
            timestamp: new Date().toISOString(),
          }));

          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client connected (total: ${this.clients.size})`);
          }
        },

        onClose: (_evt, ws) => {
          this.clients.delete(ws);
          if (process.env.VERBOSE) {
            console.log(
              `[WebSocket] Client disconnected (total: ${this.clients.size})`
            );
          }
        },

        onMessage: async (message, ws) => {
          try {
            // Extract the actual message data
            // In Hono/Bun, message is a MessageEvent with a data property
            const rawData = (message as any).data ?? message;

            // Handle different message types (string, Buffer, ArrayBuffer)
            let msgStr: string;
            if (typeof rawData === 'string') {
              msgStr = rawData;
            } else if (rawData instanceof Buffer || rawData instanceof Uint8Array) {
              msgStr = new TextDecoder().decode(rawData);
            } else {
              msgStr = String(rawData);
            }
            const data = JSON.parse(msgStr) as WSMessage;

            // Check if it's a JSON-RPC message
            if (data.jsonrpc === '2.0') {
              await this.handleJSONRPCMessage(ws, data);
            } else {
              await this.handleWSMessage(ws, data);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (process.env.DEBUG) {
              console.error(`[WebSocket] Error handling message: ${errorMsg}`);
            }
            ws.send(
              JSON.stringify({
                type: 'error',
                message: errorMsg,
              })
            );
          }
        },

        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[WebSocket] Error: ${message}`);
        },
      }))
    );
  }

  /**
   * Serialize model to JSON for client consumption
   */
  private async serializeModel(): Promise<any> {
    const layers: any = {};

    for (const [name, layer] of this.model.layers) {
      const elements = layer
        .listElements()
        .map((e) => {
          const annotationIds = this.annotationsByElement.get(e.id) || new Set();
          const annotations = Array.from(annotationIds)
            .map(id => this.annotations.get(id))
            .filter((a): a is ClientAnnotation => a !== undefined);

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
   * Broadcast message to all connected WebSocket clients
   */
  private async broadcastMessage(message: any): Promise<void> {
    const messageStr = JSON.stringify(message);

    let failureCount = 0;
    for (const client of this.clients) {
      try {
        client.send(messageStr);
      } catch (error) {
        failureCount++;
        const msg = error instanceof Error ? error.message : String(error);
        if (process.env.VERBOSE) {
          console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
        }
      }
    }

    if (failureCount > 0 && process.env.VERBOSE) {
      console.warn(`[WebSocket] Failed to send message to ${failureCount}/${this.clients.size} clients`);
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
    switch (data.type) {
      case 'subscribe':
        // Send subscribed confirmation
        const topics = data.topics || ['model', 'annotations'];
        ws.send(JSON.stringify({
          type: 'subscribed',
          topics,
          timestamp: new Date().toISOString(),
        }));

        // Send initial model state
        const modelData = await this.serializeModel();
        ws.send(
          JSON.stringify({
            type: 'model',
            data: modelData,
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case 'ping':
        // Respond with pong
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
        }));
        break;

      case 'annotate':
        if (data.annotation) {
          await this.broadcastMessage({
            type: 'annotation',
            data: data.annotation,
          });
        }
        break;

      default:
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${data.type}`,
          })
        );
    }
  }

  /**
   * Handle JSON-RPC 2.0 messages for chat functionality
   */
  private async handleJSONRPCMessage(ws: HonoWSContext, data: WSMessage): Promise<void> {
    const { method, params, id } = data;

    // Helper to send JSON-RPC response
    const sendResponse = (result: any) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        result,
        id,
      }));
    };

    // Helper to send JSON-RPC error
    const sendError = (code: number, message: string, data?: any) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: { code, message, data },
        id,
      }));
    };

    try {
      switch (method) {
        case 'chat.status':
          // Check if any chat client is available
          const hasClient = this.selectedChatClient !== undefined;
          sendResponse({
            sdk_available: hasClient,
            sdk_version: hasClient ? this.selectedChatClient!.getClientName() : null,
            error_message: hasClient ? null : 'No chat client available. Install Claude Code or GitHub Copilot.'
          });
          break;

        case 'chat.send':
          // Validate params
          if (!params || !params.message) {
            sendError(-32602, 'Message cannot be empty');
            return;
          }

          // Check if chat client is available
          if (!this.selectedChatClient) {
            sendError(-32001, 'No chat client available. Install Claude Code or GitHub Copilot to enable chat.');
            return;
          }

          // Generate conversation ID
          const conversationId = `conv-${++this.chatConversationCounter}-${Date.now()}`;

          // Launch chat with selected client
          await this.launchChat(ws, conversationId, params.message, id);
          break;

        case 'chat.cancel':
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
              // Process already terminated
            }
          }

          sendResponse({
            cancelled,
            conversation_id: cancelledConvId
          });
          break;

        default:
          sendError(-32601, `Method not found: ${method}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendError(-32603, 'Internal error', errorMsg);
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
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'No chat client available',
        },
        id: requestId,
      }));
      return;
    }

    // Route to appropriate client-specific handler
    if (this.selectedChatClient instanceof ClaudeCodeClient) {
      await this.launchClaudeCodeChat(ws, conversationId, message, requestId);
    } else if (this.selectedChatClient instanceof CopilotClient) {
      await this.launchCopilotChat(ws, conversationId, message, requestId);
    } else {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Unknown chat client type',
        },
        id: requestId,
      }));
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
      const cmd = ['claude', '--agent', 'dr-architect', '--print'];
      
      // Add dangerously-skip-permissions flag if withDanger is enabled
      if (this.withDanger) {
        cmd.push('--dangerously-skip-permissions');
      }
      
      cmd.push('--verbose', '--output-format', 'stream-json');
      
      // Launch claude with dr-architect agent for comprehensive DR expertise
      const proc = Bun.spawn({
        cmd,
        cwd: this.model.rootPath,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
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
        let accumulatedText = '';
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Process complete lines (JSON events)
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const event = JSON.parse(line);

                if (event.type === 'assistant') {
                  // Extract content blocks from assistant message
                  const content = event.message?.content || [];
                  for (const block of content) {
                    if (block.type === 'text') {
                      accumulatedText += block.text;
                      // Send text chunk notification
                      ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'chat.response.chunk',
                        params: {
                          conversation_id: conversationId,
                          content: block.text,
                          is_final: false,
                          timestamp: new Date().toISOString(),
                        },
                      }));
                    } else if (block.type === 'tool_use') {
                      // Send tool invocation notification
                      ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'chat.tool.invoke',
                        params: {
                          conversation_id: conversationId,
                          tool_name: block.name,
                          tool_input: block.input,
                          timestamp: new Date().toISOString(),
                        },
                      }));
                    }
                  }
                } else if (event.type === 'result') {
                  // Tool result
                  ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'chat.tool.result',
                    params: {
                      conversation_id: conversationId,
                      result: event.result,
                      timestamp: new Date().toISOString(),
                    },
                  }));
                }
              } catch {
                // Non-JSON line, send as raw text chunk
                ws.send(JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'chat.response.chunk',
                  params: {
                    conversation_id: conversationId,
                    content: line + '\n',
                    is_final: false,
                    timestamp: new Date().toISOString(),
                  },
                }));
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'chat.response.chunk',
              params: {
                conversation_id: conversationId,
                content: buffer,
                is_final: true,
                timestamp: new Date().toISOString(),
              },
            }));
          }

          // Wait for process to complete
          const exitCode = await proc.exited;

          // Clean up
          this.activeChatProcesses.delete(conversationId);

          // Send completion response
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            result: {
              conversation_id: conversationId,
              status: exitCode === 0 ? 'complete' : 'error',
              exit_code: exitCode,
              full_response: accumulatedText,
              timestamp: new Date().toISOString(),
            },
            id: requestId,
          }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);

          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `Chat failed: ${errorMsg}`,
            },
            id: requestId,
          }));

          this.activeChatProcesses.delete(conversationId);

          try {
            proc.kill();
          } catch {
            // Process may already be terminated
          }
        }
      };

      // Start streaming in background
      streamOutput();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Failed to launch Claude Code: ${errorMsg}`,
        },
        id: requestId,
      }));
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
        cmd: ['gh', 'copilot', '--version'],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      
      if (ghResult.exitCode === 0) {
        cmd = ['gh', 'copilot', 'explain'];
        
        // Add allow-all-tools flag if withDanger is enabled
        if (this.withDanger) {
          cmd.push('--allow-all-tools');
        }
        
        cmd.push(message);
      } else {
        // Try standalone copilot
        cmd = ['copilot', 'explain'];
        
        // Add allow-all-tools flag if withDanger is enabled
        if (this.withDanger) {
          cmd.push('--allow-all-tools');
        }
        
        cmd.push(message);
      }

      // Launch GitHub Copilot
      const proc = Bun.spawn({
        cmd,
        cwd: this.model.rootPath,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Store active process
      this.activeChatProcesses.set(conversationId, proc);

      // GitHub Copilot outputs plain text/markdown (not JSON)
      const stdoutReader = proc.stdout.getReader();
      const decoder = new TextDecoder();

      const streamOutput = async () => {
        let accumulatedText = '';

        try {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;

            // Send text chunk as it arrives
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'chat.response.chunk',
              params: {
                conversation_id: conversationId,
                content: chunk,
                is_final: false,
                timestamp: new Date().toISOString(),
              },
            }));
          }

          // Wait for process to complete
          const exitCode = await proc.exited;

          // Clean up
          this.activeChatProcesses.delete(conversationId);

          // Send completion response
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            result: {
              conversation_id: conversationId,
              status: exitCode === 0 ? 'complete' : 'error',
              exit_code: exitCode,
              full_response: accumulatedText,
              timestamp: new Date().toISOString(),
            },
            id: requestId,
          }));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);

          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `Chat failed: ${errorMsg}`,
            },
            id: requestId,
          }));

          this.activeChatProcesses.delete(conversationId);

          try {
            proc.kill();
          } catch {
            // Process may already be terminated
          }
        }
      };

      // Start streaming in background
      streamOutput();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Failed to launch GitHub Copilot: ${errorMsg}`,
        },
        id: requestId,
      }));
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
      console.warn('[Watcher] Bun.watch not available, file watching disabled');
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
            type: 'model.updated',
            data: modelData,
            timestamp: new Date().toISOString(),
          });

          for (const client of this.clients) {
            try {
              client.send(message);
            } catch (error) {
              if (process.env.DEBUG) {
                const msg = error instanceof Error ? error.message : String(error);
                console.debug(`[Watcher] Failed to send update: ${msg}`);
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[Watcher] Failed to reload model: ${message}`);
        }
      },
    });
  }

  /**
   * Load all JSON schemas from bundled directory
   */
  private async loadSchemas(): Promise<Record<string, any>> {
    const schemasPath = new URL('../schemas/bundled/', import.meta.url).pathname;
    const schemas: Record<string, any> = {};

    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const fileList = await fs.readdir(schemasPath);

      for (const file of fileList) {
        if (file.endsWith('.schema.json') || file.endsWith('.json')) {
          const filePath = path.join(schemasPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          schemas[file] = JSON.parse(content);
        }
      }

      return schemas;
    } catch (error) {
      console.error('Failed to load schemas:', error);
      throw new Error('Failed to load schema files');
    }
  }

  /**
   * Load link registry from bundled directory
   */
  private async loadLinkRegistry(): Promise<any> {
    const linkRegistryPath = new URL('../schemas/bundled/link-registry.json', import.meta.url).pathname;

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(linkRegistryPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load link registry:', error);
      throw new Error('Link registry not found');
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

    const ws = new WebSocket(\`ws://\${window.location.host}/ws\`);

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

    ws.addEventListener('close', () => {
      console.log('WebSocket disconnected');
      updateStatus(false);
    });

    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      updateStatus(false);
    });

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

      // Send to server
      fetch(\`/api/elements/\${elementId}/annotations\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, text })
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
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
   * Start the server
   */
  async start(port: number = 8080): Promise<void> {
    this.setupFileWatcher();

    this._server = serve({
      port,
      fetch: this.app.fetch,
      websocket,  // Add WebSocket handler from hono/bun
    });

    console.log(
      `✓ Visualization server running at http://localhost:${port}`
    );
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
        // Ignore errors on close
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
