/**
 * annotation_get — retrieve a single annotation (with its replies) by ID.
 * Mirrors `GET /api/annotations/:annotationId` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationChangesetSchema, annotationIdSchema, annotationResult, findAnnotation } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  changeset: annotationChangesetSchema,
  rootPath: rootPathSchema,
};

export type AnnotationGetArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationGetHandler(args: AnnotationGetArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const found = await findAnnotation(model, args.annotationId, args.changeset);
    if (!found) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "annotation_list" to find existing annotations',
      ]);
    }
    return jsonResult(annotationResult(found.annotation, found));
  });
}

export const annotationGetTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_get",
  description: "Get a single annotation by ID, including its replies. Looks in the active (or named) changeset's staged annotations first, then the base.",
  inputSchema,
  handler: annotationGetHandler,
};
