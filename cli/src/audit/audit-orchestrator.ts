/**
 * Audit Orchestrator - Centralized audit execution logic
 *
 * This class eliminates code duplication between cli/src/commands/audit.ts
 * and cli/scripts/relationship-audit.ts by extracting shared audit orchestration.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "yaml";
import { CoverageAnalyzer } from "./analysis/coverage-analyzer.js";
import { DuplicateDetector } from "./analysis/duplicate-detector.js";
import { GapAnalyzer } from "./analysis/gap-analyzer.js";
import { BalanceAssessor } from "./analysis/balance-assessor.js";
import { ConnectivityAnalyzer } from "./graph/connectivity-analyzer.js";
import { findLayerById } from "../generated/layer-registry.js";
import type {
  AuditReport,
  ConnectivityStats,
  CoverageMetrics,
  DuplicateCandidate,
  GapAnalysis,
  BalanceAssessment,
} from "./types.js";
import { getErrorMessage } from "../utils/errors.js";

export interface AuditOptions {
  layer?: string;
  verbose?: boolean;
  debug?: boolean;
  projectRoot?: string;
}

export interface AuditComponents {
  coverage: CoverageMetrics[];
  duplicates: DuplicateCandidate[];
  gaps: GapAnalysis[];
  balance: BalanceAssessment[];
  connectivity: {
    components: ReturnType<ConnectivityAnalyzer["findConnectedComponents"]>;
    degrees: ReturnType<ConnectivityAnalyzer["calculateDegreeDistribution"]>;
    transitiveChains: Awaited<
      ReturnType<ConnectivityAnalyzer["findTransitiveChains"]>
    >;
    stats: ConnectivityStats;
  };
}

/**
 * Orchestrates the full audit pipeline
 */
export class AuditOrchestrator {
  private coverageAnalyzer: CoverageAnalyzer;
  private duplicateDetector: DuplicateDetector;
  private gapAnalyzer: GapAnalyzer;
  private balanceAssessor: BalanceAssessor;
  private connectivityAnalyzer: ConnectivityAnalyzer;

  constructor() {
    this.coverageAnalyzer = new CoverageAnalyzer();
    this.duplicateDetector = new DuplicateDetector();
    this.gapAnalyzer = new GapAnalyzer();
    this.balanceAssessor = new BalanceAssessor();
    this.connectivityAnalyzer = new ConnectivityAnalyzer();
  }

  /**
   * Run coverage analysis
   */
  async runCoverageAnalysis(options: AuditOptions): Promise<CoverageMetrics[]> {
    this.log(options, "Running coverage analysis...");

    if (options.layer) {
      const layer = findLayerById(options.layer);
      return [this.coverageAnalyzer.analyzeLayer(layer)];
    }
    return this.coverageAnalyzer.analyzeAll();
  }

  /**
   * Run duplicate detection
   */
  async runDuplicateDetection(
    options: AuditOptions
  ): Promise<DuplicateCandidate[]> {
    this.log(options, "Running duplicate detection...");

    if (options.layer) {
      const layer = findLayerById(options.layer);
      return this.duplicateDetector.detectDuplicatesInLayer(layer);
    }
    return this.duplicateDetector.detectDuplicates();
  }

  /**
   * Run gap analysis
   */
  async runGapAnalysis(options: AuditOptions): Promise<GapAnalysis[]> {
    this.log(options, "Running gap analysis...");

    if (options.layer) {
      const layer = findLayerById(options.layer);
      return this.gapAnalyzer.analyzeLayer(layer);
    }
    return this.gapAnalyzer.analyzeAll();
  }

  /**
   * Run balance assessment
   */
  async runBalanceAssessment(options: AuditOptions): Promise<BalanceAssessment[]> {
    this.log(options, "Running balance assessment...");

    if (options.layer) {
      const layer = findLayerById(options.layer);
      return this.balanceAssessor.assessLayer(layer);
    }
    return this.balanceAssessor.assessAll();
  }

  /**
   * Run connectivity analysis
   */
  async runConnectivityAnalysis(options: AuditOptions): Promise<{
    components: ReturnType<ConnectivityAnalyzer["findConnectedComponents"]>;
    degrees: ReturnType<ConnectivityAnalyzer["calculateDegreeDistribution"]>;
    transitiveChains: Awaited<
      ReturnType<ConnectivityAnalyzer["findTransitiveChains"]>
    >;
    stats: ConnectivityStats;
  }> {
    this.log(options, "Running connectivity analysis...");

    const components = this.connectivityAnalyzer.findConnectedComponents();
    const degrees = this.connectivityAnalyzer.calculateDegreeDistribution();
    const transitiveChains =
      await this.connectivityAnalyzer.findTransitiveChains();
    const rawStats = this.connectivityAnalyzer.getConnectivityStats();

    // Convert connectivity stats to match AuditReport format
    const stats: ConnectivityStats = {
      totalNodes: rawStats.nodeCount,
      totalEdges: rawStats.edgeCount,
      connectedComponents: rawStats.componentCount,
      largestComponentSize: rawStats.largestComponentSize,
      isolatedNodes: rawStats.isolatedNodeCount,
      averageDegree: rawStats.averageDegree,
      transitiveChainCount: transitiveChains.length,
    };

    return { components, degrees, transitiveChains, stats };
  }

  /**
   * Load model metadata from manifest
   */
  async loadModelMetadata(options: AuditOptions): Promise<{
    name: string;
    version: string;
  }> {
    this.log(options, "Loading model metadata...");

    const projectRoot = options.projectRoot || process.cwd();
    const defaultMetadata = {
      name: "Documentation Robotics Model",
      version: "1.0.0",
    };

    try {
      const manifestPath = join(
        projectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      const manifestContent = await readFile(manifestPath);
      const manifest = yaml.parse(manifestContent) as {
        name: string;
        version: string;
      };
      return {
        name: manifest.name,
        version: manifest.version,
      };
    } catch (error: unknown) {
      // Distinguish between file not found vs corrupt file
      const errorMsg = getErrorMessage(error);
      if (errorMsg.includes("ENOENT") || errorMsg.includes("no such file")) {
        // File not found - expected in tests, use defaults silently
        this.log(
          options,
          "Using default model metadata (manifest not found)"
        );
      } else {
        // File exists but corrupt - warn the user
        console.warn(
          `Warning: Failed to read manifest (${errorMsg}), using defaults`
        );
      }
      return defaultMetadata;
    }
  }

  /**
   * Run complete audit and build report
   */
  async runAudit(options: AuditOptions = {}): Promise<AuditReport> {
    const coverage = await this.runCoverageAnalysis(options);
    const duplicates = await this.runDuplicateDetection(options);
    const gaps = await this.runGapAnalysis(options);
    const balance = await this.runBalanceAssessment(options);
    const connectivity = await this.runConnectivityAnalysis(options);
    const modelMetadata = await this.loadModelMetadata(options);

    this.log(options, "Generating audit report...");

    return {
      timestamp: new Date().toISOString(),
      model: modelMetadata,
      coverage,
      duplicates,
      gaps,
      balance,
      connectivity,
    };
  }

  /**
   * Log helper that respects verbose/debug flags
   */
  private log(options: AuditOptions, message: string): void {
    if (options.verbose || options.debug) {
      console.error(message);
    }
  }
}
