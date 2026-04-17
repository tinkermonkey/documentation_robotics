/**
 * Unit tests for build-spec.ts analyzer compilation logic
 *
 * Tests the analyzer compilation behavior in the build pipeline:
 * - Valid analyzer directories compile successfully to packed artifacts
 * - Missing required files cause build failure
 * - Invalid dr_layer values cause build failure
 * - Invalid dr_relationship values cause build failure
 */

import { describe, it, expect } from "bun:test";
import { join, resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "fs";
import { execSync } from "child_process";

// Path to the actual compiled analyzer artifacts from the build
const SPEC_DIST_DIR = resolve(import.meta.dir, "../../../../spec/dist");
const SPEC_DIR = resolve(import.meta.dir, "../../../../spec");
const REPO_ROOT = resolve(import.meta.dir, "../../../../");
const ANALYZERS_DIR = join(SPEC_DIR, "analyzers");

describe("build-spec.ts Analyzer Compilation", () => {
  describe("Scenario (a): Valid analyzer artifacts", () => {
    it("should have compiled the cbm analyzer to a packed artifact", () => {
      // The cbm analyzer is in the actual spec directory and should be compiled
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      expect(existsSync(cbmPath)).toBe(true);

      // Verify the packed artifact has the expected structure
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // Verify all required top-level fields exist
      expect(packed).toHaveProperty("name");
      expect(packed).toHaveProperty("version");
      expect(packed).toHaveProperty("source_version");
      expect(packed).toHaveProperty("analyzer");
      expect(packed).toHaveProperty("nodes_by_label");
      expect(packed).toHaveProperty("edges_by_type");
      expect(packed).toHaveProperty("heuristics");

      // Verify analyzer metadata
      expect(packed.name).toBe("cbm");
      expect(typeof packed.version).toBe("string");
      expect(typeof packed.source_version).toBe("string");

      // Verify analyzer spec is preserved
      expect(packed.analyzer).toHaveProperty("name");
      expect(packed.analyzer.name).toBe("cbm");
    });

    it("should index node mappings by PascalCase labels", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // nodes_by_label should have PascalCase keys
      expect(typeof packed.nodes_by_label).toBe("object");

      // Verify PascalCase naming convention (first letter capitalized)
      for (const label of Object.keys(packed.nodes_by_label)) {
        expect(label[0]).toBe(label[0].toUpperCase());
      }

      // Verify mappings preserve the analyzer_node_type data
      for (const [label, mapping] of Object.entries(packed.nodes_by_label)) {
        expect(mapping).toHaveProperty("analyzer_node_type");
        expect(mapping).toHaveProperty("dr_layer");
        expect(mapping).toHaveProperty("dr_node_type");
        expect(mapping).toHaveProperty("confidence");
      }
    });

    it("should index edge mappings by analyzer_edge_type", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // edges_by_type should contain all edge type mappings
      expect(typeof packed.edges_by_type).toBe("object");
      expect(Object.keys(packed.edges_by_type).length).toBeGreaterThan(0);

      // Verify each edge mapping has required fields
      for (const [edgeType, mapping] of Object.entries(packed.edges_by_type)) {
        expect(mapping).toHaveProperty("analyzer_edge_type");
        expect(mapping.analyzer_edge_type).toBe(edgeType);
        expect(mapping).toHaveProperty("dr_relationship");
        expect(mapping).toHaveProperty("confidence");
      }
    });

    it("should allow null dr_relationship for unmappable edges", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // Find edges with null dr_relationship (unmappable)
      const unmappableEdges = Object.entries(packed.edges_by_type).filter(
        ([_, mapping]: [string, any]) => mapping.dr_relationship === null
      );

      // The cbm analyzer should have some unmappable edges
      expect(unmappableEdges.length).toBeGreaterThan(0);

      // Verify they're properly marked
      for (const [edgeType, mapping] of unmappableEdges) {
        expect((mapping as any).dr_relationship).toBeNull();
      }
    });

    it("should validate that all dr_relationship values are valid predicates", () => {
      // Load the predicates from base.json
      const basePath = join(SPEC_DIST_DIR, "base.json");
      const base = JSON.parse(readFileSync(basePath, "utf-8"));
      const predicates = (base.predicates as Record<string, unknown>) || {};

      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // All non-null dr_relationship values should be in the predicates
      for (const [edgeType, mapping] of Object.entries(packed.edges_by_type)) {
        const mapping_data = mapping as any;
        if (mapping_data.dr_relationship !== null) {
          expect(predicates).toHaveProperty(mapping_data.dr_relationship);
        }
      }
    });
  });

  describe("Scenario (b): Missing required files cause build failure", () => {
    it("should fail when analyzer.json is missing", () => {
      const testAnalyzerDir = createTestAnalyzer("test-missing-analyzer");
      try {
        // Remove analyzer.json
        const analyzerJsonPath = join(testAnalyzerDir, "analyzer.json");
        rmSync(analyzerJsonPath, { force: true });

        // Run build and expect failure
        const result = runBuildAndCapture();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Required file missing");
        expect(result.stderr).toContain("analyzer.json");
      } finally {
        cleanupTestAnalyzer(testAnalyzerDir);
      }
    });

    it("should fail when node-mapping.json is missing", () => {
      const testAnalyzerDir = createTestAnalyzer("test-missing-node-mapping");
      try {
        // Remove node-mapping.json
        const nodeMappingPath = join(testAnalyzerDir, "node-mapping.json");
        rmSync(nodeMappingPath, { force: true });

        // Run build and expect failure
        const result = runBuildAndCapture();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Required file missing");
        expect(result.stderr).toContain("node-mapping.json");
      } finally {
        cleanupTestAnalyzer(testAnalyzerDir);
      }
    });
  });

  describe("Scenario (c): Invalid dr_layer values cause build failure", () => {
    it("should fail when dr_layer has an invalid canonical layer name", () => {
      const testAnalyzerDir = createTestAnalyzer("test-invalid-dr-layer");
      try {
        // Modify node-mapping.json with invalid dr_layer
        const nodeMappingPath = join(testAnalyzerDir, "node-mapping.json");
        const nodeMapping = JSON.parse(readFileSync(nodeMappingPath, "utf-8"));
        nodeMapping.mappings[0].dr_layer = "invalid-layer-name";
        writeFileSync(nodeMappingPath, JSON.stringify(nodeMapping, null, 2));

        // Run build and expect failure
        const result = runBuildAndCapture();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Invalid dr_layer");
        expect(result.stderr).toContain("invalid-layer-name");
      } finally {
        cleanupTestAnalyzer(testAnalyzerDir);
      }
    });
  });

  describe("Scenario (d): Invalid dr_relationship values cause build failure", () => {
    it("should fail when dr_relationship references a non-existent predicate", () => {
      const testAnalyzerDir = createTestAnalyzer("test-invalid-dr-relationship");
      try {
        // Modify edge-mapping.json with invalid dr_relationship
        const edgeMappingPath = join(testAnalyzerDir, "edge-mapping.json");
        const edgeMapping = JSON.parse(readFileSync(edgeMappingPath, "utf-8"));
        edgeMapping.mappings[0].dr_relationship = "non_existent_predicate_xyz";
        writeFileSync(edgeMappingPath, JSON.stringify(edgeMapping, null, 2));

        // Run build and expect failure
        const result = runBuildAndCapture();
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Invalid dr_relationship");
        expect(result.stderr).toContain("non_existent_predicate_xyz");
      } finally {
        cleanupTestAnalyzer(testAnalyzerDir);
      }
    });
  });

  describe("Analyzer manifest", () => {
    it("should have created an analyzer manifest listing all analyzers", () => {
      const manifestPath = join(SPEC_DIST_DIR, "analyzers", "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      // Manifest should have the expected structure
      expect(manifest).toHaveProperty("specVersion");
      expect(manifest).toHaveProperty("analyzers");
      expect(Array.isArray(manifest.analyzers)).toBe(true);

      // Should include cbm analyzer
      const cbmEntry = manifest.analyzers.find((a: any) => a.name === "cbm");
      expect(cbmEntry).toBeDefined();
      expect(cbmEntry).toHaveProperty("version");
    });

    it("should include spec version in analyzer manifest", () => {
      const manifestPath = join(SPEC_DIST_DIR, "analyzers", "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      // Manifest should reference the spec version
      expect(typeof manifest.specVersion).toBe("string");
      expect(manifest.specVersion.length).toBeGreaterThan(0);
    });
  });

  describe("Heuristics compilation", () => {
    it("should include extraction heuristics in packed analyzer", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // Heuristics should be included
      expect(packed).toHaveProperty("heuristics");
      expect(typeof packed.heuristics).toBe("object");
      expect(Object.keys(packed.heuristics).length).toBeGreaterThan(0);
    });

    it("should preserve heuristics structure from source", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // Heuristics should have meaningful structure
      const heuristics = packed.heuristics as Record<string, unknown>;

      // Common heuristics properties that should be preserved
      // (specific keys depend on the analyzer implementation)
      expect(Object.keys(heuristics).length).toBeGreaterThan(0);
    });
  });

  describe("Source version tracking", () => {
    it("should track spec version in compiled analyzers", () => {
      const cbmPath = join(SPEC_DIST_DIR, "analyzers", "cbm.json");
      const packed = JSON.parse(readFileSync(cbmPath, "utf-8"));

      // Every analyzer should record the spec version it was compiled with
      expect(packed.source_version).toBeDefined();
      expect(typeof packed.source_version).toBe("string");

      // Verify it matches the spec version from base.json
      const basePath = join(SPEC_DIST_DIR, "base.json");
      const base = JSON.parse(readFileSync(basePath, "utf-8"));
      expect(packed.source_version).toBe(base.specVersion);
    });
  });
});

/**
 * Backup a test analyzer directory, create a new one with test data
 */
function createTestAnalyzer(testName: string): string {
  const testAnalyzerDir = join(ANALYZERS_DIR, testName);

  // Create test analyzer directory
  mkdirSync(testAnalyzerDir, { recursive: true });

  // Create test analyzer files
  writeFileSync(
    join(testAnalyzerDir, "analyzer.json"),
    JSON.stringify({
      name: testName,
      metadata: {
        version: "1.0",
      },
    }, null, 2)
  );

  writeFileSync(
    join(testAnalyzerDir, "node-mapping.json"),
    JSON.stringify({
      mappings: [
        {
          analyzer_node_type: "TestNode",
          dr_layer: "api",
          dr_node_type: "endpoint",
          confidence: "high",
        },
      ],
    }, null, 2)
  );

  writeFileSync(
    join(testAnalyzerDir, "edge-mapping.json"),
    JSON.stringify({
      mappings: [
        {
          analyzer_edge_type: "test_edge",
          dr_relationship: "consumes",
          confidence: "high",
        },
      ],
    }, null, 2)
  );

  writeFileSync(
    join(testAnalyzerDir, "extraction-heuristics.json"),
    JSON.stringify({}, null, 2)
  );

  return testAnalyzerDir;
}

/**
 * Remove a test analyzer directory
 */
function cleanupTestAnalyzer(analyzerDir: string): void {
  try {
    rmSync(analyzerDir, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Run the build-spec script and capture output
 */
function runBuildAndCapture(): { exitCode: number; stderr: string } {
  try {
    execSync("npm run build:spec", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { exitCode: 0, stderr: "" };
  } catch (error: any) {
    return {
      exitCode: error.status || 1,
      stderr: error.stderr ? error.stderr.toString() : error.stdout ? error.stdout.toString() : error.toString(),
    };
  }
}
