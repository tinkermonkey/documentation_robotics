/**
 * Catalog command - Query relationship catalog and documentation
 *
 * Provides access to the semantic relationship catalog (relationship-catalog.json),
 * which replaced the former link-registry system
 */

import { Command } from "commander";
import ansis from "ansis";
import { RelationshipCatalog } from "../core/relationship-catalog.js";
import { Model } from "../core/model.js";
import { extractErrorMessage } from "../utils/error-utils.js";

export function catalogCommands(program: Command): void {
  const catalog = program
    .command("catalog")
    .description("Query relationship catalog and semantic definitions");

  // catalog types - List relationship types
  catalog
    .command("types")
    .description("List relationship types from catalog")
    .option("--category <category>", "Filter by category (e.g., structural, behavioral)")
    .option("--layer <layer>", "Filter by applicable layer (e.g., 02, business)")
    .option("--format <format>", "Output format: table, json, markdown", "table")
    .option("--predicates", "Show predicate information")
    .addHelpText(
      "after",
      `
Examples:
  $ dr catalog types
  $ dr catalog types --category structural
  $ dr catalog types --layer 02
  $ dr catalog types --format json
  $ dr catalog types --predicates`
    )
    .action(async (options) => {
      try {
        const catalogInstance = new RelationshipCatalog();
        await catalogInstance.load();

        let types = catalogInstance.getAllTypes();

        // Apply filters
        if (options.category) {
          types = catalogInstance.getTypesByCategory(options.category);
        }

        if (options.layer) {
          types = catalogInstance.getTypesForLayer(options.layer);
        }

        if (types.length === 0) {
          console.log(ansis.yellow("No relationship types found for the specified filters."));
          return;
        }

        // Output in requested format
        if (options.format === "json") {
          const output = types.map((t) => ({
            id: t.id,
            predicate: t.predicate,
            inversePredicate: t.inversePredicate,
            category: t.category,
            description: t.description,
            applicableLayers: t.applicableLayers,
            archimateAlignment: t.archimateAlignment,
          }));
          console.log(JSON.stringify(output, null, 2));
        } else if (options.format === "markdown") {
          // Markdown table output
          console.log("");
          console.log("# Relationship Types");
          console.log("");
          console.log("| ID | Predicate | Category | Applicable Layers |");
          console.log("|----|-----------|----------|-------------------|");

          for (const type of types.sort(
            (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
          )) {
            const layers = type.applicableLayers.join(", ");
            console.log(`| ${type.id} | ${type.predicate} | ${type.category} | ${layers} |`);
          }

          console.log("");
          console.log(`**Total:** ${types.length} relationship types`);
        } else {
          // Table output
          console.log("");

          if (options.predicates) {
            console.log(
              `${ansis.bold("ID").padEnd(25)} ${ansis.bold("Predicate").padEnd(20)} ${ansis.bold("Inverse").padEnd(20)} ${ansis.bold("Category").padEnd(15)}`
            );
            console.log("=".repeat(85));

            for (const type of types.sort(
              (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
            )) {
              const inverse = type.inversePredicate || "N/A";
              console.log(
                `${type.id.padEnd(25)} ${type.predicate.padEnd(20)} ${inverse.padEnd(20)} ${type.category.padEnd(15)}`
              );
            }
          } else {
            console.log(
              `${ansis.bold("ID").padEnd(25)} ${ansis.bold("Predicate").padEnd(20)} ${ansis.bold("Category").padEnd(15)} ${ansis.bold("Layers").padEnd(20)}`
            );
            console.log("=".repeat(85));

            for (const type of types.sort(
              (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id)
            )) {
              const layers = type.applicableLayers.slice(0, 3).join(", ");
              const layersDisplay = type.applicableLayers.length > 3 ? `${layers}...` : layers;
              console.log(
                `${type.id.padEnd(25)} ${type.predicate.padEnd(20)} ${type.category.padEnd(15)} ${layersDisplay.padEnd(20)}`
              );
            }
          }

          console.log("");
          console.log(ansis.dim(`Total: ${types.length} relationship types`));
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  // catalog info - Show catalog metadata
  catalog
    .command("info")
    .description("Show relationship catalog metadata")
    .addHelpText(
      "after",
      `
Examples:
  $ dr catalog info`
    )
    .action(async () => {
      try {
        const catalogInstance = new RelationshipCatalog();
        await catalogInstance.load();

        const metadata = catalogInstance.getMetadata();
        const categories = catalogInstance.getCategories();

        console.log("");
        console.log(ansis.bold(ansis.blue("Relationship Catalog Information")));
        console.log(ansis.dim("─".repeat(60)));
        console.log("");
        console.log(`${ansis.bold("Version:")}        ${metadata.version}`);
        console.log(`${ansis.bold("Generated By:")}   ${metadata.generatedBy}`);
        console.log(`${ansis.bold("Last Updated:")}   ${metadata.lastUpdated}`);
        console.log(`${ansis.bold("Total Types:")}    ${metadata.totalTypes}`);
        console.log("");

        if (Object.keys(categories).length > 0) {
          console.log(ansis.bold("Categories:"));
          console.log("");

          for (const [key, info] of Object.entries(categories)) {
            const types = catalogInstance.getTypesByCategory(key);
            console.log(`  ${ansis.cyan(info.name)}`);
            console.log(`  ${ansis.dim(info.description)}`);
            console.log(`  ${ansis.dim(`Count: ${types.length} types`)}`);
            console.log("");
          }
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  // catalog search - Search relationship types
  catalog
    .command("search <keyword>")
    .description("Search relationship types by keyword")
    .option("--format <format>", "Output format: table, json", "table")
    .addHelpText(
      "after",
      `
Examples:
  $ dr catalog search composition
  $ dr catalog search depend
  $ dr catalog search "realizes" --format json`
    )
    .action(async (keyword, options) => {
      try {
        const catalogInstance = new RelationshipCatalog();
        await catalogInstance.load();

        const results = catalogInstance.search(keyword);

        if (results.length === 0) {
          console.log(ansis.yellow(`No relationship types found matching "${keyword}"`));
          return;
        }

        if (options.format === "json") {
          const output = results.map((t) => ({
            id: t.id,
            predicate: t.predicate,
            inversePredicate: t.inversePredicate,
            category: t.category,
            description: t.description,
          }));
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log("");
          console.log(ansis.bold(`Search results for "${keyword}":`));
          console.log("");

          for (const type of results) {
            console.log(`  ${ansis.cyan(type.id)}`);
            console.log(`    Predicate: ${ansis.green(type.predicate)}`);
            if (type.inversePredicate) {
              console.log(`    Inverse: ${ansis.green(type.inversePredicate)}`);
            }
            console.log(`    Category: ${type.category}`);
            console.log(`    ${ansis.dim(type.description)}`);
            console.log("");
          }

          console.log(ansis.dim(`Found ${results.length} matching types`));
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  // catalog validate - Validate relationships in model
  catalog
    .command("validate")
    .description("Validate relationships in the current model against catalog")
    .option("--layer <layer>", "Validate specific layer only")
    .option("--strict", "Treat warnings as errors")
    .addHelpText(
      "after",
      `
Examples:
  $ dr catalog validate
  $ dr catalog validate --layer 02
  $ dr catalog validate --strict`
    )
    .action(async (options) => {
      try {
        const catalogInstance = new RelationshipCatalog();
        await catalogInstance.load();

        const model = await Model.load();

        let errorCount = 0;
        let warningCount = 0;
        const issues: string[] = [];

        // Validate each relationship
        for (const [layerName, layer] of model.layers) {
          // Apply layer filter if specified
          if (options.layer && layerName !== options.layer) {
            continue;
          }

          for (const [, element] of layer.elements) {
            const elementRelationships = model.relationships.getForElement(element.id);

            // Check both outgoing and incoming relationships
            const allRelationships = [
              ...elementRelationships.outgoing,
              ...elementRelationships.incoming,
            ];

            for (const rel of allRelationships) {
              // Check if predicate exists in catalog
              const type = catalogInstance.getTypeByPredicate(rel.predicate);

              if (!type) {
                issues.push(
                  `${ansis.yellow("Warning")}: Unknown predicate "${rel.predicate}" in relationship ${rel.source} -> ${rel.target}`
                );
                warningCount++;
                continue;
              }

              // Check if layer is applicable
              const layerNumber = layerName.match(/\d+/)?.[0];
              if (layerNumber && !type.applicableLayers.some((l) => l.includes(layerNumber))) {
                issues.push(
                  `${ansis.red("Error")}: Predicate "${rel.predicate}" not applicable to layer ${layerName} (${rel.source} -> ${rel.target})`
                );
                errorCount++;
              }
            }
          }
        }

        // Display results
        console.log("");
        console.log(ansis.bold(ansis.blue("Relationship Validation Report")));
        console.log(ansis.dim("─".repeat(60)));
        console.log("");

        if (issues.length === 0) {
          console.log(ansis.green("✓ All relationships are valid"));
        } else {
          for (const issue of issues) {
            console.log(issue);
          }

          console.log("");
          console.log(ansis.dim(`Total issues: ${errorCount} errors, ${warningCount} warnings`));

          if (options.strict && warningCount > 0) {
            console.log("");
            console.log(ansis.red("Validation failed (strict mode: warnings treated as errors)"));
            process.exit(1);
          }

          if (errorCount > 0) {
            console.log("");
            console.log(ansis.red("Validation failed"));
            process.exit(1);
          }
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  // catalog docs - Generate documentation
  catalog
    .command("docs")
    .description("Generate relationship catalog documentation")
    .option("--output <file>", "Output file (default: stdout)")
    .option("--format <format>", "Output format: markdown, json", "markdown")
    .option("--category <category>", "Document specific category only")
    .addHelpText(
      "after",
      `
Examples:
  $ dr catalog docs
  $ dr catalog docs --output relationships.md
  $ dr catalog docs --category structural
  $ dr catalog docs --format json --output catalog.json`
    )
    .action(async (options) => {
      try {
        const catalogInstance = new RelationshipCatalog();
        await catalogInstance.load();

        const metadata = catalogInstance.getMetadata();
        let types = options.category
          ? catalogInstance.getTypesByCategory(options.category)
          : catalogInstance.getAllTypes();

        let output = "";

        if (options.format === "markdown") {
          // Generate markdown documentation
          output += "# Relationship Catalog Documentation\n\n";
          output += `**Version:** ${metadata.version}\n`;
          output += `**Generated:** ${new Date().toISOString()}\n`;
          output += `**Total Types:** ${types.length}\n\n`;

          // Group by category
          const byCategory = new Map<string, typeof types>();
          for (const type of types) {
            const existing = byCategory.get(type.category) ?? [];
            existing.push(type);
            byCategory.set(type.category, existing);
          }

          for (const [category, categoryTypes] of byCategory) {
            output += `## ${category.charAt(0).toUpperCase() + category.slice(1)} Relationships\n\n`;

            for (const type of categoryTypes.sort((a, b) => a.id.localeCompare(b.id))) {
              output += `### ${type.id}\n\n`;
              output += `**Predicate:** \`${type.predicate}\`\n`;
              if (type.inversePredicate) {
                output += `**Inverse Predicate:** \`${type.inversePredicate}\`\n`;
              }
              if (type.archimateAlignment) {
                output += `**ArchiMate Alignment:** ${type.archimateAlignment}\n`;
              }
              output += `**Applicable Layers:** ${type.applicableLayers.join(", ")}\n\n`;
              output += `**Description:** ${type.description}\n\n`;

              // Semantics
              output += `**Semantics:**\n`;
              output += `- Directionality: ${type.semantics.directionality}\n`;
              output += `- Transitivity: ${type.semantics.transitivity ? "Yes" : "No"}\n`;
              output += `- Symmetry: ${type.semantics.symmetry ? "Yes" : "No"}\n\n`;

              // Examples
              if (type.examples.length > 0) {
                output += `**Examples:**\n\n`;
                for (const example of type.examples.slice(0, 3)) {
                  output += `- **${example.source}** ${type.predicate} **${example.target}**\n`;
                  output += `  ${example.description}\n`;
                  if (example.layer) {
                    output += `  *(Layer: ${example.layer})*\n`;
                  }
                }
                output += "\n";
              }

              output += "---\n\n";
            }
          }
        } else {
          // JSON output
          output = JSON.stringify(
            {
              metadata: {
                version: metadata.version,
                generated: new Date().toISOString(),
                totalTypes: types.length,
              },
              types: types.map((t) => ({
                id: t.id,
                predicate: t.predicate,
                inversePredicate: t.inversePredicate,
                category: t.category,
                description: t.description,
                archimateAlignment: t.archimateAlignment,
                semantics: t.semantics,
                applicableLayers: t.applicableLayers,
                examples: t.examples,
              })),
            },
            null,
            2
          );
        }

        if (options.output) {
          const fs = await import("fs/promises");
          await fs.writeFile(options.output, output, "utf-8");
          console.log(ansis.green(`✓ Documentation written to ${options.output}`));
        } else {
          console.log(output);
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        console.error(ansis.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}
