/**
 * Search for elements across the model
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import type { Element } from "../core/element.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

export interface SearchOptions {
  layer?: string;
  type?: string;
  sourceFile?: string;
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

/**
 * Normalize a file path for comparison
 * - Removes leading ./
 * - Converts backslashes to forward slashes
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

/**
 * Check if an element matches the source file query
 */
function matchesSourceFile(element: Element, sourceFilePath: string): boolean {
  const sourceRef = element.getSourceReference();
  if (!sourceRef) {
    return false;
  }

  const normalizedQuery = normalizePath(sourceFilePath);

  // Check if any location matches the queried file
  return sourceRef.locations.some((loc) => {
    const normalizedLoc = normalizePath(loc.file);
    return normalizedLoc === normalizedQuery;
  });
}

export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  const span = isTelemetryEnabled
    ? startSpan("search.execute", {
        "search.query": query,
        "search.layer": options.layer,
        "search.type": options.type,
        "search.sourceFile": options.sourceFile,
        "search.json": options.json === true,
      })
    : null;

  try {
    // Load model
    const model = await Model.load();

    // Collect all matching elements with source reference info
    const results: Array<{
      layer: string;
      id: string;
      type: string;
      name: string;
      description?: string;
      sourceFile?: string;
      sourceSymbol?: string;
    }> = [];

    const queryLower = query.toLowerCase();
    const isSourceFileSearch = !!options.sourceFile;

    for (const layerName of model.getLayerNames()) {
      // Skip if layer filter specified and doesn't match
      if (options.layer && layerName !== options.layer) {
        continue;
      }

      const layerObj = await model.getLayer(layerName);
      if (!layerObj) continue;

      for (const element of layerObj.listElements()) {
        // Apply type filter
        if (options.type && element.type !== options.type) {
          continue;
        }

        // If source file search, use different matching logic
        if (isSourceFileSearch) {
          if (!matchesSourceFile(element, options.sourceFile!)) {
            continue;
          }
        } else {
          // Match query against id and name
          const idMatch = element.id.toLowerCase().includes(queryLower);
          const nameMatch = element.name.toLowerCase().includes(queryLower);

          if (!idMatch && !nameMatch) {
            continue;
          }
        }

        // Extract source reference info if present
        let sourceFile: string | undefined;
        let sourceSymbol: string | undefined;
        const sourceRef = element.getSourceReference();
        if (sourceRef && sourceRef.locations.length > 0) {
          sourceFile = sourceRef.locations[0].file;
          sourceSymbol = sourceRef.locations[0].symbol;
        }

        results.push({
          layer: layerName,
          id: element.id,
          type: element.type,
          name: element.name,
          description: element.description,
          sourceFile,
          sourceSymbol,
        });
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("search.resultCount", results.length);
      (span as any).setStatus({ code: 0 });
    }

    // Output as JSON if requested
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      endSpan(span);
      return;
    }

    // Display results
    if (results.length === 0) {
      if (isSourceFileSearch) {
        console.log(
          ansis.yellow(`No elements found referencing source file: ${options.sourceFile}`)
        );
      } else {
        console.log(ansis.yellow(`No elements matching "${query}"`));
      }
      endSpan(span);
      return;
    }

    console.log("");
    if (isSourceFileSearch) {
      console.log(
        ansis.bold(`Found ${results.length} element(s) referencing ${options.sourceFile}:`)
      );
    } else {
      console.log(ansis.bold(`Found ${results.length} element(s) matching "${query}":`));
    }
    console.log(ansis.dim("─".repeat(80)));

    // Print header
    const layerWidth = 12;
    const idWidth = 28;
    const typeWidth = 12;
    const nameWidth = 28;

    console.log(
      `${ansis.cyan("LAYER".padEnd(layerWidth))} ${ansis.cyan("ID".padEnd(idWidth))} ${ansis.cyan("TYPE".padEnd(typeWidth))} ${ansis.cyan("NAME")}`
    );
    console.log(ansis.dim("─".repeat(80)));

    // Print rows
    for (const result of results) {
      const layer = result.layer.substring(0, layerWidth - 1).padEnd(layerWidth);
      const id = result.id.substring(0, idWidth - 1).padEnd(idWidth);
      const type = result.type.substring(0, typeWidth - 1).padEnd(typeWidth);
      const name = result.name.substring(0, nameWidth);

      console.log(`${ansis.blue(layer)} ${id} ${type} ${name}`);

      // Show description and source info in verbose mode or for source file searches
      if (options.verbose || isSourceFileSearch) {
        if (result.description) {
          console.log(ansis.dim(`  └─ Description: ${result.description}`));
        }
        if (result.sourceFile) {
          const symbol = result.sourceSymbol ? ` | Symbol: ${result.sourceSymbol}` : "";
          console.log(ansis.dim(`  └─ Source: ${result.sourceFile}${symbol}`));
        }
      }
    }

    console.log(ansis.dim("─".repeat(80)));
    console.log("");
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    const message = getErrorMessage(error);
    console.error(ansis.red(`Error: ${message}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}
