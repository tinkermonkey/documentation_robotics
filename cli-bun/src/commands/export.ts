/**
 * Export the architecture model to various formats
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import {
  ExportManager,
  ArchiMateExporter,
  OpenAPIExporter,
  JsonSchemaExporter,
  PlantUMLExporter,
  GraphMLExporter,
  MarkdownExporter,
} from "../export/index.js";
import { fileExists, writeFile } from "../utils/file-io.js";
import * as path from "path";

export interface ExportOptions {
  format: string;
  output?: string;
  layers?: string[];
  verbose?: boolean;
  debug?: boolean;
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(
        ansis.red('Error: No model found. Run "dr init" first.')
      );
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Initialize ExportManager and register all exporters
    const manager = new ExportManager();

    manager.register("archimate", new ArchiMateExporter(), {
      description: "ArchiMate 3.2 XML format",
      mimeType: "application/xml",
    });

    manager.register("openapi", new OpenAPIExporter(), {
      description: "OpenAPI 3.0 specification",
      mimeType: "application/json",
    });

    manager.register("json-schema", new JsonSchemaExporter(), {
      description: "JSON Schema Draft 7",
      mimeType: "application/json",
    });

    manager.register("plantuml", new PlantUMLExporter(), {
      description: "PlantUML diagram format",
      mimeType: "text/plain",
    });

    manager.register("graphml", new GraphMLExporter(), {
      description: "GraphML graph format",
      mimeType: "application/xml",
    });

    manager.register("markdown", new MarkdownExporter(), {
      description: "Markdown documentation",
      mimeType: "text/markdown",
    });

    // Validate format
    const format = options.format.toLowerCase();
    if (!manager.hasFormat(format)) {
      console.error(
        ansis.red(`Error: Unknown export format: ${format}`)
      );
      console.error("");
      console.error("Available formats:");
      for (const info of manager.getAllFormats()) {
        console.error(
          `  - ${ansis.cyan(info.format)}: ${info.description}`
        );
        console.error(
          `    Supported layers: ${info.supportedLayers.join(", ")}`
        );
      }
      process.exit(1);
    }

    if (options.verbose) {
      console.log(
        ansis.dim(`Exporting model to ${ansis.cyan(format)} format...`)
      );
      console.log("");
    }

    // Perform export
    const result = await manager.export(model, format, {
      layers: options.layers,
      outputPath: options.output,
    });

    if (options.output) {
      // Write to file
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.join(rootPath, options.output);

      await writeFile(outputPath, result);

      console.log(
        ansis.green(`✓ Exported to ${ansis.cyan(outputPath)}`)
      );

      if (options.verbose) {
        const formatInfo = manager.getFormatInfo(format);
        if (formatInfo) {
          console.log(`  Format: ${formatInfo.name}`);
          console.log(`  Size: ${result.length} bytes`);
          console.log(
            `  Supported layers: ${formatInfo.supportedLayers.join(", ")}`
          );
        }
      }
    } else {
      // Output to stdout
      console.log(result);
    }

    if (options.verbose) {
      console.log("");
      console.log(
        ansis.dim("Export completed successfully")
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
