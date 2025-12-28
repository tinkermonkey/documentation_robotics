import Graph from 'graphology';
import type { Reference, Element } from "../types/index.js";

/**
 * Reference registry - tracks and validates cross-layer references
 */
export class ReferenceRegistry {
  private references: Map<string, Reference[]>;
  private targetIndex: Map<string, Reference[]>;
  private typeIndex: Map<string, Reference[]>;

  // Known reference property names from Python CLI
  private static readonly KNOWN_REF_PROPERTIES = new Set([
    'realizes', 'realizedBy',
    'serves', 'servedBy',
    'accesses', 'accessedBy',
    'uses', 'usedBy',
    'composedOf', 'partOf',
    'flows', 'triggers',
    'archimateRef', 'businessActorRef', 'stakeholderRef',
    'motivationGoalRef', 'dataObjectRef', 'apiOperationRef',
    'applicationServiceRef', 'schemaRef'
  ]);

  constructor() {
    this.references = new Map();
    this.targetIndex = new Map();
    this.typeIndex = new Map();
  }

  /**
   * Add a reference to the registry
   */
  addReference(reference: Reference): void {
    // Add to source index
    const sourceKey = reference.source;
    if (!this.references.has(sourceKey)) {
      this.references.set(sourceKey, []);
    }
    this.references.get(sourceKey)!.push(reference);

    // Add to target index
    const targetKey = reference.target;
    if (!this.targetIndex.has(targetKey)) {
      this.targetIndex.set(targetKey, []);
    }
    this.targetIndex.get(targetKey)!.push(reference);

    // Add to type index
    const typeKey = reference.type;
    if (!this.typeIndex.has(typeKey)) {
      this.typeIndex.set(typeKey, []);
    }
    this.typeIndex.get(typeKey)!.push(reference);
  }

  /**
   * Get all references from a source element
   */
  getReferencesFrom(sourceId: string): Reference[] {
    return this.references.get(sourceId) ?? [];
  }

  /**
   * Get all references to a target element
   */
  getReferencesTo(targetId: string): Reference[] {
    return this.targetIndex.get(targetId) ?? [];
  }

  /**
   * Get all references of a specific type
   */
  getReferencesByType(type: string): Reference[] {
    return this.typeIndex.get(type) ?? [];
  }

  /**
   * Check if a reference exists
   */
  hasReference(sourceId: string, targetId: string): boolean {
    const refs = this.references.get(sourceId) ?? [];
    return refs.some(ref => ref.target === targetId);
  }

  /**
   * Get all references
   */
  getAllReferences(): Reference[] {
    const allRefs: Reference[] = [];
    for (const refs of this.references.values()) {
      allRefs.push(...refs);
    }
    return allRefs;
  }

  /**
   * Clear all references
   */
  clear(): void {
    this.references.clear();
    this.targetIndex.clear();
    this.typeIndex.clear();
  }

  /**
   * Register an element and all its references
   * Scans element properties for known reference names
   */
  registerElement(element: Element): void {
    // Extract references from explicit references array
    if (element.references) {
      for (const ref of element.references) {
        this.addReference(ref);
      }
    }

    // Scan properties for known reference properties
    if (element.properties) {
      for (const [propName, propValue] of Object.entries(element.properties)) {
        if (ReferenceRegistry.KNOWN_REF_PROPERTIES.has(propName)) {
          // Handle string value
          if (typeof propValue === 'string') {
            this.addReference({
              source: element.id,
              target: propValue,
              type: propName
            });
          }
          // Handle array of strings
          else if (Array.isArray(propValue)) {
            for (const target of propValue) {
              if (typeof target === 'string') {
                this.addReference({
                  source: element.id,
                  target: target,
                  type: propName
                });
              }
            }
          }
        }
      }

      // Scan nested properties for *Ref/*Reference properties
      const nestedRefs = this.scanNestedReferences(element.id, element.properties);
      for (const ref of nestedRefs) {
        this.addReference(ref);
      }
    }
  }

  /**
   * Recursively scan nested structures for reference properties
   * Matches Python CLI behavior: looks for properties ending in "Ref" or "Reference"
   */
  private scanNestedReferences(
    sourceId: string,
    data: any,
    path: string = ''
  ): Reference[] {
    const references: Reference[] = [];

    if (!data || typeof data !== 'object') {
      return references;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`;
        references.push(...this.scanNestedReferences(sourceId, data[i], itemPath));
      }
      return references;
    }

    // Scan object properties
    for (const [key, value] of Object.entries(data)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Skip if this is a top-level known reference property (already handled)
      if (!path && ReferenceRegistry.KNOWN_REF_PROPERTIES.has(key)) {
        continue;
      }

      // Check if property name ends with "Ref" or "Reference"
      if (key.endsWith('Ref') || key.endsWith('Reference')) {
        // Handle string value
        if (typeof value === 'string') {
          references.push({
            source: sourceId,
            target: value,
            type: key,
            description: `Nested reference at ${currentPath}`,
          });
        }
        // Handle array of strings
        else if (Array.isArray(value)) {
          for (const target of value) {
            if (typeof target === 'string') {
              references.push({
                source: sourceId,
                target: target,
                type: key,
                description: `Nested reference at ${currentPath}`,
              });
            }
          }
        }
      }
      // Recurse into nested objects
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        references.push(...this.scanNestedReferences(sourceId, value, currentPath));
      }
      // Recurse into arrays
      else if (Array.isArray(value)) {
        references.push(...this.scanNestedReferences(sourceId, value, currentPath));
      }
    }

    return references;
  }

  /**
   * Find broken references (references to non-existent elements)
   */
  findBrokenReferences(validIds: Set<string>): Reference[] {
    return this.getAllReferences().filter(ref => !validIds.has(ref.target));
  }

  /**
   * Get dependency graph as a directed graph using graphology
   * Nodes are element IDs, edges represent references
   */
  getDependencyGraph(): Graph {
    const graph = new Graph({ type: 'directed' });

    // Add all unique nodes
    const nodes = new Set<string>();
    for (const ref of this.getAllReferences()) {
      nodes.add(ref.source);
      nodes.add(ref.target);
    }

    for (const node of nodes) {
      graph.addNode(node);
    }

    // Add edges for all references
    for (const ref of this.getAllReferences()) {
      // Use reference type as edge data
      graph.addEdge(ref.source, ref.target, {
        type: ref.type,
        description: ref.description,
      });
    }

    return graph;
  }

  /**
   * Get statistics about registered references
   */
  getStats(): {
    totalReferences: number;
    uniqueSources: number;
    uniqueTargets: number;
    referenceTypes: string[];
  } {
    return {
      totalReferences: this.getAllReferences().length,
      uniqueSources: this.references.size,
      uniqueTargets: this.targetIndex.size,
      referenceTypes: Array.from(this.typeIndex.keys()),
    };
  }
}
