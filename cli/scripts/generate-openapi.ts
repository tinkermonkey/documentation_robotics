#!/usr/bin/env tsx

/**
 * Generate OpenAPI specification from visualization server
 * Exports the spec to docs/api-spec.yaml for documentation and static serving
 */

import { writeFile } from "fs/promises";
import { VisualizationServer } from "../src/server/server.js";
import { Model } from "../src/core/model.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(dirname(__filename));

async function generateOpenAPISpec() {
  try {
    console.log("🔨 Generating OpenAPI specification...");

    // Load model
    console.log("📦 Loading model...");
    const model = await Model.load(projectRoot, { lazyLoad: true });

    // Create server instance
    console.log("🚀 Creating server instance...");
    const server = new VisualizationServer(model, { authEnabled: false });

    // Get the OpenAPI spec from the server
    const spec = (server as any).app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Documentation Robotics Visualization Server API",
        version: "0.1.0",
        description: "API specification for the DR CLI visualization server",
        contact: {
          name: "Documentation Robotics",
          url: "https://github.com/tinkermonkey/documentation_robotics",
        },
        license: {
          name: "ISC",
        },
      },
      servers: [
        { url: "http://localhost:8080", description: "Local development server" },
      ],
    });

    // Convert to YAML-friendly format
    const specYaml = `# This file is auto-generated from the visualization server routes.
# DO NOT EDIT MANUALLY - regenerate using: npm run generate:openapi
#
# OpenAPI specification for Documentation Robotics Visualization Server
# Generated on ${new Date().toISOString()}

openapi: 3.0.3
info:
  title: Documentation Robotics Visualization Server API
  version: 0.1.0
  description: API specification for the DR CLI visualization server
  contact:
    name: Documentation Robotics
    url: https://github.com/tinkermonkey/documentation_robotics
  license:
    name: ISC

servers:
  - url: http://localhost:8080
    description: Local development server

tags:
  - name: Health
    description: Server health and status
  - name: Schema
    description: JSON Schema specifications
  - name: Model
    description: Architecture model data
  - name: Changesets
    description: Model changesets and history
  - name: Annotations
    description: User annotations on model elements
  - name: WebSocket
    description: Real-time updates via WebSocket

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: token
    QueryAuth:
      type: apiKey
      in: query
      name: token

${JSON.stringify(spec, null, 2).split("\n").join("\n")}
`;

    // Write spec to file
    const outputPath = join(projectRoot, "docs", "api-spec.yaml");
    console.log(`📝 Writing OpenAPI spec to ${outputPath}...`);
    await writeFile(outputPath, specYaml, "utf-8");

    console.log("✅ OpenAPI specification generated successfully!");
    console.log(`📄 Spec location: ${outputPath}`);
    console.log("🌐 View spec at: http://localhost:8080/api-docs");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to generate OpenAPI specification:", message);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

generateOpenAPISpec();
