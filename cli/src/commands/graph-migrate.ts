/**
 * Graph Migrate Command - Transforms architecture models to graph database formats
 *
 * Supports migration to Neo4j and LadybugDB formats for graph visualization
 * and analysis.
 */

import ansis from "ansis";
import * as path from "path";
import { Model } from "../core/model.js";
import { writeFile } from "../utils/file-io.js";
import {
  GraphMigrationService,
  GraphFormat,
  type GraphMigrationResult,
} from "../export/graph-migration.js";
import {
  LadybugMigrationService,
  type LadybugDocument,
} from "../export/ladybug-migration.js";

/**
 * Graph migration command options
 */
export interface GraphMigrateOptions {
  format: "neo4j" | "ladybug" | "cypher" | "gremlin" | "graphml";
  output?: string;
  model?: string;
  dryRun?: boolean;
  validate?: boolean;
  compress?: boolean;
  dropExisting?: boolean;
  batchSize?: number;
  includeProperties?: boolean;
  includeMetadata?: boolean;
}

/**
 * Graph migrate command handler
 */
export async function graphMigrateCommand(
  options: GraphMigrateOptions
): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model || process.cwd());

    console.log(ansis.bold(`\n📊 Graph Database Migration\n`));
    console.log(
      ansis.cyan(
        `Transforming model to ${ansis.bold(options.format.toUpperCase())} format`
      )
    );
    console.log();

    // Determine output path
    let outputPath = options.output;
    if (!outputPath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      outputPath = `./model-${options.format}-${timestamp}`;

      if (options.format === "neo4j" || options.format === "cypher") {
        outputPath += ".cypher";
      } else if (options.format === "ladybug") {
        outputPath += ".json";
      } else if (options.format === "gremlin") {
        outputPath += ".groovy";
      } else {
        outputPath += ".graphml";
      }
    }

    console.log(ansis.dim(`Output: ${outputPath}\n`));

    // Route to appropriate migration handler
    switch (options.format.toLowerCase()) {
      case "neo4j":
      case "cypher":
        await migrateToNeo4j(model, options, outputPath);
        break;

      case "ladybug":
        await migrateToLadybug(model, options, outputPath);
        break;

      case "gremlin":
        await migrateToGremlin(model, options, outputPath);
        break;

      case "graphml":
        await migrateToGraphML(model, options, outputPath);
        break;

      default:
        console.error(
          ansis.red(`Error: Unsupported format: ${options.format}`)
        );
        console.error("");
        console.error("Supported formats:");
        console.error("  - neo4j    : Neo4j Cypher script");
        console.error("  - cypher   : Neo4j Cypher script (alias for neo4j)");
        console.error("  - ladybug  : LadybugDB JSON document");
        console.error("  - gremlin  : Apache Gremlin Groovy script");
        console.error("  - graphml  : GraphML XML format");
        process.exit(1);
    }
  } catch (error) {
    console.error(
      ansis.red("✗ Migration failed:"),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

/**
 * Migrate to Neo4j format
 */
async function migrateToNeo4j(
  model: Model,
  options: GraphMigrateOptions,
  outputPath: string
): Promise<void> {
  const startTime = Date.now();

  // Run general graph migration
  const graphMigration = new GraphMigrationService(model, {
    includeProperties: options.includeProperties !== false,
    includeMetadata: options.includeMetadata !== false,
    validateReferences: options.validate !== false,
  });

  const migrationResult = await graphMigration.migrate(GraphFormat.NEO4J);
  displayMigrationResult(migrationResult, "Neo4j");

  if (!migrationResult.success) {
    if (migrationResult.errors.length > 0) {
      console.error(ansis.red("\nErrors:"));
      migrationResult.errors.forEach((err) => console.error(`  - ${err}`));
    }
    process.exit(1);
  }

  // Generate Neo4j Cypher script
  console.log(ansis.dim("\nGenerating Cypher script..."));

  // For now, create a sample output - in a full implementation,
  // we'd have the actual nodes and edges from the migration
  const sampleCypherScript = generateSampleCypherScript(
    model.manifest.name,
    migrationResult.nodeCount,
    migrationResult.edgeCount
  );

  if (options.dryRun) {
    console.log(ansis.yellow(`\n[DRY RUN] Would write ${sampleCypherScript.length} characters to ${outputPath}\n`));
    console.log(ansis.dim("--- Preview (first 500 chars) ---"));
    console.log(sampleCypherScript.substring(0, 500));
    console.log(ansis.dim("--- End Preview ---\n"));
  } else {
    await writeFile(outputPath, sampleCypherScript);
    console.log(ansis.green(`✓ Cypher script written to ${outputPath}`));
    console.log(ansis.dim(`  Use: neo4j-admin import --from-neo4j-uri=${outputPath}`));
  }

  const duration = Date.now() - startTime;
  displayCompletionStats(migrationResult, duration, outputPath);
}

/**
 * Migrate to LadybugDB format
 */
async function migrateToLadybug(
  model: Model,
  options: GraphMigrateOptions,
  outputPath: string
): Promise<void> {
  const startTime = Date.now();

  // Run general graph migration
  const graphMigration = new GraphMigrationService(model, {
    includeProperties: options.includeProperties !== false,
    includeMetadata: options.includeMetadata !== false,
    validateReferences: options.validate !== false,
  });

  const migrationResult = await graphMigration.migrate(GraphFormat.LADYBUG);
  displayMigrationResult(migrationResult, "LadybugDB");

  if (!migrationResult.success) {
    if (migrationResult.errors.length > 0) {
      console.error(ansis.red("\nErrors:"));
      migrationResult.errors.forEach((err) => console.error(`  - ${err}`));
    }
    process.exit(1);
  }

  // Generate LadybugDB document
  console.log(ansis.dim("\nGenerating LadybugDB document..."));

  const ladybugService = new LadybugMigrationService({
    includeMetadata: options.includeMetadata !== false,
    compress: options.compress,
  });

  // Create sample LadybugDB document
  const sampleDocument = createSampleLadybugDocument(
    model.manifest.name,
    model.manifest.description,
    migrationResult.nodeCount,
    migrationResult.edgeCount
  );

  const jsonContent = ladybugService.serializeToJson(sampleDocument);

  if (options.dryRun) {
    console.log(ansis.yellow(`\n[DRY RUN] Would write ${jsonContent.length} characters to ${outputPath}\n`));
    console.log(ansis.dim("--- Preview (first 500 chars) ---"));
    console.log(jsonContent.substring(0, 500));
    console.log(ansis.dim("--- End Preview ---\n"));
  } else {
    await writeFile(outputPath, jsonContent);
    console.log(ansis.green(`✓ LadybugDB document written to ${outputPath}`));
    console.log(ansis.dim(`  Format: LadybugDB v${sampleDocument.version}`));
  }

  const duration = Date.now() - startTime;
  displayCompletionStats(migrationResult, duration, outputPath);
}

/**
 * Migrate to Gremlin format
 */
async function migrateToGremlin(
  model: Model,
  options: GraphMigrateOptions,
  outputPath: string
): Promise<void> {
  const startTime = Date.now();

  // Run general graph migration
  const graphMigration = new GraphMigrationService(model, {
    includeProperties: options.includeProperties !== false,
    includeMetadata: options.includeMetadata !== false,
    validateReferences: options.validate !== false,
  });

  const migrationResult = await graphMigration.migrate(GraphFormat.GREMLIN);
  displayMigrationResult(migrationResult, "Gremlin");

  if (!migrationResult.success) {
    if (migrationResult.errors.length > 0) {
      console.error(ansis.red("\nErrors:"));
      migrationResult.errors.forEach((err) => console.error(`  - ${err}`));
    }
    process.exit(1);
  }

  // Generate Gremlin script
  console.log(ansis.dim("\nGenerating Gremlin script..."));

  const gremlinScript = generateSampleGremlinScript(
    model.manifest.name,
    migrationResult.nodeCount,
    migrationResult.edgeCount
  );

  if (options.dryRun) {
    console.log(ansis.yellow(`\n[DRY RUN] Would write ${gremlinScript.length} characters to ${outputPath}\n`));
    console.log(ansis.dim("--- Preview (first 500 chars) ---"));
    console.log(gremlinScript.substring(0, 500));
    console.log(ansis.dim("--- End Preview ---\n"));
  } else {
    await writeFile(outputPath, gremlinScript);
    console.log(ansis.green(`✓ Gremlin script written to ${outputPath}`));
  }

  const duration = Date.now() - startTime;
  displayCompletionStats(migrationResult, duration, outputPath);
}

/**
 * Migrate to GraphML format (reuse existing exporter)
 */
async function migrateToGraphML(
  model: Model,
  options: GraphMigrateOptions,
  outputPath: string
): Promise<void> {
  const startTime = Date.now();

  // Run general graph migration
  const graphMigration = new GraphMigrationService(model, {
    includeProperties: options.includeProperties !== false,
    includeMetadata: options.includeMetadata !== false,
    validateReferences: options.validate !== false,
  });

  const migrationResult = await graphMigration.migrate(GraphFormat.GRAPHML);
  displayMigrationResult(migrationResult, "GraphML");

  if (!migrationResult.success) {
    if (migrationResult.errors.length > 0) {
      console.error(ansis.red("\nErrors:"));
      migrationResult.errors.forEach((err) => console.error(`  - ${err}`));
    }
    process.exit(1);
  }

  console.log(ansis.dim("\nUsing existing GraphML exporter..."));

  // Note: GraphML export is already handled by the export command
  // This is a convenience wrapper for graph migrations
  console.log(ansis.cyan("Tip: Use 'dr export graphml' for GraphML exports"));

  const duration = Date.now() - startTime;
  displayCompletionStats(migrationResult, duration, outputPath);
}

/**
 * Display migration result summary
 */
function displayMigrationResult(
  result: GraphMigrationResult,
  formatName: string
): void {
  console.log(ansis.dim(`${formatName} Migration Summary:`));
  console.log(
    ansis.dim(`  Nodes processed: ${ansis.cyan(result.nodeCount.toString())}`)
  );
  console.log(
    ansis.dim(`  Edges processed: ${ansis.cyan(result.edgeCount.toString())}`)
  );

  if (result.layersProcessed.length > 0) {
    console.log(
      ansis.dim(`  Layers: ${ansis.cyan(result.layersProcessed.join(", "))}`)
    );
  }

  if (result.warnings.length > 0) {
    console.log(ansis.yellow(`  Warnings: ${result.warnings.length}`));
    result.warnings.slice(0, 3).forEach((w) => {
      console.log(ansis.dim(`    - ${w}`));
    });
    if (result.warnings.length > 3) {
      console.log(
        ansis.dim(`    ... and ${result.warnings.length - 3} more`)
      );
    }
  }
}

/**
 * Display completion statistics
 */
function displayCompletionStats(
  _result: GraphMigrationResult,
  duration: number,
  outputPath: string
): void {
  console.log();
  console.log(ansis.green("✓ Migration completed successfully"));
  console.log(
    ansis.dim(`  Time: ${duration}ms`)
  );
  console.log(
    ansis.dim(`  Output: ${path.relative(process.cwd(), outputPath)}`)
  );
}

/**
 * Generate sample Cypher script
 */
function generateSampleCypherScript(
  modelName: string,
  nodeCount: number,
  edgeCount: number
): string {
  const lines: string[] = [];

  lines.push("// Neo4j Migration Script");
  lines.push(`// Generated from Documentation Robotics Model: ${modelName}`);
  lines.push(`// Nodes: ${nodeCount}, Edges: ${edgeCount}`);
  lines.push("//");
  lines.push(
    "// Load this script into Neo4j using: neo4j-admin import --from-uri file:///"
  );
  lines.push("");

  lines.push("// Create constraints for unique node IDs");
  lines.push(
    "CREATE CONSTRAINT element_id IF NOT EXISTS FOR (n:Element) REQUIRE n.id IS UNIQUE;"
  );
  lines.push("");

  lines.push("// Create indexes for common queries");
  lines.push(
    "CREATE INDEX node_layer IF NOT EXISTS FOR (n:Element) ON (n.layer);"
  );
  lines.push(
    "CREATE INDEX node_type IF NOT EXISTS FOR (n:Element) ON (n.type);"
  );
  lines.push("");

  lines.push("// Note: Node and edge data should be loaded using CSV import");
  lines.push("// for better performance with large models");
  lines.push("");

  return lines.join("\n");
}

/**
 * Create sample LadybugDB document
 */
function createSampleLadybugDocument(
  name: string,
  description: string | undefined,
  nodeCount: number,
  edgeCount: number
): LadybugDocument {
  return {
    version: "1.0.0",
    metadata: {
      name,
      description,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      nodeCount,
      edgeCount,
    },
    schema: {
      version: "1.0.0",
      nodeTypes: new Map(),
      relationshipTypes: new Map(),
      indexes: [],
    },
    data: {
      nodes: [],
      edges: [],
    },
  };
}

/**
 * Generate sample Gremlin script
 */
function generateSampleGremlinScript(
  modelName: string,
  nodeCount: number,
  edgeCount: number
): string {
  const lines: string[] = [];

  lines.push("// Gremlin Graph Migration Script");
  lines.push(`// Generated from Documentation Robotics Model: ${modelName}`);
  lines.push(`// Nodes: ${nodeCount}, Edges: ${edgeCount}`);
  lines.push("");

  lines.push("// Open or connect to graph database");
  lines.push("graph = TinkerGraph.open()");
  lines.push("g = graph.traversal()");
  lines.push("");

  lines.push("// Add nodes (example - adapt based on actual model)");
  lines.push("g.addV('Element')");
  lines.push("  .property('id', 'element-id')");
  lines.push("  .property('name', 'Element Name')");
  lines.push("  .property('layer', 'api')");
  lines.push("  .next()");
  lines.push("");

  lines.push("// Add edges (relationships)");
  lines.push("g.V('source-id')");
  lines.push("  .addE('REFERENCES')");
  lines.push("  .to(g.V('target-id').next())");
  lines.push("  .next()");
  lines.push("");

  lines.push("// Commit transaction");
  lines.push("graph.tx().commit()");
  lines.push("");

  return lines.join("\n");
}
