/**
 * McpToolRegistry — registers the DR model tool surface onto an MCP server.
 *
 * Read-only tools: model_list, model_show, model_search, model_stats,
 * model_info, model_trace.
 * Mutation tools: model_add, model_update, model_delete (via MutationHandler).
 * Pipeline tools: model_validate, model_export (via the shared validator
 * pipeline and export handlers).
 * Lifecycle tools: model_reload (force a full re-read from disk).
 * Changeset tools: changeset_list, changeset_show (via StagingAreaManager).
 * Chat tools: chat_status, chat_launch (via the coding-agents chat clients).
 * Annotation tools: annotation_list, annotation_get, annotation_create,
 * annotation_update, annotation_delete, annotation_reply (via AnnotationStore),
 * mirroring the REST server's /api/annotations/* endpoints.
 *
 * See "Tool Surface Design" and "Phase 2: Core Tools" / "Phase 3: Changesets
 * and Chat" in the architecture design.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isTelemetryEnabled, startActiveSpan } from "../telemetry/index.js";
import {
  annotationCreateTool,
  annotationDeleteTool,
  annotationGetTool,
  annotationListTool,
  annotationReplyTool,
  annotationUpdateTool,
  changesetListTool,
  changesetShowTool,
  chatLaunchTool,
  chatStatusTool,
  modelAddTool,
  modelDeleteTool,
  modelExportTool,
  modelInfoTool,
  modelListTool,
  modelReloadTool,
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
  modelReloadTool,
  changesetListTool,
  changesetShowTool,
  chatStatusTool,
  chatLaunchTool,
  annotationListTool,
  annotationGetTool,
  annotationCreateTool,
  annotationUpdateTool,
  annotationDeleteTool,
  annotationReplyTool,
];

export class McpToolRegistry {
  /** Registers every model tool onto the given MCP server instance. */
  registerAll(server: McpServer): void {
    for (const tool of MODEL_TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (args: any) =>
          startActiveSpan(
            `mcp.tool.${tool.name}`,
            async (span) => {
              const result = await tool.handler(args);
              if (isTelemetryEnabled && result?.isError) {
                const firstContent = result.content?.[0];
                const message =
                  firstContent?.type === "text" ? firstContent.text : "Tool returned an error";
                span.setStatus({ code: 2, message });
              }
              return result;
            },
            { "mcp.tool.name": tool.name }
          )
      );
    }
  }
}
