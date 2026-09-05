#!/usr/bin/env -S node --loader tsx

/**
 * Standalone Node Audit Script
 *
 * Purpose:
 *   Performs comprehensive node type quality analysis on the spec's node
 *   schema definitions. This is a spec maintainer tool — it answers
 *   "is the specification's node type catalog well-defined, semantically
 *   grounded, and layer-appropriate?"
 *
 *   For auditing a project's actual model instances, use `dr audit`.
 *
 * Features:
 *   - Definition quality scoring (descriptions, attribute documentation)
 *   - Semantic overlap detection (potentially duplicate node types per layer)
 *   - Schema completeness check (layer.json vs actual schema files)
 *   - Layer alignment check (node type names vs inspiring standard keywords)
 *   - Multiple output formats (text, JSON, markdown)
 *   - Exit codes for CI/CD integration
 *
 * Usage:
 *   npm run audit:nodes                        # Run audit with text output
 *   npm run audit:nodes -- --format json       # JSON output
 *   npm run audit:nodes -- --output report.md  # Save to file
 *   npm run audit:nodes -- --layer api         # Audit specific layer
 *   npm run audit:nodes -- --threshold         # Exit 1 if quality issues detected
 *
 * Exit Codes:
 *   0 - Success (no issues or issues below threshold)
 *   1 - Quality issues detected (when --threshold flag used)
 *   2 - Script execution error
 */

import { fileURLToPath } from "url";
import { dirname, join, relative } from "path";
import { parseArgs } from "util";
import type { NodeAuditReport } from "../cli/src/audit/nodes/types.js";
import { formatNodeAuditReport, AuditReportFormat } from "../cli/src/export/audit-formatters.js";
import { writeFile, ensureDir } from "../cli/src/utils/file-io.js";
import { NodeAuditOrchestrator } from "../cli/src/audit/nodes/spec/orchestrator.js";
import { NodeSchemaLoader } from "../cli/src/audit/nodes/spec/loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const specDir = join(projectRoot, "spec");
const auditReportsDir = join(projectRoot, "audit-reports");

/**
 * Build the default output path for a node audit report.
 * Pattern: audit-reports/{layer|all}-nodes.{ext}
 */
function getDefaultOutputPath(layer: string | undefined, format: AuditReportFormat): string {
  const layerName = layer ?? "all";
  const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
  return join(auditReportsDir, `${layerName}-nodes.${ext}`);
}

interface ScriptOptions {
  layer?: string;
  format: AuditReportFormat;
  output?: string;
  saveJson?: string;
  verbose: boolean;
  threshold: boolean;
  enableAi: boolean;
  help: boolean;
}

/**
 * Quality thresholds for CI/CD gates
 */
const NODE_QUALITY_THRESHOLDS = {
  minAvgQualityScore: 70,         // Avg definition score >= 70/100 per layer
  maxEmptyDescriptions: 5,        // At most 5 empty descriptions per layer
  maxGenericDescriptions: 10,     // At most 10 generic descriptions per layer
  maxCompletenessIssues: 0,       // Zero missing/orphaned schemas (hard correctness gate)
  maxHighConfidenceOverlaps: 3,   // At most 3 high-confidence semantic duplicates
};

/**
 * Parse command line arguments
 */
function parseArguments(): ScriptOptions {
  const { values } = parseArgs({
    options: {
      layer: { type: "string", short: "l" },
      format: { type: "string", short: "f", default: "markdown" },
      output: { type: "string", short: "o" },
      "save-json": { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
      threshold: { type: "boolean", short: "t", default: false },
      "enable-ai": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  return {
    layer: values.layer as string | undefined,
    format: (values.format as AuditReportFormat) || "text",
    output: values.output as string | undefined,
    saveJson: values["save-json"] as string | undefined,
    verbose: values.verbose as boolean,
    threshold: values.threshold as boolean,
    enableAi: values["enable-ai"] as boolean,
    help: values.help as boolean,
  };
}

/**
 * Display help message
 */
function showHelp(): void {
  console.log(`
Standalone Node Audit Script (Spec Maintainer Tool)

Usage:
  npm run audit:nodes [options]
  tsx scripts/node-audit.ts [options]

Options:
  -l, --layer <name>       Audit specific layer only (default: all layers, one file each)
  -f, --format <format>    Output format: text, json, markdown (default: markdown)
  -o, --output <file>      Override output path — only valid with --layer
      --save-json <file>   Also save raw audit data as JSON (for /dr-audit-resolve)
  -v, --verbose            Show detailed per-node analysis
  -t, --threshold          Exit with code 1 if quality issues detected
      --enable-ai          Enable AI-assisted layer alignment and documentation evaluation
  -h, --help               Show this help message

Default output (no --layer):  audit-reports/{layerId}-nodes.{ext}  × 12 layers
Default output (--layer x):  audit-reports/{layerId}-nodes.{ext}

Examples:
  npm run audit:nodes                                        # All 12 layers → audit-reports/{id}-nodes.md
  npm run audit:nodes -- --enable-ai                         # All 12 layers with AI alignment scoring
  npm run audit:nodes -- --layer api                         # API layer only → audit-reports/api-nodes.md
  npm run audit:nodes -- --format json                       # JSON → audit-reports/{id}-nodes.json (×12)
  npm run audit:nodes -- --layer data-model --format json    # → audit-reports/data-model-nodes.json
  npm run audit:nodes -- --enable-ai --layer data-store      # AI audit for data-store only
  npm run audit:nodes -- --threshold                         # Fail if any layer fails quality thresholds
  npm run audit:nodes -- --verbose                           # Detailed output

Quality Thresholds (for --threshold flag):
  - Avg Quality Score:      Min ${NODE_QUALITY_THRESHOLDS.minAvgQualityScore}/100 per layer
  - Empty Descriptions:     Max ${NODE_QUALITY_THRESHOLDS.maxEmptyDescriptions} per layer
  - Generic Descriptions:   Max ${NODE_QUALITY_THRESHOLDS.maxGenericDescriptions} per layer
  - Completeness Issues:    Max ${NODE_QUALITY_THRESHOLDS.maxCompletenessIssues} (hard gate)
  - High-Conf Overlaps:     Max ${NODE_QUALITY_THRESHOLDS.maxHighConfidenceOverlaps}

Exit Codes:
  0 - Success
  1 - Quality issues detected (with --threshold)
  2 - Execution error
  `);
}

/**
 * Check if audit report exceeds quality thresholds
 */
function checkThresholds(report: NodeAuditReport): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Per-layer checks
  for (const summary of report.layerSummaries) {
    if (summary.avgQualityScore < NODE_QUALITY_THRESHOLDS.minAvgQualityScore) {
      issues.push(
        `Layer ${summary.layerId}: Avg quality score ${summary.avgQualityScore.toFixed(1)} below threshold ${NODE_QUALITY_THRESHOLDS.minAvgQualityScore}`
      );
    }
    if (summary.emptyDescriptionCount > NODE_QUALITY_THRESHOLDS.maxEmptyDescriptions) {
      issues.push(
        `Layer ${summary.layerId}: ${summary.emptyDescriptionCount} empty descriptions exceed threshold ${NODE_QUALITY_THRESHOLDS.maxEmptyDescriptions}`
      );
    }
    if (summary.genericDescriptionCount > NODE_QUALITY_THRESHOLDS.maxGenericDescriptions) {
      issues.push(
        `Layer ${summary.layerId}: ${summary.genericDescriptionCount} generic descriptions exceed threshold ${NODE_QUALITY_THRESHOLDS.maxGenericDescriptions}`
      );
    }
  }

  // Completeness (hard gate)
  if (report.completenessIssues.length > NODE_QUALITY_THRESHOLDS.maxCompletenessIssues) {
    issues.push(
      `Schema completeness: ${report.completenessIssues.length} issue(s) found (threshold: ${NODE_QUALITY_THRESHOLDS.maxCompletenessIssues})`
    );
  }

  // High-confidence overlaps
  const highOverlaps = report.overlaps.filter((o) => o.confidence === "high").length;
  if (highOverlaps > NODE_QUALITY_THRESHOLDS.maxHighConfidenceOverlaps) {
    issues.push(
      `High-confidence overlaps: ${highOverlaps} exceeds threshold ${NODE_QUALITY_THRESHOLDS.maxHighConfidenceOverlaps}`
    );
  }

  // AI score thresholds (only checked when AI evaluation was run)
  if (report.aiReviews) {
    for (const review of report.aiReviews) {
      if (review.avgAlignmentScore < 65) {
        issues.push(
          `Layer ${review.layerId}: AI alignment score ${review.avgAlignmentScore.toFixed(1)} below threshold 65`
        );
      }
      if (review.avgDocumentationScore < 60) {
        issues.push(
          `Layer ${review.layerId}: AI documentation score ${review.avgDocumentationScore.toFixed(1)} below threshold 60`
        );
      }
    }
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Run audit for a single layer (or all layers combined if layer is undefined).
 * Writes primary output + JSON sidecar to audit-reports/.
 */
async function runSingleLayerAudit(options: ScriptOptions, originalCwd: string): Promise<void> {
  const orchestrator = new NodeAuditOrchestrator();
  const report = await orchestrator.runAudit({
    layer: options.layer,
    verbose: options.verbose,
    specDir,
    enableAi: options.enableAi,
  });

  const output = formatNodeAuditReport(report, {
    format: options.format,
    verbose: options.verbose,
  });

  const outputPath = options.output
    ? join(originalCwd, options.output)
    : getDefaultOutputPath(options.layer, options.format);
  await ensureDir(dirname(outputPath));
  await writeFile(outputPath, output);
  console.error(`✓ Node audit report written to ${relative(originalCwd, outputPath)}`);

  // Save raw JSON sidecar for tooling (e.g., /dr-audit-resolve).
  // Always written alongside the primary report unless the primary IS already JSON.
  const explicitJsonPath = options.saveJson ? join(originalCwd, options.saveJson) : undefined;
  const autoJsonPath = options.format !== "json"
    ? getDefaultOutputPath(options.layer, "json")
    : undefined;
  const jsonSidecarPath = explicitJsonPath ?? autoJsonPath;
  if (jsonSidecarPath) {
    await ensureDir(dirname(jsonSidecarPath));
    await writeFile(jsonSidecarPath, JSON.stringify(report, null, 2));
    console.error(`✓ Node audit data saved to ${relative(originalCwd, jsonSidecarPath)}`);
  }

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
}

/**
 * Fan-out: run one audit per layer, writing separate output files for each.
 * Produces audit-reports/{layerId}-nodes.{ext} and a JSON sidecar per layer —
 * equivalent to running `npm run audit:nodes -- --layer {id}` for each of the 12 layers.
 */
async function runPerLayerAudit(options: ScriptOptions, originalCwd: string): Promise<void> {
  const loader = new NodeSchemaLoader(specDir);
  const layerDefs = await loader.loadLayerDefinitions();

  console.error(`Running node audit for ${layerDefs.length} layers individually...`);

  let thresholdFailures = 0;
  const failedLayers: string[] = [];

  for (const layerDef of layerDefs) {
    console.error(`\n[${layerDef.number}/${layerDefs.length}] ${layerDef.id}`);

    try {
      const orchestrator = new NodeAuditOrchestrator();
      const report = await orchestrator.runAudit({
        layer: layerDef.id,
        verbose: options.verbose,
        specDir,
        enableAi: options.enableAi,
      });

      const output = formatNodeAuditReport(report, {
        format: options.format,
        verbose: options.verbose,
      });

      const outputPath = getDefaultOutputPath(layerDef.id, options.format);
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, output);
      console.error(`  ✓ Written to ${relative(originalCwd, outputPath)}`);

      // Always write a JSON sidecar so /dr-audit-resolve can find it
      if (options.format !== "json") {
        const jsonPath = getDefaultOutputPath(layerDef.id, "json");
        await ensureDir(dirname(jsonPath));
        await writeFile(jsonPath, JSON.stringify(report, null, 2));
        console.error(`  ✓ JSON data: ${relative(originalCwd, jsonPath)}`);
      }

      if (options.threshold) {
        const thresholdCheck = checkThresholds(report);
        if (!thresholdCheck.passed) {
          thresholdFailures++;
          for (const issue of thresholdCheck.issues) {
            console.error(`  ⚠️  ${issue}`);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Failed to audit layer ${layerDef.id}: ${message}`);
      if (error instanceof Error && error.stack && options.verbose) {
        console.error(error.stack);
      }
      failedLayers.push(layerDef.id);
    }
  }

  if (failedLayers.length > 0) {
    console.error(`\n❌ ${failedLayers.length} layer(s) failed: ${failedLayers.join(", ")}`);
    process.exit(2);
  }

  if (thresholdFailures > 0) {
    console.error(`\n⚠️  ${thresholdFailures} layer(s) failed quality thresholds.`);
    process.exit(1);
  }
}

/**
 * Main audit execution
 */
async function runAudit(options: ScriptOptions): Promise<void> {
  try {
    const originalCwd = process.cwd();

    if (options.layer) {
      // Single-layer (or explicit combined) audit
      await runSingleLayerAudit(options, originalCwd);
    } else {
      // No --layer: process each layer individually
      await runPerLayerAudit(options, originalCwd);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Node audit failed: ${message}`);
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
