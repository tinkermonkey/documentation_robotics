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
 *   npm run audit:relationships                              # Run audit → both .md and .json
 *   npm run audit:relationships -- --format json             # JSON only
 *   npm run audit:relationships -- --output report.md        # Save to file (requires --format)
 *   npm run audit:relationships -- --layer api               # Audit specific layer
 *   npm run audit:relationships -- --threshold               # Exit 1 if quality issues detected
 *   npm run audit:relationships -- --enable-ai               # All 3 AI steps
 *   npm run audit:relationships -- --enable-ai --ai-step layers  # Layer reviews only
 *
 * Exit Codes:
 *   0 - Success (no issues or issues below threshold)
 *   1 - Quality issues detected (when --threshold flag used)
 *   2 - Script execution error
 */

import { fileURLToPath } from "url";
import { dirname, join, relative } from "path";
import { createWriteStream, mkdirSync } from "fs";
import { readFile, readdir } from "node:fs/promises";
import { parseArgs } from "util";
import { AuditReport, CoverageMetrics, GapCandidate } from "../cli/src/audit/types.js";
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

type AiStep = "elements" | "layers" | "inter-layer";
const AI_STEPS: AiStep[] = ["elements", "layers", "inter-layer"];

interface ScriptOptions {
  layer?: string;
  format?: AuditReportFormat; // undefined = write both json + markdown
  output?: string;
  verbose: boolean;
  threshold: boolean;
  enableAi: boolean;
  aiStep?: AiStep;
  mergeAi: boolean;
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
      format: { type: "string", short: "f" },
      output: { type: "string", short: "o" },
      verbose: { type: "boolean", short: "v", default: false },
      threshold: { type: "boolean", short: "t", default: false },
      "enable-ai": { type: "boolean", default: false },
      "ai-step": { type: "string" },
      "merge-ai": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  const rawAiStep = values["ai-step"] as string | undefined;
  if (rawAiStep !== undefined && !(AI_STEPS as string[]).includes(rawAiStep)) {
    console.error(`❌ Invalid --ai-step value: "${rawAiStep}". Must be one of: ${AI_STEPS.join(", ")}`);
    process.exit(2);
  }

  return {
    layer: values.layer as string | undefined,
    format: values.format ? (values.format as AuditReportFormat) : undefined,
    output: values.output as string | undefined,
    verbose: values.verbose as boolean,
    threshold: values.threshold as boolean,
    enableAi: values["enable-ai"] as boolean,
    aiStep: rawAiStep as AiStep | undefined,
    mergeAi: values["merge-ai"] as boolean,
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
  -f, --format <format>    Output format: text, json, markdown (default: both json + markdown)
  -o, --output <file>      Override output path, requires --format (default: audit-reports/{layer}-relationships.{ext})
  -v, --verbose            Show detailed analysis
  -t, --threshold          Exit with code 1 if quality issues detected
      --enable-ai          Run AI-assisted evaluation (requires Claude CLI); all 3 steps by default
      --ai-step <step>     Run only one AI step: elements | layers | inter-layer
      --merge-ai           Merge existing AI recommendation files into the JSON report (no AI calls)
  -h, --help               Show this help message

Default output: audit-reports/{layer|all}-relationships.md  AND  .json  (both written by default)
AI output:      audit-reports/relationships/{element-recommendations,layer-reviews,inter-layer-validation}/

AI Steps:
  elements      Evaluate low-coverage node types and suggest missing intra-layer relationships
  layers        Review each layer's relationship coherence against its governing standard
  inter-layer   Validate cross-layer reference direction (higher → lower only)

Note: --enable-ai and --merge-ai both automatically merge AI recommendations into the JSON
      output so that /dr-audit-resolve sees the complete picture in a single file.

Examples:
  npm run audit:relationships                                            # Full audit → both audit-reports/all-relationships.{md,json}
  npm run audit:relationships -- --layer api                             # API layer → both audit-reports/api-relationships.{md,json}
  npm run audit:relationships -- --format json                           # JSON only → audit-reports/all-relationships.json
  npm run audit:relationships -- --layer data-model --format json        # → audit-reports/data-model-relationships.json
  npm run audit:relationships -- --threshold                             # Fail if quality issues found
  npm run audit:relationships -- --verbose                               # Detailed output
  npm run audit:relationships -- --enable-ai                             # AI + merge → both .md and .json (json has merged AI gaps)
  npm run audit:relationships -- --enable-ai --ai-step elements          # Element recommendations only
  npm run audit:relationships -- --enable-ai --ai-step layers            # Layer reviews only
  npm run audit:relationships -- --enable-ai --ai-step inter-layer       # Inter-layer validation only
  npm run audit:relationships -- --merge-ai                              # Merge existing AI files into both outputs (no AI calls)

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
 * Load AI-generated relationship recommendations from saved files on disk and
 * convert them to GapCandidate objects ready to merge into an AuditReport.
 *
 * Reads from:
 *   {aiOutputDir}/element-recommendations/*.json  (RelationshipRecommendation[])
 *   {aiOutputDir}/layer-reviews/*.review.json     (LayerReview.recommendations[])
 *
 * The field mapping from RelationshipRecommendation to GapCandidate is:
 *   predicate    → suggestedPredicate
 *   justification → reason
 *   (all other fields are identical)
 */
async function loadAIRecommendationsAsGaps(
  aiOutputDir: string,
  layerFilter?: string
): Promise<GapCandidate[]> {
  const gaps: GapCandidate[] = [];

  const toGap = (rec: Record<string, unknown>): GapCandidate | null => {
    if (!rec.sourceNodeType || !rec.predicate || !rec.destinationNodeType) return null;
    return {
      sourceNodeType: rec.sourceNodeType as string,
      destinationNodeType: rec.destinationNodeType as string,
      suggestedPredicate: rec.predicate as string,
      reason: (rec.justification ?? rec.reason ?? "") as string,
      priority: (rec.priority ?? "medium") as "high" | "medium" | "low",
      standardReference: rec.standardReference as string | undefined,
      impactScore: (rec.impactScore ?? 55) as number,
      alignmentScore: (rec.alignmentScore ?? 45) as number,
    };
  };

  // Read element-recommendations/*.json
  const elemDir = join(aiOutputDir, "element-recommendations");
  try {
    const files = (await readdir(elemDir)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      if (layerFilter && !file.startsWith(layerFilter + ".")) continue;
      const raw = JSON.parse(await readFile(join(elemDir, file), "utf-8")) as {
        recommendations?: Record<string, unknown>[];
      };
      for (const rec of raw.recommendations ?? []) {
        const gap = toGap(rec);
        if (gap) gaps.push(gap);
      }
    }
  } catch {
    // directory may not exist yet
  }

  // Read layer-reviews/*.review.json
  const layerDir = join(aiOutputDir, "layer-reviews");
  try {
    const files = (await readdir(layerDir)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      if (layerFilter && !file.startsWith(layerFilter + ".")) continue;
      const raw = JSON.parse(await readFile(join(layerDir, file), "utf-8")) as {
        review?: { recommendations?: Record<string, unknown>[] };
      };
      for (const rec of raw.review?.recommendations ?? []) {
        const gap = toGap(rec);
        if (gap) gaps.push(gap);
      }
    }
  } catch {
    // directory may not exist yet
  }

  return gaps;
}

/**
 * Return a new AuditReport with newGaps merged into report.gaps.
 * Deduplicates on (sourceNodeType, suggestedPredicate, destinationNodeType).
 */
function mergeGapsIntoReport(report: AuditReport, newGaps: GapCandidate[]): AuditReport {
  const seen = new Set(
    report.gaps.map((g) => `${g.sourceNodeType}|${g.suggestedPredicate}|${g.destinationNodeType}`)
  );
  const merged: GapCandidate[] = [...report.gaps];
  for (const gap of newGaps) {
    const key = `${gap.sourceNodeType}|${gap.suggestedPredicate}|${gap.destinationNodeType}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(gap);
    }
  }
  return { ...report, gaps: merged };
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
    let report = await orchestrator.runAudit({
      layer: options.layer,
      verbose: options.verbose,
      debug: options.verbose,
      projectRoot,
    });

    // Determine which formats to write. When --format is not specified, write
    // both json and markdown so /dr-audit-resolve and human readers both work.
    const formats: AuditReportFormat[] = options.format
      ? [options.format]
      : ["markdown", "json"];

    // Track the JSON output path for the AI merge step below.
    let jsonOutputPath: string = getDefaultOutputPath(options.layer, "json");

    for (const fmt of formats) {
      const outputPath =
        options.output && options.format === fmt
          ? join(originalCwd, options.output)
          : getDefaultOutputPath(options.layer, fmt);
      if (fmt === "json") jsonOutputPath = outputPath;
      const output = formatAuditReport(report, { format: fmt, verbose: options.verbose });
      await ensureDir(dirname(outputPath));
      await writeFile(outputPath, output);
      console.error(`✓ Audit report written to ${relative(originalCwd, outputPath)}`);
    }

    // Run AI-assisted evaluation if requested
    if (options.enableAi) {
      const stepFilter = options.aiStep;
      const runAll = stepFilter === undefined;
      const stepLabel = stepFilter ? `step: ${stepFilter}` : "all steps";
      console.error(`\n⏳ Running AI-assisted evaluation (${stepLabel}, requires Claude CLI)...`);
      console.error("   Output: audit-reports/relationships/\n");

      const aiEvaluator = new AIEvaluator({ outputDir: join(projectRoot, "audit-reports", "relationships") });
      const getPredicatesForLayer = async (layer: string): Promise<string[]> =>
        orchestrator.getPredicatesForLayer(layer);

      let aiAborted = false;

      // Step 1: Evaluate low-coverage (isolated) node types
      if (!aiAborted && (runAll || stepFilter === "elements")) {
        console.error("   ▶ elements: Evaluating low-coverage elements...");
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
      }

      // Step 2: Review layer coherence
      if (!aiAborted && (runAll || stepFilter === "layers")) {
        console.error("   ▶ layers: Reviewing layer coherence...");
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
      if (!aiAborted && (runAll || stepFilter === "inter-layer")) {
        console.error("   ▶ inter-layer: Validating inter-layer references...");
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

    // Merge AI recommendations into the report and re-write the JSON output.
    // This runs after --enable-ai steps complete, and also for standalone --merge-ai
    // which reads previously saved AI files without making new AI calls.
    // Triggers whenever JSON is being written (explicit --format json, or default both).
    const writingJson = options.format === "json" || options.format === undefined;
    if (writingJson && (options.enableAi || options.mergeAi)) {
      const aiOutputDir = join(projectRoot, "audit-reports", "relationships");
      const aiGaps = await loadAIRecommendationsAsGaps(aiOutputDir, options.layer);
      if (aiGaps.length > 0) {
        report = mergeGapsIntoReport(report, aiGaps);
        const enrichedOutput = formatAuditReport(report, {
          format: "json",
          verbose: options.verbose,
        });
        await writeFile(jsonOutputPath, enrichedOutput);
        const newTotal = report.gaps.length;
        console.error(
          `✓ Merged ${aiGaps.length} AI-generated gap recommendations into report (${newTotal} total gaps)`
        );
      } else if (options.mergeAi) {
        console.error(
          "⚠️  No AI recommendation files found in audit-reports/relationships/. Run --enable-ai first."
        );
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
 * Tee stdout and stderr to a timestamped log file.
 *
 * The log file captures everything written to stdout/stderr for the lifetime
 * of the process, giving a complete record of each audit run. The original
 * streams continue to behave normally (output still appears on the terminal).
 *
 * Returns the absolute path of the log file so callers can print it.
 */
function setupLogging(logDir: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/T/, "_")
    .replace(/[:.]/g, "-")
    .slice(0, 19); // "2026-02-27_14-30-00"
  const logPath = join(logDir, `relationship-run-${timestamp}.log`);

  mkdirSync(logDir, { recursive: true });
  const logStream = createWriteStream(logPath, { flags: "w" });
  logStream.write(`=== Relationship Audit Run: ${new Date().toISOString()} ===\n\n`);

  const origStdout = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  const origStderr = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    logStream.write(chunk);
    return (origStdout as (...args: unknown[]) => boolean)(chunk, ...rest);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    logStream.write(chunk);
    return (origStderr as (...args: unknown[]) => boolean)(chunk, ...rest);
  };

  return logPath;
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

  const logDir = join(projectRoot, "audit-reports", "relationships");
  const logPath = setupLogging(logDir);
  console.error(`📝 Logging stdout/stderr to ${relative(projectRoot, logPath)}`);

  await runAudit(options);
}

main();
