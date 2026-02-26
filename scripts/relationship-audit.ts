#!/usr/bin/env -S node --loader tsx

/**
 * Standalone Relationship Audit Script
 *
 * Purpose:
 *   Performs comprehensive relationship quality analysis on the spec's relationship
 *   schema definitions (252 generated type definitions). This is a spec maintainer
 *   tool — it answers "is the specification's relationship type catalog well-covered?"
 *
 *   For auditing a project's actual model relationship instances, use `dr audit`.
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
 *   npm run audit:relationships                        # Run audit with text output
 *   npm run audit:relationships -- --format json       # JSON output
 *   npm run audit:relationships -- --output report.md  # Save to file
 *   npm run audit:relationships -- --layer api         # Audit specific layer
 *   npm run audit:relationships -- --threshold         # Exit 1 if quality issues detected
 *
 * Exit Codes:
 *   0 - Success (no issues or issues below threshold)
 *   1 - Quality issues detected (when --threshold flag used)
 *   2 - Script execution error
 */

import { fileURLToPath } from "url";
import { dirname, join, relative } from "path";
import { parseArgs } from "util";
import { AuditReport, CoverageMetrics } from "../cli/src/audit/types.js";
import { formatAuditReport, AuditReportFormat } from "../cli/src/export/audit-formatters.js";
import { writeFile, ensureDir } from "../cli/src/utils/file-io.js";
import { AuditOrchestrator } from "../cli/src/audit/relationships/spec/orchestrator.js";
import { AIEvaluator } from "../cli/src/audit/relationships/ai/evaluator.js";
import { AIEvaluationAbortError } from "../cli/src/audit/ai/runner.js";
import { CANONICAL_LAYER_NAMES } from "../cli/src/core/layers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const auditReportsDir = join(projectRoot, "audit-reports");

/**
 * Build the default output path for a relationship audit report.
 * Pattern: audit-reports/{layer|all}-relationships.{ext}
 */
function getDefaultOutputPath(layer: string | undefined, format: AuditReportFormat): string {
  const layerName = layer ?? "all";
  const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
  return join(auditReportsDir, `${layerName}-relationships.${ext}`);
}

interface ScriptOptions {
  layer?: string;
  format: AuditReportFormat;
  output?: string;
  verbose: boolean;
  threshold: boolean;
  enableAi: boolean;
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
      format: { type: "string", short: "f", default: "markdown" },
      output: { type: "string", short: "o" },
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
Standalone Relationship Audit Script (Spec Maintainer Tool)

Usage:
  npm run audit:relationships [options]
  tsx scripts/relationship-audit.ts [options]

Options:
  -l, --layer <name>       Audit specific layer only
  -f, --format <format>    Output format: text, json, markdown (default: markdown)
  -o, --output <file>      Override output path (default: audit-reports/{layer}-relationships.{ext})
  -v, --verbose            Show detailed analysis
  -t, --threshold          Exit with code 1 if quality issues detected
      --enable-ai          Run AI-assisted element evaluation (requires Claude CLI)
  -h, --help               Show this help message

Default output: audit-reports/{layer|all}-relationships.{md|json|txt}
AI output:      audit-reports/relationships/{element-recommendations,layer-reviews,inter-layer}/

Examples:
  npm run audit:relationships                                       # Full audit → audit-reports/all-relationships.md
  npm run audit:relationships -- --layer api                        # API layer → audit-reports/api-relationships.md
  npm run audit:relationships -- --format json                      # JSON → audit-reports/all-relationships.json
  npm run audit:relationships -- --layer data-model --format json   # → audit-reports/data-model-relationships.json
  npm run audit:relationships -- --threshold                        # Fail if quality issues found
  npm run audit:relationships -- --verbose                          # Detailed output
  npm run audit:relationships -- --enable-ai                        # With AI element evaluation

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

    // Use orchestrator to run all analysis steps
    const orchestrator = new AuditOrchestrator();
    const report = await orchestrator.runAudit({
      layer: options.layer,
      verbose: options.verbose,
      debug: options.verbose,
      projectRoot,
    });

    // Format output
    const output = formatAuditReport(report, {
      format: options.format,
      verbose: options.verbose,
    });

    // Resolve output path: explicit override or default under audit-reports/
    const outputPath = options.output
      ? join(originalCwd, options.output)
      : getDefaultOutputPath(options.layer, options.format);
    await ensureDir(dirname(outputPath));
    await writeFile(outputPath, output);
    console.error(`✓ Audit report written to ${relative(originalCwd, outputPath)}`);

    // Run AI-assisted evaluation if requested
    if (options.enableAi) {
      console.error("\n⏳ Running AI-assisted evaluation (requires Claude CLI)...");
      console.error("   Output: audit-reports/relationships/\n");

      const aiEvaluator = new AIEvaluator({ outputDir: join(projectRoot, "audit-reports", "relationships") });
      const getPredicatesForLayer = async (layer: string): Promise<string[]> =>
        orchestrator.getPredicatesForLayer(layer);

      let aiAborted = false;

      // Step 1: Evaluate low-coverage (isolated) node types
      console.error("   Step 1/3: Evaluating low-coverage elements...");
      try {
        await aiEvaluator.evaluateLowCoverageElements(report.coverage as CoverageMetrics[], getPredicatesForLayer);
      } catch (error) {
        if (error instanceof AIEvaluationAbortError) {
          console.error("   ❌ AI aborted — Claude CLI unavailable. Skipping remaining AI steps.");
          aiAborted = true;
        } else {
          console.error("   ⚠️  Error evaluating low-coverage elements:", error instanceof Error ? error.message : String(error));
        }
      }

      // Step 2: Review layer coherence
      if (!aiAborted) {
        console.error("   Step 2/3: Reviewing layer coherence...");
        try {
          const layerNames = (report.coverage as CoverageMetrics[]).map((c) => c.layer);
          await aiEvaluator.reviewLayerCoherence(layerNames, report.coverage as CoverageMetrics[]);
        } catch (error) {
          if (error instanceof AIEvaluationAbortError) {
            console.error("   ❌ AI aborted — Claude CLI unavailable. Skipping remaining AI steps.");
            aiAborted = true;
          } else {
            console.error("   ⚠️  Error reviewing layer coherence:", error instanceof Error ? error.message : String(error));
          }
        }
      }

      // Step 3: Validate inter-layer references
      if (!aiAborted) {
        console.error("   Step 3/3: Validating inter-layer references...");
        try {
          const layerPairs: Array<{ source: string; target: string }> = [];
          for (let i = 0; i < CANONICAL_LAYER_NAMES.length; i++) {
            for (let j = i + 1; j < CANONICAL_LAYER_NAMES.length; j++) {
              layerPairs.push({ source: CANONICAL_LAYER_NAMES[i], target: CANONICAL_LAYER_NAMES[j] });
            }
          }
          await aiEvaluator.validateInterLayerReferences(layerPairs);
        } catch (error) {
          if (error instanceof AIEvaluationAbortError) {
            console.error("   ❌ AI aborted — Claude CLI unavailable.");
          } else {
            console.error("   ⚠️  Error validating inter-layer references:", error instanceof Error ? error.message : String(error));
          }
        }
      }

      if (!aiAborted) {
        console.error("\n✓ AI evaluation complete. Results in audit-reports/relationships/");
      }
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
