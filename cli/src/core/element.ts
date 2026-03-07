import type {
  Element as IElement,
  ElementMetadata,
  Reference,
  Relationship,
  SourceReference,
} from "../types/index.js";

/**
 * Element class representing an individual architecture item
 *
 * Aligns with spec-node.schema.json structure for direct validation.
 * Provides type-safe access to spec-node aligned fields with source reference support.
 */
export class Element implements IElement {
  // Spec-node aligned required fields
  id: string = "";
  spec_node_id: string = "";
  type: string = "";
  layer_id: string = "";
  name: string = "";

  // Spec-node aligned optional fields
  description?: string;
  attributes: Record<string, unknown> = {};
  source_reference?: SourceReference;
  metadata?: ElementMetadata;

  // Relationship tracking
  references: Reference[] = [];
  relationships: Relationship[] = [];

  // Internal tracking (unchanged)
  layer?: string;
  filePath?: string;
  rawData?: any;

  // Original semantic ID mapping (for legacy format elements converted to UUID)
  // Used to look up elements by their original semantic ID after UUID conversion
  semanticId?: string;

  constructor(data: Partial<IElement>) {
    this.initializeFromSpecNode(data);
  }

  /**
   * Initialize Element from spec-node aligned format
   */
  private initializeFromSpecNode(data: Partial<IElement>): void {
    // ID is required
    if (!data.id) {
      throw new Error(
        "Element must have an 'id' field. Missing ID prevents proper element tracking and causes silent data loss."
      );
    }

    this.id = data.id;
    this.spec_node_id = data.spec_node_id || "";
    this.type = data.type || "";
    this.layer_id = data.layer_id || "";
    this.name = data.name || "";
    this.description = data.description;

    // Handle attributes - spec requires 'attributes' field only
    this.attributes = data.attributes || {};

    // Extract source_reference
    if (data.source_reference) {
      this.source_reference = data.source_reference;
    }

    this.metadata = data.metadata;

    // Relationship tracking
    this.references = data.references || [];
    this.relationships = data.relationships || [];

    // Internal tracking
    this.layer = data.layer || data.layer_id;
    this.filePath = data.filePath;
    this.rawData = data.rawData;

    // Semantic ID (for legacy format elements converted to UUID)
    this.semanticId = (data as any).semanticId;
  }

  /**
   * Convert Element to spec-node format for validation
   * Returns object that matches spec-node.schema.json structure
   */
  toSpecNode(): Record<string, unknown> {
    return {
      id: this.id,
      spec_node_id: this.spec_node_id,
      type: this.type,
      layer_id: this.layer_id,
      name: this.name,
      ...(this.description && { description: this.description }),
      ...(Object.keys(this.attributes).length > 0 && { attributes: this.attributes }),
      ...(this.source_reference && { source_reference: this.source_reference }),
      ...(this.metadata && { metadata: this.metadata }),
    };
  }

  /**
   * Create Element from spec-node format
   */
  static fromSpecNode(data: Record<string, unknown>): Element {
    return new Element({
      id: data.id as string,
      spec_node_id: data.spec_node_id as string,
      type: data.type as string,
      layer_id: data.layer_id as string,
      name: data.name as string,
      description: data.description as string | undefined,
      attributes: (data.attributes as Record<string, unknown>) || {},
      source_reference: data.source_reference as SourceReference | undefined,
      metadata: data.metadata as ElementMetadata | undefined,
    });
  }

  /**
   * Get metadata with defensive copy for audit integrity
   *
   * Returns a deep copy of metadata to prevent external code from mutating
   * the internal metadata object. This ensures timestamp immutability
   * for audit trail integrity.
   *
   * @returns A defensive copy of the metadata object, or undefined if not set
   */
  getMetadata(): ElementMetadata | undefined {
    if (!this.metadata) {
      return undefined;
    }

    // Return a defensive copy to prevent external mutations
    return {
      created_at: this.metadata.created_at,
      updated_at: this.metadata.updated_at,
      created_by: this.metadata.created_by,
      version: this.metadata.version,
    };
  }

  /**
   * Get source reference from element
   *
   * Returns the source reference from the top-level source_reference field.
   *
   * @returns The source reference if found, undefined otherwise
   */
  getSourceReference(): SourceReference | undefined {
    return this.source_reference;
  }

  /**
   * Set source reference on element
   *
   * @param sourceRef The source reference to set, or undefined to remove existing reference
   */
  setSourceReference(sourceRef: SourceReference | undefined): void {
    this.source_reference = sourceRef;
  }

  /**
   * Check if element has a source reference
   */
  hasSourceReference(): boolean {
    return this.getSourceReference() !== undefined;
  }

  /**
   * Serialize to JSON representation (spec-node aligned format)
   */
  toJSON(): IElement {
    const result: IElement = {
      id: this.id,
      spec_node_id: this.spec_node_id,
      type: this.type,
      layer_id: this.layer_id,
      name: this.name,
    };

    if (this.description) {
      result.description = this.description;
    }

    if (Object.keys(this.attributes).length > 0) {
      result.attributes = this.attributes;
    }

    if (this.source_reference) {
      result.source_reference = this.source_reference;
    }

    if (this.metadata) {
      result.metadata = this.metadata;
    }

    if (this.references.length > 0) {
      result.references = this.references;
    }

    if (this.relationships.length > 0) {
      result.relationships = this.relationships;
    }

    return result;
  }

  /**
   * String representation
   */
  toString(): string {
    return `Element(${this.id})`;
  }
}
