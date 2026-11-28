/**
 * annotation_list — list annotations, optionally filtered to a single
 * element. Mirrors `GET /api/annotations` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { annotationChangesetSchema, annotationResult, annotationWriteTarget, elementIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  elementId: elementIdSchema.optional().describe("If provided, only return annotations on this element."),
  changeset: annotationChangesetSchema,
  rootPath: rootPathSchema,
};

export type AnnotationListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationListHandler(args: AnnotationListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const annotations = await new AnnotationStore(model.rootPath).list(args.elementId);
    // The active (or named) changeset's staged annotations come with them, each marked as staged.
    const staged = await annotationWriteTarget(model, args.changeset, true);
    const stagedAnnotations = staged.changeset
      ? (await staged.store.list(args.elementId)).map((a) => annotationResult(a, staged))
      : [];
    return jsonResult({ annotations: [...annotations, ...stagedAnnotations] });
  });
}

export const annotationListTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_list",
  description:
    "List annotations on model elements, optionally filtered to a single element. The active (or named) changeset's staged annotations are listed with the base's, each marked `staged`.",
  inputSchema,
  handler: annotationListHandler,
};
