/**
 * annotation_list — list annotations, optionally filtered to a single
 * element. Mirrors `GET /api/annotations` on the REST server.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationStore } from "../../core/annotation-store.js";
import { elementIdSchema } from "./annotation-shared.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface AnnotationListArgs {
  elementId?: string;
  rootPath?: string;
}

const inputSchema = {
  elementId: elementIdSchema.optional().describe("If provided, only return annotations on this element."),
  rootPath: rootPathSchema,
};

export async function annotationListHandler(args: AnnotationListArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const store = new AnnotationStore(model.rootPath);
    const annotations = await store.list(args.elementId);
    return jsonResult({ annotations });
  });
}

export const annotationListTool: McpToolDefinition<AnnotationListArgs> = {
  name: "annotation_list",
  description: "List annotations on model elements, optionally filtered to a single element.",
  inputSchema,
  handler: annotationListHandler,
};
