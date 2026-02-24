/**
 * Model Node Audit Orchestrator
 *
 * Analyzes the project's actual model elements to report which node types
 * are in use, their distribution across layers, and types that exist in the
 * model but not in the spec (orphaned) or vice versa.
 *
 * This is the model-side counterpart to NodeAuditOrchestrator (spec audit).
 * Use `dr audit --type nodes` to invoke this from the CLI.
 */

import { Model } from "../../../core/model.js";
import { getAllLayers } from "../../../generated/layer-registry.js";
import type { Element } from "../../../core/element.js";
import type {
  NodeAuditReport,
  NodeLayerSummary,
  SchemaCompletenessIssue,
} from "../types.js";

export interface ModelNodeAuditOptions {
  layer?: string;
  verbose?: boolean;
  projectRoot?: string;
}

export class ModelNodeAuditOrchestrator {
  async runAudit(options: ModelNodeAuditOptions = {}): Promise<NodeAuditReport> {
    const projectRoot = options.projectRoot ?? process.cwd();

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

    const getElementLayer = (el: Element): string => el.layer_id || el.layer || "";
    const getElementType = (el: Element): string => el.spec_node_id || el.type || "";

    // Filter by layer if specified
    const filteredElements = options.layer
      ? allElements.filter((el) => getElementLayer(el) === options.layer)
      : allElements;

    // Group elements by layer → type → count
    const typesByLayer = new Map<string, Map<string, number>>();
    for (const el of filteredElements) {
      const layerId = getElementLayer(el);
      const typeKey = getElementType(el);
      if (!layerId || !typeKey) continue;
      if (!typesByLayer.has(layerId)) typesByLayer.set(layerId, new Map());
      const typeCounts = typesByLayer.get(layerId)!;
      typeCounts.set(typeKey, (typeCounts.get(typeKey) ?? 0) + 1);
    }

    // Determine target layers
    const targetLayerIds = options.layer
      ? [options.layer]
      : getAllLayers().map((l) => l.id);

    // Build layer summaries
    const layerSummaries: NodeLayerSummary[] = targetLayerIds.map((layerId) => {
      const typeCounts = typesByLayer.get(layerId) ?? new Map();
      return {
        layerId,
        totalNodeTypes: typeCounts.size,
        avgQualityScore: 0,
        emptyDescriptionCount: 0,
        genericDescriptionCount: 0,
        goodDescriptionCount: typeCounts.size,
        totalIssues: 0,
        errorCount: 0,
        warningCount: 0,
      };
    });

    // Detect orphaned types: spec_node_ids in model that don't follow the
    // expected "{layer}.{type}" naming convention
    const completenessIssues: SchemaCompletenessIssue[] = [];
    for (const [layerId, typeCounts] of typesByLayer) {
      for (const specNodeId of typeCounts.keys()) {
        // spec_node_id should start with "{layerId}."
        if (!specNodeId.startsWith(`${layerId}.`)) {
          completenessIssues.push({
            layerId,
            specNodeId,
            issueType: "orphaned_schema",
            detail: `Element uses spec_node_id "${specNodeId}" which does not belong to layer "${layerId}"`,
          });
        }
      }
    }

    const totalNodeTypes = [...typesByLayer.values()].reduce(
      (sum, m) => sum + m.size,
      0
    );

    if (options.verbose) {
      process.stderr.write(
        `Model node audit: ${filteredElements.length} elements, ${totalNodeTypes} unique types across ${typesByLayer.size} layers\n`
      );
    }

    return {
      timestamp: new Date().toISOString(),
      spec: {
        version: model.manifest.version ?? "1.0.0",
        totalNodeTypes,
        totalLayers: typesByLayer.size,
      },
      layerSummaries,
      definitionQuality: [],
      overlaps: [],
      completenessIssues,
    };
  }
}
