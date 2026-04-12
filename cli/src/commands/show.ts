/**
 * Show detailed information about an element
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { findElementLayer } from "../utils/element-utils.js";
import { CLIError, ErrorCategory, handleError } from "../utils/errors.js";
import { isTelemetryEnabled, startActiveSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

export async function showCommand(id: string, options: { model?: string } = {}): Promise<void> {
  // Infer the layer from the element ID prefix (e.g. "api.operation.foo" → load only "api" layer)
  // Falls back to loading all layers if the ID doesn't contain a layer prefix.
  const inferredLayer = id.includes(".") ? id.split(".")[0] : undefined;

  await startActiveSpan(
    "show.execute",
    async (span) => {
      try {
        // Load only the inferred layer when possible (performance: avoids loading all 12 layers)
        const model = await Model.load(
          options.model,
          inferredLayer ? { layers: [inferredLayer] } : {}
        );

        // Find element
        const layerName = await findElementLayer(model, id);
        if (!layerName) {
          if (isTelemetryEnabled) {
            (span as any).setAttribute("show.found", false);
          }
          throw new CLIError(`Element ${id} not found`, ErrorCategory.USER, [
            `Use "dr search ${id}" to find similar elements`,
            'Use "dr list <layer>" to list all elements in a layer',
          ]);
        }

        const layer = await model.getLayer(layerName);
        if (!layer) {
          throw new CLIError(`Layer ${layerName} not found`, ErrorCategory.USER, [
            'Use "dr schema layers" to list all available layers',
          ]);
        }

        const element = layer.getElement(id);
        if (!element) {
          throw new CLIError(`Element ${id} not found`, ErrorCategory.USER, [
            `Use "dr search ${id}" to find similar elements`,
            'Use "dr list <layer>" to list all elements in a layer',
          ]);
        }

        // Query relationships from the central store (element.relationships is always empty
        // for modern elements since relationships moved to relationships.yaml)
        const elementId = element.path || element.id;
        const { outgoing, incoming } = model.relationships.getForElement(elementId);
        const hasRelationships = outgoing.length > 0 || incoming.length > 0;

        if (isTelemetryEnabled) {
          (span as any).setAttribute("show.found", true);
          (span as any).setAttribute("show.layer", layerName);
          (span as any).setAttribute("show.type", element.type);
          (span as any).setAttribute(
            "show.hasReferences",
            element.references && element.references.length > 0
          );
          (span as any).setAttribute("show.hasRelationships", hasRelationships);
          (span as any).setAttribute("show.outgoingRelationships", outgoing.length);
          (span as any).setAttribute("show.incomingRelationships", incoming.length);
        }

        // Display element information
        console.log("");
        console.log(ansis.bold(`${ansis.blue("Element:")} ${id}`));
        console.log(ansis.dim("─".repeat(60)));
        console.log(`${ansis.gray("Layer:")}       ${layerName}`);
        console.log(`${ansis.gray("Type:")}        ${element.type}`);
        console.log(`${ansis.gray("Name:")}        ${element.name}`);

        if (element.description) {
          console.log(`${ansis.gray("Description:")} ${element.description}`);
        }

        // Display properties (attributes)
        if (Object.keys(element.attributes).length > 0) {
          console.log("");
          console.log(ansis.bold("Properties:"));
          for (const [key, value] of Object.entries(element.attributes)) {
            const displayValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
            console.log(`  ${ansis.cyan(key)}: ${displayValue}`);
          }
        }

        // Display references (inline, legacy format)
        if (element.references && element.references.length > 0) {
          console.log("");
          console.log(ansis.bold("References:"));
          for (const ref of element.references) {
            console.log(`  → ${ansis.yellow(ref.target)} (${ref.type})`);
            if (ref.description) {
              console.log(`    ${ansis.dim(ref.description)}`);
            }
          }
        }

        // Display relationships from the central relationships store
        if (outgoing.length > 0) {
          console.log("");
          console.log(ansis.bold("Relationships (outgoing):"));
          for (const rel of outgoing) {
            console.log(`  ${ansis.magenta(rel.predicate)} → ${rel.target}`);
            if (rel.properties && Object.keys(rel.properties).length > 0) {
              const propStr = Object.entries(rel.properties)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ");
              console.log(`    ${ansis.dim(propStr)}`);
            }
          }
        }

        if (incoming.length > 0) {
          console.log("");
          console.log(ansis.bold("Relationships (incoming):"));
          for (const rel of incoming) {
            console.log(`  ${ansis.magenta(rel.predicate)} ← ${rel.source}`);
          }
        }

        // Display source code location if present
        const sourceRef = element.getSourceReference();
        if (sourceRef) {
          console.log("");
          console.log(ansis.bold("Source Code Location:"));
          console.log(`  ${ansis.gray("Provenance:")} ${sourceRef.provenance}`);

          (sourceRef.locations ?? []).forEach((loc, idx) => {
            console.log(`  ${ansis.gray("Location " + (idx + 1) + ":")}`);
            console.log(`    File: ${ansis.cyan(loc.file)}`);
            if (loc.symbol) {
              console.log(`    Symbol: ${ansis.cyan(loc.symbol)}`);
            }
          });

          if (sourceRef.repository) {
            console.log(`  ${ansis.gray("Repository Context:")}`);
            if (sourceRef.repository.url) {
              console.log(`    Remote: ${ansis.cyan(sourceRef.repository.url)}`);
            }
            if (sourceRef.repository.commit) {
              console.log(`    Commit: ${ansis.cyan(sourceRef.repository.commit)}`);
            }
          }
        }

        console.log("");

        if (isTelemetryEnabled) {
          (span as any).setStatus({ code: 0 });
        }
      } catch (error) {
        if (isTelemetryEnabled) {
          (span as any).recordException(error as Error);
          (span as any).setStatus({
            code: 2,
            message: getErrorMessage(error),
          });
        }
        handleError(error);
      }
    },
    { "show.elementId": id }
  );
}
