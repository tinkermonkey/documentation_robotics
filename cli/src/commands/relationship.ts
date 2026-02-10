/**
 * Relationship subcommands for managing intra-layer relationships
 */

import { Command } from "commander";
import ansis from "ansis";
import { Model } from "../core/model.js";
import { findElementLayer } from "../utils/element-utils.js";
import { CLIError, ErrorCategory, handleError } from "../utils/errors.js";
import {
  getValidRelationships,
  getValidPredicatesForSource,
  getValidDestinationsForSourceAndPredicate,
} from "../generated/relationship-index.js";

/**
 * Validate element properties and construct a SpecNodeId
 * @throws {CLIError} if element properties are invalid
 */
function constructSpecNodeId(
  element: { layer_id?: unknown; type?: unknown },
  elementId: string
): string {
  const layerId = element.layer_id;
  const type = element.type;

  if (typeof layerId !== "string" || !layerId) {
    throw new CLIError(
      `Invalid element ${elementId}: missing or invalid layer_id`,
      ErrorCategory.SYSTEM
    );
  }

  if (typeof type !== "string" || !type) {
    throw new CLIError(
      `Invalid element ${elementId}: missing or invalid type`,
      ErrorCategory.SYSTEM
    );
  }

  return `${layerId}.${type}`;
}

/**
 * Validate a relationship combination using schema-driven registry
 * @returns {valid, suggestions} where suggestions are provided if invalid
 */
export function validateRelationshipCombination(
  sourceSpecNodeId: string,
  predicate: string,
  destSpecNodeId: string
): { valid: boolean; suggestions?: string[] } {
  const valid =
    getValidRelationships(sourceSpecNodeId, predicate, destSpecNodeId)
      .length > 0;

  if (valid) {
    return { valid: true };
  }

  // Generate helpful suggestions
  const suggestions: string[] = [];
  const validPredicates = getValidPredicatesForSource(sourceSpecNodeId);

  if (validPredicates.length > 0) {
    suggestions.push(
      `Valid predicates for ${sourceSpecNodeId}: ${validPredicates.join(", ")}`
    );
  } else {
    suggestions.push(`No valid relationships defined for ${sourceSpecNodeId}`);
  }

  // If predicate is provided, show valid destinations
  if (predicate) {
    const validDests = getValidDestinationsForSourceAndPredicate(
      sourceSpecNodeId,
      predicate
    );
    if (validDests.length > 0) {
      suggestions.push(
        `Valid destinations for --[${predicate}]-->: ${validDests.join(", ")}`
      );
    } else {
      suggestions.push(
        `No valid destinations for ${sourceSpecNodeId} --[${predicate}]-->`
      );
    }
  }

  return { valid: false, suggestions };
}

/**
 * Get cardinality and strength info for a relationship
 */
export function getRelationshipConstraints(
  sourceSpecNodeId: string,
  predicate: string,
  destSpecNodeId: string
): { cardinality: string; strength: string } | null {
  const rels = getValidRelationships(
    sourceSpecNodeId,
    predicate,
    destSpecNodeId
  );
  if (rels.length === 0) return null;

  const rel = rels[0];
  return {
    cardinality: rel.cardinality,
    strength: rel.strength,
  };
}

export function relationshipCommands(program: Command): void {
  program
    .command("add <source> <target>")
    .description("Add a relationship between elements")
    .requiredOption(
      "--predicate <predicate>",
      "Relationship predicate (e.g., depends-on, implements)"
    )
    .option("--properties <json>", "Relationship properties (JSON)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr relationship add business-service-a business-service-b --predicate depends-on
  $ dr relationship add api-endpoint-1 api-endpoint-2 --predicate "service-of"
  $ dr relationship add element-1 element-2 --predicate implements --properties '{"method":"REST"}'`
    )
    .action(async (source, target, options) => {
      try {
        // Load model
        const model = await Model.load();

        // Find source element
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find source element for schema validation
        const sourceLayer = await model.getLayer(sourceLayerName);
        if (!sourceLayer) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }
        const sourceElement = sourceLayer.getElement(source);
        if (!sourceElement) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find target element
        const targetLayerName = await findElementLayer(model, target);
        if (!targetLayerName) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }

        // Find target element for schema validation
        const targetLayer = await model.getLayer(targetLayerName);
        if (!targetLayer) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }
        const targetElement = targetLayer.getElement(target);
        if (!targetElement) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }

        // Relationships are intra-layer only
        if (sourceLayerName !== targetLayerName) {
          throw new CLIError(
            "cannot add cross-layer relationship. Relationships must be within the same layer.",
            ErrorCategory.USER
          );
        }

        // Schema-driven validation
        const sourceSpecNodeId = constructSpecNodeId(sourceElement, source);
        const targetSpecNodeId = constructSpecNodeId(targetElement, target);

        const validation = validateRelationshipCombination(
          sourceSpecNodeId,
          options.predicate,
          targetSpecNodeId
        );

        if (!validation.valid) {
          throw new CLIError(
            `Invalid relationship: ${source} --[${options.predicate}]--> ${target}`,
            ErrorCategory.USER,
            validation.suggestions
          );
        }

        // Get cardinality and strength info
        const constraints = getRelationshipConstraints(
          sourceSpecNodeId,
          options.predicate,
          targetSpecNodeId
        );

        // Parse properties if provided
        let properties: Record<string, unknown> | undefined;
        if (options.properties) {
          try {
            properties = JSON.parse(options.properties);
          } catch (e) {
            throw new CLIError("Invalid JSON in --properties", ErrorCategory.USER);
          }
        }

        // Add relationship to centralized relationships.yaml
        model.relationships.add({
          source,
          target,
          predicate: options.predicate,
          layer: sourceLayerName,
          category: "structural", // Default category
          properties,
        });

        // Save relationships
        await model.saveRelationships();
        await model.saveManifest();

        // Show cardinality and strength in output
        let message = `✓ Added relationship: ${ansis.bold(source)} ${options.predicate} ${ansis.bold(target)}`;
        if (constraints) {
          message += ansis.dim(
            ` (${constraints.cardinality}, ${constraints.strength} strength)`
          );
        }

        console.log(ansis.green(message));
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("delete <source> <target>")
    .description("Delete a relationship")
    .option(
      "--predicate <predicate>",
      "Specific predicate to delete (optional, delete all if not specified)"
    )
    .option("--force", "Skip confirmation prompt")
    .addHelpText(
      "after",
      `
Examples:
  $ dr relationship delete element-1 element-2 --predicate depends-on
  $ dr relationship delete element-1 element-2 --force`
    )
    .action(async (source, target, options) => {
      try {
        // Load model
        const model = await Model.load();

        // Find source element
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find relationships to delete
        const toDelete = model.relationships.find(source, target, options.predicate);

        if (toDelete.length === 0) {
          throw new CLIError("No matching relationships found", ErrorCategory.USER);
        }

        // Confirm deletion unless --force or non-interactive environment
        // In non-interactive environments (CI, tests), skip confirmation
        const isInteractive = process.stdin.isTTY && process.stdout.isTTY;
        if (!options.force && isInteractive) {
          // Dynamic import of prompts is safe here: caught by outer try-catch
          // This allows lazy loading of the prompt library only when needed
          const { confirm } = await import("@clack/prompts");
          const confirmed = await confirm({
            message: `Delete ${toDelete.length} relationship(s)? This cannot be undone.`,
            initialValue: false,
          });

          if (!confirmed) {
            console.log(ansis.dim("Cancelled"));
            return;
          }
        }

        // Delete relationships
        model.relationships.delete(source, target, options.predicate);

        // Save
        await model.saveRelationships();
        await model.saveManifest();

        console.log(
          ansis.green(
            `✓ Deleted ${toDelete.length} relationship(s) from ${ansis.bold(source)} to ${ansis.bold(target)}`
          )
        );
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("list <id>")
    .description("List relationships for an element")
    .option("--direction <dir>", "Filter by direction (incoming/outgoing/all)", "all")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr relationship list api-endpoint-create-customer
  $ dr relationship list business-service-order --direction outgoing
  $ dr relationship list element-1 --json`
    )
    .action(async (id, options) => {
      try {
        // Load model
        const model = await Model.load();
        const layerName = await findElementLayer(model, id);

        if (!layerName) {
          throw new CLIError(`Element ${id} not found`, ErrorCategory.USER);
        }

        // Get relationships from centralized store
        const { outgoing, incoming } = model.relationships.getForElement(id);

        // Filter by direction
        let relationships: typeof outgoing = [];
        if (options.direction === "outgoing" || options.direction === "all") {
          relationships.push(...outgoing);
        }
        if (options.direction === "incoming" || options.direction === "all") {
          relationships.push(...incoming);
        }

        if (options.json) {
          console.log(JSON.stringify(relationships, null, 2));
          return;
        }

        if (relationships.length === 0) {
          console.log(ansis.yellow(`No ${options.direction} relationships for ${id}`));
          return;
        }

        console.log("");
        console.log(
          ansis.bold(
            `${options.direction === "all" ? "" : options.direction + " "}relationships for ${ansis.cyan(id)}:`
          )
        );
        console.log(ansis.dim("─".repeat(80)));

        for (const rel of relationships) {
          const isOutgoing = rel.source === id;
          const direction = isOutgoing ? "→" : "←";
          const otherElement = isOutgoing ? rel.target : rel.source;

          console.log(
            `  ${direction} ${ansis.magenta(rel.predicate)}: ${ansis.yellow(otherElement)}`
          );

          if (rel.properties) {
            const propStr = Object.entries(rel.properties)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            console.log(`    ${ansis.dim(propStr)}`);
          }
        }

        console.log(ansis.dim("─".repeat(80)));
        console.log(ansis.dim(`Total: ${relationships.length} relationship(s)`));
        console.log("");
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("show <source> <target>")
    .description("Show relationship details")
    .addHelpText(
      "after",
      `
Examples:
  $ dr relationship show api-endpoint-create-customer business-service-customer-mgmt
  $ dr relationship show application-component-api motivation-goal-sales-efficiency`
    )
    .action(async (source, target) => {
      try {
        // Load model
        const model = await Model.load();
        const sourceLayerName = await findElementLayer(model, source);

        if (!sourceLayerName) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find relationships from centralized store
        const relationships = model.relationships.find(source, target);

        if (relationships.length === 0) {
          throw new CLIError(`No relationships from ${source} to ${target}`, ErrorCategory.USER);
        }

        console.log("");
        console.log(
          ansis.bold(
            `Relationship${relationships.length > 1 ? "s" : ""} from ${ansis.cyan(source)} to ${ansis.yellow(target)}:`
          )
        );
        console.log(ansis.dim("─".repeat(60)));

        for (let i = 0; i < relationships.length; i++) {
          const rel = relationships[i];

          if (i > 0) {
            console.log("");
          }

          console.log(`Predicate: ${ansis.magenta(rel.predicate)}`);

          if (rel.properties && Object.keys(rel.properties).length > 0) {
            console.log("Properties:");
            for (const [key, value] of Object.entries(rel.properties)) {
              const displayValue =
                typeof value === "string" ? value : JSON.stringify(value, null, 2);
              console.log(`  ${ansis.cyan(key)}: ${displayValue}`);
            }
          } else {
            console.log("Properties: none");
          }
        }

        console.log("");
      } catch (error) {
        handleError(error);
      }
    });
}
