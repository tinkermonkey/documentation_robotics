import { ElementCandidate, RelationshipCandidate } from './pattern-loader.js';
import { getLayerNumber } from './layer-constants.js';

interface InferenceContext {
  elements: Map<string, ElementCandidate>;
  existingRelationships: RelationshipCandidate[];
}

/**
 * Relationship inference engine that derives implicit relationships
 * from explicit patterns and code structure.
 */
export class RelationshipInferenceEngine {
  private context: InferenceContext;

  constructor(context: InferenceContext) {
    this.context = context;
  }

  /**
   * Run all inference strategies and return inferred relationships.
   */
  inferRelationships(): RelationshipCandidate[] {
    const inferred: RelationshipCandidate[] = [];

    inferred.push(...this.inferBidirectionalRelationships());
    inferred.push(...this.inferCompositionRelationships());
    inferred.push(...this.inferTypeBasedRelationships());
    inferred.push(...this.inferCrossLayerRelationships());

    // Filter out duplicates and invalid relationships
    return this.deduplicateAndValidate(inferred);
  }

  /**
   * Infer reverse relationships (e.g., A depends-on B → B provides-to A)
   */
  private inferBidirectionalRelationships(): RelationshipCandidate[] {
    const inferred: RelationshipCandidate[] = [];
    const bidirectionalPairs: Map<string, string> = new Map([
      ['depends-on', 'provides-to'],
      ['provides-to', 'depends-on'],
      ['calls', 'called-by'],
      ['called-by', 'calls'],
      ['contains', 'contained-by'],
      ['contained-by', 'contains'],
    ]);

    for (const rel of this.context.existingRelationships) {
      const reverseType = bidirectionalPairs.get(rel.relationshipType);
      if (reverseType && rel.sourceId && rel.targetId) {
        inferred.push({
          id: `${rel.targetId}::${reverseType}::${rel.sourceId}`,
          sourceId: rel.targetId,
          targetId: rel.sourceId,
          relationshipType: reverseType,
          confidence: Math.max(0, rel.confidence - 0.1),
          layer: this.extractLayerFromId(rel.targetId),
        });
      }
    }

    return inferred;
  }

  /**
   * Infer composition relationships from co-location in same module/class.
   */
  private inferCompositionRelationships(): RelationshipCandidate[] {
    const inferred: RelationshipCandidate[] = [];
    const moduleMap = new Map<string, ElementCandidate[]>();

    // Group elements by containing module or source file
    for (const [, element] of this.context.elements) {
      const module = element.source?.file || 'unknown';
      if (!moduleMap.has(module)) {
        moduleMap.set(module, []);
      }
      moduleMap.get(module)!.push(element);
    }

    // Create composition relationships between elements in same module
    for (const elements of moduleMap.values()) {
      for (let i = 0; i < elements.length; i++) {
        for (let j = i + 1; j < elements.length; j++) {
          const el1 = elements[i];
          const el2 = elements[j];

          // Check if not already related
          const exists = this.context.existingRelationships.some(
            (r) =>
              (r.sourceId === el1.id && r.targetId === el2.id) ||
              (r.sourceId === el2.id && r.targetId === el1.id)
          );

          if (!exists && this.isSameLayer(el1.id, el2.id)) {
            inferred.push({
              id: `${el1.id}::composed-of::${el2.id}`,
              sourceId: el1.id,
              targetId: el2.id,
              relationshipType: 'composed-of',
              confidence: 0.6,
              layer: this.extractLayerFromId(el1.id),
            });
          }
        }
      }
    }

    return inferred;
  }

  /**
   * Infer relationships based on type compatibility and data flow.
   */
  private inferTypeBasedRelationships(): RelationshipCandidate[] {
    const inferred: RelationshipCandidate[] = [];

    for (const [, sourceEl] of this.context.elements) {
      for (const [, targetEl] of this.context.elements) {
        if (
          sourceEl.id === targetEl.id ||
          this.context.existingRelationships.some(
            (r) => r.sourceId === sourceEl.id && r.targetId === targetEl.id
          )
        ) {
          continue;
        }

        // Type-based inference: if target produces type that source consumes
        if (
          sourceEl.attributes?.consumes &&
          targetEl.attributes?.produces &&
          this.typesCompatible(
            String(sourceEl.attributes.consumes),
            String(targetEl.attributes.produces)
          )
        ) {
          inferred.push({
            id: `${sourceEl.id}::consumes::${targetEl.id}`,
            sourceId: sourceEl.id,
            targetId: targetEl.id,
            relationshipType: 'consumes',
            confidence: 0.7,
            layer: this.extractLayerFromId(sourceEl.id),
          });
        }
      }
    }

    return inferred;
  }

  /**
   * Infer cross-layer relationships with proper direction validation.
   */
  private inferCrossLayerRelationships(): RelationshipCandidate[] {
    const inferred: RelationshipCandidate[] = [];

    for (const sourceEl of this.context.elements.values()) {
      for (const targetEl of this.context.elements.values()) {
        if (sourceEl.id === targetEl.id) continue;

        const sourceLayer = getLayerNumber(sourceEl.id);
        const targetLayer = getLayerNumber(targetEl.id);

        if (sourceLayer === null || targetLayer === null) continue;
        if (sourceLayer === targetLayer) continue; // Skip same-layer

        // Only allow higher → lower layer references (spec rule)
        if (sourceLayer < targetLayer) continue;

        // Check for semantic relationship hints
        if (
          sourceEl.attributes?.implements &&
          targetEl.attributes?.provides &&
          sourceEl.attributes.implements === targetEl.attributes.provides
        ) {
          inferred.push({
            id: `${sourceEl.id}::implements::${targetEl.id}`,
            sourceId: sourceEl.id,
            targetId: targetEl.id,
            relationshipType: 'implements',
            confidence: 0.85,
            layer: this.extractLayerFromId(sourceEl.id),
          });
        }
      }
    }

    return inferred;
  }

  /**
   * Deduplicate inferred relationships and remove invalid ones.
   */
  private deduplicateAndValidate(
    relationships: RelationshipCandidate[]
  ): RelationshipCandidate[] {
    const seen = new Set<string>();
    const valid: RelationshipCandidate[] = [];

    for (const rel of relationships) {
      const key = `${rel.sourceId}-${rel.relationshipType}-${rel.targetId}`;

      if (
        !seen.has(key) &&
        this.isValidRelationship(rel) &&
        this.respectsLayerHierarchy(rel)
      ) {
        seen.add(key);
        valid.push(rel);
      }
    }

    return valid;
  }

  private isValidRelationship(rel: RelationshipCandidate): boolean {
    return (
      rel.sourceId !== undefined &&
      rel.targetId !== undefined &&
      rel.sourceId !== rel.targetId &&
      rel.confidence > 0.5
    );
  }

  private respectsLayerHierarchy(rel: RelationshipCandidate): boolean {
    if (!rel.sourceId || !rel.targetId) return false;

    const sourceLayer = getLayerNumber(rel.sourceId);
    const targetLayer = getLayerNumber(rel.targetId);

    if (sourceLayer === null || targetLayer === null) return true; // Skip validation if can't determine

    // Allow same-layer, but higher→lower is the standard direction
    return sourceLayer >= targetLayer;
  }

  private isSameLayer(id1: string, id2: string): boolean {
    const layer1 = id1.split('.')[0];
    const layer2 = id2.split('.')[0];
    return layer1 === layer2;
  }

  private typesCompatible(type1: string, type2: string): boolean {
    // Simple exact match; can be enhanced with type hierarchy
    return type1 === type2;
  }

  private extractLayerFromId(elementId: string): string {
    const parts = elementId.split('.');
    return parts[0] || 'unknown';
  }
}
