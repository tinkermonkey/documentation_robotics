/**
 * Relationship subcommands for managing intra-layer relationships
 */

import { Command } from "commander";
import ansis from "ansis";
import { Model } from "../core/model.js";
import { findElementLayer } from "../utils/element-utils.js";
import { CLIError, ErrorCategory, handleError } from "../utils/errors.js";

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

        // Find target element
        const targetLayerName = await findElementLayer(model, target);
        if (!targetLayerName) {
          throw new CLIError(`Target element ${target} not found`, ErrorCategory.USER);
        }

        // Relationships are intra-layer only
        if (sourceLayerName !== targetLayerName) {
          throw new CLIError(
            "cannot add cross-layer relationship. Relationships must be within the same layer.",
            ErrorCategory.USER
          );
        }

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

        console.log(
          ansis.green(
            `✓ Added relationship: ${ansis.bold(source)} ${options.predicate} ${ansis.bold(target)}`
          )
        );
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
