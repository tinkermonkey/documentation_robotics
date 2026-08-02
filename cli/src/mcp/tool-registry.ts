/**
 * McpToolRegistry — registers the DR model tool surface onto an MCP server.
 *
 * Read-only tools: model_list, model_show, model_search, model_stats,
 * model_info, model_trace.
 * Mutation tools: model_add, model_update, model_delete (via MutationHandler).
 * Pipeline tools: model_validate, model_export (via the shared validator
 * pipeline and export handlers).
 *
 * See "Tool Surface Design" and "Phase 2: Core Tools" in the architecture design.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  modelAddTool,
  modelDeleteTool,
  modelExportTool,
  modelInfoTool,
  modelListTool,
  modelSearchTool,
  modelShowTool,
  modelStatsTool,
  modelTraceTool,
  modelUpdateTool,
  modelValidateTool,
  type McpToolDefinition,
} from "./tools/index.js";

const MODEL_TOOLS: McpToolDefinition[] = [
  modelListTool,
  modelShowTool,
  modelSearchTool,
  modelStatsTool,
  modelInfoTool,
  modelTraceTool,
  modelAddTool,
  modelUpdateTool,
  modelDeleteTool,
  modelValidateTool,
  modelExportTool,
];

export class McpToolRegistry {
  /** Registers every model tool onto the given MCP server instance. */
  registerAll(server: McpServer): void {
    for (const tool of MODEL_TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        tool.handler
      );
    }
  }
}
