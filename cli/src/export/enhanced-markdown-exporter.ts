import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS } from "./types.js";
import { MarkdownGenerator, type MarkdownGeneratorOptions } from "./markdown-generator.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Enhanced Markdown Exporter - generates comprehensive markdown documentation
 * with Mermaid diagrams and formatted tables
 *
 * Supports all 12 layers and includes:
 * - Architecture overview diagrams with Mermaid
 * - Layer-specific visualizations
 * - Formatted markdown tables
 * - Cross-layer relationship diagrams
 * - Element properties and relationship details
 */
export class EnhancedMarkdownExporter implements Exporter {
  name = "Enhanced Markdown";
  supportedLayers = ALL_LAYERS;

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled
      ? startSpan("export.format.enhanced-markdown", {
          "export.layerCount": options.layers?.length || this.supportedLayers.length,
        })
      : null;

    try {
      // Create markdown generator with appropriate options
      const generatorOptions: MarkdownGeneratorOptions = {
        includeMermaid: true,
        includeTables: true,
        tableFormat: "markdown",
        maxTableRows: 50,
        diagramType: "graph",
        includeSourceReferences: options.includeSources === true,
      };

      const generator = new MarkdownGenerator(model, generatorOptions);
      const markdown = await generator.generate();

      if (isTelemetryEnabled && span) {
        let totalElements = 0;
        let totalRelationships = 0;

        // Count statistics
        for (const _node of model.graph.nodes.values()) {
          totalElements++;
        }

        totalRelationships = model.graph.getAllEdges().length;

        (span as any).setAttribute("export.elementCount", totalElements);
        (span as any).setAttribute("export.relationshipCount", totalRelationships);
        (span as any).setAttribute("export.size", markdown.length);
        (span as any).setStatus({ code: 0 });
      }

      return markdown;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({
          code: 2,
          message: getErrorMessage(error),
        });
      }
      throw error;
    } finally {
      endSpan(span);
    }
  }
}
