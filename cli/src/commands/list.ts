/**
 * List elements in a layer
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { CLIError, ErrorCategory, ModelNotFoundError, handleError } from "../utils/errors.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { TABLE_COLUMN_WIDTHS, TABLE_SEPARATOR } from "../utils/table-formatting.js";
import { truncateToWidth } from "../utils/string-utils.js";
import { extractErrorMessage } from "../utils/error-utils.js";

export interface ListOptions {
  type?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
  model?: string;
}

export async function listCommand(layer: string, options: ListOptions): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("list.execute", {
        "list.layer": layer,
        "list.type": options.type,
        "list.json": options.json === true,
      })
    : null;

  try {
    // Load model (with error handling for missing models)
    let model: Model;
    try {
      model = await Model.load(options.model);
    } catch (error) {
      const message = extractErrorMessage(error);
      // Check for any model-not-found error pattern
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

    // Get layer
    const layerObj = await model.getLayer(layer);
    if (!layerObj) {
      throw new CLIError(`Layer ${layer} not found`, ErrorCategory.NOT_FOUND, [
        'Use "dr list" to see all available layers',
        'Use "dr add <layer> <type> <name>" to add an element to a new layer',
      ]);
    }

    // Get elements
    let elements = layerObj.listElements();

    // Filter by type if specified
    if (options.type) {
      elements = elements.filter((e) => e.type === options.type);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("list.elementCount", elements.length);
      (span as any).setStatus({ code: 0 });
    }

    // Output as JSON if requested
    if (options.json) {
      console.log(
        JSON.stringify(
          elements.map((e) => e.toJSON()),
          null,
          2
        )
      );
      return;
    }

    // Display as table
    if (elements.length === 0) {
      console.log(ansis.yellow(`No elements in ${layer} layer`));
      return;
    }

    console.log("");
    console.log(ansis.bold(`Elements in ${ansis.cyan(layer)} layer:`));
    console.log(ansis.dim(TABLE_SEPARATOR));

    // Print header
    const idWidth = TABLE_COLUMN_WIDTHS.LIST_ID_WIDTH;
    const typeWidth = TABLE_COLUMN_WIDTHS.LIST_TYPE_WIDTH;
    const nameWidth = TABLE_COLUMN_WIDTHS.LIST_NAME_WIDTH;

    console.log(
      `${ansis.cyan("ID".padEnd(idWidth))} ${ansis.cyan("TYPE".padEnd(typeWidth))} ${ansis.cyan("NAME")}`
    );
    console.log(ansis.dim(TABLE_SEPARATOR));

    // Print rows
    for (const element of elements) {
      const id = truncateToWidth(element.id, idWidth);
      const type = truncateToWidth(element.type, typeWidth);
      const name = element.name.substring(0, nameWidth);

      console.log(`${id} ${type} ${name}`);

      if (options.verbose && element.description) {
        console.log(ansis.dim(`  └─ ${element.description}`));
      }
    }

    console.log(ansis.dim(TABLE_SEPARATOR));
    console.log(ansis.dim(`Total: ${elements.length} element(s)`));
    console.log("");
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: extractErrorMessage(error),
      });
    }
    handleError(error);
  } finally {
    endSpan(span);
  }
}
