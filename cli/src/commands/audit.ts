/**
 * Audit command - Analyze relationship coverage, gaps, duplicates, and balance
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { getErrorMessage } from "../utils/errors.js";
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
import path from "path";

export interface AuditOptions {
  layer?: string;
  format?: AuditReportFormat;
  output?: string;
  verbose?: boolean;
  debug?: boolean;
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

    // Run coverage analysis
    let coverage;
    if (options.layer) {
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === options.layer);
      if (!layer) {
        throw new Error(`Layer not found: ${options.layer}`);
      }
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
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === options.layer);
      if (!layer) {
        throw new Error(`Layer not found: ${options.layer}`);
      }
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
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === options.layer);
      if (!layer) {
        throw new Error(`Layer not found: ${options.layer}`);
      }
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

    // Build audit report
    const report: AuditReport = {
      timestamp: new Date().toISOString(),
      model: {
        name: "Documentation Robotics Model",
        version: "1.0.0",
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
    console.error(ansis.red(`Error: ${message}`));
    if (options.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}
