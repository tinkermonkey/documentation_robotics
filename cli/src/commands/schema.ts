/**
 * Schema introspection commands for viewing layer and type metadata
 * Provides detailed schema information directly from generated registries
 */

import ansis from "ansis";
import { CLIError, ErrorCategory, handleError } from "../utils/errors.js";
import {
  getAllLayerIds,
  getLayerById,
} from "../generated/layer-registry.js";
import {
  getNodeType,
  getNodeTypesForLayer,
  type SpecNodeId,
  isValidSpecNodeId,
} from "../generated/node-types.js";
import {
  getValidRelationships,
  type RelationshipSpec,
} from "../generated/relationship-index.js";
import { Command } from "commander";

/**
 * dr schema layers - List all layers with node type counts
 */
export async function schemaLayersCommand(): Promise<void> {
  try {
    console.log(ansis.bold("\nArchitecture Layers:\n"));

    for (const layerId of getAllLayerIds()) {
      const layer = getLayerById(layerId);
      if (!layer) continue;

      const nodeTypes = getNodeTypesForLayer(layerId);

      console.log(
        ansis.cyan(`${layer.number}. ${layer.name}`) +
          ansis.gray(` (${layerId})`)
      );
      console.log(`   ${layer.description}`);
      console.log(
        `   Node types: ${ansis.yellow(nodeTypes.length.toString())}`
      );

      if (layer.inspiredBy) {
        console.log(
          `   Standard: ${layer.inspiredBy.standard} ${layer.inspiredBy.version}`
        );
      }

      console.log();
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr schema types <layer> - List valid types for a layer
 */
export async function schemaTypesCommand(layerId: string): Promise<void> {
  try {
    const layer = getLayerById(layerId);

    if (!layer) {
      const validLayers = getAllLayerIds().join(", ");
      throw new CLIError(
        `Unknown layer: ${layerId}`,
        ErrorCategory.USER,
        [`Valid layers: ${validLayers}`]
      );
    }

    const nodeTypes = getNodeTypesForLayer(layerId);

    console.log(ansis.bold(`\nNode Types for ${layer.name}:\n`));

    for (const nodeType of nodeTypes) {
      console.log(
        ansis.cyan(`  ${nodeType.type}`) +
          ansis.gray(` (${nodeType.specNodeId})`)
      );
      console.log(`    ${nodeType.title}`);

      if (
        nodeType.requiredAttributes &&
        nodeType.requiredAttributes.length > 0
      ) {
        console.log(
          `    Required: ${ansis.yellow(nodeType.requiredAttributes.join(", "))}`
        );
      }

      if (
        nodeType.optionalAttributes &&
        nodeType.optionalAttributes.length > 0
      ) {
        console.log(
          `    Optional: ${ansis.gray(nodeType.optionalAttributes.join(", "))}`
        );
      }

      console.log();
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr schema node <spec_node_id> - Show node schema details
 */
export async function schemaNodeCommand(specNodeId: string): Promise<void> {
  try {
    if (!isValidSpecNodeId(specNodeId)) {
      throw new CLIError(
        `Invalid spec node ID format: ${specNodeId}`,
        ErrorCategory.USER,
        ["Expected format: {layer}.{type} (e.g., motivation.goal, api.endpoint)"]
      );
    }

    const nodeType = getNodeType(specNodeId);

    if (!nodeType) {
      throw new CLIError(
        `Unknown node type: ${specNodeId}`,
        ErrorCategory.USER,
        ["Use `dr schema types <layer>` to list valid types"]
      );
    }

    console.log(ansis.bold(`\n${nodeType.title}\n`));
    console.log(`Spec Node ID: ${ansis.cyan(nodeType.specNodeId)}`);
    console.log(`Layer: ${nodeType.layer}`);
    console.log(`Type: ${nodeType.type}`);
    console.log();

    if (
      nodeType.requiredAttributes &&
      nodeType.requiredAttributes.length > 0
    ) {
      console.log(ansis.yellow("Required Attributes:"));
      for (const attr of nodeType.requiredAttributes) {
        const constraint = nodeType.attributeConstraints?.[attr];
        console.log(`  - ${attr}: ${formatAttributeConstraint(constraint)}`);
      }
      console.log();
    }

    if (
      nodeType.optionalAttributes &&
      nodeType.optionalAttributes.length > 0
    ) {
      console.log(ansis.gray("Optional Attributes:"));
      for (const attr of nodeType.optionalAttributes) {
        const constraint = nodeType.attributeConstraints?.[attr];
        console.log(`  - ${attr}: ${formatAttributeConstraint(constraint)}`);
      }
      console.log();
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr schema relationship <source_type> [predicate] - Show valid relationships
 */
export async function schemaRelationshipCommand(
  sourceType: string,
  predicate?: string
): Promise<void> {
  try {
    if (!isValidSpecNodeId(sourceType)) {
      throw new CLIError(
        `Invalid spec node ID format: ${sourceType}`,
        ErrorCategory.USER,
        ["Expected format: {layer}.{type} (e.g., motivation.goal, api.endpoint)"]
      );
    }

    const relationships = predicate
      ? getValidRelationships(sourceType, predicate)
      : getValidRelationships(sourceType);

    if (relationships.length === 0) {
      const msg = predicate
        ? `No relationships found for ${sourceType} --[${predicate}]-->`
        : `No relationships found for ${sourceType}`;
      console.log(msg);
      return;
    }

    console.log(
      ansis.bold(`\nValid Relationships for ${sourceType}:\n`)
    );

    // Group by predicate
    const byPredicate = new Map<string, RelationshipSpec[]>();
    for (const rel of relationships) {
      if (!byPredicate.has(rel.predicate)) {
        byPredicate.set(rel.predicate, []);
      }
      const predicateRels = byPredicate.get(rel.predicate);
      if (predicateRels) {
        predicateRels.push(rel);
      }
    }

    for (const [pred, rels] of byPredicate) {
      console.log(ansis.cyan(`  --[${pred}]-->`));

      for (const rel of rels) {
        const strength = formatStrength(rel.strength);
        const cardinality = ansis.gray(`(${rel.cardinality})`);
        console.log(
          `    ${rel.destinationSpecNodeId} ${strength} ${cardinality}`
        );
      }

      console.log();
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * Format attribute constraint for display
 */
function formatAttributeConstraint(constraint: unknown): string {
  if (!constraint) return "any";

  if (typeof constraint === "string") {
    return constraint;
  }

  const c = constraint as Record<string, unknown>;

  if (c.type) {
    let result = String(c.type);

    if (c.enum && Array.isArray(c.enum)) {
      result += ` [${c.enum.join(" | ")}]`;
    }

    if (c.pattern) {
      result += ` (pattern: ${c.pattern})`;
    }

    return result;
  }

  return "object";
}

/**
 * Format relationship strength with color
 */
function formatStrength(strength: string): string {
  const colors: Record<string, (s: string) => string> = {
    critical: (s: string) => ansis.red(s),
    high: (s: string) => ansis.yellow(s),
    medium: (s: string) => ansis.blue(s),
    low: (s: string) => ansis.gray(s),
  };

  return colors[strength]?.(strength) || strength;
}

/**
 * Register schema commands with commander
 */
export function schemaCommands(program: Command): void {
  const schemaCmd = program
    .command("schema")
    .description("Inspect schema metadata (layers, types, relationships)");

  schemaCmd
    .command("layers")
    .description("List all layers with node type counts")
    .action(schemaLayersCommand);

  schemaCmd
    .command("types <layer>")
    .description("List valid node types for a layer")
    .action(schemaTypesCommand);

  schemaCmd
    .command("node <spec_node_id>")
    .description("Show detailed schema for a node type")
    .action(schemaNodeCommand);

  schemaCmd
    .command("relationship <source_type> [predicate]")
    .description("Show valid relationships for a node type")
    .action(schemaRelationshipCommand);
}
