/**
 * The view of the model a read tool validates and measures: the base model, or the base with the
 * active changeset projected onto it.
 *
 * `loadModel()` returns a Model whose `relationships` already include the active changeset's
 * staged adds and deletes, while its `layers` map holds the base elements (the projected ones come
 * from `getLayer()`). Code that reads `layers` and `relationships` together, as the validators do,
 * sees staged relationships between elements that are not there yet and reports each as an error
 * (#1214). Every tool that validates goes through {@link modelView} and {@link validateView}, so
 * they agree on what is valid and say which view they looked at.
 */

import type { Model } from "../../core/model.js";
import { StagingAreaManager } from "../../core/staging-area.js";
import { addModelWarnings } from "../../validators/model-warnings.js";
import type { ValidationResult } from "../../validators/types.js";
import { ValidationFormatter } from "../../validators/validation-formatter.js";
import { Validator } from "../../validators/validator.js";

/** Which model a result describes. */
export type ModelViewName =
  | { model: "base" }
  | { model: "changeset"; changeset: { id: string; name: string }; note: string };

export interface ModelView {
  /** Layers and relationships as the view has them. Read-only: a projection is saved nowhere. */
  model: Model;
  view: ModelViewName;
}

/**
 * The model as the active changeset leaves it, or the base model when none is active.
 *
 * `Validator` is typed to accept `Model`, but a projected changeset is a `ProjectedModel`
 * (manifest, layers and relationships only). The pipeline reads `rootPath` for telemetry alone, so
 * it is carried over explicitly, as `dr validate` does (commands/validate.ts).
 */
export async function modelView(model: Model): Promise<ModelView> {
  const activeId = model.getActiveChangesetId();
  if (!activeId) return { model, view: { model: "base" } };
  const projected = await model.getVirtualProjectionEngine().projectModel(model, activeId);
  const changeset = await new StagingAreaManager(model.rootPath, model).load(activeId);
  return {
    model: { ...projected, rootPath: model.rootPath } as unknown as Model,
    view: {
      model: "changeset",
      changeset: { id: activeId, name: changeset?.name ?? activeId },
      note: "The base model with the active changeset's staged changes applied.",
    },
  };
}

/**
 * The validation pipeline over a view, plus the warnings the pipeline does not raise: orphaned
 * elements and, outside the intent layers, elements with no source reference (#1215).
 */
export async function validateView(view: Model, options: { strict?: boolean } = {}): Promise<ValidationResult> {
  const result = await new Validator().validateModel(view);
  addModelWarnings(result, view, { exemptIntentLayers: true, strict: options.strict });
  return result;
}

/** Elements with no relationship and no cross-layer reference, in either direction. */
export function orphanIds(view: Model): string[] {
  return ValidationFormatter.calculateStats(view).orphanedElements;
}

/** Counts of ids (`layer.type.name`) by layer and type. */
export interface LayerTypeCounts {
  layer: string;
  count: number;
  types: Record<string, number>;
}

/** Ids counted by layer and then type, layers in the order first seen, types most common first. */
export function countByLayerAndType(ids: Iterable<string>): LayerTypeCounts[] {
  const layers = new Map<string, Map<string, number>>();
  for (const id of ids) {
    const [layer = "", type = ""] = id.split(".");
    const types = layers.get(layer) ?? new Map<string, number>();
    types.set(type, (types.get(type) ?? 0) + 1);
    layers.set(layer, types);
  }
  return [...layers].map(([layer, types]) => ({
    layer,
    count: [...types.values()].reduce((sum, n) => sum + n, 0),
    types: Object.fromEntries([...types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  }));
}

/** Ids grouped by layer and then type, in the same order as {@link countByLayerAndType}. */
export function groupByLayerAndType(ids: Iterable<string>): Array<{ layer: string; count: number; types: Record<string, string[]> }> {
  const layers = new Map<string, Map<string, string[]>>();
  for (const id of ids) {
    const [layer = "", type = ""] = id.split(".");
    const types = layers.get(layer) ?? new Map<string, string[]>();
    const list = types.get(type) ?? [];
    list.push(id);
    types.set(type, list);
    layers.set(layer, types);
  }
  return [...layers].map(([layer, types]) => ({
    layer,
    count: [...types.values()].reduce((sum, list) => sum + list.length, 0),
    types: Object.fromEntries([...types].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))),
  }));
}
