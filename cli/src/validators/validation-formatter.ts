/**
 * Validation formatter for detailed and actionable output
 */

import ansis from "ansis";
import type { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { formatLayerName } from "../utils/layer-name-mapping.js";

interface ValidationStats {
  totalElements: number;
  totalRelationships: number;
  elementsPerLayer: Record<string, number>;
  relationshipsByPredicate: Record<string, number>;
  orphanedElements: string[];
}

/**
 * Formats validation results into detailed, human-readable output
 */
export class ValidationFormatter {
  /**
   * Format validation result for display
   */
  static format(
    result: ValidationResult,
    model: Model,
    options: {
      verbose?: boolean;
      quiet?: boolean;
    } = {}
  ): string {
    if (options.quiet) {
      return this.formatQuiet(result);
    }

    if (options.verbose) {
      return this.formatVerbose(result, model);
    }

    return this.formatStandard(result, model);
  }

  /**
   * Format quiet output (minimal)
   */
  private static formatQuiet(result: ValidationResult): string {
    if (result.isValid() && result.warnings.length === 0) {
      return ansis.green("✓ Validation passed");
    }

    const lines: string[] = [];

    if (result.errors.length > 0) {
      lines.push(ansis.red(`✗ ${result.errors.length} error(s)`));
    }

    if (result.warnings.length > 0) {
      lines.push(ansis.yellow(`⚠ ${result.warnings.length} warning(s)`));
    }

    return lines.join(" ");
  }

  /**
   * Format standard output (enhanced with stats)
   */
  private static formatStandard(result: ValidationResult, model: Model): string {
    const lines: string[] = [];

    lines.push("");
    lines.push(ansis.bold("Validating Documentation Robotics Model"));
    lines.push(ansis.bold("========================================"));
    lines.push("");

    // Layer-by-layer validation summary
    lines.push(ansis.bold("Schema Validation:"));
    const layerStats = this.getLayerStats(model);
    for (const [layerName, count] of Object.entries(layerStats)) {
      const hasErrors = result.errors.some((e) => e.layer === layerName);
      if (hasErrors) {
        const errorCount = result.errors.filter((e) => e.layer === layerName).length;
        lines.push(
          `${ansis.red("✗")} ${this.formatLayerName(layerName)} (${count} elements) - ${errorCount} error(s)`
        );
      } else {
        lines.push(`${ansis.green("✓")} ${this.formatLayerName(layerName)} (${count} elements)`);
      }
    }

    lines.push("");

    // Cross-layer validation
    lines.push(ansis.bold("Cross-Layer Validation:"));
    const stats = this.calculateStats(model);
    lines.push(
      `${ansis.green("✓")} ${stats.totalRelationships} cross-layer relationships validated`
    );

    if (stats.orphanedElements.length > 0) {
      lines.push(
        `${ansis.yellow("⚠")} ${stats.orphanedElements.length} potentially orphaned element(s)`
      );
    } else {
      lines.push(`${ansis.green("✓")} No orphaned elements detected`);
    }

    lines.push("");

    // Error details
    if (result.errors.length > 0) {
      lines.push(ansis.bold("Errors:"));
      lines.push("");
      result.errors.forEach((error, index) => {
        lines.push(`${index + 1}. ${error.message}`);
        if (error.location) {
          lines.push(`   ${ansis.dim(`File: ${error.location}`)}`);
        }
        if (error.elementId) {
          lines.push(`   ${ansis.dim(`Element: ${error.elementId}`)}`);
        }
        if (error.fixSuggestion) {
          lines.push(`   ${ansis.dim(`→ Suggestion: ${error.fixSuggestion}`)}`);
        }
        lines.push("");
      });
    }

    // Warning details
    if (result.warnings.length > 0) {
      lines.push(ansis.bold("Warnings:"));
      lines.push("");
      result.warnings.forEach((warning, index) => {
        lines.push(`${index + 1}. ${warning.message}`);
        if (warning.location) {
          lines.push(`   ${ansis.dim(`File: ${warning.location}`)}`);
        }
        if (warning.elementId) {
          lines.push(`   ${ansis.dim(`Element: ${warning.elementId}`)}`);
        }
        if (warning.fixSuggestion) {
          lines.push(`   ${ansis.dim(`→ Suggestion: ${warning.fixSuggestion}`)}`);
        }
        lines.push("");
      });
    }

    // Summary
    lines.push(ansis.bold("Summary:"));
    lines.push(
      `${result.errors.length === 0 ? ansis.green("✓") : ansis.red("✗")} ${stats.totalElements} total elements validated`
    );
    lines.push(`${ansis.green("✓")} ${stats.totalRelationships} relationships validated`);
    lines.push(`${ansis.green("✓")} ${Object.keys(layerStats).length} layers validated`);
    lines.push(
      `${result.errors.length === 0 ? ansis.green("✓") : ansis.red("✗")} ${result.errors.length} error(s), ${result.warnings.length} warning(s)`
    );
    lines.push("");

    if (result.isValid()) {
      if (result.warnings.length === 0) {
        lines.push(ansis.green("Model is valid and ready for use."));
      } else {
        lines.push(ansis.yellow("Model is valid but consider addressing warnings."));
      }
    } else {
      lines.push(ansis.red("Model validation failed. Please fix errors before proceeding."));
    }

    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format verbose output (detailed with relationship breakdown)
   */
  private static formatVerbose(result: ValidationResult, model: Model): string {
    const standard = this.formatStandard(result, model);
    const lines = standard.split("\n");

    // Find the "Cross-Layer Validation:" section and expand it
    const crossLayerIndex = lines.findIndex((l) => l.includes("Cross-Layer Validation:"));
    if (crossLayerIndex >= 0) {
      const stats = this.calculateStats(model);
      const relationshipLines: string[] = [];

      // Add breakdown by relationship type
      if (Object.keys(stats.relationshipsByPredicate).length > 0) {
        relationshipLines.push("");
        relationshipLines.push(ansis.dim("Relationship breakdown:"));
        for (const [predicate, count] of Object.entries(stats.relationshipsByPredicate).sort()) {
          relationshipLines.push(ansis.dim(`  • ${predicate}: ${count} relationship(s)`));
        }
      }

      // Insert after the cross-layer section
      lines.splice(crossLayerIndex + 4, 0, ...relationshipLines);
    }

    return lines.join("\n");
  }

  /**
   * Get statistics about layers
   */
  private static getLayerStats(model: Model): Record<string, number> {
    const stats: Record<string, number> = {};

    for (const [layerName, layer] of model.layers) {
      const count = layer.listElements().length;
      if (count > 0) {
        stats[layerName] = count;
      }
    }

    return stats;
  }

  /**
   * Calculate validation statistics
   */
  private static calculateStats(model: Model): ValidationStats {
    const stats: ValidationStats = {
      totalElements: 0,
      totalRelationships: 0,
      elementsPerLayer: {},
      relationshipsByPredicate: {},
      orphanedElements: [],
    };

    const elementIds = new Set<string>();
    const elementRelationships = new Map<string, number>();

    // Count elements and relationships
    for (const [layerName, layer] of model.layers) {
      let layerCount = 0;
      for (const element of layer.listElements()) {
        elementIds.add(element.id);
        layerCount++;
        stats.totalElements++;

        // Count relationships
        const refCount = (element.references || []).length;
        elementRelationships.set(element.id, refCount);
        stats.totalRelationships += refCount;

        // Track relationship predicates
        for (const ref of element.references || []) {
          const predicate = ref.type || "references";
          stats.relationshipsByPredicate[predicate] =
            (stats.relationshipsByPredicate[predicate] || 0) + 1;
        }
      }

      if (layerCount > 0) {
        stats.elementsPerLayer[layerName] = layerCount;
      }
    }

    // Find orphaned elements (no relationships in or out)
    for (const elementId of elementIds) {
      const outgoing = elementRelationships.get(elementId) || 0;

      // Count incoming relationships
      let incoming = 0;
      for (const [, layer] of model.layers) {
        for (const element of layer.listElements()) {
          for (const ref of element.references || []) {
            if (ref.target === elementId) {
              incoming++;
            }
          }
        }
      }

      if (outgoing === 0 && incoming === 0) {
        stats.orphanedElements.push(elementId);
      }
    }

    return stats;
  }

  /**
   * Format layer name for display
   */
  private static formatLayerName(layerName: string): string {
    return formatLayerName(layerName);
  }

  /**
   * Export validation result as JSON
   */
  static toJSON(result: ValidationResult, model: Model): Record<string, unknown> {
    const stats = this.calculateStats(model);
    const layerStats = this.getLayerStats(model);

    return {
      valid: result.isValid(),
      summary: {
        totalElements: stats.totalElements,
        totalRelationships: stats.totalRelationships,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        layersValidated: Object.keys(layerStats).length,
      },
      layerStats,
      relationshipsByPredicate: stats.relationshipsByPredicate,
      orphanedElements: stats.orphanedElements,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  /**
   * Export validation result as Markdown
   */
  static toMarkdown(result: ValidationResult, model: Model): string {
    const lines: string[] = [];
    const stats = this.calculateStats(model);
    const layerStats = this.getLayerStats(model);

    lines.push("# Validation Report");
    lines.push("");
    lines.push(`**Status**: ${result.isValid() ? "✓ Valid" : "✗ Invalid"}`);
    lines.push(`**Generated**: ${new Date().toISOString()}`);
    lines.push("");

    lines.push("## Summary");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Elements | ${stats.totalElements} |`);
    lines.push(`| Total Relationships | ${stats.totalRelationships} |`);
    lines.push(`| Layers Validated | ${Object.keys(layerStats).length} |`);
    lines.push(`| Errors | ${result.errors.length} |`);
    lines.push(`| Warnings | ${result.warnings.length} |`);
    lines.push("");

    lines.push("## Layer Statistics");
    lines.push("");
    for (const [layerName, count] of Object.entries(layerStats)) {
      const hasErrors = result.errors.some((e) => e.layer === layerName);
      const status = hasErrors ? "✗" : "✓";
      lines.push(`- ${status} ${layerName}: ${count} elements`);
    }
    lines.push("");

    if (result.errors.length > 0) {
      lines.push("## Errors");
      lines.push("");
      result.errors.forEach((error, index) => {
        lines.push(`### ${index + 1}. ${error.message}`);
        lines.push("");
        if (error.location) {
          lines.push(`**File**: \`${error.location}\``);
        }
        if (error.elementId) {
          lines.push(`**Element**: \`${error.elementId}\``);
        }
        if (error.fixSuggestion) {
          lines.push(`**Suggestion**: ${error.fixSuggestion}`);
        }
        lines.push("");
      });
    }

    if (result.warnings.length > 0) {
      lines.push("## Warnings");
      lines.push("");
      result.warnings.forEach((warning, index) => {
        lines.push(`### ${index + 1}. ${warning.message}`);
        lines.push("");
        if (warning.location) {
          lines.push(`**File**: \`${warning.location}\``);
        }
        if (warning.elementId) {
          lines.push(`**Element**: \`${warning.elementId}\``);
        }
        if (warning.fixSuggestion) {
          lines.push(`**Suggestion**: ${warning.fixSuggestion}`);
        }
        lines.push("");
      });
    }

    return lines.join("\n");
  }
}
