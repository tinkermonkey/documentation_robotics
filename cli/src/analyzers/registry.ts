/**
 * Analyzer Registry
 *
 * Reads the analyzer manifest from bundled schemas and constructs analyzer instances.
 * The registry maps analyzer names to their backend implementations and metadata.
 *
 * To add a new analyzer:
 * 1. Create a new class implementing AnalyzerBackend (e.g., NewAnalyzer)
 * 2. Create analyzer definition in spec/analyzers/{name}/analyzer.json
 * 3. Add mapping for the new analyzer class in the ANALYZER_CLASSES map below
 * 4. Run `npm run build:spec` to compile the analyzer artifacts
 * 5. Run `npm run build` in the cli/ directory to sync bundled schemas
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import type { AnalyzerBackend } from "./base-analyzer.js";
import { CbmAnalyzer } from "./cbm-analyzer.js";
import { MappingLoader } from "./mapping-loader.js";

/**
 * Type for analyzer class constructor
 */
type AnalyzerConstructor = new (mapper: MappingLoader) => AnalyzerBackend;

/**
 * Mapping of analyzer names to their class implementations
 *
 * Add entries here when implementing a new analyzer.
 * The manifest (spec/dist/analyzers/manifest.json) defines which analyzers are available,
 * and this map provides the runtime bindings to construct instances.
 */
const ANALYZER_CLASSES: Record<string, AnalyzerConstructor> = {
  cbm: CbmAnalyzer,
};

/**
 * Analyzer metadata from manifest
 */
interface AnalyzerMetadata {
  name: string;
  version: string;
}

/**
 * Analyzer registry manifest structure
 */
interface RegistryManifest {
  specVersion: string;
  analyzers: AnalyzerMetadata[];
}

/**
 * Analyzer Registry - constructs and manages analyzer instances
 */
export class AnalyzerRegistry {
  private static instance: AnalyzerRegistry | null = null;
  private manifest: RegistryManifest | null = null;
  private mappers: Map<string, MappingLoader> = new Map();
  private analyzers: Map<string, AnalyzerBackend> = new Map();

  /**
   * Get the singleton registry instance
   */
  static getInstance(): AnalyzerRegistry {
    if (!AnalyzerRegistry.instance) {
      AnalyzerRegistry.instance = new AnalyzerRegistry();
    }
    return AnalyzerRegistry.instance;
  }

  /**
   * Reset the registry singleton for testing
   *
   * This method clears the singleton instance and all cached state.
   * Use this in test teardown to ensure a clean registry for each test.
   *
   * @internal For testing only
   */
  static resetForTesting(): void {
    AnalyzerRegistry.instance = null;
  }

  private constructor() {}

  /**
   * Initialize the registry by loading the manifest
   *
   * @throws CLIError if manifest is missing or malformed
   */
  async initialize(): Promise<void> {
    if (this.manifest) {
      return; // Already initialized
    }

    await this.loadManifest();
  }

  /**
   * Load the analyzer manifest from bundled schemas
   *
   * @private
   * @throws CLIError if manifest is missing or malformed
   */
  private async loadManifest(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const manifestPath = path.join(
      currentDir,
      "../schemas/bundled/analyzers/manifest.json"
    );

    let content: unknown;
    try {
      const fileContent = await fs.readFile(manifestPath, "utf-8");
      content = JSON.parse(fileContent);
    } catch (error) {
      const message =
        error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT"
          ? `Analyzer manifest not found: ${manifestPath}`
          : `Failed to read analyzer manifest: ${error instanceof Error ? error.message : String(error)}`;

      throw new CLIError(message, ErrorCategory.NOT_FOUND, [
        "Run `npm run build:spec` to compile the analyzer artifacts",
        "Check that spec/analyzers/ sources exist",
      ]);
    }

    if (!content || typeof content !== "object") {
      throw new CLIError(
        "Invalid analyzer manifest structure: expected object",
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer artifacts"]
      );
    }

    const obj = content as Record<string, unknown>;
    if (!Array.isArray(obj.analyzers)) {
      throw new CLIError(
        "Invalid analyzer manifest: analyzers must be an array",
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer artifacts"]
      );
    }

    if (typeof obj.specVersion !== "string") {
      throw new CLIError(
        "Invalid analyzer manifest: specVersion must be a string",
        ErrorCategory.VALIDATION,
        ["Run `npm run build:spec` to recompile the analyzer artifacts"]
      );
    }

    this.manifest = {
      specVersion: obj.specVersion,
      analyzers: obj.analyzers as AnalyzerMetadata[],
    };
  }

  /**
   * Get an analyzer by name
   *
   * @param name Analyzer name (e.g., "cbm")
   * @returns AnalyzerBackend instance, or undefined if not found
   * @throws CLIError if manifest is not initialized or mapping cannot be loaded
   */
  async getAnalyzer(name: string): Promise<AnalyzerBackend | undefined> {
    await this.initialize();

    // Check cache first
    if (this.analyzers.has(name)) {
      return this.analyzers.get(name);
    }

    // Check if analyzer exists in manifest
    const metadata = this.manifest!.analyzers.find((a) => a.name === name);
    if (!metadata) {
      return undefined;
    }

    // Load the mapping
    let mapper = this.mappers.get(name);
    if (!mapper) {
      mapper = await MappingLoader.load(name);
      this.mappers.set(name, mapper);
    }

    // Construct the appropriate analyzer instance using the class map
    const AnalyzerClass = ANALYZER_CLASSES[name];
    if (!AnalyzerClass) {
      throw new CLIError(
        `Unknown analyzer: ${name}`,
        ErrorCategory.NOT_FOUND,
        [
          "Check the analyzer name is spelled correctly",
          "Ensure the analyzer class is registered in ANALYZER_CLASSES in registry.ts",
          "Use getAnalyzerNames() to list available analyzers",
        ]
      );
    }

    const analyzer = new AnalyzerClass(mapper);
    this.analyzers.set(name, analyzer);
    return analyzer;
  }

  /**
   * Get all available analyzers
   *
   * @returns Array of all analyzer instances
   * @throws CLIError if manifest is not initialized or mapping cannot be loaded
   */
  async getAllAnalyzers(): Promise<AnalyzerBackend[]> {
    await this.initialize();

    const names = this.getAnalyzerNames();
    const analyzers: AnalyzerBackend[] = [];

    for (const name of names) {
      const analyzer = await this.getAnalyzer(name);
      if (analyzer) {
        analyzers.push(analyzer);
      }
    }

    return analyzers;
  }

  /**
   * Get all available analyzer names
   *
   * @returns Array of analyzer names
   * @throws CLIError if manifest is not initialized
   */
  getAnalyzerNames(): string[] {
    if (!this.manifest) {
      throw new CLIError(
        "Registry not initialized",
        ErrorCategory.VALIDATION,
        ["Call initialize() before using the registry"]
      );
    }

    return this.manifest.analyzers.map((a) => a.name);
  }
}
