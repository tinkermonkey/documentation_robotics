/**
 * Report Exporter - Export comprehensive architecture reports
 */

import { Model } from "../core/model.js";
import { ReportDataModel } from "../core/report-data-model.js";
import { formatReport, ReportFormatterOptions } from "./report-formatters.js";
import { Exporter, ExportOptions } from "./types.js";

/**
 * Comprehensive report exporter
 */
export class ReportExporter implements Exporter {
  name = "Comprehensive Report";
  supportedLayers = [
    "motivation",
    "business",
    "security",
    "application",
    "technology",
    "api",
    "data-model",
    "data-store",
    "ux",
    "navigation",
    "apm",
    "testing",
  ];

  /**
   * Export model as comprehensive report
   */
  async export(model: Model, _options?: ExportOptions): Promise<string> {
    const reportModel = new ReportDataModel(model);
    const report = await reportModel.collect();

    const formatterOptions: ReportFormatterOptions = {
      format: "text",
      compact: false,
      verbose: true,
      includeDataModel: true,
      includeQuality: true,
    };

    return formatReport(report, formatterOptions);
  }
}
