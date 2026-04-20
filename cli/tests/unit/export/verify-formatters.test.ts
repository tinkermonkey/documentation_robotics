/**
 * Verify Formatters Unit Tests
 *
 * Tests formatting of VerifyReport objects to text and JSON output
 */

import { describe, it, expect } from "bun:test";
import { formatVerifyJSON, formatVerifyText, formatVerifyReport } from "@/export/verify-formatters.js";
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
});
