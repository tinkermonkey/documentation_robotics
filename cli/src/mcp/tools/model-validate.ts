/**
 * model_validate — run the 5-stage validation pipeline against the model.
 * Mirrors `dr validate`, reusing the shared Validator and ValidationFormatter.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { ValidationFormatter } from "../../validators/validation-formatter.js";
import { Validator } from "../../validators/validator.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

const inputSchema = {
  layers: z.array(z.string()).optional().describe("Restrict validation to these layers. Omit to validate the whole model."),
  strict: z.boolean().optional().describe("Also flag elements with no description as warnings."),
  orphans: z
    .boolean()
    .optional()
    .describe("Return only the orphaned-elements report instead of running full validation."),
  rootPath: rootPathSchema,
};

export type ModelValidateArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function modelValidateHandler(args: ModelValidateArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);

    // `Validator` is typed to accept `Model`, but a projected changeset is a
    // `ProjectedModel` (manifest/layers/relationships only, no `rootPath` or the
    // mutation methods `Model` exposes). The validation pipeline only reads
    // `rootPath` for telemetry (validator.ts), so it's carried over explicitly
    // rather than left undefined. This mirrors the identical cast in
    // `cli/src/commands/validate.ts`; a proper fix would give `Validator` a
    // narrower "validatable model" interface shared by both types.
    const activeChangesetId = model.getActiveChangesetId();
    let modelToValidate = (
      activeChangesetId
        ? { ...(await model.getVirtualProjectionEngine().projectModel(model, activeChangesetId)), rootPath: model.rootPath }
        : model
    ) as unknown as Model;

    // `loadModel()` returns the full cached model (all layers), so a `layers` scope
    // is applied here rather than at load time. Copies the layers Map onto a new
    // object instead of mutating `model.layers` directly, since that Map is the
    // shared cached instance other tool calls read from.
    if (args.layers && args.layers.length > 0) {
      const requestedLayers = new Set(args.layers);
      modelToValidate = {
        ...modelToValidate,
        layers: new Map(
          Array.from(modelToValidate.layers.entries()).filter(([name]) => requestedLayers.has(name))
        ),
      } as unknown as Model;
    }

    if (args.orphans) {
      const stats = ValidationFormatter.calculateStats(modelToValidate);
      return jsonResult({
        orphanCount: stats.orphanedElements.length,
        orphanedElements: stats.orphanedElements,
      });
    }

    const validator = new Validator();
    const result = await validator.validateModel(modelToValidate);

    const stats = ValidationFormatter.calculateStats(modelToValidate);
    for (const orphanId of stats.orphanedElements) {
      result.addWarning({
        message: `Element '${orphanId}' is orphaned (no cross-layer references or intra-layer relationships)`,
        layer: orphanId.split(".")[0] ?? "",
        elementId: orphanId,
        category: "orphan",
        fixSuggestion: "Add cross-layer references or relationships to connect this element to the rest of the model",
      });
    }

    for (const [layerName, layer] of modelToValidate.layers) {
      for (const element of layer.listElements()) {
        const elementId = element.path || element.id;
        if (!element.source_reference) {
          result.addWarning({
            message: `Element '${elementId}' has no source reference`,
            layer: layerName,
            elementId,
            fixSuggestion: "Add a source_reference with provenance to link this element to its implementation",
          });
        }
        if (args.strict && (!element.description || element.description.trim() === "")) {
          result.addWarning({
            message: `Element '${elementId}' has no description`,
            layer: layerName,
            elementId,
            fixSuggestion: "Add a description to document what this element represents",
          });
        }
      }
    }

    const formatted = ValidationFormatter.toJSON(result, modelToValidate);
    const valid = result.isValid() && !(args.strict && result.warnings.length > 0);

    return jsonResult({ ...formatted, valid });
  });
}

export const modelValidateTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_validate",
  description: "Run the full schema/naming/reference/semantic/relationship validation pipeline against the model.",
  inputSchema,
  handler: modelValidateHandler,
};
