/**
 * annotation_list — list annotations, optionally filtered to a single
 * element. Mirrors `GET /api/annotations` on the REST server.
 */

import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { elementIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  elementId: elementIdSchema.optional().describe("If provided, only return annotations on this element."),
  rootPath: rootPathSchema,
};

export type AnnotationListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function annotationListHandler(args: AnnotationListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const annotations = await store.list(args.elementId);
    return jsonResult({ annotations });
  });
}

export const annotationListTool: McpToolDefinition<typeof inputSchema> = {
  name: "annotation_list",
  description: "List annotations on model elements, optionally filtered to a single element.",
  inputSchema,
  handler: annotationListHandler,
};
