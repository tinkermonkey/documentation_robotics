/**
 * Show information about a model or layer
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { TABLE_COLUMN_WIDTHS, TABLE_SEPARATOR } from "../utils/table-formatting.js";

export interface InfoOptions {
  layer?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("info.execute", {
        "info.hasLayer": !!options.layer,
        "info.layer": options.layer,
        "info.verbose": options.verbose === true,
      })
    : null;

  try {
    // Load model
    const model = await Model.load();
    const manifest = model.manifest;

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("model.name", manifest.name);
      (span as any).setAttribute("model.version", manifest.version);
      (span as any).setAttribute("model.specVersion", manifest.specVersion);
    }

    console.log("");
    console.log(ansis.bold(`${ansis.blue("Model:")} ${manifest.name}`));
    console.log(ansis.dim(TABLE_SEPARATOR));

    console.log(`${ansis.gray("Name:")}          ${manifest.name}`);
    console.log(`${ansis.gray("Version:")}       ${manifest.version}`);
    console.log(`${ansis.gray("Spec Version:")}  ${manifest.specVersion}`);

    if (manifest.description) {
      console.log(`${ansis.gray("Description:")}   ${manifest.description}`);
    }

    if (manifest.author) {
      console.log(`${ansis.gray("Author:")}        ${manifest.author}`);
    }

    console.log(`${ansis.gray("Created:")}       ${manifest.created}`);
    console.log(`${ansis.gray("Modified:")}      ${manifest.modified}`);

    // Show layer information
    const layerNames = model.getLayerNames();

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("info.layerCount", layerNames.length);
    }

    if (layerNames.length > 0) {
      console.log("");
      console.log(ansis.bold("Layers:"));
      console.log(ansis.dim(TABLE_SEPARATOR));

      if (options.layer) {
        // Show specific layer info
        const layer = await model.getLayer(options.layer);
        if (!layer) {
          console.error(ansis.red(`Error: Layer ${options.layer} not found`));
          process.exit(1);
        }

        const elements = layer.listElements();
        console.log(`${ansis.cyan(options.layer)}`);
        console.log(`  ${ansis.gray("Elements:")} ${elements.length}`);

        if (isTelemetryEnabled && span) {
          (span as any).setAttribute("info.elementCount", elements.length);
        }

        if (options.verbose && elements.length > 0) {
          console.log(`  ${ansis.gray("Details:")}`);
          const types = new Set(elements.map((e) => e.type));
          for (const type of types) {
            const count = elements.filter((e) => e.type === type).length;
            console.log(`    - ${type}: ${count}`);
          }
        }
      } else {
        // Show all layers summary
        const idWidth = TABLE_COLUMN_WIDTHS.INFO_ID_WIDTH;
        const countWidth = TABLE_COLUMN_WIDTHS.INFO_COUNT_WIDTH;

        for (const layerName of layerNames) {
          const layer = await model.getLayer(layerName);
          if (!layer) continue;

          const count = layer.listElements().length;
          const paddedName = layerName.padEnd(idWidth);
          const paddedCount = String(count).padEnd(countWidth);

          console.log(`${ansis.cyan(paddedName)} ${paddedCount} elements`);
        }
      }
    } else {
      console.log("");
      console.log(ansis.yellow("No layers found"));
    }

    console.log("");

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    const message = getErrorMessage(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  } finally {
    endSpan(span);
  }
}
