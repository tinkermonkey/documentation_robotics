/**
 * Project command - project elements across layers using projection rules
 */

import ansis from "ansis";
import { Model } from "../core/model.js";

export async function projectCommand(
  elementId: string,
  targetLayers: string,
  options: {
    rule?: string;
    dryRun?: boolean;
    force?: boolean;
    model?: string;
  } = {}
): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model);

    // Get source element
    const source = model.getElementById(elementId);
    if (!source) {
      console.error(ansis.red(`Error: Element '${elementId}' not found`));
      process.exit(1);
    }

    // Initialize projection engine
    const engine = model.getProjectionEngine();

    // Parse target layers
    const layers = targetLayers.split(",").map((l) => l.trim());

    console.log("");
    console.log(ansis.bold(`Projecting element: ${ansis.yellow(elementId)}`));
    console.log(ansis.bold(`Target layers: ${ansis.cyan(layers.join(", "))}`));
    console.log("");

    // Project to each layer
    const results: Array<{ layer: string; element: any }> = [];

    for (const targetLayer of layers) {
      try {
        // Find applicable rules
        const applicableRules = engine.findApplicableRules(source, targetLayer);

        if (applicableRules.length === 0) {
          console.log(
            ansis.yellow(
              `⚠  Warning: No projection rule found for ${source.layer} -> ${targetLayer}`
            )
          );
          continue;
        }

        // Use first applicable rule (or specific rule if provided)
        const projectionRule = options.rule
          ? applicableRules.find((r) => r.name === options.rule)
          : applicableRules[0];

        if (!projectionRule) {
          console.log(
            ansis.yellow(`⚠  Warning: Rule '${options.rule}' not found for ${targetLayer}`)
          );
          continue;
        }

        // Perform projection
        const projected = await engine.projectElement(
          source,
          targetLayer,
          projectionRule,
          options.dryRun
        );

        if (projected) {
          results.push({ layer: targetLayer, element: projected });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(ansis.red(`✗ Error projecting to ${targetLayer}: ${message}`));
      }
    }

    // Display results
    if (results.length > 0) {
      console.log(ansis.bold.green("✓ Projection successful"));
      console.log("");

      // Table header
      const colLayer = "Target Layer";
      const colId = "Element ID";
      const colName = "Name";

      const maxLayerLen = Math.max(colLayer.length, ...results.map((r) => r.layer.length));
      const maxIdLen = Math.max(colId.length, ...results.map((r) => r.element.id.length));
      const maxNameLen = Math.max(
        colName.length,
        ...results.map((r) => (r.element.name || "").length)
      );

      // Print header
      console.log(
        ansis.bold(
          ansis.cyan(colLayer.padEnd(maxLayerLen)) +
            "  " +
            ansis.white(colId.padEnd(maxIdLen)) +
            "  " +
            ansis.green(colName.padEnd(maxNameLen))
        )
      );
      console.log(ansis.dim("─".repeat(maxLayerLen + maxIdLen + maxNameLen + 4)));

      // Print rows
      for (const { layer, element } of results) {
        console.log(
          ansis.cyan(layer.padEnd(maxLayerLen)) +
            "  " +
            ansis.white(element.id.padEnd(maxIdLen)) +
            "  " +
            ansis.green((element.name || "").padEnd(maxNameLen))
        );
      }

      console.log("");

      if (options.dryRun) {
        console.log(ansis.yellow("Dry run - elements not saved"));
      } else {
        // Save model
        await model.save();
        console.log(ansis.green("Model saved successfully"));
      }
    } else {
      console.log(ansis.yellow("No elements were projected"));
    }

    console.log("");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function projectAllCommand(
  options: {
    from?: string;
    to?: string;
    dryRun?: boolean;
    model?: string;
  } = {}
): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model);

    // Initialize projection engine
    const engine = model.getProjectionEngine();

    console.log("");
    console.log(ansis.bold("Projecting all applicable elements..."));
    console.log("");

    if (options.from) {
      console.log(`From layer: ${options.from}`);
    }
    if (options.to) {
      console.log(`To layer: ${options.to}`);
    }
    if (options.from || options.to) {
      console.log("");
    }

    // Perform projections
    const projected = await engine.projectAll(
      options.from || undefined,
      options.to || undefined,
      options.dryRun
    );

    // Display results
    if (projected.length > 0) {
      console.log(ansis.bold.green(`✓ Projected ${projected.length} element(s)`));
      console.log("");

      // Group by layer
      const byLayer = new Map<string, any[]>();
      for (const element of projected) {
        const layer = element.layer || "unknown";
        if (!byLayer.has(layer)) {
          byLayer.set(layer, []);
        }
        byLayer.get(layer)!.push(element);
      }

      // Display grouped results
      for (const [layer, elements] of Array.from(byLayer.entries()).sort()) {
        console.log(ansis.bold(`${layer}:`));
        for (const element of elements) {
          console.log(
            `  ${ansis.dim("•")} ${element.id} ${ansis.gray(`(${element.name || "unnamed"})`)}`
          );
        }
        console.log("");
      }

      if (options.dryRun) {
        console.log(ansis.yellow("Dry run - elements not saved"));
      } else {
        // Save model
        await model.save();
        console.log(ansis.green("Model saved successfully"));
      }
    } else {
      console.log(ansis.yellow("No elements were projected"));
    }

    console.log("");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
