/**
 * Audit command - Analyze relationship coverage, gaps, duplicates, and balance
 */

import ansis from "ansis";
import { readFile, writeFile, ensureDir } from "../utils/file-io.js";
import { getErrorMessage, CLIError } from "../utils/errors.js";
import { RelationshipCatalog } from "../core/relationship-catalog.js";
import { getAllLayers } from "../generated/layer-registry.js";
import { CoverageAnalyzer } from "../audit/analysis/coverage-analyzer.js";
import { DuplicateDetector } from "../audit/analysis/duplicate-detector.js";
import { GapAnalyzer } from "../audit/analysis/gap-analyzer.js";
import { BalanceAssessor } from "../audit/analysis/balance-assessor.js";
import { RelationshipGraph } from "../audit/graph/relationship-graph.js";
import { ConnectivityAnalyzer } from "../audit/graph/connectivity.js";
import { AuditReport, ConnectivityStats } from "../audit/types.js";
import { formatAuditReport, AuditReportFormat } from "../export/audit-formatters.js";
import { SnapshotStorage } from "../audit/snapshot-storage.js";
import path from "path";
import * as yaml from "yaml";

export interface AuditOptions {
  layer?: string;
  format?: AuditReportFormat;
  output?: string;
  verbose?: boolean;
  debug?: boolean;
  saveSnapshot?: boolean;
}

/**
 * Run the audit command
 */
export async function auditCommand(options: AuditOptions): Promise<void> {
  try {
    if (options.debug) {
      console.log(ansis.dim("Loading relationship catalog..."));
    }

    // Load catalog
    const catalog = new RelationshipCatalog();
    await catalog.load();

    if (options.debug) {
      console.log(ansis.dim("Initializing analyzers..."));
    }

    // Initialize analyzers
    const coverageAnalyzer = new CoverageAnalyzer(catalog);
    const duplicateDetector = new DuplicateDetector(catalog);
    const gapAnalyzer = new GapAnalyzer();
    const balanceAssessor = new BalanceAssessor();

    // Initialize graph for connectivity analysis
    const graph = new RelationshipGraph();
    if (options.layer) {
      await graph.build(options.layer);
    } else {
      await graph.build();
    }
    const connectivityAnalyzer = new ConnectivityAnalyzer(graph, catalog);

    if (options.debug) {
      console.log(ansis.dim("Running coverage analysis..."));
    }

    // Helper function to find layer by ID
    const findLayerById = (layerId: string) => {
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) {
        throw new CLIError(`Layer not found: ${layerId}`);
      }
      return layer;
    };

    // Run coverage analysis
    let coverage;
    if (options.layer) {
      const layer = findLayerById(options.layer);
      coverage = [await coverageAnalyzer.analyzeLayer(layer)];
    } else {
      coverage = await coverageAnalyzer.analyzeAll();
    }

    if (options.debug) {
      console.log(ansis.dim("Running duplicate detection..."));
    }

    // Run duplicate detection
    const duplicates = options.layer
      ? duplicateDetector.detectDuplicatesByLayer(options.layer)
      : duplicateDetector.detectDuplicates();

    if (options.debug) {
      console.log(ansis.dim("Running gap analysis..."));
    }

    // Run gap analysis
    let gaps;
    if (options.layer) {
      const layer = findLayerById(options.layer);
      gaps = gapAnalyzer.analyzeLayer(layer);
    } else {
      gaps = gapAnalyzer.analyzeAll();
    }

    if (options.debug) {
      console.log(ansis.dim("Running balance assessment..."));
    }

    // Run balance assessment
    let balance;
    if (options.layer) {
      const layer = findLayerById(options.layer);
      balance = balanceAssessor.assessLayer(layer);
    } else {
      balance = balanceAssessor.assessAll();
    }

    if (options.debug) {
      console.log(ansis.dim("Running connectivity analysis..."));
    }

    // Run connectivity analysis
    const components = connectivityAnalyzer.findConnectedComponents();
    const degrees = connectivityAnalyzer.calculateDegreeDistribution();
    const transitiveChains = await connectivityAnalyzer.findTransitiveChains();
    const rawStats = connectivityAnalyzer.getConnectivityStats();

    // Convert connectivity stats to match AuditReport format
    const connectivityStats: ConnectivityStats = {
      totalNodes: rawStats.nodeCount,
      totalEdges: rawStats.edgeCount,
      connectedComponents: rawStats.componentCount,
      largestComponentSize: rawStats.largestComponentSize,
      isolatedNodes: rawStats.isolatedNodeCount,
      averageDegree: rawStats.averageDegree,
      transitiveChainCount: transitiveChains.length,
    };

    if (options.debug) {
      console.log(ansis.dim("Generating audit report..."));
    }

    // Load model metadata from manifest (with fallback to defaults)
    let modelName = "Documentation Robotics Model";
    let modelVersion = "1.0.0";

    try {
      const manifestPath = path.join(
        process.cwd(),
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      const manifestContent = await readFile(manifestPath);
      const manifest = yaml.parse(manifestContent) as {
        name: string;
        version: string;
      };
      modelName = manifest.name;
      modelVersion = manifest.version;
    } catch (error) {
      // Use defaults if manifest not available (e.g., in tests)
      if (options.debug) {
        console.log(ansis.dim("Using default model metadata (manifest not found)"));
      }
    }

    // Build audit report
    const report: AuditReport = {
      timestamp: new Date().toISOString(),
      model: {
        name: modelName,
        version: modelVersion,
      },
      coverage,
      duplicates,
      gaps,
      balance,
      connectivity: {
        components,
        degrees,
        transitiveChains,
        stats: connectivityStats,
      },
    };

    // Determine output format
    let format: AuditReportFormat = options.format || "text";

    // Auto-detect format from output file extension
    if (options.output) {
      const ext = path.extname(options.output).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    // Format output
    const output = formatAuditReport(report, {
      format,
      verbose: options.verbose,
    });

    // Save snapshot if requested
    if (options.saveSnapshot) {
      if (options.debug) {
        console.log(ansis.dim("Saving audit snapshot..."));
      }

      const storage = new SnapshotStorage();
      const metadata = await storage.save(report);

      console.log(
        ansis.green(`✓ Snapshot saved: ${metadata.id}`),
      );
      console.log(ansis.dim(`  Timestamp: ${new Date(metadata.timestamp).toLocaleString()}`));
    }

    // Write to file or stdout
    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      const outputDir = path.dirname(outputPath);

      // Ensure output directory exists
      await ensureDir(outputDir);

      // Write file
      await writeFile(outputPath, output);

      console.log(ansis.green(`✓ Audit report written to ${options.output}`));
    } else {
      // Print to stdout
      console.log(output);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (options.debug) {
      console.error(error);
    }
    throw new CLIError(
      `Audit failed: ${message}`
    );
  }
}
