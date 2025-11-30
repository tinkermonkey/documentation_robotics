# Visualization Guide

The Documentation Robotics CLI includes a built-in visualization server that provides a real-time, interactive web interface for exploring your architecture models.

## Overview

The `dr visualize` command starts a local HTTP server that serves an interactive React-based visualization of your model. The visualization automatically updates as you edit model files, providing immediate visual feedback during development.

### Key Features

- **Real-time Updates**: See changes instantly as you edit model files
- **Interactive Exploration**: Navigate through layers, elements, and relationships
- **Specification Viewing**: View the Documentation Robotics specification alongside your model
- **Changeset Visualization**: Explore different changesets and their impacts
- **Cross-layer Traceability**: Follow relationships across all 12 layers
- **WebSocket Communication**: Efficient live updates without page refreshes

## Quick Start

```bash
# Navigate to your project directory
cd my-project

# Start the visualization server
dr visualize

# Server will start and open your default browser
# Default URL: http://localhost:8080
```

## Command Reference

### Basic Usage

```bash
dr visualize [OPTIONS]
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--port` | Integer | 8080 | Port number for the HTTP server |
| `--host` | String | localhost | Host address to bind to |
| `--no-browser` | Flag | False | Don't automatically open browser |
| `--help` | Flag | - | Show help message and exit |

### Examples

```bash
# Start server on default port (8080)
dr visualize

# Start on custom port
dr visualize --port 9090

# Start without opening browser
dr visualize --no-browser

# Bind to all network interfaces (use with caution)
dr visualize --host 0.0.0.0

# Custom port without browser
dr visualize --port 3000 --no-browser
```

## Prerequisites

### Required Dependencies

The visualization feature requires the following Python packages:

- `aiohttp>=3.9.0` - Async HTTP server
- `watchdog>=3.0.0` - File system monitoring
- `documentation-robotics-viewer>=0.1.0` - React-based visualization UI

These dependencies are installed automatically when you install the CLI:

```bash
pip install documentation-robotics
```

### System Requirements

- Python 3.10 or later
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Minimum 512MB available RAM
- Port 8080 available (or specify alternative with `--port`)

## Architecture

### Components

The visualization system consists of three main components:

1. **HTTP Server** - Serves static assets and handles requests
2. **WebSocket Server** - Maintains real-time connections with browser clients
3. **File Monitor** - Watches model directory for changes

### Data Flow

```
User edits model file
    ↓
File Monitor detects change
    ↓
Server processes update
    ↓
WebSocket broadcasts to all connected clients
    ↓
Browser updates visualization (no page reload)
```

### Initial Connection

When a browser connects to the visualization server:

1. WebSocket connection established
2. Server sends initial state message containing:
   - **Specification**: DR spec from `.dr/specification/`
   - **Model**: Complete model data from `documentation-robotics/model/`
   - **Changesets**: List of available changesets from `.dr/changesets/`

## Usage Patterns

### Development Workflow

```bash
# Terminal 1: Start visualization server
dr visualize

# Terminal 2: Make changes to your model
dr add business service --name "Order Service"
dr validate

# Browser automatically updates to show new service
```

### Team Collaboration

```bash
# Team member 1: Start server and share port
dr visualize --port 8080

# Team member 2: Can view via localhost (same machine only)
# For network access, use with caution:
dr visualize --host 0.0.0.0 --port 8080
```

**Security Note**: The visualization server is designed for local development. It does not include authentication or authorization. Only expose to trusted networks.

### CI/CD Integration

The visualization server is not recommended for CI/CD pipelines. For automated validation, use:

```bash
dr validate --validate-links --strict-links
```

## Advanced Features

### File Watching

The server monitors these file types in the `documentation-robotics/model/` directory:

- `*.yaml` - Model element files
- `*.yml` - Alternative YAML extension

**Excluded from monitoring**:
- `manifest.yaml` - Manifest changes require server restart
- `.dr/specification/` - Specification is static per CLI version
- Non-YAML files

### Debouncing

File change events are debounced with a 200ms window to prevent duplicate updates during rapid file modifications (e.g., when using save-on-focus editors).

### WebSocket Protocol

The server uses a JSON-based WebSocket protocol:

**Initial State Message**:
```json
{
  "type": "initial_state",
  "specification": { ... },
  "model": { ... },
  "changesets": [ ... ]
}
```

**Element Update Messages**:
```json
{
  "type": "element_added|element_updated|element_removed",
  "data": {
    "layer": "business",
    "element_id": "business.service.customer-management",
    "element": { ... }
  }
}
```

## Troubleshooting

### Server Won't Start

**Problem**: Error message "Address already in use"

**Solution**: Port is occupied by another process
```bash
# Use a different port
dr visualize --port 9090

# Or find and stop the process using port 8080
lsof -i :8080  # On macOS/Linux
netstat -ano | findstr :8080  # On Windows
```

**Problem**: "No model found in current directory"

**Solution**: Run from project root directory or initialize a model
```bash
# Check current directory
pwd

# Initialize if needed
dr init my-project
cd my-project
dr visualize
```

**Problem**: "Specification directory not found"

**Solution**: The CLI needs access to the specification directory
```bash
# Reinstall CLI to ensure spec is available
pip install --upgrade documentation-robotics
```

### Viewer Not Loading

**Problem**: Placeholder HTML shown instead of visualization UI

**Solution**: Install viewer package
```bash
pip install documentation-robotics-viewer
```

**Problem**: Blank page or 404 errors

**Solution**: Clear browser cache and reload
- Chrome/Edge: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (macOS)
- Firefox: `Ctrl+F5` or `Cmd+Shift+R`

### Updates Not Appearing

**Problem**: Changes to files not reflected in browser

**Solution**: Check file monitor status
1. Visit `http://localhost:8080/health`
2. Verify `file_monitor_running: true`
3. Check console output for error messages

**Problem**: Specific files not triggering updates

**Solution**: Ensure files are in correct location
- Must be under `documentation-robotics/model/`
- Must have `.yaml` or `.yml` extension
- Must not be `manifest.yaml`

### Performance Issues

**Problem**: Slow initial load

**Solution**: Large models may take time to serialize
- Expected: < 2 seconds for models with < 1000 elements
- If slower, check model size with `dr stats`

**Problem**: High memory usage

**Solution**: Server holds entire model in memory
- Expected: ~1-10 MB for typical models
- Large models (>10,000 elements) may use more memory

### Browser Compatibility

**Supported Browsers**:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

**Known Issues**:
- Internet Explorer: Not supported
- Older browsers: WebSocket support required

## Security Considerations

### Local Development Only

The visualization server is designed for local development:

- **No authentication**: Anyone with network access can view your model
- **No authorization**: All model data is accessible
- **No encryption**: WebSocket traffic is unencrypted (ws://, not wss://)

### Recommended Practices

1. **Bind to localhost**: Use default `--host localhost` for local-only access
2. **Firewall**: Ensure firewall blocks external access to visualization port
3. **Sensitive Data**: Don't use visualization on public/untrusted networks
4. **Production**: Never deploy visualization server to production environments

### Network Exposure

Only expose to network when necessary:

```bash
# Good: Local only (default)
dr visualize

# Caution: Network accessible
dr visualize --host 0.0.0.0

# Only use network mode on trusted networks
```

## Integration with Other Tools

### Claude Code

Use visualization while working with Claude Code:

```bash
# Terminal 1: Start visualization
dr visualize

# Terminal 2: Use Claude Code
claude
> /dr-model Add order management with payment integration
```

See changes appear in real-time as Claude Code modifies your model.

### Version Control

The visualization server is git-friendly:

- Model files remain text-based YAML
- Server reads files directly from file system
- Changes made via CLI are immediately visible
- Compatible with git workflows

### Export Workflows

Visualize before exporting:

```bash
# Start visualization to review model
dr visualize --no-browser

# In browser: Review model structure

# Export when ready
dr export --format archimate
dr export --format openapi
```

## Performance Optimization

### Initial State Caching

The server caches serialized model state to improve connection speed:

- First connection: ~500ms to serialize
- Subsequent connections: ~50ms (cached)
- Cache invalidated on file changes

### Debounce Tuning

Default debounce is 200ms. This is optimal for most editors.

For custom debouncing (requires code modification):

```python
# In visualization_server.py
file_monitor = FileMonitor(
    model_path,
    callback,
    debounce_seconds=0.5  # Increase for slower editors
)
```

### Memory Profiling

Monitor server memory usage:

```bash
# Visit health endpoint
curl http://localhost:8080/health

# Check connected_clients and model size
```

Expected memory usage:
- Base server: ~30-50 MB
- Model data: ~1-10 MB (depends on model size)
- Per WebSocket: ~10-50 KB

## Frequently Asked Questions

### Can I use visualization without internet?

Yes, the visualization runs entirely locally. Internet is only needed for initial package installation.

### Does visualization modify my model?

No, the visualization server is read-only. It monitors files but never writes changes.

### Can multiple people view the same model?

Yes, if server is exposed to network (use `--host 0.0.0.0`). All viewers see the same real-time updates.

### How do I stop the server?

Press `Ctrl+C` in the terminal running the server. The server will shut down gracefully.

### Can I customize the visualization?

The visualization UI is provided by the `documentation-robotics-viewer` package. Customization requires modifying that package.

### Does it work with changesets?

Yes, the initial state includes all changesets. Future versions will support interactive changeset switching.

## Related Documentation

- [Getting Started Guide](./getting-started.md) - Basic DR usage
- [Validation Guide](./validation.md) - Model validation
- [Link Management](./link-management.md) - Cross-layer relationships
- [Claude Code Integration](./claude-code-integration.md) - AI-powered modeling

## Version History

- **v0.5.0**: Initial visualization server implementation
  - HTTP server with WebSocket support
  - File system monitoring
  - Real-time updates
  - Specification loading

## Support

For issues or questions:

- GitHub Issues: https://github.com/tinkermonkey/documentation_robotics/issues
- Documentation: https://github.com/tinkermonkey/documentation_robotics/tree/main/cli/docs

## License

The visualization feature is part of the Documentation Robotics CLI, licensed under the MIT License.
