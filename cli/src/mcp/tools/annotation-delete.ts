/**
 * annotation_delete — delete an annotation and its replies. Mirrors
 * `DELETE /api/annotations/:annotationId` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  rootPath: rootPathSchema,
};

export type AnnotationDeleteArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationDeleteHandler(args: AnnotationDeleteArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const deleted = await store.delete(args.annotationId);

    if (!deleted) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "annotation_list" to find existing annotations',
      ]);
    }

    return jsonResult({ status: "deleted", annotationId: args.annotationId });
  });
}

export const annotationDeleteTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_delete",
  description: "Delete an annotation and its replies.",
  inputSchema,
  handler: annotationDeleteHandler,
};
