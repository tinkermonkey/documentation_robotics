import type { Model } from "../core/model.js";
import type { Importer, ImportOptions, ImportResult } from "./types.js";
import type { Span } from "@opentelemetry/api";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * OpenAPI 3.0 Importer for layer 6 (API)
 * Parses OpenAPI JSON specifications and creates graph nodes/edges
 */
export class OpenAPIImporter implements Importer {
  name = "OpenAPI";
  supportedFormats = ["json"];

  async import(data: string, model: Model, _options: ImportOptions = {}): Promise<ImportResult> {
    const span: Span | null = isTelemetryEnabled ? startSpan("import.format.openapi") : null;
    const result: ImportResult = {
      success: false,
      nodesAdded: 0,
      edgesAdded: 0,
      errorsCount: 0,
      errors: [],
    };

    try {
      // Validate merge strategy - only 'add' is supported
      if (_options.mergeStrategy && _options.mergeStrategy !== 'add') {
        result.errors.push({
          message: `OpenAPI importer only supports 'add' merge strategy. Requested: '${_options.mergeStrategy}'.`
        });
        result.errorsCount++;
        return result;
      }

      // Parse JSON specification
      let spec: any;
      try {
        spec = JSON.parse(data);
      } catch (e) {
        result.errors.push({
          message: "Failed to parse OpenAPI specification: Invalid JSON",
        });
        result.errorsCount++;
        return result;
      }

      if (!spec.openapi && !spec.swagger) {
        result.errors.push({
          message: "Not a valid OpenAPI specification (missing openapi or swagger field)",
        });
        result.errorsCount++;
        return result;
      }

      // Create root document node with unique ID based on spec title
      const titlePart = (spec.info?.title || "api")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const docNodeId = `api.openapi-document.${titlePart}`;
      const docNode = {
        id: docNodeId,
        layer: "api",
        type: "openapi-document",
        name: spec.info?.title || "OpenAPI Document",
        description: spec.info?.description,
        properties: {
          version: spec.info?.version || "1.0.0",
          servers: spec.servers || [],
          info: spec.info || {},
        },
      };

      model.graph.addNode(docNode);
      result.nodesAdded++;

      // Create endpoint nodes from paths
      if (spec.paths) {
        const pathEntries = Object.entries(spec.paths);
        for (const [pathName, pathSpec] of pathEntries) {
          const pathSpec_ = pathSpec as Record<string, any>;
          const methods = Object.keys(pathSpec_).filter((k) =>
            ["get", "post", "put", "delete", "patch", "head", "options"].includes(k)
          );

          for (const method of methods) {
            const operation = pathSpec_[method];
            const operationId =
              operation.operationId || `${method}-${pathName}`.replace(/[^a-zA-Z0-9-]/g, "-");
            const endpointId = `api.endpoint.${operationId}`;

            // Create endpoint node
            const endpointNode = {
              id: endpointId,
              layer: "api",
              type: "endpoint",
              name: operation.summary || `${method.toUpperCase()} ${pathName}`,
              description: operation.description,
              properties: {
                method: method.toUpperCase(),
                path: pathName,
                tags: operation.tags || [],
                parameters: operation.parameters || [],
                requestBody: operation.requestBody,
                responses: operation.responses || {},
                security: operation.security,
                deprecated: operation.deprecated || false,
              },
            };

            model.graph.addNode(endpointNode);
            result.nodesAdded++;

            // Create edge from document to endpoint
            const docEdge = {
              id: `${docNodeId}-composes-${endpointId}`,
              source: docNodeId,
              destination: endpointId,
              predicate: "composes",
              properties: {},
            };

            model.graph.addEdge(docEdge);
            result.edgesAdded++;
          }
        }
      }

      // Create schema nodes from components.schemas
      if (spec.components?.schemas) {
        const schemaEntries = Object.entries(spec.components.schemas);
        for (const [schemaName, schemaSpec] of schemaEntries) {
          const schemaId = `api.schema.${schemaName}`;

          const schemaNode = {
            id: schemaId,
            layer: "api",
            type: "schema",
            name: schemaName,
            description: (schemaSpec as Record<string, any>).description,
            properties: {
              schemaName,
              schema: schemaSpec,
            },
          };

          model.graph.addNode(schemaNode);
          result.nodesAdded++;

          // Create edge from document to schema
          const schemaEdge = {
            id: `${docNodeId}-contains-${schemaId}`,
            source: docNodeId,
            destination: schemaId,
            predicate: "contains",
            properties: {},
          };

          model.graph.addEdge(schemaEdge);
          result.edgesAdded++;
        }
      }

      // Create security scheme nodes from components.securitySchemes
      if (spec.components?.securitySchemes) {
        const schemeEntries = Object.entries(spec.components.securitySchemes);
        for (const [schemeName, schemeSpec] of schemeEntries) {
          const schemeId = `api.security-scheme.${schemeName}`;
          const schemeSpec_ = schemeSpec as Record<string, any>;

          const securityNode = {
            id: schemeId,
            layer: "api",
            type: "security-scheme",
            name: schemeName,
            description: schemeSpec_.description,
            properties: {
              type: schemeSpec_.type,
              scheme: schemeSpec_.scheme,
              bearerFormat: schemeSpec_.bearerFormat,
              flows: schemeSpec_.flows,
              openIdConnectUrl: schemeSpec_.openIdConnectUrl,
            },
          };

          model.graph.addNode(securityNode);
          result.nodesAdded++;

          // Create edge from document to security scheme
          const secEdge = {
            id: `${docNodeId}-uses-${schemeId}`,
            source: docNodeId,
            destination: schemeId,
            predicate: "uses",
            properties: {},
          };

          model.graph.addEdge(secEdge);
          result.edgesAdded++;
        }
      }

      result.success = result.errorsCount === 0;

      if (isTelemetryEnabled && span) {
        span.setAttribute("import.nodesAdded", result.nodesAdded);
        span.setAttribute("import.edgesAdded", result.edgesAdded);
        span.setAttribute("import.errors", result.errorsCount);
        span.setStatus({ code: result.success ? 0 : 1 });
      }

      return result;
    } catch (error) {
      result.errors.push({
        message: getErrorMessage(error),
      });
      result.errorsCount++;

      if (isTelemetryEnabled && span) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: String(error) });
      }

      return result;
    } finally {
      endSpan(span);
    }
  }
}
