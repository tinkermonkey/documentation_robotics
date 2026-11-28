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
 * Landing (changeset-commit.ts): changeset_commit lands one or several staged changesets when the
 * user asks in the conversation (git and the pull request are the gate: no dialog, no token). It is
 * refused in changeset-only mode and is never on DrBot's allowlists. changeset_commit_preview is the
 * read-only dry run; it isn't on them either.
 * Changeset editing (changeset-editing.ts): changeset_update, changeset_unstage, and
 * changeset_discard (requires confirm: true; it deletes the staged changes).
 * Chat tools: chat_status, chat_launch (via the coding-agents chat clients).
 * Codebase tools: codebase_index (starts a background index and returns at once; poll with
 * status: true), codebase_verify (the code against the model's api, data-store, technology and testing layers). Neither writes the model.
 * codebase_extract stages what the extraction cascade finds into an as-built changeset (never the base).
 * tier1_status says whether Tier 1 is on for the checkout, and its spend; probe: true tests it.
 * Annotation tools: annotation_list, annotation_get, annotation_create,
 * annotation_update, annotation_delete, annotation_reply (via AnnotationStore),
 * mirroring the REST server's /api/annotations/* endpoints.
 * Project tools (project-tools.ts): project_init (create a model, no prompts) and
 * project_upgrade (preview a spec migration; apply it with apply: true).
 * Review tools: review_open (a viewer link to a changeset; reuses or starts `dr visualize`).
 * Project tools: project_status (where the repo stands with DR, and the next step).
 *
 * In the central process (issue 1279) each MCP session registers its own copy with its
 * `McpSession`: every call runs in the session's checkout and environment, and every result names
 * the `project` and `checkout` it resolved to (withResultCheckout), in this dispatch, not per tool.
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
import { changesetCommitTool, changesetCommitPreviewTool } from "./tools/index.js";
import { reviewOpenTool } from "./tools/index.js";
import { projectStatusTool } from "./tools/index.js";
import { projectListTool } from "./tools/index.js";
import { codebaseExtractTool, tier1StatusTool } from "./tools/index.js";
import { gapAcceptTool, gapReopenTool } from "./tools/index.js";
import { errorResult, loadModel, rootPathSchema } from "./tools/shared.js";
import { changesetOnlyRefusal } from "./changeset-only.js";
import { CHAT_PROJECT_ROOT_ENV, chatToolRefusal } from "../coding-agents/chat-guard.js";
import { DR_MCP_CHANGESET_TOOLS, DR_MCP_READ_TOOLS } from "../coding-agents/drbot-mcp.js";
import { currentProjectRoot, runInMcpSession, whenProjectRootSettled } from "./project-root.js";
import { currentWriter, runAsWriter } from "../core/changeset-write-activity.js";
import type { McpSession } from "./mcp-session.js";
import { runWithSessionEnv, sessionEnv } from "../core/session-env.js";
import type { McpResultCheckout } from "../server/central-mcp-contract.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { countToolCall } from "./tool-calls-in-flight.js";

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
  changesetCommitPreviewTool,
  reviewOpenTool,
  projectStatusTool,
  projectListTool,
  codebaseExtractTool,
  gapAcceptTool,
  gapReopenTool,
  tier1StatusTool,
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

/** The `_meta` key a tool result carries its checkout under, beside the `project` and `checkout` fields. */
export const RESULT_CHECKOUT_META = "dr/checkout";

/**
 * Names the checkout a call resolved to on its result: `project`, `checkout` and `branch` as the first
 * fields of a JSON object result (unless the tool set them itself), else as a text item of their
 * own; and under `_meta["dr/checkout"]` either way. A checkout the registry doesn't know is named
 * as null.
 */
export function withResultCheckout(result: CallToolResult, ref: McpResultCheckout | null): CallToolResult {
  // The branch beside the checkout key (#1422): `main` names a project's primary folder, not a branch.
  const named: { project: string | null; checkout: string | null; branch?: string | null } = {
    project: ref?.project ?? null,
    checkout: ref?.checkout ?? null,
    ...(ref === null || ref.branch !== undefined ? { branch: ref?.branch ?? null } : {}),
  };
  const meta = { ...(result._meta ?? {}), [RESULT_CHECKOUT_META]: named };
  const content = [...(result.content ?? [])];
  const first = content[0];
  let merged = false;
  if (first?.type === "text" && first.text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(first.text);
    } catch {
      parsed = undefined;
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const fields = parsed as Record<string, unknown>;
      if ("project" in fields || "checkout" in fields) {
        merged = true; // The tool names them itself (project_status, project_list).
      } else {
        // Insert the fields after the opening brace, keeping the tool's own layout.
        const p = JSON.stringify(named.project);
        const c = JSON.stringify(named.checkout);
        // A tool with a `branch` field of its own keeps it: a second key would shadow it.
        const b = "branch" in named && !("branch" in fields) ? JSON.stringify(named.branch) : undefined;
        const rest = first.text.slice(1);
        const empty = Object.keys(fields).length === 0;
        const text = first.text.startsWith("{\n")
          ? `{\n  "project": ${p},\n  "checkout": ${c},${b !== undefined ? `\n  "branch": ${b},` : ""}${rest}`
          : `{"project":${p},"checkout":${c}${b !== undefined ? `,"branch":${b}` : ""}${empty ? "" : ","}${rest}`;
        content[0] = { ...first, text };
        merged = true;
      }
    }
  }
  if (!merged) content.push({ type: "text", text: JSON.stringify(named) });
  return { ...result, content, _meta: meta };
}

export interface RegisterToolsOptions {
  /**
   * The MCP session the server serves (the central process gives each its own): every call runs
   * in it, so it resolves the session's checkout and runs under the session's environment, and
   * its result names the checkout.
   */
  session?: McpSession;
}

export class McpToolRegistry {
  /** Registers every model tool onto the given MCP server instance. */
  registerAll(server: McpServer, options: RegisterToolsOptions = {}): void {
    const session = options.session;
    for (const tool of MODEL_TOOLS) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: registeredInputSchema(tool.name, tool.inputSchema),
          ...(tool._meta ? { _meta: tool._meta } : {}),
        },
        (args: Parameters<typeof tool.handler>[0], extra?: { requestId?: RequestId; signal?: AbortSignal }) => {
          const call = () => startActiveSpan(
            `mcp.tool.${tool.name}`,
            async (span) => {
              // The client initialized or said its roots changed: ask for them on this call's own
              // stream (relatedRequestId), which a streamable-HTTP client is sure to be reading.
              if (session?.root.needsRoots && server.server.getClientCapabilities()?.roots) {
                await session.root.follow(() =>
                  server.server.listRoots(undefined, extra?.requestId !== undefined ? { relatedRequestId: extra.requestId } : undefined)
                );
              }
              // Tools that don't load the model still read the session's project, so wait until
              // the client's roots have settled which project that is.
              await whenProjectRootSettled();
              // A server the viewer's chat started (DR_CHAT_MODE) refuses, itself, a tool outside
              // the chat's mode and any rootPath but the served project (coding-agents/chat-guard.ts).
              // Changeset-only mode (DR_CHANGESET_ONLY): refuse base-model writes up front.
              const rootPath = (args as { rootPath?: string }).rootPath;
              const env = sessionEnv();
              const refusal =
                chatToolRefusal(
                  tool.name,
                  rootPath,
                  env[CHAT_PROJECT_ROOT_ENV]?.trim() || currentProjectRoot().root,
                  { read: DR_MCP_READ_TOOLS, staging: DR_MCP_CHANGESET_TOOLS },
                  env
                ) ?? (await changesetOnlyRefusal(tool.name, rootPath, loadModel, env));
              const handled = refusal
                ? errorResult(refusal)
                : await tool.handler(args, { server: server.server, requestId: extra?.requestId, signal: extra?.signal });
              const result = session ? withResultCheckout(handled, await session.checkoutFor(rootPath)) : handled;
              if (isTelemetryEnabled && result?.isError) {
                const firstContent = result.content?.[0];
                const message =
                  firstContent?.type === "text" ? firstContent.text : "Tool returned an error";
                span.setStatus({ code: 2, message });
              }
              return result;
            },
            { "mcp.tool.name": tool.name }
          );
          // Every write the call makes is this session's (changeset-write-activity.ts). A server
          // without sessions serves one client from its own process: the process is the writer.
          const writer = session?.writer ?? currentWriter();
          return countToolCall(() =>
            runAsWriter(writer, () =>
              session ? runInMcpSession(session.root, () => runWithSessionEnv(session.env, call)) : call()
            )
          );
        }
      );
    }
  }
}
