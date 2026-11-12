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
 * Change-modeling tools (docs/CHANGE_MODELING.md): changeset_create, changeset_activate,
 * changeset_deactivate, relationship_add, relationship_delete, spec_type, changeset_impact,
 * changeset_brief, changeset_verify, changeset_adopt_source_references (copies verify's missing
 * source references onto the plan), gap_accept and gap_reopen (accepted gaps). Apply is not exposed.
 * Landing (changeset-commit.ts): changeset_commit commits a staged changeset only after a person
 * confirms it in an elicitation dialog. It is listed with _meta "anthropic/requiresUserInteraction",
 * is refused in changeset-only mode, and is never on DrBot's allowlists.
 * Changeset editing (changeset-editing.ts): changeset_update, changeset_unstage, and
 * changeset_discard (requires confirm: true; it deletes the staged changes).
 * Chat tools: chat_status, chat_launch (via the coding-agents chat clients).
 * Codebase tools: codebase_index (starts a background index and returns at once; poll with
 * status: true), codebase_verify (the code against the model's api, data-store, technology and testing layers). Neither writes the model.
 * codebase_extract stages what the extraction cascade finds into an as-built changeset (never the base).
 * Annotation tools: annotation_list, annotation_get, annotation_create,
 * annotation_update, annotation_delete, annotation_reply (via AnnotationStore),
 * mirroring the REST server's /api/annotations/* endpoints.
 * Project tools (project-tools.ts): project_init (create a model, no prompts) and
 * project_upgrade (preview a spec migration; apply it with apply: true).
 * Review tools: review_open (a viewer link to a changeset; reuses or starts `dr visualize`).
 * Project tools: project_status (where the repo stands with DR, and the next step).
 */

import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";
import { isTelemetryEnabled, startActiveSpan } from "../telemetry/index.js";
import { unknownArgumentsMessage } from "./strict-schema.js";
import {
  annotationCreateTool,
  annotationDeleteTool,
  annotationGetTool,
  annotationListTool,
  annotationReplyTool,
  annotationUpdateTool,
  changesetActivateTool,
  changesetBriefTool,
  changesetCreateTool,
  changesetDeactivateTool,
  changesetImpactTool,
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
  relationshipAddTool,
  relationshipDeleteTool,
  specTypeTool,
  type McpToolDefinition,
} from "./tools/index.js";
import { changesetDiscardTool, changesetUnstageTool, changesetUpdateTool } from "./tools/index.js";
import { changesetAdoptSourceReferencesTool, changesetVerifyTool } from "./tools/index.js";
import { projectInitTool, projectUpgradeTool } from "./tools/index.js";
import { codebaseIndexTool, codebaseVerifyTool } from "./tools/index.js";
import { changesetCommitTool } from "./tools/index.js";
import { reviewOpenTool } from "./tools/index.js";
import { projectStatusTool } from "./tools/index.js";
import { codebaseExtractTool } from "./tools/index.js";
import { gapAcceptTool, gapReopenTool } from "./tools/index.js";
import { errorResult, loadModel, rootPathSchema } from "./tools/shared.js";
import { changesetOnlyRefusal } from "./changeset-only.js";
import { whenProjectRootSettled } from "./project-root.js";

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
  changesetCreateTool,
  changesetActivateTool,
  changesetDeactivateTool,
  relationshipAddTool,
  relationshipDeleteTool,
  specTypeTool,
  changesetImpactTool,
  changesetBriefTool,
  chatStatusTool,
  chatLaunchTool,
  annotationListTool,
  annotationGetTool,
  annotationCreateTool,
  annotationUpdateTool,
  annotationDeleteTool,
  annotationReplyTool,
  changesetUpdateTool,
  changesetUnstageTool,
  changesetDiscardTool,
  changesetVerifyTool,
  changesetAdoptSourceReferencesTool,
  projectInitTool,
  projectUpgradeTool,
  codebaseIndexTool,
  codebaseVerifyTool,
  changesetCommitTool,
  reviewOpenTool,
  projectStatusTool,
  codebaseExtractTool,
  gapAcceptTool,
  gapReopenTool,
];

/** Names of every tool the registry registers. */
export function registeredToolNames(): string[] {
  return MODEL_TOOLS.map((tool) => tool.name);
}

export { unknownArgumentsMessage };

/**
 * The schema a tool is registered with: its arguments plus the optional rootPath every tool takes,
 * strict, so tools/list says no other argument is accepted and a call with one is refused with
 * unknownArgumentsMessage.
 */
export function registeredInputSchema(toolName: string, shape: ZodRawShape) {
  const full: ZodRawShape = "rootPath" in shape ? shape : { ...shape, rootPath: rootPathSchema };
  const accepted = Object.keys(full);
  return z.strictObject(full, {
    error: (issue) =>
      issue.code === "unrecognized_keys" ? unknownArgumentsMessage(toolName, accepted, issue.keys) : undefined,
  });
}

export class McpToolRegistry {
  /** Registers every model tool onto the given MCP server instance. */
  registerAll(server: McpServer): void {
    for (const tool of MODEL_TOOLS) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: registeredInputSchema(tool.name, tool.inputSchema),
          ...(tool._meta ? { _meta: tool._meta } : {}),
        },
        (args: Parameters<typeof tool.handler>[0], extra?: { requestId?: RequestId; signal?: AbortSignal }) =>
          startActiveSpan(
            `mcp.tool.${tool.name}`,
            async (span) => {
              // Tools that don't load the model still read the project from the working
              // directory, so wait until the client's roots have settled which project that is.
              await whenProjectRootSettled();
              // Changeset-only mode (DR_CHANGESET_ONLY): refuse base-model writes up front.
              const refusal = await changesetOnlyRefusal(tool.name, (args as { rootPath?: string }).rootPath, loadModel);
              const result = refusal
                ? errorResult(refusal)
                : await tool.handler(args, { server: server.server, requestId: extra?.requestId, signal: extra?.signal });
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
