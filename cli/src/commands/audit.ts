/**
 * Audit command - Analyze relationship coverage, gaps, duplicates, and balance
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { getErrorMessage, CLIError } from "../utils/errors.js";
import { formatAuditReport, AuditReportFormat } from "../export/audit-formatters.js";
import { SnapshotStorage } from "../audit/snapshot-storage.js";
import { AuditOrchestrator } from "../audit/audit-orchestrator.js";
import { PipelineOrchestrator } from "../audit/pipeline/index.js";
import { formatDate } from "../utils/date-utils.js";
import path from "path";

export interface AuditOptions {
  layer?: string;
  format?: AuditReportFormat;
  output?: string;
  verbose?: boolean;
  debug?: boolean;
  saveSnapshot?: boolean;
  /** Run the full pipeline with before/after AI evaluation */
  pipeline?: boolean;
  /** Enable AI-assisted evaluation in pipeline mode */
  enableAI?: boolean;
  /** Claude API key for AI evaluation */
  claudeApiKey?: string;
  /** Output directory for pipeline results */
  outputDir?: string;
}

/**
 * Run the audit command
 */
export async function auditCommand(options: AuditOptions): Promise<void> {
  try {
    // If pipeline mode is enabled, use the PipelineOrchestrator
    if (options.pipeline) {
      return await runPipeline(options);
    }

    // Otherwise, run standard single-phase audit
    // Use orchestrator to run all analysis steps
    const orchestrator = new AuditOrchestrator();
    const report = await orchestrator.runAudit({
      layer: options.layer,
      verbose: options.verbose,
      debug: options.debug,
      projectRoot: process.cwd(),
    });

    // Determine output format
    // Explicit format flag takes precedence over auto-detection
    let format: AuditReportFormat = "text";

    if (options.format) {
      // User explicitly specified format - use it
      format = options.format;
    } else if (options.output) {
      // No explicit format - auto-detect from file extension
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
      console.log(ansis.dim(`  Timestamp: ${formatDate(metadata.timestamp)}`));
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

/**
 * Run the full audit pipeline with before/after AI evaluation
 */
async function runPipeline(options: AuditOptions): Promise<void> {
  const pipeline = new PipelineOrchestrator();

  const result = await pipeline.executePipeline({
    outputDir: options.outputDir ?? "audit-results",
    layer: options.layer,
    format: options.format ?? "markdown",
    enableAI: options.enableAI ?? false,
    verbose: options.verbose ?? false,
    claudeApiKey: options.claudeApiKey,
  });

  // Display summary
  console.log(ansis.green("\n✅ Pipeline execution complete!"));
  console.log(ansis.dim("\nGenerated Reports:"));
  console.log(ansis.dim(`  Before:  ${result.reports.before}`));
  if (result.reports.after) {
    console.log(ansis.dim(`  After:   ${result.reports.after}`));
  }
  if (result.reports.summary) {
    console.log(ansis.dim(`  Summary: ${result.reports.summary}`));
  }

  if (result.summary) {
    console.log(ansis.dim("\nImpact:"));
    console.log(ansis.dim(`  Relationships Added: ${result.summary.relationshipsAdded}`));
    console.log(ansis.dim(`  Gaps Resolved:       ${result.summary.gapsResolved}`));
    console.log(
      ansis.dim(
        `  Coverage Improvement: ${result.summary.coverageImprovement.toFixed(2)} rel/type`
      )
    );
  }
}
