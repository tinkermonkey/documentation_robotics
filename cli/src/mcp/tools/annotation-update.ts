/**
 * annotation_update — partially update an annotation's content, tags, or
 * resolved state. Mirrors `PATCH /api/annotations/:annotationId` (and the
 * REST server's equivalently-partial `PUT`) on the REST server.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationContentSchema, annotationIdSchema, annotationTagsSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  content: annotationContentSchema.optional(),
  tags: annotationTagsSchema,
  resolved: z.boolean().optional().describe("Mark the annotation resolved or unresolved."),
  rootPath: rootPathSchema,
};

export type AnnotationUpdateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationUpdateHandler(args: AnnotationUpdateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.content === undefined && args.tags === undefined && args.resolved === undefined) {
      throw new CLIError("At least one of content, tags, or resolved must be provided", ErrorCategory.USER);
    }

    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const updated = await store.update(args.annotationId, {
      content: args.content,
      tags: args.tags,
      resolved: args.resolved,
    });

    if (!updated) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "annotation_list" to find existing annotations',
      ]);
    }

    return jsonResult(updated);
  });
}

export const annotationUpdateTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_update",
  description: "Partially update an annotation's content, tags, or resolved state.",
  inputSchema,
  handler: annotationUpdateHandler,
};
