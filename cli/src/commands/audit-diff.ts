/**
 * Audit diff command - Compare before/after audit snapshots
 */

import ansis from "ansis";
import { CLIError, getErrorMessage } from "../utils/errors.js";
import { SnapshotStorage } from "../audit/snapshot-storage.js";
import { DifferentialAnalyzer } from "../audit/differential-analyzer.js";
import { formatDifferentialAnalysis } from "../export/diff-formatters.js";
import { writeFile, ensureDir } from "../utils/file-io.js";
import path from "path";

export interface AuditDiffOptions {
  before?: string; // Snapshot ID or timestamp
  after?: string; // Snapshot ID or timestamp
  format?: "text" | "json" | "markdown";
  output?: string;
  verbose?: boolean;
  debug?: boolean;
}

/**
 * Run the audit diff command
 */
export async function auditDiffCommand(
  options: AuditDiffOptions,
): Promise<void> {
  try {
    const storage = new SnapshotStorage();
    const analyzer = new DifferentialAnalyzer();

    // Load snapshots
    let beforeReport;
    let afterReport;

    if (options.before && options.after) {
      // Explicit snapshot IDs/timestamps provided
      if (options.debug) {
        console.log(
          ansis.dim(`Loading before snapshot: ${options.before}...`),
        );
      }
      beforeReport = await storage.load(options.before);

      if (options.debug) {
        console.log(ansis.dim(`Loading after snapshot: ${options.after}...`));
      }
      afterReport = await storage.load(options.after);
    } else {
      // Auto-detect: compare latest two snapshots
      if (options.debug) {
        console.log(ansis.dim("Loading latest two snapshots..."));
      }

      const [before, after] = await storage.getLatestPair();

      if (!before || !after) {
        throw new CLIError(
          "Not enough snapshots available for comparison. Run 'dr audit --save-snapshot' to create snapshots.",
        );
      }

      beforeReport = before;
      afterReport = after;
    }

    if (options.debug) {
      console.log(ansis.dim("Performing differential analysis..."));
    }

    // Perform differential analysis
    const analysis = analyzer.analyze(beforeReport, afterReport);

    // Determine output format
    let format = options.format || "text";
    if (options.output) {
      const ext = path.extname(options.output).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    // Format output
    const output = formatDifferentialAnalysis(analysis, {
      format,
      verbose: options.verbose || false,
      beforeTimestamp: beforeReport.timestamp,
      afterTimestamp: afterReport.timestamp,
    });

    // Write to file or stdout
    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      const outputDir = path.dirname(outputPath);

      await ensureDir(outputDir);
      await writeFile(outputPath, output);

      console.log(
        ansis.green(`✓ Differential analysis written to ${options.output}`),
      );
    } else {
      console.log(output);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (options.debug) {
      console.error(error);
    }
    throw new CLIError(`Audit diff failed: ${message}`);
  }
}
