/**
 * Tool Definitions for Claude AI Integration
 * Defines tools for dr_list, dr_find, dr_search, and dr_trace
 *
 * NOTE: These tool definitions are used for legacy SDK-based chat integration.
 * The `dr chat` command primarily uses Claude Code CLI subprocess with Bash and Read tools.
 * This module is maintained for backward compatibility with SDK-based chat integration.
 */

import { Model } from "../core/model.js";
import { DependencyTracker, TraceDirection } from "../core/dependency-tracker.js";
import { ReferenceRegistry } from "../core/reference-registry.js";
import type { ToolDefinition, ToolExecutionResult } from "../types/index.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";

/**
 * Get tool definitions for Claude to use with the model
 *
 * Returns an array of tool definitions that Claude can invoke to interact with
 * the architecture model. Tools include list, find, search, and dependency tracing.
 *
 * NOTE: This is for legacy SDK-based chat integration only.
 *
 * @returns Array of tool definitions compatible with Claude AI
 */
export function getModelTools(): ToolDefinition[] {
  return [
    {
      name: "dr_list",
      description: "List elements in a specific layer of the architecture model",
      input_schema: {
        type: "object",
        properties: {
          layer: {
            type: "string",
            description:
              "Layer name (motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing)",
          },
          type: {
            type: "string",
            description: "Optional: filter by element type",
          },
        },
        required: ["layer"],
      },
    },
    {
      name: "dr_find",
      description: "Find a specific element by its ID in the architecture model",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Element ID to find (format: {layer}-{type}-{kebab-case-name})",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "dr_search",
      description: "Search for elements by name, description, or ID in the architecture model",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (searches names, descriptions, and IDs)",
          },
          layers: {
            type: "array",
            items: { type: "string" },
            description: "Optional: limit search to specific layers",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "dr_trace",
      description:
        "Trace dependencies for an element (what depends on it, what it depends on, or both)",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Element ID to trace dependencies for",
          },
          direction: {
            type: "string",
            enum: ["up", "down", "both"],
            description:
              "Dependency direction: up=dependents, down=dependencies, both=both (default: both)",
          },
        },
        required: ["id"],
      },
    },
  ];
}

/**
 * Execute a tool and return the result
 *
 * Invokes a specific tool with the provided arguments and returns the execution result.
 * All tool results are structured as JSON-serializable objects that may include error
 * information in the `error` field if the execution fails.
 *
 * @param toolName Name of the tool to execute (dr_list, dr_find, dr_search, or dr_trace)
 * @param args Tool arguments matching the tool's input_schema
 * @param model The architecture model to query
 * @returns Tool execution result as a ToolExecutionResult object
 */
export async function executeModelTool(
  toolName: string,
  args: Record<string, unknown>,
  model: Model
): Promise<ToolExecutionResult> {
  const span = isTelemetryEnabled
    ? startSpan("ai-tool.execute", {
        "tool.name": toolName,
        "tool.args": JSON.stringify(args),
      })
    : null;

  try {
    let result: ToolExecutionResult;

    switch (toolName) {
      case "dr_list":
        result = await executeDrList(args, model);
        break;

      case "dr_find":
        result = await executeDrFind(args, model);
        break;

      case "dr_search":
        result = await executeDrSearch(args, model);
        break;

      case "dr_trace":
        result = await executeDrTrace(args, model);
        break;

      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("tool.hasError", !!result.error);
      if (result.error) {
        (span as any).setAttribute("tool.error", result.error as string);
      }
      (span as any).setStatus({ code: result.error ? 2 : 0 });
    }

    return result;
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    endSpan(span);
  }
}

/**
 * Execute dr_list tool
 *
 * Lists all elements in a specified layer, optionally filtered by element type.
 *
 * @param args Tool arguments containing layer name and optional type filter
 * @param model The architecture model
 * @returns Result with element list or error message
 */
async function executeDrList(
  args: Record<string, unknown>,
  model: Model
): Promise<ToolExecutionResult> {
  const span = isTelemetryEnabled
    ? startSpan("ai-tool.dr-list", {
        "tool.layer": args.layer as string,
        "tool.type": args.type as string | undefined,
      })
    : null;

  try {
    const layerName = args.layer as string;
    const filterType = args.type as string | undefined;

    if (!layerName) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.error", "layer parameter is required");
        (span as any).setStatus({ code: 2 });
      }
      return { error: "layer parameter is required" };
    }

    const layer = await model.getLayer(layerName);

    if (!layer) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.layerFound", false);
        (span as any).setStatus({ code: 2 });
      }
      return {
        error: `Layer '${layerName}' not found or not loaded`,
        availableLayers: model.getLayerNames(),
      };
    }

    let elements = layer.listElements();

    if (filterType) {
      elements = elements.filter((e) => e.type === filterType);
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("tool.layerFound", true);
      (span as any).setAttribute("tool.elementCount", elements.length);
      (span as any).setAttribute("tool.filtered", !!filterType);
      (span as any).setStatus({ code: 0 });
    }

    return {
      layer: layerName,
      elementCount: elements.length,
      elements: elements.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        description: e.description || "",
      })),
    };
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    endSpan(span);
  }
}

/**
 * Execute dr_find tool
 *
 * Finds a specific element by its ID across all layers in the model.
 *
 * @param args Tool arguments containing element ID to find
 * @param model The architecture model
 * @returns Result with found element or error message
 */
async function executeDrFind(
  args: Record<string, unknown>,
  model: Model
): Promise<ToolExecutionResult> {
  const span = isTelemetryEnabled
    ? startSpan("ai-tool.dr-find", {
        "tool.id": args.id as string,
      })
    : null;

  try {
    const id = args.id as string;

    if (!id) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.error", "id parameter is required");
        (span as any).setStatus({ code: 2 });
      }
      return { error: "id parameter is required" };
    }

    // Search through all layers for the element
    const layerNames = model.getLayerNames();
    for (const layerName of layerNames) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const element = layer.getElement(id);
      if (element) {
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute("tool.found", true);
          (span as any).setAttribute("tool.foundInLayer", layerName);
          (span as any).setAttribute("tool.elementType", element.type);
          (span as any).setStatus({ code: 0 });
        }
        return {
          found: true,
          element: {
            id: element.id,
            type: element.type,
            name: element.name,
            description: element.description || "",
            layer: layerName,
            properties: element.properties || {},
          },
        };
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("tool.found", false);
      (span as any).setAttribute("tool.layersSearched", layerNames.length);
      (span as any).setStatus({ code: 2 });
    }

    return {
      found: false,
      error: `Element with id '${id}' not found`,
    };
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    endSpan(span);
  }
}

/**
 * Execute dr_search tool
 *
 * Searches for elements by name, description, or ID across the model,
 * optionally limited to specific layers.
 *
 * @param args Tool arguments containing search query and optional layer filter
 * @param model The architecture model
 * @returns Result with search results or error message
 */
async function executeDrSearch(
  args: Record<string, unknown>,
  model: Model
): Promise<ToolExecutionResult> {
  const span = isTelemetryEnabled
    ? startSpan("ai-tool.dr-search", {
        "tool.query": args.query as string,
        "tool.hasLayerFilter": !!args.layers,
      })
    : null;

  try {
    const query = (args.query as string)?.toLowerCase();
    const layerFilter = (args.layers as string[]) || undefined;

    if (!query) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.error", "query parameter is required");
        (span as any).setStatus({ code: 2 });
      }
      return { error: "query parameter is required" };
    }

    const results: ToolExecutionResult[] = [];
    let layersSearched = 0;

    for (const layerName of model.getLayerNames()) {
      // Skip if layer is in exclude list
      if (layerFilter && !layerFilter.includes(layerName)) {
        continue;
      }

      layersSearched++;

      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const elements = layer.listElements();

      for (const element of elements) {
        const idMatches = element.id.toLowerCase().includes(query);
        const nameMatches = element.name.toLowerCase().includes(query);
        const descMatches =
          element.description && element.description.toLowerCase().includes(query);

        if (idMatches || nameMatches || descMatches) {
          results.push({
            id: element.id,
            type: element.type,
            name: element.name,
            description: element.description || "",
            layer: layerName,
            matchReason:
              idMatches && nameMatches
                ? "id and name"
                : idMatches
                  ? "id"
                  : nameMatches
                    ? "name"
                    : "description",
          });
        }
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("tool.resultCount", results.length);
      (span as any).setAttribute("tool.layersSearched", layersSearched);
      (span as any).setAttribute("tool.queryLength", query.length);
      (span as any).setStatus({ code: 0 });
    }

    return {
      query,
      resultCount: results.length,
      results,
    };
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    endSpan(span);
  }
}

/**
 * Execute dr_trace tool
 *
 * Traces dependencies for an element, showing what it depends on, what depends on it,
 * or both directions.
 *
 * @param args Tool arguments containing element ID and optional direction filter
 * @param model The architecture model
 * @returns Result with dependency trace or error message
 */
async function executeDrTrace(
  args: Record<string, unknown>,
  model: Model
): Promise<ToolExecutionResult> {
  const span = isTelemetryEnabled
    ? startSpan("ai-tool.dr-trace", {
        "tool.id": args.id as string,
        "tool.direction": (args.direction as string) || "both",
      })
    : null;

  try {
    const id = args.id as string;
    const direction = (args.direction as string) || "both";

    if (!id) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.error", "id parameter is required");
        (span as any).setStatus({ code: 2 });
      }
      return { error: "id parameter is required" };
    }

    if (!["up", "down", "both"].includes(direction)) {
      if (isTelemetryEnabled && span) {
        (span as any).setAttribute("tool.error", "invalid direction");
        (span as any).setStatus({ code: 2 });
      }
      return { error: "direction must be one of: up, down, both" };
    }

    // Build registry by collecting all references from all loaded layers
    const registry = new ReferenceRegistry();
    let elementCount = 0;

    for (const layerName of model.getLayerNames()) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        registry.registerElement(element);
        elementCount++;
      }
    }

    // Create dependency tracker with registry
    const tracker = new DependencyTracker(registry);

    const result: ToolExecutionResult = {
      id,
      direction,
    };

    // Get dependencies (elements this one depends on)
    if (direction === "down" || direction === "both") {
      try {
        const dependencies = tracker.traceDependencies(id, TraceDirection.UP, null);
        result.dependencies = dependencies;
        result.dependencyCount = dependencies.length;
      } catch (e) {
        result.dependencies = [];
        result.dependencyCount = 0;
      }
    }

    // Get dependents (elements that depend on this one)
    if (direction === "up" || direction === "both") {
      try {
        const dependents = tracker.traceDependencies(id, TraceDirection.DOWN, null);
        result.dependents = dependents;
        result.dependentCount = dependents.length;
      } catch (e) {
        result.dependents = [];
        result.dependentCount = 0;
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("tool.elementCount", elementCount);
      (span as any).setAttribute("tool.dependencyCount", result.dependencyCount || 0);
      (span as any).setAttribute("tool.dependentCount", result.dependentCount || 0);
      (span as any).setStatus({ code: 0 });
    }

    return result;
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    endSpan(span);
  }
}
