/**
 * Visualization Server
 * HTTP server with WebSocket support for real-time model updates
 */

import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import { serve } from 'bun';
import { Model } from '../core/model.js';
import { Element } from '../core/element.js';

interface WSMessage {
  type: 'subscribe' | 'annotate';
  annotation?: {
    elementId: string;
    author: string;
    text: string;
    timestamp: string;
  };
}

interface ClientAnnotation {
  elementId: string;
  author: string;
  text: string;
  timestamp: string;
}

/**
 * Visualization Server class
 */
export class VisualizationServer {
  private app: Hono;
  private model: Model;
  private clients: Set<any> = new Set();
  private watcher?: any;
  private annotations: Map<string, ClientAnnotation[]> = new Map();

  constructor(model: Model) {
    this.app = new Hono();
    this.model = model;
    this.setupRoutes();
  }

  /**
   * Setup HTTP routes and WebSocket handler
   */
  private setupRoutes(): void {
    // Static viewer HTML at root
    this.app.get('/', (c) => {
      return c.html(this.getViewerHTML());
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

    // Get annotations for an element
    this.app.get('/api/elements/:id/annotations', (c) => {
      const elementId = c.req.param('id');
      const annotations = this.annotations.get(elementId) || [];
      return c.json({ elementId, annotations });
    });

    // Post annotation
    this.app.post('/api/elements/:id/annotations', async (c) => {
      try {
        const elementId = c.req.param('id');
        const body = await c.req.json();

        const annotation: ClientAnnotation = {
          elementId,
          author: body.author || 'Anonymous',
          text: body.text,
          timestamp: new Date().toISOString(),
        };

        if (!this.annotations.has(elementId)) {
          this.annotations.set(elementId, []);
        }
        this.annotations.get(elementId)!.push(annotation);

        // Broadcast to all clients
        await this.broadcastAnnotation(annotation);

        return c.json({ success: true, annotation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });

    // WebSocket endpoint
    this.app.get(
      '/ws',
      upgradeWebSocket(() => ({
        onOpen: (_evt, ws) => {
          this.clients.add(ws);
          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client connected (total: ${this.clients.size})`);
          }
        },

        onClose: () => {
          // Unable to track specific ws in onClose due to Hono API
          // Will just log general disconnection
          if (process.env.VERBOSE) {
            console.log(
              `[WebSocket] Client disconnected (total: ${this.clients.size})`
            );
          }
        },

        onMessage: async (message, ws) => {
          try {
            const msgStr = typeof message === 'string' ? message : String(message);
            const data = JSON.parse(msgStr) as WSMessage;
            await this.handleWSMessage(ws, data);
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
        .map((e) => ({
          ...e.toJSON(),
          annotations: this.annotations.get(e.id) || [],
        }));

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
  private async handleWSMessage(ws: any, data: WSMessage): Promise<void> {
    switch (data.type) {
      case 'subscribe':
        // Send initial model state
        const modelData = await this.serializeModel();
        ws.send(
          JSON.stringify({
            type: 'model',
            data: modelData,
          })
        );
        break;

      case 'annotate':
        if (data.annotation) {
          await this.broadcastAnnotation(data.annotation);
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
   * Broadcast annotation to all connected clients
   */
  private async broadcastAnnotation(annotation: ClientAnnotation): Promise<void> {
    const message = JSON.stringify({
      type: 'annotation',
      data: annotation,
    });

    for (const client of this.clients) {
      try {
        client.send(message);
      } catch (error) {
        // Silently ignore send errors
        if (process.env.DEBUG) {
          const msg = error instanceof Error ? error.message : String(error);
          console.debug(`[WebSocket] Failed to send message: ${msg}`);
        }
      }
    }
  }

  /**
   * Setup file watcher for model changes
   */
  private setupFileWatcher(): void {
    const drPath = `${this.model.rootPath}/.dr`;

    // Use dynamic import for Bun-specific APIs
    const bunModule = require('bun');
    this.watcher = bunModule.watch(drPath, {
      recursive: true,
      onChange: async (_event: any, path: any) => {
        if (process.env.VERBOSE) {
          console.log(`[Watcher] File changed: ${path}`);
        }

        try {
          // Reload model
          this.model = await Model.load(this.model.rootPath, { lazyLoad: false });

          // Broadcast update to all clients
          const modelData = await this.serializeModel();
          const message = JSON.stringify({
            type: 'model-update',
            data: modelData,
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
          elemDiv.innerHTML = \`\${element.id}<br><span style="font-size: 11px; color: #999;">\${element.name}</span>\`;
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
          <div class="element-type">\${element.type}</div>
          <h2>\${element.name}</h2>
          <div style="font-size: 12px; color: #666; margin-top: 4px;"><code>\${element.id}</code></div>
        </div>
      \`;

      if (element.description) {
        html += \`
          <div class="detail-section">
            <h3>Description</h3>
            <div class="detail-value">\${element.description}</div>
          </div>
        \`;
      }

      if (element.properties && Object.keys(element.properties).length > 0) {
        html += \`
          <div class="detail-section">
            <h3>Properties</h3>
            <div class="detail-value"><pre>\${JSON.stringify(element.properties, null, 2)}</pre></div>
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
                  <div class="author">\${ann.author}</div>
                  <div class="text">\${ann.text}</div>
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
          <form class="annotation-form" onsubmit="addAnnotation(event, '\${element.id}')">
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

    serve({
      port,
      fetch: this.app.fetch,
    });

    console.log(
      `✓ Visualization server running at http://localhost:${port}`
    );
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close?.();
    }
  }
}
