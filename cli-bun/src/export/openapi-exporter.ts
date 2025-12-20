import type { Model } from "../core/model.js";
import type { Exporter, ExportOptions } from "./types.js";

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, unknown>;
  components: {
    schemas?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    requestBodies?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  externalDocs?: { url: string; description?: string };
  security?: unknown[];
}

/**
 * OpenAPI 3.0 Exporter for layer 6 (API)
 */
export class OpenAPIExporter implements Exporter {
  name = "OpenAPI";
  supportedLayers = ["api"];

  async export(model: Model, _options: ExportOptions = {}): Promise<string> {
    const layer = await model.getLayer("api");
    if (!layer) {
      throw new Error("No API layer found in model");
    }

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
    const pathGroups = new Map<string, Array<{ method: string; element: any }>>();

    for (const element of layer.listElements()) {
      if (element.type === "endpoint") {
        const path = element.getProperty<string>("path") || "/";
        const method = (element.getProperty<string>("method") || "get").toLowerCase();

        if (!pathGroups.has(path)) {
          pathGroups.set(path, []);
        }
        pathGroups.get(path)!.push({ method, element });
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

        pathItem[method] = operation;
      }

      (spec.paths as Record<string, unknown>)[path] = pathItem;
    }

    // Collect all schema definitions from elements
    for (const element of layer.listElements()) {
      if (element.type === "schema") {
        const schemaName = element.getProperty<string>("schemaName") || element.id;
        const schema = element.getProperty("schema");
        if (schema) {
          spec.components.schemas![schemaName] = schema;
        }
      }
    }

    // Collect security schemes if defined
    for (const element of layer.listElements()) {
      if (element.type === "security-scheme") {
        const schemeName = element.name;
        const schemeType = element.getProperty<string>("type");
        if (schemeType) {
          const scheme: Record<string, unknown> = {
            type: schemeType,
          };

          const schemeProp = element.getProperty("scheme");
          if (schemeProp) {
            scheme.scheme = schemeProp;
          }

          const bearerFormat = element.getProperty("bearerFormat");
          if (bearerFormat) {
            scheme.bearerFormat = bearerFormat;
          }

          const flows = element.getProperty("flows");
          if (flows) {
            scheme.flows = flows;
          }

          const openIdConnectUrl = element.getProperty("openIdConnectUrl");
          if (openIdConnectUrl) {
            scheme.openIdConnectUrl = openIdConnectUrl;
          }

          if (element.description) {
            scheme.description = element.description;
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

    return JSON.stringify(spec, null, 2);
  }
}
