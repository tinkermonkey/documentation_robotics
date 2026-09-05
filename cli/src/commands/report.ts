/**
 * Generate comprehensive architecture reports
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { Model } from "../core/model.js";
import { ReportDataModel } from "../core/report-data-model.js";
import { formatReport, ReportFormat } from "../export/report-formatters.js";
import path from "path";
import { getErrorMessage } from "../utils/errors.js";

export interface ReportOptions {
  type?: "comprehensive" | "statistics" | "relationships" | "data-model" | "quality";
  format?: ReportFormat;
  output?: string;
  verbose?: boolean;
  model?: string;
  debug?: boolean;
  includeDataModel?: boolean;
  includeQuality?: boolean;
}

/**
 * Run the report command
 */
export async function reportCommand(options: ReportOptions): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model);

    // Create report data model
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();

    // Determine output format
    let format: ReportFormat = options.format || "text";

    // Auto-detect format from output file extension
    if (options.output) {
      const ext = path.extname(options.output).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    // Determine what to include based on report type
    let includeDataModel = options.includeDataModel !== false;
    let includeQuality = options.includeQuality !== false;

    switch (options.type) {
      case "statistics":
        includeDataModel = false;
        includeQuality = true;
        break;
      case "relationships":
        includeDataModel = false;
        includeQuality = false;
        break;
      case "data-model":
        includeDataModel = true;
        includeQuality = false;
        break;
      case "quality":
        includeDataModel = false;
        includeQuality = true;
        break;
      case "comprehensive":
      default:
        includeDataModel = true;
        includeQuality = true;
        break;
    }

    // Format output
    const output = formatReport(report, {
      format,
      verbose: options.verbose,
      includeDataModel,
      includeQuality,
    });

    // Write to file or stdout
    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      const outputDir = path.dirname(outputPath);

      // Ensure output directory exists
      await ensureDir(outputDir);

      // Write file
      await writeFile(outputPath, output);

      console.log(ansis.green(`✓ Report written to ${options.output}`));
    } else {
      // Print to stdout
      console.log(output);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
