import type { Model } from '../core/model.js';
import type { Element } from '../core/element.js';
import type { Relationship } from '../core/relationships.js';
import { LAYER_MAP } from '../core/layers.js';

/**
 * Statistics about relationships in a layer
 */
export interface ModelLayerStatistics {
  elementCount: number;
  intraRelationshipCount: number;
  interRelationshipCount: number;
  inboundRelationshipCount: number;   // inter-layer rels targeting this layer
  outboundRelationshipCount: number;  // inter-layer rels sourced from this layer
}

/**
 * Report-friendly data structure for a single layer
 * Analogous to ReportDataModel in scripts/generate-layer-reports.ts
 */
export interface ModelLayerReportData {
  layerName: string;
  layerNumber: number;
  elements: Element[];                // sorted by element.path
  intraRelationships: Relationship[]; // both source and target in same layer
  interRelationships: Relationship[]; // source or target in a different layer
  upstreamLayers: string[];           // canonical layer names referencing INTO this layer
  downstreamLayers: string[];         // canonical layer names this layer references OUT TO
  statistics: ModelLayerStatistics;
}

/**
 * Data collector for generating layer report data from a live Model instance
 * Reads from Model/Layer/Relationships and transforms into report-friendly shapes
 */
export class ModelReportDataCollector {
  /**
   * Collect report data for a specific layer
   *
   * @param model - The live Model instance
   * @param layerName - The canonical layer name (e.g., 'api', 'data-model')
   * @returns Report-friendly data structure for the layer
   */
  collectLayerData(model: Model, layerName: string): ModelLayerReportData {
    // Get the layer number for file naming
    const layerNumber = LAYER_MAP[layerName as keyof typeof LAYER_MAP] ?? -1;

    // Get all elements in this layer via Layer.elements getter (uses canonical conversion pattern)
    const layerElements = model.layers.get(layerName);
    const elements: Element[] = layerElements
      ? Array.from(layerElements.values()).sort((a, b) =>
          (a.path || a.id).localeCompare(b.path || b.id)
        )
      : [];

    // Get all relationships and classify them
    const allRelationships = model.relationships.getAll();

    // Filter relationships involving this layer
    const allRelatingRelationships = allRelationships.filter(
      r => r.layer === layerName || r.targetLayer === layerName
    );

    // Intra-layer relationships: both source and target in same layer
    const intraRelationships = allRelatingRelationships.filter(
      r => r.layer === layerName && (r.targetLayer === layerName || !r.targetLayer)
    );

    // Inter-layer relationships: source or target in different layer (or other endpoint exists)
    const interRelationships = allRelatingRelationships.filter(
      r => !(r.layer === layerName && (r.targetLayer === layerName || !r.targetLayer))
    );

    // Compute upstream and downstream layers from inter-layer relationships
    const upstreamLayerSet = new Set<string>();
    const downstreamLayerSet = new Set<string>();
    let inboundRelationshipCount = 0;
    let outboundRelationshipCount = 0;

    for (const rel of interRelationships) {
      // Upstream: layers that have relationships targeting THIS layer
      if (rel.targetLayer === layerName && rel.layer !== layerName) {
        upstreamLayerSet.add(rel.layer);
        inboundRelationshipCount++;
      }
      // Downstream: layers that THIS layer references
      if (rel.layer === layerName && rel.targetLayer && rel.targetLayer !== layerName) {
        downstreamLayerSet.add(rel.targetLayer);
        outboundRelationshipCount++;
      }
    }

    // Sort upstream and downstream layers
    const upstreamLayers = Array.from(upstreamLayerSet).sort();
    const downstreamLayers = Array.from(downstreamLayerSet).sort();

    // Sort relationships deterministically by "${source}-${predicate}-${target}"
    intraRelationships.sort((a, b) => {
      const aKey = `${a.source}-${a.predicate}-${a.target}`;
      const bKey = `${b.source}-${b.predicate}-${b.target}`;
      return aKey.localeCompare(bKey);
    });

    interRelationships.sort((a, b) => {
      const aKey = `${a.source}-${a.predicate}-${a.target}`;
      const bKey = `${b.source}-${b.predicate}-${b.target}`;
      return aKey.localeCompare(bKey);
    });

    // Build statistics
    const statistics: ModelLayerStatistics = {
      elementCount: elements.length,
      intraRelationshipCount: intraRelationships.length,
      interRelationshipCount: interRelationships.length,
      inboundRelationshipCount,
      outboundRelationshipCount,
    };

    return {
      layerName,
      layerNumber,
      elements,
      intraRelationships,
      interRelationships,
      upstreamLayers,
      downstreamLayers,
      statistics,
    };
  }
}
