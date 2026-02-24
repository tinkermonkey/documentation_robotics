/**
 * Audit command - Analyze relationship coverage, gaps, duplicates, and balance
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { getErrorMessage, CLIError } from "../utils/errors.js";
import {
  formatAuditReport,
  formatNodeAuditReport,
  AuditReportFormat,
} from "../export/audit-formatters.js";
import { SnapshotStorage } from "../audit/snapshot-storage.js";
import { ModelAuditOrchestrator } from "../audit/relationships/model/orchestrator.js";
import { ModelNodeAuditOrchestrator } from "../audit/nodes/model/orchestrator.js";
import { formatDate } from "../utils/date-utils.js";
import path from "path";

export type AuditType = "relationships" | "nodes" | "all";

export interface AuditOptions {
  layer?: string;
  type?: AuditType;
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
    const auditType: AuditType = options.type ?? "relationships";

    // Determine output format
    let format: AuditReportFormat = "text";
    if (options.format) {
      format = options.format;
    } else if (options.output) {
      const ext = path.extname(options.output).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    let output: string;

    if (auditType === "nodes") {
      // Node type audit - analyzes element types in the model
      const orchestrator = new ModelNodeAuditOrchestrator();
      const report = await orchestrator.runAudit({
        layer: options.layer,
        verbose: options.verbose,
        projectRoot: process.cwd(),
      });

      output = formatNodeAuditReport(report, { format, verbose: options.verbose });
    } else if (auditType === "all") {
      // Combined audit - run both and concatenate
      const [relOrchestrator, nodeOrchestrator] = [
        new ModelAuditOrchestrator(),
        new ModelNodeAuditOrchestrator(),
      ];

      const [relReport, nodeReport] = await Promise.all([
        relOrchestrator.runAudit({
          layer: options.layer,
          verbose: options.verbose,
          debug: options.debug,
          projectRoot: process.cwd(),
        }),
        nodeOrchestrator.runAudit({
          layer: options.layer,
          verbose: options.verbose,
          projectRoot: process.cwd(),
        }),
      ]);

      const relOutput = formatAuditReport(relReport, { format, verbose: options.verbose });
      const nodeOutput = formatNodeAuditReport(nodeReport, { format, verbose: options.verbose });

      if (format === "json") {
        output = JSON.stringify({ relationships: JSON.parse(relOutput), nodes: JSON.parse(nodeOutput) }, null, 2);
      } else {
        output = relOutput + "\n\n" + nodeOutput;
      }
    } else {
      // Default: relationships audit - analyzes the project's actual relationship instances
      const orchestrator = new ModelAuditOrchestrator();
      const report = await orchestrator.runAudit({
        layer: options.layer,
        verbose: options.verbose,
        debug: options.debug,
        projectRoot: process.cwd(),
      });

      output = formatAuditReport(report, { format, verbose: options.verbose });

      // Save snapshot if requested (relationships audit only)
      if (options.saveSnapshot) {
        if (options.debug) {
          console.log(ansis.dim("Saving audit snapshot..."));
        }

        const storage = new SnapshotStorage();
        const metadata = await storage.save(report);

        console.log(ansis.green(`✓ Snapshot saved: ${metadata.id}`));
        console.log(ansis.dim(`  Timestamp: ${formatDate(metadata.timestamp)}`));
      }
    }

    // Write to file or stdout
    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      const outputDir = path.dirname(outputPath);

      await ensureDir(outputDir);
      await writeFile(outputPath, output);

      console.log(ansis.green(`✓ Audit report written to ${options.output}`));
    } else {
      console.log(output);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (options.debug) {
      console.error(error);
    }
    throw new CLIError(`Audit failed: ${message}`);
  }
}
