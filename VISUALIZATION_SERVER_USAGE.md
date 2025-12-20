# Visualization Server - Quick Reference Guide

## Starting the Server

### Basic Usage
```bash
dr visualize
```
- Starts server on default port 8080
- Automatically opens browser to `http://localhost:8080`
- Loads entire model from current directory

### Custom Port
```bash
dr visualize --port 3000
```
- Starts server on port 3000
- Opens browser to `http://localhost:3000`

### No Auto-Open Browser
```bash
dr visualize --no-browser
```
- Starts server but doesn't auto-open browser
- You can manually navigate to `http://localhost:8080`

## Viewer Interface

### Left Panel - Model Tree
- **Layers:** Collapsible list of all layers in the model
- **Elements:** Click layer header to expand/collapse
- **Selection:** Click any element to view details

### Right Panel - Element Details
- **Type & Name:** Element type and display name
- **ID:** Unique identifier in code format
- **Description:** Full description if available
- **Properties:** JSON representation of properties
- **Annotations:** Comments and feedback from team

### Status Badge (Top Right)
- **Green "Connected":** WebSocket connected, receiving updates
- **Red "Disconnected":** WebSocket disconnected, not receiving updates

## Features

### Real-Time Updates
- Changes to model files trigger automatic reload
- All connected browsers receive updates
- No need to refresh manually

### Annotations
1. Click an element to select it
2. Scroll to "Add Annotation" section
3. Enter author name and comment text
4. Click "Add Annotation" button
5. Annotation appears in list and broadcasts to other clients

### Search & Browse
- Expand layers to see all elements
- Click any element for details
- View all metadata and properties
- See all annotations for element

## REST API

The server provides REST endpoints for programmatic access:

### Get Complete Model
```bash
curl http://localhost:8080/api/model
```

### Get Specific Layer
```bash
curl http://localhost:8080/api/layers/motivation
```

### Get Element Details
```bash
curl http://localhost:8080/api/elements/motivation-goal-example
```

### Get Element Annotations
```bash
curl http://localhost:8080/api/elements/motivation-goal-example/annotations
```

### Add Annotation
```bash
curl -X POST http://localhost:8080/api/elements/motivation-goal-example/annotations \
  -H "Content-Type: application/json" \
  -d '{
    "author": "John Doe",
    "text": "This element needs review"
  }'
```

## WebSocket API

### Message Format

#### Subscribe to Updates
```javascript
ws.send(JSON.stringify({ type: "subscribe" }));
```

#### Add Annotation
```javascript
ws.send(JSON.stringify({
  type: "annotate",
  annotation: {
    elementId: "element-id",
    author: "Author Name",
    text: "Annotation text",
    timestamp: new Date().toISOString()
  }
}));
```

#### Receive Model Data
```javascript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "model") {
    const model = message.data; // Full model
  } else if (message.type === "model-update") {
    const updated = message.data; // Updated model
  } else if (message.type === "annotation") {
    const annotation = message.data; // New annotation
  }
};
```

## Architecture

### Server Components
1. **HTTP Server:** Hono framework with Bun runtime
2. **WebSocket Handler:** Real-time client communication
3. **File Watcher:** Monitors model changes
4. **Model Serializer:** Converts model to JSON
5. **Annotation System:** In-memory annotation storage

### Client Components
1. **HTML Viewer:** Interactive model browser
2. **WebSocket Client:** Real-time connection
3. **Model Tree Renderer:** Dynamic layer/element display
4. **Details Panel:** Element metadata and annotations
5. **Annotation Manager:** Add and view comments

## Performance

- **Startup:** ~1 second (with full model load)
- **WebSocket Connection:** Instant (< 100ms)
- **Model Updates:** Real-time (< 500ms)
- **File Watching:** Recursive watching of .dr/ directory
- **Memory:** Minimal footprint (~50MB for typical models)

## Troubleshooting

### Server Won't Start
- Check port is available: `lsof -i :8080`
- Verify model is initialized: `ls .dr/manifest.json`
- Check file permissions on model directory

### WebSocket Connection Fails
- Verify server is running
- Check firewall/proxy settings
- Look for browser console errors (F12)
- Try different port: `dr visualize --port 9000`

### Model Not Updating
- Verify file watcher is active
- Check .dr/ directory has write permissions
- Restart server to force reload
- Check browser console for errors

### Browser Won't Auto-Open
- Use `--no-browser` and manually navigate
- Check browser/firewall settings
- Verify port is accessible

## Advanced Usage

### Multiple Concurrent Sessions
```bash
# Terminal 1
dr visualize --port 8080

# Terminal 2
dr visualize --port 8081
```
Both servers can run independently, each monitoring same model for changes.

### Programmatic Access
```typescript
import { VisualizationServer } from '@doc-robotics/cli-bun';
import { Model } from '@doc-robotics/cli-bun';

const model = await Model.load('.', { lazyLoad: false });
const server = new VisualizationServer(model);
await server.start(8080);
```

### Custom Integration
Use REST API to integrate visualization with other tools:
- CI/CD pipelines for model validation
- External dashboards for monitoring
- Automated annotation creation
- Model export/import workflows

## Environment Variables

### VERBOSE
```bash
VERBOSE=1 dr visualize
```
Logs all WebSocket connections and file changes.

### DEBUG
```bash
DEBUG=1 dr visualize
```
Enables detailed error logging and stack traces.

## Limitations & Notes

- Annotations are in-memory (lost on server restart)
- File watcher monitors recursive changes
- Single model per server instance
- No built-in authentication
- No persistent storage (future enhancement)

## Future Enhancements

Planned improvements:
- Persistent annotation storage (database)
- User authentication and authorization
- Real-time collaboration cursors
- Advanced model search and filtering
- Model comparison and diff view
- Performance metrics visualization
- Custom model visualization themes

## Support

For issues or feature requests:
1. Check this guide first
2. Review logs with `DEBUG=1`
3. Check project documentation
4. Open issue on GitHub with details
