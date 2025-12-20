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

      // Extract layer from element ID (format: {layer}-{type}-{name})
      const [currentLayer] = elementId.split('-');

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
          const [refLayer] = ref.target.split('-');

          // Find matching projection rule
          const matchingRule = this.rules.find(
            r => r.sourceLayer === currentLayer && r.targetLayer === refLayer
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

      const [currentLayer] = elementId.split('-');

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
        const [referencingLayer] = ref.source.split('-');

        // Check if there's a projection rule back to source
        const hasReverseRule = this.rules.some(
          r => r.sourceLayer === referencingLayer && r.targetLayer === currentLayer
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

      const [currentLayer] = elementId.split('-');
      const layer = await model.getLayer(currentLayer);
      if (!layer) {
        return;
      }

      const element = layer.getElement(elementId);
      if (!element || !element.references) {
        return;
      }

      for (const ref of element.references) {
        const [refLayer] = ref.target.split('-');

        // Check if there's a rule allowing this transition
        const hasRule = this.rules.some(
          r => r.sourceLayer === currentLayer && r.targetLayer === refLayer
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
