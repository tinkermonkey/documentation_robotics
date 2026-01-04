# Python CLI vs TypeScript CLI Command Mapping

## Command Comparison

| Python CLI       | TypeScript CLI    | Status             | Notes                                                                |
| ---------------- | ----------------- | ------------------ | -------------------------------------------------------------------- |
| `dr init`        | `dr init`         | ✅ Both            | Initialize new model                                                 |
| `dr add`         | `dr add`          | ✅ Both            | Add element to layer                                                 |
| `dr update`      | `dr update`       | ✅ Both            | Update existing element                                              |
| `dr remove`      | `dr delete`       | ⚠️ Different name  | Delete element                                                       |
| `dr find`        | `dr show`         | ⚠️ Different name  | Display element details                                              |
| `dr list`        | `dr list`         | ✅ Both            | List elements in layer                                               |
| `dr search`      | `dr search`       | ✅ Both            | Search for elements                                                  |
| `dr validate`    | `dr validate`     | ✅ Both            | Validate model                                                       |
| `dr export`      | `dr export`       | ✅ Both            | Export to various formats                                            |
| `dr trace`       | `dr trace`        | ✅ Both            | Trace dependencies                                                   |
| `dr project`     | `dr project`      | ✅ Both            | Project element to layers                                            |
| `dr project-all` | `dr project-all`  | ✅ Both            | Project all elements                                                 |
| `dr conformance` | `dr conformance`  | ✅ Both            | Check conformance                                                    |
| `dr changeset`   | `dr changeset`    | ✅ Both            | Manage changesets                                                    |
| `dr migrate`     | -                 | ❌ Python only     | Migrate to new version                                               |
| `dr upgrade`     | `dr upgrade`      | ⚠️ Enhanced        | TypeScript: unified upgrade + migration; Python: spec reference only |
| `dr version`     | `dr version`      | ✅ Both            | Show version info                                                    |
| `dr visualize`   | `dr visualize`    | ✅ Both            | Start visualization server                                           |
| `dr links`       | -                 | ❌ Python only     | Query cross-layer links                                              |
| `dr claude`      | -                 | ❌ Python only     | Claude Code integration                                              |
| `dr copilot`     | -                 | ❌ Python only     | GitHub Copilot integration                                           |
| -                | `dr info`         | ❌ TypeScript only | Show model info                                                      |
| -                | `dr chat`         | ❌ TypeScript only | Interactive chat                                                     |
| -                | `dr element`      | ❌ TypeScript only | Element operations                                                   |
| -                | `dr relationship` | ❌ TypeScript only | Relationship operations                                              |

## Commands for Differential Testing

### High Priority (Core Functionality)

1. ✅ `validate` - Model validation
2. ✅ `export` - Export to GraphML, etc.
3. ✅ `list` - List elements
4. ✅ `search` - Search elements
5. ✅ `trace` - Dependency tracing
6. ✅ `project` - Element projection
7. ✅ `conformance` - Conformance checking

### Medium Priority (CRUD Operations)

8. ✅ `init` - Initialize model
9. ✅ `add` - Add elements
10. ✅ `update` - Update elements
11. ⚠️ `remove`/`delete` - Delete elements (different names)
12. ⚠️ `find`/`show` - Show element (different names)

### Lower Priority (Advanced Features)

13. ✅ `visualize` - Visualization server
14. ⚠️ `migrate` - Version migration (Python only; merged into TypeScript `upgrade`)
15. ✅ `changeset` - Changeset management
16. ⚠️ `upgrade` - Project upgrade (TypeScript: unified upgrade + migration)
17. ✅ `version` - Version info

## Server/API Testing

### Visualization Server

Both CLIs provide visualization servers. Need to test:

- Server startup
- Port configuration
- WebSocket protocol
- API endpoints
- Model serialization

### Python Server Modules (in python-cli/src/documentation_robotics/server/)

- `visualization_server.py` - Main server
- `websocket_protocol.py` - WebSocket handling
- `annotation_serializer.py` - Annotation serialization
- `chat_handler.py` - Chat message handling
- `chat_protocol.py` - Chat protocol
- `model_serializer.py` - Model serialization
- `file_monitor.py` - File watching

### TypeScript Server Modules (in cli/src/server/)

- `server.ts` - Main Hono server
- WebSocket support built-in
- Annotation management
- Model change notifications

## Test Strategy

### Phase 1: Command Exit Code Testing

Test that both CLIs return same exit codes for:

- Success scenarios
- Error scenarios
- Invalid inputs

### Phase 2: Output Format Testing

Compare output structure:

- JSON output format
- List formatting
- Error messages

### Phase 3: Server API Testing

Compare server endpoints:

- HTTP endpoints
- WebSocket messages
- Annotation format
- Model serialization

### Phase 4: End-to-End Workflows

Test complete workflows:

- Init → Add → Validate → Export
- Trace → Project → Validate
- Visualize → Annotate → Export
