import { Model } from './model.js';
import { ReferenceRegistry } from './reference-registry.js';
import type { Element } from '../types/index.js';

/**
 * Projection rule for cross-layer dependency traversal
 */
export interface ProjectionRule {
  sourceLayer: string;
  targetLayer: string;
  predicate?: string; // Optional predicate filter
}

/**
 * Projection engine - projects dependencies across layers following defined rules
 */
export class ProjectionEngine {
  private rules: ProjectionRule[] = [];
  private static readonly MAX_RECURSION_DEPTH = 20;

  /**
   * Extract the layer number from a layer name (e.g., "01-motivation" -> "01")
   */
  private getLayerNumber(layerName: string): string {
    const match = layerName.match(/^(\d+)/);
    return match ? match[1] : layerName;
  }


  /**
   * Find which layer contains the given element
   */
  private async findElementLayer(
    model: Model,
    elementId: string
  ): Promise<string | undefined> {
    for (const [layerName, layer] of model.layers) {
      if (layer.getElement(elementId)) {
        return layerName;
      }
    }
    return undefined;
  }

  /**
   * Add a projection rule
   */
  addRule(rule: ProjectionRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove a projection rule
   */
  removeRule(sourceLayer: string, targetLayer: string): void {
    this.rules = this.rules.filter(
      r => !(r.sourceLayer === sourceLayer && r.targetLayer === targetLayer)
    );
  }

  /**
   * Get all rules
   */
  getRules(): ProjectionRule[] {
    return [...this.rules];
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Project dependencies from source element to target layer
   * Follows references according to projection rules
   */
  async project(
    model: Model,
    sourceElementId: string,
    targetLayer: string
  ): Promise<Element[]> {
    const results: Element[] = [];
    const visited = new Set<string>();

    const traverse = async (elementId: string, currentDepth: number = 0): Promise<void> => {
      // Prevent infinite recursion and circular dependencies
      if (visited.has(elementId) || currentDepth > ProjectionEngine.MAX_RECURSION_DEPTH) {
        return;
      }
      visited.add(elementId);

      // Find which layer contains this element
      const currentLayer = await this.findElementLayer(model, elementId);
      if (!currentLayer) {
        return;
      }

      const layer = await model.getLayer(currentLayer);
      if (!layer) {
        return;
      }

      const element = layer.getElement(elementId);
      if (!element) {
        return;
      }

      // Check if we've reached target layer
      if (currentLayer === targetLayer) {
        // Avoid adding duplicates
        if (!results.find(e => e.id === element.id)) {
          results.push(element);
        }
        return;
      }

      // Follow references according to projection rules
      if (element.references) {
        for (const ref of element.references) {
          // Find which layer contains the referenced element
          const refLayer = await this.findElementLayer(model, ref.target);
          if (!refLayer) {
            continue;
          }

          // Find matching projection rule (compare by layer number)
          const currentLayerNum = this.getLayerNumber(currentLayer);
          const refLayerNum = this.getLayerNumber(refLayer);
          const matchingRule = this.rules.find(
            r => r.sourceLayer === currentLayerNum && r.targetLayer === refLayerNum
          );

          if (matchingRule) {
            await traverse(ref.target, currentDepth + 1);
          }
        }
      }
    };

    await traverse(sourceElementId);
    return results;
  }

  /**
   * Project dependencies in reverse (find what projects back to source)
   * Useful for impact analysis
   */
  async projectReverse(
    model: Model,
    targetElementId: string,
    sourceLayer: string
  ): Promise<Element[]> {
    const results: Element[] = [];
    const visited = new Set<string>();

    // Build reference registry for efficient lookups
    const registry = new ReferenceRegistry();
    for (const layer of model.layers.values()) {
      for (const element of layer.listElements()) {
        registry.registerElement(element);
      }
    }

    const traverse = async (elementId: string, currentDepth: number = 0): Promise<void> => {
      if (visited.has(elementId) || currentDepth > ProjectionEngine.MAX_RECURSION_DEPTH) {
        return;
      }
      visited.add(elementId);

      // Find which layer contains this element
      const currentLayer = await this.findElementLayer(model, elementId);
      if (!currentLayer) {
        return;
      }

      const layer = await model.getLayer(currentLayer);
      if (!layer) {
        return;
      }

      const element = layer.getElement(elementId);
      if (!element) {
        return;
      }

      // Check if we've reached source layer
      if (currentLayer === sourceLayer) {
        if (!results.find(e => e.id === element.id)) {
          results.push(element);
        }
        return;
      }

      // Use reference registry to find all elements that reference this one (O(1) lookup)
      const referencesTo = registry.getReferencesTo(elementId);
      for (const ref of referencesTo) {
        // Find which layer contains the referencing element
        const referencingLayer = await this.findElementLayer(model, ref.source);
        if (!referencingLayer) {
          continue;
        }

        // Check if there's a projection rule back to source (compare by layer number)
        const referencingLayerNum = this.getLayerNumber(referencingLayer);
        const currentLayerNum = this.getLayerNumber(currentLayer);
        const hasReverseRule = this.rules.some(
          r => r.sourceLayer === referencingLayerNum && r.targetLayer === currentLayerNum
        );

        if (hasReverseRule) {
          await traverse(ref.source, currentDepth + 1);
        }
      }
    };

    await traverse(targetElementId);
    return results;
  }

  /**
   * Get all elements reachable from source through projection rules
   * @param model The architecture model
   * @param sourceElementId The source element ID
   * @param maxDepth Maximum traversal depth (visited at depth <= maxDepth)
   * @returns Map of element IDs to their depth from source
   */
  async getReachable(
    model: Model,
    sourceElementId: string,
    maxDepth: number = 10
  ): Promise<Map<string, number>> {
    const reachable = new Map<string, number>();
    const visited = new Set<string>();

    const traverse = async (elementId: string, depth: number): Promise<void> => {
      if (visited.has(elementId) || depth > maxDepth) {
        return;
      }
      visited.add(elementId);

      if (!reachable.has(elementId)) {
        reachable.set(elementId, depth);
      }

      // Find which layer contains this element
      const currentLayer = await this.findElementLayer(model, elementId);
      if (!currentLayer) {
        return;
      }

      const layer = await model.getLayer(currentLayer);
      if (!layer) {
        return;
      }

      const element = layer.getElement(elementId);
      if (!element || !element.references) {
        return;
      }

      for (const ref of element.references) {
        // Find which layer contains the referenced element
        const refLayer = await this.findElementLayer(model, ref.target);
        if (!refLayer) {
          continue;
        }

        // Check if there's a rule allowing this transition (compare by layer number)
        const currentLayerNum = this.getLayerNumber(currentLayer);
        const refLayerNum = this.getLayerNumber(refLayer);
        const hasRule = this.rules.some(
          r => r.sourceLayer === currentLayerNum && r.targetLayer === refLayerNum
        );

        if (hasRule) {
          await traverse(ref.target, depth + 1);
        }
      }
    };

    await traverse(sourceElementId, 0);
    // Remove the source element from reachable
    reachable.delete(sourceElementId);
    return reachable;
  }
}
