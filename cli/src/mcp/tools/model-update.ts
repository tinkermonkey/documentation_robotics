/**
 * model_update — update an existing element. Mirrors `dr update`, operating
 * through the shared MutationHandler.
 *
 * It also takes a list (`updates`, or a `file` holding one): each item is an update in the single
 * form's own fields, applied in order. An invalid item is skipped and reported; the rest are
 * still applied.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BATCH_FILE_DESCRIPTION, readBatchFile } from "../batch-file.js";
import { strictItem } from "../strict-schema.js";
import type { Model } from "../../core/model.js";
import { Element } from "../../core/element.js";
import { Layer } from "../../core/layer.js";
import { MutationHandler } from "../../core/mutation-handler.js";
import { setStagedSourceReference } from "../../core/staged-source-reference.js";
import { getNodeTypesForLayer, isValidNodeType, normalizeNodeType } from "../../generated/node-types.js";
import { findElementLayer } from "../../utils/element-utils.js";
import {
  buildSourceReference,
  precheckUpdateSourceReferenceOptions,
  resolveSourceReferenceOptions,
  settleSourceLocationChange,
  type SourceReferenceOptions,
} from "../../utils/source-reference.js";
import { stableJson } from "../../core/relationship-staging.js";
import type { SourceReference } from "../../types/index.js";
import { schemaLookupHint, undefinedTypeWarning } from "../../utils/error-hints.js";
import { SchemaValidator, suggestNodeTypes } from "../../validators/schema-validator.js";
import { CLIError, ErrorCategory, findSimilar, formatValidOptions, getErrorMessage } from "../../utils/errors.js";
import { effectiveAttributePatch, resolveAttributeUpdate } from "../../utils/attribute-patch.js";
import { jsonResult, loadModel, reloadModel, rootPathSchema, runTool, withProjectWriteLock, type McpToolDefinition } from "./shared.js";
import {
  BATCH_RESULT_DESCRIPTION,
  BATCH_RESULT_LINE_WIDTH,
  batchReport,
  limitSchema,
  verboseSchema,
  type BatchItemResult,
} from "./batch-result.js";

const sourceLocationSchema = z
  .object({
    file: z.string().min(1).describe("Source file path relative to the repository root."),
    symbol: z.string().min(1).optional(),
  })
  .strict()
  .optional();

/** What an update may change: the single form's fields, and each `updates[]` item's beside its id. */
const updateFields = {
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional().describe("New element type within the current layer."),
  attributes: z.record(z.string(), z.unknown()).optional().describe("Replaces the element's attributes, validated against its spec schema."),
  attributePatch: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Merged into the element's current attributes (as the active changeset leaves them), so required attributes " +
        "need not be repeated; a null value removes that key. The merged result is validated against the spec " +
        "schema. Cannot be combined with attributes."
    ),
  sourceFile: z
    .string()
    .optional()
    .describe(
      "Replaces the element's source locations with this one file (and sourceSymbol with it). To add a location " +
        "beside the ones the element has, use addSourceLocation; to remove one, removeSourceLocation. Sent without " +
        "sourceProvenance, a file the element doesn't reference yet is set by hand, so it gets 'manual'; a file it " +
        "already references keeps the element's provenance."
    ),
  sourceSymbol: z
    .string()
    .optional()
    .describe(
      "Sent without sourceFile, goes on the element's source file and keeps its provenance: on its one location " +
        "when that has no symbol, else added beside the symbols the file already has (never twice). An element " +
        "with no source file, or several, needs sourceFile with it, or addSourceLocation."
    ),
  sourceProvenance: z
    .enum(["extracted", "manual", "inferred", "generated"])
    .optional()
    .describe(
      "Sent alone, changes the provenance and keeps the element's file. A sourceFile sent alone keeps the current " +
        "provenance when the element already references that file, else gets 'manual'. 'extracted' and 'manual' " +
        "need a file (on the element or sent): without one they are ignored with a warning. With addSourceLocation or " +
        "removeSourceLocation, sets the reference's provenance."
    ),
  sourceRepoRemote: z.string().optional(),
  sourceRepoCommit: z.string().optional().describe("Full 40-character Git commit SHA."),
  clearSourceReference: z.boolean().optional().describe("Remove the element's source reference. Cannot be combined with other source options."),
  addSourceLocation: sourceLocationSchema.describe(
    "Add one source location beside the element's others: {file, symbol?}. It goes on a location of that file " +
      "with no symbol, else it is appended (never twice). Keeps the reference's provenance and repository unless " +
      "sourceProvenance or the repository fields are sent; an element with no reference gets 'manual'."
  ),
  removeSourceLocation: sourceLocationSchema.describe(
    "Remove source locations: {file} every location in that file, {file, symbol} that one. Refused when none " +
      "matches. Removing the last location of an 'extracted' or 'manual' reference removes the reference. Applied " +
      "before addSourceLocation, so the two move a location."
  ),
};

const updateItemSchema = strictItem("An updates[] item", {
  id: z.string().describe("Element ID or path to update."),
  ...updateFields,
});

const updatesSchema = z.array(updateItemSchema);

const inputSchema = {
  id: z.string().optional().describe("Element ID or path to update. Single form."),
  ...updateFields,
  updates: updatesSchema
    .optional()
    .describe(
      "Batch form, instead of id and its fields: a list of updates ({id, name?, description?, type?, attributes?, " +
        "attributePatch?, source fields?}), applied in order. Each is validated on its own; an invalid one is " +
        "skipped and reported, the rest are still applied."
    ),
  file: z.string().optional().describe(`${BATCH_FILE_DESCRIPTION} The file is one JSON object: {"updates": [...]}.`),
  verbose: verboseSchema,
  limit: limitSchema,
  rootPath: rootPathSchema,
};

export type ModelUpdateArgs = z.infer<z.ZodObject<typeof inputSchema>>;
type UpdateSpec = z.infer<typeof updateItemSchema>;

/** The single form's fields: refused beside `updates` or `file`, where they would otherwise be dropped. */
const SINGLE_FORM_FIELDS = ["id", ...(Object.keys(updateFields) as Array<keyof typeof updateFields>)] as const;

function validateUpdateSourceReferenceOptions(args: UpdateSpec): void {
  const hasSourceOptions =
    args.sourceFile || args.sourceSymbol || args.sourceProvenance || args.sourceRepoRemote || args.sourceRepoCommit;

  if (args.clearSourceReference && hasSourceOptions) {
    throw new CLIError("Cannot use clearSourceReference with other source reference options", ErrorCategory.USER, [
      "Specify either clearSourceReference or other source options, not both",
    ]);
  }

  if (args.addSourceLocation || args.removeSourceLocation) {
    const conflicting = (["sourceFile", "sourceSymbol", "clearSourceReference"] as const).filter(
      (field) => args[field] !== undefined
    );
    if (conflicting.length > 0) {
      const verb = conflicting.length === 1 ? "replaces" : "replace";
      throw new CLIError(
        `addSourceLocation and removeSourceLocation change one location; ${conflicting.join(" and ")} ${verb} them all`,
        ErrorCategory.USER,
        [
          "Send one or the other: sourceFile (with sourceSymbol) to replace the locations, or the location fields " +
            "to add or remove one",
        ]
      );
    }
    // Provenance and repository go with the location change; they are checked there.
    return;
  }

  if (hasSourceOptions) {
    // Refuse what cannot be settled before touching the model; the partial forms are settled
    // against the element's current reference once it is loaded.
    precheckUpdateSourceReferenceOptions(args, "mcp");
  }
}

export async function modelUpdateHandler(args: ModelUpdateArgs): Promise<CallToolResult> {
  return runTool(() => withProjectWriteLock(args.rootPath, async () => {
    if (args.updates !== undefined || args.file !== undefined) {
      const singleFields = SINGLE_FORM_FIELDS.filter((field) => args[field] !== undefined);
      if (singleFields.length > 0) {
        const list = args.updates !== undefined ? "updates" : "file";
        throw new CLIError(
          `Send either a single update or ${list}, not both (got ${singleFields.join(", ")} beside ${list})`,
          ErrorCategory.USER,
          ["Put those fields on the items of the updates list"]
        );
      }
      if (args.updates !== undefined && args.file !== undefined) {
        throw new CLIError("Send either file or updates, not both", ErrorCategory.USER, [
          "Put every update in the file, or send them all inline",
        ]);
      }
      const model = await loadModel(args.rootPath);
      const updates =
        args.updates ?? (await readBatchFile("model_update", args.file!, model.rootPath, { updates: updatesSchema })).updates ?? [];
      return jsonResult(await updateElementBatch(model, updates, args), { compact: true, lineWidth: BATCH_RESULT_LINE_WIDTH });
    }
    if (!args.id) {
      throw new CLIError("model_update needs id, or an updates list", ErrorCategory.USER, [
        'Single: {id: "api.operation.create-order", description: "..."}',
        "Batch: {updates: [{id, description?, attributePatch?, ...}, ...]}",
      ]);
    }
    const model = await loadModel(args.rootPath);
    const outcome = await updateElement(model, { ...args, id: args.id });
    // The update mutated the cached (projected) element in place; reread so the next call projects
    // from what is on disk, staged or written.
    if (outcome.status !== "no-op" && outcome.status !== "unchanged") await reloadModel(args.rootPath);
    return jsonResult(outcome);
  }));
}

/** What one update did, as the single form returns it. */
export interface UpdateOutcome {
  /** unchanged: the element is already as sent (a list sent again, #1296); nothing written. */
  status: "staged" | "updated" | "no-op" | "unchanged";
  changeset?: string;
  id: string;
  layer?: string;
  message?: string;
  changedFields?: string[];
  foldedIntoAdd?: true;
  warnings?: string[];
}

type UpdateBatchResult = BatchItemResult & { id: string; changedFields?: string[]; foldedIntoAdd?: true };

/**
 * model_update's batch form: apply each update in order, skipping the ones that are refused. The
 * cached model is reread once, after the last one.
 */
async function updateElementBatch(model: Model, updates: UpdateSpec[], args: ModelUpdateArgs) {
  const results: UpdateBatchResult[] = [];
  let changeset: string | undefined;
  let wrote = false;
  for (const [index, spec] of updates.entries()) {
    try {
      const outcome = await updateElement(model, spec);
      changeset ??= outcome.changeset;
      if (outcome.status !== "no-op" && outcome.status !== "unchanged") wrote = true;
      results.push({
        index,
        id: outcome.id,
        status: outcome.status,
        ...(outcome.message ? { reason: outcome.message } : {}),
        ...(outcome.changedFields ? { changedFields: outcome.changedFields } : {}),
        ...(outcome.foldedIntoAdd ? { foldedIntoAdd: true as const } : {}),
        ...(outcome.warnings?.length ? { warnings: outcome.warnings } : {}),
      });
    } catch (error) {
      results.push({
        index,
        id: spec.id,
        status: "invalid",
        reason: getErrorMessage(error),
        ...(error instanceof CLIError && error.suggestions?.length ? { suggestions: error.suggestions } : {}),
      });
    }
  }
  if (wrote) await reloadModel(args.rootPath);
  return {
    ...(changeset ? { changeset } : {}),
    ...batchReport(results, {
      verbose: args.verbose,
      limit: args.limit,
      written: ["staged", "updated"],
      settled: ["unchanged"],
      byCause: true,
    }),
  };
}

/** Whether an update would leave the element as it is: every field it sends already has that value. */
function alreadyAsSent(
  element: Element,
  args: UpdateSpec,
  attributePatch: Record<string, unknown> | undefined,
  currentSource: SourceReference | undefined,
  locationChange: { reference: SourceReference | undefined } | undefined,
  sourceOptions: SourceReferenceOptions,
  layerName: string
): boolean {
  if (args.name && args.name !== element.name) return false;
  if (args.description !== undefined && (args.description || undefined) !== (element.description || undefined)) return false;
  if (args.type && (!isValidNodeType(layerName, args.type) || normalizeNodeType(layerName, args.type) !== element.type)) {
    return false;
  }
  const newAttributes = resolveAttributeUpdate(element.attributes, { attributes: args.attributes, attributePatch });
  if (newAttributes && stableJson(newAttributes) !== stableJson(element.attributes ?? {})) return false;
  const same = (reference: SourceReference | undefined) => stableJson(reference ?? null) === stableJson(currentSource ?? null);
  if (args.clearSourceReference && currentSource) return false;
  if (locationChange && !same(locationChange.reference)) return false;
  if (!locationChange && sourceOptions.sourceProvenance && !same(buildSourceReference(sourceOptions, currentSource))) return false;
  return true;
}

/** Validates and applies one update to the loaded model; throws a CLIError saying what is wrong. */
export async function updateElement(model: Model, args: UpdateSpec): Promise<UpdateOutcome> {
  validateUpdateSourceReferenceOptions(args);
  // Refuse attributes + attributePatch before touching the model.
  resolveAttributeUpdate(undefined, { attributes: args.attributes, attributePatch: args.attributePatch });
  // An empty patch names no key: it is not an update.
  const attributePatch = effectiveAttributePatch(args.attributePatch);

  const layerName = await findElementLayer(model, args.id);
  if (!layerName) {
    throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "model_search" to find similar elements',
    ]);
  }

  const layer = await model.getLayer(layerName);
  const element = layer?.getElement(args.id);
  if (!layer || !element) {
    throw new CLIError(`Element ${args.id} not found`, ErrorCategory.NOT_FOUND, [
      'Use "model_search" to find similar elements',
    ]);
  }

  // Settle partial source fields first: one that is ignored (with a warning) is not an update.
  const currentSource = element.getSourceReference();
  // A location added or removed (#1260) settles against the element's reference on its own.
  const locationChange =
    args.addSourceLocation || args.removeSourceLocation
      ? settleSourceLocationChange(
          { add: args.addSourceLocation, remove: args.removeSourceLocation },
          currentSource,
          args,
          "mcp"
        )
      : undefined;
  const source = locationChange
    ? { options: {}, warnings: locationChange.warnings }
    : resolveSourceReferenceOptions(args, "mcp", currentSource);
  const warnings: string[] = [...source.warnings];

  const hasUpdates =
    args.name ||
    args.description !== undefined ||
    args.type ||
    args.attributes ||
    attributePatch ||
    source.options.sourceProvenance ||
    locationChange ||
    args.clearSourceReference;

  if (!hasUpdates) {
    return {
      status: "no-op",
      id: args.id,
      message: warnings.length > 0 ? "Nothing left to update" : "No fields specified for update",
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // Already as sent: nothing to write (#1296), so a list sent again stages nothing twice.
  if (alreadyAsSent(element, args, attributePatch, currentSource, locationChange, source.options, layerName)) {
    return {
      status: "unchanged",
      id: args.id,
      layer: layerName,
      message: "Already as sent",
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  const mutationHandler = new MutationHandler(model, args.id, layerName);

  await mutationHandler.executeUpdate(element, async (elem, after) => {
    let resolvedNewType: string | undefined;
    if (args.type) {
      if (!isValidNodeType(layerName, args.type)) {
        const validNodeTypes = getNodeTypesForLayer(layerName);
        const typeNames = validNodeTypes.map((t) => t.type).sort();
        const similar = findSimilar(args.type!, typeNames, 3);
        const suggestions: string[] = [`Valid types for ${layerName}: ${formatValidOptions(typeNames)}`];
        if (similar.length > 0) suggestions.unshift(`Did you mean: ${similar.join(" or ")}?`);
        throw new CLIError(`Invalid element type "${args.type}" for layer "${layerName}"`, ErrorCategory.USER, suggestions);
      }
      resolvedNewType = normalizeNodeType(layerName, args.type);
    }

    // The element is the projected one, so a patch merges over attributes the changeset already staged.
    const newAttributes = resolveAttributeUpdate(elem.attributes, {
      attributes: args.attributes,
      attributePatch,
    });

    if (resolvedNewType || newAttributes) {
      const candidateType = resolvedNewType ?? elem.type;
      const tempElem = new Element({
        ...elem.toJSON(),
        type: candidateType,
        spec_node_id: `${layerName}.${candidateType}`,
        attributes: newAttributes ?? elem.attributes,
      });
      const schemaValidator = new SchemaValidator();
      const tempLayer = new Layer(layerName);
      tempLayer.addElement(tempElem);
      const attrValidation = await schemaValidator.validateLayer(tempLayer);
      // An element already of a type the spec no longer defines (no type change requested):
      // its attributes have no type schema to fail, so let the update through and say how to
      // retype it, rather than refusing with a spec_type hint that cannot work.
      const undefinedType = !isValidNodeType(layerName, candidateType);
      const blocking = undefinedType
        ? attrValidation.errors.filter((e) => e.location !== "/type")
        : attrValidation.errors;
      if (undefinedType) {
        const { message, hint } = undefinedTypeWarning(
          "mcp",
          layerName,
          args.id,
          candidateType,
          suggestNodeTypes(layerName, candidateType)
        );
        warnings.push(`${message}. ${hint}`);
      }
      if (blocking.length > 0) {
        const errorMessages = blocking.map((e) => `  ${e.message}`).join("\n");
        throw new CLIError(`Updated attributes fail schema validation:\n${errorMessages}`, ErrorCategory.USER, [
          ...(undefinedType ? warnings : [schemaLookupHint("mcp", layerName, candidateType)]),
        ]);
      }
    }

    if (resolvedNewType) {
      elem.type = resolvedNewType;
      after.type = resolvedNewType;
      elem.spec_node_id = `${layerName}.${resolvedNewType}`;
      after.spec_node_id = `${layerName}.${resolvedNewType}`;
    }

    if (args.name) {
      elem.name = args.name;
      after.name = args.name;
    }

    if (args.description !== undefined) {
      elem.description = args.description || undefined;
      after.description = args.description || undefined;
    }

    if (newAttributes) {
      elem.attributes = newAttributes;
      after.attributes = newAttributes;
    }

    if (args.clearSourceReference) {
      elem.setSourceReference(undefined);
      setStagedSourceReference(after, undefined);
    } else if (locationChange) {
      elem.setSourceReference(locationChange.reference);
      setStagedSourceReference(after, locationChange.reference);
    } else if (source.options.sourceProvenance) {
      const newRef = buildSourceReference(source.options, currentSource);
      if (newRef) {
        elem.setSourceReference(newRef);
        setStagedSourceReference(after, newRef);
      }
    }

    layer.updateElement(elem);
  });

  const stagingManager = mutationHandler.getStagingManager();
  const activeChangeset = await stagingManager.getActive();
  const staged = !!(activeChangeset && activeChangeset.status === "staged");

  return {
    status: staged ? "staged" : "updated",
    changeset: staged ? activeChangeset!.name : undefined,
    id: args.id,
    layer: layerName,
    changedFields: mutationHandler.getChangedFields(),
    // The changeset adds this element: the update was folded into that add (no separate change).
    ...(mutationHandler.wasFoldedIntoAdd() ? { foldedIntoAdd: true as const } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export const modelUpdateTool: McpToolDefinition<typeof inputSchema> = {
  name: "model_update",
  description:
    "Update an existing element's name, description, type, attributes, or source reference. attributes replaces " +
    "all attributes; attributePatch changes only the keys it names (null removes one). sourceFile replaces the " +
    "element's source locations; addSourceLocation and removeSourceLocation add or remove one. Send one (id and its " +
    "fields) or many (updates: [{id, ...}, ...], or file for a large list). An update the element already matches " +
    "is unchanged, and nothing is written. The items that need attention are invalid (with the reason), no-op, or " +
    "applied with a warning. " +
    BATCH_RESULT_DESCRIPTION +
    " With verbose each item has its changedFields. Invalid items are skipped; the rest are still applied.",
  inputSchema,
  handler: modelUpdateHandler,
};
