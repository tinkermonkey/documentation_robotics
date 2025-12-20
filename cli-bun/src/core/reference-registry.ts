import type { Reference } from "@/types/index";

/**
 * Reference registry - tracks and validates cross-layer references
 */
export class ReferenceRegistry {
  private references: Map<string, Reference[]>;
  private targetIndex: Map<string, Reference[]>;
  private typeIndex: Map<string, Reference[]>;

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
