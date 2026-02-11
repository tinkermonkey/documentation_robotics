import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * OpenAPI server definition
 * Specifies base URL and optional description for API access
 */
interface OpenAPIServer {
  url: string;
  description?: string;
}

/**
 * OpenAPI tag definition
 * Logical grouping for operations
 */
interface OpenAPITag {
  name: string;
  description?: string;
}

/**
 * OpenAPI external documentation link
 * Reference to external documentation
 */
interface OpenAPIExternalDocs {
  url: string;
  description?: string;
}

/**
 * OpenAPI info object
 * Metadata about the API
 */
interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

/**
 * OpenAPI components section
 * Reusable schema definitions and other components
 */
interface OpenAPIComponents {
  schemas?: Record<string, unknown>;
  responses?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  requestBodies?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  securitySchemes?: Record<string, unknown>;
}

/**
 * OpenAPI specification root
 * Complete OpenAPI 3.0 document structure
 */
interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  paths: Record<string, unknown>;
  components: OpenAPIComponents;
  servers?: OpenAPIServer[];
  tags?: OpenAPITag[];
  externalDocs?: OpenAPIExternalDocs;
  security?: unknown[];
}

/**
 * Endpoint mapping entry
 * Groups endpoints by path and method for processing
 */
interface EndpointData {
  name: string;
  id: string;
  description?: string;
  getProperty: (key: string) => unknown;
  getSourceReference: () => unknown;
}

interface EndpointMapping {
  method: string;
  element: EndpointData;
}

/**
 * OpenAPI 3.0 Exporter for layer 6 (API)
 */
export class OpenAPIExporter implements Exporter {
  name = "OpenAPI";
  supportedLayers = ["api"];

  async export(model: Model, _options: ExportOptions = {}): Promise<string> {
    const span = isTelemetryEnabled ? startSpan("export.format.openapi") : null;

    try {
      // Query graph model for API layer nodes
      const nodes = model.graph.getNodesByLayer("api");
      if (nodes.length === 0) {
        throw new Error("No API layer found in model");
      }

      // Note: _options is not used for OpenAPI exporter as it only supports the api layer
      // The parameter is kept for interface consistency with other exporters

      const spec: OpenAPISpec = {
        openapi: "3.0.0",
        info: {
          title: model.manifest.name,
          version: model.manifest.version || "1.0.0",
        },
        paths: {},
        components: {
          schemas: {},
          responses: {},
          parameters: {},
          requestBodies: {},
          headers: {},
          securitySchemes: {},
        },
      };

      if (model.manifest.description) {
        spec.info.description = model.manifest.description;
      }

      // Group endpoints by path
      const pathGroups = new Map<string, EndpointMapping[]>();

      // Query graph for endpoint nodes
      for (const node of nodes) {
        if (node.type === "endpoint") {
          const path = (node.properties.path as string) || "/";
          const method = ((node.properties.method as string) || "get").toLowerCase();

          if (!pathGroups.has(path)) {
            pathGroups.set(path, []);
          }

          // Create a minimal element-like object for compatibility
          const endpointData = {
            name: node.name,
            id: node.id,
            description: node.description,
            getProperty: (key: string) => node.properties[key],
            getSourceReference: () => node.properties["x-source-reference"],
          };

          pathGroups.get(path)!.push({ method, element: endpointData as any });
        }
      }

      // Build paths section
      for (const [path, endpoints] of pathGroups) {
        const pathItem: Record<string, unknown> = {};

        for (const { method, element } of endpoints) {
          const operation: Record<string, unknown> = {
            summary: element.name,
            operationId: element.id,
            responses: element.getProperty("responses") || {
              "200": {
                description: "Successful response",
              },
            },
          };

          if (element.description) {
            operation.description = element.description;
          }

          const tags = element.getProperty("tags");
          if (tags) {
            operation.tags = tags;
          }

          const parameters = element.getProperty("parameters");
          if (parameters) {
            operation.parameters = parameters;
          }

          const requestBody = element.getProperty("requestBody");
          if (requestBody) {
            operation.requestBody = requestBody;
          }

          const security = element.getProperty("security");
          if (security) {
            operation.security = security;
          }

          const deprecated = element.getProperty("deprecated");
          if (deprecated) {
            operation.deprecated = deprecated;
          }

          // Add source reference if present
          const sourceRef = element.getSourceReference();
          if (sourceRef) {
            operation["x-source-reference"] = sourceRef;
          }

          pathItem[method] = operation;
        }

        // Add source reference to PathItem if any endpoint has one
        // (Use first endpoint's source reference for the path)
        if (endpoints.length > 0) {
          const firstSourceRef = endpoints[0].element.getSourceReference();
          if (firstSourceRef) {
            pathItem["x-source-reference"] = firstSourceRef;
          }
        }

        (spec.paths as Record<string, unknown>)[path] = pathItem;
      }

      // Collect all schema definitions from nodes
      for (const node of nodes) {
        if (node.type === "schema") {
          const schemaName = (node.properties.schemaName as string) || node.id;
          const schema = node.properties.schema;
          if (schema) {
            spec.components.schemas![schemaName] = schema;
          }
        }
      }

      // Collect security schemes if defined
      for (const node of nodes) {
        if (node.type === "security-scheme") {
          const schemeName = node.name;
          const schemeType = node.properties.type as string;
          if (schemeType) {
            const scheme: Record<string, unknown> = {
              type: schemeType,
            };

            const schemeProp = node.properties.scheme;
            if (schemeProp) {
              scheme.scheme = schemeProp;
            }

            const bearerFormat = node.properties.bearerFormat;
            if (bearerFormat) {
              scheme.bearerFormat = bearerFormat;
            }

            const flows = node.properties.flows;
            if (flows) {
              scheme.flows = flows;
            }

            const openIdConnectUrl = node.properties.openIdConnectUrl;
            if (openIdConnectUrl) {
              scheme.openIdConnectUrl = openIdConnectUrl;
            }

            if (node.description) {
              scheme.description = node.description;
            }

            spec.components.securitySchemes![schemeName] = scheme;
          }
        }
      }

      // Add servers if defined in manifest (would be stored separately)
      // For now, servers would need to be added via layer properties
      // This could be extended in the future

      // Remove empty component sections
      const components = spec.components;
      if (components.schemas && Object.keys(components.schemas).length === 0) {
        delete components.schemas;
      }
      if (components.responses && Object.keys(components.responses).length === 0) {
        delete components.responses;
      }
      if (components.parameters && Object.keys(components.parameters).length === 0) {
        delete components.parameters;
      }
      if (components.requestBodies && Object.keys(components.requestBodies).length === 0) {
        delete components.requestBodies;
      }
      if (components.headers && Object.keys(components.headers).length === 0) {
        delete components.headers;
      }
      if (components.securitySchemes && Object.keys(components.securitySchemes).length === 0) {
        delete components.securitySchemes;
      }
      if (Object.keys(components).length === 0) {
        delete (spec as Partial<OpenAPISpec>).components;
      }

      const result = JSON.stringify(spec, null, 2);

      if (isTelemetryEnabled && span) {
        const endpointCount = Array.from(pathGroups.values()).reduce(
          (sum, endpoints) => sum + endpoints.length,
          0
        );
        (span as any).setAttribute("export.endpointCount", endpointCount);
        (span as any).setAttribute("export.pathCount", pathGroups.size);
        (span as any).setAttribute(
          "export.schemaCount",
          Object.keys(spec.components.schemas || {}).length
        );
        (span as any).setAttribute("export.size", result.length);
        (span as any).setStatus({ code: 0 });
      }

      return result;
    } catch (error) {
      if (isTelemetryEnabled && span) {
        (span as any).recordException(error as Error);
        (span as any).setStatus({
          code: 2,
          message: getErrorMessage(error),
        });
      }
      throw error;
    } finally {
      endSpan(span);
    }
  }
}
