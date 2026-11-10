/**
 * model_validate — run the 5-stage validation pipeline against the model.
 * Mirrors `dr validate`, reusing the shared Validator and ValidationFormatter.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Model } from "../../core/model.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions } from "../../utils/errors.js";
import { ValidationFormatter } from "../../validators/validation-formatter.js";
import { Validator } from "../../validators/validator.js";
import type { ValidationIssue } from "../../validators/types.js";
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

    // Ends outside a `layers` scope that exist nowhere in the full model (see danglingOutOfScopeEnds).
    let outOfScopeIssues: Array<Omit<ValidationIssue, "severity">> = [];

    // `loadModel()` returns the full cached model (all layers), so a `layers` scope
    // is applied here rather than at load time. Copies the layers Map onto a new
    // object instead of mutating `model.layers` directly, since that Map is the
    // shared cached instance other tool calls read from.
    if (args.layers && args.layers.length > 0) {
      const unknownLayers = args.layers.filter((name) => !isValidLayer(name));
      if (unknownLayers.length > 0) {
        const validLayers = getAllLayerIds();
        const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
        for (const unknown of unknownLayers) {
          const similar = findSimilar(unknown, validLayers, 3);
          if (similar.length > 0) suggestions.unshift(`Did you mean "${similar.join(" or ")}" instead of "${unknown}"?`);
        }
        throw new CLIError(`Unknown layer(s): ${unknownLayers.join(", ")}`, ErrorCategory.USER, suggestions);
      }

      const requestedLayers = new Set(args.layers);
      outOfScopeIssues = danglingOutOfScopeEnds(modelToValidate, requestedLayers);
      // Relationships stay whole, as in `dr validate --layers`, which loads only the requested
      // layers. `loadedLayerFilter` is what tells the validators that elements outside it were
      // left out on purpose: a relationship or reference whose other end lies outside the scope
      // is then skipped instead of reported as pointing at a missing element.
      modelToValidate = {
        ...modelToValidate,
        layers: new Map(
          Array.from(modelToValidate.layers.entries()).filter(([name]) => requestedLayers.has(name))
        ),
        loadedLayerFilter: [...requestedLayers],
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
    for (const issue of outOfScopeIssues) result.addError(issue);

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

/**
 * The relationships and references that leave a `layers` scope and point at an element that
 * exists nowhere in the model. The validators skip an end outside the scope (as `dr validate
 * --layers` does, having loaded only those layers); the MCP server holds the whole model, so it
 * can still tell a real dangling end from one that is merely out of scope. A relationship with
 * both ends outside the scope isn't looked at, as in the CLI.
 */
function danglingOutOfScopeEnds(model: Model, scope: Set<string>): Array<Omit<ValidationIssue, "severity">> {
  const known = new Set<string>();
  for (const layer of model.layers.values()) {
    for (const element of layer.listElements()) {
      known.add(element.id);
      if (element.path) known.add(element.path);
    }
  }
  const layerOf = (id: string) => id.split(".")[0] ?? "";
  const issues: Array<Omit<ValidationIssue, "severity">> = [];

  for (const rel of model.relationships.getAll()) {
    const sourceIn = scope.has(layerOf(rel.source));
    const targetIn = scope.has(layerOf(rel.target));
    if (sourceIn === targetIn) continue; // both in scope: the validators check it; neither: skipped
    const [end, role] = sourceIn ? [rel.target, "target"] : [rel.source, "source"];
    if (known.has(end)) continue;
    issues.push({
      layer: rel.layer || layerOf(rel.source),
      elementId: end,
      message: `[Relationship Schema]: Relationship ${role} element '${end}' not found (outside the validated layers, and not in the model)`,
      category: "reference",
    });
  }

  for (const [layerName, layer] of model.layers) {
    if (!scope.has(layerName)) continue;
    for (const element of layer.listElements()) {
      for (const ref of element.references ?? []) {
        const destination = ref.target;
        if (!destination || destination.startsWith("@") || scope.has(layerOf(destination)) || known.has(destination)) continue;
        issues.push({
          layer: layerName,
          elementId: element.path || element.id,
          message: `Broken reference: target '${destination}' does not exist (outside the validated layers, and not in the model)`,
          fixSuggestion: `Remove reference or create element '${destination}'`,
          category: "reference",
        });
      }
    }
  }
  return issues;
}

export const modelValidateTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_validate",
  description: "Run the full schema/naming/reference/semantic/relationship validation pipeline against the model.",
  inputSchema,
  handler: modelValidateHandler,
};
