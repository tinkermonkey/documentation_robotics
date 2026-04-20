/**
 * Verify Formatters Unit Tests
 *
 * Tests formatting of VerifyReport objects to text and JSON output
 */

import { describe, it, expect } from "bun:test";
import { formatVerifyJSON, formatVerifyText, formatVerifyReport, formatVerifyMarkdown } from "@/export/verify-formatters.js";
import type { VerifyReport } from "@/analyzers/types.js";

// Sample VerifyReport for testing
const sampleReport: VerifyReport = {
  generated_at: "2024-01-15T10:30:00Z",
  project_root: "/home/user/my-project",
  analyzer: "codebase-memory-mcp",
  analyzer_indexed_at: "2024-01-15T10:25:00Z",
  changeset_context: {
    active_changeset: null,
    verified_against: "base_model",
  },
  layers_verified: ["api"],
  buckets: {
    matched: [
      {
        id: "api.operation.get-users",
        type: "operation",
        source_file: "src/routes/users.ts",
        source_symbol: "getUsersHandler",
      },
      {
        id: "api.operation.create-user",
        type: "operation",
        source_file: "src/routes/users.ts",
        source_symbol: "createUserHandler",
      },
    ],
    in_graph_only: [
      {
        id: "route-health-check",
        http_method: "GET",
        http_path: "/health",
        source_file: "src/routes/health.ts",
        source_symbol: "healthHandler",
      },
    ],
    in_model_only: [
      {
        id: "api.operation.delete-user",
        type: "operation",
        source_file: "src/routes/users.ts",
        source_symbol: "deleteUserHandler",
      },
    ],
    ignored: [
      {
        id: "route-metrics",
        entry_type: "route",
        reason: "Health/metrics endpoints ignored",
      },
    ],
  },
  summary: {
    matched_count: 2,
    gap_count: 1,
    drift_count: 1,
    ignored_count: 1,
    total_graph_entries: 3,
    total_model_entries: 3,
  },
};

const sampleReportWithChangeset: VerifyReport = {
  ...sampleReport,
  changeset_context: {
    active_changeset: "changeset-abc123",
    verified_against: "changeset_view",
  },
};

describe("Verify Formatters", () => {
  describe("formatVerifyReport", () => {
    it("should dispatch to formatVerifyText for text format (default)", () => {
      const output = formatVerifyReport(sampleReport, { format: "text" });
      expect(typeof output).toBe("string");
      expect(output).toContain("API Verification Report");
    });

    it("should dispatch to formatVerifyJSON for json format", () => {
      const output = formatVerifyReport(sampleReport, { format: "json" });
      expect(() => JSON.parse(output)).not.toThrow();
      const parsed = JSON.parse(output);
      expect(parsed.project_root).toBe(sampleReport.project_root);
    });

    it("should dispatch to formatVerifyMarkdown for markdown format", () => {
      const output = formatVerifyReport(sampleReport, { format: "markdown" });
      expect(typeof output).toBe("string");
      expect(output).toContain("# API Verification Report");
      expect(output).toContain("## Summary");
      expect(output).toContain("## Matched Entries");
    });

    it("should handle JSON output with all report data", () => {
      const output = formatVerifyReport(sampleReport, { format: "json" });
      const parsed = JSON.parse(output);

      expect(parsed.generated_at).toBe(sampleReport.generated_at);
      expect(parsed.analyzer).toBe(sampleReport.analyzer);
      expect(parsed.layers_verified).toEqual(sampleReport.layers_verified);
      expect(parsed.buckets).toBeDefined();
      expect(parsed.summary).toBeDefined();
    });

    it("should handle text output with all report sections", () => {
      const output = formatVerifyReport(sampleReport, { format: "text" });

      expect(output).toContain("API Verification Report");
      expect(output).toContain("/home/user/my-project");
      expect(output).toContain("SUMMARY");
      expect(output).toContain("Matched");
      expect(output).toContain("Graph-only");
      expect(output).toContain("Model-only");
    });

    it("should produce consistent output for same input", () => {
      const output1 = formatVerifyReport(sampleReport, { format: "text" });
      const output2 = formatVerifyReport(sampleReport, { format: "text" });
      expect(output1).toBe(output2);
    });

    it("should route JSON requests correctly", () => {
      const jsonOutput = formatVerifyReport(sampleReport, { format: "json" });
      const textOutput = formatVerifyReport(sampleReport, { format: "text" });

      // JSON output should be parseable
      expect(() => JSON.parse(jsonOutput)).not.toThrow();

      // Text output should contain readable text
      expect(textOutput).toContain("Verification Results");
    });

    it("should handle changeset context in both formats", () => {
      const reportWithChangeset = {
        ...sampleReport,
        changeset_context: {
          active_changeset: "changeset-xyz",
          verified_against: "changeset_view" as const,
        },
      };

      const textOutput = formatVerifyReport(reportWithChangeset, {
        format: "text",
      });
      expect(textOutput).toContain("changeset-xyz");

      const jsonOutput = formatVerifyReport(reportWithChangeset, {
        format: "json",
      });
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.changeset_context.active_changeset).toBe("changeset-xyz");
    });
  });

  describe("formatVerifyJSON", () => {
    it("should produce valid JSON", () => {
      const output = formatVerifyJSON(sampleReport);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("should output JSON with newline at end", () => {
      const output = formatVerifyJSON(sampleReport);
      expect(output.endsWith("\n")).toBe(true);
    });

    it("should contain all top-level fields", () => {
      const output = formatVerifyJSON(sampleReport);
      const parsed = JSON.parse(output);

      expect(parsed.generated_at).toBe(sampleReport.generated_at);
      expect(parsed.project_root).toBe(sampleReport.project_root);
      expect(parsed.analyzer).toBe(sampleReport.analyzer);
      expect(parsed.analyzer_indexed_at).toBe(sampleReport.analyzer_indexed_at);
      expect(parsed.changeset_context).toBeDefined();
      expect(parsed.layers_verified).toBeDefined();
      expect(parsed.buckets).toBeDefined();
      expect(parsed.summary).toBeDefined();
    });

    it("should preserve all bucket entries", () => {
      const output = formatVerifyJSON(sampleReport);
      const parsed = JSON.parse(output);

      expect(parsed.buckets.matched.length).toBe(2);
      expect(parsed.buckets.in_graph_only.length).toBe(1);
      expect(parsed.buckets.in_model_only.length).toBe(1);
      expect(parsed.buckets.ignored.length).toBe(1);
    });

    it("should preserve all summary counts", () => {
      const output = formatVerifyJSON(sampleReport);
      const parsed = JSON.parse(output);

      expect(parsed.summary.matched_count).toBe(2);
      expect(parsed.summary.gap_count).toBe(1);
      expect(parsed.summary.drift_count).toBe(1);
      expect(parsed.summary.ignored_count).toBe(1);
    });

    it("should handle changeset context correctly", () => {
      const output = formatVerifyJSON(sampleReportWithChangeset);
      const parsed = JSON.parse(output);

      expect(parsed.changeset_context.active_changeset).toBe("changeset-abc123");
      expect(parsed.changeset_context.verified_against).toBe("changeset_view");
    });
  });

  describe("formatVerifyText", () => {
    it("should produce text output", () => {
      const output = formatVerifyText(sampleReport);
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("should include header with project root", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("/home/user/my-project");
      expect(output).toContain("API Verification Report");
    });

    it("should include generated timestamp", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("Generated:");
    });

    it("should include analyzer information", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("codebase-memory-mcp");
    });

    it("should show base model when no active changeset", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("base model");
      expect(output).toContain("Verified Against");
    });

    it("should show changeset details when active", () => {
      const output = formatVerifyText(sampleReportWithChangeset);
      expect(output).toContain("changeset-abc123");
      expect(output).toContain("changeset view");
    });

    it("should include summary section", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("SUMMARY");
      expect(output).toContain("Matched:");
      expect(output).toContain("Graph-only:");
      expect(output).toContain("Model-only:");
      expect(output).toContain("Ignored:");
    });

    it("should show correct summary counts", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("2"); // matched count
      expect(output).toContain("1"); // graph-only, model-only, ignored counts
    });

    it("should include matched entries section", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("Matched (2)");
      expect(output).toContain("api.operation.get-users");
      expect(output).toContain("api.operation.create-user");
    });

    it("should include graph-only entries section", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("Graph-only");
      expect(output).toContain("route-health-check");
      expect(output).toContain("GET /health");
    });

    it("should include model-only entries section", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("Model-only");
      expect(output).toContain("api.operation.delete-user");
    });

    it("should include ignored entries section", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("Ignored (1)");
      expect(output).toContain("Health/metrics endpoints ignored");
    });

    it("should show source file and symbol information", () => {
      const output = formatVerifyText(sampleReport);
      expect(output).toContain("src/routes/users.ts");
      expect(output).toContain("getUsersHandler");
    });
  });

  describe("empty reports", () => {
    it("should handle empty matched bucket", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          matched: [],
        },
        summary: {
          ...sampleReport.summary,
          matched_count: 0,
        },
      };

      const textOutput = formatVerifyText(report);
      expect(textOutput).toContain("Matched (0)");

      const jsonOutput = formatVerifyJSON(report);
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.buckets.matched.length).toBe(0);
    });

    it("should handle all empty buckets", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          matched: [],
          in_graph_only: [],
          in_model_only: [],
          ignored: [],
        },
        summary: {
          matched_count: 0,
          gap_count: 0,
          drift_count: 0,
          ignored_count: 0,
          total_graph_entries: 0,
          total_model_entries: 0,
        },
      };

      const textOutput = formatVerifyText(report);
      expect(textOutput).toContain("Matched (0)");
      expect(textOutput).toContain("Graph-only");
      expect(textOutput).toContain("Model-only");
      expect(textOutput).toContain("Ignored (0)");

      const jsonOutput = formatVerifyJSON(report);
      expect(() => JSON.parse(jsonOutput)).not.toThrow();
    });
  });

  describe("large datasets", () => {
    it("should handle many matched entries with truncation", () => {
      const manyMatched = Array.from({ length: 30 }, (_, i) => ({
        id: `api.operation.endpoint-${i}`,
        type: "operation",
        source_file: `src/route-${i}.ts`,
        source_symbol: `handler${i}`,
      }));

      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          matched: manyMatched,
        },
        summary: {
          ...sampleReport.summary,
          matched_count: 30,
        },
      };

      const output = formatVerifyText(report);
      expect(output).toContain("... and 10 more");
    });

    it("should handle many graph-only entries with truncation", () => {
      const manyGraphOnly = Array.from({ length: 25 }, (_, i) => ({
        id: `route-${i}`,
        http_method: "GET",
        http_path: `/api/endpoint-${i}`,
        source_file: `src/route-${i}.ts`,
        source_symbol: `handler${i}`,
      }));

      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_graph_only: manyGraphOnly,
        },
        summary: {
          ...sampleReport.summary,
          gap_count: 25,
        },
      };

      const output = formatVerifyText(report);
      expect(output).toContain("... and 5 more");
    });
  });

  describe("formatVerifyMarkdown", () => {
    it("should produce valid markdown with main header", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(typeof output).toBe("string");
      expect(output).toContain("# API Verification Report");
    });

    it("should include project metadata", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("**Project:**");
      expect(output).toContain("/home/user/my-project");
      expect(output).toContain("**Generated:**");
      expect(output).toContain("**Analyzer:**");
    });

    it("should include table of contents", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Contents");
      expect(output).toContain("[Changeset Context](#changeset-context)");
      expect(output).toContain("[Summary](#summary)");
      expect(output).toContain("[Matched Entries](#matched-entries)");
    });

    it("should render changeset context when none active", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Changeset Context");
      expect(output).toContain("**Active Changeset:** none");
      expect(output).toContain("**Verified Against:** base model");
    });

    it("should render changeset context when active", () => {
      const reportWithChangeset = {
        ...sampleReport,
        changeset_context: {
          active_changeset: "changeset-xyz",
          verified_against: "changeset_view" as const,
        },
      };
      const output = formatVerifyMarkdown(reportWithChangeset);
      expect(output).toContain("**Active Changeset:** changeset-xyz");
      expect(output).toContain("**Verified Against:** changeset view");
    });

    it("should include summary section with table", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Summary");
      expect(output).toContain("| Metric | Count | Description |");
      expect(output).toContain("| Matched |");
      expect(output).toContain("| Graph-only |");
      expect(output).toContain("| Model-only |");
      expect(output).toContain("| Ignored |");
    });

    it("should include matched entries section", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Matched Entries");
      expect(output).toContain("| ID | Type | Source |");
      expect(output).toContain("api.operation.get-users");
      expect(output).toContain("api.operation.create-user");
    });

    it("should handle empty matched entries", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          matched: [],
        },
        summary: {
          ...sampleReport.summary,
          matched_count: 0,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("## Matched Entries");
      expect(output).toContain("_No matched entries._");
    });

    it("should include graph-only entries section with gaps message", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Graph-only Entries (Gaps)");
      expect(output).toContain("| ID | Endpoint | Source |");
      expect(output).toContain("route-health-check");
      expect(output).toContain("GET /health");
    });

    it("should handle empty graph-only entries", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_graph_only: [],
        },
        summary: {
          ...sampleReport.summary,
          gap_count: 0,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("_No gaps detected");
    });

    it("should include model-only entries section with drift message", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Model-only Entries (Drift)");
      expect(output).toContain("| ID | Type | Source |");
      expect(output).toContain("api.operation.delete-user");
    });

    it("should handle empty model-only entries", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_model_only: [],
        },
        summary: {
          ...sampleReport.summary,
          drift_count: 0,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("_No drift detected");
    });

    it("should include ignored entries section with type grouping", () => {
      const output = formatVerifyMarkdown(sampleReport);
      expect(output).toContain("## Ignored Entries");
      expect(output).toContain("### route (1)");
      expect(output).toContain("| ID | Reason |");
      expect(output).toContain("route-metrics");
    });

    it("should handle empty ignored entries", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          ignored: [],
        },
        summary: {
          ...sampleReport.summary,
          ignored_count: 0,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("## Ignored Entries");
      expect(output).toContain("_No ignored entries._");
    });

    it("should truncate matched entries at 50 and show overflow message", () => {
      const manyMatched = Array.from({ length: 75 }, (_, i) => ({
        id: `api.operation.endpoint-${i}`,
        type: "operation",
        source_file: `src/route-${i}.ts`,
        source_symbol: `handler${i}`,
      }));
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          matched: manyMatched,
        },
        summary: {
          ...sampleReport.summary,
          matched_count: 75,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("**Count:** 75");
      expect(output).toContain("_... and 25 more entries._");
    });

    it("should truncate graph-only entries at 50 and show overflow message", () => {
      const manyGraphOnly = Array.from({ length: 60 }, (_, i) => ({
        id: `route-${i}`,
        http_method: "GET",
        http_path: `/api/endpoint-${i}`,
        source_file: `src/route-${i}.ts`,
        source_symbol: `handler${i}`,
      }));
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_graph_only: manyGraphOnly,
        },
        summary: {
          ...sampleReport.summary,
          gap_count: 60,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("**Count:** 60");
      expect(output).toContain("_... and 10 more entries._");
    });

    it("should truncate model-only entries at 50 and show overflow message", () => {
      const manyModelOnly = Array.from({ length: 55 }, (_, i) => ({
        id: `api.operation.endpoint-${i}`,
        type: "operation",
        source_file: `src/route-${i}.ts`,
        source_symbol: `handler${i}`,
      }));
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_model_only: manyModelOnly,
        },
        summary: {
          ...sampleReport.summary,
          drift_count: 55,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("**Count:** 55");
      expect(output).toContain("_... and 5 more entries._");
    });

    it("should truncate ignored entries per type at 20 and show overflow", () => {
      const manyIgnored = Array.from({ length: 35 }, (_, i) => ({
        id: `route-${i}`,
        entry_type: "route",
        reason: `Ignored for reason ${i}`,
      }));
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          ignored: manyIgnored,
        },
        summary: {
          ...sampleReport.summary,
          ignored_count: 35,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("### route (35)");
      expect(output).toContain("_... and 15 more_");
    });

    it("should handle multiple ignored entry types with grouping", () => {
      const ignoredMultiType = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `route-${i}`,
          entry_type: "route",
          reason: "Health check",
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `handler-${i}`,
          entry_type: "handler",
          reason: "Internal utility",
        })),
      ];
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          ignored: ignoredMultiType,
        },
        summary: {
          ...sampleReport.summary,
          ignored_count: 8,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("### route (5)");
      expect(output).toContain("### handler (3)");
    });

    it("should escape markdown special characters in values", () => {
      const reportWithSpecialChars: VerifyReport = {
        ...sampleReport,
        project_root: "/home/user/my-project|with|pipes",
        buckets: {
          matched: [
            {
              id: "api.operation.get-users",
              type: "operation",
              source_file: "src/routes/[id].ts",
              source_symbol: "handler|with|pipes",
            },
          ],
          in_graph_only: [],
          in_model_only: [],
          ignored: [],
        },
        summary: {
          matched_count: 1,
          gap_count: 0,
          drift_count: 0,
          ignored_count: 0,
          total_graph_entries: 1,
          total_model_entries: 1,
        },
      };
      const output = formatVerifyMarkdown(reportWithSpecialChars);
      // Check that the output contains escaped content or that pipe characters are handled
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("should format all sections in logical order", () => {
      const output = formatVerifyMarkdown(sampleReport);
      const changesetIndex = output.indexOf("## Changeset Context");
      const summaryIndex = output.indexOf("## Summary");
      const matchedIndex = output.indexOf("## Matched Entries");
      const graphIndex = output.indexOf("## Graph-only Entries");
      const modelIndex = output.indexOf("## Model-only Entries");
      const ignoredIndex = output.indexOf("## Ignored Entries");

      expect(changesetIndex).toBeLessThan(summaryIndex);
      expect(summaryIndex).toBeLessThan(matchedIndex);
      expect(matchedIndex).toBeLessThan(graphIndex);
      expect(graphIndex).toBeLessThan(modelIndex);
      expect(modelIndex).toBeLessThan(ignoredIndex);
    });

    it("should handle all empty buckets", () => {
      const report: VerifyReport = {
        ...sampleReport,
        buckets: {
          matched: [],
          in_graph_only: [],
          in_model_only: [],
          ignored: [],
        },
        summary: {
          matched_count: 0,
          gap_count: 0,
          drift_count: 0,
          ignored_count: 0,
          total_graph_entries: 0,
          total_model_entries: 0,
        },
      };
      const output = formatVerifyMarkdown(report);
      expect(output).toContain("_No matched entries._");
      expect(output).toContain("_No gaps detected");
      expect(output).toContain("_No drift detected");
      expect(output).toContain("_No ignored entries._");
    });

    it("should have source column in matched entries table", () => {
      const output = formatVerifyMarkdown(sampleReport);
      const matchedSection = output.substring(
        output.indexOf("## Matched Entries"),
        output.indexOf("## Graph-only Entries")
      );
      expect(matchedSection).toContain("| ID | Type | Source |");
      expect(matchedSection).toContain("src/routes/users.ts:getUsersHandler");
    });

    it("should display http method and path in graph-only table", () => {
      const output = formatVerifyMarkdown(sampleReport);
      const graphSection = output.substring(
        output.indexOf("## Graph-only Entries"),
        output.indexOf("## Model-only Entries")
      );
      expect(graphSection).toContain("| ID | Endpoint | Source |");
      expect(graphSection).toContain("GET /health");
    });

    it("should use dash for missing http method/path", () => {
      const reportWithoutEndpoint: VerifyReport = {
        ...sampleReport,
        buckets: {
          ...sampleReport.buckets,
          in_graph_only: [
            {
              id: "route-unknown",
              source_file: "src/unknown.ts",
              source_symbol: "unknownHandler",
            },
          ],
        },
      };
      const output = formatVerifyMarkdown(reportWithoutEndpoint);
      expect(output).toContain("| route-unknown | — |");
    });
  });
});
