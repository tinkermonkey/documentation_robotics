/**
 * annotation_get — retrieve a single annotation (with its replies) by ID.
 * Mirrors `GET /api/annotations/:annotationId` on the REST server.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface AnnotationGetArgs {
  annotationId: string;
  rootPath?: string;
}

const inputSchema = {
  annotationId: annotationIdSchema,
  rootPath: rootPathSchema,
};

export async function annotationGetHandler(args: AnnotationGetArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const annotation = await store.get(args.annotationId);
    if (!annotation) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "annotation_list" to find existing annotations',
      ]);
    }
    return jsonResult(annotation);
  });
}

export const annotationGetTool: McpToolDefinition<AnnotationGetArgs> = {
  name: "annotation_get",
  description: "Get a single annotation by ID, including its replies.",
  inputSchema,
  handler: annotationGetHandler,
};
