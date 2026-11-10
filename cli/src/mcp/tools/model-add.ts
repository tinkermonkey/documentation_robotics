/**
 * model_add — add an element to a layer. Mirrors `dr add`, operating through
 * the shared MutationHandler so staging and base-model persistence stay
 * consistent with the CLI.
 *
 * It also takes a list (`elements`, with optional `relationships` between them and the model):
 * each item is validated on its own, and the valid ones are staged in one write. Invalid items
 * are skipped and reported.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { StagedChange } from "../../core/changeset.js";
import { ChangesetGraph } from "../../core/changeset-graph.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { countByStatus, planRelationshipBatch, type PendingElement } from "../../core/relationship-staging.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getNodeTypesForLayer, isValidNodeType, normalizeNodeType } from "../../generated/node-types.js";
import { generateElementId, generateUUID } from "../../utils/id-generator.js";
import { buildSourceReference, resolveSourceReferenceOptions } from "../../utils/source-reference.js";
import { schemaLookupHint } from "../../utils/error-hints.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { activeStagedChangeset } from "./changeset-shared.js";
import { applyRelationshipPlan, previewChangeset, relationshipItemSchema } from "./relationship-tools.js";

const provenanceSchema = z
  .enum(["extracted", "manual", "inferred", "generated"])
  .optional()
  .describe(
    "How the source reference was made. Defaults to 'manual' when sourceFile is sent alone. 'extracted' and " +
      "'manual' need a sourceFile (sent without one, it is ignored with a warning). For a planned element with no " +
      "code yet, send no source fields."
  );

const elementFields = {
  description: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().describe("Type-specific attributes, validated against the element's spec schema."),
  sourceFile: z.string().optional().describe("Source file path relative to the repository root."),
  sourceSymbol: z.string().optional(),
  sourceProvenance: provenanceSchema,
  sourceRepoRemote: z.string().optional(),
  sourceRepoCommit: z.string().optional().describe("Full 40-character Git commit SHA."),
};

const elementItemSchema = z.object({
  layer: z.string().describe("Canonical layer name."),
  type: z.string().describe("Element type within the layer."),
  name: z.string().describe("Human-readable element name; used to derive the element ID."),
  ...elementFields,
});

const inputSchema = {
  layer: z.string().optional().describe("Canonical layer name (e.g. 'api', 'data-model'). Single form."),
  type: z.string().optional().describe("Element type within the layer (e.g. 'operation', 'entity'). Single form."),
  name: z.string().optional().describe("Human-readable element name; used to derive the element ID. Single form."),
  ...elementFields,
  elements: z
    .array(elementItemSchema)
    .optional()
    .describe(
      "Batch form, instead of layer/type/name: a list of elements ({layer, type, name, description?, attributes?, " +
        "source fields?}), staged in one write. Each is validated on its own; an invalid one is skipped and reported."
    ),
  relationships: z
    .array(relationshipItemSchema)
    .optional()
    .describe(
      "Batch form only: relationships to stage in the same write, as relationship_add takes them. They may name " +
        "elements this call adds (by the id layer.type.kebab-name)."
    ),
  rootPath: rootPathSchema,
};

export type ModelAddArgs = z.infer<z.ZodObject<typeof inputSchema>>;

/** The single form's fields: refused beside `elements`, where they would otherwise be dropped. */
const SINGLE_FORM_FIELDS = [
  "layer",
  "type",
  "name",
  ...(Object.keys(elementFields) as Array<keyof typeof elementFields>),
] as const;
type ElementSpec = z.infer<typeof elementItemSchema>;

interface PreparedElement {
  element: Element;
  id: string;
  layer: string;
  type: string;
  warnings: string[];
}

/** Validates one element and builds it; throws a CLIError saying what is wrong. */
async function prepareElement(spec: ElementSpec): Promise<PreparedElement> {
  if (!isValidLayer(spec.layer)) {
    const validLayers = getAllLayerIds();
    const similar = findSimilar(spec.layer, validLayers, 3);
    const suggestions: string[] = [`Use a valid layer name: ${formatValidOptions(validLayers)}`];
    if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
    throw new CLIError(`Unknown layer "${spec.layer}"`, ErrorCategory.USER, suggestions);
  }

  if (!isValidNodeType(spec.layer, spec.type)) {
    const validNodeTypes = getNodeTypesForLayer(spec.layer);
    const typeNames = validNodeTypes.map((t) => t.type).sort();
    const similar = findSimilar(spec.type, typeNames, 3);
    const suggestions: string[] = [`Valid types for ${spec.layer}: ${formatValidOptions(typeNames)}`];
    if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
    throw new CLIError(`Invalid element type "${spec.type}" for layer "${spec.layer}"`, ErrorCategory.USER, suggestions);
  }

  const resolvedType = normalizeNodeType(spec.layer, spec.type);
  const elementPath = generateElementId(spec.layer, resolvedType, spec.name);

  const slugPart = elementPath.split(".")[2];
  if (!slugPart) {
    throw new CLIError(`Cannot generate a valid element ID from name "${spec.name}"`, ErrorCategory.USER, [
      "Element names must contain at least one letter or digit",
    ]);
  }

  const { options: sourceOptions, warnings } = resolveSourceReferenceOptions(spec, "mcp");

  const now = new Date().toISOString();
  const element = new Element({
    id: generateUUID(),
    path: elementPath,
    spec_node_id: `${spec.layer}.${resolvedType}`,
    layer_id: spec.layer,
    type: resolvedType,
    name: spec.name,
    description: spec.description,
    attributes: spec.attributes ?? {},
    metadata: {
      created_at: now,
      updated_at: now,
      version: 1,
    },
    layer: spec.layer,
  });

  const sourceRef = buildSourceReference(sourceOptions);
  if (sourceRef) {
    element.setSourceReference(sourceRef);
  }

  const schemaValidator = new SchemaValidator();
  const tempLayer = new Layer(spec.layer);
  tempLayer.addElement(element);
  const attrValidation = await schemaValidator.validateLayer(tempLayer);
  if (!attrValidation.isValid()) {
    const errorMessages = attrValidation.errors.map((e) => `  ${e.message}`).join("\n");
    throw new CLIError(`Element ${elementPath} has invalid attributes:\n${errorMessages}`, ErrorCategory.USER, [
      schemaLookupHint("mcp", spec.layer, resolvedType),
    ]);
  }

  return { element, id: elementPath, layer: spec.layer, type: resolvedType, warnings };
}

export async function modelAddHandler(args: ModelAddArgs): Promise<CallToolResult> {
  return runTool(async () => {
    if (args.elements !== undefined) {
      const singleFields = SINGLE_FORM_FIELDS.filter((field) => args[field] !== undefined);
      if (singleFields.length > 0) {
        throw new CLIError(
          `Send either a single element or elements, not both (got ${singleFields.join(", ")} beside elements)`,
          ErrorCategory.USER,
          ["Put those fields on the items of the elements list"]
        );
      }
      return jsonResult(await addElementBatch(args.elements, args.relationships ?? [], args.rootPath));
    }
    if (args.relationships !== undefined) {
      throw new CLIError("relationships goes with the elements list", ErrorCategory.USER, [
        "Send {elements: [...], relationships: [...]}, or use relationship_add for relationships alone",
      ]);
    }
    if (!args.layer || !args.type || !args.name) {
      throw new CLIError("model_add needs layer, type and name, or an elements list", ErrorCategory.USER, [
        'Single: {layer: "api", type: "operation", name: "Create Order"}',
        "Batch: {elements: [{layer, type, name}, ...], relationships: [{source, predicate, target}, ...]}",
      ]);
    }
    return addSingleElement({ ...args, layer: args.layer, type: args.type, name: args.name }, args.rootPath);
  });
}

async function addSingleElement(spec: ElementSpec, rootPath: string | undefined): Promise<CallToolResult> {
  const prepared = await prepareElement(spec);
  const { element, id: elementPath, layer } = prepared;

  const model = await loadModel(rootPath);

  // Inside a changeset getLayer() projects even a layer the model has no elements in, so ask the
  // model's layer list whether this layer is new to it.
  const layerKnown = model.getLayerNames().includes(layer);
  let layerObj = await model.getLayer(layer);
  let isNewLayer = false;
  if (!layerObj) {
    layerObj = new Layer(layer);
    isNewLayer = true;
  }

  if (layerObj.getElement(elementPath)) {
    throw new CLIError(`Element ${elementPath} already exists in ${layer} layer`, ErrorCategory.USER, [
      `Use "model_show" to view the existing element`,
      `Use "model_update" to modify it`,
      `Use "model_delete" to remove it first if you want to recreate it`,
    ]);
  }

  if (isNewLayer) {
    model.addLayer(layerObj);
  }

  const mutationHandler = new MutationHandler(model, elementPath, layer);
  await mutationHandler.executeAdd(element, (elem) => {
    layerObj!.addElement(elem);
  });

  const stagingManager = mutationHandler.getStagingManager();
  const activeChangeset = await stagingManager.getActive();
  const staged = !!(activeChangeset && activeChangeset.status === "staged");
  if (staged && !layerKnown) {
    // The cached model did not list this layer: reread it so every later tool call
    // (relationship_add, model_show, model_update, ...) sees the layer and the element.
    await reloadModel(rootPath);
  }

  return jsonResult({
    status: staged ? "staged" : "added",
    changeset: staged ? activeChangeset!.name : undefined,
    id: elementPath,
    layer,
    type: prepared.type,
    name: spec.name,
    ...(prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
  });
}

interface ElementBatchResult {
  index: number;
  id?: string;
  name: string;
  status: "staged" | "added" | "invalid";
  reason?: string;
  suggestions?: string[];
  warnings?: string[];
}

/**
 * model_add's batch form: validate every element and relationship, then stage the valid ones in
 * one write (or, with no active changeset, write them to the model).
 */
async function addElementBatch(
  specs: ElementSpec[],
  relationships: z.infer<typeof relationshipItemSchema>[],
  rootPath: string | undefined
) {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await activeStagedChangeset(manager);
  const changeset = active ?? previewChangeset();
  const graph = await ChangesetGraph.build(model, changeset);

  const prepared: PreparedElement[] = [];
  const pending = new Map<string, PendingElement>();
  const rejected = new Map<string, string>();
  const results: ElementBatchResult[] = [];

  for (const [index, spec] of specs.entries()) {
    const asSent = { index, name: spec.name };
    let item: PreparedElement;
    try {
      item = await prepareElement(spec);
    } catch (error) {
      const id = idFor(spec);
      if (id) rejected.set(id, getErrorMessage(error));
      results.push({
        ...asSent,
        ...(id ? { id } : {}),
        status: "invalid",
        reason: getErrorMessage(error),
        ...(error instanceof CLIError && error.suggestions?.length ? { suggestions: error.suggestions } : {}),
      });
      continue;
    }
    const existing = graph.getElement(item.id);
    if (existing && existing.status !== "deleted") {
      results.push({
        ...asSent,
        id: item.id,
        status: "invalid",
        reason: `Element ${item.id} already exists`,
        suggestions: ['Use "model_update" to change it'],
      });
      continue;
    }
    if (pending.has(item.id)) {
      results.push({ ...asSent, id: item.id, status: "invalid", reason: "Repeated earlier in this batch" });
      continue;
    }
    pending.set(item.id, { id: item.id, layer: item.layer, type: item.type });
    prepared.push(item);
    results.push({
      ...asSent,
      id: item.id,
      status: active ? "staged" : "added",
      ...(item.warnings.length > 0 ? { warnings: item.warnings } : {}),
    });
  }

  const plan = await planRelationshipBatch(graph, changeset, relationships, {
    pending,
    rejected,
    addStatus: active ? "staged" : "added",
  });

  if (active) {
    const elementChanges: Array<Omit<StagedChange, "sequenceNumber">> = prepared.map((p) => ({
      type: "add",
      elementId: p.id,
      layerName: p.layer,
      after: p.element.toJSON() as unknown as Record<string, unknown>,
    }));
    await applyRelationshipPlan(model, manager, active, plan, elementChanges);
  } else {
    for (const p of prepared) {
      await writeElement(model, p);
    }
    await applyRelationshipPlan(model, manager, null, plan, []);
  }
  if (prepared.length > 0 || plan.changes.length > 0 || plan.unstageKeys.length > 0) {
    await reloadModel(rootPath);
  }

  return {
    ...(active ? { changeset: active.name } : {}),
    elements: { counts: countByStatus(results), results },
    ...(relationships.length > 0
      ? { relationships: { counts: countByStatus(plan.results), results: plan.results } }
      : {}),
  };
}

/** Writes one element to the base model (no changeset is active). */
async function writeElement(model: Model, prepared: PreparedElement): Promise<void> {
  let layerObj = await model.getLayer(prepared.layer);
  if (!layerObj) {
    layerObj = new Layer(prepared.layer);
    model.addLayer(layerObj);
  }
  const target = layerObj;
  const handler = new MutationHandler(model, prepared.id, prepared.layer);
  await handler.executeAdd(prepared.element, (elem) => {
    target.addElement(elem);
  });
}

/** The id an element spec would get, when its layer and type are valid. */
function idFor(spec: ElementSpec): string | undefined {
  if (!isValidLayer(spec.layer) || !isValidNodeType(spec.layer, spec.type)) return undefined;
  const id = generateElementId(spec.layer, normalizeNodeType(spec.layer, spec.type), spec.name);
  return id.split(".")[2] ? id : undefined;
}

export const modelAddTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_add",
  description:
    "Add elements, validated against their spec schemas. Send one (layer/type/name) or many (elements: [...], " +
    "with optional relationships: [...] that may name the new elements); a list is staged in one write, so use it " +
    "when adding several. A list returns a result per element and per relationship: staged (added, with no " +
    "changeset active), restored or duplicate (relationships), or invalid with the reason. Invalid items are " +
    "skipped; the rest are still staged.",
  inputSchema,
  handler: modelAddHandler,
};
