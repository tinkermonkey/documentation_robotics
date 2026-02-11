import { describe, it, expect } from "bun:test";
import { formatReport } from "@/export/report-formatters";
import type { ReportData } from "@/core/report-data-model";

describe("Report Formatters", () => {
  const mockReport: ReportData = {
    timestamp: new Date().toISOString(),
    statistics: {
      project: {
        name: "Test Project",
        version: "1.0.0",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-02T00:00:00Z",
      },
      statistics: {
        totalElements: 100,
        totalRelationships: 50,
        totalLayers: 12,
        populatedLayers: 6,
      },
      validation: {
        isValid: true,
        lastValidated: new Date().toISOString(),
        errors: 0,
        warnings: 0,
      },
      layers: [
        {
          name: "motivation",
          totalElements: 10,
          elementsByType: { goal: 5, requirement: 5 },
          coverage: 100,
        },
      ],
      relationships: {
        total: 50,
        byPredicate: { supports: 30, implements: 20 },
        crossLayerCount: 30,
        intraLayerCount: 20,
        byPair: { "motivation-business": 30, "business-application": 20 },
      },
      completeness: {
        overall: 50,
        byLayer: { motivation: 100, business: 50 },
      },
      orphanedElements: [],
    },
    relationships: {
      totalRelationships: 50,
      classified: [
        {
          id: "1",
          source: "motivation.goal.test",
          target: "business.process.test",
          predicate: "supports",
          category: "motivation",
          archimateAlignment: "Influence",
          directionality: "unidirectional",
          transitivity: false,
          symmetry: false,
          sourceLayer: "motivation",
          targetLayer: "business",
          isCrossLayer: true,
          isSpecCompliant: true,
        },
      ],
      byCategory: { motivation: 30, structural: 20 },
      byPredicate: { supports: 30, implements: 20 },
      crossLayerCount: 30,
      intraLayerCount: 20,
      circularDependencies: [],
    },
    dataModel: {
      entityCount: 20,
      attributeCount: 100,
      relationshipCount: 15,
      entities: [
        {
          id: "data-model.entity.test",
          name: "Test Entity",
          layer: "data-model",
          attributes: ["id", "name"],
          relatedEntities: [],
          isReferenced: true,
        },
      ],
      entityCoverage: 100,
      attributeCoverage: 80,
      avgAttributesPerEntity: 5,
      maxAttributesPerEntity: 10,
      avgRelationshipsPerEntity: 0.75,
      referencedEntities: 10,
      orphanedEntities: [],
    },
    quality: {
      elementCoverage: 80,
      relationshipCoverage: 50,
      documentationCoverage: 85,
      layerCoverage: 50,
      orphanedElements: 0,
      circularDependencies: 0,
      archimateCompliance: 95,
      specCompliance: 90,
      semanticConsistency: 92.5,
      crossLayerReferenceHealth: 60,
      layerComplianceScore: 80,
    },
  };

  it("should format report as text", () => {
    const output = formatReport(mockReport, {
      format: "text",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Test Project");
    expect(output).toContain("Statistics");
    expect(output).toContain("Relationships");
  });

  it("should format report as JSON", () => {
    const output = formatReport(mockReport, {
      format: "json",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");

    const parsed = JSON.parse(output);
    expect(parsed.timestamp).toBe(mockReport.timestamp);
    expect(parsed.statistics).toBeDefined();
    expect(parsed.relationships).toBeDefined();
    expect(parsed.dataModel).toBeDefined();
    expect(parsed.quality).toBeDefined();
  });

  it("should format report as markdown", () => {
    const output = formatReport(mockReport, {
      format: "markdown",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    expect(output).toContain("# Architecture Report");
    expect(output).toContain("## Quality Metrics");
    expect(output).toContain("## Statistics");
    expect(output).toContain("## Relationships");
    expect(output).toContain("## Data Model");
  });

  it("should format report as compact", () => {
    const output = formatReport(mockReport, {
      format: "compact",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    expect(output).toContain("Test Project");
    expect(output).toContain("100 elements");
    expect(output).toContain("50 relationships");
  });

  it("should exclude data model when requested", () => {
    const output = formatReport(mockReport, {
      format: "text",
      verbose: false,
      includeDataModel: false,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    // Should not contain data model specific content
    expect(output).not.toContain("Data Model");
  });

  it("should exclude quality metrics when requested", () => {
    const output = formatReport(mockReport, {
      format: "text",
      verbose: false,
      includeDataModel: true,
      includeQuality: false,
    });

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    // Should not contain quality specific content
    expect(output).not.toContain("Quality Metrics");
  });

  it("should handle empty circular dependencies", () => {
    const output = formatReport(mockReport, {
      format: "text",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    // Should not mention circular dependencies if there are none
  });

  it("should handle circular dependencies in markdown", () => {
    const reportWithCircular = {
      ...mockReport,
      relationships: {
        ...mockReport.relationships,
        circularDependencies: [
          {
            elements: ["elem1", "elem2", "elem3"],
            predicates: ["depends-on", "depends-on"],
            pathLength: 3,
          },
        ],
      },
    };

    const output = formatReport(reportWithCircular, {
      format: "markdown",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    expect(output).toContain("Circular Dependencies");
  });

  it("should format statistics table in markdown", () => {
    const output = formatReport(mockReport, {
      format: "markdown",
      verbose: false,
      includeDataModel: true,
      includeQuality: true,
    });

    expect(output).toBeDefined();
    // Check for table structure
    expect(output).toContain("| Total Elements |");
    expect(output).toContain("| Layer | Count |");
  });

  it("should include timestamp in all formats", () => {
    const formats: Array<"text" | "json" | "markdown" | "compact"> = ["text", "json", "markdown", "compact"];

    for (const format of formats) {
      const output = formatReport(mockReport, {
        format,
        verbose: false,
        includeDataModel: true,
        includeQuality: true,
      });

      if (format === "text" || format === "markdown") {
        // Text and markdown should include generated timestamp
        expect(output).toContain("Generated");
      } else if (format === "json") {
        // JSON should include timestamp in structured format
        const parsed = JSON.parse(output);
        expect(parsed.timestamp).toBeDefined();
      }
    }
  });
});
