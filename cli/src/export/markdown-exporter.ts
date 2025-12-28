import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { ALL_LAYERS } from "./types.js";

/**
 * Markdown Exporter - generates comprehensive markdown documentation
 * Supports all 12 layers
 */
export class MarkdownExporter implements Exporter {
  name = "Markdown";
  supportedLayers = ALL_LAYERS;

  private readonly layerDescriptions: Record<string, string> = {
    motivation:
      "Goals, requirements, drivers, and strategic outcomes of the architecture.",
    business:
      "Business processes, functions, roles, and services.",
    security:
      "Authentication, authorization, security threats, and controls.",
    application:
      "Application components, services, and interactions.",
    technology:
      "Infrastructure, platforms, systems, and technology components.",
    api: "REST APIs, operations, endpoints, and API integrations.",
    "data-model":
      "Data entities, relationships, and data structure definitions.",
    "data-store":
      "Databases, data stores, and persistence mechanisms.",
    ux: "User interface components, screens, and user experience elements.",
    navigation:
      "Application routing, navigation flows, and page structures.",
    apm: "Observability, monitoring, metrics, logging, and tracing.",
    testing:
      "Test strategies, test cases, test data, and test coverage.",
  };

  async export(model: Model, options: ExportOptions = {}): Promise<string> {
    const lines: string[] = [];

    // Document header
    lines.push(`# ${this.escapeMarkdown(model.manifest.name)}`);
    lines.push("");

    if (model.manifest.description) {
      lines.push(`${model.manifest.description}`);
      lines.push("");
    }

    // Model metadata
    lines.push("## Model Information");
    lines.push("");
    lines.push(
      `| Property | Value |`
    );
    lines.push(`| -------- | ----- |`);
    lines.push(
      `| Version | ${model.manifest.version || "1.0.0"} |`
    );
    if (model.manifest.author) {
      lines.push(
        `| Author | ${this.escapeMarkdown(model.manifest.author)} |`
      );
    }
    if (model.manifest.created) {
      lines.push(
        `| Created | ${model.manifest.created} |`
      );
    }
    if (model.manifest.modified) {
      lines.push(
        `| Modified | ${model.manifest.modified} |`
      );
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

      const description = this.layerDescriptions[layerName];
      if (description) {
        lines.push(`*${description}*`);
        lines.push("");
      }

      lines.push(`### Elements (${elements.length})`);
      lines.push("");

      // Element table
      lines.push(
        `| ID | Name | Type | Description |`
      );
      lines.push(
        `| -- | ---- | ---- | ----------- |`
      );

      for (const element of elements) {
        const id = this.escapeMarkdown(element.id);
        const name = this.escapeMarkdown(element.name);
        const type = this.escapeMarkdown(element.type);
        const desc = element.description
          ? this.escapeMarkdown(element.description).substring(0, 100)
          : "";

        lines.push(`| \`${id}\` | ${name} | ${type} | ${desc} |`);
      }

      lines.push("");

      // Element details
      lines.push(`### Element Details`);
      lines.push("");

      for (const element of elements) {
        lines.push(
          `#### ${this.escapeMarkdown(element.name)} (\`${element.id}\`)`
        );
        lines.push("");

        if (element.description) {
          lines.push(`${element.description}`);
          lines.push("");
        }

        lines.push("**Type:** " + element.type);
        lines.push("");

        // Properties
        if (Object.keys(element.properties).length > 0) {
          lines.push("**Properties:**");
          lines.push("");
          lines.push(
            `| Property | Value |`
          );
          lines.push(
            `| -------- | ----- |`
          );

          for (const [key, value] of Object.entries(element.properties)) {
            const displayValue = this.valueToMarkdown(value);
            lines.push(
              `| \`${key}\` | ${displayValue} |`
            );
          }
          lines.push("");
        }

        // References
        if (element.references.length > 0) {
          lines.push("**Cross-Layer References:**");
          lines.push("");

          for (const ref of element.references) {
            const refDesc = ref.description
              ? ` - ${this.escapeMarkdown(ref.description)}`
              : "";
            lines.push(
              `- **${ref.type}**: \`${ref.target}\`${refDesc}`
            );
          }
          lines.push("");
        }

        // Relationships
        if (element.relationships.length > 0) {
          lines.push("**Relationships:**");
          lines.push("");

          for (const rel of element.relationships) {
            lines.push(
              `- **${rel.predicate}**: \`${rel.target}\``
            );
          }
          lines.push("");
        }
      }

      // Layer summary
      lines.push(`### Layer Summary`);
      lines.push("");
      lines.push(
        `- **Total Elements:** ${elements.length}`
      );

      const refCount = elements.reduce(
        (sum, e) => sum + e.references.length,
        0
      );
      const relCount = elements.reduce(
        (sum, e) => sum + e.relationships.length,
        0
      );

      lines.push(
        `- **Cross-Layer References:** ${refCount}`
      );
      lines.push(
        `- **Relationships:** ${relCount}`
      );

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

    lines.push(
      `| Metric | Count |`
    );
    lines.push(
      `| ------ | ----- |`
    );
    lines.push(
      `| Total Elements | ${totalElements} |`
    );
    lines.push(
      `| Cross-Layer References | ${totalReferences} |`
    );
    lines.push(
      `| Relationships | ${totalRelationships} |`
    );
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Escape markdown special characters
   */
  private escapeMarkdown(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\*/g, "\\*")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}");
  }

  /**
   * Format layer name for display
   */
  private formatLayerName(name: string): string {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Convert value to markdown representation
   */
  private valueToMarkdown(value: unknown): string {
    if (typeof value === "string") return this.escapeMarkdown(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.valueToMarkdown(v)).join(", ")}]`;
    }
    if (value && typeof value === "object") {
      return `\`${this.escapeMarkdown(JSON.stringify(value))}\``;
    }
    return String(value);
  }
}
