/**
 * Report Exporter - Export comprehensive architecture reports
 */

import { Model } from "../core/model.js";
import { ReportDataModel } from "../core/report-data-model.js";
import { formatReport, ReportFormatterOptions } from "./report-formatters.js";
import { Exporter, ExportOptions } from "./types.js";
import { getErrorMessage } from "../utils/errors.js";
import { CANONICAL_LAYER_NAMES } from "../core/layers.js";

/**
 * Comprehensive report exporter
 */
export class ReportExporter implements Exporter {
  name = "Comprehensive Report";
  supportedLayers = [...CANONICAL_LAYER_NAMES];

  /**
   * Export model as comprehensive report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    if (!model) {
      throw new Error("Cannot export report: model is required");
    }

    try {
      const reportModel = new ReportDataModel(model);
      const report = await reportModel.collect();

      if (!report) {
        throw new Error("Failed to collect report data: report collection returned empty result");
      }

      const formatterOptions: ReportFormatterOptions = {
        format: "text",
        compact: false,
        verbose: true,
        includeDataModel: true,
        includeQuality: true,
      };

      return formatReport(report, formatterOptions);
    } catch (error) {
      throw new Error(
        `Failed to export comprehensive report: ${getErrorMessage(error)}`
      );
    }
  }
}
