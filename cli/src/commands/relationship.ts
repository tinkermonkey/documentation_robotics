/**
 * Relationship subcommands for managing intra-layer and cross-layer relationships
 */

import { Command } from "commander";
import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { findElementLayer } from "../utils/element-utils.js";
import { isValidLayerName } from "../core/layers.js";
import { CLIError, ErrorCategory, handleError, getErrorMessage } from "../utils/errors.js";
import {
  getValidRelationships,
  getValidPredicatesForSource,
  getValidDestinationsForSourceAndPredicate,
} from "../generated/relationship-index.js";
import { normalizeNodeType } from "../generated/node-types.js";
import { ModelReportOrchestrator } from "../reports/model-report-orchestrator.js";
import { emitLog, SeverityNumber } from "../telemetry/index.js";

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

  // Normalize type name for schema validation (e.g., "process" -> "businessprocess")
  const normalizedType = normalizeNodeType(layerId, type);

  return `${layerId}.${normalizedType}`;
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

/**
 * Handler function for adding a relationship
 * Encapsulates the core logic of the add-relationship command
 * @internal Exported for testing purposes
 */
export async function addRelationshipHandler(
  model: Model,
  source: string,
  target: string,
  predicate: string,
  properties?: Record<string, unknown>
): Promise<void> {
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

  // Schema-driven validation
  const sourceSpecNodeId = constructSpecNodeId(sourceElement, source);
  const targetSpecNodeId = constructSpecNodeId(targetElement, target);

  const validation = validateRelationshipCombination(
    sourceSpecNodeId,
    predicate,
    targetSpecNodeId
  );

  if (!validation.valid) {
    throw new CLIError(
      `Invalid relationship: ${source} --[${predicate}]--> ${target}`,
      ErrorCategory.USER,
      validation.suggestions
    );
  }

  // Check for active changeset — stage relationship instead of writing directly
  const stagingManager = new StagingAreaManager(model.rootPath, model);
  const activeChangesetId = await stagingManager.getActiveId();

  const relData = {
    source,
    target,
    predicate,
    layer: sourceLayerName,
    ...(targetLayerName !== sourceLayerName ? { targetLayer: targetLayerName } : {}),
    category: "structural" as const,
    ...(properties ? { properties } : {}),
  };

  if (activeChangesetId) {
    // Stage the relationship change in the active changeset
    const compositeKey = `${source}::${predicate}::${target}`;
    await stagingManager.stage(activeChangesetId, {
      type: "relationship-add",
      elementId: compositeKey,
      layerName: sourceLayerName,
      after: relData,
    });
  } else {
    // No active changeset — write directly to relationships.yaml
    model.relationships.add(relData);
    await model.saveRelationships();
    await model.saveManifest();

    // Regenerate reports for all affected layers (including transitively related)
    try {
      const orchestrator = new ModelReportOrchestrator(model, model.rootPath);
      const affectedLayers = new Set<string>();

      // Compute affected layers for source layer
      if (isValidLayerName(sourceLayerName)) {
        for (const layer of orchestrator.computeAffectedLayers(sourceLayerName)) {
          affectedLayers.add(layer);
        }
      }

      // Compute affected layers for target layer
      if (isValidLayerName(targetLayerName)) {
        for (const layer of orchestrator.computeAffectedLayers(targetLayerName)) {
          affectedLayers.add(layer);
        }
      }

      await orchestrator.regenerate(affectedLayers);
    } catch (error) {
      emitLog(
        SeverityNumber.WARN,
        "Failed to regenerate layer reports after relationship add",
        {
          "relationship.predicate": predicate,
          "relationship.sourceLayer": sourceLayerName,
          "relationship.targetLayer": targetLayerName,
          "relationship.source": source,
          "relationship.target": target,
          "error.message": getErrorMessage(error),
        }
      );
    }
  }
}

/**
 * Handler function for deleting relationships
 * Encapsulates the core logic of the delete-relationship command
 * @internal Exported for testing purposes
 */
export async function deleteRelationshipHandler(
  model: Model,
  source: string,
  target: string,
  predicate?: string
): Promise<{ deletedCount: number }> {
  // Find source element
  const sourceLayerName = await findElementLayer(model, source);
  if (!sourceLayerName) {
    throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
  }

  // Find relationships to delete
  const toDelete = model.relationships.find(source, target, predicate);

  if (toDelete.length === 0) {
    throw new CLIError("No matching relationships found", ErrorCategory.USER);
  }

  // Check for active changeset — stage deletion instead of writing directly
  const stagingManager = new StagingAreaManager(model.rootPath, model);
  const activeChangesetId = await stagingManager.getActiveId();

  if (activeChangesetId) {
    // Stage each relationship deletion in the active changeset
    for (const rel of toDelete) {
      const compositeKey = `${rel.source}::${rel.predicate}::${rel.target}`;
      await stagingManager.stage(activeChangesetId, {
        type: "relationship-delete",
        elementId: compositeKey,
        layerName: rel.layer,
        before: {
          source: rel.source,
          target: rel.target,
          predicate: rel.predicate,
          layer: rel.layer,
          ...(rel.targetLayer ? { targetLayer: rel.targetLayer } : {}),
          ...(rel.properties ? { properties: rel.properties } : {}),
        },
      });
    }
  } else {
    // No active changeset — write directly
    model.relationships.delete(source, target, predicate);
    await model.saveRelationships();
    await model.saveManifest();

    // Regenerate reports for all affected layers (including transitively related)
    try {
      const orchestrator = new ModelReportOrchestrator(model, model.rootPath);
      const affectedLayers = new Set<string>();

      // Compute affected layers for each deleted relationship's source and target
      for (const rel of toDelete) {
        // Compute affected layers for source layer
        if (rel.layer && isValidLayerName(rel.layer)) {
          for (const layer of orchestrator.computeAffectedLayers(rel.layer)) {
            affectedLayers.add(layer);
          }
        }

        // Compute affected layers for target layer
        if (rel.targetLayer && isValidLayerName(rel.targetLayer)) {
          for (const layer of orchestrator.computeAffectedLayers(rel.targetLayer)) {
            affectedLayers.add(layer);
          }
        }
      }

      await orchestrator.regenerate(affectedLayers);
    } catch (error) {
      emitLog(
        SeverityNumber.WARN,
        "Failed to regenerate layer reports after relationship delete",
        {
          "relationship.predicate": predicate,
          "relationship.source": source,
          "relationship.target": target,
          "relationship.deleteCount": toDelete.length,
          "error.message": getErrorMessage(error),
        }
      );
    }
  }

  return { deletedCount: toDelete.length };
}

export function relationshipCommands(program: Command): void {
  program
    .command("add <source> <target>")
    .description("Add a relationship between elements (intra-layer or cross-layer)")
    .requiredOption(
      "--predicate <predicate>",
      "Relationship predicate (e.g., depends-on, realizes, exposes)"
    )
    .option("--properties <json>", "Relationship properties (JSON)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr relationship add motivation.goal.goal-a motivation.goal.goal-b --predicate aggregates
  $ dr relationship add api.operation.create-order application.service.order-service --predicate exposes
  $ dr relationship add business.businessprocess.checkout application.applicationprocess.checkout --predicate aggregates
  $ dr relationship add element-1 element-2 --predicate realizes --properties '{"strength":"high"}'`
    )
    .action(async (source, target, options) => {
      try {
        // Load model
        const model = await Model.load();

        // Find source element for constraints info
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }
        const sourceLayer = await model.getLayer(sourceLayerName);
        if (!sourceLayer) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }
        const sourceElement = sourceLayer.getElement(source);
        if (!sourceElement) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find target element for constraints info
        const targetLayerName = await findElementLayer(model, target);
        if (!targetLayerName) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }
        const targetLayer = await model.getLayer(targetLayerName);
        if (!targetLayer) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }
        const targetElement = targetLayer.getElement(target);
        if (!targetElement) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }

        // Get cardinality and strength info (before calling handler for CLI output)
        const sourceSpecNodeId = constructSpecNodeId(sourceElement, source);
        const targetSpecNodeId = constructSpecNodeId(targetElement, target);
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

        // Check for active changeset
        const stagingManager = new StagingAreaManager(model.rootPath, model);
        const activeChangesetId = await stagingManager.getActiveId();

        // Call the handler function
        await addRelationshipHandler(model, source, target, options.predicate, properties);

        // Show cardinality and strength in output
        let message = `✓ Added relationship: ${ansis.bold(source)} ${options.predicate} ${ansis.bold(target)}`;
        if (constraints) {
          message += ansis.dim(
            ` (${constraints.cardinality}, ${constraints.strength} strength)`
          );
        }
        if (activeChangesetId) {
          message += ansis.dim(` [staged]`);
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

        // Find source element and relationships to delete (for confirmation)
        const sourceLayerName = await findElementLayer(model, source);
        if (!sourceLayerName) {
          throw new CLIError(`Source element ${source} not found`, ErrorCategory.USER);
        }

        // Find relationships to delete (to show confirmation count)
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

        // Check for active changeset
        const stagingManager = new StagingAreaManager(model.rootPath, model);
        const activeChangesetId = await stagingManager.getActiveId();

        // Call the handler function
        const result = await deleteRelationshipHandler(model, source, target, options.predicate);

        const stagedSuffix = activeChangesetId ? " [staged]" : "";
        console.log(
          ansis.green(
            `✓ Deleted ${result.deletedCount} relationship(s) from ${ansis.bold(source)} to ${ansis.bold(target)}${stagedSuffix}`
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
          const crossLayer = rel.targetLayer && rel.targetLayer !== rel.layer
            ? ansis.dim(` [${rel.layer} → ${rel.targetLayer}]`)
            : "";

          console.log(
            `  ${direction} ${ansis.magenta(rel.predicate)}: ${ansis.yellow(otherElement)}${crossLayer}`
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
          console.log(`Layer:     ${ansis.cyan(rel.layer)}`);
          if (rel.targetLayer && rel.targetLayer !== rel.layer) {
            console.log(`Target Layer: ${ansis.cyan(rel.targetLayer)}`);
          }

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
