/**
 * Relationships management for intra-layer and cross-layer relationships
 */

export interface Relationship {
  source: string;
  predicate: string;
  target: string;
  category?: 'structural' | 'behavioral';
  layer: string;
  targetLayer?: string;
  properties?: Record<string, unknown>;
}

/**
 * Relationships class for managing the central relationships.yaml file
 */
export class Relationships {
  private relationships: Relationship[] = [];
  private dirty: boolean = false;

  constructor(relationships: Relationship[] = []) {
    this.relationships = relationships;
  }

  /**
   * Add a relationship
   */
  add(relationship: Relationship): void {
    this.relationships.push(relationship);
    this.dirty = true;
  }

  /**
   * Delete relationships matching criteria
   */
  delete(source: string, target: string, predicate?: string): number {
    const initialLength = this.relationships.length;
    this.relationships = this.relationships.filter(
      (rel) =>
        !(
          rel.source === source &&
          rel.target === target &&
          (!predicate || rel.predicate === predicate)
        )
    );
    const deletedCount = initialLength - this.relationships.length;
    if (deletedCount > 0) {
      this.dirty = true;
    }
    return deletedCount;
  }

  /**
   * Delete all relationships involving an element (as source or target)
   */
  deleteForElement(elementId: string): number {
    const initialLength = this.relationships.length;
    this.relationships = this.relationships.filter(
      (rel) => rel.source !== elementId && rel.target !== elementId
    );
    const deletedCount = initialLength - this.relationships.length;
    // Always mark as dirty to ensure file is rewritten (Python CLI behavior)
    this.dirty = true;
    return deletedCount;
  }

  /**
   * Get all relationships for an element
   */
  getForElement(elementId: string): {
    outgoing: Relationship[];
    incoming: Relationship[];
  } {
    const outgoing = this.relationships.filter((rel) => rel.source === elementId);
    const incoming = this.relationships.filter((rel) => rel.target === elementId);
    return { outgoing, incoming };
  }

  /**
   * Get all relationships
   */
  getAll(): Relationship[] {
    return [...this.relationships];
  }

  /**
   * Find relationships between two elements
   */
  find(source: string, target: string, predicate?: string): Relationship[] {
    return this.relationships.filter(
      (rel) =>
        rel.source === source &&
        rel.target === target &&
        (!predicate || rel.predicate === predicate)
    );
  }

  /**
   * Check if relationships have unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark relationships as clean (no unsaved changes)
   */
  markClean(): void {
    this.dirty = false;
  }

  /**
   * Serialize to array for YAML
   */
  toArray(): Relationship[] {
    return this.relationships;
  }

  /**
   * Load from array (from YAML)
   */
  static fromArray(data: Relationship[]): Relationships {
    return new Relationships(data);
  }
}
