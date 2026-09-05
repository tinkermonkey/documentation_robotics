/**
 * Node audit orchestrator.
 * Wires all analysis modules and returns a NodeAuditReport.
 */

import { NodeSchemaLoader } from "./loader.js";
import { NodeDefinitionAnalyzer } from "../analysis/node-definition-analyzer.js";
import { NodeOverlapDetector } from "../analysis/node-overlap-detector.js";
import { NodeCompletenessChecker } from "../analysis/node-completeness-checker.js";
import { NodeAIEvaluator } from "../ai/evaluator.js";
import type {
  NodeAuditReport,
  NodeLayerSummary,
  NodeDefinitionQuality,
  ParsedNodeSchema,
} from "../types.js";

export interface NodeAuditOptions {
  layer?: string;
  verbose?: boolean;
  specDir: string;
  enableAi?: boolean;
}

export class NodeAuditOrchestrator {
  async runAudit(options: NodeAuditOptions): Promise<NodeAuditReport> {
    const loader = new NodeSchemaLoader(options.specDir);

    // 1. Load data — always load all schemas once, then filter in memory.
    // This avoids a second disk scan when --layer is active and ensures
    // completeness checking always runs against the full spec.
    const [specVersion, layerDefs, allSchemas] = await Promise.all([
      loader.loadSpecVersion(),
      loader.loadLayerDefinitions(),
      loader.loadAllSchemas(),
    ]);

    // Filtered view used by definition quality and overlap detection.
    const schemas = options.layer
      ? allSchemas.filter((s) => s.layerId === options.layer)
      : allSchemas;

    // 2. Definition quality — per schema
    const definitionAnalyzer = new NodeDefinitionAnalyzer();
    const definitionQuality: NodeDefinitionQuality[] = schemas.map((s) =>
      definitionAnalyzer.analyze(s)
    );

    // 3. Overlap detection — per layer within the loaded schemas
    const overlapDetector = new NodeOverlapDetector();
    const overlaps = overlapDetector.detectOverlaps(schemas);

    // 4. Completeness check — always against all schemas vs all layer defs,
    // then filter to the requested layer so per-layer reports stay scoped.
    const completenessChecker = new NodeCompletenessChecker();
    const completenessIssues = completenessChecker
      .check(layerDefs, allSchemas)
      .filter((issue) => !options.layer || issue.layerId === options.layer);

    // 5. Layer summaries
    const qualityByLayer = groupQualityByLayer(definitionQuality);
    const layerSummaries: NodeLayerSummary[] = layerDefs
      .filter((l) => !options.layer || l.id === options.layer)
      .map((layerDef) => buildLayerSummary(layerDef.id, qualityByLayer.get(layerDef.id) ?? []));

    const report: NodeAuditReport = {
      timestamp: new Date().toISOString(),
      spec: {
        version: specVersion,
        totalNodeTypes: allSchemas.length,
        totalLayers: layerDefs.length,
      },
      layerSummaries,
      definitionQuality,
      overlaps,
      completenessIssues,
    };

    // 6. Optional AI step
    if (options.enableAi) {
      const schemasByLayer = new Map<string, ParsedNodeSchema[]>();
      for (const schema of allSchemas) {
        const group = schemasByLayer.get(schema.layerId) ?? [];
        group.push(schema);
        schemasByLayer.set(schema.layerId, group);
      }
      // Respect --layer filter: only evaluate the filtered layer defs
      const filteredLayerDefs = layerDefs.filter(
        (l) => !options.layer || l.id === options.layer
      );
      const evaluator = new NodeAIEvaluator();
      report.aiReviews = await evaluator.evaluateLayers(filteredLayerDefs, schemasByLayer);
    }

    return report;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupQualityByLayer(
  quality: NodeDefinitionQuality[]
): Map<string, NodeDefinitionQuality[]> {
  const map = new Map<string, NodeDefinitionQuality[]>();
  for (const q of quality) {
    const group = map.get(q.layerId) ?? [];
    group.push(q);
    map.set(q.layerId, group);
  }
  return map;
}

function buildLayerSummary(
  layerId: string,
  qualities: NodeDefinitionQuality[]
): NodeLayerSummary {
  const total = qualities.length;
  const avgScore = total > 0
    ? qualities.reduce((sum, q) => sum + q.score, 0) / total
    : 0;

  let emptyDescriptionCount = 0;
  let genericDescriptionCount = 0;
  let goodDescriptionCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const q of qualities) {
    if (q.descriptionQuality === "empty") emptyDescriptionCount++;
    else if (q.descriptionQuality === "generic") genericDescriptionCount++;
    else goodDescriptionCount++;

    for (const issue of q.issues) {
      if (issue.severity === "error") errorCount++;
      else if (issue.severity === "warning") warningCount++;
    }
  }

  const totalIssues = qualities.reduce((sum, q) => sum + q.issues.length, 0);

  return {
    layerId,
    totalNodeTypes: total,
    avgQualityScore: Math.round(avgScore * 10) / 10,
    emptyDescriptionCount,
    genericDescriptionCount,
    goodDescriptionCount,
    totalIssues,
    errorCount,
    warningCount,
  };
}
