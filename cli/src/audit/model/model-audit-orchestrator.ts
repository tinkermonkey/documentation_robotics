/**
 * Model Audit Orchestrator - Runs audit analysis against the project's actual model
 *
 * Loads the project model via Model.fromDirectory() and runs the four model-specific
 * analyzers (coverage, gaps, duplicates, balance) plus connectivity, producing an
 * AuditReport in the same format as AuditOrchestrator.
 */

import { Model } from "../../core/model.js";
import { RelationshipCatalog } from "../../core/relationship-catalog.js";
import { RelationshipGraph } from "../graph/relationship-graph.js";
import { ConnectivityAnalyzer } from "../graph/connectivity.js";
import { analyzeLayerCoverage } from "./model-coverage-analyzer.js";
import { analyzeLayerGaps } from "./model-gap-analyzer.js";
import { detectModelDuplicates } from "./model-duplicate-detector.js";
import { assessLayerBalance } from "./model-balance-assessor.js";
import { getAllLayers, getLayerById } from "../../generated/layer-registry.js";
import type { Element } from "../../core/element.js";
import type { Relationship } from "../../core/relationships.js";
import type {
  AuditReport,
  ConnectivityStats,
  CoverageMetrics,
  DuplicateCandidate,
  GapCandidate,
  BalanceAssessment,
} from "../types.js";

export interface ModelAuditOptions {
  layer?: string;
  verbose?: boolean;
  debug?: boolean;
  projectRoot?: string;
}

/**
 * Orchestrates audit of the project's model relationship instances
 */
export class ModelAuditOrchestrator {
  private catalog: RelationshipCatalog;
  private graph: RelationshipGraph;
  private initialized = false;

  constructor() {
    this.catalog = new RelationshipCatalog();
    this.graph = new RelationshipGraph();
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.catalog.load();
      this.initialized = true;
    }
  }

  /**
   * Get predicates applicable to a specific layer (same API as AuditOrchestrator)
   */
  getPredicatesForLayer(layer: string): string[] {
    return this.catalog.getTypesForLayer(layer).map((t) => t.predicate);
  }

  /**
   * Run complete audit against the project model
   */
  async runAudit(options: ModelAuditOptions = {}): Promise<AuditReport> {
    await this.initialize();

    const projectRoot = options.projectRoot ?? process.cwd();

    // Load model (layers + relationships)
    let model: Model;
    try {
      model = await Model.load(projectRoot);
    } catch (err) {
      throw new Error(
        `Failed to load project model from ${projectRoot}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Collect all elements across all layers
    const allElements: Element[] = [];
    for (const layer of model.layers.values()) {
      for (const el of layer.elements.values()) {
        allElements.push(el);
      }
    }

    // Build element lookup by ID (for resolving relationship endpoints)
    const elementById = new Map<string, Element>(
      allElements.map((e) => [e.id, e])
    );

    // All relationship instances from relationships.yaml
    const allRelationships: Relationship[] = model.relationships.getAll();

    // Resolve canonical layer for each element
    // Elements may have layer_id (spec-aligned) or layer (legacy) set
    const getElementLayer = (el: Element): string =>
      el.layer_id || el.layer || "";

    // Build per-layer element and intra-layer relationship maps
    const elementsByLayer = new Map<string, Element[]>();
    for (const el of allElements) {
      const layerId = getElementLayer(el);
      if (!layerId) continue;
      const list = elementsByLayer.get(layerId) ?? [];
      list.push(el);
      elementsByLayer.set(layerId, list);
    }

    // Intra-layer rels: both source and target element are in the same layer
    const intraRelsByLayer = new Map<string, Relationship[]>();
    for (const rel of allRelationships) {
      const srcEl = elementById.get(rel.source);
      const dstEl = elementById.get(rel.target);
      if (!srcEl || !dstEl) continue;
      const srcLayer = getElementLayer(srcEl);
      const dstLayer = getElementLayer(dstEl);
      if (srcLayer !== dstLayer || !srcLayer) continue;
      const list = intraRelsByLayer.get(srcLayer) ?? [];
      list.push(rel);
      intraRelsByLayer.set(srcLayer, list);
    }

    // Determine which layers to analyze
    const layersToAnalyze = this.resolveTargetLayers(options.layer);

    // --- Run per-layer analysis ---
    const coverage: CoverageMetrics[] = [];
    const gaps: GapCandidate[] = [];
    const balance: BalanceAssessment[] = [];

    for (const layerMeta of layersToAnalyze) {
      const layerId = layerMeta.id;
      const layerElements = elementsByLayer.get(layerId) ?? [];
      const layerRels = intraRelsByLayer.get(layerId) ?? [];

      coverage.push(
        analyzeLayerCoverage(layerId, layerElements, layerRels, this.catalog)
      );
      gaps.push(...analyzeLayerGaps(layerElements, layerRels));
      balance.push(...assessLayerBalance(layerId, layerElements, layerRels));
    }

    // --- Duplicates (cross-layer or per-layer, depending on filter) ---
    const relsForDuplicates = options.layer
      ? (intraRelsByLayer.get(options.layer) ?? [])
      : allRelationships;
    const elementsForDuplicates = options.layer
      ? (elementsByLayer.get(options.layer) ?? [])
      : allElements;

    const duplicates: DuplicateCandidate[] = detectModelDuplicates(
      relsForDuplicates,
      elementsForDuplicates,
      this.catalog
    );

    // --- Connectivity ---
    const relsForGraph = options.layer
      ? (intraRelsByLayer.get(options.layer) ?? [])
      : allRelationships;
    const elementsForGraph = options.layer
      ? (elementsByLayer.get(options.layer) ?? [])
      : allElements;

    this.graph.buildFromModel(relsForGraph, elementsForGraph);

    // Create a fresh ConnectivityAnalyzer each run so its internal caches
    // (cachedComponents, cachedDegrees) always reflect the current graph state.
    const connectivityAnalyzer = new ConnectivityAnalyzer(this.graph, this.catalog);
    const components = connectivityAnalyzer.findConnectedComponents();
    const degrees = connectivityAnalyzer.calculateDegreeDistribution();
    const transitiveChains = await connectivityAnalyzer.findTransitiveChains();
    const rawStats = connectivityAnalyzer.getConnectivityStats();

    const connectivityStats: ConnectivityStats = {
      totalNodes: rawStats.nodeCount,
      totalEdges: rawStats.edgeCount,
      connectedComponents: rawStats.componentCount,
      largestComponentSize: rawStats.largestComponentSize,
      isolatedNodes: rawStats.isolatedNodeCount,
      averageDegree: rawStats.averageDegree,
      transitiveChainCount: transitiveChains.length,
    };

    // Model metadata
    const modelMetadata = {
      name: model.manifest.name ?? "Documentation Robotics Model",
      version: model.manifest.version ?? "1.0.0",
    };

    this.log(options, "Generating model audit report...");

    return {
      timestamp: new Date().toISOString(),
      model: modelMetadata,
      coverage,
      duplicates,
      gaps,
      balance,
      connectivity: {
        components,
        degrees,
        transitiveChains,
        stats: connectivityStats,
      },
    };
  }

  private resolveTargetLayers(layerFilter?: string) {
    if (layerFilter) {
      const layer = getLayerById(layerFilter);
      if (!layer) {
        const valid = getAllLayers()
          .map((l) => l.id)
          .join(", ");
        throw new Error(
          `Layer not found: '${layerFilter}'. Valid layers: ${valid}`
        );
      }
      return [layer];
    }
    return getAllLayers();
  }

  private log(options: ModelAuditOptions, message: string): void {
    if (options.verbose || options.debug) {
      console.error(message);
    }
  }
}
