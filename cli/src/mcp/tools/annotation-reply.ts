/**
 * annotation_reply — add a reply to an annotation. Mirrors
 * `POST /api/annotations/:annotationId/replies` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationAuthorSchema, annotationContentSchema, annotationIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  content: annotationContentSchema,
  author: annotationAuthorSchema,
  rootPath: rootPathSchema,
};

export type AnnotationReplyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationReplyHandler(args: AnnotationReplyArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const reply = await store.addReply(args.annotationId, {
      author: args.author?.trim() || "Anonymous",
      content: args.content,
    });

    if (!reply) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "annotation_list" to find existing annotations',
      ]);
    }

    return jsonResult(reply);
  });
}

export const annotationReplyTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_reply",
  description: "Add a reply to an existing annotation.",
  inputSchema,
  handler: annotationReplyHandler,
};
