/**
 * changeset_create, changeset_activate, changeset_deactivate — open and switch the changeset
 * that model and relationship mutations stage into. Mirrors `dr changeset create|activate|deactivate`.
 *
 * Every one of these reloads the cached model afterwards: the model decides at load time whether
 * its layers are projected through an active changeset.
 *
 * Commit, apply and delete are deliberately not exposed over MCP: landing a change is the
 * human's step (viewer or CLI). Rename, unstage and (confirmed) discard are in
 * changeset-editing.ts. See docs/CHANGE_MODELING.md.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { resolveChangeset } from "./changeset-shared.js";

// ---------------------------------------------------------------------------
// changeset_create
// ---------------------------------------------------------------------------

const createInputSchema = {
  name: z.string().min(1).describe("Short name for the change, e.g. 'add-order-export'."),
  description: z
    .string()
    .optional()
    .describe("The change's intent: what it is for and what done looks like. Shown to the human reviewing it."),
  activate: z
    .boolean()
    .optional()
    .describe("Make it the active changeset so mutations stage into it (default true)."),
  rootPath: rootPathSchema,
};

export type ChangesetCreateArgs = z.infer<z.ZodObject<typeof createInputSchema>>;

export async function changesetCreateHandler(args: ChangesetCreateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);

    if (await manager.load(args.name)) {
      throw new CLIError(`Changeset '${args.name}' already exists`, ErrorCategory.USER, [
        `Use "changeset_activate" with "${args.name}" to continue it`,
        "Or choose another name",
      ]);
    }

    const changeset = await manager.create(args.name, args.description);
    const activate = args.activate ?? true;
    const previouslyActive = activate ? await manager.getActiveId() : null;
    if (activate) {
      await manager.setActive(changeset.id);
      await reloadModel(args.rootPath);
    }

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      ...(changeset.description ? { description: changeset.description } : {}),
      status: changeset.status,
      active: activate,
      ...(previouslyActive && previouslyActive !== changeset.id ? { deactivated: previouslyActive } : {}),
    });
  });
}

export const changesetCreateTool: McpToolDefinition<typeof createInputSchema> = {
  name: "changeset_create",
  description:
    "Start planning a change: create a changeset carrying the change's intent and (by default) activate it, " +
    "so model_add / model_update / model_delete / relationship_add / relationship_delete stage into it instead " +
    "of writing the model. Before calling it, propose the changeset's name and intent (description) to the user " +
    "and confirm both with them. Landing it is the user's step: changeset_commit commits only after they confirm " +
    "it, or they commit it in the viewer or with dr changeset commit.",
  inputSchema: createInputSchema,
  handler: changesetCreateHandler,
};

// ---------------------------------------------------------------------------
// changeset_activate
// ---------------------------------------------------------------------------

const activateInputSchema = {
  changesetId: z.string().describe("Changeset ID or name."),
  rootPath: rootPathSchema,
};

export type ChangesetActivateArgs = z.infer<z.ZodObject<typeof activateInputSchema>>;

export async function changesetActivateHandler(args: ChangesetActivateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const changeset = await resolveChangeset(manager, args.changesetId);

    if (changeset.status !== "staged") {
      throw new CLIError(
        `Changeset '${changeset.name}' is ${changeset.status} and cannot accept changes`,
        ErrorCategory.USER,
        ['Use "changeset_create" to start a new one']
      );
    }

    const previouslyActive = await manager.getActiveId();
    await manager.setActive(changeset.id);
    await reloadModel(args.rootPath);

    return jsonResult({
      id: changeset.id,
      name: changeset.name,
      active: true,
      changes: changeset.changes.length,
      ...(previouslyActive && previouslyActive !== changeset.id ? { deactivated: previouslyActive } : {}),
    });
  });
}

export const changesetActivateTool: McpToolDefinition<typeof activateInputSchema> = {
  name: "changeset_activate",
  description: "Make an existing staged changeset the active one, so mutations stage into it.",
  inputSchema: activateInputSchema,
  handler: changesetActivateHandler,
};

// ---------------------------------------------------------------------------
// changeset_deactivate
// ---------------------------------------------------------------------------

const deactivateInputSchema = {
  rootPath: rootPathSchema,
};

export type ChangesetDeactivateArgs = z.infer<z.ZodObject<typeof deactivateInputSchema>>;

export async function changesetDeactivateHandler(args: ChangesetDeactivateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const activeId = await manager.getActiveId();
    if (activeId) {
      await manager.clearActive();
      await reloadModel(args.rootPath);
    }
    return jsonResult({ deactivated: activeId ?? null });
  });
}

export const changesetDeactivateTool: McpToolDefinition<typeof deactivateInputSchema> = {
  name: "changeset_deactivate",
  description:
    "Deactivate the active changeset. Its changes stay staged; afterwards mutations write the base model directly.",
  inputSchema: deactivateInputSchema,
  handler: changesetDeactivateHandler,
};
