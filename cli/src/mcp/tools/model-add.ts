/**
 * model_add — add an element to a layer. Mirrors `dr add`, operating through
 * the shared MutationHandler so staging and base-model persistence stay
 * consistent with the CLI.
 *
 * It also takes a list (`elements`, with optional `relationships` between them and the model),
 * inline or in a JSON `file`: each item is validated on its own, and the valid ones are staged in
 * one write. Invalid items are skipped and reported. The result is the counts and the items that
 * need attention (batch-result.ts); `verbose` returns every item.
 */

import { z } from "zod";
import { BATCH_FILE_DESCRIPTION, readBatchFile } from "../batch-file.js";
import { strictItem } from "../strict-schema.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { StagedChange } from "../../core/changeset.js";
import { ChangesetGraph, type GraphElement } from "../../core/changeset-graph.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import type { Model } from "../../core/model.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import {
  planRelationshipBatch,
  type IdCollision,
  type PendingElement,
  type RejectedElement,
} from "../../core/relationship-staging.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { getAllLayerIds, isValidLayer } from "../../generated/layer-registry.js";
import { getNodeTypesForLayer, isValidNodeType, normalizeNodeType } from "../../generated/node-types.js";
import { requiredAttributesLine, requiredAttributesOf } from "../../utils/required-attributes.js";
import { compactId, deriveElementId, existingElementsIn, existingUnderEarlierId, generateUUID } from "../../utils/id-generator.js";
import { buildSourceReference, resolveSourceReferenceOptions } from "../../utils/source-reference.js";
import { schemaLookupHint } from "../../utils/error-hints.js";
import { SchemaValidator } from "../../validators/schema-validator.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions, getErrorMessage } from "../../utils/errors.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";
import { writeTargetChangeset } from "./changeset-shared.js";
import { applyRelationshipPlan, previewChangeset, relationshipBatchReport, relationshipItemSchema } from "./relationship-tools.js";
import { BATCH_RESULT_LINE_WIDTH, batchReport, limitSchema, verboseSchema, type BatchItemResult } from "./batch-result.js";

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

const NAME_DESCRIPTION =
  "Human-readable element name; used to derive the element ID layer.type.kebab-name, split at camelCase, spaces, " +
  "underscores, dots and slashes, and after a digit that a capitalised word follows ('GraphLayoutSnapshot' → " +
  "graph-layout-snapshot, 'Tier1Status' → tier1-status, 'Node.js' → node-js, 'GET /' → get-root). A name that " +
  "starts with a digit gets the prefix n- ('3D Effect' → n-3d-effect). A run of capitals ends before its last capital " +
  "when a lowercase letter follows ('HTTPServer' → http-server), and a plural acronym stays whole ('URLs' → urls).";

const elementItemSchema = strictItem("An elements[] item", {
  layer: z.string().describe("Canonical layer name."),
  type: z.string().describe("Element type within the layer."),
  name: z.string().describe(NAME_DESCRIPTION),
  ...elementFields,
});

const elementsSchema = z.array(elementItemSchema);
const relationshipsSchema = z.array(relationshipItemSchema);

const inputSchema = {
  layer: z.string().optional().describe("Canonical layer name (e.g. 'api', 'data-model'). Single form."),
  type: z.string().optional().describe("Element type within the layer (e.g. 'operation', 'entity'). Single form."),
  name: z.string().optional().describe(`${NAME_DESCRIPTION} Single form.`),
  ...elementFields,
  elements: elementsSchema
    .optional()
    .describe(
      "Batch form, instead of layer/type/name: a list of elements ({layer, type, name, description?, attributes?, " +
        "source fields?}), staged in one write. Each is validated on its own; an invalid one is skipped and reported."
    ),
  relationships: relationshipsSchema
    .optional()
    .describe(
      "Batch form only: relationships to stage in the same write, as relationship_add takes them. They name an " +
        "element by its id (layer.type.kebab-name), by that id without its hyphens, or by its name, whether this " +
        "call adds it, an earlier call staged it, or the model has it. A reference that is not an exact id and " +
        "matches more than one element is reported, not guessed. When two names give one id, the second " +
        "element is refused, and a relationship naming that id or the refused name is reported, not linked " +
        "to the first."
    ),
  file: z
    .string()
    .optional()
    .describe(`${BATCH_FILE_DESCRIPTION} The file is one JSON object: {"elements": [...], "relationships": [...]}.`),
  verbose: verboseSchema,
  limit: limitSchema,
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
  /** What deriving the id did that the name does not make obvious. */
  notes: string[];
}

/** An element refused for its attributes: the batch lists what its type requires, once per type. */
class AttributeRefusal extends CLIError {
  constructor(
    message: string,
    suggestions: string[],
    readonly specNodeId: string
  ) {
    super(message, ErrorCategory.USER, suggestions);
  }
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
  const derived = deriveElementId(spec.layer, resolvedType, spec.name);
  const elementPath = derived.id;

  if (!derived.slug) {
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
    // Say "attributes" only when that is where the schema failed: an id the schema refuses is a
    // problem with the name, and reads like a bad attributes payload otherwise (#1212).
    const inAttributes = attrValidation.errors.some((e) => (e.location ?? "").startsWith("/attributes"));
    if (inAttributes) {
      throw new AttributeRefusal(
        `Element ${elementPath} has invalid attributes:\n${errorMessages}`,
        // The single form adds what the type requires (addSingleElement); a batch lists it once
        // per type in requiredAttributes, not on every refused item.
        [schemaLookupHint("mcp", spec.layer, resolvedType)],
        `${spec.layer}.${resolvedType}`
      );
    }
    const idRefused = attrValidation.errors.some((e) => e.location === "/path");
    throw new CLIError(
      idRefused
        ? `The name "${spec.name}" gives the id ${elementPath}, which is not a valid element id:\n${errorMessages}`
        : `Element ${elementPath} is not valid:\n${errorMessages}`,
      ErrorCategory.USER,
      [
        idRefused
          ? "An id is lowercase letters, digits and hyphens, and each part starts with a letter: change the name so its id does"
          : schemaLookupHint("mcp", spec.layer, resolvedType),
      ]
    );
  }

  return { element, id: elementPath, layer: spec.layer, type: resolvedType, warnings, notes: derived.notes };
}

export async function modelAddHandler(args: ModelAddArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    if (args.elements !== undefined || args.file !== undefined) {
      const list = args.elements !== undefined ? "elements" : "file";
      const singleFields = SINGLE_FORM_FIELDS.filter((field) => args[field] !== undefined);
      if (singleFields.length > 0) {
        throw new CLIError(
          `Send either a single element or ${list}, not both (got ${singleFields.join(", ")} beside ${list})`,
          ErrorCategory.USER,
          ["Put those fields on the items of the elements list"]
        );
      }
      if (args.file === undefined) {
        return jsonResult(await addElementBatch(args.elements!, args.relationships ?? [], args.rootPath, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
      }
      const inline = (["elements", "relationships"] as const).filter((field) => args[field] !== undefined);
      if (inline.length > 0) {
        throw new CLIError(`Send either file or ${inline.join(" and ")}, not both`, ErrorCategory.USER, [
          "Put every element and relationship in the file, or send them all inline",
        ]);
      }
      const model = await loadModel(args.rootPath);
      const batch = await readBatchFile("model_add", args.file, model.rootPath, {
        elements: elementsSchema,
        relationships: relationshipsSchema,
      });
      return jsonResult(await addElementBatch(batch.elements ?? [], batch.relationships ?? [], args.rootPath, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
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
  }));
}

async function addSingleElement(spec: ElementSpec, rootPath: string | undefined): Promise<CallToolResult> {
  let prepared: PreparedElement;
  try {
    prepared = await prepareElement(spec);
  } catch (error) {
    // What the type requires and what each takes, so one retry fixes it (#1153).
    const required = error instanceof AttributeRefusal ? requiredAttributesLine(error.specNodeId) : undefined;
    if (required && error instanceof CLIError) throw new CLIError(error.message, ErrorCategory.USER, [required, ...(error.suggestions ?? [])]);
    throw error;
  }
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

  const taken = layerObj.getElement(elementPath);
  if (taken) {
    throw new CLIError(`Element ${elementPath} already exists in ${layer} layer${otherNameNote(taken.name, spec.name)}`, ErrorCategory.USER, [
      `Use "model_show" to view the existing element`,
      `Use "model_update" to modify it`,
      `Use "model_delete" to remove it first if you want to recreate it`,
    ]);
  }

  const near = existingUnderEarlierId(
    layer,
    prepared.type,
    spec.name,
    elementPath,
    existingElementsIn(layerObj.listElements().map((e) => ({ id: e.path || e.id, name: e.name })))
  );
  if (near.existing) {
    throw new CLIError(...alreadyExistsUnderEarlierId(near.existing, elementPath, near.existingName));
  }
  const warnings = [...prepared.warnings, ...(near.warning ? [near.warning] : [])];

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
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(prepared.notes.length > 0 ? { notes: prepared.notes } : {}),
  });
}

/**
 * What to add to "already exists" when the element there has another name: two names can give
 * one id ("N 3D Object Effect" and "3D Object Effect"), and the id alone does not show it.
 */
function otherNameNote(existingName: string | undefined, sentName: string): string {
  return existingName !== undefined && existingName !== sentName
    ? `, named "${existingName}": "${sentName}" gives the same id, so give the new element a name that differs in its letters or digits`
    : "";
}

/** The refusal for a name whose element exists under an id an earlier derivation gave it. */
function alreadyExistsUnderEarlierId(
  existingId: string,
  derivedId: string,
  existingName?: string
): [string, ErrorCategory, string[]] {
  return [
    existingName === undefined
      ? `Element ${existingId} already exists with this name (the name gives ${derivedId} today; the element keeps its id)`
      : `Element ${existingId} already exists, named "${existingName}": that name and this one gave one id when it was ` +
        `made (this one gives ${derivedId} today; the element keeps its id)`,
    ErrorCategory.USER,
    [`Use "model_update" with id ${existingId} to change it`, `Name the element ${existingId} in relationships`],
  ];
}

interface ElementBatchResult extends BatchItemResult {
  id?: string;
  name: string;
  status: "staged" | "added" | "invalid";
}

/**
 * model_add's batch form: validate every element and relationship, then stage the valid ones in
 * one write (or, with no active changeset, write them to the model).
 */
async function addElementBatch(
  specs: ElementSpec[],
  relationships: z.infer<typeof relationshipItemSchema>[],
  rootPath: string | undefined,
  report: { verbose?: boolean; limit?: number } = {}
) {
  const model = await loadModel(rootPath);
  const manager = new StagingAreaManager(model.rootPath, model);
  const active = await writeTargetChangeset(manager);
  const changeset = active ?? previewChangeset();
  const graph = await ChangesetGraph.build(model, changeset);

  const prepared: PreparedElement[] = [];
  const pending = new Map<string, PendingElement>();
  /** Where each pending element sits in the request, to name it when a later name gives its id. */
  const pendingAt = new Map<string, number>();
  const rejected = new Map<string, RejectedElement>();
  const results: ElementBatchResult[] = [];
  /** Types an element was refused for its attributes in, with what each requires. */
  const requiredAttributes: Record<string, Record<string, string>> = {};
  /**
   * Refused elements and the ids their names gave, with the id of the element that holds them: a
   * name refused because another one gives its id leaves that id contested for relationships (#1297).
   */
  const refusedIds: Array<{ name: string; ids: string[]; holder: string }> = [];

  // What is already there, for a name whose element exists under an id an earlier rule gave it:
  // the projection's live elements, and the ones this call has accepted so far.
  const byCompactId = new Map<string, Array<{ id: string; name?: string }>>();
  const indexCompact = (e: { id: string; name?: string }) => {
    const key = compactId(e.id);
    if (key) byCompactId.set(key, [...(byCompactId.get(key) ?? []), e]);
  };
  for (const e of graph.elements.values() as Iterable<GraphElement>) {
    if (e.status !== "deleted") indexCompact({ id: e.id, name: e.name });
  }
  const alreadyThere = {
    byId: (id: string) => {
      const live = graph.getElement(id);
      return live && live.status !== "deleted" ? { id: live.id, name: live.name } : pending.get(id);
    },
    byCompactId: (key: string) => byCompactId.get(key) ?? [],
  };

  for (const [index, spec] of specs.entries()) {
    const asSent = { index, name: spec.name };
    let item: PreparedElement;
    try {
      item = await prepareElement(spec);
    } catch (error) {
      const id = idFor(spec);
      const reason = getErrorMessage(error);
      if (error instanceof AttributeRefusal && !(error.specNodeId in requiredAttributes)) {
        const required = requiredAttributesOf(error.specNodeId);
        if (required) requiredAttributes[error.specNodeId] = required;
      }
      // Kept with the name, layer and type it was sent as, so a reference by its name or its
      // unhyphenated id still finds the refusal instead of linking past it.
      if (id) {
        rejected.set(id, { reason, name: spec.name, layer: spec.layer, type: id.split(".")[1] });
        refusedIds.push({ name: spec.name, ids: [id], holder: id });
        // An element of another name may hold the id an earlier rule gave this name: a link by
        // that id could mean the refused element too.
        const near = existingUnderEarlierId(spec.layer, id.split(".")[1], spec.name, id, alreadyThere);
        if (near.existing) refusedIds.push({ name: spec.name, ids: [near.existing, id], holder: near.existing });
      }
      results.push({
        ...asSent,
        ...(id ? { id } : {}),
        status: "invalid",
        reason,
        ...(error instanceof CLIError && error.suggestions?.length ? { suggestions: error.suggestions } : {}),
      });
      continue;
    }
    const existing = graph.getElement(item.id);
    if (existing && existing.status !== "deleted") {
      refusedIds.push({ name: spec.name, ids: [item.id], holder: item.id });
      results.push({
        ...asSent,
        id: item.id,
        status: "invalid",
        reason: `Element ${item.id} already exists${otherNameNote(existing.name, spec.name)}`,
        suggestions: ['Use "model_update" to change it'],
      });
      continue;
    }
    const twin = pending.get(item.id);
    if (twin) {
      // Two names, one id ("GET /x" and "GET /x*"): say which name it collided with, since the
      // ids alone do not show it.
      const at = `elements[${pendingAt.get(item.id)}]`;
      refusedIds.push({ name: spec.name, ids: [item.id], holder: item.id });
      results.push({
        ...asSent,
        id: item.id,
        status: "invalid",
        reason:
          twin.name === spec.name
            ? `Repeated earlier in this batch (${at})`
            : `"${spec.name}" gives the same id as ${at} "${twin.name}" (${item.id}): an id comes from the name alone`,
        ...(twin.name === spec.name ? {} : { suggestions: ["Give one of the two a name that differs in its letters or digits"] }),
      });
      continue;
    }
    const near = existingUnderEarlierId(item.layer, item.type, spec.name, item.id, alreadyThere);
    if (near.existing) {
      const [reason, , suggestions] = alreadyExistsUnderEarlierId(near.existing, item.id, near.existingName);
      refusedIds.push({ name: spec.name, ids: [near.existing, item.id], holder: near.existing });
      results.push({ ...asSent, id: near.existing, status: "invalid", reason, suggestions });
      continue;
    }
    const warnings = [...item.warnings, ...(near.warning ? [near.warning] : [])];
    pending.set(item.id, { id: item.id, layer: item.layer, type: item.type, name: spec.name });
    pendingAt.set(item.id, index);
    indexCompact({ id: item.id, name: spec.name });
    prepared.push(item);
    results.push({
      ...asSent,
      id: item.id,
      status: active ? "staged" : "added",
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(item.notes.length > 0 ? { notes: item.notes } : {}),
    });
  }

  const plan = await planRelationshipBatch(graph, changeset, relationships, {
    pending,
    rejected,
    collisions: idCollisions(refusedIds, graph, pending, pendingAt),
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

  const written = ["staged", "added"] as const;
  return {
    ...(active ? { changeset: active.name } : {}),
    elements: {
      ...batchReport(results, { ...report, written }),
      ...(Object.keys(requiredAttributes).length > 0 ? { requiredAttributes } : {}),
    },
    ...(relationships.length > 0 ? { relationships: relationshipBatchReport(plan.results, report) } : {}),
  };
}

/**
 * The ids a refused name shares with an element of another name, the one kept: in this call, or in
 * the projection. A refused name the element itself carries (sent twice, or already in the model)
 * contests nothing, and a relationship by its id still binds to it.
 */
function idCollisions(
  refusedIds: Array<{ name: string; ids: string[]; holder: string }>,
  graph: ChangesetGraph,
  pending: Map<string, PendingElement>,
  pendingAt: Map<string, number>
): IdCollision[] {
  const collisions = new Map<string, IdCollision>();
  for (const refused of refusedIds) {
    const inCall = pending.get(refused.holder);
    const live = graph.getElement(refused.holder);
    const kept = inCall
      ? { name: inCall.name, where: `elements[${pendingAt.get(refused.holder)}], which this call adds` }
      : live && live.status !== "deleted"
        ? { name: live.name, where: live.status === "added" && !live.alreadyInBase ? "which this changeset adds" : "which the model has" }
        : undefined;
    // An element with no name is refused as plain "already exists" (otherNameNote): no clash.
    if (!kept || kept.name === undefined || kept.name === refused.name) continue;
    for (const id of refused.ids) {
      // An id the name gives today, held under the id an earlier rule gave: say which id holds it.
      const where = refused.holder === id ? kept.where : `as ${refused.holder}, ${kept.where}`;
      collisions.set(`${id}\u0000${refused.name}`, { id, kept: { name: kept.name, where }, refusedName: refused.name });
    }
  }
  return [...collisions.values()];
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
  const derived = deriveElementId(spec.layer, normalizeNodeType(spec.layer, spec.type), spec.name);
  return derived.slug ? derived.id : undefined;
}

export const modelAddTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_add",
  description:
    "Add elements, validated against their spec schemas. Most types have required attributes: spec_type lists " +
    "them with their allowed values, and a refused batch lists them per type (requiredAttributes). Send one " +
    "(layer/type/name) or many (elements: [...], with optional relationships: [...]); a list is staged in one " +
    "write, so use it when adding several, and put a large one in a JSON file (file) instead of the call. An " +
    "element's id is layer.type.kebab-name, with the name split at camelCase and after a digit that a capitalised " +
    "word follows ('GraphLayoutSnapshot' → graph-layout-snapshot, 'Tier1Status' → tier1-status), and before the last " +
    "capital of a run that a lowercase letter follows ('HTTPServer' → http-server; a plural acronym such as 'URLs' stays whole); the same name " +
    "gives the same id in codebase_extract. A relationship may name an element by its id, by that id without " +
    "hyphens or by its name, when exactly one element matches; relationships.readByName says how each such " +
    "reference was read. A list returns, for elements and for relationships, counts by status (staged, or " +
    "added with no changeset active; restored or duplicate for relationships; invalid) and attention: only the " +
    "items that are invalid, duplicate or restored, or elements that carry a warning or a note (an id the name " +
    "does not make obvious). " +
    "attention holds up to limit items in full (default 50), the ones not written first; past that every remaining item is still listed by position under its reason (attentionNotListed), so nothing is left out. " +
    "verbose: true returns every item as results. A name longer than 100 characters as an id is cut with a hash, " +
    "and the item says so. Invalid items are skipped; the rest are still staged.",
  inputSchema,
  handler: modelAddHandler,
};
