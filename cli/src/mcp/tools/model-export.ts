/**
 * model_export — export the model to a documentation/interchange format.
 * Mirrors `dr export`, reusing the shared ExportManager and exporters.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ArchiMateExporter,
  ExportManager,
  GraphMLExporter,
  JsonSchemaExporter,
  MarkdownExporter,
  MermaidMarkdownExporter,
  OpenAPIExporter,
  PlantUMLExporter,
} from "../../export/index.js";
import { Validator } from "../../validators/validator.js";
import { CLIError, ErrorCategory } from "../../utils/errors.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";

export interface ModelExportArgs {
  format: string;
  layers?: string[];
  includeSources?: boolean;
  rootPath?: string;
}

const inputSchema = {
  format: z
    .string()
    .describe("Export format: archimate, openapi, json-schema, plantuml, graphml, markdown, or mermaid-markdown."),
  layers: z.array(z.string()).optional().describe("Restrict export to these layers (must be supported by the chosen format)."),
  includeSources: z.boolean().optional().describe("Include source_reference provenance in the export, where supported."),
  rootPath: rootPathSchema,
};

function buildExportManager(): ExportManager {
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
  return manager;
}

const SEMANTIC_FORMATS = new Set(["openapi", "archimate", "jsonschema", "json-schema"]);

export async function modelExportHandler(args: ModelExportArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const model = await loadModel(args.rootPath);
    const manager = buildExportManager();
    const format = args.format.toLowerCase();

    if (!manager.hasFormat(format)) {
      const available = manager.getAllFormats().map((f) => f.format);
      throw new CLIError(`Unknown export format: ${args.format}`, ErrorCategory.USER, [
        `Available formats: ${available.join(", ")}`,
      ]);
    }

    const warnings: string[] = [];
    if (SEMANTIC_FORMATS.has(format)) {
      const validator = new Validator();
      const validationResult = await validator.validateModel(model);
      if (!validationResult.isValid()) {
        warnings.push(
          `Model has ${validationResult.errors.length} validation error(s). Export output may be incomplete or incorrect.`
        );
      }
    }

    const content = await manager.export(model, format, {
      layers: args.layers,
      includeSources: args.includeSources,
    });

    return jsonResult({ format, warnings, content });
  });
}

export const modelExportTool: McpToolDefinition<ModelExportArgs> = {
  name: "model_export",
  description: "Export the architecture model to ArchiMate, OpenAPI, JSON Schema, PlantUML, GraphML, or Markdown.",
  inputSchema,
  handler: modelExportHandler,
};
