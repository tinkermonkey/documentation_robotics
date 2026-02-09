#!/usr/bin/env node

/**
 * Migration script: Convert spec node data instances (.node.json) to JSON Schemas (.node.schema.json)
 *
 * Transforms each spec/nodes/{layer}/{type}.node.json from a data instance conforming to
 * spec-node.schema.json (meta-schema) into a JSON Schema that extends the base spec-node schema.
 *
 * Usage:
 *   node cli/scripts/convert-nodes-to-schemas.mjs [--dry-run] [--verbose]
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = path.resolve(__dirname, "../../spec");
const NODES_DIR = path.join(SPEC_DIR, "nodes");

const BASE_URI =
  "https://github.com/tinkermonkey/documentation_robotics/spec/nodes";

// --- Attribute Classification ---

/**
 * Classify an attribute as base_field, relationship_placeholder, infrastructure, or type_specific.
 */
function classifyAttribute(key, attrSpec) {
  // base_field: id, name, or description with empty description
  if (
    (key === "id" || key === "name") &&
    attrSpec.description === ""
  ) {
    return "base_field";
  }
  // description with empty description is a base field
  if (key === "description" && attrSpec.description === "") {
    return "base_field";
  }

  // relationship_placeholder: description contains "relationship" (case-insensitive) AND type is "array"
  if (
    attrSpec.type === "array" &&
    typeof attrSpec.description === "string" &&
    /relationship/i.test(attrSpec.description)
  ) {
    return "relationship_placeholder";
  }

  // infrastructure: documentation attribute
  if (key === "documentation") {
    return "infrastructure";
  }

  // infrastructure: properties with "Cross-layer properties"
  if (
    key === "properties" &&
    typeof attrSpec.description === "string" &&
    attrSpec.description === "Cross-layer properties"
  ) {
    return "infrastructure";
  }

  // infrastructure: source with "Source code reference"
  if (
    key === "source" &&
    typeof attrSpec.description === "string" &&
    /source code reference/i.test(attrSpec.description)
  ) {
    return "infrastructure";
  }

  // infrastructure: x-source-reference
  if (key === "x-source-reference") {
    return "infrastructure";
  }

  return "type_specific";
}

/**
 * Convert an AttributeSpec to a JSON Schema property.
 */
function convertToJsonSchemaProperty(attrSpec) {
  const prop = {};

  switch (attrSpec.type) {
    case "enum":
      prop.type = "string";
      if (attrSpec.enum_values && attrSpec.enum_values.length > 0) {
        prop.enum = attrSpec.enum_values;
      }
      break;
    case "string":
      prop.type = "string";
      if (attrSpec.format) {
        prop.format = attrSpec.format;
      }
      break;
    case "integer":
      prop.type = "integer";
      break;
    case "number":
      prop.type = "number";
      break;
    case "boolean":
      prop.type = "boolean";
      break;
    case "array":
      prop.type = "array";
      break;
    case "object":
      prop.type = "object";
      break;
    default:
      prop.type = "string";
      break;
  }

  if (attrSpec.description && attrSpec.description !== "") {
    prop.description = attrSpec.description;
  }

  if (attrSpec.default !== undefined) {
    prop.default = attrSpec.default;
  }

  return prop;
}

/**
 * Convert a .node.json data instance to a .node.schema.json JSON Schema.
 */
function convertNodeToSchema(nodeData, layer, typeName) {
  const specNodeId = nodeData.id; // e.g. "motivation.goal"
  const typeSegment = specNodeId.split(".").slice(1).join("."); // e.g. "goal"

  // Classify and filter attributes
  const typeSpecificAttrs = {};
  const classifications = { base_field: 0, relationship_placeholder: 0, infrastructure: 0, type_specific: 0 };

  for (const [key, attrSpec] of Object.entries(nodeData.attributes || {})) {
    const classification = classifyAttribute(key, attrSpec);
    classifications[classification]++;

    if (classification === "type_specific") {
      typeSpecificAttrs[key] = convertToJsonSchemaProperty(attrSpec);
    }
  }

  // Process required_attributes
  const baseFields = new Set(["id", "name"]);
  const originalRequired = nodeData.required_attributes || [];
  const typeRequired = [];
  let requireDescription = false;

  for (const req of originalRequired) {
    if (baseFields.has(req)) {
      continue; // Already on base schema
    }
    if (req === "description") {
      requireDescription = true;
      continue;
    }
    // Only include if it's a type-specific attribute
    if (typeSpecificAttrs[req] !== undefined) {
      typeRequired.push(req);
    }
  }

  // Build the schema
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `${BASE_URI}/${layer}/${typeName}.node.schema.json`,
    title: nodeData.name,
    description: nodeData.description,
    allOf: [
      {
        $ref: "../../schemas/base/spec-node.schema.json",
      },
    ],
    properties: {
      spec_node_id: { const: specNodeId },
      layer_id: { const: layer },
      type: { const: typeSegment },
    },
  };

  // Add description to top-level required if needed (narrows base)
  if (requireDescription) {
    schema.required = ["description"];
  }

  // Add attributes property
  const attributesSchema = {
    type: "object",
  };

  if (Object.keys(typeSpecificAttrs).length > 0) {
    attributesSchema.properties = typeSpecificAttrs;
  }

  if (typeRequired.length > 0) {
    attributesSchema.required = typeRequired;
  }

  attributesSchema.additionalProperties = false;

  schema.properties.attributes = attributesSchema;

  return { schema, classifications };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");

  console.log("Converting spec node data instances to JSON Schemas");
  console.log("===================================================");
  console.log(`Spec nodes directory: ${NODES_DIR}`);
  console.log(`Dry run: ${dryRun}`);
  console.log("");

  const layers = await fs.readdir(NODES_DIR);
  let totalConverted = 0;
  let totalDroppedAttrs = { base_field: 0, relationship_placeholder: 0, infrastructure: 0 };
  let totalTypeSpecific = 0;
  let emptyNodes = 0;
  const errors = [];

  for (const layer of layers.sort()) {
    const layerDir = path.join(NODES_DIR, layer);
    const stat = await fs.stat(layerDir);
    if (!stat.isDirectory()) continue;

    const files = await fs.readdir(layerDir);
    const nodeFiles = files.filter((f) => f.endsWith(".node.json"));

    if (verbose) {
      console.log(`\nLayer: ${layer} (${nodeFiles.length} nodes)`);
    }

    for (const file of nodeFiles) {
      const filePath = path.join(layerDir, file);
      const typeName = file.replace(".node.json", "");

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const nodeData = JSON.parse(content);

        const { schema, classifications } = convertNodeToSchema(
          nodeData,
          layer,
          typeName
        );

        totalDroppedAttrs.base_field += classifications.base_field;
        totalDroppedAttrs.relationship_placeholder += classifications.relationship_placeholder;
        totalDroppedAttrs.infrastructure += classifications.infrastructure;
        totalTypeSpecific += classifications.type_specific;

        const hasTypeAttrs =
          schema.properties.attributes.properties &&
          Object.keys(schema.properties.attributes.properties).length > 0;
        if (!hasTypeAttrs) {
          emptyNodes++;
        }

        if (verbose) {
          const dropped =
            classifications.base_field +
            classifications.relationship_placeholder +
            classifications.infrastructure;
          console.log(
            `  ${typeName}: ${classifications.type_specific} kept, ${dropped} dropped`
          );
        }

        if (!dryRun) {
          // Write the new schema file
          const schemaPath = path.join(
            layerDir,
            `${typeName}.node.schema.json`
          );
          await fs.writeFile(
            schemaPath,
            JSON.stringify(schema, null, 2) + "\n"
          );

          // Delete the old data file
          await fs.unlink(filePath);
        }

        totalConverted++;
      } catch (err) {
        errors.push(`${layer}/${file}: ${err.message}`);
        console.error(`  ERROR: ${layer}/${file}: ${err.message}`);
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total files converted: ${totalConverted}`);
  console.log(`Type-specific attributes kept: ${totalTypeSpecific}`);
  console.log(
    `Attributes dropped: ${totalDroppedAttrs.base_field} base_field, ${totalDroppedAttrs.relationship_placeholder} relationship_placeholder, ${totalDroppedAttrs.infrastructure} infrastructure`
  );
  console.log(`Empty nodes (zero type-specific attrs): ${emptyNodes}`);
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
  }
  console.log(
    dryRun ? "\n(Dry run - no files were modified)" : "\nConversion complete!"
  );

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
