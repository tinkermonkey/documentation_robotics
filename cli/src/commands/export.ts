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
  MermaidMarkdownExporter,
} from "../export/index.js";
import { writeFile } from "../utils/file-io.js";
import * as path from "path";
import { startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

declare const TELEMETRY_ENABLED: boolean | undefined;
const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

export interface ExportOptions {
  format: string;
  output?: string;
  layers?: string[];
  model?: string;
  includeSources?: boolean;
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("export.execute", {
        "export.format": options.format,
        "export.layer_count": options.layers?.length || 0,
        "export.has_output": !!options.output,
      })
    : null;

  try {
    // Load model
    const model = await Model.load(options.model);

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

    // Register alias for jsonschema (without hyphen)
    manager.register("jsonschema", new JsonSchemaExporter(), {
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

    manager.register("mermaid-markdown", new MermaidMarkdownExporter(), {
      description: "Markdown with Mermaid diagrams and formatted tables",
      mimeType: "text/markdown",
    });

    // Validate format
    const format = options.format.toLowerCase();
    if (!manager.hasFormat(format)) {
      console.error(ansis.red(`Error: Unknown export format: ${format}`));
      console.error("");
      console.error("Available formats:");
      for (const info of manager.getAllFormats()) {
        console.error(`  - ${ansis.cyan(info.format)}: ${info.description}`);
        console.error(`    Supported layers: ${info.supportedLayers.join(", ")}`);
      }
      process.exit(1);
    }

    // Perform export
    const result = await manager.export(model, format, {
      layers: options.layers,
      outputPath: options.output,
      includeSources: options.includeSources,
    });

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("export.result_size", result.length);
    }

    if (options.output) {
      // Write to file
      // For relative paths, use current working directory instead of rootPath
      // This allows tests to detect file creation in their working directory
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.join(process.cwd(), options.output);

      await writeFile(outputPath, result);

      console.log(ansis.green(`✓ Exported to ${ansis.cyan(outputPath)}`));
    } else {
      // Output to stdout
      console.log(result);
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: (error as Error).message });
    }
    const message = getErrorMessage(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  } finally {
    if (isTelemetryEnabled) {
      endSpan(span);
    }
  }
}
