/**
 * annotation_reply — add a reply to an annotation. Mirrors
 * `POST /api/annotations/:annotationId/replies` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationAuthorSchema, annotationChangesetSchema, annotationContentSchema, annotationIdSchema, annotationResult, findAnnotation, NOT_FOUND_HINT } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  content: annotationContentSchema,
  author: annotationAuthorSchema,
  changeset: annotationChangesetSchema,
  rootPath: rootPathSchema,
};

export type AnnotationReplyArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationReplyHandler(args: AnnotationReplyArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const found = await findAnnotation(model, args.annotationId, args.changeset);
    const reply = found && (await found.store.addReply(args.annotationId, {
      author: args.author?.trim() || "Anonymous",
      content: args.content,
    }));

    if (!found || !reply) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        NOT_FOUND_HINT,
      ]);
    }

    return jsonResult(annotationResult(reply, found));
  });
}

export const annotationReplyTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_reply",
  description: "Add a reply to an existing annotation. A reply to a staged annotation stays staged in its changeset.",
  inputSchema,
  handler: annotationReplyHandler,
};
