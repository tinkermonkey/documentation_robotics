import type { Model } from '../core/model.js';
import { Element } from '../core/element.js';
import type { Relationship } from '../core/relationships.js';
import { LAYER_MAP, type CanonicalLayerName, isValidLayerName } from '../core/layers.js';

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
  layerName: CanonicalLayerName;
  layerNumber: number;
  elements: Element[];                        // sorted by element.path
  intraRelationships: Relationship[];         // both source and target in same layer
  interRelationships: Relationship[];         // source or target in a different layer
  upstreamLayers: CanonicalLayerName[];       // canonical layer names referencing INTO this layer
  downstreamLayers: CanonicalLayerName[];     // canonical layer names this layer references OUT TO
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
  collectLayerData(model: Model, layerName: CanonicalLayerName): ModelLayerReportData {
    // Get the layer number for file naming
    const layerNumber = LAYER_MAP[layerName];

    // Get all elements in this layer using GraphModel's indexed lookup for O(1) layer-scoped access
    // Convert GraphNodes to Elements for report-friendly shape
    const graphNodes = model.graph.getNodesByLayer(layerName);
    const elements: Element[] = graphNodes
      .map(
        (node) =>
          new Element({
            id: node.uuid || node.id,
            path: node.id,
            spec_node_id: node.spec_node_id || '',
            type: node.type,
            layer_id: node.layer,
            name: node.name,
            description: node.description,
            attributes: node.attributes,
            source_reference: node.source_reference,
            metadata: node.metadata,
          })
      )
      .sort((a, b) => (a.path || a.id).localeCompare(b.path || b.id));

    // Get all relationships and classify them
    const allRelationships = model.relationships.getAll();

    // Filter relationships involving this layer
    const allRelatingRelationships = allRelationships.filter(
      r => r.layer === layerName || r.targetLayer === layerName
    );

    // Intra-layer relationships: both source and target in same layer
    // Note: Relationships with missing targetLayer are treated as intra-layer because targetLayer is
    // typically only populated for inter-layer relationships during persistence and loading.
    const intraRelationships = allRelatingRelationships.filter(
      r => r.layer === layerName && (r.targetLayer === layerName || !r.targetLayer)
    );

    // Inter-layer relationships: source or target in different layer (or other endpoint exists)
    const interRelationships = allRelatingRelationships.filter(
      r => !(r.layer === layerName && (r.targetLayer === layerName || !r.targetLayer))
    );

    // Compute upstream and downstream layers from inter-layer relationships
    const upstreamLayerSet = new Set<CanonicalLayerName>();
    const downstreamLayerSet = new Set<CanonicalLayerName>();
    let inboundRelationshipCount = 0;
    let outboundRelationshipCount = 0;

    for (const rel of interRelationships) {
      // Upstream: layers that have relationships targeting THIS layer
      if (rel.targetLayer === layerName && rel.layer !== layerName) {
        upstreamLayerSet.add(rel.layer as CanonicalLayerName);
        inboundRelationshipCount++;
      }
      // Downstream: layers that THIS layer references
      if (rel.layer === layerName && rel.targetLayer && rel.targetLayer !== layerName) {
        downstreamLayerSet.add(rel.targetLayer as CanonicalLayerName);
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
