/**
 * Tool Definitions for Claude AI Integration
 * Defines tools for dr_list, dr_find, dr_search, and dr_trace
 *
 * NOTE: These tool definitions are used for legacy SDK-based chat only.
 * The `dr chat` command uses Claude Code CLI subprocess with Bash and Read tools instead.
 *
 * @deprecated This module provides legacy tool definitions for SDK-based chat.
 * For new integrations, prefer using Claude Code CLI subprocess with standard tools.
 */

import { Model } from '../core/model.js';
import { DependencyTracker, TraceDirection } from '../core/dependency-tracker.js';
import { ReferenceRegistry } from '../core/reference-registry.js';
import type { ToolDefinition, ToolExecutionResult } from '../types/index.js';

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
      name: 'dr_list',
      description: 'List elements in a specific layer of the architecture model',
      input_schema: {
        type: 'object',
        properties: {
          layer: {
            type: 'string',
            description:
              'Layer name (motivation, business, security, application, technology, api, data-model, data-store, ux, navigation, apm, testing)',
          },
          type: {
            type: 'string',
            description: 'Optional: filter by element type',
          },
        },
        required: ['layer'],
      },
    },
    {
      name: 'dr_find',
      description: 'Find a specific element by its ID in the architecture model',
      input_schema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Element ID to find (format: {layer}-{type}-{kebab-case-name})',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'dr_search',
      description: 'Search for elements by name, description, or ID in the architecture model',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (searches names, descriptions, and IDs)',
          },
          layers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: limit search to specific layers',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'dr_trace',
      description:
        'Trace dependencies for an element (what depends on it, what it depends on, or both)',
      input_schema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Element ID to trace dependencies for',
          },
          direction: {
            type: 'string',
            enum: ['up', 'down', 'both'],
            description:
              'Dependency direction: up=dependents, down=dependencies, both=both (default: both)',
          },
        },
        required: ['id'],
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
  switch (toolName) {
    case 'dr_list':
      return await executeDrList(args, model);

    case 'dr_find':
      return await executeDrFind(args, model);

    case 'dr_search':
      return await executeDrSearch(args, model);

    case 'dr_trace':
      return await executeDrTrace(args, model);

    default:
      return { error: `Unknown tool: ${toolName}` };
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
async function executeDrList(args: Record<string, unknown>, model: Model): Promise<ToolExecutionResult> {
  const layerName = args.layer as string;
  const filterType = args.type as string | undefined;

  if (!layerName) {
    return { error: 'layer parameter is required' };
  }

  try {
    const layer = await model.getLayer(layerName);

    if (!layer) {
      return {
        error: `Layer '${layerName}' not found or not loaded`,
        availableLayers: model.getLayerNames(),
      };
    }

    let elements = layer.listElements();

    if (filterType) {
      elements = elements.filter((e) => e.type === filterType);
    }

    return {
      layer: layerName,
      elementCount: elements.length,
      elements: elements.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        description: e.description || '',
      })),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
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
async function executeDrFind(args: Record<string, unknown>, model: Model): Promise<ToolExecutionResult> {
  const id = args.id as string;

  if (!id) {
    return { error: 'id parameter is required' };
  }

  try {
    // Search through all layers for the element
    for (const layerName of model.getLayerNames()) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      const element = layer.getElement(id);
      if (element) {
        return {
          found: true,
          element: {
            id: element.id,
            type: element.type,
            name: element.name,
            description: element.description || '',
            layer: layerName,
            properties: element.properties || {},
          },
        };
      }
    }

    return {
      found: false,
      error: `Element with id '${id}' not found`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
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
async function executeDrSearch(args: Record<string, unknown>, model: Model): Promise<ToolExecutionResult> {
  const query = (args.query as string)?.toLowerCase();
  const layerFilter = (args.layers as string[]) || undefined;

  if (!query) {
    return { error: 'query parameter is required' };
  }

  try {
    const results: ToolExecutionResult[] = [];

    for (const layerName of model.getLayerNames()) {
      // Skip if layer is in exclude list
      if (layerFilter && !layerFilter.includes(layerName)) {
        continue;
      }

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
            description: element.description || '',
            layer: layerName,
            matchReason:
              idMatches && nameMatches
                ? 'id and name'
                : idMatches
                  ? 'id'
                  : nameMatches
                    ? 'name'
                    : 'description',
          });
        }
      }
    }

    return {
      query,
      resultCount: results.length,
      results,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
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
async function executeDrTrace(args: Record<string, unknown>, model: Model): Promise<ToolExecutionResult> {
  const id = args.id as string;
  const direction = (args.direction as string) || 'both';

  if (!id) {
    return { error: 'id parameter is required' };
  }

  if (!['up', 'down', 'both'].includes(direction)) {
    return { error: 'direction must be one of: up, down, both' };
  }

  try {
    // Build registry by collecting all references from all loaded layers
    const registry = new ReferenceRegistry();

    for (const layerName of model.getLayerNames()) {
      const layer = await model.getLayer(layerName);
      if (!layer) continue;

      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    // Create dependency tracker with registry
    const tracker = new DependencyTracker(registry);

    const result: ToolExecutionResult = {
      id,
      direction,
    };

    // Get dependencies (elements this one depends on)
    if (direction === 'down' || direction === 'both') {
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
    if (direction === 'up' || direction === 'both') {
      try {
        const dependents = tracker.traceDependencies(id, TraceDirection.DOWN, null);
        result.dependents = dependents;
        result.dependentCount = dependents.length;
      } catch (e) {
        result.dependents = [];
        result.dependentCount = 0;
      }
    }

    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
