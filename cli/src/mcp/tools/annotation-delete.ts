/**
 * annotation_delete — delete an annotation and its replies. Mirrors
 * `DELETE /api/annotations/:annotationId` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationChangesetSchema, annotationIdSchema, annotationResult, findAnnotation, NOT_FOUND_HINT } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  changeset: annotationChangesetSchema,
  rootPath: rootPathSchema,
};

export type AnnotationDeleteArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationDeleteHandler(args: AnnotationDeleteArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const found = await findAnnotation(model, args.annotationId, args.changeset);
    const deleted = found && (await found.store.delete(args.annotationId));

    if (!found || !deleted) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        NOT_FOUND_HINT,
      ]);
    }

    return jsonResult(annotationResult({ status: "deleted", annotationId: args.annotationId }, found));
  });
}

export const annotationDeleteTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_delete",
  description: "Delete an annotation and its replies. A staged annotation is deleted from its changeset.",
  inputSchema,
  handler: annotationDeleteHandler,
};
