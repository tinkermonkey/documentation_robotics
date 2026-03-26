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
import * as YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = dirname(dirname(__filename));

async function generateOpenAPISpec() {
  try {
    console.log("🔨 Generating OpenAPI specification...");

    // Load model
    let model: Model;
    try {
      console.log("📦 Loading model...");
      model = await Model.load(projectRoot, { lazyLoad: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to load model:", message);
      throw error;
    }

    // Create server instance
    console.log("🚀 Creating server instance...");
    const server = new VisualizationServer(model, { authEnabled: false });

    // Get the OpenAPI spec from the server using public API
    // Note: getOpenAPIDocument always returns 3.1.0 regardless of the openapi parameter
    // This is a limitation of @hono/zod-openapi which only supports 3.1.0
    // The version will be manually adjusted below to match the hand-maintained spec
    const spec = server.getOpenAPIDocument({
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

    // Normalize OpenAPI version to 3.0.3 (project standard per CLAUDE.md)
    // @hono/zod-openapi only supports 3.1.0, so we normalize it back after generation
    if (spec.openapi === '3.1.0' || spec.openapi === '3.1') {
      spec.openapi = '3.0.3';
    }

    // Convert to valid YAML using the yaml package
    // Generate file header documenting how this spec is maintained
    const specYaml = `# AUTO-GENERATED: This OpenAPI specification is programmatically generated.
# DO NOT EDIT MANUALLY - all changes will be overwritten on next generation.
# To update this spec, modify the route schemas in server.ts (using Zod schemas),
# then regenerate with: npm run generate:openapi
# This ensures the specification always matches the actual implementation.

${YAML.stringify(spec, { indent: 2 }).trimEnd()}
`;

    // Write spec to file (to repo root docs/, not cli/docs/)
    const outputPath = join(projectRoot, "..", "docs", "api-spec.yaml");
    try {
      console.log(`📝 Writing OpenAPI spec to ${outputPath}...`);
      await writeFile(outputPath, specYaml, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to write spec file:", message);
      throw error;
    }

    console.log("✅ OpenAPI specification generated successfully!");
    console.log(`📄 Spec location: ${outputPath}`);
    console.log("🌐 View spec at: http://localhost:8080/api-docs");
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("Failed to"))) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("❌ Failed to generate OpenAPI specification:", message);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

generateOpenAPISpec();
