/**
 * annotation_create — create a new annotation on a model element. Mirrors
 * `POST /api/annotations` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import {
  annotationAuthorSchema,
  annotationContentSchema,
  annotationTagsSchema,
  elementIdSchema,
} from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  elementId: elementIdSchema,
  content: annotationContentSchema,
  author: annotationAuthorSchema,
  tags: annotationTagsSchema,
  rootPath: rootPathSchema,
};

export type AnnotationCreateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationCreateHandler(args: AnnotationCreateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    const layerName = await findElementLayer(model, args.elementId);
    if (!layerName) {
      throw new CLIError(`Element ${args.elementId} not found`, ErrorCategory.NOT_FOUND, [
        'Use "model_search" to find similar elements',
      ]);
    }

    const store = new AnnotationStore(model.rootPath);
    const annotation = await store.create({
      elementId: args.elementId,
      content: args.content,
      author: args.author,
      tags: args.tags,
    });

    return jsonResult(annotation);
  });
}

export const annotationCreateTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_create",
  description: "Create a new annotation on a model element.",
  inputSchema,
  handler: annotationCreateHandler,
};
