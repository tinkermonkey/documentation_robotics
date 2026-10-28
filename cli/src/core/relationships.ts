/**
 * Relationships management for intra-layer and cross-layer relationships
 */

export interface Relationship {
  source: string;
  predicate: string;
  target: string;
  category?: "structural" | "behavioral";
  layer: string;
  targetLayer?: string;
  properties?: Record<string, unknown>;
}

/**
 * Every identifier a relationship row may use to name an element: its UUID `id`
 * and its dotted `path`. Both forms are legal in relationships.yaml.
 */
export function elementIdentifiers(
  element: { id?: unknown; path?: unknown },
  ...extra: Array<string | undefined>
): string[] {
  const ids = new Set<string>();
  for (const candidate of [element.id, element.path, ...extra]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      ids.add(candidate);
    }
  }
  return [...ids];
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
   * Delete all relationships involving an element (as source or target).
   *
   * A row may name an element by its UUID `id` or by its dotted `path`, so callers
   * should pass every identifier the element is known by (see
   * `elementIdentifiers()`); any row whose source or target matches one of them
   * is removed.
   */
  deleteForElement(elementId: string | string[]): number {
    const ids = new Set(
      (Array.isArray(elementId) ? elementId : [elementId]).filter((id) => !!id)
    );
    const initialLength = this.relationships.length;
    this.relationships = this.relationships.filter(
      (rel) => !ids.has(rel.source) && !ids.has(rel.target)
    );
    const deletedCount = initialLength - this.relationships.length;
    // Always mark as dirty to ensure file is rewritten (Python CLI behavior)
    this.dirty = true;
    return deletedCount;
  }

  /**
   * Keep only the relationships for which `keep` returns true, preserving order.
   * Returns the number of relationships removed.
   */
  retain(keep: (rel: Relationship) => boolean): number {
    const initialLength = this.relationships.length;
    this.relationships = this.relationships.filter(keep);
    const removedCount = initialLength - this.relationships.length;
    if (removedCount > 0) {
      this.dirty = true;
    }
    return removedCount;
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
