/**
 * Conformance Command - Validates model against layer specifications
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { getAllLayerIds, getSpecNodeTypesForLayer, getLayerById } from "../generated/index.js";
import { RELATIONSHIPS_BY_SOURCE } from "../generated/relationship-index.js";
import { getErrorMessage } from "../utils/errors.js";

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

interface CrossLayerRelSpec {
  target: string;
  relationship: string;
  /** Element types (e.g. "businessrole") in the source layer that support this predicate */
  sourceTypes: string[];
  /** Element types (e.g. "stakeholder") in the target layer that can receive this predicate */
  destTypes: string[];
}

/**
 * Get expected cross-layer relationships per layer.
 * Returns per-predicate specs that include which element types must exist in both layers,
 * so the conformance check can skip gaps that are not yet achievable.
 */
function getLayerCrossLayerRelationships(): Record<string, CrossLayerRelSpec[]> {
  const relationships: Record<string, CrossLayerRelSpec[]> = {};
  const layers = getAllLayerIds();

  for (const sourceLayerId of layers) {
    const sourceLayer = getLayerById(sourceLayerId);
    if (!sourceLayer) continue;

    const specMap = new Map<string, CrossLayerRelSpec>();
    const sourceNodeTypes = getSpecNodeTypesForLayer(sourceLayerId);

    for (const sourceNodeType of sourceNodeTypes) {
      const rels = RELATIONSHIPS_BY_SOURCE.get(sourceNodeType) || [];
      const sourceElemType = sourceNodeType.split(".")[1] || "";

      for (const rel of rels) {
        const parts = rel.destinationSpecNodeId.split(".");
        const destLayerId = parts[0];
        const destElemType = parts[1] || "";

        if (destLayerId && destLayerId !== sourceLayerId) {
          const key = `${destLayerId}:${rel.predicate}`;
          if (!specMap.has(key)) {
            specMap.set(key, {
              target: destLayerId,
              relationship: rel.predicate,
              sourceTypes: [],
              destTypes: [],
            });
          }
          const spec = specMap.get(key)!;
          if (sourceElemType && !spec.sourceTypes.includes(sourceElemType)) {
            spec.sourceTypes.push(sourceElemType);
          }
          if (destElemType && !spec.destTypes.includes(destElemType)) {
            spec.destTypes.push(destElemType);
          }
        }
      }
    }

    relationships[sourceLayerId] = Array.from(specMap.values());
  }

  return relationships;
}

const LAYER_RELATIONSHIPS = getLayerCrossLayerRelationships();

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
        if (!element.name && !element.description) {
          issues.push({
            severity: "warning",
            message: `Element ${element.path || element.id} should have a name or description`,
          });
        }
      }

      // Check 3: Cross-layer relationships are documented
      const expectedRelationships = LAYER_RELATIONSHIPS[layerName] || [];

      // Get all relationships for this layer
      const allRelationships = model.relationships.getAll();
      const layerRelationships = allRelationships.filter((rel) => rel.layer === layerName);

      // Validate expected cross-layer relationships exist, but only when the required
      // element types are present in both layers — avoids flooding output with gaps
      // that can't yet be closed given the current model content.
      for (const expectedRel of expectedRelationships) {
        // If catalog metadata is incomplete (empty type lists), fall back to always
        // checking — missing metadata should not silently suppress real gaps.
        const hasSourceTypeMeta = expectedRel.sourceTypes.length > 0;
        const hasDestTypeMeta = expectedRel.destTypes.length > 0;

        // Skip if none of the source element types exist in this layer
        if (hasSourceTypeMeta && !expectedRel.sourceTypes.some((t) => presentTypes.has(t))) continue;

        // Skip if none of the dest element types exist in the target layer
        const targetLayer = model.layers.get(expectedRel.target);
        const targetPresentTypes = new Set(
          (targetLayer?.listElements() ?? []).map((e) => e.type)
        );
        if (hasDestTypeMeta && !expectedRel.destTypes.some((t) => targetPresentTypes.has(t))) continue;

        const hasRelationship = layerRelationships.some(
          (rel) =>
            rel.predicate === expectedRel.relationship &&
            rel.targetLayer === expectedRel.target
        );

        if (!hasRelationship) {
          issues.push({
            severity: "warning",
            message: `Expected relationship to ${expectedRel.target}: ${expectedRel.relationship} not found`,
          });
        }
      }

      // Populate results
      results[layerName] = {
        compliant: issues.filter((i) => i.severity === "error").length === 0,
        issues,
        stats: {
          elementCount: elements.length,
          elementTypes: presentTypes.size,
          relationshipCount: layerRelationships.length,
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
        // Compliant layers may still have warnings — show them in verbose mode
        if (options.verbose && result.issues.length > 0) {
          for (const issue of result.issues) {
            const prefix =
              issue.severity === "error" ? ansis.red("[ERROR]") : ansis.yellow("[WARNING]");
            console.log(ansis.dim(`  ${prefix} ${issue.message}`));
          }
        }
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
    console.error(ansis.red(`Error: ${getErrorMessage(error)}`));
    process.exit(1);
  }
}
