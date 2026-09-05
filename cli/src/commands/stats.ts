/**
 * Display statistics about the architecture model
 */

import ansis from "ansis";
import { writeFile, ensureDir } from "../utils/file-io.js";
import { Model } from "../core/model.js";
import { StatsCollector } from "../core/stats-collector.js";
import { formatStats, StatsFormat } from "../export/stats-formatters.js";
import path from "path";
import { getErrorMessage } from "../utils/errors.js";

export interface StatsOptions {
  format?: StatsFormat;
  output?: string;
  compact?: boolean;
  verbose?: boolean;
  model?: string;
  debug?: boolean;
}

/**
 * Run the stats command
 */
export async function statsCommand(options: StatsOptions): Promise<void> {
  try {
    // Load model
    const model = await Model.load(options.model);

    // Collect statistics
    const collector = new StatsCollector(model);
    const stats = await collector.collect();

    // Determine output format
    let format: StatsFormat = options.format || "text";

    // Auto-detect format from output file extension
    if (options.output) {
      const ext = path.extname(options.output).toLowerCase();
      if (ext === ".json") {
        format = "json";
      } else if (ext === ".md") {
        format = "markdown";
      }
    }

    // Use compact format if requested
    if (options.compact) {
      format = "compact";
    }

    // Format output
    const output = formatStats(stats, {
      format,
      compact: options.compact,
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

      console.log(ansis.green(`✓ Statistics written to ${options.output}`));
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
