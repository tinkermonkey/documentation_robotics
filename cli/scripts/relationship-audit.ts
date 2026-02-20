#!/usr/bin/env -S node --loader tsx

/**
 * Standalone Relationship Audit Script
 *
 * Purpose:
 *   Performs comprehensive relationship quality analysis on a Documentation Robotics model
 *   without requiring the full CLI. Useful for CI/CD pipelines, pre-commit hooks, and
 *   automated quality checks.
 *
 * Features:
 *   - Coverage analysis (isolation, density, predicate utilization)
 *   - Gap detection (missing relationships based on standard patterns)
 *   - Duplicate detection (semantically overlapping relationships)
 *   - Balance assessment (relationship density per node type)
 *   - Connectivity analysis (graph structure, components, chains)
 *   - Multiple output formats (text, JSON, markdown)
 *   - Exit codes for CI/CD integration
 *
 * Usage:
 *   npm run audit                        # Run audit with text output
 *   npm run audit -- --format json       # JSON output
 *   npm run audit -- --output report.md  # Save to file
 *   npm run audit -- --layer api         # Audit specific layer
 *   npm run audit -- --threshold         # Exit 1 if quality issues detected
 *
 * Exit Codes:
 *   0 - Success (no issues or issues below threshold)
 *   1 - Quality issues detected (when --threshold flag used)
 *   2 - Script execution error
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseArgs } from "util";
import { RelationshipCatalog } from "../src/core/relationship-catalog.js";
import { getAllLayers } from "../src/generated/layer-registry.js";
import { CoverageAnalyzer } from "../src/audit/analysis/coverage-analyzer.js";
import { DuplicateDetector } from "../src/audit/analysis/duplicate-detector.js";
import { GapAnalyzer } from "../src/audit/analysis/gap-analyzer.js";
import { BalanceAssessor } from "../src/audit/analysis/balance-assessor.js";
import { RelationshipGraph } from "../src/audit/graph/relationship-graph.js";
import { ConnectivityAnalyzer } from "../src/audit/graph/connectivity.js";
import { AuditReport, ConnectivityStats } from "../src/audit/types.js";
import { formatAuditReport, AuditReportFormat } from "../src/export/audit-formatters.js";
import { readFile, writeFile, ensureDir } from "../src/utils/file-io.js";
import * as yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

interface ScriptOptions {
  layer?: string;
  format: AuditReportFormat;
  output?: string;
  verbose: boolean;
  threshold: boolean;
  help: boolean;
}

/**
 * Quality thresholds for CI/CD gates
 */
const QUALITY_THRESHOLDS = {
  maxIsolationPercentage: 20.0,  // Max 20% isolated node types
  minDensity: 1.5,                // Min 1.5 relationships per node type
  maxHighPriorityGaps: 10,        // Max 10 high-priority gaps
  maxDuplicates: 5,               // Max 5 duplicate candidates
};

/**
 * Parse command line arguments
 */
function parseArguments(): ScriptOptions {
  const { values } = parseArgs({
    options: {
      layer: { type: "string", short: "l" },
      format: { type: "string", short: "f", default: "text" },
      output: { type: "string", short: "o" },
      verbose: { type: "boolean", short: "v", default: false },
      threshold: { type: "boolean", short: "t", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  return {
    layer: values.layer as string | undefined,
    format: (values.format as AuditReportFormat) || "text",
    output: values.output as string | undefined,
    verbose: values.verbose as boolean,
    threshold: values.threshold as boolean,
    help: values.help as boolean,
  };
}

/**
 * Display help message
 */
function showHelp(): void {
  console.log(`
Standalone Relationship Audit Script

Usage:
  npm run audit [options]
  tsx scripts/relationship-audit.ts [options]

Options:
  -l, --layer <name>       Audit specific layer only
  -f, --format <format>    Output format: text, json, markdown (default: text)
  -o, --output <file>      Write output to file instead of stdout
  -v, --verbose            Show detailed analysis
  -t, --threshold          Exit with code 1 if quality issues detected
  -h, --help               Show this help message

Examples:
  npm run audit                              # Run full audit
  npm run audit -- --layer api               # Audit API layer only
  npm run audit -- --format json             # JSON output
  npm run audit -- --output report.md        # Save markdown report
  npm run audit -- --threshold               # Fail if quality issues found
  npm run audit -- --verbose --format text   # Detailed text report

Quality Thresholds (for --threshold flag):
  - Isolation:        Max ${QUALITY_THRESHOLDS.maxIsolationPercentage}%
  - Density:          Min ${QUALITY_THRESHOLDS.minDensity} relationships/node
  - High-Pri Gaps:    Max ${QUALITY_THRESHOLDS.maxHighPriorityGaps}
  - Duplicates:       Max ${QUALITY_THRESHOLDS.maxDuplicates}

Exit Codes:
  0 - Success
  1 - Quality issues detected (with --threshold)
  2 - Execution error
  `);
}

/**
 * Check if audit report exceeds quality thresholds
 */
function checkThresholds(report: AuditReport): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check isolation percentage
  for (const coverage of report.coverage) {
    if (coverage.isolationPercentage > QUALITY_THRESHOLDS.maxIsolationPercentage) {
      issues.push(
        `Layer ${coverage.layer}: Isolation ${coverage.isolationPercentage.toFixed(1)}% exceeds threshold ${QUALITY_THRESHOLDS.maxIsolationPercentage}%`
      );
    }

    // Check density
    if (coverage.relationshipsPerNodeType < QUALITY_THRESHOLDS.minDensity) {
      issues.push(
        `Layer ${coverage.layer}: Density ${coverage.relationshipsPerNodeType.toFixed(2)} below threshold ${QUALITY_THRESHOLDS.minDensity}`
      );
    }
  }

  // Check high-priority gaps
  const highPriorityGaps = report.gaps.filter((g) => g.priority === "high").length;
  if (highPriorityGaps > QUALITY_THRESHOLDS.maxHighPriorityGaps) {
    issues.push(
      `High-priority gaps: ${highPriorityGaps} exceeds threshold ${QUALITY_THRESHOLDS.maxHighPriorityGaps}`
    );
  }

  // Check duplicates
  if (report.duplicates.length > QUALITY_THRESHOLDS.maxDuplicates) {
    issues.push(
      `Duplicate candidates: ${report.duplicates.length} exceeds threshold ${QUALITY_THRESHOLDS.maxDuplicates}`
    );
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * Main audit execution
 */
async function runAudit(options: ScriptOptions): Promise<void> {
  try {
    // Save original working directory for output file resolution
    const originalCwd = process.cwd();

    // Change to project root for model access
    process.chdir(projectRoot);

    if (options.verbose) {
      console.error("Loading relationship catalog...");
    }

    // Load catalog
    const catalog = new RelationshipCatalog();
    await catalog.load();

    if (options.verbose) {
      console.error("Initializing analyzers...");
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

    if (options.verbose) {
      console.error("Running coverage analysis...");
    }

    // Helper function to find layer by ID
    const findLayerById = (layerId: string) => {
      const layers = getAllLayers();
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) {
        throw new Error(`Layer not found: ${layerId}`);
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

    if (options.verbose) {
      console.error("Running duplicate detection...");
    }

    // Run duplicate detection
    const duplicates = options.layer
      ? duplicateDetector.detectDuplicatesByLayer(options.layer)
      : duplicateDetector.detectDuplicates();

    if (options.verbose) {
      console.error("Running gap analysis...");
    }

    // Run gap analysis
    let gaps;
    if (options.layer) {
      const layer = findLayerById(options.layer);
      gaps = gapAnalyzer.analyzeLayer(layer);
    } else {
      gaps = gapAnalyzer.analyzeAll();
    }

    if (options.verbose) {
      console.error("Running balance assessment...");
    }

    // Run balance assessment
    let balance;
    if (options.layer) {
      const layer = findLayerById(options.layer);
      balance = balanceAssessor.assessLayer(layer);
    } else {
      balance = balanceAssessor.assessAll();
    }

    if (options.verbose) {
      console.error("Running connectivity analysis...");
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

    if (options.verbose) {
      console.error("Loading model metadata...");
    }

    // Load model metadata from manifest (with fallback to defaults)
    let modelName = "Documentation Robotics Model";
    let modelVersion = "1.0.0";

    try {
      const manifestPath = join(
        projectRoot,
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
      // Use defaults if manifest not available
      if (options.verbose) {
        console.error("Using default model metadata (manifest not found)");
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

    if (options.verbose) {
      console.error("Formatting output...");
    }

    // Format output
    const output = formatAuditReport(report, {
      format: options.format,
      verbose: options.verbose,
    });

    // Write to file or stdout
    if (options.output) {
      // Use original working directory for output path resolution
      const outputPath = join(originalCwd, options.output);
      const outputDir = dirname(outputPath);

      // Ensure output directory exists
      await ensureDir(outputDir);

      // Write file
      await writeFile(outputPath, output);

      console.error(`✓ Audit report written to ${options.output}`);
    } else {
      // Print to stdout
      console.log(output);
    }

    // Check quality thresholds if requested
    if (options.threshold) {
      const thresholdCheck = checkThresholds(report);

      if (!thresholdCheck.passed) {
        console.error("\n⚠️  Quality threshold violations detected:");
        for (const issue of thresholdCheck.issues) {
          console.error(`  - ${issue}`);
        }
        process.exit(1);
      } else if (options.verbose) {
        console.error("✓ All quality thresholds passed");
      }
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Audit failed: ${message}`);
    if (error instanceof Error && error.stack && options.verbose) {
      console.error(error.stack);
    }
    process.exit(2);
  }
}

/**
 * Script entry point
 */
async function main(): Promise<void> {
  const options = parseArguments();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  await runAudit(options);
}

main();
