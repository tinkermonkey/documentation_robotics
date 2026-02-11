import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { formatLayerName } from "../utils/layer-name-formatter.js";
import { getErrorMessage } from "../utils/errors.js";
import { escapeMarkdown, valueToMarkdown, getLayerDescription } from "./markdown-utils.js";

/**
 * Markdown Exporter - generates comprehensive markdown documentation
 * Supports all 12 layers
 */
export class MarkdownExporter implements Exporter {
  name = "Markdown";
  supportedLayers = ALL_LAYERS;

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled
      ? startSpan("export.format.markdown", {
          "export.layerCount": options.layers?.length || this.supportedLayers.length,
        })
      : null;

    try {
      const lines: string[] = [];

      // Document header
      lines.push(`# ${this.escapeMarkdownLocal(model.manifest.name)}`);
      lines.push("");

      if (model.manifest.description) {
        lines.push(`${model.manifest.description}`);
        lines.push("");
      }

      // Model metadata
      lines.push("## Model Information");
      lines.push("");
      lines.push(`| Property | Value |`);
      lines.push(`| -------- | ----- |`);
      lines.push(`| Version | ${model.manifest.version || "1.0.0"} |`);
      if (model.manifest.author) {
        lines.push(`| Author | ${this.escapeMarkdownLocal(model.manifest.author)} |`);
      }
      if (model.manifest.created) {
        lines.push(`| Created | ${model.manifest.created} |`);
      }
      if (model.manifest.modified) {
        lines.push(`| Modified | ${model.manifest.modified} |`);
      }
      lines.push("");

      const layersToExport = options.layers || this.supportedLayers;

      // Generate documentation for each layer
      for (const layerName of layersToExport) {
        const layer = await model.getLayer(layerName);
        if (!layer) continue;

        const elements = Array.from(layer.listElements());
        if (elements.length === 0) continue;

        lines.push(`## Layer: ${this.formatLayerName(layerName)}`);
        lines.push("");

        const description = this.getLayerDescription(layerName);
        if (description) {
          lines.push(`*${description}*`);
          lines.push("");
        }

        lines.push(`### Elements (${elements.length})`);
        lines.push("");

        // Element table
        lines.push(`| ID | Name | Type | Description |`);
        lines.push(`| -- | ---- | ---- | ----------- |`);

        for (const element of elements) {
          const id = this.escapeMarkdownLocal(element.id);
          const name = this.escapeMarkdownLocal(element.name);
          const type = this.escapeMarkdownLocal(element.type);
          const desc = element.description
            ? this.escapeMarkdownLocal(element.description).substring(0, 100)
            : "";

          lines.push(`| \`${id}\` | ${name} | ${type} | ${desc} |`);
        }

        lines.push("");

        // Element details
        lines.push(`### Element Details`);
        lines.push("");

        for (const element of elements) {
          lines.push(`#### ${this.escapeMarkdownLocal(element.name)} (\`${element.id}\`)`);
          lines.push("");

          if (element.description) {
            lines.push(`${element.description}`);
            lines.push("");
          }

          lines.push("**Type:** " + element.type);
          lines.push("");

          // Source Reference
          const sourceRef = element.getSourceReference();
          if (sourceRef) {
            lines.push("### Source Code Location");
            lines.push("");
            lines.push(`**Provenance**: ${sourceRef.provenance}`);
            lines.push("");

            lines.push("**Locations:**");
            lines.push("");
            sourceRef.locations.forEach((loc, idx) => {
              lines.push(`${idx + 1}. \`${this.escapeMarkdownLocal(loc.file)}\``);
              if (loc.symbol) {
                lines.push(`   - Symbol: \`${this.escapeMarkdownLocal(loc.symbol)}\``);
              }
            });
            lines.push("");

            if (sourceRef.repository) {
              lines.push("**Repository Context:**");
              lines.push("");
              if (sourceRef.repository.url) {
                lines.push(`- Remote: ${sourceRef.repository.url}`);
              }
              if (sourceRef.repository.commit) {
                const shortCommit = sourceRef.repository.commit.substring(0, 7);
                if (sourceRef.repository.url) {
                  lines.push(
                    `- Commit: [\`${shortCommit}\`](${sourceRef.repository.url}/commit/${sourceRef.repository.commit})`
                  );
                } else {
                  lines.push(`- Commit: \`${shortCommit}\``);
                }
              }
              lines.push("");
            }
          }

          // Properties
          if (Object.keys(element.properties).length > 0) {
            lines.push("**Properties:**");
            lines.push("");
            lines.push(`| Property | Value |`);
            lines.push(`| -------- | ----- |`);

            for (const [key, value] of Object.entries(element.properties)) {
              const displayValue = this.valueToMarkdownLocal(value);
              lines.push(`| \`${key}\` | ${displayValue} |`);
            }
            lines.push("");
          }

          // References
          if (element.references.length > 0) {
            lines.push("**Cross-Layer References:**");
            lines.push("");

            for (const ref of element.references) {
              const refDesc = ref.description ? ` - ${this.escapeMarkdownLocal(ref.description)}` : "";
              lines.push(`- **${ref.type}**: \`${ref.target}\`${refDesc}`);
            }
            lines.push("");
          }

          // Relationships
          if (element.relationships.length > 0) {
            lines.push("**Relationships:**");
            lines.push("");

            for (const rel of element.relationships) {
              lines.push(`- **${rel.predicate}**: \`${rel.target}\``);
            }
            lines.push("");
          }
        }

        // Layer summary
        lines.push(`### Layer Summary`);
        lines.push("");
        lines.push(`- **Total Elements:** ${elements.length}`);

        const refCount = elements.reduce((sum, e) => sum + e.references.length, 0);
        const relCount = elements.reduce((sum, e) => sum + e.relationships.length, 0);

        lines.push(`- **Cross-Layer References:** ${refCount}`);
        lines.push(`- **Relationships:** ${relCount}`);

        lines.push("");
        lines.push("---");
        lines.push("");
      }

      // Architecture Summary
      lines.push("## Architecture Summary");
      lines.push("");

      let totalElements = 0;
      let totalReferences = 0;
      let totalRelationships = 0;

      for (const layerName of layersToExport) {
        const layer = await model.getLayer(layerName);
        if (!layer) continue;

        for (const element of layer.listElements()) {
          totalElements++;
          totalReferences += element.references.length;
          totalRelationships += element.relationships.length;
        }
      }

      lines.push(`| Metric | Count |`);
      lines.push(`| ------ | ----- |`);
      lines.push(`| Total Elements | ${totalElements} |`);
      lines.push(`| Cross-Layer References | ${totalReferences} |`);
      lines.push(`| Relationships | ${totalRelationships} |`);
      lines.push("");

      const result = lines.join("\n");

      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("export.elementCount", totalElements);
        (span as any).setAttribute("export.referenceCount", totalReferences);
        (span as any).setAttribute("export.relationshipCount", totalRelationships);
        (span as any).setAttribute("export.size", result.length);
        (span as any).setStatus({ code: 0 });
      }

      return result;
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

  /**
   * Escape markdown special characters (delegates to shared utility)
   */
  private escapeMarkdownLocal(str: string): string {
    return escapeMarkdown(str);
  }

  /**
   * Format layer name for display (delegates to centralized formatter)
   */
  private formatLayerName(name: string): string {
    return formatLayerName(name);
  }

  /**
   * Get layer description (delegates to shared utility)
   */
  private getLayerDescription(layer: string): string {
    return getLayerDescription(layer);
  }

  /**
   * Convert value to markdown representation (delegates to shared utility)
   */
  private valueToMarkdownLocal(value: unknown): string {
    return valueToMarkdown(value);
  }
}
