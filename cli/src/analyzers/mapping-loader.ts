/**
 * MappingLoader - reads and validates packed analyzer artifact
 *
 * Loads the compiled CBM mapping from cli/src/schemas/bundled/analyzers/<name>.json
 * and provides typed accessors for node mappings, edge mappings, heuristics, and rules.
 *
 * The loader validates the top-level structure and throws CLIError if the artifact
 * is malformed or missing required keys, with a suggestion to run npm run build:spec.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import type {
  AnalyzerEdgeMapping,
  AnalyzerHeuristic,
  AnalyzerNodeMapping,
  ConfidenceRubric,
  FilteringRule,
} from "./types.js";

interface AnalyzerMetadata {
  name: string;
  display_name: string;
  description: string;
  homepage: string;
  [key: string]: unknown;
}

interface PackedArtifact {
  name: string;
  version: string;
  analyzer?: AnalyzerMetadata;
  nodes_by_label: Record<string, AnalyzerNodeMapping>;
  edges_by_type: Record<string, AnalyzerEdgeMapping>;
  heuristics: {
    confidence_rubric?: ConfidenceRubric;
    heuristics?: AnalyzerHeuristic[];
    filtering_rules?: FilteringRule[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class MappingLoader {
  private artifact: PackedArtifact;
  private analyzerName: string;

  private constructor(artifact: PackedArtifact, analyzerName: string) {
    this.artifact = artifact;
    this.analyzerName = analyzerName;
  }

  /**
   * Load a mapping artifact from the bundled schemas directory
   *
   * @param analyzerName Name of the analyzer (e.g., "cbm")
   * @returns Loaded and validated MappingLoader instance
   * @throws CLIError if artifact is missing or malformed
   */
  static async load(analyzerName: string): Promise<MappingLoader> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const artifactPath = path.join(
      currentDir,
      "../schemas/bundled/analyzers",
      `${analyzerName}.json`
    );

    let artifact: unknown;
    try {
      const content = await fs.readFile(artifactPath, "utf-8");
      artifact = JSON.parse(content);
    } catch (error) {
      const message =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? `Analyzer mapping not found: ${analyzerName}`
          : `Failed to read analyzer mapping: ${error instanceof Error ? error.message : String(error)}`;

      throw new CLIError(
        message,
        ErrorCategory.NOT_FOUND,
        [
          "Run `npm run build:spec` to compile the analyzer mapping artifacts",
          `Check that spec/analyzers/${analyzerName}/ sources exist`,
        ]
      );
    }

    // Validate structure
    if (!artifact || typeof artifact !== "object") {
      throw new CLIError(
        `Invalid analyzer mapping structure: expected object, got ${typeof artifact}`,
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer mapping artifacts"]
      );
    }

    const obj = artifact as Record<string, unknown>;
    const requiredKeys = ["nodes_by_label", "edges_by_type", "heuristics"];
    const missingKeys = requiredKeys.filter((key) => !(key in obj));

    if (missingKeys.length > 0) {
      throw new CLIError(
        `Invalid analyzer mapping: missing required keys: ${missingKeys.join(", ")}`,
        ErrorCategory.VALIDATION,
        [
          "Run `npm run build:spec` to recompile the analyzer mapping artifacts",
          `Ensure spec/analyzers/${analyzerName}/ contains valid layer/node/edge definitions`,
        ]
      );
    }

    // Validate types of required keys
    if (typeof obj.nodes_by_label !== "object" || obj.nodes_by_label === null) {
      throw new CLIError(
        `Invalid analyzer mapping: nodes_by_label must be an object`,
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer mapping artifacts"]
      );
    }

    if (typeof obj.edges_by_type !== "object" || obj.edges_by_type === null) {
      throw new CLIError(
        `Invalid analyzer mapping: edges_by_type must be an object`,
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer mapping artifacts"]
      );
    }

    if (typeof obj.heuristics !== "object" || obj.heuristics === null) {
      throw new CLIError(
        `Invalid analyzer mapping: heuristics must be an object`,
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer mapping artifacts"]
      );
    }

    return new MappingLoader(artifact as PackedArtifact, analyzerName);
  }

  /**
   * Get the mapping for a node label
   *
   * @param label CBM node label (e.g., "Route", "Function")
   * @returns The mapping definition or undefined if not found
   */
  getNodeMapping(label: string): AnalyzerNodeMapping | undefined {
    return this.artifact.nodes_by_label[label];
  }

  /**
   * Get the mapping for an edge type
   *
   * @param type CBM edge type (e.g., "HTTP_CALLS", "HANDLES")
   * @returns The mapping definition or undefined if not found
   */
  getEdgeMapping(type: string): AnalyzerEdgeMapping | undefined {
    return this.artifact.edges_by_type[type];
  }

  /**
   * Get a heuristic by name
   *
   * @param name Heuristic name (e.g., "min_fan_in")
   * @returns The heuristic definition or undefined if not found
   */
  getHeuristic(name: string): AnalyzerHeuristic | undefined {
    const heuristics = this.artifact.heuristics.heuristics;
    if (!Array.isArray(heuristics)) {
      return undefined;
    }
    return heuristics.find((h) => h.name === name);
  }

  /**
   * Get all filtering rules
   *
   * @returns Array of filtering rules
   */
  getFilteringRules(): FilteringRule[] {
    const rules = this.artifact.heuristics.filtering_rules;
    return Array.isArray(rules) ? rules : [];
  }

  /**
   * Get the confidence rubric
   *
   * @returns Confidence levels and their score ranges
   */
  getConfidenceRubric(): ConfidenceRubric | undefined {
    return this.artifact.heuristics.confidence_rubric;
  }

  /**
   * Get all node labels in the mapping
   *
   * @returns Array of CBM label names
   */
  getNodeLabels(): string[] {
    return Object.keys(this.artifact.nodes_by_label);
  }

  /**
   * Get all edge types in the mapping
   *
   * @returns Array of CBM edge type names
   */
  getEdgeTypes(): string[] {
    return Object.keys(this.artifact.edges_by_type);
  }

  /**
   * Get analyzer name
   *
   * @returns The name of the loaded analyzer
   */
  getAnalyzerName(): string {
    return this.analyzerName;
  }

  /**
   * Get analyzer version
   *
   * @returns The version of the artifact
   */
  getVersion(): string {
    return this.artifact.version;
  }

  /**
   * Get analyzer metadata (display name, description, homepage, etc.)
   *
   * @returns Analyzer metadata object or undefined if not available
   */
  getAnalyzerMetadata(): AnalyzerMetadata | undefined {
    return this.artifact.analyzer;
  }
}
