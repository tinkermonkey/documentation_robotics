#!/usr/bin/env node
/**
 * Mock MCP server for analyzer integration testing
 *
 * Implements minimal JSON-RPC 2.0 interface for CBM analyzer protocol:
 * - initialize: Server initialization
 * - list_projects: List indexed projects
 * - index_repository: Index a repository (creates mock project)
 * - search_graph: Search the indexed graph
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// Mock state for server
let serverReady = false;
const indexedProjects = new Map();
const projectGraphs = new Map();

/**
 * Send a JSON-RPC response
 */
function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: "2.0",
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  console.log(JSON.stringify(response));
}

/**
 * Send a JSON-RPC error response
 */
function sendError(id, code, message, data = null) {
  const error = { code, message };
  if (data) {
    error.data = data;
  }
  sendResponse(id, null, error);
}

/**
 * Generate mock endpoint candidates from graph
 */
function generateEndpointCandidates(projectPath) {
  const routeCount = 3;
  const candidates = [];

  for (let i = 0; i < routeCount; i++) {
    candidates.push({
      source_file: `src/routes${i > 0 ? i : ""}.ts`,
      confidence: i === 0 ? "high" : "medium",
      suggested_layer: "api",
      suggested_element_type: "operation",
      suggested_name: `route-${i}`,
      http_method: "GET",
      http_path: `/api/endpoint-${i}`,
      handler_qualified_name: `Handler${i}`,
      source_symbol: `route${i}`,
      source_start_line: 10 + i * 10,
      source_end_line: 20 + i * 10,
    });
  }

  return candidates;
}

rl.on("line", (line) => {
  try {
    const request = JSON.parse(line);

    if (!request || typeof request !== "object") {
      return;
    }

    const { jsonrpc, method, params, id } = request;

    if (jsonrpc !== "2.0") {
      return;
    }

    // Handle notifications (no id)
    if (!id) {
      if (method === "shutdown") {
        process.exit(0);
      }
      return;
    }

    // Handle initialize
    if (method === "initialize") {
      serverReady = true;
      sendResponse(id, {
        capabilities: {
          tools: ["index_repository", "search_graph", "list_projects"],
        },
        serverInfo: {
          name: "mock-mcp-analyzer",
          version: "1.0.0",
        },
      });
      return;
    }

    if (!serverReady && method !== "initialize") {
      sendError(id, -32700, "Server not initialized");
      return;
    }

    // Handle list_projects tool
    if (method === "list_projects") {
      const projects = [];
      for (const [projectPath, meta] of indexedProjects) {
        projects.push({
          path: projectPath,
          indexed: true,
          metadata: meta,
        });
      }
      sendResponse(id, { projects });
      return;
    }

    // Handle index_repository tool
    if (method === "index_repository") {
      const projectPath = params?.repo_path || params?.path;
      if (!projectPath) {
        sendError(id, -32600, "Missing repo_path parameter");
        return;
      }

      // Create mock project metadata
      const metadata = {
        indexed_at: new Date().toISOString(),
        node_count: 25,
        edge_count: 42,
        git_head: "abc123def456",
        languages: ["typescript", "javascript"],
      };

      indexedProjects.set(projectPath, metadata);

      // Generate mock graph data
      const graph = {
        nodes: [
          { id: "Route:1", label: "Route", properties: { file_path: "src/routes.ts", method: "GET", path: "/users" } },
          { id: "Route:2", label: "Route", properties: { file_path: "src/routes.ts", method: "POST", path: "/users" } },
          { id: "Function:1", label: "Function", properties: { file_path: "src/handlers.ts", name: "getUsers" } },
          { id: "Class:1", label: "Class", properties: { file_path: "src/controllers.ts", name: "UserController" } },
        ],
        edges: [
          { from: "Route:1", to: "Function:1", type: "HANDLES" },
          { from: "Route:2", to: "Class:1", type: "HANDLES" },
          { from: "Function:1", to: "Class:1", type: "CALLS" },
        ],
      };

      projectGraphs.set(projectPath, graph);

      sendResponse(id, {
        project_path: projectPath,
        indexed: true,
        metadata,
      });
      return;
    }

    // Handle search_graph tool
    if (method === "search_graph") {
      const projectPath = params?.project || params?.path;
      if (!projectPath) {
        sendError(id, -32600, "Missing project parameter");
        return;
      }

      const query = params?.query || "";
      const graph = projectGraphs.get(projectPath);

      if (!graph) {
        sendError(id, -32000, "Project not indexed");
        return;
      }

      // Filter nodes based on query if provided
      let results = graph.nodes;
      if (query) {
        const lowerQuery = query.toLowerCase();
        results = graph.nodes.filter((node) =>
          node.label.toLowerCase().includes(lowerQuery) ||
          JSON.stringify(node.properties).toLowerCase().includes(lowerQuery)
        );
      }

      // Also include edges if querying for them
      sendResponse(id, {
        nodes: results,
        edges: query.includes("edge") ? graph.edges : [],
        query,
        total: results.length,
      });
      return;
    }

    // Handle tools/list for MCP protocol
    if (method === "tools/list") {
      sendResponse(id, {
        tools: [
          {
            name: "index_repository",
            description: "Index a repository with the analyzer",
            inputSchema: {
              type: "object",
              properties: {
                repo_path: { type: "string", description: "Repository path" },
              },
              required: ["repo_path"],
            },
          },
          {
            name: "search_graph",
            description: "Search the indexed graph",
            inputSchema: {
              type: "object",
              properties: {
                project: { type: "string", description: "Project path" },
                label: { type: "string", description: "Node label to search for" },
              },
              required: ["project"],
            },
          },
          {
            name: "list_projects",
            description: "List all indexed projects",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      });
      return;
    }

    // Default: unknown method
    sendError(id, -32601, "Method not found");
  } catch (err) {
    // Invalid JSON — ignore
  }
});

rl.on("close", () => {
  process.exit(0);
});

// Graceful shutdown on signals
process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});
