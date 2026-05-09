/**
 * List elements in a layer
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import {
  CLIError,
  ErrorCategory,
  ModelNotFoundError,
  handleError
} from "../utils/errors.js";
import { getActiveSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";
import {
  TABLE_COLUMN_WIDTHS,
  TABLE_SEPARATOR
} from "../utils/table-formatting.js";
import { CANONICAL_LAYER_NAMES } from "../core/layers.js";

export interface ListOptions {
  type?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
  model?: string;
}

async function loadModel(modelPath: string | undefined): Promise<Model> {
  try {
    return await Model.load(modelPath);
  } catch (error) {
    const message = getErrorMessage(error);
    if (
      message.includes("No DR project") ||
      message.includes("Model not found") ||
      message.includes("No model found") ||
      message.includes("Could not find documentation_robotics")
    ) {
      throw new ModelNotFoundError();
    }
    throw error;
  }
}

type ElementRow = { path?: string; id: string; type: string; name: string; description?: string; toJSON(): object };

function printLayerTable(
  layerName: string,
  elements: ElementRow[],
  options: ListOptions
): void {
  const idWidth = TABLE_COLUMN_WIDTHS.LIST_ID_WIDTH;
  const typeWidth = TABLE_COLUMN_WIDTHS.LIST_TYPE_WIDTH;
  const nameWidth = TABLE_COLUMN_WIDTHS.LIST_NAME_WIDTH;

  console.log("");
  console.log(ansis.bold(`Elements in ${ansis.cyan(layerName)} layer:`));
  console.log(ansis.dim(TABLE_SEPARATOR));
  console.log(
    `${ansis.cyan("ID".padEnd(idWidth))} ${ansis.cyan("TYPE".padEnd(typeWidth))} ${ansis.cyan("NAME")}`
  );
  console.log(ansis.dim(TABLE_SEPARATOR));

  for (const element of elements) {
    const displayId = element.path || element.id;
    const id = displayId.substring(0, idWidth - 1).padEnd(idWidth);
    const type = element.type.substring(0, typeWidth - 1).padEnd(typeWidth);
    const name = element.name.substring(0, nameWidth);
    console.log(`${id} ${type} ${name}`);
    if (options.verbose && element.description) {
      console.log(ansis.dim(`  └─ ${element.description}`));
    }
  }

  console.log(ansis.dim("─".repeat(80)));
  console.log(ansis.dim(`Total: ${elements.length} element(s)`));
}

export async function listCommand(
  layer: string | undefined,
  options: ListOptions
): Promise<void> {
  const span = getActiveSpan();

  try {
    // All-layers mode when layer argument is omitted
    if (!layer) {
      const model = await loadModel(options.model);
      type LayerResult = { layer: string; elements: ElementRow[] };
      const allResults: LayerResult[] = [];

      for (const layerName of CANONICAL_LAYER_NAMES) {
        const layerObj = await model.getLayer(layerName);
        if (!layerObj) continue;

        let elements = layerObj.listElements();
        if (options.type) {
          elements = elements.filter((e) => e.type === options.type);
        }
        if (elements.length > 0) {
          allResults.push({ layer: layerName, elements });
        }
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            allResults.map(({ layer: l, elements }) => ({
              layer: l,
              elements: elements.map((e) => e.toJSON()),
            })),
            null,
            2
          )
        );
        return;
      }

      if (allResults.length === 0) {
        console.log(ansis.yellow("No elements found"));
      } else {
        for (const { layer: layerName, elements } of allResults) {
          printLayerTable(layerName, elements, options);
        }
      }
      console.log("");
      return;
    }

    // Single-layer mode
    let model: Model;
    try {
      model = await Model.load(options.model, { layers: [layer] });
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        message.includes("No DR project") ||
        message.includes("Model not found") ||
        message.includes("No model found") ||
        message.includes("Could not find documentation_robotics")
      ) {
        throw new ModelNotFoundError();
      }
      throw error;
    }

    const layerObj = await model.getLayer(layer);
    if (!layerObj) {
      throw new CLIError(`Layer ${layer} not found`, ErrorCategory.NOT_FOUND, [
        'Use "dr list" to see all available layers',
        'Use "dr add <layer> <type> <name>" to add an element to a new layer'
      ]);
    }

    let elements = layerObj.listElements();
    if (options.type) {
      elements = elements.filter((e) => e.type === options.type);
    }

    span?.setAttribute("list.layer", layer);
    span?.setAttribute("list.elementCount", elements.length);

    if (options.json) {
      console.log(JSON.stringify(elements.map((e) => e.toJSON()), null, 2));
      return;
    }

    if (elements.length === 0) {
      console.log(ansis.yellow(`No elements in ${layer} layer`));
      return;
    }

    printLayerTable(layer, elements, options);
    console.log("");
  } catch (error) {
    handleError(error);
  }
}
