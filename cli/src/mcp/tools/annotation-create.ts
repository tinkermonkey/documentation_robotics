/**
 * annotation_create — create a new annotation on a model element. Mirrors
 * `POST /api/annotations` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { findElementLayer } from "../../utils/element-utils.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import {
  annotationAuthorSchema,
  annotationChangesetSchema,
  annotationResult,
  annotationWriteTarget,
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
  changeset: annotationChangesetSchema,
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

    const home = await annotationWriteTarget(model, args.changeset);
    const annotation = await home.store.create({
      elementId: args.elementId,
      content: args.content,
      author: args.author,
      tags: args.tags,
    });

    return jsonResult(annotationResult(annotation, home));
  });
}

export const annotationCreateTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_create",
  description:
    "Create a new annotation on a model element. While a changeset is active (or with `changeset`), the annotation is " +
    "staged in it: changeset_brief and the landing summary list it, it lands when the plan lands and is discarded with " +
    "it, and replies and updates to it stay staged. With no changeset it is written to the base model at once.",
  inputSchema,
  handler: annotationCreateHandler,
};
