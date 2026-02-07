#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import Ajv from "ajv";

interface LayerSource {
  schemaPath: string;
  layerMetadata: {
    layerId: string;
    layerName: string;
    catalogVersion: string;
  };
  elementTypes: Record<string, any>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  instanceCount: number;
}

interface GenerationReport {
  timestamp: string;
  specLayers: ValidationResult;
  specNodes: ValidationResult;
  specNodeRelationships: ValidationResult;
  predicateCatalog: ValidationResult;
  totalInstancesGenerated: number;
  totalInstancesValid: number;
  success: boolean;
}

// Layer mapping from file names to canonical layer IDs
const LAYER_MAPPING = [
  { number: 1, id: "motivation", name: "Motivation Layer", filename: "01-motivation-layer" },
  { number: 2, id: "business", name: "Business Layer", filename: "02-business-layer" },
  { number: 3, id: "security", name: "Security Layer", filename: "03-security-layer" },
  { number: 4, id: "application", name: "Application Layer", filename: "04-application-layer" },
  { number: 5, id: "technology", name: "Technology Layer", filename: "05-technology-layer" },
  { number: 6, id: "api", name: "API Layer", filename: "06-api-layer" },
  { number: 7, id: "data-model", name: "Data Model Layer", filename: "07-data-model-layer" },
  { number: 8, id: "data-store", name: "Data Store Layer", filename: "08-data-store-layer" },
  { number: 9, id: "ux", name: "UX Layer", filename: "09-ux-layer" },
  { number: 10, id: "navigation", name: "Navigation Layer", filename: "10-navigation-layer" },
  { number: 11, id: "apm", name: "APM Observability Layer", filename: "11-apm-observability-layer" },
  { number: 12, id: "testing", name: "Testing Layer", filename: "12-testing-layer" },
];

const STANDARD_MAPPING: Record<number, { standard: string; version: string; url: string }> = {
  1: {
    standard: "ArchiMate 3.2",
    version: "3.2",
    url: "https://pubs.opengroup.org/architecture/archimate32-doc/",
  },
  2: {
    standard: "ArchiMate 3.2",
    version: "3.2",
    url: "https://pubs.opengroup.org/architecture/archimate32-doc/",
  },
  3: {
    standard: "NIST SP 800-53",
    version: "5.1",
    url: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf",
  },
  4: {
    standard: "ArchiMate 3.2",
    version: "3.2",
    url: "https://pubs.opengroup.org/architecture/archimate32-doc/",
  },
  5: {
    standard: "ArchiMate 3.2",
    version: "3.2",
    url: "https://pubs.opengroup.org/architecture/archimate32-doc/",
  },
  6: {
    standard: "OpenAPI 3.0",
    version: "3.0",
    url: "https://spec.openapis.org/oas/v3.0.0",
  },
  7: {
    standard: "JSON Schema Draft 7",
    version: "Draft 7",
    url: "https://json-schema.org/draft-07/",
  },
  8: {
    standard: "SQL 2016",
    version: "2016",
    url: "https://en.wikipedia.org/wiki/SQL:2016",
  },
  9: {
    standard: "HTML 5.3",
    version: "5.3",
    url: "https://html.spec.whatwg.org/",
  },
  10: {
    standard: "SPA Navigation Patterns",
    version: "1.0",
    url: "https://www.w3.org/TR/navigation-timing-2/",
  },
  11: {
    standard: "OpenTelemetry",
    version: "1.0",
    url: "https://opentelemetry.io/",
  },
  12: {
    standard: "IEEE 829-2008",
    version: "2008",
    url: "https://en.wikipedia.org/wiki/IEEE_829",
  },
};

async function readJson(filePath: string): Promise<any> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function writeJson(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

async function extractLayers(schemasDir: string): Promise<LayerSource[]> {
  const layers: LayerSource[] = [];

  for (const layer of LAYER_MAPPING) {
    const schemaPath = path.join(schemasDir, `${layer.filename}.schema.json`);

    try {
      const schema = await readJson(schemaPath);

      layers.push({
        schemaPath,
        layerMetadata: {
          layerId: layer.id,
          layerName: layer.name,
          catalogVersion: schema.layerMetadata?.catalogVersion || "0.8.0",
        },
        elementTypes: schema.definitions || {},
      });
    } catch (error) {
      console.error(`Failed to read schema for layer ${layer.id}:`, error);
    }
  }

  return layers;
}

async function generateSpecLayers(
  layers: LayerSource[],
  outputDir: string,
  dryRun: boolean
): Promise<ValidationResult> {
  const specLayers = [];
  const errors: string[] = [];

  for (const layer of layers) {
    const layerEntry = LAYER_MAPPING.find((l) => l.id === layer.layerMetadata.layerId);
    if (!layerEntry) {
      errors.push(`Could not find mapping for layer ${layer.layerMetadata.layerId}`);
      continue;
    }

    const specLayer = {
      id: layer.layerMetadata.layerId,
      number: layerEntry.number,
      name: layer.layerMetadata.layerName,
      description: `Layer ${layerEntry.number}: ${layer.layerMetadata.layerName}`,
      inspired_by: STANDARD_MAPPING[layerEntry.number],
      node_types: Object.keys(layer.elementTypes)
        .map((type) => `${layer.layerMetadata.layerId}.${type.toLowerCase()}`)
        .sort(),
    };

    specLayers.push(specLayer);

    if (!dryRun) {
      const filePath = path.join(outputDir, "layers", `${String(layerEntry.number).padStart(2, "0")}-${layer.layerMetadata.layerId}.layer.json`);
      await writeJson(filePath, specLayer);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    instanceCount: specLayers.length,
  };
}

async function generateSpecNodes(
  layers: LayerSource[],
  outputDir: string,
  dryRun: boolean
): Promise<ValidationResult> {
  const specNodes = [];
  const errors: string[] = [];

  for (const layer of layers) {
    const layerDir = path.join(outputDir, "nodes", layer.layerMetadata.layerId);

    for (const [typeName, typeDefinition] of Object.entries(layer.elementTypes)) {
      const specNode = {
        id: `${layer.layerMetadata.layerId}.${typeName.toLowerCase()}`,
        layer_id: layer.layerMetadata.layerId,
        name: typeName,
        description: typeDefinition.description || `${typeName} element in ${layer.layerMetadata.layerName}`,
        attributes: extractAttributes(typeDefinition.properties || {}),
        required_attributes: typeDefinition.required || [],
      };

      specNodes.push(specNode);

      if (!dryRun) {
        const filePath = path.join(layerDir, `${typeName.toLowerCase()}.node.json`);
        await writeJson(filePath, specNode);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    instanceCount: specNodes.length,
  };
}

function extractAttributes(
  properties: Record<string, any>
): Record<string, any> {
  const attributes: Record<string, any> = {};

  for (const [propName, propDef] of Object.entries(properties)) {
    // Skip relationship fields
    if (
      propName === "relationships" ||
      propName === "intraLayerRelationships" ||
      propName === "crossLayerRelationships"
    ) {
      continue;
    }

    if (propDef.type === "object" && propDef.$ref) {
      // Skip reference definitions
      continue;
    }

    attributes[propName] = {
      type: propDef.type || "string",
      description: propDef.description || "",
      ...(propDef.enum && { enum_values: propDef.enum }),
      ...(propDef.format && { format: propDef.format }),
    };
  }

  return attributes;
}


async function consolidatePredicates(
  schemasDir: string,
  outputDir: string,
  dryRun: boolean
): Promise<ValidationResult> {
  const errors: string[] = [];

  try {
    const predicatesDef = await readJson(path.join(schemasDir, "common", "predicates.schema.json"));

    // Transform predicates to match the required schema
    const normalizedPredicates: Record<string, any> = {};
    for (const [name, predDef] of Object.entries(predicatesDef.predicates || {})) {
      const pred = predDef as Record<string, any>;
      normalizedPredicates[name] = {
        predicate: pred.predicate || name,
        inverse: pred.inversePredicate || pred.inverse || "",
        category: pred.category || "structural",
        description: pred.description || "",
        ...(pred.archimateAlignment && { archimate_alignment: pred.archimateAlignment }),
        ...(pred.semantics && { semantics: pred.semantics }),
        ...(pred.defaultStrength && { default_strength: pred.defaultStrength }),
      };
    }

    const predicateCatalog = {
      predicates: normalizedPredicates,
    };

    if (!dryRun) {
      const filePath = path.join(outputDir, "predicates.json");
      await writeJson(filePath, predicateCatalog);
    }

    return {
      valid: errors.length === 0,
      errors,
      instanceCount: Object.keys(predicateCatalog.predicates).length,
    };
  } catch (error) {
    errors.push(`Failed to consolidate predicates: ${error}`);
    return {
      valid: false,
      errors,
      instanceCount: 0,
    };
  }
}

async function validateInstances(
  outputDir: string,
  schemasDir: string
): Promise<{ specLayers: ValidationResult; specNodes: ValidationResult; predicates: ValidationResult }> {
  const ajv = new Ajv({ strictSchema: false });

  const specLayerSchema = await readJson(path.join(schemasDir, "base", "spec-layer.schema.json"));
  const specNodeSchema = await readJson(path.join(schemasDir, "base", "spec-node.schema.json"));
  const predicateCatalogSchema = await readJson(path.join(schemasDir, "base", "predicate-catalog.schema.json"));

  const validateLayer = ajv.compile(specLayerSchema);
  const validateNode = ajv.compile(specNodeSchema);
  const validatePredicates = ajv.compile(predicateCatalogSchema);

  const results = {
    specLayers: { valid: true, errors: [] as string[], instanceCount: 0 },
    specNodes: { valid: true, errors: [] as string[], instanceCount: 0 },
    predicates: { valid: true, errors: [] as string[], instanceCount: 0 },
  };

  try {
    const layersDir = path.join(outputDir, "layers");
    const layers = await fs.readdir(layersDir);
    for (const file of layers) {
      if (file.endsWith(".layer.json")) {
        const data = await readJson(path.join(layersDir, file));
        if (!validateLayer(data)) {
          results.specLayers.valid = false;
          results.specLayers.errors.push(`${file}: ${JSON.stringify(validateLayer.errors)}`);
        }
        results.specLayers.instanceCount++;
      }
    }
  } catch (error) {
    results.specLayers.valid = false;
    results.specLayers.errors.push(`Failed to validate layers: ${error}`);
  }

  try {
    const nodesDir = path.join(outputDir, "nodes");
    const layers = await fs.readdir(nodesDir);
    for (const layer of layers) {
      const layerPath = path.join(nodesDir, layer);
      const files = await fs.readdir(layerPath);
      for (const file of files) {
        if (file.endsWith(".node.json")) {
          const data = await readJson(path.join(layerPath, file));
          if (!validateNode(data)) {
            results.specNodes.valid = false;
            results.specNodes.errors.push(`${layer}/${file}: ${JSON.stringify(validateNode.errors)}`);
          }
          results.specNodes.instanceCount++;
        }
      }
    }
  } catch (error) {
    results.specNodes.valid = false;
    results.specNodes.errors.push(`Failed to validate nodes: ${error}`);
  }

  try {
    const predicatesFile = path.join(outputDir, "predicates.json");
    const data = await readJson(predicatesFile);
    if (!validatePredicates(data)) {
      results.predicates.valid = false;
      results.predicates.errors.push(`predicates.json: ${JSON.stringify(validatePredicates.errors)}`);
    }
    results.predicates.instanceCount = 1;
  } catch (error) {
    results.predicates.valid = false;
    results.predicates.errors.push(`Failed to validate predicates: ${error}`);
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const validate = args.includes("--validate");
  const outputDefault = path.resolve(path.join(__dirname, "..", "..", "spec"));
  const outputDir = outputDefault;
  const schemasDir = path.join(outputDir, "schemas");

  console.log("📋 Specification Instance Generation Script");
  console.log("============================================");
  console.log(`Output directory: ${outputDir}`);
  console.log(`Schemas directory: ${schemasDir}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Validate: ${validate}`);
  console.log("");

  try {
    console.log("1️⃣  Extracting layers...");
    const layers = await extractLayers(schemasDir);
    console.log(`   ✓ Extracted ${layers.length} layers`);
    console.log("");

    console.log("2️⃣  Generating SpecLayer instances...");
    const specLayersResult = await generateSpecLayers(layers, outputDir, dryRun);
    console.log(`   ✓ Generated ${specLayersResult.instanceCount} SpecLayer instances`);
    if (specLayersResult.errors.length > 0) {
      console.log("   ⚠️  Errors:", specLayersResult.errors);
    }
    console.log("");

    console.log("3️⃣  Generating SpecNode instances...");
    const specNodesResult = await generateSpecNodes(layers, outputDir, dryRun);
    console.log(`   ✓ Generated ${specNodesResult.instanceCount} SpecNode instances`);
    if (specNodesResult.errors.length > 0) {
      console.log("   ⚠️  Errors:", specNodesResult.errors);
    }
    console.log("");

    console.log("4️⃣  Consolidating predicate catalog...");
    const predicatesResult = await consolidatePredicates(schemasDir, outputDir, dryRun);
    console.log(`   ✓ Consolidated ${predicatesResult.instanceCount} predicates`);
    if (predicatesResult.errors.length > 0) {
      console.log("   ⚠️  Errors:", predicatesResult.errors);
    }
    console.log("");

    let validationResults = {
      specLayers: { valid: true, errors: [] as string[], instanceCount: 0 },
      specNodes: { valid: true, errors: [] as string[], instanceCount: 0 },
      predicates: { valid: true, errors: [] as string[], instanceCount: 0 },
    };

    if (validate && !dryRun) {
      console.log("5️⃣  Validating generated instances...");
      try {
        validationResults = await validateInstances(outputDir, schemasDir);
      } catch (error) {
        console.error("Validation encountered an error:", error);
      }

      const allValid = validationResults.specLayers.valid && validationResults.specNodes.valid && validationResults.predicates.valid;

      console.log(`   ${allValid ? "✓" : "✗"} SpecLayers: ${validationResults.specLayers.instanceCount} instances`);
      if (!validationResults.specLayers.valid) {
        console.log("     Errors:", validationResults.specLayers.errors.slice(0, 3));
      }

      console.log(`   ${validationResults.specNodes.valid ? "✓" : "✗"} SpecNodes: ${validationResults.specNodes.instanceCount} instances`);
      if (!validationResults.specNodes.valid) {
        console.log("     Errors:", validationResults.specNodes.errors.slice(0, 3));
      }

      console.log(`   ${validationResults.predicates.valid ? "✓" : "✗"} Predicates: ${validationResults.predicates.instanceCount} instances`);
      if (!validationResults.predicates.valid) {
        console.log("     Errors:", validationResults.predicates.errors.slice(0, 3));
      }

      console.log("");
    }

    // Generate report
    const report: GenerationReport = {
      timestamp: new Date().toISOString(),
      specLayers: {
        valid: specLayersResult.valid,
        errors: specLayersResult.errors,
        instanceCount: specLayersResult.instanceCount,
      },
      specNodes: {
        valid: specNodesResult.valid,
        errors: specNodesResult.errors,
        instanceCount: specNodesResult.instanceCount,
      },
      specNodeRelationships: {
        valid: true,
        errors: [],
        instanceCount: 0, // Deferred to Phase 3: Relationship Validation & Cardinality Enforcement
      },
      predicateCatalog: {
        valid: predicatesResult.valid,
        errors: predicatesResult.errors,
        instanceCount: predicatesResult.instanceCount,
      },
      totalInstancesGenerated:
        specLayersResult.instanceCount + specNodesResult.instanceCount + predicatesResult.instanceCount,
      totalInstancesValid:
        (specLayersResult.valid ? specLayersResult.instanceCount : 0) +
        (specNodesResult.valid ? specNodesResult.instanceCount : 0) +
        (predicatesResult.valid ? predicatesResult.instanceCount : 0),
      success:
        specLayersResult.valid &&
        specNodesResult.valid &&
        predicatesResult.valid &&
        (!validate || (validationResults.specLayers.valid && validationResults.specNodes.valid && validationResults.predicates.valid)),
    };

    console.log("📊 Generation Report");
    console.log("====================");
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Total instances generated: ${report.totalInstancesGenerated}`);
    console.log(`Total instances valid: ${report.totalInstancesValid}`);
    console.log(`Success: ${report.success ? "✓ Yes" : "✗ No"}`);
    console.log("");

    if (!dryRun) {
      const reportPath = path.join(outputDir, "generation-report.json");
      await writeJson(reportPath, report);
      console.log(`Report saved to: ${reportPath}`);
    }

    process.exit(report.success ? 0 : 1);
  } catch (error) {
    console.error("❌ Generation failed:", error);
    process.exit(1);
  }
}

main();
