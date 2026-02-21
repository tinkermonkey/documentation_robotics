/**
 * Audit command - Analyze relationship coverage, gaps, duplicates, and balance
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { getErrorMessage, CLIError } from "../utils/errors.js";
import { formatAuditReport, AuditReportFormat } from "../export/audit-formatters.js";
import { SnapshotStorage } from "../audit/snapshot-storage.js";
import { AuditOrchestrator } from "../audit/audit-orchestrator.js";
import path from "path";

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
