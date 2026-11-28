/**
 * annotation_update — partially update an annotation's content, tags, or
 * resolved state. Mirrors `PATCH /api/annotations/:annotationId` (and the
 * REST server's equivalently-partial `PUT`) on the REST server.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { annotationChangesetSchema, annotationContentSchema, annotationIdSchema, annotationResult, annotationTagsSchema, findAnnotation, NOT_FOUND_HINT } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  annotationId: annotationIdSchema,
  content: annotationContentSchema.optional(),
  tags: annotationTagsSchema,
  resolved: z.boolean().optional().describe("Mark the annotation resolved or unresolved."),
  changeset: annotationChangesetSchema,
  rootPath: rootPathSchema,
};

export type AnnotationUpdateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationUpdateHandler(args: AnnotationUpdateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.content === undefined && args.tags === undefined && args.resolved === undefined) {
      throw new CLIError("At least one of content, tags, or resolved must be provided", ErrorCategory.USER);
    }

    const model = await loadModel(args.rootPath);
    const found = await findAnnotation(model, args.annotationId, args.changeset);
    const updated = found && (await found.store.update(args.annotationId, {
      content: args.content,
      tags: args.tags,
      resolved: args.resolved,
    }));

    if (!found || !updated) {
      throw new CLIError(`Annotation ${args.annotationId} not found`, ErrorCategory.NOT_FOUND, [
        NOT_FOUND_HINT,
      ]);
    }

    return jsonResult(annotationResult(updated, found));
  });
}

export const annotationUpdateTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_update",
  description: "Partially update an annotation's content, tags, or resolved state. An update to a staged annotation stays staged in its changeset.",
  inputSchema,
  handler: annotationUpdateHandler,
};
