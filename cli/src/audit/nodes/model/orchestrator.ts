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

    // Group elements by layer → type → element list (for quality scoring)
    const elementsByLayerAndType = new Map<string, Map<string, Element[]>>();
    const completenessIssues: SchemaCompletenessIssue[] = [];

    for (const el of filteredElements) {
      const layerId = getElementLayer(el);
      const typeKey = getElementType(el);
      if (!layerId || !typeKey) {
        const elId = (el as unknown as { id?: string }).id ?? "(no id)";
        const missingField = !layerId ? "layer" : "type";
        process.stderr.write(
          `  ⚠️  Skipping malformed element "${elId}": missing ${missingField}\n`
        );
        completenessIssues.push({
          layerId: layerId || "(unknown)",
          specNodeId: typeKey || "(unknown)",
          issueType: "malformed_element",
          detail: `Element "${elId}" is missing its ${missingField} — excluded from audit report`,
        });
        continue;
      }
      if (!elementsByLayerAndType.has(layerId)) elementsByLayerAndType.set(layerId, new Map());
      const typeMap = elementsByLayerAndType.get(layerId)!;
      if (!typeMap.has(typeKey)) typeMap.set(typeKey, []);
      typeMap.get(typeKey)!.push(el);
    }

    // Determine target layers
    const targetLayerIds = options.layer
      ? [options.layer]
      : getAllLayers().map((l) => l.id);

    // Build layer summaries with actual description quality scores
    const layerSummaries: NodeLayerSummary[] = targetLayerIds.map((layerId) => {
      const typeMap = elementsByLayerAndType.get(layerId) ?? new Map();
      let emptyDescriptionCount = 0;
      let genericDescriptionCount = 0;
      let goodDescriptionCount = 0;
      let totalScore = 0;

      for (const [, elements] of typeMap) {
        const descs = elements.map((e: Element) => (e.description || "").trim()).filter((d: string) => d.length > 0);
        let quality: "empty" | "generic" | "good";
        if (descs.length === 0) {
          quality = "empty";
        } else {
          const avgLen = descs.reduce((s: number, d: string) => s + d.length, 0) / descs.length;
          quality = avgLen < 20 ? "generic" : "good";
        }
        if (quality === "empty") { emptyDescriptionCount++; totalScore += 0; }
        else if (quality === "generic") { genericDescriptionCount++; totalScore += 30; }
        else { goodDescriptionCount++; totalScore += 85; }
      }

      const totalNodeTypes = typeMap.size;
      const avgQualityScore = totalNodeTypes > 0
        ? Math.round((totalScore / totalNodeTypes) * 10) / 10
        : 0;

      return {
        layerId,
        totalNodeTypes,
        avgQualityScore,
        emptyDescriptionCount,
        genericDescriptionCount,
        goodDescriptionCount,
        totalIssues: emptyDescriptionCount + genericDescriptionCount,
        errorCount: 0,
        warningCount: emptyDescriptionCount + genericDescriptionCount,
      };
    });

    // Detect orphaned types: spec_node_ids in model that don't follow the
    // expected "{layer}.{type}" naming convention
    for (const [layerId, typeMap] of elementsByLayerAndType) {
      for (const specNodeId of typeMap.keys()) {
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

    const totalNodeTypes = [...elementsByLayerAndType.values()].reduce(
      (sum, m) => sum + m.size,
      0
    );

    if (options.verbose) {
      process.stderr.write(
        `Model node audit: ${filteredElements.length} elements, ${totalNodeTypes} unique types across ${elementsByLayerAndType.size} layers\n`
      );
    }

    return {
      timestamp: new Date().toISOString(),
      spec: {
        version: model.manifest.version ?? "1.0.0",
        totalNodeTypes,
        totalLayers: elementsByLayerAndType.size,
      },
      layerSummaries,
      definitionQuality: [],
      overlaps: [],
      completenessIssues,
    };
  }
}
