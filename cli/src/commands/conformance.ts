/**
 * Conformance Command - Validates model against layer specifications
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { getAllLayerIds, getSpecNodeTypesForLayer } from "../generated/index.js";

/**
 * Expected element types per layer (derived from generated registry)
 */
function getLayerElementTypes(): Record<string, string[]> {
  const layerTypes: Record<string, string[]> = {};
  const layers = getAllLayerIds();
  for (const layer of layers) {
    layerTypes[layer] = getSpecNodeTypesForLayer(layer).map((t) => {
      // Extract element type from spec node ID (e.g., "motivation.goal" -> "goal")
      return t.split(".")[1] || "";
    }).filter(Boolean);
  }
  return layerTypes;
}

const LAYER_ELEMENT_TYPES = getLayerElementTypes();

/**
 * Expected cross-layer relationships per layer
 */
const LAYER_RELATIONSHIPS: Record<
  string,
  Array<{
    target: string;
    relationship: string;
  }>
> = {
  business: [{ target: "motivation", relationship: "realizes" }],
  application: [
    { target: "business", relationship: "realizes" },
    { target: "security", relationship: "uses" },
  ],
  technology: [
    { target: "application", relationship: "hosts" },
    { target: "security", relationship: "implements" },
  ],
  api: [{ target: "application", relationship: "exposes" }],
  "data-model": [{ target: "application", relationship: "used-by" }],
  "data-store": [
    { target: "technology", relationship: "runs-on" },
    { target: "data-model", relationship: "implements" },
  ],
  ux: [
    { target: "application", relationship: "implements" },
    { target: "navigation", relationship: "uses" },
  ],
  navigation: [{ target: "ux", relationship: "defines" }],
  apm: [
    { target: "technology", relationship: "monitors" },
    { target: "application", relationship: "monitors" },
  ],
  testing: [
    { target: "application", relationship: "tests" },
    { target: "api", relationship: "tests" },
  ],
};

interface ConformanceIssue {
  severity: "error" | "warning";
  message: string;
}

interface ConformanceResult {
  compliant: boolean;
  issues: ConformanceIssue[];
  stats: {
    elementCount: number;
    elementTypes: number;
    relationshipCount: number;
  };
}

export async function conformanceCommand(options: {
  layers?: string[];
  json?: boolean;
  verbose?: boolean;
}): Promise<void> {
  try {
    const model = await Model.load(process.cwd(), { lazyLoad: false });

    if (!options.json) {
      console.log(ansis.bold("\nChecking conformance to layer specifications...\n"));
    }

    const results: Record<string, ConformanceResult> = {};

    let totalIssues = 0;
    let compliantLayers = 0;

    for (const [layerName, layer] of model.layers) {
      // Skip if specific layers requested
      if (options.layers && !options.layers.includes(layerName)) {
        continue;
      }

      const issues: ConformanceIssue[] = [];
      const elements = layer.listElements();

      // Check 1: Required element types
      const expectedTypes = LAYER_ELEMENT_TYPES[layerName] || [];
      const presentTypes = new Set(elements.map((e) => e.type));
      const missingTypes: string[] = [];

      for (const expectedType of expectedTypes) {
        if (!presentTypes.has(expectedType)) {
          missingTypes.push(expectedType);
        }
      }

      if (missingTypes.length > 0) {
        issues.push({
          severity: "warning",
          message: `Missing element types: ${missingTypes.join(", ")}`,
        });
      }

      // Check 2: Elements have required properties
      for (const element of elements) {
        // Require id and type
        if (!element.id) {
          issues.push({
            severity: "error",
            message: `Element missing required property: id`,
          });
        }

        if (!element.type) {
          issues.push({
            severity: "error",
            message: `Element missing required property: type`,
          });
        }

        // Check for name field (recommended in v0.4.0+)
        if (!element.properties.name && !element.properties.description) {
          issues.push({
            severity: "warning",
            message: `Element ${element.id} should have a name or description`,
          });
        }
      }

      // Check 3: Cross-layer relationships are documented
      const expectedRelationships = LAYER_RELATIONSHIPS[layerName] || [];

      // Validate expected cross-layer relationships exist
      // Note: The relationship registry would be accessed in production
      // This check documents which relationships are expected per layer specification
      for (const expectedRel of expectedRelationships) {
        // In a full implementation, check model.relationshipRegistry for actual relationships
        // For now, just document that the layer has expected cross-layer relationships defined
        issues.push({
          severity: "warning",
          message: `Expected relationship to ${expectedRel.target}: ${expectedRel.relationship}`,
        });
      }

      // Populate results
      results[layerName] = {
        compliant: issues.filter((i) => i.severity === "error").length === 0,
        issues,
        stats: {
          elementCount: elements.length,
          elementTypes: presentTypes.size,
          relationshipCount: 0, // Would be populated from relationship registry
        },
      };

      if (results[layerName].compliant) {
        compliantLayers++;
      }

      totalIssues += issues.length;
    }

    // Output as JSON if requested
    if (options.json) {
      const jsonOutput = {
        conformance: {
          compliant: compliantLayers === Object.keys(results).length,
          compliantLayers,
          totalLayers: Object.keys(results).length,
          totalIssues,
          layers: results,
        },
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Display results
    console.log(ansis.dim("Layer conformance:"));
    console.log();

    for (const [layerName, result] of Object.entries(results)) {
      if (result.compliant) {
        console.log(ansis.green(`✓ ${layerName}`));
      } else {
        console.log(ansis.red(`✗ ${layerName} - ${result.issues.length} issue(s)`));

        if (options.verbose) {
          for (const issue of result.issues) {
            const prefix =
              issue.severity === "error" ? ansis.red("[ERROR]") : ansis.yellow("[WARNING]");
            console.log(ansis.dim(`  ${prefix} ${issue.message}`));
          }
        }
      }

      console.log(
        ansis.dim(`  Elements: ${result.stats.elementCount}, Types: ${result.stats.elementTypes}`)
      );
      console.log();
    }

    // Summary
    console.log(ansis.dim("Summary:"));
    console.log(ansis.dim(`  Compliant layers: ${compliantLayers}/${Object.keys(results).length}`));
    console.log(ansis.dim(`  Total issues: ${totalIssues}`));
    console.log();

    if (totalIssues === 0) {
      console.log(ansis.green(`✓ Model is fully conformant`));
    } else {
      console.log(
        ansis.yellow(`⚠ Model has conformance issues. Run 'dr validate' for more details.`)
      );
    }

    console.log();
  } catch (error) {
    console.error(ansis.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
